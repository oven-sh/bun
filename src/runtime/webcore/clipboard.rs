//! `navigator.clipboard` platform I/O: https://w3c.github.io/clipboard-apis/

use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr;
use std::borrow::Cow;

use bun_jsc::job::JsAffine;
use bun_jsc::{Completion, JSGlobalObject, Job, JobContext, JsThread};

/// `WebCore::ClipboardRequest`, completed or released on the JS thread.
struct Request(*mut c_void);

// SAFETY: used and dropped only on the JS thread, which the job carrier
// guarantees for its `Js` side.
unsafe impl JsAffine for Request {}

impl Request {
    fn complete(self, global: &JSGlobalObject, outcome: &Outcome) {
        let request = ManuallyDrop::new(self).0;
        let (representations, failure) = match outcome {
            Ok(items) => (
                items
                    .iter()
                    .map(|(mime, bytes)| Representation {
                        mime: *mime,
                        bytes: bytes.as_ptr(),
                        len: bytes.len(),
                    })
                    .collect::<Vec<_>>(),
                None,
            ),
            Err(unavailable) => (Vec::new(), Some(unavailable.message())),
        };
        let (message, message_len) = failure.as_deref().map_or((ptr::null(), 0), |message| {
            (message.as_ptr(), message.len())
        });
        // SAFETY: JS thread with a live global; the views borrow `outcome` and
        // `failure` for the call, which consumes the request.
        unsafe {
            Bun__Clipboard__requestComplete(
                global,
                request,
                representations.as_ptr(),
                representations.len(),
                message,
                message_len,
            )
        };
    }
}

impl Drop for Request {
    fn drop(&mut self) {
        // SAFETY: JS thread; `complete` bypasses Drop, so the request is live.
        unsafe { Bun__Clipboard__requestRelease(self.0) };
    }
}

/// Mirrors `WebCore::ClipboardRepresentation`; the bytes are borrowed for the call.
#[repr(C)]
pub struct Representation {
    mime: Mime,
    bytes: *const u8,
    len: usize,
}

unsafe extern "C" {
    /// A null `failure_message` means the operation succeeded.
    fn Bun__Clipboard__requestComplete(
        global: &JSGlobalObject,
        request: *mut c_void,
        representations: *const Representation,
        count: usize,
        failure_message: *const u8,
        failure_length: usize,
    );
    fn Bun__Clipboard__requestRelease(request: *mut c_void);
}

/// Mirrors `WebCore::ClipboardMIMEType`.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mime {
    TextPlain,
    TextHtml,
    ImagePng,
}

impl Mime {
    const ALL: [Mime; 3] = [Mime::TextPlain, Mime::TextHtml, Mime::ImagePng];
}

type Outcome = Result<Vec<(Mime, Vec<u8>)>, Unavailable>;

enum Op {
    ReadText,
    Read,
    Write(Vec<(Mime, Vec<u8>)>),
}

struct ClipboardOp {
    op: Op,
    outcome: Outcome,
}

struct ClipboardJob;

impl JobContext for ClipboardJob {
    type OffThread = ClipboardOp;
    type Js = Request;

    fn run(this: &mut ClipboardOp, done: Completion<Self>) -> Option<Completion<Self>> {
        this.outcome = match &this.op {
            Op::ReadText => platform::read_types(&[Mime::TextPlain]),
            Op::Read => platform::read_types(&Mime::ALL),
            Op::Write(items) => platform::write_types(items).map(|()| Vec::new()),
        };
        Some(done)
    }

    fn then(this: ClipboardOp, request: Request, cx: &JsThread<'_>) -> bun_jsc::JsResult<()> {
        request.complete(cx.global(), &this.outcome);
        Ok(())
    }
}

