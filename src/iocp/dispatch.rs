#![cfg(windows)]

//! Central completion dispatch: every dequeued or locally-queued request
//! routes through the exhaustive match below. Handle classes add a `ReqKind`
//! variant and an arm here — there is no other delivery path, which is what
//! keeps the OVERLAPPED-recovery and accounting invariants in one place.

use crate::event_loop::Loop;
use crate::req::{Req, ReqKind};

/// Process one completed request. `req` was recovered from a non-null
/// `lpOverlapped` (kernel completion) or drained from the pending queue
/// (local completion); both carry their status in the OVERLAPPED.
/// // quirk: LOOP-05
pub(crate) fn dispatch(loop_: &mut Loop, req: &mut Req) {
    match req.kind() {
        ReqKind::Wakeup => loop_.consume_wakeup(),
        ReqKind::Poll => crate::afd::process_poll_req(loop_, req),
        ReqKind::PipeRead => crate::pipe::process_pipe_read_req(loop_, req),
        ReqKind::PipeWrite => crate::pipe::process_pipe_write_req(loop_, req),
        ReqKind::PipeConnect => crate::pipe::process_pipe_connect_req(loop_, req),
        ReqKind::PipeAccept => crate::pipe::process_pipe_accept_req(loop_, req),
        ReqKind::PipeShutdown => crate::pipe::process_pipe_shutdown_req(loop_, req),
        ReqKind::FsEvent => crate::fsevent::process_fs_event_req(loop_, req),
        ReqKind::TtyRead => crate::tty::process_tty_read_req(loop_, req),
        ReqKind::TtyWrite => crate::tty::process_tty_write_req(loop_, req),
        ReqKind::TtyShutdown => crate::tty::process_tty_shutdown_req(loop_, req),
        ReqKind::ProcessExit => crate::process::process_process_exit_req(loop_, req),
        ReqKind::Signal => crate::signal::process_signal_req(loop_, req),
    }
}

/// Whether dispatching this request is user-visible work (counted by
/// `poll_once`'s return) or loop-internal bookkeeping.
pub(crate) fn is_internal(kind: ReqKind) -> bool {
    matches!(kind, ReqKind::Wakeup)
}
