//! Which template an instruction gets.

use bun_engine_asm::{Cond, Shift};
use bun_engine_bytecode::{Instruction as I, Specialization};
use bun_engine_vm::CellType;
use bun_engine_vm::ic::InlineStore::{AddInObject, InObject};

use super::Compiler;
use super::arithmetic::{Binary, Bitwise, Operator};
use super::call::FixedCall;
use super::test::Kind;
use super::test::Use::{Jump, Store};

macro_rules! binary {
    ($op:ident) => {
        Binary {
            dst: $op.dst,
            lhs: $op.lhs,
            rhs: $op.rhs,
            profile: Some($op.metadata),
        }
    };
}

macro_rules! list_call {
    ($op:ident, $this:ident) => {
        FixedCall {
            dst: $op.dst,
            callee: $op.callee.into(),
            this: $op.$this.into(),
            count: 0,
            arguments: [None; 2],
            frame: 0,
            metadata: $op.metadata,
            specialization: Specialization::Call,
            is_tail: false,
            is_super: false,
        }
    };
}

macro_rules! fixed_call {
    ($op:ident, $this:ident, $count:expr, $arguments:expr) => {
        FixedCall {
            dst: $op.dst,
            callee: $op.callee.into(),
            this: $op.$this.into(),
            count: $count,
            arguments: $arguments,
            frame: $op.frame,
            metadata: $op.metadata,
            specialization: Specialization::Call,
            is_tail: false,
            is_super: false,
        }
    };
}

