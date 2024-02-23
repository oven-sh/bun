const std = @import("std");
const bun = @import("root").bun;
const Global = bun.Global;
const Output = bun.Output;
const string = bun.string;
const strings = bun.strings;
const Command = @import("../cli.zig").Command;
const Fs = @import("../fs.zig");
const Dependency = @import("../install/dependency.zig");
const Install = @import("../install/install.zig");
const PackageID = Install.PackageID;
const DependencyID = Install.DependencyID;
const PackageManager = Install.PackageManager;
const Lockfile = @import("../install/lockfile.zig");
const NodeModulesFolder = Lockfile.Tree.NodeModulesFolder;
const Path = @import("../resolver/resolve_path.zig");
const String = @import("../install/semver.zig").String;

fn handleLoadLockfileErrors(load_lockfile: Lockfile.LoadFromDiskResult, pm: *PackageManager) void {
    if (load_lockfile == .not_found) {
        if (pm.options.log_level != .silent)
            Output.prettyErrorln("Lockfile not found", .{});
        Global.exit(1);
    }

    if (load_lockfile == .err) {
        if (pm.options.log_level != .silent)
            Output.prettyErrorln("Error loading lockfile: {s}", .{@errorName(load_lockfile.err.value)});
        Global.exit(1);
    }
}

pub const WhyCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        // var args = try std.process.argsAlloc(ctx.allocator);

        // Same code as in `bun pm`
        var pm = PackageManager.init(ctx, PackageManager.Subcommand.why) catch |err| {
            if (err == error.MissingPackageJSON) {
                var cwd_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                if (bun.getcwd(&cwd_buf)) |cwd| {
                    Output.errGeneric("No package.json was found for directory \"{s}\"", .{cwd});
                } else |_| {
                    Output.errGeneric("No package.json was found", .{});
                }
                Output.note("Run \"bun init\" to initialize a project", .{});
                Global.exit(1);
            }
            return err;
        };

        const load_lockfile = pm.lockfile.loadFromDisk(ctx.allocator, ctx.log, "bun.lockb");
        handleLoadLockfileErrors(load_lockfile, pm);

        Output.flush();
        Output.disableBuffering();
        const lockfile = load_lockfile.ok.lockfile;

        for (pm.options.positionals[1..]) |param| {
            const id = if (lockfile.package_index.get(String.Builder.stringHash(param))) |id| id.PackageID else {
                Output.errGeneric("Could not find package {s}", .{param});
                Global.exit(1);
            };

            const Candidate = struct {
                name: String,
                len: u32,
                prev: PackageID, // 0 is a special case for "root"
                package_idx: usize,
            };

            var candidates = std.AutoHashMap(PackageID, Candidate).init(ctx.allocator);
            defer candidates.deinit();

            // reserve root
            try candidates.put(0, .{
                .name = lockfile.rootPackage().?.name,
                .prev = 0,
                .len = 0,
                .package_idx = 0,
            });

            // Output.println("Building RIndex", .{});
            // build reverse index
            {
                var to_explore = std.ArrayList(PackageID).init(ctx.allocator);
                defer to_explore.deinit();

                (try to_explore.addOne()).* = 0;

                while (to_explore.popOrNull()) |candidate_id| {
                    const candidate = candidates.get(candidate_id).?;
                    const resolutions = lockfile.packages.get(candidate.package_idx).resolutions.get(lockfile.buffers.resolutions.items);
                    // Output.println("Walking {} w/ {} res", .{ candidate_id, resolutions.len });

                    for (resolutions) |dep_id| {
                        const val = candidates.get(dep_id);
                        // Output.println("Walking Res {} {s}", .{ dep_id, if (val) |v| v.name.slice(lockfile.buffers.string_bytes.items) else "null" });
                        if (val == null or (val.?.len > (candidate.len + 1))) {
                            const idx = for (0..(lockfile.packages.len)) |i| {
                                const p = lockfile.packages.get(i);
                                if (p.meta.id == dep_id) {
                                    break i;
                                }
                            } else {
                                unreachable;
                            };
                            const name = lockfile.packages.get(idx).name;
                            // Output.println("Discovered {s} via {s} - {}", .{ name.slice(lockfile.buffers.string_bytes.items), candidate.name.slice(lockfile.buffers.string_bytes.items), candidate.len + 1 });
                            try candidates.put(dep_id, .{
                                .prev = candidate_id,
                                .len = candidate.len + 1,
                                .package_idx = idx,
                                .name = name,
                            });
                            (try to_explore.addOne()).* = dep_id;
                        }
                    }
                }
            }
            // Output.println("resolving tree", .{});
            var current: ?Candidate = b: {
                var it = candidates.valueIterator();
                while (it.next()) |c| {
                    // const name = c.name.slice(lockfile.buffers.string_bytes.items);
                    // Output.println("searching {s}", .{name});
                    if (c.package_idx == id) {
                        break :b c.*;
                    }
                } else {
                    unreachable;
                }
            };

            Output.prettyln("The package {s} is installed", .{current.?.name.slice(lockfile.buffers.string_bytes.items)});
            current = candidates.get(current.?.prev);

            while (current) |c| {
                Output.prettyln("-> due to {s}", .{c.name.slice(lockfile.buffers.string_bytes.items)});
                if (c.prev != 0) {
                    current = candidates.get(c.prev);
                } else {
                    current = null;
                }
            }
        }

        Global.exit(0);
    }
};
