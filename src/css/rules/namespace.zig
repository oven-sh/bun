const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("../css_parser.zig");
pub const css_values = @import("../values/values.zig");
pub const Error = css.Error;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

/// A [@namespace](https://drafts.csswg.org/css-namespaces/#declaration) rule.
pub const NamespaceRule = struct {
    /// An optional namespace prefix to declare, or `None` to declare the default namespace.
    prefix: ?css.Ident,
    /// The url of the namespace.
    url: css.CSSString,
    /// The location of the rule in the source file.
    loc: css.Location,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        try dest.writeStr("@namespace ");
        if (this.prefix) |*prefix| {
            try css.css_values.ident.IdentFns.toCss(prefix, W, dest);
            try dest.writeChar(' ');
        }

        try css.css_values.string.CSSStringFns.toCss(&this.url, W, dest);
        try dest.writeChar(':');
    }
};
