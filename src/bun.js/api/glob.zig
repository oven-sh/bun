const Glob = @This();

pub const js = jsc.Codegen.JSGlob;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pattern: []const u8,
pattern_codepoints: ?std.array_list.Managed(u32) = null,
has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),

const ScanOpts = struct {
    cwd: ?[]const u8,
    dot: bool,
    absolute: bool,
    only_files: bool,
    follow_symlinks: bool,
    error_on_broken_symlinks: bool,

    fn parseCWD(globalThis: *JSGlobalObject, allocator: std.mem.Allocator, cwdVal: jsc.JSValue, absolute: bool, comptime fnName: string) bun.JSError![]const u8 {
        const cwd_string: bun.String = try .fromJS(cwdVal, globalThis);
        defer cwd_string.deref();
        if (cwd_string.isEmpty()) return "";

        const cwd_str: []const u8 = cwd_str: {
            const cwd_utf8 = cwd_string.toUTF8WithoutRef(allocator);

            // If its absolute return as is
            if (ResolvePath.Platform.auto.isAbsolute(cwd_utf8.slice())) {
                break :cwd_str (try cwd_utf8.cloneIfBorrowed(allocator)).slice();
            }

            defer cwd_utf8.deinit();
            var path_buf2: [bun.MAX_PATH_BYTES * 2]u8 = undefined;

            if (!absolute) {
                const parts: []const []const u8 = &.{cwd_utf8.slice()};
                const cwd_str = ResolvePath.joinStringBuf(&path_buf2, parts, .auto);
                break :cwd_str try allocator.dupe(u8, cwd_str);
            }

            // Convert to an absolute path
            var path_buf: bun.PathBuffer = undefined;
            const cwd = switch (bun.sys.getcwd((&path_buf))) {
                .result => |cwd| cwd,
                .err => |err| {
                    const errJs = try err.toJS(globalThis);
                    return globalThis.throwValue(errJs);
                },
            };

            const cwd_str = ResolvePath.joinStringBuf(&path_buf2, &[_][]const u8{
                cwd,
                cwd_utf8.slice(),
            }, .auto);
            break :cwd_str try allocator.dupe(u8, cwd_str);
        };

        if (cwd_str.len > bun.MAX_PATH_BYTES) {
            return globalThis.throw("{s}: invalid `cwd`, longer than {d} bytes", .{ fnName, bun.MAX_PATH_BYTES });
        }

        return cwd_str;
    }

    fn fromJS(globalThis: *JSGlobalObject, arguments: *ArgumentsSlice, comptime fnName: []const u8, arena: *Arena) bun.JSError!?ScanOpts {
        const optsObj: JSValue = arguments.nextEat() orelse return null;
        var out: ScanOpts = .{
            .cwd = null,
            .dot = false,
            .absolute = false,
            .follow_symlinks = false,
            .error_on_broken_symlinks = false,
            .only_files = true,
        };
        if (optsObj.isUndefinedOrNull()) return out;
        if (!optsObj.isObject()) {
            if (optsObj.isString()) {
                {
                    const result = try parseCWD(globalThis, arena.allocator(), optsObj, out.absolute, fnName);
                    if (result.len > 0) {
                        out.cwd = result;
                    }
                }
                return out;
            }
            return globalThis.throw("{s}: expected first argument to be an object", .{fnName});
        }

        if (try optsObj.getTruthy(globalThis, "onlyFiles")) |only_files| {
            out.only_files = if (only_files.isBoolean()) only_files.asBoolean() else false;
        }

        if (try optsObj.getTruthy(globalThis, "throwErrorOnBrokenSymlink")) |error_on_broken| {
            out.error_on_broken_symlinks = if (error_on_broken.isBoolean()) error_on_broken.asBoolean() else false;
        }

        if (try optsObj.getTruthy(globalThis, "followSymlinks")) |followSymlinksVal| {
            out.follow_symlinks = if (followSymlinksVal.isBoolean()) followSymlinksVal.asBoolean() else false;
        }

        if (try optsObj.getTruthy(globalThis, "absolute")) |absoluteVal| {
            out.absolute = if (absoluteVal.isBoolean()) absoluteVal.asBoolean() else false;
        }

        if (try optsObj.getTruthy(globalThis, "cwd")) |cwdVal| {
            if (!cwdVal.isString()) {
                return globalThis.throw("{s}: invalid `cwd`, not a string", .{fnName});
            }

            {
                const result = try parseCWD(globalThis, arena.allocator(), cwdVal, out.absolute, fnName);
                if (result.len > 0) {
                    out.cwd = result;
                }
            }
        }

        if (try optsObj.getTruthy(globalThis, "dot")) |dot| {
            out.dot = if (dot.isBoolean()) dot.asBoolean() else false;
        }

        return out;
    }
};

