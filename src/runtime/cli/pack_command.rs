use bun_collections::VecExt;
use core::ffi::c_char;
use core::fmt;
use std::io::Write as _;

use crate::cli::Command;
use crate::cli::publish_command as Publish;
use bun_alloc::AllocError;
use bun_collections::StringHashMap;
use bun_core::{self as bun, Global, Output, Progress, fmt as bun_fmt};
use bun_glob as glob;
use bun_install::package_manager::LogLevel;
use bun_install::package_manager::workspace_package_json_cache as WorkspacePackageJSONCache;
use bun_install::{Dependency, Lockfile, PackageManager};
use bun_parsers::json as JSON;
// PORT NOTE: `WorkspacePackageJSONCache` returns the T2 value-subset
// `bun_ast::Expr` (see `bun_install::bun_json`), not the full T4
// `bun_ast::Expr`. All JSON inspection in this file uses the T2 type;
// the two T4 sinks (`js_printer::print_json`, `Publish::normalized_package`)
// lift via `bun_ast::Expr::from(t2_expr)` at the call site.
use bun_ast::{E, Expr, ExprData};
use bun_js_printer as js_printer;
use bun_libarchive::lib::{Archive, Entry as ArchiveEntry, Result as ArchiveStatus};
use bun_paths::{self as path, PathBuffer, SEP_STR};
// `bun.ptr.CowString = CowSlice(u8)` — the lifetime-free struct port (init_owned/
// borrow_subslice/length live on `cow_slice::CowSliceZ`, not on the `std::borrow::Cow`
// alias re-exported at `bun_ptr::CowString`).
use bun_ptr::cow_slice::CowSlice;
type CowString = CowSlice<u8>;
use crate::cli::run_command::RunCommand;
use bun_core::ZBox;
use bun_core::{ZStr, strings};
use bun_glob::matcher::MatchResult as GlobMatchResult;
use bun_paths::resolve_path;
use bun_semver as Semver;
use bun_sha_hmac::sha;
use bun_sys::{
    self, CloseOnDrop, Dir, Fd, FdDirExt as _, FdExt as _, File, dir_iterator as DirIterator,
};

// ───────────────────────────────────────────────────────────────────────────
// local shims for upstream-stub gaps
// ───────────────────────────────────────────────────────────────────────────

/// `std.fs.Dir.openDirZ(path, .{ .iterate = true })` — `bun_sys::Dir` has no
/// such inherent method; route through `bun_sys::open_dir_at`.
#[inline]
fn dir_open_dir_z(
    dir: &Dir,
    path: &ZStr,
    _opts: bun_sys::OpenDirOptions,
) -> Result<Dir, bun_core::Error> {
    bun_sys::open_dir_at(dir.fd, path.as_bytes())
        .map(Dir::from_fd)
        .map_err(Into::into)
}

/// Process-lifetime bump arena for `Expr::as_string*` / `E::EString` data
/// (Zig: `ctx.allocator`, an arena freed at process exit). `bun_alloc::Arena`
/// (= `bumpalo::Bump`) is `!Sync`, so a `static LazyLock` is out; store the
/// arena directly in a `thread_local!` and hand out a `'static` borrow — the
/// CLI is single-threaded and the slot lives for the thread's lifetime.
fn pack_bump() -> &'static bun_alloc::Arena {
    thread_local! {
        static BUMP: bun_alloc::Arena = bun_alloc::Arena::new();
    }
    // SAFETY: `BUMP` is never dropped (thread = process lifetime in `bun pm
    // pack`), and `Arena` is `!Sync` so no cross-thread aliasing. Erase the
    // borrow to `'static` to mirror Zig's allocator-owned slices.
    BUMP.with(|b| unsafe { &*std::ptr::from_ref::<bun_alloc::Arena>(b) })
}

/// `bun.sys.File.toSourceAt` re-homed here (T1→T2 layering split: `bun_sys`
/// can't depend on `bun_logger`, but `bun_runtime` already does).
fn file_to_source_at(dir: &Dir, path: &ZStr) -> bun_sys::Maybe<bun_ast::Source> {
    let bytes = File::read_from(dir.fd, path)?;
    Ok(bun_ast::Source::init_path_string_owned(
        path.as_bytes(),
        bytes,
    ))
}

/// `manager.log` deref — Zig: non-optional `*logger.Log`, set once at `init()`.
/// Raw-pointer receiver so the borrow doesn't conflict with the simultaneous
/// `&mut workspace_package_json_cache` borrow at the call site (mirrors Zig's
/// freely-aliased `*PackageManager`).
#[inline]
fn pm_log<'a>(m: *mut PackageManager) -> &'a mut bun_ast::Log {
    // SAFETY: `m` came from `&mut PackageManager`; `log` is non-null after
    // `PackageManager::init()` (Zig: non-optional `*Log`).
    unsafe { &mut *(*m).log }
}
/// `manager.workspace_package_json_cache` field projection via raw pointer.
#[inline]
fn pm_workspace_cache<'a>(
    m: *mut PackageManager,
) -> &'a mut WorkspacePackageJSONCache::WorkspacePackageJSONCache {
    // SAFETY: `m` came from `&mut PackageManager`; field disjoint from `log`.
    unsafe { &mut (*m).workspace_package_json_cache }
}
#[inline]
fn pm_env(m: &PackageManager) -> *mut bun_dotenv::Loader<'static> {
    // Zig: non-optional `*DotEnv.Loader`, set during `PackageManager.init`.
    m.env
        .map(|p| p.as_ptr())
        .expect("env set by PackageManager::init")
}
#[inline]
fn pm_run_scripts(m: &PackageManager) -> bool {
    m.options.do_.run_scripts()
}

// type aliases matching Zig `string`/`stringZ`
// (used as `&[u8]` / `&ZStr` at fn boundaries; owned forms use Box<[u8]> / Box<ZStr>)

pub struct PackCommand;

// ───────────────────────────────────────────────────────────────────────────
// Context
// ───────────────────────────────────────────────────────────────────────────

pub struct Context<'a> {
    pub manager: &'a mut PackageManager,
    // allocator param dropped — global mimalloc (see PORTING.md §Allocators)
    pub command_ctx: Command::Context<'a>,

    /// `bun pack` does not require a lockfile, but
    /// it's possible we will need it for finding
    /// workspace versions. This is the only valid lockfile
    /// pointer in this file. `manager.lockfile` is incorrect
    pub lockfile: Option<&'a Lockfile>,

    pub bundled_deps: Vec<BundledDep>,

    pub stats: Stats,
}

#[derive(Default, Clone, Copy)]
pub struct Stats {
    pub unpacked_size: usize,
    pub total_files: usize,
    pub ignored_files: usize,
    pub ignored_directories: usize,
    pub packed_size: usize,
    pub bundled_deps: usize,
}

impl<'a> Context<'a> {
    pub fn print_summary(
        stats: Stats,
        maybe_shasum: Option<&[u8; sha::SHA1::DIGEST]>,
        maybe_integrity: Option<&[u8; sha::SHA512::DIGEST]>,
        log_level: LogLevel,
    ) {
        if log_level != LogLevel::Silent && log_level != LogLevel::Quiet {
            Output::prettyln(format_args!(
                "\n<r><b><blue>Total files<r>: {}",
                stats.total_files
            ));
            if let Some(shasum) = maybe_shasum {
                Output::prettyln(format_args!(
                    "<b><blue>Shasum<r>: {}",
                    bun_fmt::bytes_to_hex_lower_string(shasum),
                ));
            }
            if let Some(integrity) = maybe_integrity {
                Output::prettyln(format_args!(
                    "<b><blue>Integrity<r>: {}",
                    bun_fmt::integrity::<true>(*integrity),
                ));
            }
            Output::prettyln(format_args!(
                "<b><blue>Unpacked size<r>: {}",
                bun_fmt::size(
                    stats.unpacked_size,
                    bun_fmt::SizeFormatterOptions {
                        space_between_number_and_unit: false
                    }
                ),
            ));
            if stats.packed_size > 0 {
                Output::pretty(format_args!(
                    "<b><blue>Packed size<r>: {}\n",
                    bun_fmt::size(
                        stats.packed_size,
                        bun_fmt::SizeFormatterOptions {
                            space_between_number_and_unit: false
                        }
                    ),
                ));
            }
            if stats.bundled_deps > 0 {
                Output::pretty(format_args!(
                    "<b><blue>Bundled deps<r>: {}\n",
                    stats.bundled_deps
                ));
            }
        }
    }
}

#[derive(Clone)]
pub struct BundledDep {
    pub name: Box<[u8]>,
    pub was_packed: bool,
    pub from_root_package_json: bool,
}

// ───────────────────────────────────────────────────────────────────────────
// exec
// ───────────────────────────────────────────────────────────────────────────

impl PackCommand {
    pub fn exec_with_manager(
        ctx: Command::Context<'_>,
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        use bun_install::lockfile::{LoadResult, LoadStep};

        if manager.options.log_level != LogLevel::Silent
            && manager.options.log_level != LogLevel::Quiet
        {
            Output::prettyln(format_args!(
                "<r><b>bun pack <r><d>v{}<r>",
                Global::package_json_version_with_sha,
            ));
            Output::flush();
        }

        let mut lockfile = Lockfile::default();
        // `log` is non-null after `PackageManager::init()` (Zig: non-optional `*Log`).
        let log_ptr: *mut bun_ast::Log = manager.log;
        let manager_ptr: *mut PackageManager = manager;
        // SAFETY: `manager_ptr`/`log_ptr` came from live `&mut`; reborrowed disjointly
        // (Zig passed both via the same `*PackageManager` alias).
        let load_from_disk_result = lockfile
            .load_from_cwd::<false>(Some(unsafe { &mut *manager_ptr }), unsafe { &mut *log_ptr });

        let lockfile_ref: Option<&Lockfile> = match load_from_disk_result {
            LoadResult::Ok(ok) => Some(&*ok.lockfile),
            LoadResult::Err(cause) => 'err: {
                match cause.step {
                    LoadStep::OpenFile => {
                        if cause.value == bun_core::err!("ENOENT") {
                            break 'err None;
                        }
                        Output::err_generic(
                            "failed to open lockfile: {}",
                            format_args!("{}", cause.value.name()),
                        );
                    }
                    LoadStep::ParseFile => {
                        Output::err_generic(
                            "failed to parse lockfile: {}",
                            format_args!("{}", cause.value.name()),
                        );
                    }
                    LoadStep::ReadFile => {
                        Output::err_generic(
                            "failed to read lockfile: {}",
                            format_args!("{}", cause.value.name()),
                        );
                    }
                    LoadStep::Migrating => {
                        Output::err_generic(
                            "failed to migrate lockfile: {}",
                            format_args!("{}", cause.value.name()),
                        );
                    }
                }
                if pm_log(manager_ptr).has_errors() {
                    let _ = pm_log(manager_ptr).print(std::ptr::from_mut(Output::error_writer()));
                }
                Global::crash();
            }
            LoadResult::NotFound => None,
        };

        // PORT NOTE: Zig packed both `manager` and `lockfile` into `Context` and
        // freely aliased the `*PackageManager`; here split-borrowing through
        // `Context` would conflict with `&mut PackageManager`, so capture the
        // package.json path before constructing `Context`.
        let abs_pkg_json = ZBox::from_bytes(manager.original_package_json_path.as_bytes());

        let mut pack_ctx = Context {
            manager,
            command_ctx: ctx,
            lockfile: lockfile_ref,
            bundled_deps: Vec::new(),
            stats: Stats::default(),
        };

        // just pack the current workspace
        if let Err(err) = pack::<false>(&mut pack_ctx, &abs_pkg_json) {
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
                PackError::MissingPackageJSON => {
                    Output::err_generic(
                        "failed to find a package.json in: \"{}\"",
                        format_args!("{}", bstr::BStr::new(abs_pkg_json.as_bytes())),
                    );
                    Global::crash();
                }
                // for_publish-only variants — unreachable when FOR_PUBLISH=false.
                PackError::RestrictedUnscopedPackage | PackError::PrivatePackage => unreachable!(),
            }
        }
        Ok(())
    }

    pub fn exec(ctx: Command::Context<'_>) -> Result<(), bun_core::Error> {
        let cli =
            bun_install::package_manager::command_line_arguments::CommandLineArguments::parse(
                bun_install::Subcommand::Pack,
            )?;

        let silent = cli.silent;
        let (manager, original_cwd) =
            match PackageManager::init(&mut *ctx, cli, bun_install::Subcommand::Pack) {
                Ok(v) => v,
                Err(err) => {
                    if !silent {
                        if err == bun_core::err!("MissingPackageJSON") {
                            let mut cwd_buf = PathBuffer::uninit();
                            match bun_sys::getcwd_z(&mut cwd_buf) {
                                Ok(cwd) => {
                                    Output::err_generic(
                                        "failed to find project package.json from: \"{}\"",
                                        format_args!("{}", bstr::BStr::new(cwd.as_bytes())),
                                    );
                                }
                                Err(_) => {
                                    Output::err_generic(
                                        "failed to find project package.json",
                                        format_args!(""),
                                    );
                                }
                            }
                        } else {
                            Output::err_generic(
                                "failed to initialize bun install: {}",
                                format_args!("{}", err.name()),
                            );
                        }
                    }
                    Global::crash();
                }
            };
        drop(original_cwd);

        Self::exec_with_manager(ctx, manager)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PackError
// ───────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackError<const FOR_PUBLISH: bool> {
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
    #[error("MissingPackageJSON")]
    MissingPackageJSON,
    // The following two are only valid when FOR_PUBLISH == true.
    // TODO(port): Zig modeled this as a comptime-computed error set union; Rust
    // const-generic enums cannot conditionally include variants. Phase B may
    // split into two enums or gate construction.
    #[error("RestrictedUnscopedPackage")]
    RestrictedUnscopedPackage,
    #[error("PrivatePackage")]
    PrivatePackage,
}

impl<const FOR_PUBLISH: bool> From<AllocError> for PackError<FOR_PUBLISH> {
    fn from(_: AllocError) -> Self {
        PackError::OutOfMemory
    }
}

// ───────────────────────────────────────────────────────────────────────────
// constants & small types
// ───────────────────────────────────────────────────────────────────────────

const PACKAGE_PREFIX: &[u8] = b"package/";

const ROOT_DEFAULT_IGNORE_PATTERNS: &[&[u8]] = &[
    b"package-lock.json",
    b"yarn.lock",
    b"pnpm-lock.yaml",
    b"bun.lockb",
    b"bun.lock",
];

// (pattern, can_override)
const DEFAULT_IGNORE_PATTERNS: &[(&[u8], bool)] = &[
    (b".*.swp", true),
    (b"._*", true),
    (b".DS_Store", true),
    (b".git", false),
    (b".gitignore", true),
    (b".hg", false),
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
];

struct PackListEntry {
    subpath: ZBox, // owned NUL-terminated path (Zig `stringZ`)
    size: usize,
}
type PackList = Vec<PackListEntry>;

pub struct PackQueueItem {
    path: ZBox, // owned `[:0]const u8`; allocated via `entry_subpath`
    optional: bool,
}

impl Default for PackQueueItem {
    fn default() -> Self {
        Self {
            path: ZBox::from_bytes(b""),
            optional: false,
        }
    }
}

