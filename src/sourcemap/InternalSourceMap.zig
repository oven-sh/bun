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

const InternalSourceMap = @This();

/// A sync entry is emitted every `sync_interval` mappings.
pub const sync_interval = 64;

pub const header_size = 32;

/// `readVarint`'s 1-byte fast path reads `bytes[pos]` unconditionally; the
/// exception cursors in `WindowReader` advance to one byte past their last
/// varint, so a 1-byte tail pad keeps that read in-bounds for a window at the
/// very end of the stream.
const stream_tail_pad = 1;

/// The blob is stored in the SavedSourceMap table as a tagged pointer to its
/// first byte. This struct is a thin view over that pointer; it owns no
/// separate allocation.
data: [*]const u8,

pub const SyncEntry = extern struct {
    generated_line: i32,
    generated_column: i32,
    byte_offset: u32,
    original_line: i32,
    original_column: i32,
    source_index: i32,

    comptime {
        bun.assert(@sizeOf(SyncEntry) == 24);
    }

    inline fn lessOrEqual(sp: SyncEntry, line: i32, col: i32) bool {
        return sp.generated_line < line or
            (sp.generated_line == line and sp.generated_column <= col);
    }

    inline fn toState(sp: SyncEntry) State {
        return .{
            .generated_line = sp.generated_line,
            .generated_column = sp.generated_column,
            .source_index = sp.source_index,
            .original_line = sp.original_line,
            .original_column = sp.original_column,
        };
    }
};

pub inline fn totalLen(self: InternalSourceMap) usize {
    return @as(u64, @bitCast(self.data[0..8].*));
}

pub inline fn mappingCount(self: InternalSourceMap) usize {
    return @as(u64, @bitCast(self.data[8..16].*));
}

pub inline fn inputLineCount(self: InternalSourceMap) usize {
    return @as(u64, @bitCast(self.data[16..24].*));
}

pub inline fn syncCount(self: InternalSourceMap) u32 {
    return @as(u32, @bitCast(self.data[24..28].*));
}

pub inline fn streamOffset(self: InternalSourceMap) u32 {
    return @as(u32, @bitCast(self.data[28..32].*));
}

pub fn syncEntry(self: InternalSourceMap, index: usize) SyncEntry {
    const off = header_size + index * @sizeOf(SyncEntry);
    return @as(SyncEntry, @bitCast(self.data[off..][0..@sizeOf(SyncEntry)].*));
}

pub inline fn stream(self: InternalSourceMap) []const u8 {
    return self.data[self.streamOffset()..self.totalLen()];
}

/// Only call this when the blob was heap-allocated by `Builder`/`fromVLQ` (e.g.
/// entries in `SavedSourceMap`). Do NOT call on views over the standalone
/// module graph section or any other borrowed memory.
pub fn deinit(self: InternalSourceMap) void {
    bun.default_allocator.free(@constCast(self.data[0..self.totalLen()]));
}

pub fn memoryCost(self: InternalSourceMap) usize {
    return self.totalLen();
}

/// Sanity-check the blob's outer header (total_len, sync_count, stream_offset)
/// against its actual length so a *truncated* embedded section in a `--compile`
/// binary degrades to "no sourcemap". This does not walk per-window
/// `SyncEntry.byte_offset`/section lengths; the blob is self-produced at build
/// time, and a tampered executable already implies arbitrary execution.
pub fn isValidBlob(blob: []const u8) bool {
    if (blob.len < header_size) return false;
    const self = InternalSourceMap{ .data = blob.ptr };
    const total = self.totalLen();
    if (total != blob.len) return false;
    const sync_n = self.syncCount();
    const stream_off = self.streamOffset();
    const sync_end = header_size + @as(usize, sync_n) * @sizeOf(SyncEntry);
    if (stream_off < sync_end) return false;
    if (stream_off > total) return false;
    if (total < stream_off + stream_tail_pad) return false;
    return true;
}

const State = struct {
    generated_line: i32 = 0,
    generated_column: i32 = 0,
    source_index: i32 = 0,
    original_line: i32 = 0,
    original_column: i32 = 0,

    inline fn lessOrEqual(self: State, line: i32, col: i32) bool {
        return self.generated_line < line or
            (self.generated_line == line and self.generated_column <= col);
    }

    fn toMapping(self: State) Mapping {
        return .{
            .generated = .{
                .lines = bun.Ordinal.fromZeroBased(self.generated_line),
                .columns = bun.Ordinal.fromZeroBased(self.generated_column),
            },
            .original = .{
                .lines = bun.Ordinal.fromZeroBased(self.original_line),
                .columns = bun.Ordinal.fromZeroBased(self.original_column),
            },
            .source_index = self.source_index,
            .name_index = -1,
        };
    }
};

