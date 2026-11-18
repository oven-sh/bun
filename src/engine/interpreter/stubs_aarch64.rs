//! A handler has its arguments in x20 to x28 and x0.

use core::arch::naked_asm;

use bun_engine_bytecode::{Narrow, Width};
use bun_engine_macros::in_call_frame;
use bun_engine_vm::{CallFrame, CodeBlock, Value, Vm, call};

use crate::fast::calls::{
    ACCESSOR_FRAME_WORDS, after_call, fill_accessor_frame, fill_varargs_frame, prologue,
    prologue_with_traps,
};
use crate::machine::{CONSTANT_BIAS, Extra, Pc};
use crate::slow::calls::{Returns, VarargsCall};

#[cfg(target_vendor = "apple")]
macro_rules! address_of {
    ($target:literal, $symbol:literal) => {
        concat!(
            "adrp ",
            $target,
            ", ",
            $symbol,
            "@PAGE\n",
            "add ",
            $target,
            ", ",
            $target,
            ", ",
            $symbol,
            "@PAGEOFF\n",
        )
    };
}

#[cfg(not(target_vendor = "apple"))]
macro_rules! address_of {
    ($target:literal, $symbol:literal) => {
        concat!(
            "adrp ", $target, ", ", $symbol, "\n", "add ", $target, ", ", $target, ", :lo12:",
            $symbol, "\n",
        )
    };
}

/// With the code block in x10: the first instruction in x20, and the other registers but the stack pointer.
macro_rules! load_registers {
    () => {
        concat!(
            "ldp x20, x26, [x10, #{instructions}]\n",
            "add x25, x10, #{metadata}\n",
            "sub x26, x26, #{bias}\n",
            "mov x24, x29\n",
        )
    };
}

/// With the code block in x10: where the stack pointer belongs, in x11.
macro_rules! frame_bottom {
    () => {
        concat!("ldr w11, [x10, #{locals}]\n", "sub x11, x29, x11, lsl #3\n")
    };
}

const _: () = assert!(CodeBlock::OFFSET_OF_CONSTANTS == CodeBlock::OFFSET_OF_INSTRUCTIONS + 8);

