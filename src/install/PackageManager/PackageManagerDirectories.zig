pub inline fn getCacheDirectory(this: *PackageManager) std.fs.Dir {
    return this.cache_directory_ orelse brk: {
        this.cache_directory_ = ensureCacheDirectory(this);
        break :brk this.cache_directory_.?;
    };
}

pub inline fn getCacheDirectoryAndAbsPath(this: *PackageManager) struct { FD, bun.AbsPath(.{}) } {
    const cache_dir = this.getCacheDirectory();
    return .{ .fromStdDir(cache_dir), .from(this.cache_directory_path) };
}

pub inline fn getTemporaryDirectory(this: *PackageManager) TemporaryDirectory {
    return getTemporaryDirectoryOnce.call(.{this});
}

const TemporaryDirectory = struct {
    handle: std.fs.Dir,
    path: [:0]const u8,
    name: []const u8,
};

var getTemporaryDirectoryOnce = bun.once(struct {
    // We need a temporary directory that can be rename()
    // This is important for extracting files.
    //
    // However, we want it to be reused! Otherwise a cache is silly.
    //   Error RenameAcrossMountPoints moving react-is to cache dir:
    pub fn run(manager: *PackageManager) TemporaryDirectory {
        var cache_directory = manager.getCacheDirectory();
        // The chosen tempdir must be on the same filesystem as the cache directory
        // This makes renameat() work
        const temp_dir_name = Fs.FileSystem.RealFS.getDefaultTempDir();

        var tried_dot_tmp = false;
        var tempdir: std.fs.Dir = bun.MakePath.makeOpenPath(std.fs.cwd(), temp_dir_name, .{}) catch brk: {
            tried_dot_tmp = true;
            break :brk bun.MakePath.makeOpenPath(cache_directory, bun.pathLiteral(".tmp"), .{}) catch |err| {
                Output.prettyErrorln("<r><red>error<r>: bun is unable to access tempdir: {s}", .{@errorName(err)});
                Global.crash();
            };
        };
        var tmpbuf: bun.PathBuffer = undefined;
        const tmpname = Fs.FileSystem.tmpname("hm", &tmpbuf, bun.fastRandom()) catch unreachable;
        var timer: std.time.Timer = if (manager.options.log_level != .silent) std.time.Timer.start() catch unreachable else undefined;
        brk: while (true) {
            var file = tempdir.createFileZ(tmpname, .{ .truncate = true }) catch |err2| {
                if (!tried_dot_tmp) {
                    tried_dot_tmp = true;

                    tempdir = bun.MakePath.makeOpenPath(cache_directory, bun.pathLiteral(".tmp"), .{}) catch |err| {
                        Output.prettyErrorln("<r><red>error<r>: bun is unable to access tempdir: {s}", .{@errorName(err)});
                        Global.crash();
                    };

                    if (PackageManager.verbose_install) {
                        Output.prettyErrorln("<r><yellow>warn<r>: bun is unable to access tempdir: {s}, using fallback", .{@errorName(err2)});
                    }

                    continue :brk;
                }
                Output.prettyErrorln("<r><red>error<r>: {s} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>", .{
                    @errorName(err2),
                });
                Global.crash();
            };
            file.close();

            std.posix.renameatZ(tempdir.fd, tmpname, cache_directory.fd, tmpname) catch |err| {
                if (!tried_dot_tmp) {
                    tried_dot_tmp = true;
                    tempdir = cache_directory.makeOpenPath(".tmp", .{}) catch |err2| {
                        Output.prettyErrorln("<r><red>error<r>: bun is unable to write files to tempdir: {s}", .{@errorName(err2)});
                        Global.crash();
                    };

                    if (PackageManager.verbose_install) {
                        Output.prettyErrorln("<r><d>info<r>: cannot move files from tempdir: {s}, using fallback", .{@errorName(err)});
                    }

                    continue :brk;
                }

                Output.prettyErrorln("<r><red>error<r>: {s} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>", .{
                    @errorName(err),
                });
                Global.crash();
            };
            cache_directory.deleteFileZ(tmpname) catch {};
            break;
        }
        if (tried_dot_tmp) {
            using_fallback_temp_dir = true;
        }
        if (manager.options.log_level != .silent) {
            const elapsed = timer.read();
            if (elapsed > std.time.ns_per_ms * 100) {
                var path_buf: bun.PathBuffer = undefined;
                const cache_dir_path = bun.getFdPath(.fromStdDir(cache_directory), &path_buf) catch "it";
                Output.prettyErrorln(
                    "<r><yellow>warn<r>: Slow filesystem detected. If {s} is a network drive, consider setting $BUN_INSTALL_CACHE_DIR to a local folder.",
                    .{cache_dir_path},
                );
            }
        }

        var buf: bun.PathBuffer = undefined;
        const temp_dir_path = bun.getFdPathZ(.fromStdDir(tempdir), &buf) catch |err| {
            Output.err(err, "Failed to read temporary directory path: '{s}'", .{temp_dir_name});
            Global.exit(1);
        };

        return .{
            .handle = tempdir,
            .name = temp_dir_name,
            .path = bun.handleOom(bun.default_allocator.dupeZ(u8, temp_dir_path)),
        };
    }
}.run);

