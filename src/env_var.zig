//! Unified module for controlling and managing environment variables in Bun.
//!
//! This library uses metaprogramming to achieve type-safe accessors for environment variables.
//! Calling .get() on any of the environment variables will return the correct environment variable
//! type, whether it's a string, unsigned or boolean. This library also caches the environment
//! variables for you, for slightly faster access.
//!
//! If default values are provided, the .get() method is guaranteed not to return a nullable type,
//! whereas if no default is provided, the .get() method will return an optional type.
//!
//! TODO(markovejnovic): It would be neat if this library supported loading floats as
//!                      well as strings, integers and booleans, but for now this will do.
//!
//! TODO(markovejnovic): As this library migrates away from bun.getenvZ, it should return
//!                      NUL-terminated slices, rather than plain slices. Perhaps there should be a
//!                      .getZ() accessor?
//!
//! TODO(markovejnovic): This current implementation kind of does redundant work. Instead of
//!                      scanning envp, and preparing everything on bootup, we lazily load
//!                      everything. This means that we potentially scan through envp a lot of
//!                      times, even though we could only do it once.

// Keep this list alphabetically sorted.
pub const agent = new(.string, "AGENT", .{});
pub const bamboo_build_key = new(.string, "bamboo.buildKey", .{});
pub const bun_agent_rule_disabled = new(.boolean, "BUN_AGENT_RULE_DISABLED", .{ .default = false });
pub const bun_compile_target_tarball_url = new(.string, "BUN_COMPILE_TARGET_TARBALL_URL", .{});
pub const bun_config_disable_copy_file_range = new(.boolean, "BUN_CONFIG_DISABLE_COPY_FILE_RANGE", .{ .default = false });
pub const bun_config_disable_ioctl_ficlonerange = new(.boolean, "BUN_CONFIG_DISABLE_ioctl_ficlonerange", .{ .default = false });
/// TODO(markovejnovic): Legacy usage had the default at 30, even though a the attached comment
/// quoted: Amazon Web Services recommends 5 seconds:
/// https://docs.aws.amazon.com/sdk-for-java/v1/developer-guide/jvm-ttl-dns.html
///
/// It's unclear why this was done.
pub const bun_config_dns_time_to_live_seconds = new(.unsigned, "BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS", .{ .default = 30 });
pub const bun_crash_report_url = new(.string, "BUN_CRASH_REPORT_URL", .{});
pub const bun_debug = new(.string, "BUN_DEBUG", .{});
pub const bun_debug_css_order = new(.boolean, "BUN_DEBUG_CSS_ORDER", .{ .default = false });
pub const bun_debug_enable_restore_from_transpiler_cache = new(.boolean, "BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE", .{ .default = false });
pub const bun_debug_hash_random_seed = new(.string, "BUN_DEBUG_HASH_RANDOM_SEED", .{});
pub const bun_debug_test_text_lockfile = new(.boolean, "BUN_DEBUG_TEST_TEXT_LOCKFILE", .{ .default = false });
pub const bun_dev_server_test_runner = new(.string, "BUN_DEV_SERVER_TEST_RUNNER", .{});
pub const bun_enable_crash_reporting = new(.boolean, "BUN_ENABLE_CRASH_REPORTING", .{});
/// TODO(markovejnovic): It's unclear why the default here is 100_000, but this was legacy behavior
/// so we'll keep it for now.
pub const bun_inotify_coalesce_interval = new(.unsigned, "BUN_INOTIFY_COALESCE_INTERVAL", .{ .default = 100_000 });
pub const bun_inspect = new(.string, "BUN_INSPECT", .{ .default = "" });
pub const bun_inspect_connect_to = new(.string, "BUN_INSPECT_CONNECT_TO", .{ .default = "" });
pub const bun_inspect_preload = new(.string, "BUN_INSPECT_PRELOAD", .{});
pub const bun_install = new(.string, "BUN_INSTALL", .{});
pub const bun_install_bin = new(.string, "BUN_INSTALL_BIN", .{});
pub const bun_install_global_dir = new(.string, "BUN_INSTALL_GLOBAL_DIR", .{});
pub const bun_needs_proc_self_workaround = new(.boolean, "BUN_NEEDS_PROC_SELF_WORKAROUND", .{ .default = false });
pub const bun_options = new(.string, "BUN_OPTIONS", .{});
pub const bun_runtime_transpiler_cache_path = new(.string, "BUN_RUNTIME_TRANSPILER_CACHE_PATH", .{});
pub const bun_ssg_disable_static_route_visitor = new(.boolean, "BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR", .{ .default = false });
pub const bun_tcc_options = new(.string, "BUN_TCC_OPTIONS", .{});
pub const bun_tmpdir = new(.string, "BUN_TMPDIR", .{});
pub const bun_track_last_fn_name = new(.boolean, "BUN_TRACK_LAST_FN_NAME", .{ .default = false });
pub const bun_tracy_path = new(.string, "BUN_TRACY_PATH", .{});
pub const bun_watcher_trace = new(.string, "BUN_WATCHER_TRACE", .{});
pub const ci = new(.string, "CI", .{});
pub const ci_commit_sha = new(.string, "CI_COMMIT_SHA", .{});
pub const ci_job_url = new(.string, "CI_JOB_URL", .{});
pub const claude_code_agent_rule_disabled = new(.boolean, "CLAUDE_CODE_AGENT_RULE_DISABLED", .{ .default = false });
pub const claudecode = new(.boolean, "CLAUDECODE", .{ .default = false });
pub const colorterm = new(.string, "COLORTERM", .{});
pub const cursor_agent_rule_disabled = new(.boolean, "CURSOR_AGENT_RULE_DISABLED", .{ .default = false });
pub const do_not_track = new(.boolean, "DO_NOT_TRACK", .{ .default = false });
pub const dyld_root_path = platformSpecificNew(.string, "DYLD_ROOT_PATH", null, .{});
/// TODO(markovejnovic): We should support enums in this library, and force_color's usage is,
/// indeed, an enum. The 80-20 is to make it an unsigned value (which also works well).
pub const force_color = new(.unsigned, "FORCE_COLOR", .{
    .deser = .{
        // It is kind of weird to me to treat FORCE_COLOR="" as truthy, but this was legacy
        // behavior so we'll keep it for now.
        .error_handling = .truthy_cast,
        .empty_string_as = .{ .value = 1 },
    },
});
pub const fpath = platformSpecificNew(.string, "fpath", null, .{});
pub const git_sha = new(.string, "GIT_SHA", .{});
pub const github_actions = new(.boolean, "GITHUB_ACTIONS", .{ .default = false });
pub const github_repository = new(.string, "GITHUB_REPOSITORY", .{});
pub const github_run_id = new(.string, "GITHUB_RUN_ID", .{});
pub const github_server_url = new(.string, "GITHUB_SERVER_URL", .{});
pub const github_sha = new(.string, "GITHUB_SHA", .{});
pub const github_workspace = new(.string, "GITHUB_WORKSPACE", .{});
pub const home = platformSpecificNew(.string, "HOME", "USERPROFILE", .{});
pub const hyperfine_randomized_environment_offset = new(.string, "HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET", .{});
pub const is_bun_auto_update = new(.boolean, "IS_BUN_AUTO_UPDATE", .{ .default = false });
pub const jenkins_url = new(.string, "JENKINS_URL", .{});
/// Dump mimalloc statistics at the end of the process. Note that this is not the same as
/// `MIMALLOC_VERBOSE`, documented here: https://microsoft.github.io/mimalloc/environment.html
pub const mi_verbose = new(.boolean, "MI_VERBOSE", .{ .default = false });
pub const no_color = new(.boolean, "NO_COLOR", .{ .default = false });
pub const node = new(.string, "node", .{});
pub const node_channel_fd = new(.string, "NODE_CHANNEL_FD", .{});
pub const node_preserve_symlinks_main = new(.boolean, "NODE_PRESERVE_SYMLINKS_MAIN", .{ .default = false });
pub const node_use_system_ca = new(.boolean, "NODE_USE_SYSTEM_CA", .{ .default = false });
pub const npm_lifecycle_event = new(.string, "npm_lifecycle_event", .{});
pub const path = new(.string, "PATH", .{});
pub const repl_id = new(.boolean, "REPL_ID", .{ .default = false });
pub const runner_debug = new(.boolean, "RUNNER_DEBUG", .{ .default = false });
pub const sdkroot = platformSpecificNew(.string, "SDKROOT", null, .{});
pub const shell = platformSpecificNew(.string, "SHELL", null, .{});
/// C:\Windows, for example.
/// Note: Do not use this variable directly -- use os.zig's implementation instead.
pub const system_root = platformSpecificNew(.string, null, "SYSTEMROOT", .{});
pub const temp = platformSpecificNew(.string, null, "TEMP", .{});
pub const term = new(.string, "TERM", .{});
pub const term_program = new(.string, "TERM_PROGRAM", .{});
pub const tmp = platformSpecificNew(.string, null, "TMP", .{});
pub const tmpdir = platformSpecificNew(.string, "TMPDIR", null, .{});
pub const tmux = new(.string, "TMUX", .{});
pub const todium = new(.string, "TODIUM", .{});
pub const user = platformSpecificNew(.string, "USER", "USERNAME", .{});
pub const wants_loud = new(.boolean, "WANTS_LOUD", .{ .default = false });
/// The same as system_root.
/// Note: Do not use this variable directly -- use os.zig's implementation instead.
/// TODO(markovejnovic): Perhaps we could add support for aliases in the library, so you could
///                      specify both WINDIR and SYSTEMROOT and the loader would check both?
pub const windir = platformSpecificNew(.string, null, "WINDIR", .{});
pub const xdg_cache_home = platformSpecificNew(.string, "XDG_CACHE_HOME", null, .{});
pub const xdg_config_home = platformSpecificNew(.string, "XDG_CONFIG_HOME", null, .{});
pub const xdg_data_home = platformSpecificNew(.string, "XDG_DATA_HOME", null, .{});
pub const zdotdir = platformSpecificNew(.string, "ZDOTDIR", null, .{});

