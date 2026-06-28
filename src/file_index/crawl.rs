//! Parallel, ignore-aware directory crawl on `bun_threading::WorkPool`.
//!
//! Modeled on `AsyncReaddirRecursiveTask` (`src/runtime/node/node_fs.rs`):
//! one pool task per directory fanning out under an atomic in-flight counter,
//! a shared root descriptor every task opens relative to, and results merged
//! into one owned [`CrawlResult`]. The last task to finish hands that result
//! to the caller's `Send` completion closure — this crate never touches an
//! event loop and the [`crate::Store`] is never visible to a worker.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bun_core::{ZStr, handle_oom, kind_from_mode};
use bun_ignore::{IgnoreChain, IgnoreFile, Match};
use bun_sys::{Dir, E, EntryKind as SysEntryKind, O, PosixStat, lstatat};
use bun_threading::{GuardedBy, Mutex, WorkPool};

use crate::store::{EntryKind, Meta};

/// Options for [`crawl`].
#[derive(Clone)]
pub struct CrawlOptions {
    /// Open the root through a symlink. Symlinks *inside* the tree are never
    /// followed regardless.
    pub follow_root_symlink: bool,
    /// Ignore rules in force at the root (e.g. user-supplied patterns and
    /// `.git/info/exclude`), before any `.gitignore` the crawl discovers.
    pub ignore_chain_root: IgnoreChain,
    /// Read each directory's `.gitignore` and apply it to that subtree.
    pub load_gitignore_files: bool,
    /// Stop recording entries past this count (sets `truncated`).
    pub max_entries: usize,
    /// Approximate byte cap on the result (path bytes + metadata); entries
    /// past it are dropped and `truncated` is set.
    pub budget: usize,
}

impl Default for CrawlOptions {
    fn default() -> CrawlOptions {
        CrawlOptions {
            follow_root_symlink: false,
            ignore_chain_root: IgnoreChain::empty(),
            load_gitignore_files: true,
            max_entries: usize::MAX,
            budget: usize::MAX,
        }
    }
}

/// The crawl's owned, inert output: relative `/`-separated paths (no leading
/// `./`, root not included) and their lstat metadata.
#[derive(Default)]
pub struct CrawlResult {
    pub entries: Vec<(Vec<u8>, Meta)>,
    /// Number of `.gitignore` files parsed.
    pub gitignore_count: usize,
    /// Directories or entries that could not be opened/stat'ed. The crawl
    /// keeps going; this is a count, not a fatal condition — except that a
    /// root that cannot be opened yields an otherwise empty result.
    pub errors: usize,
    /// `max_entries` or `budget` was hit; the result is incomplete.
    pub truncated: bool,
}

/// Crawl `root_abs` in parallel and hand the completed [`CrawlResult`] to
/// `on_done` (invoked exactly once, on whichever pool thread finishes last —
/// or synchronously on the caller's thread if the root cannot be opened).
pub fn crawl(
    root_abs: &[u8],
    options: CrawlOptions,
    on_done: impl FnOnce(CrawlResult) + Send + 'static,
) {
    let mut flags = O::CLOEXEC;
    if !options.follow_root_symlink {
        flags |= O::NOFOLLOW;
    }
    let root = match Dir::open_with(root_abs, flags) {
        Ok(dir) => dir,
        Err(_) => {
            on_done(CrawlResult {
                errors: 1,
                ..CrawlResult::default()
            });
            return;
        }
    };
    let shared = Arc::new(Shared {
        root,
        load_gitignore: options.load_gitignore_files,
        max_entries: options.max_entries,
        budget: options.budget,
        pending: AtomicUsize::new(1),
        entry_count: AtomicUsize::new(0),
        approx_bytes: AtomicUsize::new(0),
        gitignore_count: AtomicUsize::new(0),
        errors: AtomicUsize::new(0),
        truncated: AtomicBool::new(false),
        entries: GuardedBy::init(Vec::new()),
        on_done: GuardedBy::init(Some(Box::new(on_done))),
    });
    schedule_dir(DirJob {
        shared,
        rel: Vec::new(),
        chain: options.ignore_chain_root,
    });
}

type OnDone = Box<dyn FnOnce(CrawlResult) + Send>;

/// State shared by every in-flight directory task of one crawl.
struct Shared {
    root: Dir,
    load_gitignore: bool,
    max_entries: usize,
    budget: usize,
    /// In-flight directory tasks plus one for the crawl itself until the
    /// root task is scheduled. The task that drops it to zero completes.
    pending: AtomicUsize,
    entry_count: AtomicUsize,
    approx_bytes: AtomicUsize,
    gitignore_count: AtomicUsize,
    errors: AtomicUsize,
    truncated: AtomicBool,
    entries: GuardedBy<Vec<(Vec<u8>, Meta)>, Mutex>,
    on_done: GuardedBy<Option<OnDone>, Mutex>,
}

