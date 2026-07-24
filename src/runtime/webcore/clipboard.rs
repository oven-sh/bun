//! Native `navigator.clipboard` backend: the platform clipboard I/O, and
//! nothing else.
//!
//! WebCore owns every promise and every JS value (see
//! `src/jsc/bindings/webcore/Clipboard.cpp`). This side is handed a scheduling
//! call carrying plain bytes and an opaque `WebCore::ClipboardRequest*`, does
//! the work on the work pool, and hands that handle back on the JS thread
//! exactly once — which is also what releases it.

use core::ffi::c_void;
use core::ptr;

use bun_jsc::{AnyTaskJob, AnyTaskJobCtx, JSGlobalObject};

/// An opaque `WebCore::ClipboardRequest*`. Only C++ ever dereferences it; the
/// job just carries it across the thread hop.
#[derive(Clone, Copy)]
struct RequestHandle(*mut c_void);

// SAFETY: the pointer is never dereferenced off the JS thread — `run` does not
// touch it, and `then` only passes it back to C++, which runs on the JS thread.
unsafe impl Send for RequestHandle {}

/// Mirrors `WebCore::ClipboardRepresentation`. All pointers borrow for the
/// duration of the call.
#[repr(C)]
pub struct Representation {
    ty: *const u8,
    ty_len: usize,
    bytes: *const u8,
    len: usize,
}

unsafe extern "C" {
    /// Settles the request on the JS thread. A null `failure_message` means the
    /// operation succeeded.
    fn Bun__Clipboard__requestComplete(
        global: &JSGlobalObject,
        request: *mut c_void,
        representations: *const Representation,
        count: usize,
        failure_message: *const u8,
        failure_length: usize,
    );
}

/// Serializes our own work-pool jobs so concurrent clipboard calls cannot
/// race `OpenClipboard` (Windows) or interleave `NSPasteboard` operations.
/// Other processes can still mutate the clipboard at any time.
static CLIPBOARD_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

/// What this build's backend can put on / take off the OS clipboard. The C++
/// layer (`ClipboardItem.supports`, `write()` validation) asks through
/// `Bun__Clipboard__supportsType`, so this is the single source of truth.
const SUPPORTED: &[Mime] = &[Mime::TextPlain, Mime::TextHtml, Mime::ImagePng];

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
    /// Read `text/plain` only.
    ReadText,
    /// Read every supported representation.
    Read,
    Write(Vec<(Mime, Vec<u8>)>),
}

/// Filled by `run` on the work pool; `then` only hands it back to WebCore.
enum Outcome {
    /// What the platform produced. Empty means the clipboard held nothing this
    /// backend recognizes, which is not an error.
    Representations(Vec<(Mime, Vec<u8>)>),
    Failed(Unavailable),
}

pub(crate) struct ClipboardCtx {
    op: Op,
    outcome: Option<Outcome>,
    request: RequestHandle,
}

impl AnyTaskJobCtx for ClipboardCtx {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        let _guard = CLIPBOARD_LOCK.lock_guard();
        self.outcome = Some(match &self.op {
            Op::ReadText => match platform::read_type(Mime::TextPlain) {
                Ok(Some(bytes)) => Outcome::Representations(vec![(Mime::TextPlain, bytes)]),
                Ok(None) => Outcome::Representations(Vec::new()),
                Err(unavailable) => Outcome::Failed(unavailable),
            },
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
                            present.push((*mime, bytes));
                        }
                        Ok(None) => readable = true,
                        Err(reason) => unavailable = reason,
                    }
                }
                if readable {
                    Outcome::Representations(present)
                } else {
                    Outcome::Failed(unavailable)
                }
            }
            Op::Write(items) => {
                let borrowed: Vec<(Mime, &[u8])> =
                    items.iter().map(|(m, b)| (*m, b.as_slice())).collect();
                match platform::write_types(&borrowed) {
                    Ok(()) => Outcome::Representations(Vec::new()),
                    Err(unavailable) => Outcome::Failed(unavailable),
                }
            }
        });
    }

    fn then(&mut self, global: &JSGlobalObject) -> bun_jsc::JsResult<()> {
        match self.outcome.take().expect("run() filled the outcome") {
            Outcome::Representations(items) => {
                // Borrowed views over `items`, which outlives the call.
                let views: Vec<Representation> = items
                    .iter()
                    .map(|(mime, bytes)| Representation {
                        ty: mime.as_str().as_ptr(),
                        ty_len: mime.as_str().len(),
                        bytes: bytes.as_ptr(),
                        len: bytes.len(),
                    })
                    .collect();
                // SAFETY: JS thread, live global, and the views borrow `items`
                // for the duration of the call.
                unsafe {
                    Bun__Clipboard__requestComplete(
                        global,
                        self.request.0,
                        views.as_ptr(),
                        views.len(),
                        ptr::null(),
                        0,
                    )
                };
            }
            Outcome::Failed(unavailable) => complete_with_failure(global, self.request.0, unavailable),
        }
        Ok(())
    }
}

