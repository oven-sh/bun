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
use bun_ignore::{IgnoreChain, IgnoreFile};
use bun_sys::{Dir, EntryKind as SysEntryKind, O, PosixStat, lstatat};
use bun_threading::{GuardedBy, Mutex, WorkPool};

use crate::exempt::{ExemptSet, classify_entry};
use crate::store::{EntryKind, Meta};

/// One enumerated entry: its path relative to the crawl root and the kind
/// the dirent reported. The crawl never stats regular entries (an lstat per
/// entry faults in every inode — catastrophic on a cold cache), so there is
/// deliberately no per-entry stat data here; see [`crate::Store::stat`].
pub type CrawlEntry = (Vec<u8>, EntryKind);

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
    /// Paths the ignore rules must never drop (git's tracked files under the
    /// root) and the directories that contain them. Built by the caller —
    /// this crate never reads `.git` — and consulted, with the ignore chain,
    /// through [`classify_entry`] for every enumerated entry (the same call
    /// is the directory-pruning decision). Default: empty (pure gitignore
    /// semantics).
    pub exempt: Arc<ExemptSet>,
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
            exempt: ExemptSet::none(),
            max_entries: usize::MAX,
            budget: usize::MAX,
        }
    }
}

/// The crawl's owned, inert output: relative `/`-separated paths (no leading
/// `./`, root not included) and their dirent kinds.
#[derive(Default)]
pub struct CrawlResult {
    /// Every recorded entry. [`crawl_batched`] delivers entries through
    /// `on_batch` instead and leaves this empty.
    pub entries: Vec<CrawlEntry>,
    /// Number of `.gitignore` files parsed.
    pub gitignore_count: usize,
    /// Directories or entries that could not be opened/stat'ed. The crawl
    /// keeps going; this is a count, not a fatal condition — except that a
    /// root that cannot be opened yields an otherwise empty result.
    pub errors: usize,
    /// `max_entries` or `budget` was hit; the result is incomplete.
    pub truncated: bool,
    /// The [`CrawlOptions::exempt`] set this crawl was filtered through,
    /// handed back so the caller's watcher can keep applying the same
    /// exemption to events until the next (re)crawl rebuilds it.
    pub exempt: Arc<ExemptSet>,
}

/// Entries accumulated across completed directories before `on_batch` is
/// invoked with them. The last batch of a crawl is whatever is left and may
/// be smaller; a single huge directory may exceed it.
const BATCH_TARGET: usize = 4096;

/// Crawl `root_abs` in parallel and hand the completed [`CrawlResult`] to
/// `on_done` (invoked exactly once, on whichever pool thread finishes last —
/// or synchronously on the caller's thread if the root cannot be opened).
/// The result's `entries` holds every recorded entry.
pub fn crawl(
    root_abs: &[u8],
    options: CrawlOptions,
    on_done: impl FnOnce(CrawlResult) + Send + 'static,
) {
    let acc: Arc<GuardedBy<Vec<CrawlEntry>, Mutex>> = Arc::new(GuardedBy::init(Vec::new()));
    let sink = Arc::clone(&acc);
    crawl_batched(
        root_abs,
        options,
        move |mut batch| sink.lock().append(&mut batch),
        move |mut result| {
            result.entries = core::mem::take(&mut *acc.lock());
            on_done(result);
        },
    );
}

