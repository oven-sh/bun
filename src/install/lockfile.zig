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
const default_allocator = bun.default_allocator;
const C = bun.C;
const JSAst = bun.JSAst;

const JSLexer = bun.js_lexer;
const logger = bun.logger;

const js_parser = bun.js_parser;
const Expr = @import("../js_ast.zig").Expr;
const json_parser = bun.JSON;
const JSPrinter = bun.js_printer;

const linker = @import("../linker.zig");
const migration = @import("./migration.zig");

const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const Path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const BunArguments = @import("../cli.zig").Arguments;
const bundler = bun.bundler;

const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
const HeaderBuilder = bun.http.HeaderBuilder;
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const Lock = @import("../lock.zig").Lock;
const URL = @import("../url.zig").URL;
const AsyncHTTP = bun.http.AsyncHTTP;
const HTTPChannel = bun.http.HTTPChannel;

const Integrity = @import("./integrity.zig").Integrity;
const clap = bun.clap;
const ExtractTarball = @import("./extract_tarball.zig");
const Npm = @import("./npm.zig");
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const z_allocator = @import("../memory_allocator.zig").z_allocator;
const Lockfile = @This();

const IdentityContext = @import("../identity_context.zig").IdentityContext;
const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const GlobalStringBuilder = @import("../string_builder.zig");
const SlicedString = Semver.SlicedString;
const Repository = @import("./repository.zig").Repository;
const Bin = @import("./bin.zig").Bin;
const Dependency = @import("./dependency.zig");
const Behavior = Dependency.Behavior;
const FolderResolution = @import("./resolvers/folder_resolver.zig").FolderResolution;
const Install = @import("./install.zig");
const Aligner = Install.Aligner;
const alignment_bytes_to_repeat_buffer = Install.alignment_bytes_to_repeat_buffer;
const PackageManager = Install.PackageManager;
const DependencyID = Install.DependencyID;
const ExternalSlice = Install.ExternalSlice;
const ExternalSliceAligned = Install.ExternalSliceAligned;
const ExternalStringList = Install.ExternalStringList;
const ExternalStringMap = Install.ExternalStringMap;
const Features = Install.Features;
const initializeStore = Install.initializeStore;
const invalid_package_id = Install.invalid_package_id;
const Origin = Install.Origin;
const PackageID = Install.PackageID;
const PackageInstall = Install.PackageInstall;
const PackageNameHash = Install.PackageNameHash;
const Resolution = @import("./resolution.zig").Resolution;
const Crypto = @import("../sha.zig").Hashers;
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const StaticHashMap = @import("../StaticHashMap.zig").StaticHashMap;

const MetaHash = [std.crypto.hash.sha2.Sha512256.digest_length]u8;
const zero_hash = std.mem.zeroes(MetaHash);
pub const NameHashMap = std.ArrayHashMapUnmanaged(PackageNameHash, String, ArrayIdentityContext.U64, false);
pub const NameHashSet = std.ArrayHashMapUnmanaged(u32, void, ArrayIdentityContext, false);
pub const VersionHashMap = std.ArrayHashMapUnmanaged(PackageNameHash, Semver.Version, ArrayIdentityContext.U64, false);

const assertNoUninitializedPadding = @import("./padding_checker.zig").assertNoUninitializedPadding;

// Serialized data
/// The version of the lockfile format, intended to prevent data corruption for format changes.
format: FormatVersion = FormatVersion.current,

meta_hash: MetaHash = zero_hash,

packages: Lockfile.Package.List = .{},
buffers: Buffers = .{},

/// name -> PackageID || [*]PackageID
/// Not for iterating.
package_index: PackageIndex.Map,
string_pool: StringPool,
allocator: Allocator,
scratch: Scratch = .{},

scripts: Scripts = .{},
workspace_paths: NameHashMap = .{},
workspace_versions: VersionHashMap = .{},

trusted_dependencies: NameHashSet = .{},
overrides: OverrideMap = .{},

const Stream = std.io.FixedBufferStream([]u8);
pub const default_filename = "bun.lockb";

pub fn hasTrustedDependencies(this: *const Lockfile) bool {
    return this.trusted_dependencies.count() > 0;
}

pub const Scripts = struct {
    const MAX_PARALLEL_PROCESSES = 10;
    pub const Entry = struct {
        cwd: string,
        script: string,
        package_name: string,
    };
    pub const Entries = std.ArrayListUnmanaged(Entry);

    pub const names = [_]string{
        "preinstall",
        "install",
        "postinstall",
        "preprepare",
        "prepare",
        "postprepare",
    };

    const RunCommand = @import("../cli/run_command.zig").RunCommand;

    preinstall: Entries = .{},
    install: Entries = .{},
    postinstall: Entries = .{},
    preprepare: Entries = .{},
    prepare: Entries = .{},
    postprepare: Entries = .{},

    pub fn hasAny(this: *Scripts) bool {
        inline for (Scripts.names) |hook| {
            if (@field(this, hook).items.len > 0) return true;
        }
        return false;
    }

    pub fn count(this: *Scripts) usize {
        var res: usize = 0;
        inline for (Scripts.names) |hook| {
            res += @field(this, hook).items.len;
        }
        return res;
    }

    pub fn deinit(this: *Scripts, allocator: Allocator) void {
        inline for (Scripts.names) |hook| {
            const list = &@field(this, hook);
            for (list.items) |entry| {
                allocator.free(entry.cwd);
                allocator.free(entry.script);
            }
            list.deinit(allocator);
        }
    }
};

pub fn isEmpty(this: *const Lockfile) bool {
    return this.packages.len == 0 or this.packages.len == 1 or this.packages.get(0).resolutions.len == 0;
}

pub const LoadFromDiskResult = union(enum) {
    not_found: void,
    err: struct {
        step: Step,
        value: anyerror,
    },
    ok: struct {
        lockfile: *Lockfile,
        was_migrated: bool = false,
    },

    pub const Step = enum { open_file, read_file, parse_file, migrating };
};

pub fn loadFromDisk(this: *Lockfile, allocator: Allocator, log: *logger.Log, filename: stringZ) LoadFromDiskResult {
    if (comptime Environment.allow_assert) std.debug.assert(FileSystem.instance_loaded);

    var file = if (filename.len > 0)
        std.fs.cwd().openFileZ(filename, .{ .mode = .read_only }) catch |err| {
            return switch (err) {
                error.FileNotFound => {
                    // Attempt to load from "package-lock.json", "yarn.lock", etc.
                    return migration.detectAndLoadOtherLockfile(
                        this,
                        allocator,
                        log,
                        filename,
                    );
                },
                error.AccessDenied, error.BadPathName => LoadFromDiskResult{ .not_found = {} },
                else => LoadFromDiskResult{ .err = .{ .step = .open_file, .value = err } },
            };
        }
    else
        std.io.getStdIn();

    defer file.close();
    const buf = file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch |err| {
        return LoadFromDiskResult{ .err = .{ .step = .read_file, .value = err } };
    };

    return this.loadFromBytes(buf, allocator, log);
}

pub fn loadFromBytes(this: *Lockfile, buf: []u8, allocator: Allocator, log: *logger.Log) LoadFromDiskResult {
    var stream = Stream{ .buffer = buf, .pos = 0 };

    this.format = FormatVersion.current;
    this.scripts = .{};
    this.trusted_dependencies = .{};
    this.workspace_paths = .{};
    this.workspace_versions = .{};
    this.overrides = .{};

    Lockfile.Serializer.load(this, &stream, allocator, log) catch |err| {
        return LoadFromDiskResult{ .err = .{ .step = .parse_file, .value = err } };
    };

    if (Environment.allow_assert) {
        this.verifyData() catch @panic("lockfile data is corrupt");
    }

    return LoadFromDiskResult{ .ok = .{ .lockfile = this } };
}

pub const InstallResult = struct {
    lockfile: *Lockfile,
    summary: PackageInstall.Summary,
};

pub const Tree = struct {
    id: Id = invalid_id,
    dependency_id: DependencyID = invalid_package_id,
    parent: Id = invalid_id,
    dependencies: Lockfile.DependencyIDSlice = .{},

    pub const external_size = @sizeOf(Id) + @sizeOf(PackageID) + @sizeOf(Id) + @sizeOf(Lockfile.DependencyIDSlice);
    pub const External = [external_size]u8;
    pub const Slice = ExternalSlice(Tree);
    pub const List = std.ArrayListUnmanaged(Tree);
    pub const Id = u32;

    pub fn toExternal(this: Tree) External {
        var out = External{};
        out[0..4].* = @as(Id, @bitCast(this.id));
        out[4..8].* = @as(Id, @bitCast(this.dependency_id));
        out[8..12].* = @as(Id, @bitCast(this.parent));
        out[12..16].* = @as(u32, @bitCast(this.dependencies.off));
        out[16..20].* = @as(u32, @bitCast(this.dependencies.len));
        if (out.len != 20) @compileError("Tree.External is not 20 bytes");
        return out;
    }

    pub fn toTree(out: External) Tree {
        return .{
            .id = @as(Id, @bitCast(out[0..4].*)),
            .dependency_id = @as(Id, @bitCast(out[4..8].*)),
            .parent = @as(Id, @bitCast(out[8..12].*)),
            .dependencies = .{
                .off = @as(u32, @bitCast(out[12..16].*)),
                .len = @as(u32, @bitCast(out[16..20].*)),
            },
        };
    }

    pub const root_dep_id: DependencyID = invalid_package_id - 1;
    pub const invalid_id: Id = std.math.maxInt(Id);
    const dependency_loop = invalid_id - 1;
    const hoisted = invalid_id - 2;
    const error_id = hoisted;

    const SubtreeError = error{ OutOfMemory, DependencyLoop };

    pub const NodeModulesFolder = struct {
        relative_path: stringZ,
        dependencies: []const DependencyID,
        tree_id: Tree.Id,
    };

    pub const Iterator = struct {
        trees: []const Tree,
        dependency_ids: []const DependencyID,
        dependencies: []const Dependency,
        resolutions: []const PackageID,
        tree_id: Id,
        path_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
        path_buf_len: usize = 0,
        last_parent: Id = invalid_id,
        string_buf: string,

        // max number of node_modules folders
        depth_stack: [(bun.MAX_PATH_BYTES / "node_modules".len) + 1]Id = undefined,

        pub fn init(lockfile: *const Lockfile) Iterator {
            return .{
                .trees = lockfile.buffers.trees.items,
                .tree_id = 0,
                .dependency_ids = lockfile.buffers.hoisted_dependencies.items,
                .dependencies = lockfile.buffers.dependencies.items,
                .resolutions = lockfile.buffers.resolutions.items,
                .string_buf = lockfile.buffers.string_bytes.items,
            };
        }

        pub fn reload(this: *Iterator, lockfile: *const Lockfile) void {
            this.trees = lockfile.buffers.trees.items;
            this.dependency_ids = lockfile.buffers.hoisted_dependencies.items;
            this.dependencies = lockfile.buffers.dependencies.items;
            this.resolutions = lockfile.buffers.resolutions.items;
            this.string_buf = lockfile.buffers.string_bytes.items;
        }

        pub fn nextNodeModulesFolder(this: *Iterator, completed_trees: ?*Bitset) ?NodeModulesFolder {
            if (this.tree_id >= this.trees.len) return null;

            while (this.trees[this.tree_id].dependencies.len == 0) {
                if (completed_trees) |_completed_trees| {
                    _completed_trees.set(this.tree_id);
                }
                this.tree_id += 1;
                if (this.tree_id >= this.trees.len) return null;
            }

            const tree = this.trees[this.tree_id];
            const string_buf = this.string_buf;

            {

                // For now, the dumb way
                // (the smart way is avoiding this copy)
                this.path_buf[0.."node_modules".len].* = "node_modules".*;
                var parent_id = tree.id;
                var path_written: usize = "node_modules".len;
                this.depth_stack[0] = 0;

                if (tree.id > 0) {
                    var depth_buf_len: usize = 1;
                    while (parent_id > 0 and parent_id < @as(Id, @intCast(this.trees.len))) {
                        this.depth_stack[depth_buf_len] = parent_id;
                        parent_id = this.trees[parent_id].parent;
                        depth_buf_len += 1;
                    }
                    depth_buf_len -= 1;
                    while (depth_buf_len > 0) : (depth_buf_len -= 1) {
                        this.path_buf[path_written] = std.fs.path.sep;
                        path_written += 1;

                        const tree_id = this.depth_stack[depth_buf_len];
                        const name = this.dependencies[this.trees[tree_id].dependency_id].name.slice(string_buf);
                        bun.copy(u8, this.path_buf[path_written..], name);
                        path_written += name.len;

                        this.path_buf[path_written..][0.."/node_modules".len].* = (std.fs.path.sep_str ++ "node_modules").*;
                        path_written += "/node_modules".len;
                    }
                }
                this.path_buf[path_written] = 0;
                this.path_buf_len = path_written;
            }

            this.tree_id += 1;
            const relative_path: [:0]u8 = this.path_buf[0..this.path_buf_len :0];
            return .{
                .relative_path = relative_path,
                .dependencies = tree.dependencies.get(this.dependency_ids),
                .tree_id = tree.id,
            };
        }
    };

    const Builder = struct {
        allocator: Allocator,
        name_hashes: []const PackageNameHash,
        list: ArrayList = .{},
        resolutions: []const PackageID,
        dependencies: []const Dependency,
        resolution_lists: []const Lockfile.DependencyIDSlice,
        queue: Lockfile.TreeFiller,
        log: *logger.Log,
        old_lockfile: *Lockfile,

        pub fn maybeReportError(this: *Builder, comptime fmt: string, args: anytype) void {
            this.log.addErrorFmt(null, logger.Loc.Empty, this.allocator, fmt, args) catch {};
        }

        pub fn buf(this: *const Builder) []const u8 {
            return this.old_lockfile.buffers.string_bytes.items;
        }

        pub fn packageName(this: *Builder, id: PackageID) String.Formatter {
            return this.old_lockfile.packages.items(.name)[id].fmt(this.old_lockfile.buffers.string_bytes.items);
        }

        pub fn packageVersion(this: *Builder, id: PackageID) Resolution.Formatter {
            return this.old_lockfile.packages.items(.resolution)[id].fmt(this.old_lockfile.buffers.string_bytes.items);
        }

        pub const Entry = struct {
            tree: Tree,
            dependencies: Lockfile.DependencyIDList,
        };

        pub const ArrayList = bun.MultiArrayList(Entry);

        /// Flatten the multi-dimensional ArrayList of package IDs into a single easily serializable array
        pub fn clean(this: *Builder) !DependencyIDList {
            const end = @as(Id, @truncate(this.list.len));
            var i: Id = 0;
            var total: u32 = 0;
            const trees = this.list.items(.tree);
            const dependencies = this.list.items(.dependencies);

            while (i < end) : (i += 1) {
                total += trees[i].dependencies.len;
            }

            var dependency_ids = try DependencyIDList.initCapacity(z_allocator, total);
            var next = PackageIDSlice{};

            for (trees, dependencies) |*tree, *child| {
                if (tree.dependencies.len > 0) {
                    const len = @as(PackageID, @truncate(child.items.len));
                    next.off += next.len;
                    next.len = len;
                    tree.dependencies = next;
                    dependency_ids.appendSliceAssumeCapacity(child.items);
                    child.deinit(this.allocator);
                }
            }
            this.queue.deinit();

            return dependency_ids;
        }
    };

    pub fn processSubtree(
        this: *const Tree,
        dependency_id: DependencyID,
        builder: *Builder,
    ) SubtreeError!void {
        const package_id = switch (dependency_id) {
            root_dep_id => 0,
            else => |id| builder.resolutions[id],
        };
        const resolution_list = builder.resolution_lists[package_id];

        if (resolution_list.len == 0) return;

        try builder.list.append(builder.allocator, .{
            .tree = .{
                .parent = this.id,
                .id = @as(Id, @truncate(builder.list.len)),
                .dependency_id = dependency_id,
            },
            .dependencies = .{},
        });

        const list_slice = builder.list.slice();
        const trees = list_slice.items(.tree);
        const dependency_lists = list_slice.items(.dependencies);
        const next: *Tree = &trees[builder.list.len - 1];
        const name_hashes: []const PackageNameHash = builder.name_hashes;
        const max_package_id = @as(PackageID, @truncate(name_hashes.len));
        var dep_id = resolution_list.off;
        const end = dep_id + resolution_list.len;

        while (dep_id < end) : (dep_id += 1) {
            const pid = builder.resolutions[dep_id];
            // Skip unresolved packages, e.g. "peerDependencies"
            if (pid >= max_package_id) continue;

            const dependency = builder.dependencies[dep_id];
            // Do not hoist aliased packages
            const destination = if (dependency.name_hash != name_hashes[pid])
                next.id
            else
                next.hoistDependency(
                    true,
                    pid,
                    dep_id,
                    &dependency,
                    dependency_lists,
                    trees,
                    builder,
                ) catch |err| return err;
            switch (destination) {
                Tree.dependency_loop, Tree.hoisted => continue,
                else => {
                    dependency_lists[destination].append(builder.allocator, dep_id) catch unreachable;
                    trees[destination].dependencies.len += 1;
                    if (builder.resolution_lists[pid].len > 0) {
                        try builder.queue.writeItem(.{
                            .tree_id = destination,
                            .dependency_id = dep_id,
                        });
                    }
                },
            }
        }

        if (next.dependencies.len == 0) {
            if (comptime Environment.allow_assert) std.debug.assert(builder.list.len == next.id + 1);
            _ = builder.list.pop();
        }
    }

    // This function does one of three things:
    // 1 (return hoisted) - de-duplicate (skip) the package
    // 2 (return id) - move the package to the top directory
    // 3 (return dependency_loop) - leave the package at the same (relative) directory
    fn hoistDependency(
        this: *Tree,
        comptime as_defined: bool,
        package_id: PackageID,
        dependency_id: DependencyID,
        dependency: *const Dependency,
        dependency_lists: []Lockfile.DependencyIDList,
        trees: []Tree,
        builder: *Builder,
    ) !Id {
        const this_dependencies = this.dependencies.get(dependency_lists[this.id].items);
        for (this_dependencies) |dep_id| {
            const dep = builder.dependencies[dep_id];
            if (dep.name_hash != dependency.name_hash) continue;
            if (builder.resolutions[dep_id] != package_id and !dependency.behavior.isPeer()) {
                if (as_defined and !dep.behavior.isPeer()) {
                    builder.maybeReportError("Package \"{}@{}\" has a dependency loop\n  Resolution: \"{}@{}\"\n  Dependency: \"{}@{}\"", .{
                        builder.packageName(package_id),
                        builder.packageVersion(package_id),
                        builder.packageName(builder.resolutions[dep_id]),
                        builder.packageVersion(builder.resolutions[dep_id]),
                        dependency.name.fmt(builder.buf()),
                        dependency.version.literal.fmt(builder.buf()),
                    });
                    return error.DependencyLoop;
                }
                // ignore versioning conflicts caused by peer dependencies
                return dependency_loop; // 3
            }
            return hoisted; // 1
        }

        if (this.parent < error_id) {
            const id = trees[this.parent].hoistDependency(
                false,
                package_id,
                dependency_id,
                dependency,
                dependency_lists,
                trees,
                builder,
            ) catch unreachable;
            if (!as_defined or id != dependency_loop) return id; // 1 or 2
        }

        return this.id; // 2
    }
};

/// This conditonally clones the lockfile with root packages marked as non-resolved
/// that do not satisfy `Features`. The package may still end up installed even
/// if it was e.g. in "devDependencies" and its a production install. In that case,
/// it would be installed because another dependency or transient dependency needed it.
///
/// Warning: This potentially modifies the existing lockfile in-place. That is
/// safe to do because at this stage, the lockfile has already been saved to disk.
/// Our in-memory representation is all that's left.
pub fn maybeCloneFilteringRootPackages(
    old: *Lockfile,
    features: Features,
    exact_versions: bool,
) !*Lockfile {
    const old_root_dependencies_list = old.packages.items(.dependencies)[0];
    var old_root_resolutions = old.packages.items(.resolutions)[0];
    const root_dependencies = old_root_dependencies_list.get(old.buffers.dependencies.items);
    const resolutions = old_root_resolutions.mut(old.buffers.resolutions.items);
    var any_changes = false;
    const end = @as(PackageID, @truncate(old.packages.len));

    for (root_dependencies, resolutions) |dependency, *resolution| {
        if (!dependency.behavior.isEnabled(features) and resolution.* < end) {
            resolution.* = invalid_package_id;
            any_changes = true;
        }
    }

    if (!any_changes) return old;

    return try old.clean(&.{}, exact_versions);
}

fn preprocessUpdateRequests(old: *Lockfile, updates: []PackageManager.UpdateRequest, exact_versions: bool) !void {
    const root_deps_list: Lockfile.DependencySlice = old.packages.items(.dependencies)[0];
    if (@as(usize, root_deps_list.off) < old.buffers.dependencies.items.len) {
        var string_builder = old.stringBuilder();

        {
            const root_deps: []const Dependency = root_deps_list.get(old.buffers.dependencies.items);
            const old_resolutions_list = old.packages.items(.resolutions)[0];
            const old_resolutions: []const PackageID = old_resolutions_list.get(old.buffers.resolutions.items);
            const resolutions_of_yore: []const Resolution = old.packages.items(.resolution);

            for (updates) |update| {
                if (update.version.tag == .uninitialized) {
                    for (root_deps, old_resolutions) |dep, old_resolution| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            const len = switch (exact_versions) {
                                false => std.fmt.count("^{}", .{res.value.npm.fmt(old.buffers.string_bytes.items)}),
                                true => std.fmt.count("{}", .{res.value.npm.fmt(old.buffers.string_bytes.items)}),
                            };
                            if (len >= String.max_inline_len) {
                                string_builder.cap += len;
                            }
                        }
                    }
                }
            }
        }

        try string_builder.allocate();
        defer string_builder.clamp();

        {
            var temp_buf: [513]u8 = undefined;

            const root_deps: []Dependency = root_deps_list.mut(old.buffers.dependencies.items);
            const old_resolutions_list_lists = old.packages.items(.resolutions);
            const old_resolutions_list = old_resolutions_list_lists[0];
            const old_resolutions: []const PackageID = old_resolutions_list.get(old.buffers.resolutions.items);
            const resolutions_of_yore: []const Resolution = old.packages.items(.resolution);

            for (updates) |*update| {
                if (update.version.tag == .uninitialized) {
                    for (root_deps, old_resolutions) |*dep, old_resolution| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            const buf = switch (exact_versions) {
                                false => std.fmt.bufPrint(&temp_buf, "^{}", .{res.value.npm.fmt(old.buffers.string_bytes.items)}) catch break,
                                true => std.fmt.bufPrint(&temp_buf, "{}", .{res.value.npm.fmt(old.buffers.string_bytes.items)}) catch break,
                            };
                            const external_version = string_builder.append(ExternalString, buf);
                            const sliced = external_version.value.sliced(old.buffers.string_bytes.items);
                            dep.version = Dependency.parse(
                                old.allocator,
                                dep.name,
                                dep.name_hash,
                                sliced.slice,
                                &sliced,
                                null,
                            ) orelse Dependency.Version{};
                        }
                    }
                }

                update.e_string = null;
            }
        }
    }
}
pub fn clean(
    old: *Lockfile,
    updates: []PackageManager.UpdateRequest,
    exact_versions: bool,
) !*Lockfile {
    // This is wasteful, but we rarely log anything so it's fine.
    var log = logger.Log.init(bun.default_allocator);
    defer {
        for (log.msgs.items) |*item| {
            item.deinit(bun.default_allocator);
        }
        log.deinit();
    }

    return old.cleanWithLogger(updates, &log, exact_versions);
}

