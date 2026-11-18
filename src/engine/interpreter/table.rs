//! The handler of each opcode, for each width.

use bun_engine_bytecode::{Narrow, Opcode, Wide16, Wide32, Width, op};

use crate::fast::{
    allocation::*, calls::*, control::*, elements::*, exotic::*, frames::*, iteration::*,
    operators::*, properties::*, scopes::*, suspension::*,
};
use crate::machine::Handler;
use crate::slow::calls::{FillVarargsFrame, PrepareFixedCall, SizeVarargsFrame};
use crate::slow::{self, SlowPath};
use crate::stubs;

/// The instructions that call.
macro_rules! is_call {
    ($name:ident, $yes:expr, $no:expr) => { is_call!(@test $name, $yes, $no) };
    (@test Call, $yes:expr, $no:expr) => { $yes };
    (@test Call1, $yes:expr, $no:expr) => { $yes };
    (@test Call2, $yes:expr, $no:expr) => { $yes };
    (@test TailCall, $yes:expr, $no:expr) => { $yes };
    (@test Construct, $yes:expr, $no:expr) => { $yes };
    (@test SuperConstruct, $yes:expr, $no:expr) => { $yes };
    (@test CallVarargs, $yes:expr, $no:expr) => { $yes };
    (@test TailCallVarargs, $yes:expr, $no:expr) => { $yes };
    (@test ConstructVarargs, $yes:expr, $no:expr) => { $yes };
    (@test SuperConstructVarargs, $yes:expr, $no:expr) => { $yes };
    (@test CallWithSpread, $yes:expr, $no:expr) => { $yes };
    (@test TailCallWithSpread, $yes:expr, $no:expr) => { $yes };
    (@test ResumeGenerator, $yes:expr, $no:expr) => { $yes };
    (@test $other:ident, $yes:expr, $no:expr) => { $no };
}

