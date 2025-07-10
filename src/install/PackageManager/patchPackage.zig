pub const PatchCommitResult = struct {
    patch_key: []const u8,
    patchfile_path: []const u8,
    not_in_workspace_root: bool = false,
};

/// - Arg is the dir containing the package with changes OR name and version
/// - Get the patch file contents by running git diff on the temp dir and the original package dir
/// - Write the patch file to $PATCHES_DIR/$PKG_NAME_AND_VERSION.patch
/// - Update "patchedDependencies" in package.json
/// - Run install to install newly patched pkg
pub fn doPatchCommit(
    manager: *PackageManager,
    pathbuf: *bun.PathBuffer,
    log_level: Options.LogLevel,
) !?PatchCommitResult {
    var folder_path_buf: bun.PathBuffer = undefined;
    var lockfile: *Lockfile = try manager.allocator.create(Lockfile);
    defer lockfile.deinit();
    switch (lockfile.loadFromCwd(manager, manager.allocator, manager.log, true)) {
        .not_found => {
            Output.errGeneric("Cannot find lockfile. Install packages with `<cyan>bun install<r>` before patching them.", .{});
            Global.crash();
        },
        .err => |cause| {
            if (log_level != .silent) {
                switch (cause.step) {
                    .open_file => Output.prettyError("<r><red>error<r> opening lockfile:<r> {s}\n<r>", .{
                        @errorName(cause.value),
                    }),
                    .parse_file => Output.prettyError("<r><red>error<r> parsing lockfile:<r> {s}\n<r>", .{
                        @errorName(cause.value),
                    }),
                    .read_file => Output.prettyError("<r><red>error<r> reading lockfile:<r> {s}\n<r>", .{
                        @errorName(cause.value),
                    }),
                    .migrating => Output.prettyError("<r><red>error<r> migrating lockfile:<r> {s}\n<r>", .{
                        @errorName(cause.value),
                    }),
                }

                if (manager.options.enable.fail_early) {
                    Output.prettyError("<b><red>failed to load lockfile<r>\n", .{});
                } else {
                    Output.prettyError("<b><red>ignoring lockfile<r>\n", .{});
                }

                Output.flush();
            }
            Global.crash();
        },
        .ok => {},
    }

    var argument = manager.options.positionals[1];
    const arg_kind: PatchArgKind = PatchArgKind.fromArg(argument);

    const not_in_workspace_root = manager.root_package_id.get(lockfile, manager.workspace_name_hash) != 0;
    var free_argument = false;
    argument = if (arg_kind == .path and
        not_in_workspace_root and
        (!bun.path.Platform.posix.isAbsolute(argument) or (bun.Environment.isWindows and !bun.path.Platform.windows.isAbsolute(argument))))
    brk: {
        if (pathArgumentRelativeToRootWorkspacePackage(manager, lockfile, argument)) |rel_path| {
            free_argument = true;
            break :brk rel_path;
        }
        break :brk argument;
    } else argument;
    defer if (free_argument) manager.allocator.free(argument);

    // Attempt to open the existing node_modules folder
    var root_node_modules = switch (bun.sys.openatOSPath(bun.FD.cwd(), bun.OSPathLiteral("node_modules"), bun.O.DIRECTORY | bun.O.RDONLY, 0o755)) {
        .result => |fd| std.fs.Dir{ .fd = fd.cast() },
        .err => |e| {
            Output.prettyError(
                "<r><red>error<r>: failed to open root <b>node_modules<r> folder: {}<r>\n",
                .{e},
            );
            Global.crash();
        },
    };
    defer root_node_modules.close();

    var iterator = Lockfile.Tree.Iterator(.node_modules).init(lockfile);
    var resolution_buf: [1024]u8 = undefined;
    const _cache_dir: std.fs.Dir, const _cache_dir_subpath: stringZ, const _changes_dir: []const u8, const _pkg: Package = switch (arg_kind) {
        .path => result: {
            const package_json_source: *const logger.Source = &brk: {
                const package_json_path = bun.path.joinZ(&[_][]const u8{ argument, "package.json" }, .auto);

                switch (bun.sys.File.toSource(package_json_path, manager.allocator, .{})) {
                    .result => |s| break :brk s,
                    .err => |e| {
                        Output.err(e, "failed to read {s}", .{bun.fmt.quote(package_json_path)});
                        Global.crash();
                    },
                }
            };
            defer manager.allocator.free(package_json_source.contents);

            initializeStore();
            const json = JSON.parsePackageJSONUTF8(package_json_source, manager.log, manager.allocator) catch |err| {
                manager.log.print(Output.errorWriter()) catch {};
                Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(err), package_json_source.path.prettyDir() });
                Global.crash();
            };

            const version = version: {
                if (json.asProperty("version")) |v| {
                    if (v.expr.asString(manager.allocator)) |s| break :version s;
                }
                Output.prettyError(
                    "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {s}<r>\n",
                    .{package_json_source.path.text},
                );
                Global.crash();
            };

            var resolver: void = {};
            var package = Lockfile.Package{};
            try package.parseWithJSON(lockfile, manager, manager.allocator, manager.log, package_json_source, json, void, &resolver, Features.folder);

            const name = lockfile.str(&package.name);
            const actual_package = switch (lockfile.package_index.get(package.name_hash) orelse {
                Output.prettyError(
                    "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                    .{},
                );
                Global.crash();
            }) {
                .id => |id| lockfile.packages.get(id),
                .ids => |ids| brk: {
                    for (ids.items) |id| {
                        const pkg = lockfile.packages.get(id);
                        const resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{pkg.resolution.fmt(lockfile.buffers.string_bytes.items, .posix)}) catch unreachable;
                        if (std.mem.eql(u8, resolution_label, version)) {
                            break :brk pkg;
                        }
                    }
                    Output.prettyError("<r><red>error<r>: could not find package with name:<r> {s}\n<r>", .{
                        package.name.slice(lockfile.buffers.string_bytes.items),
                    });
                    Global.crash();
                },
            };

            const cache_result = manager.computeCacheDirAndSubpath(
                name,
                &actual_package.resolution,
                &folder_path_buf,
                null,
            );
            const cache_dir = cache_result.cache_dir;
            const cache_dir_subpath = cache_result.cache_dir_subpath;

            const changes_dir = argument;

            break :result .{ cache_dir, cache_dir_subpath, changes_dir, actual_package };
        },
        .name_and_version => brk: {
            const name, const version = Dependency.splitNameAndMaybeVersion(argument);
            const pkg_id, const node_modules = pkgInfoForNameAndVersion(lockfile, &iterator, argument, name, version);

            const changes_dir = bun.path.joinZBuf(pathbuf[0..], &[_][]const u8{
                node_modules.relative_path,
                name,
            }, .auto);
            const pkg = lockfile.packages.get(pkg_id);

            const cache_result = manager.computeCacheDirAndSubpath(
                pkg.name.slice(lockfile.buffers.string_bytes.items),
                &pkg.resolution,
                &folder_path_buf,
                null,
            );
            const cache_dir = cache_result.cache_dir;
            const cache_dir_subpath = cache_result.cache_dir_subpath;
            break :brk .{ cache_dir, cache_dir_subpath, changes_dir, pkg };
        },
    };

    // zls
    const cache_dir: std.fs.Dir = _cache_dir;
    const cache_dir_subpath: stringZ = _cache_dir_subpath;
    const changes_dir: []const u8 = _changes_dir;
    const pkg: Package = _pkg;

    const name = pkg.name.slice(lockfile.buffers.string_bytes.items);
    const resolution_label = std.fmt.bufPrint(&resolution_buf, "{s}@{}", .{ name, pkg.resolution.fmt(lockfile.buffers.string_bytes.items, .posix) }) catch unreachable;

    const patchfile_contents = brk: {
        const new_folder = changes_dir;
        var buf2: bun.PathBuffer = undefined;
        var buf3: bun.PathBuffer = undefined;
        const old_folder = old_folder: {
            const cache_dir_path = switch (bun.sys.getFdPath(.fromStdDir(cache_dir), &buf2)) {
                .result => |s| s,
                .err => |e| {
                    Output.err(e, "failed to read from cache", .{});
                    Global.crash();
                },
            };
            break :old_folder bun.path.join(&[_][]const u8{
                cache_dir_path,
                cache_dir_subpath,
            }, .posix);
        };

        const random_tempdir = bun.span(bun.fs.FileSystem.instance.tmpname("node_modules_tmp", buf2[0..], bun.fastRandom()) catch |e| {
            Output.err(e, "failed to make tempdir", .{});
            Global.crash();
        });

        // If the package has nested a node_modules folder, we don't want this to
        // appear in the patch file when we run git diff.
        //
        // There isn't an option to exclude it with `git diff --no-index`, so we
        // will `rename()` it out and back again.
        const has_nested_node_modules = has_nested_node_modules: {
            var new_folder_handle = std.fs.cwd().openDir(new_folder, .{}) catch |e| {
                Output.err(e, "failed to open directory <b>{s}<r>", .{new_folder});
                Global.crash();
            };
            defer new_folder_handle.close();

            if (bun.sys.renameatConcurrently(
                .fromStdDir(new_folder_handle),
                "node_modules",
                .fromStdDir(root_node_modules),
                random_tempdir,
                .{ .move_fallback = true },
            ).asErr()) |_| break :has_nested_node_modules false;

            break :has_nested_node_modules true;
        };

        const patch_tag_tmpname = bun.span(bun.fs.FileSystem.instance.tmpname("patch_tmp", buf3[0..], bun.fastRandom()) catch |e| {
            Output.err(e, "failed to make tempdir", .{});
            Global.crash();
        });

        var bunpatchtagbuf: BuntagHashBuf = undefined;
        // If the package was already patched then it might have a ".bun-tag-XXXXXXXX"
        // we need to rename this out and back too.
        const bun_patch_tag: ?[:0]const u8 = has_bun_patch_tag: {
            const name_and_version_hash = String.Builder.stringHash(resolution_label);
            const patch_tag = patch_tag: {
                if (lockfile.patched_dependencies.get(name_and_version_hash)) |patchdep| {
                    if (patchdep.patchfileHash()) |hash| {
                        break :patch_tag buntaghashbuf_make(&bunpatchtagbuf, hash);
                    }
                }
                break :has_bun_patch_tag null;
            };
            var new_folder_handle = std.fs.cwd().openDir(new_folder, .{}) catch |e| {
                Output.err(e, "failed to open directory <b>{s}<r>", .{new_folder});
                Global.crash();
            };
            defer new_folder_handle.close();

            if (bun.sys.renameatConcurrently(
                .fromStdDir(new_folder_handle),
                patch_tag,
                .fromStdDir(root_node_modules),
                patch_tag_tmpname,
                .{ .move_fallback = true },
            ).asErr()) |e| {
                Output.warn("failed renaming the bun patch tag, this may cause issues: {}", .{e});
                break :has_bun_patch_tag null;
            }
            break :has_bun_patch_tag patch_tag;
        };
        defer {
            if (has_nested_node_modules or bun_patch_tag != null) {
                var new_folder_handle = std.fs.cwd().openDir(new_folder, .{}) catch |e| {
                    Output.prettyError(
                        "<r><red>error<r>: failed to open directory <b>{s}<r> {s}<r>\n",
                        .{ new_folder, @errorName(e) },
                    );
                    Global.crash();
                };
                defer new_folder_handle.close();

                if (has_nested_node_modules) {
                    if (bun.sys.renameatConcurrently(
                        .fromStdDir(root_node_modules),
                        random_tempdir,
                        .fromStdDir(new_folder_handle),
                        "node_modules",
                        .{ .move_fallback = true },
                    ).asErr()) |e| {
                        Output.warn("failed renaming nested node_modules folder, this may cause issues: {}", .{e});
                    }
                }

                if (bun_patch_tag) |patch_tag| {
                    if (bun.sys.renameatConcurrently(
                        .fromStdDir(root_node_modules),
                        patch_tag_tmpname,
                        .fromStdDir(new_folder_handle),
                        patch_tag,
                        .{ .move_fallback = true },
                    ).asErr()) |e| {
                        Output.warn("failed renaming the bun patch tag, this may cause issues: {}", .{e});
                    }
                }
            }
        }

        var cwdbuf: bun.PathBuffer = undefined;
        const cwd = switch (bun.sys.getcwdZ(&cwdbuf)) {
            .result => |fd| fd,
            .err => |e| {
                Output.prettyError(
                    "<r><red>error<r>: failed to get cwd path {}<r>\n",
                    .{e},
                );
                Global.crash();
            },
        };
        var gitbuf: bun.PathBuffer = undefined;
        const git = bun.which(&gitbuf, bun.getenvZ("PATH") orelse "", cwd, "git") orelse {
            Output.prettyError(
                "<r><red>error<r>: git must be installed to use `bun patch --commit` <r>\n",
                .{},
            );
            Global.crash();
        };
        const paths = bun.patch.gitDiffPreprocessPaths(bun.default_allocator, old_folder, new_folder, false);
        const opts = bun.patch.spawnOpts(paths[0], paths[1], cwd, git, &manager.event_loop);

        var spawn_result = switch (bun.spawnSync(&opts) catch |e| {
            Output.prettyError(
                "<r><red>error<r>: failed to make diff {s}<r>\n",
                .{@errorName(e)},
            );
            Global.crash();
        }) {
            .result => |r| r,
            .err => |e| {
                Output.prettyError(
                    "<r><red>error<r>: failed to make diff {}<r>\n",
                    .{e},
                );
                Global.crash();
            },
        };

        const contents = switch (bun.patch.diffPostProcess(&spawn_result, paths[0], paths[1]) catch |e| {
            Output.prettyError(
                "<r><red>error<r>: failed to make diff {s}<r>\n",
                .{@errorName(e)},
            );
            Global.crash();
        }) {
            .result => |stdout| stdout,
            .err => |stderr| {
                defer stderr.deinit();
                const Truncate = struct {
                    stderr: std.ArrayList(u8),

                    pub fn format(
                        this: *const @This(),
                        comptime _: []const u8,
                        _: std.fmt.FormatOptions,
                        writer: anytype,
                    ) !void {
                        const truncate_stderr = this.stderr.items.len > 256;
                        if (truncate_stderr) {
                            try writer.print("{s}... ({d} more bytes)", .{ this.stderr.items[0..256], this.stderr.items.len - 256 });
                        } else try writer.print("{s}", .{this.stderr.items[0..]});
                    }
                };
                Output.prettyError(
                    "<r><red>error<r>: failed to make diff {}<r>\n",
                    .{
                        Truncate{ .stderr = stderr },
                    },
                );
                Global.crash();
            },
        };

        if (contents.items.len == 0) {
            Output.pretty("\n<r>No changes detected, comparing <red>{s}<r> to <green>{s}<r>\n", .{ old_folder, new_folder });
            Output.flush();
            contents.deinit();
            return null;
        }

        break :brk contents;
    };
    defer patchfile_contents.deinit();

    // write the patch contents to temp file then rename
    var tmpname_buf: [1024]u8 = undefined;
    const tempfile_name = bun.span(try bun.fs.FileSystem.instance.tmpname("tmp", &tmpname_buf, bun.fastRandom()));
    const tmpdir = manager.getTemporaryDirectory();
    const tmpfd = switch (bun.sys.openat(
        .fromStdDir(tmpdir),
        tempfile_name,
        bun.O.RDWR | bun.O.CREAT,
        0o666,
    )) {
        .result => |fd| fd,
        .err => |e| {
            Output.err(e, "failed to open temp file", .{});
            Global.crash();
        },
    };
    defer tmpfd.close();

    if (bun.sys.File.writeAll(.{ .handle = tmpfd }, patchfile_contents.items).asErr()) |e| {
        Output.err(e, "failed to write patch to temp file", .{});
        Global.crash();
    }

    @memcpy(resolution_buf[resolution_label.len .. resolution_label.len + ".patch".len], ".patch");
    var patch_filename: []const u8 = resolution_buf[0 .. resolution_label.len + ".patch".len];
    var deinit = false;
    if (escapePatchFilename(manager.allocator, patch_filename)) |escaped| {
        deinit = true;
        patch_filename = escaped;
    }
    defer if (deinit) manager.allocator.free(patch_filename);

    const path_in_patches_dir = bun.path.joinZ(
        &[_][]const u8{
            manager.options.patch_features.commit.patches_dir,
            patch_filename,
        },
        .posix,
    );

    var nodefs = bun.JSC.Node.fs.NodeFS{};
    const args = bun.JSC.Node.fs.Arguments.Mkdir{
        .path = .{ .string = bun.PathString.init(manager.options.patch_features.commit.patches_dir) },
    };
    if (nodefs.mkdirRecursive(args).asErr()) |e| {
        Output.err(e, "failed to make patches dir {}", .{bun.fmt.quote(args.path.slice())});
        Global.crash();
    }

    // rename to patches dir
    if (bun.sys.renameatConcurrently(
        .fromStdDir(tmpdir),
        tempfile_name,
        bun.FD.cwd(),
        path_in_patches_dir,
        .{ .move_fallback = true },
    ).asErr()) |e| {
        Output.err(e, "failed renaming patch file to patches dir", .{});
        Global.crash();
    }

    const patch_key = std.fmt.allocPrint(manager.allocator, "{s}", .{resolution_label}) catch bun.outOfMemory();
    const patchfile_path = manager.allocator.dupe(u8, path_in_patches_dir) catch bun.outOfMemory();
    _ = bun.sys.unlink(bun.path.joinZ(&[_][]const u8{ changes_dir, ".bun-patch-tag" }, .auto));

    return .{
        .patch_key = patch_key,
        .patchfile_path = patchfile_path,
        .not_in_workspace_root = not_in_workspace_root,
    };
}

