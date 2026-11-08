use bun_collections::VecExt;
use core::fmt;
use std::io::Write as _;

use crate::cli::Command;
use crate::cli::publish_command as Publish;
use crate::cli::run_command::{ConfigureEnvOptions, RunCommand};
use bun_alloc::AllocError;
use bun_archive::tar;
use bun_ast::{E, Expr, ExprData};
use bun_collections::StringHashMap;
use bun_core::ZBox;
use bun_core::{Global, Output, Progress, fmt as bun_fmt};
use bun_core::{ZStr, strings};
use bun_install::PackageManager;
use bun_install::package_manager::LogLevel;
use bun_install::package_manager::workspace_manifests::WorkspaceManifests;
use bun_install::package_manager::workspace_package_json_cache as WorkspacePackageJSONCache;
pub(crate) use bun_install::published_files::*;
use bun_js_printer as js_printer;
use bun_parsers::json as JSON;
use bun_paths::resolve_path;
use bun_paths::{self as path, SEP_STR};
use bun_sha_hmac::sha;
use bun_sys::{
    self, CloseOnDrop, Dir, Fd, FdDirExt as _, FdExt as _, File, dir_iterator as DirIterator,
};

/// Process-lifetime arena for `Expr::as_string*` / `E::EString` data.
fn pack_bump() -> &'static bun_alloc::Arena {
    thread_local! {
        static BUMP: bun_alloc::Arena = bun_alloc::Arena::new();
    }
    // SAFETY: the CLI thread lives as long as the process, so `BUMP` is never dropped; `Arena` is `!Sync`.
    BUMP.with(|b| unsafe { &*std::ptr::from_ref::<bun_alloc::Arena>(b) })
}

/// Returns a raw projection, because `pack()` holds the resulting `&mut MapEntry` across other uses
/// of `ctx.manager`.
#[inline]
fn pm_workspace_cache<'a>(
    m: *mut PackageManager,
) -> &'a mut WorkspacePackageJSONCache::WorkspacePackageJSONCache {
    // SAFETY: `m` is the caller's live `&mut PackageManager`; `pack()` touches the cache only through here.
    unsafe { &mut (*m).workspace_package_json_cache }
}

pub(crate) struct PackCommand;

pub(crate) struct Context<'a> {
    pub(crate) manager: &'a mut PackageManager,
    pub(crate) command_ctx: Command::Context<'a>,
    pub(crate) bundled_deps: Vec<BundledDep>,
    pub(crate) stats: Stats,
}

#[derive(Default, Clone, Copy)]
pub(crate) struct Stats {
    pub(crate) unpacked_size: usize,
    pub(crate) total_files: usize,
    pub(crate) packed_size: usize,
    pub(crate) bundled_deps: usize,
}

impl<'a> Context<'a> {
    pub(crate) fn print_summary(
        stats: Stats,
        maybe_shasum: Option<&[u8; sha::SHA1::DIGEST]>,
        maybe_integrity: Option<&[u8; sha::SHA512::DIGEST]>,
        log_level: LogLevel,
    ) {
        if log_level != LogLevel::Silent && log_level != LogLevel::Quiet {
            bun_core::prettyln!("\n<r><b><blue>Total files<r>: {}", stats.total_files);
            if let Some(shasum) = maybe_shasum {
                bun_core::prettyln!(
                    "<b><blue>Shasum<r>: {}",
                    bun_fmt::bytes_to_hex_lower_string(shasum),
                );
            }
            if let Some(integrity) = maybe_integrity {
                bun_core::prettyln!(
                    "<b><blue>Integrity<r>: {}",
                    bun_fmt::integrity::<true>(*integrity),
                );
            }
            bun_core::prettyln!(
                "<b><blue>Unpacked size<r>: {}",
                fmt_size(stats.unpacked_size)
            );
            if stats.packed_size > 0 {
                bun_core::pretty!("<b><blue>Packed size<r>: {}\n", fmt_size(stats.packed_size));
            }
            if stats.bundled_deps > 0 {
                bun_core::pretty!("<b><blue>Bundled deps<r>: {}\n", stats.bundled_deps);
            }
        }
    }

    pub(crate) fn print_tarball_path(path: impl fmt::Display, log_level: LogLevel) {
        // Quiet/silent output must be only the tarball path so `$(bun pm pack --quiet)` works.
        if log_level != LogLevel::Silent && log_level != LogLevel::Quiet {
            bun_core::pretty!("\n");
        }
        bun_core::pretty!("{}\n", bun_fmt::EscapeControlChars(path));
    }
}

fn fmt_size(bytes: usize) -> bun_fmt::SizeFormatter {
    bun_fmt::size(
        bytes,
        bun_fmt::SizeFormatterOptions {
            space_between_number_and_unit: false,
        },
    )
}

#[derive(Clone)]
pub(crate) struct BundledDep {
    pub name: Box<[u8]>,
}

impl PackCommand {
    pub(crate) fn exec_with_manager(
        ctx: Command::Context<'_>,
        manager: &mut PackageManager,
        original_cwd: &[u8],
    ) -> crate::Result<()> {
        if manager.options.log_level != LogLevel::Silent
            && manager.options.log_level != LogLevel::Quiet
        {
            bun_core::prettyln!(
                "<r><b>bun pack <r><d>v{}<r>",
                Global::package_json_version_with_sha,
            );
            Output::flush();
        }

        let options = &mut manager.options;
        if !options.pack_filename.is_empty() && !options.pack_destination.is_empty() {
            Output::err_generic(
                "cannot use both filename and destination at the same time with tarball: filename \"{}\" and destination \"{}\"",
                (
                    bstr::BStr::new(strings::without_trailing_slash(options.pack_filename)),
                    bstr::BStr::new(strings::without_trailing_slash(options.pack_destination)),
                ),
            );
            Global::crash();
        }
        // The path is relative to `original_cwd`, and `PackageManager::init` has changed the
        // directory since.
        let mut abs_buf = bun_paths::path_buffer_pool::get();
        for (what, option) in [
            ("filename", &mut options.pack_filename),
            ("destination name", &mut options.pack_destination),
        ] {
            if option.is_empty() {
                continue;
            }
            let Some(abs) = resolve_path::join_abs_string_buf_checked::<path::platform::Auto>(
                original_cwd,
                &mut abs_buf,
                &[*option],
            ) else {
                Output::err_generic(
                    "archive {} too long: \"{}\"",
                    (
                        what,
                        bstr::BStr::new(strings::without_trailing_slash(*option)),
                    ),
                );
                Global::crash();
            };
            *option = crate::cli::cli_dupe(abs);
        }
        drop(abs_buf);

        let abs_pkg_json = ZBox::from_bytes(manager.original_package_json_path.as_bytes());

        let pack_ctx = Context {
            manager,
            command_ctx: ctx,
            bundled_deps: Vec::new(),
            stats: Stats::default(),
        };

        // just pack the current workspace
        if let Err(err) = pack(pack_ctx, &abs_pkg_json, false) {
            match err {
                PackError::OutOfMemory => bun_core::out_of_memory(),
                PackError::MissingPackageName | PackError::MissingPackageVersion => {
                    Output::err_generic(
                        "package.json must have `name` and `version` fields",
                        format_args!(""),
                    );
                    Global::crash();
                }
                PackError::InvalidPackageName | PackError::InvalidPackageVersion => {
                    Output::err_generic(
                        "package.json `name` and `version` fields must be non-empty strings",
                        format_args!(""),
                    );
                    Global::crash();
                }
                // `pack` returns these only for a publish.
                PackError::RestrictedUnscopedPackage | PackError::PrivatePackage => unreachable!(),
            }
        }
        Ok(())
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("MissingPackageName")]
    MissingPackageName,
    #[error("InvalidPackageName")]
    InvalidPackageName,
    #[error("MissingPackageVersion")]
    MissingPackageVersion,
    #[error("InvalidPackageVersion")]
    InvalidPackageVersion,
    // `pack` returns the following two only for a publish.
    #[error("RestrictedUnscopedPackage")]
    RestrictedUnscopedPackage,
    #[error("PrivatePackage")]
    PrivatePackage,
}

impl From<AllocError> for PackError {
    fn from(_: AllocError) -> Self {
        PackError::OutOfMemory
    }
}

/// The start of the temporary tarball's filename. The rest comes from `FileSystem::tmpname`, which
/// starts with a `.` and, as called here, ends in `.tmp`.
const UNFINISHED_TARBALL_PREFIX: &[u8] = b".bun-pack";

struct PackListEntry {
    subpath: ZBox,
    size: usize,
}
type PackList = Vec<PackListEntry>;

/// A package that is packed into one of the tarball's `node_modules` folders.
struct BundledPackage {
    /// Its path in the tarball: `node_modules/a`, or `node_modules/a/node_modules/b` when `a` needs
    /// its own copy of `b`.
    subpath: Box<[u8]>,
    /// The offset in `subpath` where the package's name starts.
    name_start: usize,
    /// The folder on disk that its files are read from, with symlinks resolved.
    real_path: Box<[u8]>,
    /// The index of the bundled package whose `node_modules` contains it. `None` means the
    /// `node_modules` of the package being packed.
    parent: Option<usize>,
}

/// A file to archive at `path` in the tarball, with the contents of the file `source` on disk.
struct BundledFile {
    path: ZBox,
    source: ZBox,
    /// If set, archived instead of the contents of `source`. It is a workspace's package.json,
    /// edited the same way as for the workspace's own tarball.
    edited: Option<Box<[u8]>>,
}

