use crate::lockfile::package::PackageColumns as _;
use std::collections::VecDeque;
use std::io::Write as _;

use bstr::BStr;

// `BufferedReaderParent::loop_` is typed `*mut bun_uws::Loop` (the
// uws wrapper — `WindowsLoop` on Windows, `PosixLoop` on POSIX), not
// `bun_io::Loop` is the trait's nominal: `us_loop_t` on POSIX, `uv_loop_t`
// on Windows. The inherent `loop_()` projects `.uv_loop` from the uws wrapper
// on Windows so `BufferedReaderParent::loop_` returns the libuv loop directly.
use crate::Error;
use crate::bun_fs::FileSystem;
use crate::bun_json::{Expr, ExprData};
use crate::package_manager_real::Command::Context as CommandContext;
use bun_collections::ArrayHashMap;
use bun_core::strings;
use bun_core::{self, Output};
use bun_event_loop::EventLoopHandle;
use bun_install::{
    DependencyID, PackageID, PackageManager, invalid_dependency_id, invalid_package_id,
};
use bun_io::Loop as AsyncLoop;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
use bun_io::{BufferedReader, ReadState};
use bun_ptr::JsCell;
use bun_ptr::RefPtr;
use bun_spawn::ProcessHandle;
#[cfg(not(windows))]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::subprocess::{self, StdioResult};
use bun_spawn::{self as spawn, Exited, SpawnOptions, Status, Stdio};
use bun_sys::{self, Fd, FdExt as _};
use core::cell::Cell;
use core::ffi::c_void;

use crate::hoisted_install as HoistedInstall;
use crate::isolated_install as IsolatedInstall;
use crate::package_manager_real::package_manager_options::Do;

/// Signal name for a raw signal byte.
/// `Status::Signaled` carries the raw byte; named range 1..=31 maps via
/// `SignalCode::name()`, RT/out-of-range values fall back to "UNKNOWN".
#[inline]
fn signal_name(raw: u8) -> &'static str {
    bun_sys::SignalCode(raw).name().unwrap_or("UNKNOWN")
}

pub(crate) struct PackagePath {
    pkg_path: Box<[PackageID]>,
    dep_path: Box<[DependencyID]>,
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum SecurityAdvisoryLevel {
    Fatal,
    Warn,
}

pub struct SecurityAdvisory {
    pub(crate) level: SecurityAdvisoryLevel,
    pub(crate) package: Box<[u8]>,
    pub(crate) url: Option<Box<[u8]>>,
    pub(crate) description: Option<Box<[u8]>>,
    pub(crate) pkg_path: Option<Box<[PackageID]>>,
}

pub struct SecurityScanResults {
    pub(crate) advisories: Box<[SecurityAdvisory]>,
    pub(crate) fatal_count: usize,
    pub(crate) warn_count: usize,
}

impl SecurityScanResults {
    pub(crate) fn has_fatal_advisories(&self) -> bool {
        self.fatal_count > 0
    }

    pub(crate) fn has_warnings(&self) -> bool {
        self.warn_count > 0
    }

    pub fn has_advisories(&self) -> bool {
        !self.advisories.is_empty()
    }
}

fn do_partial_install_of_security_scanner(
    manager: &mut PackageManager,
    log_level: crate::package_manager::Options::LogLevel,
    security_scanner_pkg_id: PackageID,
) -> Result<(), Error> {
    if !manager.options.do_.contains(Do::INSTALL_PACKAGES) {
        return Ok(());
    }

    if security_scanner_pkg_id == invalid_package_id {
        return Err(crate::Error::InvalidPackageID);
    }

    let packages_to_install: Option<&[PackageID]> = Some(&[security_scanner_pkg_id]);

    let summary = match manager.options.node_linker {
        bun_install_types::NodeLinker::NodeLinker::Hoisted
        // TODO
        | bun_install_types::NodeLinker::NodeLinker::Auto => {
            HoistedInstall::install_hoisted_packages(
                manager,
                &[],
                true,
                log_level,
                packages_to_install,
            )?
        }
        bun_install_types::NodeLinker::NodeLinker::Isolated => {
            IsolatedInstall::install_isolated_packages(
                manager,
                true,
                &[],
                packages_to_install,
            )?
        }
    };

    if cfg!(debug_assertions) {
        bun_core::debug_warn!(
            "Partial install summary - success: {}, fail: {}, skipped: {}",
            summary.success,
            summary.fail,
            summary.skipped
        );
    }

    if summary.fail > 0 {
        return Err(crate::Error::PartialInstallFailed);
    }

    if summary.success == 0 && summary.skipped == 0 {
        return Err(crate::Error::NoPackagesInstalled);
    }

    Ok(())
}

pub(crate) enum ScanAttemptResult {
    Success(SecurityScanResults),
    NeedsInstall(PackageID),
}

struct ScannerFinder<'a> {
    manager: &'a PackageManager,
    scanner_name: &'a [u8],
}

impl<'a> ScannerFinder<'a> {
    fn find_in_root_dependencies(&self) -> Option<PackageID> {
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

    fn validate_not_in_workspaces(&self) -> Result<(), Error> {
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
                    return Err(crate::Error::SecurityScannerInWorkspace);
                }
            }
        }

        Ok(())
    }
}

