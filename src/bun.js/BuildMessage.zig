pub const BuildMessage = struct {
    // Remove codegen references since we're not using the class generator anymore
    pub extern fn BuildMessage__toJS(*BuildMessage, *jsc.JSGlobalObject) jsc.JSValue;

    msg: logger.Msg,
    // resolve_result: Resolver.Result,
    allocator: std.mem.Allocator,
    logged: bool = false,

    pub fn constructor(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*BuildMessage {
        return globalThis.throw("BuildMessage is not constructable", .{});
    }

    pub fn getNotes(this: *BuildMessage, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        const notes = this.msg.notes;
        const array = try jsc.JSValue.createEmptyArray(globalThis, notes.len);
        for (notes, 0..) |note, i| {
            const cloned = try note.clone(bun.default_allocator);
            try array.putIndex(
                globalThis,
                @intCast(i),
                try BuildMessage.create(globalThis, bun.default_allocator, logger.Msg{ .data = cloned, .kind = .note }),
            );
        }

        return array;
    }

    pub fn toStringFn(this: *BuildMessage, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        const text = std.fmt.allocPrint(default_allocator, "BuildMessage: {s}", .{this.msg.data.text}) catch {
            return globalThis.throwOutOfMemoryValue();
        };
        var str = ZigString.init(text);
        str.setOutputEncoding();
        if (str.isUTF8()) {
            const out = str.toJS(globalThis);
            default_allocator.free(text);
            return out;
        }

        return str.toExternalValue(globalThis);
    }

    pub fn create(
        globalThis: *jsc.JSGlobalObject,
        allocator: std.mem.Allocator,
        msg: logger.Msg,
        // resolve_result: *const Resolver.Result,
    ) bun.OOM!jsc.JSValue {
        const build_error = try allocator.create(BuildMessage);
        // Clone the msg to preserve line_text and other location data
        // The source buffer may be reused/deallocated after the error is created
        build_error.* = BuildMessage{
            .msg = try msg.clone(allocator),
            // .resolve_result = resolve_result.*,
            .allocator = allocator,
        };

        // Pass the actual BuildMessage pointer, the C++ side will create and store the tagged pointer
        return BuildMessage__toJS(build_error, globalThis);
    }

    pub fn toJS(this: *BuildMessage, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        return BuildMessage__toJS(this, globalThis);
    }

    pub fn toString(
        this: *BuildMessage,
        globalThis: *jsc.JSGlobalObject,
        _: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        return this.toStringFn(globalThis);
    }

    pub fn toPrimitive(
        this: *BuildMessage,
        globalThis: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        const args_ = callframe.arguments_old(1);
        const args = args_.ptr[0..args_.len];
        if (args.len > 0) {
            if (!args[0].isString()) {
                return jsc.JSValue.jsNull();
            }

            const str = try args[0].getZigString(globalThis);
            if (str.eqlComptime("default") or str.eqlComptime("string")) {
                return this.toStringFn(globalThis);
            }
        }

        return jsc.JSValue.jsNull();
    }

    pub fn toJSON(
        this: *BuildMessage,
        globalThis: *jsc.JSGlobalObject,
        _: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        var object = jsc.JSValue.createEmptyObject(globalThis, 4);
        object.put(globalThis, ZigString.static("name"), bun.String.static("BuildMessage").toJS(globalThis));
        object.put(globalThis, ZigString.static("position"), this.getPosition(globalThis));
        object.put(globalThis, ZigString.static("message"), try bun.String.createUTF8ForJS(globalThis, this.msg.data.text));
        object.put(globalThis, ZigString.static("level"), this.getLevel(globalThis));
        return object;
    }

    pub fn generatePositionObject(msg: logger.Msg, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        const location = msg.data.location orelse return jsc.JSValue.jsNull();
        var object = jsc.JSValue.createEmptyObject(globalThis, 7);

        object.put(
            globalThis,
            ZigString.static("lineText"),
            ZigString.init(location.line_text orelse "").toJS(globalThis),
        );
        object.put(
            globalThis,
            ZigString.static("file"),
            ZigString.init(location.file).toJS(globalThis),
        );
        object.put(
            globalThis,
            ZigString.static("namespace"),
            ZigString.init(location.namespace).toJS(globalThis),
        );
        object.put(
            globalThis,
            ZigString.static("line"),
            JSValue.jsNumber(location.line),
        );
        object.put(
            globalThis,
            ZigString.static("column"),
            JSValue.jsNumber(location.column),
        );
        object.put(
            globalThis,
            ZigString.static("length"),
            JSValue.jsNumber(location.length),
        );
        object.put(
            globalThis,
            ZigString.static("offset"),
            JSValue.jsNumber(location.offset),
        );

        return object;
    }

    // https://github.com/oven-sh/bun/issues/2375#issuecomment-2121530202
    pub fn getColumn(this: *BuildMessage, _: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.msg.data.location) |location| {
            return jsc.JSValue.jsNumber(@max(location.column - 1, 0));
        }

        return jsc.JSValue.jsNumber(@as(i32, 0));
    }

    pub fn getLine(this: *BuildMessage, _: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.msg.data.location) |location| {
            return jsc.JSValue.jsNumber(@max(location.line - 1, 0));
        }

        return jsc.JSValue.jsNumber(@as(i32, 0));
    }

    pub fn getPosition(
        this: *BuildMessage,
        globalThis: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        return BuildMessage.generatePositionObject(this.msg, globalThis);
    }

    pub fn getMessageString(this: *BuildMessage) bun.String {
        return bun.String.init(this.msg.data.text);
    }

    pub fn getLevel(
        this: *BuildMessage,
        globalThis: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        return ZigString.init(this.msg.kind.string()).toJS(globalThis);
    }

    pub fn finalize(this: *BuildMessage) void {
        this.msg.deinit(bun.default_allocator);
    }

    pub fn fromJS(value: jsc.JSValue) ?*BuildMessage {
        const bun_error_data = BunErrorData.fromJS(value) orelse return null;
        if (bun_error_data.is(BuildMessage)) {
            return bun_error_data.as(BuildMessage);
        }
        return null;
    }

    pub export fn BuildMessage__fromJS(value: jsc.JSValue) ?*BuildMessage {
        return BuildMessage.fromJS(value);
    }

    pub export fn BuildMessage__getMessageString(this: *BuildMessage) bun.String {
        return this.getMessageString();
    }

    pub export fn BuildMessage__getLevel(this: *BuildMessage, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        return this.getLevel(globalThis);
    }

    pub export fn BuildMessage__getPosition(this: *BuildMessage, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        return this.getPosition(globalThis);
    }

    pub export fn BuildMessage__getNotes(this: *BuildMessage, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        return this.getNotes(globalThis) catch globalThis.throwOutOfMemoryValue();
    }

    pub export fn BuildMessage__getLine(this: *BuildMessage, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        return this.getLine(globalThis);
    }

    pub export fn BuildMessage__getColumn(this: *BuildMessage, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        return this.getColumn(globalThis);
    }

    pub export fn BuildMessage__toString(this: *BuildMessage, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) jsc.JSValue {
        return this.toStringFn(globalThis);
    }

    pub export fn BuildMessage__toJSON(this: *BuildMessage, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) jsc.JSValue {
        return this.toJSON(globalThis, callframe) catch globalThis.throwOutOfMemoryValue();
    }

    pub export fn BuildMessage__toPrimitive(this: *BuildMessage, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) jsc.JSValue {
        return this.toPrimitive(globalThis, callframe) catch jsc.JSValue.jsNull();
    }

    pub export fn BuildMessage__finalize(this: *BuildMessage) void {
        this.finalize();
    }
};

const string = []const u8;

const BunErrorData = @import("./BunErrorData.zig");
const std = @import("std");
const Resolver = @import("../resolver//resolver.zig").Resolver;

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const logger = bun.logger;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
