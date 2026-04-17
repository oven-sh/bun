//! Structured error variants for `bun install` and related subcommands.
//!
//! Each variant carries the data needed to reproduce the exact CLI stderr
//! output, so a future programmatic `Bun.install()` API can surface errors
//! as data instead of writing to stderr at the error site.
//!
//! `printForCli()` is the *only* place that formats these to stderr; it
//! contains the verbatim Output.* calls that used to live at each call site.
//! `exitCode()` returns the exit code the CLI should use (1 for almost
//! everything; lifecycle-script and the two escape-hatch variants carry
//! their own).
//!
//! Payload string lifetime: all `[]const u8` payloads must be **owned**
//! (duped via `manager.allocator` at the `addError` call site) because
//! lockfile string buffers / stack path buffers do not outlive the install.
//! `bun.sys.Error` and `anyerror` are copyable by value.
//!
//! ─────────────────────────────────────────────────────────────────────────
//! Sites that stay `.already_printed` (NOT migrated to a structured variant)
//! ─────────────────────────────────────────────────────────────────────────
//!
//! These sites either dump multi-line `log.print()` output, branch over many
//! comptime fmt strings, or fail on an aggregate flag with no single message.
//! They keep their existing Output.* calls and use `.already_printed`.
//!
//!   install_with_manager.zig:86      lockfile-load error switch (4 fmts) + warn + log.print
//!   install_with_manager.zig:633     request.failed flag — error printed at request site
//!   install_with_manager.zig:862     log.hasErrors() after log.print() at :860
//!   install_with_manager.zig:957     any_failed_to_install aggregate flag
//!   updatePackageJSONAndInstall.zig:71   manager.log.errors > 0 + log.print()
//!   updatePackageJSONAndInstall.zig:348  request.failed flag
//!   updatePackageJSONAndInstall.zig:502  catch error.InstallFailed/InvalidPackageJSON + log.print()
//!   PackageInstaller.zig:446/531/1483    bin-link errors — many comptime fmt arms via progress.log
//!   PackageInstaller.zig:1268            cause.fatal — diagnostic printed inside PackageInstall
//!   isolated_install/Installer.zig:183   fail_early after task failure (printed in task)
//!   patchPackage.zig:51                  lockfile-load error switch (4 fmts) + trailer line
//!   update_interactive_command.zig:362   lockfile-load error switch (4 fmts) + log.print
//!   PackageManagerDirectories.zig:652    saveToDisk catch — diagnostics printed inside saveToDisk
//!   link_command.zig:110, unlink_command.zig:65
//!                                        globalLinkDirPath() catch — inner call already addError'd
//!
//! Sites preceded by `log.print()` but with a single Output.err line afterward
//! (Package.zig:967, patchPackage.zig:110/617, install_with_manager.zig:155/
//! 162/450/457, updatePackageJSONAndInstall.zig:88/297) keep the log.print()
//! at the call site and use a structured variant for the trailing line — see
//! `package_json_parse_in_dir`, `root_package_json_read`, `root_package_json_parse`,
//! `package_json_parse_failed` below.

