use core::ffi::c_int;
use core::fmt;

use bstr::BStr;

use bun_core::output as Output;
use bun_core::StringBuilder;
use bun_picohttp_sys as c;
use bun_str::strings;

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

impl Header {
    #[inline]
    pub fn name(&self) -> &[u8] {
        // SAFETY: ptr/len originate from picohttpparser pointing into the
        // caller-provided buffer, or from StringBuilder::append.
        unsafe { core::slice::from_raw_parts(self.name_ptr, self.name_len) }
    }

    #[inline]
    pub fn value(&self) -> &[u8] {
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
        // TODO(port): Output::pretty_fmt! is the comptime ANSI-tag expander
        // (`<r><cyan>` → escape codes). Phase B must provide this macro.
        if Output::enable_ansi_colors_stderr() {
            if self.is_multiline() {
                write!(f, Output::pretty_fmt!("<r><cyan>{}", true), BStr::new(self.value()))
            } else {
                write!(
                    f,
                    Output::pretty_fmt!("<r><cyan>{}<r><d>: <r>{}", true),
                    BStr::new(self.name()),
                    BStr::new(self.value()),
                )
            }
        } else {
            if self.is_multiline() {
                write!(f, Output::pretty_fmt!("<r><cyan>{}", false), BStr::new(self.value()))
            } else {
                write!(
                    f,
                    Output::pretty_fmt!("<r><cyan>{}<r><d>: <r>{}", false),
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

    pub fn get_if_other_is_absent(&self, name: &[u8], other: &[u8]) -> Option<&'a [u8]> {
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

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ParseRequestError {
    #[error("BadRequest")]
    BadRequest,
    #[error("ShortRead")]
    ShortRead,
}
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
                minor_version: usize::try_from(minor_version).unwrap(),
                headers: &src[0..num_headers],
                bytes_read: u32::try_from(rc).unwrap(),
            }),
        }
    }
}

impl fmt::Display for Request<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if Output::enable_ansi_colors_stderr() {
            f.write_str(Output::pretty_fmt!("<r><d>[fetch]<r> ", true))?;
        }
        write!(f, "> HTTP/1.1 {} {}\n", BStr::new(self.method), BStr::new(self.path))?;
        for header in self.headers {
            if Output::enable_ansi_colors_stderr() {
                f.write_str(Output::pretty_fmt!("<r><d>[fetch]<r> ", true))?;
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
        if Output::enable_ansi_colors_stderr() {
            f.write_str(Output::pretty_fmt!("<r><d>[fetch] $<r> ", true))?;

            write!(
                f,
                Output::pretty_fmt!("<b><cyan>curl<r> <d>--http1.1<r> <b>\"{}\"<r>", true),
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
            // MOVE_DOWN(b0): printer::write_json_string → bun_str (move-in pass
            // lands `printer` module + `Encoding` type in the string crate).
            bun_str::printer::write_json_string(self.body, f, bun_str::Encoding::Utf8)?;
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
        if Output::enable_ansi_colors_stderr() {
            match self.code {
                101 | 200..=299 => write!(f, Output::pretty_fmt!("<r><green>{}<r>", true), self.code),
                300..=399 => write!(f, Output::pretty_fmt!("<r><yellow>{}<r>", true), self.code),
                _ => write!(f, Output::pretty_fmt!("<r><red>{}<r>", true), self.code),
            }
        } else {
            write!(f, "{}", self.code)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Response
// ──────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ParseResponseError {
    #[error("Malformed_HTTP_Response")]
    Malformed_HTTP_Response,
    #[error("ShortRead")]
    ShortRead,
}
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
                #[cfg(debug_assertions)]
                {
                    Output::debug!("Malformed HTTP response:\n{}", BStr::new(buf));
                }
                Err(ParseResponseError::Malformed_HTTP_Response)
            }
            -2 => {
                *offset += buf.len();
                Err(ParseResponseError::ShortRead)
            }
            _ => Ok(Response {
                minor_version: usize::try_from(minor_version).unwrap(),
                status_code: u32::try_from(status_code).unwrap(),
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
        if Output::enable_ansi_colors_stderr() {
            f.write_str(Output::pretty_fmt!("<r><d>[fetch]<r> ", true))?;
        }

        write!(
            f,
            "< {} {}\n",
            StatusCodeFormatter { code: self.status_code as usize },
            BStr::new(self.status),
        )?;
        for header in self.headers.list {
            if Output::enable_ansi_colors_stderr() {
                f.write_str(Output::pretty_fmt!("<r><d>[fetch]<r> ", true))?;
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

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ParseHeadersError {
    #[error("BadHeaders")]
    BadHeaders,
    #[error("ShortRead")]
    ShortRead,
}
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
//   todos:      3
//   notes:      Header is #[repr(C)] ptr+len (must match phr_header); Request/Response/Headers carry <'a> borrowing the input buffer; Output::pretty_fmt! macro and write_json_string adapter needed in Phase B.
// ──────────────────────────────────────────────────────────────────────────
