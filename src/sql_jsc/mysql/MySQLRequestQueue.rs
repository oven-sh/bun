use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::jsc::JSValue;

use crate::mysql::js_mysql_query::JSMySQLQuery;
// PORT NOTE: Zig re-exports `MySQLConnection` from JSMySQLConnection.zig — the
// queue's "connection" param is the JS-wrapper type (it calls
// `reset_connection_timeout`/`on_error` which live on the wrapper, plus
// `is_able_to_write` which forwards to the inner protocol struct).
use crate::mysql::js_mysql_connection::JSMySQLConnection as MySQLConnection;

bun_core::declare_scope!(MySQLRequestQueue, visible);
macro_rules! debug {
    ($($arg:tt)*) => { bun_core::scoped_log!(MySQLRequestQueue, $($arg)*) };
}

// `bun.LinearFifo(*JSMySQLQuery, .Dynamic)` — elements are intrusively
// ref-counted raw pointers (ref/deref managed manually below).
type Queue = LinearFifo<*mut JSMySQLQuery, DynamicBuffer<*mut JSMySQLQuery>>;

pub struct MySQLRequestQueue {
    requests: Queue,

    pipelined_requests: u32,
    nonpipelinable_requests: u32,
    // TODO: refactor to ENUM
    waiting_to_prepare: bool,
    is_ready_for_query: bool,
}

impl MySQLRequestQueue {
    #[inline]
    pub fn can_execute_query(&self, connection: &MySQLConnection) -> bool {
        connection.is_able_to_write()
            && self.is_ready_for_query
            && self.nonpipelinable_requests == 0
            && self.pipelined_requests == 0
    }

    #[inline]
    pub fn can_prepare_query(&self, connection: &MySQLConnection) -> bool {
        connection.is_able_to_write()
            && self.is_ready_for_query
            && !self.waiting_to_prepare
            && self.pipelined_requests == 0
    }

    #[inline]
    pub fn mark_as_ready_for_query(&mut self) {
        self.is_ready_for_query = true;
    }

    #[inline]
    pub fn mark_as_prepared(&mut self) {
        self.waiting_to_prepare = false;
        if let Some(request) = self.current() {
            debug!("markAsPrepared markAsPrepared");
            // SAFETY: queue holds a ref on every request; pointer is live.
            unsafe { (*request).mark_as_prepared() };
        }
    }

    #[inline]
    pub fn can_pipeline(&self, connection: &MySQLConnection) -> bool {
        // TODO(port): env_var feature_flag::get() returns Option<bool> until the
        // non-nullable defaulted-var get() wrapper is restored (see env_var.rs).
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING
            .get()
            .unwrap_or(false)
        {
            // @branchHint(.unlikely) — no stable Rust equivalent; left as plain branch.
            return false;
        }

        self.is_ready_for_query
            && self.nonpipelinable_requests == 0 // need to wait for non pipelinable requests to finish
            && !self.waiting_to_prepare
            && connection.is_able_to_write()
    }

    pub fn mark_current_request_as_finished(&mut self, item: &mut JSMySQLQuery) {
        self.waiting_to_prepare = false;
        if item.is_being_prepared() {
            debug!("markCurrentRequestAsFinished markAsPrepared");
            item.mark_as_prepared();
        } else if item.is_running() {
            if item.is_pipelined() {
                self.pipelined_requests -= 1;
            } else {
                self.nonpipelinable_requests -= 1;
            }
        }
    }

    /// PORT NOTE: takes `*mut MySQLConnection` (not `&mut`) so that `&mut self`
    /// (the queue, embedded inside `MySQLConnection`) does not alias a live
    /// `&mut MySQLConnection` for the whole body. The raw pointer is
    /// dereferenced only at the disjoint-field call sites below.
    ///
    /// # Safety
    /// `connection` must point to the live `JSMySQLConnection` that embeds
    /// `self` as its `connection.queue` field.
    pub unsafe fn advance(&mut self, connection: *mut MySQLConnection) {
        // PORT NOTE: reshaped for borrowck — Zig `defer { while ... }` cleanup
        // became a post-block pass; early `return`s in the Zig loop become
        // `break 'advance` so cleanup always runs at function exit.
        'advance: {
            let mut offset: usize = 0;

            // SAFETY: caller contract; `is_able_to_write` reads disjoint
            // connection-state fields, never the queue.
            while self.requests.readable_length() > offset && unsafe { (*connection).is_able_to_write() } {
                let request: *mut JSMySQLQuery = self.requests.peek_item(offset);
                // SAFETY: queue holds a ref on every request; pointer is live.
                let req = unsafe { &mut *request };

                if req.is_completed() {
                    if offset > 0 {
                        // discard later
                        offset += 1;
                        continue;
                    }
                    debug!("isCompleted");
                    self.requests.discard(1);
                    req.deref();
                    continue;
                }

                if req.is_being_prepared() {
                    debug!("isBeingPrepared");
                    self.waiting_to_prepare = true;
                    // cannot continue the queue until the current request is marked as prepared
                    break 'advance;
                }
                if req.is_running() {
                    debug!("isRunning");
                    let total_requests_running =
                        (self.pipelined_requests + self.nonpipelinable_requests) as usize;
                    if offset < total_requests_running {
                        offset += total_requests_running;
                    } else {
                        offset += 1;
                    }
                    continue;
                }

                // SAFETY: caller contract; `run`/`on_error` touch connection
                // state disjoint from `self.requests`' backing storage.
                if let Err(err) = req.run(unsafe { &mut *connection }) {
                    debug!("run failed");
                    unsafe { (*connection).on_error(Some(req), err) };
                    if offset == 0 {
                        self.requests.discard(1);
                        req.deref();
                    }
                    offset += 1;
                    continue;
                }
                if req.is_being_prepared() {
                    debug!("isBeingPrepared");
                    // SAFETY: caller contract; touches timer state, not the queue.
                    unsafe { (*connection).reset_connection_timeout() };
                    self.is_ready_for_query = false;
                    self.waiting_to_prepare = true;
                    break 'advance;
                } else if req.is_running() {
                    // SAFETY: caller contract; touches timer state, not the queue.
                    unsafe { (*connection).reset_connection_timeout() };
                    debug!("isRunning after run");
                    self.is_ready_for_query = false;

                    if req.is_pipelined() {
                        self.pipelined_requests += 1;
                        // SAFETY: caller contract; read-only over disjoint fields.
                        if self.can_pipeline(unsafe { &*connection }) {
                            debug!("pipelined requests");
                            offset += 1;
                            continue;
                        }
                        break 'advance;
                    }
                    debug!("nonpipelinable requests");
                    self.nonpipelinable_requests += 1;
                }
                break 'advance;
            }
        }

