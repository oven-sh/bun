//! JS testing/debugging bindings for the crash handler. Keeps
//! `src/crash_handler/` free of JSC types.

use bun_analytics as analytics;
use bun_core::String as BunString;
use bun_core::{Environment, Global};
use bun_crash_handler as crash_handler;

use crate::generated_bindgen::crash_handler_jsc::{FaultState, FeatureData};

pub(crate) fn get_mach_o_image_zero_offset() -> Option<f64> {
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            safe fn _dyld_get_image_header(image_index: u32) -> *const core::ffi::c_void;
            safe fn _dyld_get_image_vmaddr_slide(image_index: u32) -> isize;
        }
        let header = _dyld_get_image_header(0);
        if header.is_null() {
            return None;
        }
        let base_address = header as usize;
        let vmaddr_slide = _dyld_get_image_vmaddr_slide(0) as usize;

        Some((base_address - vmaddr_slide) as f64)
    }
}

pub(crate) fn segfault() {
    crash_handler::suppress_core_dumps_if_necessary();
    // Under ASAN the SIGSEGV handler is intentionally not installed
    // (`reset_on_posix()` early-returns so ASAN's own DEADLYSIGNAL diagnostic
    // stays in charge of real faults). A bare deref here would route to ASAN's
    // handler — no trace string, no upload — and the `segfault should report`
    // test times out waiting for a POST that never comes. Invoke the handler
    // directly with the address it *would* have received from `siginfo_t`; the
    // code path under test (`crash_handler(SegmentationFault, …)` → trace
    // string → `report()`) is exactly what `handle_segfault_posix` calls.
    if Environment::ENABLE_ASAN {
        crash_handler::crash_handler(
            crash_handler::CrashReason::SegmentationFault(0xDEADBEEF),
            crash_handler::TraceSeed::BeginAddr(crash_handler::debug::return_address()),
        );
    }
    // SAFETY: intentionally dereferencing an invalid address to trigger SIGSEGV for testing.
    unsafe {
        let ptr = 0xDEADBEEFusize as *mut u64;
        core::ptr::write_unaligned(ptr, 0xDEADBEEF);
        core::hint::black_box(ptr);
    }
}

/// Segfaults on a thread that holds WTF's thread-suspend lock, like the sampling profiler's thread
/// while it reads the stack of the JS thread.
pub(crate) fn segfault_holding_thread_suspend_lock() {
    unsafe extern "C" {
        safe fn Bun__lockThreadSuspensionForTesting();
    }
    Bun__lockThreadSuspensionForTesting();
    segfault();
}

/// Triggers a segfault with the fault PC inside a system DLL rather than
/// inside bun.exe. Exercises the Windows fault-context unwinder: the walk
/// must recover the bun frames that called into the DLL.
pub(crate) fn segfault_in_dll() {
    crash_handler::suppress_core_dumps_if_necessary();
    #[cfg(windows)]
    {
        // `RtlFillMemory` is exported by ntdll.dll, so the faulting
        // instruction is outside bun.exe's image.
        #[link(name = "ntdll")]
        unsafe extern "system" {
            fn RtlFillMemory(dest: *mut core::ffi::c_void, length: usize, fill: u8);
        }
        // SAFETY: intentionally writing to an invalid address to trigger an
        // access violation inside ntdll.dll for testing.
        unsafe { RtlFillMemory(0xDEADBEEFusize as *mut _, 8, 0) };
    }
    #[cfg(not(windows))]
    {
        // No equivalent on POSIX (the fault-context walk is fp-based and
        // doesn't care which image the fault is in); fall through to the
        // in-bun segfault so the test hook is defined everywhere.
        segfault();
    }
}

pub(crate) fn panic() {
    crash_handler::suppress_core_dumps_if_necessary();
    crash_handler::panic_impl(b"invoked crashByPanic() handler", None);
}

/// Through the hook of `std::panic`, as a failed `unwrap()` goes.
pub(crate) fn rust_panic() {
    crash_handler::suppress_core_dumps_if_necessary();
    panic!("invoked rustPanic() handler");
}

/// Native code that calls itself until it meets the guard page below the stack of its thread.
pub(crate) fn stack_overflow() {
    #[inline(never)]
    #[allow(unconditional_recursion)]
    fn deeper(depth: usize) -> usize {
        let room = core::hint::black_box([depth; 64]);
        deeper(depth + 1) + room[0]
    }
    crash_handler::suppress_core_dumps_if_necessary();
    core::hint::black_box(deeper(0));
}

