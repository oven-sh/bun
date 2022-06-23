pub const bindgen = true;

pub fn main() anyerror!void {
    return try @import("bun.js/typescript.zig").main();
}
