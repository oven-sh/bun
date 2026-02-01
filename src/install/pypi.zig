//! PyPI (Python Package Index) client and wheel selection
//!
//! This module handles:
//! - Parsing PyPI JSON API responses (https://pypi.org/pypi/{package}/json)
//! - Selecting the best wheel for the current platform
//! - Parsing PEP 440 version specifiers from requires_dist

const PyPI = @This();

/// Python version constants - must match the version Bun is linked against
/// These are used for wheel compatibility checking and venv path construction
pub const python_version_major = 3;
pub const python_version_minor = 13;
pub const python_version_string = std.fmt.comptimePrint("{d}.{d}", .{ python_version_major, python_version_minor });

/// Virtual environment paths for Python packages
/// Structure: .venv/lib/python{major}.{minor}/site-packages/
pub const venv_lib_dir = ".venv/lib/python" ++ python_version_string;
pub const venv_site_packages = venv_lib_dir ++ "/site-packages";

const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const String = bun.Semver.String;
const Allocator = std.mem.Allocator;
const logger = bun.logger;
const JSON = bun.json;
const Environment = bun.Environment;
const OOM = bun.OOM;
const default_allocator = bun.default_allocator;
const initializeStore = @import("./install.zig").initializeMiniStore;

/// Platform target for wheel compatibility checking
pub const PlatformTarget = struct {
    os: Os,
    arch: Arch,
    /// Python version (e.g., 3.12 = { .major = 3, .minor = 12 })
    python_version: PythonVersion,

    pub const Os = enum {
        macos,
        linux,
        windows,
        unknown,
    };

    pub const Arch = enum {
        x86_64,
        aarch64,
        unknown,
    };

    pub const PythonVersion = struct {
        major: u8 = 3,
        minor: u8 = 12,

        pub fn format(self: PythonVersion, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.print("{d}.{d}", .{ self.major, self.minor });
        }
    };

    /// Detect current platform from compile-time target
    pub fn current() PlatformTarget {
        return .{
            .os = comptime if (Environment.isMac)
                Os.macos
            else if (Environment.isLinux)
                Os.linux
            else if (Environment.isWindows)
                Os.windows
            else
                Os.unknown,
            .arch = comptime if (Environment.isAarch64)
                Arch.aarch64
            else if (Environment.isX64)
                Arch.x86_64
            else
                Arch.unknown,
            // Use the Python version constants defined at module level
            .python_version = .{ .major = python_version_major, .minor = python_version_minor },
        };
    }

    /// Check if a platform tag is compatible with this target
    pub fn isPlatformCompatible(self: PlatformTarget, platform_tag: []const u8) bool {
        // "any" is always compatible
        if (strings.eqlComptime(platform_tag, "any")) return true;

        // Check OS-specific tags
        switch (self.os) {
            .macos => {
                // macOS tags: macosx_X_Y_arch, macosx_X_Y_universal, macosx_X_Y_universal2
                if (strings.hasPrefixComptime(platform_tag, "macosx_")) {
                    // Check architecture suffix
                    if (self.arch == .aarch64) {
                        return strings.hasSuffixComptime(platform_tag, "_arm64") or
                            strings.hasSuffixComptime(platform_tag, "_universal2") or
                            strings.hasSuffixComptime(platform_tag, "_universal");
                    } else if (self.arch == .x86_64) {
                        return strings.hasSuffixComptime(platform_tag, "_x86_64") or
                            strings.hasSuffixComptime(platform_tag, "_universal2") or
                            strings.hasSuffixComptime(platform_tag, "_universal") or
                            strings.hasSuffixComptime(platform_tag, "_intel");
                    }
                }
            },
            .linux => {
                // Linux tags: linux_x86_64, manylinux1_x86_64, manylinux2010_x86_64,
                // manylinux2014_x86_64, manylinux_2_17_x86_64, musllinux_1_1_x86_64
                const has_arch_suffix = if (self.arch == .aarch64)
                    strings.hasSuffixComptime(platform_tag, "_aarch64")
                else
                    strings.hasSuffixComptime(platform_tag, "_x86_64");
                if (has_arch_suffix) {
                    if (strings.hasPrefixComptime(platform_tag, "linux_") or
                        strings.hasPrefixComptime(platform_tag, "manylinux") or
                        strings.hasPrefixComptime(platform_tag, "musllinux"))
                    {
                        return true;
                    }
                }
            },
            .windows => {
                // Windows tags: win32, win_amd64, win_arm64
                if (self.arch == .x86_64) {
                    return strings.eqlComptime(platform_tag, "win_amd64") or
                        strings.eqlComptime(platform_tag, "win32");
                } else if (self.arch == .aarch64) {
                    return strings.eqlComptime(platform_tag, "win_arm64");
                }
            },
            .unknown => {},
        }
        return false;
    }

    /// Check if a Python version tag is compatible
    pub fn isPythonCompatible(self: PlatformTarget, python_tag: []const u8) bool {
        // "py3" matches any Python 3.x
        if (strings.eqlComptime(python_tag, "py3")) return self.python_version.major == 3;
        if (strings.eqlComptime(python_tag, "py2.py3")) return true;
        if (strings.eqlComptime(python_tag, "py2")) return self.python_version.major == 2;

        // "cpXY" matches CPython X.Y specifically (compiled extensions require exact match)
        if (strings.hasPrefixComptime(python_tag, "cp")) {
            const version_part = python_tag[2..];
            if (version_part.len >= 2) {
                const major = std.fmt.parseInt(u8, version_part[0..1], 10) catch return false;
                const minor = std.fmt.parseInt(u8, version_part[1..], 10) catch return false;
                return self.python_version.major == major and self.python_version.minor == minor;
            }
        }

        // "pyXY" matches Python X.Y or higher minor versions
        if (strings.hasPrefixComptime(python_tag, "py")) {
            const version_part = python_tag[2..];
            if (version_part.len >= 2) {
                const major = std.fmt.parseInt(u8, version_part[0..1], 10) catch return false;
                const minor = std.fmt.parseInt(u8, version_part[1..], 10) catch return false;
                return self.python_version.major == major and self.python_version.minor >= minor;
            }
        }

        return false;
    }

    /// Check if an ABI tag is compatible
    pub fn isAbiCompatible(self: PlatformTarget, abi_tag: []const u8) bool {
        // "none" means no ABI dependency (pure Python or uses stable ABI)
        if (strings.eqlComptime(abi_tag, "none")) return true;

        // "abi3" is the stable ABI, compatible with Python 3.2+
        if (strings.eqlComptime(abi_tag, "abi3")) return self.python_version.major == 3 and self.python_version.minor >= 2;

        // "cpXY" or "cpXYm" matches specific CPython ABI
        if (strings.hasPrefixComptime(abi_tag, "cp")) {
            var version_part = abi_tag[2..];
            // Remove trailing 'm' if present (legacy ABI marker)
            if (version_part.len > 0 and version_part[version_part.len - 1] == 'm') {
                version_part = version_part[0 .. version_part.len - 1];
            }
            if (version_part.len >= 2) {
                const major = std.fmt.parseInt(u8, version_part[0..1], 10) catch return false;
                const minor = std.fmt.parseInt(u8, version_part[1..], 10) catch return false;
                return self.python_version.major == major and self.python_version.minor == minor;
            }
        }

        return false;
    }
};

