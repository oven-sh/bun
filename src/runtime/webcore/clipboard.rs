//! Native `navigator.clipboard` backend: the platform clipboard I/O and the
//! async plumbing. The JS-visible classes are C++ (`JSClipboard*.cpp`,
//! `JSClipboardItem.cpp`); they call the `Bun__Clipboard__*` entry points
//! below, each returning a promise settled from the work pool.

use core::ffi::c_char;

use bun_core::{OwnedString, String as BunString};
use bun_jsc::{
    AnyTaskJob, AnyTaskJobCtx, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, StringJsc as _,
};

// Implemented by the C++ classes: firing the copy/paste events at the
// `navigator.clipboard` EventTarget, building the DOMExceptions the clipboard
// promises reject with, wrapping a `Blob` impl, and constructing the
// `ClipboardItem` that `read()` resolves with.
unsafe extern "C" {
    fn Bun__Clipboard__fireEvent(global: &JSGlobalObject, is_copy: bool);
    fn Bun__Clipboard__createNotAllowedError(
        global: &JSGlobalObject,
        message: &BunString,
    ) -> JSValue;
    fn Bun__ClipboardItem__createFromEntries(
        global: &JSGlobalObject,
        types: JSValue,
        blobs: JSValue,
    ) -> JSValue;
}

/// Serializes our own work-pool jobs so concurrent clipboard calls cannot
/// race `OpenClipboard` (Windows) or interleave `NSPasteboard` operations.
/// Other processes can still mutate the clipboard at any time.
static CLIPBOARD_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

/// What this build's backend can put on / take off the OS clipboard. The C++
/// layer (`ClipboardItem.supports`, `write()` validation) asks through
/// `Bun__Clipboard__supportsType`, so this is the single source of truth.
/// `text/html` needs the `CF_HTML` envelope on Windows — not implemented.
#[cfg(not(windows))]
const SUPPORTED: &[Mime] = &[Mime::TextPlain, Mime::TextHtml, Mime::ImagePng];
#[cfg(windows)]
const SUPPORTED: &[Mime] = &[Mime::TextPlain, Mime::ImagePng];

/// The POSIX one-shot helpers (`wl-copy`, `xclip`) own a single
/// representation per invocation; the in-process backends write them all.
const WRITES_SINGLE_REPRESENTATION: bool = cfg!(not(any(target_os = "macos", windows)));

/// A clipboard representation this backend can map onto the platform
/// clipboard.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mime {
    TextPlain,
    TextHtml,
    ImagePng,
}

impl Mime {
    fn as_str(self) -> &'static str {
        match self {
            Mime::TextPlain => "text/plain",
            Mime::TextHtml => "text/html",
            Mime::ImagePng => "image/png",
        }
    }

    /// The `'static` NUL-terminated form `Blob__fromBytesWithType` requires.
    fn as_cstr(self) -> *const c_char {
        match self {
            Mime::TextPlain => c"text/plain".as_ptr(),
            Mime::TextHtml => c"text/html".as_ptr(),
            Mime::ImagePng => c"image/png".as_ptr(),
        }
    }

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
    Read,
    WriteItems(Vec<(Mime, Vec<u8>)>),
}

