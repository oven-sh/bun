pub fn main() u8 {
    @import("./bun_shim_impl.zig").launcher(true, .{});
    return 0;
}