// Feature flags, keep sorted alphabetically.
pub const feature_flag = struct {
    pub const assume_perfect_incremental = newFeatureFlag("BUN_ASSUME_PERFECT_INCREMENTAL");
    pub const be_bun = newFeatureFlag("BUN_BE_BUN");
    pub const debug_no_dump = newFeatureFlag("BUN_DEBUG_NO_DUMP");
    pub const destruct_vm_on_exit = newFeatureFlag("BUN_DESTRUCT_VM_ON_EXIT");
    pub const disable_addrconfig = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG");
    pub const disable_async_transpiler = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER");
    pub const disable_dns_cache = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_DNS_CACHE");
    pub const disable_dns_cache_libinfo = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO");
    pub const disable_install_index = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_INSTALL_INDEX");
    pub const disable_io_pool = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_IO_POOL");
    pub const disable_ipv4 = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_IPV4");
    pub const disable_ipv6 = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_IPV6");
    /// The RedisClient supports auto-pipelining by default. This flag disables that behavior.
    pub const disable_redis_auto_pipelining = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING");
    pub const disable_rwf_nonblock = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK");
    pub const disable_slow_lifecycle_script_logging = newFeatureFlag("BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING");
    pub const disable_source_code_preview = newFeatureFlag("BUN_DISABLE_SOURCE_CODE_PREVIEW");
    pub const disable_source_maps = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS");
    pub const disable_spawnsync_fast_path = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH");
    pub const disable_sql_auto_pipelining = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING");
    pub const disable_transpiled_source_code_preview = newFeatureFlag("BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW");
    pub const disable_uv_fs_copyfile = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE");
    pub const dump_state_on_crash = newFeatureFlag("BUN_DUMP_STATE_ON_CRASH");
    pub const enable_experimental_shell_builtins = newFeatureFlag("BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS");
    pub const experimental_bake = newFeatureFlag("BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE");
    pub const force_io_pool = newFeatureFlag("BUN_FEATURE_FLAG_FORCE_IO_POOL");
    pub const force_windows_junctions = newFeatureFlag("BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS");
    pub const instruments = newFeatureFlag("BUN_INSTRUMENTS");
    pub const internal_bunx_install = newFeatureFlag("BUN_INTERNAL_BUNX_INSTALL");
    pub const internal_suppress_crash_in_bun_run = newFeatureFlag("BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN");
    pub const internal_suppress_crash_on_napi_abort = newFeatureFlag("BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT");
    pub const internal_suppress_crash_on_process_kill_self = newFeatureFlag("BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF");
    pub const internal_suppress_crash_on_uv_stub = newFeatureFlag("BUN_INTERNAL_SUPPRESS_CRASH_ON_UV_STUB");
    pub const last_modified_pretend_304 = newFeatureFlag("BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304");
    pub const no_codesign_macho_binary = newFeatureFlag("BUN_NO_CODESIGN_MACHO_BINARY");
    pub const no_libdeflate = newFeatureFlag("BUN_FEATURE_FLAG_NO_LIBDEFLATE");
    pub const node_no_warnings = newFeatureFlag("NODE_NO_WARNINGS");
    pub const trace = newFeatureFlag("BUN_TRACE");
};