/// Filled by `run` on the work pool; `then` only converts it to a settled
/// promise (and fires the corresponding clipboard event on success).
enum Outcome {
    /// Raw pasteboard bytes; other processes write them, so they are not
    /// trusted to be UTF-8 — `clone_utf8` owns handling that.
    Text(Vec<u8>),
    NoText,
    /// Every supported representation present on the clipboard right now.
    Items(Vec<(Mime, Vec<u8>)>),
    WriteOk,
    Failed(Unavailable),
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
                Err(unavailable) => Outcome::Failed(unavailable),
            },
            Op::WriteText(bytes) => write_outcome(platform::write_types(&[(
                Mime::TextPlain,
                bytes.as_slice(),
            )])),
            // One job (and one lock acquisition) per `read()`, so our own
            // concurrent calls never interleave; other processes can still
            // change the clipboard between the per-type probes.
            Op::Read => {
                let mut present: Vec<(Mime, Vec<u8>)> = Vec::new();
                let mut readable = false;
                let mut unavailable = Unavailable::Platform;
                for mime in SUPPORTED {
                    // A representation whose only helper is missing is merely
                    // absent; the whole read fails only when every one is.
                    match platform::read_type(*mime) {
                        Ok(Some(bytes)) => {
                            readable = true;
                            if !bytes.is_empty() {
                                present.push((*mime, bytes));
                            }
                        }
                        Ok(None) => readable = true,
                        Err(reason) => unavailable = reason,
                    }
                }
                if readable {
                    Outcome::Items(present)
                } else {
                    Outcome::Failed(unavailable)
                }
            }
            Op::WriteItems(items) => {
                let borrowed: Vec<(Mime, &[u8])> =
                    items.iter().map(|(m, b)| (*m, b.as_slice())).collect();
                write_outcome(platform::write_types(&borrowed))
            }
        });
    }

    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        // Settle on every path: leaving the promise pending after a failed
        // conversion (huge text / OOM) would hang the caller forever. The
        // clipboard events fire only after a success, once the promise is
        // settled (the reactions still run later, as microtasks).
        let promise = self.promise.swap();
        match self.outcome.take().expect("run() filled the outcome") {
            Outcome::Text(bytes) => match BunString::clone_utf8(&bytes).transfer_to_js(global) {
                Ok(value) => {
                    promise.resolve(global, value)?;
                    fire_event(global, false);
                }
                Err(err) => promise.reject_with_async_stack(global, Err(err))?,
            },
            // No text on the clipboard — the spec resolves `readText()` with "".
            Outcome::NoText => {
                let empty = BunString::static_(b"").to_js(global)?;
                promise.resolve(global, empty)?;
                fire_event(global, false);
            }
            Outcome::Items(items) => match create_items_array(global, items) {
                Ok(value) => {
                    promise.resolve(global, value)?;
                    fire_event(global, false);
                }
                Err(err) => promise.reject_with_async_stack(global, Err(err))?,
            },
            Outcome::WriteOk => {
                promise.resolve(global, JSValue::UNDEFINED)?;
                fire_event(global, true);
            }
            // The spec'd failure for an unreachable clipboard or a failed
            // write is a "NotAllowedError" DOMException.
            Outcome::Failed(unavailable) => {
                let message = BunString::static_(unavailable.message());
                // SAFETY: FFI into the C++ error factory with live arguments.
                let error = unsafe { Bun__Clipboard__createNotAllowedError(global, &message) };
                promise.reject(global, Ok(error))?;
            }
        }
        Ok(())
    }
}

/// Fires the runtime projection of the spec's clipboard events ("copy" after
/// a successful write, "paste" after a successful read) at
/// `navigator.clipboard`; a no-op if that singleton was never created.
fn fire_event(global: &JSGlobalObject, is_copy: bool) {
    // SAFETY: FFI on the JS thread with a live global.
    unsafe { Bun__Clipboard__fireEvent(global, is_copy) };
}

/// `[ClipboardItem]` (or `[]`) from the representations a `read()` found.
fn create_items_array(global: &JSGlobalObject, items: Vec<(Mime, Vec<u8>)>) -> JsResult<JSValue> {
    if items.is_empty() {
        return JSValue::create_empty_array(global, 0);
    }
    let types = JSValue::create_array_from_iter(global, items.iter(), |(mime, _)| {
        BunString::static_(mime.as_str().as_bytes()).to_js(global)
    })?;
    let blobs = JSValue::create_array_from_iter(global, items.iter(), |(mime, bytes)| {
        // SAFETY: the byte range is live for the call; `as_cstr` is 'static,
        // which `Blob__fromBytesWithType` requires for the content type.
        let blob = unsafe {
            crate::webcore::blob::Blob__fromBytesWithType(
                global,
                bytes.as_ptr(),
                bytes.len(),
                mime.as_cstr(),
            )
        };
        // Wrap the fresh impl in its JS object (ownership transfers to JSC).
        // SAFETY: `blob` is the live, uniquely-owned impl created above.
        Ok(unsafe { crate::webcore::blob::BlobExt::to_js(&*blob, global) })
    })?;
    // The C++ factory returns the empty value ⟺ it threw (OOM).
    // SAFETY: FFI into the C++ ClipboardItem factory with two live arrays.
    let item = bun_jsc::call_zero_is_throw(global, || unsafe {
        Bun__ClipboardItem__createFromEntries(global, types, blobs)
    })?;
    JSValue::create_array_from_slice(global, &[item])
}

