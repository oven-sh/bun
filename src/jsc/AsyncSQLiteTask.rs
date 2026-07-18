use core::ptr::NonNull;

use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

bun_opaque::opaque_ffi! {
    pub struct AsyncSQLiteNativeJob;
}

unsafe extern "C" {
    fn Bun__AsyncSQLiteNativeJob__runAndDelete(job: *mut AsyncSQLiteNativeJob);
    fn Bun__AsyncSQLiteNativeJob__destroy(job: *mut AsyncSQLiteNativeJob);
}

#[repr(C)]
struct AsyncSQLiteWorkTask {
    job: Option<NonNull<AsyncSQLiteNativeJob>>,
    workpool_task: WorkPoolTask,
}

bun_threading::intrusive_work_task!(AsyncSQLiteWorkTask, workpool_task);

unsafe impl Send for AsyncSQLiteWorkTask {}

unsafe impl bun_threading::work_pool::OwnedTask for AsyncSQLiteWorkTask {
    fn run(mut self: Box<Self>) {
        let job = self.job.take();
        drop(self);
        if let Some(job) = job {
            // SAFETY: schedule() transfers this unique non-null job allocation to
            // the WorkPool task. run() consumes it exactly once on the worker.
            unsafe { Bun__AsyncSQLiteNativeJob__runAndDelete(job.as_ptr()) };
        }
    }
}

impl Drop for AsyncSQLiteWorkTask {
    fn drop(&mut self) {
        if let Some(job) = self.job.take() {
            // SAFETY: Drop only sees a job that was never consumed by run().
            // The job contains only native, thread-safe state.
            unsafe { Bun__AsyncSQLiteNativeJob__destroy(job.as_ptr()) };
        }
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn AsyncSQLiteTask__schedule(job: *mut AsyncSQLiteNativeJob) {
    crate::mark_binding!();
    let Some(job) = NonNull::new(job) else {
        return;
    };
    WorkPool::schedule_new(AsyncSQLiteWorkTask {
        job: Some(job),
        workpool_task: WorkPoolTask::default(),
    });
}