/// [`crawl`], delivered incrementally: `on_batch` receives chunks of roughly
/// [`BATCH_TARGET`] entries as directories complete (plus the final partial
/// chunk). Every recorded entry is passed to `on_batch` exactly once;
/// `on_done` receives only the counters and flags (its `entries` is empty).
///
/// Threading contract: `on_batch` runs on pool worker threads, concurrently
/// with other `on_batch` calls for the same crawl, in no particular order.
/// Every `on_batch` call returns before `on_done` runs (on the last worker's
/// thread, or the caller's if the root cannot be opened).
pub fn crawl_batched(
    root_abs: &[u8],
    options: CrawlOptions,
    on_batch: impl Fn(Vec<CrawlEntry>) + Send + Sync + 'static,
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
                exempt: options.exempt,
                ..CrawlResult::default()
            });
            return;
        }
    };
    let shared = Arc::new(Shared {
        root,
        load_gitignore: options.load_gitignore_files,
        exempt: options.exempt,
        max_entries: options.max_entries,
        budget: options.budget,
        pending: AtomicUsize::new(1),
        entry_count: AtomicUsize::new(0),
        approx_bytes: AtomicUsize::new(0),
        gitignore_count: AtomicUsize::new(0),
        errors: AtomicUsize::new(0),
        truncated: AtomicBool::new(false),
        batch: GuardedBy::init(Vec::new()),
        on_batch: Box::new(on_batch),
        on_done: GuardedBy::init(Some(Box::new(on_done))),
    });
    schedule_dir(DirJob {
        shared,
        rel: Vec::new(),
        chain: options.ignore_chain_root,
        ignored: false,
    });
}

type OnDone = Box<dyn FnOnce(CrawlResult) + Send>;
type OnBatch = Box<dyn Fn(Vec<CrawlEntry>) + Send + Sync>;

/// State shared by every in-flight directory task of one crawl.
struct Shared {
    root: Dir,
    load_gitignore: bool,
    /// See [`CrawlOptions::exempt`].
    exempt: Arc<ExemptSet>,
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
    /// Entries accumulated since the last `on_batch` call.
    batch: GuardedBy<Vec<CrawlEntry>, Mutex>,
    on_batch: OnBatch,
    on_done: GuardedBy<Option<OnDone>, Mutex>,
}

/// One directory to scan. `rel` is its path relative to the root (`b""` for
/// the root itself); `chain` is the ignore chain in force *above* it.
/// `ignored` means the directory itself is ignored and was descended into
/// only because the exempt set says it contains tracked files: nothing under
/// it is kept unless the exemption admits it (git never re-includes under an
/// excluded directory), and its own `.gitignore` is not read.
struct DirJob {
    shared: Arc<Shared>,
    rel: Vec<u8>,
    chain: IgnoreChain,
    ignored: bool,
}

/// `pending` was already incremented for this job (the root holds the
/// initial count of 1; children increment before scheduling).
fn schedule_dir(job: DirJob) {
    handle_oom(WorkPool::go(job, run_dir));
}

fn run_dir(job: DirJob) {
    let DirJob {
        shared,
        rel,
        chain,
        ignored,
    } = job;
    process_dir(&shared, &rel, chain, ignored);
    finish_one(&shared);
}

fn process_dir(shared: &Arc<Shared>, rel: &[u8], mut chain: IgnoreChain, ignored: bool) {
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

    // git does not consult `.gitignore` files inside an excluded directory
    // (nothing under one can be re-included), so don't read this one's.
    if !ignored
        && shared.load_gitignore
        && let Some(file) = read_gitignore(shared, &dir, rel)
        && !file.is_empty()
    {
        chain = chain.append(file);
        shared.gitignore_count.fetch_add(1, Ordering::Relaxed);
    }

    let mut local: Vec<CrawlEntry> = Vec::new();
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
        // The iterator's name borrow is only valid until the next `next()`
        // (and `lstatat` needs it NUL-terminated).
        name_buf.clear();
        name_buf.extend_from_slice(name);
        name_buf.push(0);

        // Enumeration only: the dirent already carries the kind, and the
        // crawl needs nothing else. The single lstat below is the fallback
        // for filesystems that do not fill `d_type` (`DT_UNKNOWN`).
        let Some(kind) = entry_kind(entry.kind, || {
            let name_z = ZStr::from_buf(&name_buf, name_buf.len() - 1);
            match lstatat(dir.fd(), name_z) {
                Ok(st) => Ok(kind_from_mode(PosixStat::init(&st).mode as bun_core::Mode)),
                Err(err) => {
                    shared.errors.fetch_add(1, Ordering::Relaxed);
                    Err(err)
                }
            }
        }) else {
            // Sockets, fifos, devices (or an unstattable DT_UNKNOWN entry):
            // not indexable.
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
        // The one shared ignore decision: per-entry filtering and directory
        // pruning are the same call. The walker prunes a `Drop` directory
        // (it never descends into it), so the ancestors-already-checked fast
        // path of `IgnoreChain::matches` applies; an ignored directory the
        // exempt set refuses to prune (`KeepIgnored`) is descended into with
        // `ignored = true` so nothing inside it is kept unless exempt.
        let verdict = classify_entry(&chain, ignored, &shared.exempt, &rel_child, is_dir);
        if verdict.is_dropped() {
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
                ignored: verdict.is_ignored(),
            });
        }
        local.push((rel_child, kind));
    }

    if !local.is_empty() {
        shared.push_entries(&mut local);
    }
}