// `std.PriorityQueue(PackQueueItem, void, PackQueueContext.lessThan)` — min-heap by path.
// `bun_collections` has no `PriorityQueue`; wrap `BinaryHeap` with a reversed `Ord`
// (BinaryHeap is a max-heap, so invert `strings::order` to pop smallest first).
impl Ord for PackQueueItem {
    fn cmp(&self, other: &Self) -> core::cmp::Ordering {
        // reversed: smaller path == greater priority
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
pub struct PackQueue {
    heap: std::collections::BinaryHeap<PackQueueItem>,
}
impl PackQueue {
    pub fn add(&mut self, item: PackQueueItem) -> Result<(), AllocError> {
        self.heap.push(item);
        Ok(())
    }
    pub fn count(&self) -> usize {
        self.heap.len()
    }
    pub fn remove_or_null(&mut self) -> Option<PackQueueItem> {
        self.heap.pop()
    }
}

fn new_pack_queue() -> PackQueue {
    PackQueue::default()
}

/// (dir, dir_subpath, dir_depth)
struct DirInfo(Dir, Box<[u8]>, usize);
// TODO(port): Zig used `string` (borrowed) for the subpath; here owned because
// values are pushed onto a Vec stack and outlive the producing iteration.

// ───────────────────────────────────────────────────────────────────────────
// tree iteration (includes / excludes)
// ───────────────────────────────────────────────────────────────────────────

fn iterate_included_project_tree(
    pack_queue: &mut PackQueue,
    bins: &[BinInfo],
    includes: &[Pattern],
    excludes: &[Pattern],
    root_dir: Dir,
    log_level: LogLevel,
) -> Result<(), AllocError> {
    if cfg!(debug_assertions) {
        for exclude in excludes {
            debug_assert!(
                exclude.flags.contains(PatternFlags::NEGATED),
                "Illegal exclusion pattern '{}'. Exclusion patterns are always negated.",
                bstr::BStr::new(exclude.glob.slice()),
            );
        }
    }

    let mut ignores: Vec<IgnorePatterns> = Vec::new();
    let _ = &mut ignores; // unused in this fn body in Zig too (declared but not read)

    let mut dirs: Vec<DirInfo> = Vec::new();
    dirs.push(DirInfo(root_dir, Box::from(&b""[..]), 1));

    let mut included_dirs: Vec<DirInfo> = Vec::new();

    let mut subpath_dedupe: StringHashMap<()> = StringHashMap::new();

    // first find included dirs and files
    while let Some(dir_info) = dirs.pop() {
        let DirInfo(dir, dir_subpath, dir_depth) = dir_info;
        // Root (depth 1) is borrowed `Fd::cwd()`-ish; only close subdirs we opened.
        let close_guard = (dir_depth != 1).then(|| CloseOnDrop::dir(dir));

        let mut dir_iter = DirIterator::iterate(Fd::from_std_dir(&dir));
        'next_entry: while let Some(entry) = dir_iter.next().ok().flatten() {
            // PORT NOTE: `.unwrap() catch null` → on iterator error, treat as end
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            // `slice_u8()` is the platform-unifying accessor — on Windows the
            // iterator's native u16 name is transcoded once at construction so
            // pack-tree logic stays byte-based on every target.
            let entry_name = entry.name.slice_u8();
            let entry_subpath = entry_subpath(&dir_subpath, entry_name)?;

            let mut included = false;
            let mut is_unconditionally_included = false;

            if dir_depth == 1 {
                if entry_name == b"package.json" {
                    continue;
                }
                if entry_name == b"node_modules" {
                    continue;
                }

                if entry.kind == bun_sys::FileKind::File
                    && is_unconditionally_included_file(entry_name)
                {
                    included = true;
                    is_unconditionally_included = true;
                }
            }

            if !included {
                for include in includes {
                    if include.flags.contains(PatternFlags::DIRS_ONLY)
                        && entry.kind != bun_sys::FileKind::Directory
                    {
                        continue;
                    }

                    // include patterns are not recursive unless they start with `**/`
                    // normally the behavior of `index.js` and `**/index.js` are the same,
                    // but includes require `**/`
                    let match_path: &[u8] = if include
                        .flags
                        .contains(PatternFlags::LEADING_DOUBLESTAR_SLASH)
                    {
                        entry_name
                    } else {
                        entry_subpath.as_bytes()
                    };
                    match glob::r#match(include.glob.slice(), match_path) {
                        GlobMatchResult::Match => included = true,
                        GlobMatchResult::NegateNoMatch | GlobMatchResult::NegateMatch => {
                            unreachable!()
                        }
                        _ => {}
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

                    let match_path: &[u8] = if exclude
                        .flags
                        .contains(PatternFlags::LEADING_DOUBLESTAR_SLASH)
                    {
                        entry_name
                    } else {
                        entry_subpath.as_bytes()
                    };
                    // NOTE: These patterns have `!` so `.match` logic is
                    // inverted here
                    match glob::r#match(exclude.glob.slice(), match_path) {
                        GlobMatchResult::NegateNoMatch => included = false,
                        _ => {}
                    }
                }
            }

            // TODO: do not traverse directories that match patterns
            // excluding all files within them (e.g. `!test/**`)
            if !included {
                if entry.kind == bun_sys::FileKind::Directory {
                    for bin in bins {
                        if bin.ty == BinType::Dir
                            && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true)
                        {
                            continue 'next_entry;
                        }
                    }
                    let subdir = open_subdir(&dir, entry_name, &entry_subpath);
                    dirs.push(DirInfo(
                        subdir,
                        entry_subpath.as_bytes().into(),
                        dir_depth + 1,
                    ));
                }

                continue;
            }

            match entry.kind {
                bun_sys::FileKind::Directory => {
                    for bin in bins {
                        if bin.ty == BinType::Dir
                            && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true)
                        {
                            continue 'next_entry;
                        }
                    }
                    let subdir = open_subdir(&dir, entry_name, &entry_subpath);
                    included_dirs.push(DirInfo(
                        subdir,
                        entry_subpath.as_bytes().into(),
                        dir_depth + 1,
                    ));
                }
                bun_sys::FileKind::File => {
                    let dedupe_entry = subpath_dedupe.get_or_put(entry_subpath.as_bytes())?;
                    debug_assert!(!dedupe_entry.found_existing);
                    if dedupe_entry.found_existing {
                        continue;
                    }

                    for bin in bins {
                        if bin.ty == BinType::File
                            && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true)
                        {
                            continue 'next_entry;
                        }
                    }

                    pack_queue.add(PackQueueItem {
                        path: entry_subpath,
                        optional: false,
                    })?;
                }
                _ => unreachable!(),
            }
        }

        drop(close_guard);
    }

    // for each included dir, traverse its entries, exclude any with `negate_no_match`.
    for included_dir_info in included_dirs {
        add_entire_tree(
            bins,
            excludes,
            included_dir_info,
            pack_queue,
            &mut subpath_dedupe,
            log_level,
        )?;
    }

    Ok(())
}

/// Adds all files in a directory tree to `pack_list` (default ignores still apply)
fn add_entire_tree(
    bins: &[BinInfo],
    excludes: &[Pattern],
    root_dir_info: DirInfo,
    pack_queue: &mut PackQueue,
    dedupe: &mut StringHashMap<()>,
    log_level: LogLevel,
) -> Result<(), AllocError> {
    let root_depth = root_dir_info.2;

    let mut dirs: Vec<DirInfo> = Vec::new();
    dirs.push(root_dir_info);

    let mut ignores: Vec<IgnorePatterns> = Vec::new();

    let mut negated_excludes: Vec<Pattern> = Vec::new();

    if !excludes.is_empty() {
        negated_excludes.reserve_exact(excludes.len());
        for exclude in excludes {
            negated_excludes.push(exclude.as_positive());
        }
        ignores.push(IgnorePatterns {
            list: negated_excludes.into_boxed_slice(),
            // PORT NOTE: Zig stored a borrowed slice into `negated_excludes`;
            // moved here since it isn't reused below.
            kind: IgnorePatternsKind::PackageJson,
            depth: 1,
            // always assume no relative path b/c matching is done from the
            // root directory
            has_rel_path: false,
        });
    }

    while let Some(dir_info) = dirs.pop() {
        let DirInfo(dir, dir_subpath, dir_depth) = dir_info;
        let _close = CloseOnDrop::dir(dir);

        while let Some(last) = ignores.last() {
            if last.depth < dir_depth {
                break;
            }
            // last.deinit() handled by Drop
            ignores.pop();
        }

        if let Some(patterns) = IgnorePatterns::read_from_disk(&dir, dir_depth)? {
            ignores.push(patterns);
        }

        if cfg!(debug_assertions) {
            // make sure depths are in order
            if !ignores.is_empty() {
                for i in 1..ignores.len() {
                    debug_assert!(ignores[i - 1].depth < ignores[i].depth);
                }
            }
        }

        let mut iter = DirIterator::iterate(Fd::from_std_dir(&dir));
        'next_entry: while let Some(entry) = iter.next().ok().flatten() {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            // `slice_u8()` is the platform-unifying accessor — on Windows the
            // iterator's native u16 name is transcoded once at construction so
            // pack-tree logic stays byte-based on every target.
            let entry_name = entry.name.slice_u8();
            let entry_subpath = entry_subpath(&dir_subpath, entry_name)?;

            if dir_depth == root_depth {
                if entry.kind == bun_sys::FileKind::Directory && entry_name == b"node_modules" {
                    continue;
                }
            }

            if let Some((pattern, kind)) = is_excluded(&entry, &entry_subpath, dir_depth, &ignores)
            {
                if log_level.is_verbose() {
                    Output::prettyln(format_args!(
                        "<r><blue>ignore<r> <d>[{}:{}]<r> {}{}",
                        <&str>::from(kind),
                        bstr::BStr::new(pattern),
                        bstr::BStr::new(entry_subpath.as_bytes()),
                        if entry.kind == bun_sys::FileKind::Directory {
                            "/"
                        } else {
                            ""
                        },
                    ));
                    Output::flush();
                }
                continue;
            }

            match entry.kind {
                bun_sys::FileKind::File => {
                    let dedupe_entry = dedupe.get_or_put(entry_subpath.as_bytes())?;
                    if dedupe_entry.found_existing {
                        continue;
                    }
                    for bin in bins {
                        if bin.ty == BinType::File
                            && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true)
                        {
                            continue 'next_entry;
                        }
                    }
                    pack_queue.add(PackQueueItem {
                        path: entry_subpath,
                        optional: false,
                    })?;
                }
                bun_sys::FileKind::Directory => {
                    for bin in bins {
                        if bin.ty == BinType::Dir
                            && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true)
                        {
                            continue 'next_entry;
                        }
                    }

                    let subdir = open_subdir(&dir, entry_name, &entry_subpath);

                    dirs.push(DirInfo(
                        subdir,
                        entry_subpath.as_bytes().into(),
                        dir_depth + 1,
                    ));
                }
                _ => unreachable!(),
            }
        }
    }

    Ok(())
}

fn open_subdir(dir: &Dir, entry_name: &[u8], entry_subpath: &ZStr) -> Dir {
    match dir_open_dir_z(
        dir,
        entry_name_z(entry_name, entry_subpath),
        bun_sys::OpenDirOptions {
            iterate: true,
            ..Default::default()
        },
    ) {
        Ok(d) => d,
        Err(err) => {
            Output::err(
                err,
                "failed to open directory \"{}\" for packing",
                format_args!("{}", bstr::BStr::new(entry_subpath.as_bytes())),
            );
            Global::crash();
        }
    }
}

fn entry_subpath(dir_subpath: &[u8], entry_name: &[u8]) -> Result<ZBox, AllocError> {
    // std.fmt.allocPrintSentinel(allocator, "{s}{s}{s}", ..., 0)
    let sep: &[u8] = if dir_subpath.is_empty() { b"" } else { b"/" };
    let mut buf = Vec::with_capacity(dir_subpath.len() + sep.len() + entry_name.len() + 1);
    buf.extend_from_slice(dir_subpath);
    buf.extend_from_slice(sep);
    buf.extend_from_slice(entry_name);
    buf.push(0);
    Ok(ZBox::from_vec_with_nul(buf))
}

fn entry_name_z<'a>(entry_name: &[u8], entry_subpath: &'a ZStr) -> &'a ZStr {
    // doing this because `entry_subpath` has a sentinel and we don't trust `entry.name.sliceAssumeZ()`
    let with_nul = entry_subpath.as_bytes_with_nul();
    let start = with_nul.len() - 1 - entry_name.len();
    // The suffix `with_nul[start..]` is `entry_name.len()` bytes followed by the
    // shared trailing NUL.
    ZStr::from_buf(&with_nul[start..], entry_name.len())
}

// ───────────────────────────────────────────────────────────────────────────
// bundled deps
// ───────────────────────────────────────────────────────────────────────────

fn iterate_bundled_deps(
    ctx: &mut Context<'_>,
    root_dir: &Dir,
    log_level: LogLevel,
) -> Result<PackQueue, AllocError> {
    let mut bundled_pack_queue = new_pack_queue();
    if ctx.bundled_deps.is_empty() {
        return Ok(bundled_pack_queue);
    }

    let mut dir: Dir = match dir_open_dir_z(
        root_dir,
        ZStr::from_static(b"node_modules\0"),
        bun_sys::OpenDirOptions {
            iterate: true,
            ..Default::default()
        },
    ) {
        Ok(d) => d,
        Err(err) => {
            // ignore node_modules if it isn't a directory, or doesn't exist
            if err == bun_core::err!("ENOTDIR") || err == bun_core::err!("ENOENT") {
                return Ok(bundled_pack_queue);
            }
            Output::err(
                err,
                "failed to open \"node_modules\" to pack bundled dependencies",
                (),
            );
            Global::crash();
        }
    };
    let _close = CloseOnDrop::dir(dir);

    // A set of bundled dependency locations
    // - node_modules/is-even
    // - node_modules/is-even/node_modules/is-odd
    // - node_modules/is-odd
    // - ...
    let mut dedupe: StringHashMap<()> = StringHashMap::new();

    let mut additional_bundled_deps: Vec<DirInfo> = Vec::new();

    let mut iter = DirIterator::iterate(Fd::from_std_dir(&dir));
    while let Some(entry) = iter.next().ok().flatten() {
        if entry.kind != bun_sys::FileKind::Directory {
            continue;
        }

        let _entry_name = entry.name.slice_u8();

        if strings::starts_with_char(_entry_name, b'@') {
            let concat = entry_subpath(b"node_modules", _entry_name)?;

            let mut scoped_dir: Dir = match dir_open_dir_z(
                root_dir,
                &concat,
                bun_sys::OpenDirOptions {
                    iterate: true,
                    ..Default::default()
                },
            ) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let _close_scoped = CloseOnDrop::dir(scoped_dir);

            let mut scoped_iter = DirIterator::iterate(Fd::from_std_dir(&scoped_dir));
            while let Some(sub_entry) = scoped_iter.next().ok().flatten() {
                let entry_name = entry_subpath(_entry_name, sub_entry.name.slice_u8())?;

                // PORT NOTE: reshaped for borrowck — Zig iterates `*dep` and
                // calls `add_bundled_dep(ctx, ...)` mid-loop; in Rust we find
                // the matching index first, mark it, then call with `&mut ctx`.
                let Some(dep_idx) = ctx.bundled_deps.iter().position(|dep| {
                    debug_assert!(dep.from_root_package_json);
                    strings::eql_long(entry_name.as_bytes(), &dep.name, true)
                }) else {
                    continue;
                };

                let entry_subpath_ = entry_subpath(b"node_modules", entry_name.as_bytes())?;

                let dedupe_entry = dedupe.get_or_put(entry_subpath_.as_bytes())?;
                ctx.bundled_deps[dep_idx].was_packed = true;
                if dedupe_entry.found_existing {
                    // already got to it in `add_bundled_dep` below
                    continue;
                }

                let subdir = open_subdir(&dir, entry_name.as_bytes(), &entry_subpath_);
                add_bundled_dep(
                    ctx,
                    root_dir,
                    DirInfo(subdir, entry_subpath_.as_bytes().into(), 2),
                    &mut bundled_pack_queue,
                    &mut dedupe,
                    &mut additional_bundled_deps,
                    log_level,
                )?;
            }
        } else {
            let entry_name = _entry_name;
            // PORT NOTE: reshaped for borrowck — see comment in scoped branch.
            let Some(dep_idx) = ctx.bundled_deps.iter().position(|dep| {
                debug_assert!(dep.from_root_package_json);
                strings::eql_long(entry_name, &dep.name, true)
            }) else {
                continue;
            };

            let entry_subpath_ = entry_subpath(b"node_modules", entry_name)?;

            let dedupe_entry = dedupe.get_or_put(entry_subpath_.as_bytes())?;
            ctx.bundled_deps[dep_idx].was_packed = true;
            if dedupe_entry.found_existing {
                // already got to it in `add_bundled_dep` below
                continue;
            }

            let subdir = open_subdir(&dir, entry_name, &entry_subpath_);
            add_bundled_dep(
                ctx,
                root_dir,
                DirInfo(subdir, entry_subpath_.as_bytes().into(), 2),
                &mut bundled_pack_queue,
                &mut dedupe,
                &mut additional_bundled_deps,
                log_level,
            )?;
        }
    }

    while let Some(bundled_dir_info) = additional_bundled_deps.pop() {
        let dir_subpath = &bundled_dir_info.1;
        let maybe_slash = strings::last_index_of_char(dir_subpath, b'/');
        debug_assert!(maybe_slash.is_some());
        let dep_name: &[u8] = if let Some(slash) = maybe_slash {
            &dir_subpath[slash + 1..]
        } else {
            dir_subpath
        };

        ctx.bundled_deps.push(BundledDep {
            name: Box::from(dep_name),
            from_root_package_json: false,
            was_packed: true,
        });

        add_bundled_dep(
            ctx,
            root_dir,
            bundled_dir_info,
            &mut bundled_pack_queue,
            &mut dedupe,
            &mut additional_bundled_deps,
            log_level,
        )?;
    }

    Ok(bundled_pack_queue)
}

