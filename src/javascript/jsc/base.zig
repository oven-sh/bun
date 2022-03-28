pub const js = @import("../../jsc.zig").C;
const std = @import("std");
const bun = @import("../../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const JavaScript = @import("./javascript.zig");
const ResolveError = JavaScript.ResolveError;
const BuildError = JavaScript.BuildError;
const JSC = @import("../../jsc.zig");
const WebCore = @import("./webcore.zig");
const Test = @import("./test/jest.zig");
const Fetch = WebCore.Fetch;
const Response = WebCore.Response;
const Request = WebCore.Request;
const Router = @import("./api/router.zig");
const FetchEvent = WebCore.FetchEvent;
const Headers = WebCore.Headers.RefCountedHeaders;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;

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
                    const val = zig_str.toValueAuto(context.ptr());

                    break :brk val.asObjectRef();
                },
                []const PathString, []const []const u8, []const []u8, [][]const u8, [][:0]const u8, [][:0]u8 => {
                    var zig_strings_buf: [32]ZigString = undefined;
                    var zig_strings: []ZigString = if (value.len < 32)
                        &zig_strings_buf
                    else
                        (bun.default_allocator.alloc(ZigString, value.len) catch unreachable);
                    defer if (zig_strings.ptr != &zig_strings_buf)
                        bun.default_allocator.free(zig_strings);

                    for (value) |path_string, i| {
                        if (comptime Type == []const PathString) {
                            zig_strings[i] = ZigString.init(path_string.slice());
                        } else {
                            zig_strings[i] = ZigString.init(path_string);
                        }
                    }

                    var array = JSC.JSValue.createStringArray(context.ptr(), zig_strings.ptr, zig_strings.len, clone).asObjectRef();

                    if (clone) {
                        for (value) |path_string| {
                            if (comptime Type == []const PathString) {
                                bun.default_allocator.free(path_string.slice());
                            } else {
                                bun.default_allocator.free(path_string);
                            }
                        }
                        bun.default_allocator.free(value);
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
                            return zig_str.toValue(context.ptr()).asObjectRef();
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
                            var array = bun.default_allocator.alloc(JSC.C.JSValueRef, value.len) catch unreachable;
                            defer bun.default_allocator.free(array);
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
                        return zig_str.toValue(context.ptr()).asObjectRef();
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
                                var val = bun.default_allocator.create(Type) catch unreachable;
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

    pub const Refs = struct {
        pub var empty_string_ptr = [_]u8{0};
        pub var empty_string: js.JSStringRef = undefined;
    };

    pub fn init() void {
        Refs.empty_string = js.JSStringCreateWithUTF8CString(&Refs.empty_string_ptr);
    }
};

const hasSetter = std.meta.trait.hasField("set");
const hasReadOnly = std.meta.trait.hasField("ro");
const hasFinalize = std.meta.trait.hasField("finalize");
const hasEnumerable = std.meta.trait.hasField("enumerable");

const hasTypeScriptField = std.meta.trait.hasField("ts");
fn hasTypeScript(comptime Type: type) bool {
    if (hasTypeScriptField(Type)) {
        return true;
    }

    return @hasDecl(Type, "ts");
}

fn getTypeScript(comptime Type: type, value: Type) d.ts.or_decl {
    if (comptime !@hasDecl(Type, "ts") and !@hasField(Type, "ts")) {
        return d.ts.or_decl{
            .ts = .{ .name = @typeName(Type) },
        };
    }

    if (comptime hasTypeScriptField(Type)) {
        if (@TypeOf(value.ts) == d.ts.decl) {
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
                        var splitter = std.mem.split(u8, str, "\n");

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
    name: stringZ,

    read_only: bool = false,
    hidden: []const string = &[_]string{},
    no_inheritance: bool = false,
    singleton: bool = false,
    ts: d.ts.decl = d.ts.decl{ .empty = 0 },
};

pub fn NewConstructor(
    comptime InstanceType: type,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
) type {
    return struct {
        pub usingnamespace NewClassWithInstanceType(void, InstanceType.Class.class_options, staticFunctions, properties, InstanceType);
        const name_string = &ZigString.init(InstanceType.Class.class_options.name);
        pub fn constructor(ctx: js.JSContextRef) callconv(.C) js.JSObjectRef {
            return JSValue.makeWithNameAndPrototype(
                ctx.ptr(),
                @This().get().*,
                InstanceType.Class.get().*,
                name_string,
            ).asObjectRef();
        }
    };
}

const _to_json: stringZ = "toJSON";

pub fn NewClass(
    comptime ZigType: type,
    comptime options: ClassOptions,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
) type {
    return NewClassWithInstanceType(ZigType, options, staticFunctions, properties, void);
}

pub fn NewClassWithInstanceType(
    comptime ZigType: type,
    comptime options: ClassOptions,
    comptime staticFunctions: anytype,
    comptime properties: anytype,
    comptime InstanceType: type,
) type {
    return struct {
        const read_only = options.read_only;
        const singleton = options.singleton;
        pub const name = options.name;
        pub const class_options = options;
        pub const isJavaScriptCoreClass = true;
        pub const Zig = ZigType;
        const ClassDefinitionCreator = @This();
        const function_names = std.meta.fieldNames(@TypeOf(staticFunctions));
        const function_name_literals = function_names;
        var function_name_refs: [function_names.len]js.JSStringRef = undefined;
        var function_name_refs_set = false;

        const property_names = std.meta.fieldNames(@TypeOf(properties));
        var property_name_refs: [property_names.len]js.JSStringRef = undefined;
        var property_name_refs_set: bool = false;
        const property_name_literals = property_names;

        const LazyClassRef = struct {
            ref: js.JSClassRef = null,
            loaded: bool = false,
        };

        threadlocal var lazy_ref: LazyClassRef = LazyClassRef{};

        pub inline fn isLoaded() bool {
            return lazy_ref.loaded;
        }

        const ConstructorWrapper = struct {
            pub fn rfn(
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                _: js.JSObjectRef,
                argumentCount: usize,
                arguments: [*c]const js.JSValueRef,
                exception: js.ExceptionRef,
            ) callconv(.C) js.JSValueRef {
                return &complete_definition.callAsConstructor.?(ctx, function, argumentCount, arguments, exception);
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
        const class_definition_ptr = &complete_definition;

        pub fn get() callconv(.C) [*c]js.JSClassRef {
            var lazy = lazy_ref;

            if (!lazy.loaded) {
                lazy = .{
                    .ref = js.JSClassCreate(class_definition_ptr),
                    .loaded = true,
                };
                lazy_ref = lazy;
            }

            _ = js.JSClassRetain(lazy.ref);

            return &lazy.ref;
        }

        pub fn customHasInstance(ctx: js.JSContextRef, _: js.JSObjectRef, value: js.JSValueRef, _: js.ExceptionRef) callconv(.C) bool {
            if (InstanceType != void) {
                var current = value;
                while (current != null) {
                    if (js.JSValueIsObjectOfClass(ctx, current, InstanceType.Class.get().*)) {
                        return true;
                    }
                    current = js.JSObjectGetPrototype(ctx, current);
                }
                return false;
            }

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

        pub inline fn getDefinition() js.JSClassDefinition {
            var definition = complete_definition;
            definition.className = options.name;
            return definition;
        }

        const GetterNameFormatter = struct {
            index: usize = 0,

            pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.writeAll(std.mem.span(class_name_str));
                try writer.writeAll("_get_");
                const property_name = property_names[this.index];
                try writer.writeAll(std.mem.span(property_name));
            }
        };

        const SetterNameFormatter = struct {
            index: usize = 0,

            pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.writeAll(std.mem.span(class_name_str));
                try writer.writeAll("_set_");
                const property_name = property_names[this.index];
                try writer.writeAll(std.mem.span(property_name));
            }
        };

        const FunctionNameFormatter = struct {
            index: usize = 0,

            pub fn format(this: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.writeAll(std.mem.span(class_name_str));
                try writer.writeAll("_fn_");
                const property_name = function_names[this.index];
                try writer.writeAll(std.mem.span(property_name));
            }
        };

        const PropertyDeclaration = struct {
            index: usize = 0,
            pub fn format(this: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                const definition = getDefinition();
                const property = definition.staticValues[this.index];

                if (property.getProperty != null) {
                    try writer.writeAll("static JSC_DECLARE_CUSTOM_GETTER(");
                    const getter_name = GetterNameFormatter{ .index = this.index };
                    try getter_name.format(fmt, opts, writer);
                    try writer.writeAll(");\n");
                }

                if (property.setProperty != null) {
                    try writer.writeAll("static JSC_DECLARE_CUSTOM_SETTER(");
                    const getter_name = SetterNameFormatter{ .index = this.index };
                    try getter_name.format(fmt, opts, writer);
                    try writer.writeAll(");\n");
                }
            }
        };

        const FunctionDeclaration = struct {
            index: usize = 0,
            pub fn format(this: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                const definition = getDefinition();
                const function = definition.staticFunctions[this.index];

                if (function.callAsFunction != null) {
                    try writer.writeAll("static JSC_DECLARE_HOST_FUNCTION(");
                    const getter_name = FunctionNameFormatter{ .index = this.index };
                    try getter_name.format(fmt, opts, writer);
                    try writer.writeAll(");\n");
                }
            }
        };

        const PropertyDefinition = struct {
            index: usize = 0,
            pub fn format(this: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                const definition = getDefinition();
                const property = definition.staticValues[this.index];

                if (property.getProperty != null) {
                    try writer.writeAll("static JSC_DEFINE_CUSTOM_GETTER(");
                    const getter_name = GetterNameFormatter{ .index = this.index };
                    try getter_name.format(fmt, opts, writer);
                    try writer.writeAll(", (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName)) {\n");
                    try std.fmt.format(
                        writer,
                        \\  JSC::VM& vm = globalObject->vm();
                        \\  Bun::{[name]s}* thisObject = JSC::jsDynamicCast<Bun::{[name]s}*>(vm, JSValue::decode(thisValue));
                        \\  if (UNLIKELY(!thisObject)) {{
                        \\    return JSValue::encode(JSC::jsUndefined());
                        \\  }}
                        \\
                        \\  auto clientData = Bun::clientData(vm);
                        \\  auto scope = DECLARE_THROW_SCOPE(vm);
                        \\
                    ,
                        .{ .name = std.mem.span(class_name_str) },
                    );
                    if (ZigType == void) {
                        try std.fmt.format(
                            writer,
                            \\ JSC::EncodedJSValue result = Zig__{[getter]any}(globalObject);
                        ,
                            .{ .getter = getter_name },
                        );
                    } else {
                        try std.fmt.format(
                            writer,
                            \\ JSC::EncodedJSValue result = Zig__{[getter]any}(globalObject, thisObject->m_ptr);
                        ,
                            .{ .getter = getter_name },
                        );
                    }

                    try writer.writeAll(
                        \\ JSC::JSObject *obj = JSC::JSValue::decode(result).getObject();
                        \\
                        \\ if (UNLIKELY(obj != nullptr && obj->isErrorInstance())) {
                        \\   scope.throwException(globalObject, obj);
                        \\   return JSValue::encode(JSC::jsUndefined());
                        \\ }
                        \\
                        \\ scope.release();
                        \\
                        \\ return result;
                    );

                    try writer.writeAll("}\n");
                }

                if (property.setProperty != null) {
                    try writer.writeAll("JSC_DEFINE_CUSTOM_SETTER(");
                    const getter_name = SetterNameFormatter{ .index = this.index };
                    try getter_name.format(fmt, opts, writer);
                    try writer.writeAll(", (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue value, JSC::PropertyName)) {\n");
                    try std.fmt.format(writer,
                        \\  JSC::VM& vm = globalObject->vm();
                        \\  Bun::{[name]s}* thisObject = JSC::jsDynamicCast<Bun::{[name]s}*>(vm, JSValue::decode(thisValue));
                        \\  if (UNLIKELY(!thisObject)) {{
                        \\    return false;
                        \\  }}
                        \\
                        \\  auto clientData = Bun::clientData(vm);
                        \\  auto scope = DECLARE_THROW_SCOPE(vm);
                        \\
                        \\
                    , .{ .name = getter_name });
                    try writer.writeAll("};\n");
                }
            }
        };

        const PropertyDeclarationsFormatter = struct {
            pub fn format(_: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                const definition = getDefinition();
                for (definition.staticValues[0 .. static_values_ptr.len - 1]) |_, i| {
                    const property = PropertyDeclaration{ .index = i };
                    try property.format(fmt, opts, writer);
                }
            }
        };

        const PropertyDefinitionsFormatter = struct {
            pub fn format(_: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                const definition = getDefinition();
                if (static_values_ptr.len > 1) {
                    for (definition.staticValues[0 .. static_values_ptr.len - 1]) |_, i| {
                        const property = PropertyDefinition{ .index = i };
                        try property.format(fmt, opts, writer);
                    }
                }
            }
        };

        const FunctionDefinitionsFormatter = struct {
            pub fn format(_: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                _ = fmt;
                _ = writer;
                _ = opts;
                // for (static_properties[0 .. static_properties.len - 1]) |_, i| {
                //     const property = FunctionDefinition{ .index = i };
                //     try property.format(fmt, opts, writer);
                // }
            }
        };

        const FunctionDeclarationsFormatter = struct {
            pub fn format(_: @This(), comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                _ = fmt;
                _ = writer;
                const definition = getDefinition();
                if (static_functions__.len > 1) {
                    for (definition.staticFunctions[0 .. static_functions__.len - 1]) |_, i| {
                        const function = FunctionDeclaration{ .index = i };
                        try function.format(fmt, opts, writer);
                    }
                }
            }
        };

        pub fn @"generateC++Header"(writer: anytype) !void {
            const header_file =
                \\// AUTO-GENERATED FILE
                \\#pragma once
                \\
                \\#include "BunBuiltinNames.h"
                \\#include "BunClientData.h"
                \\#include "root.h"
                \\
                \\
                \\namespace Bun {{
                \\
                \\using namespace JSC;
                \\using namespace Zig;
                \\
                \\class {[name]s} : public JSNonFinalObject {{
                \\   using Base = JSNonFinalObject;
                \\
                \\public:
                \\   {[name]s}(JSC::VM& vm, Structure* structure) : Base(vm, structure) {{}}
                \\
                \\
                \\   DECLARE_INFO;
                \\
                \\   static constexpr unsigned StructureFlags = Base::StructureFlags;
                \\   template<typename CellType, SubspaceAccess> static GCClient::IsoSubspace* subspaceFor(VM& vm)
                \\   {{
                \\    return &vm.cellSpace();
                \\   }}
                \\   static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
                \\   JSC::JSValue prototype)
                \\   {{
                \\     return JSC::Structure::create(vm, globalObject, prototype,
                \\     JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
                \\   }}
                \\
                \\   static {[name]s}* create(JSC::VM& vm, JSC::Structure* structure)
                \\   {{
                \\     {[name]s}* accessor = new (NotNull, JSC::allocateCell<{[name]s}>(vm)) {[name]s}(vm, structure);
                \\     accessor->finishCreation(vm);
                \\     return accessor;
                \\   }}
                \\
                \\   void finishCreation(JSC::VM& vm);
                \\
                \\}};
                \\
                \\}} // namespace Bun
                \\
            ;
            _ = writer;
            _ = header_file;
            const Opts = struct { name: string };
            try writer.print(header_file, Opts{
                .name = std.mem.span(name),
            });
        }

        const LookupTableFormatter = struct {
            // example:
            //
            // /* Source for IntlLocalePrototype.lut.h
            // @begin localePrototypeTable
            //   maximize         intlLocalePrototypeFuncMaximize           DontEnum|Function 0
            //   minimize         intlLocalePrototypeFuncMinimize           DontEnum|Function 0
            //   toString         intlLocalePrototypeFuncToString           DontEnum|Function 0
            //   baseName         intlLocalePrototypeGetterBaseName         DontEnum|ReadOnly|CustomAccessor
            //   calendar         intlLocalePrototypeGetterCalendar         DontEnum|ReadOnly|CustomAccessor
            //   calendars        intlLocalePrototypeGetterCalendars        DontEnum|ReadOnly|CustomAccessor
            //   caseFirst        intlLocalePrototypeGetterCaseFirst        DontEnum|ReadOnly|CustomAccessor
            //   collation        intlLocalePrototypeGetterCollation        DontEnum|ReadOnly|CustomAccessor
            //   collations       intlLocalePrototypeGetterCollations       DontEnum|ReadOnly|CustomAccessor
            //   hourCycle        intlLocalePrototypeGetterHourCycle        DontEnum|ReadOnly|CustomAccessor
            //   hourCycles       intlLocalePrototypeGetterHourCycles       DontEnum|ReadOnly|CustomAccessor
            //   numeric          intlLocalePrototypeGetterNumeric          DontEnum|ReadOnly|CustomAccessor
            //   numberingSystem  intlLocalePrototypeGetterNumberingSystem  DontEnum|ReadOnly|CustomAccessor
            //   numberingSystems intlLocalePrototypeGetterNumberingSystems DontEnum|ReadOnly|CustomAccessor
            //   language         intlLocalePrototypeGetterLanguage         DontEnum|ReadOnly|CustomAccessor
            //   script           intlLocalePrototypeGetterScript           DontEnum|ReadOnly|CustomAccessor
            //   region           intlLocalePrototypeGetterRegion           DontEnum|ReadOnly|CustomAccessor
            //   timeZones        intlLocalePrototypeGetterTimeZones        DontEnum|ReadOnly|CustomAccessor
            //   textInfo         intlLocalePrototypeGetterTextInfo         DontEnum|ReadOnly|CustomAccessor
            //   weekInfo         intlLocalePrototypeGetterWeekInfo         DontEnum|ReadOnly|CustomAccessor
            // @end
            // */
            pub fn format(_: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                const definition = getDefinition();
                try writer.writeAll("/* Source for ");
                try writer.writeAll(std.mem.span(definition.className));
                try writer.writeAll(".lut.h\n");
                try writer.writeAll("@begin ");
                try writer.writeAll(std.mem.span(definition.className));
                try writer.writeAll("HashTableValues \n");
                var middle_padding: usize = 0;
                if (property_names.len > 0) {
                    for (property_names) |prop| {
                        middle_padding = @maximum(prop.len, middle_padding);
                    }
                }
                if (function_names.len > 0) {
                    for (function_names[0..function_names.len]) |_name| {
                        middle_padding = @maximum(std.mem.span(_name).len, middle_padding);
                    }
                }

                if (property_names.len > 0) {
                    comptime var i: usize = 0;
                    inline while (i < property_names.len) : (i += 1) {
                        try writer.writeAll("  ");
                        const name_ = property_names[i];
                        try writer.writeAll(name_);
                        try writer.writeAll(" ");
                        var k: usize = 0;
                        while (k < middle_padding - name_.len) : (k += 1) {
                            try writer.writeAll(" ");
                        }

                        try writer.print("{any} ", .{GetterNameFormatter{ .index = i }});

                        k = 0;

                        while (k < middle_padding - name_.len) : (k += 1) {
                            try writer.writeAll(" ");
                        }

                        try writer.writeAll("CustomAccessor");
                        if (options.read_only or @hasField(@TypeOf(@field(properties, property_names[i])), "ro")) {
                            try writer.writeAll("|ReadOnly");
                        }

                        if (@hasField(@TypeOf(@field(properties, property_names[i])), "enumerable") and !@field(properties, property_names[i])) {
                            try writer.writeAll("|DontEnum");
                        }

                        try writer.writeAll("\n");
                    }
                }
                if (function_names.len > 0) {
                    comptime var i: usize = 0;
                    inline while (i < function_names.len) : (i += 1) {
                        try writer.writeAll("  ");
                        const name_ = function_names[i];
                        try writer.writeAll(name_);
                        try writer.writeAll(" ");
                        var k: usize = 0;
                        while (k < middle_padding - name_.len) : (k += 1) {
                            try writer.writeAll(" ");
                        }

                        try writer.print("{any} ", .{FunctionNameFormatter{ .index = i }});
                        k = 0;

                        while (k < middle_padding - name_.len) : (k += 1) {
                            try writer.writeAll(" ");
                        }
                        var read_only_ = false;
                        if (options.read_only or @hasField(@TypeOf(comptime @field(staticFunctions, function_names[i])), "ro")) {
                            read_only_ = true;
                            try writer.writeAll("ReadOnly");
                        }

                        if (comptime std.meta.trait.isContainer(
                            @TypeOf(comptime @field(staticFunctions, function_names[i])),
                        ) and
                            @hasField(@TypeOf(comptime @field(
                            staticFunctions,
                            function_names[i],
                        )), "enumerable") and !@field(staticFunctions, function_names[i]).enumerable) {
                            if (read_only_) {
                                try writer.writeAll("|");
                            }
                            try writer.writeAll("DontEnum");
                        }

                        try writer.writeAll("Function 1");

                        try writer.writeAll("\n");
                    }
                }

                try writer.writeAll("@end\n*/\n");
            }
        };

        pub fn @"generateC++Class"(writer: anytype) !void {
            const implementation_file =
                \\// AUTO-GENERATED FILE
                \\
                \\#include "{[name]s}.generated.h"
                \\#include "{[name]s}.lut.h"
                \\
                \\namespace Bun {{
                \\
                \\{[lut]any}
                \\
                \\using JSGlobalObject = JSC::JSGlobalObject;
                \\using Exception = JSC::Exception;
                \\using JSValue = JSC::JSValue;
                \\using JSString = JSC::JSString;
                \\using JSModuleLoader = JSC::JSModuleLoader;
                \\using JSModuleRecord = JSC::JSModuleRecord;
                \\using Identifier = JSC::Identifier;
                \\using SourceOrigin = JSC::SourceOrigin;
                \\using JSObject = JSC::JSObject;
                \\using JSNonFinalObject = JSC::JSNonFinalObject;
                \\namespace JSCastingHelpers = JSC::JSCastingHelpers;
                \\
                \\#pragma mark - Function Declarations
                \\
                \\{[function_declarations]any}
                \\
                \\#pragma mark - Property Declarations
                \\
                \\{[property_declarations]any}
                \\
                \\#pragma mark - Function Definitions
                \\
                \\{[function_definitions]any}
                \\
                \\#pragma mark - Property Definitions
                \\
                \\{[property_definitions]any}
                \\
                \\const JSC::ClassInfo {[name]s}::s_info = {{ "{[name]s}"_s, &Base::s_info, &{[name]s}HashTableValues, nullptr, CREATE_METHOD_TABLE([name]s) }};
                \\
                \\  void {[name]s}::finishCreation(JSC::VM& vm) {{
                \\    Base::finishCreation(vm);
                \\    auto clientData = Bun::clientData(vm);
                \\    JSC::JSGlobalObject *globalThis = globalObject();
                \\
                \\
                \\#pragma mark - Property Initializers
                \\
                \\{[property_initializers]any}
                \\
                \\#pragma mark - Function Initializers
                \\
                \\{[function_initializers]any}
                \\
                \\  }}
                \\
                \\}} // namespace Bun
                \\
            ;

            try writer.print(implementation_file, .{
                .name = std.mem.span(class_name_str),
                .function_initializers = @as(string, ""),
                .property_initializers = @as(string, ""),
                .function_declarations = FunctionDeclarationsFormatter{},
                .property_declarations = FunctionDeclarationsFormatter{},
                .function_definitions = FunctionDefinitionsFormatter{},
                .property_definitions = PropertyDefinitionsFormatter{},
                .lut = LookupTableFormatter{},
            });
        }

        // This should only be run at comptime
        pub fn typescriptModuleDeclaration() d.ts.module {
            comptime var class = options.ts.module;
            comptime {
                if (class.read_only == null) {
                    class.read_only = options.read_only;
                }

                if (function_name_literals.len > 0) {
                    var count: usize = 0;
                    inline for (function_name_literals) |_, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                var total: usize = 1;
                                if (hasTypeScript(Func)) {
                                    if (std.meta.trait.isIndexable(@TypeOf(func.ts))) {
                                        total = func.ts.len;
                                    }
                                }

                                count += total;
                            },
                            else => continue,
                        }
                    }

                    var funcs = std.mem.zeroes([count]d.ts);
                    class.functions = std.mem.span(&funcs);
                    var func_i: usize = 0;
                    @setEvalBranchQuota(99999);
                    inline for (function_name_literals) |_, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                var ts_functions: []const d.ts = &[_]d.ts{};

                                if (hasTypeScript(Func)) {
                                    if (std.meta.trait.isIndexable(@TypeOf(func.ts))) {
                                        ts_functions = std.mem.span(func.ts);
                                    }
                                }

                                if (ts_functions.len == 0 and hasTypeScript(Func)) {
                                    var funcs1 = std.mem.zeroes([1]d.ts);
                                    funcs1[0] = func.ts;
                                    ts_functions = std.mem.span(&funcs1);
                                } else {
                                    var funcs1 = std.mem.zeroes([1]d.ts);
                                    funcs1[0] = .{ .name = function_names[i] };
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
                    decl.class = typescriptClassDeclaration(decl.class);
                },
                .empty => {
                    decl = d.ts.decl{
                        .class = typescriptClassDeclaration(
                            d.ts.class{
                                .name = options.name,
                            },
                        ),
                    };
                },
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
                if (!property_name_refs_set) {
                    property_name_refs_set = true;
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
                if (!function_name_refs_set) {
                    function_name_refs_set = true;
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
        pub fn typescriptClassDeclaration(comptime original: d.ts.class) d.ts.class {
            comptime var class = original;

            comptime {
                if (class.name.len == 0) {
                    class.name = options.name;
                }

                if (class.read_only == null) {
                    class.read_only = options.read_only;
                }

                if (function_name_literals.len > 0) {
                    var count: usize = 0;
                    inline for (function_name_literals) |_, i| {
                        const func = @field(staticFunctions, function_names[i]);
                        const Func = @TypeOf(func);

                        switch (@typeInfo(Func)) {
                            .Struct => {
                                var total: usize = 1;
                                if (hasTypeScript(Func)) {
                                    if (std.meta.trait.isIndexable(@TypeOf(func.ts))) {
                                        total = func.ts.len;
                                    }
                                }

                                count += total;
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
                                var ts_functions: []const d.ts = &[_]d.ts{};

                                if (hasTypeScript(Func)) {
                                    if (std.meta.trait.isIndexable(@TypeOf(func.ts))) {
                                        ts_functions = std.mem.span(func.ts);
                                    }
                                }

                                if (ts_functions.len == 0 and hasTypeScript(Func)) {
                                    var funcs1 = std.mem.zeroes([1]d.ts);
                                    funcs1[0] = func.ts;
                                    ts_functions = std.mem.span(&funcs1);
                                } else {
                                    var funcs1 = std.mem.zeroes([1]d.ts);
                                    funcs1[0] = .{ .name = function_names[i] };
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
                            },
                            else => continue,
                        }
                    }
                }

                if (property_names.len > 0) {
                    var count: usize = property_names.len;

                    var props = std.mem.zeroes([count]d.ts);
                    class.properties = std.mem.span(&props);
                    var property_i: usize = 0;

                    inline for (property_names) |property_name, i| {
                        const field = @field(properties, property_names[i]);

                        var ts_field: d.ts = .{};

                        if (hasTypeScript(@TypeOf(field))) {
                            ts_field = field.ts;
                        }

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

            return comptime class;
        }

        const static_properties: [property_names.len + 1]js.JSStaticValue = brk: {
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
            for (property_name_literals) |_, i| {
                props[i] = brk2: {
                    var static_prop = JSC.C.JSStaticValue{
                        .name = property_names[i][0.. :0].ptr,
                        .getProperty = null,
                        .setProperty = null,
                        .attributes = @intToEnum(js.JSPropertyAttributes, 0),
                    };
                    static_prop.getProperty = StaticProperty(i).getter;

                    const field = @field(properties, property_names[i]);

                    if (hasSetter(@TypeOf(field))) {
                        static_prop.setProperty = StaticProperty(i).setter;
                    }
                    break :brk2 static_prop;
                };
            }
            break :brk props;
        };

        // this madness is a workaround for stage1 compiler bugs
        fn generateDef(comptime ReturnType: type) ReturnType {
            var count = 0;
            var def: js.JSClassDefinition = js.JSClassDefinition{
                .version = 0,
                .attributes = js.JSClassAttributes.kJSClassAttributeNone,
                .className = "",
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

            var __static_functions: [function_name_literals.len + 1]js.JSStaticFunction = undefined;
            for (__static_functions) |_, i| {
                __static_functions[i] = js.JSStaticFunction{
                    .name = @intToPtr([*c]const u8, 0),
                    .callAsFunction = null,
                    .attributes = js.JSPropertyAttributes.kJSPropertyAttributeNone,
                };
            }

            for (function_name_literals) |function_name_literal, i| {
                const is_read_only = options.read_only;

                _ = i;
                switch (@typeInfo(@TypeOf(@field(staticFunctions, function_name_literal)))) {
                    .Struct => {
                        if (strings.eqlComptime(function_name_literal, "constructor")) {
                            def.callAsConstructor = To.JS.Constructor(staticFunctions.constructor.rfn).rfn;
                        } else if (strings.eqlComptime(function_name_literal, "finalize")) {
                            def.finalize = To.JS.Finalize(ZigType, staticFunctions.finalize.rfn).rfn;
                        } else if (strings.eqlComptime(function_name_literal, "call")) {
                            def.callAsFunction = To.JS.Callback(ZigType, staticFunctions.call.rfn).rfn;
                        } else if (strings.eqlComptime(function_name_literal, "callAsFunction")) {
                            const ctxfn = @field(staticFunctions, function_name_literal).rfn;
                            const Func: std.builtin.TypeInfo.Fn = @typeInfo(@TypeOf(ctxfn)).Fn;

                            const PointerType = std.meta.Child(Func.args[0].arg_type.?);

                            def.callAsFunction = if (Func.calling_convention == .C) ctxfn else To.JS.Callback(
                                PointerType,
                                ctxfn,
                            ).rfn;
                        } else if (strings.eqlComptime(function_name_literal, "hasProperty")) {
                            def.hasProperty = @field(staticFunctions, "hasProperty").rfn;
                        } else if (strings.eqlComptime(function_name_literal, "getProperty")) {
                            def.getProperty = @field(staticFunctions, "getProperty").rfn;
                        } else if (strings.eqlComptime(function_name_literal, "setProperty")) {
                            def.setProperty = @field(staticFunctions, "setProperty").rfn;
                        } else if (strings.eqlComptime(function_name_literal, "deleteProperty")) {
                            def.deleteProperty = @field(staticFunctions, "deleteProperty").rfn;
                        } else if (strings.eqlComptime(function_name_literal, "getPropertyNames")) {
                            def.getPropertyNames = @field(staticFunctions, "getPropertyNames").rfn;
                        } else if (strings.eqlComptime(function_name_literal, "convertToType")) {
                            def.convertToType = @field(staticFunctions, "convertToType").rfn;
                        } else {
                            const CtxField = @field(staticFunctions, function_name_literals[i]);
                            if (!@hasField(@TypeOf(CtxField), "rfn")) {
                                @compileError("Expected " ++ options.name ++ "." ++ function_name_literal ++ " to have .rfn");
                            }
                            const ctxfn = CtxField.rfn;
                            const Func: std.builtin.TypeInfo.Fn = @typeInfo(@TypeOf(ctxfn)).Fn;

                            var attributes: c_uint = @enumToInt(js.JSPropertyAttributes.kJSPropertyAttributeNone);

                            if (is_read_only or hasReadOnly(@TypeOf(CtxField))) {
                                attributes |= @enumToInt(js.JSPropertyAttributes.kJSPropertyAttributeReadOnly);
                            }

                            if (hasEnumerable(@TypeOf(CtxField)) and !CtxField.enumerable) {
                                attributes |= @enumToInt(js.JSPropertyAttributes.kJSPropertyAttributeDontEnum);
                            }

                            var PointerType = void;

                            if (Func.args[0].arg_type.? != void) {
                                PointerType = std.meta.Child(Func.args[0].arg_type.?);
                            }

                            __static_functions[count] = js.JSStaticFunction{
                                .name = @ptrCast([*c]const u8, function_names[i].ptr),
                                .callAsFunction = if (Func.calling_convention == .C) ctxfn else To.JS.Callback(
                                    PointerType,
                                    ctxfn,
                                ).rfn,
                                .attributes = @intToEnum(js.JSPropertyAttributes, attributes),
                            };

                            count += 1;
                        }
                    },
                    .Fn => {
                        if (strings.eqlComptime(function_name_literal, "constructor")) {
                            def.callAsConstructor = To.JS.Constructor(staticFunctions.constructor).rfn;
                        } else if (strings.eqlComptime(function_name_literal, "finalize")) {
                            def.finalize = To.JS.Finalize(ZigType, staticFunctions.finalize).rfn;
                        } else if (strings.eqlComptime(function_name_literal, "call")) {
                            def.callAsFunction = To.JS.Callback(ZigType, staticFunctions.call).rfn;
                        } else if (strings.eqlComptime(function_name_literal, "getPropertyNames")) {
                            def.getPropertyNames = To.JS.Callback(ZigType, staticFunctions.getPropertyNames).rfn;
                        } else if (strings.eqlComptime(function_name_literal, "hasInstance")) {
                            def.hasInstance = staticFunctions.hasInstance;
                        } else {
                            const attributes: js.JSPropertyAttributes = brk: {
                                var base = @enumToInt(js.JSPropertyAttributes.kJSPropertyAttributeNone);

                                if (is_read_only)
                                    base |= @enumToInt(js.JSPropertyAttributes.kJSPropertyAttributeReadOnly);

                                break :brk @intToEnum(js.JSPropertyAttributes, base);
                            };

                            __static_functions[count] = js.JSStaticFunction{
                                .name = @ptrCast([*c]const u8, function_names[i].ptr),
                                .callAsFunction = To.JS.Callback(
                                    ZigType,
                                    @field(staticFunctions, function_name_literal),
                                ).rfn,
                                .attributes = attributes,
                            };

                            count += 1;
                        }
                    },
                    else => {},
                }
            }

            if (ReturnType == JSC.C.JSClassDefinition) {
                return def;
            } else {
                return __static_functions;
            }
        }

        const base_def_ = generateDef(JSC.C.JSClassDefinition);
        const static_functions__: [function_name_literals.len + 1]js.JSStaticFunction = generateDef([function_name_literals.len + 1]js.JSStaticFunction);
        const static_functions_ptr = &static_functions__;
        const static_values_ptr = &static_properties;
        const class_name_str: stringZ = options.name;

        const complete_definition = brk: {
            var def = base_def_;
            def.staticFunctions = static_functions_ptr;
            if (options.no_inheritance) {
                def.attributes = JSC.C.JSClassAttributes.kJSClassAttributeNoAutomaticPrototype;
            }
            if (property_names.len > 0) {
                def.staticValues = static_values_ptr;
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
            break :brk def;
        };
    };
}

const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;

pub const PathString = bun.PathString;

pub fn JSError(
    _: std.mem.Allocator,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
    exception: ExceptionValueRef,
) void {
    var error_args: [1]js.JSValueRef = undefined;
    @setCold(true);

    if (comptime std.meta.fields(@TypeOf(args)).len == 0) {
        var zig_str = JSC.ZigString.init(fmt);
        zig_str.detectEncoding();
        error_args[0] = zig_str.toValueAuto(ctx.ptr()).asObjectRef();
        exception.* = js.JSObjectMakeError(ctx, 1, &error_args, null);
    } else {
        var buf = std.fmt.allocPrint(default_allocator, fmt, args) catch unreachable;
        var zig_str = JSC.ZigString.init(buf);
        zig_str.detectEncoding();

        error_args[0] = zig_str.toValueGC(ctx.ptr()).asObjectRef();
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
    exception.* = toTypeError(code, fmt, args, ctx).asObjectRef();
}

pub fn toTypeError(
    code: JSC.Node.ErrorCode,
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
) JSC.JSValue {
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
    return JSC.JSValue.createTypeError(&zig_str, &code_str, ctx.ptr());
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

pub fn toInvalidArguments(
    comptime fmt: string,
    args: anytype,
    ctx: js.JSContextRef,
) JSC.JSValue {
    @setCold(true);
    return toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_TYPE, fmt, args, ctx);
}

pub fn getAllocator(_: js.JSContextRef) std.mem.Allocator {
    return default_allocator;
}

pub const JSStringList = std.ArrayList(js.JSStringRef);

pub const ArrayBuffer = extern struct {
    ptr: [*]u8 = undefined,
    offset: u32,
    len: u32,
    byte_len: u32,
    typed_array_type: JSC.JSValue.JSType,

    pub const name = "Bun__ArrayBuffer";
    pub const Stream = std.io.FixedBufferStream([]u8);

    pub inline fn stream(this: ArrayBuffer) Stream {
        return Stream{ .pos = 0, .buf = this.slice() };
    }

    pub fn fromTypedArray(ctx: JSC.C.JSContextRef, value: JSC.JSValue, _: JSC.C.ExceptionRef) ArrayBuffer {
        var out = std.mem.zeroes(ArrayBuffer);
        std.debug.assert(value.asArrayBuffer_(ctx.ptr(), &out));
        return out;
    }

    pub fn fromBytes(bytes: []u8, typed_array_type: JSC.JSValue.JSType) ArrayBuffer {
        return ArrayBuffer{ .offset = 0, .len = @intCast(u32, bytes.len), .byte_len = @intCast(u32, bytes.len), .typed_array_type = typed_array_type, .ptr = bytes.ptr };
    }

    pub fn toJS(this: ArrayBuffer, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.JSValue {
        if (this.typed_array_type == .ArrayBuffer) {
            return JSC.JSValue.fromRef(JSC.C.JSObjectMakeArrayBufferWithBytesNoCopy(
                ctx,
                this.ptr,
                this.byte_len,
                MarkedArrayBuffer_deallocator,
                @intToPtr(*anyopaque, @ptrToInt(&bun.default_allocator)),
                exception,
            ));
        }

        return JSC.JSValue.fromRef(JSC.C.JSObjectMakeTypedArrayWithBytesNoCopy(
            ctx,
            this.typed_array_type.toC(),
            this.ptr,
            this.byte_len,
            MarkedArrayBuffer_deallocator,
            @intToPtr(*anyopaque, @ptrToInt(&bun.default_allocator)),
            exception,
        ));
    }

    pub fn toJSWithContext(
        this: ArrayBuffer,
        ctx: JSC.C.JSContextRef,
        deallocator: *anyopaque,
        callback: JSC.C.JSTypedArrayBytesDeallocator,
        exception: JSC.C.ExceptionRef,
    ) JSC.JSValue {
        if (this.typed_array_type == .ArrayBuffer) {
            return JSC.JSValue.fromRef(JSC.C.JSObjectMakeArrayBufferWithBytesNoCopy(
                ctx,
                this.ptr,
                this.byte_len,
                callback,
                deallocator,
                exception,
            ));
        }

        return JSC.JSValue.fromRef(JSC.C.JSObjectMakeTypedArrayWithBytesNoCopy(
            ctx,
            this.typed_array_type.toC(),
            this.ptr,
            this.byte_len,
            callback,
            deallocator,
            exception,
        ));
    }

    pub const fromArrayBuffer = fromTypedArray;

    pub inline fn slice(this: *const @This()) []u8 {
        return this.ptr[this.offset .. this.offset + this.len];
    }

    pub inline fn byteSlice(this: *const @This()) []u8 {
        return this.ptr[this.offset .. this.offset + this.byte_len];
    }

    pub inline fn asU16(this: *const @This()) []u16 {
        return std.mem.bytesAsSlice(u16, @alignCast(@alignOf([*]u16), this.ptr[this.offset..this.byte_len]));
    }

    pub inline fn asU16Unaligned(this: *const @This()) []align(1) u16 {
        return std.mem.bytesAsSlice(u16, @alignCast(@alignOf([*]align(1) u16), this.ptr[this.offset..this.byte_len]));
    }

    pub inline fn asU32(this: *const @This()) []u32 {
        return std.mem.bytesAsSlice(u32, @alignCast(@alignOf([*]u32), this.ptr)[this.offset..this.byte_len]);
    }
};

pub const MarkedArrayBuffer = struct {
    buffer: ArrayBuffer,
    allocator: ?std.mem.Allocator = null,

    pub const Stream = ArrayBuffer.Stream;

    pub inline fn stream(this: *MarkedArrayBuffer) Stream {
        return this.buffer.stream();
    }

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
        return MarkedArrayBuffer.fromBytes(buf, allocator, JSC.JSValue.JSType.Uint8Array);
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?MarkedArrayBuffer {
        return switch (value.jsType()) {
            JSC.JSValue.JSType.Uint16Array, JSC.JSValue.JSType.Uint32Array, JSC.JSValue.JSType.Uint8Array, JSC.JSValue.JSType.DataView => fromTypedArray(global.ref(), value, exception),
            JSC.JSValue.JSType.ArrayBuffer => fromArrayBuffer(global.ref(), value, exception),
            else => null,
        };
    }

    pub fn fromBytes(bytes: []u8, allocator: std.mem.Allocator, typed_array_type: JSC.JSValue.JSType) MarkedArrayBuffer {
        return MarkedArrayBuffer{
            .buffer = ArrayBuffer.fromBytes(bytes, typed_array_type),
            .allocator = allocator,
        };
    }

    pub inline fn slice(this: *const @This()) []u8 {
        return this.buffer.slice();
    }

    pub fn destroy(this: *MarkedArrayBuffer) void {
        const content = this.*;
        if (this.allocator) |allocator| {
            this.allocator = null;
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

    pub fn toJSObjectRef(this: MarkedArrayBuffer, ctx: js.JSContextRef, exception: js.ExceptionRef) js.JSObjectRef {
        return js.JSObjectMakeTypedArrayWithBytesNoCopy(
            ctx,
            this.buffer.typed_array_type.toC(),
            this.buffer.ptr,

            this.buffer.byte_len,
            MarkedArrayBuffer_deallocator,
            this.buffer.ptr,
            exception,
        );
    }

    pub const toJS = toJSObjectRef;
};

// expensive heap reference-counted string type
// only use this for big strings
// like source code
// not little ones
pub const RefString = struct {
    ptr: [*]const u8 = undefined,
    len: usize = 0,
    hash: Hash = 0,

    count: u32 = 0,
    allocator: std.mem.Allocator,

    ctx: ?*anyopaque = null,
    onBeforeDeinit: ?Callback = null,

    pub const Hash = u32;
    pub const Map = std.HashMap(Hash, *JSC.RefString, IdentityContext(Hash), 80);

    pub fn toJS(this: *RefString, global: *JSC.JSGlobalObject) JSValue {
        return JSC.ZigString.init(this.slice()).external(global, this, RefString__external);
    }

    pub const Callback = fn (ctx: *anyopaque, str: *RefString) void;

    pub fn computeHash(input: []const u8) u32 {
        return @truncate(u32, std.hash.Wyhash.hash(0, input));
    }

    pub fn ref(this: *RefString) void {
        this.count += 1;
    }

    pub fn slice(this: *RefString) []const u8 {
        this.ref();

        return this.leak();
    }

    pub fn leak(this: RefString) []const u8 {
        @setRuntimeSafety(false);
        return this.ptr[0..this.len];
    }

    pub fn deref(this: *RefString) void {
        this.count -|= 1;

        if (this.count == 0) {
            this.deinit();
        }
    }

    pub export fn RefString__free(this: *RefString, _: [*]const u8, _: usize) void {
        this.deref();
    }

    pub export fn RefString__external(this: ?*anyopaque, _: ?*anyopaque, _: usize) void {
        bun.cast(*RefString, this.?).deref();
    }

    pub fn deinit(this: *RefString) void {
        if (this.onBeforeDeinit) |onBeforeDeinit| {
            onBeforeDeinit(this.ctx.?, this);
        }

        this.allocator.free(this.leak());
        this.allocator.destroy(this);
    }
};

comptime {
    std.testing.refAllDecls(RefString);
}

export fn MarkedArrayBuffer_deallocator(bytes_: *anyopaque, _: *anyopaque) void {
    const mimalloc = @import("../../allocators/mimalloc.zig");
    // zig's memory allocator interface won't work here
    // mimalloc knows the size of things
    // but we don't
    mimalloc.mi_free(bytes_);
}
pub export fn BlobArrayBuffer_deallocator(_: *anyopaque, blob: *anyopaque) void {
    // zig's memory allocator interface won't work here
    // mimalloc knows the size of things
    // but we don't
    var store = bun.cast(*JSC.WebCore.Blob.Store, blob);
    store.deref();
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
const Transpiler = @import("./api/transpiler.zig");
const TextEncoder = WebCore.TextEncoder;
const TextDecoder = WebCore.TextDecoder;
const TimeoutTask = JSC.BunTimer.Timeout.TimeoutTask;
const HTMLRewriter = JSC.Cloudflare.HTMLRewriter;
const Element = JSC.Cloudflare.Element;
const Comment = JSC.Cloudflare.Comment;
const TextChunk = JSC.Cloudflare.TextChunk;
const DocType = JSC.Cloudflare.DocType;
const EndTag = JSC.Cloudflare.EndTag;
const DocEnd = JSC.Cloudflare.DocEnd;
const AttributeIterator = JSC.Cloudflare.AttributeIterator;
const Blob = JSC.WebCore.Blob;

pub const JSPrivateDataPtr = TaggedPointerUnion(.{
    AttributeIterator,
    BigIntStats,
    Blob,
    Body,
    BuildError,
    Comment,
    DescribeScope,
    DirEnt,
    DocEnd,
    DocType,
    Element,
    EndTag,
    Expect,
    ExpectPrototype,
    FetchEvent,
    FetchTaskletContext,
    Headers,
    HTMLRewriter,
    JSNode,
    LazyPropertiesObject,
    ModuleNamespace,
    NodeFS,
    Request,
    ResolveError,
    Response,
    Router,
    Stats,
    TextChunk,
    TextDecoder,
    TextEncoder,
    TimeoutTask,
    Transpiler,
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

pub fn getterWrap(comptime Container: type, comptime name: string) GetterType(Container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.TypeInfo.Fn = @typeInfo(FunctionType).Fn;

        pub fn callback(
            this: *Container,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSStringRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            const result: JSValue = @call(.{}, @field(Container, name), .{ this, ctx.ptr() });
            if (!result.isUndefinedOrNull() and result.isError()) {
                exception.* = result.asObjectRef();
                return null;
            }

            return result.asObjectRef();
        }
    }.callback;
}

pub fn setterWrap(comptime Container: type, comptime name: string) SetterType(Container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.TypeInfo.Fn = @typeInfo(FunctionType).Fn;

        pub fn callback(
            this: *Container,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSStringRef,
            value: js.JSValueRef,
            exception: js.ExceptionRef,
        ) bool {
            @call(.{}, @field(Container, name), .{ this, JSC.JSValue.fromRef(value), exception, ctx.ptr() });
            return exception.* == null;
        }
    }.callback;
}

fn GetterType(comptime Container: type) type {
    return fn (
        this: *Container,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSStringRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef;
}

fn SetterType(comptime Container: type) type {
    return fn (
        this: *Container,
        ctx: js.JSContextRef,
        obj: js.JSObjectRef,
        prop: js.JSStringRef,
        value: js.JSValueRef,
        exception: js.ExceptionRef,
    ) bool;
}

fn MethodType(comptime Container: type) type {
    return fn (
        this: *Container,
        ctx: js.JSContextRef,
        thisObject: js.JSObjectRef,
        target: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef;
}

pub fn wrapSync(
    comptime Container: type,
    comptime name: string,
) MethodType(Container) {
    return wrap(Container, name, false);
}

pub fn wrapAsync(
    comptime Container: type,
    comptime name: string,
) MethodType(Container) {
    return wrap(Container, name, true);
}

pub fn wrap(
    comptime Container: type,
    comptime name: string,
    comptime maybe_async: bool,
) MethodType(Container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.TypeInfo.Fn = @typeInfo(FunctionType).Fn;

        pub fn callback(
            this: *Container,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            thisObject: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            var iter = JSC.Node.ArgumentsSlice.from(arguments);
            var args: std.meta.ArgsTuple(FunctionType) = undefined;

            comptime var i: usize = 0;
            inline while (i < FunctionTypeInfo.args.len) : (i += 1) {
                const ArgType = comptime FunctionTypeInfo.args[i].arg_type.?;

                switch (comptime ArgType) {
                    *Container => {
                        args[i] = this;
                    },
                    *JSC.JSGlobalObject => {
                        args[i] = ctx.ptr();
                    },
                    ZigString => {
                        var string_value = iter.nextEat() orelse {
                            JSC.throwInvalidArguments("Missing argument", .{}, ctx, exception);
                            return null;
                        };

                        if (string_value.isUndefinedOrNull()) {
                            JSC.throwInvalidArguments("Expected string", .{}, ctx, exception);
                            return null;
                        }

                        args[i] = string_value.getZigString(ctx.ptr());
                    },
                    ?JSC.Cloudflare.ContentOptions => {
                        if (iter.nextEat()) |content_arg| {
                            if (content_arg.get(ctx.ptr(), "html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *Response => {
                        args[i] = (iter.nextEat() orelse {
                            JSC.throwInvalidArguments("Missing Response object", .{}, ctx, exception);
                            return null;
                        }).as(Response) orelse {
                            JSC.throwInvalidArguments("Expected Response object", .{}, ctx, exception);
                            return null;
                        };
                    },
                    *Request => {
                        args[i] = (iter.nextEat() orelse {
                            JSC.throwInvalidArguments("Missing Request object", .{}, ctx, exception);
                            return null;
                        }).as(Request) orelse {
                            JSC.throwInvalidArguments("Expected Request object", .{}, ctx, exception);
                            return null;
                        };
                    },
                    js.JSObjectRef => {
                        args[i] = thisObject;
                        if (!JSValue.fromRef(thisObject).isCell() or !JSValue.fromRef(thisObject).isObject()) {
                            JSC.throwInvalidArguments("Expected object", .{}, ctx, exception);
                            return null;
                        }
                    },
                    js.ExceptionRef => {
                        args[i] = exception;
                    },
                    JSValue => {
                        const val = iter.nextEat() orelse {
                            JSC.throwInvalidArguments("Missing argument", .{}, ctx, exception);
                            return null;
                        };
                        args[i] = val;
                    },
                    else => @compileError("Unexpected Type " ++ @typeName(ArgType)),
                }
            }

            var result: JSValue = @call(.{}, @field(Container, name), args);
            if (result.isError()) {
                exception.* = result.asObjectRef();
                return null;
            }

            JavaScript.VirtualMachine.vm.tick();

            if (maybe_async) {
                var promise = JSC.JSInternalPromise.resolvedPromise(ctx.ptr(), result);

                switch (promise.status(ctx.ptr().vm())) {
                    JSC.JSPromise.Status.Pending => {
                        while (promise.status(ctx.ptr().vm()) == .Pending) {
                            JavaScript.VirtualMachine.vm.tick();
                        }
                        result = promise.result(ctx.ptr().vm());
                    },
                    JSC.JSPromise.Status.Rejected => {
                        result = promise.result(ctx.ptr().vm());
                        exception.* = result.asObjectRef();
                    },
                    JSC.JSPromise.Status.Fulfilled => {
                        result = promise.result(ctx.ptr().vm());
                    },
                }
            }

            return result.asObjectRef();
        }
    }.callback;
}