fn patchCommitGetVersion(
    buf: *[1024]u8,
    patch_tag_path: [:0]const u8,
) bun.sys.Maybe(string) {
    const patch_tag_fd = switch (bun.sys.open(patch_tag_path, bun.O.RDONLY, 0)) {
        .result => |fd| fd,
        .err => |e| return .{ .err = e },
    };
    defer {
        patch_tag_fd.close();
        // we actually need to delete this
        _ = bun.sys.unlink(patch_tag_path);
    }

    const version = switch (bun.sys.File.readFillBuf(.{ .handle = patch_tag_fd }, buf[0..])) {
        .result => |v| v,
        .err => |e| return .{ .err = e },
    };

    // maybe if someone opens it in their editor and hits save a newline will be inserted,
    // so trim that off
    return .{ .result = std.mem.trimRight(u8, version, " \n\r\t") };
}

fn escapePatchFilename(allocator: std.mem.Allocator, name: []const u8) ?[]const u8 {
    const EscapeVal = enum {
        @"/",
        @"\\",
        @" ",
        @"\n",
        @"\r",
        @"\t",
        // @".",
        other,

        pub fn escaped(this: @This()) ?[]const u8 {
            return switch (this) {
                .@"/" => "%2F",
                .@"\\" => "%5c",
                .@" " => "%20",
                .@"\n" => "%0A",
                .@"\r" => "%0D",
                .@"\t" => "%09",
                // .@"." => "%2E",
                .other => null,
            };
        }
    };
    const ESCAPE_TABLE: [256]EscapeVal = comptime brk: {
        var table: [256]EscapeVal = [_]EscapeVal{.other} ** 256;
        const ty = @typeInfo(EscapeVal);
        for (ty.@"enum".fields) |field| {
            if (field.name.len == 1) {
                const c = field.name[0];
                table[c] = @enumFromInt(field.value);
            }
        }
        break :brk table;
    };
    var count: usize = 0;
    for (name) |c| count += if (ESCAPE_TABLE[c].escaped()) |e| e.len else 1;
    if (count == name.len) return null;
    var buf = allocator.alloc(u8, count) catch bun.outOfMemory();
    var i: usize = 0;
    for (name) |c| {
        const e = ESCAPE_TABLE[c].escaped() orelse &[_]u8{c};
        @memcpy(buf[i..][0..e.len], e);
        i += e.len;
    }
    return buf;
}

