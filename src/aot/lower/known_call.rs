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

use super::call::{self, Arguments, Callee};
use super::captures::{self, Capture};
use super::expression::{self, Tail};
use super::member::{self, PropertyName};
use super::scope::{self, BindingForm, BindingRef, Storage};
use super::{FileLowering, FunctionLowering, control, module, private_names};
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, Edge, FunctionId, FunctionKey, TypeTable, ValueId};
use crate::known_helpers::{
    HeldFunction, Helper, KnownCallee, PrivateFieldAccess, PrivateFieldCall, PrivateMemberKind,
    PrivateStateKind, PrivateStateRole, PrivateStateSite, ResolveInput, ResolvedReference, Shape,
    resolve_callee, resolve_private_field_call, resolve_reference,
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

#[derive(Copy, Clone)]
struct BuiltinPathExpr {
    path: ExprId,
    builtin: BuiltinId,
}

struct ExportStarPlan {
    create_binding: ResolvedReference,
    getter: FnId,
    reuses_descriptors: bool,
    key_is_first_capture: bool,
    has_own_property: BuiltinPathExpr,
    call_name: Atom,
    create_binding_builtins: SmallVec<[BuiltinPathExpr; 2]>,
}

#[derive(Copy, Clone)]
enum StaticMemberAccess {
    GetMethod { member: usize },
    Has,
}

pub(in crate::lower) fn try_lower_known_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> Option<ValueId> {
    let helpers = lowering.file.inputs.known_helpers;
    if !helpers.has_bindings() {
        return None;
    }
    let hir = lowering.file.hir;
    let ExprKind::Call(id) = hir[call].kind else {
        return None;
    };
    let site = hir[id];
    if let Some(state) = find_private_state(lowering.file, call) {
        return match state.role {
            PrivateStateRole::Definition => {
                lower_private_state_definition(lowering, call, site, state)
            }
            PrivateStateRole::HelperArgument => {
                lower_private_field_access(lowering, call, site, state)
            }
        };
    }
    if !is_plain_call(lowering.file, site) {
        return None;
    }
    let callee = resolve_callee(&resolve_input(lowering.file), lowering.file.file, site.callee)?;
    if !is_lowered(lowering.file, callee.file) {
        return None;
    }
    match callee.helper(helpers)? {
        Helper::ExportStar => lower_export_star(lowering, call, site, &callee),
        Helper::ClassPrivateFieldGet | Helper::ClassPrivateFieldIn => {
            lower_static_member_access(lowering, call, site)
        }
        _ => None,
    }
}

pub(in crate::lower) fn emit_export_star_fast_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    export_star: FnId,
) {
    let Some(plan) = plan_export_star(lowering.file, export_star) else {
        return;
    };
    if plan.create_binding.needs_guard && !is_readable(lowering, plan.create_binding.symbol) {
        return;
    }
    let source = find_parameter(lowering.file, export_star, 0);
    let target = find_parameter(lowering.file, export_star, 1);
    let (Some(source), Some(target)) = (source, target) else {
        return;
    };
    let slow_path = lowering.create_unlikely_block();
    let source = scope::get_binding(lowering, Binding::Symbol(source.0), source.1);
    let target = scope::get_binding(lowering, Binding::Symbol(target.0), target.1);
    emit_export_star(lowering, &plan, target, source, slow_path);
    control::emit_empty_return(lowering);
    lowering.continue_in(slow_path);
}

fn resolve_input<'x, 's>(file: &'x FileLowering<'_, '_, '_, 's>) -> ResolveInput<'x, 's> {
    ResolveInput {
        files: file.queries.files(),
        modules: file.inputs.modules,
        helpers: file.inputs.known_helpers,
    }
}