fn schedule(global: &JSGlobalObject, op: Op, request: *mut c_void) {
    let off = ClipboardOp {
        op,
        outcome: Err(Unavailable::Platform),
    };
    Job::<ClipboardJob>::schedule(&global.js_thread(), off, Request(request));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__scheduleReadText(global: &JSGlobalObject, request: *mut c_void) {
    schedule(global, Op::ReadText, request);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Clipboard__scheduleRead(global: &JSGlobalObject, request: *mut c_void) {
    schedule(global, Op::Read, request);
}

/// # Safety
/// `representations[..count]` and each entry's bytes must be readable for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Clipboard__scheduleWrite(
    global: &JSGlobalObject,
    request: *mut c_void,
    representations: *const Representation,
    count: usize,
) {
    // SAFETY: forwarded from the caller's contract.
    let entries = unsafe { bun_core::ffi::slice(representations, count) };
    let items = entries
        .iter()
        .map(|entry| {
            // SAFETY: forwarded from the caller's contract.
            let bytes = unsafe { bun_core::ffi::slice(entry.bytes, entry.len) };
            (entry.mime, bytes.to_vec())
        })
        .collect();
    schedule(global, Op::Write(items), request);
}

/// Why the platform clipboard could not be used; the `NotAllowedError` message.
enum Unavailable {
    Platform,
    #[cfg(target_os = "macos")]
    Changing,
    #[cfg(not(any(target_os = "macos", windows)))]
    NoDisplay,
    #[cfg(not(any(target_os = "macos", windows)))]
    NoHelper,
    #[cfg(not(any(target_os = "macos", windows)))]
    HelperFailed,
    #[cfg(not(any(target_os = "macos", windows)))]
    Spawn(bun_sys::Error),
}

impl Unavailable {
    fn message(&self) -> Cow<'static, [u8]> {
        Cow::Borrowed(match self {
            Unavailable::Platform => b"The system clipboard is not available.".as_slice(),
            #[cfg(target_os = "macos")]
            Unavailable::Changing => b"The system clipboard changed while it was being read.",
            #[cfg(not(any(target_os = "macos", windows)))]
            Unavailable::NoDisplay => {
                b"The clipboard requires a Wayland or X11 display, but neither $WAYLAND_DISPLAY nor $DISPLAY is set."
            }
            #[cfg(not(any(target_os = "macos", windows)))]
            Unavailable::NoHelper => {
                b"No clipboard helper was found. Install `wl-clipboard` (Wayland), `xclip`, or `xsel` (X11)."
            }
            #[cfg(not(any(target_os = "macos", windows)))]
            Unavailable::HelperFailed => b"The clipboard helper program failed to access the clipboard.",
            #[cfg(not(any(target_os = "macos", windows)))]
            Unavailable::Spawn(error) => {
                return Cow::Owned(format!("The clipboard helper could not be started: {error}").into_bytes());
            }
        })
    }
}

// ─── macOS: NSPasteboard via `image_coregraphics_shim.cpp` ──────────────────
#[cfg(target_os = "macos")]
mod platform {
    use core::ffi::{CStr, c_char, c_void};

    use super::{Mime, Outcome, Unavailable};

    const CG_OK: i32 = 0;
    const CG_CLIPBOARD_CHANGED: i32 = 5;

    unsafe extern "C" {
        fn bun_coregraphics_clipboard_read_types(
            utis: *const *const c_char,
            count: usize,
            out_datas: *mut *mut c_void,
            out_lens: *mut usize,
        ) -> i32;
        fn bun_coregraphics_clipboard_take_data(data: *mut c_void, out: *mut u8) -> i32;
        fn bun_coregraphics_clipboard_write_types(
            utis: *const *const c_char,
            datas: *const *const u8,
            lens: *const usize,
            count: usize,
        ) -> i32;
    }

    fn uti(mime: Mime) -> &'static CStr {
        match mime {
            Mime::TextPlain => c"public.utf8-plain-text",
            Mime::TextHtml => c"public.html",
            Mime::ImagePng => c"public.png",
        }
    }

    pub(super) fn read_types(types: &[Mime]) -> Outcome {
        let utis: Vec<*const c_char> = types.iter().map(|&mime| uti(mime).as_ptr()).collect();
        let mut datas: Vec<*mut c_void> = vec![core::ptr::null_mut(); types.len()];
        let mut lens = vec![0usize; types.len()];
        // Another process writing between the per-type reads would tear the item.
        for _ in 0..4 {
            // SAFETY: the three arrays are `types.len()` long and the UTIs are static.
            let status = unsafe {
                bun_coregraphics_clipboard_read_types(
                    utis.as_ptr(),
                    types.len(),
                    datas.as_mut_ptr(),
                    lens.as_mut_ptr(),
                )
            };
            if status == CG_CLIPBOARD_CHANGED {
                continue;
            }
            if status != CG_OK {
                return Err(Unavailable::Platform);
            }
            let mut present = Vec::new();
            let mut copied = true;
            for ((&mime, &data), &len) in types.iter().zip(&datas).zip(&lens) {
                if data.is_null() {
                    continue;
                }
                let mut bytes = vec![0u8; len];
                // SAFETY: `data` is the retained `len`-byte NSData the call above
                // handed over; this copies it into `bytes` and releases it.
                copied &= unsafe { bun_coregraphics_clipboard_take_data(data, bytes.as_mut_ptr()) }
                    == CG_OK;
                present.push((mime, bytes));
            }
            return if copied {
                Ok(present)
            } else {
                Err(Unavailable::Platform)
            };
        }
        Err(Unavailable::Changing)
    }

    pub(super) fn write_types(items: &[(Mime, Vec<u8>)]) -> Result<(), Unavailable> {
        if items.is_empty() {
            return Ok(());
        }
        let utis: Vec<*const c_char> = items.iter().map(|(mime, _)| uti(*mime).as_ptr()).collect();
        let datas: Vec<*const u8> = items.iter().map(|(_, bytes)| bytes.as_ptr()).collect();
        let lens: Vec<usize> = items.iter().map(|(_, bytes)| bytes.len()).collect();
        // SAFETY: the three arrays are index-aligned and outlive the call, which
        // copies every payload.
        let status = unsafe {
            bun_coregraphics_clipboard_write_types(
                utis.as_ptr(),
                datas.as_ptr(),
                lens.as_ptr(),
                items.len(),
            )
        };
        if status == CG_OK {
            Ok(())
        } else {
            Err(Unavailable::Platform)
        }
    }
}

