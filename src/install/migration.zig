const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const logger = bun.logger;

const install = @import("./install.zig");
const Resolution = @import("./resolution.zig").Resolution;
const Dependency = @import("./dependency.zig");
const VersionedURL = @import("./versioned_url.zig");
const Semver = @import("./semver.zig");

const Lockfile = @import("./lockfile.zig");
const LoadFromDiskResult = Lockfile.LoadFromDiskResult;

const JSAst = bun.JSAst;
const Expr = JSAst.Expr;
const B = JSAst.B;
const E = JSAst.E;
const G = JSAst.G;
const S = JSAst.S;

const debug = Output.scoped(.migrate, false);

pub fn detectAndLoadOtherLockfile(this: *Lockfile, allocator: Allocator, log: *logger.Log, dirname: string) LoadFromDiskResult {
    // check for package-lock.json, yarn.lock, etc...
    // if it exists, do an in-memory migration
    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    @memcpy(buf[0..dirname.len], dirname);

    npm: {
        const npm_lockfile_name = "package-lock.json";
        @memcpy(buf[dirname.len .. dirname.len + npm_lockfile_name.len], npm_lockfile_name);
        buf[dirname.len + npm_lockfile_name.len] = 0;
        const lockfile_path = buf[0 .. dirname.len + npm_lockfile_name.len :0];
        const file = std.fs.cwd().openFileZ(lockfile_path, .{ .mode = .read_only }) catch break :npm;
        defer file.close();
        var data = file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch |err| {
            return LoadFromDiskResult{ .err = .{ .step = .migrating, .value = err } };
        };
        return migrateNPMLockfile(this, allocator, log, data, lockfile_path) catch |err| {
            return LoadFromDiskResult{ .err = .{ .step = .migrating, .value = err } };
        };
    }

    return LoadFromDiskResult{ .not_found = {} };
}

const IdMap = std.StringHashMapUnmanaged(u32);

pub fn migrateNPMLockfile(this: *Lockfile, allocator: Allocator, log: *logger.Log, data: string, path: string) !LoadFromDiskResult {
    debug("begin lockfile migration", .{});

    try this.initEmpty(allocator);
    install.initializeStore();

    const json_src = logger.Source.initPathString(path, data);
    const json = try bun.JSON.ParseJSON(&json_src, log, allocator);

    if (json.data != .e_object) {
        return error.InvalidNPMPackageLockfile;
    }
    if (json.get("lockfileVersion")) |version| {
        if (!(version.data == .e_number and version.data.e_number.value == 3)) {
            return error.InvalidNPMPackageLockfile;
        }
    } else {
        return error.InvalidNPMPackageLockfile;
    }

    // Count pass
    var builder_ = this.stringBuilder();
    var builder = &builder_;
    const name = (if (json.get("name")) |expr| expr.asString(allocator) else null) orelse "";
    builder.count(name);

    var packages_properties = brk: {
        const obj = json.get("packages") orelse return error.InvalidNPMPackageLockfile;
        if (obj.data != .e_object) return error.InvalidNPMPackageLockfile;
        if (obj.data.e_object.properties.len == 0) return error.InvalidNPMPackageLockfile;
        // if (obj.data.e_object.properties.at(0).key) |k| {
        //     if (k.data != .e_string) return error.InvalidNPMPackageLockfile;
        //     // first key must be the "", self reference
        //     if (k.data.e_string.data.len == 0) return error.InvalidNPMPackageLockfile;
        // } else return error.InvalidNPMPackageLockfile;
        break :brk obj.data.e_object.properties;
    };

    // for faster lookups
    var id_map = IdMap{};
    try id_map.ensureTotalCapacity(allocator, packages_properties.len);
    var num_deps: u32 = 0;
    for (packages_properties.slice(), 0..) |prop, i| {
        id_map.putAssumeCapacity(prop.key.?.asString(allocator).?, @truncate(i));

        if (prop.value.?.data != .e_object) {
            return error.InvalidNPMPackageLockfile;
        }
        if (prop.value.?.data.e_object.get("dependencies")) |deps| {
            if (deps.data != .e_object) {
                return error.InvalidNPMPackageLockfile;
            }
            num_deps +|= @as(u32, deps.data.e_object.properties.len);
        }
    }
    if (num_deps == std.math.maxInt(u32)) return error.TooManyDependencies; // lol

    debug("num_deps: {d}", .{num_deps});

    try this.buffers.dependencies.ensureUnusedCapacity(allocator, num_deps);
    try this.buffers.resolutions.ensureUnusedCapacity(allocator, num_deps);

    try recursiveWalk(
        this,
        log,
        &id_map,
        &packages_properties,
        packages_properties.at(0).value.?,
        name,
        "",
        .{},
    );

    return error.NotImplementedYet;
}

fn recursiveWalk(
    this: *Lockfile,
    log: *logger.Log,
    id_map: *IdMap,
    all_packages_properties: *G.Property.List,
    value: Expr,
    pkg_name: string,
    pkg_path: string,
    resolution: Dependency.Version,
) !void {
    debug("recursiveWalk {s} @ {s}", .{ pkg_name, pkg_path });
    _ = resolution;

    if (value.get("dependencies")) |deps| {
        if (value.data == .e_object) {
            var name_checking_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            dep_loop: for (deps.data.e_object.properties.slice(), 0..) |prop, i| {
                _ = i;
                const name = prop.key.?.asString(this.allocator).?;
                const dependency = prop.value.?;
                const sliced = Semver.SlicedString.init(name, name);
                const version = Dependency.parse(this.allocator, Semver.String.init(name, name), dependency.asString(this.allocator).?, &sliced, log) orelse {
                    return error.InvalidLockfileSemver;
                };

                // TODO: this buffer can totally be avoided
                bun.copy(u8, name_checking_buf[0..pkg_name.len], pkg_name);
                const str_node_modules = if (pkg_path.len == 0) "node_modules/" else "/node_modules/";
                bun.copy(u8, name_checking_buf[pkg_name.len .. pkg_name.len + str_node_modules.len], str_node_modules);
                const suffix_len = str_node_modules.len + name.len;
                bun.copy(u8, name_checking_buf[pkg_name.len + str_node_modules.len .. pkg_name.len + suffix_len], name);
                var j: u32 = @as(u32, @intCast(pkg_name.len + suffix_len));
                while (true) {
                    if (id_map.get(name_checking_buf[0..j])) |existing| {
                        try recursiveWalk(
                            this,
                            log,
                            id_map,
                            all_packages_properties,
                            all_packages_properties.at(existing).value.?,
                            pkg_path[0..j],
                            name_checking_buf[0..j],
                            version,
                        );
                        continue :dep_loop;
                    }
                    if (strings.lastIndexOf(name_checking_buf[0 .. j - suffix_len], "node_modules/")) |idx| {
                        j = @intCast(idx - "node_modules/".len + name.len);
                        bun.copy(u8, name_checking_buf[j .. j + name.len], name);
                    } else {
                        return error.MissingLockfileDependency;
                    }
                }
            }
        }
    }
}
