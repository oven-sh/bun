use bun_sema::bind::{Binding, CodeUnit, PrivateMembers, ScopeId, SymbolId};
use bun_sema::fold::Decision;
use bun_sema::hir::{
    Call, CallId, ExprId, ExprKind, JsxId, MemberId, NodeData, PatId, PatKind, PropKey,
};
use bun_sema::import_sites::{
    ImportSite, ImportSiteKind, JsxCallee, JsxImport, RequireCallForm, find_require_call,
    jsx_callee,
};
use smallvec::SmallVec;

use super::walker::bindings_of;
use super::{ArgumentRead, Context, PatternRole, Task, Walker};
use crate::builtins::table::{self, Scope};
use crate::builtins::{Intrinsic, Mutability, Resolved};
use crate::ir::ClassSlot;
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
            ExprKind::Unary { .. } | ExprKind::Assign { .. } => {
                let first_pending = self.pending_stores.len() as u32;
                self.push_evaluated_children(expression, context);
                self.push_task(Task::EndStores { first_pending }, context);
            }
            ExprKind::Fn(function) => self.visit_function(function, context.function),
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

    fn visit_identifier(&mut self, identifier: ExprId, context: Context) {
        let (bound, function) = (self.bound, context.function);
        let binding = bound.binding(identifier);
        if let (Binding::Symbol(symbol), true) = (binding, bound.is_store_target(identifier)) {
            self.walk.symbol_stores.push((symbol, identifier, function));
            self.walk.last_store_times[symbol.idx()] = u32::MAX;
            self.pending_stores.push(symbol);
        }
        self.record_binding_use(context, binding, bound.is_store_target(identifier));
        if let Some(from) = bound.dynamic_lookup_scope(NodeData::Expr(identifier)) {
            self.record_scope_chain(function, from, self.declaring_scope(binding));
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
        if matches!(self.hir[call.callee].kind, ExprKind::Super) {
            let scope = context.lexical_scope;
            self.use_this(context);
            self.use_new_target(context);
            self.record_slot_store(context, scope, ScopeSlot::This);
            match self.bound.code_unit(scope) {
                CodeUnit::Function(constructor) => {
                    self.record_slot_use(context.function, scope, ScopeSlot::Callee);
                    let reference = (context.function, constructor);
                    self.walk.function_references.push(reference);
                }
                CodeUnit::File | CodeUnit::FieldInitializer(_) => {}
            }
        } else {
            if let Some(&eval) = self.bound.eval_scope(expression) {
                self.visit_direct_eval(eval, context);
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
        let root = match hir.member_key(callee) {
            Some((object, _)) => hir.skip_type_assertions(object),
            None => callee,
        };
        let Some(Resolved::Builtin(root_path)) = builtins.of_expr(root) else {
            return false;
        };
        matches!(hir[root].kind, ExprKind::Ident(_))
            && matches!(bound.binding(root), Binding::CommonJs(_))
            && bound.dynamic_lookup_scope(NodeData::Expr(root)).is_none()
            && table::entry(root_path.id).scope == Scope::Module
            && root_path.mutability == Mutability::AlwaysLocked
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
        let jsx = hir[jsx];
        self.push_expressions([jsx.tag], context);
        for attribute in jsx.attrs.iter() {
            if let PropKey::Computed(key) = hir.runtime_property_key(attribute) {
                self.push_expressions([key], context);
            }
            self.push_expressions([hir[attribute].value], context);
        }
        self.push_expressions(hir.ids(jsx.children), context);
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
        let mut pending: SmallVec<[PatId; 8]> = pattern.some().into_iter().collect();
        while let Some(pattern) = pending.pop() {
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
                            self.push_expressions([key], context);
                        }
                        self.push_expressions([hir[property].default], context);
                        pending.extend(hir[property].value.some());
                    }
                }
                PatKind::Array(elements) => {
                    for element in elements.iter() {
                        self.push_expressions([hir[element].default], context);
                        pending.extend(hir[element].pat.some());
                    }
                }
            }
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
        if let Some(from) = bound.dynamic_lookup_scope(NodeData::Pat(name)) {
            self.record_scope_chain(context.function, from, self.declaring_scope(binding));
        }
    }
}
