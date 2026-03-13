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
//! Note that environment variables may fail to parse silently. If they do fail to parse, the
//! default is to show a debug warning and treat them as not set. This behavior can be customized,
//! but environment variables are not meant to be a robust configuration mechanism. If you do think
//! your feature needs more customization, consider using other means. The reason we have decided
//! upon this behavior is to avoid panics due to environment variable pollution.
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

pub const AGENT = New(kind.string, "AGENT", .{});
pub const BUN_AGENT_RULE_DISABLED = New(kind.boolean, "BUN_AGENT_RULE_DISABLED", .{ .default = false });
pub const BUN_COMPILE_TARGET_TARBALL_URL = New(kind.string, "BUN_COMPILE_TARGET_TARBALL_URL", .{});
pub const BUN_CONFIG_DISABLE_COPY_FILE_RANGE = New(kind.boolean, "BUN_CONFIG_DISABLE_COPY_FILE_RANGE", .{ .default = false });
pub const BUN_CONFIG_DISABLE_ioctl_ficlonerange = New(kind.boolean, "BUN_CONFIG_DISABLE_ioctl_ficlonerange", .{ .default = false });
/// TODO(markovejnovic): Legacy usage had the default at 30, even though a the attached comment
/// quoted: Amazon Web Services recommends 5 seconds:
/// https://docs.aws.amazon.com/sdk-for-java/v1/developer-guide/jvm-ttl-dns.html
///
/// It's unclear why this was done.
pub const BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS = New(kind.unsigned, "BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS", .{ .default = 30 });
pub const BUN_CRASH_REPORT_URL = New(kind.string, "BUN_CRASH_REPORT_URL", .{});
pub const BUN_DEBUG = New(kind.string, "BUN_DEBUG", .{});
pub const BUN_DEBUG_ALL = New(kind.boolean, "BUN_DEBUG_ALL", .{});
pub const BUN_DEBUG_CSS_ORDER = New(kind.boolean, "BUN_DEBUG_CSS_ORDER", .{ .default = false });
pub const BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE = New(kind.boolean, "BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE", .{ .default = false });
pub const BUN_DEBUG_HASH_RANDOM_SEED = New(kind.unsigned, "BUN_DEBUG_HASH_RANDOM_SEED", .{ .deser = .{ .error_handling = .not_set } });
pub const BUN_DEBUG_QUIET_LOGS = New(kind.boolean, "BUN_DEBUG_QUIET_LOGS", .{});
pub const BUN_DEBUG_TEST_TEXT_LOCKFILE = New(kind.boolean, "BUN_DEBUG_TEST_TEXT_LOCKFILE", .{ .default = false });
pub const BUN_DEV_SERVER_TEST_RUNNER = New(kind.string, "BUN_DEV_SERVER_TEST_RUNNER", .{});
pub const BUN_ENABLE_CRASH_REPORTING = New(kind.boolean, "BUN_ENABLE_CRASH_REPORTING", .{});
pub const BUN_FEATURE_FLAG_DUMP_CODE = New(kind.string, "BUN_FEATURE_FLAG_DUMP_CODE", .{});
/// TODO(markovejnovic): It's unclear why the default here is 100_000, but this was legacy behavior
/// so we'll keep it for now.
pub const BUN_INOTIFY_COALESCE_INTERVAL = New(kind.unsigned, "BUN_INOTIFY_COALESCE_INTERVAL", .{ .default = 100_000 });
pub const BUN_INSPECT = New(kind.string, "BUN_INSPECT", .{ .default = "" });
pub const BUN_INSPECT_CONNECT_TO = New(kind.string, "BUN_INSPECT_CONNECT_TO", .{ .default = "" });
pub const BUN_INSPECT_PRELOAD = New(kind.string, "BUN_INSPECT_PRELOAD", .{});
pub const BUN_INSTALL = New(kind.string, "BUN_INSTALL", .{});
pub const BUN_INSTALL_BIN = New(kind.string, "BUN_INSTALL_BIN", .{});
pub const BUN_INSTALL_GLOBAL_DIR = New(kind.string, "BUN_INSTALL_GLOBAL_DIR", .{});
pub const BUN_NEEDS_PROC_SELF_WORKAROUND = New(kind.boolean, "BUN_NEEDS_PROC_SELF_WORKAROUND", .{ .default = false });
pub const BUN_OPTIONS = New(kind.string, "BUN_OPTIONS", .{});
pub const BUN_POSTGRES_SOCKET_MONITOR = New(kind.string, "BUN_POSTGRES_SOCKET_MONITOR", .{});
pub const BUN_POSTGRES_SOCKET_MONITOR_READER = New(kind.string, "BUN_POSTGRES_SOCKET_MONITOR_READER", .{});
pub const BUN_RUNTIME_TRANSPILER_CACHE_PATH = New(kind.string, "BUN_RUNTIME_TRANSPILER_CACHE_PATH", .{});
pub const BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR = New(kind.boolean, "BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR", .{ .default = false });
pub const BUN_TCC_OPTIONS = New(kind.string, "BUN_TCC_OPTIONS", .{});
/// Standard C compiler environment variable for include paths (colon-separated).
/// Used by bun:ffi's TinyCC integration for systems like NixOS.
pub const C_INCLUDE_PATH = PlatformSpecificNew(kind.string, "C_INCLUDE_PATH", null, .{});
/// Standard C compiler environment variable for library paths (colon-separated).
/// Used by bun:ffi's TinyCC integration for systems like NixOS.
pub const LIBRARY_PATH = PlatformSpecificNew(kind.string, "LIBRARY_PATH", null, .{});
pub const BUN_TMPDIR = New(kind.string, "BUN_TMPDIR", .{});
pub const BUN_TRACK_LAST_FN_NAME = New(kind.boolean, "BUN_TRACK_LAST_FN_NAME", .{ .default = false });
pub const BUN_TRACY_PATH = New(kind.string, "BUN_TRACY_PATH", .{});
pub const BUN_WATCHER_TRACE = New(kind.string, "BUN_WATCHER_TRACE", .{});
pub const CI = New(kind.boolean, "CI", .{});
pub const CI_COMMIT_SHA = New(kind.string, "CI_COMMIT_SHA", .{});
pub const CI_JOB_URL = New(kind.string, "CI_JOB_URL", .{});
pub const CLAUDE_CODE_AGENT_RULE_DISABLED = New(kind.boolean, "CLAUDE_CODE_AGENT_RULE_DISABLED", .{ .default = false });
pub const CLAUDECODE = New(kind.boolean, "CLAUDECODE", .{ .default = false });
pub const COLORTERM = New(kind.string, "COLORTERM", .{});
pub const CURSOR_AGENT_RULE_DISABLED = New(kind.boolean, "CURSOR_AGENT_RULE_DISABLED", .{ .default = false });
pub const CURSOR_TRACE_ID = New(kind.boolean, "CURSOR_TRACE_ID", .{ .default = false });
pub const DO_NOT_TRACK = New(kind.boolean, "DO_NOT_TRACK", .{ .default = false });
pub const DYLD_ROOT_PATH = PlatformSpecificNew(kind.string, "DYLD_ROOT_PATH", null, .{});
/// TODO(markovejnovic): We should support enums in this library, and force_color's usage is,
/// indeed, an enum. The 80-20 is to make it an unsigned value (which also works well).
pub const FORCE_COLOR = New(kind.unsigned, "FORCE_COLOR", .{ .deser = .{ .error_handling = .truthy_cast, .empty_string_as = .{ .value = 1 } } });
pub const fpath = PlatformSpecificNew(kind.string, "fpath", null, .{});
pub const GIT_SHA = New(kind.string, "GIT_SHA", .{});
pub const GITHUB_ACTIONS = New(kind.boolean, "GITHUB_ACTIONS", .{ .default = false });
pub const GITHUB_REPOSITORY = New(kind.string, "GITHUB_REPOSITORY", .{});
pub const GITHUB_RUN_ID = New(kind.string, "GITHUB_RUN_ID", .{});
pub const GITHUB_SERVER_URL = New(kind.string, "GITHUB_SERVER_URL", .{});
pub const GITHUB_SHA = New(kind.string, "GITHUB_SHA", .{});
pub const GITHUB_WORKSPACE = New(kind.string, "GITHUB_WORKSPACE", .{});
pub const HOME = PlatformSpecificNew(kind.string, "HOME", "USERPROFILE", .{});
pub const HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET = New(kind.string, "HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET", .{});
pub const IS_BUN_AUTO_UPDATE = New(kind.boolean, "IS_BUN_AUTO_UPDATE", .{ .default = false });
pub const JENKINS_URL = New(kind.string, "JENKINS_URL", .{});
/// Dump mimalloc statistics at the end of the process. Note that this is not the same as
/// `MIMALLOC_VERBOSE`, documented here: https://microsoft.github.io/mimalloc/environment.html
pub const MI_VERBOSE = New(kind.boolean, "MI_VERBOSE", .{ .default = false });
pub const NO_COLOR = New(kind.boolean, "NO_COLOR", .{ .default = false });
pub const NODE_CHANNEL_FD = New(kind.string, "NODE_CHANNEL_FD", .{});
pub const NODE_PRESERVE_SYMLINKS_MAIN = New(kind.boolean, "NODE_PRESERVE_SYMLINKS_MAIN", .{ .default = false });
pub const NODE_USE_SYSTEM_CA = New(kind.boolean, "NODE_USE_SYSTEM_CA", .{ .default = false });
pub const npm_lifecycle_event = New(kind.string, "npm_lifecycle_event", .{});
pub const PATH = New(kind.string, "PATH", .{});
pub const REPL_ID = New(kind.boolean, "REPL_ID", .{ .default = false });
pub const RUNNER_DEBUG = New(kind.boolean, "RUNNER_DEBUG", .{ .default = false });
pub const SDKROOT = PlatformSpecificNew(kind.string, "SDKROOT", null, .{});
pub const SHELL = PlatformSpecificNew(kind.string, "SHELL", null, .{});
/// C:\Windows, for example.
/// Note: Do not use this variable directly -- use os.zig's implementation instead.
pub const SYSTEMROOT = PlatformSpecificNew(kind.string, null, "SYSTEMROOT", .{});
pub const TEMP = PlatformSpecificNew(kind.string, "TEMP", "TEMP", .{});
pub const TERM = New(kind.string, "TERM", .{});
pub const TERM_PROGRAM = New(kind.string, "TERM_PROGRAM", .{});
pub const TMP = PlatformSpecificNew(kind.string, "TMP", "TMP", .{});
pub const TMPDIR = PlatformSpecificNew(kind.string, "TMPDIR", "TMPDIR", .{});
pub const TMUX = New(kind.string, "TMUX", .{});
pub const TODIUM = New(kind.string, "TODIUM", .{});
pub const USER = PlatformSpecificNew(kind.string, "USER", "USERNAME", .{});
pub const WANTS_LOUD = New(kind.boolean, "WANTS_LOUD", .{ .default = false });
/// The same as system_root.
/// Note: Do not use this variable directly -- use os.zig's implementation instead.
/// TODO(markovejnovic): Perhaps we could add support for aliases in the library, so you could
///                      specify both WINDIR and SYSTEMROOT and the loader would check both?
pub const WINDIR = PlatformSpecificNew(kind.string, null, "WINDIR", .{});
/// XDG Base Directory Specification variables.
/// For some reason, legacy usage respected these even on Windows. To avoid compatibility issues,
/// we respect them too.
pub const XDG_CACHE_HOME = New(kind.string, "XDG_CACHE_HOME", .{});
pub const XDG_CONFIG_HOME = New(kind.string, "XDG_CONFIG_HOME", .{});
pub const XDG_DATA_HOME = New(kind.string, "XDG_DATA_HOME", .{});
pub const ZDOTDIR = New(kind.string, "ZDOTDIR", .{});

