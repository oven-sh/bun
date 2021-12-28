const std = @import("std");

const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../../bundler.zig").MacroEntryPoint;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").Bundler;
const ServerEntryPoint = @import("../../bundler.zig").ServerEntryPoint;
const js_printer = @import("../../js_printer.zig");
const js_parser = @import("../../js_parser.zig");
const js_ast = @import("../../js_ast.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
usingnamespace @import("./base.zig");
usingnamespace @import("./webcore/response.zig");
usingnamespace @import("./config.zig");
usingnamespace @import("./bindings/exports.zig");
usingnamespace @import("./bindings/bindings.zig");
const Runtime = @import("../../runtime.zig");
const Router = @import("./api/router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = @import("../../bundler.zig").ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;

pub const GlobalClasses = [_]type{
    Request.Class,
    Response.Class,
    Headers.Class,
    EventListenerMixin.addEventListener(VirtualMachine),
    BuildError.Class,
    ResolveError.Class,
    Bun.Class,
    Fetch.Class,
    js_ast.Macro.JSNode.BunJSXCallbackFunction,
    Performance.Class,

    // The last item in this array becomes "process.env"
    Bun.EnvironmentVariables.Class,
};
const Blob = @import("../../blob.zig");

pub const Bun = struct {
    threadlocal var css_imports_list_strings: [512]ZigString = undefined;
    threadlocal var css_imports_list: [512]Api.StringPointer = undefined;
    threadlocal var css_imports_list_tail: u16 = 0;
    threadlocal var css_imports_buf: std.ArrayList(u8) = undefined;
    threadlocal var css_imports_buf_loaded: bool = false;

    threadlocal var routes_list_strings: [1024]ZigString = undefined;

    pub fn onImportCSS(
        resolve_result: *const Resolver.Result,
        import_record: *ImportRecord,
        source_dir: string,
    ) void {
        if (!css_imports_buf_loaded) {
            css_imports_buf = std.ArrayList(u8).initCapacity(
                VirtualMachine.vm.allocator,
                import_record.path.text.len,
            ) catch unreachable;
            css_imports_buf_loaded = true;
        }

        var writer = css_imports_buf.writer();
        const offset = css_imports_buf.items.len;
        css_imports_list[css_imports_list_tail] = .{
            .offset = @truncate(u32, offset),
            .length = 0,
        };
        getPublicPath(resolve_result.path_pair.primary.text, @TypeOf(writer), writer);
        const length = css_imports_buf.items.len - offset;
        css_imports_list[css_imports_list_tail].length = @truncate(u32, length);
        css_imports_list_tail += 1;
    }

    pub fn flushCSSImports() void {
        if (css_imports_buf_loaded) {
            css_imports_buf.clearRetainingCapacity();
            css_imports_list_tail = 0;
        }
    }

    pub fn getCSSImports() []ZigString {
        var i: u16 = 0;
        const tail = css_imports_list_tail;
        while (i < tail) : (i += 1) {
            ZigString.fromStringPointer(css_imports_list[i], css_imports_buf.items, &css_imports_list_strings[i]);
        }
        return css_imports_list_strings[0..tail];
    }

    pub fn registerMacro(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (arguments.len != 2 or !js.JSValueIsNumber(ctx, arguments[0])) {
            JSError(getAllocator(ctx), "Internal error registering macros: invalid args", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }
        // TODO: make this faster
        const id = @truncate(i32, @floatToInt(i64, js.JSValueToNumber(ctx, arguments[0], exception)));
        if (id == -1 or id == 0) {
            JSError(getAllocator(ctx), "Internal error registering macros: invalid id", .{}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        if (!js.JSValueIsObject(ctx, arguments[1]) or !js.JSObjectIsFunction(ctx, arguments[1])) {
            JSError(getAllocator(ctx), "Macro must be a function. Received: {s}", .{@tagName(js.JSValueGetType(ctx, arguments[1]))}, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        var get_or_put_result = VirtualMachine.vm.macros.getOrPut(id) catch unreachable;
        if (get_or_put_result.found_existing) {
            js.JSValueUnprotect(ctx, get_or_put_result.value_ptr.*);
        }

        js.JSValueProtect(ctx, arguments[1]);
        get_or_put_result.value_ptr.* = arguments[1];

        return js.JSValueMakeUndefined(ctx);
    }

    pub fn getCWD(
        this: void,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(VirtualMachine.vm.bundler.fs.top_level_dir).toValue(VirtualMachine.vm.global).asRef();
    }

    pub fn getOrigin(
        this: void,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(VirtualMachine.vm.bundler.options.origin.origin).toValue(VirtualMachine.vm.global).asRef();
    }

    pub fn enableANSIColors(
        this: void,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeBoolean(ctx, Output.enable_ansi_colors);
    }
    pub fn getMain(
        this: void,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(VirtualMachine.vm.main).toValue(VirtualMachine.vm.global).asRef();
    }

    pub fn getAssetPrefix(
        this: void,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(VirtualMachine.vm.bundler.options.routes.asset_prefix_path).toValue(VirtualMachine.vm.global).asRef();
    }

    pub fn getArgv(
        this: void,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (comptime Environment.isWindows) {
            @compileError("argv not supported on windows");
        }

        var argv_list = std.heap.stackFallback(128, getAllocator(ctx));
        var allocator = argv_list.get();
        var argv = allocator.alloc(ZigString, std.os.argv.len) catch unreachable;
        defer if (argv.len > 128) allocator.free(argv);
        for (std.os.argv) |arg, i| {
            argv[i] = ZigString.init(std.mem.span(arg));
        }

        return JSValue.createStringArray(VirtualMachine.vm.global, argv.ptr, argv.len).asObjectRef();
    }

    pub fn getRoutesDir(
        this: void,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (!VirtualMachine.vm.bundler.options.routes.routes_enabled or VirtualMachine.vm.bundler.options.routes.dir.len == 0) {
            return js.JSValueMakeUndefined(ctx);
        }

        return ZigString.init(VirtualMachine.vm.bundler.options.routes.dir).toValue(VirtualMachine.vm.global).asRef();
    }

    pub fn getFilePath(ctx: js.JSContextRef, arguments: []const js.JSValueRef, buf: []u8, exception: js.ExceptionRef) ?string {
        if (arguments.len != 1) {
            JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
            return null;
        }

        const value = arguments[0];
        if (js.JSValueIsString(ctx, value)) {
            var out = ZigString.Empty;
            JSValue.toZigString(JSValue.fromRef(value), &out, VirtualMachine.vm.global);
            var out_slice = out.slice();

            // The dots are kind of unnecessary. They'll be normalized.
            if (out.len == 0 or @ptrToInt(out.ptr) == 0 or std.mem.eql(u8, out_slice, ".") or std.mem.eql(u8, out_slice, "..") or std.mem.eql(u8, out_slice, "../")) {
                JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
                return null;
            }

            var parts = [_]string{out_slice};
            // This does the equivalent of Node's path.normalize(path.join(cwd, out_slice))
            var res = VirtualMachine.vm.bundler.fs.absBuf(&parts, buf);

            return res;
        } else if (js.JSValueIsArray(ctx, value)) {
            var temp_strings_list: [32]string = undefined;
            var temp_strings_list_len: u8 = 0;
            defer {
                for (temp_strings_list[0..temp_strings_list_len]) |_, i| {
                    temp_strings_list[i] = "";
                }
            }

            var iter = JSValue.fromRef(value).arrayIterator(VirtualMachine.vm.global);
            while (iter.next()) |item| {
                if (temp_strings_list_len >= temp_strings_list.len) {
                    break;
                }

                if (!item.isString()) {
                    JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
                    return null;
                }

                var out = ZigString.Empty;
                JSValue.toZigString(item, &out, VirtualMachine.vm.global);
                const out_slice = out.slice();

                temp_strings_list[temp_strings_list_len] = out_slice;
                // The dots are kind of unnecessary. They'll be normalized.
                if (out.len == 0 or @ptrToInt(out.ptr) == 0 or std.mem.eql(u8, out_slice, ".") or std.mem.eql(u8, out_slice, "..") or std.mem.eql(u8, out_slice, "../")) {
                    JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
                    return null;
                }
                temp_strings_list_len += 1;
            }

            if (temp_strings_list_len == 0) {
                JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
                return null;
            }

            return VirtualMachine.vm.bundler.fs.absBuf(temp_strings_list[0..temp_strings_list_len], buf);
        } else {
            JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
            return null;
        }
    }

    pub fn getImportedStyles(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        defer flushCSSImports();
        const styles = getCSSImports();
        if (styles.len == 0) {
            return js.JSObjectMakeArray(ctx, 0, null, null);
        }

        return JSValue.createStringArray(VirtualMachine.vm.global, styles.ptr, styles.len).asRef();
    }

    pub fn readFileAsStringCallback(
        ctx: js.JSContextRef,
        buf_z: [:0]const u8,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        const path = buf_z.ptr[0..buf_z.len];
        var file = std.fs.cwd().openFileZ(buf_z, .{ .read = true, .write = false }) catch |err| {
            JSError(getAllocator(ctx), "Opening file {s} for path: \"{s}\"", .{ @errorName(err), path }, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };

        defer file.close();

        const stat = file.stat() catch |err| {
            JSError(getAllocator(ctx), "Getting file size {s} for \"{s}\"", .{ @errorName(err), path }, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };

        if (stat.kind != .File) {
            JSError(getAllocator(ctx), "Can't read a {s} as a string (\"{s}\")", .{ @tagName(stat.kind), path }, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        var contents_buf = VirtualMachine.vm.allocator.alloc(u8, stat.size + 2) catch unreachable; // OOM
        defer VirtualMachine.vm.allocator.free(contents_buf);
        const contents_len = file.readAll(contents_buf) catch |err| {
            JSError(getAllocator(ctx), "{s} reading file (\"{s}\")", .{ @errorName(err), path }, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };

        contents_buf[contents_len] = 0;

        // Very slow to do it this way. We're copying the string twice.
        // But it's important that this string is garbage collected instead of manually managed.
        // We can't really recycle this one.
        // TODO: use external string
        return js.JSValueMakeString(ctx, js.JSStringCreateWithUTF8CString(contents_buf.ptr));
    }

    pub fn readFileAsBytesCallback(
        ctx: js.JSContextRef,
        buf_z: [:0]const u8,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        const path = buf_z.ptr[0..buf_z.len];

        var file = std.fs.cwd().openFileZ(buf_z, .{ .read = true, .write = false }) catch |err| {
            JSError(getAllocator(ctx), "Opening file {s} for path: \"{s}\"", .{ @errorName(err), path }, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };

        defer file.close();

        const stat = file.stat() catch |err| {
            JSError(getAllocator(ctx), "Getting file size {s} for \"{s}\"", .{ @errorName(err), path }, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };

        if (stat.kind != .File) {
            JSError(getAllocator(ctx), "Can't read a {s} as a string (\"{s}\")", .{ @tagName(stat.kind), path }, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        }

        var contents_buf = VirtualMachine.vm.allocator.alloc(u8, stat.size + 2) catch unreachable; // OOM
        errdefer VirtualMachine.vm.allocator.free(contents_buf);
        const contents_len = file.readAll(contents_buf) catch |err| {
            JSError(getAllocator(ctx), "{s} reading file (\"{s}\")", .{ @errorName(err), path }, ctx, exception);
            return js.JSValueMakeUndefined(ctx);
        };

        contents_buf[contents_len] = 0;

        var marked_array_buffer = VirtualMachine.vm.allocator.create(MarkedArrayBuffer) catch unreachable;
        marked_array_buffer.* = MarkedArrayBuffer.fromBytes(
            contents_buf[0..contents_len],
            VirtualMachine.vm.allocator,
            js.JSTypedArrayType.kJSTypedArrayTypeUint8Array,
        );

        return marked_array_buffer.toJSObjectRef(ctx, exception);
    }

    pub fn getRouteFiles(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (VirtualMachine.vm.bundler.router == null) return js.JSValueMakeNull(ctx);

        const router = &VirtualMachine.vm.bundler.router.?;
        const list = router.getPublicPaths() catch unreachable;

        for (routes_list_strings[0..@minimum(list.len, routes_list_strings.len)]) |_, i| {
            routes_list_strings[i] = ZigString.init(list[i]);
        }

        const ref = JSValue.createStringArray(VirtualMachine.vm.global, &routes_list_strings, list.len).asRef();
        return ref;
    }

    pub fn getRouteNames(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (VirtualMachine.vm.bundler.router == null) return js.JSValueMakeNull(ctx);

        const router = &VirtualMachine.vm.bundler.router.?;
        const list = router.getNames() catch unreachable;

        for (routes_list_strings[0..@minimum(list.len, routes_list_strings.len)]) |_, i| {
            routes_list_strings[i] = ZigString.init(list[i]);
        }

        const ref = JSValue.createStringArray(VirtualMachine.vm.global, &routes_list_strings, list.len).asRef();
        return ref;
    }

    pub fn readFileAsBytes(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const path = getFilePath(ctx, arguments, &buf, exception) orelse return null;
        buf[path.len] = 0;

        const buf_z: [:0]const u8 = buf[0..path.len :0];
        const result = readFileAsBytesCallback(ctx, buf_z, exception);
        return result;
    }

    pub fn readFileAsString(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const path = getFilePath(ctx, arguments, &buf, exception) orelse return null;
        buf[path.len] = 0;

        const buf_z: [:0]const u8 = buf[0..path.len :0];
        const result = readFileAsStringCallback(ctx, buf_z, exception);
        return result;
    }

    pub fn getPublicPath(to: string, comptime Writer: type, writer: Writer) void {
        const relative_path = VirtualMachine.vm.bundler.fs.relativeTo(to);
        if (VirtualMachine.vm.bundler.options.origin.isAbsolute()) {
            VirtualMachine.vm.bundler.options.origin.joinWrite(
                Writer,
                writer,
                VirtualMachine.vm.bundler.options.routes.asset_prefix_path,
                "",
                relative_path,
                "",
            ) catch unreachable;
        } else {
            writer.writeAll(std.mem.trimLeft(u8, relative_path, "/")) catch unreachable;
        }
    }

    pub fn sleepSync(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (js.JSValueIsNumber(ctx, arguments[0])) {
            const ms = JSValue.fromRef(arguments[0]).asNumber();
            if (ms > 0 and std.math.isFinite(ms)) std.time.sleep(@floatToInt(u64, @floor(@floatCast(f128, ms) * std.time.ns_per_ms)));
        }

        return js.JSValueMakeUndefined(ctx);
    }

    var public_path_temp_str: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    pub fn getPublicPathJS(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var zig_str: ZigString = ZigString.Empty;
        JSValue.toZigString(JSValue.fromRef(arguments[0]), &zig_str, VirtualMachine.vm.global);

        const to = zig_str.slice();

        var stream = std.io.fixedBufferStream(&public_path_temp_str);
        var writer = stream.writer();
        getPublicPath(to, @TypeOf(&writer), &writer);
        return ZigString.init(stream.buffer[0..stream.pos]).toValueGC(VirtualMachine.vm.global).asRef();
    }

    pub const Class = NewClass(
        void,
        .{
            .name = "Bun",
            .read_only = true,
            .ts = .{
                .module = .{
                    .path = "bun.js/router",
                    .tsdoc = "Filesystem Router supporting dynamic routes, exact routes, catch-all routes, and optional catch-all routes. Implemented in native code and only available with Bun.js.",
                },
            },
        },
        .{
            .match = .{
                .rfn = Router.match,
                .ts = Router.match_type_definition,
            },
            .sleepSync = .{
                .rfn = sleepSync,
            },
            .fetch = .{
                .rfn = Fetch.call,
                .ts = d.ts{},
            },
            .getImportedStyles = .{
                .rfn = Bun.getImportedStyles,
                .ts = d.ts{
                    .name = "getImportedStyles",
                    .@"return" = "string[]",
                },
            },
            .getRouteFiles = .{
                .rfn = Bun.getRouteFiles,
                .ts = d.ts{
                    .name = "getRouteFiles",
                    .@"return" = "string[]",
                },
            },
            .getRouteNames = .{
                .rfn = Bun.getRouteNames,
                .ts = d.ts{
                    .name = "getRouteNames",
                    .@"return" = "string[]",
                },
            },
            .readFile = .{
                .rfn = Bun.readFileAsString,
                .ts = d.ts{
                    .name = "readFile",
                    .@"return" = "string",
                },
            },
            .readFileBytes = .{
                .rfn = Bun.readFileAsBytes,
                .ts = d.ts{
                    .name = "readFile",
                    .@"return" = "Uint8Array",
                },
            },
            .getPublicPath = .{
                .rfn = Bun.getPublicPathJS,
                .ts = d.ts{
                    .name = "getPublicPath",
                    .@"return" = "string",
                },
            },
            .registerMacro = .{
                .rfn = Bun.registerMacro,
                .ts = d.ts{
                    .name = "registerMacro",
                    .@"return" = "undefined",
                },
            },
        },
        .{
            .main = .{
                .get = getMain,
                .ts = d.ts{ .name = "main", .@"return" = "string" },
            },
            .cwd = .{
                .get = getCWD,
                .ts = d.ts{ .name = "cwd", .@"return" = "string" },
            },
            .origin = .{
                .get = getOrigin,
                .ts = d.ts{ .name = "origin", .@"return" = "string" },
            },
            .routesDir = .{
                .get = getRoutesDir,
                .ts = d.ts{ .name = "routesDir", .@"return" = "string" },
            },
            .assetPrefix = .{
                .get = getAssetPrefix,
                .ts = d.ts{ .name = "assetPrefix", .@"return" = "string" },
            },
            .argv = .{
                .get = getArgv,
                .ts = d.ts{ .name = "argv", .@"return" = "string[]" },
            },
            .env = .{
                .get = EnvironmentVariables.getter,
            },
            .enableANSIColors = .{
                .get = enableANSIColors,
            },
        },
    );

    /// EnvironmentVariables is runtime defined.
    /// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
    // This is aliased to Bun.env
    pub const EnvironmentVariables = struct {
        pub const Class = NewClass(
            void,
            .{
                .name = "DotEnv",
                .read_only = true,
            },
            .{
                .getProperty = .{
                    .rfn = getProperty,
                },
                // .hasProperty = .{
                //     .rfn = hasProperty,
                // },
                .getPropertyNames = .{
                    .rfn = getPropertyNames,
                },
            },
            .{},
        );

        pub fn getter(
            this: void,
            ctx: js.JSContextRef,
            thisObject: js.JSValueRef,
            prop: js.JSStringRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            return js.JSObjectMake(ctx, EnvironmentVariables.Class.get().*, null);
        }

        pub const BooleanString = struct {
            pub const @"true": string = "true";
            pub const @"false": string = "false";
        };

        pub fn getProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            const len = js.JSStringGetLength(propertyName);
            var ptr = js.JSStringGetCharacters8Ptr(propertyName);
            var name = ptr[0..len];
            if (VirtualMachine.vm.bundler.env.map.get(name)) |value| {
                return ZigString.toRef(value, VirtualMachine.vm.global);
            }

            if (Output.enable_ansi_colors) {
                // https://github.com/chalk/supports-color/blob/main/index.js
                if (strings.eqlComptime(name, "FORCE_COLOR")) {
                    return ZigString.toRef(BooleanString.@"true", VirtualMachine.vm.global);
                }
            }

            return js.JSValueMakeUndefined(ctx);
        }

        pub fn hasProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            propertyName: js.JSStringRef,
        ) callconv(.C) bool {
            const len = js.JSStringGetLength(propertyName);
            const ptr = js.JSStringGetCharacters8Ptr(propertyName);
            const name = ptr[0..len];
            return VirtualMachine.vm.bundler.env.map.get(name) != null or (Output.enable_ansi_colors and strings.eqlComptime(name, "FORCE_COLOR"));
        }

        pub fn getPropertyNames(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            props: js.JSPropertyNameAccumulatorRef,
        ) callconv(.C) void {
            var iter = VirtualMachine.vm.bundler.env.map.iter();

            while (iter.next()) |item| {
                const str = item.key_ptr.*;
                js.JSPropertyNameAccumulatorAddName(props, js.JSStringCreateStatic(str.ptr, str.len));
            }
        }
    };
};

pub const Performance = struct {
    pub const Class = NewClass(
        void,
        .{
            .name = "performance",
            .read_only = true,
        },
        .{
            .now = .{
                .rfn = Performance.now,
            },
        },
        .{},
    );

    pub fn now(
        this: void,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return js.JSValueMakeNumber(
            ctx,
            @floatCast(
                f64,
                @intToFloat(
                    f128,
                    VirtualMachine.vm.origin_timer.read(),
                ) / std.time.ns_per_ms,
            ),
        );
    }
};

const bun_file_import_path = "/node_modules.server.bun";

const FetchTasklet = Fetch.FetchTasklet;
const TaggedPointerUnion = @import("../../tagged_pointer.zig").TaggedPointerUnion;
pub const Task = TaggedPointerUnion(.{
    FetchTasklet,
    Microtask,
});

// If you read JavascriptCore/API/JSVirtualMachine.mm - https://github.com/WebKit/WebKit/blob/acff93fb303baa670c055cb24c2bad08691a01a0/Source/JavaScriptCore/API/JSVirtualMachine.mm#L101
// We can see that it's sort of like std.mem.Allocator but for JSGlobalContextRef, to support Automatic Reference Counting
// Its unavailable on Linux
pub const VirtualMachine = struct {
    global: *JSGlobalObject,
    allocator: *std.mem.Allocator,
    node_modules: ?*NodeModuleBundle = null,
    bundler: Bundler,
    watcher: ?*http.Watcher = null,
    console: *ZigConsoleClient,
    log: *logger.Log,
    event_listeners: EventListenerMixin.Map,
    main: string = "",
    process: js.JSObjectRef = null,
    blobs: *Blob.Group = undefined,
    flush_list: std.ArrayList(string),
    entry_point: ServerEntryPoint = undefined,

    arena: *std.heap.ArenaAllocator = undefined,
    has_loaded: bool = false,

    transpiled_count: usize = 0,
    resolved_count: usize = 0,
    had_errors: bool = false,

    macros: MacroMap,
    macro_entry_points: std.AutoArrayHashMap(i32, *MacroEntryPoint),
    macro_mode: bool = false,

    has_any_macro_remappings: bool = false,

    origin_timer: std.time.Timer = undefined,

    ready_tasks_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    pending_tasks_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    microtasks_queue: std.ArrayList(Task) = std.ArrayList(Task).init(default_allocator),

    pub fn enqueueTask(this: *VirtualMachine, task: Task) !void {
        _ = this.pending_tasks_count.fetchAdd(1, .Monotonic);
        try this.microtasks_queue.append(task);
    }

    pub fn tick(this: *VirtualMachine) void {
        while (this.eventLoopTick() > 0) {}
    }

    pub fn waitForTasks(this: *VirtualMachine) void {
        while (this.pending_tasks_count.load(.Monotonic) > 0 or this.ready_tasks_count.load(.Monotonic) > 0) {
            while (this.eventLoopTick() > 0) {}
        }
    }

    // 👶👶👶 event loop 👶👶👶
    pub fn eventLoopTick(this: *VirtualMachine) u32 {
        var finished: u32 = 0;
        var i: usize = 0;
        while (i < this.microtasks_queue.items.len) {
            var task: Task = this.microtasks_queue.items[i];
            switch (task.tag()) {
                .Microtask => {
                    var micro: *Microtask = task.get(Microtask).?;
                    _ = this.microtasks_queue.swapRemove(i);
                    _ = this.pending_tasks_count.fetchSub(1, .Monotonic);
                    micro.run(this.global);

                    finished += 1;
                    continue;
                },
                .FetchTasklet => {
                    var fetch_task: *Fetch.FetchTasklet = task.get(Fetch.FetchTasklet).?;
                    if (fetch_task.status == .done) {
                        _ = this.ready_tasks_count.fetchSub(1, .Monotonic);
                        _ = this.pending_tasks_count.fetchSub(1, .Monotonic);
                        _ = this.microtasks_queue.swapRemove(i);
                        fetch_task.onDone();
                        finished += 1;
                        continue;
                    }
                },
                else => unreachable,
            }
            i += 1;
        }
        return finished;
    }

    pub const MacroMap = std.AutoArrayHashMap(i32, js.JSObjectRef);

    pub threadlocal var vm_loaded = false;
    pub threadlocal var vm: *VirtualMachine = undefined;

    pub fn enableMacroMode(this: *VirtualMachine) void {
        this.bundler.options.platform = .bun_macro;
        this.macro_mode = true;
        Analytics.Features.macros = true;
    }

    pub fn disableMacroMode(this: *VirtualMachine) void {
        this.bundler.options.platform = .bun;
        this.macro_mode = false;
    }

    pub fn init(
        allocator: *std.mem.Allocator,
        _args: Api.TransformOptions,
        existing_bundle: ?*NodeModuleBundle,
        _log: ?*logger.Log,
        env_loader: ?*DotEnv.Loader,
    ) !*VirtualMachine {
        var log: *logger.Log = undefined;
        if (_log) |__log| {
            log = __log;
        } else {
            log = try allocator.create(logger.Log);
            log.* = logger.Log.init(allocator);
        }

        VirtualMachine.vm = try allocator.create(VirtualMachine);
        var console = try allocator.create(ZigConsoleClient);
        console.* = ZigConsoleClient.init(Output.errorWriter(), Output.writer());
        const bundler = try Bundler.init(
            allocator,
            log,
            try configureTransformOptionsForBunVM(allocator, _args),
            existing_bundle,
            env_loader,
        );
        VirtualMachine.vm.* = VirtualMachine{
            .global = undefined,
            .allocator = allocator,
            .entry_point = ServerEntryPoint{},
            .event_listeners = EventListenerMixin.Map.init(allocator),
            .bundler = bundler,
            .console = console,
            .node_modules = bundler.options.node_modules_bundle,
            .log = log,
            .flush_list = std.ArrayList(string).init(allocator),
            .blobs = try Blob.Group.init(allocator),

            .macros = MacroMap.init(allocator),
            .macro_entry_points = @TypeOf(VirtualMachine.vm.macro_entry_points).init(allocator),
            .origin_timer = std.time.Timer.start() catch @panic("Please don't mess with timers."),
        };
        vm.bundler.macro_context = null;

        VirtualMachine.vm.bundler.configureLinker();
        try VirtualMachine.vm.bundler.configureFramework(false);

        vm.bundler.macro_context = js_ast.Macro.MacroContext.init(&vm.bundler);

        if (_args.serve orelse false) {
            VirtualMachine.vm.bundler.linker.onImportCSS = Bun.onImportCSS;
        }

        var global_classes: [GlobalClasses.len]js.JSClassRef = undefined;
        inline for (GlobalClasses) |Class, i| {
            global_classes[i] = Class.get().*;
        }
        VirtualMachine.vm.global = ZigGlobalObject.create(
            &global_classes,
            @intCast(i32, global_classes.len),
            vm.console,
        );
        VirtualMachine.vm_loaded = true;

        if (!source_code_printer_loaded) {
            var writer = try js_printer.BufferWriter.init(allocator);
            source_code_printer = js_printer.BufferPrinter.init(writer);
            source_code_printer.ctx.append_null_byte = false;

            source_code_printer_loaded = true;
        }

        return VirtualMachine.vm;
    }

    // dynamic import
    // pub fn import(global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) ErrorableZigString {

    // }

    threadlocal var source_code_printer: js_printer.BufferPrinter = undefined;
    threadlocal var source_code_printer_loaded: bool = false;

    pub fn preflush(this: *VirtualMachine) void {
        // We flush on the next tick so that if there were any errors you can still see them
        this.blobs.temporary.reset() catch {};
    }

    pub fn flush(this: *VirtualMachine) void {
        this.had_errors = false;
        for (this.flush_list.items) |item| {
            this.allocator.free(item);
        }
        this.flush_list.shrinkRetainingCapacity(0);
        this.transpiled_count = 0;
        this.resolved_count = 0;
    }

    inline fn _fetch(
        global: *JSGlobalObject,
        _specifier: string,
        source: string,
        log: *logger.Log,
    ) !ResolvedSource {
        std.debug.assert(VirtualMachine.vm_loaded);
        std.debug.assert(VirtualMachine.vm.global == global);

        if (vm.node_modules != null and strings.eqlComptime(_specifier, bun_file_import_path)) {
            // We kind of need an abstraction around this.
            // Basically we should subclass JSC::SourceCode with:
            // - hash
            // - file descriptor for source input
            // - file path + file descriptor for bytecode caching
            // - separate bundles for server build vs browser build OR at least separate sections
            const code = try vm.node_modules.?.readCodeAsStringSlow(vm.allocator);

            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(code),
                .specifier = ZigString.init(bun_file_import_path),
                .source_url = ZigString.init(bun_file_import_path[1..]),
                .hash = 0, // TODO
                .bytecodecache_fd = std.math.lossyCast(u64, vm.node_modules.?.fetchByteCodeCache(
                    bun_file_import_path[1..],
                    &vm.bundler.fs.fs,
                ) orelse 0),
            };
        } else if (vm.node_modules == null and strings.eqlComptime(_specifier, Runtime.Runtime.Imports.Name)) {
            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(Runtime.Runtime.sourceContent()),
                .specifier = ZigString.init(Runtime.Runtime.Imports.Name),
                .source_url = ZigString.init(Runtime.Runtime.Imports.Name),
                .hash = Runtime.Runtime.versionHash(),
                .bytecodecache_fd = 0,
            };
            // This is all complicated because the imports have to be linked and we want to run the printer on it
            // so it consistently handles bundled imports
            // we can't take the shortcut of just directly importing the file, sadly.
        } else if (strings.eqlComptime(_specifier, main_file_name)) {
            defer vm.transpiled_count += 1;

            var bundler = &vm.bundler;
            var old = vm.bundler.log;
            vm.bundler.log = log;
            vm.bundler.linker.log = log;
            vm.bundler.resolver.log = log;
            defer {
                vm.bundler.log = old;
                vm.bundler.linker.log = old;
                vm.bundler.resolver.log = old;
            }

            var jsx = bundler.options.jsx;
            jsx.parse = false;
            var opts = js_parser.Parser.Options.init(jsx, .js);
            opts.enable_bundling = false;
            opts.transform_require_to_import = true;
            opts.can_import_from_bundle = bundler.options.node_modules_bundle != null;
            opts.features.hot_module_reloading = false;
            opts.features.react_fast_refresh = false;
            opts.filepath_hash_for_hmr = 0;
            opts.warn_about_unbundled_modules = false;
            opts.macro_context = &vm.bundler.macro_context.?;
            const main_ast = (bundler.resolver.caches.js.parse(vm.allocator, opts, bundler.options.define, bundler.log, &vm.entry_point.source) catch null) orelse {
                return error.ParseError;
            };
            var parse_result = ParseResult{ .source = vm.entry_point.source, .ast = main_ast, .loader = .js, .input_fd = null };
            var file_path = Fs.Path.init(bundler.fs.top_level_dir);
            file_path.name.dir = bundler.fs.top_level_dir;
            file_path.name.base = "bun:main";
            try bundler.linker.link(
                file_path,
                &parse_result,
                .absolute_path,
                false,
            );

            source_code_printer.ctx.reset();

            var written = try vm.bundler.print(
                parse_result,
                @TypeOf(&source_code_printer),
                &source_code_printer,
                .esm_ascii,
            );

            if (written == 0) {
                return error.PrintingErrorWriteFailed;
            }

            return ResolvedSource{
                .allocator = null,
                .source_code = ZigString.init(vm.allocator.dupe(u8, source_code_printer.ctx.written) catch unreachable),
                .specifier = ZigString.init(std.mem.span(main_file_name)),
                .source_url = ZigString.init(std.mem.span(main_file_name)),
                .hash = 0,
                .bytecodecache_fd = 0,
            };
        } else if (_specifier.len > js_ast.Macro.namespaceWithColon.len and
            strings.eqlComptimeIgnoreLen(_specifier[0..js_ast.Macro.namespaceWithColon.len], js_ast.Macro.namespaceWithColon))
        {
            if (vm.macro_entry_points.get(MacroEntryPoint.generateIDFromSpecifier(_specifier))) |entry| {
                return ResolvedSource{
                    .allocator = null,
                    .source_code = ZigString.init(entry.source.contents),
                    .specifier = ZigString.init(_specifier),
                    .source_url = ZigString.init(_specifier),
                    .hash = 0,
                    .bytecodecache_fd = 0,
                };
            }
        }

        const specifier = normalizeSpecifier(_specifier);

        std.debug.assert(std.fs.path.isAbsolute(specifier)); // if this crashes, it means the resolver was skipped.

        const path = Fs.Path.init(specifier);
        const loader = vm.bundler.options.loaders.get(path.name.ext) orelse .file;

        switch (loader) {
            .js, .jsx, .ts, .tsx, .json => {
                vm.transpiled_count += 1;
                vm.bundler.resetStore();
                const hash = http.Watcher.getHash(path.text);

                var allocator = if (vm.has_loaded) &vm.arena.allocator else vm.allocator;

                var fd: ?StoredFileDescriptorType = null;
                var package_json: ?*PackageJSON = null;

                if (vm.watcher) |watcher| {
                    if (watcher.indexOf(hash)) |index| {
                        fd = watcher.watchlist.items(.fd)[index];
                        package_json = watcher.watchlist.items(.package_json)[index];
                    }
                }

                var old = vm.bundler.log;
                vm.bundler.log = log;
                vm.bundler.linker.log = log;
                vm.bundler.resolver.log = log;

                defer {
                    vm.bundler.log = old;
                    vm.bundler.linker.log = old;
                    vm.bundler.resolver.log = old;
                }

                // this should be a cheap lookup because 24 bytes == 8 * 3 so it's read 3 machine words
                const is_node_override = specifier.len > "/bun-vfs/node_modules/".len and strings.eqlComptimeIgnoreLen(specifier[0.."/bun-vfs/node_modules/".len], "/bun-vfs/node_modules/");

                const macro_remappings = if (vm.macro_mode or !vm.has_any_macro_remappings or is_node_override)
                    MacroRemap{}
                else brk: {
                    if (package_json) |pkg| {
                        break :brk pkg.macros;
                    }

                    // TODO: find a way to pass the package_json through the resolve
                    const resolve_result = vm.bundler.resolver.resolve(vm.bundler.fs.top_level_dir, specifier, .stmt) catch break :brk MacroRemap{};

                    break :brk resolve_result.getMacroRemappings();
                };

                var fallback_source: logger.Source = undefined;

                var parse_options = Bundler.ParseOptions{
                    .allocator = allocator,
                    .path = path,
                    .loader = loader,
                    .dirname_fd = 0,
                    .file_descriptor = fd,
                    .file_hash = hash,
                    .macro_remappings = macro_remappings,
                    .jsx = vm.bundler.options.jsx,
                };

                if (is_node_override) {
                    if (NodeFallbackModules.contentsFromPath(specifier)) |code| {
                        const fallback_path = Fs.Path.initWithNamespace(specifier, "node");
                        fallback_source = logger.Source{ .path = fallback_path, .contents = code, .key_path = fallback_path };
                        parse_options.virtual_source = &fallback_source;
                    }
                }

                var parse_result = vm.bundler.parse(
                    parse_options,
                    null,
                ) orelse {
                    return error.ParseError;
                };

                const start_count = vm.bundler.linker.import_counter;
                // We _must_ link because:
                // - node_modules bundle won't be properly
                try vm.bundler.linker.link(
                    path,
                    &parse_result,
                    .absolute_path,
                    false,
                );

                if (!vm.macro_mode)
                    vm.resolved_count += vm.bundler.linker.import_counter - start_count;
                vm.bundler.linker.import_counter = 0;

                source_code_printer.ctx.reset();

                var written = try vm.bundler.print(
                    parse_result,
                    @TypeOf(&source_code_printer),
                    &source_code_printer,
                    .esm_ascii,
                );

                if (written == 0) {
                    return error.PrintingErrorWriteFailed;
                }

                return ResolvedSource{
                    .allocator = if (vm.has_loaded) vm.allocator else null,
                    .source_code = ZigString.init(vm.allocator.dupe(u8, source_code_printer.ctx.written) catch unreachable),
                    .specifier = ZigString.init(specifier),
                    .source_url = ZigString.init(path.text),
                    .hash = 0,
                    .bytecodecache_fd = 0,
                };
            },
            else => {
                return ResolvedSource{
                    .allocator = vm.allocator,
                    .source_code = ZigString.init(try strings.quotedAlloc(VirtualMachine.vm.allocator, path.pretty)),
                    .specifier = ZigString.init(path.text),
                    .source_url = ZigString.init(path.text),
                    .hash = 0,
                    .bytecodecache_fd = 0,
                };
            },
        }
    }
    pub const ResolveFunctionResult = struct {
        result: ?Resolver.Result,
        path: string,
    };

    fn _resolve(ret: *ResolveFunctionResult, global: *JSGlobalObject, specifier: string, source: string) !void {
        std.debug.assert(VirtualMachine.vm_loaded);
        std.debug.assert(VirtualMachine.vm.global == global);

        if (vm.node_modules == null and strings.eqlComptime(std.fs.path.basename(specifier), Runtime.Runtime.Imports.alt_name)) {
            ret.path = Runtime.Runtime.Imports.Name;
            return;
        } else if (vm.node_modules != null and strings.eql(specifier, bun_file_import_path)) {
            ret.path = bun_file_import_path;
            return;
        } else if (strings.eqlComptime(specifier, main_file_name)) {
            ret.result = null;
            ret.path = vm.entry_point.source.path.text;
            return;
        } else if (specifier.len > js_ast.Macro.namespaceWithColon.len and strings.eqlComptimeIgnoreLen(specifier[0..js_ast.Macro.namespaceWithColon.len], js_ast.Macro.namespaceWithColon)) {
            ret.result = null;
            ret.path = specifier;
            return;
        } else if (specifier.len > "/bun-vfs/node_modules/".len and strings.eqlComptimeIgnoreLen(specifier[0.."/bun-vfs/node_modules/".len], "/bun-vfs/node_modules/")) {
            ret.result = null;
            ret.path = specifier;
            return;
        }

        const is_special_source = strings.eqlComptime(source, main_file_name) or js_ast.Macro.isMacroPath(source);

        const result = try vm.bundler.resolver.resolve(
            if (!is_special_source) Fs.PathName.init(source).dirWithTrailingSlash() else VirtualMachine.vm.bundler.fs.top_level_dir,
            specifier,
            .stmt,
        );

        if (!vm.macro_mode) {
            vm.has_any_macro_remappings = vm.has_any_macro_remappings or brk: {
                if (result.package_json == null) break :brk false;

                break :brk result.package_json.?.macros.count() > 0;
            };
        }
        ret.result = result;
        const result_path = result.pathConst() orelse return error.ModuleNotFound;
        vm.resolved_count += 1;

        if (vm.node_modules != null and !strings.eqlComptime(result_path.namespace, "node") and result.isLikelyNodeModule()) {
            const node_modules_bundle = vm.node_modules.?;

            node_module_checker: {
                const package_json = result.package_json orelse brk: {
                    if (vm.bundler.resolver.packageJSONForResolvedNodeModule(&result)) |pkg| {
                        break :brk pkg;
                    } else {
                        break :node_module_checker;
                    }
                };

                if (node_modules_bundle.getPackageIDByName(package_json.name)) |possible_pkg_ids| {
                    const pkg_id: u32 = brk: {
                        for (possible_pkg_ids) |pkg_id| {
                            const pkg = node_modules_bundle.bundle.packages[pkg_id];
                            if (pkg.hash == package_json.hash) {
                                break :brk pkg_id;
                            }
                        }
                        break :node_module_checker;
                    };

                    const package = &node_modules_bundle.bundle.packages[pkg_id];

                    if (isDebug) {
                        std.debug.assert(strings.eql(node_modules_bundle.str(package.name), package_json.name));
                    }

                    const package_relative_path = vm.bundler.fs.relative(
                        package_json.source.path.name.dirWithTrailingSlash(),
                        result_path.text,
                    );

                    if (node_modules_bundle.findModuleIDInPackage(package, package_relative_path) == null) break :node_module_checker;

                    ret.path = bun_file_import_path;
                    return;
                }
            }
        }

        ret.path = result_path.text;
    }
    pub fn queueMicrotaskToEventLoop(
        global: *JSGlobalObject,
        microtask: *Microtask,
    ) void {
        std.debug.assert(VirtualMachine.vm_loaded);
        std.debug.assert(VirtualMachine.vm.global == global);

        vm.enqueueTask(Task.init(microtask)) catch unreachable;
    }
    pub fn resolve(res: *ErrorableZigString, global: *JSGlobalObject, specifier: ZigString, source: ZigString) void {
        var result = ResolveFunctionResult{ .path = "", .result = null };

        _resolve(&result, global, specifier.slice(), source.slice()) catch |err| {
            // This should almost always just apply to dynamic imports

            const printed = ResolveError.fmt(
                vm.allocator,
                specifier.slice(),
                source.slice(),
                err,
            ) catch unreachable;
            const msg = logger.Msg{
                .data = logger.rangeData(
                    null,
                    logger.Range.None,
                    printed,
                ),
                .metadata = .{
                    // import_kind is wrong probably
                    .resolve = .{ .specifier = logger.BabyString.in(printed, specifier.slice()), .import_kind = .stmt },
                },
            };

            {
                res.* = ErrorableZigString.err(err, @ptrCast(*c_void, ResolveError.create(vm.allocator, msg, source.slice())));
            }

            return;
        };

        res.* = ErrorableZigString.ok(ZigString.init(result.path));
    }
    pub fn normalizeSpecifier(slice_: string) string {
        var slice = slice_;
        if (slice.len == 0) return slice;

        if (strings.startsWith(slice, VirtualMachine.vm.bundler.options.origin.host)) {
            slice = slice[VirtualMachine.vm.bundler.options.origin.host.len..];
        }

        if (VirtualMachine.vm.bundler.options.origin.path.len > 1) {
            if (strings.startsWith(slice, VirtualMachine.vm.bundler.options.origin.path)) {
                slice = slice[VirtualMachine.vm.bundler.options.origin.path.len..];
            }
        }

        if (VirtualMachine.vm.bundler.options.routes.asset_prefix_path.len > 0) {
            if (strings.startsWith(slice, VirtualMachine.vm.bundler.options.routes.asset_prefix_path)) {
                slice = slice[VirtualMachine.vm.bundler.options.routes.asset_prefix_path.len..];
            }
        }

        return slice;
    }

    // This double prints
    pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
        // VirtualMachine.vm.defaultErrorHandler(promise.result(global.vm()), null);
        return JSValue.jsUndefined();
    }

    const main_file_name: string = "bun:main";
    threadlocal var errors_stack: [256]*c_void = undefined;
    pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) void {
        var log = logger.Log.init(vm.bundler.allocator);
        const spec = specifier.slice();
        const result = _fetch(global, spec, source.slice(), &log) catch |err| {
            processFetchLog(specifier, source, &log, ret, err);
            return;
        };

        if (log.errors > 0) {
            processFetchLog(specifier, source, &log, ret, error.LinkError);
            return;
        }

        if (log.warnings > 0) {
            var writer = Output.errorWriter();
            if (Output.enable_ansi_colors) {
                for (log.msgs.items) |msg| {
                    if (msg.kind == .warn) {
                        msg.writeFormat(writer, true) catch {};
                    }
                }
            } else {
                for (log.msgs.items) |msg| {
                    if (msg.kind == .warn) {
                        msg.writeFormat(writer, false) catch {};
                    }
                }
            }
        }

        ret.result.value = result;

        const specifier_blob = brk: {
            if (strings.startsWith(spec, VirtualMachine.vm.bundler.fs.top_level_dir)) {
                break :brk spec[VirtualMachine.vm.bundler.fs.top_level_dir.len..];
            }
            break :brk spec;
        };

        if (vm.has_loaded) {
            vm.blobs.temporary.put(specifier_blob, .{ .ptr = result.source_code.ptr, .len = result.source_code.len }) catch {};
        } else {
            vm.blobs.persistent.put(specifier_blob, .{ .ptr = result.source_code.ptr, .len = result.source_code.len }) catch {};
        }

        ret.success = true;
    }

    fn processFetchLog(specifier: ZigString, referrer: ZigString, log: *logger.Log, ret: *ErrorableResolvedSource, err: anyerror) void {
        switch (log.msgs.items.len) {
            0 => {
                const msg = logger.Msg{
                    .data = logger.rangeData(null, logger.Range.None, std.fmt.allocPrint(vm.allocator, "{s} while building {s}", .{ @errorName(err), specifier.slice() }) catch unreachable),
                };
                {
                    ret.* = ErrorableResolvedSource.err(err, @ptrCast(*c_void, BuildError.create(vm.bundler.allocator, msg)));
                }
                return;
            },

            1 => {
                const msg = log.msgs.items[0];
                ret.* = ErrorableResolvedSource.err(err, switch (msg.metadata) {
                    .build => BuildError.create(vm.bundler.allocator, msg).?,
                    .resolve => ResolveError.create(
                        vm.bundler.allocator,
                        msg,
                        referrer.slice(),
                    ).?,
                });
                return;
            },
            else => {
                var errors = errors_stack[0..std.math.min(log.msgs.items.len, errors_stack.len)];

                for (log.msgs.items) |msg, i| {
                    errors[i] = switch (msg.metadata) {
                        .build => BuildError.create(vm.bundler.allocator, msg).?,
                        .resolve => ResolveError.create(
                            vm.bundler.allocator,
                            msg,
                            referrer.slice(),
                        ).?,
                    };
                }

                ret.* = ErrorableResolvedSource.err(
                    err,
                    vm.global.createAggregateError(
                        errors.ptr,
                        @intCast(u16, errors.len),
                        &ZigString.init(std.fmt.allocPrint(vm.bundler.allocator, "{d} errors building \"{s}\"", .{ errors.len, specifier.slice() }) catch unreachable),
                    ).asVoid(),
                );
                return;
            },
        }
    }

    // TODO:
    pub fn deinit(this: *VirtualMachine) void {}

    pub const ExceptionList = std.ArrayList(Api.JsException);

    pub fn printException(this: *VirtualMachine, exception: *Exception, exception_list: ?*ExceptionList) void {
        if (Output.enable_ansi_colors) {
            this.printErrorlikeObject(exception.value(), exception, exception_list, true);
        } else {
            this.printErrorlikeObject(exception.value(), exception, exception_list, false);
        }
    }

    pub fn defaultErrorHandler(this: *VirtualMachine, result: JSValue, exception_list: ?*ExceptionList) void {
        if (result.isException(this.global.vm())) {
            var exception = @ptrCast(*Exception, result.asVoid());

            this.printException(exception, exception_list);
        } else if (Output.enable_ansi_colors) {
            this.printErrorlikeObject(result, null, exception_list, true);
        } else {
            this.printErrorlikeObject(result, null, exception_list, false);
        }
    }

    pub fn loadEntryPoint(this: *VirtualMachine, entry_path: string) !*JSInternalPromise {
        try this.entry_point.generate(@TypeOf(this.bundler), &this.bundler, Fs.PathName.init(entry_path), main_file_name);
        this.main = entry_path;

        var promise: *JSInternalPromise = undefined;
        // We first import the node_modules bundle. This prevents any potential TDZ issues.
        // The contents of the node_modules bundle are lazy, so hopefully this should be pretty quick.
        if (this.node_modules != null) {
            promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(std.mem.span(bun_file_import_path)));

            this.tick();

            while (promise.status(this.global.vm()) == JSPromise.Status.Pending) {
                this.tick();
            }

            if (promise.status(this.global.vm()) == JSPromise.Status.Rejected) {
                return promise;
            }

            _ = promise.result(this.global.vm());
        }

        promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(std.mem.span(main_file_name)));

        this.tick();

        while (promise.status(this.global.vm()) == JSPromise.Status.Pending) {
            this.tick();
        }

        return promise;
    }

    pub fn loadMacroEntryPoint(this: *VirtualMachine, entry_path: string, function_name: string, specifier: string, hash: i32) !*JSInternalPromise {
        var entry_point_entry = try this.macro_entry_points.getOrPut(hash);

        if (!entry_point_entry.found_existing) {
            var macro_entry_pointer: *MacroEntryPoint = this.allocator.create(MacroEntryPoint) catch unreachable;
            entry_point_entry.value_ptr.* = macro_entry_pointer;
            try macro_entry_pointer.generate(&this.bundler, Fs.PathName.init(entry_path), function_name, hash, specifier);
        }
        var entry_point = entry_point_entry.value_ptr.*;

        var promise: *JSInternalPromise = undefined;

        promise = JSModuleLoader.loadAndEvaluateModule(this.global, &ZigString.init(entry_point.source.path.text));

        this.tick();

        while (promise.status(this.global.vm()) == JSPromise.Status.Pending) {
            this.tick();
        }

        return promise;
    }

    // When the Error-like object is one of our own, it's best to rely on the object directly instead of serializing it to a ZigException.
    // This is for:
    // - BuildError
    // - ResolveError
    // If there were multiple errors, it could be contained in an AggregateError.
    // In that case, this function becomes recursive.
    // In all other cases, we will convert it to a ZigException.
    const errors_property = ZigString.init("errors");
    pub fn printErrorlikeObject(this: *VirtualMachine, value: JSValue, exception: ?*Exception, exception_list: ?*ExceptionList, comptime allow_ansi_color: bool) void {
        if (comptime @hasDecl(@import("root"), "bindgen")) {
            return;
        }

        var was_internal = false;

        defer {
            if (was_internal) {
                if (exception) |exception_| {
                    var holder = ZigException.Holder.init();
                    var zig_exception: *ZigException = holder.zigException();
                    exception_.getStackTrace(&zig_exception.stack);
                    if (zig_exception.stack.frames_len > 0) {
                        var buffered_writer = std.io.bufferedWriter(Output.errorWriter());
                        var writer = buffered_writer.writer();

                        if (Output.enable_ansi_colors) {
                            printStackTrace(@TypeOf(writer), writer, zig_exception.stack, true) catch {};
                        } else {
                            printStackTrace(@TypeOf(writer), writer, zig_exception.stack, false) catch {};
                        }

                        buffered_writer.flush() catch {};
                    }

                    if (exception_list) |list| {
                        zig_exception.addToErrorList(list) catch {};
                    }
                }
            }
        }

        if (value.isAggregateError(this.global)) {
            const AggregateErrorIterator = struct {
                pub var current_exception_list: ?*ExceptionList = null;
                pub fn iteratorWithColor(_vm: [*c]VM, globalObject: [*c]JSGlobalObject, nextValue: JSValue) callconv(.C) void {
                    iterator(_vm, globalObject, nextValue, true);
                }
                pub fn iteratorWithOutColor(_vm: [*c]VM, globalObject: [*c]JSGlobalObject, nextValue: JSValue) callconv(.C) void {
                    iterator(_vm, globalObject, nextValue, false);
                }
                inline fn iterator(_vm: [*c]VM, globalObject: [*c]JSGlobalObject, nextValue: JSValue, comptime color: bool) void {
                    VirtualMachine.vm.printErrorlikeObject(nextValue, null, current_exception_list, color);
                }
            };
            AggregateErrorIterator.current_exception_list = exception_list;
            defer AggregateErrorIterator.current_exception_list = null;
            if (comptime allow_ansi_color) {
                value.getErrorsProperty(this.global).forEach(this.global, AggregateErrorIterator.iteratorWithColor);
            } else {
                value.getErrorsProperty(this.global).forEach(this.global, AggregateErrorIterator.iteratorWithOutColor);
            }
            return;
        }

        if (js.JSValueIsObject(vm.global.ref(), value.asRef())) {
            if (js.JSObjectGetPrivate(value.asRef())) |priv| {
                was_internal = this.printErrorFromMaybePrivateData(priv, exception_list, allow_ansi_color);
                return;
            }
        }

        was_internal = this.printErrorFromMaybePrivateData(value.asRef(), exception_list, allow_ansi_color);
    }

    pub fn printErrorFromMaybePrivateData(this: *VirtualMachine, value: ?*c_void, exception_list: ?*ExceptionList, comptime allow_ansi_color: bool) bool {
        const private_data_ptr = JSPrivateDataPtr.from(value);

        switch (private_data_ptr.tag()) {
            .BuildError => {
                defer Output.flush();
                var build_error = private_data_ptr.as(BuildError);
                if (!build_error.logged) {
                    var writer = Output.errorWriter();
                    build_error.msg.formatWriter(@TypeOf(writer), writer, allow_ansi_color) catch {};
                    build_error.logged = true;
                }
                this.had_errors = this.had_errors or build_error.msg.kind == .err;
                if (exception_list != null) {
                    this.log.addMsg(
                        build_error.msg,
                    ) catch {};
                }
                return true;
            },
            .ResolveError => {
                defer Output.flush();
                var resolve_error = private_data_ptr.as(ResolveError);
                if (!resolve_error.logged) {
                    var writer = Output.errorWriter();
                    resolve_error.msg.formatWriter(@TypeOf(writer), writer, allow_ansi_color) catch {};
                    resolve_error.logged = true;
                }

                this.had_errors = this.had_errors or resolve_error.msg.kind == .err;

                if (exception_list != null) {
                    this.log.addMsg(
                        resolve_error.msg,
                    ) catch {};
                }
                return true;
            },
            else => {
                this.printErrorInstance(@intToEnum(JSValue, @intCast(i64, (@ptrToInt(value)))), exception_list, allow_ansi_color) catch |err| {
                    if (comptime isDebug) {
                        // yo dawg
                        Output.printErrorln("Error while printing Error-like object: {s}", .{@errorName(err)});
                        Output.flush();
                    }
                };
                return false;
            },
        }
    }

    pub fn printStackTrace(comptime Writer: type, writer: Writer, trace: ZigStackTrace, comptime allow_ansi_colors: bool) !void {

        // We are going to print the stack trace backwards
        const stack = trace.frames();
        if (stack.len > 0) {
            var i: i16 = 0;

            while (i < stack.len) : (i += 1) {
                const frame = stack[@intCast(usize, i)];
                const file = frame.source_url.slice();
                const func = frame.function_name.slice();
                if (file.len == 0 and func.len == 0) continue;

                try writer.print(
                    comptime Output.prettyFmt(
                        "<r>      <d>at <r>{any} <d>(<r>{any}<d>)<r>\n",
                        allow_ansi_colors,
                    ),
                    .{
                        frame.nameFormatter(
                            allow_ansi_colors,
                        ),
                        frame.sourceURLFormatter(
                            vm.bundler.fs.top_level_dir,
                            &vm.bundler.options.origin,
                            allow_ansi_colors,
                        ),
                    },
                );

                // if (!frame.position.isInvalid()) {
                //     if (func.len > 0) {
                //         writer.print(
                //             comptime Output.prettyFmt("<r><d>{s}<r> {s}{s} - {s}:{d}:{d}\n", true),
                //             .{
                //                 if (i > 1) "↓" else "↳",
                //                 frame.code_type.ansiColor(),
                //                 func,
                //                 file,
                //                 frame.position.line,
                //                 frame.position.column_start,
                //             },
                //         ) catch unreachable;
                //     } else {
                //         writer.print(comptime Output.prettyFmt("<r><d>{s}<r> {u} - {s}{s}:{d}:{d}\n", true), .{
                //             if (i > 1) "↓" else "↳",
                //             frame.code_type.emoji(),

                //             frame.code_type.ansiColor(),
                //             file,
                //             frame.position.line,
                //             frame.position.column_start,
                //         }) catch unreachable;
                //     }
                // } else {
                //     if (func.len > 0) {
                //         writer.print(
                //             comptime Output.prettyFmt("<r><d>{s}<r> {s}{s} - {s}\n", true),
                //             .{
                //                 if (i > 1) "↓" else "↳",
                //                 frame.code_type.ansiColor(),
                //                 func,
                //                 file,
                //             },
                //         ) catch unreachable;
                //     } else {
                //         writer.print(
                //             comptime Output.prettyFmt("<r><d>{s}<r> {u} - {s}{s}\n", true),
                //             .{
                //                 if (i > 1) "↓" else "↳",
                //                 frame.code_type.emoji(),
                //                 frame.code_type.ansiColor(),
                //                 file,
                //             },
                //         ) catch unreachable;
                //     }
                // }
            }
        }
    }

    pub fn printErrorInstance(this: *VirtualMachine, error_instance: JSValue, exception_list: ?*ExceptionList, comptime allow_ansi_color: bool) !void {
        var exception_holder = ZigException.Holder.init();
        var exception = exception_holder.zigException();
        error_instance.toZigException(vm.global, exception);
        if (exception_list) |list| {
            try exception.addToErrorList(list);
        }

        this.had_errors = true;

        var stderr: std.fs.File = Output.errorStream();
        var buffered = std.io.bufferedWriter(stderr.writer());
        var writer = buffered.writer();
        defer buffered.flush() catch unreachable;

        var line_numbers = exception.stack.source_lines_numbers[0..exception.stack.source_lines_len];
        var max_line: i32 = -1;
        for (line_numbers) |line| max_line = std.math.max(max_line, line);
        const max_line_number_pad = std.fmt.count("{d}", .{max_line});

        var source_lines = exception.stack.sourceLineIterator();
        var last_pad: u64 = 0;
        while (source_lines.untilLast()) |source| {
            const int_size = std.fmt.count("{d}", .{source.line});
            const pad = max_line_number_pad - int_size;
            last_pad = pad;
            writer.writeByteNTimes(' ', pad) catch unreachable;
            writer.print(
                comptime Output.prettyFmt("<r><d>{d} | <r>{s}\n", allow_ansi_color),
                .{
                    source.line,
                    std.mem.trim(u8, source.text, "\n"),
                },
            ) catch unreachable;
        }

        const name = exception.name.slice();
        const message = exception.message.slice();
        var did_print_name = false;
        if (source_lines.next()) |source| {
            if (source.text.len > 0 and exception.stack.frames()[0].position.isInvalid()) {
                defer did_print_name = true;
                var text = std.mem.trim(u8, source.text, "\n");

                writer.print(
                    comptime Output.prettyFmt(
                        "<r><d>- |<r> {s}\n",
                        allow_ansi_color,
                    ),
                    .{
                        text,
                    },
                ) catch unreachable;

                if (name.len > 0 and message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><red><b>{s}<r><d>:<r> <b>{s}<r>\n", allow_ansi_color), .{
                        name,
                        message,
                    }) catch unreachable;
                } else if (name.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{s}<r>\n", allow_ansi_color), .{name}) catch unreachable;
                } else if (message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{s}<r>\n", allow_ansi_color), .{message}) catch unreachable;
                }
            } else if (source.text.len > 0) {
                defer did_print_name = true;
                const int_size = std.fmt.count("{d}", .{source.line});
                const pad = max_line_number_pad - int_size;
                writer.writeByteNTimes(' ', pad) catch unreachable;
                const top = exception.stack.frames()[0];
                var remainder = std.mem.trim(u8, source.text, "\n");
                if (@intCast(usize, top.position.column_stop) > remainder.len) {
                    writer.print(
                        comptime Output.prettyFmt(
                            "<r><d>{d} |<r> {s}\n",
                            allow_ansi_color,
                        ),
                        .{ source.line, remainder },
                    ) catch unreachable;
                } else {
                    const prefix = remainder[0..@intCast(usize, top.position.column_start)];
                    const underline = remainder[@intCast(usize, top.position.column_start)..@intCast(usize, top.position.column_stop)];
                    const suffix = remainder[@intCast(usize, top.position.column_stop)..];

                    writer.print(
                        comptime Output.prettyFmt(
                            "<r><d>{d} |<r> {s}<red>{s}<r>{s}<r>\n<r>",
                            allow_ansi_color,
                        ),
                        .{
                            source.line,
                            prefix,
                            underline,
                            suffix,
                        },
                    ) catch unreachable;
                    var first_non_whitespace = @intCast(u32, top.position.column_start);
                    while (first_non_whitespace < source.text.len and source.text[first_non_whitespace] == ' ') {
                        first_non_whitespace += 1;
                    }
                    const indent = @intCast(usize, pad) + " | ".len + first_non_whitespace + 1;

                    writer.writeByteNTimes(' ', indent) catch unreachable;
                    writer.print(comptime Output.prettyFmt(
                        "<red><b>^<r>\n",
                        allow_ansi_color,
                    ), .{}) catch unreachable;
                }

                if (name.len > 0 and message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><red><b>{s}<r><d>:<r> <b>{s}<r>\n", allow_ansi_color), .{
                        name,
                        message,
                    }) catch unreachable;
                } else if (name.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{s}<r>\n", allow_ansi_color), .{name}) catch unreachable;
                } else if (message.len > 0) {
                    writer.print(comptime Output.prettyFmt(" <r><b>{s}<r>\n", allow_ansi_color), .{message}) catch unreachable;
                }
            }
        }

        if (!did_print_name) {
            if (name.len > 0 and message.len > 0) {
                writer.print(comptime Output.prettyFmt("<r><red><b>{s}<r><d>:<r> <b>{s}<r>\n", true), .{
                    name,
                    message,
                }) catch unreachable;
            } else if (name.len > 0) {
                writer.print(comptime Output.prettyFmt("<r><b>{s}<r>\n", true), .{name}) catch unreachable;
            } else if (message.len > 0) {
                writer.print(comptime Output.prettyFmt("<r><b>{s}<r>\n", true), .{name}) catch unreachable;
            }
        }

        try printStackTrace(@TypeOf(writer), writer, exception.stack, allow_ansi_color);
    }
};

const GetterFn = fn (
    this: anytype,
    ctx: js.JSContextRef,
    thisObject: js.JSValueRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef;
const SetterFn = fn (
    this: anytype,
    ctx: js.JSContextRef,
    thisObject: js.JSValueRef,
    prop: js.JSStringRef,
    value: js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef;

const JSProp = struct {
    get: ?GetterFn = null,
    set: ?SetterFn = null,
    ro: bool = false,
};

pub const EventListenerMixin = struct {
    threadlocal var event_listener_names_buf: [128]u8 = undefined;
    pub const List = std.ArrayList(js.JSObjectRef);
    pub const Map = std.AutoHashMap(EventListenerMixin.EventType, EventListenerMixin.List);

    pub const EventType = enum {
        fetch,
        err,

        const SizeMatcher = strings.ExactSizeMatcher(8);

        pub fn match(str: string) ?EventType {
            return switch (SizeMatcher.match(str)) {
                SizeMatcher.case("fetch") => EventType.fetch,
                SizeMatcher.case("error") => EventType.err,
                else => null,
            };
        }
    };

    pub fn emitFetchEvent(
        vm: *VirtualMachine,
        request_context: *http.RequestContext,
        comptime CtxType: type,
        ctx: *CtxType,
        comptime onError: fn (ctx: *CtxType, err: anyerror, value: JSValue, request_ctx: *http.RequestContext) anyerror!void,
    ) !void {
        defer {
            if (request_context.has_called_done) request_context.arena.deinit();
        }
        var listeners = vm.event_listeners.get(EventType.fetch) orelse (return onError(ctx, error.NoListeners, JSValue.jsUndefined(), request_context) catch {});
        if (listeners.items.len == 0) return onError(ctx, error.NoListeners, JSValue.jsUndefined(), request_context) catch {};
        const FetchEventRejectionHandler = struct {
            pub fn onRejection(_ctx: *c_void, err: anyerror, fetch_event: *FetchEvent, value: JSValue) void {
                onError(
                    @intToPtr(*CtxType, @ptrToInt(_ctx)),
                    err,
                    value,
                    fetch_event.request_context,
                ) catch {};
            }
        };

        // Rely on JS finalizer
        var fetch_event = try vm.allocator.create(FetchEvent);

        fetch_event.* = FetchEvent{
            .request_context = request_context,
            .request = Request{ .request_context = request_context },
            .onPromiseRejectionCtx = @as(*c_void, ctx),
            .onPromiseRejectionHandler = FetchEventRejectionHandler.onRejection,
        };

        var fetch_args: [1]js.JSObjectRef = undefined;
        for (listeners.items) |listener_ref| {
            var listener = @intToEnum(JSValue, @intCast(i64, @ptrToInt(listener_ref)));

            fetch_args[0] = FetchEvent.Class.make(vm.global.ref(), fetch_event);

            var result = js.JSObjectCallAsFunctionReturnValue(vm.global.ref(), listener_ref, null, 1, &fetch_args);
            var promise = JSPromise.resolvedPromise(vm.global, result);
            vm.waitForTasks();

            if (fetch_event.rejected) return;

            if (promise.status(vm.global.vm()) == .Rejected) {
                onError(ctx, error.JSError, promise.result(vm.global.vm()), fetch_event.request_context) catch {};
                return;
            } else {
                _ = promise.result(vm.global.vm());
            }

            vm.waitForTasks();

            if (fetch_event.request_context.has_called_done) {
                break;
            }
        }

        if (!fetch_event.request_context.has_called_done) {
            onError(ctx, error.FetchHandlerRespondWithNeverCalled, JSValue.jsUndefined(), fetch_event.request_context) catch {};
            return;
        }
    }

    pub fn addEventListener(
        comptime Struct: type,
    ) type {
        const Handler = struct {
            pub fn addListener(
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                argumentCount: usize,
                _arguments: [*c]const js.JSValueRef,
                exception: js.ExceptionRef,
            ) callconv(.C) js.JSValueRef {
                const arguments = _arguments[0..argumentCount];
                if (arguments.len == 0 or arguments.len == 1 or !js.JSValueIsString(ctx, arguments[0]) or !js.JSValueIsObject(ctx, arguments[arguments.len - 1]) or !js.JSObjectIsFunction(ctx, arguments[arguments.len - 1])) {
                    return js.JSValueMakeUndefined(ctx);
                }

                const name_len = js.JSStringGetLength(arguments[0]);
                if (name_len > event_listener_names_buf.len) {
                    return js.JSValueMakeUndefined(ctx);
                }

                const name_used_len = js.JSStringGetUTF8CString(arguments[0], &event_listener_names_buf, event_listener_names_buf.len);
                const name = event_listener_names_buf[0 .. name_used_len - 1];
                const event = EventType.match(name) orelse return js.JSValueMakeUndefined(ctx);
                var entry = VirtualMachine.vm.event_listeners.getOrPut(event) catch unreachable;

                if (!entry.found_existing) {
                    entry.value_ptr.* = List.initCapacity(VirtualMachine.vm.allocator, 1) catch unreachable;
                }

                var callback = arguments[arguments.len - 1];
                js.JSValueProtect(ctx, callback);
                entry.value_ptr.append(callback) catch unreachable;

                return js.JSValueMakeUndefined(ctx);
            }
        };

        return NewClass(
            Struct,
            .{
                .name = "addEventListener",
                .read_only = true,
            },
            .{
                .@"callAsFunction" = .{
                    .rfn = Handler.addListener,
                    .ts = d.ts{},
                },
            },
            .{},
        );
    }
};

pub const ResolveError = struct {
    msg: logger.Msg,
    allocator: *std.mem.Allocator,
    referrer: ?Fs.Path = null,
    logged: bool = false,

    pub fn fmt(allocator: *std.mem.Allocator, specifier: string, referrer: string, err: anyerror) !string {
        switch (err) {
            error.ModuleNotFound => {
                if (Resolver.isPackagePath(specifier)) {
                    return try std.fmt.allocPrint(allocator, "Cannot find package \"{s}\" from \"{s}\"", .{ specifier, referrer });
                } else {
                    return try std.fmt.allocPrint(allocator, "Cannot find module \"{s}\" from \"{s}\"", .{ specifier, referrer });
                }
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

    pub const Class = NewClass(
        ResolveError,
        .{
            .name = "ResolveError",
            .read_only = true,
        },
        .{},
        .{
            .@"referrer" = .{
                .@"get" = getReferrer,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"message" = .{
                .@"get" = getMessage,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"name" = .{
                .@"get" = getName,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"specifier" = .{
                .@"get" = getSpecifier,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"importKind" = .{
                .@"get" = getImportKind,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
            .@"position" = .{
                .@"get" = getPosition,
                .ro = true,
                .ts = d.ts{ .@"return" = "string" },
            },
        },
    );

    pub fn create(
        allocator: *std.mem.Allocator,
        msg: logger.Msg,
        referrer: string,
    ) js.JSObjectRef {
        var resolve_error = allocator.create(ResolveError) catch unreachable;
        resolve_error.* = ResolveError{
            .msg = msg,
            .allocator = allocator,
            .referrer = Fs.Path.init(referrer),
        };
        var ref = Class.make(VirtualMachine.vm.global.ctx(), resolve_error);
        js.JSValueProtect(VirtualMachine.vm.global.ref(), ref);
        return ref;
    }

    pub fn getPosition(
        this: *ResolveError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return BuildError.generatePositionObject(this.msg, ctx, exception);
    }

    pub fn getMessage(
        this: *ResolveError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.data.text).toValue(VirtualMachine.vm.global).asRef();
    }

    pub fn getSpecifier(
        this: *ResolveError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.metadata.resolve.specifier.slice(this.msg.data.text)).toValue(VirtualMachine.vm.global).asRef();
    }

    pub fn getImportKind(
        this: *ResolveError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(@tagName(this.msg.metadata.resolve.import_kind)).toValue(VirtualMachine.vm.global).asRef();
    }

    pub fn getReferrer(
        this: *ResolveError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (this.referrer) |referrer| {
            return ZigString.init(referrer.text).toValue(VirtualMachine.vm.global).asRef();
        } else {
            return js.JSValueMakeNull(ctx);
        }
    }

    const BuildErrorName = "ResolveError";
    pub fn getName(
        this: *ResolveError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(BuildErrorName).toValue(VirtualMachine.vm.global).asRef();
    }
};

pub const BuildError = struct {
    msg: logger.Msg,
    // resolve_result: Resolver.Result,
    allocator: *std.mem.Allocator,
    logged: bool = false,

    pub const Class = NewClass(
        BuildError,
        .{
            .name = "BuildError",
            .read_only = true,
        },
        .{},
        .{
            .@"message" = .{
                .@"get" = getMessage,
                .ro = true,
            },
            .@"name" = .{
                .@"get" = getName,
                .ro = true,
            },
            // This is called "position" instead of "location" because "location" may be confused with Location.
            .@"position" = .{
                .@"get" = getPosition,
                .ro = true,
            },
        },
    );

    pub fn create(
        allocator: *std.mem.Allocator,
        msg: logger.Msg,
        // resolve_result: *const Resolver.Result,
    ) js.JSObjectRef {
        var build_error = allocator.create(BuildError) catch unreachable;
        build_error.* = BuildError{
            .msg = msg,
            // .resolve_result = resolve_result.*,
            .allocator = allocator,
        };

        var ref = Class.make(VirtualMachine.vm.global.ref(), build_error);
        js.JSValueProtect(VirtualMachine.vm.global.ref(), ref);
        return ref;
    }

    pub fn getPosition(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return generatePositionObject(this.msg, ctx, exception);
    }

    pub const PositionProperties = struct {
        const _file = ZigString.init("file");
        var file_ptr: js.JSStringRef = null;
        pub fn file() js.JSStringRef {
            if (file_ptr == null) {
                file_ptr = _file.toJSStringRef();
            }
            return file_ptr.?;
        }
        const _namespace = ZigString.init("namespace");
        var namespace_ptr: js.JSStringRef = null;
        pub fn namespace() js.JSStringRef {
            if (namespace_ptr == null) {
                namespace_ptr = _namespace.toJSStringRef();
            }
            return namespace_ptr.?;
        }
        const _line = ZigString.init("line");
        var line_ptr: js.JSStringRef = null;
        pub fn line() js.JSStringRef {
            if (line_ptr == null) {
                line_ptr = _line.toJSStringRef();
            }
            return line_ptr.?;
        }
        const _column = ZigString.init("column");
        var column_ptr: js.JSStringRef = null;
        pub fn column() js.JSStringRef {
            if (column_ptr == null) {
                column_ptr = _column.toJSStringRef();
            }
            return column_ptr.?;
        }
        const _length = ZigString.init("length");
        var length_ptr: js.JSStringRef = null;
        pub fn length() js.JSStringRef {
            if (length_ptr == null) {
                length_ptr = _length.toJSStringRef();
            }
            return length_ptr.?;
        }
        const _lineText = ZigString.init("lineText");
        var lineText_ptr: js.JSStringRef = null;
        pub fn lineText() js.JSStringRef {
            if (lineText_ptr == null) {
                lineText_ptr = _lineText.toJSStringRef();
            }
            return lineText_ptr.?;
        }
        const _offset = ZigString.init("offset");
        var offset_ptr: js.JSStringRef = null;
        pub fn offset() js.JSStringRef {
            if (offset_ptr == null) {
                offset_ptr = _offset.toJSStringRef();
            }
            return offset_ptr.?;
        }
    };

    pub fn generatePositionObject(msg: logger.Msg, ctx: js.JSContextRef, exception: ExceptionValueRef) js.JSValueRef {
        if (msg.data.location) |location| {
            const ref = js.JSObjectMake(ctx, null, null);
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.lineText(),
                ZigString.init(location.line_text orelse "").toJSStringRef(),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.file(),
                ZigString.init(location.file).toJSStringRef(),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.namespace(),
                ZigString.init(location.namespace).toJSStringRef(),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.line(),
                js.JSValueMakeNumber(ctx, @intToFloat(f64, location.line)),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.column(),
                js.JSValueMakeNumber(ctx, @intToFloat(f64, location.column)),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.length(),
                js.JSValueMakeNumber(ctx, @intToFloat(f64, location.length)),
                0,
                exception,
            );
            js.JSObjectSetProperty(
                ctx,
                ref,
                PositionProperties.offset(),
                js.JSValueMakeNumber(ctx, @intToFloat(f64, location.offset)),
                0,
                exception,
            );
            return ref;
        }

        return js.JSValueMakeNull(ctx);
    }

    pub fn getMessage(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(this.msg.data.text).toValue(VirtualMachine.vm.global).asRef();
    }

    const BuildErrorName = "BuildError";
    pub fn getName(
        this: *BuildError,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        return ZigString.init(BuildErrorName).toValue(VirtualMachine.vm.global).asRef();
    }
};

pub const JSPrivateDataTag = JSPrivateDataPtr.Tag;
