//! Whole-install fingerprint: the "nothing changed" fast path.
//!
//! After a successful `bun install`, the inputs that determine what ends up in
//! node_modules are hashed and recorded in `<cache>/.install-state/<project>`:
//!   * the lockfile bytes (bun.lock / bun.lockb),
//!   * root and every workspace `package.json`,
//!   * config files that shape an install (./bunfig.toml, ./.npmrc, ~/.npmrc,
//!     ~/.bunfig.toml), and every referenced patch file,
//!   * the install-relevant environment (`BUN_INSTALL*`, `BUN_CONFIG_*`,
//!     `NPM_CONFIG_*`) and the exact command line,
//!   * bun's version,
//!   * the mtime of each workspace directory's *parent* (so a workspace added
//!     under `packages/*` is noticed even though no existing file changed).
//! On the next plain `bun install`, if the file exists and every recorded input
//! still hashes the same, there is provably nothing to do: we print the summary
//! and return without parsing the lockfile, re-hoisting, or touching one
//! `node_modules/*/package.json` — O(inputs) instead of O(packages) work, which
//! is the difference between milliseconds and seconds on large monorepos and on
//! Windows.
//!
//! Anything that mutates the inputs (add/remove/update/pm trust/patch, editing a
//! package.json, switching branches) changes a hash and takes the normal path.
//! `--force`, `--frozen-lockfile` off a mismatched file, or `install.stateFile =
//! false` bypass it. Like yarn 4, root lifecycle scripts do not re-run on a
//! no-op install.

use std::io::Write as _;

use crate::lockfile::package::PackageColumns as _;
use bun_paths::SEP;
use bun_sys::Fd;

use crate::PackageManager;
use crate::package_manager_real::Subcommand;

const VERSION_LINE: &str = "bun-install-state v2";

fn h(bytes: &[u8]) -> u64 {
    bun_wyhash::hash(bytes)
}

fn zpath(path: &[u8]) -> bun_core::ZBox {
    let mut v = Vec::with_capacity(path.len() + 1);
    v.extend_from_slice(path);
    v.push(0);
    bun_core::ZBox::from_vec_with_nul(v)
}

enum FileHash {
    Present(u64),
    /// ENOENT / ENOTDIR — a legitimately missing input (recorded as such)
    Absent,
    /// exists but could not be read (EACCES, EIO, …): never treated as a valid state
    Unreadable,
}

fn read_file(path: &[u8]) -> Result<Vec<u8>, bun_sys::Error> {
    bun_sys::File::read_from(Fd::cwd(), path)
}

fn hash_file(path: &[u8]) -> FileHash {
    match read_file(path) {
        Ok(b) => FileHash::Present(h(&b)),
        Err(e) if matches!(e.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            FileHash::Absent
        }
        Err(_) => FileHash::Unreadable,
    }
}

fn mtime_ns(st: &bun_sys::Stat) -> u64 {
    let t = bun_sys::stat_mtime(st);
    (t.sec as u64)
        .wrapping_mul(1_000_000_000)
        .wrapping_add(t.nsec as u64)
}

/// mtime of `path` (following symlinks), None if it does not exist.
fn dir_stamp(path: &[u8]) -> Option<u64> {
    bun_sys::stat(&zpath(path)).ok().map(|st| mtime_ns(&st))
}

/// `dir_stamp` (follows symlinks) distinguishing absent from unreadable.
fn dir_stamp_strict(path: &[u8]) -> Stamp {
    match bun_sys::stat(&zpath(path)) {
        Ok(st) => Stamp::At(mtime_ns(&st)),
        Err(e) if matches!(e.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            Stamp::Absent
        }
        Err(_) => Stamp::Unreadable,
    }
}

/// mtime of `path` itself (not following symlinks), None if it does not exist.
fn lstat_stamp(path: &[u8]) -> Option<u64> {
    bun_sys::lstat(&zpath(path)).ok().map(|st| mtime_ns(&st))
}

enum Stamp {
    At(u64),
    Absent,
    Unreadable,
}

