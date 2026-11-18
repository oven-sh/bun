//! A frame whose document is in another process than its element.

use bun_web::host::{self as of_host, Position, ToContainer, ToFrame};

use super::*;
use crate::abi::Rect;
use crate::api::editing::input_method;
use crate::api::observers;
use crate::api::ui::surface;
use crate::scroll::{Alignment, Revealed};

#[thread_local]
static HAS_BEEN_SEEN: Cell<bool> = Cell::new(false);

// ───────────────────────────── where the element is ─────────────────────────────

impl Frame {
    pub(super) fn is_apart(&self) -> bool {
        HAS_BEEN_SEEN.get()
            && self.kind == Kind::Local
            && self.context().is_some_and(Context::is_elsewhere)
    }

    pub(crate) fn lose_document<'a>(&'a self, cx: &mut Cx<'a>) {
        HAS_BEEN_SEEN.set(true);
        self.set(Flags::HAS_FIRED_LOAD, false);
        self.set_inner(None);
        self.told.take();
        if self.is_current() {
            self.fit_apart(cx, DEFAULT_SIZE);
            host::place_again(self.around());
            self.around().doc().invalidate(cx);
            if self.is_focused() {
                host::input(self, bun_web::input::Input::Focus { direction: 0 });
            }
        }
    }

    pub(super) fn looks<'a>(&'a self, cx: &mut Cx<'a>) -> of_host::Looks {
        of_host::Looks {
            color_scheme: self.color_scheme.get(),
            is_inert: self.is_inert(cx),
        }
    }

    fn describe<'a>(&'a self, cx: &mut Cx<'a>) {
        let [width, height] = self
            .size
            .get()
            .map(|it| (it / layout::zoom(self.around().doc())) as f32);
        let shown = observers::shown_part_of_frame(
            cx,
            self.element(),
            Rect::new([0.0, 0.0, width, height]),
        );
        let (looks, position) = (
            self.looks(cx),
            Position {
                origin: self.origin(),
                shown: shown.map(|it| it.to_array().map(f64::from)),
            },
        );
        let before = self.told.replace(Some((looks, position)));
        if before.map(|it| it.0) != Some(looks) {
            host::tell_local(self, ToFrame::Looks(looks));
        }
        if before.map(|it| it.1) != Some(position) {
            host::tell_local(self, ToFrame::Moved(position));
        }
        if self.is(Flags::FULLSCREEN) && !self.element().has_state(State::FULLSCREEN) {
            self.set(Flags::FULLSCREEN, false);
            host::tell_local(self, ToFrame::ExitFullscreen);
        }
    }

    pub(super) fn describe_to_those_apart<'a>(&'a self, cx: &mut Cx<'a>) {
        if self.is_apart() {
            self.describe(cx);
        } else if let Some(inner) = self.inner().filter(|_| HAS_BEEN_SEEN.get()) {
            describe_frames_in(cx, inner);
        }
    }

    pub(super) fn fit_apart<'a>(&'a self, cx: &mut Cx<'a>, size: [f64; 2]) {
        if self.is_current()
            && self.element().is_html(atom!("iframe"))
            && self.natural_size.replace(size) != size
        {
            self.show(cx);
        }
    }

    pub(super) fn reveal_for_apart<'a>(&'a self, cx: &mut Cx<'a>, area: [f64; 4]) {
        if self.is_current() {
            self.reveal(
                cx,
                Revealed {
                    rect: Rect::new(area.map(|it| it as f32)),
                    align: [Alignment::CenterIfNeeded; 2],
                    behavior: 1,
                },
            );
        }
    }

    /// It has taken it already.
    pub(super) fn focus_for_document<'a>(&'a self, cx: &mut Cx<'a>) {
        self.focus(cx);
        if self.is_apart()
            && self
                .around()
                .focused_frame()
                .is_none_or(|it| !core::ptr::eq(it, self))
        {
            host::input(self, bun_web::input::Input::Blur { leaves: false });
        }
    }

    pub(super) fn was_activated(&self) {
        [self.around()]
            .into_iter()
            .chain(above(self.around()))
            .for_each(Ui::activate);
    }
}

fn describe_frames_in<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    ui.frames()
        .iter()
        .filter(|it| it.kind == Kind::Local && it.is_current() && !it.is_closed())
        .for_each(|it| it.describe_to_those_apart(cx));
}

// ───────────────────────────── where the document is ─────────────────────────────