pub fn cleanWithLogger(
    old: *Lockfile,
    updates: []PackageManager.UpdateRequest,
    log: *logger.Log,
    exact_versions: bool,
) !*Lockfile {
    const old_trusted_dependencies = old.trusted_dependencies;
    const old_scripts = old.scripts;
    // We will only shrink the number of packages here.
    // never grow

    if (updates.len > 0) {
        try old.preprocessUpdateRequests(updates, exact_versions);
    }

    // Deduplication works like this
    // Go through *already* resolved package versions
    // Ask, do any of those versions happen to match a lower version?
    // If yes, choose that version instead.
    // Why lower?
    //
    // Normally, the problem looks like this:
    //   Package A: "react@^17"
    //   Package B: "react@17.0.1
    //
    // Now you have two copies of React.
    // When you really only wanted one.
    // Since _typically_ the issue is that Semver ranges with "^" or "~" say "choose latest", we end up with latest
    // if (options.enable.deduplicate_packages) {
    //     var resolutions: []PackageID = old.buffers.resolutions.items;
    //     const dependencies: []const Dependency = old.buffers.dependencies.items;
    //     const package_resolutions: []const Resolution = old.packages.items(.resolution);
    //     const string_buf = old.buffers.string_bytes.items;

    //     const root_resolution = @as(usize, old.packages.items(.resolutions)[0].len);

    //     const DedupeMap = std.ArrayHashMap(PackageNameHash, std.ArrayListUnmanaged([2]PackageID), ArrayIdentityContext(PackageNameHash), false);
    //     var dedupe_map = DedupeMap.initContext(allocator, .{});
    //     try dedupe_map.ensureTotalCapacity(old.unique_packages.count());

    //     for (resolutions) |resolved_package_id, dep_i| {
    //         if (resolved_package_id < max_package_id and !old.unique_packages.isSet(resolved_package_id)) {
    //             const dependency = dependencies[dep_i];
    //             if (dependency.version.tag == .npm) {
    //                 var dedupe_entry = try dedupe_map.getOrPut(dependency.name_hash);
    //                 if (!dedupe_entry.found_existing) dedupe_entry.value_ptr.* = .{};
    //                 try dedupe_entry.value_ptr.append(allocator, [2]PackageID{ dep_i, resolved_package_id });
    //             }
    //         }
    //     }
    // }

    var new: *Lockfile = try old.allocator.create(Lockfile);
    try new.initEmpty(
        old.allocator,
    );
    try new.string_pool.ensureTotalCapacity(old.string_pool.capacity());
    try new.package_index.ensureTotalCapacity(old.package_index.capacity());
    try new.packages.ensureTotalCapacity(old.allocator, old.packages.len);
    try new.buffers.preallocate(old.buffers, old.allocator);

    old.scratch.dependency_list_queue.head = 0;

    {
        var builder = new.stringBuilder();
        old.overrides.count(old, &builder);
        try builder.allocate();
        new.overrides = try old.overrides.clone(old, new, &builder);
    }

    // Step 1. Recreate the lockfile with only the packages that are still alive
    const root = old.rootPackage() orelse return error.NoPackage;

    const package_id_mapping = try old.allocator.alloc(PackageID, old.packages.len);
    @memset(
        package_id_mapping,
        invalid_package_id,
    );
    const clone_queue_ = PendingResolutions.init(old.allocator);
    var cloner = Cloner{
        .old = old,
        .lockfile = new,
        .mapping = package_id_mapping,
        .clone_queue = clone_queue_,
        .log = log,
    };

    // try clone_queue.ensureUnusedCapacity(root.dependencies.len);
    _ = try root.clone(old, new, package_id_mapping, &cloner);

    // Clone workspace_paths and workspace_versions at the end.
    if (old.workspace_paths.count() > 0 or old.workspace_versions.count() > 0) {
        try new.workspace_paths.ensureTotalCapacity(z_allocator, old.workspace_paths.count());
        try new.workspace_versions.ensureTotalCapacity(z_allocator, old.workspace_versions.count());

        var workspace_paths_builder = new.stringBuilder();

        const WorkspacePathSorter = struct {
            string_buf: []const u8,
            entries: NameHashMap.DataList,

            pub fn lessThan(sorter: @This(), a: usize, b: usize) bool {
                const left = sorter.entries.items(.value)[a];
                const right = sorter.entries.items(.value)[b];
                return strings.order(left.slice(sorter.string_buf), right.slice(sorter.string_buf)) == .lt;
            }
        };

        // Sort by name for determinism
        old.workspace_paths.sort(WorkspacePathSorter{
            .entries = old.workspace_paths.entries,
            .string_buf = old.buffers.string_bytes.items,
        });

        for (old.workspace_paths.values()) |*path| {
            workspace_paths_builder.count(old.str(path));
        }
        const versions: []const Semver.Version = old.workspace_versions.values();
        for (versions) |version| {
            version.count(old.buffers.string_bytes.items, @TypeOf(&workspace_paths_builder), &workspace_paths_builder);
        }

        try workspace_paths_builder.allocate();

        new.workspace_paths.entries.len = old.workspace_paths.entries.len;

        for (old.workspace_paths.values(), new.workspace_paths.values()) |*src, *dest| {
            dest.* = workspace_paths_builder.append(String, old.str(src));
        }
        @memcpy(
            new.workspace_paths.keys(),
            old.workspace_paths.keys(),
        );

        try new.workspace_versions.ensureTotalCapacity(z_allocator, old.workspace_versions.count());
        new.workspace_versions.entries.len = old.workspace_versions.entries.len;
        for (versions, new.workspace_versions.values()) |src, *dest| {
            dest.* = src.clone(old.buffers.string_bytes.items, @TypeOf(&workspace_paths_builder), &workspace_paths_builder);
        }

        @memcpy(
            new.workspace_versions.keys(),
            old.workspace_versions.keys(),
        );

        workspace_paths_builder.clamp();

        try new.workspace_versions.reIndex(z_allocator);
        try new.workspace_paths.reIndex(z_allocator);
    }

    // When you run `"bun add react"
    // This is where we update it in the lockfile from "latest" to "^17.0.2"
    try cloner.flush();

    // Don't allow invalid memory to happen
    if (updates.len > 0) {
        const slice = new.packages.slice();
        const names = slice.items(.name);
        const resolutions = slice.items(.resolution);
        const dep_list = slice.items(.dependencies)[0];
        const res_list = slice.items(.resolutions)[0];
        const root_deps: []const Dependency = dep_list.get(new.buffers.dependencies.items);
        const resolved_ids: []const PackageID = res_list.get(new.buffers.resolutions.items);
        const string_buf = new.buffers.string_bytes.items;

        for (updates) |*update| {
            if (update.resolution.tag == .uninitialized) {
                for (root_deps, resolved_ids) |dep, package_id| {
                    if (update.matches(dep, string_buf)) {
                        if (package_id > new.packages.len) continue;
                        update.version_buf = string_buf;
                        update.version = dep.version;
                        update.resolution = resolutions[package_id];
                        update.resolved_name = names[package_id];
                    }
                }
            }
        }
    }
    new.trusted_dependencies = old_trusted_dependencies;
    new.scripts = old_scripts;
    new.meta_hash = old.meta_hash;

    return new;
}

pub const MetaHashFormatter = struct {
    meta_hash: *const MetaHash,

    pub fn format(this: MetaHashFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        var remain: []const u8 = this.meta_hash[0..];

        try std.fmt.format(
            writer,
            "{}-{}-{}-{}",
            .{
                std.fmt.fmtSliceHexUpper(remain[0..8]),
                std.fmt.fmtSliceHexLower(remain[8..16]),
                std.fmt.fmtSliceHexUpper(remain[16..24]),
                std.fmt.fmtSliceHexLower(remain[24..32]),
            },
        );
    }
};

pub fn fmtMetaHash(this: *const Lockfile) MetaHashFormatter {
    return .{
        .meta_hash = &this.meta_hash,
    };
}

pub const FillItem = struct {
    tree_id: Tree.Id,
    dependency_id: DependencyID,
};
pub const TreeFiller = std.fifo.LinearFifo(FillItem, .Dynamic);

const Cloner = struct {
    clone_queue: PendingResolutions,
    lockfile: *Lockfile,
    old: *Lockfile,
    mapping: []PackageID,
    trees: Tree.List = Tree.List{},
    trees_count: u32 = 1,
    log: *logger.Log,

    pub fn flush(this: *Cloner) anyerror!void {
        const max_package_id = this.old.packages.len;
        while (this.clone_queue.popOrNull()) |to_clone_| {
            const to_clone: PendingResolution = to_clone_;

            const mapping = this.mapping[to_clone.old_resolution];
            if (mapping < max_package_id) {
                this.lockfile.buffers.resolutions.items[to_clone.resolve_id] = mapping;
                continue;
            }

            const old_package = this.old.packages.get(to_clone.old_resolution);

            this.lockfile.buffers.resolutions.items[to_clone.resolve_id] = try old_package.clone(
                this.old,
                this.lockfile,
                this.mapping,
                this,
            );
        }

        if (this.lockfile.buffers.dependencies.items.len > 0)
            try this.hoist();

        // capacity is used for calculating byte size
        // so we need to make sure it's exact
        if (this.lockfile.packages.capacity != this.lockfile.packages.len and this.lockfile.packages.len > 0)
            this.lockfile.packages.shrinkAndFree(this.lockfile.allocator, this.lockfile.packages.len);
    }

    fn hoist(this: *Cloner) anyerror!void {
        if (this.lockfile.packages.len == 0) return;

        const allocator = this.lockfile.allocator;
        var slice = this.lockfile.packages.slice();
        var builder = Tree.Builder{
            .name_hashes = slice.items(.name_hash),
            .queue = TreeFiller.init(allocator),
            .resolution_lists = slice.items(.resolutions),
            .resolutions = this.lockfile.buffers.resolutions.items,
            .allocator = allocator,
            .dependencies = this.lockfile.buffers.dependencies.items,
            .log = this.log,
            .old_lockfile = this.old,
        };

        try (Tree{}).processSubtree(Tree.root_dep_id, &builder);
        // This goes breadth-first
        while (builder.queue.readItem()) |item| {
            try builder.list.items(.tree)[item.tree_id].processSubtree(item.dependency_id, &builder);
        }

        this.lockfile.buffers.hoisted_dependencies = try builder.clean();
        {
            const final = builder.list.items(.tree);
            this.lockfile.buffers.trees = .{
                .items = final,
                .capacity = final.len,
            };
        }
    }
};

const PendingResolution = struct {
    old_resolution: PackageID,
    resolve_id: PackageID,
    parent: PackageID,
};

const PendingResolutions = std.ArrayList(PendingResolution);

pub const Printer = struct {
    lockfile: *Lockfile,
    options: PackageManager.Options,
    successfully_installed: ?Bitset = null,

    updates: []const PackageManager.UpdateRequest = &[_]PackageManager.UpdateRequest{},

    pub const Format = enum { yarn };

    pub fn print(
        allocator: Allocator,
        log: *logger.Log,
        input_lockfile_path: string,
        format: Format,
    ) !void {
        @setCold(true);

        // We truncate longer than allowed paths. We should probably throw an error instead.
        const path = input_lockfile_path[0..@min(input_lockfile_path.len, bun.MAX_PATH_BYTES)];

        var lockfile_path_buf1: [bun.MAX_PATH_BYTES]u8 = undefined;
        var lockfile_path_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;

        var lockfile_path: stringZ = "";

        if (!std.fs.path.isAbsolute(path)) {
            const cwd = try bun.getcwd(&lockfile_path_buf1);
            var parts = [_]string{path};
            const lockfile_path__ = Path.joinAbsStringBuf(cwd, &lockfile_path_buf2, &parts, .auto);
            lockfile_path_buf2[lockfile_path__.len] = 0;
            lockfile_path = lockfile_path_buf2[0..lockfile_path__.len :0];
        } else if (path.len > 0) {
            @memcpy(lockfile_path_buf1[0..path.len], path);
            lockfile_path_buf1[path.len] = 0;
            lockfile_path = lockfile_path_buf1[0..path.len :0];
        }

        if (lockfile_path.len > 0 and lockfile_path[0] == std.fs.path.sep)
            _ = bun.sys.chdir(std.fs.path.dirname(lockfile_path) orelse std.fs.path.sep_str);

        _ = try FileSystem.init(null);

        var lockfile = try allocator.create(Lockfile);

        const load_from_disk = lockfile.loadFromDisk(allocator, log, lockfile_path);
        switch (load_from_disk) {
            .err => |cause| {
                switch (cause.step) {
                    .open_file => Output.prettyErrorln("<r><red>error<r> opening lockfile:<r> {s}.", .{
                        @errorName(cause.value),
                    }),
                    .parse_file => Output.prettyErrorln("<r><red>error<r> parsing lockfile:<r> {s}", .{
                        @errorName(cause.value),
                    }),
                    .read_file => Output.prettyErrorln("<r><red>error<r> reading lockfile:<r> {s}", .{
                        @errorName(cause.value),
                    }),
                    .migrating => Output.prettyErrorln("<r><red>error<r> while migrating lockfile:<r> {s}", .{
                        @errorName(cause.value),
                    }),
                }
                if (log.errors > 0) {
                    switch (Output.enable_ansi_colors) {
                        inline else => |enable_ansi_colors| {
                            try log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors);
                        },
                    }
                }
                Global.crash();
            },
            .not_found => {
                Output.prettyErrorln("<r><red>lockfile not found:<r> {}", .{
                    bun.fmt.QuotedFormatter{ .text = std.mem.sliceAsBytes(lockfile_path) },
                });
                Global.crash();
            },

            .ok => {},
        }

        const writer = Output.writer();
        try printWithLockfile(allocator, lockfile, format, @TypeOf(writer), writer);
        Output.flush();
    }

    pub fn printWithLockfile(
        allocator: Allocator,
        lockfile: *Lockfile,
        format: Format,
        comptime Writer: type,
        writer: Writer,
    ) !void {
        var fs = &FileSystem.instance;
        var options = PackageManager.Options{
            .max_concurrent_lifecycle_scripts = 1,
        };

        const entries_option = try fs.fs.readDirectory(fs.top_level_dir, null, 0, true);

        var env_loader: *DotEnv.Loader = brk: {
            const map = try allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(allocator);

            const loader = try allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, allocator);
            break :brk loader;
        };

        env_loader.loadProcess();
        try env_loader.load(entries_option.entries, &[_][]u8{}, .production);
        var log = logger.Log.init(allocator);
        try options.load(
            allocator,
            &log,
            env_loader,
            null,
            null,
            .install,
        );

        var printer = Printer{
            .lockfile = lockfile,
            .options = options,
        };

        switch (format) {
            .yarn => {
                try Yarn.print(&printer, Writer, writer);
            },
        }
    }

    pub const Tree = struct {
        /// - Prints an empty newline with no diffs
        /// - Prints a leading and trailing blank newline with diffs
        pub fn print(
            this: *Printer,
            comptime Writer: type,
            writer: Writer,
            comptime enable_ansi_colors: bool,
        ) !void {
            var visited = try Bitset.initEmpty(
                this.lockfile.allocator,
                this.lockfile.packages.len,
            );

            var slice = this.lockfile.packages.slice();
            const bins: []const Bin = slice.items(.bin);
            const resolved: []const Resolution = slice.items(.resolution);
            if (resolved.len == 0) return;
            const resolutions_list = slice.items(.resolutions);
            const resolutions_buffer: []const PackageID = this.lockfile.buffers.resolutions.items;
            const dependencies_buffer: []const Dependency = this.lockfile.buffers.dependencies.items;
            const string_buf = this.lockfile.buffers.string_bytes.items;
            const id_map = try default_allocator.alloc(DependencyID, this.updates.len);
            @memset(id_map, invalid_package_id);
            defer if (id_map.len > 0) default_allocator.free(id_map);

            visited.set(0);
            const end = @as(PackageID, @truncate(resolved.len));

            try writer.writeAll("\n");

            var had_printed_new_install = false;
            if (this.successfully_installed) |installed| {
                var dep_id = resolutions_list[0].off;
                const dep_end = dep_id + resolutions_list[0].len;
                outer: while (dep_id < dep_end) : (dep_id += 1) {
                    const dependency = dependencies_buffer[dep_id];
                    if (dependency.behavior.isPeer()) continue;
                    const package_id = resolutions_buffer[dep_id];
                    if (package_id >= end) continue;
                    const package_name = dependency.name.slice(string_buf);

                    if (this.updates.len > 0) {
                        for (this.updates, id_map) |update, *dependency_id| {
                            if (update.failed) return;
                            if (update.matches(dependency, string_buf)) {
                                if (dependency_id.* == invalid_package_id) {
                                    dependency_id.* = @as(DependencyID, @truncate(dep_id));
                                }

                                continue :outer;
                            }
                        }
                    }

                    if (!installed.isSet(package_id)) continue;

                    if (!had_printed_new_install) {
                        had_printed_new_install = true;
                    }

                    if (PackageManager.instance.formatLaterVersionInCache(package_name, dependency.name_hash, resolved[package_id])) |later_version_fmt| {
                        const fmt = comptime brk: {
                            if (enable_ansi_colors) {
                                break :brk Output.prettyFmt("<r> <green>+<r> <b>{s}<r><d>@{}<r> <d>(<blue>v{} available<r><d>)<r>\n", enable_ansi_colors);
                            } else {
                                break :brk Output.prettyFmt("<r> + {s}<r><d>@{}<r> <d>(v{} available)<r>\n", enable_ansi_colors);
                            }
                        };
                        try writer.print(
                            fmt,
                            .{
                                package_name,
                                resolved[package_id].fmt(string_buf),
                                later_version_fmt,
                            },
                        );
                    } else {
                        const fmt = comptime brk: {
                            if (enable_ansi_colors) {
                                break :brk Output.prettyFmt("<r> <green>+<r> <b>{s}<r><d>@{}<r>\n", enable_ansi_colors);
                            } else {
                                break :brk Output.prettyFmt("<r> + {s}<r><d>@{}<r>\n", enable_ansi_colors);
                            }
                        };

                        try writer.print(
                            fmt,
                            .{
                                package_name,
                                resolved[package_id].fmt(string_buf),
                            },
                        );
                    }
                }
            } else {
                outer: for (dependencies_buffer, resolutions_buffer, 0..) |dependency, package_id, dep_id| {
                    if (package_id >= end) continue;
                    if (dependency.behavior.isPeer()) continue;
                    const package_name = dependency.name.slice(string_buf);

                    if (this.updates.len > 0) {
                        for (this.updates, id_map) |update, *dependency_id| {
                            if (update.failed) return;
                            if (update.matches(dependency, string_buf)) {
                                if (dependency_id.* == invalid_package_id) {
                                    dependency_id.* = @as(DependencyID, @truncate(dep_id));
                                }

                                continue :outer;
                            }
                        }
                    }

                    try writer.print(
                        comptime Output.prettyFmt(" <r><b>{s}<r><d>@<b>{}<r>\n", enable_ansi_colors),
                        .{
                            package_name,
                            resolved[package_id].fmt(string_buf),
                        },
                    );
                }
            }

            if (had_printed_new_install) {
                try writer.writeAll("\n");
            }

            if (bun.Environment.allow_assert) had_printed_new_install = false;

            for (id_map) |dependency_id| {
                if (dependency_id == invalid_package_id) continue;
                if (bun.Environment.allow_assert) had_printed_new_install = true;

                const name = dependencies_buffer[dependency_id].name;
                const package_id = resolutions_buffer[dependency_id];
                const bin = bins[package_id];

                const package_name = name.slice(string_buf);

                switch (bin.tag) {
                    .none, .dir => {
                        const fmt = comptime Output.prettyFmt("<r> <green>installed<r> <b>{s}<r><d>@{}<r>\n", enable_ansi_colors);

                        try writer.print(
                            fmt,
                            .{
                                package_name,
                                resolved[package_id].fmt(string_buf),
                            },
                        );
                    },
                    .map, .file, .named_file => {
                        var iterator = Bin.NamesIterator{
                            .bin = bin,
                            .package_name = name,
                            .string_buffer = string_buf,
                            .extern_string_buf = this.lockfile.buffers.extern_strings.items,
                        };

                        const fmt = comptime Output.prettyFmt("<r> <green>installed<r> {s}<r><d>@{}<r> with binaries:\n", enable_ansi_colors);

                        try writer.print(
                            fmt,
                            .{
                                package_name,
                                resolved[package_id].fmt(string_buf),
                            },
                        );

                        while (iterator.next() catch null) |bin_name| {
                            try writer.print(
                                comptime Output.prettyFmt("<r>  <d>- <r><b>{s}<r>\n", enable_ansi_colors),
                                .{
                                    bin_name,
                                },
                            );
                        }
                    },
                }
            }

            // updates.len > 0 is a simpler check than to keep track of a boolean
            // this assert ensures it is accurate.
            if (bun.Environment.allow_assert)
                std.debug.assert(had_printed_new_install == (this.updates.len > 0));

            if (this.updates.len > 0) {
                try writer.writeAll("\n");
            }
        }
    };

    pub const Yarn = struct {
        pub fn print(
            this: *Printer,
            comptime Writer: type,
            writer: Writer,
        ) !void {
            // internal for debugging, print the lockfile as custom json
            // limited to debug because we don't want people to rely on this format.
            if (Environment.isDebug) {
                if (std.process.hasEnvVarConstant("JSON")) {
                    try std.json.stringify(
                        this.lockfile,
                        .{
                            .whitespace = .indent_2,
                            .emit_null_optional_fields = true,
                            .emit_nonportable_numbers_as_strings = true,
                        },
                        writer,
                    );
                    try writer.writeAll("\n");
                    return;
                }
            }

            try writer.writeAll(
                \\# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
                \\# yarn lockfile v1
                \\# bun ./bun.lockb --hash:
            );
            try writer.print(
                " {}\n\n",
                .{this.lockfile.fmtMetaHash()},
            );

            try Yarn.packages(this, Writer, writer);
        }

        pub fn packages(
            this: *Printer,
            comptime Writer: type,
            writer: Writer,
        ) !void {
            var slice = this.lockfile.packages.slice();
            const names: []const String = slice.items(.name);
            const resolved: []const Resolution = slice.items(.resolution);
            const metas: []const Lockfile.Package.Meta = slice.items(.meta);
            if (names.len == 0) return;
            const dependency_lists = slice.items(.dependencies);
            const resolutions_buffer = this.lockfile.buffers.resolutions.items;
            const dependencies_buffer = this.lockfile.buffers.dependencies.items;
            const RequestedVersion = std.HashMap(PackageID, []Dependency.Version, IdentityContext(PackageID), 80);
            var requested_versions = RequestedVersion.init(this.lockfile.allocator);
            var all_requested_versions = try this.lockfile.allocator.alloc(Dependency.Version, resolutions_buffer.len);
            defer this.lockfile.allocator.free(all_requested_versions);
            const package_count = @as(PackageID, @truncate(names.len));
            var alphabetized_names = try this.lockfile.allocator.alloc(PackageID, package_count - 1);
            defer this.lockfile.allocator.free(alphabetized_names);

            const string_buf = this.lockfile.buffers.string_bytes.items;

            // First, we need to build a map of all requested versions
            // This is so we can print requested versions
            {
                var i: PackageID = 1;
                while (i < package_count) : (i += 1) {
                    alphabetized_names[i - 1] = i;

                    var resolutions = resolutions_buffer;
                    var dependencies = dependencies_buffer;

                    var j: PackageID = 0;
                    var requested_version_start = all_requested_versions;
                    while (std.mem.indexOfScalar(PackageID, resolutions, i)) |k| {
                        j += 1;

                        all_requested_versions[0] = dependencies[k].version;
                        all_requested_versions = all_requested_versions[1..];

                        dependencies = dependencies[k + 1 ..];
                        resolutions = resolutions[k + 1 ..];
                    }

                    const dependency_versions = requested_version_start[0..j];
                    if (dependency_versions.len > 1) std.sort.insertion(Dependency.Version, dependency_versions, string_buf, Dependency.Version.isLessThanWithTag);
                    try requested_versions.put(i, dependency_versions);
                }
            }

            std.sort.pdq(
                PackageID,
                alphabetized_names,
                Lockfile.Package.Alphabetizer{
                    .names = names,
                    .buf = string_buf,
                    .resolutions = resolved,
                },
                Lockfile.Package.Alphabetizer.isAlphabetical,
            );

            // When printing, we start at 1
            for (alphabetized_names) |i| {
                const name = names[i].slice(string_buf);
                const resolution = resolved[i];
                const meta = metas[i];
                const dependencies: []const Dependency = dependency_lists[i].get(dependencies_buffer);
                const version_formatter = resolution.fmt(string_buf);

                // This prints:
                // "@babel/core@7.9.0":
                {
                    try writer.writeAll("\n");
                    const dependency_versions = requested_versions.get(i).?;

                    // https://github.com/yarnpkg/yarn/blob/158d96dce95313d9a00218302631cd263877d164/src/lockfile/stringify.js#L9
                    const always_needs_quote = strings.mustEscapeYAMLString(name);

                    var prev_dependency_version: ?Dependency.Version = null;
                    var needs_comma = false;
                    for (dependency_versions) |*dependency_version| {
                        if (needs_comma) {
                            if (prev_dependency_version) |*prev| {
                                if (prev.eql(dependency_version, string_buf, string_buf)) {
                                    continue;
                                }
                            }
                            try writer.writeAll(", ");
                            needs_comma = false;
                        }
                        const version_name = dependency_version.literal.slice(string_buf);
                        const needs_quote = always_needs_quote or std.mem.indexOfAny(u8, version_name, " |\t-/!") != null or strings.hasPrefixComptime(version_name, "npm:");

                        if (needs_quote) {
                            try writer.writeByte('"');
                        }

                        try writer.writeAll(name);
                        try writer.writeByte('@');
                        if (version_name.len == 0) {
                            try std.fmt.format(writer, "^{any}", .{version_formatter});
                        } else {
                            try writer.writeAll(version_name);
                        }

                        if (needs_quote) {
                            try writer.writeByte('"');
                        }
                        prev_dependency_version = dependency_version.*;
                        needs_comma = true;
                    }

                    try writer.writeAll(":\n");
                }

                {
                    try writer.writeAll("  version ");

                    // Version is always quoted
                    try std.fmt.format(writer, "\"{any}\"\n", .{version_formatter});

                    try writer.writeAll("  resolved ");

                    const url_formatter = resolution.fmtURL(&this.options, string_buf);

                    // Resolved URL is always quoted
                    try std.fmt.format(writer, "\"{any}\"\n", .{url_formatter});

                    if (meta.integrity.tag != .unknown) {
                        // Integrity is...never quoted?
                        try std.fmt.format(writer, "  integrity {any}\n", .{&meta.integrity});
                    }

                    if (dependencies.len > 0) {
                        var behavior = Behavior.uninitialized;
                        var dependency_behavior_change_count: u8 = 0;
                        for (dependencies) |dep| {
                            if (!dep.behavior.eq(behavior)) {
                                if (dep.behavior.isOptional()) {
                                    try writer.writeAll("  optionalDependencies:\n");
                                    if (comptime Environment.allow_assert) dependency_behavior_change_count += 1;
                                } else if (dep.behavior.isNormal()) {
                                    try writer.writeAll("  dependencies:\n");
                                    if (comptime Environment.allow_assert) dependency_behavior_change_count += 1;
                                } else if (dep.behavior.isDev()) {
                                    try writer.writeAll("  devDependencies:\n");
                                    if (comptime Environment.allow_assert) dependency_behavior_change_count += 1;
                                } else {
                                    continue;
                                }
                                behavior = dep.behavior;

                                // assert its sorted
                                if (comptime Environment.allow_assert) std.debug.assert(dependency_behavior_change_count < 3);
                            }

                            try writer.writeAll("    ");
                            const dependency_name = dep.name.slice(string_buf);

                            const needs_quote = strings.mustEscapeYAMLString(dependency_name);

                            if (needs_quote) {
                                try writer.writeByte('"');
                            }
                            try writer.writeAll(dependency_name);
                            if (needs_quote) {
                                try writer.writeByte('"');
                            }
                            try writer.writeAll(" \"");
                            try writer.writeAll(dep.version.literal.slice(string_buf));
                            try writer.writeAll("\"\n");
                        }
                    }
                }
            }
        }
    };
};

