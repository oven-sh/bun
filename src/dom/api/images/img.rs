//! https://html.spec.whatwg.org/#the-img-element

use bun_jsc::{DOMExceptionCode, Weak};

use bun_jsc::JSObject;

use super::source_set::{self, Descriptor};
use super::*;
use crate::api::canvas::Source;
use crate::api::core::steps::{AttrChange, Steps};
use crate::api::core::{Observers, Rooted, global_of, insert, string_replace_all};
use crate::api::graphics::Failure;
use crate::api::loading::may_reuse_image;
use crate::api::on_behalf::current_document;
use crate::api::ui::layout::laid_out;
use crate::generated_bindgen::images::HTMLImageElement;
use crate::hints::non_negative_integer;
use crate::tree::Replaced;

#[derive(Clone)]
struct Selected {
    url: DomString,
    density: f64,
}

struct Img {
    current: RefCell<Option<Used>>,
    pending: RefCell<Option<Used>>,
    url: RefCell<DomString>,
    density: Cell<f64>,
    deferred: RefCell<Option<Selected>>,
    decoding_for: RefCell<Option<DomString>>,
    serial: Cell<u32>,
    pub(crate) loaded_at: Cell<f64>,
    auto_width: Cell<Option<f32>>,
    is_queued: Cell<bool>,
    is_broken: Cell<bool>,
    has_alt: Cell<bool>,
    was_turned: Cell<bool>,
    was_in_picture: Cell<bool>,
}

impl Default for Img {
    fn default() -> Img {
        let ((current, pending, url, deferred, decoding_for), (serial, loaded_at, auto_width)) =
            Default::default();
        let [is_queued, is_broken, has_alt, was_turned, was_in_picture] = Default::default();
        let density = Cell::new(1.0);
        Img {
            current,
            pending,
            url,
            density,
            deferred,
            decoding_for,
            serial,
            loaded_at,
            auto_width,
            is_queued,
            is_broken,
            has_alt,
            was_turned,
            was_in_picture,
        }
    }
}

impl Img {
    fn picture(&self) -> Option<Rc<Picture>> {
        self.current.borrow().as_ref().map(Used::picture)
    }

    fn has_picture(&self) -> bool {
        self.current.borrow().is_some()
    }

    fn is_waiting(&self) -> bool {
        self.pending.borrow().is_some() || self.deferred.borrow().is_some()
    }

    fn natural_size(&self) -> [f64; 2] {
        natural_size(
            self.current.borrow().as_ref().and_then(|it| it.contents()),
            self.density.get(),
        )
    }
}

pub(crate) fn loaded_at(image: &Element, picture: &Picture) -> Option<f64> {
    let it = image.try_extra::<Img>().filter(|it| {
        it.current
            .borrow()
            .as_ref()
            .is_some_and(|it| it.is(picture))
    })?;
    Some(it.loaded_at.get()).filter(|it| *it != 0.0)
}

fn state(image: &Element) -> &Img {
    image.extra()
}

/// The images that react to changes of the environment.
#[derive(Default)]
struct Responsive(RefCell<Vec<Weak<()>>>);

fn is_inline(url: &str) -> bool {
    url.len() > 8192
        && [
            "data:image/png;base64,",
            "data:image/jpeg;base64,",
            "data:image/webp;base64,",
        ]
        .iter()
        .any(|it| url.starts_with(it))
}

fn starts_with_auto(sizes: &str) -> bool {
    before(sizes, b',').eq_ignore_ascii_case("auto")
}

#[optimize(size)]
fn allows_auto_sizes(image: &Element) -> bool {
    image.with_attr(atom!("sizes"), starts_with_auto) == Some(true) && is_lazy(image)
}

fn picture_of(image: &Element) -> Option<&Node> {
    image.parent().filter(|it| it.is_html(atom!("picture")))
}

fn is_responsive(image: &Element) -> bool {
    image.has_attr(atom!("srcset")) || picture_of(image).is_some()
}

fn add_once<'a>(heap: &JsHeap<'a>, image: &'a Element, edge: Edge) {
    let list = image.doc().edge_list(heap, edge);
    if !list.contains(image.to_js()) {
        list.push(heap, image.to_js());
    }
}

fn content_width(image: &Element) -> f32 {
    image.engine(|engine, id| engine.box_sizes(id)[2])
}

