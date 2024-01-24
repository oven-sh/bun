const bun = @import("root").bun;
const Global = bun.Global;
const logger = bun.logger;
const Dependency = @import("./dependency.zig");
const DotEnv = @import("../env_loader.zig");
const Environment = @import("../env.zig");
const FileSystem = @import("../fs.zig").FileSystem;
const Install = @import("./install.zig");
const ExtractData = Install.ExtractData;
const PackageManager = Install.PackageManager;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const std = @import("std");
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const GitSHA = String;
const Path = bun.path;

threadlocal var final_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
threadlocal var folder_name_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
threadlocal var json_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

pub const Repository = extern struct {
    owner: String = .{},
    repo: String = .{},
    committish: GitSHA = .{},
    resolved: GitSHA = .{},
    package_name: String = .{},

    pub const Hosts = bun.ComptimeStringMap(string, .{
        .{ "bitbucket", ".org" },
        .{ "github", ".com" },
        .{ "gitlab", ".com" },
    });

    pub fn order(lhs: *const Repository, rhs: *const Repository, lhs_buf: []const u8, rhs_buf: []const u8) std.math.Order {
        const owner_order = lhs.owner.order(&rhs.owner, lhs_buf, rhs_buf);
        if (owner_order != .eq) return owner_order;
        const repo_order = lhs.repo.order(&rhs.repo, lhs_buf, rhs_buf);
        if (repo_order != .eq) return repo_order;

        return lhs.committish.order(&rhs.committish, lhs_buf, rhs_buf);
    }

    pub fn count(this: *const Repository, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
        builder.count(this.owner.slice(buf));
        builder.count(this.repo.slice(buf));
        builder.count(this.committish.slice(buf));
        builder.count(this.resolved.slice(buf));
        builder.count(this.package_name.slice(buf));
    }

    pub fn clone(this: *const Repository, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) Repository {
        return .{
            .owner = builder.append(String, this.owner.slice(buf)),
            .repo = builder.append(String, this.repo.slice(buf)),
            .committish = builder.append(GitSHA, this.committish.slice(buf)),
            .resolved = builder.append(String, this.resolved.slice(buf)),
            .package_name = builder.append(String, this.package_name.slice(buf)),
        };
    }

    pub fn eql(lhs: *const Repository, rhs: *const Repository, lhs_buf: []const u8, rhs_buf: []const u8) bool {
        if (!lhs.owner.eql(rhs.owner, lhs_buf, rhs_buf)) return false;
        if (!lhs.repo.eql(rhs.repo, lhs_buf, rhs_buf)) return false;
        if (lhs.resolved.isEmpty() or rhs.resolved.isEmpty()) return lhs.committish.eql(rhs.committish, lhs_buf, rhs_buf);
        return lhs.resolved.eql(rhs.resolved, lhs_buf, rhs_buf);
    }

    pub fn formatAs(this: *const Repository, label: string, buf: []const u8, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        const formatter = Formatter{ .label = label, .repository = this, .buf = buf };
        return try formatter.format(layout, opts, writer);
    }

    pub const Formatter = struct {
        label: []const u8 = "",
        buf: []const u8,
        repository: *const Repository,
        pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (comptime Environment.allow_assert) std.debug.assert(formatter.label.len > 0);
            try writer.writeAll(formatter.label);

            const repo = formatter.repository.repo.slice(formatter.buf);
            if (!formatter.repository.owner.isEmpty()) {
                try writer.writeAll(formatter.repository.owner.slice(formatter.buf));
                try writer.writeAll("/");
            } else if (Dependency.isSCPLikePath(repo)) {
                try writer.writeAll("ssh://");
            }
            try writer.writeAll(repo);

            if (!formatter.repository.resolved.isEmpty()) {
                try writer.writeAll("#");
                var resolved = formatter.repository.resolved.slice(formatter.buf);
                if (strings.lastIndexOfChar(resolved, '-')) |i| {
                    resolved = resolved[i + 1 ..];
                }
                try writer.writeAll(resolved);
            } else if (!formatter.repository.committish.isEmpty()) {
                try writer.writeAll("#");
                try writer.writeAll(formatter.repository.committish.slice(formatter.buf));
            }
        }
    };

    fn exec(
        allocator: std.mem.Allocator,
        env: *DotEnv.Loader,
        cwd: if (Environment.isWindows) string else std.fs.Dir,
        argv: []const string,
    ) !string {
        var buf_map = try env.map.cloneToEnvMap(allocator);

        const result = if (comptime Environment.isWindows)
            try std.ChildProcess.run(.{
                .allocator = allocator,
                .argv = argv,
                // windows `std.ChildProcess.run` uses `cwd` instead of `cwd_dir`
                .cwd = cwd,
                .env_map = &buf_map,
            })
        else
            try std.ChildProcess.run(.{
                .allocator = allocator,
                .argv = argv,
                .cwd_dir = cwd,

                .env_map = &buf_map,
            });

        switch (result.term) {
            .Exited => |sig| if (sig == 0) return result.stdout,
            else => {},
        }
        return error.InstallFailed;
    }

    pub fn tryHTTPS(url: string) ?string {
        if (strings.hasPrefixComptime(url, "ssh://")) {
            final_path_buf[0.."https".len].* = "https".*;
            bun.copy(u8, final_path_buf["https".len..], url["ssh".len..]);
            return final_path_buf[0 .. url.len - "ssh".len + "https".len];
        }

        if (Dependency.isSCPLikePath(url)) {
            final_path_buf[0.."https://".len].* = "https://".*;
            var rest = final_path_buf["https://".len..];

            const colon_index = strings.indexOfChar(url, ':');

            if (colon_index) |colon| {
                // make sure known hosts have `.com` or `.org`
                if (Hosts.get(url[0..colon])) |tld| {
                    bun.copy(u8, rest, url[0..colon]);
                    bun.copy(u8, rest[colon..], tld);
                    rest[colon + tld.len] = '/';
                    bun.copy(u8, rest[colon + tld.len + 1 ..], url[colon + 1 ..]);
                    return final_path_buf[0 .. url.len + "https://".len + tld.len];
                }
            }

            bun.copy(u8, rest, url);
            if (colon_index) |colon| rest[colon] = '/';
            return final_path_buf[0 .. url.len + "https://".len];
        }

        return null;
    }

    pub fn download(
        allocator: std.mem.Allocator,
        env: *DotEnv.Loader,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        task_id: u64,
        name: string,
        url: string,
    ) !std.fs.Dir {
        const folder_name = try std.fmt.bufPrintZ(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        });

        return if (cache_dir.openDirZ(folder_name, .{})) |dir| fetch: {
            const cwd = if (comptime Environment.isWindows)
                Path.joinAbsString(PackageManager.instance.cache_directory_path, &.{folder_name}, .windows)
            else
                dir;

            _ = exec(
                allocator,
                env,
                cwd,
                &[_]string{ "git", "fetch", "--quiet" },
            ) catch |err| {
                log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "\"git fetch\" for \"{s}\" failed",
                    .{name},
                ) catch unreachable;
                return err;
            };
            break :fetch dir;
        } else |not_found| clone: {
            if (not_found != error.FileNotFound) return not_found;

            const cwd = if (comptime Environment.isWindows)
                PackageManager.instance.cache_directory_path
            else
                cache_dir;

            _ = exec(allocator, env, cwd, &[_]string{
                "git",
                "clone",
                "--quiet",
                "--bare",
                url,
                folder_name,
            }) catch |err| {
                log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "\"git clone\" for \"{s}\" failed",
                    .{name},
                ) catch unreachable;
                return err;
            };
            break :clone try cache_dir.openDirZ(folder_name, .{});
        };
    }

    pub fn findCommit(
        allocator: std.mem.Allocator,
        env: *DotEnv.Loader,
        log: *logger.Log,
        repo_dir: std.fs.Dir,
        name: string,
        committish: string,
        task_id: u64,
    ) !string {
        const cwd = if (comptime Environment.isWindows)
            Path.joinAbsString(PackageManager.instance.cache_directory_path, &.{try std.fmt.bufPrint(&folder_name_buf, "{any}.git", .{
                bun.fmt.hexIntLower(task_id),
            })}, .windows)
        else
            repo_dir;

        return std.mem.trim(u8, exec(
            allocator,
            env,
            cwd,
            if (committish.len > 0)
                &[_]string{ "git", "log", "--format=%H", "-1", committish }
            else
                &[_]string{ "git", "log", "--format=%H", "-1" },
        ) catch |err| {
            log.addErrorFmt(
                null,
                logger.Loc.Empty,
                allocator,
                "no commit matching \"{s}\" found for \"{s}\" (but repository exists)",
                .{ committish, name },
            ) catch unreachable;
            return err;
        }, " \t\r\n");
    }

    pub fn checkout(
        allocator: std.mem.Allocator,
        env: *DotEnv.Loader,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        repo_dir: std.fs.Dir,
        name: string,
        url: string,
        resolved: string,
    ) !ExtractData {
        const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, resolved);

        var package_dir = cache_dir.openDirZ(folder_name, .{}) catch |not_found| brk: {
            if (not_found != error.FileNotFound) return not_found;

            var cwd = if (comptime Environment.isWindows)
                PackageManager.instance.cache_directory_path
            else
                cache_dir;

            _ = exec(allocator, env, cwd, &[_]string{
                "git",
                "clone",
                "--quiet",
                "--no-checkout",
                try bun.getFdPath(repo_dir.fd, &final_path_buf),
                folder_name,
            }) catch |err| {
                log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "\"git clone\" for \"{s}\" failed",
                    .{name},
                ) catch unreachable;
                return err;
            };

            var dir = try cache_dir.openDirZ(folder_name, .{});

            cwd = if (comptime Environment.isWindows)
                Path.joinAbsString(PackageManager.instance.cache_directory_path, &.{folder_name}, .windows)
            else
                dir;

            _ = exec(allocator, env, cwd, &[_]string{ "git", "checkout", "--quiet", resolved }) catch |err| {
                log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "\"git checkout\" for \"{s}\" failed",
                    .{name},
                ) catch unreachable;
                return err;
            };
            dir.deleteTree(".git") catch {};

            if (resolved.len > 0) insert_tag: {
                const git_tag = dir.createFileZ(".bun-tag", .{ .truncate = true }) catch break :insert_tag;
                defer git_tag.close();
                git_tag.writeAll(resolved) catch {
                    dir.deleteFileZ(".bun-tag") catch {};
                };
            }

            break :brk dir;
        };
        defer package_dir.close();

        const json_file = package_dir.openFileZ("package.json", .{ .mode = .read_only }) catch |err| {
            log.addErrorFmt(
                null,
                logger.Loc.Empty,
                allocator,
                "\"package.json\" for \"{s}\" failed to open: {s}",
                .{ name, @errorName(err) },
            ) catch unreachable;
            return error.InstallFailed;
        };
        defer json_file.close();
        const size = try json_file.getEndPos();
        const json_buf = try allocator.alloc(u8, size + 64);
        const json_len = try json_file.preadAll(json_buf, 0);

        const json_path = bun.getFdPath(
            json_file.handle,
            &json_path_buf,
        ) catch |err| {
            log.addErrorFmt(
                null,
                logger.Loc.Empty,
                allocator,
                "\"package.json\" for \"{s}\" failed to resolve: {s}",
                .{ name, @errorName(err) },
            ) catch unreachable;
            return error.InstallFailed;
        };

        const ret_json_path = try FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path);
        return .{
            .url = url,
            .resolved = resolved,
            .json_path = ret_json_path,
            .json_buf = json_buf,
            .json_len = json_len,
        };
    }
};