noinline fn ensureCacheDirectory(this: *PackageManager) std.fs.Dir {
    loop: while (true) {
        if (this.options.enable.cache) {
            const cache_dir = fetchCacheDirectoryPath(this.env, &this.options);
            this.cache_directory_path = bun.handleOom(this.allocator.dupeZ(u8, cache_dir.path));

            return std.fs.cwd().makeOpenPath(cache_dir.path, .{}) catch {
                this.options.enable.cache = false;
                this.allocator.free(this.cache_directory_path);
                continue :loop;
            };
        }

        this.cache_directory_path = this.allocator.dupeZ(u8, Path.joinAbsString(
            Fs.FileSystem.instance.top_level_dir,
            &.{
                "node_modules",
                ".cache",
            },
            .auto,
        )) catch |err| bun.handleOom(err);

        return std.fs.cwd().makeOpenPath("node_modules/.cache", .{}) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: bun is unable to write files: {s}", .{@errorName(err)});
            Global.crash();
        };
    }
    unreachable;
}

const CacheDir = struct { path: string, is_node_modules: bool };
pub fn fetchCacheDirectoryPath(env: *DotEnv.Loader, options: ?*const Options) CacheDir {
    if (env.get("BUN_INSTALL_CACHE_DIR")) |dir| {
        return CacheDir{ .path = Fs.FileSystem.instance.abs(&[_]string{dir}), .is_node_modules = false };
    }

    if (options) |opts| {
        if (opts.cache_directory.len > 0) {
            return CacheDir{ .path = Fs.FileSystem.instance.abs(&[_]string{opts.cache_directory}), .is_node_modules = false };
        }
    }

    if (env.get("BUN_INSTALL")) |dir| {
        var parts = [_]string{ dir, "install/", "cache/" };
        return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
    }

    if (bun.env_var.XDG_CACHE_HOME.get()) |dir| {
        var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
        return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
    }

    if (bun.env_var.HOME.get()) |dir| {
        var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
        return CacheDir{ .path = Fs.FileSystem.instance.abs(&parts), .is_node_modules = false };
    }

    var fallback_parts = [_]string{"node_modules/.bun-cache"};
    return CacheDir{ .is_node_modules = true, .path = Fs.FileSystem.instance.abs(&fallback_parts) };
}

pub fn cachedGitFolderNamePrint(buf: []u8, resolved: string, patch_hash: ?u64) stringZ {
    return std.fmt.bufPrintZ(buf, "@G@{s}{f}", .{ resolved, PatchHashFmt{ .hash = patch_hash } }) catch unreachable;
}

pub fn cachedGitFolderName(this: *const PackageManager, repository: *const Repository, patch_hash: ?u64) stringZ {
    return cachedGitFolderNamePrint(&PackageManager.cached_package_folder_name_buf, this.lockfile.str(&repository.resolved), patch_hash);
}

pub fn cachedGitFolderNamePrintAuto(this: *const PackageManager, repository: *const Repository, patch_hash: ?u64) stringZ {
    if (!repository.resolved.isEmpty()) {
        return this.cachedGitFolderName(repository, patch_hash);
    }

    if (!repository.repo.isEmpty() and !repository.committish.isEmpty()) {
        const string_buf = this.lockfile.buffers.string_bytes.items;
        return std.fmt.bufPrintZ(
            &PackageManager.cached_package_folder_name_buf,
            "@G@{f}{f}{f}",
            .{
                repository.committish.fmt(string_buf),
                CacheVersion.Formatter{ .version_number = CacheVersion.current },
                PatchHashFmt{ .hash = patch_hash },
            },
        ) catch unreachable;
    }

    return "";
}

