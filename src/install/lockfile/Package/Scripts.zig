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
        items: [Lockfile.Scripts.names.len]?Lockfile.Scripts.Entry,
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
                Output.pretty("<d>.{s}{s} @{}<r>\n", .{
                    std.fs.path.sep_str,
                    strings.withoutTrailingSlash(this.cwd[i + 1 ..]),
                    resolution.fmt(resolution_buf, .posix),
                });
            } else {
                Output.pretty("<d>{s} @{}<r>\n", .{
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
                        script.script,
                    });
                }
            }
        }

        pub fn first(this: Package.Scripts.List) Lockfile.Scripts.Entry {
            if (comptime Environment.allow_assert) {
                assert(this.items[this.first_index] != null);
            }
            return this.items[this.first_index].?;
        }

        pub fn deinit(this: Package.Scripts.List, allocator: std.mem.Allocator) void {
            for (this.items) |maybe_item| {
                if (maybe_item) |item| {
                    allocator.free(item.script);
                }
            }

            allocator.free(this.cwd);
        }

        pub fn appendToLockfile(this: Package.Scripts.List, lockfile: *Lockfile) void {
            inline for (this.items, 0..) |maybe_script, i| {
                if (maybe_script) |script| {
                    debug("enqueue({s}, {s}) in {s}", .{ "prepare", this.package_name, this.cwd });
                    @field(lockfile.scripts, Lockfile.Scripts.names[i]).append(lockfile.allocator, script) catch bun.outOfMemory();
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
        lockfile: *Lockfile,
        lockfile_buf: string,
        resolution_tag: Resolution.Tag,
        add_node_gyp_rebuild_script: bool,
        // return: first_index, total, entries
    ) struct { i8, u8, [Lockfile.Scripts.names.len]?Lockfile.Scripts.Entry } {
        const allocator = lockfile.allocator;
        var script_index: u8 = 0;
        var first_script_index: i8 = -1;
        var scripts: [6]?Lockfile.Scripts.Entry = .{null} ** 6;
        var counter: u8 = 0;

        if (add_node_gyp_rebuild_script) {
            {
                script_index += 1;
                const entry: Lockfile.Scripts.Entry = .{
                    .script = allocator.dupe(u8, "node-gyp rebuild") catch unreachable,
                };
                if (first_script_index == -1) first_script_index = @intCast(script_index);
                scripts[script_index] = entry;
                script_index += 1;
                counter += 1;
            }

            // missing install and preinstall, only need to check postinstall
            if (!this.postinstall.isEmpty()) {
                const entry: Lockfile.Scripts.Entry = .{
                    .script = allocator.dupe(u8, this.preinstall.slice(lockfile_buf)) catch unreachable,
                };
                if (first_script_index == -1) first_script_index = @intCast(script_index);
                scripts[script_index] = entry;
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
                    const entry: Lockfile.Scripts.Entry = .{
                        .script = allocator.dupe(u8, script.slice(lockfile_buf)) catch unreachable,
                    };
                    if (first_script_index == -1) first_script_index = @intCast(script_index);
                    scripts[script_index] = entry;
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
                        const entry: Lockfile.Scripts.Entry = .{
                            .script = allocator.dupe(u8, script.slice(lockfile_buf)) catch unreachable,
                        };
                        if (first_script_index == -1) first_script_index = @intCast(script_index);
                        scripts[script_index] = entry;
                        counter += 1;
                    }
                    script_index += 1;
                }
            },
            .workspace => {
                script_index += 1;
                if (!this.prepare.isEmpty()) {
                    const entry: Lockfile.Scripts.Entry = .{
                        .script = allocator.dupe(u8, this.prepare.slice(lockfile_buf)) catch unreachable,
                    };
                    if (first_script_index == -1) first_script_index = @intCast(script_index);
                    scripts[script_index] = entry;
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
        lockfile: *Lockfile,
        lockfile_buf: []const u8,
        cwd_: string,
        package_name: string,
        resolution_tag: Resolution.Tag,
        add_node_gyp_rebuild_script: bool,
    ) ?Package.Scripts.List {
        const allocator = lockfile.allocator;
        const first_index, const total, const scripts = getScriptEntries(this, lockfile, lockfile_buf, resolution_tag, add_node_gyp_rebuild_script);
        if (first_index != -1) {
            var cwd_buf: if (Environment.isWindows) bun.PathBuffer else void = undefined;

            const cwd = if (comptime !Environment.isWindows)
                cwd_
            else brk: {
                @memcpy(cwd_buf[0..cwd_.len], cwd_);
                cwd_buf[cwd_.len] = 0;
                const cwd_handle = bun.openDirNoRenamingOrDeletingWindows(bun.invalid_fd, cwd_buf[0..cwd_.len :0]) catch break :brk cwd_;

                var buf: bun.WPathBuffer = undefined;
                const new_cwd = bun.windows.GetFinalPathNameByHandle(cwd_handle.fd, .{}, &buf) catch break :brk cwd_;

                break :brk strings.convertUTF16toUTF8InBuffer(&cwd_buf, new_cwd) catch break :brk cwd_;
            };

            return .{
                .items = scripts,
                .first_index = @intCast(first_index),
                .total = total,
                .cwd = allocator.dupeZ(u8, cwd) catch bun.outOfMemory(),
                .package_name = lockfile.allocator.dupe(u8, package_name) catch bun.outOfMemory(),
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
        lockfile: *Lockfile,
        node_modules: *PackageManager.PackageInstaller.LazyPackageDestinationDir,
        abs_node_modules_path: string,
        folder_name: string,
        resolution: *const Resolution,
    ) !?Package.Scripts.List {
        var path_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;
        if (this.hasAny()) {
            const add_node_gyp_rebuild_script = if (lockfile.hasTrustedDependency(folder_name) and
                this.install.isEmpty() and
                this.preinstall.isEmpty())
            brk: {
                const binding_dot_gyp_path = Path.joinAbsStringZ(
                    abs_node_modules_path,
                    &[_]string{ folder_name, "binding.gyp" },
                    .auto,
                );

                break :brk bun.sys.exists(binding_dot_gyp_path);
            } else false;

            const cwd = Path.joinAbsStringBufZTrailingSlash(
                abs_node_modules_path,
                &path_buf,
                &[_]string{folder_name},
                .auto,
            );

            return this.createList(
                lockfile,
                lockfile.buffers.string_bytes.items,
                cwd,
                folder_name,
                resolution.tag,
                add_node_gyp_rebuild_script,
            );
        } else if (!this.filled) {
            const abs_folder_path = Path.joinAbsStringBufZTrailingSlash(
                abs_node_modules_path,
                &path_buf,
                &[_]string{folder_name},
                .auto,
            );
            return this.createFromPackageJSON(
                log,
                lockfile,
                node_modules,
                abs_folder_path,
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
        node_modules: *PackageManager.PackageInstaller.LazyPackageDestinationDir,
        folder_name: string,
    ) !void {
        const json = brk: {
            const json_src = brk2: {
                const json_path = bun.path.joinZ([_]string{ folder_name, "package.json" }, .auto);
                const buf = try bun.sys.File.readFrom(try node_modules.getDir(), json_path, allocator).unwrap();
                break :brk2 logger.Source.initPathString(json_path, buf);
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
        lockfile: *Lockfile,
        node_modules: *PackageManager.PackageInstaller.LazyPackageDestinationDir,
        abs_folder_path: string,
        folder_name: string,
        resolution_tag: Resolution.Tag,
    ) !?Package.Scripts.List {
        var tmp: Lockfile = undefined;
        tmp.initEmpty(lockfile.allocator);
        defer tmp.deinit();
        var builder = tmp.stringBuilder();
        try this.fillFromPackageJSON(lockfile.allocator, &builder, log, node_modules, folder_name);

        const add_node_gyp_rebuild_script = if (this.install.isEmpty() and this.preinstall.isEmpty()) brk: {
            const binding_dot_gyp_path = Path.joinAbsStringZ(
                abs_folder_path,
                &[_]string{"binding.gyp"},
                .auto,
            );

            break :brk bun.sys.exists(binding_dot_gyp_path);
        } else false;

        return this.createList(
            lockfile,
            tmp.buffers.string_bytes.items,
            abs_folder_path,
            folder_name,
            resolution_tag,
            add_node_gyp_rebuild_script,
        );
    }
};

const Allocator = std.mem.Allocator;
const Environment = bun.Environment;
const Expr = bun.JSAst.Expr;
const JSAst = bun.JSAst;
const JSON = bun.JSON;
const Lockfile = install.Lockfile;
const Output = bun.Output;
const PackageManager = install.PackageManager;
const Path = bun.path;
const Resolution = bun.install.Resolution;
const Semver = bun.Semver;
const String = Semver.String;
const StringBuilder = Lockfile.StringBuilder;
const assert = bun.assert;
const bun = @import("bun");
const initializeStore = install.initializeStore;
const install = bun.install;
const logger = bun.logger;
const std = @import("std");
const string = []const u8;
const stringZ = [:0]const u8;
const strings = bun.strings;
const Package = Lockfile.Package;
const debug = Output.scoped(.Lockfile, true);