/// Parsed wheel filename components
/// Format: {distribution}-{version}(-{build})?-{python}-{abi}-{platform}.whl
pub const WheelTag = struct {
    python: []const u8,
    abi: []const u8,
    platform: []const u8,

    /// Parse wheel tags from a wheel filename
    /// Returns null if not a valid wheel filename
    pub fn parse(filename: []const u8) ?WheelTag {
        // Must end with .whl
        if (!strings.hasSuffixComptime(filename, ".whl")) return null;

        const name_without_ext = filename[0 .. filename.len - 4];

        // Split by '-' and get the last 3 components (python-abi-platform)
        var parts: [8][]const u8 = undefined;
        var part_count: usize = 0;

        var iter = std.mem.splitScalar(u8, name_without_ext, '-');
        while (iter.next()) |part| {
            if (part_count >= 8) return null; // Too many parts
            parts[part_count] = part;
            part_count += 1;
        }

        // Minimum: name-version-python-abi-platform = 5 parts
        if (part_count < 5) return null;

        return .{
            .platform = parts[part_count - 1],
            .abi = parts[part_count - 2],
            .python = parts[part_count - 3],
        };
    }

    /// Calculate a compatibility score (higher is better)
    /// Returns null if not compatible
    pub fn compatibilityScore(self: WheelTag, target: PlatformTarget) ?u32 {
        // Check basic compatibility first
        if (!target.isPythonCompatible(self.python)) return null;
        if (!target.isAbiCompatible(self.abi)) return null;
        if (!target.isPlatformCompatible(self.platform)) return null;

        var score: u32 = 100;

        // Prefer platform-specific wheels over "any"
        if (!strings.eqlComptime(self.platform, "any")) {
            score += 50;
        }

        // Prefer specific Python version over generic "py3"
        if (strings.hasPrefixComptime(self.python, "cp")) {
            score += 30;
        }

        // Prefer specific ABI over "none" or "abi3"
        if (!strings.eqlComptime(self.abi, "none") and !strings.eqlComptime(self.abi, "abi3")) {
            score += 20;
        }

        // Prefer newer manylinux versions
        if (strings.hasPrefixComptime(self.platform, "manylinux_2_")) {
            score += 10;
        } else if (strings.hasPrefixComptime(self.platform, "manylinux2014")) {
            score += 8;
        } else if (strings.hasPrefixComptime(self.platform, "manylinux2010")) {
            score += 5;
        }

        return score;
    }
};

