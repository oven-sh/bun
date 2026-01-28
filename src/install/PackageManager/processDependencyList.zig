pub const GitResolver = struct {
    resolved: string,
    resolution: *const Resolution,
    dep_id: DependencyID,
    new_name: []u8 = "",

    pub fn count(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) void {
        builder.count(this.resolved);
    }

    pub fn resolve(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) !Resolution {
        var resolution = this.resolution.*;
        resolution.value.github.resolved = builder.append(String, this.resolved);
        return resolution;
    }

    pub fn checkBundledDependencies() bool {
        return true;
    }
};

const TarballResolver = struct {
    url: string,
    resolution: *const Resolution,

    pub fn count(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) void {
        builder.count(this.url);
    }

    pub fn resolve(this: @This(), comptime Builder: type, builder: Builder, _: JSAst.Expr) !Resolution {
        var resolution = this.resolution.*;
        switch (resolution.tag) {
            .local_tarball => {
                resolution.value.local_tarball = builder.append(String, this.url);
            },
            .remote_tarball => {
                resolution.value.remote_tarball = builder.append(String, this.url);
            },
            else => unreachable,
        }
        return resolution;
    }

    pub fn checkBundledDependencies() bool {
        return true;
    }
};

/// Returns true if we need to drain dependencies
pub fn processExtractedTarballPackage(
    manager: *PackageManager,
    package_id: *PackageID,
    dep_id: DependencyID,
    resolution: *const Resolution,
    data: *const ExtractData,
    log_level: Options.LogLevel,
) ?Lockfile.Package {
    switch (resolution.tag) {
        .git, .github => {
            var package = package: {
                var resolver = GitResolver{
                    .resolved = data.resolved,
                    .resolution = resolution,
                    .dep_id = dep_id,
                };

                var pkg = Lockfile.Package{};
                if (data.json) |json| {
                    const package_json_source = &logger.Source.initPathString(
                        json.path,
                        json.buf,
                    );

                    pkg.parse(
                        manager.lockfile,
                        manager,
                        manager.allocator,
                        manager.log,
                        package_json_source,
                        GitResolver,
                        &resolver,
                        Features.npm,
                    ) catch |err| {
                        if (log_level != .silent) {
                            const string_buf = manager.lockfile.buffers.string_bytes.items;
                            Output.err(err, "failed to parse package.json for <b>{f}<r>", .{
                                resolution.fmtURL(string_buf),
                            });
                        }
                        Global.crash();
                    };

                    const has_scripts = pkg.scripts.hasAny() or brk: {
                        const dir = std.fs.path.dirname(json.path) orelse "";
                        const binding_dot_gyp_path = Path.joinAbsStringZ(
                            dir,
                            &[_]string{"binding.gyp"},
                            .auto,
                        );

                        break :brk Syscall.exists(binding_dot_gyp_path);
                    };

                    pkg.meta.setHasInstallScript(has_scripts);
                    break :package pkg;
                }

                // package.json doesn't exist, no dependencies to worry about but we need to decide on a name for the dependency
                var repo = switch (resolution.tag) {
                    .git => resolution.value.git,
                    .github => resolution.value.github,
                    else => unreachable,
                };

                const new_name = Repository.createDependencyNameFromVersionLiteral(manager.allocator, &repo, manager.lockfile, dep_id);
                defer manager.allocator.free(new_name);

                {
                    var builder = manager.lockfile.stringBuilder();

                    builder.count(new_name);
                    resolver.count(*Lockfile.StringBuilder, &builder, undefined);

                    bun.handleOom(builder.allocate());

                    const name = builder.append(ExternalString, new_name);
                    pkg.name = name.value;
                    pkg.name_hash = name.hash;

                    pkg.resolution = resolver.resolve(*Lockfile.StringBuilder, &builder, undefined) catch unreachable;
                }

                break :package pkg;
            };

            package = manager.lockfile.appendPackage(package) catch unreachable;
            package_id.* = package.meta.id;

            if (package.dependencies.len > 0) {
                bun.handleOom(manager.lockfile.scratch.dependency_list_queue.writeItem(package.dependencies));
            }

            return package;
        },
        .local_tarball, .remote_tarball => {
            const json = data.json.?;
            const package_json_source = &logger.Source.initPathString(
                json.path,
                json.buf,
            );
            var package = Lockfile.Package{};

            var resolver: TarballResolver = .{
                .url = data.url,
                .resolution = resolution,
            };

            package.parse(
                manager.lockfile,
                manager,
                manager.allocator,
                manager.log,
                package_json_source,
                TarballResolver,
                &resolver,
                Features.npm,
            ) catch |err| {
                if (log_level != .silent) {
                    const string_buf = manager.lockfile.buffers.string_bytes.items;
                    Output.prettyErrorln("<r><red>error:<r> expected package.json in <b>{f}<r> to be a JSON file: {s}\n", .{
                        resolution.fmtURL(string_buf),
                        @errorName(err),
                    });
                }
                Global.crash();
            };

            const has_scripts = package.scripts.hasAny() or brk: {
                const dir = std.fs.path.dirname(json.path) orelse "";
                const binding_dot_gyp_path = Path.joinAbsStringZ(
                    dir,
                    &[_]string{"binding.gyp"},
                    .auto,
                );

                break :brk Syscall.exists(binding_dot_gyp_path);
            };

            package.meta.setHasInstallScript(has_scripts);

            package = manager.lockfile.appendPackage(package) catch unreachable;
            package_id.* = package.meta.id;

            if (package.dependencies.len > 0) {
                bun.handleOom(manager.lockfile.scratch.dependency_list_queue.writeItem(package.dependencies));
            }

            return package;
        },
        else => if (data.json.?.buf.len > 0) {
            const json = data.json.?;
            const package_json_source = &logger.Source.initPathString(
                json.path,
                json.buf,
            );
            initializeStore();
            const json_root = JSON.parsePackageJSONUTF8(
                package_json_source,
                manager.log,
                manager.allocator,
            ) catch |err| {
                if (log_level != .silent) {
                    const string_buf = manager.lockfile.buffers.string_bytes.items;
                    Output.prettyErrorln("<r><red>error:<r> expected package.json in <b>{f}<r> to be a JSON file: {s}\n", .{
                        resolution.fmtURL(string_buf),
                        @errorName(err),
                    });
                }
                Global.crash();
            };
            var builder = manager.lockfile.stringBuilder();
            Lockfile.Package.Scripts.parseCount(manager.allocator, &builder, json_root);
            builder.allocate() catch unreachable;
            if (comptime Environment.allow_assert) bun.assert(package_id.* != invalid_package_id);
            var scripts = manager.lockfile.packages.items(.scripts)[package_id.*];
            scripts.parseAlloc(manager.allocator, &builder, json_root);
            scripts.filled = true;
        },
    }

    return null;
}

