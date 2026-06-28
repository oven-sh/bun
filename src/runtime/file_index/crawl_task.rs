//! The initial crawl and `refresh()`: `bun_file_index::crawl` fans the
//! directory walk out on the work pool; the last worker's completion closure
//! enqueues this task back to the JS thread, which applies the owned
//! [`CrawlResult`] to the store and settles the `Promise<FileIndex>`.

use core::ptr::NonNull;

use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_file_index::{CrawlOptions, CrawlResult, crawl};
use bun_io::KeepAlive;
use bun_jsc::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSPromiseStrong, JSValue, JsTerminated, Strong, SysErrorJsc as _};
use bun_sys::{Dir, O};

use super::FileIndex;

/// Why a crawl was started; decides what its completion does on the JS
/// thread.
pub(crate) enum Purpose {
    /// `new FileIndex()` / `refresh()`: settle the `Promise<FileIndex>`.
    Api(JSPromiseStrong),
    /// Watcher-initiated background re-crawl (a `.gitignore` changed, or the
    /// OS event queue overflowed). There is no promise to settle; the diff
    /// between the old and new index is delivered through `onchange`.
    WatcherRecrawl,
}

/// One in-flight crawl. Heap-allocated on the JS thread; only its address
/// crosses threads (inside [`Completion`]). The `Strong` keeps the
/// `FileIndex` wrapper — and therefore the native `FileIndex` the completion
/// writes back into — alive for exactly as long as the crawl is in flight.
pub struct CrawlTask {
    this_strong: Strong,
    purpose: Purpose,
    /// Written only by [`Completion`] (exactly once) before the task is
    /// enqueued back to the JS thread.
    result: Result<CrawlResult, bun_sys::Error>,
    vm: *mut VirtualMachine,
    concurrent_task: ConcurrentTask,
    keep_alive: KeepAlive,
}

impl Taskable for CrawlTask {
    const TAG: TaskTag = task_tag::FileIndexCrawlTask;
}

/// Start a crawl of `index.root` and return the `Promise<FileIndex>` that its
/// completion settles. The root is opened here, on the JS thread, so a
/// nonexistent root rejects with the real syscall error instead of being
/// indistinguishable from an empty directory.
pub(crate) fn start(global: &JSGlobalObject, this_value: JSValue, index: &FileIndex) -> JSValue {
    let promise = JSPromiseStrong::init(global);
    let promise_js = promise.value();
    start_with(global, this_value, index, Purpose::Api(promise));
    promise_js
}

/// Start a watcher-initiated background re-crawl. No promise is created: a
/// failure (e.g. the root disappeared) must not surface as an unhandled
/// rejection from inside the watcher.
pub(crate) fn start_recrawl(global: &JSGlobalObject, this_value: JSValue, index: &FileIndex) {
    start_with(global, this_value, index, Purpose::WatcherRecrawl);
}

fn start_with(global: &JSGlobalObject, this_value: JSValue, index: &FileIndex, purpose: Purpose) {
    let root_error = match Dir::open_with(index.root_bytes(), O::CLOEXEC) {
        Ok(_) => None,
        Err(err) => Some(err),
    };
    let had_root_error = root_error.is_some();

    let mut task = Box::new(CrawlTask {
        this_strong: Strong::create(this_value, global),
        purpose,
        result: match root_error {
            Some(err) => Err(err),
            None => Ok(CrawlResult::default()),
        },
        // `bun_vm_ptr()` has write provenance and is valid for the process
        // lifetime (see `Archive::AsyncTask::create`).
        vm: global.bun_vm_ptr(),
        concurrent_task: ConcurrentTask::default(),
        keep_alive: KeepAlive::default(),
    });
    // Keep the event loop alive until `run_from_js` settles the promise.
    task.keep_alive.ref_(bun_io::js_vm_ctx());

    let options = CrawlOptions {
        // The user named this directory explicitly; symlinks *inside* the
        // tree are still never followed.
        follow_root_symlink: true,
        ignore_chain_root: index.root_ignore_chain(),
        load_gitignore_files: index.options().gitignore,
        max_entries: usize::MAX,
        budget: index.options().max_memory,
    };

    let completion = Completion(bun_core::heap::into_raw(task));
    if had_root_error {
        completion.enqueue();
    } else {
        let root = index.root_bytes().to_vec();
        crawl(&root, options, move |result| completion.complete(result));
    }
}

