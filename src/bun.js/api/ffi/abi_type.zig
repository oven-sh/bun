const std = @import("std");
const bun = @import("bun");
const string = []const u8;

// Must be kept in sync with JSFFIFunction.h version
pub const ABIType = enum(i32) {
    char = 0,

    int8_t = 1,
    uint8_t = 2,

    int16_t = 3,
    uint16_t = 4,

    int32_t = 5,
    uint32_t = 6,

    int64_t = 7,
    uint64_t = 8,

    double = 9,
    float = 10,

    bool = 11,

    ptr = 12,

    void = 13,

    cstring = 14,

    i64_fast = 15,
    u64_fast = 16,

    function = 17,
    napi_env = 18,
    napi_value = 19,
    buffer = 20,
    pub const max = @intFromEnum(ABIType.napi_value);

    /// Types that we can directly pass through as an `int64_t`
    pub fn needsACastInC(this: ABIType) bool {
        return switch (this) {
            .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => false,
            else => true,
        };
    }

    const map = .{
        .{ "bool", ABIType.bool },
        .{ "c_int", ABIType.int32_t },
        .{ "c_uint", ABIType.uint32_t },
        .{ "char", ABIType.char },
        .{ "char*", ABIType.ptr },
        .{ "double", ABIType.double },
        .{ "f32", ABIType.float },
        .{ "f64", ABIType.double },
        .{ "float", ABIType.float },
        .{ "i16", ABIType.int16_t },
        .{ "i32", ABIType.int32_t },
        .{ "i64", ABIType.int64_t },
        .{ "i8", ABIType.int8_t },
        .{ "int", ABIType.int32_t },
        .{ "int16_t", ABIType.int16_t },
        .{ "int32_t", ABIType.int32_t },
        .{ "int64_t", ABIType.int64_t },
        .{ "int8_t", ABIType.int8_t },
        .{ "isize", ABIType.int64_t },
        .{ "u16", ABIType.uint16_t },
        .{ "u32", ABIType.uint32_t },
        .{ "u64", ABIType.uint64_t },
        .{ "u8", ABIType.uint8_t },
        .{ "uint16_t", ABIType.uint16_t },
        .{ "uint32_t", ABIType.uint32_t },
        .{ "uint64_t", ABIType.uint64_t },
        .{ "uint8_t", ABIType.uint8_t },
        .{ "usize", ABIType.uint64_t },
        .{ "size_t", ABIType.uint64_t },
        .{ "buffer", ABIType.buffer },
        .{ "void*", ABIType.ptr },
        .{ "ptr", ABIType.ptr },
        .{ "pointer", ABIType.ptr },
        .{ "void", ABIType.void },
        .{ "cstring", ABIType.cstring },
        .{ "i64_fast", ABIType.i64_fast },
        .{ "u64_fast", ABIType.u64_fast },
        .{ "function", ABIType.function },
        .{ "callback", ABIType.function },
        .{ "fn", ABIType.function },
        .{ "napi_env", ABIType.napi_env },
        .{ "napi_value", ABIType.napi_value },
    };
    pub const label = bun.ComptimeStringMap(ABIType, map);
    const EnumMapFormatter = struct {
        name: []const u8,
        entry: ABIType,
        pub fn format(self: EnumMapFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.writeAll("['");
            // these are not all valid identifiers
            try writer.writeAll(self.name);
            try writer.writeAll("']:");
            try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
            try writer.writeAll(",'");
            try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
            try writer.writeAll("':");
            try std.fmt.formatInt(@intFromEnum(self.entry), 10, .lower, .{}, writer);
        }
    };
    pub const map_to_js_object = brk: {
        var count: usize = 2;
        for (map, 0..) |item, i| {
            const fmt = EnumMapFormatter{ .name = item.@"0", .entry = item.@"1" };
            count += std.fmt.count("{}", .{fmt});
            count += @intFromBool(i > 0);
        }

        var buf: [count]u8 = undefined;
        buf[0] = '{';
        buf[buf.len - 1] = '}';
        var end: usize = 1;
        for (map, 0..) |item, i| {
            const fmt = EnumMapFormatter{ .name = item.@"0", .entry = item.@"1" };
            if (i > 0) {
                buf[end] = ',';
                end += 1;
            }
            end += (std.fmt.bufPrint(buf[end..], "{}", .{fmt}) catch unreachable).len;
        }

        break :brk buf;
    };

    pub fn isFloatingPoint(this: ABIType) bool {
        return switch (this) {
            .double, .float => true,
            else => false,
        };
    }

    const ToCFormatter = struct {
        symbol: string,
        tag: ABIType,
        exact: bool = false,

        pub fn format(self: ToCFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            switch (self.tag) {
                .void => {
                    return;
                },
                .bool => {
                    if (self.exact)
                        try writer.writeAll("(bool)");
                    try writer.writeAll("JSVALUE_TO_BOOL(");
                },
                .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t, .uint32_t => {
                    if (self.exact)
                        try writer.print("({s})", .{bun.asByteSlice(@tagName(self.tag))});

                    try writer.writeAll("JSVALUE_TO_INT32(");
                },
                .i64_fast, .int64_t => {
                    if (self.exact)
                        try writer.writeAll("(int64_t)");
                    try writer.writeAll("JSVALUE_TO_INT64(");
                },
                .u64_fast, .uint64_t => {
                    if (self.exact)
                        try writer.writeAll("(uint64_t)");
                    try writer.writeAll("JSVALUE_TO_UINT64(");
                },
                .function, .cstring, .ptr => {
                    if (self.exact)
                        try writer.writeAll("(void*)");
                    try writer.writeAll("JSVALUE_TO_PTR(");
                },
                .double => {
                    if (self.exact)
                        try writer.writeAll("(double)");
                    try writer.writeAll("JSVALUE_TO_DOUBLE(");
                },
                .float => {
                    if (self.exact)
                        try writer.writeAll("(float)");
                    try writer.writeAll("JSVALUE_TO_FLOAT(");
                },
                .napi_env => {
                    try writer.writeAll("((napi_env)&Bun__thisFFIModuleNapiEnv)");
                    return;
                },
                .napi_value => {
                    try writer.writeAll(self.symbol);
                    try writer.writeAll(".asNapiValue");
                    return;
                },
                .buffer => {
                    try writer.writeAll("JSVALUE_TO_TYPED_ARRAY_VECTOR(");
                },
            }
            try writer.writeAll(self.symbol);
            try writer.writeAll(")");
        }
    };

    const ToJSFormatter = struct {
        symbol: []const u8,
        tag: ABIType,

        pub fn format(self: ToJSFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            switch (self.tag) {
                .void => {},
                .bool => {
                    try writer.print("BOOLEAN_TO_JSVALUE({s})", .{self.symbol});
                },
                .char, .int8_t, .uint8_t, .int16_t, .uint16_t, .int32_t => {
                    try writer.print("INT32_TO_JSVALUE((int32_t){s})", .{self.symbol});
                },
                .uint32_t => {
                    try writer.print("UINT32_TO_JSVALUE({s})", .{self.symbol});
                },
                .i64_fast => {
                    try writer.print("INT64_TO_JSVALUE(JS_GLOBAL_OBJECT, (int64_t){s})", .{self.symbol});
                },
                .int64_t => {
                    try writer.print("INT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                },
                .u64_fast => {
                    try writer.print("UINT64_TO_JSVALUE(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                },
                .uint64_t => {
                    try writer.print("UINT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {s})", .{self.symbol});
                },
                .function, .cstring, .ptr => {
                    try writer.print("PTR_TO_JSVALUE({s})", .{self.symbol});
                },
                .double => {
                    try writer.print("DOUBLE_TO_JSVALUE({s})", .{self.symbol});
                },
                .float => {
                    try writer.print("FLOAT_TO_JSVALUE({s})", .{self.symbol});
                },
                .napi_env => {
                    try writer.writeAll("((napi_env)&Bun__thisFFIModuleNapiEnv)");
                },
                .napi_value => {
                    try writer.print("((EncodedJSValue) {{.asNapiValue = {s} }} )", .{self.symbol});
                },
                .buffer => {
                    try writer.writeAll("0");
                },
            }
        }
    };

    pub fn toC(this: ABIType, symbol: string) ToCFormatter {
        return ToCFormatter{ .tag = this, .symbol = symbol };
    }

    pub fn toCExact(this: ABIType, symbol: string) ToCFormatter {
        return ToCFormatter{ .tag = this, .symbol = symbol, .exact = true };
    }

    pub fn toJS(
        this: ABIType,
        symbol: string,
    ) ToJSFormatter {
        return ToJSFormatter{
            .tag = this,
            .symbol = symbol,
        };
    }

    pub fn typename(this: ABIType, writer: anytype) !void {
        try writer.writeAll(this.typenameLabel());
    }

    pub fn typenameLabel(this: ABIType) []const u8 {
        return switch (this) {
            .buffer, .function, .cstring, .ptr => "void*",
            .bool => "bool",
            .int8_t => "int8_t",
            .uint8_t => "uint8_t",
            .int16_t => "int16_t",
            .uint16_t => "uint16_t",
            .int32_t => "int32_t",
            .uint32_t => "uint32_t",
            .i64_fast, .int64_t => "int64_t",
            .u64_fast, .uint64_t => "uint64_t",
            .double => "double",
            .float => "float",
            .char => "char",
            .void => "void",
            .napi_env => "napi_env",
            .napi_value => "napi_value",
        };
    }

    pub fn paramTypename(this: ABIType, writer: anytype) !void {
        try writer.writeAll(this.typenameLabel());
    }

    pub fn paramTypenameLabel(this: ABIType) []const u8 {
        return switch (this) {
            .function, .cstring, .ptr => "void*",
            .bool => "bool",
            .int8_t => "int8_t",
            .uint8_t => "uint8_t",
            .int16_t => "int16_t",
            .uint16_t => "uint16_t",
            // see the comment in ffi.ts about why `uint32_t` acts as `int32_t`
            .int32_t,
            .uint32_t,
            => "int32_t",
            .i64_fast, .int64_t => "int64_t",
            .u64_fast, .uint64_t => "uint64_t",
            .double => "double",
            .float => "float",
            .char => "char",
            .void => "void",
            .napi_env => "napi_env",
            .napi_value => "napi_value",
            .buffer => "buffer",
        };
    }
};
