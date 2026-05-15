//! InternalSourceMap is Bun's private, in-process source-map storage format.
//! It exists because the standard pipeline is a bad fit when both the producer
//! (`js_printer`) and the consumer (stack remapping, coverage) are us:
//!
//!     js_printer emits VLQ text
//!       -> SavedSourceMap stores the VLQ bytes
//!       -> first .stack lookup decodes the *entire* string into a
//!          Mapping.List (MultiArrayList, 20 bytes/mapping)
//!       -> every later lookup binary-searches that array
//!
//! That round-trip through a text wire format costs three times: base64 encode
//! during printing, a full-file decode on the first stack trace, and a ~4x
//! memory blowup that lives for the rest of the process. For typescript.js
//! (~843k mappings) the moment any error touches it, ~3 MB of VLQ becomes
//! ~17 MB of i32[] and stays resident.
//!
//! InternalSourceMap stores the mappings as a sequence of fixed-size *windows*
//! (K = `sync_interval` mappings each), exploiting the structure of transpiler
//! output: for runtime TS/JSX stripping, ~77% of mappings have
//! `d_orig_col == d_gen_col`, ~81% have `d_gen_line == 0`, and `d_src_idx` is
//! always 0. Each window has a 32-byte fixed header (count, flags, three u16
//! section lengths, three always-present 8-byte equality masks for
//! d_gen_line/d_orig_line/d_orig_col) followed by varint streams: `d_gen_col`
//! for every delta, then `d_orig_line` and `d_orig_col` only where the masks
//! say they differ, then optional rare gen-line-exception / src-idx sections.
//! The 24-byte `SyncEntry` carries the absolute state of
//! each window's first mapping for bsearch. Result is ~2.4 bytes/mapping
//! (~1.3 MB on _tsc.js, 563k mappings, vs ~2.9 MB for plain LEB128 and ~11 MB
//! for `Mapping.List`) and lookups never materialize the whole thing.
//!
//! ## Lookup
//!
//! `find(line, col)` binary-searches `SyncEntry[]` on (gen_line, gen_col),
//! parses the matched window's header to seed full state, then advances a
//! `WindowReader` until it passes the target. `findWithCache` keeps each
//! window's decoded prefix in a small `FindCache` set so successive lookups in
//! a window already touched by this stack (the common case) skip the decode
//! and bsearch the cached `State`s directly.
//!
//! ## vs. VLQ + Mapping.List
//!
//!                      VLQ -> Mapping.List           InternalSourceMap
//!     encode           base64-VLQ per mapping        buffer K, flush window
//!     first lookup     decode entire file            none
//!     resident size    20 B/mapping after decode     ~2.4 B/mapping, constant
//!     per-lookup       bsearch over N (8B keys)      bsearch N/64 + <=63 deltas
//!     interop .map     yes (it *is* the spec)        no -- call appendVLQTo()
//!
//! ## What this is not
//!
//! Not a .map file format. Nothing outside Bun reads these bytes. When the
//! inspector or `node:module`.findSourceMap() needs a real source map, we
//! re-encode on demand via `appendVLQTo()`. Names (the optional 5th VLQ field)
//! are not stored: the runtime transpiler never emits them and stack remapping
//! doesn't read them; `fromVLQ()` decodes-and-drops them.
//!
//! ## Blob layout (single allocation, byte-addressed; no alignment assumed):
//!
//!     [ 0.. 8]  total_len:         u64   -- written by Chunk.Builder.generateChunk
//!     [ 8..16]  mapping_count:     u64   -- written by Chunk.Builder.generateChunk
//!     [16..24]  input_line_count:  u64   -- written by Chunk.Builder.generateChunk
//!     [24..28]  sync_count:        u32
//!     [28..32]  stream_offset:     u32   -- byte offset from blob start to stream
//!     [32..  ]  SyncEntry[sync_count]    -- 24 bytes each
//!     [stream_offset..total_len-stream_tail_pad]  Window[sync_count]
//!     [total_len-stream_tail_pad..total_len]      zero bytes (read-past pad)
//!
//! SyncEntry: absolute state of this window's first mapping plus stream offset
//!            (i32 gen_line/col, u32 byte_offset, i32 orig_line/col/src_idx).
//!
//! Window (fixed 32-byte header then variable streams; see `win_hdr`):
//!     count: u8, flags: u8 (bit2 has_gen_line_exceptions, bit3 has_src_idx)
//!     gen_col_len / orig_line_len / orig_col_len: 3 × u16 LE
//!     gen_line_mask / orig_line_eq_mask / orig_col_eq_mask: 3 × 8 bytes
//!       (bit i=1 ⇒ d_gen_line>=1 / d_orig_line==d_gen_line / d_orig_col==d_gen_col)
//!     gen_col_lane:          count-1 zig-zag varints (d_gen_col)
//!     orig_line_exceptions:  one varint per 0-bit in orig_line_eq_mask
//!     orig_col_exceptions:   one varint per 0-bit in orig_col_eq_mask
//!     if has_gen_line_exceptions:
//!       (idx:u8, varint d_gen_line) pairs for d_gen_line>1, 0xFF-terminated
//!     if has_src_idx:
//!       8-byte mask (bit=1 ⇒ d_src_idx==0) + varint per 0-bit
//!
//! Delta indices are 0..count-2 (first mapping is the seed; only count-1
//! deltas are encoded).

use core::mem::size_of;
use core::ptr;

use crate::Ordinal; // TODO(b2-blocked): bun_core::Ordinal — local shim
use bun_collections::VecExt as _;
use bun_core::MutableString;

use crate::vlq::decode as vlq_decode;
use crate::{LineColumnOffset, Mapping, SourceMapState, VLQ, append_mapping_to_buffer};

/// A sync entry is emitted every `SYNC_INTERVAL` mappings.
pub const SYNC_INTERVAL: usize = 64;

pub const HEADER_SIZE: usize = 32;

/// `read_varint`'s 1-byte fast path reads `bytes[pos]` unconditionally; the
/// exception cursors in `WindowReader` advance to one byte past their last
/// varint, so a 1-byte tail pad keeps that read in-bounds for a window at the
/// very end of the stream.
const STREAM_TAIL_PAD: usize = 1;

/// The blob is stored in the SavedSourceMap table as a tagged pointer to its
/// first byte. This struct is a thin view over that pointer; it owns no
/// separate allocation.
#[derive(Copy, Clone)]
pub struct InternalSourceMap {
    pub data: *const u8,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SyncEntry {
    pub generated_line: i32,
    pub generated_column: i32,
    pub byte_offset: u32,
    pub original_line: i32,
    pub original_column: i32,
    pub source_index: i32,
}

const _: () = assert!(size_of::<SyncEntry>() == 24);

impl SyncEntry {
    #[inline]
    fn less_or_equal(self, line: i32, col: i32) -> bool {
        self.generated_line < line || (self.generated_line == line && self.generated_column <= col)
    }