// ─── Windows ────────────────────────────────────────────────────────────────
#[cfg(windows)]
pub(crate) mod win32 {
    use core::ffi::{CStr, c_uint};
    use core::marker::PhantomData;
    use core::mem::ManuallyDrop;

    use bun_sys::windows::{HANDLE, kernel32, user32};

    /// `OpenClipboard(NULL)` does not exclude this process's other threads.
    static TRANSACTION: bun_threading::Mutex = bun_threading::Mutex::new();

    /// The clipboard, open on this thread until dropped.
    pub(crate) struct OpenedClipboard {
        _not_send: PhantomData<*const ()>,
    }

    impl OpenedClipboard {
        /// Waits for this process and retries briefly while another one holds the clipboard.
        pub(crate) fn open() -> Option<Self> {
            const ATTEMPTS: u32 = 5;
            TRANSACTION.lock();
            for attempt in 1..=ATTEMPTS {
                if let Some(clipboard) = Self::open_locked() {
                    return Some(clipboard);
                }
                if attempt < ATTEMPTS {
                    kernel32::Sleep(5 * attempt);
                }
            }
            TRANSACTION.unlock();
            None
        }

        /// One attempt without waiting, for callers on the JS thread.
        pub(crate) fn try_open() -> Option<Self> {
            if !TRANSACTION.try_lock() {
                return None;
            }
            let clipboard = Self::open_locked();
            if clipboard.is_none() {
                TRANSACTION.unlock();
            }
            clipboard
        }

        fn open_locked() -> Option<Self> {
            (user32::OpenClipboard(core::ptr::null_mut()) != 0).then_some(OpenedClipboard {
                _not_send: PhantomData,
            })
        }

        /// `f` sees `format`'s bytes, `GlobalSize` long; `None` when absent or unlockable.
        pub(crate) fn with_data<R>(
            &mut self,
            format: c_uint,
            f: impl FnOnce(&[u8]) -> R,
        ) -> Option<R> {
            let h = user32::GetClipboardData(format);
            if h.is_null() {
                return None;
            }
            // SAFETY: `h` belongs to the open clipboard, which `&mut self` keeps
            // unchanged for this call.
            let p = unsafe { kernel32::GlobalLock(h) };
            if p.is_null() {
                return None;
            }
            // SAFETY: locked, so `GlobalSize` bytes stay readable until the unlock.
            let result =
                f(unsafe { core::slice::from_raw_parts(p.cast::<u8>(), kernel32::GlobalSize(h)) });
            // SAFETY: balances the lock above.
            unsafe { kernel32::GlobalUnlock(h) };
            Some(result)
        }

        /// Replaces the contents; a failure part-way leaves the clipboard empty.
        pub(crate) fn replace(&mut self, formats: Vec<(c_uint, OwnedGlobal)>) -> bool {
            // SAFETY: open on this thread, and `&mut self` rules out a live `with_data` view.
            if unsafe { user32::EmptyClipboard() } == 0 {
                return false;
            }
            for (format, global) in formats {
                let global = ManuallyDrop::new(global);
                // SAFETY: as above; `global` is an unlocked HGLOBAL this process owns.
                if unsafe { user32::SetClipboardData(format, global.0) }.is_null() {
                    drop(ManuallyDrop::into_inner(global));
                    // SAFETY: as above.
                    unsafe { user32::EmptyClipboard() };
                    return false;
                }
            }
            true
        }
    }

