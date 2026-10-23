use core::ffi::{c_uint, c_void};

#[repr(C)]
struct lshpack_header {
    name: *const u8,
    name_len: usize,
    value: *const u8,
    value_len: usize,
    never_index: bool,
}

impl Default for lshpack_header {
    fn default() -> Self {
        Self {
            name: core::ptr::null(),
            name_len: 0,
            value: core::ptr::null(),
            value_len: 0,
            never_index: false,
        }
    }
}

/// wrapper implemented at src/jsc/bindings/c-bindings.cpp
#[repr(C)]
pub struct HPACK {
    self_: *mut c_void,
}

pub struct DecodeResult<'a> {
    pub name: &'a [u8],
    pub value: &'a [u8],
    pub never_index: bool,
    /// offset of the next header position in src
    pub next: usize,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum HpackError {
    #[error("UnableToDecode")]
    UnableToDecode,
    #[error("EmptyHeaderName")]
    EmptyHeaderName,
    #[error("UnableToEncode")]
    UnableToEncode,
}

/// The fields of one outbound header block, staged for [`HPACK::encode_block`].
#[derive(Default)]
pub struct HeaderBlock {
    /// Each name followed by its value, in field order.
    bytes: Vec<u8>,
    /// Two entries per field: the name length with `never_index` in bit 31, then the value length.
    fields: Vec<u32>,
}

impl HeaderBlock {
    const NEVER_INDEX: u32 = 1 << 31;

    pub fn push(
        &mut self,
        name: &[u8],
        value: &[u8],
        never_index: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        // Treat a length that overflows its entry like a failed allocation.
        let (Ok(name_len), Ok(value_len)) = (u32::try_from(name.len()), u32::try_from(value.len()))
        else {
            return Err(bun_alloc::AllocError);
        };
        if name_len >= Self::NEVER_INDEX {
            return Err(bun_alloc::AllocError);
        }
        self.bytes
            .try_reserve(name.len() + value.len())
            .map_err(|_| bun_alloc::AllocError)?;
        self.fields
            .try_reserve(2)
            .map_err(|_| bun_alloc::AllocError)?;
        self.bytes.extend_from_slice(name);
        self.bytes.extend_from_slice(value);
        self.fields.push(if never_index {
            name_len | Self::NEVER_INDEX
        } else {
            name_len
        });
        self.fields.push(value_len);
        Ok(())
    }

    pub fn clear(&mut self) {
        self.bytes.clear();
        self.fields.clear();
    }

    /// Value of the first field named `name`.
    pub fn get(&self, name: &[u8]) -> Option<&[u8]> {
        let mut rest = self.bytes.as_slice();
        for &[name_len, value_len] in self.fields.as_chunks::<2>().0 {
            let (field_name, after_name) = rest.split_at((name_len & !Self::NEVER_INDEX) as usize);
            let (value, after_value) = after_name.split_at(value_len as usize);
            if field_name == name {
                return Some(value);
            }
            rest = after_value;
        }
        None
    }

    /// Number of fields.
    pub fn len(&self) -> usize {
        self.fields.len() / 2
    }

    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }

    /// Heap bytes retained after `clear()`.
    pub fn capacity(&self) -> usize {
        self.bytes.capacity() + self.fields.capacity() * core::mem::size_of::<u32>()
    }

    /// https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_hd.c#L1578-L1603
    pub fn deflate_bound(&self) -> usize {
        12 + 12 * self.len() + self.bytes.len()
    }

    /// Upper bound of the encoded size.
    pub fn encode_bound(&self) -> usize {
        self.bytes.len() + 32 * self.len()
    }
}