/// A file (wheel or source distribution) from PyPI
pub const File = struct {
    filename: String,
    url: String,
    sha256: String,
    python_version: String,
    requires_python: String,
    packagetype: PackageType,
    size: u64,

    pub const PackageType = enum(u8) {
        bdist_wheel = 0,
        sdist = 1,
        bdist_egg = 2,
        other = 3,

        pub fn fromString(s: []const u8) PackageType {
            if (strings.eqlComptime(s, "bdist_wheel")) return .bdist_wheel;
            if (strings.eqlComptime(s, "sdist")) return .sdist;
            if (strings.eqlComptime(s, "bdist_egg")) return .bdist_egg;
            return .other;
        }
    };

    /// Check if this file is a wheel
    pub fn isWheel(self: File, buf: []const u8) bool {
        return self.packagetype == .bdist_wheel or
            strings.hasSuffixComptime(self.filename.slice(buf), ".whl");
    }

    /// Get wheel tags for this file (only valid for wheels)
    pub fn wheelTag(self: File, buf: []const u8) ?WheelTag {
        return WheelTag.parse(self.filename.slice(buf));
    }
};

/// Parsed PyPI package manifest
pub const PackageManifest = struct {
    pkg: Package = .{},
    string_buf: []const u8 = "",
    files: []const File = &.{},

    pub const Package = struct {
        name: String = .{},
        latest_version: String = .{},
        requires_python: String = .{},
        requires_dist_off: u32 = 0,
        requires_dist_len: u32 = 0,
    };

    pub fn name(self: *const PackageManifest) []const u8 {
        return self.pkg.name.slice(self.string_buf);
    }

    pub fn latestVersion(self: *const PackageManifest) []const u8 {
        return self.pkg.latest_version.slice(self.string_buf);
    }

    /// Get the requires_dist (dependencies) as a slice of the string buffer
    pub fn requiresDist(self: *const PackageManifest) []const u8 {
        if (self.pkg.requires_dist_len == 0) return "";
        return self.string_buf[self.pkg.requires_dist_off..][0..self.pkg.requires_dist_len];
    }

    /// Iterator over applicable dependencies (filtered by platform/python version)
    pub const DependencyIterator = struct {
        remaining: []const u8,
        target: PlatformTarget,

        pub fn next(self: *DependencyIterator) ?DependencySpecifier {
            while (self.remaining.len > 0) {
                // Find next newline
                const end = strings.indexOfChar(self.remaining, '\n') orelse self.remaining.len;
                const line = strings.trim(self.remaining[0..end], &strings.whitespace_chars);
                self.remaining = if (end < self.remaining.len) self.remaining[end + 1 ..] else "";

                if (line.len == 0) continue;

                if (DependencySpecifier.parse(line)) |spec| {
                    if (spec.name.len > 0 and spec.isApplicable(self.target)) {
                        return spec;
                    }
                }
            }
            return null;
        }

        /// Count the number of applicable dependencies
        pub fn count(self: *DependencyIterator) usize {
            var n: usize = 0;
            var iter = self.*;
            while (iter.next()) |_| {
                n += 1;
            }
            return n;
        }
    };

    /// Get an iterator over applicable dependencies
    pub fn iterDependencies(self: *const PackageManifest, target: PlatformTarget) DependencyIterator {
        return .{
            .remaining = self.requiresDist(),
            .target = target,
        };
    }

    /// Find the best wheel for the given target platform
    /// Returns null if no compatible wheel is found
    pub fn findBestWheel(self: *const PackageManifest, target: PlatformTarget) ?*const File {
        var best_file: ?*const File = null;
        var best_score: u32 = 0;

        for (self.files) |*file| {
            if (!file.isWheel(self.string_buf)) continue;

            if (file.wheelTag(self.string_buf)) |tag| {
                if (tag.compatibilityScore(target)) |score| {
                    if (score > best_score) {
                        best_score = score;
                        best_file = file;
                    }
                }
            }
        }

        return best_file;
    }

    /// Parse a PyPI JSON API response
    pub fn parse(
        allocator: Allocator,
        log: *logger.Log,
        json_buffer: []const u8,
        expected_name: []const u8,
    ) OOM!?PackageManifest {
        const source = &logger.Source.initPathString(expected_name, json_buffer);
        initializeStore();
        defer bun.ast.Stmt.Data.Store.memory_allocator.?.pop();

        var arena = bun.ArenaAllocator.init(allocator);
        defer arena.deinit();

        const json = JSON.parseUTF8(
            source,
            log,
            arena.allocator(),
        ) catch {
            return null;
        };

        // Check for error response
        if (json.asProperty("message")) |msg| {
            if (msg.expr.asString(allocator)) |err_msg| {
                log.addErrorFmt(source, logger.Loc.Empty, allocator, "PyPI error: {s}", .{err_msg}) catch {};
                return null;
            }
        }

        var result: PackageManifest = .{
            .pkg = .{
                .name = .{},
                .latest_version = .{},
                .requires_python = .{},
                .requires_dist_off = 0,
                .requires_dist_len = 0,
            },
            .string_buf = &.{},
            .files = &.{},
        };

        var string_pool = String.Builder.StringPool.init(default_allocator);
        defer string_pool.deinit();

        var string_builder = String.Builder{
            .string_pool = string_pool,
        };

        // Count strings needed
        const info = json.asProperty("info") orelse return null;

        // Name
        if (info.expr.asProperty("name")) |name_prop| {
            if (name_prop.expr.asString(allocator)) |n| {
                string_builder.count(n);
            }
        }

        // Version
        if (info.expr.asProperty("version")) |version_prop| {
            if (version_prop.expr.asString(allocator)) |v| {
                string_builder.count(v);
            }
        }

        // requires_python
        if (info.expr.asProperty("requires_python")) |rp| {
            if (rp.expr.asString(allocator)) |rp_str| {
                string_builder.count(rp_str);
            }
        }

        // requires_dist (dependencies)
        var requires_dist_total_len: usize = 0;
        if (info.expr.asProperty("requires_dist")) |rd| {
            if (rd.expr.data == .e_array) {
                for (rd.expr.data.e_array.slice()) |item| {
                    if (item.asString(allocator)) |dep| {
                        requires_dist_total_len += dep.len + 1; // +1 for newline separator
                    }
                }
            }
        }
        if (requires_dist_total_len > 0) {
            string_builder.cap += requires_dist_total_len;
        }

        // Count files from "urls" (files for latest version)
        var file_count: usize = 0;
        if (json.asProperty("urls")) |urls| {
            if (urls.expr.data == .e_array) {
                for (urls.expr.data.e_array.slice()) |file_obj| {
                    if (file_obj.data != .e_object) continue;

                    file_count += 1;

                    if (file_obj.asProperty("filename")) |f| {
                        if (f.expr.asString(allocator)) |filename| {
                            string_builder.count(filename);
                        }
                    }
                    if (file_obj.asProperty("url")) |u| {
                        if (u.expr.asString(allocator)) |url| {
                            string_builder.count(url);
                        }
                    }
                    if (file_obj.asProperty("digests")) |d| {
                        if (d.expr.asProperty("sha256")) |sha| {
                            if (sha.expr.asString(allocator)) |sha_str| {
                                string_builder.count(sha_str);
                            }
                        }
                    }
                    if (file_obj.asProperty("python_version")) |pv| {
                        if (pv.expr.asString(allocator)) |pv_str| {
                            string_builder.count(pv_str);
                        }
                    }
                    if (file_obj.asProperty("requires_python")) |rp| {
                        if (rp.expr.asString(allocator)) |rp_str| {
                            string_builder.count(rp_str);
                        }
                    }
                }
            }
        }

        // Allocate
        try string_builder.allocate(default_allocator);
        errdefer if (string_builder.ptr) |ptr| default_allocator.free(ptr[0..string_builder.cap]);

        const files = try default_allocator.alloc(File, file_count);
        errdefer default_allocator.free(files);

        // Second pass: populate data
        if (info.expr.asProperty("name")) |name_prop| {
            if (name_prop.expr.asString(allocator)) |n| {
                result.pkg.name = string_builder.append(String, n);
            }
        }

        if (info.expr.asProperty("version")) |version_prop| {
            if (version_prop.expr.asString(allocator)) |v| {
                result.pkg.latest_version = string_builder.append(String, v);
            }
        }

        if (info.expr.asProperty("requires_python")) |rp| {
            if (rp.expr.asString(allocator)) |rp_str| {
                result.pkg.requires_python = string_builder.append(String, rp_str);
            }
        }

        // requires_dist - write directly to the buffer
        if (info.expr.asProperty("requires_dist")) |rd| {
            if (rd.expr.data == .e_array) {
                result.pkg.requires_dist_off = @intCast(string_builder.len);
                const buf_slice = string_builder.ptr.?[string_builder.len..string_builder.cap];
                var write_pos: usize = 0;
                for (rd.expr.data.e_array.slice()) |item| {
                    if (item.asString(allocator)) |dep| {
                        @memcpy(buf_slice[write_pos..][0..dep.len], dep);
                        write_pos += dep.len;
                        buf_slice[write_pos] = '\n';
                        write_pos += 1;
                    }
                }
                string_builder.len += write_pos;
                result.pkg.requires_dist_len = @intCast(write_pos);
            }
        }

        // Populate files
        var file_idx: usize = 0;
        if (json.asProperty("urls")) |urls| {
            if (urls.expr.data == .e_array) {
                for (urls.expr.data.e_array.slice()) |file_obj| {
                    if (file_obj.data != .e_object) continue;
                    if (file_idx >= file_count) break;

                    var file = File{
                        .filename = .{},
                        .url = .{},
                        .sha256 = .{},
                        .python_version = .{},
                        .requires_python = .{},
                        .packagetype = .other,
                        .size = 0,
                    };

                    if (file_obj.asProperty("filename")) |f| {
                        if (f.expr.asString(allocator)) |filename| {
                            file.filename = string_builder.append(String, filename);
                        }
                    }
                    if (file_obj.asProperty("url")) |u| {
                        if (u.expr.asString(allocator)) |url| {
                            file.url = string_builder.append(String, url);
                        }
                    }
                    if (file_obj.asProperty("digests")) |d| {
                        if (d.expr.asProperty("sha256")) |sha| {
                            if (sha.expr.asString(allocator)) |sha_str| {
                                file.sha256 = string_builder.append(String, sha_str);
                            }
                        }
                    }
                    if (file_obj.asProperty("python_version")) |pv| {
                        if (pv.expr.asString(allocator)) |pv_str| {
                            file.python_version = string_builder.append(String, pv_str);
                        }
                    }
                    if (file_obj.asProperty("requires_python")) |rp| {
                        if (rp.expr.asString(allocator)) |rp_str| {
                            file.requires_python = string_builder.append(String, rp_str);
                        }
                    }
                    if (file_obj.asProperty("packagetype")) |pt| {
                        if (pt.expr.asString(allocator)) |pt_str| {
                            file.packagetype = File.PackageType.fromString(pt_str);
                        }
                    }
                    if (file_obj.asProperty("size")) |sz| {
                        if (sz.expr.data == .e_number) {
                            file.size = @intFromFloat(sz.expr.data.e_number.value);
                        }
                    }

                    files[file_idx] = file;
                    file_idx += 1;
                }
            }
        }

        result.string_buf = string_builder.allocatedSlice();
        result.files = files[0..file_idx];

        return result;
    }

    pub fn deinit(self: *PackageManifest) void {
        if (self.string_buf.len > 0) {
            default_allocator.free(self.string_buf);
        }
        if (self.files.len > 0) {
            default_allocator.free(self.files);
        }
        self.* = .{
            .pkg = .{
                .name = .{},
                .latest_version = .{},
                .requires_python = .{},
                .requires_dist_off = 0,
                .requires_dist_len = 0,
            },
            .string_buf = &.{},
            .files = &.{},
        };
    }
};

