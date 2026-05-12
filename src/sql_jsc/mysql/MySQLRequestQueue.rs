use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_ptr::ParentRef;
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use core::ptr::NonNull;
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
        if let Some(request) = self.current_ref() {
            debug!("markAsPrepared markAsPrepared");
            request.mark_as_prepared();
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

    pub fn mark_current_request_as_finished(&mut self, item: &JSMySQLQuery) {
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

    /// PORT NOTE: takes only `connection` (the embedding `JSMySQLConnection`)
    /// as a **raw pointer** and derives the queue pointer locally via
    /// `addr_of_mut!((*connection).connection.queue)`. The queue is a field of
    /// `*connection`, so any `&mut *connection` materialized for
    /// `run()`/`on_error()` below covers the queue bytes. Deriving `this` from
    /// the *same* raw root keeps both projections on one SharedRW provenance
    /// tag: each `&mut *connection` becomes a child reborrow that is popped
    /// (not invalidating `this`) when `(*this)` is next used — mirroring Zig's
    /// freely-aliasing `*T` semantics. Passing `this` and `connection` as
    /// sibling raw args from the caller would split provenance and is UB under
    /// Stacked Borrows (the second `&mut self.…` at the call site pops the
    /// first raw's tag).
    ///
    /// # Safety
    /// - `connection` must be live for the duration of the call and carry
    ///   provenance for the entire `JSMySQLConnection` allocation.
    /// - `run()` / `is_able_to_write()` *do* read queue scalars
    ///   (`is_ready_for_query`, `pipelined_requests`, …) via
    ///   `connection.can_execute_query()` etc. — this is sound because those
    ///   reads go through the `&mut *connection` reborrow itself, and no
    ///   `(*this)` access overlaps the lifetime of that `&mut`.
    pub unsafe fn advance(connection: *mut MySQLConnection) {
        // SAFETY: caller contract — `connection` has full-allocation
        // provenance. R-2: the inner protocol struct is wrapped in
        // `JsCell` (`UnsafeCell`); `as_ptr()` yields a `*mut` with write
        // provenance for the inner bytes, and `addr_of_mut!` projects the
        // embedded queue without an intermediate `&mut`.
        let this: *mut Self =
            unsafe { core::ptr::addr_of_mut!((*(*connection).connection.as_ptr()).queue) };
        // PORT NOTE: reshaped for borrowck — Zig `defer { while ... }` cleanup
        // became a post-block pass; early `return`s in the Zig loop become
        // `break 'advance` so cleanup always runs at function exit.
        'advance: {
            let mut offset: usize = 0;

            // SAFETY: caller contract; each `(*this)` / `(*connection)` deref
            // forms a fresh short-lived borrow — no two `&mut` overlap.
            while unsafe { (*this).requests.readable_length() } > offset
                && unsafe { (*connection).is_able_to_write() }
            {
                let request: *mut JSMySQLQuery = unsafe { (*this).requests.peek_item(offset) };
                // Queue holds a ref on every request; pointer is non-null and
                // live. `JSMySQLQuery` is a separate heap allocation — never
                // aliases `*this` or `*connection`. R-2: `ParentRef` yields
                // `&T` only — every method body is `&self` (interior mutability).
                let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));

                if req.is_completed() {
                    if offset > 0 {
                        // discard later
                        offset += 1;
                        continue;
                    }
                    debug!("isCompleted");
                    unsafe { (*this).requests.discard(1) };
                    // SAFETY: queue held one ref; pointer is live until this deref.
                    unsafe { JSMySQLQuery::deref(request) };
                    continue;
                }

                if req.is_being_prepared() {
                    debug!("isBeingPrepared");
                    unsafe { (*this).waiting_to_prepare = true };
                    // cannot continue the queue until the current request is marked as prepared
                    break 'advance;
                }
                if req.is_running() {
                    debug!("isRunning");
                    let total_requests_running = unsafe {
                        ((*this).pipelined_requests + (*this).nonpipelinable_requests) as usize
                    };
                    if offset < total_requests_running {
                        offset += total_requests_running;
                    } else {
                        offset += 1;
                    }
                    continue;
                }

                // SAFETY: no `&mut *this` is live here (only the raw `this`
                // and `req`, a disjoint heap alloc). `&mut *connection` spans
                // the queue bytes and `run()` *does* read queue scalars
                // (`can_execute_query`/`can_pipeline`/`can_prepare_query`),
                // but only through this reborrow; because `this` was projected
                // from the same `connection` raw via `addr_of_mut!`, the
                // reborrow is a child tag that is popped when the `&mut` ends
                // — the next `(*this)` access below remains valid.
                if let Err(err) = req.run(unsafe { &*connection }) {
                    debug!("run failed");
                    // SAFETY: same as above — shared `&*connection` reborrow
                    // (R-2: `on_error` takes `&self`).
                    unsafe { (*connection).on_error(Some(req.get()), err) };
                    if offset == 0 {
                        unsafe { (*this).requests.discard(1) };
                        // SAFETY: queue held one ref; pointer is live until this deref.
                        unsafe { JSMySQLQuery::deref(request) };
                    }
                    offset += 1;
                    continue;
                }
                if req.is_being_prepared() {
                    debug!("isBeingPrepared");
                    // SAFETY: fresh `&mut *connection` reborrow (child of the
                    // shared raw tag); touches timer state outside the queue,
                    // and no `(*this)` access overlaps its lifetime.
                    unsafe { (*connection).reset_connection_timeout() };
                    unsafe {
                        (*this).is_ready_for_query = false;
                        (*this).waiting_to_prepare = true;
                    }
                    break 'advance;
                } else if req.is_running() {
                    // SAFETY: fresh `&mut *connection` reborrow (child of the
                    // shared raw tag); touches timer state outside the queue,
                    // and no `(*this)` access overlaps its lifetime.
                    unsafe { (*connection).reset_connection_timeout() };
                    debug!("isRunning after run");
                    unsafe { (*this).is_ready_for_query = false };

                    if req.is_pipelined() {
                        unsafe { (*this).pipelined_requests += 1 };
                        // SAFETY: `can_pipeline` takes `&self` + `&MySQLConnection`;
                        // both shared reborrows are children of the same raw
                        // tag (`this` was projected from `connection`), so
                        // overlapping shared reads are sound.
                        if unsafe { (*this).can_pipeline(&*connection) } {
                            debug!("pipelined requests");
                            offset += 1;
                            continue;
                        }
                        break 'advance;
                    }
                    debug!("nonpipelinable requests");
                    unsafe { (*this).nonpipelinable_requests += 1 };
                }
                break 'advance;
            }
        }

        // Zig: defer { while ... } — runs at function exit.
        // SAFETY: caller contract; fresh short-lived `(*this)` borrow per access.
        while unsafe { (*this).requests.readable_length() } > 0 {
            let request: *mut JSMySQLQuery = unsafe { (*this).requests.peek_item(0) };
            // Queue holds a ref on every request (taken in `add()`), so the
            // pointer is non-null and live. Separate heap allocation — never
            // aliases `*this`. R-2: `ParentRef` yields `&T` only; every method
            // body reached below is `&self` (interior mutability).
            let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));
            // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
            // so we do the cleanup her
            if req.is_completed() {
                debug!("isCompleted discard after advance");
                unsafe { (*this).requests.discard(1) };
                // SAFETY: queue held one ref; pointer is live until this deref.
                unsafe { JSMySQLQuery::deref(request) };
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
        // Caller passes a live JSMySQLQuery; we ref() it before storing.
        // R-2: `ParentRef` yields `&T` only — every method body reached below
        // is `&self` (interior mutability).
        let req = ParentRef::from(NonNull::new(request).expect("add: request non-null"));
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

    /// [`current`] as a [`bun_ptr::ThisPtr`] — one audited deref site here
    /// replaces the per-caller `unsafe { &*ptr }` / `ScopedRef::new(ptr)` pair.
    /// The queue holds a ref on every stored request, so the pointee is live;
    /// `JSMySQLQuery` is a separate heap allocation (never aliases the queue or
    /// its embedding connection) and is fully interior-mutable (R-2: every
    /// method is `&self`), so a shared `&JSMySQLQuery` derived via `Deref` is
    /// sound across `&mut self` on the connection.
    ///
    /// [`current`]: Self::current
    #[inline]
    pub fn current_ref(&self) -> Option<bun_ptr::ThisPtr<JSMySQLQuery>> {
        // SAFETY: `current()` returns a pointer the queue holds a ref on
        // (taken in `add()`); non-null and live until `discard()`/`read_item()`.
        self.current().map(|p| unsafe { bun_ptr::ThisPtr::new(p) })
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
            // Queue held a ref on every request; pointer is non-null and live
            // until `deref()`. R-2: `ParentRef` yields `&T` only — every method
            // body reached below is `&self`.
            let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));
            // Zig: defer request.deref() — moved to end of loop body; no early
            // exits between here and there.
            if !req.is_completed() {
                if let Some(r) = reason {
                    req.reject_with_js_value(queries_array, r);
                } else {
                    req.reject(queries_array, AnyMySQLError::ConnectionClosed);
                }
            }
            // SAFETY: queue held one ref; pointer is live until this deref.
            unsafe { JSMySQLQuery::deref(request) };
        }
    }
}

impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig iterates readableSlice(0) while
        // discard(1)'ing, which in Rust would overlap & / &mut borrows on
        // self.requests. read_item() peeks+discards in one &mut call.
        while let Some(request) = self.requests.read_item() {
            // Queue held a ref on every request; pointer is non-null and live
            // until `deref()`. R-2: `ParentRef` yields `&T` only.
            let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));
            // We cannot touch JS here
            req.mark_as_failed();
            // SAFETY: queue held one ref; pointer is live until this deref.
            unsafe { JSMySQLQuery::deref(request) };
        }
        self.pipelined_requests = 0;
        self.nonpipelinable_requests = 0;
        self.waiting_to_prepare = false;
        // self.requests drops automatically (Zig: this.#requests.deinit()).
    }
}

// ported from: src/sql_jsc/mysql/MySQLRequestQueue.zig
