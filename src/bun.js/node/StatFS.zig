/// StatFS and BigIntStatFS classes from node:fs
pub fn StatFSType(comptime big: bool) type {
    const Int = if (big) i64 else i32;

    return struct {

        // Common fields between Linux and macOS
        _fstype: Int,
        _bsize: Int,
        _blocks: Int,
        _bfree: Int,
        _bavail: Int,
        _files: Int,
        _ffree: Int,

        const This = @This();

        pub fn toJS(this: *const This, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            return statfsToJS(this, globalObject);
        }

        fn statfsToJS(this: *const This, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            if (big) {
                return Bun__createJSBigIntStatFSObject(
                    globalObject,
                    this._fstype,
                    this._bsize,
                    this._blocks,
                    this._bfree,
                    this._bavail,
                    this._files,
                    this._ffree,
                );
            }

            return Bun__createJSStatFSObject(
                globalObject,
                this._fstype,
                this._bsize,
                this._blocks,
                this._bfree,
                this._bavail,
                this._files,
                this._ffree,
            );
        }

        pub fn init(statfs_: *const bun.StatFS) This {
            const fstype_, const bsize_, const blocks_, const bfree_, const bavail_, const files_, const ffree_ = switch (comptime Environment.os) {
                .linux, .mac => .{
                    statfs_.f_type,
                    statfs_.f_bsize,
                    statfs_.f_blocks,
                    statfs_.f_bfree,
                    statfs_.f_bavail,
                    statfs_.f_files,
                    statfs_.f_ffree,
                },
                .windows => .{
                    statfs_.f_type,
                    statfs_.f_bsize,
                    statfs_.f_blocks,
                    statfs_.f_bfree,
                    statfs_.f_bavail,
                    statfs_.f_files,
                    statfs_.f_ffree,
                },
                else => @compileError("Unsupported OS"),
            };
            return .{
                ._fstype = @truncate(@as(i64, @intCast(fstype_))),
                ._bsize = @truncate(@as(i64, @intCast(bsize_))),
                ._blocks = @truncate(@as(i64, @intCast(blocks_))),
                ._bfree = @truncate(@as(i64, @intCast(bfree_))),
                ._bavail = @truncate(@as(i64, @intCast(bavail_))),
                ._files = @truncate(@as(i64, @intCast(files_))),
                ._ffree = @truncate(@as(i64, @intCast(ffree_))),
            };
        }
    };
}

extern fn Bun__JSBigIntStatFSObjectConstructor(*JSC.JSGlobalObject) JSC.JSValue;
extern fn Bun__JSStatFSObjectConstructor(*JSC.JSGlobalObject) JSC.JSValue;

extern fn Bun__createJSStatFSObject(
    globalObject: *JSC.JSGlobalObject,
    fstype: i64,
    bsize: i64,
    blocks: i64,
    bfree: i64,
    bavail: i64,
    files: i64,
    ffree: i64,
) JSC.JSValue;

extern fn Bun__createJSBigIntStatFSObject(
    globalObject: *JSC.JSGlobalObject,
    fstype: i64,
    bsize: i64,
    blocks: i64,
    bfree: i64,
    bavail: i64,
    files: i64,
    ffree: i64,
) JSC.JSValue;

pub const StatFSSmall = StatFSType(false);
pub const StatFSBig = StatFSType(true);

/// Union between `Stats` and `BigIntStats` where the type can be decided at runtime
pub const StatFS = union(enum) {
    big: StatFSBig,
    small: StatFSSmall,

    pub inline fn init(stat_: *const bun.StatFS, big: bool) StatFS {
        if (big) {
            return .{ .big = StatFSBig.init(stat_) };
        } else {
            return .{ .small = StatFSSmall.init(stat_) };
        }
    }

    pub fn toJSNewlyCreated(this: *const StatFS, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this.*) {
            .big => |*big| big.toJS(globalObject),
            .small => |*small| small.toJS(globalObject),
        };
    }

    pub inline fn toJS(this: *StatFS, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalObject;

        @compileError("Only use Stats.toJSNewlyCreated() or Stats.toJS() directly on a StatsBig or StatsSmall");
    }
};

const bun = @import("root").bun;
const JSC = bun.JSC;
const Environment = bun.Environment;
const std = @import("std");
