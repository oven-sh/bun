const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const FeatureFlags = bun.FeatureFlags;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const Glob = bun.glob;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const JSAst = bun.JSAst;
const TextLockfile = @import("./bun.lock.zig");
const OOM = bun.OOM;
const WorkspaceFilter = PackageManager.WorkspaceFilter;

const JSLexer = bun.js_lexer;
const logger = bun.logger;

const js_parser = bun.js_parser;
const Expr = @import("../js_ast.zig").Expr;
const JSON = bun.JSON;
const JSPrinter = bun.js_printer;

const linker = @import("../linker.zig");
const migration = @import("./migration.zig");

const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const Path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const BunArguments = @import("../cli.zig").Arguments;

const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
const HeaderBuilder = bun.http.HeaderBuilder;
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const Lock = bun.Mutex;
const URL = @import("../url.zig").URL;
const AsyncHTTP = bun.http.AsyncHTTP;
const HTTPChannel = bun.http.HTTPChannel;

const Integrity = @import("./integrity.zig").Integrity;
const clap = bun.clap;
const ExtractTarball = @import("./extract_tarball.zig");
const Npm = @import("./npm.zig");
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const z_allocator = @import("../allocators/memory_allocator.zig").z_allocator;
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
const invalid_dependency_id = Install.invalid_dependency_id;
const Origin = Install.Origin;
const PackageID = Install.PackageID;
const PackageInstall = Install.PackageInstall;
const PackageNameHash = Install.PackageNameHash;
const PackageNameAndVersionHash = Install.PackageNameAndVersionHash;
const TruncatedPackageNameHash = Install.TruncatedPackageNameHash;
const Resolution = @import("./resolution.zig").Resolution;
const Crypto = @import("../sha.zig").Hashers;
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const StaticHashMap = @import("../StaticHashMap.zig").StaticHashMap;

const MetaHash = [std.crypto.hash.sha2.Sha512T256.digest_length]u8;
const zero_hash = std.mem.zeroes(MetaHash);
pub const NameHashMap = std.ArrayHashMapUnmanaged(PackageNameHash, String, ArrayIdentityContext.U64, false);
pub const TrustedDependenciesSet = std.ArrayHashMapUnmanaged(TruncatedPackageNameHash, void, ArrayIdentityContext, false);
pub const VersionHashMap = std.ArrayHashMapUnmanaged(PackageNameHash, Semver.Version, ArrayIdentityContext.U64, false);
pub const PatchedDependenciesMap = std.ArrayHashMapUnmanaged(PackageNameAndVersionHash, PatchedDep, ArrayIdentityContext.U64, false);
pub const PatchedDep = extern struct {
    /// e.g. "patches/is-even@1.0.0.patch"
    path: String,
    _padding: [7]u8 = [_]u8{0} ** 7,
    patchfile_hash_is_null: bool = true,
    /// the hash of the patch file contents
    __patchfile_hash: u64 = 0,

    pub fn setPatchfileHash(this: *PatchedDep, val: ?u64) void {
        this.patchfile_hash_is_null = val == null;
        this.__patchfile_hash = if (val) |v| v else 0;
    }
    pub fn patchfileHash(this: *const PatchedDep) ?u64 {
        return if (this.patchfile_hash_is_null) null else this.__patchfile_hash;
    }
};
const File = bun.sys.File;
const assertNoUninitializedPadding = @import("./padding_checker.zig").assertNoUninitializedPadding;

const IGNORED_PATHS: []const []const u8 = &.{
    "node_modules",
    ".git",
    "CMakeFiles",
};
fn ignoredWorkspacePaths(path: []const u8) bool {
    inline for (IGNORED_PATHS) |ignored| {
        if (bun.strings.eqlComptime(path, ignored)) return true;
    }
    return false;
}

const GlobWalker = Glob.GlobWalker(ignoredWorkspacePaths, Glob.walk.SyscallAccessor, false);

// Serialized data
/// The version of the lockfile format, intended to prevent data corruption for format changes.
format: FormatVersion = FormatVersion.current,

text_lockfile_version: TextLockfile.Version = .v0,

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

/// Optional because `trustedDependencies` in package.json might be an
/// empty list or it might not exist
trusted_dependencies: ?TrustedDependenciesSet = null,
patched_dependencies: PatchedDependenciesMap = .{},
overrides: OverrideMap = .{},

const Stream = std.io.FixedBufferStream([]u8);
pub const default_filename = "bun.lockb";

pub const Scripts = struct {
    const MAX_PARALLEL_PROCESSES = 10;
    pub const Entry = struct {
        script: string,
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
                allocator.free(entry.script);
            }
            list.deinit(allocator);
        }
    }
};

pub fn isEmpty(this: *const Lockfile) bool {
    return this.packages.len == 0 or (this.packages.len == 1 and this.packages.get(0).resolutions.len == 0);
}

pub const LoadResult = union(enum) {
    not_found: void,
    err: struct {
        step: Step,
        value: anyerror,
        lockfile_path: stringZ,
        format: LockfileFormat,
    },
    ok: struct {
        lockfile: *Lockfile,
        loaded_from_binary_lockfile: bool,
        was_migrated: bool = false,
        serializer_result: Serializer.SerializerLoadResult,
        format: LockfileFormat,
    },

    pub const LockfileFormat = enum {
        text,
        binary,

        pub fn filename(this: LockfileFormat) stringZ {
            return switch (this) {
                .text => "bun.lock",
                .binary => "bun.lockb",
            };
        }
    };

    pub fn loadedFromTextLockfile(this: LoadResult) bool {
        return switch (this) {
            .not_found => false,
            .err => |err| err.format == .text,
            .ok => |ok| ok.format == .text,
        };
    }

    pub const Step = enum { open_file, read_file, parse_file, migrating };
};

pub fn loadFromCwd(
    this: *Lockfile,
    manager: ?*PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    comptime attempt_loading_from_other_lockfile: bool,
) LoadResult {
    return loadFromDir(this, bun.FD.cwd(), manager, allocator, log, attempt_loading_from_other_lockfile);
}

pub fn loadFromDir(
    this: *Lockfile,
    dir: bun.FD,
    manager: ?*PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    comptime attempt_loading_from_other_lockfile: bool,
) LoadResult {
    if (comptime Environment.allow_assert) assert(FileSystem.instance_loaded);

    var lockfile_format: LoadResult.LockfileFormat = .text;
    const file = File.openat(dir, "bun.lock", bun.O.RDONLY, 0).unwrap() catch |text_open_err| file: {
        if (text_open_err != error.ENOENT) {
            return .{ .err = .{
                .step = .open_file,
                .value = text_open_err,
                .lockfile_path = "bun.lock",
                .format = .text,
            } };
        }

        lockfile_format = .binary;

        break :file File.openat(dir, "bun.lockb", bun.O.RDONLY, 0).unwrap() catch |binary_open_err| {
            if (binary_open_err != error.ENOENT) {
                return .{ .err = .{
                    .step = .open_file,
                    .value = binary_open_err,
                    .lockfile_path = "bun.lockb",
                    .format = .binary,
                } };
            }

            if (comptime attempt_loading_from_other_lockfile) {
                if (manager) |pm| {
                    const migrate_result = migration.detectAndLoadOtherLockfile(
                        this,
                        dir,
                        pm,
                        allocator,
                        log,
                    );

                    if (migrate_result == .ok) {
                        lockfile_format = .text;
                    }

                    return migrate_result;
                }
            }

            return .not_found;
        };
    };

    const buf = file.readToEnd(allocator).unwrap() catch |err| {
        return .{ .err = .{
            .step = .read_file,
            .value = err,
            .lockfile_path = if (lockfile_format == .text) "bun.lock" else "bun.lockb",
            .format = lockfile_format,
        } };
    };

    if (lockfile_format == .text) {
        const source = logger.Source.initPathString("bun.lock", buf);
        initializeStore();
        const json = JSON.parsePackageJSONUTF8(&source, log, allocator) catch |err| {
            return .{
                .err = .{
                    .step = .parse_file,
                    .value = err,
                    .lockfile_path = "bun.lock",
                    .format = lockfile_format,
                },
            };
        };

        TextLockfile.parseIntoBinaryLockfile(this, allocator, json, &source, log, manager) catch |err| {
            switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
                else => {
                    return .{
                        .err = .{
                            .step = .parse_file,
                            .value = err,
                            .lockfile_path = "bun.lock",
                            .format = lockfile_format,
                        },
                    };
                },
            }
        };

        bun.Analytics.Features.text_lockfile += 1;

        return .{
            .ok = .{
                .lockfile = this,
                .serializer_result = .{},
                .loaded_from_binary_lockfile = false,
                .format = lockfile_format,
            },
        };
    }

    const result = this.loadFromBytes(manager, buf, allocator, log);

    switch (result) {
        .ok => {
            if (bun.getenvZ("BUN_DEBUG_TEST_TEXT_LOCKFILE") != null and manager != null) {

                // Convert the loaded binary lockfile into a text lockfile in memory, then
                // parse it back into a binary lockfile.

                var writer_buf = MutableString.initEmpty(allocator);
                var buffered_writer = writer_buf.bufferedWriter();
                const writer = buffered_writer.writer();

                TextLockfile.Stringifier.saveFromBinary(allocator, result.ok.lockfile, writer) catch |err| {
                    Output.panic("failed to convert binary lockfile to text lockfile: {s}", .{@errorName(err)});
                };

                buffered_writer.flush() catch bun.outOfMemory();

                const text_lockfile_bytes = writer_buf.list.items;

                const source = logger.Source.initPathString("bun.lock", text_lockfile_bytes);
                initializeStore();
                const json = JSON.parsePackageJSONUTF8(&source, log, allocator) catch |err| {
                    Output.panic("failed to print valid json from binary lockfile: {s}", .{@errorName(err)});
                };

                TextLockfile.parseIntoBinaryLockfile(this, allocator, json, &source, log, manager) catch |err| {
                    Output.panic("failed to parse text lockfile converted from binary lockfile: {s}", .{@errorName(err)});
                };

                bun.Analytics.Features.text_lockfile += 1;
            }
        },
        else => {},
    }

    return result;
}

pub fn loadFromBytes(this: *Lockfile, pm: ?*PackageManager, buf: []u8, allocator: Allocator, log: *logger.Log) LoadResult {
    var stream = Stream{ .buffer = buf, .pos = 0 };

    this.format = FormatVersion.current;
    this.scripts = .{};
    this.trusted_dependencies = null;
    this.workspace_paths = .{};
    this.workspace_versions = .{};
    this.overrides = .{};
    this.patched_dependencies = .{};

    const load_result = Lockfile.Serializer.load(this, &stream, allocator, log, pm) catch |err| {
        return LoadResult{ .err = .{ .step = .parse_file, .value = err, .lockfile_path = "bun.lockb", .format = .binary } };
    };

    if (Environment.allow_assert) {
        this.verifyData() catch @panic("lockfile data is corrupt");
    }

    return LoadResult{
        .ok = .{
            .lockfile = this,
            .serializer_result = load_result,
            .loaded_from_binary_lockfile = true,
            .format = .binary,
        },
    };
}

pub const InstallResult = struct {
    lockfile: *Lockfile,
    summary: PackageInstall.Summary,
};

