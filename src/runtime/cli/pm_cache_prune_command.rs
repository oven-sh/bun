//! `bun pm cache prune`: remove cache entries whose directory mtime is older
//! than `--max-age` days. Bun never touches an entry after extraction, so the
//! mtime is the download time, not the last use. `CacheEntryKind` (next to
//! the cache folder name printers in `bun_install`) says which entries are
//! packages.

use bstr::BStr;
use bun_core::{Output, ZBox, fmt as bun_fmt};
use bun_install::package_manager_real::CacheEntryKind as Kind;
use bun_sys::{self, Dir, E, EntryKind, PosixStat};

pub(crate) struct PmCachePruneCommand;

pub(crate) const DEFAULT_MAX_AGE_DAYS: u32 = 30;

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

struct Entry {
    name: ZBox,
    kind: EntryKind,
}

fn read_entries(dir: &Dir, path: &[u8]) -> Option<Vec<Entry>> {
    let mut iter = bun_sys::iterate_dir(dir.fd());
    let mut entries = Vec::new();
    loop {
        match iter.next() {
            Ok(Some(entry)) => entries.push(Entry {
                name: ZBox::from_bytes(entry.name.slice_u8()),
                kind: entry.kind,
            }),
            Ok(None) => return Some(entries),
            Err(err) => {
                Output::err(err, "Could not read {s}", (BStr::new(path),));
                return None;
            }
        }
    }
}

/// Sum of the file sizes under `dir`. Symlinks are not followed.
fn tree_size(dir: &Dir, path: &[u8]) -> u64 {
    let Some(entries) = read_entries(dir, path) else {
        return 0;
    };
    let mut total: u64 = 0;
    for entry in &entries {
        match entry.kind {
            EntryKind::Directory => {
                if let Ok(sub) = dir.open_at(entry.name.as_bytes()) {
                    total += tree_size(&sub, path);
                }
            }
            EntryKind::File => {
                if let Ok(st) = bun_sys::lstatat(dir.fd(), &entry.name) {
                    total += PosixStat::init(&st).size;
                }
            }
            _ => {}
        }
    }
    total
}

struct Prune {
    cutoff_sec: i64,
    dry_run: bool,
    checked: usize,
    removed: usize,
    failed: usize,
    bytes: u64,
}

impl Prune {
    /// `prefix` is the display path of `dir` relative to the cache root
    /// (empty for the root, `@scope/` for a scope directory).
    fn prune_dir(&mut self, dir: &Dir, prefix: &[u8], in_scope: bool) {
        let Some(entries) = read_entries(dir, prefix) else {
            return;
        };

        for entry in &entries {
            let name = entry.name.as_bytes();
            match Kind::from_name(name, entry.kind, in_scope) {
                Kind::Package => self.prune_package(dir, entry, prefix),
                Kind::Scope => {
                    let Ok(sub) = dir.open_at(name) else {
                        continue;
                    };
                    let sub_prefix = [prefix, name, b"/"].concat();
                    self.prune_dir(&sub, &sub_prefix, true);
                    drop(sub);
                    if !self.dry_run {
                        let _ = bun_sys::rmdirat(dir.fd(), &entry.name);
                    }
                }
                Kind::Index | Kind::Other => {}
            }
        }

        if self.dry_run {
            return;
        }
        for entry in &entries {
            if Kind::from_name(entry.name.as_bytes(), entry.kind, in_scope) == Kind::Index {
                if let Ok(index) = dir.open_at(entry.name.as_bytes()) {
                    remove_dangling_links(&index);
                }
                // Fails with ENOTEMPTY when versions remain.
                let _ = bun_sys::rmdirat(dir.fd(), &entry.name);
            }
        }
    }

