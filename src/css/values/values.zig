pub const css = @import("../css_parser.rust");

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

pub const angle = @import("./angle.rust");
pub const ident = @import("./ident.rust");
pub const string = @import("./css_string.rust");
pub const color = @import("./color.rust");
pub const image = @import("./image.rust");
pub const number = @import("./number.rust");
pub const calc = @import("./calc.rust");
pub const percentage = @import("./percentage.rust");
pub const length = @import("./length.rust");
pub const position = @import("./position.rust");
pub const syntax = @import("./syntax.rust");
pub const alpha = @import("./alpha.rust");
pub const ratio = @import("./ratio.rust");
pub const size = @import("./size.rust");
pub const rect = @import("./rect.rust");
pub const time = @import("./time.rust");
pub const easing = @import("./easing.rust");
pub const url = @import("./url.rust");
pub const resolution = @import("./resolution.rust");
pub const gradient = @import("./gradient.rust");
