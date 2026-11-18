//! At an entry `x9` has the executable.

use core::arch::naked_asm;
use core::mem::offset_of;

use bun_engine_bytecode::Specialization::{Call, Construct};
use bun_engine_macros::in_call_frame;

use super::ProtoFrame;
use crate::{
    CallFrame, Executable, FunctionRareData, InternalFunction, JsFunction, JsResult,
    NativeExecutable, Shape, Value, Vm,
};

/// With the `Vm` in `x21`.
macro_rules! open_entry_frame {
    ($context:literal) => {
        concat!(
            "stp x29, x30, [sp, #-16]!\n",
            "mov x29, sp\n",
            "ldr x9, [x21, #{top_entry_frame}]\n",
            "ldr x10, [x21, #{top_call_frame}]\n",
            "stp x9, x10, [sp, #-16]!\n",
            "stp xzr, ",
            $context,
            ", [sp, #-16]!\n",
            "str x29, [x21, #{top_entry_frame}]",
        )
    };
}

macro_rules! leave_entry_frame {
    () => {
        concat!(
            "ldp x9, x10, [x29, #-16]\n",
            "str x9, [x21, #{top_entry_frame}]\n",
            "str x10, [x21, #{top_call_frame}]\n",
            "mov sp, x29\n",
            "ldp x29, x30, [sp], #16\n",
            "ret",
        )
    };
}

/// The arguments are in x20 to x22.
#[unsafe(naked)]
pub(super) unsafe extern "rust-preserve-none" fn enter(
    entry: usize,
    vm: &Vm,
    frame: &ProtoFrame,
) -> JsResult<Value> {
    naked_asm!(
        open_entry_frame!("xzr"),
        "ldr w10, [x22, #{argument_count}]",
        "add x11, x10, #4",
        "and x11, x11, #-2",
        "sub sp, sp, x11, lsl #3",
        "ldr x11, [x22, #{this_value}]",
        "stp x10, x11, [sp, #16]",
        "ldr x11, [x22, #{arguments}]",
        "add x12, sp, #32",
        "sub w10, w10, #1",
        "cbz w10, 3f",
        "2:",
        "sub w10, w10, #1",
        "ldr x13, [x11, x10, lsl #3]",
        "str x13, [x12, x10, lsl #3]",
        "cbnz w10, 2b",
        "3:",
        "ldp x10, x11, [x22, #{code_block}]",
        "stp x10, x11, [sp]",
        "ldr x9, [x22, #{executable}]",
        "mov x22, #{number_tag}",
        "add x23, x22, #{other_tag}",
        "blr x20",
        leave_entry_frame!(),
        top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
        top_entry_frame = const Vm::OFFSET_OF_TOP_ENTRY_FRAME,
        code_block = const offset_of!(ProtoFrame, code_block),
        argument_count = const offset_of!(ProtoFrame, argument_count_including_this),
        this_value = const offset_of!(ProtoFrame, this_value),
        arguments = const offset_of!(ProtoFrame, arguments),
        executable = const offset_of!(ProtoFrame, executable),
        number_tag = const Value::NUMBER_TAG,
        other_tag = const Value::OTHER_TAG,
    )
}

/// The arguments are in x20 to x28 and x0.
#[unsafe(naked)]
pub(super) unsafe extern "rust-preserve-none" fn enter_short(
    entry: usize,
    vm: &Vm,
    code_block: usize,
    callee: u64,
    argument_count_including_this: u64,
    this_value: u64,
    context: u64,
    executable: usize,
    first: u64,
    second: u64,
) -> JsResult<Value> {
    naked_asm!(
        open_entry_frame!("x26"),
        "stp x28, x0, [sp, #-16]!",
        "stp x24, x25, [sp, #-16]!",
        "stp x22, x23, [sp, #-16]!",
        "mov x9, x27",
        "mov x22, #{number_tag}",
        "add x23, x22, #{other_tag}",
        "blr x20",
        leave_entry_frame!(),
        top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
        top_entry_frame = const Vm::OFFSET_OF_TOP_ENTRY_FRAME,
        number_tag = const Value::NUMBER_TAG,
        other_tag = const Value::OTHER_TAG,
    )
}

/// The same with four words after `this` and without a context. The last argument is in x1.
#[unsafe(naked)]
pub(super) unsafe extern "rust-preserve-none" fn enter_with_four(
    entry: usize,
    vm: &Vm,
    code_block: usize,
    callee: u64,
    argument_count_including_this: u64,
    this_value: u64,
    first: u64,
    executable: usize,
    second: u64,
    third: u64,
    fourth: u64,
) -> JsResult<Value> {
    naked_asm!(
        open_entry_frame!("xzr"),
        "stp x0, x1, [sp, #-16]!",
        "stp x26, x28, [sp, #-16]!",
        "stp x24, x25, [sp, #-16]!",
        "stp x22, x23, [sp, #-16]!",
        "mov x9, x27",
        "mov x22, #{number_tag}",
        "add x23, x22, #{other_tag}",
        "blr x20",
        leave_entry_frame!(),
        top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
        top_entry_frame = const Vm::OFFSET_OF_TOP_ENTRY_FRAME,
        number_tag = const Value::NUMBER_TAG,
        other_tag = const Value::OTHER_TAG,
    )
}