pub const InstallError = union(enum) {
    // ──────────────────────────────────────────────────────────────────────
    // Escape hatches
    // ──────────────────────────────────────────────────────────────────────

    /// Diagnostics already written to stderr (multi-line log dumps via
    /// `log.print()`, subprocess output, computed `fmt` strings). printForCli
    /// is a no-op for this variant. Use sparingly — prefer a real variant.
    already_printed: struct { exit_code: u8 },

    /// Pre-formatted message with ANSI codes already resolved. Legacy escape
    /// hatch; prefer a typed variant.
    generic: struct { exit_code: u8, message: []const u8 },

    // ──────────────────────────────────────────────────────────────────────
    // package.json read / parse / shape
    // ──────────────────────────────────────────────────────────────────────

    /// link_command.zig:41, unlink_command.zig:41
    link_read_package_json: struct {
        path: []const u8,
        err: anyerror,
        action: enum { linking, unlinking },
    },
    /// link:51, unlink:51
    package_json_missing_name: struct { path: []const u8, silent: bool },
    /// link:56, unlink:56
    package_json_invalid_name: struct { name: []const u8, path: []const u8, silent: bool },
    /// updatePackageJSONAndInstall.zig:91/300
    package_json_read_failed: struct { path: []const u8, err: anyerror },
    /// updatePackageJSONAndInstall.zig:84/293 — .parse_err arm; call site
    /// keeps the preceding `log.print()` and adds this for the trailing line.
    package_json_parse_failed: struct { path: []const u8, err: anyerror },
    /// install_with_manager.zig:154/449 — root pkg .read_err; log.print() stays at call site.
    root_package_json_read: struct { path: []const u8, err: anyerror },
    /// install_with_manager.zig:161/456 — root pkg .parse_err; log.print() stays at call site.
    root_package_json_parse: struct { path: []const u8, err: anyerror },
    /// lockfile/Package.zig:966, patchPackage.zig:109/616 — log.print() stays at call site.
    /// dir is `source.path.prettyDir()`.
    package_json_parse_in_dir: struct { err: anyerror, dir: []const u8 },
    /// updatePackageJSONAndInstall.zig:412
    package_json_read_or_parse_failed: struct { path: []const u8, err: anyerror },
    /// updatePackageJSONAndInstall.zig:254/331/397
    package_json_print_failed: struct { err: anyerror },
    /// updatePackageJSONAndInstall.zig:357
    package_json_reparse_failed: struct { err: anyerror },
    /// updatePackageJSONAndInstall.zig:109
    package_json_not_object: struct { subcommand: []const u8 },
    /// updatePackageJSONAndInstall.zig:112
    package_json_empty_object: struct { subcommand: []const u8 },
    /// updatePackageJSONAndInstall.zig:517/521/525
    no_package_json_for_subcommand: struct { action: enum { update, remove, patch } },
    /// processDependencyList.zig:87 — resolution_url is pre-formatted from `resolution.fmtURL(buf)`
    dep_package_json_parse_failed: struct { resolution_url: []const u8, err: anyerror, silent: bool },
    /// processDependencyList.zig:180/229
    dep_package_json_not_json: struct { resolution_url: []const u8, err: anyerror, silent: bool },

    // ──────────────────────────────────────────────────────────────────────
    // Lockfile
    // ──────────────────────────────────────────────────────────────────────

    /// patchPackage.zig:22
    patch_lockfile_not_found,
    /// update_interactive_command.zig:336
    outdated_lockfile_not_found: struct { silent: bool },
    /// install_with_manager.zig:433/775. The two sites differ slightly:
    /// 433 uses `<r>: ` (plain colon, no note); 775 uses `<d>:<r> ` (dim colon,
    /// followed by Output.note). `with_note` selects between them.
    frozen_lockfile_changed: struct { with_note: bool, silent: bool },
    /// migration.zig:22
    npm_lockfile_version_mismatch,

    // ──────────────────────────────────────────────────────────────────────
    // Temp / cache / node_modules / global directories
    // ──────────────────────────────────────────────────────────────────────

    /// PackageManagerDirectories.zig:39/53
    tempdir_access: struct { err: anyerror },
    /// PackageManagerDirectories.zig:76
    tempdir_write: struct { err: anyerror },
    /// PackageManagerDirectories.zig:64/88
    tempdir_set_env: struct { err: anyerror },
    /// PackageManagerDirectories.zig:114
    tempdir_path_read: struct { err: anyerror, path: []const u8 },
    /// PackageManagerDirectories.zig:150
    cache_dir_create: struct { err: anyerror },
    /// PackageManagerDirectories.zig:724
    tmpfile_create: struct { err: anyerror },
    /// PackageManagerDirectories.zig:388
    global_dir_not_found,
    /// PackageManagerDirectories.zig:393
    global_dir_open: struct { err: anyerror },
    /// PackageManagerDirectories.zig:400 — dir_path is pre-formatted from `FD.fromStdDir(global_dir)` formatter
    global_link_dir_open: struct { err: anyerror, dir_path: []const u8 },
    /// PackageManagerDirectories.zig:406
    global_dir_path_read: struct { err: anyerror },
    /// link:78, unlink:91
    global_node_modules_create: struct { err: anyerror, silent: bool },
    /// link:94
    global_scope_create: struct { err: anyerror, silent: bool },
    /// link:118 (Windows)
    global_junction_create: struct { err: bun.sys.Error },
    /// link:127
    global_symlink_create: struct { err: anyerror, silent: bool },
    /// link:141, unlink:104
    link_binary_fdpath: struct { err: anyerror, silent: bool },
    /// link:168
    link_bin: struct { err: anyerror, silent: bool },
    /// unlink:131
    unlink_delete: struct { err: anyerror, silent: bool },
    /// unlink:138 — printed to STDOUT via Output.prettyln
    unlink_with_name_not_implemented,
    /// updatePackageJSONAndInstall.zig:482
    node_modules_bin_read: struct { err: anyerror },
    /// hoisted_install.zig:66
    node_modules_create: struct { err: bun.sys.Error },
    /// hoisted_install.zig:72
    node_modules_open: struct { err: anyerror },
    /// isolated_install.zig:712/718/768
    isolated_mkdir: struct { err: anyerror, path: []const u8 },
    /// isolated_install.zig:1191
    isolated_install_packages: struct { err: anyerror },
    /// isolated_install.zig:1039/1082/1123 — name_and_version is pre-formatted "{name}@{resolution}"
    isolated_enqueue_download: struct {
        err: anyerror,
        kind: enum { package, github, tarball },
        name_and_version: []const u8,
    },

    // ──────────────────────────────────────────────────────────────────────
    // node-gyp shim (PackageManager.zig:500-551)
    // ──────────────────────────────────────────────────────────────────────

    node_gyp_tempdir_exists,
    node_gyp_tempdir_create: struct { err: anyerror },
    node_gyp_file_write: struct { err: anyerror },

    // ──────────────────────────────────────────────────────────────────────
    // Permission (PackageInstaller.zig:1286-1326)
    // ──────────────────────────────────────────────────────────────────────

    /// PackageInstaller.zig:1298/1307 — two identical sites, each prints main
    /// line + (debug-only) stat-error line
    install_eacces_package: struct { package_name: []const u8, debug_err: anyerror },
    /// PackageInstaller.zig:1325
    install_eacces_node_modules,

    // ──────────────────────────────────────────────────────────────────────
    // Lifecycle scripts (lifecycle_script_runner.zig)
    // These sites are preceded by `this.printOutput()` (subprocess stdout/
    // stderr dump), so in the migration step call sites keep printOutput()
    // and use `.already_printed`. The structured variants exist so a future
    // programmatic API can capture the failure kind; printForCli reproduces
    // only the error line.
    // ──────────────────────────────────────────────────────────────────────

    /// :358 — exitCode() returns the script's own exit code
    lifecycle_script_exited: struct { script_name: []const u8, package_name: []const u8, exit_code: u8 },
    /// :415 (errGeneric) and :587 (prettyErrorln). The two sites use
    /// slightly different "error:" prefixes; `use_err_generic` selects.
    lifecycle_script_spawn_failed: struct { script_name: []const u8, err: anyerror, use_err_generic: bool },
    /// :472
    lifecycle_script_sys_error: struct { script_name: []const u8, package_name: []const u8, err: bun.sys.Error },
    /// :485
    lifecycle_script_unexpected_status: struct { script_name: []const u8, package_name: []const u8, status: bun.spawn.Status },

    /// PackageInstaller.zig:719
    lifecycle_scripts_fill: struct { alias: []const u8, err: anyerror, silent: bool },

    // ──────────────────────────────────────────────────────────────────────
    // Security scanner (install_with_manager.zig:645-685)
    // ──────────────────────────────────────────────────────────────────────

    /// :645-668 — switch on err in printForCli
    security_scanner_failed: struct { err: anyerror },
    /// :681 — printed to STDOUT via Output.pretty. Preceded by
    /// printSecurityAdvisories() (multi-line table), so migrate as
    /// `.already_printed` in practice; variant exists for API consumers.
    security_fatal_advisory,
    /// :685 — user declined prompt; no Output preceding
    security_warning_declined,

    // ──────────────────────────────────────────────────────────────────────
    // bun patch (patchPackage.zig)
    // ──────────────────────────────────────────────────────────────────────

    /// :78
    patch_open_root_node_modules: struct { err: bun.sys.Error },
    /// :98/605
    patch_read_package_json: struct { err: bun.sys.Error, path: []const u8 },
    /// :118/625
    patch_missing_version: struct { path: []const u8 },
    /// :132/639
    patch_lockfile_index_bug,
    /// :148/655
    patch_package_not_found_by_name: struct { name: []const u8 },
    /// :208
    patch_cache_path_read: struct { err: bun.sys.Error },
    /// :220/250
    patch_tmpname: struct { err: anyerror },
    /// :232/269
    patch_open_dir: struct { err: anyerror, path: []const u8 },
    /// :290 — different format from patch_open_dir (prettyError, includes errname inline)
    patch_open_dir_restore: struct { path: []const u8, err: anyerror },
    /// :329
    patch_getcwd: struct { err: bun.sys.Error },
    /// :339
    patch_git_not_found,
    /// :350/369
    patch_diff_failed: struct { err: anyerror },
    /// :359
    patch_diff_spawn_failed: struct { err: bun.sys.Error },
    /// :392 — stderr is the raw subprocess stderr; truncation reproduced in printForCli
    patch_diff_stderr: struct { stderr: []const u8 },
    /// :427
    patch_temp_open: struct { err: bun.sys.Error },
    /// :435
    patch_temp_write: struct { err: bun.sys.Error },
    /// :462
    patch_mkdir_patches: struct { err: bun.sys.Error, path: []const u8 },
    /// :475
    patch_rename: struct { err: bun.sys.Error },
    /// :740
    patch_overwrite_folder: struct { err: anyerror },
    /// :864
    patch_package_not_found: struct { name_and_version: []const u8 },
    /// :874/892/912/944
    patch_folder_not_found: struct { name_and_version: []const u8 },
    /// :957-978 — header + per-version list
    patch_multiple_versions: struct {
        name: []const u8,
        versions: []const PatchVersionEntry,
    },
    /// patch_install.zig:154
    patch_calc_hash_failed: struct { path: []const u8, silent: bool },

    pub const PatchVersionEntry = struct {
        name: []const u8,
        /// Pre-formatted from `resolution.fmt(strbuf, .posix)`
        resolution: []const u8,
    };

    // ──────────────────────────────────────────────────────────────────────
    // Methods
    // ──────────────────────────────────────────────────────────────────────

    /// Exit code the CLI entry point should pass to Global.exit().
    /// Nearly everything is 1; the escape hatches and lifecycle-script-exited
    /// carry their own.
    pub fn exitCode(self: InstallError) u8 {
        return switch (self) {
            .already_printed => |v| v.exit_code,
            .generic => |v| v.exit_code,
            .lifecycle_script_exited => |v| v.exit_code,
            else => 1,
        };
    }

    /// Write this error to stderr (or stdout, for the two variants that
    /// historically did so) using the exact same Output.* call as the
    /// original call site, then flush. No-op for `.already_printed`.
    pub fn printForCli(self: InstallError) void {
        switch (self) {
            // ── Escape hatches ──────────────────────────────────────────
            .already_printed => {},
            .generic => |v| {
                Output.errorWriter().writeAll(v.message) catch {};
            },

            // ── package.json ────────────────────────────────────────────
            .link_read_package_json => |v| switch (v.action) {
                .linking => Output.errGeneric("failed to read \"{s}\" for linking: {s}", .{ v.path, @errorName(v.err) }),
                .unlinking => Output.errGeneric("failed to read \"{s}\" for unlinking: {s}", .{ v.path, @errorName(v.err) }),
            },
            .package_json_missing_name => |v| {
                if (v.silent) return;
                Output.prettyErrorln("<r><red>error:<r> package.json missing \"name\" <d>in \"{s}\"<r>", .{v.path});
            },
            .package_json_invalid_name => |v| {
                if (v.silent) return;
                Output.prettyErrorln("<r><red>error:<r> invalid package.json name \"{s}\" <d>in \"{s}\"<r>", .{ v.name, v.path });
            },
            .package_json_read_failed => |v| {
                Output.errGeneric("failed to read package.json \"{s}\": {s}", .{ v.path, @errorName(v.err) });
            },
            .package_json_parse_failed => |v| {
                Output.errGeneric("failed to parse package.json \"{s}\": {s}", .{ v.path, @errorName(v.err) });
            },
            .root_package_json_read => |v| {
                Output.err(v.err, "failed to read '{s}'", .{v.path});
            },
            .root_package_json_parse => |v| {
                Output.err(v.err, "failed to parse '{s}'", .{v.path});
            },
            .package_json_parse_in_dir => |v| {
                Output.prettyErrorln("<r><red>{s}<r> parsing package.json in <b>\"{s}\"<r>", .{ @errorName(v.err), v.dir });
            },
            .package_json_read_or_parse_failed => |v| {
                Output.err(v.err, "failed to read/parse package.json at '{s}'", .{v.path});
            },
            .package_json_print_failed => |v| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(v.err)});
            },
            .package_json_reparse_failed => |v| {
                Output.prettyErrorln("package.json failed to parse due to error {s}", .{@errorName(v.err)});
            },
            .package_json_not_object => |v| {
                Output.errGeneric("package.json is not an Object {{}}, so there's nothing to {s}!", .{v.subcommand});
            },
            .package_json_empty_object => |v| {
                Output.errGeneric("package.json is empty {{}}, so there's nothing to {s}!", .{v.subcommand});
            },
            .no_package_json_for_subcommand => |v| switch (v.action) {
                .update => Output.prettyErrorln("<r>No package.json, so nothing to update", .{}),
                .remove => Output.prettyErrorln("<r>No package.json, so nothing to remove", .{}),
                .patch => Output.prettyErrorln("<r>No package.json, so nothing to patch", .{}),
            },
            .dep_package_json_parse_failed => |v| {
                if (v.silent) return;
                Output.err(v.err, "failed to parse package.json for <b>{s}<r>", .{v.resolution_url});
            },
            .dep_package_json_not_json => |v| {
                if (v.silent) return;
                Output.prettyErrorln("<r><red>error:<r> expected package.json in <b>{s}<r> to be a JSON file: {s}\n", .{ v.resolution_url, @errorName(v.err) });
            },

            // ── Lockfile ────────────────────────────────────────────────
            .patch_lockfile_not_found => {
                Output.errGeneric("Cannot find lockfile. Install packages with `<cyan>bun install<r>` before patching them.", .{});
            },
            .outdated_lockfile_not_found => |v| {
                if (v.silent) return;
                Output.errGeneric("missing lockfile, nothing outdated", .{});
            },
            .frozen_lockfile_changed => |v| {
                if (v.silent) return;
                if (v.with_note) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> lockfile had changes, but lockfile is frozen", .{});
                    Output.note("try re-running without <d>--frozen-lockfile<r> and commit the updated lockfile", .{});
                } else {
                    Output.prettyErrorln("<r><red>error<r>: lockfile had changes, but lockfile is frozen", .{});
                }
            },
            .npm_lockfile_version_mismatch => {
                Output.prettyErrorln(
                    \\<red><b>error<r><d>:<r> Please upgrade package-lock.json to lockfileVersion 2 or 3
                    \\
                    \\Run 'npm i --lockfile-version 3 --frozen-lockfile' to upgrade your lockfile without changing dependencies.
                , .{});
            },

            // ── Temp / cache / node_modules / global ────────────────────
            .tempdir_access => |v| {
                Output.prettyErrorln("<r><red>error<r>: bun is unable to access tempdir: {s}", .{@errorName(v.err)});
            },
            .tempdir_write => |v| {
                Output.prettyErrorln("<r><red>error<r>: bun is unable to write files to tempdir: {s}", .{@errorName(v.err)});
            },
            .tempdir_set_env => |v| {
                Output.prettyErrorln("<r><red>error<r>: {s} accessing temporary directory. Please set <b>$BUN_TMPDIR<r> or <b>$BUN_INSTALL<r>", .{@errorName(v.err)});
            },
            .tempdir_path_read => |v| {
                Output.err(v.err, "Failed to read temporary directory path: '{s}'", .{v.path});
            },
            .cache_dir_create => |v| {
                Output.prettyErrorln("<r><red>error<r>: bun is unable to write files: {s}", .{@errorName(v.err)});
            },
            .tmpfile_create => |v| {
                Output.prettyErrorln("<r><red>error:<r> failed to create tmpfile: {s}", .{@errorName(v.err)});
            },
            .global_dir_not_found => {
                Output.errGeneric("failed to find a global directory for package caching and global link directories", .{});
            },
            .global_dir_open => |v| {
                Output.err(v.err, "failed to open the global directory", .{});
            },
            .global_link_dir_open => |v| {
                Output.err(v.err, "failed to open global link dir node_modules at '{s}'", .{v.dir_path});
            },
            .global_dir_path_read => |v| {
                Output.err(v.err, "failed to get the full path of the global directory", .{});
            },
            .global_node_modules_create => |v| {
                if (v.silent) return;
                Output.prettyErrorln("<r><red>error:<r> failed to create node_modules in global dir due to error {s}", .{@errorName(v.err)});
            },
            .global_scope_create => |v| {
                if (v.silent) return;
                Output.prettyErrorln("<r><red>error:<r> failed to create scope in global dir due to error {s}", .{@errorName(v.err)});
            },
            .global_junction_create => |v| {
                Output.prettyErrorln("<r><red>error:<r> failed to create junction to node_modules in global dir due to error {f}", .{v.err});
            },
            .global_symlink_create => |v| {
                if (v.silent) return;
                Output.prettyErrorln("<r><red>error:<r> failed to create symlink to node_modules in global dir due to error {s}", .{@errorName(v.err)});
            },
            .link_binary_fdpath => |v| {
                if (v.silent) return;
                Output.err(v.err, "failed to link binary", .{});
            },
            .link_bin => |v| {
                if (v.silent) return;
                Output.prettyErrorln("<r><red>error:<r> failed to link bin due to error {s}", .{@errorName(v.err)});
            },
            .unlink_delete => |v| {
                if (v.silent) return;
                Output.prettyErrorln("<r><red>error:<r> failed to unlink package in global dir due to error {s}", .{@errorName(v.err)});
            },
            .unlink_with_name_not_implemented => {
                // Historical quirk: this goes to STDOUT via prettyln.
                Output.prettyln("<r><red>error:<r> bun unlink {{packageName}} not implemented yet", .{});
            },
            .node_modules_bin_read => |v| {
                Output.err(v.err, "while reading node_modules/.bin", .{});
            },
            .node_modules_create => |v| {
                Output.err(v.err, "could not create the <b>\"node_modules\"<r> directory", .{});
            },
            .node_modules_open => |v| {
                Output.err(v.err, "could not open the <b>\"node_modules\"<r> directory", .{});
            },
            .isolated_mkdir => |v| {
                Output.err(v.err, "failed to create '{s}'", .{v.path});
            },
            .isolated_install_packages => |v| {
                Output.err(v.err, "failed to install packages", .{});
            },
            .isolated_enqueue_download => |v| switch (v.kind) {
                .package => Output.err(v.err, "failed to enqueue package for download: {s}", .{v.name_and_version}),
                .github => Output.err(v.err, "failed to enqueue github package for download: {s}", .{v.name_and_version}),
                .tarball => Output.err(v.err, "failed to enqueue tarball for download: {s}", .{v.name_and_version}),
            },

            // ── node-gyp shim ───────────────────────────────────────────
            .node_gyp_tempdir_exists => {
                Output.prettyErrorln("<r><red>error<r>: node-gyp tempdir already exists", .{});
            },
            .node_gyp_tempdir_create => |v| {
                Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> creating node-gyp tempdir", .{@errorName(v.err)});
            },
            .node_gyp_file_write => |v| {
                const file_name = switch (Environment.os) {
                    else => "node-gyp",
                    .windows => "node-gyp.cmd",
                };
                Output.prettyErrorln("<r><red>error<r>: <b><red>{s}<r> writing to " ++ file_name ++ " file", .{@errorName(v.err)});
            },

            // ── Permission ──────────────────────────────────────────────
            .install_eacces_package => |v| {
                Output.err("EACCES", "Permission denied while installing <b>{s}<r>", .{v.package_name});
                if (Environment.isDebug) {
                    Output.err(v.debug_err, "Failed to stat node_modules", .{});
                }
            },
            .install_eacces_node_modules => {
                Output.err("EACCES", "Permission denied while writing packages into node_modules.", .{});
            },

            // ── Lifecycle scripts ───────────────────────────────────────
            .lifecycle_script_exited => |v| {
                Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> script from \"<b>{s}<r>\" exited with {d}<r>", .{
                    v.script_name,
                    v.package_name,
                    v.exit_code,
                });
            },
            .lifecycle_script_spawn_failed => |v| {
                if (v.use_err_generic) {
                    Output.errGeneric("Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ v.script_name, @errorName(v.err) });
                } else {
                    Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ v.script_name, @errorName(v.err) });
                }
            },
            .lifecycle_script_sys_error => |v| {
                Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> script from \"<b>{s}<r>\" due to\n{f}", .{
                    v.script_name,
                    v.package_name,
                    v.err,
                });
            },
            .lifecycle_script_unexpected_status => |v| {
                Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> script from \"<b>{s}<r>\" due to unexpected status\n{f}", .{
                    v.script_name,
                    v.package_name,
                    v.status,
                });
            },
            .lifecycle_scripts_fill => |v| {
                if (v.silent) return;
                Output.errGeneric("failed to fill lifecycle scripts for <b>{s}<r>: {s}", .{ v.alias, @errorName(v.err) });
            },

            // ── Security scanner ────────────────────────────────────────
            .security_scanner_failed => |v| switch (v.err) {
                error.SecurityScannerInWorkspace => Output.errGeneric("security scanner cannot be a dependency of a workspace package. It must be a direct dependency of the root package.", .{}),
                error.SecurityScannerRetryFailed => Output.errGeneric("security scanner failed after partial install. This is probably a bug in Bun. Please report it at https://github.com/oven-sh/bun/issues", .{}),
                error.InvalidPackageID => Output.errGeneric("cannot perform partial install: security scanner package ID is invalid", .{}),
                error.PartialInstallFailed => Output.errGeneric("failed to install security scanner package", .{}),
                error.NoPackagesInstalled => Output.errGeneric("no packages were installed during security scanner installation", .{}),
                error.IPCPipeFailed => Output.errGeneric("failed to create IPC pipe for security scanner", .{}),
                error.ProcessWatchFailed => Output.errGeneric("failed to watch security scanner process", .{}),
                else => |e| Output.errGeneric("security scanner failed: {s}", .{@errorName(e)}),
            },
            .security_fatal_advisory => {
                // Historical quirk: this goes to STDOUT via Output.pretty.
                Output.pretty("<red>Installation aborted due to fatal security advisories<r>\n", .{});
            },
            .security_warning_declined => {},

            // ── bun patch ───────────────────────────────────────────────
            .patch_open_root_node_modules => |v| {
                Output.prettyError("<r><red>error<r>: failed to open root <b>node_modules<r> folder: {f}<r>\n", .{v.err});
            },
            .patch_read_package_json => |v| {
                Output.err(v.err, "failed to read {f}", .{bun.fmt.quote(v.path)});
            },
            .patch_missing_version => |v| {
                Output.prettyError("<r><red>error<r>: invalid package.json, missing or invalid property \"version\": {s}<r>\n", .{v.path});
            },
            .patch_lockfile_index_bug => {
                Output.prettyError("<r><red>error<r>: failed to find package in lockfile package index, this is a bug in Bun. Please file a GitHub issue.<r>\n", .{});
            },
            .patch_package_not_found_by_name => |v| {
                Output.prettyError("<r><red>error<r>: could not find package with name:<r> {s}\n<r>", .{v.name});
            },
            .patch_cache_path_read => |v| {
                Output.err(v.err, "failed to read from cache", .{});
            },
            .patch_tmpname => |v| {
                Output.err(v.err, "failed to make tempdir", .{});
            },
            .patch_open_dir => |v| {
                Output.err(v.err, "failed to open directory <b>{s}<r>", .{v.path});
            },
            .patch_open_dir_restore => |v| {
                Output.prettyError("<r><red>error<r>: failed to open directory <b>{s}<r> {s}<r>\n", .{ v.path, @errorName(v.err) });
            },
            .patch_getcwd => |v| {
                Output.prettyError("<r><red>error<r>: failed to get cwd path {f}<r>\n", .{v.err});
            },
            .patch_git_not_found => {
                Output.prettyError("<r><red>error<r>: git must be installed to use `bun patch --commit` <r>\n", .{});
            },
            .patch_diff_failed => |v| {
                Output.prettyError("<r><red>error<r>: failed to make diff {s}<r>\n", .{@errorName(v.err)});
            },
            .patch_diff_spawn_failed => |v| {
                Output.prettyError("<r><red>error<r>: failed to make diff {f}<r>\n", .{v.err});
            },
            .patch_diff_stderr => |v| {
                const Truncate = struct {
                    stderr: []const u8,
                    pub fn format(this: *const @This(), writer: *std.Io.Writer) !void {
                        const truncate_stderr = this.stderr.len > 256;
                        if (truncate_stderr) {
                            try writer.print("{s}... ({d} more bytes)", .{ this.stderr[0..256], this.stderr.len - 256 });
                        } else try writer.print("{s}", .{this.stderr[0..]});
                    }
                };
                Output.prettyError("<r><red>error<r>: failed to make diff {f}<r>\n", .{Truncate{ .stderr = v.stderr }});
            },
            .patch_temp_open => |v| {
                Output.err(v.err, "failed to open temp file", .{});
            },
            .patch_temp_write => |v| {
                Output.err(v.err, "failed to write patch to temp file", .{});
            },
            .patch_mkdir_patches => |v| {
                Output.err(v.err, "failed to make patches dir {f}", .{bun.fmt.quote(v.path)});
            },
            .patch_rename => |v| {
                Output.err(v.err, "failed renaming patch file to patches dir", .{});
            },
            .patch_overwrite_folder => |v| {
                Output.prettyError("<r><red>error<r>: error overwriting folder in node_modules: {s}\n<r>", .{@errorName(v.err)});
            },
            .patch_package_not_found => |v| {
                Output.prettyErrorln("\n<r><red>error<r>: package <b>{s}<r> not found<r>", .{v.name_and_version});
            },
            .patch_folder_not_found => |v| {
                Output.prettyError("<r><red>error<r>: could not find the folder for <b>{s}<r> in node_modules<r>\n<r>", .{v.name_and_version});
            },
            .patch_multiple_versions => |v| {
                Output.prettyErrorln("\n<r><red>error<r>: Found multiple versions of <b>{s}<r>, please specify a precise version from the following list:<r>\n", .{v.name});
                for (v.versions) |ver| {
                    Output.prettyError("  {s}@<blue>{s}<r>\n", .{ ver.name, ver.resolution });
                }
            },
            .patch_calc_hash_failed => |v| {
                if (v.silent) return;
                Output.errGeneric("Failed to calculate hash for patch <b>{s}<r>", .{v.path});
            },
        }
        Output.flush();
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
