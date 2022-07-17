const std = @import("std");
const bun = @import("global");

pub const Log = struct {
    pub fn init(_: std.mem.Allocator) Log {
        return Log{};
    }

    pub fn addErrorFmt(_: *Log, _: ?*const Source, _: Loc, _: std.mem.Allocator, comptime _: bun.string, _: anytype) !void {}
};

pub const Source = struct {};

pub const Loc = packed struct {
    pub const Empty = Loc{};
};
