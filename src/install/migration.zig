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

const Install = @import("./install.zig");
const Resolution = @import("./resolution.zig").Resolution;
const Dependency = @import("./dependency.zig");
const VersionedURL = @import("./versioned_url.zig");
const Npm = @import("./npm.zig");
const Integrity = @import("./integrity.zig").Integrity;
const Bin = @import("./bin.zig").Bin;

const Semver = @import("./semver.zig");
const String = Semver.String;
const ExternalString = Semver.ExternalString;
const stringHash = String.Builder.stringHash;

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
        var timer = std.time.Timer.start() catch unreachable;
        const file = std.fs.cwd().openFileZ(lockfile_path, .{ .mode = .read_only }) catch break :npm;
        defer file.close();
        var data = file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch |err| {
            return LoadFromDiskResult{ .err = .{ .step = .migrating, .value = err } };
        };
        const lockfile = migrateNPMLockfile(this, allocator, log, data, lockfile_path) catch |err| {
            if (Environment.allow_assert) {
                const maybe_trace = @errorReturnTrace();
                Output.prettyErrorln("Error: {s}", .{@errorName(err)});
                log.printForLogLevel(Output.errorWriter()) catch {};
                if (maybe_trace) |trace| {
                    std.debug.dumpStackTrace(trace.*);
                }
                Output.prettyErrorln("Invalid NPM package-lock.json\nIn release build, this would continue and do a fresh install.\nDebug bun will exit now.", .{});
                Global.exit(1);
            }
            return LoadFromDiskResult{ .err = .{ .step = .migrating, .value = err } };
        };

        if (lockfile == .ok) {
            Output.printElapsed(@as(f64, @floatFromInt(timer.read())) / std.time.ns_per_ms);
            Output.prettyError(" ", .{});
            Output.prettyErrorln("<d>migrated lockfile from <r><green>package-lock.json<r>", .{});
            Output.flush();
        }

        return lockfile;
    }

    return LoadFromDiskResult{ .not_found = {} };
}

const IdMap = std.StringHashMapUnmanaged(IdMapValue);
const IdMapValue = packed struct(u64) {
    /// index into the old package-lock.json package entries.
    old_json_index: u32,
    /// this is the new package id for the bun lockfile
    ///
    /// - if this new_package_id is set to `package_id_is_link`, it means it's a link
    /// and to get the actual package id, you need to lookup `.resolved` in the hashmap.
    /// - if it is `package_id_is_bundled`, it means it's a bundled dependency that was not
    /// marked by npm, which can happen to some transitive dependencies.
    new_package_id: u32,
};
const package_id_is_link = std.math.maxInt(u32);
const package_id_is_bundled = std.math.maxInt(u32) - 1;

const unset_package_id = Install.invalid_package_id - 1;

const dependency_keys = .{
    .dependencies,
    .devDependencies,
    .peerDependencies,
    .optionalDependencies,
};

// pub const MigrateError = error{
//     /// The package-lock.json was not version 3
//     NPMLockfileVersionMismatch,
//     /// The package-lock.json was invalid.
//     InvalidNPMLockfile,
//     /// The package-lock.json was missing information on how to build a resolution for
//     /// a certain package.
//     NotAllPackagesGotResolved,
//     /// A case we dont handle where a linked package does not have a resolution
//     /// TODO: handle this internally
//     LockfileWorkspaceMissingResolved,
//     /// A path was too long
//     PathTooLong,
// } || Allocator.Error;