inline fn zigzagEncode(value: i32) u32 {
    return @bitCast((value << 1) ^ (value >> 31));
}

inline fn zigzagDecode(value: u32) i32 {
    return @as(i32, @bitCast(value >> 1)) ^ (-@as(i32, @bitCast(value & 1)));
}

/// Max bytes for a zig-zag-encoded i32 in 7-bit varint form: ceil(32 / 7) = 5.
const max_varint_len = 5;

fn writeVarint(buf: [*]u8, signed: i32) usize {
    var v = zigzagEncode(signed);
    var i: usize = 0;
    while (true) {
        var byte: u8 = @intCast(v & 0x7f);
        v >>= 7;
        if (v != 0) byte |= 0x80;
        buf[i] = byte;
        i += 1;
        if (v == 0) return i;
    }
}

fn readVarint(bytes: []const u8, pos: *usize) i32 {
    var i = pos.*;
    const first = bytes[i];
    i += 1;
    if (first < 0x80) {
        pos.* = i;
        return zigzagDecode(first);
    }
    var result: u32 = first & 0x7f;
    var shift: u6 = 7;
    while (true) {
        if (i >= bytes.len or shift > 28) break;
        const byte = bytes[i];
        i += 1;
        result |= @as(u32, byte & 0x7f) << @as(u5, @intCast(shift));
        if (byte & 0x80 == 0) break;
        shift += 7;
    }
    pos.* = i;
    return zigzagDecode(result);
}

inline fn testBit(base: [*]const u8, idx: usize) bool {
    return (base[idx >> 3] >> @as(u3, @intCast(idx & 7))) & 1 != 0;
}

const flag_has_gen_line_exceptions: u8 = 1 << 2;
const flag_has_src_idx: u8 = 1 << 3;

/// Fixed window header layout. The three equality masks are always present
/// and padded to 8 bytes so `parse()` is straight-line; only the rare
/// gen-line-exception / src-idx sections are conditional.
const win_hdr = struct {
    const count_off = 0;
    const flags_off = 1;
    const gen_col_len_off = 2;
    const orig_line_len_off = 4;
    const orig_col_len_off = 6;
    const gen_line_mask_off = 8;
    const orig_line_eq_mask_off = 16;
    const orig_col_eq_mask_off = 24;
    const gen_col_lane_off = 32;
};

