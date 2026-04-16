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
//! InternalSourceMap keeps VLQ's good idea -- store small signed deltas, not
//! absolutes -- but drops the base64 framing and adds a random-access index so
//! lookups never need to materialize the whole thing. The blob is what
//! `js_printer` writes directly, what `RuntimeTranspilerCache` persists to
//! disk, and what `bun build --compile` embeds in the standalone executable.
//!
//! ## Design
//!
//! Stream. Each mapping is five zig-zag signed-LEB128 varints:
//! (d_generated_line, d_generated_column, d_source_index, d_original_line,
//! d_original_column). Same fields as VLQ's 4-tuple plus an explicit
//! generated-line delta in place of the `;` separator. After zig-zag, ~90% of
//! these fit in 7 bits, so a mapping is ~5-7 bytes -- within a few percent of
//! VLQ on disk.
//!
//! Sync points. Deltas are cumulative: knowing mapping k requires summing
//! deltas 0..k. To avoid an O(N) scan per lookup, every `sync_interval` (64)
//! mappings we record an absolute SyncPoint{generated, original, source_index,
//! byte_offset}. `find(line, col)` binary-searches the sync array on
//! (generated_line, generated_column), seeds decoder state from the hit, then
//! decodes at most 64 segments forward. (Same trick DWARF .debug_line uses for
//! the same problem.) Minified single-line files work because sync points carry
//! absolute column.
//!
//! Single allocation. Header, sync array, and stream are laid out contiguously
//! so the whole map is one `[]u8` -- store it in the SavedSourceMap table,
//! mmap it from a .pile cache, or point at it inside the standalone-graph
//! section, with no pointer fixup on load.
//!
//! ## vs. VLQ + Mapping.List
//!
//!                      VLQ -> Mapping.List           InternalSourceMap
//!     encode           base64-VLQ per mapping        varint append per mapping
//!     first lookup     decode entire file            none
//!     resident size    20 B/mapping after decode     ~5-6 B/mapping, constant
//!     per-lookup       bsearch over N (8B keys)      bsearch N/64 + <=64 decodes
//!     interop .map     yes (it *is* the spec)        no -- call appendVLQTo()
//!
//! Steady-state lookup is a few percent slower than the fully-decoded array
//! (<=64 varint reads vs one array index) but avoids the decode and the 4x
//! residency. Raising `sync_interval` trades memory for per-lookup work.
//!
//! ## Why LEB128 and not Stream VByte
//!
//! Stream VByte wins when decoding millions of ints in a tight loop (posting
//! lists, columnar scans). We decode <=64 per lookup. For our value
//! distribution -- most deltas <128 -- LEB128 with a 1-byte fast path is
//! within noise of SVB, ~10-15% smaller (no per-4-int control byte), needs no
//! PSHUFB/TBL lookup table, and a sync point is a plain byte offset with no
//! group-phase bookkeeping. If CodeCoverage's full-stream sweep ever shows hot
//! in a profile, that is the place to revisit.
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
//!     [32..  ]  SyncPoint[sync_count]    -- 24 bytes each
//!     [stream_offset..total_len]   varint delta stream
//!
//! Each mapping in the stream is five zig-zag LEB128 varints:
//!     d_generated_line, d_generated_column, d_source_index,
//!     d_original_line,  d_original_column
//! When `d_generated_line > 0` the generated column delta is relative to 0
//! (column resets at a new line, matching VLQ semantics).
//!
//! `SyncPoint[j]` records the absolute state of mapping `j*K` and the stream
//! byte offset of mapping `j*K + 1`.

const InternalSourceMap = @This();

/// A sync point is emitted every `sync_interval` mappings.
pub const sync_interval = 64;

pub const header_size = 32;

/// The blob is stored in the SavedSourceMap table as a tagged pointer to its
/// first byte. This struct is a thin view over that pointer; it owns no
/// separate allocation.
data: [*]const u8,

