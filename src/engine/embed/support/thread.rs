use core::ffi::c_void;
use std::thread::JoinHandle;

use bun_engine_platform::suspend::{self, SuspendLock};

type Callback = unsafe extern "C" fn(*mut c_void);

#[unsafe(no_mangle)]
extern "C" fn Support__initializeMainThread() {
    suspend::initialize();
}

#[unsafe(no_mangle)]
extern "C" fn Support__Thread__mayBeGCThread() -> bool {
    bun_engine_vm::heap::is_helper_thread()
}

/// Null if the system has no more threads.
///
/// # Safety
/// `name` has `length` bytes, and `run` takes the context on another thread.
#[unsafe(no_mangle)]
unsafe extern "C" fn Support__Thread__spawn(
    name: *const u8,
    length: usize,
    run: Callback,
    context: *mut c_void,
) -> Option<Box<JoinHandle<()>>> {
    const STACK_SIZE: usize = 2 << 20;
    // SAFETY: the caller's.
    let name = unsafe { core::slice::from_raw_parts(name, length) };
    let context = context.expose_provenance();
    std::thread::Builder::new()
        .name(name.iter().copied().map(char::from).collect())
        .stack_size(STACK_SIZE)
        // SAFETY: the caller's.
        .spawn(move || unsafe { run(core::ptr::with_exposed_provenance_mut(context)) })
        .ok()
        .map(Box::new)
}

#[unsafe(no_mangle)]
extern "C" fn Support__Thread__join(thread: Box<JoinHandle<()>>) {
    let _ = thread.join();
}

#[unsafe(no_mangle)]
extern "C" fn Support__Thread__detach(thread: Option<Box<JoinHandle<()>>>) {
    drop(thread);
}

#[unsafe(no_mangle)]
extern "C" fn Support__ThreadSuspendLocker__lock() -> Box<SuspendLock> {
    Box::new(SuspendLock::lock())
}

#[unsafe(no_mangle)]
extern "C" fn Support__ThreadSuspendLocker__unlock(lock: Box<SuspendLock>) {
    drop(lock);
}

/// A thread that ends passes its value to `destroy`, unless it is null.
///
/// # Safety
/// `destroy` takes every value that the key is given.
#[unsafe(no_mangle)]
unsafe extern "C" fn Support__ThreadKey__create(destroy: Callback) -> usize {
    #[cfg(unix)]
    {
        let mut key = 0;
        // SAFETY: the caller's.
        let result = unsafe { libc::pthread_key_create(&raw mut key, Some(destroy)) };
        assert!(result == 0);
        key as usize
    }
    #[cfg(windows)]
    {
        // SAFETY: the caller's.
        let key = unsafe { FlsAlloc(destroy) };
        assert!(key != u32::MAX);
        key as usize
    }
}

/// # Safety
/// `key` is from `Support__ThreadKey__create`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Support__ThreadKey__get(key: usize) -> *mut c_void {
    #[cfg(unix)]
    // SAFETY: the caller's.
    return unsafe { libc::pthread_getspecific(key as libc::pthread_key_t) };
    #[cfg(windows)]
    return FlsGetValue(key as u32);
}

/// # Safety
/// `key` is from `Support__ThreadKey__create`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Support__ThreadKey__set(key: usize, value: *mut c_void) {
    #[cfg(unix)]
    // SAFETY: the caller's.
    let is_set = unsafe { libc::pthread_setspecific(key as libc::pthread_key_t, value) } == 0;
    #[cfg(windows)]
    let is_set = FlsSetValue(key as u32, value) != 0;
    assert!(is_set);
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn FlsAlloc(destroy: Callback) -> u32;
    safe fn FlsGetValue(key: u32) -> *mut c_void;
    safe fn FlsSetValue(key: u32, value: *mut c_void) -> i32;
}
