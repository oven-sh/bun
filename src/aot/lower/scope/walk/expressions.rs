use bun_sema::bind::{Binding, CodeUnit, CommonJsVariable, PrivateMembers, ScopeId, SymbolId};
use bun_sema::fold::{Decision, TreeNode};
use bun_sema::hir::{
    BinOp, Call, CallId, ExprId, ExprKind, FnId, JsxId, MemberId, NodeData, PatId, PatKind,
    PropKey, UnOp,
};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, ImportSpecifier, JsxCallee, JsxImport, RequireCallForm,
    find_module_printed_as_require, find_require_call, jsx_callee, may_require_get_members,
};
use smallvec::SmallVec;

use super::walker::bindings_of;
use super::{ArgumentRead, Context, DeclarationRead, PatternRole, Task, Walker};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Scope};
use crate::builtins::{Intrinsic, Mutability, Resolved};
use crate::ir::ClassSlot;
use crate::lower::jsx::find_key_argument;
use crate::lower::scope::lexical_owners::{ScopeObjectSearch, find_binding_looked_for};
use crate::lower::scope::{
    BindingRef, CalledByName, ScopeSlot, find_declaration_called_by_name,
    find_declaration_made_at_first_read,
};
use crate::lower::{class, parameters};
use crate::modules::{Member, ModuleRef, Site, SiteAnswer};

fn has_module_operation(site: &ImportSite, answer: SiteAnswer<'_>, argument_count: usize) -> bool {
    match site.kind {
        ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_) => match answer {
            SiteAnswer::Computed(_) => argument_count <= 1,
            SiteAnswer::Module(_) | SiteAnswer::Failed(_) | SiteAnswer::Erased => true,
        },
        ImportSiteKind::GetBuiltinModule(_) => match answer {
            SiteAnswer::Module(_) | SiteAnswer::Erased => true,
            SiteAnswer::Computed(_) | SiteAnswer::Failed(_) => false,
        },
        ImportSiteKind::RequireResolve(_) => argument_count <= 1,
        ImportSiteKind::ImportMetaResolve(_) => match answer {
            SiteAnswer::Module(ModuleRef::External { .. }) => false,
            SiteAnswer::Module(_) => site.consults_resolver && argument_count == 1,
            SiteAnswer::Computed(_) => {
                argument_count == 1 && !matches!(site.specifier, ImportSpecifier::Constant(_))
            }
            SiteAnswer::Failed(_) | SiteAnswer::Erased => false,
        },
        _ => false,
    }
}

