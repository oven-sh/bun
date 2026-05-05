use core::ffi::c_char;
use core::fmt;
use std::io::Write as _;

use bun_alloc::AllocError;
use crate::cli::Command;
use crate::cli::publish_command as Publish;
use bun_collections::{PriorityQueue, StringHashMap};
use bun_core::{self as bun, Global, Output, Progress, fmt as bun_fmt};
use bun_glob as glob;
use bun_install::{Dependency, Lockfile, PackageManager};
use bun_install::package_manager::options::LogLevel;
use bun_interchange::json as JSON;
use bun_js_parser::{E, Expr};
use bun_js_printer as js_printer;
use bun_libarchive::lib::Archive;
use bun_paths::{self as path, PathBuffer, SEP_STR};
use bun_ptr::CowString;
use bun_semver as Semver;
use bun_sha as sha;
use bun_str::{ZStr, strings};
use bun_sys::{self, DirIterator, Fd, File, Dir};
use crate::cli::run_command::RunCommand;

// type aliases matching Zig `string`/`stringZ`
// (used as `&[u8]` / `&ZStr` at fn boundaries; owned forms use Box<[u8]> / Box<ZStr>)

pub struct PackCommand;

// ───────────────────────────────────────────────────────────────────────────
// Context
// ───────────────────────────────────────────────────────────────────────────

pub struct Context<'a> {
    pub manager: &'a mut PackageManager,
    // allocator param dropped — global mimalloc (see PORTING.md §Allocators)
    pub command_ctx: Command::Context,

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
            Output::prettyln("\n<r><b><blue>Total files<r>: {}", format_args!("{}", stats.total_files));
            if let Some(shasum) = maybe_shasum {
                Output::prettyln(
                    "<b><blue>Shasum<r>: {}",
                    format_args!("{}", bun_fmt::bytes_to_hex_lower(shasum)),
                );
            }
            if let Some(integrity) = maybe_integrity {
                Output::prettyln(
                    "<b><blue>Integrity<r>: {}",
                    format_args!("{}", bun_fmt::integrity(integrity, bun_fmt::IntegrityStyle::Short)),
                );
            }
            Output::prettyln(
                "<b><blue>Unpacked size<r>: {}",
                format_args!("{}", bun_fmt::size(stats.unpacked_size, bun_fmt::SizeOpts { space_between_number_and_unit: false })),
            );
            if stats.packed_size > 0 {
                Output::pretty(
                    "<b><blue>Packed size<r>: {}\n",
                    format_args!("{}", bun_fmt::size(stats.packed_size, bun_fmt::SizeOpts { space_between_number_and_unit: false })),
                );
            }
            if stats.bundled_deps > 0 {
                Output::pretty("<b><blue>Bundled deps<r>: {}\n", format_args!("{}", stats.bundled_deps));
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
    pub fn exec_with_manager(ctx: Command::Context, manager: &mut PackageManager) -> Result<(), bun_core::Error> {
        if manager.options.log_level != LogLevel::Silent && manager.options.log_level != LogLevel::Quiet {
            Output::prettyln(
                concat!("<r><b>bun pack <r><d>v", env!("BUN_PACKAGE_JSON_VERSION_WITH_SHA"), "<r>"),
                format_args!(""),
            );
            // TODO(port): Global::package_json_version_with_sha as compile-time constant
            Output::flush();
        }

        let mut lockfile = Lockfile::default(); // TODO(port): `undefined` initialization
        let load_from_disk_result = lockfile.load_from_cwd(manager, &manager.log, false);

        let lockfile_ref: Option<&Lockfile> = match load_from_disk_result {
            bun_install::LoadResult::Ok(ok) => Some(ok.lockfile),
            bun_install::LoadResult::Err(cause) => 'err: {
                use bun_install::LoadStep;
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
                    LoadStep::ParseFile => Output::err_generic(
                        "failed to parse lockfile: {}",
                        format_args!("{}", cause.value.name()),
                    ),
                    LoadStep::ReadFile => Output::err_generic(
                        "failed to read lockfile: {}",
                        format_args!("{}", cause.value.name()),
                    ),
                    LoadStep::Migrating => Output::err_generic(
                        "failed to migrate lockfile: {}",
                        format_args!("{}", cause.value.name()),
                    ),
                }

                if manager.log.has_errors() {
                    manager.log.print(Output::error_writer())?;
                }

                Global::crash();
            }
            _ => None,
        };

        let mut pack_ctx = Context {
            manager,
            command_ctx: ctx,
            lockfile: lockfile_ref,
            bundled_deps: Vec::new(),
            stats: Stats::default(),
        };

        // var arena = std.heap.ArenaAllocator.init(ctx.allocator);
        // defer arena.deinit();

        // if (manager.options.filter_patterns.len > 0) {
        //     // TODO: --filter
        //     // loop, convert, find matching workspaces, then pack each
        //     return;
        // }

        // just pack the current workspace
        let original_path = pack_ctx.manager.original_package_json_path.clone();
        // PORT NOTE: reshaped for borrowck — cloned path before passing &mut pack_ctx
        if let Err(err) = pack::<false>(&mut pack_ctx, &original_path) {
            match err {
                PackError::OutOfMemory => bun_core::out_of_memory(),
                PackError::MissingPackageName | PackError::MissingPackageVersion => {
                    Output::err_generic("package.json must have `name` and `version` fields", format_args!(""));
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
                        format_args!("{}", bstr::BStr::new(&pack_ctx.manager.original_package_json_path)),
                    );
                    Global::crash();
                }
                #[allow(unreachable_patterns)]
                _ => unreachable!(),
            }
        }
        Ok(())
    }

    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        let cli = PackageManager::CommandLineArguments::parse(PackageManager::Subcommand::Pack)?;

        let (manager, original_cwd) = match PackageManager::init(&ctx, cli, PackageManager::Subcommand::Pack) {
            Ok(v) => v,
            Err(err) => {
                if !cli.silent {
                    if err == bun_core::err!("MissingPackageJSON") {
                        let mut cwd_buf = PathBuffer::uninit();
                        match bun_sys::getcwd(&mut cwd_buf) {
                            Ok(cwd) => Output::err_generic(
                                "failed to find project package.json from: \"{}\"",
                                format_args!("{}", bstr::BStr::new(cwd)),
                            ),
                            Err(_) => {
                                Output::err_generic("failed to find project package.json", format_args!(""));
                                Global::crash();
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
        let _ = original_cwd; // freed by Drop

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
    subpath: Box<ZStr>, // TODO(port): lifetime — owned NUL-terminated path
    size: usize,
}
type PackList = Vec<PackListEntry>;

#[derive(Clone)]
struct PackQueueItem {
    path: Box<ZStr>, // TODO(port): owned [:0]const u8; allocated via entry_subpath
    optional: bool,
}

impl Default for PackQueueItem {
    fn default() -> Self {
        Self { path: ZStr::empty().into(), optional: false }
    }
}

// TODO(port): std.PriorityQueue with strings.order comparator → min-heap by path.
// Using bun_collections::PriorityQueue<PackQueueItem> with a custom comparator.
type PackQueue = PriorityQueue<PackQueueItem, fn(&PackQueueItem, &PackQueueItem) -> core::cmp::Ordering>;

fn pack_queue_less_than(a: &PackQueueItem, b: &PackQueueItem) -> core::cmp::Ordering {
    strings::order(a.path.as_bytes(), b.path.as_bytes())
}

fn new_pack_queue() -> PackQueue {
    PriorityQueue::new(pack_queue_less_than)
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
        let DirInfo(mut dir, dir_subpath, dir_depth) = dir_info;
        let close_guard = scopeguard::guard((), |_| {
            if dir_depth != 1 {
                dir.close();
            }
        });
        // TODO(port): errdefer-style close — scopeguard captures `dir` by ref;
        // Phase B should make Dir RAII.

        let mut dir_iter = DirIterator::iterate(Fd::from_std_dir(&dir), DirIterator::Encoding::U8);
        'next_entry: while let Some(entry) = dir_iter.next().unwrap().ok().flatten() {
            // TODO(port): `.unwrap() catch null` → on iterator error, treat as end
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice();
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

                if entry.kind == bun_sys::FileKind::File && is_unconditionally_included_file(entry_name) {
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
                    let match_path: &[u8] = if include.flags.contains(PatternFlags::LEADING_DOUBLESTAR_SLASH) {
                        entry_name
                    } else {
                        entry_subpath.as_bytes()
                    };
                    match glob::match_(include.glob.slice(), match_path) {
                        glob::MatchResult::Match => included = true,
                        glob::MatchResult::NegateNoMatch | glob::MatchResult::NegateMatch => unreachable!(),
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

                    let match_path: &[u8] = if exclude.flags.contains(PatternFlags::LEADING_DOUBLESTAR_SLASH) {
                        entry_name
                    } else {
                        entry_subpath.as_bytes()
                    };
                    // NOTE: These patterns have `!` so `.match` logic is
                    // inverted here
                    match glob::match_(exclude.glob.slice(), match_path) {
                        glob::MatchResult::NegateNoMatch => included = false,
                        _ => {}
                    }
                }
            }

            // TODO: do not traverse directories that match patterns
            // excluding all files within them (e.g. `!test/**`)
            if !included {
                if entry.kind == bun_sys::FileKind::Directory {
                    for bin in bins {
                        if bin.ty == BinType::Dir && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true) {
                            continue 'next_entry;
                        }
                    }
                    let subdir = open_subdir(&dir, entry_name, &entry_subpath);
                    dirs.push(DirInfo(subdir, entry_subpath.as_bytes().into(), dir_depth + 1));
                }

                continue;
            }

            match entry.kind {
                bun_sys::FileKind::Directory => {
                    for bin in bins {
                        if bin.ty == BinType::Dir && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true) {
                            continue 'next_entry;
                        }
                    }
                    let subdir = open_subdir(&dir, entry_name, &entry_subpath);
                    included_dirs.push(DirInfo(subdir, entry_subpath.as_bytes().into(), dir_depth + 1));
                }
                bun_sys::FileKind::File => {
                    let dedupe_entry = subpath_dedupe.get_or_put(entry_subpath.as_bytes())?;
                    debug_assert!(!dedupe_entry.found_existing);
                    if dedupe_entry.found_existing {
                        continue;
                    }

                    for bin in bins {
                        if bin.ty == BinType::File && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true) {
                            continue 'next_entry;
                        }
                    }

                    pack_queue.add(PackQueueItem { path: entry_subpath, optional: false })?;
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
            list: negated_excludes.clone().into_boxed_slice(),
            // TODO(port): Zig stored a borrowed slice into `negated_excludes`;
            // here cloned to satisfy ownership. PERF(port): avoid clone.
            kind: IgnorePatternsKind::PackageJson,
            depth: 1,
            // always assume no relative path b/c matching is done from the
            // root directory
            has_rel_path: false,
        });
    }

    while let Some(dir_info) = dirs.pop() {
        let DirInfo(mut dir, dir_subpath, dir_depth) = dir_info;
        let _close = scopeguard::guard((), |_| dir.close());
        // TODO(port): RAII Dir close

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

        let mut iter = DirIterator::iterate(Fd::from_std_dir(&dir), DirIterator::Encoding::U8);
        'next_entry: while let Some(entry) = iter.next().unwrap().ok().flatten() {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice();
            let entry_subpath = entry_subpath(&dir_subpath, entry_name)?;

            if dir_depth == root_depth {
                if entry.kind == bun_sys::FileKind::Directory && entry_name == b"node_modules" {
                    continue;
                }
            }

            if let Some((pattern, kind)) = is_excluded(&entry, &entry_subpath, dir_depth, &ignores) {
                if log_level.is_verbose() {
                    Output::prettyln(
                        "<r><blue>ignore<r> <d>[{}:{}]<r> {}{}",
                        format_args!(
                            "{}:{} {}{}",
                            <&str>::from(kind),
                            bstr::BStr::new(pattern),
                            bstr::BStr::new(entry_subpath.as_bytes()),
                            if entry.kind == bun_sys::FileKind::Directory { "/" } else { "" },
                        ),
                    );
                    // TODO(port): Output::prettyln format-string handling differs; Phase B fixup
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
                        if bin.ty == BinType::File && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true) {
                            continue 'next_entry;
                        }
                    }
                    pack_queue.add(PackQueueItem { path: entry_subpath, optional: false })?;
                }
                bun_sys::FileKind::Directory => {
                    for bin in bins {
                        if bin.ty == BinType::Dir && strings::eql_long(&bin.path, entry_subpath.as_bytes(), true) {
                            continue 'next_entry;
                        }
                    }

                    let subdir = open_subdir(&dir, entry_name, &entry_subpath);

                    dirs.push(DirInfo(subdir, entry_subpath.as_bytes().into(), dir_depth + 1));
                }
                _ => unreachable!(),
            }
        }
    }

    Ok(())
}

