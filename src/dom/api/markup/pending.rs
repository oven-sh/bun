//! What the parser needs of the rest.

use bun_jsc::bindgen::JsScope;

use crate::api::core::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

pub(super) fn before_constructing<'a>(
    cx: Cx<'_, 'a>,
    parent: &'a Node,
    name: &Atom,
    is: Option<&Atom>,
) {
    if custom::look_up(custom::registry_of(parent), name, is).is_some() {
        crate::api::events::microtask_checkpoint(cx);
    }
}

pub(super) use crate::api::forms::associate_by_parser as associate_with_form;
