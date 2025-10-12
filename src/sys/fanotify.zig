const std = @import("std");
const bun = @import("../bun.zig");
const Maybe = bun.sys.Maybe;
const linux = std.os.linux;
const posix = std.posix;

/// fanotify_init flags
pub const InitFlags = packed struct(u32) {
    /// Close-on-exec flag
    cloexec: bool = false,
    /// Non-blocking flag
    nonblock: bool = false,
    _padding1: u30 = 0,

    pub fn toInt(self: InitFlags) u32 {
        var flags: u32 = 0;
        if (self.cloexec) flags |= FAN_CLOEXEC;
        if (self.nonblock) flags |= FAN_NONBLOCK;
        return flags | FAN_CLASS_NOTIF | FAN_UNLIMITED_QUEUE | FAN_UNLIMITED_MARKS;
    }
};

/// fanotify event flags (open flags for the file descriptors)
pub const EventFlags = packed struct(u32) {
    rdonly: bool = false,
    largefile: bool = false,
    cloexec: bool = false,
    _padding: u29 = 0,

    pub fn toInt(self: EventFlags) u32 {
        var flags: u32 = 0;
        // RDONLY is 0, so we don't need to add it
        if (self.rdonly) flags |= 0;
        if (self.largefile) flags |= 0x8000; // O_LARGEFILE on linux
        if (self.cloexec) flags |= 0x80000; // O_CLOEXEC on linux
        return flags;
    }
};

/// fanotify_mark flags
pub const MarkFlags = enum(u32) {
    add = FAN_MARK_ADD,
    remove = FAN_MARK_REMOVE,
    flush = FAN_MARK_FLUSH,
};

/// fanotify event mask
pub const EventMask = packed struct(u64) {
    access: bool = false,
    modify: bool = false,
    close_write: bool = false,
    close_nowrite: bool = false,
    open: bool = false,
    open_exec: bool = false,
    attrib: bool = false,
    create: bool = false,
    delete: bool = false,
    delete_self: bool = false,
    moved_from: bool = false,
    moved_to: bool = false,
    move_self: bool = false,
    open_perm: bool = false,
    access_perm: bool = false,
    open_exec_perm: bool = false,
    _padding1: u14 = 0,
    ondir: bool = false,
    event_on_child: bool = false,
    _padding2: u32 = 0,

    pub fn toInt(self: EventMask) u64 {
        var mask: u64 = 0;
        if (self.access) mask |= FAN_ACCESS;
        if (self.modify) mask |= FAN_MODIFY;
        if (self.close_write) mask |= FAN_CLOSE_WRITE;
        if (self.close_nowrite) mask |= FAN_CLOSE_NOWRITE;
        if (self.open) mask |= FAN_OPEN;
        if (self.open_exec) mask |= FAN_OPEN_EXEC;
        if (self.attrib) mask |= FAN_ATTRIB;
        if (self.create) mask |= FAN_CREATE;
        if (self.delete) mask |= FAN_DELETE;
        if (self.delete_self) mask |= FAN_DELETE_SELF;
        if (self.moved_from) mask |= FAN_MOVED_FROM;
        if (self.moved_to) mask |= FAN_MOVED_TO;
        if (self.move_self) mask |= FAN_MOVE_SELF;
        if (self.open_perm) mask |= FAN_OPEN_PERM;
        if (self.access_perm) mask |= FAN_ACCESS_PERM;
        if (self.open_exec_perm) mask |= FAN_OPEN_EXEC_PERM;
        if (self.ondir) mask |= FAN_ONDIR;
        if (self.event_on_child) mask |= FAN_EVENT_ON_CHILD;
        return mask;
    }
};

// fanotify_init flags
const FAN_CLOEXEC = 0x00000001;
const FAN_NONBLOCK = 0x00000002;
const FAN_CLASS_NOTIF = 0x00000000;
const FAN_UNLIMITED_QUEUE = 0x00000010;
const FAN_UNLIMITED_MARKS = 0x00000020;

// fanotify_mark flags
const FAN_MARK_ADD = 0x00000001;
const FAN_MARK_REMOVE = 0x00000002;
const FAN_MARK_FLUSH = 0x00000080;

