//! A frame whose document is in the web engine.

use super::*;
use crate::api::ui::{entry, mouse};

pub(super) fn open<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, url: Option<DomString>) {
    close(cx, element);
    if host::has_web_engine(ui)
        && let Some(frame) = create(cx, ui, element, Kind::Remote)
    {
        frame.navigate_remote(cx, url);
    }
}

/// To the element that the web engine has for it.
pub(super) fn is_copied(name: &str) -> bool {
    name.starts_with("data-")
        || matches!(
            name,
            "allow"
                | "allowfullscreen"
                | "credentialless"
                | "csp"
                | "name"
                | "referrerpolicy"
                | "sandbox"
                | "scrolling"
                | "srcdoc"
                | "title"
        )
}

impl Frame {
    pub(super) fn navigate_remote<'a>(&'a self, cx: &mut Cx<'a>, url: Option<DomString>) {
        let url = url.unwrap_or_else(|| "about:blank".into());
        self.start_or_defer(
            cx,
            Navigation {
                url,
                srcdoc: None,
                referrer_policy: DomString::default(),
            },
        );
    }

    pub(super) fn remote_attribute_changed<'a>(&'a self, cx: &mut Cx<'a>, change: &AttrChange<'_>) {
        let name = change.name.local.to_dom_string();
        if is_copied(&name.to_utf8()) {
            host::copy_attribute(cx, self, &name, change.new);
        }
    }

    pub(super) fn remote_was_placed<'a>(&'a self, cx: &mut Cx<'a>, size: [f64; 2]) {
        let shown = Looks::RENDERED | Looks::VISIBLE;
        let is_visible = looks(cx, self.element(), shown) == shown && self.is_near(0.0);
        host::place_remote(cx, self, size, is_visible);
        if self.is(Flags::FULLSCREEN) && !self.element().has_state(State::FULLSCREEN) {
            self.set(Flags::FULLSCREEN, false);
            host::exit_fullscreen(cx, self);
        }
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.length.get()
    }

    pub(crate) fn loaded<'a>(&'a self, cx: &mut Cx<'a>, length: u32) {
        self.length.set(length);
        fire(cx, self.element(), atom!("load"), PLAIN);
    }

    pub(crate) fn painted<'a>(&'a self, cx: &mut Cx<'a>, image: u32) {
        self.image.set(image);
        self.show(cx);
    }

    pub(crate) fn scroll<'a>(&'a self, cx: &mut Cx<'a>, x: f64, y: f64) {
        mouse::scroll_around(cx, self.around(), self.element(), [x, y]);
    }

    pub(crate) fn focus_element<'a>(&'a self, cx: &mut Cx<'a>) {
        focus::focus(
            cx,
            self.element(),
            focus::Cause::Script,
            focus::Options {
                prevents_scroll: true,
                ..Default::default()
            },
        );
    }

    pub(crate) fn tab<'a>(&'a self, cx: &mut Cx<'a>, direction: f64) {
        if focus::has_focus(self.element()) {
            self.tab_out(cx, direction < 0.0);
        }
    }

    pub(crate) fn tooltip<'a>(&'a self, cx: &mut Cx<'a>, text: Option<DomString>) {
        entry::show_tooltip(cx, self.around(), &text.unwrap_or_default());
    }
}
