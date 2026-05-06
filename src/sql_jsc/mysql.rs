use crate::jsc::{JSFunction, JSGlobalObject, JSValue};

pub fn create_binding(global_object: &JSGlobalObject) -> JSValue {
    let binding = JSValue::create_empty_object_with_null_prototype(global_object);
    binding.put(
        global_object,
        bun_string::ZigString::static_(b"MySQLConnection"),
        crate::jsc::codegen::JSMySQLConnection::get_constructor(global_object),
    );
    binding.put(
        global_object,
        bun_string::ZigString::static_(b"init"),
        JSFunction::create(global_object, "init", my_sql_context::init, 0, Default::default()),
    );
    binding.put(
        global_object,
        bun_string::ZigString::static_(b"createQuery"),
        JSFunction::create(global_object, "createQuery", js_my_sql_query::JSMySQLQuery::create_instance, 6, Default::default()),
    );
    binding.put(
        global_object,
        bun_string::ZigString::static_(b"createConnection"),
        JSFunction::create(global_object, "createConnection", js_my_sql_connection::JSMySQLConnection::create_instance, 2, Default::default()),
    );
    binding
}

// ──────────────────────────────────────────────────────────────────────────
// Submodule tree (Phase-A draft files use PascalCase basenames; wired via
// `#[path]`). Heavy modules remain ``-gated until their lower-
// tier deps land — see per-module `TODO(b2-blocked)` markers.
// ──────────────────────────────────────────────────────────────────────────

#[path = "mysql/MySQLContext.rs"]
pub mod my_sql_context;

#[path = "mysql/MySQLStatement.rs"]
pub mod my_sql_statement;

#[path = "mysql/MySQLRequestQueue.rs"]
pub mod my_sql_request_queue;

// TODO(b2-blocked): bun_jsc::JsRef + JSValue method surface (.call, .ensure_still_alive)
// TODO(b2-blocked): bun_jsc::host_fn proc-macro

#[path = "mysql/MySQLQuery.rs"]
pub mod my_sql_query;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro + JSValue/CallFrame method surface

#[path = "mysql/JSMySQLQuery.rs"]
pub mod js_my_sql_query;

#[path = "mysql/MySQLValue.rs"]
pub mod my_sql_value;

// TODO(b2-blocked): bun_jsc::host_fn proc-macro
// TODO(b2-blocked): bun_uws::Socket method surface
// TODO(b2-blocked): bun_jsc::VirtualMachine::get / RareData

#[path = "mysql/JSMySQLConnection.rs"]
pub mod js_my_sql_connection;

#[path = "mysql/MySQLConnection.rs"]
pub mod my_sql_connection;

// ──────────────────────────────────────────────────────────────────────────
// Forward-decl stubs for JSMySQLConnection / JSMySQLQuery.
//
// The full files (JSMySQLConnection.rs / JSMySQLQuery.rs) remain gated on
// `bun_jsc::host_fn` + the `.classes.ts` codegen. These stubs expose only the
// struct shape + method surface that the connection state machine
// (`MySQLConnection.rs`) and request queue (`MySQLRequestQueue.rs`) name, so
// the protocol-layer state machine type-checks. Bodies are unimplemented!().
//
// TODO(b2-blocked): replace with `#[path = "mysql/JSMySQL{Connection,Query}.rs"]`
// once bun_jsc proc-macro shims compile.
// ──────────────────────────────────────────────────────────────────────────

pub mod js_mysql_connection {
    use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
    use bun_sql::mysql::protocol::error_packet::ErrorPacket;
    use bun_sql::mysql::protocol::new_reader::{NewReader, ReaderContext};
    use super::my_sql_statement::MySQLStatement;
    use super::js_mysql_query::JSMySQLQuery;

    /// Forward-decl shape of `mysql/JSMySQLConnection.rs::JSMySQLConnection`.
    /// Only the `connection` field is surfaced (needed for `offset_of!` in
    /// `MySQLConnection::get_js_connection` — the @fieldParentPtr port).
    #[repr(C)]
    pub struct JSMySQLConnection {
        // PORT NOTE: in the real struct, `connection` sits after ref_count /
        // js_value / global_object / vm / poll_ref. The forward-decl keeps it
        // as the only field; `offset_of!(JSMySQLConnection, connection)` will be
        // wrong until the real layout lands, but this is compile-only Phase-B
        // scaffolding (bodies are unimplemented!).
        pub connection: super::my_sql_connection::MySQLConnection,
    }

