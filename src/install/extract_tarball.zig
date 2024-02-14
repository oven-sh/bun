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

pub inline fn run(this: ExtractTarball, bytes: []const u8) !Install.ExtractData {
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
    var tmpname_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
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
            std.debug.assert(tmp.len > 0);
        }

        break :brk tmp;
    };

    var resolved: string = "";
    const tmpname = try FileSystem.instance.tmpname(basename[0..@min(basename.len, 32)], &tmpname_buf, tgz_bytes.len);
    const extract_fd_on_windows = brk: {
        var extract_destination = switch (Environment.os) {
            .windows => makeOpenPathAccessMaskW(
                tmpdir,
                std.mem.span(tmpname),
                w.STANDARD_RIGHTS_READ |
                    w.FILE_READ_ATTRIBUTES |
                    w.FILE_READ_EA |
                    w.SYNCHRONIZE |
                    w.FILE_TRAVERSE |
                    w.DELETE,
                false,
            ),
            else => tmpdir.makeOpenPath(std.mem.span(tmpname), .{}),
        } catch |err| {
            this.package_manager.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                this.package_manager.allocator,
                "{s} when create temporary directory named \"{s}\" (while extracting \"{s}\")",
                .{ @errorName(err), tmpname, name },
            ) catch unreachable;
            return error.InstallFailed;
        };

        errdefer if (Environment.isWindows) extract_destination.close();
        defer if (!Environment.isWindows) extract_destination.close();

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
                "{s} decompressing \"{s}\"",
                .{ @errorName(err), name },
            ) catch unreachable;
            return error.InstallFailed;
        };
        switch (this.resolution.tag) {
            .github => {
                const DirnameReader = struct {
                    needs_first_dirname: bool = true,
                    outdirname: *[]const u8,
                    pub fn onFirstDirectoryName(dirname_reader: *@This(), first_dirname: []const u8) void {
                        std.debug.assert(dirname_reader.needs_first_dirname);
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
                        // for GitHub tarballs, the root dir is always <user>-<repo>-<commit_id>
                        1,
                        true,
                        log,
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
                    // for npm packages, the root dir is always "package"
                    1,
                    true,
                    log,
                ),
            },
        }

        if (PackageManager.verbose_install) {
            Output.prettyErrorln("[{s}] Extracted<r>", .{name});
            Output.flush();
        }

        if (Environment.isWindows) {
            break :brk bun.toFD(extract_destination.fd);
        }
    };
    const folder_name = switch (this.resolution.tag) {
        .npm => this.package_manager.cachedNPMPackageFolderNamePrint(&folder_name_buf, name, this.resolution.value.npm.version),
        .github => PackageManager.cachedGitHubFolderNamePrint(&folder_name_buf, resolved),
        .local_tarball, .remote_tarball => PackageManager.cachedTarballFolderNamePrint(&folder_name_buf, this.url.slice()),
        else => unreachable,
    };
    if (folder_name.len == 0 or (folder_name.len == 1 and folder_name[0] == '/')) @panic("Tried to delete root and stopped it");
    var cache_dir = this.cache_dir;
    cache_dir.deleteTree(folder_name) catch {};

    // e.g. @next
    // if it's a namespace package, we need to make sure the @name folder exists
    if (basename.len != name.len and !this.resolution.tag.isGit()) {
        cache_dir.makeDir(std.mem.trim(u8, name[0 .. name.len - basename.len], "/")) catch {};
    }

    // Now that we've extracted the archive, we rename.
    if (comptime Environment.isWindows) {
        defer _ = bun.sys.close(extract_fd_on_windows);

        var folder_name_wbuf: bun.WPathBuffer = undefined;
        const folder_name_w = bun.strings.toWPathNormalized(&folder_name_wbuf, folder_name);

        switch (bun.C.moveOpenedFileAtLoose(extract_fd_on_windows, bun.toFD(cache_dir.fd), folder_name_w, false)) {
            .err => |err| {
                this.package_manager.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    this.package_manager.allocator,
                    "moving \"{s}\" to cache dir failed: {}\n  From: {s}\n    To: {}",
                    .{ name, err, tmpname, std.unicode.fmtUtf16le(folder_name_w) },
                ) catch unreachable;
                return error.InstallFailed;
            },
            .result => {},
        }
    } else {
        switch (bun.sys.renameat(bun.toFD(tmpdir.fd), bun.sliceTo(tmpname, 0), bun.toFD(cache_dir.fd), folder_name)) {
            .err => |err| {
                this.package_manager.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    this.package_manager.allocator,
                    "moving \"{s}\" to cache dir failed: {}\n  From: {s}\n    To: {s}",
                    .{ name, err, tmpname, folder_name },
                ) catch unreachable;
                return error.InstallFailed;
            },
            .result => {},
        }
    }

    // We return a resolved absolute absolute file path to the cache dir.
    // To get that directory, we open the directory again.
    var final_dir = cache_dir.openDirZ(folder_name, .{}) catch |err| {
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

    // create an index storing each version of a package installed
    if (strings.indexOfChar(basename, '/') == null) create_index: {
        var index_dir = cache_dir.makeOpenPath(name, .{}) catch break :create_index;
        defer index_dir.close();
        index_dir.symLink(
            final_path,
            switch (this.resolution.tag) {
                .github => folder_name["@GH@".len..],
                // trim "name@" from the prefix
                .npm => folder_name[name.len + 1 ..],
                else => folder_name,
            },
            .{},
        ) catch break :create_index;
    }

    var json_path: []u8 = "";
    var json_buf: []u8 = "";
    var json_len: usize = 0;
    if (switch (this.resolution.tag) {
        // TODO remove extracted files not matching any globs under "files"
        .github, .local_tarball, .remote_tarball => true,
        else => this.package_manager.lockfile.trusted_dependencies.contains(@as(u32, @truncate(Semver.String.Builder.stringHash(name)))),
    }) {
        const json_file = final_dir.openFileZ("package.json", .{ .mode = .read_only }) catch |err| {
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
        const json_stat_size = try json_file.getEndPos();
        json_buf = try this.package_manager.allocator.alloc(u8, json_stat_size + 64);
        json_len = try json_file.preadAll(json_buf, 0);

        json_path = bun.getFdPath(
            json_file.handle,
            &json_path_buf,
        ) catch |err| {
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

    const ret_json_path = try FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path);
    const url = try FileSystem.instance.dirname_store.append(@TypeOf(this.url.slice()), this.url.slice());

    return .{
        .url = url,
        .resolved = resolved,
        .json_path = ret_json_path,
        .json_buf = json_buf,
        .json_len = json_len,
    };
}

// TODO(@paperdave): upstream making this public into zig std
// there is zero reason this must be copied
//
/// Calls makeOpenDirAccessMaskW iteratively to make an entire path
/// (i.e. creating any parent directories that do not exist).
/// Opens the dir if the path already exists and is a directory.
/// This function is not atomic, and if it returns an error, the file system may
/// have been modified regardless.
fn makeOpenPathAccessMaskW(self: std.fs.Dir, sub_path: []const u8, access_mask: u32, no_follow: bool) std.os.OpenError!std.fs.Dir {
    var it = try std.fs.path.componentIterator(sub_path);
    // If there are no components in the path, then create a dummy component with the full path.
    var component = it.last() orelse std.fs.path.NativeUtf8ComponentIterator.Component{
        .name = "",
        .path = sub_path,
    };

    while (true) {
        const sub_path_w = try w.sliceToPrefixedFileW(self.fd, component.path);
        const is_last = it.peekNext() == null;
        var result = makeOpenDirAccessMaskW(self, sub_path_w.span().ptr, access_mask, .{
            .no_follow = no_follow,
            .create_disposition = if (is_last) w.FILE_OPEN_IF else w.FILE_CREATE,
        }) catch |err| switch (err) {
            error.FileNotFound => |e| {
                component = it.previous() orelse return e;
                continue;
            },
            else => |e| return e,
        };

        component = it.next() orelse return result;
        // Don't leak the intermediate file handles
        result.close();
    }
}
const MakeOpenDirAccessMaskWOptions = struct {
    no_follow: bool,
    create_disposition: u32,
};

fn makeOpenDirAccessMaskW(self: std.fs.Dir, sub_path_w: [*:0]const u16, access_mask: u32, flags: MakeOpenDirAccessMaskWOptions) std.os.OpenError!std.fs.Dir {
    var result = std.fs.Dir{
        .fd = undefined,
    };

    const path_len_bytes = @as(u16, @intCast(std.mem.sliceTo(sub_path_w, 0).len * 2));
    var nt_name = w.UNICODE_STRING{
        .Length = path_len_bytes,
        .MaximumLength = path_len_bytes,
        .Buffer = @constCast(sub_path_w),
    };
    var attr = w.OBJECT_ATTRIBUTES{
        .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
        .RootDirectory = if (std.fs.path.isAbsoluteWindowsW(sub_path_w)) null else self.fd,
        .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        .ObjectName = &nt_name,
        .SecurityDescriptor = null,
        .SecurityQualityOfService = null,
    };
    const open_reparse_point: w.DWORD = if (flags.no_follow) w.FILE_OPEN_REPARSE_POINT else 0x0;
    var io: w.IO_STATUS_BLOCK = undefined;
    const rc = w.ntdll.NtCreateFile(
        &result.fd,
        access_mask,
        &attr,
        &io,
        null,
        w.FILE_ATTRIBUTE_NORMAL,
        w.FILE_SHARE_READ | w.FILE_SHARE_WRITE,
        flags.create_disposition,
        w.FILE_DIRECTORY_FILE | w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_FOR_BACKUP_INTENT | open_reparse_point,
        null,
        0,
    );

    switch (rc) {
        .SUCCESS => return result,
        .OBJECT_NAME_INVALID => return error.BadPathName,
        .OBJECT_NAME_NOT_FOUND => return error.FileNotFound,
        .OBJECT_PATH_NOT_FOUND => return error.FileNotFound,
        .NOT_A_DIRECTORY => return error.NotDir,
        // This can happen if the directory has 'List folder contents' permission set to 'Deny'
        // and the directory is trying to be opened for iteration.
        .ACCESS_DENIED => return error.AccessDenied,
        .INVALID_PARAMETER => return error.BadPathName,
        else => return w.unexpectedStatus(rc),
    }
}