macro_rules! define_slow_tables {
    ($(
        $(#[$doc:meta])*
        $name:ident $mnemonic:ident $flow:ident { $($field:ident: $shape:ident),* } $(=> $metadata:ident)?;
    )*) => {
        const fn slow_handlers<W: Width>() -> [Handler; 256] {
            let mut table = [stubs::throw as Handler; 256];
            $(is_call!($name, (), table[Opcode::$name as usize] = slow::handler::<op::$name, W>);)*
            table
        }

        /// By opcode. `None` for the instructions that call.
        pub static SLOW_PATHS: [Option<SlowPath>; Opcode::COUNT] =
            [$(is_call!($name, None, Some(slow::slow_path::<op::$name>)),)*];

        /// The same, but they leave the top frame of the `Vm` and the call site alone, so `frame` can be any memory that
        /// has a header and the registers that the instruction uses.
        pub static OPERATIONS: [Option<SlowPath>; Opcode::COUNT] =
            [$(is_call!($name, None, Some(slow::operation::<op::$name>)),)*];
    };
}

bun_engine_bytecode::instruction_table!(define_slow_tables);

macro_rules! fast_handlers {
    ($($Op:ident $handler:ident,)* @fixed $($Fixed:ident)* @varargs $($Varargs:ident)*) => {
        const fn handlers<W: Width>() -> [Handler; 256] {
            let mut table = slow_handlers::<W>();
            $(table[Opcode::$Op as usize] = $handler::<W>;)*
            $(table[Opcode::$Fixed as usize] = fixed_call::<op::$Fixed, W>;)*
            $(table[Opcode::$Varargs as usize] = varargs_call::<op::$Varargs, W>;)*
            table[Opcode::ResumeGenerator as usize] = resume_generator::<W>;
            table
        }

        pub fn fixed_call_preparation(opcode: Opcode) -> Option<PrepareFixedCall> {
            match opcode {
                $(Opcode::$Fixed => Some(slow::calls::prepare_fixed_call::<op::$Fixed>),)*
                Opcode::ResumeGenerator => Some(slow::suspension::prepare_resumption),
                _ => None,
            }
        }

        pub fn varargs_call_preparation(opcode: Opcode) -> Option<(SizeVarargsFrame, FillVarargsFrame)> {
            match opcode {
                $(Opcode::$Varargs => Some((
                    slow::calls::size_varargs_frame::<op::$Varargs>,
                    slow::calls::fill_varargs_frame::<op::$Varargs>,
                )),)*
                _ => None,
            }
        }

        fn call_stub<W: Width>(opcode: Opcode) -> Option<Handler> {
            match opcode {
                $(Opcode::$Fixed => Some(stubs::call::<op::$Fixed, W>),)*
                $(Opcode::$Varargs => Some(stubs::call::<op::$Varargs, W>),)*
                Opcode::ResumeGenerator => Some(stubs::call::<op::ResumeGenerator, W>),
                _ => access_stub::<W>(opcode),
            }
        }
    };
}

macro_rules! define_access_stub {
    ($($Getter:ident)*; $($Setter:ident)*) => {
        fn access_stub<W: Width>(opcode: Opcode) -> Option<Handler> {
            match opcode {
                $(Opcode::$Getter => Some(stubs::call::<op::$Getter, W>),)*
                $(Opcode::$Setter => Some(stubs::call::<op::$Setter, W>),)*
                _ => None,
            }
        }
    };
}

slow::calls::with_accesses!(define_access_stub);

fast_handlers! {
    Wide16Prefix wide16_prefix,
    Wide32Prefix wide32_prefix,
    Enter enter,
    Move mov,
    LoopHint loop_hint,
    Return ret,
    ToThis to_this,
    CreateThis create_this,
    CheckInitialized check_initialized,
    CheckThis check_this,
    BindThis bind_this,
    ArgumentCount argument_count,
    GetArgument get_argument,
    GetArgumentsLength get_arguments_length,
    GetArgumentByVal get_argument_by_val,
    CreateDirectArguments create_direct_arguments,
    GetFromArguments get_from_arguments,
    PutToArguments put_to_arguments,
    EnsureArguments ensure_arguments,
    CreateScope create_scope,
    GetScoped get_scoped,
    GetOuter get_outer,
    GetScopedChecked get_scoped_checked,
    GetOuterChecked get_outer_checked,
    GetInternal get_internal,
    PutScoped put_scoped,
    PutOuter put_outer,
    GetImport get_import,
    GetGlobal get_global,
    PutGlobal put_global,
    ResolveDynamic resolve_dynamic,
    GetDynamic get_dynamic,
    PutDynamic put_dynamic,
    GetDynamicThis get_dynamic_this,
    GetById get_by_id,
    GetLength get_length,
    GetByIdDirect get_by_id_direct,
    GetByIdWithThis get_by_id_with_this,
    GetByVal get_by_val,
    PutById put_by_id,
    PutByVal put_by_val,
    PutByValDirect put_by_val_direct,
    DeleteById delete_by_id,
    DeleteByVal delete_by_val,
    InById in_by_id,
    InByVal in_by_val,
    Instanceof instanceof,
    GetPrototypeOf get_prototype_of,
    SetPrototype set_prototype,
    GetHasInstance get_has_instance,
    InstanceofCustom instanceof_custom,
    GetInternalField get_internal_field,
    PutInternalField put_internal_field,
    GetPrivateName get_private_name,
    PutPrivateName put_private_name,
    DefinePrivateName define_private_name,
    HasPrivateName has_private_name,
    HasPrivateBrand has_private_brand,
    SetPrivateBrand set_private_brand,
    CheckPrivateBrand check_private_brand,
    ForInOpen for_in_open,
    ForInNext for_in_next,
    ForInGet for_in_get,
    ForInPut for_in_put,
    ForInHas for_in_has,
    ForInHasOwn for_in_has_own,
    IteratorOpen iterator_open,
    IteratorNext iterator_next,
    IteratorBegin iterator_begin,
    IteratorStep iterator_step,
    IteratorSkip iterator_skip,
    IteratorClose iterator_close,
    Spread spread,
    NewArrayWithSpread new_array_with_spread,
    NewArray new_array,
    NewArrayFromConstant new_array_from_constant,
    NewArrayWithSize new_array_with_size,
    CreateRest create_rest,
    EnsureRest ensure_rest,
    SpreadArguments spread_arguments,
    NewObject new_object,
    NewObjectLiteral new_object_literal,
    NewFunction new_function,
    Add add,
    Subtract subtract,
    Multiply multiply,
    Divide divide,
    Remainder remainder,
    BitAnd bit_and,
    BitOr bit_or,
    BitXor bit_xor,
    ShiftLeft shift_left,
    ShiftRight shift_right,
    ShiftRightUnsigned shift_right_unsigned,
    ShiftRightUnsignedBits shift_right_unsigned_bits,
    Negate negate,
    BitNot bit_not,
    Increment increment,
    Decrement decrement,
    PostIncrement post_increment,
    PostDecrement post_decrement,
    Not not,
    ToNumber to_number,
    ToNumeric to_numeric,
    ToString to_string,
    ToPrimitive to_primitive,
    ToPropertyKey to_property_key,
    ToPropertyKeyOrNumber to_property_key_or_number,
    ToObject to_object,
    Equal equal,
    NotEqual not_equal,
    StrictEqual strict_equal,
    StrictNotEqual strict_not_equal,
    Less less,
    LessEqual less_equal,
    Greater greater,
    GreaterEqual greater_equal,
    Below below,
    BelowEqual below_equal,
    Identical identical,
    NotIdentical not_identical,
    EqualNull equal_null,
    NotEqualNull not_equal_null,
    IsNullish is_nullish_value,
    IsBoolean is_boolean,
    IsNumber is_number,
    IsObject is_object,
    IsCallable is_callable,
    IsCellOfType is_cell_of_type,
    TypeofIsUndefined typeof_is_undefined,
    TypeofIsObject typeof_is_object,
    TypeofIsFunction typeof_is_function,
    Goto goto,
    JumpIfTrue jump_if_true,
    JumpIfFalse jump_if_false,
    JumpIfEqual jump_if_equal,
    JumpIfNotEqual jump_if_not_equal,
    JumpIfStrictEqual jump_if_strict_equal,
    JumpIfStrictNotEqual jump_if_strict_not_equal,
    JumpIfLess jump_if_less,
    JumpIfLessEqual jump_if_less_equal,
    JumpIfGreater jump_if_greater,
    JumpIfGreaterEqual jump_if_greater_equal,
    JumpIfNotLess jump_if_not_less,
    JumpIfNotLessEqual jump_if_not_less_equal,
    JumpIfNotGreater jump_if_not_greater,
    JumpIfNotGreaterEqual jump_if_not_greater_equal,
    JumpIfBelow jump_if_below,
    JumpIfBelowEqual jump_if_below_equal,
    JumpIfIdentical jump_if_identical,
    JumpIfNotIdentical jump_if_not_identical,
    JumpIfEqualNull jump_if_equal_null,
    JumpIfNotEqualNull jump_if_not_equal_null,
    JumpIfNullish jump_if_nullish,
    JumpIfNotNullish jump_if_not_nullish,
    JumpIfNumber jump_if_number,
    JumpIfNotNumber jump_if_not_number,
    JumpIfObject jump_if_object,
    JumpIfNotObject jump_if_not_object,
    JumpIfCellOfType jump_if_cell_of_type,
    JumpIfNotCellOfType jump_if_not_cell_of_type,
    JumpIfTypeofUndefined jump_if_typeof_undefined,
    JumpIfTypeofNotUndefined jump_if_typeof_not_undefined,
    JumpIfTypeofObject jump_if_typeof_object,
    JumpIfTypeofNotObject jump_if_typeof_not_object,
    JumpIfTypeofFunction jump_if_typeof_function,
    JumpIfTypeofNotFunction jump_if_typeof_not_function,
    JumpIfBuiltin jump_if_builtin,
    Cover cover,
    SwitchInt switch_int,
    RethrowIfAny rethrow_if_any,
    ThrowIfNotObject throw_if_not_object,
    ThrowIfNullish throw_if_nullish,
    Debug debug,
    ResumeDispatch resume_dispatch,
    Suspend suspend,
    Await r#await,
    Resume resume,
    ResumeAfterYield resume_after_yield,
    ResumeAfterAwait resume_after_await,
    GeneratorReturn generator_return,
    AsyncReturn async_return,
    NewPromise new_promise,
    CreatePromise create_promise,
    @fixed Call Call1 Call2 TailCall Construct SuperConstruct
    @varargs CallVarargs TailCallVarargs ConstructVarargs SuperConstructVarargs CallWithSpread TailCallWithSpread
}

pub(crate) static NARROW: [Handler; 256] = handlers::<Narrow>();
pub(crate) static WIDE16: [Handler; 256] = handlers::<Wide16>();
pub(crate) static WIDE32: [Handler; 256] = handlers::<Wide32>();

/// Where a callee or an accessor returns to in a frame that is at the instruction which starts at `offset` of `code`.
pub fn return_point(code: &[u8], offset: u32) -> Option<usize> {
    let opcode = |at: u32| Opcode::from_byte(code[at as usize]);
    let stub = match opcode(offset)? {
        Opcode::Wide16Prefix => call_stub::<Wide16>(opcode(offset + 1)?),
        Opcode::Wide32Prefix => call_stub::<Wide32>(opcode(offset + 1)?),
        narrow => call_stub::<Narrow>(narrow),
    };
    Some(stub? as usize + stubs::RETURN_POINT_OFFSET)
}