fn slot_width<'a>(cx: Cx<'_, 'a>, image: &'a Element, sizes: Option<&DomString>) -> f64 {
    let sizes = sizes.map(DomString::to_utf8);
    if sizes.as_deref().is_none_or(starts_with_auto) && allows_auto_sizes(image) {
        add_once(&cx.heap, image, Edge::AutoSizedImages);
        if is_being_rendered(cx, image) {
            state(image).auto_width.set(Some(content_width(image)));
        }
        if let Some(width) = state(image).auto_width.get() {
            return width.into();
        }
    }
    image.doc().synced_engine(cx, |engine, _| {
        engine.source_size(sizes.unwrap_or_default().as_bytes())
    })
}

#[optimize(size)]
fn select_from_set<'a>(
    cx: Cx<'_, 'a>,
    image: &'a Element,
    from: &'a Element,
    [set, sizes]: [Known; 2],
    fallback: Option<DomString>,
) -> Option<Selected> {
    let (set, fallback) = (
        from.attr(set).unwrap_or_default(),
        fallback.filter(|it| !it.is_empty()),
    );
    let (set, fallback) = (set.to_utf8(), fallback.as_ref().map(DomString::to_utf8));
    let has_widths =
        source_set::parse(&set).any(|it| matches!(it.descriptor, Descriptor::Width(_)));
    let slot = if has_widths {
        slot_width(cx, image, from.attr(sizes).as_ref())
    } else {
        0.0
    };
    let candidates = source_set::parse(&set).map(|it| match it.descriptor {
        Descriptor::Density(density) => (it.url, density),
        Descriptor::Width(width) => (it.url, width / slot),
    });
    let candidates = candidates
        .chain(
            fallback
                .as_deref()
                .filter(|_| !has_widths)
                .map(|it| (it, 1.0)),
        )
        .collect();
    let (scale, pictures) = (scale(cx, image.doc()), Pictures::of(&cx.heap, image.doc()));
    let (url, density) = source_set::select(candidates, scale, |url| {
        !url.starts_with("data:")
            && resolve(cx, image.doc(), &DomString::from_utf8(url))
                .and_then(|it| pictures.available(&it, image))
                .is_some()
    })?;
    Some(Selected {
        url: DomString::from_utf8(url),
        density,
    })
}

pub(crate) fn is_supported(mime_type: &str) -> bool {
    const SUPPORTED: [&str; 9] = [
        "png",
        "apng",
        "jpeg",
        "gif",
        "webp",
        "svg+xml",
        "bmp",
        "x-icon",
        "vnd.microsoft.icon",
    ];
    let essence = before(mime_type, b';').trim_ascii().to_ascii_lowercase();
    essence.is_empty()
        || essence
            .strip_prefix("image/")
            .is_some_and(|it| SUPPORTED.contains(&it))
}

/// Whether a `source` can be used, and in which environment.
#[derive(Default)]
struct Usable(Cell<Option<(bool, Option<u32>)>>);

#[optimize(size)]
fn usable_source(image: &Element) -> Option<&Element> {
    let (before, document) = (
        picture_of(image)?
            .children()
            .take_while(|it| it.to_js() != image.to_js()),
        image.doc(),
    );
    let environment = document
        .has_page()
        .then(|| document.engine(|engine, _| engine.environment_changes));
    before
        .filter(|it| it.is_html(atom!("source")))
        .filter_map(Node::as_element)
        .find(|source| {
            let known = &source.extra::<Usable>().0;
            if known.get().is_none_or(|it| it.1 != environment) {
                let is_usable = matches_media(source)
                    && source.with_attr(atom!("type"), is_supported) != Some(false)
                    && source
                        .with_attr(atom!("srcset"), |it| source_set::parse(it).next().is_some())
                        == Some(true);
                known.set(Some((is_usable, environment)));
            }
            known.get().is_some_and(|it| it.0)
        })
}

/// https://html.spec.whatwg.org/#select-an-image-source
#[optimize(size)]
fn select<'a>(cx: Cx<'_, 'a>, image: &'a Element) -> Option<Selected> {
    const ATTRIBUTES: [Known; 2] = [atom!("srcset"), atom!("sizes")];
    if let Some(source) = usable_source(image) {
        return select_from_set(cx, image, source, ATTRIBUTES, None);
    }
    let src = image.attr(atom!("src"));
    if image.has_attr(atom!("srcset")) {
        return select_from_set(cx, image, image, ATTRIBUTES, src);
    }
    src.filter(|it| !it.is_empty())
        .map(|url| Selected { url, density: 1.0 })
}

fn select_resolved<'a>(cx: Cx<'_, 'a>, image: &'a Element) -> Option<Selected> {
    let Selected { url, density } = select(cx, image)?;
    Some(Selected {
        url: resolve(cx, image.doc(), &url)?,
        density,
    })
}

pub(crate) fn selected_url<'a>(cx: Cx<'_, 'a>, image: &'a Element) -> Option<DomString> {
    select(cx, image).map(|it| it.url)
}

