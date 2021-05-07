const std = @import("std");
const js_ast = @import("./js_ast.zig");
const alloc = @import("alloc.zig");
const logger = @import("logger.zig");
const js_lexer = @import("js_lexer.zig");
const json_parser = @import("json_parser.zig");
const fs = @import("fs.zig");
usingnamespace @import("global.zig");
usingnamespace @import("ast/base.zig");

const GlobalDefinesKey = @import("./defines-table.zig").GlobalDefinesKey;

const Globals = struct {
    pub const Undefined = js_ast.E.Undefined{};
    pub const UndefinedPtr = &Globals.Undefined;

    pub const NaN = js_ast.E.Number{ .value = std.math.nan(f64) };
    pub const NanPtr = &Globals.NaN;

    pub const Infinity = js_ast.E.Number{ .value = std.math.inf(f64) };
    pub const InfinityPtr = &Globals.Infinity;
    pub const UndefinedData = js_ast.Expr.Data{ .e_undefined = Globals.UndefinedPtr };
    pub const NaNData = js_ast.Expr.Data{ .e_number = Globals.NanPtr };
    pub const InfinityData = js_ast.Expr.Data{ .e_number = Globals.InfinityPtr };
};

const defines_path = fs.Path.init("/tmp/internal/defines.json");
pub const RawDefines = std.StringHashMap(string);
pub const UserDefines = std.StringHashMap(DefineData);

pub const DefineData = struct {
    value: js_ast.Expr.Data,
    valueless: bool = false,
    original_name: ?string = null,

    // True if accessing this value is known to not have any side effects. For
    // example, a bare reference to "Object.create" can be removed because it
    // does not have any observable side effects.
    can_be_removed_if_unused: bool = false,

    // True if a call to this value is known to not have any side effects. For
    // example, a bare call to "Object()" can be removed because it does not
    // have any observable side effects.
    call_can_be_unwrapped_if_unused: bool = false,

    // All the globals have the same behavior.
    // So we can create just one struct for it.
    pub const GlobalDefineData = DefineData{};

    pub fn isUndefined(self: *const DefineData) bool {
        return self.valueless;
    }

    pub fn merge(a: DefineData, b: DefineData) DefineData {
        return DefineData{
            .value = b.value,
            .can_be_removed_if_unused = a.can_be_removed_if_unused,
            .call_can_be_unwrapped_if_unused = a.call_can_be_unwrapped_if_unused,
        };
    }

    pub fn from_input(defines: RawDefines, log: *logger.Log, allocator: *std.mem.Allocator) !UserDefines {
        var user_defines = UserDefines.init(allocator);
        try user_defines.ensureCapacity(defines.count());

        var iter = defines.iterator();
        while (iter.next()) |entry| {
            var splitter = std.mem.split(entry.key, ".");
            while (splitter.next()) |part| {
                if (!js_lexer.isIdentifier(part)) {
                    if (strings.eql(part, entry.key)) {
                        try log.addErrorFmt(null, logger.Loc{}, allocator, "The define key \"{s}\" must be a valid identifier", .{entry.key});
                    } else {
                        try log.addErrorFmt(null, logger.Loc{}, allocator, "The define key \"{s}\" contains invalid  identifier \"{s}\"", .{ part, entry.key });
                    }
                    break;
                }
            }

            if (js_lexer.isIdentifier(entry.value) and !js_lexer.Keywords.has(entry.value)) {
                var ident: *js_ast.E.Identifier = try allocator.create(js_ast.E.Identifier);
                ident.ref = Ref.None;
                ident.can_be_removed_if_unused = true;
                user_defines.putAssumeCapacity(
                    entry.key,
                    DefineData{
                        .value = js_ast.Expr.Data{ .e_identifier = ident },
                        .original_name = entry.value,
                        .can_be_removed_if_unused = true,
                    },
                );
                // user_defines.putAssumeCapacity(
                //     entry.key,
                //     DefineData{ .value = js_ast.Expr.Data{.e_identifier = } },
                // );
                continue;
            }
            var _log = log;
            var source = logger.Source{ .contents = entry.value, .path = defines_path, .identifier_name = "" };
            var expr = try json_parser.ParseJSON(&source, _log, allocator);
            var data: js_ast.Expr.Data = undefined;
            switch (expr.data) {
                .e_missing => {
                    continue;
                },
                .e_null, .e_boolean, .e_string, .e_number, .e_object, .e_array => {
                    data = expr.data;
                },
                else => {
                    continue;
                },
            }

            user_defines.putAssumeCapacity(entry.key, DefineData{
                .value = data,
            });
        }

        return user_defines;
    }
};

fn arePartsEqual(a: []const string, b: []const string) bool {
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
    parts: []const string,
    data: DefineData,
};

