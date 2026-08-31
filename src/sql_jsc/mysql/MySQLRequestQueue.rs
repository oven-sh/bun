use crate::jsc::JSValue;
use bun_jsc::JsCell;
use bun_ptr::{RefPtr, ThisPtr};
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use core::cell::Cell;
use std::collections::VecDeque;

use crate::mysql::js_mysql_query::JSMySQLQuery;
// The queue's "connection" param is the JS-wrapper type (it calls
// `reset_connection_timeout`/`on_error` which live on the wrapper, plus
// `is_able_to_write` which forwards to the inner protocol struct).
use crate::mysql::js_mysql_connection::JSMySQLConnection as MySQLConnection;

bun_core::define_scoped_log!(debug, MySQLRequestQueue, visible);

/// Each entry is the ref the queue holds on that request, released when the
/// entry leaves the queue.
type Queue = VecDeque<RefPtr<JSMySQLQuery>>;

pub struct MySQLRequestQueue {
    // All fields are interior-mutable so `advance()` can run against the
    // `&Self` reached through the connection while its callees re-enter the
    // connection. The queue is single-JS-thread (embedded inside the
    // connection's `JsCell`), so `Cell`/`JsCell`'s `!Sync` story is fine.
    requests: JsCell<Queue>,

    pipelined_requests: Cell<u32>,
    nonpipelinable_requests: Cell<u32>,
    // TODO: refactor to ENUM
    waiting_to_prepare: Cell<bool>,
    is_ready_for_query: Cell<bool>,
}

impl MySQLRequestQueue {
    #[inline]
    pub(crate) fn can_execute_query(&self, connection: &MySQLConnection) -> bool {
        connection.is_able_to_write()
            && self.is_ready_for_query.get()
            && self.nonpipelinable_requests.get() == 0
            && self.pipelined_requests.get() == 0
    }

    #[inline]
    pub(crate) fn can_prepare_query(&self, connection: &MySQLConnection) -> bool {
        connection.is_able_to_write()
            && self.is_ready_for_query.get()
            && !self.waiting_to_prepare.get()
            && self.pipelined_requests.get() == 0
    }

    #[inline]
    pub(crate) fn mark_as_ready_for_query(&self) {
        self.is_ready_for_query.set(true);
    }

    #[inline]
    pub(crate) fn mark_as_prepared(&self) {
        self.waiting_to_prepare.set(false);
        if let Some(request) = self.current() {
            debug!("markAsPrepared markAsPrepared");
            request.mark_as_prepared();
        }
    }

    #[inline]
    pub(crate) fn can_pipeline(&self, connection: &MySQLConnection) -> bool {
        // Feature flags are unset by default; `unwrap_or(false)` falls back to the
        // non-nullable defaulted `get()`.
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING
            .get()
            .unwrap_or(false)
        {
            // @branchHint(.unlikely) — no stable Rust equivalent; left as plain branch.
            return false;
        }

        self.is_ready_for_query.get()
            && self.nonpipelinable_requests.get() == 0 // need to wait for non pipelinable requests to finish
            && !self.waiting_to_prepare.get()
            && connection.is_able_to_write()
    }

    pub(crate) fn mark_current_request_as_finished(&self, item: &JSMySQLQuery) {
        self.waiting_to_prepare.set(false);
        if item.is_being_prepared() {
            debug!("markCurrentRequestAsFinished markAsPrepared");
            item.mark_as_prepared();
        } else if item.is_running() {
            if item.is_pipelined() {
                self.pipelined_requests
                    .set(self.pipelined_requests.get() - 1);
            } else {
                self.nonpipelinable_requests
                    .set(self.nonpipelinable_requests.get() - 1);
            }
        }
    }

    /// The queued request at `offset`; the queue's ref keeps it alive while
    /// the entry is queued.
    #[inline]
    fn request_at(&self, offset: usize) -> Option<ThisPtr<JSMySQLQuery>> {
        self.requests.get().get(offset).map(RefPtr::this_ptr)
    }

    /// If `request` is the FIFO head, pop it and drop the queue's ref on it
    /// (which may free it).
    fn discard_if_head(&self, request: ThisPtr<JSMySQLQuery>) {
        let head = self.requests.with_mut(|q| match q.front() {
            Some(front) if core::ptr::eq(front.as_ptr(), request.as_ptr()) => q.pop_front(),
            _ => None,
        });
        drop(head);
    }

