const js = @import("./JavaScriptCore.zig");
const std = @import("std");
usingnamespace @import("../../global.zig");
const Fs = @import("../../fs.zig");
const resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const WTFString = @import("../../wtf_string_mutable.zig").WTFStringMutable;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").ServeBundler;

const hash_map = @import("../../hash_map.zig");

pub const ExportJavaScript = union(Tag) {
    Module: *Module,
    String: *String,
    GlobalObject: *GlobalObject,

    pub const Tag = enum {
        Module,
        String,
        GlobalObject,
    };
};

pub const ResolveFunctionType = fn (ctx: anytype, source_dir: string, import_path: string, import_kind: ast.ImportKind) anyerror!resolver.Result;
pub const TranspileFunctionType = fn (ctx: anytype, resolve_result: resolver.Result) anyerror![:0]const u8;
const ExceptionValueRef = [*c]js.JSValueRef;
const JSStringMapContext = struct {
    pub fn hash(self: @This(), s: js.JSStringRef) u64 {
        return hashString(s);
    }
    pub fn eql(self: @This(), a: js.JSStringRef, b: js.JSStringRef) bool {
        return eqlString(a, b);
    }
};

pub fn JSStringMap(comptime V: type) type {
    return std.HashMap(js.JSStringRef, V, JSStringMapContext, 60);
}

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
    var needs_node_env = env._map.get("NODE_ENV") == null;

    var needs_regenerate = args.define == null and env_count > 0;
    if (args.define) |def| {
        if (def.keys.len != env_count) {
            needs_regenerate = true;
        }
        for (def.keys) |key| {
            if (strings.eql(key, "process.env.NODE_ENV")) {
                needs_node_env = false;
            }
        }
    }

    if (needs_regenerate) {
        var new_list = try allocator.alloc([]u8, env_count * 2 + @boolToInt(needs_node_env) * 2);
        var new_map = Api.StringMap{
            .keys = new_list[0..env_count],
            .values = new_list[env_count..],
        };
        var iter = env_map.iterator();

        var last: usize = 0;
        while (iter.next()) |entry| {
            new_map.keys[last] = entry.key_ptr.*;
            var value = entry.value_ptr.*;
            if (value.len == 0 or value.len[0] != '"' or value.len[value.len - 1] != '"') {
                value = try std.fmt.allocPrint(allocator, "\"{s}\"", .{value});
            }
            new_map.values[last] = value;
            last += 1;
        }

        if (args.define) |def| {
            var from_env = new_map.keys[0..last];

            for (def.keys) |pre, i| {
                if (env_map.get(pre) != null) {
                    for (from_env) |key, i| {
                        if (srings.eql(key, pre)) {
                            new_map.values[i] = def.values[i];
                        }
                    }
                } else {
                    new_map.keys[last] = pre;
                    new_map.values[last] = def.values[i];
                    last += 1;
                }
            }
        }

        if (needs_node_env) {
            new_map.keys[last] = options.DefaultUserDefines.NodeEnv.Key;
            new_map.values[last] = options.DefaultUserDefines.NodeEnv.Value;
        }
    }

    return args;
}

// If you read JavascriptCore/API/JSVirtualMachine.mm - https://github.com/WebKit/WebKit/blob/acff93fb303baa670c055cb24c2bad08691a01a0/Source/JavaScriptCore/API/JSVirtualMachine.mm#L101
// We can see that it's sort of like std.mem.Allocator but for JSGlobalContextRef, to support Automatic Reference Counting
// Its unavailable on Linux
pub const VirtualMachine = struct {
    const RequireCacheType = std.AutoHashMap(u32, Module);
    root: js.JSGlobalContextRef,
    ctx: js.JSGlobalContextRef = undefined,
    group: js.JSContextGroupRef,
    allocator: *std.mem.Allocator,
    require_cache: RequireCacheType,
    node_modules: ?*NodeModuleBundle = null,
    node_modules_ref: js.JSObjectRef = null,
    global: *GlobalObject,
    bundler: Bundler,
    log: *logger.Log,

    pub fn init(
        allocator: *std.mem.Allocator,
        _args: Api.TransformOptions,
    ) !*VirtualMachine {
        var group = js.JSContextGroupCreate();
        var ctx = js.JSGlobalContextCreateInGroup(group, null);
        var log = try allocator.create(logger.Log);
        var vm = try allocator.create(VirtualMachine);
        var global = try allocator.create(GlobalObject);
        vm.* = .{
            .allocator = allocator,
            .bundler = try Bundler.init(allocator, log, try configureTransformOptionsForSpeedy(allocator, _args)),
            .group = group,
            .root = ctx,
            .require_cache = RequireCacheType.init(allocator),
            .global = global,
        };
        Properties.init();
        vm.bundler.configureLinker();

        global.* = GlobalObject{ .vm = vm };
        try vm.global.boot();
        vm.ctx = vm.global.ctx;

        Module.boot(vm);

        return vm;
    }

    threadlocal var eval_buf: WTFString = undefined;
    threadlocal var eval_buf_loaded: bool = false;

    pub fn evalUtf8(
        this: *VirtualMachine,
        path_text: string,
        contents: [:0]const u8,
    ) !js.JSValueRef {

        // if (!eval_buf_loaded) {
        //     eval_buf = try WTFString.init(this.allocator, contents.len + path_text.len);
        // } else {
        //     eval_buf.reset();
        //     try eval_buf.growIfNeeded(contents.len + path_text.len);
        // }

        // try eval_buf.append(contents);
        // var script_len = eval_buf.list.items.len;
        // if (path_text.len > 0) {
        //     try eval_buf.append(path_text);
        // }

        // var buf = eval_buf.toOwnedSliceLeaky();
        // var script = js.JSStringCreateWithCharactersNoCopy(@as([*c]js.JSChar, buf[0..script_len].ptr), script_len);
        // script = js.JSStringRetain(script);
        // var sourceURL: js.JSStringRef = null;

        // if (path_text.len > 0) {
        //     sourceURL = js.JSStringCreateWithCharactersNoCopy(
        //         @as([*c]js.JSChar, buf[script_len + 1 ..].ptr),
        //         buf[script_len + 1 ..].len,
        //     );
        //     sourceURL = js.JSStringRetain(sourceURL);
        // }
        var exception: js.JSObjectRef = null;
        var val = js.JSEvaluateScript(
            this.ctx,
            js.JSStringCreateWithUTF8CString(contents.ptr),
            this.global.ref,
            null,
            0,
            &exception,
        );

        return exception;
    }
};

