//! https://html.spec.whatwg.org/#the-list-of-available-images

use core::sync::atomic::{AtomicU32, Ordering};
use std::collections::VecDeque;

use bun_jsc::job::{Completion, Job, JobContext, JsAffine, JsThread};
use bun_jsc::{JsResult, Strong, Weak};

use bun_web::HashMap;
use bun_web::net::schemes::process_data_url;
use bun_web::url::Url;

use super::host::{self, Destination, Resource};
use super::*;
use crate::abi_graphics::Decoded;
use crate::api::canvas::{Owned, Source, decode, drop_font_scope, open};
use crate::api::core::global_of;
use crate::api::loading::may_reuse_image;
use crate::api::on_behalf::in_realm_of;
use crate::document::Request;
use crate::embedded;
use crate::tree::Replaced;

const UNUSED_PIXELS: f64 = (4 << 20) as f64;
const PIXELS_TO_TURN_AT_ONCE: u32 = 1 << 20;
const UNORIENTED: &str = "unoriented:";

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Cors {
    None,
    Anonymous,
    UseCredentials,
}

impl Cors {
    #[optimize(size)]
    pub(crate) fn parse(attribute: Option<&DomString>) -> Cors {
        attribute.map_or(Cors::None, |it| {
            if it.eq_ignore_ascii_case("use-credentials") {
                Cors::UseCredentials
            } else {
                Cors::Anonymous
            }
        })
    }

    pub(crate) fn of(element: Option<&Element>) -> Cors {
        Cors::parse(
            element
                .and_then(|it| it.attr(atom!("crossorigin")))
                .as_ref(),
        )
    }
}

enum Pixels {
    Raster(Owned, [u32; 2]),
    Vector {
        id: u32,
        recorded: OnceCell<Owned>,
        font_scope: Cell<u32>,
        parts: RefCell<Vec<Used>>,
    },
}

impl Drop for Pixels {
    fn drop(&mut self) {
        if let Pixels::Vector { id, font_scope, .. } = self {
            embedded::release_vector(*id);
            drop_font_scope(font_scope.get());
        }
    }
}

pub(crate) struct Contents {
    pixels: Pixels,
    /// NaN for what it does not have.
    pub(crate) size: [f64; 2],
    pub(crate) ratio: f64,
    pub(crate) is_origin_clean: bool,
    /// The one in its metadata, if the page may know.
    pub(crate) orientation: u8,
    pub(crate) bytes: usize,
}

impl Contents {
    fn raster(
        decoded: Decoded,
        file: &[u8],
        is_oriented: bool,
        is_origin_clean: bool,
    ) -> Option<Contents> {
        let size = exif::corrected_size(file, decoded.size, is_oriented)
            .unwrap_or_else(|| decoded.size.map(f64::from));
        (decoded.id != 0).then(|| Contents {
            pixels: Pixels::Raster(Owned::adopt(decoded.id), decoded.size),
            size,
            ratio: size[0] / size[1],
            is_origin_clean,
            orientation: if is_origin_clean {
                decoded.orientation.max(1)
            } else {
                1
            },
            bytes: file.len(),
        })
    }

    #[optimize(size)]
    fn without_orientation(&self) -> Option<Contents> {
        let &Pixels::Raster(ref pixels, mut resolution) = &self.pixels else {
            return None;
        };
        (self.orientation > 1
            && resolution[0].saturating_mul(resolution[1]) <= PIXELS_TO_TURN_AT_ONCE)
            .then_some(())?;
        let (pixels, mut size) = (
            Source {
                ignored_orientation: self.orientation,
                ..Source::new(pixels.id(), resolution, true)
            }
            .without_orientation(),
            self.size,
        );
        if self.orientation > 4 {
            resolution.reverse();
            size.reverse();
        }
        Some(Contents {
            pixels: Pixels::Raster(pixels, resolution),
            size,
            ratio: size[0] / size[1],
            ..*self
        })
    }

    pub(crate) fn id(&self) -> u32 {
        match &self.pixels {
            Pixels::Raster(pixels, _) => pixels.id(),
            Pixels::Vector { id, .. } => *id,
        }
    }

    pub(super) fn is_vector(&self) -> bool {
        matches!(self.pixels, Pixels::Vector { .. })
    }

    pub(crate) fn replaced(&self, density: f64) -> Replaced {
        Replaced::new(
            self.id(),
            self.size[0] / density,
            self.size[1] / density,
            self.ratio,
        )
    }