/// Parse a PEP 440 dependency specifier from requires_dist
/// Format: "package_name (>=1.0,<2.0) ; extra == 'dev'"
pub const DependencySpecifier = struct {
    name: []const u8,
    version_spec: []const u8,
    extras: []const u8,
    markers: []const u8,

    pub fn parse(spec: []const u8) ?DependencySpecifier {
        var result = DependencySpecifier{
            .name = "",
            .version_spec = "",
            .extras = "",
            .markers = "",
        };

        var remaining = strings.trim(spec, &strings.whitespace_chars);

        // Find the end of the package name (first space, [, (, or ;)
        var name_end: usize = 0;
        for (remaining, 0..) |c, i| {
            if (c == ' ' or c == '[' or c == '(' or c == ';' or c == '<' or c == '>' or c == '=' or c == '!' or c == '~') {
                name_end = i;
                break;
            }
        } else {
            // Entire string is the package name
            result.name = remaining;
            return result;
        }

        result.name = remaining[0..name_end];
        remaining = remaining[name_end..];
        remaining = strings.trim(remaining, &strings.whitespace_chars);

        // Check for extras [extra1,extra2]
        if (remaining.len > 0 and remaining[0] == '[') {
            if (strings.indexOfChar(remaining, ']')) |end| {
                result.extras = remaining[1..end];
                remaining = remaining[end + 1 ..];
                remaining = strings.trim(remaining, &strings.whitespace_chars);
            }
        }

        // Check for version specifier (>=1.0,<2.0) or just >=1.0
        if (remaining.len > 0) {
            if (remaining[0] == '(') {
                if (strings.indexOfChar(remaining, ')')) |end| {
                    result.version_spec = remaining[1..end];
                    remaining = remaining[end + 1 ..];
                    remaining = strings.trim(remaining, &strings.whitespace_chars);
                }
            } else if (remaining[0] == '>' or remaining[0] == '<' or remaining[0] == '=' or remaining[0] == '!' or remaining[0] == '~') {
                // Version spec without parens - find the end (space or ;)
                var spec_end: usize = remaining.len;
                for (remaining, 0..) |c, i| {
                    if (c == ' ' or c == ';') {
                        spec_end = i;
                        break;
                    }
                }
                result.version_spec = remaining[0..spec_end];
                remaining = remaining[spec_end..];
                remaining = strings.trim(remaining, &strings.whitespace_chars);
            }
        }

        // Check for environment markers ; python_version >= "3.8"
        if (remaining.len > 0 and remaining[0] == ';') {
            result.markers = strings.trim(remaining[1..], &strings.whitespace_chars);
        }

        return result;
    }

    /// Check if this dependency should be included for the given Python version.
    /// Returns false for dependencies that:
    /// - Require extras (e.g., "extra == 'socks'")
    /// - Have unsatisfied Python version markers
    /// - Have unsatisfied platform markers (platform_system, sys_platform)
    pub fn isApplicable(self: DependencySpecifier, target: PlatformTarget) bool {
        if (self.markers.len == 0) return true;

        // Skip dependencies that require extras (e.g., "; extra == 'socks'")
        // These are optional dependencies that the user must explicitly request
        if (strings.containsComptime(self.markers, "extra")) return false;

        // Parse python_version markers
        // Common formats: python_version >= "3.8", python_version < "3.10"
        // For now, we're permissive - include unless we can definitively exclude
        if (strings.containsComptime(self.markers, "python_version")) {
            // Try to parse simple python_version constraints
            // Format: python_version <op> "X.Y"
            if (strings.indexOf(self.markers, "python_version")) |idx| {
                var marker_remaining = self.markers[idx + "python_version".len ..];
                marker_remaining = strings.trim(marker_remaining, &strings.whitespace_chars);

                // Parse operator
                var op: enum { lt, lte, gt, gte, eq, neq } = .gte;
                if (strings.hasPrefixComptime(marker_remaining, ">=")) {
                    op = .gte;
                    marker_remaining = marker_remaining[2..];
                } else if (strings.hasPrefixComptime(marker_remaining, "<=")) {
                    op = .lte;
                    marker_remaining = marker_remaining[2..];
                } else if (strings.hasPrefixComptime(marker_remaining, "==")) {
                    op = .eq;
                    marker_remaining = marker_remaining[2..];
                } else if (strings.hasPrefixComptime(marker_remaining, "!=")) {
                    op = .neq;
                    marker_remaining = marker_remaining[2..];
                } else if (strings.hasPrefixComptime(marker_remaining, "<")) {
                    op = .lt;
                    marker_remaining = marker_remaining[1..];
                } else if (strings.hasPrefixComptime(marker_remaining, ">")) {
                    op = .gt;
                    marker_remaining = marker_remaining[1..];
                }

                marker_remaining = strings.trim(marker_remaining, &strings.whitespace_chars);

                // Parse version string (remove quotes)
                if (marker_remaining.len > 0 and (marker_remaining[0] == '"' or marker_remaining[0] == '\'')) {
                    const quote = marker_remaining[0];
                    marker_remaining = marker_remaining[1..];
                    if (strings.indexOfChar(marker_remaining, quote)) |end| {
                        const ver_str = marker_remaining[0..end];
                        // Parse "X.Y" format
                        if (strings.indexOfChar(ver_str, '.')) |dot| {
                            const major = std.fmt.parseInt(u8, ver_str[0..dot], 10) catch return true;
                            const minor = std.fmt.parseInt(u8, ver_str[dot + 1 ..], 10) catch return true;

                            // Compare with current Python version
                            const current = @as(u16, target.python_version.major) * 100 + target.python_version.minor;
                            const required = @as(u16, major) * 100 + minor;

                            const version_matches = switch (op) {
                                .lt => current < required,
                                .lte => current <= required,
                                .gt => current > required,
                                .gte => current >= required,
                                .eq => current == required,
                                .neq => current != required,
                            };
                            if (!version_matches) return false;
                        }
                    }
                }
            }
        }

        // Handle platform_system markers (e.g., platform_system == "Linux")
        if (strings.containsComptime(self.markers, "platform_system")) {
            const current_platform: []const u8 = switch (target.os) {
                .macos => "Darwin",
                .linux => "Linux",
                .windows => "Windows",
                .unknown => "",
            };

            // Check for platform_system == "X" or platform_system != "X"
            if (strings.indexOf(self.markers, "platform_system")) |idx| {
                var marker_remaining = self.markers[idx + "platform_system".len ..];
                marker_remaining = strings.trim(marker_remaining, &strings.whitespace_chars);

                var is_negated = false;
                if (strings.hasPrefixComptime(marker_remaining, "!=")) {
                    is_negated = true;
                    marker_remaining = marker_remaining[2..];
                } else if (strings.hasPrefixComptime(marker_remaining, "==")) {
                    marker_remaining = marker_remaining[2..];
                } else {
                    // Unknown operator, be permissive
                    return true;
                }

                marker_remaining = strings.trim(marker_remaining, &strings.whitespace_chars);

                // Parse quoted platform string
                if (marker_remaining.len > 0 and (marker_remaining[0] == '"' or marker_remaining[0] == '\'')) {
                    const quote = marker_remaining[0];
                    marker_remaining = marker_remaining[1..];
                    if (strings.indexOfChar(marker_remaining, quote)) |end| {
                        const platform_str = marker_remaining[0..end];
                        const matches = strings.eql(platform_str, current_platform);
                        const platform_matches = if (is_negated) !matches else matches;
                        if (!platform_matches) return false;
                    }
                }
            }
        }

        // Handle sys_platform markers (e.g., sys_platform == "linux")
        if (strings.containsComptime(self.markers, "sys_platform")) {
            const current_sys_platform: []const u8 = switch (target.os) {
                .macos => "darwin",
                .linux => "linux",
                .windows => "win32",
                .unknown => "",
            };

            if (strings.indexOf(self.markers, "sys_platform")) |idx| {
                var marker_remaining = self.markers[idx + "sys_platform".len ..];
                marker_remaining = strings.trim(marker_remaining, &strings.whitespace_chars);

                var is_negated = false;
                if (strings.hasPrefixComptime(marker_remaining, "!=")) {
                    is_negated = true;
                    marker_remaining = marker_remaining[2..];
                } else if (strings.hasPrefixComptime(marker_remaining, "==")) {
                    marker_remaining = marker_remaining[2..];
                } else {
                    return true;
                }

                marker_remaining = strings.trim(marker_remaining, &strings.whitespace_chars);

                if (marker_remaining.len > 0 and (marker_remaining[0] == '"' or marker_remaining[0] == '\'')) {
                    const quote = marker_remaining[0];
                    marker_remaining = marker_remaining[1..];
                    if (strings.indexOfChar(marker_remaining, quote)) |end| {
                        const platform_str = marker_remaining[0..end];
                        const matches = strings.eql(platform_str, current_sys_platform);
                        const platform_matches = if (is_negated) !matches else matches;
                        if (!platform_matches) return false;
                    }
                }
            }
        }

        // For other markers (implementation, etc.), be permissive
        return true;
    }

    /// Normalize a Python version (PEP 440) to a semver-compatible format.
    /// Strips suffixes like .postN, .devN that semver doesn't understand.
    /// Returns the normalized version string length.
    pub fn normalizeVersion(version: []const u8, buf: []u8) []const u8 {
        // Find and strip Python-specific suffixes:
        // - .postN (post-releases)
        // - .devN (development releases)
        // - +local (local version identifier)
        var end = version.len;

        // Strip local version identifier (+...)
        if (strings.indexOfChar(version, '+')) |plus_idx| {
            end = plus_idx;
        }

        // Strip .post, .dev suffixes
        const suffixes = [_][]const u8{ ".post", ".dev" };
        for (suffixes) |suffix| {
            if (strings.indexOf(version[0..end], suffix)) |suffix_idx| {
                end = suffix_idx;
                break;
            }
        }

        const copy_len = @min(end, buf.len);
        @memcpy(buf[0..copy_len], version[0..copy_len]);
        return buf[0..copy_len];
    }

    /// Normalize a PyPI package name according to PEP 503
    /// - Lowercase
    /// - Replace runs of [-_.] with single -
    pub fn normalizeName(name: []const u8, buf: []u8) []const u8 {
        var write_idx: usize = 0;
        var prev_was_separator = false;

        for (name) |c| {
            if (write_idx >= buf.len) break;
            const is_separator = (c == '-' or c == '_' or c == '.');
            if (is_separator) {
                if (!prev_was_separator) {
                    buf[write_idx] = '-';
                    write_idx += 1;
                }
                prev_was_separator = true;
            } else {
                buf[write_idx] = std.ascii.toLower(c);
                write_idx += 1;
                prev_was_separator = false;
            }
        }

        return buf[0..write_idx];
    }
};

