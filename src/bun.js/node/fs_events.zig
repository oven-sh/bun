const std = @import("std");
const bun = @import("bun");
const Mutex = bun.Mutex;
const sync = @import("../../sync.zig");
const Semaphore = sync.Semaphore;
const UnboundedQueue = @import("../unbounded_queue.zig").UnboundedQueue;
const string = bun.string;

const PathWatcher = @import("./path_watcher.zig").PathWatcher;
const EventType = PathWatcher.EventType;
const Event = bun.JSC.Node.fs.Watcher.Event;

pub const CFAbsoluteTime = f64;
pub const CFTimeInterval = f64;
pub const CFArrayCallBacks = anyopaque;

pub const FSEventStreamEventFlags = c_int;
pub const OSStatus = c_int;
pub const CFIndex = c_long;

pub const FSEventStreamCreateFlags = u32;
pub const FSEventStreamEventId = u64;

pub const CFStringEncoding = c_uint;

pub const CFArrayRef = ?*anyopaque;
pub const CFAllocatorRef = ?*anyopaque;
pub const CFBundleRef = ?*anyopaque;
pub const CFDictionaryRef = ?*anyopaque;
pub const CFRunLoopRef = ?*anyopaque;
pub const CFRunLoopSourceRef = ?*anyopaque;
pub const CFStringRef = ?*anyopaque;
pub const CFTypeRef = ?*anyopaque;
pub const FSEventStreamRef = ?*anyopaque;
pub const FSEventStreamCallback = *const fn (FSEventStreamRef, ?*anyopaque, usize, ?*anyopaque, *FSEventStreamEventFlags, *FSEventStreamEventId) callconv(.C) void;

// we only care about info and perform
pub const CFRunLoopSourceContext = extern struct {
    version: CFIndex = 0,
    info: *anyopaque,
    retain: ?*anyopaque = null,
    release: ?*anyopaque = null,
    copyDescription: ?*anyopaque = null,
    equal: ?*anyopaque = null,
    hash: ?*anyopaque = null,
    schedule: ?*anyopaque = null,
    cancel: ?*anyopaque = null,
    perform: *const fn (?*anyopaque) callconv(.C) void,
};

pub const FSEventStreamContext = extern struct {
    version: CFIndex = 0,
    info: ?*anyopaque = null,
    pad: [3]?*anyopaque = .{ null, null, null },
};

pub const kCFStringEncodingUTF8: CFStringEncoding = 0x8000100;
pub const noErr: OSStatus = 0;

pub const kFSEventStreamCreateFlagNoDefer: c_int = 2;
pub const kFSEventStreamCreateFlagFileEvents: c_int = 16;

pub const kFSEventStreamEventFlagEventIdsWrapped: c_int = 8;
pub const kFSEventStreamEventFlagHistoryDone: c_int = 16;
pub const kFSEventStreamEventFlagItemChangeOwner: c_int = 0x4000;
pub const kFSEventStreamEventFlagItemCreated: c_int = 0x100;
pub const kFSEventStreamEventFlagItemFinderInfoMod: c_int = 0x2000;
pub const kFSEventStreamEventFlagItemInodeMetaMod: c_int = 0x400;
pub const kFSEventStreamEventFlagItemIsDir: c_int = 0x20000;
pub const kFSEventStreamEventFlagItemModified: c_int = 0x1000;
pub const kFSEventStreamEventFlagItemRemoved: c_int = 0x200;
pub const kFSEventStreamEventFlagItemRenamed: c_int = 0x800;
pub const kFSEventStreamEventFlagItemXattrMod: c_int = 0x8000;
pub const kFSEventStreamEventFlagKernelDropped: c_int = 4;
pub const kFSEventStreamEventFlagMount: c_int = 64;
pub const kFSEventStreamEventFlagRootChanged: c_int = 32;
pub const kFSEventStreamEventFlagUnmount: c_int = 128;
pub const kFSEventStreamEventFlagUserDropped: c_int = 2;