/// One directory to scan. `rel` is its path relative to the root (`b""` for
/// the root itself); `chain` is the ignore chain in force *above* it.
struct DirJob {
    shared: Arc<Shared>,
    rel: Vec<u8>,
    chain: IgnoreChain,
}

/// `pending` was already incremented for this job (the root holds the
/// initial count of 1; children increment before scheduling).
fn schedule_dir(job: DirJob) {
    handle_oom(WorkPool::go(job, run_dir));
}

fn run_dir(job: DirJob) {
    let DirJob { shared, rel, chain } = job;
    process_dir(&shared, &rel, chain);
    finish_one(&shared);
}

fn process_dir(shared: &Arc<Shared>, rel: &[u8], mut chain: IgnoreChain) {
    let open_path: &[u8] = if rel.is_empty() { b"." } else { rel };
    let dir = match shared
        .root
        .open_at_with(open_path, O::NOFOLLOW | O::CLOEXEC)
    {
        Ok(dir) => dir,
        Err(_) => {
            shared.errors.fetch_add(1, Ordering::Relaxed);
            return;
        }
    };

    if shared.load_gitignore
        && let Some(file) = read_gitignore(shared, &dir, rel)
        && !file.is_empty()
    {
        chain = chain.append(file);
        shared.gitignore_count.fetch_add(1, Ordering::Relaxed);
    }

    let mut local: Vec<(Vec<u8>, Meta)> = Vec::new();
    let mut iter = bun_sys::iterate_dir(dir.fd());
    let mut name_buf: Vec<u8> = Vec::new();
    loop {
        let entry = match iter.next() {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(_) => {
                shared.errors.fetch_add(1, Ordering::Relaxed);
                break;
            }
        };
        let name = entry.name.slice_u8();
        // `.git` is always skipped, whatever the ignore rules say.
        if name == b".git" {
            continue;
        }
        // The iterator's name borrow is only valid until the next `next()`;
        // `lstatat` needs it NUL-terminated.
        name_buf.clear();
        name_buf.extend_from_slice(name);
        name_buf.push(0);
        let name_z = ZStr::from_buf(&name_buf, name_buf.len() - 1);

        let st = match lstatat(dir.fd(), name_z) {
            Ok(st) => st,
            Err(_) => {
                shared.errors.fetch_add(1, Ordering::Relaxed);
                continue;
            }
        };
        let stat = PosixStat::init(&st);
        let Some(kind) = entry_kind(&stat) else {
            // Sockets, fifos, devices: not indexable.
            continue;
        };

        let name = &name_buf[..name_buf.len() - 1];
        let mut rel_child = Vec::with_capacity(rel.len() + 1 + name.len());
        if !rel.is_empty() {
            rel_child.extend_from_slice(rel);
            rel_child.push(b'/');
        }
        rel_child.extend_from_slice(name);

        let is_dir = kind == EntryKind::Dir;
        // The walker prunes ignored directories (it never descends into
        // them), so the ancestors-already-checked fast path applies.
        if chain.matches(&rel_child, is_dir) == Match::Ignore {
            continue;
        }
        if !shared.admit(rel_child.len()) {
            continue;
        }
        if is_dir {
            shared.pending.fetch_add(1, Ordering::Relaxed);
            schedule_dir(DirJob {
                shared: Arc::clone(shared),
                rel: rel_child.clone(),
                chain: chain.clone(),
            });
        }
        local.push((rel_child, meta_from_stat(&stat, kind)));
    }

    if !local.is_empty() {
        shared.entries.lock().append(&mut local);
    }
}

/// Decrement the in-flight count; the task that reaches zero owns completion.
fn finish_one(shared: &Arc<Shared>) {
    // AcqRel: the completing thread must observe every other task's counter
    // and result writes (the entries themselves are also ordered by the
    // `entries` mutex).
    if shared.pending.fetch_sub(1, Ordering::AcqRel) != 1 {
        return;
    }
    let entries = core::mem::take(&mut *shared.entries.lock());
    let result = CrawlResult {
        entries,
        gitignore_count: shared.gitignore_count.load(Ordering::Relaxed),
        errors: shared.errors.load(Ordering::Relaxed),
        truncated: shared.truncated.load(Ordering::Relaxed),
    };
    // `on_done` is taken exactly once: only one task can see `pending == 0`.
    let on_done = shared.on_done.lock().take();
    if let Some(on_done) = on_done {
        on_done(result);
    }
}

