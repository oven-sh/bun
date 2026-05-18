/// A host function is the native function pointer type that can be used by a
/// JSC::JSFunction to call native code from JavaScript.
pub const JSHostFn = fn (*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
/// To allow usage of `try` for error handling, Bun provides `toJSHostFn` to
/// wrap this type into a JSHostFn.
pub const JSHostFnZig = fn (*JSGlobalObject, *CallFrame) bun.JSError!JSValue;

pub fn JSHostFnZigWithContext(comptime ContextType: type) type {
    return fn (*ContextType, *JSGlobalObject, *CallFrame) bun.JSError!JSValue;
}

pub fn JSHostFunctionTypeWithContext(comptime ContextType: type) type {
    return fn (*ContextType, *JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
}

pub fn toJSHostFn(comptime functionToWrap: JSHostFnZig) JSHostFn {
    return struct {
        pub fn function(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(jsc.conv) JSValue {
            return toJSHostFnResult(globalThis, functionToWrap(globalThis, callframe));
        }
    }.function;
}

pub fn toJSHostFnWithContext(comptime ContextType: type, comptime Function: JSHostFnZigWithContext(ContextType)) JSHostFunctionTypeWithContext(ContextType) {
    return struct {
        pub fn function(ctx: *ContextType, globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(jsc.conv) JSValue {
            return toJSHostFnResult(globalThis, Function(ctx, globalThis, callframe));
        }
    }.function;
}
pub fn toJSHostFnResult(globalThis: *JSGlobalObject, result: bun.JSError!JSValue) JSValue {
    if (Environment.allow_assert and Environment.is_canary) {
        const value = result catch |err| switch (err) {
            error.JSError => .zero,
            error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
            error.JSTerminated => .zero,
        };
        debugExceptionAssertion(globalThis, value, "_unknown_".*);
        return value;
    }
    return result catch |err| switch (err) {
        error.JSError => .zero,
        error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
        error.JSTerminated => .zero,
    };
}

fn debugExceptionAssertion(globalThis: *JSGlobalObject, value: JSValue, comptime func: anytype) void {
    if (comptime Environment.isDebug) {
        if (value != .zero) {
            if (globalThis.hasException()) {
                var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
                defer formatter.deinit();
                bun.Output.err("Assertion failed",
                    \\Native function returned a non-zero JSValue while an exception is pending
                    \\
                    \\    fn: {s}
                    \\ value: {f}
                    \\
                , .{
                    &func, // use `(lldb) image lookup --address 0x1ec4` to discover what function failed
                    value.toFmt(&formatter),
                });
                bun.Output.flush();
            }
        }
    }
    bun.assert((value == .zero) == globalThis.hasException());
}

pub fn toJSHostSetterValue(globalThis: *JSGlobalObject, value: error{ OutOfMemory, JSError, JSTerminated }!void) bool {
    value catch |err| switch (err) {
        error.JSError => return false,
        error.OutOfMemory => {
            _ = globalThis.throwOutOfMemoryValue();
            return false;
        },
        error.JSTerminated => return false,
    };
    return true;
}

/// Convert the return value of a function returning an error union into a maybe-empty JSValue
pub fn toJSHostCall(
    globalThis: *JSGlobalObject,
    src: std.builtin.SourceLocation,
    comptime function: anytype,
    // This can't use std.meta.ArgsTuple because that will turn comptime function parameters into
    // runtime tuple values
    args: anytype,
) JSValue {
    var scope: jsc.ExceptionValidationScope = undefined;
    scope.init(globalThis, src);
    defer scope.deinit();

    const returned: error{ OutOfMemory, JSError, JSTerminated }!JSValue = @call(.auto, function, args);
    const normal = returned catch |err| switch (err) {
        error.JSError => .zero,
        error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
        error.JSTerminated => .zero,
    };
    scope.assertExceptionPresenceMatches(normal == .zero);
    return normal;
}

/// Convert the return value of a function returning a maybe-empty JSValue into an error union.
/// The wrapped function must return an empty JSValue if and only if it has thrown an exception.
/// If your function does not follow this pattern (if it can return empty without an exception, or
/// throw an exception and return non-empty), either fix the function or write a custom wrapper with
/// TopExceptionScope.
pub fn fromJSHostCall(
    globalThis: *JSGlobalObject,
    /// For attributing thrown exceptions
    src: std.builtin.SourceLocation,
    comptime function: anytype,
    args: std.meta.ArgsTuple(@TypeOf(function)),
) error{JSError}!JSValue {
    var scope: jsc.ExceptionValidationScope = undefined;
    scope.init(globalThis, src);
    defer scope.deinit();

    const value = @call(.auto, function, args);
    if (@TypeOf(value) != JSValue) @compileError("fromJSHostCall only supports JSValue");
    scope.assertExceptionPresenceMatches(value == .zero);
    return if (value == .zero) error.JSError else value;
}

pub fn fromJSHostCallGeneric(
    globalThis: *JSGlobalObject,
    /// For attributing thrown exceptions
    src: std.builtin.SourceLocation,
    comptime function: anytype,
    args: std.meta.ArgsTuple(@TypeOf(function)),
) error{JSError}!@typeInfo(@TypeOf(function)).@"fn".return_type.? {
    var scope: jsc.TopExceptionScope = undefined;
    scope.init(globalThis, src);
    defer scope.deinit();

    const result = @call(.auto, function, args);
    // supporting JSValue would make it too easy to mix up this function with fromJSHostCall
    // fromJSHostCall has the benefit of checking that the function is correctly returning an empty
    // value if and only if it has thrown.
    // fromJSHostCallGeneric is only for functions where the return value tells you nothing about
    // whether an exception was thrown.
    //
    // alternatively, we could consider something like `comptime exception_sentinel: ?T`
    // to generically support using a value of any type to signal exceptions (INT_MAX, infinity,
    // nullptr...?) but it's unclear how often that would be useful
    if (@TypeOf(result) == JSValue) @compileError("fromJSHostCallGeneric does not support JSValue");
    try scope.returnIfException();
    return result;
}

const ParsedHostFunctionErrorSet = struct {
    OutOfMemory: bool = false,
    JSError: bool = false,
};

inline fn parseErrorSet(T: type, errors: []const std.builtin.Type.Error) ParsedHostFunctionErrorSet {
    return comptime brk: {
        var errs: ParsedHostFunctionErrorSet = .{};
        for (errors) |err| {
            if (!@hasField(ParsedHostFunctionErrorSet, err.name)) {
                @compileError("Return value from host function '" ++ @typeInfo(T) ++ "' can not contain error '" ++ err.name ++ "'");
            }
            @field(errs, err.name) = true;
        }
        break :brk errs;
    };
}

// For when bubbling up errors to functions that require a C ABI boundary
// TODO: make this not need a 'globalThis'
pub fn voidFromJSError(err: bun.JSError, globalThis: *jsc.JSGlobalObject) void {
    switch (err) {
        error.JSError => {},
        error.OutOfMemory => globalThis.throwOutOfMemory() catch {},
        error.JSTerminated => {},
    }
    // TODO: catch exception, declare throw scope, re-throw
    // c++ needs to be able to see that zig functions can throw for BUN_JSC_validateExceptionChecks
}

pub fn wrap1(comptime func: anytype) @"return": {
    const p = checkWrapParams(func, 1);
    break :@"return" fn (p[0].type.?) callconv(.c) JSValue;
} {
    const p = @typeInfo(@TypeOf(func)).@"fn".params;
    return struct {
        pub fn wrapped(arg0: p[0].type.?) callconv(.c) JSValue {
            return toJSHostCall(arg0, @src(), func, .{arg0});
        }
    }.wrapped;
}

pub fn wrap2(comptime func: anytype) @"return": {
    const p = checkWrapParams(func, 2);
    break :@"return" fn (p[0].type.?, p[1].type.?) callconv(.c) JSValue;
} {
    const p = @typeInfo(@TypeOf(func)).@"fn".params;
    return struct {
        pub fn wrapped(arg0: p[0].type.?, arg1: p[1].type.?) callconv(.c) JSValue {
            return toJSHostCall(arg0, @src(), func, .{ arg0, arg1 });
        }
    }.wrapped;
}

pub fn wrap3(comptime func: anytype) @"return": {
    const p = checkWrapParams(func, 3);
    break :@"return" fn (p[0].type.?, p[1].type.?, p[2].type.?) callconv(.c) JSValue;
} {
    const p = @typeInfo(@TypeOf(func)).@"fn".params;
    return struct {
        pub fn wrapped(arg0: p[0].type.?, arg1: p[1].type.?, arg2: p[2].type.?) callconv(.c) JSValue {
            return toJSHostCall(arg0, @src(), func, .{ arg0, arg1, arg2 });
        }
    }.wrapped;
}

pub fn wrap4(comptime func: anytype) @"return": {
    const p = checkWrapParams(func, 4);
    break :@"return" fn (p[0].type.?, p[1].type.?, p[2].type.?, p[3].type.?) callconv(.c) JSValue;
} {
    const p = @typeInfo(@TypeOf(func)).@"fn".params;
    return struct {
        pub fn wrapped(arg0: p[0].type.?, arg1: p[1].type.?, arg2: p[2].type.?, arg3: p[3].type.?) callconv(.c) JSValue {
            return toJSHostCall(arg0, @src(), func, .{ arg0, arg1, arg2, arg3 });
        }
    }.wrapped;
}

pub fn wrap5(comptime func: anytype) @"return": {
    const p = checkWrapParams(func, 5);
    break :@"return" fn (p[0].type.?, p[1].type.?, p[2].type.?, p[3].type.?, p[4].type.?) callconv(.c) JSValue;
} {
    const p = @typeInfo(@TypeOf(func)).@"fn".params;
    return struct {
        pub fn wrapped(arg0: p[0].type.?, arg1: p[1].type.?, arg2: p[2].type.?, arg3: p[3].type.?, arg4: p[4].type.?) callconv(.c) JSValue {
            return toJSHostCall(arg0, @src(), func, .{ arg0, arg1, arg2, arg3, arg4 });
        }
    }.wrapped;
}

fn checkWrapParams(comptime func: anytype, comptime N: u8) []const std.builtin.Type.Fn.Param {
    const params = @typeInfo(@TypeOf(func)).@"fn".params;
    if (params.len != N) {
        @compileError(std.fmt.comptimePrint("arg length mismatch: {d} != {d}", .{ N, params.len }));
    } else if (params[0].type.? != *JSGlobalObject) {
        @compileError("first arg must be *JSGlobalObject");
    }
    return params;
}

/// Uses .SysV callconv on Windows. Use to satisfy SYSV_ABI requirement in JSC APIs.
/// Otherwise (when the C++ counterpart has no explicit calling convention) use wrap4.
pub fn wrap4v(comptime func: anytype) @"return": {
    const p = checkWrapParams(func, 4);
    break :@"return" fn (p[0].type.?, p[1].type.?, p[2].type.?, p[3].type.?) callconv(jsc.conv) JSValue;
} {
    const p = @typeInfo(@TypeOf(func)).@"fn".params;
    return struct {
        pub fn wrapped(arg0: p[0].type.?, arg1: p[1].type.?, arg2: p[2].type.?, arg3: p[3].type.?) callconv(jsc.conv) JSValue {
            return toJSHostCall(arg0, @src(), func, .{ arg0, arg1, arg2, arg3 });
        }
    }.wrapped;
}

const private = struct {
    pub extern fn Bun__CreateFFIFunctionWithDataValue(
        *JSGlobalObject,
        ?*const ZigString,
        argCount: u32,
        function: *const JSHostFn,
        data: *anyopaque,
    ) JSValue;

    pub extern fn Bun__CreateFFIFunctionValue(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        function: *const JSHostFn,
        add_ptr_field: bool,
        inputFunctionPtr: ?*anyopaque,
    ) JSValue;

    pub extern fn Bun__FFIFunction_getDataPtr(JSValue) ?*anyopaque;
    pub extern fn Bun__FFIFunction_setDataPtr(JSValue, ?*anyopaque) void;
};

pub fn NewRuntimeFunction(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    functionPointer: *const JSHostFn,
    add_ptr_property: bool,
    inputFunctionPtr: ?*anyopaque,
) JSValue {
    jsc.markBinding(@src());
    return private.Bun__CreateFFIFunctionValue(globalObject, symbolName, argCount, functionPointer, add_ptr_property, inputFunctionPtr);
}

pub fn getFunctionData(function: JSValue) ?*anyopaque {
    jsc.markBinding(@src());
    return private.Bun__FFIFunction_getDataPtr(function);
}

pub fn setFunctionData(function: JSValue, value: ?*anyopaque) void {
    jsc.markBinding(@src());
    return private.Bun__FFIFunction_setDataPtr(function, value);
}

pub fn NewFunctionWithData(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime function: JSHostFnZig,
    data: *anyopaque,
) JSValue {
    jsc.markBinding(@src());
    return private.Bun__CreateFFIFunctionWithDataValue(
        globalObject,
        symbolName,
        argCount,
        toJSHostFn(function),
        data,
    );
}

pub const DOMEffect = struct {
    reads: [4]ID = std.mem.zeroes([4]ID),
    writes: [4]ID = std.mem.zeroes([4]ID),

    pub const top = DOMEffect{
        .reads = .{ ID.Heap, ID.Heap, ID.Heap, ID.Heap },
        .writes = .{ ID.Heap, ID.Heap, ID.Heap, ID.Heap },
    };

    pub fn forRead(read: ID) DOMEffect {
        return DOMEffect{
            .reads = .{ read, ID.Heap, ID.Heap, ID.Heap },
            .writes = .{ ID.Heap, ID.Heap, ID.Heap, ID.Heap },
        };
    }

    pub fn forWrite(read: ID) DOMEffect {
        return DOMEffect{
            .writes = .{ read, ID.Heap, ID.Heap, ID.Heap },
            .reads = .{ ID.Heap, ID.Heap, ID.Heap, ID.Heap },
        };
    }

    pub const pure = DOMEffect{};

    pub fn isPure(this: DOMEffect) bool {
        return this.reads[0] == ID.InvalidAbstractHeap and this.writes[0] == ID.InvalidAbstractHeap;
    }

    pub const ID = enum(u8) {
        InvalidAbstractHeap = 0,
        World,
        Stack,
        Heap,
        Butterfly_publicLength,
        Butterfly_vectorLength,
        GetterSetter_getter,
        GetterSetter_setter,
        JSCell_cellState,
        JSCell_indexingType,
        JSCell_structureID,
        JSCell_typeInfoFlags,
        JSObject_butterfly,
        JSPropertyNameEnumerator_cachedPropertyNames,
        RegExpObject_lastIndex,
        NamedProperties,
        IndexedInt32Properties,
        IndexedDoubleProperties,
        IndexedContiguousProperties,
        IndexedArrayStorageProperties,
        DirectArgumentsProperties,
        ScopeProperties,
        TypedArrayProperties,
        /// Used to reflect the fact that some allocations reveal object identity */
        HeapObjectCount,
        RegExpState,
        MathDotRandomState,
        JSDateFields,
        JSMapFields,
        JSSetFields,
        JSWeakMapFields,
        WeakSetFields,
        JSInternalFields,
        InternalState,
        CatchLocals,
        Absolute,
        /// DOMJIT tells the heap range with the pair of integers. */
        DOMState,
        /// Use this for writes only, to indicate that this may fire watchpoints. Usually this is never directly written but instead we test to see if a node clobbers this; it just so happens that you have to write world to clobber it. */
        Watchpoint_fire,
        /// Use these for reads only, just to indicate that if the world got clobbered, then this operation will not work. */
        MiscFields,
        /// Use this for writes only, just to indicate that hoisting the node is invalid. This works because we don't hoist anything that has any side effects at all. */
        SideState,
    };
};

fn DOMCallArgumentType(comptime Type: type) []const u8 {
    const ChildType = if (@typeInfo(Type) == .pointer) std.meta.Child(Type) else Type;
    return switch (ChildType) {
        i8, u8, i16, u16, i32 => "JSC::SpecInt32Only",
        u32, i64, u64 => "JSC::SpecInt52Any",
        f64 => "JSC::SpecDoubleReal",
        bool => "JSC::SpecBoolean",
        jsc.JSString => "JSC::SpecString",
        jsc.JSUint8Array => "JSC::SpecUint8Array",
        else => @compileError("Unknown DOM type: " ++ @typeName(Type)),
    };
}

fn DOMCallArgumentTypeWrapper(comptime Type: type) []const u8 {
    const ChildType = if (@typeInfo(Type) == .pointer) std.meta.Child(Type) else Type;
    return switch (ChildType) {
        i32 => "int32_t",
        f64 => "double",
        u64 => "uint64_t",
        i64 => "int64_t",
        bool => "bool",
        jsc.JSString => "JSC::JSString*",
        jsc.JSUint8Array => "JSC::JSUint8Array*",
        else => @compileError("Unknown DOM type: " ++ @typeName(Type)),
    };
}

fn DOMCallResultType(comptime Type: type) []const u8 {
    const ChildType = if (@typeInfo(Type) == .pointer) std.meta.Child(Type) else Type;
    return switch (ChildType) {
        i32 => "JSC::SpecInt32Only",
        bool => "JSC::SpecBoolean",
        jsc.JSString => "JSC::SpecString",
        jsc.JSUint8Array => "JSC::SpecUint8Array",
        jsc.JSCell => "JSC::SpecCell",
        u52, i52 => "JSC::SpecInt52Any",
        f64 => "JSC::SpecDoubleReal",
        else => "JSC::SpecHeapTop",
    };
}

pub fn DOMCall(
    comptime class_name: string,
    comptime Container: type,
    comptime functionName: string,
    comptime dom_effect: DOMEffect,
) type {
    return extern struct {
        const className = class_name;
        pub const is_dom_call = true;
        const Slowpath = @field(Container, functionName);
        const SlowpathType = @TypeOf(@field(Container, functionName));

        // Zig doesn't support @frameAddress(1)
        // so we have to add a small wrapper fujnction
        pub fn slowpath(
            globalObject: *jsc.JSGlobalObject,
            thisValue: jsc.JSValue,
            arguments_ptr: [*]const jsc.JSValue,
            arguments_len: usize,
        ) callconv(jsc.conv) jsc.JSValue {
            return jsc.toJSHostCall(globalObject, @src(), @field(Container, functionName), .{ globalObject, thisValue, arguments_ptr[0..arguments_len] });
        }

        pub const fastpath = @field(Container, functionName ++ "WithoutTypeChecks");
        pub const Fastpath = @TypeOf(fastpath);
        pub const Arguments = std.meta.ArgsTuple(Fastpath);
        const PutFnType = *const fn (globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) callconv(.c) void;
        const put_fn = @extern(PutFnType, .{ .name = className ++ "__" ++ functionName ++ "__put" });

        pub fn put(globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
            put_fn(globalObject, value);
        }

        pub const effect = dom_effect;

        comptime {
            @export(&slowpath, .{ .name = className ++ "__" ++ functionName ++ "__slowpath" });
            @export(&fastpath, .{ .name = className ++ "__" ++ functionName ++ "__fastpath" });
        }
    };
}

pub fn InstanceMethodType(comptime Container: type) type {
    return fn (instance: *Container, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue;
}

pub fn wrapInstanceMethod(
    comptime Container: type,
    comptime name: string,
    comptime auto_protect: bool,
) InstanceMethodType(Container) {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.Type.Fn = @typeInfo(FunctionType).@"fn";
        const Args = std.meta.ArgsTuple(FunctionType);
        const eater = if (auto_protect) jsc.CallFrame.ArgumentsSlice.protectEatNext else jsc.CallFrame.ArgumentsSlice.nextEat;

        pub fn method(
            this: *Container,
            globalThis: *jsc.JSGlobalObject,
            callframe: *jsc.CallFrame,
        ) bun.JSError!jsc.JSValue {
            const arguments = callframe.arguments_old(FunctionTypeInfo.params.len);
            var iter = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments.slice());
            var args: Args = undefined;

            const has_exception_ref: bool = comptime brk: {
                for (FunctionTypeInfo.params) |param| {
                    if (param.type.? == jsc.C.ExceptionRef) {
                        break :brk true;
                    }
                }

                break :brk false;
            };
            var exception_value = [_]jsc.C.JSValueRef{null};
            const exception: jsc.C.ExceptionRef = if (comptime has_exception_ref) &exception_value else undefined;

            inline for (FunctionTypeInfo.params, 0..) |param, i| {
                const ArgType = param.type.?;
                switch (ArgType) {
                    *Container => {
                        args[i] = this;
                    },
                    *jsc.JSGlobalObject => {
                        args[i] = globalThis;
                    },
                    *jsc.CallFrame => {
                        args[i] = callframe;
                    },
                    jsc.Node.StringOrBuffer => {
                        const arg = iter.nextEat() orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected string or buffer", .{});
                        };
                        args[i] = try jsc.Node.StringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected string or buffer", .{});
                        };
                    },
                    ?jsc.Node.StringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            if (!arg.isEmptyOrUndefinedOrNull()) {
                                args[i] = try jsc.Node.StringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse {
                                    iter.deinit();
                                    return globalThis.throwInvalidArguments("expected string or buffer", .{});
                                };
                            } else {
                                args[i] = null;
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    jsc.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis) orelse {
                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected TypedArray", .{});
                            };
                        } else {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected TypedArray", .{});
                        }
                    },
                    ?jsc.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis) orelse {
                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected TypedArray", .{});
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    jsc.ZigString => {
                        var string_value = eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing argument", .{});
                        };

                        if (string_value.isUndefinedOrNull()) {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected string", .{});
                        }

                        args[i] = try string_value.getZigString(globalThis);
                    },
                    ?bun.api.HTMLRewriter.ContentOptions => {
                        if (iter.nextEat()) |content_arg| {
                            if (try content_arg.get(globalThis, "html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *jsc.WebCore.Response => {
                        args[i] = (eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing Response object", .{});
                        }).as(jsc.WebCore.Response) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected Response object", .{});
                        };
                    },
                    *jsc.WebCore.Request => {
                        args[i] = (eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing Request object", .{});
                        }).as(jsc.WebCore.Request) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected Request object", .{});
                        };
                    },
                    jsc.JSValue => {
                        const val = eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing argument", .{});
                        };
                        args[i] = val;
                    },
                    ?jsc.JSValue => {
                        args[i] = eater(&iter);
                    },
                    jsc.C.ExceptionRef => {
                        args[i] = exception;
                    },
                    else => @compileError("Unexpected Type " ++ @typeName(ArgType)),
                }
            }

            defer iter.deinit();

            defer {
                if (comptime has_exception_ref) {
                    if (exception_value[0] != null) {
                        globalThis.throwValue(exception_value[0].?.value());
                    }
                }
            }

            return @call(bun.callmod_inline, @field(Container, name), args);
        }
    }.method;
}

