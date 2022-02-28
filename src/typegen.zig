pub const bindgen = true;

pub fn main() anyerror!void {
    return try @import("javascript/jsc/typescript.zig").main();
}
