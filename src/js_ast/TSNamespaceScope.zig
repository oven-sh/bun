//! TypeScript namespace scope representation
const std = @import("std");
const bun = @import("root").bun;
const Ref = @import("js_ast.zig").Ref;
const TSNamespaceMember = @import("TSNamespaceMember.zig");

/// Maps member names to namespace members
pub const TSNamespaceMemberMap = bun.StringArrayHashMapUnmanaged(TSNamespaceMember);

/// Represents a TypeScript namespace scope
const TSNamespaceScope = @This();

/// This is specific to this namespace block. It's the argument of the
/// immediately-invoked function expression that the namespace block is
/// compiled into:
///
///   var ns;
///   (function (ns2) {
///     ns2.x = 123;
///   })(ns || (ns = {}));
///
/// This variable is "ns2" in the above example. It's the symbol to use when
/// generating property accesses off of this namespace when it's in scope.
arg_ref: Ref,

/// This is shared between all sibling namespace blocks
exported_members: *TSNamespaceMemberMap,

/// This is a lazily-generated map of identifiers that actually represent
/// property accesses to this namespace's properties. For example:
///
///   namespace x {
///     export let y = 123
///   }
///   namespace x {
///     export let z = y
///   }
///
/// This should be compiled into the following code:
///
///   var x;
///   (function(x2) {
///     x2.y = 123;
///   })(x || (x = {}));
///   (function(x3) {
///     x3.z = x3.y;
///   })(x || (x = {}));
///
/// When we try to find the symbol "y", we instead return one of these lazily
/// generated proxy symbols that represent the property access "x3.y". This
/// map is unique per namespace block because "x3" is the argument symbol that
/// is specific to that particular namespace block.
property_accesses: bun.StringArrayHashMapUnmanaged(Ref) = .{},

/// Even though enums are like namespaces and both enums and namespaces allow
/// implicit references to properties of sibling scopes, they behave like
/// separate, er, namespaces. Implicit references only work namespace-to-
/// namespace and enum-to-enum. They do not work enum-to-namespace. And I'm
/// not sure what's supposed to happen for the namespace-to-enum case because
/// the compiler crashes: https://github.com/microsoft/TypeScript/issues/46891.
/// So basically these both work:
///
///   enum a { b = 1 }
///   enum a { c = b }
///
///   namespace x { export let y = 1 }
///   namespace x { export let z = y }
///
/// This doesn't work:
///
///   enum a { b = 1 }
///   namespace a { export let c = b }
///
/// And this crashes the TypeScript compiler:
///
///   namespace a { export let b = 1 }
///   enum a { c = b }
///
/// Therefore we only allow enum/enum and namespace/namespace interactions.
is_enum_scope: bool,

/// Initialize a new namespace scope
pub fn init(arg_ref: Ref, exported_members: *TSNamespaceMemberMap, is_enum: bool) TSNamespaceScope {
    return .{
        .arg_ref = arg_ref,
        .exported_members = exported_members,
        .is_enum = is_enum,
    };
}

/// Deinitialize and free resources
pub fn deinit(self: *TSNamespaceScope, allocator: std.mem.Allocator) void {
    self.property_accesses.deinit(allocator);
}

/// Get or generate a property access symbol
pub fn getOrGeneratePropertyAccess(
    self: *TSNamespaceScope,
    allocator: std.mem.Allocator,
    name: []const u8,
    generate_fn: fn (arg_ref: Ref, name: []const u8) Ref,
) !Ref {
    const gop = try self.property_accesses.getOrPut(allocator, name);
    if (!gop.found_existing) {
        gop.value_ptr.* = generate_fn(self.arg_ref, name);
    }
    return gop.value_ptr.*;
}