pub(crate) fn abort() {
    crash_handler::suppress_core_dumps_if_necessary();
    // Under ASAN the POSIX signal handlers are not installed; invoke the
    // handler directly so the reporter test still observes the upload.
    if Environment::ENABLE_ASAN || cfg!(windows) {
        crash_handler::crash_handler(
            crash_handler::CrashReason::Abort,
            crash_handler::TraceSeed::BeginAddr(crash_handler::debug::return_address()),
        );
    }
    #[cfg(unix)]
    std::process::abort();
}

/// Dies like foreign native code, with Bun's crash handler provably out
/// of the way on both platforms: `__fastfail` on Windows (uncatchable,
/// exit code 0xC0000409, same as UCRT abort(), Rust aborts, /GS checks)
/// and a raw SIGABRT on POSIX (handlers reset first, like the
/// `raiseIgnoringPanicHandler` binding below). The `abort` binding
/// above is the opposite: it routes into the crash handler on purpose.
pub(crate) fn fastfail() {
    crash_handler::suppress_core_dumps_if_necessary();
    #[cfg(windows)]
    std::process::abort();
    #[cfg(not(windows))]
    Global::raise_ignoring_panic_handler(bun_core::SignalCode::SIGABRT);
}

pub(crate) fn trap() {
    crash_handler::suppress_core_dumps_if_necessary();
    if Environment::ENABLE_ASAN || cfg!(windows) {
        crash_handler::crash_handler(
            crash_handler::CrashReason::Trap(0),
            crash_handler::TraceSeed::BeginAddr(crash_handler::debug::return_address()),
        );
    }
    // int3 on x86_64 / brk on aarch64: both deliver SIGTRAP, matching the
    // instruction WTF's CRASH()/RELEASE_ASSERT emits.
    #[cfg(all(unix, target_arch = "x86_64"))]
    core::arch::breakpoint();
    #[cfg(all(unix, target_arch = "aarch64"))]
    // SAFETY: single trap instruction; no inputs/outputs. `breakpoint()` emits `brk #0xf000`.
    unsafe {
        core::arch::asm!("brk #0", options(nomem, nostack));
    }
    #[cfg(all(unix, not(any(target_arch = "x86_64", target_arch = "aarch64"))))]
    crash_handler::crash_handler(
        crash_handler::CrashReason::Trap(0),
        crash_handler::TraceSeed::BeginAddr(crash_handler::debug::return_address()),
    );
}

pub(crate) fn root_error() {
    crash_handler::handle_root_error("Unexpected");
}

pub(crate) fn out_of_memory() {
    crash_handler::suppress_core_dumps_if_necessary();
    bun_core::out_of_memory();
}

/// Calls `mi_new` or `mi_new_nothrow`, which back C++ `operator new` where mimalloc overrides it.
/// Only `mi_new_nothrow` may return null.
pub(crate) fn operator_new(nothrow: bool) -> Option<bool> {
    unsafe extern "C" {
        // safe: both accept any size, and the result is never dereferenced.
        safe fn mi_new(size: usize) -> *mut core::ffi::c_void;
        safe fn mi_new_nothrow(size: usize) -> *mut core::ffi::c_void;
    }
    if nothrow {
        let refused = mi_new_nothrow(usize::MAX / 2).is_null();
        return Some(refused);
    }
    crash_handler::suppress_core_dumps_if_necessary();
    let _ = mi_new(usize::MAX / 2);
    None
}

pub(crate) fn raise_ignoring_panic_handler() {
    crash_handler::suppress_core_dumps_if_necessary();
    Global::raise_ignoring_panic_handler(bun_core::SignalCode::SIGSEGV);
}