pub const Tree = struct {
    id: Id = invalid_id,

    // Should not be used for anything other than name
    // through `folderName()`. There is not guarantee a dependency
    // id chosen for a tree node is the same behavior or has the
    // same version literal for packages hoisted.
    dependency_id: DependencyID = invalid_dependency_id,

    parent: Id = invalid_id,
    dependencies: Lockfile.DependencyIDSlice = .{},

    pub const external_size = @sizeOf(Id) + @sizeOf(PackageID) + @sizeOf(Id) + @sizeOf(Lockfile.DependencyIDSlice);
    pub const External = [external_size]u8;
    pub const Slice = ExternalSlice(Tree);
    pub const List = std.ArrayListUnmanaged(Tree);
    pub const Id = u32;

    pub fn folderName(this: *const Tree, deps: []const Dependency, buf: string) string {
        const dep_id = this.dependency_id;
        if (dep_id == invalid_dependency_id) return "";
        return deps[dep_id].name.slice(buf);
    }

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
            .id = @bitCast(out[0..4].*),
            .dependency_id = @bitCast(out[4..8].*),
            .parent = @bitCast(out[8..12].*),
            .dependencies = .{
                .off = @bitCast(out[12..16].*),
                .len = @bitCast(out[16..20].*),
            },
        };
    }

    pub const root_dep_id: DependencyID = invalid_package_id - 1;
    pub const invalid_id: Id = std.math.maxInt(Id);

    pub const HoistDependencyResult = union(enum) {
        dependency_loop,
        hoisted,
        placement: struct {
            id: Id,
            bundled: bool = false,
        },
        // replace: struct {
        //     dest_id: Id,
        //     dep_id: DependencyID,
        // },
    };

    pub const SubtreeError = OOM || error{DependencyLoop};

    // max number of node_modules folders
    pub const max_depth = (bun.MAX_PATH_BYTES / "node_modules".len) + 1;

    pub const DepthBuf = [max_depth]Id;

    const IteratorPathStyle = enum {
        /// `relative_path` will have the form `node_modules/jquery/node_modules/zod`.
        /// Path separators are platform.
        node_modules,
        /// `relative_path` will have the form `jquery/zod`. Path separators are always
        /// posix separators.
        pkg_path,
    };

    pub fn Iterator(comptime path_style: IteratorPathStyle) type {
        return struct {
            tree_id: Id,
            path_buf: bun.PathBuffer = undefined,

            lockfile: *const Lockfile,

            depth_stack: DepthBuf = undefined,

            pub fn init(lockfile: *const Lockfile) @This() {
                var iter: @This() = .{
                    .tree_id = 0,
                    .lockfile = lockfile,
                };
                if (comptime path_style == .node_modules) {
                    @memcpy(iter.path_buf[0.."node_modules".len], "node_modules");
                }
                return iter;
            }

            pub fn reset(this: *@This()) void {
                this.tree_id = 0;
            }

            pub const Next = struct {
                relative_path: stringZ,
                dependencies: []const DependencyID,
                tree_id: Tree.Id,

                /// depth of the node_modules folder in the tree
                ///
                ///            0 (./node_modules)
                ///           / \
                ///          1   1
                ///         /
                ///        2
                depth: usize,
            };

            pub fn next(this: *@This(), completed_trees: if (path_style == .node_modules) ?*Bitset else void) ?Next {
                const trees = this.lockfile.buffers.trees.items;

                if (this.tree_id >= trees.len) return null;

                while (trees[this.tree_id].dependencies.len == 0) {
                    if (comptime path_style == .node_modules) {
                        if (completed_trees) |_completed_trees| {
                            _completed_trees.set(this.tree_id);
                        }
                    }
                    this.tree_id += 1;
                    if (this.tree_id >= trees.len) return null;
                }

                const current_tree_id = this.tree_id;
                const tree = trees[current_tree_id];
                const tree_dependencies = tree.dependencies.get(this.lockfile.buffers.hoisted_dependencies.items);

                const relative_path, const depth = relativePathAndDepth(
                    this.lockfile,
                    current_tree_id,
                    &this.path_buf,
                    &this.depth_stack,
                    path_style,
                );

                this.tree_id += 1;

                return .{
                    .relative_path = relative_path,
                    .dependencies = tree_dependencies,
                    .tree_id = current_tree_id,
                    .depth = depth,
                };
            }
        };
    }

    /// Returns relative path and the depth of the tree
    pub fn relativePathAndDepth(
        lockfile: *const Lockfile,
        tree_id: Id,
        path_buf: *bun.PathBuffer,
        depth_buf: *DepthBuf,
        comptime path_style: IteratorPathStyle,
    ) struct { stringZ, usize } {
        const trees = lockfile.buffers.trees.items;
        var depth: usize = 0;

        const tree = trees[tree_id];

        var parent_id = tree.id;
        var path_written: usize = switch (comptime path_style) {
            .node_modules => "node_modules".len,
            .pkg_path => 0,
        };

        depth_buf[0] = 0;

        if (tree.id > 0) {
            const dependencies = lockfile.buffers.dependencies.items;
            const buf = lockfile.buffers.string_bytes.items;
            var depth_buf_len: usize = 1;

            while (parent_id > 0 and parent_id < trees.len) {
                depth_buf[depth_buf_len] = parent_id;
                parent_id = trees[parent_id].parent;
                depth_buf_len += 1;
            }

            depth_buf_len -= 1;

            depth = depth_buf_len;
            while (depth_buf_len > 0) : (depth_buf_len -= 1) {
                if (comptime path_style == .pkg_path) {
                    if (depth_buf_len != depth) {
                        path_buf[path_written] = '/';
                        path_written += 1;
                    }
                } else {
                    path_buf[path_written] = std.fs.path.sep;
                    path_written += 1;
                }

                const id = depth_buf[depth_buf_len];
                const name = trees[id].folderName(dependencies, buf);
                @memcpy(path_buf[path_written..][0..name.len], name);
                path_written += name.len;

                if (comptime path_style == .node_modules) {
                    @memcpy(path_buf[path_written..][0.."/node_modules".len], std.fs.path.sep_str ++ "node_modules");
                    path_written += "/node_modules".len;
                }
            }
        }
        path_buf[path_written] = 0;
        const rel = path_buf[0..path_written :0];

        return .{ rel, depth };
    }

    const BuilderMethod = enum {
        /// Hoist, but include every dependency so it's resolvable if configuration
        /// changes. For saving to disk.
        resolvable,

        /// This will filter out disabled dependencies, resulting in more aggresive
        /// hoisting compared to `hoist()`. We skip dependencies based on 'os', 'cpu',
        /// 'libc' (TODO), and omitted dependency types (`--omit=dev/peer/optional`).
        /// Dependencies of a disabled package are not included in the output.
        filter,
    };

    pub fn Builder(comptime method: BuilderMethod) type {
        return struct {
            allocator: Allocator,
            name_hashes: []const PackageNameHash,
            list: bun.MultiArrayList(Entry) = .{},
            resolutions: []const PackageID,
            dependencies: []const Dependency,
            resolution_lists: []const Lockfile.DependencyIDSlice,
            queue: Lockfile.TreeFiller,
            log: *logger.Log,
            lockfile: *const Lockfile,
            manager: if (method == .filter) *const PackageManager else void,
            sort_buf: std.ArrayListUnmanaged(DependencyID) = .{},
            workspace_filters: if (method == .filter) []const WorkspaceFilter else void = if (method == .filter) &.{} else {},
            install_root_dependencies: if (method == .filter) bool else void,
            path_buf: []u8,

            pub fn maybeReportError(this: *@This(), comptime fmt: string, args: anytype) void {
                this.log.addErrorFmt(null, logger.Loc.Empty, this.allocator, fmt, args) catch {};
            }

            pub fn buf(this: *const @This()) []const u8 {
                return this.lockfile.buffers.string_bytes.items;
            }

            pub fn packageName(this: *@This(), id: PackageID) String.Formatter {
                return this.lockfile.packages.items(.name)[id].fmt(this.lockfile.buffers.string_bytes.items);
            }

            pub fn packageVersion(this: *@This(), id: PackageID) Resolution.Formatter {
                return this.lockfile.packages.items(.resolution)[id].fmt(this.lockfile.buffers.string_bytes.items, .auto);
            }

            pub const Entry = struct {
                tree: Tree,
                dependencies: Lockfile.DependencyIDList,
            };

            pub const CleanResult = struct {
                trees: std.ArrayListUnmanaged(Tree),
                dep_ids: std.ArrayListUnmanaged(DependencyID),
            };

            /// Flatten the multi-dimensional ArrayList of package IDs into a single easily serializable array
            pub fn clean(this: *@This()) OOM!CleanResult {
                var total: u32 = 0;

                const list_ptr = this.list.bytes;
                const slice = this.list.toOwnedSlice();
                var trees = slice.items(.tree);
                const dependencies = slice.items(.dependencies);

                for (trees) |*tree| {
                    total += tree.dependencies.len;
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
                this.sort_buf.deinit(this.allocator);

                // take over the `builder.list` pointer for only trees
                if (@intFromPtr(trees.ptr) != @intFromPtr(list_ptr)) {
                    var new: [*]Tree = @ptrCast(list_ptr);
                    bun.copy(Tree, new[0..trees.len], trees);
                    trees = new[0..trees.len];
                }

                return .{
                    .trees = std.ArrayListUnmanaged(Tree).fromOwnedSlice(trees),
                    .dep_ids = dependency_ids,
                };
            }
        };
    }

    pub fn processSubtree(
        this: *const Tree,
        dependency_id: DependencyID,
        hoist_root_id: Tree.Id,
        comptime method: BuilderMethod,
        builder: *Builder(method),
        log_level: if (method == .filter) PackageManager.Options.LogLevel else void,
    ) SubtreeError!void {
        const parent_pkg_id = switch (dependency_id) {
            root_dep_id => 0,
            else => |id| builder.resolutions[id],
        };
        const resolution_list = builder.resolution_lists[parent_pkg_id];

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

        const pkgs = builder.lockfile.packages.slice();
        const pkg_resolutions = pkgs.items(.resolution);
        const pkg_metas = pkgs.items(.meta);
        const pkg_names = pkgs.items(.name);

        builder.sort_buf.clearRetainingCapacity();
        try builder.sort_buf.ensureUnusedCapacity(builder.allocator, resolution_list.len);

        for (resolution_list.begin()..resolution_list.end()) |dep_id| {
            builder.sort_buf.appendAssumeCapacity(@intCast(dep_id));
        }

        const DepSorter = struct {
            lockfile: *const Lockfile,

            pub fn isLessThan(sorter: @This(), l: DependencyID, r: DependencyID) bool {
                const deps_buf = sorter.lockfile.buffers.dependencies.items;
                const string_buf = sorter.lockfile.buffers.string_bytes.items;

                const l_dep = deps_buf[l];
                const r_dep = deps_buf[r];

                return switch (l_dep.behavior.cmp(r_dep.behavior)) {
                    .lt => true,
                    .gt => false,
                    .eq => strings.order(l_dep.name.slice(string_buf), r_dep.name.slice(string_buf)) == .lt,
                };
            }
        };

        std.sort.pdq(
            DependencyID,
            builder.sort_buf.items,
            DepSorter{
                .lockfile = builder.lockfile,
            },
            DepSorter.isLessThan,
        );

        for (builder.sort_buf.items) |dep_id| {
            const pkg_id = builder.resolutions[dep_id];
            // Skip unresolved packages, e.g. "peerDependencies"
            if (pkg_id >= max_package_id) continue;

            // filter out disabled dependencies
            if (comptime method == .filter) {
                if (builder.lockfile.isResolvedDependencyDisabled(
                    dep_id,
                    switch (pkg_resolutions[parent_pkg_id].tag) {
                        .root, .workspace, .folder => builder.manager.options.local_package_features,
                        else => builder.manager.options.remote_package_features,
                    },
                    &pkg_metas[pkg_id],
                )) {
                    if (log_level.isVerbose()) {
                        const meta = &pkg_metas[pkg_id];
                        const name = builder.lockfile.str(&pkg_names[pkg_id]);
                        if (!meta.os.isMatch() and !meta.arch.isMatch()) {
                            Output.prettyErrorln("<d>Skip installing '<b>{s}<r><d>' cpu & os mismatch", .{name});
                        } else if (!meta.os.isMatch()) {
                            Output.prettyErrorln("<d>Skip installing '<b>{s}<r><d>' os mismatch", .{name});
                        } else if (!meta.arch.isMatch()) {
                            Output.prettyErrorln("<d>Skip installing '<b>{s}<r><d>' cpu mismatch", .{name});
                        }
                    }

                    continue;
                }

                if (builder.manager.subcommand == .install) dont_skip: {
                    // only do this when parent is root. workspaces are always dependencies of the root
                    // package, and the root package is always called with `processSubtree`
                    if (parent_pkg_id == 0 and builder.workspace_filters.len > 0) {
                        if (!builder.dependencies[dep_id].behavior.isWorkspaceOnly()) {
                            if (builder.install_root_dependencies) {
                                break :dont_skip;
                            }

                            continue;
                        }

                        var match = false;

                        for (builder.workspace_filters) |workspace_filter| {
                            const res_id = builder.resolutions[dep_id];

                            const pattern, const path_or_name = switch (workspace_filter) {
                                .name => |pattern| .{ pattern, pkg_names[res_id].slice(builder.buf()) },

                                .path => |pattern| path: {
                                    const res = &pkg_resolutions[res_id];
                                    if (res.tag != .workspace) {
                                        break :dont_skip;
                                    }
                                    const res_path = res.value.workspace.slice(builder.buf());

                                    // occupy `builder.path_buf`
                                    var abs_res_path = strings.withoutTrailingSlash(bun.path.joinAbsStringBuf(
                                        FileSystem.instance.top_level_dir,
                                        builder.path_buf,
                                        &.{res_path},
                                        .auto,
                                    ));

                                    if (comptime Environment.isWindows) {
                                        abs_res_path = abs_res_path[Path.windowsVolumeNameLen(abs_res_path)[0]..];
                                        Path.dangerouslyConvertPathToPosixInPlace(u8, builder.path_buf[0..abs_res_path.len]);
                                    }

                                    break :path .{
                                        pattern,
                                        abs_res_path,
                                    };
                                },

                                .all => {
                                    match = true;
                                    continue;
                                },
                            };

                            switch (bun.glob.walk.matchImpl(pattern, path_or_name)) {
                                .match, .negate_match => match = true,

                                .negate_no_match => {
                                    // always skip if a pattern specifically says "!<name>"
                                    match = false;
                                    break;
                                },

                                .no_match => {
                                    // keep current
                                },
                            }
                        }

                        if (!match) {
                            continue;
                        }
                    }
                }
            }

            const hoisted: HoistDependencyResult = hoisted: {
                const dependency = builder.dependencies[dep_id];

                // don't hoist if it's a folder dependency or a bundled dependency.
                if (dependency.behavior.isBundled()) {
                    break :hoisted .{ .placement = .{ .id = next.id, .bundled = true } };
                }

                if (pkg_resolutions[pkg_id].tag == .folder) {
                    break :hoisted .{ .placement = .{ .id = next.id } };
                }

                break :hoisted try next.hoistDependency(
                    true,
                    hoist_root_id,
                    pkg_id,
                    &dependency,
                    dependency_lists,
                    trees,
                    method,
                    builder,
                );
            };

            switch (hoisted) {
                .dependency_loop, .hoisted => continue,
                .placement => |dest| {
                    dependency_lists[dest.id].append(builder.allocator, dep_id) catch bun.outOfMemory();
                    trees[dest.id].dependencies.len += 1;
                    if (builder.resolution_lists[pkg_id].len > 0) {
                        try builder.queue.writeItem(.{
                            .tree_id = dest.id,
                            .dependency_id = dep_id,

                            // if it's bundled, start a new hoist root
                            .hoist_root_id = if (dest.bundled) dest.id else hoist_root_id,
                        });
                    }
                },
            }
        }

        if (next.dependencies.len == 0) {
            if (comptime Environment.allow_assert) assert(builder.list.len == next.id + 1);
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
        hoist_root_id: Id,
        package_id: PackageID,
        dependency: *const Dependency,
        dependency_lists: []Lockfile.DependencyIDList,
        trees: []Tree,
        comptime method: BuilderMethod,
        builder: *Builder(method),
    ) !HoistDependencyResult {
        const this_dependencies = this.dependencies.get(dependency_lists[this.id].items);
        for (0..this_dependencies.len) |i| {
            const dep_id = this_dependencies[i];
            const dep = builder.dependencies[dep_id];
            if (dep.name_hash != dependency.name_hash) continue;

            if (builder.resolutions[dep_id] == package_id) {
                // this dependency is the same package as the other, hoist
                return .hoisted; // 1
            }

            if (comptime as_defined) {
                if (dep.behavior.isDev() != dependency.behavior.isDev()) {
                    // will only happen in workspaces and root package because
                    // dev dependencies won't be included in other types of
                    // dependencies
                    return .hoisted; // 1
                }
            }

            // now we either keep the dependency at this place in the tree,
            // or hoist if peer version allows it

            if (dependency.behavior.isPeer()) {
                if (dependency.version.tag == .npm) {
                    const resolution: Resolution = builder.lockfile.packages.items(.resolution)[builder.resolutions[dep_id]];
                    const version = dependency.version.value.npm.version;
                    if (resolution.tag == .npm and version.satisfies(resolution.value.npm.version, builder.buf(), builder.buf())) {
                        return .hoisted; // 1
                    }
                }

                // Root dependencies are manually chosen by the user. Allow them
                // to hoist other peers even if they don't satisfy the version
                if (builder.lockfile.isWorkspaceRootDependency(dep_id)) {
                    // TODO: warning about peer dependency version mismatch
                    return .hoisted; // 1
                }
            }

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

            return .dependency_loop; // 3
        }

        // this dependency was not found in this tree, try hoisting or placing in the next parent
        if (this.parent != invalid_id and this.id != hoist_root_id) {
            const id = trees[this.parent].hoistDependency(
                false,
                hoist_root_id,
                package_id,
                dependency,
                dependency_lists,
                trees,
                method,
                builder,
            ) catch unreachable;
            if (!as_defined or id != .dependency_loop) return id; // 1 or 2
        }

        // place the dependency in the current tree
        return .{ .placement = .{ .id = this.id } }; // 2
    }
};

pub fn isResolvedDependencyDisabled(
    lockfile: *const Lockfile,
    dep_id: DependencyID,
    features: Features,
    meta: *const Package.Meta,
) bool {
    if (meta.isDisabled()) return true;

    const dep = lockfile.buffers.dependencies.items[dep_id];

    return dep.behavior.isBundled() or !dep.behavior.isEnabled(features);
}

/// This conditionally clones the lockfile with root packages marked as non-resolved
/// that do not satisfy `Features`. The package may still end up installed even
/// if it was e.g. in "devDependencies" and its a production install. In that case,
/// it would be installed because another dependency or transient dependency needed it.
///
/// Warning: This potentially modifies the existing lockfile in-place. That is
/// safe to do because at this stage, the lockfile has already been saved to disk.
/// Our in-memory representation is all that's left.
pub fn maybeCloneFilteringRootPackages(
    old: *Lockfile,
    manager: *PackageManager,
    features: Features,
    exact_versions: bool,
    comptime log_level: PackageManager.Options.LogLevel,
) !*Lockfile {
    const old_packages = old.packages.slice();
    const old_dependencies_lists = old_packages.items(.dependencies);
    const old_resolutions_lists = old_packages.items(.resolutions);
    const old_resolutions = old_packages.items(.resolution);
    var any_changes = false;
    const end: PackageID = @truncate(old.packages.len);

    // set all disabled dependencies of workspaces to `invalid_package_id`
    for (0..end) |package_id| {
        if (package_id != 0 and old_resolutions[package_id].tag != .workspace) continue;

        const old_workspace_dependencies_list = old_dependencies_lists[package_id];
        var old_workspace_resolutions_list = old_resolutions_lists[package_id];

        const old_workspace_dependencies = old_workspace_dependencies_list.get(old.buffers.dependencies.items);
        const old_workspace_resolutions = old_workspace_resolutions_list.mut(old.buffers.resolutions.items);

        for (old_workspace_dependencies, old_workspace_resolutions) |dependency, *resolution| {
            if (!dependency.behavior.isEnabled(features) and resolution.* < end) {
                resolution.* = invalid_package_id;
                any_changes = true;
            }
        }
    }

    if (!any_changes) return old;

    return try old.clean(manager, &.{}, exact_versions, log_level);
}

fn preprocessUpdateRequests(old: *Lockfile, manager: *PackageManager, updates: []PackageManager.UpdateRequest, exact_versions: bool) !void {
    const workspace_package_id = manager.root_package_id.get(old, manager.workspace_name_hash);
    const root_deps_list: Lockfile.DependencySlice = old.packages.items(.dependencies)[workspace_package_id];

    if (@as(usize, root_deps_list.off) < old.buffers.dependencies.items.len) {
        var string_builder = old.stringBuilder();

        {
            const root_deps: []const Dependency = root_deps_list.get(old.buffers.dependencies.items);
            const old_resolutions_list = old.packages.items(.resolutions)[workspace_package_id];
            const old_resolutions: []const PackageID = old_resolutions_list.get(old.buffers.resolutions.items);
            const resolutions_of_yore: []const Resolution = old.packages.items(.resolution);

            for (updates) |update| {
                if (update.package_id == invalid_package_id) {
                    for (root_deps, old_resolutions) |dep, old_resolution| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            if (res.tag != .npm or update.version.tag != .dist_tag) continue;

                            // TODO(dylan-conway): this will need to handle updating dependencies (exact, ^, or ~) and aliases

                            const len = switch (exact_versions) {
                                else => |exact| std.fmt.count("{s}{}", .{
                                    if (exact) "" else "^",
                                    res.value.npm.version.fmt(old.buffers.string_bytes.items),
                                }),
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
            const old_resolutions_list = old_resolutions_list_lists[workspace_package_id];
            const old_resolutions: []const PackageID = old_resolutions_list.get(old.buffers.resolutions.items);
            const resolutions_of_yore: []const Resolution = old.packages.items(.resolution);

            for (updates) |*update| {
                if (update.package_id == invalid_package_id) {
                    for (root_deps, old_resolutions) |*dep, old_resolution| {
                        if (dep.name_hash == String.Builder.stringHash(update.name)) {
                            if (old_resolution > old.packages.len) continue;
                            const res = resolutions_of_yore[old_resolution];
                            if (res.tag != .npm or update.version.tag != .dist_tag) continue;

                            // TODO(dylan-conway): this will need to handle updating dependencies (exact, ^, or ~) and aliases

                            const buf = switch (exact_versions) {
                                else => |exact| std.fmt.bufPrint(&temp_buf, "{s}{}", .{
                                    if (exact) "" else "^",
                                    res.value.npm.version.fmt(old.buffers.string_bytes.items),
                                }) catch break,
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
                                manager,
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
    manager: *PackageManager,
    updates: []PackageManager.UpdateRequest,
    exact_versions: bool,
    comptime log_level: PackageManager.Options.LogLevel,
) !*Lockfile {
    // This is wasteful, but we rarely log anything so it's fine.
    var log = logger.Log.init(bun.default_allocator);
    defer {
        for (log.msgs.items) |*item| {
            item.deinit(bun.default_allocator);
        }
        log.deinit();
    }

    return old.cleanWithLogger(manager, updates, &log, exact_versions, log_level);
}

/// Is this a direct dependency of the workspace root package.json?
pub fn isWorkspaceRootDependency(this: *const Lockfile, id: DependencyID) bool {
    return this.packages.items(.dependencies)[0].contains(id);
}

/// Is this a direct dependency of the workspace the install is taking place in?
pub fn isRootDependency(this: *const Lockfile, manager: *PackageManager, id: DependencyID) bool {
    return this.packages.items(.dependencies)[manager.root_package_id.get(this, manager.workspace_name_hash)].contains(id);
}

/// Is this a direct dependency of any workspace (including workspace root)?
/// TODO make this faster by caching the workspace package ids
pub fn isWorkspaceDependency(this: *const Lockfile, id: DependencyID) bool {
    return getWorkspacePkgIfWorkspaceDep(this, id) != invalid_package_id;
}

pub fn getWorkspacePkgIfWorkspaceDep(this: *const Lockfile, id: DependencyID) PackageID {
    const packages = this.packages.slice();
    const resolutions = packages.items(.resolution);
    const dependencies_lists = packages.items(.dependencies);
    for (resolutions, dependencies_lists, 0..) |resolution, dependencies, pkg_id| {
        if (resolution.tag != .workspace and resolution.tag != .root) continue;
        if (dependencies.contains(id)) return @intCast(pkg_id);
    }

    return invalid_package_id;
}

/// Does this tree id belong to a workspace (including workspace root)?
/// TODO(dylan-conway) fix!
pub fn isWorkspaceTreeId(this: *const Lockfile, id: Tree.Id) bool {
    return id == 0 or this.buffers.dependencies.items[this.buffers.trees.items[id].dependency_id].behavior.isWorkspaceOnly();
}

/// Returns the package id of the workspace the install is taking place in.
pub fn getWorkspacePackageID(this: *const Lockfile, workspace_name_hash: ?PackageNameHash) PackageID {
    return if (workspace_name_hash) |workspace_name_hash_| brk: {
        const packages = this.packages.slice();
        const name_hashes = packages.items(.name_hash);
        const resolutions = packages.items(.resolution);
        for (resolutions, name_hashes, 0..) |res, name_hash, i| {
            if (res.tag == .workspace and name_hash == workspace_name_hash_) {
                break :brk @intCast(i);
            }
        }

        // should not hit this, default to root just in case
        break :brk 0;
    } else 0;
}

pub fn cleanWithLogger(
    old: *Lockfile,
    manager: *PackageManager,
    updates: []PackageManager.UpdateRequest,
    log: *logger.Log,
    exact_versions: bool,
    comptime log_level: PackageManager.Options.LogLevel,
) !*Lockfile {
    var timer: if (log_level.isVerbose()) std.time.Timer else void = if (comptime log_level.isVerbose()) try std.time.Timer.start() else {};

    const old_trusted_dependencies = old.trusted_dependencies;
    const old_scripts = old.scripts;
    // We will only shrink the number of packages here.
    // never grow

    // preinstall_state is used during installPackages. the indexes(package ids) need
    // to be remapped. Also ensure `preinstall_state` has enough capacity to contain
    // all packages. It's possible it doesn't because non-npm packages do not use
    // preinstall state before linking stage.
    manager.ensurePreinstallStateListCapacity(old.packages.len);
    var preinstall_state = manager.preinstall_state;
    var old_preinstall_state = preinstall_state.clone(old.allocator) catch bun.outOfMemory();
    defer old_preinstall_state.deinit(old.allocator);
    @memset(preinstall_state.items, .unknown);

    if (updates.len > 0) {
        try old.preprocessUpdateRequests(manager, updates, exact_versions);
    }

    var new: *Lockfile = try old.allocator.create(Lockfile);
    new.initEmpty(
        old.allocator,
    );
    try new.string_pool.ensureTotalCapacity(old.string_pool.capacity());
    try new.package_index.ensureTotalCapacity(old.package_index.capacity());
    try new.packages.ensureTotalCapacity(old.allocator, old.packages.len);
    try new.buffers.preallocate(old.buffers, old.allocator);
    try new.patched_dependencies.ensureTotalCapacity(old.allocator, old.patched_dependencies.entries.len);

    old.scratch.dependency_list_queue.head = 0;

    {
        var builder = new.stringBuilder();
        old.overrides.count(old, &builder);
        try builder.allocate();
        new.overrides = try old.overrides.clone(manager, old, new, &builder);
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
        .old_preinstall_state = old_preinstall_state,
        .manager = manager,
    };

    // try clone_queue.ensureUnusedCapacity(root.dependencies.len);
    _ = try root.clone(manager, old, new, package_id_mapping, &cloner);

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
            dest.* = src.append(old.buffers.string_bytes.items, @TypeOf(&workspace_paths_builder), &workspace_paths_builder);
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

    new.trusted_dependencies = old_trusted_dependencies;
    new.scripts = old_scripts;
    new.meta_hash = old.meta_hash;

    {
        var builder = new.stringBuilder();
        for (old.patched_dependencies.values()) |patched_dep| builder.count(patched_dep.path.slice(old.buffers.string_bytes.items));
        try builder.allocate();
        for (old.patched_dependencies.keys(), old.patched_dependencies.values()) |k, v| {
            bun.assert(!v.patchfile_hash_is_null);
            var patchdep = v;
            patchdep.path = builder.append(String, patchdep.path.slice(old.buffers.string_bytes.items));
            try new.patched_dependencies.put(new.allocator, k, patchdep);
        }
    }

    // Don't allow invalid memory to happen
    if (updates.len > 0) {
        const string_buf = new.buffers.string_bytes.items;
        const slice = new.packages.slice();

        // updates might be applied to the root package.json or one
        // of the workspace package.json files.
        const workspace_package_id = manager.root_package_id.get(new, manager.workspace_name_hash);

        const dep_list = slice.items(.dependencies)[workspace_package_id];
        const res_list = slice.items(.resolutions)[workspace_package_id];
        const workspace_deps: []const Dependency = dep_list.get(new.buffers.dependencies.items);
        const resolved_ids: []const PackageID = res_list.get(new.buffers.resolutions.items);

        request_updated: for (updates) |*update| {
            if (update.package_id == invalid_package_id) {
                for (resolved_ids, workspace_deps) |package_id, dep| {
                    if (update.matches(dep, string_buf)) {
                        if (package_id > new.packages.len) continue;
                        update.version_buf = string_buf;
                        update.version = dep.version;
                        update.package_id = package_id;

                        continue :request_updated;
                    }
                }
            }
        }
    }

    if (comptime log_level.isVerbose()) {
        Output.prettyErrorln("Clean lockfile: {d} packages -> {d} packages in {}\n", .{
            old.packages.len,
            new.packages.len,
            bun.fmt.fmtDurationOneDecimal(timer.read()),
        });
    }

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

    /// If valid, dependencies will not hoist
    /// beyond this tree if they're in a subtree
    hoist_root_id: Tree.Id,
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
    old_preinstall_state: std.ArrayListUnmanaged(Install.PreinstallState),
    manager: *PackageManager,

    pub fn flush(this: *Cloner) anyerror!void {
        const max_package_id = this.old.packages.len;
        while (this.clone_queue.popOrNull()) |to_clone| {
            const mapping = this.mapping[to_clone.old_resolution];
            if (mapping < max_package_id) {
                this.lockfile.buffers.resolutions.items[to_clone.resolve_id] = mapping;
                continue;
            }

            const old_package = this.old.packages.get(to_clone.old_resolution);

            this.lockfile.buffers.resolutions.items[to_clone.resolve_id] = try old_package.clone(
                this.manager,
                this.old,
                this.lockfile,
                this.mapping,
                this,
            );
        }

        // cloning finished, items in lockfile buffer might have a different order, meaning
        // package ids and dependency ids have changed
        this.manager.clearCachedItemsDependingOnLockfileBuffer();

        if (this.lockfile.packages.len != 0) {
            try this.lockfile.resolve(this.log);
        }

        // capacity is used for calculating byte size
        // so we need to make sure it's exact
        if (this.lockfile.packages.capacity != this.lockfile.packages.len and this.lockfile.packages.len > 0)
            this.lockfile.packages.shrinkAndFree(this.lockfile.allocator, this.lockfile.packages.len);
    }
};

pub fn resolve(
    lockfile: *Lockfile,
    log: *logger.Log,
) Tree.SubtreeError!void {
    return lockfile.hoist(log, .resolvable, {}, {}, {});
}

pub fn filter(
    lockfile: *Lockfile,
    log: *logger.Log,
    manager: *PackageManager,
    install_root_dependencies: bool,
    workspace_filters: []const WorkspaceFilter,
) Tree.SubtreeError!void {
    return lockfile.hoist(log, .filter, manager, install_root_dependencies, workspace_filters);
}

/// Sets `buffers.trees` and `buffers.hoisted_dependencies`
pub fn hoist(
    lockfile: *Lockfile,
    log: *logger.Log,
    comptime method: Tree.BuilderMethod,
    manager: if (method == .filter) *PackageManager else void,
    install_root_dependencies: if (method == .filter) bool else void,
    workspace_filters: if (method == .filter) []const WorkspaceFilter else void,
) Tree.SubtreeError!void {
    const allocator = lockfile.allocator;
    var slice = lockfile.packages.slice();

    var path_buf: bun.PathBuffer = undefined;

    var builder = Tree.Builder(method){
        .name_hashes = slice.items(.name_hash),
        .queue = TreeFiller.init(allocator),
        .resolution_lists = slice.items(.resolutions),
        .resolutions = lockfile.buffers.resolutions.items,
        .allocator = allocator,
        .dependencies = lockfile.buffers.dependencies.items,
        .log = log,
        .lockfile = lockfile,
        .manager = manager,
        .path_buf = &path_buf,
        .install_root_dependencies = install_root_dependencies,
        .workspace_filters = workspace_filters,
    };

    try (Tree{}).processSubtree(
        Tree.root_dep_id,
        Tree.invalid_id,
        method,
        &builder,
        if (method == .filter) manager.options.log_level else {},
    );

    // This goes breadth-first
    while (builder.queue.readItem()) |item| {
        try builder.list.items(.tree)[item.tree_id].processSubtree(
            item.dependency_id,
            item.hoist_root_id,
            method,
            &builder,
            if (method == .filter) manager.options.log_level else {},
        );
    }

    const cleaned = try builder.clean();
    lockfile.buffers.trees = cleaned.trees;
    lockfile.buffers.hoisted_dependencies = cleaned.dep_ids;
}

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

        var lockfile_path_buf1: bun.PathBuffer = undefined;
        var lockfile_path_buf2: bun.PathBuffer = undefined;

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
            _ = bun.sys.chdir("", std.fs.path.dirname(lockfile_path) orelse std.fs.path.sep_str);

        _ = try FileSystem.init(null);

        var lockfile = try allocator.create(Lockfile);

        const load_from_disk = lockfile.loadFromCwd(null, allocator, log, false);
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
                    try log.print(Output.errorWriter());
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
            loader.quiet = true;
            break :brk loader;
        };

        env_loader.loadProcess();
        try env_loader.load(entries_option.entries, &[_][]u8{}, .production, false);
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
        fn printInstalledWorkspaceSection(
            this: *const Printer,
            manager: *PackageManager,
            comptime Writer: type,
            writer: Writer,
            comptime enable_ansi_colors: bool,
            workspace_package_id: PackageID,
            installed: *const Bitset,
            comptime print_section_header: enum(u1) { print_section_header, dont_print_section_header },
            printed_new_install: *bool,
            id_map: ?[]DependencyID,
        ) !void {
            const lockfile = this.lockfile;
            const string_buf = lockfile.buffers.string_bytes.items;
            const packages_slice = lockfile.packages.slice();
            const resolutions = lockfile.buffers.resolutions.items;
            const dependencies = lockfile.buffers.dependencies.items;
            const workspace_res = packages_slice.items(.resolution)[workspace_package_id];
            const names = packages_slice.items(.name);
            const pkg_metas = packages_slice.items(.meta);
            bun.assert(workspace_res.tag == .workspace or workspace_res.tag == .root);
            const resolutions_list = packages_slice.items(.resolutions);
            var printed_section_header = false;
            var printed_update = false;

            // find the updated packages
            for (resolutions_list[workspace_package_id].begin()..resolutions_list[workspace_package_id].end()) |dep_id| {
                switch (shouldPrintPackageInstall(this, manager, @intCast(dep_id), installed, id_map, pkg_metas)) {
                    .yes, .no, .@"return" => {},
                    .update => |update_info| {
                        printed_new_install.* = true;
                        printed_update = true;

                        if (comptime print_section_header == .print_section_header) {
                            if (!printed_section_header) {
                                printed_section_header = true;
                                const workspace_name = names[workspace_package_id].slice(string_buf);
                                try writer.print(comptime Output.prettyFmt("<r>\n<cyan>{s}<r><d>:<r>\n", enable_ansi_colors), .{
                                    workspace_name,
                                });
                            }
                        }

                        try printUpdatedPackage(this, update_info, enable_ansi_colors, Writer, writer);
                    },
                }
            }

            for (resolutions_list[workspace_package_id].begin()..resolutions_list[workspace_package_id].end()) |dep_id| {
                switch (shouldPrintPackageInstall(this, manager, @intCast(dep_id), installed, id_map, pkg_metas)) {
                    .@"return" => return,
                    .yes => {},
                    .no, .update => continue,
                }

                const dep = dependencies[dep_id];
                const package_id = resolutions[dep_id];

                printed_new_install.* = true;

                if (comptime print_section_header == .print_section_header) {
                    if (!printed_section_header) {
                        printed_section_header = true;
                        const workspace_name = names[workspace_package_id].slice(string_buf);
                        try writer.print(comptime Output.prettyFmt("<r>\n<cyan>{s}<r><d>:<r>\n", enable_ansi_colors), .{
                            workspace_name,
                        });
                    }
                }

                if (printed_update) {
                    printed_update = false;
                    try writer.writeAll("\n");
                }
                try printInstalledPackage(this, manager, &dep, package_id, enable_ansi_colors, Writer, writer);
            }
        }

        const PackageUpdatePrintInfo = struct {
            version: Semver.Version,
            version_buf: string,
            resolution: Resolution,
            dependency_id: DependencyID,
        };

        const ShouldPrintPackageInstallResult = union(enum) {
            yes,
            no,
            @"return",
            update: PackageUpdatePrintInfo,
        };

        fn shouldPrintPackageInstall(
            this: *const Printer,
            manager: *PackageManager,
            dep_id: DependencyID,
            installed: *const Bitset,
            id_map: ?[]DependencyID,
            pkg_metas: []const Package.Meta,
        ) ShouldPrintPackageInstallResult {
            const dependencies = this.lockfile.buffers.dependencies.items;
            const resolutions = this.lockfile.buffers.resolutions.items;
            const dependency = dependencies[dep_id];
            const package_id = resolutions[dep_id];

            if (dependency.behavior.isWorkspaceOnly() or package_id >= this.lockfile.packages.len) return .no;

            if (id_map) |map| {
                for (this.updates, map) |update, *update_dependency_id| {
                    if (update.failed) return .@"return";
                    if (update.matches(dependency, this.lockfile.buffers.string_bytes.items)) {
                        if (update_dependency_id.* == invalid_package_id) {
                            update_dependency_id.* = dep_id;
                        }

                        return .no;
                    }
                }
            }

            if (!installed.isSet(package_id)) return .no;

            // It's possible this package was installed but the dependency is disabled.
            // Have "zod@1.0.0" in dependencies and `zod2@npm:zod@1.0.0` in devDependencies
            // and install with --omit=dev.
            if (this.lockfile.isResolvedDependencyDisabled(
                dep_id,
                this.options.local_package_features,
                &pkg_metas[package_id],
            )) {
                return .no;
            }

            const resolution = this.lockfile.packages.items(.resolution)[package_id];
            if (resolution.tag == .npm) {
                const name = dependency.name.slice(this.lockfile.buffers.string_bytes.items);
                if (manager.updating_packages.get(name)) |entry| {
                    if (entry.original_version) |original_version| {
                        if (!original_version.eql(resolution.value.npm.version)) {
                            return .{
                                .update = .{
                                    .version = original_version,
                                    .version_buf = entry.original_version_string_buf,
                                    .resolution = resolution,
                                    .dependency_id = dep_id,
                                },
                            };
                        }
                    }
                }
            }

            return .yes;
        }

        fn printUpdatedPackage(
            this: *const Printer,
            update_info: PackageUpdatePrintInfo,
            comptime enable_ansi_colors: bool,
            comptime Writer: type,
            writer: Writer,
        ) !void {
            const string_buf = this.lockfile.buffers.string_bytes.items;
            const dependency = this.lockfile.buffers.dependencies.items[update_info.dependency_id];

            const fmt = comptime brk: {
                if (enable_ansi_colors) {
                    break :brk Output.prettyFmt("<r><cyan>↑<r> <b>{s}<r><d> <b>{} →<r> <b><cyan>{}<r>\n", enable_ansi_colors);
                }
                break :brk Output.prettyFmt("<r>^ <b>{s}<r><d> <b>{} -\\><r> <b>{}<r>\n", enable_ansi_colors);
            };

            try writer.print(
                fmt,
                .{
                    dependency.name.slice(string_buf),
                    update_info.version.fmt(update_info.version_buf),
                    update_info.resolution.value.npm.version.fmt(string_buf),
                },
            );
        }

        fn printInstalledPackage(
            this: *const Printer,
            manager: *PackageManager,
            dependency: *const Dependency,
            package_id: PackageID,
            comptime enable_ansi_colors: bool,
            comptime Writer: type,
            writer: Writer,
        ) !void {
            const string_buf = this.lockfile.buffers.string_bytes.items;
            const packages_slice = this.lockfile.packages.slice();
            const resolution: Resolution = packages_slice.items(.resolution)[package_id];
            const name = dependency.name.slice(string_buf);

            const package_name = packages_slice.items(.name)[package_id].slice(string_buf);
            if (manager.formatLaterVersionInCache(package_name, dependency.name_hash, resolution)) |later_version_fmt| {
                const fmt = comptime brk: {
                    if (enable_ansi_colors) {
                        break :brk Output.prettyFmt("<r><green>+<r> <b>{s}<r><d>@{}<r> <d>(<blue>v{} available<r><d>)<r>\n", enable_ansi_colors);
                    } else {
                        break :brk Output.prettyFmt("<r>+ {s}<r><d>@{}<r> <d>(v{} available)<r>\n", enable_ansi_colors);
                    }
                };
                try writer.print(
                    fmt,
                    .{
                        name,
                        resolution.fmt(string_buf, .posix),
                        later_version_fmt,
                    },
                );

                return;
            }

            const fmt = comptime brk: {
                if (enable_ansi_colors) {
                    break :brk Output.prettyFmt("<r><green>+<r> <b>{s}<r><d>@{}<r>\n", enable_ansi_colors);
                } else {
                    break :brk Output.prettyFmt("<r>+ {s}<r><d>@{}<r>\n", enable_ansi_colors);
                }
            };

            try writer.print(
                fmt,
                .{
                    name,
                    resolution.fmt(string_buf, .posix),
                },
            );
        }

        /// - Prints an empty newline with no diffs
        /// - Prints a leading and trailing blank newline with diffs
        pub fn print(
            this: *const Printer,
            manager: *PackageManager,
            comptime Writer: type,
            writer: Writer,
            comptime enable_ansi_colors: bool,
            comptime log_level: PackageManager.Options.LogLevel,
        ) !void {
            try writer.writeAll("\n");
            const allocator = this.lockfile.allocator;
            var slice = this.lockfile.packages.slice();
            const bins: []const Bin = slice.items(.bin);
            const resolved: []const Resolution = slice.items(.resolution);
            if (resolved.len == 0) return;
            const string_buf = this.lockfile.buffers.string_bytes.items;
            const resolutions_list = slice.items(.resolutions);
            const pkg_metas = slice.items(.meta);
            const resolutions_buffer: []const PackageID = this.lockfile.buffers.resolutions.items;
            const dependencies_buffer: []const Dependency = this.lockfile.buffers.dependencies.items;
            if (dependencies_buffer.len == 0) return;
            const id_map = try default_allocator.alloc(DependencyID, this.updates.len);
            @memset(id_map, invalid_package_id);
            defer if (id_map.len > 0) default_allocator.free(id_map);

            const end = @as(PackageID, @truncate(resolved.len));

            var had_printed_new_install = false;
            if (this.successfully_installed) |*installed| {
                if (comptime log_level.isVerbose()) {
                    var workspaces_to_print: std.ArrayListUnmanaged(DependencyID) = .{};
                    defer workspaces_to_print.deinit(allocator);

                    for (resolutions_list[0].begin()..resolutions_list[0].end()) |dep_id| {
                        const dep = dependencies_buffer[dep_id];
                        if (dep.behavior.isWorkspace()) {
                            workspaces_to_print.append(allocator, @intCast(dep_id)) catch bun.outOfMemory();
                        }
                    }

                    var found_workspace_to_print = false;
                    for (workspaces_to_print.items) |workspace_dep_id| {
                        const workspace_package_id = resolutions_buffer[workspace_dep_id];
                        for (resolutions_list[workspace_package_id].begin()..resolutions_list[workspace_package_id].end()) |dep_id| {
                            switch (shouldPrintPackageInstall(this, manager, @intCast(dep_id), installed, id_map, pkg_metas)) {
                                .yes => found_workspace_to_print = true,
                                else => {},
                            }
                        }
                    }

                    try printInstalledWorkspaceSection(
                        this,
                        manager,
                        Writer,
                        writer,
                        enable_ansi_colors,
                        0,
                        installed,
                        .dont_print_section_header,
                        &had_printed_new_install,
                        null,
                    );

                    for (workspaces_to_print.items) |workspace_dep_id| {
                        try printInstalledWorkspaceSection(
                            this,
                            manager,
                            Writer,
                            writer,
                            enable_ansi_colors,
                            resolutions_buffer[workspace_dep_id],
                            installed,
                            .print_section_header,
                            &had_printed_new_install,
                            null,
                        );
                    }
                } else {
                    // just print installed packages for the current workspace
                    var workspace_package_id: DependencyID = 0;
                    if (manager.workspace_name_hash) |workspace_name_hash| {
                        for (resolutions_list[0].begin()..resolutions_list[0].end()) |dep_id| {
                            const dep = dependencies_buffer[dep_id];
                            if (dep.behavior.isWorkspace() and dep.name_hash == workspace_name_hash) {
                                workspace_package_id = resolutions_buffer[dep_id];
                                break;
                            }
                        }
                    }

                    try printInstalledWorkspaceSection(
                        this,
                        manager,
                        Writer,
                        writer,
                        enable_ansi_colors,
                        workspace_package_id,
                        installed,
                        .dont_print_section_header,
                        &had_printed_new_install,
                        id_map,
                    );
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
                            resolved[package_id].fmt(string_buf, .auto),
                        },
                    );
                }
            }

            if (had_printed_new_install) {
                try writer.writeAll("\n");
            }

            if (bun.Environment.allow_assert) had_printed_new_install = false;

            var printed_installed_update_request = false;
            for (id_map) |dependency_id| {
                if (dependency_id == invalid_package_id) continue;
                if (bun.Environment.allow_assert) had_printed_new_install = true;

                const name = dependencies_buffer[dependency_id].name;
                const package_id = resolutions_buffer[dependency_id];
                const bin = bins[package_id];

                const package_name = name.slice(string_buf);

                switch (bin.tag) {
                    .none, .dir => {
                        printed_installed_update_request = true;

                        const fmt = comptime Output.prettyFmt("<r><green>installed<r> <b>{s}<r><d>@{}<r>\n", enable_ansi_colors);

                        try writer.print(
                            fmt,
                            .{
                                package_name,
                                resolved[package_id].fmt(string_buf, .posix),
                            },
                        );
                    },
                    .map, .file, .named_file => {
                        printed_installed_update_request = true;

                        var iterator = Bin.NamesIterator{
                            .bin = bin,
                            .package_name = name,
                            .string_buffer = string_buf,
                            .extern_string_buf = this.lockfile.buffers.extern_strings.items,
                        };

                        {
                            const fmt = comptime Output.prettyFmt("<r><green>installed<r> {s}<r><d>@{}<r> with binaries:\n", enable_ansi_colors);

                            try writer.print(
                                fmt,
                                .{
                                    package_name,
                                    resolved[package_id].fmt(string_buf, .posix),
                                },
                            );
                        }

                        {
                            const fmt = comptime Output.prettyFmt("<r> <d>- <r><b>{s}<r>\n", enable_ansi_colors);

                            if (manager.track_installed_bin == .pending) {
                                if (iterator.next() catch null) |bin_name| {
                                    manager.track_installed_bin = .{
                                        .basename = bun.default_allocator.dupe(u8, bin_name) catch bun.outOfMemory(),
                                    };

                                    try writer.print(fmt, .{bin_name});
                                }
                            }

                            while (iterator.next() catch null) |bin_name| {
                                try writer.print(fmt, .{bin_name});
                            }
                        }
                    },
                }
            }

            if (printed_installed_update_request) {
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

        fn packages(
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
            const all_requested_versions_buf = try this.lockfile.allocator.alloc(Dependency.Version, resolutions_buffer.len);
            var all_requested_versions = all_requested_versions_buf;
            defer this.lockfile.allocator.free(all_requested_versions_buf);
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
                const version_formatter = resolution.fmt(string_buf, .posix);

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
                        const needs_quote = always_needs_quote or bun.strings.indexAnyComptime(version_name, " |\t-/!") != null or strings.hasPrefixComptime(version_name, "npm:");

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

                    const url_formatter = resolution.fmtURL(string_buf);

                    // Resolved URL is always quoted
                    try std.fmt.format(writer, "\"{any}\"\n", .{url_formatter});

                    if (meta.integrity.tag != .unknown) {
                        // Integrity is...never quoted?
                        try std.fmt.format(writer, "  integrity {any}\n", .{&meta.integrity});
                    }

                    if (dependencies.len > 0) {
                        var behavior: Behavior = .{};
                        var dependency_behavior_change_count: u8 = 0;
                        for (dependencies) |dep| {
                            if (!dep.behavior.eq(behavior)) {
                                if (dep.behavior.isOptional()) {
                                    try writer.writeAll("  optionalDependencies:\n");
                                    if (comptime Environment.allow_assert) dependency_behavior_change_count += 1;
                                } else if (dep.behavior.isProd()) {
                                    try writer.writeAll("  dependencies:\n");
                                    if (comptime Environment.allow_assert) dependency_behavior_change_count += 1;
                                } else if (dep.behavior.isDev()) {
                                    try writer.writeAll("  devDependencies:\n");
                                    if (comptime Environment.allow_assert) dependency_behavior_change_count += 1;
                                } else {
                                    continue;
                                }
                                behavior = dep.behavior;

                                // assert its sorted. debug only because of a bug saving incorrect ordering
                                // of optional dependencies to lockfiles
                                if (comptime Environment.isDebug) assert(dependency_behavior_change_count < 3);
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

pub fn verifyData(this: *const Lockfile) !void {
    assert(this.format == Lockfile.FormatVersion.current);
    var i: usize = 0;
    while (i < this.packages.len) : (i += 1) {
        const package: Lockfile.Package = this.packages.get(i);
        assert(this.str(&package.name).len == @as(usize, package.name.len()));
        assert(String.Builder.stringHash(this.str(&package.name)) == @as(usize, package.name_hash));
        assert(package.dependencies.get(this.buffers.dependencies.items).len == @as(usize, package.dependencies.len));
        assert(package.resolutions.get(this.buffers.resolutions.items).len == @as(usize, package.resolutions.len));
        assert(package.resolutions.get(this.buffers.resolutions.items).len == @as(usize, package.dependencies.len));
        const dependencies = package.dependencies.get(this.buffers.dependencies.items);
        for (dependencies) |dependency| {
            assert(this.str(&dependency.name).len == @as(usize, dependency.name.len()));
            assert(String.Builder.stringHash(this.str(&dependency.name)) == dependency.name_hash);
        }
    }
}

pub fn saveToDisk(this: *Lockfile, save_format: LoadResult.LockfileFormat, verbose_log: bool) void {
    if (comptime Environment.allow_assert) {
        this.verifyData() catch |err| {
            Output.prettyErrorln("<r><red>error:<r> failed to verify lockfile: {s}", .{@errorName(err)});
            Global.crash();
        };
        assert(FileSystem.instance_loaded);
    }

    const bytes = bytes: {
        if (save_format == .text) {
            var writer_buf = MutableString.initEmpty(bun.default_allocator);
            var buffered_writer = writer_buf.bufferedWriter();
            const writer = buffered_writer.writer();

            TextLockfile.Stringifier.saveFromBinary(bun.default_allocator, this, writer) catch |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            };

            buffered_writer.flush() catch |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            };

            break :bytes writer_buf.list.items;
        }

        var bytes = std.ArrayList(u8).init(bun.default_allocator);

        var total_size: usize = 0;
        var end_pos: usize = 0;
        Lockfile.Serializer.save(this, verbose_log, &bytes, &total_size, &end_pos) catch |err| {
            Output.err(err, "failed to serialize lockfile", .{});
            Global.crash();
        };
        if (bytes.items.len >= end_pos)
            bytes.items[end_pos..][0..@sizeOf(usize)].* = @bitCast(total_size);
        break :bytes bytes.items;
    };
    defer bun.default_allocator.free(bytes);

    var tmpname_buf: [512]u8 = undefined;
    var base64_bytes: [8]u8 = undefined;
    bun.rand(&base64_bytes);
    const tmpname = if (save_format == .text)
        std.fmt.bufPrintZ(&tmpname_buf, ".lock-{s}.tmp", .{bun.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable
    else
        std.fmt.bufPrintZ(&tmpname_buf, ".lockb-{s}.tmp", .{bun.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;

    const file = switch (File.openat(std.fs.cwd(), tmpname, bun.O.CREAT | bun.O.WRONLY, 0o777)) {
        .err => |err| {
            Output.err(err, "failed to create temporary file to save lockfile\n{}", .{});
            Global.crash();
        },
        .result => |f| f,
    };

    switch (file.writeAll(bytes)) {
        .err => |e| {
            file.close();
            _ = bun.sys.unlink(tmpname);
            Output.err(e, "failed to write lockfile\n{}", .{});
            Global.crash();
        },
        .result => {},
    }

    if (comptime Environment.isPosix) {
        // chmod 755 for binary, 644 for plaintext
        var filemode: bun.Mode = 0o755;
        if (save_format == .text) {
            filemode = 0o644;
        }
        switch (bun.sys.fchmod(file.handle, filemode)) {
            .err => |err| {
                file.close();
                _ = bun.sys.unlink(tmpname);
                Output.err(err, "failed to change lockfile permissions\n{}", .{});
                Global.crash();
            },
            .result => {},
        }
    }

    file.closeAndMoveTo(tmpname, save_format.filename()) catch |err| {
        bun.handleErrorReturnTrace(err, @errorReturnTrace());

        // note: file is already closed here.
        _ = bun.sys.unlink(tmpname);

        Output.err(err, "Failed to replace old lockfile with new lockfile on disk", .{});
        Global.crash();
    };
}

pub fn rootPackage(this: *const Lockfile) ?Lockfile.Package {
    if (this.packages.len == 0) {
        return null;
    }

    return this.packages.get(0);
}

pub inline fn str(this: *const Lockfile, slicable: anytype) string {
    return strWithType(this, @TypeOf(slicable), slicable);
}

inline fn strWithType(this: *const Lockfile, comptime Type: type, slicable: Type) string {
    if (comptime Type == String) {
        @compileError("str must be a *const String. Otherwise it is a pointer to a temporary which is undefined behavior");
    }

    if (comptime Type == ExternalString) {
        @compileError("str must be a *const ExternalString. Otherwise it is a pointer to a temporary which is undefined behavior");
    }

    return slicable.slice(this.buffers.string_bytes.items);
}

pub fn initEmpty(this: *Lockfile, allocator: Allocator) void {
    this.* = .{
        .format = Lockfile.FormatVersion.current,
        .packages = .{},
        .buffers = .{},
        .package_index = PackageIndex.Map.initContext(allocator, .{}),
        .string_pool = StringPool.init(allocator),
        .allocator = allocator,
        .scratch = Scratch.init(allocator),
        .scripts = .{},
        .trusted_dependencies = null,
        .workspace_paths = .{},
        .workspace_versions = .{},
        .overrides = .{},
        .meta_hash = zero_hash,
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
        .id => |id| {
            if (comptime Environment.allow_assert) assert(id < resolutions.len);

            if (resolutions[id].eql(resolution, buf, buf)) {
                return id;
            }

            if (resolutions[id].tag == .npm and npm_version != null) {
                if (npm_version.?.satisfies(resolutions[id].value.npm.version, buf, buf)) return id;
            }
        },
        .ids => |ids| {
            for (ids.items) |id| {
                if (comptime Environment.allow_assert) assert(id < resolutions.len);

                if (resolutions[id].eql(resolution, buf, buf)) {
                    return id;
                }

                if (resolutions[id].tag == .npm and npm_version != null) {
                    if (npm_version.?.satisfies(resolutions[id].value.npm.version, buf, buf)) return id;
                }
            }
        },
    }

    return null;
}

/// Appends `pkg` to `this.packages` if a duplicate isn't found
pub fn appendPackageDedupe(this: *Lockfile, pkg: *Package, buf: string) OOM!PackageID {
    const entry = try this.package_index.getOrPut(pkg.name_hash);

    if (!entry.found_existing) {
        const new_id: PackageID = @intCast(this.packages.len);
        pkg.meta.id = new_id;
        try this.packages.append(this.allocator, pkg.*);
        entry.value_ptr.* = .{ .id = new_id };
        return new_id;
    }

    var resolutions = this.packages.items(.resolution);

    return switch (entry.value_ptr.*) {
        .id => |existing_id| {
            if (pkg.resolution.eql(&resolutions[existing_id], buf, buf)) {
                pkg.meta.id = existing_id;
                return existing_id;
            }

            const new_id: PackageID = @intCast(this.packages.len);
            pkg.meta.id = new_id;
            try this.packages.append(this.allocator, pkg.*);

            resolutions = this.packages.items(.resolution);

            var ids = try PackageIDList.initCapacity(this.allocator, 8);
            ids.items.len = 2;

            ids.items[0..2].* = if (pkg.resolution.order(&resolutions[existing_id], buf, buf) == .gt)
                .{ new_id, existing_id }
            else
                .{ existing_id, new_id };

            entry.value_ptr.* = .{
                .ids = ids,
            };

            return new_id;
        },
        .ids => |*existing_ids| {
            for (existing_ids.items) |existing_id| {
                if (pkg.resolution.eql(&resolutions[existing_id], buf, buf)) {
                    pkg.meta.id = existing_id;
                    return existing_id;
                }
            }

            const new_id: PackageID = @intCast(this.packages.len);
            pkg.meta.id = new_id;
            try this.packages.append(this.allocator, pkg.*);

            resolutions = this.packages.items(.resolution);

            for (existing_ids.items, 0..) |existing_id, i| {
                if (pkg.resolution.order(&resolutions[existing_id], buf, buf) == .gt) {
                    try existing_ids.insert(this.allocator, i, new_id);
                    return new_id;
                }
            }

            try existing_ids.append(this.allocator, new_id);

            return new_id;
        },
    };
}

pub fn getOrPutID(this: *Lockfile, id: PackageID, name_hash: PackageNameHash) OOM!void {
    const gpe = try this.package_index.getOrPut(name_hash);

    if (gpe.found_existing) {
        const index: *PackageIndex.Entry = gpe.value_ptr;

        switch (index.*) {
            .id => |existing_id| {
                var ids = try PackageIDList.initCapacity(this.allocator, 8);
                ids.items.len = 2;

                const resolutions = this.packages.items(.resolution);
                const buf = this.buffers.string_bytes.items;

                ids.items[0..2].* = if (resolutions[id].order(&resolutions[existing_id], buf, buf) == .gt)
                    .{ id, existing_id }
                else
                    .{ existing_id, id };

                index.* = .{
                    .ids = ids,
                };
            },
            .ids => |*existing_ids| {
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
        gpe.value_ptr.* = .{ .id = id };
    }
}

pub fn appendPackage(this: *Lockfile, package_: Lockfile.Package) OOM!Lockfile.Package {
    const id: PackageID = @truncate(this.packages.len);
    return try appendPackageWithID(this, package_, id);
}

fn appendPackageWithID(this: *Lockfile, package_: Lockfile.Package, id: PackageID) OOM!Lockfile.Package {
    defer {
        if (comptime Environment.allow_assert) {
            assert(this.getPackageID(package_.name_hash, null, &package_.resolution) != null);
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

pub fn stringBuf(this: *Lockfile) String.Buf {
    return .{
        .bytes = &this.buffers.string_bytes,
        .allocator = this.allocator,
        .pool = &this.string_pool,
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
        this.assertNotAllocated();

        if (String.canInline(slice)) return;
        this._countWithHash(slice, String.Builder.stringHash(slice));
    }

    pub inline fn countWithHash(this: *StringBuilder, slice: string, hash: u64) void {
        this.assertNotAllocated();

        if (String.canInline(slice)) return;
        this._countWithHash(slice, hash);
    }

    inline fn assertNotAllocated(this: *const StringBuilder) void {
        if (comptime Environment.allow_assert) {
            if (this.ptr != null) {
                Output.panic("StringBuilder.count called after StringBuilder.allocate. This is a bug in Bun. Please make sure to call StringBuilder.count before allocating.", .{});
            }
        }
    }

    inline fn _countWithHash(this: *StringBuilder, slice: string, hash: u64) void {
        this.assertNotAllocated();

        if (!this.lockfile.string_pool.contains(hash)) {
            this.cap += slice.len;
        }
    }

    pub fn allocatedSlice(this: *StringBuilder) []const u8 {
        return if (this.ptr) |ptr| ptr[0..this.cap] else "";
    }

    pub fn clamp(this: *StringBuilder) void {
        if (comptime Environment.allow_assert) {
            assert(this.cap >= this.len);
            // assert that no other builder was allocated while this builder was being used
            assert(this.lockfile.buffers.string_bytes.items.len == this.off + this.cap);
        }

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
        return @call(bun.callmod_inline, appendWithHash, .{ this, Type, slice, String.Builder.stringHash(slice) });
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
            assert(this.len <= this.cap); // didn't count everything
            assert(this.ptr != null); // must call allocate first
        }

        bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
        const final_slice = this.ptr.?[this.len..this.cap][0..slice.len];
        this.len += slice.len;

        if (comptime Environment.allow_assert) assert(this.len <= this.cap);

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
            assert(this.len <= this.cap); // didn't count everything
            assert(this.ptr != null); // must call allocate first
        }

        const string_entry = this.lockfile.string_pool.getOrPut(hash) catch unreachable;
        if (!string_entry.found_existing) {
            bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
            const final_slice = this.ptr.?[this.len..this.cap][0..slice.len];
            this.len += slice.len;

            string_entry.value_ptr.* = String.init(this.lockfile.buffers.string_bytes.items, final_slice);
        }

        if (comptime Environment.allow_assert) assert(this.len <= this.cap);

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
        id: PackageID,
        ids: PackageIDList,

        pub const Tag = enum(u8) {
            id = 0,
            ids = 1,
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
    /// now because given a Dependency ID, there is no fast way to trace it to its package.
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

    pub fn clone(this: *OverrideMap, pm: *PackageManager, old_lockfile: *Lockfile, new_lockfile: *Lockfile, new_builder: *Lockfile.StringBuilder) !OverrideMap {
        var new = OverrideMap{};
        try new.map.ensureTotalCapacity(new_lockfile.allocator, this.map.entries.len);

        for (this.map.keys(), this.map.values()) |k, v| {
            new.map.putAssumeCapacity(
                k,
                try v.clone(pm, old_lockfile.buffers.string_bytes.items, @TypeOf(new_builder), new_builder),
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
        pm: *PackageManager,
        lockfile: *Lockfile,
        root_package: *Lockfile.Package,
        log: *logger.Log,
        json_source: logger.Source,
        expr: Expr,
        builder: *Lockfile.StringBuilder,
    ) !void {
        if (Environment.allow_assert) {
            assert(this.map.entries.len == 0); // only call parse once
        }
        if (expr.asProperty("overrides")) |overrides| {
            try this.parseFromOverrides(pm, lockfile, root_package, json_source, log, overrides.expr, builder);
        } else if (expr.asProperty("resolutions")) |resolutions| {
            try this.parseFromResolutions(pm, lockfile, root_package, json_source, log, resolutions.expr, builder);
        }
        debug("parsed {d} overrides", .{this.map.entries.len});
    }

    /// https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides
    pub fn parseFromOverrides(
        this: *OverrideMap,
        pm: *PackageManager,
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
                pm,
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
        pm: *PackageManager,
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
                pm,
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
        package_manager: *PackageManager,
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
                package_manager,
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

    meta: Meta = Meta.init(),
    bin: Bin = .{},

    /// If any of these scripts run, they will run in order:
    /// 1. preinstall
    /// 2. install
    /// 3. postinstall
    /// 4. preprepare
    /// 5. prepare
    /// 6. postprepare
    scripts: Package.Scripts = .{},

    pub const Scripts = extern struct {
        preinstall: String = .{},
        install: String = .{},
        postinstall: String = .{},
        preprepare: String = .{},
        prepare: String = .{},
        postprepare: String = .{},
        filled: bool = false,

        pub fn eql(l: *const Package.Scripts, r: *const Package.Scripts, l_buf: string, r_buf: string) bool {
            return l.preinstall.eql(r.preinstall, l_buf, r_buf) and
                l.install.eql(r.install, l_buf, r_buf) and
                l.postinstall.eql(r.postinstall, l_buf, r_buf) and
                l.preprepare.eql(r.preprepare, l_buf, r_buf) and
                l.prepare.eql(r.prepare, l_buf, r_buf) and
                l.postprepare.eql(r.postprepare, l_buf, r_buf);
        }

        pub const List = struct {
            items: [Lockfile.Scripts.names.len]?Lockfile.Scripts.Entry,
            first_index: u8,
            total: u8,
            cwd: stringZ,
            package_name: string,

            pub fn printScripts(
                this: Package.Scripts.List,
                resolution: *const Resolution,
                resolution_buf: []const u8,
                comptime format_type: enum { completed, info, untrusted },
            ) void {
                if (std.mem.indexOf(u8, this.cwd, std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str)) |i| {
                    Output.pretty("<d>.{s}{s} @{}<r>\n", .{
                        std.fs.path.sep_str,
                        strings.withoutTrailingSlash(this.cwd[i + 1 ..]),
                        resolution.fmt(resolution_buf, .posix),
                    });
                } else {
                    Output.pretty("<d>{s} @{}<r>\n", .{
                        strings.withoutTrailingSlash(this.cwd),
                        resolution.fmt(resolution_buf, .posix),
                    });
                }

                const fmt = switch (comptime format_type) {
                    .completed => " <green>✓<r> [{s}]<d>:<r> <cyan>{s}<r>\n",
                    .untrusted => " <yellow>»<r> [{s}]<d>:<r> <cyan>{s}<r>\n",
                    .info => " [{s}]<d>:<r> <cyan>{s}<r>\n",
                };
                for (this.items, 0..) |maybe_script, script_index| {
                    if (maybe_script) |script| {
                        Output.pretty(fmt, .{
                            Lockfile.Scripts.names[script_index],
                            script.script,
                        });
                    }
                }
            }

            pub fn first(this: Package.Scripts.List) Lockfile.Scripts.Entry {
                if (comptime Environment.allow_assert) {
                    assert(this.items[this.first_index] != null);
                }
                return this.items[this.first_index].?;
            }

            pub fn deinit(this: Package.Scripts.List, allocator: std.mem.Allocator) void {
                for (this.items) |maybe_item| {
                    if (maybe_item) |item| {
                        allocator.free(item.script);
                    }
                }

                allocator.free(this.cwd);
            }

            pub fn appendToLockfile(this: Package.Scripts.List, lockfile: *Lockfile) void {
                inline for (this.items, 0..) |maybe_script, i| {
                    if (maybe_script) |script| {
                        debug("enqueue({s}, {s}) in {s}", .{ "prepare", this.package_name, this.cwd });
                        @field(lockfile.scripts, Lockfile.Scripts.names[i]).append(lockfile.allocator, script) catch bun.outOfMemory();
                    }
                }
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

        pub fn getScriptEntries(
            this: *const Package.Scripts,
            lockfile: *Lockfile,
            lockfile_buf: string,
            resolution_tag: Resolution.Tag,
            add_node_gyp_rebuild_script: bool,
            // return: first_index, total, entries
        ) struct { i8, u8, [Lockfile.Scripts.names.len]?Lockfile.Scripts.Entry } {
            const allocator = lockfile.allocator;
            var script_index: u8 = 0;
            var first_script_index: i8 = -1;
            var scripts: [6]?Lockfile.Scripts.Entry = .{null} ** 6;
            var counter: u8 = 0;

            if (add_node_gyp_rebuild_script) {
                {
                    script_index += 1;
                    const entry: Lockfile.Scripts.Entry = .{
                        .script = allocator.dupe(u8, "node-gyp rebuild") catch unreachable,
                    };
                    if (first_script_index == -1) first_script_index = @intCast(script_index);
                    scripts[script_index] = entry;
                    script_index += 1;
                    counter += 1;
                }

                // missing install and preinstall, only need to check postinstall
                if (!this.postinstall.isEmpty()) {
                    const entry: Lockfile.Scripts.Entry = .{
                        .script = allocator.dupe(u8, this.preinstall.slice(lockfile_buf)) catch unreachable,
                    };
                    if (first_script_index == -1) first_script_index = @intCast(script_index);
                    scripts[script_index] = entry;
                    counter += 1;
                }
                script_index += 1;
            } else {
                const install_scripts = .{
                    "preinstall",
                    "install",
                    "postinstall",
                };

                inline for (install_scripts) |hook| {
                    const script = @field(this, hook);
                    if (!script.isEmpty()) {
                        const entry: Lockfile.Scripts.Entry = .{
                            .script = allocator.dupe(u8, script.slice(lockfile_buf)) catch unreachable,
                        };
                        if (first_script_index == -1) first_script_index = @intCast(script_index);
                        scripts[script_index] = entry;
                        counter += 1;
                    }
                    script_index += 1;
                }
            }

            switch (resolution_tag) {
                .git, .github, .root => {
                    const prepare_scripts = .{
                        "preprepare",
                        "prepare",
                        "postprepare",
                    };

                    inline for (prepare_scripts) |hook| {
                        const script = @field(this, hook);
                        if (!script.isEmpty()) {
                            const entry: Lockfile.Scripts.Entry = .{
                                .script = allocator.dupe(u8, script.slice(lockfile_buf)) catch unreachable,
                            };
                            if (first_script_index == -1) first_script_index = @intCast(script_index);
                            scripts[script_index] = entry;
                            counter += 1;
                        }
                        script_index += 1;
                    }
                },
                .workspace => {
                    script_index += 1;
                    if (!this.prepare.isEmpty()) {
                        const entry: Lockfile.Scripts.Entry = .{
                            .script = allocator.dupe(u8, this.prepare.slice(lockfile_buf)) catch unreachable,
                        };
                        if (first_script_index == -1) first_script_index = @intCast(script_index);
                        scripts[script_index] = entry;
                        counter += 1;
                    }
                    script_index += 2;
                },
                else => {},
            }

            return .{ first_script_index, counter, scripts };
        }

        pub fn createList(
            this: *const Package.Scripts,
            lockfile: *Lockfile,
            lockfile_buf: []const u8,
            cwd_: string,
            package_name: string,
            resolution_tag: Resolution.Tag,
            add_node_gyp_rebuild_script: bool,
        ) ?Package.Scripts.List {
            const allocator = lockfile.allocator;
            const first_index, const total, const scripts = getScriptEntries(this, lockfile, lockfile_buf, resolution_tag, add_node_gyp_rebuild_script);
            if (first_index != -1) {
                var cwd_buf: if (Environment.isWindows) bun.PathBuffer else void = undefined;

                const cwd = if (comptime !Environment.isWindows)
                    cwd_
                else brk: {
                    @memcpy(cwd_buf[0..cwd_.len], cwd_);
                    cwd_buf[cwd_.len] = 0;
                    const cwd_handle = bun.openDirNoRenamingOrDeletingWindows(bun.invalid_fd, cwd_buf[0..cwd_.len :0]) catch break :brk cwd_;

                    var buf: bun.WPathBuffer = undefined;
                    const new_cwd = bun.windows.GetFinalPathNameByHandle(cwd_handle.fd, .{}, &buf) catch break :brk cwd_;

                    break :brk strings.convertUTF16toUTF8InBuffer(&cwd_buf, new_cwd) catch break :brk cwd_;
                };

                return .{
                    .items = scripts,
                    .first_index = @intCast(first_index),
                    .total = total,
                    .cwd = allocator.dupeZ(u8, cwd) catch bun.outOfMemory(),
                    .package_name = lockfile.allocator.dupe(u8, package_name) catch bun.outOfMemory(),
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

        pub fn getList(
            this: *Package.Scripts,
            log: *logger.Log,
            lockfile: *Lockfile,
            node_modules: *PackageManager.LazyPackageDestinationDir,
            abs_node_modules_path: string,
            folder_name: string,
            resolution: *const Resolution,
        ) !?Package.Scripts.List {
            var path_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;
            if (this.hasAny()) {
                const add_node_gyp_rebuild_script = if (lockfile.hasTrustedDependency(folder_name) and
                    this.install.isEmpty() and
                    this.preinstall.isEmpty())
                brk: {
                    const binding_dot_gyp_path = Path.joinAbsStringZ(
                        abs_node_modules_path,
                        &[_]string{ folder_name, "binding.gyp" },
                        .auto,
                    );

                    break :brk bun.sys.exists(binding_dot_gyp_path);
                } else false;

                const cwd = Path.joinAbsStringBufZTrailingSlash(
                    abs_node_modules_path,
                    &path_buf,
                    &[_]string{folder_name},
                    .auto,
                );

                return this.createList(
                    lockfile,
                    lockfile.buffers.string_bytes.items,
                    cwd,
                    folder_name,
                    resolution.tag,
                    add_node_gyp_rebuild_script,
                );
            } else if (!this.filled) {
                const abs_folder_path = Path.joinAbsStringBufZTrailingSlash(
                    abs_node_modules_path,
                    &path_buf,
                    &[_]string{folder_name},
                    .auto,
                );
                return this.createFromPackageJSON(
                    log,
                    lockfile,
                    node_modules,
                    abs_folder_path,
                    folder_name,
                    resolution.tag,
                );
            }

            return null;
        }

        pub fn fillFromPackageJSON(
            this: *Package.Scripts,
            allocator: std.mem.Allocator,
            string_builder: *Lockfile.StringBuilder,
            log: *logger.Log,
            node_modules: *PackageManager.LazyPackageDestinationDir,
            folder_name: string,
        ) !void {
            const json = brk: {
                const json_src = brk2: {
                    const json_path = bun.path.joinZ([_]string{ folder_name, "package.json" }, .auto);
                    const buf = try bun.sys.File.readFrom(try node_modules.getDir(), json_path, allocator).unwrap();
                    break :brk2 logger.Source.initPathString(json_path, buf);
                };

                initializeStore();
                break :brk try JSON.parsePackageJSONUTF8(
                    &json_src,
                    log,
                    allocator,
                );
            };

            Lockfile.Package.Scripts.parseCount(allocator, string_builder, json);
            try string_builder.allocate();
            this.parseAlloc(allocator, string_builder, json);
            this.filled = true;
        }

        pub fn createFromPackageJSON(
            this: *Package.Scripts,
            log: *logger.Log,
            lockfile: *Lockfile,
            node_modules: *PackageManager.LazyPackageDestinationDir,
            abs_folder_path: string,
            folder_name: string,
            resolution_tag: Resolution.Tag,
        ) !?Package.Scripts.List {
            var tmp: Lockfile = undefined;
            tmp.initEmpty(lockfile.allocator);
            defer tmp.deinit();
            var builder = tmp.stringBuilder();
            try this.fillFromPackageJSON(lockfile.allocator, &builder, log, node_modules, folder_name);

            const add_node_gyp_rebuild_script = if (this.install.isEmpty() and this.preinstall.isEmpty()) brk: {
                const binding_dot_gyp_path = Path.joinAbsStringZ(
                    abs_folder_path,
                    &[_]string{"binding.gyp"},
                    .auto,
                );

                break :brk bun.sys.exists(binding_dot_gyp_path);
            } else false;

            return this.createList(
                lockfile,
                tmp.buffers.string_bytes.items,
                abs_folder_path,
                folder_name,
                resolution_tag,
                add_node_gyp_rebuild_script,
            );
        }
    };

    pub const DependencyGroup = struct {
        prop: string,
        field: string,
        behavior: Behavior,

        pub const dependencies = DependencyGroup{ .prop = "dependencies", .field = "dependencies", .behavior = Behavior.prod };
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
        pm: *PackageManager,
        old: *Lockfile,
        new: *Lockfile,
        package_id_mapping: []PackageID,
        cloner: *Cloner,
    ) !PackageID {
        const old_string_buf = old.buffers.string_bytes.items;
        const old_extern_string_buf = old.buffers.extern_strings.items;
        var builder_ = new.stringBuilder();
        var builder = &builder_;
        debug("Clone: {s}@{any} ({s}, {d} dependencies)", .{
            this.name.slice(old_string_buf),
            this.resolution.fmt(old_string_buf, .auto),
            @tagName(this.resolution.tag),
            this.dependencies.len,
        });

        builder.count(this.name.slice(old_string_buf));
        this.resolution.count(old_string_buf, *Lockfile.StringBuilder, builder);
        this.meta.count(old_string_buf, *Lockfile.StringBuilder, builder);
        this.scripts.count(old_string_buf, *Lockfile.StringBuilder, builder);
        for (old.patched_dependencies.values()) |patched_dep| builder.count(patched_dep.path.slice(old.buffers.string_bytes.items));
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

        if (cloner.manager.preinstall_state.items.len > 0) {
            cloner.manager.preinstall_state.items[new_package.meta.id] = cloner.old_preinstall_state.items[this.meta.id];
        }

        for (old_dependencies, dependencies) |old_dep, *new_dep| {
            new_dep.* = try old_dep.clone(
                pm,
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
        pm: *PackageManager,
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
            if (comptime Environment.allow_assert) assert(dependencies_list.items.len == resolutions_list.items.len);

            var dependencies: []Dependency = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
            @memset(dependencies, Dependency{});

            const package_dependencies = package_json.dependencies.map.values();
            const source_buf = package_json.dependencies.source_buf;
            for (package_dependencies) |dep| {
                if (!dep.behavior.isEnabled(features)) continue;

                dependencies[0] = try dep.clone(pm, source_buf, @TypeOf(&string_builder), &string_builder);
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
        pm: *PackageManager,
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

                if (comptime Environment.isDebug) assert(keys.len == version_strings.len);

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
                        .version = version.append(
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
            if (comptime Environment.allow_assert) assert(dependencies_list.items.len == resolutions_list.items.len);

            var dependencies = dependencies_list.items.ptr[dependencies_list.items.len..total_len];
            @memset(dependencies, .{});

            total_dependencies_count = 0;
            inline for (dependency_groups) |group| {
                const map: ExternalStringMap = @field(package_version, group.field);
                const keys = map.name.get(manifest.external_strings);
                const version_strings = map.value.get(manifest.external_strings_for_versions);

                if (comptime Environment.isDebug) assert(keys.len == version_strings.len);
                const is_peer = comptime strings.eqlComptime(group.field, "peer_dependencies");

                list: for (keys, version_strings, 0..) |key, version_string_, i| {
                    // Duplicate peer & dev dependencies are promoted to whichever appeared first
                    // In practice, npm validates this so it shouldn't happen
                    var duplicate_at: ?usize = null;
                    if (comptime group.behavior.isPeer() or group.behavior.isDev() or group.behavior.isOptional()) {
                        for (dependencies[0..total_dependencies_count], 0..) |dependency, j| {
                            if (dependency.name_hash == key.hash) {
                                if (comptime group.behavior.isOptional()) {
                                    duplicate_at = j;
                                    break;
                                }

                                continue :list;
                            }
                        }
                    }

                    const name: ExternalString = string_builder.appendWithHash(ExternalString, key.slice(string_buf), key.hash);
                    const dep_version = string_builder.appendWithHash(String, version_string_.slice(string_buf), version_string_.hash);
                    const sliced = dep_version.sliced(lockfile.buffers.string_bytes.items);

                    var behavior = group.behavior;
                    if (comptime is_peer) {
                        behavior.optional = i < package_version.non_optional_peer_dependencies_start;
                    }
                    if (package_version_ptr.allDependenciesBundled()) {
                        behavior.bundled = true;
                    } else for (package_version.bundled_dependencies.get(manifest.bundled_deps_buf)) |bundled_dep_name_hash| {
                        if (bundled_dep_name_hash == name.hash) {
                            behavior.bundled = true;
                            break;
                        }
                    }

                    const dependency = Dependency{
                        .name = name.value,
                        .name_hash = name.hash,
                        .behavior = behavior,
                        .version = Dependency.parse(
                            allocator,
                            name.value,
                            name.hash,
                            sliced.slice,
                            &sliced,
                            log,
                            pm,
                        ) orelse Dependency.Version{},
                    };

                    // If a dependency appears in both "dependencies" and "optionalDependencies", it is considered optional!
                    if (comptime group.behavior.isOptional()) {
                        if (duplicate_at) |j| {
                            // need to shift dependencies after the duplicate to maintain sort order
                            for (j + 1..total_dependencies_count) |k| {
                                dependencies[k - 1] = dependencies[k];
                            }

                            // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies
                            // > Entries in optionalDependencies will override entries of the same name in dependencies, so it's usually best to only put in one place.
                            dependencies[total_dependencies_count - 1] = dependency;
                            continue :list;
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
            package.meta.setHasInstallScript(package_version.has_install_script);

            package.dependencies.off = @as(u32, @truncate(dependencies_list.items.len));
            package.dependencies.len = total_dependencies_count;
            package.resolutions.off = package.dependencies.off;
            package.resolutions.len = package.dependencies.len;

            const new_length = package.dependencies.len + dependencies_list.items.len;

            @memset(resolutions_list.items.ptr[package.dependencies.off .. package.dependencies.off + package.dependencies.len], invalid_package_id);

            dependencies_list.items = dependencies_list.items.ptr[0..new_length];
            resolutions_list.items = resolutions_list.items.ptr[0..new_length];

            if (comptime Environment.isDebug) {
                if (package.resolution.value.npm.url.isEmpty()) {
                    Output.panic("tarball_url is empty for package {s}@{}", .{ manifest.name(), version });
                }
            }

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

            // bool for if this dependency should be added to lockfile trusted dependencies.
            // it is false when the new trusted dependency is coming from the default list.
            added_trusted_dependencies: std.ArrayHashMapUnmanaged(TruncatedPackageNameHash, bool, ArrayIdentityContext, false) = .{},
            removed_trusted_dependencies: TrustedDependenciesSet = .{},

            patched_dependencies_changed: bool = false,

            pub inline fn sum(this: *Summary, that: Summary) void {
                this.add += that.add;
                this.remove += that.remove;
                this.update += that.update;
            }

            pub inline fn hasDiffs(this: Summary) bool {
                return this.add > 0 or this.remove > 0 or this.update > 0 or this.overrides_changed or
                    this.added_trusted_dependencies.count() > 0 or
                    this.removed_trusted_dependencies.count() > 0 or
                    this.patched_dependencies_changed;
            }
        };

        pub fn generate(
            pm: *PackageManager,
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
            var to_deps = to.dependencies.get(to_lockfile.buffers.dependencies.items);
            const from_deps = from.dependencies.get(from_lockfile.buffers.dependencies.items);
            const from_resolutions = from.resolutions.get(from_lockfile.buffers.resolutions.items);
            var to_i: usize = 0;

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

            trusted_dependencies: {
                // trusted dependency diff
                //
                // situations:
                // 1 - Both old lockfile and new lockfile use default trusted dependencies, no diffs
                // 2 - Both exist, only diffs are from additions and removals
                //
                // 3 - Old lockfile has trusted dependencies, new lockfile does not. Added are dependencies
                //     from default list that didn't exist previously. We need to be careful not to add these
                //     to the new lockfile. Removed are dependencies from old list that
                //     don't exist in the default list.
                //
                // 4 - Old lockfile used the default list, new lockfile has trusted dependencies. Added
                //     are dependencies are all from the new lockfile. Removed is empty because the default
                //     list isn't appended to the lockfile.

                // 1
                if (from_lockfile.trusted_dependencies == null and to_lockfile.trusted_dependencies == null) break :trusted_dependencies;

                // 2
                if (from_lockfile.trusted_dependencies != null and to_lockfile.trusted_dependencies != null) {
                    const from_trusted_dependencies = from_lockfile.trusted_dependencies.?;
                    const to_trusted_dependencies = to_lockfile.trusted_dependencies.?;

                    {
                        // added
                        var to_trusted_iter = to_trusted_dependencies.iterator();
                        while (to_trusted_iter.next()) |entry| {
                            const to_trusted = entry.key_ptr.*;
                            if (!from_trusted_dependencies.contains(to_trusted)) {
                                try summary.added_trusted_dependencies.put(allocator, to_trusted, true);
                            }
                        }
                    }

                    {
                        // removed
                        var from_trusted_iter = from_trusted_dependencies.iterator();
                        while (from_trusted_iter.next()) |entry| {
                            const from_trusted = entry.key_ptr.*;
                            if (!to_trusted_dependencies.contains(from_trusted)) {
                                try summary.removed_trusted_dependencies.put(allocator, from_trusted, {});
                            }
                        }
                    }

                    break :trusted_dependencies;
                }

                // 3
                if (from_lockfile.trusted_dependencies != null and to_lockfile.trusted_dependencies == null) {
                    const from_trusted_dependencies = from_lockfile.trusted_dependencies.?;

                    {
                        // added
                        for (default_trusted_dependencies.entries) |entry| {
                            if (!from_trusted_dependencies.contains(@truncate(entry.hash))) {
                                // although this is a new trusted dependency, it is from the default
                                // list so it shouldn't be added to the lockfile
                                try summary.added_trusted_dependencies.put(allocator, @truncate(entry.hash), false);
                            }
                        }
                    }

                    {
                        // removed
                        var from_trusted_iter = from_trusted_dependencies.iterator();
                        while (from_trusted_iter.next()) |entry| {
                            const from_trusted = entry.key_ptr.*;
                            if (!default_trusted_dependencies.hasWithHash(@intCast(from_trusted))) {
                                try summary.removed_trusted_dependencies.put(allocator, from_trusted, {});
                            }
                        }
                    }

                    break :trusted_dependencies;
                }

                // 4
                if (from_lockfile.trusted_dependencies == null and to_lockfile.trusted_dependencies != null) {
                    const to_trusted_dependencies = to_lockfile.trusted_dependencies.?;

                    {
                        // add all to trusted dependencies, even if they exist in default because they weren't in the
                        // lockfile originally
                        var to_trusted_iter = to_trusted_dependencies.iterator();
                        while (to_trusted_iter.next()) |entry| {
                            const to_trusted = entry.key_ptr.*;
                            try summary.added_trusted_dependencies.put(allocator, to_trusted, true);
                        }
                    }

                    {
                        // removed
                        // none
                    }

                    break :trusted_dependencies;
                }
            }

            summary.patched_dependencies_changed = patched_dependencies_changed: {
                if (from_lockfile.patched_dependencies.entries.len != to_lockfile.patched_dependencies.entries.len) break :patched_dependencies_changed true;
                var iter = to_lockfile.patched_dependencies.iterator();
                while (iter.next()) |entry| {
                    if (from_lockfile.patched_dependencies.get(entry.key_ptr.*)) |val| {
                        if (!std.mem.eql(
                            u8,
                            val.path.slice(from_lockfile.buffers.string_bytes.items),
                            entry.value_ptr.path.slice(to_lockfile.buffers.string_bytes.items),
                        )) break :patched_dependencies_changed true;
                    } else break :patched_dependencies_changed true;
                }
                iter = from_lockfile.patched_dependencies.iterator();
                while (iter.next()) |entry| {
                    if (!to_lockfile.patched_dependencies.contains(entry.key_ptr.*)) break :patched_dependencies_changed true;
                }
                break :patched_dependencies_changed false;
            };

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
                        const update_mapping = switch (version.tag) {
                            .workspace => if (to_lockfile.workspace_paths.getPtr(from_dep.name_hash)) |path_ptr| brk: {
                                const path = to_lockfile.str(path_ptr);
                                var local_buf: bun.PathBuffer = undefined;
                                const package_json_path = Path.joinAbsStringBuf(FileSystem.instance.top_level_dir, &local_buf, &.{ path, "package.json" }, .auto);

                                const source = bun.sys.File.toSource(package_json_path, allocator).unwrap() catch {
                                    // Can't guarantee this workspace still exists
                                    break :brk false;
                                };

                                var workspace = Package{};

                                const json = pm.workspace_package_json_cache.getWithSource(bun.default_allocator, log, source, .{}).unwrap() catch break :brk false;

                                var resolver: void = {};
                                try workspace.parseWithJSON(
                                    to_lockfile,
                                    pm,
                                    allocator,
                                    log,
                                    source,
                                    json.root,
                                    void,
                                    &resolver,
                                    Features.workspace,
                                );

                                to_deps = to.dependencies.get(to_lockfile.buffers.dependencies.items);

                                var from_pkg = from_lockfile.packages.get(from_resolutions[i]);
                                const diff = try generate(
                                    pm,
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
                        };

                        if (update_mapping) {
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

            // Use saturating arithmetic here because a migrated
            // package-lock.json could be out of sync with the package.json, so the
            // number of from_deps could be greater than to_deps.
            summary.add = @truncate((to_deps.len) -| (from_deps.len -| summary.remove));

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

    pub fn parse(
        package: *Lockfile.Package,
        lockfile: *Lockfile,
        pm: *PackageManager,
        allocator: Allocator,
        log: *logger.Log,
        source: logger.Source,
        comptime ResolverContext: type,
        resolver: *ResolverContext,
        comptime features: Features,
    ) !void {
        initializeStore();
        const json = JSON.parsePackageJSONUTF8(&source, log, allocator) catch |err| {
            log.print(Output.errorWriter()) catch {};
            Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(err), source.path.prettyDir() });
            Global.crash();
        };

        try package.parseWithJSON(
            lockfile,
            pm,
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
        pm: *PackageManager,
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
        const external_version = brk: {
            if (comptime Environment.isWindows) {
                switch (tag orelse Dependency.Version.Tag.infer(version)) {
                    .workspace, .folder, .symlink, .tarball => {
                        if (String.canInline(version)) {
                            var copy = string_builder.append(String, version);
                            bun.path.dangerouslyConvertPathToPosixInPlace(u8, &copy.bytes);
                            break :brk copy;
                        } else {
                            const str_ = string_builder.append(String, version);
                            const ptr = str_.ptr();
                            bun.path.dangerouslyConvertPathToPosixInPlace(u8, lockfile.buffers.string_bytes.items[ptr.off..][0..ptr.len]);
                            break :brk str_;
                        }
                    },
                    else => {},
                }
            }

            break :brk string_builder.append(String, version);
        };

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
            pm,
        ) orelse Dependency.Version{};
        var workspace_range: ?Semver.Query.Group = null;
        const name_hash = switch (dependency_version.tag) {
            .npm => String.Builder.stringHash(dependency_version.value.npm.name.slice(buf)),
            .workspace => if (strings.hasPrefixComptime(sliced.slice, "workspace:")) brk: {
                const input = sliced.slice["workspace:".len..];
                const trimmed = strings.trim(input, &strings.whitespace_chars);
                if (trimmed.len != 1 or (trimmed[0] != '*' and trimmed[0] != '^' and trimmed[0] != '~')) {
                    const at = strings.lastIndexOfChar(input, '@') orelse 0;
                    if (at > 0) {
                        workspace_range = Semver.Query.parse(allocator, input[at + 1 ..], sliced) catch |err| {
                            switch (err) {
                                error.OutOfMemory => bun.outOfMemory(),
                            }
                        };
                        break :brk String.Builder.stringHash(input[0..at]);
                    }
                    workspace_range = Semver.Query.parse(allocator, input, sliced) catch |err| {
                        switch (err) {
                            error.OutOfMemory => bun.outOfMemory(),
                        }
                    };
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
        }

        if (comptime tag != null) {
            bun.assert(dependency_version.tag != .npm and dependency_version.tag != .dist_tag);
        }

        var found_workspace = false;

        switch (dependency_version.tag) {
            .folder => {
                const relative = Path.relative(
                    FileSystem.instance.top_level_dir,
                    Path.joinAbsString(
                        FileSystem.instance.top_level_dir,
                        &[_]string{
                            source.path.name.dir,
                            dependency_version.value.folder.slice(buf),
                        },
                        .auto,
                    ),
                );
                // if relative is empty, we are linking the package to itself
                dependency_version.value.folder = string_builder.append(String, if (relative.len == 0) "." else relative);
            },
            .npm => {
                const npm = dependency_version.value.npm;
                if (workspace_version != null) {
                    if (npm.version.satisfies(workspace_version.?, buf, buf)) {
                        const path = workspace_path.?.sliced(buf);
                        if (Dependency.parseWithTag(
                            allocator,
                            external_alias.value,
                            external_alias.hash,
                            path.slice,
                            .workspace,
                            &path,
                            log,
                            pm,
                        )) |dep| {
                            found_workspace = true;
                            dependency_version = dep;
                        }
                    } else {
                        // It doesn't satisfy, but a workspace shares the same name. Override the workspace with the other dependency
                        for (package_dependencies[0..dependencies_count]) |*dep| {
                            if (dep.name_hash == name_hash and dep.version.tag == .workspace) {
                                dep.* = .{
                                    .behavior = if (in_workspace) group.behavior.add(.workspace) else group.behavior,
                                    .name = external_alias.value,
                                    .name_hash = external_alias.hash,
                                    .version = dependency_version,
                                };
                                return null;
                            }
                        }
                    }
                }
            },
            .workspace => workspace: {
                if (workspace_path) |path| {
                    if (workspace_range) |range| {
                        if (workspace_version) |ver| {
                            if (range.satisfies(ver, buf, buf)) {
                                dependency_version.literal = path;
                                dependency_version.value.workspace = path;
                                break :workspace;
                            }
                        }

                        // important to trim before len == 0 check. `workspace:foo@      ` should install successfully
                        const version_literal = strings.trim(range.input, &strings.whitespace_chars);
                        if (version_literal.len == 0 or range.@"is *"() or Semver.Version.isTaggedVersionOnly(version_literal)) {
                            dependency_version.literal = path;
                            dependency_version.value.workspace = path;
                            break :workspace;
                        }

                        // workspace is not required to have a version, but if it does
                        // and this version doesn't match it, fail to install
                        try log.addErrorFmt(
                            &source,
                            logger.Loc.Empty,
                            allocator,
                            "No matching version for workspace dependency \"{s}\". Version: \"{s}\"",
                            .{
                                external_alias.slice(buf),
                                dependency_version.literal.slice(buf),
                            },
                        );
                        return error.InstallFailed;
                    }

                    dependency_version.literal = path;
                    dependency_version.value.workspace = path;
                } else {
                    const workspace = dependency_version.value.workspace.slice(buf);
                    const path = string_builder.append(String, if (strings.eqlComptime(workspace, "*")) "*" else brk: {
                        var buf2: bun.PathBuffer = undefined;
                        break :brk Path.relativePlatform(
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
                            .posix,
                            false,
                        );
                    });
                    if (comptime Environment.allow_assert) {
                        assert(path.len() > 0);
                        assert(!std.fs.path.isAbsolute(path.slice(buf)));
                    }
                    dependency_version.literal = path;
                    dependency_version.value.workspace = path;

                    const workspace_entry = try lockfile.workspace_paths.getOrPut(allocator, name_hash);
                    const found_matching_workspace = workspace_entry.found_existing;

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
                }
            },
            else => {},
        }

        const this_dep = Dependency{
            .behavior = if (in_workspace) group.behavior.add(.workspace) else group.behavior,
            .name = external_alias.value,
            .name_hash = external_alias.hash,
            .version = dependency_version,
        };

        // `peerDependencies` may be specified on existing dependencies. Packages in `workspaces` are deduplicated when
        // the array is processed
        if (comptime features.check_for_duplicate_dependencies and !group.behavior.isPeer() and !group.behavior.isWorkspace()) {
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
            if (comptime Environment.isDebug) {
                if (!bun.sys.exists(key)) {
                    Output.debugWarn("WorkspaceMap.insert: key {s} does not exist", .{key});
                }
            }

            const entry = try self.map.getOrPut(key);
            if (!entry.found_existing) {
                entry.key_ptr.* = try self.map.allocator.dupe(u8, key);
            } else {
                self.map.allocator.free(entry.value_ptr.name);
            }

            entry.value_ptr.* = .{
                .name = value.name,
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
        name: []const u8 = "",
        name_loc: logger.Loc = logger.Loc.Empty,
        version: ?[]const u8 = null,
    };

    fn processWorkspaceName(
        allocator: std.mem.Allocator,
        json_cache: *PackageManager.WorkspacePackageJSONCache,
        abs_package_json_path: [:0]const u8,
        log: *logger.Log,
    ) !WorkspaceEntry {
        const workspace_json = try json_cache.getWithPath(allocator, log, abs_package_json_path, .{
            .init_reset_store = false,
            .guess_indentation = true,
        }).unwrap();

        const name_expr = workspace_json.root.get("name") orelse return error.MissingPackageName;
        const name = try name_expr.asStringCloned(allocator) orelse return error.MissingPackageName;

        var entry = WorkspaceEntry{
            .name = name,
            .name_loc = name_expr.loc,
        };
        debug("processWorkspaceName({s}) = {s}", .{ abs_package_json_path, entry.name });
        if (workspace_json.root.get("version")) |version_expr| {
            if (try version_expr.asStringCloned(allocator)) |version| {
                entry.version = version;
            }
        }

        return entry;
    }

    pub fn processWorkspaceNamesArray(
        workspace_names: *WorkspaceMap,
        allocator: Allocator,
        json_cache: *PackageManager.WorkspacePackageJSONCache,
        log: *logger.Log,
        arr: *JSAst.E.Array,
        source: *const logger.Source,
        loc: logger.Loc,
        string_builder: ?*StringBuilder,
    ) !u32 {
        if (arr.items.len == 0) return 0;

        const orig_msgs_len = log.msgs.items.len;

        var workspace_globs = std.ArrayList(string).init(allocator);
        defer workspace_globs.deinit();
        const filepath_bufOS = allocator.create(bun.PathBuffer) catch unreachable;
        const filepath_buf = std.mem.asBytes(filepath_bufOS);
        defer allocator.destroy(filepath_bufOS);

        for (arr.slice()) |item| {
            // TODO: when does this get deallocated?
            const input_path = try item.asStringZ(allocator) orelse {
                log.addErrorFmt(source, item.loc, allocator,
                    \\Workspaces expects an array of strings, like:
                    \\  <r><green>"workspaces"<r>: [
                    \\    <green>"path/to/package"<r>
                    \\  ]
                , .{}) catch {};
                return error.InvalidPackageJSON;
            };

            if (input_path.len == 0 or input_path.len == 1 and input_path[0] == '.') continue;

            if (Glob.Ascii.detectGlobSyntax(input_path)) {
                workspace_globs.append(input_path) catch bun.outOfMemory();
                continue;
            }

            const abs_package_json_path: stringZ = Path.joinAbsStringBufZ(
                source.path.name.dir,
                filepath_buf,
                &.{ input_path, "package.json" },
                .auto,
            );

            // skip root package.json
            if (strings.eqlLong(bun.path.dirname(abs_package_json_path, .auto), source.path.name.dir, true)) continue;

            const workspace_entry = processWorkspaceName(
                allocator,
                json_cache,
                abs_package_json_path,
                log,
            ) catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                switch (err) {
                    error.EISNOTDIR, error.EISDIR, error.EACCESS, error.EPERM, error.ENOENT, error.FileNotFound => {
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

            const rel_input_path = Path.relativePlatform(
                source.path.name.dir,
                strings.withoutSuffixComptime(abs_package_json_path, std.fs.path.sep_str ++ "package.json"),
                .auto,
                true,
            );
            if (comptime Environment.isWindows) {
                Path.dangerouslyConvertPathToPosixInPlace(u8, @constCast(rel_input_path));
            }

            if (string_builder) |builder| {
                builder.count(workspace_entry.name);
                builder.count(rel_input_path);
                builder.cap += bun.MAX_PATH_BYTES;
                if (workspace_entry.version) |version_string| {
                    builder.count(version_string);
                }
            }

            try workspace_names.insert(rel_input_path, .{
                .name = workspace_entry.name,
                .name_loc = workspace_entry.name_loc,
                .version = workspace_entry.version,
            });
        }

        if (workspace_globs.items.len > 0) {
            var arena = std.heap.ArenaAllocator.init(allocator);
            defer arena.deinit();
            for (workspace_globs.items) |user_pattern| {
                defer _ = arena.reset(.retain_capacity);

                const glob_pattern = if (user_pattern.len == 0) "package.json" else brk: {
                    const parts = [_][]const u8{ user_pattern, "package.json" };
                    break :brk arena.allocator().dupe(u8, bun.path.join(parts, .auto)) catch bun.outOfMemory();
                };

                var walker: GlobWalker = .{};
                var cwd = bun.path.dirname(source.path.text, .auto);
                cwd = if (bun.strings.eql(cwd, "")) bun.fs.FileSystem.instance.top_level_dir else cwd;
                if ((try walker.initWithCwd(&arena, glob_pattern, cwd, false, false, false, false, true)).asErr()) |e| {
                    log.addErrorFmt(
                        source,
                        loc,
                        allocator,
                        "Failed to run workspace pattern <b>{s}<r> due to error <b>{s}<r>",
                        .{ user_pattern, @tagName(e.getErrno()) },
                    ) catch {};
                    return error.GlobError;
                }
                defer walker.deinit(false);

                var iter: GlobWalker.Iterator = .{
                    .walker = &walker,
                };
                defer iter.deinit();
                if ((try iter.init()).asErr()) |e| {
                    log.addErrorFmt(
                        source,
                        loc,
                        allocator,
                        "Failed to run workspace pattern <b>{s}<r> due to error <b>{s}<r>",
                        .{ user_pattern, @tagName(e.getErrno()) },
                    ) catch {};
                    return error.GlobError;
                }

                while (switch (try iter.next()) {
                    .result => |r| r,
                    .err => |e| {
                        log.addErrorFmt(
                            source,
                            loc,
                            allocator,
                            "Failed to run workspace pattern <b>{s}<r> due to error <b>{s}<r>",
                            .{ user_pattern, @tagName(e.getErrno()) },
                        ) catch {};
                        return error.GlobError;
                    },
                }) |matched_path| {
                    const entry_dir: []const u8 = Path.dirname(matched_path, .auto);

                    // skip root package.json
                    if (strings.eqlComptime(matched_path, "package.json")) continue;

                    debug("matched path: {s}, dirname: {s}\n", .{ matched_path, entry_dir });

                    const abs_package_json_path = Path.joinAbsStringBufZ(
                        cwd,
                        filepath_buf,
                        &.{ entry_dir, "package.json" },
                        .auto,
                    );
                    const abs_workspace_dir_path: string = strings.withoutSuffixComptime(abs_package_json_path, "package.json");

                    const workspace_entry = processWorkspaceName(
                        allocator,
                        json_cache,
                        abs_package_json_path,
                        log,
                    ) catch |err| {
                        bun.handleErrorReturnTrace(err, @errorReturnTrace());

                        const entry_base: []const u8 = Path.basename(matched_path);
                        switch (err) {
                            error.FileNotFound, error.PermissionDenied => continue,
                            error.MissingPackageName => {
                                log.addErrorFmt(
                                    source,
                                    logger.Loc.Empty,
                                    allocator,
                                    "Missing \"name\" from package.json in {s}" ++ std.fs.path.sep_str ++ "{s}",
                                    .{ entry_dir, entry_base },
                                ) catch {};
                            },
                            else => {
                                log.addErrorFmt(
                                    source,
                                    logger.Loc.Empty,
                                    allocator,
                                    "{s} reading package.json for workspace package \"{s}\" from \"{s}\"",
                                    .{ @errorName(err), entry_dir, entry_base },
                                ) catch {};
                            },
                        }

                        continue;
                    };

                    if (workspace_entry.name.len == 0) continue;

                    const workspace_path: string = Path.relativePlatform(
                        source.path.name.dir,
                        abs_workspace_dir_path,
                        .auto,
                        true,
                    );
                    if (comptime Environment.isWindows) {
                        Path.dangerouslyConvertPathToPosixInPlace(u8, @constCast(workspace_path));
                    }

                    if (string_builder) |builder| {
                        builder.count(workspace_entry.name);
                        builder.count(workspace_path);
                        builder.cap += bun.MAX_PATH_BYTES;
                        if (workspace_entry.version) |version| {
                            builder.count(version);
                        }
                    }

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

        return @truncate(workspace_names.count());
    }

    pub fn parseWithJSON(
        package: *Lockfile.Package,
        lockfile: *Lockfile,
        pm: *PackageManager,
        allocator: Allocator,
        log: *logger.Log,
        source: logger.Source,
        json: Expr,
        comptime ResolverContext: type,
        resolver: *ResolverContext,
        comptime features: Features,
    ) !void {
        var string_builder = lockfile.stringBuilder();
        var total_dependencies_count: u32 = 0;

        package.meta.origin = if (features.is_main) .local else .npm;
        package.name = String{};
        package.name_hash = 0;

        // -- Count the sizes
        name: {
            if (json.asProperty("name")) |name_q| {
                if (name_q.expr.asString(allocator)) |name| {
                    if (name.len != 0) {
                        string_builder.count(name);
                        break :name;
                    }
                }
            }

            // name is not validated by npm, so fallback to creating a new from the version literal
            if (ResolverContext == PackageManager.GitResolver) {
                const resolution: *const Resolution = resolver.resolution;
                const repo = switch (resolution.tag) {
                    .git => resolution.value.git,
                    .github => resolution.value.github,

                    else => break :name,
                };

                resolver.new_name = Repository.createDependencyNameFromVersionLiteral(
                    lockfile.allocator,
                    &repo,
                    lockfile,
                    resolver.dep_id,
                );

                string_builder.count(resolver.new_name);
            }
        }

        if (json.asProperty("patchedDependencies")) |patched_deps| {
            const obj = patched_deps.expr.data.e_object;
            for (obj.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;
                if (key.isString() and value.isString()) {
                    string_builder.count(value.asString(allocator).?);
                }
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
                @as(usize, @intFromBool(features.workspaces)) +
                    @as(usize, @intFromBool(features.dependencies)) +
                    @as(usize, @intFromBool(features.dev_dependencies)) +
                    @as(usize, @intFromBool(features.optional_dependencies)) +
                    @as(usize, @intFromBool(features.peer_dependencies))
            ]DependencyGroup = undefined;
            var out_group_i: usize = 0;

            if (features.workspaces) {
                out_groups[out_group_i] = DependencyGroup.workspaces;
                out_group_i += 1;
            }

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
                            &pm.workspace_package_json_cache,
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
                                        &pm.workspace_package_json_cache,
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
                        if (lockfile.trusted_dependencies == null) lockfile.trusted_dependencies = .{};
                        try lockfile.trusted_dependencies.?.ensureUnusedCapacity(allocator, arr.items.len);
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
                            lockfile.trusted_dependencies.?.putAssumeCapacity(@as(TruncatedPackageNameHash, @truncate(String.Builder.stringHash(name))), {});
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
        if (comptime Environment.allow_assert) assert(lockfile.buffers.dependencies.items.len == lockfile.buffers.resolutions.items.len);

        const package_dependencies = lockfile.buffers.dependencies.items.ptr[off..total_len];

        name: {
            if (ResolverContext == PackageManager.GitResolver) {
                if (resolver.new_name.len != 0) {
                    defer lockfile.allocator.free(resolver.new_name);
                    const external_string = string_builder.append(ExternalString, resolver.new_name);
                    package.name = external_string.value;
                    package.name_hash = external_string.hash;
                    break :name;
                }
            }

            if (json.asProperty("name")) |name_q| {
                if (name_q.expr.asString(allocator)) |name| {
                    if (name.len != 0) {
                        const external_string = string_builder.append(ExternalString, name);

                        package.name = external_string.value;
                        package.name_hash = external_string.hash;
                        break :name;
                    }
                }
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

        if (json.asProperty("patchedDependencies")) |patched_deps| {
            const obj = patched_deps.expr.data.e_object;
            lockfile.patched_dependencies.ensureTotalCapacity(allocator, obj.properties.len) catch unreachable;
            for (obj.properties.slice()) |prop| {
                const key = prop.key.?;
                const value = prop.value.?;
                if (key.isString() and value.isString()) {
                    var sfb = std.heap.stackFallback(1024, allocator);
                    const keyhash = try key.asStringHash(sfb.get(), String.Builder.stringHash) orelse unreachable;
                    const patch_path = string_builder.append(String, value.asString(allocator).?);
                    lockfile.patched_dependencies.put(allocator, keyhash, .{ .path = patch_path }) catch unreachable;
                }
            }
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
                                if (comptime Environment.allow_assert) assert(i == extern_strings.len);
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

        var bundled_deps = bun.StringSet.init(allocator);
        defer bundled_deps.deinit();
        var bundle_all_deps = false;
        if (comptime ResolverContext != void and ResolverContext.checkBundledDependencies()) {
            if (json.get("bundleDependencies") orelse json.get("bundledDependencies")) |bundled_deps_expr| {
                switch (bundled_deps_expr.data) {
                    .e_boolean => |boolean| {
                        bundle_all_deps = boolean.value;
                    },
                    .e_array => |arr| {
                        for (arr.slice()) |item| {
                            try bundled_deps.insert(item.asString(allocator) orelse continue);
                        }
                    },
                    else => {},
                }
            }
        }

        total_dependencies_count = 0;
        const in_workspace = lockfile.workspace_paths.contains(package.name_hash);

        inline for (dependency_groups) |group| {
            if (group.behavior.isWorkspace()) {
                var seen_workspace_names = TrustedDependenciesSet{};
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
                                if (strings.eqlLong(value.name, entry.name, true))
                                    i += 1;
                            }
                            break :count i;
                        };
                        const notes = notes: {
                            var notes = try allocator.alloc(logger.Data, num_notes);
                            var i: usize = 0;
                            for (workspace_names.values(), workspace_names.keys()) |value, note_path| {
                                if (note_path.ptr == path.ptr) continue;
                                if (strings.eqlLong(value.name, entry.name, true)) {
                                    const note_abs_path = allocator.dupeZ(u8, Path.joinAbsStringZ(cwd, &.{ note_path, "package.json" }, .auto)) catch bun.outOfMemory();

                                    const note_src = bun.sys.File.toSource(note_abs_path, allocator).unwrap() catch logger.Source.initEmptyFile(note_abs_path);

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

                        const src = bun.sys.File.toSource(abs_path, allocator).unwrap() catch logger.Source.initEmptyFile(abs_path);

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
                        pm,
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
                            dep.behavior = dep.behavior.add(.optional);
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
                                    pm,
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
                                        dep.behavior.optional = true;
                                    }

                                    if (bundle_all_deps or bundled_deps.contains(dep.name.slice(lockfile.buffers.string_bytes.items))) {
                                        dep.behavior.bundled = true;
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
            try lockfile.overrides.parseAppend(pm, lockfile, package, log, source, json, &string_builder);
        }

        string_builder.clamp();
    }

    pub const List = bun.MultiArrayList(Lockfile.Package);

    pub const Meta = extern struct {
        // TODO: when we bump the lockfile version, we should reorder this to:
        // id(32), arch(16), os(16), id(8), man_dir(8), has_install_script(8), integrity(72 align 8)
        // should allow us to remove padding bytes

        // TODO: remove origin. it doesnt do anything and can be inferred from the resolution
        origin: Origin = Origin.npm,
        _padding_origin: u8 = 0,

        arch: Npm.Architecture = .all,
        os: Npm.OperatingSystem = .all,
        _padding_os: u16 = 0,

        id: PackageID = invalid_package_id,

        man_dir: String = .{},
        integrity: Integrity = .{},

        /// Shouldn't be used directly. Use `Meta.hasInstallScript()` and
        /// `Meta.setHasInstallScript()` instead.
        ///
        /// `.old` represents the value of this field before it was used
        /// in the lockfile and should never be saved to a new lockfile.
        /// There is a debug assert for this in `Lockfile.Package.Serializer.save()`.
        has_install_script: enum(u8) {
            old = 0,
            false,
            true,
        } = .false,

        _padding_integrity: [2]u8 = .{0} ** 2,

        /// Does the `cpu` arch and `os` match the requirements listed in the package?
        /// This is completely unrelated to "devDependencies", "peerDependencies", "optionalDependencies" etc
        pub fn isDisabled(this: *const Meta) bool {
            return !this.arch.isMatch() or !this.os.isMatch();
        }

        pub fn hasInstallScript(this: *const Meta) bool {
            return this.has_install_script == .true;
        }

        pub fn setHasInstallScript(this: *Meta, has_script: bool) void {
            this.has_install_script = if (has_script) .true else .false;
        }

        pub fn needsUpdate(this: *const Meta) bool {
            return this.has_install_script == .old;
        }

        pub fn count(this: *const Meta, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) void {
            builder.count(this.man_dir.slice(buf));
        }

        pub fn init() Meta {
            return .{};
        }

        pub fn clone(this: *const Meta, id: PackageID, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) Meta {
            return Meta{
                .id = id,
                .man_dir = builder.append(String, this.man_dir.slice(buf)),
                .integrity = this.integrity,
                .arch = this.arch,
                .os = this.os,
                .origin = this.origin,
                .has_install_script = this.has_install_script,
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
                if (comptime Environment.allow_assert) {
                    debug("save(\"{s}\") = {d} bytes", .{ field.name, std.mem.sliceAsBytes(value).len });
                    if (comptime strings.eqlComptime(field.name, "meta")) {
                        for (value) |meta| {
                            assert(meta.has_install_script != .old);
                        }
                    }
                }
                comptime assertNoUninitializedPadding(@TypeOf(value));
                try writer.writeAll(std.mem.sliceAsBytes(value));
            }

            const really_end_at = try stream.getPos();

            _ = stream.pwrite(std.mem.asBytes(&really_begin_at), begin_at);
            _ = stream.pwrite(std.mem.asBytes(&really_end_at), end_at);
        }

        const PackagesLoadResult = struct {
            list: Lockfile.Package.List,
            needs_update: bool = false,
        };

        pub fn load(
            stream: *Stream,
            end: usize,
            allocator: Allocator,
        ) !PackagesLoadResult {
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

            var needs_update = false;
            inline for (FieldsEnum.fields) |field| {
                const value = sliced.items(@field(Lockfile.Package.List.Field, field.name));

                comptime assertNoUninitializedPadding(@TypeOf(value));
                const bytes = std.mem.sliceAsBytes(value);
                const end_pos = stream.pos + bytes.len;
                if (end_pos <= end_at) {
                    @memcpy(bytes, stream.buffer[stream.pos..][0..bytes.len]);
                    stream.pos = end_pos;
                    if (comptime strings.eqlComptime(field.name, "meta")) {
                        // need to check if any values were created from an older version of bun
                        // (currently just `has_install_script`). If any are found, the values need
                        // to be updated before saving the lockfile.
                        for (value) |*meta| {
                            if (meta.needsUpdate()) {
                                needs_update = true;
                                break;
                            }
                        }
                    }
                } else if (comptime strings.eqlComptime(field.name, "scripts")) {
                    @memset(bytes, 0);
                } else {
                    return error.@"Lockfile validation failed: invalid package list range";
                }
            }

            return .{
                .list = list,
                .needs_update = needs_update,
            };
        }
    };
};

pub fn deinit(this: *Lockfile) void {
    this.buffers.deinit(this.allocator);
    this.packages.deinit(this.allocator);
    this.string_pool.deinit();
    this.scripts.deinit(this.allocator);
    if (this.trusted_dependencies) |*trusted_dependencies| {
        trusted_dependencies.deinit(this.allocator);
    }
    this.patched_dependencies.deinit(this.allocator);
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

        // If its 0xDEADBEEF, then that means the value was never written in the lockfile.
        if (start_pos == 0xDEADBEEF) {
            return error.CorruptLockfile;
        }

        // These are absolute numbers, it shouldn't be zero.
        // There's a prefix before any of the arrays, so it can never be zero here.
        if (start_pos == 0) {
            return error.CorruptLockfile;
        }

        // We shouldn't be going backwards.
        if (start_pos < (stream.pos -| @sizeOf(u64))) {
            return error.CorruptLockfile;
        }

        const end_pos = try reader.readInt(u64, .little);

        // If its 0xDEADBEEF, then that means the value was never written in the lockfile.
        // That shouldn't happen.
        if (end_pos == 0xDEADBEEF) {
            return error.CorruptLockfile;
        }

        // These are absolute numbers, it shouldn't be zero.
        if (end_pos == 0) {
            return error.CorruptLockfile;
        }

        // Prevent integer overflow.
        if (start_pos > end_pos) {
            return error.CorruptLockfile;
        }

        // Prevent buffer overflow.
        if (end_pos > stream.buffer.len) {
            return error.CorruptLockfile;
        }

        const byte_len = end_pos - start_pos;
        stream.pos = end_pos;

        if (byte_len == 0) return ArrayList{
            .items = &[_]PointerType{},
            .capacity = 0,
        };

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

    pub fn save(
        lockfile: *Lockfile,
        verbose_log: bool,
        allocator: Allocator,
        comptime StreamType: type,
        stream: StreamType,
        comptime Writer: type,
        writer: Writer,
    ) !void {
        const buffers = lockfile.buffers;
        inline for (sizes.names) |name| {
            if (verbose_log) {
                Output.prettyErrorln("Saving {d} {s}", .{ @field(buffers, name).items.len, name });
            }

            // Dependencies have to be converted to .toExternal first
            // We store pointers in Version.Value, so we can't just write it directly
            if (comptime strings.eqlComptime(name, "dependencies")) {
                const remaining = buffers.dependencies.items;

                if (comptime Environment.allow_assert) {
                    for (remaining) |dep| {
                        switch (dep.version.tag) {
                            .folder => {
                                const folder = lockfile.str(&dep.version.value.folder);
                                if (strings.containsChar(folder, std.fs.path.sep_windows)) {
                                    std.debug.panic("workspace windows separator: {s}\n", .{folder});
                                }
                            },
                            .tarball => {
                                if (dep.version.value.tarball.uri == .local) {
                                    const tarball = lockfile.str(&dep.version.value.tarball.uri.local);
                                    if (strings.containsChar(tarball, std.fs.path.sep_windows)) {
                                        std.debug.panic("tarball windows separator: {s}", .{tarball});
                                    }
                                }
                            },
                            .workspace => {
                                const workspace = lockfile.str(&dep.version.value.workspace);
                                if (strings.containsChar(workspace, std.fs.path.sep_windows)) {
                                    std.debug.panic("workspace windows separator: {s}\n", .{workspace});
                                }
                            },
                            .symlink => {
                                const symlink = lockfile.str(&dep.version.value.symlink);
                                if (strings.containsChar(symlink, std.fs.path.sep_windows)) {
                                    std.debug.panic("symlink windows separator: {s}\n", .{symlink});
                                }
                            },
                            else => {},
                        }
                    }
                }

                // It would be faster to buffer these instead of one big allocation
                var to_clone = try std.ArrayListUnmanaged(Dependency.External).initCapacity(allocator, remaining.len);

                defer to_clone.deinit(allocator);
                for (remaining) |dep| {
                    to_clone.appendAssumeCapacity(Dependency.toExternal(dep));
                }

                try writeArray(StreamType, stream, Writer, writer, []Dependency.External, to_clone.items);
            } else {
                const list = @field(buffers, name);
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

    pub fn load(stream: *Stream, allocator: Allocator, log: *logger.Log, pm_: ?*PackageManager) !Buffers {
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
                if (pm_) |pm| {
                    if (pm.options.log_level.isVerbose()) {
                        Output.prettyErrorln("Loaded {d} {s}", .{ external_dependency_list_.items.len, name });
                    }
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
                if (pm_) |pm| {
                    if (pm.options.log_level.isVerbose()) {
                        Output.prettyErrorln("Loaded {d} {s}", .{ @field(this, name).items.len, name });
                    }
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
            .package_manager = pm_,
        };

        this.dependencies.expandToCapacity();
        this.dependencies.items.len = external_dependency_list.len;

        {
            var external_deps = external_dependency_list.ptr;
            const dependencies = this.dependencies.items;
            if (comptime Environment.allow_assert) assert(external_dependency_list.len == dependencies.len);
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

    const has_patched_dependencies_tag: u64 = @bitCast(@as([8]u8, "pAtChEdD".*));
    const has_workspace_package_ids_tag: u64 = @bitCast(@as([8]u8, "wOrKsPaC".*));
    const has_trusted_dependencies_tag: u64 = @bitCast(@as([8]u8, "tRuStEDd".*));
    const has_empty_trusted_dependencies_tag: u64 = @bitCast(@as([8]u8, "eMpTrUsT".*));
    const has_overrides_tag: u64 = @bitCast(@as([8]u8, "oVeRriDs".*));

    pub fn save(this: *Lockfile, verbose_log: bool, bytes: *std.ArrayList(u8), total_size: *usize, end_pos: *usize) !void {

        // we clone packages with the z_allocator to make sure bytes are zeroed.
        // TODO: investigate if we still need this now that we have `padding_checker.zig`
        var old_packages_list = this.packages;
        this.packages = try this.packages.clone(z_allocator);
        old_packages_list.deinit(this.allocator);

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

        if (comptime Environment.allow_assert) {
            for (this.packages.items(.resolution)) |res| {
                switch (res.tag) {
                    .folder => {
                        assert(!strings.containsChar(this.str(&res.value.folder), std.fs.path.sep_windows));
                    },
                    .symlink => {
                        assert(!strings.containsChar(this.str(&res.value.symlink), std.fs.path.sep_windows));
                    },
                    .local_tarball => {
                        assert(!strings.containsChar(this.str(&res.value.local_tarball), std.fs.path.sep_windows));
                    },
                    .workspace => {
                        assert(!strings.containsChar(this.str(&res.value.workspace), std.fs.path.sep_windows));
                    },
                    else => {},
                }
            }
        }

        try Lockfile.Package.Serializer.save(this.packages, StreamType, stream, @TypeOf(writer), writer);
        try Lockfile.Buffers.save(this, verbose_log, z_allocator, StreamType, stream, @TypeOf(writer), writer);
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

        if (this.trusted_dependencies) |trusted_dependencies| {
            if (trusted_dependencies.count() > 0) {
                try writer.writeAll(std.mem.asBytes(&has_trusted_dependencies_tag));

                try Lockfile.Buffers.writeArray(
                    StreamType,
                    stream,
                    @TypeOf(writer),
                    writer,
                    []u32,
                    trusted_dependencies.keys(),
                );
            } else {
                try writer.writeAll(std.mem.asBytes(&has_empty_trusted_dependencies_tag));
            }
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

        if (this.patched_dependencies.entries.len > 0) {
            for (this.patched_dependencies.values()) |patched_dep| bun.assert(!patched_dep.patchfile_hash_is_null);

            try writer.writeAll(std.mem.asBytes(&has_patched_dependencies_tag));

            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []PackageNameAndVersionHash,
                this.patched_dependencies.keys(),
            );

            try Lockfile.Buffers.writeArray(
                StreamType,
                stream,
                @TypeOf(writer),
                writer,
                []PatchedDep,
                this.patched_dependencies.values(),
            );
        }

        total_size.* = try stream.getPos();

        try writer.writeAll(&alignment_bytes_to_repeat_buffer);
    }

    pub const SerializerLoadResult = struct {
        packages_need_update: bool = false,
    };

    pub fn load(
        lockfile: *Lockfile,
        stream: *Stream,
        allocator: Allocator,
        log: *logger.Log,
        manager: ?*PackageManager,
    ) !SerializerLoadResult {
        var res = SerializerLoadResult{};
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

        const packages_load_result = try Lockfile.Package.Serializer.load(
            stream,
            total_buffer_size,
            allocator,
        );

        lockfile.packages = packages_load_result.list;
        res.packages_need_update = packages_load_result.needs_update;

        lockfile.buffers = try Lockfile.Buffers.load(
            stream,
            allocator,
            log,
            manager,
        );
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

            // >= because `has_empty_trusted_dependencies_tag` is tag only
            if (remaining_in_buffer >= 8 and total_buffer_size <= stream.buffer.len) {
                const next_num = try reader.readInt(u64, .little);
                if (remaining_in_buffer > 8 and next_num == has_trusted_dependencies_tag) {
                    var trusted_dependencies_hashes = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(u32),
                    );
                    defer trusted_dependencies_hashes.deinit(allocator);

                    lockfile.trusted_dependencies = .{};
                    try lockfile.trusted_dependencies.?.ensureTotalCapacity(allocator, trusted_dependencies_hashes.items.len);

                    lockfile.trusted_dependencies.?.entries.len = trusted_dependencies_hashes.items.len;
                    @memcpy(lockfile.trusted_dependencies.?.keys(), trusted_dependencies_hashes.items);
                    try lockfile.trusted_dependencies.?.reIndex(allocator);
                } else if (next_num == has_empty_trusted_dependencies_tag) {
                    // trusted dependencies exists in package.json but is an empty array.
                    lockfile.trusted_dependencies = .{};
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
                        .package_manager = manager,
                    };
                    for (overrides_name_hashes.items, override_versions_external.items) |name, value| {
                        map.putAssumeCapacity(name, Dependency.toDependency(value, context));
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
                if (next_num == has_patched_dependencies_tag) {
                    var patched_dependencies_name_and_version_hashes =
                        try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(PackageNameAndVersionHash),
                    );
                    defer patched_dependencies_name_and_version_hashes.deinit(allocator);

                    var map = lockfile.patched_dependencies;
                    defer lockfile.patched_dependencies = map;

                    try map.ensureTotalCapacity(allocator, patched_dependencies_name_and_version_hashes.items.len);
                    const patched_dependencies_paths = try Lockfile.Buffers.readArray(
                        stream,
                        allocator,
                        std.ArrayListUnmanaged(PatchedDep),
                    );

                    for (patched_dependencies_name_and_version_hashes.items, patched_dependencies_paths.items) |name_hash, patch_path| {
                        map.putAssumeCapacity(name_hash, patch_path);
                    }
                } else {
                    stream.pos -= 8;
                }
            }
        }

        lockfile.scratch = Lockfile.Scratch.init(allocator);
        lockfile.package_index = PackageIndex.Map.initContext(allocator, .{});
        lockfile.string_pool = StringPool.init(allocator);
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

        if (comptime Environment.allow_assert) assert(stream.pos == total_buffer_size);

        // const end = try reader.readInt(u64, .little);
        return res;
    }
};

pub const EqlSorter = struct {
    string_buf: string,
    pkg_names: []const String,

    // Basically placement id
    pub const PathToId = struct {
        pkg_id: PackageID,
        tree_path: string,
    };

    pub fn isLessThan(this: @This(), l: PathToId, r: PathToId) bool {
        switch (strings.order(l.tree_path, r.tree_path)) {
            .lt => return true,
            .gt => return false,
            .eq => {},
        }

        // they exist in the same tree, name can't be the same so string
        // compare.
        const l_name = this.pkg_names[l.pkg_id];
        const r_name = this.pkg_names[r.pkg_id];
        return l_name.order(&r_name, this.string_buf, this.string_buf) == .lt;
    }
};

/// `cut_off_pkg_id` should be removed when we stop appending packages to lockfile during install step
pub fn eql(l: *const Lockfile, r: *const Lockfile, cut_off_pkg_id: usize, allocator: std.mem.Allocator) OOM!bool {
    const l_hoisted_deps = l.buffers.hoisted_dependencies.items;
    const r_hoisted_deps = r.buffers.hoisted_dependencies.items;
    const l_string_buf = l.buffers.string_bytes.items;
    const r_string_buf = r.buffers.string_bytes.items;

    const l_len = l_hoisted_deps.len;
    const r_len = r_hoisted_deps.len;

    if (l_len != r_len) return false;

    const sort_buf = try allocator.alloc(EqlSorter.PathToId, l_len + r_len);
    defer l.allocator.free(sort_buf);
    var l_buf = sort_buf[0..l_len];
    var r_buf = sort_buf[r_len..];

    var path_buf: bun.PathBuffer = undefined;
    var depth_buf: Tree.DepthBuf = undefined;

    var i: usize = 0;
    for (l.buffers.trees.items) |l_tree| {
        const rel_path, _ = Tree.relativePathAndDepth(l, l_tree.id, &path_buf, &depth_buf, .pkg_path);
        const tree_path = try allocator.dupe(u8, rel_path);
        for (l_tree.dependencies.get(l_hoisted_deps)) |l_dep_id| {
            if (l_dep_id == invalid_dependency_id) continue;
            const l_pkg_id = l.buffers.resolutions.items[l_dep_id];
            if (l_pkg_id == invalid_package_id or l_pkg_id >= cut_off_pkg_id) continue;
            l_buf[i] = .{
                .pkg_id = l_pkg_id,
                .tree_path = tree_path,
            };
            i += 1;
        }
    }
    l_buf = l_buf[0..i];

    i = 0;
    for (r.buffers.trees.items) |r_tree| {
        const rel_path, _ = Tree.relativePathAndDepth(r, r_tree.id, &path_buf, &depth_buf, .pkg_path);
        const tree_path = try allocator.dupe(u8, rel_path);
        for (r_tree.dependencies.get(r_hoisted_deps)) |r_dep_id| {
            if (r_dep_id == invalid_dependency_id) continue;
            const r_pkg_id = r.buffers.resolutions.items[r_dep_id];
            if (r_pkg_id == invalid_package_id or r_pkg_id >= cut_off_pkg_id) continue;
            r_buf[i] = .{
                .pkg_id = r_pkg_id,
                .tree_path = tree_path,
            };
            i += 1;
        }
    }
    r_buf = r_buf[0..i];

    if (l_buf.len != r_buf.len) return false;

    const l_pkgs = l.packages.slice();
    const r_pkgs = r.packages.slice();
    const l_pkg_names = l_pkgs.items(.name);
    const r_pkg_names = r_pkgs.items(.name);

    std.sort.pdq(
        EqlSorter.PathToId,
        l_buf,
        EqlSorter{
            .pkg_names = l_pkg_names,
            .string_buf = l_string_buf,
        },
        EqlSorter.isLessThan,
    );

    std.sort.pdq(
        EqlSorter.PathToId,
        r_buf,
        EqlSorter{
            .pkg_names = r_pkg_names,
            .string_buf = r_string_buf,
        },
        EqlSorter.isLessThan,
    );

    const l_pkg_name_hashes = l_pkgs.items(.name_hash);
    const l_pkg_resolutions = l_pkgs.items(.resolution);
    const l_pkg_bins = l_pkgs.items(.bin);
    const l_pkg_scripts = l_pkgs.items(.scripts);
    const r_pkg_name_hashes = r_pkgs.items(.name_hash);
    const r_pkg_resolutions = r_pkgs.items(.resolution);
    const r_pkg_bins = r_pkgs.items(.bin);
    const r_pkg_scripts = r_pkgs.items(.scripts);

    const l_extern_strings = l.buffers.extern_strings.items;
    const r_extern_strings = r.buffers.extern_strings.items;

    for (l_buf, r_buf) |l_ids, r_ids| {
        const l_pkg_id = l_ids.pkg_id;
        const r_pkg_id = r_ids.pkg_id;
        if (l_pkg_name_hashes[l_pkg_id] != r_pkg_name_hashes[r_pkg_id]) {
            return false;
        }
        const l_res = l_pkg_resolutions[l_pkg_id];
        const r_res = r_pkg_resolutions[r_pkg_id];

        if (l_res.tag == .uninitialized or r_res.tag == .uninitialized) {
            if (l_res.tag != r_res.tag) {
                return false;
            }
        } else if (!l_res.eql(&r_res, l_string_buf, r_string_buf)) {
            return false;
        }

        if (!l_pkg_bins[l_pkg_id].eql(
            &r_pkg_bins[r_pkg_id],
            l_string_buf,
            l_extern_strings,
            r_string_buf,
            r_extern_strings,
        )) {
            return false;
        }

        if (!l_pkg_scripts[l_pkg_id].eql(&r_pkg_scripts[r_pkg_id], l_string_buf, r_string_buf)) {
            return false;
        }
    }

    return true;
}

pub fn hasMetaHashChanged(this: *Lockfile, print_name_version_string: bool, packages_len: usize) !bool {
    const previous_meta_hash = this.meta_hash;
    this.meta_hash = try this.generateMetaHash(print_name_version_string, packages_len);
    return !strings.eqlLong(&previous_meta_hash, &this.meta_hash, false);
}
pub fn generateMetaHash(this: *Lockfile, print_name_version_string: bool, packages_len: usize) !MetaHash {
    if (packages_len <= 1)
        return zero_hash;

    var string_builder = GlobalStringBuilder{};
    defer string_builder.deinit(this.allocator);
    const names: []const String = this.packages.items(.name)[0..packages_len];
    const resolutions: []const Resolution = this.packages.items(.resolution)[0..packages_len];
    const bytes = this.buffers.string_bytes.items;
    var alphabetized_names = try this.allocator.alloc(PackageID, packages_len -| 1);
    defer this.allocator.free(alphabetized_names);

    const hash_prefix = "\n-- BEGIN SHA512/256(`${alphabetize(name)}@${order(version)}`) --\n";
    const hash_suffix = "-- END HASH--\n";
    string_builder.cap += hash_prefix.len + hash_suffix.len;
    {
        var i: usize = 1;

        while (i + 16 < packages_len) : (i += 16) {
            comptime var j: usize = 0;
            inline while (j < 16) : (j += 1) {
                alphabetized_names[(i + j) - 1] = @as(PackageID, @truncate((i + j)));
                // posix path separators because we only use posix in the lockfile
                string_builder.fmtCount("{s}@{}\n", .{ names[i + j].slice(bytes), resolutions[i + j].fmt(bytes, .posix) });
            }
        }

        while (i < packages_len) : (i += 1) {
            alphabetized_names[i - 1] = @as(PackageID, @truncate(i));
            // posix path separators because we only use posix in the lockfile
            string_builder.fmtCount("{s}@{}\n", .{ names[i].slice(bytes), resolutions[i].fmt(bytes, .posix) });
        }
    }

    const scripts_begin = "\n-- BEGIN SCRIPTS --\n";
    const scripts_end = "\n-- END SCRIPTS --\n";
    var has_scripts = false;

    inline for (comptime std.meta.fieldNames(Lockfile.Scripts)) |field_name| {
        const scripts = @field(this.scripts, field_name);
        for (scripts.items) |script| {
            if (script.script.len > 0) {
                string_builder.fmtCount("{s}: {s}\n", .{ field_name, script.script });
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
        _ = string_builder.fmt("{s}@{}\n", .{ names[i].slice(bytes), resolutions[i].fmt(bytes, .any) });
    }

    if (has_scripts) {
        _ = string_builder.append(scripts_begin);
        inline for (comptime std.meta.fieldNames(Lockfile.Scripts)) |field_name| {
            const scripts = @field(this.scripts, field_name);
            for (scripts.items) |script| {
                if (script.script.len > 0) {
                    _ = string_builder.fmt("{s}: {s}\n", .{ field_name, script.script });
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

pub fn resolvePackageFromNameAndVersion(this: *Lockfile, package_name: []const u8, version: Dependency.Version) ?PackageID {
    const name_hash = String.Builder.stringHash(package_name);
    const entry = this.package_index.get(name_hash) orelse return null;
    const buf = this.buffers.string_bytes.items;

    switch (version.tag) {
        .npm => switch (entry) {
            .id => |id| {
                const resolutions = this.packages.items(.resolution);

                if (comptime Environment.allow_assert) assert(id < resolutions.len);
                if (version.value.npm.version.satisfies(resolutions[id].value.npm.version, buf, buf)) {
                    return id;
                }
            },
            .ids => |ids| {
                const resolutions = this.packages.items(.resolution);

                for (ids.items) |id| {
                    if (comptime Environment.allow_assert) assert(id < resolutions.len);
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

const max_default_trusted_dependencies = 512;

// TODO
pub const default_trusted_dependencies_list: []const []const u8 = brk: {
    // This file contains a list of dependencies that Bun runs `postinstall` on by default.
    const data = @embedFile("./default-trusted-dependencies.txt");
    @setEvalBranchQuota(999999);
    var buf: [max_default_trusted_dependencies][]const u8 = undefined;
    var i: usize = 0;
    var iter = std.mem.tokenizeAny(u8, data, " \r\n\t");
    while (iter.next()) |package_ptr| {
        const package = package_ptr[0..].*;
        buf[i] = &package;
        i += 1;
    }

    const Sorter = struct {
        pub fn lessThan(_: void, lhs: []const u8, rhs: []const u8) bool {
            return std.mem.order(u8, lhs, rhs) == .lt;
        }
    };

    // alphabetical so we don't need to sort in `bun pm trusted --default`
    std.sort.pdq([]const u8, buf[0..i], {}, Sorter.lessThan);

    var names: [i][]const u8 = undefined;
    @memcpy(names[0..i], buf[0..i]);
    const final = names;
    break :brk &final;
};

/// The default list of trusted dependencies is a static hashmap
const default_trusted_dependencies = brk: {
    const StringHashContext = struct {
        pub fn hash(_: @This(), s: []const u8) u64 {
            @setEvalBranchQuota(999999);
            // truncate to u32 because Lockfile.trustedDependencies uses the same u32 string hash
            return @intCast(@as(u32, @truncate(String.Builder.stringHash(s))));
        }
        pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
            @setEvalBranchQuota(999999);
            return std.mem.eql(u8, a, b);
        }
    };

    var map: StaticHashMap([]const u8, void, StringHashContext, max_default_trusted_dependencies) = .{};

    for (default_trusted_dependencies_list) |dep| {
        if (map.len == max_default_trusted_dependencies) {
            @compileError("default-trusted-dependencies.txt is too large, please increase 'max_default_trusted_dependencies' in lockfile.zig");
        }

        // just in case there's duplicates from truncating
        if (map.has(dep)) @compileError("Duplicate hash due to u64 -> u32 truncation");

        map.putAssumeCapacity(dep, {});
    }

    const final = map;
    break :brk &final;
};

pub fn hasTrustedDependency(this: *Lockfile, name: []const u8) bool {
    if (this.trusted_dependencies) |trusted_dependencies| {
        const hash = @as(u32, @truncate(String.Builder.stringHash(name)));
        return trusted_dependencies.contains(hash);
    }

    return default_trusted_dependencies.has(name);
}

pub fn jsonStringifyDependency(this: *const Lockfile, w: anytype, dep_id: DependencyID, dep: Dependency, res: PackageID) !void {
    const sb = this.buffers.string_bytes.items;

    try w.beginObject();
    defer w.endObject() catch {};

    try w.objectField("name");
    try w.write(dep.name.slice(sb));

    if (dep.version.tag == .npm and dep.version.value.npm.is_alias) {
        try w.objectField("is_alias");
        try w.write(true);
    }

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
            try w.print("\"{}\"", .{info.version.fmt(sb)});
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

    try w.objectField("package_id");
    try w.write(if (res == invalid_package_id) null else res);

    try w.objectField("behavior");
    {
        try w.beginObject();
        defer w.endObject() catch {};

        const fields = @typeInfo(Behavior).Struct.fields;
        inline for (fields[1 .. fields.len - 1]) |field| {
            if (@field(dep.behavior, field.name)) {
                try w.objectField(field.name);
                try w.write(true);
            }
        }
    }

    try w.objectField("id");
    try w.write(dep_id);
}

pub fn jsonStringify(this: *const Lockfile, w: anytype) !void {
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
                .id => |id| id,
                .ids => |ids| ids.items[0],
            };
            const name = this.packages.items(.name)[first_id].slice(sb);
            try w.objectField(name);
            switch (entry) {
                .id => |id| try w.write(id),
                .ids => |ids| {
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
        try w.objectField("trees");
        try w.beginArray();
        defer w.endArray() catch {};

        const dependencies = this.buffers.dependencies.items;
        const hoisted_deps = this.buffers.hoisted_dependencies.items;
        const resolutions = this.buffers.resolutions.items;
        var depth_buf: Tree.DepthBuf = undefined;
        var path_buf: bun.PathBuffer = undefined;
        @memcpy(path_buf[0.."node_modules".len], "node_modules");

        for (0..this.buffers.trees.items.len) |tree_id| {
            try w.beginObject();
            defer w.endObject() catch {};

            const tree = this.buffers.trees.items[tree_id];

            try w.objectField("id");
            try w.write(tree_id);

            const relative_path, const depth = Lockfile.Tree.relativePathAndDepth(
                this,
                @intCast(tree_id),
                &path_buf,
                &depth_buf,
                .node_modules,
            );

            try w.objectField("path");
            try w.print("\"{}\"", .{bun.fmt.fmtPath(u8, relative_path, .{ .path_sep = .posix })});

            try w.objectField("depth");
            try w.write(depth);

            try w.objectField("dependencies");
            {
                try w.beginObject();
                defer w.endObject() catch {};

                for (tree.dependencies.get(hoisted_deps)) |tree_dep_id| {
                    const dep = dependencies[tree_dep_id];
                    const package_id = resolutions[tree_dep_id];

                    try w.objectField(dep.name.slice(sb));
                    {
                        try w.beginObject();
                        defer w.endObject() catch {};

                        try w.objectField("id");
                        try w.write(tree_dep_id);

                        try w.objectField("package_id");
                        try w.write(package_id);
                    }
                }
            }
        }
    }

    {
        try w.objectField("dependencies");
        try w.beginArray();
        defer w.endArray() catch {};

        const dependencies = this.buffers.dependencies.items;
        const resolutions = this.buffers.resolutions.items;

        for (0..dependencies.len) |dep_id| {
            const dep = dependencies[dep_id];
            const res = resolutions[dep_id];
            try this.jsonStringifyDependency(w, @intCast(dep_id), dep, res);
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
            {
                const res = pkg.resolution;
                try w.beginObject();
                defer w.endObject() catch {};

                try w.objectField("tag");
                try w.write(@tagName(res.tag));

                try w.objectField("value");
                try w.print("\"{s}\"", .{res.fmt(sb, .posix)});

                try w.objectField("resolved");
                try w.print("\"{}\"", .{res.fmtURL(sb)});
            }

            try w.objectField("dependencies");
            {
                try w.beginArray();
                defer w.endArray() catch {};

                for (pkg.dependencies.off..pkg.dependencies.off + pkg.dependencies.len) |dep_id| {
                    try w.write(dep_id);
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
                try w.print("\"{}\"", .{pkg.meta.integrity});
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

    var buf: [100]u8 = undefined;

    try w.objectField("workspace_paths");
    {
        try w.beginObject();
        defer w.endObject() catch {};

        for (this.workspace_paths.keys(), this.workspace_paths.values()) |k, v| {
            try w.objectField(std.fmt.bufPrintIntToSlice(&buf, k, 10, .lower, .{}));
            try w.write(v.slice(sb));
        }
    }
    try w.objectField("workspace_versions");
    {
        try w.beginObject();
        defer w.endObject() catch {};

        for (this.workspace_versions.keys(), this.workspace_versions.values()) |k, v| {
            try w.objectField(std.fmt.bufPrintIntToSlice(&buf, k, 10, .lower, .{}));
            try w.print("\"{}\"", .{v.fmt(sb)});
        }
    }
}

const assert = bun.assert;
