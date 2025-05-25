const std = @import("std");
const bun = @import("bun");
const windows = bun.windows;
const uv = windows.libuv;
const string = bun.string;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const Output = bun.Output;
const Watcher = bun.Watcher;

const FSWatcher = bun.JSC.Node.fs.Watcher;
const EventType = @import("./path_watcher.zig").PathWatcher.EventType;
const Event = FSWatcher.Event;

var default_manager: ?*PathWatcherManager = null;

// TODO: make this a generic so we can reuse code with path_watcher
// TODO: we probably should use native instead of libuv abstraction here for better performance
pub const PathWatcherManager = struct {
    const options = @import("../../options.zig");
    const log = Output.scoped(.PathWatcherManager, false);

    watchers: bun.StringArrayHashMapUnmanaged(*PathWatcher) = .{},
    vm: *JSC.VirtualMachine,
    deinit_on_last_watcher: bool = false,

    pub const new = bun.TrivialNew(PathWatcherManager);

    pub fn init(vm: *JSC.VirtualMachine) *PathWatcherManager {
        return PathWatcherManager.new(.{
            .watchers = .{},
            .vm = vm,
        });
    }

    // unregister is always called form main thread
    fn unregisterWatcher(this: *PathWatcherManager, watcher: *PathWatcher, path: [:0]const u8) void {
        defer {
            if (this.deinit_on_last_watcher and this.watchers.count() == 0) {
                this.deinit();
            }
        }

        if (std.mem.indexOfScalar(*PathWatcher, this.watchers.values(), watcher)) |index| {
            if (comptime bun.Environment.isDebug) {
                if (path.len > 0)
                    bun.assert(bun.strings.eql(this.watchers.keys()[index], path));
            }

            bun.default_allocator.free(this.watchers.keys()[index]);
            _ = this.watchers.swapRemoveAt(index);
        }
    }

    fn deinit(this: *PathWatcherManager) void {
        // enable to create a new manager
        if (default_manager == this) {
            default_manager = null;
        }

        if (this.watchers.count() != 0) {
            this.deinit_on_last_watcher = true;
            return;
        }

        for (this.watchers.values()) |watcher| {
            watcher.manager = null;
            watcher.deinit();
        }

        for (this.watchers.keys()) |path| {
            bun.default_allocator.free(path);
        }

        this.watchers.deinit(bun.default_allocator);
        bun.destroy(this);
    }
};

const onPathUpdateFn = JSC.Node.fs.Watcher.onPathUpdate;
const onUpdateEndFn = JSC.Node.fs.Watcher.onUpdateEnd;

