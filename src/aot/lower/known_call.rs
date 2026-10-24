use bun_sema::atom::Atom;
use bun_sema::bind::{
    Binding, BindingInitializer, Decl, InitialState, Parent, ScopeId, StoreKind, SymbolId,
};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{
    BinOp, Call, Chain, ExprId, ExprKind, FnBody, FnId, MemberKey, PatKind, StmtId, StmtKind, UnOp,
};
use bun_sema::program::FileId;
use smallvec::SmallVec;

use super::call::{Arguments, Callee};
use super::captures::Capture;
use super::expression::Tail;
use super::member::PropertyName;
use super::scope::{BindingForm, BindingRef, Storage};
use super::{FileLowering, FunctionLowering, module};
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, Edge, FunctionId, FunctionKey, TypeTable, ValueId};
use crate::known_helpers::{
    HeldFunction, Helper, KnownCallee, PrivateFieldAccess, PrivateMemberKind, PrivateStateKind,
    PrivateStateRole, PrivateStateSite, ResolveInput, ResolvedReference, Shape, resolve_callee,
    resolve_private_field_call, resolve_reference,
};
use crate::statistics::StatisticId;

#[derive(Copy, Clone)]
pub(in crate::lower) struct PrivateStateAccess {
    pub(in crate::lower) state: SymbolId,
    pub(in crate::lower) collection: ValueId,
    pub(in crate::lower) object: ValueId,
}

struct LoweredCall {
    call: ExprId,
    callee: Callee,
    arguments: SmallVec<[ValueId; 4]>,
    slow_path: BlockId,
}

// An expression of a helper's text and the built-in that it names.
pub(in crate::lower) type BuiltinPathExpr = (ExprId, BuiltinId);

struct ExportStarPlan {
    create_binding: ResolvedReference,
    getter: FnId,
    reuses_descriptors: bool,
    key_is_first_capture: bool,
    has_own_property: BuiltinPathExpr,
    call_name: Atom,
    create_binding_builtins: SmallVec<[BuiltinPathExpr; 2]>,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn try_lower_known_call(&mut self, call: ExprId) -> Option<ValueId> {
        let helpers = self.file.inputs.known_helpers;
        if !helpers.has_bindings() {
            return None;
        }
        let hir = self.file.hir;
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let site = hir[id];
        let (files, modules) = (self.file.queries.files(), self.file.inputs.modules);
        let states = helpers.private_states(files, modules, self.file.file);
        if let Some(state) = states.and_then(|states| states.site(call)) {
            return match state.role {
                PrivateStateRole::Definition => {
                    self.lower_private_state_definition(call, site, state)
                }
                PrivateStateRole::HelperArgument => {
                    self.lower_private_field_access(call, site, state)
                }
            };
        }
        if !is_plain_call(self.file, site) {
            return None;
        }
        let callee = resolve_callee(&resolve_input(self.file), self.file.file, site.callee)?;
        if !is_lowered(self.file, callee.file) {
            return None;
        }
        match callee.helper(helpers)? {
            Helper::ExportStar => self.lower_export_star(call, site, &callee),
            Helper::ClassPrivateFieldGet | Helper::ClassPrivateFieldIn => {
                self.lower_static_member_access(call, site)
            }
            _ => None,
        }
    }

    pub(in crate::lower) fn emit_export_star_fast_path(&mut self, export_star: FnId) {
        let Some(plan) = self.file.plan_export_star(export_star) else {
            return;
        };
        if plan.create_binding.needs_guard && !self.is_readable(plan.create_binding.symbol) {
            return;
        }
        let source = self.file.find_parameter(export_star, 0);
        let target = self.file.find_parameter(export_star, 1);
        let (Some(source), Some(target)) = (source, target) else {
            return;
        };
        let slow_path = self.create_unlikely_block();
        let source = self.get_binding(Binding::Symbol(source.0), source.1);
        let target = self.get_binding(Binding::Symbol(target.0), target.1);
        self.emit_export_star(&plan, target, source, slow_path);
        self.emit_empty_return();
        self.continue_in(slow_path);
    }