fn open_subdir(dir: &Dir, entry_name: &[u8], entry_subpath: &ZStr) -> Dir {
    match dir.open_dir_z(entry_name_z(entry_name, entry_subpath), bun_sys::OpenDirOptions { iterate: true }) {
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

fn entry_subpath(dir_subpath: &[u8], entry_name: &[u8]) -> Result<Box<ZStr>, AllocError> {
    // std.fmt.allocPrintSentinel(allocator, "{s}{s}{s}", ..., 0)
    let sep: &[u8] = if dir_subpath.is_empty() { b"" } else { b"/" };
    let mut buf = Vec::with_capacity(dir_subpath.len() + sep.len() + entry_name.len() + 1);
    buf.extend_from_slice(dir_subpath);
    buf.extend_from_slice(sep);
    buf.extend_from_slice(entry_name);
    buf.push(0);
    let len = buf.len() - 1;
    // SAFETY: buf[len] == 0 written above
    Ok(unsafe { ZStr::from_boxed_with_nul(buf.into_boxed_slice(), len) })
    // TODO(port): exact ZStr boxed-construction API
}

fn entry_name_z<'a>(entry_name: &[u8], entry_subpath: &'a ZStr) -> &'a ZStr {
    // doing this because `entry_subpath` has a sentinel and we don't trust `entry.name.sliceAssumeZ()`
    let bytes = entry_subpath.as_bytes();
    let start = bytes.len() - entry_name.len();
    // SAFETY: entry_subpath is NUL-terminated; the suffix starting at `start`
    // has length `entry_name.len()` and shares the same trailing NUL.
    unsafe { ZStr::from_raw(bytes.as_ptr().add(start), entry_name.len()) }
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

    let mut dir = match root_dir.open_dir_z(ZStr::from_lit(b"node_modules\0"), bun_sys::OpenDirOptions { iterate: true }) {
        Ok(d) => d,
        Err(err) => {
            // ignore node_modules if it isn't a directory, or doesn't exist
            if err == bun_core::err!("NotDir") || err == bun_core::err!("FileNotFound") {
                return Ok(bundled_pack_queue);
            }
            Output::err(err, "failed to open \"node_modules\" to pack bundled dependencies", format_args!(""));
            Global::crash();
        }
    };
    let _close = scopeguard::guard((), |_| dir.close());

    // A set of bundled dependency locations
    // - node_modules/is-even
    // - node_modules/is-even/node_modules/is-odd
    // - node_modules/is-odd
    // - ...
    let mut dedupe: StringHashMap<()> = StringHashMap::new();

    let mut additional_bundled_deps: Vec<DirInfo> = Vec::new();

    let mut iter = DirIterator::iterate(Fd::from_std_dir(&dir), DirIterator::Encoding::U8);
    while let Some(entry) = iter.next().unwrap().ok().flatten() {
        if entry.kind != bun_sys::FileKind::Directory {
            continue;
        }

        let _entry_name = entry.name.slice();

        if strings::starts_with_char(_entry_name, b'@') {
            let concat = entry_subpath(b"node_modules", _entry_name)?;

            let mut scoped_dir = match root_dir.open_dir_z(&concat, bun_sys::OpenDirOptions { iterate: true }) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let _close_scoped = scopeguard::guard((), |_| scoped_dir.close());

            let mut scoped_iter = DirIterator::iterate(Fd::from_std_dir(&scoped_dir), DirIterator::Encoding::U8);
            while let Some(sub_entry) = scoped_iter.next().unwrap().ok().flatten() {
                let entry_name = entry_subpath(_entry_name, sub_entry.name.slice())?;

                for dep in ctx.bundled_deps.iter_mut() {
                    debug_assert!(dep.from_root_package_json);
                    if !strings::eql_long(entry_name.as_bytes(), &dep.name, true) {
                        continue;
                    }

                    let entry_subpath_ = entry_subpath(b"node_modules", entry_name.as_bytes())?;

                    let dedupe_entry = dedupe.get_or_put(entry_subpath_.as_bytes())?;
                    if dedupe_entry.found_existing {
                        // already got to it in `add_bundled_dep` below
                        dep.was_packed = true;
                        break;
                    }

                    let subdir = open_subdir(&dir, entry_name.as_bytes(), &entry_subpath_);
                    dep.was_packed = true;
                    add_bundled_dep(
                        ctx,
                        root_dir,
                        DirInfo(subdir, entry_subpath_.as_bytes().into(), 2),
                        &mut bundled_pack_queue,
                        &mut dedupe,
                        &mut additional_bundled_deps,
                        log_level,
                    )?;

                    break;
                }
            }
        } else {
            let entry_name = _entry_name;
            for dep in ctx.bundled_deps.iter_mut() {
                debug_assert!(dep.from_root_package_json);
                if !strings::eql_long(entry_name, &dep.name, true) {
                    continue;
                }

                let entry_subpath_ = entry_subpath(b"node_modules", entry_name)?;

                let dedupe_entry = dedupe.get_or_put(entry_subpath_.as_bytes())?;
                if dedupe_entry.found_existing {
                    // already got to it in `add_bundled_dep` below
                    dep.was_packed = true;
                    break;
                }

                let subdir = open_subdir(&dir, entry_name, &entry_subpath_);
                dep.was_packed = true;
                add_bundled_dep(
                    ctx,
                    root_dir,
                    DirInfo(subdir, entry_subpath_.as_bytes().into(), 2),
                    &mut bundled_pack_queue,
                    &mut dedupe,
                    &mut additional_bundled_deps,
                    log_level,
                )?;

                break;
            }
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
        let DirInfo(mut dir, dir_subpath, dir_depth) = dir_info;
        let _close = scopeguard::guard((), |_| dir.close());

        let mut iter = DirIterator::iterate(Fd::from_std_dir(&dir), DirIterator::Encoding::U8);
        while let Some(entry) = iter.next().unwrap().ok().flatten() {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice();
            let entry_subpath_ = entry_subpath(&dir_subpath, entry_name)?;

            if dir_depth == bundled_root_depth {
                'root_depth: {
                    if entry_name == b"package.json" {
                        if entry.kind != bun_sys::FileKind::File {
                            break 'root_depth;
                        }
                        // find more dependencies to bundle
                        let source = match File::to_source_at(&dir, entry_name_z(entry_name, &entry_subpath_), Default::default()).unwrap() {
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

                        let json = match JSON::parse_package_json_utf8(&source, &mut ctx.manager.log) {
                            Ok(j) => j,
                            Err(_) => break 'root_depth,
                        };

                        // for each dependency in `dependencies` find the closest node_modules folder
                        // with the dependency name as a dir entry, starting from the node_modules of the
                        // current bundled dependency

                        for dependency_group in [b"dependencies".as_slice(), b"optionalDependencies".as_slice()] {
                            let Some(dependencies_expr) = json.get(dependency_group) else { continue };
                            let Expr::Data::EObject(dependencies) = &dependencies_expr.data else { continue };
                            // TODO(port): Expr.data tagged-union pattern match shape

                            'next_dep: for dep in dependencies.properties.slice() {
                                if dep.key.is_none() {
                                    continue;
                                }
                                if dep.value.is_none() {
                                    continue;
                                }

                                let Some(dep_name) = dep.key.as_ref().unwrap().as_string() else { continue };

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
                                    ZStr::from_raw_mut(dep_subpath_buf.as_mut_ptr(), dep_subpath_buf.len() - 1)
                                };

                                // starting at `node_modules/is-even/node_modules/is-odd`
                                let mut dep_dir_depth: usize = bundled_root_depth + 2;

                                match root_dir.open_dir_z(dep_subpath, bun_sys::OpenDirOptions { iterate: true }) {
                                    Ok(dep_dir) => {
                                        let dedupe_entry = dedupe.get_or_put(dep_subpath.as_bytes())?;
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

                                        while let Some(node_modules_start) =
                                            strings::last_index_of(&dep_subpath_buf[..remain_end], b"node_modules")
                                        {
                                            dep_dir_depth -= 2;
                                            let node_modules_end = node_modules_start + b"node_modules".len();
                                            dep_subpath_buf[node_modules_end] = b'/';
                                            dep_subpath_buf[node_modules_end + 1..][..dep_name.len()]
                                                .copy_from_slice(dep_name);
                                            dep_subpath_buf[node_modules_end + 1 + dep_name.len()] = 0;
                                            let parent_len = node_modules_end + 1 + dep_name.len();
                                            // SAFETY: NUL at parent_len written above
                                            let parent_dep_subpath: &ZStr = unsafe {
                                                ZStr::from_raw(dep_subpath_buf.as_ptr(), parent_len)
                                            };
                                            remain_end = node_modules_start;

                                            let parent_dep_dir = match root_dir.open_dir_z(
                                                parent_dep_subpath,
                                                bun_sys::OpenDirOptions { iterate: true },
                                            ) {
                                                Ok(d) => d,
                                                Err(_) => continue,
                                            };

                                            let dedupe_entry = dedupe.get_or_put(parent_dep_subpath.as_bytes())?;
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
                    Output::prettyln(
                        "<r><blue>ignore<r> <d>[{}:{}]<r> {}{}",
                        format_args!(
                            "{}:{} {}{}",
                            <&str>::from(kind),
                            bstr::BStr::new(pattern),
                            bstr::BStr::new(entry_subpath_.as_bytes()),
                            if entry.kind == bun_sys::FileKind::Directory { "/" } else { "" },
                        ),
                    );
                    Output::flush();
                }
                continue;
            }

            match entry.kind {
                bun_sys::FileKind::File => {
                    bundled_pack_queue.add(PackQueueItem { path: entry_subpath_, optional: false })?;
                }
                bun_sys::FileKind::Directory => {
                    let subdir = open_subdir(&dir, entry_name, &entry_subpath_);

                    dirs.push(DirInfo(subdir, entry_subpath_.as_bytes().into(), dir_depth + 1));
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
        let DirInfo(mut dir, dir_subpath, dir_depth) = dir_info;
        let _close = scopeguard::guard((), |_| {
            if dir_depth != 1 {
                dir.close();
            }
        });

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

        let mut dir_iter = DirIterator::iterate(Fd::from_std_dir(&dir), DirIterator::Encoding::U8);
        'next_entry: while let Some(entry) = dir_iter.next().unwrap().ok().flatten() {
            if entry.kind != bun_sys::FileKind::File && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let entry_name = entry.name.slice();
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

            if let Some((pattern, kind)) = is_excluded(&entry, &entry_subpath_, dir_depth, &ignores) {
                if log_level.is_verbose() {
                    Output::prettyln(
                        "<r><blue>ignore<r> <d>[{}:{}]<r> {}{}",
                        format_args!(
                            "{}:{} {}{}",
                            <&str>::from(kind),
                            bstr::BStr::new(pattern),
                            bstr::BStr::new(entry_subpath_.as_bytes()),
                            if entry.kind == bun_sys::FileKind::Directory { "/" } else { "" },
                        ),
                    );
                    Output::flush();
                }
                continue;
            }

            match entry.kind {
                bun_sys::FileKind::File => {
                    debug_assert!(!entry_subpath_.as_bytes().is_empty());
                    for bin in bins {
                        if bin.ty == BinType::File && strings::eql_long(&bin.path, entry_subpath_.as_bytes(), true) {
                            continue 'next_entry;
                        }
                    }
                    pack_queue.add(PackQueueItem { path: entry_subpath_, optional: false })?;
                }
                bun_sys::FileKind::Directory => {
                    for bin in bins {
                        if bin.ty == BinType::Dir && strings::eql_long(&bin.path, entry_subpath_.as_bytes(), true) {
                            continue 'next_entry;
                        }
                    }

                    let subdir = open_subdir(&dir, entry_name, &entry_subpath_);

                    dirs.push(DirInfo(subdir, entry_subpath_.as_bytes().into(), dir_depth + 1));
                }
                _ => unreachable!(),
            }
        }
    }

    Ok(())
}

fn get_bundled_deps(json: &Expr, field: &'static str) -> Result<Option<Vec<BundledDep>>, AllocError> {
    let mut deps: Vec<BundledDep> = Vec::new();
    let Some(bundled_deps) = json.get(field.as_bytes()) else { return Ok(None) };

    'invalid_field: {
        match &bundled_deps.data {
            Expr::Data::EArray(_) => {
                let Some(mut iter) = bundled_deps.as_array() else { return Ok(Some(Vec::new())) };

                while let Some(bundled_dep_item) = iter.next() {
                    let Some(bundled_dep) = bundled_dep_item.as_string_cloned()? else {
                        break 'invalid_field;
                    };
                    deps.push(BundledDep {
                        name: bundled_dep,
                        was_packed: false,
                        from_root_package_json: true,
                    });
                }
            }
            Expr::Data::EBoolean(_) => {
                let Some(b) = bundled_deps.as_bool() else { return Ok(Some(Vec::new())) };
                if !b == true {
                    return Ok(Some(Vec::new()));
                }

                if let Some(dependencies_expr) = json.get(b"dependencies") {
                    if let Expr::Data::EObject(dependencies) = &dependencies_expr.data {
                        for dependency in dependencies.properties.slice() {
                            if dependency.key.is_none() {
                                continue;
                            }
                            if dependency.value.is_none() {
                                continue;
                            }

                            let Some(bundled_dep) = dependency.key.as_ref().unwrap().as_string_cloned()? else {
                                break 'invalid_field;
                            };
                            deps.push(BundledDep {
                                name: bundled_dep,
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
    path: Box<ZStr>,
    ty: BinType,
}

fn get_package_bins(json: &Expr) -> Result<Vec<BinInfo>, AllocError> {
    let mut bins: Vec<BinInfo> = Vec::new();

    let mut path_buf = PathBuffer::uninit();

    if let Some(bin) = json.as_property(b"bin") {
        if let Some(bin_str) = bin.expr.as_string() {
            let normalized = path::normalize_buf(bin_str, &mut path_buf, path::Style::Posix);
            bins.push(BinInfo {
                path: ZStr::from_bytes(normalized),
                ty: BinType::File,
            });
            return Ok(bins);
        }

        if let Expr::Data::EObject(bin_obj) = &bin.expr.data {
            if bin_obj.properties.len() == 0 {
                return Ok(Vec::new());
            }

            for bin_prop in bin_obj.properties.slice() {
                if let Some(bin_prop_value) = &bin_prop.value {
                    if let Some(bin_str) = bin_prop_value.as_string() {
                        let normalized = path::normalize_buf(bin_str, &mut path_buf, path::Style::Posix);
                        bins.push(BinInfo {
                            path: ZStr::from_bytes(normalized),
                            ty: BinType::File,
                        });
                    }
                }
            }
        }

        return Ok(bins);
    }

    if let Some(directories) = json.as_property(b"directories") {
        if let Expr::Data::EObject(directories_obj) = &directories.expr.data {
            if let Some(bin) = directories_obj.as_property(b"bin") {
                if let Some(bin_str) = bin.expr.as_string() {
                    let normalized = path::normalize_buf(bin_str, &mut path_buf, path::Style::Posix);
                    bins.push(BinInfo {
                        path: ZStr::from_bytes(normalized),
                        ty: BinType::Dir,
                    });
                }
            }
        }
    }

    Ok(bins)
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
    let entry_name = entry.name.slice();

    if dir_depth == 1 {
        // first, check files that can never be ignored. project root
        // directory only
        if is_unconditionally_included_file(entry_name) || is_special_file_or_variant(entry_name, b"CHANGELOG") {
            return None;
        }

        // check default ignores that only apply to the root project directory
        for &pattern in ROOT_DEFAULT_IGNORE_PATTERNS {
            match glob::match_(pattern, entry_name) {
                glob::MatchResult::Match => {
                    // cannot be reversed
                    return Some((pattern, IgnorePatternsKind::Default));
                }
                glob::MatchResult::NoMatch => {}
                // default patterns don't use `!`
                glob::MatchResult::NegateNoMatch | glob::MatchResult::NegateMatch => unreachable!(),
            }
        }
    }

    let mut ignore_pattern: &[u8] = &[];
    let mut ignore_kind: IgnorePatternsKind = IgnorePatternsKind::Npmignore;

    // then check default ignore list. None of the defaults contain slashes
    // so just match against entry name
    let mut ignored = false;

    for &(pattern, can_override) in DEFAULT_IGNORE_PATTERNS {
        match glob::match_(pattern, entry_name) {
            glob::MatchResult::Match => {
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
            glob::MatchResult::NoMatch => {}
            // default patterns don't use `!`
            glob::MatchResult::NegateNoMatch | glob::MatchResult::NegateMatch => unreachable!(),
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
            if pattern.flags.contains(PatternFlags::DIRS_ONLY) && entry.kind != bun_sys::FileKind::Directory {
                continue;
            }

            let match_path = if pattern.flags.contains(PatternFlags::REL_PATH) { rel } else { entry_name };
            match glob::match_(pattern.glob.slice(), match_path) {
                glob::MatchResult::Match => {
                    ignored = true;
                    ignore_pattern = pattern.glob.slice();
                    ignore_kind = ignore.kind;
                }
                glob::MatchResult::NegateNoMatch => ignored = false,
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

// TODO(port): bun.deprecated.BufferedReader(512KiB, File.Reader)
type BufferedFileReader = bun_io::BufferedReader<{ 1024 * 512 }, bun_sys::FileReader>;

// ───────────────────────────────────────────────────────────────────────────
// pack()
// ───────────────────────────────────────────────────────────────────────────

// TODO(port): Zig used `comptime for_publish: bool` to vary the return type
// (`Publish.Context(true)` vs `void`). Rust const generics cannot vary return
// type directly; using an associated-type-like Option for now. Phase B: split
// into `pack()` and `pack_for_publish()` or use a trait.
pub type PackReturn<const FOR_PUBLISH: bool> = Option<Publish::Context<true>>;

pub fn pack<const FOR_PUBLISH: bool>(
    ctx: &mut Context<'_>,
    abs_package_json_path: &ZStr,
) -> Result<PackReturn<FOR_PUBLISH>, PackError<FOR_PUBLISH>> {
    let manager = &mut *ctx.manager;
    let log_level = manager.options.log_level;
    let mut json = match manager.workspace_package_json_cache.get_with_path(
        &mut manager.log,
        abs_package_json_path,
        bun_install::WorkspacePackageJSONCache::GetOptions { guess_indentation: true },
    ) {
        bun_install::GetJsonResult::ReadErr(err) => {
            Output::err(err, "failed to read package.json: {}", format_args!("{}", bstr::BStr::new(abs_package_json_path.as_bytes())));
            Global::crash();
        }
        bun_install::GetJsonResult::ParseErr(err) => {
            Output::err(err, "failed to parse package.json: {}", format_args!("{}", bstr::BStr::new(abs_package_json_path.as_bytes())));
            let _ = manager.log.print(Output::error_writer());
            Global::crash();
        }
        bun_install::GetJsonResult::Entry(entry) => entry,
    };

    if FOR_PUBLISH {
        if let Some(config) = json.root.get(b"publishConfig") {
            if manager.options.publish_config.tag.is_empty() {
                if let Some(tag) = config.get_string_cloned(b"tag")? {
                    manager.options.publish_config.tag = tag;
                }
            }
            if manager.options.publish_config.access.is_none() {
                if let Some(access) = config.get_string(b"access")? {
                    match PackageManager::Options::Access::from_str(access.0) {
                        Some(a) => manager.options.publish_config.access = Some(a),
                        None => {
                            Output::err_generic("invalid `access` value: '{}'", format_args!("{}", bstr::BStr::new(access.0)));
                            Global::crash();
                        }
                    }
                }
            }
        }

        // maybe otp
    }

    let mut package_name_expr: Expr = json.root.get(b"name").ok_or(PackError::MissingPackageName)?;
    let mut package_name = package_name_expr.as_string_cloned()?.ok_or(PackError::InvalidPackageName)?;
    if FOR_PUBLISH {
        let is_scoped = Dependency::is_scoped_package_name(&package_name)?;
        if let Some(access) = manager.options.publish_config.access {
            if access == PackageManager::Options::Access::Restricted && !is_scoped {
                return Err(PackError::RestrictedUnscopedPackage);
            }
        }
    }
    // defer if (!for_publish) free(package_name) — handled by Drop
    if package_name.is_empty() {
        return Err(PackError::InvalidPackageName);
    }

    let mut package_version_expr: Expr = json.root.get(b"version").ok_or(PackError::MissingPackageVersion)?;
    let mut package_version = package_version_expr.as_string_cloned()?.ok_or(PackError::InvalidPackageVersion)?;
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

    let mut this_transpiler = bun_bundler::Transpiler::default(); // TODO(port): undefined init

    if let Err(err) = RunCommand::configure_env_for_run(
        &ctx.command_ctx,
        &mut this_transpiler,
        &manager.env,
        manager.options.log_level != LogLevel::Silent,
        false,
    ) {
        if err == bun_core::err!("OutOfMemory") {
            return Err(PackError::OutOfMemory);
        }
        Output::err_generic("failed to run pack scripts due to error: {}\n", format_args!("{}", err.name()));
        Global::crash();
    }

    let abs_workspace_path: &[u8] = strings::without_trailing_slash(
        strings::without_suffix(abs_package_json_path.as_bytes(), b"package.json"),
    );
    manager.env.map.put(b"npm_command", b"pack")?;

    let (postpack_script, publish_script, postpublish_script, ran_scripts): (
        Option<Box<[u8]>>,
        Option<Box<[u8]>>,
        Option<Box<[u8]>>,
        bool,
    ) = 'post_scripts: {
        // --ignore-scripts
        if !manager.options.do_.run_scripts {
            break 'post_scripts (None, None, None, false);
        }

        let Some(scripts) = json.root.as_property(b"scripts") else {
            break 'post_scripts (None, None, None, false);
        };
        if !matches!(scripts.expr.data, Expr::Data::EObject(_)) {
            break 'post_scripts (None, None, None, false);
        }

        // Track whether any scripts ran that could modify package.json
        let mut did_run_scripts = false;

        if FOR_PUBLISH {
            if let Some(prepublish_only_script_str) = scripts.expr.get(b"prepublishOnly") {
                if let Some(prepublish_only) = prepublish_only_script_str.as_string() {
                    did_run_scripts = true;
                    run_lifecycle_script(
                        ctx,
                        prepublish_only,
                        b"prepublishOnly",
                        abs_workspace_path,
                        &this_transpiler.env,
                        manager.options.log_level == LogLevel::Silent,
                    )?;
                }
            }
        }

        if let Some(prepack_script) = scripts.expr.get(b"prepack") {
            if let Some(prepack_script_str) = prepack_script.as_string() {
                did_run_scripts = true;
                run_lifecycle_script(
                    ctx,
                    prepack_script_str,
                    b"prepack",
                    abs_workspace_path,
                    &this_transpiler.env,
                    manager.options.log_level == LogLevel::Silent,
                )?;
            }
        }

        if let Some(prepare_script) = scripts.expr.get(b"prepare") {
            if let Some(prepare_script_str) = prepare_script.as_string() {
                did_run_scripts = true;
                run_lifecycle_script(
                    ctx,
                    prepare_script_str,
                    b"prepare",
                    abs_workspace_path,
                    &this_transpiler.env,
                    manager.options.log_level == LogLevel::Silent,
                )?;
            }
        }

        let mut postpack_script: Option<Box<[u8]>> = None;
        if let Some(postpack) = scripts.expr.get(b"postpack") {
            postpack_script = postpack.as_string().map(Box::from);
        }

        if FOR_PUBLISH {
            let mut publish_script: Option<Box<[u8]>> = None;
            let mut postpublish_script: Option<Box<[u8]>> = None;
            if let Some(publish) = scripts.expr.get(b"publish") {
                publish_script = publish.as_string_cloned()?;
            }
            if let Some(postpublish) = scripts.expr.get(b"postpublish") {
                postpublish_script = postpublish.as_string_cloned()?;
            }

            break 'post_scripts (postpack_script, publish_script, postpublish_script, did_run_scripts);
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
        let _ = manager.workspace_package_json_cache.map.remove(cache_key);

        // Re-read package.json from disk
        json = match manager.workspace_package_json_cache.get_with_path(
            &mut manager.log,
            abs_package_json_path,
            bun_install::WorkspacePackageJSONCache::GetOptions { guess_indentation: true },
        ) {
            bun_install::GetJsonResult::ReadErr(err) => {
                Output::err(err, "failed to read package.json: {}", format_args!("{}", bstr::BStr::new(abs_package_json_path.as_bytes())));
                Global::crash();
            }
            bun_install::GetJsonResult::ParseErr(err) => {
                Output::err(err, "failed to parse package.json: {}", format_args!("{}", bstr::BStr::new(abs_package_json_path.as_bytes())));
                let _ = manager.log.print(Output::error_writer());
                Global::crash();
            }
            bun_install::GetJsonResult::Entry(entry) => entry,
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
        package_name_expr = json.root.get(b"name").ok_or(PackError::MissingPackageName)?;
        package_name = package_name_expr.as_string_cloned()?.ok_or(PackError::InvalidPackageName)?;
        if package_name.is_empty() {
            return Err(PackError::InvalidPackageName);
        }

        package_version_expr = json.root.get(b"version").ok_or(PackError::MissingPackageVersion)?;
        package_version = package_version_expr.as_string_cloned()?.ok_or(PackError::InvalidPackageVersion)?;
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
        let z = unsafe { ZStr::from_raw(path_buf.as_ptr(), abs_workspace_path.len()) };
        match Dir::open_absolute_z(z, bun_sys::OpenDirOptions { iterate: true }) {
            Ok(d) => break 'root_dir d,
            Err(err) => {
                Output::err(err, "failed to open root directory: {}\n", format_args!("{}", bstr::BStr::new(abs_workspace_path)));
                Global::crash();
            }
        }
    };
    let _close_root = scopeguard::guard((), |_| root_dir.close());

    ctx.bundled_deps = get_bundled_deps(&json.root, "bundledDependencies")?
        .or_else(|| get_bundled_deps(&json.root, "bundleDependencies").ok().flatten())
        // TODO(port): second `?` short-circuits differently than `orelse try`; Phase B verify
        .unwrap_or_default();

    let mut pack_queue: PackQueue = new_pack_queue();

    let bins = get_package_bins(&json.root)?;
    // defer free(bin.path) — handled by Drop on Vec<BinInfo>

    for bin in &bins {
        match bin.ty {
            BinType::File => {
                pack_queue.add(PackQueueItem { path: bin.path.clone(), optional: true })?;
                // TODO(port): Zig pushed a borrowed slice; cloning here
            }
            BinType::Dir => {
                let bin_dir = match root_dir.open_dir(bin.path.as_bytes(), bun_sys::OpenDirOptions { iterate: true }) {
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
                        if let Some(file_entry_str) = files_entry.as_string() {
                            let normalized = path::normalize_buf(file_entry_str, &mut path_buf, path::Style::Posix);
                            let Some(parsed) = Pattern::from_utf8(normalized)? else { continue };
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

            Output::err_generic("expected `files` to be an array of string values", format_args!(""));
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

    if manager.options.dry_run {
        // don't create the tarball, but run scripts if they exist

        print_archived_files_and_packages::<true>(ctx, &root_dir, PackListOrQueue::Queue(&mut pack_queue), 0);

        if !FOR_PUBLISH {
            if manager.options.pack_destination.is_empty() && manager.options.pack_filename.is_empty() {
                Output::pretty("\n{}\n", format_args!("{}", fmt_tarball_filename(&package_name, &package_version, TarballNameStyle::Normalize)));
            } else {
                let mut dest_buf = PathBuffer::uninit();
                let (abs_tarball_dest, _) = tarball_destination(
                    &ctx.manager.options.pack_destination,
                    &ctx.manager.options.pack_filename,
                    abs_workspace_path,
                    &package_name,
                    &package_version,
                    dest_buf.as_mut_slice(),
                );
                Output::pretty("\n{}\n", format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())));
            }
        }

        Context::print_summary(ctx.stats, None, None, log_level);

        if let Some(postpack_script_str) = &postpack_script {
            run_lifecycle_script(
                ctx,
                postpack_script_str,
                b"postpack",
                abs_workspace_path,
                &manager.env,
                manager.options.log_level == LogLevel::Silent,
            )?;
        }

        if FOR_PUBLISH {
            let mut dest_buf = PathBuffer::uninit();
            let (abs_tarball_dest, _) = tarball_destination(
                &ctx.manager.options.pack_destination,
                &ctx.manager.options.pack_filename,
                abs_workspace_path,
                &package_name,
                &package_version,
                dest_buf.as_mut_slice(),
            );
            return Ok(Some(Publish::Context {
                command_ctx: ctx.command_ctx.clone(),
                manager: ctx.manager,
                package_name,
                package_version,
                abs_tarball_path: ZStr::from_bytes(abs_tarball_dest.as_bytes()),
                tarball_bytes: Box::from(&b""[..]),
                shasum: Default::default(), // undefined
                integrity: Default::default(), // undefined
                uses_workspaces: false,
                publish_script,
                postpublish_script,
                script_env: this_transpiler.env,
                normalized_pkg_info: Box::from(&b""[..]),
            }));
            // TODO(port): Publish::Context field shapes
        }

        return Ok(None);
    }

    let mut print_buf: Vec<u8> = Vec::new();

    let archive = Archive::write_new();

    match archive.write_set_format_pax_restricted() {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("failed to set archive format: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            Global::crash();
        }
        _ => {}
    }
    match archive.write_add_filter_gzip() {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("failed to set archive compression to gzip: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            Global::crash();
        }
        _ => {}
    }

    // default is 9
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L12
    let compression_level: &[u8] = manager.options.pack_gzip_level.as_deref().unwrap_or(b"9");
    write!(&mut print_buf, "{}\x00", bstr::BStr::new(compression_level)).expect("OOM");
    // SAFETY: print_buf[compression_level.len()] == 0 written above
    let level_z = unsafe { ZStr::from_raw(print_buf.as_ptr(), compression_level.len()) };
    match archive.write_set_filter_option(None, ZStr::from_lit(b"compression-level\0"), level_z) {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("compression level must be between 0 and 9, received {}", format_args!("{}", bstr::BStr::new(compression_level)));
            Global::crash();
        }
        _ => {}
    }
    print_buf.clear();

    match archive.write_set_filter_option(None, ZStr::from_lit(b"os\0"), ZStr::from_lit(b"Unknown\0")) {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("failed to set os to `Unknown`: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            Global::crash();
        }
        _ => {}
    }

    match archive.write_set_options(ZStr::from_lit(b"gzip:!timestamp\0")) {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("failed to unset gzip timestamp option: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            Global::crash();
        }
        _ => {}
    }

    let mut dest_buf = PathBuffer::uninit();
    let (abs_tarball_dest, abs_tarball_dest_dir_end) = tarball_destination(
        &ctx.manager.options.pack_destination,
        &ctx.manager.options.pack_filename,
        abs_workspace_path,
        &package_name,
        &package_version,
        dest_buf.as_mut_slice(),
    );
    // PORT NOTE: reshaped for borrowck — abs_tarball_dest borrows dest_buf
    let abs_tarball_dest_len = abs_tarball_dest.as_bytes().len();

    {
        // create the directory if it doesn't exist
        let most_likely_a_slash = dest_buf[abs_tarball_dest_dir_end];
        dest_buf[abs_tarball_dest_dir_end] = 0;
        // SAFETY: NUL written above
        let abs_tarball_dest_dir = unsafe { ZStr::from_raw(dest_buf.as_ptr(), abs_tarball_dest_dir_end) };
        let _ = bun_sys::make_path(Fd::cwd(), abs_tarball_dest_dir.as_bytes());
        dest_buf[abs_tarball_dest_dir_end] = most_likely_a_slash;
    }

    // SAFETY: dest_buf[abs_tarball_dest_len] == 0 (written by tarball_destination)
    let abs_tarball_dest = unsafe { ZStr::from_raw(dest_buf.as_ptr(), abs_tarball_dest_len) };

    // TODO: experiment with `archive.writeOpenMemory()`
    match archive.write_open_filename(abs_tarball_dest) {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("failed to open tarball file destination: \"{}\"", format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())));
            Global::crash();
        }
        _ => {}
    }

    // append removed items from `pack_queue` with their file size
    let mut pack_list: PackList = Vec::new();

    let mut read_buf = [0u8; 8192];
    let mut file_reader: Box<BufferedFileReader> = Box::new(BufferedFileReader::default());
    // TODO(port): Zig used allocator.create + manual init; Box::new equivalent

    let mut entry = Archive::Entry::new2(archive);

    {
        let mut progress = Progress::default();
        let mut node: Option<&mut Progress::Node> = None;
        if log_level.show_progress() {
            progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
            node = Some(progress.start(b"", pack_queue.count() + bundled_pack_queue.count() + 1));
            node.as_mut().unwrap().unit = Progress::Unit::Files;
        }
        let _end = scopeguard::guard((), |_| {
            if log_level.show_progress() {
                if let Some(n) = node.as_mut() {
                    n.end();
                }
            }
        });
        // TODO(port): scopeguard borrows of `node`; Phase B reshape

        entry = archive_package_json(ctx, archive, entry, &root_dir, &edited_package_json)?;
        if log_level.show_progress() {
            node.as_mut().unwrap().complete_one();
        }

        while let Some(item) = pack_queue.remove_or_null() {
            let _complete = scopeguard::guard((), |_| {
                if log_level.show_progress() {
                    if let Some(n) = node.as_mut() {
                        n.complete_one();
                    }
                }
            });
            // TODO(port): defer-in-loop with mutable borrow; Phase B reshape

            let file = match bun_sys::openat(Fd::from_std_dir(&root_dir), &item.path, bun_sys::O::RDONLY, 0).unwrap() {
                Ok(f) => f,
                Err(err) => {
                    if item.optional {
                        ctx.stats.total_files -= 1;
                        continue;
                    }
                    Output::err(err, "failed to open file: \"{}\"", format_args!("{}", bstr::BStr::new(item.path.as_bytes())));
                    Global::crash();
                }
            };

            let fd = match file.make_libuv_owned_for_syscall(bun_sys::Syscall::Open, bun_sys::OnFail::CloseOnFail).unwrap() {
                Ok(fd) => fd,
                Err(err) => {
                    Output::err(err, "failed to open file: \"{}\"", format_args!("{}", bstr::BStr::new(item.path.as_bytes())));
                    Global::crash();
                }
            };

            let _close_fd = scopeguard::guard((), |_| fd.close());

            let stat = match bun_sys::sys_uv::fstat(fd).unwrap() {
                Ok(s) => s,
                Err(err) => {
                    Output::err(err, "failed to stat file: \"{}\"", format_args!("{}", bstr::BStr::new(item.path.as_bytes())));
                    Global::crash();
                }
            };

            pack_list.push(PackListEntry {
                subpath: item.path.clone(),
                size: usize::try_from(stat.size).unwrap(),
            });

            entry = add_archive_entry(
                ctx,
                fd,
                &stat,
                &item.path,
                &mut read_buf,
                &mut file_reader,
                archive,
                entry,
                &mut print_buf,
                &bins,
            )?;
        }

        while let Some(item) = bundled_pack_queue.remove_or_null() {
            let _complete = scopeguard::guard((), |_| {
                if log_level.show_progress() {
                    if let Some(n) = node.as_mut() {
                        n.complete_one();
                    }
                }
            });
            // TODO(port): same defer-in-loop borrow caveat

            let file = match File::openat(Fd::from_std_dir(&root_dir), &item.path, bun_sys::O::RDONLY, 0).unwrap() {
                Ok(f) => f,
                Err(err) => {
                    if item.optional {
                        ctx.stats.total_files -= 1;
                        continue;
                    }
                    Output::err(err, "failed to open file: \"{}\"", format_args!("{}", bstr::BStr::new(item.path.as_bytes())));
                    Global::crash();
                }
            };
            let _close_file = scopeguard::guard((), |_| file.close());
            let stat = match file.stat().unwrap() {
                Ok(s) => s,
                Err(err) => {
                    Output::err(err, "failed to stat file: \"{}\"", format_args!("{}", file.handle));
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
                archive,
                entry,
                &mut print_buf,
                &bins,
            )?;
        }
    }

    entry.free();

    match archive.write_close() {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("failed to close archive: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            Global::crash();
        }
        _ => {}
    }

    match archive.write_free() {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("failed to free archive: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            Global::crash();
        }
        _ => {}
    }

    let mut shasum: [u8; sha::SHA1::DIGEST] = [0; sha::SHA1::DIGEST];
    let mut integrity: [u8; sha::SHA512::DIGEST] = [0; sha::SHA512::DIGEST];

    let tarball_bytes: Option<Vec<u8>> = 'tarball_bytes: {
        let tarball_file = match File::open(abs_tarball_dest, bun_sys::O::RDONLY, 0).unwrap() {
            Ok(f) => f,
            Err(err) => {
                Output::err(err, "failed to open tarball at: \"{}\"", format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())));
                Global::crash();
            }
        };
        let _close_tarball = scopeguard::guard((), |_| tarball_file.close());

        let mut sha1 = sha::SHA1::init();
        let mut sha512 = sha::SHA512::init();

        if FOR_PUBLISH {
            let bytes = match tarball_file.read_to_end().unwrap() {
                Ok(b) => b,
                Err(err) => {
                    Output::err(err, "failed to read tarball: \"{}\"", format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())));
                    Global::crash();
                }
            };

            sha1.update(&bytes);
            sha512.update(&bytes);

            sha1.final_(&mut shasum);
            sha512.final_(&mut integrity);

            ctx.stats.packed_size = bytes.len();

            break 'tarball_bytes Some(bytes);
        }

        *file_reader = BufferedFileReader::new(tarball_file.reader());

        let mut size: usize = 0;
        let mut read = match file_reader.read(&mut read_buf) {
            Ok(n) => n,
            Err(err) => {
                Output::err(err, "failed to read tarball: \"{}\"", format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())));
                Global::crash();
            }
        };
        while read > 0 {
            sha1.update(&read_buf[..read]);
            sha512.update(&read_buf[..read]);
            size += read;
            read = match file_reader.read(&mut read_buf) {
                Ok(n) => n,
                Err(err) => {
                    Output::err(err, "failed to read tarball: \"{}\"", format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())));
                    Global::crash();
                }
            };
        }

        sha1.final_(&mut shasum);
        sha512.final_(&mut integrity);

        ctx.stats.packed_size = size;
        None
    };

    let normalized_pkg_info: Option<Box<[u8]>> = if FOR_PUBLISH {
        Some(Publish::normalized_package(
            manager,
            &package_name,
            &package_version,
            &mut json.root,
            &json.source,
            &shasum,
            &integrity,
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
        if manager.options.pack_destination.is_empty() && manager.options.pack_filename.is_empty() {
            Output::pretty("\n{}\n", format_args!("{}", fmt_tarball_filename(&package_name, &package_version, TarballNameStyle::Normalize)));
        } else {
            Output::pretty("\n{}\n", format_args!("{}", bstr::BStr::new(abs_tarball_dest.as_bytes())));
        }
    }

    Context::print_summary(ctx.stats, Some(&shasum), Some(&integrity), log_level);

    if FOR_PUBLISH {
        Output::flush();
    }

    if let Some(postpack_script_str) = &postpack_script {
        Output::pretty("\n", format_args!(""));
        run_lifecycle_script(
            ctx,
            postpack_script_str,
            b"postpack",
            abs_workspace_path,
            &manager.env,
            manager.options.log_level == LogLevel::Silent,
        )?;
    }

    if FOR_PUBLISH {
        return Ok(Some(Publish::Context {
            command_ctx: ctx.command_ctx.clone(),
            manager: ctx.manager,
            package_name,
            package_version,
            abs_tarball_path: ZStr::from_bytes(abs_tarball_dest.as_bytes()),
            tarball_bytes: tarball_bytes.unwrap().into_boxed_slice(),
            shasum,
            integrity,
            uses_workspaces: false,
            publish_script,
            postpublish_script,
            script_env: this_transpiler.env,
            normalized_pkg_info: normalized_pkg_info.unwrap(),
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
    env: &bun_env::Loader,
    silent: bool,
) -> Result<(), PackError<FOR_PUBLISH>> {
    match RunCommand::run_package_script_foreground(
        &ctx.command_ctx,
        script,
        name,
        abs_workspace_path,
        env,
        &[],
        silent,
        ctx.command_ctx.debug.use_system_shell,
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
        return (
            unsafe { ZStr::from_raw(dest_buf.as_ptr(), tarball_name_len - 1) },
            0,
        );
    } else {
        let tarball_destination_dir = path::join_abs_string_buf(
            abs_workspace_path,
            dest_buf,
            &[pack_destination],
            path::Style::Auto,
        );
        let dir_len_trimmed = strings::without_trailing_slash(tarball_destination_dir).len();
        let dir_len_full = tarball_destination_dir.len();

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
                    bstr::BStr::new(strings::without_trailing_slash(tarball_destination_dir)),
                    fmt_tarball_filename(package_name, package_version, TarballNameStyle::Normalize),
                ),
            );
            Global::crash();
        }
        let tarball_name_len = usize::try_from(cursor.position()).unwrap();

        // SAFETY: NUL is the final byte written
        return (
            unsafe { ZStr::from_raw(dest_buf.as_ptr(), dir_len_trimmed + tarball_name_len - 1) },
            dir_len_full,
        );
    }
}

pub fn fmt_tarball_filename<'a>(
    package_name: &'a [u8],
    package_version: &'a [u8],
    style: TarballNameStyle,
) -> TarballNameFormatter<'a> {
    TarballNameFormatter { package_name, package_version, style }
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
    entry: &mut Archive::Entry,
    root_dir: &Dir,
    edited_package_json: &[u8],
) -> Result<&mut Archive::Entry, AllocError> {
    // TODO(port): return type — Zig returns *Archive.Entry (same pointer after .clear())
    let stat = match bun_sys::fstatat(Fd::from_std_dir(root_dir), ZStr::from_lit(b"package.json\0")).unwrap() {
        Ok(s) => s,
        Err(err) => {
            Output::err(err, "failed to stat package.json", format_args!(""));
            Global::crash();
        }
    };

    entry.set_pathname(ZStr::from_lit(b"package/package.json\0"));
    // TODO(port): PACKAGE_PREFIX ++ "package.json" comptime concat
    entry.set_size(i64::try_from(edited_package_json.len()).unwrap());
    // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
    entry.set_filetype(0o100000);
    entry.set_perm(u32::try_from(stat.mode).unwrap());
    // '1985-10-26T08:15:00.000Z'
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
    entry.set_mtime(499162500, 0);

    match archive.write_header(entry) {
        Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
            Output::err_generic("failed to write tarball header: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            Global::crash();
        }
        _ => {}
    }

    ctx.stats.unpacked_size += usize::try_from(archive.write_data(edited_package_json)).unwrap();

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
    entry: &mut Archive::Entry,
    print_buf: &mut Vec<u8>,
    bins: &[BinInfo],
) -> Result<&mut Archive::Entry, AllocError> {
    // TODO(port): return type — same pointer-after-clear pattern as above
    write!(print_buf, "{}{}\x00", bstr::BStr::new(PACKAGE_PREFIX), bstr::BStr::new(filename.as_bytes())).expect("OOM");
    let pathname_len = PACKAGE_PREFIX.len() + filename.as_bytes().len();
    // SAFETY: print_buf[pathname_len] == 0 written above
    let pathname = unsafe { ZStr::from_raw(print_buf.as_ptr(), pathname_len) };
    #[cfg(windows)]
    entry.set_pathname_utf8(pathname);
    #[cfg(not(windows))]
    entry.set_pathname(pathname);
    print_buf.clear();

    entry.set_size(i64::try_from(stat.size).unwrap());

    // https://github.com/libarchive/libarchive/blob/898dc8319355b7e985f68a9819f182aaed61b53a/libarchive/archive_entry.h#L185
    entry.set_filetype(0o100000);

    let mut perm: bun_sys::Mode = bun_sys::Mode::try_from(stat.mode).unwrap();
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L20
    if is_package_bin(bins, filename.as_bytes()) {
        perm |= 0o111;
    }
    entry.set_perm(u32::try_from(perm).unwrap());

    // '1985-10-26T08:15:00.000Z'
    // https://github.com/npm/cli/blob/ec105f400281a5bfd17885de1ea3d54d0c231b27/node_modules/pacote/lib/util/tar-create-options.js#L28
    entry.set_mtime(499162500, 0);

    match archive.write_header(entry) {
        Archive::Status::Failed | Archive::Status::Fatal => {
            Output::err_generic("failed to write tarball header: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            Global::crash();
        }
        _ => {}
    }

    *file_reader = BufferedFileReader::new(File::from(file).reader());

    let mut read = match file_reader.read(read_buf) {
        Ok(n) => n,
        Err(err) => {
            Output::err(err, "failed to read file: \"{}\"", format_args!("{}", bstr::BStr::new(filename.as_bytes())));
            Global::crash();
        }
    };
    while read > 0 {
        ctx.stats.unpacked_size += usize::try_from(archive.write_data(&read_buf[..read])).unwrap();
        read = match file_reader.read(read_buf) {
            Ok(n) => n,
            Err(err) => {
                Output::err(err, "failed to read file: \"{}\"", format_args!("{}", bstr::BStr::new(filename.as_bytes())));
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
    json: &mut bun_install::WorkspacePackageJSONCache::MapEntry,
) -> Result<Box<[u8]>, AllocError> {
    for dependency_group in [
        b"dependencies".as_slice(),
        b"devDependencies".as_slice(),
        b"peerDependencies".as_slice(),
        b"optionalDependencies".as_slice(),
    ] {
        if let Some(dependencies_expr) = json.root.get(dependency_group) {
            if let Expr::Data::EObject(dependencies) = &dependencies_expr.data {
                for dependency in dependencies.properties.slice_mut() {
                    // TODO(port): Zig iterated `slice()` of `*dependency`; need mutable iter
                    if dependency.key.is_none() {
                        continue;
                    }
                    if dependency.value.is_none() {
                        continue;
                    }

                    let Some(package_spec) = dependency.value.as_ref().unwrap().as_string() else { continue };
                    if let Some(without_workspace_protocol) =
                        strings::without_prefix_if_possible(package_spec, b"workspace:")
                    {
                        // TODO: make semver parsing more strict. `^`, `~` are not valid
                        // (see Zig source for commented-out parsed/valid block)

                        if without_workspace_protocol.len() == 1 {
                            // TODO: this might be too strict
                            let c = without_workspace_protocol[0];
                            if c == b'^' || c == b'~' || c == b'*' {
                                let dependency_name = match dependency.key.as_ref().unwrap().as_string() {
                                    Some(n) => n,
                                    None => {
                                        Output::err_generic(
                                            "expected string value for dependency name in \"{}\"",
                                            format_args!("{}", bstr::BStr::new(dependency_group)),
                                        );
                                        Global::crash();
                                    }
                                };

                                'failed_to_resolve: {
                                    // find the current workspace version and append to package spec without `workspace:`
                                    let Some(lockfile) = maybe_lockfile else { break 'failed_to_resolve };

                                    let Some(workspace_version) = lockfile
                                        .workspace_versions
                                        .get(Semver::String::Builder::string_hash(dependency_name))
                                    else {
                                        break 'failed_to_resolve;
                                    };

                                    let prefix: &str = match c {
                                        b'^' => "^",
                                        b'~' => "~",
                                        b'*' => "",
                                        _ => unreachable!(),
                                    };
                                    let mut data: Vec<u8> = Vec::new();
                                    write!(
                                        &mut data,
                                        "{}{}",
                                        prefix,
                                        workspace_version.fmt(lockfile.buffers.string_bytes.as_slice()),
                                    )
                                    .expect("OOM");

                                    dependency.value = Some(Expr::allocate(
                                        E::String { data: data.into_boxed_slice() },
                                        Default::default(),
                                    ));
                                    // TODO(port): Expr::allocate signature

                                    continue;
                                }

                                // only produce this error only when we need to get the workspace version
                                Output::err_generic(
                                    "Failed to resolve workspace version for \"{}\" in `{}`. Run <cyan>`bun install`<r> and try again.",
                                    format_args!("{} {}", bstr::BStr::new(dependency_name), bstr::BStr::new(dependency_group)),
                                );
                                Global::crash();
                            }
                        }

                        dependency.value = Some(Expr::allocate(
                            E::String { data: Box::<[u8]>::from(without_workspace_protocol) },
                            Default::default(),
                        ));
                    } else if let Some(catalog_name_str) =
                        strings::without_prefix_if_possible(package_spec, b"catalog:")
                    {
                        let dep_name_str = dependency.key.as_ref().unwrap().as_string().unwrap();

                        let lockfile = match maybe_lockfile {
                            Some(l) => l,
                            None => {
                                Output::err_generic(
                                    "Failed to resolve catalog version for \"{}\" in `{}` (catalogs require a lockfile).",
                                    format_args!("{} {}", bstr::BStr::new(dep_name_str), bstr::BStr::new(dependency_group)),
                                );
                                Global::crash();
                            }
                        };

                        let catalog_name = Semver::String::init(catalog_name_str, catalog_name_str);

                        let catalog = match lockfile.catalogs.get_group(
                            lockfile.buffers.string_bytes.as_slice(),
                            catalog_name,
                            catalog_name_str,
                        ) {
                            Some(c) => c,
                            None => {
                                Output::err_generic(
                                    "Failed to resolve catalog version for \"{}\" in `{}` (no matching catalog).",
                                    format_args!("{} {}", bstr::BStr::new(dep_name_str), bstr::BStr::new(dependency_group)),
                                );
                                Global::crash();
                            }
                        };

                        let dep_name = Semver::String::init(dep_name_str, dep_name_str);

                        let dep = match catalog.get_context(
                            dep_name,
                            Semver::String::ArrayHashContext {
                                arg_buf: dep_name_str,
                                existing_buf: lockfile.buffers.string_bytes.as_slice(),
                            },
                        ) {
                            Some(d) => d,
                            None => {
                                Output::err_generic(
                                    "Failed to resolve catalog version for \"{}\" in `{}` (no matching catalog dependency).",
                                    format_args!("{} {}", bstr::BStr::new(dep_name_str), bstr::BStr::new(dependency_group)),
                                );
                                Global::crash();
                            }
                        };

                        dependency.value = Some(Expr::allocate(
                            E::String {
                                data: Box::<[u8]>::from(
                                    dep.version.literal.slice(lockfile.buffers.string_bytes.as_slice()),
                                ),
                            },
                            Default::default(),
                        ));
                    }
                }
            }
        }
    }

    let has_trailing_newline =
        !json.source.contents.is_empty() && json.source.contents[json.source.contents.len() - 1] == b'\n';
    let mut buffer_writer = js_printer::BufferWriter::init();
    buffer_writer.buffer.list.reserve(json.source.contents.len() + 1);
    // TODO(port): ensureTotalCapacity → reserve(n - len) per guide; len==0 here
    buffer_writer.append_newline = has_trailing_newline;
    let mut package_json_writer = js_printer::BufferPrinter::init(buffer_writer);

    let written = match js_printer::print_json(
        &mut package_json_writer,
        &json.root,
        // shouldn't be used
        &json.source,
        js_printer::PrintJsonOptions {
            indent: json.indentation,
            mangled_props: None,
        },
    ) {
        Ok(w) => w,
        Err(err) => {
            if err == bun_core::err!("OutOfMemory") {
                return Err(AllocError);
            }
            Output::err_generic("failed to print edited package.json: {}", format_args!("{}", err.name()));
            Global::crash();
        }
    };
    let _ = written;

    Ok(package_json_writer.ctx.written_without_trailing_zero().into())
    // TODO(port): return type ownership — Zig returned a borrowed slice into
    // package_json_writer's internal buffer; here boxed.
}

// ───────────────────────────────────────────────────────────────────────────
// Pattern
// ───────────────────────────────────────────────────────────────────────────

/// A glob pattern used to ignore or include files in the project tree.
/// Might come from .npmignore, .gitignore, or `files` in package.json
#[derive(Clone)]
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
    fn ignore_file_fail(dir: &Dir, ignore_kind: IgnorePatternsKind, reason: IgnoreFileFailReason, err: bun_core::Error) -> ! {
        let mut buf = PathBuffer::uninit();
        let dir_path = bun_sys::get_fd_path(Fd::from_std_dir(dir), &mut buf).unwrap_or(b"");
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
    pub fn read_from_disk(dir: &Dir, dir_depth: usize) -> Result<Option<IgnorePatterns>, AllocError> {
        let mut patterns: Vec<Pattern> = Vec::new();

        let mut ignore_kind = IgnorePatternsKind::Npmignore;

        let ignore_file = match dir.open_file_z(ZStr::from_lit(b".npmignore\0"), Default::default()) {
            Ok(f) => f,
            Err(err) => 'ignore_file: {
                if err != bun_core::err!("FileNotFound") {
                    // Crash if the file exists and fails to open. Don't want to create a tarball
                    // with files you want to ignore.
                    Self::ignore_file_fail(dir, ignore_kind, IgnoreFileFailReason::Open, err);
                }
                ignore_kind = IgnorePatternsKind::Gitignore;
                match dir.open_file_z(ZStr::from_lit(b".gitignore\0"), Default::default()) {
                    Ok(f) => break 'ignore_file f,
                    Err(err2) => {
                        if err2 != bun_core::err!("FileNotFound") {
                            Self::ignore_file_fail(dir, ignore_kind, IgnoreFileFailReason::Open, err2);
                        }
                        return Ok(None);
                    }
                }
            }
        };
        let _close = scopeguard::guard((), |_| ignore_file.close());

        let contents = match File::from(ignore_file).read_to_end().unwrap() {
            Ok(c) => c,
            Err(err) => {
                Self::ignore_file_fail(dir, ignore_kind, IgnoreFileFailReason::Read, err);
            }
        };
        // contents freed by Drop

        let mut has_rel_path = false;

        for line in contents.split(|&b| b == b'\n').filter(|s| !s.is_empty()) {
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

            let Some(parsed) = Pattern::from_utf8(trimmed)? else { continue };
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
    if ctx.manager.options.log_level == LogLevel::Silent || ctx.manager.options.log_level == LogLevel::Quiet {
        return;
    }
    const PACKED_FMT: &str = "<r><b><cyan>packed<r> {} {}";

    if IS_DRY_RUN {
        let PackListOrQueue::Queue(pack_queue) = pack_list else { unreachable!() };

        let package_json_stat = match root_dir.statat(ZStr::from_lit(b"package.json\0")).unwrap() {
            Ok(s) => s,
            Err(err) => {
                Output::err(err, "failed to stat package.json", format_args!(""));
                Global::crash();
            }
        };

        ctx.stats.unpacked_size += usize::try_from(package_json_stat.size).unwrap();

        Output::prettyln(
            concat!("\n", "<r><b><cyan>packed<r> {} {}"),
            format_args!(
                "{} {}",
                bun_fmt::size(usize::try_from(package_json_stat.size).unwrap(), bun_fmt::SizeOpts { space_between_number_and_unit: false }),
                "package.json",
            ),
        );

        while let Some(item) = pack_queue.remove_or_null() {
            let stat = match root_dir.statat(&item.path).unwrap() {
                Ok(s) => s,
                Err(err) => {
                    if item.optional {
                        ctx.stats.total_files -= 1;
                        continue;
                    }
                    Output::err(err, "failed to stat file: \"{}\"", format_args!("{}", bstr::BStr::new(item.path.as_bytes())));
                    Global::crash();
                }
            };

            ctx.stats.unpacked_size += usize::try_from(stat.size).unwrap();

            Output::prettyln(
                PACKED_FMT,
                format_args!(
                    "{} {}",
                    bun_fmt::size(usize::try_from(stat.size).unwrap(), bun_fmt::SizeOpts { space_between_number_and_unit: false }),
                    bstr::BStr::new(item.path.as_bytes()),
                ),
            );
        }

        for dep in &ctx.bundled_deps {
            if !dep.was_packed {
                continue;
            }
            Output::prettyln("<r><b><green>bundled<r> {}", format_args!("{}", bstr::BStr::new(&dep.name)));
        }

        Output::flush();
        return;
    }

    let PackListOrQueue::List(pack_list) = pack_list else { unreachable!() };

    Output::prettyln(
        concat!("\n", "<r><b><cyan>packed<r> {} {}"),
        format_args!(
            "{} {}",
            bun_fmt::size(package_json_len, bun_fmt::SizeOpts { space_between_number_and_unit: false }),
            "package.json",
        ),
    );

    for entry in pack_list.iter() {
        Output::prettyln(
            PACKED_FMT,
            format_args!(
                "{} {}",
                bun_fmt::size(entry.size, bun_fmt::SizeOpts { space_between_number_and_unit: false }),
                bstr::BStr::new(entry.subpath.as_bytes()),
            ),
        );
    }

    for dep in &ctx.bundled_deps {
        if !dep.was_packed {
            continue;
        }
        Output::prettyln("<r><b><green>bundled<r> {}", format_args!("{}", bstr::BStr::new(&dep.name)));
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
    #[cfg(target_os = "linux")]
    {
        a == b
    }
    #[cfg(not(target_os = "linux"))]
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
    use bun_jsc::{CallFrame, JSArray, JSGlobalObject, JSObject, JSValue, JsResult, ZigString};
    use bun_str::String as BunString;

    #[bun_jsc::host_fn]
    pub fn js_read_tarball(global: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old(1).slice();
        if args.len() < 1 || !args[0].is_string() {
            return global.throw("expected tarball path string argument", format_args!(""));
        }

        let tarball_path_str = args[0].to_bun_string(global)?;
        // deref handled by Drop on BunString

        let tarball_path = tarball_path_str.to_utf8();

        let tarball_file = match Dir::cwd().open_file(tarball_path.slice(), Default::default()) {
            // TODO(port): std.fs.cwd().openFile → bun_sys equivalent
            Ok(f) => File::from(f),
            Err(err) => {
                return global.throw(
                    "failed to open tarball file \"{}\": {}",
                    format_args!("{}: {}", bstr::BStr::new(tarball_path.slice()), err.name()),
                );
            }
        };
        let _close = scopeguard::guard((), |_| tarball_file.close());

        let tarball = match tarball_file.read_to_end().unwrap() {
            Ok(b) => b,
            Err(err) => {
                return global.throw(
                    "failed to read tarball contents \"{}\": {}",
                    format_args!("{}: {}", bstr::BStr::new(tarball_path.slice()), err.name()),
                );
            }
        };
        // tarball freed by Drop

        let mut sha1_digest: [u8; sha::SHA1::DIGEST] = [0; sha::SHA1::DIGEST];
        let mut sha1 = sha::SHA1::init();
        sha1.update(&tarball);
        sha1.final_(&mut sha1_digest);
        let shasum_str = BunString::create_format(format_args!("{}", bun_fmt::bytes_to_hex_lower(&sha1_digest)));
        // bun.handleOom → infallible / panic-on-OOM

        let mut sha512_digest: [u8; sha::SHA512::DIGEST] = [0; sha::SHA512::DIGEST];
        let mut sha512 = sha::SHA512::init();
        sha512.update(&tarball);
        sha512.final_(&mut sha512_digest);
        let mut base64_buf = vec![0u8; bun_base64::standard_encoded_len(sha::SHA512::DIGEST)];
        // TODO(port): comptime calcSize → const fn; using runtime helper
        let encode_count = bun_simdutf::base64::encode(&sha512_digest, &mut base64_buf, false);
        let integrity_value = BunString::create_utf8_for_js(global, &base64_buf[..encode_count])?;

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
            Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
                return global.throw("failed to support tar: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            }
            _ => {}
        }
        match archive.read_support_format_gnutar() {
            Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
                return global.throw("failed to support gnutar: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            }
            _ => {}
        }
        match archive.read_support_filter_gzip() {
            Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
                return global.throw("failed to support gzip compression: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            }
            _ => {}
        }

        match archive.read_set_options(ZStr::from_lit(b"read_concatenated_archives\0")) {
            Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
                return global.throw("failed to set read_concatenated_archives option: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            }
            _ => {}
        }

        match archive.read_open_memory(&tarball) {
            Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
                return global.throw("failed to open archive in memory: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            }
            _ => {}
        }

        let mut archive_entry: *mut Archive::Entry = core::ptr::null_mut();
        let mut header_status = archive.read_next_header(&mut archive_entry);

        let mut read_buf: Vec<u8> = Vec::new();

        while header_status != Archive::Status::Eof {
            match header_status {
                Archive::Status::Eof => unreachable!(),
                Archive::Status::Retry => {
                    header_status = archive.read_next_header(&mut archive_entry);
                    continue;
                }
                Archive::Status::Failed | Archive::Status::Fatal => {
                    return global.throw(
                        "failed to read archive header: {}",
                        format_args!("{}", bstr::BStr::new(Archive::error_string(archive.cast()))),
                        // TODO(port): @ptrCast(archive)
                    );
                }
                _ => {
                    // SAFETY: read_next_header set archive_entry on success
                    let archive_entry_ref = unsafe { &mut *archive_entry };
                    #[cfg(windows)]
                    let pathname_string = {
                        let pathname_w = archive_entry_ref.pathname_w();
                        let result = strings::to_utf8_list_with_type(Vec::new(), pathname_w);
                        // bun.handleOom — panic on OOM
                        BunString::clone_utf8(&result)
                    };
                    #[cfg(not(windows))]
                    let pathname_string = BunString::clone_utf8(archive_entry_ref.pathname());

                    let kind = bun_sys::kind_from_mode(archive_entry_ref.filetype());
                    let perm = archive_entry_ref.perm();

                    let mut entry_info = EntryInfo {
                        pathname: pathname_string,
                        kind: BunString::static_(<&'static str>::from(kind)),
                        perm,
                        size: None,
                        contents: None,
                    };

                    if kind == bun_sys::FileKind::File {
                        let size: usize = usize::try_from(archive_entry_ref.size()).unwrap();
                        read_buf.resize(size, 0);

                        let read = archive.read_data(&mut read_buf);
                        if read < 0 {
                            let pathname_utf8 = entry_info.pathname.to_utf8();
                            return global.throw(
                                "failed to read archive entry \"{}\": {}",
                                format_args!(
                                    "{}: {}",
                                    bstr::BStr::new(pathname_utf8.slice()),
                                    bstr::BStr::new(Archive::error_string(archive.cast())),
                                ),
                            );
                        }
                        read_buf.truncate(usize::try_from(read).unwrap());
                        entry_info.contents = Some(BunString::clone_utf8(&read_buf));
                        read_buf.clear();
                    }

                    entries_info.push(entry_info);
                }
            }
            header_status = archive.read_next_header(&mut archive_entry);
        }

        match archive.read_close() {
            Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
                return global.throw("failed to close read archive: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            }
            _ => {}
        }
        match archive.read_free() {
            Archive::Status::Failed | Archive::Status::Fatal | Archive::Status::Warn => {
                return global.throw("failed to close read archive: {}", format_args!("{}", bstr::BStr::new(archive.error_string())));
            }
            _ => {}
        }

        let entries = JSArray::create_empty(global, entries_info.len())?;

        for (i, entry) in entries_info.iter().enumerate() {
            let obj = JSValue::create_empty_object(global, 0);
            obj.put(global, "pathname", entry.pathname.to_js(global)?);
            obj.put(global, "kind", entry.kind.to_js(global)?);
            obj.put(global, "perm", JSValue::js_number(entry.perm));
            if let Some(contents) = &entry.contents {
                obj.put(global, "contents", contents.to_js(global)?);
            }
            entries.put_index(global, u32::try_from(i).unwrap(), obj)?;
        }

        let result = JSValue::create_empty_object(global, 4);
        result.put(global, "entries", entries);
        result.put(global, "size", JSValue::js_number(tarball.len()));
        result.put(global, "shasum", shasum_str.to_js(global)?);
        result.put(global, "integrity", integrity_value);

        Ok(result)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/pack_command.zig (2840 lines)
//   confidence: medium
//   todos:      38
//   notes:      heavy fs/Dir usage mapped to bun_sys::Dir (RAII pending); pack() comptime return-type variance modeled with Option; Output::prettyln fmt-arg shape and Expr.data matching need Phase B fixup; PriorityQueue assumed in bun_collections.
// ──────────────────────────────────────────────────────────────────────────
