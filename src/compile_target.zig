/// Used for `bun build --compile`
///
/// This downloads and extracts the bun binary for the target platform
/// It uses npm to download the bun binary from the npm registry
/// It stores the downloaded binary into the bun install cache.
///
const CompileTarget = @This();

os: Environment.OperatingSystem = Environment.os,
arch: Environment.Architecture = Environment.arch,
baseline: bool = !Environment.enableSIMD,
version: bun.Semver.Version = .{
    .major = @truncate(Environment.version.major),
    .minor = @truncate(Environment.version.minor),
    .patch = @truncate(Environment.version.patch),
},
libc: Libc = if (!Environment.isMusl) .default else .musl,

const Libc = enum {
    /// The default libc for the target
    /// "glibc" for linux, unspecified for other OSes
    default,
    /// musl libc
    musl,

    /// npm package name, `@oven-sh/bun-{os}-{arch}`
    pub fn npmName(this: Libc) []const u8 {
        return switch (this) {
            .default => "",
            .musl => "-musl",
        };
    }

    pub fn format(self: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
        if (self == .musl) {
            try writer.writeAll("-musl");
        }
    }
};

const BaselineFormatter = struct {
    baseline: bool = false,
    pub fn format(self: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
        if (self.baseline) {
            try writer.writeAll("-baseline");
        }
    }
};

pub const DownloadError = error{
    TargetNotFound,
    NetworkError,
    InvalidResponse,
    ExtractionFailed,
    InvalidTarget,
    OutOfMemory,
    NoSpaceLeft,
};

pub fn eql(this: *const CompileTarget, other: *const CompileTarget) bool {
    return this.os == other.os and this.arch == other.arch and this.baseline == other.baseline and this.version.eql(other.version) and this.libc == other.libc;
}

pub fn isDefault(this: *const CompileTarget) bool {
    return this.eql(&.{});
}

pub fn toNPMRegistryURL(this: *const CompileTarget, buf: []u8) ![]const u8 {
    if (bun.env_var.BUN_COMPILE_TARGET_TARBALL_URL.get()) |url| {
        if (strings.hasPrefixComptime(url, "http://") or strings.hasPrefixComptime(url, "https://"))
            return url;
    }

    return try this.toNPMRegistryURLWithURL(buf, "https://registry.npmjs.org");
}

pub fn toNPMRegistryURLWithURL(this: *const CompileTarget, buf: []u8, registry_url: []const u8) ![]const u8 {
    // Validate the target is supported before building URL
    if (!this.isSupported()) {
        return error.UnsupportedTarget;
    }

    return switch (this.os) {
        inline else => |os| switch (this.arch) {
            inline else => |arch| switch (this.libc) {
                inline else => |libc| switch (this.baseline) {
                    // https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-0.1.6.tgz
                    inline else => |is_baseline| std.fmt.bufPrint(buf, comptime "{s}/@oven/bun-" ++
                        os.npmName() ++ "-" ++ arch.npmName() ++
                        libc.npmName() ++
                        (if (is_baseline) "-baseline" else "") ++
                        "/-/bun-" ++
                        os.npmName() ++ "-" ++ arch.npmName() ++
                        libc.npmName() ++
                        (if (is_baseline) "-baseline" else "") ++
                        "-" ++
                        "{d}.{d}.{d}.tgz", .{
                        registry_url,
                        this.version.major,
                        this.version.minor,
                        this.version.patch,
                    }) catch |err| {
                        // Catch buffer overflow or other formatting errors
                        if (err == error.NoSpaceLeft) {
                            return error.BufferTooSmall;
                        }
                        return err;
                    },
                },
            },
        },
    };
}

pub fn format(this: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
    try writer.print(
        // bun-darwin-x64-baseline-v1.0.0
        // This doesn't match up 100% with npm, but that's okay.
        "bun-{s}-{s}{f}{f}-v{d}.{d}.{d}",
        .{
            this.os.npmName(),
            this.arch.npmName(),
            this.libc,
            BaselineFormatter{ .baseline = this.baseline },
            this.version.major,
            this.version.minor,
            this.version.patch,
        },
    );
}

