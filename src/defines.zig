const std = @import("std");
const js_ast = bun.JSAst;
const logger = bun.logger;
const js_lexer = bun.js_lexer;
const json_parser = bun.JSON;
const fs = @import("fs.zig");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const Ref = @import("ast/base.zig").Ref;

const GlobalDefinesKey = @import("./defines-table.zig").GlobalDefinesKey;
const table = @import("./defines-table.zig");

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

const defines_path = fs.Path.initWithNamespace("defines.json", "internal");
pub const RawDefines = bun.StringArrayHashMap(string);
pub const UserDefines = bun.StringHashMap(DefineData);
pub const UserDefinesArray = bun.StringArrayHashMap(DefineData);

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

    pub fn isUndefined(self: *const DefineData) bool {
        return self.valueless;
    }

    pub fn merge(a: DefineData, b: DefineData) DefineData {
        return DefineData{
            .value = b.value,
            .can_be_removed_if_unused = a.can_be_removed_if_unused,
            .call_can_be_unwrapped_if_unused = a.call_can_be_unwrapped_if_unused,
            .original_name = b.original_name,
        };
    }

    pub fn from_mergable_input(defines: RawDefines, user_defines: *UserDefines, log: *logger.Log, allocator: std.mem.Allocator) !void {
        try user_defines.ensureUnusedCapacity(@as(u32, @truncate(defines.count())));
        var iter = defines.iterator();
        while (iter.next()) |entry| {
            var keySplitter = std.mem.split(u8, entry.key_ptr.*, ".");
            while (keySplitter.next()) |part| {
                if (!js_lexer.isIdentifier(part)) {
                    if (strings.eql(part, entry.key_ptr)) {
                        try log.addErrorFmt(null, logger.Loc{}, allocator, "define key \"{s}\" must be a valid identifier", .{entry.key_ptr.*});
                    } else {
                        try log.addErrorFmt(null, logger.Loc{}, allocator, "define key \"{s}\" contains invalid identifier \"{s}\"", .{ part, entry.value_ptr.* });
                    }
                    break;
                }
            }

            // check for nested identifiers
            var valueSplitter = std.mem.split(u8, entry.value_ptr.*, ".");
            var isIdent = true;
            while (valueSplitter.next()) |part| {
                if (!js_lexer.isIdentifier(part) or js_lexer.Keywords.has(part)) {
                    isIdent = false;
                    break;
                }
            }
            if (isIdent) {

                // Special-case undefined. it's not an identifier here
                // https://github.com/evanw/esbuild/issues/1407
                if (strings.eqlComptime(entry.value_ptr.*, "undefined")) {
                    user_defines.putAssumeCapacity(
                        entry.key_ptr.*,
                        DefineData{
                            .value = js_ast.Expr.Data{ .e_undefined = js_ast.E.Undefined{} },
                            .original_name = entry.value_ptr.*,
                            .can_be_removed_if_unused = true,
                        },
                    );
                } else {
                    const ident = js_ast.E.Identifier{ .ref = Ref.None, .can_be_removed_if_unused = true };

                    user_defines.putAssumeCapacity(
                        entry.key_ptr.*,
                        DefineData{
                            .value = js_ast.Expr.Data{ .e_identifier = ident },
                            .original_name = entry.value_ptr.*,
                            .can_be_removed_if_unused = true,
                        },
                    );
                }

                // user_defines.putAssumeCapacity(
                //     entry.key_ptr,
                //     DefineData{ .value = js_ast.Expr.Data{.e_identifier = } },
                // );
                continue;
            }
            const _log = log;
            var source = logger.Source{
                .contents = entry.value_ptr.*,
                .path = defines_path,
                .key_path = fs.Path.initWithNamespace("defines", "internal"),
            };
            var expr = try json_parser.ParseEnvJSON(&source, _log, allocator);
            var data: js_ast.Expr.Data = undefined;
            switch (expr.data) {
                .e_missing => {
                    data = .{ .e_missing = js_ast.E.Missing{} };
                },
                // We must copy so we don't recycle
                .e_string => {
                    data = .{ .e_string = try allocator.create(js_ast.E.String) };
                    data.e_string.* = try expr.data.e_string.clone(allocator);
                },
                .e_null, .e_boolean, .e_number => {
                    data = expr.data;
                },
                // We must copy so we don't recycle
                .e_object => |obj| {
                    expr.data.e_object = try allocator.create(js_ast.E.Object);
                    expr.data.e_object.* = obj.*;
                    data = expr.data;
                },
                // We must copy so we don't recycle
                .e_array => |obj| {
                    expr.data.e_array = try allocator.create(js_ast.E.Array);
                    expr.data.e_array.* = obj.*;
                    data = expr.data;
                },
                else => {
                    continue;
                },
            }

            user_defines.putAssumeCapacity(entry.key_ptr.*, DefineData{
                .value = data,
                .can_be_removed_if_unused = @as(js_ast.Expr.Tag, data).isPrimitiveLiteral(),
            });
        }
    }

    pub fn from_input(defines: RawDefines, log: *logger.Log, allocator: std.mem.Allocator) !UserDefines {
        var user_defines = UserDefines.init(allocator);
        try from_mergable_input(defines, &user_defines, log, allocator);

        return user_defines;
    }
};