pub fn processDependencyListItem(
    this: *PackageManager,
    item: TaskCallbackContext,
    any_root: ?*bool,
    install_peer: bool,
) !void {
    switch (item) {
        .dependency => |dependency_id| {
            const dependency = this.lockfile.buffers.dependencies.items[dependency_id];
            const resolution = this.lockfile.buffers.resolutions.items[dependency_id];

            try this.enqueueDependencyWithMain(
                dependency_id,
                &dependency,
                resolution,
                install_peer,
            );
        },
        .root_dependency => |dependency_id| {
            const dependency = this.lockfile.buffers.dependencies.items[dependency_id];
            const resolution = this.lockfile.buffers.resolutions.items[dependency_id];

            try this.enqueueDependencyWithMainAndSuccessFn(
                dependency_id,
                &dependency,
                resolution,
                install_peer,
                assignRootResolution,
                failRootResolution,
            );
            if (any_root) |ptr| {
                const new_resolution_id = this.lockfile.buffers.resolutions.items[dependency_id];
                if (new_resolution_id != resolution) {
                    ptr.* = true;
                }
            }
        },
        else => {},
    }
}

pub fn processPeerDependencyList(
    this: *PackageManager,
) !void {
    while (this.peer_dependencies.readItem()) |peer_dependency_id| {
        const dependency = this.lockfile.buffers.dependencies.items[peer_dependency_id];
        const resolution = this.lockfile.buffers.resolutions.items[peer_dependency_id];

        try this.enqueueDependencyWithMain(
            peer_dependency_id,
            &dependency,
            resolution,
            true,
        );
    }
}

pub fn processDependencyList(
    this: *PackageManager,
    dep_list: TaskCallbackList,
    comptime Ctx: type,
    ctx: Ctx,
    comptime callbacks: anytype,
    install_peer: bool,
) !void {
    if (dep_list.items.len > 0) {
        var dependency_list = dep_list;
        var any_root = false;
        for (dependency_list.items) |item| {
            try this.processDependencyListItem(item, &any_root, install_peer);
        }

        if (comptime @TypeOf(callbacks) != void and @TypeOf(callbacks.onResolve) != void) {
            if (any_root) {
                callbacks.onResolve(ctx);
            }
        }

        dependency_list.deinit(this.allocator);
    }
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const JSAst = bun.ast;
const JSON = bun.json;
const Output = bun.Output;
const Path = bun.path;
const Syscall = bun.sys;
const logger = bun.logger;

const Semver = bun.Semver;
const ExternalString = Semver.ExternalString;
const String = Semver.String;

const DependencyID = bun.install.DependencyID;
const ExtractData = bun.install.ExtractData;
const Features = bun.install.Features;
const PackageID = bun.install.PackageID;
const Repository = bun.install.Repository;
const Resolution = bun.install.Resolution;
const TaskCallbackContext = bun.install.TaskCallbackContext;
const initializeStore = bun.install.initializeStore;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = bun.install.Lockfile;
const Package = Lockfile.Package;

const PackageManager = bun.install.PackageManager;
const Options = PackageManager.Options;
const TaskCallbackList = PackageManager.TaskCallbackList;
const assignRootResolution = PackageManager.assignRootResolution;
const failRootResolution = PackageManager.failRootResolution;