pub const To = struct {
    pub const JS = struct {
        pub inline fn str(ref: anytype, val: anytype) js.JSStringRef {
            return js.JSStringCreateWithUTF8CString(val[0.. :0]);
        }

        pub fn functionWithCallback(
            comptime ZigContextType: type,
            zig: *ZigContextType,
            name: js.JSStringRef,
            ctx: js.JSContextRef,
            comptime callback: fn (
                obj: *ZigContextType,
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.JSValueRef,
            ) js.JSValueRef,
        ) js.JSObjectRef {
            var function = js.JSObjectMakeFunctionWithCallback(ctx, name, Callback(ZigContextType, callback).rfn);
            js.JSObjectSetPrivate(
                function,
                @ptrCast(*c_void, @alignCast(@alignOf(*c_void), global)),
            );
            return function;
        }

        pub fn Callback(
            comptime ZigContextType: type,
            comptime ctxfn: fn (
                obj: *ZigContextType,
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.JSValueRef,
            ) js.JSValueRef,
        ) type {
            return struct {
                pub fn rfn(
                    ctx: js.JSContextRef,
                    function: js.JSObjectRef,
                    thisObject: js.JSObjectRef,
                    argumentCount: usize,
                    arguments: [*c]const js.JSValueRef,
                    exception: ExceptionValueRef,
                ) callconv(.C) js.JSValueRef {
                    var object_ptr_ = js.JSObjectGetPrivate(function);
                    if (object_ptr_ == null) {
                        object_ptr_ = js.JSObjectGetPrivate(thisObject);
                    }

                    if (object_ptr_ == null) {
                        return js.JSValueMakeUndefined(ctx);
                    }

                    var object_ptr = object_ptr_.?;

                    return ctxfn(
                        @ptrCast(*ZigContextType, @alignCast(@alignOf(*ZigContextType), object_ptr)),
                        ctx,
                        function,
                        thisObject,
                        if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                        null,
                    );
                }
            };
        }
    };

    pub const Ref = struct {
        pub inline fn str(ref: anytype) js.JSStringRef {
            return @as(js.JSStringRef, ref);
        }
    };

    pub const Zig = struct {
        pub inline fn str(ref: anytype, buf: anytype) string {
            return buf[0..js.JSStringGetUTF8CString(Ref.str(ref), buf.ptr, buf.len)];
        }
    };
};

