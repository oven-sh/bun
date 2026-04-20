//! Result type for `bun install` and related subcommands. Replaces direct
//! Global.exit() / Global.crash() calls so the install path can be invoked
//! programmatically (e.g. a future `Bun.install()` runtime API) without
//! terminating the process.
//!
//! Zig errors cannot carry payloads, so domain failures (bad lockfile, registry
//! 404, etc.) are returned as `.err` with one or more structured `InstallError`s.
//! OOM and truly unexpected errors still propagate as Zig `error` values via
//! `!InstallResult`.

pub const InstallResult = union(enum) {
    ok: Ok,
    err: Failure,

    /// Success payload. Currently empty; will eventually wrap the install
    /// summary that is printed at the end of a run (see Lockfile.InstallResult
    /// at lockfile.zig:402 for the {lockfile, summary} pair that already exists).
    pub const Ok = void;

    /// One or more accumulated install errors. Non-empty by invariant when
    /// carried in `.err`. The CLI exits with `errors[0].exitCode()`; a future
    /// programmatic API can inspect each variant.
    pub const Failure = []const InstallError;

    /// Allocate a single-element error slice for the `.already_printed` case
    /// (diagnostics already on stderr; only the exit code is interesting).
    /// Uses `bun.default_allocator` — error-path only, freed at process exit.
    /// Intended for `InitResult.err` / `ParseResult.err` construction sites
    /// that previously wrote `.{ .exit_code = N, .message = "" }`.
    pub fn alreadyPrinted(exit_code: u8) Failure {
        const slice = bun.handleOom(bun.default_allocator.alloc(InstallError, 1));
        slice[0] = .{ .already_printed = .{ .exit_code = exit_code } };
        return slice;
    }

    /// Wrap a single structured `InstallError` as a full `InstallResult`.
    /// For call sites that return `InstallResult` directly without a
    /// `*PackageManager` available to call `addError()` on (e.g. early-exit
    /// paths in src/cli/*.zig before manager init).
    pub fn fromError(err: InstallError) InstallResult {
        const slice = bun.handleOom(bun.default_allocator.alloc(InstallError, 1));
        slice[0] = err;
        return .{ .err = slice };
    }

    pub fn isErr(this: InstallResult) bool {
        return this == .err;
    }

    /// CLI-side sink: print every error and Global.exit on .err; no-op on .ok.
    /// ONLY for use in src/cli/*.zig — never call from src/install/.
    pub fn handleCli(this: InstallResult) void {
        switch (this) {
            .ok => {},
            .err => |errors| exitForCli(errors),
        }
    }

    /// CLI-side sink for the `.err` payload directly (i.e. when you have a
    /// `Failure` from `InitResult` / `ParseResult` rather than a full
    /// `InstallResult`). Prints each error via `printForCli()` then exits with
    /// the first error's exit code. ONLY for use in src/cli/*.zig.
    pub fn exitForCli(errors: Failure) noreturn {
        for (errors) |e| e.printForCli();
        bun.Global.exit(if (errors.len > 0) errors[0].exitCode() else 1);
    }
};

const bun = @import("bun");
const InstallError = bun.install.InstallError;