impl Walker<'_, '_> {
    pub(super) fn visit_expression(&mut self, expression: ExprId, context: Context) {
        if expression.is_none() || self.decisions.is_dead_expr(expression) {
            return;
        }
        match self.decisions.decision(expression) {
            Decision::Unknown => {}
            Decision::GlobalPath(_) => {
                let is_bound_name = matches!(self.hir[expression].kind, ExprKind::Ident(_))
                    && self.bound.binding(expression) != Binding::Free;
                if is_bound_name {
                    self.visit_identifier(expression, context);
                }
                for binding in bindings_of(&self.jsx_uses, expression) {
                    self.record_binding_use(context, binding, false);
                }
                return;
            }
            _ => return,
        }
        match self.hir[expression].kind {
            ExprKind::Cond { test: tested, .. }
            | ExprKind::Unary {
                op: UnOp::Not | UnOp::Typeof,
                operand: tested,
            }
            | ExprKind::Binary {
                op: BinOp::And,
                left: tested,
                ..
            } => {
                self.note_name_that_nobody_looks_at(tested);
            }
            _ => {}
        }
        match self.hir[expression].kind {
            ExprKind::Ident(_) => self.visit_identifier(expression, context),
            ExprKind::This => self.use_this(context),
            ExprKind::NewTarget(_) => self.use_new_target(context),
            ExprKind::Dot { obj, .. } => {
                self.visit_member(expression, obj, ExprId::NONE, context);
            }
            ExprKind::Index { obj, index, .. } => {
                self.visit_member(expression, obj, index, context);
            }
            ExprKind::PrivateIdentifier(_) => self.record_private_name(expression, context),
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                self.visit_call(expression, call, context);
            }
            ExprKind::Unary { operand, .. } => self.push_operands_of_store([operand], context),
            ExprKind::Assign { target, value, .. } if self.is_assignment_pattern(target) => {
                self.push_operands_of_store([value, target], context);
            }
            ExprKind::Assign { target, value, .. } => {
                self.push_operands_of_store([target, value], context);
            }
            ExprKind::Fn(function) => {
                if !context.is_conditional {
                    self.walk
                        .makers_of_closures_in_every_run
                        .push(context.function);
                }
                self.visit_function(function, context.function)
            }
            ExprKind::Class(class) => self.visit_class(class, context),
            ExprKind::Jsx(jsx) => self.visit_jsx(expression, jsx, context),
            ExprKind::Missing
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::JsxText(_)
            | ExprKind::ImportMeta => {}
            _ => self.push_evaluated_children(expression, context),
        }
    }

    fn push_operands_of_store<const N: usize>(&mut self, operands: [ExprId; N], context: Context) {
        let first_pending = self.pending_stores.len() as u32;
        self.push_expressions(operands, context);
        self.push_task(Task::EndStores { first_pending }, context);
    }

    fn is_assignment_pattern(&self, target: ExprId) -> bool {
        let target = self.hir.skip_type_assertions(target);
        matches!(
            self.hir[target].kind,
            ExprKind::Array(_) | ExprKind::Object(_)
        )
    }

    pub(super) fn note_name_that_nobody_looks_at(
        &mut self,
        expression: ExprId,
    ) -> Option<SymbolId> {
        if expression.is_none() {
            return None;
        }
        let name = self.hir.skip_type_assertions(expression);
        if !matches!(self.hir[name].kind, ExprKind::Ident(_)) {
            return None;
        }
        self.is_only_called_or_tested[name.idx()] = true;
        match self.bound.binding(name) {
            Binding::Symbol(symbol) => Some(symbol),
            _ => None,
        }
    }

    fn visit_identifier(&mut self, identifier: ExprId, context: Context) {
        self.visit_name(identifier, self.bound.binding(identifier), context);
    }

    fn visit_name(&mut self, identifier: ExprId, binding: Binding, context: Context) {
        let (bound, function) = (self.bound, context.function);
        if let Binding::Symbol(symbol) = binding
            && (!self.is_only_called_or_tested[identifier.idx()]
                || bound.is_store_target(identifier))
        {
            self.walk.is_looked_at[symbol.idx()] = true;
        }
        if let (Binding::Symbol(symbol), true) = (binding, bound.is_store_target(identifier)) {
            self.walk.symbol_stores.push((symbol, identifier, function));
            self.walk.last_store_times[symbol.idx()] = u32::MAX;
            self.pending_stores.push(symbol);
        }
        self.record_binding_use(context, binding, bound.is_store_target(identifier));
        if let Some(start) = bound.dynamic_lookup_scope(NodeData::Expr(identifier)) {
            let looked_for = find_binding_looked_for(bound, start, binding);
            let declaring_scope = self.declaring_scope(looked_for);
            let search = ScopeObjectSearch {
                start,
                until: bound.dynamic_lookup_end(identifier, declaring_scope),
                declaring_scope,
                pos: self.hir[identifier].pos,
                asks_with_objects_alone: false,
            };
            self.record_scope_objects(function, search);
        }
    }

    pub(super) fn note_binding_is_looked_at(&mut self, binding: Binding) {
        if let Binding::Symbol(symbol) = binding {
            self.walk.is_looked_at[symbol.idx()] = true;
        }
    }

    pub(super) fn record_binding_use(
        &mut self,
        context: Context,
        binding: Binding,
        is_store: bool,
    ) {
        match binding {
            Binding::Symbol(symbol) => {
                self.record_symbol_use(context, symbol);
                let (hir, bound) = (self.hir, self.bound);
                let owner = match bound.initializing_declaration(symbol) {
                    Some(bun_sema::bind::Decl::Fn(_)) => {
                        bound.code_unit(bound.symbol_scope(symbol))
                    }
                    _ => CodeUnit::File,
                };
                let owner = match owner {
                    CodeUnit::Function(owner) => self.walk.function_of_fn[owner.idx()],
                    CodeUnit::File | CodeUnit::FieldInitializer(_) => None,
                };
                let owner = owner.filter(|it| self.walk.functions[it.index()].creator.is_some());
                if let Some(owner) = owner
                    && let Some(function) = find_declaration_made_at_first_read(hir, bound, symbol)
                {
                    let time = self.tick();
                    self.walk.declaration_reads.push(DeclarationRead {
                        symbol,
                        function,
                        owner,
                        reader: context.function,
                        enclosing_loop: context.enclosing_loop,
                        time,
                    });
                    let is_made_at_entry =
                        !context.is_conditional || context.enclosing_loop.is_some();
                    if is_made_at_entry && owner == context.function {
                        self.walk.declarations_read_by_every_run.push(symbol);
                        self.walk.makers_of_closures_in_every_run.push(owner);
                    }
                }
                if is_store {
                    self.record_store(context, BindingRef::Symbol(symbol));
                }
            }
            Binding::Arguments(owner) => self.use_arguments_binding(owner, is_store, context),
            Binding::CommonJs(variable) if self.walk.has_wrapper_parameters => {
                let slot = ScopeSlot::CommonJs(variable);
                self.record_slot_use(context.function, self.file_scope, slot);
                if is_store {
                    self.record_slot_store(context, self.file_scope, slot);
                }
            }
            Binding::CommonJs(_) | Binding::Free => {}
        }
    }

    fn visit_member(&mut self, access: ExprId, object: ExprId, index: ExprId, context: Context) {
        let counted =
            parameters::find_function_whose_arguments_are_counted(self.hir, self.bound, access);
        if let Some(function) = counted
            && self.walk.function_of_fn[function.idx()] == Some(context.function)
        {
            let read = (context.function, ArgumentRead::Count);
            self.walk.argument_reads.push(read);
            return;
        }
        if let Some(module) = find_module_printed_as_require(self.hir, self.bound, access) {
            let require = Binding::CommonJs(CommonJsVariable::Require);
            self.visit_name(module, require, context);
        }
        if matches!(self.hir[object].kind, ExprKind::Super) {
            self.use_this(context);
            self.use_home_object(context);
        } else if self.names_variable_of_inner_module(access) {
            return;
        } else {
            self.record_private_name(access, context);
            self.push_expressions([object], context);
        }
        self.push_expressions([index], context);
    }

    fn names_variable_of_inner_module(&self, access: ExprId) -> bool {
        if self.inner_module_parameters.is_empty() {
            return false;
        }
        let hir = self.hir;
        let mut root = access;
        while let Some((object, _)) = hir.member_key(root) {
            root = hir.skip_type_assertions(object);
        }
        let is_parameter = match self.bound.binding(root) {
            Binding::Symbol(symbol) if matches!(hir[root].kind, ExprKind::Ident(_)) => {
                self.inner_module_parameters.binary_search(&symbol).is_ok()
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                false
            }
        };
        is_parameter
            && match self.input.modules.member(self.input.file, access) {
                Some(Member::OnObject) | None => false,
                Some(
                    Member::Variable(_)
                    | Member::Copy(_)
                    | Member::Binding(_)
                    | Member::Undefined
                    | Member::Marker(_),
                ) => true,
            }
    }

    fn note_names_handed_to_declaration(&mut self, expression: ExprId, call: &Call, callee: FnId) {
        let arguments = self.hir.ids(call.args);
        let spreads = |argument: ExprId| matches!(self.hir[argument].kind, ExprKind::Spread(_));
        if !matches!(self.hir[expression].kind, ExprKind::Call(_)) || arguments.clone().any(spreads)
        {
            return;
        }
        for (index, argument) in arguments.enumerate() {
            if let Some(name) = self.note_name_that_nobody_looks_at(argument) {
                self.walk
                    .names_handed_to_declarations
                    .push((name, callee, index as u32));
            }
        }
    }

    fn visit_call(&mut self, expression: ExprId, call: CallId, context: Context) {
        let call = self.hir[call];
        let mut binds_this_for_what_follows = false;
        if matches!(self.hir[call.callee].kind, ExprKind::Super) {
            let scope = context.lexical_scope;
            self.use_this(context);
            self.use_new_target(context);
            self.record_slot_store(context, scope, ScopeSlot::This);
            match self.bound.code_unit(scope) {
                CodeUnit::Function(constructor) => {
                    binds_this_for_what_follows = self.walk.function_of_fn[constructor.idx()]
                        == Some(context.function)
                        && self.unconditional_statements.contains(&expression);
                    self.record_slot_use(context.function, scope, ScopeSlot::Callee);
                    let reference = (context.function, constructor);
                    self.walk.function_references.push(reference);
                }
                CodeUnit::File | CodeUnit::FieldInitializer(_) => {}
            }
            let binding = (scope, binds_this_for_what_follows);
            self.walk.this_bindings.push(binding);
        } else {
            if let Some(&eval) = self.bound.eval_scope(expression) {
                self.visit_direct_eval(expression, eval, context);
            }
            self.record_argument_read(&call, context);
            let loads_module = self.evaluates_inner_module(expression, &call)
                || (self.walk.has_wrapper_parameters
                    && self.is_bound_module_call(expression, &call));
            if !loads_module {
                let called = find_declaration_called_by_name(self.hir, self.bound, expression);
                match called.filter(|called| self.runs_behind_initialization(called, context)) {
                    Some(called) => {
                        let reference = (context.function, called.function);
                        self.walk.function_references.push(reference);
                        self.walk.calls_by_name.push((expression, called.function));
                        self.note_names_handed_to_declaration(expression, &call, called.function);
                        let site = (called.function, context.function, self.tick());
                        self.walk.sites_that_start.push(site);
                        self.walk.names_called.extend(called.initialized);
                    }
                    None => {
                        if matches!(self.hir[expression].kind, ExprKind::Call(_)) {
                            self.note_name_that_nobody_looks_at(call.callee);
                        }
                        self.push_expressions([call.callee], context)
                    }
                }
            }
        }
        self.push_expressions(self.hir.ids(call.args), context);
        if binds_this_for_what_follows {
            let scope = context.lexical_scope;
            self.push_task(Task::InitializeSlot(scope, ScopeSlot::This), context);
        }
    }

    fn runs_behind_initialization(&self, called: &CalledByName, context: Context) -> bool {
        let Some(symbol) = called.initialized else {
            return true;
        };
        let scope = self.bound.symbol_scope(symbol);
        let CodeUnit::Function(owner) = self.bound.code_unit(scope) else {
            return false;
        };
        let owner = self.walk.function_of_fn[owner.idx()];
        let callee = self.walk.function_of_fn[called.function.idx()];
        let mut is_behind = self.walk.symbol_initializations[symbol.idx()].is_some();
        let mut current = context.function;
        while Some(current) != owner {
            if Some(current) == callee {
                return true;
            }
            let walked = &self.walk.functions[current.index()];
            let is_hoisted_in_owner = walked.hoisted_to.is_some() && walked.creator == owner;
            is_behind &= !is_hoisted_in_owner;
            let Some(creator) = walked.creator else {
                return false;
            };
            current = creator;
        }
        is_behind
    }

    fn evaluates_inner_module(&self, expression: ExprId, call: &Call) -> bool {
        if !call.args.is_empty() || self.input.modules.inner_modules(self.input.file).is_empty() {
            return false;
        }
        match self.input.modules.site(self.input.file, expression) {
            Some(Site::Evaluate { target, .. }) => matches!(target, ModuleRef::Inner { .. }),
            Some(Site::AsToday) | None => false,
        }
    }

    fn is_bound_module_call(&self, expression: ExprId, call: &Call) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let analysis = &self.input.compiled.analysis;
        if !matches!(hir[expression].kind, ExprKind::Call(_)) {
            return false;
        }
        let Some(site) = analysis.import_site_of_call(expression) else {
            return false;
        };
        let site = analysis.import_sites[site];
        let is_spread = |argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_));
        if hir.ids(call.args).any(is_spread) {
            return false;
        }
        let require_call = match site.kind {
            ImportSiteKind::Require(_) => {
                find_require_call(hir, bound, Some(self.decisions), call.callee, call.args)
            }
            _ => None,
        };
        let given = match require_call {
            Some(found) => match found.form {
                RequireCallForm::Direct => found.args,
                RequireCallForm::Call | RequireCallForm::Apply => return false,
            },
            None => call.args,
        };
        let modules = self.input.modules;
        let Some(answer) = modules.find_site_answer(self.input.file, site.kind) else {
            return false;
        };
        has_module_operation(&site, answer, given.len()) && self.is_bound_module_callee(call.callee)
    }

    fn is_bound_module_callee(&self, callee: ExprId) -> bool {
        let (hir, bound, builtins) = (self.hir, self.bound, self.input.builtins);
        let callee = hir.skip_type_assertions(callee);
        let Some(Resolved::Builtin(_)) = builtins.of_expr(callee) else {
            return false;
        };
        let printed_as_require = find_module_printed_as_require(hir, bound, callee);
        let root = match hir.member_key(callee) {
            Some((object, _)) if printed_as_require.is_none() => hir.skip_type_assertions(object),
            _ => callee,
        };
        let Some(Resolved::Builtin(root_path)) = builtins.of_expr(root) else {
            return false;
        };
        let name = printed_as_require.unwrap_or(root);
        matches!(hir[name].kind, ExprKind::Ident(_))
            && matches!(bound.binding(name), Binding::CommonJs(_))
            && bound.dynamic_lookup_scope(NodeData::Expr(name)).is_none()
            && table::entry(root_path.id).scope == Scope::Module
            && root_path.mutability == Mutability::AlwaysLocked
            && !(root != callee
                && root_path.id == BuiltinId::ModuleRequire
                && may_require_get_members(hir, bound))
    }

    fn record_argument_read(&mut self, call: &Call, context: Context) {
        let callee = self.hir.skip_type_assertions(call.callee);
        let read = match self.input.builtins.of_expr(callee) {
            Some(Resolved::Intrinsic(Intrinsic::ArgumentCount)) => Some(ArgumentRead::Count),
            Some(Resolved::Intrinsic(Intrinsic::Argument)) => {
                parameters::literal_argument_position(self.hir, call).map(ArgumentRead::At)
            }
            Some(_) | None => None,
        };
        let read = read.map(|read| (context.function, read));
        self.walk.argument_reads.extend(read);
    }

    fn visit_jsx(&mut self, expression: ExprId, jsx: JsxId, context: Context) {
        let hir = self.hir;
        let callee = jsx_callee(hir, self.input.compiled.jsx_mode, jsx);
        if callee == JsxCallee::Import(JsxImport::JsxDev) {
            self.use_this(context);
        }
        for binding in bindings_of(&self.jsx_uses, expression) {
            self.note_binding_is_looked_at(binding);
            self.record_binding_use(context, binding, false);
        }
        let key_argument = find_key_argument(hir, callee, jsx);
        let jsx = hir[jsx];
        self.push_expressions([jsx.tag], context);
        for attribute in jsx.attrs.iter() {
            if Some(attribute) == key_argument {
                continue;
            }
            if let PropKey::Computed(key) = hir.runtime_property_key(attribute) {
                self.push_expressions([key], context);
            }
            self.push_expressions([hir[attribute].value], context);
        }
        self.push_expressions(hir.ids(jsx.children), context);
        self.push_expressions(key_argument.map(|key| hir[key].value), context);
    }

    fn record_private_name(&mut self, reference: ExprId, context: Context) {
        let (hir, bound, function) = (self.hir, self.bound, context.function);
        let Some(id) = bound.private_name_of_reference(reference) else {
            return;
        };
        let name = *bound.private_name(id);
        let scope = bound.class_scope[name.class.idx()];
        let brand = if name.is_static {
            ClassSlot::ClassObject
        } else {
            ClassSlot::ClassToken
        };
        self.record_slot_use(function, scope, ScopeSlot::Class(brand));
        let (functions, field): ([Option<MemberId>; 2], Option<MemberId>) = match name.members {
            PrivateMembers::Field(member) => ([None, None], Some(member)),
            PrivateMembers::Method(member) => ([Some(member), None], None),
            PrivateMembers::Accessor { getter, setter } => ([getter, setter], None),
            PrivateMembers::AutoAccessor(member) => {
                let is_decorated = class::has_decorators(hir, hir[member].modifiers);
                ([is_decorated.then_some(member), None], Some(member))
            }
        };
        let functions = functions.into_iter().flatten();
        let functions = functions.map(ClassSlot::PrivateMethod);
        let field = field.filter(|&member| class::has_private_static_storage(hir, member));
        for slot in functions.chain(field.map(ClassSlot::StaticField)) {
            self.record_slot_use(function, scope, ScopeSlot::Class(slot));
        }
    }

    fn declaring_scope(&self, binding: Binding) -> ScopeId {
        match binding {
            Binding::Symbol(symbol) => self.bound.symbol_scope(symbol),
            Binding::Arguments(CodeUnit::File) if !self.walk.has_wrapper_parameters => {
                ScopeId::NONE
            }
            Binding::Arguments(owner) => self.bound.top_scope(self.hir, owner),
            Binding::CommonJs(_) | Binding::Free => ScopeId::NONE,
        }
    }

    pub(super) fn visit_pattern(&mut self, pattern: PatId, role: PatternRole, context: Context) {
        let hir = self.hir;
        let mut initialized: SmallVec<[SymbolId; 4]> = SmallVec::new();
        let mut pending: SmallVec<[TreeNode; 8]> = SmallVec::new();
        pending.extend(pattern.some().map(TreeNode::Pattern));
        while let Some(node) = pending.pop() {
            let pattern = match node {
                TreeNode::Pattern(pattern) => pattern,
                TreeNode::Expr(expression) => {
                    self.push_expressions([expression], context);
                    continue;
                }
                TreeNode::Stmt(_) | TreeNode::Function(_) | TreeNode::Class(_) => {
                    debug_assert!(false, "a pattern holds patterns and expressions");
                    continue;
                }
            };
            let first_part = pending.len();
            match hir[pattern].kind {
                PatKind::Ident(_) => {
                    match role {
                        PatternRole::UnstoredVar => continue,
                        PatternRole::StoredVar => self.record_declarator_store(pattern, context),
                        PatternRole::LexicalDeclaration | PatternRole::Parameter => {}
                    }
                    match self.bound.initialized_binding(pattern) {
                        Binding::Symbol(symbol) => initialized.push(symbol),
                        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {}
                    }
                }
                PatKind::Missing => {}
                PatKind::Object(properties) => {
                    for property in properties.iter() {
                        if let PropKey::Computed(key) = hir.runtime_binding_key(property) {
                            pending.push(TreeNode::Expr(key));
                        }
                        pending.push(TreeNode::Expr(hir[property].default));
                        pending.extend(hir[property].value.some().map(TreeNode::Pattern));
                    }
                }
                PatKind::Array(elements) => {
                    for element in elements.iter() {
                        pending.push(TreeNode::Expr(hir[element].default));
                        pending.extend(hir[element].pat.some().map(TreeNode::Pattern));
                    }
                }
            }
            pending[first_part..].reverse();
        }
        let initialize: fn(SymbolId) -> Task = match role {
            PatternRole::Parameter => Task::InitializeParameter,
            PatternRole::UnstoredVar | PatternRole::StoredVar | PatternRole::LexicalDeclaration => {
                Task::InitializeSymbol
            }
        };
        for symbol in initialized {
            self.push_task(initialize(symbol), context);
        }
    }

    fn record_declarator_store(&mut self, name: PatId, context: Context) {
        let bound = self.bound;
        let binding = bound.initialized_binding(name);
        match binding {
            Binding::Symbol(symbol) => self.record_store(context, BindingRef::Symbol(symbol)),
            Binding::Arguments(owner) => self.use_arguments_binding(owner, true, context),
            Binding::CommonJs(_) | Binding::Free => {}
        }
        if let Some(start) = bound.dynamic_lookup_scope(NodeData::Pat(name)) {
            let declaring_scope = self.declaring_scope(binding);
            let search = ScopeObjectSearch {
                start,
                until: declaring_scope,
                declaring_scope,
                pos: self.hir[name].pos,
                asks_with_objects_alone: false,
            };
            self.record_scope_objects(context.function, search);
        }
    }
}
