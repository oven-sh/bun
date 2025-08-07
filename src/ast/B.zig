/// B is for Binding! Bindings are on the left side of variable
/// declarations (s_local), which is how destructuring assignments
/// are represented in memory. Consider a basic example.
///
///     let hello = world;
///         ^       ^
///         |       E.Identifier
///         B.Identifier
///
/// Bindings can be nested
///
///                B.Array
///                | B.Identifier
///                | |
///     let { foo: [ bar ] } = ...
///         ----------------
///         B.Object
pub const B = union(Binding.Tag) {
    // let x = ...
    b_identifier: *B.Identifier,
    // let [a, b] = ...
    b_array: *B.Array,
    // let { a, b: c } = ...
    b_object: *B.Object,
    // this is used to represent array holes
    b_missing: B.Missing,

    pub const Identifier = struct {
        ref: Ref,
    };

    pub const Property = struct {
        flags: Flags.Property.Set = Flags.Property.None,
        key: ExprNodeIndex,
        value: Binding,
        default_value: ?Expr = null,
    };

    pub const Object = struct {
        properties: []B.Property,
        is_single_line: bool = false,

        pub const Property = B.Property;
    };

    pub const Array = struct {
        items: []ArrayBinding,
        has_spread: bool = false,
        is_single_line: bool = false,

        pub const Item = ArrayBinding;
    };

    pub const Missing = struct {};

    /// This hash function is currently only used for React Fast Refresh transform.
    /// This doesn't include the `is_single_line` properties, as they only affect whitespace.
    pub fn writeToHasher(b: B, hasher: anytype, symbol_table: anytype) void {
        switch (b) {
            .b_identifier => |id| {
                const original_name = id.ref.getSymbol(symbol_table).original_name;
                writeAnyToHasher(hasher, .{ std.meta.activeTag(b), original_name.len });
            },
            .b_array => |array| {
                writeAnyToHasher(hasher, .{ std.meta.activeTag(b), array.has_spread, array.items.len });
                for (array.items) |item| {
                    writeAnyToHasher(hasher, .{item.default_value != null});
                    if (item.default_value) |default| {
                        default.data.writeToHasher(hasher, symbol_table);
                    }
                    item.binding.data.writeToHasher(hasher, symbol_table);
                }
            },
            .b_object => |object| {
                writeAnyToHasher(hasher, .{ std.meta.activeTag(b), object.properties.len });
                for (object.properties) |property| {
                    writeAnyToHasher(hasher, .{ property.default_value != null, property.flags });
                    if (property.default_value) |default| {
                        default.data.writeToHasher(hasher, symbol_table);
                    }
                    property.key.data.writeToHasher(hasher, symbol_table);
                    property.value.data.writeToHasher(hasher, symbol_table);
                }
            },
            .b_missing => {},
        }
    }
};

pub const Class = G.Class;

const std = @import("std");

const bun = @import("bun");
const writeAnyToHasher = bun.writeAnyToHasher;

const js_ast = bun.ast;
const ArrayBinding = js_ast.ArrayBinding;
const Binding = js_ast.Binding;
const Expr = js_ast.Expr;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const Flags = js_ast.Flags;
const G = js_ast.G;
const Ref = js_ast.Ref;
