//! Native `navigator.clipboard` primitives (the Web-spec semantics live in
//! `src/js/builtins/Clipboard.ts`), resolved from the work pool: `readTextNative()`
//! → string ("" ⇔ no text) | null ⇔ no backend; `writeTextNative(str)` → bool.

use bun_core::{OwnedString, String as BunString};
use bun_jsc::{
    AnyTaskJob, AnyTaskJobCtx, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsResult,
    StringJsc as _,
};

// ─── JS entry points ($newRustFunction targets) ─────────────────────────────
// The pasteboard round-trip runs off the JS thread via `AnyTaskJob` (the
// `Bun.secrets` shape): a lazily-promised pasteboard flavour can block
// `dataForType:` on another app, which must never stall the event loop.

/// Process-global pasteboard state: serializing our own work-pool jobs keeps
/// concurrent `readText()`/`writeText()` calls from racing `OpenClipboard`
/// (Windows) or interleaving `NSPasteboard` operations.
static CLIPBOARD_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

/// Filled by `run` on the work pool; `then` only converts it to a `JSValue`.
enum Outcome {
    /// Raw pasteboard bytes; other processes write them, so they are not
    /// trusted to be UTF-8 — `clone_utf8` owns handling that.
    Text(Vec<u8>),
    NoText,
    ReadUnavailable,
    WriteOk,
    WriteFailed,
}

pub(crate) struct ClipboardCtx {
    /// `Some(utf8)` ⇔ writeText (snapshotted on the JS thread); `None` ⇔ readText.
    write: Option<Vec<u8>>,
    outcome: Option<Outcome>,
    promise: JSPromiseStrong,
}

impl AnyTaskJobCtx for ClipboardCtx {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        let _guard = CLIPBOARD_LOCK.lock_guard();
        self.outcome = Some(match &self.write {
            Some(bytes) => {
                if platform::write_text(bytes) {
                    Outcome::WriteOk
                } else {
                    Outcome::WriteFailed
                }
            }
            None => match platform::read_text() {
                Ok(Some(bytes)) => Outcome::Text(bytes),
                Ok(None) => Outcome::NoText,
                Err(Unavailable) => Outcome::ReadUnavailable,
            },
        });
    }

    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        // Settle on every path: leaving the promise pending after a failed
        // string conversion (huge text / OOM) would hang the caller forever.
        let promise = self.promise.swap();
        let value = match self.outcome.take().expect("run() filled the outcome") {
            Outcome::Text(bytes) => BunString::clone_utf8(&bytes).transfer_to_js(global),
            // No text on the clipboard — the spec resolves `readText()` with "".
            Outcome::NoText => BunString::static_(b"").to_js(global),
            // The JS layer maps these to a `NotAllowedError` rejection.
            Outcome::ReadUnavailable => Ok(JSValue::NULL),
            Outcome::WriteOk => Ok(JSValue::TRUE),
            Outcome::WriteFailed => Ok(JSValue::FALSE),
        };
        match value {
            Ok(value) => {
                promise.resolve(global, value)?;
            }
            Err(err) => {
                promise.reject_with_async_stack(global, Err(err))?;
            }
        }
        Ok(())
    }
}

/// Schedules the pasteboard op on the work pool and returns the pending promise.
fn schedule(global: &JSGlobalObject, write: Option<Vec<u8>>) -> JsResult<JSValue> {
    let promise = JSPromiseStrong::init(global);
    let promise_value = promise.value();
    AnyTaskJob::create_and_schedule(
        global,
        ClipboardCtx {
            write,
            outcome: None,
            promise,
        },
    )?;
    Ok(promise_value)
}

/// `$newRustFunction("clipboard.rs", "readTextNative", 0)`
pub(crate) fn read_text_native(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    schedule(global, None)
}

