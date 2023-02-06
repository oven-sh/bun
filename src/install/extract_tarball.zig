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
const Semver = @import("./semver.zig");
const std = @import("std");
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const ExtractTarball = @This();

name: strings.StringOrTinyString,
resolution: Resolution,
registry: string,
cache_dir: std.fs.Dir,
temp_dir: std.fs.Dir,
dependency_id: DependencyID,
skip_verify: bool = false,
integrity: Integrity = Integrity{},
url: string = "",
package_manager: *PackageManager,

pub inline fn run(this: ExtractTarball, task_id: u64, bytes: []const u8) !Install.ExtractData {
    if (!this.skip_verify and this.integrity.tag.isSupported()) {
        if (!this.integrity.verify(bytes)) {
            Output.prettyErrorln("<r><red>Integrity check failed<r> for tarball: {s}", .{this.name.slice()});
            Output.flush();
            return error.IntegrityCheckFailed;
        }
    }
    return this.extract(bytes, task_id);
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
        if (std.mem.indexOfScalar(u8, name, '/')) |i| {
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

threadlocal var final_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
threadlocal var folder_name_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
threadlocal var json_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

fn extract(this: *const ExtractTarball, tgz_bytes: []const u8, task_id: u64) !Install.ExtractData {
    var tmpdir = this.temp_dir;
    var tmpname_buf: [256]u8 = undefined;
    const name = this.name.slice();

    var basename = this.name.slice();
    if (basename[0] == '@') {
        if (std.mem.indexOfScalar(u8, basename, '/')) |i| {
            basename = basename[i + 1 ..];
        }
    }

    var resolved: string = "";
    var tmpname = try FileSystem.instance.tmpname(basename[0..@min(basename.len, 32)], &tmpname_buf, tgz_bytes.len);
    {
        var extract_destination = tmpdir.makeOpenPathIterable(std.mem.span(tmpname), .{}) catch |err| {
            Output.panic("err: {s} when create temporary directory named {s} (while extracting {s})", .{ @errorName(err), tmpname, name });
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
            Output.prettyErrorln(
                "<r><red>Error {s}<r> decompressing {s}",
                .{
                    @errorName(err),
                    name,
                },
            );
            Global.crash();
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

                _ = if (PackageManager.verbose_install)
                    try Archive.extractToDir(
                        zlib_pool.data.list.items,
                        extract_destination,
                        null,
                        *DirnameReader,
                        &dirname_reader,
                        // for npm packages, the root dir is always "package"
                        // for github tarballs, the root dir is always the commit id
                        1,
                        true,
                        true,
                    )
                else
                    try Archive.extractToDir(
                        zlib_pool.data.list.items,
                        extract_destination,
                        null,
                        *DirnameReader,
                        &dirname_reader,
                        // for npm packages, the root dir is always "package"
                        // for github tarballs, the root dir is always the commit id
                        1,
                        true,
                        false,
                    );

                // This tag is used to know which version of the package was
                // installed from GitHub. package.json version becomes sort of
                // meaningless in cases like this.
                if (resolved.len > 0) insert_tag: {
                    const gh_tag = extract_destination.dir.createFileZ(".bun-tag", .{ .truncate = true }) catch break :insert_tag;
                    defer gh_tag.close();
                    gh_tag.writeAll(resolved) catch {
                        extract_destination.dir.deleteFileZ(".bun-tag") catch {};
                    };
                }
            },
            else => {
                _ = if (PackageManager.verbose_install)
                    try Archive.extractToDir(
                        zlib_pool.data.list.items,
                        extract_destination,
                        null,
                        void,
                        void{},
                        // for npm packages, the root dir is always "package"
                        // for github tarballs, the root dir is always the commit id
                        1,
                        true,
                        true,
                    )
                else
                    try Archive.extractToDir(
                        zlib_pool.data.list.items,
                        extract_destination,
                        null,
                        void,
                        void{},
                        // for npm packages, the root dir is always "package"
                        // for github tarballs, the root dir is always the commit id
                        1,
                        true,
                        false,
                    );
            },
        }

        if (PackageManager.verbose_install) {
            Output.prettyErrorln(
                "[{s}] Extracted<r>",
                .{
                    name,
                },
            );
            Output.flush();
        }
    }
    const folder_name = switch (this.resolution.tag) {
        .npm => this.package_manager.cachedNPMPackageFolderNamePrint(&folder_name_buf, name, this.resolution.value.npm.version),
        .github => PackageManager.cachedGitHubFolderNamePrint(&folder_name_buf, resolved),
        else => unreachable,
    };
    if (folder_name.len == 0 or (folder_name.len == 1 and folder_name[0] == '/')) @panic("Tried to delete root and stopped it");
    var cache_dir = this.cache_dir;
    cache_dir.deleteTree(folder_name) catch {};

    // e.g. @next
    // if it's a namespace package, we need to make sure the @name folder exists
    if (basename.len != name.len) {
        cache_dir.makeDir(std.mem.trim(u8, name[0 .. name.len - basename.len], "/")) catch {};
    }

    // Now that we've extracted the archive, we rename.
    std.os.renameatZ(tmpdir.fd, tmpname, cache_dir.fd, folder_name) catch |err| {
        Output.prettyErrorln(
            "<r><red>Error {s}<r> moving {s} to cache dir:\n   From: {s}    To: {s}",
            .{
                @errorName(err),
                name,
                tmpname,
                folder_name,
            },
        );
        Global.crash();
    };

    // We return a resolved absolute absolute file path to the cache dir.
    // To get that directory, we open the directory again.
    var final_dir = cache_dir.openDirZ(folder_name, .{}, true) catch |err| {
        Output.prettyErrorln(
            "<r><red>Error {s}<r> failed to verify cache dir for {s}",
            .{
                @errorName(err),
                name,
            },
        );
        Global.crash();
    };

    defer final_dir.close();
    // and get the fd path
    var final_path = bun.getFdPath(
        final_dir.fd,
        &final_path_buf,
    ) catch |err| {
        Output.prettyErrorln(
            "<r><red>Error {s}<r> failed to verify cache dir for {s}",
            .{
                @errorName(err),
                name,
            },
        );
        Global.crash();
    };

    // create an index storing each version of a package installed
    create_index: {
        var index_dir = cache_dir.makeOpenPathIterable(name, .{}) catch break :create_index;
        defer index_dir.close();
        index_dir.dir.symLink(
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
    switch (this.resolution.tag) {
        .github => {
            var json_file = final_dir.openFileZ("package.json", .{ .mode = .read_only }) catch |err| {
                Output.prettyErrorln("<r><red>Error {s}<r> failed to open package.json for {s}", .{
                    @errorName(err),
                    name,
                });
                Global.crash();
            };
            defer json_file.close();
            var json_stat = try json_file.stat();
            json_buf = try this.package_manager.allocator.alloc(u8, json_stat.size + 64);
            json_len = try json_file.preadAll(json_buf, 0);

            json_path = bun.getFdPath(
                json_file.handle,
                &json_path_buf,
            ) catch |err| {
                Output.prettyErrorln(
                    "<r><red>Error {s}<r> failed to open package.json for {s}",
                    .{
                        @errorName(err),
                        name,
                    },
                );
                Global.crash();
            };
            // TODO remove extracted files not matching any globs under "files"
        },
        else => {},
    }

    const ret_final_path = try FileSystem.instance.dirname_store.append(@TypeOf(final_path), final_path);
    const ret_json_path = try FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path);
    return .{
        .url = this.url,
        .resolved = resolved,
        .final_path = ret_final_path,
        .json_path = ret_json_path,
        .json_buf = json_buf,
        .json_len = json_len,
        .task_id = task_id,
    };
}
