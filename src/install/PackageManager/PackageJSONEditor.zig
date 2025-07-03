const dependency_groups = &.{
    .{ "optionalDependencies", .{ .optional = true } },
    .{ "devDependencies", .{ .dev = true } },
    .{ "dependencies", .{ .prod = true } },
    .{ "peerDependencies", .{ .peer = true } },
};

pub const EditOptions = struct {
    exact_versions: bool = false,
    add_trusted_dependencies: bool = false,
    before_install: bool = false,
};

pub fn editPatchedDependencies(
    manager: *PackageManager,
    package_json: *Expr,
    patch_key: []const u8,
    patchfile_path: []const u8,
) !void {

    // const pkg_to_patch = manager.
    var patched_dependencies = brk: {
        if (package_json.asProperty("patchedDependencies")) |query| {
            if (query.expr.data == .e_object)
                break :brk query.expr.data.e_object.*;
        }
        break :brk E.Object{};
    };

    const patchfile_expr = try Expr.init(
        E.String,
        E.String{
            .data = patchfile_path,
        },
        logger.Loc.Empty,
    ).clone(manager.allocator);

    try patched_dependencies.put(
        manager.allocator,
        patch_key,
        patchfile_expr,
    );

    try package_json.data.e_object.put(
        manager.allocator,
        "patchedDependencies",
        try Expr.init(E.Object, patched_dependencies, logger.Loc.Empty).clone(manager.allocator),
    );
}

pub fn editTrustedDependencies(allocator: std.mem.Allocator, package_json: *Expr, names_to_add: []string) !void {
    var len = names_to_add.len;

    var original_trusted_dependencies = brk: {
        if (package_json.asProperty(trusted_dependencies_string)) |query| {
            if (query.expr.data == .e_array) {
                break :brk query.expr.data.e_array.*;
            }
        }
        break :brk E.Array{};
    };

    for (names_to_add, 0..) |name, i| {
        for (original_trusted_dependencies.items.slice()) |item| {
            if (item.data == .e_string) {
                if (item.data.e_string.eql(string, name)) {
                    const temp = names_to_add[i];
                    names_to_add[i] = names_to_add[len - 1];
                    names_to_add[len - 1] = temp;
                    len -= 1;
                    break;
                }
            }
        }
    }

    var trusted_dependencies: []Expr = &[_]Expr{};
    if (package_json.asProperty(trusted_dependencies_string)) |query| {
        if (query.expr.data == .e_array) {
            trusted_dependencies = query.expr.data.e_array.items.slice();
        }
    }

    const trusted_dependencies_to_add = len;
    const new_trusted_deps = brk: {
        var deps = try allocator.alloc(Expr, trusted_dependencies.len + trusted_dependencies_to_add);
        @memcpy(deps[0..trusted_dependencies.len], trusted_dependencies);
        @memset(deps[trusted_dependencies.len..], Expr.empty);

        for (names_to_add[0..len]) |name| {
            if (comptime Environment.allow_assert) {
                var has_missing = false;
                for (deps) |dep| {
                    if (dep.data == .e_missing) has_missing = true;
                }
                bun.assert(has_missing);
            }

            var i = deps.len;
            while (i > 0) {
                i -= 1;
                if (deps[i].data == .e_missing) {
                    deps[i] = try Expr.init(
                        E.String,
                        E.String{
                            .data = name,
                        },
                        logger.Loc.Empty,
                    ).clone(allocator);
                    break;
                }
            }
        }

        if (comptime Environment.allow_assert) {
            for (deps) |dep| bun.assert(dep.data != .e_missing);
        }

        break :brk deps;
    };

    var needs_new_trusted_dependencies_list = true;
    const trusted_dependencies_array: Expr = brk: {
        if (package_json.asProperty(trusted_dependencies_string)) |query| {
            if (query.expr.data == .e_array) {
                needs_new_trusted_dependencies_list = false;
                break :brk query.expr;
            }
        }

        break :brk Expr.init(
            E.Array,
            E.Array{
                .items = JSAst.ExprNodeList.init(new_trusted_deps),
            },
            logger.Loc.Empty,
        );
    };

    if (trusted_dependencies_to_add > 0 and new_trusted_deps.len > 0) {
        trusted_dependencies_array.data.e_array.items = JSAst.ExprNodeList.init(new_trusted_deps);
        trusted_dependencies_array.data.e_array.alphabetizeStrings();
    }

    if (package_json.data != .e_object or package_json.data.e_object.properties.len == 0) {
        var root_properties = try allocator.alloc(JSAst.G.Property, 1);
        root_properties[0] = JSAst.G.Property{
            .key = Expr.init(
                E.String,
                E.String{
                    .data = trusted_dependencies_string,
                },
                logger.Loc.Empty,
            ),
            .value = trusted_dependencies_array,
        };

        package_json.* = Expr.init(
            E.Object,
            E.Object{
                .properties = JSAst.G.Property.List.init(root_properties),
            },
            logger.Loc.Empty,
        );
    } else if (needs_new_trusted_dependencies_list) {
        var root_properties = try allocator.alloc(G.Property, package_json.data.e_object.properties.len + 1);
        @memcpy(root_properties[0..package_json.data.e_object.properties.len], package_json.data.e_object.properties.slice());
        root_properties[root_properties.len - 1] = .{
            .key = Expr.init(
                E.String,
                E.String{
                    .data = trusted_dependencies_string,
                },
                logger.Loc.Empty,
            ),
            .value = trusted_dependencies_array,
        };
        package_json.* = Expr.init(
            E.Object,
            E.Object{
                .properties = JSAst.G.Property.List.init(root_properties),
            },
            logger.Loc.Empty,
        );
    }
}