fn add_bundled_dep(
    ctx: &mut Context<'_>,
    root_dir: &Dir,
    bundled_dir_info: DirInfo,
    bundled_pack_queue: &mut PackQueue,
    dedupe: &mut StringHashMap<()>,
    additional_bundled_deps: &mut Vec<DirInfo>,
    log_level: LogLevel,
) -> Result<(), AllocError> {
    ctx.stats.bundled_deps += 1;

    let bundled_root_depth = bundled_dir_info.2;

    let mut dirs: Vec<DirInfo> = Vec::new();
    dirs.push(bundled_dir_info);

    while let Some(dir_info) = dirs.pop() {
        let DirInfo(dir, dir_subpath, dir_depth) = dir_info;
        let _close = CloseOnDrop::dir(dir);

        let mut iter = DirIterator::iterate(Fd::from_std_dir(&dir));
        while let Some(entry) = iter.next().ok().flatten() {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice_u8();
            let entry_subpath_ = entry_subpath(&dir_subpath, entry_name)?;

            if dir_depth == bundled_root_depth {
                'root_depth: {
                    if entry_name == b"package.json" {
                        if entry.kind != bun_sys::FileKind::File {
                            break 'root_depth;
                        }
                        // find more dependencies to bundle
                        let source = match file_to_source_at(
                            &dir,
                            entry_name_z(entry_name, &entry_subpath_),
                        ) {
                            Ok(s) => s,
                            Err(err) => {
                                Output::err(
                                    err,
                                    "failed to read package.json: \"{}\"",
                                    format_args!("{}", bstr::BStr::new(entry_subpath_.as_bytes())),
                                );
                                Global::crash();
                            }
                        };

                        let json = match JSON::parse_package_json_utf8(
                            &source,
                            pm_log(ctx.manager),
                            pack_bump(),
                        ) {
                            Ok(j) => j,
                            Err(_) => break 'root_depth,
                        };

                        // for each dependency in `dependencies` find the closest node_modules folder
                        // with the dependency name as a dir entry, starting from the node_modules of the
                        // current bundled dependency

                        for dependency_group in [
                            b"dependencies".as_slice(),
                            b"optionalDependencies".as_slice(),
                        ] {
                            let Some(dependencies_expr) = json.get(dependency_group) else {
                                continue;
                            };
                            let bun_ast::ExprData::EObject(dependencies) = dependencies_expr.data
                            else {
                                continue;
                            };
                            // PORT NOTE: `json` here is `bun_ast::Expr`, not the parser AST.

                            'next_dep: for dep in dependencies.properties.slice() {
                                if dep.key.is_none() {
                                    continue;
                                }
                                if dep.value.is_none() {
                                    continue;
                                }

                                let Some(dep_name) = dep
                                    .key
                                    .as_ref()
                                    .expect("infallible: prop has key")
                                    .as_utf8_string_literal()
                                else {
                                    continue;
                                };

                                // allocPrintSentinel(.., "{s}/node_modules/{s}", ..)
                                let mut dep_subpath_buf: Vec<u8> = Vec::with_capacity(
                                    dir_subpath.len() + "/node_modules/".len() + dep_name.len() + 1,
                                );
                                dep_subpath_buf.extend_from_slice(&dir_subpath);
                                dep_subpath_buf.extend_from_slice(b"/node_modules/");
                                dep_subpath_buf.extend_from_slice(dep_name);
                                dep_subpath_buf.push(0);
                                // SAFETY: trailing NUL written above
                                let dep_subpath: &mut ZStr = unsafe {
                                    ZStr::from_raw_mut(
                                        dep_subpath_buf.as_mut_ptr(),
                                        dep_subpath_buf.len() - 1,
                                    )
                                };

                                // starting at `node_modules/is-even/node_modules/is-odd`
                                let mut dep_dir_depth: usize = bundled_root_depth + 2;

                                match dir_open_dir_z(
                                    root_dir,
                                    dep_subpath,
                                    bun_sys::OpenDirOptions {
                                        iterate: true,
                                        ..Default::default()
                                    },
                                ) {
                                    Ok(dep_dir) => {
                                        let dedupe_entry =
                                            dedupe.get_or_put(dep_subpath.as_bytes())?;
                                        if dedupe_entry.found_existing {
                                            continue;
                                        }

                                        additional_bundled_deps.push(DirInfo(
                                            dep_dir,
                                            dep_subpath.as_bytes().into(),
                                            dep_dir_depth,
                                        ));
                                    }
                                    Err(_) => {
                                        // keep searching

                                        // slice off the `node_modules` from above
                                        let mut remain_end = dir_subpath.len();

                                        while let Some(node_modules_start) = strings::last_index_of(
                                            &dep_subpath_buf[..remain_end],
                                            b"node_modules",
                                        ) {
                                            dep_dir_depth -= 2;
                                            let node_modules_end =
                                                node_modules_start + b"node_modules".len();
                                            dep_subpath_buf[node_modules_end] = b'/';
                                            dep_subpath_buf[node_modules_end + 1..]
                                                [..dep_name.len()]
                                                .copy_from_slice(dep_name);
                                            dep_subpath_buf
                                                [node_modules_end + 1 + dep_name.len()] = 0;
                                            let parent_len = node_modules_end + 1 + dep_name.len();
                                            // SAFETY: NUL at parent_len written above
                                            let parent_dep_subpath: &ZStr =
                                                ZStr::from_buf(&dep_subpath_buf[..], parent_len);
                                            remain_end = node_modules_start;

                                            let parent_dep_dir = match dir_open_dir_z(
                                                root_dir,
                                                parent_dep_subpath,
                                                bun_sys::OpenDirOptions {
                                                    iterate: true,
                                                    ..Default::default()
                                                },
                                            ) {
                                                Ok(d) => d,
                                                Err(_) => continue,
                                            };

                                            let dedupe_entry =
                                                dedupe.get_or_put(parent_dep_subpath.as_bytes())?;
                                            if dedupe_entry.found_existing {
                                                continue 'next_dep;
                                            }

                                            additional_bundled_deps.push(DirInfo(
                                                parent_dep_dir,
                                                parent_dep_subpath.as_bytes().into(),
                                                dep_dir_depth,
                                            ));
                                            continue 'next_dep;
                                        }
                                    }
                                }
                            }
                        }

                        break 'root_depth;
                    }

                    if entry_name == b"node_modules" {
                        // handled by labeled-block fallthrough in Zig: `continue` outer loop
                        // (see below)
                    }
                }
                if entry_name == b"node_modules" {
                    continue;
                }
            }

            if let Some((pattern, kind)) = is_excluded(&entry, &entry_subpath_, dir_depth, &[]) {
                if log_level.is_verbose() {
                    Output::prettyln(format_args!(
                        "<r><blue>ignore<r> <d>[{}:{}]<r> {}{}",
                        <&str>::from(kind),
                        bstr::BStr::new(pattern),
                        bstr::BStr::new(entry_subpath_.as_bytes()),
                        if entry.kind == bun_sys::FileKind::Directory {
                            "/"
                        } else {
                            ""
                        },
                    ));
                    Output::flush();
                }
                continue;
            }

            match entry.kind {
                bun_sys::FileKind::File => {
                    bundled_pack_queue.add(PackQueueItem {
                        path: entry_subpath_,
                        optional: false,
                    })?;
                }
                bun_sys::FileKind::Directory => {
                    let subdir = open_subdir(&dir, entry_name, &entry_subpath_);

                    dirs.push(DirInfo(
                        subdir,
                        entry_subpath_.as_bytes().into(),
                        dir_depth + 1,
                    ));
                }
                _ => unreachable!(),
            }
        }
    }

    Ok(())
}

/// Returns a list of files to pack and another list of files from bundled dependencies
fn iterate_project_tree(
    pack_queue: &mut PackQueue,
    bins: &[BinInfo],
    root_dir: DirInfo,
    log_level: LogLevel,
) -> Result<(), AllocError> {
    let mut ignores: Vec<IgnorePatterns> = Vec::new();

    // Stacks and depth-first traversal. Doing so means we can push and pop from
    // ignore patterns without needing to clone the entire list for future use.
    let mut dirs: Vec<DirInfo> = Vec::new();
    dirs.push(root_dir);

    while let Some(dir_info) = dirs.pop() {
        let DirInfo(dir, dir_subpath, dir_depth) = dir_info;
        // Root (depth 1) is caller-owned; only close subdirs we opened.
        let _close = (dir_depth != 1).then(|| CloseOnDrop::dir(dir));

        while let Some(last) = ignores.last() {
            if last.depth < dir_depth {
                break;
            }
            // pop patterns from files greater than or equal to the current depth.
            ignores.pop();
        }

        if let Some(patterns) = IgnorePatterns::read_from_disk(&dir, dir_depth)? {
            ignores.push(patterns);
        }

        if cfg!(debug_assertions) {
            // make sure depths are in order
            if !ignores.is_empty() {
                for i in 1..ignores.len() {
                    debug_assert!(ignores[i - 1].depth < ignores[i].depth);
                }
            }
        }

        let mut dir_iter = DirIterator::iterate(Fd::from_std_dir(&dir));
        'next_entry: while let Some(entry) = dir_iter.next().ok().flatten() {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice_u8();
            let entry_subpath_ = entry_subpath(&dir_subpath, entry_name)?;

            if dir_depth == 1 {
                // Special case root package.json. It is always included
                // and is possibly edited, so it's easier to handle it
                // separately
                if entry_name == b"package.json" {
                    continue;
                }

                // bundled dependencies are included only if they exist on disk.
                // handled later for simplicity
                if entry_name == b"node_modules" {
                    continue;
                }
            }

            if let Some((pattern, kind)) = is_excluded(&entry, &entry_subpath_, dir_depth, &ignores)
            {
                if log_level.is_verbose() {
                    Output::prettyln(format_args!(
                        "<r><blue>ignore<r> <d>[{}:{}]<r> {}{}",
                        <&str>::from(kind),
                        bstr::BStr::new(pattern),
                        bstr::BStr::new(entry_subpath_.as_bytes()),
                        if entry.kind == bun_sys::FileKind::Directory {
                            "/"
                        } else {
                            ""
                        },
                    ));
                    Output::flush();
                }
                continue;
            }

            match entry.kind {
                bun_sys::FileKind::File => {
                    debug_assert!(!entry_subpath_.as_bytes().is_empty());
                    for bin in bins {
                        if bin.ty == BinType::File
                            && strings::eql_long(&bin.path, entry_subpath_.as_bytes(), true)
                        {
                            continue 'next_entry;
                        }
                    }
                    pack_queue.add(PackQueueItem {
                        path: entry_subpath_,
                        optional: false,
                    })?;
                }
                bun_sys::FileKind::Directory => {
                    for bin in bins {
                        if bin.ty == BinType::Dir
                            && strings::eql_long(&bin.path, entry_subpath_.as_bytes(), true)
                        {
                            continue 'next_entry;
                        }
                    }

                    let subdir = open_subdir(&dir, entry_name, &entry_subpath_);

                    dirs.push(DirInfo(
                        subdir,
                        entry_subpath_.as_bytes().into(),
                        dir_depth + 1,
                    ));
                }
                _ => unreachable!(),
            }
        }
    }

    Ok(())
}

fn get_bundled_deps(
    json: &Expr,
    field: &'static str,
) -> Result<Option<Vec<BundledDep>>, AllocError> {
    let mut deps: Vec<BundledDep> = Vec::new();
    let Some(bundled_deps) = json.get(field.as_bytes()) else {
        return Ok(None);
    };

    'invalid_field: {
        match &bundled_deps.data {
            ExprData::EArray(_) => {
                let Some(mut iter) = bundled_deps.as_array() else {
                    return Ok(Some(Vec::new()));
                };

                while let Some(bundled_dep_item) = iter.next() {
                    let Some(bundled_dep) = bundled_dep_item.as_string_cloned(pack_bump())? else {
                        break 'invalid_field;
                    };
                    deps.push(BundledDep {
                        name: bundled_dep.into(),
                        was_packed: false,
                        from_root_package_json: true,
                    });
                }
            }
            ExprData::EBoolean(_) => {
                let Some(b) = bundled_deps.as_bool() else {
                    return Ok(Some(Vec::new()));
                };
                if !b == true {
                    return Ok(Some(Vec::new()));
                }

                if let Some(dependencies_expr) = json.get(b"dependencies") {
                    if let ExprData::EObject(dependencies) = &dependencies_expr.data {
                        for dependency in dependencies.properties.slice() {
                            if dependency.key.is_none() {
                                continue;
                            }
                            if dependency.value.is_none() {
                                continue;
                            }

                            let Some(bundled_dep) = dependency
                                .key
                                .as_ref()
                                .expect("infallible: prop has key")
                                .as_string_cloned(pack_bump())?
                            else {
                                break 'invalid_field;
                            };
                            deps.push(BundledDep {
                                name: bundled_dep.into(),
                                was_packed: false,
                                from_root_package_json: true,
                            });
                        }
                    }
                }
            }
            _ => break 'invalid_field,
        }

        return Ok(Some(deps));
    }

    Output::err_generic(
        "expected `{}` to be a boolean or an array of strings",
        format_args!("{}", field),
    );
    Global::crash();
}

// ───────────────────────────────────────────────────────────────────────────
// bins
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum BinType {
    File,
    Dir,
}

struct BinInfo {
    path: ZBox,
    ty: BinType,
}

fn get_package_bins(json: &Expr) -> Result<Vec<BinInfo>, AllocError> {
    let mut bins: Vec<BinInfo> = Vec::new();

    let mut path_buf = PathBuffer::uninit();

    if let Some(bin) = json.as_property(b"bin") {
        if let Some(bin_str) = bin.expr.as_string(pack_bump()) {
            let normalized = resolve_path::normalize_buf::<resolve_path::platform::Posix>(
                bin_str,
                &mut path_buf,
            );
            if !bin_path_escapes_root(normalized) {
                bins.push(BinInfo {
                    path: ZBox::from_bytes(normalized),
                    ty: BinType::File,
                });
            }
            return Ok(bins);
        }

        if let ExprData::EObject(bin_obj) = &bin.expr.data {
            if bin_obj.properties.len_u32() == 0 {
                return Ok(Vec::new());
            }

            for bin_prop in bin_obj.properties.slice() {
                if let Some(bin_prop_value) = &bin_prop.value {
                    if let Some(bin_str) = bin_prop_value.as_string(pack_bump()) {
                        let normalized = resolve_path::normalize_buf::<resolve_path::platform::Posix>(
                            bin_str,
                            &mut path_buf,
                        );
                        if !bin_path_escapes_root(normalized) {
                            bins.push(BinInfo {
                                path: ZBox::from_bytes(normalized),
                                ty: BinType::File,
                            });
                        }
                    }
                }
            }
        }

        return Ok(bins);
    }

    if let Some(directories) = json.as_property(b"directories") {
        if let ExprData::EObject(directories_obj) = &directories.expr.data {
            if let Some(bin) = directories_obj.as_property(b"bin") {
                if let Some(bin_str) = bin.expr.as_string(pack_bump()) {
                    let normalized = resolve_path::normalize_buf::<resolve_path::platform::Posix>(
                        bin_str,
                        &mut path_buf,
                    );
                    if !bin_path_escapes_root(normalized) {
                        bins.push(BinInfo {
                            path: ZBox::from_bytes(normalized),
                            ty: BinType::Dir,
                        });
                    }
                }
            }
        }
    }

    Ok(bins)
}

fn bin_path_escapes_root(p: &[u8]) -> bool {
    path::is_absolute_loose(p) || p == b".." || p.starts_with(b"../")
}