impl Shared {
    /// Reserve one entry against the entry and byte limits, or set
    /// `truncated` and reject (rolling the counters back so later, smaller
    /// entries can still fit under the byte budget).
    fn admit(&self, path_len: usize) -> bool {
        if self.entry_count.fetch_add(1, Ordering::Relaxed) >= self.max_entries {
            self.entry_count.fetch_sub(1, Ordering::Relaxed);
            self.truncated.store(true, Ordering::Relaxed);
            return false;
        }
        let cost = path_len + core::mem::size_of::<Meta>();
        let before = self.approx_bytes.fetch_add(cost, Ordering::Relaxed);
        if before.saturating_add(cost) > self.budget {
            self.approx_bytes.fetch_sub(cost, Ordering::Relaxed);
            self.entry_count.fetch_sub(1, Ordering::Relaxed);
            self.truncated.store(true, Ordering::Relaxed);
            return false;
        }
        true
    }
}

/// Read and parse `<dir>/.gitignore`, anchored at `rel` (the directory's
/// path relative to the index root). Absent files are normal; anything else
/// unreadable counts as an error.
fn read_gitignore(shared: &Arc<Shared>, dir: &Dir, rel: &[u8]) -> Option<IgnoreFile> {
    let file = match dir.open_file(b".gitignore", O::RDONLY | O::NOFOLLOW | O::CLOEXEC, 0) {
        Ok(file) => file,
        Err(err) => {
            if err.get_errno() != E::ENOENT {
                shared.errors.fetch_add(1, Ordering::Relaxed);
            }
            return None;
        }
    };
    match file.read_to_end() {
        Ok(bytes) => Some(IgnoreFile::parse(rel, &bytes)),
        Err(_) => {
            shared.errors.fetch_add(1, Ordering::Relaxed);
            None
        }
    }
}

fn entry_kind(stat: &PosixStat) -> Option<EntryKind> {
    match kind_from_mode(stat.mode as bun_core::Mode) {
        SysEntryKind::Directory => Some(EntryKind::Dir),
        SysEntryKind::File => Some(EntryKind::File),
        SysEntryKind::SymLink => Some(EntryKind::Symlink),
        _ => None,
    }
}

fn meta_from_stat(stat: &PosixStat, kind: EntryKind) -> Meta {
    Meta {
        size: stat.size,
        mode: stat.mode as u32,
        mtime_s: stat.mtim.sec,
        mtime_ns: stat.mtim.nsec as u32,
        ctime_s: stat.ctim.sec,
        ctime_ns: stat.ctim.nsec as u32,
        dev: stat.dev,
        ino: stat.ino,
        uid: stat.uid as u32,
        gid: stat.gid as u32,
        kind,
    }
}

#[cfg(test)]
mod tests {
    use core::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use bun_core::Fd;
    use bun_sys::File;
    use bun_threading::ResetEvent;

    use super::*;
    use crate::store::Store;

    fn join(a: &[u8], b: &[u8]) -> Vec<u8> {
        let mut v = a.to_vec();
        if !v.ends_with(b"/") {
            v.push(b'/');
        }
        v.extend_from_slice(b);
        v
    }

    /// A unique directory under the OS temp dir, recursively deleted on
    /// drop. All file I/O goes through `bun_sys`.
    struct TempTree {
        parent: Vec<u8>,
        name: Vec<u8>,
        root: Vec<u8>,
    }

    impl TempTree {
        fn new(tag: &str) -> TempTree {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let parent = std::env::temp_dir().as_os_str().as_encoded_bytes().to_vec();
            let name = format!(
                "bun_file_index_test_{tag}_{}_{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            )
            .into_bytes();
            let root = join(&parent, &name);
            Dir::open(&parent)
                .expect("temp dir must exist")
                .make_path(&name)
                .expect("create test root");
            TempTree { parent, name, root }
        }

        fn dir(&self, rel: &[u8]) {
            Dir::open(&self.root).unwrap().make_path(rel).unwrap();
        }

        fn file(&self, rel: &[u8], contents: &[u8]) {
            if let Some(slash) = memchr::memrchr(b'/', rel) {
                self.dir(&rel[..slash]);
            }
            let f = File::openat(
                Fd::cwd(),
                &join(&self.root, rel),
                O::WRONLY | O::CREAT | O::TRUNC,
                0o644,
            )
            .unwrap();
            f.write_all(contents).unwrap();
        }

        fn symlink(&self, target: &[u8], rel_link: &[u8]) {
            Dir::open(&self.root)
                .unwrap()
                .sym_link(target, rel_link, true)
                .unwrap();
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            if let Ok(dir) = Dir::open(&self.parent) {
                let _ = dir.delete_tree(&self.name);
            }
        }
    }