fn arePartsEqual(a: []const string, b: []const string) bool {
    if (a.len != b.len) {
        return false;
    }
    for (0..a.len) |i| {
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

// var nan_val = try allocator.create(js_ast.E.Number);
const nan_val = js_ast.E.Number{ .value = std.math.nan(f64) };
const inf_val = js_ast.E.Number{ .value = std.math.inf(f64) };

pub const Define = struct {
    identifiers: bun.StringHashMap(IdentifierDefine),
    dots: bun.StringHashMap([]DotDefine),
    allocator: std.mem.Allocator,

    pub fn forIdentifier(this: *const Define, name: []const u8) ?IdentifierDefine {
        if (this.identifiers.get(name)) |data| {
            return data;
        }

        return table.pure_global_identifier_map.get(name);
    }

    pub fn insertFromIterator(define: *Define, allocator: std.mem.Allocator, comptime Iterator: type, iter: Iterator) !void {
        outer: while (iter.next()) |user_define| {
            const user_define_key = user_define.key_ptr.*;
            // If it has a dot, then it's a DotDefine.
            // e.g. process.env.NODE_ENV
            if (strings.lastIndexOfChar(user_define_key, '.')) |last_dot| {
                const tail = user_define_key[last_dot + 1 .. user_define_key.len];
                const remainder = user_define_key[0..last_dot];
                const count = std.mem.count(u8, remainder, ".") + 1;
                var parts = try allocator.alloc(string, count + 1);
                var splitter = std.mem.split(u8, remainder, ".");
                var i: usize = 0;
                while (splitter.next()) |split| : (i += 1) {
                    parts[i] = split;
                }
                parts[i] = tail;
                var initial_values: []DotDefine = &([_]DotDefine{});

                // "NODE_ENV"
                const gpe_entry = try define.dots.getOrPut(tail);

                if (gpe_entry.found_existing) {
                    for (gpe_entry.value_ptr.*) |*part| {
                        // ["process", "env"] === ["process", "env"] (if that actually worked)
                        if (arePartsEqual(part.parts, parts)) {
                            part.data = part.data.merge(user_define.value_ptr.*);
                            continue :outer;
                        }
                    }

                    initial_values = gpe_entry.value_ptr.*;
                }

                var list = try std.ArrayList(DotDefine).initCapacity(allocator, initial_values.len + 1);
                if (initial_values.len > 0) {
                    list.appendSliceAssumeCapacity(initial_values);
                }

                list.appendAssumeCapacity(DotDefine{
                    .data = user_define.value_ptr.*,
                    // TODO: do we need to allocate this?
                    .parts = parts,
                });
                gpe_entry.value_ptr.* = try list.toOwnedSlice();
            } else {

                // e.g. IS_BROWSER
                try define.identifiers.put(user_define_key, user_define.value_ptr.*);
            }
        }
    }

    pub fn init(allocator: std.mem.Allocator, _user_defines: ?UserDefines, string_defines: ?UserDefinesArray) !*@This() {
        var define = try allocator.create(Define);
        define.allocator = allocator;
        define.identifiers = bun.StringHashMap(IdentifierDefine).init(allocator);
        define.dots = bun.StringHashMap([]DotDefine).init(allocator);
        try define.dots.ensureTotalCapacity(124);

        const value_define = DefineData{
            .value = .{ .e_undefined = .{} },
            .valueless = true,
            .can_be_removed_if_unused = true,
        };
        // Step 1. Load the globals into the hash tables
        for (GlobalDefinesKey) |global| {
            const key = global[global.len - 1];
            const gpe = try define.dots.getOrPut(key);
            if (gpe.found_existing) {
                var list = try std.ArrayList(DotDefine).initCapacity(allocator, gpe.value_ptr.*.len + 1);
                list.appendSliceAssumeCapacity(gpe.value_ptr.*);
                list.appendAssumeCapacity(DotDefine{
                    .parts = global[0..global.len],
                    .data = value_define,
                });

                gpe.value_ptr.* = try list.toOwnedSlice();
            } else {
                var list = try std.ArrayList(DotDefine).initCapacity(allocator, 1);
                list.appendAssumeCapacity(DotDefine{
                    .parts = global[0..global.len],
                    .data = value_define,
                });

                gpe.value_ptr.* = try list.toOwnedSlice();
            }
        }

        // Step 3. Load user data into hash tables
        // At this stage, user data has already been validated.
        if (_user_defines) |user_defines| {
            var iter = user_defines.iterator();
            try define.insertFromIterator(allocator, @TypeOf(&iter), &iter);
        }

        // Step 4. Load environment data into hash tables.
        // These are only strings. We do not parse them as JSON.
        if (string_defines) |string_defines_| {
            var iter = string_defines_.iterator();
            try define.insertFromIterator(allocator, @TypeOf(&iter), &iter);
        }

        return define;
    }
};
