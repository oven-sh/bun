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
            var cwdStr: BunString = cwdVal.toBunString(globalThis);
            // assuming length means byte length here
            if (cwdStr.length() > bun.MAX_PATH_BYTES) {
                globalThis.throw("{s}: invalid `cwd`, longer than {d} bytes", .{ fnName, bun.MAX_PATH_BYTES });
                return null;
            }
            const cwdOwnedSlice = cwdStr.toOwnedSlice(globWalkerAllocator) catch @panic("OOM");
            const cwdStrOwned = BunString.fromBytes(cwdOwnedSlice);

            out.cwd = cwdStrOwned;
        }

        return out;
    }
};

pub const WalkTask = struct {
    walker: *GlobWalker,
    err: ?Err = null,
    global: *JSC.JSGlobalObject,
    const Err = union(enum) {
        syscall: Syscall.Error,
        unknown: anyerror,
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
        // defer this.deinit();

        if (this.err) |err| {
            _ = err;
            // todo: error handling
            const errorValue = JSC.JSValue.jsUndefined();
            promise.reject(this.global, errorValue);
            return;
        }

        const jsStrings = globWalkResultToJS(this.walker, this.global);
        this.deinit();

        return promise.resolve(this.global, jsStrings);
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

    // Would be nice to construct JSArray without allocating array first
    var jsValues = @import("std").ArrayList(JSC.JSValue).init(globWalk.allocator);
    defer jsValues.deinit();
    for (globWalk.matchedPaths.items) |*item| {
        // FIXME: gracefully handle this error
        jsValues.append(item.toJS(globalThis)) catch @panic("OOM");
        // jsValues.append(.undefined) catch @panic("OOM");
    }
    return JSC.JSArray.from(globalThis, jsValues.items[0..jsValues.items.len]);
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
