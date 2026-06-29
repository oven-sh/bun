//! The initial crawl, `refresh()`, and watcher re-crawls.
//!
//! The initial crawl is **progressive** (`bun_file_index::crawl_batched`):
//! every batch of enumerated entries is posted to the JS thread as it
//! arrives and applied to the live (empty) store, so `index.size` grows and
//! `complete()`/`glob()`/`has()` answer on partial data before `ready`
//! resolves — `ready` still means "complete". `refresh()` and watcher
//! re-crawls replace an existing store, so they stay atomic: the buffered
//! result is applied once, on completion.
//!
//! # Ownership across threads
//!
//! One heap [`CrawlTask`] per crawl, owned by whoever holds its
//! [`Completion`] handle. The handle lives in the [`Outbox`] (an `Arc` the
//! pool-side closures share) while the task is parked, and in the VM's
//! concurrent queue while a dispatch is in flight — never both, so the same
//! allocation is safely re-enqueued once per delivery. Its `Strong` pins the
//! `FileIndex` wrapper for the whole crawl; only the LAST delivery (the one
//! carrying `done`) consumes the task and releases it.

use core::ptr::NonNull;
use std::sync::Arc;

use bun_core::handle_oom;
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_file_index::{CrawlEntry, CrawlOptions, CrawlResult, ExemptSet, crawl, crawl_batched};
use bun_ignore::IgnoreChain;
use bun_io::KeepAlive;
use bun_jsc::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSPromiseStrong, JSValue, JsTerminated, Strong, SysErrorJsc as _};
use bun_sys::{Dir, O};
use bun_threading::{GuardedBy, Mutex, WorkPool};

use super::FileIndex;

/// Why a crawl was started; decides what its deliveries do on the JS thread.
pub(crate) enum Purpose {
    /// `new FileIndex()`: progressive — each batch is applied to the live
    /// store on arrival; completion settles the `Promise<FileIndex>`.
    Initial(JSPromiseStrong),
    /// `refresh()`: buffered — the completed result replaces the store.
    Refresh(JSPromiseStrong),
    /// Watcher-initiated background re-crawl (a `.gitignore` changed, or the
    /// OS event queue overflowed). There is no promise to settle; the diff
    /// between the old and new index is delivered through `onchange`.
    WatcherRecrawl,
}

/// One in-flight crawl. Heap-allocated on the JS thread; only its address
/// crosses threads (inside [`Completion`]). The `Strong` keeps the
/// `FileIndex` wrapper — and therefore the native `FileIndex` the deliveries
/// write back into — alive for exactly as long as the crawl is in flight.
pub struct CrawlTask {
    this_strong: Strong,
    purpose: Purpose,
    /// `bun_vm_ptr()` has write provenance and is valid for the process
    /// lifetime (see `Archive::AsyncTask::create`).
    vm: *mut VirtualMachine,
    concurrent_task: ConcurrentTask,
    keep_alive: KeepAlive,
    outbox: Arc<Outbox>,
}

impl Taskable for CrawlTask {
    const TAG: TaskTag = task_tag::FileIndexCrawlTask;
}

/// Everything the pool side has produced and the JS thread has not yet
/// consumed, plus the (single) right to enqueue the owning [`CrawlTask`].
struct Inbox {
    /// Progressive batches (initial crawl only), in delivery order.
    batches: Vec<Vec<CrawlEntry>>,
    /// Set exactly once, by `on_done` (or by `start_with` for a root that
    /// failed to open).
    done: Option<Result<CrawlResult, bun_sys::Error>>,
    /// `Some` while the task is parked (no dispatch in flight). A poster
    /// that takes it must enqueue it; a poster that finds it absent relies
    /// on the in-flight dispatch re-checking the inbox before re-parking.
    /// Once the task is consumed (completion or shutdown release) it is
    /// never re-armed and stays `None`.
    handle: Option<Completion>,
}

/// Shared by the JS thread and the crawl's pool-side closures.
struct Outbox {
    inbox: GuardedBy<Inbox, Mutex>,
}

impl Outbox {
    /// Record a batch and/or the completed result and, if the task is
    /// parked, enqueue it. Runs on pool threads (and on the JS thread for a
    /// root that failed to open).
    fn post(
        &self,
        batch: Option<Vec<CrawlEntry>>,
        done: Option<Result<CrawlResult, bun_sys::Error>>,
    ) {
        let handle = {
            let mut inbox = self.inbox.lock();
            if let Some(batch) = batch {
                inbox.batches.push(batch);
            }
            if done.is_some() {
                debug_assert!(inbox.done.is_none(), "a crawl completes exactly once");
                inbox.done = done;
            }
            inbox.handle.take()
        };
        if let Some(handle) = handle {
            handle.enqueue();
        }
    }
}

