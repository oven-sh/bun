const std = @import("std");

const bun = @import("bun");
const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;
const HeaderBuilder = HTTP.HeaderBuilder;
const MutableString = bun.MutableString;
const strings = bun.strings;
const string = bun.string;
const logger = bun.logger;
const ThreadPool = bun.ThreadPool;
const Output = bun.Output;
const OOM = bun.OOM;
const Semver = bun.Semver;
const GlobalStringBuilder = bun.StringBuilder;
const Path = bun.path;
const File = bun.sys.File;

const DotEnv = @import("../env_loader.zig");
const Fs = @import("../fs.zig");
const FileSystem = Fs.FileSystem;
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const URL = @import("../url.zig").URL;
const ExtractTarball = @import("./extract_tarball.zig");
const install = @import("./install.zig");
const PackageManager = install.PackageManager;
const PackageID = install.PackageID;
const ExtractData = install.ExtractData;
const invalid_package_id = install.invalid_package_id;
const DependencyID = @import("./install.zig").DependencyID;
const Npm = @import("./npm.zig");
const patch = @import("./patch_install.zig");
const PatchTask = patch.PatchTask;
pub const Repository = @import("./repository.zig").Repository;
const Resolution = @import("./resolution.zig").Resolution;

pub const NetworkTask = struct {
    unsafe_http_client: AsyncHTTP = undefined,
    response: bun.http.HTTPClientResult = .{},
    task_id: u64,
    url_buf: []const u8 = &[_]u8{},
    retried: u16 = 0,
    allocator: std.mem.Allocator,
    request_buffer: MutableString = undefined,
    response_buffer: MutableString = undefined,
    package_manager: *PackageManager,
    callback: union(Task.Tag) {
        package_manifest: struct {
            loaded_manifest: ?Npm.PackageManifest = null,
            name: strings.StringOrTinyString,
        },
        extract: ExtractTarball,
        git_clone: void,
        git_checkout: void,
        local_tarball: void,
    },
    /// Key in patchedDependencies in package.json
    apply_patch_task: ?*PatchTask = null,
    next: ?*NetworkTask = null,

    pub const DedupeMapEntry = struct {
        is_required: bool,
    };
    pub const DedupeMap = std.HashMap(u64, DedupeMapEntry, IdentityContext(u64), 80);

    pub fn notify(this: *NetworkTask, async_http: *AsyncHTTP, result: bun.http.HTTPClientResult) void {
        defer this.package_manager.wake();
        async_http.real.?.* = async_http.*;
        async_http.real.?.response_buffer = async_http.response_buffer;
        this.response = result;
        this.package_manager.async_network_task_queue.push(this);
    }

    pub const Authorization = enum {
        no_authorization,
        allow_authorization,
    };

    // We must use a less restrictive Accept header value
    // https://github.com/oven-sh/bun/issues/341
    // https://www.jfrog.com/jira/browse/RTFACT-18398
    const accept_header_value = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

    const default_headers_buf: string = "Accept" ++ accept_header_value;

    fn appendAuth(header_builder: *HeaderBuilder, scope: *const Npm.Registry.Scope) void {
        if (scope.token.len > 0) {
            header_builder.appendFmt("Authorization", "Bearer {s}", .{scope.token});
        } else if (scope.auth.len > 0) {
            header_builder.appendFmt("Authorization", "Basic {s}", .{scope.auth});
        } else {
            return;
        }
        header_builder.append("npm-auth-type", "legacy");
    }

    fn countAuth(header_builder: *HeaderBuilder, scope: *const Npm.Registry.Scope) void {
        if (scope.token.len > 0) {
            header_builder.count("Authorization", "");
            header_builder.content.cap += "Bearer ".len + scope.token.len;
        } else if (scope.auth.len > 0) {
            header_builder.count("Authorization", "");
            header_builder.content.cap += "Basic ".len + scope.auth.len;
        } else {
            return;
        }
        header_builder.count("npm-auth-type", "legacy");
    }

    pub fn forManifest(
        this: *NetworkTask,
        name: string,
        allocator: std.mem.Allocator,
        scope: *const Npm.Registry.Scope,
        loaded_manifest: ?*const Npm.PackageManifest,
        is_optional: bool,
    ) !void {
        this.url_buf = blk: {

            // Not all registries support scoped package names when fetching the manifest.
            // registry.npmjs.org supports both "@storybook%2Faddons" and "@storybook/addons"
            // Other registries like AWS codeartifact only support the former.
            // "npm" CLI requests the manifest with the encoded name.
            var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            var stack_fallback_allocator = std.heap.stackFallback(512, arena.allocator());
            var encoded_name = name;
            if (strings.containsChar(name, '/')) {
                encoded_name = try std.mem.replaceOwned(u8, stack_fallback_allocator.get(), name, "/", "%2f");
            }

            const tmp = bun.JSC.URL.join(
                bun.String.fromUTF8(scope.url.href),
                bun.String.fromUTF8(encoded_name),
            );
            defer tmp.deref();

            if (tmp.tag == .Dead) {
                if (!is_optional) {
                    this.package_manager.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "Failed to join registry {} and package {} URLs",
                        .{ bun.fmt.QuotedFormatter{ .text = scope.url.href }, bun.fmt.QuotedFormatter{ .text = name } },
                    ) catch bun.outOfMemory();
                } else {
                    this.package_manager.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "Failed to join registry {} and package {} URLs",
                        .{ bun.fmt.QuotedFormatter{ .text = scope.url.href }, bun.fmt.QuotedFormatter{ .text = name } },
                    ) catch bun.outOfMemory();
                }
                return error.InvalidURL;
            }

            if (!(tmp.hasPrefixComptime("https://") or tmp.hasPrefixComptime("http://"))) {
                if (!is_optional) {
                    this.package_manager.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "Registry URL must be http:// or https://\nReceived: \"{}\"",
                        .{tmp},
                    ) catch bun.outOfMemory();
                } else {
                    this.package_manager.log.addWarningFmt(
                        null,
                        logger.Loc.Empty,
                        allocator,
                        "Registry URL must be http:// or https://\nReceived: \"{}\"",
                        .{tmp},
                    ) catch bun.outOfMemory();
                }
                return error.InvalidURL;
            }

            // This actually duplicates the string! So we defer deref the WTF managed one above.
            break :blk try tmp.toOwnedSlice(allocator);
        };

        var last_modified: string = "";
        var etag: string = "";
        if (loaded_manifest) |manifest| {
            last_modified = manifest.pkg.last_modified.slice(manifest.string_buf);
            etag = manifest.pkg.etag.slice(manifest.string_buf);
        }

        var header_builder = HeaderBuilder{};

        countAuth(&header_builder, scope);

        if (etag.len != 0) {
            header_builder.count("If-None-Match", etag);
        }

        if (last_modified.len != 0) {
            header_builder.count("If-Modified-Since", last_modified);
        }

        if (header_builder.header_count > 0) {
            header_builder.count("Accept", accept_header_value);
            if (last_modified.len > 0 and etag.len > 0) {
                header_builder.content.count(last_modified);
            }
            try header_builder.allocate(allocator);

            appendAuth(&header_builder, scope);

            if (etag.len != 0) {
                header_builder.append("If-None-Match", etag);
            } else if (last_modified.len != 0) {
                header_builder.append("If-Modified-Since", last_modified);
            }

            header_builder.append("Accept", accept_header_value);

            if (last_modified.len > 0 and etag.len > 0) {
                last_modified = header_builder.content.append(last_modified);
            }
        } else {
            try header_builder.entries.append(
                allocator,
                .{
                    .name = .{ .offset = 0, .length = @as(u32, @truncate("Accept".len)) },
                    .value = .{ .offset = "Accept".len, .length = @as(u32, @truncate(default_headers_buf.len - "Accept".len)) },
                },
            );
            header_builder.header_count = 1;
            header_builder.content = GlobalStringBuilder{ .ptr = @as([*]u8, @ptrFromInt(@intFromPtr(bun.span(default_headers_buf).ptr))), .len = default_headers_buf.len, .cap = default_headers_buf.len };
        }

        this.response_buffer = try MutableString.init(allocator, 0);
        this.allocator = allocator;

        const url = URL.parse(this.url_buf);
        this.unsafe_http_client = AsyncHTTP.init(allocator, .GET, url, header_builder.entries, header_builder.content.ptr.?[0..header_builder.content.len], &this.response_buffer, "", this.getCompletionCallback(), HTTP.FetchRedirect.follow, .{
            .http_proxy = this.package_manager.httpProxy(url),
        });
        this.unsafe_http_client.client.flags.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();

        if (PackageManager.verbose_install) {
            this.unsafe_http_client.client.verbose = .headers;
        }

        this.callback = .{
            .package_manifest = .{
                .name = try strings.StringOrTinyString.initAppendIfNeeded(name, *FileSystem.FilenameStore, FileSystem.FilenameStore.instance),
                .loaded_manifest = if (loaded_manifest) |manifest| manifest.* else null,
            },
        };

        if (PackageManager.verbose_install) {
            this.unsafe_http_client.verbose = .headers;
            this.unsafe_http_client.client.verbose = .headers;
        }

        // Incase the ETag causes invalidation, we fallback to the last modified date.
        if (last_modified.len != 0 and bun.getRuntimeFeatureFlag(.BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304)) {
            this.unsafe_http_client.client.flags.force_last_modified = true;
            this.unsafe_http_client.client.if_modified_since = last_modified;
        }
    }

    pub fn getCompletionCallback(this: *NetworkTask) HTTP.HTTPClientResult.Callback {
        return HTTP.HTTPClientResult.Callback.New(*NetworkTask, notify).init(this);
    }

    pub fn schedule(this: *NetworkTask, batch: *ThreadPool.Batch) void {
        this.unsafe_http_client.schedule(this.allocator, batch);
    }

    pub const ForTarballError = OOM || error{
        InvalidURL,
    };

    pub fn forTarball(
        this: *NetworkTask,
        allocator: std.mem.Allocator,
        tarball_: *const ExtractTarball,
        scope: *const Npm.Registry.Scope,
        authorization: NetworkTask.Authorization,
    ) ForTarballError!void {
        this.callback = .{ .extract = tarball_.* };
        const tarball = &this.callback.extract;
        const tarball_url = tarball.url.slice();
        if (tarball_url.len == 0) {
            this.url_buf = try ExtractTarball.buildURL(
                scope.url.href,
                tarball.name,
                tarball.resolution.value.npm.version,
                this.package_manager.lockfile.buffers.string_bytes.items,
            );
        } else {
            this.url_buf = tarball_url;
        }

        if (!(strings.hasPrefixComptime(this.url_buf, "https://") or strings.hasPrefixComptime(this.url_buf, "http://"))) {
            const msg = .{
                .fmt = "Expected tarball URL to start with https:// or http://, got {} while fetching package {}",
                .args = .{ bun.fmt.QuotedFormatter{ .text = this.url_buf }, bun.fmt.QuotedFormatter{ .text = tarball.name.slice() } },
            };

            try this.package_manager.log.addErrorFmt(null, .{}, allocator, msg.fmt, msg.args);
            return error.InvalidURL;
        }

        this.response_buffer = MutableString.initEmpty(allocator);
        this.allocator = allocator;

        var header_builder = HeaderBuilder{};
        var header_buf: string = "";

        if (authorization == .allow_authorization) {
            countAuth(&header_builder, scope);
        }

        if (header_builder.header_count > 0) {
            try header_builder.allocate(allocator);

            if (authorization == .allow_authorization) {
                appendAuth(&header_builder, scope);
            }

            header_buf = header_builder.content.ptr.?[0..header_builder.content.len];
        }

        const url = URL.parse(this.url_buf);

        this.unsafe_http_client = AsyncHTTP.init(allocator, .GET, url, header_builder.entries, header_buf, &this.response_buffer, "", this.getCompletionCallback(), HTTP.FetchRedirect.follow, .{
            .http_proxy = this.package_manager.httpProxy(url),
        });
        this.unsafe_http_client.client.flags.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();
        if (PackageManager.verbose_install) {
            this.unsafe_http_client.client.verbose = .headers;
        }
    }
};