    fn lower_call_operands(&mut self, call: ExprId, site: Call) -> LoweredCall {
        let callee = self.lower_callee(site.callee, None, None);
        let Arguments::Values(arguments) = self.lower_arguments(site.args) else {
            unreachable!("a call with a spread argument is not a known call");
        };
        self.set_position(self.file.hir[call].pos);
        LoweredCall {
            call,
            callee,
            arguments,
            slow_path: self.create_unlikely_block(),
        }
    }

    fn finish_with_slow_path(&mut self, lowered: LoweredCall, fast_result: ValueId) -> ValueId {
        self.file.count(StatisticId::KnownHelperCalls, 1);
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        self.builder.write_variable(result, fast_result);
        self.jump(done);

        self.continue_in(lowered.slow_path);
        let arguments = Arguments::Values(lowered.arguments);
        let returned = self.emit_call_expression(lowered.call, lowered.callee, arguments, Tail::No);
        self.builder.write_variable(result, returned);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(result)
    }

    pub(in crate::lower) fn emit_guard(&mut self, condition: ValueId, slow_path: BlockId) {
        let passed = self.create_block();
        self.builder
            .branch(condition, Edge::to(passed), Edge::to(slow_path));
        self.continue_in(passed);
    }

    fn guard_closure(&mut self, value: ValueId, home: FileId, function: FnId, slow_path: BlockId) {
        let function = reference_function(self.file, home, function);
        let is_closure = self.builder.is_closure_of(function, value);
        self.emit_guard(is_closure, slow_path);
    }

    fn guard_builtin(&mut self, value: ValueId, builtin: BuiltinId, slow_path: BlockId) {
        let builtin = self.emit_locked_builtin(builtin);
        let is_unchanged = self.builder.strict_eq(value, builtin);
        self.emit_guard(is_unchanged, slow_path);
    }

    // A fast path stands in for calls of built-ins, and the program may have put other functions in their places.
    pub(in crate::lower) fn guard_builtin_path(
        &mut self,
        (path, builtin): BuiltinPathExpr,
        slow_path: BlockId,
    ) -> ValueId {
        let value = self.lower_expression(path);
        self.guard_builtin(value, builtin, slow_path);
        value
    }

    fn guard_callee(&mut self, lowered: &LoweredCall, callee: &KnownCallee, held: HeldFunction) {
        if callee.needs_guard() {
            let function = lowered.callee.function;
            self.guard_closure(function, callee.file, held.closure, lowered.slow_path);
        }
    }

    fn is_enclosing_scope(&self, scope: ScopeId) -> bool {
        let bound = self.file.bound;
        let innermost = self.innermost_scope();
        let mut current = innermost;
        while current.is_some() && bound.code_unit(current) == bound.code_unit(innermost) {
            if current == scope {
                return true;
            }
            current = bound.scopes[current.idx()].parent;
        }
        false
    }

    // The source text at this point may not mention the symbol, so capture analysis may not have made it available here.
    fn is_readable(&self, symbol: SymbolId) -> bool {
        let file = &*self.file;
        let binding = BindingRef::Symbol(symbol);
        if file.scopes.form(symbol) != BindingForm::Stored
            || file.bound.initial_state(symbol) == InitialState::Uninitialized
        {
            return false;
        }
        if self.find_captured_value(Capture::Value(binding)).is_some() {
            return true;
        }
        let placement = file.scopes.placement(binding);
        match placement.map(|placement| placement.storage) {
            Some(Storage::Variable(_)) => true,
            Some(Storage::Field { scope, .. }) => {
                let captured = self.find_captured_value(Capture::Environment(scope));
                captured.is_some() || self.is_enclosing_scope(scope)
            }
            Some(Storage::Local) => {
                let declaring = file.bound.symbol_scope(symbol).some();
                let declaring = declaring.unwrap_or_else(|| module::file_scope(file));
                self.scopes.find_local(binding).is_some() && self.is_enclosing_scope(declaring)
            }
            None => false,
        }
    }