/// 1. Arg is either:
///   - name and possibly version (e.g. "is-even" or "is-even@1.0.0")
///   - path to package in node_modules
/// 2. Calculate cache dir for package
/// 3. Overwrite the input package with the one from the cache (cuz it could be hardlinked)
/// 4. Print to user
pub fn preparePatch(manager: *PackageManager) !void {
    const strbuf = manager.lockfile.buffers.string_bytes.items;
    var argument = manager.options.positionals[1];

    const arg_kind: PatchArgKind = PatchArgKind.fromArg(argument);

    var folder_path_buf: bun.PathBuffer = undefined;
    var iterator = Lockfile.Tree.Iterator(.node_modules).init(manager.lockfile);
    var resolution_buf: [1024]u8 = undefined;

    var win_normalizer: if (bun.Environment.isWindows) bun.PathBuffer else struct {} = undefined;

    const not_in_workspace_root = manager.root_package_id.get(manager.lockfile, manager.workspace_name_hash) != 0;
    var free_argument = false;
    argument = if (arg_kind == .path and
        not_in_workspace_root and
        (!bun.path.Platform.posix.isAbsolute(argument) or (bun.Environment.isWindows and !bun.path.Platform.windows.isAbsolute(argument))))
    brk: {
        if (pathArgumentRelativeToRootWorkspacePackage(manager, manager.lockfile, argument)) |rel_path| {
            free_argument = true;
            break :brk rel_path;
        }
        break :brk argument;
    } else argument;
    defer if (free_argument) manager.allocator.free(argument);

    const cache_dir: std.fs.Dir, const cache_dir_subpath: []const u8, const module_folder: []const u8, const pkg_name: []const u8 = switch (arg_kind) {
        .path => brk: {
            var lockfile = manager.lockfile;

            const package_json_source: *const logger.Source = &src: {
                const package_json_path = bun.path.joinZ(&[_][]const u8{ argument, "package.json" }, .auto);

                switch (bun.sys.File.toSource(package_json_path, manager.allocator, .{})) {
                    .result => |s| break :src s,
                    .err => |e| {
                        Output.err(e, "failed to read {s}", .{bun.fmt.quote(package_json_path)});
                        Global.crash();
                    },
                }
            };
            defer manager.allocator.free(package_json_source.contents);

            initializeStore();
            const json = JSON.parsePackageJSONUTF8(package_json_source, manager.log, manager.allocator) catch |err| {
                manager.log.print(Output.errorWriter()) catch {};
                Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(err), package_json_source.path.prettyDir() });
                Global.crash();
            };

            const version = version: {
                if (json.asProperty("version")) |v| {
                    if (v.expr.asString(manager.allocator)) |s| break :version s;
                }
                Output.prettyError(
                    "<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {s}<r>\n",
                    .{package_json_source.path.text},
                );
                Global.crash();
            };

            var resolver: void = {};
            var package = Lockfile.Package{};
            try package.parseWithJSON(lockfile, manager, manager.allocator, manager.log, package_json_source, json, void, &resolver, Features.folder);

            const name = lockfile.str(&package.name);
            const actual_package = switch (lockfile.package_index.get(package.name_hash) orelse {
                Output.prettyError(
                    "<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n",
                    .{},
                );
                Global.crash();
            }) {
                .id => |id| lockfile.packages.get(id),
                .ids => |ids| id: {
                    for (ids.items) |id| {
                        const pkg = lockfile.packages.get(id);
                        const resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{pkg.resolution.fmt(lockfile.buffers.string_bytes.items, .posix)}) catch unreachable;
                        if (std.mem.eql(u8, resolution_label, version)) {
                            break :id pkg;
                        }
                    }
                    Output.prettyError("<r><red>error<r>: could not find package with name:<r> {s}\n<r>", .{
                        package.name.slice(lockfile.buffers.string_bytes.items),
                    });
                    Global.crash();
                },
            };

            const existing_patchfile_hash = existing_patchfile_hash: {
                var __sfb = std.heap.stackFallback(1024, manager.allocator);
                const allocator = __sfb.get();
                const name_and_version = std.fmt.allocPrint(allocator, "{s}@{}", .{ name, actual_package.resolution.fmt(strbuf, .posix) }) catch unreachable;
                defer allocator.free(name_and_version);
                const name_and_version_hash = String.Builder.stringHash(name_and_version);
                if (lockfile.patched_dependencies.get(name_and_version_hash)) |patched_dep| {
                    if (patched_dep.patchfileHash()) |hash| break :existing_patchfile_hash hash;
                }
                break :existing_patchfile_hash null;
            };

            const cache_result = manager.computeCacheDirAndSubpath(
                name,
                &actual_package.resolution,
                &folder_path_buf,
                existing_patchfile_hash,
            );
            const cache_dir = cache_result.cache_dir;
            const cache_dir_subpath = cache_result.cache_dir_subpath;

            const buf = if (comptime bun.Environment.isWindows) bun.path.pathToPosixBuf(u8, argument, win_normalizer[0..]) else argument;

            break :brk .{
                cache_dir,
                cache_dir_subpath,
                buf,
                name,
            };
        },
        .name_and_version => brk: {
            const pkg_maybe_version_to_patch = argument;
            const name, const version = Dependency.splitNameAndMaybeVersion(pkg_maybe_version_to_patch);
            const pkg_id, const folder = pkgInfoForNameAndVersion(manager.lockfile, &iterator, pkg_maybe_version_to_patch, name, version);

            const pkg = manager.lockfile.packages.get(pkg_id);
            const pkg_name = pkg.name.slice(strbuf);

            const existing_patchfile_hash = existing_patchfile_hash: {
                var __sfb = std.heap.stackFallback(1024, manager.allocator);
                const sfballoc = __sfb.get();
                const name_and_version = std.fmt.allocPrint(sfballoc, "{s}@{}", .{ name, pkg.resolution.fmt(strbuf, .posix) }) catch unreachable;
                defer sfballoc.free(name_and_version);
                const name_and_version_hash = String.Builder.stringHash(name_and_version);
                if (manager.lockfile.patched_dependencies.get(name_and_version_hash)) |patched_dep| {
                    if (patched_dep.patchfileHash()) |hash| break :existing_patchfile_hash hash;
                }
                break :existing_patchfile_hash null;
            };

            const cache_result = manager.computeCacheDirAndSubpath(
                pkg_name,
                &pkg.resolution,
                &folder_path_buf,
                existing_patchfile_hash,
            );

            const cache_dir = cache_result.cache_dir;
            const cache_dir_subpath = cache_result.cache_dir_subpath;

            const module_folder_ = bun.path.join(&[_][]const u8{ folder.relative_path, name }, .auto);
            const buf = if (comptime bun.Environment.isWindows) bun.path.pathToPosixBuf(u8, module_folder_, win_normalizer[0..]) else module_folder_;

            break :brk .{
                cache_dir,
                cache_dir_subpath,
                buf,
                pkg_name,
            };
        },
    };

    // The package may be installed using the hard link method,
    // meaning that changes to the folder will also change the package in the cache.
    //
    // So we will overwrite the folder by directly copying the package in cache into it
    overwritePackageInNodeModulesFolder(manager, cache_dir, cache_dir_subpath, module_folder) catch |e| {
        Output.prettyError(
            "<r><red>error<r>: error overwriting folder in node_modules: {s}\n<r>",
            .{@errorName(e)},
        );
        Global.crash();
    };

    if (not_in_workspace_root) {
        var bufn: bun.PathBuffer = undefined;
        Output.pretty("\nTo patch <b>{s}<r>, edit the following folder:\n\n  <cyan>{s}<r>\n", .{ pkg_name, bun.path.joinStringBuf(bufn[0..], &[_][]const u8{ bun.fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(), module_folder }, .posix) });
        Output.pretty("\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{s}'<r>\n", .{bun.path.joinStringBuf(bufn[0..], &[_][]const u8{ bun.fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(), module_folder }, .posix)});
    } else {
        Output.pretty("\nTo patch <b>{s}<r>, edit the following folder:\n\n  <cyan>{s}<r>\n", .{ pkg_name, module_folder });
        Output.pretty("\nOnce you're done with your changes, run:\n\n  <cyan>bun patch --commit '{s}'<r>\n", .{module_folder});
    }

    return;
}