pub const kFSEventsModified: c_int =
    kFSEventStreamEventFlagItemChangeOwner |
    kFSEventStreamEventFlagItemFinderInfoMod |
    kFSEventStreamEventFlagItemInodeMetaMod |
    kFSEventStreamEventFlagItemModified |
    kFSEventStreamEventFlagItemXattrMod;

pub const kFSEventsRenamed: c_int =
    kFSEventStreamEventFlagItemCreated |
    kFSEventStreamEventFlagItemRemoved |
    kFSEventStreamEventFlagItemRenamed;

pub const kFSEventsSystem: c_int =
    kFSEventStreamEventFlagUserDropped |
    kFSEventStreamEventFlagKernelDropped |
    kFSEventStreamEventFlagEventIdsWrapped |
    kFSEventStreamEventFlagHistoryDone |
    kFSEventStreamEventFlagMount |
    kFSEventStreamEventFlagUnmount |
    kFSEventStreamEventFlagRootChanged;

var fsevents_mutex: Mutex = .{};
var fsevents_default_loop_mutex: Mutex = .{};
var fsevents_default_loop: ?*FSEventsLoop = null;

fn dlsym(handle: ?*anyopaque, comptime Type: type, comptime symbol: [:0]const u8) ?Type {
    if (std.c.dlsym(handle, symbol)) |ptr| {
        return bun.cast(Type, ptr);
    }
    return null;
}

pub const CoreFoundation = struct {
    handle: ?*anyopaque,
    ArrayCreate: *fn (CFAllocatorRef, [*]?*anyopaque, CFIndex, ?*CFArrayCallBacks) callconv(.C) CFArrayRef,
    Release: *fn (CFTypeRef) callconv(.C) void,

    RunLoopAddSource: *fn (CFRunLoopRef, CFRunLoopSourceRef, CFStringRef) callconv(.C) void,
    RunLoopGetCurrent: *fn () callconv(.C) CFRunLoopRef,
    RunLoopRemoveSource: *fn (CFRunLoopRef, CFRunLoopSourceRef, CFStringRef) callconv(.C) void,
    RunLoopRun: *fn () callconv(.C) void,
    RunLoopSourceCreate: *fn (CFAllocatorRef, CFIndex, *CFRunLoopSourceContext) callconv(.C) CFRunLoopSourceRef,
    RunLoopSourceSignal: *fn (CFRunLoopSourceRef) callconv(.C) void,
    RunLoopStop: *fn (CFRunLoopRef) callconv(.C) void,
    RunLoopWakeUp: *fn (CFRunLoopRef) callconv(.C) void,
    StringCreateWithFileSystemRepresentation: *fn (CFAllocatorRef, [*]const u8) callconv(.C) CFStringRef,
    RunLoopDefaultMode: *CFStringRef,

    pub fn get() CoreFoundation {
        if (fsevents_cf) |cf| return cf;
        fsevents_mutex.lock();
        defer fsevents_mutex.unlock();
        if (fsevents_cf) |cf| return cf;

        InitLibrary();

        return fsevents_cf.?;
    }

    // We Actually never deinit it
    // pub fn deinit(this: *CoreFoundation) void {
    //     if(this.handle) | ptr| {
    //         this.handle = null;
    //         _  = std.c.dlclose(this.handle);
    //     }
    // }

};