pub fn cachedGitHubFolderNamePrint(buf: []u8, resolved: string, patch_hash: ?u64) stringZ {
    return std.fmt.bufPrintZ(buf, "@GH@{s}{f}{f}", .{
        resolved,
        CacheVersion.Formatter{ .version_number = CacheVersion.current },
        PatchHashFmt{ .hash = patch_hash },
    }) catch unreachable;
}

pub fn cachedGitHubFolderName(this: *const PackageManager, repository: *const Repository, patch_hash: ?u64) stringZ {
    return cachedGitHubFolderNamePrint(&PackageManager.cached_package_folder_name_buf, this.lockfile.str(&repository.resolved), patch_hash);
}

pub fn cachedGitHubFolderNamePrintAuto(this: *const PackageManager, repository: *const Repository, patch_hash: ?u64) stringZ {
    if (!repository.resolved.isEmpty()) {
        return this.cachedGitHubFolderName(repository, patch_hash);
    }

    if (!repository.owner.isEmpty() and !repository.repo.isEmpty() and !repository.committish.isEmpty()) {
        return cachedGitHubFolderNamePrintGuess(&PackageManager.cached_package_folder_name_buf, this.lockfile.buffers.string_bytes.items, repository, patch_hash);
    }

    return "";
}

// TODO: normalize to alphanumeric
pub fn cachedNPMPackageFolderNamePrint(this: *const PackageManager, buf: []u8, name: string, version: Semver.Version, patch_hash: ?u64) stringZ {
    const scope = this.scopeForPackageName(name);

    if (scope.name.len == 0 and !this.options.did_override_default_scope) {
        const include_version_number = true;
        return cachedNPMPackageFolderPrintBasename(buf, name, version, patch_hash, include_version_number);
    }

    const include_version_number = false;
    const basename = cachedNPMPackageFolderPrintBasename(buf, name, version, null, include_version_number);

    const spanned = bun.span(basename);
    const available = buf[spanned.len..];
    var end: []u8 = undefined;
    if (scope.url.hostname.len > 32 or available.len < 64) {
        const visible_hostname = scope.url.hostname[0..@min(scope.url.hostname.len, 12)];
        end = std.fmt.bufPrint(available, "@@{s}__{f}{f}{f}", .{
            visible_hostname,
            bun.fmt.hexIntLower(String.Builder.stringHash(scope.url.href)),
            CacheVersion.Formatter{ .version_number = CacheVersion.current },
            PatchHashFmt{ .hash = patch_hash },
        }) catch unreachable;
    } else {
        end = std.fmt.bufPrint(available, "@@{s}{f}{f}", .{
            scope.url.hostname,
            CacheVersion.Formatter{ .version_number = CacheVersion.current },
            PatchHashFmt{ .hash = patch_hash },
        }) catch unreachable;
    }

    buf[spanned.len + end.len] = 0;
    const result: [:0]u8 = buf[0 .. spanned.len + end.len :0];
    return result;
}

fn cachedGitHubFolderNamePrintGuess(buf: []u8, string_buf: []const u8, repository: *const Repository, patch_hash: ?u64) stringZ {
    return std.fmt.bufPrintZ(
        buf,
        "@GH@{f}-{f}-{f}{f}{f}",
        .{
            repository.owner.fmt(string_buf),
            repository.repo.fmt(string_buf),
            repository.committish.fmt(string_buf),
            CacheVersion.Formatter{ .version_number = CacheVersion.current },
            PatchHashFmt{ .hash = patch_hash },
        },
    ) catch unreachable;
}
pub fn cachedNPMPackageFolderName(this: *const PackageManager, name: string, version: Semver.Version, patch_hash: ?u64) stringZ {
    return this.cachedNPMPackageFolderNamePrint(&PackageManager.cached_package_folder_name_buf, name, version, patch_hash);
}