/// The owning handle to an in-flight [`CrawlTask`], moved into the crawl's
/// `on_done` closure and consumed exactly once.
///
/// SAFETY (`Send`): the pointee is the live `heap::into_raw` allocation from
/// [`start`]. Between `start` returning and the JS-thread dispatch of the
/// enqueued `ConcurrentTask`, this handle is its sole owner — the JS thread
/// never touches it — and it only writes the `Send` `result` field and the
/// intrusive `concurrent_task`/`vm` plumbing (the same cross-thread hand-off
/// `ConcurrentPromiseTask::on_finish` performs). The `!Send` fields
/// (`Strong`, `JSPromiseStrong`) are created and consumed on the JS thread
/// only.
struct Completion(*mut CrawlTask);
// SAFETY: see the type-level contract above.
unsafe impl Send for Completion {}

impl Completion {
    /// May run on any work-pool thread (or synchronously on the JS thread for
    /// a root that failed to open).
    fn complete(self, result: CrawlResult) {
        // SAFETY: sole owner of the live allocation (type-level contract).
        unsafe { (*self.0).result = Ok(result) };
        self.enqueue();
    }

    fn enqueue(self) {
        let this = self.0;
        // SAFETY: `this` is the live allocation from `start`; `from` only
        // re-initializes the intrusive `concurrent_task` field in place, and
        // `vm` points to the JS thread's `VirtualMachine`, whose concurrent
        // queue is the documented cross-thread entry point.
        unsafe {
            let task = NonNull::from(
                (*this)
                    .concurrent_task
                    .from(this, AutoDeinit::ManualDeinit),
            );
            (*(*this).vm).enqueue_task_concurrent(task);
        }
    }
}

impl CrawlTask {
    /// JS-thread dispatch (`task_tag::FileIndexCrawlTask`). Takes ownership of
    /// the allocation produced by [`start`].
    // `this` is an opaque token forwarded to `heap::take`; the deref is inside
    // an `unsafe` block with the ownership contract documented above.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn run_from_js(this: *mut CrawlTask) -> Result<(), JsTerminated> {
        // SAFETY: `this` is the live, exclusively-owned allocation enqueued by
        // `Completion::enqueue`; the dispatch arm hands it here exactly once.
        let mut owned = unsafe { bun_core::heap::take(this) };
        owned.keep_alive.unref(bun_io::js_vm_ctx());

        let vm = VirtualMachine::get();
        if vm.is_shutting_down() {
            return Ok(());
        }
        let global = vm.global();
        let result = core::mem::replace(&mut owned.result, Ok(CrawlResult::default()));
        match core::mem::replace(&mut owned.purpose, Purpose::WatcherRecrawl) {
            Purpose::Api(mut promise) => match result {
                Err(err) => {
                    let err_js = err.to_js(global);
                    promise.swap().reject_with_async_stack(global, Ok(err_js))
                }
                Ok(result) => {
                    let this_value = owned.this_strong.get();
                    if let Some(index) = this_value.as_class_ref::<FileIndex>()
                        && !index.is_closed()
                    {
                        index.apply_crawl(global, result);
                        // A watching index resolves `ready` only once the
                        // watcher acknowledges this crawl's registrations.
                        promise = match index.defer_until_synced(promise) {
                            None => return Ok(()),
                            Some(promise) => promise,
                        };
                    }
                    promise.swap().resolve(global, this_value)
                }
            },
            // A failed background re-crawl (e.g. the root was deleted) keeps
            // the previous index; the watcher keeps reporting what it can.
            Purpose::WatcherRecrawl => {
                if let Ok(result) = result {
                    let this_value = owned.this_strong.get();
                    if let Some(index) = this_value.as_class_ref::<FileIndex>()
                        && !index.is_closed()
                    {
                        index.apply_recrawl(global, result);
                    }
                }
                Ok(())
            }
        }
    }
}
