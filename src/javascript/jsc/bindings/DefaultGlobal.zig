usingnamespace @import("./imports.zig");

const std = @import("std");
const main = @import("root");
const is_bindgen = std.meta.trait.hasDecls(main, .{"bindgen"});

fn Shimmer(comptime name: []const u8, comptime Parent: type) type {
    return struct {
        pub inline fn cppFn(comptime typeName: []const u8, args: anytype) (@typeInfo(@TypeOf(@field(Parent.C, typeName))).Fn.return_type orelse void) {
            if (comptime is_bindgen) {
                return .{};
            } else {
                const func = @field(Parent, typeName);
                const Func = @TypeOf(func);
                // const Func: std.builtin.TypeInfo = brk: {
                //     var FuncType: std.builtin.TypeInfo = @typeInfo(@TypeOf(func));
                //     var decl = std.meta.declarationInfo(Parent, name);
                //     var argument_field_list: [function_info.args.len]std.builtin.TypeInfo.StructField = undefined;
                //     inline for (function_info.args) |arg, i| {
                //         const T = arg.arg_type.?;
                //         @setEvalBranchQuota(10_000);
                //         var num_buf: [128]u8 = undefined;
                //         argument_field_list[i] = std.builtin.TypeInfo.StructField{
                //             .name = std.fmt.bufPrint(&num_buf, "{d}", .{i}) catch unreachable,
                //             .field_type = T,
                //             .default_value = @as(?T, null),
                //             .is_comptime = false,
                //             .alignment = if (@sizeOf(T) > 0) @alignOf(T) else 0,
                //         };
                //     }

                //     std.builtin.TypeInfo{
                //         .Struct = std.builtin.TypeInfo.Struct{
                //             .is_tuple = true,
                //             .layout = .Auto,
                //             .decls = &[_]std.builtin.TypeInfo.Declaration{},
                //             .fields = &argument_field_list,
                //         },
                //     });
                // };
    
                const identifier = comptime std.fmt.comptimePrint("{s}__{s}", .{ name, typeName });
                const Outgoing = comptime @extern(Func, std.builtin.ExternOptions{ .name = identifier });
                const Decl: std.builtin.TypeInfo.Fn = @typeInfo(Func).Fn;
                if (comptime Decl.return_type) |ReturnType| {
                    if (comptime @typeInfo(ReturnType) == .Pointer) {
                        const Ptr: std.builtin.TypeInfo.Pointer = comptime @typeInfo(ReturnType).Pointer;
                        const ChildType: type = brk: {
                            if (@typeInfo(ChildType) == .Struct) {
                                const Struct: std.builtin.TypeInfo.Struct = ChildType.Struct;
                                for (Struct.fields) |field| {
                                    if (std.mem.eql(u8, field.name, "ref")) {
                                        break :brk field.field_type;
                                    }
                                }
                            }
                            break :brk Ptr.child;
                        };

                        if (comptime Ptr.is_const) {
                            const return_type = @call(.{}, comptime Outgoing, args);
                            return @ptrCast(*const ChildType, @alignCast(alignment, return_type));
                        } else {
                            var return_type = @call(.{}, comptime Outgoing, args);
                            return @ptrCast(*ChildType, @alignCast(alignment, return_type));
                        }
                    }

                    return @as(ReturnType, @call(.{}, comptime Outgoing, args));
                } else {
                    @call(.{}, comptime Outgoing, args);
                }
            }
        }
    };
}

pub const JSCell = packed struct {
    ref: Type,
    pub const shim = Shimmer("JSCell", @This());
    const cppFn = shim.cppFn;
    pub const include = "\"GenericBindings.h\"";
    pub const name = "JSC::JSCell";

    pub const Type = *c_void;

    pub fn getObject(this: *const JSCell) ?JSObject {
        return shim.cppFn("getObject", .{this.ref});
    }

    pub fn getString(this: *const JSCell, globalObject: *DefaultGlobal) ?String {
        return shim.cppFn("getString", .{ this.ref, globalObject.ref });
    }

    pub fn getType(this: *const JSCell) u8 {
        return @intCast(CellType, shim.cppFn("getType", .{
            this.ref,
        }));
    }
};

pub const JSString = packed struct {
    ref: Type,
    pub const shim = Shimmer("JSString", @This());
    const cppFn = shim.cppFn;
    pub const include = "\"GenericBindings.h\"";
    pub const name = "JSC::JSString";

    pub const Type = *c_void;

    pub fn getObject(this: *const JSCell) ?JSObject {
        
        return shim.cppFn("getObject", .{this.ref});
    }

    pub fn getString(this: *const JSCell, globalObject: *DefaultGlobal) ?String {
        return shim.cppFn("getString", .{ this.ref, globalObject.ref });
    }


};