/// Schedule long-running callbacks for a task
/// Slow stuff is broken into tasks, each can run independently without locks
pub const Task = struct {
    tag: Tag,
    request: Request,
    data: Data,
    status: Status = Status.waiting,
    threadpool_task: ThreadPool.Task = ThreadPool.Task{ .callback = &callback },
    log: logger.Log,
    id: u64,
    err: ?anyerror = null,
    package_manager: *PackageManager,
    apply_patch_task: ?*PatchTask = null,
    next: ?*Task = null,

    /// An ID that lets us register a callback without keeping the same pointer around
    pub fn NewID(comptime Hasher: type, comptime IDType: type) type {
        return struct {
            pub const Type = IDType;
            pub fn forNPMPackage(package_name: string, package_version: Semver.Version) IDType {
                var hasher = Hasher.init(0);
                hasher.update("npm-package:");
                hasher.update(package_name);
                hasher.update("@");
                hasher.update(std.mem.asBytes(&package_version));
                return hasher.final();
            }

            pub fn forBinLink(package_id: PackageID) IDType {
                var hasher = Hasher.init(0);
                hasher.update("bin-link:");
                hasher.update(std.mem.asBytes(&package_id));
                return hasher.final();
            }

            pub fn forManifest(name: string) IDType {
                var hasher = Hasher.init(0);
                hasher.update("manifest:");
                hasher.update(name);
                return hasher.final();
            }

            pub fn forTarball(url: string) IDType {
                var hasher = Hasher.init(0);
                hasher.update("tarball:");
                hasher.update(url);
                return hasher.final();
            }

            // These cannot change:
            // We persist them to the filesystem.
            pub fn forGitClone(url: string) IDType {
                var hasher = Hasher.init(0);
                hasher.update(url);
                return @as(u64, 4 << 61) | @as(u64, @as(u61, @truncate(hasher.final())));
            }

            pub fn forGitCheckout(url: string, resolved: string) IDType {
                var hasher = Hasher.init(0);
                hasher.update(url);
                hasher.update("@");
                hasher.update(resolved);
                return @as(u64, 5 << 61) | @as(u64, @as(u61, @truncate(hasher.final())));
            }
        };
    }
    pub const Id = NewID(bun.Wyhash11, u64);

    pub fn callback(task: *ThreadPool.Task) void {
        Output.Source.configureThread();
        defer Output.flush();

        var this: *Task = @fieldParentPtr("threadpool_task", task);
        const manager = this.package_manager;
        defer {
            if (this.status == .success) {
                if (this.apply_patch_task) |pt| {
                    defer pt.deinit();
                    pt.apply() catch bun.outOfMemory();
                    if (pt.callback.apply.logger.errors > 0) {
                        defer pt.callback.apply.logger.deinit();
                        // this.log.addErrorFmt(null, logger.Loc.Empty, bun.default_allocator, "failed to apply patch: {}", .{e}) catch unreachable;
                        pt.callback.apply.logger.print(Output.errorWriter()) catch {};
                    }
                }
            }
            manager.resolve_tasks.push(this);
            manager.wake();
        }

        switch (this.tag) {
            .package_manifest => {
                const allocator = bun.default_allocator;
                var manifest = &this.request.package_manifest;
                const body = manifest.network.response_buffer.move();

                defer {
                    bun.default_allocator.free(body);
                }

                const package_manifest = Npm.Registry.getPackageMetadata(
                    allocator,
                    manager.scopeForPackageName(manifest.name.slice()),
                    (manifest.network.response.metadata orelse @panic("Assertion failure: Expected metadata to be set")).response,
                    body,
                    &this.log,
                    manifest.name.slice(),
                    manifest.network.callback.package_manifest.loaded_manifest,
                    manager,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .package_manifest = .{} };
                    return;
                };

                switch (package_manifest) {
                    .fresh, .cached => |result| {
                        this.status = Status.success;
                        this.data = .{ .package_manifest = result };
                        return;
                    },
                    .not_found => {
                        this.log.addErrorFmt(null, logger.Loc.Empty, allocator, "404 - GET {s}", .{
                            this.request.package_manifest.name.slice(),
                        }) catch unreachable;
                        this.status = Status.fail;
                        this.data = .{ .package_manifest = .{} };
                        return;
                    },
                }
            },
            .extract => {
                const bytes = this.request.extract.network.response_buffer.move();

                defer {
                    bun.default_allocator.free(bytes);
                }

                const result = this.request.extract.tarball.run(
                    &this.log,
                    bytes,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .extract = .{} };
                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
            },
            .git_clone => {
                const name = this.request.git_clone.name.slice();
                const url = this.request.git_clone.url.slice();
                var attempt: u8 = 1;
                const dir = brk: {
                    if (Repository.tryHTTPS(url)) |https| break :brk Repository.download(
                        manager.allocator,
                        this.request.git_clone.env,
                        &this.log,
                        manager.getCacheDirectory(),
                        this.id,
                        name,
                        https,
                        attempt,
                    ) catch |err| {
                        // Exit early if git checked and could
                        // not find the repository, skip ssh
                        if (err == error.RepositoryNotFound) {
                            this.err = err;
                            this.status = Status.fail;
                            this.data = .{ .git_clone = bun.invalid_fd };

                            return;
                        }

                        attempt += 1;
                        break :brk null;
                    };
                    break :brk null;
                } orelse if (Repository.trySSH(url)) |ssh| Repository.download(
                    manager.allocator,
                    this.request.git_clone.env,
                    &this.log,
                    manager.getCacheDirectory(),
                    this.id,
                    name,
                    ssh,
                    attempt,
                ) catch |err| {
                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .git_clone = bun.invalid_fd };

                    return;
                } else {
                    return;
                };

                this.data = .{ .git_clone = .fromStdDir(dir) };
                this.status = Status.success;
            },
            .git_checkout => {
                const git_checkout = &this.request.git_checkout;
                const data = Repository.checkout(
                    manager.allocator,
                    this.request.git_checkout.env,
                    &this.log,
                    manager.getCacheDirectory(),
                    git_checkout.repo_dir.stdDir(),
                    git_checkout.name.slice(),
                    git_checkout.url.slice(),
                    git_checkout.resolved.slice(),
                ) catch |err| {
                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .git_checkout = .{} };

                    return;
                };

                this.data = .{
                    .git_checkout = data,
                };
                this.status = Status.success;
            },
            .local_tarball => {
                const workspace_pkg_id = manager.lockfile.getWorkspacePkgIfWorkspaceDep(this.request.local_tarball.tarball.dependency_id);

                var abs_buf: bun.PathBuffer = undefined;
                const tarball_path, const normalize = if (workspace_pkg_id != invalid_package_id) tarball_path: {
                    const workspace_res = manager.lockfile.packages.items(.resolution)[workspace_pkg_id];

                    if (workspace_res.tag != .workspace) break :tarball_path .{ this.request.local_tarball.tarball.url.slice(), true };

                    // Construct an absolute path to the tarball.
                    // Normally tarball paths are always relative to the root directory, but if a
                    // workspace depends on a tarball path, it should be relative to the workspace.
                    const workspace_path = workspace_res.value.workspace.slice(manager.lockfile.buffers.string_bytes.items);
                    break :tarball_path .{
                        Path.joinAbsStringBuf(
                            FileSystem.instance.top_level_dir,
                            &abs_buf,
                            &[_][]const u8{
                                workspace_path,
                                this.request.local_tarball.tarball.url.slice(),
                            },
                            .auto,
                        ),
                        false,
                    };
                } else .{ this.request.local_tarball.tarball.url.slice(), true };

                const result = readAndExtract(
                    manager.allocator,
                    &this.request.local_tarball.tarball,
                    tarball_path,
                    normalize,
                    &this.log,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .extract = .{} };

                    return;
                };

                this.data = .{ .extract = result };
                this.status = Status.success;
            },
        }
    }

    fn readAndExtract(
        allocator: std.mem.Allocator,
        tarball: *const ExtractTarball,
        tarball_path: string,
        normalize: bool,
        log: *logger.Log,
    ) !ExtractData {
        const bytes = if (normalize)
            try File.readFromUserInput(std.fs.cwd(), tarball_path, allocator).unwrap()
        else
            try File.readFrom(bun.FD.cwd(), tarball_path, allocator).unwrap();
        defer allocator.free(bytes);
        return tarball.run(log, bytes);
    }

    pub const Tag = enum(u3) {
        package_manifest = 0,
        extract = 1,
        git_clone = 2,
        git_checkout = 3,
        local_tarball = 4,
    };

    pub const Status = enum {
        waiting,
        success,
        fail,
    };

    pub const Data = union {
        package_manifest: Npm.PackageManifest,
        extract: ExtractData,
        git_clone: bun.FileDescriptor,
        git_checkout: ExtractData,
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
        git_clone: struct {
            name: strings.StringOrTinyString,
            url: strings.StringOrTinyString,
            env: DotEnv.Map,
            dep_id: DependencyID,
            res: Resolution,
        },
        git_checkout: struct {
            repo_dir: bun.FileDescriptor,
            dependency_id: DependencyID,
            name: strings.StringOrTinyString,
            url: strings.StringOrTinyString,
            resolved: strings.StringOrTinyString,
            resolution: Resolution,
            env: DotEnv.Map,
        },
        local_tarball: struct {
            tarball: ExtractTarball,
        },
    };
};