/// Rejects the request with the actionable reason the platform gave.
fn complete_with_failure(global: &JSGlobalObject, request: *mut c_void, unavailable: Unavailable) {
    let message = unavailable.message();
    // SAFETY: JS thread, live global, and `message` is a 'static literal.
    unsafe {
        Bun__Clipboard__requestComplete(
            global,
            request,
            ptr::null(),
            0,
            message.as_ptr(),
            message.len(),
        )
    };
}

/// Schedules the op on the work pool. If scheduling fails there is nothing left
/// to settle the request, so it is rejected here rather than left pending.
fn schedule(global: &JSGlobalObject, op: Op, request: *mut c_void) {
    let ctx = ClipboardCtx {
        op,
        outcome: None,
        request: RequestHandle(request),
    };
    if AnyTaskJob::create_and_schedule(global, ctx).is_err() {
        complete_with_failure(global, request, Unavailable::Platform);
    }
}

/// Copies a borrowed byte range; the backing memory belongs to the caller and
/// is not valid past the call that handed it over.
///
/// # Safety
/// `[ptr, ptr+len)` must be a readable range, or `ptr` null with `len` 0.
unsafe fn copy_bytes(ptr: *const u8, len: usize) -> Vec<u8> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    // SAFETY: forwarded from the caller's contract.
    unsafe { bun_core::ffi::slice(ptr, len) }.to_vec()
}

// ─── entry points for WebCore ───────────────────────────────────────────────

/// `ClipboardItem.supports()` and `write()`'s validation: whether this build's
/// platform backend can represent `mime` on the OS clipboard.
///
/// # Safety
/// `[mime, mime+len)` must be a readable range of the lowercased MIME type.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Clipboard__supportsType(mime: *const u8, len: usize) -> bool {
    if mime.is_null() || len == 0 {
        return false;
    }
    // SAFETY: forwarded from the caller's contract.
    let bytes = unsafe { bun_core::ffi::slice(mime, len) };
    Mime::from_bytes(bytes).is_some_and(|mime| SUPPORTED.contains(&mime))
}

/// Whether the platform backend can only own one representation per write.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__writesSingleRepresentation() -> bool {
    WRITES_SINGLE_REPRESENTATION
}

/// `Clipboard.prototype.readText`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__scheduleReadText(global: &JSGlobalObject, request: *mut c_void) {
    schedule(global, Op::ReadText, request);
}

/// `Clipboard.prototype.read`: one job reads every supported representation.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__scheduleRead(global: &JSGlobalObject, request: *mut c_void) {
    schedule(global, Op::Read, request);
}

/// `Clipboard.prototype.writeText`; WebCore already applied the WebIDL
/// `DOMString` conversion, so these are the exact bytes to place.
///
/// # Safety
/// `[text, text+len)` must be a readable range, or `text` null with `len` 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Clipboard__scheduleWriteText(
    global: &JSGlobalObject,
    request: *mut c_void,
    text: *const u8,
    len: usize,
) {
    // SAFETY: forwarded from the caller's contract.
    let bytes = unsafe { copy_bytes(text, len) };
    schedule(global, Op::Write(vec![(Mime::TextPlain, bytes)]), request);
}