pub fn verifyData(this: *Lockfile) !void {
    std.debug.assert(this.format == Lockfile.FormatVersion.current);
    var i: usize = 0;
    while (i < this.packages.len) : (i += 1) {
        const package: Lockfile.Package = this.packages.get(i);
        std.debug.assert(this.str(&package.name).len == @as(usize, package.name.len()));
        std.debug.assert(String.Builder.stringHash(this.str(&package.name)) == @as(usize, package.name_hash));
        std.debug.assert(package.dependencies.get(this.buffers.dependencies.items).len == @as(usize, package.dependencies.len));
        std.debug.assert(package.resolutions.get(this.buffers.resolutions.items).len == @as(usize, package.resolutions.len));
        std.debug.assert(package.resolutions.get(this.buffers.resolutions.items).len == @as(usize, package.dependencies.len));
        const dependencies = package.dependencies.get(this.buffers.dependencies.items);
        for (dependencies) |dependency| {
            std.debug.assert(this.str(&dependency.name).len == @as(usize, dependency.name.len()));
            std.debug.assert(String.Builder.stringHash(this.str(&dependency.name)) == dependency.name_hash);
        }
    }
}

pub fn verifyResolutions(this: *Lockfile, local_features: Features, remote_features: Features, comptime log_level: PackageManager.Options.LogLevel) void {
    const resolutions_lists: []const DependencyIDSlice = this.packages.items(.resolutions);
    const dependency_lists: []const DependencySlice = this.packages.items(.dependencies);
    const dependencies_buffer = this.buffers.dependencies.items;
    const resolutions_buffer = this.buffers.resolutions.items;
    const end = @as(PackageID, @truncate(this.packages.len));

    var any_failed = false;
    const string_buf = this.buffers.string_bytes.items;

    const root_list = resolutions_lists[0];
    for (resolutions_lists, dependency_lists, 0..) |resolution_list, dependency_list, parent_id| {
        for (resolution_list.get(resolutions_buffer), dependency_list.get(dependencies_buffer)) |package_id, failed_dep| {
            if (package_id < end) continue;
            if (failed_dep.behavior.isPeer() or !failed_dep.behavior.isEnabled(
                if (root_list.contains(@truncate(parent_id)))
                    local_features
                else
                    remote_features,
            )) continue;
            if (log_level != .silent) {
                if (failed_dep.name.isEmpty() or strings.eql(failed_dep.name.slice(string_buf), failed_dep.version.literal.slice(string_buf))) {
                    Output.prettyErrorln(
                        "<r><red>error<r><d>:<r> <b>{}<r><d> failed to resolve<r>\n",
                        .{
                            failed_dep.version.literal.fmt(string_buf),
                        },
                    );
                } else {
                    Output.prettyErrorln(
                        "<r><red>error<r><d>:<r> <b>{s}<r><d>@<b>{}<r><d> failed to resolve<r>\n",
                        .{
                            failed_dep.name.slice(string_buf),
                            failed_dep.version.literal.fmt(string_buf),
                        },
                    );
                }
            }
            // track this so we can log each failure instead of just the first
            any_failed = true;
        }
    }

    if (any_failed) Global.crash();
}

pub fn saveToDisk(this: *Lockfile, filename: stringZ) void {
    if (comptime Environment.allow_assert) {
        this.verifyData() catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to verify lockfile: {s}", .{@errorName(err)});
            Global.crash();
        };
        std.debug.assert(FileSystem.instance_loaded);
    }
    var tmpname_buf: [512]u8 = undefined;
    tmpname_buf[0..9].* = ".bunlockb".*;
    var tmpfile = FileSystem.RealFS.Tmpfile{};
    var base64_bytes: [16]u8 = undefined;
    std.crypto.random.bytes(&base64_bytes);

    const tmpname__ = std.fmt.bufPrint(tmpname_buf[9..], "{s}", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;
    tmpname_buf[tmpname__.len + 9] = 0;
    const tmpname = tmpname_buf[0 .. tmpname__.len + 9 :0];

    tmpfile.create(&FileSystem.instance.fs, tmpname) catch |err| {
        Output.prettyErrorln("<r><red>error:<r> failed to open lockfile: {s}", .{@errorName(err)});
        Global.crash();
    };

    const file = tmpfile.fd.asFile();
    {
        var bytes = std.ArrayList(u8).init(bun.default_allocator);
        defer bytes.deinit();
        var total_size: usize = 0;
        var end_pos: usize = 0;
        Lockfile.Serializer.save(this, &bytes, &total_size, &end_pos) catch |err| {
            tmpfile.dir().deleteFileZ(tmpname) catch {};
            Output.prettyErrorln("<r><red>error:<r> failed to serialize lockfile: {s}", .{@errorName(err)});
            Global.crash();
        };
        if (bytes.items.len >= end_pos)
            bytes.items[end_pos..][0..@sizeOf(usize)].* = @bitCast(total_size);

        var node_fs: bun.JSC.Node.NodeFS = undefined;
        switch (node_fs.writeFile(
            .{
                .file = .{
                    .fd = bun.toFD(file.handle),
                },
                .dirfd = bun.invalid_fd,
                .data = .{ .string = .{ .utf8 = bun.JSC.ZigString.Slice.from(bytes.items, bun.default_allocator) } },
            },
            .sync,
        )) {
            .err => |e| {
                tmpfile.dir().deleteFileZ(tmpname) catch {};
                Output.prettyErrorln("<r><red>error:<r> failed to write lockfile\n{}", .{e});
                Global.crash();
            },
            .result => {},
        }
    }

    // chmod 777
    switch (bun.sys.fchmod(tmpfile.fd, 0o777)) {
        .err => |err| {
            tmpfile.dir().deleteFileZ(tmpname) catch {};
            Output.prettyErrorln("<r><red>error:<r> failed to change lockfile permissions: {s}", .{@tagName(err.getErrno())});
            Global.crash();
        },
        .result => {},
    }

    tmpfile.promoteToCWD(tmpname, filename) catch |err| {
        if (comptime Environment.allow_assert) {
            if (@errorReturnTrace()) |trace| {
                std.debug.dumpStackTrace(trace.*);
            }
        }
        tmpfile.dir().deleteFileZ(tmpname) catch {};
        Output.prettyErrorln("<r><red>error:<r> failed to save lockfile: {s}", .{@errorName(err)});
        Global.crash();
    };
}

pub fn rootPackage(this: *Lockfile) ?Lockfile.Package {
    if (this.packages.len == 0) {
        return null;
    }

    return this.packages.get(0);
}

pub inline fn str(this: *Lockfile, slicable: anytype) string {
    return strWithType(this, @TypeOf(slicable), slicable);
}

inline fn strWithType(this: *Lockfile, comptime Type: type, slicable: Type) string {
    if (comptime Type == String) {
        @compileError("str must be a *const String. Otherwise it is a pointer to a temporary which is undefined behavior");
    }

    if (comptime Type == ExternalString) {
        @compileError("str must be a *const ExternalString. Otherwise it is a pointer to a temporary which is undefined behavior");
    }

    return slicable.slice(this.buffers.string_bytes.items);
}

pub fn initEmpty(this: *Lockfile, allocator: Allocator) !void {
    this.* = .{
        .format = Lockfile.FormatVersion.current,
        .packages = .{},
        .buffers = .{},
        .package_index = PackageIndex.Map.initContext(allocator, .{}),
        .string_pool = StringPool.init(allocator),
        .allocator = allocator,
        .scratch = Scratch.init(allocator),
        .scripts = .{},
        .trusted_dependencies = .{},
        .workspace_paths = .{},
        .workspace_versions = .{},
    };
}

pub fn getPackageID(
    this: *Lockfile,
    name_hash: u64,
    // If non-null, attempt to use an existing package
    // that satisfies this version range.
    version: ?Dependency.Version,
    resolution: *const Resolution,
) ?PackageID {
    const entry = this.package_index.get(name_hash) orelse return null;
    const resolutions: []const Resolution = this.packages.items(.resolution);
    const npm_version = if (version) |v| switch (v.tag) {
        .npm => v.value.npm.version,
        else => null,
    } else null;
    const buf = this.buffers.string_bytes.items;

    switch (entry) {
        .PackageID => |id| {
            if (comptime Environment.allow_assert) std.debug.assert(id < resolutions.len);

            if (resolutions[id].eql(resolution, buf, buf)) {
                return id;
            }

            if (npm_version) |range| {
                if (range.satisfies(resolutions[id].value.npm.version, buf, buf)) return id;
            }
        },
        .PackageIDMultiple => |ids| {
            for (ids.items) |id| {
                if (comptime Environment.allow_assert) std.debug.assert(id < resolutions.len);

                if (resolutions[id].eql(resolution, buf, buf)) {
                    return id;
                }

                if (npm_version) |range| {
                    if (range.satisfies(resolutions[id].value.npm.version, buf, buf)) return id;
                }
            }
        },
    }

    return null;
}

pub fn getOrPutID(this: *Lockfile, id: PackageID, name_hash: PackageNameHash) !void {
    const gpe = try this.package_index.getOrPut(name_hash);

    if (gpe.found_existing) {
        const index: *PackageIndex.Entry = gpe.value_ptr;

        switch (index.*) {
            .PackageID => |existing_id| {
                var ids = try PackageIDList.initCapacity(this.allocator, 8);
                ids.items.len = 2;

                const resolutions = this.packages.items(.resolution);
                const buf = this.buffers.string_bytes.items;

                ids.items[0..2].* = if (resolutions[id].order(&resolutions[existing_id], buf, buf) == .gt)
                    .{ id, existing_id }
                else
                    .{ existing_id, id };

                index.* = .{
                    .PackageIDMultiple = ids,
                };
            },
            .PackageIDMultiple => |*existing_ids| {
                const resolutions = this.packages.items(.resolution);
                const buf = this.buffers.string_bytes.items;

                for (existing_ids.items, 0..) |existing_id, i| {
                    if (resolutions[id].order(&resolutions[existing_id], buf, buf) == .gt) {
                        try existing_ids.insert(this.allocator, i, id);
                        return;
                    }
                }

                // append to end because it's the smallest or equal to the smallest
                try existing_ids.append(this.allocator, id);
            },
        }
    } else {
        gpe.value_ptr.* = .{ .PackageID = id };
    }
}

pub fn appendPackage(this: *Lockfile, package_: Lockfile.Package) !Lockfile.Package {
    const id = @as(PackageID, @truncate(this.packages.len));
    return try appendPackageWithID(this, package_, id);
}

fn appendPackageWithID(this: *Lockfile, package_: Lockfile.Package, id: PackageID) !Lockfile.Package {
    defer {
        if (comptime Environment.allow_assert) {
            std.debug.assert(this.getPackageID(package_.name_hash, null, &package_.resolution) != null);
        }
    }
    var package = package_;
    package.meta.id = id;
    try this.packages.append(this.allocator, package);
    try this.getOrPutID(id, package.name_hash);

    return package;
}

const StringPool = String.Builder.StringPool;

pub inline fn stringBuilder(this: *Lockfile) Lockfile.StringBuilder {
    return .{
        .lockfile = this,
    };
}

pub const Scratch = struct {
    pub const DuplicateCheckerMap = std.HashMap(PackageNameHash, logger.Loc, IdentityContext(PackageNameHash), 80);
    pub const DependencyQueue = std.fifo.LinearFifo(DependencySlice, .Dynamic);

    duplicate_checker_map: DuplicateCheckerMap = undefined,
    dependency_list_queue: DependencyQueue = undefined,

    pub fn init(allocator: Allocator) Scratch {
        return Scratch{
            .dependency_list_queue = DependencyQueue.init(allocator),
            .duplicate_checker_map = DuplicateCheckerMap.init(allocator),
        };
    }
};

pub const StringBuilder = struct {
    len: usize = 0,
    cap: usize = 0,
    off: usize = 0,
    ptr: ?[*]u8 = null,
    lockfile: *Lockfile,

    pub inline fn count(this: *StringBuilder, slice: string) void {
        if (String.canInline(slice)) return;
        this._countWithHash(slice, String.Builder.stringHash(slice));
    }

    pub inline fn countWithHash(this: *StringBuilder, slice: string, hash: u64) void {
        if (String.canInline(slice)) return;
        this._countWithHash(slice, hash);
    }

    inline fn _countWithHash(this: *StringBuilder, slice: string, hash: u64) void {
        if (!this.lockfile.string_pool.contains(hash)) {
            this.cap += slice.len;
        }
    }

    pub fn allocatedSlice(this: *StringBuilder) []const u8 {
        return if (this.ptr) |ptr| ptr[0..this.cap] else "";
    }

    pub fn clamp(this: *StringBuilder) void {
        if (comptime Environment.allow_assert) std.debug.assert(this.cap >= this.len);

        const excess = this.cap - this.len;

        if (excess > 0)
            this.lockfile.buffers.string_bytes.items = this.lockfile.buffers.string_bytes.items[0 .. this.lockfile.buffers.string_bytes.items.len - excess];
    }

    pub fn allocate(this: *StringBuilder) !void {
        var string_bytes = &this.lockfile.buffers.string_bytes;
        try string_bytes.ensureUnusedCapacity(this.lockfile.allocator, this.cap);
        const prev_len = string_bytes.items.len;
        this.off = prev_len;
        string_bytes.items = string_bytes.items.ptr[0 .. string_bytes.items.len + this.cap];
        this.ptr = string_bytes.items.ptr[prev_len .. prev_len + this.cap].ptr;
        this.len = 0;
    }

    pub fn append(this: *StringBuilder, comptime Type: type, slice: string) Type {
        return @call(.always_inline, appendWithHash, .{ this, Type, slice, String.Builder.stringHash(slice) });
    }

    // SlicedString is not supported due to inline strings.
    pub fn appendWithoutPool(this: *StringBuilder, comptime Type: type, slice: string, hash: u64) Type {
        if (String.canInline(slice)) {
            return switch (Type) {
                String => String.init(this.lockfile.buffers.string_bytes.items, slice),
                ExternalString => ExternalString.init(this.lockfile.buffers.string_bytes.items, slice, hash),
                else => @compileError("Invalid type passed to StringBuilder"),
            };
        }
        if (comptime Environment.allow_assert) {
            std.debug.assert(this.len <= this.cap); // didn't count everything
            std.debug.assert(this.ptr != null); // must call allocate first
        }

        bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
        const final_slice = this.ptr.?[this.len..this.cap][0..slice.len];
        this.len += slice.len;

        if (comptime Environment.allow_assert) std.debug.assert(this.len <= this.cap);

        return switch (Type) {
            String => String.init(this.lockfile.buffers.string_bytes.items, final_slice),
            ExternalString => ExternalString.init(this.lockfile.buffers.string_bytes.items, final_slice, hash),
            else => @compileError("Invalid type passed to StringBuilder"),
        };
    }

    pub fn appendWithHash(this: *StringBuilder, comptime Type: type, slice: string, hash: u64) Type {
        if (String.canInline(slice)) {
            return switch (Type) {
                String => String.init(this.lockfile.buffers.string_bytes.items, slice),
                ExternalString => ExternalString.init(this.lockfile.buffers.string_bytes.items, slice, hash),
                else => @compileError("Invalid type passed to StringBuilder"),
            };
        }

        if (comptime Environment.allow_assert) {
            std.debug.assert(this.len <= this.cap); // didn't count everything
            std.debug.assert(this.ptr != null); // must call allocate first
        }

        const string_entry = this.lockfile.string_pool.getOrPut(hash) catch unreachable;
        if (!string_entry.found_existing) {
            bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
            const final_slice = this.ptr.?[this.len..this.cap][0..slice.len];
            this.len += slice.len;

            string_entry.value_ptr.* = String.init(this.lockfile.buffers.string_bytes.items, final_slice);
        }

        if (comptime Environment.allow_assert) std.debug.assert(this.len <= this.cap);

        return switch (Type) {
            String => string_entry.value_ptr.*,
            ExternalString => .{
                .value = string_entry.value_ptr.*,
                .hash = hash,
            },
            else => @compileError("Invalid type passed to StringBuilder"),
        };
    }
};

pub const PackageIndex = struct {
    pub const Map = std.HashMap(PackageNameHash, PackageIndex.Entry, IdentityContext(PackageNameHash), 80);
    pub const Entry = union(Tag) {
        PackageID: PackageID,
        PackageIDMultiple: PackageIDList,

        pub const Tag = enum(u8) {
            PackageID = 0,
            PackageIDMultiple = 1,
        };
    };
};

pub inline fn hasOverrides(this: *Lockfile) bool {
    return this.overrides.map.count() > 0;
}

pub const OverrideMap = struct {
    const debug = Output.scoped(.OverrideMap, false);

    map: std.ArrayHashMapUnmanaged(PackageNameHash, Dependency, ArrayIdentityContext.U64, false) = .{},

    /// In the future, this `get` function should handle multi-level resolutions. This is difficult right
    /// now because given a Dependency ID, there is no fast way to trace it to it's package.
    ///
    /// A potential approach is to add another buffer to the lockfile that maps Dependency ID to Package ID,
    /// and from there `OverrideMap.map` can have a union as the value, where the union is between "override all"
    /// and "here is a list of overrides depending on the package that imported" similar to PackageIndex above.
    pub fn get(this: *const OverrideMap, name_hash: PackageNameHash) ?Dependency.Version {
        debug("looking up override for {x}", .{name_hash});
        return if (this.map.get(name_hash)) |dep|
            dep.version
        else
            null;
    }

    pub fn deinit(this: *OverrideMap, allocator: Allocator) void {
        this.map.deinit(allocator);
    }

    pub fn count(this: *OverrideMap, lockfile: *Lockfile, builder: *Lockfile.StringBuilder) void {
        for (this.map.values()) |dep| {
            dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
        }
    }

    pub fn clone(this: *OverrideMap, old_lockfile: *Lockfile, new_lockfile: *Lockfile, new_builder: *Lockfile.StringBuilder) !OverrideMap {
        var new = OverrideMap{};
        try new.map.ensureTotalCapacity(new_lockfile.allocator, this.map.entries.len);

        for (this.map.keys(), this.map.values()) |k, v| {
            new.map.putAssumeCapacity(
                k,
                try v.clone(old_lockfile.buffers.string_bytes.items, @TypeOf(new_builder), new_builder),
            );
        }

        return new;
    }

    // the rest of this struct is expression parsing code:

    pub fn parseCount(
        _: *OverrideMap,
        lockfile: *Lockfile,
        expr: Expr,
        builder: *Lockfile.StringBuilder,
    ) void {
        if (expr.asProperty("overrides")) |overrides| {
            if (overrides.expr.data != .e_object)
                return;

            for (overrides.expr.data.e_object.properties.slice()) |entry| {
                builder.count(entry.key.?.asString(lockfile.allocator).?);
                switch (entry.value.?.data) {
                    .e_string => |s| {
                        builder.count(s.slice(lockfile.allocator));
                    },
                    .e_object => {
                        if (entry.value.?.asProperty(".")) |dot| {
                            if (dot.expr.asString(lockfile.allocator)) |s| {
                                builder.count(s);
                            }
                        }
                    },
                    else => {},
                }
            }
        } else if (expr.asProperty("resolutions")) |resolutions| {
            if (resolutions.expr.data != .e_object)
                return;

            for (resolutions.expr.data.e_object.properties.slice()) |entry| {
                builder.count(entry.key.?.asString(lockfile.allocator).?);
                builder.count(entry.value.?.asString(lockfile.allocator) orelse continue);
            }
        }
    }

    /// Given a package json expression, detect and parse override configuration into the given override map.
    /// It is assumed the input map is uninitialized (zero entries)
    pub fn parseAppend(
        this: *OverrideMap,
        lockfile: *Lockfile,
        root_package: *Lockfile.Package,
        log: *logger.Log,
        json_source: logger.Source,
        expr: Expr,
        builder: *Lockfile.StringBuilder,
    ) !void {
        if (Environment.allow_assert) {
            std.debug.assert(this.map.entries.len == 0); // only call parse once
        }
        if (expr.asProperty("overrides")) |overrides| {
            try this.parseFromOverrides(lockfile, root_package, json_source, log, overrides.expr, builder);
        } else if (expr.asProperty("resolutions")) |resolutions| {
            try this.parseFromResolutions(lockfile, root_package, json_source, log, resolutions.expr, builder);
        }
        debug("parsed {d} overrides", .{this.map.entries.len});
    }

    /// https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
    pub fn parseFromOverrides(
        this: *OverrideMap,
        lockfile: *Lockfile,
        root_package: *Lockfile.Package,
        source: logger.Source,
        log: *logger.Log,
        expr: Expr,
        builder: *Lockfile.StringBuilder,
    ) !void {
        if (expr.data != .e_object) {
            try log.addWarningFmt(&source, expr.loc, lockfile.allocator, "\"overrides\" must be an object", .{});
            return error.Invalid;
        }

        try this.map.ensureUnusedCapacity(lockfile.allocator, expr.data.e_object.properties.len);

        for (expr.data.e_object.properties.slice()) |prop| {
            const key = prop.key.?;
            const k = key.asString(lockfile.allocator).?;
            if (k.len == 0) {
                try log.addWarningFmt(&source, key.loc, lockfile.allocator, "Missing overridden package name", .{});
                continue;
            }

            const name_hash = String.Builder.stringHash(k);

            const value = value: {
                // for one level deep, we will only support a string and  { ".": value }
                const value_expr = prop.value.?;
                if (value_expr.data == .e_string) {
                    break :value value_expr;
                } else if (value_expr.data == .e_object) {
                    if (value_expr.asProperty(".")) |dot| {
                        if (dot.expr.data == .e_string) {
                            if (value_expr.data.e_object.properties.len > 1) {
                                try log.addWarningFmt(&source, value_expr.loc, lockfile.allocator, "Bun currently does not support nested \"overrides\"", .{});
                            }
                            break :value dot.expr;
                        } else {
                            try log.addWarningFmt(&source, value_expr.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{k});
                            continue;
                        }
                    } else {
                        try log.addWarningFmt(&source, value_expr.loc, lockfile.allocator, "Bun currently does not support nested \"overrides\"", .{});
                        continue;
                    }
                }
                try log.addWarningFmt(&source, value_expr.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{k});
                continue;
            };

            const version_str = value.data.e_string.slice(lockfile.allocator);
            if (strings.hasPrefixComptime(version_str, "patch:")) {
                // TODO(dylan-conway): apply .patch files to packages
                try log.addWarningFmt(&source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"overrides\"", .{});
                continue;
            }

            if (try parseOverrideValue(
                "override",
                lockfile,
                root_package,
                source,
                value.loc,
                log,
                k,
                version_str,
                builder,
            )) |version| {
                this.map.putAssumeCapacity(name_hash, version);
            }
        }
    }

    /// yarn classic: https://classic.yarnpkg.com/lang/en/docs/selective-version-resolutions/
    /// yarn berry: https://yarnpkg.com/configuration/manifest#resolutions
    pub fn parseFromResolutions(
        this: *OverrideMap,
        lockfile: *Lockfile,
        root_package: *Lockfile.Package,
        source: logger.Source,
        log: *logger.Log,
        expr: Expr,
        builder: *Lockfile.StringBuilder,
    ) !void {
        if (expr.data != .e_object) {
            try log.addWarningFmt(&source, expr.loc, lockfile.allocator, "\"resolutions\" must be an object with string values", .{});
            return;
        }
        try this.map.ensureUnusedCapacity(lockfile.allocator, expr.data.e_object.properties.len);
        for (expr.data.e_object.properties.slice()) |prop| {
            const key = prop.key.?;
            var k = key.asString(lockfile.allocator).?;
            if (strings.hasPrefixComptime(k, "**/"))
                k = k[3..];
            if (k.len == 0) {
                try log.addWarningFmt(&source, key.loc, lockfile.allocator, "Missing resolution package name", .{});
                continue;
            }
            const value = prop.value.?;
            if (value.data != .e_string) {
                try log.addWarningFmt(&source, key.loc, lockfile.allocator, "Expected string value for resolution \"{s}\"", .{k});
                continue;
            }
            // currently we only support one level deep, so we should error if there are more than one
            // - "foo/bar":
            // - "@namespace/hello/world"
            if (k[0] == '@') {
                const first_slash = strings.indexOfChar(k, '/') orelse {
                    try log.addWarningFmt(&source, key.loc, lockfile.allocator, "Invalid package name \"{s}\"", .{k});
                    continue;
                };
                if (strings.indexOfChar(k[first_slash + 1 ..], '/') != null) {
                    try log.addWarningFmt(&source, key.loc, lockfile.allocator, "Bun currently does not support nested \"resolutions\"", .{});
                    continue;
                }
            } else if (strings.indexOfChar(k, '/') != null) {
                try log.addWarningFmt(&source, key.loc, lockfile.allocator, "Bun currently does not support nested \"resolutions\"", .{});
                continue;
            }

            const version_str = value.data.e_string.data;
            if (strings.hasPrefixComptime(version_str, "patch:")) {
                // TODO(dylan-conway): apply .patch files to packages
                try log.addWarningFmt(&source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"resolutions\"", .{});
                continue;
            }

            if (try parseOverrideValue(
                "resolution",
                lockfile,
                root_package,
                source,
                value.loc,
                log,
                k,
                version_str,
                builder,
            )) |version| {
                const name_hash = String.Builder.stringHash(k);
                this.map.putAssumeCapacity(name_hash, version);
            }
        }
    }

    pub fn parseOverrideValue(
        comptime field: []const u8,
        lockfile: *Lockfile,
        root_package: *Lockfile.Package,
        source: logger.Source,
        loc: logger.Loc,
        log: *logger.Log,
        key: []const u8,
        value: []const u8,
        builder: *Lockfile.StringBuilder,
    ) !?Dependency {
        if (value.len == 0) {
            try log.addWarningFmt(&source, loc, lockfile.allocator, "Missing " ++ field ++ " value", .{});
            return null;
        }

        // "Overrides may also be defined as a reference to a spec for a direct dependency
        // by prefixing the name of the package you wish the version to match with a `$`"
        // https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
        // This is why a `*Lockfile.Package` is needed here.
        if (value[0] == '$') {
            const ref_name = value[1..];
            // This is fine for this string to not share the string pool, because it's only used for .eql()
            const ref_name_str = String.init(ref_name, ref_name);
            const pkg_deps: []const Dependency = root_package.dependencies.get(lockfile.buffers.dependencies.items);
            for (pkg_deps) |dep| {
                if (dep.name.eql(ref_name_str, lockfile.buffers.string_bytes.items, ref_name)) {
                    return dep;
                }
            }
            try log.addWarningFmt(&source, loc, lockfile.allocator, "Could not resolve " ++ field ++ " \"{s}\" (you need \"{s}\" in your dependencies)", .{ value, ref_name });
            return null;
        }

        const literalString = builder.append(String, value);
        const literalSliced = literalString.sliced(lockfile.buffers.string_bytes.items);

        const name_hash = String.Builder.stringHash(key);
        const name = builder.appendWithHash(String, key, name_hash);

        return Dependency{
            .name = name,
            .name_hash = name_hash,
            .version = Dependency.parse(
                lockfile.allocator,
                name,
                name_hash,
                literalSliced.slice,
                &literalSliced,
                log,
            ) orelse {
                try log.addWarningFmt(&source, loc, lockfile.allocator, "Invalid " ++ field ++ " value \"{s}\"", .{value});
                return null;
            },
        };
    }
};