pub const CoreServices = struct {
    handle: ?*anyopaque,
    FSEventStreamCreate: *fn (CFAllocatorRef, FSEventStreamCallback, *FSEventStreamContext, CFArrayRef, FSEventStreamEventId, CFTimeInterval, FSEventStreamCreateFlags) callconv(.C) FSEventStreamRef,
    FSEventStreamInvalidate: *fn (FSEventStreamRef) callconv(.C) void,
    FSEventStreamRelease: *fn (FSEventStreamRef) callconv(.C) void,
    FSEventStreamScheduleWithRunLoop: *fn (FSEventStreamRef, CFRunLoopRef, CFStringRef) callconv(.C) void,
    FSEventStreamStart: *fn (FSEventStreamRef) callconv(.C) c_int,
    FSEventStreamStop: *fn (FSEventStreamRef) callconv(.C) void,
    // libuv set it to -1 so the actual value is this
    kFSEventStreamEventIdSinceNow: FSEventStreamEventId = 18446744073709551615,

    pub fn get() CoreServices {
        if (fsevents_cs) |cs| return cs;
        fsevents_mutex.lock();
        defer fsevents_mutex.unlock();
        if (fsevents_cs) |cs| return cs;

        InitLibrary();

        return fsevents_cs.?;
    }

    // We Actually never deinit it
    // pub fn deinit(this: *CoreServices) void {
    //     if(this.handle) | ptr| {
    //         this.handle = null;
    //         _  = std.c.dlclose(this.handle);
    //     }
    // }

};

var fsevents_cf: ?CoreFoundation = null;
var fsevents_cs: ?CoreServices = null;

fn InitLibrary() void {
    const fsevents_cf_handle = bun.sys.dlopen("/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation", .{ .LAZY = true, .LOCAL = true });
    if (fsevents_cf_handle == null) @panic("Cannot Load CoreFoundation");

    fsevents_cf = CoreFoundation{
        .handle = fsevents_cf_handle,
        .ArrayCreate = dlsym(fsevents_cf_handle, *fn (CFAllocatorRef, [*]?*anyopaque, CFIndex, ?*CFArrayCallBacks) callconv(.C) CFArrayRef, "CFArrayCreate") orelse @panic("Cannot Load CoreFoundation"),
        .Release = dlsym(fsevents_cf_handle, *fn (CFTypeRef) callconv(.C) void, "CFRelease") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopAddSource = dlsym(fsevents_cf_handle, *fn (CFRunLoopRef, CFRunLoopSourceRef, CFStringRef) callconv(.C) void, "CFRunLoopAddSource") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopGetCurrent = dlsym(fsevents_cf_handle, *fn () callconv(.C) CFRunLoopRef, "CFRunLoopGetCurrent") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopRemoveSource = dlsym(fsevents_cf_handle, *fn (CFRunLoopRef, CFRunLoopSourceRef, CFStringRef) callconv(.C) void, "CFRunLoopRemoveSource") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopRun = dlsym(fsevents_cf_handle, *fn () callconv(.C) void, "CFRunLoopRun") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopSourceCreate = dlsym(fsevents_cf_handle, *fn (CFAllocatorRef, CFIndex, *CFRunLoopSourceContext) callconv(.C) CFRunLoopSourceRef, "CFRunLoopSourceCreate") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopSourceSignal = dlsym(fsevents_cf_handle, *fn (CFRunLoopSourceRef) callconv(.C) void, "CFRunLoopSourceSignal") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopStop = dlsym(fsevents_cf_handle, *fn (CFRunLoopRef) callconv(.C) void, "CFRunLoopStop") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopWakeUp = dlsym(fsevents_cf_handle, *fn (CFRunLoopRef) callconv(.C) void, "CFRunLoopWakeUp") orelse @panic("Cannot Load CoreFoundation"),
        .StringCreateWithFileSystemRepresentation = dlsym(fsevents_cf_handle, *fn (CFAllocatorRef, [*]const u8) callconv(.C) CFStringRef, "CFStringCreateWithFileSystemRepresentation") orelse @panic("Cannot Load CoreFoundation"),
        .RunLoopDefaultMode = dlsym(fsevents_cf_handle, *CFStringRef, "kCFRunLoopDefaultMode") orelse @panic("Cannot Load CoreFoundation"),
    };

    const fsevents_cs_handle = bun.sys.dlopen("/System/Library/Frameworks/CoreServices.framework/Versions/A/CoreServices", .{ .LAZY = true, .LOCAL = true });
    if (fsevents_cs_handle == null) @panic("Cannot Load CoreServices");

    fsevents_cs = CoreServices{
        .handle = fsevents_cs_handle,
        .FSEventStreamCreate = dlsym(fsevents_cs_handle, *fn (CFAllocatorRef, FSEventStreamCallback, *FSEventStreamContext, CFArrayRef, FSEventStreamEventId, CFTimeInterval, FSEventStreamCreateFlags) callconv(.C) FSEventStreamRef, "FSEventStreamCreate") orelse @panic("Cannot Load CoreServices"),
        .FSEventStreamInvalidate = dlsym(fsevents_cs_handle, *fn (FSEventStreamRef) callconv(.C) void, "FSEventStreamInvalidate") orelse @panic("Cannot Load CoreServices"),
        .FSEventStreamRelease = dlsym(fsevents_cs_handle, *fn (FSEventStreamRef) callconv(.C) void, "FSEventStreamRelease") orelse @panic("Cannot Load CoreServices"),
        .FSEventStreamScheduleWithRunLoop = dlsym(fsevents_cs_handle, *fn (FSEventStreamRef, CFRunLoopRef, CFStringRef) callconv(.C) void, "FSEventStreamScheduleWithRunLoop") orelse @panic("Cannot Load CoreServices"),
        .FSEventStreamStart = dlsym(fsevents_cs_handle, *fn (FSEventStreamRef) callconv(.C) c_int, "FSEventStreamStart") orelse @panic("Cannot Load CoreServices"),
        .FSEventStreamStop = dlsym(fsevents_cs_handle, *fn (FSEventStreamRef) callconv(.C) void, "FSEventStreamStop") orelse @panic("Cannot Load CoreServices"),
    };
}