pub const PathWatcher = struct {
    handle: uv.uv_fs_event_t,
    manager: ?*PathWatcherManager,
    emit_in_progress: bool = false,
    handlers: std.AutoArrayHashMapUnmanaged(*anyopaque, ChangeEvent) = .{},

    pub const new = bun.TrivialNew(PathWatcher);

    const log = Output.scoped(.@"fs.watch", false);

    pub const ChangeEvent = struct {
        hash: Watcher.HashType = 0,
        event_type: EventType = .change,
        timestamp: u64 = 0,

        pub fn emit(this: *ChangeEvent, hash: Watcher.HashType, timestamp: u64, event_type: EventType) bool {
            const time_diff = timestamp -| this.timestamp;
            // skip consecutive duplicates
            if ((this.timestamp == 0 or time_diff > 1) or this.event_type != event_type and this.hash != hash) {
                this.timestamp = timestamp;
                this.event_type = event_type;
                this.hash = hash;

                return true;
            }
            return false;
        }
    };

    const Callback = *const fn (ctx: ?*anyopaque, event: Event, is_file: bool) void;
    const UpdateEndCallback = *const fn (ctx: ?*anyopaque) void;

    fn uvEventCallback(event: *uv.uv_fs_event_t, filename: ?[*:0]const u8, events: c_int, status: uv.ReturnCode) callconv(.C) void {
        if (event.data == null) {
            Output.debugWarn("uvEventCallback called with null data", .{});
            return;
        }
        const this: *PathWatcher = @alignCast(@fieldParentPtr("handle", event));
        if (comptime bun.Environment.isDebug) {
            bun.assert(event.data == @as(?*anyopaque, @ptrCast(this)));
        }

        const timestamp = event.loop.time;

        if (status.toError(.watch)) |err| {
            this.emit_in_progress = true;
            defer this.emit_in_progress = false;

            const ctxs = this.handlers.keys();
            for (ctxs) |ctx| {
                onPathUpdateFn(ctx, .{ .@"error" = err }, false);
                onUpdateEndFn(ctx);
            }
            this.maybeDeinit();

            return;
        }

        const path = if (filename) |file| file[0..bun.len(file) :0] else return;

        this.emit(
            path,
            @truncate(event.hash(path, events, status)),
            timestamp,
            !event.isDir(),
            if (events & uv.UV_RENAME != 0) .rename else .change,
        );
    }

    pub fn emit(this: *PathWatcher, path: string, hash: Watcher.HashType, timestamp: u64, is_file: bool, event_type: EventType) void {
        this.emit_in_progress = true;
        var debug_count: if (bun.Environment.isDebug) usize else u0 = 0;
        for (this.handlers.values(), 0..) |*event, i| {
            if (event.emit(hash, timestamp, event_type)) {
                const ctx: *FSWatcher = @alignCast(@ptrCast(this.handlers.keys()[i]));
                onPathUpdateFn(ctx, event_type.toEvent(switch (ctx.encoding) {
                    .utf8 => .{ .string = bun.String.createUTF8(path) },
                    else => .{ .bytes_to_free = bun.default_allocator.dupeZ(u8, path) catch bun.outOfMemory() },
                }), is_file);
                if (comptime bun.Environment.isDebug)
                    debug_count += 1;
                onUpdateEndFn(ctx);
            }
        }
        if (comptime bun.Environment.isDebug)
            log("emit({s}, {s}, {s}, at {d}) x {d}", .{
                path,
                if (is_file) "file" else "dir",
                @tagName(event_type),
                timestamp,
                debug_count,
            });

        this.emit_in_progress = false;
        this.maybeDeinit();
    }

    pub fn init(manager: *PathWatcherManager, path: [:0]const u8, recursive: bool) bun.JSC.Maybe(*PathWatcher) {
        var outbuf: bun.PathBuffer = undefined;
        const event_path = switch (bun.sys.readlink(path, &outbuf)) {
            .err => |err| brk: {
                if (err.errno == @intFromEnum(bun.sys.E.NOENT)) {
                    return .{ .err = .{
                        .errno = err.errno,
                        .syscall = .open,
                    } };
                }

                break :brk path;
            },
            .result => |event_path| event_path,
        };

        const watchers_entry = manager.watchers.getOrPut(bun.default_allocator, @as([]const u8, event_path)) catch bun.outOfMemory();
        if (watchers_entry.found_existing) {
            return .{ .result = watchers_entry.value_ptr.* };
        }

        var this = PathWatcher.new(.{
            .handle = std.mem.zeroes(uv.uv_fs_event_t),
            .manager = manager,
        });

        errdefer {
            _ = manager.watchers.swapRemove(event_path);
            this.manager = null;
            this.deinit();
        }

        if (uv.uv_fs_event_init(manager.vm.uvLoop(), &this.handle).toError(.watch)) |err| {
            return .{ .err = err };
        }
        this.handle.data = this;

        // UV_FS_EVENT_RECURSIVE only works for Windows and OSX
        if (uv.uv_fs_event_start(
            &this.handle,
            PathWatcher.uvEventCallback,
            event_path.ptr,
            if (recursive) uv.UV_FS_EVENT_RECURSIVE else 0,
        ).toError(.watch)) |err| {
            return .{ .err = err };
        }
        // we handle this in node_fs_watcher
        uv.uv_unref(@ptrCast(&this.handle));

        watchers_entry.value_ptr.* = this;
        watchers_entry.key_ptr.* = bun.default_allocator.dupeZ(u8, event_path) catch bun.outOfMemory();

        return .{ .result = this };
    }

    fn uvClosedCallback(handler: *anyopaque) callconv(.C) void {
        log("onClose", .{});
        const event = bun.cast(*uv.uv_fs_event_t, handler);
        const this = bun.cast(*PathWatcher, event.data);
        bun.destroy(this);
    }

    pub fn detach(this: *PathWatcher, handler: *anyopaque) void {
        if (this.handlers.swapRemove(handler)) {
            this.maybeDeinit();
        }
    }

    fn maybeDeinit(this: *PathWatcher) void {
        if (this.handlers.count() == 0 and !this.emit_in_progress) {
            this.deinit();
        }
    }

    fn deinit(this: *PathWatcher) void {
        log("deinit", .{});
        this.handlers.clearAndFree(bun.default_allocator);

        if (this.manager) |manager| {
            this.manager = null;
            if (this.handle.path) |path| {
                manager.unregisterWatcher(this, bun.sliceTo(path, 0));
            } else {
                manager.unregisterWatcher(this, "");
            }
        }
        if (uv.uv_is_closed(@ptrCast(&this.handle))) {
            bun.destroy(this);
        } else {
            _ = uv.uv_fs_event_stop(&this.handle);
            _ = uv.uv_close(@ptrCast(&this.handle), PathWatcher.uvClosedCallback);
        }
    }
};

pub fn watch(
    vm: *VirtualMachine,
    path: [:0]const u8,
    recursive: bool,
    comptime callback: PathWatcher.Callback,
    comptime updateEnd: PathWatcher.UpdateEndCallback,
    ctx: *anyopaque,
) bun.JSC.Maybe(*PathWatcher) {
    comptime {
        if (callback != onPathUpdateFn) {
            @compileError("callback must be onPathUpdateFn");
        }

        if (updateEnd != onUpdateEndFn) {
            @compileError("updateEnd must be onUpdateEndFn");
        }
    }

    if (!bun.Environment.isWindows) {
        @compileError("win_watcher should only be used on Windows");
    }

    const manager = default_manager orelse brk: {
        default_manager = PathWatcherManager.init(vm);
        break :brk default_manager.?;
    };
    var watcher = switch (PathWatcher.init(manager, path, recursive)) {
        .err => |err| return .{ .err = err },
        .result => |watcher| watcher,
    };
    watcher.handlers.put(bun.default_allocator, ctx, .{}) catch bun.outOfMemory();
    return .{ .result = watcher };
}
