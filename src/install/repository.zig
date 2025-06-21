const bun = @import("bun");
const logger = bun.logger;
const Dependency = @import("./dependency.zig");
const DotEnv = @import("../env_loader.zig");
const Environment = @import("../env.zig");
const Install = @import("./install.zig");
const PackageManager = Install.PackageManager;
const Semver = bun.Semver;
const String = Semver.String;
const std = @import("std");
const string = @import("../string_types.zig").string;
const strings = @import("../string_immutable.zig");
const GitSHA = String;
const Path = bun.path;
const File = bun.sys.File;
const OOM = bun.OOM;
const GitRunner = @import("./GitRunner.zig").GitRunner;

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
        pub fn get(this: *@This(), allocator: std.mem.Allocator, other: *const DotEnv.Loader) *const DotEnv.Map {
            if (this.env) |*env| {
                return env;
            }

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
            return &this.env.?;
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

    fn rewriteSCPLikePath(after_url_scheme: string, comptime scheme: string, buf: []u8) ?string {
        // Look for the pattern user@host:path (not :port)
        const at_index = strings.indexOfChar(after_url_scheme, '@') orelse return null;
        if (after_url_scheme.len < at_index + 1) return null;
        const after_at = after_url_scheme[at_index + 1 ..];
        const colon_index = strings.indexOfChar(after_at, ':') orelse return null;
        if (after_at.len < colon_index + 1) return null;
        const host_part = after_at[0..colon_index];
        const path_part = after_at[colon_index + 1 ..];

        if (path_part.len == 0) return null;

        // Check if this looks like a port number (all digits)
        var is_port = true;
        for (path_part) |c| {
            if (!std.ascii.isDigit(c) and c != '/' and c != '#') {
                is_port = false;
                break;
            }
            if (c == '/' or c == '#') break;
        }

        if (is_port) return null;

        // If it's not a port, treat as SCP-like syntax
        buf[0..scheme.len].* = scheme[0..scheme.len].*;
        var rest = buf[scheme.len..];

        // Copy host
        bun.copy(u8, rest, host_part);
        rest[host_part.len] = '/';

        // Copy path
        bun.copy(u8, rest[host_part.len + 1 ..], path_part);

        return buf[0 .. scheme.len + host_part.len + 1 + path_part.len];
    }

    pub fn trySSH(url: string) ?string {
        // Do not cast explicit http(s) URLs to SSH
        if (strings.hasPrefixComptime(url, "http")) {
            return null;
        }

        if (strings.hasPrefixComptime(url, "git@")) {
            return url;
        }

        if (strings.hasPrefixComptime(url, "ssh://")) {
            return rewriteSCPLikePath(url["ssh://".len..], "ssh://", &final_path_buf) orelse url;
        }

        return null;
    }

    pub fn tryHTTPS(url: string) ?string {
        if (strings.hasPrefixComptime(url, "http")) {
            return url;
        }

        if (strings.hasPrefixComptime(url, "ssh://")) {
            return rewriteSCPLikePath(url["ssh://".len..], "https://", &final_path_buf);
        }

        if (Dependency.isSCPLikePath(url)) {
            return rewriteSCPLikePath(url, "https://", &final_path_buf);
        }

        return null;
    }

    pub fn downloadAndPickURL(
        pm: *PackageManager,
        allocator: std.mem.Allocator,
        env: *const DotEnv.Map,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        task_id: u64,
        name: string,
        url: string,
        attempt: u8,
    ) !GitRunner.ScheduleResult {
        if (attempt > 0) {
            if (strings.hasPrefixComptime(url, "git+ssh://")) {
                if (trySSH(url)) |ssh| {
                    return download(pm, allocator, env, log, cache_dir, task_id, name, ssh, url, attempt);
                }
            }
        }

        if (tryHTTPS(url)) |https| {
            return download(pm, allocator, env, log, cache_dir, task_id, name, https, url, attempt);
        } else if (trySSH(url)) |ssh| {
            return download(pm, allocator, env, log, cache_dir, task_id, name, ssh, url, attempt);
        } else {
            return download(pm, allocator, env, log, cache_dir, task_id, name, url, url, attempt);
        }
    }

    pub fn download(
        pm: *PackageManager,
        allocator: std.mem.Allocator,
        env: *const DotEnv.Map,
        _: *logger.Log,
        cache_dir: std.fs.Dir,
        task_id: u64,
        name: string,
        clone_url: string,
        input_url: string,
        attempt: u8,
    ) !GitRunner.ScheduleResult {
        bun.Analytics.Features.git_dependencies += 1;
        const folder_name = try std.fmt.bufPrintZ(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        });

        if (cache_dir.openDirZ(folder_name, .{})) |dir| {
            // Repository exists, just need to fetch
            const buf = bun.PathBufferPool.get();
            defer bun.PathBufferPool.put(buf);
            const path = Path.joinAbsStringBuf(PackageManager.get().cache_directory_path, buf, &.{folder_name}, .auto);

            const argv = &[_][]const u8{
                GitRunner.gitExecutable(),
                "-C",
                path,
                "fetch",
                "--quiet",
            };

            const context = GitRunner.CompletionContext{
                .git_clone = .{
                    .name = try allocator.dupe(u8, name),
                    .url = try allocator.dupe(u8, input_url),
                    .task_id = task_id,
                    .attempt = attempt,
                    .dir = .{ .repo = dir },
                },
            };

            const runner = try GitRunner.init(allocator, pm, context);
            try runner.spawn(argv, env);
            return .scheduled;
        } else |_| {
            // Need to clone
            const buf = bun.PathBufferPool.get();
            defer bun.PathBufferPool.put(buf);
            const target = Path.joinAbsStringBuf(PackageManager.get().cache_directory_path, buf, &.{folder_name}, .auto);

            const argv = &[_][]const u8{
                GitRunner.gitExecutable(),
                "clone",
                "-c",
                "core.longpaths=true",
                "--quiet",
                "--bare",
                clone_url,
                target,
            };

            const context = GitRunner.CompletionContext{
                .git_clone = .{
                    .name = try allocator.dupe(u8, name),
                    .url = try allocator.dupe(u8, input_url),
                    .task_id = task_id,
                    .attempt = attempt,
                    .dir = .{ .cache = cache_dir },
                },
            };

            const runner = try GitRunner.init(
                allocator,
                pm,
                context,
            );
            try runner.spawn(argv, env);
            return .scheduled;
        }
    }

    pub fn findCommit(
        pm: *PackageManager,
        allocator: std.mem.Allocator,
        env: *const DotEnv.Map,
        _: *logger.Log,
        repo_dir: std.fs.Dir,
        name: string,
        committish: string,
        task_id: u64,
    ) !GitRunner.ScheduleResult {
        const buf = bun.PathBufferPool.get();
        defer bun.PathBufferPool.put(buf);
        const path = Path.joinAbsStringBuf(PackageManager.get().cache_directory_path, buf, &.{try std.fmt.bufPrint(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        })}, .auto);

        const argv_buf = &[_][]const u8{ GitRunner.gitExecutable(), "-C", path, "log", "--format=%H", "-1", committish };
        const argv: []const []const u8 = if (committish.len > 0)
            argv_buf
        else
            argv_buf[0 .. argv_buf.len - 1];
        const context = GitRunner.CompletionContext{
            .git_find_commit = .{
                .name = try allocator.dupe(u8, name),
                .committish = try allocator.dupe(u8, committish),
                .task_id = task_id,
                .repo_dir = repo_dir,
            },
        };

        const runner = try GitRunner.init(allocator, pm, context);
        try runner.spawn(argv, env);
        return .scheduled;
    }

    pub fn checkout(
        pm: *PackageManager,
        allocator: std.mem.Allocator,
        env: *const DotEnv.Map,
        _: *logger.Log,
        cache_dir: std.fs.Dir,
        repo_dir: std.fs.Dir,
        name: string,
        url: string,
        resolved: string,
        task_id: u64,
    ) !GitRunner.ScheduleResult {
        bun.Analytics.Features.git_dependencies += 1;
        const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, resolved, null);

        switch (file: {
            const path_buf = bun.PathBufferPool.get();
            defer bun.PathBufferPool.put(path_buf);
            const @"folder/package.json" = std.fmt.bufPrintZ(path_buf, "{s}" ++ std.fs.path.sep_str ++ "package.json", .{folder_name}) catch unreachable;
            break :file bun.sys.File.readFileFrom(cache_dir, @"folder/package.json", allocator);
        }) {
            .result => |file_read| {
                const json_file, const json_buf = file_read;
                defer json_file.close();

                const json_path = json_file.getPath(&json_path_buf).unwrap() catch {
                    try pm.git_tasks.writeItem(.{
                        .task_id = task_id,
                        .err = error.InstallFailed,
                        .context = .{ .git_checkout = .{
                            .name = name,
                            .url = url,
                            .resolved = resolved,
                            .task_id = task_id,
                            .cache_dir = cache_dir,
                            .repo_dir = repo_dir,
                        } },
                        .result = undefined,
                    });
                    return .completed;
                };

                const ret_json_path = try @import("../fs.zig").FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path);

                // Enqueue complete GitRunner.Result with ExtractData payload
                try pm.git_tasks.writeItem(.{
                    .task_id = task_id,
                    .context = .{ .git_checkout = .{
                        .name = name,
                        .url = url,
                        .resolved = resolved,
                        .task_id = task_id,
                        .cache_dir = cache_dir,
                        .repo_dir = repo_dir,
                    } },
                    .result = .{ .git_checkout = .{
                        .url = url,
                        .resolved = resolved,
                        .json = .{
                            .path = ret_json_path,
                            .buf = json_buf,
                        },
                    } },
                });
                return .completed;
            },
            .err => {
                const buf = bun.PathBufferPool.get();
                defer bun.PathBufferPool.put(buf);

                // Need to clone and checkout
                const target = Path.joinAbsStringBuf(PackageManager.get().cache_directory_path, buf, &.{folder_name}, .auto);
                const repo_path = try bun.getFdPath(.fromStdDir(repo_dir), &final_path_buf);

                const argv = &[_][]const u8{
                    GitRunner.gitExecutable(),
                    "clone",
                    "-c",
                    "core.longpaths=true",
                    "--quiet",
                    "--no-checkout",
                    repo_path,
                    target,
                };

                // Then we'll need to checkout after clone completes
                // For now, we'll do both operations in sequence
                const context = GitRunner.CompletionContext{
                    .git_checkout = .{
                        .name = try allocator.dupe(u8, name),
                        .url = try allocator.dupe(u8, url),
                        .resolved = try allocator.dupe(u8, resolved),
                        .task_id = task_id,
                        .cache_dir = cache_dir,
                        .repo_dir = repo_dir,
                    },
                };

                const runner = try GitRunner.init(allocator, pm, context);
                try runner.spawn(argv, env);
                return .scheduled;
            },
        }
    }
};
