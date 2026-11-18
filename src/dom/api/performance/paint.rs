//! What Paint Timing, Element Timing and Largest Contentful Paint report.

use smallvec::SmallVec;

use super::entries::Painted;
use super::*;
use crate::abi::Rect;
use crate::api::frames::Frame;
use crate::api::geometry::DOMRectReadOnly;
use crate::api::images::{Contents, Picture, Pictures, loaded_at, picture_of_svg_image};
use crate::contentful::{Content, Contentful};
use crate::tree::DOCUMENT;

const MIN_BITS_PER_PIXEL: f64 = 0.05;
const TEXT: u32 = 0;

#[derive(Default)]
pub(super) struct Painting {
    has_painted_content: Cell<bool>,
    had_input: Cell<bool>,
    observes_largest: Cell<bool>,
    has_new_images: Cell<bool>,
    largest: Cell<u32>,
    /// Those that have had an `elementtiming` attribute.
    timed: RefCell<Vec<WeakNode>>,
    /// They are reported again if they get a new box.
    reported: RefCell<Vec<WeakNode>>,
}

impl Painting {
    pub(super) fn start_over(&self) {
        [&self.has_painted_content, &self.had_input]
            .into_iter()
            .for_each(|it| it.set(false));
        self.largest.set(0);
    }
}

/// The images, or `TEXT`.
#[derive(Default)]
struct Seen(RefCell<SmallVec<[u32; 2]>>);

fn has_seen_text(node: &Node) -> bool {
    node.try_extra::<Seen>()
        .is_some_and(|it| it.0.borrow().contains(&TEXT))
}

fn see(node: &Node, image: u32) -> bool {
    let mut seen = node.extra::<Seen>().0.borrow_mut();
    let is_new = !seen.contains(&image);
    if is_new {
        seen.push(image);
    }
    is_new
}

fn is_in(node: &Node, doc: &Doc) -> bool {
    node.root() == &**doc
}

fn size_of(picture: &Picture) -> [f64; 2] {
    picture.contents().map_or([0.0; 2], |it| {
        it.size.map(|it| if it.is_nan() { 0.0 } else { it })
    })
}

/// <https://w3c.github.io/largest-contentful-paint/#sec-effective-visual-size>
fn visual_size(doc: &Doc, picture: Option<&Picture>, visible: f64, whole: f64) -> f64 {
    let Some(picture) = picture else {
        return visible;
    };
    let viewport = doc.engine(|engine, _| engine.observed_root(DOCUMENT).rect);
    if visible >= f64::from(viewport.width * viewport.height) {
        return 0.0;
    }
    let size = (visible
        * if picture.pixels() > 0.0 {
            (picture.pixels() / whole).min(1.0)
        } else {
            1.0
        })
    .floor();
    let bits = picture.contents().map_or(0, |it| it.bytes * 8) as f64;
    if bits / size < MIN_BITS_PER_PIXEL {
        0.0
    } else {
        size
    }
}

impl Performance {
    fn painted(
        &self,
        heap: &JsHeap<'_>,
        kind: Type,
        name: &str,
        element: &Element,
        picture: Option<&Picture>,
        time: f64,
        size: [u32; 2],
    ) -> Painted {
        let url = picture.map_or_else(DomString::default, |it| {
            if it.url.to_utf8().starts_with("data:") {
                it.url.substring(0, 100)
            } else {
                it.url.clone()
            }
        });
        let load_time = picture.map_or(0.0, |it| {
            loaded_at(element, it).unwrap_or_else(|| it.loaded_at.get())
        });
        Painted::new(
            heap,
            Entry::new(kind, name, self.page_time(time), 0.0),
            element,
            self.page_time(load_time),
            url,
            size,
        )
    }