fn is_package_bin(bins: &[BinInfo], maybe_bin_path: &[u8]) -> bool {
    for bin in bins {
        match bin.ty {
            BinType::File => {
                if strings::eql_long(bin.path.as_bytes(), maybe_bin_path, true) {
                    return true;
                }
            }
            BinType::Dir => {
                let bin_without_trailing = strings::without_trailing_slash(bin.path.as_bytes());
                if maybe_bin_path.starts_with(bin_without_trailing) {
                    let remain = &maybe_bin_path[bin_without_trailing.len()..];
                    if remain.len() > 1
                        && remain[0] == b'/'
                        && strings::index_of_char(&remain[1..], b'/').is_none()
                    {
                        return true;
                    }
                }
            }
        }
    }

    false
}

fn is_excluded<'a>(
    entry: &DirIterator::IteratorResult,
    entry_subpath: &'a ZStr,
    dir_depth: usize,
    ignores: &'a [IgnorePatterns],
) -> Option<(&'a [u8], IgnorePatternsKind)> {
    let entry_name = entry.name.slice_u8();

    if dir_depth == 1 {
        // first, check files that can never be ignored. project root
        // directory only
        if is_unconditionally_included_file(entry_name)
            || is_special_file_or_variant(entry_name, b"CHANGELOG")
        {
            return None;
        }

        // check default ignores that only apply to the root project directory
        for &pattern in ROOT_DEFAULT_IGNORE_PATTERNS {
            match glob::r#match(pattern, entry_name) {
                GlobMatchResult::Match => {
                    // cannot be reversed
                    return Some((pattern, IgnorePatternsKind::Default));
                }
                GlobMatchResult::NoMatch => {}
                // default patterns don't use `!`
                GlobMatchResult::NegateNoMatch | GlobMatchResult::NegateMatch => unreachable!(),
            }
        }
    }

    let mut ignore_pattern: &[u8] = &[];
    let mut ignore_kind: IgnorePatternsKind = IgnorePatternsKind::Npmignore;

    // then check default ignore list. None of the defaults contain slashes
    // so just match against entry name
    let mut ignored = false;

    for &(pattern, can_override) in DEFAULT_IGNORE_PATTERNS {
        match glob::r#match(pattern, entry_name) {
            GlobMatchResult::Match => {
                if can_override {
                    ignored = true;
                    ignore_pattern = pattern;
                    ignore_kind = IgnorePatternsKind::Default;

                    // break. doesn't matter if more default patterns
                    // match this path
                    break;
                }

                return Some((pattern, IgnorePatternsKind::Default));
            }
            GlobMatchResult::NoMatch => {}
            // default patterns don't use `!`
            GlobMatchResult::NegateNoMatch | GlobMatchResult::NegateMatch => unreachable!(),
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
            match glob::r#match(pattern.glob.slice(), match_path) {
                GlobMatchResult::Match => {
                    ignored = true;
                    ignore_pattern = pattern.glob.slice();
                    ignore_kind = ignore.kind;
                }
                GlobMatchResult::NegateNoMatch => ignored = false,
                _ => {}
            }
        }
    }

    if !ignored {
        None
    } else {
        Some((ignore_pattern, ignore_kind))
    }
}

// `bun.deprecated.BufferedReader(1024 * 512, File.Reader)`
type BufferedFileReader = bun_core::deprecated::BufferedReader<{ 1024 * 512 }, bun_sys::File>;

// ───────────────────────────────────────────────────────────────────────────
// Local shims / extension traits for upstream API gaps (Phase D)
// ───────────────────────────────────────────────────────────────────────────

use bun_libarchive::lib::Result as ArchiveResult;
use bun_sys::FdDirExt as _;

/// `Expr::as_string`/`as_string_cloned` now require a `&Bump`; package.json
/// JSON strings are always UTF-8 literals, so route through
/// `as_utf8_string_literal` until an arena is threaded through.
#[allow(dead_code)]
trait PackExprExt {
    fn pack_as_string(&self) -> Option<&[u8]>;
    fn pack_as_string_cloned(&self) -> Result<Option<Box<[u8]>>, AllocError>;
}
impl PackExprExt for Expr {
    #[inline]
    fn pack_as_string(&self) -> Option<&[u8]> {
        self.as_utf8_string_literal()
    }
    #[inline]
    fn pack_as_string_cloned(&self) -> Result<Option<Box<[u8]>>, AllocError> {
        Ok(self.as_utf8_string_literal().map(Box::from))
    }
}

/// NUL-terminated literal → `&'static ZStr` (replacement for missing
/// `ZStr::from_lit`).
#[inline]
const fn zstr_lit(s: &'static [u8]) -> &'static ZStr {
    // `from_static` is the const-eval-safe form of `from_slice_with_nul`.
    ZStr::from_static(s)
}

/// Extension trait wrapping `*mut Archive` so existing `archive.method()` call
/// sites compile without per-call `unsafe { &* }`.
trait ArchivePtrExt {
    fn write_set_format_pax_restricted(self) -> ArchiveResult;
    fn write_add_filter_gzip(self) -> ArchiveResult;
    fn write_set_filter_option(
        self,
        module: Option<&ZStr>,
        key: &ZStr,
        value: &ZStr,
    ) -> ArchiveResult;
    fn write_set_options(self, opts: &ZStr) -> ArchiveResult;
    fn write_open_filename(self, path: &ZStr) -> ArchiveResult;
    fn write_close(self) -> ArchiveResult;
    fn write_free(self) -> ArchiveResult;
    fn error_string(self) -> &'static [u8];
    fn read_support_format_tar(self) -> ArchiveResult;
    fn read_support_format_gnutar(self) -> ArchiveResult;
    fn read_support_filter_gzip(self) -> ArchiveResult;
    fn read_set_options(self, opts: &core::ffi::CStr) -> ArchiveResult;
    fn read_open_memory(self, buf: &[u8]) -> ArchiveResult;
    fn read_next_header(self, entry: &mut *mut ArchiveEntry) -> ArchiveResult;
    fn read_data(self, buf: &mut [u8]) -> isize;
    fn read_close(self) -> ArchiveResult;
    fn read_free(self) -> ArchiveResult;
}
impl ArchivePtrExt for *mut Archive {
    #[inline]
    fn write_set_format_pax_restricted(self) -> ArchiveResult {
        Archive::opaque_ref(self).write_set_format_pax_restricted()
    }
    #[inline]
    fn write_add_filter_gzip(self) -> ArchiveResult {
        Archive::opaque_ref(self).write_add_filter_gzip()
    }
    #[inline]
    fn write_set_filter_option(
        self,
        module: Option<&ZStr>,
        key: &ZStr,
        value: &ZStr,
    ) -> ArchiveResult {
        Archive::opaque_ref(self).write_set_filter_option(module, key, value)
    }
    #[inline]
    fn write_set_options(self, opts: &ZStr) -> ArchiveResult {
        Archive::opaque_ref(self).write_set_options(opts)
    }
    #[inline]
    fn write_open_filename(self, path: &ZStr) -> ArchiveResult {
        Archive::opaque_ref(self).write_open_filename(path)
    }
    #[inline]
    fn write_close(self) -> ArchiveResult {
        Archive::opaque_ref(self).write_close()
    }
    #[inline]
    fn write_free(self) -> ArchiveResult {
        Archive::opaque_ref(self).write_free()
    }
    #[inline]
    fn error_string(self) -> &'static [u8] {
        Archive::error_string(self)
    }
    #[inline]
    fn read_support_format_tar(self) -> ArchiveResult {
        Archive::opaque_ref(self).read_support_format_tar()
    }
    #[inline]
    fn read_support_format_gnutar(self) -> ArchiveResult {
        Archive::opaque_ref(self).read_support_format_gnutar()
    }
    #[inline]
    fn read_support_filter_gzip(self) -> ArchiveResult {
        Archive::opaque_ref(self).read_support_filter_gzip()
    }
    #[inline]
    fn read_set_options(self, opts: &core::ffi::CStr) -> ArchiveResult {
        Archive::opaque_ref(self).read_set_options(opts)
    }
    #[inline]
    fn read_open_memory(self, buf: &[u8]) -> ArchiveResult {
        Archive::opaque_ref(self).read_open_memory(buf)
    }
    #[inline]
    fn read_next_header(self, entry: &mut *mut ArchiveEntry) -> ArchiveResult {
        Archive::opaque_ref(self).read_next_header(entry)
    }
    #[inline]
    fn read_data(self, buf: &mut [u8]) -> isize {
        Archive::opaque_ref(self).read_data(buf)
    }
    #[inline]
    fn read_close(self) -> ArchiveResult {
        Archive::opaque_ref(self).read_close()
    }
    #[inline]
    fn read_free(self) -> ArchiveResult {
        Archive::opaque_ref(self).read_free()
    }
}

/// Local `@tagName` for `bun_core::FileKind` (Zig `std.fs.File.Kind` tag names).
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

/// Heap-allocate a 512 KiB `BufferedFileReader` without materializing it on
/// the stack. Zig: `allocator.create(BufferedFileReader)` then field-init with
/// `.buf = undefined`. `Box::new_zeroed` maps to a `calloc` (typically a free
/// kernel zero-page for this size) and avoids the 512 KiB stack temporary.
fn new_boxed_buffered_file_reader(file: bun_sys::File) -> Box<BufferedFileReader> {
    // SAFETY: all-zero is a valid bit pattern for `[u8; N]`, `usize`, and
    // `File { handle: Fd }` (`Fd` is a `#[repr(C)]` integer newtype). The
    // `unbuffered_reader` slot is overwritten before any read. (Orphan rule
    // blocks an `unsafe impl Zeroable` here — both trait and generic are
    // foreign — so use the unchecked variant.)
    let mut b: Box<BufferedFileReader> = unsafe { bun_core::boxed_zeroed_unchecked() };
    b.unbuffered_reader = file;
    b
}

/// Re-seat the underlying file and reset the buffer cursor in place — avoids
/// the 512 KiB stack temporary that `*file_reader = BufferedFileReader { ... }`
/// would create. Zig: `file_reader.* = .{ .unbuffered_reader = ..., .buf = undefined }`.
#[inline]
fn reset_buffered_file_reader(r: &mut BufferedFileReader, file: bun_sys::File) {
    r.unbuffered_reader = file;
    r.start = 0;
    r.end = 0;
}

/// `BufferedFileReader::read` shim — `bun_sys::File` doesn't impl
/// `DeprecatedRead`, so route through `bun_sys::read` directly.
#[inline]
fn buffered_file_reader_read(r: &mut BufferedFileReader, dest: &mut [u8]) -> bun_sys::Maybe<usize> {
    let current = &r.buf[r.start..r.end];
    if !current.is_empty() {
        let to_transfer = current.len().min(dest.len());
        dest[..to_transfer].copy_from_slice(&current[..to_transfer]);
        r.start += to_transfer;
        return Ok(to_transfer);
    }
    if dest.len() >= r.buf.len() {
        return bun_sys::read(r.unbuffered_reader.handle, dest);
    }
    r.end = bun_sys::read(r.unbuffered_reader.handle, &mut r.buf)?;
    let to_transfer = r.end.min(dest.len());
    dest[..to_transfer].copy_from_slice(&r.buf[..to_transfer]);
    r.start = to_transfer;
    Ok(to_transfer)
}

/// `PackageManagerOptions` field accessors (kept as fns so call sites read
/// uniformly regardless of stub/real options shape).
#[inline]
fn opt_dry_run(m: &PackageManager) -> bool {
    m.options.dry_run
}
#[inline]
fn opt_pack_destination(m: &PackageManager) -> &[u8] {
    m.options.pack_destination
}
#[inline]
fn opt_pack_filename(m: &PackageManager) -> &[u8] {
    m.options.pack_filename
}
#[inline]
fn opt_pack_gzip_level(m: &PackageManager) -> Option<&[u8]> {
    m.options.pack_gzip_level
}
#[inline]
fn manager_env<'a>(m: &'a PackageManager) -> &'a bun_dotenv::Loader<'static> {
    m.env()
}

// ───────────────────────────────────────────────────────────────────────────
// pack()
// ───────────────────────────────────────────────────────────────────────────

// TODO(port): Zig used `comptime for_publish: bool` to vary the return type
// (`Publish.Context(true)` vs `void`). Rust const generics cannot vary return
// type directly; using an associated-type-like Option for now. Phase B: split
// into `pack()` and `pack_for_publish()` or use a trait.
pub type PackReturn<'a, const FOR_PUBLISH: bool> = Option<Publish::Context<'a, true>>;

