const Api = @import("../api/schema.zig").Api;
const std = @import("std");

pub const Kv = struct {
    name: Api.StringPointer,
    value: Api.StringPointer,
};
pub const Entries = std.MultiArrayList(Kv);