/// `lstat_stamp`, but an existing path whose metadata cannot be read (EACCES, EIO, …)
/// is reported separately so callers can refuse to record state over it.
fn lstat_stamp_strict(path: &[u8]) -> Stamp {
    match bun_sys::lstat(&zpath(path)) {
        Ok(st) => Stamp::At(mtime_ns(&st)),
        Err(e) if matches!(e.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            Stamp::Absent
        }
        Err(_) => Stamp::Unreadable,
    }
}

fn is_directory(path: &[u8]) -> bool {
    matches!(bun_sys::stat(&zpath(path)), Ok(st) if bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode) == bun_sys::FileKind::Directory)
}

enum DirList {
    Entries(Vec<(Vec<u8>, bool)>),
    /// ENOENT / ENOTDIR
    Absent,
    /// exists but could not be (fully) enumerated
    Unreadable,
}

impl DirList {
    /// The entries, or — when there is nothing to walk — whether the walk still counts
    /// as complete (`true` for an absent directory, `false` for an unreadable one).
    fn into_entries(self) -> Result<Vec<(Vec<u8>, bool)>, bool> {
        match self {
            DirList::Entries(e) => Ok(e),
            DirList::Absent => Err(true),
            DirList::Unreadable => Err(false),
        }
    }
}

/// Directory entries as (name, is_directory); `.`/`..` are never returned by the
/// iterator. An error part-way through is `Unreadable`, never a partial list.
fn read_dir(path: &[u8]) -> DirList {
    let fd = match bun_sys::open_dir_for_iteration(Fd::cwd(), path) {
        Ok(fd) => fd,
        Err(e) if matches!(e.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            return DirList::Absent;
        }
        Err(_) => return DirList::Unreadable,
    };
    let mut out = Vec::new();
    let mut iter = bun_sys::iterate_dir(fd);
    let complete = loop {
        match iter.next() {
            Ok(Some(entry)) => {
                let name = entry.name.slice_u8();
                let is_dir = match entry.kind {
                    bun_sys::EntryKind::Directory => true,
                    // some filesystems do not report d_type; ask
                    bun_sys::EntryKind::Unknown => is_directory(&join(path, name)),
                    _ => false,
                };
                out.push((name.to_vec(), is_dir));
            }
            Ok(None) => break true,
            Err(_) => break false,
        }
    };
    drop(iter);
    let _ = bun_sys::close(fd);
    if complete {
        DirList::Entries(out)
    } else {
        DirList::Unreadable
    }
}

fn join(root: &[u8], rel: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(root.len() + rel.len() + 1);
    v.extend_from_slice(root);
    if !v.ends_with(&[SEP]) && !v.ends_with(b"/") {
        v.push(SEP);
    }
    v.extend_from_slice(rel);
    v
}

/// The install-relevant part of the environment + argv, hashed.
fn env_and_argv_hash(manager: &PackageManager) -> u64 {
    let mut acc: Vec<u8> = Vec::with_capacity(1024);
    let mut keys: Vec<&[u8]> = manager
        .env()
        .map
        .map
        .keys()
        .iter()
        .map(|k| &**k)
        .filter(|k| {
            starts_with_ci(k, b"BUN_INSTALL")
                || starts_with_ci(k, b"BUN_CONFIG_")
                || starts_with_ci(k, b"NPM_CONFIG_")
                // spliced into argv (see below)
                || k.eq_ignore_ascii_case(b"BUN_OPTIONS")
                // where the global .npmrc / .bunfig.toml are looked up
                || k.eq_ignore_ascii_case(b"HOME")
                || k.eq_ignore_ascii_case(b"USERPROFILE")
                || k.eq_ignore_ascii_case(b"XDG_CONFIG_HOME")
        })
        .collect();
    keys.sort_unstable();
    for k in keys {
        acc.extend_from_slice(k);
        acc.push(b'=');
        acc.extend_from_slice(manager.env().get(k).unwrap_or(b""));
        acc.push(0);
    }
    acc.push(1);
    // argv[0] is the executable; the subcommand token (`install`/`i`) is skipped so both
    // spellings share the fast path (the subcommand itself is part of `applicable()`).
    // BUN_OPTIONS tokens are spliced into argv and are also covered by the env hash.
    let mut skipped_subcommand = false;
    for a in bun_core::argv().into_iter().skip(1).filter(|a| {
        if !skipped_subcommand && matches!(&a[..], b"install" | b"i" | b"ci") {
            skipped_subcommand = true;
            false
        } else {
            true
        }
    }) {
        acc.extend_from_slice(a);
        acc.push(0);
    }
    acc.push(2);
    acc.extend_from_slice(bun_core::Global::package_json_version.as_bytes());
    h(&acc)
}