impl HPACK {
    /// `name` and `value` point into a thread-local buffer that every `HPACK` on this thread decodes and encodes
    /// through. The borrow only stops this instance from overwriting them.
    pub fn decode<'a>(&'a mut self, src: &[u8]) -> Result<DecodeResult<'a>, HpackError> {
        let mut header = lshpack_header::default();
        // SAFETY: genuine FFI — only the `(src.as_ptr(), src.len())` pair carries
        // an obligation here (in-bounds read), discharged by `src: &[u8]`. The
        // `self`/`output` preconditions are type-discharged via `&mut` in the
        // extern signature.
        let offset = unsafe { lshpack_wrapper_decode(self, src.as_ptr(), src.len(), &mut header) };
        if offset == 0 {
            return Err(HpackError::UnableToDecode);
        }
        if header.name_len == 0 {
            return Err(HpackError::EmptyHeaderName);
        }

        // SAFETY: lshpack_wrapper_decode writes name/value as offsets into the
        // thread_local `shared_header_buffer` (set via lsxpack_header_prepare_decode),
        // so both pointers are provably non-null after a successful decode. Use bare
        // `from_raw_parts` to avoid a dead null-branch on the per-HTTP/2-header path.
        let (name, value) = unsafe {
            (
                core::slice::from_raw_parts(header.name, header.name_len),
                core::slice::from_raw_parts(header.value, header.value_len),
            )
        };

        Ok(DecodeResult {
            name,
            value,
            next: offset,
            never_index: header.never_index,
        })
    }

    /// Appends the encoding of all of `block` to `dst`. `Err` appends nothing and leaves the table unchanged.
    pub fn encode_block(
        &mut self,
        block: &HeaderBlock,
        dst: &mut Vec<u8>,
    ) -> Result<(), HpackError> {
        if block.is_empty() {
            return Ok(());
        }
        let start = dst.len();
        dst.resize(start + block.encode_bound(), 0);
        let out = &mut dst[start..];
        // SAFETY: `HeaderBlock::push` is the only writer of `bytes` and `fields`, so the lengths
        // in `fields` add up to `bytes`. The C side writes at most `out.len()` bytes at `out`.
        let written = unsafe {
            lshpack_wrapper_encode_block(
                self,
                block.bytes.as_ptr(),
                block.fields.as_ptr(),
                block.len(),
                out.as_mut_ptr(),
                out.len(),
            )
        };
        // lshpack could not allocate a table entry after it inserted earlier fields.
        if written == usize::MAX {
            bun_core::out_of_memory();
        }
        dst.truncate(start + written);
        if written == 0 {
            return Err(HpackError::UnableToEncode);
        }
        Ok(())
    }

    /// Adjust the encoder's dynamic-table capacity after init. Evicts entries
    /// to fit; the caller is responsible for emitting the RFC 7541 §6.3
    /// Dynamic Table Size Update opcode at the start of the next header block
    /// so the peer's decoder evicts in lockstep.
    fn set_encoder_max_capacity(&mut self, max_capacity: u32) {
        lshpack_wrapper_enc_set_max_capacity(self, max_capacity as c_uint);
    }

    /// Sets both the table size and the limit on the peer's RFC 7541 §6.3 size updates.
    fn set_decoder_max_capacity(&mut self, max_capacity: u32) {
        lshpack_wrapper_dec_set_max_capacity(self, max_capacity as c_uint);
    }

    // Raw `*mut HPACK` teardown is subsumed by the
    // safe [`HpackHandle`] RAII wrapper below — every owner holds an
    // `HpackHandle`, so the raw destructor is private to `HpackHandle::drop`.
}

/// Owning handle for an `HPACK` instance.
///
/// The instance is allocated via the C wrapper (`lshpack_wrapper_init`, which
/// `mi_malloc`s the struct and `lshpack_{enc,dec}_init`s its internals). The
/// matching teardown is `lshpack_wrapper_deinit`, which runs the lshpack
/// cleanup hooks before freeing — **not** a bare `mi_free`. Wrapping the raw
/// pointer in `Box<HPACK>` (and letting `Box`'s `Drop` free it) therefore
/// leaks the encoder/decoder's internal allocations. Use this handle instead.
pub struct HpackHandle(core::ptr::NonNull<HPACK>);

