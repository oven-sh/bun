use bun_collections::VecExt;
use core::fmt;
use std::io::Write as _;

use crate::cli::Command;
use crate::cli::publish_command as Publish;
use bun_alloc::AllocError;
use bun_ast::{E, Expr, ExprData};
use bun_collections::StringHashMap;
use bun_core::{Global, Output, Progress, fmt as bun_fmt};
use bun_glob as glob;
use bun_install::PackageManager;
use bun_install::package_manager::LogLevel;
use bun_install::package_manager::workspace_manifests::WorkspaceManifests;
use bun_install::package_manager::workspace_package_json_cache as WorkspacePackageJSONCache;
use bun_js_printer as js_printer;
use bun_libarchive::lib::{
    Archive, Entry as ArchiveEntry, GrowingBuffer, Result as ArchiveResult, WriteArchive,
    archive_write_open2,
};
use bun_parsers::json as JSON;
use bun_paths::{self as path, SEP_STR};
use bun_ptr::cow_slice::CowSlice;
type CowString = CowSlice<u8>;
use crate::cli::run_command::{ConfigureEnvOptions, RunCommand};
use bun_core::ZBox;
use bun_core::{ZStr, strings};
use bun_paths::resolve_path::{self, normalize_buf_z_spill};
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

/// Raw projection: `pack()` holds the `&mut MapEntry` this yields across other `ctx.manager` uses.
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
        } else {
            Output::stdout_is_the_result();
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
        // Typed relative to `original_cwd`; `PackageManager::init` has changed directory since.
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

const ROOT_DEFAULT_IGNORE_PATTERNS: &[&[u8]] = &[
    b"package-lock.json",
    b"yarn.lock",
    b"pnpm-lock.yaml",
    b"bun.lockb",
    b"bun.lock",
];

// (pattern, can_override). `can_override == false` mirrors npm-packlist's
// strict rules (only `.git` and `.npmrc` here; lockfiles live in
// ROOT_DEFAULT_IGNORE_PATTERNS); everything else `"files"` can re-include.
const DEFAULT_IGNORE_PATTERNS: &[(&[u8], bool)] = &[
    (b".*.swp", true),
    (b"._*", true),
    (b".DS_Store", true),
    (b".git", false),
    (b".gitignore", true),
    (b".hg", true),
    (b".npmignore", true),
    (b".npmrc", false),
    (b".lock-wscript", true),
    (b".svn", true),
    (b".wafpickle-*", true),
    (b"CVS", true),
    (b"npm-debug.log", true),
    // mentioned in the docs but does not appear to be ignored by default
    // (b"config.gypi", false),
    (b".env.production", true),
    (b"bunfig.toml", true),
    // The temporary file that `open_tarball` creates. It can belong to a pack that is running at
    // the same time, or be left over from one that was killed.
    (b".bun-pack.*.tmp", false),
];

/// The start of the temporary tarball's filename. The rest comes from `FileSystem::tmpname`, which
/// starts with a `.` and, as called here, ends in `.tmp`.
const UNFINISHED_TARBALL_PREFIX: &[u8] = b".bun-pack";

struct PackListEntry {
    subpath: ZBox,
    size: usize,
}
type PackList = Vec<PackListEntry>;

pub(crate) struct PackQueueItem {
    path: ZBox,
}

impl Ord for PackQueueItem {
    fn cmp(&self, other: &Self) -> core::cmp::Ordering {
        // Reversed: `BinaryHeap` is a max-heap and the smallest path pops first.
        strings::order(other.path.as_bytes(), self.path.as_bytes())
    }
}
impl PartialOrd for PackQueueItem {
    fn partial_cmp(&self, other: &Self) -> Option<core::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Eq for PackQueueItem {}
impl PartialEq for PackQueueItem {
    fn eq(&self, other: &Self) -> bool {
        self.path.as_bytes() == other.path.as_bytes()
    }
}

#[derive(Default)]
pub(crate) struct PackQueue {
    heap: std::collections::BinaryHeap<PackQueueItem>,
    seen: StringHashMap<()>,
}
impl PackQueue {
    /// A path that is already queued is dropped: no file is packed twice.
    fn add(&mut self, item: PackQueueItem) -> Result<(), AllocError> {
        if self.seen.get_or_put(item.path.as_bytes())?.found_existing {
            return Ok(());
        }
        self.heap.push(item);
        Ok(())
    }
    fn count(&self) -> usize {
        self.heap.len()
    }
    fn remove_or_null(&mut self) -> Option<PackQueueItem> {
        self.heap.pop()
    }
    pub(crate) fn into_paths(mut self) -> Vec<ZBox> {
        let mut out = Vec::with_capacity(self.heap.len());
        while let Some(item) = self.heap.pop() {
            out.push(item.path);
        }
        out
    }
}

/// (dir, dir_subpath, dir_depth)
struct DirInfo(Dir, Box<[u8]>, usize);

/// (dir, dir_depth). The root (depth 1) is the caller's and stays open; the walk closes the rest.
struct WalkedDir(Dir, usize);
impl Drop for WalkedDir {
    fn drop(&mut self) {
        if self.1 == 1 {
            self.0.fd = Fd::INVALID;
        }
    }
}

fn iterate_included_project_tree(
    pack_queue: &mut PackQueue,
    bins: &[BinInfo],
    includes: &[Pattern],
    excludes: &[Pattern],
    root_dir: &Dir,
    log_level: LogLevel,
) -> Result<(), AllocError> {
    let mut dirs = vec![DirInfo(Dir::from_fd(root_dir.fd), Box::default(), 1)];
    let mut included_dirs: Vec<DirInfo> = Vec::new();

    // first find included dirs and files
    while let Some(DirInfo(dir, dir_subpath, dir_depth)) = dirs.pop() {
        let dir = WalkedDir(dir, dir_depth);
        let dir = &dir.0;

        let mut dir_iter = DirIterator::iterate(Fd::from_std_dir(dir));
        while let Some(entry) = next_dir_entry(&mut dir_iter, &dir_subpath) {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice_u8();
            let entry_subpath = entry_subpath(&dir_subpath, entry_name)?;

            let mut included = false;
            let mut is_unconditionally_included = false;

            if dir_depth == 1 {
                if entry_name == b"package.json" || entry_name == b"node_modules" {
                    continue;
                }

                if entry.kind == bun_sys::FileKind::File
                    && is_unconditionally_included_file(entry_name)
                {
                    included = true;
                    is_unconditionally_included = true;
                }
            }

            if let Some((pattern, kind)) = is_unconditionally_excluded(entry_name, dir_depth) {
                print_ignored(log_level, kind, pattern, &entry_subpath, entry.kind);
                continue;
            }

            if !included {
                for include in includes {
                    if include.flags.contains(PatternFlags::DIRS_ONLY)
                        && entry.kind != bun_sys::FileKind::Directory
                    {
                        continue;
                    }

                    // `index.js` matches only at the root, `**/index.js` at any depth
                    if include.glob.r#match(entry_subpath.as_bytes()).matches() {
                        included = true;
                    }
                }
            }

            // There may be a "narrowing" exclusion that excludes a subset
            // of files within an included directory/pattern.
            if included && !is_unconditionally_included && !excludes.is_empty() {
                for exclude in excludes {
                    if exclude.flags.contains(PatternFlags::DIRS_ONLY)
                        && entry.kind != bun_sys::FileKind::Directory
                    {
                        continue;
                    }

                    let result = exclude.glob.r#match(entry_subpath.as_bytes());
                    if result.is_negated() && !result.matches() {
                        included = false;
                    }
                }
            }

            if entry.kind == bun_sys::FileKind::File {
                if included && !is_listed_bin(bins, BinType::File, &entry_subpath) {
                    pack_queue.add(PackQueueItem {
                        path: entry_subpath,
                    })?;
                }
                continue;
            }
            if is_listed_bin(bins, BinType::Dir, &entry_subpath) {
                continue;
            }
            // TODO: do not traverse directories whose files a pattern all excludes (`!test/**`)
            let subdir = open_subdir(dir, entry_name, &entry_subpath);
            let subdir = DirInfo(subdir, entry_subpath.as_bytes().into(), dir_depth + 1);
            if included {
                included_dirs.push(subdir);
            } else {
                dirs.push(subdir);
            }
        }
    }

    // for each included dir, traverse its entries, exclude any with `negate_no_match`.
    for included_dir_info in included_dirs {
        iterate_project_tree(
            pack_queue,
            bins,
            Some(excludes),
            included_dir_info,
            log_level,
        )?;
    }

    Ok(())
}

fn print_ignored(
    log_level: LogLevel,
    kind: IgnorePatternsKind,
    pattern: &[u8],
    entry_subpath: &ZStr,
    entry_kind: bun_sys::FileKind,
) {
    if !log_level.is_verbose() {
        return;
    }
    bun_core::prettyln!(
        "<r><blue>ignore<r> <d>[{}:{}]<r> {}{}",
        <&str>::from(kind),
        bun_fmt::escape_control_chars(pattern),
        bun_fmt::escape_control_chars(entry_subpath.as_bytes()),
        if entry_kind == bun_sys::FileKind::Directory {
            "/"
        } else {
            ""
        },
    );
    Output::flush();
}

/// Whether `errno` means nothing exists at the path. `ELOOP` comes from a cycle of symlinks.
fn is_absent(errno: bun_sys::E) -> bool {
    matches!(
        errno,
        bun_sys::E::ENOENT | bun_sys::E::ENOTDIR | bun_sys::E::ENAMETOOLONG | bun_sys::E::ELOOP
    )
}

const ITERABLE: bun_sys::OpenDirOptions = bun_sys::OpenDirOptions {
    iterate: true,
    no_follow: false,
};

#[cold]
fn fail_open_dir(err: crate::Error, subpath: &[u8]) -> ! {
    Output::err(
        err,
        "failed to open directory \"{}\" for packing",
        format_args!("{}", bstr::BStr::new(subpath)),
    );
    Global::crash();
}

/// Opens a directory that the walk listed, so every failure is fatal; one swapped for a symlink since is not followed.
fn open_subdir(dir: &Dir, entry_name: &[u8], entry_subpath: &ZStr) -> Dir {
    let opts = bun_sys::OpenDirOptions {
        iterate: true,
        // On Windows this would open the link itself instead of failing.
        no_follow: cfg!(not(windows)),
    };
    dir.open_dir(entry_name, opts)
        .unwrap_or_else(|err| fail_open_dir(err.into(), entry_subpath.as_bytes()))
}

/// `None` when the directory is not there. A directory that is there and does not open is fatal.
fn open_dir_if_present(root_dir: &Dir, subpath: &ZStr) -> Option<Dir> {
    match root_dir.open_dir(subpath.as_bytes(), ITERABLE) {
        Ok(dir) => Some(dir),
        Err(err) if is_absent(err.get_errno()) => None,
        Err(err) => fail_open_dir(err.into(), subpath.as_bytes()),
    }
}

/// `lstat`s where the filesystem reports no kind (FUSE, NFS, XFS `ftype=0`): a link stays a link.
pub(crate) fn next_dir_entry(
    iter: &mut DirIterator::WrappedIterator,
    dir_subpath: &[u8],
) -> Option<DirIterator::IteratorResult> {
    #[cfg_attr(windows, allow(unused_mut))] // The Windows iterator always knows the kind.
    let mut entry = match iter.next() {
        Ok(entry) => entry?,
        Err(err) if err.get_errno() == bun_sys::E::ENOENT => return None,
        Err(err) => fail_read_dir(err, dir_subpath),
    };
    #[cfg(not(windows))]
    if entry.kind == bun_sys::FileKind::Unknown {
        match bun_sys::lstatat(iter.dir(), entry.name.as_zstr()) {
            Ok(stat) => entry.kind = bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode),
            // Removed since it was listed. No walk packs an `Unknown`.
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => {}
            Err(err) => fail_read_dir(err, dir_subpath),
        }
    }
    Some(entry)
}

