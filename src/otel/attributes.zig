//! Packed OTLP attribute model. `Attribute` is exactly 16 bytes: an 8-byte
//! key word (carries the value tag + either a semconv-intern index or a
//! u12-len|u48-ptr key string) and an 8-byte value word interpreted per tag.
//! Slices are borrowed; the owner is the per-span / per-batch arena.

pub const ValueTag = enum(u3) {
    empty = 0,
    string,
    boolean,
    int,
    double,
    bytes,
    array,
    kvlist,
};

/// Well-known OTEL semantic-convention attribute keys used by the native
/// instrumentation hooks. Stored as a 1-byte index instead of a string slice.
pub const SemconvKey = enum(u8) {
    @"service.name",
    @"telemetry.sdk.name",
    @"telemetry.sdk.language",
    @"telemetry.sdk.version",
    @"http.request.method",
    @"http.response.status_code",
    @"http.route",
    @"url.path",
    @"url.full",
    @"url.scheme",
    @"server.address",
    @"server.port",
    @"network.peer.address",
    @"network.peer.port",
    @"user_agent.original",
    @"db.system",
    @"db.statement",
    @"db.name",
    @"error.type",
    @"exception.type",
    @"exception.message",
    @"exception.stacktrace",

    pub fn slice(self: SemconvKey) []const u8 {
        return @tagName(self);
    }

    /// Best-effort intern lookup for incoming key strings (used by the POJO
    /// codec). Linear scan is fine — the table is tiny and this is the slow
    /// debug surface.
    pub fn lookup(s: []const u8) ?SemconvKey {
        inline for (@typeInfo(SemconvKey).@"enum".fields) |f| {
            if (bun.strings.eql(s, f.name)) return @enumFromInt(f.value);
        }
        return null;
    }
};

const KEY_LEN_BITS = 12;
const KEY_LEN_MAX = (1 << KEY_LEN_BITS) - 1;
const PTR_BITS = 48;
const PTR_MASK: u64 = (1 << PTR_BITS) - 1;
const VAL_LEN_BITS = 16;
const VAL_LEN_MAX = (1 << VAL_LEN_BITS) - 1;

pub const Attribute = extern struct {
    key_word: u64,
    val_word: u64,

    comptime {
        bun.assert(@sizeOf(Attribute) == 16);
    }

    // ── construction ────────────────────────────────────────────────────────

    pub fn semconv(k: SemconvKey, v: Value) Attribute {
        return .{
            .key_word = (@as(u64, @intFromEnum(v.tag)) << 61) | (1 << 60) | @as(u64, @intFromEnum(k)),
            .val_word = v.word,
        };
    }

    pub fn init(k: []const u8, v: Value) Attribute {
        if (SemconvKey.lookup(k)) |sk| return semconv(sk, v);
        return .{ .key_word = encodeKeyPtr(k, v.tag), .val_word = v.word };
    }

    /// For value-only positions (ArrayValue elements). Key bits are zero.
    pub fn valueOnly(v: Value) Attribute {
        return .{ .key_word = @as(u64, @intFromEnum(v.tag)) << 61, .val_word = v.word };
    }

    fn encodeKeyPtr(k: []const u8, t: ValueTag) u64 {
        // Keys longer than KEY_LEN_MAX (4095) are truncated; real-world semconv
        // keys are <100 chars, so this is purely defensive against hostile input.
        const len: u64 = @min(k.len, KEY_LEN_MAX);
        const ptr: u64 = @intFromPtr(k.ptr);
        bun.assert(ptr <= PTR_MASK);
        return (@as(u64, @intFromEnum(t)) << 61) | (len << PTR_BITS) | ptr;
    }

    // ── accessors ───────────────────────────────────────────────────────────

    pub fn tag(self: Attribute) ValueTag {
        return @enumFromInt(@as(u3, @truncate(self.key_word >> 61)));
    }

    pub fn isInterned(self: Attribute) bool {
        return (self.key_word >> 60) & 1 == 1;
    }

    pub fn key(self: Attribute) []const u8 {
        if (self.isInterned()) {
            const idx: SemconvKey = @enumFromInt(@as(u8, @truncate(self.key_word)));
            return idx.slice();
        }
        const len: usize = @as(u12, @truncate(self.key_word >> PTR_BITS));
        if (len == 0) return "";
        const ptr: [*]const u8 = @ptrFromInt(@as(usize, @intCast(self.key_word & PTR_MASK)));
        return ptr[0..len];
    }

    pub fn string(self: Attribute) []const u8 {
        return decodeSlice(u8, self.val_word);
    }
    pub fn boolean(self: Attribute) bool {
        return self.val_word & 1 == 1;
    }
    pub fn int(self: Attribute) i64 {
        return @bitCast(self.val_word);
    }
    pub fn double(self: Attribute) f64 {
        return @bitCast(self.val_word);
    }
    pub fn bytes(self: Attribute) []const u8 {
        return decodeSlice(u8, self.val_word);
    }
    pub fn array(self: Attribute) []const Attribute {
        return decodeSlice(Attribute, self.val_word);
    }
    pub fn kvlist(self: Attribute) []const Attribute {
        return decodeSlice(Attribute, self.val_word);
    }

    /// Re-pack with key/value pointers retargeted into `arena` (deep copy).
    pub fn cloneInto(self: Attribute, arena: std.mem.Allocator) Attribute {
        var out = self;
        if (!self.isInterned()) {
            const k = self.key();
            if (k.len > 0) out.key_word = encodeKeyPtr(bun.handleOom(arena.dupe(u8, k)), self.tag());
        }
        out.val_word = switch (self.tag()) {
            .string, .bytes => encodeValSlice(u8, bun.handleOom(arena.dupe(u8, self.string()))),
            .array, .kvlist => blk: {
                const src = self.array();
                const dst = bun.handleOom(arena.alloc(Attribute, src.len));
                for (src, dst) |s, *d| d.* = s.cloneInto(arena);
                break :blk encodeValSlice(Attribute, dst);
            },
            else => self.val_word,
        };
        return out;
    }
};