    /// An id that the library knows.
    pub(super) fn source(&self, document: &Doc, size: [f64; 2]) -> Source {
        Source {
            id: self.library_id(document, size),
            size,
            is_origin_clean: self.is_origin_clean,
            ignored_orientation: self.orientation,
            is_straight: false,
        }
    }

    fn library_id(&self, document: &Doc, size: [f64; 2]) -> u32 {
        match &self.pixels {
            Pixels::Raster(pixels, _) => pixels.id(),
            Pixels::Vector { id, recorded, .. } => {
                recorded
                    .get_or_init(|| {
                        Owned::adopt(document.engine(|engine, _| {
                            engine.record_vector(*id, size.map(|it| it as f32))
                        }))
                    })
                    .id()
            }
        }
    }
}

type Waiter = (Strong, Box<dyn for<'a> FnOnce(Cx<'_, 'a>, JSValue)>);

pub(crate) struct Picture {
    list: Rc<Pictures>,
    pub(crate) url: DomString,
    cors: Cors,
    /// How many SVG images it is in.
    nesting: Cell<u32>,
    /// `None` inside if it is broken.
    contents: OnceCell<Option<Contents>>,
    pub(crate) loaded_at: Cell<f64>,
    users: Cell<u32>,
    waiters: RefCell<Vec<Waiter>>,
}

impl Picture {
    pub(crate) fn contents(&self) -> Option<&Contents> {
        self.contents.get()?.as_ref()
    }

    pub(crate) fn pixels(&self) -> f64 {
        self.contents()
            .map(|it| it.size[0] * it.size[1])
            .filter(|it| !it.is_nan())
            .unwrap_or(0.0)
    }

    pub(super) fn is_settled(&self) -> bool {
        self.contents.get().is_some()
    }

    /// At once, if it has. Never, if the page is gone.
    #[optimize(size)]
    pub(crate) fn when_settled<'a>(
        &self,
        cx: Cx<'_, 'a>,
        value: JSValue,
        then: impl for<'b> FnOnce(Cx<'_, 'b>, JSValue) + 'static,
    ) {
        if self.is_settled() {
            return then(cx, value);
        }
        if !self.list.is_disposed.get() {
            self.waiters
                .borrow_mut()
                .push((Strong::create(value, cx.global()), Box::new(then)));
        }
    }

    #[optimize(size)]
    fn settle(&self, cx: Cx<'_, '_>, contents: Option<Contents>) {
        let Some(document) = self.list.document(&cx.heap) else {
            return self.waiters.borrow_mut().clear();
        };
        if contents.is_none() {
            self.list.remove(self);
        }
        let _ = self.contents.set(contents);
        self.loaded_at.set(now());
        crate::api::performance::note_new_images(&cx.heap, document);
        self.waiters
            .take()
            .into_iter()
            .for_each(|(value, then)| then(cx, value.get()));
    }

    fn load<'a>(self: Rc<Self>, cx: Cx<'_, 'a>, document: &'a Doc, element: Option<&'a Element>) {
        let url = self.url.clone();
        let url = url.to_utf8();
        let (is_oriented, request) = url
            .strip_prefix(UNORIENTED)
            .map_or((true, &*url), |it| (false, it));
        if let Some(source) =
            crate::cascade::image_of_user_agent(request).filter(|_| element.is_none())
        {
            let (requested, bytes) = (
                request.as_bytes().to_vec(),
                source.as_bytes().to_vec().into(),
            );
            return self.load_vector(
                cx,
                &Resource {
                    requested,
                    bytes,
                    mime: Vec::new(),
                    status: 200,
                    is_readable: true,
                    is_same_origin: true,
                },
            );
        }
        if request.len() <= 8192
            && request.starts_with("data:")
            && element.is_some_and(|it| it.is_html(atom!("img")))
            && document.allows_inline_images(&cx.heap)
            && let Some((mime, bytes)) =
                Url::parse(request.as_bytes()).and_then(|it| process_data_url(&it))
        {
            if mime.starts_with(b"image/svg+xml") {
                return self.load_vector(
                    cx,
                    &Resource {
                        requested: request.as_bytes().to_vec(),
                        bytes: bytes.into(),
                        mime,
                        status: 200,
                        is_readable: true,
                        is_same_origin: true,
                    },
                );
            }
            if is_tiny(&bytes) {
                return self.settle(
                    cx,
                    Contents::raster(decode(&bytes, is_oriented), &bytes, is_oriented, true),
                );
            }
        }
        let destination = match element.map(|it| it.html_tag()) {
            Some(atom!("object")) => Destination::Object,
            Some(atom!("embed")) => Destination::Embed,
            _ => Destination::Image,
        };
        host::fetch(
            cx,
            document,
            request,
            destination,
            element,
            move |cx, resource| match resource {
                Some(resource) if resource.mime.starts_with(b"image/svg+xml") => {
                    self.load_vector(cx, &resource)
                }
                Some(resource) => Job::<Decode>::schedule(
                    &cx.js_thread(),
                    Decode {
                        resource,
                        is_oriented,
                        decoded: Decoded::default(),
                    },
                    Waiting(self),
                ),
                None => self.settle(cx, None),
            },
        );
    }

    /// It gets nothing from outside of the file.
    fn load_vector(self: Rc<Self>, cx: Cx<'_, '_>, resource: &Resource) {
        static LAST_FONT_SCOPE: AtomicU32 = AtomicU32::new(1 << 31);
        let scope = LAST_FONT_SCOPE.fetch_add(1, Ordering::Relaxed) + 1;
        let (id, Replaced { size, ratio, .. }) =
            embedded::create_vector(&resource.bytes, &resource.requested, scope);
        if id == 0 {
            return self.settle(cx, None);
        }
        let [width, height, ratio] =
            [size[0], size[1], ratio].map(|it| it.map_or(f64::NAN, f64::from));
        let pixels = Pixels::Vector {
            id,
            recorded: OnceCell::new(),
            font_scope: Cell::new(0),
            parts: RefCell::default(),
        };
        let contents = Contents {
            pixels,
            size: [width, height],
            ratio,
            is_origin_clean: resource.is_readable,
            orientation: 1,
            bytes: resource.bytes.len(),
        };
        VectorLoad {
            picture: self,
            contents,
            scope,
            requests: VecDeque::new(),
        }
        .proceed(cx);
    }
}