/// May this invocation use / record the fast path at all?
pub fn applicable(manager: &PackageManager) -> bool {
    manager.subcommand == Subcommand::Install
        && manager.options.install_state
        && !manager.options.global
        && !manager.options.dry_run
        && !manager.options.enable.force_install()
        && manager.options.positionals.len() <= 1
        && manager.options.filter_patterns.is_empty()
        && manager.update_requests.is_empty()
        && manager.options.do_.install_packages()
        && manager.options.do_.load_lockfile()
}

struct Recorded {
    lines: Vec<(u8, u64, Vec<u8>)>, // kind (one per record; kinds are matched in `is_up_to_date`), value, path
}

/// `<cache dir>/.install-state/<hash of project root>` — kept out of node_modules so
/// directory listings are unchanged, and per project so a shared cache is fine.
fn state_path(manager: &mut PackageManager, root: &[u8], create_dir: bool) -> Option<Vec<u8>> {
    // Resolve the cache directory *path* without forcing the directory into
    // existence (a workspaces-only install never creates it, and directory
    // listings must not change because of the state file): the state lives only
    // inside a cache directory that already exists.
    let cache_path: Vec<u8> = if !manager.cache_directory_path.as_bytes().is_empty() {
        manager.cache_directory_path.as_bytes().to_vec()
    } else if manager.options.enable.cache() {
        crate::package_manager_real::directories::fetch_cache_directory_path(
            manager.env_mut(),
            Some(&manager.options),
        )
        .path
    } else {
        join(root, b"node_modules/.cache")
    };
    if !is_directory(&cache_path) {
        return None;
    }
    let dir = join(&cache_path, b".install-state");
    if create_dir {
        let _ = bun_sys::mkdir_recursive(&dir);
    }
    let mut name: Vec<u8> = Vec::with_capacity(20);
    let _ = write!(&mut name, "{:016x}", h(root));
    Some(join(&dir, &name))
}

/// What the fast path prints (mirrors the normal "no changes" summary).
pub struct Summary {
    pub entries: u64,
    pub packages: u64,
}

fn parse(text: &[u8]) -> Option<Recorded> {
    let mut lines = bun_core::strings::split(text, b"\n");
    if lines.next()? != VERSION_LINE.as_bytes() {
        return None;
    }
    let mut out = Vec::new();
    while let Some(l) = lines.next() {
        if l.is_empty() {
            continue;
        }
        let kind = l[0];
        let rest = l.get(2..)?;
        let sp = bun_core::strings::index_of_char_usize(rest, b' ').unwrap_or(rest.len());
        let val = u64::from_str_radix(core::str::from_utf8(&rest[..sp]).ok()?, 16).ok()?;
        let path = if sp < rest.len() {
            rest[sp + 1..].to_vec()
        } else {
            Vec::new()
        };
        out.push((kind, val, path));
    }
    Some(Recorded { lines: out })
}

