use crate::lockfile::package::PackageColumns as _;
use core::ffi::CStr;
use std::collections::VecDeque;
use std::io::Write as _;

use bstr::BStr;

use crate::Error;
use crate::bun_fs::FileSystem;
use crate::bun_json::{Expr, ExprData};
use crate::package_manager_real::Command::Context as CommandContext;
use crate::repository_real::RepositoryExt as _;
use crate::resolution::{append_without_url_credentials, append_without_url_userinfo};
use bun_collections::ArrayHashMap;
use bun_core::fmt::{escape_control_chars, escape_control_chars_multiline};
use bun_core::strings;
use bun_core::{self, Output};
use bun_event_loop::EventLoopHandle;
use bun_install::resolution::Tag as ResolutionTag;
use bun_install::{
    DependencyID, PackageID, PackageManager, invalid_dependency_id, invalid_package_id,
};
use bun_io::Loop as AsyncLoop;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
use bun_io::{BufferedReader, ReadState};
use bun_ptr::{RefCount, RefPtr};
#[cfg(not(windows))]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::subprocess::{self, StdioResult};
use bun_spawn::{
    self as spawn, Exited, Process, ProcessExit, ProcessExitKind, ProcessHandle, Rusage, SpawnEnv,
    SpawnOptions, Status, Stdio,
};
use bun_sys::{self, Fd, FdExt as _};