/// Schedules the clipboard op on the work pool and returns the pending promise.
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

fn write_outcome(result: Result<(), Unavailable>) -> Outcome {
    match result {
        Ok(()) => Outcome::WriteOk,
        Err(unavailable) => Outcome::Failed(unavailable),
    }
}

// ─── entry points for the C++ classes ───────────────────────────────────────

/// `ClipboardItem.supports()` and the C++ `write()` validation: whether this
/// build's platform backend can represent `mime` on the OS clipboard.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__supportsType(mime: &BunString) -> bool {
    Mime::from_bytes(mime.to_utf8().slice()).is_some_and(|mime| SUPPORTED.contains(&mime))
}

/// Whether the platform backend can only own one representation per write.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__writesSingleRepresentation() -> bool {
    WRITES_SINGLE_REPRESENTATION
}

/// Whether this Blob's bytes are not in memory (`Bun.file()`, S3): the write
/// path snapshots memory synchronously, so such Blobs must be rejected
/// loudly rather than written as empty representations.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__blobNeedsToReadFile(blob: JSValue) -> bool {
    use bun_jsc::JsClass as _;
    // SAFETY: `from_js` returned a pointer to the live, JSC-owned impl of
    // this JS Blob; it is only dereferenced within this JS-thread call.
    crate::webcore::blob::Blob::from_js(blob)
        .is_some_and(|blob| unsafe { (*blob).needs_to_read_file() || (*blob).is_s3() })
}

/// `Clipboard.prototype.readText`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__readText(global: &JSGlobalObject) -> JSValue {
    bun_jsc::to_js_host_fn_result(global, schedule(global, Op::ReadText))
}

/// `Clipboard.prototype.writeText`; the C++ layer already applied the WebIDL
/// `DOMString` conversion, so `text` is the exact string to place.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__writeText(global: &JSGlobalObject, text: &BunString) -> JSValue {
    let bytes = text.to_utf8_bytes();
    bun_jsc::to_js_host_fn_result(global, schedule(global, Op::WriteText(bytes)))
}

/// `Clipboard.prototype.read`: one job reads every supported representation
/// and resolves with `[ClipboardItem]` (or `[]`).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__read(global: &JSGlobalObject) -> JSValue {
    bun_jsc::to_js_host_fn_result(global, schedule(global, Op::Read))
}

/// `Clipboard.prototype.write`, after the C++ layer validated the item and
/// materialized every representation: `mimes` and `blobs` are index-aligned
/// JS arrays of MIME strings and in-memory `Blob`s.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__writeBlobs(
    global: &JSGlobalObject,
    mimes: JSValue,
    blobs: JSValue,
) -> JSValue {
    bun_jsc::to_js_host_fn_result(global, write_blobs(global, mimes, blobs))
}