#[unsafe(naked)]
pub(super) unsafe extern "C" fn return_to_native_code_with_exception() {
    naked_asm!(
        "mov x0, #0",
        leave_entry_frame!(),
        top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
        top_entry_frame = const Vm::OFFSET_OF_TOP_ENTRY_FRAME,
    )
}

#[in_call_frame(naked)]
#[unsafe(naked)]
pub unsafe extern "C" fn throw_from_frame() {
    naked_asm!(
        "mov x0, x21",
        "mov x1, x29",
        "bl {unwind}",
        "ldr x29, [x21, #{frame}]",
        "ldr x16, [x21, #{address}]",
        "br x16",
        unwind = sym super::unwind,
        frame = const Vm::OFFSET_OF_CATCH_FRAME,
        address = const Vm::OFFSET_OF_CATCH_ADDRESS,
    )
}

/// `$load` puts the realm in `x0` and the function in `x16`, given the callee in `x2`.
macro_rules! native_entry {
    ($name:ident, [$($load:literal),*], $($operand:ident = $value:expr),*) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(crate) unsafe extern "C" fn $name() {
            naked_asm!(
                "stp x29, x30, [sp, #-16]!",
                "mov x29, sp",
                "str x29, [x21, #{top_call_frame}]",
                "ldr x2, [x29, #{callee}]",
                $($load,)*
                "mov x1, x29",
                "blr x16",
                "ldr x9, [x21, #{exception}]",
                "cbnz x9, 2f",
                "mov x9, #{undefined}",
                "cmp x0, #0",
                "csel x0, x9, x0, eq",
                "ldp x29, x30, [sp], #16",
                "ret",
                "2:",
                "b {throw}",
                top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
                callee = const CallFrame::OFFSET_OF_CALLEE,
                exception = const Vm::OFFSET_OF_EXCEPTION,
                undefined = const Value::UNDEFINED.to_bits(),
                throw = sym throw_from_frame,
                $($operand = const $value,)*
            )
        }
    };
}

native_entry!(
    native_call_entry,
    ["ldr x0, [x2, #{scope}]", "ldr x16, [x9, #{function}]"],
    scope = JsFunction::OFFSET_OF_SCOPE,
    function = NativeExecutable::OFFSET_OF_FUNCTION
);
native_entry!(
    native_construct_entry,
    ["ldr x0, [x2, #{scope}]", "ldr x16, [x9, #{function}]"],
    scope = JsFunction::OFFSET_OF_SCOPE,
    function = NativeExecutable::OFFSET_OF_CONSTRUCTOR
);
native_entry!(
    internal_function_call_entry,
    ["ldr x0, [x2, #{scope}]", "ldr x16, [x2, #{function}]"],
    scope = JsFunction::OFFSET_OF_SCOPE,
    function = InternalFunction::OFFSET_OF_FUNCTION
);
native_entry!(
    internal_function_construct_entry,
    ["ldr x0, [x2, #{scope}]", "ldr x16, [x2, #{function}]"],
    scope = JsFunction::OFFSET_OF_SCOPE,
    function = InternalFunction::OFFSET_OF_CONSTRUCTOR
);
native_entry!(
    call_data_entry,
    [
        "ldr w0, [x2]",
        "ldr x10, [x21, #{shape_base}]",
        "add x0, x0, x10",
        "ldr x0, [x0, #{global}]",
        "mov x16, x9"
    ],
    shape_base = Vm::OFFSET_OF_SHAPE_BASE,
    global = Shape::OFFSET_OF_GLOBAL
);

macro_rules! link_entry {
    ($name:ident, $specialization:expr) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "C" fn $name() {
            naked_asm!(
                "stp x29, x30, [sp, #-16]!",
                "mov x29, sp",
                "str x29, [x21, #{top_call_frame}]",
                "mov x0, x21",
                "mov x1, x29",
                "mov w2, #{specialization}",
                "bl {link}",
                "cbz x0, 2f",
                "ldp x29, x30, [sp], #16",
                "br x0",
                "2:",
                "b {throw}",
                top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
                specialization = const $specialization as u32,
                link = sym super::link,
                throw = sym throw_from_frame,
            )
        }
    };
}

link_entry!(link_call_entry, Call);
link_entry!(link_construct_entry, Construct);

