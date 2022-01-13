pub const js = @import("../../jsc.zig").C;
const std = @import("std");
const _global = @import("../../global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const JavaScript = @import("./javascript.zig");
const ResolveError = JavaScript.ResolveError;
const BuildError = JavaScript.BuildError;
const JSC = @import("../../jsc.zig");
const WebCore = @import("./webcore/response.zig");
const Test = @import("./test/jest.zig");
const Fetch = WebCore.Fetch;
const Response = WebCore.Response;
const Request = WebCore.Request;
const Router = @import("./api/router.zig");
const FetchEvent = WebCore.FetchEvent;
const Headers = WebCore.Headers;
const Body = WebCore.Body;
const TaggedPointerTypes = @import("../../tagged_pointer.zig");
const TaggedPointerUnion = TaggedPointerTypes.TaggedPointerUnion;

pub const ExceptionValueRef = [*c]js.JSValueRef;
pub const JSValueRef = js.JSValueRef;

fn ObjectPtrType(comptime Type: type) type {
    if (Type == void) return Type;
    return *Type;
}

pub const To = struct {
    pub const JS = struct {
        pub inline fn str(_: anytype, val: anytype) js.JSStringRef {
            return js.JSStringCreateWithUTF8CString(val[0.. :0]);
        }

        pub fn functionWithCallback(
            comptime ZigContextType: type,
            zig: ObjectPtrType(ZigContextType),
            name: js.JSStringRef,
            ctx: js.JSContextRef,
            comptime callback: fn (
                obj: ObjectPtrType(ZigContextType),
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) js.JSObjectRef {
            var function = js.JSObjectMakeFunctionWithCallback(ctx, name, Callback(ZigContextType, callback).rfn);
            std.debug.assert(js.JSObjectSetPrivate(
                function,
                JSPrivateDataPtr.init(zig).ptr(),
            ));
            return function;
        }

        pub fn Finalize(
            comptime ZigContextType: type,
            comptime ctxfn: fn (
                this: ObjectPtrType(ZigContextType),
            ) void,
        ) type {
            return struct {
                pub fn rfn(
                    object: js.JSObjectRef,
                ) callconv(.C) void {
                    return ctxfn(
                        GetJSPrivateData(ZigContextType, object) orelse return,
                    );
                }
            };
        }

        pub fn Constructor(
            comptime ctxfn: fn (
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) type {
            return struct {
                pub fn rfn(
                    ctx: js.JSContextRef,
                    function: js.JSObjectRef,
                    argumentCount: usize,
                    arguments: [*c]const js.JSValueRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    return ctxfn(
                        ctx,
                        function,
                        if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                        exception,
                    );
                }
            };
        }
        pub fn ConstructorCallback(
            comptime ctxfn: fn (
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) type {
            return struct {
                pub fn rfn(
                    ctx: js.JSContextRef,
                    function: js.JSObjectRef,
                    argumentCount: usize,
                    arguments: [*c]const js.JSValueRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    return ctxfn(
                        ctx,
                        function,
                        if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                        exception,
                    );
                }
            };
        }

        pub fn withType(comptime Type: type, value: Type, context: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return withTypeClone(Type, value, context, exception, false);
        }

        pub fn withTypeClone(comptime Type: type, value: Type, context: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef, clone: bool) JSC.C.JSValueRef {
            if (comptime std.meta.trait.isNumber(Type)) {
                return JSC.JSValue.jsNumberWithType(Type, value).asRef();
            }

            var zig_str: JSC.ZigString = undefined;

            return switch (comptime Type) {
                void => JSC.C.JSValueMakeUndefined(context),
                bool => JSC.C.JSValueMakeBoolean(context, value),
                []const u8, [:0]const u8, [*:0]const u8, []u8, [:0]u8, [*:0]u8 => brk: {
                    zig_str = ZigString.init(value);
                    const val = zig_str.toValueAuto(context.asJSGlobalObject());

                    break :brk val.asObjectRef();
                },
                []const PathString, []const []const u8, []const []u8, [][]const u8, [][:0]const u8, [][:0]u8 => {
                    var zig_strings_buf: [32]ZigString = undefined;
                    var zig_strings: []ZigString = if (value.len < 32)
                        &zig_strings_buf
                    else
                        (_global.default_allocator.alloc(ZigString, value.len) catch unreachable);
                    defer if (zig_strings.ptr != &zig_strings_buf)
                        _global.default_allocator.free(zig_strings);

                    for (value) |path_string, i| {
                        if (comptime Type == []const PathString) {
                            zig_strings[i] = ZigString.init(path_string.slice());
                        } else {
                            zig_strings[i] = ZigString.init(path_string);
                        }
                    }

                    var array = JSC.JSValue.createStringArray(context.asJSGlobalObject(), zig_strings.ptr, zig_strings.len, clone).asObjectRef();

                    if (clone) {
                        for (value) |path_string| {
                            if (comptime Type == []const PathString) {
                                _global.default_allocator.free(path_string.slice());
                            } else {
                                _global.default_allocator.free(path_string);
                            }
                        }
                        _global.default_allocator.free(value);
                    }

                    return array;
                },

                JSC.C.JSValueRef => value,

                else => {
                    const Info: std.builtin.TypeInfo = comptime @typeInfo(Type);
                    if (comptime Info == .Enum) {
                        const Enum: std.builtin.TypeInfo.Enum = Info.Enum;
                        if (comptime !std.meta.trait.isNumber(Enum.tag_type)) {
                            zig_str = JSC.ZigString.init(@tagName(value));
                            return zig_str.toValue(context.asJSGlobalObject()).asObjectRef();
                        }
                    }

                    // Recursion can stack overflow here
                    if (comptime std.meta.trait.isSlice(Type)) {
                        const Child = std.meta.Child(Type);

                        const prefill = 32;
                        if (value.len <= prefill) {
                            var array: [prefill]JSC.C.JSValueRef = undefined;
                            var i: u8 = 0;
                            const len = @minimum(@intCast(u8, value.len), prefill);
                            while (i < len and exception.* == null) : (i += 1) {
                                array[i] = if (comptime Child == JSC.C.JSValueRef)
                                    value[i]
                                else
                                    To.JS.withType(Child, value[i], context, exception);
                            }

                            if (exception.* != null) {
                                return null;
                            }

                            // TODO: this function copies to a MarkedArgumentsBuffer
                            // That copy is unnecessary.
                            const obj = JSC.C.JSObjectMakeArray(context, len, &array, exception);

                            if (exception.* != null) {
                                return null;
                            }
                            return obj;
                        }

                        {
                            var array = _global.default_allocator.alloc(JSC.C.JSValueRef, value.len) catch unreachable;
                            defer _global.default_allocator.free(array);
                            var i: usize = 0;
                            while (i < value.len and exception.* == null) : (i += 1) {
                                array[i] = if (comptime Child == JSC.C.JSValueRef)
                                    value[i]
                                else
                                    To.JS.withType(Child, value[i], context, exception);
                            }

                            if (exception.* != null) {
                                return null;
                            }

                            // TODO: this function copies to a MarkedArgumentsBuffer
                            // That copy is unnecessary.
                            const obj = JSC.C.JSObjectMakeArray(context, value.len, array.ptr, exception);
                            if (exception.* != null) {
                                return null;
                            }

                            return obj;
                        }
                    }

                    if (comptime std.meta.trait.isZigString(Type)) {
                        zig_str = JSC.ZigString.init(value);
                        return zig_str.toValue(context.asJSGlobalObject()).asObjectRef();
                    }

                    if (comptime Info == .Pointer) {
                        const Child = comptime std.meta.Child(Type);
                        if (comptime std.meta.trait.isContainer(Child) and @hasDecl(Child, "Class") and @hasDecl(Child.Class, "isJavaScriptCoreClass")) {
                            return Child.Class.make(context, value);
                        }
                    }

                    if (comptime Info == .Struct) {
                        if (comptime @hasDecl(Type, "Class") and @hasDecl(Type.Class, "isJavaScriptCoreClass")) {
                            if (comptime !@hasDecl(Type, "finalize")) {
                                @compileError(comptime std.fmt.comptimePrint("JSC class {s} must implement finalize to prevent memory leaks", .{Type.Class.name}));
                            }

                            if (comptime !@hasDecl(Type, "toJS")) {
                                var val = _global.default_allocator.create(Type) catch unreachable;
                                val.* = value;
                                return Type.Class.make(context, val);
                            }
                        }
                    }

                    const res = value.toJS(context, exception);

                    if (@TypeOf(res) == JSC.C.JSValueRef) {
                        return res;
                    } else if (@TypeOf(res) == JSC.JSValue) {
                        return res.asObjectRef();
                    }
                },
            };
        }

        pub fn PropertyGetter(
            comptime Type: type,
        ) type {
            return comptime fn (
                this: ObjectPtrType(Type),
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef;
        }

        pub fn Getter(comptime Type: type, comptime field: std.meta.FieldEnum(Type)) PropertyGetter(Type) {
            return struct {
                pub fn rfn(
                    this: ObjectPtrType(Type),
                    ctx: js.JSContextRef,
                    _: js.JSValueRef,
                    _: js.JSStringRef,
                    exception: js.ExceptionRef,
                ) js.JSValueRef {
                    return withType(std.meta.fieldInfo(Type, field).field_type, @field(this, @tagName(field)), ctx, exception);
                }
            }.rfn;
        }

        pub fn Callback(
            comptime ZigContextType: type,
            comptime ctxfn: fn (
                obj: ObjectPtrType(ZigContextType),
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef,
        ) type {
            return struct {
                pub fn rfn(
                    ctx: js.JSContextRef,
                    function: js.JSObjectRef,
                    thisObject: js.JSObjectRef,
                    argumentCount: usize,
                    arguments: [*c]const js.JSValueRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    if (comptime ZigContextType == anyopaque) {
                        return ctxfn(
                            js.JSObjectGetPrivate(function) orelse js.JSObjectGetPrivate(thisObject) orelse undefined,
                            ctx,
                            function,
                            thisObject,
                            if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                            exception,
                        );
                    } else if (comptime ZigContextType == void) {
                        return ctxfn(
                            void{},
                            ctx,
                            function,
                            thisObject,
                            if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                            exception,
                        );
                    } else {
                        return ctxfn(
                            GetJSPrivateData(ZigContextType, function) orelse GetJSPrivateData(ZigContextType, thisObject) orelse return js.JSValueMakeUndefined(ctx),
                            ctx,
                            function,
                            thisObject,
                            if (arguments) |args| args[0..argumentCount] else &[_]js.JSValueRef{},
                            exception,
                        );
                    }
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
        pub inline fn ptr(comptime StructType: type, obj: js.JSObjectRef) *StructType {
            return GetJSPrivateData(StructType, obj).?;
        }
    };
};

pub const Properties = struct {
    pub const UTF8 = struct {
        pub var filepath: string = "filepath";

        pub const module: string = "module";
        pub const globalThis: string = "globalThis";
        pub const exports: string = "exports";
        pub const log: string = "log";
        pub const debug: string = "debug";
        pub const name: string = "name";
        pub const info: string = "info";
        pub const error_: string = "error";
        pub const warn: string = "warn";
        pub const console: string = "console";
        pub const require: string = "require";
        pub const description: string = "description";
        pub const initialize_bundled_module: string = "$$m";
        pub const load_module_function: string = "$lOaDuRcOdE$";
        pub const window: string = "window";
        pub const default: string = "default";
        pub const include: string = "include";

        pub const env: string = "env";

        pub const GET = "GET";
        pub const PUT = "PUT";
        pub const POST = "POST";
        pub const PATCH = "PATCH";
        pub const HEAD = "HEAD";
        pub const OPTIONS = "OPTIONS";

        pub const navigate = "navigate";
        pub const follow = "follow";
    };

    pub const UTF16 = struct {
        pub const module: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.module);
        pub const globalThis: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.globalThis);
        pub const exports: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.exports);
        pub const log: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.log);
        pub const debug: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.debug);
        pub const info: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.info);
        pub const error_: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.error_);
        pub const warn: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.warn);
        pub const console: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.console);
        pub const require: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.require);
        pub const description: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.description);
        pub const name: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.name);
        pub const initialize_bundled_module = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.initialize_bundled_module);
        pub const load_module_function: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.load_module_function);
        pub const window: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.window);
        pub const default: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.default);
        pub const include: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.include);

        pub const GET: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.GET);
        pub const PUT: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.PUT);
        pub const POST: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.POST);
        pub const PATCH: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.PATCH);
        pub const HEAD: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.HEAD);
        pub const OPTIONS: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.OPTIONS);

        pub const navigate: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.navigate);
        pub const follow: []c_ushort = std.unicode.utf8ToUtf16LeStringLiteral(UTF8.follow);
    };

    pub const Refs = struct {
        pub var filepath: js.JSStringRef = undefined;

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
        pub var name: js.JSStringRef = undefined;
        pub var initialize_bundled_module: js.JSStringRef = undefined;
        pub var load_module_function: js.JSStringRef = undefined;
        pub var window: js.JSStringRef = undefined;
        pub var default: js.JSStringRef = undefined;
        pub var include: js.JSStringRef = undefined;
        pub var GET: js.JSStringRef = undefined;
        pub var PUT: js.JSStringRef = undefined;
        pub var POST: js.JSStringRef = undefined;
        pub var PATCH: js.JSStringRef = undefined;
        pub var HEAD: js.JSStringRef = undefined;
        pub var OPTIONS: js.JSStringRef = undefined;

        pub var empty_string_ptr = [_]u8{0};
        pub var empty_string: js.JSStringRef = undefined;

        pub var navigate: js.JSStringRef = undefined;
        pub var follow: js.JSStringRef = undefined;

        pub const env: js.JSStringRef = undefined;
    };

    pub fn init() void {
        inline for (std.meta.fieldNames(UTF8)) |name| {
            @field(Refs, name) = js.JSStringCreateStatic(
                @field(UTF8, name).ptr,
                @field(UTF8, name).len,
            );

            if (comptime Environment.isDebug) {
                std.debug.assert(
                    js.JSStringIsEqualToString(@field(Refs, name), @field(UTF8, name).ptr, @field(UTF8, name).len),
                );
            }
        }

        Refs.empty_string = js.JSStringCreateWithUTF8CString(&Refs.empty_string_ptr);
    }
};

