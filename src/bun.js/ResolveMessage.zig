pub const ResolveMessage = struct {
    pub const js = jsc.Codegen.JSResolveMessage;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    msg: logger.Msg,
    allocator: std.mem.Allocator,
    referrer: ?Fs.Path = null,
    logged: bool = false,

    pub fn constructor(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*ResolveMessage {
        return globalThis.throw("ResolveMessage is not constructable", .{});
    }

    pub fn getCode(this: *ResolveMessage, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        switch (this.msg.metadata) {
            .resolve => |resolve| {
                const code: []const u8 = brk: {
                    const specifier = this.msg.metadata.resolve.specifier.slice(this.msg.data.text);

                    break :brk switch (resolve.import_kind) {
                        // Match Node.js error codes. CommonJS is historic
                        // before they started prefixing with 'ERR_'
                        .require => if (bun.strings.hasPrefixComptime(specifier, "node:"))
                            break :brk "ERR_UNKNOWN_BUILTIN_MODULE"
                        else
                            break :brk "MODULE_NOT_FOUND",
                        // require resolve does not have the UNKNOWN_BUILTIN_MODULE error code
                        .require_resolve => "MODULE_NOT_FOUND",
                        .stmt, .dynamic => if (bun.strings.hasPrefixComptime(specifier, "node:"))
                            break :brk "ERR_UNKNOWN_BUILTIN_MODULE"
                        else
                            break :brk "ERR_MODULE_NOT_FOUND",

                        .html_manifest,
                        .entry_point_run,
                        .entry_point_build,
                        .at,
                        .at_conditional,
                        .url,
                        .internal,
                        .composes,
                        => "RESOLVE_ERROR",
                    };
                };

                var atom = bun.String.createAtomASCII(code);
                defer atom.deref();
                return atom.toJS(globalObject);
            },
            else => return .js_undefined,
        }
    }

    // https://github.com/oven-sh/bun/issues/2375#issuecomment-2121530202
    pub fn getColumn(this: *ResolveMessage, _: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.msg.data.location) |location| {
            return jsc.JSValue.jsNumber(@max(location.column - 1, 0));
        }

        return jsc.JSValue.jsNumber(@as(i32, 0));
    }

    pub fn getLine(this: *ResolveMessage, _: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.msg.data.location) |location| {
            return jsc.JSValue.jsNumber(@max(location.line - 1, 0));
        }

        return jsc.JSValue.jsNumber(@as(i32, 0));
    }

    pub fn fmt(allocator: std.mem.Allocator, specifier: string, referrer: string, err: anyerror, import_kind: bun.ImportKind) !string {
        if (import_kind != .require_resolve and bun.strings.hasPrefixComptime(specifier, "node:")) {
            // This matches Node.js exactly.
            return try std.fmt.allocPrint(allocator, "No such built-in module: {s}", .{specifier});
        }
        switch (err) {
            error.ModuleNotFound => {
                if (strings.eqlComptime(referrer, "bun:main")) {
                    return try std.fmt.allocPrint(allocator, "Module not found '{s}'", .{specifier});
                }
                if (Resolver.isPackagePath(specifier) and !strings.containsChar(specifier, '/')) {
                    return try std.fmt.allocPrint(allocator, "Cannot find package '{s}' from '{s}'", .{ specifier, referrer });
                } else {
                    return try std.fmt.allocPrint(allocator, "Cannot find module '{s}' from '{s}'", .{ specifier, referrer });
                }
            },
            error.InvalidDataURL => {
                return try std.fmt.allocPrint(allocator, "Cannot resolve invalid data URL '{s}' from '{s}'", .{ specifier, referrer });
            },
            error.InvalidURL => {
                return try std.fmt.allocPrint(allocator, "Cannot resolve invalid URL '{s}' from '{s}'", .{ specifier, referrer });
            },
            else => {
                if (Resolver.isPackagePath(specifier)) {
                    return try std.fmt.allocPrint(allocator, "{s} while resolving package '{s}' from '{s}'", .{ @errorName(err), specifier, referrer });
                } else {
                    return try std.fmt.allocPrint(allocator, "{s} while resolving '{s}' from '{s}'", .{ @errorName(err), specifier, referrer });
                }
            },
        }
    }

    pub fn toStringFn(this: *ResolveMessage, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        const text = std.fmt.allocPrint(default_allocator, "ResolveMessage: {s}", .{this.msg.data.text}) catch {
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

    pub fn toString(
        // this
        this: *ResolveMessage,
        globalThis: *jsc.JSGlobalObject,
        _: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        return this.toStringFn(globalThis);
    }

    pub fn toPrimitive(
        this: *ResolveMessage,
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
        this: *ResolveMessage,
        globalThis: *jsc.JSGlobalObject,
        _: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        var object = jsc.JSValue.createEmptyObject(globalThis, 7);
        object.put(globalThis, ZigString.static("name"), try bun.String.static("ResolveMessage").toJS(globalThis));
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
    ) bun.OOM!jsc.JSValue {
        var resolve_error = try allocator.create(ResolveMessage);
        resolve_error.* = ResolveMessage{
            .msg = try msg.clone(allocator),
            .allocator = allocator,
            .referrer = Fs.Path.init(referrer),
        };
        return resolve_error.toJS(globalThis);
    }

    pub fn getPosition(
        this: *ResolveMessage,
        globalThis: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        return bun.api.BuildMessage.generatePositionObject(this.msg, globalThis);
    }

    pub fn getMessage(
        this: *ResolveMessage,
        globalThis: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        return ZigString.init(this.msg.data.text).toJS(globalThis);
    }

    pub fn getLevel(
        this: *ResolveMessage,
        globalThis: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        return ZigString.init(this.msg.kind.string()).toJS(globalThis);
    }

    pub fn getSpecifier(
        this: *ResolveMessage,
        globalThis: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        return ZigString.init(this.msg.metadata.resolve.specifier.slice(this.msg.data.text)).toJS(globalThis);
    }

    pub fn getImportKind(
        this: *ResolveMessage,
        globalThis: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        return ZigString.init(this.msg.metadata.resolve.import_kind.label()).toJS(globalThis);
    }

    pub fn getReferrer(
        this: *ResolveMessage,
        globalThis: *jsc.JSGlobalObject,
    ) jsc.JSValue {
        if (this.referrer) |referrer| {
            return ZigString.init(referrer.text).toJS(globalThis);
        } else {
            return jsc.JSValue.jsNull();
        }
    }

    pub fn finalize(this: *ResolveMessage) callconv(.c) void {
        this.msg.deinit(bun.default_allocator);
    }
};

const string = []const u8;

const Resolver = @import("../resolver//resolver.zig");
const std = @import("std");

const bun = @import("bun");
const Fs = bun.fs;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const ZigString = jsc.ZigString;
