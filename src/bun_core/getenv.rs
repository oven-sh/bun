use crate::zstr::ZStr;

/// `bun.getenvZ` — read an environment variable. Returns the value as borrowed
/// process-static bytes (env block lives for the process). On POSIX wraps
/// `libc::getenv`; on Windows scans `environ` case-insensitively.
///
/// Port of `bun.zig:getenvZ` / `getenvZAnyCase`.
pub fn getenv_z(key: &ZStr) -> Option<&'static [u8]> {
    #[cfg(not(any(unix, windows)))]
    {
        let _ = key;
        return None;
    }
    #[cfg(unix)]
    unsafe {
        // SAFETY: key is NUL-terminated by ZStr invariant; getenv reads until NUL.
        let p = libc::getenv(key.as_ptr());
        if p.is_null() {
            return None;
        }
        // SAFETY: getenv returns a pointer into the process env block, valid for
        // process lifetime (modulo setenv races — same caveat as Zig original).
        let len = libc::strlen(p);
        return Some(core::slice::from_raw_parts(p.cast::<u8>(), len));
    }
    #[cfg(windows)]
    {
        // Windows env names are case-insensitive (Zig spec: `getenvZ` on
        // Windows delegates to `getenvZAnyCase`). Walk the WTF-8 env block
        // populated at startup by `bun_sys::windows::env::convert_env_to_wtf8`
        // (main.zig:47). The block is `Box::leak`'d for process lifetime so
        // `'static` borrows here are sound.
        getenv_z_any_case(key)
    }
}

/// Read the C `environ` global (`*const *const c_char`, NUL-terminated array of
/// NUL-terminated `KEY=VALUE` entries). Single decl for all POSIX call sites.
/// `#[inline]` and allocation-free so it stays async-signal-safe for the
/// post-fork crash-handler child path.
#[cfg(unix)]
#[inline]
pub fn c_environ() -> *const *const core::ffi::c_char {
    // `AtomicPtr<T>` is `#[repr(C)]` over `*mut T`, so this has the same
    // layout as libc's `char **environ`; a Relaxed word load is sound under
    // concurrent `setenv` and compiles to the same single load as a plain
    // `static` read.
    unsafe extern "C" {
        // `safe static` (Rust 2024 `unsafe extern`) discharges the link-time
        // existence proof; `AtomicPtr::load` itself is already safe.
        safe static environ: core::sync::atomic::AtomicPtr<*const core::ffi::c_char>;
    }
    environ.load(core::sync::atomic::Ordering::Relaxed)
}

/// `bun.getenvZAnyCase` — case-insensitive env lookup (used on POSIX for
/// CI-detection vars where casing varies across providers).
pub fn getenv_z_any_case(key: &ZStr) -> Option<&'static [u8]> {
    #[cfg(unix)]
    unsafe {
        // SAFETY: `environ` is the C env block; entries are NUL-terminated `KEY=VALUE`.
        let mut p = c_environ();
        while !(*p).is_null() {
            let line = core::slice::from_raw_parts((*p).cast::<u8>(), libc::strlen(*p));
            let key_end = line.iter().position(|&b| b == b'=').unwrap_or(line.len());
            if crate::strings::eql_case_insensitive_ascii_check_length(
                &line[..key_end],
                key.as_bytes(),
            ) {
                return Some(&line[(key_end + 1).min(line.len())..]);
            }
            p = p.add(1);
        }
        None
    }
    #[cfg(windows)]
    {
        // Walk `os::environ()` — WTF-8 `KEY=VALUE` C strings populated at
        // startup by `convert_env_to_wtf8`. Same scan as the unix arm above
        // but the block is owned by us (Box::leak'd) instead of libc.
        // SAFETY: env block is process-lifetime; written exactly once at
        // startup before any reader runs.
        let environ = unsafe { crate::os::environ() };
        for &entry in environ {
            if entry.is_null() {
                continue;
            }
            // SAFETY: each entry is a NUL-terminated WTF-8 string into the
            // leaked `WTF8_ENV_BUF` allocation.
            let line = unsafe {
                let mut len = 0usize;
                while *entry.add(len) != 0 {
                    len += 1;
                }
                core::slice::from_raw_parts(entry.cast::<u8>(), len)
            };
            let key_end = line.iter().position(|&b| b == b'=').unwrap_or(line.len());
            if crate::strings::eql_case_insensitive_ascii_check_length(
                &line[..key_end],
                key.as_bytes(),
            ) {
                return Some(&line[(key_end + 1).min(line.len())..]);
            }
        }
        None
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = key;
        None
    }
}