pub const FSEventsLoop = struct {
    signal_source: CFRunLoopSourceRef,
    mutex: Mutex,
    loop: CFRunLoopRef = null,
    sem: Semaphore,
    thread: std.Thread = undefined,
    tasks: ConcurrentTask.Queue = ConcurrentTask.Queue{},
    watchers: bun.BabyList(?*FSEventsWatcher) = .{},
    watcher_count: u32 = 0,
    fsevent_stream: FSEventStreamRef = null,
    paths: ?[]?*anyopaque = null,
    cf_paths: CFArrayRef = null,
    has_scheduled_watchers: bool = false,

    pub const Task = struct {
        ctx: ?*anyopaque,
        callback: *const (fn (*anyopaque) void),

        pub fn run(this: *Task) void {
            const callback = this.callback;
            const ctx = this.ctx;
            callback(ctx.?);
        }

        pub fn New(comptime Type: type, comptime Callback: anytype) type {
            return struct {
                pub fn init(ctx: *Type) Task {
                    return Task{
                        .callback = wrap,
                        .ctx = ctx,
                    };
                }

                pub fn wrap(this: ?*anyopaque) void {
                    @call(bun.callmod_inline, Callback, .{@as(*Type, @ptrCast(@alignCast(this.?)))});
                }
            };
        }
    };

    pub const ConcurrentTask = struct {
        task: Task = undefined,
        next: ?*ConcurrentTask = null,
        auto_delete: bool = false,

        pub const Queue = UnboundedQueue(ConcurrentTask, .next);

        pub fn from(this: *ConcurrentTask, task: Task, auto_delete: bool) *ConcurrentTask {
            this.* = .{
                .task = task,
                .next = null,
                .auto_delete = auto_delete,
            };
            return this;
        }
    };

    pub fn CFThreadLoop(this: *FSEventsLoop) void {
        bun.Output.Source.configureNamedThread("CFThreadLoop");

        const CF = CoreFoundation.get();

        this.loop = CF.RunLoopGetCurrent();

        CF.RunLoopAddSource(this.loop, this.signal_source, CF.RunLoopDefaultMode.*);

        this.sem.post();

        CF.RunLoopRun();
        CF.RunLoopRemoveSource(this.loop, this.signal_source, CF.RunLoopDefaultMode.*);

        this.loop = null;
    }

    // Runs in CF thread, executed after `enqueueTaskConcurrent()`
    fn CFLoopCallback(arg: ?*anyopaque) callconv(.C) void {
        if (arg) |self| {
            const this = bun.cast(*FSEventsLoop, self);

            var concurrent = this.tasks.popBatch();
            const count = concurrent.count;
            if (count == 0)
                return;

            var iter = concurrent.iterator();
            while (iter.next()) |task| {
                task.task.run();
                if (task.auto_delete) bun.default_allocator.destroy(task);
            }
        }
    }

    pub fn init() !*FSEventsLoop {
        const this = bun.default_allocator.create(FSEventsLoop) catch unreachable;

        const CF = CoreFoundation.get();

        var ctx = CFRunLoopSourceContext{
            .info = this,
            .perform = CFLoopCallback,
        };

        const signal_source = CF.RunLoopSourceCreate(null, 0, &ctx);
        if (signal_source == null) {
            return error.FailedToCreateCoreFoudationSourceLoop;
        }

        const fs_loop = FSEventsLoop{ .sem = Semaphore.init(0), .mutex = .{}, .signal_source = signal_source };

        this.* = fs_loop;
        this.thread = try std.Thread.spawn(.{}, FSEventsLoop.CFThreadLoop, .{this});

        // sync threads
        this.sem.wait();
        return this;
    }

    fn enqueueTaskConcurrent(this: *FSEventsLoop, task: Task) void {
        const CF = CoreFoundation.get();
        var concurrent = bun.default_allocator.create(ConcurrentTask) catch unreachable;
        this.tasks.push(concurrent.from(task, true));
        CF.RunLoopSourceSignal(this.signal_source);
        CF.RunLoopWakeUp(this.loop);
    }

    // Runs in CF thread, when there're events in FSEventStream
    fn _events_cb(_: FSEventStreamRef, info: ?*anyopaque, numEvents: usize, eventPaths: ?*anyopaque, eventFlags: *FSEventStreamEventFlags, _: *FSEventStreamEventId) callconv(.C) void {
        const paths_ptr = bun.cast([*][*:0]const u8, eventPaths);
        const paths = paths_ptr[0..numEvents];
        var loop = bun.cast(*FSEventsLoop, info);
        const event_flags = bun.cast([*]FSEventStreamEventFlags, eventFlags);

        for (loop.watchers.slice()) |watcher| {
            if (watcher) |handle| {
                const handle_path = handle.path;

                for (paths, 0..) |path_ptr, i| {
                    var flags = event_flags[i];
                    var path = path_ptr[0..bun.len(path_ptr)];
                    // Filter out paths that are outside handle's request
                    if (path.len < handle_path.len or !bun.strings.startsWith(path, handle_path)) {
                        continue;
                    }
                    const is_file = (flags & kFSEventStreamEventFlagItemIsDir) == 0;

                    // Remove common prefix, unless the watched folder is "/"
                    if (!(handle_path.len == 1 and handle_path[0] == '/')) {
                        path = path[handle_path.len..];

                        // Ignore events with path equal to directory itself
                        if (path.len <= 1 and !is_file) {
                            continue;
                        }

                        if (path.len == 0) {
                            // Since we're using fsevents to watch the file itself handle_path == path, and we now need to get the basename of the file back
                            const basename = bun.strings.lastIndexOfChar(handle_path, '/') orelse handle_path.len;
                            path = handle_path[basename..];
                            // Created and Removed seem to be always set, but don't make sense
                            flags &= ~kFSEventsRenamed;
                        }

                        if (bun.strings.startsWithChar(path, '/')) {
                            // Skip forward slash
                            path = path[1..];
                        }
                    }

                    // Do not emit events from subdirectories (without option set)
                    if (path.len == 0 or (bun.strings.containsChar(path, '/') and !handle.recursive)) {
                        continue;
                    }

                    var is_rename = true;

                    if ((flags & kFSEventsRenamed) == 0) {
                        if ((flags & kFSEventsModified) != 0 or is_file) {
                            is_rename = false;
                        }
                    }

                    const event_type: EventType = if (is_rename) .rename else .change;
                    handle.emit(event_type.toEvent(path), is_file);
                }
                handle.flush();
            }
        }
    }

    // Runs on CF Thread
    pub fn _schedule(this: *FSEventsLoop) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        this.has_scheduled_watchers = false;
        const watcher_count = this.watcher_count;

        const watchers = this.watchers.slice();

        const CF = CoreFoundation.get();
        const CS = CoreServices.get();

        if (this.fsevent_stream) |stream| {
            // Stop emitting events
            CS.FSEventStreamStop(stream);

            // Release stream
            CS.FSEventStreamInvalidate(stream);
            CS.FSEventStreamRelease(stream);
            this.fsevent_stream = null;
        }
        // clean old paths
        if (this.paths) |p| {
            this.paths = null;
            bun.default_allocator.free(p);
        }
        if (this.cf_paths) |cf| {
            this.cf_paths = null;
            CF.Release(cf);
        }

        if (watcher_count == 0) {
            return;
        }

        const paths = bun.default_allocator.alloc(?*anyopaque, watcher_count) catch unreachable;
        var count: u32 = 0;
        for (watchers) |w| {
            if (w) |watcher| {
                const path = CF.StringCreateWithFileSystemRepresentation(null, watcher.path.ptr);
                paths[count] = path;
                count += 1;
            }
        }

        const cf_paths = CF.ArrayCreate(null, paths.ptr, count, null);
        var ctx: FSEventStreamContext = .{
            .info = this,
        };

        const latency: CFAbsoluteTime = 0.05;
        // Explanation of selected flags:
        // 1. NoDefer - without this flag, events that are happening continuously
        //    (i.e. each event is happening after time interval less than `latency`,
        //    counted from previous event), will be deferred and passed to callback
        //    once they'll either fill whole OS buffer, or when this continuous stream
        //    will stop (i.e. there'll be delay between events, bigger than
        //    `latency`).
        //    Specifying this flag will invoke callback after `latency` time passed
        //    since event.
        // 2. FileEvents - fire callback for file changes too (by default it is firing
        //    it only for directory changes).
        //
        const flags: FSEventStreamCreateFlags = kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagFileEvents;

        //
        // NOTE: It might sound like a good idea to remember last seen StreamEventId,
        // but in reality one dir might have last StreamEventId less than, the other,
        // that is being watched now. Which will cause FSEventStream API to report
        // changes to files from the past.
        //
        const ref = CS.FSEventStreamCreate(null, _events_cb, &ctx, cf_paths, CS.kFSEventStreamEventIdSinceNow, latency, flags);

        CS.FSEventStreamScheduleWithRunLoop(ref, this.loop, CF.RunLoopDefaultMode.*);
        if (CS.FSEventStreamStart(ref) == 0) {
            //clean in case of failure
            bun.default_allocator.free(paths);
            CF.Release(cf_paths);
            CS.FSEventStreamInvalidate(ref);
            CS.FSEventStreamRelease(ref);
            return;
        }
        this.fsevent_stream = ref;
        this.paths = paths;
        this.cf_paths = cf_paths;
    }

    fn registerWatcher(this: *FSEventsLoop, watcher: *FSEventsWatcher) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        if (this.watcher_count == this.watchers.len) {
            this.watcher_count += 1;
            this.watchers.push(bun.default_allocator, watcher) catch unreachable;
        } else {
            var watchers = this.watchers.slice();
            for (watchers, 0..) |w, i| {
                if (w == null) {
                    watchers[i] = watcher;
                    this.watcher_count += 1;
                    break;
                }
            }
        }

        if (this.has_scheduled_watchers == false) {
            this.has_scheduled_watchers = true;
            this.enqueueTaskConcurrent(Task.New(FSEventsLoop, _schedule).init(this));
        }
    }

    fn unregisterWatcher(this: *FSEventsLoop, watcher: *FSEventsWatcher) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        var watchers = this.watchers.slice();
        for (watchers, 0..) |w, i| {
            if (w) |item| {
                if (item == watcher) {
                    watchers[i] = null;
                    // if is the last one just pop
                    if (i == watchers.len - 1) {
                        this.watchers.len -= 1;
                    }
                    this.watcher_count -= 1;
                    break;
                }
            }
        }
    }

    // Runs on CF loop to close the loop
    fn _stop(this: *FSEventsLoop) void {
        const CF = CoreFoundation.get();
        CF.RunLoopStop(this.loop);
    }
    fn deinit(this: *FSEventsLoop) void {
        // signal close and wait
        this.enqueueTaskConcurrent(Task.New(FSEventsLoop, FSEventsLoop._stop).init(this));
        this.thread.join();
        const CF = CoreFoundation.get();

        CF.Release(this.signal_source);
        this.signal_source = null;

        this.sem.deinit();

        if (this.watcher_count > 0) {
            while (this.watchers.pop()) |watcher| {
                if (watcher) |w| {
                    // unlink watcher
                    w.loop = null;
                }
            }
        }

        this.watchers.deinitWithAllocator(bun.default_allocator);

        bun.default_allocator.destroy(this);
    }
};

