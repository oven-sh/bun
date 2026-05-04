use core::ffi::c_char;

use bun_alloc::AllocError;
use bun_str::strings;

/// After running `convert_env_to_wtf8`, the pointers in `std.os.environ` will point into this buffer.
// SAFETY: written exactly once at program startup before any threads are spawned.
pub static mut WTF8_ENV_BUF: Option<&'static [u8]> = None;
/// `convert_env_to_wtf8` will set this to the original value of `std.os.environ`.
// SAFETY: written exactly once at program startup before any threads are spawned.
pub static mut ORIG_ENVIRON: Option<&'static mut [*mut c_char]> = None;

#[cfg(feature = "ci_assert")]
static mut ENV_CONVERTED: bool = false;
// TODO(port): `Environment.ci_assert` mapped to cfg(feature = "ci_assert"); confirm feature name in Phase B.

/// Converts all strings in `std.os.environ` to WTF-8.
///
/// This function should be called only once, at program startup, before any code that needs to
/// access the environment runs.
///
/// This function is Windows-only.
pub fn convert_env_to_wtf8() -> Result<(), AllocError> {
    #[cfg(feature = "ci_assert")]
    {
        // SAFETY: single-threaded startup; see module-level note.
        unsafe {
            debug_assert!(!ENV_CONVERTED, "convertEnvToWTF8 may only be called once");
            ENV_CONVERTED = true;
        }
    }
    #[cfg(feature = "ci_assert")]
    let env_guard = scopeguard::guard((), |_| {
        // SAFETY: single-threaded startup; see module-level note.
        unsafe { ENV_CONVERTED = false };
    });

    let mut num_vars: usize = 0;
    let wtf8_buf: Vec<u8> = 'blk: {
        // TODO(port): Zig's wrapper returns OOM on null; verify `crate::windows::GetEnvironmentStringsW` signature.
        let wtf16_buf: *mut u16 = crate::windows::GetEnvironmentStringsW()?;
        let _free = scopeguard::guard(wtf16_buf, |p| {
            // SAFETY: `p` was returned by GetEnvironmentStringsW and has not been freed.
            unsafe { crate::windows::FreeEnvironmentStringsW(p) };
        });
        let mut len: usize = 0;
        loop {
            // SAFETY: `wtf16_buf` is a contiguous double-NUL-terminated block returned by the OS;
            // every offset we read is inside that block until we observe the terminating empty string.
            let str_len = unsafe {
                let mut n = 0usize;
                while *wtf16_buf.add(len + n) != 0 {
                    n += 1;
                }
                n
            };
            len += str_len + 1; // each string is null-terminated
            if str_len == 0 {
                break; // array ends with empty null-terminated string
            }
            num_vars += 1;
        }
        // SAFETY: we just measured `len` u16 elements (including terminators) within the OS-owned block.
        let wtf16_slice = unsafe { core::slice::from_raw_parts(wtf16_buf, len) };
        break 'blk strings::to_utf8_alloc(wtf16_slice)?;
        // TODO(port): Zig called `bun.strings.toUTF8AllocWithType`; confirm Rust fn name/signature in bun_str.
    };
    let mut wtf8_buf = wtf8_buf.into_boxed_slice();
    let mut len: usize = 0;

    let mut envp: Vec<*mut c_char> = Vec::with_capacity(num_vars + 1);
    loop {
        let str_len = wtf8_buf[len..]
            .iter()
            .position(|&b| b == 0)
            .expect("unreachable");
        // PORT NOTE: Zig used `defer len += str_len + 1;` which also runs on `break`.
        if str_len == 0 {
            len += str_len + 1; // each string is null-terminated
            break; // array ends with empty null-terminated string
        }
        let str_ptr: *mut c_char = wtf8_buf[len..].as_mut_ptr().cast::<c_char>();
        envp.push(str_ptr);
        len += str_len + 1; // each string is null-terminated
    }
    envp.push(core::ptr::null_mut());

    let envp_slice: &'static mut [*mut c_char] = Box::leak(envp.into_boxed_slice());
    let envp_nonnull_len = envp_slice.len() - 1;
    let envp_nonnull_slice: &'static mut [*mut c_char] = &mut envp_slice[0..envp_nonnull_len];
    // SAFETY: single-threaded startup; statics are written exactly once here.
    unsafe {
        WTF8_ENV_BUF = Some(Box::leak(wtf8_buf));
        // TODO(port): need Rust equivalent of Zig `std.os.environ` (process-global envp slice).
        ORIG_ENVIRON = Some(bun_core::os::take_environ());
        bun_core::os::set_environ(envp_nonnull_slice);
    }

    #[cfg(feature = "ci_assert")]
    let _ = scopeguard::ScopeGuard::into_inner(env_guard);
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/windows/env.zig (60 lines)
//   confidence: medium
//   todos:      3
//   notes:      Windows-only startup; needs Rust-side `std.os.environ` global (bun_core::os) and confirmed bun_str transcoder name.
// ──────────────────────────────────────────────────────────────────────────