    /// Drive the queue: run/prepare pending requests until the connection
    /// can't take more, then drop completed entries off the head. The queue is
    /// `connection`'s own (`connection.connection.queue`); every callee below
    /// is `&self` on interior-mutable state, so re-entry through the
    /// connection is sound.
    pub(crate) fn advance(connection: &MySQLConnection) {
        let queue: &Self = &connection.connection.get().queue;
        // reshaped for borrowck — the cleanup that must run at function exit
        // became a post-block pass; early returns become
        // `break 'advance` so cleanup always runs at function exit.
        'advance: {
            let mut offset: usize = 0;

            while connection.is_able_to_write() {
                let Some(req) = queue.request_at(offset) else {
                    break;
                };

                if req.is_completed() {
                    if offset > 0 {
                        // discard later
                        offset += 1;
                        continue;
                    }
                    debug!("isCompleted");
                    queue.discard_if_head(req);
                    continue;
                }

                if req.is_being_prepared() {
                    debug!("isBeingPrepared");
                    queue.waiting_to_prepare.set(true);
                    // cannot continue the queue until the current request is marked as prepared
                    break 'advance;
                }
                if req.is_running() {
                    debug!("isRunning");
                    let total_requests_running = (queue.pipelined_requests.get()
                        + queue.nonpipelinable_requests.get())
                        as usize;
                    if offset < total_requests_running {
                        offset += total_requests_running;
                    } else {
                        offset += 1;
                    }
                    continue;
                }

                // `run()` *does* read queue scalars
                // (`can_execute_query`/`can_pipeline`/`can_prepare_query`),
                // but only through `connection`'s shared reborrow into the same
                // `Cell`-wrapped fields — overlapping shared reads are sound.
                if let Err(err) = req.run(connection) {
                    debug!("run failed");
                    connection.on_error(Some(req.get()), err);
                    if offset == 0 {
                        queue.discard_if_head(req);
                    }
                    offset += 1;
                    continue;
                }
                if req.is_being_prepared() {
                    debug!("isBeingPrepared");
                    connection.reset_connection_timeout();
                    queue.is_ready_for_query.set(false);
                    queue.waiting_to_prepare.set(true);
                    break 'advance;
                } else if req.is_running() {
                    connection.reset_connection_timeout();
                    debug!("isRunning after run");
                    queue.is_ready_for_query.set(false);

                    if req.is_pipelined() {
                        queue
                            .pipelined_requests
                            .set(queue.pipelined_requests.get() + 1);
                        if queue.can_pipeline(connection) {
                            debug!("pipelined requests");
                            offset += 1;
                            continue;
                        }
                        break 'advance;
                    }
                    debug!("nonpipelinable requests");
                    queue
                        .nonpipelinable_requests
                        .set(queue.nonpipelinable_requests.get() + 1);
                }
                break 'advance;
            }
        }

        while let Some(req) = queue.request_at(0) {
            // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
            // so we do the cleanup her
            if req.is_completed() {
                debug!("isCompleted discard after advance");
                queue.discard_if_head(req);
                continue;
            }
            break;
        }
    }

    pub(crate) fn init() -> Self {
        Self {
            requests: JsCell::new(Queue::new()),
            pipelined_requests: Cell::new(0),
            nonpipelinable_requests: Cell::new(0),
            waiting_to_prepare: Cell::new(false),
            is_ready_for_query: Cell::new(true),
        }
    }

    /// Append `request`, taking the queue's ref on it.
    pub(crate) fn add(&self, request: ThisPtr<JSMySQLQuery>) {
        debug!("add");
        if request.is_being_prepared() {
            self.is_ready_for_query.set(false);
            self.waiting_to_prepare.set(true);
        } else if request.is_running() {
            self.is_ready_for_query.set(false);

            if request.is_pipelined() {
                self.pipelined_requests
                    .set(self.pipelined_requests.get() + 1);
            } else {
                self.nonpipelinable_requests
                    .set(self.nonpipelinable_requests.get() + 1);
            }
        }
        let held = RefPtr::from_this(request);
        self.requests.with_mut(|q| q.push_back(held));
    }

    /// The queue's head request, if any. The queue holds a ref on every stored
    /// request, so the handle is valid while the entry is queued; `JSMySQLQuery`
    /// is a separate, fully interior-mutable heap allocation, so the `&` it
    /// yields is sound across `&mut` on the embedding connection.
    #[inline]
    pub(crate) fn current(&self) -> Option<ThisPtr<JSMySQLQuery>> {
        self.request_at(0)
    }

    pub(crate) fn clean(&self, reason: Option<JSValue>, queries_array: JSValue) {
        // reject()/rejectWithJSValue() run JS which can synchronously call .close()
        // (or otherwise fail the connection) and re-enter clean(). Swap the queue
        // into a local first so the re-entrant call sees an empty queue instead of
        // deref()'ing + discard()'ing the same requests out from under us.
        let mut requests = self.requests.replace(Queue::new());
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);

        while let Some(request) = requests.pop_front() {
            // Each request's ref is released at the end of the loop body.
            if !request.is_completed() {
                if let Some(r) = reason {
                    request.reject_with_js_value(queries_array, r);
                } else {
                    request.reject(queries_array, AnyMySQLError::ConnectionClosed);
                }
            }
            drop(request);
        }
    }
}

impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        while let Some(request) = self.requests.get_mut_unique().pop_front() {
            // We cannot touch JS here
            request.mark_as_failed();
            drop(request);
        }
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);
    }
}