/// Of `<link rel=preload as=image>`.
#[optimize(size)]
pub(crate) fn preload_url<'a>(cx: Cx<'_, 'a>, link: &'a Element) -> Option<DomString> {
    select_from_set(
        cx,
        link,
        link,
        [atom!("imagesrcset"), atom!("imagesizes")],
        link.attr(atom!("href")),
    )
    .map(|it| it.url)
}

fn show<'a>(cx: Cx<'_, 'a>, image: &'a Element) {
    if !image.is_rendered() {
        return;
    }
    let (it, picture) = (state(image), state(image).picture());
    let is_missing = picture.is_none() && !it.is_queued.get() && !it.is_waiting();
    let alt = is_missing.then(|| {
        image
            .attr(atom!("alt"))
            .or_else(|| image.attr(atom!("title")))
            .unwrap_or_default()
    });
    let alt = alt.filter(|alt| {
        !alt.is_empty() || image.has_attr(atom!("src")) || !it.url.borrow().is_empty()
    });
    if it.has_alt.replace(alt.is_some()) || alt.is_some() {
        let root = image
            .shadow_root()
            .unwrap_or_else(|| image.attach_ua_shadow(cx));
        string_replace_all(cx, DomString::default(), root);
        if let Some(alt) = &alt {
            let parent = add_alt_text(cx, image, root);
            insert(
                cx,
                image.doc().create_text(&cx.heap, alt.clone()),
                parent,
                None,
                Observers::Suppress,
            );
        }
    }
    let turned = picture
        .as_ref()
        .filter(|it| it.contents().is_some_and(|it| it.orientation > 1));
    if it.was_turned.replace(turned.is_some()) || turned.is_some() {
        let modifier = match Cors::of(Some(image)) {
            Cors::None => "",
            Cors::Anonymous => "\0cross-origin(anonymous)",
            Cors::UseCredentials => "\0cross-origin(use-credentials)",
        };
        image.set_presentation_attr(
            "turned source",
            turned.map(|it| it.url.to_utf8() + modifier).as_deref(),
        );
    }
    let shown = picture.as_ref().and_then(|it| it.contents()).map_or_else(
        || Replaced::new(0, 0.0, 0.0, f64::NAN),
        |contents| contents.replaced(it.density.get()),
    );
    show_replaced(cx, image, alt.is_none().then_some(shown));
}

fn end_decoding<'a>(cx: Cx<'_, 'a>, image: &'a Element, is_decoded: bool) {
    let Some(promises) = image.try_edge_list(Edge::Decoding) else {
        return;
    };
    image.clear_edge(&cx.heap, Edge::Decoding);
    image
        .doc()
        .try_edge_list(Edge::Decoding)
        .into_iter()
        .for_each(|it| _ = it.remove(&cx.heap, image.to_js()));
    promises
        .values()
        .for_each(|it| settle_decoding(cx, it, is_decoded));
}

#[optimize(size)]
pub(super) fn abandon_decoding<'a>(cx: Cx<'_, 'a>, document: &'a Doc) {
    let Some(images) = document.try_edge_list(Edge::Decoding) else {
        return;
    };
    document.clear_edge(&cx.heap, Edge::Decoding);
    for image in images.values() {
        element_in(&cx.heap, image)
            .filter(|it| core::ptr::eq(it.doc(), document))
            .into_iter()
            .for_each(|it| end_decoding(cx, it, false));
    }
}

pub(super) fn settle_decoding(cx: Cx<'_, '_>, promise: JSValue, is_decoded: bool) {
    let Some(promise) = JsLocal::new(&cx.heap, promise).as_promise() else {
        return;
    };
    let _termination = if is_decoded {
        promise.resolve(cx, JSValue::UNDEFINED)
    } else {
        let error = cx.heap.create_dom_exception(
            DOMExceptionCode::EncodingError,
            format_args!("The source image cannot be decoded."),
        );
        promise.reject(cx, error.to_js())
    };
}

#[optimize(size)]
fn settle<'a>(
    cx: Cx<'_, 'a>,
    image: &'a Element,
    picture: Option<Used>,
    Selected { url, density }: Selected,
) {
    let it = state(image);
    drop(
        it.current
            .replace(picture.filter(|it| it.contents().is_some())),
    );
    it.url.replace(url);
    it.density.set(density);
    it.is_broken.set(!it.has_picture());
    it.loaded_at.set(now());
    crate::api::performance::note_new_images(&cx.heap, image.doc());
    show(cx, image);
}

