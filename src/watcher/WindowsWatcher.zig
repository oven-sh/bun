//! Bun's filesystem watcher implementation for windows using kernel32
const WindowsWatcher = @This();

mutex: Mutex = .{},
iocp: w.HANDLE = undefined,
watcher: DirWatcher = undefined,
buf: bun.PathBuffer = undefined,
base_idx: usize = 0,

pub const EventListIndex = c_int;

const Error = error{
    IocpFailed,
    ReadDirectoryChangesFailed,
    CreateFileFailed,
    InvalidPath,
};

const Action = enum(w.DWORD) {
    Added = w.FILE_ACTION_ADDED,
    Removed = w.FILE_ACTION_REMOVED,
    Modified = w.FILE_ACTION_MODIFIED,
    RenamedOld = w.FILE_ACTION_RENAMED_OLD_NAME,
    RenamedNew = w.FILE_ACTION_RENAMED_NEW_NAME,
};

const FileEvent = struct {
    action: Action,
    filename: []u16 = undefined,
};

const DirWatcher = struct {
    // must be initialized to zero (even though it's never read or written in our code),
    // otherwise ReadDirectoryChangesW will fail with INVALID_HANDLE
    overlapped: w.OVERLAPPED = std.mem.zeroes(w.OVERLAPPED),
    buf: [64 * 1024]u8 align(@alignOf(w.FILE_NOTIFY_INFORMATION)) = undefined,
    dirHandle: w.HANDLE,

    // invalidates any EventIterators
    fn prepare(this: *DirWatcher) bun.JSC.Maybe(void) {
        const filter = w.FILE_NOTIFY_CHANGE_FILE_NAME | w.FILE_NOTIFY_CHANGE_DIR_NAME | w.FILE_NOTIFY_CHANGE_LAST_WRITE | w.FILE_NOTIFY_CHANGE_CREATION;
        if (w.kernel32.ReadDirectoryChangesW(this.dirHandle, &this.buf, this.buf.len, 1, filter, null, &this.overlapped, null) == 0) {
            const err = w.kernel32.GetLastError();
            log("failed to start watching directory: {s}", .{@tagName(err)});
            return .{ .err = .{
                .errno = @intFromEnum(bun.C.SystemErrno.init(err) orelse bun.C.SystemErrno.EINVAL),
                .syscall = .watch,
            } };
        }
        log("read directory changes!", .{});
        return .{ .result = {} };
    }
};

const EventIterator = struct {
    watcher: *DirWatcher,
    offset: usize = 0,
    hasNext: bool = true,

    pub fn next(this: *EventIterator) ?FileEvent {
        if (!this.hasNext) return null;
        const info_size = @sizeOf(w.FILE_NOTIFY_INFORMATION);
        const info: *w.FILE_NOTIFY_INFORMATION = @alignCast(@ptrCast(this.watcher.buf[this.offset..].ptr));
        const name_ptr: [*]u16 = @alignCast(@ptrCast(this.watcher.buf[this.offset + info_size ..]));
        const filename: []u16 = name_ptr[0 .. info.FileNameLength / @sizeOf(u16)];

        const action: Action = @enumFromInt(info.Action);

        if (info.NextEntryOffset == 0) {
            this.hasNext = false;
        } else {
            this.offset += @as(usize, info.NextEntryOffset);
        }

        return FileEvent{
            .action = action,
            .filename = filename,
        };
    }
};