pub fn exePath(this: *const CompileTarget, buf: *bun.PathBuffer, version_str: [:0]const u8, env: *bun.DotEnv.Loader, needs_download: *bool) [:0]const u8 {
    if (this.isDefault()) brk: {
        const self_exe_path = bun.selfExePath() catch break :brk;
        @memcpy(buf, self_exe_path);
        buf[self_exe_path.len] = 0;
        needs_download.* = false;
        return buf[0..self_exe_path.len :0];
    }

    if (bun.FD.cwd().existsAt(version_str)) {
        needs_download.* = false;
        return version_str;
    }

    const dest = bun.path.joinAbsStringBufZ(
        bun.fs.FileSystem.instance.top_level_dir,
        buf,
        &.{
            bun.install.PackageManager.fetchCacheDirectoryPath(env, null).path,
            version_str,
        },
        .auto,
    );

    if (bun.FD.cwd().existsAt(dest)) {
        needs_download.* = false;
    }

    return dest;
}

pub fn downloadToPath(this: *const CompileTarget, env: *bun.DotEnv.Loader, allocator: std.mem.Allocator, dest_z: [:0]const u8) !void {
    HTTP.HTTPThread.init(&.{});
    var refresher = bun.Progress{};

    {
        refresher.refresh();

        // TODO: This is way too much code necessary to send a single HTTP request...
        var async_http = try allocator.create(HTTP.AsyncHTTP);
        var compressed_archive_bytes = try allocator.create(MutableString);
        compressed_archive_bytes.* = try MutableString.init(allocator, 24 * 1024 * 1024);
        var url_buffer: [2048]u8 = undefined;
        const url_str = this.toNPMRegistryURL(&url_buffer) catch |err| {
            // Return error without printing - let caller decide how to handle
            return err;
        };
        const url_str_copy = try bun.default_allocator.dupe(u8, url_str);
        const url = bun.URL.parse(url_str_copy);
        {
            var progress = refresher.start("Downloading", 0);
            defer progress.end();
            const http_proxy: ?bun.URL = env.getHttpProxyFor(url);

            async_http.* = HTTP.AsyncHTTP.initSync(
                allocator,
                .GET,
                url,
                .{},
                "",
                compressed_archive_bytes,
                "",
                http_proxy,
                null,
                HTTP.FetchRedirect.follow,
            );
            async_http.client.progress_node = progress;
            async_http.client.flags.reject_unauthorized = env.getTLSRejectUnauthorized();

            const response = try async_http.sendSync();

            switch (response.status_code) {
                404 => {
                    // Return error without printing - let caller handle the messaging
                    return error.TargetNotFound;
                },
                403, 429, 499...599 => {
                    // Return error without printing - let caller handle the messaging
                    return error.NetworkError;
                },
                200 => {},
                else => return error.NetworkError,
            }
        }

        var tarball_bytes = std.ArrayListUnmanaged(u8){};
        {
            refresher.refresh();
            defer compressed_archive_bytes.list.deinit(allocator);

            if (compressed_archive_bytes.list.items.len == 0) {
                // Return error without printing - let caller handle the messaging
                return error.InvalidResponse;
            }

            {
                var node = refresher.start("Decompressing", 0);
                defer node.end();
                var gunzip = bun.zlib.ZlibReaderArrayList.init(compressed_archive_bytes.list.items, &tarball_bytes, allocator) catch {
                    node.end();
                    // Return error without printing - let caller handle the messaging
                    return error.InvalidResponse;
                };
                gunzip.readAll(true) catch {
                    node.end();
                    // Return error without printing - let caller handle the messaging
                    return error.InvalidResponse;
                };
                gunzip.deinit();
            }
            refresher.refresh();

            {
                var node = refresher.start("Extracting", 0);
                defer node.end();

                const libarchive = bun.libarchive;
                var tmpname_buf: [1024]u8 = undefined;
                const tempdir_name = try bun.fs.FileSystem.tmpname("tmp", &tmpname_buf, bun.fastRandom());
                var tmpdir = try std.fs.cwd().makeOpenPath(tempdir_name, .{});
                defer tmpdir.close();
                defer std.fs.cwd().deleteTree(tempdir_name) catch {};
                _ = libarchive.Archiver.extractToDir(
                    tarball_bytes.items,
                    tmpdir,
                    null,
                    void,
                    {},
                    .{
                        // "package/bin"
                        .depth_to_skip = 2,
                    },
                ) catch {
                    node.end();
                    // Return error without printing - let caller handle the messaging
                    return error.ExtractionFailed;
                };

                var did_retry = false;
                while (true) {
                    bun.sys.moveFileZ(.fromStdDir(tmpdir), if (this.os == .windows) "bun.exe" else "bun", bun.invalid_fd, dest_z) catch {
                        if (!did_retry) {
                            did_retry = true;
                            const dirname = bun.path.dirname(dest_z, .loose);
                            if (dirname.len > 0) {
                                std.fs.cwd().makePath(dirname) catch {};
                                continue;
                            }

                            // fallthrough, failed for another reason
                        }
                        node.end();
                        // Return error without printing - let caller handle the messaging
                        return error.ExtractionFailed;
                    };
                    break;
                }
            }
            refresher.refresh();
        }
    }
}

