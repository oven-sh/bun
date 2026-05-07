#![allow(unused, non_camel_case_types, non_snake_case)]

#![warn(unreachable_pub)]
use core::ffi::c_int;
use core::fmt;

use bstr::BStr;

use bun_core::output as Output;
use bun_core::pretty_fmt;

#[inline]
fn enable_ansi_colors_stderr() -> bool {
    Output::ENABLE_ANSI_COLORS_STDERR.load(core::sync::atomic::Ordering::Relaxed)
}

/// Two-phase string builder: callers first `count()` every slice they will
/// append, then `allocate()` once, then `append()` each slice. Returned slices
/// alias the single backing buffer.
//
// PORT NOTE: local copy of `src/string/StringBuilder.zig` (subset). `append`
// hands out slices that alias the internal buffer with an *unbound* lifetime so
// `Header::clone` / `Request::clone` can call it repeatedly and stash the raw
// ptr/len pairs — the Zig original returns aliasing `[]const u8` with no
// lifetime tracking. The buffer is heap-owned via raw `*mut u8` (Zig `?[*]u8`);
// callers are responsible for keeping the builder alive while the returned
// slices are in use.
#[derive(Default)]
pub struct StringBuilder {
    pub len: usize,
    pub cap: usize,
    pub ptr: Option<core::ptr::NonNull<u8>>,
}

impl StringBuilder {
    #[inline]
    pub fn count(&mut self, slice: &[u8]) {
        self.cap += slice.len();
    }

    pub fn allocate(&mut self) {
        // allocator.alloc(u8, this.cap)
        let mut buf = vec![0u8; self.cap].into_boxed_slice();
        self.ptr = core::ptr::NonNull::new(buf.as_mut_ptr());
        core::mem::forget(buf);
        self.len = 0;
    }

    /// Copy `slice` into the reserved buffer and return a borrow of the copied
    /// bytes. The returned slice aliases `self.ptr` and remains valid until the
    /// builder is dropped; the unbound `'a` mirrors Zig's untracked `[]const u8`
    /// return so callers may interleave appends (see PORT NOTE above).
    pub fn append<'a>(&mut self, slice: &[u8]) -> &'a [u8] {
        debug_assert!(self.len + slice.len() <= self.cap); // didn't count everything
        debug_assert!(self.ptr.is_some()); // must call allocate first

        // SAFETY: `ptr` was allocated with `cap` bytes by `allocate()`; the
        // debug_assert above guarantees `len + slice.len() <= cap`, so
        // `[len..len+slice.len())` is in-bounds and exclusively owned here.
        let base = unsafe { self.ptr.unwrap().as_ptr().add(self.len) };
        unsafe { core::ptr::copy_nonoverlapping(slice.as_ptr(), base, slice.len()) };
        // SAFETY: `base..base+slice.len()` was just initialized above and lives
        // for as long as `self.ptr` (heap allocation never moves).
        let result = unsafe { core::slice::from_raw_parts(base, slice.len()) };
        self.len += slice.len();

        debug_assert!(self.len <= self.cap);

        result
    }
}

impl Drop for StringBuilder {
    fn drop(&mut self) {
        if let Some(ptr) = self.ptr {
            if self.cap != 0 {
                // SAFETY: reconstitutes the Box<[u8]> forgotten in `allocate()`.
                drop(unsafe { Box::from_raw(core::slice::from_raw_parts_mut(ptr.as_ptr(), self.cap)) });
            }
        }
    }
}

