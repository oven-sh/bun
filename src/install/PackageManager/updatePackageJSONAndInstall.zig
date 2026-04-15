pub fn updatePackageJSONAndInstallWithManager(
    manager: *PackageManager,
    ctx: Command.Context,
    original_cwd: string,
) !void {
    var update_requests = bun.handleOom(UpdateRequest.Array.initCapacity(manager.allocator, 64));
    defer update_requests.deinit(manager.allocator);

    if (manager.options.positionals.len <= 1) {
        switch (manager.subcommand) {
            .add => {
                Output.errGeneric("no package specified to add", .{});
                Output.flush();
                PackageManager.CommandLineArguments.printHelp(.add);

                Global.exit(0);
            },
            .remove => {
                Output.errGeneric("no package specified to remove", .{});
                Output.flush();
                PackageManager.CommandLineArguments.printHelp(.remove);

                Global.exit(0);
            },
            .update => {},
            else => {},
        }
    }

    return try updatePackageJSONAndInstallWithManagerWithUpdatesAndUpdateRequests(
        manager,
        ctx,
        original_cwd,
        manager.options.positionals[1..],
        &update_requests,
    );
}

fn updatePackageJSONAndInstallWithManagerWithUpdatesAndUpdateRequests(
    manager: *PackageManager,
    ctx: Command.Context,
    original_cwd: string,
    positionals: []const string,
    update_requests: *UpdateRequest.Array,
) !void {
    var updates: []UpdateRequest = if (manager.subcommand == .@"patch-commit" or manager.subcommand == .patch)
        &[_]UpdateRequest{}
    else
        UpdateRequest.parse(ctx.allocator, manager, ctx.log, positionals, update_requests, manager.subcommand);
    try updatePackageJSONAndInstallWithManagerWithUpdates(
        manager,
        ctx,
        &updates,
        manager.subcommand,
        original_cwd,
    );
}

