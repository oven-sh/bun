const bun = @import("../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");

const JSLexer = @import("../js_lexer.zig");
const logger = @import("../logger.zig");

const js_parser = @import("../js_parser.zig");
const Expr = @import("../js_ast.zig").Expr;
const json_parser = @import("../json_parser.zig");
const JSPrinter = @import("../js_printer.zig");

const linker = @import("../linker.zig");
const panicky = @import("../panic_handler.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const Path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const BunArguments = @import("../cli.zig").Arguments;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
const HeaderBuilder = @import("http").HeaderBuilder;
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const Lock = @import("../lock.zig").Lock;
var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
const URL = @import("../url.zig").URL;
const AsyncHTTP = @import("http").AsyncHTTP;
const HTTPChannel = @import("http").HTTPChannel;
const NetworkThread = @import("http").NetworkThread;

const Integrity = @import("./integrity.zig").Integrity;
const clap = @import("clap");
const ExtractTarball = @import("./extract_tarball.zig");
const Npm = @import("./npm.zig");
const Bitset = @import("./bit_set.zig").DynamicBitSetUnmanaged;
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
const StructBuilder = @import("../builder.zig");
const Bin = @import("./bin.zig").Bin;
const Dependency = @import("./dependency.zig");
const Behavior = @import("./dependency.zig").Behavior;
const FolderResolution = @import("./resolvers/folder_resolver.zig").FolderResolution;
const PackageManager = @import("./install.zig").PackageManager;
const ExternalSlice = @import("./install.zig").ExternalSlice;
const ExternalSliceAligned = @import("./install.zig").ExternalSliceAligned;
const PackageID = @import("./install.zig").PackageID;
const Features = @import("./install.zig").Features;
const PackageInstall = @import("./install.zig").PackageInstall;
const PackageNameHash = @import("./install.zig").PackageNameHash;
const Aligner = @import("./install.zig").Aligner;
const ExternalStringMap = @import("./install.zig").ExternalStringMap;
const alignment_bytes_to_repeat_buffer = @import("./install.zig").alignment_bytes_to_repeat_buffer;
const Resolution = @import("./resolution.zig").Resolution;
const initializeStore = @import("./install.zig").initializeStore;
const invalid_package_id = @import("./install.zig").invalid_package_id;
const JSAst = @import("../js_ast.zig");
const Origin = @import("./install.zig").Origin;
const PackageIDMultiple = @import("./install.zig").PackageIDMultiple;
const Crypto = @import("../sha.zig").Hashers;
pub const MetaHash = [std.crypto.hash.sha2.Sha512256.digest_length]u8;
const zero_hash = std.mem.zeroes(MetaHash);

const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;

pub const ExternalStringBuilder = StructBuilder.Builder(ExternalString);
pub const SmallExternalStringList = ExternalSlice(String);

// Serialized data
/// The version of the lockfile format, intended to prevent data corruption for format changes.
format: FormatVersion = .v1,

/// Not used yet.
/// Eventually, this will be a relative path to a parent lockfile
workspace_path: string = "",

meta_hash: MetaHash = zero_hash,

packages: Lockfile.Package.List = Lockfile.Package.List{},
buffers: Buffers = Buffers{},

/// name -> PackageID || [*]PackageID
/// Not for iterating.
package_index: PackageIndex.Map,
unique_packages: Bitset,
string_pool: StringPool,
allocator: std.mem.Allocator,
scratch: Scratch = Scratch{},

scripts: Scripts = .{},

const Stream = std.io.FixedBufferStream([]u8);
pub const default_filename = "bun.lockb";

pub const Scripts = struct {
    const StringArrayList = std.ArrayListUnmanaged(string);
    const RunCommand = @import("../cli/run_command.zig").RunCommand;

    preinstall: StringArrayList = .{},
    install: StringArrayList = .{},
    postinstall: StringArrayList = .{},
    preprepare: StringArrayList = .{},
    prepare: StringArrayList = .{},
    postprepare: StringArrayList = .{},

    pub fn hasAny(this: Scripts) bool {
        return (this.preinstall.items.len +
            this.install.items.len +
            this.postinstall.items.len +
            this.preprepare.items.len +
            this.prepare.items.len +
            this.postprepare.items.len) > 0;
    }

    pub fn run(this: Scripts, allocator: std.mem.Allocator, env: *DotEnv.Loader, silent: bool, comptime hook: []const u8) !void {
        for (@field(this, hook).items) |script| {
            std.debug.assert(Fs.FileSystem.instance_loaded);
            const cwd = Fs.FileSystem.instance.top_level_dir;
            _ = try RunCommand.runPackageScript(allocator, script, hook, cwd, env, &.{}, silent);
        }
    }
};

pub fn isEmpty(this: *const Lockfile) bool {
    return this.packages.len == 0 or this.packages.len == 1 or this.packages.get(0).resolutions.len == 0;
}

pub const LoadFromDiskResult = union(Tag) {
    not_found: void,
    err: struct {
        step: Step,
        value: anyerror,
    },
    ok: *Lockfile,

    pub const Step = enum { open_file, read_file, parse_file };

    pub const Tag = enum {
        not_found,
        err,
        ok,
    };
};

pub fn loadFromDisk(this: *Lockfile, allocator: std.mem.Allocator, log: *logger.Log, filename: stringZ) LoadFromDiskResult {
    std.debug.assert(FileSystem.instance_loaded);
    var file = std.io.getStdIn();

    if (filename.len > 0)
        file = std.fs.cwd().openFileZ(filename, .{ .mode = .read_only }) catch |err| {
            return switch (err) {
                error.FileNotFound, error.AccessDenied, error.BadPathName => LoadFromDiskResult{ .not_found = .{} },
                else => LoadFromDiskResult{ .err = .{ .step = .open_file, .value = err } },
            };
        };

    defer file.close();
    var buf = file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch |err| {
        return LoadFromDiskResult{ .err = .{ .step = .read_file, .value = err } };
    };

    return this.loadFromBytes(buf, allocator, log);
}

pub fn loadFromBytes(this: *Lockfile, buf: []u8, allocator: std.mem.Allocator, log: *logger.Log) LoadFromDiskResult {
    var stream = Stream{ .buffer = buf, .pos = 0 };

    this.workspace_path = "";
    this.format = FormatVersion.current;
    this.scripts = .{};

    Lockfile.Serializer.load(this, &stream, allocator, log) catch |err| {
        return LoadFromDiskResult{ .err = .{ .step = .parse_file, .value = err } };
    };

    return LoadFromDiskResult{ .ok = this };
}

pub const InstallResult = struct {
    lockfile: *Lockfile,
    summary: PackageInstall.Summary,
};

pub const Tree = struct {
    id: Id = invalid_id,
    package_id: PackageID = invalid_package_id,
    parent: Id = invalid_id,
    packages: Lockfile.PackageIDSlice = Lockfile.PackageIDSlice{},

    pub const external_size = @sizeOf(Id) + @sizeOf(PackageID) + @sizeOf(Id) + @sizeOf(Lockfile.PackageIDSlice);
    pub const External = [external_size]u8;
    pub const Slice = ExternalSlice(Tree);
    pub const List = std.ArrayListUnmanaged(Tree);
    pub const Id = u32;

    pub fn toExternal(this: Tree) External {
        var out = External{};
        out[0..4].* = @bitCast(Id, this.id);
        out[4..8].* = @bitCast(Id, this.package_id);
        out[8..12].* = @bitCast(Id, this.parent);
        out[12..16].* = @bitCast(u32, this.packages.off);
        out[16..20].* = @bitCast(u32, this.packages.len);
        if (out.len != 20) @compileError("Tree.External is not 20 bytes");
        return out;
    }

    pub fn toTree(out: External) Tree {
        return Tree{
            .id = @bitCast(Id, out[0..4].*),
            .package_id = @bitCast(Id, out[4..8].*),
            .parent = @bitCast(Id, out[8..12].*),
            .packages = .{
                .off = @bitCast(u32, out[12..16].*),
                .len = @bitCast(u32, out[16..20].*),
            },
        };
    }

    const invalid_id: Id = std.math.maxInt(Id);
    const dependency_loop = invalid_id - 1;
    const hoisted = invalid_id - 2;
    const error_id = hoisted;

    const SubtreeError = error{ OutOfMemory, DependencyLoop };

    const NodeModulesFolder = struct {
        relative_path: stringZ,
        in: PackageID,
        packages: []const PackageID,
    };

    pub const Iterator = struct {
        trees: []const Tree,
        package_ids: []const PackageID,
        names: []const String,
        tree_id: Id = 0,
        path_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
        path_buf_len: usize = 0,
        last_parent: Id = invalid_id,
        string_buf: string,

        // max number of node_modules folders
        depth_stack: [(bun.MAX_PATH_BYTES / "node_modules".len) + 1]Id = undefined,

        pub fn init(
            trees: []const Tree,
            package_ids: []const PackageID,
            names: []const String,
            string_buf: string,
        ) Iterator {
            return Tree.Iterator{
                .trees = trees,
                .package_ids = package_ids,
                .names = names,
                .tree_id = 0,
                .path_buf = undefined,
                .path_buf_len = 0,
                .last_parent = invalid_id,
                .string_buf = string_buf,
            };
        }

        pub fn nextNodeModulesFolder(this: *Iterator) ?NodeModulesFolder {
            if (this.tree_id >= this.trees.len) return null;

            while (this.trees[this.tree_id].packages.len == 0) {
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
                    while (parent_id > 0 and parent_id < @intCast(Id, this.trees.len)) {
                        this.depth_stack[depth_buf_len] = parent_id;
                        parent_id = this.trees[parent_id].parent;
                        depth_buf_len += 1;
                    }
                    depth_buf_len -= 1;
                    while (depth_buf_len > 0) : (depth_buf_len -= 1) {
                        this.path_buf[path_written] = std.fs.path.sep;
                        path_written += 1;

                        const tree_id = this.depth_stack[depth_buf_len];

                        const name = this.names[this.trees[tree_id].package_id].slice(string_buf);
                        std.mem.copy(u8, this.path_buf[path_written..], name);
                        path_written += name.len;

                        this.path_buf[path_written..][0.."/node_modules".len].* = (std.fs.path.sep_str ++ "node_modules").*;
                        path_written += "/node_modules".len;
                    }
                }
                this.path_buf[path_written] = 0;
                this.path_buf_len = path_written;
            }

            this.tree_id += 1;
            var relative_path: [:0]u8 = this.path_buf[0..this.path_buf_len :0];
            return NodeModulesFolder{
                .relative_path = relative_path,
                .in = tree.package_id,
                .packages = tree.packages.get(this.package_ids),
            };
        }
    };

    const Builder = struct {
        allocator: std.mem.Allocator,
        name_hashes: []const PackageNameHash,
        list: ArrayList = ArrayList{},
        resolutions: []const PackageID,
        dependencies: []const Dependency,
        resolution_lists: []const Lockfile.PackageIDSlice,
        queue: Lockfile.TreeFiller,

        pub const Entry = struct {
            tree: Tree,
            packages: Lockfile.PackageIDList,
        };

        pub const ArrayList = std.MultiArrayList(Entry);

        /// Flatten the multi-dimensional ArrayList of package IDs into a single easily serializable array
        pub fn clean(this: *Builder) ![]PackageID {
            var end = @truncate(Id, this.list.len);
            var i: Id = 0;
            var total_packages_count: u32 = 0;

            var trees = this.list.items(.tree);
            var packages = this.list.items(.packages);

            // var real_end: Id = 0;

            // TODO: can we cull empty trees here?
            while (i < end) : (i += 1) {
                total_packages_count += trees[i].packages.len;
                // if (!(prev == total_packages_count and trees[i].package_id >= max_package_id)) {
                //     trees[real_end] = trees[i];
                //     packages[real_end] = packages[i];
                //     real_end += 1;
                // }
            }
            // this.list.len = real_end;
            // trees = trees[0..real_end];
            // packages = packages[0..real_end];

            var package_ids = try z_allocator.alloc(PackageID, total_packages_count);
            var next = PackageIDSlice{};

            for (trees) |tree, id| {
                if (tree.packages.len > 0) {
                    var child = packages[id];
                    const len = @truncate(PackageID, child.items.len);
                    next.off += next.len;
                    next.len = len;
                    trees[id].packages = next;
                    std.mem.copy(PackageID, package_ids[next.off..][0..next.len], child.items);
                    child.deinit(this.allocator);
                }
            }
            this.queue.deinit();

            return package_ids;
        }
    };

    pub fn processSubtree(
        this: *Tree,
        package_id: PackageID,
        builder: *Builder,
    ) SubtreeError!void {
        try builder.list.append(builder.allocator, .{
            .tree = Tree{
                .parent = this.id,
                .id = @truncate(Id, builder.list.len),
                .package_id = package_id,
            },
            .packages = .{},
        });

        var list_slice = builder.list.slice();
        var trees = list_slice.items(.tree);
        var package_lists = list_slice.items(.packages);
        var next: *Tree = &trees[builder.list.len - 1];

        const resolution_list = builder.resolution_lists[package_id];
        const resolutions: []const PackageID = resolution_list.get(builder.resolutions);
        if (resolutions.len == 0) {
            return;
        }
        const dependencies: []const Dependency = builder.dependencies[resolution_list.off .. resolution_list.off + resolution_list.len];

        const max_package_id = builder.name_hashes.len;

        for (resolutions) |pid, j| {
            if (pid >= max_package_id or dependencies[j].behavior.isPeer()) continue;

            const destination = next.addDependency(pid, builder.name_hashes, package_lists, trees, builder.allocator);
            switch (destination) {
                Tree.dependency_loop => return error.DependencyLoop,
                Tree.hoisted => continue,
                else => {},
            }

            if (builder.resolution_lists[pid].len > 0) {
                try builder.queue.writeItem([2]PackageID{ pid, destination });
            }
        }
    }

    // todo: use error type when it no longer takes up extra stack space
    pub fn addDependency(
        this: *Tree,
        package_id: PackageID,
        name_hashes: []const PackageNameHash,
        lists: []Lockfile.PackageIDList,
        trees: []Tree,
        allocator: std.mem.Allocator,
    ) Id {
        const this_packages = this.packages.get(lists[this.id].items);
        const name_hash = name_hashes[package_id];

        for (this_packages) |pid| {
            if (name_hashes[pid] == name_hash) {
                if (pid != package_id) {
                    return dependency_loop;
                }

                return hoisted;
            }
        }

        if (this.parent < error_id) {
            const id = trees[this.parent].addDependency(
                package_id,
                name_hashes,
                lists,
                trees,
                allocator,
            );
            switch (id) {
                // If there is a dependency loop, we've reached the highest point
                // Therefore, we resolve the dependency loop by appending to ourself
                Tree.dependency_loop => {},
                Tree.hoisted => return hoisted,
                else => return id,
            }
        }

        lists[this.id].append(allocator, package_id) catch unreachable;
        this.packages.len += 1;
        return this.id;
    }
};

