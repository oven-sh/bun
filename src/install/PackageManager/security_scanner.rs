use std::collections::VecDeque;
use std::io::Write as _;
use std::rc::Rc;
use std::sync::Arc;

use bstr::BStr;

use bun_aio::Loop as AsyncLoop;
use bun_options_types::context::Context::Context as CommandContext;
use bun_collections::ArrayHashMap;
use bun_core::{self, err, Error, Output};
use bun_fs::{FileSystem, Path as FsPath};
use bun_install::{
    invalid_dependency_id, invalid_package_id, DependencyID, PackageID, PackageManager,
};
use bun_io::{BufferedReader, ReadState};
use bun_jsc::{self as jsc, subprocess::StdioResult};
use bun_js_parser::Expr;
use bun_logger as logger;
use bun_spawn::{self as spawn, Process, Rusage, SpawnOptions, Status, Stdio};
use bun_str::strings;
use bun_sys::{self, Fd};

use crate::hoisted_install as HoistedInstall;
use crate::isolated_install as IsolatedInstall;
use crate::package_manager::install_with_manager as InstallWithManager;

struct PackagePath {
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
    log_level: bun_install::package_manager::options::LogLevel,
    security_scanner_pkg_id: PackageID,
    original_cwd: &[u8],
) -> Result<(), Error> {
    // TODO(port): narrow error set
    let (workspace_filters, install_root_dependencies) =
        InstallWithManager::get_workspace_filters(manager, original_cwd)?;
    // `defer manager.allocator.free(workspace_filters)` — workspace_filters is now owned, drops at scope exit.

    if !manager.options.do_.install_packages {
        return Ok(());
    }

    if security_scanner_pkg_id == invalid_package_id {
        return Err(err!("InvalidPackageID"));
    }

    let packages_to_install: Option<&[PackageID]> = Some(&[security_scanner_pkg_id]);

    let summary = match manager.options.node_linker {
        bun_install::package_manager::options::NodeLinker::Hoisted
        // TODO
        | bun_install::package_manager::options::NodeLinker::Auto => {
            HoistedInstall::install_hoisted_packages(
                manager,
                ctx,
                &workspace_filters,
                install_root_dependencies,
                log_level,
                packages_to_install,
            )?
        }
        bun_install::package_manager::options::NodeLinker::Isolated => {
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
            let dep_id: DependencyID = DependencyID::try_from(_dep_id).unwrap();
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
                let dep_id: DependencyID = DependencyID::try_from(_dep_id).unwrap();
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

    if manager.options.dry_run || !manager.options.do_.install_packages {
        return Ok(None);
    }

    // For remove/uninstall, scan all remaining packages after removal
    // For other commands, scan all if no update requests, otherwise scan update packages
    let scan_all =
        manager.subcommand == bun_install::Subcommand::Remove || manager.update_requests.is_empty();
    let result = attempt_security_scan(manager, &security_scanner, scan_all, command_ctx, original_cwd)?;

    match result {
        ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
        ScanAttemptResult::NeedsInstall(pkg_id) => {
            Output::prettyln(format_args!(
                "<r><yellow>Attempting to install security scanner from npm...<r>"
            ));
            do_partial_install_of_security_scanner(
                manager,
                command_ctx,
                manager.options.log_level,
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

    let result = attempt_security_scan(manager, &security_scanner, true, command_ctx, original_cwd)?;
    match result {
        ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
        ScanAttemptResult::NeedsInstall(pkg_id) => {
            Output::prettyln(format_args!(
                "<r><yellow>Attempting to install security scanner from npm...<r>"
            ));
            do_partial_install_of_security_scanner(
                manager,
                command_ctx,
                manager.options.log_level,
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
                Output::pretty(format_args!(" › <red>{}<r>\n", BStr::new(&advisory.package)));
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

    // TODO(port): Zig used std.fs.File.stdin().readerStreaming(); use bun_sys stdin reader.
    let mut reader = bun_sys::stdin_reader();

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

    Output::pretty(format_args!("\n<yellow>Continuing with installation...<r>\n\n"));
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
            let dep_id: DependencyID = DependencyID::try_from(_dep_id).unwrap();
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
            let pkg_id: PackageID = PackageID::try_from(pkg_idx).unwrap();
            if pkg_resolutions[pkg_id as usize].tag != bun_install::resolution::Tag::Workspace {
                continue;
            }

            let workspace_deps = pkg_dependencies[pkg_id as usize];
            for _dep_id in workspace_deps.begin()..workspace_deps.end() {
                let dep_id: DependencyID = DependencyID::try_from(_dep_id).unwrap();
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
                let update_pkg_id: PackageID = PackageID::try_from(_update_pkg_id).unwrap();
                if update_pkg_id != req.package_id {
                    continue;
                }
                if pkg_resolutions[update_pkg_id as usize].tag != bun_install::resolution::Tag::Npm {
                    continue;
                }

                let mut update_dep_id: DependencyID = invalid_dependency_id;
                let mut parent_pkg_id: PackageID = invalid_package_id;

                'update_dep_id: for _pkg_id in 0..pkgs.len() {
                    let pkg_id: PackageID = PackageID::try_from(_pkg_id).unwrap();
                    let pkg_res = &pkg_resolutions[pkg_id as usize];
                    if pkg_res.tag != bun_install::resolution::Tag::Root
                        && pkg_res.tag != bun_install::resolution::Tag::Workspace
                    {
                        continue;
                    }

                    let pkg_deps = pkg_dependencies[pkg_id as usize];
                    for _dep_id in pkg_deps.begin()..pkg_deps.end() {
                        let dep_id: DependencyID = DependencyID::try_from(_dep_id).unwrap();
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
                let next_dep_id: DependencyID = DependencyID::try_from(_next_dep_id).unwrap();
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

        json_buf.extend_from_slice(b"[\n");

        let mut first = true;
        for (pkg_id, paths) in self.collector.package_paths.iter() {
            let pkg_id = *pkg_id;

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

            if dep_id == invalid_dependency_id {
                write!(
                    &mut json_buf,
                    "  {{\n    \"name\": {},\n    \"version\": \"{}\",\n    \"requestedRange\": \"{}\",\n    \"tarball\": {}\n  }}",
                    bun_core::fmt::format_json_string_utf8(pkg_name.slice(string_buf)),
                    pkg_res.value.npm.version.fmt(string_buf),
                    pkg_res.value.npm.version.fmt(string_buf),
                    bun_core::fmt::format_json_string_utf8(pkg_res.value.npm.url.slice(string_buf)),
                )?;
            } else {
                let dep_version =
                    &self.manager.lockfile.buffers.dependencies[dep_id as usize].version;
                write!(
                    &mut json_buf,
                    "  {{\n    \"name\": {},\n    \"version\": \"{}\",\n    \"requestedRange\": {},\n    \"tarball\": {}\n  }}",
                    bun_core::fmt::format_json_string_utf8(pkg_name.slice(string_buf)),
                    pkg_res.value.npm.version.fmt(string_buf),
                    bun_core::fmt::format_json_string_utf8(dep_version.literal.slice(string_buf)),
                    bun_core::fmt::format_json_string_utf8(pkg_res.value.npm.url.slice(string_buf)),
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
    attempt_security_scan_with_retry(manager, security_scanner, scan_all, command_ctx, original_cwd, false)
}

fn attempt_security_scan_with_retry(
    manager: &mut PackageManager,
    security_scanner: &[u8],
    scan_all: bool,
    command_ctx: CommandContext,
    original_cwd: &[u8],
    is_retry: bool,
) -> Result<ScanAttemptResult, Error> {
    if manager.options.log_level == bun_install::package_manager::options::LogLevel::Verbose {
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
        manager.options.log_level != bun_install::package_manager::options::LogLevel::Verbose;

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
        new_code.extend_from_slice(if suppress_error_output { b"true" } else { b"false" });
        new_code.extend_from_slice(&temp_source[index + suppress_placeholder.len()..]);
        // PORT NOTE: reshaped for borrowck — drop borrow of `code` (via `temp_source`) before reassigning.
        code = new_code;
    }

    let mut scanner = Box::new(SecurityScanSubprocess {
        manager,
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

    // PORT NOTE: Zig used a local `struct { scanner, isDone }` closure for sleepUntil; use a Rust closure.
    // TODO(port): sleep_until on &mut PackageManager while scanner holds &mut manager — Phase B must
    // restructure (e.g. take event_loop borrow before constructing scanner, or use raw ptr).
    scanner.manager.sleep_until(|| scanner.is_done());

    let packages_scanned = collector.dedupe.count();
    scanner.handle_results(
        &mut collector.package_paths,
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
    code: Box<[u8]>,
    json_data: Box<[u8]>,
    process: Option<Arc<Process>>,
    // TODO(port): BufferedReader.init(@This()) ties reader vtable to this type; verify Rust API.
    ipc_reader: BufferedReader,
    ipc_data: Vec<u8>,
    stderr_data: Vec<u8>,
    has_process_exited: bool,
    has_received_ipc: bool,
    exit_status: Option<Status>,
    remaining_fds: i8,
    json_writer: Option<Rc<StaticPipeWriter>>,
}

// TODO(port): jsc.Subprocess.NewStaticPipeWriter(@This()) is a comptime type generator parameterized
// on the parent type; map to a generic StaticPipeWriter<Parent> in bun_jsc::subprocess.
pub type StaticPipeWriter = jsc::subprocess::StaticPipeWriter<SecurityScanSubprocess<'static>>;

impl<'a> Drop for SecurityScanSubprocess<'a> {
    fn drop(&mut self) {
        if let Some(p) = &self.process {
            p.detach();
            // Arc::drop handles deref()
        }
        // code, json_data drop automatically (Box<[u8]>)
    }
}

impl<'a> SecurityScanSubprocess<'a> {
    pub fn spawn(&mut self) -> Result<(), Error> {
        self.ipc_data = Vec::new();
        self.stderr_data = Vec::new();
        self.ipc_reader.set_parent(self);

        // Two extra pipes for communicating with the scanner subprocess:
        // - fd 3: child writes JSON response, parent reads
        // - fd 4: parent writes packages JSON, child reads until EOF
        //
        // We can't inline the packages JSON into the code string because it can exceed
        // command-line length limits (>1MB), and we can't use stdin because scanners
        // may need stdin for their own setup (e.g. interactive prompts).

        // fd 3 output pipe: bun.sys.pipe() + .pipe (inherit_fd) on both platforms.
        let ipc_output_fds = match bun_sys::pipe() {
            bun_sys::Result::Err(_) => return Err(err!("IPCPipeFailed")),
            bun_sys::Result::Ok(fds) => fds,
        };

        let exec_path = bun_core::self_exe_path()?;

        // TODO(port): argv as null-terminated C-string array for spawnProcess FFI.
        let argv0 = bun_str::ZStr::from_bytes(&exec_path);
        let argv3 = bun_str::ZStr::from_bytes(&self.code);
        let mut argv: [Option<*const core::ffi::c_char>; 5] = [
            Some(argv0.as_ptr().cast()),
            Some(b"--no-install\0".as_ptr().cast()),
            Some(b"-e\0".as_ptr().cast()),
            Some(argv3.as_ptr().cast()),
            None,
        ];
        // `defer { allocator.free(span(argv[0/3])) }` — argv0/argv3 are owned ZStr, drop at scope exit.

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
        argv: &mut [Option<*const core::ffi::c_char>; 5],
        ipc_output_fds: [Fd; 2],
    ) -> Result<(), Error> {
        let extra_fds = [
            Stdio::Pipe(ipc_output_fds[1]), // fd 3: child inherits write end
            Stdio::Buffer,                  // fd 4: socketpair, parent's end in extra_pipes
        ];

        let spawn_options = SpawnOptions {
            stdout: Stdio::Inherit,
            stderr: Stdio::Inherit,
            stdin: Stdio::Inherit,
            cwd: FileSystem::instance().top_level_dir(),
            extra_fds: &extra_fds,
            ..Default::default()
        };

        // TODO(port): @ptrCast(argv) / @ptrCast(std.os.environ.ptr) — raw FFI argv/envp arrays.
        let mut spawned = spawn::spawn_process(
            &spawn_options,
            argv.as_mut_ptr().cast(),
            bun_sys::environ_ptr(),
        )?
        .unwrap()?;
        // `defer spawned.extra_pipes.deinit()` — drops at scope exit.

        ipc_output_fds[1].close();

        let _ = bun_sys::set_nonblocking(ipc_output_fds[0]);
        self.ipc_reader.flags.nonblocking = true;
        self.ipc_reader.flags.socket = false;

        self.finish_spawn(
            &mut spawned,
            ipc_output_fds[0],
            StdioResult::from_fd(spawned.extra_pipes[1].fd()),
        )
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
        argv: &mut [Option<*const core::ffi::c_char>; 5],
        ipc_output_fds: [Fd; 2],
    ) -> Result<(), Error> {
        use bun_sys::windows::libuv as uv;

        let mut json_fds: [uv::uv_file; 2] = [0; 2];
        if let Some(e) = uv::uv_pipe(&mut json_fds, 0, uv::UV_NONBLOCK_PIPE).err_enum() {
            ipc_output_fds[0].close();
            ipc_output_fds[1].close();
            // TODO(port): bun.errnoToZigErr(e) → map libuv errno to bun_core::Error.
            return Err(bun_sys::errno_to_error(e));
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

        // SAFETY: all-zero is a valid uv.Pipe (matches Zig std.mem.zeroes).
        let pipe = Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() });
        let pipe = Box::into_raw(pipe);
        // TODO(port): errdefer pipe.closeAndDestroy() — needs scopeguard that owns the raw Box ptr.
        // SAFETY: pipe was just Box::into_raw'd above and is non-null.
        unsafe { (*pipe).init(self.loop_(), false) }.unwrap()?;
        unsafe { (*pipe).open(fds.1.unwrap()) }.unwrap()?;
        fds.1 = None; // pipe owns it now

        let extra_fds = [
            Stdio::Pipe(ipc_output_fds[1]), // fd 3: child inherits write end
            Stdio::Pipe(fds.0.unwrap()), // fd 4: child inherits non-overlapped read end
        ];

        let spawn_options = SpawnOptions {
            stdout: Stdio::Inherit,
            stderr: Stdio::Inherit,
            stdin: Stdio::Inherit,
            cwd: FileSystem::instance().top_level_dir(),
            extra_fds: &extra_fds,
            windows: spawn::WindowsOptions {
                loop_: jsc::EventLoopHandle::init(&self.manager.event_loop),
            },
            ..Default::default()
        };

        let mut spawned = spawn::spawn_process(
            &spawn_options,
            argv.as_mut_ptr().cast(),
            bun_sys::environ_ptr(),
        )?
        .unwrap()?;
        // `defer spawned.extra_pipes.deinit()` — drops at scope exit.

        ipc_output_fds[1].close();
        fds.0.unwrap().close();
        fds.0 = None;

        self.ipc_reader.flags.nonblocking = true;

        // Disarm errdefer on success — both slots are None by now.
        scopeguard::ScopeGuard::into_inner(fds);

        self.finish_spawn(&mut spawned, ipc_output_fds[0], StdioResult::Buffer(pipe))
    }

    /// Common post-spawn setup: start the fd 3 reader, attach the process,
    /// start the fd 4 JSON writer, and begin watching for exit.
    fn finish_spawn(
        &mut self,
        // TODO(port): `spawned: anytype` — concrete type is platform-dependent SpawnResult.
        spawned: &mut spawn::Spawned,
        ipc_read_fd: Fd,
        json_stdio_result: StdioResult,
    ) -> Result<(), Error> {
        // Allocate the blob copy before registering any event loop callbacks. If
        // this fails, nothing is registered yet and the caller's defer can safely
        // destroy the struct.
        let json_data_copy = Box::<[u8]>::from(&*self.json_data);
        let json_source = jsc::subprocess::Source::Blob(
            jsc::webcore::blob::Any::from_owned_slice(json_data_copy),
        );

        // 2 = ipc_reader (fd 3) + json_writer (fd 4). Both must complete before
        // isDone() returns true, otherwise we risk freeing this struct while
        // StaticPipeWriter still holds a pointer to it (child crash case).
        self.remaining_fds = 2;
        self.ipc_reader.start(ipc_read_fd, true).unwrap()?;

        let process = spawned.to_process(&self.manager.event_loop, false);
        process.set_exit_handler(self);
        self.process = Some(process);

        let writer = StaticPipeWriter::create(
            &self.manager.event_loop,
            self,
            json_stdio_result,
            json_source,
        );
        // errdefer { writer.source.detach(); writer.deref(); self.json_writer = null; }
        // PORT NOTE: reshaped for borrowck — guard owns the writer value directly
        // instead of `&mut self.json_writer`, and the field is assigned only after
        // all fallible calls succeed (equivalent: errdefer would have nulled it).
        let writer = scopeguard::guard(writer, |w| {
            w.source.detach();
            // Rc::drop handles deref()
        });

        match writer.start() {
            bun_sys::Result::Err(e) => {
                Output::err_generic(format_args!(
                    "Failed to start security scanner JSON pipe writer: {}",
                    e
                ));
                return Err(err!("JSONPipeWriterFailed"));
            }
            bun_sys::Result::Ok(()) => {}
        }

        match self.process.as_ref().unwrap().watch_or_reap() {
            bun_sys::Result::Err(_) => return Err(err!("ProcessWatchFailed")),
            bun_sys::Result::Ok(()) => {}
        }

        self.json_writer = Some(scopeguard::ScopeGuard::into_inner(writer));
        Ok(())
    }

    pub fn on_close_io(&mut self, _: jsc::subprocess::StdioKind) {
        if let Some(writer) = self.json_writer.take() {
            writer.source.detach();
            // Rc::drop handles deref()
            self.remaining_fds -= 1;
        }
    }

    pub fn is_done(&self) -> bool {
        self.has_process_exited && self.remaining_fds == 0
    }

    pub fn event_loop(&self) -> &AnyEventLoop {
        &self.manager.event_loop
    }

    pub fn loop_(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            return self.manager.event_loop.loop_().uv_loop;
        }
        #[cfg(not(windows))]
        {
            self.manager.event_loop.loop_()
        }
    }

    pub fn on_reader_done(&mut self) {
        self.has_received_ipc = true;
        self.remaining_fds -= 1;
    }

    pub fn on_reader_error(&mut self, err: bun_sys::Error) {
        Output::err_generic(format_args!("Failed to read security scanner IPC: {}", err));
        self.has_received_ipc = true;
        self.remaining_fds -= 1;
    }

    pub fn on_stderr_chunk(&mut self, chunk: &[u8]) {
        self.stderr_data.extend_from_slice(chunk);
    }

    pub fn get_read_buffer(&mut self) -> &mut [u8] {
        // PORT NOTE: reshaped for borrowck — capture len/cap before mutable borrow.
        let cap = self.ipc_data.capacity();
        let len = self.ipc_data.len();
        if cap - len < 4096 {
            self.ipc_data
                .reserve((cap + 4096).saturating_sub(self.ipc_data.len()));
        }
        // TODO(port): Zig returns unusedCapacitySlice() (uninitialized spare capacity as []u8).
        // Vec::spare_capacity_mut returns &mut [MaybeUninit<u8>]; cast for now.
        // SAFETY: caller (BufferedReader) only writes into this region, never reads uninit bytes.
        unsafe {
            core::slice::from_raw_parts_mut(
                self.ipc_data.as_mut_ptr().add(self.ipc_data.len()),
                self.ipc_data.capacity() - self.ipc_data.len(),
            )
        }
    }

    pub fn on_read_chunk(&mut self, chunk: &[u8], _has_more: ReadState) -> bool {
        self.ipc_data.extend_from_slice(chunk);
        true
    }

    pub fn on_process_exit(&mut self, _: &Process, status: Status, _: &Rusage) {
        self.has_process_exited = true;
        self.exit_status = Some(status);

        if !self.has_received_ipc {
            // TODO(port): ipc_reader.deinit() — explicit teardown of BufferedReader; Drop may not
            // be safe to call mid-lifecycle. Phase B: confirm BufferedReader has explicit close().
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
            Output::err_generic(format_args!(
                "Security scanner terminated without an exit status. This is a bug in Bun."
            ));
            return Err(err!("SecurityScannerProcessFailedWithoutExitStatus"));
        }

        let status = self.exit_status.unwrap();

        if self.ipc_data.is_empty() {
            match status {
                Status::Exited(exit) => {
                    Output::err_generic(format_args!(
                        "Security scanner exited with code {} without sending data",
                        exit.code
                    ));
                }
                Status::Signaled(sig) => {
                    Output::err_generic(format_args!(
                        "Security scanner terminated by signal {} without sending data",
                        <&'static str>::from(sig)
                    ));
                }
                _ => {
                    Output::err_generic(format_args!(
                        "Security scanner terminated abnormally without sending data"
                    ));
                }
            }
            return Err(err!("NoSecurityScanData"));
        }

        let json_source = logger::Source {
            contents: self.ipc_data.as_slice(),
            path: FsPath::init(b"ipc-message.json"),
            ..Default::default()
        };

        let mut temp_log = logger::Log::init();

        let json_expr = match bun_json::parse_utf8(&json_source, &mut temp_log) {
            Ok(e) => e,
            Err(e) => {
                Output::err_generic(format_args!(
                    "Security scanner sent invalid JSON: {}",
                    e.name()
                ));
                if self.ipc_data.len() < 1000 {
                    Output::err_generic(format_args!("Response: {}", BStr::new(&self.ipc_data)));
                }
                return Err(err!("InvalidIPCMessage"));
            }
        };

        if !json_expr.data.is_e_object() {
            Output::err_generic(format_args!(
                "Security scanner IPC message must be a JSON object"
            ));
            return Err(err!("InvalidIPCFormat"));
        }

        let obj = json_expr.data.e_object();
        let Some(type_expr) = obj.get(b"type") else {
            Output::err_generic(format_args!(
                "Security scanner IPC message missing 'type' field"
            ));
            return Err(err!("MissingIPCType"));
        };

        let Some(type_str) = type_expr.as_string() else {
            Output::err_generic(format_args!("Security scanner IPC 'type' must be a string"));
            return Err(err!("InvalidIPCType"));
        };

        if type_str == b"error" {
            let Some(code_expr) = obj.get(b"code") else {
                Output::err_generic(format_args!("Security scanner error missing 'code' field"));
                return Err(err!("MissingErrorCode"));
            };

            let Some(code_str) = code_expr.as_string() else {
                Output::err_generic(format_args!("Security scanner error 'code' must be a string"));
                return Err(err!("InvalidErrorCode"));
            };

            #[derive(PartialEq, Eq)]
            enum ErrorCode {
                ModuleNotFound,
                InvalidVersion,
                ScanFailed,
            }
            let error_code = match &*code_str {
                b"MODULE_NOT_FOUND" => Some(ErrorCode::ModuleNotFound),
                b"INVALID_VERSION" => Some(ErrorCode::InvalidVersion),
                b"SCAN_FAILED" => Some(ErrorCode::ScanFailed),
                _ => None,
            };

            let Some(error_code) = error_code else {
                Output::err_generic(format_args!(
                    "Unknown security scanner error code: {}",
                    BStr::new(&code_str)
                ));
                return Err(err!("UnknownErrorCode"));
            };

            match error_code {
                ErrorCode::ModuleNotFound => {
                    // If this is a retry after partial install, we need to handle it differently
                    // The scanner might have been installed but the lockfile wasn't updated
                    if is_retry {
                        // Check if the scanner is an npm package name (not a file path)
                        let is_package_name = bun_resolver::is_package_path(security_scanner);

                        if is_package_name {
                            // For npm packages, after install they should be resolvable
                            // If not, there was a real problem with the installation
                            Output::err_generic(format_args!(
                                "Security scanner '{}' could not be found after installation attempt.\n  <d>If this is a local file, please check that the file exists and the path is correct.<r>",
                                BStr::new(security_scanner)
                            ));
                            return Err(err!("SecurityScannerNotFound"));
                        } else {
                            // For local files, the error is expected - they can't be installed
                            Output::err_generic(format_args!(
                                "Security scanner '{}' is configured in bunfig.toml but the file could not be found.\n  <d>Please check that the file exists and the path is correct.<r>",
                                BStr::new(security_scanner)
                            ));
                            return Err(err!("SecurityScannerNotFound"));
                        }
                    }

                    // First attempt - only try to install if we have a package ID
                    if let Some(pkg_id) = security_scanner_pkg_id {
                        return Ok(ScanAttemptResult::NeedsInstall(pkg_id));
                    } else {
                        // No package ID means it's not in dependencies
                        let is_package_name = bun_resolver::is_package_path(security_scanner);

                        if is_package_name {
                            Output::err_generic(format_args!(
                                "Security scanner '{}' is configured in bunfig.toml but is not installed.\n  <d>To install it, run: bun add --dev {}<r>",
                                BStr::new(security_scanner),
                                BStr::new(security_scanner)
                            ));
                        } else {
                            Output::err_generic(format_args!(
                                "Security scanner '{}' is configured in bunfig.toml but the file could not be found.\n  <d>Please check that the file exists and the path is correct.<r>",
                                BStr::new(security_scanner)
                            ));
                        }
                        return Err(err!("SecurityScannerNotInDependencies"));
                    }
                }
                ErrorCode::InvalidVersion => {
                    if let Some(msg) = obj.get(b"message") {
                        if let Some(msg_str) = msg.as_string() {
                            Output::err_generic(format_args!(
                                "Security scanner error: {}",
                                BStr::new(&msg_str)
                            ));
                        }
                    }
                    return Err(err!("InvalidScannerVersion"));
                }
                ErrorCode::ScanFailed => {
                    if let Some(msg) = obj.get(b"message") {
                        if let Some(msg_str) = msg.as_string() {
                            Output::err_generic(format_args!(
                                "Security scanner failed: {}",
                                BStr::new(&msg_str)
                            ));
                        }
                    }
                    return Err(err!("ScannerFailed"));
                }
            }
        } else if type_str != b"result" {
            Output::err_generic(format_args!(
                "Unknown security scanner message type: {}",
                BStr::new(&type_str)
            ));
            return Err(err!("UnknownMessageType"));
        }

        // if we got here then we got a result message so we can continue like normal
        let duration = bun_core::time::milli_timestamp() - start_time;

        if self.manager.options.log_level == bun_install::package_manager::options::LogLevel::Verbose {
            match status {
                Status::Exited(exit) => {
                    if exit.code == 0 {
                        Output::pretty_errorln(format_args!(
                            "<d>[SecurityProvider]<r> Completed with exit code {} [{}ms]",
                            exit.code, duration
                        ));
                    } else {
                        Output::pretty_errorln(format_args!(
                            "<d>[SecurityProvider]<r> Failed with exit code {} [{}ms]",
                            exit.code, duration
                        ));
                    }
                }
                Status::Signaled(sig) => {
                    Output::pretty_errorln(format_args!(
                        "<d>[SecurityProvider]<r> Terminated by signal {} [{}ms]",
                        <&'static str>::from(sig),
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
            != bun_install::package_manager::options::LogLevel::Silent
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

        let Some(advisories_expr) = obj.get(b"advisories") else {
            Output::err_generic(format_args!(
                "Security scanner result missing 'advisories' field"
            ));
            return Err(err!("MissingAdvisoriesField"));
        };

        let advisories =
            parse_security_advisories_from_expr(self.manager, advisories_expr, package_paths)?;

        if !status.is_ok() {
            match status {
                Status::Exited(exited) => {
                    if exited.code != 0 {
                        Output::err_generic(format_args!(
                            "Security scanner failed with exit code: {}",
                            exited.code
                        ));
                        return Err(err!("SecurityScannerFailed"));
                    }
                }
                Status::Signaled(signal) => {
                    Output::err_generic(format_args!(
                        "Security scanner was terminated by signal: {}",
                        <&'static str>::from(signal)
                    ));
                    return Err(err!("SecurityScannerTerminated"));
                }
                _ => {
                    Output::err_generic(format_args!("Security scanner failed"));
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
    package_paths: &mut ArrayHashMap<PackageID, PackagePath>,
) -> Result<Box<[SecurityAdvisory]>, Error> {
    let mut advisories_list: Vec<SecurityAdvisory> = Vec::new();

    if !advisories_expr.data.is_e_array() {
        Output::err_generic(format_args!(
            "Security scanner 'advisories' field must be an array, got: {}",
            <&'static str>::from(&advisories_expr.data)
        ));
        return Err(err!("InvalidAdvisoriesFormat"));
    }

    let array = advisories_expr.data.e_array();
    for (i, item) in array.items.slice().iter().enumerate() {
        if !item.data.is_e_object() {
            Output::err_generic(format_args!(
                "Security advisory at index {} must be an object, got: {}",
                i,
                <&'static str>::from(&item.data)
            ));
            return Err(err!("InvalidAdvisoryFormat"));
        }

        let item_obj = item.data.e_object();

        let Some(name_expr) = item_obj.get(b"package") else {
            Output::err_generic(format_args!(
                "Security advisory at index {} missing required 'package' field",
                i
            ));
            return Err(err!("MissingPackageField"));
        };
        let Some(name_str_temp) = name_expr.as_string() else {
            Output::err_generic(format_args!(
                "Security advisory at index {} 'package' field must be a string",
                i
            ));
            return Err(err!("InvalidPackageField"));
        };
        if name_str_temp.is_empty() {
            Output::err_generic(format_args!(
                "Security advisory at index {} 'package' field cannot be empty",
                i
            ));
            return Err(err!("EmptyPackageField"));
        }
        // Duplicate the string since asString returns temporary memory
        let name_str: Box<[u8]> = Box::from(&*name_str_temp);

        let desc_str: Option<Box<[u8]>> = if let Some(desc_expr) = item_obj.get(b"description") {
            'blk: {
                if let Some(str) = desc_expr.as_string() {
                    // Duplicate the string since asString returns temporary memory
                    break 'blk Some(Box::from(&*str));
                }
                if desc_expr.data.is_e_null() {
                    break 'blk None;
                }
                Output::err_generic(format_args!(
                    "Security advisory at index {} 'description' field must be a string or null",
                    i
                ));
                return Err(err!("InvalidDescriptionField"));
            }
        } else {
            None
        };

        let url_str: Option<Box<[u8]>> = if let Some(url_expr) = item_obj.get(b"url") {
            'blk: {
                if let Some(str) = url_expr.as_string() {
                    // Duplicate the string since asString returns temporary memory
                    break 'blk Some(Box::from(&*str));
                }
                if url_expr.data.is_e_null() {
                    break 'blk None;
                }
                Output::err_generic(format_args!(
                    "Security advisory at index {} 'url' field must be a string or null",
                    i
                ));
                return Err(err!("InvalidUrlField"));
            }
        } else {
            None
        };

        let Some(level_expr) = item_obj.get(b"level") else {
            Output::err_generic(format_args!(
                "Security advisory at index {} missing required 'level' field",
                i
            ));
            return Err(err!("MissingLevelField"));
        };
        let Some(level_str) = level_expr.as_string() else {
            Output::err_generic(format_args!(
                "Security advisory at index {} 'level' field must be a string",
                i
            ));
            return Err(err!("InvalidLevelField"));
        };
        let level = if &*level_str == b"fatal" {
            SecurityAdvisoryLevel::Fatal
        } else if &*level_str == b"warn" {
            SecurityAdvisoryLevel::Warn
        } else {
            Output::err_generic(format_args!(
                "Security advisory at index {} 'level' field must be 'fatal' or 'warn', got: '{}'",
                i,
                BStr::new(&level_str)
            ));
            return Err(err!("InvalidLevelValue"));
        };

        // Look up the package path for this advisory
        let mut pkg_path: Option<Box<[PackageID]>> = None;
        let pkgs = manager.lockfile.packages.slice();
        let pkg_names = pkgs.items_name();
        let string_buf = manager.lockfile.buffers.string_bytes.as_slice();

        for (j, pkg_name) in pkg_names.iter().enumerate() {
            if pkg_name.slice(string_buf) == &*name_str {
                let pkg_id: PackageID = PackageID::try_from(j).unwrap();
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/security_scanner.zig (1302 lines)
//   confidence: medium
//   todos:      15
//   notes:      spawn/IPC plumbing (BufferedReader vtable, StaticPipeWriter<Self>, argv/environ FFI, Windows uv.Pipe closeAndDestroy errdefer, sleep_until aliasing) needs Phase-B attention; Output/time/stdin helpers assumed in bun_core/bun_sys.
// ──────────────────────────────────────────────────────────────────────────
