use bun_picohttp as picohttp;

// `bun.schema.api.StringPointer` — canonical type is `bun_core::StringPointer`;
// `bun_http_types` re-exports it. Public: downstream crates (e.g.
// bun_install::NetworkTask) build raw `Entry` records and need the field type.
pub mod api {
    pub use bun_http_types::ETag::StringPointer;
}

// TYPE_ONLY moved-in: `bun_http_types::Method::HeaderName` is the `#[repr(u8)]`
// enum mirroring WebCore's `HTTPHeaderNames.in` (same discriminants as
// `bun_jsc::HTTPHeaderName`). Re-export for the `FetchHeadersRef::fast_has`
// signature so impls can forward the discriminant straight to
// `WebCore__FetchHeaders__fastHas_`.
pub use bun_http_types::Method::HeaderName;

pub use crate::{AnyBlobRef, FetchHeadersRef};

// LAYERING: `Headers` (and its tier-safe inherent methods: `memory_cost`,
// `get`, `append`, `get_content_*`, `as_str`, `Clone`) is owned by
// `bun_http_types` (T3) so the ETag matcher and bake DevServer can name the
// same type. This crate adds the constructors that pull in T5 deps
// (`picohttp`, `FetchHeadersRef`).
pub use bun_http_types::ETag::{HeaderEntry as Entry, HeaderEntryList as EntryList, Headers};


// PORT NOTE: `pub const toFetchHeaders = @import("../http_jsc/headers_jsc.zig").toFetchHeaders;`
// deleted — to_fetch_headers lives as an extension-trait method in bun_http_jsc.

/// Extension constructors for `Headers` that depend on T5 crates
/// (`bun_picohttp`, the FetchHeaders/Blob vtables). Kept as a trait so
/// callers can keep writing `Headers::from(...)`.
pub trait HeadersExt {
    fn from_pico_http_headers(headers: &[picohttp::Header]) -> Headers;
    fn from(fetch_headers_ref: Option<FetchHeadersRef>, options: Options) -> Headers;
}

impl HeadersExt for Headers {
    // PORT NOTE: was `!Headers`; all fallible calls were bun.handleOom-wrapped allocations.
    fn from_pico_http_headers(headers: &[picohttp::Header]) -> Headers {
        let header_count = headers.len();
        let mut result = Headers {
            entries: EntryList::default(),
            buf: Vec::new(),
        };

        let mut buf_len: usize = 0;
        for header in headers {
            buf_len += header.name().len() + header.value().len();
        }
        result.entries.ensure_total_capacity(header_count).expect("OOM"); // Zig: bun.handleOom
        result.buf.reserve_exact(buf_len);
        // SAFETY: capacity reserved above; bytes are fully initialized by the copy loop below.
        unsafe { result.buf.set_len(buf_len) };
        let mut offset: u32 = 0;
        for header in headers {
            let name = header.name();
            let value = header.value();
            let name_offset = offset;
            result.buf[offset as usize..][..name.len()].copy_from_slice(name);
            offset += u32::try_from(name.len()).unwrap();
            let value_offset = offset;
            result.buf[offset as usize..][..value.len()].copy_from_slice(value);
            offset += u32::try_from(value.len()).unwrap();

            // PORT NOTE: Zig pre-set `entries.len = headers.len` then `set(i, ..)`.
            // Rust `MultiArrayList` lacks `set_len`; capacity was reserved above
            // so use `append_assume_capacity` which is equivalent.
            result.entries.append_assume_capacity(Entry {
                name: api::StringPointer {
                    offset: name_offset,
                    length: u32::try_from(name.len()).unwrap(),
                },
                value: api::StringPointer {
                    offset: value_offset,
                    length: u32::try_from(value.len()).unwrap(),
                },
            });
        }
        result
    }