fn find_private_state(
    file: &FileLowering<'_, '_, '_, '_>,
    call: ExprId,
) -> Option<PrivateStateSite> {
    let inputs = file.inputs;
    let files = file.queries.files();
    let states = inputs.known_helpers.private_states(files, inputs.modules, file.file)?;
    states.site(call)
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

fn lower_call_operands(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> LoweredCall {
    let callee = call::lower_callee(lowering, site.callee, None);
    let Arguments::Values(arguments) = call::lower_arguments(lowering, site.args) else {
        unreachable!("a call with a spread argument is not a known call");
    };
    lowering.set_position(lowering.file.hir[call].pos);
    LoweredCall {
        call,
        callee,
        arguments,
        slow_path: lowering.create_unlikely_block(),
    }
}

fn finish_with_slow_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    lowered: LoweredCall,
    fast_result: ValueId,
) -> ValueId {
    lowering.file.count(StatisticId::KnownHelperCalls, 1);
    let result = lowering.builder.create_variable(None);
    let done = lowering.create_block();
    lowering.builder.write_variable(result, fast_result);
    lowering.jump(done);

    lowering.continue_in(lowered.slow_path);
    let arguments = Arguments::Values(lowered.arguments);
    let returned =
        call::emit_call_expression(lowering, lowered.call, lowered.callee, arguments, Tail::No);
    lowering.builder.write_variable(result, returned);
    lowering.jump(done);

    lowering.continue_in(done);
    lowering.builder.read_variable(result)
}

fn emit_guard(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    condition: ValueId,
    slow_path: BlockId,
) {
    let passed = lowering.create_block();
    lowering
        .builder
        .branch(condition, Edge::to(passed), Edge::to(slow_path));
    lowering.continue_in(passed);
}

fn guard_closure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    home: FileId,
    function: FnId,
    slow_path: BlockId,
) {
    let function = reference_function(lowering.file, home, function);
    let is_closure = lowering.builder.is_closure_of(function, value);
    emit_guard(lowering, is_closure, slow_path);
}

fn guard_builtin(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    builtin: BuiltinId,
    slow_path: BlockId,
) {
    let builtin = expression::emit_locked_builtin(lowering, builtin);
    let is_unchanged = lowering.builder.strict_eq(value, builtin);
    emit_guard(lowering, is_unchanged, slow_path);
}

fn guard_builtin_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expected: BuiltinPathExpr,
    slow_path: BlockId,
) -> ValueId {
    let value = expression::lower_expression(lowering, expected.path);
    guard_builtin(lowering, value, expected.builtin, slow_path);
    value
}

fn guard_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    lowered: &LoweredCall,
    callee: &KnownCallee,
    held: HeldFunction,
) {
    if callee.needs_guard() {
        let function = lowered.callee.function;
        guard_closure(lowering, function, callee.file, held.closure, lowered.slow_path);
    }
}