// fanotify events
const FAN_ACCESS = 0x00000001;
const FAN_MODIFY = 0x00000002;
const FAN_CLOSE_WRITE = 0x00000008;
const FAN_CLOSE_NOWRITE = 0x00000010;
const FAN_OPEN = 0x00000020;
const FAN_OPEN_EXEC = 0x00001000;
const FAN_ATTRIB = 0x00000004;
const FAN_CREATE = 0x00000100;
const FAN_DELETE = 0x00000200;
const FAN_DELETE_SELF = 0x00000400;
const FAN_MOVED_FROM = 0x00000040;
const FAN_MOVED_TO = 0x00000080;
const FAN_MOVE_SELF = 0x00000800;
const FAN_OPEN_PERM = 0x00010000;
const FAN_ACCESS_PERM = 0x00020000;
const FAN_OPEN_EXEC_PERM = 0x00040000;
const FAN_ONDIR = 0x40000000;
const FAN_EVENT_ON_CHILD = 0x08000000;

/// fanotify event metadata structure
pub const EventMetadata = extern struct {
    event_len: u32,
    vers: u8,
    reserved: u8,
    metadata_len: u16,
    mask: u64,
    fd: i32,
    pid: i32,

    pub fn size(self: *align(1) const EventMetadata) u32 {
        return self.event_len;
    }

    pub fn isDir(self: *align(1) const EventMetadata) bool {
        return (self.mask & FAN_ONDIR) != 0;
    }

    pub fn hasValidFd(self: *align(1) const EventMetadata) bool {
        return self.fd >= 0;
    }
};

/// Initialize fanotify
pub fn init(flags: InitFlags, event_flags: EventFlags) Maybe(bun.FileDescriptor) {
    const rc = linux.syscall2(
        .fanotify_init,
        @as(usize, @intCast(flags.toInt())),
        @as(usize, @intCast(event_flags.toInt())),
    );

    const errno = posix.errno(rc);
    if (errno != .SUCCESS) {
        return .{ .err = bun.sys.Error.fromCode(errno, .open) };
    }

    return .{ .result = bun.FileDescriptor.fromNative(@intCast(rc)) };
}

/// Add or remove a mark on a filesystem object
pub fn mark(
    fanotify_fd: bun.FileDescriptor,
    flags: MarkFlags,
    mask: EventMask,
    dirfd: bun.FileDescriptor,
    pathname: ?[:0]const u8,
) Maybe(void) {
    const path_ptr = if (pathname) |p| @intFromPtr(p.ptr) else 0;
    const dfd: i32 = if (pathname == null) linux.AT.FDCWD else dirfd.cast();

    const rc = linux.syscall5(
        .fanotify_mark,
        @as(usize, @bitCast(@as(isize, fanotify_fd.cast()))),
        @as(usize, @intCast(@intFromEnum(flags))),
        @as(usize, @intCast(mask.toInt())),
        @as(usize, @bitCast(@as(isize, dfd))),
        path_ptr,
    );

    const errno = posix.errno(rc);
    if (errno != .SUCCESS) {
        return .{ .err = bun.sys.Error.fromCode(errno, .watch) };
    }

    return .{ .result = {} };
}

/// Read events from fanotify file descriptor
pub fn readEvents(
    fanotify_fd: bun.FileDescriptor,
    buffer: []align(@alignOf(EventMetadata)) u8,
) Maybe([]const u8) {
    const rc = linux.read(fanotify_fd.cast(), buffer.ptr, buffer.len);

    const errno = posix.errno(rc);
    if (errno != .SUCCESS) {
        return .{ .err = bun.sys.Error.fromCode(errno, .read) };
    }

    return .{ .result = buffer[0..@intCast(rc)] };
}

/// Iterator for fanotify events
pub const EventIterator = struct {
    buffer: []const u8,
    offset: usize = 0,

    pub fn next(self: *EventIterator) ?*align(1) const EventMetadata {
        if (self.offset >= self.buffer.len) return null;

        const event: *align(1) const EventMetadata = @ptrCast(@alignCast(self.buffer[self.offset..][0..@sizeOf(EventMetadata)].ptr));

        self.offset += event.size();
        return event;
    }

    pub fn reset(self: *EventIterator) void {
        self.offset = 0;
    }
};
