const bun = @import("root").bun;
const logger = bun.logger;
const std = @import("std");
const Fs = bun.fs;
const string = bun.string;
const Resolver = @import("../resolver//resolver.zig");
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const strings = bun.strings;
const default_allocator = bun.default_allocator;
const ZigString = JSC.ZigString;

pub const ResolveMessage = struct {
    msg: logger.Msg,
    allocator: std.mem.Allocator,
    referrer: ?Fs.Path = null,
    logged: bool = false,

    pub usingnamespace JSC.Codegen.JSResolveMessage;

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) ?*ResolveMessage {
        globalThis.throw("ResolveMessage is not constructable", .{});
        return null;
    }

    pub fn getCode(this: *ResolveMessage, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        switch (this.msg.metadata) {
            .resolve => |resolve| {
                if (resolve.import_kind.isCommonJS()) {
                    return bun.String.init("MODULE_NOT_FOUND").toJSConst(globalObject);
                }

                switch (resolve.import_kind) {
                    .stmt, .dynamic => {
                        return bun.String.init("ERR_MODULE_NOT_FOUND").toJSConst(globalObject);
                    },
                    else => {},
                }

                return bun.String.init("RESOLVE_ERROR").toJSConst(globalObject);
            },
            else => return .undefined,
        }
    }

    pub fn fmt(allocator: std.mem.Allocator, specifier: string, referrer: string, err: anyerror) !string {
        switch (err) {
            error.ModuleNotFound => {
                if (Resolver.isPackagePath(specifier) and !strings.containsChar(specifier, '/')) {
                    return try std.fmt.allocPrint(allocator, "Cannot find package \"{s}\" from \"{s}\"", .{ specifier, referrer });
                } else {
                    return try std.fmt.allocPrint(allocator, "Cannot find module \"{s}\" from \"{s}\"", .{ specifier, referrer });
                }
            },
            error.InvalidDataURL => {
                return try std.fmt.allocPrint(allocator, "Cannot resolve invalid data URL \"{s}\" from \"{s}\"", .{ specifier, referrer });
            },
            else => {
                if (Resolver.isPackagePath(specifier)) {
                    return try std.fmt.allocPrint(allocator, "{s} while resolving package \"{s}\" from \"{s}\"", .{ @errorName(err), specifier, referrer });
                } else {
                    return try std.fmt.allocPrint(allocator, "{s} while resolving \"{s}\" from \"{s}\"", .{ @errorName(err), specifier, referrer });
                }
            },
        }
    }

    pub fn toStringFn(this: *ResolveMessage, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        var text = std.fmt.allocPrint(default_allocator, "ResolveMessage: {s}", .{this.msg.data.text}) catch {
            globalThis.throwOutOfMemory();
            return .zero;
        };
        var str = ZigString.init(text);
        str.setOutputEncoding();
        if (str.isUTF8()) {
            const out = str.toValueGC(globalThis);
            default_allocator.free(text);
            return out;
        }

        return str.toExternalValue(globalThis);
    }

    pub fn toString(
        // this
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return this.toStringFn(globalThis);
    }

    pub fn toPrimitive(
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        const args_ = callframe.arguments(1);
        const args = args_.ptr[0..args_.len];
        if (args.len > 0) {
            if (!args[0].isString()) {
                return JSC.JSValue.jsNull();
            }

            const str = args[0].getZigString(globalThis);
            if (str.eqlComptime("default") or str.eqlComptime("string")) {
                return this.toStringFn(globalThis);
            }
        }

        return JSC.JSValue.jsNull();
    }

    pub fn toJSON(
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var object = JSC.JSValue.createEmptyObject(globalThis, 7);
        object.put(globalThis, ZigString.static("name"), ZigString.init("ResolveMessage").toValueGC(globalThis));
        object.put(globalThis, ZigString.static("position"), this.getPosition(globalThis));
        object.put(globalThis, ZigString.static("message"), this.getMessage(globalThis));
        object.put(globalThis, ZigString.static("level"), this.getLevel(globalThis));
        object.put(globalThis, ZigString.static("specifier"), this.getSpecifier(globalThis));
        object.put(globalThis, ZigString.static("importKind"), this.getImportKind(globalThis));
        object.put(globalThis, ZigString.static("referrer"), this.getReferrer(globalThis));
        return object;
    }

    pub fn create(
        globalThis: *JSGlobalObject,
        allocator: std.mem.Allocator,
        msg: logger.Msg,
        referrer: string,
    ) JSC.JSValue {
        var resolve_error = allocator.create(ResolveMessage) catch unreachable;
        resolve_error.* = ResolveMessage{
            .msg = msg.clone(allocator) catch unreachable,
            .allocator = allocator,
            .referrer = Fs.Path.init(referrer),
        };
        return resolve_error.toJS(globalThis);
    }

    pub fn getPosition(
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return JSC.BuildMessage.generatePositionObject(this.msg, globalThis);
    }

    pub fn getMessage(
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(this.msg.data.text).toValueGC(globalThis);
    }

    pub fn getLevel(
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(this.msg.kind.string()).toValueGC(globalThis);
    }

    pub fn getSpecifier(
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(this.msg.metadata.resolve.specifier.slice(this.msg.data.text)).toValueGC(globalThis);
    }

    pub fn getImportKind(
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        return ZigString.init(this.msg.metadata.resolve.import_kind.label()).toValueGC(globalThis);
    }

    pub fn getReferrer(
        this: *ResolveMessage,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue {
        if (this.referrer) |referrer| {
            return ZigString.init(referrer.text).toValueGC(globalThis);
        } else {
            return JSC.JSValue.jsNull();
        }
    }

    pub fn finalize(this: *ResolveMessage) callconv(.C) void {
        this.msg.deinit(bun.default_allocator);
    }
};
