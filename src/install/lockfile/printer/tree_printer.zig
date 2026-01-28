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

    // It's possible to have duplicate dependencies with the same version and resolution.
    // While both are technically installed, only one was chosen and should be printed.
    var dep_dedupe: std.AutoHashMap(install.PackageNameHash, void) = .init(manager.allocator);
    defer dep_dedupe.deinit();

    // find the updated packages
    for (resolutions_list[workspace_package_id].begin()..resolutions_list[workspace_package_id].end()) |_dep_id| {
        const dep_id: DependencyID = @intCast(_dep_id);

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

    for (resolutions_list[workspace_package_id].begin()..resolutions_list[workspace_package_id].end()) |_dep_id| {
        const dep_id: DependencyID = @intCast(_dep_id);

        switch (shouldPrintPackageInstall(this, manager, @intCast(dep_id), installed, id_map, pkg_metas)) {
            .@"return" => return,
            .yes => {},
            .no, .update => continue,
        }

        const dep = dependencies[dep_id];
        const package_id = resolutions[dep_id];

        if ((try dep_dedupe.getOrPut(dep.name_hash)).found_existing) {
            continue;
        }

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

    if (dependency.behavior.isWorkspace() or package_id >= this.lockfile.packages.len) return .no;

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
        this.options.cpu,
        this.options.os,
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
            break :brk Output.prettyFmt("<r><cyan>↑<r> <b>{s}<r><d> <b>{f} →<r> <b><cyan>{f}<r>\n", enable_ansi_colors);
        }
        break :brk Output.prettyFmt("<r>^ <b>{s}<r><d> <b>{f} -\\><r> <b>{f}<r>\n", enable_ansi_colors);
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
                break :brk Output.prettyFmt("<r><green>+<r> <b>{s}<r><d>@{f}<r> <d>(<blue>v{f} available<r><d>)<r>\n", enable_ansi_colors);
            } else {
                break :brk Output.prettyFmt("<r>+ {s}<r><d>@{f}<r> <d>(v{f} available)<r>\n", enable_ansi_colors);
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
            break :brk Output.prettyFmt("<r><green>+<r> <b>{s}<r><d>@{f}<r>\n", enable_ansi_colors);
        } else {
            break :brk Output.prettyFmt("<r>+ {s}<r><d>@{f}<r>\n", enable_ansi_colors);
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
    log_level: PackageManager.Options.LogLevel,
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
        if (log_level.isVerbose()) {
            var workspaces_to_print: std.ArrayListUnmanaged(DependencyID) = .{};
            defer workspaces_to_print.deinit(allocator);

            for (resolutions_list[0].begin()..resolutions_list[0].end()) |dep_id| {
                const dep = dependencies_buffer[dep_id];
                if (dep.behavior.isWorkspace()) {
                    bun.handleOom(workspaces_to_print.append(allocator, @intCast(dep_id)));
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
                comptime Output.prettyFmt(" <r><b>{s}<r><d>@<b>{f}<r>\n", enable_ansi_colors),
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

                const fmt = comptime Output.prettyFmt("<r><green>installed<r> <b>{s}<r><d>@{f}<r>\n", enable_ansi_colors);

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
                    const fmt = comptime Output.prettyFmt("<r><green>installed<r> {s}<r><d>@{f}<r> with binaries:\n", enable_ansi_colors);

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
                                .basename = bun.handleOom(bun.default_allocator.dupe(u8, bin_name)),
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const Semver = bun.Semver;
const assert = bun.assert;
const default_allocator = bun.default_allocator;
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;

const install = bun.install;
const Bin = bun.install.Bin;
const Dependency = install.Dependency;
const DependencyID = bun.install.DependencyID;
const PackageID = install.PackageID;
const PackageManager = bun.install.PackageManager;
const Resolution = install.Resolution;
const invalid_package_id = bun.install.invalid_package_id;

const Lockfile = install.Lockfile;
const Package = Lockfile.Package;
const Printer = Lockfile.Printer;
