//! Checks the imports of a native addon before its initializer runs and calls them: finds one that nothing defines, and with glibc fills those of zlib with Bun's zlib where it finds no zlib in the addon's scope.

use core::ffi::{CStr, c_void};
use core::slice;

use bun_exe_format::elf_imports::resolve_lazy_imports;
use bun_sys::elf::find_loaded_module;

/// Returns 0 once every import that the loader has left unbound in the library of `initializer` has a definition, 1 after writing the name of one that has none to `name_out`, and -1 if the library's tables cannot be read.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__addonResolveImports(
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
    let defines = |scope: *mut c_void, name: &CStr, version: Option<&CStr>| {
        let definition = match version {
            // SAFETY: `name` is NUL-terminated, and `scope` is an open dlopen() handle or `RTLD_DEFAULT`.
            None => unsafe { libc::dlsym(scope, name.as_ptr()) },
            // SAFETY: as for dlsym(), and `version` is NUL-terminated.
            #[cfg(not(target_env = "musl"))]
            Some(version) => unsafe { libc::dlvsym(scope, name.as_ptr(), version.as_ptr()) },
            // musl has no dlvsym(): its loader binds an import by the name alone.
            #[cfg(target_env = "musl")]
            Some(_) => core::ptr::null_mut(),
        };
        !definition.is_null()
    };
    // With musl an import that the loader has left unbound has a definition in neither scope. The global scope is asked for a bound slot that looks unbound (`Image::is_bound`), and the handle would find only an entry of a dependency that an earlier dlopen() relocated.
    let is_defined = |name: &CStr, version: Option<&CStr>| {
        defines(libc::RTLD_DEFAULT, name, version)
            || (cfg!(not(target_env = "musl")) && defines(handle, name, version))
    };
    // musl leaves a `GLOB_DAT` import that nothing defines unbound as it does a jump slot, and both slots as the file has them. glibc and FreeBSD bind a `GLOB_DAT` import in dlopen() and add the base to an unbound jump slot.
    let defers_got = cfg!(target_env = "musl");
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    let library = host_zlib::functions();
    // musl binds a pending import again at every later dlopen(), which would undo a stored slot, and nothing has run this on FreeBSD.
    #[cfg(not(all(target_os = "linux", target_env = "gnu")))]
    let library: [(&CStr, usize); 0] = [];
    // SAFETY: `headers` are those of the library that `handle` keeps loaded, and `base_address` is where the loader mapped it.
    let unresolved = unsafe {
        resolve_lazy_imports(
            headers,
            module.base_address,
            defers_got,
            &library,
            is_defined,
        )
    };
    match unresolved {
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

/// Node's executable exports its zlib to addons, and Bun's does not. Bun fills all of an addon's imports of these functions or none: it fills only when every relocation that names one is unbound and storable and no lookup finds one of the names in the global scope or in the addon's own libraries. Otherwise the check runs as without this table.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
mod host_zlib {
    use core::ffi::CStr;

    use bun_zlib as zlib;

    /// The imports of uWebSockets.js. Each function here stays in the binary for addons alone, if nothing else calls it.
    pub(super) fn functions() -> [(&'static CStr, usize); 13] {
        [
            (c"deflate", zlib::deflate as *const () as usize),
            (c"deflateBound", zlib::deflateBound as *const () as usize),
            (c"deflateEnd", zlib::deflateEnd as *const () as usize),
            (c"deflateInit2_", zlib::deflateInit2_ as *const () as usize),
            (c"deflateInit_", zlib::deflateInit_ as *const () as usize),
            (c"deflateReset", zlib::deflateReset as *const () as usize),
            (
                c"deflateSetDictionary",
                zlib::deflateSetDictionary as *const () as usize,
            ),
            (c"inflate", zlib::inflate as *const () as usize),
            (c"inflateEnd", zlib::inflateEnd as *const () as usize),
            (c"inflateInit2_", zlib::inflateInit2_ as *const () as usize),
            (c"inflateInit_", zlib::inflateInit_ as *const () as usize),
            (c"inflateReset", zlib::inflateReset as *const () as usize),
            (
                c"inflateSetDictionary",
                zlib::inflateSetDictionary as *const () as usize,
            ),
        ]
    }
}
