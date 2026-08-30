//! Shared `createQuery(query, values, pendingValue?, columns?, bigint?,
//! simple?)` constructor-argument parsing/validation used by both the
//! Postgres and MySQL query constructors.

use crate::jsc::{JSGlobalObject, JSGlobalObjectSqlExt as _, JSType, JSValue, JsResult};

bun_core::bool_enum!(
    /// Return 64-bit integers as JS `BigInt` (otherwise as strings).
    pub UseBigint
);
bun_core::bool_enum!(
    /// Simple (text-protocol, unparameterised) query vs. prepared statement.
    pub SimpleQuery
);

pub(crate) struct QueryCtorArgs {
    pub query: JSValue,
    pub values: JSValue,
    pub pending_value: JSValue,
    pub columns: JSValue,
    pub bigint: UseBigint,
    pub simple: SimpleQuery,
}

impl QueryCtorArgs {
    pub(crate) fn parse(global_this: &JSGlobalObject, arguments: &[JSValue]) -> JsResult<Self> {
        let mut args =
            crate::jsc::call_frame::ArgumentsSlice::init(global_this.sql_vm(), arguments);
        let Some(query) = args.next_eat() else {
            return Err(global_this.throw(format_args!("query must be a string")));
        };
        let Some(values) = args.next_eat() else {
            return Err(global_this.throw(format_args!("values must be an array")));
        };

        if !query.is_string() {
            return Err(global_this.throw(format_args!("query must be a string")));
        }

        if values.js_type() != JSType::Array {
            return Err(global_this.throw(format_args!("values must be an array")));
        }

        let pending_value: JSValue = args.next_eat().unwrap_or(JSValue::UNDEFINED);
        let columns: JSValue = args.next_eat().unwrap_or(JSValue::UNDEFINED);
        let js_bigint: JSValue = args.next_eat().unwrap_or(JSValue::FALSE);
        let js_simple: JSValue = args.next_eat().unwrap_or(JSValue::FALSE);

        let bigint = UseBigint::from_bool(js_bigint.is_boolean() && js_bigint.as_boolean());
        let simple = SimpleQuery::from_bool(js_simple.is_boolean() && js_simple.as_boolean());
        if simple == SimpleQuery::Yes {
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
            columns,
            bigint,
            simple,
        })
    }
}
