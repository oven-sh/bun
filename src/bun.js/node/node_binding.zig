const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;

pub const KeepAlive = jsc.Codegen.JSKeepAlive.getConstructor;