struct VectorLoad {
    picture: Rc<Picture>,
    contents: Contents,
    scope: u32,
    requests: VecDeque<Request>,
}

impl VectorLoad {
    #[optimize(size)]
    fn proceed(mut self, cx: Cx<'_, '_>) {
        let (id, Some(document)) = (self.contents.id(), self.picture.list.document(&cx.heap))
        else {
            return;
        };
        let nesting = self.picture.nesting.get() + 1;
        loop {
            if self.requests.is_empty() {
                self.requests = embedded::vector_requests(id).into();
            }
            let Some(request) = self.requests.pop_front() else {
                break;
            };
            match request {
                Request::Image(value)
                    if nesting < embedded::MAX_NESTING
                        && value
                            .strip_prefix(UNORIENTED)
                            .unwrap_or(&value)
                            .starts_with("data:") =>
                {
                    let part = Pictures::request_within(
                        cx,
                        document,
                        DomString::from_utf8(&value),
                        None,
                        nesting,
                    );
                    let waited_for = Rc::clone(&part.0);
                    if waited_for.contents.get().is_none() {
                        return waited_for.when_settled(cx, JSValue::UNDEFINED, move |cx, _| {
                            self.with_part(&value, part).proceed(cx)
                        });
                    }
                    self = self.with_part(&value, part);
                }
                Request::Image(value) => {
                    embedded::set_vector_image(id, &value, Replaced::default())
                }
                Request::Font(value) => {
                    return host::fetch(
                        cx,
                        document,
                        &Rc::clone(&value),
                        Destination::Font,
                        None,
                        move |cx, font| {
                            if let (Some(font), Pixels::Vector { font_scope, .. }) =
                                (font, &self.contents.pixels)
                            {
                                font_scope.set(self.scope);
                                embedded::set_vector_font(id, &value, &font.bytes);
                            }
                            self.proceed(cx);
                        },
                    );
                }
                _ => {}
            }
        }
        self.picture.settle(cx, Some(self.contents));
    }

    #[optimize(size)]
    fn with_part(self, url: &str, part: Used) -> VectorLoad {
        embedded::set_vector_image(
            self.contents.id(),
            url,
            part.contents()
                .map_or_else(Replaced::default, |it| it.replaced(1.0)),
        );
        if let Pixels::Vector { parts, .. } = &self.contents.pixels {
            parts.borrow_mut().push(part);
        }
        self
    }
}