    // PORT NOTE: was `!Headers`; all fallible calls were bun.handleOom-wrapped allocations.
    fn from(fetch_headers_ref: Option<FetchHeadersRef>, options: Options) -> Headers {
        let mut header_count: u32 = 0;
        let mut buf_len: u32 = 0;
        if let Some(headers_ref) = fetch_headers_ref {
            headers_ref.count(&mut header_count, &mut buf_len);
        }
        let mut headers = Headers {
            entries: EntryList::default(),
            buf: Vec::new(),
        };
        let buf_len_before_content_type = buf_len;
        let needs_content_type = 'brk: {
            if let Some(body) = options.body {
                if body.has_content_type_from_user()
                    && (fetch_headers_ref.is_none()
                        || !fetch_headers_ref.as_ref().unwrap().fast_has(HeaderName::ContentType))
                {
                    header_count += 1;
                    buf_len += u32::try_from(body.content_type().len() + b"Content-Type".len()).unwrap();
                    break 'brk true;
                }
            }
            false
        };
        if headers.entries.ensure_total_capacity(header_count as usize).is_err() {
            bun_alloc::out_of_memory();
        }
        // SAFETY: capacity reserved above; columns are `StringPointer` (POD) and fully
        // overwritten by `copy_to` / the explicit writes below before any read.
        unsafe { headers.entries.set_len(header_count as usize) };
        headers.buf.reserve_exact(buf_len as usize);
        // SAFETY: capacity reserved above; bytes are fully initialized by copyTo / the copy below.
        unsafe { headers.buf.set_len(buf_len as usize) };
        // PORT NOTE: reshaped for borrowck — Zig took two column slices off one `sliced` view.
        // The Rust `Slice::items` returns `&mut [F]` from `&self`; the two columns are
        // disjoint allocations so simultaneous access is sound, but borrowck can't see
        // that. Take raw column pointers up front and slice in scoped blocks.
        let sliced = headers.entries.slice();
        // SAFETY: `Name`/`Value` columns are both `StringPointer`; `Slice::items_raw`
        // contract is satisfied. Disjoint backing memory ⇒ no aliasing.
        let names_ptr: *mut api::StringPointer =
            unsafe { sliced.items_raw::<"name", api::StringPointer>() };
        let values_ptr: *mut api::StringPointer =
            unsafe { sliced.items_raw::<"value", api::StringPointer>() };
        if let Some(headers_ref) = fetch_headers_ref {
            headers_ref.copy_to(names_ptr, values_ptr, headers.buf.as_mut_ptr());
        }

        // TODO: maybe we should send Content-Type header first instead of last?
        if needs_content_type {
            let ct = b"Content-Type";
            headers.buf[buf_len_before_content_type as usize..][..ct.len()].copy_from_slice(ct);
            // SAFETY: header_count >= 1 (incremented above); names_ptr points to a
            // live column of `header_count` slots.
            unsafe {
                *names_ptr.add(header_count as usize - 1) = api::StringPointer {
                    offset: buf_len_before_content_type,
                    length: u32::try_from(ct.len()).unwrap(),
                };
            }

            let body_ct = options.body.unwrap().content_type();
            headers.buf[buf_len_before_content_type as usize + ct.len()..][..body_ct.len()]
                .copy_from_slice(body_ct);
            // SAFETY: see above.
            unsafe {
                *values_ptr.add(header_count as usize - 1) = api::StringPointer {
                    offset: buf_len_before_content_type + u32::try_from(ct.len()).unwrap(),
                    length: u32::try_from(options.body.unwrap().content_type().len()).unwrap(),
                };
            }
        }

        headers
    }
}

// PORT NOTE: `pub fn deinit` only freed `entries` and `buf`; both are Drop types now — no explicit Drop impl needed.

/// Compute the ETag for `bytes` (xxhash64, hex-lowered, quoted) and append it as
/// an `etag` header. Re-exported from `bun_http_types` now that `Headers` is
/// the same type in both crates.
#[inline]
pub fn append_etag(bytes: &[u8], headers: &mut Headers) {
    let _ = bun_http_types::ETag::append_to_headers(bytes, headers);
}

#[derive(Default)]
pub struct Options {
    pub body: Option<AnyBlobRef>,
}

// ported from: src/http/Headers.zig