/// The document whose `load` event waits for the image.
fn take_delayed<'a>(heap: &JsHeap<'a>, image: &'a Element) -> Option<&'a Doc> {
    let document = image.edge_node(Edge::DelayedDocument)?;
    image.clear_edge(heap, Edge::DelayedDocument);
    document.as_doc()
}

fn stop_delaying<'a>(cx: Cx<'_, 'a>, document: Option<&'a Doc>) {
    document.into_iter().for_each(|it| allow_load(cx, it));
}

#[optimize(size)]
fn drop_request<'a>(cx: Cx<'_, 'a>, image: &'a Element) {
    drop(state(image).pending.take());
    state(image).deferred.take();
    let delayed = take_delayed(&cx.heap, image);
    stop_delaying(cx, delayed);
}

#[optimize(size)]
fn fire_unless_changed<'a>(cx: Cx<'_, 'a>, image: &'a Element, event: Known) {
    let (document, serial) = (image.doc(), state(image).serial.get());
    delay_load(cx, document);
    queue_task(
        document,
        &[image.to_js(), document.to_js()],
        move |cx, values| {
            if let Some(image) =
                element_in(&cx.heap, values[0]).filter(|it| state(it).serial.get() == serial)
            {
                fire(cx, image, event, Default::default());
            }
            let document = Node::from_js(&cx.heap, values[1]).and_then(Node::as_doc);
            stop_delaying(cx, document);
            Ok(())
        },
    );
}

#[derive(Clone, Copy, PartialEq)]
enum OnError {
    Break,
    KeepWhatIsShown,
}

#[optimize(size)]
fn fetch_image<'a>(
    cx: Cx<'_, 'a>,
    image: &'a Element,
    selected: Selected,
    delays_load: bool,
    on_error: OnError,
) {
    let used = Pictures::request(cx, image.doc(), selected.url.clone(), Some(image));
    if used.is_settled()
        && on_error == OnError::Break
        && selected.url.to_utf8().starts_with("data:")
    {
        let is_available = used.contents().is_some();
        settle(cx, image, Some(used), selected);
        end_decoding(cx, image, is_available);
        return fire_unless_changed(
            cx,
            image,
            if is_available {
                atom!("load")
            } else {
                atom!("error")
            },
        );
    }
    let (picture, wanted) = (used.picture(), used.picture());
    drop(state(image).pending.replace(Some(used)));
    if delays_load {
        delay_load(cx, image.doc());
        image.set_edge(&cx.heap, Edge::DelayedDocument, image.doc().to_js());
    }
    picture.when_settled(cx, image.to_js(), move |cx, image| {
        let Some(document) = element_in(&cx.heap, image).map(|it| it.doc()) else {
            return;
        };
        queue_task(document, &[image], move |cx, image| {
            let Some(image) = element_in(&cx.heap, image[0]) else {
                return Ok(());
            };
            let Some(used) = state(image)
                .pending
                .borrow_mut()
                .take_if(|it| it.is(&wanted))
            else {
                return Ok(());
            };
            let (delayed, is_available) =
                (take_delayed(&cx.heap, image), wanted.contents().is_some());
            if is_available || on_error == OnError::Break {
                settle(cx, image, Some(used), selected);
                end_decoding(cx, image, is_available);
                if image.doc().is_fully_active() {
                    fire(
                        cx,
                        image,
                        if is_available {
                            atom!("load")
                        } else {
                            atom!("error")
                        },
                        Default::default(),
                    );
                }
            }
            stop_delaying(cx, delayed);
            Ok(())
        });
    });
}

fn watch<'a>(heap: &JsHeap<'a>, image: &'a Element) {
    if is_responsive(image) && image.edge(Edge::WatchedBy) != Some(image.doc().to_js()) {
        image.set_edge(heap, Edge::WatchedBy, image.doc().to_js());
        let weak = Weak::create_passive(image.to_js(), global_of(heap));
        image.doc().extra::<Responsive>().0.borrow_mut().push(weak);
    }
}

/// https://html.spec.whatwg.org/#update-the-image-data
#[optimize(size)]
fn update<'a>(cx: Cx<'_, 'a>, image: &'a Element) {
    let (it, document) = (state(image), image.doc());
    if !it.is_queued.replace(false) {
        return;
    }
    if !document.has_page() {
        return end_decoding(cx, image, false);
    }
    watch(&cx.heap, image);
    if it.was_in_picture.get() {
        show_source_size(cx, image);
    }
    let selected = select(cx, image);
    let url = selected
        .as_ref()
        .and_then(|it| resolve(cx, document, &it.url));
    let delayed = take_delayed(&cx.heap, image);
    drop_request(cx, image);
    match (url, selected) {
        (Some(url), Some(Selected { density, .. })) => {
            if !it.has_picture() {
                it.url.replace(url.clone());
            }
            if is_lazy(image) {
                it.deferred.replace(Some(Selected { url, density }));
                add_once(&cx.heap, image, Edge::LazyImages);
                document.invalidate(cx);
            } else {
                fetch_image(cx, image, Selected { url, density }, true, OnError::Break);
            }
        }
        (_, selected) => {
            let is_error = selected.is_some() || image.has_attr(atom!("src"));
            settle(
                cx,
                image,
                None,
                Selected {
                    url: selected.map(|it| it.url).unwrap_or_default(),
                    density: 1.0,
                },
            );
            end_decoding(cx, image, false);
            if is_error {
                fire_later(cx, image, atom!("error"));
            }
        }
    }
    stop_delaying(cx, delayed);
}

