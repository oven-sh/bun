usingnamespace @import("../global.zig");
const std = @import("std");

const JSLexer = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const JSAst = @import("../js_ast.zig");
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
const HTTPClient = @import("../http_client.zig");
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const Lock = @import("../lock.zig").Lock;
var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
var path_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;
const URL = @import("../query_string_map.zig").URL;
const NetworkThread = @import("../http/network_thread.zig");
const AsyncHTTP = @import("../http/http_client_async.zig").AsyncHTTP;
const HTTPChannel = @import("../http/http_client_async.zig").HTTPChannel;
const Integrity = @import("./integrity.zig").Integrity;

threadlocal var initialized_store = false;

// these bytes are skipped
// so we just make it repeat bun bun bun bun bun bun bun bun bun
// because why not
const alignment_bytes_to_repeat = "bun";
const alignment_bytes_to_repeat_buffer = "bunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbunbun";

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

pub const URI = union(Tag) {
    local: String,
    remote: String,

    pub fn eql(lhs: URI, rhs: URI, lhs_buf: []const u8, rhs_buf: []const u8) bool {
        if (@as(Tag, lhs) != @as(Tag, rhs)) {
            return false;
        }

        if (@as(Tag, lhs) == .local) {
            return strings.eql(lhs.local.slice(lhs_buf), rhs.local.slice(rhs_buf));
        } else {
            return strings.eql(lhs.remote.slice(lhs_buf), rhs.remote.slice(rhs_buf));
        }
    }

    pub const Tag = enum {
        local,
        remote,
    };
};

const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const GlobalStringBuilder = @import("../string_builder.zig");
const SlicedString = Semver.SlicedString;

const StructBuilder = @import("../builder.zig");
const ExternalStringBuilder = StructBuilder.Builder(ExternalString);

