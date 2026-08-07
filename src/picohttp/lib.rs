//! HTTP/1.x wire types shared by the HTTP client: request/response heads,
//! header lists, the response-head parser and the chunked-body decoder.

#![warn(unused_must_use)]
use core::fmt;

use bstr::BStr;

use bun_core::output::enable_ansi_colors_stderr;
use bun_core::pretty_fmt;

// `Header::clone` / `Response::clone` need the unbound-lifetime `append_raw`
// so they can interleave appends and stash the raw ptr/len pairs. The buffer
// is heap-owned; callers keep the builder (or its moved-out buffer) alive
// while the returned slices are in use.
pub use bun_core::StringBuilder;

mod chunked;
mod parse;

pub use bun_http_types::HeaderName::HeaderName;
pub use chunked::{ChunkedDecoder, ChunkedEncodingError, Decoded};

use bun_core::strings;

// ──────────────────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────────────────

/// A borrowed `name: value` pair. Stored as raw ptr/len rather than `&[u8]`
/// so it can sit in `'static` scratch arrays and be handed to C++ as
/// `PicoHTTPHeader` (bindings.cpp); the backing bytes are owned by whoever
/// built the header (parse buffer, `StringBuilder`, HPACK decode buffer).
///
/// The name is classified against WebCore's well-known set once, at
/// construction, so the HTTP client and `FetchHeaders` can switch on
/// [`Header::well_known`] instead of re-comparing strings.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Header {
    name_ptr: *const u8,
    name_len: usize,
    value_ptr: *const u8,
    value_len: usize,
    /// `HeaderName as u8 + 1`, or 0 when not well-known (so `ZERO` stays
    /// all-zero bytes).
    name_id: u8,
}

const _: () = assert!(
    core::mem::size_of::<Header>() == 40,
    "PicoHTTPHeader in bindings.cpp"
);

impl Default for Header {
    #[inline]
    fn default() -> Self {
        Self::ZERO
    }
}

impl Header {
    /// All-zero sentinel — name/value are empty slices. Used by callers to
    /// initialize fixed-size header arrays before filling them.
    ///
    /// Uses `null()` (not `b"".as_ptr()`) so the const evaluates to all-zero
    /// bytes — `[Header::ZERO; N]` statics land in `.bss` instead of `.data`.
    /// `name()`/`value()` go through `ffi::slice`, which tolerates `(null, 0)`.
    pub const ZERO: Self = Self {
        name_ptr: core::ptr::null(),
        name_len: 0,
        value_ptr: core::ptr::null(),
        value_len: 0,
        name_id: 0,
    };

    /// Construct a `Header` from borrowed name/value slices. The caller is
    /// responsible for keeping the backing storage alive for as long as the
    /// `Header` is read.
    #[inline]
    pub const fn new(name: &[u8], value: &[u8]) -> Self {
        Self {
            name_ptr: name.as_ptr(),
            name_len: name.len(),
            value_ptr: value.as_ptr(),
            value_len: value.len(),
            name_id: match HeaderName::classify(name) {
                Some(known) => known as u8 + 1,
                None => 0,
            },
        }
    }

    #[inline]
    pub const fn well_known(&self) -> Option<HeaderName> {
        HeaderName::from_index(self.name_id.wrapping_sub(1))
    }

    #[inline]
    pub fn name(&self) -> &[u8] {
        // SAFETY: ptr/len came from a live slice in `new`/`clone`, or are the
        // (null, 0) of `ZERO`, which `ffi::slice` tolerates.
        unsafe { bun_core::ffi::slice(self.name_ptr, self.name_len) }
    }

    #[inline]
    pub fn value(&self) -> &[u8] {
        // SAFETY: same as name()
        unsafe { bun_core::ffi::slice(self.value_ptr, self.value_len) }
    }

    pub(crate) fn count(&self, builder: &mut StringBuilder) {
        builder.count(self.name());
        builder.count(self.value());
    }

    pub(crate) fn clone(&self, builder: &mut StringBuilder) -> Header {
        // SAFETY: returned slices alias `builder`'s heap buffer; caller of the
        // outer `clone` keeps the builder (or its moved-out buffer) alive for
        // the lifetime of the cloned `Header` (see the comment on `StringBuilder`).
        let name = unsafe { builder.append_raw(self.name()) };
        // SAFETY: same buffer-lifetime invariant as `name` above.
        let value = unsafe { builder.append_raw(self.value()) };
        Header {
            name_ptr: name.as_ptr(),
            name_len: name.len(),
            value_ptr: value.as_ptr(),
            value_len: value.len(),
            name_id: self.name_id,
        }
    }

    pub(crate) fn curl(&self) -> HeaderCurlFormatter<'_> {
        HeaderCurlFormatter { header: self }
    }
}