pub fn pack<const FOR_PUBLISH: bool>(
    ctx: &mut Context<'_>,
    abs_package_json_path: &ZStr,
) -> Result<PackReturn<'static, FOR_PUBLISH>, PackError<FOR_PUBLISH>> {
    // PORT NOTE: reshaped for borrowck — Zig freely aliased `*PackageManager`
    // alongside `ctx`-whole calls (`run_lifecycle_script(ctx, …)`,
    // `iterate_bundled_deps(ctx, …)`). Round-trip the field through a raw
    // pointer so the long-lived `manager` reborrow is decoupled from `ctx`;
    // every interleaved `ctx` access touches disjoint fields (`command_ctx`,
    // `bundled_deps`, `stats`) or only reads `manager` via `pm_*` helpers.
    let manager_ptr: *mut PackageManager = &raw mut *ctx.manager;
    // SAFETY: `ctx.manager` is the sole `&mut PackageManager`; CLI is
    // single-threaded and no callee retains a conflicting borrow.
    let manager: &mut PackageManager = unsafe { &mut *manager_ptr };
    let log_level = manager.options.log_level;
    let bump = pack_bump();
    // PORT NOTE: `workspace_package_json_cache` and `log` are disjoint fields on
    // `PackageManager` but Zig accessed them via the same `*PackageManager`
    // alias inside one call; route through raw-pointer field projections so the
    // two `&mut` borrows don't conflict.
    let mut json = match pm_workspace_cache(manager_ptr).get_with_path(
        pm_log(manager_ptr),
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
            let _ = pm_log(manager_ptr).print(std::ptr::from_mut(Output::error_writer()));
            Global::crash();
        }
        WorkspacePackageJSONCache::GetResult::Entry(entry) => entry,
    };

    if FOR_PUBLISH {
        if let Some(config) = json.root.get(b"publishConfig") {
            if manager.options.publish_config.tag.is_empty() {
                if let Some(tag) = config.get_string_cloned(bump, b"tag")? {
                    manager.options.publish_config.tag = tag;
                }
            }
            if manager.options.publish_config.access.is_none() {
                if let Some((access, _)) = config.get_string(bump, b"access")? {
                    manager.options.publish_config.access =
                        match bun_install::Access::from_str(access) {
                            Some(a) => Some(a),
                            None => {
                                Output::err_generic(
                                    "invalid `access` value: '{}'",
                                    format_args!("{}", bstr::BStr::new(access)),
                                );
                                Global::crash();
                            }
                        };
                }
            }
        }

        // maybe otp
    }

    let mut package_name_expr: Expr = json
        .root
        .get(b"name")
        .ok_or(PackError::MissingPackageName)?;
    let mut package_name = package_name_expr
        .as_string_cloned(bump)?
        .ok_or(PackError::InvalidPackageName)?;
    if FOR_PUBLISH {
        let is_scoped = bun_install::dependency::is_scoped_package_name(package_name)
            .map_err(|_| PackError::InvalidPackageName)?;
        if let Some(access) = manager.options.publish_config.access {
            if access == bun_install::Access::Restricted && !is_scoped {
                return Err(PackError::RestrictedUnscopedPackage);
            }
        }
    }
    // defer if (!for_publish) free(package_name) — handled by Drop
    if package_name.is_empty() {
        return Err(PackError::InvalidPackageName);
    }

    let mut package_version_expr: Expr = json
        .root
        .get(b"version")
        .ok_or(PackError::MissingPackageVersion)?;
    let mut package_version = package_version_expr
        .as_string_cloned(bump)?
        .ok_or(PackError::InvalidPackageVersion)?;
    if package_version.is_empty() {
        return Err(PackError::InvalidPackageVersion);
    }

    if FOR_PUBLISH {
        if let Some(private) = json.root.get(b"private") {
            if let Some(is_private) = private.as_bool() {
                if is_private {
                    return Err(PackError::PrivatePackage);
                }
            }
        }
    }

    // PORT NOTE: `Transpiler` has no `Default`; Zig used `var t: Transpiler = undefined;`
    // and `configure_env_for_run` writes the whole struct (out-param constructor).
    let mut this_transpiler: core::mem::MaybeUninit<bun_bundler::Transpiler<'static>> =
        core::mem::MaybeUninit::uninit();

    if let Err(err) = RunCommand::configure_env_for_run(
        &mut *ctx.command_ctx,
        &mut this_transpiler,
        Some(pm_env(manager)),
        manager.options.log_level != LogLevel::Silent,
        false,
    ) {
        if err == bun_core::err!("OutOfMemory") {
            return Err(PackError::OutOfMemory);
        }
        Output::err_generic(
            "failed to run pack scripts due to error: {}\n",
            format_args!("{}", err.name()),
        );
        Global::crash();
    }

    let abs_workspace_path: &[u8] = strings::without_trailing_slash(
        strings::without_suffix_comptime(abs_package_json_path.as_bytes(), b"package.json"),
    );
    // SAFETY: `configure_env_for_run` fully initialized `this_transpiler`.
    let this_transpiler = unsafe { this_transpiler.assume_init_mut() };
    // `Transpiler::env` is a process-singleton `*mut` (set by `init`); pass as
    // raw pointer so `run_package_script_foreground` can `&mut` it without
    // conflicting with our `&Transpiler` borrow.
    let transpiler_env: *mut bun_dotenv::Loader<'static> = this_transpiler.env;
    manager.env_mut().map.put(b"npm_command", b"pack")?;

    let (postpack_script, publish_script, postpublish_script, ran_scripts): (
        Option<Box<[u8]>>,
        Option<Box<[u8]>>,
        Option<Box<[u8]>>,
        bool,
    ) = 'post_scripts: {
        // --ignore-scripts
        if !pm_run_scripts(manager) {
            break 'post_scripts (None, None, None, false);
        }

        let Some(scripts) = json.root.as_property(b"scripts") else {
            break 'post_scripts (None, None, None, false);
        };
        if !matches!(scripts.expr.data, ExprData::EObject(_)) {
            break 'post_scripts (None, None, None, false);
        }

        // Track whether any scripts ran that could modify package.json
        let mut did_run_scripts = false;

        if FOR_PUBLISH {
            if let Some(prepublish_only_script_str) = scripts.expr.get(b"prepublishOnly") {
                if let Some(prepublish_only) = prepublish_only_script_str.as_string(bump) {
                    did_run_scripts = true;
                    run_lifecycle_script(
                        ctx,
                        prepublish_only,
                        b"prepublishOnly",
                        abs_workspace_path,
                        transpiler_env,
                        manager.options.log_level == LogLevel::Silent,
                    )?;
                }
            }
        }

        if let Some(prepack_script) = scripts.expr.get(b"prepack") {
            if let Some(prepack_script_str) = prepack_script.as_string(bump) {
                did_run_scripts = true;
                run_lifecycle_script(
                    ctx,
                    prepack_script_str,
                    b"prepack",
                    abs_workspace_path,
                    transpiler_env,
                    manager.options.log_level == LogLevel::Silent,
                )?;
            }
        }

        if let Some(prepare_script) = scripts.expr.get(b"prepare") {
            if let Some(prepare_script_str) = prepare_script.as_string(bump) {
                did_run_scripts = true;
                run_lifecycle_script(
                    ctx,
                    prepare_script_str,
                    b"prepare",
                    abs_workspace_path,
                    transpiler_env,
                    manager.options.log_level == LogLevel::Silent,
                )?;
            }
        }

        let mut postpack_script: Option<Box<[u8]>> = None;
        if let Some(postpack) = scripts.expr.get(b"postpack") {
            postpack_script = postpack.as_string(bump).map(Box::from);
        }

        if FOR_PUBLISH {
            let mut publish_script: Option<Box<[u8]>> = None;
            let mut postpublish_script: Option<Box<[u8]>> = None;
            if let Some(publish) = scripts.expr.get(b"publish") {
                publish_script = publish.as_string_cloned(bump)?.map(Box::from);
            }
            if let Some(postpublish) = scripts.expr.get(b"postpublish") {
                postpublish_script = postpublish.as_string_cloned(bump)?.map(Box::from);
            }

            break 'post_scripts (
                postpack_script,
                publish_script,
                postpublish_script,
                did_run_scripts,
            );
        }

        break 'post_scripts (postpack_script, None, None, did_run_scripts);
    };

    // If any lifecycle scripts ran, they may have modified package.json,
    // so we need to re-read it from disk to pick up any changes.
    if ran_scripts {
        // Invalidate the cached entry by removing it.
        // On Windows, the cache key is stored with POSIX path separators,
        // so we need to convert the path before removing.
        #[cfg(windows)]
        let mut cache_key_buf = PathBuffer::uninit();
        #[cfg(windows)]
        let cache_key: &[u8] = {
            let len = abs_package_json_path.as_bytes().len();
            cache_key_buf[..len].copy_from_slice(abs_package_json_path.as_bytes());
            path::dangerously_convert_path_to_posix_in_place::<u8>(&mut cache_key_buf[..len]);
            &cache_key_buf[..len]
        };
        #[cfg(not(windows))]
        let cache_key: &[u8] = abs_package_json_path.as_bytes();
        let _ = pm_workspace_cache(manager_ptr).map.remove(cache_key);

        // Re-read package.json from disk
        json = match pm_workspace_cache(manager_ptr).get_with_path(
            pm_log(manager_ptr),
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
                let _ = pm_log(manager_ptr).print(std::ptr::from_mut(Output::error_writer()));
                Global::crash();
            }
            WorkspacePackageJSONCache::GetResult::Entry(entry) => entry,
        };

        // Re-validate private flag after scripts may have modified it.
        if FOR_PUBLISH {
            if let Some(private) = json.root.get(b"private") {
                if let Some(is_private) = private.as_bool() {
                    if is_private {
                        return Err(PackError::PrivatePackage);
                    }
                }
            }
        }

        // Re-read name and version from the updated package.json, since lifecycle
        // scripts (e.g. prepublishOnly, prepack) may have modified them.
        package_name_expr = json
            .root
            .get(b"name")
            .ok_or(PackError::MissingPackageName)?;
        package_name = package_name_expr
            .as_string_cloned(bump)?
            .ok_or(PackError::InvalidPackageName)?;
        if package_name.is_empty() {
            return Err(PackError::InvalidPackageName);
        }

        package_version_expr = json
            .root
            .get(b"version")
            .ok_or(PackError::MissingPackageVersion)?;
        package_version = package_version_expr
            .as_string_cloned(bump)?
            .ok_or(PackError::InvalidPackageVersion)?;
        if package_version.is_empty() {
            return Err(PackError::InvalidPackageVersion);
        }
    }

    // Create the edited package.json content after lifecycle scripts have run
    let edited_package_json = edit_root_package_json(ctx.lockfile, &mut json)?;

    let mut root_dir: Dir = 'root_dir: {
        let mut path_buf = PathBuffer::uninit();
        path_buf[..abs_workspace_path.len()].copy_from_slice(abs_workspace_path);
        path_buf[abs_workspace_path.len()] = 0;
        // SAFETY: NUL written above
        let z = ZStr::from_buf(&path_buf[..], abs_workspace_path.len());
        match dir_open_dir_z(
            &Dir::cwd(),
            z,
            bun_sys::OpenDirOptions {
                iterate: true,
                ..Default::default()
            },
        ) {
            Ok(d) => break 'root_dir d,
            Err(err) => {
                Output::err(
                    err,
                    "failed to open root directory: {}\n",
                    format_args!("{}", bstr::BStr::new(abs_workspace_path)),
                );
                Global::crash();
            }
        }
    };
    let _close_root = CloseOnDrop::dir(root_dir);

    // Scan for a README file so the registry receives the same
    // `readme` / `readmeFilename` metadata that `npm publish` sends.
    // `find_workspace_readme` opens its own directory handle because
    // `root_dir` is iterated below and its kernel readdir offset gets
    // exhausted.
    let workspace_readme: Option<Publish::ReadmeInfo> = if FOR_PUBLISH {
        Publish::PublishCommand::find_workspace_readme(abs_workspace_path)
    } else {
        None
    };

    ctx.bundled_deps = match get_bundled_deps(&json.root, "bundledDependencies")? {
        Some(deps) => deps,
        None => get_bundled_deps(&json.root, "bundleDependencies")?.unwrap_or_default(),
    };

    let mut pack_queue: PackQueue = new_pack_queue();

    let bins = get_package_bins(&json.root)?;
    // defer free(bin.path) — handled by Drop on Vec<BinInfo>

    for bin in &bins {
        match bin.ty {
            BinType::File => {
                pack_queue.add(PackQueueItem {
                    path: ZBox::from_bytes(bin.path.as_bytes()),
                    optional: true,
                })?;
                // TODO(port): Zig pushed a borrowed slice; cloning here
            }
            BinType::Dir => {
                let bin_dir = match dir_open_dir_z(
                    &root_dir,
                    &bin.path,
                    bun_sys::OpenDirOptions {
                        iterate: true,
                        ..Default::default()
                    },
                ) {
                    Ok(d) => d,
                    Err(_) => {
                        // non-existent bins are ignored
                        continue;
                    }
                };

                iterate_project_tree(
                    &mut pack_queue,
                    &[],
                    DirInfo(bin_dir, bin.path.as_bytes().into(), 2),
                    log_level,
                )?;
            }
        }
    }

    'iterate_project_tree: {
        if let Some(files) = json.root.get(b"files") {
            'files_error: {
                if let Some(mut files_array) = files.as_array() {
                    let mut includes: Vec<Pattern> = Vec::new();
                    let mut excludes: Vec<Pattern> = Vec::new();

                    let mut path_buf = PathBuffer::uninit();
                    while let Some(files_entry) = files_array.next() {
                        if let Some(file_entry_str) = files_entry.as_string(bump) {
                            let normalized = resolve_path::normalize_buf::<
                                resolve_path::platform::Posix,
                            >(
                                file_entry_str, &mut path_buf
                            );
                            let Some(parsed) = Pattern::from_utf8(normalized)? else {
                                continue;
                            };
                            if parsed.flags.contains(PatternFlags::NEGATED) {
                                #[cold]
                                fn push_exclude(v: &mut Vec<Pattern>, p: Pattern) {
                                    v.push(p);
                                }
                                // most "files" entries are not exclusions.
                                push_exclude(&mut excludes, parsed);
                            } else {
                                includes.push(parsed);
                            }

                            continue;
                        }

                        break 'files_error;
                    }

                    iterate_included_project_tree(
                        &mut pack_queue,
                        &bins,
                        &includes,
                        &excludes,
                        root_dir, // TODO(port): borrowck — root_dir reused after this; Phase B pass &Dir
                        log_level,
                    )?;
                    break 'iterate_project_tree;
                }
            }

            Output::err_generic(
                "expected `files` to be an array of string values",
                format_args!(""),
            );
            Global::crash();
        } else {
            // pack from project root
            iterate_project_tree(
                &mut pack_queue,
                &bins,
                DirInfo(root_dir, Box::from(&b""[..]), 1),
                // TODO(port): borrowck — root_dir reused after this; Phase B pass &Dir or dup fd
                log_level,
            )?;
        }
    }

    let mut bundled_pack_queue = iterate_bundled_deps(ctx, &root_dir, log_level)?;

    // +1 for package.json
    ctx.stats.total_files = pack_queue.count() + bundled_pack_queue.count() + 1;

    if opt_dry_run(manager) {
        // don't create the tarball, but run scripts if they exist

        print_archived_files_and_packages::<true>(
            ctx,
            &root_dir,
            PackListOrQueue::Queue(&mut pack_queue),
            0,
        );

        if !FOR_PUBLISH {
            if opt_pack_destination(manager).is_empty() && opt_pack_filename(manager).is_empty() {
                Output::pretty(format_args!(
                    "\n{}\n",
                    fmt_tarball_filename(
                        &package_name,
                        &package_version,
                        TarballNameStyle::Normalize
                    )
                ));
            } else {
                let mut dest_buf = PathBuffer::uninit();
                let (abs_tarball_dest, _) = tarball_destination(
                    opt_pack_destination(ctx.manager),
                    opt_pack_filename(ctx.manager),
                    abs_workspace_path,
                    &package_name,
                    &package_version,
                    &mut dest_buf[..],
                );
                Output::pretty(format_args!(
                    "\n{}\n",
                    bstr::BStr::new(abs_tarball_dest.as_bytes())
                ));
            }
        }

        Context::print_summary(ctx.stats, None, None, log_level);

        if let Some(postpack_script_str) = &postpack_script {
            run_lifecycle_script(
                ctx,
                postpack_script_str,
                b"postpack",
                abs_workspace_path,
                pm_env(manager),
                manager.options.log_level == LogLevel::Silent,
            )?;
        }

        if FOR_PUBLISH {
            let mut dest_buf = PathBuffer::uninit();
            let (abs_tarball_dest, _) = tarball_destination(
                opt_pack_destination(ctx.manager),
                opt_pack_filename(ctx.manager),
                abs_workspace_path,
                &package_name,
                &package_version,
                &mut dest_buf[..],
            );
            // PORT NOTE: `manager`/`command_ctx` reborrowed via raw pointer —
            // Zig freely aliased `*PackageManager`/`*ContextData` between
            // `pack::Context` and `Publish::Context`; both are process-lifetime
            // singletons (see `cli::command::GLOBAL_CLI_CTX`).
            // SAFETY: pointers came from `&mut` and outlive the returned value.
            return Ok(Some(Publish::Context {
                manager: unsafe { &mut *manager_ptr },
                command_ctx: unsafe { &mut *std::ptr::from_mut(ctx.command_ctx) },
                package_name: package_name.into(),
                package_version: package_version.into(),
                abs_tarball_path: ZStr::boxed(abs_tarball_dest.as_bytes()),
                tarball_bytes: Box::new([]),
                shasum: [0u8; sha::SHA1::DIGEST],
                integrity: [0u8; sha::SHA512::DIGEST],
                uses_workspaces: false,
                publish_script,
                postpublish_script,
                script_env: Some(this_transpiler.env_mut()),
                normalized_pkg_info: Box::new([]),
            }));
        }

        return Ok(None);
    }

    let mut print_buf: Vec<u8> = Vec::new();

    let archive = Archive::write_new();

    match archive.write_set_format_pax_restricted() {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "failed to set archive format: {}",
                format_args!("{}", bstr::BStr::new(archive.error_string())),
            );
            Global::crash();
        }
        _ => {}
    }
    match archive.write_add_filter_gzip() {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "failed to set archive compression to gzip: {}",
                format_args!("{}", bstr::BStr::new(archive.error_string())),
            );
            Global::crash();
        }
        _ => {}
    }

    // default is 9
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L12
    let compression_level: &[u8] = opt_pack_gzip_level(manager).unwrap_or(b"9");
    write!(&mut print_buf, "{}\x00", bstr::BStr::new(compression_level)).expect("OOM");
    // SAFETY: print_buf[compression_level.len()] == 0 written above
    let level_z = ZStr::from_buf(&print_buf[..], compression_level.len());
    match archive.write_set_filter_option(None, zstr_lit(b"compression-level\0"), level_z) {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "compression level must be between 0 and 9, received {}",
                format_args!("{}", bstr::BStr::new(compression_level)),
            );
            Global::crash();
        }
        _ => {}
    }
    print_buf.clear();

    match archive.write_set_filter_option(None, zstr_lit(b"os\0"), zstr_lit(b"Unknown\0")) {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "failed to set os to `Unknown`: {}",
                format_args!("{}", bstr::BStr::new(archive.error_string())),
            );
            Global::crash();
        }
        _ => {}
    }

    match archive.write_set_options(zstr_lit(b"gzip:!timestamp\0")) {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "failed to unset gzip timestamp option: {}",
                format_args!("{}", bstr::BStr::new(archive.error_string())),
            );
            Global::crash();
        }
        _ => {}
    }

    let mut dest_buf = PathBuffer::uninit();
    let (abs_tarball_dest, abs_tarball_dest_dir_end) = tarball_destination(
        opt_pack_destination(ctx.manager),
        opt_pack_filename(ctx.manager),
        abs_workspace_path,
        &package_name,
        &package_version,
        &mut dest_buf[..],
    );
    // PORT NOTE: reshaped for borrowck — abs_tarball_dest borrows dest_buf
    let abs_tarball_dest_len = abs_tarball_dest.as_bytes().len();

    {
        // create the directory if it doesn't exist
        let most_likely_a_slash = dest_buf[abs_tarball_dest_dir_end];
        dest_buf[abs_tarball_dest_dir_end] = 0;
        // SAFETY: NUL written above
        let abs_tarball_dest_dir = ZStr::from_buf(&dest_buf[..], abs_tarball_dest_dir_end);
        let _ = bun_sys::make_path(Dir::cwd(), abs_tarball_dest_dir.as_bytes());
        dest_buf[abs_tarball_dest_dir_end] = most_likely_a_slash;
    }

    // SAFETY: dest_buf[abs_tarball_dest_len] == 0 (written by tarball_destination)
    let abs_tarball_dest = ZStr::from_buf(&dest_buf[..], abs_tarball_dest_len);

    // TODO: experiment with `archive.writeOpenMemory()`
    match archive.write_open_filename(abs_tarball_dest) {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "failed to open tarball file destination: \"{}\"",
                format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())),
            );
            Global::crash();
        }
        _ => {}
    }

    // append removed items from `pack_queue` with their file size
    let mut pack_list: PackList = Vec::new();

    let mut read_buf = [0u8; 8192];
    let mut file_reader: Box<BufferedFileReader> =
        new_boxed_buffered_file_reader(File::from_fd(Fd::invalid()));

    let mut entry = ArchiveEntry::new2(archive);

    {
        let mut progress = Progress::Progress::default();
        let mut node: Option<&mut Progress::Node> = None;
        if log_level.show_progress() {
            progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            node = Some(progress.start(b"", pack_queue.count() + bundled_pack_queue.count() + 1));
            node.as_mut().expect("infallible: progress active").unit = Progress::Unit::Files;
        }
        // PORT NOTE: Zig had `defer node.end()` / `defer node.completeOne()`.
        // The loop bodies' only early exits are `continue` (where the Zig
        // `defer` still fires) and `Global::crash()` (never returns, no
        // unwinding). `scopeguard` captures of `&mut node` overlap the inline
        // uses below, so call `complete_one()` explicitly at every loop-body
        // exit and `end()` once after the loops.

        entry = archive_package_json(
            ctx,
            unsafe { &mut *archive },
            entry,
            &root_dir,
            &edited_package_json,
        )?;
        if log_level.show_progress() {
            node.as_mut()
                .expect("infallible: progress active")
                .complete_one();
        }

        while let Some(item) = pack_queue.remove_or_null() {
            let file = match bun_sys::openat(
                Fd::from_std_dir(&root_dir),
                &item.path,
                bun_sys::O::RDONLY,
                0,
            ) {
                Ok(f) => f,
                Err(err) => {
                    if item.optional {
                        ctx.stats.total_files -= 1;
                        if log_level.show_progress() {
                            node.as_mut()
                                .expect("infallible: progress active")
                                .complete_one();
                        }
                        continue;
                    }
                    Output::err(
                        err,
                        "failed to open file: \"{}\"",
                        format_args!("{}", bstr::BStr::new(item.path.as_bytes())),
                    );
                    Global::crash();
                }
            };

            let fd: Fd = match file
                .make_lib_uv_owned_for_syscall(bun_sys::Tag::open, bun_sys::ErrorCase::CloseOnFail)
            {
                Ok(fd) => fd,
                Err(err) => {
                    Output::err(
                        err,
                        "failed to open file: \"{}\"",
                        format_args!("{}", bstr::BStr::new(item.path.as_bytes())),
                    );
                    Global::crash();
                }
            };

            let _close_fd = CloseOnDrop::new(fd);

            let stat = match bun_sys::sys_uv::fstat(fd) {
                Ok(s) => s,
                Err(err) => {
                    Output::err(
                        err,
                        "failed to stat file: \"{}\"",
                        format_args!("{}", bstr::BStr::new(item.path.as_bytes())),
                    );
                    Global::crash();
                }
            };

            pack_list.push(PackListEntry {
                subpath: ZBox::from_bytes(item.path.as_bytes()),
                size: usize::try_from(stat.st_size).expect("int cast"),
            });

            entry = add_archive_entry(
                ctx,
                fd,
                &stat,
                &item.path,
                &mut read_buf,
                &mut file_reader,
                unsafe { &mut *archive },
                entry,
                &mut print_buf,
                &bins,
            )?;

            if log_level.show_progress() {
                node.as_mut()
                    .expect("infallible: progress active")
                    .complete_one();
            }
        }

        while let Some(item) = bundled_pack_queue.remove_or_null() {
            let file = match File::openat(
                Fd::from_std_dir(&root_dir),
                &item.path,
                bun_sys::O::RDONLY,
                0,
            ) {
                Ok(f) => f,
                Err(err) => {
                    if item.optional {
                        ctx.stats.total_files -= 1;
                        if log_level.show_progress() {
                            node.as_mut()
                                .expect("infallible: progress active")
                                .complete_one();
                        }
                        continue;
                    }
                    Output::err(
                        err,
                        "failed to open file: \"{}\"",
                        format_args!("{}", bstr::BStr::new(item.path.as_bytes())),
                    );
                    Global::crash();
                }
            };
            let _close_file = CloseOnDrop::file(&file);
            let stat = match file.stat() {
                Ok(s) => s,
                Err(err) => {
                    Output::err(
                        err,
                        "failed to stat file: \"{}\"",
                        format_args!("{}", file.handle),
                    );
                    Global::crash();
                }
            };

            entry = add_archive_entry(
                ctx,
                file.handle,
                &stat,
                &item.path,
                &mut read_buf,
                &mut file_reader,
                unsafe { &mut *archive },
                entry,
                &mut print_buf,
                &bins,
            )?;

            if log_level.show_progress() {
                node.as_mut()
                    .expect("infallible: progress active")
                    .complete_one();
            }
        }

        if log_level.show_progress() {
            if let Some(n) = node.as_mut() {
                n.end();
            }
        }
    }

    ArchiveEntry::opaque_ref(entry).free();

    match archive.write_close() {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "failed to close archive: {}",
                format_args!("{}", bstr::BStr::new(archive.error_string())),
            );
            Global::crash();
        }
        _ => {}
    }

    match archive.write_free() {
        ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
            Output::err_generic(
                "failed to free archive: {}",
                format_args!("{}", bstr::BStr::new(archive.error_string())),
            );
            Global::crash();
        }
        _ => {}
    }

    let mut shasum: [u8; sha::SHA1::DIGEST] = [0; sha::SHA1::DIGEST];
    let mut integrity: [u8; sha::SHA512::DIGEST] = [0; sha::SHA512::DIGEST];

    let tarball_bytes: Option<Vec<u8>> = 'tarball_bytes: {
        let tarball_file = match File::open(abs_tarball_dest, bun_sys::O::RDONLY, 0) {
            Ok(f) => f,
            Err(err) => {
                Output::err(
                    err,
                    "failed to open tarball at: \"{}\"",
                    format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())),
                );
                Global::crash();
            }
        };
        let _close_tarball = CloseOnDrop::file(&tarball_file);

        let mut sha1 = sha::SHA1::init();
        let mut sha512 = sha::SHA512::init();

        if FOR_PUBLISH {
            let bytes = match tarball_file.read_to_end() {
                Ok(b) => b,
                Err(err) => {
                    Output::err(
                        err,
                        "failed to read tarball: \"{}\"",
                        format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())),
                    );
                    Global::crash();
                }
            };

            sha1.update(&bytes);
            sha512.update(&bytes);

            sha1.r#final(&mut shasum);
            sha512.r#final(&mut integrity);

            ctx.stats.packed_size = bytes.len();

            break 'tarball_bytes Some(bytes);
        }

        reset_buffered_file_reader(&mut file_reader, File::from_fd(tarball_file.handle));

        let mut size: usize = 0;
        let mut read = match buffered_file_reader_read(&mut file_reader, &mut read_buf) {
            Ok(n) => n,
            Err(err) => {
                Output::err(
                    err,
                    "failed to read tarball: \"{}\"",
                    format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())),
                );
                Global::crash();
            }
        };
        while read > 0 {
            sha1.update(&read_buf[..read]);
            sha512.update(&read_buf[..read]);
            size += read;
            read = match buffered_file_reader_read(&mut file_reader, &mut read_buf) {
                Ok(n) => n,
                Err(err) => {
                    Output::err(
                        err,
                        "failed to read tarball: \"{}\"",
                        format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())),
                    );
                    Global::crash();
                }
            };
        }

        sha1.r#final(&mut shasum);
        sha512.r#final(&mut integrity);

        ctx.stats.packed_size = size;
        None
    };

    let normalized_pkg_info: Option<Box<[u8]>> = if FOR_PUBLISH {
        // `normalized_package` operates on the full T4 `bun_ast::Expr`
        // (it injects new properties before printing); lift the T2 value-subset
        // root via the `From` impl. The mutated tree is consumed inside
        // `normalized_package` (it prints the JSON itself), so the lifted copy
        // doesn't need to flow back into `json.root`.
        let mut root_full = bun_ast::Expr::from(json.root);
        Some(Publish::PublishCommand::normalized_package(
            manager,
            &package_name,
            &package_version,
            &mut root_full,
            &json.source,
            shasum,
            integrity,
            workspace_readme,
        )?)
    } else {
        None
    };

    print_archived_files_and_packages::<false>(
        ctx,
        &root_dir,
        PackListOrQueue::List(&pack_list),
        edited_package_json.len(),
    );

    if !FOR_PUBLISH {
        if opt_pack_destination(manager).is_empty() && opt_pack_filename(manager).is_empty() {
            Output::pretty(format_args!(
                "\n{}\n",
                fmt_tarball_filename(&package_name, &package_version, TarballNameStyle::Normalize)
            ));
        } else {
            Output::pretty(format_args!(
                "\n{}\n",
                bstr::BStr::new(abs_tarball_dest.as_bytes())
            ));
        }
    }

    Context::print_summary(ctx.stats, Some(&shasum), Some(&integrity), log_level);

    if FOR_PUBLISH {
        Output::flush();
    }

    if let Some(postpack_script_str) = &postpack_script {
        Output::pretty(format_args!("\n"));
        run_lifecycle_script(
            ctx,
            postpack_script_str,
            b"postpack",
            abs_workspace_path,
            pm_env(manager),
            manager.options.log_level == LogLevel::Silent,
        )?;
    }

    if FOR_PUBLISH {
        // SAFETY: see dry-run construction above — `manager`/`command_ctx` are
        // process-lifetime singletons aliased exactly as Zig's `*T` did.
        return Ok(Some(Publish::Context {
            manager: unsafe { &mut *manager_ptr },
            command_ctx: unsafe { &mut *std::ptr::from_mut(ctx.command_ctx) },
            package_name: package_name.into(),
            package_version: package_version.into(),
            abs_tarball_path: ZStr::boxed(abs_tarball_dest.as_bytes()),
            tarball_bytes: tarball_bytes.unwrap_or_default().into_boxed_slice(),
            shasum,
            integrity,
            uses_workspaces: false,
            publish_script,
            postpublish_script,
            script_env: Some(this_transpiler.env_mut()),
            normalized_pkg_info: normalized_pkg_info.unwrap_or_default(),
        }));
    }

    Ok(None)
}

