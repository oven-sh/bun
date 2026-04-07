/// Stats and BigIntStats classes from node:fs
pub fn StatType(comptime big: bool) type {
    return struct {
        pub const new = bun.TrivialNew(@This());
        pub const deinit = bun.TrivialDeinit(@This());

        value: Syscall.PosixStat,

        const StatTimespec = bun.timespec;
        const Float = if (big) i64 else f64;

        pub inline fn init(stat_: *const Syscall.PosixStat) @This() {
            return .{ .value = stat_.* };
        }

        inline fn toNanoseconds(ts: StatTimespec) u64 {
            if (ts.sec < 0) {
                return @intCast(@max(bun.timespec.nsSigned(&bun.timespec{
                    .sec = @intCast(ts.sec),
                    .nsec = @intCast(ts.nsec),
                }), 0));
            }

            return bun.timespec.ns(&bun.timespec{
                .sec = @intCast(ts.sec),
                .nsec = @intCast(ts.nsec),
            });
        }

        fn toTimeMS(ts: StatTimespec) Float {
            // On windows, Node.js purposefully misinterprets time values
            // > On win32, time is stored in uint64_t and starts from 1601-01-01.
            // > libuv calculates tv_sec and tv_nsec from it and converts to signed long,
            // > which causes Y2038 overflow. On the other platforms it is safe to treat
            // > negative values as pre-epoch time.
            const tv_sec = if (Environment.isWindows) @as(u32, @bitCast(@as(i32, @truncate(ts.sec)))) else ts.sec;
            const tv_nsec = if (Environment.isWindows) @as(u32, @bitCast(@as(i32, @truncate(ts.nsec)))) else ts.nsec;
            if (big) {
                const sec: i64 = tv_sec;
                const nsec: i64 = tv_nsec;
                return @as(i64, sec * std.time.ms_per_s) +|
                    @as(i64, @divTrunc(nsec, std.time.ns_per_ms));
            } else {
                // Use floating-point arithmetic to preserve sub-millisecond precision.
                // Node.js returns fractional milliseconds (e.g. 1773248895434.0544).
                const sec_ms: f64 = @as(f64, @floatFromInt(tv_sec)) * 1000.0;
                const nsec_ms: f64 = @as(f64, @floatFromInt(tv_nsec)) / 1_000_000.0;
                return sec_ms + nsec_ms;
            }
        }

        fn getBirthtime(stat_: *const Syscall.PosixStat) StatTimespec {
            return stat_.birthtim;
        }

        pub fn toJS(this: *const @This(), globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            return statToJS(&this.value, globalObject);
        }

        pub fn getConstructor(globalObject: *jsc.JSGlobalObject) jsc.JSValue {
            return if (big) Bun__JSBigIntStatsObjectConstructor(globalObject) else Bun__JSStatsObjectConstructor(globalObject);
        }

        fn clampedInt64(value: anytype) i64 {
            return @intCast(@min(@max(value, 0), std.math.maxInt(i64)));
        }

        /// Convert a stat field (e.g. `dev`/`ino`/`rdev`, whose type varies by
        /// platform — `u64` on Linux, `i32` on macOS for `dev_t`) into a `f64`
        /// for the non-bigint stats object. Mirrors Node.js, which copies the
        /// native field into libuv's `uv_stat_t` (where every field is
        /// `uint64_t`) via C's implicit signed-to-unsigned conversion, then
        /// `static_cast<double>`s into a `Float64Array`. For signed platform
        /// types (e.g. macOS `dev_t = i32`) a negative value like `-1` must
        /// therefore come out as ~`1.844e19`, not `-1.0` — matching
        /// `(uint64_t)(int32_t)(-1)` in C. Precision is lost above 2^53 but
        /// values are never clamped to INT64_MAX.
        fn toF64(value: anytype) f64 {
            const T = @TypeOf(value);
            switch (@typeInfo(T)) {
                .int => |int_info| {
                    if (int_info.signedness == .signed) {
                        // Sign-extend to i64, then reinterpret as u64 — this is
                        // what libuv does when it copies a signed `st_*` field
                        // into `uv_stat_t`'s `uint64_t` slot via C's implicit
                        // conversion rules.
                        const sext: i64 = @intCast(value);
                        const uext: u64 = @bitCast(sext);
                        return @floatFromInt(uext);
                    }
                    return @floatFromInt(value);
                },
                .comptime_int => return @floatFromInt(value),
                .float, .comptime_float => return @floatCast(value),
                else => @compileError("toF64: unsupported type " ++ @typeName(T)),
            }
        }

        /// Convert a stat field into an `i64` for the BigIntStats path,
        /// matching Node.js which fills a `BigInt64Array` via
        /// `static_cast<int64_t>(...)`. Signed platform types (e.g. macOS
        /// `dev_t = i32`) sign-extend, so negative device numbers appear as
        /// negative JS BigInts (matching Node). Unsigned platform types
        /// (e.g. Linux `dev_t`/`ino_t = u64`) are `@bitCast` to `i64`, so
        /// values `> INT64_MAX` wrap to negative — identical to Node's
        /// `static_cast<int64_t>(uint64_t)` behaviour. Never clamps.
        fn toI64(value: anytype) i64 {
            const T = @TypeOf(value);
            const info = @typeInfo(T);
            if (info != .int) @compileError("toI64: expected int, got " ++ @typeName(T));
            if (info.int.signedness == .signed) {
                return @intCast(value);
            }
            return @bitCast(@as(u64, @intCast(value)));
        }

        fn statToJS(stat_: *const Syscall.PosixStat, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            const aTime = stat_.atime();
            const mTime = stat_.mtime();
            const cTime = stat_.ctime();
            const mode: i64 = clampedInt64(stat_.mode);
            const nlink: i64 = clampedInt64(stat_.nlink);
            const uid: i64 = clampedInt64(stat_.uid);
            const gid: i64 = clampedInt64(stat_.gid);
            const size: i64 = clampedInt64(stat_.size);
            const blksize: i64 = clampedInt64(stat_.blksize);
            const blocks: i64 = clampedInt64(stat_.blocks);
            const bTime = getBirthtime(stat_);
            const atime_ms: Float = toTimeMS(aTime);
            const mtime_ms: Float = toTimeMS(mTime);
            const ctime_ms: Float = toTimeMS(cTime);
            const birthtime_ms: Float = toTimeMS(bTime);
            const atime_ns: u64 = if (big) toNanoseconds(aTime) else 0;
            const mtime_ns: u64 = if (big) toNanoseconds(mTime) else 0;
            const ctime_ns: u64 = if (big) toNanoseconds(cTime) else 0;
            const birthtime_ns: u64 = if (big) toNanoseconds(bTime) else 0;

            if (big) {
                // BigIntStats: pass dev/ino/rdev as i64 matching Node.js's
                // `BigInt64Array`. This preserves sign (so macOS negative
                // `dev_t = -1i32` becomes `-1n`, not a huge positive BigInt)
                // and matches Node bit-for-bit for u64 values above
                // INT64_MAX (both wrap to negative via `static_cast`).
                const dev: i64 = toI64(stat_.dev);
                const ino: i64 = toI64(stat_.ino);
                const rdev: i64 = toI64(stat_.rdev);
                return bun.jsc.fromJSHostCall(globalObject, @src(), Bun__createJSBigIntStatsObject, .{
                    globalObject,
                    dev,
                    ino,
                    mode,
                    nlink,
                    uid,
                    gid,
                    rdev,
                    size,
                    blksize,
                    blocks,
                    atime_ms,
                    mtime_ms,
                    ctime_ms,
                    birthtime_ms,
                    atime_ns,
                    mtime_ns,
                    ctime_ns,
                    birthtime_ns,
                });
            }

            // Stats: pass dev/ino/rdev as f64 (matching Node's Float64Array),
            // which preserves any value up to 2^53 exactly and gracefully
            // rounds beyond that instead of clamping to INT64_MAX.
            const dev: f64 = toF64(stat_.dev);
            const ino: f64 = toF64(stat_.ino);
            const rdev: f64 = toF64(stat_.rdev);
            return Bun__createJSStatsObject(
                globalObject,
                dev,
                ino,
                mode,
                nlink,
                uid,
                gid,
                rdev,
                size,
                blksize,
                blocks,
                atime_ms,
                mtime_ms,
                ctime_ms,
                birthtime_ms,
            );
        }
    };
}
extern fn Bun__JSBigIntStatsObjectConstructor(*jsc.JSGlobalObject) jsc.JSValue;
extern fn Bun__JSStatsObjectConstructor(*jsc.JSGlobalObject) jsc.JSValue;

