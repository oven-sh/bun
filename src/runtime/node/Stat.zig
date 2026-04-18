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
                const total: i128 = @as(i128, sec) * std.time.ms_per_s + @divTrunc(@as(i128, nsec), std.time.ns_per_ms);
                return @intCast(std.math.clamp(total, std.math.minInt(i64), std.math.maxInt(i64)));
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

        fn statToJS(stat_: *const Syscall.PosixStat, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            const aTime = stat_.atime();
            const mTime = stat_.mtime();
            const cTime = stat_.ctime();
            const bTime = getBirthtime(stat_);
            const atime_ms: Float = toTimeMS(aTime);
            const mtime_ms: Float = toTimeMS(mTime);
            const ctime_ms: Float = toTimeMS(cTime);
            const birthtime_ms: Float = toTimeMS(bTime);

            if (big) {
                return bun.jsc.fromJSHostCall(globalObject, @src(), Bun__createJSBigIntStatsObject, .{
                    globalObject,
                    stat_.dev,
                    stat_.ino,
                    stat_.mode,
                    stat_.nlink,
                    stat_.uid,
                    stat_.gid,
                    stat_.rdev,
                    stat_.size,
                    stat_.blksize,
                    stat_.blocks,
                    atime_ms,
                    mtime_ms,
                    ctime_ms,
                    birthtime_ms,
                    toNanoseconds(aTime),
                    toNanoseconds(mTime),
                    toNanoseconds(cTime),
                    toNanoseconds(bTime),
                });
            }

            return Bun__createJSStatsObject(
                globalObject,
                stat_.dev,
                stat_.ino,
                stat_.mode,
                stat_.nlink,
                stat_.uid,
                stat_.gid,
                stat_.rdev,
                stat_.size,
                stat_.blksize,
                stat_.blocks,
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
    dev: u64,
    ino: u64,
    mode: u64,
    nlink: u64,
    uid: u64,
    gid: u64,
    rdev: u64,
    size: u64,
    blksize: u64,
    blocks: u64,
    atimeMs: f64,
    mtimeMs: f64,
    ctimeMs: f64,
    birthtimeMs: f64,
) jsc.JSValue;

extern fn Bun__createJSBigIntStatsObject(
    globalObject: *jsc.JSGlobalObject,
    dev: u64,
    ino: u64,
    mode: u64,
    nlink: u64,
    uid: u64,
    gid: u64,
    rdev: u64,
    size: u64,
    blksize: u64,
    blocks: u64,
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

/// Test-only: build a Stats/BigIntStats from a raw u64 ino via the real
/// statToJS path, so regression tests can exercise high-inode values without
/// a filesystem that hands them out.
pub fn createStatsForIno(globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const ino_arg, const big_arg = callFrame.argumentsAsArray(2);
    var stat_ = std.mem.zeroes(Syscall.PosixStat);
    stat_.ino = ino_arg.toUInt64NoTruncate();
    return try Stats.init(&stat_, big_arg.toBoolean()).toJSNewlyCreated(globalObject);
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
