//! Shared `createInstance` argument parsing for the SQL query bindings.
//!
//! `PostgresSQLQuery::call` and `JSMySQLQuery::create_instance` receive the same six JS
//! arguments (`query`, `values`, `pendingValue`, `columns`, `bigint`, `simple`); [`parse`]
//! owns the one copy of that decoding and validation — mirroring
//! [`connection_args::parse`](crate::shared::connection_args::parse) for connections — so
//! the two drivers can't drift.

use crate::jsc::{CallFrame, JSGlobalObject, JSType, JSValue, JsResult};

/// The parsed `createInstance` arguments common to Postgres and MySQL.
pub(crate) struct QueryArgs {
    /// `arguments[0]` — validated to be a JS string.
    pub query: JSValue,
    /// `arguments[1]` — validated to be a JS array.
    pub values: JSValue,
    /// `arguments[2]` — validated to be array-like.
    pub pending_value: JSValue,
    /// `arguments[3]` — may be `undefined`.
    pub columns: JSValue,
    pub bigint: bool,
    pub simple: bool,
}

/// Decode and validate `arguments[0..=5]`.
pub(crate) fn parse(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<QueryArgs> {
    let mut arguments = callframe.arguments().iter().copied();

    let Some(query) = arguments.next() else {
        return Err(global_this.throw(format_args!("query must be a string")));
    };
    let Some(values) = arguments.next() else {
        return Err(global_this.throw(format_args!("values must be an array")));
    };

    if !query.is_string() {
        return Err(global_this.throw(format_args!("query must be a string")));
    }

    if values.js_type() != JSType::Array {
        return Err(global_this.throw(format_args!("values must be an array")));
    }

    let pending_value = arguments.next().unwrap_or(JSValue::UNDEFINED);
    let columns = arguments.next().unwrap_or(JSValue::UNDEFINED);
    let js_bigint = arguments.next().unwrap_or(JSValue::FALSE);
    let js_simple = arguments.next().unwrap_or(JSValue::FALSE);

    let bigint = js_bigint.is_boolean() && js_bigint.as_boolean();
    let simple = js_simple.is_boolean() && js_simple.as_boolean();
    if simple {
        if values.get_length(global_this)? > 0 {
            return Err(global_this
                .throw_invalid_arguments(format_args!("simple query cannot have parameters")));
        }
        if query.get_length(global_this)? >= i32::MAX as u64 {
            return Err(global_this.throw_invalid_arguments(format_args!("query is too long")));
        }
    }
    if !pending_value.js_type().is_array_like() {
        return Err(global_this.throw_invalid_argument_type("query", "pendingValue", "Array"));
    }

    Ok(QueryArgs {
        query,
        values,
        pending_value,
        columns,
        bigint,
        simple,
    })
}