#[derive(Default)]
struct Bundle {
    packages: Vec<BundledPackage>,
    /// Maps a `BundledPackage::subpath` to the package's index in `packages`.
    placed: StringHashMap<usize>,
    /// Indexes of transitive dependencies that have a place in the tarball, but whose files and
    /// dependencies have not been collected yet.
    pending: Vec<usize>,
    files: Vec<BundledFile>,
    /// The workspace root, or the folder of the package being packed if it is not in a workspace,
    /// with symlinks resolved.
    project_path: Box<[u8]>,
}

impl Bundle {
    fn subpath_in(&self, parent: Option<usize>, name: &[u8]) -> Vec<u8> {
        match parent {
            Some(parent) => [&*self.packages[parent].subpath, b"/node_modules/", name].concat(),
            None => [b"node_modules/".as_slice(), name].concat(),
        }
    }

    fn place(
        &mut self,
        parent: Option<usize>,
        name: &[u8],
        real_path: Box<[u8]>,
    ) -> Result<usize, AllocError> {
        let subpath = self.subpath_in(parent, name);
        let index = self.packages.len();
        self.placed.put(&subpath, index)?;
        self.packages.push(BundledPackage {
            name_start: subpath.len() - name.len(),
            subpath: subpath.into_boxed_slice(),
            real_path,
            parent,
        });
        Ok(index)
    }

    /// The package that `require(name)` in the bundled package `from` resolves to once the tarball
    /// is unpacked.
    fn visible_from(&self, from: usize, name: &[u8]) -> Option<&BundledPackage> {
        let mut level = Some(from);
        loop {
            if let Some(&index) = self.placed.get(self.subpath_in(level, name).as_slice()) {
                return Some(&self.packages[index]);
            }
            level = self.packages[level?].parent;
        }
    }
}

/// The folder that `require(name)` resolves to from `from`, with symlinks resolved, and whether it
/// is in `from`'s own `node_modules`. The search does not go above `project`.
fn resolve_installed(project: &[u8], from: &[u8], name: &[u8]) -> Option<(Box<[u8]>, bool)> {
    let mut spill: Vec<u8> = Vec::new();
    let mut real_path_buf = bun_paths::path_buffer_pool::get();
    let ancestors = || core::iter::successors(Some(from), |&dir| path::dirname(dir));
    let last = ancestors()
        .find(|dir| *dir == project)
        .or_else(|| strings::index_of(from, path::NODE_MODULES_NEEDLE).map(|at| &from[..at]))
        .unwrap_or(from);
    for dir in ancestors().take_while(|dir| dir.len() >= last.len()) {
        if path::basename(dir) == b"node_modules" {
            continue;
        }
        let parts: [&[u8]; 3] = [dir, b"node_modules", name];
        let candidate =
            resolve_path::join_z_spill::<resolve_path::platform::Auto>(&mut spill, &parts);
        let Some(found) = open_dir_if_present(&Dir::cwd(), candidate) else {
            continue;
        };
        let real_path = found
            .get_fd_path(&mut real_path_buf)
            .unwrap_or_else(|err| fail_open_dir(err.into(), candidate.as_bytes()));
        return Some((Box::from(&*real_path), dir.len() == from.len()));
    }
    None
}

/// Returns the files of the bundled dependencies and of everything they depend on, sorted by their
/// path in the tarball.
fn iterate_bundled_deps(
    bundled_deps: &mut Vec<BundledDep>,
    // The package.json of the package being packed. It is passed by value because the cache entry
    // it comes from can move when the workspace manifests are loaded.
    package_json: Expr,
    stats: &mut Stats,
    manager: &mut PackageManager,
    workspace_manifests: &mut Option<WorkspaceManifests>,
    root_dir: &Dir,
    log_level: LogLevel,
) -> Result<Vec<BundledFile>, AllocError> {
    let mut bundle = Bundle::default();
    if bundled_deps.is_empty() {
        return Ok(bundle.files);
    }

    let mut root_path_buf = bun_paths::path_buffer_pool::get();
    let root_path: &[u8] = root_dir
        .get_fd_path(&mut root_path_buf)
        .unwrap_or_else(|err| fail_open_dir(err.into(), b"."));
    {
        let project_path = path::fs::FileSystem::instance().top_level_dir();
        let mut project_path_buf = bun_paths::path_buffer_pool::get();
        bundle.project_path = (Dir::cwd().open_dir(project_path, ITERABLE))
            .and_then(|project_dir| {
                Ok(Box::from(&*project_dir.get_fd_path(&mut project_path_buf)?))
            })
            .unwrap_or_else(|err| fail_open_dir(err.into(), project_path));
    }

    let is_in = |group: &[u8], name: &[u8]| {
        (package_json.get(group)).is_some_and(|dependencies| dependencies.get(name).is_some())
    };

    // Place every listed dependency at the top level first, so that a dependency of one of them
    // cannot take the place of another.
    for dep in core::mem::take(bundled_deps) {
        let found = bun_install::package_installer::alias_is_safe_install_target(&dep.name)
            .then(|| resolve_installed(&bundle.project_path, root_path, &dep.name))
            .flatten();
        let Some((real_path, _)) = found else {
            // Like npm, skip a missing package that an install may omit: an optional dependency for
            // another platform, a peer, a devDependency, or a name in no dependency group.
            if !is_in(b"dependencies", &dep.name) || is_in(b"optionalDependencies", &dep.name) {
                continue;
            }
            // The tarball's package.json tells installers that this package is inside the tarball.
            Output::err_generic(
                "bundled dependency \"{}\" is not installed",
                format_args!("{}", bstr::BStr::new(&dep.name)),
            );
            Global::crash();
        };
        let subpath = bundle.subpath_in(None, &dep.name);
        if !bundle.placed.contains_key(subpath.as_slice()) {
            bundle.place(None, &dep.name, real_path)?;
        }
        bundled_deps.push(dep);
    }

    let mut add = |bundle: &mut Bundle, index: usize| {
        stats.bundled_deps += 1;
        add_bundled_dep(
            bundle,
            index,
            manager,
            workspace_manifests,
            root_path,
            log_level,
        )
    };
    for index in 0..bundle.packages.len() {
        add(&mut bundle, index)?;
    }
    while let Some(index) = bundle.pending.pop() {
        let package = &bundle.packages[index];
        bundled_deps.push(BundledDep {
            name: Box::from(&package.subpath[package.name_start..]),
        });
        add(&mut bundle, index)?;
    }

    bun_collections::index_sort::sort_slice_by(&mut bundle.files, |a, b| {
        strings::order(a.path.as_bytes(), b.path.as_bytes())
    });
    Ok(bundle.files)
}

/// Adds the files of the bundled package `index` to `bundle.files`, and gives its dependencies a
/// place in the tarball.
fn add_bundled_dep(
    bundle: &mut Bundle,
    index: usize,
    manager: &mut PackageManager,
    manifests: &mut Option<WorkspaceManifests>,
    root_path: &[u8],
    log_level: LogLevel,
) -> Result<(), AllocError> {
    let subpath = bundle.packages[index].subpath.clone();
    let real_path = bundle.packages[index].real_path.clone();
    let dir = (Dir::cwd().open_dir(&real_path, ITERABLE))
        .unwrap_or_else(|err| fail_open_dir(err.into(), &real_path));

    let log = manager.log_mut();

    let source = match File::read_from(dir.fd, b"package.json") {
        Ok(bytes) => Some(bun_ast::Source::init_path_string_owned(
            b"package.json",
            bytes,
        )),
        Err(err) if is_absent(err.get_errno()) || err.get_errno() == bun_sys::E::EISDIR => None,
        Err(err) => {
            Output::err(
                err,
                "failed to read package.json: \"{}/package.json\"",
                format_args!("{}", bstr::BStr::new(&subpath)),
            );
            Global::crash();
        }
    };
    let mut parse = || {
        (source.as_ref())
            .and_then(|source| JSON::parse_package_json_utf8(source, &mut *log, pack_bump()).ok())
            .inspect(|json| drop_shadowed_properties(*json))
    };
    let mut json = parse();

    // A folder whose real path below the project has no `node_modules` component is a workspace
    // or a linked folder, not an installed copy. The walk for installed copies reads no ignore
    // file, so such a folder does not take it, whether or not its package.json loads.
    let below_project = (real_path.strip_prefix(&*bundle.project_path)).unwrap_or(&real_path);
    let is_own_package = !strings::contains(below_project, path::NODE_MODULES_NEEDLE);
    if is_own_package && manifests.is_none() && json.is_some_and(needs_workspace_manifests) {
        // Loading the workspace manifests resets the `Store` that holds `json`, so parse it again.
        *manifests = Some(WorkspaceManifests::load(manager));
        json = parse();
    }

    if let Some(json) = &json {
        find_dependencies_to_bundle(bundle, index, json, root_path)?;
    }
    if is_own_package {
        return add_own_package(
            bundle,
            &subpath,
            &real_path,
            dir,
            source.as_ref().zip(json.as_ref()),
            manifests.as_ref(),
            log_level,
        );
    }

    // `is_excluded` only treats depth 1, the project root, specially. Any other depth works.
    const PACKAGE_DEPTH: usize = 2;
    let mut dirs = vec![DirInfo(dir, subpath.clone(), PACKAGE_DEPTH)];

    while let Some(DirInfo(dir, dir_subpath, dir_depth)) = dirs.pop() {
        let mut iter = DirIterator::iterate(Fd::from_std_dir(&dir));
        while let Some(entry) = next_dir_entry(&mut iter, &dir_subpath) {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice_u8();
            let entry_subpath_ = entry_subpath(&dir_subpath, entry_name)?;

            if dir_depth == PACKAGE_DEPTH && entry_name == b"node_modules" {
                continue;
            }

            if let Exclusion::Excluded(pattern, kind) =
                is_excluded(&entry, &entry_subpath_, dir_depth, &[], &None)
            {
                print_ignored(log_level, kind, pattern, &entry_subpath_, entry.kind);
                continue;
            }

            if entry.kind == bun_sys::FileKind::File {
                let in_package = &entry_subpath_.as_bytes()[subpath.len() + 1..];
                bundle.files.push(BundledFile {
                    source: entry_subpath(&real_path, in_package)?,
                    path: entry_subpath_,
                    edited: None,
                });
            } else {
                let subdir = open_subdir(&dir, entry_name, &entry_subpath_);
                dirs.push(DirInfo(
                    subdir,
                    entry_subpath_.as_bytes().into(),
                    dir_depth + 1,
                ));
            }
        }
    }

    Ok(())
}