// Helper extracted from repeated `RunCommand.runPackageScriptForeground` blocks.
// PORT NOTE: hoisted from repeated inline blocks to avoid 5x duplication of the
// same `match err { MissingShell, OutOfMemory }` arms. Behavior identical.
fn run_lifecycle_script<const FOR_PUBLISH: bool>(
    ctx: &Context<'_>,
    script: &[u8],
    name: &[u8],
    abs_workspace_path: &[u8],
    env: *mut bun_dotenv::Loader<'static>,
    silent: bool,
) -> Result<(), PackError<FOR_PUBLISH>> {
    // PORT NOTE: `ctx.command_ctx` and `env` are reborrowed via raw pointer
    // because Zig passed `*ContextData` / `*DotEnv.Loader` (freely aliased
    // process singletons) and `run_package_script_foreground` needs `&mut`
    // for `env.map.put()` while `ctx` only holds `&Context`.
    // SAFETY: both are process-lifetime singletons; no concurrent `&mut` exists
    // while a lifecycle script runs (single-threaded CLI dispatch).
    let command_ctx = unsafe { &mut *std::ptr::from_ref(ctx.command_ctx).cast_mut() };
    let use_system_shell = command_ctx.debug.use_system_shell;
    match RunCommand::run_package_script_foreground(
        command_ctx,
        script,
        name,
        abs_workspace_path,
        // SAFETY: `env` is non-null (set by `PackageManager::init` /
        // `configure_env_for_run`).
        unsafe { &mut *env },
        &[],
        silent,
        use_system_shell,
    ) {
        Ok(_) => Ok(()),
        Err(err) => {
            if err == bun_core::err!("MissingShell") {
                Output::err_generic(
                    "failed to find shell executable to run {} script",
                    format_args!("{}", bstr::BStr::new(name)),
                );
                Global::crash();
            }
            if err == bun_core::err!("OutOfMemory") {
                return Err(PackError::OutOfMemory);
            }
            // TODO(port): Zig's error set is exactly {MissingShell, OutOfMemory};
            // unreachable here.
            unreachable!()
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// tarball name / destination
// ───────────────────────────────────────────────────────────────────────────

fn tarball_destination<'a>(
    pack_destination: &[u8],
    pack_filename: &[u8],
    abs_workspace_path: &[u8],
    package_name: &[u8],
    package_version: &[u8],
    dest_buf: &'a mut [u8],
) -> (&'a ZStr, usize) {
    if !pack_filename.is_empty() && !pack_destination.is_empty() {
        Output::err_generic(
            "cannot use both filename and destination at the same time with tarball: filename \"{}\" and destination \"{}\"",
            format_args!(
                "{} {}",
                bstr::BStr::new(strings::without_trailing_slash(pack_filename)),
                bstr::BStr::new(strings::without_trailing_slash(pack_destination)),
            ),
        );
        Global::crash();
    }
    if !pack_filename.is_empty() {
        // bufPrint(dest_buf, "{s}\x00", .{pack_filename})
        if pack_filename.len() + 1 > dest_buf.len() {
            Output::err_generic(
                "archive filename too long: \"{}\"",
                format_args!("{}", bstr::BStr::new(pack_filename)),
            );
            Global::crash();
        }
        dest_buf[..pack_filename.len()].copy_from_slice(pack_filename);
        dest_buf[pack_filename.len()] = 0;
        let tarball_name_len = pack_filename.len() + 1;

        // SAFETY: NUL written at pack_filename.len()
        return (ZStr::from_buf(&dest_buf[..], tarball_name_len - 1), 0);
    } else {
        let (dir_len_trimmed, dir_len_full) = {
            let tarball_destination_dir = resolve_path::join_abs_string_buf::<
                resolve_path::platform::Auto,
            >(
                abs_workspace_path, dest_buf, &[pack_destination]
            );
            (
                strings::without_trailing_slash(tarball_destination_dir).len(),
                tarball_destination_dir.len(),
            )
        };

        // bufPrint(dest_buf[dir_len_trimmed..], "/{f}\x00", ..)
        let mut cursor = std::io::Cursor::new(&mut dest_buf[dir_len_trimmed..]);
        let res = write!(
            &mut cursor,
            "/{}\x00",
            fmt_tarball_filename(package_name, package_version, TarballNameStyle::Normalize),
        );
        if res.is_err() {
            Output::err_generic(
                "archive destination name too long: \"{}/{}\"",
                format_args!(
                    "{}/{}",
                    bstr::BStr::new(strings::without_trailing_slash(&dest_buf[..dir_len_full])),
                    fmt_tarball_filename(
                        package_name,
                        package_version,
                        TarballNameStyle::Normalize
                    ),
                ),
            );
            Global::crash();
        }
        let tarball_name_len = usize::try_from(cursor.position()).expect("int cast");

        // SAFETY: NUL is the final byte written
        return (
            ZStr::from_buf(&dest_buf[..], dir_len_trimmed + tarball_name_len - 1),
            dir_len_full,
        );
    }
}

pub fn fmt_tarball_filename<'a>(
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
pub enum TarballNameStyle {
    Normalize,
    Raw,
}

pub struct TarballNameFormatter<'a> {
    package_name: &'a [u8],
    package_version: &'a [u8],
    style: TarballNameStyle,
}

impl<'a> fmt::Display for TarballNameFormatter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.style == TarballNameStyle::Raw {
            return write!(
                f,
                "{}-{}.tgz",
                bstr::BStr::new(self.package_name),
                bstr::BStr::new(self.package_version),
            );
        }

        if self.package_name[0] == b'@' {
            if self.package_name.len() > 1 {
                if let Some(slash) = strings::index_of_char(self.package_name, b'/') {
                    let slash = slash as usize;
                    return write!(
                        f,
                        "{}-{}-{}.tgz",
                        bstr::BStr::new(&self.package_name[1..][..slash - 1]),
                        bstr::BStr::new(&self.package_name[slash + 1..]),
                        bstr::BStr::new(self.package_version),
                    );
                }
            }

            return write!(
                f,
                "{}-{}.tgz",
                bstr::BStr::new(&self.package_name[1..]),
                bstr::BStr::new(self.package_version),
            );
        }

        write!(
            f,
            "{}-{}.tgz",
            bstr::BStr::new(self.package_name),
            bstr::BStr::new(self.package_version),
        )
    }
}

