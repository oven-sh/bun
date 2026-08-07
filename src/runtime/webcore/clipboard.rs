//! Native `navigator.clipboard` platform I/O (https://w3c.github.io/clipboard-apis/).
//! WebCore (`src/jsc/bindings/webcore/Clipboard.cpp`) owns every promise/JS value; this
//! side runs bytes + an opaque `ClipboardRequest*` on a dedicated serial thread and hands
//! it back once.

use core::ffi::c_void;
use core::ptr;

use bun_jsc::{AnyTaskJob, AnyTaskJobCtx, JSGlobalObject};
use bun_threading::WorkPoolTask;

/// Opaque `WebCore::ClipboardRequest*` (a leaked +1), handed back exactly
/// once: `complete`/`fail` on the JS thread, or `Drop` (abandon) on VM
/// shutdown. The sole owner of the request FFI, so everything above it is
/// safe code.
struct RequestHandle(*mut c_void);

// SAFETY: off the JS thread the pointer is only read through the atomic
// `is_cancelled`; completion happens back on the JS thread.
unsafe impl Send for RequestHandle {}

impl RequestHandle {
    fn is_cancelled(&self) -> bool {
        // SAFETY: the leaked ref keeps the request alive; the flag is atomic.
        unsafe { Bun__Clipboard__requestIsCancelled(self.0) }
    }

    /// Settles with `items` on the JS thread.
    fn complete(self, global: &JSGlobalObject, items: &[(Mime, Vec<u8>)]) {
        let views: Vec<Representation> = items
            .iter()
            .map(|(mime, bytes)| Representation {
                ty: mime.as_str().as_ptr(),
                ty_len: mime.as_str().len(),
                bytes: bytes.as_ptr(),
                len: bytes.len(),
            })
            .collect();
        // SAFETY: JS thread with a live global; the views borrow `items` for
        // the duration of the call; consumes the leaked ref exactly once.
        unsafe {
            Bun__Clipboard__requestComplete(
                global,
                self.take(),
                views.as_ptr(),
                views.len(),
                ptr::null(),
                0,
            )
        };
    }

    /// Rejects with the platform's reason on the JS thread.
    fn fail(self, global: &JSGlobalObject, unavailable: Unavailable) {
        let message = unavailable.message();
        // SAFETY: JS thread with a live global; `message` is 'static;
        // consumes the leaked ref exactly once.
        unsafe {
            Bun__Clipboard__requestComplete(
                global,
                self.take(),
                ptr::null(),
                0,
                message.as_ptr(),
                message.len(),
            )
        };
    }

    /// Hands the raw pointer out without running `Drop`'s abandon.
    fn take(self) -> *mut c_void {
        core::mem::ManuallyDrop::new(self).0
    }
}

impl Drop for RequestHandle {
    fn drop(&mut self) {
        // Dropped without settling (VM shutdown): balance the leaked ref.
        // SAFETY: still the live leaked reference; `complete`/`fail` bypass
        // Drop via `take`.
        unsafe { Bun__Clipboard__requestAbandon(self.0) };
    }
}

/// Mirrors `WebCore::ClipboardRepresentation`; pointers borrow for the call.
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
    /// Releases a request the job never got to complete (VM shutting down).
    fn Bun__Clipboard__requestAbandon(request: *mut c_void);
    /// Whether the JS thread cancelled this request (atomic; safe off-thread).
    fn Bun__Clipboard__requestIsCancelled(request: *mut c_void) -> bool;
}

/// An `AnyTaskJob`'s intrusive task crossing to the clipboard thread.
#[derive(Clone, Copy)]
struct QueuedTask(*mut WorkPoolTask);
// SAFETY: same hand-off `WorkPool::schedule` performs; the callback is the
// only consumer.
unsafe impl Send for QueuedTask {}

