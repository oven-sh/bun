//! What a document loads, and what waits for that.

pub(crate) mod for_host;
mod links;
mod modules;
mod parsing;
mod scripts;
mod sheets;
mod source;
mod speculation;
mod workers;
mod writing;

use core::cell::{Cell, OnceCell, RefCell};
use core::future::poll_fn;
use core::task::{Poll, Waker};
use std::rc::Rc;

use bun_collections::HashMap;
use bun_core::strings;
use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, Strong};
use bun_web::client::{Client, Cors, Purpose, Resource, potential_cors_request, preload_key};
use bun_web::convert::resolve_blob_url;
use bun_web::encoding::Encoding;
use bun_web::exec::{self, LocalFuture, Receiver, Sender, oneshot};
use bun_web::held::Held;
use bun_web::net::body::SharedBytes;
use bun_web::referrer::ReferrerPolicy;
use bun_web::request::{Destination, InitiatorType, Mode, Request};
use bun_web::tasks::{self, Priority, Work};
use bun_web::url::Url;

pub(crate) use self::links::LINK_STEPS;
pub(crate) use self::parsing::{
    abort_fetches, append_html, end_html, load_html, load_xml, parse_html, parser_has_ended,
    script_was_parsed, stop,
};
pub(crate) use self::scripts::{
    SCRIPT_STEPS, ScriptFate, mark_script_as_started, run_javascript_url, script_created,
};
pub(crate) use self::sheets::{INSTRUCTION_STEPS, STYLE_STEPS, imports_changed, instruction_moved};
pub(crate) use self::source::{
    allows_handler_attribute, allows_plugin_without_url, allows_style_attribute, came_with,
    document_allows_style_attribute,
};
pub(crate) use self::workers::{fetch_audio_worklet, prepare_worker_script, run_worker_script};
pub(crate) use self::writing::{close, open, write};
use crate::api::core::steps::{AttrChange, Steps};
use crate::api::core::*;
use crate::api::events::{EventInit, WindowTarget, as_task, fire, report_to_realm};
use crate::api::markup::DocumentParser;
use crate::api::realm::{client_of, hold, last_client_of, spawn};
use crate::api::window::Window;
use crate::generated_bindgen::core::ProcessingInstruction;
use crate::generated_bindgen::loading::*;

node_interface!(ProcessingInstruction, Kind::Instruction);

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;
type Bytes = Box<[u8]>;

/// <https://html.spec.whatwg.org/#has-a-style-sheet-that-is-blocking-scripts>
#[derive(Default)]
struct BlockingSheets {
    count: Cell<u32>,
    waiting: RefCell<Vec<Waker>>,
}

impl BlockingSheets {
    fn has_any(&self) -> bool {
        self.count.get() > 0
    }

    fn add(&self) {
        self.count.update(|it| it + 1);
    }

    fn remove(&self) {
        self.count.update(|it| it - 1);
        self.waiting.take().into_iter().for_each(Waker::wake);
    }

    async fn loaded(&self) {
        poll_fn(|cx| {
            if self.has_any() {
                (
                    self.waiting.borrow_mut().push(cx.waker().clone()),
                    Poll::Pending,
                )
                    .1
            } else {
                Poll::Ready(())
            }
        })
        .await;
    }
}

#[derive(Default)]
struct Loading {
    delays: Cell<u32>,
    blocking_sheets: Rc<BlockingSheets>,
    deferred_scripts: RefCell<Vec<Held<scripts::Pending>>>,
    /// Of those that run in order as soon as possible.
    last_script: Cell<Option<Receiver<()>>>,
    ignores_destructive_writes: Cell<u32>,
    was_parser_aborted: Cell<bool>,
    /// Until it has loaded.
    fetched_sheets: RefCell<HashMap<Bytes, Resource>>,
    lent_client: RefCell<Option<Rc<Client>>>,
    preferences: OnceCell<Preferences>,
    /// For what a realm would stop, if the window had one of its own.
    until_closed: RefCell<Vec<Sender<()>>>,
}

#[derive(Clone, Copy)]
struct Preferences {
    runs_scripts: bool,
    loads_images: bool,
}

impl Doc {
    fn loading(&self) -> &Loading {
        self.extra()
    }

