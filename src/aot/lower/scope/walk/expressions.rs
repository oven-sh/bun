use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, CodeUnit, CommonJsVariable, PrivateMembers, ScopeId, SymbolId};
use bun_sema::fold::{Decision, TreeNode};
use bun_sema::hir::{
    Call, CallId, ExprId, ExprKind, FnId, JsxId, MemberId, NodeData, PatId, PatKind, PropId,
    PropKey, PropKind, Span, is_proto_setter,
};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, JsxCallee, JsxImport, RequireCallForm,
    find_module_printed_as_require, find_require_call, jsx_callee, may_require_get_members,
};
use smallvec::SmallVec;

use super::walker::bindings_of;
use super::{ArgumentRead, Context, PatternRole, Task, Walker};
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Scope};
use crate::builtins::{Intrinsic, Mutability, Resolved};
use crate::ir::ClassSlot;
use crate::lower::jsx::find_key_argument;
use crate::lower::scope::lexical_owners::ScopeObjectSearch;
use crate::lower::scope::{BindingRef, ScopeSlot};
use crate::lower::{class, parameters};
use crate::modules::{Member, ModuleRef, Site, SiteAnswer};

// What `try_lower_module_call` asks before it looks at the callee.
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
            SiteAnswer::Module(_) => site.consults_resolver && argument_count == 1,
            SiteAnswer::Computed(_) | SiteAnswer::Failed(_) | SiteAnswer::Erased => false,
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
            _ => return,
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
            // The store is made when the operands have been evaluated.
            ExprKind::Unary { operand, .. } => self.push_operands_of_store([operand], context),
            // A pattern runs its keys, its targets and its defaults when the value has been evaluated.
            ExprKind::Assign { target, value, .. } if self.is_assignment_pattern(target) => {
                self.push_operands_of_store([value, target], context);
            }
            ExprKind::Assign { target, value, .. } => {
                self.push_operands_of_store([target, value], context);
            }
            ExprKind::Fn(function) => self.visit_function(function, context.function),
            ExprKind::Object(properties) => {
                self.note_halves_of_accessors(properties);
                self.push_evaluated_children(expression, context);
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

    fn note_halves_of_accessors(&mut self, properties: Span<PropId>) {
        let hir = self.hir;
        let kinds = properties.iter().map(|property| hir[property].kind);
        let accessors = kinds.filter(|kind| matches!(kind, PropKind::Getter | PropKind::Setter));
        if accessors.count() < 2 {
            return;
        }
        let mut last_halves: SmallVec<[(Atom, FnId); 4]> = SmallVec::new();
        for property in properties.iter() {
            let prop = hir[property];
            match (prop.kind, hir.runtime_property_key(property)) {
                (PropKind::Getter | PropKind::Setter, PropKey::Name(name)) => {
                    let ExprKind::Fn(half) = hir[prop.value].kind else {
                        unreachable!("the value of a getter or setter is a function");
                    };
                    let Some(last) = last_halves.iter_mut().find(|last| last.0 == name) else {
                        last_halves.push((name, half));
                        continue;
                    };
                    self.halves_in_front.resize(hir.fns.len(), FnId::NONE);
                    self.halves_in_front[half.idx()] = last.1;
                    last.1 = half;
                }
                (PropKind::Init, _) if is_proto_setter(&prop) => {}
                (PropKind::Init | PropKind::Shorthand | PropKind::Method, PropKey::Name(name)) => {
                    last_halves.retain(|last| last.0 != name);
                }
                _ => last_halves.clear(),
            }
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

    fn visit_identifier(&mut self, identifier: ExprId, context: Context) {
        self.visit_name(identifier, self.bound.binding(identifier), context);
    }

    // The binding is read, or stored to, where `identifier` stands.
    fn visit_name(&mut self, identifier: ExprId, binding: Binding, context: Context) {
        let (bound, function) = (self.bound, context.function);
        if let (Binding::Symbol(symbol), true) = (binding, bound.is_store_target(identifier)) {
            self.walk.symbol_stores.push((symbol, identifier, function));
            self.walk.last_store_times[symbol.idx()] = u32::MAX;
            self.pending_stores.push(symbol);
        }
        self.record_binding_use(context, binding, bound.is_store_target(identifier));
        if let Some(start) = bound.dynamic_lookup_scope(NodeData::Expr(identifier)) {
            let declaring_scope = self.declaring_scope(binding);
            let search = ScopeObjectSearch {
                start,
                until: bound.dynamic_lookup_end(identifier, declaring_scope),
                declaring_scope,
                pos: self.hir[identifier].pos,
            };
            self.record_scope_objects(function, search);
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
        if let Some(module) = find_module_printed_as_require(self.hir, self.bound, access) {
            let require = Binding::CommonJs(CommonJsVariable::Require);
            self.visit_name(module, require, context);
            return;
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

    // `exports.a` and `module.exports.a` in the callback of `__commonJS((exports, module) => { .. })`, where `a` is a variable of the module.
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
            // Else the lowering emits the load of the module and never reads the callee.
            let loads_module = self.evaluates_inner_module(expression, &call)
                || (self.walk.has_wrapper_parameters
                    && self.is_bound_module_call(expression, &call));
            if !loads_module {
                self.push_expressions([call.callee], context);
            }
        }
        self.push_expressions(self.hir.ids(call.args), context);
        if binds_this_for_what_follows {
            let scope = context.lexical_scope;
            self.push_task(Task::InitializeSlot(scope, ScopeSlot::This), context);
        }
    }

    // `require_a()`, where `var require_a = __commonJS(cb)`.
    fn evaluates_inner_module(&self, expression: ExprId, call: &Call) -> bool {
        if !call.args.is_empty() || self.input.modules.inner_modules(self.input.file).is_empty() {
            return false;
        }
        match self.input.modules.site(self.input.file, expression) {
            Some(Site::Evaluate { target, .. }) => matches!(target, ModuleRef::Inner { .. }),
            Some(Site::AsToday) | None => false,
        }
    }
    // `require("./a")`, `require.resolve("./a")`, `module.require("./a")` in a file that keeps the five names as parameters, where nothing can put another value behind the name.
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

    // The keys and the defaults are pushed in the order in which they run: what belongs to an inner pattern runs before what follows that pattern in the outer one.
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
            };
            self.record_scope_objects(context.function, search);
        }
    }
}
