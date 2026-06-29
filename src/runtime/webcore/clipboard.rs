//! Native `navigator.clipboard` primitives; the Web-spec semantics live in
//! `src/js/builtins/Clipboard.ts`. Every operation resolves from the work
//! pool — see each `*_native` fn for its exact JS-facing contract.

use bun_core::{OwnedString, String as BunString};
use bun_jsc::{
    AnyTaskJob, AnyTaskJobCtx, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsResult,
    StringJsc as _,
};

// ─── JS entry points ($newRustFunction targets) ─────────────────────────────
// The pasteboard round-trip runs off the JS thread via `AnyTaskJob` (the
// `Bun.secrets` shape): a lazily-promised pasteboard flavour can block
// `dataForType:` on another app, which must never stall the event loop.

/// Serializes our own work-pool jobs so concurrent clipboard calls cannot
/// race `OpenClipboard` (Windows) or interleave `NSPasteboard` operations.
/// Other processes can still mutate the clipboard at any time.
static CLIPBOARD_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

/// A clipboard representation this implementation knows how to map onto the
/// platform pasteboard. The JS layer only requests MIME types it advertises
/// via `ClipboardItem.supports()`, but unknown ones still resolve to `null`.
#[derive(Clone, Copy, PartialEq)]
enum Mime {
    TextPlain,
    TextHtml,
    ImagePng,
}

impl Mime {
    fn from_bytes(bytes: &[u8]) -> Option<Mime> {
        match bytes {
            b"text/plain" => Some(Mime::TextPlain),
            b"text/html" => Some(Mime::TextHtml),
            b"image/png" => Some(Mime::ImagePng),
            _ => None,
        }
    }
}

/// What `run` executes off the JS thread; inputs are plain owned bytes
/// snapshotted on the JS thread so no JS value ever crosses the hop.
enum Op {
    ReadText,
    WriteText(Vec<u8>),
    ReadTypes(Vec<Option<Mime>>),
    WriteTypes(Vec<(Mime, Vec<u8>)>),
}

/// Filled by `run` on the work pool; `then` only converts it to a `JSValue`.
enum Outcome {
    /// Raw pasteboard bytes; other processes write them, so they are not
    /// trusted to be UTF-8 — `clone_utf8` owns handling that.
    Text(Vec<u8>),
    NoText,
    /// One slot per requested type, `None` ⇔ that representation is absent.
    Types(Vec<Option<Vec<u8>>>),
    ReadUnavailable,
    WriteOk,
    WriteFailed,
}

pub(crate) struct ClipboardCtx {
    op: Op,
    outcome: Option<Outcome>,
    promise: JSPromiseStrong,
}

