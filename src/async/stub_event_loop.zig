
/// Stub implementation of an event loop
pub const Loop = struct {
    // Add any necessary fields here
    _unused: u8 = 0,

    pub fn init() Loop {
        return .{};
    }

    pub fn deinit(_: *Loop) void {}
};

/// Stub implementation of keep-alive functionality
pub const KeepAlive = struct {
    active: bool = false,

    pub fn init() KeepAlive {
        return .{};
    }

    pub fn activate(self: *KeepAlive) void {
        self.active = true;
    }

    pub fn deactivate(self: *KeepAlive) void {
        self.active = false;
    }
};

/// Stub implementation of file polling
pub const FilePoll = struct {
    fd: i32 = -1,

    pub fn init(fd: i32) FilePoll {
        return .{ .fd = fd };
    }

    pub fn close(self: *FilePoll) void {
        self.fd = -1;
    }
};
