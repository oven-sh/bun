//! What each instruction becomes.

use bun_engine_asm::Cond;
use bun_engine_bytecode::{Instruction as I, MetadataKind, Register};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_text::symbols;
use bun_engine_vm::code::metadata::Flags;
use bun_engine_vm::{CallFrame, OFFSET_OF_INTERNAL_FIELDS, SpeculatedType as T};

use super::calls::CallSite;
use super::frame::ArgumentCount;
use super::{Builder, Built};
use crate::graph::{
    Cache, CallKind, Conversion, ExitKind, Kind, Operator, Relation, TypeName, heaps,
};

impl Builder<'_> {
    fn set_boolean(&mut self, dst: Register, boolean: Ssa, is_negated: bool) {
        let boolean = if is_negated {
            self.not(boolean)
        } else {
            boolean
        };
        let value = self.box_boolean(boolean);
        self.set(dst, value);
    }

    fn jump_if(
        &mut self,
        condition: Ssa,
        expected: bool,
        target: bun_engine_bytecode::Jump,
        next: u32,
    ) {
        self.branch(condition, expected, target.from(self.frame().offset), next);
    }

    /// Without `this`, as an I32.
    pub(super) fn argument_count(&mut self) -> Ssa {
        match self.frame().argument_count {
            ArgumentCount::Known(count) => self.int32(count as i32 - 1),
            ArgumentCount::InFrame => {
                let frame_pointer = self.frame_pointer();
                let count = self.load_immutable(
                    Type::I32,
                    frame_pointer,
                    CallFrame::OFFSET_OF_ARGUMENT_COUNT,
                );
                self.ir().sub(count, 1)
            }
        }
    }

    fn require(&mut self, value: Ssa, ty: T) {
        if !self.knowledge.type_of(&self.graph, value).intersects(ty) {
            self.exit_to_throw();
        } else if self.has_exited(ExitKind::BadType) && !self.is(value, ty) {
            self.interpret();
        } else {
            self.check_type(value, ty);
        }
    }

    pub(super) fn translate(&mut self, instruction: I, next: u32) -> Built {
        macro_rules! compare {
            ($op:expr, $relation:ident) => {{
                let result = self.compare(Relation::$relation, $op.lhs, $op.rhs);
                self.set_boolean($op.dst, result, false)
            }};
        }
        macro_rules! compare_and_jump {
            ($op:expr, $relation:ident, $expected:literal) => {{
                let result = self.compare(Relation::$relation, $op.lhs, $op.rhs);
                self.jump_if(result, $expected, $op.target, next)
            }};
        }
        macro_rules! set {
            ($op:expr, $boolean:expr, $is_negated:literal) => {{
                let boolean = $boolean;
                self.set_boolean($op.dst, boolean, $is_negated)
            }};
        }
        macro_rules! jump {
            ($op:expr, $condition:expr, $expected:literal) => {{
                let condition = $condition;
                self.jump_if(condition, $expected, $op.target, next)
            }};
        }
        macro_rules! binary {
            ($op:expr, $operator:ident) => {
                self.operator(
                    Operator::$operator,
                    $op.dst,
                    &[$op.lhs, $op.rhs],
                    $op.metadata,
                )
            };
        }
        macro_rules! unary {
            ($op:expr, $operator:ident) => {
                self.operator(
                    Operator::$operator,
                    $op.dst,
                    &[$op.value.into()],
                    $op.metadata,
                )
            };
        }
        macro_rules! type_name {
            ($op:expr, $name:ident) => {
                self.test_type_name($op.value, TypeName::$name)
            };
        }
        macro_rules! call {
            ($op:expr, $kind:ident, $metadata_kind:ident, $arguments:expr) => {{
                let (callee, arguments) = (self.get($op.callee), $arguments);
                let site = CallSite {
                    kind: CallKind::$kind,
                    dst: Some($op.dst),
                    callee,
                    arguments: &arguments,
                    metadata: $op.metadata,
                };
                return self.call(site, MetadataKind::$metadata_kind);
            }};
        }
        macro_rules! call_varargs {
            ($op:expr, $kind:ident, $metadata_kind:ident, $this:ident, $skip:expr) => {{
                let site = CallSite {
                    kind: CallKind::$kind,
                    dst: Some($op.dst),
                    callee: self.get($op.callee),
                    arguments: &[self.get($op.$this)],
                    metadata: $op.metadata,
                };
                let (list, skip) = (self.get($op.arguments), [$skip, $op.skip_in_frame]);
                return self.call_varargs(site, MetadataKind::$metadata_kind, list, skip);
            }};
        }
        macro_rules! call_with_spread {
            ($op:expr, $kind:ident) => {{
                let site = CallSite {
                    kind: CallKind::$kind,
                    dst: Some($op.dst),
                    callee: self.get($op.callee),
                    arguments: &self.registers_from($op.this, $op.count),
                    metadata: $op.metadata,
                };
                return self.call_with_spread(site, $op.mask, $op.skip_in_frame);
            }};
        }
        macro_rules! call_with_frame {
            ($op:expr, $kind:ident, $metadata_kind:ident, $this:ident) => {
                call!($op, $kind, $metadata_kind, {
                    let this = self.get($op.$this);
                    self.outgoing_arguments(this, $op.frame, $op.count)
                })
            };
        }
        let code_block = self.frame().code_block;
        let code_block = code_block.anchor();
        match instruction {
            I::Enter(op) => self.enter_function(op),
            I::Move(op) => {
                let value = self.get(op.src);
                self.set(op.dst, value);
            }
            // Nothing jumps back.
            I::LoopHint(_) if !self.frame().may_be_jumped_back_to() => {}
            I::LoopHint(_) => {
                self.go_back_no_further();
                self.node(Kind::PollTraps, &[], 0);
                if !self.is_full() {
                    let kind = if self.frame().is_root() {
                        Kind::TierUpInLoop
                    } else {
                        Kind::CountTurn
                    };
                    self.node(kind, &[], 0);
                }
            }
            I::Return(op) => {
                let value = self.get(op.value);
                self.leave_with(value);
            }
            I::ToThis(op) => self.to_this(op),
            I::CreateThis(op) => self.create_this(op),
            I::CheckInitialized(op) => self.require(self.frame().get(op.value), T::HEAP_TOP),
            I::CheckThis(op) => self.require(self.frame().get(op.this), T::HEAP_TOP),
            I::BindThis(op) => {
                self.require(self.frame().get(op.this), T::EMPTY);
                if !self.block.is_none() {
                    self.set(op.this, self.frame().get(op.value));
                }
            }
            I::ArgumentCount(op) => {
                let count = self.argument_count();
                let count = self.box_int32(count);
                self.set(op.dst, count);
            }
            I::GetArgument(op) => self.get_argument(op),
            I::CreateRest(op) => self.create_rest(op),
            I::CreateDirectArguments(op) => self.create_direct_arguments(op),
            I::CreateScopedArguments(op) => self.create_scoped_arguments(op),
            I::CreateUnmappedArguments(op) => self.create_unmapped_arguments(op),
            I::GetFromArguments(op) => self.get_from_arguments(op),
            I::PutToArguments(op) => self.put_to_arguments(op),
            I::EnsureArguments(op) => self.ensure_arguments(op),
            I::EnsureRest(op) => self.ensure_rest(op),
            I::SpreadArguments(op) => self.spread_arguments(op),
            I::GetArgumentsLength(op) => self.get_arguments_length(op),
            I::GetArgumentByVal(op) => self.get_argument_by_val(op, next),

            I::CreateScope(op) => self.create_scope(op),
            I::CopyScope(op) => self.copy_scope(op),
            I::GetScoped(op) => {
                self.get_initialized(op.dst, op.scope, 0, op.slot, op.metadata);
            }
            I::GetOuter(op) => {
                self.get_initialized(op.dst, op.scope, op.depth, op.slot, op.metadata);
            }
            I::GetScopedChecked(op) => {
                self.get_scoped_checked(op.dst, op.scope, 0, op.slot, op.metadata);
            }
            I::GetOuterChecked(op) => {
                self.get_scoped_checked(op.dst, op.scope, op.depth, op.slot, op.metadata);
            }
            I::GetInternal(op) => {
                self.get_scoped(op.dst, op.scope, op.depth, op.slot, None);
            }
            I::PutScoped(op) => self.put_scoped(op.scope, 0, op.slot, op.value),
            I::PutOuter(op) => self.put_scoped(op.scope, op.depth, op.slot, op.value),
            I::GetImport(op) => self.get_import(op),
            I::GetGlobal(op) => self.get_global(op),
            I::PutGlobal(op) => self.put_global(op),
            I::ResolveDynamic(op) => self.resolve_dynamic(op),
            I::GetDynamic(op) => self.get_dynamic(op),
            I::PutDynamic(op) => self.put_dynamic(op),
            I::GetDynamicThis(op) => self.get_dynamic_this(op),

            I::GetById(op) => self.get_cached(
                op.dst,
                op.base,
                code_block.identifier(op.name),
                MetadataKind::GetById,
                op.metadata,
            )?,
            I::GetByIdDirect(op) => self.get_cached(
                op.dst,
                op.base,
                code_block.identifier(op.name),
                MetadataKind::GetByIdDirect,
                op.metadata,
            )?,
            I::GetByIdWithThis(op) => self.get_by_id_with_this(op),
            I::GetByValWithThis(op) => self.get_by_val_with_this(op),
            I::InById(op) => self.in_by_id(op, next)?,
            I::DeleteById(op) => self.delete_by_id(op, next)?,
            I::DeleteByVal(op) => self.delete_by_val(op),
            I::GetPrototypeOf(op) => self.get_prototype_of(op),
            I::GetHasInstance(op) => {
                let constructor = self.get_value(op.constructor);
                if self.is(constructor, T::OBJECT) || !self.has_exited(ExitKind::BadType) {
                    self.check_type(constructor, T::OBJECT);
                    let (name, kind) = (symbols::hasInstance, MetadataKind::GetById);
                    self.get_cached(op.dst, op.constructor, name, kind, op.metadata)?;
                } else {
                    self.interpret();
                }
            }
            I::InstanceofCustom(op) => self.instanceof_custom(op, next),
            I::Instanceof(op) => self.instanceof(op, next)?,
            I::InByVal(op) => self.in_by_val(op),
            I::GetLength(op) => self.get_length(op)?,
            I::PutById(op) => self.put_by_id(op)?,
            I::GetByVal(op) => self.get_by_val(op)?,
            I::PutByVal(op) => {
                let cache = if op.strict {
                    Cache::PutByValStrict
                } else {
                    Cache::PutByVal
                };
                self.put_by_val(op.base, op.key, op.value, op.metadata, cache)?;
            }
            I::PutByValDirect(op) => {
                let cache = Cache::PutByValDirect;
                self.put_by_val(op.base, op.key, op.value, op.metadata, cache)?;
            }
            I::GetInternalField(op) => {
                if let Some(prediction) = self.prediction_or_exit(op.metadata) {
                    let base = self.get(op.base);
                    self.assume_type(base, T::CELL);
                    let (base, offset) = (
                        self.alias(base),
                        (OFFSET_OF_INTERNAL_FIELDS + op.index as usize * 8) as i32,
                    );
                    let value = self.load_value(base, offset, heaps::INTERNAL_FIELDS, prediction);
                    self.set(op.dst, value);
                }
            }
            I::PutInternalField(op) => {
                let (base, value) = (self.get(op.base), self.get(op.value));
                let (base, offset) = (
                    self.alias(base),
                    (OFFSET_OF_INTERNAL_FIELDS + op.index as usize * 8) as i32,
                );
                self.store_value(base, base, offset, heaps::INTERNAL_FIELDS, value);
            }

            I::GetPrivateName(op) => self.get_private_name(op)?,
            I::PutPrivateName(op) => {
                let (value, entry) = (
                    self.get_value(op.value),
                    (MetadataKind::PutPrivateName, op.metadata),
                );
                let operands = [op.base, op.name.into()];
                self.put_private_name(Cache::PutPrivateName, operands, value, entry)?;
            }
            I::DefinePrivateName(op) => {
                let (value, entry) = (
                    self.get_value(op.value),
                    (MetadataKind::PutPrivateName, op.metadata),
                );
                let operands = [op.base.into(), op.name.into()];
                self.put_private_name(Cache::DefinePrivateName, operands, value, entry)?;
            }
            I::SetPrivateBrand(op) => self.set_private_brand(op)?,
            I::CheckPrivateBrand(op) => self.check_private_brand(op),
            I::HasPrivateName(op) => {
                self.has_private_name(op.dst, [op.base, op.name.into()], op.metadata)?;
            }
            I::HasPrivateBrand(op) => {
                self.has_private_name(op.dst, [op.base, op.brand.into()], op.metadata)?;
            }

            I::NewObject(op) => self.new_object(op),
            I::NewObjectLiteral(op) => self.new_object_literal(op),
            I::NewArray(op) => self.new_array(op),
            I::NewArrayFromConstant(op) => self.new_array_from_constant(op),
            I::NewArrayWithSize(op) => self.new_array_with_size(op),
            I::NewArrayWithSpecies(op) => self.new_array_with_species(op),
            I::NewArrayWithSpread(op) => self.new_array_with_spread(op),
            I::Spread(op) => self.spread(op),
            I::NewFunction(op) => self.new_function(op),
            I::NewPromise(op) => {
                let promise = self.new_promise(0, None);
                self.set(op.dst, promise);
            }
            I::CreatePromise(op) => self.create_promise(op),
            I::NewRegExp(op) => self.new_regexp(op.dst, op.regexp),
            I::NewSharedRegExp(op) => self.new_shared_regexp(op),

            I::Call(op) => call_with_frame!(op, Call, Call, this),
            I::Call1(op) => call!(op, Call, Call, [self.get(op.this), self.get(op.first)]),
            I::Call2(op) => call!(
                op,
                Call,
                Call,
                [self.get(op.this), self.get(op.first), self.get(op.second)]
            ),
            I::TailCall(op) if bun_engine_vm::options().use_tail_calls => {
                call_with_frame!(op, TailCall, Call, this)
            }
            I::TailCall(op) => call_with_frame!(op, Call, Call, this),
            I::Construct(op) => call_with_frame!(op, Construct, Call, new_target),
            I::SuperConstruct(op) => call_with_frame!(op, Construct, SuperConstruct, new_target),
            I::ToArgumentList(op) => self.to_argument_list(op),
            I::CallVarargs(op) => call_varargs!(op, Call, Call, this, op.skip_in_list),
            I::TailCallVarargs(op) if bun_engine_vm::options().use_tail_calls => {
                call_varargs!(op, TailCall, Call, this, op.skip_in_list)
            }
            I::TailCallVarargs(op) => call_varargs!(op, Call, Call, this, op.skip_in_list),
            I::ConstructVarargs(op) => call_varargs!(op, Construct, Call, new_target, 0),
            I::SuperConstructVarargs(op) => {
                call_varargs!(op, Construct, SuperConstruct, new_target, 0)
            }
            I::CallWithSpread(op) => call_with_spread!(op, Call),
            I::TailCallWithSpread(op) if bun_engine_vm::options().use_tail_calls => {
                call_with_spread!(op, TailCall)
            }
            I::TailCallWithSpread(op) => call_with_spread!(op, Call),

            I::Add(op) => binary!(op, Add),
            I::Subtract(op) => binary!(op, Subtract),
            I::Multiply(op) => binary!(op, Multiply),
            I::Divide(op) => binary!(op, Divide),
            I::Remainder(op) => binary!(op, Remainder),
            I::Exponentiate(op) => binary!(op, Exponentiate),
            I::BitAnd(op) => binary!(op, BitAnd),
            I::BitOr(op) => binary!(op, BitOr),
            I::BitXor(op) => binary!(op, BitXor),
            I::ShiftLeft(op) => binary!(op, ShiftLeft),
            I::ShiftRight(op) => binary!(op, ShiftRight),
            I::ShiftRightUnsigned(op) => binary!(op, ShiftRightUnsigned),
            I::ShiftRightUnsignedBits(op) => {
                let operator = Operator::ShiftRightUnsignedBits;
                self.operator(operator, op.dst, &[op.lhs, op.rhs], None);
            }
            I::BitNot(op) => unary!(op, BitNot),
            I::Negate(op) => unary!(op, Negate),
            I::ToNumber(op) => unary!(op, ToNumber),
            I::ToNumeric(op) => unary!(op, ToNumeric),
            I::Increment(op) => unary!(op, Increment),
            I::Decrement(op) => unary!(op, Decrement),
            I::PostIncrement(op) => {
                self.step_afterwards(Operator::Increment, op.old, op.value, op.metadata);
            }
            I::PostDecrement(op) => {
                self.step_afterwards(Operator::Decrement, op.old, op.value, op.metadata);
            }
            I::Not(op) => set!(op, self.truth(op.value), true),
            I::Typeof(op) => {
                let value = self.get_value(op.value);
                let name = self.type_of(value);
                self.set(op.dst, name);
            }
            I::Concatenate(op) => self.concatenate_run(op),
            I::ToString(op) => self.convert(Conversion::ToString, op.dst, op.value),
            I::ToPrimitive(op) => self.convert(Conversion::ToPrimitive, op.dst, op.value),
            I::ToPropertyKey(op) => self.convert(Conversion::ToPropertyKey, op.dst, op.value),
            I::ToPropertyKeyOrNumber(op) => {
                self.convert(Conversion::ToPropertyKeyOrNumber, op.dst, op.value);
            }
            I::ToObject(op) => self.to_object(op),

            I::Equal(op) => set!(op, self.loose_equal(op.lhs, op.rhs), false),
            I::NotEqual(op) => set!(op, self.loose_equal(op.lhs, op.rhs), true),
            I::StrictEqual(op) => set!(op, self.strict_equal(op.lhs, op.rhs), false),
            I::StrictNotEqual(op) => set!(op, self.strict_equal(op.lhs, op.rhs), true),
            I::Less(op) => compare!(op, Less),
            I::LessEqual(op) => compare!(op, LessEqual),
            I::Greater(op) => compare!(op, Greater),
            I::GreaterEqual(op) => compare!(op, GreaterEqual),
            I::Below(op) => set!(
                op,
                self.unsigned_compare(Cond::Below, op.lhs, op.rhs),
                false
            ),
            I::BelowEqual(op) => set!(
                op,
                self.unsigned_compare(Cond::BelowEq, op.lhs, op.rhs),
                false
            ),
            I::Identical(op) => set!(op, self.identical(op.lhs, op.rhs), false),
            I::NotIdentical(op) => set!(op, self.identical(op.lhs, op.rhs), true),
            I::EqualNull(op) => set!(op, self.test(Kind::EqualNull, op.value), false),
            I::NotEqualNull(op) => set!(op, self.test(Kind::EqualNull, op.value), true),
            I::IsNullish(op) => set!(op, self.test_type(op.value, T::NULLISH), false),
            I::IsBoolean(op) => set!(op, self.test_type(op.value, T::BOOLEAN), false),
            I::IsNumber(op) => set!(op, self.test_type(op.value, T::BOXED_NUMBER), false),
            I::IsObject(op) => set!(op, self.test_type(op.value, T::OBJECT), false),
            I::IsCallable(op) => {
                let value = self.get_value(op.value);
                set!(op, self.is_callable(value), false);
            }
            I::IsConstructor(op) => {
                let value = self.get_value(op.value);
                set!(op, self.is_constructor(value), false);
            }
            I::IsCellOfType(op) => set!(op, self.test_cell_type(op.value, op.cell_type), false),
            I::HasShapeWithFlags(op) => set!(op, self.has_shape_with_flags(op), false),
            I::TypeofIsUndefined(op) => set!(op, type_name!(op, Undefined), false),
            I::TypeofIsObject(op) => set!(op, type_name!(op, Object), false),
            I::TypeofIsFunction(op) => set!(op, type_name!(op, Function), false),

            I::Goto(op) => self.goto(self.target_at(op.target.from(self.frame().offset))),
            I::JumpIfTrue(op) => jump!(op, self.truth(op.value), true),
            I::JumpIfFalse(op) => jump!(op, self.truth(op.value), false),
            I::JumpIfEqual(op) => jump!(op, self.loose_equal(op.lhs, op.rhs), true),
            I::JumpIfNotEqual(op) => jump!(op, self.loose_equal(op.lhs, op.rhs), false),
            I::JumpIfStrictEqual(op) => jump!(op, self.strict_equal(op.lhs, op.rhs), true),
            I::JumpIfStrictNotEqual(op) => jump!(op, self.strict_equal(op.lhs, op.rhs), false),
            I::JumpIfLess(op) => compare_and_jump!(op, Less, true),
            I::JumpIfLessEqual(op) => compare_and_jump!(op, LessEqual, true),
            I::JumpIfGreater(op) => compare_and_jump!(op, Greater, true),
            I::JumpIfGreaterEqual(op) => compare_and_jump!(op, GreaterEqual, true),
            I::JumpIfNotLess(op) => compare_and_jump!(op, Less, false),
            I::JumpIfNotLessEqual(op) => compare_and_jump!(op, LessEqual, false),
            I::JumpIfNotGreater(op) => compare_and_jump!(op, Greater, false),
            I::JumpIfNotGreaterEqual(op) => compare_and_jump!(op, GreaterEqual, false),
            I::JumpIfBelow(op) => {
                jump!(op, self.unsigned_compare(Cond::Below, op.lhs, op.rhs), true)
            }
            I::JumpIfBelowEqual(op) => jump!(
                op,
                self.unsigned_compare(Cond::BelowEq, op.lhs, op.rhs),
                true
            ),
            I::JumpIfIdentical(op) => jump!(op, self.identical(op.lhs, op.rhs), true),
            I::JumpIfNotIdentical(op) => jump!(op, self.identical(op.lhs, op.rhs), false),
            I::JumpIfEqualNull(op) => jump!(op, self.test(Kind::EqualNull, op.value), true),
            I::JumpIfNotEqualNull(op) => jump!(op, self.test(Kind::EqualNull, op.value), false),
            I::JumpIfNullish(op) => jump!(op, self.test_type(op.value, T::NULLISH), true),
            I::JumpIfNotNullish(op) => jump!(op, self.test_type(op.value, T::NULLISH), false),
            I::JumpIfNumber(op) => jump!(op, self.test_type(op.value, T::BOXED_NUMBER), true),
            I::JumpIfNotNumber(op) => jump!(op, self.test_type(op.value, T::BOXED_NUMBER), false),
            I::JumpIfObject(op) => jump!(op, self.test_type(op.value, T::OBJECT), true),
            I::JumpIfNotObject(op) => jump!(op, self.test_type(op.value, T::OBJECT), false),
            I::JumpIfCellOfType(op) => {
                jump!(op, self.test_cell_type(op.value, op.cell_type), true)
            }
            I::JumpIfNotCellOfType(op) => {
                jump!(op, self.test_cell_type(op.value, op.cell_type), false)
            }
            I::JumpIfTypeofUndefined(op) => jump!(op, type_name!(op, Undefined), true),
            I::JumpIfTypeofNotUndefined(op) => jump!(op, type_name!(op, Undefined), false),
            I::JumpIfTypeofObject(op) => jump!(op, type_name!(op, Object), true),
            I::JumpIfTypeofNotObject(op) => jump!(op, type_name!(op, Object), false),
            I::JumpIfTypeofFunction(op) => jump!(op, type_name!(op, Function), true),
            I::JumpIfTypeofNotFunction(op) => jump!(op, type_name!(op, Function), false),
            I::JumpIfBuiltin(op) => {
                let has_differed = code_block
                    .checked_metadata::<Flags>(MetadataKind::Branch, op.metadata)
                    .0
                    .get()
                    != 0;
                if has_differed || self.has_exited(ExitKind::BadIdentity) {
                    jump!(op, self.identical(op.value.into(), op.builtin), true);
                } else {
                    let (value, builtin) = (self.get(op.value), self.get(op.builtin));
                    self.check_identical(value, builtin);
                    self.goto(self.target_at(op.target.from(self.frame().offset)));
                }
            }
            I::SwitchInt(op) => self.switch_int(op),
            I::SwitchChar(op) => self.switch_char(op),
            I::SwitchString(op) => self.switch_string(op),

            I::Throw(op) => {
                let value = self.get_value(op.value);
                self.throw(value);
            }
            I::Rethrow(op) => self.throw(self.frame().get(op.exception)),
            I::ThrowError(_) | I::ThrowStatic(_) => self.exit_to_throw(),
            I::RethrowIfAny(op) => self.require(self.frame().get(op.exception), T::EMPTY),
            I::ThrowIfNotObject(op) => {
                let value = self.get(op.value);
                self.require(value, T::OBJECT);
            }
            I::ThrowIfNullish(op) => {
                let value = self.get(op.value);
                self.require(value, !T::NULLISH);
            }
            I::ForInOpen(op) => self.for_in_open(op, next),
            I::ForInNext(op) => self.for_in_next(op, next),
            I::ForInGet(op) => self.for_in_get(op),
            I::ForInPut(op) => self.for_in_put(op),
            I::ForInHas(op) => self.for_in_has(op),
            I::ForInHasOwn(op) => self.for_in_has_own(op),
            I::IteratorOpen(op) => self.iterator_open(op, next),
            I::IteratorNext(op) => self.iterator_next(op, next),
            I::IteratorBegin(op) => self.iterator_begin(op),
            I::IteratorStep(op) => self.iterator_step(op),
            I::IteratorSkip(op) => self.iterator_skip(op),
            I::IteratorClose(op) => self.iterator_close(op),

            I::AsyncIteratorNext(op) => self.async_iterator_next(op, next),

            I::ResumeDispatch(_) => self.resume_dispatch(next),
            I::CreateGenerator(op) => self.create_generator(op.dst, op.metadata, next),
            I::CreateAsyncGenerator(op) => self.create_generator(op.dst, op.metadata, next),
            I::Suspend(op) => self.suspend(op),
            I::Await(op) => self.await_value(op),
            I::Resume(op) => self.resume(op),
            I::ResumeAfterYield(op) => self.resume_after_yield(op, next),
            I::ResumeAfterAwait(op) => self.resume_after_await(op),
            I::ResumeAfterDelegate(op) => self.resume_after_delegate(op),
            I::GeneratorReturn(op) => self.generator_return(op),
            I::GeneratorThrow(op) => self.generator_throw(op),
            I::AsyncReturn(op) => self.async_return(op),
            I::AsyncThrow(op) => self.async_throw(op),
            I::ResumeGenerator(op) => self.resume_generator(op),
            _ => self.interpret(),
        }
        Ok(())
    }
}