    impl Drop for OpenedClipboard {
        fn drop(&mut self) {
            // SAFETY: open on this thread; no `with_data` view outlives `self`.
            unsafe { user32::CloseClipboard() };
            TRANSACTION.unlock();
        }
    }

    /// 0 on failure; a name always maps to the same id.
    pub(crate) fn register_format(name: &CStr) -> c_uint {
        // SAFETY: `&CStr` is a readable NUL-terminated name.
        unsafe { user32::RegisterClipboardFormatA(name.as_ptr()) }
    }

    /// A movable HGLOBAL this process owns, freed on drop unless the clipboard takes it.
    pub(crate) struct OwnedGlobal(HANDLE);

    impl OwnedGlobal {
        /// Allocates at least one byte: a 0-byte HGLOBAL cannot be locked.
        pub(crate) fn from_bytes(bytes: &[u8]) -> Option<Self> {
            let h = kernel32::GlobalAlloc(
                kernel32::GMEM_MOVEABLE | kernel32::GMEM_ZEROINIT,
                bytes.len().max(1),
            );
            if h.is_null() {
                return None;
            }
            let global = OwnedGlobal(h);
            // SAFETY: a fresh unlocked allocation of at least `bytes.len()` bytes.
            unsafe {
                let dst = kernel32::GlobalLock(h);
                if dst.is_null() {
                    return None;
                }
                core::ptr::copy_nonoverlapping(bytes.as_ptr(), dst.cast::<u8>(), bytes.len());
                kernel32::GlobalUnlock(h);
            }
            Some(global)
        }
    }

    impl Drop for OwnedGlobal {
        fn drop(&mut self) {
            // SAFETY: still ours: `replace` forgets the handles the clipboard takes.
            unsafe { kernel32::GlobalFree(self.0) };
        }
    }
}

#[cfg(windows)]
mod platform {
    use core::ffi::{CStr, c_uint};

    use bun_sys::windows::user32::CF_UNICODETEXT;

    use super::win32::{OpenedClipboard, OwnedGlobal, register_format};
    use super::{Mime, Outcome, Unavailable};

    const CF_DIBV5: c_uint = 17;

    fn register(name: &CStr) -> Option<c_uint> {
        match register_format(name) {
            0 => None,
            id => Some(id),
        }
    }

    /// Producers register PNG under either name.
    fn read_formats(mime: Mime) -> [Option<c_uint>; 2] {
        match mime {
            Mime::TextPlain => [Some(CF_UNICODETEXT), None],
            Mime::ImagePng => [register(c"PNG"), register(c"image/png")],
            Mime::TextHtml => [register(c"HTML Format"), None],
        }
    }