/// Parses a window header and steps through its deltas in order. Exception
/// streams are consumed in order, so a reader is forward-only.
const WindowReader = struct {
    bytes: []const u8,
    base: [*]const u8,
    gen_col_pos: usize,
    orig_line_exc_pos: usize,
    orig_col_exc_pos: usize,
    gen_line_exc_pos: usize,
    src_idx_mask: [*]const u8,
    src_idx_exc_pos: usize,
    count: u8,
    flags: u8,
    gen_line_exc_next_idx: u8,
    delta_idx: u8,

    fn parse(r: *WindowReader, bytes: []const u8, start: usize) void {
        const b = bytes.ptr + start;
        r.bytes = bytes;
        r.base = b;
        // Clamp `count` so a corrupted header byte cannot drive `next()` past
        // `FindCacheSlot.decoded[sync_interval]`. Well-formed blobs never
        // exceed K; this is defense-in-depth for the standalone-graph path.
        r.count = @min(b[win_hdr.count_off], sync_interval);
        const flags = b[win_hdr.flags_off];
        r.flags = flags;
        r.delta_idx = 0;

        const gen_col_len: usize = @as(u16, @bitCast(b[win_hdr.gen_col_len_off..][0..2].*));
        const orig_line_len: usize = @as(u16, @bitCast(b[win_hdr.orig_line_len_off..][0..2].*));
        const orig_col_len: usize = @as(u16, @bitCast(b[win_hdr.orig_col_len_off..][0..2].*));

        r.gen_col_pos = start + win_hdr.gen_col_lane_off;
        r.orig_line_exc_pos = r.gen_col_pos + gen_col_len;
        r.orig_col_exc_pos = r.orig_line_exc_pos + orig_line_len;
        var pos = r.orig_col_exc_pos + orig_col_len;
        r.gen_line_exc_next_idx = 0xFF;
        if (flags != 0) {
            if (flags & flag_has_gen_line_exceptions != 0 and pos < bytes.len) {
                r.gen_line_exc_pos = pos;
                r.gen_line_exc_next_idx = bytes[pos];
                while (pos < bytes.len and bytes[pos] != 0xFF) {
                    pos += 1;
                    _ = readVarint(bytes, &pos);
                }
                pos += 1;
            }
            if (flags & flag_has_src_idx != 0) {
                r.src_idx_mask = bytes.ptr + pos;
                pos += 8;
                r.src_idx_exc_pos = pos;
            }
        }
    }

    inline fn done(self: *const WindowReader) bool {
        return self.delta_idx + 1 >= self.count;
    }

    fn next(self: *WindowReader, state: *State) void {
        const delta_idx = self.delta_idx;
        self.delta_idx = delta_idx + 1;
        const b = self.base;

        var d_gen_line: i32 = if (testBit(b + win_hdr.gen_line_mask_off, delta_idx)) 1 else 0;
        const d_gen_col = readVarint(self.bytes, &self.gen_col_pos);
        var d_orig_line: i32 = if (testBit(b + win_hdr.orig_line_eq_mask_off, delta_idx)) d_gen_line else readVarint(self.bytes, &self.orig_line_exc_pos);
        const d_orig_col: i32 = if (testBit(b + win_hdr.orig_col_eq_mask_off, delta_idx)) d_gen_col else readVarint(self.bytes, &self.orig_col_exc_pos);

        if (self.flags != 0) {
            self.nextRare(delta_idx, &d_gen_line, &d_orig_line, state);
        }

        if (d_gen_line != 0) {
            state.generated_line += d_gen_line;
            state.generated_column = d_gen_col;
        } else {
            state.generated_column += d_gen_col;
        }
        state.original_line += d_orig_line;
        state.original_column += d_orig_col;
    }

    fn nextRare(self: *WindowReader, delta_idx: u8, d_gen_line: *i32, d_orig_line: *i32, state: *State) void {
        @branchHint(.cold);
        if (self.gen_line_exc_next_idx == delta_idx) {
            var p = self.gen_line_exc_pos + 1;
            d_gen_line.* = readVarint(self.bytes, &p);
            if (testBit(self.base + win_hdr.orig_line_eq_mask_off, delta_idx)) d_orig_line.* = d_gen_line.*;
            self.gen_line_exc_pos = p;
            self.gen_line_exc_next_idx = self.bytes[p];
        }
        if (self.flags & flag_has_src_idx != 0 and !testBit(self.src_idx_mask, delta_idx)) {
            state.source_index += readVarint(self.bytes, &self.src_idx_exc_pos);
        }
    }
};

/// One decoded-window prefix. See `FindCache` for the multi-slot wrapper that
/// callers actually hold.
pub const FindCacheSlot = struct {
    data: ?[*]const u8 = null,
    sync_idx: u32 = 0,
    decoded_count: u8 = 0,
    reader: WindowReader = undefined,
    decoded: [sync_interval]State = undefined,
};

/// Per-caller decode cache. A single stack trace typically touches a handful
/// of distinct windows (frames at different depths in the same file, or in
/// different small files), so a one-slot cache thrashes. This is a small
/// fully-associative set keyed by `(blob ptr, sync_idx)` with round-robin
/// eviction; once a window is decoded it stays warm across the whole stack and
/// across subsequent stacks until evicted. ~21 KB per `SavedSourceMap`.
pub const FindCache = struct {
    pub const slot_count = 16;

    /// Parallel key array kept hot and contiguous so the associative scan is a
    /// single 256-byte sweep; the heavyweight `FindCacheSlot` payloads live in
    /// a separate array so a miss doesn't drag them through the cache.
    keys: [slot_count]Key = [_]Key{.{}} ** slot_count,
    slots: [slot_count]FindCacheSlot = [_]FindCacheSlot{.{}} ** slot_count,
    next_victim: u8 = 0,

    const Key = struct { data: ?[*]const u8 = null, sync_idx: u32 = 0 };

    pub fn invalidate(self: *FindCache, data: [*]const u8) void {
        for (&self.keys, &self.slots) |*k, *s| if (k.data == data) {
            k.data = null;
            s.data = null;
        };
    }

    pub fn invalidateAll(self: *FindCache) void {
        for (&self.keys, &self.slots) |*k, *s| {
            k.data = null;
            s.data = null;
        }
    }

    inline fn slotFor(self: *FindCache, data: [*]const u8, sync_idx: u32) *FindCacheSlot {
        for (&self.keys, 0..) |k, i| {
            if (k.data == data and k.sync_idx == sync_idx) return &self.slots[i];
        }
        for (&self.keys, 0..) |k, i| {
            if (k.data == null) {
                self.keys[i] = .{ .data = data, .sync_idx = sync_idx };
                return &self.slots[i];
            }
        }
        const v = self.next_victim;
        self.next_victim = (v + 1) & (slot_count - 1);
        self.keys[v] = .{ .data = data, .sync_idx = sync_idx };
        return &self.slots[v];
    }
};

