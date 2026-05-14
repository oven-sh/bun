const StringBuilder = @This();

const size = 24;
const alignment = 8;

bytes: [size]u8 align(alignment),

pub inline fn init() StringBuilder {
    var this: StringBuilder = undefined;
    StringBuilder__init(&this.bytes);
    return this;
}
extern fn StringBuilder__init(*anyopaque) void;

pub fn deinit(this: *StringBuilder) void {
    StringBuilder__deinit(&this.bytes);
}
extern fn StringBuilder__deinit(*anyopaque) void;

const Append = enum {
    latin1,
    utf16,
    double,
    int,
    usize,
    string,
    lchar,
    uchar,
    quoted_json_string,

    pub fn Type(comptime this: Append) type {
        return switch (this) {
            .latin1 => []const u8,
            .utf16 => []const u16,
            .double => f64,
            .int => i32,
            .usize => usize,
            .string => String,
            .lchar => u8,
            .uchar => u16,
            .quoted_json_string => String,
        };
    }
};

pub fn append(this: *StringBuilder, comptime append_type: Append, value: append_type.Type()) void {
    switch (comptime append_type) {
        .latin1 => StringBuilder__appendLatin1(&this.bytes, value.ptr, value.len),
        .utf16 => StringBuilder__appendUtf16(&this.bytes, value.ptr, value.len),
        .double => StringBuilder__appendDouble(&this.bytes, value),
        .int => StringBuilder__appendInt(&this.bytes, value),
        .usize => StringBuilder__appendUsize(&this.bytes, value),
        .string => StringBuilder__appendString(&this.bytes, value),
        .lchar => StringBuilder__appendLChar(&this.bytes, value),
        .uchar => StringBuilder__appendUChar(&this.bytes, value),
        .quoted_json_string => StringBuilder__appendQuotedJsonString(&this.bytes, value),
    }
}
extern fn StringBuilder__appendLatin1(*anyopaque, str: [*]const u8, len: usize) void;
extern fn StringBuilder__appendUtf16(*anyopaque, str: [*]const u16, len: usize) void;
extern fn StringBuilder__appendDouble(*anyopaque, num: f64) void;
extern fn StringBuilder__appendInt(*anyopaque, num: i32) void;
extern fn StringBuilder__appendUsize(*anyopaque, num: usize) void;
extern fn StringBuilder__appendString(*anyopaque, str: String) void;
extern fn StringBuilder__appendLChar(*anyopaque, c: u8) void;
extern fn StringBuilder__appendUChar(*anyopaque, c: u16) void;
extern fn StringBuilder__appendQuotedJsonString(*anyopaque, str: String) void;

pub fn toString(this: *StringBuilder, global: *JSGlobalObject) JSError!JSValue {
    var scope: jsc.TopExceptionScope = undefined;
    scope.init(global, @src());
    defer scope.deinit();

    const result = StringBuilder__toString(&this.bytes, global);
    try scope.returnIfException();
    return result;
}
extern fn StringBuilder__toString(*anyopaque, global: *JSGlobalObject) JSValue;

pub fn ensureUnusedCapacity(this: *StringBuilder, additional: usize) void {
    StringBuilder__ensureUnusedCapacity(&this.bytes, additional);
}
extern fn StringBuilder__ensureUnusedCapacity(*anyopaque, usize) void;

const bun = @import("bun");
const JSError = bun.JSError;
const String = bun.String;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