/// One FIFO thread runs every platform job, so ops commit in schedule order
/// and a blocking backend never occupies the shared work pool. `None` while
/// the thread cannot be spawned (retried on the next call).
fn serial_queue() -> Option<&'static bun_threading::Channel<QueuedTask>> {
    use core::sync::atomic::{AtomicBool, Ordering};
    static QUEUE: std::sync::OnceLock<bun_threading::Channel<QueuedTask>> =
        std::sync::OnceLock::new();
    static SPAWNED: AtomicBool = AtomicBool::new(false);
    static SPAWN_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();
    let queue = QUEUE.get_or_init(bun_threading::Channel::init_dynamic);
    if !SPAWNED.load(Ordering::Acquire) {
        let _guard = SPAWN_LOCK.lock_guard();
        if !SPAWNED.load(Ordering::Relaxed) {
            std::thread::Builder::new()
                .name("Bun Clipboard".into())
                .spawn(move || {
                    while let Ok(QueuedTask(task)) = queue.read_item() {
                        // SAFETY: consumes the task exactly once, like a pool worker.
                        unsafe { ((*task).callback)(task) };
                    }
                })
                .ok()?;
            SPAWNED.store(true, Ordering::Release);
        }
    }
    Some(queue)
}

/// Single source of truth for `ClipboardItem.supports` / `write()` validation.
const SUPPORTED: &[Mime] = &[Mime::TextPlain, Mime::TextHtml, Mime::ImagePng];

/// The POSIX one-shot helpers own a single representation per invocation.
const WRITES_SINGLE_REPRESENTATION: bool = cfg!(not(any(target_os = "macos", windows)));

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
        // Keys arrive as serialized MIME types; the essence picks the format.
        let essence = bun_core::strings::split_once_char(bytes, b';')
            .map_or(bytes, |(essence, _params)| essence);
        match essence {
            b"text/plain" => Some(Mime::TextPlain),
            b"text/html" => Some(Mime::TextHtml),
            b"image/png" => Some(Mime::ImagePng),
            _ => None,
        }
    }
}

/// What `run` executes off the JS thread; owned bytes only, no JS values.
enum Op {
    ReadText,
    Read,
    Write(Vec<(Mime, Vec<u8>)>),
}

enum Outcome {
    /// Empty means the clipboard held nothing this backend recognizes.
    Representations(Vec<(Mime, Vec<u8>)>),
    Failed(Unavailable),
}

pub(crate) struct ClipboardCtx {
    op: Op,
    outcome: Option<Outcome>,
    /// `then()` takes it; a job dropped earlier abandons via `RequestHandle::drop`.
    request: Option<RequestHandle>,
}

impl AnyTaskJobCtx for ClipboardCtx {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        self.outcome = Some(match &self.op {
            Op::ReadText => match platform::read_type(Mime::TextPlain) {
                Ok(Some(bytes)) => Outcome::Representations(vec![(Mime::TextPlain, bytes)]),
                Ok(None) => Outcome::Representations(Vec::new()),
                Err(unavailable) => Outcome::Failed(unavailable),
            },
            Op::Read => match platform::read_all(SUPPORTED) {
                Ok(present) => Outcome::Representations(present),
                Err(unavailable) => Outcome::Failed(unavailable),
            },
            Op::Write(items) => {
                // A superseded write is cancelled on the JS thread; honoring it
                // here keeps its AbortError honest (the write never reaches
                // the OS). `then()` still runs; the settled promise ignores it.
                if self
                    .request
                    .as_ref()
                    .is_some_and(RequestHandle::is_cancelled)
                {
                    Outcome::Representations(Vec::new())
                } else {
                    let borrowed: Vec<(Mime, &[u8])> =
                        items.iter().map(|(m, b)| (*m, b.as_slice())).collect();
                    match platform::write_types(&borrowed) {
                        Ok(()) => Outcome::Representations(Vec::new()),
                        Err(unavailable) => Outcome::Failed(unavailable),
                    }
                }
            }
        });
    }

    fn then(&mut self, global: &JSGlobalObject) -> bun_jsc::JsResult<()> {
        let request = self.request.take().expect("then() runs once");
        match self.outcome.take().expect("run() filled the outcome") {
            Outcome::Representations(items) => request.complete(global, &items),
            Outcome::Failed(unavailable) => request.fail(global, unavailable),
        }
        Ok(())
    }
}