    fn prune_package(&mut self, dir: &Dir, entry: &Entry, prefix: &[u8]) {
        let name = entry.name.as_bytes();
        let st = match bun_sys::lstatat(dir.fd(), &entry.name) {
            Ok(st) => st,
            Err(err) => {
                if err.get_errno() != E::ENOENT {
                    Output::err(err, "Could not stat {s}", (BStr::new(name),));
                    self.failed += 1;
                }
                return;
            }
        };
        self.checked += 1;
        if bun_sys::stat_mtime(&st).sec > self.cutoff_sec {
            return;
        }

        let display = [prefix, name].concat();
        let size = match dir.open_at(name) {
            Ok(sub) => tree_size(&sub, &display),
            Err(_) => 0,
        };

        if self.dry_run {
            bun_core::prettyln!(
                "<r><red>-<r> {} <d>({})<r>",
                BStr::new(&display),
                bun_fmt::size(size as usize, Default::default())
            );
        } else if let Err(err) = dir.delete_tree(name) {
            Output::err(err, "Could not delete {s}", (BStr::new(&display),));
            self.failed += 1;
            return;
        }
        self.removed += 1;
        self.bytes += size;
    }
}

/// Remove every symlink (junction on Windows) in `index` whose target is gone.
/// The index entries point at package directories, so this runs after the
/// package pass of the same directory.
fn remove_dangling_links(index: &Dir) {
    let Some(entries) = read_entries(index, b"") else {
        return;
    };
    for entry in &entries {
        if entry.kind != EntryKind::SymLink {
            continue;
        }
        match bun_sys::fstatat(index.fd(), &entry.name) {
            Ok(_) => {}
            Err(err) if err.get_errno() == E::ENOENT => {
                if bun_sys::unlinkat(index.fd(), &entry.name).is_err() {
                    let _ = bun_sys::rmdirat(index.fd(), &entry.name);
                }
            }
            Err(_) => {}
        }
    }
}

impl PmCachePruneCommand {
    /// Returns the process exit code.
    pub(crate) fn exec(cache_path: &[u8], max_age_days: u32, dry_run: bool) -> u8 {
        let cache_dir = match Dir::open(cache_path) {
            Ok(dir) => dir,
            Err(err) if err.get_errno() == E::ENOENT => {
                bun_core::prettyln!(
                    "<r><green>Done<r>! No cache directory <d>(nothing to prune)<r>"
                );
                return 0;
            }
            Err(err) => {
                Output::err(err, "Could not open {s}", (BStr::new(cache_path),));
                return 1;
            }
        };

        let now = bun_core::time::timestamp();
        let max_age_sec = i64::from(max_age_days) * i64::from(bun_core::time::S_PER_DAY);
        let mut prune = Prune {
            cutoff_sec: now.saturating_sub(max_age_sec),
            dry_run,
            checked: 0,
            removed: 0,
            failed: 0,
            bytes: 0,
        };
        prune.prune_dir(&cache_dir, b"", false);
        Output::flush();

        let checked = prune.checked;
        let n = prune.removed;
        let size = bun_fmt::size(prune.bytes as usize, Default::default());
        if n == 0 && prune.failed == 0 {
            bun_core::prettyln!(
                "<r><green>Done<r>! Checked <green>{} package{}<r>, none older than {} day{} <d>(nothing to prune)<r>",
                checked,
                plural(checked),
                max_age_days,
                plural(max_age_days as usize)
            );
        } else if dry_run {
            bun_core::prettyln!(
                "<r><b>{}<r> package{} older than {} day{} can be removed <d>({}, checked {})<r>",
                n,
                plural(n),
                max_age_days,
                plural(max_age_days as usize),
                size,
                checked
            );
            bun_core::prettyln!("<d>Run without --dry-run to remove them.<r>");
        } else {
            bun_core::pretty!(
                "<r>Removed <b>{}<r> package{} older than {} day{} <d>({})<r>",
                n,
                plural(n),
                max_age_days,
                plural(max_age_days as usize),
                size
            );
            if prune.failed > 0 {
                bun_core::pretty!(", <red>{} failed<r>", prune.failed);
            }
            bun_core::prettyln!("");
        }
        Output::flush();
        u8::from(prune.failed > 0)
    }
}
