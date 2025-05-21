const bun = @import("bun");
const default_allocator = bun.default_allocator;
const Global = bun.Global;
const json_parser = bun.JSON;
const logger = bun.logger;
const Output = bun.Output;
const FileSystem = @import("../fs.zig").FileSystem;
const Install = @import("./install.zig");
const DependencyID = Install.DependencyID;
const PackageManager = Install.PackageManager;
const Integrity = @import("./integrity.zig").Integrity;
const Npm = @import("./npm.zig");
const Resolution = @import("./resolution.zig").Resolution;
const Semver = bun.Semver;
const std = @import("std");
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const Path = @import("../resolver/resolve_path.zig");
const Environment = bun.Environment;
const w = std.os.windows;
const OOM = bun.OOM;

const ExtractTarball = @This();

name: strings.StringOrTinyString,
resolution: Resolution,
cache_dir: std.fs.Dir,
temp_dir: std.fs.Dir,
dependency_id: DependencyID,
skip_verify: bool = false,
integrity: Integrity = .{},
url: strings.StringOrTinyString,
package_manager: *PackageManager,

pub inline fn run(this: *const ExtractTarball, log: *logger.Log, bytes: []const u8) !Install.ExtractData {
    if (!this.skip_verify and this.integrity.tag.isSupported()) {
        if (!this.integrity.verify(bytes)) {
            log.addErrorFmt(
                null,
                logger.Loc.Empty,
                bun.default_allocator,
                "Integrity check failed<r> for tarball: {s}",
                .{this.name.slice()},
            ) catch unreachable;
            return error.IntegrityCheckFailed;
        }
    }
    return this.extract(log, bytes);
}

pub fn buildURL(
    registry_: string,
    full_name_: strings.StringOrTinyString,
    version: Semver.Version,
    string_buf: []const u8,
) OOM!string {
    return buildURLWithPrinter(
        registry_,
        full_name_,
        version,
        string_buf,
        @TypeOf(FileSystem.instance.dirname_store),
        string,
        OOM,
        FileSystem.instance.dirname_store,
        FileSystem.DirnameStore.print,
    );
}

pub fn buildURLWithPrinter(
    registry_: string,
    full_name_: strings.StringOrTinyString,
    version: Semver.Version,
    string_buf: []const u8,
    comptime PrinterContext: type,
    comptime ReturnType: type,
    comptime ErrorType: type,
    printer: PrinterContext,
    comptime print: fn (ctx: PrinterContext, comptime str: string, args: anytype) ErrorType!ReturnType,
) ErrorType!ReturnType {
    const registry = std.mem.trimRight(u8, registry_, "/");
    const full_name = full_name_.slice();

    var name = full_name;
    if (name[0] == '@') {
        if (strings.indexOfChar(name, '/')) |i| {
            name = name[i + 1 ..];
        }
    }

    const default_format = "{s}/{s}/-/";

    if (!version.tag.hasPre() and !version.tag.hasBuild()) {
        const args = .{ registry, full_name, name, version.major, version.minor, version.patch };
        return try print(
            printer,
            default_format ++ "{s}-{d}.{d}.{d}.tgz",
            args,
        );
    } else if (version.tag.hasPre() and version.tag.hasBuild()) {
        const args = .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.pre.slice(string_buf), version.tag.build.slice(string_buf) };
        return try print(
            printer,
            default_format ++ "{s}-{d}.{d}.{d}-{s}+{s}.tgz",
            args,
        );
    } else if (version.tag.hasPre()) {
        const args = .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.pre.slice(string_buf) };
        return try print(
            printer,
            default_format ++ "{s}-{d}.{d}.{d}-{s}.tgz",
            args,
        );
    } else if (version.tag.hasBuild()) {
        const args = .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.build.slice(string_buf) };
        return try print(
            printer,
            default_format ++ "{s}-{d}.{d}.{d}+{s}.tgz",
            args,
        );
    } else {
        unreachable;
    }
}

threadlocal var final_path_buf: bun.PathBuffer = undefined;
threadlocal var folder_name_buf: bun.PathBuffer = undefined;
threadlocal var json_path_buf: bun.PathBuffer = undefined;