/// Adds the files of a bundled workspace or linked folder. Like in npm, a folder that has a
/// package.json entry is packed as a package, and a folder that has none as a directory.
fn add_own_package(
    bundle: &mut Bundle,
    subpath: &[u8],
    real_path: &[u8],
    dir: Dir,
    // `None` if the package.json is missing, can't be read as a file, or does not parse.
    manifest: Option<(&bun_ast::Source, &Expr)>,
    workspace_manifests: Option<&WorkspaceManifests>,
    log_level: LogLevel,
) -> Result<(), AllocError> {
    let mut add_file = |file: &[u8], edited: Option<Box<[u8]>>| -> Result<(), AllocError> {
        bundle.files.push(BundledFile {
            path: entry_subpath(subpath, file)?,
            source: entry_subpath(real_path, file)?,
            edited,
        });
        Ok(())
    };

    let json = match manifest {
        Some((source, json)) => {
            let edited = if needs_workspace_manifests(*json) {
                let indentation = JSON::guess_indentation(&source.contents);
                Some(edit_root_package_json(
                    workspace_manifests,
                    real_path,
                    *json,
                    source,
                    indentation,
                )?)
            } else {
                None
            };
            add_file(b"package.json", edited)?;
            *json
        }
        None => match bin_kind_without_following_symlinks(real_path, b"package.json") {
            bun_sys::FileKind::Unknown => {
                let mut files = PackQueue::default();
                // `is_excluded` removes `depth - 1` components from a path to anchor the patterns
                // of an ignore file.
                let depth = strings::count_char(subpath, b'/') + 2;
                iterate_project_tree(
                    &mut files,
                    &[],
                    Some(&[]),
                    DirInfo(dir, subpath.into(), depth),
                    log_level,
                )?;
                for file in files.into_paths() {
                    add_file(&file.as_bytes()[subpath.len() + 1..], None)?;
                }
                return Ok(());
            }
            kind => {
                // A package.json that does not parse is packed as it is.
                if kind == bun_sys::FileKind::File {
                    add_file(b"package.json", None)?;
                }
                Expr::init(E::Object::default(), Default::default())
            }
        },
    };
    let (published, _) = published_files(&dir, real_path, &json, pack_bump(), log_level)?;
    for file in published.into_paths() {
        add_file(file.as_bytes(), None)?;
    }
    Ok(())
}

/// Gives each dependency of the bundled package `index` a place in the tarball, chosen so that the
/// unpacked package resolves the same copy of the dependency as it does on disk.
fn find_dependencies_to_bundle(
    bundle: &mut Bundle,
    index: usize,
    json: &Expr,
    root_path: &[u8],
) -> Result<(), AllocError> {
    for dependency_group in [
        b"dependencies".as_slice(),
        b"optionalDependencies".as_slice(),
    ] {
        let Some(ExprData::EObject(dependencies)) = json.get(dependency_group).map(|e| e.data)
        else {
            continue;
        };
        for dep in dependencies.properties.slice() {
            let (Some(key), Some(_)) = (&dep.key, &dep.value) else {
                continue;
            };
            let Some(dep_name) = key.as_utf8_string_literal() else {
                continue;
            };
            // The key becomes a path below `node_modules`.
            if !bun_install::package_installer::alias_is_safe_install_target(dep_name) {
                continue;
            }

            let from = &bundle.packages[index].real_path;
            let Some((real_path, is_nested)) =
                resolve_installed(&bundle.project_path, from, dep_name)
            else {
                continue;
            };
            // A bundled workspace can depend on the package being packed. That one is not bundled.
            if *real_path == *root_path {
                continue;
            }

            let other_at_the_top = || {
                resolve_installed(&bundle.project_path, root_path, dep_name)
                    .is_some_and(|(other, _)| other != real_path)
            };
            let parent = match bundle.visible_from(index, dep_name) {
                Some(visible) if visible.real_path == real_path => continue,
                Some(_) => Some(index),
                // Nest it if it is nested on disk, or if hoisting it would change which copy the
                // package being packed resolves this name to.
                None if is_nested || other_at_the_top() => Some(index),
                None => None,
            };
            // In a dependency cycle through two versions of two packages, each copy needs the next
            // one nested inside it, which would never end.
            let copies_above =
                core::iter::successors(parent, |&above| bundle.packages[above].parent)
                    .filter(|&above| bundle.packages[above].real_path == real_path)
                    .count();
            if copies_above > 1 {
                Output::err_generic(
                    "bundled dependencies form a cycle: \"{}\"",
                    format_args!(
                        "{}",
                        bun_fmt::escape_control_chars(&bundle.subpath_in(parent, dep_name)),
                    ),
                );
                Global::crash();
            }
            let placed = bundle.place(parent, dep_name, real_path)?;
            bundle.pending.push(placed);
        }
    }

    Ok(())
}

/// JS truthiness of `private`, like npm's `if (manifest.private)` check.
pub(crate) fn is_private_package(json: &Expr) -> bool {
    let Some(private) = json.get(b"private") else {
        return false;
    };
    match &private.data {
        ExprData::ENull(_) | ExprData::EUndefined(_) => false,
        ExprData::EBoolean(b) | ExprData::EBranchBoolean(b) => b.value,
        ExprData::ENumber(n) => n.value() != 0.0 && !n.value().is_nan(),
        ExprData::EString(s) => s.is_present(),
        _ => true,
    }
}

fn get_bundled_deps(json: &Expr, field: &'static str) -> Option<Vec<BundledDep>> {
    let bundled_deps = json.get(field.as_bytes())?;
    let names: Option<Vec<Expr>> = match &bundled_deps.data {
        ExprData::EArray(array) => Some(array.items.slice().to_vec()),
        ExprData::EBoolean(all) => Some(match json.get(b"dependencies").map(|e| e.data) {
            Some(ExprData::EObject(dependencies)) if all.value => (dependencies.properties.slice())
                .iter()
                .filter(|dependency| dependency.value.is_some())
                .filter_map(|dependency| dependency.key)
                .collect(),
            _ => Vec::new(),
        }),
        _ => None,
    };
    let deps: Option<Vec<BundledDep>> = names.and_then(|names| {
        let dep = |name: &Expr| {
            Some(BundledDep {
                name: name.as_string(pack_bump())?.into(),
            })
        };
        names.iter().map(dep).collect()
    });
    if deps.is_none() {
        Output::err_generic(
            "expected `{}` to be a boolean or an array of strings",
            format_args!("{}", field),
        );
        Global::crash();
    }
    deps
}

/// Reads it through the manager's cache. Exits if it can't be read or parsed.
pub(crate) fn package_json_entry<'a>(
    manager: &mut PackageManager,
    abs_package_json_path: &ZStr,
) -> &'a mut WorkspacePackageJSONCache::MapEntry {
    let log = manager.log_mut();
    match pm_workspace_cache(manager).get_with_path(
        log,
        abs_package_json_path.as_bytes(),
        WorkspacePackageJSONCache::GetJSONOptions {
            guess_indentation: true,
            ..Default::default()
        },
    ) {
        WorkspacePackageJSONCache::GetResult::ReadErr(err) => {
            Output::err(
                err,
                "failed to read package.json: {}",
                format_args!("{}", bstr::BStr::new(abs_package_json_path.as_bytes())),
            );
            Global::crash();
        }
        WorkspacePackageJSONCache::GetResult::ParseErr(err) => {
            Output::err(
                err,
                "failed to parse package.json: {}",
                format_args!("{}", bstr::BStr::new(abs_package_json_path.as_bytes())),
            );
            let _ = log.print(std::ptr::from_mut(Output::error_writer()));
            Global::crash();
        }
        WorkspacePackageJSONCache::GetResult::Entry(entry) => {
            drop_shadowed_properties(entry.root);
            entry
        }
    }
}