/// Decrement the in-flight count; the task that reaches zero owns completion.
fn finish_one(shared: &Arc<Shared>) {
    // AcqRel: the completing thread must observe every other task's counter
    // and result writes (the entries themselves are also ordered by the
    // `batch` mutex). Every other task's `on_batch` call has returned (a
    // task only decrements after `process_dir`), so the final flush below is
    // the last one.
    if shared.pending.fetch_sub(1, Ordering::AcqRel) != 1 {
        return;
    }
    let last = core::mem::take(&mut *shared.batch.lock());
    if !last.is_empty() {
        (shared.on_batch)(last);
    }
    let result = CrawlResult {
        entries: Vec::new(),
        gitignore_count: shared.gitignore_count.load(Ordering::Relaxed),
        errors: shared.errors.load(Ordering::Relaxed),
        truncated: shared.truncated.load(Ordering::Relaxed),
        exempt: Arc::clone(&shared.exempt),
    };
    // `on_done` is taken exactly once: only one task can see `pending == 0`.
    let on_done = shared.on_done.lock().take();
    if let Some(on_done) = on_done {
        on_done(result);
    }
}

impl Shared {
    /// Stage a completed directory's entries and hand off a batch once
    /// [`BATCH_TARGET`] is reached. The lock is released before `on_batch`
    /// runs, so batch callbacks never serialize the walkers.
    fn push_entries(&self, local: &mut Vec<CrawlEntry>) {
        let full = {
            let mut batch = self.batch.lock();
            batch.append(local);
            if batch.len() >= BATCH_TARGET {
                Some(core::mem::take(&mut *batch))
            } else {
                None
            }
        };
        if let Some(full) = full {
            (self.on_batch)(full);
        }
    }

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
/// path relative to the index root). Absent files are normal; a `.gitignore`
/// that is not a regular file (a writer-less FIFO blocks a plain `open(2)`
/// in the kernel forever, a symlink can point anywhere) is treated as
/// absent; anything else unreadable counts as an error.
fn read_gitignore(shared: &Arc<Shared>, dir: &Dir, rel: &[u8]) -> Option<IgnoreFile> {
    match crate::read::read_regular_at(dir.fd(), b".gitignore", u64::MAX) {
        Ok(crate::read::FileReadOutcome::Contents(bytes)) => Some(IgnoreFile::parse(rel, &bytes)),
        Ok(_) => None,
        Err(_) => {
            shared.errors.fetch_add(1, Ordering::Relaxed);
            None
        }
    }
}

/// The indexable kind of a dirent, or `None` for sockets, fifos and devices.
///
/// `DT_UNKNOWN` — a filesystem that does not fill `d_type` — falls back to
/// `lstat_kind` (one `lstat` of that entry). That is the ONLY per-entry stat
/// the crawl ever performs: everything it indexes carries its kind in the
/// `getdents` record, so the crawl never faults in regular entries' inodes.
fn entry_kind(
    dirent: SysEntryKind,
    lstat_kind: impl FnOnce() -> Result<SysEntryKind, bun_sys::Error>,
) -> Option<EntryKind> {
    let kind = match dirent {
        SysEntryKind::Unknown => lstat_kind().ok()?,
        known => known,
    };
    match kind {
        SysEntryKind::Directory => Some(EntryKind::Dir),
        SysEntryKind::File => Some(EntryKind::File),
        SysEntryKind::SymLink => Some(EntryKind::Symlink),
        _ => None,
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

        /// A FIFO with no writer: a blocking `open(2)` on it wedges the
        /// calling thread in the kernel until a writer appears.
        #[cfg(unix)]
        fn fifo(&self, rel: &[u8]) {
            if let Some(slash) = memchr::memrchr(b'/', rel) {
                self.dir(&rel[..slash]);
            }
            let mut path = join(&self.root, rel);
            path.push(0);
            // SAFETY: `path` is NUL-terminated and outlives the call.
            let rc = unsafe { libc::mkfifo(path.as_ptr().cast(), 0o644) };
            assert_eq!(rc, 0, "mkfifo");
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

    /// Pool worker threads call `Output::Source::configure_named_thread`,
    /// which requires the process-wide output streams that `main` sets up
    /// in the real binary.
    fn init_test_output() {
        static OUTPUT_INIT: bun_threading::Once = bun_threading::Once::new();
        OUTPUT_INIT.call_once(bun_core::output::init_test);
    }

    /// Run a crawl on the real work pool and block until its completion
    /// closure fires (awaiting the condition, never sleeping).
    fn run_crawl(root: &[u8], options: CrawlOptions) -> CrawlResult {
        init_test_output();
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

    /// [`run_crawl`] for [`crawl_batched`]: returns every batch in delivery
    /// order plus the (entry-less) result.
    fn run_crawl_batched(
        root: &[u8],
        options: CrawlOptions,
    ) -> (Vec<Vec<CrawlEntry>>, CrawlResult) {
        init_test_output();
        struct Done {
            batches: GuardedBy<Vec<Vec<CrawlEntry>>, Mutex>,
            result: GuardedBy<Option<CrawlResult>, Mutex>,
            event: ResetEvent,
        }
        let done = Arc::new(Done {
            batches: GuardedBy::init(Vec::new()),
            result: GuardedBy::init(None),
            event: ResetEvent::new(),
        });
        let on_batch_done = Arc::clone(&done);
        let on_done_done = Arc::clone(&done);
        crawl_batched(
            root,
            options,
            move |batch| on_batch_done.batches.lock().push(batch),
            move |res| {
                *on_done_done.result.lock() = Some(res);
                on_done_done.event.set();
            },
        );
        done.event.wait();
        let batches = core::mem::take(&mut *done.batches.lock());
        let res = done.result.lock().take();
        (
            batches,
            res.expect("completion stored a result before setting the event"),
        )
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

        // The owned result applies to a Store on the owning thread.
        let mut store = Store::new(1 << 22);
        store.bulk_load_enumerated(result.entries);
        assert_eq!(store.len(), expected.len());
        assert!(store.get(b"src/main.rs").is_some());
        assert!(store.get(b"build.log").is_none());
        assert!(store.get(b"ignored_dir/x.txt").is_none());
        assert!(store.get(b".git/config").is_none());
        assert!(store.get(b"linkdir/main.rs").is_none());
    }

    /// Maintainer rule: with `gitignore: true` inside a repository, the
    /// indexed set is git's real file set — tracked ∪ (untracked − ignored).
    /// A tracked file matching an ignore rule is indexed, and an ignored
    /// directory containing tracked files is not pruned, but the *untracked*
    /// contents of that directory stay hidden.
    #[test]
    fn exempt_tracked_paths_survive_ignore_rules() {
        let t = TempTree::new("exempt");
        t.file(b".gitignore", b"*.log\nignored_dir/\n.env\n");
        t.file(b"a.txt", b"alpha\n");
        t.file(b"build.log", b"tracked but ignored\n");
        t.file(b"other.log", b"untracked, ignored\n");
        t.file(b".env", b"tracked dotenv\n");
        t.file(
            b"ignored_dir/keep/me.txt",
            b"tracked, deep in an ignored dir\n",
        );
        t.file(b"ignored_dir/keep/junk.txt", b"untracked sibling\n");
        t.file(b"ignored_dir/junk.txt", b"untracked\n");
        // A `.gitignore` inside an excluded directory is never consulted:
        // its `!junk.txt` must not re-include the untracked sibling.
        t.file(b"ignored_dir/keep/.gitignore", b"!junk.txt\n");
        let exempt = Arc::new(ExemptSet::from_files([
            b"build.log".as_slice(),
            b".env",
            b"ignored_dir/keep/me.txt",
        ]));
        let result = run_crawl(
            &t.root,
            CrawlOptions {
                exempt: Arc::clone(&exempt),
                ..CrawlOptions::default()
            },
        );
        assert_eq!(result.errors, 0);
        let expected: Vec<Vec<u8>> = [
            b".env".as_slice(),
            b".gitignore",
            b"a.txt",
            b"build.log",
            b"ignored_dir",
            b"ignored_dir/keep",
            b"ignored_dir/keep/me.txt",
        ]
        .iter()
        .map(|p| p.to_vec())
        .collect();
        assert_eq!(sorted_paths(&result), expected);
        assert_eq!(kind_of(&result, b"build.log"), EntryKind::File);
        assert_eq!(kind_of(&result, b"ignored_dir"), EntryKind::Dir);
        // The set that filtered the crawl is handed back for the watcher.
        assert!(Arc::ptr_eq(&result.exempt, &exempt));

        // No exemption set: the pure-gitignore behavior is byte-identical
        // to before (every ignored path is dropped, the directory pruned).
        let bare = run_crawl(&t.root, CrawlOptions::default());
        assert_eq!(
            sorted_paths(&bare),
            vec![b".gitignore".to_vec(), b"a.txt".to_vec()]
        );
        assert!(bare.exempt.is_empty());
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
        store.bulk_load_enumerated(result.entries);
        assert_eq!(store.len(), expected);
        assert_eq!(store.range_with_prefix(b"d3/sub/").count(), 16);
    }

    /// A writer-less FIFO named `.gitignore` must never be opened without
    /// `O_NONBLOCK` (a blocking `open(2)` wedges the worker in the kernel and
    /// `on_done` never fires); FIFO dirents are not an indexable kind.
    #[cfg(unix)]
    #[test]
    fn fifo_gitignore_and_fifo_entries_never_block_the_crawl() {
        let t = TempTree::new("fifo");
        t.file(b"a.txt", b"alpha\n");
        t.file(b"sub/keep.txt", b"x");
        t.fifo(b"sub/.gitignore");
        t.fifo(b"pipe");
        let result = run_crawl(&t.root, CrawlOptions::default());
        assert_eq!(result.errors, 0);
        assert_eq!(result.gitignore_count, 0);
        let expected: Vec<Vec<u8>> = [b"a.txt".as_slice(), b"sub", b"sub/keep.txt"]
            .iter()
            .map(|p| p.to_vec())
            .collect();
        assert_eq!(sorted_paths(&result), expected);
    }

    /// A regular `.gitignore` is still honored with the `O_NONBLOCK` +
    /// `fstat` open path (a regular file ignores `O_NONBLOCK`).
    #[cfg(unix)]
    #[test]
    fn fifo_sibling_does_not_disable_a_regular_gitignore() {
        let t = TempTree::new("fifo_sibling");
        t.file(b".gitignore", b"*.log\n");
        t.file(b"kept.txt", b"x");
        t.file(b"dropped.log", b"x");
        t.fifo(b"pipe");
        let result = run_crawl(&t.root, CrawlOptions::default());
        assert_eq!(result.gitignore_count, 1);
        assert_eq!(
            sorted_paths(&result),
            vec![b".gitignore".to_vec(), b"kept.txt".to_vec()]
        );
    }

    #[test]
    fn crawl_batched_delivers_every_entry_exactly_once_in_chunks() {
        let t = TempTree::new("batched");
        for d in 0..44u32 {
            for f in 0..100u32 {
                t.file(format!("d{d:02}/f{f:03}.txt").into_bytes().as_slice(), b"x");
            }
        }
        let entry_count = 44 * 100 + 44;
        let (batches, result) = run_crawl_batched(&t.root, CrawlOptions::default());
        assert_eq!(result.errors, 0);
        assert!(!result.truncated);
        assert!(
            result.entries.is_empty(),
            "crawl_batched must not also buffer entries into the result"
        );
        assert!(batches.len() >= 2, "got {} batches", batches.len());
        assert!(
            batches.iter().any(|b| b.len() >= BATCH_TARGET),
            "no batch reached BATCH_TARGET"
        );
        let mut all: Vec<Vec<u8>> = batches
            .iter()
            .flat_map(|b| b.iter().map(|(p, _)| p.clone()))
            .collect();
        assert_eq!(all.len(), entry_count);
        all.sort();
        assert!(
            all.windows(2).all(|w| w[0] != w[1]),
            "an entry was delivered twice"
        );
        // The union of the batches is exactly the unbatched crawl.
        let single = run_crawl(&t.root, CrawlOptions::default());
        assert_eq!(all, sorted_paths(&single));
    }

    /// Property: over randomized trees (nested dirs, files, ignore rules),
    /// the union of `crawl_batched`'s batches equals the unbatched crawl —
    /// no duplicates, no loss, identical counters.
    #[test]
    fn crawl_batched_union_matches_unbatched_crawl_over_random_trees() {
        fn rel_join(parent: &[u8], name: &[u8]) -> Vec<u8> {
            if parent.is_empty() {
                return name.to_vec();
            }
            let mut v = parent.to_vec();
            v.push(b'/');
            v.extend_from_slice(name);
            v
        }
        for seed in [3u64, 17, 2026] {
            let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
            let mut next = move |bound: usize| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                (state % bound as u64) as usize
            };
            let t = TempTree::new(&format!("rand{seed}"));
            t.file(b".gitignore", b"*.skip\n");
            let mut dirs: Vec<Vec<u8>> = vec![Vec::new()];
            for i in 0..32u32 {
                let parent = dirs[next(dirs.len())].clone();
                let child = rel_join(&parent, format!("d{i}").as_bytes());
                t.dir(&child);
                if i == 7 {
                    t.file(&rel_join(&child, b".gitignore"), b"hidden/\n");
                    t.dir(&rel_join(&child, b"hidden"));
                    t.file(&rel_join(&child, b"hidden/h.txt"), b"x");
                }
                dirs.push(child);
            }
            for i in 0..220u32 {
                let parent = &dirs[next(dirs.len())];
                let ext = if i % 9 == 0 { "skip" } else { "txt" };
                t.file(&rel_join(parent, format!("f{i}.{ext}").as_bytes()), b"x");
            }
            let (batches, batched) = run_crawl_batched(&t.root, CrawlOptions::default());
            let single = run_crawl(&t.root, CrawlOptions::default());
            let mut union: Vec<Vec<u8>> = batches
                .iter()
                .flat_map(|b| b.iter().map(|(p, _)| p.clone()))
                .collect();
            union.sort();
            assert!(
                union.windows(2).all(|w| w[0] != w[1]),
                "seed {seed}: duplicate entry across batches"
            );
            assert_eq!(union, sorted_paths(&single), "seed {seed}");
            assert!(batched.entries.is_empty());
            assert_eq!(batched.errors, single.errors, "seed {seed}");
            assert_eq!(batched.truncated, single.truncated, "seed {seed}");
            assert_eq!(
                batched.gitignore_count, single.gitignore_count,
                "seed {seed}"
            );
        }
    }
}