/// A large image in a `data:` URL is available at once, so that it is decoded while the page gets ready to show it.
#[optimize(size)]
fn open_inline<'a>(cx: Cx<'_, 'a>, image: &'a Element) -> Option<Selected> {
    let is_set = |set: &str| {
        is_inline(set)
            && source_set::parse(set).all(|it| matches!(it.descriptor, Descriptor::Density(_)))
    };
    let may_be = image
        .with_attr(atom!("srcset"), is_set)
        .or_else(|| image.with_attr(atom!("src"), is_inline));
    (may_be? && picture_of(image).is_none()).then_some(())?;
    let selected = select(cx, image).filter(|it| it.url.ascii().is_some_and(is_inline))?;
    let (document, pictures) = (image.doc(), Pictures::of(&cx.heap, image.doc()));
    let is_known = pictures.has(&selected.url, image)
        || document.allows_inline_images(&cx.heap)
            && pictures.open_inline(
                &selected.url,
                image,
                selected.density,
                scale(cx, document),
                now(),
            );
    is_known.then_some(selected)
}

#[optimize(size)]
fn queue_update<'a>(cx: Cx<'_, 'a>, image: &'a Element) {
    let (it, document) = (state(image), image.doc());
    if !document.has_page() {
        end_decoding(cx, image, false);
        return drop_request(cx, image);
    }
    let selected = open_inline(cx, image).or_else(|| {
        let src = image
            .attr(atom!("src"))
            .filter(|it| !it.is_empty() && !is_responsive(image))?;
        Some(Selected {
            url: resolve(cx, document, &src)?,
            density: 1.0,
        })
    });
    let available = selected
        .and_then(|it| {
            Some((
                Pictures::of(&cx.heap, document).available(&it.url, image)?,
                it,
            ))
        })
        .filter(|it| may_reuse_image(&cx.heap, document, &it.1.url));
    it.serial.update(|it| it.wrapping_add(1));
    if let Some((picture, selected)) = available {
        watch(&cx.heap, image);
        it.is_queued.set(false);
        if !it.picture().is_some_and(|it| picture.is(&it)) {
            end_decoding(cx, image, false);
        }
        drop_request(cx, image);
        settle(cx, image, Some(picture), selected);
        return fire_unless_changed(cx, image, atom!("load"));
    }
    if !it.has_picture() || image.attr(atom!("src")) != *it.decoding_for.borrow() {
        end_decoding(cx, image, false);
    }
    if !it.is_queued.replace(true) {
        later(&cx.heap, image, update);
    }
    if !it.has_picture() {
        show(cx, image);
    }
}

fn resume<'a>(cx: Cx<'_, 'a>, image: &'a Element) {
    let reselected = if allows_auto_sizes(image) {
        select_resolved(cx, image)
    } else {
        None
    };
    if let Some(deferred) = state(image).deferred.take() {
        fetch_image(
            cx,
            image,
            reselected.unwrap_or(deferred),
            false,
            OnError::Break,
        );
    }
}

/// https://html.spec.whatwg.org/#reacting-to-environment-changes
#[optimize(size)]
fn reselect<'a>(cx: Cx<'_, 'a>, image: &'a Element) {
    let it = state(image);
    if !image.doc().has_page()
        || it.is_queued.get()
        || it.deferred.borrow().is_some()
        || !is_responsive(image)
    {
        return;
    }
    let Some(selected) = select_resolved(cx, image) else {
        return;
    };
    let is_current = selected.url == *it.url.borrow();
    if it.pending.borrow().as_ref().map_or_else(
        || is_current && it.density.get() == selected.density,
        |it| it.url == selected.url,
    ) {
        return;
    }
    let delays_load = image.edge(Edge::DelayedDocument).is_some();
    drop_request(cx, image);
    if is_current && it.has_picture() {
        it.density.set(selected.density);
        return show(cx, image);
    }
    if !it.has_picture() {
        it.url.replace(selected.url.clone());
    }
    let on_error = if it.has_picture() || it.is_broken.get() {
        OnError::KeepWhatIsShown
    } else {
        OnError::Break
    };
    fetch_image(cx, image, selected, delays_load, on_error);
}

