const PackageManager = @import("./install.zig").PackageManager;
const Lockfile = @import("./lockfile.zig");
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const SlicedString = Semver.SlicedString;
const std = @import("std");
const GitSHA = String;
const bun = @import("../bun.zig");
const string = @import("../string_types.zig").string;
const strings = @import("../bun.zig").strings;
const Environment = @import("../env.zig");
const Group = Semver.Query.Group;

pub const Repository = extern struct {
    owner: String = String{},
    repo: String = String{},
    committish: GitSHA = GitSHA{},

    pub fn order(lhs: *const Repository, rhs: *const Repository, lhs_buf: []const u8, rhs_buf: []const u8) std.math.Order {
        const owner_order = lhs.owner.order(&rhs.owner, lhs_buf, rhs_buf);
        if (owner_order != .eq) return owner_order;
        const repo_order = lhs.repo.order(&rhs.repo, lhs_buf, rhs_buf);
        if (repo_order != .eq) return repo_order;

        return lhs.committish.order(&rhs.committish, lhs_buf, rhs_buf);
    }

    pub fn count(this: Repository, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
        builder.count(this.owner.slice(buf));
        builder.count(this.repo.slice(buf));
        builder.count(this.committish.slice(buf));
    }

    pub fn clone(this: Repository, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) Repository {
        return Repository{
            .owner = builder.append(String, this.owner.slice(buf)),
            .repo = builder.append(String, this.repo.slice(buf)),
            .committish = builder.append(GitSHA, this.committish.slice(buf)),
        };
    }

    pub fn eql(lhs: Repository, rhs: Repository, lhs_buf: []const u8, rhs_buf: []const u8) bool {
        return lhs.owner.eql(rhs.owner, lhs_buf, rhs_buf) and
            lhs.repo.eql(rhs.repo, lhs_buf, rhs_buf) and
            lhs.committish.eql(rhs.committish, lhs_buf, rhs_buf);
    }

    pub fn formatAs(this: Repository, label: string, buf: []const u8, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        const formatter = Formatter{ .label = label, .repository = this, .buf = buf };
        return try formatter.format(layout, opts, writer);
    }

    pub fn getGitHubURL(this: Repository, lockfile: *Lockfile, buf: *[bun.MAX_PATH_BYTES]u8) []u8 {
        const github = "https://github.com/";
        const owner = lockfile.str(this.owner);
        const repo = lockfile.str(this.repo);
        const committish = lockfile.str(this.committish);

        var i: usize = 0;
        std.mem.copy(u8, buf[i..], github);
        i += github.len;

        std.mem.copy(u8, buf[i..], owner);
        i += owner.len;
        buf[i] = '/';
        i += 1;
        std.mem.copy(u8, buf[i..], repo);
        i += repo.len;
        if (committish.len > 0) {
            buf[i] = '#';
            i += 1;
            std.mem.copy(u8, buf[i..], committish);
            i += committish.len;
        }

        return buf[0..i];
    }

    pub fn getURL(this: Repository, lockfile: *Lockfile, buf: *[bun.MAX_PATH_BYTES]u8) []u8 {
        const owner = lockfile.str(this.owner);
        const repo = lockfile.str(this.repo);
        const committish = lockfile.str(this.committish);

        var i: usize = 0;
        std.mem.copy(u8, buf[i..], owner);
        i += owner.len;
        buf[i] = '/';
        i += 1;
        std.mem.copy(u8, buf[i..], repo);
        i += repo.len;
        if (committish.len > 0) {
            buf[i] = '#';
            i += 1;
            std.mem.copy(u8, buf[i..], committish);
            i += committish.len;
        }

        return buf[0..i];
    }

    pub fn getCacheDirectoryForGitHub(this: Repository, manager: *PackageManager, buf: *[bun.MAX_PATH_BYTES]u8) ![]u8 {
        var url_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const url = this.getGitHubURL(manager.lockfile, &url_buf);

        const url_hash = std.hash.Wyhash.hash(0, url);
        const hex_fmt = bun.fmt.hexIntLower(url_hash);

        const repo = manager.lockfile.str(this.repo);

        return try std.fmt.bufPrint(buf, "{s}-{any}", .{ repo[0..@min(16, repo.len)], hex_fmt });
    }

    pub fn getCacheDirectory(this: Repository, manager: *PackageManager, buf: *[bun.MAX_PATH_BYTES]u8) ![]u8 {
        var url_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const url = this.getURL(manager.lockfile, &url_buf);

        const url_hash = std.hash.Wyhash.hash(0, url);
        const hex_fmt = bun.fmt.hexIntLower(url_hash);

        const repo = manager.lockfile.str(this.repo);

        return try std.fmt.bufPrint(buf, "{s}-{any}", .{ repo[0..@min(16, repo.len)], hex_fmt });
    }

    pub fn getCachePathForGitHub(this: Repository, manager: *PackageManager, buf: *[bun.MAX_PATH_BYTES]u8) ![]u8 {
        var url_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const url = this.getGitHubURL(manager.lockfile, &url_buf);

        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const path = try std.os.getFdPath(manager.getGitCacheDirectory().dir.fd, &path_buf);

        const url_hash = std.hash.Wyhash.hash(0, url);
        const hex_fmt = bun.fmt.hexIntLower(url_hash);

        const repo = manager.lockfile.str(this.repo);

        return try std.fmt.bufPrint(buf, "{s}/{s}-{any}", .{ path, repo[0..@min(16, repo.len)], hex_fmt });
    }

    pub fn getCachePath(this: Repository, manager: *PackageManager, buf: *[bun.MAX_PATH_BYTES]u8) ![]u8 {
        var url_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const url = this.getURL(manager.lockfile, &url_buf);

        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const path = try std.os.getFdPath(manager.getGitCacheDirectory().dir.fd, &path_buf);

        const url_hash = std.hash.Wyhash.hash(0, url);
        const hex_fmt = bun.fmt.hexIntLower(url_hash);

        const repo = manager.lockfile.str(this.repo);

        return try std.fmt.bufPrint(buf, "{s}/{s}-{any}", .{ path, repo[0..@min(16, repo.len)], hex_fmt });
    }

    pub fn parse(input: *const SlicedString) !Repository {
        var repo = Repository{};
        const slice = input.slice;

        // ignore "git+"
        const i: usize = if (strings.indexOfChar(slice, '+')) |j| j + 1 else 0;
        if (strings.indexOfChar(slice[i..], ':')) |_j| {
            var j = i + _j + 1;
            if (!strings.hasPrefixComptime(slice[j..], "//")) return error.InvalidGitURL;
            j += 2;
            if (strings.indexOfAny(slice[j..], ":/")) |k| {
                j += k + 1;
                if (strings.indexOfChar(slice[j..], '/')) |l| {
                    j += l;
                    repo.owner = String.init(input.buf, slice[i..j]);
                } else return error.InvalidGitURL;
            } else return error.InvalidGitURL;

            if (strings.indexOfChar(slice[j..], '#')) |_k| {
                var k = _k + j;
                if (strings.endsWithComptime(slice[j + 1 .. k], ".git")) {
                    repo.repo = String.init(input.buf, slice[j + 1 .. k - ".git".len]);
                } else {
                    repo.repo = String.init(input.buf, slice[j + 1 .. k]);
                }
                repo.committish = String.init(input.buf, slice[k + 1 ..]);
            } else {
                const end = if (strings.endsWithComptime(slice[j + 1 ..], ".git")) slice.len - ".git".len else slice.len;
                repo.repo = String.init(input.buf, slice[j + 1 .. end]);
            }
        } else return error.InvalidGitURL;

        return repo;
    }

    pub fn parseGitHub(input: *const SlicedString) !Repository {
        var repo = Repository{};
        // ignore "github:"
        const i: usize = if (strings.indexOfChar(input.slice, ':')) |j| j + 1 else 0;
        if (strings.indexOfChar(input.slice, '/')) |j| {
            repo.owner = String.init(input.buf, input.slice[i..j]);
            if (strings.indexOfChar(input.slice[j + 1 ..], '#')) |k| {
                repo.repo = String.init(input.buf, input.slice[j + 1 .. k]);
                repo.committish = String.init(input.buf, input.slice[k + 1 ..]);
            } else {
                repo.repo = String.init(input.buf, input.slice[j + 1 ..]);
            }
        } else {
            return error.InvalidGitURL;
        }
        return repo;
    }

    pub const Formatter = struct {
        label: []const u8 = "",
        buf: []const u8,
        repository: Repository,
        pub fn format(formatter: Formatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (Environment.allow_assert) std.debug.assert(formatter.label.len > 0);

            try writer.writeAll(formatter.label);
            try writer.writeAll(":");

            try writer.writeAll(formatter.repository.owner.slice(formatter.buf));
            try writer.writeAll(formatter.repository.repo.slice(formatter.buf));

            if (!formatter.repository.committish.isEmpty()) {
                try writer.writeAll("#");
                try writer.writeAll(formatter.repository.committish.slice(formatter.buf));
            }
        }
    };
};
