const std = @import("std");

const Fs = @import("../../fs.zig");
const resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").ServeBundler;
const js_printer = @import("../../js_printer.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");

usingnamespace @import("./node_env_buf_map.zig");
usingnamespace @import("./base.zig");

const DefaultSpeedyDefines = struct {
    pub const Keys = struct {
        const window = "window";
    };
    pub const Values = struct {
        const window = "undefined";
    };
};

pub fn configureTransformOptionsForSpeedy(allocator: *std.mem.Allocator, _args: Api.TransformOptions) !Api.TransformOptions {
    var args = _args;

    args.platform = Api.Platform.speedy;
    args.serve = false;
    args.write = false;
    args.resolve = Api.ResolveMode.lazy;
    args.generate_node_module_bundle = false;

    // We inline process.env.* at bundle time but process.env is a proxy object which will otherwise return undefined.

    var env_map = try getNodeEnvMap(allocator);
    var env_count = env_map.count();

    if (args.define) |def| {
        for (def.keys) |key| {
            env_count += @boolToInt((env_map.get(key) == null));
        }
    }
    var needs_node_env = env_map.get("NODE_ENV") == null;
    var needs_window_undefined = true;

    var needs_regenerate = args.define == null and env_count > 0;
    if (args.define) |def| {
        if (def.keys.len != env_count) {
            needs_regenerate = true;
        }
        for (def.keys) |key| {
            if (strings.eql(key, "process.env.NODE_ENV")) {
                needs_node_env = false;
            } else if (strings.eql(key, "window")) {
                needs_window_undefined = false;
            }
        }
    }

    var extras_count = @intCast(usize, @boolToInt(needs_node_env)) + @intCast(usize, @boolToInt(needs_window_undefined));

    if (needs_regenerate) {
        var new_list = try allocator.alloc([]const u8, env_count * 2 + extras_count * 2);
        var keys = new_list[0 .. new_list.len / 2];
        var values = new_list[keys.len..];
        var new_map = Api.StringMap{
            .keys = keys,
            .values = values,
        };
        var iter = env_map.iterator();

        var last: usize = 0;
        while (iter.next()) |entry| {
            keys[last] = entry.key_ptr.*;
            var value = entry.value_ptr.*;

            if (value.len == 0 or value[0] != '"' or value[value.len - 1] != '"') {
                value = try std.fmt.allocPrint(allocator, "\"{s}\"", .{value});
            }
            values[last] = value;
            last += 1;
        }

        if (args.define) |def| {
            var from_env = keys[0..last];

            for (def.keys) |pre, i| {
                if (env_map.get(pre) != null) {
                    for (from_env) |key, j| {
                        if (strings.eql(key, pre)) {
                            values[j] = def.values[i];
                        }
                    }
                } else {
                    keys[last] = pre;
                    values[last] = def.values[i];
                    last += 1;
                }
            }
        }

        if (needs_node_env) {
            keys[last] = options.DefaultUserDefines.NodeEnv.Key;
            values[last] = options.DefaultUserDefines.NodeEnv.Value;
            last += 1;
        }

        if (needs_window_undefined) {
            keys[last] = DefaultSpeedyDefines.Keys.window;
            values[last] = DefaultSpeedyDefines.Values.window;
            last += 1;
        }

        args.define = new_map;
    }

    return args;
}

// If you read JavascriptCore/API/JSVirtualMachine.mm - https://github.com/WebKit/WebKit/blob/acff93fb303baa670c055cb24c2bad08691a01a0/Source/JavaScriptCore/API/JSVirtualMachine.mm#L101
// We can see that it's sort of like std.mem.Allocator but for JSGlobalContextRef, to support Automatic Reference Counting
// Its unavailable on Linux
pub const VirtualMachine = struct {
    const RequireCacheType = std.AutoHashMap(u32, *Module);
    // root: js.JSGlobalContextRef,
    ctx: js.JSGlobalContextRef = undefined,
    group: js.JSContextGroupRef,
    allocator: *std.mem.Allocator,
    require_cache: RequireCacheType,
    node_module_list: ?*Module.NodeModuleList,
    node_modules: ?*NodeModuleBundle = null,
    node_modules_ref: js.JSObjectRef = null,
    global: *GlobalObject,
    bundler: Bundler,
    log: *logger.Log,
    watcher: ?*http.Watcher = null,

    pub fn init(
        allocator: *std.mem.Allocator,
        _args: Api.TransformOptions,
        existing_bundle: ?*NodeModuleBundle,
        _log: ?*logger.Log,
    ) !*VirtualMachine {
        var group = js.JSContextGroupRetain(js.JSContextGroupCreate());

        var log: *logger.Log = undefined;
        if (_log) |__log| {
            log = __log;
        } else {
            log = try allocator.create(logger.Log);
        }

        var vm = try allocator.create(VirtualMachine);
        var global = try allocator.create(GlobalObject);
        vm.* = .{
            .allocator = allocator,
            .bundler = try Bundler.init(
                allocator,
                log,
                try configureTransformOptionsForSpeedy(allocator, _args),
                existing_bundle,
            ),
            .node_module_list = null,
            .log = log,
            .group = group,

            .require_cache = RequireCacheType.init(allocator),
            .global = global,
        };

        vm.bundler.configureLinker();

        global.* = GlobalObject{ .vm = vm };
        try vm.global.boot();
        vm.ctx = vm.global.ctx;

        Module.boot(vm);

        Properties.init();
        if (vm.bundler.options.node_modules_bundle) |bundle| {
            vm.node_modules = bundle;
            vm.node_module_list = try allocator.create(Module.NodeModuleList);
            try Module.NodeModuleList.create(vm, bundle, vm.node_module_list.?);
            vm.global.ctx = vm.node_module_list.?.bundle_ctx;
        }

        return vm;
    }
};