use crate::hoisted_install as HoistedInstall;
use crate::isolated_install as IsolatedInstall;
use crate::package_manager_real::package_manager_options::Do;

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
    ctx: CommandContext,
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

    // The linker of the install that follows. `bun pm scan` has not chosen a configVersion.
    let linker = crate::lockfile_real::resolve_node_linker(
        manager.options.node_linker,
        (manager.options.config_version)
            .or(manager.lockfile.saved_config_version)
            .unwrap_or(crate::config_version::ConfigVersion::V0),
        manager.lockfile.workspace_paths.len() > 0,
    );
    let isolated = linker == bun_install_types::NodeLinker::NodeLinker::Isolated;
    let mut summary = if isolated {
        IsolatedInstall::install_isolated_packages(
            manager,
            ctx,
            /* install_root_dependencies */ true,
            &[],
            packages_to_install,
            /* warn_incorrect_peers */ false,
        )?
    } else {
        HoistedInstall::install_hoisted_packages(
            manager,
            ctx,
            &[],
            true,
            log_level,
            packages_to_install,
        )?
    };
    summary.fail += manager.report_offline_misses(
        &summary.offline_misses,
        &[security_scanner_pkg_id],
        isolated,
    )?;

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
        let string_buf = self.manager.lockfile.buffers.string_bytes.as_slice();
        let root_deps = pkgs.items_dependencies()[0];

        for dep_id in root_deps.begin()..root_deps.end() {
            let dep_pkg_id = self.manager.lockfile.buffers.resolutions[dep_id as usize];

            if dep_pkg_id == invalid_package_id
                || pkgs.items_resolution()[dep_pkg_id as usize].tag != ResolutionTag::Npm
            {
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
            if pkg_res[pkg_idx].tag != ResolutionTag::Workspace {
                continue;
            }

            for dep in pkg_deps[pkg_idx].get(&self.manager.lockfile.buffers.dependencies) {
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
    loaded_lockfile: bool,
) -> Result<Option<SecurityScanResults>, Error> {
    let Some(security_scanner) = manager.options.security_scanner else {
        return Ok(None);
    };

    // No command skips a configured scanner unless the run installs nothing into `node_modules`.
    if manager.options.dry_run || !manager.options.do_.contains(Do::INSTALL_PACKAGES) {
        return Ok(None);
    }

    let has_node_modules = {
        let _entries_lock = FileSystem::instance().fs.entries_mutex.lock_guard();
        manager.root_dir.has_comptime_query(b"node_modules")
    };
    // A command that names the packages it adds or updates scans only those packages and `seeds`.
    // The install that wrote the lockfile and `node_modules` already scanned everything else.
    let scan_all = manager.update_requests.is_empty()
        || !loaded_lockfile
        || !has_node_modules
        || !matches!(
            manager.subcommand,
            bun_install::Subcommand::Add
                | bun_install::Subcommand::Install
                | bun_install::Subcommand::Update
        );
    scan_installing_scanner_if_needed(
        manager,
        security_scanner,
        scan_all,
        seeds,
        command_ctx,
        original_cwd,
        true,
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
        false,
    )
}

fn scan_installing_scanner_if_needed(
    manager: &mut PackageManager,
    security_scanner: &[u8],
    scan_all: bool,
    seeds: &[PackageID],
    command_ctx: CommandContext,
    original_cwd: &[u8],
    parsed_package_json: bool,
) -> Result<Option<SecurityScanResults>, Error> {
    match attempt_security_scan(
        manager,
        security_scanner,
        scan_all,
        seeds,
        original_cwd,
        false,
    )? {
        ScanAttemptResult::Success(scan_results) => Ok(Some(scan_results)),
        ScanAttemptResult::NeedsInstall(pkg_id) => {
            bun_core::prettyln!("<r><yellow>Attempting to install security scanner from npm...<r>");
            // The linkers ask which workspaces are behind a symlink. `bun pm scan` parses no
            // package.json, so nothing has looked yet.
            if !parsed_package_json {
                manager.lockfile.look_at_members(None);
            }
            let log_level = manager.options.log_level;
            do_partial_install_of_security_scanner(manager, command_ctx, log_level, pkg_id)?;
            bun_core::prettyln!("<r><green><b>Security scanner installed successfully.<r>");

            match attempt_security_scan(
                manager,
                security_scanner,
                scan_all,
                seeds,
                original_cwd,
                true,
            )? {
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

        let package = escape_control_chars(&advisory.package);
        match advisory.level {
            SecurityAdvisoryLevel::Fatal => {
                bun_core::pretty!("  <red>FATAL<r>: {}\n", package);
            }
            SecurityAdvisoryLevel::Warn => {
                bun_core::pretty!("  <yellow>WARNING<r>: {}\n", package);
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
                    bun_core::pretty!("{}", escape_control_chars(ancestor_name));
                }
                bun_core::pretty!(" › <red>{}<r>\n", package);
            } else {
                bun_core::pretty!("    <d>(direct dependency)<r>\n");
            }
        }

        if let Some(desc) = &advisory.description {
            if !desc.is_empty() {
                bun_core::pretty!("    {}\n", escape_control_chars_multiline(desc));
            }
        }
        if let Some(url) = &advisory.url {
            if !url.is_empty() {
                bun_core::pretty!("    <cyan>{}<r>\n", escape_control_chars(url));
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
        b'\r' => {
            let _ = reader.take_byte();
            false
        }
        b'y' | b'Y' => match reader.take_byte() {
            Ok(b'\n') => true,
            Ok(b'\r') => matches!(reader.take_byte(), Ok(b'\n')),
            _ => false,
        },
        _ => {
            while !matches!(reader.take_byte(), Err(_) | Ok(b'\n' | b'\r')) {}
            false
        }
    };

    if !should_continue {
        bun_core::pretty!("\n<red>Installation cancelled.<r>\n");
        return false;
    }

    bun_core::pretty!("\n<yellow>Continuing with installation...<r>\n\n");
    true
}

/// Everything that is not the project itself, so that a kind added later is scanned too.
fn is_scannable_resolution(tag: ResolutionTag) -> bool {
    !matches!(
        tag,
        ResolutionTag::Uninitialized | ResolutionTag::Root | ResolutionTag::Workspace
    )
}

struct PackageCollector<'a> {
    manager: &'a PackageManager,
    dedupe: ArrayHashMap<PackageID, ()>,
    queue: VecDeque<QueueItem>,
    package_paths: ArrayHashMap<PackageID, PackagePath>,
}

struct QueueItem {
    pkg_id: PackageID,
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

    /// Queues the package `dep_id` resolves to, unless it was queued before.
    fn enqueue(
        &mut self,
        pkg_path: &[PackageID],
        dep_path: &[DependencyID],
        dep_id: DependencyID,
    ) -> Result<(), Error> {
        let pkg_id = self.manager.lockfile.buffers.resolutions[dep_id as usize];
        if pkg_id == invalid_package_id || self.dedupe.get_or_put(pkg_id)?.found_existing {
            return Ok(());
        }
        self.queue.push_back(QueueItem {
            pkg_id,
            pkg_path: [pkg_path, &[pkg_id]].concat(),
            dep_path: [dep_path, &[dep_id]].concat(),
        });
        Ok(())
    }

    /// The dependencies of the root package, then those of the workspace packages.
    fn collect_all_packages(&mut self) -> Result<(), Error> {
        let pkgs = self.manager.lockfile.packages.slice();
        for (pkg_id, deps) in pkgs.items_dependencies().iter().enumerate() {
            if pkg_id != 0 && pkgs.items_resolution()[pkg_id].tag != ResolutionTag::Workspace {
                continue;
            }
            for dep_id in deps.begin()..deps.end() {
                self.enqueue(&[pkg_id as PackageID], &[], dep_id)?;
            }
        }
        Ok(())
    }

    fn collect_update_packages(&mut self) -> Result<(), Error> {
        let manager = self.manager;
        let pkgs = manager.lockfile.packages.slice();
        let resolutions = manager.lockfile.buffers.resolutions.as_slice();

        for req in manager.update_requests.iter() {
            if req.package_id as usize >= pkgs.len() {
                continue;
            }
            let importers = (0..pkgs.len()).filter(|&pkg_id| {
                matches!(
                    pkgs.items_resolution()[pkg_id].tag,
                    ResolutionTag::Root | ResolutionTag::Workspace
                )
            });
            for pkg_id in importers {
                let deps = pkgs.items_dependencies()[pkg_id];
                if let Some(dep_id) = (deps.begin()..deps.end())
                    .find(|&dep_id| resolutions[dep_id as usize] == req.package_id)
                {
                    self.enqueue(&[pkg_id as PackageID], &[], dep_id)?;
                    break;
                }
            }
        }
        Ok(())
    }

    fn collect_seeded_packages(&mut self, seeds: &[PackageID]) -> Result<(), Error> {
        if seeds.is_empty() {
            return Ok(());
        }

        let pkgs = self.manager.lockfile.packages.slice();
        let resolutions = self.manager.lockfile.buffers.resolutions.as_slice();

        let mut wanted = bun_collections::DynamicBitSet::init_empty(pkgs.len())?;
        for &seed in seeds {
            if (seed as usize) < pkgs.len() {
                wanted.set(seed as usize);
            }
        }

        for (parent, deps) in pkgs.items_dependencies().iter().enumerate() {
            for dep_id in deps.begin()..deps.end() {
                let target = resolutions[dep_id as usize];
                if target != invalid_package_id && wanted.is_set(target as usize) {
                    self.enqueue(&[parent as PackageID], &[], dep_id)?;
                }
            }
        }
        Ok(())
    }

    fn process_queue(&mut self) -> Result<(), Error> {
        let pkgs = self.manager.lockfile.packages.slice();

        while let Some(item) = self.queue.pop_front() {
            let pkg_deps = pkgs.items_dependencies()[item.pkg_id as usize];
            for dep_id in pkg_deps.begin()..pkg_deps.end() {
                self.enqueue(&item.pkg_path, &item.dep_path, dep_id)?;
            }

            if is_scannable_resolution(pkgs.items_resolution()[item.pkg_id as usize].tag) {
                self.package_paths.put(
                    item.pkg_id,
                    PackagePath {
                        pkg_path: item.pkg_path.into_boxed_slice(),
                        dep_path: item.dep_path.into_boxed_slice(),
                    },
                )?;
            }
        }
        Ok(())
    }
}

fn build_package_json(
    manager: &PackageManager,
    package_paths: &ArrayHashMap<PackageID, PackagePath>,
) -> Result<Box<[u8]>, Error> {
    let mut json_buf: Vec<u8> = Vec::new();

    let pkgs = manager.lockfile.packages.slice();
    let pkg_names = pkgs.items_name();
    let pkg_resolutions = pkgs.items_resolution();
    let string_buf = manager.lockfile.buffers.string_bytes.as_slice();
    let json_opts = bun_core::fmt::JSONFormatterUTF8Options::default();

    json_buf.extend_from_slice(b"[\n");

    let mut resolved: Vec<u8> = Vec::new();
    let mut version: Vec<u8> = Vec::new();
    let mut tarball: Vec<u8> = Vec::new();
    let mut requested_range: Vec<u8> = Vec::new();
    let mut first = true;
    for (&pkg_id, paths) in package_paths.keys().iter().zip(package_paths.values()) {
        let dep_id = paths
            .dep_path
            .last()
            .copied()
            .unwrap_or(invalid_dependency_id);

        let pkg_name = pkg_names[pkg_id as usize];
        let pkg_res = &pkg_resolutions[pkg_id as usize];

        if !first {
            json_buf.extend_from_slice(b",\n");
        }

        resolved.clear();
        version.clear();
        tarball.clear();
        requested_range.clear();
        match pkg_res.tag {
            ResolutionTag::Npm => {
                let npm = pkg_res.npm();
                write!(&mut version, "{}", npm.version.fmt(string_buf))?;
                append_without_url_userinfo(&mut tarball, npm.url.slice(string_buf));
            }
            tag => {
                if tag == ResolutionTag::Folder {
                    resolved.extend_from_slice(b"file:");
                }
                write!(&mut resolved, "{}", pkg_res.fmt_url(string_buf))?;
                append_without_url_credentials(&mut version, &resolved);
                match tag {
                    ResolutionTag::Github => {
                        let repository = pkg_res.github();
                        let commit = if repository.resolved.is_empty() {
                            repository.committish.slice(string_buf)
                        } else {
                            repository.resolved_commit(string_buf)
                        };
                        append_without_url_credentials(
                            &mut tarball,
                            &crate::package_manager_real::run_tasks::alloc_github_url_for_ref(
                                manager, repository, commit,
                            ),
                        );
                    }
                    ResolutionTag::LocalTarball | ResolutionTag::RemoteTarball => {
                        tarball.extend_from_slice(&version);
                    }
                    _ => {}
                }
            }
        }

        if dep_id == invalid_dependency_id {
            requested_range.extend_from_slice(&version);
        } else {
            append_without_url_credentials(
                &mut requested_range,
                manager.lockfile.buffers.dependencies[dep_id as usize]
                    .version
                    .literal
                    .slice(string_buf),
            );
        }

        write!(
            &mut json_buf,
            "  {{\n    \"name\": {},\n    \"version\": {},\n    \"requestedRange\": {},\n    \"tarball\": {}\n  }}",
            bun_core::fmt::format_json_string_utf8(pkg_name.slice(string_buf), json_opts),
            bun_core::fmt::format_json_string_utf8(&version, json_opts),
            bun_core::fmt::format_json_string_utf8(&requested_range, json_opts),
            bun_core::fmt::format_json_string_utf8(&tarball, json_opts),
        )?;

        first = false;
    }

    json_buf.extend_from_slice(b"\n]");
    Ok(json_buf.into_boxed_slice())
}

// Security scanner subprocess entry point - uses IPC protocol for communication
// Note: scanner-entry.ts must be in JavaScriptSources.txt for the build
// scanner-entry.d.ts is NOT included in the build (type definitions only)
const SCANNER_ENTRY_SOURCE: &[u8] = include_bytes!("./scanner-entry.ts");

fn replace_first(source: &[u8], placeholder: &[u8], with: &[u8]) -> Vec<u8> {
    let index = strings::index_of(source, placeholder).expect("placeholder in scanner-entry.ts");
    [&source[..index], with, &source[index + placeholder.len()..]].concat()
}

fn attempt_security_scan(
    manager: &mut PackageManager,
    security_scanner: &[u8],
    scan_all: bool,
    seeds: &[PackageID],
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

    // Releases the collector's `&PackageManager` before `SecurityScanSubprocess` takes `&mut`.
    let PackageCollector { package_paths, .. } = collector;
    let json_data = build_package_json(manager, &package_paths)?;
    let packages_scanned = package_paths.count();

    let suppress: &[u8] = if suppress_error_output {
        b"true"
    } else {
        b"false"
    };
    let code = replace_first(SCANNER_ENTRY_SOURCE, b"__SUPPRESS_ERROR__", suppress);
    // The scanner's name is substituted last, so a placeholder inside the name is never replaced.
    let mut quoted: Vec<u8> = Vec::new();
    write!(
        &mut quoted,
        "{}",
        bun_core::fmt::format_json_string_utf8(security_scanner, Default::default())
    )?;
    let code = replace_first(&code, b"__SCANNER_MODULE__", &quoted);

    let event_loop_handle = EventLoopHandle::from_any(&mut manager.event_loop);
    let mut scanner = Box::new(SecurityScanSubprocess {
        manager,
        event_loop_handle,
        code: code.into_boxed_slice(),
        json_data,
        process: None,
        ipc_reader: BufferedReader::init::<SecurityScanSubprocess>(),
        ipc_data: Vec::new(),
        has_received_ipc: false,
        exit_status: None,
        remaining_fds: 0,
        json_writer: None,
    });
    // Cleanup of code/json_data/process handled by `Drop for SecurityScanSubprocess` when Box drops.

    scanner.spawn()?;

    // `sleep_until` takes `*mut PackageManager` + `fn(&mut C) -> bool`; pass the
    // boxed scanner as the closure context and a fn pointer that probes `is_done`.
    fn scanner_is_done(scanner: &mut Box<SecurityScanSubprocess>) -> bool {
        scanner.is_done()
    }
    let mgr: *mut PackageManager = scanner.manager;
    // SAFETY: `scanner.manager` is the live exclusive `&mut PackageManager`
    // borrow held by the subprocess; `sleep_until` + `tick_raw` hold no
    // `&mut PackageManager` across `scanner_is_done`.
    unsafe { PackageManager::sleep_until(mgr, &mut scanner, scanner_is_done) };

    scanner.handle_results(
        &package_paths,
        start_time,
        packages_scanned,
        security_scanner,
        security_scanner_pkg_id,
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
    process: Option<ProcessHandle>,
    ipc_reader: BufferedReader,
    ipc_data: Vec<u8>,
    has_received_ipc: bool,
    exit_status: Option<Status>,
    remaining_fds: i8,
    json_writer: Option<RefPtr<StaticPipeWriter>>,
}

// The generic `subprocess::StaticPipeWriter<P>` is
// monomorphized on `'static` because the writer stores `*mut P` (raw backref —
// lifetime is erased anyway) and the type alias must name a concrete `P`.
pub(crate) type StaticPipeWriter = subprocess::StaticPipeWriter<SecurityScanSubprocess<'static>>;

// Wire the writer's `on_close` callback back to this type. Raw `*mut Self`
// because the call is re-entrant: it may fire synchronously inside
// `StaticPipeWriter::start()` while `finish_spawn` still has `&mut self` on
// the stack (small JSON fits the pipe buffer → write completes → close).
impl<'a> subprocess::StaticPipeWriterProcess for SecurityScanSubprocess<'a> {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::PollTag::SecurityScanStaticPipeWriter;
    unsafe fn on_close_io(this: *mut Self, kind: subprocess::StdioKind) {
        // SAFETY: `this` is the `parent` backref passed to `StaticPipeWriter::create`;
        // the subprocess outlives its writer (it owns the writer ref in `json_writer`).
        // `finish_spawn` holds no Rust borrow on `self.json_writer` across `start()`
        // (it clones the `RefPtr` first), so this `&mut` is unique for the call.
        unsafe { (*this).on_close_io(kind) };
    }
}

bun_spawn::link_impl_ProcessExit! {
    SecurityScan for SecurityScanSubprocess<'static> => |this| {
        on_process_exit(process, status, rusage) =>
            (*this).on_process_exit(&mut *process, status, rusage),
    }
}

impl<'a> Drop for SecurityScanSubprocess<'a> {
    fn drop(&mut self) {
        self.process = None;
        // Dropping the writer can synchronously close it and re-enter
        // `on_close_io` through the parent backref; move it out first so that
        // sees `None`.
        drop(self.json_writer.take());
    }
}

// Wire the buffered-reader vtable to this type so `BufferedReader::init::<Self>()`
// resolves. The reader stores `*mut Self` (set via `set_parent`) and calls back
// through these raw-pointer hooks.
bun_io::impl_buffered_reader_parent! {
    SecurityScan for SecurityScanSubprocess<'a>;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| (*this).on_read_chunk(&chunk, has_more);
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(err);
    loop_           = |this| (*this).loop_();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}

impl<'a> SecurityScanSubprocess<'a> {
    pub(crate) fn spawn(&mut self) -> Result<(), Error> {
        self.ipc_data = Vec::new();
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
            Err(_) => return Err(crate::Error::IPCPipeFailed),
            Ok(fds) => fds,
        };

        let exec_path = bun_core::self_exe_path()?;

        // Like a lifecycle script, it gets the environment that the install resolved, with no
        // `.env` file on top.
        let code =
            std::ffi::CString::new(&*self.code).map_err(|_| crate::Error::InvalidCharacter)?;
        let argv = [
            exec_path.as_cstr(),
            c"--no-install",
            c"--no-env-file",
            c"-e",
            code.as_c_str(),
        ];
        let env = self.manager.env_mut();
        // Set in the process environment after the loader copied it.
        if bun_io::parent_death_watchdog::is_enabled() {
            env.map.put(b"BUN_FEATURE_FLAG_NO_ORPHANS", b"1")?;
        }
        let envp = env.map.create_null_delimited_env_map()?;
        let envp: Vec<&CStr> = envp.iter().collect();

        #[cfg(windows)]
        {
            self.spawn_windows(&argv, &envp, ipc_output_fds)?;
        }
        #[cfg(not(windows))]
        {
            self.spawn_posix(&argv, &envp, ipc_output_fds)?;
        }

        Ok(())
    }

    /// Posix fd 4: .buffer stdio creates a nonblocking socketpair inside the
    /// spawn machinery. The child's end is dup'd to fd 4 and closed in the
    /// parent by spawn's to_close_at_end list. The parent's
    /// end comes back via spawned.extra_pipes.
    #[cfg(unix)]
    fn spawn_posix(
        &mut self,
        argv: &[&CStr],
        envp: &[&CStr],
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

        let mut spawned = spawn::spawn_process_cstr(&spawn_options, argv, SpawnEnv::Strings(envp))?
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
    /// child's handle, which breaks sync reads in the child.
    /// Instead, create the pipe ourselves with asymmetric flags so only the
    /// parent's write end is overlapped. Child inherits the non-overlapped read
    /// end via .pipe (inherit_fd); parent wraps the overlapped write end in a
    /// uv.Pipe for IOCP-based async writes.
    #[cfg(windows)]
    fn spawn_windows(
        &mut self,
        argv: &[&CStr],
        envp: &[&CStr],
        ipc_output_fds: [Fd; 2],
    ) -> Result<(), Error> {
        use bun_sys::ReturnCodeExt as _;
        use bun_sys::windows::libuv as uv;

        let mut json_fds: [uv::uv_file; 2] = [0; 2];
        // SAFETY: FFI — `json_fds` is a 2-element out-array; flags are valid.
        let pipe_rc = unsafe { uv::uv_pipe(&mut json_fds, 0, uv::UV_NONBLOCK_PIPE as i32) };
        if let Some(e) = pipe_rc.errno() {
            ipc_output_fds[0].close();
            ipc_output_fds[1].close();
            return Err(bun_errno::from_errno(e as i32).into());
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
        // errdefer pipe.closeAndDestroy() until `StaticPipeWriter` takes the
        // pipe (inside `finish_spawn`); from then on the writer's `Drop` closes
        // it. libuv's close callback frees the allocation, so do NOT re-box on
        // the cleanup path.
        let pipe_taken = core::cell::Cell::new(false);
        let mut pipe = scopeguard::guard(pipe_ptr, |p| {
            if !pipe_taken.get() {
                // SAFETY: p is the live Box-allocated uv_pipe_t; close_and_destroy
                // schedules uv_close + frees the allocation.
                unsafe { uv::Pipe::close_and_destroy(p) };
            }
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

        let mut spawned = spawn::spawn_process_cstr(&spawn_options, argv, SpawnEnv::Strings(envp))?
            .map_err(|e| e.to_zig_err())?;
        // `defer spawned.extra_pipes.deinit()` — drops at scope exit.

        ipc_output_fds[1].close();
        fds.0.unwrap().close();
        fds.0 = None;

        self.ipc_reader
            .flags
            .insert(bun_io::pipe_reader::WindowsFlags::NONBLOCKING);

        // Hand the pipe to StaticPipeWriter lazily: the closure reconstitutes
        // the Box at the exact `StaticPipeWriter::create` call site inside
        // `finish_spawn`. If `finish_spawn` errors before that point
        // (`ipc_reader.start()`), the closure drops as a no-op and the
        // still-armed cleanup guard performs `close_and_destroy`.
        self.finish_spawn(&mut spawned, ipc_output_fds[0], || {
            pipe_taken.set(true);
            // SAFETY: `pipe_ptr` is the same allocation produced by
            // heap::alloc above and has not been freed; ownership transfers
            // here exactly once.
            StdioResult::Buffer(unsafe { bun_core::heap::take(pipe_ptr) })
        })?;

        // fd slots are already None.
        scopeguard::ScopeGuard::into_inner(fds);
        Ok(())
    }

    /// Common post-spawn setup: start the fd 3 reader, attach the process,
    /// start the fd 4 JSON writer, and begin watching for exit.
    fn finish_spawn(
        &mut self,
        spawned: &mut spawn::SpawnResult,
        ipc_read_fd: Fd,
        // Deferred constructor: a by-value
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
        self.ipc_reader
            .start(ipc_read_fd, true)
            .map_err(|e| e.to_zig_err())?;

        // `to_process` consumes `SpawnResult` by value on POSIX (and
        // `&mut self` on Windows); take ownership of the result and let the
        // moved-from `*spawned` drop empty (`extra_pipes` already read).
        let event_loop = EventLoopHandle::from_any(&mut self.manager.event_loop);
        let process_handle = std::mem::take(spawned).to_process_handle(event_loop);
        let process: *mut Process = process_handle.as_ptr();

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
            (*parent).process = Some(process_handle);
        }

        // Assign the field BEFORE `start()`. `start()` may complete the write synchronously
        // (small JSON fits the 64KB pipe buffer on POSIX) and re-enter
        // `on_close_io` via the `parent` backref; that callback must observe
        // `json_writer.is_some()` to decrement `remaining_fds`, otherwise
        // `is_done()` never returns true and `sleep_until` hangs.
        let writer =
            StaticPipeWriter::create(event_loop, parent.cast(), make_json_stdio(), json_source);
        // Keep a duped ref locally so no borrow on `(*parent).json_writer` is
        // held across `start()` — `on_close_io` may `.take()` the field.
        let writer_local = writer.clone();
        // SAFETY: see `parent` note above.
        unsafe { (*parent).json_writer = Some(writer) };

        // Error-cleanup guard over the FIELD (not a local),
        // including a presence check on it — `start()` may already
        // have re-entered and nulled it. State is the `parent` backref; disarmed
        // via `into_inner` on the success path.
        let guard = scopeguard::guard(parent, |parent| {
            // SAFETY: `parent` points at the live `self` of `finish_spawn`; the
            // guard only fires on early return inside this fn.
            if let Some(w) = unsafe { (*parent).json_writer.take() } {
                // SAFETY: `w` holds the field's ref; sole live access path.
                unsafe { (*w.as_ptr()).source.detach() };
            }
        });

        let writer_ptr = writer_local.as_ptr();
        // SAFETY: `writer_local` holds a live ref; `start()` mutates the writer
        // in place (raw intrusive object — no Rust aliasing across the RefPtr).
        let start_result = unsafe { (*writer_ptr).start() };
        if let Err(e) = start_result {
            Output::err_generic(
                "Failed to start security scanner JSON pipe writer: {}",
                (e,),
            );
            return Err(crate::Error::JSONPipeWriterFailed);
        }
        // The writer's lifetime is owned by `json_writer`, not by its own
        // `started` ref: release the ref `start()` took and clear the flag so
        // its close path doesn't release it again.
        // SAFETY: `writer_local` keeps `*writer_ptr` live.
        unsafe {
            RefCount::<StaticPipeWriter>::deref(writer_ptr);
            (*writer_ptr).started = false;
        }
        drop(writer_local);

        // SAFETY: `process` is live (we hold a ref); reached via the local raw
        // ptr per the single-provenance note. `watch_or_reap` may re-enter
        // `on_process_exit` synchronously (already-exited child).
        match unsafe { (*process).watch_or_reap() } {
            Err(_) => return Err(crate::Error::ProcessWatchFailed),
            Ok(_) => {}
        }

        scopeguard::ScopeGuard::into_inner(guard);
        Ok(())
    }

    pub(crate) fn on_close_io(&mut self, _: subprocess::StdioKind) {
        if let Some(writer) = self.json_writer.take() {
            // SAFETY: `writer` holds the field's intrusive ref; sole access path
            // (single-threaded event loop callback).
            unsafe { (*writer.as_ptr()).source.detach() };
            self.remaining_fds -= 1;
        }
    }

    pub(crate) fn is_done(&self) -> bool {
        self.exit_status.is_some() && self.remaining_fds == 0
    }

    pub(crate) fn loop_(&mut self) -> *mut AsyncLoop {
        self.manager.event_loop.native_loop()
    }

    pub(crate) fn on_reader_done(&mut self) {
        self.has_received_ipc = true;
        self.remaining_fds -= 1;
    }

    pub(crate) fn on_reader_error(&mut self, err: bun_sys::Error) {
        Output::err_generic("Failed to read security scanner IPC: {}", (err,));
        self.has_received_ipc = true;
        self.remaining_fds -= 1;
    }

    pub(crate) fn on_read_chunk(&mut self, chunk: &[u8], _has_more: ReadState) -> bool {
        self.ipc_data.extend_from_slice(chunk);
        true
    }

    pub(crate) fn on_process_exit(&mut self, _: &mut Process, status: Status, _: &Rusage) {
        self.exit_status = Some(status);

        if !self.has_received_ipc {
            // The JSON may still be in the pipe, so drain it. Only EOF tears down the reader's
            // poll.
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

    pub(crate) fn handle_results(
        &mut self,
        package_paths: &ArrayHashMap<PackageID, PackagePath>,
        start_time: i64,
        packages_scanned: usize,
        security_scanner: &[u8],
        security_scanner_pkg_id: Option<PackageID>,
        is_retry: bool,
    ) -> Result<ScanAttemptResult, Error> {
        let Some(status) = self.exit_status.clone() else {
            Output::err_generic(
                "Security scanner terminated without an exit status. This is a bug in Bun.",
                (),
            );
            return Err(crate::Error::SecurityScannerProcessFailedWithoutExitStatus);
        };

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
            return Err(crate::Error::NoSecurityScanData);
        }

        let json_source =
            bun_ast::Source::init_path_string("ipc-message.json", self.ipc_data.as_slice());

        let mut temp_log = bun_ast::Log::init();

        let parsed = match crate::bun_json::ParsedJson::parse_json(&json_source, &mut temp_log) {
            Ok(e) => e,
            Err(e) => {
                Output::err_generic("Security scanner sent invalid JSON: {}", (e.name(),));
                if self.ipc_data.len() < 1000 {
                    Output::err_generic("Response: {}", (BStr::new(&self.ipc_data),));
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

            let (what, err) = match code_str {
                b"MODULE_NOT_FOUND" => {
                    // Only the first attempt installs it, and only a dependency of the root.
                    if let (false, Some(pkg_id)) = (is_retry, security_scanner_pkg_id) {
                        return Ok(ScanAttemptResult::NeedsInstall(pkg_id));
                    }
                    let name = BStr::new(security_scanner);
                    if !bun_paths::is_package_path(security_scanner) {
                        Output::err_generic(
                            "Security scanner '{}' is configured in bunfig.toml but the file could not be found.\n  <d>Please check that the file exists and the path is correct.<r>",
                            (name,),
                        );
                    } else if is_retry {
                        Output::err_generic(
                            "Security scanner '{}' could not be found after installation attempt.\n  <d>If this is a local file, please check that the file exists and the path is correct.<r>",
                            (name,),
                        );
                    } else {
                        Output::err_generic(
                            "Security scanner '{}' is configured in bunfig.toml but is not installed.\n  <d>To install it, run: bun add --dev {}<r>",
                            (name, name),
                        );
                    }
                    return Err(if is_retry {
                        crate::Error::SecurityScannerNotFound
                    } else {
                        crate::Error::SecurityScannerNotInDependencies
                    });
                }
                b"INVALID_VERSION" => ("error", crate::Error::InvalidScannerVersion),
                b"SCAN_FAILED" => ("failed", crate::Error::ScannerFailed),
                _ => {
                    Output::err_generic(
                        "Unknown security scanner error code: {}",
                        (BStr::new(code_str),),
                    );
                    return Err(crate::Error::UnknownErrorCode);
                }
            };
            if let Some(msg) = json_expr.get(b"message") {
                if let Some(msg_str) = msg.as_utf8_string_literal() {
                    Output::err_generic("Security scanner {}: {}", (what, BStr::new(msg_str)));
                }
            }
            return Err(err);
        } else if type_str != b"result" {
            Output::err_generic(
                "Unknown security scanner message type: {}",
                (BStr::new(type_str),),
            );
            return Err(crate::Error::UnknownMessageType);
        }

        // if we got here then we got a result message so we can continue like normal
        let duration = bun_core::time::milli_timestamp() - start_time;

        if self.manager.options.log_level == crate::package_manager::Options::LogLevel::Verbose {
            match &status {
                Status::Exited(Exited { code, .. }) => {
                    bun_core::pretty_errorln!(
                        "<d>[SecurityProvider]<r> {} with exit code {} [{}ms]",
                        if *code == 0 { "Completed" } else { "Failed" },
                        code,
                        duration
                    );
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
        } else if self.manager.options.log_level
            != crate::package_manager::Options::LogLevel::Silent
            && duration >= 1000
        {
            let maybe_hourglass = if Output::enable_ansi_colors_stderr() {
                "⏳"
            } else {
                ""
            };
            bun_core::pretty_errorln!(
                "<d>{}[{}] Scanning {} package{} took {}ms<r>",
                maybe_hourglass,
                BStr::new(security_scanner),
                packages_scanned,
                if packages_scanned == 1 { "" } else { "s" },
                duration
            );
        }

        let Some(advisories_expr) = json_expr.get(b"advisories") else {
            Output::err_generic("Security scanner result missing 'advisories' field", ());
            return Err(crate::Error::MissingAdvisoriesField);
        };

        let advisories =
            parse_security_advisories_from_expr(self.manager, advisories_expr, package_paths)?;

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
    package_paths: &ArrayHashMap<PackageID, PackagePath>,
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

        let string_or_null = |field: &str, err: Error| -> Result<Option<Box<[u8]>>, Error> {
            let Some(expr) = item.get(field.as_bytes()) else {
                return Ok(None);
            };
            if let Some(str) = expr.as_utf8_string_literal() {
                return Ok(Some(Box::from(str)));
            }
            if matches!(expr.data, ExprData::ENull(_)) {
                return Ok(None);
            }
            Output::err_generic(
                "Security advisory at index {} '{}' field must be a string or null",
                (i, field),
            );
            Err(err)
        };
        let desc_str = string_or_null("description", crate::Error::InvalidDescriptionField)?;
        let url_str = string_or_null("url", crate::Error::InvalidUrlField)?;

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

        advisories_list.push(SecurityAdvisory {
            level,
            package: name_str,
            url: url_str,
            description: desc_str,
            pkg_path,
        });
    }

    Ok(advisories_list.into_boxed_slice())
}
