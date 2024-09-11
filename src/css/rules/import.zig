const std = @import("std");
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const MediaList = css.MediaList;
const CustomMedia = css.CustomMedia;
const Printer = css.Printer;
const Maybe = css.Maybe;
const PrinterError = css.PrinterError;
const PrintErr = css.PrintErr;
const Dependency = css.Dependency;
const dependencies = css.dependencies;
const Url = css.css_values.url.Url;
const Size2D = css.css_values.size.Size2D;
const fontprops = css.css_properties.font;
const LayerName = css.css_rules.layer.LayerName;
const SupportsCondition = css.css_rules.supports.SupportsCondition;
const Location = css.css_rules.Location;

/// A [@import](https://drafts.csswg.org/css-cascade/#at-import) rule.
pub const ImportRule = struct {
    /// The url to import.
    url: []const u8,

    /// An optional cascade layer name, or `None` for an anonymous layer.
    layer: ?struct {
        /// PERF: null pointer optimizaiton, nullable
        v: ?LayerName,
    },

    /// An optional `supports()` condition.
    supports: ?SupportsCondition,

    /// A media query.
    media: css.MediaList,

    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const dep = if (dest.dependencies != null) dependencies.ImportDependency.new(
            dest.allocator,
            dest.filename(),
        ) else null;

        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        try dest.writeStr("@import ");
        if (dep) |d| {
            try css.serializer.serializeString(dep.placeholder, W, dest);

            if (dest.dependencies) |*deps| {
                deps.append(
                    dest.allocator,
                    Dependency{ .import = d },
                ) catch unreachable;
            }
        } else {
            try css.serializer.serializeString(this.url, W, dest);
        }

        if (this.layer) |*lyr| {
            try dest.writeStr(" layer");
            if (lyr.v) |l| {
                try dest.writeChar('(');
                try l.toCss(W, dest);
                try dest.writeChar(')');
            }
        }

        if (this.supports) |*sup| {
            try dest.writeStr(" supports");
            if (sup.* == .declaration) {
                try sup.toCss(W, dest);
            } else {
                try dest.writeChar('(');
                try sup.toCss(W, dest);
                try dest.writeChar(')');
            }
        }

        if (this.media.media_queries.items.len > 0) {
            try dest.writeChar(' ');
            try this.media.toCss(W, dest);
        }
        try dest.writeStr(";");
    }
};
