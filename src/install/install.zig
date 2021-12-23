usingnamespace @import("../global.zig");
const std = @import("std");

const JSLexer = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const JSPrinter = @import("../js_printer.zig");

const linker = @import("../linker.zig");
usingnamespace @import("../ast/base.zig");
usingnamespace @import("../defines.zig");
const panicky = @import("../panic_handler.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../javascript/jsc/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
const NewBunQueue = @import("../bun_queue.zig").NewBunQueue;
const HeaderBuilder = @import("http").HeaderBuilder;
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const Lock = @import("../lock.zig").Lock;
var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;
const URL = @import("../query_string_map.zig").URL;
const NetworkThread = @import("network_thread");
const AsyncHTTP = @import("http").AsyncHTTP;
const HTTPChannel = @import("http").HTTPChannel;
const Integrity = @import("./integrity.zig").Integrity;
const clap = @import("clap");
const ExtractTarball = @import("./extract_tarball.zig");
const Npm = @import("./npm.zig");
const Bitset = @import("./bit_set.zig").DynamicBitSetUnmanaged;

threadlocal var initialized_store = false;

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
// because why not
const alignment_bytes_to_repeat = "bun";
const alignment_bytes_to_repeat_buffer = "bunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbun";

const JSAst = @import("../js_ast.zig");

pub fn initializeStore() void {
    if (initialized_store) {
        JSAst.Expr.Data.Store.reset();
        JSAst.Stmt.Data.Store.reset();
        return;
    }

    initialized_store = true;
    JSAst.Expr.Data.Store.create(default_allocator);
    JSAst.Stmt.Data.Store.create(default_allocator);
}

const IdentityContext = @import("../identity_context.zig").IdentityContext;
const ArrayIdentityContext = @import("../identity_context.zig").ArrayIdentityContext;
const NetworkQueue = std.fifo.LinearFifo(*NetworkTask, .{ .Static = 32 });
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

pub const ExternalStringBuilder = StructBuilder.Builder(ExternalString);
pub const SmallExternalStringList = ExternalSlice(String);

pub fn ExternalSlice(comptime Type: type) type {
    return ExternalSliceAligned(Type, null);
}

pub fn ExternalSliceAligned(comptime Type: type, comptime alignment_: ?u29) type {
    return extern struct {
        const alignment = alignment_ orelse @alignOf(*Type);
        const Slice = @This();

        pub const Child: type = Type;

        off: u32 = 0,
        len: u32 = 0,

        pub inline fn get(this: Slice, in: []const Type) []const Type {
            // it should be impossible to address this out of bounds due to the minimum here
            return in.ptr[this.off..@minimum(in.len, this.off + this.len)];
        }

        pub inline fn mut(this: Slice, in: []Type) []Type {
            return in.ptr[this.off..@minimum(in.len, this.off + this.len)];
        }

        pub fn init(buf: []const Type, in: []const Type) Slice {
            // if (comptime isDebug or isTest) {
            //     std.debug.assert(@ptrToInt(buf.ptr) <= @ptrToInt(in.ptr));
            //     std.debug.assert((@ptrToInt(in.ptr) + in.len) <= (@ptrToInt(buf.ptr) + buf.len));
            // }

            return Slice{
                .off = @truncate(u32, (@ptrToInt(in.ptr) - @ptrToInt(buf.ptr)) / @sizeOf(Type)),
                .len = @truncate(u32, in.len),
            };
        }
    };
}

pub const PackageID = u32;
pub const DependencyID = u32;
pub const PackageIDMultiple = [*:invalid_package_id]PackageID;
pub const invalid_package_id = std.math.maxInt(PackageID);

pub const ExternalStringList = ExternalSlice(ExternalString);
pub const VersionSlice = ExternalSlice(Semver.Version);

pub const ExternalStringMap = extern struct {
    name: ExternalStringList = ExternalStringList{},
    value: ExternalStringList = ExternalStringList{},

    pub const Iterator = NewIterator(ExternalStringList);

    pub const Small = extern struct {
        name: SmallExternalStringList = SmallExternalStringList{},
        value: SmallExternalStringList = SmallExternalStringList{},

        pub const Iterator = NewIterator(SmallExternalStringList);

        pub inline fn iterator(this: Small, buf: []const String) Small.Iterator {
            return Small.Iterator.init(buf, this.name, this.value);
        }
    };

    pub inline fn iterator(this: ExternalStringMap, buf: []const String) Iterator {
        return Iterator.init(buf, this.name, this.value);
    }

    fn NewIterator(comptime Type: type) type {
        return struct {
            const ThisIterator = @This();

            i: usize = 0,
            names: []const Type.Child,
            values: []const Type.Child,

            pub fn init(all: []const Type.Child, names: Type, values: Type) ThisIterator {
                this.names = names.get(all);
                this.values = values.get(all);
                return this;
            }

            pub fn next(this: *ThisIterator) ?[2]Type.Child {
                if (this.i < this.names.len) {
                    const ret = [2]Type.Child{ this.names[this.i], this.values[this.i] };
                    this.i += 1;
                }

                return null;
            }
        };
    }
};

pub const PackageNameHash = u64;

pub const Aligner = struct {
    pub fn write(comptime Type: type, comptime Writer: type, writer: Writer, pos: usize) !usize {
        const to_write = std.mem.alignForward(pos, @alignOf(Type)) - pos;
        var i: usize = 0;

        var remainder: string = alignment_bytes_to_repeat_buffer[0..@minimum(to_write, alignment_bytes_to_repeat_buffer.len)];
        try writer.writeAll(remainder);

        return to_write;
    }

    pub inline fn skipAmount(comptime Type: type, pos: usize) usize {
        return std.mem.alignForward(pos, @alignOf(Type)) - pos;
    }
};

const NetworkTask = struct {
    http: AsyncHTTP = undefined,
    task_id: u64,
    url_buf: []const u8 = &[_]u8{},
    allocator: *std.mem.Allocator,
    request_buffer: MutableString = undefined,
    response_buffer: MutableString = undefined,
    callback: union(Task.Tag) {
        package_manifest: struct {
            loaded_manifest: ?Npm.PackageManifest = null,
            name: strings.StringOrTinyString,
        },
        extract: ExtractTarball,
        binlink: void,
    },

    pub fn notify(http: *AsyncHTTP, sender: *AsyncHTTP.HTTPSender) void {
        PackageManager.instance.network_channel.writeItem(@fieldParentPtr(NetworkTask, "http", http)) catch {};
        sender.onFinish();
    }

    const default_headers_buf: string = "Acceptapplication/vnd.npm.install-v1+json";
    pub fn forManifest(
        this: *NetworkTask,
        name: string,
        allocator: *std.mem.Allocator,
        registry_url: URL,
        loaded_manifest: ?Npm.PackageManifest,
    ) !void {
        this.url_buf = try std.fmt.allocPrint(allocator, "{s}://{s}/{s}", .{ registry_url.displayProtocol(), registry_url.hostname, name });
        var last_modified: string = "";
        var etag: string = "";
        if (loaded_manifest) |manifest| {
            last_modified = manifest.pkg.last_modified.slice(manifest.string_buf);
            etag = manifest.pkg.etag.slice(manifest.string_buf);
        }

        var header_builder = HeaderBuilder{};

        if (etag.len != 0) {
            header_builder.count("If-None-Match", etag);
        } else if (last_modified.len != 0) {
            header_builder.count("If-Modified-Since", last_modified);
        }

        if (header_builder.header_count > 0) {
            header_builder.count("Accept", "application/vnd.npm.install-v1+json");
            if (last_modified.len > 0 and etag.len > 0) {
                header_builder.content.count(last_modified);
            }
            try header_builder.allocate(allocator);

            if (etag.len != 0) {
                header_builder.append("If-None-Match", etag);
            } else if (last_modified.len != 0) {
                header_builder.append("If-Modified-Since", last_modified);
            }

            header_builder.append("Accept", "application/vnd.npm.install-v1+json");

            if (last_modified.len > 0 and etag.len > 0) {
                last_modified = header_builder.content.append(last_modified);
            }
        } else {
            try header_builder.entries.append(
                allocator,
                .{
                    .name = .{ .offset = 0, .length = @truncate(u32, "Accept".len) },
                    .value = .{ .offset = "Accept".len, .length = @truncate(u32, default_headers_buf.len - "Accept".len) },
                },
            );
            header_builder.header_count = 1;
            header_builder.content = GlobalStringBuilder{ .ptr = @intToPtr([*]u8, @ptrToInt(std.mem.span(default_headers_buf).ptr)), .len = default_headers_buf.len, .cap = default_headers_buf.len };
        }

        this.request_buffer = try MutableString.init(allocator, 0);
        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;
        this.http = try AsyncHTTP.init(
            allocator,
            .GET,
            URL.parse(this.url_buf),
            header_builder.entries,
            header_builder.content.ptr.?[0..header_builder.content.len],
            &this.response_buffer,
            &this.request_buffer,
            0,
        );
        this.callback = .{
            .package_manifest = .{
                .name = try strings.StringOrTinyString.initAppendIfNeeded(name, *FileSystem.FilenameStore, &FileSystem.FilenameStore.instance),
                .loaded_manifest = loaded_manifest,
            },
        };

        if (PackageManager.verbose_install) {
            this.http.verbose = true;
            this.http.client.verbose = true;
        }

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if (last_modified.len != 0) {
            this.http.client.force_last_modified = true;
            this.http.client.if_modified_since = last_modified;
        }

        this.http.callback = notify;
    }

    pub fn schedule(this: *NetworkTask, batch: *ThreadPool.Batch) void {
        this.http.schedule(this.allocator, batch);
    }

    pub fn forTarball(
        this: *NetworkTask,
        allocator: *std.mem.Allocator,
        tarball: ExtractTarball,
    ) !void {
        this.url_buf = try ExtractTarball.buildURL(
            tarball.registry,
            tarball.name,
            tarball.resolution.value.npm,
            PackageManager.instance.lockfile.buffers.string_bytes.items,
        );

        this.request_buffer = try MutableString.init(allocator, 0);
        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;

        this.http = try AsyncHTTP.init(
            allocator,
            .GET,
            URL.parse(this.url_buf),
            .{},
            "",
            &this.response_buffer,
            &this.request_buffer,
            0,
        );
        this.http.callback = notify;
        this.callback = .{ .extract = tarball };
    }
};

pub const Origin = enum(u8) {
    local = 0,
    npm = 1,
    tarball = 2,
};

pub const Features = struct {
    optional_dependencies: bool = false,
    dev_dependencies: bool = false,
    scripts: bool = false,
    peer_dependencies: bool = true,
    is_main: bool = false,
    dependencies: bool = true,

    check_for_duplicate_dependencies: bool = false,

    // When it's a folder, we do not parse any of the dependencies
    pub const folder = Features{
        .optional_dependencies = false,
        .dev_dependencies = false,
        .scripts = false,
        .peer_dependencies = false,
        .is_main = false,
        .dependencies = false,
    };

    pub const npm = Features{
        .optional_dependencies = true,
    };

    pub const npm_manifest = Features{
        .optional_dependencies = true,
    };
};

pub const PreinstallState = enum(u8) {
    unknown = 0,
    done = 1,
    extract = 2,
    extracting = 3,
};

pub const Lockfile = struct {

    // Serialized data
    /// The version of the lockfile format, intended to prevent data corruption for format changes.
    format: FormatVersion = .v0,

    /// 
    packages: Lockfile.Package.List = Lockfile.Package.List{},
    buffers: Buffers = Buffers{},

    /// name -> PackageID || [*]PackageID
    /// Not for iterating.
    package_index: PackageIndex.Map,
    unique_packages: Bitset,
    string_pool: StringPool,
    allocator: *std.mem.Allocator,
    scratch: Scratch = Scratch{},

    const Stream = std.io.FixedBufferStream([]u8);
    pub const default_filename = "bun.lockb";

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

    pub fn loadFromDisk(this: *Lockfile, allocator: *std.mem.Allocator, log: *logger.Log, filename: stringZ) LoadFromDiskResult {
        std.debug.assert(FileSystem.instance_loaded);
        var file = std.fs.cwd().openFileZ(filename, .{ .read = true }) catch |err| {
            return switch (err) {
                error.AccessDenied, error.BadPathName, error.FileNotFound => LoadFromDiskResult{ .not_found = .{} },
                else => LoadFromDiskResult{ .err = .{ .step = .open_file, .value = err } },
            };
        };
        defer file.close();
        var buf = file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch |err| {
            return LoadFromDiskResult{ .err = .{ .step = .read_file, .value = err } };
        };

        var stream = Stream{ .buffer = buf, .pos = 0 };
        Lockfile.Serializer.load(this, &stream, allocator, log) catch |err| {
            return LoadFromDiskResult{ .err = .{ .step = .parse_file, .value = err } };
        };

        return LoadFromDiskResult{ .ok = this };
    }

    const PackageIDQueue = std.fifo.LinearFifo(PackageID, .Dynamic);

    pub const InstallResult = struct {
        lockfile: *Lockfile,
        summary: PackageInstall.Summary,
    };

    pub const Tree = extern struct {
        id: Id = invalid_id,
        package_id: PackageID = invalid_package_id,

        parent: Id = invalid_id,
        packages: Lockfile.PackageIDSlice = Lockfile.PackageIDSlice{},

        pub const Slice = ExternalSlice(Tree);
        pub const List = std.ArrayListUnmanaged(Tree);
        pub const Id = u32;
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
            path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined,
            path_buf_len: usize = 0,
            last_parent: Id = invalid_id,
            string_buf: string,

            // max number of node_modules folders
            depth_stack: [(std.fs.MAX_PATH_BYTES / "node_modules".len) + 1]Id = undefined,

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
            allocator: *std.mem.Allocator,
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
                const end = @truncate(Id, this.list.len);
                var i: Id = 0;
                var total_packages_count: u32 = 0;

                var slice = this.list.slice();
                var trees = this.list.items(.tree);
                var packages = this.list.items(.packages);

                // TODO: can we cull empty trees here?
                while (i < end) : (i += 1) {
                    total_packages_count += trees[i].packages.len;
                }

                var package_ids = try this.allocator.alloc(PackageID, total_packages_count);
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
            allocator: *std.mem.Allocator,
        ) Id {
            const this_packages = this.packages.get(lists[this.id].items);
            const name_hash = name_hashes[package_id];

            for (this_packages) |pid, slot| {
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

    pub fn clean(old: *Lockfile, deduped: *u32, updates: []PackageManager.UpdateRequest, options: *const PackageManager.Options) !*Lockfile {

        // We will only shrink the number of packages here.
        // never grow
        const max_package_id = old.packages.len;

        if (updates.len > 0) {
            var root_deps: []Dependency = old.packages.items(.dependencies)[0].mut(old.buffers.dependencies.items);
            const old_resolutions: []const PackageID = old.packages.items(.resolutions)[0].get(old.buffers.resolutions.items);
            const resolutions_of_yore: []const Resolution = old.packages.items(.resolution);
            const old_names = old.packages.items(.name);
            var string_builder = old.stringBuilder();
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

            try string_builder.allocate();
            defer string_builder.clamp();
            var full_buf = string_builder.ptr.?[0 .. string_builder.cap + old.buffers.string_bytes.items.len];
            var temp_buf: [513]u8 = undefined;

            for (updates) |update, update_i| {
                if (update.version.tag == .uninitialized) {
                    // prevent the deduping logic
                    updates[update_i].e_string = null;

                    for (root_deps) |dep, i| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            const old_resolution = old_resolutions[i];
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            var buf = std.fmt.bufPrint(&temp_buf, "^{}", .{res.value.npm.fmt(old.buffers.string_bytes.items)}) catch break;
                            const external_version = string_builder.append(ExternalString, buf);
                            const sliced = external_version.value.sliced(
                                old.buffers.string_bytes.items,
                            );
                            root_deps[i].version = Dependency.parse(
                                old.allocator,
                                sliced.slice,
                                &sliced,
                                null,
                            ) orelse Dependency.Version{};
                        }
                    }
                }
            }
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

        const InstallOrder = struct {
            parent: PackageID,
            children: PackageIDSlice,
        };

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

        return new;
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

            try this.hoist();
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
        successfully_installed: ?std.DynamicBitSetUnmanaged = null,

        pub const Format = enum { yarn };

        var lockfile_path_buf1: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var lockfile_path_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;

        pub fn print(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            lockfile_path_: string,
            format: Format,
        ) !void {
            var lockfile_path: stringZ = undefined;

            if (!std.fs.path.isAbsolute(lockfile_path_)) {
                var cwd = try std.os.getcwd(&lockfile_path_buf1);
                var parts = [_]string{lockfile_path_};
                var lockfile_path__ = resolve_path.joinAbsStringBuf(cwd, &lockfile_path_buf2, &parts, .auto);
                lockfile_path_buf2[lockfile_path__.len] = 0;
                lockfile_path = lockfile_path_buf2[0..lockfile_path__.len :0];
            } else {
                std.mem.copy(u8, &lockfile_path_buf1, lockfile_path);
                lockfile_path_buf1[lockfile_path_.len] = 0;
                lockfile_path = lockfile_path_buf1[0..lockfile_path_.len :0];
            }

            std.os.chdir(std.fs.path.dirname(lockfile_path) orelse "/") catch {};

            _ = try FileSystem.init1(allocator, null);

            var lockfile = try allocator.create(Lockfile);

            const load_from_disk = lockfile.loadFromDisk(allocator, log, lockfile_path);
            switch (load_from_disk) {
                .err => |cause| {
                    switch (cause.step) {
                        .open_file => Output.prettyErrorln("<r><red>error opening lockfile:<r> {s}.", .{
                            @errorName(cause.value),
                        }),
                        .parse_file => Output.prettyErrorln("<r><red>error parsing lockfile:<r> {s}", .{
                            @errorName(cause.value),
                        }),
                        .read_file => Output.prettyErrorln("<r><red>error reading lockfile:<r> {s}", .{
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
                    Output.flush();
                    std.os.exit(1);
                    return;
                },
                .not_found => {
                    Output.prettyErrorln("<r><red>lockfile not found:<r> {s}", .{
                        std.mem.span(lockfile_path),
                    });
                    Output.flush();
                    std.os.exit(1);
                    return;
                },

                .ok => {},
            }

            var writer = Output.writer();
            try printWithLockfile(allocator, lockfile, format, @TypeOf(writer), writer);
            Output.flush();
        }

        pub fn printWithLockfile(
            allocator: *std.mem.Allocator,
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
                var lockfile = this.lockfile;

                const IDDepthPair = struct {
                    depth: u16 = 0,
                    id: PackageID,
                };

                var visited = try Bitset.initEmpty(this.lockfile.packages.len, this.lockfile.allocator);

                var slice = this.lockfile.packages.slice();
                const names: []const String = slice.items(.name);
                const resolved: []const Resolution = slice.items(.resolution);
                const metas: []const Lockfile.Package.Meta = slice.items(.meta);
                if (names.len == 0) return;
                const dependency_lists = slice.items(.dependencies);
                const resolutions_list = slice.items(.resolutions);
                const resolutions_buffer = this.lockfile.buffers.resolutions.items;
                const dependencies_buffer = this.lockfile.buffers.dependencies.items;
                const package_count = @truncate(PackageID, names.len);
                const string_buf = this.lockfile.buffers.string_bytes.items;

                const root = this.lockfile.rootPackage() orelse return;
                visited.set(0);
                const end = @truncate(PackageID, names.len);

                var any_failed = false;

                if (this.successfully_installed) |installed| {
                    for (resolutions_list[0].get(resolutions_buffer)) |package_id| {
                        if (package_id > end or !installed.isSet(package_id)) continue;

                        const package_name = names[package_id].slice(string_buf);

                        const dependency_list = dependency_lists[package_id];

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
                    for (names) |name, package_id| {
                        const package_name = name.slice(string_buf);

                        const dependency_list = dependency_lists[package_id];

                        try writer.print(
                            comptime Output.prettyFmt(" <r><b>{s}<r><d>@<b>{}<r>\n", enable_ansi_colors),
                            .{
                                package_name,
                                resolved[package_id].fmt(string_buf),
                            },
                        );
                    }
                }

                for (resolutions_list) |list, parent_id| {
                    for (list.get(resolutions_buffer)) |package_id, j| {
                        if (package_id >= end) {
                            const failed_dep: Dependency = dependency_lists[parent_id].get(dependencies_buffer)[j];
                            if (failed_dep.behavior.isOptional() or failed_dep.behavior.isPeer() or (failed_dep.behavior.isDev() and parent_id > 0)) continue;

                            try writer.print(
                                comptime Output.prettyFmt(
                                    "<r><red>ERROR<r><d>:<r> <b>{s}<r><d>@<b>{}<r><d> failed to resolve\n",
                                    enable_ansi_colors,
                                ),
                                .{
                                    failed_dep.name.slice(string_buf),
                                    failed_dep.version.literal.fmt(string_buf),
                                },
                            );
                            // track this so we can log each failure instead of just the first
                            any_failed = true;
                            continue;
                        }
                    }
                }

                if (any_failed) std.os.exit(1);
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
                    \\
                    \\
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
                const resolutions_list = slice.items(.resolutions);
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

                        for (dependency_versions) |dependency_version, j| {
                            if (j > 0) {
                                try writer.writeAll(", ");
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
                            for (dependencies) |dep, j| {
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

    pub fn verify(this: *Lockfile) !void {
        std.debug.assert(this.format == .v0);
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

    pub fn saveToDisk(this: *Lockfile, filename: stringZ) void {
        if (comptime Environment.isDebug) {
            this.verify() catch |err| {
                Output.prettyErrorln("<r><red>error:<r> failed to verify lockfile: {s}", .{@errorName(err)});
                Output.flush();
                Global.crash();
            };
        }
        std.debug.assert(FileSystem.instance_loaded);
        var tmpname_buf: [512]u8 = undefined;
        tmpname_buf[0..8].* = "bunlock-".*;
        var tmpfile = FileSystem.RealFS.Tmpfile{};
        var secret: [32]u8 = undefined;
        std.mem.writeIntNative(u64, secret[0..8], @intCast(u64, std.time.milliTimestamp()));
        var rng = std.rand.Gimli.init(secret);
        var base64_bytes: [64]u8 = undefined;
        rng.random.bytes(&base64_bytes);

        const tmpname__ = std.fmt.bufPrint(tmpname_buf[8..], "{s}", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;
        tmpname_buf[tmpname__.len + 8] = 0;
        const tmpname = tmpname_buf[0 .. tmpname__.len + 8 :0];

        tmpfile.create(&FileSystem.instance.fs, tmpname) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to open lockfile: {s}", .{@errorName(err)});
            Output.flush();
            Global.crash();
        };

        var file = tmpfile.file();

        Lockfile.Serializer.save(this, std.fs.File, file) catch |err| {
            tmpfile.dir().deleteFileZ(tmpname) catch {};
            Output.prettyErrorln("<r><red>error:<r> failed to serialize lockfile: {s}", .{@errorName(err)});
            Output.flush();
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
            Output.flush();
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

    pub inline fn cloneString(this: *Lockfile, slicable: anytype, from: *Lockfile) string {
        // const slice = from.str(slicable);
        // if (this.string_pool) {

        // }
    }

    pub fn initEmpty(this: *Lockfile, allocator: *std.mem.Allocator) !void {
        this.* = Lockfile{
            .format = .v0,
            .packages = Lockfile.Package.List{},
            .buffers = Buffers{},
            .package_index = PackageIndex.Map.initContext(allocator, .{}),
            .unique_packages = try Bitset.initFull(0, allocator),
            .string_pool = StringPool.init(allocator),
            .allocator = allocator,
            .scratch = Scratch.init(allocator),
        };
    }

    pub fn getPackageID(
        this: *Lockfile,
        name_hash: u64,
        // if it's a peer dependency
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
                            if (version_.value.npm.satisfies(resolutions[id].value.npm)) {
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

                    if (can_satisfy and version.?.value.npm.satisfies(resolutions[id].value.npm)) {
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
                std.debug.assert(this.getPackageID(package_.name_hash, null, package_.resolution).? == id);
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

        pub fn init(allocator: *std.mem.Allocator) Scratch {
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

        pub fn allocatedSlice(this: *StringBuilder) ![]u8 {
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
        _,
    };

    pub const DependencySlice = ExternalSlice(Dependency);
    pub const PackageIDSlice = ExternalSlice(PackageID);
    pub const NodeModulesFolderSlice = ExternalSlice(NodeModulesFolder);

    pub const PackageIDList = std.ArrayListUnmanaged(PackageID);
    pub const DependencyList = std.ArrayListUnmanaged(Dependency);
    pub const StringBuffer = std.ArrayListUnmanaged(u8);
    pub const SmallExternalStringBuffer = std.ArrayListUnmanaged(String);

    pub const Package = extern struct {
        const DependencyGroup = struct {
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
            this: *const Lockfile.Package,
            old: *Lockfile,
            new: *Lockfile,
            package_id_mapping: []PackageID,
            cloner: *Cloner,
        ) !PackageID {
            const old_string_buf = old.buffers.string_bytes.items;
            var builder_ = new.stringBuilder();
            var builder = &builder_;

            builder.count(this.name.slice(old_string_buf));
            this.resolution.count(old_string_buf, *Lockfile.StringBuilder, builder);
            this.meta.count(old_string_buf, *Lockfile.StringBuilder, builder);
            this.bin.count(old_string_buf, *Lockfile.StringBuilder, builder);

            const old_dependencies: []const Dependency = this.dependencies.get(old.buffers.dependencies.items);
            const old_resolutions: []const PackageID = this.resolutions.get(old.buffers.resolutions.items);

            for (old_dependencies) |dependency, i| {
                dependency.count(old_string_buf, *Lockfile.StringBuilder, builder);
            }

            try builder.allocate();

            // should be unnecessary, but Just In Case
            try new.buffers.dependencies.ensureUnusedCapacity(new.allocator, old_dependencies.len);
            try new.buffers.resolutions.ensureUnusedCapacity(new.allocator, old_dependencies.len);

            const prev_len = @truncate(u32, new.buffers.dependencies.items.len);
            const end = prev_len + @truncate(u32, old_dependencies.len);
            const max_package_id = @truncate(PackageID, old.packages.len);

            new.buffers.dependencies.items = new.buffers.dependencies.items.ptr[0..end];
            new.buffers.resolutions.items = new.buffers.resolutions.items.ptr[0..end];

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
                    .bin = this.bin.clone(old_string_buf, *Lockfile.StringBuilder, builder),
                    .name_hash = this.name_hash,
                    .meta = this.meta.clone(
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

        pub fn fromNPM(
            allocator: *std.mem.Allocator,
            lockfile: *Lockfile,
            log: *logger.Log,
            manifest: *const Npm.PackageManifest,
            version: Semver.Version,
            package_version_ptr: *const Npm.PackageVersion,
            string_buf: []const u8,
            comptime features: Features,
        ) !Lockfile.Package {
            var npm_count: u32 = 0;
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

                package_version.bin.count(string_buf, @TypeOf(&string_builder), &string_builder);
            }

            try string_builder.allocate();
            defer string_builder.clamp();

            var dependencies_list = &lockfile.buffers.dependencies;
            var resolutions_list = &lockfile.buffers.resolutions;
            try dependencies_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
            try resolutions_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);

            // -- Cloning
            {
                const package_name: ExternalString = string_builder.appendWithHash(ExternalString, manifest.name(), manifest.pkg.name.hash);
                package.name_hash = package_name.hash;
                package.name = package_name.value;
                package.resolution = Resolution{
                    .value = .{
                        .npm = version.clone(
                            manifest.string_buf,
                            @TypeOf(&string_builder),
                            &string_builder,
                        ),
                    },
                    .tag = .npm,
                };

                const total_len = dependencies_list.items.len + total_dependencies_count;
                std.debug.assert(dependencies_list.items.len == resolutions_list.items.len);

                var dependencies: []Dependency = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
                std.mem.set(Dependency, dependencies, Dependency{});

                var start_dependencies = dependencies;

                const off = @truncate(u32, dependencies_list.items.len);

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
                            for (start_dependencies[0 .. total_dependencies_count - dependencies.len]) |dependency, j| {
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

                        package.meta.npm_dependency_count += @as(u32, @boolToInt(dependency.version.tag.isNPM()));

                        dependencies[0] = dependency;
                        dependencies = dependencies[1..];
                        i += 1;
                    }
                }

                package.bin = package_version.bin.clone(string_buf, @TypeOf(&string_builder), &string_builder);

                package.meta.arch = package_version.cpu;
                package.meta.os = package_version.os;
                package.meta.unpacked_size = package_version.unpacked_size;
                package.meta.file_count = package_version.file_count;

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
                allocator: *std.mem.Allocator,
                from_lockfile: *Lockfile,
                to_lockfile: *Lockfile,
                from: *Lockfile.Package,
                to: *Lockfile.Package,
                mapping: []PackageID,
            ) !Summary {
                var summary = Summary{};
                const to_deps = to.dependencies.get(to_lockfile.buffers.dependencies.items);
                const to_res = to.resolutions.get(to_lockfile.buffers.resolutions.items);
                const from_res = from.resolutions.get(from_lockfile.buffers.resolutions.items);
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

                    for (from_deps) |from_dep, j| {
                        if (from_dep.name_hash == to_dep.name_hash) continue :outer;
                    }

                    summary.add += 1;
                }

                return summary;
            }
        };

        pub fn determinePreinstallState(this: *Lockfile.Package, lockfile: *Lockfile, manager: *PackageManager) PreinstallState {
            switch (this.meta.preinstall_state) {
                .unknown => {
                    // Do not automatically start downloading packages which are disabled
                    // i.e. don't download all of esbuild's versions or SWCs
                    if (this.isDisabled()) {
                        this.meta.preinstall_state = .done;
                        return .done;
                    }

                    const folder_path = PackageManager.cachedNPMPackageFolderName(this.name.slice(lockfile.buffers.string_bytes.items), this.resolution.value.npm);
                    if (manager.isFolderInCache(folder_path)) {
                        this.meta.preinstall_state = .done;
                        return this.meta.preinstall_state;
                    }

                    this.meta.preinstall_state = .extract;
                    return this.meta.preinstall_state;
                },
                else => return this.meta.preinstall_state,
            }
        }

        pub fn hash(name: string, version: Semver.Version) u64 {
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(name);
            hasher.update(std.mem.asBytes(&version));
            return hasher.final();
        }

        pub fn parseMain(
            lockfile: *Lockfile,
            package: *Lockfile.Package,
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            source: logger.Source,
            comptime features: Features,
        ) !void {
            return try parse(lockfile, package, allocator, log, source, void, void{}, features);
        }

        pub fn parse(
            lockfile: *Lockfile,
            package: *Lockfile.Package,
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            source: logger.Source,
            comptime ResolverContext: type,
            resolver: ResolverContext,
            comptime features: Features,
        ) !void {
            initializeStore();

            var json = json_parser.ParseJSON(&source, log, allocator) catch |err| {
                if (Output.enable_ansi_colors) {
                    log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }

                Output.panic("<r><red>{s}<r> parsing package.json for <b>\"{s}\"<r>", .{ @errorName(err), source.path.prettyDir() });
            };

            var string_builder = lockfile.stringBuilder();
            var total_dependencies_count: u32 = 0;

            package.meta.origin = if (features.is_main) .local else .npm;

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
                        for (dependencies_q.expr.data.e_object.properties) |item| {
                            string_builder.count(item.key.?.asString(allocator) orelse "");
                            string_builder.count(item.value.?.asString(allocator) orelse "");
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
                        const dependency_props: []const JSAst.G.Property = dependencies_q.expr.data.e_object.properties;
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

                            const dependency_version = Dependency.parse(
                                allocator,
                                sliced.slice,
                                &sliced,
                                log,
                            ) orelse Dependency.Version{};
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
                            package.meta.npm_dependency_count += @as(u32, @boolToInt(dependency_version.tag.isNPM()));
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
        }

        pub const List = std.MultiArrayList(Lockfile.Package);

        pub const Meta = extern struct {
            preinstall_state: PreinstallState = PreinstallState.unknown,

            origin: Origin = Origin.npm,
            arch: Npm.Architecture = Npm.Architecture.all,
            os: Npm.OperatingSystem = Npm.OperatingSystem.all,

            file_count: u32 = 0,
            npm_dependency_count: u32 = 0,
            id: PackageID = invalid_package_id,

            man_dir: String = String{},
            unpacked_size: u64 = 0,
            integrity: Integrity = Integrity{},

            pub fn isDisabled(this: *const Meta) bool {
                return !this.arch.isMatch() or !this.os.isMatch();
            }

            pub fn count(this: *const Meta, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) void {
                builder.count(this.man_dir.slice(buf));
            }

            pub fn clone(this: *const Meta, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) Meta {
                var new = this.*;
                new.id = invalid_package_id;
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
                const bytes = list.bytes[0..byteSize(list)];
                try writer.writeIntLittle(u64, bytes.len);
                try writer.writeIntLittle(u64, list.len);
                // _ = try Aligner.write(AlignmentType, Writer, writer, try stream.getPos());
                var slice = list.slice();
                inline for (sizes.fields) |field_index| {
                    const Type = sizes.Types[field_index];
                    _ = try Aligner.write(Type, Writer, writer, try stream.getPos());
                    try writer.writeAll(std.mem.sliceAsBytes(
                        slice.items(
                            @intToEnum(Lockfile.Package.List.Field, FieldsEnum.fields[field_index].value),
                        ),
                    ));
                }
            }

            pub fn load(
                stream: *Stream,
                allocator: *std.mem.Allocator,
            ) !Lockfile.Package.List {
                var reader = stream.reader();

                const byte_len = try reader.readIntLittle(u64);

                if (byte_len == 0) {
                    return Lockfile.Package.List{
                        .len = 0,
                        .capacity = 0,
                    };
                }

                // Count of items in the list
                const list_len = try reader.readIntLittle(u64);

                var list = Lockfile.Package.List{};
                try list.ensureTotalCapacity(allocator, list_len);
                list.len = list_len;
                var slice = list.slice();

                inline for (sizes.fields) |field_index| {
                    const Type = sizes.Types[field_index];
                    stream.pos += Aligner.skipAmount(Type, try stream.getPos());
                    var bytes = std.mem.sliceAsBytes(
                        slice.items(
                            @intToEnum(Lockfile.Package.List.Field, FieldsEnum.fields[field_index].value),
                        ),
                    );
                    @memcpy(bytes.ptr, @ptrCast([*]u8, &stream.buffer[stream.pos]), bytes.len);
                    stream.pos += bytes.len;
                }

                // Alignment bytes to skip
                // stream.pos += Aligner.skipAmount(AlignmentType, try stream.getPos());

                return list;
            }
        };
    };

    const Buffers = struct {
        trees: Tree.List = Tree.List{},
        hoisted_packages: PackageIDList = PackageIDList{},
        resolutions: PackageIDList = PackageIDList{},
        dependencies: DependencyList = DependencyList{},
        extern_strings: SmallExternalStringBuffer = SmallExternalStringBuffer{},
        // node_modules_folders: NodeModulesFolderList = NodeModulesFolderList{},
        // node_modules_package_ids: PackageIDList = PackageIDList{},
        string_bytes: StringBuffer = StringBuffer{},

        pub fn preallocate(this: *Buffers, that: Buffers, allocator: *std.mem.Allocator) !void {
            try this.trees.ensureTotalCapacity(allocator, that.trees.items.len);
            try this.resolutions.ensureTotalCapacity(allocator, that.resolutions.items.len);
            try this.dependencies.ensureTotalCapacity(allocator, that.dependencies.items.len);
            try this.extern_strings.ensureTotalCapacity(allocator, that.extern_strings.items.len);
            try this.string_bytes.ensureTotalCapacity(allocator, that.string_bytes.items.len);
        }

        pub fn readArray(stream: *Stream, comptime ArrayList: type) !ArrayList {
            const arraylist: ArrayList = undefined;

            const PointerType = std.meta.Child(@TypeOf(arraylist.items.ptr));
            const alignment = @alignOf([*]PointerType);

            var reader = stream.reader();
            const byte_len = try reader.readIntLittle(u64);

            if (byte_len == 0) return ArrayList{
                .items = &[_]PointerType{},
                .capacity = 0,
            };

            stream.pos += Aligner.skipAmount([*]PointerType, stream.pos);
            const start = stream.pos;
            stream.pos += byte_len;

            if (stream.pos > stream.buffer.len) {
                return error.BufferOverflow;
            }

            return ArrayList{
                .items = @ptrCast([*]PointerType, @alignCast(alignment, &stream.buffer[start]))[0 .. byte_len / @sizeOf(PointerType)],
                .capacity = byte_len,
            };
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

        pub fn writeArray(comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer, comptime ArrayList: type, array: ArrayList) !void {
            const bytes = std.mem.sliceAsBytes(array);
            try writer.writeIntLittle(u64, bytes.len);

            if (bytes.len > 0) {
                _ = try Aligner.write([*]std.meta.Child(ArrayList), Writer, writer, try stream.getPos());

                try writer.writeAll(bytes);
            }
        }

        pub fn save(this: Buffers, allocator: *std.mem.Allocator, comptime StreamType: type, stream: StreamType, comptime Writer: type, writer: Writer) !void {
            inline for (sizes.names) |name, i| {
                var pos: usize = 0;
                if (comptime Environment.isDebug) {
                    pos = try stream.getPos();
                }

                // Dependencies have to be converted to .toExternal first
                // We store pointers in Version.Value, so we can't just write it directly
                if (comptime strings.eqlComptime(name, "dependencies")) {
                    var remaining = this.dependencies.items;

                    var buf: [128]Dependency.External = undefined;

                    switch (remaining.len) {
                        0 => {
                            try writer.writeIntLittle(u64, 0);
                        },
                        1...127 => {
                            for (remaining) |dep, j| {
                                buf[j] = dep.toExternal();
                            }
                            const to_write = std.mem.sliceAsBytes(buf[0..remaining.len]);
                            try writer.writeIntLittle(u64, to_write.len);
                            _ = try Aligner.write(
                                [*]Dependency.External,
                                Writer,
                                writer,
                                try stream.getPos(),
                            );
                            try writer.writeAll(to_write);
                        },
                        else => {
                            try writer.writeIntLittle(u64, @sizeOf(Dependency.External) * remaining.len);
                            _ = try Aligner.write(
                                [*]Dependency.External,
                                Writer,
                                writer,
                                try stream.getPos(),
                            );

                            var buf_i: usize = 0;
                            for (remaining) |dep| {
                                if (buf_i >= buf.len) {
                                    try writer.writeAll(std.mem.sliceAsBytes(&buf));
                                    buf_i = 0;
                                }
                                buf[buf_i] = dep.toExternal();
                                buf_i += 1;
                            }
                            if (buf_i > 0) {
                                const to_write = std.mem.sliceAsBytes(buf[0..buf_i]);
                                try writer.writeAll(to_write);
                            }
                        },
                    }
                } else {
                    const list = @field(this, name).items;
                    const Type = @TypeOf(list);

                    try writeArray(StreamType, stream, Writer, writer, Type, list);
                }

                if (comptime Environment.isDebug) {
                    // Output.prettyErrorln("Field {s}: {d} - {d}", .{ name, pos, try stream.getPos() });
                }
            }
        }

        pub fn load(stream: *Stream, allocator: *std.mem.Allocator, log: *logger.Log) !Buffers {
            var this = Buffers{};
            var external_dependency_list: []Dependency.External = &[_]Dependency.External{};
            inline for (sizes.names) |name, i| {
                const Type = @TypeOf(@field(this, name));

                var pos: usize = 0;
                if (comptime Environment.isDebug) {
                    pos = try stream.getPos();
                }

                if (comptime Type == @TypeOf(this.dependencies)) {
                    var reader = stream.reader();
                    const len = try reader.readIntLittle(u64);
                    if (len > 0) {
                        stream.pos += Aligner.skipAmount([*]Dependency.External, stream.pos);
                        const start = stream.pos;
                        stream.pos += len;
                        if (stream.pos > stream.buffer.len) {
                            return error.BufferOverflow;
                        }
                        var bytes = stream.buffer[start..][0..len];
                        external_dependency_list = @alignCast(
                            @alignOf([]Dependency.External),
                            std.mem.bytesAsSlice(
                                Dependency.External,
                                bytes,
                            ),
                        );
                    }
                } else {
                    @field(this, sizes.names[i]) = try readArray(stream, Type);
                }

                if (comptime Environment.isDebug) {
                    // Output.prettyErrorln("Field {s}: {d} - {d}", .{ sizes.names[i], pos, try stream.getPos() });
                }
            }

            // Dependencies are serialized separately.
            // This is unfortunate. However, not using pointers for Semver Range's make the code a lot more complex.
            this.dependencies = try DependencyList.initCapacity(allocator, external_dependency_list.len);
            const extern_context = Dependency.External.Context{
                .log = log,
                .allocator = allocator,
                .buffer = this.string_bytes.items,
            };

            this.dependencies.expandToCapacity();
            this.dependencies.items.len = external_dependency_list.len;
            for (external_dependency_list) |dep, i| {
                this.dependencies.items[i] = dep.toDependency(extern_context);
            }

            return this;
        }
    };

    pub const Serializer = struct {
        pub const version = "bun-lockfile-format-v0\n";
        const header_bytes: string = "#!/usr/bin/env bun\n" ++ version;

        pub fn save(this: *Lockfile, comptime StreamType: type, stream: StreamType) !void {
            var writer = stream.writer();
            try writer.writeAll(header_bytes);
            try writer.writeIntLittle(u32, @enumToInt(this.format));
            const pos = try stream.getPos();
            try writer.writeIntLittle(u64, 0);

            try Lockfile.Package.Serializer.save(this.packages, StreamType, stream, @TypeOf(&writer), &writer);
            try Lockfile.Buffers.save(this.buffers, this.allocator, StreamType, stream, @TypeOf(&writer), &writer);

            try writer.writeIntLittle(u64, 0);
            const end = try stream.getPos();
            try writer.writeAll(alignment_bytes_to_repeat_buffer);

            _ = try std.os.pwrite(stream.handle, std.mem.asBytes(&end), pos);
        }
        pub fn load(
            lockfile: *Lockfile,
            stream: *Stream,
            allocator: *std.mem.Allocator,
            log: *logger.Log,
        ) !void {
            var reader = stream.reader();
            var header_buf_: [header_bytes.len]u8 = undefined;
            var header_buf = header_buf_[0..try reader.readAll(&header_buf_)];

            if (!strings.eqlComptime(header_buf, header_bytes)) {
                return error.InvalidLockfile;
            }

            var format = try reader.readIntLittle(u32);
            if (format != @enumToInt(Lockfile.FormatVersion.v0)) {
                return error.InvalidLockfileVersion;
            }
            lockfile.format = .v0;
            lockfile.allocator = allocator;
            const byte_len = try reader.readIntLittle(u64);

            lockfile.packages = try Lockfile.Package.Serializer.load(
                stream,
                allocator,
            );
            lockfile.buffers = try Lockfile.Buffers.load(stream, allocator, log);
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
};
/// Schedule long-running callbacks for a task
/// Slow stuff is broken into tasks, each can run independently without locks
const Task = struct {
    tag: Tag,
    request: Request,
    data: Data,
    status: Status = Status.waiting,
    threadpool_task: ThreadPool.Task = ThreadPool.Task{ .callback = callback },
    log: logger.Log,
    id: u64,

    /// An ID that lets us register a callback without keeping the same pointer around
    pub const Id = struct {
        pub fn forNPMPackage(tag: Task.Tag, package_name: string, package_version: Semver.Version) u64 {
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(package_name);
            hasher.update("@");
            hasher.update(std.mem.asBytes(&package_version));
            return @as(u64, @truncate(u63, hasher.final())) | @as(u64, 1 << 63);
        }

        pub fn forBinLink(package_id: PackageID) u64 {
            const hash = std.hash.Wyhash.hash(0, std.mem.asBytes(&package_id));
            return @as(u64, @truncate(u62, hash)) | @as(u64, 1 << 62) | @as(u64, 1 << 63);
        }

        pub fn forManifest(
            tag: Task.Tag,
            name: string,
        ) u64 {
            return @as(u64, @truncate(u63, std.hash.Wyhash.hash(0, name)));
        }
    };

    pub fn callback(task: *ThreadPool.Task) void {
        Output.Source.configureThread();
        defer Output.flush();

        var this = @fieldParentPtr(Task, "threadpool_task", task);

        switch (this.tag) {
            .package_manifest => {
                var allocator = PackageManager.instance.allocator;
                const package_manifest = Npm.Registry.getPackageMetadata(
                    allocator,
                    this.request.package_manifest.network.http.response.?,
                    this.request.package_manifest.network.response_buffer.toOwnedSliceLeaky(),
                    &this.log,
                    this.request.package_manifest.name.slice(),
                    this.request.package_manifest.network.callback.package_manifest.loaded_manifest,
                ) catch |err| {
                    this.status = Status.fail;
                    PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                this.data = .{ .package_manifest = .{} };

                switch (package_manifest) {
                    .cached => unreachable,
                    .fresh => |manifest| {
                        this.data = .{ .package_manifest = manifest };
                        this.status = Status.success;
                        PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
                        return;
                    },
                    .not_found => {
                        this.log.addErrorFmt(null, logger.Loc.Empty, allocator, "404 - GET {s}", .{
                            this.request.package_manifest.name.slice(),
                        }) catch unreachable;
                        this.status = Status.fail;
                        PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
                        return;
                    },
                }
            },
            .extract => {
                const result = this.request.extract.tarball.run(
                    this.request.extract.network.response_buffer.toOwnedSliceLeaky(),
                ) catch |err| {
                    this.status = Status.fail;
                    this.data = .{ .extract = "" };
                    PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
                PackageManager.instance.resolve_tasks.writeItem(this.*) catch unreachable;
            },
            .binlink => {},
        }
    }

    pub const Tag = enum(u2) {
        package_manifest = 1,
        extract = 2,
        binlink = 3,
        // install = 3,
    };

    pub const Status = enum {
        waiting,
        success,
        fail,
    };

    pub const Data = union {
        package_manifest: Npm.PackageManifest,
        extract: string,
        binlink: bool,
    };

    pub const Request = union {
        /// package name
        // todo: Registry URL
        package_manifest: struct {
            name: strings.StringOrTinyString,
            network: *NetworkTask,
        },
        extract: struct {
            network: *NetworkTask,
            tarball: ExtractTarball,
        },
        binlink: Bin.Linker,
        // install: PackageInstall,
    };
};

const PackageInstall = struct {
    cache_dir: std.fs.Dir,
    destination_dir: std.fs.Dir,
    cache_dir_subpath: stringZ = "",
    destination_dir_subpath: stringZ = "",
    destination_dir_subpath_buf: []u8,

    allocator: *std.mem.Allocator,

    progress: *Progress,

    package_name: string,
    package_version: string,
    file_count: u32 = 0,

    threadlocal var package_json_checker: json_parser.PackageJSONVersionChecker = undefined;

    pub const Context = struct {
        metas: []const Lockfile.Package.Meta,
        names: []const String,
        resolutions: []const Resolution,
        string_buf: []const u8,
        channel: PackageInstall.Task.Channel = undefined,
        skip_verify: bool = false,
        progress: *Progress = undefined,
        cache_dir: std.fs.Dir = undefined,
        allocator: *std.mem.Allocator,
    };

    pub const Task = struct {
        task: ThreadPool.Task = .{ .callback = callback },
        result: Result = Result{ .pending = void{} },
        package_install: PackageInstall = undefined,
        package_id: PackageID,
        ctx: *PackageInstall.Context,
        destination_dir: std.fs.Dir,

        pub const Channel = sync.Channel(*PackageInstall.Task, .{ .Static = 1024 });

        pub fn callback(task: *ThreadPool.Task) void {
            Output.Source.configureThread();
            defer Output.flush();

            var this: *PackageInstall.Task = @fieldParentPtr(PackageInstall.Task, "task", task);
            var ctx = this.ctx;

            var destination_dir_subpath_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
            var cache_dir_subpath_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
            const name = ctx.names[this.package_id].slice(ctx.string_buf);
            const meta = ctx.metas[this.package_id];
            const resolution = ctx.resolutions[this.package_id];
            std.mem.copy(u8, &destination_dir_subpath_buf, name);
            destination_dir_subpath_buf[name.len] = 0;
            var destination_dir_subpath: [:0]u8 = destination_dir_subpath_buf[0..name.len :0];
            var resolution_buf: [512]u8 = undefined;
            var resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{resolution.fmt(ctx.string_buf)}) catch unreachable;

            switch (resolution.tag) {
                .npm => {
                    this.package_install = PackageInstall{
                        .cache_dir = ctx.cache_dir,
                        .progress = ctx.progress,
                        .cache_dir_subpath = PackageManager.cachedNPMPackageFolderNamePrint(&cache_dir_subpath_buf, name, resolution.value.npm),
                        .destination_dir = this.destination_dir,
                        .destination_dir_subpath = destination_dir_subpath,
                        .destination_dir_subpath_buf = &destination_dir_subpath_buf,
                        .allocator = ctx.allocator,
                        .package_name = name,
                        .package_version = resolution_label,
                    };

                    const needs_install = ctx.skip_verify or !this.package_install.verify();

                    if (needs_install) {
                        this.result = this.package_install.install(ctx.skip_verify);
                    } else {
                        this.result = .{ .skip = .{} };
                    }
                },
                else => {},
            }

            ctx.channel.writeItem(this) catch unreachable;
        }
    };

    pub const Summary = struct {
        fail: u32 = 0,
        success: u32 = 0,
        skipped: u32 = 0,
        successfully_installed: ?std.DynamicBitSetUnmanaged = null,
    };

    pub const Method = enum {
        clonefile,

        // Slower than clonefile
        clonefile_each_dir,

        // On macOS, slow.
        // On Linux, fast.
        hardlink,

        // Slowest if single-threaded
        copyfile,

        const BackendSupport = std.EnumArray(Method, bool);

        pub const macOS = BackendSupport.initDefault(false, .{
            .clonefile = true,
            .clonefile_each_dir = true,
            .hardlink = true,
            .copyfile = true,
        });

        pub const linux = BackendSupport.initDefault(false, .{
            .hardlink = true,
            .copyfile = true,
        });

        pub inline fn isSupported(this: Method) bool {
            if (comptime Environment.isMac) return macOS.get(this);
            if (comptime Environment.isLinux) return linux.get(this);

            return false;
        }
    };

    pub fn verify(
        this: *PackageInstall,
    ) bool {
        var allocator = this.allocator;
        std.mem.copy(u8, this.destination_dir_subpath_buf[this.destination_dir_subpath.len..], std.fs.path.sep_str ++ "package.json");
        this.destination_dir_subpath_buf[this.destination_dir_subpath.len + std.fs.path.sep_str.len + "package.json".len] = 0;
        var package_json_path: [:0]u8 = this.destination_dir_subpath_buf[0 .. this.destination_dir_subpath.len + std.fs.path.sep_str.len + "package.json".len :0];
        defer this.destination_dir_subpath_buf[this.destination_dir_subpath.len] = 0;

        var package_json_file = this.destination_dir.openFileZ(package_json_path, .{ .read = true }) catch return false;
        defer package_json_file.close();

        var body_pool = Npm.Registry.BodyPool.get(allocator);
        var mutable: MutableString = body_pool.data;
        defer {
            body_pool.data = mutable;
            Npm.Registry.BodyPool.release(body_pool);
        }

        mutable.reset();
        var total: usize = 0;
        var read: usize = 0;
        mutable.list.expandToCapacity();

        // Heuristic: most package.jsons will be less than 2048 bytes.
        read = package_json_file.read(mutable.list.items[total..]) catch return false;
        var remain = mutable.list.items[@minimum(total, read)..];
        if (read > 0 and remain.len < 1024) {
            mutable.growBy(4096) catch return false;
            mutable.list.expandToCapacity();
        }

        while (read > 0) : (read = package_json_file.read(remain) catch return false) {
            total += read;

            mutable.list.expandToCapacity();
            remain = mutable.list.items[total..];

            if (remain.len < 1024) {
                mutable.growBy(4096) catch return false;
            }
            mutable.list.expandToCapacity();
            remain = mutable.list.items[total..];
        }

        // If it's not long enough to have {"name": "foo", "version": "1.2.0"}, there's no way it's valid
        if (total < "{\"name\":\"\",\"version\":\"\"}".len + this.package_name.len + this.package_version.len) return false;

        const source = logger.Source.initPathString(std.mem.span(package_json_path), mutable.list.items[0..total]);
        var log = logger.Log.init(allocator);
        defer log.deinit();

        initializeStore();

        package_json_checker = json_parser.PackageJSONVersionChecker.init(allocator, &source, &log) catch return false;
        _ = package_json_checker.parseExpr() catch return false;
        if (!package_json_checker.has_found_name or !package_json_checker.has_found_version or log.errors > 0) return false;

        // Version is more likely to not match than name, so we check it first.
        return strings.eql(package_json_checker.found_version, this.package_version) and
            strings.eql(package_json_checker.found_name, this.package_name);
    }

    pub const Result = union(Tag) {
        pending: void,
        success: void,
        skip: void,
        fail: struct {
            err: anyerror,
            step: Step = Step.clone,

            pub inline fn isPackageMissingFromCache(this: @This()) bool {
                return this.err == error.FileNotFound and this.step == .opening_cache_dir;
            }
        },

        pub const Tag = enum {
            success,
            fail,
            pending,
            skip,
        };
    };

    pub const Step = enum {
        copyfile,
        opening_cache_dir,
        copying_files,
    };

    const CloneFileError = error{
        NotSupported,
        Unexpected,
        FileNotFound,
    };

    var supported_method: Method = if (Environment.isMac)
        Method.clonefile
    else
        Method.copyfile;

    fn installWithClonefileEachDir(this: *PackageInstall) !Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = this.cache_dir.openDirZ(this.cache_dir_subpath, .{
            .iterate = true,
        }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]string{},
            &[_]string{},
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer walker_.deinit();

        const FileCopier = struct {
            pub fn copy(
                destination_dir_: std.fs.Dir,
                walker: *Walker,
            ) !u32 {
                var real_file_count: u32 = 0;
                var stackpath: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                while (try walker.next()) |entry| {
                    switch (entry.kind) {
                        .Directory => std.os.mkdirat(destination_dir_.fd, entry.path, 0o755) catch {},
                        .File => {
                            std.mem.copy(u8, &stackpath, entry.path);
                            stackpath[entry.path.len] = 0;
                            var path: [:0]u8 = stackpath[0..entry.path.len :0];
                            var basename: [:0]u8 = stackpath[entry.path.len - entry.basename.len .. entry.path.len :0];
                            switch (C.clonefileat(
                                entry.dir.fd,
                                basename,
                                destination_dir_.fd,
                                path,
                                0,
                            )) {
                                0 => void{},
                                else => |errno| switch (std.os.errno(errno)) {
                                    .OPNOTSUPP => return error.NotSupported,
                                    .NOENT => return error.FileNotFound,
                                    else => return error.Unexpected,
                                },
                            }

                            real_file_count += 1;
                        },
                        else => {},
                    }
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(std.mem.span(this.destination_dir_subpath), .{ .iterate = true }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(
            subdir,
            &walker_,
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .copying_files },
        };

        return Result{
            .success = void{},
        };
    }

    // https://www.unix.com/man-page/mojave/2/fclonefileat/
    fn installWithClonefile(this: *PackageInstall) CloneFileError!Result {
        if (comptime !Environment.isMac) @compileError("clonefileat() is macOS only.");

        if (this.package_name[0] == '@') {
            const current = std.mem.span(this.destination_dir_subpath);
            if (strings.indexOfChar(current, std.fs.path.sep)) |slash| {
                this.destination_dir_subpath_buf[slash] = 0;
                var subdir = this.destination_dir_subpath_buf[0..slash :0];
                this.destination_dir.makeDirZ(subdir) catch {};
                this.destination_dir_subpath_buf[slash] = std.fs.path.sep;
            }
        }

        return switch (C.clonefileat(
            this.cache_dir.fd,
            this.cache_dir_subpath,
            this.destination_dir.fd,
            this.destination_dir_subpath,
            0,
        )) {
            0 => .{ .success = void{} },
            else => |errno| switch (std.os.errno(errno)) {
                .OPNOTSUPP => error.NotSupported,
                .NOENT => error.FileNotFound,
                // We first try to delete the directory
                // But, this can happen if this package contains a node_modules folder
                // We want to continue installing as many packages as we can, so we shouldn't block while downloading
                // We use the slow path in this case
                .EXIST => try this.installWithClonefileEachDir(),
                else => error.Unexpected,
            },
        };
    }
    fn installWithCopyfile(this: *PackageInstall) Result {
        const Walker = @import("../walker_skippable.zig");
        const CopyFile = @import("../copy_file.zig");

        var cached_package_dir = this.cache_dir.openDirZ(this.cache_dir_subpath, .{
            .iterate = true,
        }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]string{},
            &[_]string{},
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer walker_.deinit();

        const FileCopier = struct {
            pub fn copy(
                destination_dir_: std.fs.Dir,
                walker: *Walker,
                progress_: *Progress,
            ) !u32 {
                var real_file_count: u32 = 0;
                while (try walker.next()) |entry| {
                    if (entry.kind != .File) continue;
                    real_file_count += 1;

                    var outfile = destination_dir_.createFile(entry.path, .{}) catch brk: {
                        if (std.fs.path.dirname(entry.path)) |entry_dirname| {
                            destination_dir_.makePath(entry_dirname) catch {};
                        }
                        break :brk destination_dir_.createFile(entry.path, .{}) catch |err| {
                            progress_.root.end();

                            progress_.refresh();

                            Output.prettyErrorln("<r><red>{s}<r>: copying file {s}", .{ @errorName(err), entry.path });
                            Output.flush();
                            std.os.exit(1);
                        };
                    };
                    defer outfile.close();

                    var infile = try entry.dir.openFile(entry.basename, .{ .read = true });
                    defer infile.close();

                    const stat = infile.stat() catch continue;
                    _ = C.fchmod(outfile.handle, stat.mode);

                    CopyFile.copy(infile.handle, outfile.handle) catch {
                        entry.dir.copyFile(entry.basename, destination_dir_, entry.path, .{}) catch |err| {
                            progress_.root.end();

                            progress_.refresh();

                            Output.prettyErrorln("<r><red>{s}<r>: copying file {s}", .{ @errorName(err), entry.path });
                            Output.flush();
                            std.os.exit(1);
                        };
                    };
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(std.mem.span(this.destination_dir_subpath), .{ .iterate = true }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(subdir, &walker_, this.progress) catch |err| return Result{
            .fail = .{ .err = err, .step = .copying_files },
        };

        return Result{
            .success = void{},
        };
    }

    fn installWithHardlink(this: *PackageInstall) !Result {
        const Walker = @import("../walker_skippable.zig");

        var cached_package_dir = this.cache_dir.openDirZ(this.cache_dir_subpath, .{
            .iterate = true,
        }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer cached_package_dir.close();
        var walker_ = Walker.walk(
            cached_package_dir,
            this.allocator,
            &[_]string{},
            &[_]string{},
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };
        defer walker_.deinit();

        const FileCopier = struct {
            pub fn copy(
                destination_dir_: std.fs.Dir,
                walker: *Walker,
            ) !u32 {
                var real_file_count: u32 = 0;
                while (try walker.next()) |entry| {
                    switch (entry.kind) {
                        .Directory => std.os.mkdirat(destination_dir_.fd, entry.path, 0o755) catch {},
                        .File => {
                            try std.os.linkat(entry.dir.fd, entry.basename, destination_dir_.fd, entry.path, 0);
                            real_file_count += 1;
                        },
                        else => {},
                    }
                }

                return real_file_count;
            }
        };

        var subdir = this.destination_dir.makeOpenPath(std.mem.span(this.destination_dir_subpath), .{ .iterate = true }) catch |err| return Result{
            .fail = .{ .err = err, .step = .opening_cache_dir },
        };

        defer subdir.close();

        this.file_count = FileCopier.copy(
            subdir,
            &walker_,
        ) catch |err| return Result{
            .fail = .{ .err = err, .step = .copying_files },
        };

        return Result{
            .success = void{},
        };
    }

    pub fn install(this: *PackageInstall, skip_delete: bool) Result {

        // If this fails, we don't care.
        // we'll catch it the next error
        if (!skip_delete) this.destination_dir.deleteTree(std.mem.span(this.destination_dir_subpath)) catch {};

        switch (supported_method) {
            .clonefile => {
                if (comptime Environment.isMac) {
                    // First, attempt to use clonefile
                    // if that fails due to ENOTSUP, mark it as unsupported and then fall back to copyfile
                    if (this.installWithClonefile()) |result| {
                        return result;
                    } else |err| {
                        switch (err) {
                            error.NotSupported => {
                                supported_method = .copyfile;
                            },
                            error.FileNotFound => return Result{
                                .fail = .{ .err = error.FileNotFound, .step = .opening_cache_dir },
                            },
                            else => return Result{
                                .fail = .{ .err = err, .step = .copying_files },
                            },
                        }
                    }
                }
            },
            .clonefile_each_dir => {
                if (comptime Environment.isMac) {
                    if (this.installWithClonefileEachDir()) |result| {
                        return result;
                    } else |err| {
                        switch (err) {
                            error.NotSupported => {
                                supported_method = .copyfile;
                            },
                            error.FileNotFound => return Result{
                                .fail = .{ .err = error.FileNotFound, .step = .opening_cache_dir },
                            },
                            else => return Result{
                                .fail = .{ .err = err, .step = .copying_files },
                            },
                        }
                    }
                }
            },
            .hardlink => {
                if (this.installWithHardlink()) |result| {
                    return result;
                } else |err| {
                    switch (err) {
                        error.NotSupported => {
                            supported_method = .copyfile;
                        },
                        error.FileNotFound => return Result{
                            .fail = .{ .err = error.FileNotFound, .step = .opening_cache_dir },
                        },
                        else => return Result{
                            .fail = .{ .err = err, .step = .copying_files },
                        },
                    }
                }
            },
            else => {},
        }

        if (supported_method != .copyfile) return Result{
            .success = void{},
        };

        // TODO: linux io_uring
        return this.installWithCopyfile();
    }
};

const Resolution = @import("./resolution.zig").Resolution;
const Progress = std.Progress;
const TaggedPointer = @import("../tagged_pointer.zig");
const TaskCallbackContext = union(Tag) {
    dependency: PackageID,
    request_id: PackageID,
    node_modules_folder: u32, // Really, this is a file descriptor
    pub const Tag = enum {
        dependency,
        request_id,
        node_modules_folder,
    };
};

const TaskCallbackList = std.ArrayListUnmanaged(TaskCallbackContext);
const TaskDependencyQueue = std.HashMapUnmanaged(u64, TaskCallbackList, IdentityContext(u64), 80);
const TaskChannel = sync.Channel(Task, .{ .Static = 4096 });
const NetworkChannel = sync.Channel(*NetworkTask, .{ .Static = 8192 });
const ThreadPool = @import("thread_pool");
const PackageManifestMap = std.HashMapUnmanaged(PackageNameHash, Npm.PackageManifest, IdentityContext(PackageNameHash), 80);

pub const CacheLevel = struct {
    use_cache_control_headers: bool,
    use_etag: bool,
    use_last_modified: bool,
};

// We can't know all the package s we need until we've downloaded all the packages
// The easy way wouild be:
// 1. Download all packages, parsing their dependencies and enqueuing all dependnecies for resolution
// 2.
pub const PackageManager = struct {
    cache_directory_path: string = "",
    cache_directory: std.fs.Dir = undefined,
    root_dir: *Fs.FileSystem.DirEntry,
    env_loader: *DotEnv.Loader,
    allocator: *std.mem.Allocator,
    log: *logger.Log,
    resolve_tasks: TaskChannel,
    timestamp: u32 = 0,
    extracted_count: u32 = 0,
    default_features: Features = Features{},
    summary: Lockfile.Package.Diff.Summary = Lockfile.Package.Diff.Summary{},
    env: *DotEnv.Loader,
    progress: Progress = .{},
    downloads_node: ?*Progress.Node = null,
    progress_name_buf: [768]u8 = undefined,
    progress_name_buf_dynamic: []u8 = &[_]u8{},
    cpu_count: u32 = 0,
    package_json_updates: []UpdateRequest = &[_]UpdateRequest{},

    to_remove: []const UpdateRequest = &[_]UpdateRequest{},

    root_package_json_file: std.fs.File,
    root_dependency_list: Lockfile.DependencySlice = .{},

    registry: Npm.Registry = Npm.Registry{},

    thread_pool: ThreadPool,

    manifests: PackageManifestMap = PackageManifestMap{},
    folders: FolderResolution.Map = FolderResolution.Map{},
    resolved_package_index: PackageIndex = PackageIndex{},

    task_queue: TaskDependencyQueue = .{},
    network_dedupe_map: NetworkTaskQueue = .{},
    network_channel: NetworkChannel = NetworkChannel.init(),
    network_tarball_batch: ThreadPool.Batch = ThreadPool.Batch{},
    network_resolve_batch: ThreadPool.Batch = ThreadPool.Batch{},
    network_task_fifo: NetworkQueue = undefined,
    preallocated_network_tasks: PreallocatedNetworkTasks = PreallocatedNetworkTasks{ .buffer = undefined, .len = 0 },
    pending_tasks: u32 = 0,
    total_tasks: u32 = 0,

    lockfile: *Lockfile = undefined,

    options: Options = Options{},

    const PreallocatedNetworkTasks = std.BoundedArray(NetworkTask, 1024);
    const NetworkTaskQueue = std.HashMapUnmanaged(u64, void, IdentityContext(u64), 80);
    const PackageIndex = std.AutoHashMapUnmanaged(u64, *Package);
    pub var verbose_install = false;

    const PackageDedupeList = std.HashMapUnmanaged(
        u32,
        void,
        IdentityContext(u32),
        80,
    );

    pub fn setNodeName(
        this: *PackageManager,
        node: *Progress.Node,
        name: string,
        emoji: string,
        comptime is_first: bool,
    ) void {
        if (Output.isEmojiEnabled()) {
            if (is_first) {
                std.mem.copy(u8, &this.progress_name_buf, emoji);
                std.mem.copy(u8, this.progress_name_buf[emoji.len..], name);
                node.name = this.progress_name_buf[0 .. emoji.len + name.len];
            } else {
                std.mem.copy(u8, this.progress_name_buf[emoji.len..], name);
                node.name = this.progress_name_buf[0 .. emoji.len + name.len];
            }
        } else {
            std.mem.copy(u8, &this.progress_name_buf, name);
            node.name = this.progress_name_buf[0..name.len];
        }
    }

    var cached_package_folder_name_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    pub var instance: PackageManager = undefined;

    pub fn getNetworkTask(this: *PackageManager) *NetworkTask {
        if (this.preallocated_network_tasks.len + 1 < this.preallocated_network_tasks.buffer.len) {
            const len = this.preallocated_network_tasks.len;
            this.preallocated_network_tasks.len += 1;
            return &this.preallocated_network_tasks.buffer[len];
        }

        return this.allocator.create(NetworkTask) catch @panic("Memory allocation failure creating NetworkTask!");
    }

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderName(name: string, version: Semver.Version) stringZ {
        return cachedNPMPackageFolderNamePrint(&cached_package_folder_name_buf, name, version);
    }

    // TODO: normalize to alphanumeric
    pub fn cachedNPMPackageFolderNamePrint(buf: []u8, name: string, version: Semver.Version) stringZ {
        if (!version.tag.hasPre() and !version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(buf, "{s}@{d}.{d}.{d}", .{ name, version.major, version.minor, version.patch }) catch unreachable;
        } else if (version.tag.hasPre() and version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{x}+{X}",
                .{ name, version.major, version.minor, version.patch, version.tag.pre.hash, version.tag.build.hash },
            ) catch unreachable;
        } else if (version.tag.hasPre()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}-{x}",
                .{ name, version.major, version.minor, version.patch, version.tag.pre.hash },
            ) catch unreachable;
        } else if (version.tag.hasBuild()) {
            return std.fmt.bufPrintZ(
                buf,
                "{s}@{d}.{d}.{d}+{X}",
                .{ name, version.major, version.minor, version.patch, version.tag.build.hash },
            ) catch unreachable;
        } else {
            unreachable;
        }

        unreachable;
    }

    pub fn isFolderInCache(this: *PackageManager, folder_path: stringZ) bool {
        // TODO: is this slow?
        var dir = this.cache_directory.openDirZ(folder_path, .{ .iterate = true }) catch return false;
        dir.close();
        return true;
    }

    const ResolvedPackageResult = struct {
        package: Lockfile.Package,

        /// Is this the first time we've seen this package?
        is_first_time: bool = false,

        /// Pending network task to schedule
        network_task: ?*NetworkTask = null,
    };

    pub fn getOrPutResolvedPackageWithFindResult(
        this: *PackageManager,
        name_hash: PackageNameHash,
        name: String,
        version: Dependency.Version,
        dependency_id: PackageID,
        behavior: Behavior,
        manifest: *const Npm.PackageManifest,
        find_result: Npm.PackageManifest.FindResult,
    ) !?ResolvedPackageResult {

        // Was this package already allocated? Let's reuse the existing one.
        if (this.lockfile.getPackageID(
            name_hash,
            if (behavior.isPeer()) version else null,
            .{
                .tag = .npm,
                .value = .{ .npm = find_result.version },
            },
        )) |id| {
            this.lockfile.buffers.resolutions.items[dependency_id] = id;
            return ResolvedPackageResult{
                .package = this.lockfile.packages.get(id),
                .is_first_time = false,
            };
        }

        var package =
            try Lockfile.Package.fromNPM(
            this.allocator,
            this.lockfile,
            this.log,
            manifest,
            find_result.version,
            find_result.package,
            manifest.string_buf,
            Features.npm,
        );

        if (!behavior.isEnabled(this.options.omit.toFeatures())) {
            package.meta.preinstall_state = .done;
        }

        const preinstall = package.determinePreinstallState(this.lockfile, this);

        // appendPackage sets the PackageID on the package
        package = try this.lockfile.appendPackage(package);
        this.lockfile.buffers.resolutions.items[dependency_id] = package.meta.id;
        if (comptime Environment.isDebug or Environment.isTest) std.debug.assert(package.meta.id != invalid_package_id);

        switch (preinstall) {
            // Is this package already in the cache?
            // We don't need to download the tarball, but we should enqueue dependencies
            .done => {
                return ResolvedPackageResult{ .package = package, .is_first_time = true };
            },

            // Do we need to download the tarball?
            .extract => {
                const task_id = Task.Id.forNPMPackage(
                    Task.Tag.extract,
                    name.slice(this.lockfile.buffers.string_bytes.items),
                    package.resolution.value.npm,
                );

                var network_task = (try this.generateNetworkTaskForTarball(task_id, package)).?;

                return ResolvedPackageResult{
                    .package = package,
                    .is_first_time = true,
                    .network_task = network_task,
                };
            },
            else => unreachable,
        }

        return ResolvedPackageResult{ .package = package };
    }

    pub fn generateNetworkTaskForTarball(this: *PackageManager, task_id: u64, package: Lockfile.Package) !?*NetworkTask {
        const dedupe_entry = try this.network_dedupe_map.getOrPut(this.allocator, task_id);
        if (dedupe_entry.found_existing) return null;

        var network_task = this.getNetworkTask();

        network_task.* = NetworkTask{
            .task_id = task_id,
            .callback = undefined,
            .allocator = this.allocator,
        };

        try network_task.forTarball(
            this.allocator,
            ExtractTarball{
                .name = if (package.name.len() >= strings.StringOrTinyString.Max)
                    strings.StringOrTinyString.init(
                        try FileSystem.FilenameStore.instance.append(
                            @TypeOf(this.lockfile.str(package.name)),
                            this.lockfile.str(package.name),
                        ),
                    )
                else
                    strings.StringOrTinyString.init(this.lockfile.str(package.name)),

                .resolution = package.resolution,
                .cache_dir = this.cache_directory_path,
                .registry = this.registry.url.href,
                .package_id = package.meta.id,
                .extracted_file_count = package.meta.file_count,
                .integrity = package.meta.integrity,
            },
        );

        return network_task;
    }

    pub fn fetchVersionsForPackageName(
        this: *PackageManager,
        name: string,
        version: Dependency.Version,
        id: PackageID,
    ) !?Npm.PackageManifest {
        const task_id = Task.Id.forManifest(Task.Tag.package_manifest, name);
        var network_entry = try this.network_dedupe_map.getOrPutContext(this.allocator, task_id, .{});
        var loaded_manifest: ?Npm.PackageManifest = null;
        if (!network_entry.found_existing) {
            if (this.options.enable.manifest_cache) {
                if (this.manifests.get(std.hash.Wyhash.hash(0, name)) orelse (Npm.PackageManifest.Serializer.load(this.allocator, this.cache_directory, name) catch null)) |manifest_| {
                    const manifest: Npm.PackageManifest = manifest_;
                    loaded_manifest = manifest;

                    if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                        try this.manifests.put(this.allocator, @truncate(PackageNameHash, manifest.pkg.name.hash), manifest);
                    }

                    // If it's an exact package version already living in the cache
                    // We can skip the network request, even if it's beyond the caching period
                    if (version.tag == .npm and version.value.npm.isExact()) {
                        if (loaded_manifest.?.findByVersion(version.value.npm.head.head.range.left.version) != null) {
                            return manifest;
                        }
                    }

                    // Was it recent enough to just load it without the network call?
                    if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                        return manifest;
                    }
                }
            }

            if (PackageManager.verbose_install) {
                Output.prettyErrorln("Enqueue package manifest for download: {s}", .{name});
            }

            var network_task = this.getNetworkTask();
            network_task.* = NetworkTask{
                .callback = undefined,
                .task_id = task_id,
                .allocator = this.allocator,
            };
            try network_task.forManifest(name, this.allocator, this.registry.url, loaded_manifest);
            this.enqueueNetworkTask(network_task);
        }

        var manifest_entry_parse = try this.task_queue.getOrPutContext(this.allocator, task_id, .{});
        if (!manifest_entry_parse.found_existing) {
            manifest_entry_parse.value_ptr.* = TaskCallbackList{};
        }

        try manifest_entry_parse.value_ptr.append(this.allocator, TaskCallbackContext{ .request_id = id });
        return null;
    }

    fn enqueueNetworkTask(this: *PackageManager, task: *NetworkTask) void {
        if (this.network_task_fifo.writableLength() == 0) {
            this.flushNetworkQueue();
        }

        this.network_task_fifo.writeItemAssumeCapacity(task);
    }

    pub fn getOrPutResolvedPackage(
        this: *PackageManager,
        name_hash: PackageNameHash,
        name: String,
        version: Dependency.Version,
        behavior: Behavior,
        dependency_id: PackageID,
        resolution: PackageID,
    ) !?ResolvedPackageResult {
        if (resolution < this.lockfile.packages.len) {
            return ResolvedPackageResult{ .package = this.lockfile.packages.get(resolution) };
        }

        switch (version.tag) {
            .npm, .dist_tag => {
                // Resolve the version from the loaded NPM manifest
                const manifest = this.manifests.getPtr(name_hash) orelse return null; // manifest might still be downloading. This feels unreliable.
                const find_result: Npm.PackageManifest.FindResult = switch (version.tag) {
                    .dist_tag => manifest.findByDistTag(this.lockfile.str(version.value.dist_tag)),
                    .npm => manifest.findBestVersion(version.value.npm),
                    else => unreachable,
                } orelse return switch (version.tag) {
                    .npm => error.NoMatchingVersion,
                    .dist_tag => error.DistTagNotFound,
                    else => unreachable,
                };

                return try getOrPutResolvedPackageWithFindResult(this, name_hash, name, version, dependency_id, behavior, manifest, find_result);
            },

            .folder => {
                const res = FolderResolution.getOrPut(version.value.folder.slice(this.lockfile.buffers.string_bytes.items), this);

                switch (res) {
                    .err => |err| return err,
                    .package_id => |package_id| {
                        this.lockfile.buffers.resolutions.items[dependency_id] = package_id;
                        return ResolvedPackageResult{ .package = this.lockfile.packages.get(res.package_id) };
                    },
                }
            },

            else => return null,
        }
    }

    pub fn resolvePackageFromManifest(
        this: *PackageManager,
        semver: Semver.Version,
        version: *const Npm.PackageVersion,
        manifest: *const Npm.PackageManifest,
    ) !void {}

    fn enqueueParseNPMPackage(
        this: *PackageManager,
        task_id: u64,
        name: strings.StringOrTinyString,
        network_task: *NetworkTask,
    ) *ThreadPool.Task {
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.package_manifest,
            .request = .{
                .package_manifest = .{
                    .network = network_task,
                    .name = name,
                },
            },
            .id = task_id,
            .data = undefined,
        };
        return &task.threadpool_task;
    }

    fn enqueueExtractNPMPackage(
        this: *PackageManager,
        tarball: ExtractTarball,
        network_task: *NetworkTask,
    ) *ThreadPool.Task {
        var task = this.allocator.create(Task) catch unreachable;
        task.* = Task{
            .log = logger.Log.init(this.allocator),
            .tag = Task.Tag.extract,
            .request = .{
                .extract = .{
                    .network = network_task,
                    .tarball = tarball,
                },
            },
            .id = network_task.task_id,
            .data = undefined,
        };
        return &task.threadpool_task;
    }

    inline fn enqueueDependency(this: *PackageManager, id: u32, dependency: Dependency, resolution: PackageID) !void {
        return try this.enqueueDependencyWithMain(id, dependency, resolution, false);
    }

    pub fn writeYarnLock(this: *PackageManager) !void {
        var printer = Lockfile.Printer{
            .lockfile = this.lockfile,
            .options = this.options,
        };

        var tmpname_buf: [512]u8 = undefined;
        tmpname_buf[0..8].* = "tmplock-".*;
        var tmpfile = FileSystem.RealFS.Tmpfile{};
        var secret: [32]u8 = undefined;
        std.mem.writeIntNative(u64, secret[0..8], @intCast(u64, std.time.milliTimestamp()));
        var rng = std.rand.Gimli.init(secret);
        var base64_bytes: [64]u8 = undefined;
        rng.random.bytes(&base64_bytes);

        const tmpname__ = std.fmt.bufPrint(tmpname_buf[8..], "{s}", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;
        tmpname_buf[tmpname__.len + 8] = 0;
        const tmpname = tmpname_buf[0 .. tmpname__.len + 8 :0];

        tmpfile.create(&FileSystem.instance.fs, tmpname) catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to create tmpfile: {s}", .{@errorName(err)});
            Output.flush();
            Global.crash();
        };

        var file = tmpfile.file();
        var file_writer = file.writer();
        var buffered_writer = std.io.BufferedWriter(std.mem.page_size, @TypeOf(file_writer)){
            .unbuffered_writer = file_writer,
        };
        var writer = buffered_writer.writer();
        try Lockfile.Printer.Yarn.print(&printer, @TypeOf(writer), writer);
        try buffered_writer.flush();

        _ = C.fchmod(
            tmpfile.fd,
            // chmod 666,
            0000040 | 0000004 | 0000002 | 0000400 | 0000200 | 0000020,
        );

        try tmpfile.promote(tmpname, std.fs.cwd().fd, "yarn.lock");
    }

    fn enqueueDependencyWithMain(
        this: *PackageManager,
        id: u32,
        dependency: Dependency,
        resolution: PackageID,
        comptime is_main: bool,
    ) !void {
        const name = dependency.name;
        const name_hash = dependency.name_hash;
        const version: Dependency.Version = dependency.version;
        var loaded_manifest: ?Npm.PackageManifest = null;

        if (comptime !is_main) {
            // it might really be main
            if (!(id >= this.root_dependency_list.off and id < this.root_dependency_list.len + this.root_dependency_list.off)) {
                if (!dependency.behavior.isEnabled(Features.npm))
                    return;
            }
        }

        switch (dependency.version.tag) {
            .folder, .npm, .dist_tag => {
                retry_from_manifests_ptr: while (true) {
                    var resolve_result_ = this.getOrPutResolvedPackage(
                        name_hash,
                        name,
                        version,
                        dependency.behavior,
                        id,
                        resolution,
                    );

                    retry_with_new_resolve_result: while (true) {
                        const resolve_result = resolve_result_ catch |err| {
                            switch (err) {
                                error.DistTagNotFound => {
                                    if (dependency.behavior.isRequired()) {
                                        this.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "Package \"{s}\" with tag \"{s}\" not found, but package exists",
                                            .{
                                                this.lockfile.str(name),
                                                this.lockfile.str(version.value.dist_tag),
                                            },
                                        ) catch unreachable;
                                    }

                                    return;
                                },
                                error.NoMatchingVersion => {
                                    if (dependency.behavior.isRequired()) {
                                        this.log.addErrorFmt(
                                            null,
                                            logger.Loc.Empty,
                                            this.allocator,
                                            "No version matching \"{s}\" found for specifier \"{s}\" (but package exists)",
                                            .{
                                                this.lockfile.str(version.literal),
                                                this.lockfile.str(name),
                                            },
                                        ) catch unreachable;
                                    }
                                    return;
                                },
                                else => return err,
                            }
                        };

                        if (resolve_result) |result| {

                            // First time?
                            if (result.is_first_time) {
                                if (PackageManager.verbose_install) {
                                    const label: string = this.lockfile.str(version.literal);

                                    Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
                                        this.lockfile.str(result.package.name),
                                        label,
                                        this.lockfile.str(result.package.name),
                                        result.package.resolution.fmt(this.lockfile.buffers.string_bytes.items),
                                    });
                                }
                                // Resolve dependencies first
                                if (result.package.dependencies.len > 0) {
                                    try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
                                }
                            }

                            if (result.network_task) |network_task| {
                                var meta: *Lockfile.Package.Meta = &this.lockfile.packages.items(.meta)[result.package.meta.id];
                                if (meta.preinstall_state == .extract) {
                                    meta.preinstall_state = .extracting;
                                    this.enqueueNetworkTask(network_task);
                                }
                            }
                        } else if (!dependency.behavior.isPeer() and dependency.version.tag.isNPM()) {
                            const name_str = this.lockfile.str(name);
                            const task_id = Task.Id.forManifest(Task.Tag.package_manifest, name_str);
                            var network_entry = try this.network_dedupe_map.getOrPutContext(this.allocator, task_id, .{});
                            if (!network_entry.found_existing) {
                                if (this.options.enable.manifest_cache) {
                                    if (Npm.PackageManifest.Serializer.load(this.allocator, this.cache_directory, name_str) catch null) |manifest_| {
                                        const manifest: Npm.PackageManifest = manifest_;
                                        loaded_manifest = manifest;

                                        if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                                            try this.manifests.put(this.allocator, @truncate(PackageNameHash, manifest.pkg.name.hash), manifest);
                                        }

                                        // If it's an exact package version already living in the cache
                                        // We can skip the network request, even if it's beyond the caching period
                                        if (dependency.version.tag == .npm and dependency.version.value.npm.isExact()) {
                                            if (loaded_manifest.?.findByVersion(dependency.version.value.npm.head.head.range.left.version)) |find_result| {
                                                if (this.getOrPutResolvedPackageWithFindResult(
                                                    name_hash,
                                                    name,
                                                    version,
                                                    id,
                                                    dependency.behavior,
                                                    &loaded_manifest.?,
                                                    find_result,
                                                ) catch null) |new_resolve_result| {
                                                    resolve_result_ = new_resolve_result;
                                                    _ = this.network_dedupe_map.remove(task_id);
                                                    continue :retry_with_new_resolve_result;
                                                }
                                            }
                                        }

                                        // Was it recent enough to just load it without the network call?
                                        if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                                            _ = this.network_dedupe_map.remove(task_id);
                                            continue :retry_from_manifests_ptr;
                                        }
                                    }
                                }

                                if (PackageManager.verbose_install) {
                                    Output.prettyErrorln("Enqueue package manifest for download: {s}", .{this.lockfile.str(name)});
                                }

                                var network_task = this.getNetworkTask();
                                network_task.* = NetworkTask{
                                    .callback = undefined,
                                    .task_id = task_id,
                                    .allocator = this.allocator,
                                };
                                try network_task.forManifest(this.lockfile.str(name), this.allocator, this.registry.url, loaded_manifest);
                                this.enqueueNetworkTask(network_task);
                            }

                            var manifest_entry_parse = try this.task_queue.getOrPutContext(this.allocator, task_id, .{});
                            if (!manifest_entry_parse.found_existing) {
                                manifest_entry_parse.value_ptr.* = TaskCallbackList{};
                            }

                            try manifest_entry_parse.value_ptr.append(this.allocator, TaskCallbackContext{ .dependency = id });
                        }
                        return;
                    }
                }
                return;
            },
            else => {},
        }
    }

    fn flushNetworkQueue(this: *PackageManager) void {
        var network = &this.network_task_fifo;

        while (network.readItem()) |network_task| {
            network_task.schedule(if (network_task.callback == .extract) &this.network_tarball_batch else &this.network_resolve_batch);
        }
    }

    fn doFlushDependencyQueue(this: *PackageManager) void {
        var lockfile = this.lockfile;
        var dependency_queue = &lockfile.scratch.dependency_list_queue;

        while (dependency_queue.readItem()) |dependencies_list| {
            var i: u32 = dependencies_list.off;
            const end = dependencies_list.off + dependencies_list.len;
            while (i < end) : (i += 1) {
                this.enqueueDependencyWithMain(
                    i,
                    lockfile.buffers.dependencies.items[i],
                    lockfile.buffers.resolutions.items[i],
                    false,
                ) catch {};
            }

            this.flushNetworkQueue();
        }
    }
    pub fn flushDependencyQueue(this: *PackageManager) void {
        this.flushNetworkQueue();
        this.doFlushDependencyQueue();
        this.doFlushDependencyQueue();
        this.doFlushDependencyQueue();
        this.flushNetworkQueue();
    }

    pub fn scheduleNetworkTasks(manager: *PackageManager) usize {
        const count = manager.network_resolve_batch.len + manager.network_tarball_batch.len;

        manager.pending_tasks += @truncate(u32, count);
        manager.total_tasks += @truncate(u32, count);
        manager.network_resolve_batch.push(manager.network_tarball_batch);
        NetworkThread.global.pool.schedule(manager.network_resolve_batch);
        manager.network_tarball_batch = .{};
        manager.network_resolve_batch = .{};
        return count;
    }

    pub fn enqueueDependencyList(
        this: *PackageManager,
        dependencies_list: Lockfile.DependencySlice,
        comptime is_main: bool,
    ) void {
        this.task_queue.ensureUnusedCapacity(this.allocator, dependencies_list.len) catch unreachable;
        var lockfile = this.lockfile;

        // Step 1. Go through main dependencies
        {
            var i: u32 = dependencies_list.off;
            const end = dependencies_list.off + dependencies_list.len;
            // we have to be very careful with pointers here
            while (i < end) : (i += 1) {
                this.enqueueDependencyWithMain(
                    i,
                    lockfile.buffers.dependencies.items[i],
                    lockfile.buffers.resolutions.items[i],
                    is_main,
                ) catch {};
            }
        }

        // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
        this.flushDependencyQueue();

        if (PackageManager.verbose_install) Output.flush();

        // It's only network requests here because we don't store tarballs.
        const count = this.network_resolve_batch.len + this.network_tarball_batch.len;
        this.pending_tasks += @truncate(u32, count);
        this.total_tasks += @truncate(u32, count);
        this.network_resolve_batch.push(this.network_tarball_batch);
        NetworkThread.global.pool.schedule(this.network_resolve_batch);
        this.network_tarball_batch = .{};
        this.network_resolve_batch = .{};
    }

    pub fn hoist(this: *PackageManager) !void {}
    pub fn link(this: *PackageManager) !void {}

    pub fn fetchCacheDirectoryPath(
        allocator: *std.mem.Allocator,
        env_loader: *DotEnv.Loader,
        root_dir: *Fs.FileSystem.DirEntry,
    ) ?string {
        if (env_loader.map.get("BUN_INSTALL_CACHE_DIR")) |dir| {
            return dir;
        }

        if (env_loader.map.get("BUN_INSTALL")) |dir| {
            var parts = [_]string{ dir, "install/", "cache/" };
            return Fs.FileSystem.instance.abs(&parts);
        }

        if (env_loader.map.get("HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return Fs.FileSystem.instance.abs(&parts);
        }

        if (env_loader.map.get("XDG_CACHE_HOME")) |dir| {
            var parts = [_]string{ dir, ".bun/", "install/", "cache/" };
            return Fs.FileSystem.instance.abs(&parts);
        }

        if (env_loader.map.get("TMPDIR")) |dir| {
            var parts = [_]string{ dir, ".bun-cache" };
            return Fs.FileSystem.instance.abs(&parts);
        }

        return null;
    }

    fn runTasks(
        manager: *PackageManager,
        comptime ExtractCompletionContext: type,
        extract_ctx: ExtractCompletionContext,
        comptime callback_fn: anytype,
        comptime log_level: Options.LogLevel,
    ) anyerror!void {
        var batch = ThreadPool.Batch{};
        var has_updated_this_run = false;
        while (manager.network_channel.tryReadItem() catch null) |task_| {
            var task: *NetworkTask = task_;
            manager.pending_tasks -= 1;

            switch (task.callback) {
                .package_manifest => |manifest_req| {
                    const name = manifest_req.name;
                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, name.slice(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                    const response = task.http.response orelse {
                        if (comptime log_level != .silent) {
                            Output.prettyErrorln("Failed to download package manifest for package {s}", .{
                                name.slice(),
                            });
                            Output.flush();
                        }
                        continue;
                    };

                    if (response.status_code > 399) {
                        if (comptime log_level != .silent) {
                            const fmt = "<r><red><b>GET<r><red> {s}<d> - {d}<r>\n";
                            const args = .{
                                task.http.client.url.href,
                                response.status_code,
                            };

                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(fmt, args);
                                Output.flush();
                            }
                        }
                        continue;
                    }

                    if (comptime log_level.isVerbose()) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@floatCast(f64, @intToFloat(f128, task.http.elapsed) / std.time.ns_per_ms));
                        Output.prettyError(" <d>Downloaded <r><green>{s}<r> versions\n", .{name.slice()});
                        Output.flush();
                    }

                    if (response.status_code == 304) {
                        // The HTTP request was cached
                        if (manifest_req.loaded_manifest) |manifest| {
                            var entry = try manager.manifests.getOrPut(manager.allocator, manifest.pkg.name.hash);
                            entry.value_ptr.* = manifest;
                            entry.value_ptr.*.pkg.public_max_age = @truncate(u32, @intCast(u64, @maximum(0, std.time.timestamp()))) + 300;
                            {
                                var tmpdir = Fs.FileSystem.instance.tmpdir();
                                Npm.PackageManifest.Serializer.save(entry.value_ptr, tmpdir, PackageManager.instance.cache_directory) catch {};
                            }

                            var dependency_list_entry = manager.task_queue.getEntry(task.task_id).?;

                            var dependency_list = dependency_list_entry.value_ptr.*;
                            dependency_list_entry.value_ptr.* = .{};

                            if (dependency_list.items.len > 0) {
                                for (dependency_list.items) |item| {
                                    var dependency = manager.lockfile.buffers.dependencies.items[item.dependency];
                                    var resolution = manager.lockfile.buffers.resolutions.items[item.dependency];

                                    try manager.enqueueDependency(
                                        item.dependency,
                                        dependency,
                                        resolution,
                                    );
                                }

                                dependency_list.deinit(manager.allocator);
                            }

                            manager.flushDependencyQueue();
                            continue;
                        }
                    }

                    batch.push(ThreadPool.Batch.from(manager.enqueueParseNPMPackage(task.task_id, name, task)));
                },
                .extract => |extract| {
                    const response = task.http.response orelse {
                        const fmt = "Failed to download package tarball for package {s}\n";
                        const args = .{extract.name.slice()};

                        if (comptime log_level != .silent) {
                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(fmt, args);
                                Output.flush();
                            }
                        }
                        continue;
                    };

                    if (response.status_code > 399) {
                        if (comptime log_level != .silent) {
                            const fmt = "<r><red><b>GET<r><red> {s}<d> - {d}<r>\n";
                            const args = .{
                                task.http.client.url.href,
                                response.status_code,
                            };

                            if (comptime log_level.showProgress()) {
                                Output.prettyWithPrinterFn(fmt, args, Progress.log, &manager.progress);
                            } else {
                                Output.prettyErrorln(
                                    fmt,
                                    args,
                                );
                                Output.flush();
                            }
                        }
                        continue;
                    }

                    if (comptime log_level.isVerbose()) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@floatCast(f64, @intToFloat(f128, task.http.elapsed) / std.time.ns_per_ms));
                        Output.prettyError(" <d>Downloaded <r><green>{s}<r> tarball\n", .{extract.name.slice()});
                        Output.flush();
                    }

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, extract.name.slice(), ProgressStrings.extract_emoji, true);
                            has_updated_this_run = true;
                        }
                    }

                    batch.push(ThreadPool.Batch.from(manager.enqueueExtractNPMPackage(extract, task)));
                },
                .binlink => {},
            }
        }

        while (manager.resolve_tasks.tryReadItem() catch null) |task_| {
            manager.pending_tasks -= 1;

            var task: Task = task_;
            if (task.log.msgs.items.len > 0) {
                if (Output.enable_ansi_colors) {
                    try task.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                } else {
                    try task.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                }
            }

            switch (task.tag) {
                .package_manifest => {
                    if (task.status == .fail) {
                        if (comptime log_level != .silent) {
                            Output.prettyErrorln("Failed to parse package manifest for {s}", .{task.request.package_manifest.name.slice()});
                            Output.flush();
                        }
                        continue;
                    }
                    const manifest = task.data.package_manifest;
                    var entry = try manager.manifests.getOrPutValue(manager.allocator, @truncate(PackageNameHash, manifest.pkg.name.hash), manifest);

                    var dependency_list_entry = manager.task_queue.getEntry(task.id).?;
                    var dependency_list = dependency_list_entry.value_ptr.*;
                    dependency_list_entry.value_ptr.* = .{};

                    if (dependency_list.items.len > 0) {
                        for (dependency_list.items) |item| {
                            var dependency = manager.lockfile.buffers.dependencies.items[item.dependency];
                            var resolution = manager.lockfile.buffers.resolutions.items[item.dependency];

                            try manager.enqueueDependency(
                                item.dependency,
                                dependency,
                                resolution,
                            );
                        }

                        dependency_list.deinit(manager.allocator);
                    }

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, manifest.name(), ProgressStrings.download_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .extract => {
                    if (task.status == .fail) {
                        Output.prettyErrorln("Failed to extract tarball for {s}", .{
                            task.request.extract.tarball.name,
                        });
                        Output.flush();
                        continue;
                    }
                    const package_id = task.request.extract.tarball.package_id;
                    manager.extracted_count += 1;
                    manager.lockfile.packages.items(.meta)[package_id].preinstall_state = .done;

                    if (comptime ExtractCompletionContext != void) {
                        callback_fn(extract_ctx, package_id, comptime log_level);
                    }

                    if (comptime log_level.showProgress()) {
                        if (!has_updated_this_run) {
                            manager.setNodeName(manager.downloads_node.?, task.request.extract.tarball.name.slice(), ProgressStrings.extract_emoji, true);
                            has_updated_this_run = true;
                        }
                    }
                },
                .binlink => {},
            }
        }

        manager.flushDependencyQueue();

        const prev_total = manager.total_tasks;
        {
            const count = batch.len + manager.network_resolve_batch.len + manager.network_tarball_batch.len;
            manager.pending_tasks += @truncate(u32, count);
            manager.total_tasks += @truncate(u32, count);
            manager.thread_pool.schedule(batch);
            manager.network_resolve_batch.push(manager.network_tarball_batch);
            NetworkThread.global.pool.schedule(manager.network_resolve_batch);
            manager.network_tarball_batch = .{};
            manager.network_resolve_batch = .{};

            if (comptime log_level.showProgress()) {
                if (comptime ExtractCompletionContext == void) {
                    const completed_items = manager.total_tasks - manager.pending_tasks;
                    if (completed_items != manager.downloads_node.?.unprotected_completed_items or has_updated_this_run) {
                        manager.downloads_node.?.setCompletedItems(completed_items);
                        manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks);
                    }
                }

                manager.downloads_node.?.activate();
                manager.progress.maybeRefresh();
            }
        }
    }

    pub const Options = struct {
        log_level: LogLevel = LogLevel.default,

        lockfile_path: stringZ = Lockfile.default_filename,
        save_lockfile_path: stringZ = Lockfile.default_filename,
        scope: Npm.Registry.Scope = .{
            .name = "",
            .token = "",
            .url = URL.parse("https://registry.npmjs.org/"),
        },

        registries: Npm.Registry.Map = Npm.Registry.Map{},
        cache_directory: string = "",
        enable: Enable = .{},
        do: Do = .{},
        positionals: []const string = &[_]string{},
        update: Update = Update{},
        dry_run: bool = false,
        omit: CommandLineArguments.Omit = .{},

        allowed_install_scripts: []const PackageNameHash = &default_allowed_install_scripts,

        // The idea here is:
        // 1. package has a platform-specific binary to install
        // 2. To prevent downloading & installing incompatible versions, they stick the "real" one in optionalDependencies
        // 3. The real one we want to link is in another package
        // 4. Therefore, we remap the "bin" specified in the real package
        //    to the target package which is the one which is:
        //      1. In optionalDepenencies
        //      2. Has a platform and/or os specified, which evaluates to not disabled
        native_bin_link_allowlist: []const PackageNameHash = &default_native_bin_link_allowlist,

        const default_native_bin_link_allowlist = [_]PackageNameHash{
            String.Builder.stringHash("esbuild"),
            String.Builder.stringHash("turbo"),
        };

        const install_scripts_package_count = 5;
        const default_allowed_install_scripts: [install_scripts_package_count]PackageNameHash = brk: {
            const names = std.mem.span(@embedFile("install-scripts-allowlist.txt"));
            var hashes: [install_scripts_package_count]PackageNameHash = undefined;
            var splitter = std.mem.split(u8, names, "\n");
            var i: usize = 0;
            while (splitter.next()) |item| {
                hashes[i] = String.Builder.stringHash(item);
                i += 1;
            }
            break :brk hashes;
        };

        pub const LogLevel = enum {
            default,
            verbose,
            silent,
            default_no_progress,
            verbose_no_progress,

            pub inline fn isVerbose(this: LogLevel) bool {
                return return switch (this) {
                    .verbose_no_progress, .verbose => true,
                    else => false,
                };
            }
            pub inline fn showProgress(this: LogLevel) bool {
                return switch (this) {
                    .default, .verbose => true,
                    else => false,
                };
            }
        };

        pub const Update = struct {
            development: bool = false,
            optional: bool = false,
        };

        pub fn load(
            this: *Options,
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            env_loader: *DotEnv.Loader,
            cli_: ?CommandLineArguments,
        ) !void {

            // technically, npm_config is case in-sensitive
            // load_registry:
            {
                const registry_keys = [_]string{
                    "BUN_CONFIG_REGISTRY",
                    "NPM_CONFIG_REGISTRY",
                    "npm_config_registry",
                };
                var did_set = false;

                inline for (registry_keys) |registry_key| {
                    if (!did_set) {
                        if (env_loader.map.get(registry_key)) |registry_| {
                            if (registry_.len > 0 and
                                (strings.startsWith(registry_, "https://") or
                                strings.startsWith(registry_, "http://")))
                            {
                                this.scope.url = URL.parse(registry_);
                                did_set = true;
                                // stage1 bug: break inside inline is broken
                                // break :load_registry;
                            }
                        }
                    }
                }
            }

            {
                const token_keys = [_]string{
                    "BUN_CONFIG_TOKEN",
                    "NPM_CONFIG_token",
                    "npm_config_token",
                };
                var did_set = false;

                inline for (token_keys) |registry_key| {
                    if (!did_set) {
                        if (env_loader.map.get(registry_key)) |registry_| {
                            if (registry_.len > 0) {
                                this.scope.token = registry_;
                                did_set = true;
                                // stage1 bug: break inside inline is broken
                                // break :load_registry;
                            }
                        }
                    }
                }
            }

            if (cli_) |cli| {
                if (cli.registry.len > 0 and strings.startsWith(cli.registry, "https://") or
                    strings.startsWith(cli.registry, "http://"))
                {
                    this.scope.url = URL.parse(cli.registry);
                }

                if (cli.token.len > 0) {
                    this.scope.token = cli.token;
                }

                if (cli.lockfile.len > 0) {
                    this.lockfile_path = try allocator.dupeZ(u8, cli.lockfile);
                }
            }

            this.save_lockfile_path = this.lockfile_path;

            if (env_loader.map.get("BUN_CONFIG_LOCKFILE_SAVE_PATH")) |save_lockfile_path| {
                this.save_lockfile_path = try allocator.dupeZ(u8, save_lockfile_path);
            }

            if (env_loader.map.get("BUN_CONFIG_NO_CLONEFILE") != null) {
                PackageInstall.supported_method = .copyfile;
            }

            if (env_loader.map.get("BUN_CONFIG_YARN_LOCKFILE") != null) {
                this.do.save_yarn_lock = true;
            }

            if (env_loader.map.get("BUN_CONFIG_LINK_NATIVE_BINS")) |native_packages| {
                const len = std.mem.count(u8, native_packages, " ");
                if (len > 0) {
                    var all = try allocator.alloc(PackageNameHash, this.native_bin_link_allowlist.len + len);
                    std.mem.copy(PackageNameHash, all, this.native_bin_link_allowlist);
                    var remain = all[this.native_bin_link_allowlist.len..];
                    var splitter = std.mem.split(u8, native_packages, " ");
                    var i: usize = 0;
                    while (splitter.next()) |name| {
                        remain[i] = String.Builder.stringHash(name);
                        i += 1;
                    }
                    this.native_bin_link_allowlist = all;
                }
            }

            // if (env_loader.map.get("BUN_CONFIG_NO_DEDUPLICATE") != null) {
            //     this.enable.deduplicate_packages = false;
            // }

            this.do.save_lockfile = strings.eqlComptime((env_loader.map.get("BUN_CONFIG_SKIP_SAVE_LOCKFILE") orelse "0"), "0");
            this.do.load_lockfile = strings.eqlComptime((env_loader.map.get("BUN_CONFIG_SKIP_LOAD_LOCKFILE") orelse "0"), "0");
            this.do.install_packages = strings.eqlComptime((env_loader.map.get("BUN_CONFIG_SKIP_INSTALL_PACKAGES") orelse "0"), "0");

            if (cli_) |cli| {
                if (cli.no_save) {
                    this.do.save_lockfile = false;
                }

                if (cli.dry_run) {
                    this.do.install_packages = false;
                    this.dry_run = true;
                }

                if (cli.no_cache) {
                    this.enable.manifest_cache = false;
                    this.enable.manifest_cache_control = false;
                }

                // if (cli.no_dedupe) {
                //     this.enable.deduplicate_packages = false;
                // }

                this.omit.dev = cli.omit.dev or this.omit.dev;
                this.omit.optional = cli.omit.optional or this.omit.optional;
                this.omit.peer = cli.omit.peer or this.omit.peer;

                if (cli.verbose) {
                    this.log_level = .verbose;
                    PackageManager.verbose_install = true;
                } else if (cli.silent) {
                    this.log_level = .silent;
                    PackageManager.verbose_install = false;
                }

                if (cli.yarn) {
                    this.do.save_yarn_lock = true;
                }

                if (cli.link_native_bins.len > 0) {
                    var all = try allocator.alloc(PackageNameHash, this.native_bin_link_allowlist.len + cli.link_native_bins.len);
                    std.mem.copy(PackageNameHash, all, this.native_bin_link_allowlist);
                    var remain = all[this.native_bin_link_allowlist.len..];
                    for (cli.link_native_bins) |name, i| {
                        remain[i] = String.Builder.stringHash(name);
                    }
                    this.native_bin_link_allowlist = all;
                }

                if (cli.backend) |backend| {
                    PackageInstall.supported_method = backend;
                }

                if (cli.positionals.len > 0) {
                    this.positionals = cli.positionals;
                }

                if (cli.production) {
                    this.enable.install_dev_dependencies = false;
                }

                if (cli.force) {
                    this.enable.manifest_cache_control = false;
                    this.enable.force_install = true;
                }

                this.update.development = cli.development;
                if (!this.update.development) this.update.optional = cli.optional;
            }
        }

        pub const Do = struct {
            save_lockfile: bool = true,
            load_lockfile: bool = true,
            install_packages: bool = true,
            save_yarn_lock: bool = false,
        };

        pub const Enable = struct {
            manifest_cache: bool = true,
            manifest_cache_control: bool = true,
            cache: bool = true,

            /// Disabled because it doesn't actually reduce the number of packages we end up installing
            /// Probably need to be a little smarter
            deduplicate_packages: bool = false,

            install_dev_dependencies: bool = true,
            force_install: bool = false,
        };
    };

    const ProgressStrings = struct {
        pub const download_no_emoji_ = "Resolving";
        const download_no_emoji: string = download_no_emoji_ ++ "\n";
        const download_with_emoji: string = download_emoji ++ download_no_emoji_;
        pub const download_emoji: string = "  🔍 ";

        pub const extract_no_emoji_ = "Resolving & extracting";
        const extract_no_emoji: string = extract_no_emoji_ ++ "\n";
        const extract_with_emoji: string = extract_emoji ++ extract_no_emoji_;
        pub const extract_emoji: string = "  🚚 ";

        pub const install_no_emoji_ = "Installing";
        const install_no_emoji: string = install_no_emoji_ ++ "\n";
        const install_with_emoji: string = install_emoji ++ install_no_emoji_;
        pub const install_emoji: string = "  📦 ";

        pub const save_no_emoji_ = "Saving lockfile";
        const save_no_emoji: string = save_no_emoji_;
        const save_with_emoji: string = save_emoji ++ save_no_emoji_;
        pub const save_emoji: string = "  🔒 ";

        pub inline fn download() string {
            return if (Output.isEmojiEnabled()) download_with_emoji else download_no_emoji;
        }

        pub inline fn save() string {
            return if (Output.isEmojiEnabled()) save_with_emoji else save_no_emoji;
        }

        pub inline fn extract() string {
            return if (Output.isEmojiEnabled()) extract_with_emoji else extract_no_emoji;
        }

        pub inline fn install() string {
            return if (Output.isEmojiEnabled()) install_with_emoji else install_no_emoji;
        }
    };

    const PackageJSONEditor = struct {
        pub fn edit(
            allocator: *std.mem.Allocator,
            updates: []UpdateRequest,
            current_package_json: *JSAst.Expr,
            dependency_list: string,
        ) !void {
            const G = JSAst.G;

            var remaining: usize = updates.len;

            // There are three possible scenarios here
            // 1. There is no "dependencies" (or equivalent list) or it is empty
            // 2. There is a "dependencies" (or equivalent list), but the package name already exists in a separate list
            // 3. There is a "dependencies" (or equivalent list), and the package name exists in multiple lists
            ast_modifier: {
                // Try to use the existing spot in the dependencies list if possible
                for (updates) |update, i| {
                    outer: for (dependency_lists_to_check) |list| {
                        if (current_package_json.asProperty(list)) |query| {
                            if (query.expr.data == .e_object) {
                                if (query.expr.asProperty(update.name)) |value| {
                                    if (value.expr.data == .e_string) {
                                        updates[i].e_string = value.expr.data.e_string;
                                        remaining -= 1;
                                    }
                                    break :outer;
                                }
                            }
                        }
                    }
                }

                if (remaining == 0)
                    break :ast_modifier;

                var dependencies: []G.Property = &[_]G.Property{};
                if (current_package_json.asProperty(dependency_list)) |query| {
                    if (query.expr.data == .e_object) {
                        dependencies = query.expr.data.e_object.properties;
                    }
                }

                var new_dependencies = try allocator.alloc(G.Property, dependencies.len + remaining);
                std.mem.copy(G.Property, new_dependencies, dependencies);
                std.mem.set(G.Property, new_dependencies[dependencies.len..], G.Property{});

                outer: for (updates) |update, j| {
                    if (update.e_string != null) continue;

                    var k: usize = 0;

                    while (k < new_dependencies.len) : (k += 1) {
                        if (new_dependencies[k].key == null) {
                            new_dependencies[k].key = JSAst.Expr.init(
                                JSAst.E.String,
                                JSAst.E.String{
                                    .utf8 = update.name,
                                },
                                logger.Loc.Empty,
                            );

                            new_dependencies[k].value = JSAst.Expr.init(
                                JSAst.E.String,
                                JSAst.E.String{
                                    // we set it later
                                    .utf8 = "",
                                },
                                logger.Loc.Empty,
                            );
                            updates[j].e_string = new_dependencies[k].value.?.data.e_string;
                            continue :outer;
                        }

                        // This actually is a duplicate
                        // like "react" appearing in both "dependencies" and "optionalDependencies"
                        // For this case, we'll just swap remove it
                        if (new_dependencies[k].key.?.data.e_string.eql(string, update.name)) {
                            if (new_dependencies.len > 1) {
                                new_dependencies[k] = new_dependencies[new_dependencies.len - 1];
                                new_dependencies = new_dependencies[0 .. new_dependencies.len - 1];
                            } else {
                                new_dependencies = &[_]G.Property{};
                            }
                        }
                    }
                }

                var needs_new_dependency_list = true;
                var dependencies_object: JSAst.Expr = undefined;
                if (current_package_json.asProperty(dependency_list)) |query| {
                    if (query.expr.data == .e_object) {
                        needs_new_dependency_list = false;

                        dependencies_object = query.expr;
                    }
                }

                if (needs_new_dependency_list) {
                    dependencies_object = JSAst.Expr.init(
                        JSAst.E.Object,
                        JSAst.E.Object{
                            .properties = new_dependencies,
                        },
                        logger.Loc.Empty,
                    );
                }

                if (current_package_json.data != .e_object or current_package_json.data.e_object.properties.len == 0) {
                    var root_properties = try allocator.alloc(JSAst.G.Property, 1);
                    root_properties[0] = JSAst.G.Property{
                        .key = JSAst.Expr.init(
                            JSAst.E.String,
                            JSAst.E.String{
                                .utf8 = dependency_list,
                            },
                            logger.Loc.Empty,
                        ),
                        .value = dependencies_object,
                    };
                    current_package_json.* = JSAst.Expr.init(JSAst.E.Object, JSAst.E.Object{ .properties = root_properties }, logger.Loc.Empty);
                } else if (needs_new_dependency_list) {
                    var root_properties = try allocator.alloc(JSAst.G.Property, current_package_json.data.e_object.properties.len + 1);
                    std.mem.copy(JSAst.G.Property, root_properties, current_package_json.data.e_object.properties);
                    root_properties[root_properties.len - 1].key = JSAst.Expr.init(
                        JSAst.E.String,
                        JSAst.E.String{
                            .utf8 = dependency_list,
                        },
                        logger.Loc.Empty,
                    );
                    root_properties[root_properties.len - 1].value = dependencies_object;
                    current_package_json.* = JSAst.Expr.init(JSAst.E.Object, JSAst.E.Object{ .properties = root_properties }, logger.Loc.Empty);
                }

                dependencies_object.data.e_object.properties = new_dependencies;
                dependencies_object.data.e_object.packageJSONSort();
            }

            for (updates) |*update, j| {
                var str = update.e_string.?;

                if (update.version.tag == .uninitialized) {
                    str.utf8 = latest;
                } else {
                    str.utf8 = update.version.literal.slice(update.version_buf);
                }
            }
        }
    };

    fn init(
        ctx: Command.Context,
        package_json_file_: ?std.fs.File,
        comptime params: []const ParamType,
    ) !*PackageManager {
        // assume that spawning a thread will take a lil so we do that asap
        try NetworkThread.init();

        var cli = try CommandLineArguments.parse(ctx.allocator, params);

        var fs = try Fs.FileSystem.init1(ctx.allocator, null);
        var original_cwd = std.mem.trimRight(u8, fs.top_level_dir, "/");

        std.mem.copy(u8, &cwd_buf, original_cwd);

        // Step 1. Find the nearest package.json directory
        //
        // We will walk up from the cwd, calling chdir on each directory until we find a package.json
        // If we fail to find one, we will report an error saying no packages to install
        var package_json_file: std.fs.File = undefined;

        if (package_json_file_) |file| {
            package_json_file = file;
        } else {
            // can't use orelse due to a stage1 bug
            package_json_file = std.fs.cwd().openFileZ("package.json", .{ .read = true, .write = true }) catch |err2| brk: {
                var this_cwd = original_cwd;
                outer: while (std.fs.path.dirname(this_cwd)) |parent| {
                    cwd_buf[parent.len] = 0;
                    var chdir = cwd_buf[0..parent.len :0];

                    std.os.chdirZ(chdir) catch |err| {
                        Output.prettyErrorln("Error {s} while chdir - {s}", .{ @errorName(err), std.mem.span(chdir) });
                        Output.flush();
                        return err;
                    };

                    break :brk std.fs.cwd().openFileZ("package.json", .{ .read = true, .write = true }) catch |err| {
                        this_cwd = parent;
                        continue :outer;
                    };
                }

                std.mem.copy(u8, &cwd_buf, original_cwd);
                cwd_buf[original_cwd.len] = 0;
                var real_cwd: [:0]u8 = cwd_buf[0..original_cwd.len :0];
                std.os.chdirZ(real_cwd) catch {};

                return error.MissingPackageJSON;
            };
        }

        fs.top_level_dir = try std.os.getcwd(&cwd_buf);
        cwd_buf[fs.top_level_dir.len] = '/';
        cwd_buf[fs.top_level_dir.len + 1] = 0;
        fs.top_level_dir = cwd_buf[0 .. fs.top_level_dir.len + 1];
        std.mem.copy(u8, &package_json_cwd_buf, fs.top_level_dir);
        std.mem.copy(u8, package_json_cwd_buf[fs.top_level_dir.len..], "package.json");

        var entries_option = try fs.fs.readDirectory(fs.top_level_dir, null);
        var options = Options{};
        var cache_directory: std.fs.Dir = undefined;

        var env_loader: *DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            var loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };

        env_loader.loadProcess();
        try env_loader.load(&fs.fs, &entries_option.entries, false);

        if (env_loader.map.get("BUN_INSTALL_VERBOSE") != null) {
            PackageManager.verbose_install = true;
        }

        if (PackageManager.fetchCacheDirectoryPath(ctx.allocator, env_loader, &entries_option.entries)) |cache_dir_path| {
            options.cache_directory = try fs.dirname_store.append(@TypeOf(cache_dir_path), cache_dir_path);
            cache_directory = std.fs.cwd().makeOpenPath(options.cache_directory, .{ .iterate = true }) catch |err| brk: {
                options.enable.cache = false;
                options.enable.manifest_cache = false;
                options.enable.manifest_cache_control = false;
                Output.prettyErrorln("Cache is disabled due to error: {s}", .{@errorName(err)});
                break :brk undefined;
            };
        } else {}

        if (PackageManager.verbose_install) {
            Output.prettyErrorln("Cache Dir: {s}", .{options.cache_directory});
            Output.flush();
        }

        var cpu_count = @truncate(u32, ((try std.Thread.getCpuCount()) + 1));

        if (env_loader.map.get("GOMAXPROCS")) |max_procs| {
            if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count_| {
                cpu_count = @minimum(cpu_count, cpu_count_);
            } else |err| {}
        }

        var manager = &instance;
        // var progress = Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        manager.* = PackageManager{
            .options = options,
            .network_task_fifo = NetworkQueue.init(),
            .cache_directory = cache_directory,
            .env_loader = env_loader,
            .allocator = ctx.allocator,
            .log = ctx.log,
            .root_dir = &entries_option.entries,
            .env = env_loader,
            .cpu_count = cpu_count,
            .thread_pool = ThreadPool.init(.{
                .max_threads = cpu_count,
            }),
            .resolve_tasks = TaskChannel.init(),
            .lockfile = undefined,
            .root_package_json_file = package_json_file,
            // .progress
        };
        manager.lockfile = try ctx.allocator.create(Lockfile);

        if (!manager.options.enable.cache) {
            manager.options.enable.manifest_cache = false;
            manager.options.enable.manifest_cache_control = false;
        }

        if (env_loader.map.get("BUN_MANIFEST_CACHE")) |manifest_cache| {
            if (strings.eqlComptime(manifest_cache, "1")) {
                manager.options.enable.manifest_cache = true;
                manager.options.enable.manifest_cache_control = false;
            } else if (strings.eqlComptime(manifest_cache, "2")) {
                manager.options.enable.manifest_cache = true;
                manager.options.enable.manifest_cache_control = true;
            } else {
                manager.options.enable.manifest_cache = false;
                manager.options.enable.manifest_cache_control = false;
            }
        }

        try manager.options.load(
            ctx.allocator,
            ctx.log,
            env_loader,
            cli,
        );
        manager.registry.url = manager.options.scope.url;
        manager.registry.scopes = manager.options.registries;
        manager.registry.token = manager.options.scope.token;
        manager.registry.auth = manager.options.scope.auth;

        manager.timestamp = @truncate(u32, @intCast(u64, @maximum(std.time.timestamp(), 0)));
        return manager;
    }

    pub inline fn add(
        ctx: Command.Context,
    ) !void {
        try updatePackageJSONAndInstall(ctx, .add, &add_params);
    }

    pub inline fn remove(
        ctx: Command.Context,
    ) !void {
        try updatePackageJSONAndInstall(ctx, .remove, &remove_params);
    }

    const ParamType = clap.Param(clap.Help);
    pub const install_params_ = [_]ParamType{
        clap.parseParam("--registry <STR>                  Change default registry (default: $BUN_CONFIG_REGISTRY || $npm_config_registry)") catch unreachable,
        clap.parseParam("--token <STR>                     Authentication token used for npm registry requests (default: $npm_config_token)") catch unreachable,
        clap.parseParam("-y, --yarn                        Write a yarn.lock file (yarn v1)") catch unreachable,
        clap.parseParam("-p, --production                  Don't install devDependencies") catch unreachable,
        clap.parseParam("--no-save                         Don't save a lockfile") catch unreachable,
        clap.parseParam("--dry-run                         Don't install anything") catch unreachable,
        clap.parseParam("--lockfile <STR>                  Store & load a lockfile at a specific filepath") catch unreachable,
        clap.parseParam("-f, --force                       Always request the latest versions from the registry & reinstall all dependenices") catch unreachable,
        clap.parseParam("--cache-dir <STR>                 Store & load cached data from a specific directory path") catch unreachable,
        clap.parseParam("--no-cache                        Ignore manifest cache entirely") catch unreachable,
        clap.parseParam("--silent                          Don't log anything") catch unreachable,
        clap.parseParam("--verbose                         Excessively verbose logging") catch unreachable,
        clap.parseParam("--cwd <STR>                       Set a specific cwd") catch unreachable,
        clap.parseParam("--backend <STR>                   Platform-specific optimizations for installing dependencies. For macOS, \"clonefile\" (default), \"copyfile\"") catch unreachable,
        clap.parseParam("--link-native-bins <STR>...       Link \"bin\" from a matching platform-specific \"optionalDependencies\" instead. Default: esbuild, turbo") catch unreachable,

        // clap.parseParam("--omit <STR>...                   Skip installing dependencies of a certain type. \"dev\", \"optional\", or \"peer\"") catch unreachable,
        // clap.parseParam("--no-dedupe                       Disable automatic downgrading of dependencies that would otherwise cause unnecessary duplicate package versions ($BUN_CONFIG_NO_DEDUPLICATE)") catch unreachable,

        clap.parseParam("--help                            Print this help menu") catch unreachable,
    };

    pub const install_params = install_params_ ++ [_]ParamType{
        clap.parseParam("<POS> ...                         ") catch unreachable,
    };

    pub const add_params = install_params_ ++ [_]ParamType{
        clap.parseParam("-d, --development                 Add depenedency to \"devDependencies\"") catch unreachable,
        clap.parseParam("--optional                        Add depenedency to \"optionalDependencies\"") catch unreachable,
        clap.parseParam("<POS> ...                         \"name\" or \"name@version\" of packages to install") catch unreachable,
    };

    pub const remove_params = install_params_ ++ [_]ParamType{
        clap.parseParam("<POS> ...                         \"name\" of packages to remove from package.json") catch unreachable,
    };

    const CommandLineArguments = struct {
        registry: string = "",
        cache_dir: string = "",
        lockfile: string = "",
        token: string = "",

        backend: ?PackageInstall.Method = null,

        positionals: []const string = &[_]string{},

        yarn: bool = false,
        production: bool = false,
        no_save: bool = false,
        dry_run: bool = false,
        force: bool = false,
        no_dedupe: bool = false,
        no_cache: bool = false,
        silent: bool = false,
        verbose: bool = false,

        link_native_bins: []const string = &[_]string{},

        development: bool = false,
        optional: bool = false,

        no_optional: bool = false,
        omit: Omit = Omit{},

        const Omit = struct {
            dev: bool = false,
            optional: bool = false,
            peer: bool = false,

            pub inline fn toFeatures(this: Omit) Features {
                return Features{
                    .dev_dependencies = this.dev,
                    .optional_dependencies = this.optional,
                    .peer_dependencies = this.peer,
                };
            }
        };

        pub fn parse(
            allocator: *std.mem.Allocator,
            comptime params: []const ParamType,
        ) !CommandLineArguments {
            var diag = clap.Diagnostic{};

            var args = clap.parse(clap.Help, params, .{
                .diagnostic = &diag,
                .allocator = allocator,
            }) catch |err| {
                // Report useful error and exit
                diag.report(Output.errorWriter(), err) catch {};
                return err;
            };

            if (args.flag("--help")) {
                Output.prettyln("\n<b><magenta>bun<r> (package manager) flags:<r>\n\n", .{});
                Output.flush();

                clap.help(Output.writer(), params) catch {};

                Output.flush();
                std.os.exit(0);
            }

            var cli = CommandLineArguments{};
            cli.yarn = args.flag("--yarn");
            cli.production = args.flag("--production");
            cli.no_save = args.flag("--no-save");
            cli.dry_run = args.flag("--dry-run");
            cli.force = args.flag("--force");
            // cli.no_dedupe = args.flag("--no-dedupe");
            cli.no_cache = args.flag("--no-cache");
            cli.silent = args.flag("--silent");
            cli.verbose = args.flag("--verbose");

            cli.link_native_bins = args.options("--link-native-bins");

            if (comptime params.len == add_params.len) {
                cli.development = args.flag("--development");
                cli.optional = args.flag("--optional");
            }

            // for (args.options("--omit")) |omit| {
            //     if (strings.eqlComptime(omit, "dev")) {
            //         cli.omit.dev = true;
            //     } else if (strings.eqlComptime(omit, "optional")) {
            //         cli.omit.optional = true;
            //     } else if (strings.eqlComptime(omit, "peer")) {
            //         cli.omit.peer = true;
            //     } else {
            //         Output.prettyErrorln("<b>error<r><d>:<r> Invalid argument <b>\"--omit\"<r> must be one of <cyan>\"dev\"<r>, <cyan>\"optional\"<r>, or <cyan>\"peer\"<r>. ", .{});
            //         Output.flush();
            //         std.os.exit(1);
            //     }
            // }

            if (args.option("--token")) |token| {
                cli.token = token;
            }

            if (args.option("--lockfile")) |lockfile| {
                cli.lockfile = lockfile;
            }

            if (args.option("--cwd")) |cwd_| {
                var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                var buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                var final_path: [:0]u8 = undefined;
                if (cwd_.len > 0 and cwd_[0] == '.') {
                    var cwd = try std.os.getcwd(&buf);
                    var parts = [_]string{cwd_};
                    var path_ = resolve_path.joinAbsStringBuf(cwd, &buf2, &parts, .auto);
                    buf2[path_.len] = 0;
                    final_path = buf2[0..path_.len :0];
                } else {
                    std.mem.copy(u8, &buf, cwd_);
                    buf[cwd_.len] = 0;
                    final_path = buf[0..cwd_.len :0];
                }
                try std.os.chdirZ(final_path);
            }

            if (args.option("--registry")) |registry_| {
                cli.registry = registry_;
            }

            const specified_backend: ?PackageInstall.Method = brk: {
                if (args.option("--backend")) |backend_| {
                    if (strings.eqlComptime(backend_, "clonefile")) {
                        break :brk PackageInstall.Method.clonefile;
                    } else if (strings.eqlComptime(backend_, "clonefile_each_dir")) {
                        break :brk PackageInstall.Method.clonefile_each_dir;
                    } else if (strings.eqlComptime(backend_, "hardlink")) {
                        break :brk PackageInstall.Method.hardlink;
                    } else if (strings.eqlComptime(backend_, "copyfile")) {
                        break :brk PackageInstall.Method.copyfile;
                    }
                }
                break :brk null;
            };

            if (specified_backend) |backend| {
                if (backend.isSupported()) {
                    cli.backend = backend;
                }
            }

            cli.positionals = args.positionals();

            return cli;
        }
    };
    const latest: string = "latest";

    const UpdateRequest = struct {
        name: string = "",
        resolved_version_buf: string = "",
        version: Dependency.Version = Dependency.Version{},
        version_buf: []const u8 = "",
        resolved_version: Resolution = Resolution{},
        resolution_string_buf: []const u8 = "",
        missing_version: bool = false,
        e_string: ?*JSAst.E.String = null,
    };

    fn updatePackageJSONAndInstall(
        ctx: Command.Context,
        comptime op: Lockfile.Package.Diff.Op,
        comptime params: []const ParamType,
    ) !void {
        var manager = PackageManager.init(ctx, null, params) catch |err| brk: {
            switch (err) {
                error.MissingPackageJSON => {
                    if (op == .add or op == .update) {
                        var package_json_file = std.fs.cwd().createFileZ("package.json", .{
                            .read = true,
                        }) catch |err2| {
                            Output.prettyErrorln("<r><red>error:<r> {s} create package.json", .{@errorName(err2)});
                            Global.crash();
                        };
                        try package_json_file.pwriteAll("{\"dependencies\": {}}", 0);

                        break :brk try PackageManager.init(ctx, package_json_file, params);
                    }

                    Output.prettyErrorln("<r>No package.json, so nothing to remove\n", .{});
                    Global.crash();
                },
                else => return err,
            }

            unreachable;
        };

        if (manager.options.log_level != .silent) {
            Output.prettyErrorln("<r><b>bun " ++ @tagName(op) ++ " <r><d>v" ++ Global.package_json_version ++ "<r>\n", .{});
            Output.flush();
        }

        switch (manager.options.log_level) {
            .default => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .default),
            .verbose => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .verbose),
            .silent => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .silent),
            .default_no_progress => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .default_no_progress),
            .verbose_no_progress => try updatePackageJSONAndInstallWithManager(ctx, manager, op, .verbose_no_progress),
        }
    }

    const dependency_lists_to_check = [_]string{
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    };

    fn updatePackageJSONAndInstallWithManager(
        ctx: Command.Context,
        manager: *PackageManager,
        comptime op: Lockfile.Package.Diff.Op,
        comptime log_level: Options.LogLevel,
    ) !void {
        var update_requests = try std.BoundedArray(UpdateRequest, 64).init(0);
        var need_to_get_versions_from_npm = false;

        if (manager.options.positionals.len == 1) {
            var examples_to_print: [3]string = undefined;

            const off = @intCast(u64, std.time.milliTimestamp());

            switch (op) {
                .update, .add => {
                    const filler = @import("../cli.zig").HelpCommand.packages_to_add_filler;

                    examples_to_print[0] = filler[@intCast(usize, (off) % filler.len)];
                    examples_to_print[1] = filler[@intCast(usize, (off + 1) % filler.len)];
                    examples_to_print[2] = filler[@intCast(usize, (off + 2) % filler.len)];

                    Output.prettyErrorln(
                        \\
                        \\<r><b>Usage:<r>
                        \\
                        \\  bun add <r><cyan>package-name@version<r>
                        \\  bun add <r><cyan>package-name<r>
                        \\  bun add <r><cyan>package-name a-second-package<r>
                        \\
                        \\<r><b>Examples:<r>
                        \\
                        \\  bun add {s}
                        \\  bun add {s}
                        \\  bun add {s}
                        \\
                        \\<d>Shorthand: <b>bun a<r>
                        \\
                    , .{ examples_to_print[0], examples_to_print[1], examples_to_print[2] });
                    Output.flush();
                    std.os.exit(0);
                },
                .remove => {
                    const filler = @import("../cli.zig").HelpCommand.packages_to_remove_filler;

                    examples_to_print[0] = filler[@intCast(usize, (off) % filler.len)];
                    examples_to_print[1] = filler[@intCast(usize, (off + 1) % filler.len)];
                    examples_to_print[2] = filler[@intCast(usize, (off + 2) % filler.len)];

                    Output.prettyErrorln(
                        \\
                        \\<r><b>Usage:<r>
                        \\
                        \\  bun remove <r><red>package-name<r>
                        \\  bun remove <r><red>package-name a-second-package<r>
                        \\
                        \\<r><b>Examples:<r>
                        \\
                        \\  bun remove {s} {s}
                        \\  bun remove {s}
                        \\
                        \\<d>Shorthand: <b>bun rm<r>
                        \\
                    , .{
                        examples_to_print[0],
                        examples_to_print[1],
                        examples_to_print[2],
                    });
                    Output.flush();

                    std.os.exit(0);
                },
            }
        }

        // first one is always either:
        // add
        // remove
        for (manager.options.positionals[1..]) |positional| {
            var request = UpdateRequest{
                .name = positional,
            };
            var unscoped_name = positional;
            if (unscoped_name.len > 0 and unscoped_name[0] == '@') {
                request.name = unscoped_name[1..];
            }
            if (std.mem.indexOfScalar(u8, unscoped_name, '@')) |i| {
                request.name = unscoped_name[0..i];

                if (unscoped_name.ptr != positional.ptr) {
                    request.name = request.name[0 .. i + 1];
                }

                if (positional.len > i + 1) request.version_buf = positional[i + 1 ..];
            }

            if (strings.hasPrefix("http://", request.name) or
                strings.hasPrefix("https://", request.name))
            {
                if (Output.isEmojiEnabled()) {
                    Output.prettyErrorln("<r>😢 <red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                        @tagName(op),
                    });
                } else {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                        @tagName(op),
                    });
                }
                Output.flush();

                std.os.exit(1);
            }

            request.name = std.mem.trim(u8, request.name, "\n\r\t");
            if (request.name.len == 0) continue;

            request.version_buf = std.mem.trim(u8, request.version_buf, "\n\r\t");

            // https://github.com/npm/npm-package-arg/blob/fbaf2fd0b72a0f38e7c24260fd4504f4724c9466/npa.js#L330
            if (strings.hasPrefix("https://", request.version_buf) or
                strings.hasPrefix("http://", request.version_buf))
            {
                if (Output.isEmojiEnabled()) {
                    Output.prettyErrorln("<r>😢 <red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                        @tagName(op),
                    });
                } else {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> bun {s} http://url is not implemented yet.", .{
                        @tagName(op),
                    });
                }
                Output.flush();

                std.os.exit(1);
            }

            if (request.version_buf.len == 0) {
                need_to_get_versions_from_npm = true;
                request.missing_version = true;
            } else {
                const sliced = SlicedString.init(request.version_buf, request.version_buf);
                request.version = Dependency.parse(ctx.allocator, request.version_buf, &sliced, ctx.log) orelse Dependency.Version{};
            }

            update_requests.append(request) catch break;
        }

        var updates: []UpdateRequest = update_requests.slice();

        if (ctx.log.errors > 0) {
            if (comptime log_level != .silent) {
                if (Output.enable_ansi_colors) {
                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                } else {
                    ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                }
            }

            Output.flush();
            Global.crash();
        }

        var current_package_json_stat = try manager.root_package_json_file.stat();
        var current_package_json_buf = try ctx.allocator.alloc(u8, current_package_json_stat.size + 64);
        const current_package_json_contents_len = try manager.root_package_json_file.preadAll(
            current_package_json_buf,
            0,
        );

        const package_json_source = logger.Source.initPathString(
            package_json_cwd_buf[0 .. FileSystem.instance.top_level_dir.len + "package.json".len],
            current_package_json_buf[0..current_package_json_contents_len],
        );

        initializeStore();
        var current_package_json = json_parser.ParseJSON(&package_json_source, ctx.log, manager.allocator) catch |err| {
            if (Output.enable_ansi_colors) {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }

            Output.panic("<r><red>{s}<r> parsing package.json<r>", .{
                @errorName(err),
            });
        };

        if (op == .remove) {
            if (current_package_json.data != .e_object) {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json is not an Object {{}}, so there's nothing to remove!", .{});
                Output.flush();
                std.os.exit(1);
                return;
            } else if (current_package_json.data.e_object.properties.len == 0) {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json is empty {{}}, so there's nothing to remove!", .{});
                Output.flush();
                std.os.exit(1);
                return;
            } else if (current_package_json.asProperty("devDependencies") == null and
                current_package_json.asProperty("dependencies") == null and
                current_package_json.asProperty("optionalDependencies") == null and
                current_package_json.asProperty("peerDependencies") == null)
            {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json doesn't have dependencies, there's nothing to remove!", .{});
                Output.flush();
                std.os.exit(1);
                return;
            }
        }

        var any_changes = false;

        var dependency_list: string = "dependencies";
        if (manager.options.update.development) {
            dependency_list = "devDependencies";
        } else if (manager.options.update.optional) {
            dependency_list = "optionalDependencies";
        }

        switch (op) {
            .remove => {
                // if we're removing, they don't have to specify where it is installed in the dependencies list
                // they can even put it multiple times and we will just remove all of them
                for (updates) |update| {
                    inline for (dependency_lists_to_check) |list| {
                        if (current_package_json.asProperty(list)) |query| {
                            if (query.expr.data == .e_object) {
                                var dependencies = query.expr.data.e_object.properties;
                                var i: usize = 0;
                                var new_len = dependencies.len;
                                while (i < dependencies.len) : (i += 1) {
                                    if (dependencies[i].key.?.data == .e_string) {
                                        if (dependencies[i].key.?.data.e_string.eql(string, update.name)) {
                                            if (new_len > 1) {
                                                dependencies[i] = dependencies[new_len - 1];
                                                new_len -= 1;
                                            } else {
                                                new_len = 0;
                                            }

                                            any_changes = true;
                                        }
                                    }
                                }

                                const changed = new_len != dependencies.len;
                                if (changed) {
                                    query.expr.data.e_object.properties = query.expr.data.e_object.properties[0..new_len];

                                    // If the dependencies list is now empty, remove it from the package.json
                                    // since we're swapRemove, we have to re-sort it
                                    if (query.expr.data.e_object.properties.len == 0) {
                                        var arraylist = std.ArrayListUnmanaged(JSAst.G.Property){
                                            .items = current_package_json.data.e_object.properties,
                                            .capacity = current_package_json.data.e_object.properties.len,
                                        };
                                        _ = arraylist.swapRemove(query.i);
                                        current_package_json.data.e_object.properties = arraylist.items;
                                        current_package_json.data.e_object.packageJSONSort();
                                    } else {
                                        var obj = query.expr.data.e_object;
                                        obj.alphabetizeProperties();
                                    }
                                }
                            }
                        }
                    }
                }

                if (!any_changes) {
                    Output.prettyErrorln("\n<red>error<r><d>:<r> \"<b>{s}<r>\" is not in a package.json file", .{updates[0].name});
                    Output.flush();
                    std.os.exit(1);
                    return;
                }
                manager.to_remove = updates;
            },
            .add, .update => {
                try PackageJSONEditor.edit(ctx.allocator, updates, &current_package_json, dependency_list);
                manager.package_json_updates = updates;
            },
        }

        var buffer_writer = try JSPrinter.BufferWriter.init(ctx.allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(ctx.allocator, current_package_json_buf.len + 1);
        var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

        var written = JSPrinter.printJSON(@TypeOf(package_json_writer), package_json_writer, current_package_json, &package_json_source) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Global.crash();
        };

        // There are various tradeoffs with how we commit updates when you run `bun add` or `bun remove`
        // The one we chose here is to effectively pretend a human did:
        // 1. "bun add react@latest"
        // 2. open lockfile, find what react resolved to
        // 3. open package.json
        // 4. replace "react" : "latest" with "react" : "^16.2.0"
        // 5. save package.json
        // The Smarter™ approach is you resolve ahead of time and write to disk once!
        // But, turns out that's slower in any case where more than one package has to be resolved (most of the time!)
        // Concurrent network requests are faster than doing one and then waiting until the next batch
        var new_package_json_source = package_json_writer.ctx.buffer.toOwnedSliceLeaky().ptr[0 .. written + 1];

        try installWithManager(ctx, manager, new_package_json_source, log_level);

        if (op == .update or op == .add) {
            const source = logger.Source.initPathString("package.json", new_package_json_source);
            // Now, we _re_ parse our in-memory edited package.json
            // so we can commit the version we changed from the lockfile
            current_package_json = json_parser.ParseJSON(&source, ctx.log, manager.allocator) catch |err| {
                Output.prettyErrorln("<red>error<r><d>:<r> package.json failed to parse due to error {s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
                return;
            };

            try PackageJSONEditor.edit(ctx.allocator, updates, &current_package_json, dependency_list);
            var buffer_writer_two = try JSPrinter.BufferWriter.init(ctx.allocator);
            try buffer_writer_two.buffer.list.ensureTotalCapacity(ctx.allocator, current_package_json_buf.len + 1);
            var package_json_writer_two = JSPrinter.BufferPrinter.init(buffer_writer_two);

            written = JSPrinter.printJSON(
                @TypeOf(package_json_writer_two),
                package_json_writer_two,
                current_package_json,
                &source,
            ) catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                Global.crash();
            };

            new_package_json_source = package_json_writer_two.ctx.buffer.toOwnedSliceLeaky().ptr[0 .. written + 1];
        }

        if (!manager.options.dry_run) {
            // Now that we've run the install step
            // We can save our in-memory package.json to disk
            try manager.root_package_json_file.pwriteAll(new_package_json_source, 0);
            std.os.ftruncate(manager.root_package_json_file.handle, written + 1) catch {};
            manager.root_package_json_file.close();

            if (op == .remove) {
                var cwd = std.fs.cwd();
                // This is not exactly correct
                var node_modules_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                std.mem.copy(u8, &node_modules_buf, "node_modules" ++ std.fs.path.sep_str);
                var offset_buf: []u8 = node_modules_buf["node_modules/".len..];
                const name_hashes = manager.lockfile.packages.items(.name_hash);
                for (updates) |update| {
                    // If the package no longer exists in the updated lockfile, delete the directory
                    // This is not thorough.
                    // It does not handle nested dependencies
                    // This is a quick & dirty cleanup intended for when deleting top-level dependencies
                    if (std.mem.indexOfScalar(PackageNameHash, name_hashes, String.Builder.stringHash(update.name)) == null) {
                        std.mem.copy(u8, offset_buf, update.name);
                        cwd.deleteTree(node_modules_buf[0 .. "node_modules/".len + update.name.len]) catch {};
                    }
                }

                // This is where we clean dangling symlinks
                // This could be slow if there are a lot of symlinks
                if (cwd.openDirZ("node_modules/.bin", .{
                    .iterate = true,
                })) |node_modules_bin_| {
                    var node_modules_bin: std.fs.Dir = node_modules_bin_;
                    var iter: std.fs.Dir.Iterator = node_modules_bin.iterate();
                    iterator: while (iter.next() catch null) |entry| {
                        switch (entry.kind) {
                            std.fs.Dir.Entry.Kind.SymLink => {
                                if (std.fs.path.extension(entry.name).len == 0) {
                                    // any symlinks which we are unable to open are assumed to be dangling
                                    // note that using access won't work here, because access doesn't resolve symlinks
                                    std.mem.copy(u8, &node_modules_buf, entry.name);
                                    node_modules_buf[entry.name.len] = 0;
                                    var buf: [:0]u8 = node_modules_buf[0..entry.name.len :0];
                                    var file = node_modules_bin.openFileZ(buf, .{ .read = true }) catch |err| {
                                        node_modules_bin.deleteFileZ(buf) catch {};
                                        continue :iterator;
                                    };

                                    file.close();
                                }
                            },
                            else => {},
                        }
                    }
                } else |_| {}
            }
        }
    }

    var cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var package_json_cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    pub inline fn install(
        ctx: Command.Context,
    ) !void {
        var manager = try PackageManager.init(ctx, null, &install_params);

        if (manager.options.log_level != .silent) {
            Output.prettyErrorln("<r><b>bun install <r><d>v" ++ Global.package_json_version ++ "<r>\n", .{});
            Output.flush();
        }

        var package_json_contents = manager.root_package_json_file.readToEndAlloc(ctx.allocator, std.math.maxInt(usize)) catch |err| {
            if (manager.options.log_level != .silent) {
                Output.prettyErrorln("<r><red>{s} reading package.json<r> :(", .{@errorName(err)});
                Output.flush();
            }
            return;
        };

        switch (manager.options.log_level) {
            .default => try installWithManager(ctx, manager, package_json_contents, .default),
            .verbose => try installWithManager(ctx, manager, package_json_contents, .verbose),
            .silent => try installWithManager(ctx, manager, package_json_contents, .silent),
            .default_no_progress => try installWithManager(ctx, manager, package_json_contents, .default_no_progress),
            .verbose_no_progress => try installWithManager(ctx, manager, package_json_contents, .verbose_no_progress),
        }
    }

    const PackageInstaller = struct {
        manager: *PackageManager,
        lockfile: *Lockfile,
        progress: *std.Progress,
        node_modules_folder: std.fs.Dir,
        skip_verify: bool,
        skip_delete: bool,
        force_install: bool,
        root_node_modules_folder: std.fs.Dir,
        summary: *PackageInstall.Summary,
        options: *const PackageManager.Options,
        metas: []const Lockfile.Package.Meta,
        names: []const String,
        bins: []const Bin,
        resolutions: []Resolution,
        node: *Progress.Node,
        has_created_bin: bool = false,
        destination_dir_subpath_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined,
        install_count: usize = 0,
        successfully_installed: std.DynamicBitSetUnmanaged,

        // For linking native binaries, we only want to link after we've installed the companion dependencies
        // We don't want to introduce dependent callbacks like that for every single package
        // Since this will only be a handful, it's fine to just say "run this at the end"
        platform_binlinks: std.ArrayListUnmanaged(DeferredBinLink) = std.ArrayListUnmanaged(DeferredBinLink){},

        pub const DeferredBinLink = struct {
            package_id: PackageID,
            node_modules_folder: std.fs.Dir,
        };

        /// Install versions of a package which are waiting on a network request
        pub fn installEnqueuedPackages(
            this: *PackageInstaller,
            package_id: PackageID,
            comptime log_level: Options.LogLevel,
        ) void {
            const buf = this.lockfile.buffers.string_bytes.items;

            const name = this.names[package_id].slice(buf);
            const resolution = this.resolutions[package_id];

            var callbacks = this.manager.task_queue.fetchRemove(Task.Id.forNPMPackage(
                Task.Tag.extract,
                name,
                resolution.value.npm,
            )).?.value;
            defer callbacks.deinit(this.manager.allocator);

            const prev_node_modules_folder = this.node_modules_folder;
            defer this.node_modules_folder = prev_node_modules_folder;
            for (callbacks.items) |cb| {
                const node_modules_folder = cb.node_modules_folder;
                this.node_modules_folder = std.fs.Dir{ .fd = @intCast(std.os.fd_t, node_modules_folder) };
                this.installPackageWithNameAndResolution(package_id, log_level, name, resolution);
            }
        }

        fn installPackageWithNameAndResolution(
            this: *PackageInstaller,
            package_id: PackageID,
            comptime log_level: Options.LogLevel,
            name: string,
            resolution: Resolution,
        ) void {
            std.mem.copy(u8, &this.destination_dir_subpath_buf, name);
            this.destination_dir_subpath_buf[name.len] = 0;
            var destination_dir_subpath: [:0]u8 = this.destination_dir_subpath_buf[0..name.len :0];
            var resolution_buf: [512]u8 = undefined;
            const buf = this.lockfile.buffers.string_bytes.items;
            var resolution_label = std.fmt.bufPrint(&resolution_buf, "{}", .{resolution.fmt(buf)}) catch unreachable;
            switch (resolution.tag) {
                .npm => {
                    var installer = PackageInstall{
                        .cache_dir = this.manager.cache_directory,
                        .progress = this.progress,
                        .cache_dir_subpath = PackageManager.cachedNPMPackageFolderName(name, resolution.value.npm),
                        .destination_dir = this.node_modules_folder,
                        .destination_dir_subpath = destination_dir_subpath,
                        .destination_dir_subpath_buf = &this.destination_dir_subpath_buf,
                        .allocator = this.lockfile.allocator,
                        .package_name = name,
                        .package_version = resolution_label,
                    };

                    const needs_install = this.force_install or this.skip_verify or !installer.verify();
                    this.summary.skipped += @as(u32, @boolToInt(!needs_install));

                    if (needs_install) {
                        const result = installer.install(this.skip_delete);
                        switch (result) {
                            .success => {
                                const is_duplicate = this.successfully_installed.isSet(package_id);
                                this.summary.success += @as(u32, @boolToInt(!is_duplicate));
                                this.successfully_installed.set(package_id);

                                if (comptime log_level.showProgress()) {
                                    this.node.completeOne();
                                }

                                const bin = this.bins[package_id];
                                if (bin.tag != .none) {
                                    if (!this.has_created_bin) {
                                        this.node_modules_folder.makeDirZ(".bin") catch {};
                                        Bin.Linker.umask = C.umask(0);
                                        this.has_created_bin = true;
                                    }

                                    const bin_task_id = Task.Id.forBinLink(package_id);
                                    var task_queue = this.manager.task_queue.getOrPut(this.manager.allocator, bin_task_id) catch unreachable;
                                    if (!task_queue.found_existing) {
                                        run_bin_link: {
                                            if (std.mem.indexOfScalar(PackageNameHash, this.options.native_bin_link_allowlist, String.Builder.stringHash(name)) != null) {
                                                this.platform_binlinks.append(this.lockfile.allocator, .{
                                                    .package_id = package_id,
                                                    .node_modules_folder = this.node_modules_folder,
                                                }) catch unreachable;
                                                break :run_bin_link;
                                            }

                                            var bin_linker = Bin.Linker{
                                                .bin = bin,
                                                .package_installed_node_modules = this.node_modules_folder.fd,
                                                .root_node_modules_folder = this.root_node_modules_folder.fd,
                                                .package_name = strings.StringOrTinyString.init(name),
                                                .string_buf = buf,
                                            };

                                            bin_linker.link();

                                            if (comptime log_level != .silent) {
                                                if (bin_linker.err) |err| {
                                                    const fmt = "\n<r><red>error:<r> linking <b>{s}<r>: {s}\n";
                                                    const args = .{ name, @errorName(err) };

                                                    if (comptime log_level.showProgress()) {
                                                        if (Output.enable_ansi_colors) {
                                                            this.progress.log(comptime Output.prettyFmt(fmt, true), args);
                                                        } else {
                                                            this.progress.log(comptime Output.prettyFmt(fmt, false), args);
                                                        }
                                                    } else {
                                                        Output.prettyErrorln(fmt, args);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            .fail => |cause| {
                                if (cause.isPackageMissingFromCache()) {
                                    const task_id = Task.Id.forNPMPackage(Task.Tag.extract, name, resolution.value.npm);
                                    var task_queue = this.manager.task_queue.getOrPut(this.manager.allocator, task_id) catch unreachable;
                                    if (!task_queue.found_existing) {
                                        task_queue.value_ptr.* = .{};
                                    }

                                    task_queue.value_ptr.append(
                                        this.manager.allocator,
                                        .{
                                            .node_modules_folder = @intCast(u32, this.node_modules_folder.fd),
                                        },
                                    ) catch unreachable;

                                    if (this.manager.generateNetworkTaskForTarball(task_id, this.lockfile.packages.get(package_id)) catch unreachable) |task| {
                                        task.schedule(&this.manager.network_tarball_batch);
                                        if (this.manager.network_tarball_batch.len > 6) {
                                            _ = this.manager.scheduleNetworkTasks();
                                        }
                                    }
                                } else {
                                    Output.prettyErrorln(
                                        "<r><red>error<r>: <b><red>{s}<r> installing <b>{s}<r>",
                                        .{ @errorName(cause.err), this.names[package_id].slice(buf) },
                                    );
                                    this.summary.fail += 1;
                                }
                            },
                            else => {},
                        }
                    }
                },
                // TODO: support folder links deeper than node_modules folder
                // if node_modules/foo/package.json has a folder:, then this will not create a valid symlink
                .folder => {
                    var folder_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                    const folder = resolution.value.folder.slice(buf);
                    std.mem.copy(u8, &folder_buf, "../" ++ std.fs.path.sep_str);
                    std.mem.copy(u8, folder_buf["../".len..], folder);
                    folder_buf["../".len + folder.len] = 0;
                    var folderZ: [:0]u8 = folder_buf[0 .. "../".len + folder.len :0];

                    const needs_install = this.force_install or this.skip_verify or brk: {
                        std.mem.copy(u8, this.destination_dir_subpath_buf[name.len..], std.fs.path.sep_str ++ "package.json");
                        this.destination_dir_subpath_buf[name.len + "/package.json".len] = 0;
                        var package_json_path = this.destination_dir_subpath_buf[0 .. name.len + "/package.json".len :0];
                        defer this.destination_dir_subpath_buf[name.len] = 0;
                        const file = this.node_modules_folder.openFileZ(package_json_path, .{ .read = true }) catch break :brk true;
                        file.close();

                        break :brk false;
                    };
                    this.summary.skipped += @as(u32, @boolToInt(!needs_install));

                    if (needs_install) {
                        if (!this.skip_delete) this.node_modules_folder.deleteFileZ(destination_dir_subpath) catch {};

                        std.os.symlinkatZ(folderZ, this.node_modules_folder.fd, destination_dir_subpath) catch |err| {
                            Output.prettyErrorln(
                                "<r><red>error<r>: <b><red>{s}<r> installing <b>{s}<r>",
                                .{ err, this.names[package_id].slice(buf) },
                            );
                            this.summary.fail += 1;
                            return;
                        };
                        this.summary.success += 1;
                        this.successfully_installed.set(package_id);
                    }
                },
                else => {},
            }
        }

        pub fn installPackage(
            this: *PackageInstaller,
            package_id: PackageID,
            comptime log_level: Options.LogLevel,
        ) void {
            // const package_id = ctx.package_id;
            // const tree = ctx.trees[ctx.tree_id];
            const meta = &this.metas[package_id];

            if (meta.isDisabled()) {
                if (comptime log_level.showProgress()) {
                    this.node.completeOne();
                }
                return;
            }

            const buf = this.lockfile.buffers.string_bytes.items;
            const name = this.names[package_id].slice(buf);
            const resolution = this.resolutions[package_id];

            this.installPackageWithNameAndResolution(package_id, log_level, name, resolution);
        }
    };

    pub fn installPackages(
        this: *PackageManager,
        lockfile: *Lockfile,
        comptime log_level: PackageManager.Options.LogLevel,
    ) !PackageInstall.Summary {
        var root_node: *Progress.Node = undefined;
        var download_node: Progress.Node = undefined;
        var install_node: Progress.Node = undefined;
        const options = &this.options;
        var progress = &this.progress;

        if (comptime log_level.showProgress()) {
            root_node = try progress.start("", 0);
            download_node = root_node.start(ProgressStrings.download(), 0);

            install_node = root_node.start(ProgressStrings.install(), lockfile.packages.len);
            this.downloads_node = &download_node;
        }

        defer {
            if (comptime log_level.showProgress()) {
                progress.root.end();
                progress.* = .{};
            }
        }
        const cache_dir = this.cache_directory;

        lockfile.unique_packages.unset(0);

        // If there was already a valid lockfile and so we did not resolve, i.e. there was zero network activity
        // the packages could still not be in the cache dir
        // this would be a common scenario in a CI environment
        // or if you just cloned a repo
        // we want to check lazily though
        // no need to download packages you've already installed!!

        var skip_verify = false;
        var node_modules_folder = std.fs.cwd().openDirZ("node_modules", .{ .iterate = true }) catch brk: {
            skip_verify = true;
            std.fs.cwd().makeDirZ("node_modules") catch |err| {
                Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> creating <b>node_modules<r> folder", .{@errorName(err)});
                Output.flush();
                Global.crash();
            };
            break :brk std.fs.cwd().openDirZ("node_modules", .{ .iterate = true }) catch |err| {
                Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> opening <b>node_modules<r> folder", .{@errorName(err)});
                Output.flush();
                Global.crash();
            };
        };
        var skip_delete = skip_verify;
        const force_install = options.enable.force_install;
        if (options.enable.force_install) {
            skip_verify = true;
            skip_delete = false;
        }
        var summary = PackageInstall.Summary{};

        {
            var parts = lockfile.packages.slice();
            var metas = parts.items(.meta);
            var names = parts.items(.name);
            var dependency_lists: []const Lockfile.DependencySlice = parts.items(.dependencies);
            var dependencies = lockfile.buffers.dependencies.items;
            const resolutions_buffer: []const PackageID = lockfile.buffers.resolutions.items;
            const resolution_lists: []const Lockfile.PackageIDSlice = parts.items(.resolutions);
            var resolutions = parts.items(.resolution);
            const end = @truncate(PackageID, names.len);
            const pending_task_offset = this.total_tasks;
            var iterator = Lockfile.Tree.Iterator.init(
                lockfile.buffers.trees.items,
                lockfile.buffers.hoisted_packages.items,
                names,
                lockfile.buffers.string_bytes.items,
            );

            var installer = PackageInstaller{
                .manager = this,
                .options = &this.options,
                .metas = metas,
                .bins = parts.items(.bin),
                .root_node_modules_folder = node_modules_folder,
                .names = names,
                .resolutions = resolutions,
                .lockfile = lockfile,
                .node = &install_node,
                .node_modules_folder = node_modules_folder,
                .progress = progress,
                .skip_verify = skip_verify,
                .skip_delete = skip_delete,
                .summary = &summary,
                .force_install = force_install,
                .install_count = lockfile.buffers.hoisted_packages.items.len,
                .successfully_installed = try std.DynamicBitSetUnmanaged.initEmpty(lockfile.packages.len, this.allocator),
            };

            const cwd = std.fs.cwd();
            while (iterator.nextNodeModulesFolder()) |node_modules| {
                try cwd.makePath(std.mem.span(node_modules.relative_path));
                // We deliberately do not close this folder.
                // If the package hasn't been downloaded, we will need to install it later
                // We use this file descriptor to know where to put it.
                var folder = try cwd.openDirZ(node_modules.relative_path, .{
                    .iterate = true,
                });

                installer.node_modules_folder = folder;

                var remaining = node_modules.packages;

                // cache line is 64 bytes on ARM64 and x64
                // PackageIDs are 4 bytes
                // Hence, we can fit up to 64 / 4 = 16 package IDs in a cache line
                const unroll_count = comptime 64 / @sizeOf(PackageID);

                while (remaining.len > unroll_count) {
                    comptime var i: usize = 0;
                    inline while (i < unroll_count) : (i += 1) {
                        installer.installPackage(remaining[i], comptime log_level);
                    }
                    remaining = remaining[unroll_count..];

                    // We want to minimize how often we call this function
                    // That's part of why we unroll this loop
                    if (this.pending_tasks > 0) {
                        try this.runTasks(
                            *PackageInstaller,
                            &installer,
                            PackageInstaller.installEnqueuedPackages,
                            log_level,
                        );
                    }
                }

                for (remaining) |package_id| {
                    installer.installPackage(@truncate(PackageID, package_id), log_level);
                }

                try this.runTasks(
                    *PackageInstaller,
                    &installer,
                    PackageInstaller.installEnqueuedPackages,
                    log_level,
                );
            }

            while (this.pending_tasks > 0) {
                try this.runTasks(
                    *PackageInstaller,
                    &installer,
                    PackageInstaller.installEnqueuedPackages,
                    log_level,
                );
            }

            summary.successfully_installed = installer.successfully_installed;
            outer: for (installer.platform_binlinks.items) |deferred| {
                const package_id = deferred.package_id;
                const folder = deferred.node_modules_folder;

                const package_dependencies: []const Dependency = dependency_lists[package_id].get(dependencies);
                const package_resolutions: []const PackageID = resolution_lists[package_id].get(resolutions_buffer);
                const original_bin: Bin = installer.bins[package_id];

                for (package_dependencies) |dependency, i| {
                    const resolved_id = package_resolutions[i];
                    if (resolved_id >= names.len) continue;
                    const meta: Lockfile.Package.Meta = metas[resolved_id];

                    // This is specifically for platform-specific binaries
                    if (meta.os == .all and meta.arch == .all) continue;

                    // Don't attempt to link incompatible binaries
                    if (meta.isDisabled()) continue;

                    const name: string = installer.names[resolved_id].slice(lockfile.buffers.string_bytes.items);

                    if (!installer.has_created_bin) {
                        node_modules_folder.makeDirZ(".bin") catch {};
                        Bin.Linker.umask = C.umask(0);
                        installer.has_created_bin = true;
                    }

                    var bin_linker = Bin.Linker{
                        .bin = original_bin,
                        .package_installed_node_modules = folder.fd,
                        .root_node_modules_folder = node_modules_folder.fd,
                        .package_name = strings.StringOrTinyString.init(name),
                        .string_buf = lockfile.buffers.string_bytes.items,
                    };

                    bin_linker.link();

                    if (comptime log_level != .silent) {
                        if (bin_linker.err) |err| {
                            const fmt = "\n<r><red>error:<r> linking <b>{s}<r>: {s}\n";
                            const args = .{ name, @errorName(err) };

                            if (comptime log_level.showProgress()) {
                                if (Output.enable_ansi_colors) {
                                    this.progress.log(comptime Output.prettyFmt(fmt, true), args);
                                } else {
                                    this.progress.log(comptime Output.prettyFmt(fmt, false), args);
                                }
                            } else {
                                Output.prettyErrorln(fmt, args);
                            }
                        }
                    }

                    continue :outer;
                }

                if (comptime log_level != .silent) {
                    const fmt = "\n<r><yellow>warn:<r> no compatible binaries found for <b>{s}<r>\n";
                    const args = .{names[package_id]};

                    if (comptime log_level.showProgress()) {
                        if (Output.enable_ansi_colors) {
                            this.progress.log(comptime Output.prettyFmt(fmt, true), args);
                        } else {
                            this.progress.log(comptime Output.prettyFmt(fmt, false), args);
                        }
                    } else {
                        Output.prettyErrorln(fmt, args);
                    }
                }
            }
        }

        return summary;
    }

    fn installWithManager(
        ctx: Command.Context,
        manager: *PackageManager,
        package_json_contents: string,
        comptime log_level: Options.LogLevel,
    ) !void {
        var load_lockfile_result: Lockfile.LoadFromDiskResult = if (manager.options.do.load_lockfile)
            manager.lockfile.loadFromDisk(
                ctx.allocator,
                ctx.log,
                manager.options.lockfile_path,
            )
        else
            Lockfile.LoadFromDiskResult{ .not_found = .{} };

        var root = Lockfile.Package{};

        var needs_new_lockfile = load_lockfile_result != .ok;

        // this defaults to false
        // but we force allowing updates to the lockfile when you do bun add
        var had_any_diffs = false;
        manager.progress = .{};

        // Step 2. Parse the package.json file
        //
        var package_json_source = logger.Source.initPathString(
            package_json_cwd_buf[0 .. FileSystem.instance.top_level_dir.len + "package.json".len],
            package_json_contents,
        );

        switch (load_lockfile_result) {
            .err => |cause| {
                switch (cause.step) {
                    .open_file => Output.prettyErrorln("<r><red>error opening lockfile:<r> {s}. <b>Ignoring lockfile<r>.", .{
                        @errorName(cause.value),
                    }),
                    .parse_file => Output.prettyErrorln("<r><red>error parsing lockfile:<r> {s}. <b>Ignoring lockfile<r>.", .{
                        @errorName(cause.value),
                    }),
                    .read_file => Output.prettyErrorln("<r><red>error reading lockfile:<r> {s}. <b>Ignoring lockfile<r>.", .{
                        @errorName(cause.value),
                    }),
                }
                if (ctx.log.errors > 0) {
                    if (Output.enable_ansi_colors) {
                        try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                    } else {
                        try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                    }
                }
                Output.flush();
            },
            .ok => {
                differ: {
                    root = load_lockfile_result.ok.rootPackage() orelse {
                        needs_new_lockfile = true;
                        break :differ;
                    };

                    if (root.dependencies.len == 0) {
                        needs_new_lockfile = true;
                        break :differ;
                    }

                    var lockfile: Lockfile = undefined;
                    try lockfile.initEmpty(ctx.allocator);
                    var new_root: Lockfile.Package = undefined;
                    if (manager.options.enable.install_dev_dependencies) {
                        try Lockfile.Package.parseMain(
                            &lockfile,
                            &new_root,
                            ctx.allocator,
                            ctx.log,
                            package_json_source,
                            Features{
                                .optional_dependencies = true,
                                .dev_dependencies = true,
                                .is_main = true,
                                .check_for_duplicate_dependencies = true,
                                .peer_dependencies = false,
                            },
                        );
                    } else {
                        try Lockfile.Package.parseMain(
                            &lockfile,
                            &new_root,
                            ctx.allocator,
                            ctx.log,
                            package_json_source,
                            Features{
                                .optional_dependencies = true,
                                .dev_dependencies = false,
                                .is_main = true,
                                .check_for_duplicate_dependencies = true,
                                .peer_dependencies = false,
                            },
                        );
                    }
                    var mapping = try manager.lockfile.allocator.alloc(PackageID, new_root.dependencies.len);
                    std.mem.set(PackageID, mapping, invalid_package_id);

                    manager.summary = try Package.Diff.generate(
                        ctx.allocator,
                        manager.lockfile,
                        &lockfile,
                        &root,
                        &new_root,
                        mapping,
                    );

                    const sum = manager.summary.add + manager.summary.remove + manager.summary.update;
                    had_any_diffs = had_any_diffs or sum > 0;

                    // If you changed packages, we will copy over the new package from the new lockfile
                    const new_dependencies = new_root.dependencies.get(lockfile.buffers.dependencies.items);

                    if (had_any_diffs) {
                        var builder_ = manager.lockfile.stringBuilder();
                        // ensure we use one pointer to reference it instead of creating new ones and potentially aliasing
                        var builder = &builder_;

                        for (new_dependencies) |new_dep, i| {
                            new_dep.count(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                        }

                        const off = @truncate(u32, manager.lockfile.buffers.dependencies.items.len);
                        const len = @truncate(u32, new_dependencies.len);
                        var packages = manager.lockfile.packages.slice();
                        var dep_lists = packages.items(.dependencies);
                        var resolution_lists = packages.items(.resolutions);
                        const old_dependencies_list = dep_lists[0];
                        const old_resolutions_list = resolution_lists[0];
                        dep_lists[0] = .{ .off = off, .len = len };
                        resolution_lists[0] = .{ .off = off, .len = len };
                        manager.root_dependency_list = dep_lists[0];
                        try builder.allocate();

                        try manager.lockfile.buffers.dependencies.ensureUnusedCapacity(manager.lockfile.allocator, len);
                        try manager.lockfile.buffers.resolutions.ensureUnusedCapacity(manager.lockfile.allocator, len);

                        var old_resolutions = old_resolutions_list.get(manager.lockfile.buffers.resolutions.items);

                        var dependencies = manager.lockfile.buffers.dependencies.items.ptr[off .. off + len];
                        var resolutions = manager.lockfile.buffers.resolutions.items.ptr[off .. off + len];

                        // It is too easy to accidentally undefined memory
                        std.mem.set(PackageID, resolutions, invalid_package_id);
                        std.mem.set(Dependency, dependencies, Dependency{});

                        manager.lockfile.buffers.dependencies.items = manager.lockfile.buffers.dependencies.items.ptr[0 .. off + len];
                        manager.lockfile.buffers.resolutions.items = manager.lockfile.buffers.resolutions.items.ptr[0 .. off + len];

                        for (new_dependencies) |new_dep, i| {
                            dependencies[i] = try new_dep.clone(lockfile.buffers.string_bytes.items, *Lockfile.StringBuilder, builder);
                            if (mapping[i] != invalid_package_id) {
                                resolutions[i] = old_resolutions[mapping[i]];
                            }
                        }

                        builder.clamp();

                        // Split this into two passes because the below may allocate memory or invalidate pointers
                        if (manager.summary.add > 0 or manager.summary.update > 0) {
                            var remaining = mapping;
                            var dependency_i: PackageID = off;
                            while (std.mem.indexOfScalar(PackageID, remaining, invalid_package_id)) |next_i_| {
                                remaining = remaining[next_i_ + 1 ..];

                                dependency_i += @intCast(PackageID, next_i_);
                                try manager.enqueueDependencyWithMain(
                                    dependency_i,
                                    manager.lockfile.buffers.dependencies.items[dependency_i],
                                    manager.lockfile.buffers.resolutions.items[dependency_i],
                                    true,
                                );
                            }
                        }
                    }
                }
            },
            else => {},
        }

        if (needs_new_lockfile) {
            root = Lockfile.Package{};
            try manager.lockfile.initEmpty(ctx.allocator);

            if (manager.options.enable.install_dev_dependencies) {
                try Lockfile.Package.parseMain(
                    manager.lockfile,
                    &root,
                    ctx.allocator,
                    ctx.log,
                    package_json_source,
                    Features{
                        .optional_dependencies = true,
                        .dev_dependencies = true,
                        .is_main = true,
                        .check_for_duplicate_dependencies = true,
                        .peer_dependencies = false,
                    },
                );
            } else {
                try Lockfile.Package.parseMain(
                    manager.lockfile,
                    &root,
                    ctx.allocator,
                    ctx.log,
                    package_json_source,
                    Features{
                        .optional_dependencies = true,
                        .dev_dependencies = false,
                        .is_main = true,
                        .check_for_duplicate_dependencies = true,
                        .peer_dependencies = false,
                    },
                );
            }

            root = try manager.lockfile.appendPackage(root);

            manager.root_dependency_list = root.dependencies;
            manager.enqueueDependencyList(
                root.dependencies,
                true,
            );
        }

        manager.flushDependencyQueue();

        // Anything that needs to be downloaded from an update needs to be scheduled here
        _ = manager.scheduleNetworkTasks();

        if (manager.pending_tasks > 0) {
            if (comptime log_level.showProgress()) {
                manager.downloads_node = try manager.progress.start(ProgressStrings.download(), 0);
                manager.setNodeName(manager.downloads_node.?, ProgressStrings.download_no_emoji_, ProgressStrings.download_emoji, true);
                manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks + manager.extracted_count);
                manager.downloads_node.?.setCompletedItems(manager.total_tasks - manager.pending_tasks);
                manager.downloads_node.?.activate();
                manager.progress.refresh();
            }

            while (manager.pending_tasks > 0) {
                try manager.runTasks(void, void{}, null, log_level);
            }

            if (comptime log_level.showProgress()) {
                manager.downloads_node.?.setEstimatedTotalItems(manager.downloads_node.?.unprotected_estimated_total_items);
                manager.downloads_node.?.setCompletedItems(manager.downloads_node.?.unprotected_estimated_total_items);
                manager.progress.refresh();
                manager.progress.root.end();
                manager.progress = .{};
                manager.downloads_node = null;
            }
        }

        if (Output.enable_ansi_colors) {
            try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
        } else {
            try manager.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
        }

        if (manager.log.errors > 0) {
            Output.flush();
            std.os.exit(1);
        }

        if (had_any_diffs or needs_new_lockfile or manager.package_json_updates.len > 0) {
            manager.lockfile = try manager.lockfile.clean(&manager.summary.deduped, manager.package_json_updates, &manager.options);
        }

        if (manager.options.do.save_lockfile) {
            var node: *Progress.Node = undefined;

            if (comptime log_level.showProgress()) {
                node = try manager.progress.start(ProgressStrings.save(), 0);
                node.activate();

                manager.progress.refresh();
            }
            manager.lockfile.saveToDisk(manager.options.save_lockfile_path);
            if (comptime log_level.showProgress()) {
                node.end();
                manager.progress.refresh();
                manager.progress.root.end();
                manager.progress = .{};
            }
        }

        var install_summary = PackageInstall.Summary{};
        if (manager.options.do.install_packages) {
            install_summary = try manager.installPackages(
                manager.lockfile,
                log_level,
            );
        }

        if (needs_new_lockfile) {
            manager.summary.add = @truncate(u32, manager.lockfile.packages.len);
        }

        if (manager.options.do.save_yarn_lock) {
            var node: *Progress.Node = undefined;
            if (comptime log_level.showProgress()) {
                node = try manager.progress.start("Saving yarn.lock", 0);
                manager.progress.refresh();
            }

            try manager.writeYarnLock();
            if (comptime log_level.showProgress()) {
                node.completeOne();
                manager.progress.refresh();
                manager.progress.root.end();
                manager.progress = .{};
            }
        }

        if (comptime log_level != .silent) {
            var printer = Lockfile.Printer{
                .lockfile = manager.lockfile,
                .options = manager.options,
                .successfully_installed = install_summary.successfully_installed,
            };
            if (Output.enable_ansi_colors) {
                try Lockfile.Printer.Tree.print(&printer, Output.WriterType, Output.writer(), true);
            } else {
                try Lockfile.Printer.Tree.print(&printer, Output.WriterType, Output.writer(), false);
            }

            if (install_summary.success > 0) {
                Output.pretty("\n <green>{d}<r> packages<r> installed ", .{install_summary.success});
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                Output.pretty("<r>\n", .{});

                if (manager.summary.update > 0) {
                    Output.pretty("  Updated: <cyan>{d}<r>\n", .{manager.summary.update});
                }

                if (manager.summary.remove > 0) {
                    Output.pretty("  Removed: <cyan>{d}<r>\n", .{manager.summary.remove});
                }
            } else if (manager.summary.remove > 0) {
                if (manager.to_remove.len > 0) {
                    for (manager.to_remove) |update| {
                        Output.prettyln(" <r><red>-<r> {s}", .{update.name});
                    }
                }

                Output.pretty("\n <r><b>{d}<r> packages removed ", .{manager.summary.remove});
                Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                Output.pretty("<r>\n", .{});
            } else if (install_summary.skipped > 0 and install_summary.fail == 0) {
                Output.pretty("\n", .{});

                const count = @truncate(PackageID, manager.lockfile.packages.len);
                if (count != install_summary.skipped) {
                    Output.pretty("Checked <green>{d} installs<r> across {d} packages <d>(no changes)<r> ", .{
                        install_summary.skipped,
                        count,
                    });
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    Output.pretty("<r>\n", .{});
                } else {
                    Output.pretty("<r> Done! Checked <green>{d} packages<r> <d>(no changes)<r> ", .{
                        install_summary.skipped,
                    });
                    Output.printStartEndStdout(ctx.start_time, std.time.nanoTimestamp());
                    Output.pretty("<r>\n", .{});
                }
            } else if (manager.summary.update > 0) {
                Output.prettyln("  Updated: <cyan>{d}<r>\n", .{manager.summary.update});
            }

            if (install_summary.fail > 0) {
                Output.prettyln("<r> Failed to install <red><b>{d}<r> packages", .{install_summary.fail});
            }
        }
        Output.flush();
    }
};

const Package = Lockfile.Package;