const hasSetter = std.meta.trait.hasField("set");
const hasReadOnly = std.meta.trait.hasField("ro");
const hasFinalize = std.meta.trait.hasField("finalize");

const hasTypeScriptField = std.meta.trait.hasField("ts");
fn hasTypeScript(comptime Type: type) bool {
    if (hasTypeScriptField(Type)) {
        return true;
    }

    return @hasDecl(Type, "ts");
}

fn getTypeScript(comptime Type: type, value: Type) d.ts.or_decl {
    if (comptime hasTypeScriptField(Type)) {
        if (@TypeOf(Type.ts) == d.ts.decl) {
            return d.ts.or_decl{ .decl = value };
        } else {
            return d.ts.or_decl{ .ts = value.ts };
        }
    }

    if (@TypeOf(Type.ts) == d.ts.decl) {
        return d.ts.or_decl{ .decl = Type.ts };
    } else {
        return d.ts.or_decl{ .ts = value.ts };
    }
}

pub const d = struct {
    pub const ts = struct {
        @"return": string = "unknown",
        tsdoc: string = "",
        name: string = "",
        read_only: ?bool = null,
        args: []const arg = &[_]arg{},
        splat_args: bool = false,

        pub const or_decl = union(Tag) {
            ts: ts,
            decl: decl,
            pub const Tag = enum { ts, decl };
        };

        pub const decl = union(Tag) {
            module: module,
            class: class,
            empty: u0,
            pub const Tag = enum { module, class, empty };
        };

        pub const module = struct {
            tsdoc: string = "",
            read_only: ?bool = null,
            path: string = "",
            global: bool = false,

            properties: []ts = &[_]ts{},
            functions: []ts = &[_]ts{},
            classes: []class = &[_]class{},
        };

        pub const class = struct {
            name: string = "",
            tsdoc: string = "",
            @"return": string = "",
            read_only: ?bool = null,
            interface: bool = true,
            default_export: bool = false,

            properties: []ts = &[_]ts{},
            functions: []ts = &[_]ts{},

            pub const Printer = struct {
                const indent_level = 2;
                pub fn printIndented(comptime fmt: string, args: anytype, comptime indent: usize) string {
                    comptime var buf: string = "";
                    comptime buf = buf ++ " " ** indent;

                    return comptime buf ++ std.fmt.comptimePrint(fmt, args);
                }

                pub fn printVar(comptime property: d.ts, comptime indent: usize) string {
                    comptime var buf: string = "";
                    comptime buf = buf ++ " " ** indent;

                    comptime {
                        if (property.read_only orelse false) {
                            buf = buf ++ "readonly ";
                        }

                        buf = buf ++ "var ";
                        buf = buf ++ property.name;
                        buf = buf ++ ": ";

                        if (property.@"return".len > 0) {
                            buf = buf ++ property.@"return";
                        } else {
                            buf = buf ++ "any";
                        }

                        buf = buf ++ ";\n";
                    }

                    comptime {
                        if (property.tsdoc.len > 0) {
                            buf = printTSDoc(property.tsdoc, indent) ++ buf;
                        }
                    }

                    return buf;
                }

                pub fn printProperty(comptime property: d.ts, comptime indent: usize) string {
                    comptime var buf: string = "";
                    comptime buf = buf ++ " " ** indent;

                    comptime {
                        if (property.read_only orelse false) {
                            buf = buf ++ "readonly ";
                        }

                        buf = buf ++ property.name;
                        buf = buf ++ ": ";

                        if (property.@"return".len > 0) {
                            buf = buf ++ property.@"return";
                        } else {
                            buf = buf ++ "any";
                        }

                        buf = buf ++ ";\n";
                    }

                    comptime {
                        if (property.tsdoc.len > 0) {
                            buf = printTSDoc(property.tsdoc, indent) ++ buf;
                        }
                    }

                    return buf;
                }
                pub fn printInstanceFunction(comptime func: d.ts, comptime _indent: usize, comptime no_type: bool) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";

                    comptime {
                        var args: string = "";
                        for (func.args) |a, i| {
                            if (i > 0) {
                                args = args ++ ", ";
                            }
                            args = args ++ printArg(a);
                        }

                        if (no_type) {
                            buf = buf ++ printIndented("{s}({s});\n", .{
                                func.name,
                                args,
                            }, indent);
                        } else {
                            buf = buf ++ printIndented("{s}({s}): {s};\n", .{
                                func.name,
                                args,
                                func.@"return",
                            }, indent);
                        }
                    }

                    comptime {
                        if (func.tsdoc.len > 0) {
                            buf = printTSDoc(func.tsdoc, indent) ++ buf;
                        }
                    }

                    return buf;
                }
                pub fn printFunction(comptime func: d.ts, comptime _indent: usize, comptime no_type: bool) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";

                    comptime {
                        var args: string = "";
                        for (func.args) |a, i| {
                            if (i > 0) {
                                args = args ++ ", ";
                            }
                            args = args ++ printArg(a);
                        }

                        if (no_type) {
                            buf = buf ++ printIndented("function {s}({s});\n", .{
                                func.name,
                                args,
                            }, indent);
                        } else {
                            buf = buf ++ printIndented("function {s}({s}): {s};\n", .{
                                func.name,
                                args,
                                func.@"return",
                            }, indent);
                        }
                    }

                    comptime {
                        if (func.tsdoc.len > 0) {
                            buf = printTSDoc(func.tsdoc, indent) ++ buf;
                        }
                    }

                    return buf;
                }
                pub fn printArg(
                    comptime _arg: d.ts.arg,
                ) string {
                    comptime var buf: string = "";
                    comptime {
                        buf = buf ++ _arg.name;
                        buf = buf ++ ": ";

                        if (_arg.@"return".len == 0) {
                            buf = buf ++ "any";
                        } else {
                            buf = buf ++ _arg.@"return";
                        }
                    }

                    return buf;
                }

                pub fn printDecl(comptime klass: d.ts.decl, comptime _indent: usize) string {
                    return comptime switch (klass) {
                        .module => |mod| printModule(mod, _indent),
                        .class => |cla| printClass(cla, _indent),
                        .empty => "",
                    };
                }

                pub fn printModule(comptime klass: d.ts.module, comptime _indent: usize) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";
                    comptime brk: {
                        if (klass.tsdoc.len > 0) {
                            buf = buf ++ printTSDoc(klass.tsdoc, indent);
                        }

                        if (klass.global) {
                            buf = buf ++ printIndented("declare global {{\n", .{}, indent);
                        } else {
                            buf = buf ++ printIndented("declare module \"{s}\" {{\n", .{klass.path}, indent);
                        }

                        indent += indent_level;

                        for (klass.properties) |property, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            buf = buf ++ printVar(property, indent);
                        }

                        buf = buf ++ "\n";

                        for (klass.functions) |func, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            buf = buf ++ printFunction(
                                func,
                                indent,
                                false,
                            );
                        }

                        for (klass.classes) |func, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            buf = buf ++ printClass(
                                func,
                                indent,
                            );
                        }

                        indent -= indent_level;

                        buf = buf ++ printIndented("}}\n", .{}, indent);

                        break :brk;
                    }
                    return comptime buf;
                }

                pub fn printClass(comptime klass: d.ts.class, comptime _indent: usize) string {
                    comptime var indent = _indent;
                    comptime var buf: string = "";
                    comptime brk: {
                        if (klass.tsdoc.len > 0) {
                            buf = buf ++ printTSDoc(klass.tsdoc, indent);
                        }

                        const qualifier = if (!klass.default_export) "export " else "";

                        if (klass.interface) {
                            buf = buf ++ printIndented("export interface {s} {{\n", .{klass.name}, indent);
                        } else {
                            buf = buf ++ printIndented("{s}class {s} {{\n", .{ qualifier, klass.name }, indent);
                        }

                        indent += indent_level;

                        var did_print_constructor = false;
                        for (klass.functions) |func| {
                            if (!strings.eqlComptime(func.name, "constructor")) continue;
                            did_print_constructor = true;
                            buf = buf ++ printInstanceFunction(
                                func,
                                indent,
                                !klass.interface,
                            );
                        }

                        for (klass.properties) |property, i| {
                            if (i > 0 or did_print_constructor) {
                                buf = buf ++ "\n";
                            }

                            buf = buf ++ printProperty(property, indent);
                        }

                        buf = buf ++ "\n";

                        for (klass.functions) |func, i| {
                            if (i > 0) {
                                buf = buf ++ "\n";
                            }

                            if (strings.eqlComptime(func.name, "constructor")) continue;

                            buf = buf ++ printInstanceFunction(
                                func,
                                indent,
                                false,
                            );
                        }

                        indent -= indent_level;

                        buf = buf ++ printIndented("}}\n", .{}, indent);

                        if (klass.default_export) {
                            buf = buf ++ printIndented("export = {s};\n", .{klass.name}, indent);
                        }

                        break :brk;
                    }
                    return comptime buf;
                }

                pub fn printTSDoc(comptime str: string, comptime indent: usize) string {
                    comptime var buf: string = "";

                    comptime brk: {
                        var splitter = std.mem.split(str, "\n");

                        const first = splitter.next() orelse break :brk;
                        const second = splitter.next() orelse {
                            buf = buf ++ printIndented("/**  {s}  */\n", .{std.mem.trim(u8, first, " ")}, indent);
                            break :brk;
                        };
                        buf = buf ++ printIndented("/**\n", .{}, indent);
                        buf = buf ++ printIndented(" *  {s}\n", .{std.mem.trim(u8, first, " ")}, indent);
                        buf = buf ++ printIndented(" *  {s}\n", .{std.mem.trim(u8, second, " ")}, indent);
                        while (splitter.next()) |line| {
                            buf = buf ++ printIndented(" *  {s}\n", .{std.mem.trim(u8, line, " ")}, indent);
                        }
                        buf = buf ++ printIndented("*/\n", .{}, indent);
                    }

                    return buf;
                }
            };
        };

        pub const arg = struct {
            name: string = "",
            @"return": string = "any",
            optional: bool = false,
        };
    };
};