// TODO(b1): bun_picohttp_sys crate missing — local FFI stub surface.
// Real bindings land in B-2 (bindgen over vendor/picohttpparser).
#[allow(non_camel_case_types)]
mod c {
    use core::ffi::{c_char, c_int};
    #[repr(C)]
    pub struct phr_header {
        pub name: *const c_char,
        pub name_len: usize,
        pub value: *const c_char,
        pub value_len: usize,
    }
    pub type struct_phr_header = phr_header;
    /// Mirrors `struct phr_chunked_decoder` from picohttpparser.h. The HTTP
    /// client writes `consume_trailer` directly and inspects `_state` via
    /// `phr_decode_chunked_is_in_data`, so the layout must match C exactly.
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct phr_chunked_decoder {
        pub bytes_left_in_chunk: usize,
        /// Set to 1 to discard trailing headers after the terminal `0\r\n` chunk.
        pub consume_trailer: core::ffi::c_char,
        pub _hex_count: core::ffi::c_char,
        pub _state: core::ffi::c_char,
    }
    pub type struct_phr_chunked_decoder = phr_chunked_decoder;
    unsafe extern "C" {
        pub fn phr_parse_request(
            buf: *const u8, len: usize,
            method: *mut *const c_char, method_len: *mut usize,
            path: *mut *const c_char, path_len: *mut usize,
            minor_version: *mut c_int,
            headers: *mut phr_header, num_headers: *mut usize,
            last_len: usize,
        ) -> c_int;
        pub fn phr_parse_response(
            buf: *const u8, len: usize,
            minor_version: *mut c_int, status: *mut c_int,
            msg: *mut *const c_char, msg_len: *mut usize,
            headers: *mut phr_header, num_headers: *mut usize,
            last_len: usize,
        ) -> c_int;
        pub fn phr_parse_headers(
            buf: *const u8, len: usize,
            headers: *mut phr_header, num_headers: *mut usize,
            last_len: usize,
        ) -> c_int;
        pub fn phr_decode_chunked(
            decoder: *mut phr_chunked_decoder, buf: *mut u8, len: *mut usize,
        ) -> isize;
        pub fn phr_decode_chunked_is_in_data(decoder: *mut phr_chunked_decoder) -> c_int;
    }
}

// TODO(b1): bun_str crate missing — local stub for the few helpers used here.
mod strings {
    #[inline] pub(crate) fn eql_case_insensitive_ascii(a: &[u8], b: &[u8], _check_len: bool) -> bool {
        a.eq_ignore_ascii_case(b)
    }
    #[inline] pub(crate) fn has_prefix(h: &[u8], p: &[u8]) -> bool { h.starts_with(p) }
    #[inline] pub(crate) fn contains(h: &[u8], n: &[u8]) -> bool {
        ::bstr::ByteSlice::find(h, n).is_some()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────────────────

/// NOTE: layout MUST match `c::phr_header` exactly (see static asserts below).
/// Zig used `name: []const u8` / `value: []const u8` and relied on Zig's slice
/// ABI being `{ptr, len}`. Rust `&[u8]` has no guaranteed field order in
/// `#[repr(C)]`, so we spell the fields out and expose `.name()` / `.value()`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Header {
    name_ptr: *const u8,
    name_len: usize,
    value_ptr: *const u8,
    value_len: usize,
}

impl Default for Header {
    #[inline]
    fn default() -> Self { Self::ZERO }
}

impl Header {
    /// All-zero sentinel — name/value are empty slices. Used by callers to
    /// initialize fixed-size header arrays before filling them.
    pub const ZERO: Self = Self {
        name_ptr: b"".as_ptr(),
        name_len: 0,
        value_ptr: b"".as_ptr(),
        value_len: 0,
    };

    /// Construct a `Header` from borrowed name/value slices. The caller is
    /// responsible for keeping the backing storage alive for as long as the
    /// `Header` is read (matches the Zig `[]const u8` field semantics).
    #[inline]
    pub const fn new(name: &[u8], value: &[u8]) -> Self {
        Self {
            name_ptr: name.as_ptr(),
            name_len: name.len(),
            value_ptr: value.as_ptr(),
            value_len: value.len(),
        }
    }

    #[inline]
    pub fn name(&self) -> &[u8] {
        // picohttpparser sets `name = NULL, name_len = 0` for multiline /
        // continuation headers. `from_raw_parts(null, 0)` is UB in Rust even
        // though Zig's `[]const u8{ptr=null, len=0}` is well-defined, so guard
        // the zero-length case explicitly.
        if self.name_len == 0 {
            return &[];
        }
        // SAFETY: ptr/len originate from picohttpparser pointing into the
        // caller-provided buffer, or from StringBuilder::append.
        unsafe { core::slice::from_raw_parts(self.name_ptr, self.name_len) }
    }