/// With all of its frames, which can be larger than a GIF says.
fn is_tiny(file: &[u8]) -> bool {
    let number = |low, high| usize::from(u16::from_le_bytes([low, high]));
    let pixels = match *file {
        [
            0x89,
            b'P',
            b'N',
            b'G',
            _,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
            b'I',
            b'H',
            b'D',
            b'R',
            0,
            0,
            a,
            b,
            0,
            0,
            c,
            d,
            ..,
        ] if !bun_core::strings::contains(file, b"acTL") => number(b, a) * number(d, c),
        [b'G', b'I', b'F', b'8', _, _, a, b, c, d, ..] => {
            let reach = |&[mark, e, f, g, h, i, j, k, l]: &[u8; 9]| {
                (mark == b',').then(|| {
                    number(a, b)
                        .max(number(e, f) + number(i, j))
                        .saturating_mul(number(c, d).max(number(g, h) + number(k, l)))
                })
            };
            let (frames, largest) = file
                .array_windows()
                .filter_map(reach)
                .fold((0, 0), |(frames, largest), it| {
                    (frames + 1, it.max(largest))
                });
            largest.saturating_mul(frames)
        }
        _ => return file.len() < 16,
    };
    pixels <= 1 << 14
}

struct Decode {
    resource: Resource,
    is_oriented: bool,
    decoded: Decoded,
}

struct Waiting(Rc<Picture>);

// SAFETY: it is used and dropped on the thread of its document.
unsafe impl JsAffine for Waiting {}

impl JobContext for Decode {
    type OffThread = Decode;
    type Js = Waiting;

    fn run(job: &mut Decode, done: Completion<Self>) -> Option<Completion<Self>> {
        job.decoded = decode(&job.resource.bytes, job.is_oriented);
        Some(done)
    }

    #[optimize(size)]
    fn then(mut job: Decode, Waiting(picture): Waiting, thread: &JsThread<'_>) -> JsResult<()> {
        let contents = Contents::raster(
            core::mem::take(&mut job.decoded),
            &job.resource.bytes,
            job.is_oriented,
            job.resource.is_readable,
        );
        in_realm_of(thread, picture.list.document.get(), |cx| {
            picture.settle(cx, contents)
        });
        Ok(())
    }
}

impl Drop for Decode {
    fn drop(&mut self) {
        drop(Owned::adopt(self.decoded.id));
    }
}

/// Keeps a picture in its list.
pub(crate) struct Used(Rc<Picture>);

impl Used {
    pub(super) fn new(picture: Rc<Picture>) -> Used {
        if picture.users.replace(picture.users.get() + 1) == 0 {
            picture
                .list
                .unused
                .borrow_mut()
                .retain(|it| !Rc::ptr_eq(it, &picture));
        }
        Used(picture)
    }

    pub(crate) fn picture(&self) -> Rc<Picture> {
        Rc::clone(&self.0)
    }

    pub(crate) fn is(&self, other: &Picture) -> bool {
        core::ptr::eq(Rc::as_ptr(&self.0), other)
    }
}

impl core::ops::Deref for Used {
    type Target = Picture;

    fn deref(&self) -> &Picture {
        &self.0
    }
}

impl Drop for Used {
    fn drop(&mut self) {
        let Picture { users, list, .. } = &*self.0;
        users.set(users.get() - 1);
        if users.get() == 0 && !list.is_disposed.get() {
            list.unused.borrow_mut().push_back(Rc::clone(&self.0));
            list.trim();
        }
    }
}

#[derive(Default)]
pub(crate) struct Pictures {
    document: Weak<()>,
    all: RefCell<HashMap<(DomString, Cors), Rc<Picture>>>,
    /// The oldest first.
    unused: RefCell<VecDeque<Rc<Picture>>>,
    is_disposed: Cell<bool>,
    /// A view transition may show what the document does not.
    keeps_unused: Cell<bool>,
}

struct OfDocument(Rc<Pictures>);

impl Drop for OfDocument {
    fn drop(&mut self) {
        self.0.dispose();
    }
}

impl Pictures {
    pub(crate) fn of<'a>(heap: &JsHeap<'a>, document: &'a Doc) -> &'a Rc<Pictures> {
        &document
            .extra_with(|| {
                OfDocument(Rc::new(Pictures {
                    document: Weak::create_passive(document.to_js(), global_of(heap)),
                    ..Default::default()
                }))
            })
            .0
    }

    fn document<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Doc> {
        Node::from_js(
            heap,
            self.document.get().filter(|_| !self.is_disposed.get())?,
        )?
        .as_doc()
    }

    #[optimize(size)]
    pub(crate) fn dispose(&self) {
        self.is_disposed.set(true);
        drop(self.unused.take());
        self.all
            .take()
            .values()
            .for_each(|it| drop(it.waiters.take()));
    }

    pub(crate) fn set_keeps_unused(&self, keeps: bool) {
        self.keeps_unused.set(keeps);
    }

