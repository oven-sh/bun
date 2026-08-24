//! JSC bridge for `bun_css::Err<T>`. Keeps `src/css/` free of JSC types.

use core::fmt::Display;

use bun_jsc::{JSGlobalObject, JSValue};

/// `this` is `&css::Err<T>` for any `T`; only `.kind` is accessed.
pub(crate) fn to_error_instance<T: Display>(
    this: &bun_css::Err<T>,
    global_this: &JSGlobalObject,
) -> JSValue {
    global_this.create_error_instance(format_args!("{}", this.kind))
}
