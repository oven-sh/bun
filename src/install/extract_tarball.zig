const bun = @import("root").bun;
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
const Semver = @import("./semver.zig");
const std = @import("std");
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const Path = @import("../resolver/resolve_path.zig");
const Environment = bun.Environment;
const w = std.os.windows;

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

pub inline fn run(this: *const ExtractTarball, bytes: []const u8) !Install.ExtractData {
    if (!this.skip_verify and this.integrity.tag.isSupported()) {
        if (!this.integrity.verify(bytes)) {
            this.package_manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                this.package_manager.allocator,
                "Integrity check failed<r> for tarball: {s}",
                .{this.name.slice()},
            ) catch unreachable;
            return error.IntegrityCheckFailed;
        }
    }
    return this.extract(bytes);
}

pub fn buildURL(
    registry_: string,
    full_name_: strings.StringOrTinyString,
    version: Semver.Version,
    string_buf: []const u8,
) !string {
    return try buildURLWithPrinter(
        registry_,
        full_name_,
        version,
        string_buf,
        @TypeOf(FileSystem.instance.dirname_store),
        string,
        anyerror,
        FileSystem.instance.dirname_store,
        FileSystem.DirnameStore.print,
    );
}

pub fn buildURLWithWriter(
    comptime Writer: type,
    writer: Writer,
    registry_: string,
    full_name_: strings.StringOrTinyString,
    version: Semver.Version,
    string_buf: []const u8,
) !void {
    const Printer = struct {
        writer: Writer,

        pub fn print(this: @This(), comptime fmt: string, args: anytype) Writer.Error!void {
            return try std.fmt.format(this.writer, fmt, args);
        }
    };

    return try buildURLWithPrinter(
        registry_,
        full_name_,
        version,
        string_buf,
        Printer,
        void,
        Writer.Error,
        Printer{
            .writer = writer,
        },
        Printer.print,
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

fn extract(this: *const ExtractTarball, tgz_bytes: []const u8) !Install.ExtractData {
    const tmpdir = this.temp_dir;
    var tmpname_buf: if (Environment.isWindows) bun.WPathBuffer else bun.PathBuffer = undefined;
    const name = this.name.slice();
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

        if (comptime Environment.allow_assert) {
            bun.assert(tmp.len > 0);
        }

        break :brk tmp;
    };

    var resolved: string = "";
    const tmpname = try FileSystem.instance.tmpname(basename[0..@min(basename.len, 32)], std.mem.asBytes(&tmpname_buf), bun.fastRandom());
    {
        var extract_destination = bun.MakePath.makeOpenPath(tmpdir, bun.span(tmpname), .{}) catch |err| {
            this.package_manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                this.package_manager.allocator,
                "{s} when create temporary directory named \"{s}\" (while extracting \"{s}\")",
                .{ @errorName(err), tmpname, name },
            ) catch unreachable;
            return error.InstallFailed;
        };

        defer extract_destination.close();

        if (PackageManager.verbose_install) {
            Output.prettyErrorln("[{s}] Start extracting {s}<r>", .{ name, tmpname });
            Output.flush();
        }

        const Archive = @import("../libarchive/libarchive.zig").Archive;
        const Zlib = @import("../zlib.zig");
        var zlib_pool = Npm.Registry.BodyPool.get(default_allocator);
        zlib_pool.data.reset();
        defer Npm.Registry.BodyPool.release(zlib_pool);

        var zlib_entry = try Zlib.ZlibReaderArrayList.init(tgz_bytes, &zlib_pool.data.list, default_allocator);
        zlib_entry.readAll() catch |err| {
            this.package_manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                this.package_manager.allocator,
                "{s} decompressing \"{s}\" to \"{}\"",
                .{ @errorName(err), name, bun.fmt.fmtPath(u8, std.mem.span(tmpname), .{}) },
            ) catch unreachable;
            return error.InstallFailed;
        };
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
                    inline else => |log| _ = try Archive.extractToDir(
                        zlib_pool.data.list.items,
                        extract_destination,
                        null,
                        *DirnameReader,
                        &dirname_reader,
                        .{
                            // for GitHub tarballs, the root dir is always <user>-<repo>-<commit_id>
                            .depth_to_skip = 1,
                            .log = log,
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
                inline else => |log| _ = try Archive.extractToDir(
                    zlib_pool.data.list.items,
                    extract_destination,
                    null,
                    void,
                    {},
                    .{
                        .log = log,
                        // packages usually have root directory `package/`, and scoped packages usually have root `<scopename>/`
                        // https://github.com/npm/cli/blob/93883bb6459208a916584cad8c6c72a315cf32af/node_modules/pacote/lib/fetcher.js#L442
                        .depth_to_skip = 1,
                        .npm = true,
                    },
                ),
            },
        }

        if (PackageManager.verbose_install) {
            Output.prettyErrorln("[{s}] Extracted<r>", .{name});
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
            const dir_to_move = bun.sys.openDirAtWindowsA(bun.toFD(this.temp_dir.fd), bun.span(tmpname), .{
                .can_rename_or_delete = true,
                .create = false,
                .iterable = false,
                .read_only = true,
            }).unwrap() catch |err| {
                // i guess we just
                this.package_manager.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    this.package_manager.allocator,
                    "moving \"{s}\" to cache dir failed\n{}\n From: {s}\n   To: {s}",
                    .{ name, err, tmpname, folder_name },
                ) catch unreachable;
                return error.InstallFailed;
            };

            switch (bun.C.moveOpenedFileAt(dir_to_move, bun.toFD(cache_dir.fd), path_to_use, true)) {
                .err => |err| {
                    if (!did_retry) {
                        switch (err.getErrno()) {
                            .NOTEMPTY, .PERM, .BUSY, .EXIST => {

                                // before we attempt to delete the destination, let's close the source dir.
                                _ = bun.sys.close(dir_to_move);

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
                                    bun.toFD(cache_dir.fd),
                                    folder_name,
                                    bun.toFD(tmpdir.fd),
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
                    _ = bun.sys.close(dir_to_move);
                    this.package_manager.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        this.package_manager.allocator,
                        "moving \"{s}\" to cache dir failed\n{}\n  From: {s}\n    To: {s}",
                        .{ name, err, tmpname, folder_name },
                    ) catch unreachable;
                    return error.InstallFailed;
                },
                .result => {
                    _ = bun.sys.close(dir_to_move);
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
            bun.toFD(tmpdir.fd),
            src,
            bun.toFD(cache_dir.fd),
            folder_name,
            .{ .move_fallback = true },
        ).asErr()) |err| {
            this.package_manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                this.package_manager.allocator,
                "moving \"{s}\" to cache dir failed: {}\n  From: {s}\n    To: {s}",
                .{ name, err, tmpname, folder_name },
            ) catch unreachable;
            return error.InstallFailed;
        }
    }

    // We return a resolved absolute absolute file path to the cache dir.
    // To get that directory, we open the directory again.
    var final_dir = bun.openDir(cache_dir, folder_name) catch |err| {
        this.package_manager.log.addErrorFmt(
            null,
            logger.Loc.Empty,
            this.package_manager.allocator,
            "failed to verify cache dir for \"{s}\": {s}",
            .{ name, @errorName(err) },
        ) catch unreachable;
        return error.InstallFailed;
    };
    defer final_dir.close();
    // and get the fd path
    const final_path = bun.getFdPath(
        final_dir.fd,
        &final_path_buf,
    ) catch |err| {
        this.package_manager.log.addErrorFmt(
            null,
            logger.Loc.Empty,
            this.package_manager.allocator,
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
            bun.toFD(cache_dir.fd),
            bun.path.joinZ(&[_]string{ folder_name, "package.json" }, .auto),
            bun.default_allocator,
        ).unwrap() catch |err| {
            if (this.resolution.tag == .github and err == error.ENOENT) {
                // allow git dependencies without package.json
                return .{
                    .url = url,
                    .resolved = resolved,
                };
            }

            this.package_manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                this.package_manager.allocator,
                "\"package.json\" for \"{s}\" failed to open: {s}",
                .{ name, @errorName(err) },
            ) catch unreachable;
            return error.InstallFailed;
        };
        defer json_file.close();
        json_path = json_file.getPath(
            &json_path_buf,
        ).unwrap() catch |err| {
            this.package_manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                this.package_manager.allocator,
                "\"package.json\" for \"{s}\" failed to resolve: {s}",
                .{ name, @errorName(err) },
            ) catch unreachable;
            return error.InstallFailed;
        };
    }

    // create an index storing each version of a package installed
    if (strings.indexOfChar(basename, '/') == null) create_index: {
        var index_dir = bun.MakePath.makeOpenPath(cache_dir, name, .{}) catch break :create_index;
        defer index_dir.close();
        index_dir.symLink(
            final_path,
            switch (this.resolution.tag) {
                .github => folder_name["@GH@".len..],
                // trim "name@" from the prefix
                .npm => folder_name[name.len + 1 ..],
                else => folder_name,
            },
            .{ .is_directory = true },
        ) catch break :create_index;
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