/// `Clipboard.prototype.write`, after WebCore collected every representation
/// into a Blob and checked that this backend supports each type.
///
/// # Safety
/// `representations[0..count]` must be readable, and each entry's byte ranges
/// valid for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Clipboard__scheduleWrite(
    global: &JSGlobalObject,
    request: *mut c_void,
    representations: *const Representation,
    count: usize,
) {
    let mut items: Vec<(Mime, Vec<u8>)> = Vec::with_capacity(count);
    if !representations.is_null() {
        // SAFETY: forwarded from the caller's contract.
        let entries = unsafe { core::slice::from_raw_parts(representations, count) };
        for entry in entries {
            // SAFETY: same.
            let ty = unsafe { copy_bytes(entry.ty, entry.ty_len) };
            let Some(mime) = Mime::from_bytes(&ty) else {
                // WebCore validates support before collecting, so this cannot
                // normally happen; reject rather than write a partial item.
                complete_with_failure(global, request, Unavailable::Platform);
                return;
            };
            // SAFETY: same.
            items.push((mime, unsafe { copy_bytes(entry.bytes, entry.len) }));
        }
    }
    schedule(global, Op::Write(items), request);
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
// clipboard entry points live beside its image reader. Reading is two calls: one
// reports the size and hands back a retained NSData, the second copies it out and
// releases it.
#[cfg(target_os = "macos")]
mod platform {
    use core::ffi::{CStr, c_char, c_void};

    use super::{Mime, Unavailable};

    const CG_OK: i32 = 0;

    unsafe extern "C" {
        fn bun_coregraphics_clipboard_read_type(
            uti: *const c_char,
            out_data: *mut *mut c_void,
            out_len: *mut usize,
        ) -> i32;
        fn bun_coregraphics_clipboard_take_data(data: *mut c_void, out: *mut u8) -> i32;
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
        let mut data: *mut c_void = core::ptr::null_mut();
        let mut len: usize = 0;
        // SAFETY: both are valid out-params and `uti` is a NUL-terminated static.
        if unsafe { bun_coregraphics_clipboard_read_type(uti, &raw mut data, &raw mut len) }
            != CG_OK
        {
            return Err(Unavailable::Platform);
        }
        if data.is_null() {
            debug_assert_eq!(
                len, 0,
                "a null handle always reports an empty representation"
            );
            return Ok(None);
        }
        let mut buf = vec![0u8; len];
        // SAFETY: `data` is the retained, exactly-`len`-byte NSData the call above handed
        // over; this consumes the handle, copying into a buffer of that exact length.
        if unsafe { bun_coregraphics_clipboard_take_data(data, buf.as_mut_ptr()) } != CG_OK {
            return Err(Unavailable::Platform);
        }
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
// Raw Win32 like `image/backend_wic.rs`. Text uses `CF_UNICODETEXT`, HTML the
// registered "HTML Format" (CF_HTML) with its offset envelope, and PNG the
// registered "PNG" / "image/png" formats browsers and most apps interchange.
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
            Mime::TextHtml => [register(c"HTML Format"), None],
        }
    }

    /// The single format a representation is written as.
    fn write_format(mime: Mime) -> Option<c_uint> {
        match mime {
            Mime::TextPlain => Some(CF_UNICODETEXT),
            Mime::ImagePng => register(c"PNG"),
            Mime::TextHtml => register(c"HTML Format"),
        }
    }

    /// Wraps a UTF-8 HTML fragment in the `CF_HTML` envelope: a fixed-width
    /// header whose numbers are byte offsets into the whole payload.
    /// https://learn.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format
    fn build_cf_html(fragment: &[u8]) -> Vec<u8> {
        const PREFIX: &str = "<html>\r\n<body>\r\n<!--StartFragment-->";
        const SUFFIX: &str = "<!--EndFragment-->\r\n</body>\r\n</html>";
        const HEADER_LEN: usize = "Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n".len();
        let start_html = HEADER_LEN;
        let start_fragment = start_html + PREFIX.len();
        let end_fragment = start_fragment + fragment.len();
        let end_html = end_fragment + SUFFIX.len();
        let mut out = format!(
            "Version:0.9\r\nStartHTML:{start_html:010}\r\nEndHTML:{end_html:010}\r\nStartFragment:{start_fragment:010}\r\nEndFragment:{end_fragment:010}\r\n{PREFIX}"
        )
        .into_bytes();
        out.extend_from_slice(fragment);
        out.extend_from_slice(SUFFIX.as_bytes());
        out
    }

    /// The `NAME:<digits>` header field of a `CF_HTML` payload, as a byte
    /// offset into that payload.
    fn cf_html_offset(payload: &[u8], key: &[u8]) -> Option<usize> {
        let at = bun_core::strings::index_of(payload, key)?;
        let digits = &payload[at + key.len()..];
        let end = digits.iter().position(|byte| !byte.is_ascii_digit())?;
        core::str::from_utf8(&digits[..end]).ok()?.parse().ok()
    }

    /// Extracts the fragment of a `CF_HTML` payload; other producers wrote
    /// it, so the offsets are validated rather than trusted, falling back to
    /// the fragment comment markers some producers get right instead.
    fn cf_html_fragment(payload: &[u8]) -> Option<Vec<u8>> {
        if let (Some(start), Some(end)) = (
            cf_html_offset(payload, b"StartFragment:"),
            cf_html_offset(payload, b"EndFragment:"),
        ) && start <= end
            && end <= payload.len()
        {
            return Some(payload[start..end].to_vec());
        }
        const START_MARK: &[u8] = b"<!--StartFragment-->";
        const END_MARK: &[u8] = b"<!--EndFragment-->";
        let start = bun_core::strings::index_of(payload, START_MARK)? + START_MARK.len();
        let end = start + bun_core::strings::index_of(&payload[start..], END_MARK)?;
        Some(payload[start..end].to_vec())
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
            if h.is_null() {
                continue;
            }
            let Some(bytes) = copy_global(h, mime == Mime::TextPlain)? else {
                return Ok(None);
            };
            if mime != Mime::TextHtml {
                return Ok(Some(bytes));
            }
            // "HTML Format" payloads are NUL-padded UTF-8 with an offset
            // header; an envelope we cannot parse is not a usable
            // representation, so it reads as absent.
            let end = bytes
                .iter()
                .position(|&byte| byte == 0)
                .unwrap_or(bytes.len());
            return Ok(cf_html_fragment(&bytes[..end]));
        }
        Ok(None)
    }

    /// Build a `GMEM_MOVEABLE` HGLOBAL holding `bytes` (as NUL-terminated
    /// UTF-16 for text, in the `CF_HTML` envelope for HTML). Returns null on
    /// allocation failure.
    fn make_global(mime: Mime, bytes: &[u8]) -> *mut c_void {
        let wide;
        let enveloped;
        let payload: &[u8] = match mime {
            Mime::TextPlain => {
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
            }
            Mime::TextHtml => {
                enveloped = build_cf_html(bytes);
                &enveloped
            }
            Mime::ImagePng => bytes,
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
        // The watchdog group is fully redirected (so neither it nor its
        // `sleep` holds the helper's captured stdout open); its TERM trap is
        // installed before `sleep` starts and exits, so nothing outlives it.
        command.extend_from_slice(
            b" & c=$!; { trap 'kill \"$sp\" 2>/dev/null; exit 0' TERM; sleep 10 & sp=$!; wait \"$sp\"; kill \"$c\" 2>/dev/null; } >/dev/null 2>&1 & w=$!; wait \"$c\"; s=$?; kill \"$w\" 2>/dev/null; [ \"$s\" -ge 128 ] && s=124; exit \"$s\"",
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
                // Some helper/target pairs exit 0 with empty stdout for an
                // absent type; only `text/plain` is ever deliberately empty.
                HelperRun::Succeeded(stdout) if stdout.is_empty() && mime != Mime::TextPlain => {
                    return Ok(None);
                }
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
