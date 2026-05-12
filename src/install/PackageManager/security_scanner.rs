use crate::lockfile::package::PackageColumns as _;
use bun_collections::{ByteVecExt, VecExt};
use std::collections::VecDeque;
use std::io::Write as _;

use bstr::BStr;

// PORT NOTE: `BufferedReaderParent::loop_` is typed `*mut bun_uws::Loop` (the
// uws wrapper — `WindowsLoop` on Windows, `PosixLoop` on POSIX), not
// `bun_io::Loop` is the trait's nominal: `us_loop_t` on POSIX, `uv_loop_t`
// on Windows. The inherent `loop_()` projects `.uv_loop` from the uws wrapper
// on Windows so `BufferedReaderParent::loop_` returns the libuv loop directly.
use crate::bun_fs::FileSystem;
use crate::bun_json::{Expr, ExprData};
use crate::package_manager_real::Command::Context as CommandContext;
use bun_collections::ArrayHashMap;
use bun_core::strings;
use bun_core::{self, Error, Output, err};
use bun_event_loop::{AnyEventLoop, EventLoopHandle};
use bun_install::{
    DependencyID, PackageID, PackageManager, invalid_dependency_id, invalid_package_id,
};
use bun_io::Loop as AsyncLoop;
use bun_io::pipe_reader::PosixFlags;
use bun_io::{BufferedReader, ReadState};
use bun_ptr::{RefPtr, ThreadSafeRefCount};
use bun_spawn::subprocess::{self, StdioResult};
use bun_spawn::{
    self as spawn, Exited, Process, ProcessExit, ProcessExitKind, Rusage, SpawnOptions,
    SpawnResultExt as _, Status, Stdio,
};
use bun_sys::{self, Fd, FdExt as _};

use crate::hoisted_install as HoistedInstall;
use crate::isolated_install as IsolatedInstall;
use crate::package_manager_real::install_with_manager as InstallWithManager;
use crate::package_manager_real::package_manager_options::Do;

/// Zig `@tagName(sig)` for `bun.SignalCode` (non-exhaustive `enum(u8)`).
/// `Status::Signaled` carries the raw byte; named range 1..=31 maps via
/// `SignalCode::name()`, RT/out-of-range values fall back to "UNKNOWN".
#[inline]
fn signal_name(raw: u8) -> &'static str {
    bun_sys::SignalCode(raw).name().unwrap_or("UNKNOWN")
}

pub struct PackagePath {
    pkg_path: Box<[PackageID]>,
    dep_path: Box<[DependencyID]>,
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum SecurityAdvisoryLevel {
    Fatal,
    Warn,
}

pub struct SecurityAdvisory {
    pub level: SecurityAdvisoryLevel,
    pub package: Box<[u8]>,
    pub url: Option<Box<[u8]>>,
    pub description: Option<Box<[u8]>>,
    pub pkg_path: Option<Box<[PackageID]>>,
}

pub struct SecurityScanResults {
    pub advisories: Box<[SecurityAdvisory]>,
    pub fatal_count: usize,
    pub warn_count: usize,
    pub packages_scanned: usize,
    pub duration_ms: i64,
    // TODO(port): Zig borrows this from manager.options.security_scanner; using Box<[u8]> to avoid
    // a struct lifetime in Phase A. Revisit if the copy matters.
    pub security_scanner: Box<[u8]>,
}

// Zig `deinit` only freed owned fields; Rust drops Box fields automatically — no explicit Drop.

impl SecurityScanResults {
    pub fn has_fatal_advisories(&self) -> bool {
        self.fatal_count > 0
    }

    pub fn has_warnings(&self) -> bool {
        self.warn_count > 0
    }

    pub fn has_advisories(&self) -> bool {
        !self.advisories.is_empty()
    }
}

pub fn do_partial_install_of_security_scanner(
    manager: &mut PackageManager,
    ctx: CommandContext,
    log_level: crate::package_manager::Options::LogLevel,
    security_scanner_pkg_id: PackageID,
    original_cwd: &[u8],
) -> Result<(), Error> {
    // TODO(port): narrow error set
    let (workspace_filters, install_root_dependencies) =
        InstallWithManager::get_workspace_filters(manager, original_cwd)?;
    // `defer manager.allocator.free(workspace_filters)` — workspace_filters is now owned, drops at scope exit.

    if !manager.options.do_.contains(Do::INSTALL_PACKAGES) {
        return Ok(());
    }

    if security_scanner_pkg_id == invalid_package_id {
        return Err(err!("InvalidPackageID"));
    }

    let packages_to_install: Option<&[PackageID]> = Some(&[security_scanner_pkg_id]);

    let summary = match manager.options.node_linker {
        bun_install_types::NodeLinker::NodeLinker::Hoisted
        // TODO
        | bun_install_types::NodeLinker::NodeLinker::Auto => {
            HoistedInstall::install_hoisted_packages(
                manager,
                ctx,
                &workspace_filters,
                install_root_dependencies,
                log_level,
                packages_to_install,
            )?
        }
        bun_install_types::NodeLinker::NodeLinker::Isolated => {
            IsolatedInstall::install_isolated_packages(
                manager,
                ctx,
                install_root_dependencies,
                &workspace_filters,
                packages_to_install,
            )?
        }
    };

    if cfg!(debug_assertions) {
        Output::debug_warn(format_args!(
            "Partial install summary - success: {}, fail: {}, skipped: {}",
            summary.success, summary.fail, summary.skipped
        ));
    }

    if summary.fail > 0 {
        return Err(err!("PartialInstallFailed"));
    }

    if summary.success == 0 && summary.skipped == 0 {
        return Err(err!("NoPackagesInstalled"));
    }

    Ok(())
}

pub enum ScanAttemptResult {
    Success(SecurityScanResults),
    NeedsInstall(PackageID),
    Error(Error),
}

struct ScannerFinder<'a> {
    manager: &'a PackageManager,
    scanner_name: &'a [u8],
}

impl<'a> ScannerFinder<'a> {
    pub fn find_in_root_dependencies(&self) -> Option<PackageID> {
        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_dependencies = pkgs.items_dependencies();
        let pkg_resolutions = pkgs.items_resolution();
        let string_buf = self.manager.lockfile.buffers.string_bytes.as_slice();

        let root_pkg_id: PackageID = 0;
        let root_deps = pkg_dependencies[root_pkg_id as usize];

        for _dep_id in root_deps.begin()..root_deps.end() {
            let dep_id: DependencyID = DependencyID::try_from(_dep_id).expect("int cast");
            let dep_pkg_id = self.manager.lockfile.buffers.resolutions[dep_id as usize];

            if dep_pkg_id == invalid_package_id {
                continue;
            }

            let dep_res = &pkg_resolutions[dep_pkg_id as usize];
            if dep_res.tag != bun_install::resolution::Tag::Npm {
                continue;
            }

            let dep_name = self.manager.lockfile.buffers.dependencies[dep_id as usize].name;
            if dep_name.slice(string_buf) == self.scanner_name {
                return Some(dep_pkg_id);
            }
        }

        None
    }

    pub fn validate_not_in_workspaces(&self) -> Result<(), Error> {
        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_deps = pkgs.items_dependencies();
        let pkg_res = pkgs.items_resolution();
        let string_buf = self.manager.lockfile.buffers.string_bytes.as_slice();

        for pkg_idx in 0..pkgs.len() {
            if pkg_res[pkg_idx].tag != bun_install::resolution::Tag::Workspace {
                continue;
            }

            let deps = pkg_deps[pkg_idx];
            for _dep_id in deps.begin()..deps.end() {
                let dep_id: DependencyID = DependencyID::try_from(_dep_id).expect("int cast");
                let dep = &self.manager.lockfile.buffers.dependencies[dep_id as usize];

                if dep.name.slice(string_buf) == self.scanner_name {
                    return Err(err!("SecurityScannerInWorkspace"));
                }
            }
        }

        Ok(())
    }
}

pub fn perform_security_scan_after_resolution(
    manager: &mut PackageManager,
    command_ctx: CommandContext,
    original_cwd: &[u8],
) -> Result<Option<SecurityScanResults>, Error> {
    let Some(security_scanner) = manager.options.security_scanner.clone() else {
        return Ok(None);
    };

    if manager.options.dry_run || !manager.options.do_.contains(Do::INSTALL_PACKAGES) {
        return Ok(None);
    }

    // For remove/uninstall, scan all remaining packages after removal
    // For other commands, scan all if no update requests, otherwise scan update packages
    let scan_all =
        manager.subcommand == bun_install::Subcommand::Remove || manager.update_requests.is_empty();
    let result = attempt_security_scan(
        manager,
        &security_scanner,
        scan_all,
        command_ctx,
        original_cwd,
    )?;

    match result {
        ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
        ScanAttemptResult::NeedsInstall(pkg_id) => {
            Output::prettyln(format_args!(
                "<r><yellow>Attempting to install security scanner from npm...<r>"
            ));
            let log_level = manager.options.log_level;
            do_partial_install_of_security_scanner(
                manager,
                command_ctx,
                log_level,
                pkg_id,
                original_cwd,
            )?;
            Output::prettyln(format_args!(
                "<r><green><b>Security scanner installed successfully.<r>"
            ));

            let retry_result = attempt_security_scan_with_retry(
                manager,
                &security_scanner,
                scan_all,
                command_ctx,
                original_cwd,
                true,
            )?;
            match retry_result {
                ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
                ScanAttemptResult::NeedsInstall(_) => Err(err!("SecurityScannerRetryFailed")),
                ScanAttemptResult::Error(e) => Err(e),
            }
        }
        ScanAttemptResult::Error(e) => Err(e),
    }
}