impl fmt::Display for Header {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // NOTE: pretty_fmt! is the compile-time ANSI-tag expander (`<r><cyan>` → escape
        // codes).
        if enable_ansi_colors_stderr() {
            write!(
                f,
                pretty_fmt!("<r><cyan>{}<r><d>: <r>{}", true),
                BStr::new(self.name()),
                BStr::new(self.value()),
            )
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

struct HeaderCurlFormatter<'a> {
    header: &'a Header,
}

impl fmt::Display for HeaderCurlFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let header = self.header;
        if header.value_len > 0 {
            write!(
                f,
                "-H \"{}: {}\"",
                BStr::new(header.name()),
                BStr::new(header.value())
            )
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
}

impl<'a> HeaderList<'a> {
    /// First value for a well-known name, by tag rather than string compare.
    #[inline]
    pub fn find(&self, name: HeaderName) -> Option<&'a [u8]> {
        let id = name as u8 + 1;
        self.list
            .iter()
            .find(|h| h.name_id == id)
            .map(Header::value)
    }

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

pub struct Request<'a> {
    pub method: &'a [u8],
    pub path: &'a [u8],
    pub minor_version: usize,
    pub headers: &'a [Header],
}

impl<'a> Request<'a> {
    pub fn curl(&self, ignore_insecure: bool, body: &'a [u8]) -> RequestCurlFormatter<'_> {
        RequestCurlFormatter {
            request: self,
            ignore_insecure,
            body,
        }
    }

    /// Widen the borrowed slices to `'static` for self-referential storage.
    ///
    /// Field-by-field move (no bitwise reinterpret). Used when the request's
    /// `method`/`path`/`headers` borrow thread-local static buffers
    /// (`SHARED_REQUEST_HEADERS_BUF`) or a sibling field on the same
    /// heap-stable owner.
    ///
    /// # Safety
    /// Caller guarantees every borrowed slice outlives the returned value.
    #[inline]
    pub unsafe fn detach_lifetime(self) -> Request<'static> {
        Request {
            // SAFETY: caller contract.
            method: unsafe { &*core::ptr::from_ref::<[u8]>(self.method) },
            // SAFETY: caller contract.
            path: unsafe { &*core::ptr::from_ref::<[u8]>(self.path) },
            minor_version: self.minor_version,
            // SAFETY: caller contract.
            headers: unsafe { &*core::ptr::from_ref::<[Header]>(self.headers) },
        }
    }
}

impl fmt::Display for Request<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if enable_ansi_colors_stderr() {
            f.write_str(pretty_fmt!("<r><d>[fetch]<r> ", true))?;
        }
        writeln!(
            f,
            "> HTTP/1.1 {} {}",
            BStr::new(self.method),
            BStr::new(self.path)
        )?;
        for header in self.headers {
            if enable_ansi_colors_stderr() {
                f.write_str(pretty_fmt!("<r><d>[fetch]<r> ", true))?;
            }
            f.write_str("> ")?;
            writeln!(f, "{}", header)?;
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
            // bun_core re-exports the tier-0 minimal impl as
            // `js_printer::write_json_string`; the full encoding-aware printer
            // in bun_js_printer overrides at link time.
            bun_core::js_printer::write_json_string(
                self.body,
                f,
                bun_core::strings::Encoding::Utf8,
            )?;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ParseResponseError {
    #[strum(serialize = "Malformed_HTTP_Response")]
    MalformedHttpResponse,
    ShortRead,
}
bun_core::impl_tag_error!(ParseResponseError);

#[derive(Clone, Copy)]
pub struct Response<'a> {
    pub minor_version: usize,
    pub status_code: u32,
    pub status: &'a [u8],
    pub headers: HeaderList<'a>,
    /// Length of the response head, including the blank line that ends it.
    pub bytes_read: usize,
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

    pub fn clone<'out>(
        &self,
        headers: &'out mut [Header],
        builder: &mut StringBuilder,
    ) -> Response<'out> {
        for (i, header) in self.headers.list.iter().enumerate() {
            headers[i] = header.clone(builder);
        }
        Response {
            minor_version: self.minor_version,
            status_code: self.status_code,
            // SAFETY: see `Header::clone` — caller keeps `builder` alive.
            status: unsafe { builder.append_raw(self.status) },
            headers: HeaderList {
                list: &headers[0..self.headers.list.len()],
            },
            bytes_read: self.bytes_read,
        }
    }
}

impl fmt::Display for Response<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if enable_ansi_colors_stderr() {
            f.write_str(pretty_fmt!("<r><d>[fetch]<r> ", true))?;
        }

        writeln!(
            f,
            "< {} {}",
            StatusCodeFormatter {
                code: self.status_code as usize
            },
            BStr::new(self.status),
        )?;
        for header in self.headers.list {
            if enable_ansi_colors_stderr() {
                f.write_str(pretty_fmt!("<r><d>[fetch]<r> ", true))?;
            }

            f.write_str("< ")?;
            writeln!(f, "{}", header)?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Headers
// ──────────────────────────────────────────────────────────────────────────

pub struct Headers<'a> {
    pub headers: &'a [Header],
}

impl fmt::Display for Headers<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for header in self.headers {
            write!(
                f,
                "{}: {}\r\n",
                BStr::new(header.name()),
                BStr::new(header.value())
            )?;
        }
        Ok(())
    }
}