    fn write_format(mime: Mime) -> Option<c_uint> {
        match mime {
            Mime::TextPlain => Some(CF_UNICODETEXT),
            Mime::ImagePng => register(c"PNG"),
            Mime::TextHtml => register(c"HTML Format"),
        }
    }

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
        out.push(0);
        out
    }

    fn cf_html_offset(payload: &[u8], key: &[u8]) -> Option<usize> {
        let at = bun_core::strings::index_of(payload, key)?;
        let digits = &payload[at + key.len()..];
        let end = digits.iter().position(|byte| !byte.is_ascii_digit())?;
        core::str::from_utf8(&digits[..end]).ok()?.parse().ok()
    }

    /// Checks another program's offsets, falling back to the fragment markers.
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

    /// Stops at the first NUL without trusting one to exist.
    fn text_from_utf16(bytes: &[u8]) -> Vec<u8> {
        let units: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .take_while(|&unit| unit != 0)
            .collect();
        String::from_utf16_lossy(&units).into_bytes()
    }

    /// Cuts `GlobalSize` slack after https://www.w3.org/TR/png-3/#11IEND
    fn trim_png(bytes: &[u8]) -> &[u8] {
        const IEND: &[u8] = b"IEND\xAE\x42\x60\x82";
        match bun_core::strings::last_index_of(bytes, IEND) {
            Some(at) => &bytes[..at + IEND.len()],
            None => bytes,
        }
    }

    fn read_type(clipboard: &mut OpenedClipboard, mime: Mime) -> Option<Vec<u8>> {
        for format in read_formats(mime).into_iter().flatten() {
            // Memory another app left unlockable reads as absent.
            if let Some(bytes) = clipboard.with_data(format, |bytes| match mime {
                Mime::TextPlain => Some(text_from_utf16(bytes)),
                Mime::ImagePng => Some(trim_png(bytes).to_vec()),
                Mime::TextHtml => {
                    let end =
                        bun_core::strings::index_of_char_usize(bytes, 0).unwrap_or(bytes.len());
                    cf_html_fragment(&bytes[..end])
                }
            }) {
                return bytes;
            }
        }
        None
    }

    /// One open span, so no other process writes between the types.
    pub(super) fn read_types(types: &[Mime]) -> Outcome {
        let mut clipboard = OpenedClipboard::open().ok_or(Unavailable::Platform)?;
        Ok(types
            .iter()
            .filter_map(|&mime| Some((mime, read_type(&mut clipboard, mime)?)))
            .collect())
    }

    /// Bare `\n` becomes `\r\n`: https://w3c.github.io/clipboard-apis/#dom-clipboard-writetext
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

    fn make_global(mime: Mime, bytes: &[u8]) -> Option<OwnedGlobal> {
        match mime {
            Mime::TextPlain => {
                let crlf;
                let text = if bun_core::strings::contains_char(bytes, b'\n') {
                    crlf = normalize_to_crlf(bytes);
                    &crlf[..]
                } else {
                    bytes
                };
                // CF_UNICODETEXT is NUL-terminated UTF-16.
                let wide = bun_core::strings::to_utf16_alloc_for_real(text, false, true).ok()?;
                OwnedGlobal::from_bytes(bytemuck::cast_slice::<u16, u8>(&wide))
            }
            Mime::TextHtml => OwnedGlobal::from_bytes(&build_cf_html(bytes)),
            Mime::ImagePng => OwnedGlobal::from_bytes(bytes),
        }
    }

    /// https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapv5header
    fn dibv5_from_png(png: &[u8]) -> Option<Vec<u8>> {
        const HEADER_SIZE: u32 = 124;
        const BI_BITFIELDS: u32 = 3;
        const LCS_SRGB: u32 = u32::from_be_bytes(*b"sRGB");
        const LCS_GM_IMAGES: u32 = 4;
        let image =
            crate::image::backend_wic::decode(png, crate::image::codecs::DEFAULT_MAX_PIXELS)
                .ok()?;
        if image.width == 0 || image.height == 0 {
            return None;
        }
        let size_image = u32::try_from(image.rgba.len()).ok()?;
        let mut dib = Vec::with_capacity(HEADER_SIZE as usize + image.rgba.len());
        let mut put = |value: u32| dib.extend_from_slice(&value.to_le_bytes());
        // Positive height: rows run bottom-up.
        for value in [HEADER_SIZE, image.width, image.height, 1 | (32 << 16)] {
            put(value);
        }
        for value in [BI_BITFIELDS, size_image, 0, 0, 0, 0] {
            put(value);
        }
        for value in [0x00FF_0000, 0x0000_FF00, 0x0000_00FF, 0xFF00_0000, LCS_SRGB] {
            put(value);
        }
        dib.resize(dib.len() + 36 + 12, 0);
        for value in [LCS_GM_IMAGES, 0, 0, 0] {
            dib.extend_from_slice(&u32::to_le_bytes(value));
        }
        debug_assert_eq!(dib.len(), HEADER_SIZE as usize);
        for row in image.rgba.chunks_exact(image.width as usize * 4).rev() {
            for pixel in row.as_chunks::<4>().0 {
                dib.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
            }
        }
        Some(dib)
    }

    pub(super) fn write_types(items: &[(Mime, Vec<u8>)]) -> Result<(), Unavailable> {
        // Everything fallible happens before the clipboard is emptied.
        let mut formats = Vec::with_capacity(items.len() + 1);
        for (mime, bytes) in items {
            let format = write_format(*mime).ok_or(Unavailable::Platform)?;
            formats.push((
                format,
                make_global(*mime, bytes).ok_or(Unavailable::Platform)?,
            ));
            // The bitmap is an extra; without it the PNG is still written.
            if *mime == Mime::ImagePng
                && let Some(dib) =
                    dibv5_from_png(bytes).and_then(|dib| OwnedGlobal::from_bytes(&dib))
            {
                formats.push((CF_DIBV5, dib));
            }
        }
        let mut clipboard = OpenedClipboard::open().ok_or(Unavailable::Platform)?;
        if clipboard.replace(formats) {
            Ok(())
        } else {
            Err(Unavailable::Platform)
        }
    }
}