/// When `bun update` is called without package names, all dependencies are updated.
/// This function will identify the current workspace and update all changed package
/// versions.
pub fn editUpdateNoArgs(
    manager: *PackageManager,
    current_package_json: *Expr,
    options: EditOptions,
) !void {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    Expr.Disabler.disable();
    defer Expr.Disabler.enable();

    const allocator = manager.allocator;

    inline for (dependency_groups) |group| {
        const group_str = group[0];

        if (current_package_json.asProperty(group_str)) |root| {
            if (root.expr.data == .e_object) {
                if (options.before_install) {
                    // set each npm dependency to latest
                    for (root.expr.data.e_object.properties.slice()) |*dep| {
                        const key = dep.key orelse continue;
                        if (key.data != .e_string) continue;
                        const value = dep.value orelse continue;
                        if (value.data != .e_string) continue;

                        const version_literal = try value.asStringCloned(allocator) orelse bun.outOfMemory();
                        var tag = Dependency.Version.Tag.infer(version_literal);

                        // only updating dependencies with npm versions, and dist-tags if `--latest`.
                        if (tag != .npm and (tag != .dist_tag or !manager.options.do.update_to_latest)) continue;

                        var alias_at_index: ?usize = null;
                        if (strings.hasPrefixComptime(strings.trim(version_literal, &strings.whitespace_chars), "npm:")) {
                            // negative because the real package might have a scope
                            // e.g. "dep": "npm:@foo/bar@1.2.3"
                            if (strings.lastIndexOfChar(version_literal, '@')) |at_index| {
                                tag = Dependency.Version.Tag.infer(version_literal[at_index + 1 ..]);
                                if (tag != .npm and (tag != .dist_tag or !manager.options.do.update_to_latest)) continue;
                                alias_at_index = at_index;
                            }
                        }

                        const key_str = try key.asStringCloned(allocator) orelse unreachable;
                        const entry = manager.updating_packages.getOrPut(allocator, key_str) catch bun.outOfMemory();

                        // If a dependency is present in more than one dependency group, only one of it's versions
                        // will be updated. The group is determined by the order of `dependency_groups`, the same
                        // order used to choose which version to install.
                        if (entry.found_existing) continue;

                        entry.value_ptr.* = .{
                            .original_version_literal = version_literal,
                            .is_alias = alias_at_index != null,
                            .original_version = null,
                        };

                        if (manager.options.do.update_to_latest) {
                            // is it an aliased package
                            const temp_version = if (alias_at_index) |at_index|
                                std.fmt.allocPrint(allocator, "{s}@latest", .{version_literal[0..at_index]}) catch bun.outOfMemory()
                            else
                                allocator.dupe(u8, "latest") catch bun.outOfMemory();

                            dep.value = Expr.allocate(allocator, E.String, .{
                                .data = temp_version,
                            }, logger.Loc.Empty);
                        }
                    }
                } else {
                    const lockfile = manager.lockfile;
                    const string_buf = lockfile.buffers.string_bytes.items;
                    const workspace_package_id = lockfile.getWorkspacePackageID(manager.workspace_name_hash);
                    const packages = lockfile.packages.slice();
                    const resolutions = packages.items(.resolution);
                    const deps = packages.items(.dependencies)[workspace_package_id];
                    const resolution_ids = packages.items(.resolutions)[workspace_package_id];
                    const workspace_deps: []const Dependency = deps.get(lockfile.buffers.dependencies.items);
                    const workspace_resolution_ids = resolution_ids.get(lockfile.buffers.resolutions.items);

                    for (root.expr.data.e_object.properties.slice()) |*dep| {
                        const key = dep.key orelse continue;
                        if (key.data != .e_string) continue;
                        const value = dep.value orelse continue;
                        if (value.data != .e_string) continue;

                        const key_str = key.asString(allocator) orelse bun.outOfMemory();

                        updated: {
                            // fetchSwapRemove because we want to update the first dependency with a matching
                            // name, or none at all
                            if (manager.updating_packages.fetchSwapRemove(key_str)) |entry| {
                                const is_alias = entry.value.is_alias;
                                const dep_name = entry.key;
                                for (workspace_deps, workspace_resolution_ids) |workspace_dep, package_id| {
                                    if (package_id == invalid_package_id) continue;

                                    const resolution = resolutions[package_id];
                                    if (resolution.tag != .npm) continue;

                                    const workspace_dep_name = workspace_dep.name.slice(string_buf);
                                    if (!strings.eqlLong(workspace_dep_name, dep_name, true)) continue;

                                    if (workspace_dep.version.npm()) |npm_version| {
                                        // It's possible we inserted a dependency that won't update (version is an exact version).
                                        // If we find one, skip to keep the original version literal.
                                        if (!manager.options.do.update_to_latest and npm_version.version.isExact()) break :updated;
                                    }

                                    const new_version = new_version: {
                                        const version_fmt = resolution.value.npm.version.fmt(string_buf);
                                        if (options.exact_versions) {
                                            break :new_version try std.fmt.allocPrint(allocator, "{}", .{version_fmt});
                                        }

                                        const version_literal = version_literal: {
                                            if (!is_alias) break :version_literal entry.value.original_version_literal;
                                            if (strings.lastIndexOfChar(entry.value.original_version_literal, '@')) |at_index| {
                                                break :version_literal entry.value.original_version_literal[at_index + 1 ..];
                                            }
                                            break :version_literal entry.value.original_version_literal;
                                        };

                                        const pinned_version = Semver.Version.whichVersionIsPinned(version_literal);
                                        break :new_version try switch (pinned_version) {
                                            .patch => std.fmt.allocPrint(allocator, "{}", .{version_fmt}),
                                            .minor => std.fmt.allocPrint(allocator, "~{}", .{version_fmt}),
                                            .major => std.fmt.allocPrint(allocator, "^{}", .{version_fmt}),
                                        };
                                    };

                                    if (is_alias) {
                                        const dep_literal = workspace_dep.version.literal.slice(string_buf);

                                        // negative because the real package might have a scope
                                        // e.g. "dep": "npm:@foo/bar@1.2.3"
                                        if (strings.lastIndexOfChar(dep_literal, '@')) |at_index| {
                                            dep.value = Expr.allocate(allocator, E.String, .{
                                                .data = try std.fmt.allocPrint(allocator, "{s}@{s}", .{
                                                    dep_literal[0..at_index],
                                                    new_version,
                                                }),
                                            }, logger.Loc.Empty);
                                            break :updated;
                                        }

                                        // fallthrough and replace entire version.
                                    }

                                    dep.value = Expr.allocate(allocator, E.String, .{
                                        .data = new_version,
                                    }, logger.Loc.Empty);
                                    break :updated;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// edits dependencies and trusted dependencies
/// if options.add_trusted_dependencies is true, gets list from PackageManager.trusted_deps_to_add_to_package_json
pub fn edit(
    manager: *PackageManager,
    updates: *[]UpdateRequest,
    current_package_json: *Expr,
    dependency_list: string,
    options: EditOptions,
) !void {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    Expr.Disabler.disable();
    defer Expr.Disabler.enable();

    const allocator = manager.allocator;
    var remaining = updates.len;
    var replacing: usize = 0;
    const only_add_missing = manager.options.enable.only_missing;

    // There are three possible scenarios here
    // 1. There is no "dependencies" (or equivalent list) or it is empty
    // 2. There is a "dependencies" (or equivalent list), but the package name already exists in a separate list
    // 3. There is a "dependencies" (or equivalent list), and the package name exists in multiple lists
    // Try to use the existing spot in the dependencies list if possible
    {
        var original_trusted_dependencies = brk: {
            if (!options.add_trusted_dependencies) break :brk E.Array{};
            if (current_package_json.asProperty(trusted_dependencies_string)) |query| {
                if (query.expr.data == .e_array) {
                    // not modifying
                    break :brk query.expr.data.e_array.*;
                }
            }
            break :brk E.Array{};
        };

        if (options.add_trusted_dependencies) {
            for (manager.trusted_deps_to_add_to_package_json.items, 0..) |trusted_package_name, i| {
                for (original_trusted_dependencies.items.slice()) |item| {
                    if (item.data == .e_string) {
                        if (item.data.e_string.eql(string, trusted_package_name)) {
                            allocator.free(manager.trusted_deps_to_add_to_package_json.swapRemove(i));
                            break;
                        }
                    }
                }
            }
        }
        {
            var i: usize = 0;
            loop: while (i < updates.len) {
                var request = &updates.*[i];
                inline for ([_]string{ "dependencies", "devDependencies", "optionalDependencies", "peerDependencies" }) |list| {
                    if (current_package_json.asProperty(list)) |query| {
                        if (query.expr.data == .e_object) {
                            const name = if (request.is_aliased)
                                request.name
                            else
                                request.version.literal.slice(request.version_buf);

                            if (query.expr.asProperty(name)) |value| {
                                if (value.expr.data == .e_string) {
                                    if (request.package_id != invalid_package_id and strings.eqlLong(list, dependency_list, true)) {
                                        replacing += 1;
                                    } else {
                                        if (manager.subcommand == .update and options.before_install) add_packages_to_update: {
                                            const version_literal = try value.expr.asStringCloned(allocator) orelse break :add_packages_to_update;
                                            var tag = Dependency.Version.Tag.infer(version_literal);

                                            if (tag != .npm and tag != .dist_tag) break :add_packages_to_update;

                                            const entry = manager.updating_packages.getOrPut(allocator, name) catch bun.outOfMemory();

                                            // first come, first serve
                                            if (entry.found_existing) break :add_packages_to_update;

                                            var is_alias = false;
                                            if (strings.hasPrefixComptime(strings.trim(version_literal, &strings.whitespace_chars), "npm:")) {
                                                if (strings.lastIndexOfChar(version_literal, '@')) |at_index| {
                                                    tag = Dependency.Version.Tag.infer(version_literal[at_index + 1 ..]);
                                                    if (tag != .npm and tag != .dist_tag) break :add_packages_to_update;
                                                    is_alias = true;
                                                }
                                            }

                                            entry.value_ptr.* = .{
                                                .original_version_literal = version_literal,
                                                .is_alias = is_alias,
                                                .original_version = null,
                                            };
                                        }
                                        if (!only_add_missing) {
                                            request.e_string = value.expr.data.e_string;
                                            remaining -= 1;
                                        } else {
                                            if (i < updates.*.len - 1) {
                                                updates.*[i] = updates.*[updates.*.len - 1];
                                            }

                                            updates.*.len -= 1;
                                            remaining -= 1;
                                            continue :loop;
                                        }
                                    }
                                }
                                break;
                            } else {
                                if (request.version.tag == .github or request.version.tag == .git) {
                                    for (query.expr.data.e_object.properties.slice()) |item| {
                                        if (item.value) |v| {
                                            const url = request.version.literal.slice(request.version_buf);
                                            if (v.data == .e_string and v.data.e_string.eql(string, url)) {
                                                request.e_string = v.data.e_string;
                                                remaining -= 1;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                i += 1;
            }
        }
    }

    if (remaining != 0) {
        var dependencies: []G.Property = &[_]G.Property{};
        if (current_package_json.asProperty(dependency_list)) |query| {
            if (query.expr.data == .e_object) {
                dependencies = query.expr.data.e_object.properties.slice();
            }
        }

        var new_dependencies = try allocator.alloc(G.Property, dependencies.len + remaining - replacing);
        bun.copy(G.Property, new_dependencies, dependencies);
        @memset(new_dependencies[dependencies.len..], G.Property{});

        var trusted_dependencies: []Expr = &[_]Expr{};
        if (options.add_trusted_dependencies) {
            if (current_package_json.asProperty(trusted_dependencies_string)) |query| {
                if (query.expr.data == .e_array) {
                    trusted_dependencies = query.expr.data.e_array.items.slice();
                }
            }
        }

        const trusted_dependencies_to_add = manager.trusted_deps_to_add_to_package_json.items.len;
        const new_trusted_deps = brk: {
            if (!options.add_trusted_dependencies or trusted_dependencies_to_add == 0) break :brk &[_]Expr{};

            var deps = try allocator.alloc(Expr, trusted_dependencies.len + trusted_dependencies_to_add);
            @memcpy(deps[0..trusted_dependencies.len], trusted_dependencies);
            @memset(deps[trusted_dependencies.len..], Expr.empty);

            for (manager.trusted_deps_to_add_to_package_json.items) |package_name| {
                if (comptime Environment.allow_assert) {
                    var has_missing = false;
                    for (deps) |dep| {
                        if (dep.data == .e_missing) has_missing = true;
                    }
                    bun.assert(has_missing);
                }

                var i = deps.len;
                while (i > 0) {
                    i -= 1;
                    if (deps[i].data == .e_missing) {
                        deps[i] = Expr.allocate(allocator, E.String, .{
                            .data = package_name,
                        }, logger.Loc.Empty);
                        break;
                    }
                }
            }

            if (comptime Environment.allow_assert) {
                for (deps) |dep| bun.assert(dep.data != .e_missing);
            }

            break :brk deps;
        };

        outer: for (updates.*) |*request| {
            if (request.e_string != null) continue;
            defer if (comptime Environment.allow_assert) bun.assert(request.e_string != null);

            var k: usize = 0;
            while (k < new_dependencies.len) : (k += 1) {
                if (new_dependencies[k].key) |key| {
                    if (!request.is_aliased and request.package_id != invalid_package_id and key.data.e_string.eql(
                        string,
                        manager.lockfile.packages.items(.name)[request.package_id].slice(request.version_buf),
                    )) {
                        // This actually is a duplicate which we did not
                        // pick up before dependency resolution.
                        // For this case, we'll just swap remove it.
                        if (new_dependencies.len > 1) {
                            new_dependencies[k] = new_dependencies[new_dependencies.len - 1];
                            new_dependencies = new_dependencies[0 .. new_dependencies.len - 1];
                        } else {
                            new_dependencies = &[_]G.Property{};
                        }
                        continue;
                    }
                    if (key.data.e_string.eql(
                        string,
                        if (request.is_aliased)
                            request.name
                        else
                            request.version.literal.slice(request.version_buf),
                    )) {
                        if (request.package_id == invalid_package_id) {
                            // This actually is a duplicate like "react"
                            // appearing in both "dependencies" and "optionalDependencies".
                            // For this case, we'll just swap remove it
                            if (new_dependencies.len > 1) {
                                new_dependencies[k] = new_dependencies[new_dependencies.len - 1];
                                new_dependencies = new_dependencies[0 .. new_dependencies.len - 1];
                            } else {
                                new_dependencies = &[_]G.Property{};
                            }
                            continue;
                        }

                        new_dependencies[k].key = null;
                    }
                }

                if (new_dependencies[k].key == null) {
                    new_dependencies[k].key = JSAst.Expr.allocate(
                        allocator,
                        JSAst.E.String,
                        .{ .data = try allocator.dupe(u8, request.getResolvedName(manager.lockfile)) },
                        logger.Loc.Empty,
                    );

                    new_dependencies[k].value = JSAst.Expr.allocate(allocator, JSAst.E.String, .{
                        // we set it later
                        .data = "",
                    }, logger.Loc.Empty);

                    request.e_string = new_dependencies[k].value.?.data.e_string;

                    if (request.is_aliased) continue :outer;
                }
            }
        }

        var needs_new_dependency_list = true;
        const dependencies_object: JSAst.Expr = brk: {
            if (current_package_json.asProperty(dependency_list)) |query| {
                if (query.expr.data == .e_object) {
                    needs_new_dependency_list = false;

                    break :brk query.expr;
                }
            }

            break :brk JSAst.Expr.allocate(allocator, JSAst.E.Object, .{
                .properties = JSAst.G.Property.List.init(new_dependencies),
            }, logger.Loc.Empty);
        };

        dependencies_object.data.e_object.properties = JSAst.G.Property.List.init(new_dependencies);
        if (new_dependencies.len > 1)
            dependencies_object.data.e_object.alphabetizeProperties();

        var needs_new_trusted_dependencies_list = true;
        const trusted_dependencies_array: Expr = brk: {
            if (!options.add_trusted_dependencies or trusted_dependencies_to_add == 0) {
                needs_new_trusted_dependencies_list = false;
                break :brk Expr.empty;
            }
            if (current_package_json.asProperty(trusted_dependencies_string)) |query| {
                if (query.expr.data == .e_array) {
                    needs_new_trusted_dependencies_list = false;
                    break :brk query.expr;
                }
            }

            break :brk Expr.allocate(allocator, E.Array, .{
                .items = JSAst.ExprNodeList.init(new_trusted_deps),
            }, logger.Loc.Empty);
        };

        if (options.add_trusted_dependencies and trusted_dependencies_to_add > 0) {
            trusted_dependencies_array.data.e_array.items = JSAst.ExprNodeList.init(new_trusted_deps);
            if (new_trusted_deps.len > 1) {
                trusted_dependencies_array.data.e_array.alphabetizeStrings();
            }
        }

        if (current_package_json.data != .e_object or current_package_json.data.e_object.properties.len == 0) {
            var root_properties = try allocator.alloc(JSAst.G.Property, if (options.add_trusted_dependencies) 2 else 1);
            root_properties[0] = JSAst.G.Property{
                .key = JSAst.Expr.allocate(allocator, JSAst.E.String, .{
                    .data = dependency_list,
                }, logger.Loc.Empty),
                .value = dependencies_object,
            };

            if (options.add_trusted_dependencies) {
                root_properties[1] = JSAst.G.Property{
                    .key = Expr.allocate(allocator, E.String, .{
                        .data = trusted_dependencies_string,
                    }, logger.Loc.Empty),
                    .value = trusted_dependencies_array,
                };
            }

            current_package_json.* = JSAst.Expr.allocate(allocator, JSAst.E.Object, .{
                .properties = JSAst.G.Property.List.init(root_properties),
            }, logger.Loc.Empty);
        } else {
            if (needs_new_dependency_list and needs_new_trusted_dependencies_list) {
                var root_properties = try allocator.alloc(G.Property, current_package_json.data.e_object.properties.len + 2);
                @memcpy(root_properties[0..current_package_json.data.e_object.properties.len], current_package_json.data.e_object.properties.slice());
                root_properties[root_properties.len - 2] = .{
                    .key = Expr.allocate(allocator, E.String, E.String{
                        .data = dependency_list,
                    }, logger.Loc.Empty),
                    .value = dependencies_object,
                };
                root_properties[root_properties.len - 1] = .{
                    .key = Expr.allocate(allocator, E.String, .{
                        .data = trusted_dependencies_string,
                    }, logger.Loc.Empty),
                    .value = trusted_dependencies_array,
                };
                current_package_json.* = Expr.allocate(allocator, E.Object, .{
                    .properties = G.Property.List.init(root_properties),
                }, logger.Loc.Empty);
            } else if (needs_new_dependency_list or needs_new_trusted_dependencies_list) {
                var root_properties = try allocator.alloc(JSAst.G.Property, current_package_json.data.e_object.properties.len + 1);
                @memcpy(root_properties[0..current_package_json.data.e_object.properties.len], current_package_json.data.e_object.properties.slice());
                root_properties[root_properties.len - 1] = .{
                    .key = JSAst.Expr.allocate(allocator, JSAst.E.String, .{
                        .data = if (needs_new_dependency_list) dependency_list else trusted_dependencies_string,
                    }, logger.Loc.Empty),
                    .value = if (needs_new_dependency_list) dependencies_object else trusted_dependencies_array,
                };
                current_package_json.* = JSAst.Expr.allocate(allocator, JSAst.E.Object, .{
                    .properties = JSAst.G.Property.List.init(root_properties),
                }, logger.Loc.Empty);
            }
        }
    }

    const resolutions = if (!options.before_install) manager.lockfile.packages.items(.resolution) else &.{};
    for (updates.*) |*request| {
        if (request.e_string) |e_string| {
            if (request.package_id >= resolutions.len or resolutions[request.package_id].tag == .uninitialized) {
                e_string.data = uninitialized: {
                    if (manager.subcommand == .update and manager.options.do.update_to_latest) {
                        break :uninitialized try allocator.dupe(u8, "latest");
                    }

                    if (manager.subcommand != .update or !options.before_install or e_string.isBlank() or request.version.tag == .npm) {
                        break :uninitialized switch (request.version.tag) {
                            .uninitialized => try allocator.dupe(u8, "latest"),
                            else => try allocator.dupe(u8, request.version.literal.slice(request.version_buf)),
                        };
                    } else {
                        break :uninitialized e_string.data;
                    }
                };

                continue;
            }
            e_string.data = switch (resolutions[request.package_id].tag) {
                .npm => npm: {
                    if (manager.subcommand == .update and (request.version.tag == .dist_tag or request.version.tag == .npm)) {
                        if (manager.updating_packages.fetchSwapRemove(request.name)) |entry| {
                            var alias_at_index: ?usize = null;

                            const new_version = new_version: {
                                const version_fmt = resolutions[request.package_id].value.npm.version.fmt(manager.lockfile.buffers.string_bytes.items);
                                if (options.exact_versions) {
                                    break :new_version try std.fmt.allocPrint(allocator, "{}", .{version_fmt});
                                }

                                const version_literal = version_literal: {
                                    if (!entry.value.is_alias) break :version_literal entry.value.original_version_literal;
                                    if (strings.lastIndexOfChar(entry.value.original_version_literal, '@')) |at_index| {
                                        alias_at_index = at_index;
                                        break :version_literal entry.value.original_version_literal[at_index + 1 ..];
                                    }

                                    break :version_literal entry.value.original_version_literal;
                                };

                                const pinned_version = Semver.Version.whichVersionIsPinned(version_literal);
                                break :new_version try switch (pinned_version) {
                                    .patch => std.fmt.allocPrint(allocator, "{}", .{version_fmt}),
                                    .minor => std.fmt.allocPrint(allocator, "~{}", .{version_fmt}),
                                    .major => std.fmt.allocPrint(allocator, "^{}", .{version_fmt}),
                                };
                            };

                            if (entry.value.is_alias) {
                                const dep_literal = entry.value.original_version_literal;

                                if (strings.lastIndexOfChar(dep_literal, '@')) |at_index| {
                                    break :npm try std.fmt.allocPrint(allocator, "{s}@{s}", .{
                                        dep_literal[0..at_index],
                                        new_version,
                                    });
                                }
                            }

                            break :npm new_version;
                        }
                    }
                    if (request.version.tag == .dist_tag or
                        (manager.subcommand == .update and request.version.tag == .npm and !request.version.value.npm.version.isExact()))
                    {
                        const new_version = try switch (options.exact_versions) {
                            inline else => |exact_versions| std.fmt.allocPrint(
                                allocator,
                                if (comptime exact_versions) "{}" else "^{}",
                                .{
                                    resolutions[request.package_id].value.npm.version.fmt(request.version_buf),
                                },
                            ),
                        };

                        if (request.version.tag == .npm and request.version.value.npm.is_alias) {
                            const dep_literal = request.version.literal.slice(request.version_buf);
                            if (strings.indexOfChar(dep_literal, '@')) |at_index| {
                                break :npm try std.fmt.allocPrint(allocator, "{s}@{s}", .{
                                    dep_literal[0..at_index],
                                    new_version,
                                });
                            }
                        }

                        break :npm new_version;
                    }

                    break :npm try allocator.dupe(u8, request.version.literal.slice(request.version_buf));
                },

                .workspace => try allocator.dupe(u8, "workspace:*"),
                else => try allocator.dupe(u8, request.version.literal.slice(request.version_buf)),
            };
        }
    }
}

const trusted_dependencies_string = "trustedDependencies";

const std = @import("std");
const bun = @import("bun");
const JSAst = bun.JSAst;
const Expr = JSAst.Expr;
const G = JSAst.G;
const E = JSAst.E;
const PackageManager = bun.install.PackageManager;
const string = []const u8;
const UpdateRequest = bun.install.PackageManager.UpdateRequest;
const Environment = bun.Environment;
const Semver = bun.Semver;
const Dependency = bun.install.Dependency;
const invalid_package_id = bun.install.invalid_package_id;
const logger = bun.logger;
const strings = bun.strings;
