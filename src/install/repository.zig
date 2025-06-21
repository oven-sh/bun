const bun = @import("root").bun;
const default_allocator = bun.default_allocator;
const string = bun.string;
const stringZ = bun.stringZ;
const strings = bun.strings;
const logger = bun.logger;
const std = @import("std");
const Path = bun.path;
const ExtractData = @import("./install.zig").ExtractData;
const Install = @import("./install.zig");
const PackageID = Install.PackageID;
const ExternalSliceAllocator = Install.ExternalSliceAllocator;
const invalid_package_id = Install.invalid_package_id;
const DependencyID = Install.DependencyID;
const Lockfile = @import("./lockfile.zig");
const PackageManager = Install.PackageManager;
const GitSHA = String;
const String = @import("./semver.zig").String;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const GlobalStringBuilder = @import("../string_builder.zig");
const Output = bun.Output;
const Global = bun.Global;
const FileSystem = @import("../fs.zig").FileSystem;
const File = bun.sys.File;
const Env = bun.DotEnv;
const Resolution = @import("./resolution.zig").Resolution;
const OOM = bun.OOM;
const Features = @import("../analytics/analytics_thread.zig").Features;
const Dependency = @import("./dependency.zig");
const DotEnv = bun.DotEnv;
const Environment = bun.Environment;
const JSC = bun.JSC;
const Syscall = bun.sys;

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

    // The old synchronous exec function has been removed in favor of async GitRunner

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

    pub fn download(
        pm: *PackageManager,
        env: DotEnv.Map,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        task_id: u64,
        name: string,
        url: string,
        attempt: u8,
    ) !void {
        bun.Analytics.Features.git_dependencies += 1;
        const folder_name = try std.fmt.bufPrintZ(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        });

        // Check if already cloned
        if (cache_dir.openDirZ(folder_name, .{})) |dir| {
            // Need to fetch
            const path = Path.joinAbsString(pm.cache_directory_path, &.{folder_name}, .auto);
            
            var git_runner = GitRunner.new(.{
                .process = null,
                .manager = pm,
                .completion_context = .{
                    .download = .{
                        .name = name,
                        .url = url,
                        .task_id = task_id,
                        .attempt = attempt,
                        .log = log,
                        .cache_dir = dir,
                    },
                },
                .envp = try env.createNullDelimitedEnvMap(pm.allocator),
                .allocator = pm.allocator,
                .argv = try pm.allocator.alloc(string, 5),
            });
            
            git_runner.argv[0] = try pm.allocator.dupe(u8, "git");
            git_runner.argv[1] = try pm.allocator.dupe(u8, "-C");
            git_runner.argv[2] = try pm.allocator.dupe(u8, path);
            git_runner.argv[3] = try pm.allocator.dupe(u8, "fetch");
            git_runner.argv[4] = try pm.allocator.dupe(u8, "--quiet");
            
            try git_runner.spawn();
        } else |not_found| {
            if (not_found != error.FileNotFound) return not_found;

            // Need to clone
            const target = Path.joinAbsString(pm.cache_directory_path, &.{folder_name}, .auto);

            var git_runner = GitRunner.new(.{
                .process = null,
                .manager = pm,
                .completion_context = .{
                    .download = .{
                        .name = name,
                        .url = url,
                        .task_id = task_id,
                        .attempt = attempt,
                        .log = log,
                        .cache_dir = cache_dir,
                    },
                },
                .envp = try env.createNullDelimitedEnvMap(pm.allocator),
                .allocator = pm.allocator,
                .argv = try pm.allocator.alloc(string, 7),
            });
            
            git_runner.argv[0] = try pm.allocator.dupe(u8, "git");
            git_runner.argv[1] = try pm.allocator.dupe(u8, "clone");
            git_runner.argv[2] = try pm.allocator.dupe(u8, "-c core.longpaths=true");
            git_runner.argv[3] = try pm.allocator.dupe(u8, "--quiet");
            git_runner.argv[4] = try pm.allocator.dupe(u8, "--bare");
            git_runner.argv[5] = try pm.allocator.dupe(u8, url);
            git_runner.argv[6] = try pm.allocator.dupe(u8, target);
            
            try git_runner.spawn();
        }
    }

    pub fn findCommit(
        pm: *PackageManager,
        env: *DotEnv.Loader,
        log: *logger.Log,
        repo_dir: std.fs.Dir,
        name: string,
        committish: string,
        task_id: u64,
    ) !void {
        const path = Path.joinAbsString(pm.cache_directory_path, &.{try std.fmt.bufPrint(&folder_name_buf, "{any}.git", .{
            bun.fmt.hexIntLower(task_id),
        })}, .auto);

        _ = repo_dir;

        var git_runner = GitRunner.new(.{
            .process = null,
            .manager = pm,
            .completion_context = .{
                .find_commit = .{
                    .name = name,
                    .committish = committish,
                    .task_id = task_id,
                    .log = log,
                    .repo_dir = repo_dir,
                },
            },
            .envp = try shared_env.get(pm.allocator, env).createNullDelimitedEnvMap(pm.allocator),
            .allocator = pm.allocator,
            .argv = if (committish.len > 0)
                try pm.allocator.alloc(string, 7)
            else
                try pm.allocator.alloc(string, 6),
        });
        
        git_runner.argv[0] = try pm.allocator.dupe(u8, "git");
        git_runner.argv[1] = try pm.allocator.dupe(u8, "-C");
        git_runner.argv[2] = try pm.allocator.dupe(u8, path);
        git_runner.argv[3] = try pm.allocator.dupe(u8, "log");
        git_runner.argv[4] = try pm.allocator.dupe(u8, "--format=%H");
        git_runner.argv[5] = try pm.allocator.dupe(u8, "-1");
        if (committish.len > 0) {
            git_runner.argv[6] = try pm.allocator.dupe(u8, committish);
        }
        
        try git_runner.spawn();
    }

    pub fn checkout(
        pm: *PackageManager,
        env: DotEnv.Map,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        repo_dir: std.fs.Dir,
        name: string,
        url: string,
        resolved: string,
    ) !void {
        bun.Analytics.Features.git_dependencies += 1;
        const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, resolved, null);

        // Check if already exists
        if (bun.openDir(cache_dir, folder_name)) |dir| {
            dir.close();
            // Already exists, we're done
            pm.onGitCheckoutComplete(0, .{
                .url = url,
                .resolved = resolved,
            }) catch |err| {
                pm.onGitError(0, err);
            };
            return;
        } else |not_found| {
            if (not_found != error.ENOENT) return not_found;

            // Need to clone with --no-checkout first
            const target = Path.joinAbsString(pm.cache_directory_path, &.{folder_name}, .auto);
            const repo_path = try bun.getFdPath(.fromStdDir(repo_dir), &final_path_buf);

            var git_runner = GitRunner.new(.{
                .process = null,
                .manager = pm,
                .completion_context = .{
                    .checkout = .{
                        .name = name,
                        .url = url,
                        .resolved = resolved,
                        .log = log,
                        .cache_dir = cache_dir,
                        .repo_dir = repo_dir,
                    },
                },
                .envp = try env.createNullDelimitedEnvMap(pm.allocator),
                .allocator = pm.allocator,
                .argv = try pm.allocator.alloc(string, 7),
            });
            
            git_runner.argv[0] = try pm.allocator.dupe(u8, "git");
            git_runner.argv[1] = try pm.allocator.dupe(u8, "clone");
            git_runner.argv[2] = try pm.allocator.dupe(u8, "-c core.longpaths=true");
            git_runner.argv[3] = try pm.allocator.dupe(u8, "--quiet");
            git_runner.argv[4] = try pm.allocator.dupe(u8, "--no-checkout");
            git_runner.argv[5] = try pm.allocator.dupe(u8, repo_path);
            git_runner.argv[6] = try pm.allocator.dupe(u8, target);
            
            try git_runner.spawn();
        }
    }
};

