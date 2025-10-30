const std = @import("std");

pub const Command = union(enum) {
    start: struct {
        name: []const u8,
        script: []const u8,
        cwd: []const u8,
    },
    stop: struct {
        name: []const u8,
    },
    list: void,
    logs: struct {
        name: []const u8,
        follow: bool,
    },
};

pub const Response = union(enum) {
    success: struct {
        message: []const u8,
    },
    err: struct {
        message: []const u8,
    },
    process_list: []ProcessInfo,
    log_path: struct {
        stdout: []const u8,
        stderr: []const u8,
    },
};

pub const ProcessInfo = struct {
    name: []const u8,
    pid: i32,
    script: []const u8,
    uptime: i64,
};
