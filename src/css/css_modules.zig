const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("bun");

pub const css = @import("./css_parser.zig");
pub const css_values = @import("./values/values.zig");
pub const Error = css.Error;
const PrintErr = css.PrintErr;

const ArrayList = std.ArrayListUnmanaged;

pub const CssModule = struct {
    config: *const Config,
    sources: *const ArrayList([]const u8),
    hashes: ArrayList([]const u8),
    exports_by_source_index: ArrayList(CssModuleExports),
    references: *CssModuleReferences,

    pub fn new(
        allocator: Allocator,
        config: *const Config,
        sources: *const ArrayList([]const u8),
        project_root: ?[]const u8,
        references: *CssModuleReferences,
    ) CssModule {
        // TODO: this is BAAAAAAAAAAD we are going to remove it
        const hashes = hashes: {
            var hashes = ArrayList([]const u8).initCapacity(allocator, sources.items.len) catch bun.outOfMemory();
            for (sources.items) |path| {
                var alloced = false;
                const source = source: {
                    // Make paths relative to project root so hashes are stable
                    if (project_root) |root| {
                        if (bun.path.Platform.auto.isAbsolute(root)) {
                            alloced = true;
                            break :source allocator.dupe(u8, bun.path.relative(root, path)) catch bun.outOfMemory();
                        }
                    }
                    break :source path;
                };
                defer if (alloced) allocator.free(source);
                hashes.appendAssumeCapacity(hash(
                    allocator,
                    "{s}",
                    .{source},
                    config.pattern.segments.at(0).* == .hash,
                ));
            }
            break :hashes hashes;
        };
        const exports_by_source_index = exports_by_source_index: {
            var exports_by_source_index = ArrayList(CssModuleExports).initCapacity(allocator, sources.items.len) catch bun.outOfMemory();
            exports_by_source_index.appendNTimesAssumeCapacity(CssModuleExports{}, sources.items.len);
            break :exports_by_source_index exports_by_source_index;
        };
        return CssModule{
            .config = config,
            .sources = sources,
            .references = references,
            .hashes = hashes,
            .exports_by_source_index = exports_by_source_index,
        };
    }

    pub fn deinit(this: *CssModule) void {
        _ = this; // autofix
        // TODO: deinit
    }

    pub fn getReference(this: *CssModule, allocator: Allocator, name: []const u8, source_index: u32) void {
        const gop = this.exports_by_source_index.items[source_index].getOrPut(allocator, name) catch bun.outOfMemory();
        if (gop.found_existing) {
            gop.value_ptr.is_referenced = true;
        } else {
            gop.value_ptr.* = CssModuleExport{
                .name = this.config.pattern.writeToString(allocator, .{}, this.hashes.items[source_index], this.sources.items[source_index], name),
                .composes = .{},
                .is_referenced = true,
            };
        }
    }

    pub fn referenceDashed(
        this: *CssModule,
        comptime W: type,
        dest: *css.Printer(W),
        name: []const u8,
        from: *const ?css.css_properties.css_modules.Specifier,
        source_index: u32,
    ) PrintErr!?[]const u8 {
        const allocator = dest.allocator;
        const reference, const key = if (from.*) |specifier| switch (specifier) {
            .global => return name[2..],
            .import_record_index => |import_record_index| init: {
                const import_record = try dest.importRecord(import_record_index);
                break :init .{
                    CssModuleReference{
                        .dependency = .{
                            .name = name[2..],
                            .specifier = import_record.path.text,
                        },
                    },
                    import_record.path.text,
                };
            },
        } else {
            // Local export. Mark as used.
            const gop = this.exports_by_source_index.items[source_index].getOrPut(allocator, name) catch bun.outOfMemory();
            if (gop.found_existing) {
                gop.value_ptr.is_referenced = true;
            } else {
                var res = ArrayList(u8){};
                res.appendSlice(allocator, "--") catch bun.outOfMemory();
                gop.value_ptr.* = CssModuleExport{
                    .name = this.config.pattern.writeToString(
                        allocator,
                        res,
                        this.hashes.items[source_index],
                        this.sources.items[source_index],
                        name[2..],
                    ),
                    .composes = .{},
                    .is_referenced = true,
                };
            }
            return null;
        };

        const the_hash = hash(allocator, "{s}_{s}_{s}", .{ this.hashes.items[source_index], name, key }, false);

        this.references.put(
            allocator,
            std.fmt.allocPrint(allocator, "--{s}", .{the_hash}) catch bun.outOfMemory(),
            reference,
        ) catch bun.outOfMemory();

        return the_hash;
    }

    pub fn handleComposes(
        _: *CssModule,
        comptime W: type,
        _: *css.Printer(W),
        selectors: *const css.selector.parser.SelectorList,
        _: *const css.css_properties.css_modules.Composes,
        _: u32,
    ) css.Maybe(void, css.PrinterErrorKind) {
        // const allocator = dest.allocator;
        for (selectors.v.slice()) |*sel| {
            if (sel.len() == 1 and sel.components.items[0] == .class) {
                continue;
            }

            // The composes property can only be used within a simple class selector.
            return .{ .err = css.PrinterErrorKind.invalid_composes_selector };
        }

        return .{ .result = {} };
    }

    pub fn addDashed(this: *CssModule, allocator: Allocator, local: []const u8, source_index: u32) void {
        const gop = this.exports_by_source_index.items[source_index].getOrPut(allocator, local) catch bun.outOfMemory();
        if (!gop.found_existing) {
            gop.value_ptr.* = CssModuleExport{
                // todo_stuff.depth
                .name = this.config.pattern.writeToStringWithPrefix(
                    allocator,
                    "--",
                    this.hashes.items[source_index],
                    this.sources.items[source_index],
                    local[2..],
                ),
                .composes = .{},
                .is_referenced = false,
            };
        }
    }

    pub fn addLocal(this: *CssModule, allocator: Allocator, exported: []const u8, local: []const u8, source_index: u32) void {
        const gop = this.exports_by_source_index.items[source_index].getOrPut(allocator, exported) catch bun.outOfMemory();
        if (!gop.found_existing) {
            gop.value_ptr.* = CssModuleExport{
                // todo_stuff.depth
                .name = this.config.pattern.writeToString(
                    allocator,
                    .{},
                    this.hashes.items[source_index],
                    this.sources.items[source_index],
                    local,
                ),
                .composes = .{},
                .is_referenced = false,
            };
        }
    }
};

