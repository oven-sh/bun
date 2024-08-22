const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const css_values = @import("./values/values.zig");
const DashedIdent = css_values.ident.DashedIdent;
const Ident = css_values.ident.Ident;
pub const Error = css.Error;
const PrintErr = css.PrintErr;

const ArrayList = std.ArrayListUnmanaged;

const CssModule = struct {
    config: *const Config,
    sources: ArrayList(*const bun.PathString),
    hashes: ArrayList([]const u8),
    exports_by_source_index: ArrayList(CssModuleExports),
    references: *std.HashMap([]const u8, CssModuleReference),

    pub fn new(
        config: *const Config,
        sources: *const ArrayList([]const u8),
        project_root: ?[]const u8,
        references: *std.StringArrayHashMap(CssModuleReference),
    ) CssModule {
        _ = config; // autofix
        _ = sources; // autofix
        _ = project_root; // autofix
        _ = references; // autofix
        @compileError(css.todo_stuff.errors);
    }

    pub fn handleComposes(
        this: *CssModule,
        selectors: *const css.selector.api.SelectorList,
        composes: *const css.css_properties.css_modules.Composes,
        source_index: u32,
    ) css.PrintErr!void {
        _ = this; // autofix
        _ = selectors; // autofix
        _ = composes; // autofix
        _ = source_index; // autofix
        @compileError(css.todo_stuff.errors);
    }

    pub fn addDashed(this: *CssModule, local: []const u8, source_index: u32) void {
        _ = this; // autofix
        _ = local; // autofix
        _ = source_index; // autofix
        @compileError(css.todo_stuff.errors);
    }
};

/// Configuration for CSS modules.
pub const Config = struct {
    /// The name pattern to use when renaming class names and other identifiers.
    /// Default is `[hash]_[local]`.
    pattern: Pattern,

    /// Whether to rename dashed identifiers, e.g. custom properties.
    dashed_idents: bool,

    /// Whether to scope animation names.
    /// Default is `true`.
    animation: bool,

    /// Whether to scope grid names.
    /// Default is `true`.
    grid: bool,

    /// Whether to scope custom identifiers
    /// Default is `true`.
    custom_idents: bool,
};

/// A CSS modules class name pattern.
pub const Pattern = struct {
    /// The list of segments in the pattern.
    segments: css.SmallList(Segment, 2),

    /// Write the substituted pattern to a destination.
    pub fn write(
        this: *const Pattern,
        _hash: []const u8,
        path: bun.PathString,
        local: []const u8,
        closure: anytype,
        comptime writefn: *const fn (@TypeOf(closure), []const u8) PrintErr!void,
    ) PrintErr!void {
        _ = this; // autofix
        _ = _hash; // autofix
        _ = path; // autofix
        _ = local; // autofix
        _ = writefn; // autofix
        @compileError(css.todo_stuff.depth);
    }
};

/// A segment in a CSS modules class name pattern.
///
/// See [Pattern](Pattern).
pub const Segment = union(enum) {
    /// A literal string segment.
    literal: []const u8,

    /// The base file name.
    name,

    /// The original class name.
    local,

    /// A hash of the file name.
    hash,
};

/// A map of exported names to values.
pub const CssModuleExports = std.StringArrayHashMap(CssModuleExport);

/// A map of placeholders to references.
pub const CssModuleReferences = std.StringArrayHashMap(CssModuleReference);

/// An exported value from a CSS module.
pub const CssModuleExport = struct {
    /// The local (compiled) name for this export.
    name: []const u8,
    /// Other names that are composed by this export.
    composes: ArrayList(CssModuleReference),
    /// Whether the export is referenced in this file.
    is_referenced: bool,
};

/// A referenced name within a CSS module, e.g. via the `composes` property.
///
/// See [CssModuleExport](CssModuleExport).
pub const CssModuleReference = union(enum) {
    /// A local reference.
    local: struct {
        /// The local (compiled) name for the reference.
        name: []const u8,
    },
    /// A global reference.
    global: struct {
        /// The referenced global name.
        name: []const u8,
    },
    /// A reference to an export in a different file.
    dependency: struct {
        /// The name to reference within the dependency.
        name: []const u8,
        /// The dependency specifier for the referenced file.
        specifier: []const u8,
    },
};

// TODO: replace with bun's hash
pub fn hash(allocator: Allocator, comptime fmt: []const u8, args: anytype, at_start: bool) []const u8 {
    _ = fmt; // autofix
    _ = args; // autofix
    _ = allocator; // autofix
    _ = at_start; // autofix
    @compileError(css.todo_stuff.depth);
}
