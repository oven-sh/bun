const Glob = @This();
const globImpl = @import("../../glob.zig");
const globImplAscii = @import("../../glob_ascii.zig");
const GlobWalker = globImpl.GlobWalker;
const PathLike = @import("../node/types.zig").PathLike;
const ArgumentsSlice = @import("../node/types.zig").ArgumentsSlice;
const Syscall = @import("../../sys.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("../../bun.zig");
const BunString = @import("../../bun.zig").String;
const string = bun.string;
const JSC = bun.JSC;
const JSArray = @import("../bindings/bindings.zig").JSArray;
const JSValue = @import("../bindings/bindings.zig").JSValue;
const ZigString = @import("../bindings/bindings.zig").ZigString;
const Base = @import("../base.zig");
const JSGlobalObject = @import("../bindings/bindings.zig").JSGlobalObject;
const getAllocator = Base.getAllocator;
const ResolvePath = @import("../../resolver/resolve_path.zig");
const isAllAscii = @import("../../string_immutable.zig").isAllASCII;
const CodepointIterator = @import("../../string_immutable.zig").UnsignedCodepointIterator;

const Arena = std.heap.ArenaAllocator;

pub usingnamespace JSC.Codegen.JSGlob;

pattern: []const u8,
pattern_codepoints: ?std.ArrayList(u32) = null,
is_ascii: bool,
has_pending_activity: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),

const MatchOpts = struct {
    cwd: ?BunString,
    dot: bool,
    absolute: bool,

    fn fromJS(globalThis: *JSGlobalObject, arguments: *ArgumentsSlice, comptime fnName: []const u8, arena: *Arena) ?MatchOpts {
        const optsObj: JSValue = arguments.nextEat() orelse return null;
        if (!optsObj.isObject() or optsObj.isUndefinedOrNull()) {
            globalThis.throw("{s}: expected first argument to be an object", .{fnName});
            return null;
        }

        var out: MatchOpts = .{
            .cwd = null,
            .dot = false,
            .absolute = false,
        };

        if (optsObj.getTruthy(globalThis, "absolute")) |absoluteVal| {
            out.absolute = if (absoluteVal.isBoolean()) absoluteVal.asBoolean() else false;
        }

        if (optsObj.get(globalThis, "cwd")) |cwdVal| parse_cwd: {
            if (cwdVal.isUndefinedOrNull()) break :parse_cwd;
            if (!cwdVal.isString()) {
                globalThis.throw("{s}: invalid `cwd`, not a string", .{fnName});
                return null;
            }

            var cwd_str_raw = cwdVal.toSlice(globalThis, arena.allocator());
            if (cwd_str_raw.len == 0) {
                globalThis.throw("{s}: invalid `cwd`, empty string", .{fnName});
                return null;
            }

            const cwd_str = cwd_str: {
                if (ResolvePath.Platform.auto.isAbsolute(cwd_str_raw.slice())) {
                    const cwd_str = cwd_str_raw.clone(arena.allocator()) catch {
                        globalThis.throwOutOfMemory();
                        return null;
                    };
                    break :cwd_str cwd_str.ptr[0..cwd_str.len];
                }

                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var path_buf2: [bun.MAX_PATH_BYTES * 2]u8 = undefined;
                const cwd = switch (bun.sys.getcwd((&path_buf))) {
                    .result => |cwd| cwd,
                    .err => |err| {
                        const errJs = err.toJSC(globalThis);
                        globalThis.throwValue(errJs);
                        return null;
                    },
                };

                const cwd_str = ResolvePath.joinStringBuf(&path_buf2, &[_][]const u8{ cwd, cwd_str_raw.slice() }, .auto);

                break :cwd_str arena.allocator().dupe(u8, cwd_str) catch {
                    globalThis.throwOutOfMemory();
                    return null;
                };
            };

            if (cwd_str.len > bun.MAX_PATH_BYTES) {
                globalThis.throw("{s}: invalid `cwd`, longer than {d} bytes", .{ fnName, bun.MAX_PATH_BYTES });
                return null;
            }

            out.cwd = BunString.fromBytes(cwd_str);
        }

        if (optsObj.getTruthy(globalThis, "dot")) |dot| {
            out.dot = if (dot.isBoolean()) dot.asBoolean() else false;
        }

        return out;
    }
};

