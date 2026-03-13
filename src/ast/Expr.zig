loc: logger.Loc,
data: Data,

pub const empty = Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = logger.Loc.Empty };

pub fn isAnonymousNamed(expr: Expr) bool {
    return switch (expr.data) {
        .e_arrow => true,
        .e_function => |func| func.func.name == null,
        .e_class => |class| class.class_name == null,
        else => false,
    };
}

pub fn clone(this: Expr, allocator: std.mem.Allocator) !Expr {
    return .{
        .loc = this.loc,
        .data = try this.data.clone(allocator),
    };
}

pub fn deepClone(this: Expr, allocator: std.mem.Allocator) OOM!Expr {
    return .{
        .loc = this.loc,
        .data = try this.data.deepClone(allocator),
    };
}

pub fn wrapInArrow(this: Expr, allocator: std.mem.Allocator) !Expr {
    var stmts = try allocator.alloc(Stmt, 1);
    stmts[0] = Stmt.alloc(S.Return, S.Return{ .value = this }, this.loc);

    return Expr.init(E.Arrow, E.Arrow{
        .args = &.{},
        .body = .{
            .loc = this.loc,
            .stmts = stmts,
        },
    }, this.loc);
}

pub fn canBeInlinedFromPropertyAccess(this: Expr) bool {
    return switch (this.data) {
        // if the array has a spread we must keep it
        // https://github.com/oven-sh/bun/issues/2594
        .e_spread => false,

        .e_missing => false,
        else => true,
    };
}

pub fn canBeConstValue(this: Expr) bool {
    return this.data.canBeConstValue();
}

pub fn canBeMoved(expr: Expr) bool {
    return expr.data.canBeMoved();
}

pub fn unwrapInlined(expr: Expr) Expr {
    if (expr.data.as(.e_inlined_enum)) |inlined| return inlined.value;
    return expr;
}

pub fn fromBlob(
    blob: *const jsc.WebCore.Blob,
    allocator: std.mem.Allocator,
    mime_type_: ?MimeType,
    log: *logger.Log,
    loc: logger.Loc,
) !Expr {
    const bytes = blob.sharedView();

    const mime_type = mime_type_ orelse MimeType.init(blob.content_type, null, null);

    if (mime_type.category == .json) {
        const source = &logger.Source.initPathString("fetch.json", bytes);
        var out_expr = JSONParser.parseForMacro(source, log, allocator) catch {
            return error.MacroFailed;
        };
        out_expr.loc = loc;

        switch (out_expr.data) {
            .e_object => {
                out_expr.data.e_object.was_originally_macro = true;
            },
            .e_array => {
                out_expr.data.e_array.was_originally_macro = true;
            },
            else => {},
        }

        return out_expr;
    }

    if (mime_type.category.isTextLike()) {
        var output = MutableString.initEmpty(allocator);
        try JSPrinter.quoteForJSON(bytes, &output, true);
        var list = output.toOwnedSlice();
        // remove the quotes
        if (list.len > 0) {
            list = list[1 .. list.len - 1];
        }
        return Expr.init(E.String, E.String.init(list), loc);
    }

    return Expr.init(
        E.String,
        E.String{
            .data = try jsc.ZigString.init(bytes).toBase64DataURL(allocator),
        },
        loc,
    );
}

pub inline fn initIdentifier(ref: Ref, loc: logger.Loc) Expr {
    return Expr{
        .loc = loc,
        .data = .{
            .e_identifier = E.Identifier.init(ref),
        },
    };
}

pub fn toEmpty(expr: Expr) Expr {
    return Expr{ .data = .{ .e_missing = E.Missing{} }, .loc = expr.loc };
}
pub fn isEmpty(expr: Expr) bool {
    return expr.data == .e_missing;
}
pub const Query = struct { expr: Expr, loc: logger.Loc, i: u32 = 0 };

pub fn hasAnyPropertyNamed(expr: *const Expr, comptime names: []const string) bool {
    if (expr.data != .e_object) return false;
    const obj = expr.data.e_object;
    if (obj.properties.len == 0) return false;

    for (obj.properties.slice()) |prop| {
        if (prop.value == null) continue;
        const key = prop.key orelse continue;
        if (key.data != .e_string) continue;
        const key_str = key.data.e_string;
        if (strings.eqlAnyComptime(key_str.data, names)) return true;
    }

    return false;
}

pub fn toJS(this: Expr, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) ToJSError!jsc.JSValue {
    return this.data.toJS(allocator, globalObject);
}

pub inline fn isArray(this: *const Expr) bool {
    return this.data == .e_array;
}

pub inline fn isObject(this: *const Expr) bool {
    return this.data == .e_object;
}

pub fn get(expr: *const Expr, name: string) ?Expr {
    return if (asProperty(expr, name)) |query| query.expr else null;
}

/// Only use this for pretty-printing JSON. Do not use in transpiler.
///
/// This does not handle edgecases like `-1` or stringifying arbitrary property lookups.
pub fn getByIndex(expr: *const Expr, index: u32, index_str: string, allocator: std.mem.Allocator) ?Expr {
    switch (expr.data) {
        .e_array => |array| {
            if (index >= array.items.len) return null;
            return array.items.slice()[index];
        },
        .e_object => |object| {
            for (object.properties.sliceConst()) |*prop| {
                const key = &(prop.key orelse continue);
                switch (key.data) {
                    .e_string => |str| {
                        if (str.eql(string, index_str)) {
                            return prop.value;
                        }
                    },
                    .e_number => |num| {
                        if (num.toU32() == index) {
                            return prop.value;
                        }
                    },
                    else => {},
                }
            }

            return null;
        },
        .e_string => |str| {
            if (str.len() > index) {
                var slice = str.slice(allocator);
                // TODO: this is not correct since .length refers to UTF-16 code units and not UTF-8 bytes
                // However, since this is only used in the JSON prettifier for `bun pm view`, it's not a blocker for shipping.
                if (slice.len > index) {
                    return Expr.init(E.String, .{ .data = slice[index..][0..1] }, expr.loc);
                }
            }
        },
        else => {},
    }

    return null;
}

/// This supports lookups like:
/// - `foo`
/// - `foo.bar`
/// - `foo[123]`
/// - `foo[123].bar`
/// - `foo[123].bar[456]`
/// - `foo[123].bar[456].baz`
/// - `foo[123].bar[456].baz.qux` // etc.
///
/// This is not intended for use by the transpiler, instead by pretty printing JSON.
pub fn getPathMayBeIndex(expr: *const Expr, name: string) ?Expr {
    if (name.len == 0) {
        return null;
    }

    if (strings.indexOfAny(name, "[.")) |idx| {
        switch (name[idx]) {
            '[' => {
                const end_idx = strings.indexOfChar(name, ']') orelse return null;
                var base_expr = expr;
                if (idx > 0) {
                    const key = name[0..idx];
                    base_expr = &(base_expr.get(key) orelse return null);
                }

                const index_str = name[idx + 1 .. end_idx];
                const index = std.fmt.parseInt(u32, index_str, 10) catch return null;
                const rest = if (name.len > end_idx) name[end_idx + 1 ..] else "";
                const result = &(base_expr.getByIndex(index, index_str, bun.default_allocator) orelse return null);
                if (rest.len > 0) return result.getPathMayBeIndex(rest);
                return result.*;
            },
            '.' => {
                const key = name[0..idx];
                const sub_expr = &(expr.get(key) orelse return null);
                const subpath = if (name.len > idx) name[idx + 1 ..] else "";
                if (subpath.len > 0) {
                    return sub_expr.getPathMayBeIndex(subpath);
                }

                return sub_expr.*;
            },
            else => unreachable,
        }
    }

    return expr.get(name);
}

/// Don't use this if you care about performance.
///
/// Sets the value of a property, creating it if it doesn't exist.
/// `expr` must be an object.
pub fn set(expr: *Expr, allocator: std.mem.Allocator, name: string, value: Expr) OOM!void {
    bun.assertWithLocation(expr.isObject(), @src());
    for (0..expr.data.e_object.properties.len) |i| {
        const prop = &expr.data.e_object.properties.ptr[i];
        const key = prop.key orelse continue;
        if (key.data != .e_string) continue;
        if (key.data.e_string.eql(string, name)) {
            prop.value = value;
            return;
        }
    }

    try expr.data.e_object.properties.append(allocator, .{
        .key = Expr.init(E.String, .{ .data = name }, logger.Loc.Empty),
        .value = value,
    });
}

/// Don't use this if you care about performance.
///
/// Sets the value of a property to a string, creating it if it doesn't exist.
/// `expr` must be an object.
pub fn setString(expr: *Expr, allocator: std.mem.Allocator, name: string, value: string) OOM!void {
    bun.assertWithLocation(expr.isObject(), @src());
    for (0..expr.data.e_object.properties.len) |i| {
        const prop = &expr.data.e_object.properties.ptr[i];
        const key = prop.key orelse continue;
        if (key.data != .e_string) continue;
        if (key.data.e_string.eql(string, name)) {
            prop.value = Expr.init(E.String, .{ .data = value }, logger.Loc.Empty);
            return;
        }
    }

    try expr.data.e_object.properties.append(allocator, .{
        .key = Expr.init(E.String, .{ .data = name }, logger.Loc.Empty),
        .value = Expr.init(E.String, .{ .data = value }, logger.Loc.Empty),
    });
}

pub fn getObject(expr: *const Expr, name: string) ?Expr {
    if (expr.asProperty(name)) |query| {
        if (query.expr.isObject()) {
            return query.expr;
        }
    }
    return null;
}

pub fn getBoolean(expr: *const Expr, name: string) ?bool {
    if (expr.asProperty(name)) |query| {
        switch (query.expr.data) {
            .e_boolean, .e_branch_boolean => |b| return b.value,
            else => {},
        }
    }
    return null;
}