pub fn perform_security_scan_for_all(
    manager: &mut PackageManager,
    command_ctx: CommandContext,
    original_cwd: &[u8],
) -> Result<Option<SecurityScanResults>, Error> {
    let Some(security_scanner) = manager.options.security_scanner.clone() else {
        return Ok(None);
    };

    let result =
        attempt_security_scan(manager, &security_scanner, true, command_ctx, original_cwd)?;
    match result {
        ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
        ScanAttemptResult::NeedsInstall(pkg_id) => {
            Output::prettyln(format_args!(
                "<r><yellow>Attempting to install security scanner from npm...<r>"
            ));
            let log_level = manager.options.log_level;
            do_partial_install_of_security_scanner(
                manager,
                command_ctx,
                log_level,
                pkg_id,
                original_cwd,
            )?;
            Output::prettyln(format_args!(
                "<r><green><b>Security scanner installed successfully.<r>"
            ));

            let retry_result = attempt_security_scan_with_retry(
                manager,
                &security_scanner,
                true,
                command_ctx,
                original_cwd,
                true,
            )?;
            match retry_result {
                ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
                ScanAttemptResult::NeedsInstall(_) => Err(err!("SecurityScannerRetryFailed")),
                ScanAttemptResult::Error(e) => Err(e),
            }
        }
        ScanAttemptResult::Error(e) => Err(e),
    }
}

pub fn print_security_advisories(manager: &PackageManager, results: &SecurityScanResults) {
    if !results.has_advisories() {
        return;
    }

    let pkgs = manager.lockfile.packages.slice();
    let pkg_names = pkgs.items_name();
    let string_buf = manager.lockfile.buffers.string_bytes.as_slice();

    for advisory in results.advisories.iter() {
        Output::print(format_args!("\n"));

        match advisory.level {
            SecurityAdvisoryLevel::Fatal => {
                Output::pretty(format_args!(
                    "  <red>FATAL<r>: {}\n",
                    BStr::new(&advisory.package)
                ));
            }
            SecurityAdvisoryLevel::Warn => {
                Output::pretty(format_args!(
                    "  <yellow>WARNING<r>: {}\n",
                    BStr::new(&advisory.package)
                ));
            }
        }

        if let Some(pkg_path) = &advisory.pkg_path {
            if pkg_path.len() > 1 {
                Output::pretty(format_args!("    <d>via "));
                for (idx, ancestor_id) in pkg_path[0..pkg_path.len() - 1].iter().enumerate() {
                    if idx > 0 {
                        Output::pretty(format_args!(" › "));
                    }
                    let ancestor_name = pkg_names[*ancestor_id as usize].slice(string_buf);
                    Output::pretty(format_args!("{}", BStr::new(ancestor_name)));
                }
                Output::pretty(format_args!(
                    " › <red>{}<r>\n",
                    BStr::new(&advisory.package)
                ));
            } else {
                Output::pretty(format_args!("    <d>(direct dependency)<r>\n"));
            }
        }

        if let Some(desc) = &advisory.description {
            if !desc.is_empty() {
                Output::pretty(format_args!("    {}\n", BStr::new(desc)));
            }
        }
        if let Some(url) = &advisory.url {
            if !url.is_empty() {
                Output::pretty(format_args!("    <cyan>{}<r>\n", BStr::new(url)));
            }
        }
    }

    Output::print(format_args!("\n"));
    let total = results.fatal_count + results.warn_count;
    if total == 1 {
        if results.fatal_count == 1 {
            Output::pretty(format_args!("<b>1 advisory (<red>1 fatal<r>)<r>\n"));
        } else {
            Output::pretty(format_args!("<b>1 advisory (<yellow>1 warning<r>)<r>\n"));
        }
    } else {
        if results.fatal_count > 0 && results.warn_count > 0 {
            Output::pretty(format_args!(
                "<b>{} advisories (<red>{} fatal<r>, <yellow>{} warning{}<r>)<r>\n",
                total,
                results.fatal_count,
                results.warn_count,
                if results.warn_count == 1 { "" } else { "s" }
            ));
        } else if results.fatal_count > 0 {
            Output::pretty(format_args!(
                "<b>{} advisories (<red>{} fatal<r>)<r>\n",
                total, results.fatal_count
            ));
        } else {
            Output::pretty(format_args!(
                "<b>{} advisories (<yellow>{} warning{}<r>)<r>\n",
                total,
                results.warn_count,
                if results.warn_count == 1 { "" } else { "s" }
            ));
        }
    }
}

pub fn prompt_for_warnings() -> bool {
    let can_prompt = Output::is_stdin_tty();

    if !can_prompt {
        Output::pretty(format_args!(
            "\n<red>Security warnings found. Cannot prompt for confirmation (no TTY).<r>\n"
        ));
        Output::pretty(format_args!("<red>Installation cancelled.<r>\n"));
        return false;
    }

    Output::pretty(format_args!(
        "\n<yellow>Security warnings found.<r> Continue anyway? [y/N] "
    ));
    Output::flush();

    // TODO(port): Zig used std.fs.File.stdin().readerStreaming(); use bun_core stdin reader.
    let mut reader = bun_core::output::stdin_reader();

    let Ok(first_byte) = reader.take_byte() else {
        Output::pretty(format_args!("\n<red>Installation cancelled.<r>\n"));
        return false;
    };

    let should_continue = match first_byte {
        b'\n' => false,
        b'\r' => 'blk: {
            let Ok(next_byte) = reader.take_byte() else {
                break 'blk false;
            };
            break 'blk next_byte == b'\n' && false;
        }
        b'y' | b'Y' => 'blk: {
            let Ok(next_byte) = reader.take_byte() else {
                break 'blk false;
            };
            if next_byte == b'\n' {
                break 'blk true;
            } else if next_byte == b'\r' {
                let Ok(second_byte) = reader.take_byte() else {
                    break 'blk false;
                };
                break 'blk second_byte == b'\n';
            }
            break 'blk false;
        }
        _ => 'blk: {
            while let Ok(b) = reader.take_byte() {
                if b == b'\n' || b == b'\r' {
                    break;
                }
            }
            break 'blk false;
        }
    };

    if !should_continue {
        Output::pretty(format_args!("\n<red>Installation cancelled.<r>\n"));
        return false;
    }

    Output::pretty(format_args!(
        "\n<yellow>Continuing with installation...<r>\n\n"
    ));
    true
}

struct PackageCollector<'a> {
    manager: &'a PackageManager,
    dedupe: ArrayHashMap<PackageID, ()>,
    // TODO(port): Zig uses bun.LinearFifo(QueueItem, .Dynamic); VecDeque is the closest std equivalent.
    queue: VecDeque<QueueItem>,
    package_paths: ArrayHashMap<PackageID, PackagePath>,
}

struct QueueItem {
    pkg_id: PackageID,
    dep_id: DependencyID,
    pkg_path: Vec<PackageID>,
    dep_path: Vec<DependencyID>,
}

impl<'a> PackageCollector<'a> {
    pub fn init(manager: &'a PackageManager) -> Self {
        Self {
            manager,
            dedupe: ArrayHashMap::new(),
            queue: VecDeque::new(),
            package_paths: ArrayHashMap::new(),
        }
    }

    // Zig `deinit` only freed owned fields; Rust drops them automatically.

    pub fn collect_all_packages(&mut self) -> Result<(), Error> {
        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_dependencies = pkgs.items_dependencies();
        let pkg_resolutions = pkgs.items_resolution();

        let root_pkg_id: PackageID = 0;
        let root_deps = pkg_dependencies[root_pkg_id as usize];

        // collect all npm deps from the root package
        for _dep_id in root_deps.begin()..root_deps.end() {
            let dep_id: DependencyID = DependencyID::try_from(_dep_id).expect("int cast");
            let dep_pkg_id = self.manager.lockfile.buffers.resolutions[dep_id as usize];

            if dep_pkg_id == invalid_package_id {
                continue;
            }

            let dep_res = &pkg_resolutions[dep_pkg_id as usize];
            if dep_res.tag != bun_install::resolution::Tag::Npm {
                continue;
            }

            if self.dedupe.get_or_put(dep_pkg_id)?.found_existing {
                continue;
            }

            let mut pkg_path_buf: Vec<PackageID> = Vec::new();
            pkg_path_buf.push(root_pkg_id);
            pkg_path_buf.push(dep_pkg_id);

            let mut dep_path_buf: Vec<DependencyID> = Vec::new();
            dep_path_buf.push(dep_id);

            self.queue.push_back(QueueItem {
                pkg_id: dep_pkg_id,
                dep_id,
                pkg_path: pkg_path_buf,
                dep_path: dep_path_buf,
            });
        }

        // and collect npm deps from workspace packages
        for pkg_idx in 0..pkgs.len() {
            let pkg_id: PackageID = PackageID::try_from(pkg_idx).expect("int cast");
            if pkg_resolutions[pkg_id as usize].tag != bun_install::resolution::Tag::Workspace {
                continue;
            }

            let workspace_deps = pkg_dependencies[pkg_id as usize];
            for _dep_id in workspace_deps.begin()..workspace_deps.end() {
                let dep_id: DependencyID = DependencyID::try_from(_dep_id).expect("int cast");
                let dep_pkg_id = self.manager.lockfile.buffers.resolutions[dep_id as usize];

                if dep_pkg_id == invalid_package_id {
                    continue;
                }

                let dep_res = &pkg_resolutions[dep_pkg_id as usize];
                if dep_res.tag != bun_install::resolution::Tag::Npm {
                    continue;
                }

                if self.dedupe.get_or_put(dep_pkg_id)?.found_existing {
                    continue;
                }

                let mut pkg_path_buf: Vec<PackageID> = Vec::new();
                pkg_path_buf.push(pkg_id);
                pkg_path_buf.push(dep_pkg_id);

                let mut dep_path_buf: Vec<DependencyID> = Vec::new();
                dep_path_buf.push(dep_id);

                self.queue.push_back(QueueItem {
                    pkg_id: dep_pkg_id,
                    dep_id,
                    pkg_path: pkg_path_buf,
                    dep_path: dep_path_buf,
                });
            }
        }

        Ok(())
    }