fn extract(this: *const ExtractTarball, log: *logger.Log, tgz_bytes: []const u8) !Install.ExtractData {
    const tracer = bun.perf.trace("ExtractTarball.extract");
    defer tracer.end();

    const tmpdir = this.temp_dir;
    var tmpname_buf: if (Environment.isWindows) bun.WPathBuffer else bun.PathBuffer = undefined;
    const name = if (this.name.slice().len > 0) this.name.slice() else brk: {
        // Not sure where this case hits yet.
        // BUN-2WQ
        Output.warn("Extracting nameless packages is not supported yet. Please open an issue on GitHub with reproduction steps.", .{});
        bun.debugAssert(false);
        break :brk "unnamed-package";
    };
    const basename = brk: {
        var tmp = name;
        if (tmp[0] == '@') {
            if (strings.indexOfChar(tmp, '/')) |i| {
                tmp = tmp[i + 1 ..];
            }
        }

        if (comptime Environment.isWindows) {
            if (strings.lastIndexOfChar(tmp, ':')) |i| {
                tmp = tmp[i + 1 ..];
            }
        }

        break :brk tmp;
    };

    var resolved: string = "";
    const tmpname = try FileSystem.instance.tmpname(basename[0..@min(basename.len, 32)], std.mem.asBytes(&tmpname_buf), bun.fastRandom());
    {
        var extract_destination = bun.MakePath.makeOpenPath(tmpdir, bun.span(tmpname), .{}) catch |err| {
            log.addErrorFmt(
                null,
                logger.Loc.Empty,
                bun.default_allocator,
                "{s} when create temporary directory named \"{s}\" (while extracting \"{s}\")",
                .{ @errorName(err), tmpname, name },
            ) catch unreachable;
            return error.InstallFailed;
        };

        defer extract_destination.close();

        const Archiver = bun.libarchive.Archiver;
        const Zlib = @import("../zlib.zig");
        var zlib_pool = Npm.Registry.BodyPool.get(default_allocator);
        zlib_pool.data.reset();
        defer Npm.Registry.BodyPool.release(zlib_pool);

        var esimated_output_size: usize = 0;

        const time_started_for_verbose_logs: u64 = if (PackageManager.verbose_install) bun.getRoughTickCount().ns() else 0;

        {
            // Last 4 bytes of a gzip-compressed file are the uncompressed size.
            if (tgz_bytes.len > 16) {
                // If the file claims to be larger than 16 bytes and smaller than 64 MB, we'll preallocate the buffer.
                // If it's larger than that, we'll do it incrementally. We want to avoid OOMing.
                const last_4_bytes: u32 = @bitCast(tgz_bytes[tgz_bytes.len - 4 ..][0..4].*);
                if (last_4_bytes > 16 and last_4_bytes < 64 * 1024 * 1024) {
                    // It's okay if this fails. We will just allocate as we go and that will error if we run out of memory.
                    esimated_output_size = last_4_bytes;
                    if (zlib_pool.data.list.capacity == 0) {
                        zlib_pool.data.list.ensureTotalCapacityPrecise(zlib_pool.data.allocator, last_4_bytes) catch {};
                    } else {
                        zlib_pool.data.ensureUnusedCapacity(last_4_bytes) catch {};
                    }
                }
            }
        }

        var needs_to_decompress = true;
        if (bun.FeatureFlags.isLibdeflateEnabled() and zlib_pool.data.list.capacity > 16 and esimated_output_size > 0) use_libdeflate: {
            const decompressor = bun.libdeflate.Decompressor.alloc() orelse break :use_libdeflate;
            defer decompressor.deinit();

            const result = decompressor.gzip(tgz_bytes, zlib_pool.data.list.allocatedSlice());

            if (result.status == .success) {
                zlib_pool.data.list.items.len = result.written;
                needs_to_decompress = false;
            }

            // If libdeflate fails for any reason, fallback to zlib.
        }

        if (needs_to_decompress) {
            zlib_pool.data.list.clearRetainingCapacity();
            var zlib_entry = try Zlib.ZlibReaderArrayList.init(tgz_bytes, &zlib_pool.data.list, default_allocator);
            zlib_entry.readAll() catch |err| {
                log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    bun.default_allocator,
                    "{s} decompressing \"{s}\" to \"{}\"",
                    .{ @errorName(err), name, bun.fmt.fmtPath(u8, std.mem.span(tmpname), .{}) },
                ) catch unreachable;
                return error.InstallFailed;
            };
        }

        if (PackageManager.verbose_install) {
            const decompressing_ended_at: u64 = bun.getRoughTickCount().ns();
            const elapsed = decompressing_ended_at - time_started_for_verbose_logs;
            Output.prettyErrorln("[{s}] Extract {s}<r> (decompressed {} tgz file in {})", .{ name, tmpname, bun.fmt.size(tgz_bytes.len, .{}), std.fmt.fmtDuration(elapsed) });
        }

        switch (this.resolution.tag) {
            .github => {
                const DirnameReader = struct {
                    needs_first_dirname: bool = true,
                    outdirname: *[]const u8,
                    pub fn onFirstDirectoryName(dirname_reader: *@This(), first_dirname: []const u8) void {
                        bun.assert(dirname_reader.needs_first_dirname);
                        dirname_reader.needs_first_dirname = false;
                        dirname_reader.outdirname.* = FileSystem.DirnameStore.instance.append([]const u8, first_dirname) catch unreachable;
                    }
                };
                var dirname_reader = DirnameReader{ .outdirname = &resolved };

                switch (PackageManager.verbose_install) {
                    inline else => |verbose_log| _ = try Archiver.extractToDir(
                        zlib_pool.data.list.items,
                        extract_destination,
                        null,
                        *DirnameReader,
                        &dirname_reader,
                        .{
                            // for GitHub tarballs, the root dir is always <user>-<repo>-<commit_id>
                            .depth_to_skip = 1,
                            .log = verbose_log,
                        },
                    ),
                }

                // This tag is used to know which version of the package was
                // installed from GitHub. package.json version becomes sort of
                // meaningless in cases like this.
                if (resolved.len > 0) insert_tag: {
                    const gh_tag = extract_destination.createFileZ(".bun-tag", .{ .truncate = true }) catch break :insert_tag;
                    defer gh_tag.close();
                    gh_tag.writeAll(resolved) catch {
                        extract_destination.deleteFileZ(".bun-tag") catch {};
                    };
                }
            },
            else => switch (PackageManager.verbose_install) {
                inline else => |verbose_log| _ = try Archiver.extractToDir(
                    zlib_pool.data.list.items,
                    extract_destination,
                    null,
                    void,
                    {},
                    .{
                        .log = verbose_log,
                        // packages usually have root directory `package/`, and scoped packages usually have root `<scopename>/`
                        // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L442
                        .depth_to_skip = 1,
                        .npm = true,
                    },
                ),
            },
        }

        if (PackageManager.verbose_install) {
            const elapsed = bun.getRoughTickCount().ns() - time_started_for_verbose_logs;
            Output.prettyErrorln("[{s}] Extracted to {s} ({})<r>", .{ name, tmpname, std.fmt.fmtDuration(elapsed) });
            Output.flush();
        }
    }
    const folder_name = switch (this.resolution.tag) {
        .npm => this.package_manager.cachedNPMPackageFolderNamePrint(&folder_name_buf, name, this.resolution.value.npm.version, null),
        .github => PackageManager.cachedGitHubFolderNamePrint(&folder_name_buf, resolved, null),
        .local_tarball, .remote_tarball => PackageManager.cachedTarballFolderNamePrint(&folder_name_buf, this.url.slice(), null),
        else => unreachable,
    };
    if (folder_name.len == 0 or (folder_name.len == 1 and folder_name[0] == '/')) @panic("Tried to delete root and stopped it");
    const cache_dir = this.cache_dir;

    // e.g. @next
    // if it's a namespace package, we need to make sure the @name folder exists
    const create_subdir = basename.len != name.len and !this.resolution.tag.isGit();

    // Now that we've extracted the archive, we rename.
    if (comptime Environment.isWindows) {
        var did_retry = false;
        var path2_buf: bun.WPathBuffer = undefined;
        const path2 = bun.strings.toWPathNormalized(&path2_buf, folder_name);
        if (create_subdir) {
            if (bun.Dirname.dirname(u16, path2)) |folder| {
                _ = bun.MakePath.makePath(u16, cache_dir, folder) catch {};
            }
        }

        const path_to_use = path2;

        while (true) {
            const dir_to_move = bun.sys.openDirAtWindowsA(.fromStdDir(this.temp_dir), bun.span(tmpname), .{
                .can_rename_or_delete = true,
                .create = false,
                .iterable = false,
                .read_only = true,
            }).unwrap() catch |err| {
                // i guess we just
                log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    bun.default_allocator,
                    "moving \"{s}\" to cache dir failed\n{}\n From: {s}\n   To: {s}",
                    .{ name, err, tmpname, folder_name },
                ) catch unreachable;
                return error.InstallFailed;
            };

            switch (bun.windows.moveOpenedFileAt(dir_to_move, .fromStdDir(cache_dir), path_to_use, true)) {
                .err => |err| {
                    if (!did_retry) {
                        switch (err.getErrno()) {
                            .NOTEMPTY, .PERM, .BUSY, .EXIST => {

                                // before we attempt to delete the destination, let's close the source dir.
                                dir_to_move.close();

                                // We tried to move the folder over
                                // but it didn't work!
                                // so instead of just simply deleting the folder
                                // we rename it back into the temp dir
                                // and then delete that temp dir
                                // The goal is to make it more difficult for an application to reach this folder
                                var tmpname_bytes = std.mem.asBytes(&tmpname_buf);
                                const tmpname_len = std.mem.sliceTo(tmpname, 0).len;

                                tmpname_bytes[tmpname_len..][0..4].* = .{ 't', 'm', 'p', 0 };
                                const tempdest = tmpname_bytes[0 .. tmpname_len + 3 :0];
                                switch (bun.sys.renameat(
                                    .fromStdDir(cache_dir),
                                    folder_name,
                                    .fromStdDir(tmpdir),
                                    tempdest,
                                )) {
                                    .err => {},
                                    .result => {
                                        tmpdir.deleteTree(tempdest) catch {};
                                    },
                                }
                                tmpname_bytes[tmpname_len] = 0;
                                did_retry = true;
                                continue;
                            },
                            else => {},
                        }
                    }
                    dir_to_move.close();
                    log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        bun.default_allocator,
                        "moving \"{s}\" to cache dir failed\n{}\n  From: {s}\n    To: {s}",
                        .{ name, err, tmpname, folder_name },
                    ) catch unreachable;
                    return error.InstallFailed;
                },
                .result => {
                    dir_to_move.close();
                },
            }

            break;
        }
    } else {
        // Attempt to gracefully handle duplicate concurrent `bun install` calls
        //
        // By:
        // 1. Rename from temporary directory to cache directory and fail if it already exists
        // 2a. If the rename fails, swap the cache directory with the temporary directory version
        // 2b. Delete the temporary directory version ONLY if we're not using a provided temporary directory
        // 3. If rename still fails, fallback to racily deleting the cache directory version and then renaming the temporary directory version again.
        //
        const src = bun.sliceTo(tmpname, 0);

        if (create_subdir) {
            if (bun.Dirname.dirname(u8, folder_name)) |folder| {
                bun.MakePath.makePath(u8, cache_dir, folder) catch {};
            }
        }

        if (bun.sys.renameatConcurrently(
            .fromStdDir(tmpdir),
            src,
            .fromStdDir(cache_dir),
            folder_name,
            .{ .move_fallback = true },
        ).asErr()) |err| {
            log.addErrorFmt(
                null,
                logger.Loc.Empty,
                bun.default_allocator,
                "moving \"{s}\" to cache dir failed: {}\n  From: {s}\n    To: {s}",
                .{ name, err, tmpname, folder_name },
            ) catch unreachable;
            return error.InstallFailed;
        }
    }

    // We return a resolved absolute absolute file path to the cache dir.
    // To get that directory, we open the directory again.
    var final_dir = bun.openDir(cache_dir, folder_name) catch |err| {
        log.addErrorFmt(
            null,
            logger.Loc.Empty,
            bun.default_allocator,
            "failed to verify cache dir for \"{s}\": {s}",
            .{ name, @errorName(err) },
        ) catch unreachable;
        return error.InstallFailed;
    };
    defer final_dir.close();
    // and get the fd path
    const final_path = bun.getFdPathZ(
        .fromStdDir(final_dir),
        &final_path_buf,
    ) catch |err| {
        log.addErrorFmt(
            null,
            logger.Loc.Empty,
            bun.default_allocator,
            "failed to resolve cache dir for \"{s}\": {s}",
            .{ name, @errorName(err) },
        ) catch unreachable;
        return error.InstallFailed;
    };

    const url = try FileSystem.instance.dirname_store.append(@TypeOf(this.url.slice()), this.url.slice());

    var json_path: []u8 = "";
    var json_buf: []u8 = "";
    if (switch (this.resolution.tag) {
        // TODO remove extracted files not matching any globs under "files"
        .github, .local_tarball, .remote_tarball => true,
        else => this.package_manager.lockfile.trusted_dependencies != null and
            this.package_manager.lockfile.trusted_dependencies.?.contains(@truncate(Semver.String.Builder.stringHash(name))),
    }) {
        const json_file, json_buf = bun.sys.File.readFileFrom(
            bun.FD.fromStdDir(cache_dir),
            bun.path.joinZBuf(&json_path_buf, &[_]string{ folder_name, "package.json" }, .auto),
            bun.default_allocator,
        ).unwrap() catch |err| {
            if (this.resolution.tag == .github and err == error.ENOENT) {
                // allow git dependencies without package.json
                return .{
                    .url = url,
                    .resolved = resolved,
                };
            }

            log.addErrorFmt(
                null,
                logger.Loc.Empty,
                bun.default_allocator,
                "\"package.json\" for \"{s}\" failed to open: {s}",
                .{ name, @errorName(err) },
            ) catch unreachable;
            return error.InstallFailed;
        };
        defer json_file.close();
        json_path = json_file.getPath(
            &json_path_buf,
        ).unwrap() catch |err| {
            log.addErrorFmt(
                null,
                logger.Loc.Empty,
                bun.default_allocator,
                "\"package.json\" for \"{s}\" failed to resolve: {s}",
                .{ name, @errorName(err) },
            ) catch unreachable;
            return error.InstallFailed;
        };
    }

    if (!bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_DISABLE_INSTALL_INDEX")) {
        // create an index storing each version of a package installed
        if (strings.indexOfChar(basename, '/') == null) create_index: {
            const dest_name = switch (this.resolution.tag) {
                .github => folder_name["@GH@".len..],
                // trim "name@" from the prefix
                .npm => folder_name[name.len + 1 ..],
                else => folder_name,
            };

            if (comptime Environment.isWindows) {
                bun.MakePath.makePath(u8, cache_dir, name) catch {
                    break :create_index;
                };

                var dest_buf: bun.PathBuffer = undefined;
                const dest_path = bun.path.joinAbsStringBufZ(
                    // only set once, should be fine to read not on main thread
                    this.package_manager.cache_directory_path,
                    &dest_buf,
                    &[_]string{ name, dest_name },
                    .windows,
                );

                bun.sys.sys_uv.symlinkUV(final_path, dest_path, bun.windows.libuv.UV_FS_SYMLINK_JUNCTION).unwrap() catch {
                    break :create_index;
                };
            } else {
                var index_dir = bun.FD.fromStdDir(bun.MakePath.makeOpenPath(cache_dir, name, .{}) catch break :create_index);
                defer index_dir.close();

                bun.sys.symlinkat(final_path, index_dir, dest_name).unwrap() catch break :create_index;
            }
        }
    }

    const ret_json_path = try FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path);

    return .{
        .url = url,
        .resolved = resolved,
        .json = .{
            .path = ret_json_path,
            .buf = json_buf,
        },
    };
}
