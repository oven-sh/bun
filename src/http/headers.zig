const Api = @import("../api/schema.zig").Api;
const std = @import("std");
const bun = @import("root").bun;
pub const Kv = struct {
    name: Api.StringPointer,
    value: Api.StringPointer,
};
pub const Entries = bun.MultiArrayList(Kv);
