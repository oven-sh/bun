use bun_alloc::AllocError;
use bun_ast::{Expr, ExprData};
use bun_collections::{StringHashMap, VecExt};
use bun_core::ZBox;
use bun_core::{Global, Output, ZStr, fmt as bun_fmt, strings};
use bun_glob as glob;
use bun_paths::resolve_path::{self, normalize_buf_z_spill};
use bun_paths::{self as path, SEP_STR};
use bun_ptr::cow_slice::CowSlice;
use bun_sys::{self, Dir, Fd, FdDirExt as _, File, dir_iterator as DirIterator};

use crate::package_manager::LogLevel;

type CowString = CowSlice<u8>;

fn pack_bump() -> &'static bun_alloc::Arena {
    thread_local! {
        static BUMP: bun_alloc::Arena = bun_alloc::Arena::new();
    }
    // SAFETY: the thread lives as long as the process, so `BUMP` is never dropped; `Arena` is `!Sync`.
    BUMP.with(|b| unsafe { &*std::ptr::from_ref::<bun_alloc::Arena>(b) })
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

pub const ROOT_DEFAULT_IGNORE_PATTERNS: &[&[u8]] = &[
    b"package-lock.json",
    b"yarn.lock",
    b"pnpm-lock.yaml",
    b"bun.lockb",
    b"bun.lock",
];

