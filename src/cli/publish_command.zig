const std = @import("std");
const bun = @import("root").bun;
const Command = bun.CLI.Command;
const Output = bun.Output;
const Global = bun.Global;
const http = bun.http;
const OOM = bun.OOM;
const Headers = http.Headers;
const HeaderBuilder = http.HeaderBuilder;
const MutableString = bun.MutableString;
const URL = bun.URL;
const install = bun.install;
const PackageManager = install.PackageManager;
const strings = bun.strings;
const string = bun.string;
const stringZ = bun.stringZ;
const File = bun.sys.File;
const JSON = bun.JSON;
const sha = bun.sha;
const path = bun.path;
const FileSystem = bun.fs.FileSystem;
const Environment = bun.Environment;
const Archive = bun.libarchive.lib.Archive;
const logger = bun.logger;
const Dependency = install.Dependency;

pub const PublishCommand = struct {
    const Context = struct {
        manager: *PackageManager,
        allocator: std.mem.Allocator,
        package_name: string,
        package_version: string,
        abs_tarball_path: stringZ,
        tarball_bytes: string,
        shasum: sha.SHA1.Digest,
        integrity: sha.SHA512.Digest,
        readme: ?string,
        description: ?string,
        uses_workspaces: bool,

        const FromTarballError = OOM || error{
            MissingPackageJSON,
            InvalidPackageJSON,
            MissingPackageName,
            MissingPackageVersion,
            InvalidPackageName,
            InvalidPackageVersion,
            PrivatePackage,
            RestrictedUnscopedPackage,
        };

        // Retrieve information for publishing from a tarball path, `bun publish path/to/tarball.tgz`
        pub fn fromTarballPath(allocator: std.mem.Allocator, manager: *PackageManager, tarball_path: string) FromTarballError!Context {
            var abs_buf: bun.PathBuffer = undefined;
            const abs_tarball_path = path.joinAbsStringBufZ(
                FileSystem.instance.top_level_dir,
                &abs_buf,
                &[_]string{tarball_path},
                .auto,
            );

            const tarball_bytes = File.readFrom(bun.invalid_fd, abs_tarball_path, allocator).unwrap() catch |err| {
                Output.err(err, "failed to read tarball: '{s}'", .{tarball_path});
                Global.crash();
            };

            var readme_contents: ?[]const u8 = null;
            var maybe_package_json_contents: ?[]const u8 = null;

            var iter = switch (Archive.Iterator.init(tarball_bytes)) {
                .err => |err| {
                    Output.errGeneric("{s}: {s}", .{
                        err.message,
                        err.archive.errorString(),
                    });

                    Global.crash();
                },
                .result => |res| res,
            };

            // filter everything but regular files
            iter.filter.toggleAll();
            iter.filter.toggle(.file);

            while (switch (iter.next()) {
                .err => |err| {
                    Output.errGeneric("{s}: {s}", .{ err.message, err.archive.errorString() });
                    Global.crash();
                },
                .result => |res| res,
            }) |next| {
                if (readme_contents != null and maybe_package_json_contents != null) break;

                const pathname = if (comptime Environment.isWindows)
                    next.entry.pathnameW()
                else
                    next.entry.pathname();

                if (strings.indexOfAnyT(bun.OSPathChar, pathname, "/\\")) |slash| {
                    if (strings.indexOfAnyT(bun.OSPathChar, pathname[slash + 1 ..], "/\\") == null) {

                        // check for package.json, readme.md, ...
                        const filename = pathname[slash + 1 ..];

                        if (maybe_package_json_contents == null and strings.eqlCaseInsensitiveT(bun.OSPathChar, filename, "package.json")) {
                            maybe_package_json_contents = switch (try next.readEntryData(allocator, iter.archive)) {
                                .err => |err| {
                                    Output.errGeneric("{s}: {s}", .{ err.message, err.archive.errorString() });
                                    Global.crash();
                                },
                                .result => |bytes| bytes,
                            };
                        } else if (readme_contents == null and strings.hasPrefixCaseInsensitiveT(bun.OSPathChar, filename, "readme.")) {
                            readme_contents = switch (try next.readEntryData(allocator, iter.archive)) {
                                .err => |err| {
                                    Output.errGeneric("{s}: {s}", .{ err.message, err.archive.errorString() });
                                    Global.crash();
                                },
                                .result => |bytes| bytes,
                            };
                        }
                    }
                }
            }

            switch (iter.deinit()) {
                .err => |err| {
                    Output.errGeneric("{s}: {s}", .{ err.message, err.archive.errorString() });
                    Global.crash();
                },
                .result => {},
            }

            const package_json_contents = maybe_package_json_contents orelse return error.MissingPackageJSON;

            const package_name, const package_version, const description = package_info: {
                defer allocator.free(package_json_contents);

                const source = logger.Source.initPathString("package.json", package_json_contents);
                const json = JSON.parsePackageJSONUTF8(&source, manager.log, allocator) catch |err| {
                    return switch (err) {
                        error.OutOfMemory => |oom| return oom,
                        else => error.InvalidPackageJSON,
                    };
                };

                if (json.get("private")) |private| {
                    if (private.asBool()) |is_private| {
                        if (is_private) {
                            return error.PrivatePackage;
                        }
                    }
                }

                const name = try json.getStringCloned(allocator, "name") orelse return error.MissingPackageName;
                const is_scoped = try Dependency.isScopedPackageName(name);

                if (manager.options.publish_config.access) |access| {
                    if (access == .restricted and !is_scoped) {
                        return error.RestrictedUnscopedPackage;
                    }
                }

                const version = try json.getStringCloned(allocator, "version") orelse return error.MissingPackageVersion;
                if (version.len == 0) return error.InvalidPackageVersion;

                var description = try json.getStringCloned(allocator, "description") orelse null;
                if (description != null and description.?.len == 0) description = null;

                break :package_info .{ name, version, description };
            };

            var sha1_digest: sha.SHA1.Digest = undefined;
            var sha1 = sha.SHA1.init();
            defer sha1.deinit();

            sha1.update(tarball_bytes);
            sha1.final(&sha1_digest);

            var sha512_digest: sha.SHA512.Digest = undefined;
            var sha512 = sha.SHA512.init();
            defer sha512.deinit();

            sha512.update(tarball_bytes);
            sha512.final(&sha512_digest);

            return .{
                .manager = manager,
                .allocator = allocator,
                .package_name = package_name,
                .package_version = package_version,
                .abs_tarball_path = try allocator.dupeZ(u8, abs_tarball_path),
                .tarball_bytes = tarball_bytes,
                .shasum = sha1_digest,
                .integrity = sha512_digest,
                .readme = readme_contents,
                .description = description,
                .uses_workspaces = false,
            };
        }

        // `bun publish`. Automatically pack the current workspace, and retrieve information required
        // for publishing
        pub fn fromWorkspace() Context {
            //
        }
    };

    pub fn exec(ctx: Command.Context) !void {
        Output.prettyErrorln("<r><b>bun publish <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        Output.flush();

        const cli = try PackageManager.CommandLineArguments.parse(ctx.allocator, .publish);

        const manager, const original_cwd = PackageManager.init(ctx, cli, .publish) catch |err| {
            if (!cli.silent) {
                if (err == error.MissingPackageJSON) {
                    Output.errGeneric("missing package.json, nothing to publish", .{});
                }
                Output.errGeneric("failed to initialize bun install: {s}", .{@errorName(err)});
            }
            Global.crash();
        };
        defer ctx.allocator.free(original_cwd);

        if (cli.positionals.len > 1) {
            const context = Context.fromTarballPath(ctx.allocator, manager, cli.positionals[1]) catch |err| {
                switch (err) {
                    error.OutOfMemory => bun.outOfMemory(),
                    error.MissingPackageName => {
                        Output.errGeneric("missing `name` string in package.json", .{});
                    },
                    error.MissingPackageVersion => {
                        Output.errGeneric("missing `version` string in package.json", .{});
                    },
                    error.InvalidPackageName, error.InvalidPackageVersion => {
                        Output.errGeneric("package.json `name` and `version` fields must be non-empty strings", .{});
                    },
                    error.MissingPackageJSON => {
                        Output.errGeneric("failed to find package.json in tarball '{s}'", .{cli.positionals[1]});
                    },
                    error.InvalidPackageJSON => {
                        switch (Output.enable_ansi_colors) {
                            inline else => |enable_ansi_colors| {
                                manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors) catch {};
                            },
                        }
                        Output.errGeneric("failed to parse tarball package.json", .{});
                    },
                    error.PrivatePackage => {
                        Output.errGeneric("attemped to publish a private package", .{});
                    },
                    error.RestrictedUnscopedPackage => {
                        Output.errGeneric("unable to restrict access to unscoped packages", .{});
                    },
                }
                Global.crash();
            };

            publish(&context) catch |err| {
                switch (err) {
                    error.OutOfMemory => bun.outOfMemory(),
                }
            };

            return;
        }

        const sha1_digest: sha.SHA1.Digest = undefined;
        const sha512_digest: sha.SHA512.Digest = undefined;

        // TODO: auto pack. pass option to also output shasum, integrity, package name/version and
        // all other information we need so we don't need to read the tarball.

        publish(&.{
            .manager = manager,
            .allocator = ctx.allocator,
            .package_name = "ooops",
            .package_version = "ooops",
            .abs_tarball_path = "ooops",
            .tarball_bytes = "ooops",
            .shasum = sha1_digest,
            .integrity = sha512_digest,
            .readme = null,
            .description = null,
            .uses_workspaces = false,
        }) catch |err| {
            switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            }
        };
    }

    const PublishError = OOM || error{};

    pub fn publish(ctx: *const Context) PublishError!void {
        const registry = ctx.manager.scopeForPackageName(ctx.package_name);

        const tag = if (ctx.manager.options.publish_config.tag.len > 0)
            ctx.manager.options.publish_config.tag
        else
            "latest";

        const tarball_base64_len = std.base64.standard.Encoder.calcSize(ctx.tarball_bytes.len);

        var json = try std.ArrayListUnmanaged(u8).initCapacity(
            ctx.allocator,
            ctx.package_name.len * 5 +
                ctx.package_version.len * 4 +
                if (ctx.readme) |readme| readme.len else 0 +
                ctx.abs_tarball_path.len +
                if (ctx.description) |description| description.len else 0 +
                tarball_base64_len,
        );
        defer json.deinit(ctx.allocator);
        var json_writer = json.writer(ctx.allocator);

        try json_writer.print("{{\"_id\":\"{s}\",\"name\":\"{s}\"", .{
            ctx.package_name,
            ctx.package_name,
        });

        if (ctx.description orelse ctx.readme) |description| {
            try json_writer.print(",\"description\":\"{}\"", .{
                bun.fmt.formatJSONStringUTF8(description),
            });
        }

        try json_writer.print(",\"dist-tags\":{{\"{s}\":\"{s}\"}}", .{
            tag,
            ctx.package_version,
        });

        // "versions"
        {
            try json_writer.print(",\"versions\":{{\"{s}\":{{\"name\":\"{s}\",\"version\":\"{s}\"", .{
                ctx.package_version,
                ctx.package_name,
                ctx.package_version,
            });

            try json_writer.print(",\"_id\": \"{s}@{s}\",\"readme\":\"{s}\",\"_integrity\":\"{}\"", .{
                ctx.package_name,
                ctx.package_version,
                ctx.readme orelse "ERROR: No README data found!",
                bun.fmt.integrity(ctx.integrity, false),
            });

            if (ctx.description orelse ctx.readme) |description| {
                try json_writer.print(",\"description\":\"{}\"", .{
                    bun.fmt.formatJSONStringUTF8(description),
                });
            }

            // TODO: Doesn't seem needed. It's only included if tarball path is passed
            // to publish. Mostly likely included due to using manifest
            // try json_writer.print(",\"_resolved\":\"{s}\",\"_from\":\"file:{s}\"", .{
            //     ctx.abs_tarball_path,
            //     std.fs.path.basename(ctx.abs_tarball_path),
            // });

            try json_writer.print(",\"_nodeVersion\":\"{s}\",\"_npmVersion\":\"{s}\"", .{
                Environment.reported_nodejs_version,
                // TODO: npm version
                "10.8.3",
            });

            try json_writer.print(",\"dist\":{{\"integrity\":\"{}\",\"shasum\":\"{s}\"", .{
                bun.fmt.integrity(ctx.integrity, false),
                bun.fmt.bytesToHex(ctx.shasum, .lower),
            });

            // https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/workspaces/libnpmpublish/lib/publish.js#L118
            // https:// -> http://
            try json_writer.print(",\"tarball\":\"http://{s}/{s}/-/{s}\"}}}}}}", .{
                strings.withoutTrailingSlash(registry.url.href),
                ctx.package_name,
                std.fs.path.basename(ctx.abs_tarball_path),
            });
        }

        if (ctx.manager.options.publish_config.access) |access| {
            try json_writer.print(",\"access\":\"{s}\"", .{@tagName(access)});
        } else {
            try json_writer.writeAll(",\"access\":null");
        }

        // "_attachments"
        {
            try json_writer.print(",\"_attachments\":{{\"{s}\":{{\"content_type\":\"{s}\",\"data\":\"", .{
                std.fs.path.basename(ctx.abs_tarball_path),
                "application/octet-stream",
            });

            try json.ensureUnusedCapacity(ctx.allocator, tarball_base64_len);
            json.items.len += tarball_base64_len;
            const count = bun.simdutf.base64.encode(ctx.tarball_bytes, json.items[json.items.len - tarball_base64_len ..], false);
            bun.assertWithLocation(count == tarball_base64_len, @src());

            try json_writer.print("\",\"length\":{d}}}}}}}", .{
                ctx.tarball_bytes.len,
            });
        }

        // std.debug.print("req body:\n{s}\n", .{json.items});

        const ci_name = @import("../ci_info.zig").detectCI();

        var print_buf: std.ArrayListUnmanaged(u8) = .{};
        defer print_buf.deinit(ctx.allocator);
        var print_writer = print_buf.writer(ctx.allocator);

        var headers: HeaderBuilder = .{};

        {
            headers.count("accept", "*/*");
            headers.count("accept-encoding", "gzip,deflate");

            try print_writer.print("Bearer {s}", .{
                registry.token,
            });
            headers.count("authorization", print_buf.items);
            print_buf.clearRetainingCapacity();

            headers.count("content-type", "application/json");
            headers.count("npm-auth-type", "web");
            headers.count("npm-command", "publish");

            try print_writer.print("{s} {s} {s} workspaces/{}{s}{s}", .{
                Global.user_agent,
                Global.os_name,
                Global.arch_name,
                ctx.uses_workspaces,
                if (ci_name != null) " ci/" else "",
                ci_name orelse "",
            });
            // headers.count("user-agent", "npm/10.8.3 node/v22.6.0 darwin arm64 workspaces/false");
            headers.count("user-agent", print_buf.items);
            print_buf.clearRetainingCapacity();

            headers.count("Connection", "keep-alive");
            headers.count("Host", registry.url.host);

            try print_writer.print("{d}", .{json.items.len});
            headers.count("Content-Length", print_buf.items);
            print_buf.clearRetainingCapacity();
        }

        try headers.allocate(ctx.allocator);

        {
            headers.append("accept", "*/*");
            headers.append("accept-encoding", "gzip,deflate");

            try print_writer.print("Bearer {s}", .{
                registry.token,
            });
            headers.append("authorization", print_buf.items);
            print_buf.clearRetainingCapacity();

            headers.append("content-type", "application/json");
            headers.append("npm-auth-type", "web");
            headers.append("npm-command", "publish");

            try print_writer.print("{s} {s} {s} workspaces/{}{s}{s}", .{
                Global.user_agent,
                Global.os_name,
                Global.arch_name,
                ctx.uses_workspaces,
                if (ci_name != null) " ci/" else "",
                ci_name orelse "",
            });
            // headers.append("user-agent", "npm/10.8.3 node/v22.6.0 darwin arm64 workspaces/false");
            headers.append("user-agent", print_buf.items);
            print_buf.clearRetainingCapacity();

            headers.append("Connection", "keep-alive");
            headers.append("Host", registry.url.host);

            try print_writer.print("{d}", .{json.items.len});
            headers.append("Content-Length", print_buf.items);
            print_buf.clearRetainingCapacity();
        }

        var response_buf = try MutableString.init(ctx.allocator, 8192);

        // `print_buf` belongs to `url` after this point
        try print_writer.print("{s}/{s}", .{
            strings.withoutTrailingSlash(registry.url.href),
            ctx.package_name,
        });
        const url = URL.parse(print_buf.items);

        var async_http = http.AsyncHTTP.initSync(
            ctx.allocator,
            .PUT,
            url,
            headers.entries,
            headers.content.ptr.?[0..headers.content.len],
            &response_buf,
            json.items,
            null,
            null,
            .follow,
        );

        const res = async_http.sendSync() catch |err| {
            switch (err) {
                error.OutOfMemory => |oom| return oom,
                else => {
                    Output.errGeneric("failed to publish package: {s}", .{@errorName(err)});
                    Global.crash();
                },
            }
        };

        std.debug.print("res:\n{}", .{res});

        std.debug.print("res body:\n{s}\n", .{response_buf.list.items});
    }
};
