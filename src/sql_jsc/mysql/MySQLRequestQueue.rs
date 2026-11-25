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
    fn can_pipeline() -> bool {
        !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING
            .get()
            .unwrap_or(false)
    }

    pub(crate) fn advance(&self, connection: &MySQLConnection) {
        loop {
            let written = self.written.get();
            if written > 0 && self.requests.get()[0].is_completed() {
                self.requests.with_mut(|q| q.pop_front());
                self.written.set(written - 1);
                continue;
            }
            let Some(request) = self.requests.get().get(written).cloned() else {
                return;
            };
            if request.is_completed() {
                self.requests.with_mut(|q| q.remove(written));
                continue;
            }
            if request.can_be_followed() {
                self.written.set(written + 1);
                continue;
            }
            if !self.is_waiting_to_write() || !connection.is_able_to_write() {
                return;
            }
            if let Err(err) = request.run(connection) {
                request.reject(err);
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

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.requests.get().is_empty()
    }

    pub(crate) fn is_head_in_flight(&self) -> bool {
        self.requests
            .get()
            .front()
            .is_some_and(|head| head.is_in_flight())
    }

    #[inline]
    pub(crate) fn current(&self) -> Option<RefPtr<JSMySQLQuery>> {
        self.requests.get().front().cloned()
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