    pub(crate) fn is_of_program(&self) -> bool {
        crate::api::realm::is_program(self.global())
    }

    /// What runs in a program can do whatever the program can.
    fn may_run_script_at(&self, url: &[u8]) -> bool {
        !self.is_of_program()
            || self.window().is_some_and(|it| {
                it.host()
                    .is_of_app(bstr::ByteSlice::to_str_lossy(url).into_owned())
            })
    }

    /// Where its scripts run. A window can have the realm of another one, and none of its own.
    pub(crate) fn has_realm(&self, heap: &JsHeap<'_>) -> bool {
        WindowTarget::of_realm(self.realm(heap))
            .zip(self.window())
            .is_some_and(|it| core::ptr::eq(it.0, it.1))
    }

    fn in_realm<R>(&self, steps: impl for<'a> FnOnce(Cx<'_, 'a>) -> R) -> R {
        exec::with_realm(self.global(), steps)
    }

    pub(crate) fn has_blocking_sheets(&self) -> bool {
        self.try_extra::<Loading>()
            .is_some_and(|it| it.blocking_sheets.has_any())
    }

    pub(crate) fn parser<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a DocumentParser> {
        DocumentParser::from_js(heap, self.edge(Edge::Parser)?)
    }

    fn resolve<'a>(&'a self, cx: Cx<'_, 'a>, url: &DomString) -> Option<Url> {
        Url::parse(self.parse_url(cx, url)?.into_href().to_utf8().as_bytes())
    }

    fn matches_media(&self, media: Option<DomString>) -> bool {
        media.is_none_or(|it| self.engine(|engine, _| engine.match_media(it.to_utf8().as_bytes())))
    }

    /// An empty frame and the document of a program have come without one.
    pub(crate) fn own_client(&self, heap: &JsHeap<'_>) -> Option<Rc<Client>> {
        self.window()?;
        self.loading()
            .lent_client
            .borrow()
            .clone()
            .or_else(|| last_client_of(self.realm(heap)).filter(|_| self.has_realm(heap)))
    }

    fn preferences(&self) -> Preferences {
        let ask = |it: &WindowTarget| Preferences {
            runs_scripts: it.host().runs_scripts() != Some(false),
            loads_images: it.host().loads_images() != Some(false),
        };
        self.window().map_or(
            Preferences {
                runs_scripts: true,
                loads_images: true,
            },
            |it| *self.loading().preferences.get_or_init(|| ask(it)),
        )
    }

    pub(crate) fn forbid_scripts(&self, around: &Doc) {
        _ = self.loading().preferences.set(Preferences {
            runs_scripts: false,
            ..around.preferences()
        });
    }

    pub(crate) fn runs_scripts(&self) -> bool {
        self.preferences().runs_scripts
    }

    pub(crate) fn allows_inline_images(&self, heap: &JsHeap<'_>) -> bool {
        Window::of(self).is_some_and(|it| !self.is_of_program() || it.is_shown())
            && self.preferences().loads_images
            && self
                .client(heap)
                .is_none_or(|it| it.policies().csp.allows_data_images())
    }

    /// For what draws controls.
    pub(crate) fn confine(&self) {
        self.loading()
            .lent_client
            .replace(Some(Client::of_controls()));
    }

    pub(crate) fn client(&self, heap: &JsHeap<'_>) -> Option<Rc<Client>> {
        let lent = self
            .try_extra::<Loading>()
            .and_then(|it| it.lent_client.borrow().clone());
        lent.or_else(|| crate::api::realm::client_or_program(self.realm(heap)))
    }
}

/// `steps` do not run if the document has gone.
#[optimize(size)]
fn queue_task<const N: usize>(
    doc: &Doc,
    values: [JSValue; N],
    steps: impl for<'a> FnOnce(Cx<'_, 'a>, &'a Doc, [JSValue; N]) + 'static,
) {
    let run = |global: &_, values: &[JSValue]| {
        exec::with_realm(global, |cx| {
            in_document(cx, values[0], |cx, doc| {
                steps(cx, doc, core::array::from_fn(|at| values[at + 1]))
            })
        });
        Ok(())
    };
    let all: smallvec::SmallVec<[JSValue; 4]> = [doc.to_js()].into_iter().chain(values).collect();
    tasks::post(
        doc.global(),
        Priority::Visible,
        Work::Once(Box::new(run)),
        &all,
    );
}

