use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Decl, InitialState, Parent, ScopeId, StoreKind, SymbolId,
};
use bun_sema::check::aot::{FunctionRef, ObjectMemberKind};
use bun_sema::hir::{
    self, BinOp, Call, Chain, ExprId, ExprKind, FnBody, FnId, FnKind, MemberKey, NodeData, PatKind,
    PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use bun_sema::program::FileId;
use smallvec::SmallVec;

use super::call::{Arguments, Callee};
use super::captures::Capture;
use super::expression::Tail;
use super::function::EntryArguments;
use super::member::PropertyName;
use super::scope::{BindingForm, BindingRef, Storage};
use super::{FileLowering, FunctionLowering, module};
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{ECMAMode, IllTypedCause, OperandKind};
use crate::ir::{
    BlockId, DeclaredType, Edge, FunctionId, FunctionKey, PropertyKeyId, TypeTable, ValueId,
};
use crate::known_helpers::{
    HeldFunction, Helper, KnownCallee, PrivateFieldAccess, PrivateMemberKind, PrivateStateKind,
    PrivateStateRole, PrivateStateSite, PublicFieldAnswer, ResolveInput, ResolvedReference, Shape,
    calls_only_published_helpers, resolve_callee, resolve_private_field_call, resolve_public_field,
    resolve_reference,
};
use crate::load::sources::parsed_source;

#[derive(Copy, Clone)]
pub(in crate::lower) struct PrivateStateAccess {
    pub(in crate::lower) state: SymbolId,
    pub(in crate::lower) collection: ValueId,
    pub(in crate::lower) object: ValueId,
}

pub(super) struct LoweredCall {
    call: ExprId,
    pub(super) callee: Callee,
    /// The declaration that is called by its name, whose closure nothing reads.
    declaration: Option<FnId>,
    pub(super) arguments: SmallVec<[ValueId; 4]>,
    pub(super) slow_path: BlockId,
}

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

struct WrittenDescriptor {
    properties: hir::Span<hir::PropId>,
    key: hir::PropId,
    names_value: bool,
    names_getter: bool,
    names_setter: bool,
    names_enumerable: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ClassHelper {
    MayBeGuarded,
    MustBeCertain,
}

struct CreateClassPlan {
    defines_both_sides: bool,
    define_properties: ResolvedReference,
    define_property: ExprId,
    lock_prototype: Option<(ExprId, ExprId)>,
    lock_prototype_callee: Option<ExprId>,
    converts_keys: bool,
    builtins_are_locked: bool,
    prototype_name: PropertyKeyId,
    enumerable_name: PropertyKeyId,
    configurable_name: PropertyKeyId,
    writable_name: PropertyKeyId,
    value_name: PropertyKeyId,
    key_name: PropertyKeyId,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    /// `_createClass(..)`, `_callSuper(..)` where the helper is a declaration inside a function that nothing reads as a value.
    pub(in crate::lower) fn try_lower_certain_helper(&mut self, call: ExprId) -> Option<ValueId> {
        let inputs = self.file.inputs;
        if !inputs.known_helpers.has_bindings() || inputs.options.counts_executions {
            return None;
        }
        let ExprKind::Call(id) = self.file.hir[call].kind else {
            return None;
        };
        let site = self.file.hir[id];
        if !is_plain_call(self.file, site) {
            return None;
        }
        let callee = resolve_callee(&resolve_input(self.file), self.file.file, site.callee)?;
        let is_in_this_file = callee.file == self.file.file;
        match callee.helper(inputs.known_helpers)? {
            Helper::CreateClass if is_in_this_file => {
                self.lower_create_class(call, site, &callee, ClassHelper::MustBeCertain)
            }
            _ if !is_in_this_file || callee.needs_guard() => None,
            Helper::CallSuper => self.lower_call_super(call, site, &callee),
            Helper::PossibleConstructorReturn => {
                self.lower_possible_constructor_return(call, site, &callee)
            }
            Helper::AssertThisInitialized => {
                self.lower_assert_this_initialized(call, site, &callee)
            }
            Helper::ClassCallCheck => {
                self.note_check_of_class(call);
                None
            }
            _ => None,
        }
    }

    pub(super) fn emit_call_of_helper(
        &mut self,
        call: ExprId,
        site: Call,
        arguments: &[ValueId],
    ) -> ValueId {
        match self.file.scopes.function_called_by_name(call) {
            Some(declaration) => {
                let arguments = Arguments::Values(SmallVec::from_slice(arguments));
                self.emit_call_of_declaration(call, declaration, arguments)
            }
            None => {
                let function = self.lower_expression(site.callee);
                super::call::emit_call(self, function, None, arguments)
            }
        }
    }

    fn find_private_state_site(&self, call: ExprId) -> Option<PrivateStateSite> {
        let (files, modules) = (self.file.queries.files(), self.file.inputs.modules);
        let helpers = self.file.inputs.known_helpers;
        let states = helpers.private_states(files, modules, self.file.file)?;
        states.site(call)
    }

    fn lower_private_state_site(
        &mut self,
        call: ExprId,
        site: Call,
        state: PrivateStateSite,
    ) -> Option<ValueId> {
        if self.file.counts_executions() {
            return None;
        }
        match state.role {
            PrivateStateRole::Definition => self.lower_private_state_definition(call, site, state),
            PrivateStateRole::Test => self.lower_private_state_test(call, site, state),
            PrivateStateRole::HelperArgument => self.lower_private_field_access(call, site, state),
            PrivateStateRole::Update => None,
        }
    }

    /// `__privateWrapper(object, state)._++`
    pub(in crate::lower) fn try_lower_update_of_private_state(
        &mut self,
        stepped: ExprId,
        is_increment: bool,
        is_old_kept: bool,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let (call, MemberKey::Name(name)) = hir.member_key(self.file.skip_type_syntax(stepped))?
        else {
            return None;
        };
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let state = self.find_private_state_site(call)?;
        if state.role != PrivateStateRole::Update || self.file.counts_executions() {
            return None;
        }
        let helper_call =
            resolve_private_field_call(&resolve_input(self.file), self.file.file, call)?;
        let callee = &helper_call.callee;
        if !is_lowered(self.file, callee.file) {
            return None;
        }
        let lowered = self.lower_call_operands(call, hir[id]);
        self.guard_callee(&lowered, callee, callee.functions[0]);
        let access = PrivateStateAccess {
            state: state.state,
            collection: lowered.arguments[helper_call.state],
            object: lowered.arguments[helper_call.receiver],
        };
        let has_entry = self.emit_state_test(access);
        self.emit_guard(has_entry, lowered.slow_path);
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        let read = self.emit_state_get(access);
        let (old, updated) = self.emit_step(read, is_increment, is_old_kept);
        self.emit_state_set(access, updated);
        let answer = if is_old_kept { old } else { updated };
        self.builder.write_variable(result, answer);
        self.jump(done);
        self.file.known_helpers_lowered.calls += 1;

        self.continue_in(lowered.slow_path);
        let wrapper = self.emit_slow_call(
            lowered.call,
            lowered.callee,
            lowered.declaration,
            lowered.arguments,
        );
        let name = PropertyName::Constant(self.file.name_key(name));
        let read = self.emit_get(wrapper, name);
        let (old, updated) = self.emit_step(read, is_increment, is_old_kept);
        self.emit_set(wrapper, name, updated);
        let answer = if is_old_kept { old } else { updated };
        self.builder.write_variable(result, answer);
        self.jump(done);

        self.continue_in(done);
        Some(self.builder.read_variable(result))
    }

    fn emit_step(
        &mut self,
        read: ValueId,
        is_increment: bool,
        is_old_kept: bool,
    ) -> (ValueId, ValueId) {
        let old = match is_old_kept {
            true => self.builder.to_numeric(read),
            false => read,
        };
        let updated = match is_increment {
            true => self.builder.increment(old),
            false => self.builder.decrement(old),
        };
        (old, updated)
    }

    fn emit_slow_call(
        &mut self,
        call: ExprId,
        callee: Callee,
        declaration: Option<FnId>,
        arguments: SmallVec<[ValueId; 4]>,
    ) -> ValueId {
        let arguments = Arguments::Values(arguments);
        match declaration {
            Some(declaration) => self.emit_call_of_declaration(call, declaration, arguments),
            None => self.emit_call_expression(call, callee, arguments, Tail::No),
        }
    }

    /// The helper is a declaration inside a function that nothing reads as a value.
    pub(in crate::lower) fn try_lower_private_state_call(
        &mut self,
        call: ExprId,
    ) -> Option<ValueId> {
        let state = self.find_private_state_site(call)?;
        let ExprKind::Call(id) = self.file.hir[call].kind else {
            return None;
        };
        self.lower_private_state_site(call, self.file.hir[id], state)
    }

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
        let modules = self.file.inputs.modules;
        if let Some(state) = self.find_private_state_site(call) {
            return self.lower_private_state_site(call, site, state);
        }
        if let Some(required) = modules
            .commonjs()
            .find_require_of_star(self.file.file, call)
        {
            self.lower_expression_for_effect(required);
            return Some(self.builder.undefined());
        }
        if !is_plain_call(self.file, site) {
            return None;
        }
        if let Some(lowered) = self.lower_call_of_created_super(call, site) {
            return Some(lowered);
        }
        let callee = resolve_callee(&resolve_input(self.file), self.file.file, site.callee)?;
        if !is_lowered(self.file, callee.file) {
            return None;
        }
        let helper = callee.helper(helpers)?;
        // A coverage report counts the functions and the lines of a helper. The exports of a star are linked by the build.
        let inputs = self.file.inputs;
        if inputs.options.counts_executions
            && inputs.sources.is_in_coverage_report(callee.file)
            && !matches!(helper, Helper::ExportStar)
        {
            return None;
        }
        match helper {
            Helper::ExportStar => self.lower_export_star(call, site, &callee),
            Helper::CreateClass => {
                self.lower_create_class(call, site, &callee, ClassHelper::MayBeGuarded)
            }
            Helper::Typeof => {
                let operand = self.file.find_operand_of_typeof_helper(call)?;
                let value = self.lower_expression(operand);
                self.set_position(hir[call].pos);
                Some(self.builder.type_of(value))
            }
            Helper::Assign => self.lower_call_of_replaced_assign(call, site, &callee),
            Helper::ImportDefault => self.lower_import_default(call, site, &callee),
            Helper::PublicField => self.lower_public_field(call, site),
            Helper::PossibleConstructorReturn => {
                self.lower_possible_constructor_return(call, site, &callee)
            }
            Helper::AssertThisInitialized => {
                self.lower_assert_this_initialized(call, site, &callee)
            }
            Helper::CallSuper => self.lower_call_super(call, site, &callee),
            Helper::ClassCallCheck => {
                self.note_check_of_class(call);
                None
            }
            Helper::ClassPrivateFieldGet | Helper::ClassPrivateFieldIn => {
                self.lower_static_member_access(call, site)
            }
            _ => None,
        }
    }

    fn lower_call_of_replaced_assign(
        &mut self,
        call: ExprId,
        site: Call,
        callee: &KnownCallee,
    ) -> Option<ValueId> {
        let [held] = callee.functions[..] else {
            return None;
        };
        let helpers = self.file.inputs.known_helpers;
        let known = helpers.function(callee.file, held.definition)?;
        let is_assign = callee.file == self.file.file
            && !callee.needs_guard()
            && known.relies_on_facts
            && known.is_named_only_to_be_called;
        if !is_assign {
            return None;
        }
        self.lower_assignment_to_new_object(call, site, Tail::No)
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
        let slow_path = self.create_block();
        let source = self.get_binding(Binding::Symbol(source.0), source.1);
        let target = self.get_binding(Binding::Symbol(target.0), target.1);
        self.emit_export_star(&plan, target, source, slow_path);
        self.emit_empty_return();
        self.continue_in(slow_path);
    }

    pub(super) fn lower_call_operands(&mut self, call: ExprId, site: Call) -> LoweredCall {
        let declaration = self.file.scopes.function_called_by_name(call);
        let callee = match declaration {
            Some(_) => Callee::without_key(self.builder.undefined(), None, None),
            None => self.lower_callee(site.callee, None, None),
        };
        let Arguments::Values(arguments) = self.lower_arguments(site.args) else {
            unreachable!("a call with a spread argument is not a known call");
        };
        self.set_position(self.file.hir[call].pos);
        LoweredCall {
            call,
            callee,
            declaration,
            arguments,
            slow_path: self.create_block(),
        }
    }

    pub(super) fn finish_with_slow_path(
        &mut self,
        lowered: LoweredCall,
        fast_result: ValueId,
    ) -> ValueId {
        self.file.known_helpers_lowered.calls += 1;
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        self.builder.write_variable(result, fast_result);
        self.jump(done);

        self.continue_in(lowered.slow_path);
        let LoweredCall {
            call,
            callee,
            declaration,
            arguments,
            ..
        } = lowered;
        let returned = self.emit_slow_call(call, callee, declaration, arguments);
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

    pub(super) fn guard_closure(
        &mut self,
        value: ValueId,
        home: FileId,
        function: FnId,
        slow_path: BlockId,
    ) {
        let function = reference_function(self.file, home, function);
        let is_closure = self.builder.is_closure_of(function, value);
        self.emit_guard(is_closure, slow_path);
    }

    pub(super) fn guard_builtin(&mut self, value: ValueId, builtin: BuiltinId, slow_path: BlockId) {
        let builtin = self.emit_builtin_itself(builtin);
        let is_unchanged = self.builder.strict_eq(value, builtin);
        self.emit_guard(is_unchanged, slow_path);
    }

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
        if callee.needs_guard() && lowered.declaration.is_none() {
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
            Some(Storage::Instance { .. }) => self.reaches_stored(file.instance_slot()),
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

    fn lower_create_class(
        &mut self,
        call: ExprId,
        site: Call,
        callee: &KnownCallee,
        class_helper: ClassHelper,
    ) -> Option<ValueId> {
        if !(1..=3).contains(&site.args.len()) {
            return None;
        }
        let home = callee.file;
        let is_in_this_file = home == self.file.file;
        let hir = self.file.hir;
        let constructor = self.file.skip_type_syntax(hir.id_at(site.args, 0));
        let is_made_here = matches!(hir[constructor].kind, ExprKind::Fn(_));
        if !is_made_here && !matches!(hir[constructor].kind, ExprKind::Ident(_)) {
            return None;
        }
        let mut sides: [SmallVec<[ExprId; 4]>; 2] = Default::default();
        for (index, side) in sides.iter_mut().enumerate() {
            if index + 1 < site.args.len() {
                *side = self
                    .file
                    .find_written_descriptors(hir.id_at(site.args, index + 1))?;
            }
        }
        let mut candidates = callee.functions.iter();
        let (held, plan) = candidates
            .find_map(|&held| Some((held, self.file.plan_create_class(home, held.definition)?)))?;
        if !plan.defines_both_sides && site.args.len() > 2 {
            return None;
        }
        if !is_in_this_file && (plan.define_properties.needs_guard || !plan.builtins_are_locked) {
            return None;
        }
        if plan.define_properties.needs_guard && !self.is_readable(plan.define_properties.symbol) {
            return None;
        }
        let mut literals = sides.iter().flatten();
        if plan.converts_keys && literals.any(|&literal| self.file.is_keyed_by_function(literal)) {
            return None;
        }
        let is_certain = !callee.needs_guard()
            && callee.holds_from_the_start
            && !plan.define_properties.needs_guard
            && plan.builtins_are_locked;
        if !is_certain && class_helper == ClassHelper::MustBeCertain {
            return None;
        }
        let mut other_way = None;
        let mut made = None;
        let define = if is_certain && is_in_this_file {
            self.lower_expression(plan.define_property)
        } else if is_certain {
            self.emit_builtin_itself(BuiltinId::ObjectDefineProperty)
        } else {
            let lowered_callee = self.lower_callee(site.callee, None, None);
            made = is_made_here.then(|| self.lower_expression(constructor));
            self.set_position(hir[call].pos);
            let slow_path = self.create_block();
            if is_in_this_file {
                if callee.needs_guard() {
                    self.guard_closure(lowered_callee.function, home, held.closure, slow_path);
                }
                if plan.define_properties.needs_guard {
                    let stored = self.get_stored(BindingRef::Symbol(plan.define_properties.symbol));
                    self.guard_closure(
                        stored,
                        home,
                        plan.define_properties.function.closure,
                        slow_path,
                    );
                }
                other_way = Some((lowered_callee, slow_path));
                let define = self.guard_builtin_path(
                    (plan.define_property, BuiltinId::ObjectDefineProperty),
                    slow_path,
                );
                if let Some(path) = plan.lock_prototype_callee {
                    self.guard_builtin_path((path, BuiltinId::ObjectDefineProperty), slow_path);
                }
                define
            } else {
                let other_callee = Callee {
                    function: self.builder.add_edge_result(slow_path),
                    key: None,
                    ..lowered_callee
                };
                let helper = reference_function(self.file, home, held.closure);
                let is_helper = self.builder.is_closure_of(helper, lowered_callee.function);
                let passed = self.create_block();
                let differs = Edge::with_proofs(slow_path, &[0]);
                self.builder.branch(is_helper, Edge::to(passed), differs);
                self.continue_in(passed);
                other_way = Some((other_callee, slow_path));
                self.emit_builtin_itself(BuiltinId::ObjectDefineProperty)
            }
        };

        let object = made.unwrap_or_else(|| self.lower_expression(constructor));
        for (index, side) in sides.iter().enumerate() {
            let is_empty_list_of_prototype = index == 0
                && site.args.len() > 1
                && matches!(
                    hir[self.file.skip_type_syntax(hir.id_at(site.args, 1))].kind,
                    ExprKind::Array(_)
                );
            if side.is_empty() && !is_empty_list_of_prototype {
                continue;
            }
            let target = if index == 0 {
                self.emit_get(object, PropertyName::Constant(plan.prototype_name))
            } else {
                object
            };
            for &literal in side {
                self.emit_written_descriptor(&plan, define, target, literal);
            }
        }
        if let Some(lock) = plan.lock_prototype {
            let (name, descriptor) = match is_in_this_file {
                true => (self.lower_expression(lock.0), self.lower_expression(lock.1)),
                false => self.emit_lock_of_prototype(&plan),
            };
            let holder = self.emit_builtin_itself(BuiltinId::Object);
            super::call::emit_call(self, define, Some(holder), &[object, name, descriptor]);
        }
        self.file.known_helpers_lowered.calls += 1;

        let Some((lowered_callee, slow_path)) = other_way else {
            return Some(object);
        };
        let result = self.builder.create_variable(None);
        let done = self.create_block();
        self.builder.write_variable(result, object);
        self.jump(done);
        self.continue_in(slow_path);
        let written: SmallVec<[ExprId; 4]> =
            hir.ids(site.args).skip(made.is_some() as usize).collect();
        let Arguments::Values(mut arguments) = self.lower_argument_slice(&written) else {
            unreachable!("a call with a spread argument is not a known call");
        };
        if let Some(made) = made {
            arguments.insert(0, made);
        }
        let returned =
            self.emit_call_expression(call, lowered_callee, Arguments::Values(arguments), Tail::No);
        self.builder.write_variable(result, returned);
        self.jump(done);
        self.continue_in(done);
        Some(self.builder.read_variable(result))
    }

    fn emit_lock_of_prototype(&mut self, plan: &CreateClassPlan) -> (ValueId, ValueId) {
        let text = self.file.intern_bytes(b"prototype");
        let name = self.builder.string(text);
        let members = [(plan.writable_name, ObjectMemberKind::Field)];
        let layout = self.file.untyped_layout(&members);
        let mut descriptor = self.begin_object(layout);
        let no = self.builder.boolean(false);
        let writable = PropertyName::Constant(plan.writable_name);
        self.add_property(&mut descriptor, writable, no, None);
        (name, super::object::finish_object(self, descriptor))
    }

    fn emit_written_descriptor(
        &mut self,
        plan: &CreateClassPlan,
        define: ValueId,
        target: ValueId,
        literal: ExprId,
    ) {
        if let Some(written) = self.file.find_what_descriptor_writes(literal) {
            let mut members: SmallVec<[(PropertyKeyId, ObjectMemberKind); 6]> = SmallVec::new();
            for (is_named, name) in [
                (written.names_value, &b"value"[..]),
                (written.names_getter, &b"get"[..]),
                (written.names_setter, &b"set"[..]),
            ] {
                if is_named {
                    let text = self.file.intern_bytes(name);
                    members.push((self.file.text_key(text), ObjectMemberKind::Field));
                }
            }
            members.push((plan.enumerable_name, ObjectMemberKind::Field));
            members.push((plan.configurable_name, ObjectMemberKind::Field));
            if written.names_value {
                members.push((plan.writable_name, ObjectMemberKind::Field));
            }
            let layout = self.file.untyped_layout(&members);
            let mut descriptor = self.begin_object(layout);
            for property in written.properties.iter() {
                if property != written.key {
                    self.lower_property_of_written_literal(&mut descriptor, property);
                }
            }
            if !written.names_enumerable {
                let no = self.builder.boolean(false);
                self.add_property(
                    &mut descriptor,
                    PropertyName::Constant(plan.enumerable_name),
                    no,
                    None,
                );
            }
            let yes = self.builder.boolean(true);
            self.add_property(
                &mut descriptor,
                PropertyName::Constant(plan.configurable_name),
                yes,
                None,
            );
            if written.names_value {
                let yes = self.builder.boolean(true);
                self.add_property(
                    &mut descriptor,
                    PropertyName::Constant(plan.writable_name),
                    yes,
                    None,
                );
            }
            let descriptor = super::object::finish_object(self, descriptor);
            let key = self.lower_expression(self.file.hir[written.key].value);
            let object = self.emit_builtin_itself(BuiltinId::Object);
            super::call::emit_call(self, define, Some(object), &[target, key, descriptor]);
            return;
        }
        let descriptor = self.lower_expression(literal);
        let enumerable_name = PropertyName::Constant(plan.enumerable_name);
        let enumerable = self.emit_get(descriptor, enumerable_name);
        let is_set = self.builder.to_boolean(enumerable);
        let value = self.builder.create_variable(None);
        let (set, unset, joined) = (
            self.create_block(),
            self.create_block(),
            self.create_block(),
        );
        self.builder.branch(is_set, Edge::to(set), Edge::to(unset));
        self.continue_in(set);
        self.builder.write_variable(value, enumerable);
        self.jump(joined);
        self.continue_in(unset);
        let no = self.builder.boolean(false);
        self.builder.write_variable(value, no);
        self.jump(joined);
        self.continue_in(joined);
        let enumerable = self.builder.read_variable(value);
        self.emit_set(descriptor, enumerable_name, enumerable);
        let configurable_name = PropertyName::Constant(plan.configurable_name);
        let yes = self.builder.boolean(true);
        self.emit_set(descriptor, configurable_name, yes);
        let value_name = PropertyName::Constant(plan.value_name);
        let has_value = self.emit_has(descriptor, value_name);
        let has_value = self.builder.to_boolean(has_value);
        let (writes, behind) = (self.create_block(), self.create_block());
        self.builder
            .branch(has_value, Edge::to(writes), Edge::to(behind));
        self.continue_in(writes);
        let writable_name = PropertyName::Constant(plan.writable_name);
        let yes = self.builder.boolean(true);
        self.emit_set(descriptor, writable_name, yes);
        self.jump(behind);
        self.continue_in(behind);
        let key_name = PropertyName::Constant(plan.key_name);
        let key = self.emit_get(descriptor, key_name);
        let object = self.emit_builtin_itself(BuiltinId::Object);
        super::call::emit_call(self, define, Some(object), &[target, key, descriptor]);
    }

    fn lower_public_field(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        let hir = self.file.hir;
        let callee = resolve_public_field(&resolve_input(self.file), self.file.file, site.callee)?;
        let has_value = site.args.len() == 3;
        if !has_value && site.args.len() != 2 {
            return None;
        }
        let written = hir.skip_type_assertions(hir.id_at(site.args, 1));
        let ExprKind::String(name) = hir[written].kind else {
            return None;
        };
        let FunctionKey::Source(source) = self.key else {
            return None;
        };
        let handed = hir.skip_type_assertions(hir.id_at(site.args, 0));
        let is_this = matches!(hir[handed].kind, ExprKind::This);
        if name == known::__proto__ {
            return None;
        }
        let may_be_primitive = match hir[source.function].kind {
            FnKind::Constructor if is_this => false,
            FnKind::Decl | FnKind::Expr
                if is_this
                    || matches!(hir[handed].kind, ExprKind::Ident(_) | ExprKind::Call(_)) =>
            {
                self.file.queries.constructor_function_shape(source)?;
                true
            }
            _ => return None,
        };
        let unwritten = [known::get, known::set];
        if unwritten
            .iter()
            .any(|&word| self.file.is_name_on_object_prototype(word))
        {
            return None;
        }
        let bound = self.file.queries.files().bound(callee.file);
        let scope = bound.fns[callee.defines.definition.idx()].scope;
        let mode = match bound.is_strict_scope(scope) {
            true => ECMAMode::Strict,
            false => ECMAMode::Sloppy,
        };
        let mut object = self.lower_expression(hir.id_at(site.args, 0));
        let value = match has_value {
            true => self.lower_expression(hir.id_at(site.args, 2)),
            false => self.builder.undefined(),
        };
        self.set_position(hir[call].pos);
        let key = PropertyName::Constant(self.file.name_key(name));
        let (is_there, is_not, done) = (
            self.create_block(),
            self.create_block(),
            self.create_block(),
        );
        let result = self.builder.create_variable(None);
        if may_be_primitive {
            let on_object = self.split_on_type(object, TypeTable::OBJECT);
            self.continue_in(on_object.not_taken);
            let function = self.lower_expression(site.callee);
            let written = self.lower_expression(written);
            let no_object = self.claim_primitive(on_object.not_taken_value);
            let arguments = match has_value {
                true => &[no_object, written, value][..],
                false => &[no_object, written],
            };
            // `key in object` throws.
            let thrown = super::call::emit_call(self, function, None, arguments);
            self.builder.throw(thrown);
            self.continue_in(on_object.taken);
            object = self.claim_operand_kind(on_object.taken_value, OperandKind::Object);
        }
        let has = self.emit_has(object, key);
        self.builder
            .branch(has, Edge::to(is_there), Edge::to(is_not));
        self.continue_in(is_there);
        self.emit_define(object, key, value);
        self.builder.write_variable(
            result,
            match callee.answer {
                PublicFieldAnswer::Value => value,
                PublicFieldAnswer::DefinedObjectOrStoredValue | PublicFieldAnswer::Object => object,
            },
        );
        self.jump(done);
        self.continue_in(is_not);
        self.emit_set_in_mode(object, key, value, mode);
        self.builder.write_variable(
            result,
            match callee.answer {
                PublicFieldAnswer::Value | PublicFieldAnswer::DefinedObjectOrStoredValue => value,
                PublicFieldAnswer::Object => object,
            },
        );
        self.jump(done);
        self.continue_in(done);
        self.file.known_helpers_lowered.calls += 1;
        Some(self.builder.read_variable(result))
    }

    /// The value behind a test that it is no object.
    fn claim_primitive(&mut self, value: ValueId) -> ValueId {
        let primitives = [
            TypeTable::NULLISH,
            TypeTable::BOOLEAN,
            TypeTable::NUMBER,
            TypeTable::STRING,
            TypeTable::SYMBOL,
            TypeTable::BIGINT,
        ];
        let primitive = self.file.fragment.types.union_all(primitives);
        self.builder
            .convert(value, DeclaredType::claimed(primitive), IllTypedCause::None)
    }

    pub(super) fn shape_of_one_published_helper(&self, callee: &KnownCallee) -> Option<Shape> {
        let &[held] = &callee.functions[..] else {
            return None;
        };
        let known = self.file.inputs.known_helpers;
        let known = known.function(callee.file, held.definition)?;
        let input = resolve_input(self.file);
        let is_certain = !callee.needs_guard()
            && callee.holds_from_the_start
            && known.names_locked_globals
            && calls_only_published_helpers(&input, callee.file, held.definition);
        is_certain.then_some(known.shape)
    }

    /// The object that the parent answered, or `this`. The helper throws for whatever else it is handed, or answers it as it is.
    fn lower_possible_constructor_return(
        &mut self,
        call: ExprId,
        site: Call,
        callee: &KnownCallee,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        if site.args.len() != 2 {
            return None;
        }
        let shape = self.shape_of_one_published_helper(callee)?;
        let this = self.lower_expression(hir.id_at(site.args, 0));
        let answered = self.lower_expression(hir.id_at(site.args, 1));
        self.set_position(hir[call].pos);
        let join = self.create_block();
        let result = self.builder.add_parameter(join, None);
        let on_object = self.split_on_type(answered, TypeTable::OBJECT);
        self.continue_in(on_object.taken);
        let object = self.builder.to_object(on_object.taken_value, None);
        self.jump_with(join, &[object]);
        self.continue_in(on_object.not_taken);
        let mut answered = self.claim_primitive(on_object.not_taken_value);
        if shape == Shape::PossibleConstructorReturnChecked {
            let on_undefined = self.split_on_type(answered, TypeTable::UNDEFINED);
            self.continue_in(on_undefined.not_taken);
            let undefined = self.builder.undefined();
            let arguments = [undefined, on_undefined.not_taken_value];
            let thrown = self.emit_call_of_helper(call, site, &arguments);
            self.builder.throw(thrown);
            self.continue_in(on_undefined.taken);
            answered = on_undefined.taken_value;
        }
        let on_this = self.split_on_type(this, TypeTable::OBJECT);
        self.continue_in(on_this.taken);
        self.jump_with(join, &[on_this.taken_value]);
        self.continue_in(on_this.not_taken);
        let no_object = self.claim_primitive(on_this.not_taken_value);
        self.emit_call_of_helper(call, site, &[no_object, answered]);
        self.jump_with(join, &[no_object]);
        self.continue_in(join);
        Some(result)
    }

    fn lower_assert_this_initialized(
        &mut self,
        call: ExprId,
        site: Call,
        callee: &KnownCallee,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        if site.args.len() != 1 {
            return None;
        }
        self.shape_of_one_published_helper(callee)?;
        let this = self.lower_expression(hir.id_at(site.args, 0));
        self.set_position(hir[call].pos);
        let join = self.create_block();
        let result = self.builder.add_parameter(join, None);
        let on_this = self.split_on_type(this, TypeTable::OBJECT);
        self.continue_in(on_this.taken);
        self.jump_with(join, &[on_this.taken_value]);
        self.continue_in(on_this.not_taken);
        let no_object = self.claim_primitive(on_this.not_taken_value);
        self.emit_call_of_helper(call, site, &[no_object]);
        self.jump_with(join, &[no_object]);
        self.continue_in(join);
        Some(result)
    }

    fn lower_import_default(
        &mut self,
        call: ExprId,
        site: Call,
        callee: &KnownCallee,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let &[held] = &callee.functions[..] else {
            return None;
        };
        if site.args.len() != 1 {
            return None;
        }
        let is_certain = !callee.needs_guard() && callee.holds_from_the_start;
        let lowered_callee = (!is_certain).then(|| self.lower_callee(site.callee, None, None));
        let Arguments::Values(arguments) = self.lower_arguments(site.args) else {
            unreachable!("a call with a spread argument is not a known call");
        };
        let value = arguments[0];
        self.set_position(hir[call].pos);
        let other_way = lowered_callee.map(|lowered_callee| {
            let slow_path = self.create_block();
            let other_callee = Callee {
                function: self.builder.add_edge_result(slow_path),
                key: None,
                ..lowered_callee
            };
            let helper = reference_function(self.file, callee.file, held.closure);
            let is_helper = self.builder.is_closure_of(helper, lowered_callee.function);
            let passed = self.create_block();
            let differs = Edge::with_proofs(slow_path, &[0]);
            self.builder.branch(is_helper, Edge::to(passed), differs);
            self.continue_in(passed);
            (other_callee, slow_path)
        });
        let result = self.builder.create_variable(None);
        let (asked, marked, wrapped, done) = (
            self.create_block(),
            self.create_block(),
            self.create_block(),
            self.create_block(),
        );
        let is_something = self.builder.to_boolean(value);
        self.builder
            .branch(is_something, Edge::to(asked), Edge::to(wrapped));
        self.continue_in(asked);
        let text = self.file.intern_bytes(b"__esModule");
        let marker = self.file.text_key(text);
        let marker = self.emit_get(value, PropertyName::Constant(marker));
        let is_marked = self.builder.to_boolean(marker);
        self.builder
            .branch(is_marked, Edge::to(marked), Edge::to(wrapped));
        self.continue_in(marked);
        self.builder.write_variable(result, value);
        self.jump(done);
        self.continue_in(wrapped);
        let default_name = self.file.name_key(known::default);
        let members = [(default_name, ObjectMemberKind::Field)];
        let layout = self.file.layout_of_names_made_at(call, &members);
        let mut wrapper = self.begin_object(layout);
        self.add_property(
            &mut wrapper,
            PropertyName::Constant(default_name),
            value,
            None,
        );
        let wrapper = super::object::finish_object(self, wrapper);
        self.builder.write_variable(result, wrapper);
        self.jump(done);
        self.file.known_helpers_lowered.calls += 1;
        if let Some((other_callee, slow_path)) = other_way {
            self.continue_in(slow_path);
            let arguments = Arguments::Values(arguments);
            let returned = self.emit_call_expression(call, other_callee, arguments, Tail::No);
            self.builder.write_variable(result, returned);
            self.jump(done);
        }
        self.continue_in(done);
        Some(self.builder.read_variable(result))
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

    fn lower_private_state_test(
        &mut self,
        call: ExprId,
        site: Call,
        state: PrivateStateSite,
    ) -> Option<ValueId> {
        let lowered = self.lower_call_operands(call, site);
        let Some(collection) = lowered.callee.this else {
            unreachable!("a member callee has a receiver");
        };
        let has_entry = self.emit_state_test(PrivateStateAccess {
            state: state.state,
            collection,
            object: lowered.arguments[0],
        });
        self.emit_guard(has_entry, lowered.slow_path);
        let has_entry = self.builder.boolean(true);
        Some(self.finish_with_slow_path(lowered, has_entry))
    }

    fn emit_call_of_private_accessor(
        &mut self,
        access: PrivateStateAccess,
        accessor: ValueId,
        value: Option<ValueId>,
        receiver_is_argument: bool,
        slow_path: BlockId,
    ) -> ValueId {
        let receiver = access.object;
        let is_not_called = self.create_block();
        let is_function = self.builder.type_test(accessor, TypeTable::FUNCTION);
        self.emit_guard(is_function, is_not_called);
        let mut arguments: SmallVec<[ValueId; 2]> = SmallVec::new();
        let this = match receiver_is_argument {
            true => {
                arguments.push(receiver);
                None
            }
            false => {
                let name = self.file.name_key(known::call);
                let call = self.emit_get(accessor, PropertyName::Constant(name));
                self.guard_builtin(call, BuiltinId::FunctionPrototypeCall, is_not_called);
                Some(receiver)
            }
        };
        arguments.extend(value);
        let result = super::call::emit_call(self, accessor, this, &arguments);
        let done = self.create_block();
        self.jump(done);

        // The helper finds the entry in the collection.
        self.continue_in(is_not_called);
        self.emit_entry_of_collection(access, None);
        self.jump(slow_path);

        self.continue_in(done);
        result
    }

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
        if let PrivateFieldAccess::Add {
            value,
            answers_collection,
        } = kind
        {
            let value = match (state.kind, value) {
                (PrivateStateKind::Brand, _) => None,
                (PrivateStateKind::Field, Some(value)) => Some(lowered.arguments[value]),
                (PrivateStateKind::Field, None) => Some(self.builder.undefined()),
            };
            self.emit_state_addition(access, value, lowered.slow_path);
            let result = match answers_collection {
                true => access.collection,
                false => self.builder.undefined(),
            };
            return Some(self.finish_with_slow_path(lowered, result));
        }
        let has_entry = self.emit_state_test(access);
        self.emit_guard(has_entry, lowered.slow_path);
        let result = match kind {
            PrivateFieldAccess::Get => self.emit_state_get(access),
            PrivateFieldAccess::Set { value } => {
                self.emit_state_set(access, lowered.arguments[value]);
                lowered.arguments[value]
            }
            PrivateFieldAccess::GetMethod { member } => lowered.arguments[member],
            PrivateFieldAccess::GetReceiver => access.object,
            PrivateFieldAccess::ApplyDescriptor { function, value } => {
                let home = callee.file;
                let function = reference_function(self.file, home, function);
                let mut parameters: SmallVec<[ValueId; 3]> =
                    SmallVec::from_slice(&[access.object, self.emit_state_get(access)]);
                let value = value.map(|value| lowered.arguments[value]);
                parameters.extend(value);
                let answer = self.emit_direct_call(
                    function,
                    EntryArguments {
                        this: None,
                        new_target: None,
                        parameters: &parameters,
                    },
                );
                value.unwrap_or(answer)
            }
            PrivateFieldAccess::Has => self.builder.boolean(true),
            PrivateFieldAccess::CallGetter {
                getter,
                receiver_is_argument,
            } => {
                let getter = lowered.arguments[getter];
                let slow_path = lowered.slow_path;
                self.emit_call_of_private_accessor(
                    access,
                    getter,
                    None,
                    receiver_is_argument,
                    slow_path,
                )
            }
            PrivateFieldAccess::CallSetter {
                setter,
                value,
                receiver_is_argument,
            } => {
                let (setter, value) = (lowered.arguments[setter], lowered.arguments[value]);
                let slow_path = lowered.slow_path;
                self.emit_call_of_private_accessor(
                    access,
                    setter,
                    Some(value),
                    receiver_is_argument,
                    slow_path,
                );
                value
            }
            PrivateFieldAccess::Add { .. } | PrivateFieldAccess::Update => {
                unreachable!("lowered elsewhere")
            }
        };
        Some(self.finish_with_slow_path(lowered, result))
    }

    fn lower_static_member_access(&mut self, call: ExprId, site: Call) -> Option<ValueId> {
        let helper_call =
            resolve_private_field_call(&resolve_input(self.file), self.file.file, call)?;
        if !helper_call.compares_classes() {
            return None;
        }
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

pub(super) fn resolve_input<'x, 's>(
    file: &'x FileLowering<'_, '_, '_, 's>,
) -> ResolveInput<'x, 's> {
    ResolveInput {
        files: file.queries.files(),
        modules: file.inputs.modules,
        helpers: file.inputs.known_helpers,
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn resolves_to_builtin(&self, (path, builtin): BuiltinPathExpr) -> bool {
        match self.builtins.of_pure_expr(path) {
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

    fn find_has_own_property(&self, export_star: FnId) -> Option<(BuiltinPathExpr, Atom)> {
        let hir = self.hir;
        let [for_in] = find_statements(self.hir, export_star)[..] else {
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
        let callee = find_callee(self.hir, operand)?;
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

    pub(in crate::lower) fn find_create_binding_builtins(
        &self,
        create_binding: FnId,
        shape: Shape,
    ) -> Option<(SmallVec<[BuiltinPathExpr; 2]>, ExprId)> {
        let mut builtins = SmallVec::new();
        let define = match (shape, &find_statements(self.hir, create_binding)[..]) {
            (Shape::CreateBindingReusesDescriptor, &[_, describe, _, define]) => {
                let describe = find_first_initializer(self, describe)?;
                let describe = find_callee(self.hir, describe)?;
                builtins.push((describe, BuiltinId::ObjectGetOwnPropertyDescriptor));
                define
            }
            (Shape::CreateBindingDefinesGetter, &[_, define]) => define,
            _ => return None,
        };
        let StmtKind::Expr(define) = self.hir[define].kind else {
            return None;
        };
        let path = find_callee(self.hir, define)?;
        builtins.push((path, BuiltinId::ObjectDefineProperty));
        let mut paths = builtins.iter();
        let is_resolved = paths.all(|&expected| self.resolves_to_builtin(expected));
        is_resolved.then_some((builtins, define))
    }

    fn find_written_descriptors(&self, list: ExprId) -> Option<SmallVec<[ExprId; 4]>> {
        let (hir, list) = (self.hir, self.skip_type_syntax(list));
        let mut descriptors = SmallVec::new();
        let elements = match hir[list].kind {
            ExprKind::Null => return Some(descriptors),
            ExprKind::Array(elements) => elements,
            _ => return None,
        };
        for element in hir.ids(elements) {
            let element = self.skip_type_syntax(element);
            let ExprKind::Object(properties) = hir[element].kind else {
                return None;
            };
            let is_written = (0..properties.len()).all(|index| {
                let property = hir[properties.at(index)];
                matches!(property.key, PropKey::Name(_))
                    && matches!(property.kind, PropKind::Init | PropKind::Method)
                    && matches!(
                        hir[self.skip_type_syntax(property.value)].kind,
                        ExprKind::Fn(_)
                            | ExprKind::String(_)
                            | ExprKind::Number(_)
                            | ExprKind::True
                            | ExprKind::False
                    )
            });
            if !is_written {
                return None;
            }
            descriptors.push(element);
        }
        Some(descriptors)
    }

    fn find_what_descriptor_writes(&self, descriptor: ExprId) -> Option<WrittenDescriptor> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[self.skip_type_syntax(descriptor)].kind else {
            return None;
        };
        let words = [
            known::value,
            known::get,
            known::set,
            known::enumerable,
            known::configurable,
            known::writable,
        ];
        if words
            .iter()
            .any(|&word| self.is_name_on_object_prototype(word))
        {
            return None;
        }
        let atoms = &self.queries.files().atoms;
        let mut key = None;
        let mut is_named = [false; 4];
        for id in properties.iter() {
            let property = hir[id];
            let (PropKey::Name(name), PropKind::Init) = (property.key, property.kind) else {
                return None;
            };
            let held = hir[self.skip_type_syntax(property.value)].kind;
            if Some(name) == atoms.lookup(b"key") {
                if key.is_some() || !matches!(held, ExprKind::String(_)) {
                    return None;
                }
                key = Some(id);
                continue;
            }
            let texts: [&[u8]; 4] = [b"value", b"get", b"set", b"enumerable"];
            let place = texts
                .iter()
                .position(|text| Some(name) == atoms.lookup(text))?;
            if is_named[place] || (place == 3 && !matches!(held, ExprKind::True | ExprKind::False))
            {
                return None;
            }
            is_named[place] = true;
        }
        Some(WrittenDescriptor {
            properties,
            key: key?,
            names_value: is_named[0],
            names_getter: is_named[1],
            names_setter: is_named[2],
            names_enumerable: is_named[3],
        })
    }

    fn is_keyed_by_function(&self, descriptor: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[descriptor].kind else {
            return true;
        };
        let key = self.queries.files().atoms.lookup(b"key");
        (0..properties.len()).any(|index| {
            let property = hir[properties.at(index)];
            matches!(property.key, PropKey::Name(name) if Some(name) == key)
                && matches!(
                    hir[self.skip_type_syntax(property.value)].kind,
                    ExprKind::Fn(_)
                )
        })
    }

    fn plan_create_class(&mut self, home: FileId, create_class: FnId) -> Option<CreateClassPlan> {
        let helpers = self.inputs.known_helpers;
        let files = self.queries.files();
        let hir = files.hir(home);
        let known = helpers.function(home, create_class)?;
        let (defines_both_sides, locks_prototype) = match known.shape {
            Shape::CreateClassDefinesBothSides => (true, false),
            Shape::CreateClassDefinesBothSidesAndLocksPrototype => (true, true),
            Shape::CreateClassDefinesPrototype => (false, false),
            Shape::CreateClassDefinesAndLocksPrototype => (false, true),
            _ => return None,
        };
        let [reference] = known.references[..] else {
            return None;
        };
        let define_properties =
            resolve_reference(&resolve_input(self), home, reference, &|shape| {
                matches!(
                    shape,
                    Shape::DefinePropertiesOfDescriptors
                        | Shape::DefinePropertiesOfDescriptorsUnderConvertedKeys
                )
            })?;
        let definition = define_properties.function.definition;
        let defines = helpers.function(home, definition)?;
        let converts_keys = defines.shape == Shape::DefinePropertiesOfDescriptorsUnderConvertedKeys;
        if converts_keys && !calls_only_published_helpers(&resolve_input(self), home, definition) {
            return None;
        }
        let builtins = match home == self.file {
            true => self.builtins,
            false => &parsed_source(files, home)?.builtins,
        };
        let find_define_property = |path: ExprId| match builtins.of_pure_expr(path) {
            Some(Resolved::Builtin(path)) if path.id == BuiltinId::ObjectDefineProperty => {
                Some(path.locked_builtin().is_some())
            }
            _ => None,
        };
        let statements = find_statements(hir, definition);
        let &[loop_statement] = &statements[..] else {
            return None;
        };
        let StmtKind::For { body, .. } = hir[loop_statement].kind else {
            return None;
        };
        let StmtKind::Block(body) = hir[body].kind else {
            return None;
        };
        let last = hir.ids(body).last()?;
        let StmtKind::Expr(define) = hir[last].kind else {
            return None;
        };
        let define_property = find_callee(hir, find_last_of_sequence(hir, define, 0)?)?;
        let mut builtins_are_locked = find_define_property(define_property)?;
        let (mut lock_prototype, mut lock_prototype_callee) = (None, None);
        if locks_prototype {
            let statements = find_statements(hir, create_class);
            let lock = match statements[..] {
                [only] => match hir[only].kind {
                    StmtKind::Return(value) if value.is_some() => {
                        find_last_of_sequence(hir, value, 1)?
                    }
                    _ => return None,
                },
                _ => match hir[*statements.get(1 + defines_both_sides as usize)?].kind {
                    StmtKind::Expr(lock) => lock,
                    _ => return None,
                },
            };
            let path = find_callee(hir, lock)?;
            builtins_are_locked &= find_define_property(path)?;
            let ExprKind::Call(site) = hir[hir.skip_type_assertions(lock)].kind else {
                return None;
            };
            let site = hir[site];
            lock_prototype = Some((hir.id_at(site.args, 1), hir.id_at(site.args, 2)));
            lock_prototype_callee = Some(path);
        }
        Some(CreateClassPlan {
            defines_both_sides,
            define_properties,
            define_property,
            lock_prototype,
            lock_prototype_callee,
            converts_keys,
            builtins_are_locked,
            prototype_name: {
                let text = self.intern_bytes(b"prototype");
                self.text_key(text)
            },
            enumerable_name: {
                let text = self.intern_bytes(b"enumerable");
                self.text_key(text)
            },
            configurable_name: {
                let text = self.intern_bytes(b"configurable");
                self.text_key(text)
            },
            writable_name: {
                let text = self.intern_bytes(b"writable");
                self.text_key(text)
            },
            value_name: {
                let text = self.intern_bytes(b"value");
                self.text_key(text)
            },
            key_name: {
                let text = self.intern_bytes(b"key");
                self.text_key(text)
            },
        })
    }

    pub(in crate::lower) fn find_operand_of_typeof_helper(&self, call: ExprId) -> Option<ExprId> {
        let (hir, helpers) = (self.hir, self.inputs.known_helpers);
        if !helpers.has_bindings() {
            return None;
        }
        let ExprKind::Call(id) = hir[call].kind else {
            return None;
        };
        let site = hir[id];
        if !is_plain_call(self, site) || site.args.len() != 1 {
            return None;
        }
        let callee = resolve_callee(&resolve_input(self), self.file, site.callee)?;
        let [held] = callee.functions[..] else {
            return None;
        };
        let known = helpers.function(callee.file, held.definition)?;
        let is_helper = callee.file == self.file
            && !callee.needs_guard()
            && known.shape == Shape::TypeofAnswersSymbolForSymbols
            && known.relies_on_facts
            && known.is_named_only_to_be_called;
        let operand = hir.ids(site.args).next()?;
        let target = self.skip_type_syntax(operand);
        let is_declared = !matches!(self.bound.binding(target), Binding::Free)
            && self
                .bound
                .dynamic_lookup_scope(NodeData::Expr(target))
                .is_none();
        let is_read_alike = !matches!(hir[target].kind, ExprKind::Ident(_))
            || is_declared
            || self.is_always_resolvable(target);
        (is_helper && is_read_alike).then_some(operand)
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

fn find_statements(hir: &hir::File<'_>, function: FnId) -> SmallVec<[StmtId; 8]> {
    match hir[function].body {
        FnBody::Block(statements) => hir.ids(statements).collect(),
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

fn find_last_of_sequence(hir: &hir::File<'_>, sequence: ExprId, skipped: usize) -> Option<ExprId> {
    let mut sequence = hir.skip_type_assertions(sequence);
    for _ in 0..skipped {
        let ExprKind::Binary {
            op: BinOp::Comma,
            left,
            ..
        } = hir[sequence].kind
        else {
            return None;
        };
        sequence = hir.skip_type_assertions(left);
    }
    match hir[sequence].kind {
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => Some(hir.skip_type_assertions(right)),
        _ => Some(sequence),
    }
}

fn find_callee(hir: &hir::File<'_>, call: ExprId) -> Option<ExprId> {
    let ExprKind::Call(site) = hir[hir.skip_type_assertions(call)].kind else {
        return None;
    };
    Some(hir.skip_type_assertions(hir[site].callee))
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
    use std::sync::Arc;

    use crate::compile::testing::lower_program;
    use crate::ir::generated::{Function, visit_value_fields};
    use crate::ir::{FieldWord, Opcode, ValueId, ValueView};
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

    fn lower_module_bodies(files: &[(&str, &str)]) -> Vec<Arc<Function>> {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_source: false,
            reparses_function_sources: false,
            removable: Default::default(),
            minifies_identifiers: false,
            obfuscates: false,
            counts_executions: false,
            runs_tests: false,
            divides_small_files: false,
        };
        let lowered = lower_program(files, options);
        let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
        let bodies = fragments.filter_map(|fragment| {
            let body = fragment.module.body?;
            let mut functions = fragment.functions.iter();
            functions
                .find(|(id, _)| *id == body)
                .map(|(_, function)| Arc::clone(function))
        });
        bodies.collect()
    }

    fn values_of(function: &Function) -> impl Iterator<Item = ValueView<'_>> {
        function.body.blocks().flat_map(|block| block.values())
    }

    fn count_in_module_bodies(files: &[(&str, &str)], opcode: Opcode) -> usize {
        let bodies = lower_module_bodies(files);
        let values = bodies.iter().flat_map(|body| values_of(body));
        values.filter(|value| value.opcode == opcode).count()
    }

    fn first_operand(value: ValueView<'_>) -> Option<ValueId> {
        let mut first = None;
        visit_value_fields(
            value.opcode,
            value.fields,
            0,
            &mut |field, at| match field {
                FieldWord::Operand => {
                    first.get_or_insert(ValueId::from_word(value.fields[at]));
                }
                FieldWord::Reference(_) => {}
            },
        );
        first
    }

    fn find_opcode_behind_conversions(function: &Function, mut value: ValueId) -> Option<Opcode> {
        loop {
            let definition = values_of(function).find(|candidate| candidate.id == value)?;
            if definition.opcode != Opcode::Convert {
                return Some(definition.opcode);
            }
            value = first_operand(definition)?;
        }
    }

    #[test]
    fn export_star_takes_no_stand_in_for_the_exports() {
        let star = format!("{HELPERS}__exportStar(require(\"./a.cjs\"), exports);");
        let files = [
            ("main.cjs", "require(\"./star.cjs\").a;"),
            ("star.cjs", star.as_str()),
            ("a.cjs", "exports.a = 1; exports[String(process.pid)] = 2;"),
        ];
        let mut targets = Vec::new();
        for body in lower_module_bodies(&files) {
            let stars = values_of(&body).filter(|value| value.opcode == Opcode::TryReExportFields);
            let operands = stars.filter_map(first_operand);
            targets.extend(operands.map(|target| find_opcode_behind_conversions(&body, target)));
        }
        assert_eq!(targets.len(), 1);
        assert!(targets[0] != Some(Opcode::Boolean));
    }

    const EXPORT: &str = "var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
";

    fn count_objects(main: &str) -> usize {
        count_in_module_bodies(&[("main.cjs", main)], Opcode::NewObject)
    }

    #[test]
    fn export_helper_defines_getters_by_name() {
        let defines = |getters: &str| {
            count_objects(&format!(
                "{EXPORT}var f, names = {{}};\n__export(names, {getters});\nconsole.log(names);"
            ))
        };
        assert_eq!(
            defines("{ a: () => 1, \"b c\": function () {}, d: () => f }"),
            4
        );
        for getters in [
            "{ a: () => 1, 7: () => 2 }",
            "{ a: () => 1, a: () => 2 }",
            "{ a: () => 1, __esModule: () => 2 }",
            "{ a: () => 1, __proto__: () => 2 }",
            "{ a: () => 1, b() {} }",
            "{ a: () => 1, get b() { return f; } }",
            "{ a: () => 1, b: f }",
            "{ a: () => 1, ...f }",
            "{ a: () => 1, [f]: () => 2 }",
        ] {
            assert_eq!(defines(getters), 2, "{getters}");
        }
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