    pub fn collect_update_packages(&mut self) -> Result<(), Error> {
        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_resolutions = pkgs.items_resolution();
        let pkg_dependencies = pkgs.items_dependencies();

        for req in self.manager.update_requests.iter() {
            for _update_pkg_id in 0..pkgs.len() {
                let update_pkg_id: PackageID =
                    PackageID::try_from(_update_pkg_id).expect("int cast");
                if update_pkg_id != req.package_id {
                    continue;
                }
                if pkg_resolutions[update_pkg_id as usize].tag != bun_install::resolution::Tag::Npm
                {
                    continue;
                }

                let mut update_dep_id: DependencyID = invalid_dependency_id;
                let mut parent_pkg_id: PackageID = invalid_package_id;

                'update_dep_id: for _pkg_id in 0..pkgs.len() {
                    let pkg_id: PackageID = PackageID::try_from(_pkg_id).expect("int cast");
                    let pkg_res = &pkg_resolutions[pkg_id as usize];
                    if pkg_res.tag != bun_install::resolution::Tag::Root
                        && pkg_res.tag != bun_install::resolution::Tag::Workspace
                    {
                        continue;
                    }

                    let pkg_deps = pkg_dependencies[pkg_id as usize];
                    for _dep_id in pkg_deps.begin()..pkg_deps.end() {
                        let dep_id: DependencyID =
                            DependencyID::try_from(_dep_id).expect("int cast");
                        let dep_pkg_id = self.manager.lockfile.buffers.resolutions[dep_id as usize];
                        if dep_pkg_id == invalid_package_id {
                            continue;
                        }
                        if dep_pkg_id != update_pkg_id {
                            continue;
                        }

                        update_dep_id = dep_id;
                        parent_pkg_id = pkg_id;
                        break 'update_dep_id;
                    }
                }

                if update_dep_id == invalid_dependency_id {
                    continue;
                }
                if self.dedupe.get_or_put(update_pkg_id)?.found_existing {
                    continue;
                }

                let mut initial_pkg_path: Vec<PackageID> = Vec::new();
                if parent_pkg_id != invalid_package_id {
                    initial_pkg_path.push(parent_pkg_id);
                }
                initial_pkg_path.push(update_pkg_id);

                let mut initial_dep_path: Vec<DependencyID> = Vec::new();
                initial_dep_path.push(update_dep_id);

                self.queue.push_back(QueueItem {
                    pkg_id: update_pkg_id,
                    dep_id: update_dep_id,
                    pkg_path: initial_pkg_path,
                    dep_path: initial_dep_path,
                });
            }
        }

        Ok(())
    }

    pub fn process_queue(&mut self) -> Result<(), Error> {
        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_resolutions = pkgs.items_resolution();
        let pkg_dependencies = pkgs.items_dependencies();

        while let Some(item) = self.queue.pop_front() {
            // `defer mutable_item.{pkg,dep}_path.deinit(...)` — Vec drops at end of loop body.

            let pkg_id = item.pkg_id;
            let _ = item.dep_id; // Could be useful in the future for dependency-specific processing

            let pkg_path_copy: Box<[PackageID]> = item.pkg_path.clone().into_boxed_slice();
            let dep_path_copy: Box<[DependencyID]> = item.dep_path.clone().into_boxed_slice();

            self.package_paths.put(
                pkg_id,
                PackagePath {
                    pkg_path: pkg_path_copy,
                    dep_path: dep_path_copy,
                },
            )?;

            let pkg_deps = pkg_dependencies[pkg_id as usize];
            for _next_dep_id in pkg_deps.begin()..pkg_deps.end() {
                let next_dep_id: DependencyID =
                    DependencyID::try_from(_next_dep_id).expect("int cast");
                let next_pkg_id = self.manager.lockfile.buffers.resolutions[next_dep_id as usize];

                if next_pkg_id == invalid_package_id {
                    continue;
                }

                let next_pkg_res = &pkg_resolutions[next_pkg_id as usize];
                if next_pkg_res.tag != bun_install::resolution::Tag::Npm {
                    continue;
                }

                if self.dedupe.get_or_put(next_pkg_id)?.found_existing {
                    continue;
                }

                let mut extended_pkg_path: Vec<PackageID> = Vec::new();
                extended_pkg_path.extend_from_slice(&item.pkg_path);
                extended_pkg_path.push(next_pkg_id);

                let mut extended_dep_path: Vec<DependencyID> = Vec::new();
                extended_dep_path.extend_from_slice(&item.dep_path);
                extended_dep_path.push(next_dep_id);

                self.queue.push_back(QueueItem {
                    pkg_id: next_pkg_id,
                    dep_id: next_dep_id,
                    pkg_path: extended_pkg_path,
                    dep_path: extended_dep_path,
                });
            }
        }

        Ok(())
    }
}

struct JSONBuilder<'a> {
    manager: &'a PackageManager,
    collector: &'a PackageCollector<'a>,
}

impl<'a> JSONBuilder<'a> {
    pub fn build_package_json(&self) -> Result<Box<[u8]>, Error> {
        let mut json_buf: Vec<u8> = Vec::new();

        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions = pkgs.items_resolution();
        let string_buf = self.manager.lockfile.buffers.string_bytes.as_slice();
        let json_opts = bun_core::fmt::JSONFormatterUTF8Options::default();

        json_buf.extend_from_slice(b"[\n");

        let mut first = true;
        // PORT NOTE: `ArrayHashMap::iterator()` takes `&mut self`, but we only
        // need shared access. Iterate by index over the parallel key/value
        // slices instead (insertion-ordered, matches Zig's `iterator()`).
        let path_keys = self.collector.package_paths.keys();
        let path_values = self.collector.package_paths.values();
        for (i, pkg_id) in path_keys.iter().enumerate() {
            let pkg_id = *pkg_id;
            let paths = &path_values[i];

            let dep_id = if !paths.dep_path.is_empty() {
                paths.dep_path[paths.dep_path.len() - 1]
            } else {
                invalid_dependency_id
            };

            let pkg_name = pkg_names[pkg_id as usize];
            let pkg_res = &pkg_resolutions[pkg_id as usize];

            if !first {
                json_buf.extend_from_slice(b",\n");
            }

            // SAFETY: `PackageCollector::collect_packages_from_root` only inserts
            // packages whose resolution tag is `Tag::Npm` into `package_paths`,
            // so the `npm` union variant is the active field here.
            let npm = pkg_res.npm();
            if dep_id == invalid_dependency_id {
                write!(
                    &mut json_buf,
                    "  {{\n    \"name\": {},\n    \"version\": \"{}\",\n    \"requestedRange\": \"{}\",\n    \"tarball\": {}\n  }}",
                    bun_core::fmt::format_json_string_utf8(pkg_name.slice(string_buf), json_opts),
                    npm.version.fmt(string_buf),
                    npm.version.fmt(string_buf),
                    bun_core::fmt::format_json_string_utf8(npm.url.slice(string_buf), json_opts),
                )?;
            } else {
                let dep_version =
                    &self.manager.lockfile.buffers.dependencies[dep_id as usize].version;
                write!(
                    &mut json_buf,
                    "  {{\n    \"name\": {},\n    \"version\": \"{}\",\n    \"requestedRange\": {},\n    \"tarball\": {}\n  }}",
                    bun_core::fmt::format_json_string_utf8(pkg_name.slice(string_buf), json_opts),
                    npm.version.fmt(string_buf),
                    bun_core::fmt::format_json_string_utf8(
                        dep_version.literal.slice(string_buf),
                        json_opts
                    ),
                    bun_core::fmt::format_json_string_utf8(npm.url.slice(string_buf), json_opts),
                )?;
            }

            first = false;
        }

        json_buf.extend_from_slice(b"\n]");
        Ok(json_buf.into_boxed_slice())
    }
}

// Security scanner subprocess entry point - uses IPC protocol for communication
// Note: scanner-entry.ts must be in JavaScriptSources.txt for the build
// scanner-entry.d.ts is NOT included in the build (type definitions only)
const SCANNER_ENTRY_SOURCE: &[u8] = include_bytes!("./scanner-entry.ts");

fn attempt_security_scan(
    manager: &mut PackageManager,
    security_scanner: &[u8],
    scan_all: bool,
    command_ctx: CommandContext,
    original_cwd: &[u8],
) -> Result<ScanAttemptResult, Error> {
    attempt_security_scan_with_retry(
        manager,
        security_scanner,
        scan_all,
        command_ctx,
        original_cwd,
        false,
    )
}