pub const GitRunner = struct {
    const GitRunner = @This();
    const Process = bun.spawn.Process;
    const OutputReader = bun.io.BufferedReader;
    
    process: ?*Process = null,
    stdout: OutputReader = OutputReader.init(@This()),
    stderr: OutputReader = OutputReader.init(@This()),
    manager: *PackageManager,
    remaining_fds: i8 = 0,
    has_called_process_exit: bool = false,
    completion_context: CompletionContext,
    envp: [:null]?[*:0]const u8,
    allocator: std.mem.Allocator,
    argv: []const string,
    
    pub const CompletionContext = union(enum) {
        download: struct {
            name: string,
            url: string,
            task_id: u64,
            attempt: u8,
            log: *logger.Log,
            cache_dir: std.fs.Dir,
        },
        find_commit: struct {
            name: string,
            committish: string,
            task_id: u64,
            log: *logger.Log,
            repo_dir: std.fs.Dir,
        },
        checkout: struct {
            name: string,
            url: string,
            resolved: string,
            log: *logger.Log,
            cache_dir: std.fs.Dir,
            repo_dir: std.fs.Dir,
        },
    };
    
    pub const new = bun.TrivialNew(@This());
    
    pub fn eventLoop(this: *const GitRunner) *JSC.AnyEventLoop {
        return &this.manager.event_loop;
    }
    
    pub fn loop(this: *const GitRunner) *bun.uws.Loop {
        return this.manager.event_loop.loop();
    }
    
    pub fn spawn(this: *GitRunner) !void {
        this.stdout.setParent(this);
        this.stderr.setParent(this);
        
        const spawn_options = bun.spawn.SpawnOptions{
            .stdin = .ignore,
            .stdout = if (Environment.isPosix) .buffer else .{ .buffer = this.stdout.source.?.pipe },
            .stderr = if (Environment.isPosix) .buffer else .{ .buffer = this.stderr.source.?.pipe },
            .cwd = this.manager.cache_directory_path,
            .windows = if (Environment.isWindows) .{
                .loop = JSC.EventLoopHandle.init(&this.manager.event_loop),
            },
            .stream = false,
        };
        
        this.remaining_fds = 0;
        
        // Convert argv to null-terminated for spawning
        var argv_buf = try this.allocator.allocSentinel(?[*:0]const u8, this.argv.len, null);
        defer this.allocator.free(argv_buf);
        for (this.argv, 0..) |arg, i| {
            argv_buf[i] = try this.allocator.dupeZ(u8, arg);
        }
        
        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, argv_buf, this.envp)).unwrap();
        
        if (comptime Environment.isPosix) {
            if (spawned.stdout) |stdout| {
                if (!spawned.memfds[1]) {
                    this.stdout.setParent(this);
                    _ = bun.sys.setNonblocking(stdout);
                    this.remaining_fds += 1;
                    
                    resetOutputFlags(&this.stdout, stdout);
                    try this.stdout.start(stdout, true).unwrap();
                    if (this.stdout.handle.getPoll()) |poll| {
                        poll.flags.insert(.socket);
                    }
                } else {
                    this.stdout.setParent(this);
                    this.stdout.startMemfd(stdout);
                }
            }
            if (spawned.stderr) |stderr| {
                if (!spawned.memfds[2]) {
                    this.stderr.setParent(this);
                    _ = bun.sys.setNonblocking(stderr);
                    this.remaining_fds += 1;
                    
                    resetOutputFlags(&this.stderr, stderr);
                    try this.stderr.start(stderr, true).unwrap();
                    if (this.stderr.handle.getPoll()) |poll| {
                        poll.flags.insert(.socket);
                    }
                } else {
                    this.stderr.setParent(this);
                    this.stderr.startMemfd(stderr);
                }
            }
        } else if (comptime Environment.isWindows) {
            if (spawned.stdout == .buffer) {
                this.stdout.parent = this;
                this.remaining_fds += 1;
                try this.stdout.startWithCurrentPipe().unwrap();
            }
            if (spawned.stderr == .buffer) {
                this.stderr.parent = this;
                this.remaining_fds += 1;
                try this.stderr.startWithCurrentPipe().unwrap();
            }
        }
        
        const event_loop = &this.manager.event_loop;
        var process = spawned.toProcess(event_loop, false);
        
        if (this.process) |proc| {
            proc.detach();
            proc.deref();
        }
        
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
    
    fn resetOutputFlags(output: *OutputReader, fd: bun.FileDescriptor) void {
        output.flags.nonblocking = true;
        output.flags.socket = true;
        output.flags.memfd = false;
        output.flags.received_eof = false;
        output.flags.closed_without_reporting = false;
        
        if (comptime Environment.allow_assert) {
            const flags = bun.sys.getFcntlFlags(fd).unwrap() catch @panic("Failed to get fcntl flags");
            bun.assertWithLocation(flags & bun.O.NONBLOCK != 0, @src());
            
            const stat = bun.sys.fstat(fd).unwrap() catch @panic("Failed to fstat");
            bun.assertWithLocation(std.posix.S.ISSOCK(stat.mode), @src());
        }
    }
    
    pub fn onReaderDone(this: *GitRunner) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;
        this.maybeFinished();
    }
    
    pub fn onReaderError(this: *GitRunner, err: bun.sys.Error) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;
        
        Output.prettyErrorln("<r><red>error<r>: Failed to read git output due to error <b>{d} {s}<r>", .{
            err.errno,
            @tagName(err.getErrno()),
        });
        Output.flush();
        this.maybeFinished();
    }
    
    fn maybeFinished(this: *GitRunner) void {
        if (!this.has_called_process_exit or this.remaining_fds != 0)
            return;
        
        const process = this.process orelse return;
        this.handleExit(process.status);
    }
    
    pub fn onProcessExit(this: *GitRunner, proc: *Process, _: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        if (this.process != proc) {
            Output.debugWarn("<d>[GitRunner]<r> onProcessExit called with wrong process", .{});
            return;
        }
        this.has_called_process_exit = true;
        this.maybeFinished();
    }
    
    pub fn handleExit(this: *GitRunner, status: bun.spawn.Status) void {
        const task_id = this.getTaskId();
        
        switch (status) {
            .exited => |exit| {
                if (exit.code == 0) {
                    const stdout = this.stdout.finalBuffer();
                    
                    switch (this.completion_context) {
                        .download => |ctx| {
                            // Open the directory and notify completion
                            const folder_name = std.fmt.bufPrintZ(&folder_name_buf, "{any}.git", .{
                                bun.fmt.hexIntLower(ctx.task_id),
                            }) catch |err| {
                                this.manager.onGitError(ctx.task_id, err);
                                this.deinit();
                                return;
                            };
                            
                            const dir = ctx.cache_dir.openDirZ(folder_name, .{}) catch |err| {
                                this.manager.onGitError(ctx.task_id, err);
                                this.deinit();
                                return;
                            };
                            
                            this.manager.onGitDownloadComplete(ctx.task_id, dir) catch |err| {
                                this.manager.onGitError(ctx.task_id, err);
                            };
                            this.deinit();
                        },
                        .find_commit => |ctx| {
                            const commit = std.mem.trim(u8, stdout.items, " \t\r\n");
                            const commit_str = this.allocator.dupe(u8, commit) catch bun.outOfMemory();
                            this.manager.onGitFindCommitComplete(ctx.task_id, commit_str) catch |err| {
                                this.manager.onGitError(ctx.task_id, err);
                            };
                            this.deinit();
                        },
                        .checkout => |ctx| {
                            // Check if this is the first clone or the actual checkout  
                            // by looking for "clone" in the argv
                            var is_clone = false;
                            for (this.argv) |arg| {
                                if (strings.eqlComptime(arg, "clone")) {
                                    is_clone = true;
                                    break;
                                }
                            }
                            
                            if (is_clone) {
                                // This was the clone --no-checkout, now do the actual checkout
                                const folder = Path.joinAbsString(this.manager.cache_directory_path, &.{
                                    PackageManager.cachedGitFolderNamePrint(&folder_name_buf, ctx.resolved, null),
                                }, .auto);
                                
                                // Create a new GitRunner for the checkout command
                                var checkout_runner = this.manager.allocator.create(GitRunner) catch bun.outOfMemory();
                                checkout_runner.* = GitRunner.new(.{
                                    .process = null,
                                    .manager = this.manager,
                                    .completion_context = .{
                                        .checkout = ctx,
                                    },
                                    .envp = this.envp,
                                    .allocator = this.allocator,
                                    .argv = this.allocator.alloc(string, 6) catch bun.outOfMemory(),
                                });
                                
                                checkout_runner.argv[0] = this.allocator.dupe(u8, "git") catch bun.outOfMemory();
                                checkout_runner.argv[1] = this.allocator.dupe(u8, "-C") catch bun.outOfMemory();
                                checkout_runner.argv[2] = this.allocator.dupe(u8, folder) catch bun.outOfMemory();
                                checkout_runner.argv[3] = this.allocator.dupe(u8, "checkout") catch bun.outOfMemory();
                                checkout_runner.argv[4] = this.allocator.dupe(u8, "--quiet") catch bun.outOfMemory();
                                checkout_runner.argv[5] = this.allocator.dupe(u8, ctx.resolved) catch bun.outOfMemory();
                                
                                // Transfer ownership of envp to the new runner
                                this.envp = &[_]?[*:0]const u8{};
                                
                                checkout_runner.spawn() catch |err| {
                                    this.manager.onGitError(0, err);
                                    checkout_runner.deinit();
                                };
                                this.deinit();
                            } else {
                                // This was the final checkout, clean up and complete
                                const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, ctx.resolved, null);
                                
                                // Clean up .git directory
                                if (bun.openDir(ctx.cache_dir, folder_name)) |package_dir| {
                                    package_dir.deleteTree(".git") catch {};
                                    
                                    // Insert .bun-tag file
                                    if (ctx.resolved.len > 0) insert_tag: {
                                        const git_tag = package_dir.createFileZ(".bun-tag", .{ .truncate = true }) catch break :insert_tag;
                                        defer git_tag.close();
                                        git_tag.writeAll(ctx.resolved) catch {
                                            package_dir.deleteFileZ(".bun-tag") catch {};
                                        };
                                    }
                                    
                                    // Read package.json
                                    const json_file, const json_buf = bun.sys.File.readFileFrom(package_dir, "package.json", this.allocator).unwrap() catch |err| {
                                        if (err == error.ENOENT) {
                                            // Allow git dependencies without package.json
                                            this.manager.onGitCheckoutComplete(task_id, .{
                                                .url = ctx.url,
                                                .resolved = ctx.resolved,
                                            }) catch |checkout_err| {
                                                this.manager.onGitError(task_id, checkout_err);
                                            };
                                            package_dir.close();
                                            this.deinit();
                                            return;
                                        }
                                        
                                        ctx.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "\"package.json\" for \"{s}\" failed to open: {s}",
                                            .{ ctx.name, @errorName(err) },
                                        ) catch unreachable;
                                        this.manager.onGitError(task_id, error.InstallFailed);
                                        package_dir.close();
                                        this.deinit();
                                        return;
                                    };
                                    defer json_file.close();
                                    
                                    const json_path = json_file.getPath(
                                        &json_path_buf,
                                    ).unwrap() catch |err| {
                                        ctx.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "\"package.json\" for \"{s}\" failed to resolve: {s}",
                                            .{ ctx.name, @errorName(err) },
                                        ) catch unreachable;
                                        this.manager.onGitError(task_id, error.InstallFailed);
                                        this.allocator.free(json_buf);
                                        package_dir.close();
                                        this.deinit();
                                        return;
                                    };
                                    
                                    const ret_json_path = FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path) catch |err| {
                                        this.manager.onGitError(task_id, err);
                                        this.allocator.free(json_buf);
                                        package_dir.close();
                                        this.deinit();
                                        return;
                                    };
                                    
                                    this.manager.onGitCheckoutComplete(task_id, .{
                                        .url = ctx.url,
                                        .resolved = ctx.resolved,
                                        .json = .{
                                            .path = ret_json_path,
                                            .buf = json_buf,
                                        },
                                    }) catch |checkout_err| {
                                        this.manager.onGitError(task_id, checkout_err);
                                    };
                                    
                                    package_dir.close();
                                } else |err| {
                                    this.manager.onGitError(task_id, err);
                                }
                                this.deinit();
                            }
                        },
                    }
                } else {
                    // Check stderr for specific error messages
                    const stderr = this.stderr.finalBuffer();
                    const err = if ((strings.containsComptime(stderr.items, "remote:") and
                        strings.containsComptime(stderr.items, "not") and
                        strings.containsComptime(stderr.items, "found")) or
                        strings.containsComptime(stderr.items, "does not exist"))
                        error.RepositoryNotFound
                    else
                        error.InstallFailed;
                    
                    switch (this.completion_context) {
                        .download => |ctx| {
                            if (err == error.RepositoryNotFound and ctx.attempt == 1) {
                                ctx.log.addErrorFmt(
                                    null,
                                    logger.Loc.Empty,
                                    this.allocator,
                                    "\"git clone\" for \"{s}\" failed",
                                    .{ctx.name},
                                ) catch unreachable;
                            }
                        },
                        .find_commit => |ctx| {
                            ctx.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                this.allocator,
                                "no commit matching \"{s}\" found for \"{s}\" (but repository exists)",
                                .{ ctx.committish, ctx.name },
                            ) catch unreachable;
                        },
                        .checkout => |ctx| {
                            ctx.log.addErrorFmt(
                                null,
                                logger.Loc.Empty,
                                this.allocator,
                                "\"git checkout\" for \"{s}\" failed",
                                .{ctx.name},
                            ) catch unreachable;
                        },
                    }
                    
                    this.manager.onGitError(task_id, err);
                    this.deinit();
                }
            },
            .err => |err| {
                this.manager.onGitError(task_id, err.toError());
                this.deinit();
            },
            .signaled => |signal| {
                _ = signal;
                this.manager.onGitError(task_id, error.GitProcessKilled);
                this.deinit();
            },
            else => {
                this.manager.onGitError(task_id, error.UnknownGitError);
                this.deinit();
            },
        }
    }
    
    fn getTaskId(this: *const GitRunner) u64 {
        return switch (this.completion_context) {
            .download => |ctx| ctx.task_id,
            .find_commit => |ctx| ctx.task_id,
            .checkout => |ctx| ctx.task_id,
        };
    }
    
    pub fn deinit(this: *GitRunner) void {
        if (this.process) |process| {
            this.process = null;
            process.close();
            process.deref();
        }
        
        this.stdout.deinit();
        this.stderr.deinit();
        
        // Clean up argv
        for (this.argv) |arg| {
            this.allocator.free(arg);
        }
        this.allocator.free(this.argv);
        
        bun.destroy(this);
    }
};