pub const FormatVersion = enum(u32) {
    v0 = 0,
    // bun v0.0.x - bun v0.1.6
    v1 = 1,
    // bun v0.1.7+
    // This change added tarball URLs to npm-resolved packages
    v2 = 2,

    _,
    pub const current = FormatVersion.v2;
};

pub const PackageIDSlice = ExternalSlice(PackageID);
pub const DependencySlice = ExternalSlice(Dependency);
pub const DependencyIDSlice = ExternalSlice(DependencyID);

pub const PackageIDList = std.ArrayListUnmanaged(PackageID);
pub const DependencyList = std.ArrayListUnmanaged(Dependency);
pub const DependencyIDList = std.ArrayListUnmanaged(DependencyID);

pub const StringBuffer = std.ArrayListUnmanaged(u8);
pub const ExternalStringBuffer = std.ArrayListUnmanaged(ExternalString);

pub const Package = extern struct {
    name: String = .{},
    name_hash: PackageNameHash = 0,

    /// How this package has been resolved
    /// When .tag is uninitialized, that means the package is not resolved yet.
    resolution: Resolution = .{},

    /// dependencies & resolutions must be the same length
    /// resolutions[i] is the resolved package ID for dependencies[i]
    /// if resolutions[i] is an invalid package ID, then dependencies[i] is not resolved
    dependencies: DependencySlice = .{},

    /// The resolved package IDs for this package's dependencies. Instead of storing this
    /// on the `Dependency` struct within `.dependencies`, it is stored on the package itself
    /// so we can access it faster.
    ///
    /// Each index in this array corresponds to the same index in dependencies.
    /// Each value in this array corresponds to the resolved package ID for that dependency.
    ///
    /// So this is how you say "what package ID for lodash does this package actually resolve to?"
    ///
    /// By default, the underlying buffer is filled with "invalid_id" to indicate this package ID
    /// was not resolved
    resolutions: PackageIDSlice = .{},

    meta: Meta = .{},
    bin: Bin = .{},
    scripts: Package.Scripts = .{},

    pub const Scripts = extern struct {
        preinstall: String = .{},
        install: String = .{},
        postinstall: String = .{},
        preprepare: String = .{},
        prepare: String = .{},
        postprepare: String = .{},
        filled: bool = false,

        pub const List = struct {
            items: [Lockfile.Scripts.names.len]?Lockfile.Scripts.Entry,
            first_index: u8,
            total: u8,

            pub fn first(this: Package.Scripts.List) Lockfile.Scripts.Entry {
                if (comptime Environment.allow_assert) {
                    std.debug.assert(this.items[this.first_index] != null);
                }
                return this.items[this.first_index].?;
            }
        };

        pub fn clone(this: *const Package.Scripts, buf: []const u8, comptime Builder: type, builder: Builder) Package.Scripts {
            if (!this.filled) return .{};
            var scripts = Package.Scripts{
                .filled = true,
            };
            inline for (Lockfile.Scripts.names) |hook| {
                @field(scripts, hook) = builder.append(String, @field(this, hook).slice(buf));
            }
            return scripts;
        }

        pub fn count(this: *const Package.Scripts, buf: []const u8, comptime Builder: type, builder: Builder) void {
            inline for (Lockfile.Scripts.names) |hook| {
                builder.count(@field(this, hook).slice(buf));
            }
        }

        pub fn hasAny(this: *const Package.Scripts) bool {
            inline for (Lockfile.Scripts.names) |hook| {
                if (!@field(this, hook).isEmpty()) return true;
            }
            return false;
        }

        pub fn enqueue(
            this: *const Package.Scripts,
            lockfile: *Lockfile,
            lockfile_buf: []const u8,
            _cwd: string,
            package_name: string,
            resolution_tag: Resolution.Tag,
            add_node_gyp_rebuild_script: bool,
        ) ?Package.Scripts.List {
            var cwd: ?string = null;
            var script_index: u8 = 0;
            var first_script_index: i8 = -1;
            var scripts: [6]?Lockfile.Scripts.Entry = .{null} ** 6;
            var counter: u8 = 0;

            if (add_node_gyp_rebuild_script) {
                // missing install and postinstall, only need to check preinstall
                if (!this.preinstall.isEmpty()) {
                    const entry: Lockfile.Scripts.Entry = .{
                        .cwd = cwd orelse brk: {
                            cwd = lockfile.allocator.dupe(u8, _cwd) catch unreachable;
                            break :brk cwd.?;
                        },
                        .script = lockfile.allocator.dupe(u8, this.preinstall.slice(lockfile_buf)) catch unreachable,
                        .package_name = package_name,
                    };
                    if (first_script_index == -1) first_script_index = @intCast(script_index);
                    scripts[script_index] = entry;
                    lockfile.scripts.preinstall.append(lockfile.allocator, entry) catch unreachable;
                    counter += 1;
                }
                script_index += 1;

                const entry: Lockfile.Scripts.Entry = .{
                    .cwd = cwd orelse brk: {
                        cwd = lockfile.allocator.dupe(u8, _cwd) catch unreachable;
                        break :brk cwd.?;
                    },
                    .script = lockfile.allocator.dupe(u8, "node-gyp rebuild") catch unreachable,
                    .package_name = package_name,
                };
                if (first_script_index == -1) first_script_index = @intCast(script_index);
                scripts[script_index] = entry;
                script_index += 2;
                lockfile.scripts.install.append(lockfile.allocator, entry) catch unreachable;
                counter += 1;
            } else {
                const install_scripts = .{
                    "preinstall",
                    "install",
                    "postinstall",
                };

                inline for (install_scripts) |hook| {
                    const script = @field(this, hook);
                    if (!script.isEmpty()) {
                        debug("enqueue({s}, {s}) in {s}", .{ hook, package_name, _cwd });
                        const entry: Lockfile.Scripts.Entry = .{
                            .cwd = cwd orelse brk: {
                                cwd = lockfile.allocator.dupe(u8, _cwd) catch unreachable;
                                break :brk cwd.?;
                            },
                            .script = lockfile.allocator.dupe(u8, script.slice(lockfile_buf)) catch unreachable,
                            .package_name = package_name,
                        };
                        if (first_script_index == -1) first_script_index = @intCast(script_index);
                        scripts[script_index] = entry;
                        @field(lockfile.scripts, hook).append(lockfile.allocator, entry) catch unreachable;
                        counter += 1;
                    }
                    script_index += 1;
                }
            }

            switch (resolution_tag) {
                .git, .github, .gitlab, .root => {
                    const prepare_scripts = .{
                        "preprepare",
                        "prepare",
                        "postprepare",
                    };

                    inline for (prepare_scripts) |hook| {
                        const script = @field(this, hook);
                        if (!script.isEmpty()) {
                            debug("enqueue({s}, {s}) in {s}", .{ hook, package_name, _cwd });
                            const entry: Lockfile.Scripts.Entry = .{
                                .cwd = cwd orelse brk: {
                                    cwd = lockfile.allocator.dupe(u8, _cwd) catch unreachable;
                                    break :brk cwd.?;
                                },
                                .script = lockfile.allocator.dupe(u8, script.slice(lockfile_buf)) catch unreachable,
                                .package_name = package_name,
                            };
                            if (first_script_index == -1) first_script_index = @intCast(script_index);
                            scripts[script_index] = entry;
                            @field(lockfile.scripts, hook).append(lockfile.allocator, entry) catch unreachable;
                            counter += 1;
                        }
                        script_index += 1;
                    }
                },
                .workspace => {
                    script_index += 1;
                    if (!this.prepare.isEmpty()) {
                        debug("enqueue({s}, {s}) in {s}", .{ "prepare", package_name, _cwd });

                        const entry: Lockfile.Scripts.Entry = .{
                            .cwd = cwd orelse brk: {
                                cwd = lockfile.allocator.dupe(u8, _cwd) catch unreachable;
                                break :brk cwd.?;
                            },
                            .script = lockfile.allocator.dupe(u8, this.prepare.slice(lockfile_buf)) catch unreachable,
                            .package_name = package_name,
                        };
                        if (first_script_index == -1) first_script_index = @intCast(script_index);
                        scripts[script_index] = entry;
                        lockfile.scripts.prepare.append(lockfile.allocator, entry) catch unreachable;
                        counter += 1;
                    }
                    script_index += 2;
                },
                else => {},
            }

            if (first_script_index != -1) {
                return .{
                    .items = scripts,
                    .first_index = @intCast(first_script_index),
                    .total = counter,
                };
            }

            return null;
        }

        pub fn parseCount(allocator: Allocator, builder: *Lockfile.StringBuilder, json: Expr) void {
            if (json.asProperty("scripts")) |scripts_prop| {
                if (scripts_prop.expr.data == .e_object) {
                    inline for (Lockfile.Scripts.names) |script_name| {
                        if (scripts_prop.expr.get(script_name)) |script| {
                            if (script.asString(allocator)) |input| {
                                builder.count(input);
                            }
                        }
                    }
                }
            }
        }

        pub fn parseAlloc(this: *Package.Scripts, allocator: Allocator, builder: *Lockfile.StringBuilder, json: Expr) void {
            if (json.asProperty("scripts")) |scripts_prop| {
                if (scripts_prop.expr.data == .e_object) {
                    inline for (Lockfile.Scripts.names) |script_name| {
                        if (scripts_prop.expr.get(script_name)) |script| {
                            if (script.asString(allocator)) |input| {
                                @field(this, script_name) = builder.append(String, input);
                            }
                        }
                    }
                }
            }
        }

        pub fn enqueueFromPackageJSON(
            this: *Package.Scripts,
            log: *logger.Log,
            lockfile: *Lockfile,
            node_modules: std.fs.Dir,
            node_modules_path: string,
            subpath: [:0]const u8,
            folder_name: string,
            resolution: *const Resolution,
        ) !?Package.Scripts.List {
            var path_buf: bun.PathBuffer = undefined;

            const cwd = Path.joinAbsStringBufZTrailingSlash(
                node_modules_path,
                &path_buf,
                &[_]string{folder_name},
                .auto,
            );

            const json = brk: {
                const json_src = brk2: {
                    const json_path = bun.path.joinZ([_]string{ subpath, "package.json" }, .auto);
                    const json_file_fd = try bun.sys.openat(
                        bun.toFD(node_modules.fd),
                        json_path,
                        std.os.O.RDONLY,
                        0,
                    ).unwrap();
                    const json_file = json_file_fd.asFile();
                    defer json_file.close();
                    const json_stat_size = try json_file.getEndPos();
                    const json_buf = try lockfile.allocator.alloc(u8, json_stat_size + 64);
                    errdefer lockfile.allocator.free(json_buf);
                    const json_len = try json_file.preadAll(json_buf, 0);
                    break :brk2 logger.Source.initPathString(json_path, json_buf[0..json_len]);
                };

                initializeStore();
                break :brk try json_parser.ParseJSONUTF8(
                    &json_src,
                    log,
                    lockfile.allocator,
                );
            };

            var tmp: Lockfile = undefined;
            try tmp.initEmpty(lockfile.allocator);
            defer tmp.deinit();
            var builder = tmp.stringBuilder();
            Lockfile.Package.Scripts.parseCount(lockfile.allocator, &builder, json);
            try builder.allocate();
            this.parseAlloc(lockfile.allocator, &builder, json);

            const add_node_gyp_rebuild_script = if (lockfile.hasTrustedDependency(folder_name) and
                this.install.isEmpty() and
                this.postinstall.isEmpty())
            brk: {
                const binding_dot_gyp_path = Path.joinAbsStringZ(
                    cwd,
                    &[_]string{"binding.gyp"},
                    .auto,
                );

                break :brk bun.sys.exists(binding_dot_gyp_path);
            } else false;

            return this.enqueue(
                lockfile,
                tmp.buffers.string_bytes.items,
                cwd,
                folder_name,
                resolution.tag,
                add_node_gyp_rebuild_script,
            );
        }
    };

    pub const DependencyGroup = struct {
        prop: string,
        field: string,
        behavior: Behavior,

        pub const dependencies = DependencyGroup{ .prop = "dependencies", .field = "dependencies", .behavior = Behavior.normal };
        pub const dev = DependencyGroup{ .prop = "devDependencies", .field = "dev_dependencies", .behavior = Behavior.dev };
        pub const optional = DependencyGroup{ .prop = "optionalDependencies", .field = "optional_dependencies", .behavior = Behavior.optional };
        pub const peer = DependencyGroup{ .prop = "peerDependencies", .field = "peer_dependencies", .behavior = Behavior.peer };
        pub const workspaces = DependencyGroup{ .prop = "workspaces", .field = "workspaces", .behavior = Behavior.workspace };
    };

    pub inline fn isDisabled(this: *const Lockfile.Package) bool {
        return this.meta.isDisabled();
    }

    const Alphabetizer = struct {
        names: []const String,
        buf: []const u8,
        resolutions: []const Resolution,

        pub fn isAlphabetical(ctx: Alphabetizer, lhs: PackageID, rhs: PackageID) bool {
            return switch (ctx.names[lhs].order(&ctx.names[rhs], ctx.buf, ctx.buf)) {
                .eq => ctx.resolutions[lhs].order(&ctx.resolutions[rhs], ctx.buf, ctx.buf) == .lt,
                .lt => true,
                .gt => false,
            };
        }
    };

    const debug = Output.scoped(.Lockfile, true);

    pub fn clone(
        this: *const Lockfile.Package,
        old: *Lockfile,
        new: *Lockfile,
        package_id_mapping: []PackageID,
        cloner: *Cloner,
    ) !PackageID {
        const old_string_buf = old.buffers.string_bytes.items;
        const old_extern_string_buf = old.buffers.extern_strings.items;
        var builder_ = new.stringBuilder();
        var builder = &builder_;
        debug("Clone: {s}@{any} ({s}, {d} dependencies)", .{ this.name.slice(old_string_buf), this.resolution.fmt(old_string_buf), @tagName(this.resolution.tag), this.dependencies.len });

        builder.count(this.name.slice(old_string_buf));
        this.resolution.count(old_string_buf, *Lockfile.StringBuilder, builder);
        this.meta.count(old_string_buf, *Lockfile.StringBuilder, builder);
        this.scripts.count(old_string_buf, *Lockfile.StringBuilder, builder);
        const new_extern_string_count = this.bin.count(old_string_buf, old_extern_string_buf, *Lockfile.StringBuilder, builder);
        const old_dependencies: []const Dependency = this.dependencies.get(old.buffers.dependencies.items);
        const old_resolutions: []const PackageID = this.resolutions.get(old.buffers.resolutions.items);

        for (old_dependencies) |dependency| {
            dependency.count(old_string_buf, *Lockfile.StringBuilder, builder);
        }

        try builder.allocate();

        // should be unnecessary, but Just In Case
        try new.buffers.dependencies.ensureUnusedCapacity(new.allocator, old_dependencies.len);
        try new.buffers.resolutions.ensureUnusedCapacity(new.allocator, old_dependencies.len);
        try new.buffers.extern_strings.ensureUnusedCapacity(new.allocator, new_extern_string_count);

        const prev_len = @as(u32, @truncate(new.buffers.dependencies.items.len));
        const end = prev_len + @as(u32, @truncate(old_dependencies.len));
        const max_package_id = @as(PackageID, @truncate(old.packages.len));

        new.buffers.dependencies.items = new.buffers.dependencies.items.ptr[0..end];
        new.buffers.resolutions.items = new.buffers.resolutions.items.ptr[0..end];

        new.buffers.extern_strings.items.len += new_extern_string_count;
        const new_extern_strings = new.buffers.extern_strings.items[new.buffers.extern_strings.items.len - new_extern_string_count ..];

        const dependencies: []Dependency = new.buffers.dependencies.items[prev_len..end];
        const resolutions: []PackageID = new.buffers.resolutions.items[prev_len..end];

        const id = @as(PackageID, @truncate(new.packages.len));
        const new_package = try new.appendPackageWithID(
            .{
                .name = builder.appendWithHash(
                    String,
                    this.name.slice(old_string_buf),
                    this.name_hash,
                ),
                .bin = this.bin.clone(
                    old_string_buf,
                    old_extern_string_buf,
                    new.buffers.extern_strings.items,
                    new_extern_strings,
                    *Lockfile.StringBuilder,
                    builder,
                ),
                .name_hash = this.name_hash,
                .meta = this.meta.clone(
                    id,
                    old_string_buf,
                    *Lockfile.StringBuilder,
                    builder,
                ),
                .resolution = this.resolution.clone(
                    old_string_buf,
                    *Lockfile.StringBuilder,
                    builder,
                ),
                .scripts = this.scripts.clone(
                    old_string_buf,
                    *Lockfile.StringBuilder,
                    builder,
                ),
                .dependencies = .{ .off = prev_len, .len = end - prev_len },
                .resolutions = .{ .off = prev_len, .len = end - prev_len },
            },
            id,
        );

        package_id_mapping[this.meta.id] = new_package.meta.id;

        for (old_dependencies, dependencies) |old_dep, *new_dep| {
            new_dep.* = try old_dep.clone(
                old_string_buf,
                *Lockfile.StringBuilder,
                builder,
            );
        }

        builder.clamp();

        cloner.trees_count += @as(u32, @intFromBool(old_resolutions.len > 0));

        for (old_resolutions, resolutions, 0..) |old_resolution, *resolution, i| {
            if (old_resolution >= max_package_id) {
                resolution.* = invalid_package_id;
                continue;
            }

            const mapped = package_id_mapping[old_resolution];
            if (mapped < max_package_id) {
                resolution.* = mapped;
            } else {
                try cloner.clone_queue.append(.{
                    .old_resolution = old_resolution,
                    .parent = new_package.meta.id,
                    .resolve_id = new_package.resolutions.off + @as(PackageID, @intCast(i)),
                });
            }
        }

        return new_package.meta.id;
    }

    pub fn fromPackageJSON(
        lockfile: *Lockfile,
        package_json: *PackageJSON,
        comptime features: Features,
    ) !Lockfile.Package {
        var package = Lockfile.Package{};

        // var string_buf = package_json;

        var string_builder = lockfile.stringBuilder();

        var total_dependencies_count: u32 = 0;
        // var bin_extern_strings_count: u32 = 0;

        // --- Counting
        {
            string_builder.count(package_json.name);
            string_builder.count(package_json.version);
            const dependencies = package_json.dependencies.map.values();
            for (dependencies) |dep| {
                if (dep.behavior.isEnabled(features)) {
                    dep.count(package_json.dependencies.source_buf, @TypeOf(&string_builder), &string_builder);
                    total_dependencies_count += 1;
                }
            }
        }

        // string_builder.count(manifest.str(&package_version_ptr.tarball_url));

        try string_builder.allocate();
        defer string_builder.clamp();
        // var extern_strings_list = &lockfile.buffers.extern_strings;
        var dependencies_list = &lockfile.buffers.dependencies;
        var resolutions_list = &lockfile.buffers.resolutions;
        try dependencies_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
        try resolutions_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
        // try extern_strings_list.ensureUnusedCapacity(lockfile.allocator, bin_extern_strings_count);
        // extern_strings_list.items.len += bin_extern_strings_count;

        // -- Cloning
        {
            const package_name: ExternalString = string_builder.append(ExternalString, package_json.name);
            package.name_hash = package_name.hash;
            package.name = package_name.value;

            package.resolution = .{
                .tag = .root,
                .value = .{ .root = {} },
            };

            const total_len = dependencies_list.items.len + total_dependencies_count;
            if (comptime Environment.allow_assert) std.debug.assert(dependencies_list.items.len == resolutions_list.items.len);

            var dependencies: []Dependency = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
            @memset(dependencies, Dependency{});

            const package_dependencies = package_json.dependencies.map.values();
            const source_buf = package_json.dependencies.source_buf;
            for (package_dependencies) |dep| {
                if (!dep.behavior.isEnabled(features)) continue;

                dependencies[0] = try dep.clone(source_buf, @TypeOf(&string_builder), &string_builder);
                dependencies = dependencies[1..];
                if (dependencies.len == 0) break;
            }

            // We lose the bin info here
            // package.bin = package_version.bin.clone(string_buf, manifest.extern_strings_bin_entries, extern_strings_list.items, extern_strings_slice, @TypeOf(&string_builder), &string_builder);
            // and the integriy hash
            // package.meta.integrity = package_version.integrity;

            package.meta.arch = package_json.arch;
            package.meta.os = package_json.os;

            package.dependencies.off = @as(u32, @truncate(dependencies_list.items.len));
            package.dependencies.len = total_dependencies_count - @as(u32, @truncate(dependencies.len));
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            const new_length = package.dependencies.len + dependencies_list.items.len;

            @memset(resolutions_list.items.ptr[package.dependencies.off .. package.dependencies.off + package.dependencies.len], invalid_package_id);

            dependencies_list.items = dependencies_list.items.ptr[0..new_length];
            resolutions_list.items = resolutions_list.items.ptr[0..new_length];

            return package;
        }
    }

    pub fn fromNPM(
        allocator: Allocator,
        lockfile: *Lockfile,
        log: *logger.Log,
        manifest: *const Npm.PackageManifest,
        version: Semver.Version,
        package_version_ptr: *const Npm.PackageVersion,
        string_buf: []const u8,
        comptime features: Features,
    ) !Lockfile.Package {
        var package = Lockfile.Package{};

        const package_version = package_version_ptr.*;

        const dependency_groups = comptime brk: {
            var out_groups: [
                @as(usize, @intFromBool(features.dependencies)) +
                    @as(usize, @intFromBool(features.dev_dependencies)) +
                    @as(usize, @intFromBool(features.optional_dependencies)) +
                    @as(usize, @intFromBool(features.peer_dependencies))
            ]DependencyGroup = undefined;
            var out_group_i: usize = 0;

            if (features.dependencies) {
                out_groups[out_group_i] = DependencyGroup.dependencies;
                out_group_i += 1;
            }
            if (features.dev_dependencies) {
                out_groups[out_group_i] = DependencyGroup.dev;
                out_group_i += 1;
            }

            if (features.optional_dependencies) {
                out_groups[out_group_i] = DependencyGroup.optional;
                out_group_i += 1;
            }

            if (features.peer_dependencies) {
                out_groups[out_group_i] = DependencyGroup.peer;
                out_group_i += 1;
            }

            break :brk out_groups;
        };

        var string_builder = lockfile.stringBuilder();

        var total_dependencies_count: u32 = 0;
        var bin_extern_strings_count: u32 = 0;

        // --- Counting
        {
            string_builder.count(manifest.name());
            version.count(string_buf, @TypeOf(&string_builder), &string_builder);

            inline for (dependency_groups) |group| {
                const map: ExternalStringMap = @field(package_version, group.field);
                const keys = map.name.get(manifest.external_strings);
                const version_strings = map.value.get(manifest.external_strings_for_versions);
                total_dependencies_count += map.value.len;

                if (comptime Environment.isDebug) std.debug.assert(keys.len == version_strings.len);

                for (keys, version_strings) |key, ver| {
                    string_builder.count(key.slice(string_buf));
                    string_builder.count(ver.slice(string_buf));
                }
            }

            bin_extern_strings_count = package_version.bin.count(string_buf, manifest.extern_strings_bin_entries, @TypeOf(&string_builder), &string_builder);
        }

        string_builder.count(manifest.str(&package_version_ptr.tarball_url));

        try string_builder.allocate();
        defer string_builder.clamp();
        var extern_strings_list = &lockfile.buffers.extern_strings;
        var dependencies_list = &lockfile.buffers.dependencies;
        var resolutions_list = &lockfile.buffers.resolutions;
        try dependencies_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
        try resolutions_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
        try extern_strings_list.ensureUnusedCapacity(lockfile.allocator, bin_extern_strings_count);
        extern_strings_list.items.len += bin_extern_strings_count;
        const extern_strings_slice = extern_strings_list.items[extern_strings_list.items.len - bin_extern_strings_count ..];

        // -- Cloning
        {
            const package_name: ExternalString = string_builder.appendWithHash(ExternalString, manifest.name(), manifest.pkg.name.hash);
            package.name_hash = package_name.hash;
            package.name = package_name.value;
            package.resolution = Resolution{
                .value = .{
                    .npm = .{
                        .version = version.clone(
                            manifest.string_buf,
                            @TypeOf(&string_builder),
                            &string_builder,
                        ),
                        .url = string_builder.append(String, manifest.str(&package_version_ptr.tarball_url)),
                    },
                },
                .tag = .npm,
            };

            const total_len = dependencies_list.items.len + total_dependencies_count;
            if (comptime Environment.allow_assert) std.debug.assert(dependencies_list.items.len == resolutions_list.items.len);

            var dependencies = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
            @memset(dependencies, .{});

            total_dependencies_count = 0;
            inline for (dependency_groups) |group| {
                const map: ExternalStringMap = @field(package_version, group.field);
                const keys = map.name.get(manifest.external_strings);
                const version_strings = map.value.get(manifest.external_strings_for_versions);

                if (comptime Environment.isDebug) std.debug.assert(keys.len == version_strings.len);
                const is_peer = comptime strings.eqlComptime(group.field, "peer_dependencies");

                list: for (keys, version_strings, 0..) |key, version_string_, i| {
                    // Duplicate peer & dev dependencies are promoted to whichever appeared first
                    // In practice, npm validates this so it shouldn't happen
                    if (comptime group.behavior.isPeer() or group.behavior.isDev()) {
                        for (dependencies[0..total_dependencies_count]) |dependency| {
                            if (dependency.name_hash == key.hash) continue :list;
                        }
                    }

                    const name: ExternalString = string_builder.appendWithHash(ExternalString, key.slice(string_buf), key.hash);
                    const dep_version = string_builder.appendWithHash(String, version_string_.slice(string_buf), version_string_.hash);
                    const sliced = dep_version.sliced(lockfile.buffers.string_bytes.items);

                    const dependency = Dependency{
                        .name = name.value,
                        .name_hash = name.hash,
                        .behavior = if (comptime is_peer)
                            group.behavior.setOptional(i < package_version.non_optional_peer_dependencies_start)
                        else
                            group.behavior,
                        .version = Dependency.parse(
                            allocator,
                            name.value,
                            name.hash,
                            sliced.slice,
                            &sliced,
                            log,
                        ) orelse Dependency.Version{},
                    };

                    // If a dependency appears in both "dependencies" and "optionalDependencies", it is considered optional!
                    if (comptime group.behavior.isOptional()) {
                        for (dependencies[0..total_dependencies_count]) |*dep| {
                            if (dep.name_hash == key.hash) {
                                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies
                                // > Entries in optionalDependencies will override entries of the same name in dependencies, so it's usually best to only put in one place.
                                dep.* = dependency;
                                continue :list;
                            }
                        }
                    }

                    dependencies[total_dependencies_count] = dependency;
                    total_dependencies_count += 1;
                }
            }

            package.bin = package_version.bin.clone(string_buf, manifest.extern_strings_bin_entries, extern_strings_list.items, extern_strings_slice, @TypeOf(&string_builder), &string_builder);

            package.meta.arch = package_version.cpu;
            package.meta.os = package_version.os;

            package.meta.integrity = package_version.integrity;

            package.dependencies.off = @as(u32, @truncate(dependencies_list.items.len));
            package.dependencies.len = total_dependencies_count;
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            const new_length = package.dependencies.len + dependencies_list.items.len;

            @memset(resolutions_list.items.ptr[package.dependencies.off .. package.dependencies.off + package.dependencies.len], invalid_package_id);

            dependencies_list.items = dependencies_list.items.ptr[0..new_length];
            resolutions_list.items = resolutions_list.items.ptr[0..new_length];

            return package;
        }
    }

    pub const Diff = struct {
        pub const Op = enum {
            add,
            remove,
            update,
            unlink,
            link,
        };

        pub const Summary = struct {
            add: u32 = 0,
            remove: u32 = 0,
            update: u32 = 0,
            overrides_changed: bool = false,

            new_trusted_dependencies: NameHashSet = .{},

            pub inline fn sum(this: *Summary, that: Summary) void {
                this.add += that.add;
                this.remove += that.remove;
                this.update += that.update;
            }

            pub inline fn hasDiffs(this: Summary) bool {
                return this.add > 0 or this.remove > 0 or this.update > 0 or this.overrides_changed;
            }
        };

        pub fn generate(
            allocator: Allocator,
            log: *logger.Log,
            from_lockfile: *Lockfile,
            to_lockfile: *Lockfile,
            from: *Lockfile.Package,
            to: *Lockfile.Package,
            update_requests: ?[]PackageManager.UpdateRequest,
            id_mapping: ?[]PackageID,
        ) !Summary {
            var summary = Summary{};
            const to_deps = to.dependencies.get(to_lockfile.buffers.dependencies.items);
            const from_deps = from.dependencies.get(from_lockfile.buffers.dependencies.items);
            const from_resolutions = from.resolutions.get(from_lockfile.buffers.resolutions.items);
            var to_i: usize = 0;
            var skipped_workspaces: usize = 0;

            if (from_lockfile.overrides.map.count() != to_lockfile.overrides.map.count()) {
                summary.overrides_changed = true;

                if (PackageManager.verbose_install) {
                    Output.prettyErrorln("Overrides changed since last install", .{});
                }
            } else {
                for (
                    from_lockfile.overrides.map.keys(),
                    from_lockfile.overrides.map.values(),
                    to_lockfile.overrides.map.keys(),
                    to_lockfile.overrides.map.values(),
                ) |from_k, *from_override, to_k, *to_override| {
                    if ((from_k != to_k) or (!from_override.eql(to_override, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items))) {
                        summary.overrides_changed = true;
                        if (PackageManager.verbose_install) {
                            Output.prettyErrorln("Overrides changed since last install", .{});
                        }
                        break;
                    }
                }
            }

            {
                var to_lockfile_itr = to_lockfile.trusted_dependencies.iterator();
                while (to_lockfile_itr.next()) |entry| {
                    if (!from_lockfile.trusted_dependencies.contains(entry.key_ptr.*)) {
                        try summary.new_trusted_dependencies.put(allocator, entry.key_ptr.*, {});
                    }
                }
            }

            for (from_deps, 0..) |*from_dep, i| {
                found: {
                    const prev_i = to_i;

                    // common case, dependency is present in both versions:
                    // - in the same position
                    // - shifted by a constant offset
                    while (to_i < to_deps.len) : (to_i += 1) {
                        if (from_dep.name_hash == to_deps[to_i].name_hash) break :found;
                    }

                    // less common, o(n^2) case
                    to_i = 0;
                    while (to_i < prev_i) : (to_i += 1) {
                        if (from_dep.name_hash == to_deps[to_i].name_hash) break :found;
                    }

                    if (PackageManager.instance.workspaces.contains(from_lockfile.str(&from_dep.name))) {
                        skipped_workspaces += 1;
                        continue;
                    }

                    // We found a removed dependency!
                    // We don't need to remove it
                    // It will be cleaned up later
                    summary.remove += 1;
                    continue;
                }
                defer to_i += 1;

                if (to_deps[to_i].eql(from_dep, to_lockfile.buffers.string_bytes.items, from_lockfile.buffers.string_bytes.items)) {
                    if (update_requests) |updates| {
                        if (updates.len == 0 or brk: {
                            for (updates) |request| {
                                if (from_dep.name_hash == request.name_hash) break :brk true;
                            }
                            break :brk false;
                        }) {
                            // Listed as to be updated
                            summary.update += 1;
                            continue;
                        }
                    }

                    if (id_mapping) |mapping| {
                        const version = to_deps[to_i].version;
                        if (switch (version.tag) {
                            .workspace => if (to_lockfile.workspace_paths.getPtr(from_dep.name_hash)) |path_ptr| brk: {
                                const path = to_lockfile.str(path_ptr);
                                var local_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                                const package_json_path = Path.joinZBuf(
                                    &local_buf,
                                    &[_]string{ path, "package.json" },
                                    .auto,
                                );
                                var file = try bun.openFileZ(package_json_path, .{ .mode = .read_only });

                                defer file.close();
                                const bytes = try file.readToEndAlloc(allocator, std.math.maxInt(usize));
                                defer allocator.free(bytes);
                                const source = logger.Source.initPathString(path, bytes);

                                var workspace = Package{};
                                try workspace.parseMain(to_lockfile, allocator, log, source, Features.workspace);

                                var from_pkg = from_lockfile.packages.get(from_resolutions[i]);
                                const diff = try generate(
                                    allocator,
                                    log,
                                    from_lockfile,
                                    to_lockfile,
                                    &from_pkg,
                                    &workspace,
                                    update_requests,
                                    null,
                                );

                                if (PackageManager.verbose_install and (diff.add + diff.remove + diff.update) > 0) {
                                    Output.prettyErrorln("Workspace package \"{s}\" has added <green>{d}<r> dependencies, removed <red>{d}<r> dependencies, and updated <cyan>{d}<r> dependencies", .{
                                        path,
                                        diff.add,
                                        diff.remove,
                                        diff.update,
                                    });
                                }

                                break :brk !diff.hasDiffs();
                            } else false,
                            else => true,
                        }) {
                            mapping[to_i] = @truncate(i);
                            continue;
                        }
                    } else {
                        continue;
                    }
                }

                // We found a changed dependency!
                summary.update += 1;
            }

            summary.add = @truncate((to_deps.len + skipped_workspaces) - (from_deps.len - summary.remove));

            inline for (Lockfile.Scripts.names) |hook| {
                if (!@field(to.scripts, hook).eql(
                    @field(from.scripts, hook),
                    to_lockfile.buffers.string_bytes.items,
                    from_lockfile.buffers.string_bytes.items,
                )) {
                    // We found a changed life-cycle script
                    summary.update += 1;
                }
            }

            return summary;
        }
    };

    pub fn hash(name: string, version: Semver.Version) u64 {
        var hasher = bun.Wyhash.init(0);
        hasher.update(name);
        hasher.update(std.mem.asBytes(&version));
        return hasher.final();
    }

    pub fn parseMain(
        package: *Lockfile.Package,
        lockfile: *Lockfile,
        allocator: Allocator,
        log: *logger.Log,
        source: logger.Source,
        comptime features: Features,
    ) !void {
        return package.parse(lockfile, allocator, log, source, void, {}, features);
    }

    pub fn parse(
        package: *Lockfile.Package,
        lockfile: *Lockfile,
        allocator: Allocator,
        log: *logger.Log,
        source: logger.Source,
        comptime ResolverContext: type,
        resolver: ResolverContext,
        comptime features: Features,
    ) !void {
        initializeStore();
        const json = json_parser.ParseJSONUTF8(&source, log, allocator) catch |err| {
            switch (Output.enable_ansi_colors) {
                inline else => |enable_ansi_colors| {
                    log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), enable_ansi_colors) catch {};
                },
            }
            Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(err), source.path.prettyDir() });
            Global.crash();
        };

        try package.parseWithJSON(
            lockfile,
            allocator,
            log,
            source,
            json,
            ResolverContext,
            resolver,
            features,
        );
    }

    fn parseDependency(
        lockfile: *Lockfile,
        allocator: Allocator,
        log: *logger.Log,
        source: logger.Source,
        comptime group: DependencyGroup,
        string_builder: *StringBuilder,
        comptime features: Features,
        package_dependencies: []Dependency,
        dependencies_count: u32,
        in_workspace: bool,
        comptime tag: ?Dependency.Version.Tag,
        workspace_ver: ?Semver.Version,
        external_alias: ExternalString,
        version: string,
        key_loc: logger.Loc,
        value_loc: logger.Loc,
    ) !?Dependency {
        const external_version = string_builder.append(String, version);
        const buf = lockfile.buffers.string_bytes.items;
        const sliced = external_version.sliced(buf);

        var dependency_version = Dependency.parseWithOptionalTag(
            allocator,
            external_alias.value,
            external_alias.hash,
            sliced.slice,
            tag,
            &sliced,
            log,
        ) orelse Dependency.Version{};
        var workspace_range: ?Semver.Query.Group = null;
        const name_hash = switch (dependency_version.tag) {
            .npm => String.Builder.stringHash(dependency_version.value.npm.name.slice(buf)),
            .workspace => if (strings.hasPrefixComptime(sliced.slice, "workspace:")) brk: {
                const input = sliced.slice["workspace:".len..];
                if (!strings.eqlComptime(input, "*")) {
                    const at = strings.lastIndexOfChar(input, '@') orelse 0;
                    if (at > 0) {
                        workspace_range = Semver.Query.parse(allocator, input[at + 1 ..], sliced) catch return error.InstallFailed;
                        break :brk String.Builder.stringHash(input[0..at]);
                    }
                    workspace_range = Semver.Query.parse(allocator, input, sliced) catch null;
                }
                break :brk external_alias.hash;
            } else external_alias.hash,
            else => external_alias.hash,
        };

        var workspace_path: ?String = null;
        var workspace_version = workspace_ver;
        if (comptime tag == null) {
            workspace_path = lockfile.workspace_paths.get(name_hash);
            workspace_version = lockfile.workspace_versions.get(name_hash);

            if (workspace_path == null or workspace_version == null) {
                if (PackageManager.instance.workspaces.get(lockfile.str(&external_alias.value))) |_workspace_version| {
                    workspace_path = external_alias.value;
                    workspace_version = _workspace_version;
                }
            }
        }

        switch (dependency_version.tag) {
            .folder => {
                dependency_version.value.folder = string_builder.append(
                    String,
                    Path.relative(
                        FileSystem.instance.top_level_dir,
                        Path.joinAbsString(
                            FileSystem.instance.top_level_dir,
                            &[_]string{
                                source.path.name.dir,
                                dependency_version.value.folder.slice(buf),
                            },
                            .auto,
                        ),
                    ),
                );
            },
            .npm => if (comptime tag != null)
                unreachable
            else if (workspace_version) |ver| {
                if (dependency_version.value.npm.version.satisfies(ver, buf, buf)) {
                    for (package_dependencies[0..dependencies_count]) |dep| {
                        // `dependencies` & `workspaces` defined within the same `package.json`
                        if (dep.version.tag == .workspace and dep.name_hash == name_hash) {
                            return null;
                        }
                    }

                    const path = workspace_path.?.sliced(buf);
                    if (Dependency.parseWithTag(
                        allocator,
                        external_alias.value,
                        external_alias.hash,
                        path.slice,
                        .workspace,
                        &path,
                        log,
                    )) |dep| {
                        dependency_version = dep;
                    }
                }
            },
            .workspace => if (workspace_path) |path| {
                if (workspace_range) |range| {
                    if (workspace_version) |ver| {
                        if (range.satisfies(ver, buf, buf)) {
                            dependency_version.literal = path;
                            dependency_version.value.workspace = path;
                        }
                    }
                } else {
                    dependency_version.literal = path;
                    dependency_version.value.workspace = path;
                }
            } else {
                const workspace = dependency_version.value.workspace.slice(buf);
                const path = string_builder.append(String, if (strings.eqlComptime(workspace, "*")) "*" else brk: {
                    var buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
                    break :brk Path.relative(
                        FileSystem.instance.top_level_dir,
                        Path.joinAbsStringBuf(
                            FileSystem.instance.top_level_dir,
                            &buf2,
                            &[_]string{
                                source.path.name.dir,
                                workspace,
                            },
                            .auto,
                        ),
                    );
                });
                if (comptime Environment.allow_assert) {
                    std.debug.assert(path.len() > 0);
                    std.debug.assert(!std.fs.path.isAbsolute(path.slice(buf)));
                }
                dependency_version.literal = path;
                dependency_version.value.workspace = path;

                const workspace_entry = try lockfile.workspace_paths.getOrPut(allocator, name_hash);
                const found_matching_workspace = workspace_entry.found_existing or PackageManager.instance.workspaces.contains(lockfile.str(&external_alias.value));

                if (workspace_version) |ver| {
                    try lockfile.workspace_versions.put(allocator, name_hash, ver);
                    for (package_dependencies[0..dependencies_count]) |*package_dep| {
                        if (switch (package_dep.version.tag) {
                            // `dependencies` & `workspaces` defined within the same `package.json`
                            .npm => String.Builder.stringHash(package_dep.realname().slice(buf)) == name_hash and
                                package_dep.version.value.npm.version.satisfies(ver, buf, buf),
                            // `workspace:*`
                            .workspace => found_matching_workspace and
                                String.Builder.stringHash(package_dep.realname().slice(buf)) == name_hash,
                            else => false,
                        }) {
                            package_dep.version = dependency_version;
                            workspace_entry.value_ptr.* = path;
                            return null;
                        }
                    }
                } else if (workspace_entry.found_existing) {
                    for (package_dependencies[0..dependencies_count]) |*package_dep| {
                        if (package_dep.version.tag == .workspace and
                            String.Builder.stringHash(package_dep.realname().slice(buf)) == name_hash)
                        {
                            package_dep.version = dependency_version;
                            return null;
                        }
                    }
                    return error.InstallFailed;
                }

                workspace_entry.value_ptr.* = path;
            },
            else => {},
        }

        const this_dep = Dependency{
            .behavior = if (in_workspace) group.behavior.setWorkspace(in_workspace) else group.behavior,
            .name = external_alias.value,
            .name_hash = external_alias.hash,
            .version = dependency_version,
        };

        // `peerDependencies` may be specified on existing dependencies
        if (comptime features.check_for_duplicate_dependencies and !group.behavior.isPeer()) {
            const entry = lockfile.scratch.duplicate_checker_map.getOrPutAssumeCapacity(external_alias.hash);
            if (entry.found_existing) {
                // duplicate dependencies are allowed in optionalDependencies
                if (comptime group.behavior.isOptional()) {
                    for (package_dependencies[0..dependencies_count]) |*package_dep| {
                        if (package_dep.name_hash == this_dep.name_hash) {
                            package_dep.* = this_dep;
                            break;
                        }
                    }
                    return null;
                } else {
                    var notes = try allocator.alloc(logger.Data, 1);

                    notes[0] = .{
                        .text = try std.fmt.allocPrint(lockfile.allocator, "\"{s}\" originally specified here", .{external_alias.slice(buf)}),
                        .location = logger.Location.initOrNull(&source, source.rangeOfString(entry.value_ptr.*)),
                    };

                    try log.addRangeWarningFmtWithNotes(
                        &source,
                        source.rangeOfString(key_loc),
                        lockfile.allocator,
                        notes,
                        "Duplicate dependency: \"{s}\" specified in package.json",
                        .{external_alias.slice(buf)},
                    );
                }
            }

            entry.value_ptr.* = value_loc;
        }

        return this_dep;
    }

    pub const WorkspaceMap = struct {
        map: Map,

        const Map = bun.StringArrayHashMap(Entry);
        pub const Entry = struct {
            name: string,
            version: ?string,
            name_loc: logger.Loc,
        };

        pub fn init(allocator: std.mem.Allocator) WorkspaceMap {
            return .{
                .map = Map.init(allocator),
            };
        }

        pub fn keys(self: WorkspaceMap) []const string {
            return self.map.keys();
        }

        pub fn values(self: WorkspaceMap) []const Entry {
            return self.map.values();
        }

        pub fn count(self: WorkspaceMap) usize {
            return self.map.count();
        }

        pub fn insert(self: *WorkspaceMap, key: string, value: Entry) !void {
            const entry = try self.map.getOrPut(key);
            if (!entry.found_existing) {
                entry.key_ptr.* = try self.map.allocator.dupe(u8, key);
            } else {
                self.map.allocator.free(entry.value_ptr.name);
            }

            entry.value_ptr.* = .{
                .name = try self.map.allocator.dupe(u8, value.name),
                .version = value.version,
                .name_loc = value.name_loc,
            };
        }

        pub fn sort(self: *WorkspaceMap, sort_ctx: anytype) void {
            self.map.sort(sort_ctx);
        }

        pub fn deinit(self: *WorkspaceMap) void {
            for (self.map.values()) |value| {
                self.map.allocator.free(value.name);
            }

            for (self.map.keys()) |key| {
                self.map.allocator.free(key);
            }

            self.map.deinit();
        }
    };

    const WorkspaceEntry = struct {
        path: []const u8 = "",
        name: []const u8 = "",
        name_loc: logger.Loc = logger.Loc.Empty,
        version: ?[]const u8 = null,
    };

    fn processWorkspaceName(
        allocator: std.mem.Allocator,
        workspace_allocator: std.mem.Allocator,
        dir: std.fs.Dir,
        path: []const u8,
        path_buf: *[bun.MAX_PATH_BYTES]u8,
        name_to_copy: *[1024]u8,
        log: *logger.Log,
    ) !WorkspaceEntry {
        const path_to_use = if (path.len == 0) "package.json" else brk: {
            const paths = [_]string{ path, "package.json" };
            break :brk bun.path.joinStringBuf(path_buf, &paths, .auto);
        };

        // TODO: windows
        var workspace_file = dir.openFile(path_to_use, .{ .mode = .read_only }) catch |err| {
            debug("processWorkspaceName({s}) = {} ", .{ path_to_use, err });
            return err;
        };

        defer workspace_file.close();

        const workspace_bytes = try workspace_file.readToEndAlloc(workspace_allocator, std.math.maxInt(usize));
        defer workspace_allocator.free(workspace_bytes);
        const workspace_source = logger.Source.initPathString(path, workspace_bytes);

        var workspace_json = try json_parser.PackageJSONVersionChecker.init(allocator, &workspace_source, log);

        _ = try workspace_json.parseExpr();
        if (!workspace_json.has_found_name) {
            return error.MissingPackageName;
        }
        @memcpy(name_to_copy[0..workspace_json.found_name.len], workspace_json.found_name);
        var entry = WorkspaceEntry{
            .name = name_to_copy[0..workspace_json.found_name.len],
            .name_loc = workspace_json.name_loc,
            .path = path_to_use,
        };
        debug("processWorkspaceName({s}) = {s}", .{ path_to_use, entry.name });
        if (workspace_json.has_found_version) {
            entry.version = try allocator.dupe(u8, workspace_json.found_version);
        }
        return entry;
    }

    pub fn processWorkspaceNamesArray(
        workspace_names: *WorkspaceMap,
        allocator: Allocator,
        log: *logger.Log,
        arr: *JSAst.E.Array,
        source: *const logger.Source,
        loc: logger.Loc,
        string_builder: ?*StringBuilder,
    ) !u32 {
        if (arr.items.len == 0) return 0;

        var fallback = std.heap.stackFallback(1024, allocator);
        const workspace_allocator = fallback.get();
        const workspace_name_buf = allocator.create([1024]u8) catch unreachable;
        defer allocator.destroy(workspace_name_buf);

        const orig_msgs_len = log.msgs.items.len;

        var asterisked_workspace_paths = std.ArrayList(string).init(allocator);
        defer asterisked_workspace_paths.deinit();
        const filepath_buf = allocator.create([bun.MAX_PATH_BYTES]u8) catch unreachable;
        defer allocator.destroy(filepath_buf);

        for (arr.slice()) |item| {
            defer fallback.fixed_buffer_allocator.reset();
            var input_path = item.asString(allocator) orelse {
                log.addErrorFmt(source, item.loc, allocator,
                    \\Workspaces expects an array of strings, like:
                    \\  <r><green>"workspaces"<r>: [
                    \\    <green>"path/to/package"<r>
                    \\  ]
                , .{}) catch {};
                return error.InvalidPackageJSON;
            };

            if (strings.containsChar(input_path, '*')) {
                if (strings.contains(input_path, "**")) {
                    log.addError(source, item.loc,
                        \\TODO multi level globs. For now, try something like "packages/*"
                    ) catch {};
                    continue;
                }

                const without_trailing_slash = strings.withoutTrailingSlash(input_path);

                if (!strings.endsWithComptime(without_trailing_slash, "/*") and !strings.eqlComptime(without_trailing_slash, "*")) {
                    log.addError(source, item.loc,
                        \\TODO glob star * in the middle of a path. For now, try something like "packages/*", at the end of the path.
                    ) catch {};
                    continue;
                }

                asterisked_workspace_paths.append(without_trailing_slash) catch unreachable;
                continue;
            } else if (strings.containsAny(input_path, "!{}[]")) {
                log.addError(source, item.loc,
                    \\TODO fancy glob patterns. For now, try something like "packages/*"
                ) catch {};
                continue;
            } else if (string_builder == null) {
                input_path = Path.joinAbsStringBuf(source.path.name.dir, filepath_buf, &[_]string{input_path}, .auto);
            }

            const workspace_entry = processWorkspaceName(
                allocator,
                workspace_allocator,
                std.fs.cwd(),
                input_path,
                filepath_buf,
                workspace_name_buf,
                log,
            ) catch |err| {
                switch (err) {
                    error.FileNotFound => {
                        log.addErrorFmt(
                            source,
                            item.loc,
                            allocator,
                            "Workspace not found \"{s}\"",
                            .{input_path},
                        ) catch {};
                    },
                    error.MissingPackageName => {
                        log.addErrorFmt(
                            source,
                            loc,
                            allocator,
                            "Missing \"name\" from package.json in {s}",
                            .{input_path},
                        ) catch {};
                    },
                    else => {
                        log.addErrorFmt(
                            source,
                            item.loc,
                            allocator,
                            "{s} reading package.json for workspace package \"{s}\" from \"{s}\"",
                            .{ @errorName(err), input_path, bun.getcwd(allocator.alloc(u8, bun.MAX_PATH_BYTES) catch unreachable) catch unreachable },
                        ) catch {};
                    },
                }
                continue;
            };

            if (workspace_entry.name.len == 0) continue;

            if (string_builder) |builder| {
                builder.count(workspace_entry.name);
                builder.count(input_path);
                builder.cap += bun.MAX_PATH_BYTES;
                if (workspace_entry.version) |version_string| {
                    builder.count(version_string);
                }
            }

            try workspace_names.insert(input_path, .{
                .name = workspace_entry.name,
                .name_loc = workspace_entry.name_loc,
                .version = workspace_entry.version,
            });
        }

        if (asterisked_workspace_paths.items.len > 0) {
            // max path bytes is not enough in real codebases
            const second_buf = allocator.create([4096]u8) catch unreachable;
            var second_buf_fixed = std.heap.FixedBufferAllocator.init(second_buf);
            defer allocator.destroy(second_buf);

            for (asterisked_workspace_paths.items) |user_path| {
                var dir_prefix = if (string_builder) |_|
                    strings.withoutLeadingSlash(user_path)
                else
                    Path.joinAbsStringBuf(source.path.name.dir, filepath_buf, &[_]string{user_path}, .auto);

                dir_prefix = dir_prefix[0 .. strings.indexOfChar(dir_prefix, '*') orelse continue];
                if (dir_prefix.len == 0 or
                    strings.eqlComptime(dir_prefix, ".") or
                    strings.eqlComptime(dir_prefix, &.{ '.', std.fs.path.sep }))
                {
                    if (comptime Environment.isWindows)
                        dir_prefix = Fs.FileSystem.instance.top_level_dir
                    else
                        dir_prefix = ".";
                }

                const entries_option = FileSystem.instance.fs.readDirectory(
                    dir_prefix,
                    null,
                    0,
                    true,
                ) catch |err| switch (err) {
                    error.ENOENT => {
                        log.addWarningFmt(
                            source,
                            loc,
                            allocator,
                            "workspaces directory prefix not found \"{s}\"",
                            .{dir_prefix},
                        ) catch {};
                        continue;
                    },
                    error.ENOTDIR => {
                        log.addWarningFmt(
                            source,
                            loc,
                            allocator,
                            "workspaces directory prefix is not a directory \"{s}\"",
                            .{dir_prefix},
                        ) catch {};
                        continue;
                    },
                    else => continue,
                };
                if (entries_option.* != .entries) continue;
                var entries = entries_option.entries.data.iterator();
                const skipped_names = &[_][]const u8{ "node_modules", ".git" };

                while (entries.next()) |entry_iter| {
                    const name = entry_iter.key_ptr.*;
                    if (strings.eqlAnyComptime(name, skipped_names))
                        continue;
                    var entry: *FileSystem.Entry = entry_iter.value_ptr.*;
                    if (entry.kind(&Fs.FileSystem.instance.fs, true) != .dir) continue;

                    var parts = [2]string{ entry.dir, entry.base() };
                    const entry_path = Path.joinAbsStringBufZ(
                        Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(),
                        filepath_buf,
                        &parts,
                        .auto,
                    );

                    if (entry.cache.fd == .zero) {
                        entry.cache.fd = bun.toFD(bun.sys.open(
                            entry_path,
                            std.os.O.DIRECTORY | std.os.O.CLOEXEC | std.os.O.NOCTTY | std.os.O.RDONLY,
                            0,
                        ).unwrap() catch continue);
                    }

                    const dir_fd = entry.cache.fd;
                    std.debug.assert(dir_fd != bun.invalid_fd); // kind() should've opened
                    defer fallback.fixed_buffer_allocator.reset();

                    const workspace_entry = processWorkspaceName(
                        allocator,
                        workspace_allocator,
                        dir_fd.asDir(),
                        "",
                        filepath_buf,
                        workspace_name_buf,
                        log,
                    ) catch |err| {
                        switch (err) {
                            error.FileNotFound, error.PermissionDenied => continue,
                            error.MissingPackageName => {
                                log.addErrorFmt(
                                    source,
                                    logger.Loc.Empty,
                                    allocator,
                                    "Missing \"name\" from package.json in {s}" ++ std.fs.path.sep_str ++ "{s}",
                                    .{ entry.dir, entry.base() },
                                ) catch {};
                            },
                            else => {
                                log.addErrorFmt(
                                    source,
                                    logger.Loc.Empty,
                                    allocator,
                                    "{s} reading package.json for workspace package \"{s}\" from \"{s}\"",
                                    .{ @errorName(err), entry.dir, entry.base() },
                                ) catch {};
                            },
                        }

                        continue;
                    };

                    if (workspace_entry.name.len == 0) continue;

                    const workspace_path: string = if (string_builder) |builder| brk: {
                        second_buf_fixed.reset();
                        const relative = std.fs.path.relative(
                            second_buf_fixed.allocator(),
                            Fs.FileSystem.instance.top_level_dir,
                            bun.span(entry_path),
                        ) catch unreachable;
                        builder.count(workspace_entry.name);
                        builder.count(relative);
                        builder.cap += bun.MAX_PATH_BYTES;
                        break :brk relative;
                    } else bun.span(entry_path);

                    try workspace_names.insert(workspace_path, .{
                        .name = workspace_entry.name,
                        .version = workspace_entry.version,
                        .name_loc = workspace_entry.name_loc,
                    });
                }
            }
        }

        if (orig_msgs_len != log.msgs.items.len) return error.InstallFailed;

        // Sort the names for determinism
        workspace_names.sort(struct {
            values: []const WorkspaceMap.Entry,
            pub fn lessThan(
                self: @This(),
                a: usize,
                b: usize,
            ) bool {
                return strings.order(self.values[a].name, self.values[b].name) == .lt;
            }
        }{
            .values = workspace_names.values(),
        });

        return @as(u32, @truncate(workspace_names.count()));
    }

    fn parseWithJSON(
        package: *Lockfile.Package,
        lockfile: *Lockfile,
        allocator: Allocator,
        log: *logger.Log,
        source: logger.Source,
        json: Expr,
        comptime ResolverContext: type,
        resolver: ResolverContext,
        comptime features: Features,
    ) !void {
        var string_builder = lockfile.stringBuilder();
        var total_dependencies_count: u32 = 0;

        package.meta.origin = if (features.is_main) .local else .npm;
        package.name = String{};
        package.name_hash = 0;

        // -- Count the sizes
        if (json.asProperty("name")) |name_q| {
            if (name_q.expr.asString(allocator)) |name| {
                string_builder.count(name);
            }
        }

        if (comptime !features.is_main) {
            if (json.asProperty("version")) |version_q| {
                if (version_q.expr.asString(allocator)) |version_str| {
                    string_builder.count(version_str);
                }
            }
        }
        bin: {
            if (json.asProperty("bin")) |bin| {
                switch (bin.expr.data) {
                    .e_object => |obj| {
                        for (obj.properties.slice()) |bin_prop| {
                            string_builder.count(bin_prop.key.?.asString(allocator) orelse break :bin);
                            string_builder.count(bin_prop.value.?.asString(allocator) orelse break :bin);
                        }
                        break :bin;
                    },
                    .e_string => {
                        if (bin.expr.asString(allocator)) |str_| {
                            string_builder.count(str_);
                            break :bin;
                        }
                    },
                    else => {},
                }
            }

            if (json.asProperty("directories")) |dirs| {
                if (dirs.expr.asProperty("bin")) |bin_prop| {
                    if (bin_prop.expr.asString(allocator)) |str_| {
                        string_builder.count(str_);
                        break :bin;
                    }
                }
            }
        }

        Package.Scripts.parseCount(allocator, &string_builder, json);

        if (comptime ResolverContext != void) {
            resolver.count(*Lockfile.StringBuilder, &string_builder, json);
        }

        const dependency_groups = comptime brk: {
            var out_groups: [
                @as(usize, @intFromBool(features.dependencies)) +
                    @as(usize, @intFromBool(features.dev_dependencies)) +
                    @as(usize, @intFromBool(features.optional_dependencies)) +
                    @as(usize, @intFromBool(features.peer_dependencies)) +
                    @as(usize, @intFromBool(features.workspaces))
            ]DependencyGroup = undefined;
            var out_group_i: usize = 0;

            if (features.dependencies) {
                out_groups[out_group_i] = DependencyGroup.dependencies;
                out_group_i += 1;
            }

            if (features.dev_dependencies) {
                out_groups[out_group_i] = DependencyGroup.dev;
                out_group_i += 1;
            }
            if (features.optional_dependencies) {
                out_groups[out_group_i] = DependencyGroup.optional;
                out_group_i += 1;
            }

            if (features.peer_dependencies) {
                out_groups[out_group_i] = DependencyGroup.peer;
                out_group_i += 1;
            }

            if (features.workspaces) {
                out_groups[out_group_i] = DependencyGroup.workspaces;
                out_group_i += 1;
            }

            break :brk out_groups;
        };

        var workspace_names = WorkspaceMap.init(allocator);
        defer workspace_names.deinit();

        var optional_peer_dependencies = std.ArrayHashMap(PackageNameHash, void, ArrayIdentityContext.U64, false).init(allocator);
        defer optional_peer_dependencies.deinit();

        if (json.asProperty("peerDependenciesMeta")) |peer_dependencies_meta| {
            if (peer_dependencies_meta.expr.data == .e_object) {
                const props = peer_dependencies_meta.expr.data.e_object.properties.slice();
                try optional_peer_dependencies.ensureUnusedCapacity(props.len);
                for (props) |prop| {
                    if (prop.value.?.asProperty("optional")) |optional| {
                        if (optional.expr.data != .e_boolean or !optional.expr.data.e_boolean.value) {
                            continue;
                        }

                        optional_peer_dependencies.putAssumeCapacity(
                            String.Builder.stringHash(prop.key.?.asString(allocator) orelse unreachable),
                            {},
                        );
                    }
                }
            }
        }

        inline for (dependency_groups) |group| {
            if (json.asProperty(group.prop)) |dependencies_q| brk: {
                switch (dependencies_q.expr.data) {
                    .e_array => |arr| {
                        if (!group.behavior.isWorkspace()) {
                            log.addErrorFmt(&source, dependencies_q.loc, allocator,
                                \\{0s} expects a map of specifiers, e.g.
                                \\  <r><green>"{0s}"<r>: {{
                                \\    <green>"bun"<r>: <green>"latest"<r>
                                \\  }}
                            , .{group.prop}) catch {};
                            return error.InvalidPackageJSON;
                        }
                        total_dependencies_count += try processWorkspaceNamesArray(
                            &workspace_names,
                            allocator,
                            log,
                            arr,
                            &source,
                            dependencies_q.loc,
                            &string_builder,
                        );
                    },
                    .e_object => |obj| {
                        if (group.behavior.isWorkspace()) {

                            // yarn workspaces expects a "workspaces" property shaped like this:
                            //
                            //    "workspaces": {
                            //        "packages": [
                            //           "path/to/package"
                            //        ]
                            //    }
                            //
                            if (obj.get("packages")) |packages_query| {
                                if (packages_query.data == .e_array) {
                                    total_dependencies_count += try processWorkspaceNamesArray(
                                        &workspace_names,
                                        allocator,
                                        log,
                                        packages_query.data.e_array,
                                        &source,
                                        packages_query.loc,
                                        &string_builder,
                                    );
                                    break :brk;
                                }
                            }

                            log.addErrorFmt(&source, dependencies_q.loc, allocator,
                            // TODO: what if we could comptime call the syntax highlighter
                                \\Workspaces expects an array of strings, e.g.
                                \\  <r><green>"workspaces"<r>: [
                                \\    <green>"path/to/package"<r>
                                \\  ]
                            , .{}) catch {};
                            return error.InvalidPackageJSON;
                        }
                        for (obj.properties.slice()) |item| {
                            const key = item.key.?.asString(allocator).?;
                            const value = item.value.?.asString(allocator) orelse {
                                log.addErrorFmt(&source, item.value.?.loc, allocator,
                                // TODO: what if we could comptime call the syntax highlighter
                                    \\{0s} expects a map of specifiers, e.g.
                                    \\  <r><green>"{0s}"<r>: {{
                                    \\    <green>"bun"<r>: <green>"latest"<r>
                                    \\  }}
                                , .{group.prop}) catch {};
                                return error.InvalidPackageJSON;
                            };

                            string_builder.count(key);
                            string_builder.count(value);

                            // If it's a folder or workspace, pessimistically assume we will need a maximum path
                            switch (Dependency.Version.Tag.infer(value)) {
                                .folder, .workspace => string_builder.cap += bun.MAX_PATH_BYTES,
                                else => {},
                            }
                        }
                        total_dependencies_count += @as(u32, @truncate(obj.properties.len));
                    },
                    else => {
                        if (group.behavior.isWorkspace()) {
                            log.addErrorFmt(&source, dependencies_q.loc, allocator,
                            // TODO: what if we could comptime call the syntax highlighter
                                \\Workspaces expects an array of strings, e.g.
                                \\  <r><green>"workspaces"<r>: [
                                \\    <green>"path/to/package"<r>
                                \\  ]
                            , .{}) catch {};
                        } else {
                            log.addErrorFmt(&source, dependencies_q.loc, allocator,
                                \\{0s} expects a map of specifiers, e.g.
                                \\  <r><green>"{0s}"<r>: {{
                                \\    <green>"bun"<r>: <green>"latest"<r>
                                \\  }}
                            , .{group.prop}) catch {};
                        }
                        return error.InvalidPackageJSON;
                    },
                }
            }
        }

        if (comptime features.trusted_dependencies) {
            if (json.asProperty("trustedDependencies")) |q| {
                switch (q.expr.data) {
                    .e_array => |arr| {
                        try lockfile.trusted_dependencies.ensureUnusedCapacity(allocator, arr.items.len);
                        for (arr.slice()) |item| {
                            const name = item.asString(allocator) orelse {
                                log.addErrorFmt(&source, q.loc, allocator,
                                    \\trustedDependencies expects an array of strings, e.g.
                                    \\  <r><green>"trustedDependencies"<r>: [
                                    \\    <green>"package_name"<r>
                                    \\  ]
                                , .{}) catch {};
                                return error.InvalidPackageJSON;
                            };
                            lockfile.trusted_dependencies.putAssumeCapacity(@as(u32, @truncate(String.Builder.stringHash(name))), {});
                        }
                    },
                    else => {
                        log.addErrorFmt(&source, q.loc, allocator,
                            \\trustedDependencies expects an array of strings, e.g.
                            \\  <r><green>"trustedDependencies"<r>: [
                            \\    <green>"package_name"<r>
                            \\  ]
                        , .{}) catch {};
                        return error.InvalidPackageJSON;
                    },
                }
            }
        }

        if (comptime features.is_main) {
            lockfile.overrides.parseCount(lockfile, json, &string_builder);
        }

        try string_builder.allocate();
        try lockfile.buffers.dependencies.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
        try lockfile.buffers.resolutions.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);

        const off = lockfile.buffers.dependencies.items.len;
        const total_len = off + total_dependencies_count;
        if (comptime Environment.allow_assert) std.debug.assert(lockfile.buffers.dependencies.items.len == lockfile.buffers.resolutions.items.len);

        const package_dependencies = lockfile.buffers.dependencies.items.ptr[off..total_len];

        if (json.asProperty("name")) |name_q| {
            if (name_q.expr.asString(allocator)) |name| {
                const external_string = string_builder.append(ExternalString, name);

                package.name = external_string.value;
                package.name_hash = external_string.hash;
            }
        }

        if (comptime !features.is_main) {
            if (comptime ResolverContext != void) {
                package.resolution = try resolver.resolve(
                    *Lockfile.StringBuilder,
                    &string_builder,
                    json,
                );
            }
        } else {
            package.resolution = .{
                .tag = .root,
                .value = .{ .root = {} },
            };
        }

        bin: {
            if (json.asProperty("bin")) |bin| {
                switch (bin.expr.data) {
                    .e_object => |obj| {
                        switch (obj.properties.len) {
                            0 => {},
                            1 => {
                                const bin_name = obj.properties.ptr[0].key.?.asString(allocator) orelse break :bin;
                                const value = obj.properties.ptr[0].value.?.asString(allocator) orelse break :bin;

                                package.bin = .{
                                    .tag = .named_file,
                                    .value = .{
                                        .named_file = .{
                                            string_builder.append(String, bin_name),
                                            string_builder.append(String, value),
                                        },
                                    },
                                };
                            },
                            else => {
                                const current_len = lockfile.buffers.extern_strings.items.len;
                                const count = @as(usize, obj.properties.len * 2);
                                try lockfile.buffers.extern_strings.ensureTotalCapacityPrecise(
                                    lockfile.allocator,
                                    current_len + count,
                                );
                                var extern_strings = lockfile.buffers.extern_strings.items.ptr[current_len .. current_len + count];
                                lockfile.buffers.extern_strings.items.len += count;

                                var i: usize = 0;
                                for (obj.properties.slice()) |bin_prop| {
                                    extern_strings[i] = string_builder.append(ExternalString, bin_prop.key.?.asString(allocator) orelse break :bin);
                                    i += 1;
                                    extern_strings[i] = string_builder.append(ExternalString, bin_prop.value.?.asString(allocator) orelse break :bin);
                                    i += 1;
                                }
                                if (comptime Environment.allow_assert) std.debug.assert(i == extern_strings.len);
                                package.bin = .{
                                    .tag = .map,
                                    .value = .{ .map = ExternalStringList.init(lockfile.buffers.extern_strings.items, extern_strings) },
                                };
                            },
                        }

                        break :bin;
                    },
                    .e_string => |stri| {
                        if (stri.data.len > 0) {
                            package.bin = .{
                                .tag = .file,
                                .value = .{
                                    .file = string_builder.append(String, stri.data),
                                },
                            };
                            break :bin;
                        }
                    },
                    else => {},
                }
            }

            if (json.asProperty("directories")) |dirs| {
                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#directoriesbin
                // Because of the way the bin directive works,
                // specifying both a bin path and setting
                // directories.bin is an error. If you want to
                // specify individual files, use bin, and for all
                // the files in an existing bin directory, use
                // directories.bin.
                if (dirs.expr.asProperty("bin")) |bin_prop| {
                    if (bin_prop.expr.asString(allocator)) |str_| {
                        if (str_.len > 0) {
                            package.bin = .{
                                .tag = .dir,
                                .value = .{
                                    .dir = string_builder.append(String, str_),
                                },
                            };
                            break :bin;
                        }
                    }
                }
            }
        }

        package.scripts.parseAlloc(allocator, &string_builder, json);
        package.scripts.filled = true;

        // It is allowed for duplicate dependencies to exist in optionalDependencies and regular dependencies
        if (comptime features.check_for_duplicate_dependencies) {
            lockfile.scratch.duplicate_checker_map.clearRetainingCapacity();
            try lockfile.scratch.duplicate_checker_map.ensureTotalCapacity(total_dependencies_count);
        }

        total_dependencies_count = 0;
        const in_workspace = lockfile.workspace_paths.contains(@as(u32, @truncate(package.name_hash)));

        inline for (dependency_groups) |group| {
            if (group.behavior.isWorkspace()) {
                var seen_workspace_names = NameHashSet{};
                defer seen_workspace_names.deinit(allocator);
                for (workspace_names.values(), workspace_names.keys()) |entry, path| {

                    // workspace names from their package jsons. duplicates not allowed
                    const gop = try seen_workspace_names.getOrPut(allocator, @truncate(String.Builder.stringHash(entry.name)));
                    if (gop.found_existing) {
                        // this path does alot of extra work to format the error message
                        // but this is ok because the install is going to fail anyways, so this
                        // has zero effect on the happy path.
                        var cwd_buf: bun.PathBuffer = undefined;
                        const cwd = try bun.getcwd(&cwd_buf);

                        const num_notes = count: {
                            var i: usize = 0;
                            for (workspace_names.values()) |value| {
                                if (strings.eql(value.name, entry.name))
                                    i += 1;
                            }
                            break :count i;
                        };
                        const notes = notes: {
                            var notes = try allocator.alloc(logger.Data, num_notes);
                            var i: usize = 0;
                            for (workspace_names.values(), workspace_names.keys()) |value, note_path| {
                                if (note_path.ptr == path.ptr) continue;
                                if (strings.eql(value.name, entry.name)) {
                                    const note_abs_path = allocator.dupeZ(u8, Path.joinAbsStringZ(cwd, &.{ note_path, "package.json" }, .auto)) catch bun.outOfMemory();

                                    const note_src = src: {
                                        var workspace_file = std.fs.openFileAbsoluteZ(note_abs_path, .{ .mode = .read_only }) catch {
                                            break :src logger.Source.initEmptyFile(note_abs_path);
                                        };
                                        defer workspace_file.close();

                                        // TODO: when are these bytes supposed to be freed?
                                        const workspace_bytes = try workspace_file.readToEndAlloc(allocator, std.math.maxInt(usize));
                                        // defer allocator.free(workspace_bytes);
                                        break :src logger.Source.initPathString(note_abs_path, workspace_bytes);
                                    };

                                    notes[i] = .{
                                        .text = "Package name is also declared here",
                                        .location = logger.Location.initOrNull(&note_src, note_src.rangeOfString(value.name_loc)),
                                    };
                                    i += 1;
                                }
                            }
                            break :notes notes[0..i];
                        };

                        const abs_path = Path.joinAbsStringZ(cwd, &.{ path, "package.json" }, .auto);

                        const src = src: {
                            var workspace_file = std.fs.openFileAbsoluteZ(abs_path, .{ .mode = .read_only }) catch {
                                break :src logger.Source.initEmptyFile(abs_path);
                            };
                            defer workspace_file.close();

                            // TODO: when are these bytes supposed to be freed?
                            const workspace_bytes = try workspace_file.readToEndAlloc(allocator, std.math.maxInt(usize));
                            // defer allocator.free(workspace_bytes);
                            break :src logger.Source.initPathString(abs_path, workspace_bytes);
                        };

                        log.addRangeErrorFmtWithNotes(
                            &src,
                            src.rangeOfString(entry.name_loc),
                            allocator,
                            notes,
                            "Workspace name \"{s}\" already exists",
                            .{
                                entry.name,
                            },
                        ) catch {};
                        return error.InstallFailed;
                    }

                    const external_name = string_builder.append(ExternalString, entry.name);

                    const workspace_version = brk: {
                        if (entry.version) |version_string| {
                            const external_version = string_builder.append(ExternalString, version_string);
                            allocator.free(version_string);
                            const sliced = external_version.value.sliced(lockfile.buffers.string_bytes.items);
                            const result = Semver.Version.parse(sliced);
                            if (result.valid and result.wildcard == .none) {
                                break :brk result.version.min();
                            }
                        }

                        break :brk null;
                    };

                    if (try parseDependency(
                        lockfile,
                        allocator,
                        log,
                        source,
                        group,
                        &string_builder,
                        features,
                        package_dependencies,
                        total_dependencies_count,
                        in_workspace,
                        .workspace,
                        workspace_version,
                        external_name,
                        path,
                        logger.Loc.Empty,
                        logger.Loc.Empty,
                    )) |_dep| {
                        var dep = _dep;
                        if (group.behavior.isPeer() and optional_peer_dependencies.contains(external_name.hash)) {
                            dep.behavior = dep.behavior.setOptional(true);
                        }

                        package_dependencies[total_dependencies_count] = dep;
                        total_dependencies_count += 1;

                        try lockfile.workspace_paths.put(allocator, external_name.hash, dep.version.value.workspace);
                        if (workspace_version) |version| {
                            try lockfile.workspace_versions.put(allocator, external_name.hash, version);
                        }
                    }
                }
            } else {
                if (json.asProperty(group.prop)) |dependencies_q| {
                    switch (dependencies_q.expr.data) {
                        .e_object => |obj| {
                            for (obj.properties.slice()) |item| {
                                const key = item.key.?;
                                const value = item.value.?;
                                const external_name = string_builder.append(ExternalString, key.asString(allocator).?);
                                const version = value.asString(allocator) orelse "";

                                if (try parseDependency(
                                    lockfile,
                                    allocator,
                                    log,
                                    source,
                                    group,
                                    &string_builder,
                                    features,
                                    package_dependencies,
                                    total_dependencies_count,
                                    in_workspace,
                                    null,
                                    null,
                                    external_name,
                                    version,
                                    key.loc,
                                    value.loc,
                                )) |_dep| {
                                    var dep = _dep;
                                    if (group.behavior.isPeer() and optional_peer_dependencies.contains(external_name.hash)) {
                                        dep.behavior = dep.behavior.setOptional(true);
                                    }

                                    package_dependencies[total_dependencies_count] = dep;
                                    total_dependencies_count += 1;
                                }
                            }
                        },
                        else => unreachable,
                    }
                }
            }
        }

        std.sort.pdq(
            Dependency,
            package_dependencies[0..total_dependencies_count],
            lockfile.buffers.string_bytes.items,
            Dependency.isLessThan,
        );

        package.dependencies.off = @as(u32, @truncate(off));
        package.dependencies.len = @as(u32, @truncate(total_dependencies_count));

        package.resolutions = @as(@TypeOf(package.resolutions), @bitCast(package.dependencies));

        @memset(lockfile.buffers.resolutions.items.ptr[off..total_len], invalid_package_id);

        const new_len = off + total_dependencies_count;
        lockfile.buffers.dependencies.items = lockfile.buffers.dependencies.items.ptr[0..new_len];
        lockfile.buffers.resolutions.items = lockfile.buffers.resolutions.items.ptr[0..new_len];

        // This function depends on package.dependencies being set, so it is done at the very end.
        if (comptime features.is_main) {
            try lockfile.overrides.parseAppend(lockfile, package, log, source, json, &string_builder);
        }

        string_builder.clamp();
    }

    pub const List = bun.MultiArrayList(Lockfile.Package);

    pub const Meta = extern struct {
        // TODO: when we bump the lockfile version, we should reorder this to:
        // id(32), arch(16), os(16), id(8), man_dir(8), integrity(72 align 8)
        // should allow us to remove padding bytes

        // TODO: remove origin. it doesnt do anything and can be inferred from the resolution
        origin: Origin = Origin.npm,
        _padding_origin: u8 = 0,

        arch: Npm.Architecture = Npm.Architecture.all,
        os: Npm.OperatingSystem = Npm.OperatingSystem.all,
        _padding_os: u16 = 0,

        id: PackageID = invalid_package_id,

        man_dir: String = String{},
        integrity: Integrity = Integrity{},
        _padding_integrity: [3]u8 = .{0} ** 3,

        /// Does the `cpu` arch and `os` match the requirements listed in the package?
        /// This is completely unrelated to "devDependencies", "peerDependencies", "optionalDependencies" etc
        pub fn isDisabled(this: *const Meta) bool {
            return !this.arch.isMatch() or !this.os.isMatch();
        }

        pub fn count(this: *const Meta, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) void {
            builder.count(this.man_dir.slice(buf));
        }

        pub fn clone(this: *const Meta, id: PackageID, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) Meta {
            return Meta{
                .id = id,
                .man_dir = builder.append(String, this.man_dir.slice(buf)),
                .integrity = this.integrity,
                .arch = this.arch,
                .os = this.os,
                .origin = this.origin,
            };
        }
    };

    pub const Serializer = struct {
        pub const sizes = blk: {
            const fields = std.meta.fields(Lockfile.Package);
            const Data = struct {
                size: usize,
                size_index: usize,
                alignment: usize,
                Type: type,
            };
            var data: [fields.len]Data = undefined;
            for (fields, &data, 0..) |field_info, *elem, i| {
                elem.* = .{
                    .size = @sizeOf(field_info.type),
                    .size_index = i,
                    .Type = field_info.type,
                    .alignment = if (@sizeOf(field_info.type) == 0) 1 else field_info.alignment,
                };
            }
            const SortContext = struct {
                data: []Data,
                pub fn swap(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) void {
                    const tmp = ctx.data[lhs];
                    ctx.data[lhs] = ctx.data[rhs];
                    ctx.data[rhs] = tmp;
                }
                pub fn lessThan(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) bool {
                    return ctx.data[lhs].alignment > ctx.data[rhs].alignment;
                }
            };
            std.sort.insertionContext(0, fields.len, SortContext{
                .data = &data,
            });
            var sizes_bytes: [fields.len]usize = undefined;
            var field_indexes: [fields.len]usize = undefined;
            var Types: [fields.len]type = undefined;
            for (data, &sizes_bytes, &field_indexes, &Types) |elem, *size, *index, *Type| {
                size.* = elem.size;
                index.* = elem.size_index;
                Type.* = elem.Type;
            }
            break :blk .{
                .bytes = sizes_bytes,
                .fields = field_indexes,
                .Types = Types,
            };
        };

        const FieldsEnum = @typeInfo(Lockfile.Package.List.Field).Enum;

        pub fn byteSize(list: Lockfile.Package.List) usize {
            const sizes_vector: std.meta.Vector(sizes.bytes.len, usize) = sizes.bytes;
            const capacity_vector: @Vector(sizes.bytes.len, usize) = @splat(list.len);
            return @reduce(.Add, capacity_vector * sizes_vector);
        }

        const AlignmentType = sizes.Types[sizes.fields[0]];

        pub fn save(list: Lockfile.Package.List, comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer) !void {
            try writer.writeInt(u64, list.len, .little);
            try writer.writeInt(u64, @alignOf(@TypeOf(list.bytes)), .little);
            try writer.writeInt(u64, sizes.Types.len, .little);
            const begin_at = try stream.getPos();
            try writer.writeInt(u64, 0, .little);
            const end_at = try stream.getPos();
            try writer.writeInt(u64, 0, .little);

            _ = try Aligner.write(@TypeOf(list.bytes), Writer, writer, try stream.getPos());

            const really_begin_at = try stream.getPos();
            var sliced = list.slice();

            inline for (FieldsEnum.fields) |field| {
                const value = sliced.items(@field(Lockfile.Package.List.Field, field.name));
                if (comptime Environment.allow_assert)
                    debug("save(\"{s}\") = {d} bytes", .{ field.name, std.mem.sliceAsBytes(value).len });

                comptime assertNoUninitializedPadding(@TypeOf(value));
                try writer.writeAll(std.mem.sliceAsBytes(value));
            }

            const really_end_at = try stream.getPos();

            _ = stream.pwrite(std.mem.asBytes(&really_begin_at), begin_at);
            _ = stream.pwrite(std.mem.asBytes(&really_end_at), end_at);
        }

        pub fn load(
            stream: *Stream,
            end: usize,
            allocator: Allocator,
        ) !Lockfile.Package.List {
            var reader = stream.reader();

            const list_len = try reader.readInt(u64, .little);
            if (list_len > std.math.maxInt(u32) - 1)
                return error.@"Lockfile validation failed: list is impossibly long";

            const input_alignment = try reader.readInt(u64, .little);

            var list = Lockfile.Package.List{};
            const Alingee = @TypeOf(list.bytes);
            const expected_alignment = @alignOf(Alingee);
            if (expected_alignment != input_alignment) {
                return error.@"Lockfile validation failed: alignment mismatch";
            }

            const field_count = try reader.readInt(u64, .little);
            switch (field_count) {
                sizes.Types.len => {},
                // "scripts" field is absent before v0.6.8
                // we will back-fill from each package.json
                sizes.Types.len - 1 => {},
                else => {
                    return error.@"Lockfile validation failed: unexpected number of package fields";
                },
            }

            const begin_at = try reader.readInt(u64, .little);
            const end_at = try reader.readInt(u64, .little);
            if (begin_at > end or end_at > end or begin_at > end_at) {
                return error.@"Lockfile validation failed: invalid package list range";
            }
            stream.pos = begin_at;
            try list.ensureTotalCapacity(allocator, list_len);
            list.len = list_len;
            var sliced = list.slice();

            inline for (FieldsEnum.fields) |field| {
                const value = sliced.items(@field(Lockfile.Package.List.Field, field.name));

                comptime assertNoUninitializedPadding(@TypeOf(value));
                const bytes = std.mem.sliceAsBytes(value);
                const end_pos = stream.pos + bytes.len;
                if (end_pos <= end_at) {
                    @memcpy(bytes, stream.buffer[stream.pos..][0..bytes.len]);
                    stream.pos = end_pos;
                } else if (comptime strings.eqlComptime(field.name, "scripts")) {
                    @memset(bytes, 0);
                } else {
                    return error.@"Lockfile validation failed: invalid package list range";
                }
            }

            return list;
        }
    };
};