test "WheelTag.parse" {
    const tag1 = WheelTag.parse("numpy-2.0.0-cp312-cp312-macosx_14_0_arm64.whl");
    try std.testing.expect(tag1 != null);
    try std.testing.expectEqualStrings("cp312", tag1.?.python);
    try std.testing.expectEqualStrings("cp312", tag1.?.abi);
    try std.testing.expectEqualStrings("macosx_14_0_arm64", tag1.?.platform);

    const tag2 = WheelTag.parse("requests-2.32.0-py3-none-any.whl");
    try std.testing.expect(tag2 != null);
    try std.testing.expectEqualStrings("py3", tag2.?.python);
    try std.testing.expectEqualStrings("none", tag2.?.abi);
    try std.testing.expectEqualStrings("any", tag2.?.platform);

    // Not a wheel
    try std.testing.expect(WheelTag.parse("requests-2.32.0.tar.gz") == null);
}

test "PlatformTarget.isPlatformCompatible" {
    const mac_arm = PlatformTarget{
        .os = .macos,
        .arch = .aarch64,
        .python_version = .{ .major = 3, .minor = 12 },
    };

    try std.testing.expect(mac_arm.isPlatformCompatible("any"));
    try std.testing.expect(mac_arm.isPlatformCompatible("macosx_14_0_arm64"));
    try std.testing.expect(mac_arm.isPlatformCompatible("macosx_11_0_universal2"));
    try std.testing.expect(!mac_arm.isPlatformCompatible("macosx_14_0_x86_64"));
    try std.testing.expect(!mac_arm.isPlatformCompatible("linux_x86_64"));
}

test "DependencySpecifier.parse" {
    const spec1 = DependencySpecifier.parse("requests>=2.0,<3.0");
    try std.testing.expect(spec1 != null);
    try std.testing.expectEqualStrings("requests", spec1.?.name);
    try std.testing.expectEqualStrings(">=2.0,<3.0", spec1.?.version_spec);

    const spec2 = DependencySpecifier.parse("urllib3 (>=1.21.1,<3)");
    try std.testing.expect(spec2 != null);
    try std.testing.expectEqualStrings("urllib3", spec2.?.name);
    try std.testing.expectEqualStrings(">=1.21.1,<3", spec2.?.version_spec);

    const spec3 = DependencySpecifier.parse("PySocks!=1.5.7,>=1.5.6 ; extra == 'socks'");
    try std.testing.expect(spec3 != null);
    try std.testing.expectEqualStrings("PySocks", spec3.?.name);
    try std.testing.expectEqualStrings("!=1.5.7,>=1.5.6", spec3.?.version_spec);
    try std.testing.expectEqualStrings("extra == 'socks'", spec3.?.markers);
}
