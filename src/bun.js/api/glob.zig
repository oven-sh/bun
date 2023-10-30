const Glob = @This();
const globImpl = @import("../../glob.zig");
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

pub usingnamespace JSC.Codegen.JSGlob;

pattern: []const u8,

const MatchOpts = struct {
    cwd: ?BunString,

    fn fromJS(globalThis: *JSGlobalObject, arguments: *ArgumentsSlice, fnName: []const u8, globWalkerAllocator: Allocator) ?MatchOpts {
        const optsObj: JSValue = arguments.nextEat() orelse return null;
        if (!optsObj.isObject()) {
            globalThis.throw("{s}: expected first argument to be an object", .{fnName});
            return null;
        }

        var out: MatchOpts = .{
            .cwd = null,
        };

        if (optsObj.get(globalThis, "cwd")) |cwdVal| {
            if (!cwdVal.isString()) {
                globalThis.throw("{s}: invalid `cwd`, not a string", .{fnName});
                return null;
            }

            var cwd_str_raw = cwdVal.toSlice(globalThis, globWalkerAllocator);
            defer cwd_str_raw.deinit();
            if (cwd_str_raw.len == 0) {
                globalThis.throw("{s}: invalid `cwd`, empty string", .{fnName});
                return null;
            }

            const cwd_str = cwd_str: {
                if (ResolvePath.Platform.auto.isAbsolute(cwd_str_raw.slice())) {
                    // FIXME: this check breaks if input is not all ascii also doesnt work on windows
                    if (cwd_str_raw.len > 1 and cwd_str_raw.slice()[cwd_str_raw.len - 1] == '/') {
                        const without_trailing_slash = ZigString.Slice{ .ptr = cwd_str_raw.ptr, .len = cwd_str_raw.len - 1, .allocator = cwd_str_raw.allocator };
                        const trailing_slash_stripped = without_trailing_slash.clone(globWalkerAllocator) catch {
                            globalThis.throwOutOfMemory();
                            return null;
                        };
                        break :cwd_str trailing_slash_stripped.ptr[0..trailing_slash_stripped.len];
                    }
                    const cwd_str = cwd_str_raw.clone(globWalkerAllocator) catch {
                        globalThis.throwOutOfMemory();
                        return null;
                    };
                    break :cwd_str cwd_str.ptr[0..cwd_str.len];
                }

                break :cwd_str ResolvePath.relativeAlloc(globWalkerAllocator, "", cwd_str_raw.slice()) catch {
                    globalThis.throwOutOfMemory();
                    return null;
                };
            };

            if (cwd_str.len > bun.MAX_PATH_BYTES) {
                globWalkerAllocator.free(cwd_str);
                globalThis.throw("{s}: invalid `cwd`, longer than {d} bytes", .{ fnName, bun.MAX_PATH_BYTES });
                return null;
            }

            out.cwd = BunString.fromBytes(cwd_str);
        }

        return out;
    }
};

pub const WalkTask = struct {
    walker: *GlobWalker,
    err: ?Err = null,
    global: *JSC.JSGlobalObject,
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

    pub fn create(globalThis: *JSC.JSGlobalObject, globWalker: *GlobWalker) !*AsyncGlobWalkTask {
        var walkTask = try globWalker.allocator.create(WalkTask);
        walkTask.* = .{
            .walker = globWalker,
            .global = globalThis,
        };
        return try AsyncGlobWalkTask.createOnJSThread(globWalker.allocator, globalThis, walkTask);
    }

    pub fn run(this: *WalkTask) void {
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
        bun.default_allocator.destroy(this);
    }
};

fn globWalkResultToJS(globWalk: *GlobWalker, globalThis: *JSGlobalObject) JSValue {
    // if (globWalk.matchedPaths.items.len >= 0) {
    if (globWalk.matchedPaths.items.len == 0) {
        return JSC.JSArray.from(globalThis, &[_]JSC.JSValue{});
    }

    return BunString.toJSArray(globalThis, globWalk.matchedPaths.items[0..]);
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

    var glob = alloc.create(Glob) catch @panic("OOM");
    glob.* = .{
        .pattern = pat_str,
    };

    return glob;
}

pub fn finalize(
    this: *Glob,
) callconv(.C) void {
    const alloc = JSC.VirtualMachine.get().allocator;
    alloc.free(this.pattern);
    alloc.destroy(this);
}

pub fn match(this: *Glob, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const alloc = getAllocator(globalThis);

    const arguments_ = callframe.arguments(1);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();

    const globWalkerAllocator = alloc;
    var globWalker = globWalker: {
        const matchOpts = MatchOpts.fromJS(globalThis, &arguments, "match", globWalkerAllocator);
        if (matchOpts != null and matchOpts.?.cwd != null) {
            var globWalker = alloc.create(GlobWalker) catch {
                globalThis.throw("Out of memory", .{});
                return .undefined;
            };

            globWalker.* = .{};
            globWalker.initWithCwd(globWalkerAllocator, this.pattern, matchOpts.?.cwd.?) catch {
                globalThis.throw("Out of memory", .{});
                return .undefined;
            };
            break :globWalker globWalker;
        }
        var globWalker = alloc.create(GlobWalker) catch {
            globalThis.throw("Out of memory", .{});
            return .undefined;
        };

        globWalker.* = .{};
        switch (globWalker.init(globWalkerAllocator, this.pattern) catch {
            globalThis.throw("Out of memory", .{});
            return .undefined;
        }) {
            .err => |err| {
                globalThis.throwValue(err.toJSC(globalThis));
                return JSValue.undefined;
            },
            else => {},
        }
        break :globWalker globWalker;
    };

    var task = WalkTask.create(globalThis, globWalker) catch {
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

    const globWalkerAllocator = alloc;
    var globWalker = globWalker: {
        const matchOpts = MatchOpts.fromJS(globalThis, &arguments, "match", globWalkerAllocator);
        if (matchOpts != null and matchOpts.?.cwd != null) {
            var globWalker = alloc.create(GlobWalker) catch {
                globalThis.throw("Out of memory", .{});
                return .undefined;
            };

            globWalker.* = .{};
            globWalker.initWithCwd(globWalkerAllocator, this.pattern, matchOpts.?.cwd.?) catch {
                globalThis.throw("Out of memory", .{});
                return .undefined;
            };
            break :globWalker globWalker;
        }
        var globWalker = alloc.create(GlobWalker) catch {
            globalThis.throw("Out of memory", .{});
            return .undefined;
        };

        globWalker.* = .{};
        switch (globWalker.init(globWalkerAllocator, this.pattern) catch {
            globalThis.throw("Out of memory", .{});
            return .undefined;
        }) {
            .err => |err| {
                globalThis.throwValue(err.toJSC(globalThis));
                return JSValue.undefined;
            },
            else => {},
        }
        break :globWalker globWalker;
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

pub fn matchString(this: *Glob, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const alloc = getAllocator(globalThis);

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

    var str = str_arg.toSlice(globalThis, alloc);
    defer str.deinit();

    return JSC.JSValue.jsBoolean(globImpl.match(this.pattern, str.slice()));
}