#[optimize(size)]
pub(crate) fn reselect_images<'a>(cx: Cx<'_, 'a>, document: &'a Doc) {
    let (Some(Responsive(all)), mut images) = (document.try_extra(), Rooted::default()) else {
        return;
    };
    let mut watched = all.take();
    watched.retain(|it| {
        let image = it
            .get()
            .and_then(|it| Node::from_js(&cx.heap, it))
            .filter(|it| it.edge(Edge::WatchedBy) == Some(document.to_js()));
        image.inspect(|it| images.push(&cx.heap, it)).is_some()
    });
    all.replace(watched);
    images
        .iter()
        .filter(|it| core::ptr::eq(it.doc(), document))
        .filter_map(Node::as_element)
        .for_each(|it| reselect(cx, it));
}

/// What `visit` answers false for leaves the list.
fn retain<'a>(
    cx: Cx<'_, 'a>,
    document: &'a Doc,
    edge: Edge,
    mut visit: impl FnMut(Cx<'_, 'a>, &'a Element) -> bool,
) {
    let Some(list) = document.try_edge_list(edge).filter(|it| !it.is_empty()) else {
        return;
    };
    for image in Rooted::from_nodes(&cx.heap, list.nodes())
        .iter()
        .filter_map(Node::as_element)
    {
        if !(image.is_connected() && core::ptr::eq(image.doc(), document) && visit(cx, image)) {
            list.remove(&cx.heap, image.to_js());
        }
    }
}

#[optimize(size)]
pub(crate) fn reselect_auto_sized_images<'a>(cx: Cx<'_, 'a>, document: &'a Doc) {
    retain(cx, document, Edge::AutoSizedImages, |cx, image| {
        let stays = allows_auto_sizes(image);
        if stays && Some(content_width(image)) != state(image).auto_width.get() {
            reselect(cx, image);
        }
        stays
    });
}

pub(crate) fn load_when_near<'a>(heap: &JsHeap<'a>, element: &'a Element) {
    if element.is_rendered() {
        add_once(heap, element, Edge::LazyImages);
    }
}

/// If not, the document that it is too far from the viewport of asks again.
fn is_frame_near<'a>(cx: Cx<'_, 'a>, document: &'a Doc) -> bool {
    let mut inner = document;
    while let Some(frame) = crate::api::frames::container(inner) {
        inner = frame.doc();
        if !frame.synced_engine(cx, is_near) {
            let waiting = inner.edge_list(&cx.heap, Edge::LazyFrames);
            if !waiting.contains(document.to_js()) {
                waiting.push(&cx.heap, document.to_js());
            }
            return false;
        }
    }
    true
}

fn is_near(engine: &mut crate::document::Document, id: crate::tree::NodeId) -> bool {
    const MARGINS: [f64; 16] = [
        1250.0, 0.0, 1250.0, 0.0, 1250.0, 0.0, 1250.0, 0.0, 600.0, 0.0, 600.0, 0.0, 600.0, 0.0,
        600.0, 0.0,
    ];
    engine.update_layout();
    engine
        .observe_intersection(id, crate::tree::DOCUMENT, |at| MARGINS[at])
        .1
        .is_some()
}

#[optimize(size)]
pub(crate) fn load_lazy_images<'a>(cx: Cx<'_, 'a>, document: &'a Doc) {
    if let Some(waiting) = document.try_edge_list(Edge::LazyFrames) {
        let waiting = Rooted::from_nodes(&cx.heap, waiting.nodes());
        document.clear_edge(&cx.heap, Edge::LazyFrames);
        waiting
            .iter()
            .map(Node::doc)
            .filter(|it| it.has_page())
            .for_each(|it| load_lazy_images(cx, it));
    }
    retain(cx, document, Edge::LazyImages, |cx, image| {
        let is_image = image.is_html(atom!("img"));
        let waits = (!is_image || state(image).deferred.borrow().is_some())
            && !(image.synced_engine(cx, is_near) && is_frame_near(cx, document));
        match (waits, is_image) {
            (true, _) => {}
            (false, true) => resume(cx, image),
            (false, false) => crate::api::media::resume_lazy_media(cx, image),
        }
        waits
    });
}

