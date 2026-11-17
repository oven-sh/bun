//! What elements of a kind do when the standards say "run the ... steps".

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsScope};

use super::{Doc, DomString, Element, Event, Kind, Known, Node, Ns, QualName};

pub(crate) struct AttrChange<'c> {
    pub(crate) name: &'c QualName,
    pub(crate) old: Option<&'c DomString>,
    pub(crate) new: Option<&'c DomString>,
}

impl AttrChange<'_> {
    /// `Other` if it has a namespace.
    #[inline]
    pub(crate) fn known(&self) -> Known {
        if self.name.ns == Ns::None {
            self.name.local.known()
        } else {
            Known::Other
        }
    }

    #[inline]
    pub(crate) fn is(&self, name: Known) -> bool {
        self.known() == name
    }
}

type Cx<'c, 'a> = &'c mut JsScope<'a>;

pub(crate) struct Steps {
    pub(crate) created: Option<for<'a> fn(&JsHeap<'a>, &'a Element)>,
    /// Builds the shadow tree of a control, before it is first rendered.
    pub(crate) ua_shadow: Option<for<'a> fn(Cx<'_, 'a>, &'a Element)>,
    pub(crate) attribute_changed: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, &AttrChange<'_>)>,
    /// The `bool` of these: by `moveBefore`.
    pub(crate) inserted: Option<for<'a> fn(&JsHeap<'a>, &'a Element, bool)>,
    pub(crate) post_connection: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, bool)>,
    /// With the document or the shadow root that it was in.
    pub(crate) removed: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, &'a Node, bool)>,
    /// With the parent that it has left, if it has.
    pub(crate) parent_changed: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, Option<&'a Node>)>,
    pub(crate) children_changed: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, bool)>,
    pub(crate) finished_parsing: Option<for<'a> fn(Cx<'_, 'a>, &'a Element)>,
    /// From, to, with the subtree.
    pub(crate) cloned: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, &'a Element, bool)>,
    pub(crate) adopted: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, &'a Doc)>,
    /// It is in the document that is shown, and the engine knows nothing about it but its attributes and its state.
    pub(crate) rendered: Option<for<'a> fn(Cx<'_, 'a>, &'a Element)>,
    pub(crate) pre_activate: Option<for<'a> fn(Cx<'_, 'a>, &'a Element) -> JSValue>,
    /// With the node that was clicked, and what `pre_activate` has answered.
    pub(crate) activate: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, &'a Event, &'a Node, JSValue)>,
    pub(crate) cancel_activate: Option<for<'a> fn(Cx<'_, 'a>, &'a Element, JSValue)>,
    /// Of a trusted event other than `click`. True if there is nothing more to do.
    pub(crate) default_action:
        Option<for<'a> fn(Cx<'_, 'a>, &'a Element, &'a Event, &'a Node) -> bool>,
}

impl Steps {
    pub(crate) const NONE: Steps = Steps {
        created: None,
        ua_shadow: None,
        attribute_changed: None,
        inserted: None,
        post_connection: None,
        removed: None,
        parent_changed: None,
        children_changed: None,
        finished_parsing: None,
        cloned: None,
        adopted: None,
        rendered: None,
        pre_activate: None,
        activate: None,
        cancel_activate: None,
        default_action: None,
    };
}

bitflags::bitflags! {
    /// Which steps a kind has.
    #[derive(Clone, Copy, Default)]
    pub(crate) struct Has: u16 {
        const CREATED = 1;
        const UA_SHADOW = 1 << 1;
        const ATTRIBUTE_CHANGED = 1 << 2;
        const POST_CONNECTION = 1 << 3;
        const REMOVED = 1 << 4;
        const PARENT_CHANGED = 1 << 5;
        const CHILDREN_CHANGED = 1 << 6;
        const FINISHED_PARSING = 1 << 7;
        const CLONED = 1 << 8;
        const ADOPTED = 1 << 9;
        const RENDERED = 1 << 10;
        const PRE_ACTIVATE = 1 << 11;
        const ACTIVATE = 1 << 12;
        const CANCEL_ACTIVATE = 1 << 13;
        const DEFAULT_ACTION = 1 << 14;
        const INSERTED = 1 << 15;
    }
}

impl Has {
    pub(super) fn of(kind: Kind) -> Has {
        let (steps, mut has) = (kind.steps(), Has::empty());
        for (is_there, bit) in [
            (steps.created.is_some(), Has::CREATED),
            (steps.ua_shadow.is_some(), Has::UA_SHADOW),
            (steps.attribute_changed.is_some(), Has::ATTRIBUTE_CHANGED),
            (steps.inserted.is_some(), Has::INSERTED),
            (steps.post_connection.is_some(), Has::POST_CONNECTION),
            (steps.removed.is_some(), Has::REMOVED),
            (steps.parent_changed.is_some(), Has::PARENT_CHANGED),
            (steps.children_changed.is_some(), Has::CHILDREN_CHANGED),
            (steps.finished_parsing.is_some(), Has::FINISHED_PARSING),
            (steps.cloned.is_some(), Has::CLONED),
            (steps.adopted.is_some(), Has::ADOPTED),
            (steps.rendered.is_some(), Has::RENDERED),
            (steps.pre_activate.is_some(), Has::PRE_ACTIVATE),
            (steps.activate.is_some(), Has::ACTIVATE),
            (steps.cancel_activate.is_some(), Has::CANCEL_ACTIVATE),
            (steps.default_action.is_some(), Has::DEFAULT_ACTION),
        ] {
            has |= if is_there { bit } else { Has::empty() };
        }
        has
    }
}
