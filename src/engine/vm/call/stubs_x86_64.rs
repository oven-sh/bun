//! At an entry `rcx` has the executable, or what the call went through instead.

use core::arch::naked_asm;
use core::mem::offset_of;

use bun_engine_bytecode::Specialization::{Call, Construct};
use bun_engine_macros::in_call_frame;

use super::ProtoFrame;
use crate::{
    CallFrame, Executable, FunctionRareData, InternalFunction, JsFunction, JsResult,
    NativeExecutable, Shape, Value, Vm,
};

/// With the `Vm` in `r13`. The context follows.
macro_rules! open_entry_frame {
    () => {
        concat!(
            "push rbp\n",
            "mov rbp, rsp\n",
            "push qword ptr [r13 + {top_call_frame}]\n",
            "push qword ptr [r13 + {top_entry_frame}]\n",
            "mov [r13 + {top_entry_frame}], rbp",
        )
    };
}

macro_rules! leave_entry_frame {
    () => {
        concat!(
            "mov rcx, [rbp - 8]\n",
            "mov [r13 + {top_call_frame}], rcx\n",
            "mov rcx, [rbp - 16]\n",
            "mov [r13 + {top_entry_frame}], rcx\n",
            "leave\n",
            "ret",
        )
    };
}

/// The arguments are in r12 to r14.
#[unsafe(naked)]
pub(super) unsafe extern "rust-preserve-none" fn enter(
    entry: usize,
    vm: &Vm,
    frame: &ProtoFrame,
) -> JsResult<Value> {
    naked_asm!(
        open_entry_frame!(),
        "push 0",
        "mov ecx, [r14 + {argument_count}]",
        "lea rax, [rcx * 8 + 24 + 15]",
        "and rax, -16",
        "lea rsp, [rbp - 32]",
        "sub rsp, rax",
        "mov [rsp + 16], rcx",
        "mov rsi, [r14 + {arguments}]",
        "dec ecx",
        "jz 3f",
        "2:",
        "mov rax, [rsi + rcx * 8 - 8]",
        "mov [rsp + rcx * 8 + 24], rax",
        "dec ecx",
        "jnz 2b",
        "3:",
        "mov rax, [r14 + {this_value}]",
        "mov [rsp + 24], rax",
        "mov rax, [r14 + {callee}]",
        "mov [rsp + 8], rax",
        "mov rax, [r14 + {code_block}]",
        "mov [rsp], rax",
        "mov rcx, [r14 + {executable}]",
        "movabs r14, {number_tag}",
        "lea r15, [r14 + {other_tag}]",
        "call r12",
        leave_entry_frame!(),
        top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
        top_entry_frame = const Vm::OFFSET_OF_TOP_ENTRY_FRAME,
        code_block = const offset_of!(ProtoFrame, code_block),
        callee = const offset_of!(ProtoFrame, callee),
        argument_count = const offset_of!(ProtoFrame, argument_count_including_this),
        this_value = const offset_of!(ProtoFrame, this_value),
        arguments = const offset_of!(ProtoFrame, arguments),
        executable = const offset_of!(ProtoFrame, executable),
        number_tag = const Value::NUMBER_TAG,
        other_tag = const Value::OTHER_TAG,
    )
}

/// The arguments are in r12 to r15, rdi, rsi, rdx, rcx, r8 and r9.
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
        open_entry_frame!(),
        "push rdx",
        "push rdx",
        "push r9",
        "push r8",
        "push rsi",
        "push rdi",
        "push r15",
        "push r14",
        "movabs r14, {number_tag}",
        "lea r15, [r14 + {other_tag}]",
        "call r12",
        leave_entry_frame!(),
        top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
        top_entry_frame = const Vm::OFFSET_OF_TOP_ENTRY_FRAME,
        number_tag = const Value::NUMBER_TAG,
        other_tag = const Value::OTHER_TAG,
    )
}