/// `create` consumes `ctx` on every path, so a failure has already balanced
/// the request via `RequestHandle`'s Drop.
fn schedule(global: &JSGlobalObject, op: Op, request: RequestHandle) {
    // No clipboard thread: reject rather than abort, or run unserialized on
    // the shared pool.
    let Some(queue) = serial_queue() else {
        request.fail(global, Unavailable::Platform);
        return;
    };
    let ctx = ClipboardCtx {
        op,
        outcome: None,
        request: Some(request),
    };
    let _ = AnyTaskJob::create_and_schedule_with(global, ctx, |task| {
        // Fails only on OOM; the queue is never closed.
        bun_core::handle_oom(queue.write_item(QueuedTask(task)));
    });
}

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

/// `ClipboardItem.supports()` / `write()` validation.
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
    schedule(global, Op::ReadText, RequestHandle(request));
}

/// `Clipboard.prototype.read`: one job reads every supported representation.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__scheduleRead(global: &JSGlobalObject, request: *mut c_void) {
    schedule(global, Op::Read, RequestHandle(request));
}

/// `Clipboard.prototype.writeText` (bytes already WebIDL `DOMString`-converted).
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
    schedule(
        global,
        Op::Write(vec![(Mime::TextPlain, bytes)]),
        RequestHandle(request),
    );
}

/// `Clipboard.prototype.write` (WebCore already collected Blobs + checked support).
/// # Safety
/// `representations[0..count]` and each entry's byte ranges must be readable for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Clipboard__scheduleWrite(
    global: &JSGlobalObject,
    request: *mut c_void,
    representations: *const Representation,
    count: usize,
) {
    let request = RequestHandle(request);
    let mut items: Vec<(Mime, Vec<u8>)> = Vec::with_capacity(count);
    if !representations.is_null() {
        // SAFETY: forwarded from the caller's contract.
        let entries = unsafe { core::slice::from_raw_parts(representations, count) };
        for entry in entries {
            // SAFETY: same.
            let (ty, bytes) = unsafe {
                (
                    copy_bytes(entry.ty, entry.ty_len),
                    copy_bytes(entry.bytes, entry.len),
                )
            };
            let Some(mime) = Mime::from_bytes(&ty) else {
                // Unreachable when WebCore validated support; reject rather
                // than write a partial item.
                request.fail(global, Unavailable::Platform);
                return;
            };
            items.push((mime, bytes));
        }
    }
    schedule(global, Op::Write(items), request);
}

/// Why the platform clipboard is unreachable; carries the message the
/// `NotAllowedError` rejects with.
#[derive(Clone, Copy)]
enum Unavailable {
    Platform,
    #[cfg(target_os = "macos")]
    Changing,
    #[cfg(not(any(target_os = "macos", windows)))]
    NoDisplay,
    #[cfg(not(any(target_os = "macos", windows)))]
    MultipleRepresentations,
    #[cfg(not(any(target_os = "macos", windows)))]
    NoHelper,
    #[cfg(not(any(target_os = "macos", windows)))]
    HelperFailed,
}

