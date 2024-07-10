const std = @import("std");
const Dir = std.fs.Dir;
const FnMeta = std.builtin.Type.Fn;
const FnDecl = std.builtin.Type.Declaration.Data.FnDecl;
const StructMeta = std.builtin.Type.Struct;
const EnumMeta = std.builtin.Type.Enum;
const UnionMeta = std.builtin.Type.Union;
const warn = std.debug.warn;
const StaticExport = @import("./static_export.zig");
const typeBaseName = @import("../../meta.zig").typeBaseName;
const bun = @import("root").bun;
const TypeNameMap = bun.StringHashMap([]const u8);

fn isCppObject(comptime Type: type) bool {
    return switch (@typeInfo(Type)) {
        .Struct, .Union, .Opaque => true,
        .Enum => @hasDecl(Type, "Type"),
        else => false,
    };
}

const ENABLE_REWRITE_RETURN = false;

pub fn cTypeLabel(comptime Type: type) ?[]const u8 {
    return switch (comptime Type) {
        *c_char => "char*",
        [*c]u8, *const c_char => "const char*",
        c_char => "char",
        *void => "void",
        bool => "bool",
        usize => "size_t",
        isize => "int",
        u8 => "unsigned char",
        u16 => "uint16_t",
        u32 => "uint32_t",
        u64 => "uint64_t",
        i8 => "int8_t",
        i16 => "int16_t",
        i24 => "int24_t",
        i32 => "int32_t",
        i64 => "int64_t",
        f64 => "double",
        f32 => "float",
        *anyopaque => "void*",
        *const anyopaque => "const void*",
        [*c]bool, [*]bool => "bool*",
        [*c]usize, [*]usize => "size_t*",
        [*c]isize, [*]isize => "int*",
        [*]u8 => "unsigned char*",
        [*c]u16, [*]u16 => "uint16_t*",
        [*c]u32, [*]u32 => "uint32_t*",
        [*c]u64, [*]u64 => "uint64_t*",
        [*c]i8, [*]i8 => "int8_t*",
        [*c]i16, [*]i16 => "int16_t*",
        [*c]i32, [*]i32 => "int32_t*",
        [*c]i64, [*]i64 => "int64_t*",
        [*c]const bool, [*]const bool => "const bool*",
        [*c]const usize, [*]const usize => "const size_t*",
        [*c]const isize, [*]const isize => "const int*",
        [*c]const u8, [*]const u8 => "const unsigned char*",
        [*c]const u16, [*]const u16 => "const uint16_t*",
        [*c]const u32, [*]const u32 => "const uint32_t*",
        [*c]const u64, [*]const u64 => "const uint64_t*",
        [*c]const i8, [*]const i8 => "const int8_t*",
        [*c]const i16, [*]const i16 => "const int16_t*",
        [*c]const i32, [*]const i32 => "const int32_t*",
        [*c]const i64, [*]const i64 => "const int64_t*",
        else => null,
    };
}

var buffer = std.ArrayList(u8).init(std.heap.c_allocator);
var writer = buffer.writer();
var impl_buffer = std.ArrayList(u8).init(std.heap.c_allocator);
var impl_writer = impl_buffer.writer();
var bufset = std.BufSet.init(std.heap.c_allocator);
var type_names = TypeNameMap.init(std.heap.c_allocator);
var opaque_types = std.BufSet.init(std.heap.c_allocator);
var size_map = bun.StringHashMap(u32).init(std.heap.c_allocator);
var align_map = bun.StringHashMap(u29).init(std.heap.c_allocator);