extern fn Bun__createJSStatsObject(
    globalObject: *jsc.JSGlobalObject,
    dev: f64,
    ino: f64,
    mode: i64,
    nlink: i64,
    uid: i64,
    gid: i64,
    rdev: f64,
    size: i64,
    blksize: i64,
    blocks: i64,
    atimeMs: f64,
    mtimeMs: f64,
    ctimeMs: f64,
    birthtimeMs: f64,
) jsc.JSValue;

extern fn Bun__createJSBigIntStatsObject(
    globalObject: *jsc.JSGlobalObject,
    dev: i64,
    ino: i64,
    mode: i64,
    nlink: i64,
    uid: i64,
    gid: i64,
    rdev: i64,
    size: i64,
    blksize: i64,
    blocks: i64,
    atimeMs: i64,
    mtimeMs: i64,
    ctimeMs: i64,
    birthtimeMs: i64,
    atimeNs: u64,
    mtimeNs: u64,
    ctimeNs: u64,
    birthtimeNs: u64,
) jsc.JSValue;

pub const StatsSmall = StatType(false);
pub const StatsBig = StatType(true);

/// Testing helper for the stat -> JS conversion. Takes a raw `ino` value (as
/// BigInt) and returns a Stats or BigIntStats object produced by the exact
/// same code path used by `fs.statSync`. This lets regression tests exercise
/// the `u64 -> JS` conversion without having to mount a filesystem that hands
/// out high 64-bit inodes (e.g. NFS).
pub fn createStatsFromU64ForTesting(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callFrame.arguments_old(2).slice();
    if (arguments.len < 2) {
        return globalObject.throw("createStatsFromU64ForTesting expects (ino, big)", .{});
    }
    const ino_u64 = arguments[0].toUInt64NoTruncate();
    const big = arguments[1].toBoolean();

    var posix_stat = std.mem.zeroes(Syscall.PosixStat);
    // `@FieldType(bun.Stat, "ino")` is platform-dependent but resolves to
    // an unsigned 64-bit integer on every supported target (Linux, macOS,
    // and Windows via libuv's `uv_stat_t`), so this `@intCast` is lossless.
    posix_stat.ino = @intCast(ino_u64);
    posix_stat.mode = 0o100644;
    posix_stat.nlink = 1;

    if (big) {
        const stats = StatsBig.init(&posix_stat);
        return try stats.toJS(globalObject);
    }
    const stats = StatsSmall.init(&posix_stat);
    return try stats.toJS(globalObject);
}

/// Union between `Stats` and `BigIntStats` where the type can be decided at runtime
pub const Stats = union(enum) {
    big: StatsBig,
    small: StatsSmall,

    pub inline fn init(stat_: *const Syscall.PosixStat, big: bool) Stats {
        if (big) {
            return .{ .big = StatsBig.init(stat_) };
        } else {
            return .{ .small = StatsSmall.init(stat_) };
        }
    }

    pub fn toJSNewlyCreated(this: *const Stats, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return switch (this.*) {
            .big => this.big.toJS(globalObject),
            .small => this.small.toJS(globalObject),
        };
    }

    pub inline fn toJS(this: *Stats, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        _ = this;
        _ = globalObject;

        @compileError("Only use Stats.toJSNewlyCreated() or Stats.toJS() directly on a StatsBig or StatsSmall");
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Syscall = bun.sys;
const jsc = bun.jsc;