pub fn isSupported(this: *const CompileTarget) bool {
    return switch (this.os) {
        .windows => this.arch == .x64 or this.arch == .arm64,

        .mac => true,
        .linux => true,

        .wasm => false,
    };
}

pub const ParseError = error{
    UnsupportedTarget,
    InvalidTarget,
};

pub fn tryFrom(input_: []const u8) ParseError!CompileTarget {
    var this = CompileTarget{};
    const input = bun.strings.trim(input_, " \t\r");
    if (input.len == 0) {
        return this;
    }

    var found_os = false;
    var found_arch = false;
    var found_baseline = false;
    var found_version = false;
    var found_libc = false;

    // Parse each of the supported values.
    // The user shouldn't have to care about the order of the values. As long as it starts with "bun-".
    // Nobody wants to remember whether its "bun-linux-x64" or "bun-x64-linux".
    var splitter = bun.strings.split(input, "-");
    while (input.len > 0) {
        const token = splitter.next() orelse break;
        if (token.len == 0) continue;

        if (Environment.Architecture.names.get(token)) |arch| {
            this.arch = arch;
            found_arch = true;
            continue;
        } else if (Environment.OperatingSystem.names.get(token)) |os| {
            this.os = os;
            found_os = true;
            continue;
        } else if (strings.eqlComptime(token, "modern")) {
            this.baseline = false;
            found_baseline = true;
            continue;
        } else if (strings.eqlComptime(token, "baseline")) {
            this.baseline = true;
            found_baseline = true;
            continue;
        } else if (strings.hasPrefixComptime(token, "v1.") or strings.hasPrefixComptime(token, "v0.")) {
            const version = bun.Semver.Version.parse(bun.Semver.SlicedString.init(token[1..], token[1..]));
            if (version.valid) {
                if (version.version.major == null or version.version.minor == null or version.version.patch == null) {
                    return error.InvalidTarget;
                }

                this.version = .{
                    .major = version.version.major.?,
                    .minor = version.version.minor.?,
                    .patch = version.version.patch.?,
                };
                found_version = true;
                continue;
            }
        } else if (strings.eqlComptime(token, "musl")) {
            this.libc = .musl;
            found_libc = true;
            continue;
        } else {
            return error.UnsupportedTarget;
        }
    }

    if (!found_libc and this.libc == .musl and this.os != .linux) {
        // "bun-windows-x64" should not implicitly be "bun-windows-x64-musl"
        this.libc = .default;
    }

    if (found_os and !found_arch) {
        // default to x64 if no arch is specified but OS is specified
        // On macOS arm64, it's kind of surprising to choose Linux arm64 or Windows arm64
        this.arch = .x64;
        found_arch = true;
    }

    // there is no baseline arm64.
    if (this.baseline and this.arch == .arm64) {
        this.baseline = false;
    }

    if (this.libc == .musl and this.os != .linux) {
        return error.InvalidTarget;
    }

    if (this.arch == .wasm or this.os == .wasm) {
        return error.InvalidTarget;
    }

    return this;
}