impl AnyTaskJobCtx for ClipboardCtx {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        let _guard = CLIPBOARD_LOCK.lock_guard();
        self.outcome = Some(match &self.op {
            Op::ReadText => match platform::read_type(Mime::TextPlain) {
                Ok(Some(bytes)) => Outcome::Text(bytes),
                Ok(None) => Outcome::NoText,
                Err(Unavailable) => Outcome::ReadUnavailable,
            },
            Op::WriteText(bytes) => write_outcome(platform::write_types(&[(
                Mime::TextPlain,
                bytes.as_slice(),
            )])),
            // One job (and one lock acquisition) per `read()`, so our own
            // concurrent calls never interleave; other processes can still
            // change the clipboard between the per-type probes.
            Op::ReadTypes(mimes) => {
                let mut slots: Vec<Option<Vec<u8>>> = Vec::with_capacity(mimes.len());
                let mut unavailable = false;
                for mime in mimes {
                    match mime {
                        None => slots.push(None),
                        Some(mime) => match platform::read_type(*mime) {
                            Ok(slot) => slots.push(slot),
                            Err(Unavailable) => {
                                unavailable = true;
                                break;
                            }
                        },
                    }
                }
                if unavailable {
                    Outcome::ReadUnavailable
                } else {
                    Outcome::Types(slots)
                }
            }
            Op::WriteTypes(items) => {
                let borrowed: Vec<(Mime, &[u8])> =
                    items.iter().map(|(m, b)| (*m, b.as_slice())).collect();
                write_outcome(platform::write_types(&borrowed))
            }
        });
    }

    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        // Settle on every path: leaving the promise pending after a failed
        // conversion (huge text / OOM) would hang the caller forever.
        let promise = self.promise.swap();
        let value = match self.outcome.take().expect("run() filled the outcome") {
            Outcome::Text(bytes) => BunString::clone_utf8(&bytes).transfer_to_js(global),
            // No text on the clipboard — the spec resolves `readText()` with "".
            Outcome::NoText => BunString::static_(b"").to_js(global),
            Outcome::Types(slots) => {
                JSValue::create_array_from_iter(global, slots.into_iter(), |slot| {
                    Ok(match slot {
                        // `create_buffer` adopts the leaked bytes (no copy).
                        Some(bytes) => JSValue::create_buffer(global, bytes.leak()),
                        None => JSValue::NULL,
                    })
                })
            }
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

fn write_outcome(ok: bool) -> Outcome {
    if ok {
        Outcome::WriteOk
    } else {
        Outcome::WriteFailed
    }
}

/// Schedules the pasteboard op on the work pool and returns the pending promise.
fn schedule(global: &JSGlobalObject, op: Op) -> JsResult<JSValue> {
    let promise = JSPromiseStrong::init(global);
    let promise_value = promise.value();
    AnyTaskJob::create_and_schedule(
        global,
        ClipboardCtx {
            op,
            outcome: None,
            promise,
        },
    )?;
    Ok(promise_value)
}

/// JS string → owned UTF-8 (WTF-8 for lone surrogates) bytes, on the JS thread.
fn snapshot_utf8(global: &JSGlobalObject, value: JSValue) -> JsResult<Vec<u8>> {
    let s = OwnedString::new(BunString::from_js(value, global)?);
    Ok(s.to_utf8_bytes())
}

/// `$newRustFunction("clipboard.rs", "readTextNative", 0)` — resolves with the
/// clipboard text ("" ⇔ no text) or `null` ⇔ no reachable backend.
pub(crate) fn read_text_native(global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
    schedule(global, Op::ReadText)
}

/// `$newRustFunction("clipboard.rs", "writeTextNative", 1)` — resolves `true`
/// when the text replaced the clipboard contents.
pub(crate) fn write_text_native(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let bytes = snapshot_utf8(global, frame.argument(0))?;
    schedule(global, Op::WriteText(bytes))
}

/// `$newRustFunction("clipboard.rs", "readTypesNative", 1)` — takes an array
/// of MIME strings; resolves with `null` (no backend) or an index-aligned
/// array of one `Uint8Array | null` per requested type.
pub(crate) fn read_types_native(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let mut mimes: Vec<Option<Mime>> = Vec::new();
    let mut iter = frame.argument(0).array_iterator(global)?;
    while let Some(value) = iter.next()? {
        let mime = snapshot_utf8(global, value)?;
        mimes.push(Mime::from_bytes(&mime));
    }
    schedule(global, Op::ReadTypes(mimes))
}

/// `$newRustFunction("clipboard.rs", "writeTypesNative", 2)` — takes an array
/// of MIME strings and an index-aligned array of `Uint8Array`s; resolves
/// `true` when every representation was written.
pub(crate) fn write_types_native(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let mut items: Vec<(Mime, Vec<u8>)> = Vec::new();
    let mut mime_iter = frame.argument(0).array_iterator(global)?;
    let mut buffer_iter = frame.argument(1).array_iterator(global)?;
    while let Some(value) = mime_iter.next()? {
        let mime = snapshot_utf8(global, value)?;
        // The JS layer only sends MIME types `ClipboardItem.supports()`
        // advertises, index-aligned with the typed-array list.
        let (Some(mime), Some(buffer)) = (Mime::from_bytes(&mime), buffer_iter.next()?) else {
            return Ok(JSValue::FALSE);
        };
        let Some(view) = buffer.as_array_buffer(global) else {
            return Ok(JSValue::FALSE);
        };
        items.push((mime, view.byte_slice().to_vec()));
    }
    schedule(global, Op::WriteTypes(items))
}

/// "This platform has no in-process clipboard." The JS layer maps it to a
/// `NotAllowedError` rejection (mac/win) or never gets here (the helper
/// platforms branch in JS first).
struct Unavailable;

// ─── macOS ──────────────────────────────────────────────────────────────────
// `image_coregraphics_shim.cpp` owns the objc / NSPasteboard plumbing, so the
// clipboard entry points live beside its image reader (same two-phase probe).
#[cfg(target_os = "macos")]
mod platform {
    use core::ffi::{CStr, c_char};

    use super::{Mime, Unavailable};

    const CG_OK: i32 = 0;

    unsafe extern "C" {
        fn bun_coregraphics_clipboard_read_type(
            uti: *const c_char,
            out: *mut u8,
            out_len: *mut usize,
        ) -> i32;
        fn bun_coregraphics_clipboard_write_types(
            utis: *const *const c_char,
            datas: *const *const u8,
            lens: *const usize,
            count: usize,
        ) -> i32;
    }

    /// The pasteboard server promotes the legacy flavours of each of these
    /// (and converts other image containers to `public.png`) on demand.
    fn uti(mime: Mime) -> &'static CStr {
        match mime {
            Mime::TextPlain => c"public.utf8-plain-text",
            Mime::TextHtml => c"public.html",
            Mime::ImagePng => c"public.png",
        }
    }

    pub(super) fn read_type(mime: Mime) -> Result<Option<Vec<u8>>, Unavailable> {
        let uti = uti(mime).as_ptr();
        let mut len: usize = 0;
        // SAFETY: `out = null` is the documented probe phase; `len` is a
        // valid out-param and `uti` is a NUL-terminated static.
        if unsafe { bun_coregraphics_clipboard_read_type(uti, core::ptr::null_mut(), &raw mut len) }
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
        if unsafe { bun_coregraphics_clipboard_read_type(uti, buf.as_mut_ptr(), &raw mut len) }
            != CG_OK
        {
            return Err(Unavailable);
        }
        buf.truncate(len);
        Ok(Some(buf))
    }

    pub(super) fn write_types(items: &[(Mime, &[u8])]) -> bool {
        // Never `clearContents` with nothing to set; the JS layer already
        // treats an empty item list as a no-op.
        if items.is_empty() {
            return true;
        }
        let mut utis: Vec<*const c_char> = Vec::with_capacity(items.len());
        let mut datas: Vec<*const u8> = Vec::with_capacity(items.len());
        let mut lens: Vec<usize> = Vec::with_capacity(items.len());
        for (mime, bytes) in items {
            utis.push(uti(*mime).as_ptr());
            datas.push(bytes.as_ptr());
            lens.push(bytes.len());
        }
        // SAFETY: the three arrays are index-aligned and outlive the call;
        // the shim copies every payload to the pasteboard before returning.
        unsafe {
            bun_coregraphics_clipboard_write_types(
                utis.as_ptr(),
                datas.as_ptr(),
                lens.as_ptr(),
                items.len(),
            ) == CG_OK
        }
    }
}

