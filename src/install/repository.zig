const bun = @import("bun");
const logger = bun.logger;
const Dependency = @import("./dependency.zig");
const DotEnv = @import("../env_loader.zig");
const Environment = @import("../env.zig");
const FileSystem = @import("../fs.zig").FileSystem;
const Install = @import("./install.zig");
const ExtractData = Install.ExtractData;
const PackageManager = Install.PackageManager;
const DependencyID = Install.DependencyID;
const Semver = bun.Semver;
const String = Semver.String;
const std = @import("std");
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const GitSHA = String;
const Path = bun.path;
const File = bun.sys.File;
const OOM = bun.OOM;
const Output = bun.Output;
const JSC = bun.JSC;

threadlocal var final_path_buf: bun.PathBuffer = undefined;
threadlocal var ssh_path_buf: bun.PathBuffer = undefined;
threadlocal var folder_name_buf: bun.PathBuffer = undefined;
threadlocal var json_path_buf: bun.PathBuffer = undefined;

const SloppyGlobalGitConfig = struct {
    has_askpass: bool = false,
    has_ssh_command: bool = false,

    var holder: SloppyGlobalGitConfig = .{};
    var load_and_parse_once = std.once(loadAndParse);

    pub fn get() SloppyGlobalGitConfig {
        load_and_parse_once.call();
        return holder;
    }

    pub fn loadAndParse() void {
        const home_dir_path = brk: {
            if (comptime Environment.isWindows) {
                if (bun.getenvZ("USERPROFILE")) |env|
                    break :brk env;
            } else {
                if (bun.getenvZ("HOME")) |env|
                    break :brk env;
            }

            // won't find anything
            return;
        };

        var config_file_path_buf: bun.PathBuffer = undefined;
        const config_file_path = bun.path.joinAbsStringBufZ(home_dir_path, &config_file_path_buf, &.{".gitconfig"}, .auto);
        var stack_fallback = std.heap.stackFallback(4096, bun.default_allocator);
        const allocator = stack_fallback.get();
        const source = File.toSource(config_file_path, allocator, .{ .convert_bom = true }).unwrap() catch {
            return;
        };
        defer allocator.free(source.contents);

        var remaining = bun.strings.split(source.contents, "\n");
        var found_askpass = false;
        var found_ssh_command = false;
        var @"[core]" = false;
        while (remaining.next()) |line_| {
            if (found_askpass and found_ssh_command) break;

            const line = strings.trim(line_, "\t \r");

            if (line.len == 0) continue;
            // skip comments
            if (line[0] == '#') continue;

            if (line[0] == '[') {
                if (strings.indexOfChar(line, ']')) |end_bracket| {
                    if (strings.eqlComptime(line[0 .. end_bracket + 1], "[core]")) {
                        @"[core]" = true;
                        continue;
                    }
                }
                @"[core]" = false;
                continue;
            }

            if (@"[core]") {
                if (!found_askpass) {
                    if (line.len > "askpass".len and strings.eqlCaseInsensitiveASCIIIgnoreLength(line[0.."askpass".len], "askpass") and switch (line["askpass".len]) {
                        ' ', '\t', '=' => true,
                        else => false,
                    }) {
                        found_askpass = true;
                        continue;
                    }
                }

                if (!found_ssh_command) {
                    if (line.len > "sshCommand".len and strings.eqlCaseInsensitiveASCIIIgnoreLength(line[0.."sshCommand".len], "sshCommand") and switch (line["sshCommand".len]) {
                        ' ', '\t', '=' => true,
                        else => false,
                    }) {
                        found_ssh_command = true;
                    }
                }
            } else {
                if (!found_askpass) {
                    if (line.len > "core.askpass".len and strings.eqlCaseInsensitiveASCIIIgnoreLength(line[0.."core.askpass".len], "core.askpass") and switch (line["core.askpass".len]) {
                        ' ', '\t', '=' => true,
                        else => false,
                    }) {
                        found_askpass = true;
                        continue;
                    }
                }

                if (!found_ssh_command) {
                    if (line.len > "core.sshCommand".len and strings.eqlCaseInsensitiveASCIIIgnoreLength(line[0.."core.sshCommand".len], "core.sshCommand") and switch (line["core.sshCommand".len]) {
                        ' ', '\t', '=' => true,
                        else => false,
                    }) {
                        found_ssh_command = true;
                    }
                }
            }
        }

        holder = .{
            .has_askpass = found_askpass,
            .has_ssh_command = found_ssh_command,
        };
    }
};