impl Unavailable {
    fn message(self) -> &'static [u8] {
        match self {
            Unavailable::Platform => b"The system clipboard is not available.",
            #[cfg(target_os = "macos")]
            Unavailable::Changing => b"The system clipboard changed while it was being read.",
            #[cfg(not(any(target_os = "macos", windows)))]
            Unavailable::MultipleRepresentations => {
                b"Writing more than one representation per item is not supported on this platform."
            }
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

// ─── macOS: NSPasteboard via `image_coregraphics_shim.cpp` ──────────────────
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

    use crate::image::backend_coregraphics::clipboard_change_count;

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
            debug_assert_eq!(len, 0);
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

    /// NSPasteboard has no lock, so re-read once if another process bumped
    /// `changeCount` mid-loop; still changing on the retry fails the read.
    pub(super) fn read_all(types: &[Mime]) -> Result<Vec<(Mime, Vec<u8>)>, Unavailable> {
        let mut attempt = 0;
        loop {
            let generation = clipboard_change_count();
            let mut present = Vec::new();
            let mut readable = false;
            let mut unavailable = Unavailable::Platform;
            for mime in types {
                match read_type(*mime) {
                    Ok(Some(bytes)) => {
                        readable = true;
                        present.push((*mime, bytes));
                    }
                    Ok(None) => readable = true,
                    Err(reason) => unavailable = reason,
                }
            }
            if !readable {
                return Err(unavailable);
            }
            if clipboard_change_count() == generation {
                return Ok(present);
            }
            attempt += 1;
            if attempt == 4 {
                return Err(Unavailable::Changing);
            }
        }
    }

    pub(super) fn write_types(items: &[(Mime, &[u8])]) -> Result<(), Unavailable> {
        // Never `clearContents` with nothing to set.
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
// `CF_UNICODETEXT` for text, "HTML Format" (CF_HTML) for HTML, and the
// registered "PNG" / "image/png" formats for PNG. Raw externs live in
// `bun_sys::windows::clipboard`; the guards below are the only unsafe users.
#[cfg(windows)]
mod platform {
    use core::ffi::{CStr, c_uint, c_void};
    use core::ptr;

    use bun_sys::windows::clipboard::{self as win32, CF_UNICODETEXT};

    use super::{Mime, Unavailable};

    fn register(name: &CStr) -> Option<c_uint> {
        match win32::register_format(name) {
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

    /// Exclusive clipboard access; a single `OpenClipboard` fails spuriously
    /// while any other process holds it, so retry briefly.
    struct ClipboardGuard;

    impl ClipboardGuard {
        fn open() -> Option<ClipboardGuard> {
            for attempt in 0..5u32 {
                if win32::OpenClipboard(ptr::null_mut()) != 0 {
                    return Some(ClipboardGuard);
                }
                win32::Sleep(5 * (attempt + 1));
            }
            None
        }

        /// Null ⇔ format absent.
        fn get(&self, format: c_uint) -> *mut c_void {
            win32::GetClipboardData(format)
        }

        fn empty(&self) -> bool {
            win32::EmptyClipboard() != 0
        }

        /// On success the system owns `h`.
        fn set(&self, format: c_uint, h: *mut c_void) -> bool {
            // SAFETY: the clipboard is open and `h` is an unlocked HGLOBAL.
            unsafe { !win32::SetClipboardData(format, h).is_null() }
        }
    }

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            let _ = win32::CloseClipboard();
        }
    }

    /// Locked view of an HGLOBAL the open clipboard owns.
    struct LockedGlobal<'clipboard> {
        h: *mut c_void,
        p: *mut c_void,
        _clipboard: &'clipboard ClipboardGuard,
    }

    impl<'clipboard> LockedGlobal<'clipboard> {
        fn new(clipboard: &'clipboard ClipboardGuard, h: *mut c_void) -> Option<Self> {
            // SAFETY: `h` is owned by the clipboard, which stays open for 'clipboard.
            let p = unsafe { win32::GlobalLock(h) };
            if p.is_null() {
                return None;
            }
            Some(LockedGlobal {
                h,
                p,
                _clipboard: clipboard,
            })
        }

        /// `GlobalSize` can over-report by allocation slack; Win32 has no
        /// exact-length channel.
        fn bytes(&self) -> &[u8] {
            // SAFETY: the allocation stays locked while `self` lives.
            unsafe { core::slice::from_raw_parts(self.p.cast::<u8>(), win32::GlobalSize(self.h)) }
        }
    }

    impl Drop for LockedGlobal<'_> {
        fn drop(&mut self) {
            // SAFETY: balances the successful `GlobalLock`.
            let _ = unsafe { win32::GlobalUnlock(self.h) };
        }
    }

    /// Other processes wrote the payload: trim text at the first NUL without
    /// trusting one to exist.
    fn copy_global(locked: &LockedGlobal, text: bool) -> Vec<u8> {
        let bytes = locked.bytes();
        if text {
            let wide: Vec<u16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| u16::from_le_bytes(*pair))
                .take_while(|&unit| unit != 0)
                .collect();
            return String::from_utf16_lossy(&wide).into_bytes();
        }
        bytes.to_vec()
    }

    fn read_type_locked(
        clipboard: &ClipboardGuard,
        mime: Mime,
    ) -> Result<Option<Vec<u8>>, Unavailable> {
        for format in read_formats(mime).into_iter().flatten() {
            let h = clipboard.get(format);
            if h.is_null() {
                continue;
            }
            // A handle another app left unlockable (e.g. discarded) reads as
            // absent rather than failing the whole operation.
            let Some(locked) = LockedGlobal::new(clipboard, h) else {
                continue;
            };
            let bytes = copy_global(&locked, mime == Mime::TextPlain);
            drop(locked);
            if mime != Mime::TextHtml {
                return Ok(Some(bytes));
            }
            // CF_HTML is NUL-padded UTF-8; an unparsable envelope reads as absent.
            let end = bun_core::strings::index_of_char_usize(&bytes, 0).unwrap_or(bytes.len());
            return Ok(cf_html_fragment(&bytes[..end]));
        }
        Ok(None)
    }