impl Compiler<'_> {
    pub(super) fn template(&mut self) {
        let of_type = |it: bun_engine_bytecode::CellType| Kind::Cell(CellType(it.0));
        match self.instruction(self.offset) {
            I::Enter(op) => self.enter(op),
            I::Move(op) => self.mov(op),
            I::LoopHint(_) => self.loop_hint(),
            I::Return(op) => self.ret(op),
            I::ToThis(op) => self.to_this(op),
            I::CreateThis(op) => self.create_this(op),
            I::CheckInitialized(op) => self.slow_if_empty(op.value),
            I::CheckThis(op) => self.slow_if_empty(op.this),
            I::BindThis(op) => self.bind_this(op),

            I::ArgumentCount(op) => self.argument_count(op),
            I::GetArgument(op) => self.get_argument(op),
            I::GetFromArguments(op) => self.get_from_arguments(op),
            I::PutToArguments(op) => self.put_to_arguments(op),
            I::EnsureArguments(op) => self.slow_if_empty(op.arguments),
            I::EnsureRest(op) => self.ensure_rest(op),
            I::SpreadArguments(op) => self.spread_arguments(op),
            I::GetArgumentsLength(op) => self.get_arguments_length(op),
            I::GetArgumentByVal(op) => self.get_argument_by_val(op),

            I::CreateScope(op) => self.create_scope(op),
            I::GetScoped(op) => {
                self.get_scoped(op.dst, (op.scope, 0, op.slot), Some(op.metadata), false);
            }
            I::GetOuter(op) => {
                let place = (op.scope, op.depth, op.slot);
                self.get_scoped(op.dst, place, Some(op.metadata), false);
            }
            I::GetScopedChecked(op) => {
                self.get_scoped(op.dst, (op.scope, 0, op.slot), Some(op.metadata), true);
            }
            I::GetOuterChecked(op) => {
                let place = (op.scope, op.depth, op.slot);
                self.get_scoped(op.dst, place, Some(op.metadata), true);
            }
            I::GetInternal(op) => {
                self.get_scoped(op.dst, (op.scope, op.depth, op.slot), None, false);
            }
            I::PutScoped(op) => self.put_scoped((op.scope, 0, op.slot), op.value),
            I::PutOuter(op) => self.put_scoped((op.scope, op.depth, op.slot), op.value),
            I::GetImport(op) => self.get_import(op),
            I::GetGlobal(op) => self.get_global(op),
            I::PutGlobal(op) => self.put_global(op),
            I::ResolveDynamic(op) => self.resolve_dynamic(op),
            I::GetDynamic(op) => self.get_dynamic(op),
            I::PutDynamic(op) => self.put_dynamic(op),
            I::GetDynamicThis(op) => self.get_dynamic_this(op),

            I::GetById(op) => self.get_by_id(op.dst, op.base, op.metadata),
            I::GetByIdDirect(op) => self.get_by_id(op.dst, op.base, op.metadata),
            I::GetHasInstance(op) => self.get_has_instance(op),
            I::GetLength(op) => self.get_length(op),
            I::GetByIdWithThis(op) => self.get_by_id_with_this(op),
            I::GetByVal(op) => self.get_by_val(op),
            I::GetByValWithThis(op) => self.get_by_val_with_this(op),
            I::PutById(op) => self.put_by_id(op),
            I::PutByVal(op) => self.put_by_val([op.base, op.key, op.value], op.metadata, false),
            I::PutByValDirect(op) => {
                self.put_by_val([op.base, op.key, op.value], op.metadata, true);
            }
            I::DeleteById(op) => self.query(op.dst, op.base, None),
            I::DeleteByVal(op) => self.query(op.dst, op.base, Some(op.key)),
            I::InById(op) => self.in_by_id(op),
            I::InByVal(op) => self.in_by_val(op),
            I::GetPrototypeOf(op) => self.get_prototype_of(op),
            I::SetPrototype(op) => self.set_prototype(op),
            I::InstanceofCustom(op) => self.instanceof_custom(op),
            I::Instanceof(op) => self.instanceof(op),
            I::GetInternalField(op) => self.get_internal_field(op),
            I::PutInternalField(op) => self.put_internal_field(op),
            I::HasShapeWithFlags(op) => self.has_shape_with_flags(op),

            I::GetPrivateName(op) => self.get_private_name(op),
            I::PutPrivateName(op) => {
                self.put_private_name(op.base, op.name, Some(op.value), op.metadata, InObject);
            }
            I::DefinePrivateName(op) => {
                let value = Some(op.value);
                self.put_private_name(op.base.into(), op.name, value, op.metadata, AddInObject);
            }
            I::SetPrivateBrand(op) => {
                self.put_private_name(op.base.into(), op.brand, None, op.metadata, AddInObject);
            }
            I::CheckPrivateBrand(op) => self.check_private_brand(op),
            I::HasPrivateName(op) => self.query(op.dst, op.base, Some(op.name.into())),
            I::HasPrivateBrand(op) => self.query(op.dst, op.base, Some(op.brand.into())),

            I::NewObject(op) => self.new_object(op.dst, None, op.metadata),
            I::NewObjectLiteral(op) => {
                self.new_object(op.dst, Some((op.first, op.count)), op.metadata);
            }
            I::NewFunction(op) => self.new_function(op),
            I::NewArray(op) => self.new_array(op),
            I::NewArrayFromConstant(op) => self.new_array_from_constant(op),
            I::NewArrayWithSize(op) => self.new_array_with_size(op),
            I::CreateRest(op) => self.create_rest(op),
            I::CreateDirectArguments(op) => self.create_direct_arguments(op),

            I::Call(op) => self.fixed_call(&fixed_call!(op, this, op.count, [None; 2])),
            I::Call1(op) => self.fixed_call(&fixed_call!(op, this, 2, [Some(op.first), None])),
            I::Call2(op) => {
                let arguments = [Some(op.first), Some(op.second)];
                self.fixed_call(&fixed_call!(op, this, 3, arguments));
            }
            I::TailCall(op) => self.fixed_call(&FixedCall {
                is_tail: true,
                ..fixed_call!(op, this, op.count, [None; 2])
            }),
            I::Construct(op) => self.fixed_call(&FixedCall {
                specialization: Specialization::Construct,
                ..fixed_call!(op, new_target, op.count, [None; 2])
            }),
            I::SuperConstruct(op) => self.fixed_call(&FixedCall {
                specialization: Specialization::Construct,
                is_super: true,
                ..fixed_call!(op, new_target, op.count, [None; 2])
            }),
            I::CallVarargs(op) => {
                let skip = [op.skip_in_list, op.skip_in_frame];
                self.list_call(&list_call!(op, this), op.arguments, skip);
            }
            I::TailCallVarargs(op) => {
                let call = FixedCall {
                    is_tail: true,
                    ..list_call!(op, this)
                };
                self.list_call(&call, op.arguments, [op.skip_in_list, op.skip_in_frame]);
            }
            I::ConstructVarargs(op) => {
                let call = FixedCall {
                    specialization: Specialization::Construct,
                    ..list_call!(op, new_target)
                };
                self.list_call(&call, op.arguments, [0, op.skip_in_frame]);
            }
            I::SuperConstructVarargs(op) => {
                let call = FixedCall {
                    specialization: Specialization::Construct,
                    is_super: true,
                    ..list_call!(op, new_target)
                };
                self.list_call(&call, op.arguments, [0, op.skip_in_frame]);
            }
            I::CallWithSpread(op) => self.call_with_spread(op.dst, op.metadata, false),
            I::TailCallWithSpread(op) => self.call_with_spread(op.dst, op.metadata, true),
            I::ToArgumentList(op) => self.to_argument_list(op.dst, op.value),

            I::Add(op) => self.arithmetic(binary!(op), Operator::Add),
            I::Subtract(op) => self.arithmetic(binary!(op), Operator::Subtract),
            I::Multiply(op) => self.arithmetic(binary!(op), Operator::Multiply),
            I::Divide(op) => self.divide(binary!(op)),
            I::Remainder(op) => self.remainder(binary!(op)),
            I::Exponentiate(op) => self.exponentiate(binary!(op)),
            I::BitAnd(op) => self.bitwise(binary!(op), Bitwise::And),
            I::BitOr(op) => self.bitwise(binary!(op), Bitwise::Or),
            I::BitXor(op) => self.bitwise(binary!(op), Bitwise::Xor),
            I::ShiftLeft(op) => self.bitwise(binary!(op), Bitwise::Shift(Shift::Left)),
            I::ShiftRight(op) => self.bitwise(binary!(op), Bitwise::Shift(Shift::RightArithmetic)),
            I::ShiftRightUnsigned(op) => self.bitwise(binary!(op), Bitwise::UnsignedShift),
            I::ShiftRightUnsignedBits(op) => {
                let op = Binary {
                    dst: op.dst,
                    lhs: op.lhs,
                    rhs: op.rhs,
                    profile: None,
                };
                self.bitwise(op, Bitwise::Shift(Shift::RightLogical));
            }
            I::Negate(op) => self.negate(op.dst, op.value, op.metadata),
            I::BitNot(op) => self.bit_not(op.dst, op.value, op.metadata),
            I::Increment(op) => self.step(op.dst, op.value, None, op.metadata, 1),
            I::Decrement(op) => self.step(op.dst, op.value, None, op.metadata, -1),
            I::PostIncrement(op) => self.step(op.value, op.value, Some(op.old), op.metadata, 1),
            I::PostDecrement(op) => self.step(op.value, op.value, Some(op.old), op.metadata, -1),
            I::Not(op) => self.not(op.dst, op.value),
            I::ToNumber(op) => self.to_number(op.dst, op.value, op.metadata),
            I::ToNumeric(op) => self.to_numeric(op.dst, op.value, op.metadata),
            I::Typeof(op) => self.type_of(op.dst, op.value),
            I::Concatenate(op) => self.concatenate(op),
            I::ToString(op) => self.to_string(op.dst, op.value),
            I::ToPrimitive(op) => self.to_primitive(op.dst, op.value),
            I::ToPropertyKey(op) => self.to_property_key(op.dst, op.value, false),
            I::ToPropertyKeyOrNumber(op) => self.to_property_key(op.dst, op.value, true),
            I::ToObject(op) => self.to_object(op.dst, op.value, op.metadata),

            I::Equal(op) => self.relation(op.lhs, op.rhs, Cond::Eq, Store(op.dst, false)),
            I::NotEqual(op) => self.relation(op.lhs, op.rhs, Cond::Eq, Store(op.dst, true)),
            I::Less(op) => self.relation(op.lhs, op.rhs, Cond::Lt, Store(op.dst, false)),
            I::LessEqual(op) => self.relation(op.lhs, op.rhs, Cond::Le, Store(op.dst, false)),
            I::Greater(op) => self.relation(op.lhs, op.rhs, Cond::Gt, Store(op.dst, false)),
            I::GreaterEqual(op) => self.relation(op.lhs, op.rhs, Cond::Ge, Store(op.dst, false)),
            I::StrictEqual(op) => self.strict_equal(op.lhs, op.rhs, Store(op.dst, false)),
            I::StrictNotEqual(op) => self.strict_equal(op.lhs, op.rhs, Store(op.dst, true)),
            I::Below(op) => {
                self.unsigned_relation(op.lhs, op.rhs, Cond::Below, Store(op.dst, false));
            }
            I::BelowEqual(op) => {
                self.unsigned_relation(op.lhs, op.rhs, Cond::BelowEq, Store(op.dst, false));
            }
            I::Identical(op) => self.identical(op.lhs, op.rhs, Store(op.dst, false)),
            I::NotIdentical(op) => self.identical(op.lhs, op.rhs, Store(op.dst, true)),
            I::EqualNull(op) => self.kind(op.value, Kind::EqualNull, Store(op.dst, false)),
            I::NotEqualNull(op) => self.kind(op.value, Kind::EqualNull, Store(op.dst, true)),
            I::IsNullish(op) => self.kind(op.value, Kind::Nullish, Store(op.dst, false)),
            I::IsBoolean(op) => self.kind(op.value, Kind::Boolean, Store(op.dst, false)),
            I::IsNumber(op) => self.kind(op.value, Kind::Number, Store(op.dst, false)),
            I::IsObject(op) => self.kind(op.value, Kind::Object, Store(op.dst, false)),
            I::IsCallable(op) => self.kind(op.value, Kind::Function, Store(op.dst, false)),
            I::IsCellOfType(op) => {
                self.kind(op.value, of_type(op.cell_type), Store(op.dst, false));
            }
            I::TypeofIsUndefined(op) => {
                self.kind(op.value, Kind::TypeofUndefined, Store(op.dst, false));
            }
            I::TypeofIsObject(op) => self.kind(op.value, Kind::TypeofObject, Store(op.dst, false)),
            I::TypeofIsFunction(op) => self.kind(op.value, Kind::Function, Store(op.dst, false)),

            I::Goto(op) => self.goto(op),
            I::JumpIfTrue(op) => self.truth(op.value, Jump(op.target, false)),
            I::JumpIfFalse(op) => self.truth(op.value, Jump(op.target, true)),
            I::JumpIfEqual(op) => self.relation(op.lhs, op.rhs, Cond::Eq, Jump(op.target, false)),
            I::JumpIfNotEqual(op) => self.relation(op.lhs, op.rhs, Cond::Eq, Jump(op.target, true)),
            I::JumpIfLess(op) => self.relation(op.lhs, op.rhs, Cond::Lt, Jump(op.target, false)),
            I::JumpIfNotLess(op) => self.relation(op.lhs, op.rhs, Cond::Lt, Jump(op.target, true)),
            I::JumpIfLessEqual(op) => {
                self.relation(op.lhs, op.rhs, Cond::Le, Jump(op.target, false));
            }
            I::JumpIfNotLessEqual(op) => {
                self.relation(op.lhs, op.rhs, Cond::Le, Jump(op.target, true));
            }
            I::JumpIfGreater(op) => self.relation(op.lhs, op.rhs, Cond::Gt, Jump(op.target, false)),
            I::JumpIfNotGreater(op) => {
                self.relation(op.lhs, op.rhs, Cond::Gt, Jump(op.target, true));
            }
            I::JumpIfGreaterEqual(op) => {
                self.relation(op.lhs, op.rhs, Cond::Ge, Jump(op.target, false));
            }
            I::JumpIfNotGreaterEqual(op) => {
                self.relation(op.lhs, op.rhs, Cond::Ge, Jump(op.target, true));
            }
            I::JumpIfStrictEqual(op) => self.strict_equal(op.lhs, op.rhs, Jump(op.target, false)),
            I::JumpIfStrictNotEqual(op) => self.strict_equal(op.lhs, op.rhs, Jump(op.target, true)),
            I::JumpIfBelow(op) => {
                self.unsigned_relation(op.lhs, op.rhs, Cond::Below, Jump(op.target, false));
            }
            I::JumpIfBelowEqual(op) => {
                self.unsigned_relation(op.lhs, op.rhs, Cond::BelowEq, Jump(op.target, false));
            }
            I::JumpIfIdentical(op) => self.identical(op.lhs, op.rhs, Jump(op.target, false)),
            I::JumpIfNotIdentical(op) => self.identical(op.lhs, op.rhs, Jump(op.target, true)),
            I::JumpIfEqualNull(op) => self.kind(op.value, Kind::EqualNull, Jump(op.target, false)),
            I::JumpIfNotEqualNull(op) => {
                self.kind(op.value, Kind::EqualNull, Jump(op.target, true));
            }
            I::JumpIfNullish(op) => self.kind(op.value, Kind::Nullish, Jump(op.target, false)),
            I::JumpIfNotNullish(op) => self.kind(op.value, Kind::Nullish, Jump(op.target, true)),
            I::JumpIfNumber(op) => self.kind(op.value, Kind::Number, Jump(op.target, false)),
            I::JumpIfNotNumber(op) => self.kind(op.value, Kind::Number, Jump(op.target, true)),
            I::JumpIfObject(op) => self.kind(op.value, Kind::Object, Jump(op.target, false)),
            I::JumpIfNotObject(op) => self.kind(op.value, Kind::Object, Jump(op.target, true)),
            I::JumpIfCellOfType(op) => {
                self.kind(op.value, of_type(op.cell_type), Jump(op.target, false));
            }
            I::JumpIfNotCellOfType(op) => {
                self.kind(op.value, of_type(op.cell_type), Jump(op.target, true));
            }
            I::JumpIfTypeofUndefined(op) => {
                self.kind(op.value, Kind::TypeofUndefined, Jump(op.target, false));
            }
            I::JumpIfTypeofNotUndefined(op) => {
                self.kind(op.value, Kind::TypeofUndefined, Jump(op.target, true));
            }
            I::JumpIfTypeofObject(op) => {
                self.kind(op.value, Kind::TypeofObject, Jump(op.target, false));
            }
            I::JumpIfTypeofNotObject(op) => {
                self.kind(op.value, Kind::TypeofObject, Jump(op.target, true));
            }
            I::JumpIfTypeofFunction(op) => {
                self.kind(op.value, Kind::Function, Jump(op.target, false));
            }
            I::JumpIfTypeofNotFunction(op) => {
                self.kind(op.value, Kind::Function, Jump(op.target, true));
            }
            I::JumpIfBuiltin(op) => self.jump_if_builtin(op),
            I::SwitchInt(op) => self.switch_int(op),
            I::SwitchChar(op) => self.switch_char(op),
            I::SwitchString(op) => self.switch_string(op),

            I::RethrowIfAny(op) => self.slow_unless_empty(op.exception),
            I::ThrowIfNotObject(op) => self.throw_if_not_object(op),
            I::ThrowIfNullish(op) => self.throw_if_nullish(op),

            I::ForInOpen(op) => self.for_in_open(op),
            I::ForInNext(op) => self.for_in_next(op),
            I::ForInGet(op) => self.for_in_get(op),
            I::ForInPut(op) => self.for_in_put(op),
            I::ForInHas(op) => self.for_in_has(op),
            I::ForInHasOwn(op) => self.for_in_has_own(op),
            I::NewArrayWithSpread(op) => self.new_array_with_spread(op),
            I::Spread(op) => self.spread(op),
            I::IteratorOpen(op) => self.iterator_open(op),
            I::IteratorNext(op) => self.iterator_next(op),
            I::IteratorBegin(op) => self.iterator_begin(op),
            I::IteratorStep(op) => self.iterator_step(op),
            I::IteratorSkip(op) => self.iterator_skip(op),
            I::IteratorRest(op) => self.iterator_rest(op),
            I::IteratorClose(op) => self.iterator_close(op),

            I::ResumeDispatch(_) => self.resume_dispatch(),
            I::Suspend(op) => self.suspend(op),
            I::Resume(op) => self.resume(op),
            I::ResumeAfterYield(op) => self.resume_normally(op.dst, op.metadata, Some(op.normal)),
            I::ResumeAfterAwait(op) => self.resume_normally(op.dst, op.metadata, None),
            I::ResumeAfterDelegate(op) => self.resume_after_delegate(op),
            I::GeneratorReturn(op) => self.generator_return(op),
            I::ResumeGenerator(op) => self.resume_generator(op),

            I::Debug(op) => self.debug(op),
            I::Cover(op) => self.cover(op),

            _ => self.call_slow_path(),
        }
    }
}