/// `$newRustFunction("clipboard.rs", "writeTextNative", 1)`
pub(crate) fn write_text_native(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // The UTF-8 snapshot must happen here, on the JS thread; the work-pool
    // body only ever sees plain bytes.
    let s = OwnedString::new(BunString::from_js(frame.argument(0), global)?);
    schedule(global, Some(s.to_utf8_bytes()))
}

/// "This platform has no in-process clipboard." The JS layer maps it to a
/// `NotAllowedError` rejection (mac/win) or never gets here (Linux uses the
/// subprocess path).
struct Unavailable;

// ─── macOS ──────────────────────────────────────────────────────────────────
// `image_coregraphics_shim.cpp` owns the objc / NSPasteboard plumbing, so the
// text entry points live beside its image reader (same two-phase probe).
#[cfg(target_os = "macos")]
mod platform {
    use super::Unavailable;

    const CG_OK: i32 = 0;

    unsafe extern "C" {
        fn bun_coregraphics_clipboard_read_text(out: *mut u8, out_len: *mut usize) -> i32;
        fn bun_coregraphics_clipboard_write_text(bytes: *const u8, len: usize) -> i32;
    }

    pub(super) fn read_text() -> Result<Option<Vec<u8>>, Unavailable> {
        let mut len: usize = 0;
        // SAFETY: `out = null` is the documented probe phase; `len` is a
        // valid out-param.
        if unsafe { bun_coregraphics_clipboard_read_text(core::ptr::null_mut(), &raw mut len) }
            != CG_OK
        {
            return Err(Unavailable);
        }
        if len == 0 {
            return Ok(None);
        }
        let mut buf = vec![0u8; len];
        // SAFETY: the probe stashed a retained, exactly-`len`-byte NSData for
        // this thread; this call copies it out and releases the stash.
        if unsafe { bun_coregraphics_clipboard_read_text(buf.as_mut_ptr(), &raw mut len) } != CG_OK
        {
            return Err(Unavailable);
        }
        buf.truncate(len);
        Ok(Some(buf))
    }

    pub(super) fn write_text(bytes: &[u8]) -> bool {
        // SAFETY: the shim never reads past `len` and copies the bytes to the
        // pasteboard server before returning.
        unsafe { bun_coregraphics_clipboard_write_text(bytes.as_ptr(), bytes.len()) == CG_OK }
    }
}

// ─── Windows ────────────────────────────────────────────────────────────────
// Raw Win32 like `image/backend_wic.rs`; Windows auto-synthesizes
// `CF_UNICODETEXT` from `CF_TEXT`/`CF_OEMTEXT`, so one format covers any app.
#[cfg(windows)]
mod platform {
    use super::Unavailable;
    use core::ffi::{c_int, c_uint, c_void};
    use core::ptr;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn OpenClipboard(hwnd: *mut c_void) -> c_int;
        fn CloseClipboard() -> c_int;
        fn EmptyClipboard() -> c_int;
        fn GetClipboardData(format: c_uint) -> *mut c_void;
        fn SetClipboardData(format: c_uint, mem: *mut c_void) -> *mut c_void;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalAlloc(flags: c_uint, bytes: usize) -> *mut c_void;
        fn GlobalFree(mem: *mut c_void) -> *mut c_void;
        fn GlobalLock(mem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(mem: *mut c_void) -> c_int;
        fn GlobalSize(mem: *mut c_void) -> usize;
    }

    const CF_UNICODETEXT: c_uint = 13;
    const GMEM_MOVEABLE: c_uint = 0x0002;