impl HpackHandle {
    #[inline]
    pub fn new(max_capacity: u32) -> Self {
        // `lshpack_wrapper_init` is `safe fn`: its only precondition is non-null
        // alloc/free callbacks, which the bare (non-Option) fn-ptr types enforce.
        let ptr = lshpack_wrapper_init(
            bun_alloc::mimalloc::mi_malloc,
            bun_alloc::mimalloc::mi_free,
            max_capacity as usize,
        );
        let Some(ptr) = core::ptr::NonNull::new(ptr) else {
            bun_core::out_of_memory();
        };
        Self(ptr)
    }
}

impl core::ops::Deref for HpackHandle {
    type Target = HPACK;
    #[inline]
    fn deref(&self) -> &HPACK {
        // SAFETY: `self.0` is the unique live owner of the C allocation.
        unsafe { self.0.as_ref() }
    }
}

impl core::ops::DerefMut for HpackHandle {
    #[inline]
    fn deref_mut(&mut self) -> &mut HPACK {
        // SAFETY: `self.0` is the unique live owner of the C allocation.
        unsafe { self.0.as_mut() }
    }
}

impl Drop for HpackHandle {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `self.0` came from `lshpack_wrapper_init` and `HpackHandle`
        // is its unique owner, so this is the first and only
        // teardown — runs `lshpack_{enc,dec}_cleanup` then frees.
        unsafe { lshpack_wrapper_deinit(self.0.as_ptr()) };
    }
}

/// Two RFC 7541 §6.3 size updates (the minimum, then the final size) of up to 6 bytes each.
pub const MAX_SIZE_UPDATE_BYTES: usize = 12;

/// RFC 9113 §6.5.2: both sides start at this SETTINGS_HEADER_TABLE_SIZE.
const DEFAULT_HEADER_TABLE_SIZE: u32 = 4096;

/// Node's default `maxDeflateDynamicTableSize`, so a peer can't make us retain more header history.
const MAX_ENCODER_TABLE_SIZE: u32 = 4096;

/// One connection's HPACK encoder and decoder, kept in step with both sides' SETTINGS_HEADER_TABLE_SIZE.
pub struct Coder {
    hpack: HpackHandle,
    enc_capacity: u32,
    /// The smallest encoder capacity since the last header block, until a block announces it (RFC 7541 §4.2).
    unannounced_min: Option<u32>,
}

impl Default for Coder {
    fn default() -> Self {
        Coder {
            hpack: HpackHandle::new(DEFAULT_HEADER_TABLE_SIZE),
            enc_capacity: DEFAULT_HEADER_TABLE_SIZE,
            unannounced_min: None,
        }
    }
}

impl Coder {
    /// Call for every SETTINGS_HEADER_TABLE_SIZE entry the peer sends, in wire order.
    pub fn set_peer_header_table_size(&mut self, size: u32) {
        let capacity = size.min(MAX_ENCODER_TABLE_SIZE);
        if capacity == self.enc_capacity && self.unannounced_min.is_none() {
            return;
        }
        self.hpack.set_encoder_max_capacity(capacity);
        self.enc_capacity = capacity;
        self.unannounced_min = Some(
            self.unannounced_min
                .map_or(capacity, |min| min.min(capacity)),
        );
    }

    /// Call when the peer ACKs our SETTINGS. Until then its encoder still uses the previous size.
    pub fn set_acked_header_table_size(&mut self, size: u32) {
        self.hpack.set_decoder_max_capacity(size);
    }

    /// Appends the pending §6.3 size updates to `block`, which must be the start of a header block.
    fn take_pending_size_update(&mut self, block: &mut Vec<u8>) {
        let Some(min) = self.unannounced_min.take() else {
            return;
        };
        if min < self.enc_capacity {
            write_table_size_update(block, min);
        }
        write_table_size_update(block, self.enc_capacity);
    }

