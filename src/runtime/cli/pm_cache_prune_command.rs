//! Removes package directories neither extracted (mtime) nor linked from (atime) for `--max-age`.

use bstr::BStr;
use bun_core::fmt::escape_control_chars;
use bun_core::{Output, ZBox, fmt as bun_fmt};
use bun_install::package_manager_real::directories::{
    CacheEntryKind as Kind, is_index_link_package_in_cache,
};
use bun_sys::{self, Dir, E, EntryKind, Fd, PosixStat};

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
            Ok(Some(entry)) => {
                let name = ZBox::from_bytes(entry.name.slice_u8());
                // DT_UNKNOWN: NFS, FUSE and bind mounts do not fill d_type.
                let kind = if entry.kind == EntryKind::Unknown {
                    match bun_sys::lstatat(dir.fd(), &name) {
                        Ok(st) => bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode),
                        Err(_) => EntryKind::Unknown,
                    }
                } else {
                    entry.kind
                };
                entries.push(Entry { name, kind });
            }
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
    root: Vec<u8>,
    cache_dir: Fd,
    cutoff_sec: i64,
    dry_run: bool,
    checked: usize,
    removed: usize,
    failed: usize,
    bytes: u64,
}

impl Prune {
    /// `prefix` is `dir` relative to the cache root, which is either empty or `@scope/`.
    /// Returns whether no entry of `dir` is left. A dry run removes nothing and returns false.
    fn prune_dir(&mut self, dir: &Dir, prefix: &[u8], in_scope: bool) -> bool {
        let read_path: &[u8] = if prefix.is_empty() {
            &self.root
        } else {
            prefix
        };
        let Some(entries) = read_entries(dir, read_path) else {
            self.failed += 1;
            return false;
        };
        let mut left = entries.len();

        for entry in &entries {
            let name = entry.name.as_bytes();
            let gone = match Kind::from_name(name, entry.kind, in_scope) {
                Kind::Package => self.prune_package(dir, entry, prefix),
                Kind::Scope => {
                    let sub_prefix = [prefix, name, b"/"].concat();
                    match dir.open_at(name) {
                        Ok(sub) => {
                            let emptied = self.prune_dir(&sub, &sub_prefix, true);
                            drop(sub);
                            emptied && self.remove_empty(dir, entry, &sub_prefix)
                        }
                        Err(err) if err.get_errno() == E::ENOENT => true,
                        Err(err) => {
                            Output::err(err, "Could not open {s}", (BStr::new(&sub_prefix),));
                            self.failed += 1;
                            false
                        }
                    }
                }
                Kind::Index | Kind::Other => false,
            };
            left -= usize::from(gone);
        }

        if self.dry_run {
            return false;
        }
        for entry in &entries {
            let name = entry.name.as_bytes();
            if Kind::from_name(name, entry.kind, in_scope) != Kind::Index {
                continue;
            }
            let display = [prefix, name].concat();
            let gone = match dir.open_at(name) {
                Ok(index) => {
                    let emptied = self.remove_dangling_links(&index, dir, name, &display);
                    drop(index);
                    emptied && self.remove_empty(dir, entry, &display)
                }
                Err(err) if err.get_errno() == E::ENOENT => true,
                Err(err) => {
                    Output::err(err, "Could not open {s}", (BStr::new(&display),));
                    self.failed += 1;
                    false
                }
            };
            left -= usize::from(gone);
        }
        left == 0
    }

    /// Only for a directory the walk left empty: `rmdir` answers EROFS or EACCES before ENOTEMPTY.
    fn remove_empty(&mut self, dir: &Dir, entry: &Entry, display: &[u8]) -> bool {
        match bun_sys::rmdirat(dir.fd(), &entry.name) {
            Ok(()) => true,
            Err(err) => match err.get_errno() {
                E::ENOENT => true,
                // Another process added an entry after the walk read the directory.
                E::ENOTEMPTY | E::EEXIST => false,
                _ => {
                    Output::err(err, "Could not delete {s}", (BStr::new(display),));
                    self.failed += 1;
                    false
                }
            },
        }
    }

