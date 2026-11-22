//! The limits of a simple query, for `createQuery` of Postgres and MySQL.

use crate::jsc::{JSGlobalObject, JSValue, JsResult};

pub(crate) fn validate(
    global_this: &JSGlobalObject,
    query: &bun_core::String,
    values: JSValue,
    simple: bool,
) -> JsResult<()> {
    if simple {
        if values.get_length(global_this)? > 0 {
            return Err(global_this
                .throw_invalid_arguments(format_args!("simple query cannot have parameters")));
        }
        if query.length() >= i32::MAX as usize {
            return Err(global_this.throw_invalid_arguments(format_args!("query is too long")));
        }
    }

    Ok(())
}