/// When an object has several properties with the same key, `JSON.parse` keeps the last one. This
/// removes the earlier ones in place, so that all readers of the package.json agree.
pub(crate) fn drop_shadowed_properties(json: Expr) {
    let ExprData::EObject(mut object) = json.data else {
        return;
    };
    let mut seen: StringHashMap<()> = StringHashMap::default();
    // Built from the last property to the first, so that `pop` returns the flags in property order.
    let mut is_last: Vec<bool> = (object.properties.slice().iter().rev())
        .map(|property| {
            let key = property.key.as_ref().and_then(Expr::as_utf8_string_literal);
            key.is_none_or(|key| !bun_core::handle_oom(seen.get_or_put(key)).found_existing)
        })
        .collect();
    object.properties.retain(|_| is_last.pop().unwrap_or(true));
    for property in object.properties.slice() {
        if let Some(value) = property.value {
            drop_shadowed_properties(value);
        }
    }
}

/// Applies the `publishConfig` of `package_json`, then rejects what `bun publish` cannot publish: a
/// provenance request, a restricted package without a scope, or a private package.
fn apply_publish_config(
    manager: &mut PackageManager,
    package_json: &Expr,
    package_name: &[u8],
) -> Result<(), PackError> {
    let is_scoped = bun_install::dependency::is_scoped_package_name(package_name)
        .map_err(|_| PackError::InvalidPackageName)?;
    manager
        .options
        .apply_publish_config(package_json, pack_bump(), package_name)?;
    Publish::PublishCommand::refuse_provenance(manager, package_json);
    if manager.options.publish_config.access == Some(bun_install::Access::Restricted) && !is_scoped
    {
        return Err(PackError::RestrictedUnscopedPackage);
    }
    if is_private_package(package_json) {
        return Err(PackError::PrivatePackage);
    }
    Ok(())
}

/// Both become part of the tarball's filename.
fn name_and_version(package_json: &Expr) -> Result<(&'static [u8], &'static [u8]), PackError> {
    let field =
        |name: &[u8], missing: PackError, invalid: PackError| -> Result<&'static [u8], PackError> {
            let value = (package_json.get(name).ok_or(missing)?)
                .as_string_cloned(pack_bump())?
                .ok_or(invalid)?;
            if value.is_empty() || has_unsafe_tarball_filename_part(value) {
                return Err(invalid);
            }
            Ok(value)
        };
    Ok((
        field(
            b"name",
            PackError::MissingPackageName,
            PackError::InvalidPackageName,
        )?,
        field(
            b"version",
            PackError::MissingPackageVersion,
            PackError::InvalidPackageVersion,
        )?,
    ))
}

#[cold]
fn fail_file(err: impl bun_core::output::ErrName, action: &str, path: &[u8]) -> ! {
    Output::err(
        err,
        "failed to {} file: \"{}\"",
        (action, bstr::BStr::new(path)),
    );
    Global::crash();
}

type TarballWriter<'a> = tar::writer::Writer<tar::gzip::Encoder<&'a mut dyn FnMut(&[u8])>>;