fn attempt_security_scan_with_retry(
    manager: &mut PackageManager,
    security_scanner: &[u8],
    scan_all: bool,
    command_ctx: CommandContext,
    original_cwd: &[u8],
    is_retry: bool,
) -> Result<ScanAttemptResult, Error> {
    if manager.options.log_level == crate::package_manager::Options::LogLevel::Verbose {
        Output::pretty_errorln(format_args!(
            "<d>[SecurityProvider]<r> Running at '{}'",
            BStr::new(security_scanner)
        ));
        Output::pretty_errorln(format_args!(
            "<d>[SecurityProvider]<r> top_level_dir: '{}'",
            BStr::new(FileSystem::instance().top_level_dir())
        ));
        Output::pretty_errorln(format_args!(
            "<d>[SecurityProvider]<r> original_cwd: '{}'",
            BStr::new(original_cwd)
        ));
    }
    // TODO(port): std.time.milliTimestamp() — use bun_core::time helper or std::time::Instant.
    let start_time = bun_core::time::milli_timestamp();

    let finder = ScannerFinder {
        manager,
        scanner_name: security_scanner,
    };
    finder.validate_not_in_workspaces()?;

    // After a partial install, the package might exist but not be in the lockfile yet
    // In that case, we'll get null here but should still try to run the scanner
    let security_scanner_pkg_id = finder.find_in_root_dependencies();
    // Suppress JavaScript error output unless in verbose mode
    let suppress_error_output =
        manager.options.log_level != crate::package_manager::Options::LogLevel::Verbose;

    let mut collector = PackageCollector::init(manager);

    if scan_all {
        collector.collect_all_packages()?;
    } else {
        collector.collect_update_packages()?;
    }

    collector.process_queue()?;

    let json_builder = JSONBuilder {
        manager,
        collector: &collector,
    };
    let json_data = json_builder.build_package_json()?;
    // `defer manager.allocator.free(json_data)` — Box<[u8]> drops at scope exit.

    // PORT NOTE: destructure `collector` here to release its `&PackageManager`
    // borrow before constructing `SecurityScanSubprocess` (which needs `&mut`).
    // Only `package_paths` and the dedupe count are read past this point.
    let PackageCollector {
        dedupe,
        package_paths,
        ..
    } = collector;
    let mut package_paths = package_paths;
    let packages_scanned = dedupe.count();

    let mut code: Vec<u8> = Vec::new();

    let mut temp_source: &[u8] = SCANNER_ENTRY_SOURCE;

    let scanner_placeholder: &[u8] = b"__SCANNER_MODULE__";
    if let Some(index) = strings::index_of(temp_source, scanner_placeholder) {
        code.extend_from_slice(&temp_source[0..index]);
        code.extend_from_slice(security_scanner);
        code.extend_from_slice(&temp_source[index + scanner_placeholder.len()..]);
        temp_source = code.as_slice();
    }

    let suppress_placeholder: &[u8] = b"__SUPPRESS_ERROR__";
    if let Some(index) = strings::index_of(temp_source, suppress_placeholder) {
        let mut new_code: Vec<u8> = Vec::new();
        new_code.extend_from_slice(&temp_source[0..index]);
        new_code.extend_from_slice(if suppress_error_output {
            b"true"
        } else {
            b"false"
        });
        new_code.extend_from_slice(&temp_source[index + suppress_placeholder.len()..]);
        // PORT NOTE: reshaped for borrowck — drop borrow of `code` (via `temp_source`) before reassigning.
        code = new_code;
    }

    let event_loop_handle = EventLoopHandle::from_any(&mut manager.event_loop);
    let mut scanner = Box::new(SecurityScanSubprocess {
        manager,
        event_loop_handle,
        code: Box::<[u8]>::from(code.as_slice()),
        json_data: Box::<[u8]>::from(&*json_data),
        process: None,
        ipc_reader: BufferedReader::init::<SecurityScanSubprocess>(),
        ipc_data: Vec::new(),
        stderr_data: Vec::new(),
        has_process_exited: false,
        has_received_ipc: false,
        exit_status: None,
        remaining_fds: 0,
        json_writer: None,
    });
    // Cleanup of code/json_data/process handled by `Drop for SecurityScanSubprocess` when Box drops.

    scanner.spawn()?;

    // PORT NOTE: Zig used a local `struct { scanner, isDone }` closure for sleepUntil.
    // `sleep_until` now takes `*mut PackageManager` + `fn(&mut C) -> bool`; pass the
    // boxed scanner as the closure context and a fn pointer that probes `is_done`.
    fn scanner_is_done(scanner: &mut Box<SecurityScanSubprocess>) -> bool {
        scanner.is_done()
    }
    // SAFETY: `scanner.manager` is the live exclusive `&mut PackageManager`
    // borrow held by the subprocess; `sleep_until` + `tick_raw` hold no
    // `&mut PackageManager` across `scanner_is_done`.
    let mgr: *mut PackageManager = scanner.manager;
    unsafe { PackageManager::sleep_until(mgr, &mut scanner, scanner_is_done) };

    scanner.handle_results(
        &mut package_paths,
        start_time,
        packages_scanned,
        security_scanner,
        security_scanner_pkg_id,
        command_ctx,
        original_cwd,
        is_retry,
    )
}

pub struct SecurityScanSubprocess<'a> {
    manager: &'a mut PackageManager,
    /// Stable storage for the io-layer opaque `bun_io::EventLoopHandle`
    /// (which carries `*const EventLoopHandle`). `manager.event_loop` is an
    /// `AnyEventLoop` — different layout — so its address is NOT a valid
    /// substitute. Mirrors the pattern in `StaticPipeWriter::io_evtloop`.
    event_loop_handle: EventLoopHandle,
    code: Box<[u8]>,
    json_data: Box<[u8]>,
    /// Intrusive `*mut Process` (Zig `?*Process`). `Process` is
    /// `ThreadSafeRefCounted` and Box-allocated by `to_process`; wrapping in
    /// `Arc` would be UB (no `ArcInner` header). We hold one ref and `deref()`
    /// it in `Drop`.
    process: Option<*mut Process>,
    ipc_reader: BufferedReader,
    ipc_data: Vec<u8>,
    stderr_data: Vec<u8>,
    has_process_exited: bool,
    has_received_ipc: bool,
    exit_status: Option<Status>,
    remaining_fds: i8,
    /// Intrusive `RefPtr` (Zig `?*StaticPipeWriter`). `StaticPipeWriter<P>` is
    /// `RefCounted`; `Rc` would double-count against the embedded refcount.
    json_writer: Option<RefPtr<StaticPipeWriter>>,
}

// Zig: `pub const StaticPipeWriter = jsc.Subprocess.NewStaticPipeWriter(@This());`
// The comptime type generator is the generic `subprocess::StaticPipeWriter<P>`;
// monomorphize on `'static` because the writer stores `*mut P` (raw backref —
// lifetime is erased anyway) and the type alias must name a concrete `P`.
pub type StaticPipeWriter = subprocess::StaticPipeWriter<SecurityScanSubprocess<'static>>;

// Wire the writer's `on_close` callback back to this type. Raw `*mut Self`
// because the call is re-entrant: it may fire synchronously inside
// `StaticPipeWriter::start()` while `finish_spawn` still has `&mut self` on
// the stack (small JSON fits the pipe buffer → write completes → close).
impl<'a> subprocess::StaticPipeWriterProcess for SecurityScanSubprocess<'a> {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::PollTag::SecurityScanStaticPipeWriter;
    unsafe fn on_close_io(this: *mut Self, kind: subprocess::StdioKind) {
        // SAFETY: `this` is the `parent` backref passed to `StaticPipeWriter::create`;
        // the subprocess outlives its writer (it `deref`s the writer in `deinit`/Drop).
        // `finish_spawn` holds no Rust borrow on `self.json_writer` across `start()`
        // (it clones the `Rc` first), so this `&mut` is unique for the call.
        unsafe { (*this).on_close_io(kind) };
    }
}

bun_spawn::link_impl_ProcessExit! {
    SecurityScan for SecurityScanSubprocess => |this| {
        on_process_exit(process, status, rusage) =>
            (*this).on_process_exit(&mut *process, status, &*rusage),
    }
}

impl<'a> Drop for SecurityScanSubprocess<'a> {
    fn drop(&mut self) {
        if let Some(p) = self.process.take() {
            // SAFETY: `p` is the live intrusive `*mut Process` returned from
            // `to_process`; we hold one ref. `detach()` clears the exit handler
            // so a late callback won't touch a dangling `self`, then `deref()`
            // drops our ref (may free if last).
            unsafe {
                (*p).detach();
                ThreadSafeRefCount::<Process>::deref(p);
            }
        }
        if let Some(w) = self.json_writer.take() {
            // Zig `deinit` only ran via `attemptSecurityScanWithRetry`'s
            // `defer scanner.deinit()`, which set `json_writer = null` first via
            // `onCloseIO`. Guard for parity: `RefPtr` has no auto-`Drop`, so
            // explicit `deref()` matches Zig `deref()`.
            w.deref();
        }
        // code, json_data drop automatically (Box<[u8]>)
    }
}