/// Intermediate (tag, word) pair for building an `Attribute`. Not stored.
pub const Value = struct {
    tag: ValueTag,
    word: u64,

    pub const empty: Value = .{ .tag = .empty, .word = 0 };

    pub fn string(s: []const u8) Value {
        return .{ .tag = .string, .word = encodeValSlice(u8, s) };
    }
    pub fn boolean(b: bool) Value {
        return .{ .tag = .boolean, .word = @intFromBool(b) };
    }
    pub fn int(i: i64) Value {
        return .{ .tag = .int, .word = @bitCast(i) };
    }
    pub fn double(d: f64) Value {
        return .{ .tag = .double, .word = @bitCast(d) };
    }
    pub fn bytesV(b: []const u8) Value {
        return .{ .tag = .bytes, .word = encodeValSlice(u8, b) };
    }
    pub fn arrayV(a: []const Attribute) Value {
        return .{ .tag = .array, .word = encodeValSlice(Attribute, a) };
    }
    pub fn kvlistV(a: []const Attribute) Value {
        return .{ .tag = .kvlist, .word = encodeValSlice(Attribute, a) };
    }
};

fn encodeValSlice(comptime T: type, s: []const T) u64 {
    const len = @min(s.len, VAL_LEN_MAX);
    if (len == 0) return 0;
    const ptr: u64 = @intFromPtr(s.ptr);
    bun.assert(ptr <= PTR_MASK);
    return (@as(u64, len) << PTR_BITS) | ptr;
}

fn decodeSlice(comptime T: type, word: u64) []const T {
    const len: usize = @as(u16, @truncate(word >> PTR_BITS));
    if (len == 0) return &.{};
    const ptr: [*]const T = @ptrFromInt(@as(usize, @intCast(word & PTR_MASK)));
    return ptr[0..len];
}

/// Packed `[]const Attribute` header: 8 bytes (cap 255). OTLP spans cap at
/// 128 attrs by spec default; overflow goes to `dropped_attributes_count`.
pub const AttrList = extern struct {
    raw: u64 = 0,

    pub const empty: AttrList = .{};

    pub const max_len = 255;

    pub fn from(s: []const Attribute) AttrList {
        const n: u8 = @intCast(@min(s.len, max_len));
        if (n == 0) return .{};
        const ptr: u64 = @intFromPtr(s.ptr);
        return .{ .raw = (@as(u64, n) << 56) | (ptr & ((1 << 56) - 1)) };
    }

    pub fn droppedCount(full_len: usize) u32 {
        return @intCast(full_len -| max_len);
    }

    pub fn slice(self: AttrList) []const Attribute {
        const n = self.len();
        if (n == 0) return &.{};
        const ptr: [*]const Attribute = @ptrFromInt(@as(usize, @intCast(self.raw & ((1 << 56) - 1))));
        return ptr[0..n];
    }

    pub fn len(self: AttrList) u8 {
        return @truncate(self.raw >> 56);
    }
};

comptime {
    bun.assert(@sizeOf(AttrList) == 8);
}

/// Backwards-compat alias for older call sites.
pub const empty = AttrList.empty;

// AnyValue retained as a type alias for the construction helper; the storage
// is `Attribute.val_word` interpreted via `tag()`.
pub const AnyValue = Value;

const bun = @import("bun");
const std = @import("std");
