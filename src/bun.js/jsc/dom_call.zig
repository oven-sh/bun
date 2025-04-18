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
        JSC.JSString => "JSC::SpecString",
        JSC.JSUint8Array => "JSC::SpecUint8Array",
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
        JSC.JSString => "JSC::JSString*",
        JSC.JSUint8Array => "JSC::JSUint8Array*",
        else => @compileError("Unknown DOM type: " ++ @typeName(Type)),
    };
}

fn DOMCallResultType(comptime Type: type) []const u8 {
    const ChildType = if (@typeInfo(Type) == .pointer) std.meta.Child(Type) else Type;
    return switch (ChildType) {
        i32 => "JSC::SpecInt32Only",
        bool => "JSC::SpecBoolean",
        JSC.JSString => "JSC::SpecString",
        JSC.JSUint8Array => "JSC::SpecUint8Array",
        JSC.JSCell => "JSC::SpecCell",
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
            globalObject: *JSC.JSGlobalObject,
            thisValue: JSC.JSValue,
            arguments_ptr: [*]const JSC.JSValue,
            arguments_len: usize,
        ) callconv(JSC.conv) JSC.JSValue {
            return JSC.toJSHostValue(globalObject, @field(Container, functionName)(globalObject, thisValue, arguments_ptr[0..arguments_len]));
        }

        pub const fastpath = @field(Container, functionName ++ "WithoutTypeChecks");
        pub const Fastpath = @TypeOf(fastpath);
        pub const Arguments = std.meta.ArgsTuple(Fastpath);
        const PutFnType = *const fn (globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) callconv(.c) void;
        const put_fn = @extern(PutFnType, .{ .name = className ++ "__" ++ functionName ++ "__put" });

        pub fn put(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
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
    return fn (instance: *Container, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue;
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
        const eater = if (auto_protect) JSC.Node.ArgumentsSlice.protectEatNext else JSC.Node.ArgumentsSlice.nextEat;

        pub fn method(
            this: *Container,
            globalThis: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(FunctionTypeInfo.params.len);
            var iter = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments.slice());
            var args: Args = undefined;

            const has_exception_ref: bool = comptime brk: {
                for (FunctionTypeInfo.params) |param| {
                    if (param.type.? == JSC.C.ExceptionRef) {
                        break :brk true;
                    }
                }

                break :brk false;
            };
            var exception_value = [_]JSC.C.JSValueRef{null};
            const exception: JSC.C.ExceptionRef = if (comptime has_exception_ref) &exception_value else undefined;

            inline for (FunctionTypeInfo.params, 0..) |param, i| {
                const ArgType = param.type.?;
                switch (ArgType) {
                    *Container => {
                        args[i] = this;
                    },
                    *JSC.JSGlobalObject => {
                        args[i] = globalThis;
                    },
                    *JSC.CallFrame => {
                        args[i] = callframe;
                    },
                    JSC.Node.StringOrBuffer => {
                        const arg = iter.nextEat() orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected string or buffer", .{});
                        };
                        args[i] = try JSC.Node.StringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected string or buffer", .{});
                        };
                    },
                    ?JSC.Node.StringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            if (!arg.isEmptyOrUndefinedOrNull()) {
                                args[i] = try JSC.Node.StringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse {
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
                    JSC.ArrayBuffer => {
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
                    ?JSC.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis) orelse {
                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected TypedArray", .{});
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    JSC.ZigString => {
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
                    ?JSC.Cloudflare.ContentOptions => {
                        if (iter.nextEat()) |content_arg| {
                            if (try content_arg.get(globalThis, "html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *JSC.WebCore.Response => {
                        args[i] = (eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing Response object", .{});
                        }).as(JSC.WebCore.Response) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected Response object", .{});
                        };
                    },
                    *JSC.WebCore.Request => {
                        args[i] = (eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing Request object", .{});
                        }).as(JSC.WebCore.Request) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected Request object", .{});
                        };
                    },
                    JSC.JSValue => {
                        const val = eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing argument", .{});
                        };
                        args[i] = val;
                    },
                    ?JSC.JSValue => {
                        args[i] = eater(&iter);
                    },
                    JSC.C.ExceptionRef => {
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

            return @call(.always_inline, @field(Container, name), args);
        }
    }.method;
}

pub fn wrapStaticMethod(
    comptime Container: type,
    comptime name: string,
    comptime auto_protect: bool,
) JSC.JSHostZigFunction {
    return struct {
        const FunctionType = @TypeOf(@field(Container, name));
        const FunctionTypeInfo: std.builtin.Type.Fn = @typeInfo(FunctionType).@"fn";
        const Args = std.meta.ArgsTuple(FunctionType);
        const eater = if (auto_protect) JSC.Node.ArgumentsSlice.protectEatNext else JSC.Node.ArgumentsSlice.nextEat;

        pub fn method(
            globalThis: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(FunctionTypeInfo.params.len);
            var iter = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments.slice());
            var args: Args = undefined;

            inline for (FunctionTypeInfo.params, 0..) |param, i| {
                const ArgType = param.type.?;
                switch (param.type.?) {
                    *JSC.JSGlobalObject => {
                        args[i] = globalThis;
                    },
                    JSC.Node.StringOrBuffer => {
                        const arg = iter.nextEat() orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected string or buffer", .{});
                        };
                        args[i] = try JSC.Node.StringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected string or buffer", .{});
                        };
                    },
                    ?JSC.Node.StringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = try JSC.Node.StringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse brk: {
                                if (arg == .undefined) {
                                    break :brk null;
                                }

                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected string or buffer", .{});
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    JSC.Node.BlobOrStringOrBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = try JSC.Node.BlobOrStringOrBuffer.fromJS(globalThis, iter.arena.allocator(), arg) orelse {
                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
                            };
                        } else {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
                        }
                    },
                    JSC.ArrayBuffer => {
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
                    ?JSC.ArrayBuffer => {
                        if (iter.nextEat()) |arg| {
                            args[i] = arg.asArrayBuffer(globalThis) orelse {
                                iter.deinit();
                                return globalThis.throwInvalidArguments("expected TypedArray", .{});
                            };
                        } else {
                            args[i] = null;
                        }
                    },
                    JSC.ZigString => {
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
                    ?JSC.Cloudflare.ContentOptions => {
                        if (iter.nextEat()) |content_arg| {
                            if (try content_arg.get(globalThis, "html")) |html_val| {
                                args[i] = .{ .html = html_val.toBoolean() };
                            }
                        } else {
                            args[i] = null;
                        }
                    },
                    *JSC.WebCore.Response => {
                        args[i] = (eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing Response object", .{});
                        }).as(JSC.WebCore.Response) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected Response object", .{});
                        };
                    },
                    *JSC.WebCore.Request => {
                        args[i] = (eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing Request object", .{});
                        }).as(JSC.WebCore.Request) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Expected Request object", .{});
                        };
                    },
                    JSC.WebCore.JSValue => {
                        const val = eater(&iter) orelse {
                            iter.deinit();
                            return globalThis.throwInvalidArguments("Missing argument", .{});
                        };
                        args[i] = val;
                    },
                    ?JSC.WebCore.JSValue => {
                        args[i] = eater(&iter);
                    },
                    else => @compileError(std.fmt.comptimePrint("Unexpected Type " ++ @typeName(ArgType) ++ " at argument {d} in {s}#{s}", .{ i, @typeName(Container), name })),
                }
            }

            defer iter.deinit();

            return @call(.always_inline, @field(Container, name), args);
        }
    }.method;
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
const string = []const u8;