pub const C_Generator = struct {
    filebase: []const u8,

    direction: Direction = .export_cpp,
    const Self = @This();

    pub const Direction = enum {
        export_cpp,
        export_zig,
    };

    pub fn init(comptime src_file: []const u8, comptime Writer: type, _: Writer) Self {
        const res = Self{ .filebase = src_file };

        return res;
    }

    pub fn deinit(_: *const Self) void {
        // self.file.writeAll("\n/**** </") catch unreachable;
        // self.file.writeAll(self.filebase) catch unreachable;
        // self.file.writeAll("> ****/\n\n") catch unreachable;
    }

    pub fn gen_func(
        self: *Self,
        comptime name: []const u8,
        comptime func: anytype,
        comptime meta: FnMeta,
        comptime _: []const []const u8,
        comptime rewrite_return: bool,
    ) void {
        switch (comptime meta.calling_convention) {
            .Naked => self.write("__attribute__((naked)) "),
            .Stdcall => self.write("__attribute__((stdcall)) "),
            .Fastcall => self.write("__attribute__((fastcall)) "),
            .Thiscall => self.write("__attribute__((thiscall)) "),
            else => {},
        }

        switch (self.direction) {
            .export_cpp => self.write("CPP_DECL "),
            .export_zig => self.write("ZIG_DECL "),
        }

        const return_type: type = comptime if (@TypeOf(func.return_type) == ?type)
            (func.return_type orelse void)
        else
            func.return_type;

        if (comptime rewrite_return) {
            self.writeType(void);
        } else {
            self.writeType(comptime return_type);
        }

        self.write(" " ++ name ++ "(");

        if (comptime rewrite_return) {
            self.writeType(comptime return_type);
            self.write("_buf ret_value");

            if (comptime meta.args.len > 0) {
                self.write(", ");
            }
        }

        comptime var nonnull = std.BoundedArray(u8, 32).init(0) catch unreachable;

        inline for (meta.params, 0..) |arg, i| {
            const ArgType = comptime arg.type.?;

            switch (comptime @typeInfo(ArgType)) {
                .Fn => {
                    self.gen_closure(comptime arg.type.?, comptime std.fmt.comptimePrint(" ArgFn{d}", .{i}));
                    comptime nonnull.append(i) catch unreachable;
                },
                else => |info| {
                    if (comptime info == .Pointer and @typeInfo(info.Pointer.child) == .Fn) {
                        self.gen_closure(comptime info.Pointer.child, comptime std.fmt.comptimePrint(" ArgFn{d}", .{i}));
                        comptime nonnull.append(i) catch unreachable;
                    } else {
                        self.writeType(comptime arg.type.?);

                        switch (@typeInfo(ArgType)) {
                            .Enum => {
                                self.write(comptime std.fmt.comptimePrint(" {s}{d}", .{ typeBaseName(@typeName(ArgType)), i }));
                            },

                            else => {
                                self.write(comptime std.fmt.comptimePrint(" arg{d}", .{i}));
                            },
                        }
                    }
                },
            }

            // if (comptime func.arg_names.len > 0 and func.arg_names.len > i) {
            //     self.write(comptime arg_names[i]);
            // } else {

            //TODO: Figure out how to get arg names; for now just do arg0..argN
            if (i != meta.params.len - 1)
                self.write(", ");
        }

        self.write(")");
        // we don't handle nonnull due to MSVC not supporting it.
        defer self.write(";\n");
        // const ReturnTypeInfo: std.builtin.Type = comptime @typeInfo(func.return_type);
        // switch (comptime ReturnTypeInfo) {
        //     .Pointer => |Pointer| {
        //         self.write(" __attribute__((returns_nonnull))");
        //     },
        //     .Optional => |Optional| {},
        //     else => {},
        // }
    }

    pub fn gen_closure(
        self: *Self,
        comptime Function: type,
        comptime name: []const u8,
    ) void {
        const func: std.builtin.Type.Fn = @typeInfo(Function).Fn;
        self.writeType(func.return_type orelse void);
        self.write("(*" ++ name ++ ")(");
        inline for (func.params, 0..) |arg, i| {
            self.writeType(arg.type.?);
            // if (comptime func.arg_names.len > 0 and func.arg_names.len > i) {
            //     self.write(comptime arg_names[i]);
            // } else {
            const ArgType = arg.type.?;
            if (@typeInfo(ArgType) == .Enum) {
                self.write(comptime std.fmt.comptimePrint(" {s}{d}", .{ typeBaseName(@typeName(ArgType)), i }));
            } else {
                self.write(comptime std.fmt.comptimePrint(" arg{d}", .{i}));
            }
            // }

            //TODO: Figure out how to get arg names; for now just do arg0..argN
            if (i != func.params.len - 1)
                self.write(", ");
        }

        self.write(")");
        // const ReturnTypeInfo: std.builtin.Type = comptime @typeInfo(func.return_type);
        // switch (comptime ReturnTypeInfo) {
        //     .Pointer => |Pointer| {
        //         self.write(" __attribute__((returns_nonnull))");
        //     },
        //     .Optional => |Optional| {},
        //     else => {},
        // }
    }

    pub fn gen_struct(
        self: *Self,
        comptime name: []const u8,
        comptime meta: StructMeta,
        comptime static_types: anytype,
    ) void {
        self.write("typedef struct ");

        if (meta.layout == .Packed)
            self.write("__attribute__((__packed__)) ");

        self.write(name ++ " {\n");

        inline for (meta.fields) |field| {
            self.write("   ");

            const info = @typeInfo(field.type);

            if (info == .Array) {
                const PrintType = comptime brk: {
                    for (static_types) |static_type| {
                        if (static_type.Type == info.Array.child) {
                            break :brk static_type.Type;
                        }
                    }

                    break :brk info.Array.child;
                };
                self.writeType(PrintType);
            } else {
                const PrintType = comptime brk: {
                    for (static_types) |static_type| {
                        if (static_type.Type == field.type) {
                            break :brk static_type.Type;
                        }
                    }

                    break :brk field.type;
                };
                self.writeType(PrintType);
            }

            self.write(" " ++ field.name);

            if (info == .Array) {
                writer.print("[{}]", .{info.Array.len}) catch unreachable;
            }

            self.write(";\n");
        }
        self.write("} " ++ name ++ ";\n\n");
    }

    pub fn gen_enum(
        self: *Self,
        comptime name: []const u8,
        comptime meta: EnumMeta,
    ) void {
        self.write("enum " ++ name ++ " {\n");

        comptime var last = 0;
        inline for (meta.fields, 0..) |field, i| {
            self.write("    " ++ field.name);

            // if field value is unexpected/custom, manually define it
            if ((i == 0 and field.value != 0) or (i > 0 and field.value > last + 1)) {
                writer.print(" = {}", .{field.value}) catch unreachable;
            }

            self.write(",\n");

            last = field.value;
        }

        self.write("};\n\n");
    }

    pub fn gen_union(
        _: *Self,
        comptime _: []const u8,
        comptime _: UnionMeta,
        comptime _: anytype,
    ) void {
        @compileError("Not implemented");
        // self.write("typedef union ");

        // self.write(name ++ " {\n");

        // inline for (meta.fields) |field, i| {
        //     self.write("   ");

        //     self.writeType(comptime FieldType);

        //     self.write(" " ++ field.name ++ ";\n");
        // }
        // self.write("} " ++ name ++ ";\n\n");
    }

    fn writeType(
        self: *Self,
        comptime T: type,
    ) void {
        const TT = comptime brk: {
            var Type = T;
            if (@typeInfo(Type) == .Optional) {
                const OtherType = std.meta.Child(Type);
                if (@typeInfo(OtherType) == .Fn) {
                    Type = OtherType;
                }
            }
            if (@typeInfo(Type) == .Pointer and !std.meta.isManyItemPtr(Type)) {
                Type = @typeInfo(Type).Pointer.child;
            }

            break :brk Type;
        };

        if (comptime (isCppObject(TT)) and @hasDecl(TT, "name")) {
            if (@typeInfo(T) == .Pointer or (@hasDecl(TT, "Type") and (@TypeOf(TT.Type) == type and @typeInfo(TT.Type) == .Pointer))) {
                if (@hasDecl(TT, "is_pointer") and !TT.is_pointer) {} else if (@typeInfo(T).Pointer.is_const) {
                    write(self, "const ");
                }
            }

            const _formatted_name = comptime brk: {
                var original: [TT.name.len]u8 = undefined;
                _ = std.mem.replace(u8, TT.name, ":", "_", &original);
                break :brk original;
            };
            const formatted_name = comptime _formatted_name[0..];

            if (@hasDecl(TT, "is_pointer") and !TT.is_pointer) {
                if (@TypeOf(TT.Type) == type) {
                    if (cTypeLabel(TT.Type)) |label| {
                        type_names.put(comptime label, formatted_name) catch unreachable;
                        if (@typeInfo(TT) == .Struct and @hasField(TT, "bytes")) {
                            size_map.put(comptime formatted_name, @as(u32, TT.shim.byte_size)) catch unreachable;
                            align_map.put(comptime formatted_name, @as(u29, TT.shim.align_size)) catch unreachable;
                        } else if (@typeInfo(TT) == .Opaque) {
                            opaque_types.insert(comptime label) catch unreachable;
                        }
                    }
                } else {
                    type_names.put(comptime TT.name, formatted_name) catch unreachable;
                    if (@typeInfo(TT) == .Struct and @hasField(TT, "bytes")) {
                        size_map.put(comptime formatted_name, @as(u32, TT.shim.byte_size)) catch unreachable;
                        align_map.put(comptime formatted_name, @as(u29, TT.shim.align_size)) catch unreachable;
                    } else if (@typeInfo(TT) == .Opaque) {
                        opaque_types.insert(comptime TT.name) catch unreachable;
                    }
                }
            } else {
                type_names.put(comptime TT.name, formatted_name) catch unreachable;
                if (@typeInfo(TT) == .Struct and @hasField(TT, "bytes")) {
                    size_map.put(comptime formatted_name, @as(u32, TT.shim.byte_size)) catch unreachable;
                    align_map.put(comptime formatted_name, @as(u29, TT.shim.align_size)) catch unreachable;
                } else if (@typeInfo(TT) == .Opaque) {
                    opaque_types.insert(comptime TT.name) catch unreachable;
                }
            }

            if (TT == T and @hasField(T, "bytes")) {
                write(self, comptime "b" ++ formatted_name);
            } else {
                write(self, comptime formatted_name);
            }

            if (@typeInfo(T) == .Pointer or (@hasDecl(TT, "Type") and (@TypeOf(TT.Type) == type and @typeInfo(TT.Type) == .Pointer))) {
                if (@hasDecl(TT, "is_pointer") and !TT.is_pointer) {} else {
                    write(self, "*");
                }
            }
            return;
        }

        if (comptime cTypeLabel(T)) |label| {
            self.write(comptime label);
        } else {
            const meta = @typeInfo(T);
            switch (meta) {
                .Pointer => |Pointer| {
                    const child = Pointer.child;
                    // if (childmeta == .Struct and childmeta.Struct.layout != .Extern) {
                    //     self.write("void");
                    // } else {
                    self.writeType(child);
                    // }
                    self.write("*");
                },
                .Optional => self.writeType(meta.Optional.child),
                .Array => @compileError("Handle goofy looking C Arrays in the calling function"),
                .Enum => |Enum| {
                    self.writeType(Enum.tag_type);
                },
                else => {
                    return self.write(comptime typeBaseName(@typeName(T)));
                },
            }
        }
    }

    fn write(_: *Self, comptime str: []const u8) void {
        _ = writer.write(str) catch {};
    }
};

