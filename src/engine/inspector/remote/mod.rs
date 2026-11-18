//! What a frontend gets to know of values, and how it refers to them.

mod by_value;
mod command_line;
mod evaluate;
mod internals;
mod object;
mod preview;
mod properties;
mod queries;
mod registry;

use bun_engine_text::StringRef;
use bun_engine_vm::{Cx, Gc, JsResult, Value};

pub(crate) use evaluate::Wanted;
pub(crate) use internals::function_details;
pub(crate) use object::Detail;
pub(crate) use properties::Selection;
pub(crate) use queries::as_scripts_see_it;
pub(crate) use registry::{ObjectId, Registries, Registry};

use crate::Controller;

/// Describes the values of a realm. The `Cx` that its methods take is in that realm.
#[derive(Clone, Copy)]
pub(crate) struct Remote<'a> {
    controller: &'a Controller,
    registry: Gc<Registry>,
    /// How many collections the preview at hand is in.
    nesting: u32,
}

impl<'a> Remote<'a> {
    pub(crate) fn new(controller: &'a Controller, registry: Gc<Registry>) -> Remote<'a> {
        Remote {
            controller,
            registry,
            nesting: 0,
        }
    }

    pub(crate) fn enter(self, cx: &mut Cx) -> &mut Cx {
        cx.in_realm(self.registry.global())
    }

    pub(crate) fn realm_id(self) -> i32 {
        self.registry.id()
    }

    pub(crate) fn find(self, id: Option<u32>) -> Option<Value> {
        self.registry.find(id)
    }

    pub(crate) fn group_of(self, id: Option<u32>) -> StringRef {
        self.registry.group_of(id)
    }

    pub(crate) fn release(self, id: Option<u32>) {
        id.into_iter().for_each(|id| self.registry.release(id));
    }
}

/// The most properties or entries in a response.
const MAX_LISTED: usize = 1 << 18;

/// Built-ins and the embedder have cells in variables and properties that are no values of the language.
pub(crate) fn as_value_of_language(value: Value) -> Value {
    let is_internal = (value.as_cell())
        .is_some_and(|it| !(it.is_object() || it.is_string() || it.is_symbol() || it.is_bigint()));
    if is_internal { Value::UNDEFINED } else { value }
}

/// What was thrown is the inner error. Only the end of execution gets through.
fn attempt<T>(cx: &Cx, result: JsResult<T>) -> JsResult<Result<T, Value>> {
    match result {
        Ok(value) => Ok(Ok(value)),
        Err(thrown) => cx.catch_value(thrown).map(Err),
    }
}

/// For where nothing can be done about an exception.
pub(crate) fn settle<T>(cx: &Cx, result: JsResult<T>) -> Option<T> {
    result
        .map_err(|thrown| cx.discard_unless_termination(thrown))
        .ok()
}