/// Start the constructor's progressive crawl of `index.root` and return the
/// `Promise<FileIndex>` that its completion settles. The root is opened
/// here, on the JS thread, so a nonexistent root rejects with the real
/// syscall error instead of being indistinguishable from an empty directory.
pub(crate) fn start_initial(
    global: &JSGlobalObject,
    this_value: JSValue,
    index: &FileIndex,
) -> JSValue {
    let promise = JSPromiseStrong::init(global);
    let promise_js = promise.value();
    start_with(global, this_value, index, Purpose::Initial(promise));
    promise_js
}

/// Start a `refresh()` re-crawl; resolves with `this` once the completed
/// result has replaced the store.
pub(crate) fn start_refresh(
    global: &JSGlobalObject,
    this_value: JSValue,
    index: &FileIndex,
) -> JSValue {
    let promise = JSPromiseStrong::init(global);
    let promise_js = promise.value();
    start_with(global, this_value, index, Purpose::Refresh(promise));
    promise_js
}

/// Start a watcher-initiated background re-crawl. No promise is created: a
/// failure (e.g. the root disappeared) must not surface as an unhandled
/// rejection from inside the watcher.
pub(crate) fn start_recrawl(global: &JSGlobalObject, this_value: JSValue, index: &FileIndex) {
    start_with(global, this_value, index, Purpose::WatcherRecrawl);
}

fn start_with(global: &JSGlobalObject, this_value: JSValue, index: &FileIndex, purpose: Purpose) {
    let root_error = Dir::open_with(index.root_bytes(), O::CLOEXEC).err();
    let progressive = matches!(purpose, Purpose::Initial(_));

    let outbox = Arc::new(Outbox {
        inbox: GuardedBy::init(Inbox {
            batches: Vec::new(),
            done: None,
            handle: None,
        }),
    });
    let mut task = Box::new(CrawlTask {
        this_strong: Strong::create(this_value, global),
        purpose,
        vm: global.bun_vm_ptr(),
        concurrent_task: ConcurrentTask::default(),
        keep_alive: KeepAlive::default(),
        outbox: Arc::clone(&outbox),
    });
    // Keep the event loop alive until `run_from_js` settles the promise.
    task.keep_alive.ref_(bun_io::js_vm_ctx());

    let options = CrawlOptions {
        // The user named this directory explicitly; symlinks *inside* the
        // tree are still never followed.
        follow_root_symlink: true,
        ignore_chain_root: index.root_ignore_chain(),
        load_gitignore_files: index.options().gitignore,
        // Placeholder: the real exemption set is built by `run_setup` on the
        // work pool (it reads `.git/index`), never on the JS thread.
        exempt: ExemptSet::none(),
        max_entries: usize::MAX,
        budget: index.options().max_memory,
    };

    let handle = Completion(bun_core::heap::into_raw(task));
    if let Some(err) = root_error {
        outbox.inbox.lock().done = Some(Err(err));
        handle.enqueue();
        return;
    }
    outbox.inbox.lock().handle = Some(handle);
    // The rest of the setup — repository discovery and the `.git/index` read
    // that build the ignore exemption set — is I/O and must not block the JS
    // thread: hop to the pool, then fan the crawl out from there.
    handle_oom(WorkPool::go(
        SetupJob {
            root: index.root_bytes().to_vec(),
            gitignore: index.options().gitignore,
            user_ignore: index
                .user_ignore_file()
                .map_or_else(IgnoreChain::empty, |file| IgnoreChain::empty().append(file)),
            options,
            progressive,
            outbox,
        },
        run_setup,
    ));
}

/// Owned, `Send` inputs of [`run_setup`].
struct SetupJob {
    root: Vec<u8>,
    gitignore: bool,
    /// The `ignore:` option alone (see [`FileIndex::user_ignore_file`]).
    user_ignore: IgnoreChain,
    options: CrawlOptions,
    progressive: bool,
    outbox: Arc<Outbox>,
}

