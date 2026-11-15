//! Native code that answers outside the type it declares, on purpose, for `bun:internal-for-testing`.
//! It is in every build: what it shows is that release `bun run` lets the answer through and that an executable compiled ahead of time stops.

use crate::bindgen::{self, JsHeap, JsLocal};

pub(crate) fn declared_as_string<'a>(_: &JsHeap<'a>, value: JsLocal<'a>) -> JsLocal<'a> {
    value
}

pub(crate) fn holds_results_to_declared_types() -> bool {
    bindgen::holds_results_to_declared_types()
}