    pub(crate) fn with_id(&self, id: u32) -> Option<Rc<Picture>> {
        self.all
            .borrow()
            .values()
            .find(|it| it.contents().is_some_and(|it| it.id() == id))
            .cloned()
    }

    fn remove(&self, picture: &Picture) {
        let removed = self
            .all
            .borrow_mut()
            .remove(&(picture.url.clone(), picture.cors));
        drop(removed);
    }

    fn trim(&self) {
        if self.keeps_unused.get() {
            return;
        }
        let mut pixels: f64 = self.unused.borrow().iter().map(|it| it.pixels()).sum();
        let mut evicted = Vec::new();
        self.unused.borrow_mut().retain(|it| {
            let stays =
                it.contents.get().is_none() || (pixels <= UNUSED_PIXELS && it.contents().is_some());
            if !stays {
                pixels -= it.pixels();
                evicted.extend(it.contents().map(|_| Rc::clone(it)));
            }
            stays
        });
        evicted.iter().for_each(|it| self.remove(it));
    }

    fn add(
        self: &Rc<Self>,
        url: DomString,
        cors: Cors,
        contents: OnceCell<Option<Contents>>,
    ) -> Rc<Picture> {
        let (loaded_at, users, waiters) = Default::default();
        let picture = Rc::new(Picture {
            list: Rc::clone(self),
            url: url.clone(),
            cors,
            nesting: Cell::new(0),
            contents,
            loaded_at,
            users,
            waiters,
        });
        self.all
            .borrow_mut()
            .insert((url, cors), Rc::clone(&picture));
        picture
    }

    fn known(&self, url: &DomString, cors: Cors) -> Option<Rc<Picture>> {
        self.all.borrow().get(&(url.clone(), cors)).cloned()
    }

    pub(super) fn has(&self, url: &DomString, element: &Element) -> bool {
        self.known(url, Cors::of(Some(element))).is_some()
    }

    pub(super) fn available(&self, url: &DomString, element: &Element) -> Option<Used> {
        self.known(url, Cors::of(Some(element)))
            .filter(|it| it.contents().is_some())
            .map(Used::new)
    }

    #[optimize(size)]
    pub(crate) fn request<'a>(
        cx: Cx<'_, 'a>,
        document: &'a Doc,
        url: DomString,
        element: Option<&'a Element>,
    ) -> Used {
        Pictures::request_within(cx, document, url, element, 0)
    }

    #[optimize(size)]
    fn request_within<'a>(
        cx: Cx<'_, 'a>,
        document: &'a Doc,
        url: DomString,
        element: Option<&'a Element>,
        nesting: u32,
    ) -> Used {
        let (list, cors) = (Pictures::of(&cx.heap, document), Cors::of(element));
        let is_for_image = element.is_some_and(|it| it.is_html(atom!("img")));
        if let Some(known) = list
            .known(&url, cors)
            .filter(|_| !is_for_image || may_reuse_image(&cx.heap, document, &url))
        {
            return Used::new(known);
        }
        let turned = url.to_utf8().strip_prefix(UNORIENTED).and_then(|url| {
            list.all
                .borrow()
                .values()
                .filter(|it| it.url.eq_str(before(url, 0)))
                .find_map(|it| it.contents()?.without_orientation())
        });
        if turned.is_some() {
            return Used::new(list.add(url, cors, turned.into()));
        }
        let picture = Used::new(list.add(url, cors, OnceCell::new()));
        picture.0.nesting.set(nesting);
        picture.picture().load(cx, document, element);
        picture
    }

    /// For a `data:` URL with base64. Whether it is available now.
    #[optimize(size)]
    pub(super) fn open_inline(
        self: &Rc<Self>,
        url: &DomString,
        element: &Element,
        density: f64,
        scale: f64,
        now: f64,
    ) -> bool {
        let encoded = url
            .latin1()
            .and_then(|it| it.get(bun_core::strings::index_of_char_usize(it, b',')? + 1..))
            .unwrap_or_default();
        let file = bun_base64::decode_alloc(encoded)
            .ok()
            .filter(|it| it.len().div_ceil(3) * 4 == encoded.len());
        let (is_oriented, is_origin_clean) = (true, true);
        let Some(contents) = file.and_then(|it| {
            Contents::raster(
                open(&it, density as f32, scale as f32),
                &it,
                is_oriented,
                is_origin_clean,
            )
        }) else {
            return false;
        };
        self.add(url.clone(), Cors::of(Some(element)), Some(contents).into())
            .loaded_at
            .set(now);
        true
    }
}