// This should only exist at compile-time.
pub const ClassOptions = struct {
    name: string,

    read_only: bool = false,
    singleton: bool = false,
    ts: d.ts.decl = d.ts.decl{ .empty = 0 },
};

// work around a comptime bug

pub fn NewClass(
    comptime ZigType: type,
    comptime options: ClassOptions,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
) type {
    const read_only = options.read_only;
    const singleton = options.singleton;
    _ = read_only;

    return struct {
        const name = options.name;
        pub const isJavaScriptCoreClass = true;
        const ClassDefinitionCreator = @This();
        const function_names = std.meta.fieldNames(@TypeOf(staticFunctions));
        const function_name_literals = function_names;
        var function_name_refs: [function_names.len]js.JSStringRef = undefined;
        var class_name_str = name[0.. :0].ptr;

        var static_functions = brk: {
            var funcs: [function_name_refs.len + 1]js.JSStaticFunction = undefined;
            std.mem.set(
                js.JSStaticFunction,
                &funcs,
                js.JSStaticFunction{
                    .name = @intToPtr([*c]const u8, 0),
                    .callAsFunction = null,
                    .attributes = js.JSPropertyAttributes.kJSPropertyAttributeNone,
                },
            );
            break :brk funcs;
        };
        var instance_functions = std.mem.zeroes([function_names.len]js.JSObjectRef);
        const property_names = std.meta.fieldNames(@TypeOf(properties));
        var property_name_refs = std.mem.zeroes([property_names.len]js.JSStringRef);
        const property_name_literals = property_names;

        pub var ref: js.JSClassRef = null;
        pub var loaded = false;
        pub var definition: js.JSClassDefinition = .{
            .version = 0,
            .attributes = js.JSClassAttributes.kJSClassAttributeNone,
            .className = name[0.. :0].ptr,
            .parentClass = null,
            .staticValues = null,
            .staticFunctions = null,
            .initialize = null,
            .finalize = null,
            .hasProperty = null,
            .getProperty = null,
            .setProperty = null,
            .deleteProperty = null,
            .getPropertyNames = null,
            .callAsFunction = null,
            .callAsConstructor = null,
            .hasInstance = null,
            .convertToType = null,
        };
        const ConstructorWrapper = struct {
            pub fn rfn(
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                _: js.JSObjectRef,
                argumentCount: usize,
                arguments: [*c]const js.JSValueRef,
                exception: js.ExceptionRef,
            ) callconv(.C) js.JSValueRef {
                return definition.callAsConstructor.?(ctx, function, argumentCount, arguments, exception);
            }
        };

        pub fn throwInvalidConstructorError(ctx: js.JSContextRef, _: js.JSObjectRef, _: usize, _: [*c]const js.JSValueRef, exception: js.ExceptionRef) callconv(.C) js.JSObjectRef {
            JSError(getAllocator(ctx), "" ++ name ++ " is not a constructor", .{}, ctx, exception);
            return null;
        }

        pub fn throwInvalidFunctionError(
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: usize,
            _: [*c]const js.JSValueRef,
            exception: js.ExceptionRef,
        ) callconv(.C) js.JSValueRef {
            JSError(getAllocator(ctx), "" ++ name ++ " is not a function", .{}, ctx, exception);
            return null;
        }

        pub const Constructor = ConstructorWrapper.rfn;

        pub fn get() callconv(.C) [*c]js.JSClassRef {
            if (!loaded) {
                loaded = true;
                definition = define();
                ref = js.JSClassCreate(&definition);
            }

            _ = js.JSClassRetain(ref);

            return &ref;
        }

        pub fn customHasInstance(ctx: js.JSContextRef, _: js.JSObjectRef, value: js.JSValueRef, _: js.ExceptionRef) callconv(.C) bool {
            return js.JSValueIsObjectOfClass(ctx, value, get().*);
        }

        pub fn make(ctx: js.JSContextRef, ptr: *ZigType) js.JSObjectRef {
            var real_ptr = JSPrivateDataPtr.init(ptr).ptr();
            if (comptime Environment.allow_assert) {
                std.debug.assert(JSPrivateDataPtr.isValidPtr(real_ptr));
                std.debug.assert(JSPrivateDataPtr.from(real_ptr).get(ZigType).? == ptr);
            }

            var result = js.JSObjectMake(
                ctx,
                get().*,
                real_ptr,
            );

            if (comptime Environment.allow_assert) {
                std.debug.assert(JSPrivateDataPtr.from(js.JSObjectGetPrivate(result)).ptr() == real_ptr);
            }

            return result;
        }
        pub fn GetClass(comptime ReceiverType: type) type {
            const ClassGetter = struct {
                get: fn (
                    *ReceiverType,
                    js.JSContextRef,
                    js.JSObjectRef,
                    js.ExceptionRef,
                ) js.JSValueRef = rfn,

                pub const ts = typescriptDeclaration();

                pub fn rfn(
                    _: *ReceiverType,
                    ctx: js.JSContextRef,
                    _: js.JSObjectRef,
                    _: js.ExceptionRef,
                ) js.JSValueRef {
                    return js.JSObjectMake(ctx, get().*, null);
                }
            };

            return ClassGetter;
        }

        fn StaticProperty(comptime id: usize) type {
            return struct {
                pub fn getter(
                    ctx: js.JSContextRef,
                    obj: js.JSObjectRef,
                    prop: js.JSStringRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) js.JSValueRef {
                    var this: ObjectPtrType(ZigType) = if (comptime ZigType == void) void{} else GetJSPrivateData(ZigType, obj) orelse return js.JSValueMakeUndefined(ctx);

                    const Field = @TypeOf(@field(
                        properties,
                        property_names[id],
                    ));
                    switch (comptime @typeInfo(Field)) {
                        .Fn => {
                            return @field(
                                properties,
                                property_names[id],
                            )(
                                this,
                                ctx,
                                obj,
                                exception,
                            );
                        },
                        .Struct => {
                            comptime {
                                if (!@hasField(@TypeOf(@field(properties, property_names[id])), "get")) {
                                    @compileError(
                                        "Cannot get static property " ++ property_names[id] ++ " of " ++ name ++ " because it is a struct without a getter",
                                    );
                                }
                            }
                            const func = @field(
                                @field(
                                    properties,
                                    property_names[id],
                                ),
                                "get",
                            );

                            const Func = @typeInfo(@TypeOf(func));
                            const WithPropFn = fn (
                                ObjectPtrType(ZigType),
                                js.JSContextRef,
                                js.JSObjectRef,
                                js.JSStringRef,
                                js.ExceptionRef,
                            ) js.JSValueRef;

                            if (Func.Fn.args.len == @typeInfo(WithPropFn).Fn.args.len) {
                                return func(
                                    this,
                                    ctx,
                                    obj,
                                    prop,
                                    exception,
                                );
                            } else {
                                return func(
                                    this,
                                    ctx,
                                    obj,
                                    exception,
                                );
                            }
                        },
                        else => unreachable,
                    }
                }

                pub fn setter(
                    ctx: js.JSContextRef,
                    obj: js.JSObjectRef,
                    prop: js.JSStringRef,
                    value: js.JSValueRef,
                    exception: js.ExceptionRef,
                ) callconv(.C) bool {
                    var this = GetJSPrivateData(ZigType, obj) orelse return false;

                    switch (comptime @typeInfo(@TypeOf(@field(
                        properties,
                        property_names[id],
                    )))) {
                        .Struct => {
                            return @field(
                                @field(
                                    properties,
                                    property_names[id],
                                ),
                                "set",
                            )(
                                this,
                                ctx,
                                obj,
                                prop,
                                value,
                                exception,
                            );
                        },
                        else => unreachable,
                    }
                }
            };
        }

        // This should only be run at comptime
        pub fn typescriptModuleDeclaration() d.ts.module {
            comptime var class = options.ts.module;
            comptime {
                if (class.read_only == null) {
                    class.read_only = options.read_only;
                }

                if (static_functions.len > 0) {
                    var count: usize = 0;
                    inline for (function_name_literals) |_, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                if (hasTypeScript(Func)) {
                                    if (std.meta.trait.isIndexable(@TypeOf(func.ts))) {
                                        count += func.ts.len;
                                    } else {
                                        count += 1;
                                    }
                                }
                            },
                            else => continue,
                        }
                    }

                    var funcs = std.mem.zeroes([count]d.ts);
                    class.functions = std.mem.span(&funcs);
                    var func_i: usize = 0;

                    inline for (function_name_literals) |_, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                if (hasTypeScript(Func)) {
                                    var ts_functions: []const d.ts = &[_]d.ts{};

                                    if (std.meta.trait.isIndexable(@TypeOf(func.ts))) {
                                        ts_functions = std.mem.span(func.ts);
                                    } else {
                                        var funcs1 = std.mem.zeroes([1]d.ts);
                                        funcs1[0] = func.ts;
                                        ts_functions = std.mem.span(&funcs1);
                                    }

                                    for (ts_functions) |ts_function_| {
                                        var ts_function = ts_function_;
                                        if (ts_function.name.len == 0) {
                                            ts_function.name = function_names[i];
                                        }

                                        if (ts_function.read_only == null) {
                                            ts_function.read_only = class.read_only;
                                        }

                                        class.functions[func_i] = ts_function;

                                        func_i += 1;
                                    }
                                }
                            },
                            else => continue,
                        }
                    }
                }

                if (property_names.len > 0) {
                    var count: usize = 0;
                    var class_count: usize = 0;

                    inline for (property_names) |_, i| {
                        const field = @field(properties, property_names[i]);
                        const Field = @TypeOf(field);

                        if (hasTypeScript(Field)) {
                            switch (getTypeScript(Field, field)) {
                                .decl => |dec| {
                                    switch (dec) {
                                        .class => {
                                            class_count += 1;
                                        },
                                        else => {},
                                    }
                                },
                                .ts => {
                                    count += 1;
                                },
                            }
                        }
                    }

                    var props = std.mem.zeroes([count]d.ts);
                    class.properties = std.mem.span(&props);
                    var property_i: usize = 0;

                    var classes = std.mem.zeroes([class_count + class.classes.len]d.ts.class);
                    if (class.classes.len > 0) {
                        std.mem.copy(d.ts.class, classes, class.classes);
                    }

                    var class_i: usize = class.classes.len;
                    class.classes = std.mem.span(&classes);

                    inline for (property_names) |property_name, i| {
                        const field = @field(properties, property_names[i]);
                        const Field = @TypeOf(field);

                        if (hasTypeScript(Field)) {
                            switch (getTypeScript(Field, field)) {
                                .decl => |dec| {
                                    switch (dec) {
                                        .class => |ts_class| {
                                            class.classes[class_i] = ts_class;
                                            class_i += 1;
                                        },
                                        else => {},
                                    }
                                },
                                .ts => |ts_field_| {
                                    var ts_field: d.ts = ts_field_;
                                    if (ts_field.name.len == 0) {
                                        ts_field.name = property_name;
                                    }

                                    if (ts_field.read_only == null) {
                                        if (hasReadOnly(Field)) {
                                            ts_field.read_only = field.ro;
                                        } else {
                                            ts_field.read_only = class.read_only;
                                        }
                                    }

                                    class.properties[property_i] = ts_field;

                                    property_i += 1;
                                },
                            }
                        }
                    }
                }
            }

            return class;
        }

        pub fn typescriptDeclaration() d.ts.decl {
            comptime var decl = options.ts;
            comptime switch (decl) {
                .module => {
                    decl.module = typescriptModuleDeclaration();
                },
                .class => {
                    decl.class = typescriptClassDeclaration();
                },
                .empty => {},
            };

            return decl;
        }

        pub fn getPropertyNames(
            _: js.JSContextRef,
            _: js.JSObjectRef,
            props: js.JSPropertyNameAccumulatorRef,
        ) callconv(.C) void {
            if (comptime property_name_refs.len > 0) {
                comptime var i: usize = 0;
                if (property_name_refs[0] == null) {
                    inline while (i < property_name_refs.len) : (i += 1) {
                        property_name_refs[i] = js.JSStringCreateStatic(property_names[i].ptr, property_names[i].len);
                    }
                    comptime i = 0;
                }
                inline while (i < property_name_refs.len) : (i += 1) {
                    js.JSPropertyNameAccumulatorAddName(props, property_name_refs[i]);
                }
            }

            if (comptime function_name_refs.len > 0) {
                comptime var j: usize = 0;
                if (function_name_refs[0] == null) {
                    inline while (j < function_name_refs.len) : (j += 1) {
                        function_name_refs[j] = js.JSStringCreateStatic(function_names[j].ptr, function_names[j].len);
                    }
                    comptime j = 0;
                }

                inline while (j < function_name_refs.len) : (j += 1) {
                    js.JSPropertyNameAccumulatorAddName(props, function_name_refs[j]);
                }
            }
        }

        // This should only be run at comptime
        pub fn typescriptClassDeclaration() d.ts.class {
            comptime var class = options.ts.class;

            comptime {
                if (class.name.len == 0) {
                    class.name = options.name;
                }

                if (class.read_only == null) {
                    class.read_only = options.read_only;
                }

                if (static_functions.len > 0) {
                    var count: usize = 0;
                    inline for (function_name_literals) |_, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                if (hasTypeScript(Func)) {
                                    if (std.meta.trait.isIndexable(@TypeOf(func.ts))) {
                                        count += func.ts.len;
                                    } else {
                                        count += 1;
                                    }
                                }
                            },
                            else => continue,
                        }
                    }

                    var funcs = std.mem.zeroes([count]d.ts);
                    class.functions = std.mem.span(&funcs);
                    var func_i: usize = 0;

                    inline for (function_name_literals) |_, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                if (hasTypeScript(Func)) {
                                    var ts_functions: []const d.ts = &[_]d.ts{};

                                    if (std.meta.trait.isIndexable(@TypeOf(func.ts))) {
                                        ts_functions = std.mem.span(func.ts);
                                    } else {
                                        var funcs1 = std.mem.zeroes([1]d.ts);
                                        funcs1[0] = func.ts;
                                        ts_functions = std.mem.span(&funcs1);
                                    }

                                    for (ts_functions) |ts_function_| {
                                        var ts_function = ts_function_;
                                        if (ts_function.name.len == 0) {
                                            ts_function.name = function_names[i];
                                        }

                                        if (class.interface and strings.eqlComptime(ts_function.name, "constructor")) {
                                            ts_function.name = "new";
                                        }

                                        if (ts_function.read_only == null) {
                                            ts_function.read_only = class.read_only;
                                        }

                                        class.functions[func_i] = ts_function;

                                        func_i += 1;
                                    }
                                }
                            },
                            else => continue,
                        }
                    }
                }

                if (property_names.len > 0) {
                    var count: usize = 0;
                    inline for (property_names) |_, i| {
                        const field = @field(properties, property_names[i]);

                        if (hasTypeScript(@TypeOf(field))) {
                            count += 1;
                        }
                    }

                    var props = std.mem.zeroes([count]d.ts);
                    class.properties = std.mem.span(&props);
                    var property_i: usize = 0;

                    inline for (property_names) |property_name, i| {
                        const field = @field(properties, property_names[i]);

                        if (hasTypeScript(@TypeOf(field))) {
                            var ts_field: d.ts = field.ts;
                            if (ts_field.name.len == 0) {
                                ts_field.name = property_name;
                            }

                            if (ts_field.read_only == null) {
                                if (hasReadOnly(@TypeOf(field))) {
                                    ts_field.read_only = field.ro;
                                } else {
                                    ts_field.read_only = class.read_only;
                                }
                            }

                            class.properties[property_i] = ts_field;

                            property_i += 1;
                        }
                    }
                }
            }

            return comptime class;
        }

        var static_properties = brk: {
            var props: [property_names.len + 1]js.JSStaticValue = undefined;
            std.mem.set(
                js.JSStaticValue,
                &props,
                js.JSStaticValue{
                    .name = @intToPtr([*c]const u8, 0),
                    .getProperty = null,
                    .setProperty = null,
                    .attributes = js.JSPropertyAttributes.kJSPropertyAttributeNone,
                },
            );
            break :brk props;
        };

        pub fn define() js.JSClassDefinition {
            var def = js.JSClassDefinition{
                .version = 0,
                .attributes = js.JSClassAttributes.kJSClassAttributeNone,
                .className = name.ptr[0..name.len :0],
                .parentClass = null,
                .staticValues = null,
                .staticFunctions = null,
                .initialize = null,
                .finalize = null,
                .hasProperty = null,
                .getProperty = null,
                .setProperty = null,
                .deleteProperty = null,
                .getPropertyNames = null,
                .callAsFunction = null,
                .callAsConstructor = null,
                .hasInstance = null,
                .convertToType = null,
            };

            // These workaround stage1 compiler bugs
            var JSStaticValue_empty = std.mem.zeroes(js.JSStaticValue);
            var count: usize = 0;

            if (comptime static_functions.len > 0) {
                inline for (function_name_literals) |function_name_literal, i| {
                    _ = i;
                    switch (comptime @typeInfo(@TypeOf(@field(staticFunctions, function_name_literal)))) {
                        .Struct => {
                            if (comptime strings.eqlComptime(function_name_literal, "constructor")) {
                                def.callAsConstructor = To.JS.Constructor(staticFunctions.constructor.rfn).rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "finalize")) {
                                def.finalize = To.JS.Finalize(ZigType, staticFunctions.finalize.rfn).rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "call")) {
                                def.callAsFunction = To.JS.Callback(ZigType, staticFunctions.call.rfn).rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "callAsFunction")) {
                                const ctxfn = @field(staticFunctions, function_name_literal).rfn;
                                const Func: std.builtin.TypeInfo.Fn = @typeInfo(@TypeOf(ctxfn)).Fn;

                                const PointerType = std.meta.Child(Func.args[0].arg_type.?);

                                def.callAsFunction = if (Func.calling_convention == .C) ctxfn else To.JS.Callback(
                                    PointerType,
                                    ctxfn,
                                ).rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "hasProperty")) {
                                def.hasProperty = @field(staticFunctions, "hasProperty").rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "getProperty")) {
                                def.getProperty = @field(staticFunctions, "getProperty").rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "setProperty")) {
                                def.setProperty = @field(staticFunctions, "setProperty").rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "deleteProperty")) {
                                def.deleteProperty = @field(staticFunctions, "deleteProperty").rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "getPropertyNames")) {
                                def.getPropertyNames = @field(staticFunctions, "getPropertyNames").rfn;
                            } else {
                                const CtxField = comptime @field(staticFunctions, function_name_literal);
                                if (comptime !@hasField(@TypeOf(CtxField), "rfn")) {
                                    @compileError("Expected " ++ options.name ++ "." ++ function_name_literal ++ " to have .rfn");
                                }
                                const ctxfn = CtxField.rfn;
                                const Func: std.builtin.TypeInfo.Fn = @typeInfo(@TypeOf(ctxfn)).Fn;

                                const PointerType = if (Func.args[0].arg_type.? == void) void else std.meta.Child(Func.args[0].arg_type.?);

                                static_functions[count] = js.JSStaticFunction{
                                    .name = (function_names[i][0.. :0]).ptr,
                                    .callAsFunction = if (Func.calling_convention == .C) ctxfn else To.JS.Callback(
                                        PointerType,
                                        ctxfn,
                                    ).rfn,
                                    .attributes = comptime if (read_only) js.JSPropertyAttributes.kJSPropertyAttributeReadOnly else js.JSPropertyAttributes.kJSPropertyAttributeNone,
                                };

                                count += 1;
                            }
                        },
                        .Fn => {
                            if (comptime strings.eqlComptime(function_name_literal, "constructor")) {
                                def.callAsConstructor = To.JS.Constructor(staticFunctions.constructor).rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "finalize")) {
                                def.finalize = To.JS.Finalize(ZigType, staticFunctions.finalize).rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "call")) {
                                def.callAsFunction = To.JS.Callback(ZigType, staticFunctions.call).rfn;
                            } else if (comptime strings.eqlComptime(function_name_literal, "hasInstance")) {
                                def.hasInstance = staticFunctions.hasInstance;
                            } else {
                                static_functions[count] = js.JSStaticFunction{
                                    .name = (function_names[i][0.. :0]).ptr,
                                    .callAsFunction = To.JS.Callback(
                                        ZigType,
                                        @field(staticFunctions, function_name_literal),
                                    ).rfn,
                                    .attributes = comptime if (read_only) js.JSPropertyAttributes.kJSPropertyAttributeReadOnly else js.JSPropertyAttributes.kJSPropertyAttributeNone,
                                };

                                count += 1;
                            }
                        },
                        else => {},
                    }

                    // if (singleton) {
                    //     var function = js.JSObjectMakeFunctionWithCallback(ctx, function_name_refs[i], callback);
                    //     instance_functions[i] = function;
                    // }
                }

                def.staticFunctions = static_functions[0..count].ptr;
            }

            if (comptime property_names.len > 0) {
                inline for (property_name_literals) |_, i| {
                    static_properties[i] = JSStaticValue_empty;
                    static_properties[i].getProperty = StaticProperty(i).getter;

                    const field = comptime @field(properties, property_names[i]);

                    if (comptime hasSetter(@TypeOf(field))) {
                        static_properties[i].setProperty = StaticProperty(i).setter;
                    }
                    static_properties[i].name = property_names[i][0.. :0].ptr;
                }
                def.staticValues = &static_properties;
            }

            def.className = class_name_str;
            // def.getProperty = getPropertyCallback;

            if (def.callAsConstructor == null) {
                def.callAsConstructor = throwInvalidConstructorError;
            }

            if (def.callAsFunction == null) {
                def.callAsFunction = throwInvalidFunctionError;
            }

            if (def.getPropertyNames == null) {
                def.getPropertyNames = getPropertyNames;
            }

            if (!singleton and def.hasInstance == null)
                def.hasInstance = customHasInstance;
            return def;
        }
    };
}

