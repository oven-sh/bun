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
        const hashes = hashes: {
            var hashes = ArrayList([]const u8).initCapacity(allocator, sources.items.len) catch bun.outOfMemory();
            for (sources.items) |path| {
                var alloced = false;
                const source = source: {
                    if (project_root) |root| {
                        if (bun.path.Platform.auto.isAbsolute(root)) {
                            alloced = true;
                            // TODO: should we use this allocator or something else
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
        allocator: std.mem.Allocator,
        name: []const u8,
        from: *const ?css.css_properties.css_modules.Specifier,
        source_index: u32,
    ) ?[]const u8 {
        const reference, const key = if (from.*) |specifier| switch (specifier) {
            .global => return name[2..],
            .file => |file| .{
                CssModuleReference{ .dependency = .{ .name = name[2..], .specifier = file } },
                file,
            },
            .source_index => |dep_source_index| return this.config.pattern.writeToString(
                allocator,
                .{},
                this.hashes.items[dep_source_index],
                this.sources.items[dep_source_index],
                name[2..],
            ),
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
        this: *CssModule,
        allocator: Allocator,
        selectors: *const css.selector.parser.SelectorList,
        composes: *const css.css_properties.css_modules.Composes,
        source_index: u32,
    ) css.Maybe(void, css.PrinterErrorKind) {
        for (selectors.v.slice()) |*sel| {
            if (sel.len() == 1) {
                const component: *const css.selector.parser.Component = &sel.components.items[0];
                switch (component.*) {
                    .class => |id| {
                        for (composes.names.slice()) |name| {
                            const reference: CssModuleReference = if (composes.from) |*specifier|
                                switch (specifier.*) {
                                    .source_index => |dep_source_index| {
                                        if (this.exports_by_source_index.items[dep_source_index].get(name.v)) |entry| {
                                            const entry_name = entry.name;
                                            const composes2 = &entry.composes;
                                            const @"export" = this.exports_by_source_index.items[source_index].getPtr(id.v).?;

                                            @"export".composes.append(allocator, .{ .local = .{ .name = entry_name } }) catch bun.outOfMemory();
                                            @"export".composes.appendSlice(allocator, composes2.items) catch bun.outOfMemory();
                                        }
                                        continue;
                                    },
                                    .global => CssModuleReference{ .global = .{ .name = name.v } },
                                    .file => |file| CssModuleReference{
                                        .dependency = .{
                                            .name = name.v,
                                            .specifier = file,
                                        },
                                    },
                                }
                            else
                                CssModuleReference{
                                    .local = .{
                                        .name = this.config.pattern.writeToString(
                                            allocator,
                                            ArrayList(u8){},
                                            this.hashes.items[source_index],
                                            this.sources.items[source_index],
                                            name.v,
                                        ),
                                    },
                                };

                            const export_value = this.exports_by_source_index.items[source_index].getPtr(id.v) orelse unreachable;
                            export_value.composes.append(allocator, reference) catch bun.outOfMemory();

                            const contains_reference = brk: {
                                for (export_value.composes.items) |*compose_| {
                                    const compose: *const CssModuleReference = compose_;
                                    if (compose.eql(&reference)) {
                                        break :brk true;
                                    }
                                }
                                break :brk false;
                            };
                            if (!contains_reference) {
                                export_value.composes.append(allocator, reference) catch bun.outOfMemory();
                            }
                        }
                    },
                    else => {},
                }
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
        specifier: []const u8,
    },

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        if (@intFromEnum(this.*) != @intFromEnum(other.*)) return false;

        return switch (this.*) {
            .local => |v| bun.strings.eql(v.name, other.local.name),
            .global => |v| bun.strings.eql(v.name, other.global.name),
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

    const encode_len = bun.base64.encodeLen(h_bytes[0..]);

    var slice_to_write = if (encode_len <= 128 - @as(usize, @intFromBool(at_start)))
        allocator.alloc(u8, encode_len + @as(usize, @intFromBool(at_start))) catch bun.outOfMemory()
    else
        fmt_str[0..];

    const base64_encoded_hash_len = bun.base64.encode(slice_to_write, &h_bytes);

    const base64_encoded_hash = slice_to_write[0..base64_encoded_hash_len];

    if (at_start and base64_encoded_hash.len > 0 and base64_encoded_hash[0] >= '0' and base64_encoded_hash[0] <= '9') {
        std.mem.copyBackwards(u8, slice_to_write[1..][0..base64_encoded_hash_len], base64_encoded_hash);
        slice_to_write[0] = '_';
        return slice_to_write[0 .. base64_encoded_hash_len + 1];
    }

    return base64_encoded_hash;
}