#[cold]
fn fail_read_dir(err: bun_sys::Error, dir_subpath: &[u8]) -> ! {
    let dir_subpath = if dir_subpath.is_empty() {
        b".".as_slice()
    } else {
        dir_subpath
    };
    Output::err(
        err,
        "failed to read directory \"{}\" for packing",
        format_args!("{}", bstr::BStr::new(dir_subpath)),
    );
    Global::crash();
}

fn entry_subpath(dir_subpath: &[u8], entry_name: &[u8]) -> Result<ZBox, AllocError> {
    let sep: &[u8] = if dir_subpath.is_empty() { b"" } else { b"/" };
    Ok(ZBox::from_vec_with_nul(
        [dir_subpath, sep, entry_name, b"\0"].concat(),
    ))
}

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

    // A folder that is not inside a `node_modules` is a workspace or a linked folder, not an
    // installed copy. It contributes the same files that its own tarball would contain.
    let below_project = (real_path.strip_prefix(&*bundle.project_path)).unwrap_or(&real_path);
    let is_own_package = !strings::contains(below_project, path::NODE_MODULES_NEEDLE);
    if is_own_package && manifests.is_none() && json.is_some_and(needs_workspace_manifests) {
        // Loading the workspace manifests resets the `Store` that holds `json`, so parse it again.
        *manifests = Some(WorkspaceManifests::load(manager));
        json = parse();
    }

    if let (Some(source), Some(json)) = (&source, &json) {
        find_dependencies_to_bundle(bundle, index, json, root_path)?;

        if is_own_package {
            let mut add_file = |file: &[u8], edited: Option<Box<[u8]>>| -> Result<(), AllocError> {
                bundle.files.push(BundledFile {
                    path: entry_subpath(&subpath, file)?,
                    source: entry_subpath(&real_path, file)?,
                    edited,
                });
                Ok(())
            };
            let edited = if needs_workspace_manifests(*json) {
                let indentation = JSON::guess_indentation(&source.contents);
                Some(edit_root_package_json(
                    manifests.as_ref(),
                    &real_path,
                    *json,
                    source,
                    indentation,
                )?)
            } else {
                None
            };
            add_file(b"package.json", edited)?;
            let (published, _) = published_files(&dir, &real_path, json, pack_bump(), log_level)?;
            for file in published.into_paths() {
                add_file(file.as_bytes(), None)?;
            }
            return Ok(());
        }
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

/// `files_excludes`: `"files"` includes the directory `root_dir`; these are its negated entries.
fn iterate_project_tree(
    pack_queue: &mut PackQueue,
    bins: &[BinInfo],
    files_excludes: Option<&[Pattern]>,
    root_dir: DirInfo,
    log_level: LogLevel,
) -> Result<(), AllocError> {
    let root_depth = root_dir.2;
    let mut ignores: Vec<IgnorePatterns> = Vec::new();

    if let Some(excludes) = files_excludes.filter(|excludes| !excludes.is_empty()) {
        ignores.push(IgnorePatterns {
            list: excludes.iter().map(Pattern::as_positive).collect(),
            kind: IgnorePatternsKind::PackageJson,
            depth: 1,
            // matching is done from the root directory
            has_rel_path: false,
        });
    }

    // Depth-first, so that ignore patterns are pushed and popped instead of cloned.
    let mut dirs: Vec<(DirInfo, InheritedIgnore)> = vec![(root_dir, None)];

    while let Some((DirInfo(dir, dir_subpath, dir_depth), inherited)) = dirs.pop() {
        let dir = WalkedDir(dir, dir_depth);
        let dir = &dir.0;

        while ignores.last().is_some_and(|last| last.depth >= dir_depth) {
            ignores.pop();
        }

        if let Some(patterns) = IgnorePatterns::read_from_disk(dir, dir_depth) {
            ignores.push(patterns);
        }

        let mut dir_iter = DirIterator::iterate(Fd::from_std_dir(dir));
        while let Some(entry) = next_dir_entry(&mut dir_iter, &dir_subpath) {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice_u8();
            let entry_subpath_ = entry_subpath(&dir_subpath, entry_name)?;

            if dir_depth == 1 {
                // The root package.json and the bundled dependencies are handled separately.
                if entry_name == b"package.json" || entry_name == b"node_modules" {
                    continue;
                }
            } else if files_excludes.is_some()
                && dir_depth == root_depth
                && entry.kind == bun_sys::FileKind::Directory
                && entry_name == b"node_modules"
            {
                continue;
            }

            let entries_inherit: InheritedIgnore =
                match is_excluded(&entry, &entry_subpath_, dir_depth, &ignores, &inherited) {
                    Exclusion::Included => None,
                    Exclusion::WalkOnly(pattern, kind) => Some((pattern.into(), kind)),
                    Exclusion::Excluded(pattern, kind) => {
                        print_ignored(log_level, kind, pattern, &entry_subpath_, entry.kind);
                        continue;
                    }
                };

            if entry.kind == bun_sys::FileKind::File {
                if !is_listed_bin(bins, BinType::File, &entry_subpath_) {
                    pack_queue.add(PackQueueItem {
                        path: entry_subpath_,
                    })?;
                }
            } else if !is_listed_bin(bins, BinType::Dir, &entry_subpath_) {
                let subdir = open_subdir(dir, entry_name, &entry_subpath_);
                dirs.push((
                    DirInfo(subdir, entry_subpath_.as_bytes().into(), dir_depth + 1),
                    entries_inherit,
                ));
            }
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum BinType {
    File,
    Dir,
}

pub(crate) struct BinInfo {
    path: ZBox,
    ty: BinType,
}

fn get_package_bins(json: &Expr) -> Vec<BinInfo> {
    let mut bins: Vec<BinInfo> = Vec::new();

    let mut path_buf = bun_paths::path_buffer_pool::get();
    let mut path_spill: Vec<u8> = Vec::new();
    let mut add = |value: &Expr, ty: BinType| {
        let Some(value) = value.as_string(pack_bump()) else {
            return;
        };
        if let Some(subpath) = bin_subpath(value, ty, &mut path_buf, &mut path_spill) {
            bins.push(BinInfo {
                path: ZBox::from_bytes(subpath),
                ty,
            });
        }
    };

    if let Some(bin) = non_empty_bin(json) {
        if let ExprData::EObject(bin_obj) = &bin.expr.data {
            for bin_prop in bin_obj.properties.slice() {
                if let Some(bin_prop_value) = &bin_prop.value {
                    add(bin_prop_value, BinType::File);
                }
            }
        } else {
            add(&bin.expr, BinType::File);
        }
    } else if let Some(ExprData::EObject(directories)) = json.get(b"directories").map(|e| e.data)
        && let Some(bin) = directories.as_property(b"bin")
    {
        add(&bin.expr, BinType::Dir);
    }

    bins
}

/// Like npm, an empty `"bin"` (`""`, `{}`) counts as absent, so `"directories.bin"` applies.
pub(crate) fn non_empty_bin(json: &Expr) -> Option<bun_ast::expr::Query> {
    json.as_property(b"bin").filter(|bin| match &bin.expr.data {
        ExprData::EString(bin_str) => bin_str.is_present(),
        ExprData::EObject(bin_obj) => bin_obj.properties.len_u32() != 0,
        _ => true,
    })
}

pub(crate) fn bin_subpath<'a>(
    value: &[u8],
    ty: BinType,
    buf: &'a mut [u8],
    spill: &'a mut Vec<u8>,
) -> Option<&'a [u8]> {
    let normalized = normalize_buf_z_spill::<path::platform::Posix>(buf, spill, value).as_bytes();
    let subpath = match ty {
        BinType::Dir => strings::without_trailing_slash(normalized),
        BinType::File if normalized.ends_with(b"/") || normalized == b"package.json" => {
            return None;
        }
        BinType::File => normalized,
    };
    // Nothing re-includes `.git` and `.npmrc`. Depth 2 leaves out the rule for the root's lockfiles.
    let never_packed =
        || strings::split(subpath, b"/").any(|name| is_unconditionally_excluded(name, 2).is_some());
    (!is_package_root_or_outside(subpath) && !never_packed()).then_some(subpath)
}

pub(crate) fn is_package_root_or_outside(p: &[u8]) -> bool {
    p.is_empty() || p == b"." || path::is_absolute_loose(p) || p == b".." || p.starts_with(b"../")
}

/// `Unknown` if `bin_path` is missing or a parent component is not a real directory.
pub(crate) fn bin_kind_without_following_symlinks(
    abs_workspace_path: &[u8],
    bin_path: &[u8],
) -> bun_sys::FileKind {
    // A trailing slash would make `lstat` resolve a symlink to a directory.
    let bin_path = strings::without_trailing_slash(bin_path);
    let mut spill: Vec<u8> = Vec::new();
    let slashes = (bin_path.iter().enumerate()).filter_map(|(i, &c)| (c == b'/').then_some(i));
    for end in slashes.chain([bin_path.len()]) {
        // By absolute path: on Windows `lstatat` reports a reparse point as its target's kind.
        let parts: [&[u8]; 2] = [abs_workspace_path, &bin_path[..end]];
        let abs_path =
            resolve_path::join_z_spill::<resolve_path::platform::Auto>(&mut spill, &parts);
        let stat = match bun_sys::lstat(abs_path) {
            Ok(stat) => stat,
            Err(err) if is_absent(err.get_errno()) => break,
            Err(err) => fail_file(err, "stat", bin_path),
        };
        let kind = bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode);
        if end == bin_path.len() {
            return kind;
        }
        if kind != bun_sys::FileKind::Directory {
            break;
        }
    }
    bun_sys::FileKind::Unknown
}

/// `published_files` has queued the bins already; the walks skip them.
fn is_listed_bin(bins: &[BinInfo], ty: BinType, subpath: &ZStr) -> bool {
    bins.iter()
        .any(|bin| bin.ty == ty && strings::eql_long(bin.path.as_bytes(), subpath.as_bytes(), true))
}

fn is_package_bin(bins: &[BinInfo], maybe_bin_path: &[u8]) -> bool {
    bins.iter().any(|bin| match bin.ty {
        BinType::File => strings::eql_long(bin.path.as_bytes(), maybe_bin_path, true),
        BinType::Dir => (maybe_bin_path.strip_prefix(bin.path.as_bytes()))
            .and_then(|remain| remain.strip_prefix(b"/"))
            .is_some_and(|name| !name.is_empty() && !strings::contains_char(name, b'/')),
    })
}

/// Default ignores that nothing (including an explicit `"files"` entry) can
/// re-include: the root lockfiles and the `can_override == false` patterns.
fn is_unconditionally_excluded(
    entry_name: &[u8],
    dir_depth: usize,
) -> Option<(&'static [u8], IgnorePatternsKind)> {
    let root_only = if dir_depth == 1 {
        ROOT_DEFAULT_IGNORE_PATTERNS
    } else {
        &[]
    };
    let strict = (DEFAULT_IGNORE_PATTERNS.iter())
        .filter_map(|&(p, can_override)| (!can_override).then_some(p));
    (root_only.iter().copied().chain(strict))
        .find(|pattern| glob::r#match(pattern, entry_name).matches())
        .map(|pattern| (pattern, IgnorePatternsKind::Default))
}

enum Exclusion<'a> {
    Included,
    Excluded(&'a [u8], IgnorePatternsKind),
    /// An excluded directory with a negation below it; unlike in npm, its entries stay excluded.
    WalkOnly(&'a [u8], IgnorePatternsKind),
}

/// The pattern that excluded the walked-only directory an entry is in.
type InheritedIgnore = Option<(Box<[u8]>, IgnorePatternsKind)>;

fn is_excluded<'a>(
    entry: &DirIterator::IteratorResult,
    entry_subpath: &'a ZStr,
    dir_depth: usize,
    ignores: &'a [IgnorePatterns],
    inherited: &'a InheritedIgnore,
) -> Exclusion<'a> {
    let entry_name = entry.name.slice_u8();

    if dir_depth == 1 {
        // first, check files that can never be ignored. project root
        // directory only
        if is_unconditionally_included_file(entry_name)
            || is_special_file_or_variant(entry_name, b"CHANGELOG")
        {
            return Exclusion::Included;
        }
    }

    if let Some((pattern, kind)) = is_unconditionally_excluded(entry_name, dir_depth) {
        return Exclusion::Excluded(pattern, kind);
    }

    let (mut ignored, mut ignore_pattern, mut ignore_kind): (bool, &[u8], IgnorePatternsKind) =
        match inherited {
            Some((pattern, kind)) => (true, &**pattern, *kind),
            None => (false, b"".as_slice(), IgnorePatternsKind::Npmignore),
        };
    let mut walk_only = false;

    // then check default ignore list. None of the defaults contain slashes
    // so just match against entry name

    for &(pattern, can_override) in DEFAULT_IGNORE_PATTERNS {
        if !can_override {
            continue;
        }
        if glob::r#match(pattern, entry_name).matches() {
            ignored = true;
            ignore_pattern = pattern;
            ignore_kind = IgnorePatternsKind::Default;

            // break. doesn't matter if more default patterns
            // match this path
            break;
        }
    }

    // lastly, check each .npmignore/.gitignore from root directory to
    // the current directory.
    for ignore in ignores {
        let mut rel: &[u8] = entry_subpath.as_bytes();
        if ignore.has_rel_path {
            // trim parent directories up to the directory
            // containing this ignore file
            for _ in 1..ignore.depth {
                if let Some(sep) = strings::index_of_char(rel, b'/') {
                    rel = &rel[(sep as usize) + 1..];
                }
            }
        }
        for pattern in ignore.list.iter() {
            if pattern.flags.contains(PatternFlags::DIRS_ONLY)
                && entry.kind != bun_sys::FileKind::Directory
            {
                continue;
            }

            let match_path = if pattern.flags.contains(PatternFlags::REL_PATH) {
                rel
            } else {
                entry_name
            };
            let result = pattern.glob.r#match(match_path);
            if result.is_negated() {
                if !result.matches() {
                    ignored = false;
                } else if ignored
                    && entry.kind == bun_sys::FileKind::Directory
                    && negation_reaches_below(pattern, rel)
                {
                    walk_only = true;
                }
            } else if result.matches() {
                ignored = true;
                walk_only = false;
                ignore_pattern = pattern.glob.pattern();
                ignore_kind = ignore.kind;
            }
        }
    }

    if !ignored {
        Exclusion::Included
    } else if walk_only {
        Exclusion::WalkOnly(ignore_pattern, ignore_kind)
    } else {
        Exclusion::Excluded(ignore_pattern, ignore_kind)
    }
}

