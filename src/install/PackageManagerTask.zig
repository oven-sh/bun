//! Schedule long-running callbacks for a task
//! Slow stuff is broken into tasks, each can run independently without locks

tag: Tag,
request: Request,
data: Data,
status: Status = Status.waiting,
threadpool_task: ThreadPool.Task = ThreadPool.Task{ .callback = &callback },
log: logger.Log,
id: Id,
err: ?anyerror = null,
package_manager: *PackageManager,
apply_patch_task: ?*PatchTask = null,
next: ?*Task = null,

/// An ID that lets us register a callback without keeping the same pointer around
pub const Id = enum(u64) {
    _,

    pub fn get(this: @This()) u64 {
        return @intFromEnum(this);
    }

    pub fn forNPMPackage(package_name: string, package_version: Semver.Version) Id {
        var hasher = bun.Wyhash11.init(0);
        hasher.update("npm-package:");
        hasher.update(package_name);
        hasher.update("@");
        hasher.update(std.mem.asBytes(&package_version));
        return @enumFromInt(hasher.final());
    }

    pub fn forBinLink(package_id: PackageID) Id {
        var hasher = bun.Wyhash11.init(0);
        hasher.update("bin-link:");
        hasher.update(std.mem.asBytes(&package_id));
        return @enumFromInt(hasher.final());
    }

    pub fn forManifest(name: string) Id {
        var hasher = bun.Wyhash11.init(0);
        hasher.update("manifest:");
        hasher.update(name);
        return @enumFromInt(hasher.final());
    }

    pub fn forTarball(url: string) Id {
        var hasher = bun.Wyhash11.init(0);
        hasher.update("tarball:");
        hasher.update(url);
        return @enumFromInt(hasher.final());
    }

    // These cannot change:
    // We persist them to the filesystem.
    pub fn forGitClone(url: string) Id {
        var hasher = bun.Wyhash11.init(0);
        hasher.update(url);
        return @enumFromInt(@as(u64, 4 << 61) | @as(u64, @as(u61, @truncate(hasher.final()))));
    }

    pub fn forGitCheckout(url: string, resolved: string) Id {
        var hasher = bun.Wyhash11.init(0);
        hasher.update(url);
        hasher.update("@");
        hasher.update(resolved);
        return @enumFromInt(@as(u64, 5 << 61) | @as(u64, @as(u61, @truncate(hasher.final()))));
    }
};

pub fn callback(task: *ThreadPool.Task) void {
    Output.Source.configureThread();
    defer Output.flush();

    var this: *Task = @fieldParentPtr("threadpool_task", task);
    const manager = this.package_manager;
    defer {
        if (this.status == .success) {
            if (this.apply_patch_task) |pt| {
                defer pt.deinit();
                bun.handleOom(pt.apply());
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

            const body = &manifest.network.response_buffer;
            defer body.deinit();

            const metadata = manifest.network.response.metadata orelse {
                // Handle the case when metadata is null (e.g., network failure before receiving headers)
                const err = manifest.network.response.fail orelse error.HTTPError;
                this.log.addErrorFmt(null, logger.Loc.Empty, allocator, "{s} downloading package manifest {s}", .{
                    @errorName(err), manifest.name.slice(),
                }) catch unreachable;
                this.err = err;
                this.status = Status.fail;
                this.data = .{ .package_manifest = .{} };
                return;
            };

            const package_manifest = Npm.Registry.getPackageMetadata(
                allocator,
                manager.scopeForPackageName(manifest.name.slice()),
                metadata.response,
                body.slice(),
                &this.log,
                manifest.name.slice(),
                manifest.network.callback.package_manifest.loaded_manifest,
                manager,
                manifest.network.callback.package_manifest.is_extended_manifest,
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
            const buffer = &this.request.extract.network.response_buffer;
            defer buffer.deinit();

            const result = this.request.extract.tarball.run(
                &this.log,
                buffer.slice(),
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

                    this.err = err;
                    this.status = Status.fail;
                    this.data = .{ .git_clone = bun.invalid_fd };
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

            this.err = null;
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

const string = []const u8;

const std = @import("std");

const install = @import("./install.zig");
const DependencyID = install.DependencyID;
const ExtractData = install.ExtractData;
const ExtractTarball = install.ExtractTarball;
const NetworkTask = install.NetworkTask;
const Npm = install.Npm;
const PackageID = install.PackageID;
const PackageManager = install.PackageManager;
const PatchTask = install.PatchTask;
const Repository = install.Repository;
const Resolution = install.Resolution;
const Task = install.Task;
const invalid_package_id = install.invalid_package_id;

const bun = @import("bun");
const DotEnv = bun.DotEnv;
const Output = bun.Output;
const Path = bun.path;
const Semver = bun.Semver;
const ThreadPool = bun.ThreadPool;
const logger = bun.logger;
const strings = bun.strings;
const File = bun.sys.File;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;
