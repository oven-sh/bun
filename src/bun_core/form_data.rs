// ── form_data ─────────────────────────────────────────────────────────────
// Port of `bun.FormData.{Encoding, AsyncFormData, getBoundary}` (src/runtime/
// webcore/FormData.zig:16-95). The JSC-touching parts (`toJS`, the field map,
// multipart parser) stay in `bun_runtime::webcore::form_data`; T0 owns only
// the encoding-detection types so `Request`/`Response`/`Body` can name them
// without a runtime→core cycle. Per PORTING.md §JSC: `to_js` is an extension
// method that lives in the higher-tier crate.
/// `FormData.Encoding` — `union(enum) { URLEncoded, Multipart: []const u8 }`.
/// `Multipart` owns its boundary (Zig `AsyncFormData.init` duped it; here
/// the Box moves in directly).
#[derive(Debug)]
pub enum Encoding {
    URLEncoded,
    /// boundary
    Multipart(Box<[u8]>),
}

impl Encoding {
    pub fn get(content_type: &[u8]) -> Option<Encoding> {
        if crate::strings_impl::includes(content_type, b"application/x-www-form-urlencoded") {
            return Some(Encoding::URLEncoded);
        }
        if !crate::strings_impl::includes(content_type, b"multipart/form-data") {
            return None;
        }
        let boundary = get_boundary(content_type)?;
        Some(Encoding::Multipart(Box::from(boundary)))
    }
}

/// `FormData.getBoundary` — borrow the `boundary=` value out of a
/// `Content-Type` header. Returns `None` on malformed quoting.
pub fn get_boundary(content_type: &[u8]) -> Option<&[u8]> {
    let idx = ::bstr::ByteSlice::find(content_type, b"boundary=")?;
    let begin = &content_type[idx + b"boundary=".len()..];
    if begin.is_empty() {
        return None;
    }
    let end = crate::strings_impl::index_of_char(begin, b';').unwrap_or(begin.len());
    if begin[0] == b'"' {
        if end > 1 && begin[end - 1] == b'"' {
            return Some(&begin[1..end - 1]);
        }
        // Opening quote with no matching closing quote — malformed.
        return None;
    }
    Some(&begin[..end])
}

/// `FormData.AsyncFormData` — heap-allocated, owns its `Encoding`.
/// PORT NOTE: Zig stored `std.mem.Allocator param`; deleted (non-AST
/// crate, global mimalloc per §Allocators). `deinit` becomes `Drop` on the
/// `Box`/`Box<[u8]>` fields — no explicit impl needed.
#[derive(Debug)]
pub struct AsyncFormData {
    pub encoding: Encoding,
}

impl AsyncFormData {
    #[inline]
    pub fn init(encoding: Encoding) -> Box<AsyncFormData> {
        // Zig duped `encoding.Multipart` here so the struct owned its
        // boundary; with `Box<[u8]>` ownership has already transferred.
        Box::new(AsyncFormData { encoding })
    }
}
