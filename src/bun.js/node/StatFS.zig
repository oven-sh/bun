/// StatFS and BigIntStatFS classes from node:fs
pub fn StatFSType(comptime big: bool) type {
    const Int = if (big) i64 else i32;

    return extern struct {
        pub usingnamespace if (big) JSC.Codegen.JSBigIntStatFs else JSC.Codegen.JSStatFs;
        pub usingnamespace bun.New(@This());

        // Common fields between Linux and macOS
        _fstype: Int,
        _bsize: Int,
        _blocks: Int,
        _bfree: Int,
        _bavail: Int,
        _files: Int,
        _ffree: Int,

        const This = @This();

        const PropertyGetter = fn (this: *This, globalObject: *JSC.JSGlobalObject) JSC.JSValue;

        fn getter(comptime field: std.meta.FieldEnum(This)) PropertyGetter {
            return struct {
                pub fn callback(this: *This, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                    const value = @field(this, @tagName(field));
                    const Type = @TypeOf(value);
                    if (comptime big and @typeInfo(Type) == .int) {
                        return JSC.JSValue.fromInt64NoTruncate(globalObject, value);
                    }

                    const result = JSC.JSValue.jsDoubleNumber(@as(f64, @floatFromInt(value)));
                    if (Environment.isDebug) {
                        bun.assert_eql(result.asNumber(), @as(f64, @floatFromInt(value)));
                    }
                    return result;
                }
            }.callback;
        }

        pub const fstype = getter(._fstype);
        pub const bsize = getter(._bsize);
        pub const blocks = getter(._blocks);
        pub const bfree = getter(._bfree);
        pub const bavail = getter(._bavail);
        pub const files = getter(._files);
        pub const ffree = getter(._ffree);

        pub fn finalize(this: *This) void {
            this.destroy();
        }

        pub fn init(statfs_: bun.StatFS) This {
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

        pub fn constructor(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!*This {
            if (big) {
                return globalObject.throwInvalidArguments("BigIntStatFS is not a constructor", .{});
            }

            var args = callFrame.arguments();

            const this = This.new(.{
                ._fstype = if (args.len > 0 and args[0].isNumber()) args[0].toInt32() else 0,
                ._bsize = if (args.len > 1 and args[1].isNumber()) args[1].toInt32() else 0,
                ._blocks = if (args.len > 2 and args[2].isNumber()) args[2].toInt32() else 0,
                ._bfree = if (args.len > 3 and args[3].isNumber()) args[3].toInt32() else 0,
                ._bavail = if (args.len > 4 and args[4].isNumber()) args[4].toInt32() else 0,
                ._files = if (args.len > 5 and args[5].isNumber()) args[5].toInt32() else 0,
                ._ffree = if (args.len > 6 and args[6].isNumber()) args[6].toInt32() else 0,
            });

            return this;
        }
    };
}

pub const StatFSSmall = StatFSType(false);
pub const StatFSBig = StatFSType(true);

/// Union between `Stats` and `BigIntStats` where the type can be decided at runtime
pub const StatFS = union(enum) {
    big: StatFSBig,
    small: StatFSSmall,

    pub inline fn init(stat_: bun.StatFS, big: bool) StatFS {
        if (big) {
            return .{ .big = StatFSBig.init(stat_) };
        } else {
            return .{ .small = StatFSSmall.init(stat_) };
        }
    }

    pub fn toJSNewlyCreated(this: *const StatFS, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this.*) {
            .big => StatFSBig.new(this.big).toJS(globalObject),
            .small => StatFSSmall.new(this.small).toJS(globalObject),
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