pub const Object = struct {
    ref: js.jsObjectRef,
};

pub const String = struct {
    ref: js.JSStringRef,
    len: usize,

    pub fn chars(this: *const String) []const js.JSChar {
        return js.JSStringGetCharactersPtr(this.ref)[0..js.JSStringGetLength(this.ref)];
    }

    pub fn eql(this: *const String, str: [*c]const u8) bool {
        return str.len == this.len and js.JSStringIsEqualToUTF8CString(this, str);
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

pub const Module = struct {
    path: Fs.Path,

    ref: js.JSObjectRef,

    id: js.JSValueRef = null,
    exports: js.JSValueRef = null,

    vm: *VirtualMachine,
    require_func: js.JSObjectRef = null,
    loaded: bool = false,
    exports_function: js.JSValueRef = null,

    pub var module_class: js.JSClassRef = undefined;
    pub var module_global_class: js.JSClassRef = undefined;
    pub var module_global_class_def: js.JSClassDefinition = undefined;
    pub var module_class_def: js.JSClassDefinition = undefined;

    pub const NodeModuleList = struct {
        tempbuf: []u8,
        property_names: [*]u8,
        module_property_map: []u64,
        static_functions: [1]js.JSStaticFunction,
        property_getters: []js.JSObjectRef,

        node_module_global_class: js.JSClassRef,
        node_module_global_class_def: js.JSClassDefinition,
        vm: *VirtualMachine,

        // This is probably a mistake.
        bundle_ctx: js.JSGlobalContextRef,

        require_cache: []?*Module,

        exports_function_call: js.JSObjectRef = null,
        console: js.JSObjectRef = null,

        const RequireBundleClassName = "requireFromBundle";
        var require_bundle_class_def: js.JSClassDefinition = undefined;
        var require_bundle_class_ref: js.JSClassRef = undefined;
        var require_bundle_class_loaded = false;

        pub fn loadBundledModuleById(node_module_list: *NodeModuleList, id: u32, call_ctx: js.JSContextRef) !*Module {
            if (node_module_list.require_cache[id]) |mod| {
                return mod;
            }

            var module = try node_module_list.vm.allocator.create(Module);
            node_module_list.require_cache[id] = module;
            errdefer node_module_list.vm.allocator.destroy(module);

            try Module.NodeModuleList.Instance.evalBundledModule(
                module,
                node_module_list.vm.allocator,
                node_module_list.vm,
                node_module_list,
                id,
                call_ctx,
            );

            return module;
        }

        pub const Instance = struct {
            module: Module,
            node_module_list: *NodeModuleList,

            threadlocal var source_code_buffer: MutableString = undefined;
            threadlocal var source_code_buffer_loaded = false;

            pub fn evalBundledModule(
                module: *Module,
                allocator: *std.mem.Allocator,
                vm: *VirtualMachine,
                node_module_list: *NodeModuleList,
                id: u32,
                call_ctx: js.JSContextRef,
            ) !void {
                const bundled_module = &vm.node_modules.?.bundle.modules[id];
                const total_length = bundled_module.code.length + 1;
                if (!source_code_buffer_loaded) {
                    source_code_buffer = try MutableString.init(allocator, total_length);
                    source_code_buffer_loaded = true;
                } else {
                    source_code_buffer.reset();
                    source_code_buffer.growIfNeeded(total_length) catch {};
                }

                source_code_buffer.list.resize(allocator, total_length) catch unreachable;

                var node_module_file = std.fs.File{ .handle = vm.node_modules.?.fd };
                const read = try node_module_file.pread(source_code_buffer.list.items, bundled_module.code.offset);
                var buf = source_code_buffer.list.items[0..read];

                const bundled_package = &vm.node_modules.?.bundle.packages[bundled_module.package_id];
                // We want linear because we expect it to virtually always be at 0
                // However, out of caution we check.

                var start_at: usize = std.mem.indexOfPosLinear(u8, buf, 0, "export var $") orelse return error.FailedCorruptNodeModuleMissingExport;
                start_at += "export var $".len;
                // export var $fooo = $$m("packageName", "id", (module, exports) => {
                //                                    ^
                start_at = std.mem.indexOfPosLinear(
                    u8,
                    buf,
                    start_at,
                    "\",",
                ) orelse return error.FailedCorruptNodeModuleMissingModuleWrapper;
                start_at += 1;

                // export var $fooo = $$m("packageName", "id", (module, exports) => {
                //                                          ^
                start_at = std.mem.indexOfPosLinear(
                    u8,
                    buf,
                    start_at,
                    "\",",
                ) orelse return error.FailedCorruptNodeModuleMissingModuleWrapper;
                start_at += 1;
                start_at = std.mem.indexOfPosLinear(
                    u8,
                    buf,
                    start_at,
                    "=>",
                ) orelse return error.FailedCorruptNodeModuleMissingModuleWrapper;
                start_at += 2;
                // (module, exports) => {
                //                   ^
                start_at = std.mem.indexOfPosLinear(
                    u8,
                    buf,
                    start_at,
                    "{",
                ) orelse return error.FailedCorruptNodeModuleMissingModuleWrapper;
                start_at += 1;
                // (module, exports) => {
                //
                // ^
                var curr_buf = buf[start_at..];
                curr_buf = curr_buf[0 .. std.mem.lastIndexOfScalar(u8, curr_buf, ';') orelse return error.FailedCorruptNodeModuleMissingModuleWrapper];
                curr_buf = curr_buf[0 .. std.mem.lastIndexOfScalar(u8, curr_buf, ')') orelse return error.FailedCorruptNodeModuleMissingModuleWrapper];
                curr_buf = curr_buf[0 .. std.mem.lastIndexOfScalar(u8, curr_buf, '}') orelse return error.FailedCorruptNodeModuleMissingModuleWrapper];
                curr_buf.ptr[curr_buf.len] = 0;
                var source_buf = curr_buf.ptr[0..curr_buf.len :0];
                var source_url_buf = try std.fmt.allocPrint(
                    allocator,
                    "{s}/{s}",
                    .{
                        vm.node_modules.?.str(bundled_package.name),
                        vm.node_modules.?.str(bundled_module.path),
                    },
                );
                errdefer allocator.free(source_url_buf);

                var exception: js.JSValueRef = null;
                try Module.load(
                    module,
                    vm,
                    allocator,
                    vm.log,
                    source_buf,
                    Fs.Path.initWithPretty(source_url_buf, source_url_buf),
                    node_module_list.bundle_ctx,
                    call_ctx,
                    call_ctx,
                    &exception,
                );
            }
        };

        pub const RequireBundledModule = struct {
            id: u32,
            list: *NodeModuleList,
        };

        // key: hash of module.path
        // value: index of module
        const ModuleIDMap = hash_map.AutoHashMap(u64, u32);

        pub fn initializeGlobal(ctx: JSContextRef, obj: JSObjectRef) callconv(.C) void {}

        pub fn getRequireFromBundleProperty(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            prop: js.JSStringRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            var thisPtr = js.JSObjectGetPrivate(thisObject);
            if (thisPtr == null) return null;

            var this = @ptrCast(
                *NodeModuleList,
                @alignCast(
                    @alignOf(
                        *NodeModuleList,
                    ),
                    thisPtr.?,
                ),
            );

            std.mem.set(u8, this.tempbuf, 0);
            const size = js.JSStringGetUTF8CString(prop, this.tempbuf.ptr, this.tempbuf.len);
            const key = std.hash.Wyhash.hash(0, this.tempbuf);
            const id = @intCast(u32, std.mem.indexOfScalar(u64, this.module_property_map, key) orelse return null);

            if (this.property_getters[id] == null) {
                if (!require_bundle_class_loaded) {
                    require_bundle_class_def = js.kJSClassDefinitionEmpty;
                    require_bundle_class_def.className = RequireBundleClassName[0.. :0];
                    require_bundle_class_def.callAsFunction = To.JS.Callback(RequireBundledModule, requireBundledModule).rfn;
                    require_bundle_class_ref = js.JSClassRetain(js.JSClassCreate(&require_bundle_class_def));
                    require_bundle_class_loaded = true;
                }

                // TODO: remove this allocation by ptr casting
                var require_from_bundle = this.vm.allocator.create(RequireBundledModule) catch unreachable;
                require_from_bundle.* = RequireBundledModule{
                    .list = this,
                    .id = id,
                };
                this.property_getters[id] = js.JSObjectMake(this.bundle_ctx, require_bundle_class_ref, require_from_bundle);
                js.JSValueProtect(this.bundle_ctx, this.property_getters[id]);
            }

            return this.property_getters[id];
        }

        // this is what $aosdi123() inside a node_modules.jsb calls
        pub fn requireBundledModule(
            obj: *RequireBundledModule,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            const bundle = &obj.list.vm.node_modules.?.bundle;
            const bundled_module = &bundle.modules[obj.id];
            const bundled_pkg = &bundle.packages[bundled_module.package_id];
            var module = loadBundledModuleById(obj.list, obj.id, obj.list.bundle_ctx) catch |err| {
                Output.prettyErrorln("<r><red>RequireError<r>: <b>{s}<r> in \"<cyan>{s}/{s}<r>\"", .{
                    @errorName(err),
                    obj.list.vm.node_modules.?.str(bundled_pkg.name),
                    obj.list.vm.node_modules.?.str(bundled_module.path),
                });
                var message = std.fmt.allocPrintZ(obj.list.vm.allocator, "RequireError: {s} in \"{s}/{s}\"", .{
                    @errorName(err),
                    obj.list.vm.node_modules.?.str(bundled_pkg.name),
                    obj.list.vm.node_modules.?.str(bundled_module.path),
                }) catch unreachable;
                defer Output.flush();
                defer obj.list.vm.allocator.free(message);
                var args = obj.list.vm.allocator.alloc(js.JSStringRef, 1) catch unreachable;
                args[0] = js.JSStringCreateWithUTF8CString(message.ptr);
                exception.* = js.JSObjectMakeError(ctx, 1, args.ptr, null);
                return js.JSValueMakeUndefined(ctx);
            };

            return module.internalGetExports(js.JSContextGetGlobalContext(ctx));
        }

        pub fn getConsole(
            ctx: js.JSContextRef,
            thisObject: js.JSObjectRef,
            prop: js.JSStringRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            var this = @ptrCast(
                *NodeModuleList,
                @alignCast(@alignOf(*NodeModuleList), js.JSObjectGetPrivate(thisObject) orelse return null),
            );

            if (this.console == null) {
                this.console = js.JSObjectMake(js.JSContextGetGlobalContext(ctx), this.vm.global.console_class, this.vm.global);
            }

            return this.console;
        }

        pub fn create(vm: *VirtualMachine, bundle: *const NodeModuleBundle, node_module_list: *NodeModuleList) !void {
            var size: usize = 0;
            var longest_size: usize = 0;
            for (bundle.bundle.modules) |module, i| {
                // Add one for null-terminated string offset
                const this_size = std.fmt.count(
                    "${x}" ++ "\\x0",
                    .{
                        module.id,
                    },
                );
                size += this_size;
                longest_size = std.math.max(this_size, longest_size);
            }
            var static_properties = try vm.allocator.alloc(js.JSStaticValue, bundle.bundle.modules.len + 2);
            static_properties[static_properties.len - 2] = js.JSStaticValue{
                .name = Properties.UTF8.console[0.. :0],
                .getProperty = getConsole,
                .setProperty = null,
                .attributes = .kJSPropertyAttributeNone,
            };
            static_properties[static_properties.len - 1] = std.mem.zeroes(js.JSStaticValue);
            var utf8 = try vm.allocator.alloc(u8, size + std.math.max(longest_size, 32));
            std.mem.set(u8, utf8, 0);
            var tempbuf = utf8[size..];

            var names_buf = utf8[0..size];
            var module_property_map = try vm.allocator.alloc(u64, bundle.bundle.modules.len);

            for (bundle.bundle.modules) |module, i| {
                var hasher = std.hash.Wyhash.init(0);

                const hash = @truncate(
                    u32,
                    module.id,
                );

                // The variable name is the hash of the module path
                var name = std.fmt.bufPrint(names_buf, "${x}", .{hash}) catch unreachable;
                std.mem.set(u8, tempbuf, 0);
                std.mem.copy(u8, tempbuf, name);
                name.ptr[name.len] = 0;

                // But we don't store that for the hash map. Instead, we store the hash of name.
                // This lets us avoid storing pointers to the name in the hash table, so if we free it later
                // or something it won't cause issues.

                module_property_map[i] = std.hash.Wyhash.hash(0, tempbuf);
                static_properties[i] = js.JSStaticValue{
                    .name = name.ptr,
                    .getProperty = getRequireFromBundleProperty,
                    .setProperty = null,
                    .attributes = .kJSPropertyAttributeReadOnly,
                };
                names_buf = names_buf[name.len + 1 ..];
            }

            var node_module_global_class_def = js.kJSClassDefinitionEmpty;
            node_module_global_class_def.staticValues = static_properties.ptr;
            node_module_global_class_def.className = node_module_global_class_name[0.. :0];
            // node_module_global_class_def.parentClass = vm.global.global_class;

            var property_getters = try vm.allocator.alloc(js.JSObjectRef, bundle.bundle.modules.len);
            std.mem.set(js.JSObjectRef, property_getters, null);

            node_module_list.* = NodeModuleList{
                .module_property_map = module_property_map,
                .node_module_global_class_def = node_module_global_class_def,
                .vm = vm,
                .tempbuf = tempbuf,
                .property_names = utf8.ptr,
                .bundle_ctx = undefined,
                .property_getters = property_getters,
                .node_module_global_class = undefined,
                .static_functions = undefined,
                .require_cache = try vm.allocator.alloc(?*Module, bundle.bundle.modules.len),
            };

            std.mem.set(?*Module, node_module_list.require_cache, null);

            // node_module_list.staticFunctions[0] = js.JSStaticFunction{
            //     .name = Properties.UTF8.initialize_bundled_module[0.. :0],
            //     .callAsFunction = To.JS.Callback(NodeModuleList, initializeNodeModule),
            // };
            // node_module_global_class_def.staticFunctions = &node_module_list.static_functions;
            node_module_list.node_module_global_class_def = node_module_global_class_def;
            node_module_list.node_module_global_class = js.JSClassRetain(js.JSClassCreate(&node_module_list.node_module_global_class_def));
            node_module_list.bundle_ctx = js.JSGlobalContextRetain(js.JSGlobalContextCreateInGroup(vm.group, node_module_list.node_module_global_class));
            _ = js.JSObjectSetPrivate(js.JSContextGetGlobalObject(node_module_list.bundle_ctx), node_module_list);
        }
    };
    pub const node_module_global_class_name = "NodeModuleGlobal";

    threadlocal var require_buf: MutableString = undefined;
    threadlocal var require_buf_loaded: bool = false;

    pub fn callExportsAsFunction(
        this: *Module,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (js.JSObjectIsFunction(ctx, this.exports_function)) {
            return js.JSObjectCallAsFunction(ctx, this.exports_function, this.ref, arguments.len, arguments.ptr, exception);
        }

        return this.exports;
    }

    pub fn require(
        this: *Module,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        if (arguments.len != 1 or !js.JSValueIsString(ctx, arguments[0]) or js.JSStringGetMaximumUTF8CStringSize(arguments[0]) == 0) {
            defer Output.flush();
            if (arguments.len == 0) {
                Output.prettyErrorln("<r><red>error<r>: <b>require<r> needs a string, e.g. require(\"left-pad\")", .{});
            } else if (arguments.len > 1) {
                Output.prettyErrorln("<r><red>error<r>: <b>require<r> only accepts one argument and it must be a string, e.g. require(\"left-pad\")", .{});
            } else if (!js.JSValueIsString(ctx, arguments[0])) {
                Output.prettyErrorln("<r><red>error<r>: <b>require<r> only supports a string, e.g. require(\"left-pad\")", .{});
            } else {
                Output.prettyErrorln("<r><red>error<r>: <b>require(\"\")<r> string cannot be empty.", .{});
            }
            exception.* = js.JSObjectMakeError(ctx, 0, null, null);
            return null;
        }

        const len = js.JSStringGetLength(arguments[0]);

        if (!require_buf_loaded) {
            require_buf = MutableString.init(this.vm.allocator, len + 1) catch unreachable;
            require_buf_loaded = true;
        } else {
            require_buf.reset();
            require_buf.growIfNeeded(len + 1) catch {};
        }

        require_buf.list.resize(this.vm.allocator, len + 1) catch unreachable;

        // var require_buf_ = this.vm.allocator.alloc(u8, len + 1) catch unreachable;
        // var end = js.JSStringGetUTF8CString(arguments[0], require_buf_.ptr, require_buf_.len);
        var end = js.JSStringGetUTF8CString(arguments[0], require_buf.list.items.ptr, require_buf.list.items.len);
        var import_path = require_buf.list.items[0 .. end - 1];
        var module = this;

        if (this.vm.bundler.linker.resolver.resolve(module.path.name.dirWithTrailingSlash(), import_path, .require)) |resolved| {
            var load_result = Module.loadFromResolveResult(this.vm, ctx, resolved, exception) catch |err| {
                return null;
            };

            switch (load_result) {
                .Module => |new_module| {
                    // if (isDebug) {
                    //     Output.prettyln(
                    //         "Input: {s}\nOutput: {s}",
                    //         .{ import_path, load_result.Module.path.text },
                    //     );
                    //     Output.flush();
                    // }
                    return new_module.internalGetExports(js.JSContextGetGlobalContext(ctx));
                },
                .Path => |path| {
                    return js.JSStringCreateWithUTF8CString(path.text.ptr);
                },
            }
        } else |err| {
            Output.prettyErrorln(
                "<r><red>RequireError<r>: Failed to load module <b>\"{s}\"<r> at \"{s}\": <red>{s}<r>",
                .{ import_path, module.path.name.dirWithTrailingSlash(), @errorName(err) },
            );
            Output.flush();
            exception.* = js.JSObjectMakeError(ctx, 0, null, null);
            return null;
        }
    }

    const ModuleClass = NewClass(
        Module,
        "Module",
        .{ .@"require" = require },
        .{
            .@"id" = .{
                .get = getId,
                .ro = true,
            },
            .@"loaded" = .{
                .get = getLoaded,
                .ro = true,
            },
            .@"exports" = .{
                .get = getExports,
                .set = setExports,
                .ro = false,
            },
        },
        false,
        false,
    );

    const ExportsClassName = "module.exports";
    var ExportsClass: js.JSClassDefinition = undefined;
    var exports_class_ref: js.JSClassRef = undefined;

    pub fn boot(vm: *VirtualMachine) void {
        ExportsClass = std.mem.zeroes(js.JSClassDefinition);
        ExportsClass.className = ExportsClassName[0.. :0];
        ExportsClass.callAsFunction = To.JS.Callback(Module, callExportsAsFunction).rfn;
        // ExportsClass.callAsConstructor = To.JS.Callback(Module, callExportsAsConstructor);

        exports_class_ref = js.JSClassRetain(js.JSClassCreate(&ExportsClass));

        module_class_def = ModuleClass.define();
        module_class = js.JSClassRetain(js.JSClassCreate(&module_class_def));
    }

    pub const LoadResult = union(Tag) {
        Module: *Module,
        Path: Fs.Path,

        pub const Tag = enum {
            Module,
            Path,
        };
    };

    threadlocal var source_code_printer: js_printer.BufferPrinter = undefined;
    threadlocal var source_code_printer_loaded: bool = false;
    var require_module_params: [3]js.JSStringRef = undefined;
    var require_module_params_loaded: bool = false;
    threadlocal var module_wrapper_params: [2]js.JSStringRef = undefined;
    threadlocal var module_wrapper_loaded = false;

    pub fn load(
        module: *Module,
        vm: *VirtualMachine,
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        source: [:0]u8,
        path: Fs.Path,
        global_ctx: js.JSContextRef,
        call_ctx: js.JSContextRef,
        function_ctx: js.JSContextRef,
        exception: js.ExceptionRef,
    ) !void {
        var source_code_ref = js.JSStringCreateWithUTF8CString(source.ptr);
        defer js.JSStringRelease(source_code_ref);
        var source_url = try allocator.dupeZ(u8, path.text);
        defer allocator.free(source_url);
        var source_url_ref = js.JSStringCreateWithUTF8CString(source_url.ptr);
        defer js.JSStringRelease(source_url_ref);

        if (isDebug) {
            Output.print("// {s}\n{s}", .{ path.pretty, source });
            Output.flush();
        }

        module.* = Module{
            .path = path,
            .ref = undefined,
            .vm = vm,
        };
        module.ref = js.JSObjectMake(global_ctx, Module.module_class, module);
        js.JSValueProtect(global_ctx, module.ref);
        // if (!module_wrapper_loaded) {
        module_wrapper_params[0] = js.JSStringRetain(js.JSStringCreateWithUTF8CString(Properties.UTF8.module[0.. :0]));
        module_wrapper_params[1] = js.JSStringRetain(js.JSStringCreateWithUTF8CString(Properties.UTF8.exports[0.. :0]));
        //     module_wrapper_loaded = true;
        // }

        var module_wrapper_args: [2]js.JSValueRef = undefined;
        module_wrapper_args[0] = module.ref;
        module_wrapper_args[1] = module.internalGetExports(global_ctx);
        js.JSValueProtect(global_ctx, module_wrapper_args[1]);

        var except: js.JSValueRef = null;
        go: {
            var commonjs_wrapper = js.JSObjectMakeFunction(
                global_ctx,
                null,
                @truncate(c_uint, module_wrapper_params.len),
                &module_wrapper_params,
                source_code_ref,
                null,
                1,
                &except,
            );
            js.JSValueProtect(global_ctx, commonjs_wrapper);
            if (except != null) {
                break :go;
            }

            // var module = {exports: {}}; ((module, exports) => {
            _ = js.JSObjectCallAsFunction(call_ctx, commonjs_wrapper, null, 2, &module_wrapper_args, &except);
            // module.exports = exports;
            // })(module, module.exports);

            // module.exports = module_wrapper_args[1];

            js.JSValueUnprotect(global_ctx, commonjs_wrapper);
        }
        if (except != null) {
            var message = js.JSValueToStringCopy(function_ctx, except.?, null);
            defer js.JSStringRelease(message);
            var message_str_size = js.JSStringGetMaximumUTF8CStringSize(message);
            var message_str_buf = try allocator.alloc(u8, message_str_size);
            defer allocator.free(message_str_buf);
            var message_str_read = js.JSStringGetUTF8CString(message, message_str_buf.ptr, message_str_size);
            defer Output.flush();
            log.addErrorFmt(null, logger.Loc.Empty, allocator, "Error loading \"{s}\":\n{s}", .{
                path.pretty,
                message_str_buf[0..message_str_read],
            }) catch {};
            Output.prettyErrorln("<r>{s}\n--<r><red>error<r> loading <cyan>\"{s}\"<r>--", .{
                message_str_buf[0..message_str_read],
                path.pretty,
            });
            return error.FailedException;
        }

        module.loaded = true;
    }

    pub fn loadFromResolveResult(
        vm: *VirtualMachine,
        ctx: js.JSContextRef,
        resolved: resolver.Result,
        exception: js.ExceptionRef,
    ) !LoadResult {
        const hash = http.Watcher.getHash(resolved.path_pair.primary.text);
        if (vm.require_cache.get(hash)) |mod| {
            return LoadResult{ .Module = mod };
        }

        const path = resolved.path_pair.primary;
        const loader: options.Loader = brk: {
            if (resolved.is_external) {
                break :brk options.Loader.file;
            }

            break :brk vm.bundler.options.loaders.get(path.name.ext) orelse .file;
        };

        switch (loader) {
            .js,
            .jsx,
            .ts,
            .tsx,
            .json,
            => {
                if (vm.node_modules) |node_modules| {
                    const package_json_ = resolved.package_json orelse brk: {
                        // package_json is sometimes null when we're loading as an absolute path
                        if (resolved.isLikelyNodeModule()) {
                            break :brk vm.bundler.resolver.packageJSONForResolvedNodeModule(&resolved);
                        }
                        break :brk null;
                    };

                    if (package_json_) |package_json| {
                        if (package_json.hash > 0) {
                            if (node_modules.getPackageIDByName(package_json.name)) |possible_package_ids| {
                                const package_id: ?u32 = brk: {
                                    for (possible_package_ids) |pid| {
                                        const pkg = node_modules.bundle.packages[pid];
                                        if (pkg.hash == package_json.hash) {
                                            break :brk pid;
                                        }
                                    }

                                    break :brk null;
                                };

                                if (package_id) |pid| {
                                    const package_relative_path = vm.bundler.fs.relative(
                                        package_json.source.path.name.dirWithTrailingSlash(),
                                        path.text,
                                    );

                                    if (node_modules.findModuleIDInPackage(
                                        &node_modules.bundle.packages[pid],
                                        package_relative_path,
                                    )) |id| {
                                        var list = vm.node_module_list.?;
                                        return LoadResult{ .Module = try list.loadBundledModuleById(id + node_modules.bundle.packages[pid].modules_offset, ctx) };
                                    }
                                }
                            }
                        }
                    }
                }

                vm.bundler.resetStore();
                var fd: ?StoredFileDescriptorType = null;

                if (vm.watcher) |watcher| {
                    if (watcher.indexOf(hash)) |index| {
                        fd = watcher.watchlist.items(.fd)[index];
                    }
                }

                var parse_result = vm.bundler.parse(
                    vm.bundler.allocator,
                    path,
                    loader,
                    resolved.dirname_fd,
                    fd,
                    hash,
                ) orelse {
                    return error.ParseError;
                };

                if (!source_code_printer_loaded) {
                    var writer = try js_printer.BufferWriter.init(vm.allocator);
                    source_code_printer = js_printer.BufferPrinter.init(writer);
                    source_code_printer.ctx.append_null_byte = true;

                    source_code_printer_loaded = true;
                }

                source_code_printer.ctx.reset();

                // We skip the linker here.
                // var old_linker_allocator = vm.bundler.linker.allocator;
                // defer vm.bundler.linker.allocator = old_linker_allocator;
                // vm.bundler.linker.allocator = vm.allocator;
                // // Always use absolute paths
                // // This makes the resolver faster
                // try vm.bundler.linker.link(
                //     Fs.Path.init(path.text),
                //     &parse_result,
                //     .absolute_path,
                // );

                var written = try vm.bundler.print(
                    parse_result,
                    @TypeOf(&source_code_printer),
                    &source_code_printer,
                    .speedy,
                );

                if (written == 0) {
                    return error.PrintingErrorWriteFailed;
                }
                var module = try vm.allocator.create(Module);
                errdefer vm.allocator.destroy(module);
                try vm.require_cache.put(hash, module);

                try Module.load(
                    module,
                    vm,
                    vm.allocator,
                    vm.log,
                    source_code_printer.ctx.sentinel,
                    path,
                    js.JSContextGetGlobalContext(ctx),
                    ctx,
                    ctx,
                    exception,
                );

                return LoadResult{ .Module = module };
            },

            // Replace imports to non-executables with paths to those files.
            // In SSR or on web, these become URLs.
            // Otherwise, absolute file paths.
            else => {
                switch (vm.bundler.options.import_path_format) {
                    .absolute_path => {
                        return LoadResult{ .Path = path };
                    },
                    .absolute_url => {
                        var fs = vm.bundler.fs;

                        var base = fs.relativeTo(path.text);
                        if (strings.lastIndexOfChar(base, '.')) |dot| {
                            base = base[0..dot];
                        }

                        var dirname = std.fs.path.dirname(base) orelse "";

                        var basename = std.fs.path.basename(base);

                        const needs_slash = dirname.len > 0 and dirname[dirname.len - 1] != '/';

                        if (needs_slash) {
                            const absolute_url = try std.fmt.allocPrintZ(
                                vm.allocator,
                                "{s}{s}/{s}{s}",
                                .{
                                    vm.bundler.options.public_url,
                                    dirname,
                                    basename,
                                    path.name.ext,
                                },
                            );

                            return LoadResult{
                                .Path = Fs.Path.initWithPretty(absolute_url, absolute_url),
                            };
                        } else {
                            const absolute_url = try std.fmt.allocPrintZ(
                                vm.allocator,
                                "{s}{s}{s}{s}",
                                .{
                                    vm.bundler.options.public_url,
                                    dirname,
                                    basename,
                                    path.name.ext,
                                },
                            );

                            return LoadResult{
                                .Path = Fs.Path.initWithPretty(absolute_url, absolute_url),
                            };
                        }
                    },
                    else => unreachable,
                }
            },
        }
    }

    pub fn getLoaded(
        this: *Module,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) callconv(.C) js.JSValueRef {
        return js.JSValueMakeBoolean(ctx, this.loaded);
    }

    pub fn getId(
        this: *Module,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) callconv(.C) js.JSValueRef {
        if (this.id == null) {
            this.id = js.JSStringCreateWithUTF8CString(this.path.text.ptr);
        }

        return this.id;
    }

    pub fn getExports(
        this: *Module,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: js.ExceptionRef,
    ) callconv(.C) js.JSValueRef {
        return this.exports;
    }

    pub fn internalGetExports(this: *Module, globalContext: js.JSContextRef) js.JSValueRef {
        if (this.exports == null) {
            this.exports = js.JSObjectMake(globalContext, exports_class_ref, this);
        }

        return this.exports;
    }

    pub fn internalGetRequire(this: *Module) js.JSValueRef {
        if (this.require_func == null) {
            this.require_func = To.JS.functionWithCallback(
                Module,
                this,
                Properties.Refs.require,
                this.vm.global.ctx,
                require,
            );
        }

        return this.require_func;
    }

    pub fn setExports(
        this: *Module,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        value: js.JSValueRef,
        exception: js.ExceptionRef,
    ) bool {
        if (this.exports != null) {
            if (js.JSValueIsString(this.vm.global.ctx, this.exports)) {
                js.JSStringRelease(this.exports);
            }
        }
        switch (js.JSValueGetType(ctx, value)) {
            .kJSTypeObject => {
                if (js.JSValueIsObjectOfClass(ctx, value, exports_class_ref)) {
                    var other = @ptrCast(
                        *Module,
                        @alignCast(
                            @alignOf(
                                *Module,
                            ),
                            js.JSObjectGetPrivate(value).?,
                        ),
                    );

                    if (other != this) {
                        this.exports = other.exports;
                    }

                    return true;
                } else {
                    if (js.JSObjectIsFunction(ctx, value)) {
                        this.exports_function = value;
                    }
                }
            },
            else => {},
        }

        this.exports = value;

        return true;
    }

    pub const RequireObject = struct {};
};

pub const GlobalObject = struct {
    ref: js.JSObjectRef = undefined,
    vm: *VirtualMachine,
    ctx: js.JSGlobalContextRef = undefined,
    console_class: js.JSClassRef = undefined,
    console: js.JSObjectRef = undefined,
    console_definition: js.JSClassDefinition = undefined,
    global_class_def: js.JSClassDefinition = undefined,
    global_class: js.JSClassRef = undefined,

    pub const ConsoleClass = NewClass(
        GlobalObject,
        "Console",
        .{
            .@"log" = stdout,
            .@"info" = stdout,
            .@"debug" = stdout,
            .@"verbose" = stdout,

            .@"error" = stderr,
            .@"warn" = stderr,
        },
        .{},
        // people sometimes modify console.log, let them.
        false,
        true,
    );

    pub const GlobalClass = NewClass(
        GlobalObject,
        "Global",
        .{},
        .{
            .@"console" = getConsole,
        },
        false,
        false,
    );

    pub fn getConsole(
        global: *GlobalObject,
        ctx: js.JSContextRef,
        obj: js.JSObjectRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        // if (global.console == null) {
        //     global.console = js.JSObjectMake(js.JSContextGetGlobalContext(ctx), global.console_class, global);
        //     js.JSValueProtect(js.JSContextGetGlobalContext(ctx), global.console);
        // }

        return js.JSObjectMake(js.JSContextGetGlobalContext(ctx), global.console_class, global);
    }

    pub fn boot(global: *GlobalObject) !void {
        global.console_definition = ConsoleClass.define();
        global.console_class = js.JSClassRetain(js.JSClassCreate(&global.console_definition));

        global.global_class_def = GlobalClass.define();
        global.global_class = js.JSClassRetain(js.JSClassCreate(&global.global_class_def));

        global.ctx = js.JSGlobalContextRetain(js.JSGlobalContextCreateInGroup(global.vm.group, global.global_class));

        std.debug.assert(js.JSObjectSetPrivate(js.JSContextGetGlobalObject(global.ctx), global));

        if (!printer_buf_loaded) {
            printer_buf_loaded = true;
            printer_buf = try MutableString.init(global.vm.allocator, 4096);
        }
    }

    threadlocal var printer_buf: MutableString = undefined;
    threadlocal var printer_buf_loaded: bool = false;
    fn valuePrinter(comptime ValueType: js.JSType, ctx: js.JSContextRef, arg: js.JSValueRef, writer: anytype) !void {
        switch (ValueType) {
            .kJSTypeUndefined => {
                try writer.writeAll("undefined");
            },
            .kJSTypeNull => {
                try writer.writeAll("null");
            },
            .kJSTypeBoolean => {
                if (js.JSValueToBoolean(ctx, arg)) {
                    try writer.writeAll("true");
                } else {
                    try writer.writeAll("false");
                }
            },
            .kJSTypeNumber => {
                try writer.print(
                    "{d}",
                    .{js.JSValueToNumber(ctx, arg, null)},
                );
            },
            .kJSTypeString => {
                printer_buf.reset();
                var string_ref = js.JSValueToStringCopy(ctx, arg, null);
                const len = js.JSStringGetMaximumUTF8CStringSize(string_ref) + 1;

                printer_buf.growIfNeeded(len) catch {};
                printer_buf.inflate(len) catch {};
                var slice = printer_buf.toOwnedSliceLeaky();

                defer js.JSStringRelease(string_ref);
                const used = js.JSStringGetUTF8CString(string_ref, slice.ptr, slice.len);
                try writer.writeAll(slice[0..used]);
            },
            .kJSTypeObject => {
                // TODO:
                try writer.writeAll("[Object object]");
            },
            .kJSTypeSymbol => {
                var description = js.JSObjectGetPropertyForKey(ctx, arg, Properties.Refs.description, null);
                return switch (js.JSValueGetType(ctx, description)) {
                    .kJSTypeString => try valuePrinter(.kJSTypeString, ctx, js.JSStringRetain(description), writer),
                    else => try valuePrinter(.kJSTypeUndefined, ctx, js.JSStringRetain(description), writer),
                };
            },
            else => {},
        }
    }

    fn output(
        writer: anytype,
        ctx: js.JSContextRef,
        arguments: []const js.JSValueRef,
    ) !void {
        defer Output.flush();
        // console.log();
        if (arguments.len == 0) {
            return;
        }

        const last = arguments.len - 1;
        defer writer.writeAll("\n") catch {};

        for (arguments) |arg, i| {
            switch (js.JSValueGetType(ctx, arg)) {
                .kJSTypeUndefined => {
                    try valuePrinter(.kJSTypeUndefined, ctx, arg, writer);
                    if (i != last) {
                        try writer.writeAll(" ");
                    }
                },
                .kJSTypeNull => {
                    try valuePrinter(.kJSTypeNull, ctx, arg, writer);
                    if (i != last) {
                        try writer.writeAll(" ");
                    }
                },
                .kJSTypeBoolean => {
                    try valuePrinter(.kJSTypeBoolean, ctx, arg, writer);
                    if (i != last) {
                        try writer.writeAll(" ");
                    }
                },
                .kJSTypeNumber => {
                    try valuePrinter(.kJSTypeNumber, ctx, arg, writer);
                    if (i != last) {
                        try writer.writeAll(" ");
                    }
                },
                .kJSTypeString => {
                    try valuePrinter(.kJSTypeString, ctx, arg, writer);
                    if (i != last) {
                        try writer.writeAll(" ");
                    }
                },
                .kJSTypeObject => {
                    try valuePrinter(.kJSTypeObject, ctx, arg, writer);
                    if (i != last) {
                        try writer.writeAll(" ");
                    }
                },
                .kJSTypeSymbol => {
                    try valuePrinter(.kJSTypeSymbol, ctx, arg, writer);
                    if (i != last) {
                        try writer.writeAll(" ");
                    }
                },
                else => {},
            }
        }
    }

    pub fn stdout(
        obj: *GlobalObject,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        output(Output.writer(), ctx, arguments) catch {};
        return js.JSValueMakeUndefined(ctx);
    }

    pub fn stderr(
        obj: *GlobalObject,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        output(Output.errorWriter(), ctx, arguments) catch {};
        return js.JSValueMakeUndefined(ctx);
        // js.JSObjectMakeFunctionWithCallback(ctx: JSContextRef, name: JSStringRef, callAsFunction: JSObjectCallAsFunctionCallback)
    }
};