    /// Appends one whole header block to `dst`. `Err` appends nothing and leaves the encoder unchanged.
    pub fn encode_block(
        &mut self,
        block: &HeaderBlock,
        dst: &mut Vec<u8>,
    ) -> Result<(), HpackError> {
        let start = dst.len();
        let unannounced_min = self.unannounced_min;
        self.take_pending_size_update(dst);
        let result = self.hpack.encode_block(block, dst);
        if result.is_err() {
            dst.truncate(start);
            self.unannounced_min = unannounced_min;
        }
        result
    }

    /// Decodes one field. The result aliases a shared buffer, so copy it before the next call.
    #[inline]
    pub fn decode<'a>(&'a mut self, src: &[u8]) -> Result<DecodeResult<'a>, HpackError> {
        self.hpack.decode(src)
    }
}

/// RFC 7541 §5.1 and §6.3: `value` as a 5-bit-prefix integer behind the `001` pattern.
fn write_table_size_update(block: &mut Vec<u8>, value: u32) {
    if value < 31 {
        block.push(0x20 | value as u8);
        return;
    }
    block.push(0x20 | 31);
    let mut rest = value - 31;
    while rest >= 128 {
        block.push((rest as u8) | 0x80);
        rest >>= 7;
    }
    block.push(rest as u8);
}

// SAFETY: the C wrapper has no thread affinity; lshpack state is not accessed
// concurrently (callers serialize on the owning `H2FrameParser`).
unsafe impl Send for HpackHandle {}

// Non-Option fn pointers: the C ABI repr is identical to `Option<fn>`, but the
// type guarantees non-null, which is the only precondition `lshpack_wrapper_init`
// has — letting it be declared `safe fn` below.
// `alloc` has no caller precondition (mi_malloc is total over usize), so its
// pointer type is safe; `free` retains a caller contract because `mi_free`
// requires "ptr is mimalloc-owned or null" — discharged by the C wrapper,
// not by Rust's type system.
type LshpackWrapperAlloc = extern "C" fn(size: usize) -> *mut c_void;
type LshpackWrapperFree = unsafe extern "C" fn(ptr: *mut c_void);

unsafe extern "C" {
    safe fn lshpack_wrapper_init(
        alloc: LshpackWrapperAlloc,
        free: LshpackWrapperFree,
        capacity: usize,
    ) -> *mut HPACK;
    // Only precondition is a valid non-null `*HPACK`; `&mut HPACK` (ABI-identical
    // thin pointer) discharges it at the type level, so this is `safe fn`.
    safe fn lshpack_wrapper_enc_set_max_capacity(self_: &mut HPACK, max_capacity: c_uint);
    safe fn lshpack_wrapper_dec_set_max_capacity(self_: &mut HPACK, max_capacity: c_uint);
    // Frees `self_` (lshpack_{enc,dec}_cleanup + mi_free) — ownership transfer,
    // so this keeps its raw-pointer signature and caller-side safety obligation.
    fn lshpack_wrapper_deinit(self_: *mut HPACK);
    // `self_`/`output` are tightened to references (ABI-identical thin ptrs) so
    // those preconditions are type-discharged; the (src,src_len) pair still
    // carries an in-bounds-read contract that the C ABI cannot encode, so the
    // declaration stays unsafe.
    fn lshpack_wrapper_decode(
        self_: &mut HPACK,
        src: *const u8,
        src_len: usize,
        output: &mut lshpack_header,
    ) -> usize;
    // `fields` holds `field_count` pairs of u32 that describe `bytes` (see `HeaderBlock`).
    fn lshpack_wrapper_encode_block(
        self_: &mut HPACK,
        bytes: *const u8,
        fields: *const u32,
        field_count: usize,
        dst: *mut u8,
        dst_len: usize,
    ) -> usize;
}