/// Whether a negated pattern could match a path below the directory `dir_rel`.
fn negation_reaches_below(pattern: &Pattern, dir_rel: &[u8]) -> bool {
    // Without a slash it un-ignores entries of the directories that are walked, and opens none.
    if !pattern.flags.contains(PatternFlags::REL_PATH) {
        return false;
    }
    let mut glob_segments = strings::split(&pattern.glob.pattern()[b"!".len()..], b"/");
    for dir_name in strings::split(dir_rel, b"/") {
        match glob_segments.next() {
            Some(b"**") => return true,
            Some(segment) if glob::r#match(segment, dir_name).matches() => {}
            _ => return false,
        }
    }
    glob_segments.next().is_some()
}

/// Tag names for `bun_core::FileKind`.
fn file_kind_tag(kind: bun_core::FileKind) -> &'static str {
    use bun_core::FileKind as K;
    match kind {
        K::BlockDevice => "block_device",
        K::CharacterDevice => "character_device",
        K::Directory => "directory",
        K::NamedPipe => "named_pipe",
        K::SymLink => "sym_link",
        K::File => "file",
        K::UnixDomainSocket => "unix_domain_socket",
        K::Whiteout => "whiteout",
        K::Door => "door",
        K::EventPort => "event_port",
        K::Unknown => "unknown",
    }
}