/// `Some(summary)` when the recorded state exists and every input is unchanged.
pub fn is_up_to_date(manager: &mut PackageManager, root_dir: &[u8]) -> Option<Summary> {
    let sp = state_path(manager, root_dir, false)?;
    let text = read_file(&sp).ok()?;
    let rec = parse(&text)?;
    if rec.lines.is_empty() {
        return None;
    }
    let mut saw_env = false;
    let mut summary = Summary {
        entries: 0,
        packages: 0,
    };
    for (kind, val, path) in &rec.lines {
        let ok = match kind {
            b'f' => matches!(hash_file(path), FileHash::Present(v) if v == *val),
            // the project root this state belongs to (guards against a hash collision
            // between two projects sharing one cache directory)
            b'r' => path.as_slice() == root_dir,
            // recorded as absent: must still be absent
            b'a' => matches!(hash_file(path), FileHash::Absent),
            b'd' => dir_stamp(path) == Some(*val),
            b'n' => dir_stamp(path).is_none(),
            b'l' => lstat_stamp(path) == Some(*val),
            b'p' => manifest_stamp(path) == *val,
            b'e' => {
                saw_env = true;
                env_and_argv_hash(manager) == *val
            }
            b's' => {
                summary.entries = *val;
                summary.packages = core::str::from_utf8(path)
                    .ok()
                    .and_then(|s| s.trim().parse().ok())
                    .unwrap_or(0);
                true
            }
            _ => false,
        };
        if !ok {
            bun_output::scoped_log!(
                PackageManager,
                "install state: {} changed",
                bstr::BStr::new(path)
            );
            return None;
        }
    }
    // node_modules itself must still be there
    if saw_env && dir_stamp(&join(root_dir, b"node_modules")).is_some() {
        Some(summary)
    } else {
        None
    }
}

