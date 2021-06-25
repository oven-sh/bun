const js = @import("./JavaScriptCore.zig");
const std = @import("std");
usingnamespace @import("../../global.zig");
const Fs = @import("../../fs.zig");
const resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../ast/base.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const WTFString = @import("../../wtf_string_mutable.zig").WTFStringMutable;
const logger = @import("../../logger.zig");
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

// If you read JavascriptCore/API/JSVirtualMachine.mm - https://github.com/WebKit/WebKit/blob/acff93fb303baa670c055cb24c2bad08691a01a0/Source/JavaScriptCore/API/JSVirtualMachine.mm#L101
// We can see that it's sort of like std.mem.Allocator but for JSGlobalContextRef, to support Automatic Reference Counting
// Its unavailable on Linux
pub const VirtualMachine = struct {
    const RequireCacheType = std.AutoHashMap(u64, Module);
    ctx: js.JSGlobalContextRef,
    group: js.JSContextGroupRef,
    allocator: *std.mem.Allocator,
    transpile_ctx: *c_void = undefined,
    transpile: *TranspileFunctionType = undefined,
    require_cache: RequireCacheType,
    resolve_: *ResolveFunctionType = undefined,
    resolve_ctx: *c_void = undefined,
    node_modules: ?*NodeModuleBundle = null,
    node_modules_ref: js.JSObjectRef = null,
    global: GlobalObject,

    pub fn init(allocator: *std.mem.Allocator) !*VirtualMachine {
        var group = js.JSContextGroupCreate();
        var ctx = js.JSGlobalContextCreateInGroup(group, null);

        Properties.init();
        var vm = try allocator.create(VirtualMachine);
        vm.* = .{
            .allocator = allocator,
            .group = group,
            .ctx = ctx,
            .require_cache = RequireCacheType.init(allocator),
            .global = undefined,
        };
        vm.global = GlobalObject{ .vm = undefined };
        return vm;
    }

    pub fn setupGlobals(this: *VirtualMachine) void {}

    pub fn resolve(
        this: *VirtualMachine,
        from: *const Module,
        to: string,
    ) !js.JSValueRef {
        return (try this.resolve_(this.resolve_ctx, from.path.dir, to, .require)) orelse return error.ModuleNotFound;
    }
    threadlocal var require_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    // Assume bundle is already transpiled, so we skip transpiling in here.
    pub fn requireFromBundle(this: *VirtualMachine, import_path: string) !js.JSValueRef {}

    pub fn require(
        this: *VirtualMachine,
        module: *const Module,
        path_value: js.JSValueRef,
    ) !js.JSValueRef {
        var import_path = To.Zig.str(path_value, &require_buf);
        var resolve_result = try this.resolve(module, import_path);
    }

    threadlocal var eval_buf: WTFString = undefined;
    threadlocal var eval_buf_loaded: bool = false;

    pub fn evalUtf8(
        this: *VirtualMachine,
        path_text: string,
        contents: string,
    ) !js.JSValueRef {
        if (!eval_buf_loaded) {
            eval_buf = try WTFString.init(this.allocator, contents.len + path.text.len + 2);
        } else {
            eval_buf.reset();
            try eval_buf.growIfNeeded(contents.len + path.text.len + 2);
        }

        try eval_buf.append(contents);
        eval_buf.list.append(eval_buf.allocator, 0);
        var script_len = eval_buf.list.items.len;
        if (path_text.len > 0) {
            try eval_buf.append(path_text);
            eval_buf.list.append(eval_buf.allocator, 0);
        }

        var buf = eval_buf.toOwnedSliceLeaky();
        var script = js.JSStringCreateWithCharactersNoCopy(buf[0..script_len].ptr, script_len - 1);
        var sourceURL: js.JSStringRef = null;

        if (path_text.len > 0) {
            sourceURL = js.JSStringCreateWithCharactersNoCopy(
                buf[script_len + 1 ..].ptr,
                buf[script_len + 1 ..].len - 1,
            );
        }

        return js.JSEvaluateScript(
            this.ctx,
            script,
            js.JSValueMakeUndefined(this.ctx),
            sourceURL,
            0,
            null,
        );
    }
};