pub const feature_flag = struct {
    pub const BUN_ASSUME_PERFECT_INCREMENTAL = newFeatureFlag("BUN_ASSUME_PERFECT_INCREMENTAL", .{ .default = null });
    pub const BUN_BE_BUN = newFeatureFlag("BUN_BE_BUN", .{});
    pub const BUN_DEBUG_NO_DUMP = newFeatureFlag("BUN_DEBUG_NO_DUMP", .{});
    pub const BUN_DESTRUCT_VM_ON_EXIT = newFeatureFlag("BUN_DESTRUCT_VM_ON_EXIT", .{});

    /// Disable "nativeDependencies"
    pub const BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER", .{});

    /// Disable "ignoreScripts" in package.json
    pub const BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS", .{});

    pub const BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_DNS_CACHE = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_DNS_CACHE", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_INSTALL_INDEX = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_INSTALL_INDEX", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_IO_POOL = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_IO_POOL", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_IPV4 = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_IPV4", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_IPV6 = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_IPV6", .{});
    /// The RedisClient supports auto-pipelining by default. This flag disables that behavior.
    pub const BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK", .{});
    pub const BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING = newFeatureFlag("BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING", .{});
    pub const BUN_DISABLE_SOURCE_CODE_PREVIEW = newFeatureFlag("BUN_DISABLE_SOURCE_CODE_PREVIEW", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING", .{});
    pub const BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW = newFeatureFlag("BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW", .{});
    pub const BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE = newFeatureFlag("BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE", .{});
    pub const BUN_DUMP_STATE_ON_CRASH = newFeatureFlag("BUN_DUMP_STATE_ON_CRASH", .{});
    pub const BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS = newFeatureFlag("BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS", .{});
    pub const BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE = newFeatureFlag("BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE", .{});
    pub const BUN_FEATURE_FLAG_FORCE_IO_POOL = newFeatureFlag("BUN_FEATURE_FLAG_FORCE_IO_POOL", .{});
    pub const BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS = newFeatureFlag("BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS", .{});
    pub const BUN_INSTRUMENTS = newFeatureFlag("BUN_INSTRUMENTS", .{});
    pub const BUN_INTERNAL_BUNX_INSTALL = newFeatureFlag("BUN_INTERNAL_BUNX_INSTALL", .{});
    pub const BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN = newFeatureFlag("BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN", .{});
    pub const BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT = newFeatureFlag("BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT", .{});
    pub const BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF = newFeatureFlag("BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF", .{});
    pub const BUN_INTERNAL_SUPPRESS_CRASH_ON_UV_STUB = newFeatureFlag("BUN_INTERNAL_SUPPRESS_CRASH_ON_UV_STUB", .{});
    pub const BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304 = newFeatureFlag("BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304", .{});
    pub const BUN_NO_CODESIGN_MACHO_BINARY = newFeatureFlag("BUN_NO_CODESIGN_MACHO_BINARY", .{});
    pub const BUN_FEATURE_FLAG_NO_LIBDEFLATE = newFeatureFlag("BUN_FEATURE_FLAG_NO_LIBDEFLATE", .{});
    pub const NODE_NO_WARNINGS = newFeatureFlag("NODE_NO_WARNINGS", .{});
    pub const BUN_TRACE = newFeatureFlag("BUN_TRACE", .{});
};

/// Interface between each of the different EnvVar types and the common logic.
fn CacheOutput(comptime ValueType: type) type {
    return union(enum) {
        /// The environment variable hasn't been loaded yet.
        unknown: void,
        /// The environment variable has been loaded but its not set.
        not_set: void,
        /// The environment variable is set to a value.
        value: ValueType,
    };
}

fn CacheConfigurationType(comptime CtorOptionsType: type) type {
    return struct {
        var_name: []const u8,
        opts: CtorOptionsType,
    };
}

/// Structure which encodes the different types of environment variables supported.
///
/// This requires the following static members:
///
///   - `ValueType`: The underlying environment variable type if one is set. For
///                              example, a string `$PATH` ought return a `[]const u8` when set.
///   - `Cache`: A struct implementing the following methods:
///       - `getCached() CacheOutput(ValueType)`: Retrieve the cached value of the
///                                                               environment variable, if any.
///       - `deserAndInvalidate(raw_env: ?[]const u8) ?ValueType`
///   - `CtorOptions`: A struct containing the options passed to the constructor of the environment
///                 variable definition.
///
/// This type will communicate with the common logic via the `CacheOutput` type.
const kind = struct {
    const string = struct {
        const ValueType = []const u8;
        const Input = CacheConfigurationType(CtorOptions);
        const Output = CacheOutput(ValueType);
        const CtorOptions = struct {
            default: ?ValueType = null,
        };

        fn Cache(comptime ip: Input) type {
            _ = ip;

            const PointerType = ?[*]const u8;
            const LenType = usize;

            return struct {
                const Self = @This();

                const not_loaded_sentinel = struct {
                    const ptr: PointerType = null;
                    const len: LenType = std.math.maxInt(LenType);
                };

                const not_set_sentinel = struct {
                    const ptr: PointerType = null;
                    const len: LenType = std.math.maxInt(LenType) - 1;
                };

                ptr_value: std.atomic.Value(PointerType) = .init(null),
                len_value: std.atomic.Value(LenType) = .init(std.math.maxInt(LenType)),

                fn getCached(self: *Self) Output {
                    const len = self.len_value.load(.acquire);

                    if (len == not_loaded_sentinel.len) {
                        return .{ .unknown = {} };
                    }

                    if (len == not_set_sentinel.len) {
                        return .{ .not_set = {} };
                    }

                    const ptr = self.ptr_value.load(.monotonic);

                    return .{ .value = ptr.?[0..len] };
                }

                inline fn deserAndInvalidate(self: *Self, raw_env: ?[]const u8) ?ValueType {
                    // The implementation is racy and allows two threads to both set the value at
                    // the same time, as long as the value they are setting is the same. This is
                    // difficult to write an assertion for since it requires the DEV path take a
                    // .swap() path rather than a plain .store().

                    if (raw_env) |ev| {
                        self.ptr_value.store(ev.ptr, .monotonic);
                        self.len_value.store(ev.len, .release);
                    } else {
                        self.ptr_value.store(not_set_sentinel.ptr, .monotonic);
                        self.len_value.store(not_set_sentinel.len, .release);
                    }

                    return raw_env;
                }
            };
        }
    };

    const boolean = struct {
        const ValueType = bool;
        const Input = CacheConfigurationType(CtorOptions);
        const Output = CacheOutput(ValueType);
        const CtorOptions = struct {
            default: ?ValueType = null,
        };

        fn stringIsTruthy(s: []const u8) bool {
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
                const Self = @This();

                const StoredType = enum(u8) { unknown, not_set, no, yes };

                value: std.atomic.Value(StoredType) = .init(.unknown),

                inline fn getCached(self: *Self) Output {
                    _ = ip;

                    const cached = self.value.load(.monotonic);
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

                inline fn deserAndInvalidate(self: *Self, raw_env: ?[]const u8) ?ValueType {
                    if (raw_env == null) {
                        self.value.store(.not_set, .monotonic);
                        return null;
                    }

                    const string_is_truthy = stringIsTruthy(raw_env.?);
                    self.value.store(if (string_is_truthy) .yes else .no, .monotonic);
                    return string_is_truthy;
                }
            };
        }
    };

    const unsigned = struct {
        const ValueType = u64;
        const Input = CacheConfigurationType(CtorOptions);
        const Output = CacheOutput(ValueType);
        const CtorOptions = struct {
            default: ?ValueType = null,
            deser: struct {
                /// Control how deserializing and deserialization errors are handled.
                ///
                /// Note that deserialization errors cannot panic. If you need more robust means of
                /// handling inputs, consider not using environment variables.
                error_handling: enum {
                    /// debug_warn on deserialization errors.
                    debug_warn,
                    /// Ignore deserialization errors and treat the variable as not set.
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
                } = .debug_warn,

                /// Control what empty strings are treated as.
                empty_string_as: union(enum) {
                    /// Empty strings are handled as the given value.
                    value: ValueType,
                    /// Empty strings are treated as deserialization errors.
                    erroneous: void,
                } = .erroneous,
            } = .{},
        };

        fn Cache(comptime ip: Input) type {
            return struct {
                const Self = @This();

                const StoredType = ValueType;

                /// The value meaning an environment variable that hasn't been loaded yet.
                const unknown_sentinel: comptime_int = std.math.maxInt(StoredType);
                /// The unique value representing an environment variable that is not set.
                const not_set_sentinel: comptime_int = std.math.maxInt(StoredType) - 1;

                value: std.atomic.Value(StoredType) = .init(unknown_sentinel),

                inline fn getCached(self: *Self) Output {
                    switch (self.value.load(.monotonic)) {
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

                inline fn deserAndInvalidate(self: *Self, raw_env: ?[]const u8) ?ValueType {
                    if (raw_env == null) {
                        self.value.store(not_set_sentinel, .monotonic);
                        return null;
                    }

                    if (std.mem.eql(u8, raw_env.?, "")) {
                        switch (ip.opts.deser.empty_string_as) {
                            .value => |v| {
                                self.value.store(v, .monotonic);
                                return v;
                            },
                            .erroneous => {
                                return self.handleError(raw_env.?, "is an empty string");
                            },
                        }
                    }

                    const formatted = std.fmt.parseInt(StoredType, raw_env.?, 10) catch |err| {
                        switch (err) {
                            error.Overflow => {
                                return self.handleError(raw_env.?, "overflows u64");
                            },
                            error.InvalidCharacter => {
                                return self.handleError(raw_env.?, "is not a valid integer");
                            },
                        }
                    };

                    if (formatted == not_set_sentinel or formatted == unknown_sentinel) {
                        return self.handleError(raw_env.?, "is a reserved value");
                    }

                    self.value.store(formatted, .monotonic);
                    return formatted;
                }

                fn handleError(
                    self: *Self,
                    raw_env: []const u8,
                    comptime reason: []const u8,
                ) ?ValueType {
                    const base_fmt = "Environment variable '{s}' has value '{s}' which ";
                    const fmt = base_fmt ++ reason ++ ".";
                    const missing_default_fmt = "Environment variable '{s}' is configured to " ++
                        "fallback to default on {s}, but no default is set.";

                    switch (ip.opts.deser.error_handling) {
                        .debug_warn => {
                            bun.Output.debugWarn(fmt, .{ ip.var_name, raw_env });
                            self.value.store(not_set_sentinel, .monotonic);
                            return null;
                        },
                        .not_set => {
                            self.value.store(not_set_sentinel, .monotonic);
                            return null;
                        },
                        .truthy_cast => {
                            if (kind.boolean.stringIsTruthy(raw_env)) {
                                self.value.store(1, .monotonic);
                                return 1;
                            } else {
                                self.value.store(0, .monotonic);
                                return 0;
                            }
                        },
                        .default_fallback => {
                            if (comptime ip.opts.default) |d| {
                                return deserAndInvalidate(d);
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
    };
};

/// Create a new environment variable definition.
///
/// The resulting type has methods for interacting with the environment variable.
///
/// Technically, none of the operations here are thread-safe, so writing to environment variables
/// does not guarantee that other threads will see the changes. You should avoid writing to
/// environment variables.
fn New(
    comptime VariantType: type,
    comptime key: [:0]const u8,
    comptime opts: VariantType.CtorOptions,
) type {
    return PlatformSpecificNew(VariantType, key, key, opts);
}

/// Identical to new, except it allows you to specify different keys for POSIX and Windows.
///
/// If the current platform does not have a key specified, all methods that attempt to read the
/// environment variable will fail at compile time, except for `platformGet` and `platformKey`,
/// which will return null instead.
fn PlatformSpecificNew(
    comptime VariantType: type,
    comptime posix_key: ?[:0]const u8,
    comptime windows_key: ?[:0]const u8,
    comptime opts: VariantType.CtorOptions,
) type {
    const DefaultType = if (comptime opts.default) |d| @TypeOf(d) else void;

    const comptime_key: []const u8 =
        if (posix_key) |pk| pk else if (windows_key) |wk| wk else "<unknown>";

    if (posix_key == null and windows_key == null) {
        @compileError("Environment variable " ++ comptime_key ++ " has no keys for POSIX " ++
            "nor Windows specified. Provide a key for either POSIX or Windows.");
    }

    const KeyType = [:0]const u8;

    // Return type as returned by each of the variants of kind.
    const ValueType = VariantType.ValueType;

    // The actual return type of public methods.
    const ReturnType = if (opts.default != null) ValueType else ?ValueType;

    return struct {
        const Self = @This();

        var cache: VariantType.Cache(.{ .var_name = comptime_key, .opts = opts }) = .{};

        /// Attempt to retrieve the value of the environment variable for the current platform, if
        /// the current platform has a supported definition. Returns null otherwise, unlike the
        /// other methods which will fail at compile time if the platform is unsupported.
        pub fn platformGet() ?ValueType {
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
            switch (cache.getCached()) {
                .unknown => {
                    @branchHint(.unlikely);

                    const env_var = bun.getenvZ(k);
                    const maybe_reloaded = cache.deserAndInvalidate(env_var);

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

        /// Equal to `.platformKey()` except fails to compile if current platform is supported.
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

        pub fn getNotEmpty() ReturnType {
            if (Self.get()) |v| {
                if (v.len == 0) {
                    return null;
                }
                return v;
            }
            return null;
        }

        /// Retrieve the value of the environment variable, loading it if necessary.
        /// Fails if the current platform is unsupported.
        pub fn get() ReturnType {
            assertPlatformSupported();

            const cached_result = cache.getCached();

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
            const maybe_reloaded = cache.deserAndInvalidate(env_var);

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

const FeatureFlagOpts = struct {
    default: ?bool = false,
};

fn newFeatureFlag(comptime env_var: [:0]const u8, comptime opts: FeatureFlagOpts) type {
    return New(kind.boolean, env_var, .{ .default = opts.default });
}

const bun = @import("bun");
const std = @import("std");