    #[inline]
    pub fn value(&self) -> &[u8] {
        // Defensive: picohttpparser always points `value` into `buf` on
        // success, but mirror the name() guard so a zero-length value never
        // constructs a slice from a null pointer.
        if self.value_len == 0 {
            return &[];
        }
        // SAFETY: same as name()
        unsafe { core::slice::from_raw_parts(self.value_ptr, self.value_len) }
    }

    pub fn is_multiline(&self) -> bool {
        self.name_len == 0
    }

    pub fn count(&self, builder: &mut StringBuilder) {
        builder.count(self.name());
        builder.count(self.value());
    }

    pub fn clone(&self, builder: &mut StringBuilder) -> Header {
        let name = builder.append(self.name());
        let value = builder.append(self.value());
        Header {
            name_ptr: name.as_ptr(),
            name_len: name.len(),
            value_ptr: value.as_ptr(),
            value_len: value.len(),
        }
    }

    pub fn curl(&self) -> HeaderCurlFormatter<'_> {
        HeaderCurlFormatter { header: self }
    }
}

impl fmt::Display for Header {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // NOTE: pretty_fmt! is the comptime ANSI-tag expander (`<r><cyan>` → escape
        // codes). bun_core's current impl is a passthrough TODO(port) until the
        // proc-macro lands; output will contain literal `<r>` tags until then.
        if enable_ansi_colors_stderr() {
            if self.is_multiline() {
                write!(f, pretty_fmt!("<r><cyan>{}", true), BStr::new(self.value()))
            } else {
                write!(
                    f,
                    pretty_fmt!("<r><cyan>{}<r><d>: <r>{}", true),
                    BStr::new(self.name()),
                    BStr::new(self.value()),
                )
            }
        } else {
            if self.is_multiline() {
                write!(f, pretty_fmt!("<r><cyan>{}", false), BStr::new(self.value()))
            } else {
                write!(
                    f,
                    pretty_fmt!("<r><cyan>{}<r><d>: <r>{}", false),
                    BStr::new(self.name()),
                    BStr::new(self.value()),
                )
            }
        }
    }
}

const _: () = assert!(core::mem::size_of::<Header>() == core::mem::size_of::<c::phr_header>());
const _: () = assert!(core::mem::align_of::<Header>() == core::mem::align_of::<c::phr_header>());

pub struct HeaderCurlFormatter<'a> {
    header: &'a Header,
}

impl fmt::Display for HeaderCurlFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let header = self.header;
        if header.value_len > 0 {
            write!(f, "-H \"{}: {}\"", BStr::new(header.name()), BStr::new(header.value()))
        } else {
            write!(f, "-H \"{}\"", BStr::new(header.name()))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Header::List
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct HeaderList<'a> {
    pub list: &'a [Header],
    // TODO(port): Zig field is `[]Header` (mutable slice) but only ever read
    // through `*const List`; using `&'a [Header]` here. Revisit if a caller
    // mutates through it.
}

impl<'a> HeaderList<'a> {
    pub fn get(&self, name: &[u8]) -> Option<&'a [u8]> {
        for header in self.list {
            if strings::eql_case_insensitive_ascii(header.name(), name, true) {
                return Some(header.value());
            }
        }
        None
    }

    pub fn get_if_other_is_absent(
        &self,
        name: impl AsRef<[u8]>,
        other: impl AsRef<[u8]>,
    ) -> Option<&'a [u8]> {
        let name = name.as_ref();
        let other = other.as_ref();
        let mut value: Option<&'a [u8]> = None;
        for header in self.list {
            if strings::eql_case_insensitive_ascii(header.name(), other, true) {
                return None;
            }

            if value.is_none() && strings::eql_case_insensitive_ascii(header.name(), name, true) {
                value = Some(header.value());
            }
        }

        value
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Request
// ──────────────────────────────────────────────────────────────────────────

