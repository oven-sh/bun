const std = @import("std");
const Dir = std.fs.Dir;
const FnMeta = std.builtin.TypeInfo.Fn;
const FnDecl = std.builtin.TypeInfo.Declaration.Data.FnDecl;
const StructMeta = std.builtin.TypeInfo.Struct;
const EnumMeta = std.builtin.TypeInfo.Enum;
const UnionMeta = std.builtin.TypeInfo.Union;
const warn = std.debug.warn;
const StaticExport = @import("./static_export.zig");

const TypeNameMap = std.StringHashMap([]const u8);

fn isCppObject(comptime Type: type) bool {
    return switch (@typeInfo(Type)) {
        .Struct, .Union, .Opaque => true,
        .Enum => |Enum| @hasDecl(Type, "Type"),
        else => false,
    };
}

pub fn cTypeLabel(comptime Type: type) ?[]const u8 {
    return switch (comptime Type) {
        void => "void",
        bool => "bool",
        usize => "size_t",
        isize => "int",
        u8 => "char",
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
        *c_void => "void*",
        [*]bool => "bool*",
        [*]usize => "size_t*",
        [*]isize => "int*",
        [*]u8 => "char*",
        [*]u16 => "uint16_t*",
        [*]u32 => "uint32_t*",
        [*]u64 => "uint64_t*",
        [*]i8 => "int8_t*",
        [*]i16 => "int16_t*",
        [*]i32 => "int32_t*",
        [*]i64 => "int64_t*",
        [*]const bool => "const bool*",
        [*]const usize => "const size_t*",
        [*]const isize => "const int*",
        [*]const u8 => "const char*",
        [*]const u16 => "const uint16_t*",
        [*]const u32 => "const uint32_t*",
        [*]const u64 => "const uint64_t*",
        [*]const i8 => "const int8_t*",
        [*]const i16 => "const int16_t*",
        [*]const i32 => "const int32_t*",
        [*]const i64 => "const int64_t*",
        else => null,
    };
}

var buffer = std.ArrayList(u8).init(std.heap.c_allocator);
var writer = buffer.writer();
var impl_buffer = std.ArrayList(u8).init(std.heap.c_allocator);
var impl_writer = impl_buffer.writer();
var bufset = std.BufSet.init(std.heap.c_allocator);
var type_names = TypeNameMap.init(std.heap.c_allocator);
var size_map = std.StringHashMap(u32).init(std.heap.c_allocator);