fn in_document<'a, R>(
    cx: Cx<'_, 'a>,
    doc: JSValue,
    steps: impl FnOnce(Cx<'_, 'a>, &'a Doc) -> R,
) -> Option<R> {
    let doc = Doc::from_js(&cx.heap, doc).filter(|it| it.is_fully_active())?;
    Some(as_task(cx, |cx| steps(cx, doc)))
}

/// A document and an object, for a future.
struct Anchor {
    realm: exec::Realm,
    doc: Strong,
    object: Strong,
}

impl Anchor {
    fn new(doc: &Doc, object: JSValue) -> Anchor {
        let (global, realm) = (
            doc.global(),
            exec::with_realm(doc.global(), exec::Realm::of),
        );
        Anchor {
            realm,
            doc: Strong::create(doc.to_js(), global),
            object: Strong::create(object, global),
        }
    }

    #[optimize(size)]
    async fn in_task(&self, steps: Box<dyn for<'a> FnOnce(Cx<'_, 'a>, &'a Doc, JSValue)>) {
        let (sender, done) = oneshot();
        let steps = |cx: Cx<'_, '_>, doc: JSValue, object| {
            Doc::from_js(&cx.heap, doc).inspect(|doc| steps(cx, doc, object));
            sender.send(());
        };
        self.realm.enter(|cx| {
            Doc::from_js(&cx.heap, self.doc.get()).map_or((), |it| {
                queue_task(it, [self.object.get()], |cx, doc, [object]| {
                    steps(cx, doc.to_js(), object)
                })
            })
        });
        done.await;
    }

    /// At once, unless a script is waiting for the event loop.
    #[optimize(size)]
    async fn turn(&self) {
        while self.realm.enter(|cx| tasks::is_suspended(cx.global())) {
            let (sender, resumed) = oneshot();
            self.realm
                .enter(|cx| crate::api::realm::queue_task(&cx.heap, [], |_, []| sender.send(())));
            if resumed.await.is_none() {
                break;
            }
        }
    }

    async fn soon<R>(
        &self,
        steps: impl for<'a> FnOnce(Cx<'_, 'a>, &'a Doc, JSValue) -> R,
    ) -> Option<R> {
        self.turn().await;
        self.realm.enter(|cx| {
            in_document(cx, self.doc.get(), |cx, doc| {
                steps(cx, doc, self.object.get())
            })
        })
    }
}

/// It does not go on after the window has closed.
fn spawn_for(doc: &Doc, future: impl Future<Output = ()> + 'static) {
    fn spawn_boxed(doc: &Doc, future: LocalFuture<'static, ()>) {
        let realm = JsHeap::from_global(doc.global());
        if doc.has_realm(realm) && !doc.is_of_program() {
            return spawn(realm, future);
        }
        if doc.last_window().is_some_and(WindowTarget::is_disposed) {
            return;
        }
        let ((sender, closed), mut all) = (oneshot(), doc.loading().until_closed.borrow_mut());
        if all.len() == all.capacity() {
            all.retain(|it| !it.is_closed());
        }
        all.push(sender);
        drop(all);
        spawn(realm, async move { _ = exec::race(future, closed).await });
    }
    spawn_boxed(doc, Box::pin(future));
}

pub(crate) fn window_has_closed(doc: &Doc) {
    drop(doc.try_extra::<Loading>().map(|it| it.until_closed.take()));
}

fn start_for<T: 'static>(doc: &Doc, future: impl Future<Output = T> + 'static) -> Receiver<T> {
    let (sender, result) = oneshot();
    spawn_for(doc, async move { sender.send(future.await) });
    result
}

fn start<T: 'static>(heap: &JsHeap<'_>, future: impl Future<Output = T> + 'static) -> Receiver<T> {
    let (sender, result) = oneshot();
    spawn(heap, async move { sender.send(future.await) });
    result
}

/// <https://html.spec.whatwg.org/#delay-the-load-event>
pub(crate) fn delay_load(doc: &Doc) {
    doc.loading().delays.update(|it| it + 1);
}