    fn report_element<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        element: &'a Element,
        picture: Option<&Picture>,
        rect: Rect,
        time: f64,
    ) {
        let name = if picture.is_some() {
            "image-paint"
        } else {
            "text-paint"
        };
        let size = picture
            .map_or([0.0; 2], size_of)
            .map(|it| it.round() as u32);
        let entry = js_DomPerformanceElementTiming::create(
            heap,
            self.painted(heap, Type::Element, name, element, picture, time, size),
        );
        js_Painted::set_rect(
            entry,
            DOMRectReadOnly::new(heap, rect.to_array().map(f64::from)).to_js(),
        );
        self.painting
            .reported
            .borrow_mut()
            .push(WeakNode::new(heap, element));
        self.add_if_there_is_room(heap, entry);
    }

    fn report_contents<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        doc: &'a Doc,
        mut found: Vec<Contentful>,
        time: f64,
    ) {
        self.painting.reported.borrow_mut().retain(|it| {
            let Some(node) = it.get(heap) else {
                return false;
            };
            let has_box =
                is_in(node, doc) && node.engine(|engine, id| engine.style_bits(id, 1) != 0);
            if !has_box {
                node.extra::<Seen>().0.take();
            }
            has_box
        });
        if self.painting.has_new_images.take() {
            for element in doc
                .objects()
                .skip(1)
                .filter_map(Node::as_element)
                .filter(|it| it.kind() == Kind::SvgImage)
            {
                let image = picture_of_svg_image(element)
                    .as_ref()
                    .and_then(|it| it.contents())
                    .map_or(0, Contents::id);
                let (whole, visible) = element.engine(|engine, id| {
                    let (whole, visible, _) = engine.observe_intersection(id, DOCUMENT, |_| 0.0);
                    (whole, visible.unwrap_or_default())
                });
                if image != 0 && !visible.is_empty() {
                    found.push(Contentful {
                        node: element.id(),
                        content: Content::Replaced,
                        image,
                        visible,
                        area: whole.width * whole.height,
                    });
                }
            }
        }
        let mut largest = None;
        let mut paint = |element: &'a Element,
                         picture: Option<Rc<Picture>>,
                         image: u32,
                         rect: Rect,
                         area: f32| {
            if !see(element, image) {
                return;
            }
            if element.has_attr(atom!("elementtiming")) && is_in(element, doc) {
                self.report_element(heap, element, picture.as_deref(), rect, time);
            }
            let size = visual_size(
                doc,
                picture.as_deref(),
                (rect.width * rect.height).into(),
                area.into(),
            )
            .round() as u32;
            if size > self.painting.largest.get() && !self.painting.had_input.get() {
                self.painting.largest.set(size);
                largest = Some((element, picture, size));
            }
        };
        let mut texts: Vec<(&Element, Rect)> = Vec::new();
        for it in found {
            let Some(element) = doc
                .rendered_node(it.node)
                .and_then(|it| it.out_of_control().as_element())
            else {
                continue;
            };
            match it.content {
                Content::Text if has_seen_text(element) => {}
                Content::Text => {
                    let (x, y) = (it.visible.x.floor(), it.visible.y.floor());
                    let rect = Rect {
                        x,
                        y,
                        width: (it.visible.x + it.visible.width).ceil() - x,
                        height: (it.visible.y + it.visible.height).ceil() - y,
                    };
                    match texts.iter_mut().rev().find(|it| it.0 == element) {
                        Some((_, all)) => *all = all.union(&rect),
                        None => texts.push((element, rect)),
                    }
                }
                Content::Background if matches!(element.kind(), Kind::Html | Kind::Body) => {}
                _ => {
                    if let Some(picture) = Pictures::of(heap, doc).with_id(it.image) {
                        paint(element, Some(picture), it.image, it.visible, it.area);
                    }
                }
            }
        }
        texts
            .into_iter()
            .for_each(|(element, rect)| paint(element, None, TEXT, rect, 0.0));
        if let Some((element, picture, size)) = largest {
            let painted = self.painted(
                heap,
                Type::LargestPaint,
                "",
                element,
                picture.as_deref(),
                time,
                [size, 0],
            );
            self.add_if_there_is_room(heap, js_DomLargestContentfulPaint::create(heap, painted));
        }
    }

    pub(super) fn observe_largest_paint<'a>(&'a self, cx: Cx<'_, 'a>, doc: &'a Doc) {
        self.painting.observes_largest.set(true);
        self.painting.has_new_images.set(true);
        doc.invalidate(cx);
    }
}

fn contentful(node: &Node) -> Vec<Contentful> {
    node.engine(|engine, id| {
        engine.update_layout();
        engine.contentful(id)
    })
}

fn shows_document(doc: &Doc, it: &Contentful) -> bool {
    doc.rendered_node(it.node)
        .and_then(Node::as_element)
        .and_then(Frame::of)
        .is_some()
}

pub(crate) fn report_paint<'a>(heap: &JsHeap<'a>, doc: &'a Doc, has_moved: bool) {
    present_events(heap, doc);
    let Some((realm, performance)) = Performance::of_doc(heap, doc) else {
        return;
    };
    let painting = &performance.painting;
    let watches_largest = painting.observes_largest.get() && !painting.had_input.get();
    let is_watched = watches_largest || !painting.timed.borrow().is_empty();
    let has_new_images = painting.has_new_images.get();
    if painting.has_painted_content.get() && !(is_watched && (has_moved || has_new_images)) {
        return;
    }
    let found = if painting.has_painted_content.get() && !watches_largest {
        let timed = painting.timed.borrow();
        let timed = timed
            .iter()
            .filter_map(|it| it.get(realm))
            .filter(|it| is_in(it, doc) && (has_new_images || !has_seen_text(it)));
        timed.flat_map(contentful).collect()
    } else {
        contentful(doc)
    };
    let time = dom_events::now();
    if !painting.has_painted_content.get() && found.iter().any(|it| !shows_document(doc, it)) {
        painting.has_painted_content.set(true);
        reached(heap, doc, b"first-contentful-paint", time);
    }
    if is_watched {
        performance.report_contents(realm, doc, found, time);
    }
}

pub(crate) fn note_input<'a>(heap: &JsHeap<'a>, doc: &'a Doc) {
    if let Some((_, performance)) = Performance::of_doc(heap, doc) {
        performance.painting.had_input.set(true);
    }
}

pub(crate) fn note_new_images<'a>(heap: &JsHeap<'a>, doc: &'a Doc) {
    if let Some(performance) = Performance::of_realm(doc.realm(heap)) {
        performance.painting.has_new_images.set(true);
    }
}

pub(crate) fn time_element<'a>(heap: &JsHeap<'a>, element: &'a Element) {
    let realm = element.doc().realm(heap);
    let mut timed = Performance::get(realm).painting.timed.borrow_mut();
    timed.retain(|it| it.get(realm).is_some_and(|it| it != &**element));
    timed.push(WeakNode::new(realm, element));
}