// ─── everything else: `wl-clipboard`, `xclip`, or `xsel` (text only) ────────
#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use bun_core::{env_var, strings};
    use bun_sys::{Fd, File, O};

    use crate::api::bun_process::Status as SpawnStatus;
    use crate::api::bun_process::sync as spawn_sync;

    use super::{Mime, Outcome, Unavailable};

    fn is_set(value: Option<&[u8]>) -> bool {
        value.is_some_and(|value| !value.is_empty())
    }

    #[derive(Clone, Copy)]
    enum Helper {
        WlClipboard,
        Xclip,
        Xsel,
    }

    /// The helpers for the displays this process can reach, in preference order.
    fn helpers() -> Result<Vec<Helper>, Unavailable> {
        let mut list = Vec::with_capacity(3);
        if is_set(env_var::WAYLAND_DISPLAY::get()) {
            list.push(Helper::WlClipboard);
        }
        if is_set(env_var::DISPLAY::get()) {
            list.extend([Helper::Xclip, Helper::Xsel]);
        }
        if list.is_empty() {
            return Err(Unavailable::NoDisplay);
        }
        Ok(list)
    }

    impl Helper {
        fn read_argv(self, mime: Mime) -> Option<&'static [&'static str]> {
            Some(match (self, mime) {
                // `--type text` matches any text flavour; `--no-newline` adds none.
                (Helper::WlClipboard, Mime::TextPlain) => {
                    &["wl-paste", "--no-newline", "--type", "text"]
                }
                (Helper::WlClipboard, Mime::TextHtml) => {
                    &["wl-paste", "--no-newline", "--type", "text/html"]
                }
                (Helper::WlClipboard, Mime::ImagePng) => {
                    &["wl-paste", "--no-newline", "--type", "image/png"]
                }
                (Helper::Xclip, Mime::TextPlain) => &["xclip", "-selection", "clipboard", "-out"],
                (Helper::Xclip, Mime::TextHtml) => &[
                    "xclip",
                    "-selection",
                    "clipboard",
                    "-t",
                    "text/html",
                    "-out",
                ],
                (Helper::Xclip, Mime::ImagePng) => &[
                    "xclip",
                    "-selection",
                    "clipboard",
                    "-t",
                    "image/png",
                    "-out",
                ],
                (Helper::Xsel, Mime::TextPlain) => &["xsel", "--clipboard", "--output"],
                (Helper::Xsel, _) => return None,
            })
        }

        fn write_argv(self, mime: Mime) -> Option<&'static [&'static str]> {
            Some(match (self, mime) {
                (Helper::WlClipboard, Mime::TextPlain) => {
                    &["wl-copy", "--type", "text/plain;charset=utf-8"]
                }
                (Helper::WlClipboard, Mime::TextHtml) => &["wl-copy", "--type", "text/html"],
                (Helper::WlClipboard, Mime::ImagePng) => &["wl-copy", "--type", "image/png"],
                (Helper::Xclip, Mime::TextPlain) => &["xclip", "-selection", "clipboard", "-in"],
                (Helper::Xclip, Mime::TextHtml) => {
                    &["xclip", "-selection", "clipboard", "-t", "text/html", "-in"]
                }
                (Helper::Xclip, Mime::ImagePng) => {
                    &["xclip", "-selection", "clipboard", "-t", "image/png", "-in"]
                }
                (Helper::Xsel, Mime::TextPlain) => &["xsel", "--clipboard", "--input"],
                (Helper::Xsel, _) => return None,
            })
        }

        /// Prints the offered types, one per line; xsel has no such mode.
        fn targets_argv(self) -> Option<&'static [&'static str]> {
            match self {
                Helper::WlClipboard => Some(&["wl-paste", "--list-types"]),
                Helper::Xclip => {
                    Some(&["xclip", "-selection", "clipboard", "-t", "TARGETS", "-out"])
                }
                Helper::Xsel => None,
            }
        }
    }

    fn offers(targets: &[u8], mime: Mime) -> bool {
        strings::split(targets, b"\n").any(|line| {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            let essence = strings::split_once_char(line, b';').map_or(line, |(essence, _)| essence);
            match mime {
                Mime::TextPlain => matches!(
                    essence,
                    b"text/plain" | b"UTF8_STRING" | b"STRING" | b"TEXT"
                ),
                Mime::TextHtml => essence == b"text/html",
                Mime::ImagePng => essence == b"image/png",
            }
        })
    }

    enum HelperRun {
        NotInstalled,
        Succeeded(Vec<u8>),
        /// `clean`: the helper said nothing (of that type) is copied.
        Failed {
            clean: bool,
        },
    }

    /// How xclip ("target … not available") and wl-paste say nothing is copied.
    const NOTHING_COPIED: [&[u8]; 4] = [
        b"not available",
        b"No selection",
        b"Nothing is copied",
        b"No suitable type",
    ];

    /// The watchdog's codes (127/126 missing, 124 killed) are ones no helper uses.
    fn classify(result: spawn_sync::Result) -> HelperRun {
        if result.status.is_ok() {
            return HelperRun::Succeeded(result.stdout);
        }
        let SpawnStatus::Exited(exited) = result.status else {
            return HelperRun::Failed { clean: false };
        };
        match exited.code {
            126 | 127 => HelperRun::NotInstalled,
            124 => HelperRun::Failed { clean: false },
            _ => HelperRun::Failed {
                clean: NOTHING_COPIED
                    .iter()
                    .any(|message| strings::contains(&result.stderr, message)),
            },
        }
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

    /// Runs a helper under a `/bin/sh` watchdog: a hung X11 selection owner blocks forever.
    fn run(argv: &[&str], stdin: Option<Fd>, capture: bool) -> Result<HelperRun, Unavailable> {
        let mut command = Vec::<u8>::with_capacity(256);
        // An asynchronous command's stdin is /dev/null, so the payload goes through fd 3.
        if stdin.is_some() {
            command.extend_from_slice(b"exec 3<&0; ");
        }
        for (i, word) in argv.iter().enumerate() {
            if i > 0 {
                command.push(b' ');
            }
            shell_quote_into(&mut command, word.as_bytes());
        }
        if stdin.is_some() {
            command.extend_from_slice(b" <&3 3<&- & c=$!; exec 3<&-;");
        } else {
            command.extend_from_slice(b" & c=$!;");
        }
        let seconds = env_var::BUN_INTERNAL_CLIPBOARD_HELPER_TIMEOUT
            .get()
            .unwrap_or_default()
            .max(1);
        // Fires only after `sleep` completes; redirected so it holds no captured pipe.
        command.extend_from_slice(b" { trap 'kill \"$sp\" 2>/dev/null; exit 0' TERM; sleep ");
        command.extend_from_slice(seconds.to_string().as_bytes());
        command.extend_from_slice(
            b" & sp=$!; wait \"$sp\" && kill \"$c\" 2>/dev/null; } >/dev/null 2>&1 & w=$!; wait \"$c\"; s=$?; kill \"$w\" 2>/dev/null; [ \"$s\" -ge 128 ] && s=124; exit \"$s\"",
        );
        let output = if capture {
            spawn_sync::SyncStdio::Buffer
        } else {
            spawn_sync::SyncStdio::Ignore
        };
        let result = spawn_sync::spawn(&spawn_sync::Options {
            argv: vec![
                Box::from(b"/bin/sh".as_slice()),
                Box::from(b"-c".as_slice()),
                command.into_boxed_slice(),
            ],
            cwd: Box::from(b".".as_slice()),
            stdin: stdin.map_or(spawn_sync::SyncStdio::Ignore, spawn_sync::SyncStdio::Fd),
            // Not for writes: a helper that daemonizes keeps its output open.
            stdout: output,
            stderr: output,
            envp: None,
            // A pool thread must not arm the process-wide signal forwarder.
            forward_signals: false,
            ..Default::default()
        });
        match result {
            Ok(Ok(result)) => Ok(classify(result)),
            Ok(Err(error)) => Err(Unavailable::Spawn(error)),
            Err(_) => Err(Unavailable::Platform),
        }
    }

    enum Answer {
        NotInstalled,
        Failed,
        Present(Vec<(Mime, Vec<u8>)>),
    }

    fn read_one(helper: Helper, mime: Mime) -> Result<Answer, Unavailable> {
        let Some(argv) = helper.read_argv(mime) else {
            return Ok(Answer::NotInstalled);
        };
        Ok(match run(argv, None, true)? {
            HelperRun::NotInstalled => Answer::NotInstalled,
            HelperRun::Failed { clean: false } => Answer::Failed,
            HelperRun::Failed { clean: true } => Answer::Present(Vec::new()),
            // An absent type reads as nothing; only text is ever deliberately empty.
            HelperRun::Succeeded(bytes) if bytes.is_empty() && mime != Mime::TextPlain => {
                Answer::Present(Vec::new())
            }
            HelperRun::Succeeded(bytes) => Answer::Present(vec![(mime, bytes)]),
        })
    }

    /// Asks the selection owner what it offers, then reads only those types.
    fn read_offered(helper: Helper, types: &[Mime]) -> Result<Answer, Unavailable> {
        let Some(argv) = helper.targets_argv() else {
            return read_one(helper, Mime::TextPlain);
        };
        let targets = match run(argv, None, true)? {
            HelperRun::NotInstalled => return Ok(Answer::NotInstalled),
            HelperRun::Failed { clean: false } => return Ok(Answer::Failed),
            HelperRun::Failed { clean: true } => return Ok(Answer::Present(Vec::new())),
            HelperRun::Succeeded(targets) => targets,
        };
        let mut present = Vec::new();
        for &mime in types.iter().filter(|&&mime| offers(&targets, mime)) {
            match read_one(helper, mime)? {
                Answer::Present(mut read) => present.append(&mut read),
                // An offered type that cannot be delivered is a failed read, not an absent one.
                Answer::Failed | Answer::NotInstalled => return Ok(Answer::Failed),
            }
        }
        Ok(Answer::Present(present))
    }

    /// The first helper that reaches the clipboard answers for it.
    pub(super) fn read_types(types: &[Mime]) -> Outcome {
        let mut ran = false;
        for helper in helpers()? {
            let answer = match types {
                [mime] => read_one(helper, *mime)?,
                _ => read_offered(helper, types)?,
            };
            match answer {
                Answer::Present(present) => return Ok(present),
                Answer::NotInstalled => {}
                Answer::Failed => ran = true,
            }
        }
        Err(if ran {
            Unavailable::HelperFailed
        } else {
            Unavailable::NoHelper
        })
    }

    pub(super) fn write_types(items: &[(Mime, Vec<u8>)]) -> Result<(), Unavailable> {
        // WebCore passes exactly one representation on this backend.
        let [(mime, bytes)] = items else {
            return Err(Unavailable::Platform);
        };
        let helpers = helpers()?;
        let payload = payload(bytes).ok_or(Unavailable::Platform)?;
        let mut ran = false;
        for helper in helpers {
            let Some(argv) = helper.write_argv(*mime) else {
                continue;
            };
            payload.seek_to(0).map_err(|_| Unavailable::Platform)?;
            match run(argv, Some(payload.handle), false)? {
                HelperRun::Succeeded(_) => return Ok(()),
                HelperRun::NotInstalled => {}
                HelperRun::Failed { .. } => ran = true,
            }
        }
        Err(if ran {
            Unavailable::HelperFailed
        } else {
            Unavailable::NoHelper
        })
    }

    /// The payload behind an fd that has no name anyone else can open.
    fn payload(bytes: &[u8]) -> Option<File> {
        let file = open_anonymous()?;
        file.write_all(bytes).ok()?;
        Some(file)
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn open_anonymous() -> Option<File> {
        if bun_sys::can_use_memfd()
            && let Ok(fd) =
                bun_sys::memfd_create(c"bun-clipboard", bun_sys::MemfdFlags::NonExecutable)
        {
            return Some(File::from_fd(fd));
        }
        open_unlinked_temp_file()
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    fn open_anonymous() -> Option<File> {
        open_unlinked_temp_file()
    }

    /// A private temp file, unlinked before any helper runs.
    fn open_unlinked_temp_file() -> Option<File> {
        let mut name_buf = [0u8; 64];
        let name = bun_paths::fs::FileSystem::tmpname(
            b"bun-clipboard",
            &mut name_buf,
            bun_core::fast_random(),
        )
        .ok()?;
        let mut path = bun_resolver::fs::RealFS::tmpdir_path().to_vec();
        if path.last() != Some(&b'/') {
            path.push(b'/');
        }
        path.extend_from_slice(name.as_bytes());
        let file = File::openat(
            Fd::cwd(),
            &path,
            O::RDWR | O::CREAT | O::EXCL | O::CLOEXEC,
            0o600,
        )
        .ok()?;
        let len = path.len();
        path.push(0);
        bun_sys::unlink(bun_core::ZStr::from_buf(&path, len)).ok()?;
        Some(file)
    }
}