const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;

pub const PathString = _global.PathString;

threadlocal var error_args: [1]js.JSValueRef = undefined;
pub fn JSError(
    _: std.mem.Allocator,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
    exception: ExceptionValueRef,
) void {
    @setCold(true);

    if (comptime std.meta.fields(@TypeOf(args)).len == 0) {
        var zig_str = JSC.ZigString.init(fmt);
        zig_str.detectEncoding();
        error_args[0] = zig_str.toValueAuto(JavaScript.VirtualMachine.vm.global).asObjectRef();
        exception.* = js.JSObjectMakeError(ctx, 1, &error_args, null);
    } else {
        var buf = std.fmt.allocPrint(default_allocator, fmt, args) catch unreachable;
        var zig_str = JSC.ZigString.init(buf);
        zig_str.detectEncoding();

        error_args[0] = zig_str.toValueGC(JavaScript.VirtualMachine.vm.global).asObjectRef();
        exception.* = js.JSObjectMakeError(ctx, 1, &error_args, null);
    }
}

pub fn throwTypeError(
    code: JSC.Node.ErrorCode,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
    exception: ExceptionValueRef,
) void {
    @setCold(true);
    var zig_str: JSC.ZigString = undefined;
    if (comptime std.meta.fields(@TypeOf(args)).len == 0) {
        zig_str = JSC.ZigString.init(fmt);
        zig_str.detectEncoding();
    } else {
        var buf = std.fmt.allocPrint(default_allocator, fmt, args) catch unreachable;
        zig_str = JSC.ZigString.init(buf);
        zig_str.detectEncoding();
        zig_str.mark();
    }
    const code_str = ZigString.init(@tagName(code));
    exception.* = JSC.JSValue.createTypeError(&zig_str, &code_str, ctx.asJSGlobalObject()).asObjectRef();
}

