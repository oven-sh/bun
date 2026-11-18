//! The functions of `js/*.js`. `js::array_prototype::forEach` is the one of that name in `ArrayPrototype.js`.
//!
//! A function starts with `function`, `async function` or `function*` in the first column, has its parameters, which
//! are plain names, on that line, and ends with `}` in the first column. It is strict. These lines may precede it:
//!
//! - `// @name text`: its `name`, such as `get size` or `[Symbol.dispose]`.
//! - `// @private`: built-ins call `fooBar` as `@fooBar`, through the slot `private_foo_bar: JsFunction = @fooBar`.
//! - `// @constructor`: for `define_builtin_constructor!`. `this` is `new.target`.
//! - `// @visibility Name`: a `Visibility`. Private and async functions are `Private`, the others `Public`.
//! - `// @intrinsic Name`: an `Intrinsic`.
//! - `// @alwaysInline`

#![allow(non_upper_case_globals)]

use bun_engine_bytecode::Visibility;
use bun_engine_vm::{BuiltinId, BuiltinSource, Cx, Gc, Intrinsic, JsFunction, RealmSlot};

include!(concat!(env!("OUT_DIR"), "/js.rs"));

pub fn builtin_source(id: BuiltinId) -> &'static BuiltinSource {
    &SOURCES[usize::from(id.0)]
}

/// A new function object.
pub(crate) fn function(cx: &Cx, id: BuiltinId) -> Gc<JsFunction> {
    JsFunction::builtin(cx, cx.builtin_executable(id))
}