    /// Run a crawl on the real work pool and block until its completion
    /// closure fires (awaiting the condition, never sleeping).
    fn run_crawl(root: &[u8], options: CrawlOptions) -> CrawlResult {
        // Pool worker threads call `Output::Source::configure_named_thread`,
        // which requires the process-wide output streams that `main` sets up
        // in the real binary.
        static OUTPUT_INIT: bun_threading::Once = bun_threading::Once::new();
        OUTPUT_INIT.call_once(bun_core::output::init_test);
        struct Done {
            result: GuardedBy<Option<CrawlResult>, Mutex>,
            event: ResetEvent,
        }
        let done = Arc::new(Done {
            result: GuardedBy::init(None),
            event: ResetEvent::new(),
        });
        let tx = Arc::clone(&done);
        crawl(root, options, move |res| {
            *tx.result.lock() = Some(res);
            tx.event.set();
        });
        done.event.wait();
        let res = done.result.lock().take();
        res.expect("completion stored a result before setting the event")
    }

    fn sorted_paths(result: &CrawlResult) -> Vec<Vec<u8>> {
        let mut v: Vec<Vec<u8>> = result.entries.iter().map(|(p, _)| p.clone()).collect();
        v.sort();
        v
    }

    fn kind_of(result: &CrawlResult, path: &[u8]) -> EntryKind {
        result
            .entries
            .iter()
            .find(|(p, _)| p == path)
            .unwrap_or_else(|| panic!("missing entry {:?}", path.escape_ascii().to_string()))
            .1
            .kind
    }

    /// One tree exercising nested `.gitignore`s (including a deeper `!`
    /// re-include), a `.git` directory, symlinks (directory + dangling) and
    /// a non-UTF-8 name.
    fn build_fixture(tag: &str) -> TempTree {
        let t = TempTree::new(tag);
        t.file(b".gitignore", b"ignored_dir/\n*.log\n!keep.log\n");
        t.file(b"a.txt", b"alpha\n");
        t.file(b"build.log", b"nope\n");
        t.file(b"keep.log", b"kept\n");
        t.file(b"ignored_dir/x.txt", b"pruned\n");
        t.file(b"src/.gitignore", b"generated/\n");
        t.file(b"src/main.rs", b"fn main() {}\n");
        t.file(b"src/generated/out.rs", b"pruned\n");
        t.file(b"src/sub/deep.txt", b"deep\n");
        t.file(b"logs/.gitignore", b"!important.log\n");
        t.file(b"logs/important.log", b"kept by deeper negation\n");
        t.file(b"logs/other.log", b"still ignored\n");
        t.file(b".git/config", b"[core]\n");
        t.file(b"f\xff\xfe.bin", b"\x01\x02");
        t.symlink(b"src", b"linkdir");
        t.symlink(b"nope", b"danglink");
        t
    }

    #[test]
    fn crawl_respects_gitignore_skips_git_and_never_enters_symlinks() {
        let t = build_fixture("full");
        let result = run_crawl(&t.root, CrawlOptions::default());
        assert_eq!(result.errors, 0);
        assert!(!result.truncated);
        assert_eq!(result.gitignore_count, 3);
        let expected: Vec<Vec<u8>> = [
            b".gitignore".as_slice(),
            b"a.txt",
            b"danglink",
            b"f\xff\xfe.bin",
            b"keep.log",
            b"linkdir",
            b"logs",
            b"logs/.gitignore",
            b"logs/important.log",
            b"src",
            b"src/.gitignore",
            b"src/main.rs",
            b"src/sub",
            b"src/sub/deep.txt",
        ]
        .iter()
        .map(|p| p.to_vec())
        .collect();
        assert_eq!(sorted_paths(&result), expected);
        assert_eq!(kind_of(&result, b"src"), EntryKind::Dir);
        assert_eq!(kind_of(&result, b"a.txt"), EntryKind::File);
        assert_eq!(kind_of(&result, b"linkdir"), EntryKind::Symlink);
        assert_eq!(kind_of(&result, b"danglink"), EntryKind::Symlink);
        let (_, meta) = result.entries.iter().find(|(p, _)| p == b"a.txt").unwrap();
        assert_eq!(meta.size, 6);
        assert!(meta.mtime_s > 0);

        // The owned result applies to a Store on the owning thread.
        let mut store = Store::new(1 << 22);
        store.bulk_load(result.entries);
        assert_eq!(store.len(), expected.len());
        assert!(store.get(b"src/main.rs").is_some());
        assert!(store.get(b"build.log").is_none());
        assert!(store.get(b"ignored_dir/x.txt").is_none());
        assert!(store.get(b".git/config").is_none());
        assert!(store.get(b"linkdir/main.rs").is_none());
    }

