const std = @import("std");
const bun = @import("bun");
pub const css = @import("../css_parser.zig");
const MediaList = css.MediaList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Dependency = css.Dependency;
const dependencies = css.dependencies;
const LayerName = css.css_rules.layer.LayerName;
const SupportsCondition = css.css_rules.supports.SupportsCondition;
const Location = css.css_rules.Location;

/// TODO: change this to be field on ImportRule
/// The fields of this struct need to match the fields of ImportRule
/// because we cast between them
pub const ImportConditions = struct {
    /// An optional cascade layer name, or `None` for an anonymous layer.
    layer: ?struct {
        /// PERF: null pointer optimizaiton, nullable
        v: ?LayerName,

        pub fn eql(this: *const @This(), other: *const @This()) bool {
            if (this.v == null and other.v == null) return true;
            if (this.v == null or other.v == null) return false;
            return this.v.?.eql(&other.v.?);
        }
    } = null,

    /// An optional `supports()` condition.
    supports: ?SupportsCondition = null,

    /// A media query.
    media: css.MediaList = .{},

    pub fn hash(this: *const @This(), hasher: anytype) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn hasAnonymousLayer(this: *const @This()) bool {
        return this.layer != null and this.layer.?.v == null;
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) ImportConditions {
        return ImportConditions{
            .layer = if (this.layer) |*l| if (l.v) |layer| .{ .v = layer.deepClone(allocator) } else .{ .v = null } else null,
            .supports = if (this.supports) |*s| s.deepClone(allocator) else null,
            .media = this.media.deepClone(allocator),
        };
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
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
    }

    /// This code does the same thing as `deepClone` right now, but might change in the future so keeping this separate.
    ///
    /// So this code is used when we wrap a CSS file in import conditions in the final output chunk:
    /// ```css
    /// @layer foo {
    ///     /* css file contents */
    /// }
    /// ```
    ///
    /// However, the *prelude* of the condition /could/ contain a URL token:
    /// ```css
    /// @supports (background-image: url('example.png')) {
    ///     /* css file contents */
    /// }
    /// ```
    ///
    /// In this case, the URL token's import record actually belongs to the /parent/ of the current CSS file (the one who imported it).
    /// Therefore, we need to copy this import record from the parent into the import record list of this current CSS file.
    ///
    /// In actuality, the css parser doesn't create an import record for URL tokens in `@supports` because that's pointless in the context of hte
    /// @supports rule.
    ///
    /// Furthermore, a URL token is not valid in `@media` or `@layer` rules.
    ///
    /// But this could change in the future, so still keeping this function.
    ///
    pub fn cloneWithImportRecords(this: *const @This(), allocator: std.mem.Allocator, import_records: *bun.BabyList(bun.ImportRecord)) ImportConditions {
        return ImportConditions{
            .layer = if (this.layer) |layer| if (layer.v) |l| .{ .v = l.cloneWithImportRecords(allocator, import_records) } else .{ .v = null } else null,
            .supports = if (this.supports) |*supp| supp.cloneWithImportRecords(allocator, import_records) else null,
            .media = this.media.cloneWithImportRecords(allocator, import_records),
        };
    }

    pub fn layersEql(lhs: *const @This(), rhs: *const @This()) bool {
        if (lhs.layer == null and rhs.layer == null) return true;
        if (lhs.layer == null or rhs.layer == null) return false;
        return lhs.layer.?.eql(&rhs.layer.?);
    }

    pub fn supportsEql(lhs: *const @This(), rhs: *const @This()) bool {
        if (lhs.supports == null and rhs.supports == null) return true;
        if (lhs.supports == null or rhs.supports == null) return false;

        return lhs.supports.?.eql(&rhs.supports.?);
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
    } = null,

    /// An optional `supports()` condition.
    supports: ?SupportsCondition = null,

    /// A media query.
    media: css.MediaList = .{},

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

    pub fn fromUrlAndImportRecordIdx(url: []const u8, import_record_idx: u32) This {
        return .{
            .url = url,
            .layer = null,
            .supports = null,
            .media = MediaList{ .media_queries = .{} },
            .import_record_idx = import_record_idx,
            .loc = Location.dummy(),
        };
    }

    pub fn fromConditionsAndUrl(url: []const u8, conds: ImportConditions) This {
        return ImportRule{
            .url = url,
            .layer = if (conds.layer) |layer| if (layer.v) |ly| .{ .v = ly } else .{ .v = null } else null,
            .supports = conds.supports,
            .media = conds.media,
            .import_record_idx = std.math.maxInt(u32),
            .loc = Location.dummy(),
        };
    }

    pub fn conditions(this: *const @This()) *const ImportConditions {
        return @ptrCast(&this.layer);
    }

    pub fn conditionsMut(this: *@This()) *ImportConditions {
        return @ptrCast(&this.layer);
    }

    /// The `import_records` here is preserved from esbuild in the case that we do need it, it doesn't seem necessary now
    pub fn conditionsWithImportRecords(this: *const This, allocator: std.mem.Allocator, import_records: *bun.BabyList(bun.ImportRecord)) ImportConditions {
        return ImportConditions{
            .layer = if (this.layer) |layer| if (layer.v) |l| .{ .v = l.cloneWithImportRecords(allocator, import_records) } else .{ .v = null } else null,
            .supports = if (this.supports) |*supp| supp.cloneWithImportRecords(allocator, import_records) else null,
            .media = this.media.cloneWithImportRecords(allocator, import_records),
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
            dest.local_names,
            dest.symbols,
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
