const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const validators = @import("./../node/util/validators.zig");

pub const CompressionStream = struct {
    pub usingnamespace bun.NewRefCounted(@This(), deinit);
    pub usingnamespace JSC.Codegen.JSCompressionStream;

    ref_count: u32 = 1,
    format: Format,

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) ?*@This() {
        const arguments = callframe.argumentsUndef(1).ptr;

        const format = validators.validateStringEnum(Format, globalThis, arguments[0], "format", .{}) catch return null;

        return CompressionStream.new(.{
            .format = format,
        });
    }

    pub fn finalize(this: *@This()) void {
        this.deref();
    }

    pub fn deinit(this: *@This()) void {
        this.destroy();
    }

    pub fn get_readable(this: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalThis;
        return .undefined;
    }

    pub fn get_writable(this: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalThis;
        return .undefined;
    }

    pub fn set_noop(this: *@This(), globalThis: *JSC.JSGlobalObject, newvalue: JSC.JSValue) bool {
        _ = this;
        _ = globalThis;
        _ = newvalue;
        return true;
    }
};

pub const DecompressionStream = struct {
    pub usingnamespace bun.NewRefCounted(@This(), deinit);
    pub usingnamespace JSC.Codegen.JSCompressionStream;

    ref_count: u32 = 1,
    format: Format,

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) ?*@This() {
        const arguments = callframe.argumentsUndef(1).ptr;

        const format = validators.validateStringEnum(Format, globalThis, arguments[0], "format", .{}) catch return null;

        return DecompressionStream.new(.{
            .format = format,
        });
    }

    pub fn finalize(this: *@This()) void {
        this.deref();
    }

    pub fn deinit(this: *@This()) void {
        this.destroy();
    }

    pub fn get_readable(this: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalThis;
        return .undefined;
    }

    pub fn get_writable(this: *@This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalThis;
        return .undefined;
    }

    pub fn set_noop(this: *@This(), globalThis: *JSC.JSGlobalObject, newvalue: JSC.JSValue) bool {
        _ = this;
        _ = globalThis;
        _ = newvalue;
        return true;
    }
};

pub const Format = enum {
    deflate,
    @"deflate-raw",
    gzip,
};
