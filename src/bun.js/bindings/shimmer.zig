const std = @import("std");
const bun = @import("root").bun;
const StaticExport = @import("./static_export.zig");
const Sizes = @import("./sizes.zig");
pub const is_bindgen: bool = false;
const headers = @import("./headers.zig");

fn isNullableType(comptime Type: type) bool {
    return @typeInfo(Type) == .Optional or
        (@typeInfo(Type) == .Pointer and @typeInfo(Type).Pointer.is_allowzero);
}

const log = @import("../../output.zig").scoped(.CPP, true);
pub fn Shimmer(comptime _namespace: []const u8, comptime _name: []const u8, comptime Parent: type) type {
    return struct {
        pub const namespace = _namespace;
        pub const name = _name;

        pub fn assertJSFunction(comptime funcs: anytype) void {
            inline for (funcs) |func| {
                if (@typeInfo(@TypeOf(func)) != .Fn) {
                    @compileError("Expected " ++ @typeName(Parent) ++ "." ++ @typeName(func) ++ " to be a function but received " ++ @tagName(@typeInfo(@TypeOf(func))));
                }
            }
        }

        pub fn ref() void {
            if (comptime @hasDecl(Parent, "Export")) {
                inline for (Parent.Export) |exp| {
                    _ = exp;
                }
            }

            if (comptime @hasDecl(Parent, "Extern")) {
                inline for (Parent.Extern) |exp| {
                    _ = @field(Parent, exp);
                }
            }
        }

        // fn toCppType(comptime FromType: type) type {
        //     var NewReturnType = FromType;

        //     if (NewReturnType == anyopaque) {
        //         return FromType;
        //     }

        //     var ReturnTypeInfo: std.builtin.Type = @typeInfo(FromType);

        //     if (ReturnTypeInfo == .Pointer and NewReturnType != *anyopaque) {
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

        fn pointerChild(comptime Type: type) type {
            if (@typeInfo(Type) == .Pointer) {
                return @typeInfo(Type).Pointer.child_type;
            }

            return Type;
        }

        pub fn symbolName(comptime typeName: []const u8) []const u8 {
            if (comptime namespace.len > 0) {
                return comptime std.fmt.comptimePrint("{s}__{s}__{s}", .{ namespace, name, typeName });
            } else {
                return comptime std.fmt.comptimePrint("{s}__{s}", .{ name, typeName });
            }
        }

        pub fn exportFunctions(comptime Functions: anytype) [std.meta.fieldNames(@TypeOf(Functions)).len]StaticExport {
            const FunctionsType = @TypeOf(Functions);
            return comptime brk: {
                var functions: [std.meta.fieldNames(FunctionsType).len]StaticExport = undefined;
                for (std.meta.fieldNames(FunctionsType), 0..) |fn_name, i| {
                    const Function = @TypeOf(@field(Functions, fn_name));
                    if (@typeInfo(Function) != .Fn) {
                        @compileError("Expected " ++ @typeName(Parent) ++ "." ++ @typeName(Function) ++ " to be a function but received " ++ @tagName(@typeInfo(Function)));
                    }
                    const Fn: std.builtin.Type.Fn = @typeInfo(Function).Fn;
                    if (Function == bun.JSC.JSHostFunctionTypeWithCCallConvForAssertions and bun.JSC.conv != .C) {
                        @compileError("Expected " ++ bun.meta.typeName(Function) ++ " to have a JSC.conv Calling Convention.");
                    } else if (Function == bun.JSC.JSHostFunctionType) {} else if (Fn.calling_convention != .C) {
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

        pub fn thenables(comptime Functions: anytype) [std.meta.fieldNames(@TypeOf(Functions)).len * 2]StaticExport {
            const FunctionsType = @TypeOf(Functions);
            return comptime brk: {
                var functions: [std.meta.fieldNames(FunctionsType).len * 2]StaticExport = undefined;
                var j: usize = 0;
                for (Functions) |thenable| {
                    for ([_][]const u8{ "resolve", "reject" }) |fn_name| {
                        const Function = @TypeOf(@field(thenable, fn_name));
                        if (@typeInfo(Function) != .Fn) {
                            @compileError("Expected " ++ @typeName(Parent) ++ "." ++ @typeName(Function) ++ " to be a function but received " ++ @tagName(@typeInfo(Function)));
                        }
                        const Fn: std.builtin.Type.Fn = @typeInfo(Function).Fn;
                        if (Fn.calling_convention != .C) {
                            @compileError("Expected " ++ @typeName(Parent) ++ "." ++ @typeName(Function) ++ " to have a C Calling Convention.");
                        }

                        const export_name = symbolName(fn_name);
                        functions[j] = StaticExport{
                            .Type = Function,
                            .symbol_name = export_name,
                            .local_name = fn_name,
                            .Parent = thenable,
                        };
                        j += 1;
                    }
                }

                break :brk functions;
            };
        }

        pub inline fn matchNullable(comptime ExpectedReturnType: type, comptime ExternReturnType: type, value: ExternReturnType) ExpectedReturnType {
            if (comptime isNullableType(ExpectedReturnType) != isNullableType(ExternReturnType)) {
                return value.?;
            } else if (comptime (@typeInfo(ExpectedReturnType) == .Enum) and (@typeInfo(ExternReturnType) != .Enum)) {
                return @as(ExpectedReturnType, @enumFromInt(value));
            } else {
                return value;
            }
        }

        pub inline fn cppFn(comptime typeName: []const u8, args: anytype) (ret: {
            @setEvalBranchQuota(99999);
            if (!@hasDecl(Parent, typeName)) {
                @compileError(@typeName(Parent) ++ " is missing cppFn: " ++ typeName);
            }
            break :ret @typeInfo(@TypeOf(@field(Parent, typeName))).Fn.return_type.?;
        }) {
            log(comptime name ++ "__" ++ typeName, .{});
            @setEvalBranchQuota(99999);
            if (comptime is_bindgen) {
                unreachable;
            } else {
                const Fn = comptime @field(headers, symbolName(typeName));
                if (@typeInfo(@TypeOf(Fn)).Fn.params.len > 0)
                    return matchNullable(
                        comptime @typeInfo(@TypeOf(@field(Parent, typeName))).Fn.return_type.?,
                        comptime @typeInfo(@TypeOf(Fn)).Fn.return_type.?,
                        @call(.auto, Fn, args),
                    );

                return matchNullable(
                    comptime @typeInfo(@TypeOf(@field(Parent, typeName))).Fn.return_type.?,
                    comptime @typeInfo(@TypeOf(Fn)).Fn.return_type.?,
                    Fn(),
                );
            }
        }
    };
}