pub const C_Generator = struct {
    filebase: []const u8,

    direction: Direction = .export_cpp,
    const Self = @This();

    pub const Direction = enum {
        export_cpp,
        export_zig,
    };

    pub fn init(comptime src_file: []const u8, comptime Writer: type, file: Writer) Self {
        var res = Self{ .filebase = src_file };

        return res;
    }

    pub fn deinit(self: *const Self) void {
        // self.file.writeAll("\n/**** </") catch unreachable;
        // self.file.writeAll(self.filebase) catch unreachable;
        // self.file.writeAll("> ****/\n\n") catch unreachable;
    }

    pub fn gen_func(
        self: *Self,
        comptime name: []const u8,
        comptime func: FnDecl,
        comptime meta: FnMeta,
        comptime arg_names: []const []const u8,
    ) void {
        switch (meta.calling_convention) {
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

        self.writeType(func.return_type);
        self.write(" " ++ name ++ "(");

        inline for (meta.args) |arg, i| {
            const ArgType = arg.arg_type.?;

            switch (@typeInfo(ArgType)) {
                .Fn => {
                    self.gen_closure(comptime arg.arg_type.?, comptime std.fmt.comptimePrint(" ArgFn{d}", .{i}));
                },
                else => {
                    self.writeType(arg.arg_type.?);
                    switch (@typeInfo(ArgType)) {
                        .Enum => {
                            self.write(comptime std.fmt.comptimePrint(" {s}{d}", .{ @typeName(ArgType), i }));
                        },

                        else => {
                            self.write(comptime std.fmt.comptimePrint(" arg{d}", .{i}));
                        },
                    }
                },
            }

            // if (comptime func.arg_names.len > 0 and func.arg_names.len > i) {
            //     self.write(comptime arg_names[i]);
            // } else {

            //TODO: Figure out how to get arg names; for now just do arg0..argN
            if (i != meta.args.len - 1)
                self.write(", ");
        }

        self.write(")");
        defer self.write(";\n");
        // const ReturnTypeInfo: std.builtin.TypeInfo = comptime @typeInfo(func.return_type);
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
        const func: std.builtin.TypeInfo.Fn = @typeInfo(Function).Fn;
        self.writeType(func.return_type orelse void);
        self.write(" (*" ++ name ++ ")(");
        inline for (func.args) |arg, i| {
            self.writeType(arg.arg_type.?);
            // if (comptime func.arg_names.len > 0 and func.arg_names.len > i) {
            //     self.write(comptime arg_names[i]);
            // } else {
            const ArgType = arg.arg_type.?;
            if (@typeInfo(ArgType) == .Enum) {
                self.write(comptime std.fmt.comptimePrint(" {s}{d}", .{ @typeName(ArgType), i }));
            } else {
                self.write(comptime std.fmt.comptimePrint(" arg{d}", .{i}));
            }
            // }

            //TODO: Figure out how to get arg names; for now just do arg0..argN
            if (i != func.args.len - 1)
                self.write(", ");
        }

        self.write(")");
        // const ReturnTypeInfo: std.builtin.TypeInfo = comptime @typeInfo(func.return_type);
        // switch (comptime ReturnTypeInfo) {
        //     .Pointer => |Pointer| {
        //         self.write(" __attribute__((returns_nonnull))");
        //     },
        //     .Optional => |Optional| {},
        //     else => {},
        // }
    }

    pub fn gen_struct(self: *Self, comptime name: []const u8, comptime meta: StructMeta) void {
        self.write("typedef struct ");

        if (meta.layout == .Packed)
            self.write("__attribute__((__packed__)) ");

        self.write(name ++ " {\n");

        inline for (meta.fields) |field| {
            self.write("   ");

            const info = @typeInfo(field.field_type);

            if (info == .Array) {
                self.writeType(info.Array.child);
            } else {
                self.writeType(field.field_type);
            }

            self.write(" " ++ field.name);

            if (info == .Array) {
                writer.print("[{}]", .{info.Array.len}) catch unreachable;
            }

            self.write(";\n");
        }
        self.write("} " ++ name ++ "_t;\n\n");
    }

    pub fn gen_enum(
        self: *Self,
        comptime name: []const u8,
        comptime meta: EnumMeta,
    ) void {
        self.write("enum " ++ name ++ " {\n");

        comptime var last = 0;
        inline for (meta.fields) |field, i| {
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
        self: *Self,
        comptime name: []const u8,
        comptime meta: UnionMeta,
    ) void {
        self.write("typedef union ");

        self.write(name ++ " {\n");

        inline for (meta.fields) |field| {
            self.write("   ");
            self.writeType(field.field_type);
            self.write(" " ++ field.name ++ ";\n");
        }
        self.write("} " ++ name ++ "_t;\n\n");
    }

    fn writeType(
        self: *Self,
        comptime T: type,
    ) void {
        const TT = comptime if (@typeInfo(T) == .Pointer and !std.meta.trait.isManyItemPtr(T)) @typeInfo(T).Pointer.child else T;

        if (comptime (isCppObject(TT)) and @hasDecl(TT, "name")) {
            if (@typeInfo(T) == .Pointer or @hasDecl(TT, "Type") and @typeInfo(TT.Type) == .Pointer) {
                if (@hasDecl(TT, "is_pointer") and !TT.is_pointer) {} else if (@typeInfo(T).Pointer.is_const) {
                    write(self, "const ");
                }
            }

            const _formatted_name = comptime brk: {
                var original: [TT.name.len]u8 = undefined;
                _ = std.mem.replace(u8, TT.name, ":", "_", &original);
                break :brk original;
            };
            const formatted_name = comptime std.mem.span(&_formatted_name);

            if (@hasDecl(TT, "is_pointer") and !TT.is_pointer) {
                if (cTypeLabel(TT.Type)) |label| {
                    type_names.put(comptime label, formatted_name) catch unreachable;
                    if (@typeInfo(TT) == .Struct and @hasField(TT, "bytes")) {
                        size_map.put(comptime formatted_name, @as(u32, TT.shim.byte_size)) catch unreachable;
                    }
                } else {
                    type_names.put(comptime TT.name, formatted_name) catch unreachable;
                    if (@typeInfo(TT) == .Struct and @hasField(TT, "bytes")) {
                        size_map.put(comptime formatted_name, @as(u32, TT.shim.byte_size)) catch unreachable;
                    }
                }
            } else {
                type_names.put(comptime TT.name, formatted_name) catch unreachable;
                if (@typeInfo(TT) == .Struct and @hasField(TT, "bytes")) {
                    size_map.put(comptime formatted_name, @as(u32, TT.shim.byte_size)) catch unreachable;
                }
            }

            if (TT == T and @hasField(T, "bytes")) {
                write(self, comptime "b" ++ formatted_name);
            } else {
                write(self, comptime formatted_name);
            }

            if (@typeInfo(T) == .Pointer or @hasDecl(TT, "Type") and @typeInfo(TT.Type) == .Pointer) {
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
                    const childmeta = @typeInfo(child);
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
                    return self.write(@typeName(T));
                },
            }
        }
    }

    fn write(self: *Self, comptime str: []const u8) void {
        _ = writer.write(str) catch {};
    }
};

const builtin = std.builtin;
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
    if (!std.meta.trait.isContainer(T) or (std.meta.trait.isSingleItemPtr(T) and !std.meta.trait.isContainer(std.meta.Child(T)))) {
        return null;
    }

    inline for (std.meta.declarations(T)) |decl| {
        if (std.mem.eql(u8, decl.name, "Type")) {
            switch (decl.data) {
                .Type => {
                    return NamedStruct{ .Type = T, .name = @typeName(T) };
                },
                else => {},
            }
        }
    }

    return null;
}