/// Everything `bun pm pack` would put in the tarball besides package.json: bins, then either the `files` list or
/// the whole tree minus ignores. Shared with `bun pm diff`, whose local side is "what would be published".
/// `root_path` is the path `root_dir` was opened from.
pub(crate) fn published_files(
    root_dir: &Dir,
    root_path: &[u8],
    json_root: &Expr,
    bump: &bun_alloc::Arena,
    log_level: LogLevel,
) -> Result<(PackQueue, Vec<BinInfo>), AllocError> {
    let mut pack_queue = PackQueue::default();
    let bins = get_package_bins(json_root);

    for bin in &bins {
        let kind = bin_kind_without_following_symlinks(root_path, bin.path.as_bytes());
        match bin.ty {
            BinType::File if kind == bun_sys::FileKind::File => {
                pack_queue.add(PackQueueItem {
                    path: ZBox::from_bytes(bin.path.as_bytes()),
                })?;
            }
            BinType::Dir if kind == bun_sys::FileKind::Directory => {
                if let Some(bin_dir) = open_dir_if_present(root_dir, &bin.path) {
                    iterate_project_tree(
                        &mut pack_queue,
                        &[],
                        None,
                        DirInfo(bin_dir, bin.path.as_bytes().into(), 2),
                        log_level,
                    )?;
                }
            }
            _ => {}
        }
    }

    let Some(files) = json_root.get(b"files") else {
        iterate_project_tree(
            &mut pack_queue,
            &bins,
            None,
            DirInfo(Dir::from_fd(root_dir.fd), Box::default(), 1),
            log_level,
        )?;
        return Ok((pack_queue, bins));
    };

    #[cold]
    fn fail_files() -> ! {
        Output::err_generic("expected `files` to be an array of string values", ());
        Global::crash();
    }
    let Some(mut files_array) = files.as_array() else {
        fail_files();
    };
    let mut includes: Vec<Pattern> = Vec::new();
    let mut excludes: Vec<Pattern> = Vec::new();
    let mut path_buf = bun_paths::path_buffer_pool::get();
    let mut path_spill: Vec<u8> = Vec::new();
    while let Some(files_entry) = files_array.next() {
        let Some(file_entry_str) = files_entry.as_string(bump) else {
            fail_files();
        };
        let normalized = normalize_buf_z_spill::<path::platform::Posix>(
            &mut path_buf,
            &mut path_spill,
            file_entry_str,
        );
        match Pattern::from_utf8(normalized.as_bytes()) {
            Some(parsed) if parsed.flags.contains(PatternFlags::NEGATED) => excludes.push(parsed),
            Some(parsed) => includes.push(parsed),
            None => {}
        }
    }

    iterate_included_project_tree(
        &mut pack_queue,
        &bins,
        &includes,
        &excludes,
        root_dir,
        log_level,
    )?;
    Ok((pack_queue, bins))
}