fn updatePackageJSONAndInstallWithManagerWithUpdates(
    manager: *PackageManager,
    ctx: Command.Context,
    updates: *[]UpdateRequest,
    subcommand: Subcommand,
    original_cwd: string,
) !void {
    const log_level = manager.options.log_level;
    if (manager.log.errors > 0) {
        if (log_level != .silent) {
            manager.log.print(Output.errorWriter()) catch {};
        }
        Global.crash();
    }

    // `bun update -r [--latest]` and `bun update --filter=<pattern> [--latest]` (no
    // positional package names) should edit every matching workspace's package.json,
    // not just the current workspace. The interactive update path already handles this
    // via `update_interactive_command.zig`; this branch mirrors that flow for the
    // non-interactive case.
    if (subcommand == .update and updates.len == 0 and
        (manager.options.do.recursive or manager.options.filter_patterns.len > 0))
    {
        return updateAllWorkspacesNonInteractive(manager, ctx, original_cwd);
    }

    var current_package_json = switch (manager.workspace_package_json_cache.getWithPath(
        manager.allocator,
        manager.log,
        manager.original_package_json_path,
        .{
            .guess_indentation = true,
        },
    )) {
        .parse_err => |err| {
            manager.log.print(Output.errorWriter()) catch {};
            Output.errGeneric("failed to parse package.json \"{s}\": {s}", .{
                manager.original_package_json_path,
                @errorName(err),
            });
            Global.crash();
        },
        .read_err => |err| {
            Output.errGeneric("failed to read package.json \"{s}\": {s}", .{
                manager.original_package_json_path,
                @errorName(err),
            });
            Global.crash();
        },
        .entry => |entry| entry,
    };
    const current_package_json_indent = current_package_json.indentation;

    // If there originally was a newline at the end of their package.json, preserve it
    // so that we don't cause unnecessary diffs in their git history.
    // https://github.com/oven-sh/bun/issues/1375
    const preserve_trailing_newline_at_eof_for_package_json = current_package_json.source.contents.len > 0 and
        current_package_json.source.contents[current_package_json.source.contents.len - 1] == '\n';

    if (subcommand == .remove) {
        if (current_package_json.root.data != .e_object) {
            Output.errGeneric("package.json is not an Object {{}}, so there's nothing to {s}!", .{@tagName(subcommand)});
            Global.crash();
        } else if (current_package_json.root.data.e_object.properties.len == 0) {
            Output.errGeneric("package.json is empty {{}}, so there's nothing to {s}!", .{@tagName(subcommand)});
            Global.crash();
        } else if (current_package_json.root.asProperty("devDependencies") == null and
            current_package_json.root.asProperty("dependencies") == null and
            current_package_json.root.asProperty("optionalDependencies") == null and
            current_package_json.root.asProperty("peerDependencies") == null)
        {
            Output.prettyErrorln("package.json doesn't have dependencies, there's nothing to {s}!", .{@tagName(subcommand)});
            Global.exit(0);
        }
    }

    const dependency_list = if (manager.options.update.development)
        "devDependencies"
    else if (manager.options.update.optional)
        "optionalDependencies"
    else if (manager.options.update.peer)
        "peerDependencies"
    else
        "dependencies";
    var any_changes = false;

    var not_in_workspace_root: ?PatchCommitResult = null;
    switch (subcommand) {
        .remove => {
            // if we're removing, they don't have to specify where it is installed in the dependencies list
            // they can even put it multiple times and we will just remove all of them
            for (updates.*) |request| {
                inline for ([_]string{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" }) |list| {
                    if (current_package_json.root.asProperty(list)) |query| {
                        if (query.expr.data == .e_object) {
                            var dependencies = query.expr.data.e_object.properties.slice();
                            var i: usize = 0;
                            var new_len = dependencies.len;
                            while (i < dependencies.len) : (i += 1) {
                                if (dependencies[i].key.?.data == .e_string) {
                                    if (dependencies[i].key.?.data.e_string.eql(string, request.name)) {
                                        if (new_len > 1) {
                                            dependencies[i] = dependencies[new_len - 1];
                                            new_len -= 1;
                                        } else {
                                            new_len = 0;
                                        }

                                        any_changes = true;
                                    }
                                }
                            }

                            const changed = new_len != dependencies.len;
                            if (changed) {
                                query.expr.data.e_object.properties.len = @as(u32, @truncate(new_len));

                                // If the dependencies list is now empty, remove it from the package.json
                                // since we're swapRemove, we have to re-sort it
                                if (query.expr.data.e_object.properties.len == 0) {
                                    // TODO: Theoretically we could change these two lines to
                                    // `.orderedRemove(query.i)`, but would that change user-facing
                                    // behavior?
                                    _ = current_package_json.root.data.e_object.properties.swapRemove(query.i);
                                    current_package_json.root.data.e_object.packageJSONSort();
                                } else {
                                    var obj = query.expr.data.e_object;
                                    obj.alphabetizeProperties();
                                }
                            }
                        }
                    }
                }
            }
        },

        .link, .add, .update => {
            // `bun update <package>` is basically the same as `bun add <package>`, except
            // update will not exceed the current dependency range if it exists

            if (updates.len != 0) {
                try PackageJSONEditor.edit(
                    manager,
                    updates,
                    &current_package_json.root,
                    dependency_list,
                    .{
                        .exact_versions = manager.options.enable.exact_versions,
                        .before_install = true,
                    },
                );
            } else if (subcommand == .update) {
                try PackageJSONEditor.editUpdateNoArgs(
                    manager,
                    &current_package_json.root,
                    .{
                        .exact_versions = true,
                        .before_install = true,
                    },
                );
            }
        },
        else => {
            if (manager.options.patch_features == .commit) {
                var pathbuf: bun.PathBuffer = undefined;
                if (try manager.doPatchCommit(&pathbuf, log_level)) |stuff| {
                    // we're inside a workspace package, we need to edit the
                    // root json, not the `current_package_json`
                    if (stuff.not_in_workspace_root) {
                        not_in_workspace_root = stuff;
                    } else {
                        try PackageJSONEditor.editPatchedDependencies(
                            manager,
                            &current_package_json.root,
                            stuff.patch_key,
                            stuff.patchfile_path,
                        );
                    }
                }
            }
        },
    }

    manager.to_update = subcommand == .update;

    {
        // Incase it's a pointer to self. Avoid RLS.
        const cloned = updates.*;
        manager.update_requests = cloned;
    }

    var buffer_writer = JSPrinter.BufferWriter.init(manager.allocator);
    try buffer_writer.buffer.list.ensureTotalCapacity(manager.allocator, current_package_json.source.contents.len + 1);
    buffer_writer.append_newline = preserve_trailing_newline_at_eof_for_package_json;
    var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

    var written = JSPrinter.printJSON(
        @TypeOf(&package_json_writer),
        &package_json_writer,
        current_package_json.root,
        &current_package_json.source,
        .{
            .indent = current_package_json_indent,
            .mangled_props = null,
        },
    ) catch |err| {
        Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
        Global.crash();
    };

    // There are various tradeoffs with how we commit updates when you run `bun add` or `bun remove`
    // The one we chose here is to effectively pretend a human did:
    // 1. "bun add react@latest"
    // 2. open lockfile, find what react resolved to
    // 3. open package.json
    // 4. replace "react" : "latest" with "react" : "^16.2.0"
    // 5. save package.json
    // The Smarter™ approach is you resolve ahead of time and write to disk once!
    // But, turns out that's slower in any case where more than one package has to be resolved (most of the time!)
    // Concurrent network requests are faster than doing one and then waiting until the next batch
    var new_package_json_source = try manager.allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());
    current_package_json.source.contents = new_package_json_source;

    // may or may not be the package json we are editing
    const top_level_dir_without_trailing_slash = strings.withoutTrailingSlash(FileSystem.instance.top_level_dir);

    var root_package_json_path_buf: bun.PathBuffer = undefined;
    const root_package_json_path = root_package_json_path: {
        @memcpy(root_package_json_path_buf[0..top_level_dir_without_trailing_slash.len], top_level_dir_without_trailing_slash);
        @memcpy(root_package_json_path_buf[top_level_dir_without_trailing_slash.len..][0.."/package.json".len], "/package.json");
        const root_package_json_path = root_package_json_path_buf[0 .. top_level_dir_without_trailing_slash.len + "/package.json".len];
        root_package_json_path_buf[root_package_json_path.len] = 0;

        // The lifetime of this pointer is only valid until the next call to `getWithPath`, which can happen after this scope.
        // https://github.com/oven-sh/bun/issues/12288
        const root_package_json = switch (manager.workspace_package_json_cache.getWithPath(
            manager.allocator,
            manager.log,
            root_package_json_path,
            .{
                .guess_indentation = true,
            },
        )) {
            .parse_err => |err| {
                manager.log.print(Output.errorWriter()) catch {};
                Output.errGeneric("failed to parse package.json \"{s}\": {s}", .{
                    root_package_json_path,
                    @errorName(err),
                });
                Global.crash();
            },
            .read_err => |err| {
                Output.errGeneric("failed to read package.json \"{s}\": {s}", .{
                    manager.original_package_json_path,
                    @errorName(err),
                });
                Global.crash();
            },
            .entry => |entry| entry,
        };

        if (not_in_workspace_root) |stuff| {
            try PackageJSONEditor.editPatchedDependencies(
                manager,
                &root_package_json.root,
                stuff.patch_key,
                stuff.patchfile_path,
            );
            var buffer_writer2 = JSPrinter.BufferWriter.init(manager.allocator);
            try buffer_writer2.buffer.list.ensureTotalCapacity(manager.allocator, root_package_json.source.contents.len + 1);
            buffer_writer2.append_newline = preserve_trailing_newline_at_eof_for_package_json;
            var package_json_writer2 = JSPrinter.BufferPrinter.init(buffer_writer2);

            _ = JSPrinter.printJSON(
                @TypeOf(&package_json_writer2),
                &package_json_writer2,
                root_package_json.root,
                &root_package_json.source,
                .{
                    .indent = root_package_json.indentation,
                    .mangled_props = null,
                },
            ) catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                Global.crash();
            };
            root_package_json.source.contents = try manager.allocator.dupe(u8, package_json_writer2.ctx.writtenWithoutTrailingZero());
        }

        break :root_package_json_path root_package_json_path_buf[0..root_package_json_path.len :0];
    };

    try manager.installWithManager(ctx, root_package_json_path, original_cwd);

    if (subcommand == .update or subcommand == .add or subcommand == .link) {
        for (updates.*) |request| {
            if (request.failed) {
                Global.exit(1);
                return;
            }
        }

        const source = &logger.Source.initPathString("package.json", new_package_json_source);

        // Now, we _re_ parse our in-memory edited package.json
        // so we can commit the version we changed from the lockfile
        var new_package_json = JSON.parsePackageJSONUTF8(source, manager.log, manager.allocator) catch |err| {
            Output.prettyErrorln("package.json failed to parse due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        if (updates.len == 0) {
            try PackageJSONEditor.editUpdateNoArgs(
                manager,
                &new_package_json,
                .{
                    .exact_versions = manager.options.enable.exact_versions,
                },
            );
        } else {
            try PackageJSONEditor.edit(
                manager,
                updates,
                &new_package_json,
                dependency_list,
                .{
                    .exact_versions = manager.options.enable.exact_versions,
                    .add_trusted_dependencies = manager.options.do.trust_dependencies_from_args,
                },
            );
        }
        var buffer_writer_two = JSPrinter.BufferWriter.init(manager.allocator);
        try buffer_writer_two.buffer.list.ensureTotalCapacity(manager.allocator, source.contents.len + 1);
        buffer_writer_two.append_newline =
            preserve_trailing_newline_at_eof_for_package_json;
        var package_json_writer_two = JSPrinter.BufferPrinter.init(buffer_writer_two);

        written = JSPrinter.printJSON(
            @TypeOf(&package_json_writer_two),
            &package_json_writer_two,
            new_package_json,
            source,
            .{
                .indent = current_package_json_indent,
                .mangled_props = null,
            },
        ) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        new_package_json_source = try manager.allocator.dupe(u8, package_json_writer_two.ctx.writtenWithoutTrailingZero());
    }

    if (manager.options.do.write_package_json) {
        const source, const path = if (manager.options.patch_features == .commit) source_and_path: {
            const root_package_json_entry = manager.workspace_package_json_cache.getWithPath(
                manager.allocator,
                manager.log,
                root_package_json_path,
                .{},
            ).unwrap() catch |err| {
                Output.err(err, "failed to read/parse package.json at '{s}'", .{root_package_json_path});
                Global.exit(1);
            };

            break :source_and_path .{ root_package_json_entry.source.contents, root_package_json_path };
        } else .{ new_package_json_source, manager.original_package_json_path };

        // Now that we've run the install step
        // We can save our in-memory package.json to disk
        const workspace_package_json_file = (try bun.sys.File.openat(
            .cwd(),
            path,
            bun.O.RDWR,
            0,
        ).unwrap()).handle.stdFile();

        try workspace_package_json_file.pwriteAll(source, 0);
        std.posix.ftruncate(workspace_package_json_file.handle, source.len) catch {};
        workspace_package_json_file.close();

        if (subcommand == .remove) {
            if (!any_changes) {
                Global.exit(0);
                return;
            }

            var cwd = std.fs.cwd();
            // This is not exactly correct
            var node_modules_buf: bun.PathBuffer = undefined;
            bun.copy(u8, &node_modules_buf, "node_modules" ++ std.fs.path.sep_str);
            const offset_buf = node_modules_buf["node_modules/".len..];
            const name_hashes = manager.lockfile.packages.items(.name_hash);
            for (updates.*) |request| {
                // If the package no longer exists in the updated lockfile, delete the directory
                // This is not thorough.
                // It does not handle nested dependencies
                // This is a quick & dirty cleanup intended for when deleting top-level dependencies
                if (std.mem.indexOfScalar(PackageNameHash, name_hashes, String.Builder.stringHash(request.name)) == null) {
                    bun.copy(u8, offset_buf, request.name);
                    cwd.deleteTree(node_modules_buf[0 .. "node_modules/".len + request.name.len]) catch {};
                }
            }

            // This is where we clean dangling symlinks
            // This could be slow if there are a lot of symlinks
            if (bun.openDir(cwd, manager.options.bin_path)) |node_modules_bin_handle| {
                var node_modules_bin: std.fs.Dir = node_modules_bin_handle;
                defer node_modules_bin.close();
                var iter: std.fs.Dir.Iterator = node_modules_bin.iterate();
                iterator: while (iter.next() catch null) |entry| {
                    switch (entry.kind) {
                        std.fs.Dir.Entry.Kind.sym_link => {

                            // any symlinks which we are unable to open are assumed to be dangling
                            // note that using access won't work here, because access doesn't resolve symlinks
                            bun.copy(u8, &node_modules_buf, entry.name);
                            node_modules_buf[entry.name.len] = 0;
                            const buf: [:0]u8 = node_modules_buf[0..entry.name.len :0];

                            var file = node_modules_bin.openFileZ(buf, .{ .mode = .read_only }) catch {
                                node_modules_bin.deleteFileZ(buf) catch {};
                                continue :iterator;
                            };

                            file.close();
                        },
                        else => {},
                    }
                }
            } else |err| {
                if (err != error.ENOENT) {
                    Output.err(err, "while reading node_modules/.bin", .{});
                    Global.crash();
                }
            }
        }
    }
}

