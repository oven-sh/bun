/// Makes ICU allocate as the rest of the process does, which under a sanitizer is with the C library. The library of
/// macOS is shared with the system's frameworks, and keeps their allocator.
///
/// # Safety
/// Nothing has called ICU yet, and nothing does until this returns.
pub unsafe fn use_default_allocator() {
    #[cfg(not(system_icucore))]
    // SAFETY: ICU holds no block of another allocator. It fails only if a function is missing.
    unsafe {
        hooks::u_setMemoryFunctions(
            core::ptr::null(),
            hooks::allocate,
            hooks::reallocate,
            hooks::free,
            &mut crate::error::Status::during_setup(),
        );
    }
}

#[cfg(not(system_icucore))]
mod hooks {
    use core::ffi::c_void;

    use bun_alloc::{default_alloc, out_of_memory};

    use crate::error::Status;

    type Allocate = extern "C" fn(*const c_void, usize) -> *mut c_void;
    type Reallocate = unsafe extern "C" fn(*const c_void, *mut c_void, usize) -> *mut c_void;
    type Free = unsafe extern "C" fn(*const c_void, *mut c_void);

    icu_functions! {
        pub(super) fn u_setMemoryFunctions(context: *const c_void, allocate: Allocate, reallocate: Reallocate, free: Free, status: &mut Status);
    }

    /// ICU never asks for zero bytes.
    fn allocated(block: *mut c_void) -> *mut c_void {
        if block.is_null() {
            out_of_memory();
        }
        block
    }

    pub(super) extern "C" fn allocate(_: *const c_void, size: usize) -> *mut c_void {
        allocated(default_alloc::malloc(size))
    }

    pub(super) unsafe extern "C" fn reallocate(
        _: *const c_void,
        block: *mut c_void,
        size: usize,
    ) -> *mut c_void {
        // SAFETY: each block that ICU holds came from these functions.
        allocated(unsafe { default_alloc::realloc(block, size) })
    }

    pub(super) unsafe extern "C" fn free(_: *const c_void, block: *mut c_void) {
        // SAFETY: each block that ICU holds came from these functions.
        unsafe { default_alloc::free(block) }
    }
}