/// `Some` exactly when `for_publish`.
#[inline(never)]
pub(crate) fn pack(
    mut ctx: Context<'_>,
    abs_package_json_path: &ZStr,
    for_publish: bool,
) -> Result<Option<Publish::Context>, PackError> {
    let log_level = ctx.manager.options.log_level;
    let bump = pack_bump();
    let mut json = package_json_entry(ctx.manager, abs_package_json_path);

    let (mut package_name, mut package_version) = name_and_version(&json.root)?;
    // The target from the command line and config files, before `publishConfig` is applied.
    let target_before = for_publish.then(|| ctx.manager.options.publish_target(package_name));
    if for_publish {
        apply_publish_config(ctx.manager, &json.root, package_name)?;
    }

    let mut this_transpiler: core::mem::MaybeUninit<bun_bundler::Transpiler<'static>> =
        core::mem::MaybeUninit::uninit();

    let (this_transpiler, _) = match RunCommand::configure_env_for_run(
        &mut *ctx.command_ctx,
        &mut this_transpiler,
        Some(std::ptr::from_mut(ctx.manager.env_mut())),
        ConfigureEnvOptions {
            log_errors: ctx.manager.options.log_level != LogLevel::Silent,
            store_root_fd: false,
        },
    ) {
        Ok(configured) => configured,
        Err(err) => {
            if matches!(err, crate::Error::Alloc(_)) {
                return Err(PackError::OutOfMemory);
            }
            Output::err_generic(
                "failed to run pack scripts due to error: {}\n",
                format_args!("{}", err.name()),
            );
            Global::crash();
        }
    };

    let abs_workspace_path: &[u8] = path::string_paths::without_trailing_slash_windows_path(
        strings::without_suffix_comptime(abs_package_json_path.as_bytes(), b"package.json"),
    );
    /// `MaybeUninit` does not drop its contents.
    struct DeinitTranspiler(*mut bun_bundler::Transpiler<'static>);
    impl Drop for DeinitTranspiler {
        fn drop(&mut self) {
            // SAFETY: points at the initialized `this_transpiler` stack slot, which outlives the guard.
            unsafe { (*self.0).deinit() };
        }
    }
    let _deinit_transpiler = DeinitTranspiler(this_transpiler);
    let script_env = &mut ctx.manager.env_mut().map;
    script_env.put(b"npm_command", b"pack")?;
    // `configure_env_for_run` described the workspace root's package.json, not the one packed.
    script_env.put(b"npm_package_json", abs_package_json_path.as_bytes())?;
    script_env.put(b"npm_package_name", package_name)?;
    script_env.put(b"npm_package_version", package_version)?;

    let mut ran_scripts = false;
    let mut postpack_script: Option<Box<[u8]>> = None;
    let mut publish_script: Option<Box<[u8]>> = None;
    let mut postpublish_script: Option<Box<[u8]>> = None;
    if ctx.manager.options.do_.run_scripts()
        && let Some(scripts) = json.root.get(b"scripts")
        && matches!(scripts.data, ExprData::EObject(_))
    {
        let script = |name: &[u8]| scripts.get(name).and_then(|script| script.as_string(bump));
        let before_pack: &[&[u8]] = if for_publish {
            &[b"prepublishOnly", b"prepack", b"prepare"]
        } else {
            &[b"prepack", b"prepare"]
        };
        for &name in before_pack {
            if let Some(script) = script(name) {
                ran_scripts = true;
                run_lifecycle_script(&mut ctx, script, name, abs_workspace_path)?;
            }
        }
        postpack_script = script(b"postpack").map(Box::from);
        if for_publish {
            publish_script = script(b"publish").map(Box::from);
            postpublish_script = script(b"postpublish").map(Box::from);
        }
    }

    // The scripts may have edited any package.json in the workspace, and the cache predates them.
    if ran_scripts {
        pm_workspace_cache(ctx.manager).map.clear();
        json = package_json_entry(ctx.manager, abs_package_json_path);
        (package_name, package_version) = name_and_version(&json.root)?;
        if let Some(target_before) = &target_before {
            ctx.manager.options.set_publish_target(target_before)?;
            apply_publish_config(ctx.manager, &json.root, package_name)?;
        }
    }

    // This has to come after the scripts, because one of them may write the real version.
    if for_publish {
        package_version =
            published_version(package_version).ok_or(PackError::InvalidPackageVersion)?;
        Publish::PublishCommand::refuse_tag(ctx.manager, package_version);
    }

    ctx.bundled_deps = get_bundled_deps(&json.root, "bundledDependencies")
        .or_else(|| get_bundled_deps(&json.root, "bundleDependencies"))
        .unwrap_or_default();

    let mut workspace_manifests =
        needs_workspace_manifests(json.root).then(|| WorkspaceManifests::load(ctx.manager));
    if workspace_manifests.is_some() {
        // Loading added the other workspaces' package.json files to the cache `json` points into.
        json = package_json_entry(ctx.manager, abs_package_json_path);
    }

    let root_dir: Dir = match Dir::cwd().open_dir(abs_workspace_path, ITERABLE) {
        Ok(d) => d,
        Err(err) => {
            Output::err(
                crate::Error::from(err),
                "failed to open root directory: {}\n",
                format_args!("{}", bstr::BStr::new(abs_workspace_path)),
            );
            Global::crash();
        }
    };

    // The registry gets the same `readme` / `readmeFilename` metadata that `npm publish` sends.
    let workspace_readme: Option<Publish::ReadmeInfo> = for_publish
        .then(|| Publish::PublishCommand::find_workspace_readme(abs_workspace_path))
        .flatten();

    let (mut pack_queue, bins) =
        published_files(&root_dir, abs_workspace_path, &json.root, bump, log_level)?;

    let bundled_files = iterate_bundled_deps(
        &mut ctx.bundled_deps,
        json.root,
        &mut ctx.stats,
        ctx.manager,
        &mut workspace_manifests,
        &root_dir,
        log_level,
    )?;

    // Bundling a workspace can load the manifests too, which resets the `Store`, so fetch the entry
    // again before copying it.
    json = package_json_entry(ctx.manager, abs_package_json_path);
    // Edit a copy. The edits add `Store` nodes, and the next workspace of `bun publish -r` still
    // reads the cached tree.
    let root = json.root.deep_clone(bump);
    let mut root = root.map_err(|_| PackError::OutOfMemory)?;
    let edited_package_json = edit_root_package_json(
        workspace_manifests.as_ref(),
        abs_workspace_path,
        root,
        &json.source,
        json.indentation,
    )?;

    // +1 for package.json
    ctx.stats.total_files = pack_queue.count() + bundled_files.len() + 1;

    let prints_bare_filename = ctx.manager.options.pack_destination.is_empty()
        && ctx.manager.options.pack_filename.is_empty();
    let bare_filename =
        fmt_tarball_filename(package_name, package_version, TarballNameStyle::Normalize);

    if ctx.manager.options.dry_run {
        // don't create the tarball, but run scripts if they exist

        print_archived_files_and_packages(
            &mut ctx,
            &root_dir,
            PackListOrQueue::Queue(&mut pack_queue),
        );

        if !for_publish {
            if prints_bare_filename {
                Context::print_tarball_path(bare_filename, log_level);
            } else {
                let mut dest_buf = bun_paths::path_buffer_pool::get();
                let (abs_tarball_dest, _) = tarball_destination(
                    ctx.manager.options.pack_destination,
                    ctx.manager.options.pack_filename,
                    abs_workspace_path,
                    bare_filename,
                    &mut dest_buf[..],
                );
                Context::print_tarball_path(
                    bstr::BStr::new(abs_tarball_dest.as_bytes()),
                    log_level,
                );
            }
        }

        Context::print_summary(ctx.stats, None, None, log_level);

        if let Some(postpack_script_str) = &postpack_script {
            run_lifecycle_script(
                &mut ctx,
                postpack_script_str,
                b"postpack",
                abs_workspace_path,
            )?;
        }

        return Ok(for_publish.then(|| Publish::Context {
            package_name: package_name.into(),
            package_version: package_version.into(),
            tarball_bytes: Box::new([]),
            publish_script,
            postpublish_script,
            normalized_pkg_info: Box::new([]),
        }));
    }

    // default is 9
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L12
    let compression_level: u8 = match ctx.manager.options.pack_gzip_level.unwrap_or(b"9") {
        &[digit @ b'0'..=b'9'] => digit - b'0',
        level => {
            Output::err_generic(
                "compression level must be between 0 and 9, received {}",
                format_args!("{}", bstr::BStr::new(level)),
            );
            Global::crash();
        }
    };

    // `bun publish` uploads the bytes from memory. Only `bun pm pack` writes a file.
    let mut dest_buf = bun_paths::path_buffer_pool::get();
    let abs_tarball_dest: Option<&ZStr> = if for_publish {
        None
    } else {
        let (abs_tarball_dest, abs_tarball_dest_dir_end) = tarball_destination(
            ctx.manager.options.pack_destination,
            ctx.manager.options.pack_filename,
            abs_workspace_path,
            bare_filename,
            &mut dest_buf[..],
        );
        // create the directory if it doesn't exist
        let _ = Dir::cwd().make_path(&abs_tarball_dest.as_bytes()[..abs_tarball_dest_dir_end]);
        Some(abs_tarball_dest)
    };
    let is_typed_filename = !ctx.manager.options.pack_filename.is_empty();
    let tarball_file =
        abs_tarball_dest.and_then(|dest| Some((open_tarball(dest, is_typed_filename)?, dest)));

    let mut tarball_bytes: Vec<u8> = Vec::new();
    let mut packed_size: usize = 0;
    let mut sha1 = sha::SHA1::init();
    let mut sha512 = sha::SHA512::init();
    let mut write_tarball = |bytes: &[u8]| {
        packed_size += bytes.len();
        sha1.update(bytes);
        sha512.update(bytes);
        let Some((file, dest)) = &tarball_file else {
            tarball_bytes.extend_from_slice(bytes);
            return;
        };
        if let Err(err) = file.write_all(bytes) {
            fail_write_tarball(err, dest);
        }
    };
    let mut writer: TarballWriter<'_> = tar::writer::Writer::new(
        tar::gzip::Encoder::new(
            &mut write_tarball as &mut dyn FnMut(&[u8]),
            compression_level,
        )
        .unwrap_or_else(|err| archive_write_failed(err)),
        tar::writer::Names::for_host(),
    );

    // append removed items from `pack_queue` with their file size
    let mut pack_list: PackList = Vec::new();

    let mut read_buf = vec![0u8; 512 * 1024];

    {
        let mut progress = Progress::Progress::default();
        let mut node: Option<&mut Progress::Node> = None;
        if log_level.show_progress() {
            progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            let started = progress.start(b"", ctx.stats.total_files);
            started.unit = Progress::Unit::Files;
            node = Some(started);
        }

        archive_package_json(&mut ctx, &mut writer, &root_dir, &edited_package_json);
        if let Some(node) = node.as_mut() {
            node.complete_one();
        }

        while let Some(item) = pack_queue.remove_or_null() {
            let path = item.path.as_bytes();
            let fd: Fd = bun_sys::openat(
                Fd::from_std_dir(&root_dir),
                &item.path,
                bun_sys::O::RDONLY,
                0,
            )
            .and_then(|file| {
                file.make_lib_uv_owned_for_syscall(
                    bun_sys::Tag::open,
                    bun_sys::ErrorCase::CloseOnFail,
                )
            })
            .unwrap_or_else(|err| fail_file(err, "open", path));
            let _close_fd = CloseOnDrop::new(fd);

            let stat =
                bun_sys::sys_uv::fstat(fd).unwrap_or_else(|err| fail_file(err, "stat", path));

            pack_list.push(PackListEntry {
                subpath: ZBox::from_bytes(path),
                size: usize::try_from(stat.st_size).expect("int cast"),
            });

            add_archive_entry(
                &mut ctx,
                fd,
                &stat,
                &item.path,
                &mut read_buf,
                &mut writer,
                &bins,
                None,
            );

            if let Some(node) = node.as_mut() {
                node.complete_one();
            }
        }

        for item in &bundled_files {
            let path = item.path.as_bytes();
            let file = (Dir::cwd().open_file(item.source.as_bytes(), bun_sys::O::RDONLY, 0))
                .unwrap_or_else(|err| fail_file(err, "open", path));
            let stat = file
                .stat()
                .unwrap_or_else(|err| fail_file(err, "stat", path));

            add_archive_entry(
                &mut ctx,
                file.handle,
                &stat,
                &item.path,
                &mut read_buf,
                &mut writer,
                &bins,
                item.edited.as_deref(),
            );

            if let Some(node) = node.as_mut() {
                node.complete_one();
            }
        }

        if let Some(node) = node {
            node.end();
        }
    }

    // The archive ends right behind its two end-of-archive blocks, with no padding to a full record.
    if let Err(err) = writer.finish(false).and_then(|encoder| encoder.finish()) {
        archive_write_failed(err);
    }

    let mut shasum: [u8; sha::SHA1::DIGEST] = [0; sha::SHA1::DIGEST];
    sha1.r#final(&mut shasum);

    let mut integrity: [u8; sha::SHA512::DIGEST] = [0; sha::SHA512::DIGEST];
    sha512.r#final(&mut integrity);

    ctx.stats.packed_size = packed_size;

    match (tarball_file, abs_tarball_dest) {
        (Some((file, dest)), _) => finish_tarball(file, dest, is_typed_filename),
        (None, Some(dest)) => write_tarball_in_place(dest, &tarball_bytes, is_typed_filename),
        (None, None) => {}
    }

    let normalized_pkg_info: Box<[u8]> = if for_publish {
        Publish::PublishCommand::normalized_package(
            ctx.manager,
            Publish::PackageFiles::Folder {
                root: Fd::from_std_dir(&root_dir),
                abs_path: abs_workspace_path,
            },
            package_name,
            package_version,
            &mut root,
            &json.source,
            shasum,
            integrity,
            workspace_readme,
        )?
    } else {
        Box::default()
    };

    print_archived_files_and_packages(
        &mut ctx,
        &root_dir,
        PackListOrQueue::List(&pack_list, edited_package_json.len()),
    );

    if let Some(abs_tarball_dest) = abs_tarball_dest {
        if prints_bare_filename {
            Context::print_tarball_path(bare_filename, log_level);
        } else {
            Context::print_tarball_path(bstr::BStr::new(abs_tarball_dest.as_bytes()), log_level);
        }
    }

    Context::print_summary(ctx.stats, Some(&shasum), Some(&integrity), log_level);

    if for_publish {
        Output::flush();
    }

    if let Some(postpack_script_str) = &postpack_script {
        bun_core::pretty!("\n");
        run_lifecycle_script(
            &mut ctx,
            postpack_script_str,
            b"postpack",
            abs_workspace_path,
        )?;
    }

    Ok(for_publish.then(|| Publish::Context {
        package_name: package_name.into(),
        package_version: package_version.into(),
        tarball_bytes: tarball_bytes.into_boxed_slice(),
        publish_script,
        postpublish_script,
        normalized_pkg_info,
    }))
}

fn run_lifecycle_script(
    ctx: &mut Context<'_>,
    script: &[u8],
    name: &[u8],
    abs_workspace_path: &[u8],
) -> Result<(), PackError> {
    match RunCommand::run_lifecycle_script_foreground(
        ctx.command_ctx,
        script,
        name,
        abs_workspace_path,
        ctx.manager.env_mut(),
        ctx.manager.options.log_level == LogLevel::Silent,
    ) {
        Ok(()) => Ok(()),
        Err(crate::Error::MissingShell) => {
            Output::err_generic(
                "failed to find shell executable to run {} script",
                format_args!("{}", bstr::BStr::new(name)),
            );
            Global::crash();
        }
        Err(crate::Error::Alloc(_)) => Err(PackError::OutOfMemory),
        Err(err) => {
            Output::err(err, "failed to run {} script", (bstr::BStr::new(name),));
            Global::crash();
        }
    }
}

