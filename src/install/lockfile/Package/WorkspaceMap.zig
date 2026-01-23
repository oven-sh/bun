const WorkspaceMap = @This();

map: Map,

const Map = bun.StringArrayHashMap(Entry);
pub const Entry = struct {
    name: string,
    version: ?string,
    name_loc: logger.Loc,
};

pub fn init(allocator: std.mem.Allocator) WorkspaceMap {
    return .{
        .map = Map.init(allocator),
    };
}

pub fn keys(self: WorkspaceMap) []const string {
    return self.map.keys();
}

pub fn values(self: WorkspaceMap) []const Entry {
    return self.map.values();
}

pub fn count(self: WorkspaceMap) usize {
    return self.map.count();
}

pub fn insert(self: *WorkspaceMap, key: string, value: Entry) !void {
    if (comptime Environment.isDebug) {
        if (!bun.sys.exists(key)) {
            Output.debugWarn("WorkspaceMap.insert: key {s} does not exist", .{key});
        }
    }

    const entry = try self.map.getOrPut(key);
    if (!entry.found_existing) {
        entry.key_ptr.* = try self.map.allocator.dupe(u8, key);
    } else {
        self.map.allocator.free(entry.value_ptr.name);
    }

    entry.value_ptr.* = .{
        .name = value.name,
        .version = value.version,
        .name_loc = value.name_loc,
    };
}

pub fn sort(self: *WorkspaceMap, sort_ctx: anytype) void {
    self.map.sort(sort_ctx);
}

pub fn deinit(self: *WorkspaceMap) void {
    for (self.map.values()) |value| {
        self.map.allocator.free(value.name);
    }

    for (self.map.keys()) |key| {
        self.map.allocator.free(key);
    }

    self.map.deinit();
}

fn processWorkspaceName(
    allocator: std.mem.Allocator,
    json_cache: *PackageManager.WorkspacePackageJSONCache,
    abs_package_json_path: [:0]const u8,
    log: *logger.Log,
) !Entry {
    const workspace_json = try json_cache.getWithPath(allocator, log, abs_package_json_path, .{
        .init_reset_store = false,
        .guess_indentation = true,
    }).unwrap();

    const name_expr = workspace_json.root.get("name") orelse return error.MissingPackageName;
    const name = try name_expr.asStringCloned(allocator) orelse return error.MissingPackageName;

    const entry = Entry{
        .name = name,
        .name_loc = name_expr.loc,
        .version = brk: {
            if (workspace_json.root.get("version")) |version_expr| {
                if (try version_expr.asStringCloned(allocator)) |version| {
                    break :brk version;
                }
            }

            break :brk null;
        },
    };
    debug("processWorkspaceName({s}) = {s}", .{ abs_package_json_path, entry.name });

    return entry;
}