pub(crate) fn perform_security_scan_after_resolution(
    manager: &mut PackageManager,
    command_ctx: CommandContext,
    original_cwd: &[u8],
    seeds: &[PackageID],
) -> Result<Option<SecurityScanResults>, Error> {
    let Some(security_scanner) = manager.options.security_scanner else {
        return Ok(None);
    };

    if manager.options.dry_run || !manager.options.do_.contains(Do::INSTALL_PACKAGES) {
        return Ok(None);
    }

    let scan_all =
        manager.subcommand == bun_install::Subcommand::Remove || manager.update_requests.is_empty();
    scan_installing_scanner_if_needed(
        manager,
        security_scanner,
        scan_all,
        seeds,
        command_ctx,
        original_cwd,
    )
}

pub fn perform_security_scan_for_all(
    manager: &mut PackageManager,
    command_ctx: CommandContext,
    original_cwd: &[u8],
) -> Result<Option<SecurityScanResults>, Error> {
    let Some(security_scanner) = manager.options.security_scanner else {
        return Ok(None);
    };

    scan_installing_scanner_if_needed(
        manager,
        security_scanner,
        true,
        &[],
        command_ctx,
        original_cwd,
    )
}

fn scan_installing_scanner_if_needed(
    manager: &mut PackageManager,
    security_scanner: &[u8],
    scan_all: bool,
    seeds: &[PackageID],
    command_ctx: CommandContext,
    original_cwd: &[u8],
) -> Result<Option<SecurityScanResults>, Error> {
    let result = attempt_security_scan(
        manager,
        security_scanner,
        scan_all,
        seeds,
        command_ctx,
        original_cwd,
    )?;

    match result {
        ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
        ScanAttemptResult::NeedsInstall(pkg_id) => {
            bun_core::prettyln!("<r><yellow>Attempting to install security scanner from npm...<r>");
            let log_level = manager.options.log_level;
            do_partial_install_of_security_scanner(manager, log_level, pkg_id)?;
            bun_core::prettyln!("<r><green><b>Security scanner installed successfully.<r>");

            let retry_result = attempt_security_scan_with_retry(
                manager,
                security_scanner,
                scan_all,
                seeds,
                command_ctx,
                original_cwd,
                true,
            )?;
            match retry_result {
                ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
                ScanAttemptResult::NeedsInstall(_) => Err(crate::Error::SecurityScannerRetryFailed),
            }
        }
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
                bun_core::pretty!("  <red>FATAL<r>: {}\n", BStr::new(&advisory.package));
            }
            SecurityAdvisoryLevel::Warn => {
                bun_core::pretty!("  <yellow>WARNING<r>: {}\n", BStr::new(&advisory.package));
            }
        }

        if let Some(pkg_path) = &advisory.pkg_path {
            if pkg_path.len() > 1 {
                bun_core::pretty!("    <d>via ");
                for (idx, ancestor_id) in pkg_path[0..pkg_path.len() - 1].iter().enumerate() {
                    if idx > 0 {
                        bun_core::pretty!(" › ");
                    }
                    let ancestor_name = pkg_names[*ancestor_id as usize].slice(string_buf);
                    bun_core::pretty!("{}", BStr::new(ancestor_name));
                }
                bun_core::pretty!(" › <red>{}<r>\n", BStr::new(&advisory.package));
            } else {
                bun_core::pretty!("    <d>(direct dependency)<r>\n");
            }
        }

        if let Some(desc) = &advisory.description {
            if !desc.is_empty() {
                bun_core::pretty!("    {}\n", BStr::new(desc));
            }
        }
        if let Some(url) = &advisory.url {
            if !url.is_empty() {
                bun_core::pretty!("    <cyan>{}<r>\n", BStr::new(url));
            }
        }
    }

    Output::print(format_args!("\n"));
    let total = results.fatal_count + results.warn_count;
    if total == 1 {
        if results.fatal_count == 1 {
            bun_core::pretty!("<b>1 advisory (<red>1 fatal<r>)<r>\n");
        } else {
            bun_core::pretty!("<b>1 advisory (<yellow>1 warning<r>)<r>\n");
        }
    } else {
        if results.fatal_count > 0 && results.warn_count > 0 {
            bun_core::pretty!(
                "<b>{} advisories (<red>{} fatal<r>, <yellow>{} warning{}<r>)<r>\n",
                total,
                results.fatal_count,
                results.warn_count,
                if results.warn_count == 1 { "" } else { "s" }
            );
        } else if results.fatal_count > 0 {
            bun_core::pretty!(
                "<b>{} advisories (<red>{} fatal<r>)<r>\n",
                total,
                results.fatal_count
            );
        } else {
            bun_core::pretty!(
                "<b>{} advisories (<yellow>{} warning{}<r>)<r>\n",
                total,
                results.warn_count,
                if results.warn_count == 1 { "" } else { "s" }
            );
        }
    }
}

pub(crate) fn prompt_for_warnings() -> bool {
    let can_prompt = Output::is_stdin_tty();

    if !can_prompt {
        bun_core::pretty!(
            "\n<red>Security warnings found. Cannot prompt for confirmation (no TTY).<r>\n"
        );
        bun_core::pretty!("<red>Installation cancelled.<r>\n");
        return false;
    }

    bun_core::pretty!("\n<yellow>Security warnings found.<r> Continue anyway? [y/N] ");
    Output::flush();

    let mut reader = bun_core::output::stdin_reader();

    let Ok(first_byte) = reader.take_byte() else {
        bun_core::pretty!("\n<red>Installation cancelled.<r>\n");
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
        bun_core::pretty!("\n<red>Installation cancelled.<r>\n");
        return false;
    }

    bun_core::pretty!("\n<yellow>Continuing with installation...<r>\n\n");
    true
}

