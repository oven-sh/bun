use bun_picohttp as picohttp;
use bun_core::strings;

// `bun.schema.api.StringPointer` lives in bun_http_types (inlined there to
// avoid a cross-tier dep on options_types). Same #[repr(C)] u32×2 layout.
// Public: downstream crates (e.g. bun_install::NetworkTask) build raw `Entry`
// records and need the field type — mirrors `bun.schema.api.StringPointer`.
pub mod api {
    pub use bun_http_types::ETag::StringPointer;
}

// TYPE_ONLY moved-in: `bun_http_types::Method::HeaderName` is the `#[repr(u8)]`
// enum mirroring WebCore's `HTTPHeaderNames.in` (same discriminants as
// `bun_jsc::HTTPHeaderName`). Re-export for the `FetchHeadersVTable::fast_has`
// signature so vtable impls can forward the discriminant straight to
// `WebCore__FetchHeaders__fastHas_`.
pub use bun_http_types::Method::HeaderName;

// ──────────────────────── cycle-break vtables ────────────────────────
// `FetchHeaders` and `blob::Any` live in bun_runtime (T6); http is T5. The
// only consumer here is `Headers::from()`, called by higher-tier code that
// owns the concrete types. Per CYCLEBREAK §Dispatch (cold path), expose a
// manual vtable; bun_runtime provides the static instances.
// PERF(port): was inline switch / direct call.

pub struct FetchHeadersVTable {
    pub count: unsafe fn(owner: *const (), header_count: &mut u32, buf_len: &mut u32),
    pub fast_has: unsafe fn(owner: *const (), name: HeaderName) -> bool,
    pub copy_to: unsafe fn(
        owner: *const (),
        names: *mut api::StringPointer,
        values: *mut api::StringPointer,
        buf: *mut u8,
    ),
}

#[derive(Clone, Copy)]
pub struct FetchHeadersRef<'a> {
    pub owner: *const (),
    pub vtable: &'static FetchHeadersVTable,
    pub _phantom: core::marker::PhantomData<&'a ()>,
}

impl<'a> FetchHeadersRef<'a> {
    #[inline]
    pub fn count(&self, header_count: &mut u32, buf_len: &mut u32) {
        unsafe { (self.vtable.count)(self.owner, header_count, buf_len) }
    }
    #[inline]
    pub fn fast_has(&self, name: HeaderName) -> bool {
        unsafe { (self.vtable.fast_has)(self.owner, name) }
    }
    #[inline]
    pub fn copy_to(
        &self,
        names: *mut api::StringPointer,
        values: *mut api::StringPointer,
        buf: *mut u8,
    ) {
        unsafe { (self.vtable.copy_to)(self.owner, names, values, buf) }
    }
}

pub struct AnyBlobVTable {
    pub has_content_type_from_user: unsafe fn(owner: *const ()) -> bool,
    /// Returns a borrow valid for the lifetime of `owner`.
    pub content_type: unsafe fn(owner: *const ()) -> (*const u8, usize),
}

#[derive(Clone, Copy)]
pub struct AnyBlobRef<'a> {
    pub owner: *const (),
    pub vtable: &'static AnyBlobVTable,
    pub _phantom: core::marker::PhantomData<&'a ()>,
}

impl<'a> AnyBlobRef<'a> {
    #[inline]
    pub fn has_content_type_from_user(&self) -> bool {
        unsafe { (self.vtable.has_content_type_from_user)(self.owner) }
    }
    #[inline]
    pub fn content_type(&self) -> &'a [u8] {
        unsafe {
            let (ptr, len) = (self.vtable.content_type)(self.owner);
            core::slice::from_raw_parts(ptr, len)
        }
    }
}

// PORT NOTE: `Entry` + its `MultiArrayElement` impl live in bun_http_types
// (T3) because the column layout is shared with ETag matching. Re-export
// here so callers can keep writing `headers::Entry` / `headers::EntryList`.
pub use bun_http_types::ETag::{HeaderEntry as Entry, HeaderEntryList as EntryList};
use bun_http_types::ETag::HeaderEntryField;

#[derive(Default)]
pub struct Headers {
    pub entries: EntryList,
    pub buf: Vec<u8>,
    // PORT NOTE: Zig stored `allocator: std.mem.Allocator`; non-AST crate → global mimalloc, field dropped.
}

impl Headers {
    pub fn memory_cost(&self) -> usize {
        self.buf.len() + self.entries.memory_cost()
    }

    // PORT NOTE: `pub const toFetchHeaders = @import("../http_jsc/headers_jsc.zig").toFetchHeaders;`
    // deleted — to_fetch_headers lives as an extension-trait method in bun_http_jsc.

