const std = @import("std");
const StaticExport = @import("./static_export.zig");
const Sizes = @import("./sizes.zig");
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;

pub fn Shimmer(comptime _namespace: []const u8, comptime _name: []const u8, comptime Parent: type) type {
    return struct {
        pub const namespace = _namespace;
        pub const name = _name;

        fn toCppType(comptime FromType: ?type) ?type {
            return comptime brk: {
                var NewReturnType = FromType orelse c_void;

                if (NewReturnType == c_void) {
                    break :brk FromType;
                }

                var ReturnTypeInfo: std.builtin.TypeInfo = @typeInfo(FromType orelse c_void);

                if (ReturnTypeInfo == .Pointer and NewReturnType != *c_void) {
                    NewReturnType = ReturnTypeInfo.Pointer.child;
                    ReturnTypeInfo = @typeInfo(NewReturnType);
                }

                switch (ReturnTypeInfo) {
                    .Union,
                    .Struct,
                    .Enum,
                    => {
                        if (@hasDecl(ReturnTypeInfo, "Type")) {
                            break :brk NewReturnType;
                        }
                    },
                    else => {},
                }

                break :brk FromType;
            };
        }
        pub const align_of_symbol = std.fmt.comptimePrint("{s}__{s}_object_align_", .{ namespace, name });
        pub const size_of_symbol = std.fmt.comptimePrint("{s}__{s}_object_size_", .{ namespace, name });
        pub const byte_size = brk: {
            const identifier = std.fmt.comptimePrint("{s}__{s}", .{ namespace, name });
            const align_symbol = std.fmt.comptimePrint("{s}__{s}_align", .{ namespace, name });
            if (@hasDecl(Sizes, identifier)) {
                break :brk @field(Sizes, identifier); //+ @field(Sizes, align_symbol);
            } else {
                break :brk 0;
            }
        };
        pub const Bytes = [byte_size]u8;

        pub inline fn getConvertibleType(comptime ZigType: type) type {
            if (@typeInfo(ZigType) == .Struct) {
                const Struct: std.builtin.TypeInfo.Struct = ChildType.Struct;
                for (Struct.fields) |field| {
                    if (std.mem.eql(u8, field.name, "ref")) {
                        return field.field_type;
                    }
                }
            }

            return ZigType;
        }

        fn pointerChild(comptime Type: type) type {
            if (@typeInfo(Type) == .Pointer) {
                return @typeInfo(Type).Pointer.child_type;
            }

            return Type;
        }

        pub inline fn toZigType(comptime ZigType: type, comptime CppType: type, value: CppType) *ZigType {
            if (comptime hasRef(ZigType)) {
                // *WTF::String => Wtf.String{ = value}, via casting instead of copying
                if (comptime @typeInfo(CppType) == .Pointer and @typeInfo(ZigType) != .Pointer) {
                    return @bitCast(ZigType, @ptrToInt(value));
                }
            }

            return @as(ZigType, value);
        }

        pub fn symbolName(comptime typeName: []const u8) []const u8 {
            return comptime std.fmt.comptimePrint("{s}__{s}__{s}", .{ namespace, name, typeName });
        }

        pub fn exportFunctions(comptime Functions: anytype) [std.meta.fieldNames(@TypeOf(Functions)).len]StaticExport {
            const FunctionsType = @TypeOf(Functions);
            return comptime brk: {
                var functions: [std.meta.fieldNames(FunctionsType).len]StaticExport = undefined;
                for (std.meta.fieldNames(FunctionsType)) |fn_name, i| {
                    const Function = @TypeOf(@field(Functions, fn_name));
                    if (@typeInfo(Function) != .Fn) {
                        @compileError("Expected " ++ @typeName(Parent) ++ "." ++ @typeName(Function) ++ " to be a function but received " ++ @tagName(@typeInfo(Function)));
                    }
                    var Fn: std.builtin.TypeInfo.Fn = @typeInfo(Function).Fn;
                    if (Fn.calling_convention != .C) {
                        @compileError("Expected " ++ @typeName(Parent) ++ "." ++ @typeName(Function) ++ " to have a C Calling Convention.");
                    }

                    const export_name = symbolName(fn_name);
                    functions[i] = StaticExport{
                        .Type = Function,
                        .symbol_name = export_name,
                        .local_name = fn_name,
                        .Parent = Parent,
                    };
                }

                break :brk functions;
            };
        }

        pub inline fn zigFn(comptime typeName: []const u8, args: anytype) (@typeInfo(@TypeOf(@field(Parent, typeName))).Fn.return_type orelse void) {
            const identifier = symbolName(typeName);
            const func = comptime @typeInfo(Parent).Struct.fields[std.meta.fieldIndex(Parent, typeName)].field_type;
            const ReturnType = comptime @typeInfo(func).Fn.return_type orelse c_void;

            const Func: type = comptime brk: {
                var FuncType: std.builtin.TypeInfo = @typeInfo(@TypeOf(func));
                var Fn: std.builtin.TypeInfo.Fn = FuncType.Fn;

                Fn.calling_convention = std.builtin.CallingConvention.C;
                Fn.return_type = toCppType(Fn.return_type);

                const ArgsType = @TypeOf(args);
                for (std.meta.fieldNames(args)) |field, i| {
                    Fn.args[i] = std.builtin.TypeInfo.FnArg{
                        .is_generic = false,
                        .is_noalias = false,
                        .arg_type = @typeInfo(ArgsType).fields[i].field_type,
                    };
                }
                FuncType.Fn = Fn;
                break :brk @Type(FuncType);
            };

            comptime @export(Func, .{ .name = identifier });
            unreachable;
        }

        pub inline fn cppFn(comptime typeName: []const u8, args: anytype) (ret: {
            if (!@hasDecl(Parent, typeName)) {
                @compileError(@typeName(Parent) ++ " is missing cppFn: " ++ typeName);
            }
            break :ret std.meta.declarationInfo(Parent, typeName).data.Fn.return_type;
        }) {
            if (comptime is_bindgen) {
                unreachable;
            } else {
                const identifier = comptime std.fmt.comptimePrint("{s}__{s}__{s}", .{ namespace, name, typeName });
                const func = comptime @typeInfo(Parent).Struct.fields[std.meta.fieldIndex(Parent, typeName)].field_type;
                const ReturnType = comptime @typeInfo(func).Fn.return_type orelse c_void;

                const Func: type = comptime brk: {
                    var FuncType: std.builtin.TypeInfo = @typeInfo(@TypeOf(func));
                    var Fn: std.builtin.TypeInfo.Fn = FuncType.Fn;

                    Fn.calling_convention = std.builtin.CallingConvention.C;
                    Fn.return_type = toCppType(Fn.return_type);

                    const ArgsType = @TypeOf(args);
                    for (std.meta.fieldNames(args)) |field, i| {
                        Fn.args[i] = std.builtin.TypeInfo.FnArg{
                            .is_generic = false,
                            .is_noalias = false,
                            .arg_type = @typeInfo(ArgsType).fields[i].field_type,
                        };
                    }
                    FuncType.Fn = Fn;
                    break :brk @Type(FuncType);
                };
                const Outgoing = comptime @extern(Func, std.builtin.ExternOptions{ .name = identifier });

                return toZigType(
                    ReturnType,
                    @typeInfo(Func).Fn.return_type orelse void,
                    @call(.{}, Outgoing, args),
                );
            }
        }
    };
}