pub const BundleLoader = struct {
    bundle: *const NodeModuleBundle,
    allocator: *std.mem.Allocator,
    vm: *VirtualMachine,
    loaded: bool = false,
    ref: js.JSObjectRef = null,

    pub fn init(bundle: *const NodeModuleBundle, allocator: *std.mem.Allocator, vm: *VirtualMachine) BundleLoader {
        return BundleLoader{
            .bundle = bundle,
            .allocator = allocator,
            .vm = vm,
        };
    }

    pub fn loadBundle(this: *BundleLoader) !void {}
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
                arguments: []js.JSValueRef,
                exception: [*c]js.JSValueRef,
            ) js.JSValueRef,
        ) js.JSObjectRef {
            var function = js.JSObjectMakeFunctionWithCallback(ctx, name, Callback(ZigContextType, callback));
            js.JSObjectSetPrivate(function, @ptrCast(*c_void, zig));
            return function;
        }

        pub fn Callback(
            comptime ZigContextType: type,
            comptime ctxfn: fn (
                obj: *ZigContextType,
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []js.JSValueRef,
                exception: [*c]js.JSValueRef,
            ) js.JSValueRef,
        ) type {
            return struct {
                pub fn run(
                    ctx: js.JSContextRef,
                    function: js.JSObjectRef,
                    thisObject: js.JSObjectRef,
                    argumentCount: usize,
                    arguments: [*c]const js.JSValueRef,
                    exception: [*c]js.JSValueRef,
                ) callconv(.C) js.JSValueRef {
                    var object_ptr = js.JSObjectGetPrivate(function) orelse {
                        return js.JSValueMakeUndefined(ctx);
                    };

                    return ctxfn(
                        @intToPtr(ZigContextType, object_ptr),
                        ctx,
                        function,
                        thisObject,
                        arguments[0..argumentCount],
                        exception,
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
        pub const info = "info";
        pub const error_ = "error";
        pub const warn = "warn";
        pub const console = "console";
        pub const require = "require";
        pub const description = "description";
    };

    pub const UTF16 = struct {
        pub const module = std.unicode.utf8ToUtf16LeStringLiteral("module");
        pub const globalThis = std.unicode.utf8ToUtf16LeStringLiteral("globalThis");
        pub const exports = std.unicode.utf8ToUtf16LeStringLiteral("exports");
        pub const log = std.unicode.utf8ToUtf16LeStringLiteral("log");
        pub const debug = std.unicode.utf8ToUtf16LeStringLiteral("debug");
        pub const info = std.unicode.utf8ToUtf16LeStringLiteral("info");
        pub const error_ = std.unicode.utf8ToUtf16LeStringLiteral("error");
        pub const warn = std.unicode.utf8ToUtf16LeStringLiteral("warn");
        pub const console = std.unicode.utf8ToUtf16LeStringLiteral("console");
        pub const require = std.unicode.utf8ToUtf16LeStringLiteral("require");
        pub const description = std.unicode.utf8ToUtf16LeStringLiteral("description");
    };

    pub const Refs = struct {
        pub var module: js.JSStringRef = undefined;
        pub var globalThis: js.JSStringRef = undefined;
        pub var exports: js.JSStringRef = undefined;
        pub var log: js.JSStringRef = undefined;
        pub var debug: js.JSStringRef = undefined;
        pub var info: js.JSStringRef = undefined;
        pub var error_: js.JSStringRef = undefined;
        pub var warn: js.JSStringRef = undefined;
        pub var console: js.JSStringRef = undefined;
        pub var require: js.JSStringRef = undefined;
        pub var description: js.JSStringRef = undefined;
    };

    pub fn init() void {
        inline for (std.meta.fieldNames(UTF8)) |name| {
            @field(Refs, name) = js.JSStringCreateWithCharactersNoCopy(
                &@field(StringStore.UTF16, name),
                @field(StringStore.UTF16, name).len,
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

    pub fn chars(this: *const String) []js.JSChar {
        return js.JSStringGetCharactersPtr(this.ref)[0..js.JSStringGetLength(this.ref)];
    }

    pub fn eql(this: *const String, str: [*c]const u8) bool {
        return str.len == this.len and js.JSStringIsEqualToUTF8CString(this, str);
    }
};

pub const Module = struct {
    path: Fs.PathName,

    require: RequireObject,
    hash: u64,
    ref: js.JSObjectRef,

    pub const RequireObject = struct {};

    pub fn require(
        this: *Module,
        arguments: [*c]const js.JSValueRef,
        arguments_len: usize,
        exception: [*c]JSValueRef,
    ) js.JSValueRef {}
};

pub const GlobalObject = struct {
    ref: js.JSObjectRef = undefined,
    vm: *VirtualMachine,
    console: js.JSClassRef = undefined,
    console_definition: js.JSClassDefinition = undefined,

    pub const ConsoleClass = NewSingletonClass(
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
        // people sometimes modify console.log, let them.
        false,
    );

    pub fn load(global: *GlobalObject) !void {
        global.console_definition = ConsoleClass.define(global, global.vm.ctx);
        global.console = js.JSClassCreate(&global.console_definition);
    }

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
                try writer.print("{d}", js.JSValueToNumber(ctx, arg, null));
            },
            .kJSTypeString => {
                var str = String{ .ref = @as(js.JSStringRef, arg) };
                var chars = str.chars();
                switch (chars.len) {
                    0 => {
                        try writer.writeAll("\"\"");
                    },
                    else => {
                        for (chars) |c, i| {
                            switch (c) {
                                0...127 => {
                                    // Since we're writing character by character
                                    // it will be really slow if we check for an error every time
                                    _ = writer.write(@intCast(u8, c)) catch 0;
                                },
                                // TODO:
                                else => {},
                            }
                        }
                    },
                }
            },
            .kJSTypeObject => {
                // TODO:
                try writer.writeAll("[Object object]");
            },
            .kJSTypeSymbol => {
                var description = js.JSObjectGetPropertyForKey(ctx, arg, Properties.Refs.description, null);
                return switch (js.JSValueGetType(ctx, description)) {
                    .kJSTypeString => try valuePrinter(.kJSTypeString, ctx, description, writer),
                    else => try valuePrinter(.kJSTypeUndefined, ctx, description, writer),
                };
            },
            else => {},
        }
    }

    fn output(
        writer: anytype,
        ctx: js.JSContextRef,
        arguments: []js.JSValueRef,
    ) !void {
        defer Output.flush();
        // console.log();
        if (arguments.len == 0) {
            return js.JSValueMakeUndefined(ctx);
        }

        const last = arguments.len - 1;

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

        return js.JSValueMakeUndefined(ctx);
    }

    pub fn stdout(
        obj: *GlobalObject,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []js.JSValueRef,
    ) js.JSValueRef {
        return try output(Output.writer(), ctx, arguments);
    }

    pub fn stderr(
        obj: *GlobalObject,
        ctx: js.JSContextRef,
        function: js.JSObjectRef,
        thisObject: js.JSObjectRef,
        arguments: []js.JSValueRef,
    ) js.JSValueRef {
        return try output(Output.errorWriter(), ctx, arguments);
        // js.JSObjectMakeFunctionWithCallback(ctx: JSContextRef, name: JSStringRef, callAsFunction: JSObjectCallAsFunctionCallback)
    }
};

pub fn NewSingletonClass(
    comptime ZigType: type,
    comptime name: string,
    comptime functions: anytype,
    comptime read_only: bool,
) type {
    return struct {
        const ClassDefinitionCreator = @This();
        const function_names = std.meta.fieldNames(functions);
        const function_name_literals: [function_names.len][]js.JSChar = brk: {
            var names = std.mem.zeroes([function_names.len][]js.JSChar);

            for (function_names) |field, i| {
                names[i] = std.unicode.utf8ToUtf16LeStringLiteral(field);
            }
            break :brk names;
        };
        var function_name_refs: [function_names.len]js.JSStringRef = undefined;

        const class_name_literal = std.unicode.utf8ToUtf16LeStringLiteral(name);
        var static_functions: [function_name_refs.len + 1:0]js.JSStaticFunction = undefined;

        pub fn define(zig: *ZigType, ctx: js.JSContextRef) !js.JSClassDefinition {
            var def = std.mem.zeroes(js.JSClassDefinition);

            inline for (function_name_literals) |function_name, i| {
                function_name_refs[i] = js.JSStringCreateWithCharactersNoCopy(&function_name, function_name.len);
                static_functions[i] = js.JSStaticFunction{
                    .name = (function_names[i][0.. :0]).ptr,
                    .callAsFunction = To.JS.functionWithCallback(
                        ZigType,
                        zig,
                        function_name_refs[i],
                        ctx,
                        @field(functions, function_names[i]),
                    ),
                    .attributes = comptime if (read_only) js.JSPropertyAttributes.kJSPropertyAttributeReadOnly else js.JSPropertyAttributes.kJSPropertyAttributeNone,
                };
            }
            static_functions[function_name_literals.len] = std.mem.zeroes(js.JSStaticFunction);
            def.staticFunctions = static_functions[0.. :0].ptr;
            def.className = name[0.. :0].ptr;

            return def;
        }
    };
}