fn write_blobs(global: &JSGlobalObject, mimes: JSValue, blobs: JSValue) -> JsResult<JSValue> {
    // The C++ layer validated the item, so every entry is a supported MIME
    // string paired with an in-memory Blob from `ClipboardItem.getType`.
    let mut items: Vec<(Mime, Vec<u8>)> = Vec::new();
    let mut mime_iter = mimes.array_iterator(global)?;
    let mut blob_iter = blobs.array_iterator(global)?;
    while let Some(mime_value) = mime_iter.next()? {
        let Some(blob_value) = blob_iter.next()? else {
            break;
        };
        let mime_string = OwnedString::new(BunString::from_js(mime_value, global)?);
        let mime = Mime::from_bytes(mime_string.to_utf8().slice())
            .expect("Clipboard.prototype.write only forwards supported MIME types");
        let size = crate::webcore::blob::Blob__getSize(blob_value);
        let ptr = crate::webcore::blob::Blob__getDataPtr(blob_value);
        debug_assert!(
            !ptr.is_null() || size == 0,
            "Clipboard.prototype.write only forwards in-memory Blobs"
        );
        let bytes = if ptr.is_null() || size == 0 {
            Vec::new()
        } else {
            // SAFETY: `ptr .. ptr+size` is the live in-memory view of a
            // JSC-owned Blob for the duration of this JS-thread call.
            unsafe { bun_core::ffi::slice(ptr.cast::<u8>(), size) }.to_vec()
        };
        items.push((mime, bytes));
    }
    schedule(global, Op::WriteItems(items))
}

/// Why the platform clipboard is unreachable; each variant carries the
/// actionable message its `NotAllowedError` rejects with. The display and
/// helper variants only exist on the helper-program platforms.
#[derive(Clone, Copy)]
enum Unavailable {
    /// The platform clipboard service failed.
    Platform,
    /// Neither `$WAYLAND_DISPLAY` nor `$DISPLAY` is set.
    #[cfg(not(any(target_os = "macos", windows)))]
    NoDisplay,
    /// A display exists, but no helper program is installed.
    #[cfg(not(any(target_os = "macos", windows)))]
    NoHelper,
    /// Every installed helper failed, hung, or crashed.
    #[cfg(not(any(target_os = "macos", windows)))]
    HelperFailed,
}

impl Unavailable {
    fn message(self) -> &'static [u8] {
        match self {
            Unavailable::Platform => b"The system clipboard is not available.",
            #[cfg(not(any(target_os = "macos", windows)))]
            Unavailable::NoDisplay => {
                b"The clipboard requires a Wayland or X11 display, but neither $WAYLAND_DISPLAY nor $DISPLAY is set."
            }
            #[cfg(not(any(target_os = "macos", windows)))]
            Unavailable::NoHelper => {
                b"No clipboard helper was found. Install `wl-clipboard` (Wayland), `xclip`, or `xsel` (X11)."
            }
            #[cfg(not(any(target_os = "macos", windows)))]
            Unavailable::HelperFailed => {
                b"The clipboard helper program failed to access the clipboard."
            }
        }
    }
}

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
            return Err(Unavailable::Platform);
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
            return Err(Unavailable::Platform);
        }
        buf.truncate(len);
        Ok(Some(buf))
    }

    pub(super) fn write_types(items: &[(Mime, &[u8])]) -> Result<(), Unavailable> {
        // Never `clearContents` with nothing to set; the JS-facing layer
        // already treats an empty item list as a no-op.
        if items.is_empty() {
            return Ok(());
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
        let ok = unsafe {
            bun_coregraphics_clipboard_write_types(
                utis.as_ptr(),
                datas.as_ptr(),
                lens.as_ptr(),
                items.len(),
            ) == CG_OK
        };
        if ok {
            Ok(())
        } else {
            Err(Unavailable::Platform)
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
    const GMEM_ZEROINIT: c_uint = 0x0040;

    fn register(name: &CStr) -> Option<c_uint> {
        // SAFETY: a static NUL-terminated name; registering twice is fine.
        match unsafe { RegisterClipboardFormatA(name.as_ptr()) } {
            0 => None,
            id => Some(id),
        }
    }

    /// The formats probed for a read, in preference order. Apps register raw
    /// PNG bytes under either name, so accept both (like the image reader).
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
            return Err(Unavailable::Platform);
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
            return Err(Unavailable::Platform);
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
        // fails, so an empty representation still allocates one byte; zeroed
        // so no uninitialized heap byte (empty or rounding slack) is ever
        // handed to the system-wide clipboard.
        // SAFETY: `SetClipboardData` requires a `GMEM_MOVEABLE` HGLOBAL.
        let h = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, payload.len().max(1)) };
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

    pub(super) fn write_types(items: &[(Mime, &[u8])]) -> Result<(), Unavailable> {
        if items.is_empty() {
            return Ok(());
        }
        // Fully prepare every replacement HGLOBAL before touching the
        // clipboard: `EmptyClipboard` destroys the previous contents, so
        // nothing fallible may sit between it and the `SetClipboardData`s.
        let mut prepared: Vec<(c_uint, *mut c_void)> = Vec::with_capacity(items.len());
        for (mime, bytes) in items {
            let Some(format) = write_format(*mime) else {
                free_all(&prepared);
                return Err(Unavailable::Platform);
            };
            let h = make_global(*mime, bytes);
            if h.is_null() {
                free_all(&prepared);
                return Err(Unavailable::Platform);
            }
            prepared.push((format, h));
        }
        if !open_clipboard_retrying() {
            free_all(&prepared);
            return Err(Unavailable::Platform);
        }
        scopeguard::defer! {
            // SAFETY: the clipboard is open on this thread.
            let _ = unsafe { CloseClipboard() };
        }
        // SAFETY: the clipboard is open.
        if unsafe { EmptyClipboard() } == 0 {
            free_all(&prepared);
            return Err(Unavailable::Platform);
        }
        for (index, (format, h)) in prepared.iter().enumerate() {
            // On success the system owns `h`; freeing it would be a double-free.
            // SAFETY: the clipboard is open and emptied, and `h` is unlocked.
            if unsafe { SetClipboardData(*format, *h) }.is_null() {
                // SAFETY: the clipboard rejected this handle and never saw the
                // rest, so they are all still ours.
                free_all(&prepared[index..]);
                return Err(Unavailable::Platform);
            }
        }
        Ok(())
    }

    fn free_all(handles: &[(c_uint, *mut c_void)]) {
        for (_, h) in handles {
            // SAFETY: every handle here was never accepted by the clipboard.
            unsafe { GlobalFree(*h) };
        }
    }
}