pub const DefaultGlobal = struct {
    pub const shim = Shimmer("DefaultGlobal", @This());

    ref: Type,
    pub const Type = *c_void;

    pub const include = "\"DefaultGlobal.h\"";
    pub const name = "Wundle::DefaultGlobal";

    const cppFn = shim.cppFn;

    pub fn objectPrototype(instance: *DefaultGlobal) ObjectPrototype {
        return cppFn("objectPrototype", .{instance.ref});
    }
    pub fn functionPrototype(instance: *DefaultGlobal) FunctionPrototype {
        return cppFn("functionPrototype", .{instance.ref});
    }
    pub fn arrayPrototype(instance: *DefaultGlobal) ArrayPrototype {
        return cppFn("arrayPrototype", .{instance.ref});
    }
    pub fn booleanPrototype(instance: *DefaultGlobal) JSObject {
        return cppFn("booleanPrototype", .{instance.ref});
    }
    pub fn stringPrototype(instance: *DefaultGlobal) StringPrototype {
        return cppFn("stringPrototype", .{instance.ref});
    }
    pub fn numberPrototype(instance: *DefaultGlobal) JSObject {
        return cppFn("numberPrototype", .{instance.ref});
    }
    pub fn bigIntPrototype(instance: *DefaultGlobal) BigIntPrototype {
        return cppFn("bigIntPrototype", .{instance.ref});
    }
    pub fn datePrototype(instance: *DefaultGlobal) JSObject {
        return cppFn("datePrototype", .{instance.ref});
    }
    pub fn symbolPrototype(instance: *DefaultGlobal) JSObject {
        return cppFn("symbolPrototype", .{instance.ref});
    }
    pub fn regExpPrototype(instance: *DefaultGlobal) RegExpPrototype {
        return cppFn("regExpPrototype", .{instance.ref});
    }
    pub fn errorPrototype(instance: *DefaultGlobal) JSObject {
        return cppFn("errorPrototype", .{instance.ref});
    }
    pub fn iteratorPrototype(instance: *DefaultGlobal) IteratorPrototype {
        return cppFn("iteratorPrototype", .{instance.ref});
    }
    pub fn asyncIteratorPrototype(instance: *DefaultGlobal) AsyncIteratorPrototype {
        return cppFn("asyncIteratorPrototype", .{instance.ref});
    }
    pub fn generatorFunctionPrototype(instance: *DefaultGlobal) GeneratorFunctionPrototype {
        return cppFn("generatorFunctionPrototype", .{instance.ref});
    }
    pub fn generatorPrototype(instance: *DefaultGlobal) GeneratorPrototype {
        return cppFn("generatorPrototype", .{instance.ref});
    }
    pub fn asyncFunctionPrototype(instance: *DefaultGlobal) AsyncFunctionPrototype {
        return cppFn("asyncFunctionPrototype", .{instance.ref});
    }
    pub fn arrayIteratorPrototype(instance: *DefaultGlobal) ArrayIteratorPrototype {
        return cppFn("arrayIteratorPrototype", .{instance.ref});
    }
    pub fn mapIteratorPrototype(instance: *DefaultGlobal) MapIteratorPrototype {
        return cppFn("mapIteratorPrototype", .{instance.ref});
    }
    pub fn setIteratorPrototype(instance: *DefaultGlobal) SetIteratorPrototype {
        return cppFn("setIteratorPrototype", .{instance.ref});
    }
    pub fn mapPrototype(instance: *DefaultGlobal) JSObject {
        return cppFn("mapPrototype", .{instance.ref});
    }
    pub fn jsSetPrototype(instance: *DefaultGlobal) JSObject {
        return cppFn("jsSetPrototype", .{instance.ref});
    }
    pub fn promisePrototype(instance: *DefaultGlobal) JSPromisePrototype {
        return cppFn("promisePrototype", .{instance.ref});
    }
    pub fn asyncGeneratorPrototype(instance: *DefaultGlobal) AsyncGeneratorPrototype {
        return cppFn("asyncGeneratorPrototype", .{instance.ref});
    }
    pub fn asyncGeneratorFunctionPrototype(instance: *DefaultGlobal) AsyncGeneratorFunctionPrototype {
        return cppFn("asyncGeneratorFunctionPrototype", .{instance.ref});
    }
};

fn _JSCellStub(comptime str: []const u8) type {
    if (is_bindgen) {
        return struct {
            pub const C = struct {
                pub const name = "JSC::" ++ str ++ "*";
                ref: ?*c_void = null,
            };
        };
    } else {
        return struct {
            pub const C = *c_void;
        };
    }
}

fn _Wundle(comptime str: []const u8) type {
    if (is_bindgen) {
        return struct {
            pub const C = struct {
                pub const name = "Wundle::" ++ str ++ "*";
                ref: ?*c_void = null,
            };
        };
    } else {
        return struct {
            pub const C = *c_void;
        };
    }
}

fn _WTF(comptime str: []const u8) type {
    if (is_bindgen) {
        return struct {
            pub const C = struct {
                pub const name = "WTF::" ++ str ++ "*";
                ref: ?*c_void = null,
            };
        };
    } else {
        return struct {
            pub const C = *c_void;
        };
    }
}

const _DefaultGlobal = _Wundle("DefaultGlobal");
const ObjectPrototype = _JSCellStub("ObjectPrototype");
const FunctionPrototype = _JSCellStub("FunctionPrototype");
const ArrayPrototype = _JSCellStub("ArrayPrototype");
const JSObject = _JSCellStub("JSObject");
const StringPrototype = _JSCellStub("StringPrototype");
const BigIntPrototype = _JSCellStub("BigIntPrototype");
const RegExpPrototype = _JSCellStub("RegExpPrototype");
const IteratorPrototype = _JSCellStub("IteratorPrototype");
const AsyncIteratorPrototype = _JSCellStub("AsyncIteratorPrototype");
const GeneratorFunctionPrototype = _JSCellStub("GeneratorFunctionPrototype");
const GeneratorPrototype = _JSCellStub("GeneratorPrototype");
const AsyncFunctionPrototype = _JSCellStub("AsyncFunctionPrototype");
const ArrayIteratorPrototype = _JSCellStub("ArrayIteratorPrototype");
const MapIteratorPrototype = _JSCellStub("MapIteratorPrototype");
const SetIteratorPrototype = _JSCellStub("SetIteratorPrototype");
const JSPromisePrototype = _JSCellStub("JSPromisePrototype");
const AsyncGeneratorPrototype = _JSCellStub("AsyncGeneratorPrototype");
const AsyncGeneratorFunctionPrototype = _JSCellStub("AsyncGeneratorFunctionPrototype");
const String = _WTF("String");