// (pattern, can_override). `can_override == false` mirrors npm-packlist's
// strict rules (only `.git` and `.npmrc` here; lockfiles live in
// ROOT_DEFAULT_IGNORE_PATTERNS); everything else `"files"` can re-include.
pub const DEFAULT_IGNORE_PATTERNS: &[(&[u8], bool)] = &[
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

pub struct PackQueueItem {
    pub path: ZBox,
}

impl Ord for PackQueueItem {
    fn cmp(&self, other: &Self) -> core::cmp::Ordering {
        // Reversed, because `BinaryHeap` is a max-heap and the smallest path should pop first.
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
    pub heap: std::collections::BinaryHeap<PackQueueItem>,
    pub seen: StringHashMap<()>,
}
impl PackQueue {
    /// Drops a path that's already queued, so that no file is packed twice.
    pub fn add(&mut self, item: PackQueueItem) -> Result<(), AllocError> {
        if self.seen.get_or_put(item.path.as_bytes())?.found_existing {
            return Ok(());
        }
        self.heap.push(item);
        Ok(())
    }
    pub fn count(&self) -> usize {
        self.heap.len()
    }
    pub fn remove_or_null(&mut self) -> Option<PackQueueItem> {
        self.heap.pop()
    }
    pub fn into_paths(mut self) -> Vec<ZBox> {
        let mut out = Vec::with_capacity(self.heap.len());
        while let Some(item) = self.heap.pop() {
            out.push(item.path);
        }
        out
    }
}

/// (dir, dir_subpath, dir_depth)
pub struct DirInfo(pub Dir, pub Box<[u8]>, pub usize);

/// (dir, dir_depth). The root (depth 1) belongs to the caller and stays open. The walk closes the
/// others.
pub struct WalkedDir(Dir, usize);
impl Drop for WalkedDir {
    fn drop(&mut self) {
        if self.1 == 1 {
            self.0.fd = Fd::INVALID;
        }
    }
}

pub fn iterate_included_project_tree(
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

pub fn print_ignored(
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

/// Returns true if `errno` means that nothing exists at the path. `ELOOP` comes from a cycle of
/// symlinks.
pub fn is_absent(errno: bun_sys::E) -> bool {
    matches!(
        errno,
        bun_sys::E::ENOENT | bun_sys::E::ENOTDIR | bun_sys::E::ENAMETOOLONG | bun_sys::E::ELOOP
    )
}

pub const ITERABLE: bun_sys::OpenDirOptions = bun_sys::OpenDirOptions {
    iterate: true,
    no_follow: false,
};

#[cold]
pub fn fail_open_dir(err: crate::Error, subpath: &[u8]) -> ! {
    Output::err(
        err,
        "failed to open directory \"{}\" for packing",
        format_args!("{}", bstr::BStr::new(subpath)),
    );
    Global::crash();
}

/// Opens a directory that the walk listed, so every failure is fatal. If it was replaced by a
/// symlink in the meantime, the symlink isn't followed.
pub fn open_subdir(dir: &Dir, entry_name: &[u8], entry_subpath: &ZStr) -> Dir {
    let opts = bun_sys::OpenDirOptions {
        iterate: true,
        // On Windows this would open the link itself instead of failing.
        no_follow: cfg!(not(windows)),
    };
    dir.open_dir(entry_name, opts)
        .unwrap_or_else(|err| fail_open_dir(err.into(), entry_subpath.as_bytes()))
}

/// Returns `None` if the directory doesn't exist. If it exists but can't be opened, that's fatal.
pub fn open_dir_if_present(root_dir: &Dir, subpath: &ZStr) -> Option<Dir> {
    match root_dir.open_dir(subpath.as_bytes(), ITERABLE) {
        Ok(dir) => Some(dir),
        Err(err) if is_absent(err.get_errno()) => None,
        Err(err) => fail_open_dir(err.into(), subpath.as_bytes()),
    }
}

/// Calls `lstat` on file systems that don't report an entry's kind (FUSE, NFS, XFS with `ftype=0`),
/// so a symlink is still reported as a symlink.
pub fn next_dir_entry(
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
pub fn fail_read_dir(err: bun_sys::Error, dir_subpath: &[u8]) -> ! {
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

pub fn entry_subpath(dir_subpath: &[u8], entry_name: &[u8]) -> Result<ZBox, AllocError> {
    let sep: &[u8] = if dir_subpath.is_empty() { b"" } else { b"/" };
    Ok(ZBox::from_vec_with_nul(
        [dir_subpath, sep, entry_name, b"\0"].concat(),
    ))
}

/// `files_excludes` is set when `root_dir` is a directory that is packed whole: one that `"files"`
/// includes, with the negated entries of `"files"`, or a bundled folder that has no package.json.
pub fn iterate_project_tree(
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
                if (entry_name == b"package.json" && entry.kind == bun_sys::FileKind::File)
                    || entry_name == b"node_modules"
                {
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

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum BinType {
    File,
    Dir,
}

pub struct BinInfo {
    pub path: ZBox,
    pub ty: BinType,
}

pub fn get_package_bins(json: &Expr) -> Vec<BinInfo> {
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
pub fn non_empty_bin(json: &Expr) -> Option<bun_ast::expr::Query> {
    json.as_property(b"bin").filter(|bin| match &bin.expr.data {
        ExprData::EString(bin_str) => bin_str.is_present(),
        ExprData::EObject(bin_obj) => bin_obj.properties.len_u32() != 0,
        _ => true,
    })
}

pub fn bin_subpath<'a>(
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
    // Nothing can re-include `.git` and `.npmrc`. Passing depth 2 skips the rule for the root's
    // lockfiles.
    let never_packed =
        || strings::split(subpath, b"/").any(|name| is_unconditionally_excluded(name, 2).is_some());
    (!is_package_root_or_outside(subpath) && !never_packed()).then_some(subpath)
}

/// A NUL ends the path that the OS gets, so a path that has one counts as outside.
pub fn is_package_root_or_outside(p: &[u8]) -> bool {
    p.is_empty()
        || p == b"."
        || path::is_absolute_loose(p)
        || p == b".."
        || p.starts_with(b"../")
        || strings::contains_char(p, 0)
}

/// `Unknown` if `bin_path` is missing or a parent component is not a real directory.
pub fn bin_kind_without_following_symlinks(
    abs_workspace_path: &[u8],
    bin_path: &[u8],
) -> bun_sys::FileKind {
    // A trailing slash would make `lstat` resolve a symlink to a directory.
    let bin_path = strings::without_trailing_slash(bin_path);
    let mut spill: Vec<u8> = Vec::new();
    let slashes = (bin_path.iter().enumerate()).filter_map(|(i, &c)| (c == b'/').then_some(i));
    for end in slashes.chain([bin_path.len()]) {
        // Use the absolute path, because on Windows `lstatat` reports a reparse point as the kind
        // of its target.
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

/// `published_files` has already queued the bins, so the walks skip them.
pub fn is_listed_bin(bins: &[BinInfo], ty: BinType, subpath: &ZStr) -> bool {
    bins.iter()
        .any(|bin| bin.ty == ty && strings::eql_long(bin.path.as_bytes(), subpath.as_bytes(), true))
}

pub fn is_package_bin(bins: &[BinInfo], maybe_bin_path: &[u8]) -> bool {
    bins.iter().any(|bin| match bin.ty {
        BinType::File => strings::eql_long(bin.path.as_bytes(), maybe_bin_path, true),
        BinType::Dir => (maybe_bin_path.strip_prefix(bin.path.as_bytes()))
            .and_then(|remain| remain.strip_prefix(b"/"))
            .is_some_and(|name| !name.is_empty() && !strings::contains_char(name, b'/')),
    })
}

/// Default ignores that nothing (including an explicit `"files"` entry) can
/// re-include: the root lockfiles and the `can_override == false` patterns.
pub fn is_unconditionally_excluded(
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

pub enum Exclusion<'a> {
    Included,
    Excluded(&'a [u8], IgnorePatternsKind),
    /// An excluded directory that has a negated pattern below it. Unlike in npm, its entries stay
    /// excluded.
    WalkOnly(&'a [u8], IgnorePatternsKind),
}

/// The pattern that excluded the walked-only directory an entry is in.
pub type InheritedIgnore = Option<(Box<[u8]>, IgnorePatternsKind)>;

pub fn is_excluded<'a>(
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

/// Returns true if a negated pattern could match a path below the directory `dir_rel`.
pub fn negation_reaches_below(pattern: &Pattern, dir_rel: &[u8]) -> bool {
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

/// Everything `bun pm pack` would put in the tarball besides package.json: bins, then either the `files` list or
/// the whole tree minus ignores. Shared with `bun pm diff`, whose local side is "what would be published".
/// `root_path` is the path `root_dir` was opened from.
pub fn published_files(
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

/// A glob pattern used to ignore or include files in the project tree.
/// Might come from .npmignore, .gitignore, or `files` in package.json
pub struct Pattern {
    pub glob: glob::Prepared<CowString>,
    pub flags: PatternFlags,
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
    pub fn from_utf8(pattern: &[u8]) -> Option<Pattern> {
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

        let negation: &[u8] = match flags.contains(PatternFlags::NEGATED) {
            // In npm and git this `!` negates and the `(` is a plain character. Side by side they would start a group.
            true if remain.starts_with(b"(") => b"!\\",
            true => b"!",
            false => b"",
        };
        Some(Pattern {
            glob: glob::Prepared::new(CowString::init_owned(
                [negation, remain].concat().into_boxed_slice(),
            )),
            flags,
        })
    }

    /// Invert a negated pattern to a positive pattern
    pub fn as_positive(&self) -> Pattern {
        debug_assert!(self.flags.contains(PatternFlags::NEGATED));
        Pattern {
            // remove the leading `!`
            glob: glob::Prepared::new(self.glob.source().borrow_subslice(1, None)),
            flags: self.flags.difference(PatternFlags::NEGATED),
        }
    }
}

pub struct IgnorePatterns {
    pub list: Box<[Pattern]>,
    pub kind: IgnorePatternsKind,
    pub depth: usize,
    /// At least one of the patterns has a leading or middle slash, so a relative path is needed.
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

impl IgnorePatterns {
    /// Fatal, because otherwise the tarball would include the files that were supposed to be
    /// ignored.
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

    /// Same as git's `trim_trailing_spaces` in dir.c. For example, `foo\ ` keeps its space.
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

/// Some files are always packed, even if they are explicitly ignored or not
/// included in package.json "files".
pub fn is_unconditionally_included_file(filename: &[u8]) -> bool {
    filename.len() > 5
        && (strings_eql(filename, b"package.json")
            || is_special_file_or_variant(filename, b"LICENSE")
            || is_special_file_or_variant(filename, b"LICENCE") // THIS IS SPELLED DIFFERENTLY
            || is_special_file_or_variant(filename, b"README"))
}

// TODO: should this be case insensitive on all platforms?
#[inline]
pub fn strings_eql(a: &[u8], b: &'static [u8]) -> bool {
    if cfg!(any(target_os = "linux", target_os = "android")) {
        a == b
    } else {
        strings::eql_case_insensitive_ascii_check_length(a, b)
    }
}

/// `name` itself, or `name` with an extension.
#[inline]
pub fn is_special_file_or_variant(filename: &[u8], name: &'static [u8]) -> bool {
    let Some((stem, extension)) = filename.split_at_checked(name.len()) else {
        return false;
    };
    strings_eql(stem, name)
        && (extension.is_empty() || (extension.len() > 1 && extension[0] == b'.'))
}

/// Removes everything from `root_dir` that `bun pm pack` would leave out of the tarball, so that a
/// Git dependency has the same files as the same package from a registry. Does nothing if the
/// package.json is missing or invalid. `node_modules` is kept, because it is only there when the
/// package bundles its dependencies.
pub fn prune_to_published_files(root_dir: &Dir) -> bun_sys::Maybe<()> {
    use std::collections::HashSet;
    crate::initialize_mini_store();
    let Ok(contents) = root_dir
        .open_file(
            b"package.json",
            bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NOFOLLOW,
            0,
        )
        .and_then(|file| file.read_to_end())
    else {
        return Ok(());
    };
    let source = bun_ast::Source::init_path_string("package.json", &contents[..]);
    let Ok(parsed) =
        crate::bun_json::ParsedJson::parse_package_json(&source, &mut bun_ast::Log::init())
    else {
        return Ok(());
    };
    let json = &parsed.root;
    let bump = pack_bump();

    let mut path_buf = bun_paths::path_buffer_pool::get();
    let root_path: &[u8] = bun_sys::get_fd_path(Fd::from_std_dir(root_dir), &mut path_buf)?;

    // `published_files` exits on a `files` that is not a list of strings.
    if let Some(files) = json.get(b"files") {
        let Some(mut list) = files.as_array() else {
            return Ok(());
        };
        while let Some(entry) = list.next() {
            if entry.as_string(bump).is_none() {
                return Ok(());
            }
        }
    }

    let Ok((queue, _bins)) = published_files(root_dir, root_path, json, bump, LogLevel::Silent)
    else {
        return Ok(());
    };

    let mut keep_files: HashSet<Vec<u8>> = HashSet::new();
    let mut keep_dirs: HashSet<Vec<u8>> = HashSet::new();
    for path in queue.into_paths() {
        let path = path.as_bytes();
        for (i, &c) in path.iter().enumerate() {
            if c == b'/' {
                keep_dirs.insert(path[..i].to_vec());
            }
        }
        keep_files.insert(path.to_vec());
    }

    fn is_empty_dir(dir: &Dir, name: &[u8], subpath: &[u8]) -> bool {
        let Ok(subdir) = dir.open_dir(
            name,
            bun_sys::OpenDirOptions {
                iterate: true,
                no_follow: cfg!(not(windows)),
            },
        ) else {
            return false;
        };
        let mut iter = DirIterator::iterate(Fd::from_std_dir(&subdir));
        let empty = next_dir_entry(&mut iter, subpath).is_none();
        subdir.close();
        empty
    }

    fn prune_dir(
        dir: &Dir,
        dir_subpath: &[u8],
        keep_files: &HashSet<Vec<u8>>,
        keep_dirs: &HashSet<Vec<u8>>,
    ) -> bun_sys::Maybe<()> {
        let mut remove: Vec<Vec<u8>> = Vec::new();
        let mut descend: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();

        let mut iter = DirIterator::iterate(Fd::from_std_dir(dir));
        while let Some(entry) = next_dir_entry(&mut iter, dir_subpath) {
            let name = entry.name.slice_u8();
            if dir_subpath.is_empty() && (name == b"package.json" || name == b"node_modules") {
                continue;
            }
            let subpath = if dir_subpath.is_empty() {
                name.to_vec()
            } else {
                [dir_subpath, b"/", name].concat()
            };
            match entry.kind {
                bun_sys::FileKind::Directory if keep_dirs.contains(&subpath) => {
                    descend.push((name.to_vec(), subpath));
                }
                bun_sys::FileKind::File if keep_files.contains(&subpath) => {}
                // An empty folder is what a submodule leaves behind, and it stays.
                bun_sys::FileKind::Directory if is_empty_dir(dir, name, &subpath) => {}
                _ => remove.push(name.to_vec()),
            }
        }

        for name in remove {
            dir.delete_tree(&name)?;
        }
        for (name, subpath) in descend {
            let subdir = dir.open_dir(
                &name,
                bun_sys::OpenDirOptions {
                    iterate: true,
                    no_follow: cfg!(not(windows)),
                },
            )?;
            let result = prune_dir(&subdir, &subpath, keep_files, keep_dirs);
            subdir.close();
            result?;
        }
        Ok(())
    }

    // `published_files` read `root_dir` to the end, so this walk needs its own handle.
    let walk_dir = root_dir.open_dir(
        b".",
        bun_sys::OpenDirOptions {
            iterate: true,
            no_follow: false,
        },
    )?;
    let result = prune_dir(&walk_dir, b"", &keep_files, &keep_dirs);
    walk_dir.close();
    result
}
