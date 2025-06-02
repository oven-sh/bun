const Options = @This();

log_level: LogLevel = .default,
global: bool = false,

global_bin_dir: std.fs.Dir = bun.FD.invalid.stdDir(),
explicit_global_directory: string = "",
/// destination directory to link bins into
// must be a variable due to global installs and bunx
bin_path: stringZ = bun.pathLiteral("node_modules/.bin"),

did_override_default_scope: bool = false,
scope: Npm.Registry.Scope = undefined,

registries: Npm.Registry.Map = .{},
cache_directory: string = "",
enable: Enable = .{},
do: Do = .{},
positionals: []const string = &[_]string{},
update: Update = .{},
dry_run: bool = false,
remote_package_features: Features = .{
    .optional_dependencies = true,
},
local_package_features: Features = .{
    .optional_dependencies = true,
    .dev_dependencies = true,
    .workspaces = true,
},
patch_features: union(enum) {
    nothing: struct {},
    patch: struct {},
    commit: struct {
        patches_dir: string,
    },
} = .{ .nothing = .{} },

filter_patterns: []const string = &.{},
pack_destination: string = "",
pack_filename: string = "",
pack_gzip_level: ?string = null,
json_output: bool = false,

max_retry_count: u16 = 5,
min_simultaneous_requests: usize = 4,

max_concurrent_lifecycle_scripts: usize,

publish_config: PublishConfig = .{},

ca: []const string = &.{},
ca_file_name: string = &.{},

// if set to `false` in bunfig, save a binary lockfile
save_text_lockfile: ?bool = null,

lockfile_only: bool = false,

pub const PublishConfig = struct {
    access: ?Access = null,
    tag: string = "",
    otp: string = "",
    auth_type: ?AuthType = null,
};

pub const Access = enum {
    public,
    restricted,

    const map = bun.ComptimeEnumMap(Access);

    pub fn fromStr(str: string) ?Access {
        return map.get(str);
    }
};

pub const AuthType = enum {
    legacy,
    web,

    const map = bun.ComptimeEnumMap(AuthType);

    pub fn fromStr(str: string) ?AuthType {
        return map.get(str);
    }
};

pub fn shouldPrintCommandName(this: *const Options) bool {
    return this.log_level != .silent and this.do.summary;
}

pub const LogLevel = enum {
    default,
    verbose,
    silent,
    default_no_progress,
    verbose_no_progress,

    pub inline fn isVerbose(this: LogLevel) bool {
        return switch (this) {
            .verbose_no_progress, .verbose => true,
            else => false,
        };
    }
    pub inline fn showProgress(this: LogLevel) bool {
        return switch (this) {
            .default, .verbose => true,
            else => false,
        };
    }
};

pub const Update = struct {
    development: bool = false,
    optional: bool = false,
    peer: bool = false,
};

pub fn openGlobalDir(explicit_global_dir: string) !std.fs.Dir {
    if (bun.getenvZ("BUN_INSTALL_GLOBAL_DIR")) |home_dir| {
        return try std.fs.cwd().makeOpenPath(home_dir, .{});
    }

    if (explicit_global_dir.len > 0) {
        return try std.fs.cwd().makeOpenPath(explicit_global_dir, .{});
    }

    if (bun.getenvZ("BUN_INSTALL")) |home_dir| {
        var buf: bun.PathBuffer = undefined;
        var parts = [_]string{ "install", "global" };
        const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
        return try std.fs.cwd().makeOpenPath(path, .{});
    }

    if (!Environment.isWindows) {
        if (bun.getenvZ("XDG_CACHE_HOME") orelse bun.getenvZ("HOME")) |home_dir| {
            var buf: bun.PathBuffer = undefined;
            var parts = [_]string{ ".bun", "install", "global" };
            const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
            return try std.fs.cwd().makeOpenPath(path, .{});
        }
    } else {
        if (bun.getenvZ("USERPROFILE")) |home_dir| {
            var buf: bun.PathBuffer = undefined;
            var parts = [_]string{ ".bun", "install", "global" };
            const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
            return try std.fs.cwd().makeOpenPath(path, .{});
        }
    }

    return error.@"No global directory found";
}