fn is_enclosing_scope(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, scope: ScopeId) -> bool {
    let bound = lowering.file.bound;
    let innermost = scope::innermost_scope(lowering);
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
fn is_readable(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, symbol: SymbolId) -> bool {
    let file = &*lowering.file;
    let binding = BindingRef::Symbol(symbol);
    if file.scopes.form(symbol) != BindingForm::Stored
        || file.bound.initial_state(symbol) == InitialState::Uninitialized
    {
        return false;
    }
    if captures::find_captured_value(lowering, Capture::Value(binding)).is_some() {
        return true;
    }
    match file.scopes.placement(binding).map(|placement| placement.storage) {
        Some(Storage::Variable(_)) => true,
        Some(Storage::Field { scope, .. }) => {
            let captured = captures::find_captured_value(lowering, Capture::Environment(scope));
            captured.is_some() || is_enclosing_scope(lowering, scope)
        }
        Some(Storage::Local) => {
            let declaring = file.bound.symbol_scope(symbol).some();
            let declaring = declaring.unwrap_or_else(|| module::file_scope(file));
            lowering.scopes.find_local(binding).is_some()
                && is_enclosing_scope(lowering, declaring)
        }
        None => false,
    }
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
    let ExprKind::Call(site) = file.hir[expression::skip_type_syntax(file, call)].kind else {
        return None;
    };
    Some(expression::skip_type_syntax(file, file.hir[site].callee))
}

fn resolves_to_builtin(file: &FileLowering<'_, '_, '_, '_>, expected: BuiltinPathExpr) -> bool {
    match file.builtins.of_expr(expected.path) {
        Some(Resolved::Builtin(path)) => path.id == expected.builtin,
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => false,
    }
}

fn find_parameter(
    file: &FileLowering<'_, '_, '_, '_>,
    function: FnId,
    index: usize,
) -> Option<(SymbolId, Atom)> {
    let (hir, bound) = (file.hir, file.bound);
    let pattern = hir[hir[function].params.iter().nth(index)?].pat;
    let PatKind::Ident(name) = hir[pattern].kind else {
        return None;
    };
    Some((bound.declared_symbol(Decl::Param(pattern)).some()?, name))
}

// for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
fn find_has_own_property(
    file: &FileLowering<'_, '_, '_, '_>,
    export_star: FnId,
) -> Option<(BuiltinPathExpr, Atom)> {
    let hir = file.hir;
    let [for_in] = find_statements(file, export_star)[..] else {
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
    } = hir[expression::skip_type_syntax(file, test)].kind
    else {
        return None;
    };
    let ExprKind::Unary {
        op: UnOp::Not,
        operand,
    } = hir[expression::skip_type_syntax(file, right)].kind
    else {
        return None;
    };
    let callee = find_callee(file, operand)?;
    let (function, MemberKey::Name(call_name)) = hir.member_key(callee)? else {
        return None;
    };
    let call = BuiltinPathExpr {
        path: callee,
        builtin: BuiltinId::FunctionPrototypeCall,
    };
    let has_own_property = BuiltinPathExpr {
        path: expression::skip_type_syntax(file, function),
        builtin: BuiltinId::ObjectPrototypeHasOwnProperty,
    };
    let is_resolved =
        resolves_to_builtin(file, call) && resolves_to_builtin(file, has_own_property);
    is_resolved.then_some((has_own_property, call_name))
}

fn find_create_binding_builtins(
    file: &FileLowering<'_, '_, '_, '_>,
    create_binding: FnId,
    shape: Shape,
) -> Option<SmallVec<[BuiltinPathExpr; 2]>> {
    let mut builtins = SmallVec::new();
    let define = match (shape, &find_statements(file, create_binding)[..]) {
        (Shape::CreateBindingReusesDescriptor, &[_, describe, _, define]) => {
            let describe = find_first_initializer(file, describe)?;
            builtins.push(BuiltinPathExpr {
                path: find_callee(file, describe)?,
                builtin: BuiltinId::ObjectGetOwnPropertyDescriptor,
            });
            define
        }
        (Shape::CreateBindingDefinesGetter, &[_, define]) => define,
        _ => return None,
    };
    let StmtKind::Expr(define) = file.hir[define].kind else {
        return None;
    };
    builtins.push(BuiltinPathExpr {
        path: find_callee(file, define)?,
        builtin: BuiltinId::ObjectDefineProperty,
    });
    let is_resolved = builtins.iter().all(|&expected| resolves_to_builtin(file, expected));
    is_resolved.then_some(builtins)
}

fn is_key_first_capture(
    file: &FileLowering<'_, '_, '_, '_>,
    create_binding: FnId,
    getter: FnId,
) -> Option<bool> {
    let source = find_parameter(file, create_binding, 1)?.0;
    let key = find_parameter(file, create_binding, 2)?.0;
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

fn plan_export_star(
    file: &FileLowering<'_, '_, '_, '_>,
    export_star: FnId,
) -> Option<ExportStarPlan> {
    let helpers = file.inputs.known_helpers;
    let known = helpers.function(file.file, export_star)?;
    if known.shape != Shape::ExportStarBindsNamesTheTargetLacks {
        return None;
    }
    let [reference] = known.references[..] else {
        return None;
    };
    let create_binding = resolve_reference(&resolve_input(file), file.file, reference, &|shape| {
        matches!(
            shape,
            Shape::CreateBindingDefinesGetter | Shape::CreateBindingReusesDescriptor
        )
    })?;
    let known_binding = helpers.function(file.file, create_binding.function.definition)?;
    let shape = known_binding.shape;
    let [definition, getter] = known_binding.functions[..] else {
        return None;
    };
    let (has_own_property, call_name) = find_has_own_property(file, export_star)?;
    Some(ExportStarPlan {
        create_binding,
        getter,
        reuses_descriptors: shape == Shape::CreateBindingReusesDescriptor,
        key_is_first_capture: is_key_first_capture(file, definition, getter)?,
        has_own_property,
        call_name,
        create_binding_builtins: find_create_binding_builtins(file, definition, shape)?,
    })
}

fn emit_export_star(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    plan: &ExportStarPlan,
    target: ValueId,
    source: ValueId,
    slow_path: BlockId,
) {
    let position = lowering.position();
    let file = lowering.file.file;
    if plan.create_binding.needs_guard {
        let held = scope::get_stored(lowering, BindingRef::Symbol(plan.create_binding.symbol));
        guard_closure(lowering, held, file, plan.create_binding.function.closure, slow_path);
    }
    let has_own_property = guard_builtin_path(lowering, plan.has_own_property, slow_path);
    let key = member::name_key(lowering.file, plan.call_name);
    let call = member::emit_get(lowering, has_own_property, PropertyName::Constant(key));
    guard_builtin(lowering, call, BuiltinId::FunctionPrototypeCall, slow_path);
    for &expected in &plan.create_binding_builtins {
        guard_builtin_path(lowering, expected, slow_path);
    }
    lowering.set_position(position);
    let getter = reference_function(lowering.file, file, plan.getter);
    let is_done = lowering.builder.try_re_export_fields(
        target,
        source,
        getter,
        plan.reuses_descriptors,
        plan.key_is_first_capture,
    );
    emit_guard(lowering, is_done, slow_path);
}

fn lower_export_star(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
    callee: &KnownCallee,
) -> Option<ValueId> {
    if callee.file != lowering.file.file || site.args.len() != 2 {
        return None;
    }
    let mut candidates = callee.functions.iter();
    let (held, plan) = candidates
        .find_map(|&held| Some((held, plan_export_star(lowering.file, held.definition)?)))?;
    if plan.create_binding.needs_guard && !is_readable(lowering, plan.create_binding.symbol) {
        return None;
    }
    let lowered = lower_call_operands(lowering, call, site);
    guard_callee(lowering, &lowered, callee, held);
    let (source, target) = (lowered.arguments[0], lowered.arguments[1]);
    emit_export_star(lowering, &plan, target, source, lowered.slow_path);
    let undefined = lowering.builder.undefined();
    Some(finish_with_slow_path(lowering, lowered, undefined))
}

fn lower_private_state_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
    state: PrivateStateSite,
) -> Option<ValueId> {
    let (method, argument_count) = match state.kind {
        PrivateStateKind::Field => (BuiltinId::WeakMapPrototypeSet, 2),
        PrivateStateKind::Brand => (BuiltinId::WeakSetPrototypeAdd, 1),
    };
    let callee = expression::skip_type_syntax(lowering.file, site.callee);
    if !is_plain_call(lowering.file, site)
        || site.args.len() != argument_count
        || lowering.file.hir.member_key(callee).is_none()
    {
        return None;
    }
    let lowered = lower_call_operands(lowering, call, site);
    let Some(collection) = lowered.callee.this else {
        unreachable!("a member callee has a receiver");
    };
    let object = lowered.arguments[0];
    let is_object = lowering.builder.type_test(object, TypeTable::OBJECT);
    emit_guard(lowering, is_object, lowered.slow_path);
    let access = PrivateStateAccess {
        state: state.state,
        collection,
        object,
    };
    let value = lowered.arguments.get(1).copied();
    let has_entry = private_names::emit_state_test(lowering, access);
    let update = lowering.create_block();
    let insert = lowering.create_block();
    let merge = lowering.create_block();
    lowering
        .builder
        .branch(has_entry, Edge::to(update), Edge::to(insert));

    lowering.continue_in(update);
    if let Some(value) = value {
        private_names::emit_state_set(lowering, access, value);
    }
    lowering.jump(merge);

    lowering.continue_in(insert);
    guard_builtin(lowering, lowered.callee.function, method, lowered.slow_path);
    private_names::emit_state_definition(lowering, access, value);
    lowering.jump(merge);

    lowering.continue_in(merge);
    Some(finish_with_slow_path(lowering, lowered, collection))
}

// Returning None here would pass the helper a collection that is missing the entries stored in fields.
//
// An entry is in a field only if its collection is recorded: the built-in constructor made it, and the variable, the
// helpers and the built-in methods are all that ever held it. So it has no property of its own and the prototype it was
// made with, whose methods are locked (`private_state::find_in_file` asks the table): what the helper would find under
// `has`, `get` and `set` is not asked for.
fn lower_private_field_access(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
    state: PrivateStateSite,
) -> Option<ValueId> {
    let helper_call =
        resolve_private_field_call(&resolve_input(lowering.file), lowering.file.file, call);
    let helper_call = helper_call.filter(|it| it.supports_private_state(state.kind));
    let helper_call = helper_call.expect("private_state only accepts supported helper calls");
    let kind = helper_call.access(state.kind);
    let kind = kind.expect("a supported helper call has an access kind");
    if !is_lowered(lowering.file, helper_call.callee.file) {
        return None;
    }
    let lowered = lower_call_operands(lowering, call, site);
    guard_callee(lowering, &lowered, &helper_call.callee, helper_call.callee.functions[0]);
    let access = PrivateStateAccess {
        state: state.state,
        collection: lowered.arguments[helper_call.state],
        object: lowered.arguments[helper_call.receiver],
    };
    let has_entry = private_names::emit_state_test(lowering, access);
    emit_guard(lowering, has_entry, lowered.slow_path);
    let result = match kind {
        PrivateFieldAccess::Get => private_names::emit_state_get(lowering, access),
        PrivateFieldAccess::Set { value } => {
            private_names::emit_state_set(lowering, access, lowered.arguments[value]);
            lowered.arguments[value]
        }
        PrivateFieldAccess::GetMethod { member } => lowered.arguments[member],
        PrivateFieldAccess::Has => lowering.builder.boolean(true),
    };
    Some(finish_with_slow_path(lowering, lowered, result))
}

fn is_new_expression(file: &FileLowering<'_, '_, '_, '_>, value: ExprId) -> bool {
    let value = expression::skip_type_syntax(file, value);
    matches!(file.hir[value].kind, ExprKind::New(_))
}

fn may_hold_class(file: &FileLowering<'_, '_, '_, '_>, state: ExprId) -> bool {
    let (hir, bound) = (file.hir, file.bound);
    let state = expression::skip_type_syntax(file, state);
    if !matches!(hir[state].kind, ExprKind::Ident(_)) {
        return true;
    }
    let Binding::Symbol(symbol) = bound.binding(state) else {
        return true;
    };
    if let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol)
        && is_new_expression(file, value)
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
        store.kind == StoreKind::Assign && is_new_expression(file, value)
    })
}