/// https://html.spec.whatwg.org/#concept-img-dimension-attribute-source
#[optimize(size)]
fn show_source_size<'a>(cx: Cx<'_, 'a>, image: &'a Element) {
    state(image).was_in_picture.set(true);
    if image.is_rendered() {
        let source = usable_source(image);
        for (name, attribute) in [
            ("width source", atom!("width")),
            ("height source", atom!("height")),
        ] {
            image.set_presentation_attr(
                name,
                source
                    .and_then(|it| it.attr(attribute))
                    .as_ref()
                    .map(DomString::to_utf8)
                    .as_deref(),
            );
        }
        image.doc().invalidate(cx);
    }
}

impl HTMLImageElement {
    fn dimension<'a>(&'a self, cx: Cx<'_, 'a>, attribute: Known, axis: usize) -> u32 {
        if !is_being_rendered(cx, self) {
            return self
                .with_attr(attribute, non_negative_integer)
                .flatten()
                .unwrap_or_else(|| state(self).natural_size()[axis] as u32);
        }
        laid_out(cx, self, |engine, id| engine.box_sizes(id)[2 + axis]).round() as u32
    }

    fn set_dimension<'a>(&'a self, cx: Cx<'_, 'a>, attribute: Known, value: u32) {
        self.set_attr(
            cx,
            attribute,
            DomString::from_utf8(&i32::try_from(value).unwrap_or(0).to_string()),
        );
    }

    pub(crate) fn get_width<'a>(&'a self, cx: Cx<'_, 'a>) -> u32 {
        self.dimension(cx, atom!("width"), 0)
    }

    pub(crate) fn set_width<'a>(&'a self, cx: Cx<'_, 'a>, value: u32) {
        self.set_dimension(cx, atom!("width"), value);
    }

    pub(crate) fn get_height<'a>(&'a self, cx: Cx<'_, 'a>) -> u32 {
        self.dimension(cx, atom!("height"), 1)
    }

    pub(crate) fn set_height<'a>(&'a self, cx: Cx<'_, 'a>, value: u32) {
        self.set_dimension(cx, atom!("height"), value);
    }

    pub(crate) fn get_natural_width(&self) -> u32 {
        state(self).natural_size()[0] as u32
    }

    pub(crate) fn get_natural_height(&self) -> u32 {
        state(self).natural_size()[1] as u32
    }

    pub(crate) fn get_complete(&self) -> bool {
        let it = state(self);
        let has_source = self.has_attr(atom!("srcset"))
            || self.with_attr_string(atom!("src"), DomString::is_empty) == Some(false);
        !has_source
            || !it.is_queued.get() && !it.is_waiting() && (it.has_picture() || it.is_broken.get())
    }

    pub(crate) fn get_current_src<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a, bun_jsc::JSString> {
        state(self).url.borrow().to_js(heap)
    }

    fn position<'a>(&'a self, cx: Cx<'_, 'a>) -> [f32; 2] {
        laid_out(cx, self, |engine, id| engine.position_in_document(id))
    }

    pub(crate) fn get_x<'a>(&'a self, cx: Cx<'_, 'a>) -> i32 {
        self.position(cx)[0] as i32
    }

    pub(crate) fn get_y<'a>(&'a self, cx: Cx<'_, 'a>) -> i32 {
        self.position(cx)[1] as i32
    }

    pub(crate) fn new_image<'a>(
        cx: Cx<'_, 'a>,
        _: JsLocal<'a, JSObject>,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<'a, JSValue> {
        let image = current_document(cx)?.create_html(&cx.heap, atom!("img"));
        for (attribute, value) in [(atom!("width"), width), (atom!("height"), height)] {
            value.into_iter().for_each(|it| {
                image.set_attr(cx, attribute, DomString::from_utf8(&it.to_string()))
            });
        }
        Ok(image.to_js())
    }

    pub(crate) fn decode<'a>(&'a self, cx: Cx<'_, 'a>) -> JSValue {
        let promise = cx.heap.create_promise().to_js();
        if !self.doc().is_fully_active() {
            settle_decoding(cx, promise, false);
            return promise;
        }
        let heap = &cx.heap;
        if self.edge(Edge::Decoding).is_none() {
            self.doc()
                .edge_list(heap, Edge::Decoding)
                .push(heap, self.to_js());
        }
        self.edge_list(heap, Edge::Decoding).push(heap, promise);
        state(self).decoding_for.replace(self.attr(atom!("src")));
        later(heap, self, |cx, image| {
            let is_active = image.doc().is_fully_active();
            if !is_active || !state(image).is_waiting() {
                end_decoding(cx, image, is_active && state(image).has_picture());
            }
        });
        promise
    }

    /// https://html.spec.whatwg.org/#check-the-usability-of-the-image-argument
    pub(crate) fn source<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
    ) -> core::result::Result<Option<Source>, Failure> {
        let (it, mut picture) = (state(self), state(self).picture());
        if it.is_queued.get() {
            let src = self
                .attr(atom!("src"))
                .and_then(|it| resolve(cx, self.doc(), &it));
            picture.take_if(|it| Some(&it.url) != src.as_ref());
        } else if it.is_broken.get() && !it.url.borrow().is_empty() && it.pending.borrow().is_none()
        {
            return Err(Failure::invalid_state(
                "The image is in the 'broken' state.",
            ));
        }
        let size = it.natural_size().map(|length| length * it.density.get());
        Ok(picture
            .as_ref()
            .and_then(|it| it.contents())
            .map(|it| it.source(self.doc(), size)))
    }

    /// In pixels, if it has none itself.
    pub(crate) fn size_of_texture(&self) -> Option<[f64; 2]> {
        let [width, height] = state(self)
            .picture()?
            .contents()
            .filter(|it| it.is_vector())?
            .size;
        Some(
            [(atom!("width"), width), (atom!("height"), height)].map(|(name, own)| {
                self.with_attr(name, non_negative_integer)
                    .flatten()
                    .map_or(own, f64::from)
            }),
        )
    }
}