// ─── Windows ────────────────────────────────────────────────────────────────
// Raw Win32 like `image/backend_wic.rs`. Text uses `CF_UNICODETEXT` (Windows
// auto-synthesizes it from the legacy text formats); PNG uses the registered
// "PNG" / "image/png" formats that browsers and most apps interchange.
#[cfg(windows)]
mod platform {
    use core::ffi::{CStr, c_int, c_uint, c_void};
    use core::ptr;

    use super::{Mime, Unavailable};

    #[link(name = "user32")]
    unsafe extern "system" {
        fn OpenClipboard(hwnd: *mut c_void) -> c_int;
        fn CloseClipboard() -> c_int;
        fn EmptyClipboard() -> c_int;
        fn GetClipboardData(format: c_uint) -> *mut c_void;
        fn SetClipboardData(format: c_uint, mem: *mut c_void) -> *mut c_void;
        fn RegisterClipboardFormatA(name: *const core::ffi::c_char) -> c_uint;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalAlloc(flags: c_uint, bytes: usize) -> *mut c_void;
        fn GlobalFree(mem: *mut c_void) -> *mut c_void;
        fn GlobalLock(mem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(mem: *mut c_void) -> c_int;
        fn GlobalSize(mem: *mut c_void) -> usize;
        fn Sleep(milliseconds: c_uint);
    }

    const CF_UNICODETEXT: c_uint = 13;
    const GMEM_MOVEABLE: c_uint = 0x0002;

    fn register(name: &CStr) -> Option<c_uint> {
        // SAFETY: a static NUL-terminated name; registering twice is fine.
        match unsafe { RegisterClipboardFormatA(name.as_ptr()) } {
            0 => None,
            id => Some(id),
        }
    }

    /// The formats probed for a read, in preference order. Apps register raw
    /// PNG bytes under either name, so accept both (like the image reader).
    /// `text/html` needs the `CF_HTML` envelope, which is not implemented.
    fn read_formats(mime: Mime) -> [Option<c_uint>; 2] {
        match mime {
            Mime::TextPlain => [Some(CF_UNICODETEXT), None],
            Mime::ImagePng => [register(c"PNG"), register(c"image/png")],
            Mime::TextHtml => [None, None],
        }
    }

    /// The single format a representation is written as.
    fn write_format(mime: Mime) -> Option<c_uint> {
        match mime {
            Mime::TextPlain => Some(CF_UNICODETEXT),
            Mime::ImagePng => register(c"PNG"),
            Mime::TextHtml => None,
        }
    }

    /// `OpenClipboard` is system-wide exclusive, so a single attempt fails
    /// spuriously whenever any other process (a clipboard manager, RDP) holds
    /// it; retry briefly like arboard / Chromium / .NET do.
    fn open_clipboard_retrying() -> bool {
        for attempt in 0..5u32 {
            // SAFETY: a null hwnd is documented as valid.
            if unsafe { OpenClipboard(ptr::null_mut()) } != 0 {
                return true;
            }
            // SAFETY: no preconditions.
            unsafe { Sleep(5 * (attempt + 1)) };
        }
        false
    }

    /// Copies a locked HGLOBAL: `text` trims at the first NUL and converts
    /// from UTF-16; binary payloads keep `GlobalSize`'s length, which can
    /// over-report by allocation slack (Win32 has no exact-length channel).
    fn copy_global(h: *mut c_void, text: bool) -> Result<Option<Vec<u8>>, Unavailable> {
        // SAFETY: `h` is owned by the clipboard for as long as it stays open;
        // we only read it before `CloseClipboard`.
        let p = unsafe { GlobalLock(h) };
        if p.is_null() {
            return Err(Unavailable);
        }
        scopeguard::defer! {
            // SAFETY: balances the successful `GlobalLock` above.
            let _ = unsafe { GlobalUnlock(h) };
        }
        // SAFETY: the allocation stays locked for every read below.
        let total = unsafe { GlobalSize(h) };
        if text {
            // The payload is written by other processes — never trust it past
            // the first NUL, and never trust a NUL to exist at all.
            let wide_ptr = p as *const u16;
            let cap = total / 2;
            let mut n = 0usize;
            // SAFETY: `wide_ptr .. wide_ptr+cap` lies inside the allocation.
            while n < cap && unsafe { *wide_ptr.add(n) } != 0 {
                n += 1;
            }
            // SAFETY: `n <= cap`, and the allocation stays locked.
            let wide = unsafe { core::slice::from_raw_parts(wide_ptr, n) };
            return Ok(Some(String::from_utf16_lossy(wide).into_bytes()));
        }
        // SAFETY: `total` bytes of the locked allocation are readable.
        Ok(Some(
            unsafe { core::slice::from_raw_parts(p.cast::<u8>(), total) }.to_vec(),
        ))
    }

    pub(super) fn read_type(mime: Mime) -> Result<Option<Vec<u8>>, Unavailable> {
        let formats = read_formats(mime);
        if formats.iter().all(Option::is_none) {
            return Ok(None);
        }
        if !open_clipboard_retrying() {
            return Err(Unavailable);
        }
        scopeguard::defer! {
            // SAFETY: the clipboard is open on this thread.
            let _ = unsafe { CloseClipboard() };
        }
        for format in formats.into_iter().flatten() {
            // SAFETY: the clipboard is open. A null handle ⇔ format absent.
            let h = unsafe { GetClipboardData(format) };
            if !h.is_null() {
                return copy_global(h, mime == Mime::TextPlain);
            }
        }
        Ok(None)
    }

    /// Build a `GMEM_MOVEABLE` HGLOBAL holding `bytes` (plus a NUL-terminated
    /// UTF-16 conversion for text). Returns null on allocation failure.
    fn make_global(mime: Mime, bytes: &[u8]) -> *mut c_void {
        let wide;
        let payload: &[u8] = if mime == Mime::TextPlain {
            // `fail_if_invalid = false` replaces ill-formed sequences and
            // `sentinel` appends the NUL that `CF_UNICODETEXT` requires.
            match bun_core::strings::to_utf16_alloc_for_real(bytes, false, true) {
                Ok(w) => {
                    wide = w;
                    // SAFETY: a `&[u16]`'s bytes reinterpreted as `&[u8]`.
                    unsafe {
                        core::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2)
                    }
                }
                Err(_) => return ptr::null_mut(),
            }
        } else {
            bytes
        };
        // `GlobalAlloc(_, 0)` returns a discarded object whose `GlobalLock`
        // fails, so an empty representation still allocates one byte.
        // SAFETY: `SetClipboardData` requires a `GMEM_MOVEABLE` HGLOBAL.
        let h = unsafe { GlobalAlloc(GMEM_MOVEABLE, payload.len().max(1)) };
        if h.is_null() {
            return ptr::null_mut();
        }
        // SAFETY: `h` is a live, unlocked HGLOBAL of at least `payload.len()` bytes.
        let dst = unsafe { GlobalLock(h) };
        if dst.is_null() {
            // SAFETY: the clipboard never saw `h`, so it is still ours.
            unsafe { GlobalFree(h) };
            return ptr::null_mut();
        }
        // SAFETY: `dst` points at `payload.len()` writable bytes.
        unsafe {
            ptr::copy_nonoverlapping(payload.as_ptr(), dst.cast::<u8>(), payload.len());
            GlobalUnlock(h);
        }
        h
    }