// TODO: normalize to alphanumeric
pub fn cachedNPMPackageFolderPrintBasename(
    buf: []u8,
    name: string,
    version: Semver.Version,
    patch_hash: ?u64,
    include_cache_version: bool,
) stringZ {
    if (version.tag.hasPre()) {
        if (version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{f}+{f}{f}{f}",
                .{
                    name,
                    version.major,
                    version.minor,
                    version.patch,
                    bun.fmt.hexIntLower(version.tag.pre.hash),
                    bun.fmt.hexIntUpper(version.tag.build.hash),
                    CacheVersion.Formatter{ .version_number = if (include_cache_version) CacheVersion.current else null },
                    PatchHashFmt{ .hash = patch_hash },
                },
            ) catch unreachable;
        }
        return std.fmt.bufPrintZ(
            buf,
            "{s}@{d}.{d}.{d}-{f}{f}{f}",
            .{
                name,
                version.major,
                version.minor,
                version.patch,
                bun.fmt.hexIntLower(version.tag.pre.hash),
                CacheVersion.Formatter{ .version_number = if (include_cache_version) CacheVersion.current else null },
                PatchHashFmt{ .hash = patch_hash },
            },
        ) catch unreachable;
    }
    if (version.tag.hasBuild()) {
        return std.fmt.bufPrintZ(
            buf,
            "{s}@{d}.{d}.{d}+{f}{f}{f}",
            .{
                name,
                version.major,
                version.minor,
                version.patch,
                bun.fmt.hexIntUpper(version.tag.build.hash),
                CacheVersion.Formatter{ .version_number = if (include_cache_version) CacheVersion.current else null },
                PatchHashFmt{ .hash = patch_hash },
            },
        ) catch unreachable;
    }
    return std.fmt.bufPrintZ(buf, "{s}@{d}.{d}.{d}{f}{f}", .{
        name,
        version.major,
        version.minor,
        version.patch,
        CacheVersion.Formatter{ .version_number = if (include_cache_version) CacheVersion.current else null },
        PatchHashFmt{ .hash = patch_hash },
    }) catch unreachable;
}

pub fn cachedTarballFolderNamePrint(buf: []u8, url: string, patch_hash: ?u64) stringZ {
    return std.fmt.bufPrintZ(buf, "@T@{f}{f}{f}", .{
        bun.fmt.hexIntLower(String.Builder.stringHash(url)),
        CacheVersion.Formatter{ .version_number = CacheVersion.current },
        PatchHashFmt{ .hash = patch_hash },
    }) catch unreachable;
}

pub fn cachedTarballFolderName(this: *const PackageManager, url: String, patch_hash: ?u64) stringZ {
    return cachedTarballFolderNamePrint(&PackageManager.cached_package_folder_name_buf, this.lockfile.str(&url), patch_hash);
}

pub fn isFolderInCache(this: *PackageManager, folder_path: stringZ) bool {
    return bun.sys.directoryExistsAt(.fromStdDir(this.getCacheDirectory()), folder_path).unwrap() catch false;
}

pub fn setupGlobalDir(manager: *PackageManager, ctx: Command.Context) !void {
    manager.options.global_bin_dir = try Options.openGlobalBinDir(ctx.install);
    var out_buffer: bun.PathBuffer = undefined;
    const result = try bun.getFdPathZ(.fromStdDir(manager.options.global_bin_dir), &out_buffer);
    const path = try FileSystem.instance.dirname_store.append([:0]u8, result);
    manager.options.bin_path = path.ptr[0..path.len :0];
}

pub fn globalLinkDir(this: *PackageManager) std.fs.Dir {
    return this.global_link_dir orelse brk: {
        var global_dir = Options.openGlobalDir(this.options.explicit_global_directory) catch |err| switch (err) {
            error.@"No global directory found" => {
                Output.errGeneric("failed to find a global directory for package caching and global link directories", .{});
                Global.exit(1);
            },
            else => {
                Output.err(err, "failed to open the global directory", .{});
                Global.exit(1);
            },
        };
        this.global_dir = global_dir;
        this.global_link_dir = global_dir.makeOpenPath("node_modules", .{}) catch |err| {
            Output.err(err, "failed to open global link dir node_modules at '{f}'", .{FD.fromStdDir(global_dir)});
            Global.exit(1);
        };
        var buf: bun.PathBuffer = undefined;
        const _path = bun.getFdPath(.fromStdDir(this.global_link_dir.?), &buf) catch |err| {
            Output.err(err, "failed to get the full path of the global directory", .{});
            Global.exit(1);
        };
        this.global_link_dir_path = bun.handleOom(Fs.FileSystem.DirnameStore.instance.append([]const u8, _path));
        break :brk this.global_link_dir.?;
    };
}