const builtin = @import("builtin");
const TypeInfo = builtin.TypeInfo;
const Declaration = TypeInfo.Declaration;

const GeneratorInterface = struct {
    fn init() void {}
    fn deinit() void {}
    fn gen_func() void {}
    fn gen_struct() void {}
    fn gen_enum() void {}
    fn gen_union() void {}
};

fn validateGenerator(comptime Generator: type) void {
    comptime {
        const interface = @typeInfo(GeneratorInterface).Struct.decls;

        for (interface) |decl| {
            if (@hasDecl(Generator, decl.name) == false) {
                @compileError("Generator: '" ++
                    @typeName(Generator) ++
                    "' is missing function: " ++
                    decl.name);
            }
        }
    }
}

const NamedStruct = struct {
    name: []const u8,
    Type: type,
};

pub fn getCStruct(comptime T: type) ?NamedStruct {
    if (!std.meta.isContainer(T) or
        (std.meta.isSingleItemPtr(T) and
        !std.meta.isContainer(std.meta.Child(T))))
    {
        return null;
    }

    inline for (std.meta.declarations(T)) |decl| {
        if (std.mem.eql(u8, decl.name, "Type")) {
            switch (decl.data) {
                .Type => {
                    return NamedStruct{ .Type = T, .name = comptime typeBaseName(@typeName(T)) };
                },
                else => {},
            }
        }
    }

    return null;
}