/// Interface between each of the different EnvVar types and the common logic.
pub fn CacheOutput(comptime NonOptionalReturnType: type) type {
    return union(enum) {
        /// The environment variable hasn't been loaded yet.
        unknown: void,
        /// The environment variable has been loaded but its not set.
        not_set: void,
        /// The environment variable is set to a value.
        value: NonOptionalReturnType,
    };
}

pub fn CacheInput(comptime DefaultArgsType: type) type {
    return struct {
        var_name: []const u8,
        opts: DefaultArgsType,
    };
}

/// Structure which encodes the different types of environment variables supported.
///
/// This requires the following static members:
///
///   - `NonOptionalReturnType`: The underlying environment variable type if one is set. For
///                              example, a string `$PATH` ought return a `[]const u8` when set.
///   - `Cache`: A struct implementing the following methods:
///       - `getCached() CacheOutput(NonOptionalReturnType)`: Retrieve the cached value of the
///                                                               environment variable, if any.
///       - `reload(raw_env: ?[]const u8) ?NonOptionalReturnType`: Try to reload the environment
///                                                                variable from the given raw
///                                                                environment variable value.
///   - `ConsOpts`: A struct containing the options passed to the constructor of the environment
///                 variable definition.
///
/// This type will communicate with the common logic via the `CacheOutput` type.
const EnvVarType = union(enum) {
    string: struct {
        const NonOptionalReturnType = []const u8;
        const Input = CacheInput(ConsOpts);
        const Output = CacheOutput(NonOptionalReturnType);
        const ConsOpts = struct {
            default: ?NonOptionalReturnType = null,
        };

        fn Cache(comptime ip: Input) type {
            _ = ip;
            // This cache tries to be really clever. In order to have atomics, we need to fit them
            // in a single word. Consequently, we need to fit the pointer and the length in a
            // single 64-bit type. Some platforms are moving to layer 5 addressing so we're only
            // left with 8 bits -- that won't do, obviously. Consequently, we need to store offsets
            // rather than raw pointers. These offsets are relative to std.c.environ.
            const CachedType = packed struct(u64) {
                const Self = @This();

                ptr: bun.ptr.TaggedPointer,

                pub inline fn init(ptr: anytype, data: u15) Self {
                    return .{
                        .ptr = bun.ptr.TaggedPointer.init(ptr, data),
                    };
                }

                pub inline fn get(self: Self, comptime T: type) *T {
                    return self.ptr.get(T);
                }

                pub fn eql(self: @This(), other: @This()) bool {
                    const self_ptr = self.ptr.get(*const u8);
                    const self_len: usize = @intCast(self.ptr.data);
                    const other_ptr = other.ptr.get(*const u8);
                    const other_len: usize = @intCast(other.ptr.data);
                    return self_ptr == other_ptr and self_len == other_len;
                }
            };

            return struct {
                const unknown_sentinel: CachedType = .init(
                    @as(*const u8, @ptrFromInt(std.math.maxInt(u64))),
                    std.math.maxInt(u15),
                );
                const not_set_sentinel: CachedType = .init(
                    @as(*const u8, @ptrFromInt(std.math.maxInt(u64) - 1)),
                    std.math.maxInt(u15),
                );

                var value = std.atomic.Value(CachedType).init(unknown_sentinel);

                inline fn getCached() Output {
                    const val = value.load(.monotonic);
                    if (val.eql(unknown_sentinel)) {
                        return .{ .unknown = {} };
                    }

                    if (val.eql(not_set_sentinel)) {
                        return .{ .not_set = {} };
                    }

                    const ptr: [*]const u8 = @ptrCast(val.get(*const u8));
                    const len: usize = @intCast(val.ptr.data);
                    return .{ .value = ptr[0..len] };
                }

                pub inline fn reload(raw_env: ?[]const u8) ?NonOptionalReturnType {
                    if (raw_env) |ev| {
                        value.store(.init(ev.ptr, @intCast(ev.len)), .monotonic);
                    } else {
                        value.store(not_set_sentinel, .monotonic);
                    }

                    return raw_env;
                }
            };
        }
    },
    boolean: struct {
        const NonOptionalReturnType = bool;
        const Input = CacheInput(ConsOpts);
        const Output = CacheOutput(NonOptionalReturnType);
        const ConsOpts = struct {
            default: ?NonOptionalReturnType = null,
        };

        pub fn stringIsTruthy(s: []const u8) bool {
            // Most values are considered truthy, except for "", "0", "false", "no", and "off".
            const false_values = .{ "", "0", "false", "no", "off" };

            inline for (false_values) |tv| {
                if (std.ascii.eqlIgnoreCase(s, tv)) {
                    return false;
                }
            }

            return true;
        }

        // This is a template which ignores its parameter, but is necessary so that a separate
        // Cache type is emitted for every environment variable.
        fn Cache(comptime ip: Input) type {
            return struct {
                const ValueType = enum(u8) { unknown, not_set, no, yes };

                var value = std.atomic.Value(ValueType).init(.unknown);

                pub inline fn getCached() Output {
                    _ = ip;

                    const cached = value.load(.monotonic);
                    switch (cached) {
                        .unknown => {
                            @branchHint(.unlikely);
                            return .{ .unknown = {} };
                        },
                        .not_set => {
                            return .{ .not_set = {} };
                        },
                        .no => {
                            return .{ .value = false };
                        },
                        .yes => {
                            return .{ .value = true };
                        },
                    }
                }

                pub inline fn reload(raw_env: ?[]const u8) ?NonOptionalReturnType {
                    if (raw_env == null) {
                        value.store(.not_set, .monotonic);
                        return null;
                    }

                    const string_is_truthy = stringIsTruthy(raw_env.?);
                    value.store(if (string_is_truthy) .yes else .no, .monotonic);
                    return string_is_truthy;
                }
            };
        }
    },
    unsigned: struct {
        const NonOptionalReturnType = u64;
        const Input = CacheInput(ConsOpts);
        const Output = CacheOutput(NonOptionalReturnType);
        const ConsOpts = struct {
            default: ?NonOptionalReturnType = null,
            deser: struct {
                /// Control how deserializing and formatting errors are handled.
                error_handling: enum {
                    /// panic on formatting errors.
                    panic,
                    /// Ignore formatting errors and treat the variable as not set.
                    not_set,
                    /// Fallback to default.
                    default_fallback,
                    /// Formatting errors are treated as truthy values.
                    ///
                    /// If this library fails to parse the value as an integer and truthy cast is
                    /// enabled, truthy values will be set to 1 or 0.
                    ///
                    /// Note: Most values are considered truthy, except for "", "0", "false", "no",
                    /// and "off".
                    truthy_cast,
                } = .panic,

                /// Control what empty strings are treated as.
                empty_string_as: union(enum) {
                    /// Empty strings are handled as the given value.
                    value: NonOptionalReturnType,
                    /// Empty strings are treated as formatting errors.
                    erroneous: void,
                } = .erroneous,
            } = .{},
        };

        fn Cache(comptime ip: Input) type {
            return struct {
                const ValueType = NonOptionalReturnType;

                /// The value meaning an environment variable that hasn't been loaded yet.
                const unknown_sentinel: comptime_int = std.math.maxInt(ValueType);
                /// The unique value representing an environment variable that is not set.
                const not_set_sentinel: comptime_int = std.math.maxInt(ValueType) - 1;

                var value = std.atomic.Value(ValueType).init(unknown_sentinel);

                inline fn getCached() Output {
                    switch (value.load(.monotonic)) {
                        unknown_sentinel => {
                            @branchHint(.unlikely);
                            return .{ .unknown = {} };
                        },
                        not_set_sentinel => {
                            return .{ .not_set = {} };
                        },
                        else => |v| {
                            return .{ .value = v };
                        },
                    }
                }

                inline fn reload(raw_env: ?[]const u8) ?NonOptionalReturnType {
                    if (raw_env == null) {
                        value.store(not_set_sentinel, .monotonic);
                        return null;
                    }

                    if (std.mem.eql(u8, raw_env.?, "")) {
                        switch (ip.opts.deser.empty_string_as) {
                            .value => |v| {
                                value.store(v, .monotonic);
                                return v;
                            },
                            .erroneous => {
                                return handleError(raw_env.?, "is an empty string");
                            },
                        }
                    }

                    const formatted = std.fmt.parseInt(ValueType, raw_env.?, 10) catch |err| {
                        switch (err) {
                            error.Overflow => {
                                return handleError(raw_env.?, "overflows u64");
                            },
                            error.InvalidCharacter => {
                                return handleError(raw_env.?, "is not a valid integer");
                            },
                        }
                    };

                    if (formatted == not_set_sentinel or formatted == unknown_sentinel) {
                        return handleError(raw_env.?, "is a reserved value");
                    }

                    value.store(formatted, .monotonic);
                    return formatted;
                }

                fn handleError(
                    raw_env: []const u8,
                    comptime reason: []const u8,
                ) ?NonOptionalReturnType {
                    const base_fmt = "Environment variable '{s}' has value '{s}' which ";
                    const fmt = base_fmt ++ reason ++ ".";
                    const missing_default_fmt = "Environment variable '{s}' is configured to " ++
                        "fallback to default on {s}, but no default is set.";

                    switch (ip.opts.deser.error_handling) {
                        .panic => {
                            bun.Output.panic(fmt, .{ ip.var_name, raw_env });
                        },
                        .not_set => {
                            value.store(not_set_sentinel, .monotonic);
                            return null;
                        },
                        .truthy_cast => {
                            if (std.meta.FieldType(EnvVarType, .boolean).stringIsTruthy(raw_env)) {
                                value.store(1, .monotonic);
                                return 1;
                            } else {
                                value.store(0, .monotonic);
                                return 0;
                            }
                        },
                        .default_fallback => {
                            if (comptime ip.opts.default) |d| {
                                return d;
                            }
                            @compileError(std.fmt.comptimePrint(missing_default_fmt, .{
                                ip.var_name,
                                "default_fallback",
                            }));
                        },
                    }
                }
            };
        }
    },
};

