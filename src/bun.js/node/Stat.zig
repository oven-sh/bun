/// Stats and BigIntStats classes from node:fs
pub fn StatType(comptime big: bool) type {
    return struct {
        pub usingnamespace bun.New(@This());
        value: bun.Stat,

        const StatTimespec = if (Environment.isWindows) bun.windows.libuv.uv_timespec_t else std.posix.timespec;
        const Float = if (big) i64 else f64;

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
            // On windows, Node.js purposefully mis-interprets time values
            // > On win32, time is stored in uint64_t and starts from 1601-01-01.
            // > libuv calculates tv_sec and tv_nsec from it and converts to signed long,
            // > which causes Y2038 overflow. On the other platforms it is safe to treat
            // > negative values as pre-epoch time.
            const tv_sec = if (Environment.isWindows) @as(u32, @bitCast(ts.sec)) else ts.sec;
            const tv_nsec = if (Environment.isWindows) @as(u32, @bitCast(ts.nsec)) else ts.nsec;
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

        pub fn toJS(this: *const @This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            return statToJS(&this.value, globalObject);
        }

        pub fn getConstructor(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            return if (big) Bun__JSBigIntStatsObjectConstructor(globalObject) else Bun__JSStatsObjectConstructor(globalObject);
        }

        fn clampedInt64(value: anytype) i64 {
            return @intCast(@min(@max(value, 0), std.math.maxInt(i64)));
        }

        fn statToJS(stat_: *const bun.Stat, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
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
            const atime_ms: Float = toTimeMS(aTime);
            const mtime_ms: Float = toTimeMS(mTime);
            const ctime_ms: Float = toTimeMS(cTime);
            const atime_ns: u64 = if (big) toNanoseconds(aTime) else 0;
            const mtime_ns: u64 = if (big) toNanoseconds(mTime) else 0;
            const ctime_ns: u64 = if (big) toNanoseconds(cTime) else 0;
            const birthtime_ms: Float = if (Environment.isLinux) 0 else toTimeMS(stat_.birthtime());
            const birthtime_ns: u64 = if (big and !Environment.isLinux) toNanoseconds(stat_.birthtime()) else 0;

            if (big) {
                return Bun__createJSBigIntStatsObject(
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
                );
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

        pub fn init(stat_: *const bun.Stat) @This() {
            return @This(){
                .value = stat_.*,
            };
        }
    };
}
extern fn Bun__JSBigIntStatsObjectConstructor(*JSC.JSGlobalObject) JSC.JSValue;
extern fn Bun__JSStatsObjectConstructor(*JSC.JSGlobalObject) JSC.JSValue;

extern fn Bun__createJSStatsObject(
    globalObject: *JSC.JSGlobalObject,
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
) JSC.JSValue;

extern fn Bun__createJSBigIntStatsObject(
    globalObject: *JSC.JSGlobalObject,
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
) JSC.JSValue;

pub const StatsSmall = StatType(false);
pub const StatsBig = StatType(true);

/// Union between `Stats` and `BigIntStats` where the type can be decided at runtime
pub const Stats = union(enum) {
    big: StatsBig,
    small: StatsSmall,

    pub inline fn init(stat_: *const bun.Stat, big: bool) Stats {
        if (big) {
            return .{ .big = StatsBig.init(stat_) };
        } else {
            return .{ .small = StatsSmall.init(stat_) };
        }
    }

    pub fn toJSNewlyCreated(this: *const Stats, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this.*) {
            .big => this.big.toJS(globalObject),
            .small => this.small.toJS(globalObject),
        };
    }

    pub inline fn toJS(this: *Stats, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalObject;

        @compileError("Only use Stats.toJSNewlyCreated() or Stats.toJS() directly on a StatsBig or StatsSmall");
    }
};

const bun = @import("root").bun;
const JSC = bun.JSC;
const Environment = bun.Environment;
const std = @import("std");
