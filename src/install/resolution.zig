const PackageManager = @import("./install.zig").PackageManager;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const std = @import("std");
const Repository = @import("./repository.zig").Repository;
const string = @import("../string_types.zig").string;
const ExtractTarball = @import("./extract_tarball.zig");
const strings = @import("../string_immutable.zig");
const VersionedURL = @import("./versioned_url.zig").VersionedURL;
const bun = @import("root").bun;
const Path = bun.path;

pub const Resolution = extern struct {
    tag: Tag = .uninitialized,
    _padding: [7]u8 = .{0} ** 7,
    value: Value = .{ .uninitialized = {} },

    /// Use like Resolution.init(.{ .npm = VersionedURL{ ... } })
    pub inline fn init(value: anytype) Resolution {
        return Resolution{
            .tag = @field(Tag, @typeInfo(@TypeOf(value)).Struct.fields[0].name),
            .value = Value.init(value),
        };
    }

    pub fn isGit(this: *const Resolution) bool {
        return this.tag.isGit();
    }

    pub fn canEnqueueInstallTask(this: *const Resolution) bool {
        return this.tag.canEnqueueInstallTask();
    }

    pub fn order(
        lhs: *const Resolution,
        rhs: *const Resolution,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) std.math.Order {
        if (lhs.tag != rhs.tag) {
            return std.math.order(@intFromEnum(lhs.tag), @intFromEnum(rhs.tag));
        }

        return switch (lhs.tag) {
            .npm => lhs.value.npm.order(rhs.value.npm, lhs_buf, rhs_buf),
            .local_tarball => lhs.value.local_tarball.order(&rhs.value.local_tarball, lhs_buf, rhs_buf),
            .folder => lhs.value.folder.order(&rhs.value.folder, lhs_buf, rhs_buf),
            .remote_tarball => lhs.value.remote_tarball.order(&rhs.value.remote_tarball, lhs_buf, rhs_buf),
            .workspace => lhs.value.workspace.order(&rhs.value.workspace, lhs_buf, rhs_buf),
            .symlink => lhs.value.symlink.order(&rhs.value.symlink, lhs_buf, rhs_buf),
            .single_file_module => lhs.value.single_file_module.order(&rhs.value.single_file_module, lhs_buf, rhs_buf),
            .git => lhs.value.git.order(&rhs.value.git, lhs_buf, rhs_buf),
            .github => lhs.value.github.order(&rhs.value.github, lhs_buf, rhs_buf),
            .gitlab => lhs.value.gitlab.order(&rhs.value.gitlab, lhs_buf, rhs_buf),
            else => .eq,
        };
    }

    pub fn count(this: *const Resolution, buf: []const u8, comptime Builder: type, builder: Builder) void {
        switch (this.tag) {
            .npm => this.value.npm.count(buf, Builder, builder),
            .local_tarball => builder.count(this.value.local_tarball.slice(buf)),
            .folder => builder.count(this.value.folder.slice(buf)),
            .remote_tarball => builder.count(this.value.remote_tarball.slice(buf)),
            .workspace => builder.count(this.value.workspace.slice(buf)),
            .symlink => builder.count(this.value.symlink.slice(buf)),
            .single_file_module => builder.count(this.value.single_file_module.slice(buf)),
            .git => this.value.git.count(buf, Builder, builder),
            .github => this.value.github.count(buf, Builder, builder),
            .gitlab => this.value.gitlab.count(buf, Builder, builder),
            else => {},
        }
    }

    pub fn clone(this: *const Resolution, buf: []const u8, comptime Builder: type, builder: Builder) Resolution {
        return .{
            .tag = this.tag,
            .value = switch (this.tag) {
                .npm => Value.init(.{ .npm = this.value.npm.clone(buf, Builder, builder) }),
                .local_tarball => Value.init(.{
                    .local_tarball = builder.append(String, this.value.local_tarball.slice(buf)),
                }),
                .folder => Value.init(.{
                    .folder = builder.append(String, this.value.folder.slice(buf)),
                }),
                .remote_tarball => Value.init(.{
                    .remote_tarball = builder.append(String, this.value.remote_tarball.slice(buf)),
                }),
                .workspace => Value.init(.{
                    .workspace = builder.append(String, this.value.workspace.slice(buf)),
                }),
                .symlink => Value.init(.{
                    .symlink = builder.append(String, this.value.symlink.slice(buf)),
                }),
                .single_file_module => Value.init(.{
                    .single_file_module = builder.append(String, this.value.single_file_module.slice(buf)),
                }),
                .git => Value.init(.{
                    .git = this.value.git.clone(buf, Builder, builder),
                }),
                .github => Value.init(.{
                    .github = this.value.github.clone(buf, Builder, builder),
                }),
                .gitlab => Value.init(.{
                    .gitlab = this.value.gitlab.clone(buf, Builder, builder),
                }),
                .root => Value.init(.{ .root = {} }),
                else => {
                    std.debug.panic("Internal error: unexpected resolution tag: {}", .{this.tag});
                },
            },
        };
    }

    pub fn fmt(this: *const Resolution, string_bytes: []const u8, path_sep: bun.fmt.PathFormatOptions.Sep) Formatter {
        return Formatter{
            .resolution = this,
            .buf = string_bytes,
            .path_sep = path_sep,
        };
    }

    pub fn fmtURL(this: *const Resolution, string_bytes: []const u8) URLFormatter {
        return URLFormatter{ .resolution = this, .buf = string_bytes };
    }

    pub fn fmtForDebug(this: *const Resolution, string_bytes: []const u8) DebugFormatter {
        return DebugFormatter{ .resolution = this, .buf = string_bytes };
    }

    pub fn eql(
        lhs: *const Resolution,
        rhs: *const Resolution,
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
            .git => lhs.value.git.eql(
                &rhs.value.git,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .github => lhs.value.github.eql(
                &rhs.value.github,
                lhs_string_buf,
                rhs_string_buf,
            ),
            .gitlab => lhs.value.gitlab.eql(
                &rhs.value.gitlab,
                lhs_string_buf,
                rhs_string_buf,
            ),
            else => unreachable,
        };
    }

    pub const URLFormatter = struct {
        resolution: *const Resolution,

        buf: []const u8,

        pub fn format(formatter: URLFormatter, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            const buf = formatter.buf;
            const value = formatter.resolution.value;
            switch (formatter.resolution.tag) {
                .npm => try writer.writeAll(value.npm.url.slice(formatter.buf)),
                .local_tarball => try bun.fmt.fmtPath(u8, value.local_tarball.slice(buf), .{ .path_sep = .posix }).format("", {}, writer),
                .folder => try writer.writeAll(value.folder.slice(formatter.buf)),
                .remote_tarball => try writer.writeAll(value.remote_tarball.slice(formatter.buf)),
                .git => try value.git.formatAs("git+", formatter.buf, layout, opts, writer),
                .github => try value.github.formatAs("github:", formatter.buf, layout, opts, writer),
                .gitlab => try value.gitlab.formatAs("gitlab:", formatter.buf, layout, opts, writer),
                .workspace => try std.fmt.format(writer, "workspace:{s}", .{value.workspace.slice(formatter.buf)}),
                .symlink => try std.fmt.format(writer, "link:{s}", .{value.symlink.slice(formatter.buf)}),
                .single_file_module => try std.fmt.format(writer, "module:{s}", .{value.single_file_module.slice(formatter.buf)}),
                else => {},
            }
        }
    };

    pub const Formatter = struct {
        resolution: *const Resolution,
        buf: []const u8,
        path_sep: bun.fmt.PathFormatOptions.Sep,

        pub fn format(formatter: Formatter, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            const buf = formatter.buf;
            const value = formatter.resolution.value;
            switch (formatter.resolution.tag) {
                .npm => try value.npm.version.fmt(buf).format(layout, opts, writer),
                .local_tarball => try bun.fmt.fmtPath(u8, value.local_tarball.slice(buf), .{ .path_sep = formatter.path_sep }).format("", {}, writer),
                .folder => try bun.fmt.fmtPath(u8, value.folder.slice(buf), .{ .path_sep = formatter.path_sep }).format("", {}, writer),
                .remote_tarball => try writer.writeAll(value.remote_tarball.slice(buf)),
                .git => try value.git.formatAs("git+", buf, layout, opts, writer),
                .github => try value.github.formatAs("github:", buf, layout, opts, writer),
                .gitlab => try value.gitlab.formatAs("gitlab:", buf, layout, opts, writer),
                .workspace => try std.fmt.format(writer, "workspace:{s}", .{bun.fmt.fmtPath(u8, value.workspace.slice(buf), .{
                    .path_sep = formatter.path_sep,
                })}),
                .symlink => try std.fmt.format(writer, "link:{s}", .{bun.fmt.fmtPath(u8, value.symlink.slice(buf), .{
                    .path_sep = formatter.path_sep,
                })}),
                .single_file_module => try std.fmt.format(writer, "module:{s}", .{value.single_file_module.slice(buf)}),
                else => {},
            }
        }
    };

    pub const DebugFormatter = struct {
        resolution: *const Resolution,
        buf: []const u8,

        pub fn format(formatter: DebugFormatter, comptime layout: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.writeAll("Resolution{ .");
            try writer.writeAll(std.enums.tagName(Tag, formatter.resolution.tag) orelse "invalid");
            try writer.writeAll(" = ");
            switch (formatter.resolution.tag) {
                .npm => try formatter.resolution.value.npm.version.fmt(formatter.buf).format(layout, opts, writer),
                .local_tarball => try writer.writeAll(formatter.resolution.value.local_tarball.slice(formatter.buf)),
                .folder => try writer.writeAll(formatter.resolution.value.folder.slice(formatter.buf)),
                .remote_tarball => try writer.writeAll(formatter.resolution.value.remote_tarball.slice(formatter.buf)),
                .git => try formatter.resolution.value.git.formatAs("git+", formatter.buf, layout, opts, writer),
                .github => try formatter.resolution.value.github.formatAs("github:", formatter.buf, layout, opts, writer),
                .gitlab => try formatter.resolution.value.gitlab.formatAs("gitlab:", formatter.buf, layout, opts, writer),
                .workspace => try std.fmt.format(writer, "workspace:{s}", .{formatter.resolution.value.workspace.slice(formatter.buf)}),
                .symlink => try std.fmt.format(writer, "link:{s}", .{formatter.resolution.value.symlink.slice(formatter.buf)}),
                .single_file_module => try std.fmt.format(writer, "module:{s}", .{formatter.resolution.value.single_file_module.slice(formatter.buf)}),
                else => try writer.writeAll("{}"),
            }
            try writer.writeAll(" }");
        }
    };

    pub const Value = extern union {
        uninitialized: void,
        root: void,

        npm: VersionedURL,

        /// File path to a tarball relative to the package root
        local_tarball: String,

        folder: String,

        /// URL to a tarball.
        remote_tarball: String,

        git: Repository,
        github: Repository,
        gitlab: Repository,

        workspace: String,

        /// global link
        symlink: String,

        single_file_module: String,

        /// To avoid undefined memory between union values, we must zero initialize the union first.
        pub fn init(field: anytype) Value {
            return bun.serializableInto(Value, field);
        }
    };

    pub const Tag = enum(u8) {
        uninitialized = 0,
        root = 1,
        npm = 2,
        folder = 4,

        local_tarball = 8,

        github = 16,
        gitlab = 24,

        git = 32,

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

        pub fn isGit(this: Tag) bool {
            return this == .git or this == .github or this == .gitlab;
        }

        pub fn canEnqueueInstallTask(this: Tag) bool {
            return this == .npm or this == .local_tarball or this == .remote_tarball or this == .git or this == .github;
        }
    };
};