fn locateWindow(self: InternalSourceMap, target_line: i32, target_col: i32) ?u32 {
    const n_sync = self.syncCount();
    if (n_sync == 0) return null;
    var lo: usize = 0;
    var hi: usize = n_sync;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        if (self.syncEntry(mid).lessOrEqual(target_line, target_col)) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if (lo == 0) return null;
    return @intCast(lo - 1);
}

fn seedWindow(self: InternalSourceMap, sync_idx: u32, state: *State, reader: *WindowReader) void {
    const se = self.syncEntry(sync_idx);
    state.* = se.toState();
    reader.parse(self.stream(), se.byte_offset);
}

pub fn findWithCache(self: InternalSourceMap, line: bun.Ordinal, column: bun.Ordinal, set: *FindCache) ?Mapping {
    const target_line = line.zeroBased();
    const target_col = column.zeroBased();

    const sync_idx = self.locateWindow(target_line, target_col) orelse return null;
    const cache = set.slotFor(self.data, sync_idx);

    if (cache.data != self.data or cache.sync_idx != sync_idx or cache.decoded_count == 0) {
        self.seedWindow(sync_idx, &cache.decoded[0], &cache.reader);
        cache.data = self.data;
        cache.sync_idx = sync_idx;
        cache.decoded_count = 1;
    }

    {
        var decoded_count = cache.decoded_count;
        var state = cache.decoded[decoded_count - 1];
        while (!cache.reader.done() and state.lessOrEqual(target_line, target_col)) {
            cache.reader.next(&state);
            cache.decoded[decoded_count] = state;
            decoded_count += 1;
        }
        cache.decoded_count = decoded_count;
    }

    const decoded = cache.decoded[0..cache.decoded_count];
    var lo: usize = 0;
    var hi: usize = decoded.len;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        if (decoded[mid].lessOrEqual(target_line, target_col)) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if (lo == 0) return null;
    const best = decoded[lo - 1];
    if (best.generated_line != target_line) return null;
    return best.toMapping();
}

/// Matches the semantics of `Mapping.List.find`: returns the last mapping with
/// generated position `<= (line, column)` whose generated line equals `line`.
pub fn find(self: InternalSourceMap, line: bun.Ordinal, column: bun.Ordinal) ?Mapping {
    const target_line = line.zeroBased();
    const target_col = column.zeroBased();

    const sync_idx = self.locateWindow(target_line, target_col) orelse return null;

    var state: State = .{};
    var reader: WindowReader = undefined;
    self.seedWindow(sync_idx, &state, &reader);

    var best = state;
    while (!reader.done()) {
        var nxt = state;
        reader.next(&nxt);
        if (!nxt.lessOrEqual(target_line, target_col)) break;
        best = nxt;
        state = nxt;
    }

    if (best.generated_line != target_line) return null;
    return best.toMapping();
}

