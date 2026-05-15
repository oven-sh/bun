const RefCountedStr = @This();

refcount: u32 = 1,
len: u32 = 0,
ptr: [*]const u8 = undefined,

const debug = bun.Output.scoped(.RefCountedEnvStr, .hidden);

pub fn init(slice: []const u8) *RefCountedStr {
    debug("init: {s}", .{slice});
    const this = bun.handleOom(bun.default_allocator.create(RefCountedStr));
    this.* = .{
        .refcount = 1,
        .len = @intCast(slice.len),
        .ptr = slice.ptr,
    };
    return this;
}

pub fn byteSlice(this: *RefCountedStr) []const u8 {
    if (this.len == 0) return "";
    return this.ptr[0..this.len];
}

pub fn ref(this: *RefCountedStr) void {
    this.refcount += 1;
}

pub fn deref(this: *RefCountedStr) void {
    this.refcount -= 1;
    if (this.refcount == 0) {
        this.deinit();
    }
}

fn deinit(this: *RefCountedStr) void {
    debug("deinit: {s}", .{this.byteSlice()});
    this.freeStr();
    bun.default_allocator.destroy(this);
}

fn freeStr(this: *RefCountedStr) void {
    if (this.len == 0) return;
    bun.default_allocator.free(this.ptr[0..this.len]);
}

const bun = @import("bun");