const SmallExternalStringList = ExternalSlice(String);

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
            return in[this.off..@minimum(in.len, this.off + this.len)];
        }

        pub inline fn mut(this: Slice, in: []Type) []Type {
            return in[this.off..@minimum(in.len, this.off + this.len)];
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

const PackageID = u32;
const DependencyID = u32;
const PackageIDMultiple = [*:invalid_package_id]PackageID;
const invalid_package_id = std.math.maxInt(PackageID);

const ExternalStringList = ExternalSlice(ExternalString);
const VersionSlice = ExternalSlice(Semver.Version);

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

const PackageNameHash = u64;

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
    },

    pub fn notify(http: *AsyncHTTP) void {
        PackageManager.instance.network_channel.writeItem(@fieldParentPtr(NetworkTask, "http", http)) catch {};
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

        var header_builder = HTTPClient.HeaderBuilder{};

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

        if (verbose_install) {
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
            allocator,
            tarball.registry,
            tarball.name,
            tarball.version,
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
    peer_dependencies: bool = false,
    is_main: bool = false,

    check_for_duplicate_dependencies: bool = false,

    pub const npm = Features{};
};

pub const PreinstallState = enum(u8) {
    unknown = 0,
    done = 1,
    extract = 2,
    extracting = 3,
};

/// Normalized `bin` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
/// Can be a:
/// - file path (relative to the package root)
/// - directory (relative to the package root)
/// - map where keys are names of the binaries and values are file paths to the binaries
pub const Bin = extern struct {
    tag: Tag = Tag.none,
    value: Value = Value{ .none = .{} },

    pub const Value = extern union {
        /// no "bin", or empty "bin"
        none: void,

        /// "bin" is a string
        /// ```
        /// "bin": "./bin/foo",
        /// ```
        file: String,

        // Single-entry map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        /// }
        ///```
        named_file: [2]String,

        /// "bin" is a directory
        ///```
        /// "dirs": {
        ///     "bin": "./bin",
        /// }
        ///```
        dir: String,
        // "bin" is a map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        ///     "babel-cli": "./cli.js",
        /// }
        ///```
        map: ExternalStringList,
    };

    pub const Tag = enum(u8) {
        /// no bin field
        none = 0,
        /// "bin" is a string
        /// ```
        /// "bin": "./bin/foo",
        /// ```
        file = 1,

        // Single-entry map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        /// }
        ///```
        named_file = 2,
        /// "bin" is a directory
        ///```
        /// "dirs": {
        ///     "bin": "./bin",
        /// }
        ///```
        dir = 3,
        // "bin" is a map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        ///     "babel-cli": "./cli.js",
        /// }
        ///```
        map = 4,
    };
};

const Lockfile = struct {

    // Serialized data
    /// The version of the lockfile format, intended to prevent data corruption for format changes.
    format: FormatVersion = .v0,

    /// 
    packages: Lockfile.Package.List = Lockfile.Package.List{},
    buffers: Buffers = Buffers{},

    /// name -> PackageID || [*]PackageID
    /// Not for iterating.
    package_index: PackageIndex.Map,
    duplicates: std.DynamicBitSetUnmanaged,
    string_pool: StringPool,
    allocator: *std.mem.Allocator,
    scratch: Scratch = Scratch{},

    const Stream = std.io.FixedBufferStream([]u8);
    pub const default_filename = "bun.lockb";

    pub const LoadFromDiskResult = union(Tag) {
        not_found: void,
        invalid_format: void,
        err: struct {
            step: Step,
            value: anyerror,
        },
        ok: Lockfile,

        pub const Step = enum { open_file, read_file, parse_file };

        pub const Tag = enum {
            not_found,
            invalid_format,
            err,
            ok,
        };
    };

    pub fn loadFromDisk(allocator: *std.mem.Allocator, log: *logger.Log, filename: stringZ) LoadFromDiskResult {
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
        var lockfile: Lockfile = undefined;
        var stream = Stream{ .buffer = buf, .pos = 0 };
        Lockfile.Serializer.load(&lockfile, &stream, allocator, log) catch |err| {
            return LoadFromDiskResult{ .err = .{ .step = .parse_file, .value = err } };
        };

        return LoadFromDiskResult{ .ok = lockfile };
    }

    pub const TreePrinter = struct {
        lockfile: *Lockfile,
        indent: usize = 0,
        visited: std.DynamicBitSetUnmanaged,

        pub fn print(this: *TreePrinter) !void {
            var slice = this.lockfile.packages.slice();
            var names = slice.items(.name);
            var versions = slice.items(.name);
            // var fifo = std.fifo.LinearFif
        }
    };

    /// Do a pass over the current lockfile:
    /// 1. Prune dead packages & dead data by visiting all dependencies, starting with the root package
    /// 2. When there are multiple versions of the same package, 
    ///    see if any version we've already downloaded fits all the constraints so that we can avoid installing duplicates
    /// 3. Create a "plan" for installing the packages
    /// 4. Regenerate the lockfile with the updated tree
    pub fn clean(this: *Lockfile) !void {
        var old = this.*;
        var new: Lockfile = undefined;
        try new.initEmpty(
            old.allocator,
        );
        try new.string_pool.ensureTotalCapacity(old.string_pool.capacity());
        try new.package_index.ensureTotalCapacity(old.package_index.capacity());
        try new.packages.ensureTotalCapacity(old.allocator, old.packages.len);
        try new.buffers.preallocate(old.buffers, old.allocator);
    }

    const PackageIDFifo = std.fifo.LinearFifo(PackageID, .Dynamic);

    const CleanVisitor = struct {
        visited: std.DynamicBitSetUnmanaged,
        sorted_ids: std.ArrayListUnmanaged(PackageID),
        queue: PackageIDFifo,
        new: *Lockfile,
        old: *Lockfile,
        depth: usize = 0,
        allocator: *std.mem.Allocator,
        slice: Lockfile.Package.List.Slice,

        log: *logger.Log,

        pub fn run(old: *Lockfile, new: *Lockfile, log: *logger.Log) !void {
            var visitor = CleanVisitor{
                .visited = try std.DynamicBitSetUnmanaged.initEmpty(old.packages.len, old.allocator),
                .sorted_ids = std.ArrayListUnmanaged(PackageID){},
                .queue = PackageIDFifo.init(old.allcoator),
                .new = new,
                .allocator = old.allocator,
                .old = old,
                .slice = old.packages.slice(),
                .log = log,
            };

            try visitor.visit(0);
            while (visitor.queue.readItem()) |package_id| {
                try visitor.visit(package_id);
            }
        }

        pub fn visit(this: *CleanVisitor, package_id: PackageID) !void {
            const dependency_list = this.slice.items(.dependencies)[package_id];
            const resolution_list = this.slice.items(.resolutions)[package_id];
            const dependencies: []const Dependency = dependency_list.get(this.old.buffers.dependencies.items);
            const resolutions: []const PackageID = resolution_list.get(this.old.buffers.resolutions.items);

            this.sorted_ids.appendAssumeCapacity(package_id);
            this.visited.set(package_id);
            var new = this.new;
            const max_package = this.old.packages.len;
            for (resolutions) |resolution, i| {
                if (resolution >= max_package) {
                    continue;
                }

                const dependency = dependencies[i];
                // dependency.clone(from: *Lockfile, to: *Lockfile)
            }
        }
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
            .duplicates = try std.DynamicBitSetUnmanaged.initEmpty(0, allocator),
            .string_pool = StringPool.init(allocator),
            .allocator = allocator,
            .scratch = Scratch.init(allocator),
        };
    }

    /// Update the lockfile to reflect the desired state of the dependency graph.
    pub fn applyDiff(this: *Lockfile, queue: *Lockfile.Package.Diff.List, diff: Lockfile.Package.Diff) void {
        switch (diff) {
            .add => |add| {},
            .remove => |remove| {},
            .update => |update| {},
        }
    }

    pub fn getPackageID(this: *Lockfile, name_hash: u64, version: Semver.Version) ?PackageID {
        const entry = this.package_index.get(name_hash) orelse return null;
        const versions = this.packages.items(.version);
        switch (entry) {
            .PackageID => |id| {
                if (comptime Environment.isDebug or Environment.isTest) {
                    std.debug.assert(id != invalid_package_id);
                    std.debug.assert(id != invalid_package_id - 1);
                }

                if (versions[id].eql(version)) {
                    return id;
                }
            },
            .PackageIDMultiple => |multi_| {
                const multi = std.mem.span(multi_);
                for (multi) |id| {
                    if (comptime Environment.isDebug or Environment.isTest) {
                        std.debug.assert(id != invalid_package_id);
                    }

                    if (id == invalid_package_id - 1) return null;

                    if (versions[id].eql(version)) {
                        return id;
                    }
                }
            },
        }

        return null;
    }

    pub fn getOrPutID(this: *Lockfile, id: PackageID, name_hash: PackageNameHash) !void {
        if (this.duplicates.capacity() < this.packages.len) try this.duplicates.resize(this.packages.len, false, this.allocator);
        var gpe = try this.package_index.getOrPut(name_hash);

        if (gpe.found_existing) {
            var index: *PackageIndex.Entry = gpe.value_ptr;

            this.duplicates.set(id);

            switch (index.*) {
                .PackageID => |single_| {
                    var ids = try this.allocator.alloc(PackageID, 8);
                    ids[0] = single_;
                    ids[1] = id;
                    this.duplicates.set(single_);
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
        }
    }

    pub fn appendPackage(this: *Lockfile, package_: Lockfile.Package) !Lockfile.Package {
        const id = @truncate(u32, this.packages.len);
        defer {
            if (comptime Environment.isDebug) {
                std.debug.assert(this.getPackageID(package_.name_hash, package_.version) != null);
                std.debug.assert(this.getPackageID(package_.name_hash, package_.version).? == id);
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
        pub const NetworkQueue = std.fifo.LinearFifo(*NetworkTask, .Dynamic);
        duplicate_checker_map: DuplicateCheckerMap = undefined,
        dependency_list_queue: DependencyQueue = undefined,
        network_task_queue: NetworkQueue = undefined,

        pub fn init(allocator: *std.mem.Allocator) Scratch {
            return Scratch{
                .dependency_list_queue = DependencyQueue.init(allocator),
                .network_task_queue = NetworkQueue.init(allocator),
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

    const DependencySlice = ExternalSlice(Dependency);
    const PackageIDSlice = ExternalSlice(PackageID);
    const PackageIDList = std.ArrayListUnmanaged(PackageID);
    const DependencyList = std.ArrayListUnmanaged(Dependency);
    const StringBuffer = std.ArrayListUnmanaged(u8);
    const SmallExternalStringBuffer = std.ArrayListUnmanaged(String);

    pub const Package = extern struct {
        const Version = Dependency.Version;
        const DependencyGroup = struct {
            prop: string,
            field: string,
            behavior: Behavior,

            pub const dependencies = DependencyGroup{ .prop = "dependencies", .field = "dependencies", .behavior = @intToEnum(Behavior, Behavior.normal) };
            pub const dev = DependencyGroup{ .prop = "devDependencies", .field = "dev_dependencies", .behavior = @intToEnum(Behavior, Behavior.dev) };
            pub const optional = DependencyGroup{ .prop = "optionalDependencies", .field = "optional_dependencies", .behavior = @intToEnum(Behavior, Behavior.optional) };
            pub const peer = DependencyGroup{ .prop = "peerDependencies", .field = "peer_dependencies", .behavior = @intToEnum(Behavior, Behavior.peer) };
        };

        pub fn isDisabled(this: *const Lockfile.Package) bool {
            return !this.meta.arch.isMatch() or !this.meta.os.isMatch();
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
                    1 +
                        @as(usize, @boolToInt(features.dev_dependencies)) +
                        @as(usize, @boolToInt(features.optional_dependencies)) +
                        @as(usize, @boolToInt(features.peer_dependencies))
                ]DependencyGroup = undefined;
                var out_group_i: usize = 0;

                out_groups[out_group_i] = DependencyGroup.dependencies;
                out_group_i += 1;

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
            }

            try string_builder.allocate();
            var dependencies_list = &lockfile.buffers.dependencies;
            var resolutions_list = &lockfile.buffers.resolutions;
            try dependencies_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);
            try resolutions_list.ensureUnusedCapacity(lockfile.allocator, total_dependencies_count);

            // -- Cloning
            {
                const package_name: ExternalString = string_builder.appendWithHash(ExternalString, manifest.name(), manifest.pkg.name.hash);
                package.name_hash = package_name.hash;
                package.name = package_name.value;
                package.version = version.clone(manifest.string_buf, @TypeOf(&string_builder), &string_builder);

                const total_len = dependencies_list.items.len + total_dependencies_count;
                std.debug.assert(dependencies_list.items.len == resolutions_list.items.len);

                var dependencies = dependencies_list.items.ptr[dependencies_list.items.len..total_len];

                const off = @truncate(u32, dependencies_list.items.len);

                inline for (dependency_groups) |group| {
                    const map: ExternalStringMap = @field(package_version, group.field);
                    const keys = map.name.get(manifest.external_strings);
                    const version_strings = map.value.get(manifest.external_strings_for_versions);

                    if (comptime Environment.isDebug) std.debug.assert(keys.len == version_strings.len);

                    for (keys) |key, i| {
                        const version_string_ = version_strings[i];
                        const name: ExternalString = string_builder.appendWithHash(ExternalString, key.slice(string_buf), key.hash);
                        const dep_version = string_builder.appendWithHash(String, version_string_.slice(string_buf), version_string_.hash);
                        const sliced = dep_version.sliced(lockfile.buffers.string_bytes.items);
                        const dependency = Dependency{
                            .name = name.value,
                            .name_hash = name.hash,
                            .behavior = group.behavior,
                            .version = Dependency.parse(
                                allocator,
                                sliced.slice,
                                &sliced,
                                log,
                            ) orelse Dependency.Version{},
                        };

                        package.meta.npm_dependency_count += @as(u32, @boolToInt(dependency.version.tag.isNPM()));

                        dependencies[0] = dependency;
                        dependencies = dependencies[1..];
                    }
                }

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

        pub const Diff = union(Op) {
            add: Lockfile.Package.Diff.Entry,
            remove: Lockfile.Package.Diff.Entry,
            update: struct { in: PackageID, from: Dependency, to: Dependency, from_resolution: PackageID, to_resolution: PackageID },

            pub const Entry = struct { in: PackageID, dependency: Dependency, resolution: PackageID };
            pub const Op = enum {
                add,
                remove,
                update,
            };

            pub const List = std.fifo.LinearFifo(Diff, .Dynamic);

            pub const Summary = struct {
                add: u32 = 0,
                remove: u32 = 0,
                update: u32 = 0,

                pub inline fn sum(this: *Summary, that: Summary) void {
                    this.add += that.add;
                    this.remove += that.remove;
                    this.update += that.update;
                }
            };

            pub fn generate(
                allocator: *std.mem.Allocator,
                fifo: *Lockfile.Package.Diff.List,
                from_lockfile: *Lockfile,
                to_lockfile: *Lockfile,
                from: *Lockfile.Package,
                to: *Lockfile.Package,
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
                        try fifo.writeItem(
                            .{
                                .remove = .{
                                    .dependency = from_dep,
                                    .resolution = from_res[i],
                                    .in = from.meta.id,
                                },
                            },
                        );
                        summary.remove += 1;
                        continue;
                    };

                    if (to_deps[to_i].eql(from_dep, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items)) {
                        continue;
                    }

                    // We found a changed dependency!
                    try fifo.writeItem(
                        .{
                            .update = .{
                                .from = from_dep,
                                .to = to_deps[to_i],
                                .from_resolution = from_res[i],
                                .to_resolution = to_res[to_i],
                                .in = from.meta.id,
                            },
                        },
                    );
                    summary.update += 1;
                }

                outer: for (to_deps) |to_dep, i| {
                    if (from_deps.len > i and from_deps[i].name_hash == to_dep.name_hash) continue;

                    for (from_deps) |from_dep, j| {
                        if (from_dep.name_hash == to_dep.name_hash) continue :outer;
                    }

                    // We found a new dependency!
                    try fifo.writeItem(
                        .{
                            .add = .{
                                .dependency = to_dep,
                                .resolution = to_res[i],
                                .in = from.meta.id,
                            },
                        },
                    );
                    summary.add += 1;
                }

                return summary;
            }
        };

        pub fn determinePreinstallState(this: *Lockfile.Package, lockfile: *Lockfile, manager: *PackageManager) PreinstallState {
            switch (this.meta.preinstall_state) {
                .unknown => {
                    const folder_path = PackageManager.cachedNPMPackageFolderName(this.name.slice(lockfile.buffers.string_bytes.items), this.version);
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

        pub fn parse(
            lockfile: *Lockfile,
            package: *Lockfile.Package,
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            source: logger.Source,
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

            const dependency_groups = comptime brk: {
                var out_groups: [
                    1 +
                        @as(usize, @boolToInt(features.dev_dependencies)) +
                        @as(usize, @boolToInt(features.optional_dependencies)) +
                        @as(usize, @boolToInt(features.peer_dependencies))
                ]DependencyGroup = undefined;
                var out_group_i: usize = 0;

                out_groups[out_group_i] = DependencyGroup.dependencies;
                out_group_i += 1;

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
                if (json.asProperty("version")) |version_q| {
                    if (version_q.expr.asString(allocator)) |version_str_| {
                        const version_str: String = string_builder.append(String, version_str_);
                        const sliced_string: SlicedString = version_str.sliced(string_buf.allocatedSlice());

                        const semver_version = Semver.Version.parse(sliced_string, allocator);

                        if (semver_version.valid) {
                            package.version = semver_version.version;
                        } else {
                            log.addErrorFmt(null, logger.Loc.Empty, allocator, "invalid version \"{s}\"", .{version_str}) catch unreachable;
                        }
                    }
                }
            }

            if (comptime features.check_for_duplicate_dependencies) {
                lockfile.scratch.duplicate_checker_map.clearRetainingCapacity();
                try lockfile.scratch.duplicate_checker_map.ensureTotalCapacity(total_dependencies_count);
            }

            inline for (dependency_groups) |group| {
                if (json.asProperty(group.prop)) |dependencies_q| {
                    if (dependencies_q.expr.data == .e_object) {
                        for (dependencies_q.expr.data.e_object.properties) |item| {
                            const name_ = item.key.?.asString(allocator) orelse "";
                            const version_ = item.value.?.asString(allocator) orelse "";

                            const external_name = string_builder.append(ExternalString, name_);

                            if (comptime features.check_for_duplicate_dependencies) {
                                var entry = lockfile.scratch.duplicate_checker_map.getOrPutAssumeCapacity(external_name.hash);
                                if (entry.found_existing) {
                                    var notes = try allocator.alloc(logger.Data, 1);
                                    notes[0] = logger.Data{
                                        .text = try std.fmt.allocPrint(lockfile.allocator, "\"{s}\" was originally specified here", .{name_}),
                                        .location = logger.Location.init_or_nil(&source, source.rangeOfString(entry.value_ptr.*)),
                                    };

                                    try log.addRangeErrorFmtWithNotes(
                                        &source,
                                        source.rangeOfString(item.key.?.loc),
                                        lockfile.allocator,
                                        notes,
                                        "Duplicate dependency: \"{s}\"",
                                        .{name_},
                                    );
                                }

                                entry.value_ptr.* = dependencies_q.loc;
                            }

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
                            dependencies[0] = Dependency{
                                .behavior = group.behavior,
                                .name = external_name.value,
                                .name_hash = external_name.hash,
                                .version = dependency_version,
                            };
                            package.meta.npm_dependency_count += @as(u32, @boolToInt(dependency_version.tag.isNPM()));
                            dependencies = dependencies[1..];
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
            bin: Bin = Bin{},
        };

        name: String = String{},
        name_hash: PackageNameHash = 0,
        version: Semver.Version = Semver.Version{},
        dependencies: DependencySlice = DependencySlice{},
        resolutions: PackageIDSlice = PackageIDSlice{},
        meta: Meta = Meta{},

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
        sorted_ids: PackageIDList = PackageIDList{},
        resolutions: PackageIDList = PackageIDList{},
        dependencies: DependencyList = DependencyList{},
        extern_strings: SmallExternalStringBuffer = SmallExternalStringBuffer{},
        string_bytes: StringBuffer = StringBuffer{},

        pub fn preallocate(this: *Buffers, that: Buffers, allocator: *std.mem.Allocator) !void {
            try this.sorted_ids.ensureTotalCapacity(allocator, that.sorted_ids.items.len);
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

            stream.pos += Aligner.skipAmount(PointerType, stream.pos);
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
                    .field_type = field_info.field_type,
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
                _ = try Aligner.write(std.meta.Child(ArrayList), Writer, writer, try stream.getPos());

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
                    Output.prettyErrorln("Field {s}: {d} - {d}", .{ name, pos, try stream.getPos() });
                }
            }
        }

        pub fn load(stream: *Stream, allocator: *std.mem.Allocator, log: *logger.Log) !Buffers {
            var this = Buffers{};
            var external_dependency_list: []Dependency.External = &[_]Dependency.External{};
            inline for (sizes.types) |Type, i| {
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
                    Output.prettyErrorln("Field {s}: {d} - {d}", .{ sizes.names[i], pos, try stream.getPos() });
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

            {
                lockfile.package_index = PackageIndex.Map.initContext(allocator, .{});
                lockfile.duplicates = try std.DynamicBitSetUnmanaged.initEmpty(lockfile.packages.len, allocator);
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

pub const Behavior = enum(u8) {
    uninitialized = 0,
    _,

    pub const normal: u8 = 1 << 1;
    pub const optional: u8 = 1 << 2;
    pub const dev: u8 = 1 << 3;
    pub const peer: u8 = 1 << 4;

    pub inline fn isOptional(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.optional) != 0;
    }

    pub inline fn isDev(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.dev) != 0;
    }

    pub inline fn isPeer(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.peer) != 0;
    }

    pub inline fn isNormal(this: Behavior) bool {
        return (@enumToInt(this) & Behavior.normal) != 0;
    }

    pub inline fn cmp(lhs: Behavior, rhs: Behavior) std.math.Order {
        if (@enumToInt(lhs) == @enumToInt(rhs)) {
            return .eq;
        }

        if (lhs.isNormal() != rhs.isNormal()) {
            return if (lhs.isNormal())
                .gt
            else
                .lt;
        }

        if (lhs.isDev() != rhs.isDev()) {
            return if (lhs.isDev())
                .gt
            else
                .lt;
        }

        if (lhs.isOptional() != rhs.isOptional()) {
            return if (lhs.isOptional())
                .gt
            else
                .lt;
        }

        if (lhs.isPeer() != rhs.isPeer()) {
            return if (lhs.isPeer())
                .gt
            else
                .lt;
        }

        return .eq;
    }

    pub inline fn isRequired(this: Behavior) bool {
        return !isOptional(this);
    }

    pub fn isEnabled(this: Behavior, features: Features) bool {
        return this.isNormal() or
            (features.dev_dependencies and this.isDev()) or
            (features.peer_dependencies and this.isPeer()) or
            (features.optional_dependencies and this.isOptional());
    }
};

pub const Dependency = struct {
    name_hash: PackageNameHash = 0,
    name: String = String{},
    version: Dependency.Version = Dependency.Version{},

    /// This is how the dependency is specified in the package.json file.
    /// This allows us to track whether a package originated in any permutation of:
    /// - `dependencies`
    /// - `devDependencies`
    /// - `optionalDependencies`
    /// - `peerDependencies`
    /// Technically, having the same package name specified under multiple fields is invalid
    /// But we don't want to allocate extra arrays for them. So we use a bitfield instead.
    behavior: Behavior = Behavior.uninitialized,

    /// Sorting order for dependencies is:
    /// 1. [`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`]
    /// 2. name
    pub fn isLessThan(string_buf: []const u8, lhs: Dependency, rhs: Dependency) bool {
        const behavior = lhs.behavior.cmp(rhs.behavior);
        if (behavior != .eq) {
            return behavior == .lt;
        }

        const lhs_name = lhs.name.slice(string_buf);
        const rhs_name = rhs.name.slice(string_buf);
        return strings.cmpStringsDesc(void{}, lhs_name, rhs_name);
    }

    pub fn clone(this: Dependency, from: *Lockfile, to: *Lockfile) Dependency {
        return Dependency{
            .name_hash = this.name_hash,
            .name = from.str(this.name),
            .version = this.version,
            .behavior = this.behavior,
        };
    }

    pub const External = extern struct {
        name: String = String{},
        name_hash: PackageNameHash = 0,
        behavior: Behavior = Behavior.uninitialized,
        version: Dependency.Version.External,

        pub const Context = struct {
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            buffer: []const u8,
        };

        pub fn toDependency(
            this: Dependency.External,
            ctx: Context,
        ) Dependency {
            return Dependency{
                .name = this.name,
                .name_hash = this.name_hash,
                .behavior = this.behavior,
                .version = this.version.toVersion(ctx),
            };
        }
    };

    pub fn toExternal(this: Dependency) External {
        return External{
            .name = this.name,
            .name_hash = this.name_hash,
            .behavior = this.behavior,
            .version = this.version.toExternal(),
        };
    }

    pub const Version = struct {
        tag: Dependency.Version.Tag = Dependency.Version.Tag.uninitialized,
        literal: String = String{},
        value: Value = Value{ .uninitialized = void{} },

        pub const External = extern struct {
            tag: Dependency.Version.Tag,
            literal: String,

            pub fn toVersion(
                this: Version.External,
                ctx: Dependency.External.Context,
            ) Dependency.Version {
                const sliced = &this.literal.sliced(ctx.buffer);
                return Dependency.parseWithTag(
                    ctx.allocator,
                    sliced.slice,
                    this.tag,
                    sliced,
                    ctx.log,
                ) orelse Dependency.Version{};
            }
        };

        pub inline fn toExternal(this: Version) Version.External {
            return Version.External{
                .tag = this.tag,
                .literal = this.literal,
            };
        }

        pub inline fn eql(
            lhs: Version,
            rhs: Version,
            lhs_buf: []const u8,
            rhs_buf: []const u8,
        ) bool {
            if (lhs.tag != rhs.tag) {
                return false;
            }

            return switch (lhs.tag) {
                // if the two versions are identical as strings, it should often be faster to compare that than the actual semver version
                // semver ranges involve a ton of pointer chasing
                .npm => strings.eql(lhs.literal.slice(lhs_buf), rhs.literal.slice(rhs_buf)) or
                    lhs.value.npm.eql(rhs.value.npm),
                .folder, .dist_tag => lhs.literal.eql(rhs.literal, lhs_buf, rhs_buf),
                .tarball => lhs.value.tarball.eql(rhs.value.tarball, lhs_buf, rhs_buf),
                else => true,
            };
        }

        pub const Tag = enum(u8) {
            uninitialized = 0,

            /// Semver range
            npm = 1,

            /// NPM dist tag, e.g. "latest"
            dist_tag = 2,

            /// URI to a .tgz or .tar.gz
            tarball = 3,

            /// Local folder
            folder = 4,

            /// TODO:
            symlink = 5,
            /// TODO:
            workspace = 6,
            /// TODO:
            git = 7,
            /// TODO:
            github = 8,

            pub inline fn isNPM(this: Tag) bool {
                return @enumToInt(this) < 3;
            }

            pub inline fn isGitHubRepoPath(dependency: string) bool {
                var slash_count: u8 = 0;

                for (dependency) |c| {
                    slash_count += @as(u8, @boolToInt(c == '/'));
                    if (slash_count > 1 or c == '#') break;

                    // Must be alphanumeric
                    switch (c) {
                        '\\', '/', 'a'...'z', 'A'...'Z', '0'...'9', '%' => {},
                        else => return false,
                    }
                }

                return (slash_count == 1);
            }

            // this won't work for query string params
            // i'll let someone file an issue before I add that
            pub inline fn isTarball(dependency: string) bool {
                return strings.endsWithComptime(dependency, ".tgz") or strings.endsWithComptime(dependency, ".tar.gz");
            }

            pub fn infer(dependency: string) Tag {
                switch (dependency[0]) {
                    // npm package
                    '=', '>', '<', '0'...'9', '^', '*', '~', '|' => return Tag.npm,

                    // MIGHT be semver, might not be.
                    'x', 'X' => {
                        if (dependency.len == 1) {
                            return Tag.npm;
                        }

                        if (dependency[1] == '.') {
                            return Tag.npm;
                        }

                        return .dist_tag;
                    },

                    // git://, git@, git+ssh
                    'g' => {
                        if (strings.eqlComptime(
                            dependency[0..@minimum("git://".len, dependency.len)],
                            "git://",
                        ) or strings.eqlComptime(
                            dependency[0..@minimum("git@".len, dependency.len)],
                            "git@",
                        ) or strings.eqlComptime(
                            dependency[0..@minimum("git+ssh".len, dependency.len)],
                            "git+ssh",
                        )) {
                            return .git;
                        }

                        if (strings.eqlComptime(
                            dependency[0..@minimum("github".len, dependency.len)],
                            "github",
                        ) or isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    '/' => {
                        if (isTarball(dependency)) {
                            return .tarball;
                        }

                        return .folder;
                    },

                    // https://, http://
                    'h' => {
                        if (isTarball(dependency)) {
                            return .tarball;
                        }

                        var remainder = dependency;
                        if (strings.eqlComptime(
                            remainder[0..@minimum("https://".len, remainder.len)],
                            "https://",
                        )) {
                            remainder = remainder["https://".len..];
                        }

                        if (strings.eqlComptime(
                            remainder[0..@minimum("http://".len, remainder.len)],
                            "http://",
                        )) {
                            remainder = remainder["http://".len..];
                        }

                        if (strings.eqlComptime(
                            remainder[0..@minimum("github".len, remainder.len)],
                            "github",
                        ) or isGitHubRepoPath(remainder)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    // file://
                    'f' => {
                        if (isTarball(dependency))
                            return .tarball;

                        if (strings.eqlComptime(
                            dependency[0..@minimum("file://".len, dependency.len)],
                            "file://",
                        )) {
                            return .folder;
                        }

                        if (isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    // link://
                    'l' => {
                        if (isTarball(dependency))
                            return .tarball;

                        if (strings.eqlComptime(
                            dependency[0..@minimum("link://".len, dependency.len)],
                            "link://",
                        )) {
                            return .symlink;
                        }

                        if (isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    // workspace://
                    'w' => {
                        if (strings.eqlComptime(
                            dependency[0..@minimum("workspace://".len, dependency.len)],
                            "workspace://",
                        )) {
                            return .workspace;
                        }

                        if (isTarball(dependency))
                            return .tarball;

                        if (isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },

                    else => {
                        if (isTarball(dependency))
                            return .tarball;

                        if (isGitHubRepoPath(dependency)) {
                            return .github;
                        }

                        return .dist_tag;
                    },
                }
            }
        };

        pub const Value = union {
            uninitialized: void,

            npm: Semver.Query.Group,
            dist_tag: String,
            tarball: URI,
            folder: String,

            /// Unsupported, but still parsed so an error can be thrown
            symlink: void,
            /// Unsupported, but still parsed so an error can be thrown
            workspace: void,
            /// Unsupported, but still parsed so an error can be thrown
            git: void,
            /// Unsupported, but still parsed so an error can be thrown
            github: void,
        };
    };

    pub fn eql(
        a: Dependency,
        b: Dependency,
        lhs_buf: []const u8,
        rhs_buf: []const u8,
    ) bool {
        return a.name_hash == b.name_hash and a.name.len() == b.name.len() and a.version.eql(b.version, lhs_buf, rhs_buf);
    }

    pub fn eqlResolved(a: Dependency, b: Dependency) bool {
        if (a.isNPM() and b.tag.isNPM()) {
            return a.resolution == b.resolution;
        }

        return @as(Dependency.Version.Tag, a.version) == @as(Dependency.Version.Tag, b.version) and a.resolution == b.resolution;
    }

    pub fn parse(allocator: *std.mem.Allocator, dependency_: string, sliced: *const SlicedString, log: *logger.Log) ?Version {
        const dependency = std.mem.trimLeft(u8, dependency_, " \t\n\r");

        if (dependency.len == 0) return null;
        return parseWithTag(
            allocator,
            dependency,
            Version.Tag.infer(dependency),
            sliced,
            log,
        );
    }

    pub fn parseWithTag(
        allocator: *std.mem.Allocator,
        dependency: string,
        tag: Dependency.Version.Tag,
        sliced: *const SlicedString,
        log: *logger.Log,
    ) ?Version {
        switch (tag) {
            .npm => {
                const version = Semver.Query.parse(
                    allocator,
                    dependency,
                    sliced.sub(dependency),
                ) catch |err| {
                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "{s} parsing dependency \"{s}\"", .{ @errorName(err), dependency }) catch unreachable;
                    return null;
                };

                return Version{
                    .literal = sliced.value(),
                    .value = .{ .npm = version },
                    .tag = .npm,
                };
            },
            .dist_tag => {
                return Version{
                    .literal = sliced.value(),
                    .value = .{ .dist_tag = sliced.value() },
                    .tag = .dist_tag,
                };
            },
            .tarball => {
                if (strings.contains(dependency, "://")) {
                    if (strings.startsWith(dependency, "file://")) {
                        return Version{
                            .tag = .tarball,
                            .value = .{ .tarball = URI{ .local = sliced.sub(dependency[7..]).value() } },
                        };
                    } else if (strings.startsWith(dependency, "https://") or strings.startsWith(dependency, "http://")) {
                        return Version{
                            .tag = .tarball,
                            .value = .{ .tarball = URI{ .remote = sliced.sub(dependency).value() } },
                        };
                    } else {
                        log.addErrorFmt(null, logger.Loc.Empty, allocator, "invalid dependency \"{s}\"", .{dependency}) catch unreachable;
                        return null;
                    }
                }

                return Version{
                    .literal = sliced.value(),
                    .value = .{
                        .tarball = URI{
                            .local = sliced.value(),
                        },
                    },
                    .tag = .tarball,
                };
            },
            .folder => {
                if (strings.contains(dependency, "://")) {
                    if (strings.startsWith(dependency, "file://")) {
                        return Version{ .value = .{ .folder = sliced.sub(dependency[7..]).value() }, .tag = .folder };
                    }

                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "Unsupported protocol {s}", .{dependency}) catch unreachable;
                    return null;
                }

                return Version{
                    .value = .{ .folder = sliced.value() },
                    .tag = .folder,
                    .literal = sliced.value(),
                };
            },
            .uninitialized => return null,
            .symlink, .workspace, .git, .github => {
                log.addErrorFmt(null, logger.Loc.Empty, allocator, "Unsupported dependency type {s} for \"{s}\"", .{ @tagName(tag), dependency }) catch unreachable;
                return null;
            },
        }
    }
};

fn ObjectPool(comptime Type: type, comptime Init: (fn (allocator: *std.mem.Allocator) anyerror!Type), comptime threadsafe: bool) type {
    return struct {
        const LinkedList = std.SinglyLinkedList(Type);
        const Data = if (threadsafe)
            struct {
                pub threadlocal var list: LinkedList = undefined;
                pub threadlocal var loaded: bool = false;
            }
        else
            struct {
                pub var list: LinkedList = undefined;
                pub var loaded: bool = false;
            };

        const data = Data;

        pub fn get(allocator: *std.mem.Allocator) *LinkedList.Node {
            if (data.loaded) {
                if (data.list.popFirst()) |node| {
                    node.data.reset();
                    return node;
                }
            }

            var new_node = allocator.create(LinkedList.Node) catch unreachable;
            new_node.* = LinkedList.Node{
                .data = Init(
                    allocator,
                ) catch unreachable,
            };

            return new_node;
        }

        pub fn release(node: *LinkedList.Node) void {
            if (data.loaded) {
                data.list.prepend(node);
                return;
            }

            data.list = LinkedList{ .first = node };
            data.loaded = true;
        }
    };
}

const Npm = struct {
    pub const Registry = struct {
        url: URL = URL.parse("https://registry.npmjs.org/"),
        pub const BodyPool = ObjectPool(MutableString, MutableString.init2048, true);

        const PackageVersionResponse = union(Tag) {
            pub const Tag = enum {
                cached,
                fresh,
                not_found,
            };

            cached: PackageManifest,
            fresh: PackageManifest,
            not_found: void,
        };

        const Pico = @import("picohttp");
        pub fn getPackageMetadata(
            allocator: *std.mem.Allocator,
            response: Pico.Response,
            body: []const u8,
            log: *logger.Log,
            package_name: string,
            loaded_manifest: ?PackageManifest,
        ) !PackageVersionResponse {
            switch (response.status_code) {
                400 => return error.BadRequest,
                429 => return error.TooManyRequests,
                404 => return PackageVersionResponse{ .not_found = .{} },
                500...599 => return error.HTTPInternalServerError,
                304 => return PackageVersionResponse{
                    .cached = loaded_manifest.?,
                },
                else => {},
            }

            var newly_last_modified: string = "";
            var new_etag: string = "";
            for (response.headers) |header| {
                if (!(header.name.len == "last-modified".len or header.name.len == "etag".len)) continue;

                const hashed = HTTPClient.hashHeaderName(header.name);

                switch (hashed) {
                    HTTPClient.hashHeaderName("last-modified") => {
                        newly_last_modified = header.value;
                    },
                    HTTPClient.hashHeaderName("etag") => {
                        new_etag = header.value;
                    },
                    else => {},
                }
            }

            JSAst.Expr.Data.Store.create(default_allocator);
            JSAst.Stmt.Data.Store.create(default_allocator);
            defer {
                JSAst.Expr.Data.Store.reset();
                JSAst.Stmt.Data.Store.reset();
            }

            if (try PackageManifest.parse(
                allocator,
                log,
                body,
                package_name,
                newly_last_modified,
                new_etag,
                @truncate(u32, @intCast(u64, @maximum(0, std.time.timestamp()))) + 300,
            )) |package| {
                if (PackageManager.instance.options.enable.manifest_cache) {
                    var tmpdir = Fs.FileSystem.instance.tmpdir();

                    PackageManifest.Serializer.save(&package, tmpdir, PackageManager.instance.cache_directory) catch {};
                }

                return PackageVersionResponse{ .fresh = package };
            }

            return error.PackageFailedToParse;
        }
    };

    const VersionMap = std.ArrayHashMapUnmanaged(Semver.Version, PackageVersion, Semver.Version.HashContext, false);
    const DistTagMap = extern struct {
        tags: ExternalStringList = ExternalStringList{},
        versions: VersionSlice = VersionSlice{},
    };

    const PackageVersionList = ExternalSlice(PackageVersion);
    const ExternVersionMap = extern struct {
        keys: VersionSlice = VersionSlice{},
        values: PackageVersionList = PackageVersionList{},

        pub fn findKeyIndex(this: ExternVersionMap, buf: []const Semver.Version, find: Semver.Version) ?u32 {
            for (this.keys.get(buf)) |key, i| {
                if (key.eql(find)) {
                    return @truncate(u32, i);
                }
            }

            return null;
        }
    };

    /// https://nodejs.org/api/os.html#osplatform
    pub const OperatingSystem = enum(u16) {
        none = 0,
        all = all_value,

        _,

        pub const aix: u16 = 1 << 1;
        pub const darwin: u16 = 1 << 2;
        pub const freebsd: u16 = 1 << 3;
        pub const linux: u16 = 1 << 4;
        pub const openbsd: u16 = 1 << 5;
        pub const sunos: u16 = 1 << 6;
        pub const win32: u16 = 1 << 7;
        pub const android: u16 = 1 << 8;

        pub const all_value: u16 = aix | darwin | freebsd | linux | openbsd | sunos | win32 | android;

        pub fn isMatch(this: OperatingSystem) bool {
            if (comptime Environment.isLinux) {
                return (@enumToInt(this) & linux) != 0;
            } else if (comptime Environment.isMac) {
                return (@enumToInt(this) & darwin) != 0;
            } else {
                return false;
            }
        }

        const Matcher = strings.ExactSizeMatcher(8);

        pub fn apply(this_: OperatingSystem, str: []const u8) OperatingSystem {
            if (str.len == 0) {
                return this_;
            }
            const this = @enumToInt(this_);

            const is_not = str[0] == '!';
            const offset: usize = if (str[0] == '!') 1 else 0;
            const input = str[offset..];

            const field: u16 = switch (Matcher.match(input)) {
                Matcher.case("aix") => aix,
                Matcher.case("darwin") => darwin,
                Matcher.case("freebsd") => freebsd,
                Matcher.case("linux") => linux,
                Matcher.case("openbsd") => openbsd,
                Matcher.case("sunos") => sunos,
                Matcher.case("win32") => win32,
                Matcher.case("android") => android,
                else => return this_,
            };

            if (is_not) {
                return @intToEnum(OperatingSystem, this & ~field);
            } else {
                return @intToEnum(OperatingSystem, this | field);
            }
        }
    };

    /// https://docs.npmjs.com/cli/v8/configuring-npm/package-json#cpu
    /// https://nodejs.org/api/os.html#osarch
    pub const Architecture = enum(u16) {
        none = 0,
        all = all_value,
        _,

        pub const arm: u16 = 1 << 1;
        pub const arm64: u16 = 1 << 2;
        pub const ia32: u16 = 1 << 3;
        pub const mips: u16 = 1 << 4;
        pub const mipsel: u16 = 1 << 5;
        pub const ppc: u16 = 1 << 6;
        pub const ppc64: u16 = 1 << 7;
        pub const s390: u16 = 1 << 8;
        pub const s390x: u16 = 1 << 9;
        pub const x32: u16 = 1 << 10;
        pub const x64: u16 = 1 << 11;

        pub const all_value: u16 = arm | arm64 | ia32 | mips | mipsel | ppc | ppc64 | s390 | s390x | x32 | x64;

        pub fn isMatch(this: Architecture) bool {
            if (comptime Environment.isAarch64) {
                return (@enumToInt(this) & arm64) != 0;
            } else if (comptime Environment.isX64) {
                return (@enumToInt(this) & x64) != 0;
            } else {
                return false;
            }
        }

        const Matcher = strings.ExactSizeMatcher(8);

        pub fn apply(this_: Architecture, str: []const u8) Architecture {
            if (str.len == 0) {
                return this_;
            }
            const this = @enumToInt(this_);

            const is_not = str[0] == '!';
            const offset: usize = if (str[0] == '!') 1 else 0;
            const input = str[offset..];

            const field: u16 = switch (Matcher.match(input)) {
                Matcher.case("arm") => arm,
                Matcher.case("arm64") => arm64,
                Matcher.case("ia32") => ia32,
                Matcher.case("mips") => mips,
                Matcher.case("mipsel") => mipsel,
                Matcher.case("ppc") => ppc,
                Matcher.case("ppc64") => ppc64,
                Matcher.case("s390") => s390,
                Matcher.case("s390x") => s390x,
                Matcher.case("x32") => x32,
                Matcher.case("x64") => x64,
                else => return this_,
            };

            if (is_not) {
                return @intToEnum(Architecture, this & ~field);
            } else {
                return @intToEnum(Architecture, this | field);
            }
        }
    };
    const BigExternalString = Semver.BigExternalString;

    pub const PackageVersion = extern struct {
        /// `"integrity"` field || `"shasum"` field
        /// https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#dist
        // Splitting this into it's own array ends up increasing the final size a little bit.
        integrity: Integrity = Integrity{},

        /// "dependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#dependencies)
        dependencies: ExternalStringMap = ExternalStringMap{},

        /// `"optionalDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#optionaldependencies)
        optional_dependencies: ExternalStringMap = ExternalStringMap{},

        /// `"peerDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependencies)
        peer_dependencies: ExternalStringMap = ExternalStringMap{},

        /// `"devDependencies"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#devdependencies)
        /// We deliberately choose not to populate this field.
        /// We keep it in the data layout so that if it turns out we do need it, we can add it without invalidating everyone's history.
        dev_dependencies: ExternalStringMap = ExternalStringMap{},

        /// `"bin"` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
        bin: Bin = Bin{},

        /// `"engines"` field in package.json
        engines: ExternalStringMap = ExternalStringMap{},

        /// `"peerDependenciesMeta"` in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#peerdependenciesmeta)
        optional_peer_dependencies: ExternalStringMap = ExternalStringMap{},

        man_dir: ExternalString = ExternalString{},

        unpacked_size: u32 = 0,
        file_count: u32 = 0,

        /// `"os"` field in package.json
        os: OperatingSystem = OperatingSystem.all,
        /// `"cpu"` field in package.json
        cpu: Architecture = Architecture.all,
    };

    const NpmPackage = extern struct {
        name: ExternalString = ExternalString{},
        /// HTTP response headers
        last_modified: ExternalString = ExternalString{},
        etag: ExternalString = ExternalString{},

        /// "modified" in the JSON
        modified: ExternalString = ExternalString{},

        releases: ExternVersionMap = ExternVersionMap{},
        prereleases: ExternVersionMap = ExternVersionMap{},
        dist_tags: DistTagMap = DistTagMap{},

        versions_buf: VersionSlice = VersionSlice{},
        string_lists_buf: ExternalStringList = ExternalStringList{},
        string_buf: BigExternalString = BigExternalString{},
        public_max_age: u32 = 0,
    };

    const PackageManifest = struct {
        pkg: NpmPackage = NpmPackage{},

        string_buf: []const u8 = &[_]u8{},
        versions: []const Semver.Version = &[_]Semver.Version{},
        external_strings: []const ExternalString = &[_]ExternalString{},
        // We store this in a separate buffer so that we can dedupe contiguous identical versions without an extra pass
        external_strings_for_versions: []const ExternalString = &[_]ExternalString{},
        package_versions: []const PackageVersion = &[_]PackageVersion{},

        pub inline fn name(this: *const PackageManifest) string {
            return this.pkg.name.slice(this.string_buf);
        }

        pub const Serializer = struct {
            pub const version = "bun-npm-manifest-cache-v0.0.1\n";
            const header_bytes: string = "#!/usr/bin/env bun\n" ++ version;

            pub const sizes = blk: {
                // skip name
                const fields = std.meta.fields(Npm.PackageManifest);

                const Data = struct {
                    size: usize,
                    name: []const u8,
                    alignment: usize,
                };
                var data: [fields.len]Data = undefined;
                for (fields) |field_info, i| {
                    data[i] = .{
                        .size = @sizeOf(field_info.field_type),
                        .name = field_info.name,
                        .alignment = if (@sizeOf(field_info.field_type) == 0) 1 else field_info.alignment,
                    };
                }
                const Sort = struct {
                    fn lessThan(trash: *i32, lhs: Data, rhs: Data) bool {
                        _ = trash;
                        return lhs.alignment > rhs.alignment;
                    }
                };
                var trash: i32 = undefined; // workaround for stage1 compiler bug
                std.sort.sort(Data, &data, &trash, Sort.lessThan);
                var sizes_bytes: [fields.len]usize = undefined;
                var names: [fields.len][]const u8 = undefined;
                for (data) |elem, i| {
                    sizes_bytes[i] = elem.size;
                    names[i] = elem.name;
                }
                break :blk .{
                    .bytes = sizes_bytes,
                    .fields = names,
                };
            };

            pub fn writeArray(comptime Writer: type, writer: Writer, comptime Type: type, array: []const Type, pos: *u64) !void {
                const bytes = std.mem.sliceAsBytes(array);
                if (bytes.len == 0) {
                    try writer.writeIntNative(u64, 0);
                    pos.* += 8;
                    return;
                }

                try writer.writeIntNative(u64, bytes.len);
                pos.* += 8;
                pos.* += try Aligner.write(Type, Writer, writer, pos.*);

                try writer.writeAll(
                    bytes,
                );
                pos.* += bytes.len;
            }

            pub fn readArray(stream: *std.io.FixedBufferStream([]const u8), comptime Type: type) ![]const Type {
                var reader = stream.reader();
                const byte_len = try reader.readIntNative(u64);
                if (byte_len == 0) {
                    return &[_]Type{};
                }

                stream.pos += Aligner.skipAmount(Type, stream.pos);
                const result_bytes = stream.buffer[stream.pos..][0..byte_len];
                const result = @ptrCast([*]const Type, @alignCast(@alignOf([*]const Type), result_bytes.ptr))[0 .. result_bytes.len / @sizeOf(Type)];
                stream.pos += result_bytes.len;
                return result;
            }

            pub fn write(this: *const PackageManifest, comptime Writer: type, writer: Writer) !void {
                var pos: u64 = 0;
                try writer.writeAll(header_bytes);
                pos += header_bytes.len;

                inline for (sizes.fields) |field_name| {
                    if (comptime strings.eqlComptime(field_name, "pkg")) {
                        const bytes = std.mem.asBytes(&this.pkg);
                        pos += try Aligner.write(NpmPackage, Writer, writer, pos);
                        try writer.writeAll(
                            bytes,
                        );
                        pos += bytes.len;
                    } else {
                        const field = @field(this, field_name);
                        try writeArray(Writer, writer, std.meta.Child(@TypeOf(field)), field, &pos);
                    }
                }
            }

            pub fn save(this: *const PackageManifest, tmpdir: std.fs.Dir, cache_dir: std.fs.Dir) !void {
                const file_id = std.hash.Wyhash.hash(0, this.name());
                var dest_path_buf: [512 + 64]u8 = undefined;
                var out_path_buf: ["-18446744073709551615".len + ".npm".len + 1]u8 = undefined;
                var dest_path_stream = std.io.fixedBufferStream(&dest_path_buf);
                var dest_path_stream_writer = dest_path_stream.writer();
                try dest_path_stream_writer.print("{x}.npm-{x}", .{ file_id, @maximum(std.time.milliTimestamp(), 0) });
                try dest_path_stream_writer.writeByte(0);
                var tmp_path: [:0]u8 = dest_path_buf[0 .. dest_path_stream.pos - 1 :0];
                {
                    var tmpfile = try tmpdir.createFileZ(tmp_path, .{
                        .truncate = true,
                    });
                    var writer = tmpfile.writer();
                    try Serializer.write(this, @TypeOf(writer), writer);
                    tmpfile.close();
                }

                var out_path = std.fmt.bufPrintZ(&out_path_buf, "{x}.npm", .{file_id}) catch unreachable;
                try std.os.renameatZ(tmpdir.fd, tmp_path, cache_dir.fd, out_path);
            }

            pub fn load(allocator: *std.mem.Allocator, cache_dir: std.fs.Dir, package_name: string) !?PackageManifest {
                const file_id = std.hash.Wyhash.hash(0, package_name);
                var file_path_buf: [512 + 64]u8 = undefined;
                var file_path = try std.fmt.bufPrintZ(&file_path_buf, "{x}.npm", .{file_id});
                var cache_file = cache_dir.openFileZ(
                    file_path,
                    .{
                        .read = true,
                    },
                ) catch return null;
                var timer: std.time.Timer = undefined;
                if (verbose_install) {
                    timer = std.time.Timer.start() catch @panic("timer fail");
                }
                defer cache_file.close();
                var bytes = try cache_file.readToEndAlloc(allocator, std.math.maxInt(u32));
                errdefer allocator.free(bytes);
                if (bytes.len < header_bytes.len) return null;
                const result = try readAll(bytes);
                if (verbose_install) {
                    Output.prettyError("\n ", .{});
                    Output.printTimer(&timer);
                    Output.prettyErrorln("<d> [cache hit] {s}<r>", .{package_name});
                }
                return result;
            }

            pub fn readAll(bytes: []const u8) !PackageManifest {
                if (!strings.eqlComptime(bytes[0..header_bytes.len], header_bytes)) {
                    return error.InvalidPackageManifest;
                }
                var pkg_stream = std.io.fixedBufferStream(bytes);
                pkg_stream.pos = header_bytes.len;
                var package_manifest = PackageManifest{};

                inline for (sizes.fields) |field_name| {
                    if (comptime strings.eqlComptime(field_name, "pkg")) {
                        pkg_stream.pos = std.mem.alignForward(pkg_stream.pos, @alignOf(Npm.NpmPackage));
                        var reader = pkg_stream.reader();
                        package_manifest.pkg = try reader.readStruct(NpmPackage);
                    } else {
                        @field(package_manifest, field_name) = try readArray(
                            &pkg_stream,
                            std.meta.Child(@TypeOf(@field(package_manifest, field_name))),
                        );
                    }
                }

                return package_manifest;
            }
        };

        pub fn str(self: *const PackageManifest, external: ExternalString) string {
            return external.slice(self.string_buf);
        }

        pub fn reportSize(this: *const PackageManifest) void {
            const versions = std.mem.sliceAsBytes(this.versions);
            const external_strings = std.mem.sliceAsBytes(this.external_strings);
            const package_versions = std.mem.sliceAsBytes(this.package_versions);
            const string_buf = std.mem.sliceAsBytes(this.string_buf);

            Output.prettyErrorln(
                \\ Versions count:            {d} 
                \\ External Strings count:    {d} 
                \\ Package Versions count:    {d}
                \\ 
                \\ Bytes:
                \\
                \\  Versions:   {d} 
                \\  External:   {d} 
                \\  Packages:   {d} 
                \\  Strings:    {d}
                \\  Total:      {d}
            , .{
                this.versions.len,
                this.external_strings.len,
                this.package_versions.len,

                std.mem.sliceAsBytes(this.versions).len,
                std.mem.sliceAsBytes(this.external_strings).len,
                std.mem.sliceAsBytes(this.package_versions).len,
                std.mem.sliceAsBytes(this.string_buf).len,
                std.mem.sliceAsBytes(this.versions).len +
                    std.mem.sliceAsBytes(this.external_strings).len +
                    std.mem.sliceAsBytes(this.package_versions).len +
                    std.mem.sliceAsBytes(this.string_buf).len,
            });
            Output.flush();
        }

        pub const FindResult = struct {
            version: Semver.Version,
            package: *const PackageVersion,
        };

        pub fn findByString(this: *const PackageManifest, version: string) ?FindResult {
            switch (Dependency.Version.Tag.infer(version)) {
                .npm => {
                    const group = Semver.Query.parse(default_allocator, version, SlicedString.init(
                        version,
                        version,
                    )) catch return null;
                    return this.findBestVersion(group);
                },
                .dist_tag => {
                    return this.findByDistTag(version);
                },
                else => return null,
            }
        }

        pub fn findByVersion(this: *const PackageManifest, version: Semver.Version) ?FindResult {
            const list = if (!version.tag.hasPre()) this.pkg.releases else this.pkg.prereleases;
            const values = list.values.get(this.package_versions);
            const keys = list.keys.get(this.versions);
            const index = list.findKeyIndex(this.versions, version) orelse return null;
            return FindResult{
                // Be sure to use the struct from the list in the NpmPackage
                // That is the one we can correctly recover the original version string for
                .version = keys[index],
                .package = &values[index],
            };
        }

        pub fn findByDistTag(this: *const PackageManifest, tag: string) ?FindResult {
            const versions = this.pkg.dist_tags.versions.get(this.versions);
            for (this.pkg.dist_tags.tags.get(this.external_strings)) |tag_str, i| {
                if (strings.eql(tag_str.slice(this.string_buf), tag)) {
                    return this.findByVersion(versions[i]);
                }
            }

            return null;
        }

        pub fn findBestVersion(this: *const PackageManifest, group: Semver.Query.Group) ?FindResult {
            const left = group.head.head.range.left;
            // Fast path: exact version
            if (left.op == .eql) {
                return this.findByVersion(left.version);
            }

            const releases = this.pkg.releases.keys.get(this.versions);

            if (group.flags.isSet(Semver.Query.Group.Flags.pre)) {
                const prereleases = this.pkg.prereleases.keys.get(this.versions);
                var i = prereleases.len;
                while (i > 0) : (i -= 1) {
                    const version = prereleases[i - 1];
                    const packages = this.pkg.prereleases.values.get(this.package_versions);

                    if (group.satisfies(version)) {
                        return FindResult{ .version = version, .package = &packages[i - 1] };
                    }
                }
            }

            {
                var i = releases.len;
                // // For now, this is the dumb way
                while (i > 0) : (i -= 1) {
                    const version = releases[i - 1];
                    const packages = this.pkg.releases.values.get(this.package_versions);

                    if (group.satisfies(version)) {
                        return FindResult{ .version = version, .package = &packages[i - 1] };
                    }
                }
            }

            return null;
        }

        const ExternalStringMapDeduper = std.HashMap(u64, ExternalStringList, IdentityContext(u64), 80);

        threadlocal var string_pool_: String.Builder.StringPool = undefined;
        threadlocal var string_pool_loaded: bool = false;

        threadlocal var external_string_maps_: ExternalStringMapDeduper = undefined;
        threadlocal var external_string_maps_loaded: bool = false;

        /// This parses [Abbreviated metadata](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md#abbreviated-metadata-format)
        pub fn parse(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            json_buffer: []const u8,
            expected_name: []const u8,
            last_modified: []const u8,
            etag: []const u8,
            public_max_age: u32,
        ) !?PackageManifest {
            const source = logger.Source.initPathString(expected_name, json_buffer);
            initializeStore();
            const json = json_parser.ParseJSON(&source, log, allocator) catch |err| {
                return null;
            };

            if (json.asProperty("error")) |error_q| {
                if (error_q.expr.asString(allocator)) |err| {
                    log.addErrorFmt(&source, logger.Loc.Empty, allocator, "npm error: {s}", .{err}) catch unreachable;
                    return null;
                }
            }

            var result = PackageManifest{};

            if (!string_pool_loaded) {
                string_pool_ = String.Builder.StringPool.init(default_allocator);
                string_pool_loaded = true;
            }

            if (!external_string_maps_loaded) {
                external_string_maps_ = ExternalStringMapDeduper.initContext(default_allocator, .{});
                external_string_maps_loaded = true;
            }

            var string_pool = string_pool_;
            string_pool.clearRetainingCapacity();
            var external_string_maps = external_string_maps_;
            external_string_maps.clearRetainingCapacity();

            defer string_pool_ = string_pool;
            defer external_string_maps_ = external_string_maps;

            var string_builder = String.Builder{
                .string_pool = string_pool,
            };

            if (json.asProperty("name")) |name_q| {
                const field = name_q.expr.asString(allocator) orelse return null;

                if (!strings.eql(field, expected_name)) {
                    Output.panic("<r>internal: <red>package name mismatch<r> expected <b>\"{s}\"<r> but received <red>\"{s}\"<r>", .{ expected_name, field });
                    return null;
                }

                string_builder.count(field);
            }

            if (json.asProperty("modified")) |name_q| {
                const field = name_q.expr.asString(allocator) orelse return null;

                string_builder.count(field);
            }

            const DependencyGroup = struct { prop: string, field: string };
            const dependency_groups = comptime [_]DependencyGroup{
                .{ .prop = "dependencies", .field = "dependencies" },
                .{ .prop = "optionalDependencies", .field = "optional_dependencies" },
                .{ .prop = "peerDependencies", .field = "peer_dependencies" },
            };

            var release_versions_len: usize = 0;
            var pre_versions_len: usize = 0;
            var dependency_sum: usize = 0;
            var extern_string_count: usize = 0;
            get_versions: {
                if (json.asProperty("versions")) |versions_q| {
                    if (versions_q.expr.data != .e_object) break :get_versions;

                    const versions = versions_q.expr.data.e_object.properties;
                    for (versions) |prop| {
                        const version_name = prop.key.?.asString(allocator) orelse continue;

                        if (std.mem.indexOfScalar(u8, version_name, '-') != null) {
                            pre_versions_len += 1;
                            extern_string_count += 1;
                        } else {
                            extern_string_count += @as(usize, @boolToInt(std.mem.indexOfScalar(u8, version_name, '+') != null));
                            release_versions_len += 1;
                        }

                        string_builder.count(version_name);

                        bin: {
                            if (prop.value.?.asProperty("bin")) |bin| {
                                switch (bin.expr.data) {
                                    .e_object => |obj| {
                                        if (obj.properties.len > 0) {
                                            string_builder.count(obj.properties[0].key.?.asString(allocator) orelse break :bin);
                                            string_builder.count(obj.properties[0].value.?.asString(allocator) orelse break :bin);
                                        }
                                    },
                                    .e_string => |str| {
                                        if (bin.expr.asString(allocator)) |str_| {
                                            string_builder.count(str_);
                                            break :bin;
                                        }
                                    },
                                    else => {},
                                }
                            }

                            if (prop.value.?.asProperty("directories")) |dirs| {
                                if (dirs.expr.asProperty("bin")) |bin_prop| {
                                    if (bin_prop.expr.asString(allocator)) |str_| {
                                        string_builder.count(str_);
                                        break :bin;
                                    }
                                }
                            }
                        }

                        inline for (dependency_groups) |pair| {
                            if (prop.value.?.asProperty(pair.prop)) |versioned_deps| {
                                if (versioned_deps.expr.data == .e_object) {
                                    dependency_sum += versioned_deps.expr.data.e_object.properties.len;
                                    const properties = versioned_deps.expr.data.e_object.properties;
                                    for (properties) |property| {
                                        if (property.key.?.asString(allocator)) |key| {
                                            string_builder.count(key);
                                            string_builder.count(property.value.?.asString(allocator) orelse "");
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            extern_string_count += dependency_sum;

            var dist_tags_count: usize = 0;
            if (json.asProperty("dist-tags")) |dist| {
                if (dist.expr.data == .e_object) {
                    const tags = dist.expr.data.e_object.properties;
                    for (tags) |tag| {
                        if (tag.key.?.asString(allocator)) |key| {
                            string_builder.count(key);
                            extern_string_count += 2;

                            string_builder.count((tag.value.?.asString(allocator) orelse ""));
                            dist_tags_count += 1;
                        }
                    }
                }
            }

            if (last_modified.len > 0) {
                string_builder.count(last_modified);
            }

            if (etag.len > 0) {
                string_builder.count(etag);
            }

            var versioned_packages = try allocator.allocAdvanced(PackageVersion, null, release_versions_len + pre_versions_len, .exact);
            var all_semver_versions = try allocator.allocAdvanced(Semver.Version, null, release_versions_len + pre_versions_len + dist_tags_count, .exact);
            var all_extern_strings = try allocator.allocAdvanced(ExternalString, null, extern_string_count, .exact);
            var version_extern_strings = try allocator.allocAdvanced(ExternalString, null, dependency_sum, .exact);

            var versioned_package_releases = versioned_packages[0..release_versions_len];
            var all_versioned_package_releases = versioned_package_releases;
            var versioned_package_prereleases = versioned_packages[release_versions_len..][0..pre_versions_len];
            var all_versioned_package_prereleases = versioned_package_prereleases;
            var _versions_open = all_semver_versions;
            var all_release_versions = _versions_open[0..release_versions_len];
            _versions_open = _versions_open[release_versions_len..];
            var all_prerelease_versions = _versions_open[0..pre_versions_len];
            _versions_open = _versions_open[pre_versions_len..];
            var dist_tag_versions = _versions_open[0..dist_tags_count];
            var release_versions = all_release_versions;
            var prerelease_versions = all_prerelease_versions;

            var extern_strings = all_extern_strings;
            string_builder.cap += 1;
            string_builder.cap *= 2;
            try string_builder.allocate(allocator);

            var string_buf: string = "";
            if (string_builder.ptr) |ptr| {
                // 0 it out for better determinism
                @memset(ptr, 0, string_builder.cap);

                string_buf = ptr[0..string_builder.cap];
            }

            if (json.asProperty("name")) |name_q| {
                const field = name_q.expr.asString(allocator) orelse return null;
                result.pkg.name = string_builder.append(ExternalString, field);
            }

            var string_slice = SlicedString.init(string_buf, string_buf);
            get_versions: {
                if (json.asProperty("versions")) |versions_q| {
                    if (versions_q.expr.data != .e_object) break :get_versions;

                    const versions = versions_q.expr.data.e_object.properties;

                    var all_dependency_names_and_values = all_extern_strings[0..dependency_sum];

                    // versions change more often than names
                    // so names go last because we are better able to dedupe at the end
                    var dependency_values = version_extern_strings;
                    var dependency_names = all_dependency_names_and_values;

                    var version_string__: String = String{};
                    for (versions) |prop, version_i| {
                        const version_name = prop.key.?.asString(allocator) orelse continue;

                        var sliced_string = SlicedString.init(version_name, version_name);

                        // We only need to copy the version tags if it's a pre/post
                        if (std.mem.indexOfAny(u8, version_name, "-+") != null) {
                            version_string__ = string_builder.append(String, version_name);
                            sliced_string = version_string__.sliced(string_buf);
                        }

                        const parsed_version = Semver.Version.parse(sliced_string, allocator);
                        std.debug.assert(parsed_version.valid);

                        if (!parsed_version.valid) {
                            log.addErrorFmt(&source, prop.value.?.loc, allocator, "Failed to parse dependency {s}", .{version_name}) catch unreachable;
                            continue;
                        }

                        var package_version = PackageVersion{};

                        if (prop.value.?.asProperty("cpu")) |cpu| {
                            package_version.cpu = Architecture.all;

                            switch (cpu.expr.data) {
                                .e_array => |arr| {
                                    if (arr.items.len > 0) {
                                        package_version.cpu = Architecture.none;
                                        for (arr.items) |item| {
                                            if (item.asString(allocator)) |cpu_str_| {
                                                package_version.cpu = package_version.cpu.apply(cpu_str_);
                                            }
                                        }
                                    }
                                },
                                .e_string => |str| {
                                    package_version.cpu = Architecture.apply(Architecture.none, str.utf8);
                                },
                                else => {},
                            }
                        }

                        if (prop.value.?.asProperty("os")) |os| {
                            package_version.os = OperatingSystem.all;

                            switch (os.expr.data) {
                                .e_array => |arr| {
                                    if (arr.items.len > 0) {
                                        package_version.os = OperatingSystem.none;
                                        for (arr.items) |item| {
                                            if (item.asString(allocator)) |cpu_str_| {
                                                package_version.os = package_version.os.apply(cpu_str_);
                                            }
                                        }
                                    }
                                },
                                .e_string => |str| {
                                    package_version.os = OperatingSystem.apply(OperatingSystem.none, str.utf8);
                                },
                                else => {},
                            }
                        }

                        bin: {
                            if (prop.value.?.asProperty("bin")) |bin| {
                                switch (bin.expr.data) {
                                    .e_object => |obj| {
                                        if (obj.properties.len > 0) {
                                            const bin_name = obj.properties[0].key.?.asString(allocator) orelse break :bin;
                                            const value = obj.properties[0].value.?.asString(allocator) orelse break :bin;
                                            // For now, we're only supporting the first bin
                                            // We'll fix that later
                                            package_version.bin = Bin{
                                                .tag = Bin.Tag.named_file,
                                                .value = .{
                                                    .named_file = .{
                                                        string_builder.append(String, bin_name),
                                                        string_builder.append(String, value),
                                                    },
                                                },
                                            };
                                            break :bin;

                                            // for (arr.items) |item| {
                                            //     if (item.asString(allocator)) |bin_str_| {
                                            //         package_version.bin =
                                            //     }
                                            // }
                                        }
                                    },
                                    .e_string => |str| {
                                        if (str.utf8.len > 0) {
                                            package_version.bin = Bin{
                                                .tag = Bin.Tag.file,
                                                .value = .{
                                                    .file = string_builder.append(String, str.utf8),
                                                },
                                            };
                                            break :bin;
                                        }
                                    },
                                    else => {},
                                }
                            }

                            if (prop.value.?.asProperty("directories")) |dirs| {
                                if (dirs.expr.asProperty("bin")) |bin_prop| {
                                    if (bin_prop.expr.asString(allocator)) |str_| {
                                        if (str_.len > 0) {
                                            package_version.bin = Bin{
                                                .tag = Bin.Tag.dir,
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

                        integrity: {
                            if (prop.value.?.asProperty("dist")) |dist| {
                                if (dist.expr.data == .e_object) {
                                    if (dist.expr.asProperty("fileCount")) |file_count_| {
                                        if (file_count_.expr.data == .e_number) {
                                            package_version.file_count = file_count_.expr.data.e_number.toU32();
                                        }
                                    }

                                    if (dist.expr.asProperty("unpackedSize")) |file_count_| {
                                        if (file_count_.expr.data == .e_number) {
                                            package_version.unpacked_size = file_count_.expr.data.e_number.toU32();
                                        }
                                    }

                                    if (dist.expr.asProperty("integrity")) |shasum| {
                                        if (shasum.expr.asString(allocator)) |shasum_str| {
                                            package_version.integrity = Integrity.parse(shasum_str) catch Integrity{};
                                            break :integrity;
                                        }
                                    }

                                    if (dist.expr.asProperty("shasum")) |shasum| {
                                        if (shasum.expr.asString(allocator)) |shasum_str| {
                                            package_version.integrity = Integrity.parseSHASum(shasum_str) catch Integrity{};
                                        }
                                    }
                                }
                            }
                        }

                        inline for (dependency_groups) |pair| {
                            if (prop.value.?.asProperty(comptime pair.prop)) |versioned_deps| {
                                const items = versioned_deps.expr.data.e_object.properties;
                                var count = items.len;

                                var this_names = dependency_names[0..count];
                                var this_versions = dependency_values[0..count];

                                var name_hasher = std.hash.Wyhash.init(0);
                                var version_hasher = std.hash.Wyhash.init(0);

                                var i: usize = 0;
                                for (items) |item| {
                                    const name_str = item.key.?.asString(allocator) orelse if (comptime isDebug or isTest) unreachable else continue;
                                    const version_str = item.value.?.asString(allocator) orelse if (comptime isDebug or isTest) unreachable else continue;

                                    this_names[i] = string_builder.append(ExternalString, name_str);
                                    this_versions[i] = string_builder.append(ExternalString, version_str);

                                    const names_hash_bytes = @bitCast([8]u8, this_names[i].hash);
                                    name_hasher.update(&names_hash_bytes);
                                    const versions_hash_bytes = @bitCast([8]u8, this_versions[i].hash);
                                    version_hasher.update(&versions_hash_bytes);

                                    i += 1;
                                }

                                count = i;

                                var name_list = ExternalStringList.init(all_extern_strings, this_names);
                                var version_list = ExternalStringList.init(version_extern_strings, this_versions);

                                if (count > 0) {
                                    const name_map_hash = name_hasher.final();
                                    const version_map_hash = version_hasher.final();

                                    var name_entry = try external_string_maps.getOrPut(name_map_hash);
                                    if (name_entry.found_existing) {
                                        name_list = name_entry.value_ptr.*;
                                        this_names = name_list.mut(all_extern_strings);
                                    } else {
                                        name_entry.value_ptr.* = name_list;
                                        dependency_names = dependency_names[count..];
                                    }

                                    var version_entry = try external_string_maps.getOrPut(version_map_hash);
                                    if (version_entry.found_existing) {
                                        version_list = version_entry.value_ptr.*;
                                        this_versions = version_list.mut(version_extern_strings);
                                    } else {
                                        version_entry.value_ptr.* = version_list;
                                        dependency_values = dependency_values[count..];
                                    }
                                }

                                @field(package_version, pair.field) = ExternalStringMap{
                                    .name = name_list,
                                    .value = version_list,
                                };

                                if (comptime isDebug or isTest) {
                                    const dependencies_list = @field(package_version, pair.field);

                                    std.debug.assert(dependencies_list.name.off < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.value.off < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.name.off + dependencies_list.name.len < all_extern_strings.len);
                                    std.debug.assert(dependencies_list.value.off + dependencies_list.value.len < all_extern_strings.len);

                                    std.debug.assert(std.meta.eql(dependencies_list.name.get(all_extern_strings), this_names));
                                    std.debug.assert(std.meta.eql(dependencies_list.value.get(version_extern_strings), this_versions));
                                    var j: usize = 0;
                                    const name_dependencies = dependencies_list.name.get(all_extern_strings);
                                    while (j < name_dependencies.len) : (j += 1) {
                                        const dep_name = name_dependencies[j];
                                        std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), this_names[j].slice(string_buf)));
                                        std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), items[j].key.?.asString(allocator).?));
                                    }

                                    j = 0;
                                    while (j < dependencies_list.value.len) : (j += 1) {
                                        const dep_name = dependencies_list.value.get(version_extern_strings)[j];

                                        std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), this_versions[j].slice(string_buf)));
                                        std.debug.assert(std.mem.eql(u8, dep_name.slice(string_buf), items[j].value.?.asString(allocator).?));
                                    }
                                }
                            }
                        }

                        if (!parsed_version.version.tag.hasPre()) {
                            release_versions[0] = parsed_version.version;
                            versioned_package_releases[0] = package_version;
                            release_versions = release_versions[1..];
                            versioned_package_releases = versioned_package_releases[1..];
                        } else {
                            prerelease_versions[0] = parsed_version.version;
                            versioned_package_prereleases[0] = package_version;
                            prerelease_versions = prerelease_versions[1..];
                            versioned_package_prereleases = versioned_package_prereleases[1..];
                        }
                    }

                    extern_strings = all_extern_strings[all_dependency_names_and_values.len - dependency_names.len ..];
                    version_extern_strings = version_extern_strings[0 .. version_extern_strings.len - dependency_values.len];
                }
            }

            if (last_modified.len > 0) {
                result.pkg.last_modified = string_builder.append(ExternalString, last_modified);
            }

            if (etag.len > 0) {
                result.pkg.etag = string_builder.append(ExternalString, etag);
            }

            if (json.asProperty("dist-tags")) |dist| {
                if (dist.expr.data == .e_object) {
                    const tags = dist.expr.data.e_object.properties;
                    var extern_strings_slice = extern_strings[0..dist_tags_count];
                    var dist_tag_i: usize = 0;

                    for (tags) |tag, i| {
                        if (tag.key.?.asString(allocator)) |key| {
                            extern_strings_slice[dist_tag_i] = string_builder.append(ExternalString, key);

                            const version_name = tag.value.?.asString(allocator) orelse continue;

                            const dist_tag_value_literal = string_builder.append(ExternalString, version_name);
                            const dist_tag_value_literal_slice = dist_tag_value_literal.slice(string_buf);

                            const sliced_string = dist_tag_value_literal.value.sliced(string_buf);

                            dist_tag_versions[dist_tag_i] = Semver.Version.parse(sliced_string, allocator).version;
                            dist_tag_i += 1;
                        }
                    }

                    result.pkg.dist_tags = DistTagMap{
                        .tags = ExternalStringList.init(all_extern_strings, extern_strings_slice[0..dist_tag_i]),
                        .versions = VersionSlice.init(all_semver_versions, dist_tag_versions[0..dist_tag_i]),
                    };

                    if (isDebug) {
                        std.debug.assert(std.meta.eql(result.pkg.dist_tags.versions.get(all_semver_versions), dist_tag_versions[0..dist_tag_i]));
                        std.debug.assert(std.meta.eql(result.pkg.dist_tags.tags.get(all_extern_strings), extern_strings_slice[0..dist_tag_i]));
                    }

                    extern_strings = extern_strings[dist_tag_i..];
                }
            }

            if (json.asProperty("modified")) |name_q| {
                const field = name_q.expr.asString(allocator) orelse return null;

                result.pkg.modified = string_builder.append(ExternalString, field);
            }

            result.pkg.releases.keys = VersionSlice.init(all_semver_versions, all_release_versions);
            result.pkg.releases.values = PackageVersionList.init(versioned_packages, all_versioned_package_releases);

            result.pkg.prereleases.keys = VersionSlice.init(all_semver_versions, all_prerelease_versions);
            result.pkg.prereleases.values = PackageVersionList.init(versioned_packages, all_versioned_package_prereleases);

            if (extern_strings.len > 0) {
                all_extern_strings = all_extern_strings[0 .. all_extern_strings.len - extern_strings.len];
            }

            result.pkg.string_lists_buf.off = 0;
            result.pkg.string_lists_buf.len = @truncate(u32, all_extern_strings.len);

            result.pkg.versions_buf.off = 0;
            result.pkg.versions_buf.len = @truncate(u32, all_semver_versions.len);

            result.versions = all_semver_versions;
            result.external_strings = all_extern_strings;
            result.external_strings_for_versions = version_extern_strings;
            result.package_versions = versioned_packages;
            result.pkg.public_max_age = public_max_age;

            if (string_builder.ptr) |ptr| {
                result.string_buf = ptr[0..string_builder.len];
                result.pkg.string_buf = BigExternalString{
                    .off = 0,
                    .len = @truncate(u32, string_builder.len),
                    .hash = 0,
                };
            }

            return result;
        }
    };
};

const ExtractTarball = struct {
    name: strings.StringOrTinyString,
    version: Semver.Version,
    registry: string,
    cache_dir: string,
    package_id: PackageID,
    extracted_file_count: usize = 0,
    skip_verify: bool = false,

    integrity: Integrity = Integrity{},

    pub inline fn run(this: ExtractTarball, bytes: []const u8) !string {
        if (!this.skip_verify and this.integrity.tag.isSupported()) {
            if (!this.integrity.verify(bytes)) {
                Output.prettyErrorln("<r><red>Integrity check failed<r> for tarball: {s}", .{this.name.slice()});
                Output.flush();
                return error.IntegrityCheckFailed;
            }
        }
        return this.extract(bytes);
    }

    fn buildURL(
        allocator: *std.mem.Allocator,
        registry_: string,
        full_name_: strings.StringOrTinyString,
        version: Semver.Version,
        string_buf: []const u8,
    ) !string {
        const registry = std.mem.trimRight(u8, registry_, "/");
        const full_name = full_name_.slice();

        var name = full_name;
        if (name[0] == '@') {
            if (std.mem.indexOfScalar(u8, name, '/')) |i| {
                name = name[i + 1 ..];
            }
        }

        const default_format = "{s}/{s}/-/";

        if (!version.tag.hasPre() and !version.tag.hasBuild()) {
            return try FileSystem.DirnameStore.instance.print(
                default_format ++ "{s}-{d}.{d}.{d}.tgz",
                .{ registry, full_name, name, version.major, version.minor, version.patch },
            );
            // TODO: tarball URLs for build/pre
        } else if (version.tag.hasPre() and version.tag.hasBuild()) {
            return try FileSystem.DirnameStore.instance.print(
                default_format ++ "{s}-{d}.{d}.{d}-{s}+{s}.tgz",
                .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.pre.slice(string_buf), version.tag.build.slice(string_buf) },
            );
            // TODO: tarball URLs for build/pre
        } else if (version.tag.hasPre()) {
            return try FileSystem.DirnameStore.instance.print(
                default_format ++ "{s}-{d}.{d}.{d}-{s}.tgz",
                .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.pre.slice(string_buf) },
            );
            // TODO: tarball URLs for build/pre
        } else if (version.tag.hasBuild()) {
            return try FileSystem.DirnameStore.instance.print(
                default_format ++ "{s}-{d}.{d}.{d}+{s}.tgz",
                .{ registry, full_name, name, version.major, version.minor, version.patch, version.tag.build.slice(string_buf) },
            );
        } else {
            unreachable;
        }
    }

    threadlocal var abs_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    threadlocal var abs_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    fn extract(this: *const ExtractTarball, tgz_bytes: []const u8) !string {
        var tmpdir = Fs.FileSystem.instance.tmpdir();
        var tmpname_buf: [128]u8 = undefined;
        const name = this.name.slice();

        var basename = this.name.slice();
        if (basename[0] == '@') {
            if (std.mem.indexOfScalar(u8, basename, '/')) |i| {
                basename = basename[i + 1 ..];
            }
        }

        var tmpname = try Fs.FileSystem.instance.tmpname(basename, &tmpname_buf, tgz_bytes.len);

        var cache_dir = tmpdir.makeOpenPath(std.mem.span(tmpname), .{ .iterate = true }) catch |err| {
            Output.panic("err: {s} when create temporary directory named {s} (while extracting {s})", .{ @errorName(err), tmpname, name });
        };
        var temp_destination = std.os.getFdPath(cache_dir.fd, &abs_buf) catch |err| {
            Output.panic("err: {s} when resolve path for temporary directory named {s} (while extracting {s})", .{ @errorName(err), tmpname, name });
        };
        cache_dir.close();

        if (verbose_install) {
            Output.prettyErrorln("[{s}] Start extracting {s}<r>", .{ name, tmpname });
            Output.flush();
        }

        const Archive = @import("../libarchive/libarchive.zig").Archive;
        const Zlib = @import("../zlib.zig");
        var zlib_pool = Npm.Registry.BodyPool.get(default_allocator);
        zlib_pool.data.reset();
        defer Npm.Registry.BodyPool.release(zlib_pool);

        var zlib_entry = try Zlib.ZlibReaderArrayList.init(tgz_bytes, &zlib_pool.data.list, default_allocator);
        zlib_entry.readAll() catch |err| {
            Output.prettyErrorln(
                "<r><red>Error {s}<r> decompressing {s}",
                .{
                    @errorName(err),
                    name,
                },
            );
            Output.flush();
            Global.crash();
        };
        const extracted_file_count = if (verbose_install)
            try Archive.extractToDisk(
                zlib_pool.data.list.items,
                temp_destination,
                null,
                void,
                void{},
                // for npm packages, the root dir is always "package"
                1,
                true,
                true,
            )
        else
            try Archive.extractToDisk(
                zlib_pool.data.list.items,
                temp_destination,
                null,
                void,
                void{},
                // for npm packages, the root dir is always "package"
                1,
                true,
                false,
            );

        if (verbose_install) {
            Output.prettyErrorln(
                "[{s}] Extracted<r>",
                .{
                    name,
                },
            );
            Output.flush();
        }

        var folder_name = PackageManager.cachedNPMPackageFolderNamePrint(&abs_buf2, name, this.version);
        if (folder_name.len == 0 or (folder_name.len == 1 and folder_name[0] == '/')) @panic("Tried to delete root and stopped it");
        PackageManager.instance.cache_directory.deleteTree(folder_name) catch {};

        // e.g. @next
        // if it's a namespace package, we need to make sure the @name folder exists
        if (basename.len != name.len) {
            PackageManager.instance.cache_directory.makeDir(std.mem.trim(u8, name[0 .. name.len - basename.len], "/")) catch {};
        }

        // Now that we've extracted the archive, we rename.
        std.os.renameatZ(tmpdir.fd, tmpname, PackageManager.instance.cache_directory.fd, folder_name) catch |err| {
            Output.prettyErrorln(
                "<r><red>Error {s}<r> moving {s} to cache dir:\n   From: {s}    To: {s}",
                .{
                    @errorName(err),
                    name,
                    tmpname,
                    folder_name,
                },
            );
            Output.flush();
            Global.crash();
        };

        // We return a resolved absolute absolute file path to the cache dir.
        // To get that directory, we open the directory again.
        var final_dir = PackageManager.instance.cache_directory.openDirZ(folder_name, .{ .iterate = true }) catch |err| {
            Output.prettyErrorln(
                "<r><red>Error {s}<r> failed to verify cache dir for {s}",
                .{
                    @errorName(err),
                    name,
                },
            );
            Output.flush();
            Global.crash();
        };
        defer final_dir.close();
        // and get the fd path
        var final_path = std.os.getFdPath(
            final_dir.fd,
            &abs_buf,
        ) catch |err| {
            Output.prettyErrorln(
                "<r><red>Error {s}<r> failed to verify cache dir for {s}",
                .{
                    @errorName(err),
                    name,
                },
            );
            Output.flush();
            Global.crash();
        };
        return try Fs.FileSystem.instance.dirname_store.append(@TypeOf(final_path), final_path);
    }
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
    pub const Id = packed struct {
        tag: Task.Tag,
        bytes: u60 = 0,

        pub fn forPackage(tag: Task.Tag, package_name: string, package_version: Semver.Version) u64 {
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(package_name);
            hasher.update("@");
            hasher.update(std.mem.asBytes(&package_version));
            return @bitCast(u64, Task.Id{ .tag = tag, .bytes = @truncate(u60, hasher.final()) });
        }

        pub fn forManifest(
            tag: Task.Tag,
            name: string,
        ) u64 {
            return @bitCast(u64, Task.Id{ .tag = tag, .bytes = @truncate(u60, std.hash.Wyhash.hash(0, name)) });
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
        }
    }

    pub const Tag = enum(u4) {
        package_manifest = 1,
        extract = 2,
    };

    pub const Status = enum {
        waiting,
        success,
        fail,
    };

    pub const Data = union {
        package_manifest: Npm.PackageManifest,
        extract: string,
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
    };
};

const TaggedPointer = @import("../tagged_pointer.zig");
const TaskCallbackContext = union(Tag) {
    package: PackageID,
    dependency: PackageID,

    pub const Tag = enum {
        package,
        dependency,
    };
};

const TaskCallbackList = std.ArrayListUnmanaged(TaskCallbackContext);
const TaskDependencyQueue = std.HashMapUnmanaged(u64, TaskCallbackList, IdentityContext(u64), 80);
const TaskChannel = sync.Channel(Task, .{ .Static = 4096 });
const NetworkChannel = sync.Channel(*NetworkTask, .{ .Static = 8192 });
const ThreadPool = @import("../thread_pool.zig");
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

    registry: Npm.Registry = Npm.Registry{},

    thread_pool: ThreadPool,

    manifests: PackageManifestMap = PackageManifestMap{},
    resolved_package_index: PackageIndex = PackageIndex{},

    task_queue: TaskDependencyQueue = TaskDependencyQueue{},
    network_task_queue: NetworkTaskQueue = .{},
    network_channel: NetworkChannel = NetworkChannel.init(),
    network_tarball_batch: ThreadPool.Batch = ThreadPool.Batch{},
    network_resolve_batch: ThreadPool.Batch = ThreadPool.Batch{},
    preallocated_network_tasks: PreallocatedNetworkTasks = PreallocatedNetworkTasks{ .buffer = undefined, .len = 0 },
    pending_tasks: u32 = 0,
    total_tasks: u32 = 0,

    lockfile: *Lockfile = undefined,

    options: Options = Options{},

    const PreallocatedNetworkTasks = std.BoundedArray(NetworkTask, 1024);
    const NetworkTaskQueue = std.HashMapUnmanaged(u64, void, IdentityContext(u64), 80);
    const PackageIndex = std.AutoHashMapUnmanaged(u64, *Package);

    const PackageDedupeList = std.HashMapUnmanaged(
        u32,
        void,
        IdentityContext(u32),
        80,
    );

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
        manifest: *const Npm.PackageManifest,
        find_result: Npm.PackageManifest.FindResult,
    ) !?ResolvedPackageResult {

        // Was this package already allocated? Let's reuse the existing one.
        if (this.lockfile.getPackageID(name_hash, find_result.version)) |id| {
            const package = this.lockfile.packages.get(id);
            return ResolvedPackageResult{
                .package = package,
                .is_first_time = false,
            };
        }

        var package = try Lockfile.Package.fromNPM(
            this.allocator,
            this.lockfile,
            this.log,
            manifest,
            find_result.version,
            find_result.package,
            manifest.string_buf,
            Features.npm,
        );
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
                const task_id = Task.Id.forPackage(Task.Tag.extract, this.lockfile.str(package.name), package.version);
                const dedupe_entry = try this.network_task_queue.getOrPut(this.allocator, task_id);

                // Assert that we don't end up downloading the tarball twice.
                std.debug.assert(!dedupe_entry.found_existing);
                var network_task = this.getNetworkTask();
                network_task.* = NetworkTask{
                    .task_id = task_id,
                    .callback = undefined,
                    .allocator = this.allocator,
                };

                try network_task.forTarball(
                    this.allocator,
                    ExtractTarball{
                        .name = if (name.len() >= strings.StringOrTinyString.Max)
                            strings.StringOrTinyString.init(try FileSystem.FilenameStore.instance.append(@TypeOf(this.lockfile.str(name)), this.lockfile.str(name)))
                        else
                            strings.StringOrTinyString.init(this.lockfile.str(name)),
                        .version = package.version,
                        .cache_dir = this.cache_directory_path,
                        .registry = this.registry.url.href,
                        .package_id = package.meta.id,
                        .extracted_file_count = find_result.package.file_count,
                        .integrity = package.meta.integrity,
                    },
                );

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

    pub fn getOrPutResolvedPackage(
        this: *PackageManager,
        name_hash: PackageNameHash,
        name: String,
        version: Dependency.Version,
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

                return try getOrPutResolvedPackageWithFindResult(this, name_hash, name, version, dependency_id, manifest, find_result);
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
            if (!dependency.behavior.isEnabled(Features.npm))
                return;
        }

        switch (dependency.version.tag) {
            .npm, .dist_tag => {
                retry_from_manifests_ptr: while (true) {
                    var resolve_result_ = this.getOrPutResolvedPackage(name_hash, name, version, id, resolution);

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
                                                name,
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
                                            "No version matching \"{s}\" found for package {s} (but package exists)",
                                            .{
                                                this.lockfile.str(version.literal),
                                                name,
                                            },
                                        ) catch unreachable;
                                    }
                                    return;
                                },
                                else => return err,
                            }
                        };

                        if (resolve_result) |result| {
                            if (result.package.isDisabled()) return;

                            // First time?
                            if (result.is_first_time) {
                                if (verbose_install) {
                                    const label: string = this.lockfile.str(version.literal);

                                    Output.prettyErrorln("   -> \"{s}\": \"{s}\" -> {s}@{}", .{
                                        this.lockfile.str(result.package.name),
                                        label,
                                        this.lockfile.str(result.package.name),
                                        result.package.version.fmt(this.lockfile.buffers.string_bytes.items),
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
                                    try this.lockfile.scratch.network_task_queue.writeItem(network_task);
                                }
                            }
                        } else {
                            const task_id = Task.Id.forManifest(Task.Tag.package_manifest, this.lockfile.str(name));
                            var network_entry = try this.network_task_queue.getOrPutContext(this.allocator, task_id, .{});
                            if (!network_entry.found_existing) {
                                if (this.options.enable.manifest_cache) {
                                    if (Npm.PackageManifest.Serializer.load(this.allocator, this.cache_directory, this.lockfile.str(name)) catch null) |manifest_| {
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
                                                    &loaded_manifest.?,
                                                    find_result,
                                                ) catch null) |new_resolve_result| {
                                                    resolve_result_ = new_resolve_result;
                                                    _ = this.network_task_queue.remove(task_id);
                                                    continue :retry_with_new_resolve_result;
                                                }
                                            }
                                        }

                                        // Was it recent enough to just load it without the network call?
                                        if (this.options.enable.manifest_cache_control and manifest.pkg.public_max_age > this.timestamp) {
                                            _ = this.network_task_queue.remove(task_id);
                                            continue :retry_from_manifests_ptr;
                                        }
                                    }
                                }

                                if (verbose_install) {
                                    Output.prettyErrorln("Enqueue package manifest for download: {s}", .{this.lockfile.str(name)});
                                }

                                var network_task = this.getNetworkTask();
                                network_task.* = NetworkTask{
                                    .callback = undefined,
                                    .task_id = task_id,
                                    .allocator = this.allocator,
                                };
                                try network_task.forManifest(this.lockfile.str(name), this.allocator, this.registry.url, loaded_manifest);
                                try this.lockfile.scratch.network_task_queue.writeItem(network_task);
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
        while (this.lockfile.scratch.network_task_queue.readItem()) |network_task| {
            network_task.schedule(if (network_task.callback == .extract) &this.network_tarball_batch else &this.network_resolve_batch);
        }
    }
    pub fn flushDependencyQueue(this: *PackageManager) void {
        this.flushNetworkQueue();

        while (this.lockfile.scratch.dependency_list_queue.readItem()) |dep_list| {
            var dependencies = this.lockfile.buffers.dependencies.items.ptr[dep_list.off .. dep_list.off + dep_list.len];
            var resolutions = this.lockfile.buffers.resolutions.items.ptr[dep_list.off .. dep_list.off + dep_list.len];

            // The slice's pointer might invalidate between runs
            // That means we have to use a fifo to enqueue the next slice
            for (dependencies) |dep, i| {
                this.enqueueDependencyWithMain(@intCast(u32, i) + dep_list.off, dep, resolutions[i], false) catch {};
            }

            this.flushNetworkQueue();
        }

        this.flushNetworkQueue();
    }

    pub fn enqueueDependencyList(this: *PackageManager, dependencies_list: Lockfile.DependencySlice, comptime is_main: bool) void {
        this.task_queue.ensureUnusedCapacity(this.allocator, dependencies_list.len) catch unreachable;

        // Step 1. Go through main dependencies
        {
            var dependencies = this.lockfile.buffers.dependencies.items.ptr[dependencies_list.off .. dependencies_list.off + dependencies_list.len];
            var resolutions = this.lockfile.buffers.resolutions.items.ptr[dependencies_list.off .. dependencies_list.off + dependencies_list.len];
            for (dependencies) |dep, i| {
                this.enqueueDependencyWithMain(dependencies_list.off + @intCast(u32, i), dep, resolutions[i], is_main) catch {};
            }
        }

        // Step 2. If there were cached dependencies, go through all of those but don't download the devDependencies for them.
        this.flushDependencyQueue();

        if (verbose_install) Output.flush();

        // It's only network requests here because we don't store tarballs.
        const count = this.network_resolve_batch.len + this.network_tarball_batch.len;
        this.pending_tasks += @truncate(u32, count);
        this.total_tasks += @truncate(u32, count);
        this.network_resolve_batch.push(this.network_tarball_batch);
        NetworkThread.global.pool.schedule(this.network_resolve_batch);
        this.network_tarball_batch = .{};
        this.network_resolve_batch = .{};
    }

    /// Hoisting means "find the topmost path to insert the node_modules folder in"
    /// We must hoist for many reasons.
    /// 1. File systems have a maximum file path length. Without hoisting, it is easy to exceed that.
    /// 2. It's faster due to fewer syscalls
    /// 3. It uses less disk space
    const NodeModulesFolder = struct {
        in: PackageID = invalid_package_id,
        dependencies: Dependency.List = .{},
        parent: ?*NodeModulesFolder = null,
        allocator: *std.mem.Allocator,
        children: std.ArrayListUnmanaged(*NodeModulesFolder) = std.ArrayListUnmanaged(*NodeModulesFolder){},

        pub const State = enum {
            /// We found a hoisting point, but it's not the root one
            /// (e.g. we're in a subdirectory of a package)
            hoist,

            /// We found the topmost hoisting point
            /// (e.g. we're in the root of a package)
            root,

            /// The parent already has the dependency, so we don't need to add it
            duplicate,

            conflict,
        };

        pub const Determination = union(State) {
            hoist: *NodeModulesFolder,
            duplicate: *NodeModulesFolder,
            root: *NodeModulesFolder,
            conflict: *NodeModulesFolder,
        };

        pub var trace_buffer: std.ArrayListUnmanaged(PackageID) = undefined;

        pub fn determine(this: *NodeModulesFolder, dependency: Dependency) Determination {
            var top = this.parent orelse return Determination{
                .root = this,
            };
            var previous_top = this;
            var last_non_dead_end = this;

            while (true) {
                if (top.dependencies.getEntry(dependency.name_hash)) |entry| {
                    const existing: Dependency = entry.value_ptr.*;
                    // Since we search breadth-first, every instance of the current dependency is already at the highest level, so long as duplicate dependencies aren't listed
                    if (existing.eqlResolved(dependency)) {
                        return Determination{
                            .duplicate = top,
                        };
                        // Assuming a dependency tree like this:
                        //  - bar@12.0.0
                        //  - foo@12.0.1
                        //          - bacon@12.0.1
                        //              - lettuce@12.0.1
                        //                  - bar@11.0.0
                        //
                        // Ideally, we place "bar@11.0.0" in "foo@12.0.1"'s node_modules folder
                        // However, "foo" may not have it's own node_modules folder at this point.
                        //
                    } else if (previous_top != top) {
                        return Determination{
                            .hoist = previous_top,
                        };
                    } else {
                        // slow path: we need to create a new node_modules folder
                        // We have to trace the path of the original dependency starting from where it was imported
                        // and find the first node_modules folder before that one

                        return Determination{
                            .conflict = entry.value_ptr,
                        };
                    }
                }

                if (top.parent) |parent| {
                    previous_top = top;
                    top = parent;
                    continue;
                }

                return Determination{
                    .root = top,
                };
            }

            unreachable;
        }
    };

    pub fn hoist(this: *PackageManager) !void {
        // NodeModulesFolder.trace_buffer = std.ArrayList(PackageID).init(this.allocator);

        // const DependencyQueue = std.fifo.LinearFifo(*Dependency.List, .{ .Dynamic = .{} });

        // const PackageVisitor = struct {
        //     visited: std.DynamicBitSet,
        //     log: *logger.Log,
        //     allocator: *std.mem.Allocator,

        //     /// Returns a new parent NodeModulesFolder
        //     pub fn visitDependencyList(
        //         visitor: *PackageVisitor,
        //         modules: *NodeModulesFolder,
        //         dependency_list: *Dependency.List,
        //     ) ?NodeModulesFolder {
        //         const dependencies = dependency_list.values();
        //         var i: usize = 0;
        //         while (i < dependencies.len) : (i += 1) {
        //             const dependency = dependencies[i];
        //             switch (modules.determine(dependency)) {
        //                 .hoist => |target| {
        //                     var entry = target.dependencies.getOrPut(visitor.allocator, dependency.name_hash) catch unreachable;
        //                     entry.value_ptr.* = dependency;
        //                 },
        //                 .root => |target| {
        //                     var entry = target.dependencies.getOrPut(visitor.allocator, dependency.name_hash) catch unreachable;
        //                     entry.value_ptr.* = dependency;
        //                 },
        //                 .conflict => |conflict| {
        //                     // When there's a conflict, it means we must create a new node_modules folder
        //                     // however, since the tree is already flattened ahead of time, we don't know where to put it...
        //                     var child_folder = NodeModulesFolder{
        //                         .parent = modules,
        //                         .allocator = visitor.allocator,
        //                         .in = dependency.resolution,
        //                         .dependencies = .{},
        //                     };
        //                     child_folder.dependencies.append(dependency) catch unreachable;
        //                 },
        //             }
        //         }
        //     }
        // };
    }
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

    fn loadAllDependencies(this: *PackageManager) !void {}
    fn installDependencies(this: *PackageManager) !void {}

    fn runTasks(manager: *PackageManager) !void {
        var batch = ThreadPool.Batch{};

        while (manager.network_channel.tryReadItem() catch null) |task_| {
            var task: *NetworkTask = task_;
            manager.pending_tasks -= 1;

            switch (task.callback) {
                .package_manifest => |manifest_req| {
                    const name = manifest_req.name;
                    const response = task.http.response orelse {
                        Output.prettyErrorln("Failed to download package manifest for package {s}", .{name});
                        Output.flush();
                        continue;
                    };

                    if (response.status_code > 399) {
                        Output.prettyErrorln(
                            "<r><red><b>GET<r><red> {s}<d>  - {d}<r>",
                            .{
                                name,
                                response.status_code,
                            },
                        );
                        Output.flush();
                        continue;
                    }

                    if (verbose_install) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@floatCast(f64, @intToFloat(f128, task.http.elapsed) / std.time.ns_per_ms));
                        Output.prettyError(" <d>Downloaded <r><green>{s}<r> versions\n", .{name.slice()});
                        Output.flush();
                    }

                    if (response.status_code == 304) {
                        // The HTTP request was cached
                        if (manifest_req.loaded_manifest) |manifest| {
                            var entry = try manager.manifests.getOrPut(manager.allocator, @truncate(u32, manifest.pkg.name.hash));
                            entry.value_ptr.* = manifest;
                            entry.value_ptr.*.pkg.public_max_age = @truncate(u32, @intCast(u64, @maximum(0, std.time.timestamp()))) + 300;
                            {
                                var tmpdir = Fs.FileSystem.instance.tmpdir();
                                Npm.PackageManifest.Serializer.save(entry.value_ptr, tmpdir, PackageManager.instance.cache_directory) catch {};
                            }

                            const dependency_list = manager.task_queue.get(task.task_id).?;

                            for (dependency_list.items) |item| {
                                var dependency = manager.lockfile.buffers.dependencies.items[item.dependency];
                                var resolution = manager.lockfile.buffers.resolutions.items[item.dependency];

                                try manager.enqueueDependency(
                                    item.dependency,
                                    dependency,
                                    resolution,
                                );
                            }
                            manager.flushDependencyQueue();
                            continue;
                        }
                    }

                    batch.push(ThreadPool.Batch.from(manager.enqueueParseNPMPackage(task.task_id, name, task)));
                },
                .extract => |extract| {
                    const response = task.http.response orelse {
                        Output.prettyErrorln("Failed to download package tarball for package {s}", .{extract.name});
                        Output.flush();
                        continue;
                    };

                    if (response.status_code > 399) {
                        Output.prettyErrorln(
                            "<r><red><b>GET<r><red> {s}<d>  - {d}<r>",
                            .{
                                task.http.url.href,
                                response.status_code,
                            },
                        );
                        Output.flush();
                        continue;
                    }

                    if (verbose_install) {
                        Output.prettyError("    ", .{});
                        Output.printElapsed(@floatCast(f64, @intToFloat(f128, task.http.elapsed) / std.time.ns_per_ms));
                        Output.prettyError(" <d>Downloaded <r><green>{s}<r> tarball\n", .{extract.name.slice()});
                        Output.flush();
                    }

                    batch.push(ThreadPool.Batch.from(manager.enqueueExtractNPMPackage(extract, task)));
                },
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
                        Output.prettyErrorln("Failed to parse package manifest for {s}", .{task.request.package_manifest.name.slice()});
                        Output.flush();
                        continue;
                    }
                    const manifest = task.data.package_manifest;
                    var entry = try manager.manifests.getOrPutValue(manager.allocator, @truncate(PackageNameHash, manifest.pkg.name.hash), manifest);
                    const dependency_list = manager.task_queue.get(task.id).?;

                    for (dependency_list.items) |item| {
                        var dependency = manager.lockfile.buffers.dependencies.items[item.dependency];
                        var resolution = manager.lockfile.buffers.resolutions.items[item.dependency];

                        try manager.enqueueDependency(
                            item.dependency,
                            dependency,
                            resolution,
                        );
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
                    manager.extracted_count += 1;
                    manager.lockfile.packages.items(.meta)[task.request.extract.tarball.package_id].preinstall_state = .done;
                },
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
        }
    }

    pub const Options = struct {
        verbose: bool = false,
        lockfile_path: stringZ = Lockfile.default_filename,
        save_lockfile_path: stringZ = Lockfile.default_filename,
        registry_url: URL = URL.parse("https://registry.npmjs.org/"),
        cache_directory: string = "",
        enable: Enable = .{},
        do: Do = .{},

        pub fn load(this: *Options, allocator: *std.mem.Allocator, log: *logger.Log, env_loader: *DotEnv.Loader) !void {
            // technically, npm_config is case in-sensitive
            // load_registry:
            {
                const registry_keys = [_]string{
                    "BUN_CONFIG_REGISTRY",
                    "NPM_CONFIG_REGISTRY",
                    "npm_config_registry",
                };

                inline for (registry_keys) |registry_key| {
                    if (env_loader.map.get(registry_key)) |registry_| {
                        if (registry_.len > 0 and
                            (strings.startsWith(registry_, "https://") or
                            strings.startsWith(registry_, "http://")))
                        {
                            this.registry_url = URL.parse(registry_);
                            // stage1 bug: break inside inline is broken
                            // break :load_registry;
                        }
                    }
                }
            }

            this.save_lockfile_path = this.lockfile_path;
            if (env_loader.map.get("BUN_CONFIG_LOCKFILE_SAVE_PATH")) |save_lockfile_path| {
                this.save_lockfile_path = try allocator.dupeZ(u8, save_lockfile_path);
            }

            this.do.save_lockfile = strings.eqlComptime((env_loader.map.get("BUN_CONFIG_SKIP_SAVE_LOCKFILE") orelse "0"), "0");
            this.do.load_lockfile = strings.eqlComptime((env_loader.map.get("BUN_CONFIG_SKIP_LOAD_LOCKFILE") orelse "0"), "0");
            this.do.install_packages = strings.eqlComptime((env_loader.map.get("BUN_CONFIG_SKIP_INSTALL_PACKAGES") orelse "0"), "0");
        }

        pub const Do = struct {
            save_lockfile: bool = true,
            load_lockfile: bool = true,
            install_packages: bool = true,
        };

        pub const Enable = struct {
            manifest_cache: bool = true,
            manifest_cache_control: bool = true,
            cache: bool = true,
        };
    };

    var cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    var package_json_cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    pub fn install(
        ctx: Command.Context,
    ) !void {
        var fs = try Fs.FileSystem.init1(ctx.allocator, null);
        var original_cwd = std.mem.trimRight(u8, fs.top_level_dir, "/");

        std.mem.copy(u8, &cwd_buf, original_cwd);

        // Step 1. Find the nearest package.json directory
        //
        // We will walk up from the cwd, calling chdir on each directory until we find a package.json
        // If we fail to find one, we will report an error saying no packages to install
        var package_json_file: std.fs.File = brk: {
            break :brk std.fs.cwd().openFileZ("package.json", .{ .read = true, .write = true }) catch |err2| {
                var this_cwd = original_cwd;
                outer: while (std.fs.path.dirname(this_cwd)) |parent| {
                    cwd_buf[parent.len] = 0;
                    var chdir = cwd_buf[0..parent.len :0];

                    std.os.chdirZ(chdir) catch |err| {
                        Output.prettyErrorln("Error {s} while chdir - {s}", .{ @errorName(err), chdir });
                        Output.flush();
                        return;
                    };

                    break :brk std.fs.cwd().openFileZ("package.json", .{ .read = true, .write = true }) catch |err| {
                        this_cwd = parent;
                        continue :outer;
                    };
                }

                Output.prettyErrorln("<r><green>No package.json<r> Nothing to install.", .{});
                Output.flush();
                return;
            };
        };

        fs.top_level_dir = try std.os.getcwd(&cwd_buf);
        cwd_buf[fs.top_level_dir.len] = '/';
        cwd_buf[fs.top_level_dir.len + 1] = 0;
        fs.top_level_dir = cwd_buf[0 .. fs.top_level_dir.len + 1];
        std.mem.copy(u8, &package_json_cwd_buf, fs.top_level_dir);
        std.mem.copy(u8, package_json_cwd_buf[fs.top_level_dir.len..], "package.json");
        var package_json_contents = package_json_file.readToEndAlloc(ctx.allocator, std.math.maxInt(usize)) catch |err| {
            Output.prettyErrorln("<r><red>{s} reading package.json<r> :(", .{@errorName(err)});
            Output.flush();
            return;
        };
        // Step 2. Parse the package.json file
        //
        var package_json_source = logger.Source.initPathString(
            package_json_cwd_buf[0 .. fs.top_level_dir.len + "package.json".len],
            package_json_contents,
        );

        var env_loader: *DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            var loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };

        var entries_option = try fs.fs.readDirectory(fs.top_level_dir, null);
        var options = Options{};
        var cache_directory: std.fs.Dir = undefined;
        env_loader.loadProcess();
        try env_loader.load(&fs.fs, &entries_option.entries, false);

        if (env_loader.map.get("BUN_INSTALL_VERBOSE") != null) {
            verbose_install = true;
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

        if (verbose_install) {
            Output.prettyErrorln("Cache Dir: {s}", .{options.cache_directory});
            Output.flush();
        }

        var cpu_count = @truncate(u32, ((try std.Thread.getCpuCount()) + 1) / 2);

        if (env_loader.map.get("GOMAXPROCS")) |max_procs| {
            if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count_| {
                cpu_count = @minimum(cpu_count, cpu_count_);
            } else |err| {}
        }

        try NetworkThread.init();

        var manager = &instance;
        // var progress = std.Progress{};
        // var node = progress.start(name: []const u8, estimated_total_items: usize)
        manager.* = PackageManager{
            .options = options,
            .cache_directory = cache_directory,
            .env_loader = env_loader,
            .allocator = ctx.allocator,
            .log = ctx.log,
            .root_dir = &entries_option.entries,
            .thread_pool = ThreadPool.init(.{
                .max_threads = cpu_count,
            }),
            .resolve_tasks = TaskChannel.init(),
            .lockfile = undefined,
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
        );

        manager.timestamp = @truncate(u32, @intCast(u64, @maximum(std.time.timestamp(), 0)));

        var load_lockfile_result: Lockfile.LoadFromDiskResult = if (manager.options.do.load_lockfile)
            Lockfile.loadFromDisk(ctx.allocator, ctx.log, manager.options.lockfile_path)
        else
            Lockfile.LoadFromDiskResult{ .not_found = .{} };

        var root = Lockfile.Package{};

        var needs_new_lockfile = load_lockfile_result != .ok;

        var diffs = Lockfile.Package.Diff.List.init(ctx.allocator);

        switch (load_lockfile_result) {
            .err => |cause| {
                switch (cause.step) {
                    .open_file => Output.prettyErrorln("<r><red>error opening lockfile:<r> {s}. Discarding lockfile.", .{
                        @errorName(cause.value),
                    }),
                    .parse_file => Output.prettyErrorln("<r><red>error parsing lockfile:<r> {s}. Discarding lockfile.", .{
                        @errorName(cause.value),
                    }),
                    .read_file => Output.prettyErrorln("<r><red>error reading lockfile:<r> {s}. Discarding lockfile.", .{
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
                    try Lockfile.Package.parse(
                        &lockfile,
                        &new_root,
                        ctx.allocator,
                        ctx.log,
                        package_json_source,
                        Features{
                            .optional_dependencies = true,
                            .dev_dependencies = true,
                            .is_main = true,
                        },
                    );
                    manager.lockfile.* = load_lockfile_result.ok;

                    manager.summary = try Package.Diff.generate(
                        ctx.allocator,
                        &diffs,
                        manager.lockfile,
                        &lockfile,
                        &root,
                        &new_root,
                    );
                }
            },
            else => {},
        }

        while (diffs.readItem()) |diff| {
            manager.lockfile.applyDiff(&diffs, diff);
        }

        if (needs_new_lockfile) {
            root = Lockfile.Package{};
            try manager.lockfile.initEmpty(ctx.allocator);
            try Lockfile.Package.parse(
                manager.lockfile,
                &root,
                ctx.allocator,
                ctx.log,
                package_json_source,
                Features{
                    .optional_dependencies = true,
                    .dev_dependencies = true,
                    .is_main = true,
                },
            );

            root = try manager.lockfile.appendPackage(root);
            manager.enqueueDependencyList(
                root.dependencies,
                true,
            );
        }

        while (manager.pending_tasks > 0) {
            try manager.runTasks();
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

        try manager.lockfile.clean();

        try manager.hoist();
        try manager.link();

        if (manager.options.do.save_lockfile)
            manager.lockfile.saveToDisk(manager.options.save_lockfile_path);

        if (needs_new_lockfile) {
            manager.summary.add = @truncate(u32, manager.lockfile.packages.len);
        }

        Output.prettyln("   <green>+{d}<r> add | <cyan>{d}<r> update | <r><red>-{d}<r> remove", .{ manager.summary.add, manager.summary.update, manager.summary.remove });
        Output.flush();
    }
};

var verbose_install = false;

test "getPackageMetadata" {
    Output.initTest();

    var registry = Npm.Registry{};
    var log = logger.Log.init(default_allocator);

    var response = try registry.getPackageMetadata(default_allocator, &log, "react", "", "");

    switch (response) {
        .cached, .not_found => unreachable,
        .fresh => |package| {
            package.reportSize();
            const react = package.findByString("beta") orelse return try std.testing.expect(false);
            try std.testing.expect(react.package.file_count > 0);
            try std.testing.expect(react.package.unpacked_size > 0);
            // try std.testing.expectEqualStrings("loose-envify", entry.slice(package.string_buf));
        },
    }
}

test "dumb wyhash" {
    var i: usize = 0;
    var j: usize = 0;
    var z: usize = 0;

    while (i < 100) {
        j = 0;
        while (j < 100) {
            while (z < 100) {
                try std.testing.expectEqual(
                    std.hash.Wyhash.hash(0, try std.fmt.allocPrint(default_allocator, "{d}.{d}.{d}", .{ i, j, z })),
                    std.hash.Wyhash.hash(0, try std.fmt.allocPrint(default_allocator, "{d}.{d}.{d}", .{ i, j, z })),
                );
                z += 1;
            }
            j += 1;
        }
        i += 1;
    }
}

const Package = Lockfile.Package;