    #[inline]
    fn to_state(self) -> State {
        State {
            generated_line: self.generated_line,
            generated_column: self.generated_column,
            source_index: self.source_index,
            original_line: self.original_line,
            original_column: self.original_column,
        }
    }
}

impl InternalSourceMap {
    #[inline]
    pub fn total_len(self) -> usize {
        // SAFETY: blob is at least HEADER_SIZE bytes (validated by is_valid_blob / producer).
        unsafe { u64::from_ne_bytes(*self.data.cast::<[u8; 8]>()) as usize }
    }

    #[inline]
    pub fn mapping_count(self) -> usize {
        // SAFETY: blob is at least HEADER_SIZE bytes.
        unsafe { u64::from_ne_bytes(*self.data.add(8).cast::<[u8; 8]>()) as usize }
    }

    #[inline]
    pub fn input_line_count(self) -> usize {
        // SAFETY: blob is at least HEADER_SIZE bytes.
        unsafe { u64::from_ne_bytes(*self.data.add(16).cast::<[u8; 8]>()) as usize }
    }

    #[inline]
    pub fn sync_count(self) -> u32 {
        // SAFETY: blob is at least HEADER_SIZE bytes.
        unsafe { u32::from_ne_bytes(*self.data.add(24).cast::<[u8; 4]>()) }
    }

    #[inline]
    pub fn stream_offset(self) -> u32 {
        // SAFETY: blob is at least HEADER_SIZE bytes.
        unsafe { u32::from_ne_bytes(*self.data.add(28).cast::<[u8; 4]>()) }
    }

    pub fn sync_entry(self, index: usize) -> SyncEntry {
        let off = HEADER_SIZE + index * size_of::<SyncEntry>();
        // SAFETY: index < sync_count, sync entries are laid out contiguously
        // starting at HEADER_SIZE; blob layout is byte-addressed (no alignment
        // assumed) so we read unaligned.
        unsafe { ptr::read_unaligned(self.data.add(off).cast::<SyncEntry>()) }
    }

    #[inline]
    pub fn stream(self) -> &'static [u8] {
        // TODO(port): lifetime — this borrows the blob for as long as `self.data`
        // is valid; callers in this file only use the slice while `self` is live.
        // SAFETY: stream_offset..total_len is within the blob (validated by
        // is_valid_blob / producer).
        unsafe {
            core::slice::from_raw_parts(
                self.data.add(self.stream_offset() as usize),
                self.total_len() - self.stream_offset() as usize,
            )
        }
    }

    /// Only call this when the blob was heap-allocated by `Builder`/`from_vlq` (e.g.
    /// entries in `SavedSourceMap`). Do NOT call on views over the standalone
    /// module graph section or any other borrowed memory.
    // TODO(port): conditional ownership — intentionally NOT `impl Drop` because
    // `InternalSourceMap` is a Copy view and may borrow non-owned memory. Phase B
    // should split into an owning newtype with `impl Drop`.
    pub fn free_owned(self) {
        // SAFETY: caller guarantees the blob was produced by Builder/from_vlq via
        // the global allocator with this exact length.
        unsafe {
            drop(Box::<[u8]>::from_raw(core::slice::from_raw_parts_mut(
                self.data.cast_mut(),
                self.total_len(),
            )));
        }
    }

    pub fn memory_cost(self) -> usize {
        self.total_len()
    }

    /// Sanity-check a blob's outer header against its actual length. See the
    /// module-level [`is_valid_blob`] for details.
    ///
    /// Associated-fn alias so callers can write `InternalSourceMap::is_valid_blob(..)`
    /// (Zig: `pub fn isValidBlob` is a decl on the file-struct `@This()`).
    #[inline]
    pub fn is_valid_blob(blob: &[u8]) -> bool {
        is_valid_blob(blob)
    }

    /// Decode a standard VLQ "mappings" string and re-encode it as an
    /// `InternalSourceMap` blob. See the module-level [`from_vlq`] for details.
    ///
    /// Associated-fn alias so callers can write `InternalSourceMap::from_vlq(..)`
    /// (Zig: `pub fn fromVLQ` is a decl on the file-struct `@This()`).
    #[inline]
    pub fn from_vlq(vlq: &[u8], input_line_count_hint: u32) -> Result<Box<[u8]>, FromVlqError> {
        from_vlq(vlq, input_line_count_hint)
    }
}

/// Sanity-check the blob's outer header (total_len, sync_count, stream_offset)
/// against its actual length so a *truncated* embedded section in a `--compile`
/// binary degrades to "no sourcemap". This does not walk per-window
/// `SyncEntry.byte_offset`/section lengths; the blob is self-produced at build
/// time, and a tampered executable already implies arbitrary execution.
pub fn is_valid_blob(blob: &[u8]) -> bool {
    if blob.len() < HEADER_SIZE {
        return false;
    }
    let this = InternalSourceMap {
        data: blob.as_ptr(),
    };
    let total = this.total_len();
    if total != blob.len() {
        return false;
    }
    let sync_n = this.sync_count();
    let stream_off = this.stream_offset() as usize;
    let sync_end = HEADER_SIZE + (sync_n as usize) * size_of::<SyncEntry>();
    if stream_off < sync_end {
        return false;
    }
    if stream_off > total {
        return false;
    }
    if total < stream_off + STREAM_TAIL_PAD {
        return false;
    }
    true
}

#[derive(Copy, Clone, Default)]
struct State {
    generated_line: i32,
    generated_column: i32,
    source_index: i32,
    original_line: i32,
    original_column: i32,
}

impl State {
    #[inline]
    fn less_or_equal(self, line: i32, col: i32) -> bool {
        self.generated_line < line || (self.generated_line == line && self.generated_column <= col)
    }

    fn to_mapping(self) -> Mapping {
        Mapping {
            generated: LineColumnOffset {
                lines: Ordinal::from_zero_based(self.generated_line),
                columns: Ordinal::from_zero_based(self.generated_column),
            },
            original: LineColumnOffset {
                lines: Ordinal::from_zero_based(self.original_line),
                columns: Ordinal::from_zero_based(self.original_column),
            },
            source_index: self.source_index,
            name_index: -1,
        }
        // TODO(port): verify Mapping field shape (`generated`/`original` struct name) in bun_sourcemap.
    }
}

#[inline]
fn zigzag_encode(value: i32) -> u32 {
    ((value << 1) ^ (value >> 31)) as u32
}

#[inline]
fn zigzag_decode(value: u32) -> i32 {
    (value >> 1) as i32 ^ (-((value & 1) as i32))
}

/// Max bytes for a zig-zag-encoded i32 in 7-bit varint form: ceil(32 / 7) = 5.
const MAX_VARINT_LEN: usize = 5;

// PERF: force-inline so the per-delta loops in `flush_window` see the 1-byte
// fast path branchlessly and LLVM can hoist the `buf_ptr.add(w)` arithmetic.
// Zig leaves this to LLVM (single-CGU); Rust needs the hint across CGUs.
#[inline(always)]
fn write_varint(buf: *mut u8, signed: i32) -> usize {
    let mut v = zigzag_encode(signed);
    let mut i: usize = 0;
    loop {
        // PERF(port): @intCast — masked to 7 bits, provably in-range
        let mut byte: u8 = (v & 0x7f) as u8;
        v >>= 7;
        if v != 0 {
            byte |= 0x80;
        }
        // SAFETY: caller guarantees buf has at least MAX_VARINT_LEN bytes available.
        unsafe { *buf.add(i) = byte };
        i += 1;
        if v == 0 {
            return i;
        }
    }
}