pub fn init(this: *WindowsWatcher, root: []const u8) !void {
    var pathbuf: bun.WPathBuffer = undefined;
    const wpath = bun.strings.toNTPath(&pathbuf, root);
    const path_len_bytes: u16 = @truncate(wpath.len * 2);
    var nt_name = w.UNICODE_STRING{
        .Length = path_len_bytes,
        .MaximumLength = path_len_bytes,
        .Buffer = @constCast(wpath.ptr),
    };
    var attr = w.OBJECT_ATTRIBUTES{
        .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
        .RootDirectory = null,
        .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        .ObjectName = &nt_name,
        .SecurityDescriptor = null,
        .SecurityQualityOfService = null,
    };
    var handle: w.HANDLE = w.INVALID_HANDLE_VALUE;
    var io: w.IO_STATUS_BLOCK = undefined;
    const rc = w.ntdll.NtCreateFile(
        &handle,
        w.FILE_LIST_DIRECTORY,
        &attr,
        &io,
        null,
        0,
        w.FILE_SHARE_READ | w.FILE_SHARE_WRITE | w.FILE_SHARE_DELETE,
        w.FILE_OPEN,
        w.FILE_DIRECTORY_FILE | w.FILE_OPEN_FOR_BACKUP_INTENT,
        null,
        0,
    );

    if (rc != .SUCCESS) {
        const err = bun.windows.Win32Error.fromNTStatus(rc);
        log("failed to open directory for watching: {s}", .{@tagName(err)});
        return Error.CreateFileFailed;
    }
    errdefer _ = w.kernel32.CloseHandle(handle);

    this.iocp = try w.CreateIoCompletionPort(handle, null, 0, 1);
    errdefer _ = w.kernel32.CloseHandle(this.iocp);

    this.watcher = .{ .dirHandle = handle };

    @memcpy(this.buf[0..root.len], root);
    const needs_slash = root.len == 0 or !bun.strings.charIsAnySlash(root[root.len - 1]);
    if (needs_slash) {
        this.buf[root.len] = '\\';
    }
    this.base_idx = if (needs_slash) root.len + 1 else root.len;
}

const Timeout = enum(w.DWORD) {
    infinite = w.INFINITE,
    minimal = 1,
    none = 0,
};

// wait until new events are available
pub fn next(this: *WindowsWatcher, timeout: Timeout) bun.JSC.Maybe(?EventIterator) {
    switch (this.watcher.prepare()) {
        .err => |err| {
            log("prepare() returned error", .{});
            return .{ .err = err };
        },
        .result => {},
    }

    var nbytes: w.DWORD = 0;
    var key: w.ULONG_PTR = 0;
    var overlapped: ?*w.OVERLAPPED = null;
    while (true) {
        const rc = w.kernel32.GetQueuedCompletionStatus(this.iocp, &nbytes, &key, &overlapped, @intFromEnum(timeout));
        if (rc == 0) {
            const err = w.kernel32.GetLastError();
            if (err == .TIMEOUT or err == .WAIT_TIMEOUT) {
                return .{ .result = null };
            } else {
                log("GetQueuedCompletionStatus failed: {s}", .{@tagName(err)});
                return .{ .err = .{
                    .errno = @intFromEnum(bun.C.SystemErrno.init(err) orelse bun.C.SystemErrno.EINVAL),
                    .syscall = .watch,
                } };
            }
        }

        if (overlapped) |ptr| {
            // ignore possible spurious events
            if (ptr != &this.watcher.overlapped) {
                continue;
            }
            if (nbytes == 0) {
                // shutdown notification
                // TODO close handles?
                log("shutdown notification in WindowsWatcher.next", .{});
                return .{ .err = .{
                    .errno = @intFromEnum(bun.C.SystemErrno.ESHUTDOWN),
                    .syscall = .watch,
                } };
            }
            return .{ .result = EventIterator{ .watcher = &this.watcher } };
        } else {
            log("GetQueuedCompletionStatus returned no overlapped event", .{});
            return .{ .err = .{
                .errno = @truncate(@intFromEnum(bun.C.E.INVAL)),
                .syscall = .watch,
            } };
        }
    }
}

pub fn stop(this: *WindowsWatcher) void {
    w.CloseHandle(this.watcher.dirHandle);
    w.CloseHandle(this.iocp);
}