    /// Returns whether no entry of `index` is left. `parent` holds `index` under `name`.
    fn remove_dangling_links(
        &mut self,
        index: &Dir,
        parent: &Dir,
        name: &[u8],
        prefix: &[u8],
    ) -> bool {
        let Some(entries) = read_entries(index, prefix) else {
            self.failed += 1;
            return false;
        };
        let mut left = entries.len();
        for entry in &entries {
            if entry.kind != EntryKind::SymLink {
                continue;
            }
            match bun_sys::fstatat(index.fd(), &entry.name) {
                Err(err) if err.get_errno() == E::ENOENT => {}
                _ => continue,
            }
            // The target is an absolute path, which is missing when the cache is at another path.
            let link = entry.name.as_bytes();
            if is_index_link_package_in_cache(self.cache_dir, parent.fd(), name, link) {
                continue;
            }
            let removed = bun_sys::unlinkat(index.fd(), &entry.name);
            #[cfg(windows)]
            let removed = removed.or_else(|_| bun_sys::rmdirat(index.fd(), &entry.name));
            match removed {
                Ok(()) => left -= 1,
                Err(err) if err.get_errno() == E::ENOENT => left -= 1,
                Err(err) => {
                    let display = [prefix, b"/", entry.name.as_bytes()].concat();
                    Output::err(err, "Could not delete {s}", (BStr::new(&display),));
                    self.failed += 1;
                }
            }
        }
        left == 0
    }

    /// Returns whether the package is gone.
    fn prune_package(&mut self, dir: &Dir, entry: &Entry, prefix: &[u8]) -> bool {
        let name = entry.name.as_bytes();
        let st = match bun_sys::lstatat(dir.fd(), &entry.name) {
            Ok(st) => st,
            Err(err) if err.get_errno() == E::ENOENT => return true,
            Err(err) => {
                Output::err(err, "Could not stat {s}", (BStr::new(name),));
                self.failed += 1;
                return false;
            }
        };
        self.checked += 1;
        let last_used = bun_sys::stat_mtime(&st)
            .sec
            .max(bun_sys::stat_atime(&st).sec);
        if last_used > self.cutoff_sec {
            return false;
        }

        let display = [prefix, name].concat();
        if self.dry_run {
            // The size isn't printed, because reading the directory would refresh the atime that
            // made it a candidate.
            bun_core::prettyln!("<r><red>-<r> {}", escape_control_chars(&display));
        } else {
            let size = match dir.open_at(name) {
                Ok(sub) => tree_size(&sub, &display),
                Err(_) => 0,
            };
            if let Err(err) = dir.delete_tree(name) {
                Output::err(err, "Could not delete {s}", (BStr::new(&display),));
                self.failed += 1;
                return false;
            }
            self.bytes += size;
        }
        self.removed += 1;
        !self.dry_run
    }
}

impl PmCachePruneCommand {
    /// Returns whether anything failed.
    pub(crate) fn exec(cache_path: &[u8], max_age_days: u32, dry_run: bool) -> bool {
        let cache_dir = match Dir::open(cache_path) {
            Ok(dir) => dir,
            Err(err) if err.get_errno() == E::ENOENT => {
                bun_core::prettyln!(
                    "<r><green>Done<r>! No cache directory <d>(nothing to prune)<r>"
                );
                return false;
            }
            Err(err) => {
                Output::err(err, "Could not open {s}", (BStr::new(cache_path),));
                return true;
            }
        };

        let now = bun_core::time::timestamp();
        let max_age_sec = i64::from(max_age_days) * i64::from(bun_core::time::S_PER_DAY);
        let mut prune = Prune {
            root: cache_path.to_vec(),
            cache_dir: cache_dir.fd(),
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
                "<r><b>{}<r> package{} older than {} day{} can be removed <d>(checked {})<r>",
                n,
                plural(n),
                max_age_days,
                plural(max_age_days as usize),
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
                bun_fmt::size(prune.bytes as usize, Default::default())
            );
            if prune.failed > 0 {
                bun_core::pretty!(", <red>{} failed<r>", prune.failed);
            }
            bun_core::prettyln!("");
        }
        Output::flush();
        prune.failed > 0
    }
}