    fn emit_export_star(
        &mut self,
        plan: &ExportStarPlan,
        target: ValueId,
        source: ValueId,
        slow_path: BlockId,
    ) {
        let position = self.position();
        let file = self.file.file;
        if plan.create_binding.needs_guard {
            let held = self.get_stored(BindingRef::Symbol(plan.create_binding.symbol));
            self.guard_closure(held, file, plan.create_binding.function.closure, slow_path);
        }
        let has_own_property = self.guard_builtin_path(plan.has_own_property, slow_path);
        let key = self.file.name_key(plan.call_name);
        let call = self.emit_get(has_own_property, PropertyName::Constant(key));
        self.guard_builtin(call, BuiltinId::FunctionPrototypeCall, slow_path);
        for &expected in &plan.create_binding_builtins {
            self.guard_builtin_path(expected, slow_path);
        }
        self.set_position(position);
        let getter = reference_function(self.file, file, plan.getter);
        let is_done = self.builder.try_re_export_fields(
            target,
            source,
            getter,
            plan.reuses_descriptors,
            plan.key_is_first_capture,
        );
        self.emit_guard(is_done, slow_path);
    }

    fn lower_export_star(
        &mut self,
        call: ExprId,
        site: Call,
        callee: &KnownCallee,
    ) -> Option<ValueId> {
        if callee.file != self.file.file || site.args.len() != 2 {
            return None;
        }
        let mut candidates = callee.functions.iter();
        let (held, plan) = candidates
            .find_map(|&held| Some((held, self.file.plan_export_star(held.definition)?)))?;
        if plan.create_binding.needs_guard && !self.is_readable(plan.create_binding.symbol) {
            return None;
        }
        let lowered = self.lower_call_operands(call, site);
        self.guard_callee(&lowered, callee, held);
        let (source, target) = (lowered.arguments[0], lowered.arguments[1]);
        self.emit_export_star(&plan, target, source, lowered.slow_path);
        let undefined = self.builder.undefined();
        Some(self.finish_with_slow_path(lowered, undefined))
    }

    fn lower_private_state_definition(
        &mut self,
        call: ExprId,
        site: Call,
        state: PrivateStateSite,
    ) -> Option<ValueId> {
        let (method, argument_count) = match state.kind {
            PrivateStateKind::Field => (BuiltinId::WeakMapPrototypeSet, 2),
            PrivateStateKind::Brand => (BuiltinId::WeakSetPrototypeAdd, 1),
        };
        let callee = self.file.skip_type_syntax(site.callee);
        if !is_plain_call(self.file, site)
            || site.args.len() != argument_count
            || self.file.hir.member_key(callee).is_none()
        {
            return None;
        }
        let lowered = self.lower_call_operands(call, site);
        let Some(collection) = lowered.callee.this else {
            unreachable!("a member callee has a receiver");
        };
        let object = lowered.arguments[0];
        let is_object = self.builder.type_test(object, TypeTable::OBJECT);
        self.emit_guard(is_object, lowered.slow_path);
        let access = PrivateStateAccess {
            state: state.state,
            collection,
            object,
        };
        let value = lowered.arguments.get(1).copied();
        let has_entry = self.emit_state_test(access);
        let update = self.create_block();
        let insert = self.create_block();
        let merge = self.create_block();
        self.builder
            .branch(has_entry, Edge::to(update), Edge::to(insert));

        self.continue_in(update);
        if let Some(value) = value {
            self.emit_state_set(access, value);
        }
        self.jump(merge);

        self.continue_in(insert);
        self.guard_builtin(lowered.callee.function, method, lowered.slow_path);
        self.emit_state_definition(access, value);
        self.jump(merge);

        self.continue_in(merge);
        Some(self.finish_with_slow_path(lowered, collection))
    }

    // Returning None here would pass the helper a collection that is missing the entries stored in fields.
    fn lower_private_field_access(
        &mut self,
        call: ExprId,
        site: Call,
        state: PrivateStateSite,
    ) -> Option<ValueId> {
        let helper_call =
            resolve_private_field_call(&resolve_input(self.file), self.file.file, call);
        let helper_call = helper_call.filter(|it| it.supports_private_state(state.kind));
        let helper_call = helper_call.expect("private_state only accepts supported helper calls");
        let kind = helper_call.access(state.kind);
        let kind = kind.expect("a supported helper call has an access kind");
        let callee = &helper_call.callee;
        if !is_lowered(self.file, callee.file) {
            return None;
        }
        let lowered = self.lower_call_operands(call, site);
        self.guard_callee(&lowered, callee, callee.functions[0]);
        let access = PrivateStateAccess {
            state: state.state,
            collection: lowered.arguments[helper_call.state],
            object: lowered.arguments[helper_call.receiver],
        };
        let has_entry = self.emit_state_test(access);
        self.emit_guard(has_entry, lowered.slow_path);
        let result = match kind {
            PrivateFieldAccess::Get => self.emit_state_get(access),
            PrivateFieldAccess::Set { value } => {
                self.emit_state_set(access, lowered.arguments[value]);
                lowered.arguments[value]
            }
            PrivateFieldAccess::GetMethod { member } => lowered.arguments[member],
            PrivateFieldAccess::Has => self.builder.boolean(true),
        };
        Some(self.finish_with_slow_path(lowered, result))
    }

