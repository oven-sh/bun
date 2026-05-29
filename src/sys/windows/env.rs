use core::ffi::c_char;

use bun_alloc::AllocError;

/// After running `convert_env_to_wtf8`, the pointers in `std.os.environ` will point into this buffer.
// PORTING.md §Global mutable state: written exactly once at program startup
// before any threads are spawned. RacyCell — startup-only.
pub(crate) static WTF8_ENV_BUF: bun_core::RacyCell<Option<&'static [u8]>> =
    bun_core::RacyCell::new(None);
/// `convert_env_to_wtf8` will set this to the original value of `std.os.environ`.
// SAFETY: written exactly once at program startup before any threads are
// spawned. Stored as a raw (ptr, len) pair (no `&mut` aliasing assertion);
// `None` means "unset".
pub(crate) static ORIG_ENVIRON: bun_core::RacyCell<Option<(*mut *mut c_char, usize)>> =
    bun_core::RacyCell::new(None);

static ENV_CONVERTED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

pub fn convert_env_to_wtf8() -> Result<(), AllocError> {
    assert!(
        !ENV_CONVERTED.load(core::sync::atomic::Ordering::Relaxed),
        "convertEnvToWTF8 may only be called once"
    );
    ENV_CONVERTED.store(true, core::sync::atomic::Ordering::Relaxed);
    let env_guard = scopeguard::guard((), |()| {
        ENV_CONVERTED.store(false, core::sync::atomic::Ordering::Relaxed);
    });

    let mut num_vars: usize = 0;
    let wtf8_buf: Vec<u8> = 'blk: {
        // TODO(port): Zig's wrapper returns OOM on null; verify `crate::windows::GetEnvironmentStringsW` signature.
        let wtf16_buf: *mut u16 = crate::windows::GetEnvironmentStringsW()?;
        let _free = scopeguard::guard(wtf16_buf, |p| {
            crate::windows::FreeEnvironmentStringsW(p);
        });
        let mut len: usize = 0;
        loop {
            // SAFETY: `wtf16_buf` is a contiguous double-NUL-terminated block returned by the OS;
            // every offset we read is inside that block until we observe the terminating empty string.
            let str_len = unsafe { bun_core::ffi::wcslen(wtf16_buf.add(len)) };
            len += str_len + 1; // each string is null-terminated
            if str_len == 0 {
                break; // array ends with empty null-terminated string
            }
            num_vars += 1;
        }
        // SAFETY: we just measured `len` u16 elements (including terminators) within the OS-owned block.
        let wtf16_slice = unsafe { bun_core::ffi::slice(wtf16_buf, len) };
        // Zig: `bun.strings.toUTF8AllocWithType(allocator, []u16, slice) catch oom()`.
        // Rust `bun_core::strings::to_utf8_alloc` is infallible (panics on OOM)
        // and returns `Vec<u8>` directly — no `?` here.
        break 'blk bun_core::strings::to_utf8_alloc(wtf16_slice);
    };
    let wtf8_buf: &'static [u8] = Box::leak(wtf8_buf.into_boxed_slice());
    let mut len: usize = 0;

    let mut envp: Vec<*mut c_char> = Vec::with_capacity(num_vars + 1);
    loop {
        let remaining = &wtf8_buf[len..];
        let str_len = bun_core::slice_to_nul(remaining).len();
        if str_len == 0 {
            break; // array ends with empty null-terminated string
        }
        // `cast_mut()` is a type-only cast for `char**` ABI compat; the pointee is never
        // written through (all readers go via `environ()` → `*const c_char`).
        let str_ptr: *mut c_char = remaining.as_ptr().cast::<c_char>().cast_mut();
        envp.push(str_ptr);
        len += str_len + 1; // each string is null-terminated
    }
    envp.push(core::ptr::null_mut());

    let envp_slice = Box::leak(envp.into_boxed_slice());
    let envp_nonnull_len = envp_slice.len() - 1;
    // SAFETY: single-threaded startup; statics are written exactly once here.
    unsafe {
        WTF8_ENV_BUF.write(Some(wtf8_buf));
        // TODO(port): need Rust equivalent of Zig `std.os.environ` (process-global envp slice).
        ORIG_ENVIRON.write(Some(bun_core::os::take_environ()));
        bun_core::os::set_environ(envp_slice.as_mut_ptr(), envp_nonnull_len);
    }

    let _ = scopeguard::ScopeGuard::into_inner(env_guard);
    Ok(())
}

// ported from: src/sys/windows/env.zig
