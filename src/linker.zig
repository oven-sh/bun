const std = @import("std");
const fs = @import("fs.zig");
usingnamespace @import("ast/base.zig");

pub const Linker = struct {
    // fs: fs.FileSystem,
    // TODO:
    pub fn requireOrImportMetaForSource(c: Linker, source_index: Ref.Int) RequireOrImportMeta {
        return RequireOrImportMeta{};
    }

    // This modifies the Ast in-place!
    // But more importantly, this does the following:
    // - Wrap CommonJS files
    pub fn link(allocator: *std.mem.Allocator, ast: *js_ast.Ast) !void {}
};
