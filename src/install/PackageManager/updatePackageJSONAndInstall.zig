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