var thenables = std.ArrayListUnmanaged([]const u8){};
pub fn HeaderGen(comptime first_import: type, comptime second_import: type, comptime fname: []const u8) type {
    return struct {
        source_file: []const u8 = fname,
        gen: C_Generator = undefined,

        const Self = @This();

        pub fn init() Self {
            return Self{};
        }

        pub fn startFile(
            comptime _: Self,
            comptime Type: type,
            comptime _: []const u8,
            file: anytype,
            other: std.fs.File,
        ) void {
            if (@hasDecl(Type, "include")) {
                comptime var new_name = std.mem.zeroes([Type.include.len]u8);

                comptime {
                    _ = std.mem.replace(u8, Type.include, "/", "_", &new_name);
                    _ = std.mem.replace(u8, &new_name, ".", "_", &new_name);
                    _ = std.mem.replace(u8, &new_name, "<", "_", &new_name);
                    _ = std.mem.replace(u8, &new_name, ">", "_", &new_name);
                    _ = std.mem.replace(u8, &new_name, "\"", "_", &new_name);
                }
                file.writeAll("\n#pragma mark - " ++ Type.name ++ "\n\n") catch unreachable;

                if (@hasDecl(Type, "include")) {
                    other.writer().print(
                        \\
                        \\#ifndef INCLUDED_{s}
                        \\#define INCLUDED_{s}
                        \\#include "{s}"
                        \\#endif
                        \\
                        \\extern "C" const size_t {s} = sizeof({s});
                        \\extern "C" const size_t {s} = alignof({s});
                        \\
                    ,
                        .{ new_name, new_name, Type.include, Type.shim.size_of_symbol, Type.name, Type.shim.align_of_symbol, Type.name },
                    ) catch unreachable;
                }
            }
        }

        pub fn processStaticExport(comptime _: Self, _: anytype, gen: *C_Generator, comptime static_export: StaticExport) void {
            const fn_meta = comptime @typeInfo(static_export.Type).Fn;
            const DeclData = @typeInfo(@TypeOf(@field(static_export.Parent, static_export.local_name)));

            gen.gen_func(
                comptime static_export.symbol_name,
                DeclData.Fn,
                comptime fn_meta,
                comptime std.mem.zeroes([]const []const u8),
                false,
            );
        }

        pub fn processThenable(comptime _: Self, _: anytype, comptime static_export: StaticExport) void {
            thenables.append(std.heap.c_allocator, comptime static_export.symbol_name) catch unreachable;
        }

        pub fn processDecl(
            comptime _: Self,
            _: anytype,
            gen: *C_Generator,
            comptime ParentType: type,
            comptime _: std.builtin.Type.Declaration,
            comptime name: []const u8,
            comptime prefix: []const u8,
        ) void {
            const DeclData = @typeInfo(@TypeOf(@field(ParentType, name)));

            switch (comptime DeclData) {
                .Type => |Type| {
                    switch (@typeInfo(Type)) {
                        .Enum => |Enum| {
                            gen.gen_enum(
                                prefix ++ "__" ++ name,
                                Enum,
                            );
                        },

                        .Fn => |func| {
                            // if (func.) {
                            // blocked by https://github.com/ziglang/zig/issues/8259
                            gen.gen_func(
                                comptime prefix ++ "__" ++ name,
                                comptime func,
                                comptime func,
                                comptime &.{},
                                false, // comptime ENABLE_REWRITE_RETURN and @typeInfo(fn_meta.return_type) == .Struct,
                            );
                        },
                        else => {},
                    }
                },
                .Fn => |func| {
                    // if (func.) {
                    // blocked by https://github.com/ziglang/zig/issues/8259
                    gen.gen_func(
                        comptime prefix ++ "__" ++ name,
                        comptime func,
                        comptime func,
                        comptime &.{},
                        comptime ENABLE_REWRITE_RETURN and @typeInfo(func.return_type) == .Struct,
                    );
                },
                else => {},
            }
        }

        pub fn exec(comptime self: Self, file: std.fs.File, impl: std.fs.File, generated: std.fs.File) void {
            const Generator = C_Generator;
            validateGenerator(Generator);
            var file_writer = file.writer();
            file_writer.writeAll("// clang-format off\n" ++
                \\//-- GENERATED FILE. Do not edit --
                \\//
                \\//   To regenerate this file, run:
                \\//   
                \\//      make headers
                \\// 
                \\//-- GENERATED FILE. Do not edit --
                \\
            ) catch unreachable;
            file.writeAll(
                \\#pragma once
                \\
                \\#include <stddef.h>
                \\#include <stdint.h>
                \\#include <stdbool.h>
                \\
                \\#ifdef __cplusplus
                \\  #define AUTO_EXTERN_C extern "C"
                \\  #ifdef WIN32
                \\  #define AUTO_EXTERN_C_ZIG extern "C"
                \\  #else
                \\  #define AUTO_EXTERN_C_ZIG extern "C" __attribute__((weak))
                \\  #endif
                \\#else
                \\  #define AUTO_EXTERN_C
                \\  #define AUTO_EXTERN_C_ZIG __attribute__((weak))
                \\#endif
                \\#define ZIG_DECL AUTO_EXTERN_C_ZIG
                \\#define CPP_DECL AUTO_EXTERN_C
                \\#define CPP_SIZE AUTO_EXTERN_C
                \\
                \\#ifndef __cplusplus
                \\typedef void* JSClassRef;
                \\#endif
                \\
                \\#ifdef __cplusplus
                \\#include "root.h"
                \\#include <JavaScriptCore/JSClassRef.h>
                \\#endif
                \\#include "headers-handwritten.h"
                \\
            ) catch {};

            impl.writer().writeAll("// clang-format off\n" ++
                \\//-- GENERATED FILE. Do not edit --
                \\//
                \\//   To regenerate this file, run:
                \\//   
                \\//      make headers
                \\// 
                \\//-- GENERATED FILE. Do not edit --
                \\
            ) catch unreachable;
            impl.writer().writeAll(
                \\#pragma once
                \\
                \\#include <stddef.h>
                \\#include <stdint.h>
                \\#include <stdbool.h>
                \\
                \\#include "root.h"
                \\
            ) catch {};

            var impl_second_buffer = std.ArrayList(u8).init(std.heap.c_allocator);
            var impl_second_writer = impl_second_buffer.writer();

            var impl_third_buffer = std.ArrayList(u8).init(std.heap.c_allocator);
            var impl_third_writer = impl_third_buffer.writer();

            var impl_fourth_buffer = std.ArrayList(u8).init(std.heap.c_allocator);
            var impl_fourth_writer = impl_fourth_buffer.writer();

            // var lazy_function_definitions_writer = lazy_function_definitions_buffer.writer();

            var dom_buffer = std.ArrayList(u8).init(std.heap.c_allocator);
            var dom_writer = dom_buffer.writer();

            // inline for (import.all_static_externs) |static_extern, i| {
            //     const Type = static_extern.Type;
            //     var gen = C_Generator.init(static_extern.name, @TypeOf(writer), writer);
            //     defer gen.deinit();

            //     switch (@typeInfo(Type)) {
            //         .Enum => |Enum| {
            //             gen.gen_enum(
            //                 static_extern.name,
            //                 Enum,
            //             );
            //         },
            //         .Union => |Union| {
            //             gen.gen_union(static_extern.name, Union, import.all_static_externs);
            //         },
            //         .Struct => |Struct| {
            //             gen.gen_struct(static_extern.name, Struct, import.all_static_externs);
            //         },
            //         else => {},
            //     }
            // }

            var to_get_sizes: usize = 0;

            const exclude_from_cpp = comptime [_][]const u8{ "ZigString", "ZigException" };

            const TypesToCheck: []type = comptime brk: {
                var all_types: [100]type = undefined;
                all_types[0] = first_import;
                all_types[1] = second_import;
                var counter: usize = 2;
                inline for (first_import.DOMCalls) |Type_| {
                    const Type = if (@typeInfo(@TypeOf(Type_)) == .Pointer)
                        @typeInfo(@TypeOf(Type_)).Pointer.child
                    else
                        @TypeOf(Type_);

                    inline for (bun.meta.fieldNames(Type)) |static_function_name| {
                        const static_function = @field(Type_, static_function_name);
                        all_types[counter] = static_function;
                        counter += 1;
                    }
                }

                break :brk all_types[0..counter];
            };

            inline for (first_import.DOMCalls) |Type_| {
                const Type = if (@typeInfo(@TypeOf(Type_)) == .Pointer)
                    @typeInfo(@TypeOf(Type_)).Pointer.child
                else
                    @TypeOf(Type_);

                inline for (comptime bun.meta.fieldNames(Type)) |static_function_name| {
                    const static_function = comptime @field(Type_, static_function_name);
                    if (comptime @TypeOf(static_function) == type and @hasDecl(static_function, "is_dom_call")) {
                        dom_writer.writeAll("\n\n") catch unreachable;
                        static_function.printGenerateDOMJITSignature(@TypeOf(&dom_writer), &dom_writer) catch unreachable;
                        dom_writer.writeAll("\n\n") catch unreachable;
                    }
                }
            }

            inline for (TypesToCheck) |BaseType| {
                const all_decls = comptime std.meta.declarations(BaseType);
                inline for (all_decls) |_decls| {
                    // if (comptime _decls.is_pub) {
                    @setEvalBranchQuota(99999);
                    const Type = @field(BaseType, _decls.name);
                    if (@TypeOf(Type) == type) {
                        const TypeTypeInfo: std.builtin.Type = @typeInfo(@field(BaseType, _decls.name));
                        const is_container_type = switch (TypeTypeInfo) {
                            .Opaque, .Struct, .Enum => true,
                            else => false,
                        };

                        if (is_container_type and (@hasDecl(Type, "Extern") or @hasDecl(Type, "Export") or @hasDecl(Type, "lazy_static_functions"))) {
                            const identifier = comptime std.fmt.comptimePrint("{s}_{s}", .{ Type.shim.name, Type.shim.namespace });
                            if (!bufset.contains(identifier)) {
                                self.startFile(
                                    Type,
                                    Type.shim.name,
                                    writer,
                                    impl,
                                );

                                bufset.insert(identifier) catch unreachable;

                                var gen = C_Generator.init(Type.name, @TypeOf(writer), writer);
                                defer gen.deinit();

                                if (@hasDecl(Type, "Extern")) {
                                    if (comptime !(std.mem.eql(u8, Type.name, exclude_from_cpp[0]) or std.mem.eql(u8, Type.name, exclude_from_cpp[1]))) {
                                        if (to_get_sizes > 0) {
                                            impl_second_writer.writeAll(", ") catch unreachable;
                                            impl_third_writer.writeAll(", ") catch unreachable;
                                            impl_fourth_writer.writeAll(", ") catch unreachable;
                                        }
                                    }

                                    const formatted_name = comptime brk: {
                                        var original: [Type.name.len]u8 = undefined;
                                        _ = std.mem.replace(u8, Type.name, ":", "_", &original);
                                        break :brk original;
                                    };

                                    if (comptime !(std.mem.eql(u8, Type.name, exclude_from_cpp[0]) or std.mem.eql(u8, Type.name, exclude_from_cpp[1]))) {
                                        impl_third_writer.print("sizeof({s})", .{comptime Type.name}) catch unreachable;
                                        impl_fourth_writer.print("alignof({s})", .{comptime Type.name}) catch unreachable;
                                        impl_second_writer.print("\"{s}\"", .{formatted_name}) catch unreachable;
                                        to_get_sizes += 1;
                                    }
                                    const ExternList = comptime brk: {
                                        const Sorder = struct {
                                            pub fn lessThan(_: @This(), lhs: []const u8, rhs: []const u8) bool {
                                                return std.ascii.orderIgnoreCase(lhs, rhs) == std.math.Order.lt;
                                            }
                                        };
                                        var extern_list = Type.Extern;
                                        std.sort.block([]const u8, &extern_list, Sorder{}, Sorder.lessThan);
                                        break :brk extern_list;
                                    };
                                    // impl_writer.print("  #include {s}\n", .{Type.include}) catch unreachable;
                                    inline for (&ExternList) |extern_decl| {
                                        if (@hasDecl(Type, extern_decl)) {
                                            const normalized_name = comptime brk: {
                                                var _normalized_name: [Type.name.len]u8 = undefined;
                                                _ = std.mem.replace(u8, Type.name, ":", "_", &_normalized_name);
                                                break :brk _normalized_name;
                                            };

                                            processDecl(
                                                self,
                                                writer,
                                                &gen,
                                                Type,
                                                comptime std.meta.declarationInfo(Type, extern_decl),
                                                comptime extern_decl,
                                                &normalized_name,
                                            );
                                        }
                                    }
                                }

                                if (@hasDecl(Type, "Export")) {
                                    const ExportList = comptime brk: {
                                        const SortContext = struct {
                                            data: []StaticExport,
                                            pub fn lessThan(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) bool {
                                                return std.ascii.orderIgnoreCase(ctx.data[lhs].symbol_name, ctx.data[rhs].symbol_name) == std.math.Order.lt;
                                            }
                                            pub fn swap(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) void {
                                                const tmp = ctx.data[lhs];
                                                ctx.data[lhs] = ctx.data[rhs];
                                                ctx.data[rhs] = tmp;
                                            }
                                        };
                                        var extern_list = Type.Export;
                                        std.sort.insertionContext(0, extern_list.len, SortContext{
                                            .data = &extern_list,
                                        });
                                        break :brk extern_list;
                                    };

                                    gen.direction = C_Generator.Direction.export_zig;
                                    if (ExportList.len > 0) {
                                        gen.write("\n#ifdef __cplusplus\n\n");
                                        inline for (ExportList) |static_export| {
                                            processStaticExport(
                                                self,
                                                file,
                                                &gen,
                                                comptime static_export,
                                            );
                                        }
                                        gen.write("\n#endif\n");
                                    }
                                }

                                // if (@hasDecl(Type, "lazy_static_functions")) {
                                //     const ExportLIst = comptime brk: {
                                //         const Sorder = struct {
                                //             pub fn lessThan(_: @This(), comptime lhs: StaticExport, comptime rhs: StaticExport) bool {
                                //                 return std.ascii.orderIgnoreCase(lhs.symbol_name, rhs.symbol_name) == std.math.Order.lt;
                                //             }
                                //         };
                                //         var extern_list = Type.lazy_static_functions;
                                //         std.sort.block(StaticExport, &extern_list, Sorder{}, Sorder.lessThan);
                                //         break :brk extern_list;
                                //     };

                                //     gen.direction = C_Generator.Direction.export_zig;
                                //     if (ExportLIst.len > 0) {
                                //         lazy_function_definitions_writer.writeAll("\n#pragma mark ") catch unreachable;
                                //         lazy_function_definitions_writer.writeAll(Type.shim.name) catch unreachable;
                                //         lazy_function_definitions_writer.writeAll("\n\n") catch unreachable;

                                //         inline for (ExportLIst) |static_export| {
                                //             const exp: StaticExport = static_export;
                                //             lazy_function_definitions_writer.print("  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_{s};", .{exp.symbol_name}) catch unreachable;
                                //             lazy_function_definitions_writer.writeAll("\n") catch unreachable;

                                //             lazy_function_definitions_writer.print(
                                //                 "  Zig::JSFFIFunction* get__{s}(Zig::GlobalObject *globalObject) {{ return m_{s}.getInitializedOnMainThread(globalObject); }}",
                                //                 .{ exp.symbol_name, exp.symbol_name },
                                //             ) catch unreachable;
                                //             lazy_function_definitions_writer.writeAll("\n") catch unreachable;

                                //             const impl_format =
                                //                 \\
                                //                 \\  m_{s}.initLater(
                                //                 \\      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {{
                                //                 \\          WTF::String functionName = WTF::String("{s}"_s);
                                //                 \\          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
                                //                 \\               init.vm,
                                //                 \\               init.owner,
                                //                 \\               1,
                                //                 \\               functionName,
                                //                 \\               {s},
                                //                 \\               JSC::NoIntrinsic,
                                //                 \\               {s}
                                //                 \\          );
                                //                 \\          init.set(function);
                                //                 \\      }});
                                //                 \\
                                //             ;

                                //             lazy_functions_buffer_writer.print(
                                //                 impl_format,
                                //                 .{
                                //                     exp.symbol_name,
                                //                     exp.local_name,
                                //                     exp.symbol_name,
                                //                     exp.symbol_name,
                                //                 },
                                //             ) catch unreachable;

                                //             lazy_function_visitor_writer.print(
                                //                 \\  this->m_{s}.visit(visitor);
                                //                 \\
                                //             ,
                                //                 .{exp.symbol_name},
                                //             ) catch unreachable;
                                //         }
                                //         gen.write("\n");
                                //     }
                                // }
                            }
                        }
                    }
                    // }
                }
            }

            impl.writer().print("\nconst size_t sizes[{d}] = {{", .{to_get_sizes}) catch unreachable;
            impl.writeAll(impl_third_buffer.items) catch unreachable;
            impl.writeAll("};\n") catch unreachable;
            impl.writer().print("\nconst char* names[{d}] = {{", .{to_get_sizes}) catch unreachable;
            impl.writeAll(impl_second_buffer.items) catch unreachable;
            impl.writeAll("};\n") catch unreachable;
            impl.writer().print("\nconst size_t aligns[{d}] = {{", .{to_get_sizes}) catch unreachable;
            impl.writeAll(impl_fourth_buffer.items) catch unreachable;
            impl.writeAll("};\n") catch unreachable;
            var iter = type_names.iterator();

            generated.writer().print(
                \\ #include "root.h"
                \\ #include "headers.h"
                \\ 
                \\ #include <JavaScriptCore/DOMJITAbstractHeap.h>
                \\ #include "DOMJITIDLConvert.h"
                \\ #include "DOMJITIDLType.h"
                \\ #include "DOMJITIDLTypeFilter.h"
                \\ #include "DOMJITHelpers.h"
                \\ #include <JavaScriptCore/DFGAbstractHeap.h>
                \\ 
                \\ #include "JSDOMConvertBufferSource.h"
                \\ 
                \\ using namespace JSC;
                \\ using namespace WebCore;
                \\
                \\
                \\  /* -- BEGIN DOMCall DEFINITIONS -- */
                \\  {s}
                \\  /* -- END DOMCall DEFINITIONS-- */
                \\
                \\
            , .{
                dom_buffer.items,
            }) catch unreachable;

            const NamespaceMap = bun.StringArrayHashMap(std.BufMap);
            var namespaces = NamespaceMap.init(std.heap.c_allocator);

            var size_iter = size_map.iterator();
            while (size_iter.next()) |size| {
                file_writer.print(" typedef struct b{s} {{ unsigned char bytes[{d}]; }} b{s};\n", .{
                    size.key_ptr.*,
                    // align_map.get(size.key_ptr.*).?,
                    size.value_ptr.*,
                    size.key_ptr.*,
                }) catch unreachable;

                file_writer.print(" typedef char* b{s}_buf;\n", .{
                    size.key_ptr.*,
                }) catch unreachable;
            }

            file_writer.writeAll("\n#ifndef __cplusplus\n") catch unreachable;
            while (iter.next()) |entry| {
                const key = entry.key_ptr.*;
                const value = entry.value_ptr.*;
                if (std.mem.indexOfScalar(u8, entry.key_ptr.*, ':')) |namespace_start| {
                    const namespace = entry.key_ptr.*[0..namespace_start];

                    if (opaque_types.contains(entry.key_ptr.*)) {
                        file_writer.print(" typedef struct {s} {s}; // {s}\n", .{
                            value,
                            value,
                            key,
                        }) catch unreachable;
                    } else {
                        file_writer.print(" typedef b{s} {s}; // {s}\n", .{
                            value,
                            value,
                            key,
                        }) catch unreachable;
                    }

                    if (!namespaces.contains(namespace)) {
                        namespaces.put(namespace, std.BufMap.init(std.heap.c_allocator)) catch unreachable;
                    }
                    const class = key[namespace_start + 2 ..];
                    namespaces.getPtr(namespace).?.put(class, value) catch unreachable;
                } else {
                    file_writer.print("  typedef {s} {s};\n", .{
                        key,
                        value,
                    }) catch unreachable;

                    impl_writer.print("  typedef {s} {s};\n", .{
                        key,
                        value,
                    }) catch unreachable;
                }
            }

            file_writer.writeAll("\n#endif\n") catch unreachable;

            file_writer.writeAll("\n#ifdef __cplusplus\n") catch unreachable;

            iter = type_names.iterator();
            var namespace_iter = namespaces.iterator();
            while (namespace_iter.next()) |map| {
                file_writer.print("  namespace {s} {{\n", .{map.key_ptr.*}) catch unreachable;
                var classes = map.value_ptr.iterator();
                while (classes.next()) |class| {
                    file_writer.print("    class {s};\n", .{class.key_ptr.*}) catch unreachable;
                }
                file_writer.writeAll("  }\n") catch unreachable;
            }

            file_writer.writeAll("\n") catch unreachable;

            file_writer.writeAll(impl_buffer.items) catch unreachable;

            iter = type_names.iterator();
            namespace_iter = namespaces.iterator();
            while (namespace_iter.next()) |map| {
                var classes = map.value_ptr.iterator();
                while (classes.next()) |class| {
                    file_writer.print("  using {s} = {s}::{s};\n", .{
                        class.value_ptr.*,
                        map.key_ptr.*,
                        class.key_ptr.*,
                    }) catch unreachable;
                }
            }

            file_writer.writeAll("\n#endif\n\n") catch unreachable;

            file.writeAll(buffer.items) catch unreachable;

            // processDecls(
            //     self,
            //     file,
            //     import,
            //     "Bindings",
            // );
        }
    };
}