/// Pool-side start of every crawl (initial, `refresh()`, watcher re-crawl):
/// build this crawl's gitignore exemption set, then fan the walk out.
fn run_setup(job: SetupJob) {
    let SetupJob {
        root,
        gitignore,
        user_ignore,
        mut options,
        progressive,
        outbox,
    } = job;
    options.exempt = build_exempt_set(&root, gitignore, &user_ignore);
    let done_outbox = Arc::clone(&outbox);
    let on_done = move |result: CrawlResult| done_outbox.post(None, Some(Ok(result)));
    if progressive {
        let batch_outbox = Arc::clone(&outbox);
        crawl_batched(
            &root,
            options,
            move |batch| batch_outbox.post(Some(batch), None),
            on_done,
        );
    } else {
        crawl(&root, options, on_done);
    }
}

/// The "ignore exemption set" of a crawl: the work-tree-relative path of
/// every `.git/index` entry under the index root, re-rooted to it (the git
/// index is work-tree-relative; an index rooted at a subdirectory of the
/// work tree — or in a linked worktree — needs the prefix stripped). With
/// it, the crawl indexes git's real file set, tracked ∪ (untracked −
/// ignored), instead of pruning tracked-but-ignored paths.
///
/// The exemption neutralizes git's OWN ignore sources only. A pattern the
/// user passed explicitly through the `ignore:` option is not one of them,
/// so tracked paths `user_ignore` matches (evaluated alone, with the
/// parent-directory rule) are subtracted from the set.
///
/// Rebuilt on every (re)crawl: a `git add` of a previously-ignored file is
/// only reflected at the next crawl/`refresh()` (`.git` is never watched).
/// Empty — pure gitignore semantics, never an error — when `gitignore` is
/// off, `root` is not inside a git work tree, or `.git/index` is missing,
/// unreadable or corrupt.
fn build_exempt_set(root: &[u8], gitignore: bool, user_ignore: &IgnoreChain) -> Arc<ExemptSet> {
    if !gitignore {
        return ExemptSet::none();
    }
    let Ok(Some(repo)) = bun_git::Repository::discover(root) else {
        return ExemptSet::none();
    };
    let Ok(index) = repo.read_index() else {
        return ExemptSet::none();
    };
    let prefix = super::git_task::work_tree_prefix(repo.work_tree(), root);
    Arc::new(ExemptSet::from_files(
        index
            .entries()
            .iter()
            .filter_map(|entry| index.path(entry).strip_prefix(prefix.as_slice()))
            .filter(|rel| !user_ignore.is_ignored(rel, false)),
    ))
}

/// The owning handle to a parked [`CrawlTask`], moved into the VM's
/// concurrent queue by [`Completion::enqueue`] exactly once per delivery.
///
/// SAFETY (`Send`): the pointee is the live `heap::into_raw` allocation from
/// [`start_with`] (or [`CrawlTask::run_from_js`]'s re-park). While parked,
/// this handle is its sole owner — the JS thread never touches it — and the
/// only cross-thread writes are the intrusive `concurrent_task`/`vm`
/// plumbing (the same hand-off `ConcurrentPromiseTask::on_finish` performs).
/// The `!Send` fields (`Strong`, `JSPromiseStrong`) are created and consumed
/// on the JS thread only.
struct Completion(*mut CrawlTask);
// SAFETY: see the type-level contract above.
unsafe impl Send for Completion {}

impl Completion {
    fn enqueue(self) {
        let this = self.0;
        // SAFETY: `this` is the live allocation this handle owns; `from`
        // only re-initializes the intrusive `concurrent_task` field in place
        // (it is never queued twice concurrently: one handle, one enqueue),
        // and `vm` points to the JS thread's `VirtualMachine`, whose
        // concurrent queue is the documented cross-thread entry point.
        unsafe {
            let task = NonNull::from((*this).concurrent_task.from(this, AutoDeinit::ManualDeinit));
            (*(*this).vm).enqueue_task_concurrent(task);
        }
    }
}