pub fn deinit(this: *Lockfile) void {
    this.buffers.deinit(this.allocator);
    this.packages.deinit(this.allocator);
    this.string_pool.deinit();
    this.scripts.deinit(this.allocator);
    this.trusted_dependencies.deinit(this.allocator);
    this.workspace_paths.deinit(this.allocator);
    this.workspace_versions.deinit(this.allocator);
    this.overrides.deinit(this.allocator);
}

const Buffers = struct {
    trees: Tree.List = .{},
    hoisted_dependencies: DependencyIDList = .{},
    /// This is the underlying buffer used for the `resolutions` external slices inside of `Package`
    /// Should be the same length as `dependencies`
    resolutions: PackageIDList = .{},
    /// This is the underlying buffer used for the `dependencies` external slices inside of `Package`
    dependencies: DependencyList = .{},
    /// This is the underlying buffer used for any `Semver.ExternalString` instance in the lockfile
    extern_strings: ExternalStringBuffer = .{},
    /// This is where all non-inlinable `Semver.String`s are stored.
    string_bytes: StringBuffer = .{},

    pub fn deinit(this: *Buffers, allocator: Allocator) void {
        this.trees.deinit(allocator);
        this.resolutions.deinit(allocator);
        this.dependencies.deinit(allocator);
        this.extern_strings.deinit(allocator);
        this.string_bytes.deinit(allocator);
    }

    pub fn preallocate(this: *Buffers, that: Buffers, allocator: Allocator) !void {
        try this.trees.ensureTotalCapacity(allocator, that.trees.items.len);
        try this.resolutions.ensureTotalCapacity(allocator, that.resolutions.items.len);
        try this.dependencies.ensureTotalCapacity(allocator, that.dependencies.items.len);
        try this.extern_strings.ensureTotalCapacity(allocator, that.extern_strings.items.len);
        try this.string_bytes.ensureTotalCapacity(allocator, that.string_bytes.items.len);
    }

    const sizes = blk: {
        const fields = std.meta.fields(Lockfile.Buffers);
        const Data = struct {
            size: usize,
            name: []const u8,
            type: type,
            alignment: usize,
        };
        var data: [fields.len]Data = undefined;
        for (fields, &data) |field_info, *elem| {
            elem.* = .{
                .size = @sizeOf(field_info.type),
                .name = field_info.name,
                .alignment = if (@sizeOf(field_info.type) == 0) 1 else field_info.alignment,
                .type = field_info.type.Slice,
            };
        }

        const SortContext = struct {
            data: []Data,
            pub fn swap(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) void {
                const tmp = ctx.data[lhs];
                ctx.data[lhs] = ctx.data[rhs];
                ctx.data[rhs] = tmp;
            }
            pub fn lessThan(comptime ctx: @This(), comptime lhs: usize, comptime rhs: usize) bool {
                return ctx.data[lhs].alignment > ctx.data[rhs].alignment;
            }
        };

        std.sort.insertionContext(0, fields.len, SortContext{
            .data = &data,
        });
        var sizes_bytes: [fields.len]usize = undefined;
        var names: [fields.len][]const u8 = undefined;
        var types: [fields.len]type = undefined;
        for (data, &sizes_bytes, &names, &types) |elem, *size, *name, *Type| {
            size.* = elem.size;
            name.* = elem.name;
            Type.* = elem.type;
        }
        break :blk .{
            .bytes = sizes_bytes,
            .names = names,
            .types = types,
        };
    };

    pub fn readArray(stream: *Stream, allocator: Allocator, comptime ArrayList: type) !ArrayList {
        const arraylist: ArrayList = undefined;

        const PointerType = std.meta.Child(@TypeOf(arraylist.items.ptr));

        var reader = stream.reader();
        const start_pos = try reader.readInt(u64, .little);
        const end_pos = try reader.readInt(u64, .little);

        stream.pos = end_pos;
        const byte_len = end_pos - start_pos;

        if (byte_len == 0) return ArrayList{
            .items = &[_]PointerType{},
            .capacity = 0,
        };

        if (stream.pos > stream.buffer.len) {
            return error.BufferOverflow;
        }

        const misaligned = std.mem.bytesAsSlice(PointerType, stream.buffer[start_pos..end_pos]);

        return ArrayList{
            .items = try allocator.dupe(PointerType, @as([*]PointerType, @alignCast(misaligned.ptr))[0..misaligned.len]),
            .capacity = misaligned.len,
        };
    }

    pub fn writeArray(comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer, comptime ArrayList: type, array: ArrayList) !void {
        comptime assertNoUninitializedPadding(@TypeOf(array));
        const bytes = std.mem.sliceAsBytes(array);

        const start_pos = try stream.getPos();
        try writer.writeInt(u64, 0xDEADBEEF, .little);
        try writer.writeInt(u64, 0xDEADBEEF, .little);

        const prefix = comptime std.fmt.comptimePrint(
            "\n<{s}> {d} sizeof, {d} alignof\n",
            .{
                @typeName(std.meta.Child(ArrayList)),
                @sizeOf(std.meta.Child(ArrayList)),
                @alignOf(std.meta.Child(ArrayList)),
            },
        );
        try writer.writeAll(prefix);

        if (bytes.len > 0) {
            _ = try Aligner.write(sizes.types[0], Writer, writer, try stream.getPos());

            const real_start_pos = try stream.getPos();
            try writer.writeAll(bytes);
            const real_end_pos = try stream.getPos();
            const positioned = [2]u64{ real_start_pos, real_end_pos };
            var written: usize = 0;
            while (written < 16) {
                written += stream.pwrite(std.mem.asBytes(&positioned)[written..], start_pos + written);
            }
        } else {
            const real_end_pos = try stream.getPos();
            const positioned = [2]u64{ real_end_pos, real_end_pos };
            var written: usize = 0;
            while (written < 16) {
                written += stream.pwrite(std.mem.asBytes(&positioned)[written..], start_pos + written);
            }
        }
    }

    pub fn save(this: Buffers, allocator: Allocator, comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer) !void {
        inline for (sizes.names) |name| {
            if (PackageManager.instance.options.log_level.isVerbose()) {
                Output.prettyErrorln("Saving {d} {s}", .{ @field(this, name).items.len, name });
            }

            // Dependencies have to be converted to .toExternal first
            // We store pointers in Version.Value, so we can't just write it directly
            if (comptime strings.eqlComptime(name, "dependencies")) {
                const remaining = this.dependencies.items;

                // It would be faster to buffer these instead of one big allocation
                var to_clone = try std.ArrayListUnmanaged(Dependency.External).initCapacity(allocator, remaining.len);

                defer to_clone.deinit(allocator);
                for (remaining) |dep| {
                    to_clone.appendAssumeCapacity(Dependency.toExternal(dep));
                }

                try writeArray(StreamType, stream, Writer, writer, []Dependency.External, to_clone.items);
            } else {
                const list = @field(this, name);
                const items = list.items;
                const Type = @TypeOf(items);
                if (comptime Type == Tree) {
                    // We duplicate it here so that alignment bytes are zeroed out
                    var clone = try std.ArrayListUnmanaged(Tree.External).initCapacity(allocator, list.items.len);
                    for (list.items) |item| {
                        clone.appendAssumeCapacity(Tree.toExternal(item));
                    }
                    defer clone.deinit(allocator);

                    try writeArray(StreamType, stream, Writer, writer, Tree.External, clone.items);
                } else {
                    // We duplicate it here so that alignment bytes are zeroed out
                    var clone = try std.ArrayListUnmanaged(std.meta.Child(Type)).initCapacity(allocator, list.items.len);
                    clone.appendSliceAssumeCapacity(items);
                    defer clone.deinit(allocator);

                    try writeArray(StreamType, stream, Writer, writer, Type, clone.items);
                }
            }

            if (comptime Environment.isDebug) {
                // Output.prettyErrorln("Field {s}: {d} - {d}", .{ name, pos, try stream.getPos() });
            }
        }
    }

    pub fn legacyPackageToDependencyID(this: Buffers, dependency_visited: ?*Bitset, package_id: PackageID) !DependencyID {
        switch (package_id) {
            0 => return Tree.root_dep_id,
            invalid_package_id => return invalid_package_id,
            else => for (this.resolutions.items, 0..) |pkg_id, dep_id| {
                if (pkg_id == package_id) {
                    if (dependency_visited) |visited| {
                        if (visited.isSet(dep_id)) continue;
                        visited.set(dep_id);
                    }
                    return @as(DependencyID, @truncate(dep_id));
                }
            },
        }
        return error.@"Lockfile is missing resolution data";
    }

    pub fn load(stream: *Stream, allocator: Allocator, log: *logger.Log) !Buffers {
        var this = Buffers{};
        var external_dependency_list_: std.ArrayListUnmanaged(Dependency.External) = std.ArrayListUnmanaged(Dependency.External){};

        inline for (sizes.names) |name| {
            const Type = @TypeOf(@field(this, name));

            var pos: usize = 0;
            if (comptime Environment.isDebug) {
                pos = try stream.getPos();
            }

            if (comptime Type == @TypeOf(this.dependencies)) {
                external_dependency_list_ = try readArray(stream, allocator, std.ArrayListUnmanaged(Dependency.External));

                if (PackageManager.instance.options.log_level.isVerbose()) {
                    Output.prettyErrorln("Loaded {d} {s}", .{ external_dependency_list_.items.len, name });
                }
            } else if (comptime Type == @TypeOf(this.trees)) {
                var tree_list = try readArray(stream, allocator, std.ArrayListUnmanaged(Tree.External));
                defer tree_list.deinit(allocator);
                this.trees = try Tree.List.initCapacity(allocator, tree_list.items.len);
                this.trees.items.len = tree_list.items.len;

                for (tree_list.items, this.trees.items) |from, *to| {
                    to.* = Tree.toTree(from);
                }
            } else {
                @field(this, name) = try readArray(stream, allocator, Type);
                if (PackageManager.instance.options.log_level.isVerbose()) {
                    Output.prettyErrorln("Loaded {d} {s}", .{ @field(this, name).items.len, name });
                }
            }

            // if (comptime Environment.isDebug) {
            //     Output.prettyErrorln("Field {s}: {d} - {d}", .{ name, pos, try stream.getPos() });
            // }
        }

        const external_dependency_list = external_dependency_list_.items;
        // Dependencies are serialized separately.
        // This is unfortunate. However, not using pointers for Semver Range's make the code a lot more complex.
        this.dependencies = try DependencyList.initCapacity(allocator, external_dependency_list.len);
        const string_buf = this.string_bytes.items;
        const extern_context = Dependency.Context{
            .log = log,
            .allocator = allocator,
            .buffer = string_buf,
        };

        this.dependencies.expandToCapacity();
        this.dependencies.items.len = external_dependency_list.len;

        {
            var external_deps = external_dependency_list.ptr;
            const dependencies = this.dependencies.items;
            if (comptime Environment.allow_assert) std.debug.assert(external_dependency_list.len == dependencies.len);
            for (dependencies) |*dep| {
                dep.* = Dependency.toDependency(external_deps[0], extern_context);
                external_deps += 1;
            }
        }

        // Legacy tree structure stores package IDs instead of dependency IDs
        if (this.trees.items.len > 0 and this.trees.items[0].dependency_id != Tree.root_dep_id) {
            var visited = try Bitset.initEmpty(allocator, this.dependencies.items.len);
            for (this.trees.items) |*tree| {
                const package_id = tree.dependency_id;
                tree.dependency_id = try this.legacyPackageToDependencyID(&visited, package_id);
            }
            visited.setRangeValue(.{
                .start = 0,
                .end = this.dependencies.items.len,
            }, false);
            for (this.hoisted_dependencies.items) |*package_id| {
                const pid = package_id.*;
                package_id.* = try this.legacyPackageToDependencyID(&visited, pid);
            }
            visited.deinit(allocator);
        }

        return this;
    }
};

