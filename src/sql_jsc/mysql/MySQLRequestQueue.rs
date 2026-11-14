use core::cell::Cell;

use crate::jsc::JSValue;
use bun_jsc::JsCell;
use bun_ptr::RefPtr;
use std::collections::VecDeque;

use crate::mysql::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use crate::mysql::js_my_sql_query::JSMySQLQuery;

type Queue = VecDeque<RefPtr<JSMySQLQuery>>;

/// Requests in the order they go on the wire. The server answers in that order: its next packet is for the head.
pub struct MySQLRequestQueue {
    // `advance()` and `clean()` run JS, which comes back to the queue through `&self`.
    requests: JsCell<Queue>,
    /// How many requests at the front are written and can be followed: the one behind them is next to write.
    written: Cell<usize>,
}

impl MySQLRequestQueue {
    fn of(connection: &MySQLConnection) -> &Self {
        &connection.connection.get().queue
    }

    fn can_pipeline() -> bool {
        !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING
            .get()
            .unwrap_or(false)
    }

    pub(crate) fn advance(connection: &MySQLConnection) {
        loop {
            let queue = Self::of(connection);
            let written = queue.written.get();
            if written > 0 && queue.requests.get()[0].is_completed() {
                queue.requests.with_mut(|q| q.pop_front());
                queue.written.set(written - 1);
                continue;
            }
            let Some(request) = queue.requests.get().get(written).cloned() else {
                return;
            };
            if request.is_completed() {
                queue.requests.with_mut(|q| q.remove(written));
                continue;
            }
            if request.can_be_followed() {
                queue.written.set(written + 1);
                continue;
            }
            if !queue.is_waiting_to_write() || !connection.is_able_to_write() {
                return;
            }
            if let Err(err) = request.run(connection) {
                connection.on_error(Some(&*request), err);
            }
        }
    }

    pub(crate) fn is_waiting_to_write(&self) -> bool {
        let written = self.written.get();
        self.requests
            .get()
            .get(written)
            .is_some_and(|request| request.is_pending())
            && (written == 0 || Self::can_pipeline())
    }

    pub(crate) fn init() -> Self {
        Self {
            requests: JsCell::new(Queue::new()),
            written: Cell::new(0),
        }
    }

    pub(crate) fn add(&self, request: RefPtr<JSMySQLQuery>) {
        self.requests.with_mut(|q| q.push_back(request));
    }

    /// The queue's `RefPtr` keeps the pointee live; `JSMySQLQuery` is a
    /// separate heap allocation and fully interior-mutable, so a shared
    /// `&JSMySQLQuery` via `Deref` is sound across `&mut self` on the connection.
    #[inline]
    pub(crate) fn current(&self) -> Option<bun_ptr::ThisPtr<JSMySQLQuery>> {
        self.requests.get().front().map(RefPtr::this_ptr)
    }

    /// The pending requests up to the next internal one: they waited for a start that was refused.
    pub(crate) fn reject_unwritten_behind_refused_start(&self, error: JSValue) {
        let unwritten: Vec<RefPtr<JSMySQLQuery>> = self
            .requests
            .get()
            .iter()
            .skip(self.written.get())
            .filter(|request| request.is_pending())
            .take_while(|request| !request.is_internal())
            .cloned()
            .collect();
        for request in unwritten {
            request.reject_with_js_value(error);
        }
        error.ensure_still_alive();
    }

    pub(crate) fn clean(&self, reason: JSValue) {
        // Rejecting runs JS, which can fail the connection again: that call finds an empty queue.
        self.written.set(0);
        for request in self.requests.replace(Queue::new()) {
            request.reject_with_js_value(reason);
        }
    }
}

impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        for req in self.requests.replace(Queue::new()) {
            // We cannot touch JS here
            req.mark_as_failed();
        }
    }
}