/// This conditonally clones the lockfile with root packages marked as non-resolved that do not satisfy `Features`. The package may still end up installed even if it was e.g. in "devDependencies" and its a production install. In that case, it would be installed because another dependency or transient dependency needed it
///
/// Warning: This potentially modifies the existing lockfile in-place. That is safe to do because at this stage, the lockfile has already been saved to disk. Our in-memory representation is all that's left.
pub fn maybeCloneFilteringRootPackages(
    old: *Lockfile,
    features: Features,
) !*Lockfile {
    const old_root_dependenices_list: DependencySlice = old.packages.items(.dependencies)[0];
    var old_root_resolutions: PackageIDSlice = old.packages.items(.resolutions)[0];
    const root_dependencies = old_root_dependenices_list.get(old.buffers.dependencies.items);
    var resolutions = old_root_resolutions.mut(old.buffers.resolutions.items);
    var any_changes = false;
    const end = @truncate(PackageID, old.packages.len);

    for (root_dependencies) |dependency, i| {
        if (!dependency.behavior.isEnabled(features) and resolutions[i] < end) {
            resolutions[i] = invalid_package_id;
            any_changes = true;
        }
    }

    if (!any_changes) return old;

    return try old.clean(&.{});
}

fn preprocessUpdateRequests(old: *Lockfile, updates: []PackageManager.UpdateRequest) !void {
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
                    for (root_deps) |dep, i| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            const old_resolution = old_resolutions[i];
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            const len = std.fmt.count("^{}", .{res.value.npm.fmt(old.buffers.string_bytes.items)});
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

            var root_deps: []Dependency = root_deps_list.mut(old.buffers.dependencies.items);
            const old_resolutions_list_lists = old.packages.items(.resolutions);
            const old_resolutions_list = old_resolutions_list_lists[0];
            const old_resolutions: []const PackageID = old_resolutions_list.get(old.buffers.resolutions.items);
            const resolutions_of_yore: []const Resolution = old.packages.items(.resolution);

            for (updates) |update, update_i| {
                if (update.version.tag == .uninitialized) {
                    for (root_deps) |*dep, i| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            const old_resolution = old_resolutions[i];
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            var buf = std.fmt.bufPrint(&temp_buf, "^{}", .{res.value.npm.fmt(old.buffers.string_bytes.items)}) catch break;
                            const external_version = string_builder.append(ExternalString, buf);
                            const sliced = external_version.value.sliced(
                                old.buffers.string_bytes.items,
                            );
                            dep.version = Dependency.parse(
                                old.allocator,
                                sliced.slice,
                                &sliced,
                                null,
                            ) orelse Dependency.Version{};
                        }
                    }
                }

                updates[update_i].e_string = null;
            }
        }
    }
}