pub fn openGlobalBinDir(opts_: ?*const Api.BunInstall) !std.fs.Dir {
    if (bun.getenvZ("BUN_INSTALL_BIN")) |home_dir| {
        return try std.fs.cwd().makeOpenPath(home_dir, .{});
    }

    if (opts_) |opts| {
        if (opts.global_bin_dir) |home_dir| {
            if (home_dir.len > 0) {
                return try std.fs.cwd().makeOpenPath(home_dir, .{});
            }
        }
    }

    if (bun.getenvZ("BUN_INSTALL")) |home_dir| {
        var buf: bun.PathBuffer = undefined;
        var parts = [_]string{
            "bin",
        };
        const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
        return try std.fs.cwd().makeOpenPath(path, .{});
    }

    if (bun.getenvZ("XDG_CACHE_HOME") orelse bun.getenvZ(bun.DotEnv.home_env)) |home_dir| {
        var buf: bun.PathBuffer = undefined;
        var parts = [_]string{
            ".bun",
            "bin",
        };
        const path = Path.joinAbsStringBuf(home_dir, &buf, &parts, .auto);
        return try std.fs.cwd().makeOpenPath(path, .{});
    }

    return error.@"Missing global bin directory: try setting $BUN_INSTALL";
}

pub fn load(
    this: *Options,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    env: *DotEnv.Loader,
    maybe_cli: ?CommandLineArguments,
    bun_install_: ?*Api.BunInstall,
    subcommand: Subcommand,
) bun.OOM!void {
    var base = Api.NpmRegistry{
        .url = "",
        .username = "",
        .password = "",
        .token = "",
    };
    if (bun_install_) |config| {
        if (config.default_registry) |registry| {
            base = registry;
        }
    }

    if (base.url.len == 0) base.url = Npm.Registry.default_url;
    this.scope = try Npm.Registry.Scope.fromAPI("", base, allocator, env);
    defer {
        this.did_override_default_scope = this.scope.url_hash != Npm.Registry.default_url_hash;
    }
    if (bun_install_) |config| {
        if (config.cache_directory) |cache_directory| {
            this.cache_directory = cache_directory;
        }

        if (config.scoped) |scoped| {
            for (scoped.scopes.keys(), scoped.scopes.values()) |name, *registry_| {
                var registry = registry_.*;
                if (registry.url.len == 0) registry.url = base.url;
                try this.registries.put(allocator, Npm.Registry.Scope.hash(name), try Npm.Registry.Scope.fromAPI(name, registry, allocator, env));
            }
        }

        if (config.ca) |ca| {
            switch (ca) {
                .list => |ca_list| {
                    this.ca = ca_list;
                },
                .str => |ca_str| {
                    this.ca = &.{ca_str};
                },
            }
        }

        if (config.cafile) |cafile| {
            this.ca_file_name = cafile;
        }

        if (config.disable_cache orelse false) {
            this.enable.cache = false;
        }

        if (config.disable_manifest_cache orelse false) {
            this.enable.manifest_cache = false;
        }

        if (config.force orelse false) {
            this.enable.manifest_cache_control = false;
            this.enable.force_install = true;
        }

        if (config.save_yarn_lockfile orelse false) {
            this.do.save_yarn_lock = true;
        }

        if (config.save_lockfile) |save_lockfile| {
            this.do.save_lockfile = save_lockfile;
            this.enable.force_save_lockfile = true;
        }

        if (config.save_dev) |save| {
            this.local_package_features.dev_dependencies = save;
            // remote packages should never install dev dependencies
            // (TODO: unless git dependency with postinstalls)
        }

        if (config.save_optional) |save| {
            this.remote_package_features.optional_dependencies = save;
            this.local_package_features.optional_dependencies = save;
        }

        if (config.save_peer) |save| {
            this.remote_package_features.peer_dependencies = save;
            this.local_package_features.peer_dependencies = save;
        }

        if (config.exact) |exact| {
            this.enable.exact_versions = exact;
        }

        if (config.production) |production| {
            if (production) {
                this.local_package_features.dev_dependencies = false;
                this.enable.fail_early = true;
                this.enable.frozen_lockfile = true;
                this.enable.force_save_lockfile = false;
            }
        }

        if (config.frozen_lockfile) |frozen_lockfile| {
            if (frozen_lockfile) {
                this.enable.frozen_lockfile = true;
            }
        }

        if (config.save_text_lockfile) |save_text_lockfile| {
            this.save_text_lockfile = save_text_lockfile;
        }

        if (config.concurrent_scripts) |jobs| {
            this.max_concurrent_lifecycle_scripts = jobs;
        }

        if (config.cache_directory) |cache_dir| {
            this.cache_directory = cache_dir;
        }

        if (config.ignore_scripts) |ignore_scripts| {
            if (ignore_scripts) {
                this.do.run_scripts = false;
            }
        }

        this.explicit_global_directory = config.global_dir orelse this.explicit_global_directory;
    }

    const default_disable_progress_bar: bool = brk: {
        if (env.get("BUN_INSTALL_PROGRESS")) |prog| {
            break :brk strings.eqlComptime(prog, "0");
        }

        if (env.isCI()) {
            break :brk true;
        }

        break :brk Output.stderr_descriptor_type != .terminal;
    };

    // technically, npm_config is case in-sensitive
    // load_registry:
    {
        const registry_keys = [_]string{
            "BUN_CONFIG_REGISTRY",
            "NPM_CONFIG_REGISTRY",
            "npm_config_registry",
        };
        var did_set = false;

        inline for (registry_keys) |registry_key| {
            if (!did_set) {
                if (env.get(registry_key)) |registry_| {
                    if (registry_.len > 0 and
                        (strings.startsWith(registry_, "https://") or
                            strings.startsWith(registry_, "http://")))
                    {
                        const prev_scope = this.scope;
                        var api_registry = std.mem.zeroes(Api.NpmRegistry);
                        api_registry.url = registry_;
                        api_registry.token = prev_scope.token;
                        this.scope = try Npm.Registry.Scope.fromAPI("", api_registry, allocator, env);
                        did_set = true;
                    }
                }
            }
        }
    }

    {
        const token_keys = [_]string{
            "BUN_CONFIG_TOKEN",
            "NPM_CONFIG_TOKEN",
            "npm_config_token",
        };
        var did_set = false;

        inline for (token_keys) |registry_key| {
            if (!did_set) {
                if (env.get(registry_key)) |registry_| {
                    if (registry_.len > 0) {
                        this.scope.token = registry_;
                        did_set = true;
                        // stage1 bug: break inside inline is broken
                        // break :load_registry;
                    }
                }
            }
        }
    }

    if (env.get("BUN_CONFIG_YARN_LOCKFILE") != null) {
        this.do.save_yarn_lock = true;
    }

    if (env.get("BUN_CONFIG_HTTP_RETRY_COUNT")) |retry_count| {
        if (std.fmt.parseInt(u16, retry_count, 10)) |int| this.max_retry_count = int else |_| {}
    }

    AsyncHTTP.loadEnv(allocator, log, env);

    if (env.get("BUN_CONFIG_SKIP_SAVE_LOCKFILE")) |check_bool| {
        this.do.save_lockfile = strings.eqlComptime(check_bool, "0");
    }

    if (env.get("BUN_CONFIG_SKIP_LOAD_LOCKFILE")) |check_bool| {
        this.do.load_lockfile = strings.eqlComptime(check_bool, "0");
    }

    if (env.get("BUN_CONFIG_SKIP_INSTALL_PACKAGES")) |check_bool| {
        this.do.install_packages = strings.eqlComptime(check_bool, "0");
    }

    if (env.get("BUN_CONFIG_NO_VERIFY")) |check_bool| {
        this.do.verify_integrity = !strings.eqlComptime(check_bool, "0");
    }

    // Update should never read from manifest cache
    if (subcommand == .update) {
        this.enable.manifest_cache = false;
        this.enable.manifest_cache_control = false;
    }

    if (maybe_cli) |cli| {
        this.do.analyze = cli.analyze;
        this.enable.only_missing = cli.only_missing or cli.analyze;

        if (cli.registry.len > 0) {
            this.scope.url = URL.parse(cli.registry);
        }

        if (cli.cache_dir) |cache_dir| {
            this.cache_directory = cache_dir;
        }

        if (cli.exact) {
            this.enable.exact_versions = true;
        }

        if (cli.token.len > 0) {
            this.scope.token = cli.token;
        }

        if (cli.no_save) {
            this.do.save_lockfile = false;
            this.do.write_package_json = false;
        }

        if (cli.dry_run) {
            this.do.install_packages = false;
            this.dry_run = true;
            this.do.write_package_json = false;
            this.do.save_lockfile = false;
        }

        if (cli.no_summary or cli.silent) {
            this.do.summary = false;
        }

        this.filter_patterns = cli.filters;
        this.pack_destination = cli.pack_destination;
        this.pack_filename = cli.pack_filename;
        this.pack_gzip_level = cli.pack_gzip_level;
        this.json_output = cli.json_output;

        if (cli.no_cache) {
            this.enable.manifest_cache = false;
            this.enable.manifest_cache_control = false;
        }

        if (cli.omit) |omit| {
            if (omit.dev) {
                this.local_package_features.dev_dependencies = false;
                // remote packages should never install dev dependencies
                // (TODO: unless git dependency with postinstalls)
            }

            if (omit.optional) {
                this.local_package_features.optional_dependencies = false;
                this.remote_package_features.optional_dependencies = false;
            }

            if (omit.peer) {
                this.local_package_features.peer_dependencies = false;
                this.remote_package_features.peer_dependencies = false;
            }
        }

        if (cli.ignore_scripts) {
            this.do.run_scripts = false;
        }

        if (cli.trusted) {
            this.do.trust_dependencies_from_args = true;
        }

        if (cli.save_text_lockfile) |save_text_lockfile| {
            this.save_text_lockfile = save_text_lockfile;
        }

        this.lockfile_only = cli.lockfile_only;

        const disable_progress_bar = default_disable_progress_bar or cli.no_progress;

        if (cli.verbose) {
            this.log_level = if (disable_progress_bar) LogLevel.verbose_no_progress else LogLevel.verbose;
            PackageManager.verbose_install = true;
        } else if (cli.silent) {
            this.log_level = .silent;
            PackageManager.verbose_install = false;
        } else {
            this.log_level = if (disable_progress_bar) LogLevel.default_no_progress else LogLevel.default;
            PackageManager.verbose_install = false;
        }

        if (cli.no_verify) {
            this.do.verify_integrity = false;
        }

        if (cli.yarn) {
            this.do.save_yarn_lock = true;
        }

        if (cli.backend) |backend| {
            PackageInstall.supported_method = backend;
        }

        this.do.update_to_latest = cli.latest;

        if (cli.positionals.len > 0) {
            this.positionals = cli.positionals;
        }

        if (cli.production) {
            this.local_package_features.dev_dependencies = false;
            this.enable.fail_early = true;
            this.enable.frozen_lockfile = true;
        }

        if (cli.frozen_lockfile) {
            this.enable.frozen_lockfile = true;
        }

        if (cli.force) {
            this.enable.manifest_cache_control = false;
            this.enable.force_install = true;
            this.enable.force_save_lockfile = true;
        }

        if (cli.development) {
            this.update.development = cli.development;
        } else if (cli.optional) {
            this.update.optional = cli.optional;
        } else if (cli.peer) {
            this.update.peer = cli.peer;
        }

        switch (cli.patch) {
            .nothing => {},
            .patch => {
                this.patch_features = .{ .patch = .{} };
            },
            .commit => {
                this.patch_features = .{
                    .commit = .{
                        .patches_dir = cli.patch.commit.patches_dir,
                    },
                };
            },
        }

        if (cli.publish_config.access) |cli_access| {
            this.publish_config.access = cli_access;
        }
        if (cli.publish_config.tag.len > 0) {
            this.publish_config.tag = cli.publish_config.tag;
        }
        if (cli.publish_config.otp.len > 0) {
            this.publish_config.otp = cli.publish_config.otp;
        }
        if (cli.publish_config.auth_type) |auth_type| {
            this.publish_config.auth_type = auth_type;
        }

        if (cli.ca.len > 0) {
            this.ca = cli.ca;
        }
        if (cli.ca_file_name.len > 0) {
            this.ca_file_name = cli.ca_file_name;
        }
    } else {
        this.log_level = if (default_disable_progress_bar) LogLevel.default_no_progress else LogLevel.default;
        PackageManager.verbose_install = false;
    }

    // If the lockfile is frozen, don't save it to disk.
    if (this.enable.frozen_lockfile) {
        this.do.save_lockfile = false;
        this.enable.force_save_lockfile = false;
    }
}