pub fn globalLinkDirPath(this: *PackageManager) []const u8 {
    _ = this.globalLinkDir();
    return this.global_link_dir_path;
}

pub fn globalLinkDirAndPath(this: *PackageManager) struct { std.fs.Dir, []const u8 } {
    const dir = this.globalLinkDir();
    return .{ dir, this.global_link_dir_path };
}

pub fn pathForCachedNPMPath(
    this: *PackageManager,
    buf: *bun.PathBuffer,
    package_name: []const u8,
    version: Semver.Version,
) ![]u8 {
    var cache_path_buf: bun.PathBuffer = undefined;

    const cache_path = this.cachedNPMPackageFolderNamePrint(&cache_path_buf, package_name, version, null);

    if (comptime Environment.allow_assert) {
        bun.assertWithLocation(cache_path[package_name.len] == '@', @src());
    }

    cache_path_buf[package_name.len] = std.fs.path.sep;

    const cache_dir: bun.FD = .fromStdDir(this.getCacheDirectory());

    if (comptime Environment.isWindows) {
        var path_buf: bun.PathBuffer = undefined;
        const joined = bun.path.joinAbsStringBufZ(this.cache_directory_path, &path_buf, &[_]string{cache_path}, .windows);
        return bun.sys.readlink(joined, buf).unwrap() catch |err| {
            _ = bun.sys.unlink(joined);
            return err;
        };
    }

    return cache_dir.readlinkat(cache_path, buf).unwrap() catch |err| {
        // if we run into an error, delete the symlink
        // so that we don't repeatedly try to read it
        _ = cache_dir.unlinkat(cache_path);
        return err;
    };
}

pub fn pathForResolution(
    this: *PackageManager,
    package_id: PackageID,
    resolution: Resolution,
    buf: *bun.PathBuffer,
) ![]u8 {
    // const folder_name = this.cachedNPMPackageFolderName(name, version);
    switch (resolution.tag) {
        .npm => {
            const npm = resolution.value.npm;
            const package_name_ = this.lockfile.packages.items(.name)[package_id];
            const package_name = this.lockfile.str(&package_name_);

            return this.pathForCachedNPMPath(buf, package_name, npm.version);
        },
        else => return "",
    }
}

/// this is copy pasted from `installPackageWithNameAndResolution()`
/// it's not great to do this
pub fn computeCacheDirAndSubpath(
    manager: *PackageManager,
    pkg_name: string,
    resolution: *const Resolution,
    folder_path_buf: *bun.PathBuffer,
    patch_hash: ?u64,
) struct { cache_dir: std.fs.Dir, cache_dir_subpath: stringZ } {
    const name = pkg_name;
    const buf = manager.lockfile.buffers.string_bytes.items;
    var cache_dir = std.fs.cwd();
    var cache_dir_subpath: stringZ = "";

    switch (resolution.tag) {
        .npm => {
            cache_dir_subpath = manager.cachedNPMPackageFolderName(name, resolution.value.npm.version, patch_hash);
            cache_dir = manager.getCacheDirectory();
        },
        .git => {
            cache_dir_subpath = manager.cachedGitFolderName(
                &resolution.value.git,
                patch_hash,
            );
            cache_dir = manager.getCacheDirectory();
        },
        .github => {
            cache_dir_subpath = manager.cachedGitHubFolderName(&resolution.value.github, patch_hash);
            cache_dir = manager.getCacheDirectory();
        },
        .folder => {
            const folder = resolution.value.folder.slice(buf);
            // Handle when a package depends on itself via file:
            // example:
            //   "mineflayer": "file:."
            if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                cache_dir_subpath = ".";
            } else {
                @memcpy(folder_path_buf[0..folder.len], folder);
                folder_path_buf[folder.len] = 0;
                cache_dir_subpath = folder_path_buf[0..folder.len :0];
            }
            cache_dir = std.fs.cwd();
        },
        .local_tarball => {
            cache_dir_subpath = manager.cachedTarballFolderName(resolution.value.local_tarball, patch_hash);
            cache_dir = manager.getCacheDirectory();
        },
        .remote_tarball => {
            cache_dir_subpath = manager.cachedTarballFolderName(resolution.value.remote_tarball, patch_hash);
            cache_dir = manager.getCacheDirectory();
        },
        .workspace => {
            const folder = resolution.value.workspace.slice(buf);
            // Handle when a package depends on itself
            if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                cache_dir_subpath = ".";
            } else {
                @memcpy(folder_path_buf[0..folder.len], folder);
                folder_path_buf[folder.len] = 0;
                cache_dir_subpath = folder_path_buf[0..folder.len :0];
            }
            cache_dir = std.fs.cwd();
        },
        .symlink => {
            const directory = manager.globalLinkDir();

            const folder = resolution.value.symlink.slice(buf);

            if (folder.len == 0 or (folder.len == 1 and folder[0] == '.')) {
                cache_dir_subpath = ".";
                cache_dir = std.fs.cwd();
            } else {
                const global_link_dir = manager.globalLinkDirPath();
                var ptr = folder_path_buf;
                var remain: []u8 = folder_path_buf[0..];
                @memcpy(ptr[0..global_link_dir.len], global_link_dir);
                remain = remain[global_link_dir.len..];
                if (global_link_dir[global_link_dir.len - 1] != std.fs.path.sep) {
                    remain[0] = std.fs.path.sep;
                    remain = remain[1..];
                }
                @memcpy(remain[0..folder.len], folder);
                remain = remain[folder.len..];
                remain[0] = 0;
                const len = @intFromPtr(remain.ptr) - @intFromPtr(ptr);
                cache_dir_subpath = folder_path_buf[0..len :0];
                cache_dir = directory;
            }
        },
        else => {},
    }

    return .{
        .cache_dir = cache_dir,
        .cache_dir_subpath = cache_dir_subpath,
    };
}

