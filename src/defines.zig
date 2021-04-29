const std = @import("std");
const js_ast = @import("./js_ast.zig");
const alloc = @import("alloc.zig");

usingnamespace @import("strings.zig");

const GlobalDefinesKey = @import("./defines-table.zig").GlobalDefinesKey;

const Globals = struct {
    pub const Undefined = js_ast.E.Undefined{};
    pub const UndefinedPtr = &Globals.Undefined;

    pub const NaN = js_ast.E.Number{ .value = std.math.nan(f64) };
    pub const NanPtr = &Globals.NaN;

    pub const Infinity = js_ast.E.Number{ .value = std.math.inf(f64) };
    pub const InfinityPtr = &Globals.Infinity;
};

pub const DefineData = struct {
    value: js_ast.Expr.Data = DefaultValue,

    // True if accessing this value is known to not have any side effects. For
    // example, a bare reference to "Object.create" can be removed because it
    // does not have any observable side effects.
    can_be_removed_if_unused: bool = false,

    // True if a call to this value is known to not have any side effects. For
    // example, a bare call to "Object()" can be removed because it does not
    // have any observable side effects.
    call_can_be_unwrapped_if_unused: bool = false,

    pub const DefaultValue = js_ast.Expr.Data{ .e_undefined = Globals.UndefinedPtr };

    // All the globals have the same behavior.
    // So we can create just one struct for it.
    pub const GlobalDefineData = DefineData{};

    pub fn merge(a: DefineData, b: DefineData) DefineData {
        return DefineData{
            .value = b.value,
            .can_be_removed_if_unsued = a.can_be_removed_if_unsued,
            .call_can_be_unwrapped_if_unused = a.call_can_be_unwrapped_if_unused,
        };
    }
};

fn arePartsEqual(a: []string, b: []string) bool {
    if (a.len != b.len) {
        return false;
    }

    var i: usize = 0;
    while (i < a.len) : (i += 1) {
        if (!strings.eql(a[i], b[i])) {
            return false;
        }
    }

    return true;
}

pub const IdentifierDefine = DefineData;

pub const DotDefine = struct {
    parts: []string,
    data: DefineData,
};

pub const Define = struct {
    identifiers: std.StringHashMapUnmanaged(IdentifierDefine),
    dots: std.StringHashMapUnmanaged([]DotDefine),
    allocator: *std.mem.Allocator,

    pub fn init(allocator: *std.mem.Allocator, user_defines: std.StringHashMap(DefineData)) !*@This() {
        var define = try allocator.create(Define);
        define.allocator = allocator;
        try define.identifiers.ensureCapacity(allocator, 641);
        try define.dots.ensureCapacity(allocator, 38);

        // Step 1. Load the globals into the hash tables
        for (GlobalDefinesKey) |global| {
            if (global.len == 1) {
                // TODO: when https://github.com/ziglang/zig/pull/8596 is merged, switch to putAssumeCapacityNoClobber
                define.identifiers.putAssumeCapacity(global[0], IdentifierDefine.GlobalDefineData);
            } else {
                // TODO: when https://github.com/ziglang/zig/pull/8596 is merged, switch to putAssumeCapacityNoClobber
                define.dots.putAssumeCapacity(global[global.len - 1], DotDefine{
                    .parts = global[0 .. global.len - 1],
                    .data = DefineData.GlobalDefineData,
                });
            }
        }

        // Step 2. Swap in certain literal values because those can be constant folded
        define.identifiers.putAssumeCapacity("undefined", DefineData{
            .value = js_ast.Expr.Data{ .e_undefined = Globals.UndefinedPtr },
        });
        define.identifiers.putAssumeCapacity("NaN", DefineData{
            .value = js_ast.Expr.Data{ .e_number = Globals.NanPtr },
        });
        define.identifiers.putAssumeCapacity("Infinity", DefineData{
            .value = js_ast.Expr.Data{ .e_number = Globals.InfinityPtr },
        });

        // Step 3. Load user data into hash tables
        // At this stage, user data has already been validated.
        if (user_defines.count() > 0) {
            var iter = user_defines.iterator();
            while (iter.next()) |user_define| {
                // If it has a dot, then it's a DotDefine.
                // e.g. process.env.NODE_ENV
                if (strings.lastIndexOfChar(user_define.key, '.')) |last_dot| {
                    const tail = user_define.key[last_dot + 1 .. user_define.key.len];
                    const parts = std.mem.tokenize(user_define.key[0..last_dot], ".").rest();
                    var didFind = false;
                    var initial_values = &([_]DotDefine{});

                    // "NODE_ENV"
                    if (define.dots.getEntry()) |entry| {
                        for (entry.value) |*part| {
                            // ["process", "env"] == ["process", "env"]
                            if (arePartsEqual(part.parts, parts)) {
                                part.data = part.data.merge(user_define.value);
                                didFind = true;
                                break;
                            }
                        }

                        initial_values = entry.value;
                    }

                    if (!didFind) {
                        var list = try std.ArrayList(DotDefine).initCapacity(allocator, initial_values.len + 1);
                        if (initial_values.len > 0) {
                            list.appendSliceAssumeCapacity(initial_values);
                        }

                        list.appendAssumeCapacity(DotDefine{
                            .data = user_define.value,
                            // TODO: do we need to allocate this?
                            .parts = parts,
                        });
                        try define.dots.put(allocator, tail, list.toOwnedSlice());
                    }
                } else {
                    // IS_BROWSER
                    try define.identifiers.put(user_define.key, user_define.value);
                }
            }
        }

        return define;
    }
};

test "defines" {
  
}
