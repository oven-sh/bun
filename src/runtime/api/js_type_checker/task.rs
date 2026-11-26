//! Background check task for `Bun.TypeChecker`.
//!
//! The worker runs `bun_type_checker::run_check` on owned buffers. Nothing JSC
//! crosses to the worker.

use bun_jsc::{JSPromiseStrong, JobContext, JsResult, JsThread};
use bun_ptr::RefPtr;
use bun_type_checker::{AdapterError, DesiredState, SnapshotData};

use super::TypeChecker;

/// Owned job: everything the worker needs, copied on the JS thread.
pub(crate) struct CheckJob {
    pub(crate) cwd: Vec<u8>,
    pub(crate) state: DesiredState,
    pub(crate) result: Option<Result<SnapshotData, AdapterError>>,
}

/// JS-side owner of a running job: its promise and the root to report back to.
pub(crate) struct CheckJs {
    pub(crate) promise: JSPromiseStrong,
    pub(crate) root: RefPtr<TypeChecker>,
}

// SAFETY: `CheckJs` is only touched on the JS thread: it is handed to the
// worker's `Job` as an opaque payload and comes back in `then`.
unsafe impl bun_jsc::job::JsAffine for CheckJs {}

pub(crate) struct CheckTask {
    pub(crate) job: CheckJob,
}

impl JobContext for CheckTask {
    type OffThread = Self;
    type Js = CheckJs;

    fn run(off: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // The constructor has thrown where the type checker is removed.
        bun_removable_features::removable_body!(Check, Abort, { off.run_checked() });
        Some(done)
    }

    fn then(off: Self, js: CheckJs, cx: &JsThread<'_>) -> JsResult<()> {
        off.finish(js, cx)
    }
}

impl CheckTask {
    fn run_checked(&mut self) {
        let job = &mut self.job;
        job.result = Some(bun_type_checker::run_check(
            &job.cwd,
            &job.state,
            crate::cli::typescript_libs::BUNDLED,
        ));
    }

    /// Settles this job's promise, then starts the next pending update, then
    /// resolves a waiting `close()` if the root went idle.
    fn finish(self, js: CheckJs, cx: &JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let CheckJs { mut promise, root } = js;
        let promise = promise.swap();
        let settled = if root.is_closed() {
            promise.reject_as_handled(global, super::closed_error_value(global))
        } else {
            match self.job.result {
                Some(Ok(data)) => {
                    super::make_snapshot_js(
                        global,
                        root.hold_snapshot_data(data),
                        root.cwd.clone(),
                        root.case_sensitive,
                    )
                }
                .and_then(|snapshot| promise.resolve(global, snapshot)),
                Some(Err(e)) => {
                    promise.reject(global, Ok(super::convert::adapter_error_value(&e, global)))
                }
                None => {
                    let err = global
                        .create_error_instance(format_args!("Bun.TypeChecker: check did not run"));
                    promise.reject(global, Ok(err))
                }
            }
        };
        let idle = root.job_finished(cx);
        settled.and(idle)
    }
}