#[optimize(size)]
fn attribute_changed<'a>(cx: Cx<'_, 'a>, image: &'a Element, change: &AttrChange<'_>) {
    match change.name.known_without_namespace() {
        atom!("src") | atom!("srcset") | atom!("sizes") => queue_update(cx, image),
        atom!("crossorigin") if Cors::parse(change.old) != Cors::parse(change.new) => {
            queue_update(cx, image)
        }
        atom!("referrerpolicy") if referrer_policy(change.old) != referrer_policy(change.new) => {
            queue_update(cx, image)
        }
        atom!("loading") if state(image).deferred.borrow().is_some() && !is_lazy(image) => {
            resume(cx, image)
        }
        atom!("loading") => later(&cx.heap, image, reselect),
        atom!("width") if allows_auto_sizes(image) => queue_update(cx, image),
        atom!("alt") | atom!("title") => show(cx, image),
        _ => {}
    }
}

pub(crate) static IMG_STEPS: Steps = Steps {
    rendered: Some(|cx, image| {
        show(cx, image);
        if state(image).was_in_picture.get() {
            show_source_size(cx, image);
        }
    }),
    attribute_changed: Some(attribute_changed),
    post_connection: Some(|cx, image, _| {
        if state(image).deferred.borrow().is_some() && image.doc().has_page() {
            add_once(&cx.heap, image, Edge::LazyImages);
        }
        if state(image).loaded_at.get() != 0.0 {
            state(image).loaded_at.set(now());
        }
    }),
    parent_changed: Some(|cx, image, old| {
        if old
            .or_else(|| image.parent())
            .is_some_and(|it| it.is_html(atom!("picture")))
        {
            show_source_size(cx, image);
            queue_update(cx, image);
        }
    }),
    adopted: Some(|cx, image, _| queue_update(cx, image)),
    ..Steps::NONE
};

#[optimize(size)]
fn source_changed<'a>(
    cx: Cx<'_, 'a>,
    parent: Option<&'a Node>,
    from: Option<&'a Node>,
    is_only_size: bool,
) {
    let Some(from) = from.filter(|_| parent.is_some_and(|it| it.is_html(atom!("picture")))) else {
        return;
    };
    let images = Rooted::from_nodes(
        &cx.heap,
        [from]
            .into_iter()
            .chain(from.next_siblings())
            .filter(|it| it.is_html(atom!("img"))),
    );
    for image in images.iter().filter_map(Node::as_element) {
        show_source_size(cx, image);
        if !is_only_size {
            queue_update(cx, image);
        }
    }
}

pub(crate) static SOURCE_STEPS: Steps = Steps {
    attribute_changed: Some(
        |cx, source, change| match change.name.known_without_namespace() {
            atom!("width") | atom!("height") => {
                source_changed(cx, source.parent(), Some(source), true)
            }
            atom!("srcset") | atom!("sizes") | atom!("media") | atom!("type") => {
                source.extra::<Usable>().0.set(None);
                source_changed(cx, source.parent(), Some(source), false);
            }
            _ => {}
        },
    ),
    parent_changed: Some(|cx, source, old| {
        source_changed(
            cx,
            old.or_else(|| source.parent()),
            old.map_or(Some(source), Node::first_child),
            false,
        );
        source
            .parent()
            .into_iter()
            .for_each(|it| crate::api::media::source_inserted(cx, it));
    }),
    adopted: Some(|_, source, _| source.extra::<Usable>().0.set(None)),
    ..Steps::NONE
};