pub fn migrateNPMLockfile(this: *Lockfile, allocator: Allocator, log: *logger.Log, data: string, path: string) !LoadFromDiskResult {
    debug("begin lockfile migration", .{});

    try this.initEmpty(allocator);
    Install.initializeStore();

    const json_src = logger.Source.initPathString(path, data);
    const json = bun.JSON.ParseJSON(&json_src, log, allocator) catch return error.InvalidNPMLockfile;

    if (json.data != .e_object) {
        return error.InvalidNPMLockfile;
    }
    if (json.get("lockfileVersion")) |version| {
        if (!(version.data == .e_number and version.data.e_number.value == 3)) {
            return error.NPMLockfileVersionMismatch;
        }
    } else {
        return error.InvalidNPMLockfile;
    }

    // Count pass
    var builder_ = this.stringBuilder();
    var builder = &builder_;
    const name = (if (json.get("name")) |expr| expr.asString(allocator) else null) orelse "";
    builder.count(name);

    var root_package: *E.Object = undefined;
    var packages_properties = brk: {
        const obj = json.get("packages") orelse return error.InvalidNPMLockfile;
        if (obj.data != .e_object) return error.InvalidNPMLockfile;
        if (obj.data.e_object.properties.len == 0) return error.InvalidNPMLockfile;
        const prop1 = obj.data.e_object.properties.at(0);
        if (prop1.key) |k| {
            if (k.data != .e_string) return error.InvalidNPMLockfile;
            // first key must be the "", self reference
            if (k.data.e_string.data.len != 0) return error.InvalidNPMLockfile;
            if (prop1.value.?.data != .e_object) return error.InvalidNPMLockfile;
            root_package = prop1.value.?.data.e_object;
        } else return error.InvalidNPMLockfile;
        break :brk obj.data.e_object.properties;
    };

    const workspace_map: ?Lockfile.Package.WorkspaceMap = workspace_map: {
        if (root_package.get("workspaces")) |wksp| {
            var workspaces = Lockfile.Package.WorkspaceMap.init(allocator);

            const json_array = switch (wksp.data) {
                .e_array => |arr| arr,
                .e_object => |obj| if (obj.get("packages")) |packages| switch (packages.data) {
                    .e_array => |arr| arr,
                    else => return error.InvalidNPMLockfile,
                } else return error.InvalidNPMLockfile,
                else => return error.InvalidNPMLockfile,
            };

            const workspace_packages_count = try Lockfile.Package.processWorkspaceNamesArray(
                &workspaces,
                allocator,
                log,
                json_array,
                &json_src,
                wksp.loc,
                builder,
            );
            debug("found {d} workspace packages", .{workspace_packages_count});
            break :workspace_map workspaces;
        }
        break :workspace_map null;
    };

    // Counting Phase
    // This "IdMap" is used to make object key lookups faster for the `packages` object
    // it also lets us resolve linked and bundled packages.
    var id_map = IdMap{};
    try id_map.ensureTotalCapacity(allocator, packages_properties.len);
    var num_deps: u32 = 0;
    var num_extern_strings: u32 = 0;
    var package_idx: u32 = 0;
    for (packages_properties.slice(), 0..) |entry, i| {
        const pkg_path = entry.key.?.asString(allocator).?;
        if (entry.value.?.data != .e_object)
            return error.InvalidNPMLockfile;

        const pkg = entry.value.?.data.e_object;

        if (pkg.get("link") != null) {
            id_map.putAssumeCapacity(
                pkg_path,
                IdMapValue{
                    .old_json_index = @truncate(i),
                    .new_package_id = package_id_is_link,
                },
            );
            continue;
        }
        if (pkg.get("inBundle")) |x| if (x.data == .e_boolean and x.data.e_boolean.value) {
            id_map.putAssumeCapacity(
                pkg_path,
                IdMapValue{
                    .old_json_index = @truncate(i),
                    .new_package_id = package_id_is_bundled,
                },
            );
            continue;
        };

        id_map.putAssumeCapacity(
            pkg_path,
            IdMapValue{
                .old_json_index = @truncate(i),
                .new_package_id = package_idx,
            },
        );
        package_idx += 1;

        const pkg_name = if (entry.value.?.get("name")) |set_name|
            (set_name.asString(this.allocator) orelse return error.InvalidNPMLockfile)
        else
            packageNameFromPath(pkg_path);

        inline for (dependency_keys) |dep_key| {
            if (pkg.get(@tagName(dep_key))) |deps| {
                if (deps.data != .e_object) {
                    return error.InvalidNPMLockfile;
                }
                num_deps +|= @as(u32, deps.data.e_object.properties.len);

                for (deps.data.e_object.properties.slice()) |dep| {
                    const dep_name = dep.key.?.asString(allocator).?;
                    const version_string = dep.value.?.asString(allocator) orelse return error.InvalidNPMLockfile;

                    builder.count(dep_name);
                    builder.count(version_string);

                    // If it's a folder or workspace, pessimistically assume we will need a maximum path
                    switch (Dependency.Version.Tag.infer(version_string)) {
                        .folder, .workspace => builder.cap += bun.MAX_PATH_BYTES,
                        else => {},
                    }
                }
            }
        }

        if (pkg.get("bin")) |bin| {
            if (bin.data != .e_object) return error.InvalidNPMLockfile;
            switch (bin.data.e_object.properties.len) {
                0 => return error.InvalidNPMLockfile,
                1 => {
                    const first_bin = bin.data.e_object.properties.at(0);
                    const key = first_bin.key.?.asString(allocator).?;
                    if (!strings.eql(key, pkg_name)) {
                        builder.count(key);
                    }
                    builder.count(first_bin.value.?.asString(allocator) orelse return error.InvalidNPMLockfile);
                },
                else => {
                    for (bin.data.e_object.properties.slice()) |bin_entry| {
                        builder.count(bin_entry.key.?.asString(allocator).?);
                        builder.count(bin_entry.value.?.asString(allocator) orelse return error.InvalidNPMLockfile);
                    }
                    num_extern_strings += @truncate(bin.data.e_object.properties.len * 2);
                },
            }
        }

        if (pkg.get("resolved")) |resolved_expr| {
            const resolved = resolved_expr.asString(allocator) orelse return error.InvalidNPMLockfile;
            if (strings.hasPrefixComptime(resolved, "file:")) {
                builder.count(resolved[5..]);
            } else if (strings.hasPrefixComptime(resolved, "git+")) {
                builder.count(resolved[4..]);
            } else {
                builder.count(resolved);

                // this is over-counting but whatever. it would be too hard to determine if the case here
                // is an `npm`/`dist_tag` version (the only times this is actually used)
                if (pkg.get("version")) |v| if (v.asString(allocator)) |s| {
                    builder.count(s);
                };
            }
        }
    }
    if (num_deps == std.math.maxInt(u32)) return error.InvalidNPMLockfile; // lol

    debug("counted {d} dependencies", .{num_deps});
    debug("counted {d} extern strings", .{num_extern_strings});
    debug("counted {d} packages", .{package_idx});

    try this.buffers.dependencies.ensureTotalCapacity(allocator, num_deps);
    try this.buffers.resolutions.ensureTotalCapacity(allocator, num_deps);
    try this.buffers.extern_strings.ensureTotalCapacity(allocator, num_extern_strings);
    try this.packages.ensureTotalCapacity(allocator, package_idx);
    // The package index is overallocated, but we know the upper bound
    try this.package_index.ensureTotalCapacity(package_idx);
    try builder.allocate();

    // Package Building Phase
    // This initializes every package and sets the resolution to uninitialized
    for (packages_properties.slice()) |entry| {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        const pkg = entry.value.?.data.e_object;

        if (pkg.get("link") != null or if (pkg.get("inBundle")) |x| x.data == .e_boolean and x.data.e_boolean.value else false) continue;

        const pkg_path = entry.key.?.asString(allocator).?;

        const pkg_name = if (pkg.get("name")) |set_name|
            (set_name.asString(this.allocator) orelse unreachable)
        else
            packageNameFromPath(pkg_path);

        const name_hash = stringHash(pkg_name);

        const package_id: Install.PackageID = @intCast(this.packages.len);
        if (Environment.allow_assert) {
            // If this is false, then it means we wrote wrong resolved ids
            // During counting phase we assign all the packages an id.
            std.debug.assert(package_id == id_map.get(pkg_path).?.new_package_id);
        }

        const is_workspace = workspace_map != null and workspace_map.?.map.getIndex(pkg_path) != null;

        // Instead of calling this.appendPackage, manually append
        // the other function has some checks that will fail since we have not set resolution+dependencies yet.
        this.packages.appendAssumeCapacity(Lockfile.Package{
            .name = builder.appendWithHash(String, pkg_name, name_hash),
            .name_hash = name_hash,

            // For non workspace packages these are set to .uninitialized, then in the third phase
            // they are resolved. This is because the resolution uses the dependant's version
            // specifier as a "hint" to resolve the dependency.
            .resolution = if (is_workspace) Resolution.init(.{
                // This string is counted by `processWorkspaceNamesArray`
                .workspace = builder.append(String, pkg_path),
            }) else Resolution{},

            // we fill this data in later
            .dependencies = undefined,
            .resolutions = undefined,

            .meta = .{
                .id = package_id,

                .origin = if (is_workspace) .local else .npm,

                .arch = if (pkg.get("cpu")) |cpu_array| arch: {
                    if (cpu_array.data != .e_array) return error.InvalidNPMLockfile;
                    var arch: Npm.Architecture = .none;
                    for (cpu_array.data.e_array.items.slice()) |item| {
                        if (item.data != .e_string) return error.InvalidNPMLockfile;
                        arch = arch.apply(item.data.e_string.data);
                    }
                    break :arch arch;
                } else .all,

                .os = if (pkg.get("os")) |cpu_array| arch: {
                    if (cpu_array.data != .e_array) return error.InvalidNPMLockfile;
                    var os: Npm.OperatingSystem = .none;
                    for (cpu_array.data.e_array.items.slice()) |item| {
                        if (item.data != .e_string) return error.InvalidNPMLockfile;
                        os = os.apply(item.data.e_string.data);
                    }
                    break :arch os;
                } else .all,

                .man_dir = String{},

                .integrity = if (pkg.get("integrity")) |integrity|
                    try Integrity.parse(
                        integrity.asString(this.allocator) orelse
                            return error.InvalidNPMLockfile,
                    )
                else
                    Integrity{},
            },
            .bin = if (pkg.get("bin")) |bin| bin: {
                // we already check these conditions during counting
                std.debug.assert(bin.data == .e_object);
                std.debug.assert(bin.data.e_object.properties.len > 0);

                // in npm lockfile, the bin is always an object, even if it is only a single one
                // we need to detect if it's a single entry and lower it to a file.
                if (bin.data.e_object.properties.len == 1) {
                    const prop = bin.data.e_object.properties.at(0);
                    const key = prop.key.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                    const script_value = prop.value.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;

                    if (strings.eql(key, pkg_name)) {
                        break :bin .{
                            .tag = .file,
                            .value = Bin.Value.init(.{
                                .file = builder.append(String, script_value),
                            }),
                        };
                    }

                    break :bin .{
                        .tag = .named_file,
                        .value = Bin.Value.init(.{
                            .named_file = .{
                                builder.append(String, key),
                                builder.append(String, script_value),
                            },
                        }),
                    };
                }

                const view: Install.ExternalStringList = .{
                    .off = @truncate(this.buffers.extern_strings.items.len),
                    .len = @intCast(bin.data.e_object.properties.len * 2),
                };

                for (bin.data.e_object.properties.slice()) |bin_entry| {
                    const key = bin_entry.key.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                    const script_value = bin_entry.value.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                    this.buffers.extern_strings.appendAssumeCapacity(builder.append(ExternalString, key));
                    this.buffers.extern_strings.appendAssumeCapacity(builder.append(ExternalString, script_value));
                }

                if (Environment.allow_assert) {
                    std.debug.assert(this.buffers.extern_strings.items.len == view.off + view.len);
                    std.debug.assert(this.buffers.extern_strings.items.len <= this.buffers.extern_strings.capacity);
                }

                break :bin .{
                    .tag = .map,
                    .value = Bin.Value.init(.{
                        .map = view,
                    }),
                };
            } else Bin{},

            .scripts = .{},
        });
        try this.getOrPutID(package_id, name_hash);
    }

    if (Environment.allow_assert) {
        std.debug.assert(this.packages.len == package_idx);
    }

    // ignoring length check because we pre-allocated it. the length may shrink later
    // so it's faster if we ignore the underlying length buffer and just assign it at the very end.
    var dependencies_buf = this.buffers.dependencies.items.ptr[0..num_deps];
    var resolutions_buf = this.buffers.resolutions.items.ptr[0..num_deps];

    // pre-initialize the dependencies and resolutions to `unset_package_id`
    if (Environment.allow_assert) {
        @memset(dependencies_buf, Dependency{});
        @memset(resolutions_buf, unset_package_id);
    }

    var resolutions = this.packages.items(.resolution);
    var metas = this.packages.items(.meta);
    var dependencies_list = this.packages.items(.dependencies);
    var resolution_list = this.packages.items(.resolutions);

    if (Environment.allow_assert) {
        for (resolutions) |r| {
            std.debug.assert(r.tag == .uninitialized or r.tag == .workspace);
        }
    }

    // Root resolution isn't hit through dependency tracing.
    resolutions[0] = Resolution.init(.{ .root = {} });
    metas[0].origin = .local;

    // made it longer than max path just in case something stupid happens
    var name_checking_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;

    // Dependency Linking Phase
    package_idx = 0;
    for (packages_properties.slice()) |entry| {
        // this pass is allowed to make more assumptions because we already checked things during
        // the counting pass
        const pkg = entry.value.?.data.e_object;

        if (pkg.get("link") != null or if (pkg.get("inBundle")) |x| x.data == .e_boolean and x.data.e_boolean.value else false) continue;

        const pkg_path = entry.key.?.asString(allocator).?;

        const dependencies_start = dependencies_buf.ptr;
        const resolutions_start = resolutions_buf.ptr;

        // this is in a defer because there are two places we end this loop iteration at.
        defer {
            if (dependencies_start == dependencies_buf.ptr) {
                dependencies_list[package_idx] = .{ .len = 0 };
                resolution_list[package_idx] = .{ .len = 0 };
            } else {
                // Calculate the offset + length by pointer arithmetic
                const len: u32 = @truncate((@intFromPtr(resolutions_buf.ptr) - @intFromPtr(resolutions_start)) / @sizeOf(Install.PackageID));
                if (Environment.allow_assert) {
                    std.debug.assert(len > 0);
                    std.debug.assert(len == ((@intFromPtr(dependencies_buf.ptr) - @intFromPtr(dependencies_start)) / @sizeOf(Dependency)));
                }
                dependencies_list[package_idx] = .{
                    .off = @truncate((@intFromPtr(dependencies_start) - @intFromPtr(this.buffers.dependencies.items.ptr)) / @sizeOf(Dependency)),
                    .len = len,
                };
                resolution_list[package_idx] = .{
                    .off = @truncate((@intFromPtr(resolutions_start) - @intFromPtr(this.buffers.resolutions.items.ptr)) / @sizeOf(Install.PackageID)),
                    .len = len,
                };
            }

            package_idx += 1;
        }

        // a feature no one has heard about: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bundledependencies
        const bundled_dependencies = if (pkg.get("bundleDependencies") orelse pkg.get("bundledDependencies")) |expr| deps: {
            if (expr.data == .e_boolean) {
                if (expr.data.e_boolean.value) continue;
                break :deps null;
            }
            if (expr.data != .e_array) return error.InvalidNPMLockfile;
            const arr: *E.Array = expr.data.e_array;
            var map = std.StringArrayHashMapUnmanaged(void){};
            try map.ensureTotalCapacity(allocator, arr.items.len);
            for (arr.items.slice()) |item| {
                map.putAssumeCapacity(item.asString(allocator) orelse return error.InvalidNPMLockfile, {});
            }
            break :deps map;
        } else null;

        inline for (dependency_keys) |dep_key| {
            if (pkg.get(@tagName(dep_key))) |deps| {
                // fetch the peerDependenciesMeta if it exists
                // this is only done for peerDependencies, obviously
                const peer_dep_meta = if (dep_key == .peerDependencies)
                    if (pkg.get("peerDependenciesMeta")) |expr| peer_dep_meta: {
                        if (expr.data != .e_object) return error.InvalidNPMLockfile;
                        break :peer_dep_meta expr.data.e_object;
                    } else null
                else
                    void{};

                if (deps.data != .e_object) return error.InvalidNPMLockfile;
                const properties = deps.data.e_object.properties;

                dep_loop: for (properties.slice(), 0..) |prop, i| {
                    _ = i;
                    const name_bytes = prop.key.?.asString(this.allocator).?;
                    if (bundled_dependencies != null and bundled_dependencies.?.getIndex(name_bytes) != null) continue :dep_loop;

                    const version_bytes = prop.value.?.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                    const name_hash = stringHash(name_bytes);
                    const dep_name = builder.appendWithHash(String, name_bytes, name_hash);

                    const dep_version = builder.append(String, version_bytes);
                    const sliced = dep_version.sliced(this.buffers.string_bytes.items);

                    debug("parsing {s}, {s}\n", .{ name_bytes, version_bytes });
                    const version = Dependency.parse(
                        this.allocator,
                        String.init(name_bytes, name_bytes),
                        sliced.slice,
                        &sliced,
                        log,
                    ) orelse {
                        return error.InvalidNPMLockfile;
                    };
                    debug("-> {s}, {}\n", .{ @tagName(version.tag), version.value });

                    if (Environment.allow_assert) {
                        std.debug.assert(version.tag != .uninitialized);
                    }

                    const str_node_modules = if (pkg_path.len == 0) "node_modules/" else "/node_modules/";
                    const suffix_len = str_node_modules.len + name_bytes.len;

                    var buf_len: u32 = @as(u32, @intCast(pkg_path.len + suffix_len));
                    if (buf_len > name_checking_buf.len) {
                        return error.PathTooLong;
                    }

                    bun.copy(u8, name_checking_buf[0..pkg_path.len], pkg_path);
                    bun.copy(u8, name_checking_buf[pkg_path.len .. pkg_path.len + str_node_modules.len], str_node_modules);
                    bun.copy(u8, name_checking_buf[pkg_path.len + str_node_modules.len .. pkg_path.len + suffix_len], name_bytes);

                    while (true) {
                        debug("checking {s}", .{name_checking_buf[0..buf_len]});
                        if (id_map.get(name_checking_buf[0..buf_len])) |found_| {
                            var found = found_;
                            if (found.new_package_id == package_id_is_link) {
                                // it is a workspace package, resolve from the "link": true entry to the real entry.
                                const ref_pkg = packages_properties.at(found.old_json_index).value.?.data.e_object;
                                const resolved_v = ref_pkg.get("resolved") orelse return error.LockfileWorkspaceMissingResolved;
                                const resolved = resolved_v.asString(this.allocator) orelse return error.InvalidNPMLockfile;
                                found = (id_map.get(resolved) orelse return error.InvalidNPMLockfile);
                            } else if (found.new_package_id == package_id_is_bundled) {
                                debug("skipping bundled dependency {s}", .{name_bytes});
                                continue :dep_loop;
                            }
                            var is_workspace = workspace_map != null and workspace_map.?.map.getIndex(
                                packages_properties.at(found.old_json_index).key.?.asString(allocator).?,
                            ) != null;

                            const id = found.new_package_id;

                            debug("yolo {d}\n", .{@intFromPtr(dependencies_buf.ptr)});
                            dependencies_buf[0] = Dependency{
                                .name = dep_name,
                                .name_hash = name_hash,
                                .version = version,
                                .behavior = .{
                                    .normal = dep_key == .dependencies,
                                    .optional = dep_key == .optionalDependencies,
                                    .dev = dep_key == .devDependencies,
                                    .peer = dep_key == .peerDependencies,
                                    .workspace = is_workspace,
                                },
                            };
                            resolutions_buf[0] = id;

                            dependencies_buf = dependencies_buf[1..];
                            resolutions_buf = resolutions_buf[1..];

                            // If the package resolution is not set, resolve the target package
                            // using the information we have from the dependency declaration.
                            if (resolutions[id].tag == .uninitialized) {
                                debug("resolving '{s}'", .{name_bytes});

                                const dep_pkg = packages_properties.at(found.old_json_index).value.?.data.e_object;
                                const dep_resolved = (dep_pkg.get("resolved") orelse return error.LockfileWorkspaceMissingResolved).asString(this.allocator) orelse return error.InvalidNPMLockfile;

                                const res = switch (version.tag) {
                                    .uninitialized => std.debug.panic("Version string {s} resolved to `.uninitialized`", .{version_bytes}),
                                    .npm, .dist_tag => res: {
                                        const dep_actual_version = (dep_pkg.get("version") orelse return error.InvalidNPMLockfile)
                                            .asString(this.allocator) orelse return error.InvalidNPMLockfile;

                                        const dep_actual_version_str = builder.append(String, dep_actual_version);
                                        const dep_actual_version_sliced = dep_actual_version_str.sliced(this.buffers.string_bytes.items);

                                        break :res Resolution.init(.{
                                            .npm = .{
                                                .url = builder.append(String, dep_resolved),
                                                .version = Semver.Version.parse(dep_actual_version_sliced).version.fill(),
                                            },
                                        });
                                    },
                                    .tarball => if (strings.hasPrefixComptime(dep_resolved, "file:"))
                                        Resolution.init(.{ .local_tarball = builder.append(String, dep_resolved[5..]) })
                                    else
                                        Resolution.init(.{ .remote_tarball = builder.append(String, dep_resolved) }),
                                    .folder => Resolution.init(.{ .folder = builder.append(String, dep_resolved) }),
                                    // not sure if this is possible to hit
                                    .symlink => Resolution.init(.{ .folder = builder.append(String, dep_resolved) }),
                                    .workspace => workspace: {
                                        var input = builder.append(String, dep_resolved).sliced(this.buffers.string_bytes.items);
                                        if (strings.hasPrefixComptime(input.slice, "workspace:")) {
                                            input = input.sub(input.slice["workspace:".len..]);
                                        }
                                        break :workspace Resolution.init(.{
                                            .workspace = input.value(),
                                        });
                                    },
                                    .git, .github => res: {
                                        const str = (if (strings.hasPrefixComptime(dep_resolved, "git+"))
                                            builder.append(String, dep_resolved[4..])
                                        else
                                            builder.append(String, dep_resolved))
                                            .sliced(this.buffers.string_bytes.items);

                                        const hash_index = strings.lastIndexOfChar(str.slice, '#') orelse return error.InvalidNPMLockfile;

                                        const commit = str.sub(str.slice[hash_index + 1 ..]).value();
                                        break :res Resolution.init(.{
                                            .git = .{
                                                .owner = .{},
                                                .repo = str.sub(str.slice[0..hash_index]).value(),
                                                .committish = commit,
                                                .resolved = commit,
                                                .package_name = dep_name,
                                            },
                                        });
                                    },
                                };
                                debug("-> {}", .{res.fmtForDebug(this.buffers.string_bytes.items)});

                                resolutions[id] = res;
                                metas[id].origin = switch (res.tag) {
                                    // TODO: What is origin actually used for, it doesnt seem to be used anywhere
                                    // .npm => .npm,
                                    // .root, .folder, .local_tarball, .symlink, .workspace => .local,
                                    // .remote_tarball, .git, .github, .gitlab, .single_file_module => .tarball,
                                    // else => if (Environment.allow_assert) unreachable else .local,

                                    // This works?
                                    .root => .local,
                                    else => .npm,
                                };
                            }

                            continue :dep_loop;
                        }
                        // step
                        if (strings.lastIndexOf(name_checking_buf[0..buf_len -| ("node_modules/".len + name_bytes.len)], "node_modules/")) |idx| {
                            debug("found 'node_modules/' at {d}", .{idx});
                            buf_len = @intCast(idx + "node_modules/".len + name_bytes.len);
                            bun.copy(u8, name_checking_buf[idx + "node_modules/".len .. idx + "node_modules/".len + name_bytes.len], name_bytes);
                        } else if (!strings.hasPrefixComptime(name_checking_buf[0..buf_len], "node_modules/")) {
                            // this is hit if you start from `packages/etc`, from `packages/etc/node_modules/xyz`
                            // we need to hit the root node_modules
                            buf_len = @intCast("node_modules/".len + name_bytes.len);
                            bun.copy(u8, name_checking_buf[0..buf_len], "node_modules/");
                            bun.copy(u8, name_checking_buf[buf_len - name_bytes.len .. buf_len], name_bytes);
                        } else {
                            // optional peer dependencies can be ... optional
                            if (dep_key == .peerDependencies) {
                                if (peer_dep_meta) |o| if (o.get(name_bytes)) |meta| {
                                    if (meta.data != .e_object) return error.InvalidNPMLockfile;
                                    if (meta.data.e_object.get("optional")) |optional| {
                                        if (optional.data != .e_boolean) return error.InvalidNPMLockfile;
                                        if (optional.data.e_boolean.value) {
                                            dependencies_buf[0] = Dependency{
                                                .name = dep_name,
                                                .name_hash = name_hash,
                                                .version = version,
                                                .behavior = .{
                                                    .normal = dep_key == .dependencies,
                                                    .optional = true,
                                                    .dev = dep_key == .devDependencies,
                                                    .peer = dep_key == .peerDependencies,
                                                    .workspace = false,
                                                },
                                            };
                                            resolutions_buf[0] = Install.invalid_package_id;
                                            dependencies_buf = dependencies_buf[1..];
                                            resolutions_buf = resolutions_buf[1..];
                                            continue :dep_loop;
                                        }
                                    }
                                };
                            }
                            debug("could not find package '{s}' in '{s}'", .{ name_bytes, pkg_path });
                            // the lockfile is supposed contain everything
                            // despite the name `optionalDependencies`, those also have to be resolved
                            return error.MissingLockfileDependency;
                        }
                    }
                }
            }
        }
    }

    this.buffers.resolutions.items.len = (@intFromPtr(resolutions_buf.ptr) - @intFromPtr(this.buffers.resolutions.items.ptr)) / @sizeOf(Install.PackageID);
    this.buffers.dependencies.items.len = this.buffers.resolutions.items.len;

    // In allow_assert, we prefill this buffer with uninitialized values that we can detect later
    // It is our fault if we hit an error here, making it safe to disable in release.
    if (Environment.allow_assert) {
        std.debug.assert(this.buffers.dependencies.items.len == (@intFromPtr(dependencies_buf.ptr) - @intFromPtr(this.buffers.dependencies.items.ptr)) / @sizeOf(Dependency));
        std.debug.assert(this.buffers.dependencies.items.len <= num_deps);
        var crash = false;
        for (this.buffers.dependencies.items, 0..) |r, i| {
            // 'if behavior is uninitialized'
            if (r.behavior.eq(.{})) {
                debug("dependency index '{d}' was not set", .{i});
                crash = true;
            }
        }
        for (this.buffers.resolutions.items, 0..) |r, i| {
            if (r == unset_package_id) {
                debug("resolution index '{d}' was not set", .{i});
                crash = true;
            }
        }
        if (crash) {
            std.debug.panic("Assertion failure, see above", .{});
        }
    }

    // A package not having a resolution, however, is not our fault.
    // This can be triggered by a bad lockfile.
    var had_failures = false;
    for (resolutions, 0..) |r, i| {
        if (r.tag == .uninitialized) {
            Output.printErrorln("could not resolve package '{s}' in lockfile.", .{this.packages.items(.name)[i].slice(this.buffers.string_bytes.items)});
            had_failures = true;
        }
    }
    if (had_failures) {
        return error.NotAllPackagesGotResolved;
    }

    this.format = .migrated;

    if (Environment.allow_assert) {
        try this.verifyData();
    }

    return LoadFromDiskResult{ .ok = this };
}

fn packageNameFromPath(pkg_path: []const u8) []const u8 {
    if (pkg_path.len == 0) return "";

    const pkg_name_start: usize = if (strings.lastIndexOf(pkg_path, "/node_modules/")) |last_index|
        last_index + "/node_modules/".len
    else if (strings.hasPrefixComptime(pkg_path, "node_modules/"))
        "node_modules/".len
    else
        return "";

    return pkg_path[pkg_name_start..];
}
