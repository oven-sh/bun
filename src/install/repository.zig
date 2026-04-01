const debug = bun.Output.scoped(.GitRepository, .hidden);

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

        const result = try std.process.Child.run(.{
            .allocator = allocator,
            .argv = argv,
            .env_map = std_map.get(),
        });

        switch (result.term) {
            .Exited => |sig| if (sig == 0) return result.stdout else {
                // Log stderr so operators can diagnose git CLI failures
                if (result.stderr.len > 0) {
                    debug("git CLI exited {d}: {s}", .{ sig, std.mem.trimRight(u8, result.stderr, "\r\n") });
                } else {
                    debug("git CLI exited {d} (no stderr)", .{sig});
                }
                if (
                // remote: The page could not be found <-- for non git
                // remote: Repository not found. <-- for git
                // remote: fatal repository '<url>' does not exist <-- for git
                (strings.containsComptime(result.stderr, "remote:") and
                    strings.containsComptime(result.stderr, "not") and
                    strings.containsComptime(result.stderr, "found")) or
                    strings.containsComptime(result.stderr, "does not exist") or
                    // fatal: '<url>' does not appear to be a git repository
                    strings.containsComptime(result.stderr, "does not appear to be a git repository") or
                    // fatal: could not read Username for 'https://...': No such device or address
                    // This happens when GIT_ASKPASS=echo (bun's default) and repo is private/missing
                    strings.containsComptime(result.stderr, "could not read Username"))
                {
                    return error.RepositoryNotFound;
                }
                return error.InstallFailed;
            },
            else => {
                if (result.stderr.len > 0) {
                    debug("git CLI terminated abnormally: {s}", .{std.mem.trimRight(u8, result.stderr, "\r\n")});
                } else {
                    debug("git CLI terminated abnormally (signal/unknown, no stderr)", .{});
                }
                return error.InstallFailed;
            },
        }
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
            // ssh://git@github.com/user/repo → https://github.com/user/repo
            // Strip userinfo (e.g. "git@") when converting to HTTPS
            const after_scheme = url["ssh://".len..];
            const host_start = if (strings.indexOfChar(after_scheme, '@')) |at| at + 1 else 0;
            const path_part = after_scheme[host_start..];
            final_path_buf[0.."https://".len].* = "https://".*;
            bun.copy(u8, final_path_buf["https://".len..], path_part);
            return final_path_buf[0 .. "https://".len + path_part.len];
        }

        if (Dependency.isSCPLikePath(url)) {
            // SCP-like: git@github.com:user/repo → https://github.com/user/repo
            // Strip userinfo prefix (e.g. "git@") before the host
            const host_start = if (strings.indexOfChar(url, '@')) |at| at + 1 else 0;
            const host_and_path = url[host_start..];

            final_path_buf[0.."https://".len].* = "https://".*;
            var rest = final_path_buf["https://".len..];

            const colon_index = strings.indexOfChar(host_and_path, ':');

            if (colon_index) |colon| {
                // make sure known hosts have `.com` or `.org`
                if (Hosts.get(host_and_path[0..colon])) |tld| {
                    bun.copy(u8, rest, host_and_path[0..colon]);
                    bun.copy(u8, rest[colon..], tld);
                    rest[colon + tld.len] = '/';
                    bun.copy(u8, rest[colon + tld.len + 1 ..], host_and_path[colon + 1 ..]);
                    const out = final_path_buf[0 .. "https://".len + host_and_path.len + tld.len];
                    return out;
                }
            }

            bun.copy(u8, rest, host_and_path);
            if (colon_index) |colon| rest[colon] = '/';
            return final_path_buf[0 .. "https://".len + host_and_path.len];
        }

        return null;
    }

    fn isSshAuthError(err: anyerror) bool {
        return err == error.SshProcessFailed or
            err == error.SshCloneFailed or
            err == error.SshFetchFailed or
            err == error.InvalidSshUrl or
            // Defensive: these may be added to ziggit in the future
            err == error.SshAuthFailed or
            err == error.SshKeyNotFound or
            err == error.SshAgentFailure;
    }

    fn isProtocolError(err: anyerror) bool {
        return err == error.UnsupportedPackVersion or
            err == error.UnsupportedIndexVersion or
            err == error.UnsupportedPackIndexVersion or
            err == error.UnsupportedPackType or
            err == error.InvalidUrl or
            err == error.InvalidPktLine or
            err == error.UnsupportedMode or
            err == error.NotSupported or
            err == error.NotImplemented or
            // Defensive: may be added to ziggit
            err == error.NetworkRemoteNotSupported or
            err == error.UnsupportedUrlScheme;
    }

    fn isDataIntegrityError(err: anyerror) bool {
        return err == error.ChecksumMismatch or
            err == error.PackChecksumMismatch or
            err == error.ObjectCountMismatch or
            err == error.ObjectSizeMismatch or
            err == error.InvalidPackFile or
            err == error.InvalidPack or
            err == error.InvalidPackData or
            err == error.InvalidPackObject or
            err == error.InvalidPackIndex or
            err == error.InvalidPackOffset or
            err == error.CorruptedPackIndex or
            err == error.PackIndexCorrupted or
            err == error.SuspiciousPackIndex or
            err == error.InvalidPackSignature or
            err == error.InvalidPackObjectType or
            err == error.InvalidDelta or
            err == error.InvalidDeltaOffset or
            err == error.DeltaCopyOutOfBounds or
            err == error.DeltaInsertOutOfBounds or
            err == error.DeltaMissingHeaders or
            err == error.DeltaReservedCommand or
            err == error.DeltaTruncated or
            err == error.InvalidFanoutTable or
            err == error.InvalidIndex or
            err == error.InvalidHash or
            err == error.InvalidObject or
            err == error.InvalidTree or
            err == error.InvalidTreeFormat or
            err == error.InvalidBlobObject or
            err == error.InvalidCommitObject or
            err == error.InvalidTreeObject or
            err == error.CorruptObject or
            err == error.EmptyPackFile or
            err == error.PackFileTooSmall or
            err == error.NoPackData or
            // idx_writer / pack parsing errors
            err == error.EmptyBaseData or
            err == error.IndexNotFound or
            err == error.IndexNotSorted or
            err == error.IndexTooLarge or
            err == error.IndexTooSmall or
            err == error.IndexVersionTooNew or
            err == error.IndexVersionTooOld or
            err == error.InsufficientDataAtOffset or
            err == error.InvalidHashCharacter or
            err == error.InvalidHashLength or
            err == error.InvalidObjectType or
            err == error.InvalidOffset or
            err == error.InvalidPackPath or
            err == error.ObjectSizeTooLarge or
            err == error.OffsetBeyondData or
            err == error.OffsetBeyondPackContent or
            err == error.OffsetOutOfBounds or
            err == error.Overflow or
            err == error.PackIndexTooLarge or
            err == error.PackIndexTooSmall or
            err == error.PackIndexLowEntropy or
            err == error.PackIndexReadError or
            err == error.RefDeltaRequiresExternalLookup or
            err == error.VarIntTooLarge or
            err == error.TooManyObjectsInPack or
            err == error.TooManyIndexEntries or
            err == error.UnresolvedRefDelta or
            // Defensive: may be added to ziggit
            err == error.InvalidFileMode or
            err == error.InvalidMode or
            // Defensive: may be added to ziggit
            err == error.CorruptedData or
            err == error.BadChecksum or
            err == error.InvalidIdx;
    }

    fn isFilesystemError(err: anyerror) bool {
        return err == error.AlreadyExists or
            err == error.PathAlreadyExists or
            err == error.PackDirectoryAccessDenied or
            err == error.PackDirectoryError or
            err == error.PackDirectoryOnUnmountedDevice or
            err == error.PackDirectorySymlinkLoop or
            err == error.PackIndexAccessDenied or
            err == error.PackIndexBusy or
            err == error.PackIndexIsDirectory or
            err == error.PackedRefsAccessDenied or
            err == error.PathTooLong or
            err == error.InvalidPathCharacters or
            err == error.EmptyPath or
            err == error.FileNotFound or
            err == error.AccessDenied or
            err == error.FileBusy or
            err == error.IsDir or
            err == error.NoDevice or
            err == error.SymLinkLoop;
    }

    fn isResourceExhaustedError(err: anyerror) bool {
        return err == error.SystemResourcesExhausted or
            err == error.ProcessFdQuotaExceeded or
            err == error.SystemFdQuotaExceeded or
            err == error.SystemResources or
            err == error.ConfigFileTooLarge or
            err == error.ExtensionDataTooLarge or
            err == error.TooManyConfigLines;
    }

    /// Categorize and log ziggit errors with actionable context.
    /// Distinguishes auth failures, network errors, ref resolution,
    /// filesystem issues, resource exhaustion, and unsupported protocols
    /// from generic errors so operators can diagnose issues from debug logs.
    fn logZiggitError(operation: []const u8, name: string, err: anyerror) void {
        const err_name = @errorName(err);
        if (isSshAuthError(err)) {
            debug("{s}: ziggit SSH auth failed ({s}) for \"{s}\" (check SSH keys / GIT_SSH_COMMAND), falling back to git CLI", .{ operation, err_name, name });
        } else if (isNetworkError(err)) {
            debug("{s}: ziggit network error ({s}) for \"{s}\", falling back to git CLI", .{ operation, err_name, name });
        } else if (isProtocolError(err)) {
            debug("{s}: ziggit does not support this protocol ({s}) for \"{s}\", falling back to git CLI", .{ operation, err_name, name });
        } else if (isRefResolutionError(err)) {
            debug("{s}: ziggit ref/object resolution failed ({s}) for \"{s}\", falling back to git CLI", .{ operation, err_name, name });
        } else if (err == error.OutOfMemory or isResourceExhaustedError(err)) {
            debug("{s}: ziggit resource exhausted ({s}) for \"{s}\", falling back to git CLI", .{ operation, err_name, name });
        } else if (isFilesystemError(err)) {
            debug("{s}: ziggit filesystem error ({s}) for \"{s}\" (check permissions/paths), falling back to git CLI", .{ operation, err_name, name });
        } else if (isDataIntegrityError(err)) {
            debug("{s}: ziggit data integrity error ({s}) for \"{s}\", falling back to git CLI", .{ operation, err_name, name });
        } else {
            debug("{s}: ziggit failed ({s}) for \"{s}\", falling back to git CLI", .{ operation, err_name, name });
        }
    }

    fn isNetworkError(err: anyerror) bool {
        return err == error.HttpError or
            err == error.HttpCloneFailed or
            err == error.HttpFetchFailed or
            err == error.SideBandError or
            err == error.RemoteNotFound or
            err == error.EndOfStream or
            // std network errors (ziggit uses std.http/net internally)
            err == error.ConnectionRefused or
            err == error.ConnectionTimedOut or
            err == error.ConnectionResetByPeer or
            err == error.ConnectionAborted or
            err == error.HostUnreachable or
            err == error.NetworkUnreachable or
            err == error.UnknownHostName or
            err == error.TemporaryNameResolutionFailure or
            err == error.TlsError or
            err == error.TlsFailure or
            err == error.BrokenPipe or
            err == error.ReadFailed;
    }

    fn isRefResolutionError(err: anyerror) bool {
        return err == error.RefNotFound or
            err == error.ObjectNotFound or
            err == error.BranchNotFound or
            err == error.TreeNotFound or
            err == error.InvalidRef or
            err == error.InvalidRefName or
            err == error.InvalidRefNameChar or
            err == error.InvalidBranchName or
            err == error.EmptyRefName or
            err == error.EmptyBranchName or
            err == error.InvalidCommit or
            err == error.InvalidCommitHash or
            err == error.InvalidHEAD or
            err == error.CircularRef or
            err == error.TooManySymbolicRefs or
            err == error.PackNotFound or
            err == error.PackFileNotFound or
            err == error.CommitNotFound or
            err == error.NotAGitRepository or
            err == error.NotACommit or
            err == error.NotATree or
            err == error.NotATreeObject or
            err == error.UnknownRevision or
            err == error.NoHEAD or
            err == error.NoCommitsYet or
            err == error.NoValidBranch or
            err == error.InvalidStartPoint or
            err == error.MaxDepthExceeded or
            err == error.RefNameTooLong or
            err == error.TreeCycle or
            err == error.NoTagsFound;
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
        debug("download: \"{s}\" attempt {d} (url: {s})", .{ name, attempt, url });
        const folder_name = try std.fmt.bufPrintZ(&folder_name_buf, "{f}.git", .{
            bun.fmt.hexIntLower(task_id.get()),
        });

        return if (cache_dir.openDirZ(folder_name, .{})) |dir_const| fetch: {
            var dir = dir_const;
            const path = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{folder_name}, .auto);

            // Try ziggit first for any protocol (HTTPS, SSH, or SCP-style)
            // ziggit handles: https://, ssh://, git@host:path natively
            // tryHTTPS prefers HTTPS when available (faster), otherwise use original URL
            const fetch_url = tryHTTPS(url) orelse url;
            ziggit_fetch: {
                if (strings.eql(fetch_url, url)) {
                    debug("fetch: trying ziggit for \"{s}\" (url: {s})", .{ name, fetch_url });
                } else {
                    debug("fetch: trying ziggit for \"{s}\" (url: {s}, transformed from: {s})", .{ name, fetch_url, url });
                }
                // Use openBare for cached bare repos — skips HEAD validation,
                // eagerly mmaps pack/idx for fast object lookups
                var repo = ziggit.Repository.openBare(allocator, path) catch |err| {
                    logZiggitError("fetch/open", name, err);
                    break :ziggit_fetch;
                };
                defer repo.close();
                repo.fetch(fetch_url) catch |err| {
                    if (err == error.RepositoryNotFound) {
                        // Over HTTPS, a 404 is definitive. Over SSH, "not found"
                        // may actually be an auth/permission issue, so fall back
                        // to git CLI which can handle SSH agent prompts.
                        const used_https = strings.hasPrefixComptime(fetch_url, "https://");
                        if (used_https) {
                            debug("fetch: ziggit reports repository not found (HTTPS 404) for \"{s}\"", .{name});
                            dir.close();
                            if (attempt > 1) {
                                log.addErrorFmt(null, logger.Loc.Empty, allocator, "\"git fetch\" for \"{s}\" failed: repository not found", .{name}) catch unreachable;
                            }
                            return error.RepositoryNotFound;
                        }
                        debug("fetch: ziggit reports not found over SSH for \"{s}\", falling back to git CLI", .{name});
                    } else {
                        logZiggitError("fetch", name, err);
                    }
                    break :ziggit_fetch;
                };
                debug("fetch: ziggit succeeded for \"{s}\"", .{name});
                debug("[ZIGGIT] fetch: ziggit succeeded for \"{s}\"", .{name});
                break :fetch dir;
            }
            // Ziggit failed — fall back to git CLI
            debug("fetch: using git CLI for \"{s}\"", .{name});
            debug("[ZIGGIT] fetch: using git CLI fallback for \"{s}\"", .{name});
            _ = exec(allocator, env, &[_]string{ "git", "-C", path, "fetch", "--quiet" }) catch |err| {
                dir.close();
                log.addErrorFmt(null, logger.Loc.Empty, allocator, "\"git fetch\" for \"{s}\" failed", .{name}) catch unreachable;
                return err;
            };
            break :fetch dir;
        } else |not_found| clone: {
            if (not_found != error.FileNotFound) return not_found;

            const target = Path.joinAbsString(PackageManager.get().cache_directory_path, &.{folder_name}, .auto);

            // Try ziggit first for any protocol (HTTPS, SSH, or SCP-style)
            // ziggit handles: https://, ssh://, git@host:path natively
            const clone_url = tryHTTPS(url) orelse url;
            ziggit_clone: {
                if (strings.eql(clone_url, url)) {
                    debug("clone: trying ziggit for \"{s}\" (url: {s})", .{ name, clone_url });
                } else {
                    debug("clone: trying ziggit for \"{s}\" (url: {s}, transformed from: {s})", .{ name, clone_url, url });
                }
                // Use shallow clone (depth=1) for HTTPS git deps — only need the target commit.
                // This dramatically reduces download size for large repos.
                const use_shallow = strings.hasPrefixComptime(clone_url, "https://");
                var repo = (if (use_shallow)
                    ziggit.Repository.cloneBareShallow(allocator, clone_url, target, 1)
                else
                    ziggit.Repository.cloneBare(allocator, clone_url, target)) catch |err| {
                    if (err == error.RepositoryNotFound) {
                        // Over HTTPS, a 404 is definitive — the remote confirmed
                        // the repo doesn't exist, so no point falling back to git CLI.
                        // Over SSH, "not found" may mask auth/permission errors,
                        // so fall back to git CLI which handles SSH agent prompts.
                        const used_https = strings.hasPrefixComptime(clone_url, "https://");
                        if (used_https) {
                            debug("clone: ziggit reports repository not found (HTTPS 404) for \"{s}\"", .{name});
                            // Clean up any partial clone directory
                            std.fs.cwd().deleteTree(target) catch {};
                            if (attempt > 1) {
                                log.addErrorFmt(null, logger.Loc.Empty, allocator, "\"git clone\" for \"{s}\" failed: repository not found", .{name}) catch unreachable;
                            }
                            return error.RepositoryNotFound;
                        }
                        debug("clone: ziggit reports not found over SSH for \"{s}\", falling back to git CLI", .{name});
                    } else {
                        logZiggitError("clone", name, err);
                    }
                    // Clean up any partial clone directory before falling back to git CLI
                    std.fs.cwd().deleteTree(target) catch {};
                    break :ziggit_clone;
                };
                defer repo.close();
                debug("clone: ziggit succeeded for \"{s}\"", .{name});
                debug("[ZIGGIT] clone: ziggit succeeded for \"{s}\"", .{name});
                break :clone try cache_dir.openDirZ(folder_name, .{});
            }
            // Ziggit failed — fall back to git CLI
            debug("clone: using git CLI for \"{s}\"", .{name});
            debug("[ZIGGIT] clone: using git CLI fallback for \"{s}\"", .{name});
            _ = exec(allocator, env, &[_]string{
                "git", "clone", "-c", "core.longpaths=true", "--quiet", "--bare", url, target,
            }) catch |exec_err| {
                // Clean up any partial clone directory left by failed git CLI
                std.fs.cwd().deleteTree(target) catch {};
                if (exec_err == error.RepositoryNotFound or attempt > 1) {
                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "\"git clone\" for \"{s}\" failed", .{name}) catch unreachable;
                }
                return exec_err;
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

        // repo_dir is kept in the signature for API compatibility; we resolve
        // the path from task_id + cache_directory_path instead.
        _ = repo_dir;

        // Use ziggit for ~50x faster commit resolution (no process spawn overhead)
        {
            const ref = if (committish.len > 0) committish else "HEAD";
            debug("findCommit: trying ziggit for \"{s}\" ref=\"{s}\"", .{ name, ref });
            // Use openBare for cached bare repos — skips HEAD validation,
            // eagerly mmaps pack/idx, pre-warms packed-refs hash map
            var repo = ziggit.Repository.openBare(allocator, path) catch |err| {
                logZiggitError("findCommit/open", name, err);
                return findCommitFallback(allocator, env, log, path, name, committish);
            };
            defer repo.close();
            const hash = repo.findCommit(ref) catch |err| {
                logZiggitError("findCommit/resolve", name, err);
                return findCommitFallback(allocator, env, log, path, name, committish);
            };
            debug("findCommit: ziggit resolved \"{s}\" -> {s}", .{ ref, &hash });
                debug("[ZIGGIT] findCommit: ziggit succeeded for \"{s}\"", .{name});
            const result = bun.handleOom(allocator.alloc(u8, 40));
            @memcpy(result, &hash);
            return result;
        }
    }

    fn findCommitFallback(
        allocator: std.mem.Allocator,
        env: *DotEnv.Loader,
        log: *logger.Log,
        path: string,
        name: string,
        committish: string,
    ) !string {
        debug("findCommit: using git CLI fallback for \"{s}\"", .{name});
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
            const local_bare_path = try bun.getFdPath(.fromStdDir(repo_dir), &final_path_buf);

            // Try ziggit for direct checkout from bare repo (no intermediate clone)
            // This uses openBare + checkoutTo which extracts files directly from pack,
            // avoiding the overhead of creating a non-bare repo with .git dir.
            debug("checkout: trying ziggit for \"{s}\" resolved={s} bare_path={s}", .{ name, resolved, local_bare_path });
            const ziggit_ok = blk: {
                // Create target directory
                std.fs.cwd().makePath(target) catch |err| {
                    debug("checkout: failed to create target dir: {s}", .{@errorName(err)});
                    break :blk false;
                };
                // Open bare repo directly (fast: mmap pack/idx, no dir copy)
                var repo = ziggit.Repository.openBare(allocator, local_bare_path) catch |err| {
                    logZiggitError("checkout/open", name, err);
                    std.fs.cwd().deleteTree(target) catch {};
                    break :blk false;
                };
                defer repo.close();
                // Extract tree at resolved commit directly to target dir
                // Use checkoutToHash when resolved is a full 40-char hex hash
                // (avoids redundant findCommit ref resolution inside checkoutTo)
                const checkout_err = if (resolved.len == 40)
                    repo.checkoutToHash(resolved, target)
                else
                    repo.checkoutTo(resolved, target);
                checkout_err catch |err| {
                    logZiggitError("checkout/checkoutTo", name, err);
                    std.fs.cwd().deleteTree(target) catch {};
                    break :blk false;
                };
                debug("checkout: ziggit succeeded for \"{s}\"", .{name});
                break :blk true;
            };

            if (!ziggit_ok) {
                debug("checkout: using git CLI fallback for \"{s}\"", .{name});
                // Fall back to git CLI
                _ = exec(allocator, env, &[_]string{
                    "git", "clone", "-c", "core.longpaths=true", "--quiet", "--no-checkout",
                    local_bare_path, target,
                }) catch |err| {
                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "\"git clone\" for \"{s}\" failed", .{name}) catch unreachable;
                    std.fs.cwd().deleteTree(target) catch {};
                    return err;
                };

                _ = exec(allocator, env, &[_]string{ "git", "-C", target, "checkout", "--quiet", resolved }) catch |err| {
                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "\"git checkout\" for \"{s}\" at {s} failed", .{ name, resolved }) catch unreachable;
                    // Clean up partial checkout directory on failure
                    std.fs.cwd().deleteTree(target) catch {};
                    return err;
                };
            }

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
const logger = bun.logger;
const strings = bun.strings;
const File = bun.sys.File;

const ziggit = @import("ziggit");

const Semver = bun.Semver;
const String = Semver.String;