    fn lower_static_member_access(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        let helper_call =
            resolve_private_field_call(&resolve_input(self.file), self.file.file, call)?;
        let (helper, kind) = (helper_call.helper, helper_call.member_kind);
        let member = match (helper, kind, helper_call.member) {
            (Helper::ClassPrivateFieldGet, PrivateMemberKind::Method, Some(member)) => Some(member),
            (Helper::ClassPrivateFieldIn, _, _) => None,
            _ => return None,
        };
        let state = self.file.hir.id_at(site.args, helper_call.state);
        if !self.file.may_hold_class(state) {
            return None;
        }
        let lowered = self.lower_call_operands(call, site);
        let callee = &helper_call.callee;
        self.guard_callee(&lowered, callee, callee.functions[0]);
        let slow_path = lowered.slow_path;
        let object = lowered.arguments[helper_call.receiver];
        let class = lowered.arguments[helper_call.state];
        let is_class = self.builder.type_test(class, TypeTable::FUNCTION);
        self.emit_guard(is_class, slow_path);
        let result = match member {
            Some(member) => {
                let is_receiver = self.builder.strict_eq(object, class);
                self.emit_guard(is_receiver, slow_path);
                let is_declared = self.builder.to_boolean(lowered.arguments[member]);
                self.emit_guard(is_declared, slow_path);
                lowered.arguments[member]
            }
            None => {
                let is_object = self.builder.type_test(object, TypeTable::OBJECT);
                self.emit_guard(is_object, slow_path);
                self.builder.strict_eq(object, class)
            }
        };
        Some(self.finish_with_slow_path(lowered, result))
    }
}

