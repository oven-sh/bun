const PackageManager = @import("./install.zig").PackageManager;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const std = @import("std");
const Repository = @import("./repository.zig").Repository;
const string = @import("../string_types.zig").string;
const ExtractTarball = @import("./extract_tarball.zig");
const strings = @import("../string_immutable.zig");
const VersionedURL = @import("./versioned_url.zig");

pub const Resolution = extern struct {
    tag: Tag = Tag.uninitialized,
    value: Value = Value{ .uninitialized = .{} },

    pub fn order(
        lhs: *const Resolution,
        rhs: *const Resolution,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) std.math.Order {
        if (lhs.tag != rhs.tag) {
            return std.math.order(@enumToInt(lhs.tag), @enumToInt(rhs.tag));
        }

        return switch (lhs.tag) {
            .npm => lhs.value.npm.order(rhs.value.npm, lhs_buf, rhs_buf),
            .local_tarball => lhs.value.local_tarball.order(&rhs.value.local_tarball, lhs_buf, rhs_buf),
            .git_ssh => lhs.value.git_ssh.order(&rhs.value.git_ssh, lhs_buf, rhs_buf),
            .git_http => lhs.value.git_http.order(&rhs.value.git_http, lhs_buf, rhs_buf),
            .folder => lhs.value.folder.order(&rhs.value.folder, lhs_buf, rhs_buf),
            .remote_tarball => lhs.value.remote_tarball.order(&rhs.value.remote_tarball, lhs_buf, rhs_buf),
            .workspace => lhs.value.workspace.order(&rhs.value.workspace, lhs_buf, rhs_buf),
            .symlink => lhs.value.symlink.order(&rhs.value.symlink, lhs_buf, rhs_buf),
            .single_file_module => lhs.value.single_file_module.order(&rhs.value.single_file_module, lhs_buf, rhs_buf),
            .github => lhs.value.github.order(&rhs.value.github, lhs_buf, rhs_buf),
            .gitlab => lhs.value.gitlab.order(&rhs.value.gitlab, lhs_buf, rhs_buf),
            else => .eq,
        };
    }

    pub fn count(this: *const Resolution, buf: []const u8, comptime Builder: type, builder: Builder) void {
        switch (this.tag) {
            .npm => this.value.npm.count(buf, Builder, builder),
            .local_tarball => builder.count(this.value.local_tarball.slice(buf)),
            .git_ssh => builder.count(this.value.git_ssh.slice(buf)),
            .git_http => builder.count(this.value.git_http.slice(buf)),
            .folder => builder.count(this.value.folder.slice(buf)),
            .remote_tarball => builder.count(this.value.remote_tarball.slice(buf)),
            .workspace => builder.count(this.value.workspace.slice(buf)),
            .symlink => builder.count(this.value.symlink.slice(buf)),
            .single_file_module => builder.count(this.value.single_file_module.slice(buf)),
            .github => this.value.github.count(buf, Builder, builder),
            .gitlab => this.value.gitlab.count(buf, Builder, builder),
            else => {},
        }
    }

    pub fn clone(this: Resolution, buf: []const u8, comptime Builder: type, builder: Builder) Resolution {
        return Resolution{
            .tag = this.tag,
            .value = switch (this.tag) {
                .npm => Resolution.Value{
                    .npm = this.value.npm.clone(buf, Builder, builder),
                },
                .local_tarball => Resolution.Value{
                    .local_tarball = builder.append(String, this.value.local_tarball.slice(buf)),
                },
                .git_ssh => Resolution.Value{
                    .git_ssh = builder.append(String, this.value.git_ssh.slice(buf)),
                },
                .git_http => Resolution.Value{
                    .git_http = builder.append(String, this.value.git_http.slice(buf)),
                },
                .folder => Resolution.Value{
                    .folder = builder.append(String, this.value.folder.slice(buf)),
                },
                .remote_tarball => Resolution.Value{
                    .remote_tarball = builder.append(String, this.value.remote_tarball.slice(buf)),
                },
                .workspace => Resolution.Value{
                    .workspace = builder.append(String, this.value.workspace.slice(buf)),
                },
                .symlink => Resolution.Value{
                    .symlink = builder.append(String, this.value.symlink.slice(buf)),
                },
                .single_file_module => Resolution.Value{
                    .single_file_module = builder.append(String, this.value.single_file_module.slice(buf)),
                },
                .github => Resolution.Value{
                    .github = this.value.github.clone(buf, Builder, builder),
                },
                .gitlab => Resolution.Value{
                    .gitlab = this.value.gitlab.clone(buf, Builder, builder),
                },
                .root => Resolution.Value{ .root = .{} },
                else => unreachable,
            },
        };
    }

    pub fn fmt(this: Resolution, buf: []const u8) Formatter {
        return Formatter{ .resolution = this, .buf = buf };
    }

    pub fn fmtURL(this: Resolution, options: *const PackageManager.Options, name: string, buf: []const u8) URLFormatter {
        return URLFormatter{ .resolution = this, .buf = buf, .package_name = name, .options = options };
    }

    pub fn eql(
        lhs: Resolution,
        rhs: Resolution,
        lhs_string_buf: []const u8,
        rhs_string_buf: []const u8,
    ) bool {
        if (lhs.tag != rhs.tag) return false;

        return switch (lhs.tag) {
            .root => true,
            .npm => lhs.value.npm.eql(rhs.value.npm),
            .local_tarball => lhs.value.local_tarball.eql(
                rhs.value.local_tarball,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .git_ssh => lhs.value.git_ssh.eql(
                rhs.value.git_ssh,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .git_http => lhs.value.git_http.eql(
                rhs.value.git_http,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .folder => lhs.value.folder.eql(
                rhs.value.folder,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .remote_tarball => lhs.value.remote_tarball.eql(
                rhs.value.remote_tarball,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .workspace => lhs.value.workspace.eql(
                rhs.value.workspace,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .symlink => lhs.value.symlink.eql(
                rhs.value.symlink,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .single_file_module => lhs.value.single_file_module.eql(
                rhs.value.single_file_module,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .github => lhs.value.github.eql(
                rhs.value.github,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .gitlab => lhs.value.gitlab.eql(
                rhs.value.gitlab,
                lhs_string_buf,
                rhs_string_buf,
            ),
            else => unreachable,
        };
    }

    pub const URLFormatter = struct {
        resolution: Resolution,
        options: *const PackageManager.Options,
        package_name: string,

        buf: []const u8,

        pub fn format(formatter: URLFormatter, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            switch (formatter.resolution.tag) {
                .npm => try writer.writeAll(formatter.resolution.value.npm.url.slice(formatter.buf)),
                .local_tarball => try writer.writeAll(formatter.resolution.value.local_tarball.slice(formatter.buf)),
                .git_ssh => try std.fmt.format(writer, "git+ssh://{s}", .{formatter.resolution.value.git_ssh.slice(formatter.buf)}),
                .git_http => try std.fmt.format(writer, "https://{s}", .{formatter.resolution.value.git_http.slice(formatter.buf)}),
                .folder => try writer.writeAll(formatter.resolution.value.folder.slice(formatter.buf)),
                .remote_tarball => try writer.writeAll(formatter.resolution.value.remote_tarball.slice(formatter.buf)),
                .github => try formatter.resolution.value.github.formatAs("github", formatter.buf, layout, opts, writer),
                .gitlab => try formatter.resolution.value.gitlab.formatAs("gitlab", formatter.buf, layout, opts, writer),
                .workspace => try std.fmt.format(writer, "workspace://{s}", .{formatter.resolution.value.workspace.slice(formatter.buf)}),
                .symlink => try std.fmt.format(writer, "link://{s}", .{formatter.resolution.value.symlink.slice(formatter.buf)}),
                .single_file_module => try std.fmt.format(writer, "link://{s}", .{formatter.resolution.value.symlink.slice(formatter.buf)}),
                else => {},
            }
        }
    };

    pub const Formatter = struct {
        resolution: Resolution,
        buf: []const u8,

        pub fn format(formatter: Formatter, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            switch (formatter.resolution.tag) {
                .npm => try formatter.resolution.value.npm.version.fmt(formatter.buf).format(layout, opts, writer),
                .local_tarball => try writer.writeAll(formatter.resolution.value.local_tarball.slice(formatter.buf)),
                .git_ssh => try std.fmt.format(writer, "git+ssh://{s}", .{formatter.resolution.value.git_ssh.slice(formatter.buf)}),
                .git_http => try std.fmt.format(writer, "https://{s}", .{formatter.resolution.value.git_http.slice(formatter.buf)}),
                .folder => try writer.writeAll(formatter.resolution.value.folder.slice(formatter.buf)),
                .remote_tarball => try writer.writeAll(formatter.resolution.value.remote_tarball.slice(formatter.buf)),
                .github => try formatter.resolution.value.github.formatAs("github", formatter.buf, layout, opts, writer),
                .gitlab => try formatter.resolution.value.gitlab.formatAs("gitlab", formatter.buf, layout, opts, writer),
                .workspace => try std.fmt.format(writer, "workspace://{s}", .{formatter.resolution.value.workspace.slice(formatter.buf)}),
                .symlink => try std.fmt.format(writer, "link:{s}", .{formatter.resolution.value.symlink.slice(formatter.buf)}),
                .single_file_module => try std.fmt.format(writer, "link://{s}", .{formatter.resolution.value.symlink.slice(formatter.buf)}),
                else => {},
            }
        }
    };

    pub const Value = extern union {
        uninitialized: void,
        root: void,

        npm: VersionedURL,

        /// File path to a tarball relative to the package root
        local_tarball: String,

        git_ssh: String,
        git_http: String,

        folder: String,

        /// URL to a tarball.
        remote_tarball: String,

        github: Repository,
        gitlab: Repository,

        workspace: String,

        /// global link
        symlink: String,

        single_file_module: String,
    };

    pub const Tag = enum(u8) {
        uninitialized = 0,
        root = 1,
        npm = 2,
        folder = 4,

        local_tarball = 8,

        github = 16,
        gitlab = 24,

        git_ssh = 32,
        git_http = 33,

        symlink = 64,

        workspace = 72,

        remote_tarball = 80,

        // This is a placeholder for now.
        // But the intent is to eventually support URL imports at the package manager level.
        //
        // There are many ways to do it, but perhaps one way to be maximally compatible is just removing the protocol part of the URL.
        //
        // For example, bun would transform this input:
        //
        //   import _ from "https://github.com/lodash/lodash/lodash.min.js";
        //
        // Into:
        //
        //   import _ from "github.com/lodash/lodash/lodash.min.js";
        //
        // github.com would become a package, with it's own package.json
        // This is similar to how Go does it, except it wouldn't clone the whole repo.
        // There are more efficient ways to do this, e.g. generate a .bun file just for all URL imports.
        // There are questions of determinism, but perhaps that's what Integrity would do.
        single_file_module = 100,

        _,
    };
};