fn classify_static_member_access(helper_call: &PrivateFieldCall) -> Option<StaticMemberAccess> {
    match (helper_call.helper, helper_call.member_kind, helper_call.member) {
        (Helper::ClassPrivateFieldGet, PrivateMemberKind::Method, Some(member)) => {
            Some(StaticMemberAccess::GetMethod { member })
        }
        (Helper::ClassPrivateFieldIn, _, _) => Some(StaticMemberAccess::Has),
        _ => None,
    }
}

fn lower_static_member_access(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    site: Call,
) -> Option<ValueId> {
    let helper_call =
        resolve_private_field_call(&resolve_input(lowering.file), lowering.file.file, call)?;
    let kind = classify_static_member_access(&helper_call)?;
    let state = lowering.file.hir.id_at(site.args, helper_call.state);
    if !may_hold_class(lowering.file, state) {
        return None;
    }
    let lowered = lower_call_operands(lowering, call, site);
    guard_callee(lowering, &lowered, &helper_call.callee, helper_call.callee.functions[0]);
    let slow_path = lowered.slow_path;
    let object = lowered.arguments[helper_call.receiver];
    let class = lowered.arguments[helper_call.state];
    let is_class = lowering.builder.type_test(class, TypeTable::FUNCTION);
    emit_guard(lowering, is_class, slow_path);
    let result = match kind {
        StaticMemberAccess::GetMethod { member } => {
            let is_receiver = lowering.builder.strict_eq(object, class);
            emit_guard(lowering, is_receiver, slow_path);
            let is_declared = lowering.builder.to_boolean(lowered.arguments[member]);
            emit_guard(lowering, is_declared, slow_path);
            lowered.arguments[member]
        }
        StaticMemberAccess::Has => {
            let is_object = lowering.builder.type_test(object, TypeTable::OBJECT);
            emit_guard(lowering, is_object, slow_path);
            lowering.builder.strict_eq(object, class)
        }
    };
    Some(finish_with_slow_path(lowering, lowered, result))
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
        };
        let lowered = lower_program(files, options);
        let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
        let bodies = fragments.filter_map(|fragment| {
            let body = fragment.module.body?;
            let mut functions = fragment.functions.iter();
            functions.find(|(id, _)| *id == body).map(|(_, function)| function)
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
        let files = [("main.cjs", behind_a_call.as_str()), ("a.cjs", "exports.a = 1;")];
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
        for call in ["__exportStar(...[exports, exports]);", "__exportStar?.(exports, exports);"] {
            let main = format!("{HELPERS}{call}");
            let files = [("main.cjs", main.as_str())];
            assert_eq!(count_in_module_bodies(&files, Opcode::TryReExportFields), 0, "{call}");
        }
    }
}