/// Configuration for CSS modules.
pub const Config = struct {
    /// The name pattern to use when renaming class names and other identifiers.
    /// Default is `[hash]_[local]`.
    pattern: Pattern = .{},

    /// Whether to rename dashed identifiers, e.g. custom properties.
    dashed_idents: bool = false,

    /// Whether to scope animation names.
    /// Default is `true`.
    animation: bool = true,

    /// Whether to scope grid names.
    /// Default is `true`.
    grid: bool = true,

    /// Whether to scope custom identifiers
    /// Default is `true`.
    custom_idents: bool = true,
};

/// A CSS modules class name pattern.
pub const Pattern = struct {
    /// The list of segments in the pattern.
    segments: css.SmallList(Segment, 3) = css.SmallList(Segment, 3).initInlined(&[_]Segment{ .local, .{ .literal = "_" }, .hash }),

    /// Write the substituted pattern to a destination.
    pub fn write(
        this: *const Pattern,
        hash_: []const u8,
        path: []const u8,
        local: []const u8,
        closure: anytype,
        comptime writefn: *const fn (@TypeOf(closure), []const u8, replace_dots: bool) void,
    ) void {
        for (this.segments.slice()) |*segment| {
            switch (segment.*) {
                .literal => |s| {
                    writefn(closure, s, false);
                },
                .name => {
                    const stem = std.fs.path.stem(path);
                    if (std.mem.indexOf(u8, stem, ".")) |_| {
                        writefn(closure, stem, true);
                    } else {
                        writefn(closure, stem, false);
                    }
                },
                .local => {
                    writefn(closure, local, false);
                },
                .hash => {
                    writefn(closure, hash_, false);
                },
            }
        }
    }

    pub fn writeToStringWithPrefix(
        this: *const Pattern,
        allocator: Allocator,
        comptime prefix: []const u8,
        hash_: []const u8,
        path: []const u8,
        local: []const u8,
    ) []const u8 {
        const Closure = struct { res: ArrayList(u8), allocator: Allocator };
        var closure = Closure{ .res = .{}, .allocator = allocator };
        this.write(
            hash_,
            path,
            local,
            &closure,
            struct {
                pub fn writefn(self: *Closure, slice: []const u8, replace_dots: bool) void {
                    self.res.appendSlice(self.allocator, prefix) catch bun.outOfMemory();
                    if (replace_dots) {
                        const start = self.res.items.len;
                        self.res.appendSlice(self.allocator, slice) catch bun.outOfMemory();
                        const end = self.res.items.len;
                        for (self.res.items[start..end]) |*c| {
                            if (c.* == '.') {
                                c.* = '-';
                            }
                        }
                        return;
                    }
                    self.res.appendSlice(self.allocator, slice) catch bun.outOfMemory();
                }
            }.writefn,
        );
        return closure.res.items;
    }

    pub fn writeToString(
        this: *const Pattern,
        allocator: Allocator,
        res_: ArrayList(u8),
        hash_: []const u8,
        path: []const u8,
        local: []const u8,
    ) []const u8 {
        var res = res_;
        const Closure = struct { res: *ArrayList(u8), allocator: Allocator };
        var closure = Closure{ .res = &res, .allocator = allocator };
        this.write(
            hash_,
            path,
            local,
            &closure,
            struct {
                pub fn writefn(self: *Closure, slice: []const u8, replace_dots: bool) void {
                    if (replace_dots) {
                        const start = self.res.items.len;
                        self.res.appendSlice(self.allocator, slice) catch bun.outOfMemory();
                        const end = self.res.items.len;
                        for (self.res.items[start..end]) |*c| {
                            if (c.* == '.') {
                                c.* = '-';
                            }
                        }
                        return;
                    }
                    self.res.appendSlice(self.allocator, slice) catch bun.outOfMemory();
                    return;
                }
            }.writefn,
        );

        return res.items;
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
pub const CssModuleExports = std.StringArrayHashMapUnmanaged(CssModuleExport);

/// A map of placeholders to references.
pub const CssModuleReferences = std.StringArrayHashMapUnmanaged(CssModuleReference);

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
        ///
        /// import record idx
        specifier: []const u8,
    },

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        if (@intFromEnum(this.*) != @intFromEnum(other.*)) return false;

        return switch (this.*) {
            .local => |v| bun.strings.eql(v.name, other.local.name),
            .global => |v| bun.strings.eql(v.name, other.global.name),
            // .dependency => |v| bun.strings.eql(v.name, other.dependency.name) and bun.strings.eql(v.specifier, other.dependency.specifier),
            .dependency => |v| bun.strings.eql(v.name, other.dependency.name) and bun.strings.eql(v.specifier, other.dependency.specifier),
        };
    }
};

