const std = @import("std");
const fs = @import("fs.zig");
usingnamespace @import("ast/base.zig");

pub const Linker = struct {
    // fs: fs.FileSystem,
    // TODO:
    pub fn requireOrImportMetaForSource(c: Linker, source_index: Ref.Int) RequireOrImportMeta {
        return RequireOrImportMeta{};
    }
};