pub fn throwInvalidArguments(
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
    exception: ExceptionValueRef,
) void {
    @setCold(true);
    return throwTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE, fmt, args, ctx, exception);
}

pub fn getAllocator(_: js.JSContextRef) std.mem.Allocator {
    return default_allocator;
}

pub const JSStringList = std.ArrayList(js.JSStringRef);

pub const ArrayBuffer = struct {
    ptr: [*]u8 = undefined,
    offset: u32,
    // for the array type,
    len: u32,

    byte_len: u32,

    typed_array_type: js.JSTypedArrayType,

    encoding: JSC.Node.Encoding = JSC.Node.Encoding.utf8,

    pub fn fromTypedArray(ctx: JSC.C.JSContextRef, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ArrayBuffer {
        return ArrayBuffer{
            .byte_len = @truncate(u32, JSC.C.JSObjectGetTypedArrayByteLength(ctx, value.asObjectRef(), exception)),
            .offset = @truncate(u32, JSC.C.JSObjectGetTypedArrayByteOffset(ctx, value.asObjectRef(), exception)),
            .ptr = @ptrCast([*]u8, JSC.C.JSObjectGetTypedArrayBytesPtr(ctx, value.asObjectRef(), exception).?),
            // TODO
            .typed_array_type = js.JSTypedArrayType.kJSTypedArrayTypeUint8Array,
            .len = @truncate(u32, JSC.C.JSObjectGetTypedArrayLength(ctx, value.asObjectRef(), exception)),
        };
    }

    pub fn fromArrayBuffer(ctx: JSC.C.JSContextRef, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ArrayBuffer {
        var buffer = ArrayBuffer{
            .byte_len = @truncate(u32, JSC.C.JSObjectGetArrayBufferByteLength(ctx, value.asObjectRef(), exception)),
            .ptr = @ptrCast([*]u8, JSC.C.JSObjectGetArrayBufferBytesPtr(ctx, value.asObjectRef(), exception).?),
            // TODO
            .typed_array_type = js.JSTypedArrayType.kJSTypedArrayTypeUint8Array,
            .len = 0,
            .offset = 0,
        };
        buffer.len = buffer.byte_len;
        return buffer;
    }

    pub inline fn slice(this: *const @This()) []u8 {
        return this.ptr[this.offset .. this.offset + this.byte_len];
    }
};

pub const MarkedArrayBuffer = struct {
    buffer: ArrayBuffer,
    allocator: ?std.mem.Allocator = null,

    pub fn fromTypedArray(ctx: JSC.C.JSContextRef, value: JSC.JSValue, exception: JSC.C.ExceptionRef) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .allocator = null,
            .buffer = ArrayBuffer.fromTypedArray(ctx, value, exception),
        };
    }
    pub fn fromArrayBuffer(ctx: JSC.C.JSContextRef, value: JSC.JSValue, exception: JSC.C.ExceptionRef) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .allocator = null,
            .buffer = ArrayBuffer.fromArrayBuffer(ctx, value, exception),
        };
    }

    pub fn fromString(str: []const u8, allocator: std.mem.Allocator) !MarkedArrayBuffer {
        var buf = try allocator.dupe(u8, str);
        return MarkedArrayBuffer.fromBytes(buf, allocator, js.JSTypedArrayType.kJSTypedArrayTypeUint8Array);
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?MarkedArrayBuffer {
        return switch (value.jsType()) {
            JSC.JSValue.JSType.Uint16Array, JSC.JSValue.JSType.Uint32Array, JSC.JSValue.JSType.Uint8Array, JSC.JSValue.JSType.DataView => fromTypedArray(global.ref(), value, exception),
            JSC.JSValue.JSType.ArrayBuffer => fromArrayBuffer(global.ref(), value, exception),
            else => null,
        };
    }

    pub fn fromBytes(bytes: []u8, allocator: std.mem.Allocator, typed_array_type: js.JSTypedArrayType) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .buffer = ArrayBuffer{ .offset = 0, .len = @intCast(u32, bytes.len), .byte_len = @intCast(u32, bytes.len), .typed_array_type = typed_array_type, .ptr = bytes.ptr },
            .allocator = allocator,
        };
    }

    pub inline fn slice(this: *const @This()) []u8 {
        return this.buffer.slice();
    }

    pub fn destroy(this: *MarkedArrayBuffer) void {
        const content = this.*;
        if (this.allocator) |allocator| {
            allocator.free(content.buffer.slice());
            allocator.destroy(this);
        }
    }

    pub fn init(allocator: std.mem.Allocator, size: u32, typed_array_type: js.JSTypedArrayType) !*MarkedArrayBuffer {
        const bytes = try allocator.alloc(u8, size);
        var container = try allocator.create(MarkedArrayBuffer);
        container.* = MarkedArrayBuffer.fromBytes(bytes, allocator, typed_array_type);
        return container;
    }

    pub fn toJSObjectRef(this: *const MarkedArrayBuffer, ctx: js.JSContextRef, exception: js.ExceptionRef) js.JSObjectRef {
        return js.JSObjectMakeTypedArrayWithBytesNoCopy(ctx, this.buffer.typed_array_type, this.buffer.ptr, this.buffer.byte_len, MarkedArrayBuffer_deallocator, @intToPtr([*]u8, @ptrToInt(this)), exception);
    }

    pub const toJS = toJSObjectRef;
};