// TODO: replace with bun's hash
pub fn hash(allocator: Allocator, comptime fmt: []const u8, args: anytype, at_start: bool) []const u8 {
    const count = std.fmt.count(fmt, args);
    var stack_fallback = std.heap.stackFallback(128, allocator);
    const fmt_alloc = if (count <= 128) stack_fallback.get() else allocator;
    var hasher = bun.Wyhash11.init(0);
    var fmt_str = std.fmt.allocPrint(fmt_alloc, fmt, args) catch bun.outOfMemory();
    hasher.update(fmt_str);

    const h: u32 = @truncate(hasher.final());
    var h_bytes: [4]u8 = undefined;
    std.mem.writeInt(u32, &h_bytes, h, .little);

    const encode_len = bun.base64.simdutfEncodeLenUrlSafe(h_bytes[0..].len);

    var slice_to_write = if (encode_len <= 128 - @as(usize, @intFromBool(at_start)))
        allocator.alloc(u8, encode_len + @as(usize, @intFromBool(at_start))) catch bun.outOfMemory()
    else
        fmt_str[0..];

    const base64_encoded_hash_len = bun.base64.simdutfEncodeUrlSafe(slice_to_write, &h_bytes);

    const base64_encoded_hash = slice_to_write[0..base64_encoded_hash_len];

    if (at_start and base64_encoded_hash.len > 0 and base64_encoded_hash[0] >= '0' and base64_encoded_hash[0] <= '9') {
        std.mem.copyBackwards(u8, slice_to_write[1..][0..base64_encoded_hash_len], base64_encoded_hash);
        slice_to_write[0] = '_';
        return slice_to_write[0 .. base64_encoded_hash_len + 1];
    }

    return base64_encoded_hash;
}