    pub(super) fn read_text() -> Result<Option<Vec<u8>>, Unavailable> {
        // SAFETY: a null hwnd is documented as valid for a read-only open.
        if unsafe { OpenClipboard(ptr::null_mut()) } == 0 {
            return Err(Unavailable);
        }
        scopeguard::defer! {
            // SAFETY: the clipboard is open on this thread.
            let _ = unsafe { CloseClipboard() };
        }
        // SAFETY: the clipboard is open. A null handle ⇔ no text present.
        let h = unsafe { GetClipboardData(CF_UNICODETEXT) };
        if h.is_null() {
            return Ok(None);
        }
        // SAFETY: `h` is owned by the clipboard for as long as it stays open;
        // we only read it before `CloseClipboard`.
        let p = unsafe { GlobalLock(h) } as *const u16;
        if p.is_null() {
            return Err(Unavailable);
        }
        // `GlobalSize` over-reports (allocation granularity), and the payload
        // is written by other processes — so never trust it past the first
        // NUL, and never trust a NUL to exist at all.
        // SAFETY: `p .. p+cap` lies inside the locked allocation.
        let cap = unsafe { GlobalSize(h) } / 2;
        let mut n = 0usize;
        while n < cap && unsafe { *p.add(n) } != 0 {
            n += 1;
        }
        // SAFETY: `n <= cap`, and the allocation stays locked for this slice.
        let wide = unsafe { core::slice::from_raw_parts(p, n) };
        let text = String::from_utf16_lossy(wide).into_bytes();
        // SAFETY: balances the `GlobalLock` above.
        unsafe { GlobalUnlock(h) };
        Ok(Some(text))
    }

    pub(super) fn write_text(bytes: &[u8]) -> bool {
        // `CF_UNICODETEXT` is NUL-terminated UTF-16: `sentinel` appends the
        // NUL and `fail_if_invalid = false` replaces ill-formed sequences.
        let Ok(wide) = bun_core::strings::to_utf16_alloc_for_real(bytes, false, true) else {
            return false;
        };
        let nbytes = wide.len() * 2;

        // MSDN's note that `EmptyClipboard` after a null-hwnd open breaks
        // `SetClipboardData` is Win16-era; every modern clipboard library
        // opens with null, and a real failure falls through to `false` below.
        // SAFETY: a null hwnd is documented as valid.
        if unsafe { OpenClipboard(ptr::null_mut()) } == 0 {
            return false;
        }
        scopeguard::defer! {
            // SAFETY: the clipboard is open on this thread.
            let _ = unsafe { CloseClipboard() };
        }
        // SAFETY: the clipboard is open.
        if unsafe { EmptyClipboard() } == 0 {
            return false;
        }
        // SAFETY: `SetClipboardData` requires a `GMEM_MOVEABLE` HGLOBAL.
        let h = unsafe { GlobalAlloc(GMEM_MOVEABLE, nbytes) };
        if h.is_null() {
            return false;
        }
        // SAFETY: `h` is a live, unlocked HGLOBAL of exactly `nbytes` bytes.
        let dst = unsafe { GlobalLock(h) } as *mut u16;
        if dst.is_null() {
            // SAFETY: the clipboard never took `h`, so it is still ours.
            unsafe { GlobalFree(h) };
            return false;
        }
        // SAFETY: `dst` points at `nbytes` writable bytes and `wide` is
        // exactly `nbytes` long.
        unsafe {
            ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
            GlobalUnlock(h);
        }
        // On success the system owns `h`; freeing it would be a double-free.
        // SAFETY: the clipboard is open and emptied, and `h` is unlocked.
        if unsafe { SetClipboardData(CF_UNICODETEXT, h) }.is_null() {
            // SAFETY: the clipboard rejected `h`, so it is still ours.
            unsafe { GlobalFree(h) };
            return false;
        }
        true
    }
}

// ─── everything else (Linux, the BSDs, …) ───────────────────────────────────
// No stable in-process clipboard API exists; the JS layer drives the helper
// subprocesses instead. These exist so the `$newRustFunction` targets resolve.
#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use super::Unavailable;

    pub(super) fn read_text() -> Result<Option<Vec<u8>>, Unavailable> {
        Err(Unavailable)
    }

    pub(super) fn write_text(_bytes: &[u8]) -> bool {
        false
    }
}