    pub(super) fn read_type(mime: Mime) -> Result<Option<Vec<u8>>, Unavailable> {
        if read_formats(mime).iter().all(Option::is_none) {
            return Ok(None);
        }
        let clipboard = ClipboardGuard::open().ok_or(Unavailable::Platform)?;
        read_type_locked(&clipboard, mime)
    }

    /// One open/close spans every type, so another process cannot write
    /// between them and tear the item across two clipboard states.
    pub(super) fn read_all(types: &[Mime]) -> Result<Vec<(Mime, Vec<u8>)>, Unavailable> {
        let clipboard = ClipboardGuard::open().ok_or(Unavailable::Platform)?;
        let mut present = Vec::new();
        for mime in types {
            if let Some(bytes) = read_type_locked(&clipboard, *mime)? {
                present.push((*mime, bytes));
            }
        }
        Ok(present)
    }

    /// Bare `\n` becomes `\r\n`, per the spec's writeText note for Windows:
    /// https://w3c.github.io/clipboard-apis/#dom-clipboard-writetext
    fn normalize_to_crlf(bytes: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(bytes.len() + 16);
        let mut prev = 0u8;
        for &byte in bytes {
            if byte == b'\n' && prev != b'\r' {
                out.push(b'\r');
            }
            out.push(byte);
            prev = byte;
        }
        out
    }

    /// An HGLOBAL this process still owns; freed on Drop unless the clipboard
    /// accepted it (`release`).
    struct OwnedGlobal(*mut c_void);

    impl OwnedGlobal {
        fn from_bytes(payload: &[u8]) -> Option<OwnedGlobal> {
            let h = win32::global_from_bytes(payload);
            if h.is_null() {
                None
            } else {
                Some(OwnedGlobal(h))
            }
        }

        /// The system took ownership; do not free.
        fn release(self) {
            core::mem::forget(self);
        }
    }

    impl Drop for OwnedGlobal {
        fn drop(&mut self) {
            // SAFETY: the handle came from `global_from_bytes` and the
            // clipboard never accepted it, so it is still ours to free.
            unsafe { win32::GlobalFree(self.0) };
        }
    }

    /// `GMEM_MOVEABLE` HGLOBAL holding `bytes` (NUL-terminated UTF-16 for
    /// text, the `CF_HTML` envelope for HTML); `None` on allocation failure.
    fn make_global(mime: Mime, bytes: &[u8]) -> Option<OwnedGlobal> {
        let wide;
        let enveloped;
        let converted;
        let payload: &[u8] = match mime {
            Mime::TextPlain => {
                let text: &[u8] = if bun_core::strings::contains_char(bytes, b'\n') {
                    converted = normalize_to_crlf(bytes);
                    &converted
                } else {
                    bytes
                };
                // Replaces ill-formed sequences; the sentinel appends the NUL
                // `CF_UNICODETEXT` requires.
                let w = bun_core::strings::to_utf16_alloc_for_real(text, false, true).ok()?;
                wide = w;
                bytemuck::cast_slice::<u16, u8>(&wide)
            }
            Mime::TextHtml => {
                enveloped = build_cf_html(bytes);
                &enveloped
            }
            Mime::ImagePng => bytes,
        };
        OwnedGlobal::from_bytes(payload)
    }

    pub(super) fn write_types(items: &[(Mime, &[u8])]) -> Result<(), Unavailable> {
        if items.is_empty() {
            return Ok(());
        }
        // Prepare every HGLOBAL first: `EmptyClipboard` destroys the previous
        // contents, so nothing fallible may follow it. Any early return frees
        // the unaccepted handles via OwnedGlobal's Drop.
        let mut prepared: Vec<(c_uint, OwnedGlobal)> = Vec::with_capacity(items.len());
        for (mime, bytes) in items {
            let format = write_format(*mime).ok_or(Unavailable::Platform)?;
            let global = make_global(*mime, bytes).ok_or(Unavailable::Platform)?;
            prepared.push((format, global));
        }
        let clipboard = ClipboardGuard::open().ok_or(Unavailable::Platform)?;
        if !clipboard.empty() {
            return Err(Unavailable::Platform);
        }
        for (format, global) in prepared {
            // A rejected handle (and the rest of the iterator) drops and frees.
            if !clipboard.set(format, global.0) {
                return Err(Unavailable::Platform);
            }
            global.release();
        }
        Ok(())
    }
}

