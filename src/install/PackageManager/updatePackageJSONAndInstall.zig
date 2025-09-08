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
    
    // Handle workspace filters for add/remove commands
    if ((manager.subcommand == .add or manager.subcommand == .remove) and manager.options.filter_patterns.len > 0) {
        return try updatePackageJSONForWorkspaces(
            manager,
            ctx,
            &updates,
            manager.subcommand,
            original_cwd,
        );
    }
    
    try updatePackageJSONAndInstallWithManagerWithUpdates(
        manager,
        ctx,
        &updates,
        manager.subcommand,
        original_cwd,
    );
}

fn updatePackageJSONForWorkspaces(
    manager: *PackageManager,
    ctx: Command.Context,
    updates: *[]UpdateRequest,
    subcommand: Subcommand,
    original_cwd: string,
) !void {
    var path_buf: bun.PathBuffer = undefined;
    var workspace_filters: std.ArrayListUnmanaged(WorkspaceFilter) = .{};
    defer workspace_filters.deinit(manager.allocator);
    
    // Parse workspace filters
    try workspace_filters.ensureUnusedCapacity(manager.allocator, manager.options.filter_patterns.len);
    for (manager.options.filter_patterns) |pattern| {
        try workspace_filters.append(manager.allocator, try WorkspaceFilter.init(manager.allocator, pattern, original_cwd, &path_buf));
    }
    
    // Find matching workspaces from the workspace cache
    var matched_workspace_paths = std.ArrayList([:0]const u8).init(manager.allocator);
    defer matched_workspace_paths.deinit();
    
    // Iterate through workspace cache to find matches
    var iter = manager.workspace_package_json_cache.map.iterator();
    while (iter.next()) |entry| {
        const workspace_path = entry.key_ptr.*;
        
        // Skip the root package.json
        if (strings.eql(workspace_path, manager.original_package_json_path)) continue;
        
        // Extract workspace info
        const workspace_json = entry.value_ptr.*;
        const name = if (workspace_json.root.asProperty("name")) |name_prop|
            if (name_prop.expr.asString(manager.allocator)) |n| n else ""
        else "";
        
        // Calculate relative path
        const workspace_dir = strings.withoutSuffixComptime(workspace_path, "/package.json");
        const root_dir = strings.withoutTrailingSlash(FileSystem.instance.top_level_dir);
        const relative_path = if (strings.hasPrefix(workspace_dir, root_dir))
            workspace_dir[root_dir.len + 1..]
        else
            workspace_dir;
        
        // Check if this workspace matches any filter
        for (workspace_filters.items) |filter| {
            const matches = switch (filter) {
                .all => true,
                .name => |pattern| brk: {
                    const result = bun.glob.walk.matchImpl(manager.allocator, pattern, name);
                    break :brk result.matches();
                },
                .path => |pattern| brk: {
                    const result = bun.glob.walk.matchImpl(manager.allocator, pattern, relative_path);
                    break :brk result.matches();
                },
            };
            
            if (matches) {
                // workspace_path is already null-terminated from the cache
                const null_term_path = workspace_path[0..workspace_path.len :0];
                try matched_workspace_paths.append(null_term_path);
                break;
            }
        }
    }
    
    if (matched_workspace_paths.items.len == 0) {
        Output.errGeneric("No workspaces matched the filter(s): {any}", .{manager.options.filter_patterns});
        Global.crash();
    }
    
    // Save original path
    const original_path = manager.original_package_json_path;
    defer manager.original_package_json_path = original_path;
    
    // Update each matched workspace's package.json
    for (matched_workspace_paths.items) |workspace_package_json_path| {
        manager.original_package_json_path = workspace_package_json_path;
        
        // Call the existing function to update this workspace's package.json
        try updatePackageJSONAndInstallWithManagerWithUpdates(
            manager,
            ctx,
            updates,
            subcommand,
            original_cwd,
        );
    }
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
                                    var arraylist = current_package_json.root.data.e_object.properties.list();
                                    _ = arraylist.swapRemove(query.i);
                                    current_package_json.root.data.e_object.properties.update(arraylist);
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

        .patch, .@"patch-commit" => {
            not_in_workspace_root = try manager.patchCommit(&current_package_json.root);
        },

        else => {},
    }

    var writer_buffer = try std.ArrayListUnmanaged(u8).initCapacity(
        manager.allocator,
        bun.handleOom(current_package_json.source.contents.len),
    );
    var buffer_writer = JSPrinter.BufferWriter.init(&writer_buffer);
    buffer_writer.append_newline = preserve_trailing_newline_at_eof_for_package_json;
    var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

    var written = JSPrinter.printJSON(
        @TypeOf(&package_json_writer),
        &package_json_writer,
        current_package_json.root,
        current_package_json.source.contents,
        .{
            .indent = current_package_json_indent,
        },
    ) catch |err| {
        if (log_level != .silent) {
            Output.prettyErrorln("{s} printing package.json: {s}", .{ @errorName(err), @errorName(err) });
        }
        Global.crash();
    };

    var root_package_json = switch (manager.workspace_package_json_cache.getWithPath(
        manager.allocator,
        manager.log,
        manager.original_package_json_path,
        .{
            .guess_indentation = true,
        },
    )) {
        .parse_err => |err| {
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

    var trusted_to_add_to_package_json = [_]string{};
    if (manager.trusted_deps_to_add_to_package_json.items.len > 0) {
        trusted_to_add_to_package_json = manager.trusted_deps_to_add_to_package_json.items;
        var new_trusted_dependencies = root_package_json.root.asProperty("trustedDependencies") orelse brk: {
            const trusted = Expr.allocate(
                manager.allocator,
                E.Array,
                E.Array{},
                logger.Loc.Empty,
            );
            const prop = try manager.allocator.create(G.Property);
            prop.* = .{
                .key = Expr.allocate(
                    manager.allocator,
                    E.String,
                    E.String.init("trustedDependencies"),
                    logger.Loc.Empty,
                ),
                .value = trusted,
                .kind = .normal,
                .key_was_computed = false,
                .was_originally_quoted = false,
            };
            break :brk root_package_json.root.data.e_object.appendProperty(manager.allocator, prop);
        };

        if (new_trusted_dependencies.expr.data == .e_array) {
            var existing_trusted_set = bun.StringHashMapUnmanaged(u32){};
            defer existing_trusted_set.deinit(manager.allocator);
            for (new_trusted_dependencies.expr.data.e_array.items.slice(), 0..) |dep, j| {
                if (dep.asString(manager.allocator)) |existing| {
                    try existing_trusted_set.put(manager.allocator, existing, @intCast(j));
                }
            }

            for (manager.trusted_deps_to_add_to_package_json.items) |dep| {
                if (!existing_trusted_set.contains(dep)) {
                    new_trusted_dependencies.expr.data.e_array.push(
                        manager.allocator,
                        Expr.init(E.String, E.String.init(dep), logger.Loc.Empty),
                    );
                }
            }

            writer_buffer.clearRetainingCapacity();
            var buffer_writer2 = JSPrinter.BufferWriter.init(&writer_buffer);
            buffer_writer2.append_newline = preserve_trailing_newline_at_eof_for_package_json;
            var package_json_writer2 = JSPrinter.BufferPrinter.init(buffer_writer2);

            _ = JSPrinter.printJSON(
                @TypeOf(&package_json_writer2),
                &package_json_writer2,
                root_package_json.root,
                root_package_json.source.contents,
                .{
                    .indent = root_package_json.indentation,
                },
            ) catch |err| {
                if (log_level != .silent) {
                    Output.prettyErrorln("{s} printing package.json: {s}", .{ @errorName(err), @errorName(err) });
                }
                Global.crash();
            };

            written = writer_buffer.items;
        }
    }

    switch (bun.sys.File.writeFile(
        std.fs.cwd(),
        manager.original_package_json_path,
        written,
    )) {
        .result => {},
        .err => |err| {
            if (log_level != .silent)
                Output.prettyErrorln("error saving package.json: {}\npackage.json text:\n{s}\n", .{ err, written });
            Global.crash();
        },
    }

    const possibly_dirty_lockfile = try manager.allocator.create(Lockfile);
    possibly_dirty_lockfile.* = manager.lockfile.*;

    var maybe_root = Lockfile.Package{};
    try manager.workspace_package_json_cache.update(
        manager.allocator,
        manager.log,
        manager.original_package_json_path,
        written,
    );

    var new_package_json = root_package_json.root;
    if (manager.trusted_deps_to_add_to_package_json.items.len > 0) {
        const new_trusted = manager.workspace_package_json_cache.getWithPath(
            manager.allocator,
            manager.log,
            manager.original_package_json_path,
            .{},
        ).entry;
        new_package_json = new_trusted.root;
    }

    try maybe_root.parseWithLockfile(
        manager,
        manager.allocator,
        manager.log,
        new_package_json,
        subcommand,
        possibly_dirty_lockfile,
    );

    const new_lockfile_needed = possibly_dirty_lockfile.packages.len == 1 and possibly_dirty_lockfile.buffers.dependencies.items.len == 0;

    if (new_lockfile_needed) {
        manager.progress = .{};
        if (log_level.showProgress()) {
            manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
            manager.root_progress_node = manager.progress.start(manager.options.log_level, ProgressStrings.start());
            if (manager.root_progress_node) |progress_node| progress_node.activate();

            manager.progress.refresh();
        }

        PackageJSONEditor.edit(
            manager,
            updates,
            &new_package_json,
            dependency_list,
            .{
                .exact_versions = manager.options.enable.exact_versions,
                .before_install = false,
            },
        ) catch |err| {
            if (log_level != .silent)
                Output.prettyErrorln("error: {s}", .{@errorName(err)});
            Global.crash();
        };

        writer_buffer.clearRetainingCapacity();
        var buffer_writer_two = JSPrinter.BufferWriter.init(&writer_buffer);
        buffer_writer_two.append_newline =
            preserve_trailing_newline_at_eof_for_package_json;
        var package_json_writer_two = JSPrinter.BufferPrinter.init(buffer_writer_two);

        written = JSPrinter.printJSON(
            @TypeOf(&package_json_writer_two),
            &package_json_writer_two,
            new_package_json,
            current_package_json.source.contents,
            .{
                .indent = current_package_json_indent,
            },
        ) catch |err| {
            if (log_level != .silent) {
                Output.prettyErrorln("{s} printing package.json: {s}", .{ @errorName(err), @errorName(err) });
            }
            Global.crash();
        };

        // TODO: only write package.json if it's different
        // TODO: check if package.json changed on disk in the background before writing
        // TODO: handle when both the lockfile needs to be created and package.json is missing
        switch (bun.sys.File.writeFile(
            std.fs.cwd(),
            manager.original_package_json_path,
            written,
        )) {
            .result => {},
            .err => |err| {
                if (log_level != .silent)
                    Output.prettyErrorln("error saving package.json: {}\npackage.json text:\n{s}\n", .{ err, written });
                Global.crash();
            },
        }

        var lockfile: Lockfile = undefined;
        lockfile.initEmpty(manager.allocator);
        lockfile.trusted_dependencies = manager.lockfile.trusted_dependencies;
        manager.lockfile = &lockfile;

        var resolver: Package.DependencySlice = .{};
        try maybe_root.parseDependencies(
            manager,
            manager.allocator,
            manager.log,
            new_package_json,
            .{},
            &resolver,
            subcommand,
        );

        maybe_root.meta.setHasInstallScript(false);
        lockfile.packages.append(manager.allocator, maybe_root) catch bun.outOfMemory();
        lockfile.packages.items(.resolutions)[0] = resolver.resolutions;
        lockfile.packages.items(.dependencies)[0] = resolver.dependencies;
    }

    const new_package_json_source = logger.Source.initPathString(
        manager.original_package_json_path,
        written,
    );

    try installWithManager(manager, ctx, new_package_json_source.contents, original_cwd);
    if (subcommand == .@"patch-commit") {
        switch (not_in_workspace_root.?) {
            .build_id => |build_id| {
                const patch_tag_resolver = manager.lockfile.patched_dependencies.get(build_id).?;
                const folder_name = switch (patch_tag_resolver.value.patch.name_and_version_hash) {
                    .npm => |npm| Npm.FolderResolution.buildId(
                        &patch_tag_resolver.value.patch.name,
                        npm,
                    ),
                    .folder => |folder| folder,
                };
                const folder_path = bun.path.joinZ(&[_]string{
                    FileSystem.instance.top_level_dir,
                    "node_modules",
                    ".cache",
                    folder_name,
                }, .posix);

                defer manager.allocator.free(folder_path);

                _ = bun.sys.rmdir(folder_path);
                Output.prettyln("<green>done<r>", .{});
                Output.flush();
            },
            .nothing => {
                Output.prettyln("<green>done<r>", .{});
                Output.flush();
            },
        }
    }
}

pub fn updatePackageJSONAndInstallCatchError(
    ctx: Command.Context,
    subcommand: Subcommand,
) !void {
    updatePackageJSONAndInstall(ctx, subcommand) catch |err| {
        switch (err) {
            error.InstallFailed,
            error.InvalidPackageJSON,
            error.ParsingDependencyVersionFailed,
            => {
                // the error was already printed
                Global.exit(1);
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
    const manager, const original_cwd = PackageManager.init(ctx, subcommand, true, cli) catch |err| {
        switch (err) {
            error.MissingPackageJSON => {
                const command_for_subcommand = switch (subcommand) {
                    .link => try attemptToCreatePackageJSON(cli.link_command.unlink, ctx),
                    else => subcommand.bunCommand(),
                };

                if (subcommand == .remove) {
                    Output.errGeneric("no package.json, so nothing to remove", .{});
                    Global.crash();
                }

                if (ctx.args.opcodes.len > 0) {
                    // absolute worst case, all their input is the package name
                    // (namespace) + "@" + version
                    const input = ctx.args.opcodes[0];
                    var buf = bun.handleOom(try ctx.allocator.alloc(u8, input.len + 2048));
                    const json_str = try JSON.stringifyPackageJSONForAdd(buf, ctx.allocator, subcommand, ctx.args.opcodes, cli);
                    buf = buf[0..json_str.len];
                    if (subcommand == .link) {
                        try attemptToCreatePackageJSON(false, ctx);
                    } else {
                        _ = try attemptToCreatePackageJSONAndOpen(ctx);
                    }

                    bun.sys.File.writeFile(
                        std.fs.cwd(),
                        PackageManager.package_json_cwd_buf[0 .. PackageManager.package_json_cwd_buf.len - 1 :0],
                        buf,
                    ).unwrap() catch |e| {
                        Output.prettyErrorln(
                            "<r><red>error<r>: {s} writing default package.json",
                            .{@errorName(e)},
                        );
                        Global.crash();
                    };

                    Output.prettyln("No package.json, created one for you!", .{});
                    Output.flush();

                    const manager2, const original_cwd2 = try PackageManager.init(ctx, subcommand, true, cli);
                    try updatePackageJSONAndInstallWithManager(manager2, ctx, original_cwd2);
                    return;
                }

                Output.prettyln(
                    \\No package.json, but there also aren't any packages to {s}.
                    \\
                    \\Run <b>bun init<r> to get started.
                    \\Otherwise, run <b>{s}<r> to install packages
                    \\
                ,
                    .{
                        subcommand.bunCommand(),
                        command_for_subcommand,
                    },
                );
                Global.exit(0);
            },
            else => return err,
        }
    };

    if (subcommand == .link and cli.link_command.unlink) {
        if (manager.options.positionals.len <= 1) {
            try manager.unlinkSelf();
            Global.exit(0);
        } else {
            try manager.unlink(ctx);
            Global.exit(0);
        }
    }

    try updatePackageJSONAndInstallWithManager(manager, ctx, original_cwd);

    if (manager.options.patch_features == .patch) {
        try manager.preparePatch();
    }

    if (subcommand == .link) {
        Global.exit(0);
    }
}

pub fn updatePackageJSONAndInstall(
    ctx: Command.Context,
    subcommand: Subcommand,
) !void {
    const cli = CommandLineArguments.parse(ctx.allocator, subcommand, ctx.passthrough);

    if (cli.analyze_metafile and cli.analyze_metafile_path != null) {
        const analyze_path = cli.analyze_metafile_path.?;

        const manager = &PackageManager{
            .allocator = ctx.allocator,
            .log = ctx.log,
            .subcommand = subcommand,
            .options = .{
                .filter_patterns = cli.filters,
                .positionals = cli.positionals,
            },
            .lockfile = undefined,
            .root_dir = &Fs.FileSystem.instance.fs,
            .cache_directory_ = null,
            .cache_directory_path = "",
            .temp_dir_ = null,
            .temp_dir_path = "",
            .temp_dir_name = "",
            .root_package_json_file = std.fs.File{ .handle = 0 },
            .root_package_id = .{},
            .original_package_json_path = "",
            .thread_pool = ThreadPool.init(.{}),
            .task_batch = .{},
            .task_queue = .{},
            .manifests = .{},
            .folders = .{},
            .git_repositories = .{},
            .network_dedupe_map = .init(bun.default_allocator),
            .async_network_task_queue = .{},
            .network_tarball_batch = .{},
            .network_resolve_batch = .{},
            .network_task_fifo = undefined,
            .patch_apply_batch = .{},
            .patch_calc_hash_batch = .{},
            .patch_task_fifo = undefined,
            .patch_task_queue = .{},
            .pending_pre_calc_hashes = .init(0),
            .pending_tasks = .init(0),
            .total_tasks = 0,
            .preallocated_network_tasks = .{},
            .preallocated_resolve_tasks = .{},
            .lifecycle_script_time_log = .{},
            .pending_lifecycle_script_tasks = .init(0),
            .finished_installing = .init(false),
            .total_scripts = 0,
            .root_lifecycle_scripts = null,
            .node_gyp_tempdir_name = "",
            .env_configure = null,
            .env = undefined,
            .progress = .{},
            .downloads_node = null,
            .scripts_node = null,
            .progress_name_buf = undefined,
            .progress_name_buf_dynamic = &[_]u8{},
            .cpu_count = 0,
            .track_installed_bin = .{ .none = {} },
            .root_progress_node = undefined,
            .to_update = false,
            .update_requests = &[_]UpdateRequest{},
            .root_package_json_name_at_time_of_init = "",
            .event_loop = .{ .mini = jsc.MiniEventLoop.initNoOp() },
        };

        const result = bun.CLI.analyzeMetafile(ctx.allocator, analyze_path, manager);
        const positionals = try ctx.allocator.alloc(string, result.dependencies.count());
        bun.copy(string, positionals[1..], result.dependencies.keys());
        var modified_cli = cli;
        modified_cli.positionals = positionals;

        try updatePackageJSONAndInstallAndCLI(ctx, subcommand, modified_cli);

        Global.exit(0);
    }

    if (cli.version) {
        Output.prettyln("{}", .{Global.package_json_version_with_sha});
        Output.flush();
        return;
    }

    return updatePackageJSONAndInstallAndCLI(ctx, subcommand, cli);
}

const string = []const u8;

const std = @import("std");
const initializeStore = @import("./initializeStore.zig").initializeStore;
const json = bun.json;
const JSON = bun.JSON;
const Global = bun.Global;
const Output = bun.Output;
const FileSystem = Fs.FileSystem;
const CommandLineArguments = PackageManager.CommandLineArguments;
const logger = bun.logger;
const Expr = bun.js_ast.Expr;
const E = bun.js_ast.E;
const G = bun.js_ast.G;
const ProgressStrings = PackageManager.ProgressStrings;
const JSPrinter = bun.js_printer;
const Semver = @import("../../semver.zig");
const String = Semver.String;
const stringZ = [:0]const u8;
const JSAst = bun.JSAst;
const Lockfile = @import("../lockfile.zig");
const Npm = @import("../npm.zig");
const strings = bun.strings;
const Fs = bun.fs;
const DotEnv = @import("../../env.zig");
const bun = @import("root").bun;
const PackageManager = @import("../install.zig").PackageManager;
const ThreadPool = bun.ThreadPool;
const Package = Lockfile.Package;
const DependencyID = bun.install.DependencyID;
const PackageJSONEditor = PackageManager.PackageJSONEditor;
const PatchCommitResult = PackageManager.PatchCommitResult;
const Subcommand = PackageManager.Subcommand;
const UpdateRequest = PackageManager.UpdateRequest;
const attemptToCreatePackageJSON = PackageManager.attemptToCreatePackageJSON;
const attemptToCreatePackageJSONAndOpen = PackageManager.attemptToCreatePackageJSONAndOpen;
const WorkspaceFilter = PackageManager.WorkspaceFilter;
const installWithManager = PackageManager.installWithManager;
const PackageID = PackageManager.PackageID;
const Command = @import("../../cli.zig").Command;
const jsc = bun.JSC;