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
    const root_dir = source.path.name.dir;

    // Process the top-level workspaces array
    try processNamesArrayOnePass(
        workspace_names,
        allocator,
        json_cache,
        log,
        arr,
        source,
        root_dir,
        loc,
        string_builder,
    );

    if (orig_msgs_len != log.msgs.items.len) return error.InstallFailed;

    // Recursively discover nested workspaces declared in sub-packages' own
    // `workspaces` fields. Patterns in each sub-package's `workspaces` field
    // are resolved relative to that sub-package's directory, but stored as
    // paths relative to the original root. Nested discovery is best-effort:
    // if a sub-package's nested field is broken, we roll back any log
    // messages it produced and move on — the user can always list the
    // problematic path directly in the root `workspaces` to get a loud
    // error. OOM propagates, nothing else does.
    const nested_msgs_snapshot = log.msgs.items.len;
    const nested_warnings_snapshot = log.warnings;
    const nested_errors_snapshot = log.errors;
    discoverNestedWorkspaces(
        workspace_names,
        allocator,
        json_cache,
        log,
        root_dir,
        string_builder,
    ) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => {},
    };
    // Deinit the discarded messages — Msg owns its text/notes allocations.
    for (log.msgs.items[nested_msgs_snapshot..]) |*msg| {
        msg.deinit(log.msgs.allocator);
    }
    log.msgs.shrinkRetainingCapacity(nested_msgs_snapshot);
    log.warnings = nested_warnings_snapshot;
    log.errors = nested_errors_snapshot;

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

/// Single pass over a `workspaces` array. `base_dir` is the directory that stored
/// workspace paths should be relative to (usually the root package.json's dir).
/// For the top-level call, `base_dir == source.path.name.dir`. For nested discovery,
/// `base_dir` stays as the original root while `source` points at the sub-package.
fn processNamesArrayOnePass(
    workspace_names: *WorkspaceMap,
    allocator: Allocator,
    json_cache: *PackageManager.WorkspacePackageJSONCache,
    log: *logger.Log,
    arr: *JSAst.E.Array,
    source: *const logger.Source,
    base_dir: []const u8,
    loc: logger.Loc,
    string_builder: ?*StringBuilder,
) !void {
    if (arr.items.len == 0) return;

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
            base_dir,
            strings.withoutSuffixComptime(abs_package_json_path, std.fs.path.sep_str ++ "package.json"),
            .auto,
            true,
        );
        if (comptime Environment.isWindows) {
            Path.dangerouslyConvertPathToPosixInPlace(u8, @constCast(rel_input_path));
        }

        // Skip if this resolves back to the base_dir (the root package itself)
        if (rel_input_path.len == 0 or strings.eqlComptime(rel_input_path, ".")) continue;

        // Deduplicate: avoid double-counting the string_builder when the same
        // workspace is discovered via multiple paths (overlapping patterns or
        // nested workspace declarations).
        if (workspace_names.map.contains(rel_input_path)) continue;

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
                    base_dir,
                    abs_workspace_dir_path,
                    .auto,
                    true,
                );
                if (comptime Environment.isWindows) {
                    Path.dangerouslyConvertPathToPosixInPlace(u8, @constCast(workspace_path));
                }

                // Skip if this resolves back to the base_dir (the root package itself)
                if (workspace_path.len == 0 or strings.eqlComptime(workspace_path, ".")) continue;

                // Deduplicate: see comment in the non-glob branch above.
                if (workspace_names.map.contains(workspace_path)) continue;

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
}

/// Scan each already-registered workspace's package.json for its own
/// `workspaces` field and add any discovered packages to the map. Iterates
/// by index so that packages added mid-loop are naturally scanned too,
/// supporting arbitrary nesting depth. The map itself prevents cycles and
/// duplicates.
fn discoverNestedWorkspaces(
    workspace_names: *WorkspaceMap,
    allocator: Allocator,
    json_cache: *PackageManager.WorkspacePackageJSONCache,
    log: *logger.Log,
    root_dir: []const u8,
    string_builder: ?*StringBuilder,
) !void {
    const filepath_bufOS = bun.handleOom(allocator.create(bun.PathBuffer));
    const filepath_buf = std.mem.asBytes(filepath_bufOS);
    defer allocator.destroy(filepath_bufOS);

    var index: usize = 0;
    while (index < workspace_names.count()) : (index += 1) {
        // The map's key storage can be reallocated when new entries are inserted,
        // so copy the path before we trigger any new processing.
        const rel_path = try allocator.dupe(u8, workspace_names.keys()[index]);
        defer allocator.free(rel_path);

        const abs_package_json_path: stringZ = Path.joinAbsStringBufZ(
            root_dir,
            filepath_buf,
            &.{ rel_path, "package.json" },
            .auto,
        );

        // getWithPath caches successful reads, and every workspace in the map
        // already parsed successfully in processNamesArrayOnePass, so this is
        // a cache hit for registered workspaces. A miss here means the file
        // moved between passes — skip it rather than aborting discovery.
        // OOM from the JSON parse path still propagates.
        const cached = json_cache.getWithPath(
            allocator,
            log,
            abs_package_json_path,
            .{
                .init_reset_store = false,
                .guess_indentation = true,
            },
        ).unwrap() catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => continue,
        };

        const workspaces_expr = cached.root.get("workspaces") orelse continue;

        const nested_arr: *JSAst.E.Array = switch (workspaces_expr.data) {
            .e_array => |nested| nested,
            .e_object => |obj| if (obj.get("packages")) |packages| switch (packages.data) {
                .e_array => |nested| nested,
                else => continue,
            } else continue,
            else => continue,
        };

        if (nested_arr.items.len == 0) continue;

        // Copy `cached.source` by value: `cached` is a pointer into the
        // json_cache HashMap, which processNamesArrayOnePass can grow via
        // its own getWithPath calls — a resize would free the backing
        // array and make `&cached.source` dangling. The slices inside
        // Source point to allocations outside the HashMap, so a by-value
        // copy is stable for the duration of the recursive call.
        const source_copy = cached.source;

        // Best-effort per sub-package: a broken nested `workspaces` field
        // in one sibling shouldn't stop discovery of the others. Only OOM
        // is fatal. The caller rolls back log messages from this recursive
        // pass, so logged errors get swallowed there anyway.
        processNamesArrayOnePass(
            workspace_names,
            allocator,
            json_cache,
            log,
            nested_arr,
            &source_copy,
            root_dir,
            workspaces_expr.loc,
            string_builder,
        ) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => continue,
        };
    }
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
