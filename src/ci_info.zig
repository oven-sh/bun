// A modified port of ci-info@4.0.0 (https://github.com/watson/ci-info)
// Only gets the CI name, `isPR` is not implemented.
// Main implementation is in src/codegen/ci_info.ts

var once = bun.once(detectUncached);
pub fn detectCI() ?[]const u8 {
    return once.call(.{});
}

fn detectUncached() ?[]const u8 {
    if (bun.env_var.CI.get() == false) return null;
    return detectUncachedGenerated();
}

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
const detectUncachedGenerated = @import("ci_info").detectUncachedGenerated;