/// Returns true if a `name` or `version` could move the tarball's filename outside the destination
/// directory.
fn has_unsafe_tarball_filename_part(value: &[u8]) -> bool {
    strings::split(value, b"/").any(|component| component == b"." || component == b"..")
        || strings::contains_any(value, b"\\:\0")
}

/// `version` as the registry gets it (`v1.0.0` is `1.0.0`). `None` if it is not one complete semver version.
pub(crate) fn published_version(version: &[u8]) -> Option<&[u8]> {
    let parsed =
        bun_semver::Version::parse_exact(bun_semver::SlicedString::init(version, version))?;
    let printed = parsed.fmt(version).to_string();
    // A number that does not print as written has a leading zero or did not fit.
    let version = strings::trim(version, &strings::WHITESPACE_CHARS);
    let (prefix, version) = version.split_at(version.len().checked_sub(printed.len())?);
    (version == printed.as_bytes() && !prefix.iter().any(u8::is_ascii_digit)).then_some(version)
}

/// Returns the tarball path and the length of the directory the caller creates (0 for `--filename`).
fn tarball_destination<'a>(
    pack_destination: &[u8],
    pack_filename: &[u8],
    abs_workspace_path: &[u8],
    tarball_name: TarballNameFormatter<'_>,
    dest_buf: &'a mut [u8],
) -> (&'a ZStr, usize) {
    if !pack_filename.is_empty() {
        if pack_filename.len() + 1 > dest_buf.len() {
            Output::err_generic(
                "archive filename too long: \"{}\"",
                format_args!("{}", bstr::BStr::new(pack_filename)),
            );
            Global::crash();
        }
        dest_buf[..pack_filename.len()].copy_from_slice(pack_filename);
        dest_buf[pack_filename.len()] = 0;
        return (ZStr::from_buf(&dest_buf[..], pack_filename.len()), 0);
    }

    #[cold]
    fn too_long(dir: &[u8], tarball_name: TarballNameFormatter<'_>) -> ! {
        Output::err_generic(
            "archive destination name too long: \"{}/{}\"",
            (
                bstr::BStr::new(strings::without_trailing_slash(dir)),
                tarball_name,
            ),
        );
        Global::crash();
    }
    let Some(dir) = resolve_path::join_abs_string_buf_checked::<resolve_path::platform::Auto>(
        abs_workspace_path,
        dest_buf,
        &[pack_destination],
    ) else {
        too_long(pack_destination, tarball_name);
    };
    let dir_len_full = dir.len();
    let dir_len_trimmed = strings::without_trailing_slash(dir).len();

    let mut cursor = std::io::Cursor::new(&mut dest_buf[dir_len_trimmed..]);
    if write!(&mut cursor, "{}{}\x00", SEP_STR, tarball_name).is_err() {
        too_long(&dest_buf[..dir_len_full], tarball_name);
    }
    let tarball_name_len = usize::try_from(cursor.position()).expect("int cast");

    (
        ZStr::from_buf(&dest_buf[..], dir_len_trimmed + tarball_name_len - 1),
        dir_len_full,
    )
}

pub(crate) fn fmt_tarball_filename<'a>(
    package_name: &'a [u8],
    package_version: &'a [u8],
    style: TarballNameStyle,
) -> TarballNameFormatter<'a> {
    TarballNameFormatter {
        package_name,
        package_version,
        style,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TarballNameStyle {
    Normalize,
    Raw,
}

#[derive(Clone, Copy)]
pub(crate) struct TarballNameFormatter<'a> {
    package_name: &'a [u8],
    package_version: &'a [u8],
    style: TarballNameStyle,
}

impl<'a> fmt::Display for TarballNameFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut name = self.package_name;
        if self.style == TarballNameStyle::Normalize && name[0] == b'@' {
            name = &name[1..];
            if let Some((scope, unscoped)) = strings::split_once_char(name, b'/') {
                write!(f, "{}-", bstr::BStr::new(scope))?;
                name = unscoped;
            }
        }
        write!(
            f,
            "{}-{}.tgz",
            bstr::BStr::new(name),
            bstr::BStr::new(self.package_version),
        )
    }
}

/// The temporary file that `open_tarball` created. A failed pack can exit from many places, so an
/// exit callback removes the file.
static UNFINISHED_TARBALL: bun_core::Mutex<Option<(Fd, ZBox)>> = bun_core::Mutex::new(None);

extern "C" fn remove_unfinished_tarball() {
    if let Some((fd, path)) = UNFINISHED_TARBALL.lock().take() {
        // Windows cannot delete the file while it is open.
        fd.close();
        let _ = bun_sys::unlink(&path);
    }
}

/// Creates a temporary file next to the destination, which `finish_tarball` renames over it. If
/// this returns `None`, the tarball stays in memory until `write_tarball_in_place` writes it.
fn open_tarball(abs_tarball_dest: &ZStr, is_typed_filename: bool) -> Option<File> {
    let mode: bun_sys::Mode = match bun_sys::lstat(abs_tarball_dest) {
        Err(_) => 0o666,
        Ok(stat) => match bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode) {
            bun_sys::FileKind::File
                if bun_sys::access(abs_tarball_dest, bun_sys::posix::W_OK).is_ok() =>
            {
                stat.st_mode as bun_sys::Mode & 0o777
            }
            // A symlink at the name Bun chose for the tarball is replaced. A symlink that
            // `--filename` names is written through instead.
            bun_sys::FileKind::SymLink if !is_typed_filename => 0o666,
            // Anything else, such as a FIFO, a device or a read-only file, is not replaced.
            _ => return None,
        },
    };
    let mut name_buf = [0u8; 64];
    let name = path::fs::FileSystem::tmpname(b"tmp", &mut name_buf, bun_core::fast_random())
        .expect("unreachable");
    let tmp = ZBox::from_vec_with_nul(
        [
            path::dirname_simple(abs_tarball_dest.as_bytes()),
            SEP_STR.as_bytes(),
            UNFINISHED_TARBALL_PREFIX,
            name.as_bytes_with_nul(),
        ]
        .concat(),
    );
    let file = File::openat(
        Fd::cwd(),
        &tmp,
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::EXCL | bun_sys::O::CLOEXEC,
        mode,
    )
    .ok()?;
    *UNFINISHED_TARBALL.lock() = Some((file.handle(), tmp));
    Global::add_exit_callback(remove_unfinished_tarball);
    Some(file)
}

fn finish_tarball(file: File, abs_tarball_dest: &ZStr, is_typed_filename: bool) {
    let unfinished = UNFINISHED_TARBALL.lock().take();
    // Windows cannot rename the file while it is open.
    drop(file);
    let Some((_, tmp)) = unfinished else { return };
    if bun_sys::rename(&tmp, abs_tarball_dest).is_ok() {
        return;
    }
    // A file that is a mount point, or another user's file in a sticky directory, cannot be
    // replaced but can still be written to.
    let tarball_bytes = File::read_from(Fd::cwd(), tmp.as_bytes());
    let _ = bun_sys::unlink(&tmp);
    match tarball_bytes {
        Ok(tarball_bytes) => {
            write_tarball_in_place(abs_tarball_dest, &tarball_bytes, is_typed_filename)
        }
        Err(err) => fail_write_tarball(err, abs_tarball_dest),
    }
}

#[cold]
fn fail_write_tarball(err: bun_sys::Error, abs_tarball_dest: &ZStr) -> ! {
    Output::err(
        err,
        "failed to write tarball \"{}\"",
        format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())),
    );
    Global::crash();
}

fn write_tarball_in_place(abs_tarball_dest: &ZStr, tarball_bytes: &[u8], is_typed_filename: bool) {
    let follow = if is_typed_filename {
        0
    } else {
        bun_sys::O::NOFOLLOW
    };
    let file = File::openat(
        Fd::cwd(),
        abs_tarball_dest,
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::CLOEXEC | follow,
        0o666,
    )
    .unwrap_or_else(|err| {
        Output::err(
            err,
            "failed to open tarball file destination: \"{}\"",
            format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())),
        );
        Global::crash();
    });
    if let Err(err) = file.write_all(tarball_bytes) {
        // Windows cannot delete the file while it is open.
        drop(file);
        // A `--filename` that is a symlink or a device is not ours to delete.
        if bun_sys::lstat(abs_tarball_dest).is_ok_and(|stat| {
            bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode) == bun_sys::FileKind::File
        }) {
            let _ = bun_sys::unlink(abs_tarball_dest);
        }
        fail_write_tarball(err, abs_tarball_dest);
    }
}

#[cold]
fn archive_write_failed(err: tar::Error) -> ! {
    Output::err_generic("failed to write tarball: {}", format_args!("{err}"));
    Global::crash();
}

/// Returns how much was taken, which stops at the size in the entry's header.
fn write_archive_data(writer: &mut TarballWriter<'_>, data: &[u8]) -> usize {
    writer
        .data(data)
        .unwrap_or_else(|err| archive_write_failed(err))
}

fn stat_package_json(root_dir: &Dir) -> bun_sys::Stat {
    bun_sys::fstatat(Fd::from_std_dir(root_dir), bun_core::zstr!("package.json")).unwrap_or_else(
        |err| {
            Output::err(crate::Error::from(err), "failed to stat package.json", ());
            Global::crash();
        },
    )
}