/// Through the manager's cache; exits when it cannot be read or parsed.
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

fn expect_archive_ok(archive: &Archive, status: ArchiveResult, action: &str) {
    if matches!(
        status,
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn
    ) {
        Output::err_generic(
            "failed to {}: {}",
            (action, bstr::BStr::new(archive.error_string())),
        );
        Global::crash();
    }
}

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

    if let Err(err) = RunCommand::configure_env_for_run(
        &mut *ctx.command_ctx,
        &mut this_transpiler,
        Some(std::ptr::from_mut(ctx.manager.env_mut())),
        ConfigureEnvOptions {
            log_errors: ctx.manager.options.log_level != LogLevel::Silent,
            store_root_fd: false,
        },
    ) {
        if matches!(err, crate::Error::Alloc(_)) {
            return Err(PackError::OutOfMemory);
        }
        Output::err_generic(
            "failed to run pack scripts due to error: {}\n",
            format_args!("{}", err.name()),
        );
        Global::crash();
    }

    let abs_workspace_path: &[u8] = path::string_paths::without_trailing_slash_windows_path(
        strings::without_suffix_comptime(abs_package_json_path.as_bytes(), b"package.json"),
    );
    // SAFETY: `configure_env_for_run` fully initialized `this_transpiler`.
    let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
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

    // Not before the scripts: one of them may be what writes the real version.
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

    let archive = WriteArchive::new();

    expect_archive_ok(
        &archive,
        archive.write_set_format_pax_restricted(),
        "set archive format",
    );
    expect_archive_ok(
        &archive,
        archive.write_add_filter_gzip(),
        "set archive compression to gzip",
    );

    // default is 9
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L12
    let compression_level: &[u8] = ctx.manager.options.pack_gzip_level.unwrap_or(b"9");
    match archive.write_set_filter_option(
        None,
        bun_core::zstr!("compression-level"),
        &ZBox::from_bytes(compression_level),
    ) {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "compression level must be between 0 and 9, received {}",
                format_args!("{}", bstr::BStr::new(compression_level)),
            );
            Global::crash();
        }
        _ => {}
    }

    expect_archive_ok(
        &archive,
        archive.write_set_filter_option(None, bun_core::zstr!("os"), bun_core::zstr!("Unknown")),
        "set os to `Unknown`",
    );
    expect_archive_ok(
        &archive,
        archive.write_set_options(bun_core::zstr!("gzip:!timestamp")),
        "unset gzip timestamp option",
    );
    // Same as `archive_write_open_filename` set for a file, so the output stays byte-identical.
    expect_archive_ok(
        &archive,
        archive.write_set_bytes_in_last_block(1),
        "set archive block padding",
    );

    // `bun publish` uploads the bytes from memory; only `bun pm pack` writes a file.
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
    let mut tarball_buffer = GrowingBuffer::forward_to(&mut write_tarball);
    // Rebound here so that it is dropped before `tarball_buffer`. Closing the archive, which its
    // `Drop` also does, writes into that buffer.
    let archive = archive;

    if archive_write_open2(
        &archive,
        (&raw mut tarball_buffer).cast(),
        Some(GrowingBuffer::open_callback),
        Some(GrowingBuffer::write_callback),
        Some(GrowingBuffer::close_callback),
        None,
    ) != 0
    {
        Output::err_generic(
            "failed to open archive for writing: {}",
            format_args!("{}", bstr::BStr::new(archive.error_string())),
        );
        Global::crash();
    }

    // append removed items from `pack_queue` with their file size
    let mut pack_list: PackList = Vec::new();

    let mut read_buf = vec![0u8; 512 * 1024];

    let mut entry = ArchiveEntry::new2(&archive);

    {
        let mut progress = Progress::Progress::default();
        let mut node: Option<&mut Progress::Node> = None;
        if log_level.show_progress() {
            progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            let started = progress.start(b"", ctx.stats.total_files);
            started.unit = Progress::Unit::Files;
            node = Some(started);
        }

        entry = archive_package_json(&mut ctx, &archive, entry, &root_dir, &edited_package_json);
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

            entry = add_archive_entry(
                &mut ctx,
                fd,
                &stat,
                &item.path,
                &mut read_buf,
                &archive,
                entry,
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

            entry = add_archive_entry(
                &mut ctx,
                file.handle,
                &stat,
                &item.path,
                &mut read_buf,
                &archive,
                entry,
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

    ArchiveEntry::opaque_ref(entry).free();

    match archive.write_close() {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            archive_write_failed(&archive);
        }
        _ => {}
    }

    drop(archive);

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

/// Whether a `name` or `version` could steer the tarball's filename outside the destination directory.
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
fn archive_write_failed(archive: &Archive) -> ! {
    Output::err_generic(
        "failed to write tarball: {}",
        format_args!("{}", bstr::BStr::new(archive.error_string())),
    );
    Global::crash();
}

/// `archive_write_data` returns the byte count, or a negative status when the write fails.
fn write_archive_data(archive: &Archive, data: &[u8]) -> usize {
    match usize::try_from(archive.write_data(data)) {
        Ok(written) => written,
        Err(_) => archive_write_failed(archive),
    }
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
    archive: &Archive,
    entry: *mut ArchiveEntry,
    root_dir: &Dir,
    edited_package_json: &[u8],
) -> *mut ArchiveEntry {
    // `entry` is the same pointer after `.clear()`.
    let entry = ArchiveEntry::opaque_ref(entry);
    let stat = stat_package_json(root_dir);

    entry.set_pathname(bun_core::zstr!("package/package.json"));
    entry.set_size(i64::try_from(edited_package_json.len()).expect("int cast"));
    // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
    entry.set_filetype(0o100000);
    entry.set_perm(stat.st_mode as bun_sys::Mode);
    // '1985-10-26T08:15:00.000Z'
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
    entry.set_mtime(499162500, 0);

    match archive.write_header(entry) {
        ArchiveResult::Fatal => archive_write_failed(archive),
        ArchiveResult::Failed | ArchiveResult::Warn => {
            Output::err_generic(
                "failed to write tarball header: {}",
                format_args!("{}", bstr::BStr::new(archive.error_string())),
            );
            Global::crash();
        }
        _ => {}
    }

    ctx.stats.unpacked_size += write_archive_data(archive, edited_package_json);

    entry.clear()
}

fn add_archive_entry(
    ctx: &mut Context<'_>,
    file: Fd,
    stat: &bun_sys::Stat,
    filename: &ZStr,
    read_buf: &mut [u8],
    archive: &Archive,
    entry: *mut ArchiveEntry,
    bins: &[BinInfo],
    // If set, these bytes are archived instead of the contents of `file`.
    edited: Option<&[u8]>,
) -> *mut ArchiveEntry {
    // `entry` is the same pointer after `.clear()`.
    let entry = ArchiveEntry::opaque_ref(entry);
    let pathname = [b"package/".as_slice(), filename.as_bytes_with_nul()].concat();
    let pathname = ZBox::from_vec_with_nul(pathname);
    #[cfg(windows)]
    entry.set_pathname_utf8(&pathname);
    #[cfg(not(windows))]
    entry.set_pathname(&pathname);

    entry.set_size(edited.map_or(stat.st_size as i64, |edited| edited.len() as i64));

    // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
    entry.set_filetype(0o100000);

    let mut perm: bun_sys::Mode = stat.st_mode as bun_sys::Mode;
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L20
    if is_package_bin(bins, filename.as_bytes()) {
        perm |= 0o111;
    }
    entry.set_perm(perm);

    // '1985-10-26T08:15:00.000Z'
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
    entry.set_mtime(499162500, 0);

    match archive.write_header(entry) {
        ArchiveResult::Fatal => archive_write_failed(archive),
        ArchiveResult::Failed => {
            Output::err_generic(
                "failed to write tarball header: {}",
                format_args!("{}", bstr::BStr::new(archive.error_string())),
            );
            Global::crash();
        }
        _ => {}
    }

    if let Some(edited) = edited {
        ctx.stats.unpacked_size += write_archive_data(archive, edited);
        return entry.clear();
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
            written += write_archive_data(archive, chunk);
        }
    }
    ctx.stats.unpacked_size += written;

    // libarchive drops bytes past the size in the header, and pads an entry that is too short with
    // zeros, so a file that shrank has to be caught here.
    if (written as i64) < stat.st_size as i64 {
        Output::err_generic(
            "file shrank while packing: \"{}\"",
            format_args!("{}", bun_fmt::escape_control_chars(filename.as_bytes())),
        );
        Global::crash();
    }

    entry.clear()
}

/// What the tarball's package.json gets in place of a `workspace:` or `catalog:` spec.
pub(crate) enum Substitution<'a> {
    /// `workspace:^` / `~` / `*`: the workspace's current version behind that prefix.
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

    /// `Err`: which protocol does not resolve, and why.
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

/// Alias first, as the installer reads it; directory before range, since only a directory has a version.
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

/// `workspace:<name>@<range>`; `<name>` may be scoped, and `../@scope/pkg` is a directory.
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

/// A glob pattern used to ignore or include files in the project tree.
/// Might come from .npmignore, .gitignore, or `files` in package.json
pub(crate) struct Pattern {
    pub(crate) glob: glob::Prepared<CowString>,
    pub(crate) flags: PatternFlags,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct PatternFlags: u8 {
        /// beginning or middle slash (leading slash was trimmed)
        const REL_PATH = 1 << 0;
        /// can only match directories (had an ending slash, also trimmed)
        const DIRS_ONLY = 1 << 1;
        /// true if the pattern starts with `!`
        const NEGATED = 1 << 2;
    }
}

impl Pattern {
    pub(crate) fn from_utf8(pattern: &[u8]) -> Option<Pattern> {
        let mut flags = PatternFlags::empty();
        // Any number of leading `!` counts as one.
        let mut remain = strings::trim_leading_char(pattern, b'!');
        flags.set(PatternFlags::NEGATED, remain.len() != pattern.len());
        if let Some(trimmed) = remain.strip_suffix(b"/") {
            flags |= PatternFlags::DIRS_ONLY;
            remain = trimmed;
        }
        if let Some(trimmed) = remain.strip_prefix(b"/") {
            flags |= PatternFlags::REL_PATH;
            remain = trimmed;
        } else if strings::index_of_char_usize(remain, b'/').is_some_and(|i| i != remain.len() - 1)
        {
            flags |= PatternFlags::REL_PATH;
        }
        if remain.is_empty() {
            return None;
        }

        let negation: &[u8] = if flags.contains(PatternFlags::NEGATED) {
            b"!"
        } else {
            b""
        };
        Some(Pattern {
            glob: glob::Prepared::new(CowString::init_owned(
                [negation, remain].concat().into_boxed_slice(),
            )),
            flags,
        })
    }

    /// Invert a negated pattern to a positive pattern
    pub(crate) fn as_positive(&self) -> Pattern {
        debug_assert!(self.flags.contains(PatternFlags::NEGATED));
        Pattern {
            // remove the leading `!`
            glob: glob::Prepared::new(self.glob.source().borrow_subslice(1, None)),
            flags: self.flags.difference(PatternFlags::NEGATED),
        }
    }
}

struct IgnorePatterns {
    pub list: Box<[Pattern]>,
    pub kind: IgnorePatternsKind,
    pub depth: usize,
    /// At least one of the patterns has a leading or middle slash, so a relative path is needed.
    pub has_rel_path: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub(crate) enum IgnorePatternsKind {
    #[strum(serialize = "default")]
    Default,
    #[strum(serialize = ".npmignore")]
    Npmignore,
    #[strum(serialize = ".gitignore")]
    Gitignore,
    /// Exclusion pattern in "files" field within `package.json`
    #[strum(serialize = "package.json")]
    PackageJson,
}

impl IgnorePatterns {
    /// Fatal: the tarball would hold the files that were to be ignored.
    fn ignore_file_fail(
        dir: &Dir,
        ignore_kind: IgnorePatternsKind,
        action: &str,
        err: bun_sys::Error,
    ) -> ! {
        let mut buf = bun_paths::path_buffer_pool::get();
        let dir_path: &[u8] = match bun_sys::get_fd_path(Fd::from_std_dir(dir), &mut buf) {
            Ok(p) => &*p,
            Err(_) => b"",
        };
        Output::err(
            crate::Error::from(err),
            "failed to {} {} at: \"{}{}{}\"",
            (
                action,
                <&str>::from(ignore_kind),
                bstr::BStr::new(strings::without_trailing_slash(dir_path)),
                SEP_STR,
                <&str>::from(ignore_kind),
            ),
        );
        Global::crash();
    }

    /// Same as git's `trim_trailing_spaces` in dir.c: `foo\ ` keeps its space.
    fn trim_trailing_spaces(line: &[u8]) -> &[u8] {
        let mut last_space: Option<usize> = None;
        let mut i = 0;
        while i < line.len() {
            match line[i] {
                b' ' => {
                    if last_space.is_none() {
                        last_space = Some(i);
                    }
                }
                b'\\' => {
                    i += 1;
                    if i == line.len() {
                        return line;
                    }
                    last_space = None;
                }
                _ => last_space = None,
            }
            i += 1;
        }
        match last_space {
            Some(end) => &line[..end],
            None => line,
        }
    }

    /// ignore files are always ignored, don't need to worry about opening or reading twice
    fn read_from_disk(dir: &Dir, dir_depth: usize) -> Option<IgnorePatterns> {
        let mut opened: Option<(File, IgnorePatternsKind)> = None;
        for kind in [IgnorePatternsKind::Npmignore, IgnorePatternsKind::Gitignore] {
            match dir.open_file(<&str>::from(kind).as_bytes(), bun_sys::O::RDONLY, 0) {
                Ok(file) => {
                    opened = Some((file, kind));
                    break;
                }
                Err(err) if err.get_errno() == bun_sys::E::ENOENT => {}
                Err(err) => Self::ignore_file_fail(dir, kind, "open", err),
            }
        }
        let (ignore_file, ignore_kind) = opened?;

        let contents = ignore_file
            .read_to_end()
            .unwrap_or_else(|err| Self::ignore_file_fail(dir, ignore_kind, "read", err));
        let _ = ignore_file.close();

        let mut patterns: Vec<Pattern> = Vec::new();
        let mut has_rel_path = false;

        for line in strings::split(strings::without_utf8_bom(&contents), b"\n") {
            // comment
            if line.starts_with(b"#") {
                continue;
            }
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            let Some(parsed) = Pattern::from_utf8(Self::trim_trailing_spaces(line)) else {
                continue;
            };
            has_rel_path |= parsed.flags.contains(PatternFlags::REL_PATH);
            patterns.push(parsed);
        }

        (!patterns.is_empty()).then(|| IgnorePatterns {
            list: patterns.into_boxed_slice(),
            kind: ignore_kind,
            depth: dir_depth,
            has_rel_path,
        })
    }
}

enum PackListOrQueue<'a> {
    /// A dry run read nothing, so the sizes come from `stat`.
    Queue(&'a mut PackQueue),
    /// What was archived, and the length of the edited package.json.
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

/// Some files are always packed, even if they are explicitly ignored or not
/// included in package.json "files".
fn is_unconditionally_included_file(filename: &[u8]) -> bool {
    filename.len() > 5
        && (strings_eql(filename, b"package.json")
            || is_special_file_or_variant(filename, b"LICENSE")
            || is_special_file_or_variant(filename, b"LICENCE") // THIS IS SPELLED DIFFERENTLY
            || is_special_file_or_variant(filename, b"README"))
}

// TODO: should this be case insensitive on all platforms?
#[inline]
fn strings_eql(a: &[u8], b: &'static [u8]) -> bool {
    if cfg!(any(target_os = "linux", target_os = "android")) {
        a == b
    } else {
        strings::eql_case_insensitive_ascii_check_length(a, b)
    }
}

/// `name` itself, or `name` with an extension.
#[inline]
fn is_special_file_or_variant(filename: &[u8], name: &'static [u8]) -> bool {
    let Some((stem, extension)) = filename.split_at_checked(name.len()) else {
        return false;
    };
    strings_eql(stem, name)
        && (extension.is_empty() || (extension.len() > 1 && extension[0] == b'.'))
}

pub(crate) mod bindings {
    use super::*;
    use bun_core::String as BunString;
    use bun_jsc::{
        CallFrame, JSArray, JSGlobalObject, JSValue, JsResult, StringJsc as _, bun_string_jsc,
    };

    #[bun_jsc::host_fn]
    pub(crate) fn js_read_tarball(
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = call_frame.arguments();
        if args.len() < 1 || !args[0].is_string() {
            return Err(global.throw(format_args!("expected tarball path string argument")));
        }

        let tarball_path_str = args[0].to_bun_string(global)?;

        let tarball_path = tarball_path_str.to_utf8();

        let tarball_file = match bun_sys::open_file(tarball_path.slice(), Default::default()) {
            Ok(f) => f,
            Err(err) => {
                return Err(global.throw(format_args!(
                    "failed to open tarball file \"{}\": {}",
                    bstr::BStr::new(tarball_path.slice()),
                    crate::Error::from(err).name(),
                )));
            }
        };

        let tarball = match tarball_file.read_to_end() {
            Ok(b) => b,
            Err(err) => {
                let _ = tarball_file.close();
                return Err(global.throw(format_args!(
                    "failed to read tarball contents \"{}\": {}",
                    bstr::BStr::new(tarball_path.slice()),
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
        let base64_buf = bun_base64::encode_alloc(&sha512_digest);
        let integrity_value = bun_string_jsc::create_utf8_for_js(global, &base64_buf)?;

        struct EntryInfo {
            pathname: BunString,
            kind: bun_sys::FileKind,
            perm: bun_sys::Mode,
            contents: Option<BunString>,
        }
        let mut entries_info: Vec<EntryInfo> = Vec::new();

        let archive = Archive::opaque_ref(Archive::read_new());
        let check = |status: ArchiveResult, action: &str| -> JsResult<()> {
            match status {
                ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => Err(global
                    .throw(format_args!(
                        "failed to {}: {}",
                        action,
                        bstr::BStr::new(archive.error_string())
                    ))),
                _ => Ok(()),
            }
        };

        check(archive.read_support_format_tar(), "support tar")?;
        check(archive.read_support_format_gnutar(), "support gnutar")?;
        check(
            archive.read_support_filter_gzip(),
            "support gzip compression",
        )?;
        check(
            archive.read_set_options(c"read_concatenated_archives"),
            "set read_concatenated_archives option",
        )?;
        check(archive.read_open_memory(&tarball), "open archive in memory")?;

        let mut archive_entry: *mut ArchiveEntry = core::ptr::null_mut();
        let mut header_status = archive.read_next_header(&mut archive_entry);

        let mut read_buf: Vec<u8> = Vec::new();

        while header_status != ArchiveResult::Eof {
            match header_status {
                ArchiveResult::Eof => unreachable!(),
                ArchiveResult::Retry => {
                    header_status = archive.read_next_header(&mut archive_entry);
                    continue;
                }
                ArchiveResult::Failed | ArchiveResult::Fatal => {
                    return Err(global.throw(format_args!(
                        "failed to read archive header: {}",
                        bstr::BStr::new(archive.error_string()),
                    )));
                }
                _ => {
                    let archive_entry_ref = ArchiveEntry::opaque_mut(archive_entry);
                    #[cfg(windows)]
                    let pathname_string = {
                        let pathname_w = archive_entry_ref.pathname_w();
                        let result = bun_core::handle_oom(strings::to_utf8_list_with_type(
                            Vec::new(),
                            pathname_w,
                        ));
                        BunString::clone_utf8(&result)
                    };
                    #[cfg(not(windows))]
                    let pathname_string = BunString::clone_utf8(archive_entry_ref.pathname());

                    let kind = bun_sys::kind_from_mode(archive_entry_ref.filetype());
                    let perm = archive_entry_ref.perm();

                    let mut entry_info = EntryInfo {
                        pathname: pathname_string,
                        kind,
                        perm,
                        contents: None,
                    };

                    if kind == bun_sys::FileKind::File {
                        let size: usize =
                            usize::try_from(archive_entry_ref.size()).expect("int cast");
                        read_buf.resize(size, 0);

                        let read = archive.read_data(&mut read_buf);
                        if read < 0 {
                            let pathname_utf8 = entry_info.pathname.to_utf8();
                            return Err(global.throw(format_args!(
                                "failed to read archive entry \"{}\": {}",
                                bstr::BStr::new(pathname_utf8.slice()),
                                bstr::BStr::new(archive.error_string()),
                            )));
                        }
                        read_buf.truncate(usize::try_from(read).expect("int cast"));
                        entry_info.contents = Some(BunString::clone_utf8(&read_buf));
                        read_buf.clear();
                    }

                    entries_info.push(entry_info);
                }
            }
            header_status = archive.read_next_header(&mut archive_entry);
        }

        check(archive.read_close(), "close read archive")?;
        check(archive.read_free(), "close read archive")?;

        let entries = JSArray::create_empty(global, entries_info.len())?;

        for (i, entry) in entries_info.into_iter().enumerate() {
            let obj = JSValue::create_empty_object(global, 0);
            obj.put(global, b"pathname", entry.pathname.into_js(global)?);
            let kind = match entry.kind {
                bun_sys::FileKind::Unknown => global.common_strings().unknown(),
                kind => BunString::static_(file_kind_tag(kind)).to_js(global)?,
            };
            obj.put(global, b"kind", kind);
            obj.put(global, b"perm", JSValue::js_number(f64::from(entry.perm)));
            if let Some(contents) = entry.contents {
                obj.put(global, b"contents", contents.into_js(global)?);
            }
            entries.put_index(global, u32::try_from(i).expect("int cast"), obj)?;
        }

        let result = JSValue::create_empty_object(global, 4);
        result.put(global, b"entries", entries);
        result.put(global, b"size", JSValue::js_number(tarball.len() as f64));
        result.put(global, b"shasum", shasum_str.into_js(global)?);
        result.put(global, b"integrity", integrity_value);

        Ok(result)
    }
}