pub fn getString(expr: *const Expr, allocator: std.mem.Allocator, name: string) OOM!?struct { string, logger.Loc } {
    if (asProperty(expr, name)) |q| {
        if (q.expr.asString(allocator)) |str| {
            return .{
                str,
                q.expr.loc,
            };
        }
    }
    return null;
}

pub fn getNumber(expr: *const Expr, name: string) ?struct { f64, logger.Loc } {
    if (asProperty(expr, name)) |q| {
        if (q.expr.asNumber()) |num| {
            return .{
                num,
                q.expr.loc,
            };
        }
    }
    return null;
}

pub fn getStringCloned(expr: *const Expr, allocator: std.mem.Allocator, name: string) OOM!?string {
    return if (asProperty(expr, name)) |q| q.expr.asStringCloned(allocator) else null;
}

pub fn getStringClonedZ(expr: *const Expr, allocator: std.mem.Allocator, name: string) OOM!?stringZ {
    return if (asProperty(expr, name)) |q| q.expr.asStringZ(allocator) else null;
}

pub fn getArray(expr: *const Expr, name: string) ?ArrayIterator {
    return if (asProperty(expr, name)) |q| q.expr.asArray() else null;
}

pub fn getRope(self: *const Expr, rope: *const E.Object.Rope) ?E.Object.RopeQuery {
    if (self.get(rope.head.data.e_string.data)) |existing| {
        switch (existing.data) {
            .e_array => |array| {
                if (rope.next) |next| {
                    if (array.items.last()) |end| {
                        return end.getRope(next);
                    }
                }

                return E.Object.RopeQuery{
                    .expr = existing,
                    .rope = rope,
                };
            },
            .e_object => {
                if (rope.next) |next| {
                    if (existing.getRope(next)) |end| {
                        return end;
                    }
                }

                return E.Object.RopeQuery{
                    .expr = existing,
                    .rope = rope,
                };
            },
            else => return E.Object.RopeQuery{
                .expr = existing,
                .rope = rope,
            },
        }
    }

    return null;
}

// Making this comptime bloats the binary and doesn't seem to impact runtime performance.
pub fn asProperty(expr: *const Expr, name: string) ?Query {
    if (expr.data != .e_object) return null;
    const obj = expr.data.e_object;
    if (obj.properties.len == 0) return null;

    return obj.asProperty(name);
}

pub fn asPropertyStringMap(expr: *const Expr, name: string, allocator: std.mem.Allocator) ?*bun.StringArrayHashMap(string) {
    if (expr.data != .e_object) return null;
    const obj_ = expr.data.e_object;
    if (obj_.properties.len == 0) return null;
    const query = obj_.asProperty(name) orelse return null;
    if (query.expr.data != .e_object) return null;

    const obj = query.expr.data.e_object;
    var count: usize = 0;
    for (obj.properties.slice()) |prop| {
        const key = prop.key.?.asString(allocator) orelse continue;
        const value = prop.value.?.asString(allocator) orelse continue;
        count += @as(usize, @intFromBool(key.len > 0 and value.len > 0));
    }

    if (count == 0) return null;
    var map = bun.StringArrayHashMap(string).init(allocator);
    map.ensureUnusedCapacity(count) catch return null;

    for (obj.properties.slice()) |prop| {
        const key = prop.key.?.asString(allocator) orelse continue;
        const value = prop.value.?.asString(allocator) orelse continue;

        if (!(key.len > 0 and value.len > 0)) continue;

        map.putAssumeCapacity(key, value);
    }

    const ptr = allocator.create(bun.StringArrayHashMap(string)) catch unreachable;
    ptr.* = map;
    return ptr;
}

pub const ArrayIterator = struct {
    array: *const E.Array,
    index: u32,

    pub fn next(this: *ArrayIterator) ?Expr {
        if (this.index >= this.array.items.len) {
            return null;
        }
        defer this.index += 1;
        return this.array.items.ptr[this.index];
    }
};

pub fn asArray(expr: *const Expr) ?ArrayIterator {
    if (expr.data != .e_array) return null;
    const array = expr.data.e_array;
    if (array.items.len == 0) return null;

    return ArrayIterator{ .array = array, .index = 0 };
}

pub inline fn asUtf8StringLiteral(expr: *const Expr) ?string {
    if (expr.data == .e_string) {
        bun.debugAssert(expr.data.e_string.next == null);
        return expr.data.e_string.data;
    }
    return null;
}

pub inline fn asStringLiteral(expr: *const Expr, allocator: std.mem.Allocator) ?string {
    if (expr.data != .e_string) return null;
    return expr.data.e_string.string(allocator) catch null;
}

pub inline fn isString(expr: *const Expr) bool {
    return switch (expr.data) {
        .e_string => true,
        else => false,
    };
}

pub inline fn asString(expr: *const Expr, allocator: std.mem.Allocator) ?string {
    switch (expr.data) {
        .e_string => |str| return bun.handleOom(str.string(allocator)),
        else => return null,
    }
}
pub inline fn asStringHash(expr: *const Expr, allocator: std.mem.Allocator, comptime hash_fn: *const fn (buf: []const u8) callconv(.@"inline") u64) OOM!?u64 {
    switch (expr.data) {
        .e_string => |str| {
            if (str.isUTF8()) return hash_fn(str.data);
            const utf8_str = try str.string(allocator);
            defer allocator.free(utf8_str);
            return hash_fn(utf8_str);
        },
        else => return null,
    }
}

pub inline fn asStringCloned(expr: *const Expr, allocator: std.mem.Allocator) OOM!?string {
    switch (expr.data) {
        .e_string => |str| return try str.stringCloned(allocator),
        else => return null,
    }
}

pub inline fn asStringZ(expr: *const Expr, allocator: std.mem.Allocator) OOM!?stringZ {
    switch (expr.data) {
        .e_string => |str| return try str.stringZ(allocator),
        else => return null,
    }
}

pub fn asBool(
    expr: *const Expr,
) ?bool {
    return switch (expr.data) {
        .e_boolean, .e_branch_boolean => |b| b.value,
        else => null,
    };
}

pub fn asNumber(expr: *const Expr) ?f64 {
    if (expr.data != .e_number) return null;

    return expr.data.e_number.value;
}

pub const EFlags = enum { none, ts_decorator };

const Serializable = struct {
    type: Tag,
    object: string,
    value: Data,
    loc: logger.Loc,
};

pub fn isMissing(a: *const Expr) bool {
    return a.data == Expr.Tag.e_missing;
}

// The goal of this function is to "rotate" the AST if it's possible to use the
// left-associative property of the operator to avoid unnecessary parentheses.
//
// When using this, make absolutely sure that the operator is actually
// associative. For example, the "-" operator is not associative for
// floating-point numbers.
pub fn joinWithLeftAssociativeOp(
    comptime op: Op.Code,
    a: Expr,
    b: Expr,
    allocator: std.mem.Allocator,
) Expr {
    // "(a, b) op c" => "a, b op c"
    switch (a.data) {
        .e_binary => |comma| {
            if (comma.op == .bin_comma) {
                comma.right = joinWithLeftAssociativeOp(op, comma.right, b, allocator);
            }
        },
        else => {},
    }

    // "a op (b op c)" => "(a op b) op c"
    // "a op (b op (c op d))" => "((a op b) op c) op d"
    switch (b.data) {
        .e_binary => |binary| {
            if (binary.op == op) {
                return joinWithLeftAssociativeOp(
                    op,
                    joinWithLeftAssociativeOp(op, a, binary.left, allocator),
                    binary.right,
                    allocator,
                );
            }
        },
        else => {},
    }

    // "a op b" => "a op b"
    // "(a op b) op c" => "(a op b) op c"
    return Expr.init(E.Binary, E.Binary{ .op = op, .left = a, .right = b }, a.loc);
}

pub fn joinWithComma(a: Expr, b: Expr, _: std.mem.Allocator) Expr {
    if (a.isMissing()) {
        return b;
    }

    if (b.isMissing()) {
        return a;
    }

    return Expr.init(E.Binary, E.Binary{ .op = .bin_comma, .left = a, .right = b }, a.loc);
}

pub fn joinAllWithComma(all: []Expr, allocator: std.mem.Allocator) Expr {
    bun.assert(all.len > 0);
    switch (all.len) {
        1 => {
            return all[0];
        },
        2 => {
            return Expr.joinWithComma(all[0], all[1], allocator);
        },
        else => {
            var expr = all[0];
            for (1..all.len) |i| {
                expr = Expr.joinWithComma(expr, all[i], allocator);
            }
            return expr;
        },
    }
}

pub fn joinAllWithCommaCallback(all: []Expr, comptime Context: type, ctx: Context, comptime callback: (fn (ctx: anytype, expr: Expr) ?Expr), allocator: std.mem.Allocator) ?Expr {
    switch (all.len) {
        0 => return null,
        1 => {
            return callback(ctx, all[0]);
        },
        2 => {
            const result = Expr.joinWithComma(
                callback(ctx, all[0]) orelse Expr{
                    .data = .{ .e_missing = .{} },
                    .loc = all[0].loc,
                },
                callback(ctx, all[1]) orelse Expr{
                    .data = .{ .e_missing = .{} },
                    .loc = all[1].loc,
                },
                allocator,
            );
            if (result.isMissing()) {
                return null;
            }
            return result;
        },
        else => {
            var i: usize = 1;
            var expr = callback(ctx, all[0]) orelse Expr{
                .data = .{ .e_missing = .{} },
                .loc = all[0].loc,
            };

            while (i < all.len) : (i += 1) {
                expr = Expr.joinWithComma(expr, callback(ctx, all[i]) orelse Expr{
                    .data = .{ .e_missing = .{} },
                    .loc = all[i].loc,
                }, allocator);
            }

            if (expr.isMissing()) {
                return null;
            }
            return expr;
        },
    }
}

pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
    return try writer.write(Serializable{ .type = std.meta.activeTag(self.data), .object = "expr", .value = self.data, .loc = self.loc });
}

pub fn extractNumericValuesInSafeRange(left: Expr.Data, right: Expr.Data) ?[2]f64 {
    const l_value = left.extractNumericValue() orelse return null;
    const r_value = right.extractNumericValue() orelse return null;

    // Check for NaN and return null if either value is NaN
    if (std.math.isNan(l_value) or std.math.isNan(r_value)) {
        return null;
    }

    if (std.math.isInf(l_value) or std.math.isInf(r_value)) {
        return .{ l_value, r_value };
    }

    if (l_value > bun.jsc.MAX_SAFE_INTEGER or r_value > bun.jsc.MAX_SAFE_INTEGER) {
        return null;
    }
    if (l_value < bun.jsc.MIN_SAFE_INTEGER or r_value < bun.jsc.MIN_SAFE_INTEGER) {
        return null;
    }

    return .{ l_value, r_value };
}

pub fn extractNumericValues(left: Expr.Data, right: Expr.Data) ?[2]f64 {
    return .{
        left.extractNumericValue() orelse return null,
        right.extractNumericValue() orelse return null,
    };
}

pub fn extractStringValues(left: Expr.Data, right: Expr.Data, allocator: std.mem.Allocator) ?[2]*E.String {
    const l_string = left.extractStringValue() orelse return null;
    const r_string = right.extractStringValue() orelse return null;
    l_string.resolveRopeIfNeeded(allocator);
    r_string.resolveRopeIfNeeded(allocator);

    if (l_string.isUTF8() != r_string.isUTF8()) return null;

    return .{
        l_string,
        r_string,
    };
}

pub var icount: usize = 0;

// We don't need to dynamically allocate booleans
var true_bool = E.Boolean{ .value = true };
var false_bool = E.Boolean{ .value = false };
var bool_values = [_]*E.Boolean{ &false_bool, &true_bool };

/// When the lifetime of an Expr.Data's pointer must exist longer than reset() is called, use this function.
/// Be careful to free the memory (or use an allocator that does it for you)
/// Also, prefer Expr.init or Expr.alloc when possible. This will be slower.
pub fn allocate(allocator: std.mem.Allocator, comptime Type: type, st: Type, loc: logger.Loc) Expr {
    icount += 1;
    Data.Store.assert();

    switch (Type) {
        E.Array => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_array = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Class => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_class = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Unary => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_unary = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Binary => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_binary = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.This => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_this = st,
                },
            };
        },
        E.Boolean => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_boolean = st,
                },
            };
        },
        E.Super => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_super = st,
                },
            };
        },
        E.Null => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_null = st,
                },
            };
        },
        E.Undefined => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_undefined = st,
                },
            };
        },
        E.New => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_new = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.NewTarget => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_new_target = st,
                },
            };
        },
        E.Function => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_function = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.ImportMeta => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_import_meta = st,
                },
            };
        },
        E.Call => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_call = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Dot => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_dot = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Index => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_index = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Arrow => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_arrow = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Identifier => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_identifier = E.Identifier{
                        .ref = st.ref,
                        .must_keep_due_to_with_stmt = st.must_keep_due_to_with_stmt,
                        .can_be_removed_if_unused = st.can_be_removed_if_unused,
                        .call_can_be_unwrapped_if_unused = st.call_can_be_unwrapped_if_unused,
                    },
                },
            };
        },
        E.ImportIdentifier => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_import_identifier = .{
                        .ref = st.ref,
                        .was_originally_identifier = st.was_originally_identifier,
                    },
                },
            };
        },
        E.CommonJSExportIdentifier => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_commonjs_export_identifier = .{
                        .ref = st.ref,
                    },
                },
            };
        },

        E.PrivateIdentifier => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_private_identifier = st,
                },
            };
        },
        E.JSXElement => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_jsx_element = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Missing => {
            return Expr{ .loc = loc, .data = Data{ .e_missing = E.Missing{} } };
        },
        E.Number => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_number = st,
                },
            };
        },
        E.BigInt => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_big_int = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Object => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_object = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Spread => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_spread = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.String => {
            if (comptime Environment.isDebug) {
                // Sanity check: assert string is not a null ptr
                if (st.data.len > 0 and st.isUTF8()) {
                    bun.assert(@intFromPtr(st.data.ptr) > 0);
                }
            }
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_string = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },

        E.Template => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_template = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.RegExp => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_reg_exp = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Await => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_await = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.Yield => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_yield = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.If => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_if = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.RequireResolveString => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_require_resolve_string = st,
                },
            };
        },
        E.Import => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_import = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st;
                        break :brk item;
                    },
                },
            };
        },
        E.RequireString => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_require_string = st,
                },
            };
        },
        *E.String => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_string = brk: {
                        const item = allocator.create(Type) catch unreachable;
                        item.* = st.*;
                        break :brk item;
                    },
                },
            };
        },

        else => {
            @compileError("Invalid type passed to Expr.init: " ++ @typeName(Type));
        },
    }
}

pub const Disabler = bun.DebugOnlyDisabler(@This());

pub fn init(comptime Type: type, st: Type, loc: logger.Loc) Expr {
    icount += 1;
    Data.Store.assert();

    switch (Type) {
        E.NameOfSymbol => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_name_of_symbol = Data.Store.append(E.NameOfSymbol, st),
                },
            };
        },
        E.Array => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_array = Data.Store.append(Type, st),
                },
            };
        },
        E.Class => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_class = Data.Store.append(Type, st),
                },
            };
        },
        E.Unary => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_unary = Data.Store.append(Type, st),
                },
            };
        },
        E.Binary => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_binary = Data.Store.append(Type, st),
                },
            };
        },
        E.This => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_this = st,
                },
            };
        },
        E.Boolean => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_boolean = st,
                },
            };
        },
        E.Super => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_super = st,
                },
            };
        },
        E.Null => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_null = st,
                },
            };
        },
        E.Undefined => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_undefined = st,
                },
            };
        },
        E.New => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_new = Data.Store.append(Type, st),
                },
            };
        },
        E.NewTarget => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_new_target = st,
                },
            };
        },
        E.Function => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_function = Data.Store.append(Type, st),
                },
            };
        },
        E.ImportMeta => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_import_meta = st,
                },
            };
        },
        E.Call => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_call = Data.Store.append(Type, st),
                },
            };
        },
        E.Dot => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_dot = Data.Store.append(Type, st),
                },
            };
        },
        E.Index => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_index = Data.Store.append(Type, st),
                },
            };
        },
        E.Arrow => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_arrow = Data.Store.append(Type, st),
                },
            };
        },
        E.Identifier => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_identifier = E.Identifier{
                        .ref = st.ref,
                        .must_keep_due_to_with_stmt = st.must_keep_due_to_with_stmt,
                        .can_be_removed_if_unused = st.can_be_removed_if_unused,
                        .call_can_be_unwrapped_if_unused = st.call_can_be_unwrapped_if_unused,
                    },
                },
            };
        },
        E.ImportIdentifier => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_import_identifier = .{
                        .ref = st.ref,
                        .was_originally_identifier = st.was_originally_identifier,
                    },
                },
            };
        },
        E.CommonJSExportIdentifier => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_commonjs_export_identifier = .{
                        .ref = st.ref,
                        .base = st.base,
                    },
                },
            };
        },
        E.PrivateIdentifier => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_private_identifier = st,
                },
            };
        },
        E.JSXElement => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_jsx_element = Data.Store.append(Type, st),
                },
            };
        },
        E.Missing => {
            return Expr{ .loc = loc, .data = Data{ .e_missing = E.Missing{} } };
        },
        E.Number => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_number = st,
                },
            };
        },
        E.BigInt => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_big_int = Data.Store.append(Type, st),
                },
            };
        },
        E.Object => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_object = Data.Store.append(Type, st),
                },
            };
        },
        E.Spread => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_spread = Data.Store.append(Type, st),
                },
            };
        },
        E.String => {
            if (comptime Environment.isDebug) {
                // Sanity check: assert string is not a null ptr
                if (st.data.len > 0 and st.isUTF8()) {
                    bun.assert(@intFromPtr(st.data.ptr) > 0);
                }
            }
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_string = Data.Store.append(Type, st),
                },
            };
        },

        E.Template => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_template = Data.Store.append(Type, st),
                },
            };
        },
        E.RegExp => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_reg_exp = Data.Store.append(Type, st),
                },
            };
        },
        E.Await => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_await = Data.Store.append(Type, st),
                },
            };
        },
        E.Yield => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_yield = Data.Store.append(Type, st),
                },
            };
        },
        E.If => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_if = Data.Store.append(Type, st),
                },
            };
        },
        E.RequireResolveString => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_require_resolve_string = st,
                },
            };
        },
        E.Import => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_import = Data.Store.append(Type, st),
                },
            };
        },
        E.RequireString => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_require_string = st,
                },
            };
        },
        *E.String => {
            return Expr{
                .loc = loc,
                .data = Data{
                    .e_string = Data.Store.append(@TypeOf(st.*), st.*),
                },
            };
        },
        E.InlinedEnum => return .{ .loc = loc, .data = .{
            .e_inlined_enum = Data.Store.append(@TypeOf(st), st),
        } },

        else => {
            @compileError("Invalid type passed to Expr.init: " ++ @typeName(Type));
        },
    }
}