pub(crate) fn is_apart(ui: &Ui) -> bool {
    ui.framing.is_apart.get()
}

pub(crate) fn settle(ui: &Ui, old: Option<&Ui>) {
    ui.framing.is_apart.set(true);
    ui.framing
        .position
        .set(old.and_then(|it| it.framing.position.get()));
}

/// Clips what is in the viewport.
pub(crate) fn clip(doc: &Doc, rect: Rect) -> Option<Rect> {
    let Some(ui) = Ui::of(doc).filter(|it| is_apart(it)) else {
        return Some(rect);
    };
    let shown = Rect::new(ui.framing.position.get()?.shown?.map(|it| it as f32));
    shown.touches(&rect).then(|| rect.intersection(&shown))
}

/// Such a document is not rendered.
pub(crate) fn is_out_of_sight(doc: &Doc) -> bool {
    Ui::of(doc)
        .and_then(|ui| above(ui).last().unwrap_or(ui).framing.position.get())
        .is_some_and(|it| it.shown.is_none())
}

pub(crate) fn moved<'a>(cx: &mut Cx<'a>, ui: &'a Ui, position: Position) {
    ui.framing.position.set(Some(position));
    for it in [ui].into_iter().chain(below(&cx.heap, ui).iter()) {
        observers::frame_moved(cx, it.doc());
        if it.is_focused.get() {
            input_method::forget_what_was_told(it);
            it.doc().invalidate(cx);
        }
    }
    describe_frames_in(cx, ui);
}

pub(crate) fn fit<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let size = layout::laid_out(cx, ui.doc(), |engine, _| engine.size_of_contents());
    tell(ui, ToContainer::Fit(size.map(f64::from)));
}

fn tell(ui: &Ui, message: ToContainer) {
    Window::of(ui.doc())
        .into_iter()
        .for_each(|it| it.host().tell_container(message));
}

#[derive(Clone, Copy)]
pub(crate) enum Container<'a> {
    Beside(&'a Frame),
    /// Of that document.
    Apart(&'a Ui),
}

impl Ui {
    pub(crate) fn any_container(&self) -> Option<Container<'_>> {
        self.container()
            .map(Container::Beside)
            .or_else(|| is_apart(self).then_some(Container::Apart(self)))
    }
}

impl<'a> Container<'a> {
    pub(crate) fn focus(self, cx: &mut Cx<'a>) {
        match self {
            Container::Beside(it) => it.focus(cx),
            Container::Apart(ui) if ui.is_focused.get() => {}
            Container::Apart(ui) => {
                tell(ui, ToContainer::Focus);
                surface::set_focused(
                    cx,
                    ui,
                    Window::of(ui.doc()).is_some_and(|it| it.host().is_tab_focused()),
                );
            }
        }
    }

    pub(crate) fn is_focused(self) -> bool {
        match self {
            Container::Beside(it) => it.is_focused(),
            Container::Apart(ui) => ui.is_focused.get(),
        }
    }

    /// With what the document could not scroll.
    pub(crate) fn scroll_around(self, cx: &mut Cx<'a>, delta: [f64; 2]) {
        match self {
            Container::Beside(it)
                if layout::user_scroll(
                    cx,
                    it.element(),
                    delta,
                    layout::ScrollUnit::Pixel,
                    false,
                ) => {}
            Container::Beside(it) => it
                .around()
                .any_container()
                .into_iter()
                .for_each(|it| it.scroll_around(cx, delta)),
            Container::Apart(ui) => tell(ui, ToContainer::Scroll(delta)),
        }
    }

    pub(crate) fn reveal(self, cx: &mut Cx<'a>, inside: Revealed) {
        match self {
            Container::Beside(it) => it.reveal(cx, inside),
            Container::Apart(ui) => tell(
                ui,
                ToContainer::Reveal(inside.rect.to_array().map(f64::from)),
            ),
        }
    }

    pub(crate) fn tab_out(self, cx: &mut Cx<'a>, is_backward: bool) {
        match self {
            Container::Beside(it) => it.tab_out(cx, is_backward),
            Container::Apart(ui) => tell(ui, ToContainer::Tab { is_backward }),
        }
    }

    pub(crate) fn accessible_tree(self) -> u32 {
        match self {
            Container::Beside(it) => it.accessible_tree(),
            Container::Apart(ui) => Window::of(ui.doc())
                .and_then(Window::context)
                .map_or(0, |it| it.image() | 1 << 31),
        }
    }
}