pub fn clean(old: *Lockfile, updates: []PackageManager.UpdateRequest) !*Lockfile {
    const old_scripts = old.scripts;
    // We will only shrink the number of packages here.
    // never grow

    if (updates.len > 0) {
        try old.preprocessUpdateRequests(updates);
    }

    // Deduplication works like this
    // Go through *already* resolved package versions
    // Ask, do any of those versions happen to match a lower version?
    // If yes, choose that version instead.
    // Why lower?
    //
    // Normally, the problem is looks like this:
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

    var new = try old.allocator.create(Lockfile);
    try new.initEmpty(
        old.allocator,
    );
    try new.string_pool.ensureTotalCapacity(old.string_pool.capacity());
    try new.package_index.ensureTotalCapacity(old.package_index.capacity());
    try new.packages.ensureTotalCapacity(old.allocator, old.packages.len);
    try new.buffers.preallocate(old.buffers, old.allocator);

    old.scratch.dependency_list_queue.head = 0;

    // Step 1. Recreate the lockfile with only the packages that are still alive
    const root = old.rootPackage() orelse return error.NoPackage;

    var package_id_mapping = try old.allocator.alloc(PackageID, old.packages.len);
    std.mem.set(
        PackageID,
        package_id_mapping,
        invalid_package_id,
    );
    var clone_queue_ = PendingResolutions.init(old.allocator);
    new.unique_packages = try Bitset.initEmpty(old.unique_packages.bit_length, old.allocator);
    var cloner = Cloner{
        .old = old,
        .lockfile = new,
        .mapping = package_id_mapping,
        .clone_queue = clone_queue_,
    };
    // try clone_queue.ensureUnusedCapacity(root.dependencies.len);
    _ = try root.clone(old, new, package_id_mapping, &cloner);

    // When you run `"bun add react"
    // This is where we update it in the lockfile from "latest" to "^17.0.2"

    try cloner.flush();

    // Don't allow invalid memory to happen
    if (updates.len > 0) {
        const dep_list = new.packages.items(.dependencies)[0];
        const res_list = new.packages.items(.resolutions)[0];
        const root_deps: []const Dependency = dep_list.get(new.buffers.dependencies.items);
        const new_resolutions: []const PackageID = res_list.get(new.buffers.resolutions.items);

        for (updates) |update, update_i| {
            if (update.version.tag == .uninitialized) {
                for (root_deps) |dep, i| {
                    if (dep.name_hash == String.Builder.stringHash(update.name)) {
                        if (new_resolutions[i] > new.packages.len) continue;
                        updates[update_i].version_buf = new.buffers.string_bytes.items;
                        updates[update_i].version = dep.version;
                        updates[update_i].resolved_version_buf = new.buffers.string_bytes.items;
                        updates[update_i].missing_version = true;
                    }
                }
            }
        }
    }
    new.scripts = old_scripts;
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

pub const TreeFiller = std.fifo.LinearFifo([2]PackageID, .Dynamic);

const Cloner = struct {
    clone_queue: PendingResolutions,
    lockfile: *Lockfile,
    old: *Lockfile,
    mapping: []PackageID,
    trees: Tree.List = Tree.List{},
    trees_count: u32 = 1,

    pub fn flush(this: *Cloner) anyerror!void {
        const max_package_id = this.old.packages.len;
        while (this.clone_queue.popOrNull()) |to_clone_| {
            const to_clone: PendingResolution = to_clone_;

            const mapping = this.mapping[to_clone.old_resolution];
            if (mapping < max_package_id) {
                this.lockfile.buffers.resolutions.items[to_clone.resolve_id] = this.mapping[to_clone.old_resolution];
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
        const max = @truncate(PackageID, this.lockfile.packages.len);
        if (max == 0) return;
        var allocator = this.lockfile.allocator;

        var tree_list = Tree.Builder.ArrayList{};

        var slice = this.lockfile.packages.slice();
        const unique_packages = this.lockfile.unique_packages;

        var resolutions_lists: []const PackageIDSlice = slice.items(.resolutions);
        const name_hashes: []const PackageNameHash = slice.items(.name_hash);
        const resolutions_buffer: []const PackageID = this.lockfile.buffers.resolutions.items;
        // populate the root of the tree with:
        // - packages where only one version exists in the tree and they have no dependencies
        // - dependencies from package.json
        // Dependencies from package.json must always be put into the tree

        var root_packages_count: u32 = resolutions_lists[0].len;
        for (resolutions_lists[1..]) |list, package_id| {
            if (list.len > 0 or !unique_packages.isSet(package_id + 1)) continue;
            root_packages_count += 1;
        }

        var root_package_list = try PackageIDList.initCapacity(allocator, root_packages_count);
        const root_resolutions: []const PackageID = resolutions_lists[0].get(resolutions_buffer);

        try tree_list.ensureTotalCapacity(allocator, root_packages_count);
        tree_list.len = root_packages_count;

        for (resolutions_lists[1..]) |list, package_id_| {
            const package_id = @intCast(PackageID, package_id_ + 1);
            if (list.len > 0 or
                !unique_packages.isSet(package_id) or
                std.mem.indexOfScalar(PackageID, root_package_list.items, package_id) != null)
                continue;
            root_package_list.appendAssumeCapacity(package_id);
        }

        var tree_filler_queue: TreeFiller = TreeFiller.init(allocator);
        try tree_filler_queue.ensureUnusedCapacity(root_resolutions.len);

        var possible_duplicates_len = root_package_list.items.len;
        for (root_resolutions) |package_id| {
            if (package_id >= max) continue;
            if (std.mem.indexOfScalar(PackageID, root_package_list.items[0..possible_duplicates_len], package_id) != null) continue;

            root_package_list.appendAssumeCapacity(package_id);
        }
        {
            var sliced = tree_list.slice();
            var trees = sliced.items(.tree);
            var packages = sliced.items(.packages);
            trees[0] = .{
                .parent = Tree.invalid_id,
                .id = 0,
                .packages = .{
                    .len = @truncate(PackageID, root_package_list.items.len),
                },
            };
            packages[0] = root_package_list;

            std.mem.set(PackageIDList, packages[1..], PackageIDList{});
            std.mem.set(Tree, trees[1..], Tree{});
        }

        var builder = Tree.Builder{
            .name_hashes = name_hashes,
            .list = tree_list,
            .queue = tree_filler_queue,
            .resolution_lists = resolutions_lists,
            .resolutions = resolutions_buffer,
            .allocator = allocator,
            .dependencies = this.lockfile.buffers.dependencies.items,
        };
        var builder_ = &builder;

        for (root_resolutions) |package_id| {
            if (package_id >= max) continue;

            try builder.list.items(.tree)[0].processSubtree(
                package_id,
                builder_,
            );
        }

        // This goes breadth-first
        while (builder.queue.readItem()) |pids| {
            try builder.list.items(.tree)[pids[1]].processSubtree(pids[0], builder_);
        }

        var tree_packages = try builder.clean();
        this.lockfile.buffers.hoisted_packages = Lockfile.PackageIDList{
            .items = tree_packages,
            .capacity = tree_packages.len,
        };
        {
            const final = builder.list.items(.tree);
            this.lockfile.buffers.trees = Tree.List{
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

    var lockfile_path_buf1: [bun.MAX_PATH_BYTES]u8 = undefined;
    var lockfile_path_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;

    pub fn print(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        lockfile_path_: string,
        format: Format,
    ) !void {
        @setCold(true);

        var lockfile_path: stringZ = "";

        if (!std.fs.path.isAbsolute(lockfile_path_)) {
            var cwd = try std.os.getcwd(&lockfile_path_buf1);
            var parts = [_]string{lockfile_path_};
            var lockfile_path__ = Path.joinAbsStringBuf(cwd, &lockfile_path_buf2, &parts, .auto);
            lockfile_path_buf2[lockfile_path__.len] = 0;
            lockfile_path = lockfile_path_buf2[0..lockfile_path__.len :0];
        } else {
            std.mem.copy(u8, &lockfile_path_buf1, lockfile_path);
            lockfile_path_buf1[lockfile_path_.len] = 0;
            lockfile_path = lockfile_path_buf1[0..lockfile_path_.len :0];
        }

        if (lockfile_path.len > 0 and lockfile_path[0] == std.fs.path.sep)
            std.os.chdir(std.fs.path.dirname(lockfile_path) orelse "/") catch {};

        _ = try FileSystem.init1(allocator, null);

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
                }
                if (log.errors > 0) {
                    if (Output.enable_ansi_colors) {
                        try log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                    } else {
                        try log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                    }
                }
                Global.exit(1);
                return;
            },
            .not_found => {
                Output.prettyErrorln("<r><red>lockfile not found:<r> {s}", .{
                    std.mem.span(lockfile_path),
                });
                Global.exit(1);
                return;
            },

            .ok => {},
        }

        var writer = Output.writer();
        try printWithLockfile(allocator, lockfile, format, @TypeOf(writer), writer);
        Output.flush();
    }

    pub fn printWithLockfile(
        allocator: std.mem.Allocator,
        lockfile: *Lockfile,
        format: Format,
        comptime Writer: type,
        writer: Writer,
    ) !void {
        var fs = &FileSystem.instance;
        var options = PackageManager.Options{};

        var entries_option = try fs.fs.readDirectory(fs.top_level_dir, null);

        var env_loader: *DotEnv.Loader = brk: {
            var map = try allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(allocator);

            var loader = try allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, allocator);
            break :brk loader;
        };

        env_loader.loadProcess();
        try env_loader.load(&fs.fs, &entries_option.entries, false);
        var log = logger.Log.init(allocator);
        try options.load(
            allocator,
            &log,
            env_loader,
            null,
            null,
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
        pub fn print(
            this: *Printer,
            comptime Writer: type,
            writer: Writer,
            comptime enable_ansi_colors: bool,
        ) !void {
            var visited = try Bitset.initEmpty(this.lockfile.packages.len, this.lockfile.allocator);

            var slice = this.lockfile.packages.slice();
            const names: []const String = slice.items(.name);
            const names_hashes: []const PackageNameHash = slice.items(.name_hash);
            const bins: []const Bin = slice.items(.bin);
            const resolved: []const Resolution = slice.items(.resolution);
            if (names.len == 0) return;
            const resolutions_list = slice.items(.resolutions);
            const resolutions_buffer = this.lockfile.buffers.resolutions.items;
            const string_buf = this.lockfile.buffers.string_bytes.items;
            var id_map = try default_allocator.alloc(PackageID, this.updates.len);
            std.mem.set(PackageID, id_map, std.math.maxInt(PackageID));
            defer if (id_map.len > 0) default_allocator.free(id_map);

            visited.set(0);
            const end = @truncate(PackageID, names.len);

            if (this.successfully_installed) |installed| {
                outer: for (resolutions_list[0].get(resolutions_buffer)) |package_id| {
                    if (package_id > end) continue;
                    const is_new = installed.isSet(package_id);

                    const package_name = names[package_id].slice(string_buf);

                    if (this.updates.len > 0) {
                        const name_hash = names_hashes[package_id];
                        for (this.updates) |update, update_id| {
                            if (update.failed) return;
                            if (update.name.len == package_name.len and name_hash == update.name_hash) {
                                if (id_map[update_id] == std.math.maxInt(PackageID)) {
                                    id_map[update_id] = @truncate(PackageID, package_id);
                                }

                                continue :outer;
                            }
                        }
                    }

                    if (!is_new) continue;

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
            } else {
                outer: for (names) |name, package_id| {
                    const package_name = name.slice(string_buf);

                    if (this.updates.len > 0) {
                        const name_hash = names_hashes[package_id];
                        for (this.updates) |update, update_id| {
                            if (update.failed) return;

                            if (update.name.len == package_name.len and name_hash == update.name_hash) {
                                if (id_map[update_id] == std.math.maxInt(PackageID)) {
                                    id_map[update_id] = @truncate(PackageID, package_id);
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

            if (this.updates.len > 0) {
                try writer.writeAll("\n");
            }

            for (this.updates) |_, update_id| {
                const package_id = id_map[update_id];
                if (package_id == std.math.maxInt(PackageID)) continue;
                const name = names[package_id];
                const bin = bins[package_id];

                const package_name = name.slice(string_buf);

                switch (bin.tag) {
                    .none, .dir => {
                        const fmt = comptime brk: {
                            if (enable_ansi_colors) {
                                break :brk Output.prettyFmt("<r> <green>installed<r> <b>{s}<r><d>@{}<r>\n", enable_ansi_colors);
                            } else {
                                break :brk Output.prettyFmt("<r> installed {s}<r><d>@{}<r>\n", enable_ansi_colors);
                            }
                        };

                        try writer.print(
                            comptime Output.prettyFmt(fmt, enable_ansi_colors),
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

                        const fmt = comptime brk: {
                            if (enable_ansi_colors) {
                                break :brk Output.prettyFmt("<r> <green>installed<r> {s}<r><d>@{}<r> with binaries:\n", enable_ansi_colors);
                            } else {
                                break :brk Output.prettyFmt("<r> installed {s}<r><d>@{}<r> with binaries:\n", enable_ansi_colors);
                            }
                        };

                        try writer.print(
                            comptime Output.prettyFmt(fmt, enable_ansi_colors),
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
            try writer.writeAll(
                \\# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
                \\# yarn lockfile v1
                \\# bun ./bun.lockb --hash: 
            );
            try writer.print(
                "{}\n\n",
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
            const package_count = @truncate(PackageID, names.len);
            var alphabetized_names = try this.lockfile.allocator.alloc(PackageID, package_count - 1);
            defer this.lockfile.allocator.free(alphabetized_names);

            const string_buf = this.lockfile.buffers.string_bytes.items;

            // First, we need to build a map of all requested versions
            // This is so we can print requested versions
            {
                var i: PackageID = 1;
                while (i < package_count) : (i += 1) {
                    alphabetized_names[i - 1] = @truncate(PackageID, i);

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

                    var dependency_versions = requested_version_start[0..j];
                    if (dependency_versions.len > 1) std.sort.insertionSort(Dependency.Version, dependency_versions, string_buf, Dependency.Version.isLessThan);
                    try requested_versions.put(i, dependency_versions);
                }
            }

            std.sort.sort(
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

                // This prints:
                // "@babel/core@7.9.0":
                {
                    try writer.writeAll("\n");

                    const dependency_versions = requested_versions.get(i).?;
                    const always_needs_quote = name[0] == '@';
                    var prev_dependency_version: ?Dependency.Version = null;
                    var needs_comma = false;
                    for (dependency_versions) |dependency_version| {
                        if (needs_comma) {
                            if (prev_dependency_version) |prev| {
                                if (prev.eql(dependency_version, string_buf, string_buf)) {
                                    continue;
                                }
                            }
                            try writer.writeAll(", ");
                            needs_comma = false;
                        }
                        const version_name = dependency_version.literal.slice(string_buf);
                        const needs_quote = always_needs_quote or std.mem.indexOfAny(u8, version_name, " |\t-/!") != null;

                        if (needs_quote) {
                            try writer.writeByte('"');
                        }

                        try writer.writeAll(name);
                        try writer.writeByte('@');
                        try writer.writeAll(version_name);

                        if (needs_quote) {
                            try writer.writeByte('"');
                        }
                        prev_dependency_version = dependency_version;
                        needs_comma = true;
                    }

                    try writer.writeAll(":\n");
                }

                {
                    try writer.writeAll("  version ");

                    const version_formatter = resolution.fmt(string_buf);

                    // Version is always quoted
                    try std.fmt.format(writer, "\"{any}\"\n", .{version_formatter});

                    try writer.writeAll("  resolved ");

                    const url_formatter = resolution.fmtURL(&this.options, name, string_buf);

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
                            if (dep.behavior != behavior) {
                                if (dep.behavior.isOptional()) {
                                    try writer.writeAll("  optionalDependencies:\n");
                                    if (comptime Environment.isDebug or Environment.isTest) dependency_behavior_change_count += 1;
                                } else if (dep.behavior.isNormal()) {
                                    try writer.writeAll("  dependencies:\n");
                                    if (comptime Environment.isDebug or Environment.isTest) dependency_behavior_change_count += 1;
                                } else if (dep.behavior.isDev()) {
                                    try writer.writeAll("  devDependencies:\n");
                                    if (comptime Environment.isDebug or Environment.isTest) dependency_behavior_change_count += 1;
                                } else {
                                    continue;
                                }
                                behavior = dep.behavior;

                                // assert its sorted
                                if (comptime Environment.isDebug or Environment.isTest) std.debug.assert(dependency_behavior_change_count < 3);
                            }

                            try writer.writeAll("    ");
                            const dependency_name = dep.name.slice(string_buf);
                            const needs_quote = dependency_name[0] == '@';
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
    {
        var i: usize = 0;
        while (i < this.packages.len) : (i += 1) {
            const package: Lockfile.Package = this.packages.get(i);
            std.debug.assert(this.str(package.name).len == @as(usize, package.name.len()));
            std.debug.assert(stringHash(this.str(package.name)) == @as(usize, package.name_hash));
            std.debug.assert(package.dependencies.get(this.buffers.dependencies.items).len == @as(usize, package.dependencies.len));
            std.debug.assert(package.resolutions.get(this.buffers.resolutions.items).len == @as(usize, package.resolutions.len));
            std.debug.assert(package.resolutions.get(this.buffers.resolutions.items).len == @as(usize, package.dependencies.len));
            const dependencies = package.dependencies.get(this.buffers.dependencies.items);
            for (dependencies) |dependency| {
                std.debug.assert(this.str(dependency.name).len == @as(usize, dependency.name.len()));
                std.debug.assert(stringHash(this.str(dependency.name)) == dependency.name_hash);
            }
        }
    }
}

pub fn verifyResolutions(this: *Lockfile, local_features: Features, remote_features: Features, comptime log_level: PackageManager.Options.LogLevel) void {
    const resolutions_list: []const PackageIDSlice = this.packages.items(.resolutions);
    const dependency_lists: []const DependencySlice = this.packages.items(.dependencies);
    const dependencies_buffer = this.buffers.dependencies.items;
    const resolutions_buffer = this.buffers.resolutions.items;
    const end = @truncate(PackageID, this.packages.len);

    var any_failed = false;
    const string_buf = this.buffers.string_bytes.items;

    const root_list = resolutions_list[0];
    for (resolutions_list) |list, parent_id| {
        for (list.get(resolutions_buffer)) |package_id, j| {
            if (package_id >= end) {
                const failed_dep: Dependency = dependency_lists[parent_id].get(dependencies_buffer)[j];
                if (!failed_dep.behavior.isEnabled(if (root_list.contains(@truncate(PackageID, parent_id)))
                    local_features
                else
                    remote_features)) continue;
                if (log_level != .silent)
                    Output.prettyErrorln(
                        "<r><red>error<r><d>:<r> <b>{s}<r><d>@<b>{}<r><d> failed to resolve<r>\n",
                        .{
                            failed_dep.name.slice(string_buf),
                            failed_dep.version.literal.fmt(string_buf),
                        },
                    );
                // track this so we can log each failure instead of just the first
                any_failed = true;
            }
        }
    }

    if (any_failed) {
        Global.exit(1);
    }
}

pub fn saveToDisk(this: *Lockfile, filename: stringZ) void {
    if (comptime Environment.allow_assert) {
        this.verifyData() catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to verify lockfile: {s}", .{@errorName(err)});
            Global.crash();
        };
    }
    std.debug.assert(FileSystem.instance_loaded);
    var tmpname_buf: [512]u8 = undefined;
    tmpname_buf[0..8].* = "bunlock-".*;
    var tmpfile = FileSystem.RealFS.Tmpfile{};
    var secret: [32]u8 = undefined;
    std.mem.writeIntNative(u64, secret[0..8], @intCast(u64, std.time.milliTimestamp()));
    var rng = std.rand.Xoodoo.init(secret);
    var base64_bytes: [64]u8 = undefined;
    rng.random().bytes(&base64_bytes);

    const tmpname__ = std.fmt.bufPrint(tmpname_buf[8..], "{s}", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;
    tmpname_buf[tmpname__.len + 8] = 0;
    const tmpname = tmpname_buf[0 .. tmpname__.len + 8 :0];

    tmpfile.create(&FileSystem.instance.fs, tmpname) catch |err| {
        Output.prettyErrorln("<r><red>error:<r> failed to open lockfile: {s}", .{@errorName(err)});
        Global.crash();
    };

    var file = tmpfile.file();

    Lockfile.Serializer.save(this, std.fs.File, file) catch |err| {
        tmpfile.dir().deleteFileZ(tmpname) catch {};
        Output.prettyErrorln("<r><red>error:<r> failed to serialize lockfile: {s}", .{@errorName(err)});
        Global.crash();
    };

    _ = C.fchmod(
        tmpfile.fd,
        // chmod 777
        0000010 | 0000100 | 0000001 | 0001000 | 0000040 | 0000004 | 0000002 | 0000400 | 0000200 | 0000020,
    );

    tmpfile.promote(tmpname, std.fs.cwd().fd, filename) catch |err| {
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
    return slicable.slice(this.buffers.string_bytes.items);
}

pub fn initEmpty(this: *Lockfile, allocator: std.mem.Allocator) !void {
    this.* = Lockfile{
        .format = Lockfile.FormatVersion.current,
        .packages = Lockfile.Package.List{},
        .buffers = Buffers{},
        .package_index = PackageIndex.Map.initContext(allocator, .{}),
        .unique_packages = try Bitset.initFull(0, allocator),
        .string_pool = StringPool.init(allocator),
        .allocator = allocator,
        .scratch = Scratch.init(allocator),
        .scripts = .{},
    };
}

pub fn getPackageID(
    this: *Lockfile,
    name_hash: u64,
    // if it's a peer dependency, a folder, or a symlink
    version: ?Dependency.Version,
    resolution: Resolution,
) ?PackageID {
    const entry = this.package_index.get(name_hash) orelse return null;
    const resolutions: []const Resolution = this.packages.items(.resolution);
    switch (entry) {
        .PackageID => |id| {
            if (comptime Environment.isDebug or Environment.isTest) {
                std.debug.assert(id != invalid_package_id);
                std.debug.assert(id != invalid_package_id - 1);
            }

            if (resolutions[id].eql(
                resolution,
                this.buffers.string_bytes.items,
                this.buffers.string_bytes.items,
            )) {
                return id;
            } else if (version) |version_| {
                switch (version_.tag) {
                    .npm => {
                        // is it a peerDependency satisfied by a parent package?
                        if (version_.value.npm.satisfies(resolutions[id].value.npm.version)) {
                            return id;
                        }
                    },
                    else => return null,
                }
            }
        },
        .PackageIDMultiple => |multi_| {
            const multi = std.mem.span(multi_);

            const can_satisfy = version != null and version.?.tag == .npm;

            for (multi) |id| {
                if (comptime Environment.isDebug or Environment.isTest) {
                    std.debug.assert(id != invalid_package_id);
                }

                if (id == invalid_package_id - 1) return null;

                if (resolutions[id].eql(resolution, this.buffers.string_bytes.items, this.buffers.string_bytes.items)) {
                    return id;
                }

                if (can_satisfy and version.?.value.npm.satisfies(resolutions[id].value.npm.version)) {
                    return id;
                }
            }
        },
    }

    return null;
}

pub fn getOrPutID(this: *Lockfile, id: PackageID, name_hash: PackageNameHash) !void {
    if (this.unique_packages.capacity() < this.packages.len) try this.unique_packages.resize(this.packages.len, true, this.allocator);
    var gpe = try this.package_index.getOrPut(name_hash);

    if (gpe.found_existing) {
        var index: *PackageIndex.Entry = gpe.value_ptr;

        this.unique_packages.unset(id);

        switch (index.*) {
            .PackageID => |single_| {
                var ids = try this.allocator.alloc(PackageID, 8);
                ids[0] = single_;
                ids[1] = id;
                this.unique_packages.unset(single_);
                for (ids[2..7]) |_, i| {
                    ids[i + 2] = invalid_package_id - 1;
                }
                ids[7] = invalid_package_id;
                // stage1 compiler doesn't like this
                var ids_sentinel = ids.ptr[0 .. ids.len - 1 :invalid_package_id];
                index.* = .{
                    .PackageIDMultiple = ids_sentinel,
                };
            },
            .PackageIDMultiple => |ids_| {
                var ids = std.mem.span(ids_);
                for (ids) |id2, i| {
                    if (id2 == invalid_package_id - 1) {
                        ids[i] = id;
                        return;
                    }
                }

                var new_ids = try this.allocator.alloc(PackageID, ids.len + 8);
                defer this.allocator.free(ids);
                std.mem.set(PackageID, new_ids, invalid_package_id - 1);
                for (ids) |id2, i| {
                    new_ids[i] = id2;
                }
                new_ids[new_ids.len - 1] = invalid_package_id;

                // stage1 compiler doesn't like this
                var new_ids_sentinel = new_ids.ptr[0 .. new_ids.len - 1 :invalid_package_id];
                index.* = .{
                    .PackageIDMultiple = new_ids_sentinel,
                };
            },
        }
    } else {
        gpe.value_ptr.* = .{ .PackageID = id };
        this.unique_packages.set(id);
    }
}

pub fn appendPackage(this: *Lockfile, package_: Lockfile.Package) !Lockfile.Package {
    const id = @truncate(PackageID, this.packages.len);
    return try appendPackageWithID(this, package_, id);
}

pub fn appendPackageWithID(this: *Lockfile, package_: Lockfile.Package, id: PackageID) !Lockfile.Package {
    defer {
        if (comptime Environment.isDebug) {
            std.debug.assert(this.getPackageID(package_.name_hash, null, package_.resolution) != null);
        }
    }
    var package = package_;
    package.meta.id = id;
    try this.packages.append(this.allocator, package);
    try this.getOrPutID(id, package.name_hash);

    return package;
}

const StringPool = String.Builder.StringPool;

pub inline fn stringHash(in: []const u8) u64 {
    return std.hash.Wyhash.hash(0, in);
}

pub inline fn stringBuilder(this: *Lockfile) Lockfile.StringBuilder {
    return Lockfile.StringBuilder{
        .lockfile = this,
    };
}

pub const Scratch = struct {
    pub const DuplicateCheckerMap = std.HashMap(PackageNameHash, logger.Loc, IdentityContext(PackageNameHash), 80);
    pub const DependencyQueue = std.fifo.LinearFifo(DependencySlice, .Dynamic);

    duplicate_checker_map: DuplicateCheckerMap = undefined,
    dependency_list_queue: DependencyQueue = undefined,

    pub fn init(allocator: std.mem.Allocator) Scratch {
        return Scratch{
            .dependency_list_queue = DependencyQueue.init(allocator),
            .duplicate_checker_map = DuplicateCheckerMap.init(allocator),
        };
    }
};

pub const StringBuilder = struct {
    const Allocator = @import("std").mem.Allocator;
    const assert = @import("std").debug.assert;
    const copy = @import("std").mem.copy;

    len: usize = 0,
    cap: usize = 0,
    off: usize = 0,
    ptr: ?[*]u8 = null,
    lockfile: *Lockfile = undefined,

    pub inline fn count(this: *StringBuilder, slice: string) void {
        if (String.canInline(slice)) return;
        return countWithHash(this, slice, stringHash(slice));
    }

    pub inline fn countWithHash(this: *StringBuilder, slice: string, hash: u64) void {
        if (String.canInline(slice)) return;
        if (!this.lockfile.string_pool.contains(hash)) {
            this.cap += slice.len;
        }
    }

    pub fn allocatedSlice(this: *StringBuilder) []const u8 {
        if (this.ptr == null) return "";
        return this.ptr.?[0..this.cap];
    }

    pub fn clamp(this: *StringBuilder) void {
        std.debug.assert(this.cap >= this.len);

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
        return @call(.{ .modifier = .always_inline }, appendWithHash, .{ this, Type, slice, stringHash(slice) });
    }

    // SlicedString is not supported due to inline strings.
    pub fn appendWithoutPool(this: *StringBuilder, comptime Type: type, slice: string, hash: u64) Type {
        if (String.canInline(slice)) {
            switch (Type) {
                String => {
                    return String.init(this.lockfile.buffers.string_bytes.items, slice);
                },
                ExternalString => {
                    return ExternalString.init(this.lockfile.buffers.string_bytes.items, slice, hash);
                },
                else => @compileError("Invalid type passed to StringBuilder"),
            }
        }
        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first

        copy(u8, this.ptr.?[this.len..this.cap], slice);
        const final_slice = this.ptr.?[this.len..this.cap][0..slice.len];
        this.len += slice.len;

        assert(this.len <= this.cap);

        switch (Type) {
            String => {
                return String.init(this.lockfile.buffers.string_bytes.items, final_slice);
            },
            ExternalString => {
                return ExternalString.init(this.lockfile.buffers.string_bytes.items, final_slice, hash);
            },
            else => @compileError("Invalid type passed to StringBuilder"),
        }
    }

    pub fn appendWithHash(this: *StringBuilder, comptime Type: type, slice: string, hash: u64) Type {
        if (String.canInline(slice)) {
            switch (Type) {
                String => {
                    return String.init(this.lockfile.buffers.string_bytes.items, slice);
                },
                ExternalString => {
                    return ExternalString.init(this.lockfile.buffers.string_bytes.items, slice, hash);
                },
                else => @compileError("Invalid type passed to StringBuilder"),
            }
        }

        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first

        var string_entry = this.lockfile.string_pool.getOrPut(hash) catch unreachable;
        if (!string_entry.found_existing) {
            copy(u8, this.ptr.?[this.len..this.cap], slice);
            const final_slice = this.ptr.?[this.len..this.cap][0..slice.len];
            this.len += slice.len;

            string_entry.value_ptr.* = String.init(this.lockfile.buffers.string_bytes.items, final_slice);
        }

        assert(this.len <= this.cap);

        switch (Type) {
            String => {
                return string_entry.value_ptr.*;
            },
            ExternalString => {
                return ExternalString{
                    .value = string_entry.value_ptr.*,
                    .hash = hash,
                };
            },
            else => @compileError("Invalid type passed to StringBuilder"),
        }
    }
};

pub const PackageIndex = struct {
    pub const Map = std.HashMap(PackageNameHash, PackageIndex.Entry, IdentityContext(PackageNameHash), 80);
    pub const Entry = union(Tag) {
        PackageID: PackageID,
        PackageIDMultiple: PackageIDMultiple,

        pub const Tag = enum(u8) {
            PackageID = 0,
            PackageIDMultiple = 1,
        };
    };
};

pub const FormatVersion = enum(u32) {
    v0,
    // bun v0.0.x - bun v0.1.6
    v1,
    // bun v0.1.7+
    // This change added tarball URLs to npm-resolved packages
    v2,
    _,
    pub const current = FormatVersion.v2;
};

pub const DependencySlice = ExternalSlice(Dependency);
pub const PackageIDSlice = ExternalSlice(PackageID);

pub const PackageIDList = std.ArrayListUnmanaged(PackageID);
pub const DependencyList = std.ArrayListUnmanaged(Dependency);
pub const StringBuffer = std.ArrayListUnmanaged(u8);
pub const ExternalStringBuffer = std.ArrayListUnmanaged(ExternalString);

pub const Package = extern struct {
    pub const DependencyGroup = struct {
        prop: string,
        field: string,
        behavior: Behavior,

        pub const dependencies = DependencyGroup{ .prop = "dependencies", .field = "dependencies", .behavior = @intToEnum(Behavior, Behavior.normal) };
        pub const dev = DependencyGroup{ .prop = "devDependencies", .field = "dev_dependencies", .behavior = @intToEnum(Behavior, Behavior.dev) };
        pub const optional = DependencyGroup{ .prop = "optionalDependencies", .field = "optional_dependencies", .behavior = @intToEnum(Behavior, Behavior.optional) };
        pub const peer = DependencyGroup{ .prop = "peerDependencies", .field = "peer_dependencies", .behavior = @intToEnum(Behavior, Behavior.peer) };
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

    pub fn clone(
        this_: *const Lockfile.Package,
        old: *Lockfile,
        new: *Lockfile,
        package_id_mapping: []PackageID,
        cloner: *Cloner,
    ) !PackageID {
        const this = this_.*;
        const old_string_buf = old.buffers.string_bytes.items;
        const old_extern_string_buf = old.buffers.extern_strings.items;
        var builder_ = new.stringBuilder();
        var builder = &builder_;

        builder.count(this.name.slice(old_string_buf));
        this.resolution.count(old_string_buf, *Lockfile.StringBuilder, builder);
        this.meta.count(old_string_buf, *Lockfile.StringBuilder, builder);
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

        const prev_len = @truncate(u32, new.buffers.dependencies.items.len);
        const end = prev_len + @truncate(u32, old_dependencies.len);
        const max_package_id = @truncate(PackageID, old.packages.len);

        new.buffers.dependencies.items = new.buffers.dependencies.items.ptr[0..end];
        new.buffers.resolutions.items = new.buffers.resolutions.items.ptr[0..end];

        new.buffers.extern_strings.items.len += new_extern_string_count;
        var new_extern_strings = new.buffers.extern_strings.items[new.buffers.extern_strings.items.len - new_extern_string_count ..];

        var dependencies: []Dependency = new.buffers.dependencies.items[prev_len..end];
        var resolutions: []PackageID = new.buffers.resolutions.items[prev_len..end];

        const id = @truncate(PackageID, new.packages.len);
        const new_package = try new.appendPackageWithID(
            Lockfile.Package{
                .name = builder.appendWithHash(
                    String,
                    this.name.slice(old_string_buf),
                    this.name_hash,
                ),
                .bin = this.bin.clone(old_string_buf, old_extern_string_buf, new.buffers.extern_strings.items, new_extern_strings, *Lockfile.StringBuilder, builder),
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
                .dependencies = .{ .off = prev_len, .len = end - prev_len },
                .resolutions = .{ .off = prev_len, .len = end - prev_len },
            },
            id,
        );

        package_id_mapping[this.meta.id] = new_package.meta.id;

        for (old_dependencies) |dependency, i| {
            dependencies[i] = try dependency.clone(
                old_string_buf,
                *Lockfile.StringBuilder,
                builder,
            );
        }

        builder.clamp();

        cloner.trees_count += @as(u32, @boolToInt(old_resolutions.len > 0));

        for (old_resolutions) |old_resolution, i| {
            if (old_resolution >= max_package_id) continue;

            const mapped = package_id_mapping[old_resolution];
            const resolve_id = new_package.resolutions.off + @intCast(PackageID, i);

            if (mapped < max_package_id) {
                resolutions[i] = mapped;
            } else {
                try cloner.clone_queue.append(
                    PendingResolution{
                        .old_resolution = old_resolution,
                        .parent = new_package.meta.id,
                        .resolve_id = resolve_id,
                    },
                );
            }
        }

        return new_package.meta.id;
    }

    pub fn fromPackageJSON(
        allocator: std.mem.Allocator,
        lockfile: *Lockfile,
        log: *logger.Log,
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
            var dependencies = package_json.dependencies.map.values();
            for (dependencies) |dep| {
                if (dep.behavior.isEnabled(features)) {
                    dep.count(package_json.dependencies.source_buf, @TypeOf(&string_builder), &string_builder);
                    total_dependencies_count += 1;
                }
            }
        }

        // string_builder.count(manifest.str(package_version_ptr.tarball_url));

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
            var package_version = string_builder.append(String, package_json.version);
            var buf = string_builder.allocatedSlice();

            const version: Dependency.Version = brk: {
                if (package_json.version.len > 0) {
                    const sliced = package_version.sliced(buf);
                    const name = package.name.slice(buf);
                    if (Dependency.parse(allocator, name, &sliced, log)) |dep| {
                        break :brk dep;
                    }
                }

                break :brk Dependency.Version{};
            };

            if (version.tag == .npm and version.value.npm.isExact()) {
                package.resolution = Resolution{
                    .value = .{
                        .npm = .{
                            .version = version.value.npm.toVersion(),
                            .url = .{},
                        },
                    },
                    .tag = .npm,
                };
            } else {
                package.resolution = Resolution{
                    .value = .{
                        .root = {},
                    },
                    .tag = .root,
                };
            }
            const total_len = dependencies_list.items.len + total_dependencies_count;
            std.debug.assert(dependencies_list.items.len == resolutions_list.items.len);

            var dependencies: []Dependency = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
            std.mem.set(Dependency, dependencies, Dependency{});

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

            package.dependencies.off = @truncate(u32, dependencies_list.items.len);
            package.dependencies.len = total_dependencies_count - @truncate(u32, dependencies.len);
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            const new_length = package.dependencies.len + dependencies_list.items.len;

            std.mem.set(PackageID, resolutions_list.items.ptr[package.dependencies.off .. package.dependencies.off + package.dependencies.len], invalid_package_id);

            dependencies_list.items = dependencies_list.items.ptr[0..new_length];
            resolutions_list.items = resolutions_list.items.ptr[0..new_length];

            return package;
        }
    }

    pub fn fromNPM(
        allocator: std.mem.Allocator,
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
                @as(usize, @boolToInt(features.dependencies)) +
                    @as(usize, @boolToInt(features.dev_dependencies)) +
                    @as(usize, @boolToInt(features.optional_dependencies)) +
                    @as(usize, @boolToInt(features.peer_dependencies))
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

                for (keys) |key, i| {
                    string_builder.count(key.slice(string_buf));
                    string_builder.count(version_strings[i].slice(string_buf));
                }
            }

            bin_extern_strings_count = package_version.bin.count(string_buf, manifest.extern_strings_bin_entries, @TypeOf(&string_builder), &string_builder);
        }

        string_builder.count(manifest.str(package_version_ptr.tarball_url));

        try string_builder.allocate();
        defer string_builder.clamp();
        var extern_strings_list = &lockfile.buffers.extern_strings;
        var dependencies_list = &lockfile.buffers.dependencies;
        var resolutions_list = &lockfile.buffers.resolutions;
        try dependencies_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
        try resolutions_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
        try extern_strings_list.ensureUnusedCapacity(lockfile.allocator, bin_extern_strings_count);
        extern_strings_list.items.len += bin_extern_strings_count;
        var extern_strings_slice = extern_strings_list.items[extern_strings_list.items.len - bin_extern_strings_count ..];

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
                        .url = string_builder.append(String, manifest.str(package_version_ptr.tarball_url)),
                    },
                },
                .tag = .npm,
            };

            const total_len = dependencies_list.items.len + total_dependencies_count;
            std.debug.assert(dependencies_list.items.len == resolutions_list.items.len);

            var dependencies: []Dependency = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
            std.mem.set(Dependency, dependencies, Dependency{});

            var start_dependencies = dependencies;

            inline for (dependency_groups) |group| {
                const map: ExternalStringMap = @field(package_version, group.field);
                const keys = map.name.get(manifest.external_strings);
                const version_strings = map.value.get(manifest.external_strings_for_versions);

                if (comptime Environment.isDebug) std.debug.assert(keys.len == version_strings.len);
                const is_peer = comptime strings.eqlComptime(group.field, "peer_dependencies");
                var i: usize = 0;

                list: while (i < keys.len) {
                    const key = keys[i];
                    const version_string_ = version_strings[i];

                    // Duplicate peer & dev dependencies are promoted to whichever appeared first
                    // In practice, npm validates this so it shouldn't happen
                    if (comptime group.behavior.isPeer() or group.behavior.isDev()) {
                        for (start_dependencies[0 .. total_dependencies_count - dependencies.len]) |dependency| {
                            if (dependency.name_hash == key.hash) {
                                i += 1;
                                continue :list;
                            }
                        }
                    }

                    const name: ExternalString = string_builder.appendWithHash(ExternalString, key.slice(string_buf), key.hash);
                    const dep_version = string_builder.appendWithHash(String, version_string_.slice(string_buf), version_string_.hash);
                    const sliced = dep_version.sliced(lockfile.buffers.string_bytes.items);

                    const dependency = Dependency{
                        .name = name.value,
                        .name_hash = name.hash,
                        .behavior = if (comptime is_peer)
                            group.behavior.setOptional(package_version.optional_peer_dependencies_len > i)
                        else
                            group.behavior,
                        .version = Dependency.parse(
                            allocator,
                            sliced.slice,
                            &sliced,
                            log,
                        ) orelse Dependency.Version{},
                    };

                    // If a dependency appears in both "dependencies" and "optionalDependencies", it is considered optional!
                    if (comptime group.behavior.isOptional()) {
                        for (start_dependencies[0 .. total_dependencies_count - dependencies.len]) |dep, j| {
                            if (dep.name_hash == key.hash) {
                                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies
                                // > Entries in optionalDependencies will override entries of the same name in dependencies, so it's usually best to only put in one place.
                                start_dependencies[j] = dep;

                                i += 1;
                                continue :list;
                            }
                        }
                    }

                    dependencies[0] = dependency;
                    dependencies = dependencies[1..];
                    i += 1;
                }
            }

            package.bin = package_version.bin.clone(string_buf, manifest.extern_strings_bin_entries, extern_strings_list.items, extern_strings_slice, @TypeOf(&string_builder), &string_builder);

            package.meta.arch = package_version.cpu;
            package.meta.os = package_version.os;

            package.meta.integrity = package_version.integrity;

            package.dependencies.off = @truncate(u32, dependencies_list.items.len);
            package.dependencies.len = total_dependencies_count - @truncate(u32, dependencies.len);
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            const new_length = package.dependencies.len + dependencies_list.items.len;

            std.mem.set(PackageID, resolutions_list.items.ptr[package.dependencies.off .. package.dependencies.off + package.dependencies.len], invalid_package_id);

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
            deduped: u32 = 0,

            pub inline fn sum(this: *Summary, that: Summary) void {
                this.add += that.add;
                this.remove += that.remove;
                this.update += that.update;
                this.deduped += that.deduped;
            }
        };

        pub fn generate(
            _: std.mem.Allocator,
            from_lockfile: *Lockfile,
            to_lockfile: *Lockfile,
            from: *Lockfile.Package,
            to: *Lockfile.Package,
            mapping: []PackageID,
        ) !Summary {
            var summary = Summary{};
            const to_deps = to.dependencies.get(to_lockfile.buffers.dependencies.items);
            const from_deps = from.dependencies.get(from_lockfile.buffers.dependencies.items);

            for (from_deps) |from_dep, i| {
                // common case: dependency is present in both versions and in the same position
                const to_i = if (to_deps.len > i and to_deps[i].name_hash == from_dep.name_hash)
                    i
                else brk: {
                    // less common, o(n^2) case
                    for (to_deps) |to_dep, j| {
                        if (from_dep.name_hash == to_dep.name_hash) break :brk j;
                    }

                    // We found a removed dependency!
                    // We don't need to remove it
                    // It will be cleaned up later
                    summary.remove += 1;
                    continue;
                };

                if (to_deps[to_i].eql(from_dep, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items)) {
                    mapping[to_i] = @truncate(PackageID, i);
                    continue;
                }

                // We found a changed dependency!
                summary.update += 1;
            }

            outer: for (to_deps) |to_dep, i| {
                if (from_deps.len > i and from_deps[i].name_hash == to_dep.name_hash) continue;

                for (from_deps) |from_dep| {
                    if (from_dep.name_hash == to_dep.name_hash) continue :outer;
                }

                summary.add += 1;
            }

            return summary;
        }
    };

    pub fn hash(name: string, version: Semver.Version) u64 {
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(name);
        hasher.update(std.mem.asBytes(&version));
        return hasher.final();
    }

    pub fn parseMain(
        lockfile: *Lockfile,
        package: *Lockfile.Package,
        allocator: std.mem.Allocator,
        log: *logger.Log,
        source: logger.Source,
        comptime features: Features,
    ) !void {
        return try parse(lockfile, package, allocator, log, source, void, void{}, features);
    }

    pub fn parse(
        lockfile: *Lockfile,
        package: *Lockfile.Package,
        allocator: std.mem.Allocator,
        log: *logger.Log,
        source: logger.Source,
        comptime ResolverContext: type,
        resolver: ResolverContext,
        comptime features: Features,
    ) !void {
        initializeStore();

        // A valid package.json always has "{}" characters
        if (source.contents.len < 2) return error.InvalidPackageJSON;

        var json = json_parser.ParseJSONUTF8(&source, log, allocator) catch |err| {
            if (Output.enable_ansi_colors) {
                log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }

            Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(err), source.path.prettyDir() });
            Global.exit(1);
        };

        try parseWithJSON(
            package,
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

    pub fn parseWithJSON(
        package: *Lockfile.Package,
        lockfile: *Lockfile,
        allocator: std.mem.Allocator,
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

        if (comptime features.scripts) {
            if (json.asProperty("scripts")) |scripts_prop| {
                if (scripts_prop.expr.data == .e_object) {
                    const scripts = .{
                        "install",
                        "postinstall",
                        "postprepare",
                        "preinstall",
                        "prepare",
                        "preprepare",
                    };

                    inline for (scripts) |script_name| {
                        if (scripts_prop.expr.get(script_name)) |script| {
                            if (script.asString(allocator)) |input| {
                                var list = @field(lockfile.scripts, script_name);
                                if (list.capacity == 0) {
                                    list.capacity = 1;
                                    list.items = try allocator.alloc(string, 1);
                                    list.items[0] = input;
                                } else {
                                    try list.append(allocator, input);
                                }

                                @field(lockfile.scripts, script_name) = list;
                            }
                        }
                    }
                }
            }
        }

        if (comptime ResolverContext != void) {
            resolver.count(*Lockfile.StringBuilder, &string_builder, json);
        }

        const dependency_groups = comptime brk: {
            var out_groups: [
                @as(usize, @boolToInt(features.dependencies)) +
                    @as(usize, @boolToInt(features.dev_dependencies)) +
                    @as(usize, @boolToInt(features.optional_dependencies)) +
                    @as(usize, @boolToInt(features.peer_dependencies))
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

        inline for (dependency_groups) |group| {
            if (json.asProperty(group.prop)) |dependencies_q| {
                if (dependencies_q.expr.data == .e_object) {
                    for (dependencies_q.expr.data.e_object.properties.slice()) |item| {
                        const key = item.key.?.asString(allocator) orelse "";
                        const value = item.value.?.asString(allocator) orelse "";

                        string_builder.count(key);
                        string_builder.count(value);

                        // If it's a folder, pessimistically assume we will need a maximum path
                        if (Dependency.Version.Tag.infer(value) == .folder) {
                            string_builder.cap += bun.MAX_PATH_BYTES;
                        }
                    }
                    total_dependencies_count += @truncate(u32, dependencies_q.expr.data.e_object.properties.len);
                }
            }
        }

        try string_builder.allocate();
        try lockfile.buffers.dependencies.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
        try lockfile.buffers.resolutions.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);

        const total_len = lockfile.buffers.dependencies.items.len + total_dependencies_count;
        std.debug.assert(lockfile.buffers.dependencies.items.len == lockfile.buffers.resolutions.items.len);
        const off = lockfile.buffers.dependencies.items.len;

        var package_dependencies = lockfile.buffers.dependencies.items.ptr[off..total_len];
        var dependencies = package_dependencies;

        if (json.asProperty("name")) |name_q| {
            if (name_q.expr.asString(allocator)) |name| {
                const external_string = string_builder.append(ExternalString, name);

                package.name = external_string.value;
                package.name_hash = external_string.hash;
            }
        }

        if (comptime !features.is_main) {
            if (comptime ResolverContext != void) {
                package.resolution = try resolver.resolve(*Lockfile.StringBuilder, &string_builder, json);
            }
        } else {
            package.resolution = .{
                .tag = .root,
                .value = .{ .root = .{} },
            };
        }

        // It is allowed for duplicate dependencies to exist in optionalDependencies and regular dependencies
        if (comptime features.check_for_duplicate_dependencies) {
            lockfile.scratch.duplicate_checker_map.clearRetainingCapacity();
            try lockfile.scratch.duplicate_checker_map.ensureTotalCapacity(total_dependencies_count);
        }

        inline for (dependency_groups) |group| {
            if (json.asProperty(group.prop)) |dependencies_q| {
                if (dependencies_q.expr.data == .e_object) {
                    const dependency_props: []const JSAst.G.Property = dependencies_q.expr.data.e_object.properties.slice();
                    var i: usize = 0;
                    outer: while (i < dependency_props.len) {
                        const item = dependency_props[i];

                        const name_ = item.key.?.asString(allocator) orelse "";
                        const version_ = item.value.?.asString(allocator) orelse "";

                        const external_name = string_builder.append(ExternalString, name_);

                        const external_version = string_builder.append(String, version_);

                        const sliced = external_version.sliced(
                            lockfile.buffers.string_bytes.items,
                        );

                        var dependency_version = Dependency.parse(
                            allocator,
                            sliced.slice,
                            &sliced,
                            log,
                        ) orelse Dependency.Version{};

                        if (dependency_version.tag == .folder) {
                            const folder_path = dependency_version.value.folder.slice(lockfile.buffers.string_bytes.items);
                            dependency_version.value.folder = string_builder.append(
                                String,
                                Path.relative(
                                    FileSystem.instance.top_level_dir,
                                    Path.joinAbsString(
                                        FileSystem.instance.top_level_dir,
                                        &[_]string{
                                            source.path.name.dir,
                                            folder_path,
                                        },
                                        .posix,
                                    ),
                                ),
                            );
                        }

                        const this_dep = Dependency{
                            .behavior = group.behavior,
                            .name = external_name.value,
                            .name_hash = external_name.hash,
                            .version = dependency_version,
                        };

                        if (comptime features.check_for_duplicate_dependencies) {
                            var entry = lockfile.scratch.duplicate_checker_map.getOrPutAssumeCapacity(external_name.hash);
                            if (entry.found_existing) {
                                // duplicate dependencies are allowed in optionalDependencies
                                if (comptime group.behavior.isOptional()) {
                                    for (package_dependencies[0 .. package_dependencies.len - dependencies.len]) |package_dep, j| {
                                        if (package_dep.name_hash == this_dep.name_hash) {
                                            package_dependencies[j] = this_dep;
                                            break;
                                        }
                                    }

                                    i += 1;
                                    continue :outer;
                                } else {
                                    var notes = try allocator.alloc(logger.Data, 1);

                                    notes[0] = logger.Data{
                                        .text = try std.fmt.allocPrint(lockfile.allocator, "\"{s}\" originally specified here", .{name_}),
                                        .location = logger.Location.init_or_nil(&source, source.rangeOfString(entry.value_ptr.*)),
                                    };

                                    try log.addRangeErrorFmtWithNotes(
                                        &source,
                                        source.rangeOfString(item.key.?.loc),
                                        lockfile.allocator,
                                        notes,
                                        "Duplicate dependency: \"{s}\" specified in package.json",
                                        .{name_},
                                    );
                                }
                            }

                            entry.value_ptr.* = item.value.?.loc;
                        }

                        dependencies[0] = this_dep;
                        dependencies = dependencies[1..];
                        i += 1;
                    }
                }
            }
        }

        std.sort.sort(
            Dependency,
            package_dependencies[0 .. package_dependencies.len - dependencies.len],
            lockfile.buffers.string_bytes.items,
            Dependency.isLessThan,
        );

        total_dependencies_count -= @truncate(u32, dependencies.len);
        package.dependencies.off = @truncate(u32, off);
        package.dependencies.len = @truncate(u32, total_dependencies_count);

        package.resolutions = @bitCast(@TypeOf(package.resolutions), package.dependencies);

        std.mem.set(PackageID, lockfile.buffers.resolutions.items.ptr[off..total_len], invalid_package_id);

        lockfile.buffers.dependencies.items = lockfile.buffers.dependencies.items.ptr[0 .. lockfile.buffers.dependencies.items.len + total_dependencies_count];
        lockfile.buffers.resolutions.items = lockfile.buffers.resolutions.items.ptr[0..lockfile.buffers.dependencies.items.len];

        string_builder.clamp();
    }

    pub const List = std.MultiArrayList(Lockfile.Package);

    pub const Meta = extern struct {
        origin: Origin = Origin.npm,
        arch: Npm.Architecture = Npm.Architecture.all,
        os: Npm.OperatingSystem = Npm.OperatingSystem.all,

        id: PackageID = invalid_package_id,

        man_dir: String = String{},
        integrity: Integrity = Integrity{},

        /// Does the `cpu` arch and `os` match the requirements listed in the package?
        /// This is completely unrelated to "devDependencies", "peerDependencies", "optionalDependencies" etc
        pub fn isDisabled(this: *const Meta) bool {
            return !this.arch.isMatch() or !this.os.isMatch();
        }

        pub fn count(this: *const Meta, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) void {
            builder.count(this.man_dir.slice(buf));
        }

        pub fn clone(this: *const Meta, id: PackageID, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) Meta {
            var new = this.*;
            new.id = id;
            new.man_dir = builder.append(String, this.man_dir.slice(buf));

            return new;
        }
    };

    name: String = String{},
    name_hash: PackageNameHash = 0,
    resolution: Resolution = Resolution{},
    dependencies: DependencySlice = DependencySlice{},
    resolutions: PackageIDSlice = PackageIDSlice{},
    meta: Meta = Meta{},
    bin: Bin = Bin{},

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
            for (fields) |field_info, i| {
                data[i] = .{
                    .size = @sizeOf(field_info.field_type),
                    .size_index = i,
                    .Type = field_info.field_type,
                    .alignment = if (@sizeOf(field_info.field_type) == 0) 1 else field_info.alignment,
                };
            }
            const Sort = struct {
                fn lessThan(trash: *i32, comptime lhs: Data, comptime rhs: Data) bool {
                    _ = trash;
                    return lhs.alignment > rhs.alignment;
                }
            };
            var trash: i32 = undefined; // workaround for stage1 compiler bug
            std.sort.sort(Data, &data, &trash, Sort.lessThan);
            var sizes_bytes: [fields.len]usize = undefined;
            var field_indexes: [fields.len]usize = undefined;
            var Types: [fields.len]type = undefined;
            for (data) |elem, i| {
                sizes_bytes[i] = elem.size;
                field_indexes[i] = elem.size_index;
                Types[i] = elem.Type;
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
            const capacity_vector = @splat(sizes.bytes.len, list.len);
            return @reduce(.Add, capacity_vector * sizes_vector);
        }

        const AlignmentType = sizes.Types[sizes.fields[0]];

        pub fn save(list: Lockfile.Package.List, comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer) !void {
            try writer.writeIntLittle(u64, list.len);
            try writer.writeIntLittle(u64, @alignOf(@TypeOf(list.bytes)));
            try writer.writeIntLittle(u64, sizes.Types.len);
            const begin_at = try stream.getPos();
            try writer.writeIntLittle(u64, 0);
            const end_at = try stream.getPos();
            try writer.writeIntLittle(u64, 0);

            _ = try Aligner.write(@TypeOf(list.bytes), Writer, writer, try stream.getPos());

            const really_begin_at = try stream.getPos();
            var sliced = list.slice();

            inline for (FieldsEnum.fields) |field| {
                try writer.writeAll(std.mem.sliceAsBytes(sliced.items(@field(Lockfile.Package.List.Field, field.name))));
            }

            const really_end_at = try stream.getPos();

            _ = try std.os.pwrite(stream.handle, std.mem.asBytes(&really_begin_at), begin_at);
            _ = try std.os.pwrite(stream.handle, std.mem.asBytes(&really_end_at), end_at);
        }

        pub fn load(
            stream: *Stream,
            end: usize,
            allocator: std.mem.Allocator,
        ) !Lockfile.Package.List {
            var reader = stream.reader();

            const list_len = try reader.readIntLittle(u64);
            if (list_len > std.math.maxInt(u32) - 1)
                return error.@"Lockfile validation failed: list is impossibly long";

            const input_alignment = try reader.readIntLittle(u64);

            var list = Lockfile.Package.List{};
            const Alingee = @TypeOf(list.bytes);
            const expected_alignment = @alignOf(Alingee);
            if (expected_alignment != input_alignment) {
                return error.@"Lockfile validation failed: alignment mismatch";
            }

            const field_count = try reader.readIntLittle(u64);

            if (field_count != sizes.Types.len) {
                return error.@"Lockfile validation failed: unexpected number of package fields";
            }

            const begin_at = try reader.readIntLittle(u64);
            const end_at = try reader.readIntLittle(u64);
            if (begin_at > end or end_at > end or begin_at > end_at) {
                return error.@"Lockfile validation failed: invalid package list range";
            }
            stream.pos = begin_at;
            try list.ensureTotalCapacity(allocator, list_len);
            list.len = list_len;
            var sliced = list.slice();

            inline for (FieldsEnum.fields) |field| {
                var bytes = std.mem.sliceAsBytes(sliced.items(@field(Lockfile.Package.List.Field, field.name)));
                @memcpy(bytes.ptr, stream.buffer[stream.pos..].ptr, bytes.len);
                stream.pos += bytes.len;
            }

            return list;
        }
    };
};

pub fn deinit(this: *Lockfile) void {
    this.buffers.deinit(this.allocator);
    this.packages.deinit(this.allocator);
    this.unique_packages.deinit(this.allocator);
    this.string_pool.deinit();
    this.* = undefined;
}

const Buffers = struct {
    trees: Tree.List = Tree.List{},
    hoisted_packages: PackageIDList = PackageIDList{},
    resolutions: PackageIDList = PackageIDList{},
    dependencies: DependencyList = DependencyList{},
    extern_strings: ExternalStringBuffer = ExternalStringBuffer{},
    // node_modules_folders: NodeModulesFolderList = NodeModulesFolderList{},
    // node_modules_package_ids: PackageIDList = PackageIDList{},
    string_bytes: StringBuffer = StringBuffer{},

    pub fn deinit(this: *Buffers, allocator: std.mem.Allocator) void {
        try this.trees.deinit(allocator);
        try this.resolutions.deinit(allocator);
        try this.dependencies.deinit(allocator);
        try this.extern_strings.deinit(allocator);
        try this.string_bytes.deinit(allocator);
    }

    pub fn preallocate(this: *Buffers, that: Buffers, allocator: std.mem.Allocator) !void {
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
            field_type: type,
            alignment: usize,
        };
        var data: [fields.len]Data = undefined;
        for (fields) |field_info, i| {
            data[i] = .{
                .size = @sizeOf(field_info.field_type),
                .name = field_info.name,
                .alignment = if (@sizeOf(field_info.field_type) == 0) 1 else field_info.alignment,
                .field_type = field_info.field_type.Slice,
            };
        }
        const Sort = struct {
            fn lessThan(trash: *i32, comptime lhs: Data, comptime rhs: Data) bool {
                _ = trash;
                return lhs.alignment > rhs.alignment;
            }
        };
        var trash: i32 = undefined; // workaround for stage1 compiler bug
        std.sort.sort(Data, &data, &trash, Sort.lessThan);
        var sizes_bytes: [fields.len]usize = undefined;
        var names: [fields.len][]const u8 = undefined;
        var types: [fields.len]type = undefined;
        for (data) |elem, i| {
            sizes_bytes[i] = elem.size;
            names[i] = elem.name;
            types[i] = elem.field_type;
        }
        break :blk .{
            .bytes = sizes_bytes,
            .names = names,
            .types = types,
        };
    };

    pub fn readArray(stream: *Stream, allocator: std.mem.Allocator, comptime ArrayList: type) !ArrayList {
        const arraylist: ArrayList = undefined;

        const PointerType = std.meta.Child(@TypeOf(arraylist.items.ptr));

        var reader = stream.reader();
        const start_pos = try reader.readIntLittle(u64);
        const end_pos = try reader.readIntLittle(u64);

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
            .items = try allocator.dupe(PointerType, @alignCast(@alignOf([*]PointerType), misaligned.ptr)[0..misaligned.len]),
            .capacity = misaligned.len,
        };
    }

    pub fn writeArray(comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer, comptime ArrayList: type, array: ArrayList) !void {
        const bytes = std.mem.sliceAsBytes(array);
        const start_pos = try stream.getPos();
        try writer.writeIntLittle(u64, 0xDEADBEEF);
        try writer.writeIntLittle(u64, 0xDEADBEEF);

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
                written += try std.os.pwrite(stream.handle, std.mem.asBytes(&positioned)[written..], start_pos + written);
            }
        } else {
            const real_end_pos = try stream.getPos();
            const positioned = [2]u64{ real_end_pos, real_end_pos };
            var written: usize = 0;
            while (written < 16) {
                written += try std.os.pwrite(stream.handle, std.mem.asBytes(&positioned)[written..], start_pos + written);
            }
        }
    }

    pub fn save(this: Buffers, allocator: std.mem.Allocator, comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer) !void {
        inline for (sizes.names) |name| {
            if (PackageManager.instance.options.log_level.isVerbose()) {
                Output.prettyErrorln("Saving {d} {s}", .{ @field(this, name).items.len, name });
            }

            // Dependencies have to be converted to .toExternal first
            // We store pointers in Version.Value, so we can't just write it directly
            if (comptime strings.eqlComptime(name, "dependencies")) {
                var remaining = this.dependencies.items;

                // It would be faster to buffer these instead of one big allocation
                var to_clone = try std.ArrayListUnmanaged(Dependency.External).initCapacity(allocator, remaining.len);

                defer to_clone.deinit(allocator);
                for (remaining) |dep| {
                    to_clone.appendAssumeCapacity(Dependency.toExternal(dep));
                }

                try writeArray(StreamType, stream, Writer, writer, []Dependency.External, to_clone.items);
            } else {
                var list = @field(this, name);
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

    pub fn load(stream: *Stream, allocator: std.mem.Allocator, log: *logger.Log) !Buffers {
        var this = Buffers{};
        var external_dependency_list_: std.ArrayListUnmanaged(Dependency.External) = std.ArrayListUnmanaged(Dependency.External){};

        inline for (sizes.names) |name, i| {
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

                for (tree_list.items) |tree, j| {
                    this.trees.items[j] = Tree.toTree(tree);
                }
            } else {
                @field(this, sizes.names[i]) = try readArray(stream, allocator, Type);
                if (PackageManager.instance.options.log_level.isVerbose()) {
                    Output.prettyErrorln("Loaded {d} {s}", .{ @field(this, sizes.names[i]).items.len, name });
                }
            }

            if (comptime Environment.isDebug) {
                // Output.prettyErrorln("Field {s}: {d} - {d}", .{ sizes.names[i], pos, try stream.getPos() });
            }
        }

        var external_dependency_list = external_dependency_list_.items;
        // Dependencies are serialized separately.
        // This is unfortunate. However, not using pointers for Semver Range's make the code a lot more complex.
        this.dependencies = try DependencyList.initCapacity(allocator, external_dependency_list.len);
        const extern_context = Dependency.Context{
            .log = log,
            .allocator = allocator,
            .buffer = this.string_bytes.items,
        };

        this.dependencies.expandToCapacity();
        this.dependencies.items.len = external_dependency_list.len;
        for (external_dependency_list) |dep, i| {
            this.dependencies.items[i] = Dependency.toDependency(dep, extern_context);
        }

        return this;
    }
};

pub const Serializer = struct {
    pub const version = "bun-lockfile-format-v0\n";
    const header_bytes: string = "#!/usr/bin/env bun\n" ++ version;

    pub fn save(this: *Lockfile, comptime StreamType: type, stream: StreamType) !void {
        var old_package_list = this.packages;
        this.packages = try this.packages.clone(z_allocator);
        old_package_list.deinit(this.allocator);

        var writer = stream.writer();
        try writer.writeAll(header_bytes);
        try writer.writeIntLittle(u32, @enumToInt(this.format));

        try writer.writeAll(&this.meta_hash);

        const pos = try stream.getPos();
        try writer.writeIntLittle(u64, 0);

        try Lockfile.Package.Serializer.save(this.packages, StreamType, stream, @TypeOf(&writer), &writer);
        try Lockfile.Buffers.save(this.buffers, z_allocator, StreamType, stream, @TypeOf(&writer), &writer);
        try writer.writeIntLittle(u64, 0);
        const end = try stream.getPos();

        try writer.writeIntLittle(u64, this.workspace_path.len);
        if (this.workspace_path.len > 0)
            try writer.writeAll(this.workspace_path);

        try writer.writeAll(&alignment_bytes_to_repeat_buffer);

        _ = try std.os.pwrite(stream.handle, std.mem.asBytes(&end), pos);
        try std.os.ftruncate(stream.handle, try stream.getPos());
    }
    pub fn load(
        lockfile: *Lockfile,
        stream: *Stream,
        allocator: std.mem.Allocator,
        log: *logger.Log,
    ) !void {
        var reader = stream.reader();
        var header_buf_: [header_bytes.len]u8 = undefined;
        var header_buf = header_buf_[0..try reader.readAll(&header_buf_)];

        if (!strings.eqlComptime(header_buf, header_bytes)) {
            return error.InvalidLockfile;
        }

        var format = try reader.readIntLittle(u32);
        if (format != @enumToInt(Lockfile.FormatVersion.current)) {
            return error.@"Outdated lockfile version";
        }

        lockfile.format = Lockfile.FormatVersion.current;
        lockfile.allocator = allocator;

        _ = try reader.readAll(&lockfile.meta_hash);

        const total_buffer_size = try reader.readIntLittle(u64);
        if (total_buffer_size > stream.buffer.len) {
            return error.@"Lockfile is missing data";
        }

        lockfile.packages = try Lockfile.Package.Serializer.load(
            stream,
            total_buffer_size,
            allocator,
        );
        lockfile.buffers = try Lockfile.Buffers.load(stream, allocator, log);
        if ((try stream.reader().readIntLittle(u64)) != 0) {
            return error.@"Lockfile is malformed (expected 0 at the end)";
        }

        std.debug.assert(stream.pos == total_buffer_size);

        load_workspace: {
            const workspace_path_len = reader.readIntLittle(u64) catch break :load_workspace;
            if (workspace_path_len > 0 and workspace_path_len < bun.MAX_PATH_BYTES) {
                var workspace_path = try allocator.alloc(u8, workspace_path_len);
                const len = reader.readAll(workspace_path) catch break :load_workspace;
                lockfile.workspace_path = workspace_path[0..len];
            }
        }

        lockfile.scratch = Lockfile.Scratch.init(allocator);

        {
            lockfile.package_index = PackageIndex.Map.initContext(allocator, .{});
            lockfile.unique_packages = try Bitset.initFull(lockfile.packages.len, allocator);
            lockfile.string_pool = StringPool.initContext(allocator, .{});
            try lockfile.package_index.ensureTotalCapacity(@truncate(u32, lockfile.packages.len));
            var slice = lockfile.packages.slice();
            var name_hashes = slice.items(.name_hash);
            for (name_hashes) |name_hash, id| {
                try lockfile.getOrPutID(@truncate(PackageID, id), name_hash);
            }
        }

        // const end = try reader.readIntLittle(u64);
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
                alphabetized_names[(i + j) - 1] = @truncate(PackageID, (i + j));
                string_builder.fmtCount("{s}@{}\n", .{ names[i + j].slice(bytes), resolutions[i + j].fmt(bytes) });
            }
        }

        while (i < this.packages.len) : (i += 1) {
            alphabetized_names[i - 1] = @truncate(PackageID, i);
            string_builder.fmtCount("{s}@{}\n", .{ names[i].slice(bytes), resolutions[i].fmt(bytes) });
        }
    }

    std.sort.sort(
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
    const name_hash = bun.hash(package_name);
    const entry = this.package_index.get(name_hash) orelse return null;
    const can_satisfy = version.tag == .npm;

    switch (entry) {
        .PackageID => |id| {
            const resolutions = this.packages.items(.resolution);

            if (can_satisfy and version.value.npm.satisfies(resolutions[id].value.npm.version)) {
                return id;
            }
        },
        .PackageIDMultiple => |multi_| {
            const multi = std.mem.span(multi_);
            const resolutions = this.packages.items(.resolution);

            for (multi) |id| {
                if (comptime Environment.isDebug or Environment.isTest) {
                    std.debug.assert(id != invalid_package_id);
                }

                if (id == invalid_package_id - 1) return null;

                if (can_satisfy and version.value.npm.satisfies(resolutions[id].value.npm.version)) {
                    return id;
                }
            }
        },
    }

    return null;
}
