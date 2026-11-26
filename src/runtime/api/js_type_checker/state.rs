//! Queues and close state of one `Bun.TypeChecker` root.

use std::collections::VecDeque;

use bun_jsc::JSPromiseStrong;
use bun_type_checker::DesiredState;

/// Queue and close state of one root. JS-thread only.
#[derive(Default)]
pub(crate) struct RootState {
    /// Updates waiting for the running check to finish.
    pub(crate) pending: VecDeque<PendingEntry>,
    /// A check is on a worker, or its result has not been delivered yet.
    pub(crate) running: bool,
    /// Created by the first `close()`; resolved once nothing is running.
    pub(crate) close: Option<JSPromiseStrong>,
}

/// An update that has been captured but not started.
pub(crate) struct PendingEntry {
    pub(crate) state: DesiredState,
    pub(crate) promise: JSPromiseStrong,
}