// Wire the buffered-reader vtable to this type so `BufferedReader::init::<Self>()`
// resolves. The reader stores `*mut Self` (set via `set_parent`) and calls back
// through these raw-pointer hooks.
bun_io::impl_buffered_reader_parent! {
    SecurityScan for SecurityScanSubprocess<'a>;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| (*this).on_read_chunk(chunk, has_more);
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(err);
    loop_           = |this| (*this).loop_();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}

impl<'a> SecurityScanSubprocess<'a> {
    pub fn spawn(&mut self) -> Result<(), Error> {
        self.ipc_data = Vec::new();
        self.stderr_data = Vec::new();
        let parent: *mut Self = self;
        self.ipc_reader.set_parent(parent.cast());

        // Two extra pipes for communicating with the scanner subprocess:
        // - fd 3: child writes JSON response, parent reads
        // - fd 4: parent writes packages JSON, child reads until EOF
        //
        // We can't inline the packages JSON into the code string because it can exceed
        // command-line length limits (>1MB), and we can't use stdin because scanners
        // may need stdin for their own setup (e.g. interactive prompts).

        // fd 3 output pipe: bun.sys.pipe() + .pipe (inherit_fd) on both platforms.
        let ipc_output_fds = match bun_sys::pipe() {
            Err(_) => return Err(err!("IPCPipeFailed")),
            Ok(fds) => fds,
        };

        let exec_path = bun_core::self_exe_path()?;

        // Zig: `try allocator.dupeZ(u8, exec_path)` / `dupeZ(u8, code)`. Build
        // owned NUL-terminated buffers so the pointers stay valid across the
        // `spawn_process` FFI boundary; `defer free` ≡ Vec drop.
        let mut argv0_buf: Vec<u8> = exec_path.as_bytes().to_vec();
        argv0_buf.push(0);
        let mut argv3_buf: Vec<u8> = self.code.to_vec();
        argv3_buf.push(0);
        // Element type MUST be bare `*const c_char` (null sentinel), never
        // `Option<*const c_char>`: raw pointers are already nullable, and
        // `Option<*const T>` is a 2-word (tag, ptr) pair — casting that to
        // `Argv` interleaves discriminant words and EFAULTs in the kernel.
        let mut argv: [*const core::ffi::c_char; 5] = [
            argv0_buf.as_ptr().cast(),
            b"--no-install\0".as_ptr().cast(),
            b"-e\0".as_ptr().cast(),
            argv3_buf.as_ptr().cast(),
            core::ptr::null(),
        ];
        const _: () = assert!(
            core::mem::size_of::<[*const core::ffi::c_char; 5]>()
                == 5 * core::mem::size_of::<usize>()
        );

        #[cfg(windows)]
        {
            self.spawn_windows(&mut argv, ipc_output_fds)?;
        }
        #[cfg(not(windows))]
        {
            self.spawn_posix(&mut argv, ipc_output_fds)?;
        }

        Ok(())
    }

    /// Posix fd 4: .buffer stdio creates a nonblocking socketpair inside the
    /// spawn machinery. The child's end is dup'd to fd 4 and closed in the
    /// parent by spawn's to_close_at_end list (process.zig:1460). The parent's
    /// end comes back via spawned.extra_pipes.
    #[cfg(unix)]
    fn spawn_posix(
        &mut self,
        argv: &mut [*const core::ffi::c_char; 5],
        ipc_output_fds: [Fd; 2],
    ) -> Result<(), Error> {
        let extra_fds: Box<[Stdio]> = Box::new([
            Stdio::Pipe(ipc_output_fds[1]), // fd 3: child inherits write end
            Stdio::Buffer,                  // fd 4: socketpair, parent's end in extra_pipes
        ]);

        let spawn_options = SpawnOptions {
            stdout: Stdio::Inherit,
            stderr: Stdio::Inherit,
            stdin: Stdio::Inherit,
            cwd: Box::from(FileSystem::instance().top_level_dir()),
            extra_fds,
            ..Default::default()
        };

        // Zig: `try (try spawnProcess(...)).unwrap()` — propagate both layers silently.
        let mut spawned = spawn::spawn_process(
            &spawn_options,
            argv.as_mut_ptr().cast(),
            bun_sys::environ_ptr(),
        )?
        .map_err(|e| e.to_zig_err())?;
        // `defer spawned.extra_pipes.deinit()` — drops at scope exit.

        ipc_output_fds[1].close();

        let _ = bun_sys::set_nonblocking(ipc_output_fds[0]);
        self.ipc_reader.flags.insert(PosixFlags::NONBLOCKING);
        self.ipc_reader.flags.remove(PosixFlags::SOCKET);

        let json_fd = spawned.extra_pipes[1].fd();
        self.finish_spawn(&mut spawned, ipc_output_fds[0], move || {
            subprocess::stdio_result_from_fd(json_fd)
        })
    }