fn may_fire_load(doc: &Doc) -> bool {
    doc.loading().delays.get() == 0 && doc.ready_state() != ReadyState::Complete
}

fn allow_load_now<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) {
    doc.loading().delays.update(|it| it.saturating_sub(1));
    if may_fire_load(doc) && doc.is_fully_active() {
        parsing::finish_loading(cx, doc);
    }
}

pub(crate) fn allow_load(doc: &Doc) {
    doc.loading().delays.update(|it| it.saturating_sub(1));
    if may_fire_load(doc) && doc.is_fully_active() {
        queue_task(doc, [], |cx, doc, []| {
            if may_fire_load(doc) {
                parsing::finish_loading(cx, doc);
            }
        });
    }
}

#[optimize(size)]
fn fire_later(doc: &Doc, node: &Node, name: Known) {
    delay_load(doc);
    queue_task(doc, [node.to_js()], move |cx, doc, [node]| {
        Node::from_js(&cx.heap, node).map(|it| fire(cx, it, name, EventInit::default()));
        allow_load(doc);
    });
}

/// Of an element, or of a processing instruction.
fn attribute(node: &Node, name: Known) -> Option<DomString> {
    match node.as_element() {
        Some(element) => element.attr(name),
        None => node
            .downcast::<ProcessingInstruction>()?
            .pseudo_attribute(&Atom::of(name).to_dom_string()),
    }
}

fn utf8(text: Option<DomString>) -> Bytes {
    text.map(|it| it.to_utf8().as_bytes().into())
        .unwrap_or_default()
}

fn has_keyword(node: &Node, name: Known, keyword: &str) -> bool {
    attribute(node, name).is_some_and(|it| it.tokens().any(|it| it.eq_ignore_ascii_case(keyword)))
}

fn referrer_policy_of(node: &Node) -> ReferrerPolicy {
    ReferrerPolicy::parse(&utf8(attribute(node, atom!("referrerpolicy"))).to_ascii_lowercase())
        .unwrap_or(ReferrerPolicy::Empty)
}

fn cors_of(node: &Node) -> Option<Cors> {
    attribute(node, atom!("crossorigin")).map(|it| Cors::parse(it.to_utf8().as_bytes()))
}

pub(crate) fn new_request(
    client: &Client,
    url: Url,
    destination: Destination,
    cors: Option<Cors>,
    initiator: InitiatorType,
) -> Request {
    let mut request = potential_cors_request(url, destination, cors);
    request.blob = if request.url.scheme() == b"blob" {
        resolve_blob_url(&request.url)
    } else {
        None
    };
    (request.referrer, request.initiator_type) = (client.referrer_source(), Some(initiator));
    request
}

/// With what the attributes of `node` say.
#[optimize(size)]
fn request_for(
    client: &Client,
    node: &Node,
    url: Url,
    destination: Destination,
    cors: Option<Cors>,
) -> Request {
    let initiator = node
        .as_element()
        .and_then(|it| InitiatorType::parse(it.local().as_utf8().as_bytes()));
    let mut request = new_request(
        client,
        url,
        destination,
        cors,
        initiator.unwrap_or(InitiatorType::Other),
    );
    request.referrer_policy = referrer_policy_of(node);
    request.metadata.nonce = scripts::nonce_of(node);
    if destination != Destination::Image {
        request.metadata.integrity = utf8(attribute(node, atom!("integrity")));
    }
    request
}

/// For an image, a media element or a font. What a style sheet says about the request follows the URL, after null characters.
#[optimize(size)]
pub(crate) fn load_subresource<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    request: &[u8],
    destination: Destination,
    element: Option<&'a Element>,
) -> impl Future<Output = Option<Resource>> + use<> {
    let mut parts = strings::split(request, b"\0");
    let (url, modifiers, sheet) = (
        parts.next().and_then(Url::parse),
        parts.next().unwrap_or_default(),
        parts.next().unwrap_or_default(),
    );
    let is_wanted = (doc.has_page() || destination == Destination::Font)
        && (destination != Destination::Image || doc.preferences().loads_images);
    let loading = doc
        .client(&cx.heap)
        .filter(|_| is_wanted)
        .zip(url)
        .map(|(client, url)| {
            let mut request = match element {
                Some(element) => request_for(&client, element, url, destination, cors_of(element)),
                None => sheets::request_of_sheet(&client, url, destination, modifiers),
            };
            if destination == Destination::Track && request.mode == Mode::NoCors {
                request.mode = Mode::SameOrigin;
            }
            request.referrer = Url::parse(sheet).or(request.referrer);
            client.load(request, Purpose::Use, false)
        });
    async { loading?.await }
}

