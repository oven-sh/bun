const std = @import("std");
Type: type,
symbol_name: []const u8,
local_name: []const u8,

Parent: type,
pub fn Decl(comptime this: *const @This()) std.builtin.TypeInfo.Declaration {
    return comptime std.meta.declarationInfo(this.Parent, this.local_name);
}