pub fn wrapStaticMethod(
    comptime Container: type,
    comptime name: string,
    comptime auto_protect: bool,
) jsc.JSHostFnZig {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.Type.Fn = @typeInfo(FunctionType).@"fn";
        const Args = std.meta.ArgsTuple(FunctionType);
        const eater = if (auto_protect) jsc.CallFrame.ArgumentsSlice.protectEatNext else jsc.CallFrame.ArgumentsSlice.nextEat;

        pub fn method(
            globalThis: *jsc.JSGlobalObject,
            callframe: *jsc.CallFrame,
        ) bun.JSError!jsc.JSValue {
            const arguments = callframe.arguments_old(FunctionTypeInfo.params.len);
            var iter = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments.slice());
            var args: Args = undefined;

            inline for (FunctionTypeInfo.params, 0..) |param, i| {
                const ArgType = param.type.?;
                switch (param.type.?) {
                    *jsc.JSGlobalObject => {
                        args[i] = globalThis;
                    },
                    jsc.Node.StringOrBuffer => {
                        const arg = iter.nextEat() orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected string or buffer", .{});
                        };
                        args[i] = try jsc.Node.StringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected string or buffer", .{});
                        };
                    },
                    ?jsc.Node.StringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = try jsc.Node.StringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse brk: {
                                if (arg.isUndefined()) {
                                    break :brk null;
                                }

                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected string or buffer", .{});
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    jsc.Node.BlobOrStringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = try jsc.Node.BlobOrStringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse {
                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
                            };
                        } else {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
                        }
                    },
                    jsc.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis) orelse {
                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected TypedArray", .{});
                            };
                        } else {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected TypedArray", .{});
                        }
                    },
                    ?jsc.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis) orelse {
                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected TypedArray", .{});
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    jsc.ZigString => {
                        var string_value = eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing argument", .{});
                        };

                        if (string_value.isUndefinedOrNull()) {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected string", .{});
                        }

                        args[i] = try string_value.getZigString(globalThis);
                    },
                    ?bun.api.HTMLRewriter.ContentOptions => {
                        if (iter.nextEat()) |content_arg| {
                            if (try content_arg.get(globalThis, "html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *jsc.WebCore.Response => {
                        args[i] = (eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing Response object", .{});
                        }).as(jsc.WebCore.Response) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected Response object", .{});
                        };
                    },
                    *jsc.WebCore.Request => {
                        args[i] = (eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing Request object", .{});
                        }).as(jsc.WebCore.Request) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected Request object", .{});
                        };
                    },
                    jsc.JSValue => {
                        const val = eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing argument", .{});
                        };
                        args[i] = val;
                    },
                    ?jsc.JSValue => {
                        args[i] = eater(&iter);
                    },
                    else => @compileError(std.fmt.comptimePrint("Unexpected Type " ++ @typeName(ArgType) ++ " at argument {d} in {s}#{s}", .{ i, @typeName(Container), name })),
                }
            }

            defer iter.deinit();

            return @call(bun.callmod_inline, @field(Container, name), args);
        }
    }.method;
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