fn read_varint(bytes: &[u8], pos: &mut usize) -> i32 {
    let mut i = *pos;
    let first = bytes[i];
    i += 1;
    if first < 0x80 {
        *pos = i;
        return zigzag_decode(first as u32);
    }
    let mut result: u32 = (first & 0x7f) as u32;
    let mut shift: u32 = 7;
    loop {
        if i >= bytes.len() || shift > 28 {
            break;
        }
        let byte = bytes[i];
        i += 1;
        result |= ((byte & 0x7f) as u32) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    *pos = i;
    zigzag_decode(result)
}

#[inline]
fn test_bit(base: *const u8, idx: usize) -> bool {
    // SAFETY: caller guarantees base[idx >> 3] is within the window header / mask region.
    unsafe { (*base.add(idx >> 3) >> (idx & 7)) & 1 != 0 }
}

const FLAG_HAS_GEN_LINE_EXCEPTIONS: u8 = 1 << 2;
const FLAG_HAS_SRC_IDX: u8 = 1 << 3;

/// Fixed window header layout. The three equality masks are always present
/// and padded to 8 bytes so `parse()` is straight-line; only the rare
/// gen-line-exception / src-idx sections are conditional.
mod win_hdr {
    pub(super) const COUNT_OFF: usize = 0;
    pub(super) const FLAGS_OFF: usize = 1;
    pub(super) const GEN_COL_LEN_OFF: usize = 2;
    pub(super) const ORIG_LINE_LEN_OFF: usize = 4;
    pub(super) const ORIG_COL_LEN_OFF: usize = 6;
    pub(super) const GEN_LINE_MASK_OFF: usize = 8;
    pub(super) const ORIG_LINE_EQ_MASK_OFF: usize = 16;
    pub(super) const ORIG_COL_EQ_MASK_OFF: usize = 24;
    pub(super) const GEN_COL_LANE_OFF: usize = 32;
}

/// Parses a window header and steps through its deltas in order. Exception
/// streams are consumed in order, so a reader is forward-only.
// TODO(port): lifetime — `bytes`/`base`/`src_idx_mask` borrow the blob; kept as
// raw pointers to avoid struct lifetime params in Phase A.
#[derive(Copy, Clone)]
struct WindowReader {
    bytes: *const [u8],
    base: *const u8,
    gen_col_pos: usize,
    orig_line_exc_pos: usize,
    orig_col_exc_pos: usize,
    gen_line_exc_pos: usize,
    src_idx_mask: *const u8,
    src_idx_exc_pos: usize,
    count: u8,
    flags: u8,
    gen_line_exc_next_idx: u8,
    delta_idx: u8,
}

impl WindowReader {
    const DANGLING: WindowReader = WindowReader {
        bytes: ptr::slice_from_raw_parts(ptr::null(), 0),
        base: ptr::null(),
        gen_col_pos: 0,
        orig_line_exc_pos: 0,
        orig_col_exc_pos: 0,
        gen_line_exc_pos: 0,
        src_idx_mask: ptr::null(),
        src_idx_exc_pos: 0,
        count: 0,
        flags: 0,
        gen_line_exc_next_idx: 0,
        delta_idx: 0,
    };

    #[inline]
    fn bytes<'a>(&self) -> &'a [u8] {
        // PORT NOTE: returns an unbound lifetime so callers can mutate other
        // `self` fields while holding the slice — `self.bytes` is a raw `*const [u8]`
        // pointing into the blob, not into `self`, so this is sound.
        // SAFETY: `bytes` was set from `InternalSourceMap.stream()` which is
        // valid for the lifetime of the blob; readers are only used while the
        // blob is live.
        unsafe { &*self.bytes }
    }

    fn parse(&mut self, bytes: &[u8], start: usize) {
        // SAFETY: `start` is a valid window header offset within `bytes` (came
        // from a SyncEntry.byte_offset produced by Builder).
        let b = unsafe { bytes.as_ptr().add(start) };
        self.bytes = std::ptr::from_ref::<[u8]>(bytes);
        self.base = b;
        // Clamp `count` so a corrupted header byte cannot drive `next()` past
        // `FindCacheSlot.decoded[SYNC_INTERVAL]`. Well-formed blobs never
        // exceed K; this is defense-in-depth for the standalone-graph path.
        // SAFETY: window header is 32 bytes within the stream; COUNT_OFF/FLAGS_OFF
        // are fixed offsets within that 32-byte header at `b`.
        self.count = unsafe { *b.add(win_hdr::COUNT_OFF) }.min(SYNC_INTERVAL as u8);
        // SAFETY: same — FLAGS_OFF is within the 32-byte header at `b`.
        let flags = unsafe { *b.add(win_hdr::FLAGS_OFF) };
        self.flags = flags;
        self.delta_idx = 0;

        // SAFETY: u16 LE fields at fixed header offsets within the 32-byte header.
        let gen_col_len: usize =
            unsafe { u16::from_ne_bytes(*b.add(win_hdr::GEN_COL_LEN_OFF).cast::<[u8; 2]>()) }
                as usize;
        let orig_line_len: usize =
            unsafe { u16::from_ne_bytes(*b.add(win_hdr::ORIG_LINE_LEN_OFF).cast::<[u8; 2]>()) }
                as usize;
        let orig_col_len: usize =
            unsafe { u16::from_ne_bytes(*b.add(win_hdr::ORIG_COL_LEN_OFF).cast::<[u8; 2]>()) }
                as usize;

        self.gen_col_pos = start + win_hdr::GEN_COL_LANE_OFF;
        self.orig_line_exc_pos = self.gen_col_pos + gen_col_len;
        self.orig_col_exc_pos = self.orig_line_exc_pos + orig_line_len;
        let mut pos = self.orig_col_exc_pos + orig_col_len;
        self.gen_line_exc_next_idx = 0xFF;
        if flags != 0 {
            if flags & FLAG_HAS_GEN_LINE_EXCEPTIONS != 0 && pos < bytes.len() {
                self.gen_line_exc_pos = pos;
                self.gen_line_exc_next_idx = bytes[pos];
                while pos < bytes.len() && bytes[pos] != 0xFF {
                    pos += 1;
                    let _ = read_varint(bytes, &mut pos);
                }
                pos += 1;
            }
            if flags & FLAG_HAS_SRC_IDX != 0 {
                // SAFETY: pos is within bytes (mask region is 8 bytes).
                self.src_idx_mask = unsafe { bytes.as_ptr().add(pos) };
                pos += 8;
                self.src_idx_exc_pos = pos;
            }
        }
    }

    #[inline]
    fn done(&self) -> bool {
        self.delta_idx + 1 >= self.count
    }

    fn next(&mut self, state: &mut State) {
        let delta_idx = self.delta_idx;
        self.delta_idx = delta_idx + 1;
        let b = self.base;
        let bytes = self.bytes();

        let mut d_gen_line: i32 = if test_bit(
            // SAFETY: header masks are at fixed offsets within the 32-byte header at `b`.
            unsafe { b.add(win_hdr::GEN_LINE_MASK_OFF) },
            delta_idx as usize,
        ) {
            1
        } else {
            0
        };
        let d_gen_col = read_varint(bytes, &mut self.gen_col_pos);
        let mut d_orig_line: i32 = if test_bit(
            // SAFETY: header masks are at fixed offsets within the 32-byte header at `b`.
            unsafe { b.add(win_hdr::ORIG_LINE_EQ_MASK_OFF) },
            delta_idx as usize,
        ) {
            d_gen_line
        } else {
            read_varint(bytes, &mut self.orig_line_exc_pos)
        };
        let d_orig_col: i32 = if test_bit(
            // SAFETY: header masks are at fixed offsets within the 32-byte header at `b`.
            unsafe { b.add(win_hdr::ORIG_COL_EQ_MASK_OFF) },
            delta_idx as usize,
        ) {
            d_gen_col
        } else {
            read_varint(bytes, &mut self.orig_col_exc_pos)
        };

        if self.flags != 0 {
            self.next_rare(delta_idx, &mut d_gen_line, &mut d_orig_line, state);
        }

        if d_gen_line != 0 {
            state.generated_line += d_gen_line;
            state.generated_column = d_gen_col;
        } else {
            state.generated_column += d_gen_col;
        }
        state.original_line += d_orig_line;
        state.original_column += d_orig_col;
    }

    #[cold]
    fn next_rare(
        &mut self,
        delta_idx: u8,
        d_gen_line: &mut i32,
        d_orig_line: &mut i32,
        state: &mut State,
    ) {
        let bytes = self.bytes();
        if self.gen_line_exc_next_idx == delta_idx {
            let mut p = self.gen_line_exc_pos + 1;
            *d_gen_line = read_varint(bytes, &mut p);
            if test_bit(
                // SAFETY: header mask at fixed offset within `base`.
                unsafe { self.base.add(win_hdr::ORIG_LINE_EQ_MASK_OFF) },
                delta_idx as usize,
            ) {
                *d_orig_line = *d_gen_line;
            }
            self.gen_line_exc_pos = p;
            self.gen_line_exc_next_idx = bytes[p];
        }
        if self.flags & FLAG_HAS_SRC_IDX != 0 && !test_bit(self.src_idx_mask, delta_idx as usize) {
            state.source_index += read_varint(bytes, &mut self.src_idx_exc_pos);
        }
    }
}

/// One decoded-window prefix. See `FindCache` for the multi-slot wrapper that
/// callers actually hold.
pub struct FindCacheSlot {
    data: *const u8,
    sync_idx: u32,
    decoded_count: u8,
    reader: WindowReader,
    decoded: [State; SYNC_INTERVAL],
}

impl Default for FindCacheSlot {
    fn default() -> Self {
        FindCacheSlot {
            data: ptr::null(),
            sync_idx: 0,
            decoded_count: 0,
            // PERF(port): was `undefined` init — profile in Phase B
            reader: WindowReader::DANGLING,
            decoded: [State::default(); SYNC_INTERVAL],
        }
    }
}

// Clone/Copy: bitwise OK — `data` is the blob's identity pointer (borrowed,
// compared for equality only); see `InternalSourceMap` doc.
#[derive(Copy, Clone)]
struct FindCacheKey {
    data: *const u8,
    sync_idx: u32,
}

impl Default for FindCacheKey {
    fn default() -> Self {
        FindCacheKey {
            data: ptr::null(),
            sync_idx: 0,
        }
    }
}

/// Per-caller decode cache. A single stack trace typically touches a handful
/// of distinct windows (frames at different depths in the same file, or in
/// different small files), so a one-slot cache thrashes. This is a small
/// fully-associative set keyed by `(blob ptr, sync_idx)` with round-robin
/// eviction; once a window is decoded it stays warm across the whole stack and
/// across subsequent stacks until evicted. ~21 KB per `SavedSourceMap`.
pub struct FindCache {
    /// Parallel key array kept hot and contiguous so the associative scan is a
    /// single 256-byte sweep; the heavyweight `FindCacheSlot` payloads live in
    /// a separate array so a miss doesn't drag them through the cache.
    keys: [FindCacheKey; FindCache::SLOT_COUNT],
    slots: [FindCacheSlot; FindCache::SLOT_COUNT],
    next_victim: u8,
}

impl FindCache {
    pub const SLOT_COUNT: usize = 16;

    pub fn invalidate(&mut self, data: *const u8) {
        for (k, s) in self.keys.iter_mut().zip(self.slots.iter_mut()) {
            if k.data == data {
                k.data = ptr::null();
                s.data = ptr::null();
            }
        }
    }

    pub fn invalidate_all(&mut self) {
        for (k, s) in self.keys.iter_mut().zip(self.slots.iter_mut()) {
            k.data = ptr::null();
            s.data = ptr::null();
        }
    }

    #[inline]
    fn slot_for(&mut self, data: *const u8, sync_idx: u32) -> &mut FindCacheSlot {
        for (i, k) in self.keys.iter().enumerate() {
            if k.data == data && k.sync_idx == sync_idx {
                return &mut self.slots[i];
            }
        }
        for (i, k) in self.keys.iter().enumerate() {
            if k.data.is_null() {
                self.keys[i] = FindCacheKey { data, sync_idx };
                return &mut self.slots[i];
            }
        }
        let v = self.next_victim as usize;
        self.next_victim = ((v + 1) & (Self::SLOT_COUNT - 1)) as u8;
        self.keys[v] = FindCacheKey { data, sync_idx };
        &mut self.slots[v]
    }
}

impl Default for FindCache {
    fn default() -> Self {
        // TODO(port): [T::default(); 16] requires T: Copy; FindCacheSlot is large.
        // Phase B may want core::array::from_fn or a const ZEROED.
        FindCache {
            keys: [FindCacheKey::default(); FindCache::SLOT_COUNT],
            slots: core::array::from_fn(|_| FindCacheSlot::default()),
            next_victim: 0,
        }
    }
}

impl InternalSourceMap {
    fn locate_window(self, target_line: i32, target_col: i32) -> Option<u32> {
        let n_sync = self.sync_count();
        if n_sync == 0 {
            return None;
        }
        let mut lo: usize = 0;
        let mut hi: usize = n_sync as usize;
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.sync_entry(mid).less_or_equal(target_line, target_col) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo == 0 {
            return None;
        }
        Some(u32::try_from(lo - 1).expect("int cast"))
    }

    fn seed_window(self, sync_idx: u32, state: &mut State, reader: &mut WindowReader) {
        let se = self.sync_entry(sync_idx as usize);
        *state = se.to_state();
        reader.parse(self.stream(), se.byte_offset as usize);
    }

    pub fn find_with_cache(
        self,
        line: Ordinal,
        column: Ordinal,
        set: &mut FindCache,
    ) -> Option<Mapping> {
        let target_line = line.zero_based();
        let target_col = column.zero_based();

        let sync_idx = self.locate_window(target_line, target_col)?;
        let cache = set.slot_for(self.data, sync_idx);

        if cache.data != self.data || cache.sync_idx != sync_idx || cache.decoded_count == 0 {
            self.seed_window(sync_idx, &mut cache.decoded[0], &mut cache.reader);
            cache.data = self.data;
            cache.sync_idx = sync_idx;
            cache.decoded_count = 1;
        }

        {
            let mut decoded_count = cache.decoded_count;
            let mut state = cache.decoded[(decoded_count - 1) as usize];
            while !cache.reader.done() && state.less_or_equal(target_line, target_col) {
                cache.reader.next(&mut state);
                cache.decoded[decoded_count as usize] = state;
                decoded_count += 1;
            }
            cache.decoded_count = decoded_count;
        }

        let decoded = &cache.decoded[0..cache.decoded_count as usize];
        let mut lo: usize = 0;
        let mut hi: usize = decoded.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if decoded[mid].less_or_equal(target_line, target_col) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo == 0 {
            return None;
        }
        let best = decoded[lo - 1];
        if best.generated_line != target_line {
            return None;
        }
        Some(best.to_mapping())
    }

    /// Matches the semantics of `Mapping.List.find`: returns the last mapping with
    /// generated position `<= (line, column)` whose generated line equals `line`.
    pub fn find(self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        let target_line = line.zero_based();
        let target_col = column.zero_based();

        let sync_idx = self.locate_window(target_line, target_col)?;

        let mut state = State::default();
        // PERF(port): was `undefined` init — profile in Phase B
        let mut reader = WindowReader::DANGLING;
        self.seed_window(sync_idx, &mut state, &mut reader);

        let mut best = state;
        while !reader.done() {
            let mut nxt = state;
            reader.next(&mut nxt);
            if !nxt.less_or_equal(target_line, target_col) {
                break;
            }
            best = nxt;
            state = nxt;
        }

        if best.generated_line != target_line {
            return None;
        }
        Some(best.to_mapping())
    }
}

/// Stateful forward cursor. `move_to` is cheap when successive targets are
/// monotonically non-decreasing in generated position; otherwise it reseeks via
/// the sync index.
///
/// Invariant: when `has_state`, `reader` is positioned such that calling
/// `advance_one()` produces the mapping immediately after `peek orelse state`.
pub struct Cursor {
    map: InternalSourceMap,
    state: State,
    peek: Option<State>,
    reader: WindowReader,
    sync_idx: u32,
    has_state: bool,
}

impl Cursor {
    pub fn init(map: InternalSourceMap) -> Cursor {
        Cursor {
            map,
            state: State::default(),
            peek: None,
            // PERF(port): was `undefined` init — profile in Phase B
            reader: WindowReader::DANGLING,
            sync_idx: 0,
            has_state: false,
        }
    }

    pub fn move_to(&mut self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        let target_line = line.zero_based();
        let target_col = column.zero_based();

        if !self.has_state || !self.state.less_or_equal(target_line, target_col) {
            if !self.reseek(target_line, target_col) {
                return None;
            }
        }

        loop {
            if let Some(p) = self.peek {
                if !p.less_or_equal(target_line, target_col) {
                    break;
                }
                self.state = p;
                self.peek = None;
            }
            let Some(nxt) = self.advance_one() else { break };
            if nxt.less_or_equal(target_line, target_col) {
                self.state = nxt;
            } else {
                self.peek = Some(nxt);
                break;
            }
        }

        if self.state.generated_line != target_line {
            return None;
        }
        Some(self.state.to_mapping())
    }

    fn advance_one(&mut self) -> Option<State> {
        if self.reader.done() {
            let n_sync = self.map.sync_count();
            if self.sync_idx + 1 >= n_sync {
                return None;
            }
            self.sync_idx += 1;
            let mut seed = State::default();
            self.map
                .seed_window(self.sync_idx, &mut seed, &mut self.reader);
            return Some(seed);
        }
        let mut nxt = self.peek.unwrap_or(self.state);
        self.reader.next(&mut nxt);
        Some(nxt)
    }

    fn reseek(&mut self, target_line: i32, target_col: i32) -> bool {
        let Some(idx) = self.map.locate_window(target_line, target_col) else {
            self.has_state = false;
            return false;
        };
        self.sync_idx = idx;
        self.map.seed_window(idx, &mut self.state, &mut self.reader);
        self.peek = None;
        self.has_state = true;
        true
    }
}

impl InternalSourceMap {
    pub fn cursor(self) -> Cursor {
        Cursor::init(self)
    }

    /// Re-encode the full mapping stream as a standard VLQ "mappings" string. Only
    /// the inspector's inline-sourcemap path needs this.
    pub fn append_vlq_to(self, out: &mut MutableString) {
        let n_sync = self.sync_count();
        let mut prev = SourceMapState::default();
        let mut generated_line: i32 = 0;

        let mut idx: u32 = 0;
        while idx < n_sync {
            let mut state = State::default();
            // PERF(port): was `undefined` init — profile in Phase B
            let mut reader = WindowReader::DANGLING;
            self.seed_window(idx, &mut state, &mut reader);
            emit_vlq(&state, &mut prev, &mut generated_line, out);
            while !reader.done() {
                reader.next(&mut state);
                emit_vlq(&state, &mut prev, &mut generated_line, out);
            }
            idx += 1;
        }
    }
}

fn emit_vlq(
    state: &State,
    prev: &mut SourceMapState,
    generated_line: &mut i32,
    out: &mut MutableString,
) {
    while *generated_line < state.generated_line {
        out.list.push(b';');
        prev.generated_column = 0;
        *generated_line += 1;
    }
    let current = SourceMapState {
        generated_line: state.generated_line,
        generated_column: state.generated_column,
        source_index: state.source_index,
        original_line: state.original_line,
        original_column: state.original_column,
    };
    let last_byte: u8 = out.list.last().copied().unwrap_or(0);
    append_mapping_to_buffer(out, last_byte, *prev, current);
    *prev = current;
}

// `#[repr(C)]` pins declaration order so the per-mapping read/modify/write set
// (`generated_line`, `pending_generated_line_delta`, `count`, `pending_n` —
// 13 bytes) lands at offset 0 in the head cache line, with `sync_entries`'
// NonNull ptr (the `Option<Builder>` niche) immediately after in the *same*
// line. The inlined `VLQSourceMap::append`/`append_line_separator` (Chunk.zig
// 103/107 are `pub inline fn`) thus touch one line on the fast path instead of
// straddling the five 256-byte `pending_*` lanes. (benches: lint/create-vue)
//
// The pending window is stored column-wise — five parallel `[i32; SYNC_INTERVAL]`
// lanes rather than one `[State; SYNC_INTERVAL]` array of 20-byte rows. So
// `append_mapping`'s per-mapping store is five naturally-aligned i32 writes that
// never straddle a cache line, and `flush_window`'s `cur - prev` deltas walk
// each lane as a contiguous, prefetcher-friendly stream. Only `[0..pending_n]`
// of each lane are live; the rest hold stale/zero values that nothing reads.
#[repr(C)]
pub struct Builder {
    /// Absolute generated line of the last mapping appended; carried across
    /// `append_mapping` calls so a run of `append_line_separator`s can be folded
    /// into the next mapping's delta.
    generated_line: i32,
    pending_generated_line_delta: i32,
    count: u32,
    pending_n: u8,
    sync_entries: Vec<SyncEntry>,
    win_stream: Vec<u8>,
    pending_generated_line: [i32; SYNC_INTERVAL],
    pending_generated_column: [i32; SYNC_INTERVAL],
    pending_source_index: [i32; SYNC_INTERVAL],
    pending_original_line: [i32; SYNC_INTERVAL],
    pending_original_column: [i32; SYNC_INTERVAL],
    finalized: Option<MutableString>,
}

impl Default for Builder {
    fn default() -> Self {
        Builder {
            generated_line: 0,
            pending_generated_line_delta: 0,
            count: 0,
            pending_n: 0,
            sync_entries: Vec::new(),
            win_stream: Vec::new(),
            pending_generated_line: [0; SYNC_INTERVAL],
            pending_generated_column: [0; SYNC_INTERVAL],
            pending_source_index: [0; SYNC_INTERVAL],
            pending_original_line: [0; SYNC_INTERVAL],
            pending_original_column: [0; SYNC_INTERVAL],
            finalized: None,
        }
    }
}

impl Builder {
    pub fn init() -> Builder {
        Builder::default()
    }

    // `deinit` deleted: Vec/Option<MutableString> fields drop automatically.

    #[inline(always)]
    pub fn append_line_separator(&mut self) {
        self.pending_generated_line_delta += 1;
    }

    #[inline(always)]
    pub fn append_mapping(&mut self, current: &SourceMapState) {
        let generated_line = self.generated_line + self.pending_generated_line_delta;
        self.generated_line = generated_line;
        self.pending_generated_line_delta = 0;

        let i = self.pending_n as usize;
        debug_assert!(i < SYNC_INTERVAL);
        // SAFETY: invariant `pending_n < SYNC_INTERVAL` between flushes — the
        // tail of this fn flushes (resetting to 0) the moment it would reach
        // SYNC_INTERVAL, so on entry `pending_n <= SYNC_INTERVAL-1`. Elides the
        // per-mapping bounds check (Zig stores into `self.pending[n]` unchecked).
        unsafe {
            *self.pending_generated_line.get_unchecked_mut(i) = generated_line;
            *self.pending_generated_column.get_unchecked_mut(i) = current.generated_column;
            *self.pending_source_index.get_unchecked_mut(i) = current.source_index;
            *self.pending_original_line.get_unchecked_mut(i) = current.original_line;
            *self.pending_original_column.get_unchecked_mut(i) = current.original_column;
        }
        self.pending_n += 1;
        self.count += 1;

        if self.pending_n as usize == SYNC_INTERVAL {
            self.flush_window();
        }
    }

    fn flush_window(&mut self) {
        let n = self.pending_n;
        if n == 0 {
            return;
        }
        // The pending window, column-wise: `[0..n]` of each lane is live (written
        // by `append_mapping` before `pending_n` advanced past them).
        let nn = n as usize;
        let gen_line = &self.pending_generated_line[..nn];
        let gen_col = &self.pending_generated_column[..nn];
        let src_idx = &self.pending_source_index[..nn];
        let orig_line = &self.pending_original_line[..nn];
        let orig_col = &self.pending_original_column[..nn];
        // PERF(port): @intCast — win_stream is bounded by total mapping count × ~5B/mapping;
        // u32 overflow would mean a >4 GiB sourcemap stream, unreachable in practice.
        debug_assert!(self.win_stream.len() <= u32::MAX as usize);
        let start_off: u32 = self.win_stream.len() as u32;
        self.sync_entries.push(SyncEntry {
            generated_line: gen_line[0],
            generated_column: gen_col[0],
            byte_offset: start_off,
            original_line: orig_line[0],
            original_column: orig_col[0],
            source_index: src_idx[0],
        });

        let n_deltas: usize = n as usize - 1;

        // PERF: worst-case capacity assuming *every* optional section is present
        // and every varint is maximal. Reserving up front lets us grab `buf_ptr`
        // before the delta loop and emit *all* lanes in a single pass: each lane
        // gets its own worst-case sub-range of the spare buffer, written through a
        // dedicated cursor, and once the loop is done — true lengths now known —
        // the lanes are compacted into the on-disk (contiguous) layout. This
        // removes the post-loop re-walks (orig_line / orig_col / src_idx / gen_line
        // exceptions) of a materialized `Delta` array, and the array itself.
        //
        // Sub-range bases relative to `buf_ptr` (MV == MAX_VARINT_LEN):
        //   gen_col_lane : [GEN_COL_LANE_OFF              .. + nd*MV)
        //   orig_line    : [orig_line_base               .. + nd*MV)
        //   orig_col     : [orig_col_base                .. + nd*MV)
        //   gen_line exc : [gen_line_base                .. + nd*(1+MV) + 1)   (+1 = 0xFF terminator)
        //   src_idx      : [src_idx_base                 .. + 8 + nd*MV)       (8 = leading bitmask)
        // `cap` is the sum, identical to the previous "all flags set" bound.
        // Each cursor stays inside its sub-range: a lane emits <= nd varints of
        // <= MV bytes, gen_line adds a 1-byte index per pair plus the terminator,
        // src_idx adds the 8-byte mask. The compaction destinations are always
        // <= the corresponding source base (each preceding lane's true length is
        // <= its reserved width), so `ptr::copy` (memmove) is sound even though
        // regions abut, and the runs are copied in layout order so a copy never
        // clobbers a not-yet-copied source. `commit_spare(w)` exposes only the
        // compacted prefix, so over-reserving costs nothing committed.
        let gen_col_base = win_hdr::GEN_COL_LANE_OFF;
        let orig_line_base = gen_col_base + n_deltas * MAX_VARINT_LEN;
        let orig_col_base = orig_line_base + n_deltas * MAX_VARINT_LEN;
        let gen_line_base = orig_col_base + n_deltas * MAX_VARINT_LEN;
        let src_idx_base = gen_line_base + n_deltas * (1 + MAX_VARINT_LEN) + 1;
        let cap: usize = src_idx_base + 8 + n_deltas * MAX_VARINT_LEN;
        let buf_ptr: *mut u8 = self.win_stream.reserve_spare(cap).as_mut_ptr().cast();
        // SAFETY: `cap >= GEN_COL_LANE_OFF` bytes were just reserved as spare.
        unsafe { buf_ptr.write_bytes(0, win_hdr::GEN_COL_LANE_OFF) };
        // SAFETY: COUNT_OFF is within the zeroed 32-byte header.
        unsafe { *buf_ptr.add(win_hdr::COUNT_OFF) = n };
        // The src_idx lane starts with an 8-byte "d_src_idx == 0" bitmask; zero
        // it up front so the loop can OR bits in as it goes.
        // SAFETY: [src_idx_base, src_idx_base + 8) is within the reserved `cap`.
        unsafe { buf_ptr.add(src_idx_base).write_bytes(0, 8) };

        let mut flags: u8 = 0;
        let mut w_gen_col = gen_col_base;
        let mut w_orig_line = orig_line_base;
        let mut w_orig_col = orig_col_base;
        let mut w_gen_line = gen_line_base;
        let mut w_src_idx = src_idx_base + 8;
        // Each lane is a contiguous stream; `gen_line[k+1] - gen_line[k]` etc.
        // are strided loads the prefetcher handles. `k < n_deltas == nn - 1`, so
        // both `[k]` and `[k+1]` are in bounds of the `[..nn]` slices.
        for k in 0..n_deltas {
            let d_gen_line = gen_line[k + 1] - gen_line[k];
            let d_gen_col = if d_gen_line != 0 {
                gen_col[k + 1]
            } else {
                gen_col[k + 1] - gen_col[k]
            };
            let d_orig_line = orig_line[k + 1] - orig_line[k];
            let d_orig_col = orig_col[k + 1] - orig_col[k];
            let d_src_idx = src_idx[k + 1] - src_idx[k];

            let bit = 1u8 << (k & 7);
            // SAFETY: k < n_deltas <= SYNC_INTERVAL-1 == 63, so `k >> 3 <= 7`
            // and the header mask byte offset is within the zeroed 32-byte header.
            if d_gen_line >= 1 {
                unsafe { *buf_ptr.add(win_hdr::GEN_LINE_MASK_OFF + (k >> 3)) |= bit };
            }

            // gen_col lane: one zig-zag varint per delta.
            // SAFETY: `w_gen_col` stays within [gen_col_base, gen_col_base + nd*MAX_VARINT_LEN).
            w_gen_col += write_varint(unsafe { buf_ptr.add(w_gen_col) }, d_gen_col);

            // orig_line: a bit in the eq-mask when it equals d_gen_line, else one varint.
            if d_orig_line == d_gen_line {
                // SAFETY: mask byte within the zeroed 32-byte header.
                unsafe { *buf_ptr.add(win_hdr::ORIG_LINE_EQ_MASK_OFF + (k >> 3)) |= bit };
            } else {
                // SAFETY: `w_orig_line` stays within [orig_line_base, orig_line_base + nd*MAX_VARINT_LEN).
                w_orig_line += write_varint(unsafe { buf_ptr.add(w_orig_line) }, d_orig_line);
            }

            // orig_col: a bit in the eq-mask when it equals d_gen_col, else one varint.
            if d_orig_col == d_gen_col {
                // SAFETY: mask byte within the zeroed 32-byte header.
                unsafe { *buf_ptr.add(win_hdr::ORIG_COL_EQ_MASK_OFF + (k >> 3)) |= bit };
            } else {
                // SAFETY: `w_orig_col` stays within [orig_col_base, orig_col_base + nd*MAX_VARINT_LEN).
                w_orig_col += write_varint(unsafe { buf_ptr.add(w_orig_col) }, d_orig_col);
            }

            // gen_line exceptions: (idx:u8, varint) pair when d_gen_line does not
            // round-trip through the single mask bit (i.e. > 1 or < 0).
            if d_gen_line > 1 || d_gen_line < 0 {
                flags |= FLAG_HAS_GEN_LINE_EXCEPTIONS;
                // SAFETY: `w_gen_line` stays within
                // [gen_line_base, gen_line_base + nd*(1+MAX_VARINT_LEN)); the trailing
                // +1 byte (for the 0xFF terminator) is written after the loop.
                unsafe { *buf_ptr.add(w_gen_line) = k as u8 };
                w_gen_line += 1;
                w_gen_line += write_varint(unsafe { buf_ptr.add(w_gen_line) }, d_gen_line);
            }

            // src_idx: a bit in the leading mask when zero, else one varint after it.
            if d_src_idx == 0 {
                // SAFETY: [src_idx_base, src_idx_base + 8) was zeroed; k >> 3 <= 7.
                unsafe { *buf_ptr.add(src_idx_base + (k >> 3)) |= bit };
            } else {
                flags |= FLAG_HAS_SRC_IDX;
                // SAFETY: `w_src_idx` stays within
                // [src_idx_base + 8, src_idx_base + 8 + nd*MAX_VARINT_LEN).
                w_src_idx += write_varint(unsafe { buf_ptr.add(w_src_idx) }, d_src_idx);
            }
        }

        // 0xFF terminator closes the gen_line exception stream when present.
        if flags & FLAG_HAS_GEN_LINE_EXCEPTIONS != 0 {
            // SAFETY: the reserved +1 slot past nd*(1+MAX_VARINT_LEN) in the gen_line sub-range.
            unsafe { *buf_ptr.add(w_gen_line) = 0xFF };
            w_gen_line += 1;
        }

        // SAFETY: FLAGS_OFF is within the zeroed 32-byte header.
        unsafe { *buf_ptr.add(win_hdr::FLAGS_OFF) = flags };

        // True lane lengths. gen_line/src_idx are 0 unless their flag bit is set
        // (the cursors never advance past their base in that case).
        let gen_col_len = w_gen_col - gen_col_base;
        let orig_line_len = w_orig_line - orig_line_base;
        let orig_col_len = w_orig_col - orig_col_base;
        let gen_line_len = w_gen_line - gen_line_base;
        let src_idx_len = if flags & FLAG_HAS_SRC_IDX != 0 {
            w_src_idx - src_idx_base // includes the leading 8-byte mask
        } else {
            0
        };
        // PERF(port): @intCast — n_deltas <= 63, MAX_VARINT_LEN == 5, so each
        // length field is <= 315 bytes < u16::MAX. Drop the panic edge so the hot
        // window-emit path has no unwind landing pads.
        debug_assert!(gen_col_len <= u16::MAX as usize);
        debug_assert!(orig_line_len <= u16::MAX as usize);
        debug_assert!(orig_col_len <= u16::MAX as usize);
        unsafe {
            buf_ptr
                .add(win_hdr::GEN_COL_LEN_OFF)
                .cast::<[u8; 2]>()
                .write_unaligned((gen_col_len as u16).to_ne_bytes());
            buf_ptr
                .add(win_hdr::ORIG_LINE_LEN_OFF)
                .cast::<[u8; 2]>()
                .write_unaligned((orig_line_len as u16).to_ne_bytes());
            buf_ptr
                .add(win_hdr::ORIG_COL_LEN_OFF)
                .cast::<[u8; 2]>()
                .write_unaligned((orig_col_len as u16).to_ne_bytes());
        }

        // Compact: gen_col is already in place; pull each later lane left so the
        // streams sit back-to-back, the layout the reader (`WindowReader::parse`)
        // walks. Destinations are <= sources and runs are moved in order, so
        // `ptr::copy` is sound (see the cap/sub-range comment above).
        let mut w = gen_col_base + gen_col_len;
        // SAFETY: every copy stays within the reserved `cap` and never reads past
        // a lane's written prefix; `dst <= src` for each so overlap is fine.
        unsafe {
            ptr::copy(buf_ptr.add(orig_line_base), buf_ptr.add(w), orig_line_len);
            w += orig_line_len;
            ptr::copy(buf_ptr.add(orig_col_base), buf_ptr.add(w), orig_col_len);
            w += orig_col_len;
            ptr::copy(buf_ptr.add(gen_line_base), buf_ptr.add(w), gen_line_len);
            w += gen_line_len;
            ptr::copy(buf_ptr.add(src_idx_base), buf_ptr.add(w), src_idx_len);
            w += src_idx_len;
        }

        debug_assert!(w <= cap);
        // SAFETY: w <= cap (reserved); all bytes in spare[..w] were written above.
        unsafe { bun_core::vec::commit_spare(&mut self.win_stream, w) };
        self.pending_n = 0;
    }

    /// Serialize into the single-allocation blob layout. The first 24 header
    /// bytes are left for `Chunk.Builder.generateChunk` to fill in (length,
    /// count, input line count) so this path flows through the existing
    /// `Chunk.buffer` plumbing unchanged.
    pub fn finalize(&mut self) -> &mut MutableString {
        // PORT NOTE: reshaped for borrowck — Zig early-returns `&self.finalized.?`
        // before populating; we check first then fall through to the trailing borrow.
        if self.finalized.is_none() {
            self.flush_window();

            let sync_bytes = self.sync_entries.len() * size_of::<SyncEntry>();
            let stream_offset: u32 = u32::try_from(HEADER_SIZE + sync_bytes).expect("int cast");
            let total: usize = stream_offset as usize + self.win_stream.len() + STREAM_TAIL_PAD;

            let mut out = MutableString::init_empty();
            // Zig: `out.list.resize(allocator, total)` leaves new bytes undefined.
            // Every byte in [0..total) is written below: [0..24] zero-filled,
            // [24..32] header u32s, [32..32+sync_bytes] sync table memcpy,
            // [stream_offset..stream_offset+win_stream.len()] stream memcpy,
            // [total-STREAM_TAIL_PAD..total] zero-filled. These ranges are
            // contiguous (HEADER_SIZE==32, stream_offset==32+sync_bytes), so
            // no uninit bytes are exposed by set_len.
            // SAFETY: every byte in [0..total) is written below (see comment above).
            let blob = unsafe { out.list.writable_slice_exact(total) };

            blob[0..24].fill(0);
            blob[24..28].copy_from_slice(
                &u32::try_from(self.sync_entries.len())
                    .expect("int cast")
                    .to_ne_bytes(),
            );
            blob[28..32].copy_from_slice(&stream_offset.to_ne_bytes());
            if sync_bytes > 0 {
                // SAFETY: SyncEntry is #[repr(C)] POD with no padding (size==24,
                // 6×4-byte fields); reinterpreting as bytes is sound.
                let src = unsafe {
                    core::slice::from_raw_parts(self.sync_entries.as_ptr().cast::<u8>(), sync_bytes)
                };
                blob[HEADER_SIZE..HEADER_SIZE + sync_bytes].copy_from_slice(src);
            }
            blob[stream_offset as usize..stream_offset as usize + self.win_stream.len()]
                .copy_from_slice(&self.win_stream);
            blob[total - STREAM_TAIL_PAD..total].fill(0);

            self.win_stream = Vec::new();
            self.sync_entries = Vec::new();

            self.finalized = Some(out);
        }
        self.finalized.as_mut().unwrap()
    }

    /// Move the finalized buffer out (Zig: `b.finalize().*` then `b.finalized = null`).
    pub fn finalize_take(&mut self) -> MutableString {
        let _ = self.finalize();
        self.finalized.take().unwrap()
    }
}

#[derive(Debug, Copy, Clone)]
pub enum FromVlqError {
    InvalidSourceMap,
}

impl From<FromVlqError> for bun_core::Error {
    fn from(_e: FromVlqError) -> Self {
        bun_core::err!("InvalidSourceMap")
    }
}

/// Decode a standard VLQ "mappings" string and re-encode it as an
/// InternalSourceMap blob. Used by `bun build --compile` to convert the
/// bundler's JSON sourcemap once at build time so the standalone executable
/// can remap stack traces without ever materializing a `Mapping.List`.
///
/// 1-field segments are skipped (no original location). The 5th field
/// (`name_index`) is decoded but discarded; nothing in the stack-trace remap
/// path reads it.
pub fn from_vlq(vlq: &[u8], input_line_count_hint: u32) -> Result<Box<[u8]>, FromVlqError> {
    let mut builder = Builder::init();

    let mut generated_column: i32 = 0;
    let mut source_index: i32 = 0;
    let mut original_line: i32 = 0;
    let mut original_column: i32 = 0;
    let mut max_original_line: i32 = 0;

    let mut remain = vlq;
    while !remain.is_empty() {
        if remain[0] == b';' {
            generated_column = 0;
            while !remain.is_empty() && remain[0] == b';' {
                builder.append_line_separator();
                remain = &remain[1..];
            }
            if remain.is_empty() {
                break;
            }
        }

        let gc = vlq_decode(remain, 0);
        if gc.start == 0 {
            return Err(FromVlqError::InvalidSourceMap);
        }
        generated_column += gc.value;
        remain = &remain[gc.start as usize..];

        if remain.is_empty() || remain[0] == b',' || remain[0] == b';' {
            if !remain.is_empty() && remain[0] == b',' {
                remain = &remain[1..];
            }
            continue;
        }

        let si = vlq_decode(remain, 0);
        if si.start == 0 {
            return Err(FromVlqError::InvalidSourceMap);
        }
        source_index += si.value;
        remain = &remain[si.start as usize..];

        let ol = vlq_decode(remain, 0);
        if ol.start == 0 {
            return Err(FromVlqError::InvalidSourceMap);
        }
        original_line += ol.value;
        remain = &remain[ol.start as usize..];

        let oc = vlq_decode(remain, 0);
        if oc.start == 0 {
            return Err(FromVlqError::InvalidSourceMap);
        }
        original_column += oc.value;
        remain = &remain[oc.start as usize..];

        if !remain.is_empty() && remain[0] != b',' && remain[0] != b';' {
            let ni = vlq_decode(remain, 0);
            if ni.start == 0 {
                return Err(FromVlqError::InvalidSourceMap);
            }
            remain = &remain[ni.start as usize..];
        }
        if !remain.is_empty() && remain[0] == b',' {
            remain = &remain[1..];
        }

        max_original_line = max_original_line.max(original_line);
        builder.append_mapping(&SourceMapState {
            generated_column,
            source_index,
            original_line,
            original_column,
            ..SourceMapState::default()
        });
    }

    // PORT NOTE: reshaped for borrowck — capture `builder.count` before borrowing
    // `builder.finalized` mutably.
    let mapping_count: u64 = builder.count as u64;
    let out = builder.finalize();
    let blob = out.list.as_mut_slice();
    let total_len: u64 = blob.len() as u64;
    let input_lines: u64 =
        (input_line_count_hint as u64).max(u64::try_from(max_original_line).expect("int cast") + 1);
    blob[0..8].copy_from_slice(&total_len.to_ne_bytes());
    blob[8..16].copy_from_slice(&mapping_count.to_ne_bytes());
    blob[16..24].copy_from_slice(&input_lines.to_ne_bytes());

    let owned = core::mem::take(&mut out.list).into_boxed_slice();
    builder.finalized = None;
    Ok(owned)
}

// `pub const TestingAPIs = @import("../sourcemap_jsc/internal_jsc.zig").TestingAPIs;`
// deleted — *_jsc alias; extension-trait lives in bun_sourcemap_jsc.

// ported from: src/sourcemap/InternalSourceMap.zig
