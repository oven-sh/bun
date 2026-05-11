pub const Resolution = ResolutionType(u64);
pub const OldV2Resolution = ResolutionType(u32);

pub fn ResolutionType(comptime SemverIntType: type) type {
    return extern struct {
        tag: Tag = .uninitialized,
        _padding: [7]u8 = .{0} ** 7,
        value: Value = .{ .uninitialized = {} },

        const This = @This();

        /// Use like Resolution.init(.{ .npm = VersionedURL{ ... } })
        pub inline fn init(value: bun.meta.Tagged(Value, Tag)) This {
            return .{
                .tag = std.meta.activeTag(value),
                .value = Value.init(value),
            };
        }

        pub fn isGit(this: *const This) bool {
            return this.tag.isGit();
        }

        pub fn canEnqueueInstallTask(this: *const This) bool {
            return this.tag.canEnqueueInstallTask();
        }

        const FromTextLockfileError = OOM || error{
            UnexpectedResolution,
            InvalidSemver,
        };

        pub fn fromTextLockfile(res_str: string, string_buf: *String.Buf) FromTextLockfileError!This {
            if (strings.hasPrefixComptime(res_str, "root:")) {
                return This.init(.{ .root = {} });
            }

            if (strings.withoutPrefixIfPossibleComptime(res_str, "link:")) |link| {
                return This.init(.{ .symlink = try string_buf.append(link) });
            }

            if (strings.withoutPrefixIfPossibleComptime(res_str, "workspace:")) |workspace| {
                return This.init(.{ .workspace = try string_buf.append(workspace) });
            }

            if (strings.withoutPrefixIfPossibleComptime(res_str, "file:")) |folder| {
                return This.init(.{ .folder = try string_buf.append(folder) });
            }

            return switch (Dependency.Version.Tag.infer(res_str)) {
                .git => This.init(.{ .git = try Repository.parseAppendGit(res_str, string_buf) }),
                .github => This.init(.{ .github = try Repository.parseAppendGithub(res_str, string_buf) }),
                .tarball => {
                    if (Dependency.isRemoteTarball(res_str)) {
                        return This.init(.{ .remote_tarball = try string_buf.append(res_str) });
                    }

                    return This.init(.{ .local_tarball = try string_buf.append(res_str) });
                },
                .npm => {
                    const version_literal = try string_buf.append(res_str);
                    const parsed = Semver.Version.parse(version_literal.sliced(string_buf.bytes.items));

                    if (!parsed.valid) {
                        return error.UnexpectedResolution;
                    }

                    if (parsed.version.major == null or parsed.version.minor == null or parsed.version.patch == null) {
                        return error.UnexpectedResolution;
                    }

                    return .{
                        .tag = .npm,
                        .value = .{
                            .npm = .{
                                .version = parsed.version.min(),

                                // will fill this later
                                .url = .{},
                            },
                        },
                    };
                },

                // covered above
                .workspace => error.UnexpectedResolution,
                .symlink => error.UnexpectedResolution,
                .folder => error.UnexpectedResolution,

                // even though it's a dependency type, it's not
                // possible for 'catalog:' to be written to the
                // lockfile for any resolution because the install
                // will fail it it's not successfully replaced by
                // a version
                .catalog => error.UnexpectedResolution,

                // should not happen
                .dist_tag => error.UnexpectedResolution,
                .uninitialized => error.UnexpectedResolution,
            };
        }

        const FromPnpmLockfileError = OOM || error{InvalidPnpmLockfile};

        pub fn fromPnpmLockfile(res_str: []const u8, string_buf: *String.Buf) FromPnpmLockfileError!Resolution {
            if (strings.withoutPrefixIfPossibleComptime(res_str, "https://codeload.github.com/")) |user_repo_tar_committish| {
                const user_end = strings.indexOfChar(user_repo_tar_committish, '/') orelse {
                    return error.InvalidPnpmLockfile;
                };
                const user = user_repo_tar_committish[0..user_end];
                const repo_tar_committish = user_repo_tar_committish[user_end + 1 ..];

                const repo_end = strings.indexOfChar(repo_tar_committish, '/') orelse {
                    return error.InvalidPnpmLockfile;
                };
                const repo = repo_tar_committish[0..repo_end];
                const tar_committish = repo_tar_committish[repo_end + 1 ..];

                const tar_end = strings.indexOfChar(tar_committish, '/') orelse {
                    return error.InvalidPnpmLockfile;
                };
                const committish = tar_committish[tar_end + 1 ..];

                return This.init(.{
                    .github = .{
                        .owner = try string_buf.append(user),
                        .repo = try string_buf.append(repo),
                        .committish = try string_buf.append(committish),
                    },
                });
            }

            if (strings.withoutPrefixIfPossibleComptime(res_str, "file:")) |path| {
                if (strings.endsWithComptime(res_str, ".tgz")) {
                    return This.init(.{ .local_tarball = try string_buf.append(path) });
                }
                return This.init(.{ .folder = try string_buf.append(path) });
            }

            return switch (Dependency.Version.Tag.infer(res_str)) {
                .git => This.init(.{ .git = try Repository.parseAppendGit(res_str, string_buf) }),
                .github => This.init(.{ .github = try Repository.parseAppendGithub(res_str, string_buf) }),
                .tarball => {
                    if (Dependency.isRemoteTarball(res_str)) {
                        return This.init(.{ .remote_tarball = try string_buf.append(res_str) });
                    }
                    return This.init(.{ .local_tarball = try string_buf.append(res_str) });
                },
                .npm => {
                    const version_literal = try string_buf.append(res_str);
                    const parsed = Semver.Version.parse(version_literal.sliced(string_buf.bytes.items));

                    if (!parsed.valid) {
                        return error.InvalidPnpmLockfile;
                    }

                    if (parsed.version.major == null or parsed.version.minor == null or parsed.version.patch == null) {
                        return error.InvalidPnpmLockfile;
                    }

                    return This.init(.{
                        .npm = .{
                            .version = parsed.version.min(),
                            // set afterwards
                            .url = .{},
                        },
                    });
                },

                .workspace => error.InvalidPnpmLockfile,
                .symlink => error.InvalidPnpmLockfile,
                .folder => error.InvalidPnpmLockfile,
                .catalog => error.InvalidPnpmLockfile,
                .dist_tag => error.InvalidPnpmLockfile,
                .uninitialized => error.InvalidPnpmLockfile,
            };
        }

        pub fn order(
            lhs: *const This,
            rhs: *const This,
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
                else => .eq,
            };
        }

        pub fn count(this: *const This, buf: []const u8, comptime Builder: type, builder: Builder) void {
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
                else => {},
            }
        }

        pub fn clone(this: *const This, buf: []const u8, comptime Builder: type, builder: Builder) This {
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
                    .root => Value.init(.{ .root = {} }),
                    .uninitialized => Value.init(.{ .uninitialized = {} }),
                    else => {
                        std.debug.panic("Internal error: unexpected resolution tag: {}", .{this.tag});
                    },
                },
            };
        }

        pub fn copy(this: *const Resolution) Resolution {
            return switch (this.tag) {
                .npm => .init(.{ .npm = this.value.npm }),
                .local_tarball => .init(.{ .local_tarball = this.value.local_tarball }),
                .folder => .init(.{ .folder = this.value.folder }),
                .remote_tarball => .init(.{ .remote_tarball = this.value.remote_tarball }),
                .workspace => .init(.{ .workspace = this.value.workspace }),
                .symlink => .init(.{ .symlink = this.value.symlink }),
                .single_file_module => .init(.{ .single_file_module = this.value.single_file_module }),
                .git => .init(.{ .git = this.value.git }),
                .github => .init(.{ .github = this.value.github }),
                .root => .init(.{ .root = {} }),
                .uninitialized => .init(.{ .uninitialized = {} }),
                else => {
                    std.debug.panic("Internal error: unexpected resolution tag: {}", .{this.tag});
                },
            };
        }

        pub fn fmt(this: *const This, string_bytes: []const u8, path_sep: bun.fmt.PathFormatOptions.Sep) Formatter {
            return Formatter{
                .resolution = this,
                .buf = string_bytes,
                .path_sep = path_sep,
            };
        }

        const StorePathFormatter = struct {
            res: *const This,
            string_buf: string,
            // opts: String.StorePathFormatter.Options,

            pub fn format(this: StorePathFormatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
                const string_buf = this.string_buf;
                const res = this.res.value;
                switch (this.res.tag) {
                    .root => try writer.writeAll("root"),
                    .npm => try writer.print("{f}", .{res.npm.version.fmt(string_buf)}),
                    .local_tarball => try writer.print("{f}", .{res.local_tarball.fmtStorePath(string_buf)}),
                    .remote_tarball => try writer.print("{f}", .{res.remote_tarball.fmtStorePath(string_buf)}),
                    .folder => try writer.print("{f}", .{res.folder.fmtStorePath(string_buf)}),
                    .git => try writer.print("{f}", .{res.git.fmtStorePath("git+", string_buf)}),
                    .github => try writer.print("{f}", .{res.github.fmtStorePath("github+", string_buf)}),
                    .workspace => try writer.print("{f}", .{res.workspace.fmtStorePath(string_buf)}),
                    .symlink => try writer.print("{f}", .{res.symlink.fmtStorePath(string_buf)}),
                    .single_file_module => try writer.print("{f}", .{res.single_file_module.fmtStorePath(string_buf)}),
                    else => {},
                }
            }
        };

        pub fn fmtStorePath(this: *const This, string_buf: string) StorePathFormatter {
            return .{
                .res = this,
                .string_buf = string_buf,
            };
        }

        pub fn fmtURL(this: *const This, string_bytes: []const u8) URLFormatter {
            return URLFormatter{ .resolution = this, .buf = string_bytes };
        }

        pub fn fmtForDebug(this: *const This, string_bytes: []const u8) DebugFormatter {
            return DebugFormatter{ .resolution = this, .buf = string_bytes };
        }

        pub fn eql(
            lhs: *const This,
            rhs: *const This,
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
                else => unreachable,
            };
        }

        pub const URLFormatter = struct {
            resolution: *const This,

            buf: []const u8,

            pub fn format(formatter: URLFormatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
                const buf = formatter.buf;
                const value = formatter.resolution.value;
                switch (formatter.resolution.tag) {
                    .npm => try writer.writeAll(value.npm.url.slice(formatter.buf)),
                    .local_tarball => try bun.fmt.fmtPath(u8, value.local_tarball.slice(buf), .{ .path_sep = .posix }).format(writer),
                    .folder => try writer.writeAll(value.folder.slice(formatter.buf)),
                    .remote_tarball => try writer.writeAll(value.remote_tarball.slice(formatter.buf)),
                    .git => try value.git.formatAs("git+", formatter.buf, writer),
                    .github => try value.github.formatAs("github:", formatter.buf, writer),
                    .workspace => try writer.print("workspace:{s}", .{value.workspace.slice(formatter.buf)}),
                    .symlink => try writer.print("link:{s}", .{value.symlink.slice(formatter.buf)}),
                    .single_file_module => try writer.print("module:{s}", .{value.single_file_module.slice(formatter.buf)}),
                    else => {},
                }
            }
        };

        pub const Formatter = struct {
            resolution: *const This,
            buf: []const u8,
            path_sep: bun.fmt.PathFormatOptions.Sep,

            pub fn format(formatter: Formatter, writer: *std.Io.Writer) std.Io.Writer.Error!void {
                const buf = formatter.buf;
                const value = formatter.resolution.value;
                switch (formatter.resolution.tag) {
                    .npm => try value.npm.version.fmt(buf).format(writer),
                    .local_tarball => try bun.fmt.fmtPath(u8, value.local_tarball.slice(buf), .{ .path_sep = formatter.path_sep }).format(writer),
                    .folder => try bun.fmt.fmtPath(u8, value.folder.slice(buf), .{ .path_sep = formatter.path_sep }).format(writer),
                    .remote_tarball => try writer.writeAll(value.remote_tarball.slice(buf)),
                    .git => try value.git.formatAs("git+", buf, writer),
                    .github => try value.github.formatAs("github:", buf, writer),
                    .workspace => try writer.print("workspace:{f}", .{bun.fmt.fmtPath(u8, value.workspace.slice(buf), .{
                        .path_sep = formatter.path_sep,
                    })}),
                    .symlink => try writer.print("link:{f}", .{bun.fmt.fmtPath(u8, value.symlink.slice(buf), .{
                        .path_sep = formatter.path_sep,
                    })}),
                    .single_file_module => try writer.print("module:{s}", .{value.single_file_module.slice(buf)}),
                    else => {},
                }
            }
        };

        pub const DebugFormatter = struct {
            resolution: *const This,
            buf: []const u8,

            pub fn format(formatter: DebugFormatter, writer: *std.Io.Writer) !void {
                try writer.writeAll("Resolution{ .");
                try writer.writeAll(bun.tagName(Tag, formatter.resolution.tag) orelse "invalid");
                try writer.writeAll(" = ");
                switch (formatter.resolution.tag) {
                    .npm => try formatter.resolution.value.npm.version.fmt(formatter.buf).format(writer),
                    .local_tarball => try writer.writeAll(formatter.resolution.value.local_tarball.slice(formatter.buf)),
                    .folder => try writer.writeAll(formatter.resolution.value.folder.slice(formatter.buf)),
                    .remote_tarball => try writer.writeAll(formatter.resolution.value.remote_tarball.slice(formatter.buf)),
                    .git => try formatter.resolution.value.git.formatAs("git+", formatter.buf, writer),
                    .github => try formatter.resolution.value.github.formatAs("github:", formatter.buf, writer),
                    .workspace => try writer.print("workspace:{s}", .{formatter.resolution.value.workspace.slice(formatter.buf)}),
                    .symlink => try writer.print("link:{s}", .{formatter.resolution.value.symlink.slice(formatter.buf)}),
                    .single_file_module => try writer.print("module:{s}", .{formatter.resolution.value.single_file_module.slice(formatter.buf)}),
                    else => try writer.writeAll("{}"),
                }
                try writer.writeAll(" }");
            }
        };

        pub const Value = extern union {
            uninitialized: void,
            root: void,

            npm: VersionedURLType(SemverIntType),

            folder: String,

            /// File path to a tarball relative to the package root
            local_tarball: String,

            github: Repository,

            git: Repository,

            /// global link
            symlink: String,

            workspace: String,

            /// URL to a tarball.
            remote_tarball: String,

            single_file_module: String,

            pub var zero: Value = @bitCast(std.mem.zeroes([@sizeOf(Value)]u8));

            /// To avoid undefined memory between union values, we must zero initialize the union first.
            pub fn init(field: bun.meta.Tagged(Value, Tag)) Value {
                var value = zero;
                switch (field) {
                    inline else => |v, t| {
                        @field(value, @tagName(t)) = v;
                    },
                }
                return value;
            }
        };

        pub const Tag = enum(u8) {
            uninitialized = 0,
            root = 1,
            npm = 2,
            folder = 4,

            local_tarball = 8,

            github = 16,

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
                return this == .git or this == .github;
            }

            pub fn canEnqueueInstallTask(this: Tag) bool {
                return this == .npm or this == .local_tarball or this == .remote_tarball or this == .git or this == .github;
            }
        };
    };
}

const string = []const u8;

const std = @import("std");
const Repository = @import("./repository.zig").Repository;
const VersionedURLType = @import("./versioned_url.zig").VersionedURLType;

const bun = @import("bun");
const OOM = bun.OOM;
const strings = bun.strings;
const Dependency = bun.install.Dependency;

const Semver = bun.Semver;
const String = Semver.String;
