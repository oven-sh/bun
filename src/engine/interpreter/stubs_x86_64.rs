//! A handler has its arguments in r12, r13, r14, r15, rdi, rsi, rdx, rcx, r8 and r9.

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

/// With the code block in `$code_block`: the first instruction in r12, and the other registers but the stack pointer.
macro_rules! load_registers {
    ($code_block:literal) => {
        concat!(
            "mov r12, [",
            $code_block,
            " + {instructions}]\n",
            "mov rdx, [",
            $code_block,
            " + {constants}]\n",
            "lea rsi, [",
            $code_block,
            " + {metadata}]\n",
            "add rdx, -{bias}\n",
            "mov rdi, rbp\n",
        )
    };
}

/// With the code block in r8: where the stack pointer belongs, in `$target`.
macro_rules! frame_bottom {
    ($target:literal) => {
        concat!(
            "mov r9d, [r8 + {locals}]\n",
            "neg r9\n",
            "lea ",
            $target,
            ", [rbp + r9 * 8 - 8]\n",
        )
    };
}

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
        "push rbp",
        "mov rbp, rsp",
        "mov r8, [rbp + {code_block}]",
        "mov edi, [r8 + {parameters}]",
        // With the call site above it.
        "cmp [rbp + {argument_count}], rdi",
        "jb 4f",
        "2:",
        frame_bottom!("rax"),
        "cmp rax, [r13 + {stack_limit}]",
        "jl 5f",
        "mov rsp, rax",
        load_registers!("r8"),
        "mov rcx, r8",
        "jmp {prologue}",
        "4:",
        "cmp dword ptr [rbp + {argument_count}], 0",
        "je 2b",
        frame_bottom!("rax"),
        "lea rcx, [rdi * 8]",
        "sub rax, rcx",
        "cmp rax, [r13 + {real_stack_limit}]",
        "jl 6f",
        "call {pad_arguments}",
        "mov r8, [rbp + {code_block}]",
        "jmp 2b",
        "5:",
        "cmp rax, [r13 + {real_stack_limit}]",
        "jl 6f",
        "mov rsp, rax",
        load_registers!("r8"),
        "mov rcx, r8",
        "jmp {prologue_with_traps}",
        "6:",
        "mov rdi, r13",
        "mov rsi, rbp",
        "call {overflow}",
        "jmp {throw}",
    ],
    code_block = const CallFrame::OFFSET_OF_CODE_BLOCK,
    argument_count = const CallFrame::OFFSET_OF_ARGUMENT_COUNT,
    parameters = const CodeBlock::OFFSET_OF_PARAMETERS,
    locals = const CodeBlock::OFFSET_OF_LOCALS,
    instructions = const CodeBlock::OFFSET_OF_INSTRUCTIONS,
    constants = const CodeBlock::OFFSET_OF_CONSTANTS,
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
    ["jmp {throw_from_frame}"],
    throw_from_frame = sym call::stubs::throw_from_frame,
);

macro_rules! resume_stub {
    ($(#[$doc:meta])* $name:ident, [$($offset:literal),*], $($operand:ident = $value:expr),*) => {
        stub!(
            $(#[$doc])*
            fn $name,
            [
                "mov r8, [rbp + {code_block}]",
                frame_bottom!("rsp"),
                load_registers!("r8"),
                $($offset,)*
                "add r12, rax",
                "movabs r14, {number_tag}",
                "lea r15, [r14 + {other_tag}]",
                "movzx eax, byte ptr [r12]",
                "lea rcx, {table}[rip]",
                "jmp qword ptr [rcx + rax * 8]",
            ],
            code_block = const CallFrame::OFFSET_OF_CODE_BLOCK,
            locals = const CodeBlock::OFFSET_OF_LOCALS,
            instructions = const CodeBlock::OFFSET_OF_INSTRUCTIONS,
            constants = const CodeBlock::OFFSET_OF_CONSTANTS,
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
    ["mov eax, [r13 + {offset}]"],
    offset = Vm::OFFSET_OF_CATCH_BYTECODE_OFFSET
);
resume_stub!(
    /// The same, at the instruction that the call site of the frame stands for.
    resume_at_call_site,
    ["mov eax, [rbp + {call_site}]", "sub eax, r12d"],
    call_site = CallFrame::OFFSET_OF_CALL_SITE
);

/// From the start of `call` to where the callee returns to.
pub(crate) const RETURN_POINT_OFFSET: usize = 7;

stub!(
    /// With the executable, the entry and the new frame.
    fn call<O: Returns, W: Width>,
    [
        "lea rsp, [r9 + {linkage}]",
        "call r8",
        "mov r8, [rbp + {code_block}]",
        "mov rcx, rax",
        "mov eax, [rbp + {call_site}]",
        frame_bottom!("rsp"),
        load_registers!("r8"),
        "sub eax, r12d",
        "lea r12, [r12 + rax + {prefix}]",
        "jmp {continuation}",
    ],
    linkage = const CallFrame::LINKAGE_SIZE,
    code_block = const CallFrame::OFFSET_OF_CODE_BLOCK,
    call_site = const CallFrame::OFFSET_OF_CALL_SITE,
    locals = const CodeBlock::OFFSET_OF_LOCALS,
    instructions = const CodeBlock::OFFSET_OF_INSTRUCTIONS,
    constants = const CodeBlock::OFFSET_OF_CONSTANTS,
    metadata = const CodeBlock::OFFSET_OF_METADATA,
    bias = const CONSTANT_BIAS * 8,
    prefix = const W::PREFIX_BYTES,
    continuation = sym after_call::<O, W>,
);

stub!(
    /// With the executable, the entry and a frame whose header is complete.
    fn tail_call,
    ["mov rsp, r9", "pop rbp", "jmp r8"],
);

stub!(
    /// With the value.
    fn return_value,
    ["mov rax, rcx", "mov rsp, rdi", "pop rbp", "ret"],
);

stub!(
    /// Makes room for the frame that starts at the first extra argument, which is passed on.
    fn extend_stack<O: VarargsCall, W: Width>,
    ["lea rsp, [rcx - 8]", "jmp {continuation}"],
    continuation = sym fill_varargs_frame::<O, W>,
);

stub!(
    /// Makes room for its frame. The extra arguments are passed on.
    fn call_accessor<O: Returns, W: Width>,
    ["lea rsp, [rsp - {room}]", "jmp {continuation}"],
    room = const ACCESSOR_FRAME_WORDS * 8,
    continuation = sym fill_accessor_frame::<O, W>,
);

stub!(
    /// To code of another tier that takes the frame over.
    fn jump_to,
    ["jmp rcx"],
);