    #[test]
    fn root_ignore_chain_applies_without_loading_gitignore_files() {
        let t = build_fixture("nogit");
        let chain = IgnoreChain::empty().append(IgnoreFile::from_lines(b"", [b"*.log".as_slice()]));
        let result = run_crawl(
            &t.root,
            CrawlOptions {
                load_gitignore_files: false,
                ignore_chain_root: chain,
                ..CrawlOptions::default()
            },
        );
        assert_eq!(result.gitignore_count, 0);
        let got = sorted_paths(&result);
        // `.gitignore` semantics were NOT applied: ignored_dir is present...
        assert!(got.contains(&b"ignored_dir/x.txt".to_vec()));
        // ...but the caller-supplied chain is: no `.log` anywhere, including
        // the `!keep.log` re-include that only exists in the unloaded file.
        assert!(!got.iter().any(|p| p.ends_with(b".log")));
        assert!(got.contains(&b"src/generated/out.rs".to_vec()));
    }

    #[test]
    fn max_entries_truncates_without_panicking() {
        let t = build_fixture("max");
        let result = run_crawl(
            &t.root,
            CrawlOptions {
                max_entries: 3,
                ..CrawlOptions::default()
            },
        );
        assert!(result.truncated);
        assert!(result.entries.len() <= 3, "got {}", result.entries.len());
    }

    #[test]
    fn byte_budget_truncates_and_never_records_past_it() {
        let t = build_fixture("budget");
        let budget = 1usize;
        let result = run_crawl(
            &t.root,
            CrawlOptions {
                budget,
                ..CrawlOptions::default()
            },
        );
        assert!(result.truncated);
        assert!(result.entries.is_empty());

        // A budget that admits a few entries stays within it.
        let budget = 3 * (core::mem::size_of::<Meta>() + 16);
        let result = run_crawl(
            &t.root,
            CrawlOptions {
                budget,
                ..CrawlOptions::default()
            },
        );
        assert!(result.truncated);
        let cost: usize = result
            .entries
            .iter()
            .map(|(p, _)| p.len() + core::mem::size_of::<Meta>())
            .sum();
        assert!(cost <= budget, "cost {cost} > budget {budget}");
    }

    #[test]
    fn missing_root_reports_an_error_and_an_empty_result() {
        let t = TempTree::new("missing");
        let missing = join(&t.root, b"does_not_exist");
        let result = run_crawl(&missing, CrawlOptions::default());
        assert_eq!(result.errors, 1);
        assert!(result.entries.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn root_symlink_is_followed_only_when_asked() {
        let t = TempTree::new("rootlink");
        t.file(b"real/inner.txt", b"x");
        t.symlink(b"real", b"rootlink");
        let link = join(&t.root, b"rootlink");

        let closed = run_crawl(&link, CrawlOptions::default());
        assert_eq!(closed.errors, 1);
        assert!(closed.entries.is_empty());

        let followed = run_crawl(
            &link,
            CrawlOptions {
                follow_root_symlink: true,
                ..CrawlOptions::default()
            },
        );
        assert_eq!(followed.errors, 0);
        assert_eq!(sorted_paths(&followed), vec![b"inner.txt".to_vec()]);
    }

    #[test]
    fn empty_directory_completes_with_no_entries() {
        let t = TempTree::new("empty");
        let result = run_crawl(&t.root, CrawlOptions::default());
        assert!(result.entries.is_empty());
        assert_eq!(result.errors, 0);
        assert!(!result.truncated);
    }

    #[test]
    fn wide_and_deep_tree_is_fully_indexed_in_parallel() {
        let t = TempTree::new("wide");
        let mut expected = 0usize;
        for d in 0..8u32 {
            for f in 0..16u32 {
                t.file(format!("d{d}/sub/f{f}.txt").into_bytes().as_slice(), b"x");
                expected += 1;
            }
        }
        // 8 dirs + 8 "sub" dirs + the files.
        expected += 16;
        let result = run_crawl(&t.root, CrawlOptions::default());
        assert_eq!(result.errors, 0);
        assert_eq!(result.entries.len(), expected);
        let mut store = Store::new(1 << 24);
        store.bulk_load(result.entries);
        assert_eq!(store.len(), expected);
        assert_eq!(store.range_with_prefix(b"d3/sub/").count(), 16);
    }
}
