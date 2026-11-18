//! Turn the frame of a bound function into one of its target.

use core::arch::naked_asm;

use bun_engine_bytecode::Specialization::{Call, Construct};
use bun_engine_macros::in_call_frame;

use crate::call::stubs::{native_call_entry, native_construct_entry};
use crate::{CallFrame, Executable, ImmutableArray, JsBoundFunction, JsFunction, Vm};

/// The frame pointer has not been pushed.
const fn from_stack_pointer(offset: usize) -> usize {
    offset - size_of::<usize>()
}

/// `$load` puts what goes in the slot of `this` in `r10`, given the bound function in `rdx`.
macro_rules! entry {
    ($name:ident, $specialization:expr, $native:ident, [$($load:literal),*] $(, $operand:ident = $value:expr)*) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "sysv64" fn $name() {
            naked_asm!(
                "mov rdx, [rsp + {callee}]",
                "movzx eax, byte ptr [rdx + {forwarded}]",
                $($load,)*
                "test eax, eax",
                "jnz 3f",
                "2:",
                "mov [rsp + {this}], r10",
                "mov rdx, [rdx + {target}]",
                "mov [rsp + {callee}], rdx",
                "mov rcx, [rdx + {executable}]",
                "mov rax, [rcx + {code_block_of_executable}]",
                "mov [rsp + {code_block}], rax",
                "jmp qword ptr [rcx + {entry}]",
                "3:",
                "cmp eax, {max}",
                "ja {native}",
                "cmp rsp, [r13 + {limit}]",
                "jb {native}",
                "mov r9d, [rsp + {count}]",
                "cmp r9d, {max_moved}",
                "ja {native}",
                "mov r8, [rsp]",
                // The header moves down by an even number of words.
                "test al, 1",
                "jz 6f",
                "lea rsi, [rsp + {first}]",
                "mov ecx, r9d",
                "jmp 5f",
                "4:",
                "mov rdi, [rsi]",
                "mov [rsi - 8], rdi",
                "add rsi, 8",
                "5:",
                "dec ecx",
                "jnz 4b",
                "sub rsp, 8",
                "6:",
                "lea rsi, [rax * 8]",
                "sub rsp, rsi",
                "mov [rsp], r8",
                "add r9d, eax",
                "mov [rsp + {count}], r9",
                "lea r11, [rdx + {arguments}]",
                "cmp eax, {max_inline}",
                "jbe 7f",
                "mov r11, [r11]",
                "add r11, {elements}",
                "7:",
                "mov rdi, [r11 + rax * 8 - 8]",
                "mov [rsp + rax * 8 + {first} - 8], rdi",
                "dec eax",
                "jnz 7b",
                "jmp 2b",
                code_block = const from_stack_pointer(CallFrame::OFFSET_OF_CODE_BLOCK),
                callee = const from_stack_pointer(CallFrame::OFFSET_OF_CALLEE),
                count = const from_stack_pointer(CallFrame::OFFSET_OF_ARGUMENT_COUNT),
                this = const from_stack_pointer(CallFrame::OFFSET_OF_THIS),
                first = const from_stack_pointer(CallFrame::OFFSET_OF_ARGUMENTS),
                forwarded = const JsBoundFunction::offset_of_forwarded_arguments($specialization),
                target = const JsBoundFunction::OFFSET_OF_TARGET,
                arguments = const JsBoundFunction::OFFSET_OF_ARGUMENTS,
                max = const JsBoundFunction::MAX_FORWARDED_ARGUMENTS,
                max_moved = const JsBoundFunction::MAX_MOVED_ARGUMENTS,
                max_inline = const JsBoundFunction::MAX_INLINE_ARGUMENTS,
                elements = const ImmutableArray::OFFSET_OF_ELEMENTS,
                executable = const JsFunction::OFFSET_OF_EXECUTABLE,
                code_block_of_executable = const Executable::offset_of_code_block($specialization),
                entry = const Executable::offset_of_entry($specialization),
                limit = const Vm::OFFSET_OF_REAL_STACK_LIMIT,
                native = sym $native,
                $($operand = const $value,)*
            )
        }
    };
}

entry!(
    call,
    Call,
    native_call_entry,
    ["mov r10, [rdx + {bound_this}]"],
    bound_this = JsBoundFunction::OFFSET_OF_BOUND_THIS
);
entry!(
    construct,
    Construct,
    native_construct_entry,
    [
        "mov r10, [rsp + {this}]",
        "cmp r10, rdx",
        "cmove r10, [rdx + {target}]"
    ]
);