fn overwritePackageInNodeModulesFolder(
    manager: *PackageManager,
    cache_dir: std.fs.Dir,
    cache_dir_subpath: []const u8,
    node_modules_folder_path: []const u8,
) !void {
    var node_modules_folder = try std.fs.cwd().openDir(node_modules_folder_path, .{ .iterate = true });
    defer node_modules_folder.close();

    const IGNORED_PATHS: []const bun.OSPathSlice = &[_][]const bun.OSPathChar{
        bun.OSPathLiteral("node_modules"),
        bun.OSPathLiteral(".git"),
        bun.OSPathLiteral("CMakeFiles"),
    };

    const FileCopier = struct {
        pub fn copy(
            destination_dir_: std.fs.Dir,
            walker: *Walker,
            in_dir: if (bun.Environment.isWindows) []const u16 else void,
            out_dir: if (bun.Environment.isWindows) []const u16 else void,
            buf1: if (bun.Environment.isWindows) []u16 else void,
            buf2: if (bun.Environment.isWindows) []u16 else void,
            tmpdir_in_node_modules: if (bun.Environment.isWindows) std.fs.Dir else void,
        ) !u32 {
            var real_file_count: u32 = 0;

            var copy_file_state: bun.CopyFileState = .{};
            var pathbuf: bun.PathBuffer = undefined;
            var pathbuf2: bun.PathBuffer = undefined;
            // _ = pathbuf; // autofix

            while (try walker.next().unwrap()) |entry| {
                if (entry.kind != .file) continue;
                real_file_count += 1;
                const createFile = std.fs.Dir.createFile;

                // 1. rename original file in node_modules to tmp_dir_in_node_modules
                // 2. create the file again
                // 3. copy cache flie to the newly re-created file
                // 4. profit
                if (comptime bun.Environment.isWindows) {
                    var tmpbuf: [1024]u8 = undefined;
                    const basename = bun.strings.fromWPath(pathbuf2[0..], entry.basename);
                    const tmpname = bun.span(bun.fs.FileSystem.instance.tmpname(basename, tmpbuf[0..], bun.fastRandom()) catch |e| {
                        Output.prettyError("<r><red>error<r>: copying file {s}", .{@errorName(e)});
                        Global.crash();
                    });

                    const entrypath = bun.strings.fromWPath(pathbuf[0..], entry.path);
                    pathbuf[entrypath.len] = 0;
                    const entrypathZ = pathbuf[0..entrypath.len :0];

                    if (bun.sys.renameatConcurrently(
                        .fromStdDir(destination_dir_),
                        entrypathZ,
                        .fromStdDir(tmpdir_in_node_modules),
                        tmpname,
                        .{ .move_fallback = true },
                    ).asErr()) |e| {
                        Output.prettyError("<r><red>error<r>: copying file {}", .{e});
                        Global.crash();
                    }

                    var outfile = createFile(destination_dir_, entrypath, .{}) catch |e| {
                        Output.prettyError("<r><red>error<r>: failed to create file {s} ({s})", .{ entrypath, @errorName(e) });
                        Global.crash();
                    };
                    outfile.close();

                    const infile_path = bun.path.joinStringBufWZ(buf1, &[_][]const u16{ in_dir, entry.path }, .auto);
                    const outfile_path = bun.path.joinStringBufWZ(buf2, &[_][]const u16{ out_dir, entry.path }, .auto);

                    bun.copyFileWithState(infile_path, outfile_path, &copy_file_state).unwrap() catch |err| {
                        Output.prettyError("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path, .{}) });
                        Global.crash();
                    };
                } else if (comptime Environment.isPosix) {
                    var in_file = try entry.dir.openat(entry.basename, bun.O.RDONLY, 0).unwrap();
                    defer in_file.close();

                    @memcpy(pathbuf[0..entry.path.len], entry.path);
                    pathbuf[entry.path.len] = 0;

                    if (bun.sys.unlinkat(
                        .fromStdDir(destination_dir_),
                        pathbuf[0..entry.path.len :0],
                    ).asErr()) |e| {
                        Output.prettyError("<r><red>error<r>: copying file {}", .{e.withPath(entry.path)});
                        Global.crash();
                    }

                    var outfile = try createFile(destination_dir_, entry.path, .{});
                    defer outfile.close();

                    const stat = in_file.stat().unwrap() catch continue;
                    _ = bun.c.fchmod(outfile.handle, @intCast(stat.mode));

                    bun.copyFileWithState(in_file, .fromStdFile(outfile), &copy_file_state).unwrap() catch |err| {
                        Output.prettyError("<r><red>{s}<r>: copying file {}", .{ @errorName(err), bun.fmt.fmtOSPath(entry.path, .{}) });
                        Global.crash();
                    };
                }
            }

            return real_file_count;
        }
    };

    var pkg_in_cache_dir = try cache_dir.openDir(cache_dir_subpath, .{ .iterate = true });
    defer pkg_in_cache_dir.close();
    var walker = Walker.walk(.fromStdDir(pkg_in_cache_dir), manager.allocator, &.{}, IGNORED_PATHS) catch bun.outOfMemory();
    defer walker.deinit();

    var buf1: if (bun.Environment.isWindows) bun.WPathBuffer else void = undefined;
    var buf2: if (bun.Environment.isWindows) bun.WPathBuffer else void = undefined;
    var in_dir: if (bun.Environment.isWindows) []const u16 else void = undefined;
    var out_dir: if (bun.Environment.isWindows) []const u16 else void = undefined;

    if (comptime bun.Environment.isWindows) {
        const inlen = bun.windows.GetFinalPathNameByHandleW(pkg_in_cache_dir.fd, &buf1, buf1.len, 0);
        if (inlen == 0) {
            const e = bun.windows.Win32Error.get();
            const err = if (e.toSystemErrno()) |sys_err| bun.errnoToZigErr(sys_err) else error.Unexpected;
            Output.prettyError("<r><red>error<r>: copying file {}", .{err});
            Global.crash();
        }
        in_dir = buf1[0..inlen];
        const outlen = bun.windows.GetFinalPathNameByHandleW(node_modules_folder.fd, &buf2, buf2.len, 0);
        if (outlen == 0) {
            const e = bun.windows.Win32Error.get();
            const err = if (e.toSystemErrno()) |sys_err| bun.errnoToZigErr(sys_err) else error.Unexpected;
            Output.prettyError("<r><red>error<r>: copying file {}", .{err});
            Global.crash();
        }
        out_dir = buf2[0..outlen];
        var tmpbuf: [1024]u8 = undefined;
        const tmpname = bun.span(bun.fs.FileSystem.instance.tmpname("tffbp", tmpbuf[0..], bun.fastRandom()) catch |e| {
            Output.prettyError("<r><red>error<r>: copying file {s}", .{@errorName(e)});
            Global.crash();
        });
        const temp_folder_in_node_modules = try node_modules_folder.makeOpenPath(tmpname, .{});
        defer {
            node_modules_folder.deleteTree(tmpname) catch {};
        }
        _ = try FileCopier.copy(
            node_modules_folder,
            &walker,
            in_dir,
            out_dir,
            &buf1,
            &buf2,
            temp_folder_in_node_modules,
        );
    } else if (Environment.isPosix) {
        _ = try FileCopier.copy(
            node_modules_folder,
            &walker,
            {},
            {},
            {},
            {},
            {},
        );
    }
}

fn nodeModulesFolderForDependencyIDs(iterator: *Lockfile.Tree.Iterator(.node_modules), ids: []const IdPair) !?Lockfile.Tree.Iterator(.node_modules).Next {
    while (iterator.next(null)) |node_modules| {
        for (ids) |id| {
            _ = std.mem.indexOfScalar(DependencyID, node_modules.dependencies, id[0]) orelse continue;
            return node_modules;
        }
    }
    return null;
}

fn nodeModulesFolderForDependencyID(iterator: *Lockfile.Tree.Iterator(.node_modules), dependency_id: DependencyID) !?Lockfile.Tree.Iterator(.node_modules).Next {
    while (iterator.next(null)) |node_modules| {
        _ = std.mem.indexOfScalar(DependencyID, node_modules.dependencies, dependency_id) orelse continue;
        return node_modules;
    }

    return null;
}

const IdPair = struct { DependencyID, PackageID };

fn pkgInfoForNameAndVersion(
    lockfile: *Lockfile,
    iterator: *Lockfile.Tree.Iterator(.node_modules),
    pkg_maybe_version_to_patch: []const u8,
    name: []const u8,
    version: ?[]const u8,
) struct { PackageID, Lockfile.Tree.Iterator(.node_modules).Next } {
    var sfb = std.heap.stackFallback(@sizeOf(IdPair) * 4, lockfile.allocator);
    var pairs = std.ArrayList(IdPair).initCapacity(sfb.get(), 8) catch bun.outOfMemory();
    defer pairs.deinit();

    const name_hash = String.Builder.stringHash(name);

    const strbuf = lockfile.buffers.string_bytes.items;

    var buf: [1024]u8 = undefined;
    const dependencies = lockfile.buffers.dependencies.items;

    for (dependencies, 0..) |dep, dep_id| {
        if (dep.name_hash != name_hash) continue;
        const pkg_id = lockfile.buffers.resolutions.items[dep_id];
        if (pkg_id == invalid_package_id) continue;
        const pkg = lockfile.packages.get(pkg_id);
        if (version) |v| {
            const label = std.fmt.bufPrint(buf[0..], "{}", .{pkg.resolution.fmt(strbuf, .posix)}) catch @panic("Resolution name too long");
            if (std.mem.eql(u8, label, v)) {
                pairs.append(.{ @intCast(dep_id), pkg_id }) catch bun.outOfMemory();
            }
        } else {
            pairs.append(.{ @intCast(dep_id), pkg_id }) catch bun.outOfMemory();
        }
    }

    if (pairs.items.len == 0) {
        Output.prettyErrorln("\n<r><red>error<r>: package <b>{s}<r> not found<r>", .{pkg_maybe_version_to_patch});
        Global.crash();
        return;
    }

    // user supplied a version e.g. `is-even@1.0.0`
    if (version != null) {
        if (pairs.items.len == 1) {
            const dep_id, const pkg_id = pairs.items[0];
            const folder = (try nodeModulesFolderForDependencyID(iterator, dep_id)) orelse {
                Output.prettyError(
                    "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                    .{pkg_maybe_version_to_patch},
                );
                Global.crash();
            };
            return .{
                pkg_id,
                folder,
            };
        }

        // we found multiple dependents of the supplied pkg + version
        // the final package in the node_modules might be hoisted
        // so we are going to try looking for each dep id in node_modules
        _, const pkg_id = pairs.items[0];
        const folder = (try nodeModulesFolderForDependencyIDs(iterator, pairs.items)) orelse {
            Output.prettyError(
                "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                .{pkg_maybe_version_to_patch},
            );
            Global.crash();
        };

        return .{
            pkg_id,
            folder,
        };
    }

    // Otherwise the user did not supply a version, just the pkg name

    // Only one match, let's use it
    if (pairs.items.len == 1) {
        const dep_id, const pkg_id = pairs.items[0];
        const folder = (try nodeModulesFolderForDependencyID(iterator, dep_id)) orelse {
            Output.prettyError(
                "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                .{pkg_maybe_version_to_patch},
            );
            Global.crash();
        };
        return .{
            pkg_id,
            folder,
        };
    }

    // Otherwise we have multiple matches
    //
    // There are two cases:
    // a) the multiple matches are all the same underlying package (this happens because there could be multiple dependents of the same package)
    // b) the matches are actually different packages, we'll prompt the user to select which one

    _, const pkg_id = pairs.items[0];
    const count = count: {
        var count: u32 = 0;
        for (pairs.items) |pair| {
            if (pair[1] == pkg_id) count += 1;
        }
        break :count count;
    };

    // Disambiguate case a) from b)
    if (count == pairs.items.len) {
        // It may be hoisted, so we'll try the first one that matches
        const folder = (try nodeModulesFolderForDependencyIDs(iterator, pairs.items)) orelse {
            Output.prettyError(
                "<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>",
                .{pkg_maybe_version_to_patch},
            );
            Global.crash();
        };
        return .{
            pkg_id,
            folder,
        };
    }

    Output.prettyErrorln(
        "\n<r><red>error<r>: Found multiple versions of <b>{s}<r>, please specify a precise version from the following list:<r>\n",
        .{name},
    );
    var i: usize = 0;
    while (i < pairs.items.len) : (i += 1) {
        _, const pkgid = pairs.items[i];
        if (pkgid == invalid_package_id)
            continue;

        const pkg = lockfile.packages.get(pkgid);

        Output.prettyError("  {s}@<blue>{}<r>\n", .{ pkg.name.slice(strbuf), pkg.resolution.fmt(strbuf, .posix) });

        if (i + 1 < pairs.items.len) {
            for (pairs.items[i + 1 ..]) |*p| {
                if (p[1] == pkgid) {
                    p[1] = invalid_package_id;
                }
            }
        }
    }
    Global.crash();
}

fn pathArgumentRelativeToRootWorkspacePackage(manager: *PackageManager, lockfile: *const Lockfile, argument: []const u8) ?[]const u8 {
    const workspace_package_id = manager.root_package_id.get(lockfile, manager.workspace_name_hash);
    if (workspace_package_id == 0) return null;
    const workspace_res = lockfile.packages.items(.resolution)[workspace_package_id];
    const rel_path: []const u8 = workspace_res.value.workspace.slice(lockfile.buffers.string_bytes.items);
    return bun.default_allocator.dupe(u8, bun.path.join(&[_][]const u8{ rel_path, argument }, .posix)) catch bun.outOfMemory();
}

const PatchArgKind = enum {
    path,
    name_and_version,

    pub fn fromArg(argument: []const u8) PatchArgKind {
        if (bun.strings.containsComptime(argument, "node_modules/")) return .path;
        if (bun.Environment.isWindows and bun.strings.hasPrefix(argument, "node_modules\\")) return .path;
        return .name_and_version;
    }
};

// @sortImports

const Walker = @import("../../walker_skippable.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const JSC = bun.JSC;
const JSON = bun.JSON;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const logger = bun.logger;
const string = bun.string;
const stringZ = bun.stringZ;
const strings = bun.strings;
const File = bun.sys.File;

const Semver = bun.Semver;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const BuntagHashBuf = bun.install.BuntagHashBuf;
const Dependency = bun.install.Dependency;
const DependencyID = bun.install.DependencyID;
const Features = bun.install.Features;
const PackageID = bun.install.PackageID;
const Resolution = bun.install.Resolution;
const buntaghashbuf_make = bun.install.buntaghashbuf_make;
const initializeStore = bun.install.initializeStore;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = bun.install.PackageManager;
const Options = PackageManager.Options;