        // Zig: defer { while ... } — runs at function exit.
        while self.requests.readable_length() > 0 {
            let request: *mut JSMySQLQuery = self.requests.peek_item(0);
            // SAFETY: queue holds a ref on every request; pointer is live.
            let req = unsafe { &mut *request };
            // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
            // so we do the cleanup her
            if req.is_completed() {
                debug!("isCompleted discard after advance");
                self.requests.discard(1);
                req.deref();
                continue;
            }
            break;
        }
    }

    pub fn init() -> Self {
        Self {
            requests: Queue::init(),
            pipelined_requests: 0,
            nonpipelinable_requests: 0,
            waiting_to_prepare: false,
            is_ready_for_query: true,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.requests.readable_length() == 0
    }

    pub fn add(&mut self, request: *mut JSMySQLQuery) {
        debug!("add");
        // SAFETY: caller passes a live JSMySQLQuery; we ref() it before storing.
        let req = unsafe { &mut *request };
        if req.is_being_prepared() {
            self.is_ready_for_query = false;
            self.waiting_to_prepare = true;
        } else if req.is_running() {
            self.is_ready_for_query = false;

            if req.is_pipelined() {
                self.pipelined_requests += 1;
            } else {
                self.nonpipelinable_requests += 1;
            }
        }
        req.ref_();
        self.requests.write_item(request).expect("OOM");
    }

    #[inline]
    pub fn current(&self) -> Option<*mut JSMySQLQuery> {
        if self.requests.readable_length() == 0 {
            return None;
        }

        Some(self.requests.peek_item(0))
    }

    pub fn clean(&mut self, reason: Option<JSValue>, queries_array: JSValue) {
        // reject()/rejectWithJSValue() run JS which can synchronously call .close()
        // (or otherwise fail the connection) and re-enter clean(). Swap the queue
        // into a local first so the re-entrant call sees an empty queue instead of
        // deref()'ing + discard()'ing the same requests out from under us.
        let mut requests = core::mem::replace(&mut self.requests, Queue::init());
        self.pipelined_requests = 0;
        self.nonpipelinable_requests = 0;
        self.waiting_to_prepare = false;
        // `requests` drops at scope exit (Zig: defer requests.deinit()).

        while let Some(request) = requests.read_item() {
            // SAFETY: queue held a ref on every request; pointer is live until deref().
            let req = unsafe { &mut *request };
            // Zig: defer request.deref() — moved to end of loop body; no early
            // exits between here and there.
            if !req.is_completed() {
                if let Some(r) = reason {
                    req.reject_with_js_value(queries_array, r);
                } else {
                    req.reject(queries_array, AnyMySQLError::ConnectionClosed);
                }
            }
            req.deref();
        }
    }
}

impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig iterates readableSlice(0) while
        // discard(1)'ing, which in Rust would overlap & / &mut borrows on
        // self.requests. read_item() peeks+discards in one &mut call.
        while let Some(request) = self.requests.read_item() {
            // SAFETY: queue held a ref on every request; pointer is live until deref().
            let req = unsafe { &mut *request };
            // We cannot touch JS here
            req.mark_as_failed();
            req.deref();
        }
        self.pipelined_requests = 0;
        self.nonpipelinable_requests = 0;
        self.waiting_to_prepare = false;
        // self.requests drops automatically (Zig: this.#requests.deinit()).
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/MySQLRequestQueue.zig (227 lines)
//   confidence: medium
//   todos:      1
//   notes:      LinearFifo<*mut JSMySQLQuery, DynamicBuffer> w/ explicit init(); advance() defer reshaped to post-block cleanup; Drop reshaped to read_item() loop for borrowck
// ──────────────────────────────────────────────────────────────────────────
