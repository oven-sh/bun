use core::cell::Cell;

use crate::jsc::JSValue;
use bun_ptr::{CellExt as _, RefPtr, RefPtrDequeCellExt as _, VecDequeCellExt as _};
use std::collections::VecDeque;

use crate::mysql::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use crate::mysql::js_my_sql_query::JSMySQLQuery;

type Queue = VecDeque<RefPtr<JSMySQLQuery>>;

/// Requests in the order they go on the wire. The server answers in that order: its next packet is for the head.
pub struct MySQLRequestQueue {
    // `advance()` and `clean()` run JS, which comes back to the queue through `&self`.
    requests: Cell<Queue>,
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
            if written > 0 && self.is_head_completed() {
                self.requests.pop_front();
                self.written.set(written - 1);
                continue;
            }
            let Some(request) = self.requests.get_cloned(written) else {
                return;
            };
            if request.is_completed() {
                self.requests.with_taken(|q| q.remove(written));
                continue;
            }
            if request.can_be_followed() {
                self.written.set(written + 1);
                continue;
            }
            if !request.is_pending() || !self.can_write_next() || !connection.is_able_to_write() {
                return;
            }
            if let Err(err) = request.run(connection) {
                connection.on_error(Some(&*request), err);
            }
        }
    }

    fn is_head_completed(&self) -> bool {
        self.requests
            .get_cloned(0)
            .is_some_and(|head| head.is_completed())
    }

    fn can_write_next(&self) -> bool {
        self.written.get() == 0 || Self::can_pipeline()
    }

    pub(crate) fn is_waiting_to_write(&self) -> bool {
        self.requests
            .get_cloned(self.written.get())
            .is_some_and(|request| request.is_pending())
            && self.can_write_next()
    }

    pub(crate) fn init() -> Self {
        Self {
            requests: Cell::default(),
            written: Cell::new(0),
        }
    }

    pub(crate) fn add(&self, request: RefPtr<JSMySQLQuery>) {
        self.requests.push_back(request);
    }

    /// The head, if the server's next packet is for it.
    pub(crate) fn in_flight(&self) -> Option<RefPtr<JSMySQLQuery>> {
        self.requests
            .get_cloned(0)
            .filter(|request| request.is_in_flight())
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.requests.is_empty()
    }

    pub(crate) fn clean(&self, reason: JSValue) {
        // Rejecting runs JS, which can fail the connection again: that call finds an empty queue.
        self.written.set(0);
        for request in self.requests.take() {
            request.reject_with_js_value(reason);
        }
    }
}

impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        for req in self.requests.take() {
            // We cannot touch JS here
            req.mark_as_failed();
        }
    }
}
