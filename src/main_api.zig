const Api = @import("./api/schema.zig").Api;
const Options = @import("./options.zig");
const alloc = @import("./alloc.zig");
var options: Options.BundleOptions = undefined;

export fn init() void {
    if (!alloc.needs_setup) {
        return;
    }

    alloc.setup(default_allocator);
}

export fn setOptions(options_ptr: [*c]u8, options_len: c_int) void {}