pub const WalkTask = struct {
    walker: *GlobWalker,
    alloc: Allocator,
    err: ?Err = null,
    global: *jsc.JSGlobalObject,
    has_pending_activity: *std.atomic.Value(usize),

    pub const Err = union(enum) {
        syscall: Syscall.Error,
        unknown: anyerror,

        pub fn toJS(this: Err, globalThis: *JSGlobalObject) bun.JSError!JSValue {
            return switch (this) {
                .syscall => |err| try err.toJS(globalThis),
                .unknown => |err| ZigString.fromBytes(@errorName(err)).toJS(globalThis),
            };
        }
    };

    pub const AsyncGlobWalkTask = jsc.ConcurrentPromiseTask(WalkTask);

    pub fn create(
        globalThis: *jsc.JSGlobalObject,
        alloc: Allocator,
        globWalker: *GlobWalker,
        has_pending_activity: *std.atomic.Value(usize),
    ) !*AsyncGlobWalkTask {
        const walkTask = try alloc.create(WalkTask);
        walkTask.* = .{
            .walker = globWalker,
            .global = globalThis,
            .alloc = alloc,
            .has_pending_activity = has_pending_activity,
        };
        return AsyncGlobWalkTask.createOnJSThread(alloc, globalThis, walkTask);
    }

    pub fn run(this: *WalkTask) void {
        defer decrPendingActivityFlag(this.has_pending_activity);
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

    pub fn then(this: *WalkTask, promise: *jsc.JSPromise) bun.JSTerminated!void {
        defer this.deinit();

        if (this.err) |err| {
            const errJs = err.toJS(this.global);
            try promise.reject(this.global, errJs);
            return;
        }

        const jsStrings = globWalkResultToJS(this.walker, this.global) catch return promise.reject(this.global, error.JSError);
        try promise.resolve(this.global, jsStrings);
    }

    fn deinit(this: *WalkTask) void {
        this.walker.deinit(true);
        this.alloc.destroy(this);
    }
};

fn globWalkResultToJS(globWalk: *GlobWalker, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    if (globWalk.matchedPaths.keys().len == 0) {
        return jsc.JSValue.createEmptyArray(globalThis, 0);
    }

    return BunString.toJSArray(globalThis, globWalk.matchedPaths.keys());
}

/// The reference to the arena is not used after the scope because it is copied
/// by `GlobWalker.init`/`GlobWalker.initWithCwd` if all allocations work and no
/// errors occur
fn makeGlobWalker(
    this: *Glob,
    globalThis: *JSGlobalObject,
    arguments: *ArgumentsSlice,
    comptime fnName: []const u8,
    alloc: Allocator,
    arena: *Arena,
) bun.JSError!?*GlobWalker {
    const matchOpts = try ScanOpts.fromJS(globalThis, arguments, fnName, arena) orelse return null;
    const cwd = matchOpts.cwd;
    const dot = matchOpts.dot;
    const absolute = matchOpts.absolute;
    const follow_symlinks = matchOpts.follow_symlinks;
    const error_on_broken_symlinks = matchOpts.error_on_broken_symlinks;
    const only_files = matchOpts.only_files;

    var globWalker = try alloc.create(GlobWalker);
    errdefer alloc.destroy(globWalker);
    globWalker.* = .{};

    if (cwd != null) {
        switch (try globWalker.initWithCwd(
            arena,
            this.pattern,
            cwd.?,
            dot,
            absolute,
            follow_symlinks,
            error_on_broken_symlinks,
            only_files,
        )) {
            .err => |err| {
                return globalThis.throwValue(try err.toJS(globalThis));
            },
            else => {},
        }
        return globWalker;
    }

    switch (try globWalker.init(
        arena,
        this.pattern,
        dot,
        absolute,
        follow_symlinks,
        error_on_broken_symlinks,
        only_files,
    )) {
        .err => |err| {
            return globalThis.throwValue(try err.toJS(globalThis));
        },
        else => {},
    }
    return globWalker;
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*Glob {
    const alloc = bun.default_allocator;

    const arguments_ = callframe.arguments_old(1);
    var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const pat_arg: JSValue = arguments.nextEat() orelse {
        return globalThis.throw("Glob.constructor: expected 1 arguments, got 0", .{});
    };

    if (!pat_arg.isString()) {
        return globalThis.throw("Glob.constructor: first argument is not a string", .{});
    }

    const pat_str: []u8 = @constCast((try pat_arg.toSliceClone(globalThis)).slice());

    const glob = bun.handleOom(alloc.create(Glob));
    glob.* = .{ .pattern = pat_str };

    return glob;
}

pub fn finalize(
    this: *Glob,
) callconv(.c) void {
    const alloc = jsc.VirtualMachine.get().allocator;
    alloc.free(this.pattern);
    if (this.pattern_codepoints) |*codepoints| {
        codepoints.deinit();
    }
    alloc.destroy(this);
}

pub fn hasPendingActivity(this: *Glob) callconv(.c) bool {
    return this.has_pending_activity.load(.seq_cst) > 0;
}

fn incrPendingActivityFlag(has_pending_activity: *std.atomic.Value(usize)) void {
    _ = has_pending_activity.fetchAdd(1, .seq_cst);
}

fn decrPendingActivityFlag(has_pending_activity: *std.atomic.Value(usize)) void {
    _ = has_pending_activity.fetchSub(1, .seq_cst);
}

pub fn __scan(this: *Glob, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const alloc = bun.default_allocator;

    const arguments_ = callframe.arguments_old(1);
    var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();

    var arena = std.heap.ArenaAllocator.init(alloc);
    const globWalker = try this.makeGlobWalker(globalThis, &arguments, "scan", alloc, &arena) orelse {
        arena.deinit();
        return .js_undefined;
    };

    incrPendingActivityFlag(&this.has_pending_activity);
    var task = WalkTask.create(globalThis, alloc, globWalker, &this.has_pending_activity) catch {
        decrPendingActivityFlag(&this.has_pending_activity);
        return globalThis.throwOutOfMemory();
    };
    task.schedule();

    return task.promise.value();
}

pub fn __scanSync(this: *Glob, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const alloc = bun.default_allocator;

    const arguments_ = callframe.arguments_old(1);
    var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();

    var arena = std.heap.ArenaAllocator.init(alloc);
    var globWalker = try this.makeGlobWalker(globalThis, &arguments, "scanSync", alloc, &arena) orelse {
        arena.deinit();
        return .js_undefined;
    };
    defer globWalker.deinit(true);

    switch (try globWalker.walk()) {
        .err => |err| {
            return globalThis.throwValue(try err.toJS(globalThis));
        },
        .result => {},
    }

    const matchedPaths = globWalkResultToJS(globWalker, globalThis);

    return matchedPaths;
}

pub fn match(this: *Glob, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const alloc = bun.default_allocator;
    var arena = Arena.init(alloc);
    defer arena.deinit();

    const arguments_ = callframe.arguments_old(1);
    var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const str_arg = arguments.nextEat() orelse {
        return globalThis.throw("Glob.matchString: expected 1 arguments, got 0", .{});
    };

    if (!str_arg.isString()) {
        return globalThis.throw("Glob.matchString: first argument is not a string", .{});
    }

    var str = try str_arg.toSlice(globalThis, arena.allocator());
    defer str.deinit();

    return jsc.JSValue.jsBoolean(bun.glob.match(this.pattern, str.slice()).matches());
}

pub fn convertUtf8(codepoints: *std.array_list.Managed(u32), pattern: []const u8) !void {
    const iter = CodepointIterator.init(pattern);
    var cursor = CodepointIterator.Cursor{};
    while (iter.next(&cursor)) {
        try codepoints.append(@intCast(cursor.c));
    }
}

const string = []const u8;

const ResolvePath = @import("../../resolver/resolve_path.zig");
const Syscall = @import("../../sys.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;
const Arena = std.heap.ArenaAllocator;

const bun = @import("bun");
const BunString = bun.String;
const CodepointIterator = bun.strings.UnsignedCodepointIterator;
const GlobWalker = bun.glob.BunGlobWalker;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const ArgumentsSlice = jsc.CallFrame.ArgumentsSlice;
