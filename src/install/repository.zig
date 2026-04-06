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
        const home_dir = bun.env_var.HOME.get() orelse return;

        var config_file_path_buf: bun.PathBuffer = undefined;
        const config_file_path = bun.path.joinAbsStringBufZ(home_dir, &config_file_path_buf, &.{".gitconfig"}, .auto);
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
    committish: String = .{},
    resolved: String = .{},
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
                var cloned = bun.handleOom(other.map.cloneWithAllocator(allocator));

                if (cloned.get("GIT_ASKPASS") == null) {
                    const config = SloppyGlobalGitConfig.get();
                    if (!config.has_askpass) {
                        bun.handleOom(cloned.put("GIT_ASKPASS", "echo"));
                    }
                }

                if (cloned.get("GIT_SSH_COMMAND") == null) {
                    const config = SloppyGlobalGitConfig.get();
                    if (!config.has_ssh_command) {
                        bun.handleOom(cloned.put("GIT_SSH_COMMAND", "ssh -oStrictHostKeyChecking=accept-new"));
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
            const name_buf = bun.handleOom(allocator.alloc(u8, bun.sha.EVP.SHA1.digest));
            var sha1 = bun.sha.SHA1.init();
            defer sha1.deinit();
            sha1.update(version_literal);
            sha1.final(name_buf[0..bun.sha.SHA1.digest]);
            return name_buf[0..bun.sha.SHA1.digest];
        }

        return bun.handleOom(allocator.dupe(u8, name));
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
            .committish = builder.append(String, this.committish.slice(buf)),
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

    pub fn formatAs(this: *const Repository, label: string, buf: []const u8, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        const formatter = Formatter{ .label = label, .repository = this, .buf = buf };
        return try formatter.format(writer);
    }

    pub fn fmtStorePath(this: *const Repository, label: string, string_buf: string) StorePathFormatter {
        return .{
            .repo = this,
            .label = label,
            .string_buf = string_buf,
        };
    }

    pub const StorePathFormatter = struct {
        repo: *const Repository,
        label: string,
        string_buf: string,

        pub fn format(this: StorePathFormatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
            try writer.print("{f}", .{Install.fmtStorePath(this.label)});

            if (!this.repo.owner.isEmpty()) {
                try writer.print("{f}", .{this.repo.owner.fmtStorePath(this.string_buf)});
                // try writer.writeByte(if (this.opts.replace_slashes) '+' else '/');
                try writer.writeByte('+');
            } else if (Dependency.isSCPLikePath(this.repo.repo.slice(this.string_buf))) {
                // try writer.print("ssh:{s}", .{if (this.opts.replace_slashes) "++" else "//"});
                try writer.writeAll("ssh++");
            }

            try writer.print("{f}", .{this.repo.repo.fmtStorePath(this.string_buf)});

            if (!this.repo.resolved.isEmpty()) {
                try writer.writeByte('+'); // this would be '#' but it's not valid on windows
                var resolved = this.repo.resolved.slice(this.string_buf);
                if (strings.lastIndexOfChar(resolved, '-')) |i| {
                    resolved = resolved[i + 1 ..];
                }
                try writer.print("{f}", .{Install.fmtStorePath(resolved)});
            } else if (!this.repo.committish.isEmpty()) {
                try writer.writeByte('+'); // this would be '#' but it's not valid on windows
                try writer.print("{f}", .{this.repo.committish.fmtStorePath(this.string_buf)});
            }
        }
    };

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
        pub fn format(formatter: Formatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
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

    /// Given the portion of a URL after `ssh://` (i.e. `user@host:9999/path` or
    /// `host:path`), returns true if it contains an explicit numeric port.
    ///
    /// Used to distinguish a real port from an scp-style path component:
    ///   - `user@host:9999/path` -> true (port 9999)
    ///   - `git@github.com:owner/repo` -> false (scp-style path)
    ///   - `host:9999` -> true
    ///   - `host:9999#branch` -> true
    ///   - `[2001:db8::1]:9999/path` -> true (bracketed IPv6 literal)
    ///   - `[2001:db8::1]/path` -> false (IPv6 without port)
    fn hasExplicitPort(after_scheme: string) bool {
        // RFC 3986 §3.2: the authority ends at the first `/`, `?`, or `#`.
        // A `@` inside the path (e.g. `/@scope/pkg` for scoped npm packages)
        // is NOT userinfo and must not be mistaken for it.
        const authority_end = for (after_scheme, 0..) |c, i| {
            switch (c) {
                '/', '?', '#' => break i,
                else => {},
            }
        } else after_scheme.len;
        const authority = after_scheme[0..authority_end];

        // Skip past `user@` or `user:pass@` within the authority only.
        const host_start = if (strings.indexOfChar(authority, '@')) |at| at + 1 else 0;
        const rest = after_scheme[host_start..];

        // Find the `:` that would separate host from port. Bracketed IPv6
        // literals like `[2001:db8::1]:9999` have colons inside the brackets
        // that are part of the address, not a port separator — skip past the
        // `]` and only accept a colon immediately after it.
        const colon = brk: {
            if (rest.len > 0 and rest[0] == '[') {
                const end_bracket = strings.indexOfChar(rest, ']') orelse return false;
                if (end_bracket + 1 >= rest.len or rest[end_bracket + 1] != ':') return false;
                break :brk end_bracket + 1;
            }

            const c = strings.indexOfChar(rest, ':') orelse return false;
            // If there's a `/`, `#`, or `?` before the colon, there's no port.
            for (rest[0..c]) |ch| switch (ch) {
                '/', '#', '?' => return false,
                else => {},
            };
            break :brk c;
        };

        // Everything after the colon up to a path/fragment/query separator must
        // be digits, and there must be at least one digit.
        const after_colon = rest[colon + 1 ..];
        var i: usize = 0;
        while (i < after_colon.len) : (i += 1) {
            switch (after_colon[i]) {
                '0'...'9' => {},
                '/', '#', '?' => break,
                else => return false,
            }
        }
        return i > 0;
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
            // If the URL already has an explicit numeric port (e.g.
            // ssh://user@host:9999/path), it's well-formed — don't run it
            // through correctUrl(), which would turn the `:` into `/` and
            // mangle the port into a path segment.
            if (hasExplicitPort(url["ssh://".len..])) {
                return url;
            }

            // TODO(markovejnovic): This is a stop-gap. One of the problems with the implementation
            // here is that we should integrate hosted_git_info more thoroughly into the codebase
            // to avoid the allocation and copy here. For now, the thread-local buffer is a good
            // enough solution to avoid having to handle init/deinit.

            // Fix malformed ssh:// URLs with colons using hosted_git_info.correctUrl
            // ssh://git@github.com:user/repo -> ssh://git@github.com/user/repo
            var pair = hosted_git_info.UrlProtocolPair{
                .url = .{ .unmanaged = url },
                .protocol = .{ .well_formed = .git_plus_ssh },
            };

            var corrected = hosted_git_info.correctUrl(&pair, bun.default_allocator) catch {
                return url; // If correction fails, return original
            };
            defer corrected.deinit();

            // Copy corrected URL to thread-local buffer
            const corrected_str = corrected.urlSlice();
            const result = ssh_path_buf[0..corrected_str.len];
            bun.copy(u8, result, corrected_str);
            return result;
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
            // If the user pinned an explicit port (e.g. ssh://host:9999/...),
            // the port belongs to SSH. Speaking HTTPS to it would hang (or
            // fail slowly) waiting for an HTTPS response from sshd — skip the
            // HTTPS attempt and go straight to SSH.
            if (hasExplicitPort(url["ssh://".len..])) {
                return null;
            }

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
        allocator: std.mem.Allocator,
        env: DotEnv.Map,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        task_id: Install.Task.Id,
        name: string,
        url: string,
        attempt: u8,
    ) !std.fs.Dir {
        bun.analytics.Features.git_dependencies += 1;
        const folder_name = try std.fmt.bufPrintZ(&folder_name_buf, "{f}.git", .{
            bun.fmt.hexIntLower(task_id.get()),
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
                "-c",
                "core.longpaths=true",
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

    pub fn findCommit(
        allocator: std.mem.Allocator,
        env: *DotEnv.Loader,
        log: *logger.Log,
        repo_dir: std.fs.Dir,
        name: string,
        committish: string,
        task_id: Install.Task.Id,
    ) !string {
        const path = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{try std.fmt.bufPrint(&folder_name_buf, "{f}.git", .{
            bun.fmt.hexIntLower(task_id.get()),
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

    pub fn checkout(
        allocator: std.mem.Allocator,
        env: DotEnv.Map,
        log: *logger.Log,
        cache_dir: std.fs.Dir,
        repo_dir: std.fs.Dir,
        name: string,
        url: string,
        resolved: string,
    ) !ExtractData {
        bun.analytics.Features.git_dependencies += 1;
        const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, resolved, null);

        var package_dir = bun.openDir(cache_dir, folder_name) catch |not_found| brk: {
            if (not_found != error.ENOENT) return not_found;

            const target = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{folder_name}, .auto);

            _ = exec(allocator, env, &[_]string{
                "git",
                "clone",
                "-c",
                "core.longpaths=true",
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
};

pub const TestingAPIs = struct {
    pub fn jsTrySSH(go: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        if (callframe.argumentsCount() != 1) {
            return go.throw("repository.trySSH takes exactly 1 argument", .{});
        }
        const arg0 = callframe.argument(0);
        if (!arg0.isString()) {
            return go.throw("repository.trySSH takes a string as its first argument", .{});
        }
        const url_str = try arg0.toBunString(go);
        defer url_str.deref();
        var as_utf8 = url_str.toUTF8(bun.default_allocator);
        defer as_utf8.deinit();
        const result = Repository.trySSH(as_utf8.slice()) orelse return .null;
        // trySSH may return either a slice into `as_utf8` (pass-through) or a
        // slice into the thread-local `ssh_path_buf` (rewritten). Copy it into
        // an owned String before returning to JS.
        var cloned = bun.String.cloneUTF8(result);
        defer cloned.deref();
        return cloned.toJS(go);
    }

    pub fn jsTryHTTPS(go: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        if (callframe.argumentsCount() != 1) {
            return go.throw("repository.tryHTTPS takes exactly 1 argument", .{});
        }
        const arg0 = callframe.argument(0);
        if (!arg0.isString()) {
            return go.throw("repository.tryHTTPS takes a string as its first argument", .{});
        }
        const url_str = try arg0.toBunString(go);
        defer url_str.deref();
        var as_utf8 = url_str.toUTF8(bun.default_allocator);
        defer as_utf8.deinit();
        const result = Repository.tryHTTPS(as_utf8.slice()) orelse return .null;
        // tryHTTPS may return a slice into `as_utf8` (http pass-through) or a
        // slice into the thread-local `final_path_buf` (rewritten). Copy.
        var cloned = bun.String.cloneUTF8(result);
        defer cloned.deref();
        return cloned.toJS(go);
    }
};

const string = []const u8;

const Dependency = @import("./dependency.zig");
const DotEnv = @import("../env_loader.zig");
const Environment = @import("../env.zig");
const hosted_git_info = @import("./hosted_git_info.zig");
const std = @import("std");
const FileSystem = @import("../fs.zig").FileSystem;

const Install = @import("./install.zig");
const ExtractData = Install.ExtractData;
const PackageManager = Install.PackageManager;

const bun = @import("bun");
const OOM = bun.OOM;
const Path = bun.path;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;
const File = bun.sys.File;

const Semver = bun.Semver;
const String = Semver.String;
