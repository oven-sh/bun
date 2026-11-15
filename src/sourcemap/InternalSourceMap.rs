//! InternalSourceMap is Bun's private, in-process source-map storage format.
//! It exists because the standard pipeline is a bad fit when both the producer
//! (`js_printer`) and the consumer (stack remapping, coverage) are us:
//!
//! ```text
//! js_printer emits VLQ text
//!   -> SavedSourceMap stores the VLQ bytes
//!   -> first .stack lookup decodes the *entire* string into a
//!      Mapping.List (MultiArrayList, 20 bytes/mapping)
//!   -> every later lookup binary-searches that array
//! ```
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
//! ```text
//!                  VLQ -> Mapping.List           InternalSourceMap
//! encode           base64-VLQ per mapping        buffer K, flush window
//! first lookup     decode entire file            none
//! resident size    20 B/mapping after decode     ~2.4 B/mapping, constant
//! per-lookup       bsearch over N (8B keys)      bsearch N/64 + <=63 deltas
//! interop .map     yes (it *is* the spec)        no -- call appendVLQTo()
//! ```
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
//! ```text
//!     [ 0.. 8]  total_len:         u64
//!     [ 8..16]  mapping_count:     u64
//!     [16..20]  unused
//!     [20..24]  object_brace_count: u32  -- 0 from an older Bun: the high half of its u64 line count
//!     [24..28]  sync_count:        u32
//!     [28..32]  stream_offset:     u32   -- byte offset from blob start to stream
//!     [32..  ]  SyncEntry[sync_count]    -- 24 bytes each
//!     [stream_offset..]  Window[sync_count]
//!     [..total_len-stream_tail_pad]  ObjectBrace[object_brace_count] -- see `Builder::mark_object_brace`
//!     [total_len-stream_tail_pad..total_len]      zero bytes (see `STREAM_TAIL_PAD`)
//! ```
//!
//! SyncEntry: absolute state of this window's first mapping plus stream offset
//!            (i32 gen_line/col, u32 byte_offset, i32 orig_line/col/src_idx).
//!
//! Window (fixed 32-byte header then variable streams; see `win_hdr`):
//!
//! ```text
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
//! ```
//!
//! Delta indices are 0..count-2 (first mapping is the seed; only count-1
//! deltas are encoded).

use core::mem::size_of;
use core::ptr;

use crate::Ordinal;
use bun_collections::VecExt as _;
use bun_core::{MutableString, Unaligned};

use crate::vlq::decode as vlq_decode;
use crate::{LineColumnOffset, Mapping, SourceMapState, append_mapping_to_buffer};

/// A sync entry is emitted every `SYNC_INTERVAL` mappings.
pub(crate) const SYNC_INTERVAL: usize = 64;

const HEADER_SIZE: usize = size_of::<Header>();

/// Trailing zero byte in the blob layout. The reader is bounds-checked and doesn't need it.
const STREAM_TAIL_PAD: usize = 1;

/// A view of a blob.
#[derive(Copy, Clone)]
pub struct InternalSourceMap<'a> {
    mapping_count: u64,
    object_brace_count: u32,
    sync_entries: &'a [Unaligned<SyncEntry>],
    stream: &'a [u8],
}

#[repr(C)]
#[derive(Copy, Clone)]
struct Header {
    total_len: u64,
    mapping_count: u64,
    unused: u32,
    object_brace_count: u32,
    sync_count: u32,
    stream_offset: u32,
}

const _: () = assert!(HEADER_SIZE == 32);

#[repr(C)]
#[derive(Copy, Clone)]
struct SyncEntry {
    generated_line: i32,
    generated_column: i32,
    byte_offset: u32,
    original_line: i32,
    original_column: i32,
    source_index: i32,
}

const _: () = assert!(size_of::<SyncEntry>() == 24);

/// A mapping that `Builder::mark_object_brace` marked.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ObjectBrace {
    pub generated: LineColumnOffset,
    pub original: LineColumnOffset,
}

