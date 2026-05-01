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
        items: [Lockfile.Scripts.names.len]?string,
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
                Output.pretty("<d>.{s}{s} @{f}<r>\n", .{
                    std.fs.path.sep_str,
                    strings.withoutTrailingSlash(this.cwd[i + 1 ..]),
                    resolution.fmt(resolution_buf, .posix),
                });
            } else {
                Output.pretty("<d>{s} @{f}<r>\n", .{
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
                        script,
                    });
                }
            }
        }

        pub fn first(this: Package.Scripts.List) string {
            if (comptime Environment.allow_assert) {
                assert(this.items[this.first_index] != null);
            }
            return this.items[this.first_index].?;
        }

        // pub fn deinit(this: Package.Scripts.List, allocator: std.mem.Allocator) void {
        //     for (this.items) |maybe_item| {
        //         if (maybe_item) |item| {
        //             allocator.free(item);
        //         }
        //     }

        //     allocator.free(this.cwd);
        // }

        pub fn appendToLockfile(this: Package.Scripts.List, lockfile: *Lockfile) void {
            inline for (this.items, 0..) |maybe_script, i| {
                if (maybe_script) |script| {
                    debug("enqueue({s}, {s}) in {s}", .{ "prepare", this.package_name, this.cwd });
                    bun.handleOom(@field(lockfile.scripts, Lockfile.Scripts.names[i]).append(lockfile.allocator, script));
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
        lockfile: *const Lockfile,
        lockfile_buf: string,
        resolution_tag: Resolution.Tag,
        add_node_gyp_rebuild_script: bool,
        // return: first_index, total, entries
    ) struct { i8, u8, [Lockfile.Scripts.names.len]?string } {
        const allocator = lockfile.allocator;
        var script_index: u8 = 0;
        var first_script_index: i8 = -1;
        var scripts: [6]?string = .{null} ** 6;
        var counter: u8 = 0;

        if (add_node_gyp_rebuild_script) {
            {
                script_index += 1;
                if (first_script_index == -1) first_script_index = @intCast(script_index);
                scripts[script_index] = allocator.dupe(u8, "node-gyp rebuild") catch unreachable;
                script_index += 1;
                counter += 1;
            }

            // missing install and preinstall, only need to check postinstall
            if (!this.postinstall.isEmpty()) {
                if (first_script_index == -1) first_script_index = @intCast(script_index);
                scripts[script_index] = allocator.dupe(u8, this.preinstall.slice(lockfile_buf)) catch unreachable;
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
                    if (first_script_index == -1) first_script_index = @intCast(script_index);
                    scripts[script_index] = allocator.dupe(u8, script.slice(lockfile_buf)) catch unreachable;
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
                        if (first_script_index == -1) first_script_index = @intCast(script_index);
                        scripts[script_index] = allocator.dupe(u8, script.slice(lockfile_buf)) catch unreachable;
                        counter += 1;
                    }
                    script_index += 1;
                }
            },
            .workspace => {
                script_index += 1;
                if (!this.prepare.isEmpty()) {
                    if (first_script_index == -1) first_script_index = @intCast(script_index);
                    scripts[script_index] = allocator.dupe(u8, this.prepare.slice(lockfile_buf)) catch unreachable;
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
        lockfile: *const Lockfile,
        lockfile_buf: []const u8,
        cwd_: *bun.AbsPath(.{ .sep = .auto }),
        package_name: string,
        resolution_tag: Resolution.Tag,
        add_node_gyp_rebuild_script: bool,
    ) ?Package.Scripts.List {
        const allocator = lockfile.allocator;
        const first_index, const total, const scripts = getScriptEntries(this, lockfile, lockfile_buf, resolution_tag, add_node_gyp_rebuild_script);
        if (first_index != -1) {
            var cwd_buf: if (Environment.isWindows) bun.PathBuffer else void = undefined;

            const cwd = if (comptime !Environment.isWindows)
                cwd_.slice()
            else brk: {
                const cwd_handle = bun.openDirNoRenamingOrDeletingWindows(bun.invalid_fd, cwd_.sliceZ()) catch break :brk cwd_.slice();
                break :brk FD.fromStdDir(cwd_handle).getFdPath(&cwd_buf) catch break :brk cwd_.slice();
            };

            return .{
                .items = scripts,
                .first_index = @intCast(first_index),
                .total = total,
                .cwd = bun.handleOom(allocator.dupeZ(u8, cwd)),
                .package_name = bun.handleOom(lockfile.allocator.dupe(u8, package_name)),
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
        lockfile: *const Lockfile,
        folder_path: *bun.AbsPath(.{ .sep = .auto }),
        folder_name: string,
        resolution: *const Resolution,
    ) !?Package.Scripts.List {
        if (this.hasAny()) {
            const add_node_gyp_rebuild_script = if (lockfile.hasTrustedDependency(folder_name, resolution) and
                this.install.isEmpty() and
                this.preinstall.isEmpty())
            brk: {
                var save = folder_path.save();
                defer save.restore();
                folder_path.append("binding.gyp");

                break :brk bun.sys.exists(folder_path.slice());
            } else false;

            return this.createList(
                lockfile,
                lockfile.buffers.string_bytes.items,
                folder_path,
                folder_name,
                resolution.tag,
                add_node_gyp_rebuild_script,
            );
        } else if (!this.filled) {
            return this.createFromPackageJSON(
                log,
                lockfile,
                folder_path,
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
        folder_path: *bun.AbsPath(.{ .sep = .auto }),
    ) !void {
        const json = brk: {
            var save = folder_path.save();
            defer save.restore();
            folder_path.append("package.json");

            const json_src = brk2: {
                const buf = try bun.sys.File.readFrom(bun.FD.cwd(), folder_path.sliceZ(), allocator).unwrap();
                break :brk2 logger.Source.initPathString(folder_path.slice(), buf);
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
        lockfile: *const Lockfile,
        folder_path: *bun.AbsPath(.{ .sep = .auto }),
        folder_name: string,
        resolution_tag: Resolution.Tag,
    ) !?Package.Scripts.List {
        var tmp: Lockfile = undefined;
        tmp.initEmpty(lockfile.allocator);
        defer tmp.deinit();
        var builder = tmp.stringBuilder();
        try this.fillFromPackageJSON(lockfile.allocator, &builder, log, folder_path);

        const add_node_gyp_rebuild_script = if (this.install.isEmpty() and this.preinstall.isEmpty()) brk: {
            const save = folder_path.save();
            defer save.restore();
            folder_path.append("binding.gyp");

            break :brk bun.sys.exists(folder_path.slice());
        } else false;

        return this.createList(
            lockfile,
            tmp.buffers.string_bytes.items,
            folder_path,
            folder_name,
            resolution_tag,
            add_node_gyp_rebuild_script,
        );
    }
};

const string = []const u8;
const stringZ = [:0]const u8;
const debug = Output.scoped(.Lockfile, .hidden);

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const FD = bun.FD;
const JSON = bun.json;
const Output = bun.Output;
const assert = bun.assert;
const logger = bun.logger;
const strings = bun.strings;
const Expr = bun.ast.Expr;

const Semver = bun.Semver;
const String = Semver.String;

const install = bun.install;
const Resolution = bun.install.Resolution;
const initializeStore = install.initializeStore;

const Lockfile = install.Lockfile;
const Package = Lockfile.Package;
const StringBuilder = Lockfile.StringBuilder;