pub const Repository = extern struct {
    owner: String = .{},
    repo: String = .{},
    committish: GitSHA = .{},
    resolved: GitSHA = .{},
    package_name: String = .{},

    pub var shared_env: struct {
        env: ?DotEnv.Map = null,
        pub fn get(this: *@This(), allocator: std.mem.Allocator, other: *DotEnv.Loader) DotEnv.Map {
            return this.env orelse brk: {
                // Note: currently if the user sets this to some value that causes
                // a prompt for a password, the stdout of the prompt will be masked
                // by further output of the rest of the install process.
                // A value can still be entered, but we need to find a workaround
                // so the user can see what is being prompted. By default the settings
                // below will cause no prompt and throw instead.
                var cloned = other.map.cloneWithAllocator(allocator) catch bun.outOfMemory();

                if (cloned.get("GIT_ASKPASS") == null) {
                    const config = SloppyGlobalGitConfig.get();
                    if (!config.has_askpass) {
                        cloned.put("GIT_ASKPASS", "echo") catch bun.outOfMemory();
                    }
                }

                if (cloned.get("GIT_SSH_COMMAND") == null) {
                    const config = SloppyGlobalGitConfig.get();
                    if (!config.has_ssh_command) {
                        cloned.put("GIT_SSH_COMMAND", "ssh -oStrictHostKeyChecking=accept-new") catch bun.outOfMemory();
                    }
                }

                this.env = cloned;
                break :brk this.env.?;
            };
        }
    } = .{};

    pub const Hosts = bun.ComptimeStringMap(string, .{
        .{ "bitbucket", ".org" },
        .{ "github", ".com" },
        .{ "gitlab", ".com" },
    });

    pub fn parseAppendGit(input: string, buf: *String.Buf) OOM!Repository {
        var remain = input;
        if (strings.hasPrefixComptime(remain, "git+")) {
            remain = remain["git+".len..];
        }
        if (strings.lastIndexOfChar(remain, '#')) |hash| {
            return .{
                .repo = try buf.append(remain[0..hash]),
                .committish = try buf.append(remain[hash + 1 ..]),
            };
        }
        return .{
            .repo = try buf.append(remain),
        };
    }

    pub fn parseAppendGithub(input: string, buf: *String.Buf) OOM!Repository {
        var remain = input;
        if (strings.hasPrefixComptime(remain, "github:")) {
            remain = remain["github:".len..];
        }
        var hash: usize = 0;
        var slash: usize = 0;
        for (remain, 0..) |c, i| {
            switch (c) {
                '/' => slash = i,
                '#' => hash = i,
                else => {},
            }
        }

        const repo = if (hash == 0) remain[slash + 1 ..] else remain[slash + 1 .. hash];

        var result: Repository = .{
            .owner = try buf.append(remain[0..slash]),
            .repo = try buf.append(repo),
        };

        if (hash != 0) {
            result.committish = try buf.append(remain[hash + 1 ..]);
        }

        return result;
    }

    pub fn createDependencyNameFromVersionLiteral(
        allocator: std.mem.Allocator,
        repository: *const Repository,
        lockfile: *Install.Lockfile,
        dep_id: Install.DependencyID,
    ) []u8 {
        const buf = lockfile.buffers.string_bytes.items;
        const dep = lockfile.buffers.dependencies.items[dep_id];
        const repo_name = repository.repo;
        const repo_name_str = lockfile.str(&repo_name);

        const name = brk: {
            var remain = repo_name_str;

            if (strings.indexOfChar(remain, '#')) |hash_index| {
                remain = remain[0..hash_index];
            }

            if (remain.len == 0) break :brk remain;

            if (strings.lastIndexOfChar(remain, '/')) |slash_index| {
                remain = remain[slash_index + 1 ..];
            }

            break :brk remain;
        };

        if (name.len == 0) {
            const version_literal = dep.version.literal.slice(buf);
            const name_buf = allocator.alloc(u8, bun.sha.EVP.SHA1.digest) catch bun.outOfMemory();
            var sha1 = bun.sha.SHA1.init();
            defer sha1.deinit();
            sha1.update(version_literal);
            sha1.final(name_buf[0..bun.sha.SHA1.digest]);
            return name_buf[0..bun.sha.SHA1.digest];
        }

        return allocator.dupe(u8, name) catch bun.outOfMemory();
    }

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

    pub fn fmt(this: *const Repository, label: string, buf: []const u8) Formatter {
        return .{
            .repository = this,
            .buf = buf,
            .label = label,
        };
    }

    pub const Formatter = struct {
        label: []const u8 = "",
        buf: []const u8,
        repository: *const Repository,
        pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (comptime Environment.allow_assert) bun.assert(formatter.label.len > 0);
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
        _env: DotEnv.Map,
        argv: []const string,
    ) !string {
        var env = _env;
        var std_map = try env.stdEnvMap(allocator);

        defer std_map.deinit();

        const result = if (comptime Environment.isWindows)
            try std.process.Child.run(.{
                .allocator = allocator,
                .argv = argv,
                .env_map = std_map.get(),
            })
        else
            try std.process.Child.run(.{
                .allocator = allocator,
                .argv = argv,
                .env_map = std_map.get(),
            });

        switch (result.term) {
            .Exited => |sig| if (sig == 0) return result.stdout else if (
            // remote: The page could not be found <-- for non git
            // remote: Repository not found. <-- for git
            // remote: fatal repository '<url>' does not exist <-- for git
            (strings.containsComptime(result.stderr, "remote:") and
                strings.containsComptime(result.stderr, "not") and
                strings.containsComptime(result.stderr, "found")) or
                strings.containsComptime(result.stderr, "does not exist"))
            {
                return error.RepositoryNotFound;
            },
            else => {},
        }

        return error.InstallFailed;
    }

    pub fn trySSH(url: string) ?string {
        // Do not cast explicit http(s) URLs to SSH
        if (strings.hasPrefixComptime(url, "http")) {
            return null;
        }

        if (strings.hasPrefixComptime(url, "git@") or strings.hasPrefixComptime(url, "ssh://")) {
            return url;
        }

        if (Dependency.isSCPLikePath(url)) {
            ssh_path_buf[0.."ssh://git@".len].* = "ssh://git@".*;
            var rest = ssh_path_buf["ssh://git@".len..];

            const colon_index = strings.indexOfChar(url, ':');

            if (colon_index) |colon| {
                // make sure known hosts have `.com` or `.org`
                if (Hosts.get(url[0..colon])) |tld| {
                    bun.copy(u8, rest, url[0..colon]);
                    bun.copy(u8, rest[colon..], tld);
                    rest[colon + tld.len] = '/';
                    bun.copy(u8, rest[colon + tld.len + 1 ..], url[colon + 1 ..]);
                    const out = ssh_path_buf[0 .. url.len + "ssh://git@".len + tld.len];
                    return out;
                }
            }

            bun.copy(u8, rest, url);
            if (colon_index) |colon| rest[colon] = '/';
            const final = ssh_path_buf[0 .. url.len + "ssh://".len];
            return final;
        }

        return null;
    }

    pub fn tryHTTPS(url: string) ?string {
        if (strings.hasPrefixComptime(url, "http")) {
            return url;
        }

        if (strings.hasPrefixComptime(url, "ssh://")) {
            final_path_buf[0.."https".len].* = "https".*;
            bun.copy(u8, final_path_buf["https".len..], url["ssh".len..]);
            const out = final_path_buf[0 .. url.len - "ssh".len + "https".len];
            return out;
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
                    const out = final_path_buf[0 .. url.len + "https://".len + tld.len];
                    return out;
                }
            }

            bun.copy(u8, rest, url);
            if (colon_index) |colon| rest[colon] = '/';
            return final_path_buf[0 .. url.len + "https://".len];
        }

        return null;
    }

    pub fn downloadSync(
        allocator: std.mem.Allocator,
        env: DotEnv.Map,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        task_id: u64,
        name: string,
        url: string,
        attempt: u8,
    ) !std.fs.Dir {
        bun.Analytics.Features.git_dependencies += 1;
        const folder_name = try std.fmt.bufPrintZ(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        });

        return if (cache_dir.openDirZ(folder_name, .{})) |dir| fetch: {
            const path = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{folder_name}, .auto);

            _ = exec(
                allocator,
                env,
                &[_]string{ "git", "-C", path, "fetch", "--quiet" },
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

            const target = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{folder_name}, .auto);

            _ = exec(allocator, env, &[_]string{
                "git",
                "clone",
                "-c core.longpaths=true",
                "--quiet",
                "--bare",
                url,
                target,
            }) catch |err| {
                if (err == error.RepositoryNotFound or attempt > 1) {
                    log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "\"git clone\" for \"{s}\" failed",
                        .{name},
                    ) catch unreachable;
                }
                return err;
            };

            break :clone try cache_dir.openDirZ(folder_name, .{});
        };
    }

    pub fn download(
        pm: *PackageManager,
        cache_dir: std.fs.Dir,
        task_id: u64,
        name: string,
        url: string,
        attempt: u8,
        dep_id: DependencyID,
    ) void {
        bun.Analytics.Features.git_dependencies += 1;
        const folder_name = std.fmt.bufPrintZ(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        }) catch |err| {
            pm.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                pm.allocator,
                "Failed to format git folder name: {s}",
                .{@errorName(err)},
            ) catch unreachable;
            pm.onGitDownloadComplete(task_id, err, .{ 
                .name = name, 
                .url = url, 
                .task_id = task_id, 
                .attempt = attempt,
                .cache_dir = cache_dir,
                .dep_id = dep_id,
            });
            return;
        };

        // Try to open existing directory first
        if (cache_dir.openDirZ(folder_name, .{})) |dir| {
            // Directory exists, do a fetch
            const path = Path.joinAbsString(pm.cache_directory_path, &.{folder_name}, .auto);
            
            // Convert env map for spawning
            var env_map = shared_env.get(pm.allocator, &pm.env);
            const envp = env_map.stdEnvMap(pm.allocator).unwrap() catch |err| {
                pm.onGitDownloadComplete(task_id, err, .{
                    .name = name,
                    .url = url,
                    .task_id = task_id,
                    .attempt = attempt,
                    .cache_dir = cache_dir,
                    .dep_id = dep_id,
                });
                return;
            };
            
            const runner = GitRunner.new(pm, envp.items.ptr, .{
                .download = .{
                    .name = name,
                    .url = url,
                    .task_id = task_id,
                    .attempt = attempt,
                    .cache_dir = dir,
                    .dep_id = dep_id,
                },
            });
            
            runner.spawn(&[_]string{ "git", "-C", path, "fetch", "--quiet" }) catch |err| {
                pm.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    pm.allocator,
                    "Failed to spawn git fetch for \"{s}\": {s}",
                    .{name, @errorName(err)},
                ) catch unreachable;
                runner.deinit();
                pm.onGitDownloadComplete(task_id, err, .{
                    .name = name,
                    .url = url,
                    .task_id = task_id,
                    .attempt = attempt,
                    .cache_dir = cache_dir,
                    .dep_id = dep_id,
                });
            };
        } else |not_found| {
            if (not_found != error.FileNotFound) {
                pm.onGitDownloadComplete(task_id, not_found, .{
                    .name = name,
                    .url = url,
                    .task_id = task_id,
                    .attempt = attempt,
                    .cache_dir = cache_dir,
                    .dep_id = dep_id,
                });
                return;
            }
            
            // Clone new repository
            const target = Path.joinAbsString(pm.cache_directory_path, &.{folder_name}, .auto);
            
            // Convert env map for spawning
            var env_map = shared_env.get(pm.allocator, &pm.env);
            const envp = env_map.stdEnvMap(pm.allocator).unwrap() catch |err| {
                pm.onGitDownloadComplete(task_id, err, .{
                    .name = name,
                    .url = url,
                    .task_id = task_id,
                    .attempt = attempt,
                    .cache_dir = cache_dir,
                    .dep_id = dep_id,
                });
                return;
            };
            
            const runner = GitRunner.new(pm, envp.items.ptr, .{
                .download = .{
                    .name = name,
                    .url = url,
                    .task_id = task_id,
                    .attempt = attempt,
                    .cache_dir = cache_dir,
                    .dep_id = dep_id,
                },
            });
            
            runner.spawn(&[_]string{
                "git",
                "clone",
                "-c", "core.longpaths=true",
                "--quiet",
                "--bare",
                url,
                target,
            }) catch |err| {
                if (err == error.RepositoryNotFound or attempt > 1) {
                    pm.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        pm.allocator,
                        "Failed to spawn git clone for \"{s}\": {s}",
                        .{name, @errorName(err)},
                    ) catch unreachable;
                }
                runner.deinit();
                pm.onGitDownloadComplete(task_id, err, .{
                    .name = name,
                    .url = url,
                    .task_id = task_id,
                    .attempt = attempt,
                    .cache_dir = cache_dir,
                    .dep_id = dep_id,
                });
            };
        }
    }

    pub fn findCommitSync(
        allocator: std.mem.Allocator,
        env: *DotEnv.Loader,
        log: *logger.Log,
        repo_dir: std.fs.Dir,
        name: string,
        committish: string,
        task_id: u64,
    ) !string {
        const path = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{try std.fmt.bufPrint(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        })}, .auto);

        _ = repo_dir;

        return std.mem.trim(u8, exec(
            allocator,
            shared_env.get(allocator, env),
            if (committish.len > 0)
                &[_]string{ "git", "-C", path, "log", "--format=%H", "-1", committish }
            else
                &[_]string{ "git", "-C", path, "log", "--format=%H", "-1" },
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

    pub fn findCommit(
        pm: *PackageManager,
        repo_dir: std.fs.Dir,
        name: string,
        committish: string,
        task_id: u64,
    ) void {
        const path = Path.joinAbsString(pm.cache_directory_path, &.{std.fmt.bufPrint(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        }) catch |err| {
            pm.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                pm.allocator,
                "Failed to format git folder name: {s}",
                .{@errorName(err)},
            ) catch unreachable;
            pm.onGitFindCommitComplete(task_id, err, .{
                .name = name,
                .committish = committish,
                .task_id = task_id,
                .repo_dir = repo_dir,
            });
            return;
        }}, .auto);

        // Convert env map for spawning
        var env_map = shared_env.get(pm.allocator, &pm.env);
        const envp = env_map.stdEnvMap(pm.allocator).unwrap() catch |err| {
            pm.onGitFindCommitComplete(task_id, err, .{
                .name = name,
                .committish = committish,
                .task_id = task_id,
                .repo_dir = repo_dir,
            });
            return;
        };
        
        const runner = GitRunner.new(pm, envp.items.ptr, .{
            .find_commit = .{
                .name = name,
                .committish = committish,
                .task_id = task_id,
                .repo_dir = repo_dir,
            },
        });
        
        const argv = if (committish.len > 0)
            &[_]string{ "git", "-C", path, "log", "--format=%H", "-1", committish }
        else
            &[_]string{ "git", "-C", path, "log", "--format=%H", "-1" };
            
        runner.spawn(argv) catch |err| {
            pm.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                pm.allocator,
                "Failed to spawn git log for \"{s}\": {s}",
                .{name, @errorName(err)},
            ) catch unreachable;
            runner.deinit();
            pm.onGitFindCommitComplete(task_id, err, .{
                .name = name,
                .committish = committish,
                .task_id = task_id,
                .repo_dir = repo_dir,
            });
        };
    }

    pub fn checkoutSync(
        allocator: std.mem.Allocator,
        env: DotEnv.Map,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        repo_dir: std.fs.Dir,
        name: string,
        url: string,
        resolved: string,
    ) !ExtractData {
        bun.Analytics.Features.git_dependencies += 1;
        const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, resolved, null);

        var package_dir = bun.openDir(cache_dir, folder_name) catch |not_found| brk: {
            if (not_found != error.ENOENT) return not_found;

            const target = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{folder_name}, .auto);

            _ = exec(allocator, env, &[_]string{
                "git",
                "clone",
                "-c core.longpaths=true",
                "--quiet",
                "--no-checkout",
                try bun.getFdPath(.fromStdDir(repo_dir), &final_path_buf),
                target,
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

            const folder = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{folder_name}, .auto);

            _ = exec(allocator, env, &[_]string{ "git", "-C", folder, "checkout", "--quiet", resolved }) catch |err| {
                log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "\"git checkout\" for \"{s}\" failed",
                    .{name},
                ) catch unreachable;
                return err;
            };
            var dir = try bun.openDir(cache_dir, folder_name);
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

        const json_file, const json_buf = bun.sys.File.readFileFrom(package_dir, "package.json", allocator).unwrap() catch |err| {
            if (err == error.ENOENT) {
                // allow git dependencies without package.json
                return .{
                    .url = url,
                    .resolved = resolved,
                };
            }

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

        const json_path = json_file.getPath(
            &json_path_buf,
        ).unwrap() catch |err| {
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
            .json = .{
                .path = ret_json_path,
                .buf = json_buf,
            },
        };
    }

    pub fn checkout(
        pm: *PackageManager,
        cache_dir: std.fs.Dir,
        repo_dir: std.fs.Dir,
        name: string,
        url: string,
        resolved: string,
    ) void {
        bun.Analytics.Features.git_dependencies += 1;
        const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, resolved, null);

        // Check if package already exists
        if (bun.openDir(cache_dir, folder_name)) |package_dir| {
            // Package already exists, read package.json and complete
            defer package_dir.close();
            
            const json_file, const json_buf = bun.sys.File.readFileFrom(package_dir, "package.json", pm.allocator).unwrap() catch |err| {
                if (err == error.ENOENT) {
                    // allow git dependencies without package.json
                    pm.onGitCheckoutComplete(0, .{
                        .url = url,
                        .resolved = resolved,
                    }, .{
                        .name = name,
                        .url = url,
                        .resolved = resolved,
                        .cache_dir = cache_dir,
                        .repo_dir = repo_dir,
                    });
                    return;
                }

                pm.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    pm.allocator,
                    "\"package.json\" for \"{s}\" failed to open: {s}",
                    .{ name, @errorName(err) },
                ) catch unreachable;
                pm.onGitCheckoutComplete(0, error.InstallFailed, .{
                    .name = name,
                    .url = url,
                    .resolved = resolved,
                    .cache_dir = cache_dir,
                    .repo_dir = repo_dir,
                });
                return;
            };
            defer json_file.close();

            const json_path = json_file.getPath(&json_path_buf).unwrap() catch |err| {
                pm.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    pm.allocator,
                    "\"package.json\" for \"{s}\" failed to resolve: {s}",
                    .{ name, @errorName(err) },
                ) catch unreachable;
                pm.onGitCheckoutComplete(0, error.InstallFailed, .{
                    .name = name,
                    .url = url,
                    .resolved = resolved,
                    .cache_dir = cache_dir,
                    .repo_dir = repo_dir,
                });
                return;
            };

            const ret_json_path = FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path) catch |err| {
                pm.onGitCheckoutComplete(0, err, .{
                    .name = name,
                    .url = url,
                    .resolved = resolved,
                    .cache_dir = cache_dir,
                    .repo_dir = repo_dir,
                });
                return;
            };
            
            pm.onGitCheckoutComplete(0, .{
                .url = url,
                .resolved = resolved,
                .json = .{
                    .path = ret_json_path,
                    .buf = json_buf,
                },
            }, .{
                .name = name,
                .url = url,
                .resolved = resolved,
                .cache_dir = cache_dir,
                .repo_dir = repo_dir,
            });
            return;
        } else |_| {
            // Need to clone and checkout
            const target = Path.joinAbsString(pm.cache_directory_path, &.{folder_name}, .auto);
            const repo_path = bun.getFdPath(.fromStdDir(repo_dir), &final_path_buf) catch |err| {
                pm.onGitCheckoutComplete(0, err, .{
                    .name = name,
                    .url = url,
                    .resolved = resolved,
                    .cache_dir = cache_dir,
                    .repo_dir = repo_dir,
                });
                return;
            };

            // Convert env map for spawning
            var env_map = shared_env.get(pm.allocator, &pm.env);
            const envp = env_map.stdEnvMap(pm.allocator).unwrap() catch |err| {
                pm.onGitCheckoutComplete(0, err, .{
                    .name = name,
                    .url = url,
                    .resolved = resolved,
                    .cache_dir = cache_dir,
                    .repo_dir = repo_dir,
                });
                return;
            };
            
            // First do the clone
            const runner = GitRunner.new(pm, envp.items.ptr, .{
                .checkout = .{
                    .name = name,
                    .url = url,
                    .resolved = resolved,
                    .cache_dir = cache_dir,
                    .repo_dir = repo_dir,
                },
            });
            
            runner.spawn(&[_]string{
                "git",
                "clone",
                "-c", "core.longpaths=true",
                "--quiet",
                "--no-checkout",
                repo_path,
                target,
            }) catch |err| {
                pm.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    pm.allocator,
                    "Failed to spawn git clone for checkout of \"{s}\": {s}",
                    .{name, @errorName(err)},
                ) catch unreachable;
                runner.deinit();
                pm.onGitCheckoutComplete(0, err, .{
                    .name = name,
                    .url = url,
                    .resolved = resolved,
                    .cache_dir = cache_dir,
                    .repo_dir = repo_dir,
                });
            };
        }
    }
};