const _: () = assert!(size_of::<ObjectBrace>() == 16);

bun_core::impl_pod!(Header, SyncEntry, ObjectBrace);

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

impl<'a> InternalSourceMap<'a> {
    /// `None` if the header disagrees with the length. `WindowReader` bounds-checks the rest.
    pub fn new(blob: &'a [u8]) -> Option<Self> {
        let header: Header = bun_core::read_prefix(blob)?;
        let sync_end = HEADER_SIZE + header.sync_count as usize * size_of::<SyncEntry>();
        let stream_offset = header.stream_offset as usize;
        if header.total_len != blob.len() as u64
            || stream_offset < sync_end
            || blob.len() < stream_offset + STREAM_TAIL_PAD
        {
            return None;
        }
        Some(InternalSourceMap {
            mapping_count: header.mapping_count,
            object_brace_count: header.object_brace_count,
            sync_entries: Unaligned::slice_of(&blob[HEADER_SIZE..sync_end]),
            stream: &blob[stream_offset..],
        })
    }

    pub fn mapping_count(self) -> usize {
        self.mapping_count as usize
    }

    fn object_braces(self) -> &'a [Unaligned<ObjectBrace>] {
        let len = self.object_brace_count as usize * size_of::<ObjectBrace>();
        match self.stream.len().checked_sub(len + STREAM_TAIL_PAD) {
            Some(start) => Unaligned::slice_of(&self.stream[start..][..len]),
            None => &[],
        }
    }
}

