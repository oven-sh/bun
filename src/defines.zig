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

    // Not using a slice here shrinks the size from 48 bytes to 40 bytes.
    original_name_ptr: ?[*]const u8 = null,
    original_name_len: u32 = 0,

    flags: Flags = .{},

    pub const Flags = packed struct(u8) {
        _padding: u3 = 0,

        valueless: bool = false,

        can_be_removed_if_unused: bool = false,

        call_can_be_unwrapped_if_unused: js_ast.E.CallUnwrap = .never,

        method_call_must_be_replaced_with_undefined: bool = false,
    };

    pub const Options = struct {
        original_name: ?[]const u8 = null,
        value: js_ast.Expr.Data,
        valueless: bool = false,
        can_be_removed_if_unused: bool = false,
        call_can_be_unwrapped_if_unused: js_ast.E.CallUnwrap = .never,
        method_call_must_be_replaced_with_undefined: bool = false,
    };

    pub fn init(options: Options) DefineData {
        return DefineData{
            .value = options.value,
            .flags = .{
                .valueless = options.valueless,
                .can_be_removed_if_unused = options.can_be_removed_if_unused,
                .call_can_be_unwrapped_if_unused = options.call_can_be_unwrapped_if_unused,
                .method_call_must_be_replaced_with_undefined = options.method_call_must_be_replaced_with_undefined,
            },
            .original_name_ptr = if (options.original_name) |name| name.ptr else null,
            .original_name_len = if (options.original_name) |name| @truncate(name.len) else 0,
        };
    }

    pub inline fn original_name(self: *const DefineData) ?[]const u8 {
        if (self.original_name_len > 0) {
            return self.original_name_ptr.?[0..self.original_name_len];
        }
        return null;
    }

    /// True if accessing this value is known to not have any side effects. For
    /// example, a bare reference to "Object.create" can be removed because it
    /// does not have any observable side effects.
    pub inline fn can_be_removed_if_unused(self: *const DefineData) bool {
        return self.flags.can_be_removed_if_unused;
    }

    /// True if a call to this value is known to not have any side effects. For
    /// example, a bare call to "Object()" can be removed because it does not
    /// have any observable side effects.
    pub inline fn call_can_be_unwrapped_if_unused(self: *const DefineData) js_ast.E.CallUnwrap {
        return self.flags.call_can_be_unwrapped_if_unused;
    }

    pub inline fn method_call_must_be_replaced_with_undefined(self: *const DefineData) bool {
        return self.flags.method_call_must_be_replaced_with_undefined;
    }

    pub inline fn valueless(self: *const DefineData) bool {
        return self.flags.valueless;
    }

    pub fn initBoolean(value: bool) DefineData {
        return .{
            .value = .{ .e_boolean = .{ .value = value } },
            .flags = .{ .can_be_removed_if_unused = true },
        };
    }

    pub fn initStaticString(str: *const js_ast.E.String) DefineData {
        return .{
            .value = .{ .e_string = @constCast(str) },
            .flags = .{ .can_be_removed_if_unused = true },
        };
    }

    pub fn merge(a: DefineData, b: DefineData) DefineData {
        return DefineData{
            .value = b.value,
            .flags = .{
                .can_be_removed_if_unused = a.can_be_removed_if_unused(),
                .call_can_be_unwrapped_if_unused = a.call_can_be_unwrapped_if_unused(),

                // TODO: investigate if this is correct. This is what it was before. But that looks strange.
                .valueless = a.method_call_must_be_replaced_with_undefined() or b.method_call_must_be_replaced_with_undefined(),

                .method_call_must_be_replaced_with_undefined = a.method_call_must_be_replaced_with_undefined() or b.method_call_must_be_replaced_with_undefined(),
            },
            .original_name_ptr = b.original_name_ptr,
            .original_name_len = b.original_name_len,
        };
    }

    pub fn fromMergeableInputEntry(user_defines: *UserDefines, key: []const u8, value_str: []const u8, value_is_undefined: bool, method_call_must_be_replaced_with_undefined_: bool, log: *logger.Log, allocator: std.mem.Allocator) !void {
        user_defines.putAssumeCapacity(key, try .parse(
            key,
            value_str,
            value_is_undefined,
            method_call_must_be_replaced_with_undefined_,
            log,
            allocator,
        ));
    }

    pub fn parse(
        key: []const u8,
        value_str: []const u8,
        value_is_undefined: bool,
        method_call_must_be_replaced_with_undefined_: bool,
        log: *logger.Log,
        allocator: std.mem.Allocator,
    ) !DefineData {
        var keySplitter = std.mem.splitScalar(u8, key, '.');
        while (keySplitter.next()) |part| {
            if (!js_lexer.isIdentifier(part)) {
                if (strings.eql(part, key)) {
                    try log.addErrorFmt(null, logger.Loc{}, allocator, "define key \"{s}\" must be a valid identifier", .{key});
                } else {
                    try log.addErrorFmt(null, logger.Loc{}, allocator, "define key \"{s}\" contains invalid identifier \"{s}\"", .{ part, value_str });
                }
                break;
            }
        }

        // check for nested identifiers
        var valueSplitter = std.mem.splitScalar(u8, value_str, '.');
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
            const value = if (value_is_undefined or strings.eqlComptime(value_str, "undefined"))
                js_ast.Expr.Data{ .e_undefined = js_ast.E.Undefined{} }
            else
                js_ast.Expr.Data{ .e_identifier = .{
                    .ref = Ref.None,
                    .can_be_removed_if_unused = true,
                } };

            return .{
                .value = value,
                .original_name_ptr = if (value_str.len > 0) value_str.ptr else null,
                .original_name_len = @truncate(value_str.len),
                .flags = .{
                    .can_be_removed_if_unused = true,
                    .valueless = value_is_undefined,
                    .method_call_must_be_replaced_with_undefined = method_call_must_be_replaced_with_undefined_,
                },
            };
        }
        const _log = log;
        const source = &logger.Source{
            .contents = value_str,
            .path = defines_path,
        };
        const expr = try json_parser.parseEnvJSON(source, _log, allocator);
        const cloned = try expr.data.deepClone(allocator);
        return .{
            .value = cloned,
            .original_name_ptr = if (value_str.len > 0) value_str.ptr else null,
            .original_name_len = @truncate(value_str.len),
            .flags = .{
                .can_be_removed_if_unused = expr.isPrimitiveLiteral(),
                .valueless = value_is_undefined,
                .method_call_must_be_replaced_with_undefined = method_call_must_be_replaced_with_undefined_,
            },
        };
    }

    pub fn fromInput(defines: RawDefines, drop: []const []const u8, log: *logger.Log, allocator: std.mem.Allocator) !UserDefines {
        var user_defines = UserDefines.init(allocator);
        var iterator = defines.iterator();
        try user_defines.ensureUnusedCapacity(@truncate(defines.count() + drop.len));
        while (iterator.next()) |entry| {
            try fromMergeableInputEntry(&user_defines, entry.key_ptr.*, entry.value_ptr.*, false, false, log, allocator);
        }

        for (drop) |drop_item| {
            if (drop_item.len > 0) {
                try fromMergeableInputEntry(&user_defines, drop_item, "", true, true, log, allocator);
            }
        }

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

pub const Define = struct {
    identifiers: bun.StringHashMap(IdentifierDefine),
    dots: bun.StringHashMap([]DotDefine),
    drop_debugger: bool,
    allocator: std.mem.Allocator,

    pub const Data = DefineData;

    pub fn forIdentifier(this: *const Define, name: []const u8) ?*const IdentifierDefine {
        if (this.identifiers.getPtr(name)) |data| {
            return data;
        }

        if (table.pure_global_identifier_map.get(name)) |id| {
            return id.value();
        }

        return null;
    }

    pub fn insertFromIterator(define: *Define, allocator: std.mem.Allocator, comptime Iterator: type, iter: Iterator) !void {
        while (iter.next()) |user_define| {
            try define.insert(allocator, user_define.key_ptr.*, user_define.value_ptr.*);
        }
    }

    pub fn insert(define: *Define, allocator: std.mem.Allocator, key: []const u8, value: DefineData) !void {
        // If it has a dot, then it's a DotDefine.
        // e.g. process.env.NODE_ENV
        if (strings.lastIndexOfChar(key, '.')) |last_dot| {
            const tail = key[last_dot + 1 .. key.len];
            const remainder = key[0..last_dot];
            const count = std.mem.count(u8, remainder, ".") + 1;
            var parts = try allocator.alloc(string, count + 1);
            var splitter = std.mem.splitScalar(u8, remainder, '.');
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
                        part.data = part.data.merge(value);
                        return;
                    }
                }

                initial_values = gpe_entry.value_ptr.*;
            }

            var list = try std.array_list.Managed(DotDefine).initCapacity(allocator, initial_values.len + 1);
            if (initial_values.len > 0) {
                list.appendSliceAssumeCapacity(initial_values);
            }

            list.appendAssumeCapacity(DotDefine{
                .data = value,
                // TODO: do we need to allocate this?
                .parts = parts,
            });
            gpe_entry.value_ptr.* = try list.toOwnedSlice();
        } else {
            // e.g. IS_BROWSER
            try define.identifiers.put(key, value);
        }
    }

    fn insertGlobal(define: *Define, allocator: std.mem.Allocator, global: []const string, value_define: *const DefineData) !void {
        const key = global[global.len - 1];
        const gpe = try define.dots.getOrPut(key);
        if (gpe.found_existing) {
            var list = try std.array_list.Managed(DotDefine).initCapacity(allocator, gpe.value_ptr.*.len + 1);
            list.appendSliceAssumeCapacity(gpe.value_ptr.*);
            list.appendAssumeCapacity(DotDefine{
                .parts = global[0..global.len],
                .data = value_define.*,
            });

            define.allocator.free(gpe.value_ptr.*);
            gpe.value_ptr.* = try list.toOwnedSlice();
        } else {
            var list = try std.array_list.Managed(DotDefine).initCapacity(allocator, 1);
            list.appendAssumeCapacity(DotDefine{
                .parts = global[0..global.len],
                .data = value_define.*,
            });

            gpe.value_ptr.* = try list.toOwnedSlice();
        }
    }

    pub fn init(allocator: std.mem.Allocator, _user_defines: ?UserDefines, string_defines: ?UserDefinesArray, drop_debugger: bool, omit_unused_global_calls: bool) bun.OOM!*@This() {
        const define = try allocator.create(Define);
        errdefer allocator.destroy(define);
        define.* = .{
            .allocator = allocator,
            .identifiers = bun.StringHashMap(IdentifierDefine).init(allocator),
            .dots = bun.StringHashMap([]DotDefine).init(allocator),
            .drop_debugger = drop_debugger,
        };
        try define.dots.ensureTotalCapacity(124);

        const value_define = &DefineData{
            .value = .{ .e_undefined = .{} },
            .flags = .{
                .valueless = true,
                .can_be_removed_if_unused = true,
            },
        };
        // Step 1. Load the globals into the hash tables
        for (global_no_side_effect_property_accesses) |global| {
            try define.insertGlobal(allocator, global, value_define);
        }

        const to_string_safe = &DefineData{
            .value = .{ .e_undefined = .{} },
            .flags = .{
                .valueless = true,
                .can_be_removed_if_unused = true,
                .call_can_be_unwrapped_if_unused = .if_unused_and_toString_safe,
            },
        };

        if (omit_unused_global_calls) {
            for (global_no_side_effect_function_calls_safe_for_to_string) |global| {
                try define.insertGlobal(allocator, global, to_string_safe);
            }
        } else {
            for (global_no_side_effect_function_calls_safe_for_to_string) |global| {
                try define.insertGlobal(allocator, global, value_define);
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

    pub fn deinit(this: *Define) void {
        var diter = this.dots.valueIterator();
        while (diter.next()) |key| this.allocator.free(key.*);
        this.dots.clearAndFree();
        this.identifiers.clearAndFree();
        this.allocator.destroy(this);
    }
};

const string = []const u8;

const fs = @import("./fs.zig");
const std = @import("std");

const table = @import("./defines-table.zig");
const global_no_side_effect_function_calls_safe_for_to_string = table.global_no_side_effect_function_calls_safe_for_to_string;
const global_no_side_effect_property_accesses = table.global_no_side_effect_property_accesses;

const bun = @import("bun");
const js_lexer = bun.js_lexer;
const json_parser = bun.json;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const Ref = bun.ast.Ref;