/// Stateful forward cursor. `moveTo` is cheap when successive targets are
/// monotonically non-decreasing in generated position; otherwise it reseeks via
/// the sync index.
///
/// Invariant: when `has_state`, `reader` is positioned such that calling
/// `advanceOne()` produces the mapping immediately after `peek orelse state`.
pub const Cursor = struct {
    map: InternalSourceMap,
    state: State,
    peek: ?State,
    reader: WindowReader,
    sync_idx: u32,
    has_state: bool,

    pub fn init(map: InternalSourceMap) Cursor {
        return .{ .map = map, .state = .{}, .peek = null, .reader = undefined, .sync_idx = 0, .has_state = false };
    }

    pub fn moveTo(self: *Cursor, line: bun.Ordinal, column: bun.Ordinal) ?Mapping {
        const target_line = line.zeroBased();
        const target_col = column.zeroBased();

        if (!self.has_state or !self.state.lessOrEqual(target_line, target_col)) {
            if (!self.reseek(target_line, target_col)) return null;
        }

        while (true) {
            if (self.peek) |p| {
                if (!p.lessOrEqual(target_line, target_col)) break;
                self.state = p;
                self.peek = null;
            }
            const nxt = self.advanceOne() orelse break;
            if (nxt.lessOrEqual(target_line, target_col)) {
                self.state = nxt;
            } else {
                self.peek = nxt;
                break;
            }
        }

        if (self.state.generated_line != target_line) return null;
        return self.state.toMapping();
    }

    fn advanceOne(self: *Cursor) ?State {
        if (self.reader.done()) {
            const n_sync = self.map.syncCount();
            if (self.sync_idx + 1 >= n_sync) return null;
            self.sync_idx += 1;
            var seed: State = .{};
            self.map.seedWindow(self.sync_idx, &seed, &self.reader);
            return seed;
        }
        var nxt = self.peek orelse self.state;
        self.reader.next(&nxt);
        return nxt;
    }

    fn reseek(self: *Cursor, target_line: i32, target_col: i32) bool {
        const idx = self.map.locateWindow(target_line, target_col) orelse {
            self.has_state = false;
            return false;
        };
        self.sync_idx = idx;
        self.map.seedWindow(idx, &self.state, &self.reader);
        self.peek = null;
        self.has_state = true;
        return true;
    }
};

pub fn cursor(self: InternalSourceMap) Cursor {
    return Cursor.init(self);
}

/// Re-encode the full mapping stream as a standard VLQ "mappings" string. Only
/// the inspector's inline-sourcemap path needs this.
pub fn appendVLQTo(self: InternalSourceMap, out: *MutableString) void {
    const n_sync = self.syncCount();
    var prev: SourceMapState = .{};
    var generated_line: i32 = 0;

    var idx: u32 = 0;
    while (idx < n_sync) : (idx += 1) {
        var state: State = .{};
        var reader: WindowReader = undefined;
        self.seedWindow(idx, &state, &reader);
        emitVLQ(&state, &prev, &generated_line, out);
        while (!reader.done()) {
            reader.next(&state);
            emitVLQ(&state, &prev, &generated_line, out);
        }
    }
}

fn emitVLQ(state: *const State, prev: *SourceMapState, generated_line: *i32, out: *MutableString) void {
    while (generated_line.* < state.generated_line) : (generated_line.* += 1) {
        out.appendChar(';') catch |err| bun.handleOom(err);
        prev.generated_column = 0;
    }
    const current: SourceMapState = .{
        .generated_line = state.generated_line,
        .generated_column = state.generated_column,
        .source_index = state.source_index,
        .original_line = state.original_line,
        .original_column = state.original_column,
    };
    const last_byte: u8 = if (out.list.items.len > 0)
        out.list.items[out.list.items.len - 1]
    else
        0;
    SourceMap.appendMappingToBuffer(out, last_byte, prev.*, current);
    prev.* = current;
}

