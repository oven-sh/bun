pub const BuildMessage = struct {
    pub const js = jsc.Codegen.JSBuildMessage;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

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
        defer default_allocator.free(text);
        return bun.String.createUTF8ForJS(globalThis, text) catch return globalThis.throwOutOfMemoryValue();
    }

    pub fn create(
        globalThis: *jsc.JSGlobalObject,
        allocator: std.mem.Allocator,
        msg: logger.Msg,
        // resolve_result: *const Resolver.Result,
    ) bun.OOM!jsc.JSValue {
        var build_error = try allocator.create(BuildMessage);
        build_error.* = BuildMessage{
            .msg = try msg.clone(allocator),
            // .resolve_result = resolve_result.*,
            .allocator = allocator,
        };

        return build_error.toJS(globalThis);
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

            const str = try args[0].toString(globalThis);
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
        object.put(globalThis, bun.String.static("name"), try bun.String.static("BuildMessage").toJS(globalThis));
        object.put(globalThis, bun.String.static("position"), try this.getPosition(globalThis));
        object.put(globalThis, bun.String.static("message"), try this.getMessage(globalThis));
        object.put(globalThis, bun.String.static("level"), try this.getLevel(globalThis));
        return object;
    }

    pub fn generatePositionObject(msg: logger.Msg, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        const location = msg.data.location orelse return jsc.JSValue.jsNull();
        var object = jsc.JSValue.createEmptyObject(globalThis, 7);

        object.put(
            globalThis,
            bun.String.static("lineText"),
            try bun.String.createUTF8ForJS(globalThis, location.line_text orelse ""),
        );
        object.put(
            globalThis,
            bun.String.static("file"),
            try bun.String.createUTF8ForJS(globalThis, location.file),
        );
        object.put(
            globalThis,
            bun.String.static("namespace"),
            try bun.String.createUTF8ForJS(globalThis, location.namespace),
        );
        object.put(
            globalThis,
            bun.String.static("line"),
            JSValue.jsNumber(location.line),
        );
        object.put(
            globalThis,
            bun.String.static("column"),
            JSValue.jsNumber(location.column),
        );
        object.put(
            globalThis,
            bun.String.static("length"),
            JSValue.jsNumber(location.length),
        );
        object.put(
            globalThis,
            bun.String.static("offset"),
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
    ) bun.JSError!jsc.JSValue {
        return BuildMessage.generatePositionObject(this.msg, globalThis);
    }

    pub fn getMessage(
        this: *BuildMessage,
        globalThis: *jsc.JSGlobalObject,
    ) bun.JSError!jsc.JSValue {
        return try bun.String.createUTF8ForJS(globalThis, this.msg.data.text);
    }

    pub fn getLevel(
        this: *BuildMessage,
        globalThis: *jsc.JSGlobalObject,
    ) bun.JSError!jsc.JSValue {
        return try bun.String.createUTF8ForJS(globalThis, this.msg.kind.string());
    }

    pub fn finalize(this: *BuildMessage) void {
        this.msg.deinit(bun.default_allocator);
    }
};

const string = []const u8;

const std = @import("std");
const Resolver = @import("../resolver//resolver.zig").Resolver;

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const logger = bun.logger;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
