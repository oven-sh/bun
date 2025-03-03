const std = @import("std");
const bun = @import("root").bun;

pub const ScriptExecutionStatus = enum(i32) {
    running = 0,
    suspended = 1,
    stopped = 2,
};