pub const GitRunner = struct {
    /// The spawned git process handle
    process: ?*bun.spawn.Process = null,
    
    /// Buffer stdout from the process
    stdout: bun.io.BufferedReader = bun.io.BufferedReader.init(@This()),
    
    /// Buffer stderr from the process
    stderr: bun.io.BufferedReader = bun.io.BufferedReader.init(@This()),
    
    /// Reference to the package manager for event loop and completion callbacks
    manager: *PackageManager,
    
    /// Track open file descriptors for stdout/stderr
    remaining_fds: i8 = 0,
    
    /// Track if process exit has been called
    has_called_process_exit: bool = false,
    
    /// For checkout operations, track if we're in clone or checkout phase
    checkout_phase: enum { clone, checkout } = .clone,
    
    /// Context for what to do when the command completes
    completion_context: union(enum) {
        download: struct {
            name: string,
            url: string,
            task_id: u64,
            attempt: u8,
            cache_dir: std.fs.Dir,
            dep_id: DependencyID,
        },
        find_commit: struct {
            name: string,
            committish: string,
            task_id: u64,
            repo_dir: std.fs.Dir,
        },
        checkout: struct {
            name: string,
            url: string,
            resolved: string,
            cache_dir: std.fs.Dir,
            repo_dir: std.fs.Dir,
        },
    },
    
    /// Environment variables for the process
    envp: [:null]?[*:0]const u8,
    
    /// Arguments allocated for null-termination
    argv_storage: std.ArrayList([:0]const u8),
    
    /// Create a new GitRunner instance
    pub fn new(
        manager: *PackageManager,
        envp: [:null]?[*:0]const u8,
        completion_context: @TypeOf(completion_context),
    ) *GitRunner {
        const runner = bun.new(GitRunner, .{
            .manager = manager,
            .envp = envp,
            .completion_context = completion_context,
            .argv_storage = std.ArrayList([:0]const u8).init(manager.allocator),
        });
        return runner;
    }
    
    pub fn loop(this: *const GitRunner) *bun.uws.Loop {
        return this.manager.event_loop.loop();
    }

    pub fn eventLoop(this: *const GitRunner) *JSC.AnyEventLoop {
        return &this.manager.event_loop;
    }
    
    /// Spawn the git process with the given arguments
    pub fn spawn(this: *GitRunner, argv: []const string) !void {
        this.stdout.setParent(this);
        this.stderr.setParent(this);
        
        const spawn_options = bun.spawn.SpawnOptions{
            .stdin = .ignore,
            .stdout = if (Environment.isPosix) .buffer else .{ .buffer = undefined }, // TODO: Windows pipe setup
            .stderr = if (Environment.isPosix) .buffer else .{ .buffer = undefined },
            .cwd = null, // git commands use absolute paths
            .windows = if (Environment.isWindows) .{
                .loop = JSC.EventLoopHandle.init(&this.manager.event_loop),
            } else {},
            .stream = false,
        };
        
        this.remaining_fds = 0;
        
        // Convert argv to null-terminated for spawn
        var argv_buf: [32]?[*:0]const u8 = undefined;
        for (argv, 0..) |arg, i| {
            const duped = try this.manager.allocator.dupeZ(u8, arg);
            try this.argv_storage.append(duped);
            argv_buf[i] = duped.ptr;
        }
        argv_buf[argv.len] = null;
        
        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, @ptrCast(&argv_buf), this.envp)).unwrap();
        
        // Set up stdout/stderr readers
        if (comptime Environment.isPosix) {
            if (spawned.stdout) |stdout| {
                if (!spawned.memfds[1]) {
                    _ = bun.sys.setNonblocking(stdout);
                    this.remaining_fds += 1;
                    try this.stdout.start(stdout, true).unwrap();
                } else {
                    this.stdout.startMemfd(stdout);
                }
            }
            if (spawned.stderr) |stderr| {
                if (!spawned.memfds[2]) {
                    _ = bun.sys.setNonblocking(stderr);
                    this.remaining_fds += 1;
                    try this.stderr.start(stderr, true).unwrap();
                } else {
                    this.stderr.startMemfd(stderr);
                }
            }
        }
        // TODO: Windows pipe handling
        
        const event_loop = &this.manager.event_loop;
        var process = spawned.toProcess(event_loop, false);
        
        this.process = process;
        process.setExitHandler(this);
        
        switch (process.watchOrReap()) {
            .err => |err| {
                if (!process.hasExited())
                    process.onExit(.{ .err = err }, &std.mem.zeroes(bun.spawn.Rusage));
            },
            .result => {},
        }
    }
    
    /// Called when a BufferedReader finishes
    pub fn onReaderDone(this: *GitRunner) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;
        this.maybeFinished();
    }
    
    /// Called when a BufferedReader encounters an error
    pub fn onReaderError(this: *GitRunner, err: bun.sys.Error) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;
        
        const name = switch (this.completion_context) {
            .download => |ctx| ctx.name,
            .find_commit => |ctx| ctx.name,
            .checkout => |ctx| ctx.name,
        };
        
        Output.prettyErrorln("<r><red>error<r>: Failed to read git output for \"<b>{s}<r>\" due to error <b>{d} {s}<r>", .{
            name,
            err.errno,
            @tagName(err.getErrno()),
        });
        Output.flush();
        this.maybeFinished();
    }
    
    /// Called when the process exits
    pub fn onProcessExit(this: *GitRunner, proc: *bun.spawn.Process, _: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        if (this.process != proc) {
            return;
        }
        this.has_called_process_exit = true;
        this.maybeFinished();
    }
    
    /// Check if all I/O and process are complete
    fn maybeFinished(this: *GitRunner) void {
        if (!this.has_called_process_exit or this.remaining_fds != 0)
            return;
        
        const process = this.process orelse return;
        this.handleExit(process.status);
    }
    
    /// Reset for next phase of a multi-step operation
    fn resetForNextPhase(this: *GitRunner) void {
        if (this.process) |process| {
            this.process = null;
            process.close();
            process.deref();
        }
        
        this.stdout.deinit();
        this.stderr.deinit();
        this.stdout = bun.io.BufferedReader.init(@This());
        this.stderr = bun.io.BufferedReader.init(@This());
        this.has_called_process_exit = false;
        this.remaining_fds = 0;
        
        // Clear argv storage for reuse
        for (this.argv_storage.items) |arg| {
            this.manager.allocator.free(arg);
        }
        this.argv_storage.clearRetainingCapacity();
    }
    
    /// Process the git command result and call appropriate completion callback
    fn handleExit(this: *GitRunner, status: bun.spawn.Status) void {
        const allocator = this.manager.allocator;
        
        switch (status) {
            .exited => |exit| {
                if (exit.code == 0) {
                    // Success - process based on context
                    switch (this.completion_context) {
                        .download => |ctx| {
                            defer this.deinit();
                            // For download, open the directory and signal completion
                            const folder_name = std.fmt.bufPrintZ(&folder_name_buf, "{any}.git", .{
                                bun.fmt.hexIntLower(ctx.task_id),
                            }) catch |err| {
                                this.manager.onGitDownloadComplete(ctx.task_id, err, ctx);
                                return;
                            };
                            
                            const dir = ctx.cache_dir.openDirZ(folder_name, .{}) catch |err| {
                                this.manager.onGitDownloadComplete(ctx.task_id, err, ctx);
                                return;
                            };
                            
                            this.manager.onGitDownloadComplete(ctx.task_id, dir, ctx);
                        },
                        .find_commit => |ctx| {
                            defer this.deinit();
                            // Process stdout to get the commit hash
                            const stdout_buf = this.stdout.finalBuffer();
                            const commit_hash = std.mem.trim(u8, stdout_buf.items, " \t\r\n");
                            
                            if (commit_hash.len > 0) {
                                const resolved = allocator.dupe(u8, commit_hash) catch bun.outOfMemory();
                                this.manager.onGitFindCommitComplete(ctx.task_id, resolved, ctx);
                            } else {
                                this.manager.onGitFindCommitComplete(ctx.task_id, error.InstallFailed, ctx);
                            }
                        },
                        .checkout => |ctx| {
                            // Checkout is a two-phase operation
                            if (this.checkout_phase == .clone) {
                                // Clone succeeded, now do checkout
                                this.checkout_phase = .checkout;
                                this.resetForNextPhase();
                                
                                const folder = Path.joinAbsString(this.manager.cache_directory_path, &.{
                                    PackageManager.cachedGitFolderNamePrint(&folder_name_buf, ctx.resolved, null)
                                }, .auto);
                                
                                this.spawn(&[_]string{ "git", "-C", folder, "checkout", "--quiet", ctx.resolved }) catch |err| {
                                    this.manager.log.addErrorFmt(
                                        null,
                                        logger.Loc.Empty,
                                        allocator,
                                        "Failed to spawn git checkout for \"{s}\": {s}",
                                        .{ctx.name, @errorName(err)},
                                    ) catch unreachable;
                                    this.deinit();
                                    this.manager.onGitCheckoutComplete(0, err, ctx);
                                };
                            } else {
                                defer this.deinit();
                                // Checkout phase succeeded, clean up and read package.json
                                const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, ctx.resolved, null);
                                
                                // Open the package directory
                                var package_dir = bun.openDir(ctx.cache_dir, folder_name) catch |err| {
                                    this.manager.onGitCheckoutComplete(0, err, ctx);
                                    return;
                                };
                                defer package_dir.close();
                                
                                // Remove .git directory
                                package_dir.deleteTree(".git") catch {};
                                
                                // Write .bun-tag file
                                if (ctx.resolved.len > 0) insert_tag: {
                                    const git_tag = package_dir.createFileZ(".bun-tag", .{ .truncate = true }) catch break :insert_tag;
                                    defer git_tag.close();
                                    git_tag.writeAll(ctx.resolved) catch {
                                        package_dir.deleteFileZ(".bun-tag") catch {};
                                    };
                                }
                                
                                // Read package.json
                                const json_file, const json_buf = bun.sys.File.readFileFrom(package_dir, "package.json", allocator).unwrap() catch |err| {
                                    if (err == error.ENOENT) {
                                        // allow git dependencies without package.json
                                        this.manager.onGitCheckoutComplete(0, .{
                                            .url = ctx.url,
                                            .resolved = ctx.resolved,
                                        }, ctx);
                                        return;
                                    }
                                    
                                    this.manager.log.addErrorFmt(
                                        null,
                                        logger.Loc.Empty,
                                        allocator,
                                        "\"package.json\" for \"{s}\" failed to open: {s}",
                                        .{ ctx.name, @errorName(err) },
                                    ) catch unreachable;
                                    this.manager.onGitCheckoutComplete(0, error.InstallFailed, ctx);
                                    return;
                                };
                                defer json_file.close();
                                
                                const json_path = json_file.getPath(&json_path_buf).unwrap() catch |err| {
                                    this.manager.log.addErrorFmt(
                                        null,
                                        logger.Loc.Empty,
                                        allocator,
                                        "\"package.json\" for \"{s}\" failed to resolve: {s}",
                                        .{ ctx.name, @errorName(err) },
                                    ) catch unreachable;
                                    this.manager.onGitCheckoutComplete(0, error.InstallFailed, ctx);
                                    return;
                                };
                                
                                const ret_json_path = FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path) catch |err| {
                                    this.manager.onGitCheckoutComplete(0, err, ctx);
                                    return;
                                };
                                
                                this.manager.onGitCheckoutComplete(0, .{
                                    .url = ctx.url,
                                    .resolved = ctx.resolved,
                                    .json = .{
                                        .path = ret_json_path,
                                        .buf = json_buf,
                                    },
                                }, ctx);
                            }
                        },
                    }
                } else {
                    defer this.deinit();
                    // Check stderr for specific error messages
                    const stderr_buf = this.stderr.finalBuffer();
                    const stderr = stderr_buf.items;
                    
                    const err: anyerror = if (
                        (strings.containsComptime(stderr, "remote:") and
                            strings.containsComptime(stderr, "not") and
                            strings.containsComptime(stderr, "found")) or
                            strings.containsComptime(stderr, "does not exist"))
                    {
                        error.RepositoryNotFound;
                    } else {
                        error.InstallFailed;
                    };
                    
                    // Log appropriate error messages
                    switch (this.completion_context) {
                        .download => |ctx| {
                            if (err == error.RepositoryNotFound or ctx.attempt > 1) {
                                this.manager.log.addErrorFmt(
                                    null,
                                    logger.Loc.Empty,
                                    allocator,
                                    "\"git clone\" for \"{s}\" failed",
                                    .{ctx.name},
                                ) catch unreachable;
                            }
                            this.manager.onGitDownloadComplete(ctx.task_id, err, ctx);
                        },
                        .find_commit => |ctx| {
                            this.manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                allocator,
                                "no commit matching \"{s}\" found for \"{s}\" (but repository exists)",
                                .{ ctx.committish, ctx.name },
                            ) catch unreachable;
                            this.manager.onGitFindCommitComplete(ctx.task_id, err, ctx);
                        },
                        .checkout => |ctx| {
                            const op = if (this.checkout_phase == .clone) "git clone" else "git checkout";
                            this.manager.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                allocator,
                                "\"{s}\" for \"{s}\" failed",
                                .{op, ctx.name},
                            ) catch unreachable;
                            this.manager.onGitCheckoutComplete(0, err, ctx);
                        },
                    }
                }
            },
            .err => |err| {
                defer this.deinit();
                // Process error
                switch (this.completion_context) {
                    .download => |ctx| {
                        this.manager.onGitDownloadComplete(ctx.task_id, err, ctx);
                    },
                    .find_commit => |ctx| {
                        this.manager.onGitFindCommitComplete(ctx.task_id, err, ctx);
                    },
                    .checkout => |ctx| {
                        this.manager.onGitCheckoutComplete(0, err, ctx);
                    },
                }
            },
            else => {
                defer this.deinit();
                // Other status types treated as errors
                switch (this.completion_context) {
                    .download => |ctx| {
                        this.manager.onGitDownloadComplete(ctx.task_id, error.InstallFailed, ctx);
                    },
                    .find_commit => |ctx| {
                        this.manager.onGitFindCommitComplete(ctx.task_id, error.InstallFailed, ctx);
                    },
                    .checkout => |ctx| {
                        this.manager.onGitCheckoutComplete(0, error.InstallFailed, ctx);
                    },
                }
            },
        }
    }
    
    /// Clean up resources
    pub fn deinit(this: *GitRunner) void {
        if (this.process) |process| {
            this.process = null;
            process.close();
            process.deref();
        }
        
        this.stdout.deinit();
        this.stderr.deinit();
        
        // Free argv storage
        for (this.argv_storage.items) |arg| {
            this.manager.allocator.free(arg);
        }
        this.argv_storage.deinit();
        
        bun.destroy(this);
    }
};
