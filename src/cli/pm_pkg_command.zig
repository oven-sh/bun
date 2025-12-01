pub const PmPkgCommand = struct {
    const SubCommand = enum {
        get,
        set,
        delete,
        fix,
        help,

        fn fromString(str: []const u8) ?SubCommand {
            return std.meta.stringToEnum(SubCommand, str);
        }
    };

    pub fn exec(ctx: Command.Context, pm: *PackageManager, positionals: []const string, cwd: []const u8) !void {
        if (positionals.len <= 1) {
            printHelp();
            return;
        }

        const subcommand = SubCommand.fromString(positionals[1]) orelse {
            Output.errGeneric("Unknown subcommand: {s}", .{positionals[1]});
            printHelp();
            Global.exit(1);
        };

        switch (subcommand) {
            .get => try execGet(ctx, pm, positionals[2..], cwd),
            .set => try execSet(ctx, pm, positionals[2..], cwd),
            .delete => try execDelete(ctx, pm, positionals[2..], cwd),
            .fix => try execFix(ctx, pm, cwd),
            .help => printHelp(),
        }
    }

    fn printHelp() void {
        Output.prettyln("<r><b>bun pm pkg<r> <d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        const help_text =
            \\  Manage data in package.json
            \\
            \\<b>Subcommands<r>:
            \\  <cyan>get<r> <blue>[key ...]<r>          Get values from package.json
            \\  <cyan>set<r> <blue>key=value ...<r>      Set values in package.json
            \\    <d>└<r> <cyan>--json<r>             Parse values as JSON (e.g. {{"a":1}})
            \\  <cyan>delete<r> <blue>key ...<r>         Delete keys from package.json
            \\  <cyan>fix<r>                    Auto-correct common package.json errors
            \\
            \\<b>Examples<r>:
            \\  <d>$<r> <b><green>bun pm pkg<r> <cyan>get<r> <blue>name version<r>
            \\  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>description="My awesome package"<r>
            \\  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>keywords='["test","demo","example"]'<r> <cyan>--json<r>
            \\  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>config='{{"port":3000,"debug":true}}'<r> <cyan>--json<r>
            \\  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>scripts.test="bun test"<r>
            \\  <d>$<r> <b><green>bun pm pkg<r> <cyan>set<r> <blue>bin.mycli=cli.js<r>
            \\  <d>$<r> <b><green>bun pm pkg<r> <cyan>delete<r> <blue>scripts.test devDependencies.webpack<r>
            \\  <d>$<r> <b><green>bun pm pkg<r> <cyan>fix<r>
            \\
            \\<b>More info<r>: <magenta>https://bun.com/docs/cli/pm#pkg<r>
            \\
        ;
        Output.pretty(help_text, .{});
        Output.flush();
    }

    fn findPackageJson(allocator: std.mem.Allocator, cwd: []const u8) ![]const u8 {
        var path_buf: bun.PathBuffer = undefined;
        var current_dir = cwd;

        while (true) {
            const pkg_path = bun.path.joinAbsStringBufZ(current_dir, &path_buf, &.{"package.json"}, .auto);
            if (bun.sys.existsZ(pkg_path)) {
                return try allocator.dupe(u8, pkg_path);
            }

            const parent = bun.path.dirname(current_dir, .auto);
            if (strings.eql(parent, current_dir)) {
                break;
            }
            current_dir = parent;
        }

        Output.errGeneric("No package.json found", .{});
        Global.exit(1);
    }

    const PackageJson = struct {
        root: js_ast.Expr,
        contents: []const u8,
        source: logger.Source,
        indentation: JSPrinter.Options.Indentation,
    };

    fn loadPackageJson(ctx: Command.Context, allocator: std.mem.Allocator, path: []const u8) !PackageJson {
        const contents = bun.sys.File.readFrom(bun.FD.cwd(), path, allocator).unwrap() catch |err| {
            Output.errGeneric("Failed to read package.json: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        const source = logger.Source.initPathString(path, contents);
        const result = JSON.parsePackageJSONUTF8WithOpts(
            &source,
            ctx.log,
            allocator,
            .{
                .is_json = true,
                .allow_comments = true,
                .allow_trailing_commas = true,
                .guess_indentation = true,
            },
        ) catch |err| {
            Output.errGeneric("Failed to parse package.json: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        return PackageJson{
            .root = result.root,
            .contents = contents,
            .source = source,
            .indentation = result.indentation,
        };
    }

    fn execGet(ctx: Command.Context, pm: *PackageManager, args: []const string, cwd: []const u8) !void {
        _ = pm;
        const path = try findPackageJson(ctx.allocator, cwd);
        defer ctx.allocator.free(path);

        const pkg = try loadPackageJson(ctx, ctx.allocator, path);
        defer ctx.allocator.free(pkg.contents);

        if (pkg.root.data != .e_object) {
            Output.errGeneric("package.json root must be an object", .{});
            Global.exit(1);
        }

        if (args.len == 0) {
            const formatted = try formatJson(ctx.allocator, pkg.root, null);
            defer ctx.allocator.free(formatted);
            Output.println("{s}", .{formatted});
            return;
        }

        var results = bun.StringArrayHashMap([]const u8).init(ctx.allocator);
        defer {
            for (results.values()) |val| ctx.allocator.free(val);
            results.deinit();
        }

        for (args) |key| {
            if (getJsonValue(ctx.allocator, pkg.root, key, if (args.len > 1) 4 else 2)) |value| {
                if (args.len > 1) {
                    if (strings.lastIndexOfChar(value, '}')) |last_index| {
                        const new_value = try std.fmt.allocPrint(ctx.allocator, "{s}  {s}", .{ value[0..last_index], value[last_index..] });
                        try results.put(key, new_value);
                        continue;
                    }
                }
                try results.put(key, value);
            } else |err| {
                if (err == error.InvalidPath) {
                    if (strings.indexOf(key, "[]")) |_| {
                        Output.errGeneric("Empty brackets are not valid syntax for retrieving values.", .{});
                        Global.exit(1);
                    }
                }
                if (err != error.NotFound) return err;
            }
        }

        if (results.count() == 0) {
            Output.println("{{}}", .{});
        } else if (results.count() == 1) {
            const value = results.values()[0];
            Output.println("{s}", .{value});
        } else {
            Output.println("{{", .{});
            for (results.keys(), results.values(), 0..) |key, value, i| {
                const comma = if (i == results.count() - 1) "" else ",";
                Output.println("  \"{s}\": {s}{s}", .{ key, value, comma });
            }
            Output.println("}}", .{});
        }
    }

    fn execSet(ctx: Command.Context, pm: *PackageManager, args: []const string, cwd: []const u8) !void {
        if (args.len == 0) {
            Output.errGeneric("<blue>bun pm pkg set<r> expects a key=value pair of args", .{});
            Global.exit(1);
        }

        const parse_json = pm.options.json_output;

        const path = try findPackageJson(ctx.allocator, cwd);
        defer ctx.allocator.free(path);

        const pkg = try loadPackageJson(ctx, ctx.allocator, path);
        defer ctx.allocator.free(pkg.contents);

        var root = pkg.root;
        if (root.data != .e_object) {
            Output.errGeneric("package.json root must be an object", .{});
            Global.exit(1);
        }

        var modified = false;
        for (args) |arg| {
            const eq_pos = strings.indexOf(arg, "=") orelse {
                Output.errGeneric("Invalid argument: {s} (expected key=value)", .{arg});
                Global.exit(1);
            };

            const key = arg[0..eq_pos];
            const value = arg[eq_pos + 1 ..];

            if (key.len == 0) {
                Output.errGeneric("Empty key in argument: {s}", .{arg});
                Global.exit(1);
            }

            if (value.len == 0) {
                Output.errGeneric("Empty value in argument: {s}", .{arg});
                Global.exit(1);
            }

            try setValue(ctx.allocator, &root, key, value, parse_json);
            modified = true;
        }

        if (modified) {
            try savePackageJson(ctx.allocator, path, root, &pkg);
        }
    }

    fn execDelete(ctx: Command.Context, pm: *PackageManager, args: []const string, cwd: []const u8) !void {
        _ = pm;
        if (args.len == 0) {
            Output.errGeneric("<blue>bun pm pkg <b>delete<r> expects key args", .{});
            Global.exit(1);
        }

        const path = try findPackageJson(ctx.allocator, cwd);
        defer ctx.allocator.free(path);

        const pkg = try loadPackageJson(ctx, ctx.allocator, path);
        defer ctx.allocator.free(pkg.contents);

        var root = pkg.root;
        if (root.data != .e_object) {
            Output.errGeneric("package.json root must be an object", .{});
            Global.exit(1);
        }

        var modified = false;
        for (args) |key| {
            if (deleteValue(ctx.allocator, &root, key)) |deleted| {
                if (deleted) modified = true;
            } else |err| {
                if (err != error.NotFound) return err;
            }
        }

        if (modified) {
            try savePackageJson(ctx.allocator, path, root, &pkg);
        }
    }

    fn execFix(ctx: Command.Context, pm: *PackageManager, cwd: []const u8) !void {
        _ = pm;
        const path = try findPackageJson(ctx.allocator, cwd);
        defer ctx.allocator.free(path);

        const pkg = try loadPackageJson(ctx, ctx.allocator, path);
        defer ctx.allocator.free(pkg.contents);

        var root = pkg.root;
        if (root.data != .e_object) {
            Output.errGeneric("package.json root must be an object", .{});
            Global.exit(1);
        }

        var modified = false;

        if (root.get("name")) |name_prop| {
            switch (name_prop.data) {
                .e_string => |str| {
                    const name_str = str.slice(ctx.allocator);
                    const lowercase = try std.ascii.allocLowerString(ctx.allocator, name_str);
                    defer ctx.allocator.free(lowercase);

                    if (!strings.eql(name_str, lowercase)) {
                        try setValue(ctx.allocator, &root, "name", lowercase, false);
                        modified = true;
                    }
                },
                else => {},
            }
        }

        if (root.get("bin")) |bin_prop| {
            if (bin_prop.data == .e_object) {
                const props = bin_prop.data.e_object.properties.slice();
                for (props) |prop| {
                    const value = prop.value orelse continue;

                    switch (value.data) {
                        .e_string => |str| {
                            const bin_path = str.slice(ctx.allocator);
                            var pkg_dir = bun.path.dirname(path, .auto);
                            if (pkg_dir.len == 0) pkg_dir = cwd;
                            var buf: bun.PathBuffer = undefined;
                            const full_path = bun.path.joinAbsStringBufZ(pkg_dir, &buf, &.{bin_path}, .auto);

                            if (!bun.sys.existsZ(full_path)) {
                                Output.warn("No bin file found at {s}", .{bin_path});
                            }
                        },
                        else => {},
                    }
                }
            }
        }

        if (modified) {
            try savePackageJson(ctx.allocator, path, root, &pkg);
        }
    }

    fn formatJson(allocator: std.mem.Allocator, expr: js_ast.Expr, initial_indent: ?usize) ![]const u8 {
        switch (expr.data) {
            .e_boolean => |b| {
                return try allocator.dupe(u8, if (b.value) "true" else "false");
            },
            .e_number => |n| {
                if (@floor(n.value) == n.value) {
                    return try std.fmt.allocPrint(allocator, "{d:.0}", .{n.value});
                } else {
                    return try std.fmt.allocPrint(allocator, "{d}", .{n.value});
                }
            },
            .e_null => {
                return try allocator.dupe(u8, "null");
            },
            else => {
                const buffer_writer = JSPrinter.BufferWriter.init(allocator);
                var printer = JSPrinter.BufferPrinter.init(buffer_writer);

                _ = JSPrinter.printJSON(
                    @TypeOf(&printer),
                    &printer,
                    expr,
                    &logger.Source.initEmptyFile("expression.json"),
                    .{
                        .mangled_props = null,
                        .indent = if (initial_indent) |indent| .{
                            .scalar = indent,
                            .count = 0,
                        } else .{
                            .scalar = 2,
                            .count = 0,
                        },
                    },
                ) catch |err| {
                    return err;
                };

                const written = printer.ctx.getWritten();
                return try allocator.dupe(u8, written);
            },
        }
    }

    fn getJsonValue(allocator: std.mem.Allocator, root: js_ast.Expr, key: []const u8, initial_indent: ?usize) ![]const u8 {
        const expr = try resolvePath(root, key);
        return try formatJson(allocator, expr, initial_indent);
    }

    fn resolvePath(root: js_ast.Expr, key: []const u8) !js_ast.Expr {
        if (root.data != .e_object) {
            return error.NotFound;
        }

        var parts = std.mem.tokenizeScalar(u8, key, '.');
        var current = root;

        while (parts.next()) |part| {
            if (strings.indexOf(part, "[")) |first_bracket| {
                var remaining_part = part;

                if (first_bracket > 0) {
                    const prop_name = part[0..first_bracket];
                    if (current.data != .e_object) {
                        return error.NotFound;
                    }
                    current = current.get(prop_name) orelse return error.NotFound;
                    remaining_part = part[first_bracket..];
                }

                while (strings.indexOf(remaining_part, "[")) |bracket_start| {
                    const bracket_end = strings.indexOf(remaining_part[bracket_start..], "]") orelse return error.InvalidPath;
                    const actual_bracket_end = bracket_start + bracket_end;
                    const index_str = remaining_part[bracket_start + 1 .. actual_bracket_end];

                    if (index_str.len == 0) {
                        return error.InvalidPath;
                    }

                    if (std.fmt.parseInt(usize, index_str, 10)) |index| {
                        if (current.data != .e_array) {
                            return error.NotFound;
                        }

                        if (index >= current.data.e_array.items.len) {
                            return error.NotFound;
                        }

                        current = current.data.e_array.items.ptr[index];
                    } else |_| {
                        if (current.data != .e_object) {
                            return error.NotFound;
                        }
                        current = current.get(index_str) orelse return error.NotFound;
                    }

                    remaining_part = remaining_part[actual_bracket_end + 1 ..];
                    if (remaining_part.len == 0) break;
                }
            } else {
                if (std.fmt.parseInt(usize, part, 10)) |index| {
                    if (current.data == .e_array) {
                        if (index >= current.data.e_array.items.len) {
                            return error.NotFound;
                        }
                        current = current.data.e_array.items.ptr[index];
                    } else if (current.data == .e_object) {
                        current = current.get(part) orelse return error.NotFound;
                    } else {
                        return error.NotFound;
                    }
                } else |_| {
                    if (current.data != .e_object) {
                        return error.NotFound;
                    }
                    current = current.get(part) orelse return error.NotFound;
                }
            }
        }

        return current;
    }

    fn parseKeyPath(allocator: std.mem.Allocator, key: []const u8) !std.array_list.Managed([]const u8) {
        var path_parts = std.array_list.Managed([]const u8).init(allocator);
        errdefer {
            for (path_parts.items) |item| allocator.free(item);
            path_parts.deinit();
        }

        var parts = std.mem.tokenizeScalar(u8, key, '.');

        while (parts.next()) |part| {
            if (strings.indexOf(part, "[")) |first_bracket| {
                var remaining_part = part;

                if (first_bracket > 0) {
                    const prop_name = part[0..first_bracket];
                    const prop_copy = try allocator.dupe(u8, prop_name);
                    try path_parts.append(prop_copy);
                    remaining_part = part[first_bracket..];
                }

                while (strings.indexOf(remaining_part, "[")) |bracket_start| {
                    const bracket_end = strings.indexOf(remaining_part[bracket_start..], "]") orelse {
                        return error.InvalidPath;
                    };
                    const actual_bracket_end = bracket_start + bracket_end;
                    const index_str = remaining_part[bracket_start + 1 .. actual_bracket_end];

                    if (index_str.len == 0) {
                        return error.InvalidPath;
                    }

                    const index_copy = try allocator.dupe(u8, index_str);
                    try path_parts.append(index_copy);

                    remaining_part = remaining_part[actual_bracket_end + 1 ..];
                    if (remaining_part.len == 0) break;
                }
            } else {
                const part_copy = try allocator.dupe(u8, part);
                try path_parts.append(part_copy);
            }
        }

        return path_parts;
    }

    fn setValue(allocator: std.mem.Allocator, root: *js_ast.Expr, key: []const u8, value: []const u8, parse_json: bool) !void {
        if (root.data != .e_object) {
            return error.InvalidRoot;
        }

        if (strings.indexOf(key, "[") == null) {
            var parts = std.mem.tokenizeScalar(u8, key, '.');
            var path_parts = std.array_list.Managed([]const u8).init(allocator);
            defer path_parts.deinit();

            while (parts.next()) |part| {
                try path_parts.append(part);
            }

            if (path_parts.items.len == 0) {
                return error.EmptyKey;
            }

            if (path_parts.items.len == 1) {
                const expr = try parseValue(allocator, value, parse_json);
                try root.data.e_object.put(allocator, path_parts.items[0], expr);
                return;
            }

            try setNestedSimple(allocator, root, path_parts.items, value, parse_json);
            return;
        }

        var path_parts = parseKeyPath(allocator, key) catch |err| {
            return err;
        };
        defer {
            for (path_parts.items) |part| {
                allocator.free(part);
            }
            path_parts.deinit();
        }

        if (path_parts.items.len == 0) {
            return error.EmptyKey;
        }

        if (path_parts.items.len == 1) {
            const expr = try parseValue(allocator, value, parse_json);

            try root.data.e_object.put(allocator, path_parts.items[0], expr);

            path_parts.items[0] = "";
            return;
        }

        try setNested(allocator, root, path_parts.items, value, parse_json);
    }

    fn setNestedSimple(allocator: std.mem.Allocator, root: *js_ast.Expr, path: []const []const u8, value: []const u8, parse_json: bool) !void {
        if (path.len == 0) return;

        const current_key = path[0];
        const remaining_path = path[1..];

        if (remaining_path.len == 0) {
            const expr = try parseValue(allocator, value, parse_json);
            try root.data.e_object.put(allocator, current_key, expr);
            return;
        }

        var nested_obj = root.get(current_key);
        if (nested_obj == null or nested_obj.?.data != .e_object) {
            const new_obj = js_ast.Expr.init(js_ast.E.Object, js_ast.E.Object{}, logger.Loc.Empty);
            try root.data.e_object.put(allocator, current_key, new_obj);
            nested_obj = root.get(current_key);
        }

        if (nested_obj.?.data != .e_object) {
            return error.ExpectedObject;
        }

        var nested = nested_obj.?;
        try setNestedSimple(allocator, &nested, remaining_path, value, parse_json);
        try root.data.e_object.put(allocator, current_key, nested);
    }

    fn setNested(allocator: std.mem.Allocator, root: *js_ast.Expr, path: [][]const u8, value: []const u8, parse_json: bool) !void {
        if (path.len == 0) return;

        const current_key = path[0];
        const remaining_path = path[1..];

        if (remaining_path.len == 0) {
            const expr = try parseValue(allocator, value, parse_json);

            try root.data.e_object.put(allocator, current_key, expr);

            path[0] = "";
            return;
        }

        var nested_obj = root.get(current_key);
        if (nested_obj == null or nested_obj.?.data != .e_object) {
            const new_obj = js_ast.Expr.init(js_ast.E.Object, js_ast.E.Object{}, logger.Loc.Empty);

            try root.data.e_object.put(allocator, current_key, new_obj);

            path[0] = "";
            nested_obj = root.get(current_key);
        }

        if (nested_obj.?.data != .e_object) {
            return error.ExpectedObject;
        }

        var nested = nested_obj.?;
        try setNested(allocator, &nested, remaining_path, value, parse_json);
    }

    fn parseValue(allocator: std.mem.Allocator, value: []const u8, parse_json: bool) !js_ast.Expr {
        if (parse_json) {
            if (strings.eqlComptime(value, "true")) {
                return js_ast.Expr.init(js_ast.E.Boolean, js_ast.E.Boolean{ .value = true }, logger.Loc.Empty);
            } else if (strings.eqlComptime(value, "false")) {
                return js_ast.Expr.init(js_ast.E.Boolean, js_ast.E.Boolean{ .value = false }, logger.Loc.Empty);
            } else if (strings.eqlComptime(value, "null")) {
                return js_ast.Expr.init(js_ast.E.Null, js_ast.E.Null{}, logger.Loc.Empty);
            }

            if (std.fmt.parseInt(i64, value, 10)) |int_val| {
                return js_ast.Expr.init(js_ast.E.Number, js_ast.E.Number{ .value = @floatFromInt(int_val) }, logger.Loc.Empty);
            } else |_| {}

            if (std.fmt.parseFloat(f64, value)) |float_val| {
                return js_ast.Expr.init(js_ast.E.Number, js_ast.E.Number{ .value = float_val }, logger.Loc.Empty);
            } else |_| {}

            const temp_source = logger.Source.initPathString("package.json", value);
            var temp_log = logger.Log.init(allocator);
            if (JSON.parsePackageJSONUTF8(&temp_source, &temp_log, allocator)) |json_expr| {
                return json_expr;
            } else |_| {
                const data = try allocator.dupe(u8, value);
                return js_ast.Expr.init(js_ast.E.String, js_ast.E.String.init(data), logger.Loc.Empty);
            }
        } else {
            const data = try allocator.dupe(u8, value);
            return js_ast.Expr.init(js_ast.E.String, js_ast.E.String.init(data), logger.Loc.Empty);
        }
    }

    fn deleteValue(allocator: std.mem.Allocator, root: *js_ast.Expr, key: []const u8) !bool {
        if (root.data != .e_object) return false;

        var parts = std.mem.tokenizeScalar(u8, key, '.');
        var path_parts = std.array_list.Managed([]const u8).init(allocator);
        defer path_parts.deinit();

        while (parts.next()) |part| {
            try path_parts.append(part);
        }

        if (path_parts.items.len == 0) return false;

        if (path_parts.items.len == 1) {
            const exists = root.get(path_parts.items[0]) != null;
            if (exists) {
                return try removeProperty(allocator, root, path_parts.items[0]);
            }
            return false;
        }

        return try deleteNested(allocator, root, path_parts.items);
    }

    fn deleteNested(allocator: std.mem.Allocator, root: *js_ast.Expr, path: []const []const u8) !bool {
        if (path.len == 0) return false;

        const current_key = path[0];
        const remaining_path = path[1..];

        if (remaining_path.len == 0) {
            const exists = root.get(current_key) != null;
            if (exists) {
                return try removeProperty(allocator, root, current_key);
            }
            return false;
        }

        const nested_obj = root.get(current_key);
        if (nested_obj == null or nested_obj.?.data != .e_object) {
            return false;
        }

        var nested = nested_obj.?;
        const deleted = try deleteNested(allocator, &nested, remaining_path);

        if (deleted) {
            try root.data.e_object.put(allocator, current_key, nested);
        }

        return deleted;
    }

    fn removeProperty(allocator: std.mem.Allocator, obj: *js_ast.Expr, key: []const u8) !bool {
        if (obj.data != .e_object) return false;

        const old_props = obj.data.e_object.properties.slice();
        var found = false;
        for (old_props) |prop| {
            if (prop.key) |k| {
                switch (k.data) {
                    .e_string => |s| {
                        if (strings.eql(s.data, key)) {
                            found = true;
                            break;
                        }
                    },
                    else => {},
                }
            }
        }

        if (!found) return false;
        var new_props: bun.BabyList(js_ast.G.Property) = try .initCapacity(allocator, old_props.len - 1);
        for (old_props) |prop| {
            if (prop.key) |k| {
                switch (k.data) {
                    .e_string => |s| {
                        if (strings.eql(s.data, key)) {
                            continue;
                        }
                    },
                    else => {},
                }
            }
            new_props.appendAssumeCapacity(prop);
        }
        obj.data.e_object.properties = new_props;

        return true;
    }

    fn savePackageJson(allocator: std.mem.Allocator, path: []const u8, root: js_ast.Expr, pkg: *const PackageJson) !void {
        const preserve_newline = pkg.contents.len > 0 and pkg.contents[pkg.contents.len - 1] == '\n';

        var buffer_writer = JSPrinter.BufferWriter.init(allocator);
        try buffer_writer.buffer.list.ensureTotalCapacity(allocator, pkg.contents.len + 1);
        buffer_writer.append_newline = preserve_newline;

        var writer = JSPrinter.BufferPrinter.init(buffer_writer);

        _ = JSPrinter.printJSON(
            @TypeOf(&writer),
            &writer,
            root,
            &pkg.source,
            .{
                .indent = pkg.indentation,
                .mangled_props = null,
            },
        ) catch |err| {
            Output.errGeneric("Failed to serialize package.json: {s}", .{@errorName(err)});
            Global.exit(1);
        };

        const content = writer.ctx.writtenWithoutTrailingZero();
        std.fs.cwd().writeFile(.{
            .sub_path = path,
            .data = content,
        }) catch |err| {
            Output.errGeneric("Failed to write package.json: {s}", .{@errorName(err)});
            Global.exit(1);
        };
    }
};

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const JSON = bun.json;
const JSPrinter = bun.js_printer;
const Output = bun.Output;
const js_ast = bun.ast;
const logger = bun.logger;
const strings = bun.strings;
const Command = bun.cli.Command;
const PackageManager = bun.install.PackageManager;