pub fn attemptToCreatePackageJSONAndOpen() !std.fs.File {
    const package_json_file = std.fs.cwd().createFileZ("package.json", .{ .read = true }) catch |err| {
        Output.prettyErrorln("<r><red>error:<r> {s} create package.json", .{@errorName(err)});
        Global.crash();
    };

    try package_json_file.pwriteAll("{\"dependencies\": {}}", 0);

    return package_json_file;
}

pub fn attemptToCreatePackageJSON() !void {
    var file = try attemptToCreatePackageJSONAndOpen();
    file.close();
}

pub fn saveLockfile(
    this: *PackageManager,
    load_result: *const Lockfile.LoadResult,
    save_format: Lockfile.LoadResult.LockfileFormat,
    had_any_diffs: bool,
    // TODO(dylan-conway): this and `packages_len_before_install` can most likely be deleted
    // now that git dependnecies don't append to lockfile during installation.
    lockfile_before_install: *const Lockfile,
    packages_len_before_install: usize,
    log_level: Options.LogLevel,
) OOM!void {
    if (this.lockfile.isEmpty()) {
        if (!this.options.dry_run) delete: {
            const delete_format = switch (load_result.*) {
                .not_found => break :delete,
                .err => |err| err.format,
                .ok => |ok| ok.format,
            };

            bun.sys.unlinkat(
                FD.cwd(),
                if (delete_format == .text) comptime bun.OSPathLiteral("bun.lock") else comptime bun.OSPathLiteral("bun.lockb"),
            ).unwrap() catch |err| {
                // we don't care
                if (err == error.ENOENT) {
                    if (had_any_diffs) return;
                    break :delete;
                }

                if (log_level != .silent) {
                    Output.err(err, "failed to delete empty lockfile", .{});
                }
                return;
            };
        }
        if (!this.options.global) {
            if (log_level != .silent) {
                switch (this.subcommand) {
                    .remove => Output.prettyErrorln("\npackage.json has no dependencies! Deleted empty lockfile", .{}),
                    else => Output.prettyErrorln("No packages! Deleted empty lockfile", .{}),
                }
            }
        }

        return;
    }

    var save_node: *Progress.Node = undefined;

    if (log_level.showProgress()) {
        this.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
        save_node = this.progress.start(ProgressStrings.save(), 0);
        save_node.activate();

        this.progress.refresh();
    }

    this.lockfile.saveToDisk(load_result, &this.options);

    // delete binary lockfile if saving text lockfile
    if (save_format == .text and load_result.loadedFromBinaryLockfile()) {
        _ = bun.sys.unlinkat(FD.cwd(), comptime bun.OSPathLiteral("bun.lockb"));
    }

    if (comptime Environment.allow_assert) {
        if (load_result.* != .not_found) {
            if (load_result.loadedFromTextLockfile()) {
                if (!try this.lockfile.eql(lockfile_before_install, packages_len_before_install, this.allocator)) {
                    Output.panic("Lockfile non-deterministic after saving", .{});
                }
            } else {
                if (this.lockfile.hasMetaHashChanged(false, packages_len_before_install) catch false) {
                    Output.panic("Lockfile metahash non-deterministic after saving", .{});
                }
            }
        }
    }

    if (log_level.showProgress()) {
        save_node.end();
        this.progress.refresh();
        this.progress.root.end();
        this.progress = .{};
    } else if (log_level != .silent) {
        Output.prettyErrorln("Saved lockfile", .{});
        Output.flush();
    }
}

