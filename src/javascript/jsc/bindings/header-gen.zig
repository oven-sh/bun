const std = @import("std");
const Dir = std.fs.Dir;
const FnMeta = std.builtin.TypeInfo.Fn;
const FnDecl = std.builtin.TypeInfo.Declaration.Data.FnDecl;
const StructMeta = std.builtin.TypeInfo.Struct;
const EnumMeta = std.builtin.TypeInfo.Enum;
const UnionMeta = std.builtin.TypeInfo.Union;
const warn = std.debug.warn;

fn isCppObject(comptime Type: type) bool {
    return switch (@typeInfo(Type)) {
        .Struct, .Union, .Opaque => true,
        else => false,
    };
}

pub const C_Generator = struct {
    file: std.fs.File,
    filebase: []const u8,

    direction: Direction = .export_cpp,
    const Self = @This();

    pub const Direction = enum {
        export_cpp,
        export_zig,
    };

    pub fn init(comptime src_file: []const u8, file: std.fs.File) Self {
        var res = Self{ .file = file, .filebase = src_file };

        return res;
    }

    pub fn deinit(self: *const Self) void {
        // self.file.writeAll("\n/**** </") catch unreachable;
        // self.file.writeAll(self.filebase) catch unreachable;
        // self.file.writeAll("> ****/\n\n") catch unreachable;
    }

    pub fn gen_func(self: *Self, comptime name: []const u8, comptime func: FnDecl, comptime meta: FnMeta, comptime arg_names: []const []const u8) void {
        switch (meta.calling_convention) {
            .Naked => self.write("__attribute__((naked)) "),
            .Stdcall => self.write("__attribute__((stdcall)) "),
            .Fastcall => self.write("__attribute__((fastcall)) "),
            .Thiscall => self.write("__attribute__((thiscall)) "),
            else => {},
        }

        switch (self.direction) {
            .export_cpp => self.write("CPP_DECL \"C\" "),
            .export_zig => self.write("ZIG_DECL \"C\" "),
        }

        self.writeType(func.return_type);
        self.write(" " ++ name ++ "(");

        inline for (meta.args) |arg, i| {
            self.writeType(arg.arg_type.?);
            if (func.arg_names.len > i) {
                self.write(comptime arg_names[i]);
            } else {
                const ArgType = arg.arg_type.?;
                if (@typeInfo(ArgType) == .Enum) {
                    self.write(comptime std.fmt.comptimePrint(" {s}{d}", .{ @typeName(ArgType), i }));
                } else {
                    self.write(comptime std.fmt.comptimePrint(" arg{d}", .{i}));
                }
            }

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
                _ = self.file.writer().print("[{}]", .{info.Array.len}) catch unreachable;
            }

            self.write(";\n");
        }
        self.write("} " ++ name ++ "_t;\n\n");
    }

    pub fn gen_enum(self: *Self, comptime name: []const u8, comptime meta: EnumMeta) void {
        self.write("enum " ++ name ++ " {\n");

        comptime var last = 0;
        inline for (meta.fields) |field, i| {
            self.write("    " ++ field.name);

            // if field value is unexpected/custom, manually define it
            if ((i == 0 and field.value != 0) or (i > 0 and field.value > last + 1)) {
                _ = self.file.writer().print(" = {}", .{field.value}) catch unreachable;
            }

            self.write(",\n");

            last = field.value;
        }

        self.write("};\n\n");
    }

    pub fn gen_union(self: *Self, comptime name: []const u8, comptime meta: UnionMeta) void {
        self.write("typedef union ");

        self.write(name ++ " {\n");

        inline for (meta.fields) |field| {
            self.write("   ");
            self.writeType(field.field_type);
            self.write(" " ++ field.name ++ ";\n");
        }
        self.write("} " ++ name ++ "_t;\n\n");
    }

    fn writeType(self: *Self, comptime T: type) void {
        const TT = comptime if (@typeInfo(T) == .Pointer) @typeInfo(T).Pointer.child else T;

        if (comptime (isCppObject(TT)) and @hasDecl(TT, "name")) {
            if (@typeInfo(T) == .Pointer or @hasDecl(TT, "Type") and @typeInfo(TT.Type) == .Pointer) {
                if (@hasDecl(TT, "is_pointer") and !TT.is_pointer) {} else if (@typeInfo(T).Pointer.is_const) {
                    write(self, "const ");
                }
            }

            self.write(comptime TT.name);
            if (@typeInfo(T) == .Pointer or @hasDecl(TT, "Type") and @typeInfo(TT.Type) == .Pointer) {
                if (@hasDecl(TT, "is_pointer") and !TT.is_pointer) {} else {
                    write(self, "*");
                }
            }
            return;
        }

        switch (T) {
            void => self.write("void"),
            bool => self.write("bool"),
            usize => self.write("size_t"),
            isize => self.write("int"),
            u8 => self.write("char"),
            u16 => self.write("uint16_t"),
            u32 => self.write("uint32_t"),
            u64 => self.write("uint64_t"),
            i8 => self.write("int8_t"),
            i16 => self.write("int16_t"),
            i24 => self.write("int24_t"),
            i32 => self.write("int32_t"),
            i64 => self.write("int64_t"),
            f64 => self.write("double"),
            f32 => self.write("float"),
            *c_void => self.write("void*"),
            [*]bool => self.write("bool*"),
            [*]usize => self.write("size_t*"),
            [*]isize => self.write("int*"),
            [*]u8 => self.write("char*"),
            [*]u16 => self.write("uint16_t*"),
            [*]u32 => self.write("uint32_t*"),
            [*]u64 => self.write("uint64_t*"),
            [*]i8 => self.write("int8_t*"),
            [*]i16 => self.write("int16_t*"),
            [*]i32 => self.write("int32_t*"),
            [*]i64 => self.write("int64_t*"),
            [*]const bool => self.write("const bool*"),
            [*]const usize => self.write("const size_t*"),
            [*]const isize => self.write("const int*"),
            [*]const u8 => self.write("const char*"),
            [*]const u16 => self.write("const uint16_t*"),
            [*]const u32 => self.write("const uint32_t*"),
            [*]const u64 => self.write("const uint64_t*"),
            [*]const i8 => self.write("const int8_t*"),
            [*]const i16 => self.write("const int16_t*"),
            [*]const i32 => self.write("const int32_t*"),
            [*]const i64 => self.write("const int64_t*"),
            else => {
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
            },
        }
    }

    fn write(self: *Self, comptime str: []const u8) void {
        _ = self.file.writeAll(str) catch {};
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

        pub fn startFile(comptime self: Self, comptime Type: type, comptime prefix: []const u8, file: std.fs.File) void {
            if (comptime std.meta.trait.hasDecls(Type, .{"include"})) {
                comptime var new_name = std.mem.zeroes([Type.include.len]u8);

                comptime {
                    _ = std.mem.replace(u8, Type.include, "/", "_", std.mem.span(&new_name));
                    _ = std.mem.replace(u8, &new_name, ".", "_", std.mem.span(&new_name));
                }
                const inner_name = comptime std.mem.trim(u8, &new_name, "<>\"");
                file.writeAll("\n#pragma mark - " ++ Type.name ++ "\n") catch unreachable;
                file.writeAll("\n#ifndef BINDINGS__decls__" ++ inner_name ++ "\n") catch {};
                file.writeAll("#define BINDINGS__decls__" ++ inner_name ++ "\n") catch {};
                file.writeAll("#include " ++ Type.include ++ "\n") catch {};
                file.writeAll("namespace " ++ Type.namespace ++ " {\n class " ++ prefix ++ ";\n}\n") catch {};
                file.writeAll("#endif\n\n") catch {};
            }
        }
        pub fn processDecl(
            comptime self: Self,
            file: std.fs.File,
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
                            gen.gen_enum(prefix ++ "__" ++ name, Enum);
                        },
                        .Struct => |Struct| {
                            gen.gen_struct(decl.name, Struct);
                        },
                        .Union => |Union| {
                            const layout = Union.layout;
                            gen.gen_union(prefix ++ "__" ++ name, Union);
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

        pub fn exec(comptime self: Self, file: std.fs.File) void {
            const Generator = C_Generator;
            validateGenerator(Generator);

            file.writeAll("#pragma once\n#include <stddef.h>\n#include <stdint.h>\n#include <stdbool.h>\n#define ZIG_DECL extern\n#define CPP_DECL extern \n\n") catch {};
            var bufset = std.BufSet.init(std.heap.c_allocator);
            inline for (all_decls) |_decls| {
                if (comptime _decls.is_pub) {
                    switch (_decls.data) {
                        .Type => |Type| {
                            @setEvalBranchQuota(99999);
                            if (@hasDecl(Type, "Extern")) {
                                const identifier = comptime std.fmt.comptimePrint("{s}_{s}", .{ Type.shim.name, Type.shim.namespace });
                                if (!bufset.contains(identifier)) {
                                    self.startFile(Type, Type.shim.name, file);
                                    bufset.insert(identifier) catch unreachable;

                                    var gen = C_Generator.init(Type.name, file);
                                    defer gen.deinit();
                                    inline for (Type.Extern) |extern_decl| {
                                        if (@hasDecl(Type, extern_decl)) {
                                            const normalized_name = comptime brk: {
                                                var _normalized_name: [Type.name.len]u8 = undefined;
                                                _ = std.mem.replace(u8, Type.name, ":", "_", std.mem.span(&_normalized_name));
                                                break :brk _normalized_name;
                                            };

                                            processDecl(
                                                self,
                                                file,
                                                &gen,
                                                Type,
                                                comptime std.meta.declarationInfo(Type, extern_decl),
                                                comptime extern_decl,
                                                comptime std.mem.span(&normalized_name),
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

            // processDecls(
            //     self,
            //     file,
            //     import,
            //     "Bindings",
            // );
        }
    };
}
