//! A frame whose document is in this engine.

use bun_core::strings;
use bun_web::input::{Extent, Input};

use super::*;
use crate::api::ui::layout::Looks;
use crate::api::ui::{host::queue_task, surface, tabbing};
use crate::api::window::Is;
use crate::scroll::Revealed;

/// Of frames in frames.
const MAX_DEPTH: usize = 64;
const COLOR_SCHEME_BITS: u32 = 3 << 17;

pub(super) fn open<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element) {
    if let Some(frame) = create(cx, ui, element, Kind::Local) {
        frame.navigate_local(cx, true);
    }
}

fn without_fragment(url: &str) -> &[u8] {
    strings::split_once(url.as_bytes(), b"#").map_or(url.as_bytes(), |it| it.0)
}

/// https://html.spec.whatwg.org/#matches-about:blank
fn matches_about_blank(url: &str) -> bool {
    url.strip_prefix("about:blank")
        .is_some_and(|it| matches!(it.as_bytes().first(), None | Some(b'?' | b'#')))
}

fn absolute_length(text: Option<DomString>) -> f64 {
    let text = text.unwrap_or_default().to_utf8().to_ascii_lowercase();
    let units = [
        ("px", 1.0),
        ("in", 96.0),
        ("cm", 96.0 / 2.54),
        ("mm", 96.0 / 25.4),
        ("pt", 96.0 / 72.0),
        ("pc", 16.0),
        ("em", 16.0),
        ("", 1.0),
    ];
    let found = units.into_iter().find_map(|(unit, pixels)| {
        Some(text.trim().strip_suffix(unit)?.parse::<f64>().ok()? * pixels)
    });
    found
        .filter(|it| it.is_finite() && *it >= 0.0)
        .unwrap_or(f64::NAN)
}

/// Unless the frame is gone by then.
fn later<'a>(
    cx: &mut Cx<'a>,
    frame: &'a Frame,
    argument: JSValue,
    run: for<'b> fn(&mut Cx<'b>, [JSValue; 2]),
) {
    queue_task(cx, frame.around().doc(), [frame.to_js(), argument], run);
}

fn current<'a>(frame: JSValue) -> Option<&'a Frame> {
    Frame::from_value(frame).filter(|it| it.is_current())
}