pub fn processNamesArray(
    workspace_names: *WorkspaceMap,
    allocator: Allocator,
    json_cache: *PackageManager.WorkspacePackageJSONCache,
    log: *logger.Log,
    arr: *JSAst.E.Array,
    source: *const logger.Source,
    loc: logger.Loc,
    string_builder: ?*StringBuilder,
) !u32 {
    if (arr.items.len == 0) return 0;

    const orig_msgs_len = log.msgs.items.len;

    var workspace_globs = std.array_list.Managed(string).init(allocator);
    defer workspace_globs.deinit();
    const filepath_bufOS = allocator.create(bun.PathBuffer) catch unreachable;
    const filepath_buf = std.mem.asBytes(filepath_bufOS);
    defer allocator.destroy(filepath_bufOS);

    for (arr.slice()) |item| {
        // TODO: when does this get deallocated?
        const input_path = try item.asStringZ(allocator) orelse {
            log.addErrorFmt(source, item.loc, allocator,
                \\Workspaces expects an array of strings, like:
                \\  <r><green>"workspaces"<r>: [
                \\    <green>"path/to/package"<r>
                \\  ]
            , .{}) catch {};
            return error.InvalidPackageJSON;
        };

        if (input_path.len == 0 or input_path.len == 1 and input_path[0] == '.' or strings.eqlComptime(input_path, "./") or strings.eqlComptime(input_path, ".\\")) continue;

        if (glob.detectGlobSyntax(input_path)) {
            bun.handleOom(workspace_globs.append(input_path));
            continue;
        }

        const abs_package_json_path: stringZ = Path.joinAbsStringBufZ(
            source.path.name.dir,
            filepath_buf,
            &.{ input_path, "package.json" },
            .auto,
        );

        // skip root package.json
        if (strings.eqlLong(bun.path.dirname(abs_package_json_path, .auto), source.path.name.dir, true)) continue;

        const workspace_entry = processWorkspaceName(
            allocator,
            json_cache,
            abs_package_json_path,
            log,
        ) catch |err| {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            switch (err) {
                error.EISNOTDIR, error.EISDIR, error.EACCESS, error.EPERM, error.ENOENT, error.FileNotFound => {
                    log.addErrorFmt(
                        source,
                        item.loc,
                        allocator,
                        "Workspace not found \"{s}\"",
                        .{input_path},
                    ) catch {};
                },
                error.MissingPackageName => {
                    log.addErrorFmt(
                        source,
                        loc,
                        allocator,
                        "Missing \"name\" from package.json in {s}",
                        .{input_path},
                    ) catch {};
                },
                else => {
                    log.addErrorFmt(
                        source,
                        item.loc,
                        allocator,
                        "{s} reading package.json for workspace package \"{s}\" from \"{s}\"",
                        .{ @errorName(err), input_path, bun.getcwd(allocator.alloc(u8, bun.MAX_PATH_BYTES) catch unreachable) catch unreachable },
                    ) catch {};
                },
            }
            continue;
        };

        if (workspace_entry.name.len == 0) continue;

        const rel_input_path = Path.relativePlatform(
            source.path.name.dir,
            strings.withoutSuffixComptime(abs_package_json_path, std.fs.path.sep_str ++ "package.json"),
            .auto,
            true,
        );
        if (comptime Environment.isWindows) {
            Path.dangerouslyConvertPathToPosixInPlace(u8, @constCast(rel_input_path));
        }

        if (string_builder) |builder| {
            builder.count(workspace_entry.name);
            builder.count(rel_input_path);
            builder.cap += bun.MAX_PATH_BYTES;
            if (workspace_entry.version) |version_string| {
                builder.count(version_string);
            }
        }

        try workspace_names.insert(rel_input_path, .{
            .name = workspace_entry.name,
            .name_loc = workspace_entry.name_loc,
            .version = workspace_entry.version,
        });
    }

    if (workspace_globs.items.len > 0) {
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        for (workspace_globs.items, 0..) |user_pattern, i| {
            defer _ = arena.reset(.retain_capacity);

            const glob_pattern = if (user_pattern.len == 0) "package.json" else brk: {
                const parts = [_][]const u8{ user_pattern, "package.json" };
                break :brk bun.handleOom(arena.allocator().dupe(u8, bun.path.join(parts, .auto)));
            };

            var walker: GlobWalker = .{};
            var cwd = bun.path.dirname(source.path.text, .auto);
            cwd = if (bun.strings.eql(cwd, "")) bun.fs.FileSystem.instance.top_level_dir else cwd;
            if ((try walker.initWithCwd(&arena, glob_pattern, cwd, false, false, false, false, true)).asErr()) |e| {
                log.addErrorFmt(
                    source,
                    loc,
                    allocator,
                    "Failed to run workspace pattern <b>{s}<r> due to error <b>{s}<r>",
                    .{ user_pattern, @tagName(e.getErrno()) },
                ) catch {};
                return error.GlobError;
            }
            defer walker.deinit(false);

            var iter: GlobWalker.Iterator = .{
                .walker = &walker,
            };
            defer iter.deinit();
            if ((try iter.init()).asErr()) |e| {
                log.addErrorFmt(
                    source,
                    loc,
                    allocator,
                    "Failed to run workspace pattern <b>{s}<r> due to error <b>{s}<r>",
                    .{ user_pattern, @tagName(e.getErrno()) },
                ) catch {};
                return error.GlobError;
            }

            next_match: while (switch (try iter.next()) {
                .result => |r| r,
                .err => |e| {
                    log.addErrorFmt(
                        source,
                        loc,
                        allocator,
                        "Failed to run workspace pattern <b>{s}<r> due to error <b>{s}<r>",
                        .{ user_pattern, @tagName(e.getErrno()) },
                    ) catch {};
                    return error.GlobError;
                },
            }) |matched_path| {
                const entry_dir: []const u8 = Path.dirname(matched_path, .auto);

                // skip root package.json
                if (strings.eqlComptime(matched_path, "package.json")) continue;

                {
                    const matched_path_without_package_json = strings.withoutTrailingSlash(strings.withoutSuffixComptime(matched_path, "package.json"));

                    // check if it's negated by any remaining patterns
                    for (workspace_globs.items[i + 1 ..]) |next_pattern| {
                        switch (bun.glob.match(next_pattern, matched_path_without_package_json)) {
                            .no_match,
                            .match,
                            .negate_match,
                            => {},

                            .negate_no_match => {
                                debug("skipping negated path: {s}, {s}\n", .{
                                    matched_path_without_package_json,
                                    next_pattern,
                                });
                                continue :next_match;
                            },
                        }
                    }
                }

                debug("matched path: {s}, dirname: {s}\n", .{ matched_path, entry_dir });

                const abs_package_json_path = Path.joinAbsStringBufZ(
                    cwd,
                    filepath_buf,
                    &.{ entry_dir, "package.json" },
                    .auto,
                );
                const abs_workspace_dir_path: string = strings.withoutSuffixComptime(abs_package_json_path, "package.json");

                const workspace_entry = processWorkspaceName(
                    allocator,
                    json_cache,
                    abs_package_json_path,
                    log,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());

                    const entry_base: []const u8 = Path.basename(matched_path);
                    switch (err) {
                        error.FileNotFound, error.PermissionDenied => continue,
                        error.MissingPackageName => {
                            log.addErrorFmt(
                                source,
                                logger.Loc.Empty,
                                allocator,
                                "Missing \"name\" from package.json in {s}" ++ std.fs.path.sep_str ++ "{s}",
                                .{ entry_dir, entry_base },
                            ) catch {};
                        },
                        else => {
                            log.addErrorFmt(
                                source,
                                logger.Loc.Empty,
                                allocator,
                                "{s} reading package.json for workspace package \"{s}\" from \"{s}\"",
                                .{ @errorName(err), entry_dir, entry_base },
                            ) catch {};
                        },
                    }

                    continue;
                };

                if (workspace_entry.name.len == 0) continue;

                const workspace_path: string = Path.relativePlatform(
                    source.path.name.dir,
                    abs_workspace_dir_path,
                    .auto,
                    true,
                );
                if (comptime Environment.isWindows) {
                    Path.dangerouslyConvertPathToPosixInPlace(u8, @constCast(workspace_path));
                }

                if (string_builder) |builder| {
                    builder.count(workspace_entry.name);
                    builder.count(workspace_path);
                    builder.cap += bun.MAX_PATH_BYTES;
                    if (workspace_entry.version) |version| {
                        builder.count(version);
                    }
                }

                try workspace_names.insert(workspace_path, .{
                    .name = workspace_entry.name,
                    .version = workspace_entry.version,
                    .name_loc = workspace_entry.name_loc,
                });
            }
        }
    }

    if (orig_msgs_len != log.msgs.items.len) return error.InstallFailed;

    // Sort the names for determinism
    workspace_names.sort(struct {
        values: []const WorkspaceMap.Entry,
        pub fn lessThan(
            self: @This(),
            a: usize,
            b: usize,
        ) bool {
            return strings.order(self.values[a].name, self.values[b].name) == .lt;
        }
    }{
        .values = workspace_names.values(),
    });

    return @truncate(workspace_names.count());
}

const IGNORED_PATHS: []const []const u8 = &.{
    "node_modules",
    ".git",
    "CMakeFiles",
};
fn ignoredWorkspacePaths(path: []const u8) bool {
    inline for (IGNORED_PATHS) |ignored| {
        if (bun.strings.eqlComptime(path, ignored)) return true;
    }
    return false;
}
const GlobWalker = glob.GlobWalker(ignoredWorkspacePaths, glob.walk.SyscallAccessor, false);

const string = []const u8;
const debug = Output.scoped(.Lockfile, .hidden);
const stringZ = [:0]const u8;

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const JSAst = bun.ast;
const Output = bun.Output;
const Path = bun.path;
const glob = bun.glob;
const logger = bun.logger;
const strings = bun.strings;

const install = bun.install;
const PackageManager = bun.install.PackageManager;

const Lockfile = install.Lockfile;
const StringBuilder = Lockfile.StringBuilder;
