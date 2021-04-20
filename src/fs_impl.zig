const std = @import("std");
usingnamespace @import("flags.zig");

pub const FS = comptime {
    if (isWASM) {
        return @import("fs_impl_wasm.zig");
    } else {
        return @import("fs_impl_native.zig");
    }
};