pub const Define = struct {
    identifiers: std.StringHashMap(IdentifierDefine),
    dots: std.StringHashMap([]DotDefine),
    allocator: *std.mem.Allocator,

    pub fn init(allocator: *std.mem.Allocator, _user_defines: ?UserDefines) !*@This() {
        var define = try allocator.create(Define);
        define.allocator = allocator;
        define.identifiers = std.StringHashMap(IdentifierDefine).init(allocator);
        define.dots = std.StringHashMap([]DotDefine).init(allocator);
        try define.identifiers.ensureCapacity(641);
        try define.dots.ensureCapacity(64);

        var undefined_val = try allocator.create(js_ast.E.Undefined);
        var val = js_ast.Expr.Data{ .e_undefined = undefined_val };
        var ident_define = IdentifierDefine{
            .value = val,
        };
        var value_define = DefineData{ .value = val, .valueless = true };
        // Step 1. Load the globals into the hash tables
        for (GlobalDefinesKey) |global| {
            if (global.len == 1) {

                // TODO: when https://github.com/ziglang/zig/pull/8596 is merged, switch to putAssumeCapacityNoClobber
                define.identifiers.putAssumeCapacity(global[0], value_define);
            } else {
                const key = global[global.len - 1];
                // TODO: move this to comptime
                // TODO: when https://github.com/ziglang/zig/pull/8596 is merged, switch to putAssumeCapacityNoClobber
                if (define.dots.getEntry(key)) |entry| {
                    var list = try std.ArrayList(DotDefine).initCapacity(allocator, entry.value.len + 1);
                    list.appendSliceAssumeCapacity(entry.value);
                    list.appendAssumeCapacity(DotDefine{
                        .parts = global[0 .. global.len - 1],
                        .data = value_define,
                    });

                    define.dots.putAssumeCapacity(key, list.toOwnedSlice());
                } else {
                    var list = try std.ArrayList(DotDefine).initCapacity(allocator, 1);
                    list.appendAssumeCapacity(DotDefine{
                        .parts = global[0 .. global.len - 1],
                        .data = value_define,
                    });

                    define.dots.putAssumeCapacity(key, list.toOwnedSlice());
                }
            }
        }

        var nan_val = try allocator.create(js_ast.E.Number);
        nan_val.value = std.math.nan_f64;

        var inf_val = try allocator.create(js_ast.E.Number);
        inf_val.value = std.math.inf_f64;

        // Step 2. Swap in certain literal values because those can be constant folded
        define.identifiers.putAssumeCapacity("undefined", value_define);
        define.identifiers.putAssumeCapacity("NaN", DefineData{
            .value = js_ast.Expr.Data{ .e_number = nan_val },
        });
        define.identifiers.putAssumeCapacity("Infinity", DefineData{
            .value = js_ast.Expr.Data{ .e_number = inf_val },
        });

        // Step 3. Load user data into hash tables
        // At this stage, user data has already been validated.
        if (_user_defines) |user_defines| {
            var iter = user_defines.iterator();
            while (iter.next()) |user_define| {
                // If it has a dot, then it's a DotDefine.
                // e.g. process.env.NODE_ENV
                if (strings.lastIndexOfChar(user_define.key, '.')) |last_dot| {
                    const tail = user_define.key[last_dot + 1 .. user_define.key.len];
                    const remainder = user_define.key[0..last_dot];
                    const count = std.mem.count(u8, remainder, ".") + 1;
                    var parts = try allocator.alloc(string, count);
                    var splitter = std.mem.split(remainder, ".");
                    var i: usize = 0;
                    while (splitter.next()) |split| : (i += 1) {
                        parts[i] = split;
                    }

                    var didFind = false;
                    var initial_values: []DotDefine = &([_]DotDefine{});

                    // "NODE_ENV"
                    if (define.dots.getEntry(tail)) |entry| {
                        for (entry.value) |*part| {
                            // ["process", "env"] === ["process", "env"] (if that actually worked)
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
                        try define.dots.put(tail, list.toOwnedSlice());
                    }
                } else {
                    // e.g. IS_BROWSER
                    try define.identifiers.put(user_define.key, user_define.value);
                }
            }
        }

        return define;
    }
};

const expect = std.testing.expect;
test "UserDefines" {
    try alloc.setup(std.heap.page_allocator);
    var orig = RawDefines.init(alloc.dynamic);
    try orig.put("process.env.NODE_ENV", "\"development\"");
    try orig.put("globalThis", "window");
    var log = logger.Log.init(alloc.dynamic);
    var data = try DefineData.from_input(orig, &log, alloc.dynamic);

    expect(data.contains("process.env.NODE_ENV"));
    expect(data.contains("globalThis"));
    const globalThis = data.get("globalThis");
    const val = data.get("process.env.NODE_ENV");
    expect(val != null);
    expect(strings.utf16EqlString(val.?.value.e_string.value, "development"));
    std.testing.expectEqualStrings(globalThis.?.original_name.?, "window");
}

// 396,000ns was upper end of last time this was checked how long it took
// => 0.396ms
test "Defines" {
    try alloc.setup(std.heap.page_allocator);
    const start = std.time.nanoTimestamp();
    var orig = RawDefines.init(alloc.dynamic);
    try orig.put("process.env.NODE_ENV", "\"development\"");
    var log = logger.Log.init(alloc.dynamic);
    var data = try DefineData.from_input(orig, &log, alloc.dynamic);
    var defines = try Define.init(alloc.dynamic, data);
    Output.print("Time: {d}", .{std.time.nanoTimestamp() - start});
    const node_env_dots = defines.dots.get("NODE_ENV");
    expect(node_env_dots != null);
    expect(node_env_dots.?.len > 0);
    const node_env = node_env_dots.?[0];
    std.testing.expectEqual(node_env.parts.len, 2);
    std.testing.expectEqualStrings("process", node_env.parts[0]);
    std.testing.expectEqualStrings("env", node_env.parts[1]);
    expect(node_env.data.original_name == null);
    expect(strings.utf16EqlString(node_env.data.value.e_string.value, "development"));
}
