const std = @import("std");
const Dir = std.fs.Dir;
const FnMeta = std.builtin.TypeInfo.Fn;
const FnDecl = std.builtin.TypeInfo.Declaration.Data.FnDecl;
const StructMeta = std.builtin.TypeInfo.Struct;
const EnumMeta = std.builtin.TypeInfo.Enum;
const UnionMeta = std.builtin.TypeInfo.Union;
const warn = std.debug.warn;

pub const C_Generator = struct {
    file: std.fs.File,
    filebase: []const u8,
    const Self = @This();

    pub fn init(comptime src_file: []const u8, file: std.fs.File) Self {
        var res = Self{ .file = file, .filebase = src_file };

        file.writeAll("\n/**** " ++ src_file ++ " /*****/\n\n") catch unreachable;
        return res;
    }

    pub fn deinit(self: *Self) void {
        self.file.writeAll("\n/***** ") catch unreachable;
        self.file.writeAll(self.filebase) catch unreachable;
        self.file.writeAll(" *****/") catch unreachable;
    }

    pub fn gen_func(self: *Self, comptime name: []const u8, comptime func: FnDecl, comptime meta: FnMeta, comptime arg_names: []const []const u8) void {
        switch (meta.calling_convention) {
            .Naked => self.write("__attribute__((naked)) "),
            .Stdcall => self.write("__attribute__((stdcall)) "),
            .Fastcall => self.write("__attribute__((fastcall)) "),
            .Thiscall => self.write("__attribute__((thiscall)) "),
            else => {},
        }

        self.write("extern \"C\" ");
        self.writeType(func.return_type);
        self.write(" " ++ name ++ "(");

        inline for (meta.args) |arg, i| {
            self.writeType(arg.arg_type.?);
            if (func.arg_names.len > i) {
                self.write(comptime arg_names[i]);
            } else {
                self.write(comptime std.fmt.comptimePrint(" arg{d}", .{i}));
            }

            //TODO: Figure out how to get arg names; for now just do arg0..argN
            if (i != meta.args.len - 1)
                self.write(", ");
        }

        self.write(");\n");
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
        const TT = if (@typeInfo(T) == .Pointer) @typeInfo(T).Pointer.child else T;

        if (comptime std.meta.trait.hasDecls(TT, .{"C"}) and std.meta.trait.hasDecls(TT.C, .{"name"})) {
            writeType(self, TT.C);
            if (std.meta.trait.isSingleItemPtr(T)) {
                write(self, "*");
            }
            return;
        }

        if (comptime std.meta.trait.hasDecls(TT, .{"name"})) {
            self.write(comptime T.name);
            if (std.meta.trait.isSingleItemPtr(T)) {
                write(self, "*");
            }
            return;
        }

        switch (T) {
            void => self.write("void"),
            bool => self.write("bool"),
            usize => self.write("size_t"),
            isize => self.write("int"),
            u8 => self.write("uint8_t"),
            u16 => self.write("uint16_t"),
            u32 => self.write("uint32_t"),
            u64 => self.write("uint64_t"),
            i8 => self.write("int8_t"),
            i16 => self.write("int16_t"),
            i24 => self.write("int24_t"),
            i32 => self.write("int32_t"),
            i64 => self.write("int64_t"),
            [*]bool => self.write("bool*"),
            [*]usize => self.write("size_t*"),
            [*]isize => self.write("int*"),
            [*]u8 => self.write("uint8_t*"),
            [*]u16 => self.write("uint16_t*"),
            [*]u32 => self.write("uint32_t*"),
            [*]u64 => self.write("uint64_t*"),
            [*]i8 => self.write("int8_t*"),
            [*]i16 => self.write("int16_t*"),
            [*]i32 => self.write("int32_t*"),
            [*]i64 => self.write("int64_t*"),
            else => {
                const meta = @typeInfo(T);
                switch (meta) {
                    .Pointer => {
                        const child = meta.Pointer.child;
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
                    else => self.write(@typeName(T) ++ "_t"),
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
        if (std.mem.eql(u8, decl.name, "C")) {
            switch (decl.data) {
                .Type => |TT| {
                    return NamedStruct{ .Type = TT, .name = @typeName(T) };
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

        const Self = @This();

        pub fn init() Self {
            return Self{};
        }

        pub fn processDecls(
            comptime self: Self,
            file: std.fs.File,
            comptime Parent: type,
            comptime Type: type,
            comptime prefix: []const u8,
        ) void {
            const decls = std.meta.declarations(Type);
            var gen = C_Generator.init(prefix, file);
            defer gen.deinit();

            if (comptime std.meta.trait.hasDecls(Type, .{"include"})) {
                comptime var new_name = std.mem.zeroes([Type.include.len]u8);

                comptime {
                    _ = std.mem.replace(u8, Type.include, "/", "_", std.mem.span(&new_name));
                    _ = std.mem.replace(u8, &new_name, ".", "_", std.mem.span(&new_name));
                }
                const inner_name = comptime std.mem.trim(u8, &new_name, "<>\"");
                file.writeAll("#ifndef BINDINGS__decls__" ++ inner_name ++ "\n") catch {};
                file.writeAll("#define BINDINGS__decls__" ++ inner_name ++ "\n") catch {};
                file.writeAll("#include " ++ Type.include ++ "\n") catch {};
                file.writeAll("namespace Wundle {\n class " ++ prefix ++ ";\n}\n") catch {};
                file.writeAll("#endif\n\n") catch {};
            }

            // iterate exported enums
            // do this first in case target lang needs enums defined before use
            inline for (decls) |decl| {
                if (decl.is_pub and decl.data == .Type and comptime std.ascii.isUpper(decl.name[0])) {
                    const T = decl.data.Type;
                    const info = @typeInfo(T);
                    if (info == .Enum and decl.is_pub) {
                        const layout = info.Enum.layout;
                        gen.gen_enum(prefix ++ "__" ++ decl.name, info.Enum);
                    }
                }
            }

            // iterate exported structs
            inline for (decls) |decl| {
                if (decl.is_pub and decl.data == .Type and decl.is_pub and comptime std.ascii.isUpper(decl.name[0])) {
                    const T = decl.data.Type;
                    const info = @typeInfo(T);
                    if (info == .Struct and decl.is_pub) {
                        gen.gen_struct(decl.name, @typeInfo(T).Struct);
                    }
                }
            }

            inline for (decls) |decl| {
                if (decl.is_pub and decl.data == .Type and decl.is_pub) {
                    const T = decl.data.Type;
                    const info = @typeInfo(T);
                    if (info == .Union and comptime std.ascii.isUpper(decl.name[0])) {
                        const layout = info.Union.layout;
                        gen.gen_union(prefix ++ "__" ++ decl.name, info.Union);
                    }
                }
            }

            // iterate exported fns
            inline for (decls) |decl, decl_i| {
                if (decl.is_pub and decl.data == .Fn and decl.is_pub) {
                    const func = decl.data.Fn;
                    // if (func.) {
                    const fn_meta = @typeInfo(func.fn_type).Fn;
                    const info = @typeInfo(Type);
                    const struct_decl = info.Struct.decls[decl_i];
                    // blocked by https://github.com/ziglang/zig/issues/8259
                    gen.gen_func(
                        prefix ++ "__" ++ decl.name,
                        func,
                        fn_meta,
                        struct_decl.data.Fn.arg_names,
                    );
                    // }
                }
            }
        }

        pub fn exec(comptime self: Self, file: std.fs.File) void {
            const Generator = C_Generator;
            validateGenerator(Generator);

            file.writeAll("#pragma once\n#include <stddef.h>\n#include <stdint.h>\n#include <stdbool.h>\n\n") catch {};

            inline for (all_decls) |_decls| {
                if (comptime _decls.is_pub) {
                    switch (_decls.data) {
                        .Type => |Type| {
                            if (getCStruct(Type)) |CStruct| {
                                processDecls(
                                    self,
                                    file,
                                    Type,
                                    CStruct.Type,
                                    CStruct.name,
                                );
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