    pub fn get(&self, name: &[u8]) -> Option<&[u8]> {
        // PORT NOTE: Zig used `.items(.name)` / `.items(.value)` column slices.
        // The Rust `MultiArrayList` lacks typed column accessors yet, so iterate
        // by index via `.get(i)` (gathers both fields; same result, slightly
        // more loads). // PERF(port): was column-slice iteration.
        for i in 0..self.entries.len() {
            let entry = self.entries.get(i);
            if strings::eql_case_insensitive_ascii(self.as_str(entry.name), name, true) {
                return Some(self.as_str(entry.value));
            }
        }
        None
    }

    // PORT NOTE: was `!void`; only `try` sites were allocations — Vec/MultiArrayList abort on OOM.
    pub fn append(&mut self, name: &[u8], value: &[u8]) {
        let mut offset: u32 = self.buf.len() as u32;
        self.buf.reserve(name.len() + value.len());
        let name_ptr = api::StringPointer {
            offset,
            length: name.len() as u32,
        };
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        self.buf.extend_from_slice(name);
        offset = self.buf.len() as u32;
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        self.buf.extend_from_slice(value);

        let value_ptr = api::StringPointer {
            offset,
            length: value.len() as u32,
        };
        self.entries
            .append(Entry { name: name_ptr, value: value_ptr })
            .expect("OOM"); // Zig: `try` propagated to bun.handleOom — crash on OOM, don't drop.
    }

    pub fn get_content_disposition(&self) -> Option<&[u8]> {
        self.get(b"content-disposition")
    }
    pub fn get_content_encoding(&self) -> Option<&[u8]> {
        self.get(b"content-encoding")
    }
    pub fn get_content_type(&self) -> Option<&[u8]> {
        self.get(b"content-type")
    }
    pub fn as_str(&self, ptr: api::StringPointer) -> &[u8] {
        if (ptr.offset + ptr.length) as usize <= self.buf.len() {
            &self.buf[ptr.offset as usize..][..ptr.length as usize]
        } else {
            b""
        }
    }

    // PORT NOTE: was `!Headers`; all fallible calls were bun.handleOom-wrapped allocations.
    pub fn from_pico_http_headers(headers: &[picohttp::Header]) -> Headers {
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
            offset += name.len() as u32;
            let value_offset = offset;
            result.buf[offset as usize..][..value.len()].copy_from_slice(value);
            offset += value.len() as u32;

            // PORT NOTE: Zig pre-set `entries.len = headers.len` then `set(i, ..)`.
            // Rust `MultiArrayList` lacks `set_len`; capacity was reserved above
            // so use `append_assume_capacity` which is equivalent.
            result.entries.append_assume_capacity(Entry {
                name: api::StringPointer {
                    offset: name_offset,
                    length: name.len() as u32,
                },
                value: api::StringPointer {
                    offset: value_offset,
                    length: value.len() as u32,
                },
            });
        }
        result
    }

    // PORT NOTE: was `!Headers`; all fallible calls were bun.handleOom-wrapped allocations.
    pub fn from(fetch_headers_ref: Option<FetchHeadersRef<'_>>, options: Options<'_>) -> Headers {
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
                    buf_len += (body.content_type().len() + b"Content-Type".len()) as u32;
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
            unsafe { sliced.items_raw::<api::StringPointer>(HeaderEntryField::Name) };
        let values_ptr: *mut api::StringPointer =
            unsafe { sliced.items_raw::<api::StringPointer>(HeaderEntryField::Value) };
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
                    length: ct.len() as u32,
                };
            }

            let body_ct = options.body.unwrap().content_type();
            headers.buf[buf_len_before_content_type as usize + ct.len()..][..body_ct.len()]
                .copy_from_slice(body_ct);
            // SAFETY: see above.
            unsafe {
                *values_ptr.add(header_count as usize - 1) = api::StringPointer {
                    offset: buf_len_before_content_type + ct.len() as u32,
                    length: options.body.unwrap().content_type().len() as u32,
                };
            }
        }

        headers
    }
}

impl Clone for Headers {
    fn clone(&self) -> Self {
        Headers {
            // PORT NOTE: MultiArrayList::clone is fallible (Result<_, AllocError>);
            // Zig used `bun.handleOom(self.entries.clone(allocator))`.
            entries: self.entries.clone().unwrap_or_else(|_| bun_alloc::out_of_memory()),
            buf: self.buf.clone(),
        }
    }
}

// PORT NOTE: `pub fn deinit` only freed `entries` and `buf`; both are Drop types now — no explicit Drop impl needed.

pub struct Options<'a> {
    pub body: Option<AnyBlobRef<'a>>,
}

impl<'a> Default for Options<'a> {
    fn default() -> Self {
        Self { body: None }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/Headers.zig (182 lines)
//   confidence: medium
//   todos:      4
//   notes:      MultiArrayList<Entry> column-accessor API (set_len/items_*/dual-mut) is assumed; FetchHeaders HeaderName enum path needs verification; allocator field dropped (non-AST crate).
// ──────────────────────────────────────────────────────────────────────────