export fn MarkedArrayBuffer_deallocator(bytes_: *anyopaque, ctx_: *anyopaque) void {
    var ctx = @ptrCast(*MarkedArrayBuffer, @alignCast(@alignOf(*MarkedArrayBuffer), ctx_));

    if (comptime Environment.allow_assert) std.debug.assert(ctx.buffer.ptr == @ptrCast([*]u8, bytes_));
    ctx.destroy();
}

pub fn castObj(obj: js.JSObjectRef, comptime Type: type) *Type {
    return JSPrivateDataPtr.from(js.JSObjectGetPrivate(obj)).as(Type);
}

const JSNode = @import("../../js_ast.zig").Macro.JSNode;
const LazyPropertiesObject = @import("../../js_ast.zig").Macro.LazyPropertiesObject;
const ModuleNamespace = @import("../../js_ast.zig").Macro.ModuleNamespace;
const FetchTaskletContext = Fetch.FetchTasklet.FetchTaskletContext;
const Expect = Test.Expect;
const DescribeScope = Test.DescribeScope;
const TestScope = Test.TestScope;
const ExpectPrototype = Test.ExpectPrototype;
const NodeFS = JSC.Node.NodeFS;
const DirEnt = JSC.Node.DirEnt;
const Stats = JSC.Node.Stats;
const BigIntStats = JSC.Node.BigIntStats;
pub const JSPrivateDataPtr = TaggedPointerUnion(.{
    ResolveError,
    BuildError,
    Response,
    Request,
    FetchEvent,
    Headers,
    Body,
    Router,
    JSNode,
    LazyPropertiesObject,
    ModuleNamespace,
    FetchTaskletContext,
    DescribeScope,
    Expect,
    ExpectPrototype,
    NodeFS,
    Stats,
    BigIntStats,
    DirEnt,
});

pub inline fn GetJSPrivateData(comptime Type: type, ref: js.JSObjectRef) ?*Type {
    return JSPrivateDataPtr.from(js.JSObjectGetPrivate(ref)).get(Type);
}

pub const JSPropertyNameIterator = struct {
    array: js.JSPropertyNameArrayRef,
    count: u32,
    i: u32 = 0,

    pub fn next(this: *JSPropertyNameIterator) ?js.JSStringRef {
        if (this.i >= this.count) return null;
        const i = this.i;
        this.i += 1;

        return js.JSPropertyNameArrayGetNameAtIndex(this.array, i);
    }
};