pub const WalkTask = struct {
    walker: *GlobWalker,
    alloc: Allocator,
    err: ?Err = null,
    global: *JSC.JSGlobalObject,
    has_pending_activity: *std.atomic.Atomic(bool),

    pub const Err = union(enum) {
        syscall: Syscall.Error,
        unknown: anyerror,

        pub fn toJSC(this: Err, globalThis: *JSGlobalObject) JSValue {
            return switch (this) {
                .syscall => |err| err.toJSC(globalThis),
                .unknown => |err| ZigString.fromBytes(@errorName(err)).toValueGC(globalThis),
            };
        }
    };

    pub const AsyncGlobWalkTask = JSC.ConcurrentPromiseTask(WalkTask);

    pub fn create(
        globalThis: *JSC.JSGlobalObject,
        alloc: Allocator,
        globWalker: *GlobWalker,
        has_pending_activity: *std.atomic.Atomic(bool),
    ) !*AsyncGlobWalkTask {
        var walkTask = try alloc.create(WalkTask);
        walkTask.* = .{
            .walker = globWalker,
            .global = globalThis,
            .alloc = alloc,
            .has_pending_activity = has_pending_activity,
        };
        return try AsyncGlobWalkTask.createOnJSThread(alloc, globalThis, walkTask);
    }

    pub fn run(this: *WalkTask) void {
        defer updateHasPendingActivityFlag(this.has_pending_activity, false);
        const result = this.walker.walk() catch |err| {
            this.err = .{ .unknown = err };
            return;
        };
        switch (result) {
            .err => |err| {
                this.err = .{ .syscall = err };
            },
            .result => {},
        }
    }

    pub fn then(this: *WalkTask, promise: *JSC.JSPromise) void {
        defer this.deinit();

        if (this.err) |err| {
            const errJs = err.toJSC(this.global);
            promise.reject(this.global, errJs);
            return;
        }

        const jsStrings = globWalkResultToJS(this.walker, this.global);
        promise.resolve(this.global, jsStrings);
    }

    fn deinit(this: *WalkTask) void {
        this.walker.deinit();
        this.alloc.destroy(this);
    }
};

fn globWalkResultToJS(globWalk: *GlobWalker, globalThis: *JSGlobalObject) JSValue {
    // if (globWalk.matchedPaths.items.len >= 0) {
    if (globWalk.matchedPaths.items.len == 0) {
        return JSC.JSArray.from(globalThis, &[_]JSC.JSValue{});
    }

    return BunString.toJSArray(globalThis, globWalk.matchedPaths.items[0..]);
}

fn makeGlobWalker(
    this: *Glob,
    globalThis: *JSGlobalObject,
    arguments: *ArgumentsSlice,
    comptime fnName: []const u8,
    alloc: Allocator,
    arena_: Arena,
) ?*GlobWalker {
    var arena = arena_;
    const matchOpts = MatchOpts.fromJS(globalThis, arguments, fnName, &arena);
    if (matchOpts != null and matchOpts.?.cwd != null) {
        var globWalker = alloc.create(GlobWalker) catch {
            globalThis.throw("Out of memory", .{});
            return null;
        };

        globWalker.* = .{};
        globWalker.initWithCwd(arena, this.pattern, matchOpts.?.cwd.?, matchOpts.?.dot, matchOpts.?.absolute) catch {
            globalThis.throw("Out of memory", .{});
            return null;
        };
        return globWalker;
    }
    var globWalker = alloc.create(GlobWalker) catch {
        globalThis.throw("Out of memory", .{});
        return null;
    };

    globWalker.* = .{};
    switch (globWalker.init(arena, this.pattern, false, false) catch {
        globalThis.throw("Out of memory", .{});
        return null;
    }) {
        .err => |err| {
            globalThis.throwValue(err.toJSC(globalThis));
            return null;
        },
        else => {},
    }

    return globWalker;
}

pub fn constructor(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) ?*Glob {
    const alloc = getAllocator(globalThis);

    const arguments_ = callframe.arguments(1);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const pat_arg = arguments.nextEat() orelse {
        globalThis.throw("Glob.constructor: expected 1 arguments, got 0", .{});
        return null;
    };

    if (!pat_arg.isString()) {
        globalThis.throw("Glob.constructor: first argument is not a string", .{});
        return null;
    }

    var pat_str: []u8 = pat_arg.getZigString(globalThis).toOwnedSlice(globalThis.bunVM().allocator) catch @panic("OOM");

    const all_ascii = isAllAscii(pat_str);

    var glob = alloc.create(Glob) catch @panic("OOM");
    glob.* = .{ .pattern = pat_str, .is_ascii = all_ascii };

    if (!all_ascii) {
        var codepoints = std.ArrayList(u32).initCapacity(alloc, glob.pattern.len * 2) catch {
            globalThis.throwOutOfMemory();
            return null;
        };
        errdefer codepoints.deinit();

        convertUtf8(&codepoints, glob.pattern) catch {
            globalThis.throwOutOfMemory();
            return null;
        };

        glob.pattern_codepoints = codepoints;
    }

    return glob;
}