pub const FSEventsWatcher = struct {
    path: string,
    callback: Callback,
    flushCallback: UpdateEndCallback,
    loop: ?*FSEventsLoop,
    recursive: bool,
    ctx: ?*anyopaque,

    pub const Callback = PathWatcher.Callback;
    pub const UpdateEndCallback = *const fn (ctx: ?*anyopaque) void;

    pub fn init(loop: *FSEventsLoop, path: string, recursive: bool, callback: Callback, updateEnd: UpdateEndCallback, ctx: ?*anyopaque) *FSEventsWatcher {
        const this = bun.default_allocator.create(FSEventsWatcher) catch unreachable;

        this.* = FSEventsWatcher{
            .path = path,
            .callback = callback,
            .flushCallback = updateEnd,
            .loop = loop,
            .recursive = recursive,
            .ctx = ctx,
        };

        loop.registerWatcher(this);
        return this;
    }

    pub fn emit(this: *FSEventsWatcher, event: Event, is_file: bool) void {
        this.callback(this.ctx, event, is_file);
    }

    pub fn flush(this: *FSEventsWatcher) void {
        this.flushCallback(this.ctx);
    }

    pub fn deinit(this: *FSEventsWatcher) void {
        if (this.loop) |loop| {
            loop.unregisterWatcher(this);
        }
        bun.default_allocator.destroy(this);
    }
};

pub fn watch(path: string, recursive: bool, callback: FSEventsWatcher.Callback, updateEnd: FSEventsWatcher.UpdateEndCallback, ctx: ?*anyopaque) !*FSEventsWatcher {
    if (fsevents_default_loop) |loop| {
        return FSEventsWatcher.init(loop, path, recursive, callback, updateEnd, ctx);
    } else {
        fsevents_default_loop_mutex.lock();
        defer fsevents_default_loop_mutex.unlock();
        if (fsevents_default_loop == null) {
            fsevents_default_loop = try FSEventsLoop.init();
        }
        return FSEventsWatcher.init(fsevents_default_loop.?, path, recursive, callback, updateEnd, ctx);
    }
}

pub fn closeAndWait() void {
    if (!bun.Environment.isMac) {
        return;
    }

    if (fsevents_default_loop) |loop| {
        fsevents_default_loop_mutex.lock();
        defer fsevents_default_loop_mutex.unlock();
        loop.deinit();
        fsevents_default_loop = null;
    }
}
