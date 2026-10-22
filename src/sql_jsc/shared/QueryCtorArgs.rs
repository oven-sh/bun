//! Shared `createQuery(query, values, pendingValue?, bigint?, simple?)`
//! constructor-argument parsing/validation used by both the Postgres and MySQL
//! query constructors.

use crate::jsc::{JSGlobalObject, JSType, JSValue, JsResult};

pub(crate) struct QueryCtorArgs {
    pub query: JSValue,
    pub values: JSValue,
    pub pending_value: JSValue,
    pub bigint: bool,
    pub simple: bool,
}

impl QueryCtorArgs {
    pub(crate) fn parse(
        global_this: &JSGlobalObject,
        query: JSValue,
        values: JSValue,
        pending_value: JSValue,
        js_bigint: JSValue,
        js_simple: JSValue,
    ) -> JsResult<Self> {
        if !query.is_string() {
            return Err(global_this.throw(format_args!("query must be a string")));
        }

        if values.js_type() != JSType::Array {
            return Err(global_this.throw(format_args!("values must be an array")));
        }

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

        Ok(Self {
            query,
            values,
            pending_value,
            bigint,
            simple,
        })
    }
}
