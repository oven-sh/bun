//! Port of `src/runtime/ffi/FFI.zig` — `Bun.FFI` / `bun:ffi`.
//!
//! B-2: full draft (3029 lines, preserved in `ffi_body.rs`) depends on
//! `bun_jsc` method surface (`JSValue::*`, `JSGlobalObject::*`, `JSFunction`,
//! `host_fn::DomCall`, `#[bun_jsc::JsClass]` proc-macro), `bun_napi` (no such
//! crate), `bun_tcc_sys`, `bun_sys::DynLib`, `bun_output` macros. The
//! JIT-protection helper and `Offsets` extern bridge below compile standalone.

use core::ffi::c_int;
use std::sync::Once;

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
#[cfg(any())]
#[path = "ffi_body.rs"]
mod ffi_body; // full Phase-A draft of FFI.zig
#[cfg(any())]
#[path = "FFIObject.rs"]
pub mod ffi_object_draft;

// ─── opaque type surface (replaces lib.rs ffi_stub) ──────────────────────────
// TODO(b2-blocked): bun_jsc::JsClass (proc-macro)
// TODO(b2-blocked): bun_jsc::host_fn::DomCall
// TODO(b2-blocked): bun_napi
// TODO(b2-blocked): bun_sys::DynLib
pub struct FFI(());
pub mod ffi_object {}

// ─── compiling free functions ────────────────────────────────────────────────

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn pthread_jit_write_protect_np(enable: c_int);
}

/// Run a function that needs to write to JIT-protected memory.
///
/// This is dangerous as it allows overwriting executable regions of memory.
/// Do not pass in user-defined functions (including JSFunctions).
pub(crate) fn dangerously_run_without_jit_protections<R>(func: impl FnOnce() -> R) -> R {
    const HAS_PROTECTION: bool = cfg!(all(target_arch = "aarch64", target_os = "macos"));
    if HAS_PROTECTION {
        // SAFETY: aarch64 macOS only; toggles W^X for the current thread
        unsafe { pthread_jit_write_protect_np(false as c_int) };
    }
    let _guard = scopeguard::guard((), |_| {
        if HAS_PROTECTION {
            // SAFETY: re-enable JIT write protection on scope exit
            unsafe { pthread_jit_write_protect_np(true as c_int) };
        }
    });
    // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
    func()
}

#[repr(C)]
pub(crate) struct Offsets {
    pub js_array_buffer_view_offset_of_length: u32,
    pub js_array_buffer_view_offset_of_byte_offset: u32,
    pub js_array_buffer_view_offset_of_vector: u32,
    pub js_cell_offset_of_type: u32,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    #[link_name = "Bun__FFI__offsets"]
    static mut BUN_FFI_OFFSETS: Offsets;
    #[link_name = "Bun__FFI__ensureOffsetsAreLoaded"]
    fn bun_ffi_ensure_offsets_are_loaded();
}

impl Offsets {
    fn load_once() {
        // SAFETY: extern "C" fn populating a static
        unsafe { bun_ffi_ensure_offsets_are_loaded() };
    }
    pub fn get() -> &'static Offsets {
        static ONCE: Once = Once::new();
        ONCE.call_once(Self::load_once);
        // SAFETY: BUN_FFI_OFFSETS is initialized by load_once and never mutated after
        unsafe { &*core::ptr::addr_of!(BUN_FFI_OFFSETS) }
    }
}

/// Get the last dynamic library loading error message in a cross-platform way.
/// On POSIX systems, this calls dlerror().
/// On Windows, this uses GetLastError() and formats the error message.
/// Returns an allocated string that must be freed by the caller.
pub(crate) fn get_dl_error() -> Result<Box<[u8]>, bun_core::Error> {
    #[cfg(windows)]
    {
        use std::io::Write as _;
        // On Windows, we need to use GetLastError() and FormatMessageW()
        // TODO(b2-blocked): bun_sys::windows::GetLastError
        let err_int = 0u32;
        let mut v = Vec::new();
        write!(&mut v, "error code {}", err_int).ok();
        Ok(v.into_boxed_slice())
    }
    #[cfg(not(windows))]
    {
        // On POSIX systems, use dlerror() to get the actual system error
        // SAFETY: dlerror is safe to call from any thread
        let msg: &[u8] = unsafe {
            let p = libc::dlerror();
            if !p.is_null() {
                core::ffi::CStr::from_ptr(p).to_bytes()
            } else {
                b"unknown error"
            }
        };
        // Return a copy since dlerror() string is not stable
        Ok(Box::<[u8]>::from(msg))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/ffi/FFI.zig
//   confidence: low (B-2 thin un-gate)
//   notes:      JIT-protection helper + Offsets bridge compile; FFI struct + JSClass blocked on bun_jsc.
// ──────────────────────────────────────────────────────────────────────────
