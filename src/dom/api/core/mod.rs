//! The tree, and events.
//!
//! A `&Node` is rooted while it is on the stack, and nowhere else. A `NodeId` may be kept for a connected node until its removing
//! steps, or with `Doc::version` by what has an edge to the root.

mod agent;
pub(crate) mod arena;
mod atom;
mod atoms;
pub(crate) mod bare;
pub(crate) mod by_name;
mod changes;
pub(crate) mod collections;
pub(crate) mod custom;
mod document;
pub(crate) mod document_members;
mod document_state;
mod edges;
mod element;
mod gc;
pub(crate) mod html;
mod instruction;
mod kinds;
mod members;
pub(crate) mod metadata;
mod mould;
mod mutation;
pub(crate) mod named;
mod node;
pub(crate) mod observers;
pub(crate) mod page;
mod recent;
pub(crate) mod reflect;
pub(crate) mod seams;
mod selectors;
mod slots;
pub(crate) mod steps;
mod string;
mod tables;
mod tokens;
pub(crate) mod traversal;
pub(crate) mod url;

use bun_jsc::bindgen::{Error, JsHeap};

pub(crate) use agent::Agent;
pub(crate) use atom::{Atom, Meaning, Ns, QualName};
pub(crate) use atoms::{Known, atom};
pub(crate) use bun_jsc::DOMExceptionCode as DomError;
pub(crate) use changes::Reads;
pub(crate) use collections::{Bare, Collection, Filter, Test};
pub(crate) use document::{
    DocFlags, Synchronous, global_of_cell, has_scoped_registries, is_valid_custom_element_name,
    note_scoped_registry,
};
pub(crate) use document_state::ReadyState;
pub(crate) use edges::Edge;
pub(crate) use element::{NameFor, validate_attribute_name, validate_element_name};
pub(crate) use gc::{List, Rooted, global_of};
pub(crate) use kinds::{Kind, NodeType};
pub(crate) use mould::Mould;
pub(crate) use mutation::*;
pub(crate) use node::{Node, NodeFlags, NodeInterface, node_interface};
pub(crate) use observers::{MutationObserver, MutationRecord, Record, queue_mutation_record};
pub(crate) use recent::Recent;
pub(crate) use slots::{ShadowFlags, assign_slottables};
pub(crate) use string::{
    DomString, Familiar, StoredText, StringBuilder, impl_of, is_ascii_whitespace,
};
pub(crate) use tokens::DOMTokenList;

pub(crate) use crate::generated_bindgen::collections::{
    HTMLAllCollection, HTMLCollection, NodeList,
};
pub(crate) use crate::generated_bindgen::core::{
    Attr, CharacterData, DesktopEventTarget as EventTarget, Doc, DocumentFragment, DocumentType,
    DomElement as Element, ShadowRoot, Text,
};

pub(crate) use crate::api::events::{
    Event, EventInit, Trusted, dispatch, dispatch_below, fire, is_listened_to,
};

node_interface!(Element, it if it.is_element());
node_interface!(CharacterData, it if it.is_character_data());
node_interface!(Text, Kind::Text | Kind::CData);
node_interface!(Doc, Kind::Document | Kind::HtmlDocument | Kind::XmlDocument);
node_interface!(DocumentFragment, Kind::Fragment | Kind::ShadowRoot);
node_interface!(ShadowRoot, Kind::ShadowRoot);
node_interface!(DocumentType, Kind::Doctype);
node_interface!(Attr, Kind::Attr);

#[cold]
pub(crate) fn dom_error<'a>(heap: &JsHeap<'a>, code: DomError, message: &str) -> Error<'a> {
    heap.dom_exception(code, format_args!("{message}"))
}