/// If this returns true, then calling this expression captures the target of
/// the property access as "this" when calling the function in the property.
pub inline fn isPropertyAccess(this: *const Expr) bool {
    return this.hasValueForThisInCall();
}

pub inline fn isPrimitiveLiteral(this: *const Expr) bool {
    return @as(Tag, this.data).isPrimitiveLiteral();
}

pub inline fn isRef(this: *const Expr, ref: Ref) bool {
    return switch (this.data) {
        .e_import_identifier => |import_identifier| import_identifier.ref.eql(ref),
        .e_identifier => |ident| ident.ref.eql(ref),
        else => false,
    };
}

pub const Tag = enum {
    e_array,
    e_unary,
    e_binary,
    e_class,
    e_new,
    e_function,
    e_call,
    e_dot,
    e_index,
    e_arrow,
    e_jsx_element,
    e_object,
    e_spread,
    e_template,
    e_reg_exp,
    e_await,
    e_yield,
    e_if,
    e_import,
    e_identifier,
    e_import_identifier,
    e_private_identifier,
    e_commonjs_export_identifier,
    e_boolean,
    /// Like e_boolean, but produced by `feature()` from `bun:bundle`.
    /// This tag ensures feature() can only be used directly in conditional
    /// contexts (if statements, ternaries). Invalid usage is caught during
    /// the visit phase when this expression appears outside a branch condition.
    e_branch_boolean,
    e_number,
    e_big_int,
    e_string,
    e_require_string,
    e_require_resolve_string,
    e_require_call_target,
    e_require_resolve_call_target,
    e_missing,
    e_this,
    e_super,
    e_null,
    e_undefined,
    e_new_target,
    e_import_meta,
    e_import_meta_main,
    e_require_main,
    e_special,
    e_inlined_enum,
    e_name_of_symbol,

    // object, regex and array may have had side effects
    pub fn isPrimitiveLiteral(tag: Tag) bool {
        return switch (tag) {
            .e_null, .e_undefined, .e_string, .e_boolean, .e_branch_boolean, .e_number, .e_big_int => true,
            else => false,
        };
    }

    pub fn typeof(tag: Tag) ?string {
        return switch (tag) {
            .e_array, .e_object, .e_null, .e_reg_exp => "object",
            .e_undefined => "undefined",
            .e_boolean, .e_branch_boolean => "boolean",
            .e_number => "number",
            .e_big_int => "bigint",
            .e_string => "string",
            .e_class, .e_function, .e_arrow => "function",
            else => null,
        };
    }

    pub fn format(tag: Tag, writer: *std.Io.Writer) !void {
        try switch (tag) {
            .e_string => writer.writeAll("string"),
            .e_array => writer.writeAll("array"),
            .e_unary => writer.writeAll("unary"),
            .e_binary => writer.writeAll("binary"),
            .e_boolean, .e_branch_boolean => writer.writeAll("boolean"),
            .e_super => writer.writeAll("super"),
            .e_null => writer.writeAll("null"),
            .e_undefined => writer.writeAll("undefined"),
            .e_new => writer.writeAll("new"),
            .e_function => writer.writeAll("function"),
            .e_new_target => writer.writeAll("new target"),
            .e_import_meta => writer.writeAll("import.meta"),
            .e_call => writer.writeAll("call"),
            .e_dot => writer.writeAll("dot"),
            .e_index => writer.writeAll("index"),
            .e_arrow => writer.writeAll("arrow"),
            .e_identifier => writer.writeAll("identifier"),
            .e_import_identifier => writer.writeAll("import identifier"),
            .e_private_identifier => writer.writeAll("#privateIdentifier"),
            .e_jsx_element => writer.writeAll("<jsx>"),
            .e_missing => writer.writeAll("<missing>"),
            .e_number => writer.writeAll("number"),
            .e_big_int => writer.writeAll("BigInt"),
            .e_object => writer.writeAll("object"),
            .e_spread => writer.writeAll("..."),
            .e_template => writer.writeAll("template"),
            .e_reg_exp => writer.writeAll("regexp"),
            .e_await => writer.writeAll("await"),
            .e_yield => writer.writeAll("yield"),
            .e_if => writer.writeAll("if"),
            .e_require_resolve_string => writer.writeAll("require_or_require_resolve"),
            .e_import => writer.writeAll("import"),
            .e_this => writer.writeAll("this"),
            .e_class => writer.writeAll("class"),
            .e_require_string => writer.writeAll("require"),
            else => writer.writeAll(@tagName(tag)),
        };
    }

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }

    pub fn isArray(self: Tag) bool {
        switch (self) {
            .e_array => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isUnary(self: Tag) bool {
        switch (self) {
            .e_unary => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isBinary(self: Tag) bool {
        switch (self) {
            .e_binary => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isThis(self: Tag) bool {
        switch (self) {
            .e_this => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isClass(self: Tag) bool {
        switch (self) {
            .e_class => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isBoolean(self: Tag) bool {
        return self == .e_boolean or self == .e_branch_boolean;
    }
    pub fn isSuper(self: Tag) bool {
        switch (self) {
            .e_super => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isNull(self: Tag) bool {
        switch (self) {
            .e_null => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isUndefined(self: Tag) bool {
        switch (self) {
            .e_undefined => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isNew(self: Tag) bool {
        switch (self) {
            .e_new => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isNewTarget(self: Tag) bool {
        switch (self) {
            .e_new_target => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isFunction(self: Tag) bool {
        switch (self) {
            .e_function => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isImportMeta(self: Tag) bool {
        switch (self) {
            .e_import_meta => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isCall(self: Tag) bool {
        switch (self) {
            .e_call => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isDot(self: Tag) bool {
        switch (self) {
            .e_dot => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isIndex(self: Tag) bool {
        switch (self) {
            .e_index => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isArrow(self: Tag) bool {
        switch (self) {
            .e_arrow => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isIdentifier(self: Tag) bool {
        switch (self) {
            .e_identifier => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isImportIdentifier(self: Tag) bool {
        switch (self) {
            .e_import_identifier => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isPrivateIdentifier(self: Tag) bool {
        switch (self) {
            .e_private_identifier => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isJsxElement(self: Tag) bool {
        switch (self) {
            .e_jsx_element => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isMissing(self: Tag) bool {
        switch (self) {
            .e_missing => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isNumber(self: Tag) bool {
        switch (self) {
            .e_number => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isBigInt(self: Tag) bool {
        switch (self) {
            .e_big_int => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isObject(self: Tag) bool {
        switch (self) {
            .e_object => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isSpread(self: Tag) bool {
        switch (self) {
            .e_spread => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isString(self: Tag) bool {
        switch (self) {
            .e_string => {
                return true;
            },
            else => {
                return false;
            },
        }
    }

    pub fn isTemplate(self: Tag) bool {
        switch (self) {
            .e_template => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isRegExp(self: Tag) bool {
        switch (self) {
            .e_reg_exp => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isAwait(self: Tag) bool {
        switch (self) {
            .e_await => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isYield(self: Tag) bool {
        switch (self) {
            .e_yield => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isIf(self: Tag) bool {
        switch (self) {
            .e_if => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isRequireResolveString(self: Tag) bool {
        switch (self) {
            .e_require_resolve_string => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
    pub fn isImport(self: Tag) bool {
        switch (self) {
            .e_import => {
                return true;
            },
            else => {
                return false;
            },
        }
    }
};

pub fn isBoolean(a: *const Expr) bool {
    return switch (a.data) {
        .e_boolean, .e_branch_boolean => true,
        .e_if => |ex| ex.yes.isBoolean() and ex.no.isBoolean(),
        .e_unary => |ex| ex.op == .un_not or ex.op == .un_delete,
        .e_binary => |ex| switch (ex.op) {
            .bin_strict_eq, .bin_strict_ne, .bin_loose_eq, .bin_loose_ne, .bin_lt, .bin_gt, .bin_le, .bin_ge, .bin_instanceof, .bin_in => true,
            .bin_logical_or => ex.left.isBoolean() and ex.right.isBoolean(),
            .bin_logical_and => ex.left.isBoolean() and ex.right.isBoolean(),
            else => false,
        },
        else => false,
    };
}

pub fn assign(a: Expr, b: Expr) Expr {
    return init(E.Binary, E.Binary{
        .op = .bin_assign,
        .left = a,
        .right = b,
    }, a.loc);
}
pub inline fn at(expr: *const Expr, comptime Type: type, t: Type, _: std.mem.Allocator) Expr {
    return init(Type, t, expr.loc);
}

// Wraps the provided expression in the "!" prefix operator. The expression
// will potentially be simplified to avoid generating unnecessary extra "!"
// operators. For example, calling this with "!!x" will return "!x" instead
// of returning "!!!x".
pub fn not(expr: *const Expr, allocator: std.mem.Allocator) Expr {
    return expr.maybeSimplifyNot(allocator) orelse
        Expr.init(
            E.Unary,
            E.Unary{
                .op = .un_not,
                .value = expr.*,
            },
            expr.loc,
        );
}

pub inline fn hasValueForThisInCall(expr: *const Expr) bool {
    return switch (expr.data) {
        .e_dot, .e_index => true,
        else => false,
    };
}

/// The given "expr" argument should be the operand of a "!" prefix operator
/// (i.e. the "x" in "!x"). This returns a simplified expression for the
/// whole operator (i.e. the "!x") if it can be simplified, or false if not.
/// It's separate from "Not()" above to avoid allocation on failure in case
/// that is undesired.
pub fn maybeSimplifyNot(expr: *const Expr, allocator: std.mem.Allocator) ?Expr {
    switch (expr.data) {
        .e_null, .e_undefined => {
            return expr.at(E.Boolean, E.Boolean{ .value = true }, allocator);
        },
        .e_boolean, .e_branch_boolean => |b| {
            return expr.at(E.Boolean, E.Boolean{ .value = !b.value }, allocator);
        },
        .e_number => |n| {
            return expr.at(E.Boolean, E.Boolean{ .value = (n.value == 0 or std.math.isNan(n.value)) }, allocator);
        },
        .e_big_int => |b| {
            return expr.at(E.Boolean, E.Boolean{ .value = strings.eqlComptime(b.value, "0") }, allocator);
        },
        .e_function,
        .e_arrow,
        .e_reg_exp,
        => {
            return expr.at(E.Boolean, E.Boolean{ .value = false }, allocator);
        },
        // "!!!a" => "!a"
        .e_unary => |un| {
            if (un.op == Op.Code.un_not and un.value.knownPrimitive() == .boolean) {
                return un.value;
            }
        },
        .e_binary => |ex| {
            // TODO: evaluate whether or not it is safe to do this mutation since it's modifying in-place.
            // Make sure that these transformations are all safe for special values.
            // For example, "!(a < b)" is not the same as "a >= b" if a and/or b are
            // NaN (or undefined, or null, or possibly other problem cases too).
            switch (ex.op) {
                Op.Code.bin_loose_eq => {
                    // "!(a == b)" => "a != b"
                    ex.op = .bin_loose_ne;
                    return expr.*;
                },
                Op.Code.bin_loose_ne => {
                    // "!(a != b)" => "a == b"
                    ex.op = .bin_loose_eq;
                    return expr.*;
                },
                Op.Code.bin_strict_eq => {
                    // "!(a === b)" => "a !== b"
                    ex.op = .bin_strict_ne;
                    return expr.*;
                },
                Op.Code.bin_strict_ne => {
                    // "!(a !== b)" => "a === b"
                    ex.op = .bin_strict_eq;
                    return expr.*;
                },
                Op.Code.bin_comma => {
                    // "!(a, b)" => "a, !b"
                    ex.right = ex.right.not(allocator);
                    return expr.*;
                },
                else => {},
            }
        },
        .e_inlined_enum => |inlined| {
            return inlined.value.maybeSimplifyNot(allocator);
        },

        else => {},
    }

    return null;
}

pub fn toStringExprWithoutSideEffects(expr: *const Expr, allocator: std.mem.Allocator) ?Expr {
    const unwrapped = expr.unwrapInlined();
    const slice = switch (unwrapped.data) {
        .e_null => "null",
        .e_string => return expr.*,
        .e_undefined => "undefined",
        .e_boolean, .e_branch_boolean => |data| if (data.value) "true" else "false",
        .e_big_int => |bigint| bigint.value,
        .e_number => |num| if (num.toString(allocator)) |str|
            str
        else
            null,
        .e_reg_exp => |regexp| regexp.value,
        .e_dot => |dot| @as(?[]const u8, brk: {
            // This is dumb but some JavaScript obfuscators use this to generate string literals
            if (bun.strings.eqlComptime(dot.name, "constructor")) {
                break :brk switch (dot.target.data) {
                    .e_string => "function String() { [native code] }",
                    .e_reg_exp => "function RegExp() { [native code] }",
                    else => null,
                };
            }
            break :brk null;
        }),
        else => null,
    };
    return if (slice) |s| Expr.init(E.String, E.String.init(s), expr.loc) else null;
}

pub fn isOptionalChain(self: *const @This()) bool {
    return switch (self.data) {
        .e_dot => self.data.e_dot.optional_chain != null,
        .e_index => self.data.e_index.optional_chain != null,
        .e_call => self.data.e_call.optional_chain != null,
        else => false,
    };
}

pub inline fn knownPrimitive(self: *const @This()) PrimitiveType {
    return self.data.knownPrimitive();
}

pub const PrimitiveType = enum {
    unknown,
    mixed,
    null,
    undefined,
    boolean,
    number,
    string,
    bigint,

    pub const static = std.enums.EnumSet(PrimitiveType).init(.{
        .mixed = true,
        .null = true,
        .undefined = true,
        .boolean = true,
        .number = true,
        .string = true,
        // for our purposes, bigint is dynamic
        // it is technically static though
        // .@"bigint" = true,
    });

    pub inline fn isStatic(this: PrimitiveType) bool {
        return static.contains(this);
    }

    pub fn merge(left_known: PrimitiveType, right_known: PrimitiveType) PrimitiveType {
        if (right_known == .unknown or left_known == .unknown)
            return .unknown;

        return if (left_known == right_known)
            left_known
        else
            .mixed;
    }
};

pub const Data = union(Tag) {
    e_array: *E.Array,
    e_unary: *E.Unary,
    e_binary: *E.Binary,
    e_class: *E.Class,

    e_new: *E.New,
    e_function: *E.Function,
    e_call: *E.Call,
    e_dot: *E.Dot,
    e_index: *E.Index,
    e_arrow: *E.Arrow,

    e_jsx_element: *E.JSXElement,
    e_object: *E.Object,
    e_spread: *E.Spread,
    e_template: *E.Template,
    e_reg_exp: *E.RegExp,
    e_await: *E.Await,
    e_yield: *E.Yield,
    e_if: *E.If,
    e_import: *E.Import,

    e_identifier: E.Identifier,
    e_import_identifier: E.ImportIdentifier,
    e_private_identifier: E.PrivateIdentifier,
    e_commonjs_export_identifier: E.CommonJSExportIdentifier,

    e_boolean: E.Boolean,
    e_branch_boolean: E.Boolean,
    e_number: E.Number,
    e_big_int: *E.BigInt,
    e_string: *E.String,

    e_require_string: E.RequireString,
    e_require_resolve_string: E.RequireResolveString,
    e_require_call_target,
    e_require_resolve_call_target,

    e_missing: E.Missing,
    e_this: E.This,
    e_super: E.Super,
    e_null: E.Null,
    e_undefined: E.Undefined,
    e_new_target: E.NewTarget,
    e_import_meta: E.ImportMeta,

    e_import_meta_main: E.ImportMetaMain,
    e_require_main,

    /// Covers some exotic AST node types under one namespace, since the
    /// places this is found it all follows similar handling.
    e_special: E.Special,

    e_inlined_enum: *E.InlinedEnum,

    e_name_of_symbol: *E.NameOfSymbol,

    comptime {
        bun.assert_eql(@sizeOf(Data), 24); // Do not increase the size of Expr
    }

    pub fn as(data: Data, comptime tag: Tag) ?@FieldType(Data, @tagName(tag)) {
        return if (data == tag) @field(data, @tagName(tag)) else null;
    }

    pub fn clone(this: Expr.Data, allocator: std.mem.Allocator) !Data {
        return switch (this) {
            .e_array => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_array)));
                item.* = el.*;
                return .{ .e_array = item };
            },
            .e_unary => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_unary)));
                item.* = el.*;
                return .{ .e_unary = item };
            },
            .e_binary => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_binary)));
                item.* = el.*;
                return .{ .e_binary = item };
            },
            .e_class => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_class)));
                item.* = el.*;
                return .{ .e_class = item };
            },
            .e_new => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_new)));
                item.* = el.*;
                return .{ .e_new = item };
            },
            .e_function => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_function)));
                item.* = el.*;
                return .{ .e_function = item };
            },
            .e_call => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_call)));
                item.* = el.*;
                return .{ .e_call = item };
            },
            .e_dot => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_dot)));
                item.* = el.*;
                return .{ .e_dot = item };
            },
            .e_index => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_index)));
                item.* = el.*;
                return .{ .e_index = item };
            },
            .e_arrow => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_arrow)));
                item.* = el.*;
                return .{ .e_arrow = item };
            },
            .e_jsx_element => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_jsx_element)));
                item.* = el.*;
                return .{ .e_jsx_element = item };
            },
            .e_object => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_object)));
                item.* = el.*;
                return .{ .e_object = item };
            },
            .e_spread => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_spread)));
                item.* = el.*;
                return .{ .e_spread = item };
            },
            .e_template => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_template)));
                item.* = el.*;
                return .{ .e_template = item };
            },
            .e_reg_exp => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_reg_exp)));
                item.* = el.*;
                return .{ .e_reg_exp = item };
            },
            .e_await => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_await)));
                item.* = el.*;
                return .{ .e_await = item };
            },
            .e_yield => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_yield)));
                item.* = el.*;
                return .{ .e_yield = item };
            },
            .e_if => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_if)));
                item.* = el.*;
                return .{ .e_if = item };
            },
            .e_import => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_import)));
                item.* = el.*;
                return .{ .e_import = item };
            },
            .e_big_int => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_big_int)));
                item.* = el.*;
                return .{ .e_big_int = item };
            },
            .e_string => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_string)));
                item.* = el.*;
                return .{ .e_string = item };
            },
            .e_inlined_enum => |el| {
                const item = try allocator.create(std.meta.Child(@TypeOf(this.e_inlined_enum)));
                item.* = el.*;
                return .{ .e_inlined_enum = item };
            },
            else => this,
        };
    }

    pub fn deepClone(this: Expr.Data, allocator: std.mem.Allocator) !Data {
        return switch (this) {
            .e_array => |el| {
                const items = try el.items.deepClone(allocator);
                const item = bun.create(allocator, E.Array, .{
                    .items = items,
                    .comma_after_spread = el.comma_after_spread,
                    .was_originally_macro = el.was_originally_macro,
                    .is_single_line = el.is_single_line,
                    .is_parenthesized = el.is_parenthesized,
                    .close_bracket_loc = el.close_bracket_loc,
                });
                return .{ .e_array = item };
            },
            .e_unary => |el| {
                const item = bun.create(allocator, E.Unary, .{
                    .op = el.op,
                    .value = try el.value.deepClone(allocator),
                    .flags = el.flags,
                });
                return .{ .e_unary = item };
            },
            .e_binary => |el| {
                const item = bun.create(allocator, E.Binary, .{
                    .op = el.op,
                    .left = try el.left.deepClone(allocator),
                    .right = try el.right.deepClone(allocator),
                });
                return .{ .e_binary = item };
            },
            .e_class => |el| {
                const properties = try allocator.alloc(G.Property, el.properties.len);
                for (el.properties, 0..) |prop, i| {
                    properties[i] = try prop.deepClone(allocator);
                }

                const item = bun.create(allocator, E.Class, .{
                    .class_keyword = el.class_keyword,
                    .ts_decorators = try el.ts_decorators.deepClone(allocator),
                    .class_name = el.class_name,
                    .extends = if (el.extends) |e| try e.deepClone(allocator) else null,
                    .body_loc = el.body_loc,
                    .close_brace_loc = el.close_brace_loc,
                    .properties = properties,
                    .has_decorators = el.has_decorators,
                });
                return .{ .e_class = item };
            },
            .e_new => |el| {
                const item = bun.create(allocator, E.New, .{
                    .target = try el.target.deepClone(allocator),
                    .args = try el.args.deepClone(allocator),
                    .can_be_unwrapped_if_unused = el.can_be_unwrapped_if_unused,
                    .close_parens_loc = el.close_parens_loc,
                });

                return .{ .e_new = item };
            },
            .e_function => |el| {
                const item = bun.create(allocator, E.Function, .{
                    .func = try el.func.deepClone(allocator),
                });
                return .{ .e_function = item };
            },
            .e_call => |el| {
                const item = bun.create(allocator, E.Call, .{
                    .target = try el.target.deepClone(allocator),
                    .args = try el.args.deepClone(allocator),
                    .optional_chain = el.optional_chain,
                    .is_direct_eval = el.is_direct_eval,
                    .close_paren_loc = el.close_paren_loc,
                    .can_be_unwrapped_if_unused = el.can_be_unwrapped_if_unused,
                    .was_jsx_element = el.was_jsx_element,
                });
                return .{ .e_call = item };
            },
            .e_dot => |el| {
                const item = bun.create(allocator, E.Dot, .{
                    .target = try el.target.deepClone(allocator),
                    .name = el.name,
                    .name_loc = el.name_loc,
                    .optional_chain = el.optional_chain,
                    .can_be_removed_if_unused = el.can_be_removed_if_unused,
                    .call_can_be_unwrapped_if_unused = el.call_can_be_unwrapped_if_unused,
                });
                return .{ .e_dot = item };
            },
            .e_index => |el| {
                const item = bun.create(allocator, E.Index, .{
                    .target = try el.target.deepClone(allocator),
                    .index = try el.index.deepClone(allocator),
                    .optional_chain = el.optional_chain,
                });
                return .{ .e_index = item };
            },
            .e_arrow => |el| {
                const args = try allocator.alloc(G.Arg, el.args.len);
                for (0..args.len) |i| {
                    args[i] = try el.args[i].deepClone(allocator);
                }
                const item = bun.create(allocator, E.Arrow, .{
                    .args = args,
                    .body = el.body,
                    .is_async = el.is_async,
                    .has_rest_arg = el.has_rest_arg,
                    .prefer_expr = el.prefer_expr,
                });

                return .{ .e_arrow = item };
            },
            .e_jsx_element => |el| {
                const item = bun.create(allocator, E.JSXElement, .{
                    .tag = if (el.tag) |tag| try tag.deepClone(allocator) else null,
                    .properties = try el.properties.deepClone(allocator),
                    .children = try el.children.deepClone(allocator),
                    .key_prop_index = el.key_prop_index,
                    .flags = el.flags,
                    .close_tag_loc = el.close_tag_loc,
                });
                return .{ .e_jsx_element = item };
            },
            .e_object => |el| {
                const item = bun.create(allocator, E.Object, .{
                    .properties = try el.properties.deepClone(allocator),
                    .comma_after_spread = el.comma_after_spread,
                    .is_single_line = el.is_single_line,
                    .is_parenthesized = el.is_parenthesized,
                    .was_originally_macro = el.was_originally_macro,
                    .close_brace_loc = el.close_brace_loc,
                });
                return .{ .e_object = item };
            },
            .e_spread => |el| {
                const item = bun.create(allocator, E.Spread, .{
                    .value = try el.value.deepClone(allocator),
                });
                return .{ .e_spread = item };
            },
            .e_template => |el| {
                const item = bun.create(allocator, E.Template, .{
                    .tag = if (el.tag) |tag| try tag.deepClone(allocator) else null,
                    .parts = el.parts,
                    .head = el.head,
                });
                return .{ .e_template = item };
            },
            .e_reg_exp => |el| {
                const item = bun.create(allocator, E.RegExp, .{
                    .value = el.value,
                    .flags_offset = el.flags_offset,
                });
                return .{ .e_reg_exp = item };
            },
            .e_await => |el| {
                const item = bun.create(allocator, E.Await, .{
                    .value = try el.value.deepClone(allocator),
                });
                return .{ .e_await = item };
            },
            .e_yield => |el| {
                const item = bun.create(allocator, E.Yield, .{
                    .value = if (el.value) |value| try value.deepClone(allocator) else null,
                    .is_star = el.is_star,
                });
                return .{ .e_yield = item };
            },
            .e_if => |el| {
                const item = bun.create(allocator, E.If, .{
                    .test_ = try el.test_.deepClone(allocator),
                    .yes = try el.yes.deepClone(allocator),
                    .no = try el.no.deepClone(allocator),
                });
                return .{ .e_if = item };
            },
            .e_import => |el| {
                const item = bun.create(allocator, E.Import, .{
                    .expr = try el.expr.deepClone(allocator),
                    .options = try el.options.deepClone(allocator),
                    .import_record_index = el.import_record_index,
                });
                return .{ .e_import = item };
            },
            .e_big_int => |el| {
                const item = bun.create(allocator, E.BigInt, .{
                    .value = el.value,
                });
                return .{ .e_big_int = item };
            },
            .e_string => |el| {
                const item = bun.create(allocator, E.String, .{
                    .data = el.data,
                    .prefer_template = el.prefer_template,
                    .next = el.next,
                    .end = el.end,
                    .rope_len = el.rope_len,
                    .is_utf16 = el.is_utf16,
                });
                return .{ .e_string = item };
            },
            .e_inlined_enum => |el| {
                const item = bun.create(allocator, E.InlinedEnum, .{
                    .value = el.value,
                    .comment = el.comment,
                });
                return .{ .e_inlined_enum = item };
            },
            else => this,
        };
    }

    /// `hasher` should be something with 'pub fn update([]const u8) void';
    /// symbol table is passed to serialize `Ref` as an identifier names instead of a nondeterministic numbers
    pub fn writeToHasher(this: Expr.Data, hasher: anytype, symbol_table: anytype) void {
        writeAnyToHasher(hasher, std.meta.activeTag(this));
        switch (this) {
            .e_name_of_symbol => |e| {
                const symbol = e.ref.getSymbol(symbol_table);
                hasher.update(symbol.original_name);
            },
            .e_array => |e| {
                writeAnyToHasher(hasher, .{
                    e.is_single_line,
                    e.is_parenthesized,
                    e.was_originally_macro,
                    e.items.len,
                });
                for (e.items.slice()) |item| {
                    item.data.writeToHasher(hasher, symbol_table);
                }
            },
            .e_unary => |e| {
                writeAnyToHasher(hasher, @as(u8, @bitCast(e.flags)));
                writeAnyToHasher(hasher, .{e.op});
                e.value.data.writeToHasher(hasher, symbol_table);
            },
            .e_binary => |e| {
                writeAnyToHasher(hasher, .{e.op});
                e.left.data.writeToHasher(hasher, symbol_table);
                e.right.data.writeToHasher(hasher, symbol_table);
            },
            .e_class => {},
            inline .e_new, .e_call => {},
            .e_function => {},
            .e_dot => |e| {
                writeAnyToHasher(hasher, .{ e.optional_chain, e.name.len });
                e.target.data.writeToHasher(hasher, symbol_table);
                hasher.update(e.name);
            },
            .e_index => |e| {
                writeAnyToHasher(hasher, .{e.optional_chain});
                e.target.data.writeToHasher(hasher, symbol_table);
                e.index.data.writeToHasher(hasher, symbol_table);
            },
            .e_arrow => {},
            .e_jsx_element => |e| {
                _ = e; // autofix
            },
            .e_object => |e| {
                _ = e; // autofix
            },
            inline .e_spread, .e_await => |e| {
                e.value.data.writeToHasher(hasher, symbol_table);
            },
            .e_yield => |e| {
                writeAnyToHasher(hasher, .{ e.is_star, e.value });
                if (e.value) |value|
                    value.data.writeToHasher(hasher, symbol_table);
            },
            .e_template => |e| {
                _ = e; // autofix
            },
            .e_if => |e| {
                _ = e; // autofix
            },
            .e_import => |e| {
                _ = e; // autofix

            },
            inline .e_identifier,
            .e_import_identifier,
            .e_private_identifier,
            .e_commonjs_export_identifier,
            => |e| {
                const symbol = e.ref.getSymbol(symbol_table);
                hasher.update(symbol.original_name);
            },
            inline .e_boolean, .e_branch_boolean, .e_number => |e| {
                writeAnyToHasher(hasher, e.value);
            },
            inline .e_big_int, .e_reg_exp => |e| {
                hasher.update(e.value);
            },

            .e_string => |e| {
                var next: ?*E.String = e;
                if (next) |current| {
                    if (current.isUTF8()) {
                        hasher.update(current.data);
                    } else {
                        hasher.update(bun.reinterpretSlice(u8, current.slice16()));
                    }
                    next = current.next;
                    hasher.update("\x00");
                }
            },
            inline .e_require_string, .e_require_resolve_string => |e| {
                writeAnyToHasher(hasher, e.import_record_index); // preferably, i'd like to write the filepath
            },

            .e_import_meta_main => |e| {
                writeAnyToHasher(hasher, e.inverted);
            },
            .e_inlined_enum => |e| {
                // pretend there is no comment
                e.value.data.writeToHasher(hasher, symbol_table);
            },

            // no data
            .e_require_call_target,
            .e_require_resolve_call_target,
            .e_missing,
            .e_this,
            .e_super,
            .e_null,
            .e_undefined,
            .e_new_target,
            .e_require_main,
            .e_import_meta,
            .e_special,
            => {},
        }
    }

    /// "const values" here refers to expressions that can participate in constant
    /// inlining, as they have no side effects on instantiation, and there would be
    /// no observable difference if duplicated. This is a subset of canBeMoved()
    pub fn canBeConstValue(this: Expr.Data) bool {
        return switch (this) {
            .e_number,
            .e_boolean,
            .e_branch_boolean,
            .e_null,
            .e_undefined,
            .e_inlined_enum,
            => true,
            .e_string => |str| str.next == null,
            .e_array => |array| array.was_originally_macro,
            .e_object => |object| object.was_originally_macro,
            else => false,
        };
    }

    /// Expressions that can be moved are those that do not have side
    /// effects on their own. This is used to determine what can be moved
    /// outside of a module wrapper (__esm/__commonJS).
    pub fn canBeMoved(data: Expr.Data) bool {
        return switch (data) {
            // TODO: identifiers can be removed if unused, however code that
            // moves expressions around sometimes does so incorrectly when
            // doing destructures. test case: https://github.com/oven-sh/bun/issues/14027
            // .e_identifier => |id| id.can_be_removed_if_unused,

            .e_class => |class| class.canBeMoved(),

            .e_arrow,
            .e_function,

            .e_number,
            .e_boolean,
            .e_branch_boolean,
            .e_null,
            .e_undefined,
            // .e_reg_exp,
            .e_big_int,
            .e_string,
            .e_inlined_enum,
            .e_import_meta,
            => true,

            .e_template => |template| template.tag == null and template.parts.len == 0,

            .e_array => |array| array.was_originally_macro,
            .e_object => |object| object.was_originally_macro,

            // TODO: experiment with allowing some e_binary, e_unary, e_if as movable

            else => false,
        };
    }

    pub fn isSafeToString(data: Expr.Data) bool {
        return switch (data) {
            // rope strings can throw when toString is called.
            .e_string => |str| str.next == null,

            .e_number, .e_boolean, .e_branch_boolean, .e_undefined, .e_null => true,
            // BigInt is deliberately excluded as a large enough BigInt could throw an out of memory error.
            //

            else => false,
        };
    }

    pub fn knownPrimitive(data: Expr.Data) PrimitiveType {
        return switch (data) {
            .e_big_int => .bigint,
            .e_boolean, .e_branch_boolean => .boolean,
            .e_null => .null,
            .e_number => .number,
            .e_string => .string,
            .e_undefined => .undefined,
            .e_template => if (data.e_template.tag == null) PrimitiveType.string else PrimitiveType.unknown,
            .e_if => mergeKnownPrimitive(data.e_if.yes.data, data.e_if.no.data),
            .e_binary => |binary| brk: {
                switch (binary.op) {
                    .bin_strict_eq,
                    .bin_strict_ne,
                    .bin_loose_eq,
                    .bin_loose_ne,
                    .bin_lt,
                    .bin_gt,
                    .bin_le,
                    .bin_ge,
                    .bin_instanceof,
                    .bin_in,
                    => break :brk PrimitiveType.boolean,
                    .bin_logical_or, .bin_logical_and => break :brk binary.left.data.mergeKnownPrimitive(binary.right.data),

                    .bin_nullish_coalescing => {
                        const left = binary.left.data.knownPrimitive();
                        const right = binary.right.data.knownPrimitive();
                        if (left == .null or left == .undefined)
                            break :brk right;

                        if (left != .unknown) {
                            if (left != .mixed)
                                break :brk left; // Definitely not null or undefined

                            if (right != .unknown)
                                break :brk PrimitiveType.mixed; // Definitely some kind of primitive
                        }
                    },

                    .bin_add => {
                        const left = binary.left.data.knownPrimitive();
                        const right = binary.right.data.knownPrimitive();

                        if (left == .string or right == .string)
                            break :brk PrimitiveType.string;

                        if (left == .bigint or right == .bigint)
                            break :brk PrimitiveType.bigint;

                        if (switch (left) {
                            .unknown, .mixed, .bigint => false,
                            else => true,
                        } and switch (right) {
                            .unknown, .mixed, .bigint => false,
                            else => true,
                        })
                            break :brk PrimitiveType.number;

                        break :brk PrimitiveType.mixed; // Can be number or bigint or string (or an exception)
                    },

                    .bin_sub,
                    .bin_sub_assign,
                    .bin_mul,
                    .bin_mul_assign,
                    .bin_div,
                    .bin_div_assign,
                    .bin_rem,
                    .bin_rem_assign,
                    .bin_pow,
                    .bin_pow_assign,
                    .bin_bitwise_and,
                    .bin_bitwise_and_assign,
                    .bin_bitwise_or,
                    .bin_bitwise_or_assign,
                    .bin_bitwise_xor,
                    .bin_bitwise_xor_assign,
                    .bin_shl,
                    .bin_shl_assign,
                    .bin_shr,
                    .bin_shr_assign,
                    .bin_u_shr,
                    .bin_u_shr_assign,
                    => break :brk PrimitiveType.mixed, // Can be number or bigint (or an exception)

                    .bin_assign,
                    .bin_comma,
                    => break :brk binary.right.data.knownPrimitive(),

                    else => {},
                }

                break :brk PrimitiveType.unknown;
            },

            .e_unary => switch (data.e_unary.op) {
                .un_void => PrimitiveType.undefined,
                .un_typeof => PrimitiveType.string,
                .un_not, .un_delete => PrimitiveType.boolean,
                .un_pos => PrimitiveType.number, // Cannot be bigint because that throws an exception
                .un_neg, .un_cpl => switch (data.e_unary.value.data.knownPrimitive()) {
                    .bigint => PrimitiveType.bigint,
                    .unknown, .mixed => PrimitiveType.mixed,
                    else => PrimitiveType.number, // Can be number or bigint
                },
                .un_pre_dec, .un_pre_inc, .un_post_dec, .un_post_inc => PrimitiveType.mixed, // Can be number or bigint

                else => PrimitiveType.unknown,
            },

            .e_inlined_enum => |inlined| inlined.value.data.knownPrimitive(),

            else => PrimitiveType.unknown,
        };
    }

    pub fn mergeKnownPrimitive(lhs: Expr.Data, rhs: Expr.Data) PrimitiveType {
        return lhs.knownPrimitive().merge(rhs.knownPrimitive());
    }

    /// Returns true if the result of the "typeof" operator on this expression is
    /// statically determined and this expression has no side effects (i.e. can be
    /// removed without consequence).
    pub inline fn toTypeof(data: Expr.Data) ?string {
        return @as(Expr.Tag, data).typeof();
    }

    pub fn toNumber(data: Expr.Data) ?f64 {
        return switch (data) {
            .e_null => 0,
            .e_undefined => std.math.nan(f64),
            .e_string => |str| {
                if (str.next != null) return null;
                if (!str.isUTF8()) return null;

                // +'1' => 1
                return stringToEquivalentNumberValue(str.slice8());
            },
            .e_boolean, .e_branch_boolean => |b| @as(f64, if (b.value) 1.0 else 0.0),
            .e_number => data.e_number.value,
            .e_inlined_enum => |inlined| switch (inlined.value.data) {
                .e_number => |num| num.value,
                .e_string => |str| {
                    if (str.next != null) return null;
                    if (!str.isUTF8()) return null;

                    // +'1' => 1
                    return stringToEquivalentNumberValue(str.slice8());
                },
                else => null,
            },
            else => null,
        };
    }

    pub fn toFiniteNumber(data: Expr.Data) ?f64 {
        return switch (data) {
            .e_boolean, .e_branch_boolean => |b| @as(f64, if (b.value) 1.0 else 0.0),
            .e_number => if (std.math.isFinite(data.e_number.value))
                data.e_number.value
            else
                null,
            .e_inlined_enum => |inlined| switch (inlined.value.data) {
                .e_number => |num| if (std.math.isFinite(num.value))
                    num.value
                else
                    null,
                else => null,
            },
            else => null,
        };
    }

    pub fn extractNumericValue(data: Expr.Data) ?f64 {
        return switch (data) {
            .e_number => data.e_number.value,
            .e_inlined_enum => |inlined| switch (inlined.value.data) {
                .e_number => |num| num.value,
                else => null,
            },
            else => null,
        };
    }

    pub fn extractStringValue(data: Expr.Data) ?*E.String {
        return switch (data) {
            .e_string => data.e_string,
            .e_inlined_enum => |inlined| switch (inlined.value.data) {
                .e_string => |str| str,
                else => null,
            },
            else => null,
        };
    }

    pub const Equality = struct {
        equal: bool = false,
        ok: bool = false,

        /// This extra flag is unfortunately required for the case of visiting the expression
        /// `require.main === module` (and any combination of !==, ==, !=, either ordering)
        ///
        /// We want to replace this with the dedicated import_meta_main node, which:
        /// - Stops this module from having p.require_ref, allowing conversion to ESM
        /// - Allows us to inline `import.meta.main`'s value, if it is known (bun build --compile)
        is_require_main_and_module: bool = false,

        pub const @"true" = Equality{ .ok = true, .equal = true };
        pub const @"false" = Equality{ .ok = true, .equal = false };
        pub const unknown = Equality{ .ok = false };
    };

    // Returns "equal, ok". If "ok" is false, then nothing is known about the two
    // values. If "ok" is true, the equality or inequality of the two values is
    // stored in "equal".
    pub fn eql(
        left: Expr.Data,
        right: Expr.Data,
        p: anytype,
        comptime kind: enum { loose, strict },
    ) Equality {
        comptime bun.assert(@typeInfo(@TypeOf(p)).pointer.size == .one); // pass *Parser

        // https://dorey.github.io/JavaScript-Equality-Table/
        switch (left) {
            .e_inlined_enum => |inlined| return inlined.value.data.eql(right, p, kind),

            .e_null, .e_undefined => {
                const ok = switch (@as(Expr.Tag, right)) {
                    .e_null, .e_undefined => true,
                    else => @as(Expr.Tag, right).isPrimitiveLiteral(),
                };

                if (comptime kind == .loose) {
                    return .{
                        .equal = switch (@as(Expr.Tag, right)) {
                            .e_null, .e_undefined => true,
                            else => false,
                        },
                        .ok = ok,
                    };
                }

                return .{
                    .equal = @as(Tag, right) == @as(Tag, left),
                    .ok = ok,
                };
            },
            .e_boolean, .e_branch_boolean => |l| {
                switch (right) {
                    .e_boolean, .e_branch_boolean => |r| {
                        return .{
                            .ok = true,
                            .equal = l.value == r.value,
                        };
                    },
                    .e_number => |num| {
                        if (comptime kind == .strict) {
                            // "true === 1" is false
                            // "false === 0" is false
                            return Equality.false;
                        }

                        return .{
                            .ok = true,
                            .equal = if (l.value)
                                num.value == 1
                            else
                                num.value == 0,
                        };
                    },
                    .e_null, .e_undefined => {
                        return Equality.false;
                    },
                    else => {},
                }
            },
            .e_number => |l| {
                switch (right) {
                    .e_number => |r| {
                        return .{
                            .ok = true,
                            .equal = l.value == r.value,
                        };
                    },
                    .e_inlined_enum => |r| if (r.value.data == .e_number) {
                        return .{
                            .ok = true,
                            .equal = l.value == r.value.data.e_number.value,
                        };
                    },
                    .e_boolean, .e_branch_boolean => |r| {
                        if (comptime kind == .loose) {
                            return .{
                                .ok = true,
                                // "1 == true" is true
                                // "0 == false" is true
                                .equal = if (r.value)
                                    l.value == 1
                                else
                                    l.value == 0,
                            };
                        }

                        // "1 === true" is false
                        // "0 === false" is false
                        return Equality.false;
                    },
                    .e_null, .e_undefined => {
                        // "(not null or undefined) == undefined" is false
                        return Equality.false;
                    },
                    else => {},
                }
            },
            .e_big_int => |l| {
                if (right == .e_big_int) {
                    if (strings.eqlLong(l.value, right.e_big_int.value, true)) {
                        return Equality.true;
                    }

                    // 0x0000n == 0n is true
                    return .{ .ok = false };
                } else {
                    return .{
                        .ok = switch (right) {
                            .e_null, .e_undefined => true,
                            else => false,
                        },
                        .equal = false,
                    };
                }
            },
            .e_string => |l| {
                switch (right) {
                    .e_string => |r| {
                        r.resolveRopeIfNeeded(p.allocator);
                        l.resolveRopeIfNeeded(p.allocator);
                        return .{
                            .ok = true,
                            .equal = r.eql(E.String, l),
                        };
                    },
                    .e_inlined_enum => |inlined| {
                        if (inlined.value.data == .e_string) {
                            const r = inlined.value.data.e_string;

                            r.resolveRopeIfNeeded(p.allocator);
                            l.resolveRopeIfNeeded(p.allocator);

                            return .{
                                .ok = true,
                                .equal = r.eql(E.String, l),
                            };
                        }
                    },
                    .e_null, .e_undefined => {
                        return Equality.false;
                    },
                    .e_number => |r| {
                        if (comptime kind == .loose) {
                            l.resolveRopeIfNeeded(p.allocator);
                            if (r.value == 0 and (l.isBlank() or l.eqlComptime("0"))) {
                                return Equality.true;
                            }

                            if (r.value == 1 and l.eqlComptime("1")) {
                                return Equality.true;
                            }

                            // the string could still equal 0 or 1 but it could be hex, binary, octal, ...
                            return Equality.unknown;
                        } else {
                            return Equality.false;
                        }
                    },

                    else => {},
                }
            },

            else => {
                // Do not need to check left because e_require_main is
                // always re-ordered to the right side.
                if (right == .e_require_main) {
                    if (left.as(.e_identifier)) |id| {
                        if (id.ref.eql(p.module_ref)) return .{
                            .ok = true,
                            .equal = true,
                            .is_require_main_and_module = true,
                        };
                    }
                }
            },
        }

        return Equality.unknown;
    }

    pub fn toJS(this: Data, allocator: std.mem.Allocator, globalObject: *jsc.JSGlobalObject) ToJSError!jsc.JSValue {
        return switch (this) {
            .e_array => |e| e.toJS(allocator, globalObject),
            .e_object => |e| e.toJS(allocator, globalObject),
            .e_string => |e| e.toJS(allocator, globalObject),
            .e_null => jsc.JSValue.null,
            .e_undefined => .js_undefined,
            .e_boolean, .e_branch_boolean => |boolean| if (boolean.value)
                .true
            else
                .false,
            .e_number => |e| e.toJS(),
            // .e_big_int => |e| e.toJS(ctx, exception),

            .e_inlined_enum => |inlined| inlined.value.data.toJS(allocator, globalObject),

            .e_identifier,
            .e_import_identifier,
            .e_private_identifier,
            .e_commonjs_export_identifier,
            => error.@"Cannot convert identifier to JS. Try a statically-known value",

            // brk: {
            //     // var node = try allocator.create(Macro.JSNode);
            //     // node.* = Macro.JSNode.initExpr(Expr{ .data = this, .loc = logger.Loc.Empty });
            //     // break :brk jsc.JSValue.c(Macro.JSNode.Class.make(globalObject, node));
            // },

            else => {
                return error.@"Cannot convert argument type to JS";
            },
        };
    }

    pub const Store = struct {
        const StoreType = NewStore(&.{
            E.NameOfSymbol,
            E.Array,
            E.Arrow,
            E.Await,
            E.BigInt,
            E.Binary,
            E.Call,
            E.Class,
            E.Dot,
            E.Function,
            E.If,
            E.Import,
            E.Index,
            E.InlinedEnum,
            E.JSXElement,
            E.New,
            E.Number,
            E.Object,
            E.PrivateIdentifier,
            E.RegExp,
            E.Spread,
            E.String,
            E.Template,
            E.TemplatePart,
            E.Unary,
            E.Yield,
        }, 512);

        pub threadlocal var instance: ?*StoreType = null;
        pub threadlocal var memory_allocator: ?*ASTMemoryAllocator = null;
        pub threadlocal var disable_reset = false;

        pub fn create() void {
            if (instance != null or memory_allocator != null) {
                return;
            }

            instance = StoreType.init();
        }

        pub fn reset() void {
            if (disable_reset or memory_allocator != null) return;
            instance.?.reset();
        }

        pub fn deinit() void {
            if (instance == null or memory_allocator != null) return;
            instance.?.deinit();
            instance = null;
        }

        pub inline fn assert() void {
            if (comptime Environment.isDebug or Environment.enable_asan) {
                if (instance == null and memory_allocator == null)
                    bun.unreachablePanic("Store must be init'd", .{});
            }
        }

        /// create || reset
        pub fn begin() void {
            if (memory_allocator != null) return;
            if (instance == null) {
                create();
                return;
            }

            if (!disable_reset)
                instance.?.reset();
        }

        pub fn append(comptime T: type, value: T) *T {
            if (memory_allocator) |allocator| {
                return allocator.append(T, value);
            }

            Disabler.assert();
            return instance.?.append(T, value);
        }
    };

    pub inline fn isStringValue(self: Data) bool {
        return @as(Expr.Tag, self) == .e_string;
    }
};

pub fn StoredData(tag: Tag) type {
    const T = @FieldType(Data, tag);
    return switch (@typeInfo(T)) {
        .pointer => |ptr| ptr.child,
        else => T,
    };
}

fn stringToEquivalentNumberValue(str: []const u8) f64 {
    // +"" -> 0
    if (str.len == 0) return 0;
    if (!bun.strings.isAllASCII(str))
        return std.math.nan(f64);
    return bun.cpp.JSC__jsToNumber(str.ptr, str.len);
}

const string = []const u8;
const stringZ = [:0]const u8;

const JSPrinter = @import("../js_printer.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const JSONParser = bun.json;
const MutableString = bun.MutableString;
const OOM = bun.OOM;
const default_allocator = bun.default_allocator;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;
const writeAnyToHasher = bun.writeAnyToHasher;
const MimeType = bun.http.MimeType;

const js_ast = bun.ast;
const ASTMemoryAllocator = js_ast.ASTMemoryAllocator;
const E = js_ast.E;
const Expr = js_ast.Expr;
const G = js_ast.G;
const NewStore = js_ast.NewStore;
const Op = js_ast.Op;
const Ref = js_ast.Ref;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const ToJSError = js_ast.ToJSError;