pub fn watchLoopCycle(this: *bun.Watcher) bun.JSC.Maybe(void) {
    const buf = &this.platform.buf;
    const base_idx = this.platform.base_idx;

    var event_id: usize = 0;

    // first wait has infinite timeout - we're waiting for the next event and don't want to spin
    var timeout = WindowsWatcher.Timeout.infinite;
    while (true) {
        var iter = switch (this.platform.next(timeout)) {
            .err => |err| return .{ .err = err },
            .result => |iter| iter orelse break,
        };
        // after the first wait, we want to coalesce further events but don't want to wait for them
        // NOTE: using a 1ms timeout would be ideal, but that actually makes the thread wait for at least 10ms more than it should
        // Instead we use a 0ms timeout, which may not do as much coalescing but is more responsive.
        timeout = WindowsWatcher.Timeout.none;
        const item_paths = this.watchlist.items(.file_path);
        log("number of watched items: {d}", .{item_paths.len});
        while (iter.next()) |event| {
            const convert_res = bun.strings.copyUTF16IntoUTF8(buf[base_idx..], []const u16, event.filename, false);
            const eventpath = buf[0 .. base_idx + convert_res.written];

            log("watcher update event: (filename: {s}, action: {s}", .{ eventpath, @tagName(event.action) });

            // TODO this probably needs a more sophisticated search algorithm in the future
            // Possible approaches:
            // - Keep a sorted list of the watched paths and perform a binary search. We could use a bool to keep
            //   track of whether the list is sorted and only sort it when we detect a change.
            // - Use a prefix tree. Potentially more efficient for large numbers of watched paths, but complicated
            //   to implement and maintain.
            // - others that i'm not thinking of

            for (item_paths, 0..) |path_, item_idx| {
                var path = path_;
                if (path.len > 0 and bun.strings.charIsAnySlash(path[path.len - 1])) {
                    path = path[0 .. path.len - 1];
                }
                // log("checking path: {s}\n", .{path});
                // check if the current change applies to this item
                // if so, add it to the eventlist
                const rel = bun.path.isParentOrEqual(eventpath, path);
                // skip unrelated items
                if (rel == .unrelated) continue;
                // if the event is for a parent dir of the item, only emit it if it's a delete or rename
                if (rel == .parent and (event.action != .Removed or event.action != .RenamedOld)) continue;
                this.watch_events[event_id] = createWatchEvent(event, @truncate(item_idx));
                event_id += 1;
            }
        }
    }
    if (event_id == 0) {
        return .{ .result = {} };
    }

    // log("event_id: {d}\n", .{event_id});

    var all_events = this.watch_events[0..event_id];
    std.sort.pdq(WatchEvent, all_events, {}, WatchEvent.sortByIndex);

    var last_event_index: usize = 0;
    var last_event_id: u32 = std.math.maxInt(u32);

    for (all_events, 0..) |_, i| {
        if (all_events[i].index == last_event_id) {
            all_events[last_event_index].merge(all_events[i]);
            continue;
        }
        last_event_index = i;
        last_event_id = all_events[i].index;
    }
    if (all_events.len == 0) return .{ .result = {} };
    all_events = all_events[0 .. last_event_index + 1];

    log("calling onFileUpdate (all_events.len = {d})", .{all_events.len});

    this.onFileUpdate(this.ctx, all_events, this.changed_filepaths[0 .. last_event_index + 1], this.watchlist);

    return .{ .result = {} };
}

pub fn createWatchEvent(event: FileEvent, index: WatchItemIndex) WatchEvent {
    return .{
        .op = .{
            .delete = event.action == .Removed,
            .rename = event.action == .RenamedOld,
            .write = event.action == .Modified,
        },
        .index = index,
    };
}

const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const Output = bun.Output;
const log = Output.scoped(.watcher, false);
const Futex = bun.Futex;
const Mutex = bun.Mutex;
const w = std.os.windows;

const WatchItemIndex = bun.Watcher.WatchItemIndex;
const WatchEvent = bun.Watcher.WatchEvent;