impl Frame {
    /// https://html.spec.whatwg.org/#process-the-iframe-attributes
    pub(super) fn navigate_local<'a>(&'a self, cx: &mut Cx<'a>, is_initial: bool) {
        let (element, srcdoc) = (self.element(), srcdoc_of(self.element()));
        let url = if srcdoc.is_some() {
            "about:srcdoc".into()
        } else {
            source_of(cx, element).unwrap_or_else(|| "about:blank".into())
        };
        self.deferred.take();
        if is_initial && matches_about_blank(&url.to_utf8()) {
            if !url.eq_str("about:blank") {
                host::set_initial_url(self, &url);
            }
            if element.is_html(atom!("iframe")) {
                fire(cx, element, atom!("load"), PLAIN);
            } else {
                later(cx, self, JSValue::UNDEFINED, |cx, [frame, _]| {
                    _ = Frame::from_value(frame)
                        .filter(|it| !it.is(Flags::HAS_NAVIGATED))
                        .map(|it| fire(cx, it.element(), atom!("load"), PLAIN))
                });
            }
        } else if !self.would_recurse(&url.to_utf8()) {
            self.set(Flags::HAS_NAVIGATED, true);
            let referrer_policy = element.attr(atom!("referrerpolicy")).unwrap_or_default();
            self.start_or_defer(
                cx,
                Navigation {
                    url,
                    srcdoc,
                    referrer_policy,
                },
            );
        }
    }

    fn would_recurse(&self, url: &str) -> bool {
        let around = || [self.around()].into_iter().chain(above(self.around()));
        !url.starts_with("about:")
            && (around().count() > MAX_DEPTH
                || around()
                    .any(|it| without_fragment(&it.doc().url().to_utf8()) == without_fragment(url)))
    }

    /// An SVG document has one.
    pub(super) fn replaced_for_plugin(&self) -> Replaced {
        let root = self
            .inner()
            .and_then(|it| it.doc().document_element())
            .filter(|it| it.kind().is_svg());
        let Some(root) = root else {
            return self.replaced();
        };
        let [width, height] =
            [atom!("width"), atom!("height")].map(|it| absolute_length(root.attr(it)));
        let view_box = root
            .attr(atom!("viewBox"))
            .unwrap_or_default()
            .to_utf8()
            .into_owned();
        let mut numbers = strings::tokenize_any(view_box.as_bytes(), b" \t\n\r,")
            .skip(2)
            .map(|it| bun_core::fmt::parse_double(it).unwrap_or(f64::NAN));
        let ratio = Some(width / height).filter(|it| !it.is_nan() && *it != 0.0);
        Replaced::new(
            self.image.get(),
            width,
            height,
            ratio
                .or_else(|| Some(numbers.next()? / numbers.next()?))
                .unwrap_or(f64::NAN),
        )
    }

    pub(super) fn local_attribute_changed<'a>(&'a self, cx: &mut Cx<'a>, change: &AttrChange<'_>) {
        if change.is(atom!("loading")) && !self.element().attr_is(atom!("loading"), "lazy") {
            self.stop_deferring(cx);
        } else if change.is(atom!("marginwidth")) || change.is(atom!("marginheight")) {
            self.inner()
                .and_then(|it| it.doc().body())
                .into_iter()
                .for_each(|it| crate::api::core::html::take_frame_margins(cx, it));
        } else if change.is(atom!("scrolling")) {
            host::environment_changed(self);
        }
    }

    pub(super) fn local_was_placed<'a>(&'a self, cx: &mut Cx<'a>) {
        self.measure(cx);
        self.describe_to_those_apart(cx);
        if let Some(inner) = self
            .inner()
            .filter(|_| self.around().framing.are_observed.get())
        {
            [inner]
                .into_iter()
                .chain(below(&cx.heap, inner).iter())
                .for_each(|it| crate::api::observers::frame_moved(cx, it.doc()));
        }
    }

    fn set_natural_size<'a>(&'a self, cx: &mut Cx<'a>, size: [f64; 2]) {
        self.natural_size.set(size);
        self.show(cx);
    }

    pub(super) fn loading<'a>(&'a self, cx: &mut Cx<'a>) {
        self.delay_load(cx, true);
    }

    pub(super) fn navigating(&self) {
        self.deferred.take();
    }

    /// It stays with the empty document if it was to load another one lazily.
    pub(crate) fn went_to_fragment<'a>(&'a self, cx: &mut Cx<'a>) {
        if self.element().attr_is(atom!("loading"), "lazy") && host::is_initial(self) {
            self.deferred.take();
            self.inner()
                .and_then(|it| it.doc().window())
                .into_iter()
                .for_each(|it| it.host().cancel_navigation());
            self.finished(cx, true);
        }
    }

    pub(crate) fn show_document<'a>(&'a self, ui: &'a Ui) {
        self.set(Flags::HAS_FIRED_LOAD, false);
        self.set_inner(Some(ui));
    }

    pub(crate) fn finished<'a>(&'a self, cx: &mut Cx<'a>, fires: bool) {
        let fires = fires && !self.set(Flags::HAS_FIRED_LOAD, false);
        later(cx, self, fires.into(), |cx, [frame, fires]| {
            let Some(frame) = current(frame) else { return };
            if plugins::is_plugin(frame.element()) {
                if !fires.as_boolean() && host::is_initial(frame) {
                    plugins::fail(cx, frame.element());
                } else {
                    plugins::show(cx, frame.element());
                }
            }
            if fires.as_boolean() {
                fire(cx, frame.element(), atom!("load"), PLAIN);
            }
            frame.delay_load(cx, false);
        });
    }

    pub(super) fn fire_load_later<'a>(&'a self, cx: &mut Cx<'a>) {
        later(cx, self, JSValue::UNDEFINED, |cx, [frame, _]| {
            _ = current(frame).map(|it| fire(cx, it.element(), atom!("load"), PLAIN))
        });
    }

    pub(super) fn use_web_engine<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) {
        let url = url.to_js(&cx.heap).to_js();
        later(cx, self, url, |cx, [frame, url]| {
            let url = DomString::from_js(cx, JsLocal::new(&cx.heap, url)).ok();
            current(frame)
                .into_iter()
                .for_each(|it| remote::open(cx, it.around(), it.element(), url.clone()));
        });
    }

    pub(super) fn show_image<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) {
        if self.is_current() {
            plugins::show_image(cx, self.element(), url);
        }
    }

    /// Its document has to be rendered.
    pub(crate) fn schedule<'a>(&'a self, cx: &mut Cx<'a>) {
        self.outer_window()
            .into_iter()
            .for_each(|it| it.toggle(Is::WITH_DIRTY_FRAMES, true));
        self.around().doc().invalidate(cx);
    }

    /// Tells its document the size of the viewport.
    pub(crate) fn measure<'a>(&'a self, cx: &mut Cx<'a>) {
        let element = self.element();
        if !self.is_current() || !element.is_rendered() || self.set(Flags::MEASURING, true) {
            return;
        }
        let is_fallback =
            || !element.doc().runs_scripts() && element.closest_html(atom!("canvas")).is_some();
        let counts_as_shown =
            !matches!(element.html_tag(), atom!("iframe") | atom!("frame")) || is_fallback();
        let has_yet_to_get_box = !counts_as_shown
            && !self.is(Flags::WAS_DISPLAYED)
            && layout::looks_like(cx, element, Looks::SKIPPED);
        let sizes = if has_yet_to_get_box {
            None
        } else {
            layout::laid_out(cx, element, |engine, id| {
                (counts_as_shown || engine.tree[id].layout_box != 0).then(|| engine.box_sizes(id))
            })
        };
        if let Some(inner) = self
            .inner()
            .map(Ui::doc)
            .filter(|it| it.engine(|engine, _| engine.set_displayed(sizes.is_some())))
        {
            inner.invalidate(cx);
        }
        match sizes.map(|it| it.map(f64::from)) {
            Some([_, _, width, height, ..]) => {
                let zoom = self.outer_window().map_or(1.0, Window::zoom);
                self.set(Flags::WAS_DISPLAYED, true);
                self.size.set([width * zoom, height * zoom]);
                host::place_local(self, self.size.get(), width * height > 0.0);
            }
            None => host::place_local(self, self.size.get(), false),
        }
        self.set(Flags::MEASURING, false);
        let scheme = if element.is_rendered() {
            element.engine(|engine, id| engine.style_bits(id, COLOR_SCHEME_BITS))
                & COLOR_SCHEME_BITS
        } else {
            0
        };
        if self.color_scheme.replace(scheme) != scheme {
            host::environment_changed(self);
        }
    }

    pub(crate) fn give_size_to(&self, window: &Window) {
        if let Some((size, scale, _)) = self.placement.get() {
            window.enter_as_task(|cx, window, ui| {
                surface::handle_input(
                    cx,
                    window,
                    ui,
                    Input::Resize {
                        extent: Extent { size, scale },
                        is_quiet: true,
                    },
                )
            });
        }
    }

    /// The contents are measured in the viewport that they would have if they did not count.
    pub(crate) fn fit<'a>(&'a self, cx: &mut Cx<'a>, follows_contents: bool) {
        if !self.is_current()
            || !self.element().is_rendered()
            || !self.element().is_html(atom!("iframe"))
        {
            return;
        }
        if self.natural_size.get() != DEFAULT_SIZE {
            self.set_natural_size(cx, DEFAULT_SIZE);
        }
        if let Some(inner) = self.inner().filter(|_| follows_contents) {
            let size = layout::laid_out(cx, inner.doc(), |engine, _| engine.size_of_contents());
            self.set_natural_size(cx, size.map(f64::from));
            self.measure(cx);
        }
    }

    pub(crate) fn accessible_tree(&self) -> u32 {
        self.image.get() | 1 << 31
    }

    pub(crate) fn forbids_scrolling(&self) -> bool {
        self.element().attr(atom!("scrolling")).is_some_and(|it| {
            ["no", "off", "noscroll"]
                .iter()
                .any(|value| it.to_utf8().eq_ignore_ascii_case(value))
        })
    }

    pub(crate) fn is_object(&self) -> bool {
        matches!(
            self.element().kind(),
            crate::api::core::Kind::Embed | crate::api::core::Kind::Object
        )
    }

    pub(crate) fn color_scheme<'a>(&'a self, cx: &mut Cx<'a>) -> u32 {
        let element = self.element();
        if element.is_rendered() {
            element.synced_engine(cx, |engine, id| engine.style_bits(id, COLOR_SCHEME_BITS))
        } else {
            0
        }
    }

    pub(crate) fn reveal<'a>(&'a self, cx: &mut Cx<'a>, inside: Revealed) {
        if let Some((inside, next)) =
            layout::reveal_in_frame(cx, self.element(), inside).zip(self.around().any_container())
        {
            next.reveal(cx, inside);
        }
    }

    pub(crate) fn tab_out<'a>(&'a self, cx: &mut Cx<'a>, is_backward: bool) {
        tabbing::move_focus(cx, self.around(), is_backward, false);
    }
}
