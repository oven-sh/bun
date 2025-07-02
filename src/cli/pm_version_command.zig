const std = @import("std");
const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const strings = bun.strings;
const string = bun.string;
const Command = bun.CLI.Command;
const PackageManager = bun.install.PackageManager;
const Semver = bun.Semver;
const logger = bun.logger;
const JSON = bun.JSON;
const RunCommand = bun.RunCommand;

pub const PmVersionCommand = struct {
    const VersionType = enum {
        patch,
        minor,
        major,
        prepatch,
        preminor,
        premajor,
        prerelease,
        specific,
        from_git,

        pub fn fromString(str: []const u8) ?VersionType {
            if (strings.eqlComptime(str, "patch")) return .patch;
            if (strings.eqlComptime(str, "minor")) return .minor;
            if (strings.eqlComptime(str, "major")) return .major;
            if (strings.eqlComptime(str, "prepatch")) return .prepatch;
            if (strings.eqlComptime(str, "preminor")) return .preminor;
            if (strings.eqlComptime(str, "premajor")) return .premajor;
            if (strings.eqlComptime(str, "prerelease")) return .prerelease;
            if (strings.eqlComptime(str, "from-git")) return .from_git;
            return null;
        }
    };

    pub fn exec(ctx: Command.Context, pm: *PackageManager, positionals: []const string, original_cwd: []const u8) !void {
        const package_json_dir = try findPackageDir(ctx.allocator, original_cwd);

        if (positionals.len <= 1) {
            try showHelp(ctx, pm, package_json_dir);
            return;
        }

        const version_type, const new_version = parseVersionArgument(positionals[1]);

        try verifyGit(package_json_dir, pm);

        var path_buf: bun.PathBuffer = undefined;
        const package_json_path = bun.path.joinAbsStringBufZ(package_json_dir, &path_buf, &.{"package.json"}, .auto);

        const package_json_contents = bun.sys.File.readFrom(bun.FD.cwd(), package_json_path, ctx.allocator).unwrap() catch |err| {
            Output.errGeneric("Failed to read package.json: {s}", .{@errorName(err)});
            Global.exit(1);
        };
        defer ctx.allocator.free(package_json_contents);

        const package_json_source = logger.Source.initPathString(package_json_path, package_json_contents);
        const json = JSON.parsePackageJSONUTF8(&package_json_source, ctx.log, ctx.allocator) catch |err| {
            Output.errGeneric("Failed to parse package.json: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        const scripts = json.asProperty("scripts");
        const scripts_obj = if (scripts) |s| if (s.expr.data == .e_object) s.expr else null else null;

        if (pm.options.do.run_scripts) {
            if (scripts_obj) |s| {
                if (s.get("preversion")) |script| {
                    if (script.asString(ctx.allocator)) |script_command| {
                        try RunCommand.runPackageScriptForeground(
                            ctx,
                            ctx.allocator,
                            script_command,
                            "preversion",
                            package_json_dir,
                            pm.env,
                            &.{},
                            pm.options.log_level == .silent,
                            ctx.debug.use_system_shell,
                        );
                    }
                }
            }
        }

        const current_version = brk_version: {
            if (json.asProperty("version")) |v| {
                switch (v.expr.data) {
                    .e_string => |s| {
                        break :brk_version s.data;
                    },
                    else => {},
                }
            }
            Output.errGeneric("No version field found in package.json", .{});
            Global.exit(1);
        };

        const new_version_str = try calculateNewVersion(ctx.allocator, current_version, version_type, new_version, pm.options.preid, package_json_dir);
        defer ctx.allocator.free(new_version_str);

        if (!pm.options.allow_same_version and strings.eql(current_version, new_version_str)) {
            Output.errGeneric("Version not changed", .{});
            Global.exit(1);
        }

        {
            const updated_contents = try updateVersionString(ctx.allocator, package_json_contents, current_version, new_version_str);
            defer ctx.allocator.free(updated_contents);

            const file = std.fs.cwd().openFile(package_json_path, .{ .mode = .write_only }) catch |err| {
                Output.errGeneric("Failed to open package.json for writing: {s}", .{@errorName(err)});
                Global.exit(1);
            };
            defer file.close();

            try file.seekTo(0);
            try file.setEndPos(0);
            try file.writeAll(updated_contents);
        }

        if (pm.options.do.run_scripts) {
            if (scripts_obj) |s| {
                if (s.get("version")) |script| {
                    if (script.asString(ctx.allocator)) |script_command| {
                        try RunCommand.runPackageScriptForeground(
                            ctx,
                            ctx.allocator,
                            script_command,
                            "version",
                            package_json_dir,
                            pm.env,
                            &.{},
                            pm.options.log_level == .silent,
                            ctx.debug.use_system_shell,
                        );
                    }
                }
            }
        }

        if (pm.options.git_tag_version) {
            try gitCommitAndTag(ctx.allocator, new_version_str, pm.options.message, package_json_dir);
        }

        if (pm.options.do.run_scripts) {
            if (scripts_obj) |s| {
                if (s.get("postversion")) |script| {
                    if (script.asString(ctx.allocator)) |script_command| {
                        try RunCommand.runPackageScriptForeground(
                            ctx,
                            ctx.allocator,
                            script_command,
                            "postversion",
                            package_json_dir,
                            pm.env,
                            &.{},
                            pm.options.log_level == .silent,
                            ctx.debug.use_system_shell,
                        );
                    }
                }
            }
        }

        Output.println("v{s}", .{new_version_str});
        Output.flush();
    }

    fn findPackageDir(allocator: std.mem.Allocator, start_dir: []const u8) bun.OOM![]const u8 {
        var path_buf: bun.PathBuffer = undefined;
        var current_dir = start_dir;

        while (true) {
            const package_json_path_z = bun.path.joinAbsStringBufZ(current_dir, &path_buf, &.{"package.json"}, .auto);
            if (bun.FD.cwd().existsAt(package_json_path_z)) {
                return try allocator.dupe(u8, current_dir);
            }

            const parent = bun.path.dirname(current_dir, .auto);
            if (strings.eql(parent, current_dir)) {
                break;
            }
            current_dir = parent;
        }

        return try allocator.dupe(u8, start_dir);
    }

    fn verifyGit(cwd: []const u8, pm: *PackageManager) !void {
        if (!pm.options.git_tag_version) return;

        var path_buf: bun.PathBuffer = undefined;
        const git_dir_path = bun.path.joinAbsStringBuf(cwd, &path_buf, &.{".git"}, .auto);
        if (!bun.FD.cwd().directoryExistsAt(git_dir_path).isTrue()) {
            pm.options.git_tag_version = false;
            return;
        }

        if (!try isGitClean(cwd) and !pm.options.force) {
            Output.errGeneric("Git working directory not clean.", .{});
            Global.exit(1);
        }
    }

    fn parseVersionArgument(arg: []const u8) struct { VersionType, ?[]const u8 } {
        if (VersionType.fromString(arg)) |vtype| {
            return .{ vtype, null };
        }

        const version = Semver.Version.parse(Semver.SlicedString.init(arg, arg));
        if (version.valid) {
            return .{ .specific, arg };
        }

        Output.errGeneric("Invalid version argument: \"{s}\"", .{arg});
        Output.note("Valid options: patch, minor, major, prepatch, preminor, premajor, prerelease, from-git, or a specific semver version", .{});
        Global.exit(1);
    }

    fn getCurrentVersion(ctx: Command.Context, cwd: []const u8) ?[]const u8 {
        var path_buf: bun.PathBuffer = undefined;
        const package_json_path = bun.path.joinAbsStringBufZ(cwd, &path_buf, &.{"package.json"}, .auto);

        const package_json_contents = bun.sys.File.readFrom(bun.FD.cwd(), package_json_path, ctx.allocator).unwrap() catch {
            return null;
        };

        const package_json_source = logger.Source.initPathString(package_json_path, package_json_contents);
        const json = JSON.parsePackageJSONUTF8(&package_json_source, ctx.log, ctx.allocator) catch {
            return null;
        };

        if (json.asProperty("version")) |v| {
            switch (v.expr.data) {
                .e_string => |s| {
                    return s.data;
                },
                else => {},
            }
        }

        return null;
    }

    fn showHelp(ctx: Command.Context, pm: *PackageManager, cwd: []const u8) bun.OOM!void {
        const _current_version = getCurrentVersion(ctx, cwd);
        const current_version = _current_version orelse "1.0.0";

        Output.prettyln("<r><b>bun pm version<r> <d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        if (_current_version) |version| {
            Output.prettyln("Current package version: <green>v{s}<r>", .{version});
        }

        const increment_help_text =
            \\
            \\<b>Increment<r>:
            \\  <cyan>patch<r>      <d>{s} → {s}<r>
            \\  <cyan>minor<r>      <d>{s} → {s}<r>
            \\  <cyan>major<r>      <d>{s} → {s}<r>
            \\  <cyan>prerelease<r> <d>{s} → {s}<r> 
            \\
        ;
        Output.pretty(increment_help_text, .{
            current_version, try calculateNewVersion(ctx.allocator, current_version, .patch, null, pm.options.preid, cwd),
            current_version, try calculateNewVersion(ctx.allocator, current_version, .minor, null, pm.options.preid, cwd),
            current_version, try calculateNewVersion(ctx.allocator, current_version, .major, null, pm.options.preid, cwd),
            current_version, try calculateNewVersion(ctx.allocator, current_version, .prerelease, null, pm.options.preid, cwd),
        });

        if (strings.indexOfChar(current_version, '-') != null or pm.options.preid.len > 0) {
            const prerelease_help_text =
                \\  <cyan>prepatch<r>   <d>{s} → {s}<r>
                \\  <cyan>preminor<r>   <d>{s} → {s}<r>
                \\  <cyan>premajor<r>   <d>{s} → {s}<r>
                \\
            ;
            Output.pretty(prerelease_help_text, .{
                current_version, try calculateNewVersion(ctx.allocator, current_version, .prepatch, null, pm.options.preid, cwd),
                current_version, try calculateNewVersion(ctx.allocator, current_version, .preminor, null, pm.options.preid, cwd),
                current_version, try calculateNewVersion(ctx.allocator, current_version, .premajor, null, pm.options.preid, cwd),
            });
        }

        const set_specific_version_help_text =
            \\  <cyan>from-git<r>   <d>Use version from latest git tag<r>
            \\  <blue>1.2.3<r>      <d>Set specific version<r>
            \\
            \\<b>Options<r>:
            \\  <cyan>--no-git-tag-version<r> <d>Skip git operations<r>
            \\  <cyan>--allow-same-version<r> <d>Prevents throwing error if version is the same<r>
            \\  <cyan>--message<d>=\<val\><r>, <cyan>-m<r>  <d>Custom commit message<r>
            \\  <cyan>--preid<d>=\<val\><r>        <d>Prerelease identifier<r>
            \\
            \\<b>Examples<r>:
            \\  <d>$<r> <b><green>bun pm version<r> <cyan>patch<r>
            \\  <d>$<r> <b><green>bun pm version<r> <blue>1.2.3<r> <cyan>--no-git-tag-version<r>
            \\  <d>$<r> <b><green>bun pm version<r> <cyan>prerelease<r> <cyan>--preid<r> <blue>beta<r>
            \\
            \\More info: <magenta>https://bun.sh/docs/cli/pm#version<r>
            \\
        ;
        Output.pretty(set_specific_version_help_text, .{});
        Output.flush();
    }

    fn updateVersionString(allocator: std.mem.Allocator, contents: []const u8, old_version: []const u8, new_version: []const u8) ![]const u8 {
        const version_key = "\"version\"";

        var search_start: usize = 0;
        while (std.mem.indexOfPos(u8, contents, search_start, version_key)) |key_pos| {
            var colon_pos = key_pos + version_key.len;
            while (colon_pos < contents.len and (contents[colon_pos] == ' ' or contents[colon_pos] == '\t')) {
                colon_pos += 1;
            }

            if (colon_pos >= contents.len or contents[colon_pos] != ':') {
                search_start = key_pos + 1;
                continue;
            }

            colon_pos += 1;
            while (colon_pos < contents.len and (contents[colon_pos] == ' ' or contents[colon_pos] == '\t')) {
                colon_pos += 1;
            }

            if (colon_pos >= contents.len or contents[colon_pos] != '"') {
                search_start = key_pos + 1;
                continue;
            }

            const value_start = colon_pos + 1;

            var value_end = value_start;
            while (value_end < contents.len and contents[value_end] != '"') {
                if (contents[value_end] == '\\' and value_end + 1 < contents.len) {
                    value_end += 2;
                } else {
                    value_end += 1;
                }
            }

            if (value_end >= contents.len) {
                search_start = key_pos + 1;
                continue;
            }

            const current_value = contents[value_start..value_end];
            if (strings.eql(current_value, old_version)) {
                var result = std.ArrayList(u8).init(allocator);
                try result.appendSlice(contents[0..value_start]);
                try result.appendSlice(new_version);
                try result.appendSlice(contents[value_end..]);
                return result.toOwnedSlice();
            }

            search_start = value_end + 1;
        }

        Output.errGeneric("Version not found in package.json", .{});
        Global.exit(1);
    }

    fn calculateNewVersion(allocator: std.mem.Allocator, current_str: []const u8, version_type: VersionType, specific_version: ?[]const u8, preid: []const u8, cwd: []const u8) bun.OOM![]const u8 {
        if (version_type == .specific) {
            return try allocator.dupe(u8, specific_version.?);
        }

        if (version_type == .from_git) {
            return try getVersionFromGit(allocator, cwd);
        }

        const current = Semver.Version.parse(Semver.SlicedString.init(current_str, current_str));
        if (!current.valid) {
            Output.errGeneric("Current version \"{s}\" is not a valid semver", .{current_str});
            Global.exit(1);
        }

        const prerelease_id: []const u8 = if (preid.len > 0)
            try allocator.dupe(u8, preid)
        else if (!current.version.tag.hasPre())
            try allocator.dupe(u8, "")
        else blk: {
            const current_prerelease = current.version.tag.pre.slice(current_str);

            if (strings.indexOfChar(current_prerelease, '.')) |dot_index| {
                break :blk try allocator.dupe(u8, current_prerelease[0..dot_index]);
            }

            break :blk if (std.fmt.parseInt(u32, current_prerelease, 10)) |_|
                try allocator.dupe(u8, "")
            else |_|
                try allocator.dupe(u8, current_prerelease);
        };
        defer allocator.free(prerelease_id);

        return try incrementVersion(allocator, current_str, current, version_type, prerelease_id);
    }

    fn incrementVersion(allocator: std.mem.Allocator, current_str: []const u8, current: Semver.Version.ParseResult, version_type: VersionType, preid: []const u8) bun.OOM![]const u8 {
        var new_version = current.version.min();

        switch (version_type) {
            .patch => {
                return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}", .{ new_version.major, new_version.minor, new_version.patch + 1 });
            },
            .minor => {
                return try std.fmt.allocPrint(allocator, "{d}.{d}.0", .{ new_version.major, new_version.minor + 1 });
            },
            .major => {
                return try std.fmt.allocPrint(allocator, "{d}.0.0", .{new_version.major + 1});
            },
            .prepatch => {
                if (preid.len > 0) {
                    return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}-{s}.0", .{ new_version.major, new_version.minor, new_version.patch + 1, preid });
                } else {
                    return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}-0", .{ new_version.major, new_version.minor, new_version.patch + 1 });
                }
            },
            .preminor => {
                if (preid.len > 0) {
                    return try std.fmt.allocPrint(allocator, "{d}.{d}.0-{s}.0", .{ new_version.major, new_version.minor + 1, preid });
                } else {
                    return try std.fmt.allocPrint(allocator, "{d}.{d}.0-0", .{ new_version.major, new_version.minor + 1 });
                }
            },
            .premajor => {
                if (preid.len > 0) {
                    return try std.fmt.allocPrint(allocator, "{d}.0.0-{s}.0", .{ new_version.major + 1, preid });
                } else {
                    return try std.fmt.allocPrint(allocator, "{d}.0.0-0", .{new_version.major + 1});
                }
            },
            .prerelease => {
                if (current.version.tag.hasPre()) {
                    const current_prerelease = current.version.tag.pre.slice(current_str);
                    const identifier = if (preid.len > 0) preid else current_prerelease;

                    if (strings.lastIndexOfChar(current_prerelease, '.')) |dot_index| {
                        const number_str = current_prerelease[dot_index + 1 ..];
                        const next_num = std.fmt.parseInt(u32, number_str, 10) catch 0;
                        return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}-{s}.{d}", .{ new_version.major, new_version.minor, new_version.patch, identifier, next_num + 1 });
                    } else {
                        const num = std.fmt.parseInt(u32, current_prerelease, 10) catch null;
                        if (num) |n| {
                            if (preid.len > 0) {
                                return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}-{s}.{d}", .{ new_version.major, new_version.minor, new_version.patch, preid, n + 1 });
                            } else {
                                return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}-{d}", .{ new_version.major, new_version.minor, new_version.patch, n + 1 });
                            }
                        } else {
                            return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}-{s}.1", .{ new_version.major, new_version.minor, new_version.patch, identifier });
                        }
                    }
                } else {
                    new_version.patch += 1;
                    if (preid.len > 0) {
                        return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}-{s}.0", .{ new_version.major, new_version.minor, new_version.patch, preid });
                    } else {
                        return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}-0", .{ new_version.major, new_version.minor, new_version.patch });
                    }
                }
            },
            else => {},
        }
        return try std.fmt.allocPrint(allocator, "{d}.{d}.{d}", .{ new_version.major, new_version.minor, new_version.patch });
    }

    fn isGitClean(cwd: []const u8) bun.OOM!bool {
        var path_buf: bun.PathBuffer = undefined;
        const git_path = bun.which(&path_buf, bun.getenvZ("PATH") orelse "", cwd, "git") orelse {
            Output.errGeneric("git must be installed to use `bun pm version --git-tag-version`", .{});
            Global.exit(1);
        };

        const proc = bun.spawnSync(&.{
            .argv = &.{ git_path, "status", "--porcelain" },
            .stdout = .buffer,
            .stderr = .ignore,
            .stdin = .ignore,
            .cwd = cwd,
            .envp = null,
        }) catch return false;

        switch (proc) {
            .err => |err| {
                Output.err(err, "Failed to spawn git process", .{});
                return false;
            },
            .result => |result| {
                return result.isOK() and result.stdout.items.len == 0;
            },
        }
    }

    fn getVersionFromGit(allocator: std.mem.Allocator, cwd: []const u8) bun.OOM![]const u8 {
        var path_buf: bun.PathBuffer = undefined;
        const git_path = bun.which(&path_buf, bun.getenvZ("PATH") orelse "", cwd, "git") orelse {
            Output.errGeneric("git must be installed to use `bun pm version from-git`", .{});
            Global.exit(1);
        };

        const proc = bun.spawnSync(&.{
            .argv = &.{ git_path, "describe", "--tags", "--abbrev=0" },
            .stdout = .buffer,
            .stderr = .buffer,
            .stdin = .ignore,
            .cwd = cwd,
            .envp = null,
        }) catch |err| {
            Output.err(err, "Failed to spawn git process", .{});
            Global.exit(1);
        };

        switch (proc) {
            .err => |err| {
                Output.err(err, "Git command failed unexpectedly", .{});
                Global.exit(1);
            },
            .result => |result| {
                if (!result.isOK()) {
                    if (result.stderr.items.len > 0) {
                        Output.errGeneric("Git error: {s}", .{strings.trim(result.stderr.items, " \n\r\t")});
                    } else {
                        Output.errGeneric("No git tags found", .{});
                    }
                    Global.exit(1);
                }

                var version_str = strings.trim(result.stdout.items, " \n\r\t");
                if (strings.startsWith(version_str, "v")) {
                    version_str = version_str[1..];
                }

                return try allocator.dupe(u8, version_str);
            },
        }
    }

    fn gitCommitAndTag(allocator: std.mem.Allocator, version: []const u8, custom_message: ?[]const u8, cwd: []const u8) bun.OOM!void {
        var path_buf: bun.PathBuffer = undefined;
        const git_path = bun.which(&path_buf, bun.getenvZ("PATH") orelse "", cwd, "git") orelse {
            Output.errGeneric("git must be installed to use `bun pm version --git-tag-version`", .{});
            Global.exit(1);
        };

        const stage_proc = bun.spawnSync(&.{
            .argv = &.{ git_path, "add", "package.json" },
            .cwd = cwd,
            .stdout = .buffer,
            .stderr = .buffer,
            .stdin = .ignore,
            .envp = null,
        }) catch |err| {
            Output.errGeneric("Git add failed: {s}", .{@errorName(err)});
            return;
        };

        switch (stage_proc) {
            .err => |err| {
                Output.err(err, "Git add failed unexpectedly", .{});
                return;
            },
            .result => |result| {
                if (!result.isOK()) {
                    Output.errGeneric("Git add failed with exit code {d}", .{result.status.exited.code});
                    return;
                }
            },
        }

        const commit_message = custom_message orelse try std.fmt.allocPrint(allocator, "v{s}", .{version});
        defer if (custom_message == null) allocator.free(commit_message);

        const commit_proc = bun.spawnSync(&.{
            .argv = &.{ git_path, "commit", "-m", commit_message },
            .cwd = cwd,
            .stdout = .buffer,
            .stderr = .buffer,
            .stdin = .ignore,
            .envp = null,
        }) catch |err| {
            Output.errGeneric("Git commit failed: {s}", .{@errorName(err)});
            return;
        };

        switch (commit_proc) {
            .err => |err| {
                Output.err(err, "Git commit failed unexpectedly", .{});
                return;
            },
            .result => |result| {
                if (!result.isOK()) {
                    Output.errGeneric("Git commit failed", .{});
                    return;
                }
            },
        }

        const tag_name = try std.fmt.allocPrint(allocator, "v{s}", .{version});
        defer allocator.free(tag_name);

        const tag_proc = bun.spawnSync(&.{
            .argv = &.{ git_path, "tag", "-a", tag_name, "-m", tag_name },
            .cwd = cwd,
            .stdout = .buffer,
            .stderr = .buffer,
            .stdin = .ignore,
            .envp = null,
        }) catch |err| {
            Output.errGeneric("Git tag failed: {s}", .{@errorName(err)});
            return;
        };

        switch (tag_proc) {
            .err => |err| {
                Output.err(err, "Git tag failed unexpectedly", .{});
                return;
            },
            .result => |result| {
                if (!result.isOK()) {
                    Output.errGeneric("Git tag failed", .{});
                    return;
                }
            },
        }
    }
};