/// The same with four words after `this` and without a context. The last argument is in r11.
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
        open_entry_frame!(),
        "push 0",
        "push 0",
        "push r11",
        "push r9",
        "push r8",
        "push rdx",
        "push rsi",
        "push rdi",
        "push r15",
        "push r14",
        "movabs r14, {number_tag}",
        "lea r15, [r14 + {other_tag}]",
        "call r12",
        leave_entry_frame!(),
        top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
        top_entry_frame = const Vm::OFFSET_OF_TOP_ENTRY_FRAME,
        number_tag = const Value::NUMBER_TAG,
        other_tag = const Value::OTHER_TAG,
    )
}

#[unsafe(naked)]
pub(super) unsafe extern "sysv64" fn return_to_native_code_with_exception() {
    naked_asm!(
        "xor eax, eax",
        leave_entry_frame!(),
        top_call_frame = const Vm::OFFSET_OF_TOP_CALL_FRAME,
        top_entry_frame = const Vm::OFFSET_OF_TOP_ENTRY_FRAME,
    )
}

#[in_call_frame(naked)]
#[unsafe(naked)]
pub unsafe extern "sysv64" fn throw_from_frame() {
    naked_asm!(
        "and rsp, -16",
        "mov rdi, r13",
        "mov rsi, rbp",
        "call {unwind}",
        "mov rbp, [r13 + {frame}]",
        "jmp qword ptr [r13 + {address}]",
        unwind = sym super::unwind,
        frame = const Vm::OFFSET_OF_CATCH_FRAME,
        address = const Vm::OFFSET_OF_CATCH_ADDRESS,
    )
}