pub const Serializer = struct {
    pub const version = "bun-lockfile-format-v0\n";
    const header_bytes: string = "#!/usr/bin/env bun\n" ++ version;

    const has_workspace_package_ids_tag: u64 = @bitCast([_]u8{ 'w', 'O', 'r', 'K', 's', 'P', 'a', 'C' });
    const has_trusted_dependencies_tag: u64 = @bitCast([_]u8{ 't', 'R', 'u', 'S', 't', 'E', 'D', 'd' });
    const has_overrides_tag: u64 = @bitCast([_]u8{ 'o', 'V', 'e', 'R', 'r', 'i', 'D', 's' });

    pub fn save(this: *Lockfile, bytes: *std.ArrayList(u8), total_size: *usize, end_pos: *usize) !void {
        var old_package_list = this.packages;
        this.packages = try this.packages.clone(z_allocator);
        old_package_list.deinit(this.allocator);

        var writer = bytes.writer();
        try writer.writeAll(header_bytes);
        try writer.writeInt(u32, @intFromEnum(this.format), .little);

        try writer.writeAll(&this.meta_hash);

        end_pos.* = bytes.items.len;
        try writer.writeInt(u64, 0, .little);

        const StreamType = struct {
            bytes: *std.ArrayList(u8),
            pub inline fn getPos(s: @This()) anyerror!usize {
                return s.bytes.items.len;
            }

            pub fn pwrite(
                s: @This(),
                data: []const u8,
                index: usize,
            ) usize {
                @memcpy(s.bytes.items[index..][0..data.len], data);
                return data.len;
            }
        };
        const stream = StreamType{ .bytes = bytes };

        try Lockfile.Package.Serializer.save(this.packages, StreamType, stream, @TypeOf(writer), writer);
        try Lockfile.Buffers.save(this.buffers, z_allocator, StreamType, stream, @TypeOf(writer), writer);
        try writer.writeInt(u64, 0, .little);

        // < Bun v1.0.4 stopped right here when reading the lockfile
        // So we add an extra 8 byte tag to say "hey, there's more data here"
        if (this.workspace_versions.count() > 0) {
            try writer.writeAll(std.mem.asBytes(&has_workspace_package_ids_tag));

            // We need to track the "version" field in "package.json" of workspace member packages
            // We do not necessarily have that in the Resolution struct. So we store it here.
            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []PackageNameHash,
                this.workspace_versions.keys(),
            );
            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []Semver.Version,
                this.workspace_versions.values(),
            );

            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []PackageNameHash,
                this.workspace_paths.keys(),
            );
            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []String,
                this.workspace_paths.values(),
            );
        }

        if (this.trusted_dependencies.count() > 0) {
            try writer.writeAll(std.mem.asBytes(&has_trusted_dependencies_tag));

            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []u32,
                this.trusted_dependencies.keys(),
            );
        }

        if (this.overrides.map.count() > 0) {
            try writer.writeAll(std.mem.asBytes(&has_overrides_tag));

            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []PackageNameHash,
                this.overrides.map.keys(),
            );
            var external_overrides = try std.ArrayListUnmanaged(Dependency.External).initCapacity(z_allocator, this.overrides.map.count());
            defer external_overrides.deinit(z_allocator);
            external_overrides.items.len = this.overrides.map.count();
            for (external_overrides.items, this.overrides.map.values()) |*dest, src| {
                dest.* = src.toExternal();
            }

            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []Dependency.External,
                external_overrides.items,
            );
        }

        total_size.* = try stream.getPos();

        try writer.writeAll(&alignment_bytes_to_repeat_buffer);
    }
    pub fn load(
        lockfile: *Lockfile,
        stream: *Stream,
        allocator: Allocator,
        log: *logger.Log,
    ) !void {
        var reader = stream.reader();
        var header_buf_: [header_bytes.len]u8 = undefined;
        const header_buf = header_buf_[0..try reader.readAll(&header_buf_)];

        if (!strings.eqlComptime(header_buf, header_bytes)) {
            return error.InvalidLockfile;
        }

        const format = try reader.readInt(u32, .little);
        if (format != @intFromEnum(Lockfile.FormatVersion.current)) {
            return error.@"Outdated lockfile version";
        }

        lockfile.format = Lockfile.FormatVersion.current;
        lockfile.allocator = allocator;

        _ = try reader.readAll(&lockfile.meta_hash);

        const total_buffer_size = try reader.readInt(u64, .little);
        if (total_buffer_size > stream.buffer.len) {
            return error.@"Lockfile is missing data";
        }

        lockfile.packages = try Lockfile.Package.Serializer.load(
            stream,
            total_buffer_size,
            allocator,
        );
        lockfile.buffers = try Lockfile.Buffers.load(stream, allocator, log);
        if ((try stream.reader().readInt(u64, .little)) != 0) {
            return error.@"Lockfile is malformed (expected 0 at the end)";
        }

        const has_workspace_name_hashes = false;
        // < Bun v1.0.4 stopped right here when reading the lockfile
        // So we add an extra 8 byte tag to say "hey, there's more data here"
        {
            const remaining_in_buffer = total_buffer_size -| stream.pos;

            if (remaining_in_buffer > 8 and total_buffer_size <= stream.buffer.len) {
                const next_num = try reader.readInt(u64, .little);
                if (next_num == has_workspace_package_ids_tag) {
                    {
                        var workspace_package_name_hashes = try Lockfile.Buffers.readArray(
                            stream,
                            allocator,
                            std.ArrayListUnmanaged(PackageNameHash),
                        );
                        defer workspace_package_name_hashes.deinit(allocator);

                        var workspace_versions_list = try Lockfile.Buffers.readArray(
                            stream,
                            allocator,
                            std.ArrayListUnmanaged(Semver.Version),
                        );
                        comptime {
                            if (PackageNameHash != @TypeOf((VersionHashMap.KV{ .key = undefined, .value = undefined }).key)) {
                                @compileError("VersionHashMap must be in sync with serialization");
                            }
                            if (Semver.Version != @TypeOf((VersionHashMap.KV{ .key = undefined, .value = undefined }).value)) {
                                @compileError("VersionHashMap must be in sync with serialization");
                            }
                        }
                        defer workspace_versions_list.deinit(allocator);
                        try lockfile.workspace_versions.ensureTotalCapacity(allocator, workspace_versions_list.items.len);
                        lockfile.workspace_versions.entries.len = workspace_versions_list.items.len;
                        @memcpy(lockfile.workspace_versions.keys(), workspace_package_name_hashes.items);
                        @memcpy(lockfile.workspace_versions.values(), workspace_versions_list.items);
                        try lockfile.workspace_versions.reIndex(allocator);
                    }

                    {
                        var workspace_paths_hashes = try Lockfile.Buffers.readArray(
                            stream,
                            allocator,
                            std.ArrayListUnmanaged(PackageNameHash),
                        );
                        defer workspace_paths_hashes.deinit(allocator);
                        var workspace_paths_strings = try Lockfile.Buffers.readArray(
                            stream,
                            allocator,
                            std.ArrayListUnmanaged(String),
                        );
                        defer workspace_paths_strings.deinit(allocator);

                        try lockfile.workspace_paths.ensureTotalCapacity(allocator, workspace_paths_strings.items.len);

                        lockfile.workspace_paths.entries.len = workspace_paths_strings.items.len;
                        @memcpy(lockfile.workspace_paths.keys(), workspace_paths_hashes.items);
                        @memcpy(lockfile.workspace_paths.values(), workspace_paths_strings.items);
                        try lockfile.workspace_paths.reIndex(allocator);
                    }
                } else {
                    stream.pos -= 8;
                }
            }
        }

        {
            const remaining_in_buffer = total_buffer_size -| stream.pos;

            if (remaining_in_buffer > 8 and total_buffer_size <= stream.buffer.len) {
                const next_num = try reader.readInt(u64, .little);
                if (next_num == has_trusted_dependencies_tag) {
                    var trusted_dependencies_hashes = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(u32),
                    );
                    defer trusted_dependencies_hashes.deinit(allocator);

                    try lockfile.trusted_dependencies.ensureTotalCapacity(allocator, trusted_dependencies_hashes.items.len);

                    lockfile.trusted_dependencies.entries.len = trusted_dependencies_hashes.items.len;
                    @memcpy(lockfile.trusted_dependencies.keys(), trusted_dependencies_hashes.items);
                    try lockfile.trusted_dependencies.reIndex(allocator);
                } else {
                    stream.pos -= 8;
                }
            }
        }

        {
            const remaining_in_buffer = total_buffer_size -| stream.pos;

            if (remaining_in_buffer > 8 and total_buffer_size <= stream.buffer.len) {
                const next_num = try reader.readInt(u64, .little);
                if (next_num == has_overrides_tag) {
                    var overrides_name_hashes = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(PackageNameHash),
                    );
                    defer overrides_name_hashes.deinit(allocator);

                    var map = lockfile.overrides.map;
                    defer lockfile.overrides.map = map;

                    try map.ensureTotalCapacity(allocator, overrides_name_hashes.items.len);
                    const override_versions_external = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(Dependency.External),
                    );
                    const context: Dependency.Context = .{
                        .allocator = allocator,
                        .log = log,
                        .buffer = lockfile.buffers.string_bytes.items,
                    };
                    for (overrides_name_hashes.items, override_versions_external.items) |name, value| {
                        map.putAssumeCapacity(name, Dependency.toDependency(value, context));
                    }
                } else {
                    stream.pos -= 8;
                }
            }
        }

        lockfile.scratch = Lockfile.Scratch.init(allocator);
        lockfile.package_index = PackageIndex.Map.initContext(allocator, .{});
        lockfile.string_pool = StringPool.initContext(allocator, .{});
        try lockfile.package_index.ensureTotalCapacity(@as(u32, @truncate(lockfile.packages.len)));

        if (!has_workspace_name_hashes) {
            const slice = lockfile.packages.slice();
            const name_hashes = slice.items(.name_hash);
            const resolutions = slice.items(.resolution);
            for (name_hashes, resolutions, 0..) |name_hash, resolution, id| {
                try lockfile.getOrPutID(@as(PackageID, @truncate(id)), name_hash);

                // compatibility with < Bun v1.0.4
                switch (resolution.tag) {
                    .workspace => {
                        try lockfile.workspace_paths.put(allocator, name_hash, resolution.value.workspace);
                    },
                    else => {},
                }
            }
        } else {
            const slice = lockfile.packages.slice();
            const name_hashes = slice.items(.name_hash);
            for (name_hashes, 0..) |name_hash, id| {
                try lockfile.getOrPutID(@as(PackageID, @truncate(id)), name_hash);
            }
        }

        if (comptime Environment.allow_assert) std.debug.assert(stream.pos == total_buffer_size);

        // const end = try reader.readInt(u64, .little);
    }
};

