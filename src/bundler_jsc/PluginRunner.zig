//! Runtime plugin host (JS-side `Bun.plugin()` resolve hooks). Moved from
//! `bundler/transpiler.zig` so `bundler/` is free of `JSValue`/`JSGlobalObject`.

pub const MacroJSCtx = jsc.JSValue;
pub const default_macro_js_value = jsc.JSValue.zero;

pub const PluginRunner = struct {
    global_object: *jsc.JSGlobalObject,
    allocator: std.mem.Allocator,

    pub fn extractNamespace(specifier: string) string {
        const colon = strings.indexOfChar(specifier, ':') orelse return "";
        if (Environment.isWindows and
            colon == 1 and
            specifier.len > 3 and
            bun.path.isSepAny(specifier[2]) and
            ((specifier[0] > 'a' and specifier[0] < 'z') or (specifier[0] > 'A' and specifier[0] < 'Z')))
            return "";
        return specifier[0..colon];
    }

    pub fn couldBePlugin(specifier: string) bool {
        if (strings.lastIndexOfChar(specifier, '.')) |last_dor| {
            const ext = specifier[last_dor + 1 ..];
            // '.' followed by either a letter or a non-ascii character
            // maybe there are non-ascii file extensions?
            // we mostly want to cheaply rule out "../" and ".." and "./"
            if (ext.len > 0 and ((ext[0] >= 'a' and ext[0] <= 'z') or (ext[0] >= 'A' and ext[0] <= 'Z') or ext[0] > 127))
                return true;
        }
        return (!std.fs.path.isAbsolute(specifier) and strings.containsChar(specifier, ':'));
    }

    pub fn onResolve(
        this: *PluginRunner,
        specifier: []const u8,
        importer: []const u8,
        log: *logger.Log,
        loc: logger.Loc,
        target: jsc.JSGlobalObject.BunPluginTarget,
    ) bun.JSError!?Fs.Path {
        var global = this.global_object;
        const namespace_slice = extractNamespace(specifier);
        const namespace = if (namespace_slice.len > 0 and !strings.eqlComptime(namespace_slice, "file"))
            bun.String.init(namespace_slice)
        else
            bun.String.empty;
        const on_resolve_plugin = try global.runOnResolvePlugins(
            namespace,
            bun.String.init(specifier).substring(if (namespace.length() > 0) namespace.length() + 1 else 0),
            bun.String.init(importer),
            target,
        ) orelse return null;
        const path_value = try on_resolve_plugin.get(global, "path") orelse return null;
        if (path_value.isEmptyOrUndefinedOrNull()) return null;
        if (!path_value.isString()) {
            log.addError(null, loc, "Expected \"path\" to be a string") catch unreachable;
            return null;
        }

        const file_path = try path_value.toBunString(global);
        defer file_path.deref();

        if (file_path.length() == 0) {
            log.addError(
                null,
                loc,
                "Expected \"path\" to be a non-empty string in onResolve plugin",
            ) catch unreachable;
            return null;
        } else if
        // TODO: validate this better
        (file_path.eqlComptime(".") or
            file_path.eqlComptime("..") or
            file_path.eqlComptime("...") or
            file_path.eqlComptime(" "))
        {
            log.addError(
                null,
                loc,
                "Invalid file path from onResolve plugin",
            ) catch unreachable;
            return null;
        }
        var static_namespace = true;
        const user_namespace: bun.String = brk: {
            if (try on_resolve_plugin.get(global, "namespace")) |namespace_value| {
                if (!namespace_value.isString()) {
                    log.addError(null, loc, "Expected \"namespace\" to be a string") catch unreachable;
                    return null;
                }

                const namespace_str = try namespace_value.toBunString(global);
                if (namespace_str.length() == 0) {
                    namespace_str.deref();
                    break :brk bun.String.init("file");
                }

                if (namespace_str.eqlComptime("file")) {
                    namespace_str.deref();
                    break :brk bun.String.init("file");
                }

                if (namespace_str.eqlComptime("bun")) {
                    namespace_str.deref();
                    break :brk bun.String.init("bun");
                }

                if (namespace_str.eqlComptime("node")) {
                    namespace_str.deref();
                    break :brk bun.String.init("node");
                }

                static_namespace = false;

                break :brk namespace_str;
            }

            break :brk bun.String.init("file");
        };
        defer user_namespace.deref();

        if (static_namespace) {
            return Fs.Path.initWithNamespace(
                std.fmt.allocPrint(this.allocator, "{f}", .{file_path}) catch unreachable,
                user_namespace.byteSlice(),
            );
        } else {
            return Fs.Path.initWithNamespace(
                std.fmt.allocPrint(this.allocator, "{f}", .{file_path}) catch unreachable,
                std.fmt.allocPrint(this.allocator, "{f}", .{user_namespace}) catch unreachable,
            );
        }
    }

    pub fn onResolveJSC(this: *const PluginRunner, namespace: bun.String, specifier: bun.String, importer: bun.String, target: jsc.JSGlobalObject.BunPluginTarget) bun.JSError!?jsc.ErrorableString {
        var global = this.global_object;
        const on_resolve_plugin = try global.runOnResolvePlugins(
            if (namespace.length() > 0 and !namespace.eqlComptime("file"))
                namespace
            else
                bun.String.static(""),
            specifier,
            importer,
            target,
        ) orelse return null;
        if (!on_resolve_plugin.isObject()) return null;
        const path_value = try on_resolve_plugin.get(global, "path") orelse return null;
        if (path_value.isEmptyOrUndefinedOrNull()) return null;
        if (!path_value.isString()) {
            return jsc.ErrorableString.err(
                error.JSErrorObject,
                bun.String.static("Expected \"path\" to be a string in onResolve plugin").toErrorInstance(this.global_object),
            );
        }

        const file_path = try path_value.toBunString(global);

        if (file_path.length() == 0) {
            return jsc.ErrorableString.err(
                error.JSErrorObject,
                bun.String.static("Expected \"path\" to be a non-empty string in onResolve plugin").toErrorInstance(this.global_object),
            );
        } else if
        // TODO: validate this better
        (file_path.eqlComptime(".") or
            file_path.eqlComptime("..") or
            file_path.eqlComptime("...") or
            file_path.eqlComptime(" "))
        {
            return jsc.ErrorableString.err(
                error.JSErrorObject,
                bun.String.static("\"path\" is invalid in onResolve plugin").toErrorInstance(this.global_object),
            );
        }
        var static_namespace = true;
        const user_namespace: bun.String = brk: {
            if (try on_resolve_plugin.get(global, "namespace")) |namespace_value| {
                if (!namespace_value.isString()) {
                    return jsc.ErrorableString.err(
                        error.JSErrorObject,
                        bun.String.static("Expected \"namespace\" to be a string").toErrorInstance(this.global_object),
                    );
                }

                const namespace_str = try namespace_value.toBunString(global);
                if (namespace_str.length() == 0) {
                    break :brk bun.String.static("file");
                }

                if (namespace_str.eqlComptime("file")) {
                    defer namespace_str.deref();
                    break :brk bun.String.static("file");
                }

                if (namespace_str.eqlComptime("bun")) {
                    defer namespace_str.deref();
                    break :brk bun.String.static("bun");
                }

                if (namespace_str.eqlComptime("node")) {
                    defer namespace_str.deref();
                    break :brk bun.String.static("node");
                }

                static_namespace = false;

                break :brk namespace_str;
            }

            break :brk bun.String.static("file");
        };
        defer user_namespace.deref();

        // Our super slow way of cloning the string into memory owned by jsc
        const combined_string = std.fmt.allocPrint(this.allocator, "{f}:{f}", .{ user_namespace, file_path }) catch unreachable;
        var out_ = bun.String.init(combined_string);
        defer out_.deref();
        const jsval = out_.toJS(this.global_object) catch |err| {
            this.allocator.free(combined_string);
            return jsc.ErrorableString.err(err, this.global_object.tryTakeException() orelse .js_undefined);
        };
        const out = jsval.toBunString(this.global_object) catch |err| {
            this.allocator.free(combined_string);
            return jsc.ErrorableString.err(err, this.global_object.tryTakeException() orelse .js_undefined);
        };
        this.allocator.free(combined_string);
        return jsc.ErrorableString.ok(out);
    }
};

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Fs = bun.fs;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;