fn archive_package_json(
    ctx: &mut Context<'_>,
    writer: &mut TarballWriter<'_>,
    root_dir: &Dir,
    edited_package_json: &[u8],
) {
    let stat = stat_package_json(root_dir);

    writer
        .header(&tar::writer::File {
            path: b"package/package.json",
            size: edited_package_json.len() as u64,
            perm: stat.st_mode as u32,
            // '1985-10-26T08:15:00.000Z'
            // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
            mtime: 499162500,
        })
        .unwrap_or_else(|err| archive_write_failed(err));

    ctx.stats.unpacked_size += write_archive_data(writer, edited_package_json);
}

fn add_archive_entry(
    ctx: &mut Context<'_>,
    file: Fd,
    stat: &bun_sys::Stat,
    filename: &ZStr,
    read_buf: &mut [u8],
    writer: &mut TarballWriter<'_>,
    bins: &[BinInfo],
    // If set, these bytes are archived instead of the contents of `file`.
    edited: Option<&[u8]>,
) {
    let pathname = [b"package/".as_slice(), filename.as_bytes()].concat();

    let mut perm = stat.st_mode as u32;
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L20
    if is_package_bin(bins, filename.as_bytes()) {
        perm |= 0o111;
    }

    writer
        .header(&tar::writer::File {
            path: &pathname,
            size: edited.map_or(stat.st_size as u64, |edited| edited.len() as u64),
            perm,
            // '1985-10-26T08:15:00.000Z'
            // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
            mtime: 499162500,
        })
        .unwrap_or_else(|err| archive_write_failed(err));

    if let Some(edited) = edited {
        ctx.stats.unpacked_size += write_archive_data(writer, edited);
        return;
    }

    let mut written: usize = 0;
    loop {
        let read = match bun_sys::read(file, read_buf) {
            Ok(0) => break,
            Ok(read) => read,
            Err(err) => fail_file(crate::Error::from(err), "read", filename.as_bytes()),
        };
        // The size of each write reaches the compressor, so it is part of what keeps the bytes stable.
        for chunk in read_buf[..read].chunks(8192) {
            written += write_archive_data(writer, chunk);
        }
    }
    ctx.stats.unpacked_size += written;

    // The writer drops bytes past the size in the header, and pads an entry that is too short with
    // zeros, so a file that shrank has to be caught here.
    if (written as i64) < stat.st_size as i64 {
        Output::err_generic(
            "file shrank while packing: \"{}\"",
            format_args!("{}", bun_fmt::escape_control_chars(filename.as_bytes())),
        );
        Global::crash();
    }
}