pub const Builder = struct {
    allocator: std.mem.Allocator,
    sync_entries: std.ArrayListUnmanaged(SyncEntry) = .{},
    win_stream: std.ArrayListUnmanaged(u8) = .{},
    pending: [sync_interval]State = undefined,
    pending_n: u8 = 0,
    pending_generated_line_delta: i32 = 0,
    state: State = .{},
    count: u32 = 0,
    finalized: ?MutableString = null,

    pub fn init(allocator: std.mem.Allocator) Builder {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *Builder) void {
        self.sync_entries.deinit(self.allocator);
        self.win_stream.deinit(self.allocator);
        if (self.finalized) |*m| m.deinit();
    }

    pub fn appendLineSeparator(self: *Builder) void {
        self.pending_generated_line_delta += 1;
    }

    pub fn appendMapping(self: *Builder, current: SourceMapState) void {
        self.state = .{
            .generated_line = self.state.generated_line + self.pending_generated_line_delta,
            .generated_column = current.generated_column,
            .source_index = current.source_index,
            .original_line = current.original_line,
            .original_column = current.original_column,
        };
        self.pending_generated_line_delta = 0;

        self.pending[self.pending_n] = self.state;
        self.pending_n += 1;
        self.count += 1;

        if (self.pending_n == sync_interval) self.flushWindow();
    }

    const Delta = struct { d_gen_line: i32, d_gen_col: i32, d_orig_line: i32, d_orig_col: i32, d_src_idx: i32 };

    fn flushWindow(self: *Builder) void {
        const n = self.pending_n;
        if (n == 0) return;
        const seed = self.pending[0];
        const start_off: u32 = @intCast(self.win_stream.items.len);
        self.sync_entries.append(self.allocator, .{
            .generated_line = seed.generated_line,
            .generated_column = seed.generated_column,
            .byte_offset = start_off,
            .original_line = seed.original_line,
            .original_column = seed.original_column,
            .source_index = seed.source_index,
        }) catch |err| bun.handleOom(err);

        const n_deltas: usize = n - 1;
        var deltas: [sync_interval - 1]Delta = undefined;
        var flags: u8 = 0;
        var prev = seed;
        for (self.pending[1..n], 0..) |cur, k| {
            const d_gen_line = cur.generated_line - prev.generated_line;
            const d_gen_col = if (d_gen_line != 0) cur.generated_column else cur.generated_column - prev.generated_column;
            const d_orig_line = cur.original_line - prev.original_line;
            const d_orig_col = cur.original_column - prev.original_column;
            const d_src_idx = cur.source_index - prev.source_index;
            deltas[k] = .{ .d_gen_line = d_gen_line, .d_gen_col = d_gen_col, .d_orig_line = d_orig_line, .d_orig_col = d_orig_col, .d_src_idx = d_src_idx };
            if (d_gen_line > 1 or d_gen_line < 0) flags |= flag_has_gen_line_exceptions;
            if (d_src_idx != 0) flags |= flag_has_src_idx;
            prev = cur;
        }

        var cap: usize = win_hdr.gen_col_lane_off + 3 * n_deltas * max_varint_len;
        if (flags & flag_has_gen_line_exceptions != 0) cap += n_deltas * (1 + max_varint_len) + 1;
        if (flags & flag_has_src_idx != 0) cap += 8 + n_deltas * max_varint_len;

        self.win_stream.ensureUnusedCapacity(self.allocator, cap) catch |err| bun.handleOom(err);
        const base = self.win_stream.items.len;
        self.win_stream.items.len += cap;
        const buf = self.win_stream.items[base..][0..cap];
        @memset(buf[0..win_hdr.gen_col_lane_off], 0);

        buf[win_hdr.count_off] = n;
        buf[win_hdr.flags_off] = flags;

        var w: usize = win_hdr.gen_col_lane_off;
        for (0..n_deltas) |k| {
            const d = deltas[k];
            const bit = @as(u8, 1) << @as(u3, @intCast(k & 7));
            if (d.d_gen_line >= 1) buf[win_hdr.gen_line_mask_off + (k >> 3)] |= bit;
            if (d.d_orig_line == d.d_gen_line) buf[win_hdr.orig_line_eq_mask_off + (k >> 3)] |= bit;
            if (d.d_orig_col == d.d_gen_col) buf[win_hdr.orig_col_eq_mask_off + (k >> 3)] |= bit;
            w += writeVarint(buf[w..].ptr, d.d_gen_col);
        }
        const gen_col_len: u16 = @intCast(w - win_hdr.gen_col_lane_off);
        buf[win_hdr.gen_col_len_off..][0..2].* = @bitCast(gen_col_len);

        const orig_line_start = w;
        for (deltas[0..n_deltas]) |d| {
            if (d.d_orig_line != d.d_gen_line) w += writeVarint(buf[w..].ptr, d.d_orig_line);
        }
        const orig_line_len: u16 = @intCast(w - orig_line_start);
        const orig_col_start = w;
        for (deltas[0..n_deltas]) |d| {
            if (d.d_orig_col != d.d_gen_col) w += writeVarint(buf[w..].ptr, d.d_orig_col);
        }
        const orig_col_len: u16 = @intCast(w - orig_col_start);
        buf[win_hdr.orig_line_len_off..][0..2].* = @bitCast(orig_line_len);
        buf[win_hdr.orig_col_len_off..][0..2].* = @bitCast(orig_col_len);

        if (flags & flag_has_gen_line_exceptions != 0) {
            for (0..n_deltas) |k| {
                if (deltas[k].d_gen_line > 1 or deltas[k].d_gen_line < 0) {
                    buf[w] = @intCast(k);
                    w += 1;
                    w += writeVarint(buf[w..].ptr, deltas[k].d_gen_line);
                }
            }
            buf[w] = 0xFF;
            w += 1;
        }
        if (flags & flag_has_src_idx != 0) {
            const mask_off = w;
            @memset(buf[w..][0..8], 0);
            w += 8;
            for (0..n_deltas) |k| {
                if (deltas[k].d_src_idx == 0) {
                    buf[mask_off + (k >> 3)] |= @as(u8, 1) << @as(u3, @intCast(k & 7));
                }
            }
            for (deltas[0..n_deltas]) |d| {
                if (d.d_src_idx != 0) w += writeVarint(buf[w..].ptr, d.d_src_idx);
            }
        }

        self.win_stream.items.len = base + w;
        self.pending_n = 0;
    }

    /// Serialize into the single-allocation blob layout. The first 24 header
    /// bytes are left for `Chunk.Builder.generateChunk` to fill in (length,
    /// count, input line count) so this path flows through the existing
    /// `Chunk.buffer` plumbing unchanged.
    pub fn finalize(self: *Builder) *MutableString {
        if (self.finalized) |*m| return m;

        self.flushWindow();

        const sync_bytes = self.sync_entries.items.len * @sizeOf(SyncEntry);
        const stream_offset: u32 = @intCast(header_size + sync_bytes);
        const total: usize = stream_offset + self.win_stream.items.len + stream_tail_pad;

        var out = MutableString.initEmpty(self.allocator);
        out.list.resize(self.allocator, total) catch |err| bun.handleOom(err);
        const blob = out.list.items;

        @memset(blob[0..24], 0);
        blob[24..28].* = @bitCast(@as(u32, @intCast(self.sync_entries.items.len)));
        blob[28..32].* = @bitCast(stream_offset);
        if (sync_bytes > 0) {
            @memcpy(blob[header_size..][0..sync_bytes], std.mem.sliceAsBytes(self.sync_entries.items));
        }
        @memcpy(blob[stream_offset..][0..self.win_stream.items.len], self.win_stream.items);
        @memset(blob[total - stream_tail_pad ..][0..stream_tail_pad], 0);

        self.win_stream.clearAndFree(self.allocator);
        self.sync_entries.clearAndFree(self.allocator);

        self.finalized = out;
        return &self.finalized.?;
    }
};