/// Create a new environment variable definition.
///
/// The resulting type has methods for interacting with the environment variable.
///
/// Technically, none of the operations here are thread-safe, so writing to environment variables
/// does not guarantee that other threads will see the changes. You should avoid writing to
/// environment variables.
fn new(
    comptime T: std.meta.Tag(EnvVarType),
    comptime key: [:0]const u8,
    comptime opts: std.meta.FieldType(EnvVarType, T).ConsOpts,
) type {
    return platformSpecificNew(T, key, key, opts);
}

/// Identical to new, except it allows you to specify different keys for POSIX and Windows.
///
/// If the current platform does not have a key specified, all methods that attempt to read the
/// environment variable will fail at compile time, except for `platformGet` and `platformKey`,
/// which will return null instead.
fn platformSpecificNew(
    comptime T: std.meta.Tag(EnvVarType),
    comptime posix_key: ?[:0]const u8,
    comptime windows_key: ?[:0]const u8,
    comptime opts: std.meta.FieldType(EnvVarType, T).ConsOpts,
) type {
    const DefaultType = if (comptime opts.default) |d| @TypeOf(d) else void;

    const comptime_key: []const u8 =
        if (posix_key) |pk| pk else if (windows_key) |wk| wk else "<unknown>";

    if (posix_key == null and windows_key == null) {
        @compileError("Environment variable " ++ comptime_key ++ " has no keys for POSIX " ++
            "nor Windows specified. Provide a key for either POSIX or Windows.");
    }

    const VariantType = std.meta.FieldType(EnvVarType, T);
    const KeyType = [:0]const u8;

    // Return type as returned by each of the variants of EnvVarType.
    const NonOptionalReturnType = VariantType.NonOptionalReturnType;

    // The actual return type of public methods.
    const ReturnType = if (opts.default != null) NonOptionalReturnType else ?NonOptionalReturnType;

    return struct {
        const Self = @This();

        const Cache = VariantType.Cache(.{ .var_name = comptime_key, .opts = opts });

        /// Attempt to retrieve the value of the environment variable for the current platform, if
        /// the current platform has a supported definition. Returns null otherwise, unlike the
        /// other methods which will fail at compile time if the platform is unsupported.
        pub fn platformGet() ?NonOptionalReturnType {
            // Get the platform-specific key
            const platform_key: ?KeyType = if (comptime bun.Environment.isPosix)
                posix_key
            else if (comptime bun.Environment.isWindows)
                windows_key
            else
                null;

            // If platform doesn't have a key, return null
            const k = platform_key orelse return null;

            // Inline the logic from get() without calling assertPlatformSupported()
            switch (Cache.getCached()) {
                .unknown => {
                    @branchHint(.unlikely);

                    const env_var = bun.getenvZ(k);
                    const maybe_reloaded = Cache.reload(env_var);

                    if (maybe_reloaded) |v| return v;
                    if (opts.default) |d| {
                        return d;
                    }

                    return null;
                },
                .not_set => {
                    if (opts.default) |d| {
                        return d;
                    }
                    return null;
                },
                .value => |v| return v,
            }
        }

        /// Retrieve the key of the environment variable for the current platform.
        pub fn key() KeyType {
            assertPlatformSupported();
            return Self.platformKey().?;
        }

        /// Retrieve the key of the environment variable for the current platform, if any.
        pub fn platformKey() ?KeyType {
            if (bun.Environment.isPosix) {
                return posix_key;
            }

            if (bun.Environment.isWindows) {
                return windows_key;
            }

            return null;
        }

        /// Retrieve the value of the environment variable, loading it if necessary.
        /// Fails if the current platform is unsupported.
        pub fn get() ReturnType {
            assertPlatformSupported();

            const cached_result = Cache.getCached();

            switch (cached_result) {
                .unknown => {
                    @branchHint(.unlikely);
                    return getForceReload();
                },
                .not_set => {
                    if (opts.default) |d| {
                        return d;
                    }
                    return null;
                },
                .value => |v| {
                    return v;
                },
            }
        }

        /// Retrieve the value of the environment variable, reloading it from the environment.
        /// Fails if the current platform is unsupported.
        fn getForceReload() ReturnType {
            assertPlatformSupported();
            const env_var = bun.getenvZ(key());
            const maybe_reloaded = Cache.reload(env_var);

            if (maybe_reloaded) |v| {
                return v;
            }

            if (opts.default) |d| {
                return d;
            }

            return null;
        }

        /// Fetch the default value of this environment variable, if any.
        ///
        /// It is safe to compare the result of .get() to default to test if the variable is set to
        /// its default value.
        pub const default: DefaultType = if (opts.default) |d| d else {};

        fn assertPlatformSupported() void {
            const missing_key_fmt = "Cannot retrieve the value of " ++ comptime_key ++
                " for {s} since no {s} key is associated with it.";
            if (comptime bun.Environment.isWindows and windows_key == null) {
                @compileError(std.fmt.comptimePrint(missing_key_fmt, .{ "Windows", "Windows" }));
            } else if (comptime bun.Environment.isPosix and posix_key == null) {
                @compileError(std.fmt.comptimePrint(missing_key_fmt, .{ "POSIX", "POSIX" }));
            }
        }
    };
}

pub fn newFeatureFlag(comptime env_var: [:0]const u8) type {
    return new(.boolean, env_var, .{ .default = false });
}

const bun = @import("bun");
const std = @import("std");