    /// Windows fd 4: .buffer stdio for extra_fds sets UV_OVERLAPPED_PIPE on the
    /// child's handle (process.zig:1702), which breaks sync reads in the child.
    /// Instead, create the pipe ourselves with asymmetric flags so only the
    /// parent's write end is overlapped. Child inherits the non-overlapped read
    /// end via .pipe (inherit_fd); parent wraps the overlapped write end in a
    /// uv.Pipe for IOCP-based async writes.
    #[cfg(windows)]
    fn spawn_windows(
        &mut self,
        argv: &mut [*const core::ffi::c_char; 5],
        ipc_output_fds: [Fd; 2],
    ) -> Result<(), Error> {
        use bun_sys::ReturnCodeExt as _;
        use bun_sys::windows::libuv as uv;

        let mut json_fds: [uv::uv_file; 2] = [0; 2];
        // SAFETY: FFI — `json_fds` is a 2-element out-array; flags are valid.
        let pipe_rc = unsafe { uv::uv_pipe(&mut json_fds, 0, uv::UV_NONBLOCK_PIPE as i32) };
        // Use the translating overlay (`ReturnCodeExt::err_enum_e`) — the inherent
        // `ReturnCode::err_enum()` returns the raw |uv_code| (e.g. 4071 for
        // UV_EINVAL on Windows) without mapping to POSIX `bun.sys.E`, which would
        // make `errno_to_zig_err` index the wrong table. Zig's `rc.errEnum()`
        // (libuv.zig) routes through `translateUVErrorToE`; this matches it.
        if let Some(e) = pipe_rc.err_enum_e() {
            ipc_output_fds[0].close();
            ipc_output_fds[1].close();
            return Err(bun_core::errno_to_zig_err(e as i32));
        }
        // Track ownership with optionals: None means the fd has been transferred
        // or closed, so the errdefer skips it. Prevents double-close on error paths
        // after pipe.open() takes ownership or after the explicit closes below.
        // State is moved INTO the guard so later `= None` mutations are observed
        // by the cleanup closure (PORTING.md: errdefer side-effects → scopeguard state).
        let mut fds = scopeguard::guard(
            (
                Some(Fd::from_uv(json_fds[0])), // .0 = child_read_fd
                Some(Fd::from_uv(json_fds[1])), // .1 = parent_write_fd
            ),
            |(child_read, parent_write)| {
                if let Some(fd) = child_read {
                    fd.close();
                }
                if let Some(fd) = parent_write {
                    fd.close();
                }
            },
        );

        let pipe_ptr: *mut uv::Pipe =
            bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<uv::Pipe>()));
        // errdefer pipe.closeAndDestroy() — guard owns the raw Box ptr; libuv's
        // close callback frees the heap allocation, so do NOT re-box on the
        // cleanup path (would double-free). Disarmed only after finish_spawn
        // succeeds, matching the Zig errdefer scope exactly: it must stay armed
        // across `ipc_reader.start()` inside finish_spawn (the pre-writer error
        // window) so a registered-but-unowned uv handle is never leaked.
        let mut pipe = scopeguard::guard(pipe_ptr, |p| {
            // SAFETY: p is the live Box-allocated uv_pipe_t; close_and_destroy
            // schedules uv_close + frees the allocation.
            unsafe { uv::Pipe::close_and_destroy(p) };
        });
        // `self.loop_()` already projects to the libuv `uv_loop_t*` on
        // Windows (see the `.uv_loop` projection in `loop_()`); pass through.
        let uv_loop = self.loop_();
        // SAFETY: *pipe was just heap-allocated above and is non-null.
        if let Some(e) = unsafe { (**pipe).init(uv_loop, false) }.to_error(bun_sys::Tag::pipe) {
            return Err(e.into());
        }
        if let Some(e) = unsafe { (**pipe).open(fds.1.unwrap().uv()) }.to_error(bun_sys::Tag::open)
        {
            return Err(e.into());
        }
        fds.1 = None; // pipe owns it now

        let extra_fds: Box<[Stdio]> = Box::new([
            Stdio::Pipe(ipc_output_fds[1]), // fd 3: child inherits write end
            Stdio::Pipe(fds.0.unwrap()),    // fd 4: child inherits non-overlapped read end
        ]);

        let spawn_options = SpawnOptions {
            stdout: Stdio::Inherit,
            stderr: Stdio::Inherit,
            stdin: Stdio::Inherit,
            cwd: Box::from(FileSystem::instance().top_level_dir()),
            extra_fds,
            windows: spawn::WindowsOptions {
                loop_: EventLoopHandle::from_any(&mut self.manager.event_loop),
                ..Default::default()
            },
            ..Default::default()
        };

        // Zig: `try (try spawnProcess(...)).unwrap()` — propagate both layers silently.
        let mut spawned = spawn::spawn_process(
            &spawn_options,
            argv.as_mut_ptr().cast(),
            bun_sys::environ_ptr(),
        )?
        .map_err(|e| e.to_zig_err())?;
        // `defer spawned.extra_pipes.deinit()` — drops at scope exit.

        ipc_output_fds[1].close();
        fds.0.unwrap().close();
        fds.0 = None;

        self.ipc_reader
            .flags
            .insert(bun_io::pipe_reader::WindowsFlags::NONBLOCKING);

        // Hand the pipe to StaticPipeWriter lazily: the closure captures only the
        // raw `*mut uv::Pipe` (Copy, no Drop) and reconstitutes the Box at the
        // exact `StaticPipeWriter::create` call site inside `finish_spawn`. If
        // `finish_spawn` errors before that point (`ipc_reader.start()`), the
        // closure drops as a no-op and the still-armed errdefer guard performs
        // `close_and_destroy` — matching Zig, where `errdefer pipe.closeAndDestroy()`
        // covers the entire `try finishSpawn(...)` call. After the writer takes
        // the pipe, post-create errors leave the writer leaked at refcount >= 1
        // (RefPtr has no Drop), so the Box is never auto-freed and the guard's
        // `close_and_destroy` remains the sole cleanup, again matching Zig.
        self.finish_spawn(&mut spawned, ipc_output_fds[0], move || {
            // SAFETY: `pipe_ptr` is the same allocation produced by
            // heap::alloc above and has not been freed; ownership transfers
            // here exactly once.
            StdioResult::Buffer(unsafe { bun_core::heap::take(pipe_ptr) })
        })?;

        // Success: pipe ownership now lives in StaticPipeWriter; disarm the
        // close_and_destroy errdefer.
        scopeguard::ScopeGuard::into_inner(pipe);
        // fd slots are already None.
        scopeguard::ScopeGuard::into_inner(fds);
        Ok(())
    }

    /// Common post-spawn setup: start the fd 3 reader, attach the process,
    /// start the fd 4 JSON writer, and begin watching for exit.
    fn finish_spawn(
        &mut self,
        // PORT NOTE: Zig `spawned: anytype` — concrete type is the platform-dependent
        // SpawnResult; Rust uses the unified `spawn::SpawnResult`.
        spawned: &mut spawn::SpawnResult,
        ipc_read_fd: Fd,
        // Deferred constructor: Zig passes `json_stdio_result` by value (a tagged
        // union holding a raw `*uv.Pipe` on Windows — inert on drop). Rust's
        // `WindowsStdioResult::Buffer(Box<uv::Pipe>)` would auto-free the
        // allocation without `uv_close()` if `ipc_reader.start()` below failed,
        // leaking a registered libuv handle. Taking a thunk and calling it only
        // at the `StaticPipeWriter::create` site keeps the caller's
        // `close_and_destroy` errdefer authoritative for the pre-writer window.
        make_json_stdio: impl FnOnce() -> StdioResult,
    ) -> Result<(), Error> {
        // Allocate the blob copy before registering any event loop callbacks. If
        // this fails, nothing is registered yet and the caller's defer can safely
        // destroy the struct.
        let json_data_copy = Box::<[u8]>::from(&*self.json_data);
        // routes through webcore::blob::Any (tier-6). The move-in pass adds
        // `bun_sys::subprocess::Source::from_owned_bytes(Box<[u8]>)`.
        let json_source = subprocess::Source::from_owned_bytes(json_data_copy);

        // 2 = ipc_reader (fd 3) + json_writer (fd 4). Both must complete before
        // isDone() returns true, otherwise we risk freeing this struct while
        // StaticPipeWriter still holds a pointer to it (child crash case).
        self.remaining_fds = 2;
        // Zig: `try this.ipc_reader.start(ipc_read_fd, true).unwrap()` — propagate silently.
        self.ipc_reader
            .start(ipc_read_fd, true)
            .map_err(|e| e.to_zig_err())?;

        // PORT NOTE: `to_process` consumes `SpawnResult` by value on POSIX (and
        // `&mut self` on Windows); take ownership of the result and let the
        // moved-from `*spawned` drop empty (`extra_pipes` already read).
        let event_loop = EventLoopHandle::from_any(&mut self.manager.event_loop);
        let mut spawned_owned = std::mem::take(spawned);
        let process: *mut Process = spawned_owned.to_process(event_loop, false);

        // Derive the raw backref once and use it for all subsequent field
        // access. `start()`/`watch_or_reap()` below may re-enter
        // `on_close_io`/`on_process_exit` via this pointer while we are still
        // inside this frame, so from here on we touch `*self` only through
        // `parent` to keep a single provenance path (no overlapping `&mut`).
        let parent: *mut Self = self;
        // SAFETY: `process` is the freshly-allocated intrusive `*mut Process`
        // (refcount == 1, owned by us); `parent` was just derived from
        // `&mut self` and outlives `process` (it `deref`s it in `Drop`).
        unsafe {
            (*process).set_exit_handler(ProcessExit::new(ProcessExitKind::SecurityScan, parent));
            (*parent).process = Some(process);
        }

        // Zig: `this.json_writer = StaticPipeWriter.create(...)` — assign the
        // field BEFORE `start()`. `start()` may complete the write synchronously
        // (small JSON fits the 64KB pipe buffer on POSIX) and re-enter
        // `on_close_io` via the `parent` backref; that callback must observe
        // `json_writer.is_some()` to decrement `remaining_fds`, otherwise
        // `is_done()` never returns true and `sleep_until` hangs.
        let writer =
            StaticPipeWriter::create(event_loop, parent.cast(), make_json_stdio(), json_source);
        // Keep a duped ref locally so no borrow on `(*parent).json_writer` is
        // held across `start()` — `on_close_io` may `.take()` the field.
        let writer_local = writer.dupe_ref();
        // SAFETY: see `parent` note above.
        unsafe { (*parent).json_writer = Some(writer) };

        // errdefer if (this.json_writer) |w| { w.source.detach(); w.deref(); this.json_writer = null; }
        // PORT NOTE: guard mirrors the Zig errdefer over the FIELD (not a local),
        // including its `if (this.json_writer)` check — `start()` may already
        // have re-entered and nulled it. State is the `parent` backref; disarmed
        // via `into_inner` on the success path.
        let guard = scopeguard::guard(parent, |parent| {
            // SAFETY: `parent` points at the live `self` of `finish_spawn`; the
            // guard only fires on early return inside this fn.
            if let Some(w) = unsafe { (*parent).json_writer.take() } {
                // SAFETY: `w` holds the field's ref; sole live access path.
                unsafe { (*w.as_ptr()).source.detach() };
                w.deref();
            }
        });

        // SAFETY: `writer_local` holds a live ref; `start()` mutates the writer
        // in place (raw intrusive object — no Rust aliasing across the RefPtr).
        match unsafe { (*writer_local.as_ptr()).start() } {
            Err(e) => {
                writer_local.deref();
                Output::err_generic(
                    "Failed to start security scanner JSON pipe writer: {}",
                    (e,),
                );
                return Err(err!("JSONPipeWriterFailed"));
            }
            Ok(()) => {}
        }
        writer_local.deref();

        // SAFETY: `process` is live (we hold a ref); reached via the local raw
        // ptr per the single-provenance note. `watch_or_reap` may re-enter
        // `on_process_exit` synchronously (already-exited child).
        match unsafe { (*process).watch_or_reap() } {
            Err(_) => return Err(err!("ProcessWatchFailed")),
            Ok(_) => {}
        }

        scopeguard::ScopeGuard::into_inner(guard);
        Ok(())
    }

    pub fn on_close_io(&mut self, _: subprocess::StdioKind) {
        if let Some(writer) = self.json_writer.take() {
            // SAFETY: `writer` holds the field's intrusive ref; sole access path
            // (single-threaded event loop callback).
            unsafe { (*writer.as_ptr()).source.detach() };
            writer.deref();
            self.remaining_fds -= 1;
        }
    }

    pub fn is_done(&self) -> bool {
        self.has_process_exited && self.remaining_fds == 0
    }

    pub fn event_loop(&self) -> &AnyEventLoop<'static> {
        &self.manager.event_loop
    }

    pub fn loop_(&mut self) -> *mut AsyncLoop {
        self.manager.event_loop.native_loop()
    }

    pub fn on_reader_done(&mut self) {
        self.has_received_ipc = true;
        self.remaining_fds -= 1;
    }

    pub fn on_reader_error(&mut self, err: bun_sys::Error) {
        Output::err_generic("Failed to read security scanner IPC: {}", (err,));
        self.has_received_ipc = true;
        self.remaining_fds -= 1;
    }

    pub fn on_stderr_chunk(&mut self, chunk: &[u8]) {
        self.stderr_data.extend_from_slice(chunk);
    }

    pub fn get_read_buffer(&mut self) -> &mut [core::mem::MaybeUninit<u8>] {
        // PORT NOTE: Zig returns `unusedCapacitySlice()` (uninitialized spare
        // capacity as `[]u8`); Rust forbids `&mut [u8]` over uninit bytes, so
        // expose `&mut [MaybeUninit<u8>]`. Caller (BufferedReader) only writes
        // into this region, never reads uninit bytes.
        // Vec::reserve already amortises by doubling; the explicit cap+4096 dance is unnecessary.
        self.ipc_data.uv_alloc_spare(4096)
    }

    pub fn on_read_chunk(&mut self, chunk: &[u8], _has_more: ReadState) -> bool {
        self.ipc_data.extend_from_slice(chunk);
        true
    }

    pub fn on_process_exit(&mut self, _: &mut Process, status: Status, _: &Rusage) {
        self.has_process_exited = true;
        self.exit_status = Some(status);

        if !self.has_received_ipc {
            // PORT NOTE (intentional divergence from Zig spec): the spec tears
            // down `ipc_reader` here unconditionally. That races process-exit
            // against fd-3-readable: `ipc_reader.start()` only registers a
            // poll on POSIX (no sync read), and `MiniEventLoop::tick_once`
            // skips the uws tick whenever a concurrent task (the WaiterThread
            // exit notification) is already queued. So a fast-exiting scanner
            // under CI load reaches this branch with the JSON still sitting in
            // the kernel pipe buffer, and `deinit()` drops it on the floor —
            // `handle_results` then reports "exited without sending data".
            //
            // Two earlier band-aids (fcbbb52f0b2b sync drain; 230c8ef7f7df
            // EINTR/EAGAIN retry) caught the common case but left a window:
            // the bounded EAGAIN spin can give up before the kernel makes the
            // write-end close visible, and tearing down at that point still
            // discards the payload (or truncates it mid-JSON).
            //
            // Fix: try a best-effort sync drain (waitpid has returned, so the
            // write end is closed and a blocking-ish drain is bounded), but
            // ONLY tear down the reader if the drain actually reached EOF.
            // If it bailed early (EAGAIN limit / unexpected errno / fd already
            // invalid) leave the FilePoll registered: the next `tick_once`
            // has no pending task, so it ticks uws, the poll delivers
            // readable+HUP, `read_with_fn` drains to `Ok(0)`, and
            // `on_reader_done` decrements `remaining_fds` exactly once.
            //
            // Windows reads via libuv (async) and the fd here is a uv-owned
            // pipe handle — skip the sync drain there and keep the spec's
            // teardown (the libuv exit/read ordering is not the failing path).
            #[cfg(not(windows))]
            {
                let fd = self.ipc_reader.get_fd();
                if fd != Fd::INVALID {
                    let mut saw_eof = false;
                    let mut buf = [0u8; 4096];
                    let mut spins: u32 = 0;
                    loop {
                        match bun_sys::read(fd, &mut buf) {
                            Ok(0) => {
                                saw_eof = true;
                                break;
                            }
                            Ok(n) => {
                                self.ipc_data.extend_from_slice(&buf[..n]);
                                spins = 0;
                            }
                            Err(e) => match e.get_errno() {
                                // macOS `bun_sys::read` is single-shot
                                // (`read$NOCANCEL`, sys.zig:2138); WaiterThread
                                // + PTY matrix arms can land signals mid-drain.
                                bun_sys::E::EINTR => continue,
                                bun_sys::E::EAGAIN => {
                                    // Bounded spin only — if we don't converge
                                    // to EOF here, fall through to the poll
                                    // path below instead of busy-looping.
                                    spins += 1;
                                    if spins > 64 {
                                        break;
                                    }
                                    continue;
                                }
                                _ => break,
                            },
                        }
                    }
                    self.has_received_ipc = !self.ipc_data.is_empty();
                    if !saw_eof {
                        // Drain bailed before EOF — payload may be incomplete
                        // and the write-end close not yet visible. Leave the
                        // reader's poll in place; `on_reader_done` fires once
                        // the event loop sees readable+HUP and performs the
                        // single `remaining_fds -= 1` for fd 3. (`is_done()`
                        // stays false until then; `tick_once` has no pending
                        // task so it ticks uws on the next round.)
                        return;
                    }
                }
                // fd == INVALID falls through to the spec teardown below:
                // the reader was never started (or already torn down), so
                // there is no poll to wait on and `on_reader_done` will not
                // fire — decrement here or `sleep_until` hangs.
            }
            // Must use deinit() (close-without-reporting), NOT close(): close()
            // would re-enter on_reader_done and decrement remaining_fds a
            // second time, underflowing it and hanging sleep_until.
            self.ipc_reader.deinit();
            self.remaining_fds -= 1;
        }
    }

    pub fn handle_results(
        &mut self,
        package_paths: &mut ArrayHashMap<PackageID, PackagePath>,
        start_time: i64,
        packages_scanned: usize,
        security_scanner: &[u8],
        security_scanner_pkg_id: Option<PackageID>,
        _command_ctx: CommandContext, // Reserved for future use
        _original_cwd: &[u8],         // Reserved for future use
        is_retry: bool,
    ) -> Result<ScanAttemptResult, Error> {
        // `defer { ipc_data.deinit(); stderr_data.deinit(); }` — Vec fields drop with self.

        if self.exit_status.is_none() {
            Output::err_generic(
                "Security scanner terminated without an exit status. This is a bug in Bun.",
                (),
            );
            return Err(err!("SecurityScannerProcessFailedWithoutExitStatus"));
        }

        let status = self.exit_status.clone().unwrap();

        if self.ipc_data.is_empty() {
            match &status {
                Status::Exited(Exited { code, .. }) => {
                    Output::err_generic(
                        "Security scanner exited with code {} without sending data",
                        (*code,),
                    );
                }
                Status::Signaled(sig) => {
                    Output::err_generic(
                        "Security scanner terminated by signal {} without sending data",
                        (signal_name(*sig),),
                    );
                }
                _ => {
                    Output::err_generic(
                        "Security scanner terminated abnormally without sending data",
                        (),
                    );
                }
            }
            return Err(err!("NoSecurityScanData"));
        }

        let json_source =
            bun_ast::Source::init_path_string("ipc-message.json", self.ipc_data.as_slice());

        let mut temp_log = bun_ast::Log::init();
        let bump = bun_alloc::Arena::new();

        let json_expr = match crate::bun_json::parse_utf8(&json_source, &mut temp_log, &bump) {
            Ok(e) => e,
            Err(e) => {
                Output::err_generic("Security scanner sent invalid JSON: {}", (e.name(),));
                if self.ipc_data.len() < 1000 {
                    Output::err_generic("Response: {}", (BStr::new(&self.ipc_data),));
                }
                return Err(err!("InvalidIPCMessage"));
            }
        };

        if !matches!(json_expr.data, ExprData::EObject(_)) {
            Output::err_generic("Security scanner IPC message must be a JSON object", ());
            return Err(err!("InvalidIPCFormat"));
        }

        let Some(type_expr) = json_expr.get(b"type") else {
            Output::err_generic("Security scanner IPC message missing 'type' field", ());
            return Err(err!("MissingIPCType"));
        };

        let Some(type_str) = type_expr.as_string(&bump) else {
            Output::err_generic("Security scanner IPC 'type' must be a string", ());
            return Err(err!("InvalidIPCType"));
        };

        if type_str == b"error" {
            let Some(code_expr) = json_expr.get(b"code") else {
                Output::err_generic("Security scanner error missing 'code' field", ());
                return Err(err!("MissingErrorCode"));
            };

            let Some(code_str) = code_expr.as_string(&bump) else {
                Output::err_generic("Security scanner error 'code' must be a string", ());
                return Err(err!("InvalidErrorCode"));
            };

            #[derive(PartialEq, Eq)]
            enum ErrorCode {
                ModuleNotFound,
                InvalidVersion,
                ScanFailed,
            }
            let error_code = match code_str {
                b"MODULE_NOT_FOUND" => Some(ErrorCode::ModuleNotFound),
                b"INVALID_VERSION" => Some(ErrorCode::InvalidVersion),
                b"SCAN_FAILED" => Some(ErrorCode::ScanFailed),
                _ => None,
            };

            let Some(error_code) = error_code else {
                Output::err_generic(
                    "Unknown security scanner error code: {}",
                    (BStr::new(code_str),),
                );
                return Err(err!("UnknownErrorCode"));
            };

            match error_code {
                ErrorCode::ModuleNotFound => {
                    // If this is a retry after partial install, we need to handle it differently
                    // The scanner might have been installed but the lockfile wasn't updated
                    if is_retry {
                        // Check if the scanner is an npm package name (not a file path)
                        let is_package_name = bun_paths::is_package_path(security_scanner);

                        if is_package_name {
                            // For npm packages, after install they should be resolvable
                            // If not, there was a real problem with the installation
                            Output::err_generic(
                                "Security scanner '{}' could not be found after installation attempt.\n  <d>If this is a local file, please check that the file exists and the path is correct.<r>",
                                (BStr::new(security_scanner),),
                            );
                            return Err(err!("SecurityScannerNotFound"));
                        } else {
                            // For local files, the error is expected - they can't be installed
                            Output::err_generic(
                                "Security scanner '{}' is configured in bunfig.toml but the file could not be found.\n  <d>Please check that the file exists and the path is correct.<r>",
                                (BStr::new(security_scanner),),
                            );
                            return Err(err!("SecurityScannerNotFound"));
                        }
                    }

                    // First attempt - only try to install if we have a package ID
                    if let Some(pkg_id) = security_scanner_pkg_id {
                        return Ok(ScanAttemptResult::NeedsInstall(pkg_id));
                    } else {
                        // No package ID means it's not in dependencies
                        let is_package_name = bun_paths::is_package_path(security_scanner);

                        if is_package_name {
                            Output::err_generic(
                                "Security scanner '{}' is configured in bunfig.toml but is not installed.\n  <d>To install it, run: bun add --dev {}<r>",
                                (BStr::new(security_scanner), BStr::new(security_scanner)),
                            );
                        } else {
                            Output::err_generic(
                                "Security scanner '{}' is configured in bunfig.toml but the file could not be found.\n  <d>Please check that the file exists and the path is correct.<r>",
                                (BStr::new(security_scanner),),
                            );
                        }
                        return Err(err!("SecurityScannerNotInDependencies"));
                    }
                }
                ErrorCode::InvalidVersion => {
                    if let Some(msg) = json_expr.get(b"message") {
                        if let Some(msg_str) = msg.as_string(&bump) {
                            Output::err_generic(
                                "Security scanner error: {}",
                                (BStr::new(msg_str),),
                            );
                        }
                    }
                    return Err(err!("InvalidScannerVersion"));
                }
                ErrorCode::ScanFailed => {
                    if let Some(msg) = json_expr.get(b"message") {
                        if let Some(msg_str) = msg.as_string(&bump) {
                            Output::err_generic(
                                "Security scanner failed: {}",
                                (BStr::new(msg_str),),
                            );
                        }
                    }
                    return Err(err!("ScannerFailed"));
                }
            }
        } else if type_str != b"result" {
            Output::err_generic(
                "Unknown security scanner message type: {}",
                (BStr::new(type_str),),
            );
            return Err(err!("UnknownMessageType"));
        }

        // if we got here then we got a result message so we can continue like normal
        let duration = bun_core::time::milli_timestamp() - start_time;

        if self.manager.options.log_level == crate::package_manager::Options::LogLevel::Verbose {
            match &status {
                Status::Exited(Exited { code, .. }) => {
                    if *code == 0 {
                        Output::pretty_errorln(format_args!(
                            "<d>[SecurityProvider]<r> Completed with exit code {} [{}ms]",
                            code, duration
                        ));
                    } else {
                        Output::pretty_errorln(format_args!(
                            "<d>[SecurityProvider]<r> Failed with exit code {} [{}ms]",
                            code, duration
                        ));
                    }
                }
                Status::Signaled(sig) => {
                    Output::pretty_errorln(format_args!(
                        "<d>[SecurityProvider]<r> Terminated by signal {} [{}ms]",
                        signal_name(*sig),
                        duration
                    ));
                }
                _ => {
                    Output::pretty_errorln(format_args!(
                        "<d>[SecurityProvider]<r> Completed with unknown status [{}ms]",
                        duration
                    ));
                }
            }
        } else if self.manager.options.log_level
            != crate::package_manager::Options::LogLevel::Silent
            && duration >= 1000
        {
            let maybe_hourglass = if Output::enable_ansi_colors_stderr() {
                "⏳"
            } else {
                ""
            };
            if packages_scanned == 1 {
                Output::pretty_errorln(format_args!(
                    "<d>{}[{}] Scanning 1 package took {}ms<r>",
                    maybe_hourglass,
                    BStr::new(security_scanner),
                    duration
                ));
            } else {
                Output::pretty_errorln(format_args!(
                    "<d>{}[{}] Scanning {} packages took {}ms<r>",
                    maybe_hourglass,
                    BStr::new(security_scanner),
                    packages_scanned,
                    duration
                ));
            }
        }

        let Some(advisories_expr) = json_expr.get(b"advisories") else {
            Output::err_generic("Security scanner result missing 'advisories' field", ());
            return Err(err!("MissingAdvisoriesField"));
        };

        let advisories = parse_security_advisories_from_expr(
            self.manager,
            advisories_expr,
            &bump,
            package_paths,
        )?;

        if !status.is_ok() {
            match &status {
                Status::Exited(Exited { code, .. }) => {
                    if *code != 0 {
                        Output::err_generic("Security scanner failed with exit code: {}", (*code,));
                        return Err(err!("SecurityScannerFailed"));
                    }
                }
                Status::Signaled(signal) => {
                    Output::err_generic(
                        "Security scanner was terminated by signal: {}",
                        (signal_name(*signal),),
                    );
                    return Err(err!("SecurityScannerTerminated"));
                }
                _ => {
                    Output::err_generic("Security scanner failed", ());
                    return Err(err!("SecurityScannerFailed"));
                }
            }
        }

        let mut fatal_count: usize = 0;
        let mut warn_count: usize = 0;
        for advisory in advisories.iter() {
            match advisory.level {
                SecurityAdvisoryLevel::Fatal => fatal_count += 1,
                SecurityAdvisoryLevel::Warn => warn_count += 1,
            }
        }

        Ok(ScanAttemptResult::Success(SecurityScanResults {
            advisories,
            fatal_count,
            warn_count,
            packages_scanned,
            duration_ms: duration,
            security_scanner: Box::<[u8]>::from(security_scanner),
        }))
    }
}

