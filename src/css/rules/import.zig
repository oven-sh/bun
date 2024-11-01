const std = @import("std");
const bun = @import("root").bun;
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

pub const ImportConditions = struct {
    /// An optional cascade layer name, or `None` for an anonymous layer.
    layer: ?struct {
        /// PERF: null pointer optimizaiton, nullable
        v: ?LayerName,
    },

    /// An optional `supports()` condition.
    supports: ?SupportsCondition,

    /// A media query.
    media: css.MediaList,

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) ImportConditions {
        return ImportConditions{
            .layer = if (this.layer) |*l| if (l.v) |layer| .{ .v = layer.deepClone(allocator) } else .{ .v = null } else null,
            .supports = if (this.supports) |*s| s.deepClone(allocator) else null,
            .media = this.media.deepClone(allocator),
        };
    }

    pub fn layersEql(lhs: *const @This(), rhs: *const @This()) bool {
        if (lhs.layer) |ll| {
            if (rhs.layer) |rl| {
                if (ll.v) |lv| {
                    if (rl.v) |rv| {
                        return lv.eql(&rv);
                    }
                    return false;
                }
                return true;
            }
            return false;
        }
        return false;
    }
};

/// A [@import](https://drafts.csswg.org/css-cascade/#at-import) rule.
pub const ImportRule = struct {
    /// The url to import.
    url: []const u8,

    /// An optional cascade layer name, or `None` for an anonymous layer.
    layer: ?struct {
        /// PERF: null pointer optimizaiton, nullable
        v: ?LayerName,

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }
    },

    /// An optional `supports()` condition.
    supports: ?SupportsCondition,

    /// A media query.
    media: css.MediaList,

    /// This is default initialized to 2^32 - 1 when parsing.
    /// If we are bundling, this will be set to the index of the corresponding ImportRecord
    /// created for this import rule.
    import_record_idx: u32 = std.math.maxInt(u32),

    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn fromUrl(url: []const u8) This {
        return .{
            .url = url,
            .layer = null,
            .supports = null,
            .media = MediaList{ .media_queries = .{} },
            .import_record_idx = std.math.maxInt(u32),
            .loc = Location.dummy(),
        };
    }

    pub fn fromConditionsAndUrl(url: []const u8, conditions: ImportConditions) This {
        return ImportRule{
            .url = url,
            .layer = if (conditions.layer) |layer| if (layer.v) |ly| .{ .v = ly } else .{ .v = null } else null,
            .supports = conditions.supports,
            .media = conditions.media,
            .import_record_idx = std.math.maxInt(u32),
            .loc = Location.dummy(),
        };
    }

    pub fn conditionsOwned(this: *const This, allocator: std.mem.Allocator) ImportConditions {
        return ImportConditions{
            .layer = if (this.layer) |*l| if (l.v) |layer| .{ .v = layer.deepClone(allocator) } else .{ .v = null } else null,
            .supports = if (this.supports) |*s| s.deepClone(allocator) else null,
            .media = this.media.deepClone(allocator),
        };
    }

    pub fn hasConditions(this: *const This) bool {
        return this.layer != null or this.supports != null or this.media.media_queries.items.len > 0;
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        const dep = if (dest.dependencies != null) dependencies.ImportDependency.new(
            dest.allocator,
            this,
            dest.filename(),
        ) else null;

        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        try dest.writeStr("@import ");
        if (dep) |d| {
            css.serializer.serializeString(d.placeholder, dest) catch return dest.addFmtError();

            if (dest.dependencies) |*deps| {
                deps.append(
                    dest.allocator,
                    Dependency{ .import = d },
                ) catch unreachable;
            }
        } else {
            css.serializer.serializeString(this.url, dest) catch return dest.addFmtError();
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

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};