    pub(super) fn write_types(items: &[(Mime, &[u8])]) -> bool {
        if items.is_empty() {
            return true;
        }
        // Fully prepare every replacement HGLOBAL before touching the
        // clipboard: `EmptyClipboard` destroys the previous contents, so
        // nothing fallible may sit between it and the `SetClipboardData`s.
        let mut prepared: Vec<(c_uint, *mut c_void)> = Vec::with_capacity(items.len());
        for (mime, bytes) in items {
            let Some(format) = write_format(*mime) else {
                free_all(&prepared);
                return false;
            };
            let h = make_global(*mime, bytes);
            if h.is_null() {
                free_all(&prepared);
                return false;
            }
            prepared.push((format, h));
        }
        if !open_clipboard_retrying() {
            free_all(&prepared);
            return false;
        }
        scopeguard::defer! {
            // SAFETY: the clipboard is open on this thread.
            let _ = unsafe { CloseClipboard() };
        }
        // SAFETY: the clipboard is open.
        if unsafe { EmptyClipboard() } == 0 {
            free_all(&prepared);
            return false;
        }
        for (index, (format, h)) in prepared.iter().enumerate() {
            // On success the system owns `h`; freeing it would be a double-free.
            // SAFETY: the clipboard is open and emptied, and `h` is unlocked.
            if unsafe { SetClipboardData(*format, *h) }.is_null() {
                // SAFETY: the clipboard rejected this handle and never saw the
                // rest, so they are all still ours.
                free_all(&prepared[index..]);
                return false;
            }
        }
        true
    }

    fn free_all(handles: &[(c_uint, *mut c_void)]) {
        for (_, h) in handles {
            // SAFETY: every handle here was never accepted by the clipboard.
            unsafe { GlobalFree(*h) };
        }
    }
}

// ─── everything else (Linux, the BSDs, …) ───────────────────────────────────
// No stable in-process clipboard API exists; the JS layer drives the helper
// subprocesses instead. These exist so the `$newRustFunction` targets resolve.
#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use super::{Mime, Unavailable};

    pub(super) fn read_type(_mime: Mime) -> Result<Option<Vec<u8>>, Unavailable> {
        Err(Unavailable)
    }

    pub(super) fn write_types(_items: &[(Mime, &[u8])]) -> bool {
        false
    }
}