/// For an element that is about to get what has been loaded before. What only has to be reported is.
pub(crate) fn may_reuse_image(heap: &JsHeap<'_>, doc: &Doc, url: &DomString) -> bool {
    let Some(client) = doc
        .client(heap)
        .filter(|it| it.policies().csp.checks_again())
    else {
        return true;
    };
    let verdict = Url::parse(url.to_utf8().as_bytes()).map(|it| {
        client
            .policies()
            .csp
            .check_request(&it, Destination::Image, &Default::default(), None)
    });
    verdict.is_none_or(|it| it.is_allowed() && client.enforce(it, JSValue::UNDEFINED))
}

/// Also if the document is not shown.
#[optimize(size)]
pub(crate) fn when_loaded<T: 'static>(
    doc: &Doc,
    object: JSValue,
    loading: impl Future<Output = T> + 'static,
    steps: impl for<'a> FnOnce(Cx<'_, 'a>, &'a Doc, JSValue, T) + 'static,
) {
    let anchor = Anchor::new(doc, object);
    spawn_for(doc, async move {
        let loaded = loading.await;
        anchor.turn().await;
        anchor.realm.enter(|cx| {
            Doc::from_js(&cx.heap, anchor.doc.get())
                .map(|doc| steps(cx, doc, anchor.object.get(), loaded))
        });
    });
}

fn report_error<'a>(cx: Cx<'_, 'a>, error: bindgen::Error<'a>, script: &[u8]) {
    if let Ok(error) = cx.catch(error) {
        report_to_realm(cx, error, None, script);
    }
}

/// <https://encoding.spec.whatwg.org/#utf-8-decode>. It has the bytes themselves if it can.
fn utf8_text(bytes: &SharedBytes) -> DomString {
    match strings::first_non_ascii(bytes) {
        None => DomString::from_shared_ascii(bytes),
        Some(_) => DomString::from_utf8(&bstr::ByteSlice::to_str_lossy(
            bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes),
        )),
    }
}

// <https://html.spec.whatwg.org/#render-blocking-mechanism>

fn asks_to_block_rendering(node: &Node) -> bool {
    node.is_connected() && has_keyword(node, atom!("blocking"), "render")
}

fn allows_render_blockers(doc: &Doc) -> bool {
    doc.is_html_doc() && doc.body().is_none()
}

#[optimize(size)]
fn block_rendering(heap: &JsHeap<'_>, node: &Node) {
    let doc = node.doc();
    if asks_to_block_rendering(node) && allows_render_blockers(doc) {
        let blockers = doc.edge_list(heap, Edge::RenderBlockers);
        if !blockers.contains(node.to_js()) {
            blockers.push(heap, node.to_js());
        }
    }
}

fn unblock_rendering<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, node: JSValue) {
    doc.try_edge_list(Edge::RenderBlockers)
        .map(|it| it.remove(&cx.heap, node));
    doc.invalidate(cx);
}

#[optimize(size)]
fn drop_stale_render_blockers<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
    let Some(blockers) = doc.try_edge_list(Edge::RenderBlockers) else {
        return false;
    };
    for at in (0..blockers.len()).rev() {
        let goes_on = blockers
            .node(at)
            .filter(|it| it.is_connected())
            .is_some_and(|it| {
                scripts::blocks_parser(it)
                    || (asks_to_block_rendering(it)
                        && (!has_keyword(it, atom!("rel"), "expect")
                            || links::is_expecting(cx, it)))
            });
        if !goes_on {
            blockers.remove_range(&cx.heap, at, 1);
        }
    }
    !blockers.is_empty()
}

pub(crate) fn is_render_blocked<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
    drop_stale_render_blockers(cx, doc)
        || doc.loading().blocking_sheets.has_any()
        || (doc.parser(&cx.heap).is_some_and(|it| !it.is_from_script())
            && doc.is_html_doc()
            && doc.body().is_none())
}