pub fn finalize(
    this: *Glob,
) callconv(.C) void {
    const alloc = JSC.VirtualMachine.get().allocator;
    alloc.free(this.pattern);
    alloc.destroy(this);
}

pub fn hasPendingActivity(this: *Glob) callconv(.C) bool {
    @fence(.SeqCst);
    return this.has_pending_activity.load(.SeqCst);
}

fn updateHasPendingActivityFlag(has_pending_activity: *std.atomic.Atomic(bool), value: bool) void {
    @fence(.SeqCst);
    has_pending_activity.store(value, .SeqCst);
}

pub fn match(this: *Glob, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const alloc = getAllocator(globalThis);

    const arguments_ = callframe.arguments(1);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();

    const arena = std.heap.ArenaAllocator.init(alloc);
    var globWalker = this.makeGlobWalker(globalThis, &arguments, "match", alloc, arena) orelse {
        arena.deinit();
        return .undefined;
    };

    updateHasPendingActivityFlag(&this.has_pending_activity, true);
    var task = WalkTask.create(globalThis, alloc, globWalker, &this.has_pending_activity) catch {
        updateHasPendingActivityFlag(&this.has_pending_activity, false);
        globalThis.throw("Out of memory", .{});
        return .undefined;
    };
    task.schedule();

    return task.promise.value();
}

pub fn matchSync(this: *Glob, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const alloc = getAllocator(globalThis);

    const arguments_ = callframe.arguments(1);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();

    const arena = std.heap.ArenaAllocator.init(alloc);
    var globWalker = this.makeGlobWalker(globalThis, &arguments, "match", alloc, arena) orelse {
        arena.deinit();
        return .undefined;
    };
    defer globWalker.deinit();

    switch (globWalker.walk() catch {
        globalThis.throw("Out of memory", .{});
        return .undefined;
    }) {
        .err => |err| {
            globalThis.throwValue(err.toJSC(globalThis));
            return JSValue.undefined;
        },
        .result => {},
    }

    const matchedPaths = globWalkResultToJS(globWalker, globalThis);

    return matchedPaths;
}

pub fn matchString(this: *Glob, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const alloc = getAllocator(globalThis);
    var arena = Arena.init(alloc);
    defer arena.deinit();

    const arguments_ = callframe.arguments(1);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const str_arg = arguments.nextEat() orelse {
        globalThis.throw("Glob.matchString: expected 1 arguments, got 0", .{});
        return JSC.JSValue.jsUndefined();
    };

    if (!str_arg.isString()) {
        globalThis.throw("Glob.matchString: first argument is not a string", .{});
        return JSC.JSValue.jsUndefined();
    }

    var str = str_arg.toSlice(globalThis, arena.allocator());
    defer str.deinit();

    if (this.is_ascii and isAllAscii(str.slice())) return JSC.JSValue.jsBoolean(globImplAscii.match(this.pattern, str.slice()));

    const codepoints = codepoints: {
        if (this.pattern_codepoints) |cp| break :codepoints cp.items[0..];

        var codepoints = std.ArrayList(u32).initCapacity(alloc, this.pattern.len * 2) catch {
            globalThis.throwOutOfMemory();
            return .undefined;
        };
        errdefer codepoints.deinit();

        convertUtf8(&codepoints, this.pattern) catch {
            globalThis.throwOutOfMemory();
            return .undefined;
        };

        this.pattern_codepoints = codepoints;

        break :codepoints codepoints.items[0..codepoints.items.len];
    };

    return JSC.JSValue.jsBoolean(globImpl.matchImpl(codepoints, str.slice()));
}

pub fn convertUtf8(codepoints: *std.ArrayList(u32), pattern: []const u8) !void {
    const iter = CodepointIterator.init(pattern);
    var cursor = CodepointIterator.Cursor{};
    var i: u32 = 0;
    while (iter.next(&cursor)) : (i += 1) {
        try codepoints.append(@intCast(cursor.c));
    }
}