// ─── everything else (Linux, the BSDs, …) ───────────────────────────────────
// No in-process API: spawn `wl-paste`/`wl-copy` (Wayland), `xclip`, or `xsel`
// (text only) on the work pool, gated on `$WAYLAND_DISPLAY` / `$DISPLAY`.
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

    /// One helper invocation, classified by the watchdog's exit codes
    /// (127/126 missing, 124 hung); no helper uses those for a real answer.
    enum HelperRun {
        NotInstalled,
        TimedOut,
        Succeeded(Vec<u8>),
        /// `clean`: the helper itself exited non-zero ("nothing to paste").
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

    /// Reads and writes walk the same candidate list, so both reach the same
    /// clipboard.
    fn candidates(write: bool, mime: Mime) -> Vec<Vec<Box<[u8]>>> {
        let text = mime == Mime::TextPlain;
        let mime_arg = mime.as_str();
        let mut list: Vec<Vec<Box<[u8]>>> = Vec::new();
        let arg = |s: &str| -> Box<[u8]> { Box::from(s.as_bytes()) };
        if wayland() {
            // `--type text` matches any text flavour but never dumps binary;
            // `--no-newline` stops wl-paste appending one never copied.
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

    /// POSIX single-quoting: literal inside `'…'` except `'` -> `'\''`.
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

    /// Runs one helper through `/bin/sh` with a 10s watchdog (a hung X11 selection owner
    /// blocks forever): killed → exit 124, missing → 127. `None` ⇔ `/bin/sh` unspawnable.
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
        // The watchdog group is fully redirected so nothing holds the helper's
        // captured stdout open, and its TERM trap means nothing outlives it.
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
            // Work-pool caller: must not arm the process-wide signal forwarder.
            forward_signals: false,
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
                // Helpers exit 0 with empty stdout for an absent type; only
                // `text/plain` is ever deliberately empty.
                HelperRun::Succeeded(stdout) if stdout.is_empty() && mime != Mime::TextPlain => {
                    return Ok(None);
                }
                HelperRun::Succeeded(stdout) => return Ok(Some(stdout)),
                HelperRun::NotInstalled => {}
                HelperRun::TimedOut | HelperRun::Failed { clean: false } => ran += 1,
                // A clean non-zero exit is "nothing is copied".
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

    /// The one-shot helpers give no way to snapshot every type atomically, so
    /// this is best-effort: the read fails only when every type does.
    pub(super) fn read_all(types: &[Mime]) -> Result<Vec<(Mime, Vec<u8>)>, Unavailable> {
        let mut present = Vec::new();
        let mut readable = false;
        let mut unavailable = Unavailable::Platform;
        for mime in types {
            match read_type(*mime) {
                Ok(Some(bytes)) => {
                    readable = true;
                    present.push((*mime, bytes));
                }
                Ok(None) => readable = true,
                Err(reason) => unavailable = reason,
            }
        }
        if readable {
            Ok(present)
        } else {
            Err(unavailable)
        }
    }

    pub(super) fn write_types(items: &[(Mime, &[u8])]) -> Result<(), Unavailable> {
        // Rejected upstream (`clipboardWritesSingleRepresentation`); never
        // silently write a subset.
        if items.len() > 1 {
            return Err(Unavailable::MultipleRepresentations);
        }
        let Some((mime, bytes)) = items.first() else {
            return Ok(());
        };
        if !wayland() && !x11() {
            return Err(Unavailable::NoDisplay);
        }
        let list = candidates(true, *mime);
        // The sync spawner cannot feed stdin: stage the payload in a private
        // (0600, O_EXCL) temp file that `sh` redirects into the helper.
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

    /// `O_EXCL` refuses pre-planted files/symlinks at the predictable path.
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
