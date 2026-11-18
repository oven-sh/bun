//! <https://html.spec.whatwg.org/#scrolling-to-a-fragment>

use super::*;
use crate::api::ui::{entry as page, focus, tabbing};
use crate::name::name;
use crate::selector::{filter, key};

/// <https://html.spec.whatwg.org/#select-the-indicated-part>
pub(crate) fn indicated_element<'a>(doc: &'a Doc, fragment: &str) -> Option<&'a Element> {
    let find = |name: &str| {
        let is_named = |it: &crate::tree::Element| {
            it.html_tag() == name!("a") && it.attribute(name!("name")) == Some(name)
        };
        let keys = filter(core::iter::once(key::attribute(name!("name"))));
        let anchor = || {
            doc.read(|tree, root| {
                tree.descendants_with(root, keys)
                    .find(|it| tree.element(*it).is_some_and(is_named))
            })
        };
        doc.element_by_id(&Atom::new(name))
            .or_else(|| doc.node(anchor()?)?.as_element())
    };
    find(fragment).or_else(|| find(&lossy(&bun_web::url::percent_decode(fragment.as_bytes()))))
}

impl History {
    fn indicate<'a>(&'a self, cx: &mut Cx<'a>, target: Option<&'a Element>) {
        self.target()
            .into_iter()
            .for_each(|it| it.set_state(cx, State::TARGET, false));
        self.set_target(target);
        target
            .into_iter()
            .for_each(|it| it.set_state(cx, State::TARGET, true));
    }

    pub(super) fn scroll_to_fragment<'a>(&'a self, cx: &mut Cx<'a>, scrolls: bool) -> bool {
        self.window().set_phase(Phase::IGNORES_FRAGMENT, false);
        let is_shown = self.show_fragment(cx, scrolls);
        self.window().set_phase(Phase::HAS_SHOWN_FRAGMENT, is_shown);
        self.window()
            .document()
            .engine(|engine, _| engine.scrolling.has_moved_on = false);
        is_shown
    }

    /// What comes later may have pushed it away.
    pub(super) fn keep_fragment_in_view<'a>(&'a self, cx: &mut Cx<'a>, scrolls: bool) {
        let (window, doc) = (self.window(), self.window().document());
        if window.is_in(Phase::IGNORES_FRAGMENT) {
            return;
        }
        let scrolls = scrolls && !doc.engine(|engine, _| engine.scrolling.has_moved_on);
        match self.target().filter(|_| {
            window.is_in(Phase::HAS_SHOWN_FRAGMENT) && self.text_directives.borrow().is_none()
        }) {
            Some(target)
                if scrolls && !doc.document_element().is_some_and(|it| it.kind().is_svg()) =>
            {
                view::scroll_to_start_of(cx, target)
            }
            Some(_) => {}
            None => _ = self.scroll_to_fragment(cx, scrolls),
        }
    }

    fn show_fragment<'a>(&'a self, cx: &mut Cx<'a>, scrolls: bool) -> bool {
        let (doc, url) = (self.window().document(), self.window().url());
        let directives = self.text_directives.borrow().clone();
        if directives
            .is_some_and(|it| crate::api::find::show_text_fragment(cx, doc, it.as_bytes(), scrolls))
        {
            return true;
        }
        let fragment = split_fragment(&url).1.unwrap_or("");
        let found = if fragment.is_empty() {
            None
        } else {
            indicated_element(doc, fragment)
        };
        let is_svg = doc.document_element().is_some_and(|it| it.kind().is_svg());
        if is_svg {
            doc.engine(|engine, _| engine.show_fragment());
        }
        self.indicate(cx, found);
        let Some(found) = found else {
            let is_top = fragment.is_empty() || fragment.eq_ignore_ascii_case("top");
            if is_top && scrolls {
                view::jump_viewport(cx, doc, [0.0; 2], ScrollBehavior::Auto);
            }
            return is_top;
        };
        page::reveal(cx, found);
        if scrolls && !(is_svg && doc.is(DocFlags::IN_FRAME)) {
            view::scroll_to_start_of(cx, found);
        }
        if focus::is_focusable(cx, found) {
            focus::focus(
                cx,
                found,
                focus::Cause::Script,
                focus::Options {
                    prevents_scroll: true,
                    ..Default::default()
                },
            );
        } else {
            Ui::of(doc)
                .into_iter()
                .for_each(|it| page::reset_focus(cx, it));
            Ui::of(doc)
                .into_iter()
                .for_each(|it| tabbing::start_at(it, Some(found)));
        }
        true
    }
}

pub(crate) fn has_target(doc: &Doc) -> bool {
    Window::of(doc)
        .and_then(Window::history_if_any)
        .and_then(History::target)
        .is_some()
}

pub(crate) fn targets_may_have_moved<'a>(cx: &mut Cx<'a>, docs: [&'a Doc; 2]) {
    for doc in docs {
        let target = Window::of(doc)
            .and_then(Window::history_if_any)
            .and_then(History::target);
        target
            .into_iter()
            .for_each(|it| it.set_state(cx, State::TARGET, it.doc() == doc));
    }
}

pub(crate) fn indicate_text<'a>(
    cx: &mut Cx<'a>,
    doc: &'a Doc,
    target: Option<&'a Node>,
    start: &'a Node,
) {
    Window::of(doc)
        .into_iter()
        .for_each(|it| History::of(&cx.heap, it).indicate(cx, target.and_then(Node::as_element)));
    Ui::of(doc)
        .into_iter()
        .for_each(|it| tabbing::start_at(it, Some(start)));
    start
        .parent()
        .into_iter()
        .for_each(|it| page::reveal(cx, it));
}
