const std = @import("std");
const StaticExport = @import("./static_export.zig");
const Sizes = @import("./sizes.zig");
pub const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const headers = @import("./headers.zig");

fn isNullableType(comptime Type: type) bool {
    return @typeInfo(Type) == .Optional;
}

pub fn Shimmer(comptime _namespace: []const u8, comptime _name: []const u8, comptime Parent: type) type {
    const extern_count: usize = if (@hasDecl(Parent, "Extern")) Parent.Extern.len else 0;

    return struct {
        pub const namespace = _namespace;
        pub const name = _name;

        // fn toCppType(comptime FromType: type) type {
        //     var NewReturnType = FromType;

        //     if (NewReturnType == c_void) {
        //         return FromType;
        //     }

        //     var ReturnTypeInfo: std.builtin.TypeInfo = @typeInfo(FromType);

        //     if (ReturnTypeInfo == .Pointer and NewReturnType != *c_void) {
        //         NewReturnType = ReturnTypeInfo.Pointer.child;
        //         ReturnTypeInfo = @typeInfo(NewReturnType);
        //     }

        //     switch (ReturnTypeInfo) {
        //         .Union,
        //         .Struct,
        //         .Enum,
        //         => {
        //             if (@hasDecl(ReturnTypeInfo., "Type")) {
        //                 return NewReturnType;
        //             }
        //         },
        //         else => {},
        //     }

        //     return FromType;
        // }
        pub const align_of_symbol = std.fmt.comptimePrint("{s}__{s}_object_align_", .{ namespace, name });
        pub const size_of_symbol = std.fmt.comptimePrint("{s}__{s}_object_size_", .{ namespace, name });
        const align_symbol = std.fmt.comptimePrint("{s}__{s}_align", .{ namespace, name });

        pub const byte_size = brk: {
            const identifier = std.fmt.comptimePrint("{s}__{s}", .{ namespace, name });
            if (@hasDecl(Sizes, identifier)) {
                break :brk @field(Sizes, identifier);
            } else {
                break :brk 0;
            }
        };

        pub const align_size = brk: {
            const identifier = std.fmt.comptimePrint("{s}__{s}_align", .{ namespace, name });
            if (@hasDecl(Sizes, identifier)) {
                break :brk @field(Sizes, identifier);
            } else {
                break :brk 0;
            }
        };
        pub const Bytes = if (byte_size > 16) [byte_size]u8 else std.meta.Int(.unsigned, byte_size * 8);

        pub const Return = struct {
            pub const Type = Parent;
            pub const is_return = true;
        };

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

        pub inline fn matchNullable(comptime ExpectedReturnType: type, comptime ExternReturnType: type, value: ExternReturnType) ExpectedReturnType {
            if (comptime isNullableType(ExpectedReturnType) != isNullableType(ExternReturnType)) {
                return value.?;
            } else if (comptime (@typeInfo(ExpectedReturnType) == .Enum) and (@typeInfo(ExternReturnType) != .Enum)) {
                return @intToEnum(ExpectedReturnType, value);
            } else {
                return value;
            }
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
                const Fn = comptime @field(headers, symbolName(typeName));
                return matchNullable(
                    comptime std.meta.declarationInfo(Parent, typeName).data.Fn.return_type,
                    comptime @typeInfo(@TypeOf(Fn)).Fn.return_type.?,
                    @call(.{}, Fn, args),
                );
            }
        }
    };
}