macro_rules! watched_entry {
    ($name:ident, $specialization:expr) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "C" fn $name() {
            naked_asm!(
                "stp x29, x30, [sp, #-16]!",
                "mov x29, sp",
                "str x29, [x21, #{top_call_frame}]",
                "str x9, [sp, #-16]!",
                "mov x0, x21",
                "mov x1, x29",
                "mov w2, #{specialization}",
                "bl {notify}",
                "ldr x9, [sp], #16",
                "ldp x29, x30, [sp], #16",
                "br x0",
                top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
                specialization = const $specialization as u32,
                notify = sym crate::debugger::will_call_native_function,
            )
        }
    };
}

watched_entry!(watched_call_entry, Call);
watched_entry!(watched_construct_entry, Construct);

macro_rules! rare_data_entry {
    ($name:ident, $specialization:expr) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "C" fn $name() {
            naked_asm!(
                "ldr x9, [x9, #{executable}]",
                "ldr x16, [x9, #{code_block}]",
                "str x16, [sp]",
                "ldr x16, [x9, #{entry}]",
                "br x16",
                executable = const FunctionRareData::OFFSET_OF_EXECUTABLE,
                code_block = const Executable::offset_of_code_block($specialization),
                entry = const Executable::offset_of_entry($specialization),
            )
        }
    };
}

rare_data_entry!(rare_data_call_entry, Call);
rare_data_entry!(rare_data_construct_entry, Construct);

/// Baseline code calls these, with its code block in `x19`.
macro_rules! replaced_code_entry {
    ($name:ident, $specialization:expr) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "C" fn $name() {
            naked_asm!(
                "stp x29, x30, [sp, #-16]!",
                "mov x29, sp",
                "mov x0, x19",
                "bl {link_calls}",
                "ldp x29, x30, [sp], #16",
                "ldr x9, [sp, #8]",
                "ldr x9, [x9, #{executable}]",
                "ldr x16, [x9, #{code_block}]",
                "str x16, [sp]",
                "ldr x16, [x9, #{entry}]",
                "br x16",
                link_calls = sym super::link_calls_again,
                executable = const JsFunction::OFFSET_OF_EXECUTABLE,
                code_block = const Executable::offset_of_code_block($specialization),
                entry = const Executable::offset_of_entry($specialization),
            )
        }
    };
}

replaced_code_entry!(replaced_call_entry, Call);
replaced_code_entry!(replaced_construct_entry, Construct);

macro_rules! clearing_entry {
    ($name:ident, $specialization:expr) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "C" fn $name() {
            naked_asm!(
                "ldr x16, [x21, #{lowest}]",
                "mov x17, sp",
                "str x17, [x21, #{lowest}]",
                "b 3f",
                "2:",
                "str xzr, [x16], #8",
                "3:",
                "cmp x16, x17",
                "b.lo 2b",
                "ldr x16, [x9, #{entry}]",
                "br x16",
                lowest = const Vm::OFFSET_OF_LOWEST_STACK_POINTER,
                entry = const Executable::offset_of_entry($specialization),
            )
        }
    };
}

clearing_entry!(clearing_call_entry, Call);
clearing_entry!(clearing_construct_entry, Construct);

#[in_call_frame(naked)]
#[unsafe(naked)]
pub unsafe extern "C" fn pad_arguments() {
    naked_asm!(
        "ldp w1, w2, [x29, #{argument_count}]",
        "cmn w2, #{minus_is_padded}",
        "b.eq 5f",
        "add w1, w1, #{header}",
        "add w0, w0, #{header}",
        // The frame takes an even number of words, before and after.
        "add w2, w0, #1",
        "add w3, w1, #1",
        "and w2, w2, #-2",
        "and w3, w3, #-2",
        "subs w2, w2, w3",
        "b.eq 3f",
        "mov x3, x29",
        "sub x29, x29, x2, lsl #3",
        "mov sp, x29",
        "mov x2, #0",
        "2:",
        "ldr x4, [x3, x2, lsl #3]",
        "str x4, [x29, x2, lsl #3]",
        "add w2, w2, #1",
        "cmp w2, w1",
        "b.lo 2b",
        "3:",
        "mov x4, #{undefined}",
        "4:",
        "str x4, [x29, x1, lsl #3]",
        "add w1, w1, #1",
        "cmp w1, w0",
        "b.lo 4b",
        "ret",
        "5:",
        "str wzr, [x29, #{call_site}]",
        "ret",
        call_site = const CallFrame::OFFSET_OF_CALL_SITE,
        minus_is_padded = const CallFrame::IS_PADDED.wrapping_neg(),
        argument_count = const CallFrame::OFFSET_OF_ARGUMENT_COUNT,
        header = const CallFrame::HEADER_WORDS,
        undefined = const Value::UNDEFINED.to_bits(),
    )
}
