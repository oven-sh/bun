#[cfg(windows)]
use core::sync::atomic::{AtomicPtr, Ordering};

#[cfg(windows)]
static ABORT_REPORTER: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

/// The reporter runs in front of `abort`, which resets the handler of `SIGABRT` before it calls it: a second thread
/// that aborts at that moment would end the process before anything is said.
#[cfg(windows)]
#[unsafe(no_mangle)]
extern "C" fn WTFSetAbortReporter(reporter: Option<extern "C" fn()>) {
    let address = reporter.map_or(core::ptr::null_mut(), |reporter| reporter as *mut ());
    ABORT_REPORTER.store(address, Ordering::SeqCst);
}

#[cold]
#[inline(never)]
#[unsafe(no_mangle)]
extern "C" fn WTFCrash() -> ! {
    #[cfg(target_vendor = "apple")]
    // SAFETY: raises `SIGTRAP`.
    unsafe {
        #[cfg(target_arch = "x86_64")]
        core::arch::asm!("int3", options(nomem, nostack));
        #[cfg(target_arch = "aarch64")]
        core::arch::asm!("brk #0", options(nomem, nostack));
    }
    #[cfg(windows)]
    {
        let address = ABORT_REPORTER.load(Ordering::SeqCst);
        // SAFETY: null or what `WTFSetAbortReporter` has stored.
        if let Some(reporter) =
            unsafe { core::mem::transmute::<*mut (), Option<extern "C" fn()>>(address) }
        {
            reporter();
        }
    }
    // SAFETY: no preconditions.
    unsafe { libc::abort() }
}

#[cold]
#[inline(never)]
#[unsafe(no_mangle)]
extern "C" fn Support__outOfMemory() -> ! {
    bun_alloc::out_of_memory()
}

/// The return addresses from the caller's up. Returns how many there are.
///
/// # Safety
/// `frames` has room for `capacity` addresses.
#[inline(never)]
#[unsafe(no_mangle)]
unsafe extern "C" fn Support__captureStackTrace(frames: *mut usize, capacity: usize) -> usize {
    // SAFETY: the caller's. They are zeroed first, so that the slice is initialized.
    let frames = unsafe {
        frames.write_bytes(0, capacity);
        core::slice::from_raw_parts_mut(frames, capacity)
    };
    bun_core::capture_stack_trace(bun_core::return_address(), frames)
}