/// What replaces a `workspace:` or `catalog:` specifier in the tarball's package.json.
pub(crate) enum Substitution<'a> {
    /// For `workspace:^`, `workspace:~` and `workspace:*`: the workspace's current version with
    /// that prefix.
    WorkspaceVersion(&'static str),
    /// `workspace:@acme/core@*` (alias), `workspace:../core`, or `workspace:1.x` on a workspace.
    WorkspaceRangeOrDirectory(&'a [u8]),
    Catalog(&'a [u8]),
}

impl<'a> Substitution<'a> {
    pub(crate) fn for_spec(spec: &'a [u8]) -> Option<Substitution<'a>> {
        let spec = bun_install::dependency::trim_literal(spec);
        if let Some(range) = strings::without_prefix_if_possible_comptime(spec, b"workspace:") {
            return Some(match range {
                b"^" => Substitution::WorkspaceVersion("^"),
                b"~" => Substitution::WorkspaceVersion("~"),
                b"*" => Substitution::WorkspaceVersion(""),
                _ => Substitution::WorkspaceRangeOrDirectory(range),
            });
        }
        let catalog_name = strings::without_prefix_if_possible_comptime(spec, b"catalog:")?;
        Some(Substitution::Catalog(strings::trim(
            catalog_name,
            &strings::WHITESPACE_CHARS,
        )))
    }

    /// On failure, `Err` says which protocol couldn't be resolved and why.
    pub(crate) fn published(
        self,
        manifests: &WorkspaceManifests,
        package_dir: &[u8],
        dependency_name: &[u8],
    ) -> Result<Vec<u8>, (&'static str, String)> {
        match self {
            Substitution::WorkspaceVersion(prefix) => {
                match manifests.workspace_version(dependency_name) {
                    Some(version) => Ok(format!("{prefix}{version}").into_bytes()),
                    None => Err((
                        "workspace",
                        format!(
                            "\"{}\" has no workspace named \"{}\", or its package.json has no version",
                            bstr::BStr::new(manifests.root_package_json_path()),
                            bstr::BStr::new(dependency_name),
                        ),
                    )),
                }
            }
            Substitution::WorkspaceRangeOrDirectory(spec) => {
                publish_spec_for_workspace_range_or_directory(
                    manifests,
                    package_dir,
                    dependency_name,
                    spec,
                )
                .map_err(|why| ("workspace", why))
            }
            Substitution::Catalog(catalog_name) => {
                let spec = manifests
                    .catalog_version(catalog_name, dependency_name)
                    .ok_or_else(|| ("catalog", "no matching catalog dependency".to_owned()))?;
                // As in `bun install`, a catalog entry may be a `workspace:` spec but not another
                // `catalog:` spec.
                match Substitution::for_spec(spec) {
                    None => Ok(spec.to_vec()),
                    Some(Substitution::Catalog(_)) => Err((
                        "catalog",
                        "catalog entry refers to another catalog".to_owned(),
                    )),
                    Some(found) => found.published(manifests, package_dir, dependency_name),
                }
            }
        }
    }
}

/// Section order is the order errors get reported in.
pub(crate) fn for_each_dependency(
    package_json: Expr,
    mut f: impl FnMut(&'static [u8], &mut bun_ast::G::Property),
) {
    use bun_install_types::DependencyGroup;
    for group in [
        DependencyGroup::DEPENDENCIES,
        DependencyGroup::DEV,
        DependencyGroup::PEER,
        DependencyGroup::OPTIONAL,
    ] {
        let Some(section) = package_json.get(group.prop) else {
            continue;
        };
        let ExprData::EObject(mut dependencies) = section.data else {
            continue;
        };
        for dependency in dependencies.properties.slice_mut() {
            f(group.prop, dependency);
        }
    }
}

/// Packages without such specs must pack whatever state the rest of the workspace is in.
fn needs_workspace_manifests(package_json: Expr) -> bool {
    let mut needed = false;
    for_each_dependency(package_json, |_, dependency| {
        needed |= dependency
            .value
            .as_ref()
            .and_then(Expr::as_utf8_string_literal)
            .and_then(Substitution::for_spec)
            .is_some();
    });
    needed
}

/// The alias is checked first, like the installer does. A directory is checked before a range,
/// because only a directory has a version.
fn publish_spec_for_workspace_range_or_directory(
    manifests: &WorkspaceManifests,
    package_dir: &[u8],
    dependency_name: &[u8],
    spec: &[u8],
) -> Result<Vec<u8>, String> {
    let alias = split_workspace_alias(spec);
    if let Some((workspace_name, range)) = alias.filter(|(name, _)| manifests.has_workspace(name)) {
        let range = strings::trim(range, &strings::WHITESPACE_CHARS);
        // The installer links an empty range like `*`.
        let prefix = match range {
            b"" | b"*" => Some(""),
            b"^" => Some("^"),
            b"~" => Some("~"),
            _ => None,
        };
        let Some(prefix) = prefix else {
            return Ok(publish_workspace(
                dependency_name,
                workspace_name,
                bstr::BStr::new(range),
            ));
        };
        let Some(version) = manifests.workspace_version(workspace_name) else {
            return Err(format!(
                "workspace \"{}\" has no version in package.json",
                bstr::BStr::new(workspace_name),
            ));
        };
        return Ok(publish_workspace(
            dependency_name,
            workspace_name,
            format_args!("{prefix}{version}"),
        ));
    }
    if let Some(workspace_name) = manifests.workspace_name_at_path(package_dir, spec) {
        let Some(version) = manifests.workspace_version(workspace_name) else {
            return Err(format!(
                "workspace \"{}\" in \"{}\" has no version in package.json",
                bstr::BStr::new(workspace_name),
                bstr::BStr::new(spec),
            ));
        };
        return Ok(publish_workspace(dependency_name, workspace_name, version));
    }
    if alias.is_none() && manifests.has_workspace(dependency_name) {
        return Ok(spec.to_vec());
    }
    Err(format!(
        "\"{}\" has no workspace named \"{}\" and no workspace in the directory \"{}\"",
        bstr::BStr::new(manifests.root_package_json_path()),
        bstr::BStr::new(alias.map_or(dependency_name, |(workspace_name, _)| workspace_name)),
        bstr::BStr::new(spec),
    ))
}

/// Splits `workspace:<name>@<range>`. `<name>` may be scoped, and `../@scope/pkg` is a directory.
fn split_workspace_alias(spec: &[u8]) -> Option<(&[u8], &[u8])> {
    let at = strings::last_index_of_char(spec, b'@').filter(|at| *at > 0)?;
    let (name, range) = (&spec[..at], &spec[at + 1..]);
    let is_package_name = match bun_install::dependency::is_scoped_package_name(name) {
        Ok(true) => true,
        Ok(false) => !strings::contains_char(name, b'/'),
        Err(_) => false,
    };
    is_package_name.then_some((name, range))
}

/// The version itself under the workspace's own name, otherwise the `npm:` alias pnpm publishes too.
fn publish_workspace(
    dependency_name: &[u8],
    workspace_name: &[u8],
    version: impl fmt::Display,
) -> Vec<u8> {
    if workspace_name == dependency_name {
        version.to_string().into_bytes()
    } else {
        format!("npm:{}@{version}", bstr::BStr::new(workspace_name)).into_bytes()
    }
}

/// Replaces the `workspace:` and `catalog:` specs in `root`, which was parsed from `source`, and
/// returns the printed JSON. `bun publish` sends the edited tree to the registry.
fn edit_root_package_json(
    workspace_manifests: Option<&WorkspaceManifests>,
    package_dir: &[u8],
    root: Expr,
    source: &bun_ast::Source,
    indentation: bun_ast::Indentation,
) -> Result<Box<[u8]>, AllocError> {
    let bump = pack_bump();
    for_each_dependency(root, |dependency_group, dependency| {
        let (Some(name), Some(spec)) = (dependency.key.as_ref(), dependency.value.as_ref()) else {
            return;
        };
        let Some(substitution) = spec
            .as_utf8_string_literal()
            .and_then(Substitution::for_spec)
        else {
            return;
        };
        let Some(dependency_name) = name.as_utf8_string_literal() else {
            Output::err_generic(
                "expected string value for dependency name in \"{}\"",
                format_args!("{}", bstr::BStr::new(dependency_group)),
            );
            Global::crash();
        };
        let replacement: &[u8] = match substitution.published(
            workspace_manifests.expect("pack() loads the manifests when a spec needs them"),
            package_dir,
            dependency_name,
        ) {
            // `E::EString::init` keeps a pointer to the bytes, so they go into the pack arena.
            Ok(published) => bump.alloc_slice_copy(&published),
            Err((what, why)) => {
                Output::err_generic(
                    "Failed to resolve {} version for \"{}\" in `{}` ({}).",
                    (
                        what,
                        bstr::BStr::new(dependency_name),
                        bstr::BStr::new(dependency_group),
                        why,
                    ),
                );
                Global::crash();
            }
        };
        dependency.value = Some(Expr::init(
            E::EString::init(replacement),
            Default::default(),
        ));
    });

    let mut buffer_writer = js_printer::BufferWriter::init();
    let contents = &source.contents;
    buffer_writer.buffer.list.reserve(contents.len() + 1);
    buffer_writer.append_newline = contents.ends_with(b"\n");
    let mut package_json_writer = js_printer::BufferPrinter::init(buffer_writer);

    if let Err(err) = js_printer::print_json(
        &mut package_json_writer,
        root,
        // shouldn't be used
        source,
        js_printer::PrintJsonOptions {
            indent: indentation,
            mangled_props: None,
            ..Default::default()
        },
    ) {
        if err == bun_js_printer::Error::Alloc(bun_alloc::AllocError) {
            return Err(AllocError);
        }
        Output::err_generic(
            "failed to print edited package.json: {}",
            format_args!("{}", err.name()),
        );
        Global::crash();
    }

    Ok(package_json_writer
        .ctx
        .written_without_trailing_zero()
        .into())
}

enum PackListOrQueue<'a> {
    /// A dry run read nothing, so the sizes come from `stat`.
    Queue(&'a mut PackQueue),
    /// The files that were archived, and the length of the edited package.json.
    List(&'a PackList, usize),
}

fn print_archived_files_and_packages(
    ctx: &mut Context<'_>,
    root_dir: &Dir,
    pack_list: PackListOrQueue<'_>,
) {
    if ctx.manager.options.log_level == LogLevel::Silent
        || ctx.manager.options.log_level == LogLevel::Quiet
    {
        return;
    }
    let print_packed = |size: usize, path: &[u8]| {
        bun_core::prettyln!(
            "<r><b><cyan>packed<r> {} {}",
            fmt_size(size),
            bun_fmt::escape_control_chars(path),
        );
    };
    match pack_list {
        PackListOrQueue::Queue(pack_queue) => {
            let size = usize::try_from(stat_package_json(root_dir).st_size).expect("int cast");
            ctx.stats.unpacked_size += size;
            bun_core::pretty!("\n");
            print_packed(size, b"package.json");

            while let Some(item) = pack_queue.remove_or_null() {
                let path = item.path.as_bytes();
                let stat = bun_sys::fstatat(Fd::from_std_dir(root_dir), &item.path)
                    .unwrap_or_else(|err| fail_file(crate::Error::from(err), "stat", path));
                let size = usize::try_from(stat.st_size).expect("int cast");
                ctx.stats.unpacked_size += size;
                print_packed(size, path);
            }
        }
        PackListOrQueue::List(pack_list, package_json_len) => {
            bun_core::pretty!("\n");
            print_packed(package_json_len, b"package.json");
            for entry in pack_list {
                print_packed(entry.size, entry.subpath.as_bytes());
            }
        }
    }

    for dep in ctx.bundled_deps.iter() {
        bun_core::prettyln!(
            "<r><b><green>bundled<r> {}",
            bun_fmt::escape_control_chars(&dep.name)
        );
    }

    Output::flush();
}

pub(crate) mod bindings {
    use super::*;
    use bun_core::String as BunString;
    use bun_jsc::bindgen::{self, JsHeap};

    use crate::generated_bindgen::pack_command::{Tarball, TarballEntry, TarballEntryKind};

    fn tarball_entry_kind(kind: bun_sys::FileKind) -> TarballEntryKind {
        use bun_sys::FileKind as K;
        match kind {
            K::BlockDevice => TarballEntryKind::BlockDevice,
            K::CharacterDevice => TarballEntryKind::CharacterDevice,
            K::Directory => TarballEntryKind::Directory,
            K::NamedPipe => TarballEntryKind::NamedPipe,
            K::SymLink => TarballEntryKind::SymLink,
            K::File => TarballEntryKind::File,
            K::UnixDomainSocket => TarballEntryKind::UnixDomainSocket,
            K::Whiteout => TarballEntryKind::Whiteout,
            K::Door => TarballEntryKind::Door,
            K::EventPort => TarballEntryKind::EventPort,
            K::Unknown => TarballEntryKind::Unknown,
        }
    }

    pub(crate) fn read_tarball<'a>(
        heap: &JsHeap<'a>,
        tarball_path: &[u8],
    ) -> bindgen::Result<'a, Tarball> {
        let tarball_file = match bun_sys::open_file(tarball_path, Default::default()) {
            Ok(f) => f,
            Err(err) => {
                return Err(heap.error(format_args!(
                    "failed to open tarball file \"{}\": {}",
                    bstr::BStr::new(tarball_path),
                    crate::Error::from(err).name(),
                )));
            }
        };

        let tarball = match tarball_file.read_to_end() {
            Ok(b) => b,
            Err(err) => {
                let _ = tarball_file.close();
                return Err(heap.error(format_args!(
                    "failed to read tarball contents \"{}\": {}",
                    bstr::BStr::new(tarball_path),
                    crate::Error::from(err).name(),
                )));
            }
        };
        let _ = tarball_file.close();

        let mut sha1_digest: [u8; sha::SHA1::DIGEST] = [0; sha::SHA1::DIGEST];
        let mut sha1 = sha::SHA1::init();
        sha1.update(&tarball);
        sha1.r#final(&mut sha1_digest);
        let shasum_str = BunString::create_format(format_args!(
            "{}",
            bun_fmt::bytes_to_hex_lower_string(&sha1_digest)
        ));

        let mut sha512_digest: [u8; sha::SHA512::DIGEST] = [0; sha::SHA512::DIGEST];
        let mut sha512 = sha::SHA512::init();
        sha512.update(&tarball);
        sha512.r#final(&mut sha512_digest);
        let integrity = bun_base64::encode_alloc(&sha512_digest);

        let mut entries: Vec<TarballEntry> = Vec::new();

        let mut reader = bun_archive::open_memory(&tarball, tar::Dialect::General)
            .map_err(|err| heap.error(format_args!("failed to read tarball: {err}")))?;
        let mut read_buf: Vec<u8> = Vec::new();

        loop {
            let archive_entry = match reader.next_entry() {
                Ok(None) => break,
                Ok(Some(entry)) => entry,
                Err(err) => {
                    return Err(heap.error(format_args!("failed to read archive header: {err}")));
                }
            };
            let pathname = BunString::clone_utf8(&bun_core::handle_oom(bun_archive::display_path(
                archive_entry,
            )));

            let kind = archive_entry.kind();
            let size: usize = usize::try_from(archive_entry.size()).expect("int cast");
            let mut entry = TarballEntry {
                pathname,
                kind: tarball_entry_kind(kind),
                perm: f64::from(archive_entry.perm()),
                contents: None,
            };

            if kind == bun_sys::FileKind::File {
                if let Err(err) = reader.read_data(size, &mut read_buf) {
                    let pathname_utf8 = entry.pathname.to_utf8();
                    return Err(heap.error(format_args!(
                        "failed to read archive entry \"{}\": {err}",
                        bstr::BStr::new(pathname_utf8.slice()),
                    )));
                }
                entry.contents = Some(BunString::clone_utf8(&read_buf));
                read_buf.clear();
            }

            entries.push(entry);
        }

        Ok(Tarball {
            entries,
            size: tarball.len(),
            shasum: shasum_str,
            integrity,
        })
    }
}
