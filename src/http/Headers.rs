use bun_collections::MultiArrayList;
use bun_picohttp as picohttp;
use bun_schema::api;
use bun_str::strings;

// TODO(b0): HeaderName arrives in bun_http_types via move-in (TYPE_ONLY from
// bun_runtime::webcore::fetch_headers::HeaderName)
use bun_http_types::HeaderName;

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

#[derive(Clone, Copy)]
pub struct Entry {
    pub name: api::StringPointer,
    pub value: api::StringPointer,
}

pub type EntryList = MultiArrayList<Entry>;

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
        let entries = self.entries.slice();
        // TODO(port): MultiArrayList<Entry> column accessors — assuming .items_name()/.items_value()
        let names = entries.items_name();
        let values = entries.items_value();
        for (i, name_ptr) in names.iter().enumerate() {
            if strings::eql_case_insensitive_ascii(self.as_str(*name_ptr), name, true) {
                return Some(self.as_str(values[i]));
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
        self.entries.append(Entry {
            name: name_ptr,
            value: value_ptr,
        });
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
            buf_len += header.name.len() + header.value.len();
        }
        result.entries.ensure_total_capacity(header_count);
        // TODO(port): MultiArrayList::set_len — Zig wrote `result.entries.len = headers.len`
        result.entries.set_len(headers.len());
        result.buf.reserve_exact(buf_len);
        // SAFETY: capacity reserved above; bytes are fully initialized by the copy loop below.
        unsafe { result.buf.set_len(buf_len) };
        let mut offset: u32 = 0;
        for (i, header) in headers.iter().enumerate() {
            let name_offset = offset;
            result.buf[offset as usize..][..header.name.len()].copy_from_slice(&header.name);
            offset += header.name.len() as u32;
            let value_offset = offset;
            result.buf[offset as usize..][..header.value.len()].copy_from_slice(&header.value);
            offset += header.value.len() as u32;

            result.entries.set(i, Entry {
                name: api::StringPointer {
                    offset: name_offset,
                    length: header.name.len() as u32,
                },
                value: api::StringPointer {
                    offset: value_offset,
                    length: header.value.len() as u32,
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
        headers.entries.ensure_total_capacity(header_count as usize);
        // TODO(port): MultiArrayList::set_len — Zig wrote `headers.entries.len = header_count`
        headers.entries.set_len(header_count as usize);
        headers.buf.reserve_exact(buf_len as usize);
        // SAFETY: capacity reserved above; bytes are fully initialized by copyTo / the copy below.
        unsafe { headers.buf.set_len(buf_len as usize) };
        // PORT NOTE: reshaped for borrowck — Zig took two column slices off one `sliced` view.
        // TODO(port): MultiArrayList API for simultaneous mutable column access
        let mut sliced = headers.entries.slice_mut();
        let (names, values) = sliced.items_name_value_mut();
        if let Some(headers_ref) = fetch_headers_ref {
            headers_ref.copy_to(names.as_mut_ptr(), values.as_mut_ptr(), headers.buf.as_mut_ptr());
        }

        // TODO: maybe we should send Content-Type header first instead of last?
        if needs_content_type {
            let ct = b"Content-Type";
            headers.buf[buf_len_before_content_type as usize..][..ct.len()].copy_from_slice(ct);
            names[header_count as usize - 1] = api::StringPointer {
                offset: buf_len_before_content_type,
                length: ct.len() as u32,
            };

            let body_ct = options.body.unwrap().content_type();
            headers.buf[buf_len_before_content_type as usize + ct.len()..][..body_ct.len()]
                .copy_from_slice(body_ct);
            values[header_count as usize - 1] = api::StringPointer {
                offset: buf_len_before_content_type + ct.len() as u32,
                length: options.body.unwrap().content_type().len() as u32,
            };
        }

        headers
    }
}

impl Clone for Headers {
    fn clone(&self) -> Self {
        Headers {
            entries: self.entries.clone(),
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