fn parse_security_advisories_from_expr(
    manager: &PackageManager,
    advisories_expr: Expr,
    bump: &bun_alloc::Arena,
    package_paths: &mut ArrayHashMap<PackageID, PackagePath>,
) -> Result<Box<[SecurityAdvisory]>, Error> {
    let mut advisories_list: Vec<SecurityAdvisory> = Vec::new();

    let ExprData::EArray(array) = &advisories_expr.data else {
        Output::err_generic(
            "Security scanner 'advisories' field must be an array, got: {}",
            (<&str>::from(advisories_expr.data.tag()),),
        );
        return Err(err!("InvalidAdvisoriesFormat"));
    };

    for (i, item) in array.items.slice().iter().enumerate() {
        if !matches!(item.data, ExprData::EObject(_)) {
            Output::err_generic(
                "Security advisory at index {} must be an object, got: {}",
                (i, <&str>::from(item.data.tag())),
            );
            return Err(err!("InvalidAdvisoryFormat"));
        }

        let Some(name_expr) = item.get(b"package") else {
            Output::err_generic(
                "Security advisory at index {} missing required 'package' field",
                (i,),
            );
            return Err(err!("MissingPackageField"));
        };
        let Some(name_str_temp) = name_expr.as_string(bump) else {
            Output::err_generic(
                "Security advisory at index {} 'package' field must be a string",
                (i,),
            );
            return Err(err!("InvalidPackageField"));
        };
        if name_str_temp.is_empty() {
            Output::err_generic(
                "Security advisory at index {} 'package' field cannot be empty",
                (i,),
            );
            return Err(err!("EmptyPackageField"));
        }
        // Duplicate the string since asString returns temporary memory
        let name_str: Box<[u8]> = Box::from(name_str_temp);

        let desc_str: Option<Box<[u8]>> = if let Some(desc_expr) = item.get(b"description") {
            'blk: {
                if let Some(str) = desc_expr.as_string(bump) {
                    // Duplicate the string since asString returns temporary memory
                    break 'blk Some(Box::from(str));
                }
                if matches!(desc_expr.data, ExprData::ENull(_)) {
                    break 'blk None;
                }
                Output::err_generic(
                    "Security advisory at index {} 'description' field must be a string or null",
                    (i,),
                );
                return Err(err!("InvalidDescriptionField"));
            }
        } else {
            None
        };

        let url_str: Option<Box<[u8]>> = if let Some(url_expr) = item.get(b"url") {
            'blk: {
                if let Some(str) = url_expr.as_string(bump) {
                    // Duplicate the string since asString returns temporary memory
                    break 'blk Some(Box::from(str));
                }
                if matches!(url_expr.data, ExprData::ENull(_)) {
                    break 'blk None;
                }
                Output::err_generic(
                    "Security advisory at index {} 'url' field must be a string or null",
                    (i,),
                );
                return Err(err!("InvalidUrlField"));
            }
        } else {
            None
        };

        let Some(level_expr) = item.get(b"level") else {
            Output::err_generic(
                "Security advisory at index {} missing required 'level' field",
                (i,),
            );
            return Err(err!("MissingLevelField"));
        };
        let Some(level_str) = level_expr.as_string(bump) else {
            Output::err_generic(
                "Security advisory at index {} 'level' field must be a string",
                (i,),
            );
            return Err(err!("InvalidLevelField"));
        };
        let level = if level_str == b"fatal" {
            SecurityAdvisoryLevel::Fatal
        } else if level_str == b"warn" {
            SecurityAdvisoryLevel::Warn
        } else {
            Output::err_generic(
                "Security advisory at index {} 'level' field must be 'fatal' or 'warn', got: '{}'",
                (i, BStr::new(level_str)),
            );
            return Err(err!("InvalidLevelValue"));
        };

        // Look up the package path for this advisory
        let mut pkg_path: Option<Box<[PackageID]>> = None;
        let pkgs = manager.lockfile.packages.slice();
        let pkg_names = pkgs.items_name();
        let string_buf = manager.lockfile.buffers.string_bytes.as_slice();

        for (j, pkg_name) in pkg_names.iter().enumerate() {
            if pkg_name.slice(string_buf) == &*name_str {
                let pkg_id: PackageID = PackageID::try_from(j).expect("int cast");
                if let Some(paths) = package_paths.get(&pkg_id) {
                    // Duplicate the path so it outlives the package_paths HashMap
                    pkg_path = Some(Box::from(&*paths.pkg_path));
                }
                break;
            }
        }

        let advisory = SecurityAdvisory {
            level,
            package: name_str,
            url: url_str,
            description: desc_str,
            pkg_path,
        };

        advisories_list.push(advisory);
    }

    Ok(advisories_list.into_boxed_slice())
}

// ported from: src/install/PackageManager/security_scanner.zig