/// Whether a stack trace from below a frame with a signed return address,
/// trimmed to that address, starts there: the walk and the address to trim by
/// must both come without the signature. `None` where the test does not run.
pub(crate) fn stack_trace_starts_at_signed_return_address() -> Option<bool> {
    #[cfg(all(target_arch = "aarch64", target_os = "linux"))]
    {
        extern "C" fn capture() -> usize {
            use bun_core::debug::{frame_address, return_address_of_frame};
            let mut addresses = [0; 32];
            // SAFETY: a frame record starts with the address of the caller's,
            // which here is the signed one.
            let begin = unsafe { return_address_of_frame(*(frame_address() as *const usize)) };
            bun_core::capture_stack_trace(begin, &mut addresses);
            addresses[0]
        }
        let (return_address, first): (usize, usize);
        // SAFETY: what a function does that saves its return address signed,
        // calls `capture` and returns to `2:`. The stack pointer and x29 end as
        // they began, and `capture` follows the C calling convention.
        unsafe {
            core::arch::asm!(
                "adr x30, 2f",
                "mov x20, x30",
                "hint #25", // PACIASP
                "stp x29, x30, [sp, #-16]!",
                "mov x29, sp",
                "blr x8",
                "ldp x29, x30, [sp], #16",
                "hint #29", // AUTIASP
                "2:",
                // x20 outlives the call, and nothing writes x8 before it.
                out("x20") return_address,
                in("x8") capture as extern "C" fn() -> usize,
                lateout("x0") first,
                clobber_abi("C"),
            )
        };
        Some(first == return_address)
    }
    #[cfg(not(all(target_arch = "aarch64", target_os = "linux")))]
    {
        None
    }
}

