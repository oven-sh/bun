pub const css = @import("../css_parser.zig");

pub const css_modules = struct {
    /// Defines where the class names referenced in the `composes` property are located.
    ///
    /// See [Composes](Composes).
    pub const Specifier = union(enum) {
        /// The referenced name is global.
        global,
        /// The referenced name comes from the specified file.
        file: []const u8,
        /// The referenced name comes from a source index (used during bundling).
        source_index: u32,
    };
};

pub const angle = @import("./angle.zig");
pub const ident = @import("./ident.zig");
pub const string = @import("./css_string.zig");
pub const color = @import("./color.zig");
pub const image = @import("./image.zig");
pub const number = @import("./number.zig");
pub const calc = @import("./calc.zig");
pub const percentage = @import("./percentage.zig");
pub const length = @import("./length.zig");
pub const position = @import("./position.zig");
pub const syntax = @import("./syntax.zig");
pub const alpha = @import("./alpha.zig");
pub const ratio = @import("./ratio.zig");
pub const size = @import("./size.zig");
pub const rect = @import("./rect.zig");
pub const time = @import("./time.zig");
pub const easing = @import("./easing.zig");
pub const url = @import("./url.zig");
pub const resolution = @import("./resolution.zig");
pub const gradient = @import("./gradient.zig");