// TODO(b1): thiserror not in workspace deps — manual Display/Error impl.
#[derive(Debug, strum::IntoStaticStr)]
pub enum ParseRequestError {
    BadRequest,
    ShortRead,
}
impl fmt::Display for ParseRequestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(<&'static str>::from(self))
    }
}
impl std::error::Error for ParseRequestError {}
impl From<ParseRequestError> for bun_core::Error {
    fn from(e: ParseRequestError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

pub struct Request<'a> {
    pub method: &'a [u8],
    pub path: &'a [u8],
    pub minor_version: usize,
    pub headers: &'a [Header],
    pub bytes_read: u32,
}

impl<'a> Request<'a> {
    pub fn curl(&self, ignore_insecure: bool, body: &'a [u8]) -> RequestCurlFormatter<'_> {
        RequestCurlFormatter {
            request: self,
            ignore_insecure,
            body,
        }
    }

    pub fn clone(&self, headers: &'a mut [Header], builder: &mut StringBuilder) -> Request<'a> {
        for (i, header) in self.headers.iter().enumerate() {
            headers[i] = header.clone(builder);
        }

        Request {
            method: builder.append(self.method),
            path: builder.append(self.path),
            minor_version: self.minor_version,
            headers,
            bytes_read: self.bytes_read,
        }
    }

    pub fn parse(buf: &'a [u8], src: &'a mut [Header]) -> Result<Request<'a>, ParseRequestError> {
        let mut method_ptr: *const u8 = core::ptr::null();
        let mut method_len: usize = 0;
        let mut path_ptr: *const u8 = core::ptr::null();
        let mut path_len: usize = 0;
        let mut minor_version: c_int = 0;
        let mut num_headers: usize = src.len();

        // SAFETY: picohttpparser writes back into the out-params; src is
        // layout-compatible with phr_header (asserted above).
        let rc = unsafe {
            c::phr_parse_request(
                buf.as_ptr(),
                buf.len(),
                &mut method_ptr as *mut *const u8 as *mut *const core::ffi::c_char,
                &mut method_len,
                &mut path_ptr as *mut *const u8 as *mut *const core::ffi::c_char,
                &mut path_len,
                &mut minor_version,
                src.as_mut_ptr().cast::<c::phr_header>(),
                &mut num_headers,
                0,
            )
        };

        // Leave a sentinel value, for JavaScriptCore support.
        if rc > -1 {
            // SAFETY: path_ptr points into buf; the byte after the path is the
            // space before "HTTP/1.x" which picohttpparser has already consumed,
            // so writing a NUL there is in-bounds. Zig casts away const here too.
            unsafe { (path_ptr as *mut u8).add(path_len).write(0) };
        }

        match rc {
            -1 => Err(ParseRequestError::BadRequest),
            -2 => Err(ParseRequestError::ShortRead),
            _ => Ok(Request {
                // SAFETY: on success, ptr/len point into `buf`.
                method: unsafe { core::slice::from_raw_parts(method_ptr, method_len) },
                path: unsafe { core::slice::from_raw_parts(path_ptr, path_len) },
                minor_version: usize::try_from(minor_version).expect("int cast"),
                headers: &src[0..num_headers],
                bytes_read: u32::try_from(rc).expect("int cast"),
            }),
        }
    }
}

impl fmt::Display for Request<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if enable_ansi_colors_stderr() {
            f.write_str(pretty_fmt!("<r><d>[fetch]<r> ", true))?;
        }
        write!(f, "> HTTP/1.1 {} {}\n", BStr::new(self.method), BStr::new(self.path))?;
        for header in self.headers {
            if enable_ansi_colors_stderr() {
                f.write_str(pretty_fmt!("<r><d>[fetch]<r> ", true))?;
            }
            f.write_str("> ")?;
            write!(f, "{}\n", header)?;
        }
        Ok(())
    }
}

pub struct RequestCurlFormatter<'a> {
    request: &'a Request<'a>,
    ignore_insecure: bool,
    body: &'a [u8],
}

impl<'a> RequestCurlFormatter<'a> {
    fn is_printable_body(content_type: &[u8]) -> bool {
        if content_type.is_empty() {
            return false;
        }

        strings::has_prefix(content_type, b"text/")
            || strings::has_prefix(content_type, b"application/json")
            || strings::contains(content_type, b"json")
            || strings::has_prefix(content_type, b"application/x-www-form-urlencoded")
    }
}