macro_rules! stub {
    ($(#[$doc:meta])* fn $name:ident $(<$($parameter:ident: $bound:path),*>)?, [$($line:expr),* $(,)?], $($operands:tt)*) => {
        $(#[$doc])*
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(crate) unsafe extern "rust-preserve-none" fn $name $(<$($parameter: $bound),*>)? (
            _: Pc, _: &'static Vm, _: u64, _: u64, _: *mut u64, _: *mut u64, _: *const u64,
            _: Extra, _: Extra, _: Extra,
        ) {
            naked_asm!($($line,)* $($operands)*)
        }
    };
}

stub!(
    fn entry,
    [
        "stp x29, x30, [sp, #-16]!",
        "mov x29, sp",
        "ldr x10, [x29, #{code_block}]",
        // With the call site above it.
        "ldr x1, [x29, #{argument_count}]",
        "ldr w0, [x10, #{parameters}]",
        "cmp x1, x0",
        "b.lo 4f",
        "2:",
        frame_bottom!(),
        "ldr x12, [x21, #{stack_limit}]",
        "cmp x11, x12",
        "b.lt 5f",
        "mov sp, x11",
        load_registers!(),
        "mov x27, x10",
        "b {prologue}",
        "4:",
        "cbz w1, 2b",
        frame_bottom!(),
        "sub x11, x11, x0, lsl #3",
        "ldr x12, [x21, #{real_stack_limit}]",
        "cmp x11, x12",
        "b.lt 6f",
        "bl {pad_arguments}",
        "ldr x10, [x29, #{code_block}]",
        "b 2b",
        "5:",
        "ldr x12, [x21, #{real_stack_limit}]",
        "cmp x11, x12",
        "b.lt 6f",
        "mov sp, x11",
        load_registers!(),
        "mov x27, x10",
        "b {prologue_with_traps}",
        "6:",
        "mov x0, x21",
        "mov x1, x29",
        "bl {overflow}",
        "b {throw}",
    ],
    code_block = const CallFrame::OFFSET_OF_CODE_BLOCK,
    argument_count = const CallFrame::OFFSET_OF_ARGUMENT_COUNT,
    parameters = const CodeBlock::OFFSET_OF_PARAMETERS,
    locals = const CodeBlock::OFFSET_OF_LOCALS,
    instructions = const CodeBlock::OFFSET_OF_INSTRUCTIONS,
    metadata = const CodeBlock::OFFSET_OF_METADATA,
    bias = const CONSTANT_BIAS * 8,
    stack_limit = const Vm::OFFSET_OF_STACK_LIMIT,
    real_stack_limit = const Vm::OFFSET_OF_REAL_STACK_LIMIT,
    prologue = sym prologue::<Narrow>,
    prologue_with_traps = sym prologue_with_traps::<Narrow>,
    pad_arguments = sym call::stubs::pad_arguments,
    overflow = sym crate::slow::throw_stack_overflow_at_entry,
    throw = sym throw,
);

stub!(
    /// With an exception pending.
    fn throw,
    ["b {throw_from_frame}"],
    throw_from_frame = sym call::stubs::throw_from_frame,
);

macro_rules! resume_stub {
    ($(#[$doc:meta])* $name:ident, [$($offset:literal),*], $($operand:ident = $value:expr),*) => {
        stub!(
            $(#[$doc])*
            fn $name,
            [
                "ldr x10, [x29, #{code_block}]",
                frame_bottom!(),
                "mov sp, x11",
                load_registers!(),
                $($offset,)*
                "add x20, x20, x12",
                "mov x22, #{number_tag}",
                "add x23, x22, #{other_tag}",
                "ldrb w12, [x20]",
                address_of!("x16", "{table}"),
                "ldr x16, [x16, x12, lsl #3]",
                "br x16",
            ],
            code_block = const CallFrame::OFFSET_OF_CODE_BLOCK,
            locals = const CodeBlock::OFFSET_OF_LOCALS,
            instructions = const CodeBlock::OFFSET_OF_INSTRUCTIONS,
            metadata = const CodeBlock::OFFSET_OF_METADATA,
            bias = const CONSTANT_BIAS * 8,
            number_tag = const Value::NUMBER_TAG,
            other_tag = const Value::OTHER_TAG,
            table = sym crate::table::NARROW,
            $($operand = const $value,)*
        );
    };
}

resume_stub!(
    /// With only the frame pointer and the `Vm` in place.
    catch_entry,
    ["ldr w12, [x21, #{offset}]"],
    offset = Vm::OFFSET_OF_CATCH_BYTECODE_OFFSET
);
resume_stub!(
    /// The same, at the instruction that the call site of the frame stands for.
    resume_at_call_site,
    ["ldr w12, [x29, #{call_site}]", "sub w12, w12, w20"],
    call_site = CallFrame::OFFSET_OF_CALL_SITE
);

/// From the start of `call` to where the callee returns to.
pub(crate) const RETURN_POINT_OFFSET: usize = 12;

stub!(
    /// With the executable, the entry and the new frame.
    fn call<O: Returns, W: Width>,
    [
        "add sp, x0, #{linkage}",
        "mov x9, x27",
        "blr x28",
        "ldr x10, [x29, #{code_block}]",
        "ldr w12, [x29, #{call_site}]",
        "mov x27, x0",
        frame_bottom!(),
        "mov sp, x11",
        load_registers!(),
        "sub w12, w12, w20",
        "add x20, x20, x12",
        "add x20, x20, #{prefix}",
        "b {continuation}",
    ],
    linkage = const CallFrame::LINKAGE_SIZE,
    code_block = const CallFrame::OFFSET_OF_CODE_BLOCK,
    call_site = const CallFrame::OFFSET_OF_CALL_SITE,
    locals = const CodeBlock::OFFSET_OF_LOCALS,
    instructions = const CodeBlock::OFFSET_OF_INSTRUCTIONS,
    metadata = const CodeBlock::OFFSET_OF_METADATA,
    bias = const CONSTANT_BIAS * 8,
    prefix = const W::PREFIX_BYTES,
    continuation = sym after_call::<O, W>,
);

stub!(
    /// With the executable, the entry and a frame whose header is complete.
    fn tail_call,
    ["mov sp, x0", "ldp x29, x30, [sp], #16", "mov x9, x27", "br x28"],
);

stub!(
    /// With the value.
    fn return_value,
    ["mov x0, x27", "mov sp, x24", "ldp x29, x30, [sp], #16", "ret"],
);

stub!(
    /// Makes room for the frame that starts at the first extra argument, which is passed on.
    fn extend_stack<O: VarargsCall, W: Width>,
    ["mov sp, x27", "b {continuation}"],
    continuation = sym fill_varargs_frame::<O, W>,
);

stub!(
    /// Makes room for its frame. The extra arguments are passed on.
    fn call_accessor<O: Returns, W: Width>,
    ["sub sp, sp, #{room}", "b {continuation}"],
    room = const ACCESSOR_FRAME_WORDS * 8,
    continuation = sym fill_accessor_frame::<O, W>,
);

stub!(
    /// To code of another tier that takes the frame over.
    fn jump_to,
    ["br x27"],
);
