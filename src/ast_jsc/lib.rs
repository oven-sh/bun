//! JSC bridge for `bun.logger`. Keeps `src/logger/` free of JSC types.

#![warn(unused_must_use)]

use std::borrow::Cow;

use bun_ast::{Data, Location, Msg};

use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};

pub fn msg_from_js(global_object: &JSGlobalObject, file: Vec<u8>, err: JSValue) -> JsResult<Msg> {
    let mut zig_exception_holder = jsc::zig_exception::Holder::init();

    if let Some(value) = err.to_error() {
        value.to_zig_exception(global_object, zig_exception_holder.zig_exception());
    } else {
        zig_exception_holder.zig_exception().message = err.to_bun_string(global_object)?;
    }

    Ok(Msg {
        data: Data {
            text: Cow::Owned(
                zig_exception_holder
                    .zig_exception()
                    .message
                    .to_owned_slice(),
            ),
            location: Some(Location {
                file: Cow::Owned(file),
                line: 0,
                column: 0,
                ..Default::default()
            }),
        },
        ..Default::default()
    })
}