// ─── everything else (Linux, the BSDs, …) ───────────────────────────────────
// No stable in-process clipboard API exists, so the display server's helper
// programs run on the work-pool thread: `wl-paste`/`wl-copy` (Wayland),
// `xclip`, or `xsel` (text only), gated on `$WAYLAND_DISPLAY` / `$DISPLAY`.
#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use core::sync::atomic::{AtomicU32, Ordering};

    use bun_core::env_var;
    use bun_sys::{Fd, File, O};

    use crate::api::bun_process::Status as SpawnStatus;
    use crate::api::bun_process::sync as spawn_sync;

    use super::{Mime, Unavailable};

    fn has_display(value: Option<&[u8]>) -> bool {
        value.is_some_and(|value| !value.is_empty())
    }

    fn wayland() -> bool {
        has_display(env_var::WAYLAND_DISPLAY::get())
    }

    fn x11() -> bool {
        has_display(env_var::DISPLAY::get())
    }

    /// One helper invocation, classified. The `/bin/sh` watchdog wrapper
    /// reports a missing helper as exit 127/126 and a hung one as 124; no
    /// clipboard helper uses those for a real answer.
    enum HelperRun {
        NotInstalled,
        TimedOut,
        Succeeded(Vec<u8>),
        /// The helper ran and exited non-zero on its own ("nothing to paste").
        Failed {
            clean: bool,
        },
    }

    fn classify(result: spawn_sync::Result) -> HelperRun {
        const EXIT_TIMED_OUT: i64 = 124;
        const EXIT_CANNOT_RUN: i64 = 126;
        const EXIT_NOT_FOUND: i64 = 127;
        if result.status.is_ok() {
            return HelperRun::Succeeded(result.stdout);
        }
        // A signal-killed helper proves nothing about the clipboard.
        if result.status.signal_code().is_some() {
            return HelperRun::Failed { clean: false };
        }
        let SpawnStatus::Exited(exited) = result.status else {
            return HelperRun::Failed { clean: false };
        };
        match i64::from(exited.code) {
            EXIT_NOT_FOUND | EXIT_CANNOT_RUN => HelperRun::NotInstalled,
            EXIT_TIMED_OUT => HelperRun::TimedOut,
            _ => HelperRun::Failed { clean: true },
        }
    }

    /// Reads and writes walk the same candidate list until one exits 0, so
    /// both always reach the same clipboard.
    fn candidates(write: bool, mime: Mime) -> Vec<Vec<Box<[u8]>>> {
        let text = mime == Mime::TextPlain;
        let mime_arg = mime.as_str();
        let mut list: Vec<Vec<Box<[u8]>>> = Vec::new();
        let arg = |s: &str| -> Box<[u8]> { Box::from(s.as_bytes()) };
        if wayland() {
            // `--type text` matches any text flavour but never dumps binary,
            // and `--no-newline` stops wl-paste appending one never copied.
            list.push(if write {
                vec![
                    arg("wl-copy"),
                    arg("--type"),
                    arg(if text {
                        "text/plain;charset=utf-8"
                    } else {
                        mime_arg
                    }),
                ]
            } else {
                vec![
                    arg("wl-paste"),
                    arg("--no-newline"),
                    arg("--type"),
                    arg(if text { "text" } else { mime_arg }),
                ]
            });
        }
        if x11() {
            let mut xclip = vec![arg("xclip"), arg("-selection"), arg("clipboard")];
            if !text {
                xclip.push(arg("-t"));
                xclip.push(arg(mime_arg));
            }
            xclip.push(arg(if write { "-in" } else { "-out" }));
            list.push(xclip);
            if text {
                list.push(vec![
                    arg("xsel"),
                    arg("--clipboard"),
                    arg(if write { "--input" } else { "--output" }),
                ]);
            }
        }
        list
    }

    /// POSIX single-quoting: every byte is literal inside `'…'` except `'`,
    /// which becomes `'\''`.
    fn shell_quote_into(command: &mut Vec<u8>, word: &[u8]) {
        command.push(b'\'');
        for &byte in word {
            if byte == b'\'' {
                command.extend_from_slice(b"'\\''");
            } else {
                command.push(byte);
            }
        }
        command.push(b'\'');
    }

    /// Runs one helper through `/bin/sh` with a 10s watchdog (a hung X11
    /// selection owner would otherwise block forever): a killed helper
    /// surfaces as exit 124 and a missing one as 127, both for `classify`.
    /// `None` ⇔ `/bin/sh` itself could not be spawned.
    fn run_helper(
        argv: &[Box<[u8]>],
        redirect_from: Option<&[u8]>,
        capture_stdout: bool,
    ) -> Option<spawn_sync::Result> {
        let mut command = Vec::<u8>::with_capacity(192);
        for (i, part) in argv.iter().enumerate() {
            if i > 0 {
                command.push(b' ');
            }
            shell_quote_into(&mut command, part);
        }
        if let Some(path) = redirect_from {
            command.extend_from_slice(b" < ");
            shell_quote_into(&mut command, path);
        }
        command.extend_from_slice(
            b" & c=$!; { sleep 10; kill \"$c\"; } 2>/dev/null & w=$!; wait \"$c\"; s=$?; kill \"$w\" 2>/dev/null; [ \"$s\" -ge 128 ] && s=124; exit \"$s\"",
        );
        let stdio = |capture: bool| {
            if capture {
                spawn_sync::SyncStdio::Buffer
            } else {
                spawn_sync::SyncStdio::Ignore
            }
        };
        spawn_sync::spawn(&spawn_sync::Options {
            argv: vec![
                Box::from(b"/bin/sh".as_slice()),
                Box::from(b"-c".as_slice()),
                command.into_boxed_slice(),
            ],
            cwd: Box::from(b".".as_slice()),
            stdin: spawn_sync::SyncStdio::Ignore,
            stdout: stdio(capture_stdout),
            stderr: spawn_sync::SyncStdio::Ignore,
            envp: None,
            ..Default::default()
        })
        .ok()
        .and_then(|result| result.ok())
    }

    pub(super) fn read_type(mime: Mime) -> Result<Option<Vec<u8>>, Unavailable> {
        if !wayland() && !x11() {
            return Err(Unavailable::NoDisplay);
        }
        let list = candidates(false, mime);
        let mut ran = 0usize;
        let mut clean_failures = 0usize;
        for argv in list {
            let Some(result) = run_helper(&argv, None, true) else {
                continue; // `/bin/sh` unavailable
            };
            match classify(result) {
                HelperRun::Succeeded(stdout) => return Ok(Some(stdout)),
                HelperRun::NotInstalled => {}
                HelperRun::TimedOut | HelperRun::Failed { clean: false } => ran += 1,
                // The helpers use one exit code for "nothing is copied" and
                // for real failures, so a clean non-zero exit is "no data".
                HelperRun::Failed { clean: true } => {
                    ran += 1;
                    clean_failures += 1;
                }
            }
        }
        if ran == 0 {
            return Err(Unavailable::NoHelper);
        }
        if clean_failures == 0 {
            return Err(Unavailable::HelperFailed);
        }
        Ok(None)
    }

    pub(super) fn write_types(items: &[(Mime, &[u8])]) -> Result<(), Unavailable> {
        // The C++ layer rejects multi-representation items on the helper
        // platforms (the one-shot helpers can only own one).
        debug_assert!(items.len() <= 1);
        let Some((mime, bytes)) = items.first() else {
            return Ok(());
        };
        if !wayland() && !x11() {
            return Err(Unavailable::NoDisplay);
        }
        let list = candidates(true, *mime);
        // The sync spawner cannot feed stdin, so the payload is staged in a
        // private (0600, O_EXCL) temp file that `sh` redirects into the
        // helper and that is unlinked immediately after.
        let Some(temp_path) = write_temp_file(bytes) else {
            return Err(Unavailable::Platform);
        };
        let mut ran = 0usize;
        let mut wrote = false;
        for argv in list {
            let Some(result) = run_helper(&argv, Some(&temp_path), false) else {
                continue;
            };
            match classify(result) {
                HelperRun::Succeeded(_) => {
                    ran += 1;
                    wrote = true;
                    break;
                }
                HelperRun::NotInstalled => {}
                HelperRun::TimedOut | HelperRun::Failed { .. } => ran += 1,
            }
        }
        unlink_temp_file(&temp_path);
        if wrote {
            Ok(())
        } else if ran == 0 {
            Err(Unavailable::NoHelper)
        } else {
            Err(Unavailable::HelperFailed)
        }
    }

    /// Stages the payload in `$TMPDIR` under a per-call name; `O_EXCL`
    /// refuses pre-planted files/symlinks at the (predictable) path.
    fn write_temp_file(bytes: &[u8]) -> Option<Vec<u8>> {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let dir = env_var::TMPDIR::get()
            .filter(|dir| !dir.is_empty())
            .unwrap_or(b"/tmp");
        let mut path = dir.to_vec();
        if path.last() != Some(&b'/') {
            path.push(b'/');
        }
        path.extend_from_slice(
            format!(
                "bun-clipboard-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            )
            .as_bytes(),
        );
        let Ok(file) = File::openat(Fd::cwd(), &path, O::WRONLY | O::CREAT | O::EXCL, 0o600) else {
            return None;
        };
        if file.write_all(bytes).is_err() {
            drop(file);
            unlink_temp_file(&path);
            return None;
        }
        Some(path)
    }

    fn unlink_temp_file(path: &[u8]) {
        let mut zpath = path.to_vec();
        zpath.push(0);
        let _ = bun_sys::unlink(bun_core::ZStr::from_buf(&zpath, path.len()));
    }
}
