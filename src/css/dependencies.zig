const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const css_values = @import("./values/values.zig");
const DashedIdent = css_values.ident.DashedIdent;
const Url = css_values.url.Url;
const Ident = css_values.ident.Ident;
pub const Error = css.Error;
// const Location = css.Location;

const ArrayList = std.ArrayListUnmanaged;

/// Options for `analyze_dependencies` in `PrinterOptions`.
pub const DependencyOptions = struct {
    /// Whether to remove `@import` rules.
    remove_imports: bool,
};

/// A dependency.
pub const Dependency = union(enum) {
    /// An `@import` dependency.
    import: ImportDependency,
    /// A `url()` dependency.
    url: UrlDependency,
};

/// A line and column position within a source file.
pub const Location = struct {
    /// The line number, starting from 1.
    line: u32,
    /// The column number, starting from 1.
    column: u32,

    pub fn fromSourceLocation(loc: css.SourceLocation) Location {
        return Location{
            .line = loc.line + 1,
            .column = loc.column,
        };
    }

    pub fn hash(this: *const @This(), hasher: *std.hash.Wyhash) void {
        return css.implementHash(@This(), this, hasher);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// An `@import` dependency.
pub const ImportDependency = struct {
    /// The url to import.
    url: []const u8,
    /// The placeholder that the URL was replaced with.
    placeholder: []const u8,
    /// An optional `supports()` condition.
    supports: ?[]const u8,
    /// A media query.
    media: ?[]const u8,
    /// The location of the dependency in the source file.
    loc: SourceRange,

    pub fn new(allocator: Allocator, rule: *const css.css_rules.import.ImportRule, filename: []const u8) ImportDependency {
        const supports = if (rule.supports) |*supports| brk: {
            const s = css.to_css.string(
                allocator,
                css.css_rules.supports.SupportsCondition,
                supports,
                css.PrinterOptions.default(),
                null,
            ) catch bun.Output.panic(
                "Unreachable code: failed to stringify SupportsCondition.\n\nThis is a bug in Bun's CSS printer. Please file a bug report at https://github.com/oven-sh/bun/issues/new/choose",
                .{},
            );
            break :brk s;
        } else null;

        const media = if (rule.media.media_queries.items.len > 0) media: {
            const s = css.to_css.string(allocator, css.MediaList, &rule.media, css.PrinterOptions.default(), null) catch bun.Output.panic(
                "Unreachable code: failed to stringify MediaList.\n\nThis is a bug in Bun's CSS printer. Please file a bug report at https://github.com/oven-sh/bun/issues/new/choose",
                .{},
            );
            break :media s;
        } else null;

        const placeholder = css.css_modules.hash(allocator, "{s}_{s}", .{ filename, rule.url }, false);

        return ImportDependency{
            // TODO(zack): should we clone this? lightningcss does that
            .url = rule.url,
            .placeholder = placeholder,
            .supports = supports,
            .media = media,
            .loc = SourceRange.new(
                filename,
                css.dependencies.Location{ .line = rule.loc.line + 1, .column = rule.loc.column },
                8,
                rule.url.len + 2,
            ), // TODO: what about @import url(...)?
        };
    }
};

/// A `url()` dependency.
pub const UrlDependency = struct {
    /// The url of the dependency.
    url: []const u8,
    /// The placeholder that the URL was replaced with.
    placeholder: []const u8,
    /// The location of the dependency in the source file.
    loc: SourceRange,

    pub fn new(allocator: Allocator, url: *const Url, filename: []const u8, import_records: *const bun.BabyList(bun.ImportRecord)) UrlDependency {
        const theurl = import_records.at(url.import_record_idx).path.pretty;
        const placeholder = css.css_modules.hash(
            allocator,
            "{s}_{s}",
            .{ filename, theurl },
            false,
        );
        return UrlDependency{
            .url = theurl,
            .placeholder = placeholder,
            .loc = SourceRange.new(filename, url.loc, 4, theurl.len),
        };
    }
};

/// Represents the range of source code where a dependency was found.
pub const SourceRange = struct {
    /// The filename in which the dependency was found.
    file_path: []const u8,
    /// The starting line and column position of the dependency.
    start: Location,
    /// The ending line and column position of the dependency.
    end: Location,

    pub fn new(filename: []const u8, loc: Location, offset: u32, len: usize) SourceRange {
        return SourceRange{
            .file_path = filename,
            .start = Location{
                .line = loc.line,
                .column = loc.column + offset,
            },
            .end = Location{
                .line = loc.line,
                .column = loc.column + offset + @as(u32, @intCast(len)) - 1,
            },
        };
    }
};