fn resolve_input<'x, 's>(file: &'x FileLowering<'_, '_, '_, 's>) -> ResolveInput<'x, 's> {
    ResolveInput {
        files: file.queries.files(),
        modules: file.inputs.modules,
        helpers: file.inputs.known_helpers,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn resolves_to_builtin(&self, (path, builtin): BuiltinPathExpr) -> bool {
        match self.builtins.of_expr(path) {
            Some(Resolved::Builtin(path)) => path.id == builtin,
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => false,
        }
    }

    pub(in crate::lower) fn find_parameter(
        &self,
        function: FnId,
        index: usize,
    ) -> Option<(SymbolId, Atom)> {
        let (hir, bound) = (self.hir, self.bound);
        let pattern = hir[hir[function].params.iter().nth(index)?].pat;
        let PatKind::Ident(name) = hir[pattern].kind else {
            return None;
        };
        Some((bound.declared_symbol(Decl::Param(pattern)).some()?, name))
    }

    // for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
    fn find_has_own_property(&self, export_star: FnId) -> Option<(BuiltinPathExpr, Atom)> {
        let hir = self.hir;
        let [for_in] = find_statements(self, export_star)[..] else {
            return None;
        };
        let StmtKind::ForIn { body, .. } = hir[for_in].kind else {
            return None;
        };
        let StmtKind::If { test, .. } = hir[body].kind else {
            return None;
        };
        let ExprKind::Binary {
            op: BinOp::And,
            right,
            ..
        } = hir[self.skip_type_syntax(test)].kind
        else {
            return None;
        };
        let ExprKind::Unary {
            op: UnOp::Not,
            operand,
        } = hir[self.skip_type_syntax(right)].kind
        else {
            return None;
        };
        let callee = find_callee(self, operand)?;
        let (function, MemberKey::Name(call_name)) = hir.member_key(callee)? else {
            return None;
        };
        let call = (callee, BuiltinId::FunctionPrototypeCall);
        let function = self.skip_type_syntax(function);
        let has_own_property = (function, BuiltinId::ObjectPrototypeHasOwnProperty);
        let is_resolved =
            self.resolves_to_builtin(call) && self.resolves_to_builtin(has_own_property);
        is_resolved.then_some((has_own_property, call_name))
    }

    // The built-ins that `__createBinding` calls, and the call that defines the property.
    pub(in crate::lower) fn find_create_binding_builtins(
        &self,
        create_binding: FnId,
        shape: Shape,
    ) -> Option<(SmallVec<[BuiltinPathExpr; 2]>, ExprId)> {
        let mut builtins = SmallVec::new();
        let define = match (shape, &find_statements(self, create_binding)[..]) {
            (Shape::CreateBindingReusesDescriptor, &[_, describe, _, define]) => {
                let describe = find_first_initializer(self, describe)?;
                let describe = find_callee(self, describe)?;
                builtins.push((describe, BuiltinId::ObjectGetOwnPropertyDescriptor));
                define
            }
            (Shape::CreateBindingDefinesGetter, &[_, define]) => define,
            _ => return None,
        };
        let StmtKind::Expr(define) = self.hir[define].kind else {
            return None;
        };
        let path = find_callee(self, define)?;
        builtins.push((path, BuiltinId::ObjectDefineProperty));
        let mut paths = builtins.iter();
        let is_resolved = paths.all(|&expected| self.resolves_to_builtin(expected));
        is_resolved.then_some((builtins, define))
    }

    fn plan_export_star(&self, export_star: FnId) -> Option<ExportStarPlan> {
        let helpers = self.inputs.known_helpers;
        let known = helpers.function(self.file, export_star)?;
        if known.shape != Shape::ExportStarBindsNamesTheTargetLacks {
            return None;
        }
        let [reference] = known.references[..] else {
            return None;
        };
        let create_binding =
            resolve_reference(&resolve_input(self), self.file, reference, &|shape| {
                matches!(
                    shape,
                    Shape::CreateBindingDefinesGetter | Shape::CreateBindingReusesDescriptor
                )
            })?;
        let known_binding = helpers.function(self.file, create_binding.function.definition)?;
        let shape = known_binding.shape;
        let [definition, getter] = known_binding.functions[..] else {
            return None;
        };
        let (has_own_property, call_name) = self.find_has_own_property(export_star)?;
        Some(ExportStarPlan {
            create_binding,
            getter,
            reuses_descriptors: shape == Shape::CreateBindingReusesDescriptor,
            key_is_first_capture: is_key_first_capture(self, definition, getter)?,
            has_own_property,
            call_name,
            create_binding_builtins: self.find_create_binding_builtins(definition, shape)?.0,
        })
    }

    fn is_new_expression(&self, value: ExprId) -> bool {
        let value = self.skip_type_syntax(value);
        matches!(self.hir[value].kind, ExprKind::New(_))
    }

    fn may_hold_class(&self, state: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let state = self.skip_type_syntax(state);
        if !matches!(hir[state].kind, ExprKind::Ident(_)) {
            return true;
        }
        let Binding::Symbol(symbol) = bound.binding(state) else {
            return true;
        };
        if let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol)
            && self.is_new_expression(value)
        {
            return false;
        }
        !bound.stores_to(symbol).iter().any(|store| {
            let Parent::Expr(assignment) = bound.parent_of_expr(store.target) else {
                return false;
            };
            let ExprKind::Assign { value, .. } = hir[assignment].kind else {
                return false;
            };
            store.kind == StoreKind::Assign && self.is_new_expression(value)
        })
    }
}

fn is_lowered(file: &FileLowering<'_, '_, '_, '_>, home: FileId) -> bool {
    file.inputs.files[home.idx()].is_some()
}

fn is_plain_call(file: &FileLowering<'_, '_, '_, '_>, site: Call) -> bool {
    let hir = file.hir;
    let mut arguments = hir.ids(site.args);
    matches!(site.chain, Chain::No)
        && !arguments.any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
}

fn reference_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    home: FileId,
    function: FnId,
) -> FunctionId {
    file.reference_function(FunctionKey::Source(FunctionRef {
        file: home,
        function,
    }))
}

