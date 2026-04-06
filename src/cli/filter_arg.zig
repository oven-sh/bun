const SKIP_LIST = .{
    // skip hidden directories
    ".",

    // skip node_modules
    "node_modules",

    // skip .git folder
    ".git",
};
fn globIgnoreFn(val: []const u8) bool {
    if (val.len == 0) {
        return false;
    }

    inline for (SKIP_LIST) |skip| {
        if (strings.eqlComptime(val, skip)) {
            return true;
        }
    }

    return false;
}

const GlobWalker = glob.GlobWalker(globIgnoreFn, glob.walk.DirEntryAccessor, false);

pub fn getCandidatePackagePatterns(allocator: std.mem.Allocator, log: *bun.logger.Log, out_patterns: *std.array_list.Managed([]u8), workdir_: []const u8, root_buf: *bun.PathBuffer) ![]const u8 {
    bun.ast.Expr.Data.Store.create();
    bun.ast.Stmt.Data.Store.create();
    defer {
        bun.ast.Expr.Data.Store.reset();
        bun.ast.Stmt.Data.Store.reset();
    }

    var workdir = workdir_;

    while (true) : (workdir = std.fs.path.dirname(workdir) orelse break) {
        var name_buf: bun.PathBuffer = undefined;
        const json_path: [:0]const u8 = bun.path.joinAbsStringBufZ(workdir, name_buf[0..], &.{"package.json"}, .auto);

        log.msgs.clearRetainingCapacity();
        log.errors = 0;
        log.warnings = 0;

        const json_source = switch (bun.sys.File.toSource(json_path, allocator, .{})) {
            .err => |err| {
                switch (err.getErrno()) {
                    .NOENT, .ACCES, .PERM => continue,
                    else => |errno| return bun.errnoToZigErr(errno),
                }
            },
            .result => |source| source,
        };
        defer allocator.free(json_source.contents);

        const json = try JSON.parsePackageJSONUTF8(&json_source, log, allocator);

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
                    const size = pattern_expr.data.len + "/package.json".len;
                    var pattern = try allocator.alloc(u8, size);
                    @memcpy(pattern[0..pattern_expr.data.len], pattern_expr.data);
                    @memcpy(pattern[pattern_expr.data.len..size], "/package.json");

                    try out_patterns.append(pattern);
                },
                else => {
                    Output.prettyErrorln("<r><red>error<r>: Failed to parse \"workspaces\" property: all items must be strings", .{});
                    Global.exit(1);
                },
            }
        }

        const parent_trimmed = strings.withoutTrailingSlash(workdir);
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

    // TODO: Pattern should be
    //  union (enum) { name: []const u32, path: []const u32, any_name: void }
    filters: []Pattern,
    has_name_filters: bool = false,
    match_all: bool = false,

    pub fn matches(this: *const FilterSet, path: []const u8, name: []const u8) bool {
        if (this.match_all) {
            // allow empty name if there are any filters which are a relative path
            // --filter="*" --filter="./bar" script
            if (name.len > 0) {
                return true;
            }
        }

        if (this.has_name_filters) {
            return this.matchesPathName(path, name);
        }

        return this.matchesPath(path);
    }

    const Pattern = struct {
        pattern: []const u8,
        kind: enum {
            name,
            /// THIS MEANS THE PATTERN IS ALLOCATED ON THE HEAP! FREE IT!
            path,
        },
        // negate: bool = false,
    };

    pub fn init(allocator: std.mem.Allocator, filters: []const []const u8, cwd_: []const u8) !FilterSet {
        const cwd = cwd_;

        var buf: bun.PathBuffer = undefined;
        // TODO fixed buffer allocator with fallback?
        var list = try std.array_list.Managed(Pattern).initCapacity(allocator, filters.len);
        var self = FilterSet{ .allocator = allocator, .filters = &.{} };
        for (filters) |filter_utf8_| {
            if (strings.eqlComptime(filter_utf8_, "*") or strings.eqlComptime(filter_utf8_, "**")) {
                self.match_all = true;
                continue;
            }

            var filter_utf8 = filter_utf8_;
            const is_path = filter_utf8.len > 0 and filter_utf8[0] == '.';
            if (is_path) {
                const parts = [_]string{filter_utf8};
                const filter_utf8_temp = try allocator.dupe(u8, bun.path.joinAbsStringBuf(cwd, &buf, &parts, .loose));
                std.mem.replaceScalar(u8, filter_utf8_temp, '\\', '/');
                filter_utf8 = filter_utf8_temp;
                try list.append(.{
                    .pattern = filter_utf8,
                    .kind = .path,
                });
            } else {
                self.has_name_filters = true;
                try list.append(.{
                    .pattern = filter_utf8,
                    .kind = .name,
                });
            }
        }
        self.filters = list.items;
        return self;
    }

    pub fn deinit(self: *FilterSet) void {
        for (self.filters) |filter| {
            if (filter.kind == .path) {
                self.allocator.free(filter.pattern);
            }
        }
        self.allocator.free(self.filters);
    }

    pub fn matchesPath(self: *const FilterSet, path: []const u8) bool {
        for (self.filters) |filter| {
            if (glob.match(filter.pattern, path).matches()) {
                return true;
            }
        }
        return false;
    }

    pub fn matchesPathName(self: *const FilterSet, path: []const u8, name: []const u8) bool {
        for (self.filters) |filter| {
            const target = switch (filter.kind) {
                .name => name,
                .path => path,
            };
            if (glob.match(filter.pattern, target).matches()) {
                return true;
            }
        }
        return false;
    }
};

pub const PackageFilterIterator = struct {
    patterns: []const []const u8,
    pattern_idx: usize = 0,
    root_dir: []const u8,

    walker: GlobWalker = undefined,
    iter: GlobWalker.Iterator = undefined,
    valid: bool = false,

    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, patterns: []const []const u8, root_dir: []const u8) !PackageFilterIterator {
        return PackageFilterIterator{
            .patterns = patterns,
            .allocator = allocator,
            .root_dir = root_dir,
        };
    }

    pub fn deinit(self: *PackageFilterIterator) void {
        if (self.valid) {
            self.deinitWalker();
        }
    }

    fn walkerNext(self: *PackageFilterIterator) !?[]const u8 {
        while (true) {
            switch (try self.iter.next()) {
                .err => |err| {
                    Output.prettyErrorln("Error: {f}", .{err});
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
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        errdefer arena.deinit();
        const cwd = try arena.allocator().dupe(u8, self.root_dir);
        try (try self.walker.initWithCwd(&arena, pattern, cwd, true, true, false, true, true)).unwrap();
        self.iter = GlobWalker.Iterator{ .walker = &self.walker };
        try (try self.iter.init()).unwrap();
    }

    fn deinitWalker(self: *PackageFilterIterator) void {
        self.walker.deinit(false);
        self.iter.deinit();
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const JSON = bun.json;
const Output = bun.Output;
const glob = bun.glob;
const strings = bun.strings;
