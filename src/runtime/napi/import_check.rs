//! Finds an import of a native addon that nothing defines, before the addon's initializer runs and calls it.

use core::ffi::{CStr, c_void};
use core::slice;

use bun_exe_format::elf_imports::unresolved_lazy_import;
use bun_sys::elf::find_loaded_module;

/// Returns 0 if every lazily bound function import of the library of `initializer` has a definition, 1 after writing the name of one that has none to `name_out`, and -1 if the library's tables cannot be read.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__addonUnresolvedImport(
    initializer: *const c_void,
    handle: *mut c_void,
    name_out: *mut u8,
    name_cap: usize,
) -> i32 {
    let Some(module) = find_loaded_module(initializer.addr()) else {
        return -1;
    };
    // SAFETY: the caller holds `handle`, so the loader keeps the library of `initializer` and its program headers mapped.
    let headers =
        unsafe { slice::from_raw_parts(module.program_headers, module.program_header_count) };
    let is_defined = |name: &CStr| {
        // SAFETY: `name` is NUL-terminated, and `handle` is an open dlopen() handle.
        unsafe {
            !libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()).is_null()
                || !libc::dlsym(handle, name.as_ptr()).is_null()
        }
    };
    // SAFETY: `headers` are those of a loaded library, and `base_address` is where the loader mapped it.
    match unsafe { unresolved_lazy_import(headers, module.base_address, is_defined) } {
        Ok(None) => 0,
        Ok(Some(name)) => {
            // SAFETY: the caller gives `name_cap` writable bytes, and at least one.
            let out = unsafe { slice::from_raw_parts_mut(name_out, name_cap) };
            let name = name.to_bytes();
            let length = name.len().min(out.len() - 1);
            out[..length].copy_from_slice(&name[..length]);
            out[length] = 0;
            1
        }
        Err(_) => -1,
    }
}
