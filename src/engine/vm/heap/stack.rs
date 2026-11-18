//! The native stack of the current thread.

pub use bun_engine_platform::StackBounds;

#[inline(always)]
pub fn stack_pointer() -> usize {
    let pointer: usize;
    // SAFETY: reads a register.
    unsafe {
        #[cfg(target_arch = "x86_64")]
        core::arch::asm!("mov {}, rsp", out(reg) pointer, options(nomem, nostack, preserves_flags));
        #[cfg(target_arch = "aarch64")]
        core::arch::asm!("mov {}, sp", out(reg) pointer, options(nomem, nostack, preserves_flags));
    }
    pointer
}

#[bun_engine_macros::native_abi]
type Continuation = unsafe fn(argument: *mut (), stack_top: usize);

/// Pushes the registers that the callers may keep cells in, then calls `continuation`.
#[cfg(target_arch = "x86_64")]
#[unsafe(naked)]
unsafe extern "sysv64" fn spill_registers(argument: *mut (), continuation: Continuation) {
    core::arch::naked_asm!(
        "push rbp",
        "mov rbp, rsp",
        "push rbx",
        "push r12",
        "push r13",
        "push r14",
        "push r15",
        "push 0",
        "mov rax, rsi",
        "mov rsi, rsp",
        "call rax",
        "mov rsp, rbp",
        "pop rbp",
        "ret",
    )
}

#[cfg(target_arch = "aarch64")]
#[unsafe(naked)]
unsafe extern "C" fn spill_registers(argument: *mut (), continuation: Continuation) {
    core::arch::naked_asm!(
        "stp x29, x30, [sp, #-160]!",
        "mov x29, sp",
        "stp x19, x20, [sp, #16]",
        "stp x21, x22, [sp, #32]",
        "stp x23, x24, [sp, #48]",
        "stp x25, x26, [sp, #64]",
        "stp x27, x28, [sp, #80]",
        "stp d8, d9, [sp, #96]",
        "stp d10, d11, [sp, #112]",
        "stp d12, d13, [sp, #128]",
        "stp d14, d15, [sp, #144]",
        "mov x2, x1",
        "mov x1, sp",
        "blr x2",
        "ldp x29, x30, [sp], #160",
        "ret",
    )
}

/// Calls `body` with an address above which the stack has everything that the callers hold.
pub(super) fn with_registers_on_stack<F: FnOnce(usize)>(body: F) {
    #[bun_engine_macros::native_abi]
    unsafe fn call<F: FnOnce(usize)>(argument: *mut (), stack_top: usize) {
        // SAFETY: the option below.
        if let Some(body) = unsafe { &mut *argument.cast::<Option<F>>() }.take() {
            body(stack_top);
        }
    }
    let mut body = Some(body);
    // SAFETY: the argument is what `call` expects.
    unsafe { spill_registers((&raw mut body).cast(), call::<F>) }
}

/// Zeroes the stack from `lowest` up to the stack pointer, where dead frames would keep cells alive.
///
/// # Safety
/// `lowest` is an aligned address in the stack of this thread that the stack pointer has been at.
#[cfg(target_arch = "x86_64")]
#[unsafe(naked)]
pub(crate) unsafe extern "sysv64" fn clear_below_stack_pointer(lowest: usize) {
    core::arch::naked_asm!(
        "xor eax, eax",
        "jmp 3f",
        "2:",
        "mov [rdi], rax",
        "add rdi, 8",
        "3:",
        "cmp rdi, rsp",
        "jb 2b",
        "ret",
    )
}

#[cfg(target_arch = "aarch64")]
#[unsafe(naked)]
pub(crate) unsafe extern "C" fn clear_below_stack_pointer(lowest: usize) {
    core::arch::naked_asm!(
        "mov x1, sp",
        "b 3f",
        "2:",
        "str xzr, [x0], #8",
        "3:",
        "cmp x0, x1",
        "b.lo 2b",
        "ret",
    )
}

/// The frames that come next would not write all the words in which it has left addresses of cells.
#[inline(never)]
pub(super) fn clear_what_the_collector_left() {
    const SIZE: usize = if cfg!(debug_assertions) { 16384 } else { 4096 };
    core::hint::black_box(&mut [0u8; SIZE]);
}

/// Loads a word that may be uninitialized or poisoned by a sanitizer.
///
/// # Safety
/// The address is mapped and aligned.
#[inline(always)]
pub unsafe fn load_word(address: usize) -> usize {
    let word: usize;
    // SAFETY: the caller's.
    unsafe {
        #[cfg(target_arch = "x86_64")]
        core::arch::asm!("mov {}, [{}]", lateout(reg) word, in(reg) address, options(readonly, nostack, preserves_flags));
        #[cfg(target_arch = "aarch64")]
        core::arch::asm!("ldr {}, [{}]", lateout(reg) word, in(reg) address, options(readonly, nostack, preserves_flags));
    }
    word
}

/// A hint that the memory, which need not be mapped, is about to be read.
#[inline(always)]
pub(crate) fn prefetch(address: usize) {
    // SAFETY: never faults, and changes nothing.
    unsafe {
        #[cfg(target_arch = "x86_64")]
        core::arch::asm!("prefetcht0 [{}]", in(reg) address, options(nomem, nostack, preserves_flags));
        #[cfg(target_arch = "aarch64")]
        core::arch::asm!("prfm pldl1keep, [{}]", in(reg) address, options(nomem, nostack, preserves_flags));
    }
}
