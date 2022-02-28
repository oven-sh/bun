const std = @import("std");
const IO = struct {
    buffer: i32 = 0,
};

pub fn init(_: anytype, _: anytype) anyerror!void {}

pub var global: IO = undefined;
pub var global_loaded: bool = false;

fn buffer_limit(_: usize) usize {}