/// Decode a standard VLQ "mappings" string and re-encode it as an
/// InternalSourceMap blob. Used by `bun build --compile` to convert the
/// bundler's JSON sourcemap once at build time so the standalone executable
/// can remap stack traces without ever materializing a `Mapping.List`.
///
/// 1-field segments are skipped (no original location). The 5th field
/// (`name_index`) is decoded but discarded; nothing in the stack-trace remap
/// path reads it.
pub fn fromVLQ(
    allocator: std.mem.Allocator,
    vlq: []const u8,
    input_line_count_hint: u32,
) error{InvalidSourceMap}![]u8 {
    var builder = Builder.init(allocator);
    errdefer builder.deinit();

    var generated_column: i32 = 0;
    var source_index: i32 = 0;
    var original_line: i32 = 0;
    var original_column: i32 = 0;
    var max_original_line: i32 = 0;

    var remain = vlq;
    while (remain.len > 0) {
        if (remain[0] == ';') {
            generated_column = 0;
            while (remain.len > 0 and remain[0] == ';') {
                builder.appendLineSeparator();
                remain = remain[1..];
            }
            if (remain.len == 0) break;
        }

        const gc = VLQ.decode(remain, 0);
        if (gc.start == 0) return error.InvalidSourceMap;
        generated_column += gc.value;
        remain = remain[gc.start..];

        if (remain.len == 0 or remain[0] == ',' or remain[0] == ';') {
            if (remain.len > 0 and remain[0] == ',') remain = remain[1..];
            continue;
        }

        const si = VLQ.decode(remain, 0);
        if (si.start == 0) return error.InvalidSourceMap;
        source_index += si.value;
        remain = remain[si.start..];

        const ol = VLQ.decode(remain, 0);
        if (ol.start == 0) return error.InvalidSourceMap;
        original_line += ol.value;
        remain = remain[ol.start..];

        const oc = VLQ.decode(remain, 0);
        if (oc.start == 0) return error.InvalidSourceMap;
        original_column += oc.value;
        remain = remain[oc.start..];

        if (remain.len > 0 and remain[0] != ',' and remain[0] != ';') {
            const ni = VLQ.decode(remain, 0);
            if (ni.start == 0) return error.InvalidSourceMap;
            remain = remain[ni.start..];
        }
        if (remain.len > 0 and remain[0] == ',') remain = remain[1..];

        max_original_line = @max(max_original_line, original_line);
        builder.appendMapping(.{
            .generated_column = generated_column,
            .source_index = source_index,
            .original_line = original_line,
            .original_column = original_column,
        });
    }

    const out = builder.finalize();
    const blob = out.list.items;
    const total_len: u64 = @intCast(blob.len);
    const mapping_count: u64 = builder.count;
    const input_lines: u64 = @max(
        @as(u64, input_line_count_hint),
        @as(u64, @intCast(max_original_line)) + 1,
    );
    blob[0..8].* = @bitCast(total_len);
    blob[8..16].* = @bitCast(mapping_count);
    blob[16..24].* = @bitCast(input_lines);

    const owned = out.list.toOwnedSlice(allocator) catch |err| bun.handleOom(err);
    builder.finalized = null;
    return owned;
}

