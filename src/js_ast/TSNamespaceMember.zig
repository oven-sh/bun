//! TypeScript namespace member representation
const std = @import("std");
const bun = @import("root").bun;
const logger = bun.logger;

/// Forward declaration of TSNamespaceMemberMap
pub const Map = bun.StringArrayHashMapUnmanaged(TSNamespaceMember);

/// Represents a member of a TypeScript namespace
const TSNamespaceMember = @This();

/// Location in source code
loc: logger.Loc,

/// The type of data (property or namespace)
data: Data,

/// Type of namespace member data
pub const Data = union(enum) {
    /// "namespace ns { export let it }"
    property,

    /// "namespace ns { export namespace it {} }"
    namespace: *Map,
    /// "enum ns { it }"
    enum_number: f64,
    /// "enum ns { it = 'it' }"
    enum_string: *E.String,
    /// "enum ns { it = something() }"
    enum_property: void,

    pub fn isEnum(data: Data) bool {
        return switch (data) {
            inline else => |_, tag| comptime std.mem.startsWith(u8, @tagName(tag), "enum_"),
        };
    }
};

const E = @import("js_ast.zig").E;
