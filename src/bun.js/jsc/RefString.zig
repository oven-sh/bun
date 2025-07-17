//! expensive heap reference-counted string type
//! only use this for big strings
//! like source code
//! not little ones
const RefString = @This();

ptr: [*]const u8 = undefined,
len: usize = 0,
hash: Hash = 0,
impl: bun.WTF.StringImpl,

allocator: std.mem.Allocator,

ctx: ?*anyopaque = null,
onBeforeDeinit: ?*const Callback = null,

pub const Hash = u32;
pub const Map = std.HashMap(Hash, *RefString, bun.IdentityContext(Hash), 80);

pub fn toJS(this: *RefString, global: *jsc.JSGlobalObject) jsc.JSValue {
    return bun.String.init(this.impl).toJS(global);
}

pub const Callback = fn (ctx: *anyopaque, str: *RefString) void;

pub fn computeHash(input: []const u8) u32 {
    return std.hash.XxHash32.hash(0, input);
}

pub fn slice(this: *RefString) []const u8 {
    this.ref();

    return this.leak();
}

pub fn ref(this: *RefString) void {
    this.impl.ref();
}

pub fn leak(this: RefString) []const u8 {
    @setRuntimeSafety(false);
    return this.ptr[0..this.len];
}

pub fn deref(this: *RefString) void {
    this.impl.deref();
}

pub fn deinit(this: *RefString) void {
    if (this.onBeforeDeinit) |onBeforeDeinit| {
        onBeforeDeinit(this.ctx.?, this);
    }

    this.allocator.free(this.leak());
    this.allocator.destroy(this);
}

const bun = @import("bun");
const jsc = bun.jsc;
const std = @import("std");