/// Exposed via `bun:internal-for-testing` so the round-trip test can drive
/// `fromVLQ`/`appendVLQTo`/`find` directly without going through the
/// transpiler or `--compile`.
pub const TestingAPIs = struct {
    pub fn fromVLQ(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const vlq_str = try callframe.argument(0).toBunString(globalThis);
        defer vlq_str.deref();
        const vlq = vlq_str.toUTF8(bun.default_allocator);
        defer vlq.deinit();

        const blob = InternalSourceMap.fromVLQ(bun.default_allocator, vlq.slice(), 0) catch {
            return globalThis.throw("InternalSourceMap.fromVLQ: invalid VLQ input", .{});
        };
        defer bun.default_allocator.free(blob);
        return jsc.ArrayBuffer.createUint8Array(globalThis, blob);
    }

    pub fn toVLQ(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const ab = callframe.argument(0).asArrayBuffer(globalThis) orelse {
            return globalThis.throw("InternalSourceMap.toVLQ: expected Uint8Array", .{});
        };
        const bytes = ab.byteSlice();
        if (!isValidBlob(bytes)) {
            return globalThis.throw("InternalSourceMap.toVLQ: invalid blob", .{});
        }
        const ism = InternalSourceMap{ .data = bytes.ptr };
        var out = MutableString.initEmpty(bun.default_allocator);
        defer out.deinit();
        ism.appendVLQTo(&out);
        return bun.String.createUTF8ForJS(globalThis, out.list.items);
    }

    pub fn find(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const ab = callframe.argument(0).asArrayBuffer(globalThis) orelse {
            return globalThis.throw("InternalSourceMap.find: expected Uint8Array", .{});
        };
        const bytes = ab.byteSlice();
        if (!isValidBlob(bytes)) {
            return globalThis.throw("InternalSourceMap.find: invalid blob", .{});
        }
        const line = callframe.argument(1).toInt32();
        const col = callframe.argument(2).toInt32();
        if (line < 0 or col < 0) return .null;
        const ism = InternalSourceMap{ .data = bytes.ptr };
        const mapping = ism.find(.fromZeroBased(line), .fromZeroBased(col)) orelse return .null;

        const obj = jsc.JSValue.createEmptyObject(globalThis, 5);
        obj.put(globalThis, jsc.ZigString.static("generatedLine"), .jsNumber(mapping.generated.lines.zeroBased()));
        obj.put(globalThis, jsc.ZigString.static("generatedColumn"), .jsNumber(mapping.generated.columns.zeroBased()));
        obj.put(globalThis, jsc.ZigString.static("originalLine"), .jsNumber(mapping.original.lines.zeroBased()));
        obj.put(globalThis, jsc.ZigString.static("originalColumn"), .jsNumber(mapping.original.columns.zeroBased()));
        obj.put(globalThis, jsc.ZigString.static("sourceIndex"), .jsNumber(mapping.source_index));
        return obj;
    }
};

const std = @import("std");

const SourceMap = @import("./sourcemap.zig");
const Mapping = SourceMap.Mapping;
const SourceMapState = SourceMap.SourceMapState;
const VLQ = SourceMap.VLQ;

const bun = @import("bun");
const MutableString = bun.MutableString;
const jsc = bun.jsc;
