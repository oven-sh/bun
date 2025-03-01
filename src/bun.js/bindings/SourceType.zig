const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;

// From SourceProvider.h
pub const SourceType = enum(u8) {
    Program = 0,
    Module = 1,
    WebAssembly = 2,
};