fn archive_package_json(
    ctx: &mut Context<'_>,
    archive: &mut Archive,
    entry: *mut ArchiveEntry,
    root_dir: &Dir,
    edited_package_json: &[u8],
) -> Result<*mut ArchiveEntry, AllocError> {
    // Zig: `entry: *Archive.Entry` → `*Archive.Entry` (same pointer after `.clear()`).
    let entry = ArchiveEntry::opaque_ref(entry);
    let stat = match bun_sys::fstatat(Fd::from_std_dir(root_dir), bun_core::zstr!("package.json")) {
        Ok(s) => s,
        Err(err) => {
            Output::err(
                bun_core::Error::from(err),
                "failed to stat package.json",
                format_args!(""),
            );
            Global::crash();
        }
    };

    entry.set_pathname(bun_core::zstr!("package/package.json"));
    // TODO(port): PACKAGE_PREFIX ++ "package.json" comptime concat
    entry.set_size(i64::try_from(edited_package_json.len()).expect("int cast"));
    // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
    entry.set_filetype(0o100000);
    entry.set_perm(u32::try_from(stat.st_mode).expect("int cast"));
    // '1985-10-26T08:15:00.000Z'
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
    entry.set_mtime(499162500, 0);

    match archive.write_header(entry) {
        ArchiveStatus::Failed | ArchiveStatus::Fatal | ArchiveStatus::Warn => {
            Output::err_generic(
                "failed to write tarball header: {}",
                format_args!(
                    "{}",
                    bstr::BStr::new(Archive::error_string(std::ptr::from_mut::<Archive>(
                        archive
                    )))
                ),
            );
            Global::crash();
        }
        _ => {}
    }

    ctx.stats.unpacked_size +=
        usize::try_from(archive.write_data(edited_package_json)).expect("int cast");

    Ok(entry.clear())
}

fn add_archive_entry(
    ctx: &mut Context<'_>,
    file: Fd,
    stat: &bun_sys::Stat,
    filename: &ZStr,
    read_buf: &mut [u8],
    file_reader: &mut BufferedFileReader,
    archive: &mut Archive,
    entry: *mut ArchiveEntry,
    print_buf: &mut Vec<u8>,
    bins: &[BinInfo],
) -> Result<*mut ArchiveEntry, AllocError> {
    // Zig: `entry: *Archive.Entry` → `*Archive.Entry` (same pointer after `.clear()`).
    let entry = ArchiveEntry::opaque_ref(entry);
    write!(
        print_buf,
        "{}{}\x00",
        bstr::BStr::new(PACKAGE_PREFIX),
        bstr::BStr::new(filename.as_bytes())
    )
    .expect("OOM");
    let pathname_len = PACKAGE_PREFIX.len() + filename.as_bytes().len();
    // SAFETY: print_buf[pathname_len] == 0 written above
    let pathname = ZStr::from_buf(&print_buf[..], pathname_len);
    #[cfg(windows)]
    entry.set_pathname_utf8(pathname);
    #[cfg(not(windows))]
    entry.set_pathname(pathname);
    print_buf.clear();

    entry.set_size(i64::try_from(stat.st_size).expect("int cast"));

    // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
    entry.set_filetype(0o100000);

    let mut perm: bun_sys::Mode = bun_sys::Mode::try_from(stat.st_mode).expect("int cast");
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L20
    if is_package_bin(bins, filename.as_bytes()) {
        perm |= 0o111;
    }
    entry.set_perm(u32::try_from(perm).expect("int cast"));

    // '1985-10-26T08:15:00.000Z'
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
    entry.set_mtime(499162500, 0);

    match archive.write_header(entry) {
        ArchiveStatus::Failed | ArchiveStatus::Fatal => {
            Output::err_generic(
                "failed to write tarball header: {}",
                format_args!(
                    "{}",
                    bstr::BStr::new(Archive::error_string(std::ptr::from_mut::<Archive>(
                        archive
                    )))
                ),
            );
            Global::crash();
        }
        _ => {}
    }

    reset_buffered_file_reader(file_reader, File::from_fd(file));

    let mut read = match buffered_file_reader_read(file_reader, read_buf) {
        Ok(n) => n,
        Err(err) => {
            Output::err(
                bun_core::Error::from(err),
                "failed to read file: \"{}\"",
                format_args!("{}", bstr::BStr::new(filename.as_bytes())),
            );
            Global::crash();
        }
    };
    while read > 0 {
        ctx.stats.unpacked_size +=
            usize::try_from(archive.write_data(&read_buf[..read])).expect("int cast");
        read = match buffered_file_reader_read(file_reader, read_buf) {
            Ok(n) => n,
            Err(err) => {
                Output::err(
                    bun_core::Error::from(err),
                    "failed to read file: \"{}\"",
                    format_args!("{}", bstr::BStr::new(filename.as_bytes())),
                );
                Global::crash();
            }
        };
    }

    Ok(entry.clear())
}

/// Strips workspace and catalog protocols from dependency versions then
/// returns the printed json
fn edit_root_package_json(
    maybe_lockfile: Option<&Lockfile>,
    json: &mut WorkspacePackageJSONCache::MapEntry,
) -> Result<Box<[u8]>, AllocError> {
    use bun_install_types::DependencyGroup;
    // preserve deps→dev→peer→optional order (matches Zig pack_command.zig:2149 error-message ordering)
    for dependency_group in [
        DependencyGroup::DEPENDENCIES,
        DependencyGroup::DEV,
        DependencyGroup::PEER,
        DependencyGroup::OPTIONAL,
    ]
    .map(|g| g.prop)
    {
        if let Some(dependencies_expr) = json.root.get(dependency_group) {
            if let ExprData::EObject(mut dependencies) = dependencies_expr.data {
                for dependency in dependencies.properties.slice_mut() {
                    // TODO(port): Zig iterated `slice()` of `*dependency`; need mutable iter
                    if dependency.key.is_none() {
                        continue;
                    }
                    if dependency.value.is_none() {
                        continue;
                    }

                    let Some(package_spec) = dependency
                        .value
                        .as_ref()
                        .expect("infallible: prop has value")
                        .as_utf8_string_literal()
                    else {
                        continue;
                    };
                    if let Some(without_workspace_protocol) =
                        strings::without_prefix_if_possible_comptime(package_spec, b"workspace:")
                    {
                        // TODO: make semver parsing more strict. `^`, `~` are not valid
                        // (see Zig source for commented-out parsed/valid block)

                        if without_workspace_protocol.len() == 1 {
                            // TODO: this might be too strict
                            let c = without_workspace_protocol[0];
                            if c == b'^' || c == b'~' || c == b'*' {
                                let dependency_name = match dependency
                                    .key
                                    .as_ref()
                                    .expect("infallible: prop has key")
                                    .as_utf8_string_literal()
                                {
                                    Some(n) => n,
                                    None => {
                                        Output::err_generic(
                                            "expected string value for dependency name in \"{}\"",
                                            format_args!("{}", bstr::BStr::new(dependency_group)),
                                        );
                                        Global::crash();
                                    }
                                };

                                let resolved = 'failed_to_resolve: {
                                    // find the current workspace version and append to package spec without `workspace:`
                                    let Some(lockfile) = maybe_lockfile else {
                                        break 'failed_to_resolve false;
                                    };
                                    let Some(workspace_version) = lockfile.workspace_versions.get(
                                        &Semver::string::Builder::string_hash(dependency_name),
                                    ) else {
                                        break 'failed_to_resolve false;
                                    };
                                    let prefix: &[u8] = match c {
                                        b'^' => b"^",
                                        b'~' => b"~",
                                        b'*' => b"",
                                        _ => unreachable!(),
                                    };
                                    // Zig: `try std.fmt.allocPrint(allocator, "{s}{}", ...)`.
                                    // Format on the heap then copy into the pack arena
                                    // (`ctx.allocator` analog); `EString::init` erases the
                                    // lifetime.
                                    let tmp = format!(
                                        "{}{}",
                                        bstr::BStr::new(prefix),
                                        workspace_version
                                            .fmt(lockfile.buffers.string_bytes.as_slice()),
                                    );
                                    let data = pack_bump().alloc_slice_copy(tmp.as_bytes());
                                    dependency.value = Some(Expr::init(
                                        E::EString::init(data),
                                        Default::default(),
                                    ));
                                    true
                                };
                                if resolved {
                                    continue;
                                }

                                // only produce this error only when we need to get the workspace version
                                Output::err_generic(
                                    "Failed to resolve workspace version for \"{}\" in `{}`. Run <cyan>`bun install`<r> and try again.",
                                    (
                                        bstr::BStr::new(dependency_name),
                                        bstr::BStr::new(dependency_group),
                                    ),
                                );
                                Global::crash();
                            }
                        }

                        // Zig: `try allocator.dupe(u8, without_workspace_protocol)`.
                        let dup = pack_bump().alloc_slice_copy(without_workspace_protocol);
                        dependency.value =
                            Some(Expr::init(E::EString::init(dup), Default::default()));
                    } else if let Some(catalog_name_str) =
                        strings::without_prefix_if_possible_comptime(package_spec, b"catalog:")
                    {
                        let dep_name_str = dependency
                            .key
                            .as_ref()
                            .expect("infallible: prop has key")
                            .as_utf8_string_literal()
                            .expect("infallible: is_string checked");

                        let lockfile = match maybe_lockfile {
                            Some(l) => l,
                            None => {
                                Output::err_generic(
                                    "Failed to resolve catalog version for \"{}\" in `{}` (catalogs require a lockfile).",
                                    (
                                        bstr::BStr::new(dep_name_str),
                                        bstr::BStr::new(dependency_group),
                                    ),
                                );
                                Global::crash();
                            }
                        };

                        let catalog_name = Semver::String::init(catalog_name_str, catalog_name_str);
                        let map_buf: &[u8] = lockfile.buffers.string_bytes.as_slice();

                        // PORT NOTE: `CatalogMap::get_group` takes `&mut self`
                        // (returns `&mut Map`) but `pack` only needs read
                        // access via `&Lockfile`; inline an immutable lookup.
                        let catalog = if catalog_name.is_empty() {
                            Some(&lockfile.catalogs.default)
                        } else {
                            let ctx = Semver::string::ArrayHashContext {
                                arg_buf: catalog_name_str,
                                existing_buf: map_buf,
                            };
                            let h = ctx.hash(catalog_name);
                            lockfile
                                .catalogs
                                .groups
                                .get_index_adapted_raw(h, |k, i| ctx.eql(catalog_name, *k, i))
                                .map(|i| &lockfile.catalogs.groups.values()[i])
                        };
                        let Some(catalog) = catalog else {
                            Output::err_generic(
                                "Failed to resolve catalog version for \"{}\" in `{}` (no matching catalog).",
                                (
                                    bstr::BStr::new(dep_name_str),
                                    bstr::BStr::new(dependency_group),
                                ),
                            );
                            Global::crash();
                        };

                        let dep_name = Semver::String::init(dep_name_str, dep_name_str);
                        let dep_ctx = Semver::string::ArrayHashContext {
                            arg_buf: dep_name_str,
                            existing_buf: map_buf,
                        };
                        let dep_h = dep_ctx.hash(dep_name);
                        let Some(dep_idx) = catalog
                            .get_index_adapted_raw(dep_h, |k, i| dep_ctx.eql(dep_name, *k, i))
                        else {
                            Output::err_generic(
                                "Failed to resolve catalog version for \"{}\" in `{}` (no matching catalog dependency).",
                                (
                                    bstr::BStr::new(dep_name_str),
                                    bstr::BStr::new(dependency_group),
                                ),
                            );
                            Global::crash();
                        };
                        let dep: &Dependency = &catalog.values()[dep_idx];

                        // Zig: `try allocator.dupe(u8, literal.slice(buf))`.
                        let literal =
                            pack_bump().alloc_slice_copy(dep.version.literal.slice(map_buf));
                        dependency.value =
                            Some(Expr::init(E::EString::init(literal), Default::default()));
                    }
                }
            }
        }
    }

    let has_trailing_newline = !json.source.contents.is_empty()
        && json.source.contents[json.source.contents.len() - 1] == b'\n';
    let mut buffer_writer = js_printer::BufferWriter::init();
    buffer_writer
        .buffer
        .list
        .reserve(json.source.contents.len() + 1);
    // TODO(port): ensureTotalCapacity → reserve(n - len) per guide; len==0 here
    buffer_writer.append_newline = has_trailing_newline;
    let mut package_json_writer = js_printer::BufferPrinter::init(buffer_writer);

    let written = match js_printer::print_json(
        &mut package_json_writer,
        // `print_json` is monomorphized over the full T4 `Expr`; lift the T2
        // value-subset root (lossless — every T2 variant maps 1:1).
        bun_ast::Expr::from(json.root),
        // shouldn't be used
        &json.source,
        js_printer::PrintJsonOptions {
            indent: json.indentation,
            mangled_props: None,
            ..Default::default()
        },
    ) {
        Ok(w) => w,
        Err(err) => {
            if err == bun_core::err!("OutOfMemory") {
                return Err(AllocError);
            }
            Output::err_generic(
                "failed to print edited package.json: {}",
                format_args!("{}", err.name()),
            );
            Global::crash();
        }
    };
    let _ = written;

    Ok(package_json_writer
        .ctx
        .written_without_trailing_zero()
        .into())
    // TODO(port): return type ownership — Zig returned a borrowed slice into
    // package_json_writer's internal buffer; here boxed.
}

// ───────────────────────────────────────────────────────────────────────────
// Pattern
// ───────────────────────────────────────────────────────────────────────────

/// A glob pattern used to ignore or include files in the project tree.
/// Might come from .npmignore, .gitignore, or `files` in package.json
// PORT NOTE: `CowSliceZ<u8>` is not `Clone`; manual borrow via `as_positive`.
pub struct Pattern {
    pub glob: CowString,
    pub flags: PatternFlags,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct PatternFlags: u8 {
        /// beginning or middle slash (leading slash was trimmed)
        const REL_PATH = 1 << 0;
        /// can only match directories (had an ending slash, also trimmed)
        const DIRS_ONLY = 1 << 1;
        const LEADING_DOUBLESTAR_SLASH = 1 << 2;
        /// true if the pattern starts with `!`
        const NEGATED = 1 << 3;
        // _: u4 padding implicit
    }
}

impl Pattern {
    pub fn from_utf8(pattern: &[u8]) -> Result<Option<Pattern>, AllocError> {
        let mut remain = pattern;
        let mut has_leading_doublestar_could_start_with_bang = false;
        let (has_leading_or_middle_slash, has_trailing_slash, add_negate) = 'check_slashes: {
            let before_length = remain.len();

            // strip `!` and add one if any existed
            while !remain.is_empty() && remain[0] == b'!' {
                remain = &remain[1..];
            }

            let skipped_negate = before_length != remain.len();

            if remain.is_empty() {
                return Ok(None);
            }

            // `**/foo` matches the same as `foo`
            if remain.starts_with(b"**/") {
                remain = &remain[b"**/".len()..];
                if remain.is_empty() {
                    return Ok(None);
                }
                has_leading_doublestar_could_start_with_bang = true;
            }

            let trailing_slash = remain[remain.len() - 1] == b'/';
            if trailing_slash {
                // trim trailing slash
                remain = &remain[..remain.len() - 1];
                if remain.is_empty() {
                    return Ok(None);
                }
            }

            let mut leading_or_middle_slash = remain[0] == b'/';
            if !leading_or_middle_slash {
                // check for middle slash
                if let Some(slash_index) = strings::index_of_char(remain, b'/') {
                    leading_or_middle_slash = (slash_index as usize) != remain.len() - 1;
                }
            } else {
                // trim leading slash
                remain = &remain[1..];
                if remain.is_empty() {
                    return Ok(None);
                }
            }

            break 'check_slashes (leading_or_middle_slash, trailing_slash, skipped_negate);
        };