/// Record the state after a successful install. Best effort: failures are ignored.
pub fn save(manager: &mut PackageManager, root_dir: &[u8], entries: u64, packages: u64) {
    if !applicable(manager) {
        return;
    }
    // Local sources (`file:` folders and tarballs; `link:` deps disable the fast path) are inputs too: their
    // *contents* decide what gets materialized. Stamp them (recursive mtimes for
    // folders, content hash for tarballs); a project with enormous local sources just
    // doesn't get a state file.
    let mut local_lines: Vec<u8> = Vec::new();
    {
        use crate::resolution_real::Tag;
        let buf = manager.lockfile.buffers.string_bytes.as_slice();
        let mut budget: usize = 20_000;
        let mut ok = true;
        for (i, r) in manager
            .lockfile
            .packages
            .slice()
            .items_resolution()
            .iter()
            .enumerate()
        {
            match r.tag {
                // `bun link` packages live in the global link directory, outside the
                // project: not tracked (no fast path for projects using them)
                Tag::Symlink => {
                    ok = false;
                    break;
                }
                Tag::Folder => {
                    let rel = r.folder().slice(buf);
                    if rel.is_empty() {
                        ok = false;
                        break;
                    }
                    // stored relative to the declaring package (see LocalTarball below)
                    if !bun_paths::is_absolute(rel) && !declared_by_root(&manager.lockfile, i) {
                        ok = false;
                        break;
                    }
                    let dir = if bun_paths::is_absolute(rel) {
                        rel.to_vec()
                    } else {
                        join(root_dir, rel)
                    };
                    if !stamp_source_tree(&mut local_lines, &dir, &mut budget) {
                        ok = false;
                        break;
                    }
                }
                Tag::LocalTarball => {
                    let rel = r.local_tarball().slice(buf);
                    // A relative tarball path is stored as declared, i.e. relative to the
                    // *declaring* package; only the root's can be resolved from here.
                    if !bun_paths::is_absolute(rel) && !declared_by_root(&manager.lockfile, i) {
                        ok = false;
                        break;
                    }
                    let path = if bun_paths::is_absolute(rel) {
                        rel.to_vec()
                    } else {
                        join(root_dir, rel)
                    };
                    match hash_file(&path) {
                        FileHash::Present(v) => {
                            let _ = write!(local_lines, "f {v:016x} ");
                            local_lines.extend_from_slice(&path);
                            local_lines.push(b'\n');
                        }
                        _ => {
                            ok = false;
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        if !ok {
            invalidate(manager, root_dir);
            return;
        }
    }
    let Some(sp) = state_path(manager, root_dir, true) else {
        return;
    };
    let mut out: Vec<u8> = Vec::with_capacity(4096);
    let _ = writeln!(out, "{VERSION_LINE}");
    let _ = write!(out, "r {:016x} ", 0);
    out.extend_from_slice(root_dir);
    out.push(b'\n');
    // any input that exists but cannot be read makes the state unrecordable
    let mut unreadable = false;
    let mut file = |out: &mut Vec<u8>, p: Vec<u8>| match hash_file(&p) {
        FileHash::Present(v) => {
            let _ = write!(out, "f {v:016x} ");
            out.extend_from_slice(&p);
            out.push(b'\n');
        }
        FileHash::Absent => {
            let _ = write!(out, "a {:016x} ", 0);
            out.extend_from_slice(&p);
            out.push(b'\n');
        }
        FileHash::Unreadable => unreadable = true,
    };
    // lockfiles (whichever exist; absence is recorded too)
    file(&mut out, join(root_dir, b"bun.lock"));
    file(&mut out, join(root_dir, b"bun.lockb"));
    file(&mut out, join(root_dir, b"package.json"));
    file(&mut out, join(root_dir, b"bunfig.toml"));
    file(&mut out, join(root_dir, b".npmrc"));
    // `-c <path>` is loaded instead of ./bunfig.toml; cover it too (its argv position is
    // already part of the env+argv hash, its contents are not)
    if let Some(cfg) = manager.options.explicit_config_path
        && !cfg.is_empty()
    {
        // `load_config` resolves a relative --config against the process cwd
        let mut cwd_buf = bun_paths::path_buffer_pool::get();
        let base: &[u8] = match bun_sys::getcwd(&mut cwd_buf[..]) {
            Ok(n) => &cwd_buf[..n],
            Err(_) => root_dir,
        };
        if bun_paths::is_absolute(cfg) {
            file(&mut out, cfg.to_vec());
        } else {
            file(&mut out, join(base, cfg));
        }
    }
    // global config, with the same precedence the loaders use: $XDG_CONFIG_HOME first
    // (its .npmrc wins when it exists), then $HOME (USERPROFILE on Windows)
    if let Some(xdg) = bun_core::env_var::XDG_CONFIG_HOME.get_not_empty() {
        file(&mut out, join(xdg, b".bunfig.toml"));
        file(&mut out, join(xdg, b".npmrc"));
    }
    if let Some(home) = bun_core::env_var::HOME.get_not_empty() {
        file(&mut out, join(home, b".npmrc"));
        file(&mut out, join(home, b".bunfig.toml"));
    }
    // workspaces: manifest hash + parent dir stamp
    let buf = manager.lockfile.buffers.string_bytes.as_slice();
    let mut globs_incomplete = false;
    let mut parents: Vec<Vec<u8>> = Vec::new();
    for ws in manager.lockfile.workspace_paths.values() {
        let rel = ws.slice(buf);
        if rel.is_empty() {
            continue;
        }
        let dir = join(root_dir, rel);
        file(&mut out, join(&dir, b"package.json"));
        if let Some(parent) = bun_paths::dirname(&dir) {
            let parent = parent.to_vec();
            if !parents.contains(&parent) {
                parents.push(parent);
            }
        }
    }
    // …plus the literal directory prefix of every `workspaces` glob in the root
    // manifest (`packages/*` → `packages/`), recorded even when it does not exist yet,
    // so creating the first workspace under it is noticed.
    let root_manifest_path = join(root_dir, b"package.json");
    if let Ok(root_json) = read_file(&root_manifest_path) {
        if let Some(globs) = workspace_globs(&root_json) {
            for g in globs {
                let g: &[u8] = g.strip_prefix(b"./").unwrap_or(&g);
                let literal_end = bun_core::strings::index_of_any(g, b"*?[{!").unwrap_or(g.len());
                let lit = &g[..literal_end];
                let dir_end = bun_core::strings::last_index_of_char(lit, b'/').unwrap_or(0);
                let prefix = &lit[..dir_end];
                let abs = if prefix.is_empty() {
                    root_dir.to_vec()
                } else {
                    join(root_dir, prefix)
                };
                // `a/*/*` or `a/**`: directories below the literal prefix can gain
                // workspaces too — stamp existing dirs down to the glob's depth (all levels for **)
                let rest = &g[literal_end..];
                let extra_depth = if strings_contains(rest, b"**") {
                    usize::MAX
                } else {
                    bun_core::strings::count_char(rest, b'/')
                };
                if extra_depth > 0 && !collect_dirs(&abs, extra_depth, &mut parents, &mut 4000) {
                    // too many candidate directories to watch cheaply: no fast path
                    globs_incomplete = true;
                }
                if !parents.contains(&abs) {
                    parents.push(abs);
                }
                // a fully literal workspace path: its own dir + manifest matter too
                if literal_end == g.len() && !g.is_empty() {
                    let ws_dir = join(root_dir, g);
                    if !parents.contains(&ws_dir) {
                        parents.push(ws_dir);
                    }
                }
            }
        }
    }
    parents.sort();
    for p in parents {
        match dir_stamp_strict(&p) {
            Stamp::At(stamp) => {
                let _ = write!(out, "d {stamp:016x} ");
                out.extend_from_slice(&p);
                out.push(b'\n');
            }
            Stamp::Absent => {
                // absent now; must stay absent
                let _ = write!(out, "n {:016x} ", 0);
                out.extend_from_slice(&p);
                out.push(b'\n');
            }
            Stamp::Unreadable => globs_incomplete = true,
        }
    }
    // patch files
    for pd in manager.lockfile.patched_dependencies.values() {
        let rel = pd.path.slice(buf);
        if !rel.is_empty() {
            file(&mut out, join(root_dir, rel));
        }
    }
    // node_modules directories (root + workspaces): the dir itself and each top-level
    // entry. Removing or replacing a package, or deleting a file directly inside one
    // (its package.json, say), bumps one of these mtimes; that is the tampering the
    // per-package verify pass used to catch, at the cost of an lstat instead of an
    // open+read+parse per package.
    let mut nm_dirs: Vec<Vec<u8>> = vec![join(root_dir, b"node_modules")];
    for ws in manager.lockfile.workspace_paths.values() {
        let rel = ws.slice(buf);
        if !rel.is_empty() {
            nm_dirs.push(join(&join(root_dir, rel), b"node_modules"));
        }
    }
    for nm in nm_dirs {
        if !stamp_tree(&mut out, &nm, 0) {
            unreadable = true;
        }
    }
    // Nested node_modules folders (hoisted: `node_modules/a/node_modules`, from the
    // lockfile's tree list) and each isolated store entry's own `node_modules` get the
    // same per-entry stamps as the root tree, so a deleted or corrupted nested package,
    // `.bin` or dependency link is noticed.
    {
        let lockfile = &*manager.lockfile;
        let mut iter = crate::lockfile::tree::Iterator::<
            { crate::lockfile::tree::IteratorPathStyle::NodeModules },
        >::init(lockfile);
        while let Some(nm) = iter.next(None) {
            if nm.depth == 0 {
                continue;
            }
            let dir = join(root_dir, nm.relative_path.as_bytes());
            // same per-entry stamps as the root/workspace trees (entries, their
            // package.json, @scope subdirectories); an absent nested dir must stay absent
            match lstat_stamp_strict(&dir) {
                Stamp::Absent => {
                    let _ = write!(out, "n {:016x} ", 0);
                    out.extend_from_slice(&dir);
                    out.push(b'\n');
                }
                _ => {
                    if !stamp_tree(&mut out, &dir, 0) {
                        unreadable = true;
                    }
                }
            }
        }
        let store = join(&join(root_dir, b"node_modules"), b".bun");
        match read_dir(&store) {
            DirList::Absent => {}
            // an existing store we cannot enumerate makes the state unrecordable
            DirList::Unreadable => unreadable = true,
            DirList::Entries(entries) => {
                for (name, _) in entries {
                    // `.bun/node_modules` is the hidden hoist directory itself; every other
                    // entry (a directory, or with a global store a symlink to one) holds
                    // the package plus its dependency links under `<entry>/node_modules`
                    let dir = if name == b"node_modules" {
                        join(&store, &name)
                    } else {
                        join(&join(&store, &name), b"node_modules")
                    };
                    if !stamp_tree(&mut out, &dir, 0) {
                        unreadable = true;
                    }
                }
            }
        }
    }
    if unreadable || globs_incomplete {
        return;
    }
    out.extend_from_slice(&local_lines);
    let _ = writeln!(
        out,
        "e {:016x} env+argv+version",
        env_and_argv_hash(manager)
    );
    let _ = writeln!(out, "s {entries:016x} {packages}");

    let mut tmp = sp.clone();
    let _ = write!(tmp, ".{}.tmp", std::process::id());
    if let Ok(f) = bun_sys::File::create(Fd::cwd(), &tmp, true) {
        let renamed = f.write_all(&out).is_ok()
            && bun_sys::renameat(Fd::cwd(), &zpath(&tmp), Fd::cwd(), &zpath(&sp)).is_ok();
        if !renamed {
            let _ = bun_sys::unlinkat(Fd::cwd(), &zpath(&tmp));
        }
    }
}

/// `<mtime ns> ^ <size>` of a package's package.json, following symlinks (so an
/// isolated-linker entry is checked in the store it points at). 0 when missing.
fn manifest_stamp(pkg_dir: &[u8]) -> u64 {
    let pj = join(pkg_dir, b"package.json");
    match bun_sys::stat(&zpath(&pj)) {
        Ok(st) => (mtime_ns(&st) ^ (st.st_size as u64).rotate_left(40)) | 1,
        Err(_) => 0,
    }
}

/// Record `dir`, and for each entry: its own lstat mtime (`l`) plus its
/// package.json stamp (`p`). Scope dirs are descended one level; bookkeeping dirs
/// (`.bin`, `.bun`, …) get only the `l` stamp.
fn stamp_tree(out: &mut Vec<u8>, dir: &[u8], depth: u8) -> bool {
    let stamp = match lstat_stamp_strict(dir) {
        Stamp::At(s) => s,
        Stamp::Absent => return true,
        Stamp::Unreadable => return false,
    };
    let _ = write!(out, "l {stamp:016x} ");
    out.extend_from_slice(dir);
    out.push(b'\n');
    let rd = match read_dir(dir).into_entries() {
        Ok(rd) => rd,
        // absent: nothing to stamp (fine); unreadable: refuse to record state
        Err(complete) => return complete,
    };
    for (name, _) in &rd {
        let name = name.as_slice();
        if name == b".cache" || name == b".install-state" {
            continue;
        }
        let child = join(dir, name);
        if depth < 1 && name.first() == Some(&b'@') {
            if !stamp_tree(out, &child, depth + 1) {
                return false;
            }
            continue;
        }
        if let Some(stamp) = lstat_stamp(&child) {
            let _ = write!(out, "l {stamp:016x} ");
            out.extend_from_slice(&child);
            out.push(b'\n');
        }
        if name.first() != Some(&b'.') {
            let _ = write!(out, "p {:016x} ", manifest_stamp(&child));
            out.extend_from_slice(&child);
            out.push(b'\n');
        }
    }
    true
}

/// ASCII-case-insensitive prefix test (env var names are case-insensitive on Windows,
/// and the loader's map lookups are too).
fn starts_with_ci(s: &[u8], prefix: &[u8]) -> bool {
    s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix)
}

fn strings_contains(hay: &[u8], needle: &[u8]) -> bool {
    bun_core::strings::index_of(hay, needle).is_some()
}

/// The `workspaces` glob patterns of a root package.json (`["a/*"]` or
/// `{ "packages": [...] }` form).
fn workspace_globs(json_bytes: &[u8]) -> Option<Vec<Vec<u8>>> {
    let mut log = bun_ast::Log::init();
    let arena = bun_alloc::Arena::new();
    let source = bun_ast::Source::init_path_string(b"package.json", json_bytes);
    let parsed = crate::bun_json::parse_package_json_utf8_with_opts(
        crate::bun_json::JSONOptions {
            json_warn_duplicate_keys: false,
            ..crate::bun_json::PACKAGE_JSON_OPTS
        },
        &source,
        &mut log,
        &arena,
    )
    .ok()?;
    let ws = parsed.root.get(b"workspaces")?;
    let list = match ws.get(b"packages") {
        Some(p) => p,
        None => ws,
    };
    let mut items = list.as_array()?;
    let mut out = Vec::new();
    while let Some(item) = items.next() {
        if let Some(s) = item.as_string(&arena) {
            out.push(s.to_vec());
        }
    }
    Some(out)
}

/// Collect the directories up to `depth` levels below `dir` (skipping node_modules and
/// dot dirs). Returns false if the walk could not be completed within `budget` or a
/// directory could not be read — the caller must then not record state, since a
/// workspace could later appear in a directory that was never stamped.
fn collect_dirs(dir: &[u8], depth: usize, out: &mut Vec<Vec<u8>>, budget: &mut usize) -> bool {
    if depth == 0 {
        return true;
    }
    let rd = match read_dir(dir).into_entries() {
        Ok(rd) => rd,
        // absent: nothing to stamp (fine); unreadable: refuse to record state
        Err(complete) => return complete,
    };
    for (name, is_dir) in &rd {
        if !is_dir {
            continue;
        }
        let name = name.as_slice();
        if name == b"node_modules" || name.starts_with(b".") {
            continue;
        }
        if *budget == 0 {
            return false;
        }
        *budget -= 1;
        let child = join(dir, name);
        if !collect_dirs(&child, depth - 1, out, budget) {
            return false;
        }
        if !out.contains(&child) {
            out.push(child);
        }
    }
    true
}

/// Recursively record `l` stamps for a local-source directory (skipping node_modules
/// and VCS dirs). Returns false if the walk exceeded `budget` entries or failed.
fn stamp_source_tree(out: &mut Vec<u8>, dir: &[u8], budget: &mut usize) -> bool {
    // a symlinked source (or entry inside it) would be walked through the link while only
    // the link's own mtime is recorded: not trackable
    let stamp = match bun_sys::lstat(&zpath(dir)) {
        Ok(st)
            if bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode)
                == bun_sys::FileKind::SymLink =>
        {
            return false;
        }
        Ok(st) => mtime_ns(&st),
        Err(_) => return false,
    };
    let _ = write!(out, "l {stamp:016x} ");
    out.extend_from_slice(dir);
    out.push(b'\n');
    let DirList::Entries(rd) = read_dir(dir) else {
        return false;
    };
    for (name, is_dir) in &rd {
        if *budget == 0 {
            return false;
        }
        *budget -= 1;
        let name = name.as_slice();
        if name == b"node_modules" || name == b".git" {
            continue;
        }
        let child = join(dir, name);
        if *is_dir {
            if !stamp_source_tree(out, &child, budget) {
                return false;
            }
        } else if let Some(stamp) = match bun_sys::lstat(&zpath(&child)) {
            // a symlinked entry inside the source: not trackable (see above)
            Ok(st)
                if bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode)
                    == bun_sys::FileKind::SymLink =>
            {
                return false;
            }
            Ok(st) => Some(mtime_ns(&st)),
            Err(_) => None,
        } {
            let _ = write!(out, "l {stamp:016x} ");
            out.extend_from_slice(&child);
            out.push(b'\n');
        }
    }
    true
}

/// Is package `pkg_id` a direct dependency of the root package? (Local paths are stored
/// relative to the declaring package, so only those can be resolved from the root.)
fn declared_by_root(lockfile: &crate::lockfile::Lockfile, pkg_id: usize) -> bool {
    if lockfile.packages.len() == 0 {
        return false;
    }
    let root_deps = lockfile.packages.items_dependencies()[0];
    let resolutions = lockfile.buffers.resolutions.as_slice();
    (root_deps.off as usize..(root_deps.off + root_deps.len) as usize)
        .any(|dep_id| resolutions.get(dep_id).copied() == Some(pkg_id as crate::PackageID))
}

/// Remove the state file (called before any install that will do real work, so a
/// crash mid-install can never leave a "clean" marker behind).
pub fn invalidate(manager: &mut PackageManager, root_dir: &[u8]) {
    let Some(sp) = state_path(manager, root_dir, false) else {
        return;
    };
    let _ = bun_sys::unlinkat(Fd::cwd(), &zpath(&sp));
}