fn find_statements(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> SmallVec<[StmtId; 8]> {
    match file.hir[function].body {
        FnBody::Block(statements) => file.hir.ids(statements).collect(),
        FnBody::Expr(_) | FnBody::None => SmallVec::new(),
    }
}

fn find_first_initializer(
    file: &FileLowering<'_, '_, '_, '_>,
    statement: StmtId,
) -> Option<ExprId> {
    let StmtKind::Var(declarations) = file.hir[statement].kind else {
        return None;
    };
    let declaration = declarations.iter().next()?;
    file.hir[declaration].init.some()
}

fn find_callee(file: &FileLowering<'_, '_, '_, '_>, call: ExprId) -> Option<ExprId> {
    let ExprKind::Call(site) = file.hir[file.skip_type_syntax(call)].kind else {
        return None;
    };
    Some(file.skip_type_syntax(file.hir[site].callee))
}

fn is_key_first_capture(
    file: &FileLowering<'_, '_, '_, '_>,
    create_binding: FnId,
    getter: FnId,
) -> Option<bool> {
    let source = file.find_parameter(create_binding, 1)?.0;
    let key = file.find_parameter(create_binding, 2)?.0;
    let source = Capture::Value(BindingRef::Symbol(source));
    let key = Capture::Value(BindingRef::Symbol(key));
    let getter = FunctionKey::Source(FunctionRef {
        file: file.file,
        function: getter,
    });
    match *file.scopes.captures(getter) {
        [first, second] if first == source && second == key => Some(false),
        [first, second] if first == key && second == source => Some(true),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use crate::compile::testing::lower_program;
    use crate::ir::Opcode;
    use crate::load::host_platform;
    use crate::lower::LoweringOptions;

    const HELPERS: &str = r#""use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
"#;

    fn count_in_module_bodies(files: &[(&str, &str)], opcode: Opcode) -> usize {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_text: false,
            reports_type_mismatches: false,
            removable: Default::default(),
            minifies_identifiers: false,
        };
        let lowered = lower_program(files, options);
        let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
        let bodies = fragments.filter_map(|fragment| {
            let body = fragment.module.body?;
            let mut functions = fragment.functions.iter();
            functions
                .find(|(id, _)| *id == body)
                .map(|(_, function)| function)
        });
        let blocks = bodies.flat_map(|function| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        values.filter(|value| value.opcode == opcode).count()
    }

    #[test]
    fn top_level_export_star_is_one_guarded_operation() {
        let main = format!("{HELPERS}__exportStar(require(\"./a.cjs\"), exports);");
        let files = [("main.cjs", main.as_str()), ("a.cjs", "exports.a = 1;")];
        assert_eq!(count_in_module_bodies(&files, Opcode::TryReExportFields), 1);
        assert_eq!(count_in_module_bodies(&files, Opcode::IsClosureOf), 0);
        let behind_a_call = format!("require(\"./a.cjs\");\n{main}");
        let files = [
            ("main.cjs", behind_a_call.as_str()),
            ("a.cjs", "exports.a = 1;"),
        ];
        assert_eq!(count_in_module_bodies(&files, Opcode::TryReExportFields), 1);
        assert_eq!(count_in_module_bodies(&files, Opcode::IsClosureOf), 2);
    }

    #[test]
    fn export_star_keeps_the_call_on_the_slow_path() {
        let plain = format!("{HELPERS}exports.a = 1;");
        let star = format!("{HELPERS}__exportStar(exports, exports);");
        let calls = |main: &str| count_in_module_bodies(&[("main.cjs", main)], Opcode::Call);
        assert_eq!(calls(&star), calls(&plain) + 1);
    }

    #[test]
    fn export_star_over_unknown_create_binding_is_an_ordinary_call() {
        let helpers = HELPERS.replace("return m[k];", "return m[k2];");
        let main = format!("{helpers}__exportStar(require(\"./a.cjs\"), exports);");
        let files = [("main.cjs", main.as_str()), ("a.cjs", "exports.a = 1;")];
        assert_eq!(count_in_module_bodies(&files, Opcode::TryReExportFields), 0);
        assert_eq!(count_in_module_bodies(&files, Opcode::IsClosureOf), 0);
    }

    #[test]
    fn spread_and_optional_calls_are_ordinary_calls() {
        for call in [
            "__exportStar(...[exports, exports]);",
            "__exportStar?.(exports, exports);",
        ] {
            let main = format!("{HELPERS}{call}");
            let files = [("main.cjs", main.as_str())];
            let count = count_in_module_bodies(&files, Opcode::TryReExportFields);
            assert_eq!(count, 0, "{call}");
        }
    }
}