pub fn hasMetaHashChanged(this: *Lockfile, print_name_version_string: bool) !bool {
    const previous_meta_hash = this.meta_hash;
    this.meta_hash = try this.generateMetaHash(print_name_version_string);
    return !strings.eqlLong(&previous_meta_hash, &this.meta_hash, false);
}
pub fn generateMetaHash(this: *Lockfile, print_name_version_string: bool) !MetaHash {
    if (this.packages.len <= 1)
        return zero_hash;

    var string_builder = GlobalStringBuilder{};
    defer string_builder.deinit(this.allocator);
    const names: []const String = this.packages.items(.name);
    const resolutions: []const Resolution = this.packages.items(.resolution);
    const bytes = this.buffers.string_bytes.items;
    var alphabetized_names = try this.allocator.alloc(PackageID, this.packages.len -| 1);
    defer this.allocator.free(alphabetized_names);

    const hash_prefix = "\n-- BEGIN SHA512/256(`${alphabetize(name)}@${order(version)}`) --\n";
    const hash_suffix = "-- END HASH--\n";
    string_builder.cap += hash_prefix.len + hash_suffix.len;
    {
        var i: usize = 1;

        while (i + 16 < this.packages.len) : (i += 16) {
            comptime var j: usize = 0;
            inline while (j < 16) : (j += 1) {
                alphabetized_names[(i + j) - 1] = @as(PackageID, @truncate((i + j)));
                string_builder.fmtCount("{s}@{}\n", .{ names[i + j].slice(bytes), resolutions[i + j].fmt(bytes) });
            }
        }

        while (i < this.packages.len) : (i += 1) {
            alphabetized_names[i - 1] = @as(PackageID, @truncate(i));
            string_builder.fmtCount("{s}@{}\n", .{ names[i].slice(bytes), resolutions[i].fmt(bytes) });
        }
    }

    const scripts_begin = "\n-- BEGIN SCRIPTS --\n";
    const scripts_end = "\n-- END SCRIPTS --\n";
    var has_scripts = false;

    inline for (comptime std.meta.fieldNames(Lockfile.Scripts)) |field_name| {
        const scripts = @field(this.scripts, field_name);
        for (scripts.items) |script| {
            if (script.script.len > 0) {
                string_builder.fmtCount("{s}@{s}: {s}\n", .{ field_name, script.cwd, script.script });
                has_scripts = true;
            }
        }
    }

    if (has_scripts) {
        string_builder.count(scripts_begin);
        string_builder.count(scripts_end);
    }

    std.sort.pdq(
        PackageID,
        alphabetized_names,
        Lockfile.Package.Alphabetizer{
            .names = names,
            .buf = bytes,
            .resolutions = resolutions,
        },
        Lockfile.Package.Alphabetizer.isAlphabetical,
    );

    string_builder.allocate(this.allocator) catch unreachable;
    string_builder.ptr.?[0..hash_prefix.len].* = hash_prefix.*;
    string_builder.len += hash_prefix.len;

    for (alphabetized_names) |i| {
        _ = string_builder.fmt("{s}@{}\n", .{ names[i].slice(bytes), resolutions[i].fmt(bytes) });
    }

    if (has_scripts) {
        _ = string_builder.append(scripts_begin);
        inline for (comptime std.meta.fieldNames(Lockfile.Scripts)) |field_name| {
            const scripts = @field(this.scripts, field_name);
            for (scripts.items) |script| {
                if (script.script.len > 0) {
                    _ = string_builder.fmt("{s}@{s}: {s}\n", .{ field_name, script.cwd, script.script });
                }
            }
        }
        _ = string_builder.append(scripts_end);
    }

    string_builder.ptr.?[string_builder.len..string_builder.cap][0..hash_suffix.len].* = hash_suffix.*;
    string_builder.len += hash_suffix.len;

    const alphabetized_name_version_string = string_builder.ptr.?[0..string_builder.len];
    if (print_name_version_string) {
        Output.flush();
        Output.disableBuffering();
        Output.writer().writeAll(alphabetized_name_version_string) catch unreachable;
        Output.enableBuffering();
    }

    var digest = zero_hash;
    Crypto.SHA512_256.hash(alphabetized_name_version_string, &digest);

    return digest;
}

