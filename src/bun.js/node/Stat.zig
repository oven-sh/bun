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
                return @floatFromInt(bun.timespec.ms(&bun.timespec{
                    .sec = @intCast(tv_sec),
                    .nsec = @intCast(tv_nsec),
                }));
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

        fn statToJS(stat_: *const Syscall.PosixStat, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            const aTime = stat_.atime();
            const mTime = stat_.mtime();
            const cTime = stat_.ctime();
            const dev: i64 = clampedInt64(stat_.dev);
            const ino: i64 = clampedInt64(stat_.ino);
            const mode: i64 = clampedInt64(stat_.mode);
            const nlink: i64 = clampedInt64(stat_.nlink);
            const uid: i64 = clampedInt64(stat_.uid);
            const gid: i64 = clampedInt64(stat_.gid);
            const rdev: i64 = clampedInt64(stat_.rdev);
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
