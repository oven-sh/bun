const std = @import("std");
const root = @import("root");
const bun = root.bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;
const json_parser = bun.JSON;
const Glob = @import("../glob.zig");

const Package = @import("../install/lockfile.zig").Package;

fn globIgnoreFn(val: []const u8) bool {
    if (val.len == 0) {
        return false;
    }
    // skip hidden directories
    if (val[0] == '.') {
        return true;
    }
    // skip node_modules
    if (strings.eqlComptime(val, "node_modules")) {
        return true;
    }
    return false;
}

const GlobWalker = Glob.GlobWalker_(globIgnoreFn, Glob.DirEntryAccessor, false);

pub fn getCandidatePackagePatterns(allocator: std.mem.Allocator, log: *bun.logger.Log, out_patterns: *std.ArrayList([]u8), workdir_: []const u8, root_buf: *bun.PathBuffer) ![]const u8 {
    bun.JSAst.Expr.Data.Store.create(bun.default_allocator);
    bun.JSAst.Stmt.Data.Store.create(bun.default_allocator);

    defer {
        bun.JSAst.Expr.Data.Store.reset();
        bun.JSAst.Stmt.Data.Store.reset();
    }

    var workdir = workdir_;

    while (true) : (workdir = std.fs.path.dirname(workdir) orelse break) {
        const parent_trimmed = strings.withoutTrailingSlash(workdir);
        var name_buf: bun.PathBuffer = undefined;
        @memcpy(name_buf[0..parent_trimmed.len], parent_trimmed);
        name_buf[parent_trimmed.len..name_buf.len][0.."/package.json".len].* = "/package.json".*;
        name_buf[parent_trimmed.len + "/package.json".len] = 0;
        const json_path = name_buf[0 .. parent_trimmed.len + "/package.json".len];

        log.msgs.clearRetainingCapacity();
        log.errors = 0;
        log.warnings = 0;

        const json_file = std.fs.cwd().openFileZ(
            name_buf[0 .. parent_trimmed.len + "/package.json".len :0].ptr,
            .{ .mode = .read_only },
        ) catch continue;
        defer json_file.close();

        const json_stat_size = try json_file.getEndPos();
        const json_buf = try allocator.alloc(u8, json_stat_size + 64);
        defer allocator.free(json_buf);
        const json_len = try json_file.preadAll(json_buf, 0);
        const json_source = bun.logger.Source.initPathString(json_path, json_buf[0..json_len]);
        const json = try json_parser.ParseJSONUTF8(&json_source, log, allocator);

        const prop = json.asProperty("workspaces") orelse continue;

        const json_array = switch (prop.expr.data) {
            .e_array => |arr| arr,
            .e_object => |obj| if (obj.get("packages")) |packages| switch (packages.data) {
                .e_array => |arr| arr,
                else => break,
            } else break,
            else => break,
        };

        for (json_array.slice()) |expr| {
            switch (expr.data) {
                .e_string => |pattern_expr| {
                    // /basepath/pattern/package.json
                    // const size = parent_trimmed.len + 1 + pattern_expr.data.len + "/package.json".len;
                    const size = pattern_expr.data.len + "/package.json".len;
                    var pattern = try allocator.alloc(u8, size);
                    @memcpy(pattern[0..pattern_expr.data.len], pattern_expr.data);
                    @memcpy(pattern[pattern_expr.data.len..size], "/package.json");

                    // @memcpy(pattern[0..parent_trimmed.len], parent_trimmed);
                    // pattern[parent_trimmed.len] = '/';
                    // @memcpy(pattern[parent_trimmed.len + 1 .. parent_trimmed.len + 1 + pattern_expr.data.len], pattern_expr.data);
                    // @memcpy(pattern[parent_trimmed.len + 1 + pattern_expr.data.len .. size], "/package.json");
                    try out_patterns.append(pattern);
                },
                else => {
                    // TODO log error and fail
                    Output.prettyErrorln("<r><red>error<r>: Failed to parse \"workspaces\" property: all items must be strings", .{});
                    Global.exit(1);
                },
            }
        }
        @memcpy(root_buf[0..parent_trimmed.len], parent_trimmed);
        return root_buf[0..parent_trimmed.len];
    }

    // if we were not able to find a workspace root, we simply glob for all package.json files
    try out_patterns.append(try allocator.dupe(u8, "**/package.json"));
    const root_dir = strings.withoutTrailingSlash(workdir_);
    @memcpy(root_buf[0..root_dir.len], root_dir);
    return root_buf[0..root_dir.len];
}