/// `$load` puts the realm in `rdi` and the function in `rax`, given the callee in `rdx`.
macro_rules! native_entry {
    ($name:ident, [$($load:literal),*], $($operand:ident = $value:expr),*) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(crate) unsafe extern "sysv64" fn $name() {
            naked_asm!(
                "push rbp",
                "mov rbp, rsp",
                "mov [r13 + {top_call_frame}], rbp",
                "mov rdx, [rbp + {callee}]",
                $($load,)*
                "mov rsi, rbp",
                "call rax",
                "cmp qword ptr [r13 + {exception}], 0",
                "jne {throw}",
                "mov ecx, {undefined}",
                "test rax, rax",
                "cmovz rax, rcx",
                "pop rbp",
                "ret",
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
    ["mov rdi, [rdx + {scope}]", "mov rax, [rcx + {function}]"],
    scope = JsFunction::OFFSET_OF_SCOPE,
    function = NativeExecutable::OFFSET_OF_FUNCTION
);
native_entry!(
    native_construct_entry,
    ["mov rdi, [rdx + {scope}]", "mov rax, [rcx + {function}]"],
    scope = JsFunction::OFFSET_OF_SCOPE,
    function = NativeExecutable::OFFSET_OF_CONSTRUCTOR
);
native_entry!(
    internal_function_call_entry,
    ["mov rdi, [rdx + {scope}]", "mov rax, [rdx + {function}]"],
    scope = JsFunction::OFFSET_OF_SCOPE,
    function = InternalFunction::OFFSET_OF_FUNCTION
);
native_entry!(
    internal_function_construct_entry,
    ["mov rdi, [rdx + {scope}]", "mov rax, [rdx + {function}]"],
    scope = JsFunction::OFFSET_OF_SCOPE,
    function = InternalFunction::OFFSET_OF_CONSTRUCTOR
);
native_entry!(
    call_data_entry,
    [
        "mov edi, [rdx]",
        "add rdi, [r13 + {shape_base}]",
        "mov rdi, [rdi + {global}]",
        "mov rax, rcx"
    ],
    shape_base = Vm::OFFSET_OF_SHAPE_BASE,
    global = Shape::OFFSET_OF_GLOBAL
);

macro_rules! link_entry {
    ($name:ident, $specialization:expr) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "sysv64" fn $name() {
            naked_asm!(
                "push rbp",
                "mov rbp, rsp",
                "mov [r13 + {top_call_frame}], rbp",
                "mov rdi, r13",
                "mov rsi, rbp",
                "mov edx, {specialization}",
                "call {link}",
                "test rax, rax",
                "jz {throw}",
                "pop rbp",
                "jmp rax",
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
        pub(super) unsafe extern "sysv64" fn $name() {
            naked_asm!(
                "push rbp",
                "mov rbp, rsp",
                "mov [r13 + {top_call_frame}], rbp",
                "push rcx",
                "push rcx",
                "mov rdi, r13",
                "mov rsi, rbp",
                "mov edx, {specialization}",
                "call {notify}",
                "pop rcx",
                "leave",
                "jmp rax",
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
        pub(super) unsafe extern "sysv64" fn $name() {
            naked_asm!(
                "mov rcx, [rcx + {executable}]",
                "mov rax, [rcx + {code_block}]",
                "mov [rsp + 8], rax",
                "jmp qword ptr [rcx + {entry}]",
                executable = const FunctionRareData::OFFSET_OF_EXECUTABLE,
                code_block = const Executable::offset_of_code_block($specialization),
                entry = const Executable::offset_of_entry($specialization),
            )
        }
    };
}

rare_data_entry!(rare_data_call_entry, Call);
rare_data_entry!(rare_data_construct_entry, Construct);

/// Baseline code calls these, with its code block in `rbx`.
macro_rules! replaced_code_entry {
    ($name:ident, $specialization:expr) => {
        #[in_call_frame(naked)]
        #[unsafe(naked)]
        pub(super) unsafe extern "sysv64" fn $name() {
            naked_asm!(
                "push rbp",
                "mov rbp, rsp",
                "mov rdi, rbx",
                "call {link_calls}",
                "pop rbp",
                "mov rcx, [rsp + 16]",
                "mov rcx, [rcx + {executable}]",
                "mov rax, [rcx + {code_block}]",
                "mov [rsp + 8], rax",
                "jmp qword ptr [rcx + {entry}]",
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
        pub(super) unsafe extern "sysv64" fn $name() {
            naked_asm!(
                "mov rax, [r13 + {lowest}]",
                "mov [r13 + {lowest}], rsp",
                "jmp 3f",
                "2:",
                "mov qword ptr [rax], 0",
                "add rax, 8",
                "3:",
                "cmp rax, rsp",
                "jb 2b",
                "jmp qword ptr [rcx + {entry}]",
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
pub unsafe extern "sysv64" fn pad_arguments() {
    naked_asm!(
        "cmp dword ptr [rbp + {call_site}], {is_padded}",
        "je 4f",
        "pop r8",
        "mov ecx, [rbp + {argument_count}]",
        "add ecx, {header}",
        "add edi, {header}",
        // The frame takes an even number of words, before and after.
        "lea eax, [rdi + 1]",
        "lea edx, [rcx + 1]",
        "and eax, -2",
        "and edx, -2",
        "sub eax, edx",
        "jz 3f",
        "shl rax, 3",
        "mov rsi, rbp",
        "sub rbp, rax",
        "mov rsp, rbp",
        "xor edx, edx",
        "2:",
        "mov rax, [rsi + rdx * 8]",
        "mov [rbp + rdx * 8], rax",
        "inc edx",
        "cmp edx, ecx",
        "jb 2b",
        "3:",
        "mov qword ptr [rbp + rcx * 8], {undefined}",
        "inc ecx",
        "cmp ecx, edi",
        "jb 3b",
        "push r8",
        "ret",
        "4:",
        "mov dword ptr [rbp + {call_site}], 0",
        "ret",
        call_site = const CallFrame::OFFSET_OF_CALL_SITE,
        is_padded = const CallFrame::IS_PADDED as i32,
        argument_count = const CallFrame::OFFSET_OF_ARGUMENT_COUNT,
        header = const CallFrame::HEADER_WORDS,
        undefined = const Value::UNDEFINED.to_bits(),
    )
}