impl CrawlTask {
    /// Shutdown release (`__bun_release_task_at_shutdown`): the JS thread is
    /// past `is_shutting_down` and will never dispatch this task, so reclaim
    /// the box, unref the loop `KeepAlive`, and let `Drop` release the
    /// `Strong`/`JSPromiseStrong` handles (we are before `destructOnExit`).
    /// Workers still posting into the (refcounted) `Outbox` find no handle
    /// and never enqueue again.
    // `this` is an opaque token forwarded to `heap::take`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn release_at_shutdown(this: *mut CrawlTask) {
        // SAFETY: same ownership contract as `run_from_js`; the shutdown
        // drain hands each queued-but-undispatched task here exactly once.
        let mut owned = unsafe { bun_core::heap::take(this) };
        owned.keep_alive.unref(bun_io::js_vm_ctx());
    }

    /// JS-thread dispatch (`task_tag::FileIndexCrawlTask`). Takes ownership
    /// of the allocation; a delivery that is not yet `done` parks it again.
    // `this` is an opaque token forwarded to `heap::take`; the deref is inside
    // an `unsafe` block with the ownership contract documented above.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn run_from_js(this: *mut CrawlTask) -> Result<(), JsTerminated> {
        // SAFETY: `this` is the live, exclusively-owned allocation enqueued
        // by `Completion::enqueue`; the dispatch arm hands it here exactly
        // once per enqueue, and only one enqueue is ever outstanding.
        let mut owned = unsafe { bun_core::heap::take(this) };
        let (batches, done) = {
            let mut inbox = owned.outbox.inbox.lock();
            (core::mem::take(&mut inbox.batches), inbox.done.take())
        };

        let vm = VirtualMachine::get();
        if vm.is_shutting_down() {
            // Dropping the task here un-parks it forever: later posts find
            // no handle and the pool side just drops its `Arc<Outbox>`.
            owned.keep_alive.unref(bun_io::js_vm_ctx());
            return Ok(());
        }
        let global = vm.global();
        let this_value = owned.this_strong.get();

        if !batches.is_empty()
            && let Some(index) = this_value.as_class_ref::<FileIndex>()
        {
            for batch in batches {
                index.apply_crawl_batch(global, batch);
            }
        }
        let Some(result) = done else {
            return Self::park(owned);
        };

        owned.keep_alive.unref(bun_io::js_vm_ctx());
        match core::mem::replace(&mut owned.purpose, Purpose::WatcherRecrawl) {
            Purpose::Initial(promise) => settle_api(global, this_value, promise, result, true),
            Purpose::Refresh(promise) => settle_api(global, this_value, promise, result, false),
            // A failed background re-crawl (e.g. the root was deleted) keeps
            // the previous index; the watcher keeps reporting what it can.
            Purpose::WatcherRecrawl => {
                if let Ok(result) = result
                    && let Some(index) = this_value.as_class_ref::<FileIndex>()
                    && !index.is_closed()
                {
                    index.apply_recrawl(global, result);
                }
                Ok(())
            }
        }
    }

    /// Hand the (not yet completed) task back to the pool side. If a batch
    /// or the result arrived while this dispatch held no handle, re-enqueue
    /// immediately instead of parking — nothing else will.
    fn park(owned: Box<CrawlTask>) -> Result<(), JsTerminated> {
        let outbox = Arc::clone(&owned.outbox);
        let handle = Completion(bun_core::heap::into_raw(owned));
        let pending = {
            let mut inbox = outbox.inbox.lock();
            if inbox.done.is_some() || !inbox.batches.is_empty() {
                Some(handle)
            } else {
                inbox.handle = Some(handle);
                None
            }
        };
        if let Some(handle) = pending {
            handle.enqueue();
        }
        Ok(())
    }
}

/// Completion of an `Initial`/`Refresh` crawl: apply it to the index (if it
/// is still open) and settle its `Promise<FileIndex>`.
fn settle_api(
    global: &JSGlobalObject,
    this_value: JSValue,
    mut promise: JSPromiseStrong,
    result: Result<CrawlResult, bun_sys::Error>,
    initial: bool,
) -> Result<(), JsTerminated> {
    let result = match result {
        Err(err) => {
            let err_js = err.to_js(global);
            return promise.swap().reject_with_async_stack(global, Ok(err_js));
        }
        Ok(result) => result,
    };
    if let Some(index) = this_value.as_class_ref::<FileIndex>()
        && !index.is_closed()
    {
        if initial {
            index.finish_initial_crawl(global, &result);
        } else {
            index.apply_crawl(global, result);
        }
        // The probe in `start_with` and the crawl's own root open are
        // distinct: a root that vanished in between yields an empty index,
        // indistinguishable from a genuinely empty directory. Re-validate
        // the root so `ready` rejects with the syscall error instead of
        // resolving an empty index.
        if index.store().is_empty()
            && let Err(err) = Dir::open_with(index.root_bytes(), O::CLOEXEC)
        {
            let err_js = err.to_js(global);
            return promise.swap().reject_with_async_stack(global, Ok(err_js));
        }
        // A watching index resolves `ready` only once the watcher
        // acknowledges this crawl's registrations.
        promise = match index.defer_until_synced(promise) {
            None => return Ok(()),
            Some(promise) => promise,
        };
    }
    promise.swap().resolve(global, this_value)
}