impl fmt::Display for RequestCurlFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let request = self.request;
        if enable_ansi_colors_stderr() {
            f.write_str(pretty_fmt!("<r><d>[fetch] $<r> ", true))?;

            write!(
                f,
                pretty_fmt!("<b><cyan>curl<r> <d>--http1.1<r> <b>\"{}\"<r>", true),
                BStr::new(request.path),
            )?;
        } else {
            write!(f, "curl --http1.1 \"{}\"", BStr::new(request.path))?;
        }

        if request.method != b"GET" {
            write!(f, " -X {}", BStr::new(request.method))?;
        }

        if self.ignore_insecure {
            f.write_str(" -k")?;
        }

        let mut content_type: &[u8] = b"";

        for header in request.headers {
            f.write_str(" ")?;
            if content_type.is_empty() {
                if strings::eql_case_insensitive_ascii(b"content-type", header.name(), true) {
                    content_type = header.value();
                }
            }

            write!(f, "{}", header.curl())?;

            if strings::eql_case_insensitive_ascii(b"accept-encoding", header.name(), true) {
                f.write_str(" --compressed")?;
            }
        }

        if !self.body.is_empty() && Self::is_printable_body(content_type) {
            f.write_str(" --data-raw ")?;
            // Zig: bun.js_printer.writeJSONString — bun_core re-exports the
            // tier-0 minimal impl as `js_printer::write_json_string`; the full
            // encoding-aware printer in bun_js_printer overrides at link time.
            bun_core::js_printer::write_json_string(self.body, f, bun_core::strings::Encoding::Utf8)?;
        }

        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StatusCodeFormatter
// ──────────────────────────────────────────────────────────────────────────

struct StatusCodeFormatter {
    code: usize,
}

impl fmt::Display for StatusCodeFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if enable_ansi_colors_stderr() {
            match self.code {
                101 | 200..=299 => write!(f, pretty_fmt!("<r><green>{}<r>", true), self.code),
                300..=399 => write!(f, pretty_fmt!("<r><yellow>{}<r>", true), self.code),
                _ => write!(f, pretty_fmt!("<r><red>{}<r>", true), self.code),
            }
        } else {
            write!(f, "{}", self.code)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Response
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, strum::IntoStaticStr)]
pub enum ParseResponseError {
    Malformed_HTTP_Response,
    ShortRead,
}
impl fmt::Display for ParseResponseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(<&'static str>::from(self))
    }
}
impl std::error::Error for ParseResponseError {}
impl From<ParseResponseError> for bun_core::Error {
    fn from(e: ParseResponseError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

#[derive(Clone, Copy)]
pub struct Response<'a> {
    pub minor_version: usize,
    pub status_code: u32,
    pub status: &'a [u8],
    pub headers: HeaderList<'a>,
    pub bytes_read: c_int,
}

impl<'a> Default for Response<'a> {
    fn default() -> Self {
        Response {
            minor_version: 0,
            status_code: 0,
            status: b"",
            headers: HeaderList::default(),
            bytes_read: 0,
        }
    }
}

impl<'a> Response<'a> {
    pub fn count(&self, builder: &mut StringBuilder) {
        builder.count(self.status);

        for header in self.headers.list {
            header.count(builder);
        }
    }

    pub fn clone(&self, headers: &'a mut [Header], builder: &mut StringBuilder) -> Response<'a> {
        let mut that = *self;
        that.status = builder.append(self.status);

        for (i, header) in self.headers.list.iter().enumerate() {
            headers[i] = header.clone(builder);
        }

        that.headers.list = &headers[0..self.headers.list.len()];

        that
    }

    pub fn parse_parts(
        buf: &'a [u8],
        src: &'a mut [Header],
        offset: Option<&mut usize>,
    ) -> Result<Response<'a>, ParseResponseError> {
        let mut minor_version: c_int = 1;
        let mut status_code: c_int = 0;
        let mut status_ptr: *const u8 = b"".as_ptr();
        let mut status_len: usize = 0;
        let mut num_headers: usize = src.len();

        let offset = offset.unwrap();

        // SAFETY: src is layout-compatible with phr_header (asserted above);
        // out-params are valid for write.
        let rc = unsafe {
            c::phr_parse_response(
                buf.as_ptr(),
                buf.len(),
                &mut minor_version,
                &mut status_code,
                &mut status_ptr as *mut *const u8 as *mut *const core::ffi::c_char,
                &mut status_len,
                src.as_mut_ptr().cast::<c::phr_header>(),
                &mut num_headers,
                *offset,
            )
        };

        match rc {
            -1 => {
                // NOTE: `bun_core::debug!` macro is currently broken (it forwards
                // `concat!(...)` into `pretty_errorln!` whose matcher is `$fmt:literal`).
                // Use the function-form `output::debug` until the macro is fixed.
                Output::debug(&format_args!("Malformed HTTP response:\n{}", BStr::new(buf)));
                Err(ParseResponseError::Malformed_HTTP_Response)
            }
            -2 => {
                *offset += buf.len();
                Err(ParseResponseError::ShortRead)
            }
            _ => Ok(Response {
                minor_version: usize::try_from(minor_version).expect("int cast"),
                status_code: u32::try_from(status_code).expect("int cast"),
                // SAFETY: on success, ptr/len point into `buf`.
                status: unsafe { core::slice::from_raw_parts(status_ptr, status_len) },
                headers: HeaderList { list: &src[0..num_headers.min(src.len())] },
                bytes_read: rc,
            }),
        }
    }