pub fn resolve(this: *Lockfile, package_name: []const u8, version: Dependency.Version) ?PackageID {
    const name_hash = String.Builder.stringHash(package_name);
    const entry = this.package_index.get(name_hash) orelse return null;
    const buf = this.buffers.string_bytes.items;

    switch (version.tag) {
        .npm => switch (entry) {
            .PackageID => |id| {
                const resolutions = this.packages.items(.resolution);

                if (comptime Environment.allow_assert) std.debug.assert(id < resolutions.len);
                if (version.value.npm.version.satisfies(resolutions[id].value.npm.version, buf, buf)) {
                    return id;
                }
            },
            .PackageIDMultiple => |ids| {
                const resolutions = this.packages.items(.resolution);

                for (ids.items) |id| {
                    if (comptime Environment.allow_assert) std.debug.assert(id < resolutions.len);
                    if (version.value.npm.version.satisfies(resolutions[id].value.npm.version, buf, buf)) {
                        return id;
                    }
                }
            },
        },
        else => {},
    }

    return null;
}

/// The default list of trusted dependencies is a static hashmap
const default_trusted_dependencies = brk: {
    const max_values = 512;

    var map: StaticHashMap([]const u8, u0, std.hash_map.StringContext, max_values) = .{};

    // This file contains a list of dependencies that Bun runs `postinstall` on by default.
    const data = @embedFile("./default-trusted-dependencies.txt");
    @setEvalBranchQuota(99999);

    var iter = std.mem.tokenizeAny(u8, data, " \n\t");
    while (iter.next()) |dep| {
        if (map.len == max_values) {
            @compileError("default-trusted-dependencies.txt is too large, please increase 'max_values' in lockfile.zig");
        }
        map.putAssumeCapacity(dep, 0);
    }

    break :brk &map;
};

pub fn hasTrustedDependency(this: *Lockfile, name: []const u8) bool {
    if (this.hasTrustedDependencies()) {
        const hash = @as(u32, @truncate(String.Builder.stringHash(name)));
        return this.trusted_dependencies.contains(hash) or default_trusted_dependencies.has(name);
    }

    // always search through default trusted dependencies
    return default_trusted_dependencies.has(name);
}

pub fn jsonStringifyDependency(this: *const Lockfile, w: anytype, dep: Dependency, res: ?PackageID) !void {
    const sb = this.buffers.string_bytes.items;
    var buf: [2048]u8 = undefined;

    try w.beginObject();
    defer w.endObject() catch {};

    try w.objectField("literal");
    try w.write(dep.version.literal.slice(sb));

    try w.objectField(@tagName(dep.version.tag));
    switch (dep.version.tag) {
        .uninitialized => try w.write(null),
        .npm => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Dependency.Version.NpmInfo = dep.version.value.npm;

            try w.objectField("name");
            try w.write(info.name.slice(sb));

            try w.objectField("version");
            try w.write(try std.fmt.bufPrint(&buf, "{}", .{info.version}));
        },
        .dist_tag => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Dependency.Version.TagInfo = dep.version.value.dist_tag;

            try w.objectField("name");
            try w.write(info.name.slice(sb));

            try w.objectField("tag");
            try w.write(info.name.slice(sb));
        },
        .tarball => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Dependency.Version.TarballInfo = dep.version.value.tarball;
            try w.objectField(@tagName(info.uri));
            try w.write(switch (info.uri) {
                inline else => |s| s.slice(sb),
            });

            try w.objectField("package_name");
            try w.write(info.package_name.slice(sb));
        },
        .folder => {
            try w.write(dep.version.value.folder.slice(sb));
        },
        .symlink => {
            try w.write(dep.version.value.symlink.slice(sb));
        },
        .workspace => {
            try w.write(dep.version.value.workspace.slice(sb));
        },
        .git => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Repository = dep.version.value.git;

            try w.objectField("owner");
            try w.write(info.owner.slice(sb));
            try w.objectField("repo");
            try w.write(info.repo.slice(sb));
            try w.objectField("committish");
            try w.write(info.committish.slice(sb));
            try w.objectField("resolved");
            try w.write(info.resolved.slice(sb));
            try w.objectField("package_name");
            try w.write(info.package_name.slice(sb));
        },
        .github => {
            try w.beginObject();
            defer w.endObject() catch {};

            const info: Repository = dep.version.value.github;

            try w.objectField("owner");
            try w.write(info.owner.slice(sb));
            try w.objectField("repo");
            try w.write(info.repo.slice(sb));
            try w.objectField("committish");
            try w.write(info.committish.slice(sb));
            try w.objectField("resolved");
            try w.write(info.resolved.slice(sb));
            try w.objectField("package_name");
            try w.write(info.package_name.slice(sb));
        },
    }

    try w.objectField("resolved_id");
    try w.write(if (res) |r| if (r == invalid_package_id) null else r else null);

    const behavior = try std.fmt.bufPrint(&buf, "{}", .{dep.behavior});
    try w.objectField("behavior");
    try w.write(behavior);
}

pub fn jsonStringify(this: *const Lockfile, w: anytype) !void {
    var buf: [2048]u8 = undefined;
    const sb = this.buffers.string_bytes.items;
    try w.beginObject();
    defer w.endObject() catch {};

    try w.objectField("format");
    try w.write(@tagName(this.format));
    try w.objectField("meta_hash");
    try w.write(std.fmt.bytesToHex(this.meta_hash, .lower));

    {
        try w.objectField("package_index");
        try w.beginObject();
        defer w.endObject() catch {};

        var iter = this.package_index.iterator();
        while (iter.next()) |it| {
            const entry: PackageIndex.Entry = it.value_ptr.*;
            const first_id = switch (entry) {
                .PackageID => |id| id,
                .PackageIDMultiple => |ids| ids.items[0],
            };
            const name = this.packages.items(.name)[first_id].slice(sb);
            try w.objectField(name);
            switch (entry) {
                .PackageID => |id| try w.write(id),
                .PackageIDMultiple => |ids| {
                    try w.beginArray();
                    for (ids.items) |id| {
                        try w.write(id);
                    }
                    try w.endArray();
                },
            }
        }
    }
    {
        try w.objectField("packages");
        try w.beginArray();
        defer w.endArray() catch {};

        for (0..this.packages.len) |i| {
            const pkg: Package = this.packages.get(i);
            try w.beginObject();
            defer w.endObject() catch {};

            try w.objectField("id");
            try w.write(i);

            try w.objectField("name");
            try w.write(pkg.name.slice(sb));

            try w.objectField("name_hash");
            try w.write(pkg.name_hash);

            try w.objectField("resolution");
            if (pkg.resolution.tag == .uninitialized) {
                try w.write(null);
            } else {
                const b = try std.fmt.bufPrint(&buf, "{s} {s}", .{ @tagName(pkg.resolution.tag), pkg.resolution.fmt(sb) });
                try w.write(b);
            }

            try w.objectField("dependencies");
            {
                try w.beginObject();
                defer w.endObject() catch {};

                for (pkg.dependencies.get(this.buffers.dependencies.items), pkg.resolutions.get(this.buffers.resolutions.items)) |dep_, res| {
                    const dep: Dependency = dep_;
                    try w.objectField(dep.name.slice(sb));
                    try this.jsonStringifyDependency(w, dep, res);
                }
            }

            if (@as(u16, @intFromEnum(pkg.meta.arch)) != Npm.Architecture.all_value) {
                try w.objectField("arch");
                try w.beginArray();
                defer w.endArray() catch {};

                for (Npm.Architecture.NameMap.kvs) |kv| {
                    if (pkg.meta.arch.has(kv.value)) {
                        try w.write(kv.key);
                    }
                }
            }

            if (@as(u16, @intFromEnum(pkg.meta.os)) != Npm.OperatingSystem.all_value) {
                try w.objectField("os");
                try w.beginArray();
                defer w.endArray() catch {};

                for (Npm.OperatingSystem.NameMap.kvs) |kv| {
                    if (pkg.meta.os.has(kv.value)) {
                        try w.write(kv.key);
                    }
                }
            }

            try w.objectField("integrity");
            if (pkg.meta.integrity.tag != .unknown) {
                try w.write(try std.fmt.bufPrint(&buf, "{}", .{pkg.meta.integrity}));
            } else {
                try w.write(null);
            }

            try w.objectField("man_dir");
            try w.write(pkg.meta.man_dir.slice(sb));

            try w.objectField("origin");
            try w.write(@tagName(pkg.meta.origin));

            try w.objectField("bin");
            switch (pkg.bin.tag) {
                .none => try w.write(null),
                .file => {
                    try w.beginObject();
                    defer w.endObject() catch {};

                    try w.objectField("file");
                    try w.write(pkg.bin.value.file.slice(sb));
                },
                .named_file => {
                    try w.beginObject();
                    defer w.endObject() catch {};

                    try w.objectField("name");
                    try w.write(pkg.bin.value.named_file[0].slice(sb));

                    try w.objectField("file");
                    try w.write(pkg.bin.value.named_file[1].slice(sb));
                },
                .dir => {
                    try w.objectField("dir");
                    try w.write(pkg.bin.value.dir.slice(sb));
                },
                .map => {
                    try w.beginObject();
                    defer w.endObject() catch {};

                    const data: []const ExternalString = pkg.bin.value.map.get(this.buffers.extern_strings.items);
                    var bin_i: usize = 0;
                    while (bin_i < data.len) : (bin_i += 2) {
                        try w.objectField(data[bin_i].slice(sb));
                        try w.write(data[bin_i + 1].slice(sb));
                    }
                },
            }

            {
                try w.objectField("scripts");
                try w.beginObject();
                defer w.endObject() catch {};

                inline for (comptime std.meta.fieldNames(Lockfile.Scripts)) |field_name| {
                    const script = @field(pkg.scripts, field_name).slice(sb);
                    if (script.len > 0) {
                        try w.objectField(field_name);
                        try w.write(script);
                    }
                }
            }
        }
    }

    try w.objectField("workspace_paths");
    {
        try w.beginObject();
        defer w.endObject() catch {};

        for (this.workspace_paths.keys(), this.workspace_paths.values()) |k, v| {
            try w.objectField(try std.fmt.bufPrint(&buf, "{d}", .{k}));
            try w.write(v.slice(sb));
        }
    }
    try w.objectField("workspace_versions");
    {
        try w.beginObject();
        defer w.endObject() catch {};

        for (this.workspace_versions.keys(), this.workspace_versions.values()) |k, v| {
            try w.objectField(try std.fmt.bufPrint(&buf, "{d}", .{k}));
            try w.write(try std.fmt.bufPrint(&buf, "{}", .{v.fmt(sb)}));
        }
    }
}
