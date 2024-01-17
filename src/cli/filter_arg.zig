const std = @import("std");
const root = @import("root");
const bun = root.bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const strings = bun.strings;
const json_parser = bun.JSON;
const Glob = @import("../glob.zig");

const Package = @import("../install/lockfile.zig").Package;

fn findWorkspaceMembers(allocator: std.mem.Allocator, log: *bun.logger.Log, workspace_map: *Package.WorkspaceMap, workdir_: []const u8) !void {
    bun.JSAst.Expr.Data.Store.create(bun.default_allocator);
    bun.JSAst.Stmt.Data.Store.create(bun.default_allocator);

    defer {
        bun.JSAst.Expr.Data.Store.reset();
        bun.JSAst.Stmt.Data.Store.reset();
    }

    var workdir = workdir_;

    while (true) : (workdir = std.fs.path.dirname(workdir) orelse break) {
        const parent_trimmed = strings.withoutTrailingSlash(workdir);
        var buf2: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
        @memcpy(buf2[0..parent_trimmed.len], parent_trimmed);
        buf2[parent_trimmed.len..buf2.len][0.."/package.json".len].* = "/package.json".*;
        buf2[parent_trimmed.len + "/package.json".len] = 0;
        const json_path = buf2[0 .. parent_trimmed.len + "/package.json".len];
        log.msgs.clearRetainingCapacity();
        log.errors = 0;
        log.warnings = 0;

        const json_file = std.fs.cwd().openFileZ(
            buf2[0 .. parent_trimmed.len + "/package.json".len :0].ptr,
            .{ .mode = .read_only },
        ) catch continue;
        defer json_file.close();

        const json_stat_size = try json_file.getEndPos();
        const json_buf = try allocator.alloc(u8, json_stat_size + 64);
        defer allocator.free(json_buf);
        const json_len = try json_file.preadAll(json_buf, 0);
        const json_source = bun.logger.Source.initPathString(json_path, json_buf[0..json_len]);
        const json = try json_parser.ParseJSONUTF8(&json_source, log, allocator);

        const prop = json.asProperty("workspaces") orelse continue;

        const json_array = switch (prop.expr.data) {
            .e_array => |arr| arr,
            .e_object => |obj| if (obj.get("packages")) |packages| switch (packages.data) {
                .e_array => |arr| arr,
                else => break,
            } else break,
            else => break,
        };
        _ = Package.processWorkspaceNamesArray(
            workspace_map,
            allocator,
            log,
            json_array,
            &json_source,
            prop.loc,
            null,
        ) catch |err| {
            return err;
        };
        return;
    }

    // if we were not able to find a workspace root, try globbing for package.json files

    var walker = Glob.BunGlobWalker{};
    var arena = std.heap.ArenaAllocator.init(allocator);
    const walker_init_res = try walker.init(&arena, "**/package.json", true, true, false, true, true);
    switch (walker_init_res) {
        .err => |err| {
            Output.prettyErrorln("Error: {}", .{err});
            return;
        },
        else => {},
    }
    defer walker.deinit(true);

    var iter = Glob.BunGlobWalker.Iterator{ .walker = &walker };
    const iter_init_res = try iter.init();
    switch (iter_init_res) {
        .err => |err| {
            Output.prettyErrorln("Error: {}", .{err});
            return;
        },
        else => {},
    }
    defer iter.deinit();

    while (true) {
        const next = try iter.next();
        const path = switch (next) {
            .err => |err| {
                Output.prettyErrorln("Error: {}", .{err});
                continue;
            },
            .result => |path| path orelse break,
        };

        const json_file = std.fs.cwd().openFile(
            path,
            .{ .mode = .read_only },
        ) catch {
            continue;
        };
        defer json_file.close();

        const json_stat_size = try json_file.getEndPos();
        const json_buf = try allocator.alloc(u8, json_stat_size + 64);
        defer allocator.free(json_buf);

        const json_len = try json_file.preadAll(json_buf, 0);
        const json_source = bun.logger.Source.initPathString(path, json_buf[0..json_len]);

        var parser = try json_parser.PackageJSONVersionChecker.init(allocator, &json_source, log);
        _ = try parser.parseExpr();
        if (!parser.has_found_name) {
            continue;
        }
        const entry = Package.WorkspaceMap.Entry{ .name = try allocator.dupe(u8, parser.found_name), .version = null, .name_loc = bun.logger.Loc.Empty };
        const dirpath = std.fs.path.dirname(path) orelse continue;
        try workspace_map.insert(try allocator.dupe(u8, dirpath), entry);
    }
}

pub fn getFilteredPackages(ctx: bun.CLI.Command.Context, cwd: []const u8, paths: *std.ArrayList([]u8)) !void {
    // TODO in the future we can try loading the lockfile to get the workspace information more quickly
    // var manager = try PackageManager.init(ctx, PackageManager.Subcommand.pm);
    // const load_lockfile = manager.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
    // if (load_lockfile == .not_found) {

    // find the paths of all projects that match this filter

    var wsmap = Package.WorkspaceMap.init(ctx.allocator);
    defer wsmap.deinit();
    // find the root package.json of the workspace and load the child packages into workspace map
    findWorkspaceMembers(ctx.allocator, ctx.log, &wsmap, cwd) catch |err| {
        if (comptime bun.Environment.allow_assert) {
            if (@errorReturnTrace()) |trace| {
                std.debug.print("Error: {s}\n{}\n", .{ @errorName(err), trace });
            }
        }
        Output.err(err, "Failed to find workspace root in {s}", .{cwd});
        ctx.log.printForLogLevelColorsRuntime(Output.errorWriter(), Output.enable_ansi_colors) catch {};
        Global.exit(1);
    };

    var pattern_stack = std.heap.stackFallback(4096, bun.default_allocator);
    var pattern = std.ArrayList(u32).init(pattern_stack.get());
    defer pattern.deinit();

    // check each pattern against each package name
    for (ctx.filters) |pattern_utf8_| {
        var pattern_utf8 = pattern_utf8_;
        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        const is_file_pattern = pattern_utf8.len > 0 and pattern_utf8[0] == '.';
        if (is_file_pattern) {
            const parts = [_]string{pattern_utf8};
            pattern_utf8 = bun.path.joinAbsStringBuf(cwd, &path_buf, &parts, .auto);
        }

        pattern.clearRetainingCapacity();
        var codepointer_iter = strings.UnsignedCodepointIterator.init(pattern_utf8);
        var cursor = strings.UnsignedCodepointIterator.Cursor{};
        while (codepointer_iter.next(&cursor)) {
            try pattern.append(cursor.c);
        }
        for (wsmap.keys(), wsmap.values()) |path, entry| {
            const target = if (is_file_pattern) path else entry.name;
            if (Glob.matchImpl(pattern.items, target)) {
                try paths.append(try ctx.allocator.dupe(u8, path));
            }
        }
    }
}