pub const Properties = struct {
    pub const UTF8 = struct {
        pub const module = "module";
        pub const globalThis = "globalThis";
        pub const exports = "exports";
        pub const log = "log";
        pub const debug = "debug";
        pub const name = "name";
        pub const info = "info";
        pub const error_ = "error";
        pub const warn = "warn";
        pub const console = "console";
        pub const require = "require";
        pub const description = "description";
    };

    pub const UTF16 = struct {
        pub const module: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("module");
        pub const globalThis: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("globalThis");
        pub const exports: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("exports");
        pub const log: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("log");
        pub const debug: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("debug");
        pub const info: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("info");
        pub const error_: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("error");
        pub const warn: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("warn");
        pub const console: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("console");
        pub const require: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("require");
        pub const description: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("description");
        pub const name: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral("name");
    };

    pub const Refs = struct {
        pub var module: js.JSStringRef = null;
        pub var globalThis: js.JSStringRef = null;
        pub var exports: js.JSStringRef = null;
        pub var log: js.JSStringRef = null;
        pub var debug: js.JSStringRef = null;
        pub var info: js.JSStringRef = null;
        pub var error_: js.JSStringRef = null;
        pub var warn: js.JSStringRef = null;
        pub var console: js.JSStringRef = null;
        pub var require: js.JSStringRef = null;
        pub var description: js.JSStringRef = null;
        pub var name: js.JSStringRef = null;
    };

    pub fn init() void {
        inline for (std.meta.fieldNames(UTF8)) |name| {
            @field(Refs, name) = js.JSStringRetain(
                js.JSStringCreateWithCharactersNoCopy(
                    @field(StringStore.UTF16, name).ptr,
                    @field(StringStore.UTF16, name).len - 1,
                ),
            );
            std.debug.assert(
                js.JSStringIsEqualToUTF8CString(@field(Refs, name), @field(UTF8, name)[0.. :0]),
            );
        }
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
    exception: [*c]JSValueRef,
) js.JSValueRef;
const SetterFn = fn (
    this: anytype,
    ctx: js.JSContextRef,
    thisObject: js.JSValueRef,
    prop: js.JSStringRef,
    value: js.JSValueRef,
    exception: [*c]JSValueRef,
) js.JSValueRef;

const JSProp = struct {
    get: ?GetterFn = null,
    set: ?SetterFn = null,
    ro: bool = false,
};

pub const Module = struct {
    path: Fs.Path,

    hashid: u32,
    ref: js.JSObjectRef,

    id: js.JSValueRef = null,
    exports: js.JSValueRef = null,

    global_ref: js.JSValueRef = null,

    vm: *VirtualMachine,

    pub var module_class: js.JSClassRef = undefined;
    pub var module_global_class: js.JSClassRef = undefined;
    pub var module_global_class_def: js.JSClassDefinition = undefined;
    pub var module_class_def: js.JSClassDefinition = undefined;

    pub const NodeModuleList = struct {
        tempbuf: []u8,
        property_names: [*]u8,
        property_getters: []js.JSObjectRef,
        module_property_map: ModuleIDMap,
        node_module_global_class: js.JSClassRef,
        node_module_global_class_def: js.JSClassDefinition,
        bundle_ctx: js.JSGlobalContextRef,
        vm: *VirtualMachine,

        pub const Instance = struct {
            module: Module,
            ref: js.JSObjectRef,
            ctx: js.JSGlobalContextRef,
            node_module_list: *NodeModuleList,

            const NodeModuleInstanceClassName = "NodeModule";
            const ModuleLoadStaticFunctionName = "$$m";

            var instance_class_definition: js.JSClassDefinition = undefined;

            var instance_class_ref: js.JSClassRef = undefined;
            var instance_class_loaded = false;

            threadlocal var source_code_buffer: MutableString = undefined;
            threadlocal var source_code_buffer_loaded = false;
            pub fn evalBundledModule(
                allocator: *std.mem.Allocator,
                vm: *VirtualMachine,
                node_module_list: *NodeModuleList,
                ctx: js.JSContextRef,
                id: u32,
            ) !Instance {
                const bundled_module = &vm.node_modules.?.bundle.modules[id];
                if (!source_code_buffer_loaded) {
                    source_code_buffer = try MutableString.init(allocator, bundled_module.code.length + 1);
                    source_code_buffer_loaded = true;
                } else {
                    source_code_buffer.reset();
                    source_code_buffer.growIfNeeded(bundled_module.code.length + 1);
                }

                var node_module_file = std.fs.File{ .handle = vm.node_modules.?.fd };
                const read = try node_module_file.pread(source_code_buffer.list.items, bundled_module.code.offset);
                source_code_buffer.list.items[read] = 0;
                var buf = source_code_buffer.list.items[0..read :0];

                const bundled_package = &vm.node_modules.?.bundle.packages[bundled_module.package_id];
                // We want linear because we expect it to virtually always be at 0
                // However, out of caution we check.
                var start_at: usize = std.mem.indexOfPosLinear(u8, buf, 0, "export var $") orelse return error.FailedCorruptNodeModuleMissingExport;
                start_at += "export var $".len;
                start_at = std.mem.indexOfPosLinear(u8, "$$m(", start_at, buf) orelse return error.FailedCorruptNodeModuleMissingModuleWrapper;
                var source_buf = source_code_buffer.list.items[start_at..read :0];
                var source_string = js.JSStringCreateWithUTF8CString(source_buf.ptr);
                defer js.JSStringRelease(source_string);
                var source_url_buf = try std.fmt.allocPrintZ(
                    allocator,
                    "node_modules.jsb/{s}/{s}",
                    .{
                        vm.node_modules.?.str(bundled_package.path),
                        vm.node_modules.?.str(bundled_module.path),
                    },
                );
                defer allocator.free(source_url_buf);
                var source_url = js.JSStringCreateWithUTF8CString(source_url_buf);
                defer js.JSStringRelease(source_url);
                var exception: js.JSValueRef = null;
                var return_value = js.JSEvaluateScript(node_module_list.bundle_ctx, source_string, null, source_url, 1, &exception);
                if (exception != null) {
                    var message = js.JSValueToStringCopy(node_module_list.bundle_ctx, exception.?, null);
                    defer js.JSStringRelease(message);
                    var message_str_size = js.JSStringGetMaximumUTF8CStringSize(message);
                    var message_str_buf = try allocator.alloc(u8, message_str_size);
                    defer allocator.free(message_str_buf);
                    var message_str_read = js.JSStringGetUTF8CString(message, message_str_buf, message_str_size);
                    defer Output.flush();
                    Output.prettyErrorln("<r>{s}\n--<r><red>error<r> loading <cyan>\"{s}/{s}\"<r>--", .{
                        message_str_buf[0..message_str_read],
                        vm.node_modules.?.str(bundled_package.name),
                        vm.node_modules.?.str(bundled_module.path),
                    });
                    return error.FailedException;
                }

                





                if (!js.JSValueIsObject(node_module_list.bundle_ctx, return_value) or js.JSObjectGetPrivate(return_value) == null) {
                    Output.prettyErrorln(
                        \\\<r><red>Failed<r> to load <cyan>"{s}/{s}"<r>.\n
                        \\This is an internal error. Every module in node_modules.jsb is expected to call a function 
                        \\initializing the module on load, and that function is supposed to return an object. 
                        \\It didn't return an object. 
                        \\That doesn't mean there was a syntax error (syntax errors occur earlier). 
                        \\If you weren't poking around in node_modules.jsb (or messing with object prototypes), 
                        \\please file an issue and include your node_modules.jsb.
                    , .{
                        vm.node_modules.?.str(bundled_package.name),
                        vm.node_modules.?.str(bundled_module.path),
                    });
                    Output.flush();
                    return error.FailedReturnValueInvalid;
                }








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

        pub fn getRequireFromBundleProperty(ctx: js.JSContextRef, thisObject: js.JSObjectRef, prop: js.JSStringRef, exception: [*c]js.JSValueRef) js.JSValueRef {
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

            const size = js.JSStringGetUTF8CString(prop, this.tempbuf.ptr, this.tempbuf.len);
            const key = std.hash.Wyhash.hash(0, this.tempbuf[0..size]);
            const id = this.module_property_map.get(id) orelse return null;

            if (this.property_getters[id] == null) {
                var require_bundled = try this.vm.allocator.create(RequireBundledModule);
                require_bundled.* = RequireBundledModule{ .id = id, .list = this };
                this.property_getters[id] = To.JS.functionWithCallback(
                    RequireBundledModule,
                    require_bundled,
                    prop,
                    ctx,
                    requireBundledModule,
                );
            }

            return this.property_getters[id];
        }

        // this is what $aosdi123() inside a node_modules.jsb calls
        pub fn requireBundledModule(
            obj: *const RequireBundledModule,
            ctx: js.JSContextRef,
            function: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: [*c]js.JSValueRef,
        ) js.JSValueRef {
            const bundle = &obj.list.vm.node_modules.?.bundle;
            const bundled_module = &bundle.modules[obj.id];
            const bundled_pkg = &bundle.packages[bundled_module.package_id];

            const result = loadBundledModuleById(obj.list.vm, ctx, obj.id) catch |err| {
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
                exception.* = js.JSObjectMakeError(ctx, 1, args, null);
                return js.JSValueMakeUndefined(ctx);
            };

            return result.Module.internalGetExports();
        }

        pub fn init(vm: *VirtualMachine, ctx: js.JSContextRef, bundle: *const NodeModuleBundle) !NodeModuleList {
            var size: usize = 0;
            var longest_size: usize = 0;
            for (bundle.bundle.modules) |module, i| {
                var hasher = std.hash.Wyhash.init(0);
                hasher.update(bundle.str(module.path));
                hasher.update(
                    std.mem.asBytes(
                        &bundle.bundle.packages[module.package_id].hash,
                    ),
                );
                // Add one for null-terminated string offset
                const this_size = std.fmt.count(
                    "${x}",
                    .{
                        @truncate(
                            u32,
                            hasher.final(),
                        ),
                    },
                ) + 1;
                size += this_size;
                longest_size = std.math.max(this_size, longest_size);
            }
            var static_properties = try vm.allocator.alloc(js.JSStaticValue, bundle.bundle.modules.len);
            var utf8 = try vm.allocator.alloc(u8, size + longest_size);

            var tempbuf = utf8[size..];

            var names_buf = utf8[0..size];
            var module_property_map = ModuleIDMap.init(vm.allocator);
            try module_property_map.ensureCapacity(bundle.bundle.modules.len);

            for (bundle.bundle.modules) |module, i| {
                var hasher = std.hash.Wyhash.init(0);
                hasher.update(bundle.str(module.path));
                hasher.update(
                    std.mem.asBytes(
                        &bundle.bundle.packages[module.package_id].hash,
                    ),
                );

                const hash = @truncate(
                    u32,
                    hasher.final(),
                );

                // The variable name is the hash of the module path
                var name = std.fmt.bufPrint(names_buf, "${x}", .{hash}) catch unreachable;

                // But we don't store that for the hash map. Instead, we store the hash of name.
                // This lets us avoid storing pointers to the name in the hash table, so if we free it later
                // or something it won't cause issues.
                hasher = std.hash.Wyhash.init(0);
                hasher.update(name);
                var property_key = hasher.final();

                name.ptr[name.len] = 0;
                const name_len = name.len;

                static_properties[i] = js.JSStaticValue{
                    .name = name[0.. :0],
                    .getProperty = getRequireFromBundleProperty,
                    .attributes = .kJSPropertyAttributeReadOnly,
                };
                names_buf = names_buf[name_len..];
                module_property_map.putAssumeCapacityNoClobberWithHash(property_key, property_key, @truncate(u32, i));
            }

            var node_module_global_class_def = js.kJSClassDefinitionEmpty;
            node_module_global_class_def.staticValues = static_properties;
            node_module_global_class_def.className = node_module_global_class_name[0.. :0];
            node_module_global_class_def.parentClass = vm.global.global_class;

            var property_getters = try vm.allocator.alloc(js.JSObjectRef, bundle.bundle.modules.len);
            std.mem.set(js.JSObjectRef, property_getters, null);

            return NodeModuleList{
                .module_property_map = module_property_map,
                .node_module_global_class_def = node_module_global_class_def,
                .vm = vm,
                .tempbuf = tempbuf,
                .property_getters = property_getters,
                .node_module_global_class = js.JSClassCreate(node_module_global_class_def),
            };
        }
    };
    pub const node_module_global_class_name = "NodeModuleGlobal";
    pub const ModuleGlobalClass = NewClass(
        Module,
        "ModuleGlobal",
        .{ .@"require" = require },
        .{},
        false,
        false,
    );

    const JSExport = NewClass(
        Module,
        "Module",
        .{ .@"require" = require },
        .{
            .@"id" = JSProp{
                .get = getId,
                .ro = true,
            },
            .@"exports" = JSProp{
                .get = getExports,
                .set = setExports,
                .ro = false,
            },
        },
        false,
        false,
    );

    pub fn boot(vm: *VirtualMachine) void {
        module_global_class_def = ModuleGlobalClass.define(vm.root);
        module_global_class_def.parentClass = vm.global.global_class;
        module_global_class = js.JSClassRetain(js.JSClassCreate(&module_global_class_def));
        module_class_def = JSExport.define(vm.root);
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

    pub fn loadBundledModuleById(vm: *VirtualMachine, ctx: js.JSContextRef, id: u32) !LoadResult {}

    pub fn loadFromResolveResult(vm: *VirtualMachine, ctx: js.JSContextRef, resolved: resolver.Result) !LoadResult {
        var hash = @truncate(u32, std.hash.Wyhash.hash(0, resolved.path_pair.primary.text));
        if (vm.require_cache.getPtr(hash)) |mod| {
            return .{ .Module = mod };
        }

        const path = resolved.path_pair.primary;
        const loader = vm.bundler.options.loaders.get(path.name.ext) orelse .file;
        switch (loader) {
            .js,
            .jsx,
            .ts,
            .tsx,
            .json,
            => {
                if (resolved.package_json) |package_json| {
                    if (package_json.hash > 0) {
                        if (vm.node_modules) |node_modules| {
                            if (node_modules.getPackageIDByHash(package_json.hash)) |package_id| {
                                const package_relative_path = vm.bundler.fs.relative(
                                    package_json.source.path.name.dirWithTrailingSlash(),
                                    path.text,
                                );

                                if (node_modules.findModuleInPackage(
                                    &node_modules.bundle.packages[package_id],
                                    package_relative_path,
                                )) |found_module| {}
                            }
                        }
                    }
                }

                vm.bundler.resetStore();
                var result = vm.bundler.parse(
                    vm.bundler.allocator,
                    path,
                    loader,
                    result.dirname_fd,
                    null,
                    null,
                ) orelse {
                    return error.ParseError;
                };
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
                            const absolute_url = try std.fmt.allocPrint(
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
                            const absolute_url = try std.fmt.allocPrint(
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
                }
            },
        }
    }

    pub fn getId(
        this: *Module,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: [*c]js.JSValueRef,
    ) js.JSValueRef {
        if (this.id == null) {
            this.id = js.JSStringCreateWithUTF8CString(this.path.text[0.. :0]);
        }

        return this.id;
    }

    pub fn getExports(
        this: *Module,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        exception: [*c]js.JSValueRef,
    ) js.JSValueRef {
        return this.internalGetExports();
    }

    pub fn internalGetExports(this: *Module) js.JSValueRef {
        if (this.exports == null) {
            this.exports = js.JSObjectMake(ctx, null, null);
        }

        return this.exports;
    }

    pub fn setExports(
        this: *Module,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        prop: js.JSStringRef,
        value: js.JSValueRef,
        exception: [*c]JSValueRef,
    ) JSValueRef {
        if (this.exports != null) {
            if (js.JSValueIsString(this.exports.?)) {
                js.JSStringRelease(this.exports.?);
            }
        }

        this.exports = value;
    }

    pub const RequireObject = struct {};

    pub fn require(
        this: *Module,
        ctx: js.JSContextRef,
        thisObject: js.JSValueRef,
        arguments: []js.JSValueRef,
        exception: [*c]JSValueRef,
    ) js.JSValueRef {
        if (arguments.len == 0 or arguments.len > 1 or !js.JSValueIsString(ctx, arguments[0]) or js.JSStringGetLength(arguments[0]) == 0) {
            defer Output.flush();
            if (arguments.len == 0) {
                Output.prettyErrorln("<r><red>error<r>: <s><b>require<r> needs a string, e.g. require(\"left-pad\")", .{});
            } else if (arguments.len > 1) {
                Output.prettyErrorln("<r><red>error<r>: <s><b>require<r> only accepts one argument and it must be a string, e.g. require(\"left-pad\")", .{});
            } else if (!js.JSValueIsString(ctx, arguments[0])) {
                Output.prettyErrorln("<r><red>error<r>: <s><b>require<r> only supports a string, e.g. require(\"left-pad\")", .{});
            } else {
                Output.prettyErrorln("<r><red>error<r>: <s><b>require(\"\")<r> string cannot be empty.", .{});
            }
            exception.* = js.JSObjectMakeError(ctx, 0, null, null);
            return null;
        }
    }
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
    root_obj: js.JSObjectRef = undefined,

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

    pub fn getConsole(global: *GlobalObject, ctx: js.JSContextRef, obj: js.JSObjectRef, exception: ExceptionValueRef) js.JSValueRef {
        return global.console;
    }

    pub fn onMissingProperty(global: *GlobalObject, ctx: js.JSContextRef, obj: js.JSObjectRef, prop: js.JSStringRef, exception: ExceptionValueRef) js.JSValueRef {
        if (js.JSObjectHasProperty(ctx, global.root_obj, prop)) {
            return js.JSObjectGetProperty(ctx, global.root_obj, prop, exception);
        } else {
            return js.JSValueMakeUndefined(ctx);
        }
    }

    pub fn boot(global: *GlobalObject) !void {
        var private: ?*c_void = global;
        global.root_obj = js.JSContextGetGlobalObject(global.vm.root);

        global.console_definition = ConsoleClass.define(global.vm.root);
        global.console_class = js.JSClassRetain(js.JSClassCreate(&global.console_definition));
        global.console = js.JSObjectMake(global.vm.root, global.console_class, private);

        global.global_class_def = GlobalClass.define(global.vm.root);
        global.global_class = js.JSClassRetain(js.JSClassCreate(&global.global_class_def));

        global.ctx = js.JSGlobalContextRetain(js.JSGlobalContextCreateInGroup(global.vm.group, global.global_class));

        std.debug.assert(js.JSObjectSetPrivate(js.JSContextGetGlobalObject(global.ctx), private));
        global.ref = js.JSContextGetGlobalObject(global.ctx);
    }

    threadlocal var printer_buf: [4092]u8 = undefined;
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
                const used = js.JSStringGetUTF8CString(arg, (&printer_buf), printer_buf.len);
                try writer.writeAll(printer_buf[0..used]);
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
        exception: js.JSValueRef,
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
        exception: js.JSValueRef,
    ) js.JSValueRef {
        output(Output.errorWriter(), ctx, arguments) catch {};
        return js.JSValueMakeUndefined(ctx);
        // js.JSObjectMakeFunctionWithCallback(ctx: JSContextRef, name: JSStringRef, callAsFunction: JSObjectCallAsFunctionCallback)
    }
};

pub fn NewClass(
    comptime ZigType: type,
    comptime name: string,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
    comptime read_only: bool,
    comptime singleton: bool,
) type {
    return struct {
        const ClassDefinitionCreator = @This();
        const function_names = std.meta.fieldNames(@TypeOf(staticFunctions));
        const names_buf = brk: {
            var total_len: usize = 0;
            for (function_names) |field, i| {
                total_len += std.unicode.utf8ToUtf16LeStringLiteral(field).len;
            }
            var offset: usize = 0;
            var names_buf_ = std.mem.zeroes([total_len]u16);
            for (function_names) |field, i| {
                var name_ = std.unicode.utf8ToUtf16LeStringLiteral(field);
                std.mem.copy(u16, names_buf_[offset .. name_.len + offset], name_[0..]);
                offset += name_.len;
            }
            break :brk names_buf_;
        };
        const function_name_literals: [function_names.len][]const js.JSChar = brk: {
            var names = std.mem.zeroes([function_names.len][]const js.JSChar);
            var len: usize = 0;
            for (function_names) |field, i| {
                const end = len + std.unicode.utf8ToUtf16LeStringLiteral(field).len;
                names[i] = names_buf[len..end];
                len = end;
            }
            break :brk names;
        };
        var function_name_refs: [function_names.len]js.JSStringRef = undefined;
        var class_name_str = name[0.. :0].ptr;

        const class_name_literal = std.unicode.utf8ToUtf16LeStringLiteral(name);
        var static_functions: [function_name_refs.len + 1]js.JSStaticFunction = undefined;
        var instance_functions: [function_names.len]js.JSObjectRef = undefined;
        const property_names = std.meta.fieldNames(@TypeOf(properties));
        var property_name_refs: [property_names.len]js.JSStringRef = undefined;
        const property_name_literals: [property_names.len][]const js.JSChar = brk: {
            var list = std.mem.zeroes([property_names.len][]const js.JSChar);
            for (property_names) |prop_name, i| {
                list[i] = std.unicode.utf8ToUtf16LeStringLiteral(prop_name);
            }
            break :brk list;
        };
        var static_properties: [property_names.len]js.JSStaticValue = undefined;

        pub fn getPropertyCallback(ctx: js.JSContextRef, obj: js.JSObjectRef, prop: js.JSStringRef, exception: ExceptionValueRef) callconv(.C) js.JSValueRef {
            var instance_pointer_ = js.JSObjectGetPrivate(obj);
            if (instance_pointer_ == null) return js.JSValueMakeUndefined(ctx);
            var instance_pointer = instance_pointer_.?;
            var ptr = @ptrCast(
                *ZigType,
                @alignCast(
                    @alignOf(
                        *ZigType,
                    ),
                    instance_pointer,
                ),
            );

            if (singleton) {
                inline for (function_names) |propname, i| {
                    if (js.JSStringIsEqual(prop, function_name_refs[i])) {
                        return instance_functions[i];
                    }
                }
                if (comptime std.meta.trait.hasFn("onMissingProperty")(ZigType)) {
                    return ptr.onMissingProperty(ctx, obj, prop, exception);
                }
            } else {
                inline for (property_names) |propname, i| {
                    if (js.JSStringIsEqual(prop, property_name_refs[i])) {
                        return @field(
                            properties,
                            propname,
                        )(ptr, ctx, obj, exception);
                    }
                }

                if (comptime std.meta.trait.hasFn("onMissingProperty")(ZigType)) {
                    return ptr.onMissingProperty(ctx, obj, prop, exception);
                }
            }

            return js.JSValueMakeUndefined(ctx);
        }

        fn StaticProperty(comptime id: usize) type {
            return struct {
                pub fn getter(ctx: js.JSContextRef, obj: js.JSObjectRef, prop: js.JSStringRef, exception: [*c]js.JSValueRef) callconv(.C) js.JSValueRef {
                    var instance_pointer_ = js.JSObjectGetPrivate(obj);
                    if (instance_pointer_ == null) return js.JSValueMakeUndefined(ctx);
                    var ptr = @ptrCast(
                        *ZigType,
                        @alignCast(
                            @alignOf(
                                *ZigType,
                            ),
                            instance_pointer_.?,
                        ),
                    );

                    return @field(
                        properties,
                        property_names[id],
                    )(ptr, ctx, obj, exception);
                }
            };
        }

        pub fn define(ctx: js.JSContextRef) js.JSClassDefinition {
            var def = js.kJSClassDefinitionEmpty;

            if (static_functions.len > 0) {
                inline for (function_name_literals) |function_name, i| {
                    var callback = To.JS.Callback(ZigType, @field(staticFunctions, function_names[i])).rfn;
                    function_name_refs[i] = js.JSStringCreateWithCharactersNoCopy(
                        function_name.ptr,
                        function_name.len,
                    );

                    static_functions[i] = js.JSStaticFunction{
                        .name = (function_names[i][0.. :0]).ptr,
                        .callAsFunction = callback,
                        .attributes = comptime if (read_only) js.JSPropertyAttributes.kJSPropertyAttributeReadOnly else js.JSPropertyAttributes.kJSPropertyAttributeNone,
                    };
                    // if (singleton) {
                    //     var function = js.JSObjectMakeFunctionWithCallback(ctx, function_name_refs[i], callback);
                    //     instance_functions[i] = function;
                    // }
                }
                def.staticFunctions = &static_functions;
            }

            if (property_names.len > 0) {
                inline for (comptime property_name_literals) |prop_name, i| {
                    property_name_refs[i] = js.JSStringCreateWithCharactersNoCopy(
                        prop_name.ptr,
                        prop_name.len,
                    );
                    static_properties[i] = std.mem.zeroes(js.JSStaticValue);
                    static_properties[i].getProperty = StaticProperty(i).getter;
                    static_properties[i].name = property_names[i][0.. :0];
                }

                def.staticValues = (&static_properties);
            }

            def.className = class_name_str;
            // def.getProperty = getPropertyCallback;

            return def;
        }
    };
}

// This makes it so we get the defines already formatted from the user's environment with the "process.env." prefix set
// This also normalizes quoting
// Currently, it truncates any environment variables to a max of 1024 bytes
const NodeEnvBufMap = struct {
    backing: std.BufMap,
    pub fn init(allocator: *std.mem.Allocator) NodeEnvBufMap {
        return NodeEnvBufMap{ .backing = std.BufMap.init(allocator) };
    }
    pub fn get(this: *const NodeEnvBufMap, key: string) ?string {
        return this.backing.get(key);
    }
    pub threadlocal var bufkeybuf: [1024]u8 = undefined;
    pub threadlocal var bufkeybuf_first = true;
    pub fn put(this: *NodeEnvBufMap, key: string, value: string) !void {
        if (value.len == 0) {
            return;
        }

        if (bufkeybuf_first) {
            bufkeybuf[0.."process.env.".len].* = "process.env.";
            bufkeybuf_first = false;
        }
        std.mem.copy(u8, bufkeybuf_first["process.env.".len..], key);
        var key_slice = bufkeybuf[0 .. key.len + "process.env.".len];
        var value_slice = value;
        const max_value_slice_len = std.math.min(value.len, bufkeybuf.len - key_slice.len);
        if (value[0] != '"' and value[value.len - 1] != '"') {
            value_slice = bufkeybuf[key_slice.len..][0 .. max_value_slice_len + 2];
            value_slice[0] = '"';
            std.mem.copy(u8, value_slice[1..], value[0..max_value_slice_len]);
            value_slice[value_slice.len - 1] = '"';
        } else if (value[0] != '"') {
            value_slice[0] = '"';
            std.mem.copy(u8, value_slice[1..], value[0..max_value_slice_len]);
        } else if (value[value.len - 1] != '"') {
            std.mem.copy(u8, value_slice[1..], value[0..max_value_slice_len]);
            value_slice[value_slice.len - 1] = '"';
        }

        return this.backing.put(key_slice, value_slice);
    }
};

pub fn getNodeEnvMap(allocator: *Allocator) !NodeEnvBufMap {
    var result = NodeEnvBufMap.init(allocator);
    errdefer result.deinit();

    if (builtin.os.tag == .windows) {
        const ptr = os.windows.peb().ProcessParameters.Environment;

        var i: usize = 0;
        while (ptr[i] != 0) {
            const key_start = i;

            while (ptr[i] != 0 and ptr[i] != '=') : (i += 1) {}
            const key_w = ptr[key_start..i];
            const key = try std.unicode.utf16leToUtf8Alloc(allocator, key_w);
            errdefer allocator.free(key);

            if (ptr[i] == '=') i += 1;

            const value_start = i;
            while (ptr[i] != 0) : (i += 1) {}
            const value_w = ptr[value_start..i];
            const value = try std.unicode.utf16leToUtf8Alloc(allocator, value_w);
            errdefer allocator.free(value);

            i += 1; // skip over null byte

            try result.putMove(key, value);
        }
        return result;
    } else if (builtin.os.tag == .wasi) {
        var environ_count: usize = undefined;
        var environ_buf_size: usize = undefined;

        const environ_sizes_get_ret = os.wasi.environ_sizes_get(&environ_count, &environ_buf_size);
        if (environ_sizes_get_ret != os.wasi.ESUCCESS) {
            return os.unexpectedErrno(environ_sizes_get_ret);
        }

        var environ = try allocator.alloc([*:0]u8, environ_count);
        defer allocator.free(environ);
        var environ_buf = try allocator.alloc(u8, environ_buf_size);
        defer allocator.free(environ_buf);

        const environ_get_ret = os.wasi.environ_get(environ.ptr, environ_buf.ptr);
        if (environ_get_ret != os.wasi.ESUCCESS) {
            return os.unexpectedErrno(environ_get_ret);
        }

        for (environ) |env| {
            const pair = mem.spanZ(env);
            var parts = mem.split(pair, "=");
            const key = parts.next().?;
            const value = parts.next().?;
            try result.put(key, value);
        }
        return result;
    } else if (builtin.link_libc) {
        var ptr = std.c.environ;
        while (ptr.*) |line| : (ptr += 1) {
            var line_i: usize = 0;
            while (line[line_i] != 0 and line[line_i] != '=') : (line_i += 1) {}
            const key = line[0..line_i];

            var end_i: usize = line_i;
            while (line[end_i] != 0) : (end_i += 1) {}
            const value = line[line_i + 1 .. end_i];

            try result.put(key, value);
        }
        return result;
    } else {
        for (os.environ) |line| {
            var line_i: usize = 0;
            while (line[line_i] != 0 and line[line_i] != '=') : (line_i += 1) {}
            const key = line[0..line_i];

            var end_i: usize = line_i;
            while (line[end_i] != 0) : (end_i += 1) {}
            const value = line[line_i + 1 .. end_i];

            try result.put(key, value);
        }
        return result;
    }
}