/// Whether the stack trace of a fault in `state` has the return address that the state holds for the function at the fault, and then the callers of this function. `None` where the processor has no such state, and for a trace that is neither.
pub(crate) fn fault_walk_starts_at_caller(state: FaultState) -> Option<bool> {
    #[cfg(all(unix, any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        use bun_core::debug::{capture_from_fault, frame_address, return_address_of_frame};
        use bun_sys::Mmap;
        use core::ptr::NonNull;

        const READ_WRITE: i32 = libc::PROT_READ | libc::PROT_WRITE;
        fn pages(count: usize, access: i32) -> Option<Mmap> {
            let length = count * bun_sys::page_size();
            let flags = libc::MAP_PRIVATE | libc::MAP_ANON;
            Mmap::new(length, access, flags, bun_sys::Fd::from_native(-1), 0).ok()
        }
        /// One page of memory whose next page is not mapped.
        fn page_in_front_of_none() -> Option<Mmap> {
            let page = bun_sys::page_size();
            let first = pages(2, READ_WRITE)?.into_raw().cast::<u8>();
            let page_at = |start| NonNull::slice_from_raw_parts(start, page);
            // SAFETY: the two pages are from one `mmap`, and each becomes the value's that is made of it.
            unsafe {
                drop(Mmap::from_raw(page_at(first.add(page))));
                Some(Mmap::from_raw(page_at(first)))
            }
        }

        /// x86-64: `call rax` ends it.
        static CODE: [u8; 16] = [
            0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90,
            0xff, 0xd0,
        ];
        const CALL: [u8; 2] = [0xff, 0xd0];
        const NOT_MAPPED: usize = 8;
        let page = bun_sys::page_size();
        let fp = frame_address();
        // SAFETY: `fp` is the frame record of this function.
        let caller = unsafe { return_address_of_frame(fp) };
        // The memory that a state points into. It lasts until the trace is taken.
        let memory = match state {
            FaultState::WordBehindEndOfMemory => Some(page_in_front_of_none()?),
            FaultState::WordInMemoryThatCannotBeRead | FaultState::FrameRecordThatCannotBeRead => {
                Some(pages(1, libc::PROT_NONE)?)
            }
            FaultState::CallAcrossTwoPages => {
                let mut both = pages(2, READ_WRITE)?;
                // SAFETY: the pages are anonymous, and they can be read and written.
                unsafe { both.as_mut_slice()[page - 1..=page].copy_from_slice(&CALL) };
                Some(both)
            }
            _ => None,
        };
        let memory = memory.as_ref().map_or(0, |memory| memory.as_ptr().addr());
        let behind_call = match state {
            FaultState::CallAcrossTwoPages => memory + page + 1,
            _ => CODE.as_ptr_range().end.addr(),
        };

        // Which word is what a call pushed, and what `pc`, the fault address and x30 are.
        let (pushed, pc, fault_address, link_register) = match state {
            FaultState::CallOfZero => (behind_call, 0, Some(0), behind_call),
            FaultState::CallOfAddressThatCannotRun => {
                (behind_call, NOT_MAPPED, Some(NOT_MAPPED), behind_call)
            }
            FaultState::FaultOnData => (behind_call, NOT_MAPPED, Some(2 * NOT_MAPPED), behind_call),
            FaultState::SignalWithoutFaultAddress => (behind_call, 0, None, behind_call),
            FaultState::ReturnToAddressThatCannotRun => {
                (behind_call, NOT_MAPPED, Some(NOT_MAPPED), NOT_MAPPED)
            }
            FaultState::LinkRegisterOfZero if cfg!(target_arch = "aarch64") => {
                (behind_call, NOT_MAPPED, Some(NOT_MAPPED), 0)
            }
            FaultState::LinkRegisterOfFrameRecord if cfg!(target_arch = "aarch64") => {
                (behind_call, NOT_MAPPED, Some(NOT_MAPPED), caller)
            }
            FaultState::FrameRecordThatCannotBeRead
            | FaultState::UnalignedFrameRecordThatHoldsLinkRegister
                if cfg!(target_arch = "aarch64") =>
            {
                (behind_call, NOT_MAPPED, Some(NOT_MAPPED), behind_call)
            }
            FaultState::WordThatNoCallPushed if cfg!(target_arch = "x86_64") => {
                (behind_call - CALL.len(), 0, Some(0), 0)
            }
            FaultState::WordBelowEveryCall if cfg!(target_arch = "x86_64") => (1, 0, Some(0), 0),
            FaultState::StackThatCannotBeRead if cfg!(target_arch = "x86_64") => (0, 0, Some(0), 0),
            // Of the 8 bytes in front of the word, where a call would be, the last one is not mapped.
            FaultState::WordBehindEndOfMemory if cfg!(target_arch = "x86_64") => {
                (memory + page + 1, 0, Some(0), 0)
            }
            FaultState::WordInMemoryThatCannotBeRead if cfg!(target_arch = "x86_64") => {
                (memory + core::mem::size_of::<usize>(), 0, Some(0), 0)
            }
            FaultState::CallAcrossTwoPages if cfg!(target_arch = "x86_64") => {
                (behind_call, 0, Some(0), 0)
            }
            _ => return None,
        };

        #[repr(align(8))]
        struct Aligned([u8; 24]);
        let mut holds_link_register = Aligned([0; 24]);
        holds_link_register.0[9..17].copy_from_slice(&behind_call.to_ne_bytes());
        let [_, not_aligned, ..] = &core::hint::black_box(&holds_link_register).0;
        // AArch64: what x29 is where it is the address of no frame record. No callers are found from it.
        let (fp, caller) = match state {
            FaultState::FrameRecordThatCannotBeRead => (memory, 0),
            FaultState::UnalignedFrameRecordThatHoldsLinkRegister => {
                (core::ptr::from_ref(not_aligned).expose_provenance(), 0)
            }
            _ => (fp, caller),
        };

        // x86-64: a call leaves the stack pointer at the second word, and a return at the first.
        #[repr(align(16))]
        struct Stack([usize; 2]);
        let stack = Stack([pushed; 2]);
        let [at_return, at_call] = &core::hint::black_box(&stack).0;
        let sp = match state {
            FaultState::ReturnToAddressThatCannotRun => {
                core::ptr::from_ref(at_return).expose_provenance()
            }
            FaultState::StackThatCannotBeRead => NOT_MAPPED,
            _ => core::ptr::from_ref(at_call).expose_provenance(),
        };
        let link_register = cfg!(target_arch = "aarch64").then_some(link_register);

        let mut trace = [0usize; 3];
        let found = capture_from_fault(
            pc,
            pc.wrapping_add(1),
            fp,
            sp,
            fault_address,
            link_register,
            &mut trace,
        );
        match (found.starts_at_caller, trace) {
            (true, [_, first, second]) if first == behind_call && second == caller => Some(true),
            (false, [_, first, second]) if first == caller && second != caller => Some(false),
            _ => None,
        }
    }
    #[cfg(not(all(unix, any(target_arch = "x86_64", target_arch = "aarch64"))))]
    {
        let _ = state;
        None
    }
}

pub(crate) fn get_feature_data() -> FeatureData {
    FeatureData {
        // Not `static_`: a feature can be named like a common string ("s3").
        features: analytics::PACKED_FEATURES_LIST
            .iter()
            .map(|feature| BunString::clone_latin1(feature.as_ref()))
            .collect(),
        version: BunString::static_(Global::package_json_version),
        is_canary: Environment::IS_CANARY,
        // This is the source of truth for the git sha.
        // Not the github ref or the git tag.
        revision: BunString::static_(Environment::GIT_SHA),
        generated_at: bun_core::time::milli_timestamp().max(0) as u64,
    }
}
