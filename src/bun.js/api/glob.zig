const Glob = @This();

pub const js = jsc.Codegen.JSGlob;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pattern: []const u8,
pattern_codepoints: ?std.ArrayList(u32) = null,
has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),

// Use SortField from the GlobWalker implementation
const SortField = @import("../../glob/GlobWalker.zig").SortField;

const ScanOpts = struct {
    cwd: ?[]const u8,
    dot: bool,
    absolute: bool,
    only_files: bool,
    follow_symlinks: bool,
    error_on_broken_symlinks: bool,
    limit: ?u32,
    offset: u32,
    sort: ?SortField,
    ignore: ?[][]const u8,
    nocase: bool,
    signal: ?*webcore.AbortSignal,

    fn parseCWD(globalThis: *JSGlobalObject, allocator: std.mem.Allocator, cwdVal: jsc.JSValue, absolute: bool, comptime fnName: string) bun.JSError![]const u8 {
        const cwd_str_raw = try cwdVal.toSlice(globalThis, allocator);
        if (cwd_str_raw.len == 0) return "";

        const cwd_str = cwd_str: {
            // If its absolute return as is
            if (ResolvePath.Platform.auto.isAbsolute(cwd_str_raw.slice())) {
                const cwd_str = try cwd_str_raw.cloneIfNeeded(allocator);
                break :cwd_str cwd_str.ptr[0..cwd_str.len];
            }

            var path_buf2: [bun.MAX_PATH_BYTES * 2]u8 = undefined;

            if (!absolute) {
                const cwd_str = ResolvePath.joinStringBuf(&path_buf2, &[_][]const u8{cwd_str_raw.slice()}, .auto);
                break :cwd_str try allocator.dupe(u8, cwd_str);
            }

            // Convert to an absolute path
            var path_buf: bun.PathBuffer = undefined;
            const cwd = switch (bun.sys.getcwd((&path_buf))) {
                .result => |cwd| cwd,
                .err => |err| {
                    const errJs = err.toJS(globalThis);
                    return globalThis.throwValue(errJs);
                },
            };

            const cwd_str = ResolvePath.joinStringBuf(&path_buf2, &[_][]const u8{
                cwd,
                cwd_str_raw.slice(),
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
            .limit = null,
            .offset = 0,
            .sort = null,
            .ignore = null,
            .nocase = false,
            .signal = null,
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

        if (try optsObj.getTruthy(globalThis, "limit")) |limit| {
            if (limit.isNumber()) {
                const limit_num = limit.coerce(i32, globalThis) catch 0;
                if (limit_num >= 0) {
                    out.limit = @intCast(limit_num);
                }
            }
        }

        if (try optsObj.getTruthy(globalThis, "offset")) |offset| {
            if (offset.isNumber()) {
                const offset_num = offset.coerce(i32, globalThis) catch 0;
                if (offset_num >= 0) {
                    out.offset = @intCast(offset_num);
                }
            }
        }

        if (try optsObj.getTruthy(globalThis, "sort")) |sort| {
            if (sort.isString()) {
                const sort_str = try sort.toSlice(globalThis, arena.allocator());
                defer sort_str.deinit();
                if (std.mem.eql(u8, sort_str.slice(), "name")) {
                    out.sort = .name;
                } else if (std.mem.eql(u8, sort_str.slice(), "mtime")) {
                    out.sort = .mtime;
                } else if (std.mem.eql(u8, sort_str.slice(), "atime")) {
                    out.sort = .atime;
                } else if (std.mem.eql(u8, sort_str.slice(), "ctime")) {
                    out.sort = .ctime;
                } else if (std.mem.eql(u8, sort_str.slice(), "size")) {
                    out.sort = .size;
                }
            }
        }

        if (try optsObj.getTruthy(globalThis, "nocase")) |nocase| {
            out.nocase = if (nocase.isBoolean()) nocase.asBoolean() else false;
        }

        if (try optsObj.getTruthy(globalThis, "ignore")) |ignore| {
            if (ignore.jsType() == .Array) {
                // Collect patterns by iterating until we get undefined
                var patterns = std.ArrayList([]const u8).init(arena.allocator());
                defer patterns.deinit();
                
                var i: u32 = 0;
                const max_patterns = 1000; // Reasonable safety limit
                while (i < max_patterns) : (i += 1) {
                    const item = ignore.getDirectIndex(globalThis, i);
                    if (item.isUndefinedOrNull()) break;
                    
                    if (item.isString()) {
                        const pattern_str = try item.toSlice(globalThis, arena.allocator());
                        try patterns.append(try arena.allocator().dupe(u8, pattern_str.slice()));
                    }
                }
                
                if (patterns.items.len > 0) {
                    out.ignore = try arena.allocator().dupe([]const u8, patterns.items);
                }
            }
        }

        if (try optsObj.getTruthy(globalThis, "signal")) |signal_val| {
            if (webcore.AbortSignal.fromJS(signal_val)) |signal| {
                // Keep it alive
                signal_val.ensureStillAlive();
                out.signal = signal;
            } else {
                return globalThis.throwInvalidArguments("signal is not of type AbortSignal", .{});
            }
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

        pub fn toJS(this: Err, globalThis: *JSGlobalObject) JSValue {
            return switch (this) {
                .syscall => |err| err.toJS(globalThis),
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
        return try AsyncGlobWalkTask.createOnJSThread(alloc, globalThis, walkTask);
    }

    pub fn run(this: *WalkTask) void {
        defer decrPendingActivityFlag(this.has_pending_activity);
        defer {
            // Clean up abort signal if it exists
            this.walker.clearAbortSignal();
        }
        
        // Set up abort signal listener if provided
        if (this.walker.abort_signal) |signal| {
            signal.pendingActivityRef();
            _ = signal.addListener(this.walker, GlobWalker.onAbortSignal);
        }
        
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

    pub fn then(this: *WalkTask, promise: *jsc.JSPromise) void {
        defer this.deinit();

        if (this.err) |err| {
            const errJs = err.toJS(this.global);
            promise.reject(this.global, errJs);
            return;
        }

        const jsStrings = globWalkResultToJS(this.walker, this.global) catch return promise.reject(this.global, error.JSError);
        promise.resolve(this.global, jsStrings);
    }

    fn deinit(this: *WalkTask) void {
        this.walker.deinit(true);
        this.alloc.destroy(this);
    }
};

fn globWalkResultToJS(globWalk: *GlobWalker, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    const files_array: JSValue = if (globWalk.matchedPaths.keys().len == 0) 
        (jsc.JSValue.createEmptyArray(globalThis, 0) catch .js_undefined) 
    else 
        (BunString.toJSArray(globalThis, globWalk.matchedPaths.keys()) catch .js_undefined);
        
    // If pagination options were used (limit is set), return structured result
    if (globWalk.limit != null or globWalk.offset > 0 or globWalk.sort_field != null) {
        const result_obj = jsc.JSValue.createEmptyObject(globalThis, 2);
        result_obj.put(globalThis, ZigString.static("files"), files_array);
        const has_more = jsc.JSValue.jsBoolean(globWalk.has_more);
        result_obj.put(globalThis, ZigString.static("hasMore"), has_more);
        return result_obj;
    }
    
    // Otherwise return just the array for backward compatibility
    return files_array;
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
    const nocase = matchOpts.nocase;
    const limit = matchOpts.limit;
    const offset = matchOpts.offset;
    const sort_field = matchOpts.sort;
    const ignore_patterns = matchOpts.ignore;
    const abort_signal = matchOpts.signal;

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
            nocase,
            limit,
            offset,
            sort_field,
            ignore_patterns,
            abort_signal,
        )) {
            .err => |err| {
                return globalThis.throwValue(err.toJS(globalThis));
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
            return globalThis.throwValue(err.toJS(globalThis));
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

    const pat_str: []u8 = @constCast((pat_arg.toSliceClone(globalThis) orelse return error.JSError).slice());

    const glob = alloc.create(Glob) catch bun.outOfMemory();
    glob.* = .{ .pattern = pat_str };

    return glob;
}

pub fn finalize(
    this: *Glob,
) callconv(.C) void {
    const alloc = jsc.VirtualMachine.get().allocator;
    alloc.free(this.pattern);
    if (this.pattern_codepoints) |*codepoints| {
        codepoints.deinit();
    }
    alloc.destroy(this);
}

pub fn hasPendingActivity(this: *Glob) callconv(.C) bool {
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
            return globalThis.throwValue(err.toJS(globalThis));
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

    return jsc.JSValue.jsBoolean(globImpl.match(arena.allocator(), this.pattern, str.slice()).matches());
}

pub fn convertUtf8(codepoints: *std.ArrayList(u32), pattern: []const u8) !void {
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

const globImpl = @import("../../glob.zig");
const GlobWalker = globImpl.BunGlobWalker;

const bun = @import("bun");
const BunString = bun.String;
const CodepointIterator = bun.strings.UnsignedCodepointIterator;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const ArgumentsSlice = jsc.CallFrame.ArgumentsSlice;

const webcore = jsc.WebCore;
