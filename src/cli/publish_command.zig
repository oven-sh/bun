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
const Pack = bun.CLI.PackCommand;
const Lockfile = install.Lockfile;
const MimeType = http.MimeType;
const Expr = bun.js_parser.Expr;
const prompt = bun.CLI.InitCommand.prompt;
const Npm = install.Npm;
const Run = bun.CLI.RunCommand;
const DotEnv = bun.DotEnv;

pub const PublishCommand = struct {
    pub fn Context(comptime directory_publish: bool) type {
        return struct {
            manager: *PackageManager,
            allocator: std.mem.Allocator,
            command_ctx: Command.Context,

            package_name: string,
            package_version: string,
            abs_tarball_path: stringZ,
            tarball_bytes: string,
            shasum: sha.SHA1.Digest,
            integrity: sha.SHA512.Digest,
            uses_workspaces: bool,

            publish_script: if (directory_publish) ?[]const u8 else void = if (directory_publish) null else {},
            postpublish_script: if (directory_publish) ?[]const u8 else void = if (directory_publish) null else {},
            script_env: if (directory_publish) *DotEnv.Loader else void,

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
            pub fn fromTarballPath(
                ctx: Command.Context,
                manager: *PackageManager,
                tarball_path: string,
            ) FromTarballError!Context(directory_publish) {
                var abs_buf: bun.PathBuffer = undefined;
                const abs_tarball_path = path.joinAbsStringBufZ(
                    FileSystem.instance.top_level_dir,
                    &abs_buf,
                    &[_]string{tarball_path},
                    .auto,
                );

                const tarball_bytes = File.readFrom(bun.invalid_fd, abs_tarball_path, ctx.allocator).unwrap() catch |err| {
                    Output.err(err, "failed to read tarball: '{s}'", .{tarball_path});
                    Global.crash();
                };

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
                    if (maybe_package_json_contents != null) break;

                    const pathname = if (comptime Environment.isWindows)
                        next.entry.pathnameW()
                    else
                        next.entry.pathname();

                    // this is option `strip: 1` (npm expects a `package/` prefix for all paths)
                    if (strings.indexOfAnyT(bun.OSPathChar, pathname, "/\\")) |slash| {
                        if (strings.indexOfAnyT(bun.OSPathChar, pathname[slash + 1 ..], "/\\") == null) {

                            // check for package.json, readme.md, ...
                            const filename = pathname[slash + 1 ..];

                            if (maybe_package_json_contents == null and strings.eqlCaseInsensitiveT(bun.OSPathChar, filename, "package.json")) {
                                maybe_package_json_contents = switch (try next.readEntryData(ctx.allocator, iter.archive)) {
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

                const package_name, const package_version = package_info: {
                    defer ctx.allocator.free(package_json_contents);

                    const source = logger.Source.initPathString("package.json", package_json_contents);
                    const json = JSON.parsePackageJSONUTF8(&source, manager.log, ctx.allocator) catch |err| {
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

                    const name = try json.getStringCloned(ctx.allocator, "name") orelse return error.MissingPackageName;
                    const is_scoped = try Dependency.isScopedPackageName(name);

                    if (manager.options.publish_config.access) |access| {
                        if (access == .restricted and !is_scoped) {
                            return error.RestrictedUnscopedPackage;
                        }
                    }

                    const version = try json.getStringCloned(ctx.allocator, "version") orelse return error.MissingPackageVersion;
                    if (version.len == 0) return error.InvalidPackageVersion;

                    break :package_info .{ name, version };
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
                    .allocator = ctx.allocator,
                    .package_name = package_name,
                    .package_version = package_version,
                    .abs_tarball_path = try ctx.allocator.dupeZ(u8, abs_tarball_path),
                    .tarball_bytes = tarball_bytes,
                    .shasum = sha1_digest,
                    .integrity = sha512_digest,
                    .uses_workspaces = false,
                    .command_ctx = ctx,
                    .script_env = {},
                };
            }

            const FromWorkspaceError = Pack.PackError(true);

            // `bun publish` without a tarball path. Automatically pack the current workspace and get
            // information required for publishing
            pub fn fromWorkspace(
                ctx: Command.Context,
                manager: *PackageManager,
            ) FromWorkspaceError!Context(directory_publish) {
                var lockfile: Lockfile = undefined;
                const load_from_disk_result = lockfile.loadFromDisk(
                    manager,
                    manager.allocator,
                    manager.log,
                    manager.options.lockfile_path,
                    false,
                );

                var pack_ctx: Pack.Context = .{
                    .allocator = ctx.allocator,
                    .manager = manager,
                    .command_ctx = ctx,
                    .lockfile = switch (load_from_disk_result) {
                        .ok => |ok| ok.lockfile,
                        .not_found => null,
                        .err => |cause| err: {
                            switch (cause.step) {
                                .open_file => {
                                    if (cause.value == error.ENOENT) break :err null;
                                    Output.errGeneric("failed to open lockfile: {s}", .{@errorName(cause.value)});
                                },
                                .parse_file => {
                                    Output.errGeneric("failed to parse lockfile: {s}", .{@errorName(cause.value)});
                                },
                                .read_file => {
                                    Output.errGeneric("failed to read lockfile: {s}", .{@errorName(cause.value)});
                                },
                                .migrating => {
                                    Output.errGeneric("failed to migrate lockfile: {s}", .{@errorName(cause.value)});
                                },
                            }

                            if (manager.log.hasErrors()) {
                                switch (Output.enable_ansi_colors) {
                                    inline else => |enable_ansi_colors| {
                                        manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors) catch {};
                                    },
                                }
                            }

                            Global.crash();
                        },
                    },
                };

                return switch (manager.options.log_level) {
                    inline else => |log_level| Pack.pack(&pack_ctx, manager.original_package_json_path, log_level, true),
                };
            }
        };
    }

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
            const context = Context(false).fromTarballPath(ctx, manager, cli.positionals[1]) catch |err| {
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
                        Output.errGeneric("attempted to publish a private package", .{});
                    },
                    error.RestrictedUnscopedPackage => {
                        Output.errGeneric("unable to restrict access to unscoped package", .{});
                    },
                }
                Global.crash();
            };

            publish(false, &context) catch |err| {
                switch (err) {
                    error.OutOfMemory => bun.outOfMemory(),
                }
            };

            return;
        }

        const context = Context(true).fromWorkspace(ctx, manager) catch |err| {
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
                    Output.errGeneric("failed to find package.json from: '{s}'", .{FileSystem.instance.top_level_dir});
                },
                error.RestrictedUnscopedPackage => {
                    Output.errGeneric("unable to restrict access to unscoped package", .{});
                },
                error.PrivatePackage => {
                    Output.errGeneric("attempted to publish a private package", .{});
                },
            }
            Global.crash();
        };

        // TODO: read this into memory
        _ = bun.sys.unlink(context.abs_tarball_path);

        publish(true, &context) catch |err| {
            switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            }
        };
    }

    const PublishError = OOM || error{};

    pub fn publish(
        comptime directory_publish: bool,
        ctx: *const Context(directory_publish),
    ) PublishError!void {
        const registry = ctx.manager.scopeForPackageName(ctx.package_name);

        const publish_req_body = try constructPublishRequestBody(directory_publish, ctx, registry);

        var print_buf: std.ArrayListUnmanaged(u8) = .{};
        defer print_buf.deinit(ctx.allocator);
        var print_writer = print_buf.writer(ctx.allocator);

        var headers = try constructPublishHeaders(
            ctx.allocator,
            &print_buf,
            registry,
            publish_req_body.len,
            null,
            ctx.uses_workspaces,
        );

        var response_buf = try MutableString.init(ctx.allocator, 1024);

        try print_writer.print("{s}/{s}", .{
            strings.withoutTrailingSlash(registry.url.href),
            ctx.package_name,
        });
        const publish_url = URL.parse(try ctx.allocator.dupe(u8, print_buf.items));
        print_buf.clearRetainingCapacity();

        var req = http.AsyncHTTP.initSync(
            ctx.allocator,
            .PUT,
            publish_url,
            headers.entries,
            headers.content.ptr.?[0..headers.content.len],
            &response_buf,
            publish_req_body,
            null,
            null,
            .follow,
        );

        const res = req.sendSync() catch |err| {
            switch (err) {
                error.OutOfMemory => |oom| return oom,
                else => {
                    Output.err(err, "failed to publish package", .{});
                    Global.crash();
                },
            }
        };

        // std.debug.print("res:\n{}\n", .{res});
        // std.debug.print("res body:\n{s}\n", .{response_buf.list.items});

        switch (res.status_code) {
            400...std.math.maxInt(@TypeOf(res.status_code)) => {
                const prompt_for_otp = res.status_code != 401 or prompt_for_otp: {
                    if (authenticate: {
                        for (res.headers) |header| {
                            if (strings.eqlCaseInsensitiveASCII(header.name, "www-authenticate", true)) {
                                break :authenticate header.value;
                            }
                        }
                        break :authenticate null;
                    }) |@"www-authenticate"| {
                        var iter = strings.split(@"www-authenticate", ",");
                        while (iter.next()) |part| {
                            const trimmed = strings.trim(part, &strings.whitespace_chars);
                            if (strings.eqlCaseInsensitiveASCII(trimmed, "ipaddress", true)) {
                                Output.errGeneric("login is not allowed from your IP address", .{});
                                Global.crash();
                            } else if (strings.eqlCaseInsensitiveASCII(trimmed, "otp", true)) {
                                break :prompt_for_otp true;
                            }
                        }

                        Output.errGeneric("unable to authenticate, need: {s}", .{@"www-authenticate"});
                        Global.crash();
                    } else if (strings.containsComptime(response_buf.list.items, "one-time pass")) {
                        // missing www-authenticate header but one-time pass is still included
                        break :prompt_for_otp true;
                    }

                    break :prompt_for_otp false;
                };

                if (!prompt_for_otp) {
                    // general error
                    return handleResponseErrors(res.status_code);
                }

                const otp = try getOTP(directory_publish, ctx, registry, &response_buf, &print_buf);

                headers = try constructPublishHeaders(
                    ctx.allocator,
                    &print_buf,
                    registry,
                    publish_req_body.len,
                    otp,
                    ctx.uses_workspaces,
                );

                response_buf.reset();

                var req_with_otp = http.AsyncHTTP.initSync(
                    ctx.allocator,
                    .PUT,
                    publish_url,
                    headers.entries,
                    headers.content.ptr.?[0..headers.content.len],
                    &response_buf,
                    publish_req_body,
                    null,
                    null,
                    .follow,
                );

                const otp_res = req_with_otp.sendSync() catch |err| {
                    switch (err) {
                        error.OutOfMemory => |oom| return oom,
                        else => {
                            Output.err(err, "failed to publish package", .{});
                            Global.crash();
                        },
                    }
                };

                // std.debug.print("otp res:\n{}\n", .{res});
                // std.debug.print("otp res body:\n{s}\n", .{response_buf.list.items});

                switch (otp_res.status_code) {
                    400...std.math.maxInt(@TypeOf(otp_res.status_code)) => |code| {
                        handleResponseErrors(code);
                    },
                    else => try success(directory_publish, ctx),
                }
            },
            else => try success(directory_publish, ctx),
        }
    }

    fn success(
        comptime directory_publish: bool,
        ctx: *const Context(directory_publish),
    ) OOM!void {
        if (comptime directory_publish) {
            if (ctx.manager.options.do.run_scripts) {
                const abs_workspace_path: string = strings.withoutTrailingSlash(strings.withoutSuffixComptime(ctx.manager.original_package_json_path, "package.json"));
                if (ctx.publish_script) |publish_script| {
                    _ = Run.runPackageScriptForeground(
                        ctx.command_ctx,
                        ctx.allocator,
                        publish_script,
                        "publish",
                        abs_workspace_path,
                        ctx.script_env,
                        &.{},
                        ctx.manager.options.log_level == .silent,
                        ctx.command_ctx.debug.use_system_shell,
                    ) catch |err| {
                        switch (err) {
                            error.MissingShell => {
                                Output.errGeneric("failed to find shell executable to run publish script", .{});
                                Global.crash();
                            },
                            error.OutOfMemory => |oom| return oom,
                        }
                    };
                }

                if (ctx.postpublish_script) |postpublish_script| {
                    _ = Run.runPackageScriptForeground(
                        ctx.command_ctx,
                        ctx.allocator,
                        postpublish_script,
                        "postpublish",
                        abs_workspace_path,
                        ctx.script_env,
                        &.{},
                        ctx.manager.options.log_level == .silent,
                        ctx.command_ctx.debug.use_system_shell,
                    ) catch |err| {
                        switch (err) {
                            error.MissingShell => {
                                Output.errGeneric("failed to find shell executable to run postpublish script", .{});
                                Global.crash();
                            },
                            error.OutOfMemory => |oom| return oom,
                        }
                    };
                }
            }
        }

        Output.prettyln("<green>{s}@{s}<r>", .{
            ctx.package_name,
            ctx.package_version,
        });
    }

    const GetOTPError = OOM || error{};

    fn getOTP(
        comptime directory_publish: bool,
        ctx: *const Context(directory_publish),
        registry: *const Npm.Registry.Scope,
        response_buf: *MutableString,
        print_buf: *std.ArrayListUnmanaged(u8),
    ) GetOTPError![]const u8 {
        const res_source = logger.Source.initPathString("???", response_buf.list.items);

        if (JSON.parseJSONUTF8(&res_source, ctx.manager.log, ctx.allocator) catch |err| res_json: {
            switch (err) {
                error.OutOfMemory => |oom| return oom,

                // https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/node_modules/npm-registry-fetch/lib/check-response.js#L65
                // invalid json is ignored
                else => break :res_json null,
            }
        }) |json| try_web: {
            const auth_url_str, _ = try json.getString(ctx.allocator, "authUrl") orelse break :try_web;

            // important to clone because it belongs to `response_buf`, and `response_buf` will be
            // reused with the following requests
            const done_url_str = try json.getStringCloned(ctx.allocator, "doneUrl") orelse break :try_web;
            const done_url = URL.parse(done_url_str);

            Output.prettyln("Authenticate your account at:\n{s}", .{auth_url_str});
            Output.flush();

            const auth_headers = try constructPublishHeaders(
                ctx.allocator,
                print_buf,
                registry,
                null,
                null,
                ctx.uses_workspaces,
            );

            while (true) {
                response_buf.reset();

                var done_req = http.AsyncHTTP.initSync(
                    ctx.allocator,
                    .GET,
                    done_url,
                    auth_headers.entries,
                    auth_headers.content.ptr.?[0..auth_headers.content.len],
                    response_buf,
                    "",
                    null,
                    null,
                    .follow,
                );

                const done_res = done_req.sendSync() catch |err| {
                    switch (err) {
                        error.OutOfMemory => |oom| return oom,
                        else => {
                            Output.err(err, "failed to send OTP request", .{});
                            Global.crash();
                        },
                    }
                };

                // std.debug.print("otp done res:\n{}\n", .{done_res});
                // std.debug.print("otp done res body:\n{s}\n", .{response_buf.list.items});

                switch (done_res.status_code) {
                    202 => {
                        // retry
                        const nanoseconds = nanoseconds: {
                            default: for (done_res.headers) |header| {
                                if (strings.eqlCaseInsensitiveASCII(header.name, "retry-after", true)) {
                                    const trimmed = strings.trim(header.value, &strings.whitespace_chars);
                                    const seconds = bun.fmt.parseInt(u32, trimmed, 10) catch break :default;
                                    break :nanoseconds seconds * std.time.ns_per_s;
                                }
                            }

                            break :nanoseconds 500 * std.time.ns_per_ms;
                        };

                        std.time.sleep(nanoseconds);
                        continue;
                    },
                    200 => {
                        // login successful
                        const otp_done_source = logger.Source.initPathString("???", response_buf.list.items);
                        const otp_done_json = JSON.parseJSONUTF8(&otp_done_source, ctx.manager.log, ctx.allocator) catch |err| {
                            switch (err) {
                                error.OutOfMemory => |oom| return oom,
                                else => {
                                    Output.err("WebLogin", "failed to parse response json", .{});
                                    Global.crash();
                                },
                            }
                        };

                        return try otp_done_json.getStringCloned(ctx.allocator, "token") orelse {
                            Output.err("WebLogin", "missing `token` field in reponse json", .{});
                            Global.crash();
                        };
                    },
                    else => |code| {
                        Output.err("WebLogin", "unexpected status code: {d}", .{code});
                        Global.crash();
                    },
                }
            }
        }

        // classic
        return prompt(ctx.allocator, "This operation requires a one-time password.\nEnter OTP: ", "") catch |err| {
            switch (err) {
                error.OutOfMemory => |oom| return oom,
                else => {
                    Output.err(err, "failed to read OTP input", .{});
                    Global.crash();
                },
            }
        };
    }

    fn constructPublishHeaders(
        allocator: std.mem.Allocator,
        print_buf: *std.ArrayListUnmanaged(u8),
        registry: *const Npm.Registry.Scope,
        maybe_json_len: ?usize,
        maybe_otp: ?[]const u8,
        uses_workspaces: bool,
    ) OOM!http.HeaderBuilder {
        var print_writer = print_buf.writer(allocator);
        var headers: http.HeaderBuilder = .{};
        const npm_auth_type = if (maybe_otp == null) "web" else "legacy";
        const ci_name = bun.detectCI();

        {
            headers.count("accept", "*/*");
            headers.count("accept-encoding", "gzip,deflate");

            if (registry.token.len > 0) {
                try print_writer.print("Bearer {s}", .{registry.token});
                headers.count("authorization", print_buf.items);
                print_buf.clearRetainingCapacity();
            } else if (registry.auth.len > 0) {
                try print_writer.print("Basic {s}", .{registry.auth});
                headers.count("authorization", print_buf.items);
                print_buf.clearRetainingCapacity();
            }

            if (maybe_json_len != null) {
                headers.count("content-type", MimeType.json.value);
            }

            headers.count("npm-auth-type", npm_auth_type);
            if (maybe_otp) |otp| {
                headers.count("npm-otp", otp);
            }
            headers.count("npm-command", "publish");

            try print_writer.print("{s} {s} {s} workspaces/{}{s}{s}", .{
                Global.user_agent,
                Global.os_name,
                Global.arch_name,
                uses_workspaces,
                if (ci_name != null) " ci/" else "",
                ci_name orelse "",
            });
            // headers.count("user-agent", "npm/10.8.3 node/v22.6.0 darwin arm64 workspaces/false");
            headers.count("user-agent", print_buf.items);
            print_buf.clearRetainingCapacity();

            headers.count("Connection", "keep-alive");
            headers.count("Host", registry.url.host);

            if (maybe_json_len) |json_len| {
                try print_writer.print("{d}", .{json_len});
                headers.count("Content-Length", print_buf.items);
                print_buf.clearRetainingCapacity();
            }
        }

        try headers.allocate(allocator);

        {
            headers.append("accept", "*/*");
            headers.append("accept-encoding", "gzip,deflate");

            if (registry.token.len > 0) {
                try print_writer.print("Bearer {s}", .{registry.token});
                headers.append("authorization", print_buf.items);
                print_buf.clearRetainingCapacity();
            } else if (registry.auth.len > 0) {
                try print_writer.print("Basic {s}", .{registry.auth});
                headers.append("authorization", print_buf.items);
                print_buf.clearRetainingCapacity();
            }

            if (maybe_json_len != null) {
                headers.append("content-type", MimeType.json.value);
            }

            headers.append("npm-auth-type", npm_auth_type);
            if (maybe_otp) |otp| {
                headers.append("npm-otp", otp);
            }
            headers.append("npm-command", "publish");

            try print_writer.print("{s} {s} {s} workspaces/{}{s}{s}", .{
                Global.user_agent,
                Global.os_name,
                Global.arch_name,
                uses_workspaces,
                if (ci_name != null) " ci/" else "",
                ci_name orelse "",
            });
            // headers.append("user-agent", "npm/10.8.3 node/v22.6.0 darwin arm64 workspaces/false");
            headers.append("user-agent", print_buf.items);
            print_buf.clearRetainingCapacity();

            headers.append("Connection", "keep-alive");
            headers.append("Host", registry.url.host);

            if (maybe_json_len) |json_len| {
                try print_writer.print("{d}", .{json_len});
                headers.append("Content-Length", print_buf.items);
                print_buf.clearRetainingCapacity();
            }
        }

        return headers;
    }

    fn constructPublishRequestBody(
        comptime directory_publish: bool,
        ctx: *const Context(directory_publish),
        registry: *const Npm.Registry.Scope,
    ) OOM![]const u8 {
        const tag = if (ctx.manager.options.publish_config.tag.len > 0)
            ctx.manager.options.publish_config.tag
        else
            "latest";

        const encoded_tarball_len = std.base64.standard.Encoder.calcSize(ctx.tarball_bytes.len);

        var buf = try std.ArrayListUnmanaged(u8).initCapacity(
            ctx.allocator,
            ctx.package_name.len * 5 +
                ctx.package_version.len * 4 +
                ctx.abs_tarball_path.len +
                encoded_tarball_len,
        );
        var writer = buf.writer(ctx.allocator);

        try writer.print("{{\"_id\":\"{s}\",\"name\":\"{s}\"", .{
            ctx.package_name,
            ctx.package_name,
        });

        try writer.print(",\"dist-tags\":{{\"{s}\":\"{s}\"}}", .{
            tag,
            ctx.package_version,
        });

        // "versions"
        {
            try writer.print(",\"versions\":{{\"{s}\":{{\"name\":\"{s}\",\"version\":\"{s}\"", .{
                ctx.package_version,
                ctx.package_name,
                ctx.package_version,
            });

            try writer.print(",\"_id\": \"{s}@{s}\"", .{
                ctx.package_name,
                ctx.package_version,
            });

            try writer.print(",\"_integrity\":\"{}\"", .{
                bun.fmt.integrity(ctx.integrity, .full),
            });

            try writer.print(",\"_nodeVersion\":\"{s}\",\"_npmVersion\":\"{s}\"", .{
                Environment.reported_nodejs_version,
                // TODO: npm version
                "10.8.3",
            });

            try writer.print(",\"dist\":{{\"integrity\":\"{}\",\"shasum\":\"{s}\"", .{
                bun.fmt.integrity(ctx.integrity, .full),
                bun.fmt.bytesToHex(ctx.shasum, .lower),
            });

            // https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/workspaces/libnpmpublish/lib/publish.js#L118
            // https:// -> http://
            try writer.print(",\"tarball\":\"http://{s}/{s}/-/{s}\"}}}}}}", .{
                strings.withoutTrailingSlash(registry.url.href),
                ctx.package_name,
                std.fs.path.basename(ctx.abs_tarball_path),
            });
        }

        if (ctx.manager.options.publish_config.access) |access| {
            try writer.print(",\"access\":\"{s}\"", .{@tagName(access)});
        } else {
            try writer.writeAll(",\"access\":null");
        }

        // "_attachments"
        {
            try writer.print(",\"_attachments\":{{\"{s}\":{{\"content_type\":\"{s}\",\"data\":\"", .{
                std.fs.path.basename(ctx.abs_tarball_path),
                "application/octet-stream",
            });

            try buf.ensureUnusedCapacity(ctx.allocator, encoded_tarball_len);
            buf.items.len += encoded_tarball_len;
            const count = bun.simdutf.base64.encode(ctx.tarball_bytes, buf.items[buf.items.len - encoded_tarball_len ..], false);
            bun.assertWithLocation(count == encoded_tarball_len, @src());

            try writer.print("\",\"length\":{d}}}}}}}", .{
                ctx.tarball_bytes.len,
            });
        }

        return buf.items;
    }

    fn handleResponseErrors(status_code: u32) noreturn {
        _ = status_code;
        Output.errGeneric("oops", .{});
        Global.crash();
    }
};