    pub fn parse(buf: &'a [u8], src: &'a mut [Header]) -> Result<Response<'a>, ParseResponseError> {
        let mut offset: usize = 0;
        let response = Self::parse_parts(buf, src, Some(&mut offset))?;
        Ok(response)
    }
}

impl fmt::Display for Response<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if enable_ansi_colors_stderr() {
            f.write_str(pretty_fmt!("<r><d>[fetch]<r> ", true))?;
        }

        write!(
            f,
            "< {} {}\n",
            StatusCodeFormatter { code: self.status_code as usize },
            BStr::new(self.status),
        )?;
        for header in self.headers.list {
            if enable_ansi_colors_stderr() {
                f.write_str(pretty_fmt!("<r><d>[fetch]<r> ", true))?;
            }

            f.write_str("< ")?;
            write!(f, "{}\n", header)?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Headers
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, strum::IntoStaticStr)]
pub enum ParseHeadersError {
    BadHeaders,
    ShortRead,
}
impl fmt::Display for ParseHeadersError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(<&'static str>::from(self))
    }
}
impl std::error::Error for ParseHeadersError {}
impl From<ParseHeadersError> for bun_core::Error {
    fn from(e: ParseHeadersError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

pub struct Headers<'a> {
    pub headers: &'a [Header],
}

impl<'a> Headers<'a> {
    pub fn parse(buf: &'a [u8], src: &'a mut [Header]) -> Result<Headers<'a>, ParseHeadersError> {
        let mut num_headers: usize = src.len();

        // SAFETY: src is layout-compatible with phr_header (asserted above).
        let rc = unsafe {
            c::phr_parse_headers(
                buf.as_ptr(),
                buf.len(),
                src.as_mut_ptr().cast::<c::phr_header>(),
                &mut num_headers as *mut usize,
                0,
            )
        };

        match rc {
            -1 => Err(ParseHeadersError::BadHeaders),
            -2 => Err(ParseHeadersError::ShortRead),
            _ => Ok(Headers { headers: &src[0..num_headers] }),
        }
    }
}

impl fmt::Display for Headers<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for header in self.headers {
            write!(f, "{}: {}\r\n", BStr::new(header.name()), BStr::new(header.value()))?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from picohttp_sys
// ──────────────────────────────────────────────────────────────────────────

pub use c::phr_header;
pub use c::phr_chunked_decoder;
pub use c::struct_phr_header;
pub use c::struct_phr_chunked_decoder;
pub use c::phr_parse_request;
pub use c::phr_parse_response;
pub use c::phr_parse_headers;
pub use c::phr_decode_chunked;
pub use c::phr_decode_chunked_is_in_data;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/picohttp/picohttp.zig (386 lines)
//   confidence: medium
//   todos:      0
//   notes:      Header is #[repr(C)] ptr+len (must match phr_header); Request/Response/Headers carry <'a> borrowing the input buffer; pretty_fmt! is bun_core's passthrough stub until proc-macro lands; debug! call uses output::debug fn-form (macro-form broken upstream).
// ──────────────────────────────────────────────────────────────────────────