    impl JSMySQLConnection {
        #[inline]
        pub fn is_able_to_write(&self) -> bool {
            self.connection.is_able_to_write()
        }
        pub fn reset_connection_timeout(&mut self) {
            unimplemented!("b2-blocked: JSMySQLConnection::reset_connection_timeout")
        }
        pub fn on_connection_established(&mut self) {
            unimplemented!("b2-blocked: JSMySQLConnection::on_connection_established")
        }
        pub fn on_error(&mut self, _request: Option<&mut JSMySQLQuery>, _err: AnyMySQLError) {
            unimplemented!("b2-blocked: JSMySQLConnection::on_error")
        }
        pub fn on_error_packet(&mut self, _request: Option<&mut JSMySQLQuery>, _err: ErrorPacket) {
            unimplemented!("b2-blocked: JSMySQLConnection::on_error_packet")
        }
        pub fn on_query_result(
            &mut self,
            _request: &mut JSMySQLQuery,
            _result: super::my_sql_connection::QueryResult,
        ) {
            unimplemented!("b2-blocked: JSMySQLConnection::on_query_result")
        }
        pub fn on_result_row<C: ReaderContext>(
            &mut self,
            _request: &mut JSMySQLQuery,
            _statement: &mut MySQLStatement,
            _reader: NewReader<C>,
        ) -> Result<(), AnyMySQLError> {
            unimplemented!("b2-blocked: JSMySQLConnection::on_result_row")
        }
    }

    /// `MySQLRequestQueue.rs` imports `MySQLConnection` from this module (Zig
    /// re-export pattern) but means the JS-wrapper type. Alias it.
    pub use JSMySQLConnection as MySQLConnection;

    pub mod js {
        pub use crate::jsc::codegen::js_mysql_connection::*;
    }
}

pub mod js_mysql_query {
    use core::cell::Cell;
    use crate::jsc::JSValue;
    use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
    use super::my_sql_statement::MySQLStatement;
    use super::js_mysql_connection::JSMySQLConnection;

    /// Forward-decl shape of `mysql/JSMySQLQuery.rs::JSMySQLQuery`.
    pub struct JSMySQLQuery {
        pub ref_count: Cell<u32>,
    }

    impl JSMySQLQuery {
        // ── intrusive refcount ───────────────────────────────────────────
        pub fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
        pub fn deref(&self) {
            let n = self.ref_count.get() - 1;
            self.ref_count.set(n);
            if n == 0 { unimplemented!("b2-blocked: JSMySQLQuery::deinit") }
        }
        /// `deref_` is the spelling some call sites use (Zig `deref()` collides
        /// with Rust `Deref`); both forward to the same intrusive-rc decrement.
        pub fn deref_(&self) { self.deref(); }

        // ── status predicates (forward to inner MySQLQuery) ──────────────
        pub fn is_completed(&self) -> bool { unimplemented!("b2-blocked: JSMySQLQuery::is_completed") }
        pub fn is_running(&self) -> bool { unimplemented!("b2-blocked: JSMySQLQuery::is_running") }
        pub fn is_pending(&self) -> bool { unimplemented!("b2-blocked: JSMySQLQuery::is_pending") }
        pub fn is_being_prepared(&self) -> bool { unimplemented!("b2-blocked: JSMySQLQuery::is_being_prepared") }
        pub fn is_pipelined(&self) -> bool { unimplemented!("b2-blocked: JSMySQLQuery::is_pipelined") }
        pub fn is_simple(&self) -> bool { unimplemented!("b2-blocked: JSMySQLQuery::is_simple") }

        // ── state transitions ────────────────────────────────────────────
        pub fn mark_as_prepared(&mut self) { unimplemented!("b2-blocked: JSMySQLQuery::mark_as_prepared") }
        pub fn mark_as_failed(&mut self) { unimplemented!("b2-blocked: JSMySQLQuery::mark_as_failed") }

        pub fn run(&mut self, _connection: &mut JSMySQLConnection) -> Result<(), AnyMySQLError> {
            unimplemented!("b2-blocked: JSMySQLQuery::run")
        }
        pub fn reject(&mut self, _queries_array: JSValue, _err: AnyMySQLError) {
            unimplemented!("b2-blocked: JSMySQLQuery::reject")
        }
        pub fn reject_with_js_value(&mut self, _queries_array: JSValue, _err: JSValue) {
            unimplemented!("b2-blocked: JSMySQLQuery::reject_with_js_value")
        }
        pub fn get_statement(&mut self) -> Option<&mut MySQLStatement> {
            unimplemented!("b2-blocked: JSMySQLQuery::get_statement")
        }
    }

    pub mod js {
        pub use crate::jsc::codegen::js_mysql_query::*;
    }
}

pub mod protocol {
    #[path = "Signature.rs"]
    pub mod signature;
    pub use signature::Signature;

    #[path = "error_packet_jsc.rs"]
    pub mod error_packet_jsc;

    #[path = "any_mysql_error_jsc.rs"]
    pub mod any_mysql_error_jsc;

    // TODO(b2-blocked): bun_jsc::JSValue method surface (date/number/buffer constructors)
    
    #[path = "DecodeBinaryValue.rs"]
    pub mod decode_binary_value;

    // TODO(b2-blocked): bun_jsc::JSValue / bun_jsc::JSObject method surface
    
    #[path = "ResultSet.rs"]
    pub mod result_set;
}

pub use my_sql_context::MySQLContext;
pub use my_sql_statement::MySQLStatement;
pub use my_sql_connection::MySQLConnection;
pub use my_sql_request_queue::MySQLRequestQueue;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql.zig (28 lines)
//   confidence: medium
//   todos:      see TODO(b2-blocked) above
//   notes:      `create_binding` body gated; submodule filenames PascalCase → #[path]
// ──────────────────────────────────────────────────────────────────────────