pub fn from(input_: []const u8) CompileTarget {
    return tryFrom(input_) catch |err| {
        switch (err) {
            ParseError.UnsupportedTarget => {
                const input = bun.strings.trim(input_, " \t\r");
                var splitter = bun.strings.split(input, "-");
                var unsupported_token: ?[]const u8 = null;
                while (splitter.next()) |token| {
                    if (token.len == 0) continue;
                    if (Environment.Architecture.names.get(token) == null and
                        Environment.OperatingSystem.names.get(token) == null and
                        !strings.eqlComptime(token, "modern") and
                        !strings.eqlComptime(token, "baseline") and
                        !strings.eqlComptime(token, "musl") and
                        !(strings.hasPrefixComptime(token, "v1.") or strings.hasPrefixComptime(token, "v0.")))
                    {
                        unsupported_token = token;
                        break;
                    }
                }

                if (unsupported_token) |token| {
                    Output.errGeneric(
                        \\Unsupported target {f} in "bun{s}"
                        \\To see the supported targets:
                        \\  https://bun.com/docs/bundler/executables
                    , .{
                        bun.fmt.quote(token),
                        input_,
                    });
                } else {
                    Output.errGeneric("Unsupported target: {s}", .{input_});
                }
                Global.exit(1);
            },
            ParseError.InvalidTarget => {
                const input = bun.strings.trim(input_, " \t\r");
                if (strings.containsComptime(input, "musl") and !strings.containsComptime(input, "linux")) {
                    Output.errGeneric("invalid target, musl libc only exists on linux", .{});
                } else if (strings.containsComptime(input, "wasm")) {
                    Output.errGeneric("invalid target, WebAssembly is not supported. Sorry!", .{});
                } else if (strings.containsComptime(input, "v")) {
                    Output.errGeneric("Please pass a complete version number to --target. For example, --target=bun-v" ++ Environment.version_string, .{});
                } else {
                    Output.errGeneric("Invalid target: {s}", .{input_});
                }
                Global.exit(1);
            },
        }
    };
}

// Exists for consistentcy with values.
pub fn defineKeys(_: *const CompileTarget) []const []const u8 {
    return &.{
        "process.platform",
        "process.arch",
        "process.versions.bun",
    };
}

pub fn defineValues(this: *const CompileTarget) []const []const u8 {
    // Use inline else to avoid extra allocations.
    switch (this.os) {
        inline else => |os| switch (this.arch) {
            inline .arm64, .x64 => |arch| return struct {
                pub const values = &.{
                    "\"" ++ os.nameString() ++ "\"",

                    switch (arch) {
                        .x64 => "\"x64\"",
                        .arm64 => "\"arm64\"",
                        .wasm => @compileError("TODO"),
                    },

                    "\"" ++ Global.package_json_version ++ "\"",
                };
            }.values,
            else => @panic("TODO"),
        },
    }
}

pub fn fromJS(global: *jsc.JSGlobalObject, value: jsc.JSValue) bun.JSError!CompileTarget {
    const slice = try value.toSlice(global, bun.default_allocator);
    defer slice.deinit();
    if (!strings.hasPrefixComptime(slice.slice(), "bun-")) {
        return global.throwInvalidArguments("Expected compile target to start with 'bun-', got {s}", .{slice.slice()});
    }

    return fromSlice(global, slice.slice());
}

pub fn fromSlice(global: *jsc.JSGlobalObject, slice_with_bun_prefix: []const u8) bun.JSError!CompileTarget {
    const slice = slice_with_bun_prefix["bun-".len..];
    const target_parsed = tryFrom(slice) catch {
        return global.throwInvalidArguments("Unknown compile target: {s}", .{slice_with_bun_prefix});
    };
    if (!target_parsed.isSupported()) {
        return global.throwInvalidArguments("Unsupported compile target: {s}", .{slice_with_bun_prefix});
    }

    return target_parsed;
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const HTTP = bun.http;
const MutableString = bun.MutableString;
const Output = bun.Output;
const jsc = bun.jsc;
const strings = bun.strings;