/// Recursive/filter `bun update` branch. Mirrors the behavior of
/// `update_interactive_command.zig` without the interactive prompt: for every
/// matching workspace, edit its `package.json` via `PackageJSONEditor.editUpdateNoArgs`,
/// write the updated source to disk so the lockfile diff picks it up, run a single
/// `installWithManager` pass from the root, and finally rewrite each workspace's
/// resolved version literals back to disk.
fn updateAllWorkspacesNonInteractive(
    manager: *PackageManager,
    ctx: Command.Context,
    original_cwd: string,
) !void {
    const log_level = manager.options.log_level;

    // `bun update` needs a lockfile so we can enumerate workspaces and resolve
    // versions. Mirrors the interactive path's load behavior.
    const load_lockfile_result = manager.lockfile.loadFromCwd(
        manager,
        manager.allocator,
        manager.log,
        true,
    );
    manager.lockfile = switch (load_lockfile_result) {
        .not_found => {
            if (log_level != .silent) {
                Output.errGeneric("missing lockfile, nothing to update", .{});
            }
            Global.crash();
        },
        .err => |cause| {
            if (log_level != .silent) {
                switch (cause.step) {
                    .open_file => Output.errGeneric("failed to open lockfile: {s}", .{@errorName(cause.value)}),
                    .parse_file => Output.errGeneric("failed to parse lockfile: {s}", .{@errorName(cause.value)}),
                    .read_file => Output.errGeneric("failed to read lockfile: {s}", .{@errorName(cause.value)}),
                    .migrating => Output.errGeneric("failed to migrate lockfile: {s}", .{@errorName(cause.value)}),
                }
                if (manager.log.errors > 0) {
                    manager.log.print(Output.errorWriter()) catch {};
                }
            }
            Global.crash();
        },
        .ok => |ok| ok.lockfile,
    };

    const workspace_pkg_ids = if (manager.options.filter_patterns.len > 0) blk: {
        break :blk findMatchingWorkspaces(
            bun.default_allocator,
            original_cwd,
            manager,
            manager.options.filter_patterns,
        ) catch |err| bun.handleOom(err);
    } else blk: {
        break :blk bun.handleOom(getAllWorkspaces(bun.default_allocator, manager));
    };
    defer bun.default_allocator.free(workspace_pkg_ids);

    if (workspace_pkg_ids.len == 0) {
        if (log_level != .silent) {
            Output.prettyln("<r>No workspaces matched, nothing to update", .{});
        }
        return;
    }

    const packages = manager.lockfile.packages.slice();
    const pkg_name_hashes = packages.items(.name_hash);
    const pkg_resolutions = packages.items(.resolution);
    const string_buf = manager.lockfile.buffers.string_bytes.items;

    // Per-workspace bookkeeping. Each workspace needs its own snapshot of
    // `updating_packages` so the post-install second pass can reach each
    // workspace's deps without being clobbered by a previously-processed
    // workspace that shares a dependency name.
    const SavedEntry = struct {
        key: string,
        value: PackageManager.PackageUpdateInfo,
    };
    const WorkspaceState = struct {
        pkg_id: PackageID = 0,
        pkg_json_path: ?[:0]const u8 = null,
        preserve_trailing_newline: bool = false,
        name_hash: PackageNameHash = 0,
        updates: std.ArrayListUnmanaged(SavedEntry) = .{},
    };
    const workspace_states = try manager.allocator.alloc(WorkspaceState, workspace_pkg_ids.len);
    // Initialize each state to a safe default so the defer's cleanup loop can
    // handle partial initialization without crashing on undefined memory.
    for (workspace_states) |*state| state.* = .{};
    defer {
        for (workspace_states) |*state| {
            state.updates.deinit(manager.allocator);
            if (state.pkg_json_path) |path| manager.allocator.free(path);
        }
        manager.allocator.free(workspace_states);
    }

    const top_level_dir = FileSystem.instance.top_level_dir;
    const top_level_dir_without_trailing_slash = strings.withoutTrailingSlash(top_level_dir);

    // Phase 1: Edit every matching workspace's package.json in the cache,
    // then serialize and write to disk so the lockfile diff reads the
    // updated content when `installWithManager` runs.
    for (workspace_pkg_ids, workspace_states) |pkg_id, *state| {
        const resolution = pkg_resolutions[pkg_id];
        const workspace_sub_path = if (resolution.tag == .workspace)
            resolution.value.workspace.slice(string_buf)
        else
            "";

        var path_buf: bun.PathBuffer = undefined;
        const workspace_pkg_json_path_slice = if (workspace_sub_path.len > 0)
            bun.path.joinAbsStringBuf(
                top_level_dir,
                &path_buf,
                &[_]string{ workspace_sub_path, "package.json" },
                .auto,
            )
        else blk: {
            @memcpy(path_buf[0..top_level_dir_without_trailing_slash.len], top_level_dir_without_trailing_slash);
            @memcpy(
                path_buf[top_level_dir_without_trailing_slash.len..][0.."/package.json".len],
                "/package.json",
            );
            break :blk path_buf[0 .. top_level_dir_without_trailing_slash.len + "/package.json".len];
        };

        const workspace_pkg_json_path = try manager.allocator.dupeZ(u8, workspace_pkg_json_path_slice);
        state.* = .{
            .pkg_id = pkg_id,
            .pkg_json_path = workspace_pkg_json_path,
            .preserve_trailing_newline = false,
            .name_hash = pkg_name_hashes[pkg_id],
        };

        var pkg_json = switch (manager.workspace_package_json_cache.getWithPath(
            manager.allocator,
            manager.log,
            workspace_pkg_json_path,
            .{ .guess_indentation = true },
        )) {
            .parse_err => |err| {
                manager.log.print(Output.errorWriter()) catch {};
                Output.errGeneric("failed to parse package.json \"{s}\": {s}", .{
                    workspace_pkg_json_path,
                    @errorName(err),
                });
                Global.crash();
            },
            .read_err => |err| {
                Output.errGeneric("failed to read package.json \"{s}\": {s}", .{
                    workspace_pkg_json_path,
                    @errorName(err),
                });
                Global.crash();
            },
            .entry => |entry| entry,
        };

        state.preserve_trailing_newline = pkg_json.source.contents.len > 0 and
            pkg_json.source.contents[pkg_json.source.contents.len - 1] == '\n';

        // Each workspace gets an independent view of `updating_packages` so
        // shared deps (e.g. both workspaces depend on `react`) are handled
        // correctly — without this, editUpdateNoArgs' `found_existing → continue`
        // path would skip re-writing "latest" into the second workspace.
        manager.updating_packages.clearRetainingCapacity();
        manager.workspace_name_hash = state.name_hash;

        try PackageJSONEditor.editUpdateNoArgs(
            manager,
            &pkg_json.root,
            .{ .exact_versions = true, .before_install = true },
        );

        // Snapshot this workspace's entries so the second pass can replay them.
        try state.updates.ensureTotalCapacity(manager.allocator, manager.updating_packages.count());
        var it = manager.updating_packages.iterator();
        while (it.next()) |entry| {
            state.updates.appendAssumeCapacity(.{
                .key = entry.key_ptr.*,
                .value = entry.value_ptr.*,
            });
        }

        var buffer_writer = JSPrinter.BufferWriter.init(manager.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(manager.allocator, pkg_json.source.contents.len + 1);
        buffer_writer.append_newline = state.preserve_trailing_newline;
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        _ = JSPrinter.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            pkg_json.root,
            &pkg_json.source,
            .{ .indent = pkg_json.indentation, .mangled_props = null },
        ) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        const new_source = try manager.allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());
        pkg_json.source.contents = new_source;

        if (manager.options.do.write_package_json) {
            const workspace_file = (try bun.sys.File.openat(
                .cwd(),
                workspace_pkg_json_path,
                bun.O.RDWR,
                0,
            ).unwrap()).handle.stdFile();
            defer workspace_file.close();

            try workspace_file.pwriteAll(new_source, 0);
            std.posix.ftruncate(workspace_file.handle, new_source.len) catch {};
        }
    }

    // Build the combined `updating_packages` map for the install pass so that
    // `install_with_manager.zig` sees every workspace's deps together.
    manager.updating_packages.clearRetainingCapacity();
    for (workspace_states) |*state| {
        for (state.updates.items) |entry| {
            const gop = bun.handleOom(manager.updating_packages.getOrPut(manager.allocator, entry.key));
            if (!gop.found_existing) {
                gop.value_ptr.* = entry.value;
            }
        }
    }

    manager.to_update = true;

    var root_package_json_path_buf: bun.PathBuffer = undefined;
    @memcpy(root_package_json_path_buf[0..top_level_dir_without_trailing_slash.len], top_level_dir_without_trailing_slash);
    @memcpy(
        root_package_json_path_buf[top_level_dir_without_trailing_slash.len..][0.."/package.json".len],
        "/package.json",
    );
    const root_package_json_path_len = top_level_dir_without_trailing_slash.len + "/package.json".len;
    root_package_json_path_buf[root_package_json_path_len] = 0;
    const root_package_json_path = root_package_json_path_buf[0..root_package_json_path_len :0];

    try manager.installWithManager(ctx, root_package_json_path, original_cwd);

    // Phase 2: After install, rewrite each workspace's resolved version
    // literals back to disk.
    for (workspace_states) |*state| {
        const workspace_pkg_json_path = state.pkg_json_path orelse continue;
        // Restore this workspace's `updating_packages` snapshot so that
        // editUpdateNoArgs' `fetchSwapRemove` path finds the original literals
        // for every dep, even ones already consumed by a prior workspace.
        manager.updating_packages.clearRetainingCapacity();
        for (state.updates.items) |entry| {
            const gop = bun.handleOom(manager.updating_packages.getOrPut(manager.allocator, entry.key));
            gop.value_ptr.* = entry.value;
        }
        manager.workspace_name_hash = state.name_hash;

        var pkg_json_entry = manager.workspace_package_json_cache.getWithPath(
            manager.allocator,
            manager.log,
            workspace_pkg_json_path,
            .{},
        ).unwrap() catch |err| {
            Output.err(err, "failed to read/parse package.json at '{s}'", .{workspace_pkg_json_path});
            Global.exit(1);
        };

        // Re-parse the in-memory (edited) source so that we build an AST that
        // matches the current string offsets — the existing single-workspace
        // path does the same thing at line ~350.
        const source = &logger.Source.initPathString("package.json", pkg_json_entry.source.contents);
        var new_package_json = JSON.parsePackageJSONUTF8(source, manager.log, manager.allocator) catch |err| {
            Output.prettyErrorln("package.json failed to parse due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        try PackageJSONEditor.editUpdateNoArgs(
            manager,
            &new_package_json,
            .{ .exact_versions = manager.options.enable.exact_versions },
        );

        var buffer_writer = JSPrinter.BufferWriter.init(manager.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(manager.allocator, source.contents.len + 1);
        buffer_writer.append_newline = state.preserve_trailing_newline;
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        _ = JSPrinter.printJSON(
            @TypeOf(&package_json_writer),
            &package_json_writer,
            new_package_json,
            source,
            .{ .indent = pkg_json_entry.indentation, .mangled_props = null },
        ) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        const final_source = try manager.allocator.dupe(u8, package_json_writer.ctx.writtenWithoutTrailingZero());

        if (manager.options.do.write_package_json) {
            const workspace_file = (try bun.sys.File.openat(
                .cwd(),
                workspace_pkg_json_path,
                bun.O.RDWR,
                0,
            ).unwrap()).handle.stdFile();
            defer workspace_file.close();

            try workspace_file.pwriteAll(final_source, 0);
            std.posix.ftruncate(workspace_file.handle, final_source.len) catch {};
        }

        // Keep the cache entry consistent for anything downstream that may
        // peek at the workspace package.json after this function returns.
        pkg_json_entry.source.contents = final_source;
    }

    if (manager.any_failed_to_install) {
        Global.exit(1);
    }
}

fn getAllWorkspaces(
    allocator: std.mem.Allocator,
    manager: *PackageManager,
) bun.OOM![]const PackageID {
    const lockfile = manager.lockfile;
    const packages = lockfile.packages.slice();
    const pkg_resolutions = packages.items(.resolution);

    var workspace_pkg_ids: std.ArrayListUnmanaged(PackageID) = .empty;
    for (pkg_resolutions, 0..) |resolution, pkg_id| {
        if (resolution.tag != .workspace and resolution.tag != .root) continue;
        try workspace_pkg_ids.append(allocator, @intCast(pkg_id));
    }

    return workspace_pkg_ids.toOwnedSlice(allocator);
}

fn findMatchingWorkspaces(
    allocator: std.mem.Allocator,
    original_cwd: string,
    manager: *PackageManager,
    filters: []const string,
) bun.OOM![]const PackageID {
    const lockfile = manager.lockfile;
    const packages = lockfile.packages.slice();
    const pkg_names = packages.items(.name);
    const pkg_resolutions = packages.items(.resolution);
    const string_buf = lockfile.buffers.string_bytes.items;

    var workspace_pkg_ids: std.ArrayListUnmanaged(PackageID) = .empty;
    for (pkg_resolutions, 0..) |resolution, pkg_id| {
        if (resolution.tag != .workspace and resolution.tag != .root) continue;
        try workspace_pkg_ids.append(allocator, @intCast(pkg_id));
    }

    var path_buf: bun.PathBuffer = undefined;

    const converted_filters = converted_filters: {
        const buf = try allocator.alloc(PackageManager.WorkspaceFilter, filters.len);
        for (filters, buf) |filter, *converted| {
            converted.* = try PackageManager.WorkspaceFilter.init(allocator, filter, original_cwd, &path_buf);
        }
        break :converted_filters buf;
    };
    defer {
        for (converted_filters) |filter| {
            filter.deinit(allocator);
        }
        allocator.free(converted_filters);
    }

    // Move matched workspaces to the front of the slice and truncate.
    var i: usize = 0;
    while (i < workspace_pkg_ids.items.len) {
        const workspace_pkg_id = workspace_pkg_ids.items[i];

        const matched = matched: {
            for (converted_filters) |filter| {
                switch (filter) {
                    .path => |pattern| {
                        if (pattern.len == 0) continue;
                        const res = pkg_resolutions[workspace_pkg_id];

                        const res_path = switch (res.tag) {
                            .workspace => res.value.workspace.slice(string_buf),
                            .root => FileSystem.instance.top_level_dir,
                            else => unreachable,
                        };

                        const abs_res_path = bun.path.joinAbsStringBuf(
                            FileSystem.instance.top_level_dir,
                            &path_buf,
                            &[_]string{res_path},
                            .posix,
                        );

                        if (!bun.glob.match(pattern, strings.withoutTrailingSlash(abs_res_path)).matches()) {
                            break :matched false;
                        }
                    },
                    .name => |pattern| {
                        const name = pkg_names[workspace_pkg_id].slice(string_buf);

                        if (!bun.glob.match(pattern, name).matches()) {
                            break :matched false;
                        }
                    },
                    .all => {},
                }
            }

            break :matched true;
        };

        if (matched) {
            i += 1;
        } else {
            _ = workspace_pkg_ids.swapRemove(i);
        }
    }

    return workspace_pkg_ids.toOwnedSlice(allocator);
}

pub fn updatePackageJSONAndInstallCatchError(
    ctx: Command.Context,
    subcommand: Subcommand,
) !void {
    updatePackageJSONAndInstall(ctx, subcommand) catch |err| {
        switch (err) {
            error.InstallFailed,
            error.InvalidPackageJSON,
            => {
                const log = &bun.cli.Cli.log_;
                log.print(bun.Output.errorWriter()) catch {};
                bun.Global.exit(1);
                return;
            },
            else => return err,
        }
    };
}

fn updatePackageJSONAndInstallAndCLI(
    ctx: Command.Context,
    subcommand: Subcommand,
    cli: CommandLineArguments,
) !void {
    var manager, const original_cwd = PackageManager.init(ctx, cli, subcommand) catch |err| brk: {
        if (err == error.MissingPackageJSON) {
            switch (subcommand) {
                .update => {
                    Output.prettyErrorln("<r>No package.json, so nothing to update", .{});
                    Global.crash();
                },
                .remove => {
                    Output.prettyErrorln("<r>No package.json, so nothing to remove", .{});
                    Global.crash();
                },
                .patch, .@"patch-commit" => {
                    Output.prettyErrorln("<r>No package.json, so nothing to patch", .{});
                    Global.crash();
                },
                else => {
                    try attemptToCreatePackageJSON();
                    break :brk try PackageManager.init(ctx, cli, subcommand);
                },
            }
        }

        return err;
    };
    defer ctx.allocator.free(original_cwd);

    if (manager.options.shouldPrintCommandName()) {
        Output.prettyln("<r><b>bun {s} <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>\n", .{@tagName(subcommand)});
        Output.flush();
    }

    // When you run `bun add -g <pkg>` or `bun install -g <pkg>` and the global bin dir is not in $PATH
    // We should tell the user to add it to $PATH so they don't get confused.
    if (subcommand.canGloballyInstallPackages()) {
        if (manager.options.global and manager.options.log_level != .silent) {
            manager.track_installed_bin = .{ .pending = {} };
        }
    }

    try updatePackageJSONAndInstallWithManager(manager, ctx, original_cwd);

    if (manager.options.patch_features == .patch) {
        try manager.preparePatch();
    }

    if (manager.any_failed_to_install) {
        Global.exit(1);
    }

    // Check if we need to print a warning like:
    //
    // > warn: To run "vite", add the global bin folder to $PATH:
    // >
    // > fish_add_path "/private/tmp/test"
    //
    if (subcommand.canGloballyInstallPackages()) {
        if (manager.options.global) {
            if (manager.options.bin_path.len > 0 and manager.track_installed_bin == .basename) {
                var path_buf: bun.PathBuffer = undefined;
                const needs_to_print = if (bun.env_var.PATH.get()) |PATH|
                    // This is not perfect
                    //
                    // If you already have a different binary of the same
                    // name, it will not detect that case.
                    //
                    // The problem is there are too many edgecases with filesystem paths.
                    //
                    // We want to veer towards false negative than false
                    // positive. It would be annoying if this message
                    // appears unnecessarily. It's kind of okay if it doesn't appear
                    // when it should.
                    //
                    // If you set BUN_INSTALL_BIN to "/tmp/woo" on macOS and
                    // we just checked for "/tmp/woo" in $PATH, it would
                    // incorrectly print a warning because /tmp/ on macOS is
                    // aliased to /private/tmp/
                    //
                    // Another scenario is case-insensitive filesystems. If you
                    // have a binary called "esbuild" in /tmp/TeST and you
                    // install esbuild, it will not detect that case if we naively
                    // just checked for "esbuild" in $PATH where "$PATH" is /tmp/test
                    bun.which(
                        &path_buf,
                        PATH,
                        bun.fs.FileSystem.instance.top_level_dir,
                        manager.track_installed_bin.basename,
                    ) == null
                else
                    true;

                if (needs_to_print) {
                    const MoreInstructions = struct {
                        shell: bun.cli.ShellCompletions.Shell = .unknown,
                        folder: []const u8,

                        // Convert "/Users/Jarred Sumner" => "/Users/Jarred\ Sumner"
                        const ShellPathFormatter = struct {
                            folder: []const u8,

                            pub fn format(instructions: @This(), writer: *std.Io.Writer) !void {
                                var remaining = instructions.folder;
                                while (bun.strings.indexOfChar(remaining, ' ')) |space| {
                                    try writer.print(
                                        "{f}",
                                        .{bun.fmt.fmtPath(u8, remaining[0..space], .{
                                            .escape_backslashes = true,
                                            .path_sep = if (Environment.isWindows) .windows else .posix,
                                        })},
                                    );
                                    try writer.writeAll("\\ ");
                                    remaining = remaining[@min(space + 1, remaining.len)..];
                                }

                                try writer.print(
                                    "{f}",
                                    .{bun.fmt.fmtPath(u8, remaining, .{
                                        .escape_backslashes = true,
                                        .path_sep = if (Environment.isWindows) .windows else .posix,
                                    })},
                                );
                            }
                        };

                        pub fn format(instructions: @This(), writer: *std.Io.Writer) !void {
                            const path = ShellPathFormatter{ .folder = instructions.folder };
                            switch (instructions.shell) {
                                .unknown => {
                                    // Unfortunately really difficult to do this in one line on PowerShell.
                                    try writer.print("{f}", .{path});
                                },
                                .bash => {
                                    try writer.print("export PATH=\"{f}:$PATH\"", .{path});
                                },
                                .zsh => {
                                    try writer.print("export PATH=\"{f}:$PATH\"", .{path});
                                },
                                .fish => {
                                    // Regular quotes will do here.
                                    try writer.print("fish_add_path {f}", .{bun.fmt.quote(instructions.folder)});
                                },
                                .pwsh => {
                                    try writer.print("$env:PATH += \";{f}\"", .{path});
                                },
                            }
                        }
                    };

                    Output.prettyError("\n", .{});

                    Output.warn(
                        \\To run {f}, add the global bin folder to $PATH:
                        \\
                        \\<cyan>{f}<r>
                        \\
                    ,
                        .{
                            bun.fmt.quote(manager.track_installed_bin.basename),
                            MoreInstructions{ .shell = bun.cli.ShellCompletions.Shell.fromEnv([]const u8, bun.env_var.SHELL.platformGet() orelse ""), .folder = manager.options.bin_path },
                        },
                    );
                    Output.flush();
                }
            }
        }
    }
}

pub fn updatePackageJSONAndInstall(
    ctx: Command.Context,
    subcommand: Subcommand,
) !void {
    var cli = switch (subcommand) {
        inline else => |cmd| try PackageManager.CommandLineArguments.parse(ctx.allocator, cmd),
    };

    // The way this works:
    // 1. Run the bundler on source files
    // 2. Rewrite positional arguments to act identically to the developer
    //    typing in the dependency names
    // 3. Run the install command
    if (cli.analyze) {
        const Analyzer = struct {
            ctx: Command.Context,
            cli: *PackageManager.CommandLineArguments,
            subcommand: Subcommand,
            pub fn onAnalyze(
                this: *@This(),
                result: *bun.bundle_v2.BundleV2.DependenciesScanner.Result,
            ) anyerror!void {
                // TODO: add separate argument that makes it so positionals[1..] is not done and instead the positionals are passed
                var positionals = bun.handleOom(bun.default_allocator.alloc(string, result.dependencies.keys().len + 1));
                positionals[0] = "add";
                bun.copy(string, positionals[1..], result.dependencies.keys());
                this.cli.positionals = positionals;

                try updatePackageJSONAndInstallAndCLI(this.ctx, this.subcommand, this.cli.*);

                Global.exit(0);
            }
        };
        var analyzer = Analyzer{
            .ctx = ctx,
            .cli = &cli,
            .subcommand = subcommand,
        };
        var fetcher = bun.bundle_v2.BundleV2.DependenciesScanner{
            .ctx = &analyzer,
            .entry_points = cli.positionals[1..],
            .onFetch = @ptrCast(&Analyzer.onAnalyze),
        };

        // This runs the bundler.
        try bun.cli.BuildCommand.exec(bun.cli.Command.get(), &fetcher);
        return;
    }

    return updatePackageJSONAndInstallAndCLI(ctx, subcommand, cli);
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const JSON = bun.json;
const JSPrinter = bun.js_printer;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const strings = bun.strings;
const Command = bun.cli.Command;
const File = bun.sys.File;
const PackageID = bun.install.PackageID;
const PackageNameHash = bun.install.PackageNameHash;

const Semver = bun.Semver;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const PackageManager = bun.install.PackageManager;
const CommandLineArguments = PackageManager.CommandLineArguments;
const PackageJSONEditor = PackageManager.PackageJSONEditor;
const PatchCommitResult = PackageManager.PatchCommitResult;
const Subcommand = PackageManager.Subcommand;
const UpdateRequest = PackageManager.UpdateRequest;
const attemptToCreatePackageJSON = PackageManager.attemptToCreatePackageJSON;