        let length = remain.len() + (add_negate as usize);
        let mut buf = vec![0u8; length].into_boxed_slice();
        let start_index = add_negate as usize;
        let end = start_index + remain.len();
        buf[start_index..end].copy_from_slice(remain);
        if add_negate {
            buf[0] = b'!';
        }

        let mut flags = PatternFlags::empty();
        if has_leading_or_middle_slash {
            flags |= PatternFlags::REL_PATH;
        }
        if has_leading_doublestar_could_start_with_bang {
            flags |= PatternFlags::LEADING_DOUBLESTAR_SLASH;
        }
        if has_trailing_slash {
            flags |= PatternFlags::DIRS_ONLY;
        }
        if add_negate {
            flags |= PatternFlags::NEGATED;
        }

        Ok(Some(Pattern {
            glob: CowString::init_owned(buf),
            flags,
        }))
    }

    /// Invert a negated pattern to a positive pattern
    pub fn as_positive(&self) -> Pattern {
        debug_assert!(self.flags.contains(PatternFlags::NEGATED) && self.glob.length() > 0);
        Pattern {
            glob: self.glob.borrow_subslice(1, None), // remove the leading `!`
            flags: {
                let mut f = self.flags;
                f.remove(PatternFlags::NEGATED);
                f
            },
        }
    }
}

// deinit → Drop on CowString handles freeing

// ───────────────────────────────────────────────────────────────────────────
// IgnorePatterns
// ───────────────────────────────────────────────────────────────────────────

pub struct IgnorePatterns {
    pub list: Box<[Pattern]>,
    pub kind: IgnorePatternsKind,
    pub depth: usize,

    /// At least one of the patterns has a leading
    /// or middle slash. A relative path will need to
    /// be created
    pub has_rel_path: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum IgnorePatternsKind {
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

pub type IgnorePatternsList = Vec<IgnorePatterns>;

#[derive(Clone, Copy, strum::IntoStaticStr)]
enum IgnoreFileFailReason {
    #[strum(serialize = "read")]
    Read,
    #[strum(serialize = "open")]
    Open,
}

impl IgnorePatterns {
    fn ignore_file_fail(
        dir: &Dir,
        ignore_kind: IgnorePatternsKind,
        reason: IgnoreFileFailReason,
        err: bun_core::Error,
    ) -> ! {
        let mut buf = PathBuffer::uninit();
        let dir_path: &[u8] = match bun_sys::get_fd_path(Fd::from_std_dir(dir), &mut buf) {
            Ok(p) => &*p,
            Err(_) => b"",
        };
        Output::err(
            err,
            "failed to {} {} at: \"{}{}{}\"",
            format_args!(
                "{} {} {}{}{}",
                <&str>::from(reason),
                <&str>::from(ignore_kind),
                bstr::BStr::new(strings::without_trailing_slash(dir_path)),
                SEP_STR,
                <&str>::from(ignore_kind),
            ),
        );
        Global::crash();
    }

    fn trim_trailing_spaces(line: &[u8]) -> &[u8] {
        // TODO: copy this function
        // https://github.com/git/git/blob/17d4b10aea6bda2027047a0e3548a6f8ad667dde/dir.c#L986
        line
    }

    #[allow(dead_code)]
    fn maybe_trim_leading_spaces(line: &[u8]) -> &[u8] {
        // npm will trim, git will not
        line
    }

    /// ignore files are always ignored, don't need to worry about opening or reading twice
    pub fn read_from_disk(
        dir: &Dir,
        dir_depth: usize,
    ) -> Result<Option<IgnorePatterns>, AllocError> {
        let mut patterns: Vec<Pattern> = Vec::new();

        let mut ignore_kind = IgnorePatternsKind::Npmignore;

        let ignore_file: File = match File::openat(dir.fd(), b".npmignore", bun_sys::O::RDONLY, 0) {
            Ok(f) => f,
            Err(err) => 'ignore_file: {
                if err.get_errno() != bun_sys::E::ENOENT {
                    // Crash if the file exists and fails to open. Don't want to create a tarball
                    // with files you want to ignore.
                    Self::ignore_file_fail(
                        dir,
                        ignore_kind,
                        IgnoreFileFailReason::Open,
                        err.into(),
                    );
                }
                ignore_kind = IgnorePatternsKind::Gitignore;
                match File::openat(dir.fd(), b".gitignore", bun_sys::O::RDONLY, 0) {
                    Ok(f) => break 'ignore_file f,
                    Err(err2) => {
                        if err2.get_errno() != bun_sys::E::ENOENT {
                            Self::ignore_file_fail(
                                dir,
                                ignore_kind,
                                IgnoreFileFailReason::Open,
                                err2.into(),
                            );
                        }
                        return Ok(None);
                    }
                }
            }
        };

        let contents = match ignore_file.read_to_end() {
            Ok(c) => c,
            Err(err) => {
                Self::ignore_file_fail(dir, ignore_kind, IgnoreFileFailReason::Read, err.into());
            }
        };
        let _ = ignore_file.close();
        // contents freed by Drop

        let mut has_rel_path = false;

        for line in contents.split(|&b| b == b'\n') {
            if line.is_empty() {
                continue;
            }

            // comment
            if line[0] == b'#' {
                continue;
            }

            let trimmed = {
                let mut remain = line;
                if remain[remain.len() - 1] == b'\r' {
                    remain = &remain[..remain.len() - 1];
                }
                Self::trim_trailing_spaces(remain)
            };

            if trimmed.is_empty() {
                continue;
            }

            let Some(parsed) = Pattern::from_utf8(trimmed)? else {
                continue;
            };
            has_rel_path = has_rel_path || parsed.flags.contains(PatternFlags::REL_PATH);
            patterns.push(parsed);
        }

        if patterns.is_empty() {
            return Ok(None);
        }

        Ok(Some(IgnorePatterns {
            list: patterns.into_boxed_slice(),
            kind: ignore_kind,
            depth: dir_depth,
            has_rel_path,
        }))
    }
}

// deinit → Drop on Box<[Pattern]> + each Pattern's CowString

// ───────────────────────────────────────────────────────────────────────────
// printArchivedFilesAndPackages
// ───────────────────────────────────────────────────────────────────────────

// TODO(port): Zig used `comptime is_dry_run: bool` to vary the param type
// (`*PackQueue` vs `PackList`). Using a small enum wrapper.
enum PackListOrQueue<'a> {
    Queue(&'a mut PackQueue),
    List(&'a PackList),
}

fn print_archived_files_and_packages<const IS_DRY_RUN: bool>(
    ctx: &mut Context<'_>,
    root_dir_std: &Dir,
    pack_list: PackListOrQueue<'_>,
    package_json_len: usize,
) {
    let root_dir = Fd::from_std_dir(root_dir_std);
    if ctx.manager.options.log_level == LogLevel::Silent
        || ctx.manager.options.log_level == LogLevel::Quiet
    {
        return;
    }
    if IS_DRY_RUN {
        let PackListOrQueue::Queue(pack_queue) = pack_list else {
            unreachable!()
        };

        let package_json_stat = match bun_sys::fstatat(root_dir, bun_core::zstr!("package.json")) {
            Ok(s) => s,
            Err(err) => {
                Output::err(
                    bun_core::Error::from(err),
                    "failed to stat package.json",
                    format_args!(""),
                );
                Global::crash();
            }
        };

        ctx.stats.unpacked_size += usize::try_from(package_json_stat.st_size).expect("int cast");

        Output::prettyln(format_args!(
            "\n<r><b><cyan>packed<r> {} {}",
            bun_fmt::size(
                usize::try_from(package_json_stat.st_size).expect("int cast"),
                bun_fmt::SizeFormatterOptions {
                    space_between_number_and_unit: false
                }
            ),
            "package.json",
        ));

        while let Some(item) = pack_queue.remove_or_null() {
            let stat = match bun_sys::fstatat(root_dir, &item.path) {
                Ok(s) => s,
                Err(err) => {
                    if item.optional {
                        ctx.stats.total_files -= 1;
                        continue;
                    }
                    Output::err(
                        bun_core::Error::from(err),
                        "failed to stat file: \"{}\"",
                        format_args!("{}", bstr::BStr::new(item.path.as_bytes())),
                    );
                    Global::crash();
                }
            };

            ctx.stats.unpacked_size += usize::try_from(stat.st_size).expect("int cast");

            Output::prettyln(format_args!(
                "<r><b><cyan>packed<r> {} {}",
                bun_fmt::size(
                    usize::try_from(stat.st_size).expect("int cast"),
                    bun_fmt::SizeFormatterOptions {
                        space_between_number_and_unit: false
                    }
                ),
                bstr::BStr::new(item.path.as_bytes()),
            ));
        }

        for dep in &ctx.bundled_deps {
            if !dep.was_packed {
                continue;
            }
            Output::prettyln(format_args!(
                "<r><b><green>bundled<r> {}",
                bstr::BStr::new(&dep.name)
            ));
        }

        Output::flush();
        return;
    }

    let PackListOrQueue::List(pack_list) = pack_list else {
        unreachable!()
    };

    Output::prettyln(format_args!(
        "\n<r><b><cyan>packed<r> {} {}",
        bun_fmt::size(
            package_json_len,
            bun_fmt::SizeFormatterOptions {
                space_between_number_and_unit: false
            }
        ),
        "package.json",
    ));

    for entry in pack_list.iter() {
        Output::prettyln(format_args!(
            "<r><b><cyan>packed<r> {} {}",
            bun_fmt::size(
                entry.size,
                bun_fmt::SizeFormatterOptions {
                    space_between_number_and_unit: false
                }
            ),
            bstr::BStr::new(entry.subpath.as_bytes()),
        ));
    }

    for dep in &ctx.bundled_deps {
        if !dep.was_packed {
            continue;
        }
        Output::prettyln(format_args!(
            "<r><b><green>bundled<r> {}",
            bstr::BStr::new(&dep.name)
        ));
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
    // PORT NOTE: Zig's `Environment.isLinux` (builtin.target.os.tag == .linux)
    // is true on Android too; Rust splits these into distinct target_os values.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        a == b
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        strings::eql_case_insensitive_ascii_check_length(a, b)
    }
}

#[inline]
fn is_special_file_or_variant(filename: &[u8], name: &'static [u8]) -> bool {
    // PERF(port): Zig used `inline` switch arms for comptime-known length
    // ranges. Runtime branches here are equivalent for these tiny comparisons.
    if filename.len() < name.len() {
        false
    } else if filename.len() == name.len() {
        strings_eql(filename, name)
    } else if filename.len() == name.len() + 1 {
        false
    } else {
        // SAFETY: filename.len() > name.len() + 1 by above branches
        debug_assert!(filename.len() > name.len() + 1);
        filename[name.len()] == b'.' && strings_eql(&filename[..name.len()], name)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// JS bindings
// ───────────────────────────────────────────────────────────────────────────

pub mod bindings {
    use super::*;
    use bun_core::String as BunString;
    use bun_jsc::{
        CallFrame, JSArray, JSGlobalObject, JSObject, JSValue, JsResult, StringJsc as _,
        bun_string_jsc,
    };

    #[bun_jsc::host_fn]
    pub fn js_read_tarball(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = call_frame.arguments_old::<1>();
        let args = arguments.slice();
        if args.len() < 1 || !args[0].is_string() {
            return Err(global.throw(format_args!("expected tarball path string argument")));
        }

        let tarball_path_str = args[0].to_bun_string(global)?;
        // deref handled by Drop on BunString

        let tarball_path = tarball_path_str.to_utf8();

        let tarball_file = match bun_sys::open_file(tarball_path.slice(), Default::default()) {
            Ok(f) => f,
            Err(err) => {
                return Err(global.throw(format_args!(
                    "failed to open tarball file \"{}\": {}",
                    bstr::BStr::new(tarball_path.slice()),
                    bun_core::Error::from(err).name(),
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
                    bun_core::Error::from(err).name(),
                )));
            }
        };
        let _ = tarball_file.close();
        // tarball freed by Drop

        let mut sha1_digest: [u8; sha::SHA1::DIGEST] = [0; sha::SHA1::DIGEST];
        let mut sha1 = sha::SHA1::init();
        sha1.update(&tarball);
        sha1.r#final(&mut sha1_digest);
        let shasum_str = BunString::create_format(format_args!(
            "{}",
            bun_fmt::bytes_to_hex_lower_string(&sha1_digest)
        ));
        // bun.handleOom → infallible / panic-on-OOM

        let mut sha512_digest: [u8; sha::SHA512::DIGEST] = [0; sha::SHA512::DIGEST];
        let mut sha512 = sha::SHA512::init();
        sha512.update(&tarball);
        sha512.r#final(&mut sha512_digest);
        let base64_buf = bun_base64::encode_alloc(&sha512_digest);
        let integrity_value = bun_string_jsc::create_utf8_for_js(global, &base64_buf)?;

        struct EntryInfo {
            pathname: BunString,
            kind: BunString,
            perm: bun_sys::Mode,
            size: Option<usize>,
            contents: Option<BunString>,
        }
        let mut entries_info: Vec<EntryInfo> = Vec::new();

        let archive = Archive::read_new();

        match archive.read_support_format_tar() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return Err(global.throw(format_args!(
                    "failed to support tar: {}",
                    bstr::BStr::new(archive.error_string())
                )));
            }
            _ => {}
        }
        match archive.read_support_format_gnutar() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return Err(global.throw(format_args!(
                    "failed to support gnutar: {}",
                    bstr::BStr::new(archive.error_string())
                )));
            }
            _ => {}
        }
        match archive.read_support_filter_gzip() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return Err(global.throw(format_args!(
                    "failed to support gzip compression: {}",
                    bstr::BStr::new(archive.error_string())
                )));
            }
            _ => {}
        }

        match archive.read_set_options(c"read_concatenated_archives") {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return Err(global.throw(format_args!(
                    "failed to set read_concatenated_archives option: {}",
                    bstr::BStr::new(archive.error_string())
                )));
            }
            _ => {}
        }

        match archive.read_open_memory(&tarball) {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return Err(global.throw(format_args!(
                    "failed to open archive in memory: {}",
                    bstr::BStr::new(archive.error_string())
                )));
            }
            _ => {}
        }

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
                        // bun.handleOom — panic on OOM
                        let result = bun::handle_oom(strings::to_utf8_list_with_type(
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
                        kind: BunString::static_(file_kind_tag(kind)),
                        perm,
                        size: None,
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

        match archive.read_close() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return Err(global.throw(format_args!(
                    "failed to close read archive: {}",
                    bstr::BStr::new(archive.error_string())
                )));
            }
            _ => {}
        }
        match archive.read_free() {
            ArchiveResult::Failed | ArchiveResult::Fatal | ArchiveResult::Warn => {
                return Err(global.throw(format_args!(
                    "failed to close read archive: {}",
                    bstr::BStr::new(archive.error_string())
                )));
            }
            _ => {}
        }

        let entries = JSArray::create_empty(global, entries_info.len())?;

        for (i, entry) in entries_info.iter().enumerate() {
            let obj = JSValue::create_empty_object(global, 0);
            obj.put(global, b"pathname", entry.pathname.to_js(global)?);
            obj.put(global, b"kind", entry.kind.to_js(global)?);
            obj.put(global, b"perm", JSValue::js_number(f64::from(entry.perm)));
            if let Some(contents) = &entry.contents {
                obj.put(global, b"contents", contents.to_js(global)?);
            }
            entries.put_index(global, u32::try_from(i).expect("int cast"), obj)?;
        }

        let result = JSValue::create_empty_object(global, 4);
        result.put(global, b"entries", entries);
        result.put(global, b"size", JSValue::js_number(tarball.len() as f64));
        result.put(global, b"shasum", shasum_str.to_js(global)?);
        result.put(global, b"integrity", integrity_value);

        Ok(result)
    }
}

// ported from: src/cli/pack_command.zig