pub const FilterSet = struct {
    allocator: std.mem.Allocator,
    filters: []Pattern,
    has_name_filters: bool = false,

    const Pattern = struct {
        codepoints: []u32,
        kind: enum {
            name,
            path,
        },
        // negate: bool = false,
    };

    pub fn init(allocator: std.mem.Allocator, filters: []const []const u8, cwd: []const u8) !FilterSet {
        var buf: bun.PathBuffer = undefined;
        // TODO fixed buffer allocator with fallback?
        var self = FilterSet{ .allocator = allocator, .filters = try allocator.alloc(Pattern, filters.len) };
        for (0.., filters) |idx, filter_utf8_| {
            var filter_utf8 = filter_utf8_;
            const is_path = filter_utf8.len > 0 and filter_utf8[0] == '.';
            if (is_path) {
                const parts = [_]string{filter_utf8};
                filter_utf8 = bun.path.joinAbsStringBuf(cwd, &buf, &parts, .auto);
            }
            var filter_utf32 = std.ArrayListUnmanaged(u32){};
            var codepointer_iter = strings.UnsignedCodepointIterator.init(filter_utf8);
            var cursor = strings.UnsignedCodepointIterator.Cursor{};
            while (codepointer_iter.next(&cursor)) {
                if (cursor.c == @as(u32, '\\')) {
                    try filter_utf32.append(self.allocator, cursor.c);
                }
                try filter_utf32.append(self.allocator, cursor.c);
            }
            self.has_name_filters = self.has_name_filters or !is_path;
            self.filters[idx] = Pattern{
                .codepoints = filter_utf32.items,
                .kind = if (is_path) .path else .name,
            };
        }
        return self;
    }

    pub fn deinit(self: *FilterSet) void {
        for (self.filters) |filter| {
            // TODO is this free correct? we're freeing only part of the array
            self.allocator.free(filter.codepoints);
        }
        self.allocator.free(self.filters);
    }

    pub fn matchesPath(self: *FilterSet, path: []const u8) bool {
        for (self.filters) |filter| {
            if (Glob.matchImpl(filter.codepoints, path)) {
                return true;
            }
        }
        return false;
    }

    pub fn matchesPathName(self: *FilterSet, path: []const u8, name: []const u8) bool {
        for (self.filters) |filter| {
            const target = switch (filter.kind) {
                .name => name,
                .path => path,
            };
            if (Glob.matchImpl(filter.codepoints, target)) {
                return true;
            }
        }
        return false;
    }
};

pub fn getPackageName(allocator: std.mem.Allocator, log: *bun.logger.Log, path: []const u8) !?[]u8 {
    const json_file = try std.fs.cwd().openFile(
        path,
        .{ .mode = .read_only },
    );
    defer json_file.close();

    const json_stat_size = try json_file.getEndPos();
    const json_buf = try allocator.alloc(u8, json_stat_size + 64);
    defer allocator.free(json_buf);

    const json_len = try json_file.preadAll(json_buf, 0);
    const json_source = bun.logger.Source.initPathString(path, json_buf[0..json_len]);

    var parser = try json_parser.PackageJSONVersionChecker.init(allocator, &json_source, log);
    _ = try parser.parseExpr();
    if (!parser.has_found_name) {
        return null;
    }
    return try allocator.dupe(u8, parser.found_name);
}

pub const PackageFilterIterator = struct {
    patterns: []const []const u8,
    pattern_idx: usize = 0,
    root_dir: []const u8,

    walker: GlobWalker = undefined,
    iter: GlobWalker.Iterator = undefined,
    valid: bool = false,

    // TODO check if keeping the arena alloctor around is sound - GlobWalker copies the allocator, so it might get out of sync or leak memory
    arena: std.heap.ArenaAllocator,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, patterns: []const []const u8, root_dir: []const u8) !PackageFilterIterator {
        return PackageFilterIterator{
            .patterns = patterns,
            .allocator = allocator,
            .arena = std.heap.ArenaAllocator.init(allocator),
            .root_dir = root_dir,
        };
    }

    pub fn deinit(self: *PackageFilterIterator) void {
        if (self.valid) {
            self.deinitWalker();
        }
        self.arena.deinit();
    }

    fn walkerNext(self: *PackageFilterIterator) !?[]const u8 {
        while (true) {
            switch (try self.iter.next()) {
                .err => |err| {
                    Output.prettyErrorln("Error: {}", .{err});
                    continue;
                },
                .result => |path| {
                    return path;
                },
            }
        }
    }

    fn initWalker(self: *PackageFilterIterator) !void {
        const pattern = self.patterns[self.pattern_idx];
        var arena = self.arena;
        const cwd = try arena.allocator().dupe(u8, self.root_dir);
        const walker_init_res = try self.walker.initWithCwd(&arena, pattern, cwd, true, true, false, true, true);
        switch (walker_init_res) {
            .err => |err| {
                // TODO
                // return err;
                _ = err;
                Global.crash();
            },
            else => {},
        }
        self.iter = GlobWalker.Iterator{ .walker = &self.walker };

        const iter_init_res = try self.iter.init();
        switch (iter_init_res) {
            .err => |err| {
                // TODO
                // return err;
                _ = err;
                Global.crash();
            },
            else => {},
        }
    }

    fn deinitWalker(self: *PackageFilterIterator) void {
        self.walker.deinit(false);
        self.iter.deinit();
        _ = self.arena.reset(std.heap.ArenaAllocator.ResetMode.retain_capacity);
    }

    pub fn next(self: *PackageFilterIterator) !?[]const u8 {
        while (true) {
            if (!self.valid) {
                if (self.pattern_idx < self.patterns.len) {
                    try self.initWalker();
                    self.valid = true;
                } else {
                    return null;
                }
            }
            if (try self.walkerNext()) |path| {
                return path;
            } else {
                self.valid = false;
                self.pattern_idx += 1;
                self.deinitWalker();
            }
        }
    }
};