pub fn HeaderGen(comptime import: type, comptime fname: []const u8) type {
    const all_decls = std.meta.declarations(import);

    return struct {
        source_file: []const u8 = fname,
        gen: C_Generator = undefined,

        const Self = @This();

        pub fn init() Self {
            return Self{};
        }

        pub fn startFile(
            comptime self: Self,
            comptime Type: type,
            comptime prefix: []const u8,
            file: anytype,
            other: std.fs.File,
        ) void {
            if (comptime std.meta.trait.hasDecls(Type, .{"include"})) {
                comptime var new_name = std.mem.zeroes([Type.include.len]u8);

                comptime {
                    _ = std.mem.replace(u8, Type.include, "/", "_", std.mem.span(&new_name));
                    _ = std.mem.replace(u8, &new_name, ".", "_", std.mem.span(&new_name));
                    _ = std.mem.replace(u8, &new_name, "<", "_", std.mem.span(&new_name));
                    _ = std.mem.replace(u8, &new_name, ">", "_", std.mem.span(&new_name));
                    _ = std.mem.replace(u8, &new_name, "\"", "_", std.mem.span(&new_name));
                }
                file.writeAll("\n#pragma mark - " ++ Type.name ++ "\n\n") catch unreachable;

                if (@hasDecl(Type, "include")) {
                    other.writer().print(
                        \\
                        \\#ifndef INCLUDED_{s}
                        \\#define INCLUDED_{s}
                        \\#include {s}
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

        pub fn processStaticExport(comptime self: Self, file: anytype, gen: *C_Generator, comptime static_export: StaticExport) void {
            const fn_meta = comptime @typeInfo(static_export.Type).Fn;
            gen.gen_func(
                comptime static_export.symbol_name,
                comptime static_export.Decl().data.Fn,
                comptime fn_meta,
                comptime std.mem.zeroes([]const []const u8),
            );
        }

        pub fn processDecl(
            comptime self: Self,
            file: anytype,
            gen: *C_Generator,
            comptime Container: type,
            comptime Decl: std.builtin.TypeInfo.Declaration,
            comptime name: []const u8,
            comptime prefix: []const u8,
        ) void {
            switch (comptime Decl.data) {
                .Type => |Type| {
                    switch (@typeInfo(Type)) {
                        .Enum => |Enum| {
                            const layout = Enum.layout;
                            gen.gen_enum(
                                prefix ++ "__" ++ name,
                                Enum,
                            );
                        },
                        .Struct => |Struct| {
                            gen.gen_struct(decl.name, Struct, file);
                        },
                        .Union => |Union| {
                            const layout = Union.layout;
                            gen.gen_union(
                                prefix ++ "__" ++ name,
                                Union,
                            );
                        },
                        .Fn => |func| {
                            // if (func.) {
                            const fn_meta = @typeInfo(func.name).Fn;
                            // blocked by https://github.com/ziglang/zig/issues/8259
                            gen.gen_func(
                                prefix ++ "__" ++ name,
                                func,
                                fn_meta,
                                &.{},
                            );
                        },
                        else => {},
                    }
                },
                .Fn => |func| {
                    // if (func.) {
                    const fn_meta = @typeInfo(func.fn_type).Fn;
                    // blocked by https://github.com/ziglang/zig/issues/8259
                    gen.gen_func(
                        prefix ++ "__" ++ name,
                        func,
                        fn_meta,
                        &.{},
                    );
                },
                else => {},
            }
        }

        pub fn exec(comptime self: Self, file: std.fs.File, impl: std.fs.File) void {
            const Generator = C_Generator;
            validateGenerator(Generator);
            var file_writer = file.writer();
            file_writer.print("//-- AUTOGENERATED FILE -- {d}\n", .{std.time.timestamp()}) catch unreachable;
            file.writeAll(
                \\#pragma once
                \\
                \\#include <stddef.h>
                \\#include <stdint.h>
                \\#include <stdbool.h>
                \\
                \\#ifdef __cplusplus
                \\  #define AUTO_EXTERN_C extern "C"
                \\#else
                \\  #define AUTO_EXTERN_C
                \\#endif
                \\#define ZIG_DECL AUTO_EXTERN_C
                \\#define CPP_DECL AUTO_EXTERN_C
                \\#define CPP_SIZE AUTO_EXTERN_C
                \\
                \\
            ) catch {};

            impl.writer().print("//-- AUTOGENERATED FILE -- {d}\n", .{std.time.timestamp()}) catch unreachable;
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

            var to_get_sizes: usize = 0;
            inline for (all_decls) |_decls| {
                if (comptime _decls.is_pub) {
                    switch (_decls.data) {
                        .Type => |Type| {
                            @setEvalBranchQuota(99999);

                            if (@hasDecl(Type, "Extern") or @hasDecl(Type, "Export")) {
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
                                        if (to_get_sizes > 0) {
                                            impl_second_writer.writeAll(", ") catch unreachable;
                                            impl_third_writer.writeAll(", ") catch unreachable;
                                            impl_fourth_writer.writeAll(", ") catch unreachable;
                                        }

                                        const formatted_name = comptime brk: {
                                            var original: [Type.name.len]u8 = undefined;
                                            _ = std.mem.replace(u8, Type.name, ":", "_", &original);
                                            break :brk original;
                                        };

                                        impl_third_writer.print("sizeof({s})", .{comptime Type.name}) catch unreachable;
                                        impl_fourth_writer.print("alignof({s})", .{comptime Type.name}) catch unreachable;
                                        impl_second_writer.print("\"{s}\"", .{formatted_name}) catch unreachable;
                                        to_get_sizes += 1;
                                        const ExternList = comptime brk: {
                                            const Sorder = struct {
                                                pub fn lessThan(context: @This(), lhs: []const u8, rhs: []const u8) bool {
                                                    return std.ascii.orderIgnoreCase(lhs, rhs) == std.math.Order.lt;
                                                }
                                            };
                                            var extern_list = Type.Extern;
                                            std.sort.sort([]const u8, &extern_list, Sorder{}, Sorder.lessThan);
                                            break :brk extern_list;
                                        };
                                        // impl_writer.print("  #include {s}\n", .{Type.include}) catch unreachable;
                                        inline for (&ExternList) |extern_decl| {
                                            if (@hasDecl(Type, extern_decl)) {
                                                const normalized_name = comptime brk: {
                                                    var _normalized_name: [Type.name.len]u8 = undefined;
                                                    _ = std.mem.replace(u8, Type.name, ":", "_", std.mem.span(&_normalized_name));
                                                    break :brk _normalized_name;
                                                };

                                                processDecl(
                                                    self,
                                                    writer,
                                                    &gen,
                                                    Type,
                                                    comptime std.meta.declarationInfo(Type, extern_decl),
                                                    comptime extern_decl,
                                                    comptime std.mem.span(&normalized_name),
                                                );
                                            }
                                        }
                                    }

                                    if (@hasDecl(Type, "Export")) {
                                        const ExportLIst = comptime brk: {
                                            const Sorder = struct {
                                                pub fn lessThan(context: @This(), comptime lhs: StaticExport, comptime rhs: StaticExport) bool {
                                                    return std.ascii.orderIgnoreCase(lhs.symbol_name, rhs.symbol_name) == std.math.Order.lt;
                                                }
                                            };
                                            var extern_list = Type.Export;
                                            std.sort.sort(StaticExport, &extern_list, Sorder{}, Sorder.lessThan);
                                            break :brk extern_list;
                                        };

                                        gen.direction = C_Generator.Direction.export_zig;
                                        inline for (ExportLIst) |static_export| {
                                            processStaticExport(
                                                self,
                                                file,
                                                &gen,
                                                comptime static_export,
                                            );
                                        }
                                    }
                                }
                            }
                        },
                        else => {},
                    }
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

            const NamespaceMap = std.StringArrayHashMap(std.BufMap);
            var namespaces = NamespaceMap.init(std.heap.c_allocator);

            file_writer.writeAll("\n#ifndef __cplusplus\n") catch unreachable;
            while (iter.next()) |entry| {
                const key = entry.key_ptr.*;
                const value = entry.value_ptr.*;
                if (std.mem.indexOfScalar(u8, entry.key_ptr.*, ':')) |namespace_start| {
                    const namespace = entry.key_ptr.*[0..namespace_start];
                    file_writer.print(" typedef struct {s} {s}; // {s}\n", .{
                        value,
                        value,
                        key,
                    }) catch unreachable;
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
            var size_iter = size_map.iterator();
            while (size_iter.next()) |size| {
                file_writer.print(" typedef struct b{s} {{ char bytes[{d}]; }} b{s};\n", .{
                    size.key_ptr.*,
                    size.value_ptr.*,
                    size.key_ptr.*,
                }) catch unreachable;
            }

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