#[derive(Copy, Clone)]
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
        // Don't use `from_zero_based` here, because a corrupt blob can decode to a negative coordinate.
        Mapping {
            generated: LineColumnOffset {
                lines: Ordinal(self.generated_line),
                columns: Ordinal(self.generated_column),
            },
            original: LineColumnOffset {
                lines: Ordinal(self.original_line),
                columns: Ordinal(self.original_column),
            },
            source_index: self.source_index,
            name_index: -1,
        }
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
// The hint is needed for inlining across CGUs.
#[inline(always)]
fn write_varint(buf: *mut u8, signed: i32) -> usize {
    let mut v = zigzag_encode(signed);
    let mut i: usize = 0;
    loop {
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

/// Returns `None` if the varint runs past the end of `bytes`.
fn read_varint(bytes: &[u8], pos: &mut usize) -> Option<i32> {
    let mut i = *pos;
    let first = *bytes.get(i)?;
    i += 1;
    if first < 0x80 {
        *pos = i;
        return Some(zigzag_decode(first as u32));
    }
    let mut result: u32 = (first & 0x7f) as u32;
    let mut shift: u32 = 7;
    loop {
        if shift > 28 {
            break;
        }
        let byte = *bytes.get(i)?;
        i += 1;
        result |= ((byte & 0x7f) as u32) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    *pos = i;
    Some(zigzag_decode(result))
}

/// Reads a 64-bit mask. Bit `i` of the result is bit `i & 7` of byte `pos + (i >> 3)`.
#[inline]
fn read_u64_le(bytes: &[u8], pos: usize) -> Option<u64> {
    Some(u64::from_le_bytes(*bytes.get(pos..)?.first_chunk()?))
}

/// `idx` is a delta index, so it's less than `SYNC_INTERVAL - 1` and the shift can't overflow.
#[inline]
fn test_bit(mask: u64, idx: u8) -> bool {
    (mask >> idx) & 1 != 0
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
#[derive(Copy, Clone)]
struct WindowReader<'a> {
    bytes: &'a [u8],
    gen_col_pos: usize,
    orig_line_exc_pos: usize,
    orig_col_exc_pos: usize,
    gen_line_exc_pos: usize,
    src_idx_exc_pos: usize,
    gen_line_mask: u64,
    orig_line_eq_mask: u64,
    orig_col_eq_mask: u64,
    src_idx_eq_mask: u64,
    count: u8,
    flags: u8,
    gen_line_exc_next_idx: u8,
    delta_idx: u8,
}

impl<'a> WindowReader<'a> {
    /// A reader of `bytes` with an empty window.
    fn new(bytes: &'a [u8]) -> WindowReader<'a> {
        WindowReader {
            bytes,
            gen_col_pos: 0,
            orig_line_exc_pos: 0,
            orig_col_exc_pos: 0,
            gen_line_exc_pos: 0,
            src_idx_exc_pos: 0,
            gen_line_mask: 0,
            orig_line_eq_mask: 0,
            orig_col_eq_mask: 0,
            src_idx_eq_mask: 0,
            count: 0,
            flags: 0,
            gen_line_exc_next_idx: 0,
            delta_idx: 0,
        }
    }

    /// Returns `None` if the window at `start` extends past the end of `bytes`. The reader is then `done()`.
    fn parse(&mut self, start: usize) -> Option<()> {
        let bytes = self.bytes;
        // Keep the reader empty until the whole window is validated.
        self.count = 0;
        self.delta_idx = 0;
        let header: &[u8; win_hdr::GEN_COL_LANE_OFF] = bytes.get(start..)?.first_chunk()?;
        // One load covers count, flags and the three u16 LE section lengths.
        let fixed = read_u64_le(header, 0)?;
        let len_at = |off: usize| ((fixed >> (8 * off)) & 0xffff) as usize;
        let flags = (fixed >> (8 * win_hdr::FLAGS_OFF)) as u8;

        self.gen_col_pos = start + win_hdr::GEN_COL_LANE_OFF;
        self.orig_line_exc_pos = self.gen_col_pos + len_at(win_hdr::GEN_COL_LEN_OFF);
        self.orig_col_exc_pos = self.orig_line_exc_pos + len_at(win_hdr::ORIG_LINE_LEN_OFF);
        self.gen_line_mask = read_u64_le(header, win_hdr::GEN_LINE_MASK_OFF)?;
        self.orig_line_eq_mask = read_u64_le(header, win_hdr::ORIG_LINE_EQ_MASK_OFF)?;
        self.orig_col_eq_mask = read_u64_le(header, win_hdr::ORIG_COL_EQ_MASK_OFF)?;
        self.flags = flags;
        self.gen_line_exc_next_idx = 0xFF;
        if flags != 0 {
            let pos = self.orig_col_exc_pos + len_at(win_hdr::ORIG_COL_LEN_OFF);
            self.parse_flagged_sections(bytes, pos)?;
        }
        // Clamp so every delta index is below 64, the masks' width.
        self.count = ((fixed >> (8 * win_hdr::COUNT_OFF)) as u8).min(SYNC_INTERVAL as u8);
        Some(())
    }

    #[cold]
    fn parse_flagged_sections(&mut self, bytes: &[u8], mut pos: usize) -> Option<()> {
        if self.flags & FLAG_HAS_GEN_LINE_EXCEPTIONS != 0 {
            self.gen_line_exc_pos = pos;
            self.gen_line_exc_next_idx = *bytes.get(pos)?;
            // A window has at most one pair per delta.
            let mut pairs = 0;
            while *bytes.get(pos)? != 0xFF {
                if pairs == SYNC_INTERVAL - 1 {
                    return None;
                }
                pairs += 1;
                pos += 1;
                read_varint(bytes, &mut pos)?;
            }
            pos += 1;
        }
        if self.flags & FLAG_HAS_SRC_IDX != 0 {
            self.src_idx_eq_mask = read_u64_le(bytes, pos)?;
            self.src_idx_exc_pos = pos + 8;
        }
        Some(())
    }

    #[inline]
    fn done(&self) -> bool {
        self.delta_idx + 1 >= self.count
    }

    /// Applies the next delta to `state`. If a lane runs past the end of the stream, `state` is
    /// unchanged and `count` becomes 0.
    fn next(&mut self, state: &mut State) {
        if self.apply_next(state).is_none() {
            self.count = 0;
        }
    }

    fn apply_next(&mut self, state: &mut State) -> Option<()> {
        let delta_idx = self.delta_idx;
        self.delta_idx = delta_idx + 1;
        let bytes = self.bytes;

        let mut d_gen_line: i32 = test_bit(self.gen_line_mask, delta_idx) as i32;
        let d_gen_col = read_varint(bytes, &mut self.gen_col_pos)?;
        let mut d_orig_line: i32 = if test_bit(self.orig_line_eq_mask, delta_idx) {
            d_gen_line
        } else {
            read_varint(bytes, &mut self.orig_line_exc_pos)?
        };
        let d_orig_col: i32 = if test_bit(self.orig_col_eq_mask, delta_idx) {
            d_gen_col
        } else {
            read_varint(bytes, &mut self.orig_col_exc_pos)?
        };

        if self.flags != 0 {
            self.next_rare(delta_idx, &mut d_gen_line, &mut d_orig_line, state)?;
        }

        // Use wrapping adds so a corrupt delta can't trip the overflow check.
        if d_gen_line != 0 {
            state.generated_line = state.generated_line.wrapping_add(d_gen_line);
            state.generated_column = d_gen_col;
        } else {
            state.generated_column = state.generated_column.wrapping_add(d_gen_col);
        }
        state.original_line = state.original_line.wrapping_add(d_orig_line);
        state.original_column = state.original_column.wrapping_add(d_orig_col);
        Some(())
    }

    #[cold]
    fn next_rare(
        &mut self,
        delta_idx: u8,
        d_gen_line: &mut i32,
        d_orig_line: &mut i32,
        state: &mut State,
    ) -> Option<()> {
        let bytes = self.bytes;
        if self.gen_line_exc_next_idx == delta_idx {
            let mut p = self.gen_line_exc_pos + 1;
            *d_gen_line = read_varint(bytes, &mut p)?;
            if test_bit(self.orig_line_eq_mask, delta_idx) {
                *d_orig_line = *d_gen_line;
            }
            self.gen_line_exc_pos = p;
            self.gen_line_exc_next_idx = *bytes.get(p)?;
        }
        if self.flags & FLAG_HAS_SRC_IDX != 0 && !test_bit(self.src_idx_eq_mask, delta_idx) {
            let d_src_idx = read_varint(bytes, &mut self.src_idx_exc_pos)?;
            state.source_index = state.source_index.wrapping_add(d_src_idx);
        }
        Some(())
    }
}

impl InternalSourceMap<'_> {
    /// Matches the semantics of `Mapping.List.find`: returns the last mapping with
    /// generated position `<= (line, column)` whose generated line equals `line`.
    pub fn find(self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        let target_line = line.zero_based();
        let target_col = column.zero_based();

        let after = (self.sync_entries)
            .partition_point(|entry| entry.get().less_or_equal(target_line, target_col));
        let entry = self.sync_entries[..after].last()?.get();

        let mut state = entry.to_state();
        let mut reader = WindowReader::new(self.stream);
        reader.parse(entry.byte_offset as usize)?;

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

        // A `count` of 0 means the window is corrupt. Either its header says 0 or a lane overran.
        if reader.count == 0 || best.generated_line != target_line {
            return None;
        }
        Some(best.to_mapping())
    }
}

impl InternalSourceMap<'_> {
    /// Every mapping, in generated order.
    pub(crate) fn for_each(self, mut each: impl FnMut(Mapping)) {
        self.for_each_state(|state| each(state.to_mapping()));
    }

    fn for_each_state(self, mut each: impl FnMut(&State)) {
        for entry in self.sync_entries {
            let mut state = entry.get().to_state();
            let mut reader = WindowReader::new(self.stream);
            if reader.parse(entry.get().byte_offset as usize).is_none() {
                return;
            }
            each(&state);
            while !reader.done() {
                reader.next(&mut state);
                if reader.count == 0 {
                    return;
                }
                each(&state);
            }
        }
    }

    pub fn for_each_object_brace(self, mut each: impl FnMut(ObjectBrace)) {
        for brace in self.object_braces() {
            each(brace.get());
        }
    }

    /// Re-encode the full mapping stream as a standard VLQ "mappings" string. Only
    /// the inspector's inline-sourcemap path needs this.
    pub fn append_vlq_to(self, out: &mut MutableString) {
        // A 4-field VLQ segment averages ~5 bytes plus a separator. Cap by the
        // structural bound so a crafted header can't force an unbounded reserve.
        let count = self
            .mapping_count()
            .min(self.sync_entries.len().saturating_mul(SYNC_INTERVAL));
        let _ = out.grow_if_needed(count.saturating_mul(6));
        let mut prev = SourceMapState::default();
        let mut generated_line: i32 = 0;
        self.for_each_state(|state| emit_vlq(state, &mut prev, &mut generated_line, out));
    }
}

fn emit_vlq(
    state: &State,
    prev: &mut SourceMapState,
    generated_line: &mut i32,
    out: &mut MutableString,
) {
    if *generated_line < state.generated_line {
        let gap = (state.generated_line - *generated_line) as usize;
        out.list.resize(out.list.len() + gap, b';');
        prev.generated_column = 0;
        *generated_line = state.generated_line;
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
// line. The inlined `VLQSourceMap::append`/`append_line_separator`
// thus touch one line on the fast path instead of
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
    object_braces: Vec<ObjectBrace>,
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
            object_braces: Vec::new(),
        }
    }
}

impl Builder {
    pub(crate) fn init() -> Builder {
        Builder::default()
    }

    #[inline(always)]
    pub(crate) fn append_line_separator(&mut self) {
        self.pending_generated_line_delta += 1;
    }

    #[inline(always)]
    pub(crate) fn append_mapping(&mut self, current: &SourceMapState) {
        let generated_line = self.generated_line + self.pending_generated_line_delta;
        self.generated_line = generated_line;
        self.pending_generated_line_delta = 0;

        let i = self.pending_n as usize;
        debug_assert!(i < SYNC_INTERVAL);
        // SAFETY: invariant `pending_n < SYNC_INTERVAL` between flushes — the
        // tail of this fn flushes (resetting to 0) the moment it would reach
        // SYNC_INTERVAL, so on entry `pending_n <= SYNC_INTERVAL-1`. Elides the
        // per-mapping bounds check.
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

    /// Marks `last`, the last mapping. The printer does at a brace of an object literal, which is
    /// code. A block's is not, and coverage sees the same character.
    pub(crate) fn mark_object_brace(&mut self, last: &SourceMapState) {
        self.object_braces.push(ObjectBrace {
            generated: LineColumnOffset {
                lines: Ordinal(self.generated_line),
                columns: Ordinal(last.generated_column),
            },
            original: LineColumnOffset {
                lines: Ordinal(last.original_line),
                columns: Ordinal(last.original_column),
            },
        });
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
        // win_stream is bounded by total mapping count × ~5B/mapping;
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
            if d_gen_line >= 1 {
                // SAFETY: k < n_deltas <= SYNC_INTERVAL-1 == 63, so `k >> 3 <= 7`
                // and the header mask byte offset is within the zeroed 32-byte header.
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
                // SAFETY: same sub-range bound as above; after the +1 advance still within
                // [gen_line_base, gen_line_base + nd*(1+MAX_VARINT_LEN)).
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
        // n_deltas <= 63, MAX_VARINT_LEN == 5, so each
        // length field is <= 315 bytes < u16::MAX. Drop the panic edge so the hot
        // window-emit path has no unwind landing pads.
        debug_assert!(gen_col_len <= u16::MAX as usize);
        debug_assert!(orig_line_len <= u16::MAX as usize);
        debug_assert!(orig_col_len <= u16::MAX as usize);
        // SAFETY: GEN_COL_LEN_OFF/ORIG_LINE_LEN_OFF/ORIG_COL_LEN_OFF are fixed
        // offsets within the zeroed 32-byte header at `buf_ptr`.
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

    /// Serialize into the single-allocation blob layout.
    pub(crate) fn finalize(&mut self) -> MutableString {
        self.flush_window();

        let sync_entries = bun_core::slice_as_bytes(&self.sync_entries);
        let object_braces = bun_core::slice_as_bytes(&self.object_braces);
        let stream_offset = HEADER_SIZE + sync_entries.len();
        let total = stream_offset + self.win_stream.len() + object_braces.len() + STREAM_TAIL_PAD;

        let mut out = MutableString::init_empty();
        out.list.reserve_exact(total);
        out.list.extend_from_slice(bun_core::bytes_of(&Header {
            total_len: total as u64,
            mapping_count: u64::from(self.count),
            unused: 0,
            object_brace_count: u32::try_from(self.object_braces.len()).expect("int cast"),
            sync_count: u32::try_from(self.sync_entries.len()).expect("int cast"),
            stream_offset: u32::try_from(stream_offset).expect("int cast"),
        }));
        out.list.extend_from_slice(sync_entries);
        out.list.extend_from_slice(&self.win_stream);
        out.list.extend_from_slice(object_braces);
        out.list.extend_from_slice(&[0; STREAM_TAIL_PAD]);
        debug_assert_eq!(out.list.len(), total);
        out
    }
}

#[derive(Debug, Copy, Clone)]
pub enum FromVlqError {
    InvalidSourceMap,
}

/// Decode a standard VLQ "mappings" string and re-encode it as an
/// InternalSourceMap blob. Used by `bun build --compile` to convert the
/// bundler's JSON sourcemap once at build time so the standalone executable
/// can remap stack traces without ever materializing a `Mapping.List`.
///
/// 1-field segments are skipped (no original location). The 5th field
/// (`name_index`) is decoded but discarded; nothing in the stack-trace remap
/// path reads it.
pub fn from_vlq(vlq: &[u8]) -> Result<Box<[u8]>, FromVlqError> {
    /// Accumulate a VLQ delta into an absolute value. Like `Mapping::parse`,
    /// reject streams whose absolute value overflows `i32` or goes negative —
    /// both make the mapping meaningless, and unchecked garbage here would
    /// flow into every downstream size/index computation.
    #[inline]
    fn accumulate(absolute: i32, delta: i32) -> Result<i32, FromVlqError> {
        absolute
            .checked_add(delta)
            .filter(|v| *v >= 0)
            .ok_or(FromVlqError::InvalidSourceMap)
    }

    let mut builder = Builder::init();

    let mut generated_column: i32 = 0;
    let mut source_index: i32 = 0;
    let mut original_line: i32 = 0;
    let mut original_column: i32 = 0;

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
        generated_column = accumulate(generated_column, gc.value)?;
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
        source_index = accumulate(source_index, si.value)?;
        remain = &remain[si.start as usize..];

        let ol = vlq_decode(remain, 0);
        if ol.start == 0 {
            return Err(FromVlqError::InvalidSourceMap);
        }
        original_line = accumulate(original_line, ol.value)?;
        remain = &remain[ol.start as usize..];

        let oc = vlq_decode(remain, 0);
        if oc.start == 0 {
            return Err(FromVlqError::InvalidSourceMap);
        }
        original_column = accumulate(original_column, oc.value)?;
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

        builder.append_mapping(&SourceMapState {
            generated_column,
            source_index,
            original_line,
            original_column,
            ..SourceMapState::default()
        });
    }

    Ok(builder.finalize().list.into_boxed_slice())
}