pub const Do = packed struct(u16) {
    save_lockfile: bool = true,
    load_lockfile: bool = true,
    install_packages: bool = true,
    write_package_json: bool = true,
    run_scripts: bool = true,
    save_yarn_lock: bool = false,
    print_meta_hash_string: bool = false,
    verify_integrity: bool = true,
    summary: bool = true,
    trust_dependencies_from_args: bool = false,
    update_to_latest: bool = false,
    analyze: bool = false,
    _: u4 = 0,
};

pub const Enable = packed struct(u16) {
    manifest_cache: bool = true,
    manifest_cache_control: bool = true,
    cache: bool = true,
    fail_early: bool = false,
    frozen_lockfile: bool = false,

    // Don't save the lockfile unless there were actual changes
    // unless...
    force_save_lockfile: bool = false,

    force_install: bool = false,

    exact_versions: bool = false,
    only_missing: bool = false,
    _: u7 = 0,
};

const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const stringZ = bun.stringZ;
const std = @import("std");
const logger = bun.logger;
const OOM = bun.OOM;
const FD = bun.FD;

const Api = bun.Schema.Api;
const Path = bun.path;

const DotEnv = bun.DotEnv;
const URL = bun.URL;
const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;

const Npm = bun.install.Npm;

const patch = bun.install.patch;
const Features = bun.install.Features;
const CommandLineArguments = @import("./CommandLineArguments.zig");
const Subcommand = bun.install.PackageManager.Subcommand;
const PackageManager = bun.install.PackageManager;
const PackageInstall = bun.install.PackageInstall;