pub const SyncPoint = extern struct {
    generated_line: i32,
    generated_column: i32,
    byte_offset: u32,
    original_line: i32,
    original_column: i32,
    source_index: i32,

    comptime {
        bun.assert(@sizeOf(SyncPoint) == 24);
    }

    inline fn lessOrEqual(sp: SyncPoint, line: i32, col: i32) bool {
        return sp.generated_line < line or
            (sp.generated_line == line and sp.generated_column <= col);
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

pub fn syncPoint(self: InternalSourceMap, index: usize) SyncPoint {
    const off = header_size + index * @sizeOf(SyncPoint);
    return @as(SyncPoint, @bitCast(self.data[off..][0..@sizeOf(SyncPoint)].*));
}

pub inline fn stream(self: InternalSourceMap) []const u8 {
    return self.data[self.streamOffset()..self.totalLen()];
}

pub fn deinit(self: InternalSourceMap) void {
    bun.default_allocator.free(@constCast(self.data[0..self.totalLen()]));
}

pub fn memoryCost(self: InternalSourceMap) usize {
    return self.totalLen();
}

/// Matches the semantics of `Mapping.List.find`: returns the last mapping with
/// generated position `<= (line, column)` whose generated line equals `line`.
pub fn find(self: InternalSourceMap, line: bun.Ordinal, column: bun.Ordinal) ?Mapping {
    const target_line = line.zeroBased();
    const target_col = column.zeroBased();
    const n_sync = self.syncCount();
    if (n_sync == 0) return null;

    var lo: usize = 0;
    var hi: usize = n_sync;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        if (self.syncPoint(mid).lessOrEqual(target_line, target_col)) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if (lo == 0) return null;

    const sp = self.syncPoint(lo - 1);
    var state: State = .{
        .generated_line = sp.generated_line,
        .generated_column = sp.generated_column,
        .source_index = sp.source_index,
        .original_line = sp.original_line,
        .original_column = sp.original_column,
    };

    var best = state;
    const bytes = self.stream();
    var pos: usize = sp.byte_offset;
    while (pos < bytes.len) {
        var next = state;
        pos = decodeMappingInto(bytes, pos, &next);
        if (next.generated_line > target_line or
            (next.generated_line == target_line and next.generated_column > target_col))
        {
            break;
        }
        best = next;
        state = next;
    }

    if (best.generated_line != target_line) return null;
    return best.toMapping();
}

/// Stateful forward cursor. `moveTo` is cheap when successive targets are
/// monotonically non-decreasing in generated position; otherwise it reseeks via
/// the sync index.
pub const Cursor = struct {
    map: InternalSourceMap,
    state: State,
    pos: usize,
    has_state: bool,

    pub fn init(map: InternalSourceMap) Cursor {
        return .{ .map = map, .state = .{}, .pos = 0, .has_state = false };
    }

    pub fn moveTo(self: *Cursor, line: bun.Ordinal, column: bun.Ordinal) ?Mapping {
        const target_line = line.zeroBased();
        const target_col = column.zeroBased();

        if (!self.has_state or
            self.state.generated_line > target_line or
            (self.state.generated_line == target_line and self.state.generated_column > target_col))
        {
            if (!self.reseek(target_line, target_col)) return null;
        }

        const bytes = self.map.stream();
        while (self.pos < bytes.len) {
            var next = self.state;
            const next_pos = decodeMappingInto(bytes, self.pos, &next);
            if (next.generated_line > target_line or
                (next.generated_line == target_line and next.generated_column > target_col))
            {
                break;
            }
            self.state = next;
            self.pos = next_pos;
        }

        if (self.state.generated_line != target_line) return null;
        return self.state.toMapping();
    }

    fn reseek(self: *Cursor, target_line: i32, target_col: i32) bool {
        const n_sync = self.map.syncCount();
        if (n_sync == 0) return false;
        var lo: usize = 0;
        var hi: usize = n_sync;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            if (self.map.syncPoint(mid).lessOrEqual(target_line, target_col)) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if (lo == 0) {
            self.has_state = false;
            return false;
        }
        const sp = self.map.syncPoint(lo - 1);
        self.state = .{
            .generated_line = sp.generated_line,
            .generated_column = sp.generated_column,
            .source_index = sp.source_index,
            .original_line = sp.original_line,
            .original_column = sp.original_column,
        };
        self.pos = sp.byte_offset;
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
    const bytes = self.stream();
    var pos: usize = 0;
    var state: State = .{};
    var prev: SourceMapState = .{};
    var generated_line: i32 = 0;

    while (pos < bytes.len) {
        pos = decodeMappingInto(bytes, pos, &state);

        while (generated_line < state.generated_line) : (generated_line += 1) {
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
        SourceMap.appendMappingToBuffer(out, last_byte, prev, current);
        prev = current;
    }
}

const State = struct {
    generated_line: i32 = 0,
    generated_column: i32 = 0,
    source_index: i32 = 0,
    original_line: i32 = 0,
    original_column: i32 = 0,

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
    // ~90% of deltas fit in 7 bits after zig-zag; skip the continuation loop.
    if (first < 0x80) {
        pos.* = i;
        return zigzagDecode(first);
    }
    var result: u32 = first & 0x7f;
    var shift: u5 = 7;
    while (true) {
        const byte = bytes[i];
        i += 1;
        result |= @as(u32, byte & 0x7f) << shift;
        if (byte & 0x80 == 0) break;
        shift += 7;
    }
    pos.* = i;
    return zigzagDecode(result);
}

fn decodeMappingInto(bytes: []const u8, start: usize, state: *State) usize {
    var pos = start;
    const d_gl = readVarint(bytes, &pos);
    const d_gc = readVarint(bytes, &pos);
    const d_si = readVarint(bytes, &pos);
    const d_ol = readVarint(bytes, &pos);
    const d_oc = readVarint(bytes, &pos);

    if (d_gl != 0) {
        state.generated_line += d_gl;
        state.generated_column = d_gc;
    } else {
        state.generated_column += d_gc;
    }
    state.source_index += d_si;
    state.original_line += d_ol;
    state.original_column += d_oc;
    return pos;
}

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
    input_line_count: u32,
) error{InvalidSourceMap}![]u8 {
    var builder = Builder.init(allocator);
    errdefer builder.deinit();

    var generated_column: i32 = 0;
    var source_index: i32 = 0;
    var original_line: i32 = 0;
    var original_column: i32 = 0;

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

        // 1-field segment: no original location, skip.
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

        // 5th field (name index): decode and discard.
        if (remain.len > 0 and remain[0] != ',' and remain[0] != ';') {
            const ni = VLQ.decode(remain, 0);
            if (ni.start == 0) return error.InvalidSourceMap;
            remain = remain[ni.start..];
        }
        if (remain.len > 0 and remain[0] == ',') remain = remain[1..];

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
    const input_lines: u64 = input_line_count;
    blob[0..8].* = @bitCast(total_len);
    blob[8..16].* = @bitCast(mapping_count);
    blob[16..24].* = @bitCast(input_lines);

    const owned = out.list.toOwnedSlice(allocator) catch |err| bun.handleOom(err);
    builder.finalized = null;
    return owned;
}

pub const Builder = struct {
    allocator: std.mem.Allocator,
    stream: std.ArrayListUnmanaged(u8) = .{},
    sync_points: std.ArrayListUnmanaged(SyncPoint) = .{},
    state: State = .{},
    pending_generated_line_delta: i32 = 0,
    count: u32 = 0,
    finalized: ?MutableString = null,

    pub fn init(allocator: std.mem.Allocator) Builder {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *Builder) void {
        self.stream.deinit(self.allocator);
        self.sync_points.deinit(self.allocator);
        if (self.finalized) |*m| m.deinit();
    }

    pub fn appendLineSeparator(self: *Builder) void {
        self.pending_generated_line_delta += 1;
    }

    pub fn appendMapping(self: *Builder, current: SourceMapState) void {
        const d_gl = self.pending_generated_line_delta;
        const prev_gc: i32 = if (d_gl != 0) 0 else self.state.generated_column;

        var buf: [5 * max_varint_len]u8 = undefined;
        var n: usize = 0;
        n += writeVarint(buf[n..].ptr, d_gl);
        n += writeVarint(buf[n..].ptr, current.generated_column - prev_gc);
        n += writeVarint(buf[n..].ptr, current.source_index - self.state.source_index);
        n += writeVarint(buf[n..].ptr, current.original_line - self.state.original_line);
        n += writeVarint(buf[n..].ptr, current.original_column - self.state.original_column);
        self.stream.appendSlice(self.allocator, buf[0..n]) catch |err| bun.handleOom(err);

        self.state = .{
            .generated_line = self.state.generated_line + d_gl,
            .generated_column = current.generated_column,
            .source_index = current.source_index,
            .original_line = current.original_line,
            .original_column = current.original_column,
        };
        self.pending_generated_line_delta = 0;

        if (self.count % sync_interval == 0) {
            self.sync_points.append(self.allocator, .{
                .generated_line = self.state.generated_line,
                .generated_column = self.state.generated_column,
                .byte_offset = @intCast(self.stream.items.len),
                .original_line = self.state.original_line,
                .original_column = self.state.original_column,
                .source_index = self.state.source_index,
            }) catch |err| bun.handleOom(err);
        }
        self.count += 1;
    }

    /// Serialize into the single-allocation blob layout. The first 24 header
    /// bytes are left for `Chunk.Builder.generateChunk` to fill in (length,
    /// count, input line count) so this path flows through the existing
    /// `Chunk.buffer` plumbing unchanged.
    pub fn finalize(self: *Builder) *MutableString {
        if (self.finalized) |*m| return m;

        const sync_bytes = self.sync_points.items.len * @sizeOf(SyncPoint);
        const stream_offset: u32 = @intCast(header_size + sync_bytes);
        const total: usize = stream_offset + self.stream.items.len;

        var out = MutableString.initEmpty(self.allocator);
        out.list.resize(self.allocator, total) catch |err| bun.handleOom(err);
        const blob = out.list.items;

        @memset(blob[0..24], 0);
        blob[24..28].* = @bitCast(@as(u32, @intCast(self.sync_points.items.len)));
        blob[28..32].* = @bitCast(stream_offset);
        if (sync_bytes > 0) {
            @memcpy(blob[header_size..][0..sync_bytes], std.mem.sliceAsBytes(self.sync_points.items));
        }
        @memcpy(blob[stream_offset..][0..self.stream.items.len], self.stream.items);

        self.stream.clearAndFree(self.allocator);
        self.sync_points.clearAndFree(self.allocator);

        self.finalized = out;
        return &self.finalized.?;
    }
};

const std = @import("std");

const SourceMap = @import("./sourcemap.zig");
const Mapping = SourceMap.Mapping;
const SourceMapState = SourceMap.SourceMapState;
const VLQ = SourceMap.VLQ;

const bun = @import("bun");
const MutableString = bun.MutableString;
