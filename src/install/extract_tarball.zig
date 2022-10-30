const Output = @import("../global.zig").Output;
const strings = @import("../string_immutable.zig");
const string = @import("../string_types.zig").string;
const Resolution = @import("./resolution.zig").Resolution;
const FileSystem = @import("../fs.zig").FileSystem;
const Semver = @import("./semver.zig");
const Integrity = @import("./integrity.zig").Integrity;
const PackageID = @import("./install.zig").PackageID;
const PackageManager = @import("./install.zig").PackageManager;
const std = @import("std");
const Npm = @import("./npm.zig");
const ExtractTarball = @This();
const default_allocator = @import("../global.zig").default_allocator;
const Global = @import("../global.zig").Global;
const bun = @import("../global.zig");
name: strings.StringOrTinyString,
resolution: Resolution,
registry: string,
cache_dir: std.fs.Dir,
temp_dir: std.fs.Dir,
package_id: PackageID,
skip_verify: bool = false,
integrity: Integrity = Integrity{},
url: string = "",
package_manager: *PackageManager = &PackageManager.instance,

pub inline fn run(this: ExtractTarball, bytes: []const u8) !string {
    if (!this.skip_verify and this.integrity.tag.isSupported()) {
        if (!this.integrity.verify(bytes)) {
            Output.prettyErrorln("<r><red>Integrity check failed<r> for tarball: {s}", .{this.name.slice()});
            Output.flush();
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

threadlocal var abs_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
threadlocal var abs_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;

fn extract(this: *const ExtractTarball, tgz_bytes: []const u8) !string {
    var tmpdir = this.temp_dir;
    var tmpname_buf: [256]u8 = undefined;
    const name = this.name.slice();

    var basename = this.name.slice();
    if (basename[0] == '@') {
        if (std.mem.indexOfScalar(u8, basename, '/')) |i| {
            basename = basename[i + 1 ..];
        }
    }

    var tmpname = try FileSystem.instance.tmpname(basename[0..@minimum(basename.len, 32)], &tmpname_buf, tgz_bytes.len);
    {
        var extract_destination = tmpdir.makeOpenPath(std.mem.span(tmpname), .{ .iterate = true }) catch |err| {
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
        _ = if (PackageManager.verbose_install)
            try Archive.extractToDir(
                zlib_pool.data.list.items,
                extract_destination,
                null,
                void,
                void{},
                // for npm packages, the root dir is always "package"
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
                1,
                true,
                false,
            );

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
    var folder_name = this.package_manager.cachedNPMPackageFolderNamePrint(&abs_buf2, name, this.resolution.value.npm.version);
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
    var final_dir = cache_dir.openDirZ(folder_name, .{ .iterate = false }) catch |err| {
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
    var final_path = std.os.getFdPath(
        final_dir.fd,
        &abs_buf,
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
        var index_dir = cache_dir.makeOpenPath(name, .{ .iterate = true }) catch break :create_index;
        defer index_dir.close();
        index_dir.symLink(
            final_path,
            // trim "name@" from the prefix
            folder_name[name.len + 1 ..],
            .{},
        ) catch break :create_index;
    }

    return try FileSystem.instance.dirname_store.append(@TypeOf(final_path), final_path);
}