pub fn updateLockfileIfNeeded(
    manager: *PackageManager,
    load_result: Lockfile.LoadResult,
) !void {
    if (load_result == .ok and load_result.ok.serializer_result.packages_need_update) {
        const slice = manager.lockfile.packages.slice();
        for (slice.items(.meta)) |*meta| {
            // these are possibly updated later, but need to make sure non are zero
            meta.setHasInstallScript(false);
        }
    }

    return;
}

pub fn writeYarnLock(this: *PackageManager) !void {
    var printer = Lockfile.Printer{
        .lockfile = this.lockfile,
        .options = this.options,
    };

    var tmpname_buf: [512]u8 = undefined;
    tmpname_buf[0..8].* = "tmplock-".*;
    var tmpfile = FileSystem.RealFS.Tmpfile{};
    var secret: [32]u8 = undefined;
    std.mem.writeInt(u64, secret[0..8], @as(u64, @intCast(std.time.milliTimestamp())), .little);
    var base64_bytes: [64]u8 = undefined;
    std.crypto.random.bytes(&base64_bytes);

    const tmpname__ = std.fmt.bufPrint(tmpname_buf[8..], "{x}", .{&base64_bytes}) catch unreachable;
    tmpname_buf[tmpname__.len + 8] = 0;
    const tmpname = tmpname_buf[0 .. tmpname__.len + 8 :0];

    tmpfile.create(&FileSystem.instance.fs, tmpname) catch |err| {
        Output.prettyErrorln("<r><red>error:<r> failed to create tmpfile: {s}", .{@errorName(err)});
        Global.crash();
    };

    var file = tmpfile.file();
    var file_buffer: [4096]u8 = undefined;
    var file_writer = file.writerStreaming(&file_buffer);
    const writer = &file_writer.interface;
    try Lockfile.Printer.Yarn.print(&printer, @TypeOf(writer), writer);
    try writer.flush();

    if (comptime Environment.isPosix) {
        _ = bun.c.fchmod(
            tmpfile.fd.cast(),
            // chmod 666,
            0o0000040 | 0o0000004 | 0o0000002 | 0o0000400 | 0o0000200 | 0o0000020,
        );
    }

    try tmpfile.promoteToCWD(tmpname, "yarn.lock");
}

const CacheVersion = struct {
    pub const current = 1;
    pub const Formatter = struct {
        version_number: ?usize = null,

        pub fn format(this: *const @This(), writer: *std.Io.Writer) !void {
            if (this.version_number) |version| {
                try writer.print("@@@{d}", .{version});
            }
        }
    };
};

const PatchHashFmt = struct {
    hash: ?u64 = null,

    pub fn format(this: *const PatchHashFmt, writer: *std.Io.Writer) !void {
        if (this.hash) |h| {
            try writer.print("_patch_hash={x}", .{h});
        }
    }
};

var using_fallback_temp_dir: bool = false;

const string = []const u8;
const stringZ = [:0]const u8;

const std = @import("std");

const bun = @import("bun");
const DotEnv = bun.DotEnv;
const Environment = bun.Environment;
const FD = bun.FD;
const Global = bun.Global;
const OOM = bun.OOM;
const Output = bun.Output;
const Path = bun.path;
const Progress = bun.Progress;
const default_allocator = bun.default_allocator;
const Command = bun.cli.Command;
const File = bun.sys.File;

const Semver = bun.Semver;
const String = Semver.String;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const Lockfile = bun.install.Lockfile;
const PackageID = bun.install.PackageID;
const Repository = bun.install.Repository;
const Resolution = bun.install.Resolution;

const PackageManager = bun.install.PackageManager;
const Options = PackageManager.Options;
const ProgressStrings = PackageManager.ProgressStrings;