struct PackageCollector<'a> {
    manager: &'a PackageManager,
    dedupe: ArrayHashMap<PackageID, ()>,
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
    fn init(manager: &'a PackageManager) -> Self {
        Self {
            manager,
            dedupe: ArrayHashMap::new(),
            queue: VecDeque::new(),
            package_paths: ArrayHashMap::new(),
        }
    }

    fn collect_all_packages(&mut self) -> Result<(), Error> {
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

            if self.dedupe.get_or_put(dep_pkg_id)?.found_existing {
                continue;
            }

            let pkg_path_buf: Vec<PackageID> = vec![root_pkg_id, dep_pkg_id];

            let dep_path_buf: Vec<DependencyID> = vec![dep_id];

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

                if self.dedupe.get_or_put(dep_pkg_id)?.found_existing {
                    continue;
                }

                let pkg_path_buf: Vec<PackageID> = vec![pkg_id, dep_pkg_id];

                let dep_path_buf: Vec<DependencyID> = vec![dep_id];

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

    fn collect_update_packages(&mut self) -> Result<(), Error> {
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

                let initial_dep_path: Vec<DependencyID> = vec![update_dep_id];

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

    fn collect_seeded_packages(&mut self, seeds: &[PackageID]) -> Result<(), Error> {
        if seeds.is_empty() {
            return Ok(());
        }

        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_dependencies = pkgs.items_dependencies();
        let resolutions = self.manager.lockfile.buffers.resolutions.as_slice();

        let mut wanted = bun_collections::DynamicBitSet::init_empty(pkgs.len())?;
        for &seed in seeds {
            if (seed as usize) < pkgs.len() {
                wanted.set(seed as usize);
            }
        }

        for (parent_idx, deps) in pkg_dependencies.iter().enumerate() {
            let parent: PackageID = PackageID::try_from(parent_idx).expect("int cast");
            for _dep_id in deps.begin()..deps.end() {
                let dep_id: DependencyID = DependencyID::try_from(_dep_id).expect("int cast");
                let target = resolutions[dep_id as usize];
                if target == invalid_package_id || !wanted.is_set(target as usize) {
                    continue;
                }
                if self.dedupe.get_or_put(target)?.found_existing {
                    continue;
                }

                self.queue.push_back(QueueItem {
                    pkg_id: target,
                    dep_id,
                    pkg_path: vec![parent, target],
                    dep_path: vec![dep_id],
                });
            }
        }

        Ok(())
    }

    fn process_queue(&mut self) -> Result<(), Error> {
        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_resolutions = pkgs.items_resolution();
        let pkg_dependencies = pkgs.items_dependencies();

        while let Some(item) = self.queue.pop_front() {
            let pkg_id = item.pkg_id;
            let _ = item.dep_id; // Could be useful in the future for dependency-specific processing

            if pkg_resolutions[pkg_id as usize].tag == bun_install::resolution::Tag::Npm {
                let pkg_path_copy: Box<[PackageID]> = item.pkg_path.clone().into_boxed_slice();
                let dep_path_copy: Box<[DependencyID]> = item.dep_path.clone().into_boxed_slice();

                self.package_paths.put(
                    pkg_id,
                    PackagePath {
                        pkg_path: pkg_path_copy,
                        dep_path: dep_path_copy,
                    },
                )?;
            }

            let pkg_deps = pkg_dependencies[pkg_id as usize];
            for _next_dep_id in pkg_deps.begin()..pkg_deps.end() {
                let next_dep_id: DependencyID =
                    DependencyID::try_from(_next_dep_id).expect("int cast");
                let next_pkg_id = self.manager.lockfile.buffers.resolutions[next_dep_id as usize];

                if next_pkg_id == invalid_package_id {
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
    fn build_package_json(&self) -> Result<Box<[u8]>, Error> {
        let mut json_buf: Vec<u8> = Vec::new();

        let pkgs = self.manager.lockfile.packages.slice();
        let pkg_names = pkgs.items_name();
        let pkg_resolutions = pkgs.items_resolution();
        let string_buf = self.manager.lockfile.buffers.string_bytes.as_slice();
        let json_opts = bun_core::fmt::JSONFormatterUTF8Options::default();

        json_buf.extend_from_slice(b"[\n");

        let mut first = true;
        // `ArrayHashMap::iterator()` takes `&mut self`, but we only
        // need shared access. Iterate by index over the parallel key/value
        // slices instead (insertion-ordered).
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
    seeds: &[PackageID],
    command_ctx: CommandContext,
    original_cwd: &[u8],
) -> Result<ScanAttemptResult, Error> {
    attempt_security_scan_with_retry(
        manager,
        security_scanner,
        scan_all,
        seeds,
        command_ctx,
        original_cwd,
        false,
    )
}

fn attempt_security_scan_with_retry(
    manager: &mut PackageManager,
    security_scanner: &[u8],
    scan_all: bool,
    seeds: &[PackageID],
    command_ctx: CommandContext,
    original_cwd: &[u8],
    is_retry: bool,
) -> Result<ScanAttemptResult, Error> {
    if manager.options.log_level == crate::package_manager::Options::LogLevel::Verbose {
        bun_core::pretty_errorln!(
            "<d>[SecurityProvider]<r> Running at '{}'",
            BStr::new(security_scanner)
        );
        bun_core::pretty_errorln!(
            "<d>[SecurityProvider]<r> top_level_dir: '{}'",
            BStr::new(FileSystem::instance().top_level_dir())
        );
        bun_core::pretty_errorln!(
            "<d>[SecurityProvider]<r> original_cwd: '{}'",
            BStr::new(original_cwd)
        );
    }
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
        collector.collect_seeded_packages(seeds)?;
    }

    collector.process_queue()?;

    let json_builder = JSONBuilder {
        manager,
        collector: &collector,
    };
    let json_data = json_builder.build_package_json()?;

    // destructure `collector` here to release its `&PackageManager`
    // borrow before constructing `SecurityScanSubprocess` (which needs `&mut`).
    // Only `package_paths` is read past this point.
    let PackageCollector { package_paths, .. } = collector;
    let mut package_paths = package_paths;
    let packages_scanned = package_paths.count();

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
        code = new_code;
    }

    let event_loop_handle = EventLoopHandle::from_any(&mut manager.event_loop);
    let scanner = bun_ptr::OwnedThis::new(SecurityScanSubprocess {
        log_level: manager.options.log_level,
        event_loop_handle,
        code: Box::<[u8]>::from(code.as_slice()),
        json_data: Box::<[u8]>::from(&*json_data),
        process: Cell::new(None),
        ipc_reader: JsCell::new(BufferedReader::init::<SecurityScanSubprocess>()),
        ipc_data: JsCell::new(Vec::new()),
        has_received_ipc: Cell::new(false),
        exit_status: Cell::new(None),
        remaining_fds: Cell::new(0),
        json_writer: Cell::new(None),
    });
    // Cleanup of code/json_data/process handled by `Drop for SecurityScanSubprocess`.

    SecurityScanSubprocess::spawn(scanner.this_ptr())?;

    PackageManager::sleep_until(manager, |_| scanner.is_done());

    scanner.handle_results(
        manager,
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

/// The scanner subprocess. Owned by `run` for the scan's duration; the
/// process exit handler, the fd 3 reader and the fd 4 writer reach it through
/// the `ThisPtr` its [`bun_ptr::OwnedThis`] lends, so everything they touch
/// is a `Cell`.
pub struct SecurityScanSubprocess {
    log_level: crate::package_manager::Options::LogLevel,
    /// Stable storage for the io-layer opaque `bun_io::EventLoopHandle`
    /// (which carries `*const EventLoopHandle`). Mirrors the pattern in
    /// `StaticPipeWriter::io_evtloop`.
    event_loop_handle: EventLoopHandle,
    code: Box<[u8]>,
    json_data: Box<[u8]>,
    process: Cell<Option<ProcessHandle>>,
    ipc_reader: JsCell<BufferedReader>,
    ipc_data: JsCell<Vec<u8>>,
    has_received_ipc: Cell<bool>,
    exit_status: Cell<Option<Status>>,
    remaining_fds: Cell<i8>,
    /// `create()`'s ref on the fd 4 writer, released by `on_close_io`.
    json_writer: Cell<Option<RefPtr<StaticPipeWriter>>>,
}

// The generic `subprocess::StaticPipeWriter<P>` is
// monomorphized on `'static` because the writer stores `*mut P` (raw backref —
// lifetime is erased anyway) and the type alias must name a concrete `P`.
pub(crate) type StaticPipeWriter = subprocess::StaticPipeWriter<SecurityScanSubprocess>;

// The writer's `on_close` callback; may fire synchronously inside
// `StaticPipeWriter::start()` while `finish_spawn` is still running (small
// JSON fits the pipe buffer → write completes → close).
impl subprocess::StaticPipeWriterProcess for SecurityScanSubprocess {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::PollTag::SecurityScanStaticPipeWriter;
    fn on_close_io(this: bun_ptr::ThisPtr<Self>, kind: subprocess::StdioKind) {
        this.get().on_close_io(kind);
    }
}

bun_spawn::link_impl_ProcessExit! {
    SecurityScan for SecurityScanSubprocess => |this| {
        on_process_exit(_process, status, _rusage) =>
            (*this).on_process_exit(status),
    }
}

impl Drop for SecurityScanSubprocess {
    fn drop(&mut self) {
        // Detach the exit handler (so a late callback won't touch a dangling
        // `self`) and release our process ref.
        drop(self.process.take());
        // Dropping the writer can synchronously close it and re-enter
        // `on_close_io` through the parent backref; move it out first so that
        // sees `None`.
        drop(self.json_writer.take());
    }
}

// Wire the buffered-reader vtable to this type so `BufferedReader::init::<Self>()`
// resolves. The reader stores our `ThisPtr` (set via `set_parent`) and calls
// back through these hooks.
bun_io::impl_buffered_reader_parent! {
    SecurityScan for SecurityScanSubprocess;
    borrow = this;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| this.get().on_read_chunk(&chunk, has_more);
    on_reader_done  = |this| this.get().on_reader_done();
    on_reader_error = |this, err| this.get().on_reader_error(err);
    loop_           = |this| this.get().loop_();
    event_loop      = |this| this.get().event_loop_handle.as_event_loop_ctx();
}

impl SecurityScanSubprocess {
    pub(crate) fn spawn(this: bun_ptr::ThisPtr<Self>) -> Result<(), Error> {
        let me = this.get();
        me.ipc_data.with_mut(|d| d.clear());
        me.ipc_reader
            .with_mut(|r| r.set_parent(this.as_ptr().cast::<c_void>()));

        // Two extra pipes for communicating with the scanner subprocess:
        // - fd 3: child writes JSON response, parent reads
        // - fd 4: parent writes packages JSON, child reads until EOF
        //
        // We can't inline the packages JSON into the code string because it can exceed
        // command-line length limits (>1MB), and we can't use stdin because scanners
        // may need stdin for their own setup (e.g. interactive prompts).

        // fd 3 output pipe: `bun_sys::pipe()`, inherited by the child on both platforms.
        let ipc_output_fds = match bun_sys::pipe() {
            Err(_) => return Err(crate::Error::IPCPipeFailed),
            Ok(fds) => fds,
        };

        let exec_path = bun_core::self_exe_path()?;
        let code = bun_core::ZBox::from_bytes(&me.code);
        let argv: [&core::ffi::CStr; 4] =
            [exec_path.as_cstr(), c"--no-install", c"-e", code.as_cstr()];

        #[cfg(windows)]
        {
            Self::spawn_windows(this, &argv, ipc_output_fds)?;
        }
        #[cfg(not(windows))]
        {
            Self::spawn_posix(this, &argv, ipc_output_fds)?;
        }

        Ok(())
    }

    /// Posix fd 4: .buffer stdio creates a nonblocking socketpair inside the
    /// spawn machinery. The child's end is dup'd to fd 4 and closed in the
    /// parent by spawn's to_close_at_end list. The parent's
    /// end comes back via spawned.extra_pipes.
    #[cfg(unix)]
    fn spawn_posix(
        this: bun_ptr::ThisPtr<Self>,
        argv: &[&core::ffi::CStr],
        ipc_output_fds: [Fd; 2],
    ) -> Result<(), Error> {
        let me = this.get();
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

        let mut spawned =
            spawn::spawn_process_cstr(&spawn_options, argv, spawn::SpawnEnv::Inherit)?
                .map_err(|e| e.to_zig_err())?;

        ipc_output_fds[1].close();

        let _ = bun_sys::set_nonblocking(ipc_output_fds[0]);
        me.ipc_reader.with_mut(|r| {
            r.flags.insert(PosixFlags::NONBLOCKING);
            r.flags.remove(PosixFlags::SOCKET);
        });

        let json_fd = spawned.extra_pipes[1].fd();
        Self::finish_spawn(this, &mut spawned, ipc_output_fds[0], move || {
            subprocess::stdio_result_from_fd(json_fd)
        })
    }

    /// Windows fd 4: .buffer stdio for extra_fds sets UV_OVERLAPPED_PIPE on the
    /// child's handle, which breaks sync reads in the child.
    /// Instead, create the pipe ourselves with asymmetric flags so only the
    /// parent's write end is overlapped. Child inherits the non-overlapped read
    /// end via .pipe (inherit_fd); parent wraps the overlapped write end in a
    /// uv.Pipe for IOCP-based async writes.
    #[cfg(windows)]
    fn spawn_windows(
        this: bun_ptr::ThisPtr<Self>,
        argv: &[&core::ffi::CStr],
        ipc_output_fds: [Fd; 2],
    ) -> Result<(), Error> {
        use bun_sys::ReturnCodeExt as _;
        use bun_sys::windows::libuv as uv;

        let me = this.get();
        let json_fds = match uv::pipe_pair(0, uv::UV_NONBLOCK_PIPE as i32) {
            Ok(fds) => fds,
            Err(rc) => {
                ipc_output_fds[0].close();
                ipc_output_fds[1].close();
                return Err(bun_errno::from_errno(rc.errno().map_or(0, |e| e as i32)).into());
            }
        };
        // Track ownership with optionals: None means the fd has been transferred
        // or closed, so the guard skips it. Prevents double-close on error paths
        // after pipe.open() takes ownership or after the explicit closes below.
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

        // On error, `close_and_destroy_pipe`: libuv's close callback frees the
        // allocation. Stays armed across `ipc_reader.start()` inside
        // finish_spawn (the pre-writer error window) so a registered-but-unowned
        // uv handle is never leaked; disarmed once the writer takes the pipe.
        let mut pipe = scopeguard::guard(
            Some(Box::new(bun_core::ffi::zeroed::<uv::Pipe>())),
            |pipe| {
                if let Some(pipe) = pipe {
                    bun_io::source::close_and_destroy_pipe(pipe);
                }
            },
        );
        // `self.loop_()` already projects to the libuv `uv_loop_t*` on
        // Windows (see the `.uv_loop` projection in `loop_()`); pass through.
        let uv_loop = me.loop_();
        {
            let pipe = pipe.as_mut().expect("just set");
            if let Some(e) = pipe.init(uv_loop, false).to_error(bun_sys::Tag::pipe) {
                return Err(e.into());
            }
            if let Some(e) = pipe.open(fds.1.unwrap().uv()).to_error(bun_sys::Tag::open) {
                return Err(e.into());
            }
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
                loop_: me.event_loop_handle,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut spawned =
            spawn::spawn_process_cstr(&spawn_options, argv, spawn::SpawnEnv::Inherit)?
                .map_err(|e| e.to_zig_err())?;

        ipc_output_fds[1].close();
        fds.0.unwrap().close();
        fds.0 = None;

        me.ipc_reader.with_mut(|r| {
            r.flags
                .insert(bun_io::pipe_reader::WindowsFlags::NONBLOCKING)
        });

        // Hand the pipe to StaticPipeWriter lazily: the thunk runs at the
        // exact `StaticPipeWriter::create` call site inside `finish_spawn`. If
        // `finish_spawn` errors before that point (`ipc_reader.start()`), the
        // thunk never runs and the still-armed cleanup guard performs
        // `close_and_destroy`.
        let pipe_slot = &mut *pipe;
        Self::finish_spawn(this, &mut spawned, ipc_output_fds[0], move || {
            StdioResult::Buffer(pipe_slot.take().expect("pipe handed over once"))
        })?;

        // Success: pipe ownership now lives in StaticPipeWriter (the slot is
        // `None`, so the guard is a no-op). fd slots are already None.
        drop(pipe);
        scopeguard::ScopeGuard::into_inner(fds);
        Ok(())
    }

    /// Common post-spawn setup: start the fd 3 reader, attach the process,
    /// start the fd 4 JSON writer, and begin watching for exit.
    fn finish_spawn(
        this: bun_ptr::ThisPtr<Self>,
        spawned: &mut spawn::SpawnResult,
        ipc_read_fd: Fd,
        // Deferred constructor: a by-value
        // `WindowsStdioResult::Buffer(Box<uv::Pipe>)` would auto-free the
        // allocation without `uv_close()` if `ipc_reader.start()` below failed,
        // leaking a registered libuv handle. Taking a thunk and calling it only
        // at the `StaticPipeWriter::create` site keeps the caller's
        // `close_and_destroy_pipe` guard authoritative for the pre-writer window.
        make_json_stdio: impl FnOnce() -> StdioResult,
    ) -> Result<(), Error> {
        let me = this.get();
        // Allocate the blob copy before registering any event loop callbacks. If
        // this fails, nothing is registered yet and the caller can safely drop
        // the struct.
        let json_data_copy = Box::<[u8]>::from(&*me.json_data);
        let json_source = subprocess::Source::from_owned_bytes(json_data_copy);

        // 2 = ipc_reader (fd 3) + json_writer (fd 4). Both must complete before
        // is_done() returns true, otherwise we risk freeing this struct while
        // StaticPipeWriter still holds a pointer to it (child crash case).
        me.remaining_fds.set(2);
        me.ipc_reader
            .with_mut(|r| r.start(ipc_read_fd, true))
            .map_err(|e| e.to_zig_err())?;

        // `to_process_handle` consumes `SpawnResult` by value on POSIX (and
        // `&mut self` on Windows); take ownership of the result and let the
        // moved-from `*spawned` drop empty (`extra_pipes` already read).
        let event_loop = me.event_loop_handle;
        let process = std::mem::take(spawned).to_process_handle(event_loop);
        // `start()`/`watch_or_reap()` below may re-enter
        // `on_close_io`/`on_process_exit` through `this` while we are still
        // inside this frame; everything they touch is a `Cell`.
        process.set_exit_handler(this);
        me.process.set(Some(process));

        // Assign the field BEFORE `start()`. `start()` may complete the write synchronously
        // (small JSON fits the 64KB pipe buffer on POSIX) and re-enter
        // `on_close_io`; that callback must observe `json_writer.is_some()` to
        // decrement `remaining_fds`, otherwise `is_done()` never returns true
        // and `sleep_until` hangs.
        let writer = StaticPipeWriter::create(event_loop, this, make_json_stdio(), json_source);
        // Keep a duped ref locally so nothing reads `json_writer` across
        // `start()` — `on_close_io` may `.take()` the field.
        let writer_local = writer.clone();
        me.json_writer.set(Some(writer));

        // Error-cleanup over the FIELD (not a local), including a presence
        // check on it — `start()` may already have re-entered and nulled it.
        let guard = scopeguard::guard((), |()| {
            if let Some(w) = this.get().json_writer.take() {
                StaticPipeWriter::detach_source(w.this_ptr());
            }
        });

        let start_result = StaticPipeWriter::start(writer_local.this_ptr());
        // This type tracks completion via `on_close_io`, not the in-flight
        // ref: release `start()`'s ref now (absent if `start()` failed).
        drop(StaticPipeWriter::take_start_ref(writer_local.this_ptr()));
        drop(writer_local);
        if let Err(e) = start_result {
            Output::err_generic(
                "Failed to start security scanner JSON pipe writer: {}",
                (e,),
            );
            return Err(crate::Error::JSONPipeWriterFailed);
        }

        // `watch_or_reap` may re-enter `on_process_exit` synchronously
        // (already-exited child).
        let watched = {
            let process = me.process.take().expect("set above");
            let result = process.watch_or_reap();
            me.process.set(Some(process));
            result
        };
        if watched.is_err() {
            return Err(crate::Error::ProcessWatchFailed);
        }

        scopeguard::ScopeGuard::into_inner(guard);
        Ok(())
    }

    pub(crate) fn on_close_io(&self, _: subprocess::StdioKind) {
        if let Some(writer) = self.json_writer.take() {
            StaticPipeWriter::detach_source(writer.this_ptr());
            drop(writer);
            self.remaining_fds.set(self.remaining_fds.get() - 1);
        }
    }

    pub(crate) fn is_done(&self) -> bool {
        let status = self.exit_status.take();
        let exited = status.is_some();
        self.exit_status.set(status);
        exited && self.remaining_fds.get() == 0
    }

    pub(crate) fn loop_(&self) -> *mut AsyncLoop {
        self.event_loop_handle.native_loop()
    }

    pub(crate) fn on_reader_done(&self) {
        self.has_received_ipc.set(true);
        self.remaining_fds.set(self.remaining_fds.get() - 1);
    }

    pub(crate) fn on_reader_error(&self, err: bun_sys::Error) {
        Output::err_generic("Failed to read security scanner IPC: {}", (err,));
        self.has_received_ipc.set(true);
        self.remaining_fds.set(self.remaining_fds.get() - 1);
    }

    pub(crate) fn on_read_chunk(&self, chunk: &[u8], _has_more: ReadState) -> bool {
        self.ipc_data.with_mut(|d| d.extend_from_slice(chunk));
        true
    }

    pub(crate) fn on_process_exit(&self, status: Status) {
        self.exit_status.set(Some(status));

        if !self.has_received_ipc.get() {
            // Do not tear
            // down `ipc_reader` here unconditionally: that races process-exit
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
            // readable+HUP, the reader drains to `Ok(0)`, and
            // `on_reader_done` decrements `remaining_fds` exactly once.
            //
            // Windows reads via libuv (async) and the fd here is a uv-owned
            // pipe handle — skip the sync drain there and keep the spec's
            // teardown (the libuv exit/read ordering is not the failing path).
            #[cfg(not(windows))]
            {
                let fd = self.ipc_reader.with_mut(|r| r.get_fd());
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
                                self.ipc_data.with_mut(|d| d.extend_from_slice(&buf[..n]));
                                spins = 0;
                            }
                            Err(e) => match e.get_errno() {
                                // macOS `bun_sys::read` is single-shot
                                // (`read$NOCANCEL`); WaiterThread
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
                    self.has_received_ipc
                        .set(self.ipc_data.with_mut(|d| !d.is_empty()));
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
            self.ipc_reader.with_mut(|r| r.deinit());
            self.remaining_fds.set(self.remaining_fds.get() - 1);
        }
    }

    pub(crate) fn handle_results(
        &self,
        manager: &PackageManager,
        package_paths: &mut ArrayHashMap<PackageID, PackagePath>,
        start_time: i64,
        packages_scanned: usize,
        security_scanner: &[u8],
        security_scanner_pkg_id: Option<PackageID>,
        _command_ctx: CommandContext, // Reserved for future use
        _original_cwd: &[u8],         // Reserved for future use
        is_retry: bool,
    ) -> Result<ScanAttemptResult, Error> {
        let ipc_data = self.ipc_data.replace(Vec::new());
        let Some(status) = self.exit_status.take() else {
            Output::err_generic(
                "Security scanner terminated without an exit status. This is a bug in Bun.",
                (),
            );
            return Err(crate::Error::SecurityScannerProcessFailedWithoutExitStatus);
        };

        if ipc_data.is_empty() {
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
            return Err(crate::Error::NoSecurityScanData);
        }

        let json_source =
            bun_ast::Source::init_path_string("ipc-message.json", ipc_data.as_slice());

        let mut temp_log = bun_ast::Log::init();

        let parsed = match crate::bun_json::ParsedJson::parse_json(&json_source, &mut temp_log) {
            Ok(e) => e,
            Err(e) => {
                Output::err_generic("Security scanner sent invalid JSON: {}", (e.name(),));
                if ipc_data.len() < 1000 {
                    Output::err_generic("Response: {}", (BStr::new(&ipc_data),));
                }
                return Err(crate::Error::InvalidIPCMessage);
            }
        };
        let json_expr = parsed.root;

        if !matches!(json_expr.data, ExprData::EObjectJSON(_)) {
            Output::err_generic("Security scanner IPC message must be a JSON object", ());
            return Err(crate::Error::InvalidIPCFormat);
        }

        let Some(type_expr) = json_expr.get(b"type") else {
            Output::err_generic("Security scanner IPC message missing 'type' field", ());
            return Err(crate::Error::MissingIPCType);
        };

        let Some(type_str) = type_expr.as_utf8_string_literal() else {
            Output::err_generic("Security scanner IPC 'type' must be a string", ());
            return Err(crate::Error::InvalidIPCType);
        };

        if type_str == b"error" {
            let Some(code_expr) = json_expr.get(b"code") else {
                Output::err_generic("Security scanner error missing 'code' field", ());
                return Err(crate::Error::MissingErrorCode);
            };

            let Some(code_str) = code_expr.as_utf8_string_literal() else {
                Output::err_generic("Security scanner error 'code' must be a string", ());
                return Err(crate::Error::InvalidErrorCode);
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
                return Err(crate::Error::UnknownErrorCode);
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
                            return Err(crate::Error::SecurityScannerNotFound);
                        } else {
                            // For local files, the error is expected - they can't be installed
                            Output::err_generic(
                                "Security scanner '{}' is configured in bunfig.toml but the file could not be found.\n  <d>Please check that the file exists and the path is correct.<r>",
                                (BStr::new(security_scanner),),
                            );
                            return Err(crate::Error::SecurityScannerNotFound);
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
                        return Err(crate::Error::SecurityScannerNotInDependencies);
                    }
                }
                ErrorCode::InvalidVersion => {
                    if let Some(msg) = json_expr.get(b"message") {
                        if let Some(msg_str) = msg.as_utf8_string_literal() {
                            Output::err_generic(
                                "Security scanner error: {}",
                                (BStr::new(msg_str),),
                            );
                        }
                    }
                    return Err(crate::Error::InvalidScannerVersion);
                }
                ErrorCode::ScanFailed => {
                    if let Some(msg) = json_expr.get(b"message") {
                        if let Some(msg_str) = msg.as_utf8_string_literal() {
                            Output::err_generic(
                                "Security scanner failed: {}",
                                (BStr::new(msg_str),),
                            );
                        }
                    }
                    return Err(crate::Error::ScannerFailed);
                }
            }
        } else if type_str != b"result" {
            Output::err_generic(
                "Unknown security scanner message type: {}",
                (BStr::new(type_str),),
            );
            return Err(crate::Error::UnknownMessageType);
        }

        // if we got here then we got a result message so we can continue like normal
        let duration = bun_core::time::milli_timestamp() - start_time;

        if self.log_level == crate::package_manager::Options::LogLevel::Verbose {
            match &status {
                Status::Exited(Exited { code, .. }) => {
                    if *code == 0 {
                        bun_core::pretty_errorln!(
                            "<d>[SecurityProvider]<r> Completed with exit code {} [{}ms]",
                            code,
                            duration
                        );
                    } else {
                        bun_core::pretty_errorln!(
                            "<d>[SecurityProvider]<r> Failed with exit code {} [{}ms]",
                            code,
                            duration
                        );
                    }
                }
                Status::Signaled(sig) => {
                    bun_core::pretty_errorln!(
                        "<d>[SecurityProvider]<r> Terminated by signal {} [{}ms]",
                        signal_name(*sig),
                        duration
                    );
                }
                _ => {
                    bun_core::pretty_errorln!(
                        "<d>[SecurityProvider]<r> Completed with unknown status [{}ms]",
                        duration
                    );
                }
            }
        } else if self.log_level != crate::package_manager::Options::LogLevel::Silent
            && duration >= 1000
        {
            let maybe_hourglass = if Output::enable_ansi_colors_stderr() {
                "⏳"
            } else {
                ""
            };
            if packages_scanned == 1 {
                bun_core::pretty_errorln!(
                    "<d>{}[{}] Scanning 1 package took {}ms<r>",
                    maybe_hourglass,
                    BStr::new(security_scanner),
                    duration
                );
            } else {
                bun_core::pretty_errorln!(
                    "<d>{}[{}] Scanning {} packages took {}ms<r>",
                    maybe_hourglass,
                    BStr::new(security_scanner),
                    packages_scanned,
                    duration
                );
            }
        }

        let Some(advisories_expr) = json_expr.get(b"advisories") else {
            Output::err_generic("Security scanner result missing 'advisories' field", ());
            return Err(crate::Error::MissingAdvisoriesField);
        };

        let advisories =
            parse_security_advisories_from_expr(manager, advisories_expr, package_paths)?;

        if !status.is_ok() {
            match &status {
                Status::Exited(Exited { code, .. }) => {
                    if *code != 0 {
                        Output::err_generic("Security scanner failed with exit code: {}", (*code,));
                        return Err(crate::Error::SecurityScannerFailed);
                    }
                }
                Status::Signaled(signal) => {
                    Output::err_generic(
                        "Security scanner was terminated by signal: {}",
                        (signal_name(*signal),),
                    );
                    return Err(crate::Error::SecurityScannerTerminated);
                }
                _ => {
                    Output::err_generic("Security scanner failed", ());
                    return Err(crate::Error::SecurityScannerFailed);
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
        }))
    }
}

fn parse_security_advisories_from_expr(
    manager: &PackageManager,
    advisories_expr: Expr,
    package_paths: &mut ArrayHashMap<PackageID, PackagePath>,
) -> Result<Box<[SecurityAdvisory]>, Error> {
    let mut advisories_list: Vec<SecurityAdvisory> = Vec::new();

    let ExprData::EArrayJSON(array) = &advisories_expr.data else {
        Output::err_generic(
            "Security scanner 'advisories' field must be an array, got: {}",
            (advisories_expr.data.tag_name(),),
        );
        return Err(crate::Error::InvalidAdvisoriesFormat);
    };

    for (i, item_value) in array.get().items().iter().enumerate() {
        let item = Expr::from_json_value(item_value, advisories_expr.loc);
        if !matches!(item.data, ExprData::EObjectJSON(_)) {
            Output::err_generic(
                "Security advisory at index {} must be an object, got: {}",
                (i, item.data.tag_name()),
            );
            return Err(crate::Error::InvalidAdvisoryFormat);
        }

        let Some(name_expr) = item.get(b"package") else {
            Output::err_generic(
                "Security advisory at index {} missing required 'package' field",
                (i,),
            );
            return Err(crate::Error::MissingPackageField);
        };
        let Some(name_str_temp) = name_expr.as_utf8_string_literal() else {
            Output::err_generic(
                "Security advisory at index {} 'package' field must be a string",
                (i,),
            );
            return Err(crate::Error::InvalidPackageField);
        };
        if name_str_temp.is_empty() {
            Output::err_generic(
                "Security advisory at index {} 'package' field cannot be empty",
                (i,),
            );
            return Err(crate::Error::EmptyPackageField);
        }
        let name_str: Box<[u8]> = Box::from(name_str_temp);

        let desc_str: Option<Box<[u8]>> = if let Some(desc_expr) = item.get(b"description") {
            'blk: {
                if let Some(str) = desc_expr.as_utf8_string_literal() {
                    break 'blk Some(Box::from(str));
                }
                if matches!(desc_expr.data, ExprData::ENull(_)) {
                    break 'blk None;
                }
                Output::err_generic(
                    "Security advisory at index {} 'description' field must be a string or null",
                    (i,),
                );
                return Err(crate::Error::InvalidDescriptionField);
            }
        } else {
            None
        };

        let url_str: Option<Box<[u8]>> = if let Some(url_expr) = item.get(b"url") {
            'blk: {
                if let Some(str) = url_expr.as_utf8_string_literal() {
                    break 'blk Some(Box::from(str));
                }
                if matches!(url_expr.data, ExprData::ENull(_)) {
                    break 'blk None;
                }
                Output::err_generic(
                    "Security advisory at index {} 'url' field must be a string or null",
                    (i,),
                );
                return Err(crate::Error::InvalidUrlField);
            }
        } else {
            None
        };

        let Some(level_expr) = item.get(b"level") else {
            Output::err_generic(
                "Security advisory at index {} missing required 'level' field",
                (i,),
            );
            return Err(crate::Error::MissingLevelField);
        };
        let Some(level_str) = level_expr.as_utf8_string_literal() else {
            Output::err_generic(
                "Security advisory at index {} 'level' field must be a string",
                (i,),
            );
            return Err(crate::Error::InvalidLevelField);
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
            return Err(crate::Error::InvalidLevelValue);
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
