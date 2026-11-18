//! A document, as the realm of the app sees it.

use core::cell::OnceCell;
use std::rc::Rc;

use bun_jsc::from_js_host_call_generic;
use bun_web::client::{
    Client, Commit, Container, Purpose, Resource, Sandboxing, ScriptLocation, Scripts,
    potential_cors_request,
};
use bun_web::encoding::Encoding;
use bun_web::exec::Receiver;
use bun_web::headers::HeaderList;
use bun_web::host::{Reply, Wish};
use bun_web::hosts::{self, host_of};
use bun_web::media;
use bun_web::net::embedder::ClientId;
use bun_web::net::fetch::Controller;
use bun_web::page::{self, Controls, Purpose as OfSnapshot, Snapshot};
use bun_web::permissions_policy::Feature;
use bun_web::renderer::Renderer;
use bun_web::request::Destination;
use bun_web::service::{FrameType, WindowState};
use bun_web::time::monotonic_now;
use bun_web::url::Url;

use super::load::Loaded;
use super::parts::WebFrameMain;
use super::place::Place;
use super::process::Process;
use super::sandbox::Sandbox;
use super::{Contents, lazily, logs_to_stderr, object_in};
use crate::generated_bindgen::contents::js_ElectronPage as fields;
use crate::prelude::*;
use crate::renderer::Document;
use crate::text::{before, origin_of};
use crate::webview::wire;
use crate::{app, task};

/// What an `about:` document inherits from.
#[derive(Clone)]
pub(super) enum Creator {
    Page(Rc<Root<Page>>),
    /// For when it is loaded again.
    Bequest {
        client: Rc<Client>,
        base_url: Option<String>,
        place: Place,
    },
}

impl Creator {
    pub(super) fn client(&self) -> &Client {
        match self {
            Creator::Page(page) => &page.get().client,
            Creator::Bequest { client, .. } => client,
        }
    }
}

#[derive(Default)]
pub(super) struct About {
    pub(super) is_initial: bool,
    pub(super) is_of_markup: bool,
    pub(super) has_policies_from_history: bool,
    pub(super) referrer: String,
    pub(super) creator: Option<Creator>,
    pub(super) sandbox: Sandbox,
    pub(super) loaded: Option<Rc<Loaded>>,
}

impl About {
    pub(super) fn headers(&self) -> &HeaderList {
        static NONE: HeaderList = HeaderList::new();
        self.loaded.as_ref().map_or(&NONE, |it| &it.headers)
    }
}

pub(super) type Proceed = Box<dyn FnOnce(&'static Page) -> JsResult<()>>;

pub(crate) struct State {
    pub(super) id: u32,
    pub(super) client: Rc<Client>,
    url: RefCell<String>,
    title: RefCell<String>,
    about: RefCell<Rc<About>>,
    sandbox: RefCell<Sandbox>,
    base_url: RefCell<Option<String>>,
    /// If it is not the URL.
    base_url_now: RefCell<Option<String>>,
    controls: OnceCell<Controls>,
    /// Unless the document can be called.
    pub(super) renderer: OnceCell<Renderer>,
    place: RefCell<Place>,
    process: RefCell<Option<Rc<Process>>>,
    is_started: Cell<bool>,
    pub(super) has_preload: Cell<bool>,
    /// It shares objects with the documents of its origin.
    pub(super) has_relatives: Cell<bool>,
    activated_at: Cell<f64>,
    pub(super) may_capture: Cell<bool>,
    media: RefCell<Vec<(u32, Box<dyn media::Connection>)>>,
    pub(super) has_been_active: Cell<bool>,
    /// What goes on when the page gives the ticket back.
    traversal: RefCell<Option<(u32, Proceed)>>,
    /// What the client has been told.
    sent_as: RefCell<(String, String)>,
    is_initial: Cell<bool>,
    /// The fetch of the document itself.
    pub(super) streaming: RefCell<Option<Controller>>,
    is_disposed: Cell<bool>,
    /// The app has heard what it has said last.
    pub(super) is_forgotten: Cell<bool>,
    pub(super) is_loaded: Cell<bool>,
    pub(super) restores_scroll: Cell<bool>,
    pub(super) is_from_history: Cell<bool>,
    /// What the previous document has captured, or 0.
    pub(super) inbound_transition: Cell<u32>,
    pub(super) frames_created: Cell<u32>,
    frame_count: Cell<i32>,
}

pub(crate) struct Page(Box<State>, #[expect(dead_code)] HasFields);

impl core::ops::Deref for Page {
    type Target = State;

    fn deref(&self) -> &State {
        &self.0
    }
}

struct InPage(ClientId);

impl InPage {
    fn with<T: Default>(&self, then: impl FnOnce(&'static Page) -> JsResult<T>) -> T {
        let is_allowed = bun_jsc::virtual_machine::VirtualMachine::get().script_allowed();
        let page = host_of(self.0).filter(|_| is_allowed).and_then(cast);
        page.and_then(|it| then(it).map_err(|it| task::report(Err(it))).ok())
            .unwrap_or_default()
    }
}

impl Scripts for InPage {
    fn log_error(&self, message: &[u8]) {
        self.with(|it| it.log_error(&string(message)));
    }

    fn location(&self) -> ScriptLocation {
        ScriptLocation::now(global())
    }

    fn is_inspected(&self) -> bool {
        bun_web::net::session::is_any_inspected()
            && self.with(|it| Ok(it.contents().inspection.has_network.get()))
    }

    fn window_state(&self) -> Option<WindowState> {
        self.with(|it| {
            let contents = it.contents();
            if !it.is_started() || !same(contents.page(), it) {
                return Ok(None);
            }
            let owner = contents.owner();
            Ok(Some(WindowState {
                frame_type: match (it.parent(), fields::opener(it)) {
                    (Some(_), _) => FrameType::Nested,
                    (_, Some(_)) => FrameType::Auxiliary,
                    _ => FrameType::TopLevel,
                },
                is_visible: owner.inspection.seems_focused.get() || owner.is_visible()?,
                is_focused: (owner.is_focused() || owner.inspection.seems_focused.get())
                    && (!contents.is_frame() || same(owner.focused_page()?, it)),
            }))
        })
    }

    fn focus(&self) {
        self.with(|it| {
            it.owner().focus_window()?;
            it.owner().take_focus()
        })
    }

    fn navigate(&self, url: Url) -> Option<Receiver<Option<ClientId>>> {
        self.with(|it| {
            it.contents()
                .navigate_for_service_worker(it, &string(url.href()))
                .map(Some)
        })
    }
}

pub(super) fn is_recent(time: f64) -> bool {
    monotonic_now() - time < 5000.
}

fn post_unless_disposed(
    page: &Page,
    priority: Priority,
    work: impl FnOnce(&'static Page) -> JsResult<()> + 'static,
) {
    let page = Root::new(page);
    post(priority, move || {
        if page.get().is_disposed() {
            Ok(())
        } else {
            work(page.get())
        }
    });
}

impl Page {
    pub(super) fn create(contents: &Contents, url: &str, about: About) -> JsResult<&'static Page> {
        let id = page::next_id();
        let parent = contents.parent().map(Contents::page);
        let parsed =
            Url::parse(url.as_bytes()).ok_or_else(|| type_error(format_args!("Invalid URL")))?;
        let (session, above) = (
            contents.session.network(),
            parent.map(|it| Rc::clone(&it.client)),
        );
        let state = State {
            id,
            client: Client::new(
                session,
                above,
                contents.preferences.has_web_security,
                parsed,
            ),
            url: url.to_owned().into(),
            title: Default::default(),
            about: Default::default(),
            sandbox: Default::default(),
            base_url: None.into(),
            base_url_now: None.into(),
            controls: Default::default(),
            renderer: Default::default(),
            place: Default::default(),
            process: None.into(),
            is_started: false.into(),
            has_preload: false.into(),
            has_relatives: false.into(),
            activated_at: f64::NEG_INFINITY.into(),
            may_capture: false.into(),
            media: Default::default(),
            has_been_active: false.into(),
            traversal: None.into(),
            sent_as: Default::default(),
            is_initial: false.into(),
            streaming: None.into(),
            is_disposed: false.into(),
            is_forgotten: false.into(),
            is_loaded: false.into(),
            restores_scroll: false.into(),
            is_from_history: false.into(),
            inbound_transition: 0.into(),
            frame_count: 0.into(),
            frames_created: 0.into(),
        };
        let page = fields::create(heap(), Page(state.into(), HasFields::default()));
        fields::set_contents(page, Some(contents));
        fields::set_parent(page, parent);
        fields::set_handle(
            page,
            Some(WebFrameMain::create(
                page,
                contents.context.name.borrow().clone(),
            )),
        );
        hosts::register(global(), page.client.id, page.to_js());
        page.client.set_scripts(Rc::new(InPage(page.client.id)));
        page.configure(about.into())?;
        Ok(page)
    }

    fn configure(&self, about: Rc<About>) -> JsResult<()> {
        let (url, contents) = (self.url(), self.contents());
        let inherits_origin = matches!(before(&url, ":"), "about" | "javascript");
        let inherits_policies = inherits_origin || matches!(before(&url, ":"), "blob" | "data");
        let csp = about
            .loaded
            .as_ref()
            .and_then(|it| it.required_csp.as_ref())
            .map(String::as_bytes);
        let element = contents.element();
        let source = (!element.has_srcdoc).then_some(element.src);
        let container = self.parent().map(|parent| Container {
            allow: element.allow.as_deref().unwrap_or_default().as_bytes(),
            allows_fullscreen: element.allows_fullscreen,
            has_started_navigation: matches!(&about.creator, Some(Creator::Page(it)) if same(it.get(), parent)),
            csp,
            src: source.and_then(|it| parent.client.url().join(it.unwrap_or_default().as_bytes())),
        });
        let from = about.creator.as_ref().map(Creator::client);
        self.update_agent()?;
        self.client.commit(Commit {
            url: Url::parse(url.as_bytes()).unwrap_or_else(|| self.client.url()),
            headers: about.headers(),
            status: about.loaded.as_ref().map_or(200, |it| it.status),
            referrer: about.referrer.as_bytes().into(),
            origin_of: from.filter(|_| inherits_origin || about.is_of_markup),
            policies_of: from.filter(|_| inherits_policies || about.is_of_markup),
            has_policies_from_history: about.has_policies_from_history,
            sandboxing: match (
                about.is_of_markup,
                about.sandbox.forbids("allow-same-origin"),
            ) {
                (true, _) => Sandboxing::Ignored,
                (_, true) => Sandboxing::OpaqueOrigin,
                _ => Sandboxing::ByPolicy,
            },
            container,
            reserved: about.loaded.as_ref().and_then(|it| it.reserved.take()),
        });
        if let Some(loaded) = &about.loaded {
            self.client.set_navigation_start(loaded.started);
        }
        if let Some((record, kind)) = about.loaded.as_ref().and_then(|it| it.timing.clone()) {
            self.client.set_navigation_timing(record, kind);
        }
        let mut sandbox = about.sandbox.clone();
        self.client
            .policies()
            .csp
            .sandbox()
            .into_iter()
            .for_each(|it| sandbox.keep_only(it));
        self.sandbox.replace(sandbox);
        self.place.replace(self.choose_place(&about)?);
        (self.client).treat_as_stranger(!self.place.borrow().is_trusted());
        if !matches!(*self.place.borrow(), Place::App) {
            drop(self.client.give_up_place());
        }
        self.is_initial.set(about.is_initial);
        self.base_url
            .replace(match about.creator.as_ref().filter(|_| inherits_origin) {
                Some(Creator::Page(page)) => page.get().base_url(),
                Some(Creator::Bequest { base_url, .. }) => base_url.clone(),
                None => None,
            });
        self.base_url_now.replace(self.inherited_base_url());
        self.about.replace(about);
        Ok(())
    }

    /// It would keep all the documents before this one alive.
    pub(super) fn forget_creator(&self) {
        if let Some(about) = Rc::get_mut(&mut self.about.borrow_mut()) {
            about.creator = None;
        }
    }

    /// The first document of a window leaves its global object to the next one of the same origin.
    pub(super) fn renew(&self, next: &Page) -> JsResult<bool> {
        let is_heir = self.is_initial()
            && self.has_relatives.get()
            && self.is_started()
            && next.is_kin_of(self)
            && (self.client.runs_program() || !next.client.runs_program());
        if is_heir {
            self.url.replace(next.url());
            let about = next.about.take();
            (about.loaded.iter()).for_each(|it| it.reserved.set(next.client.give_up_place()));
            self.configure(about)?;
            self.document_changed()?;
        }
        self.forget_creator();
        next.forget_creator();
        Ok(is_heir)
    }

    /// Makes this the empty document of a window that `opener` has opened.
    pub(super) fn adopt(&self, opener: &Page) {
        fields::set_opener(self, Some(opener));
        self.place.replace(opener.place());
        self.client.commit(Commit {
            url: self.client.url(),
            headers: &HeaderList::default(),
            status: 200,
            referrer: Default::default(),
            origin_of: Some(&opener.client),
            policies_of: Some(&opener.client),
            has_policies_from_history: false,
            sandboxing: Sandboxing::ByPolicy,
            container: None,
            reserved: None,
        });
        (self.client).treat_as_stranger(!opener.place().is_trusted());
        self.is_initial.set(false);
    }

    pub(super) fn bequest(&self, creator: &Page) -> Creator {
        Creator::Bequest {
            client: self.client.bequest(&creator.client),
            base_url: creator.base_url(),
            place: creator.place(),
        }
    }

    pub(super) fn itself(&self) -> &'static Page {
        // SAFETY: a reference to one leads into a cell.
        unsafe { Page::from_js_unchecked(self.to_js()) }
    }

    pub(super) fn contents(&self) -> &'static Contents {
        fields::contents(self.itself()).expect("it was made with one")
    }

    pub(super) fn owner(&self) -> &'static Contents {
        self.contents().owner()
    }

    pub(super) fn parent(&self) -> Option<&'static Page> {
        fields::parent(self.itself())
    }

    pub(super) fn opener(&self) -> Option<&'static Page> {
        fields::opener(self.itself())
    }

    pub(crate) fn handle(&self) -> JSValue {
        fields::handle(self).map_or(JSValue::UNDEFINED, JsInterface::to_js)
    }

    /// The app goes on with the object that it knows. What `old` has said last comes from another one.
    pub(super) fn succeed(&self, old: &Page) {
        let (Some(own), Some(known)) = (fields::handle(self), fields::handle(old)) else {
            return;
        };
        fields::set_handle(self, Some(known));
        fields::set_handle(old, Some(own));
        known.swap_pages(own, &self.contents().context.name.borrow());
    }

    /// The frame, if the app has not heard of it.
    pub(super) fn introduce(&self) -> Option<JSValue> {
        fields::handle(self)
            .filter(|it| it.introduce())
            .map(JsInterface::to_js)
    }

    pub(super) fn unreachable_url(&self) -> Option<String> {
        Some(
            self.about
                .borrow()
                .loaded
                .as_ref()?
                .unreachable
                .as_ref()?
                .0
                .clone(),
        )
    }

    pub(super) fn url_in_history(&self) -> String {
        self.unreachable_url().unwrap_or_else(|| self.url())
    }

    pub(super) fn rename(&self, name: String) {
        fields::handle(self)
            .into_iter()
            .for_each(|it| it.rename(&name));
        self.contents().rename(name);
    }

    pub(crate) fn url(&self) -> String {
        self.url.borrow().clone()
    }

    pub(super) fn set_url(&self, url: &str) {
        Url::parse(url.as_bytes())
            .into_iter()
            .for_each(|it| self.client.set_url(it));
        let old = self.url.replace(url.to_owned());
        (self.base_url_now.borrow_mut()).take_if(|it| *it == old);
    }

    pub(super) fn set_initial_url(&self, url: &str) -> JsResult<()> {
        if !url.starts_with("about:blank?") && !url.starts_with("about:blank#") {
            return Ok(());
        }
        self.set_url(url);
        self.base_url_now.take();
        self.tell(|it| it.set_url(url.to_owned()))
    }

    pub(super) fn title(&self) -> String {
        self.title.borrow().clone()
    }

    pub(super) fn set_title(&self, title: String) {
        self.title.replace(title);
    }

    pub(crate) fn id(&self) -> u32 {
        self.id
    }

    pub(crate) fn token(&self) -> &[u8] {
        &self.client.token
    }

    pub(crate) fn origin(&self) -> String {
        string(self.client.origin().as_bytes())
    }

    /// The same for the same origin, even an opaque one.
    pub(super) fn origin_key(&self) -> String {
        string(&self.client.origin().key())
    }

    pub(super) fn referrer(&self) -> String {
        self.about.borrow().referrer.clone()
    }

    pub(super) fn loaded(&self) -> Option<Rc<Loaded>> {
        self.about.borrow().loaded.clone()
    }

    pub(super) fn inherited_base_url(&self) -> Option<String> {
        self.base_url.borrow().clone()
    }

    fn base_url(&self) -> Option<String> {
        let now = || self.base_url_now.borrow().clone();
        (self.is_started()).then(|| now().unwrap_or_else(|| self.url()))
    }

    pub(super) fn base_url_changed(&self, url: String) {
        self.base_url_now.replace(Some(url));
    }

    pub(super) fn encoding_of_frames(&self) -> Option<Encoding> {
        self.loaded()?
            .encoding
            .get()
            .filter(|it| !it.name().starts_with("UTF-16"))
    }

    pub(super) fn sandbox(&self) -> Sandbox {
        self.sandbox.borrow().clone()
    }

    pub(super) fn forbids(&self, flag: &str) -> bool {
        self.sandbox.borrow().forbids(flag)
    }

    /// It counts if the user has just done something in the window.
    pub(super) fn activated(&self) -> JsResult<()> {
        if !is_recent(self.owner().context.last_input.get()) {
            return Ok(());
        }
        self.activated_at.set(monotonic_now());
        self.has_been_active.set(true);
        self.contents().spread_activation()
    }

    pub(super) fn consume_activation(&self) -> JsResult<()> {
        (self.owner().page().with_descendants()?.iter())
            .for_each(|it| it.get().activated_at.set(f64::NEG_INFINITY));
        self.owner().consume_activation_apart_from(self)
    }

    pub(super) fn has_activation(&self) -> bool {
        self.is_started() && is_recent(self.activated_at.get())
    }

    pub(crate) fn is_initial(&self) -> bool {
        self.is_initial.get()
    }

    pub(super) fn is_disposed(&self) -> bool {
        self.is_disposed.get()
    }

    pub(super) fn is_active(&self) -> bool {
        core::iter::successors(Some(self), |it| it.parent()).all(|it| !it.is_disposed())
    }

    pub(super) fn is_at_top(&self) -> bool {
        !self.is_disposed() && self.parent().is_none()
    }

    /// In the whole tree. It can only take back what it has added.
    pub(super) fn count_frames(&self, added: i32) -> u32 {
        let (added, all) = (
            added.clamp(-self.frame_count.get(), 1),
            &self.owner().context.frame_count,
        );
        self.frame_count.update(|it| it + added);
        all.update(|it| it + added);
        all.get() as u32
    }

    pub(super) fn is_started(&self) -> bool {
        self.is_started.get()
    }

    /// If it is on this thread.
    pub(super) fn document(&self) -> Option<&'static Document> {
        fields::document(self.itself())
    }

    pub(super) fn started(&self, document: Option<&Document>, renderer: Option<Renderer>) {
        fields::set_document(self, document);
        _ = renderer.map(|it| self.renderer.set(it));
        _ = self.controls.set(Controls::new(page::here(), self.id));
        self.is_started.set(true);
    }

    pub(super) fn started_in(&self, process: Rc<Process>) {
        _ = (self.renderer).set(Renderer::new(Rc::<Process>::clone(&process), self.id));
        _ = (self.controls).set(Controls::new(Rc::<Process>::clone(&process), self.id));
        self.process.replace(Some(process));
        self.is_started.set(true);
    }

    pub(super) fn process(&self) -> Option<Rc<Process>> {
        self.process.borrow().clone()
    }

    pub(super) fn is_in(&self, process: &Process) -> bool {
        self.process
            .borrow()
            .as_ref()
            .is_some_and(|it| same(&**it, process))
    }

    pub(crate) fn is_far(&self) -> bool {
        self.process.borrow().is_some()
    }

    pub(super) fn is_running_in(&self, process: &Process) -> bool {
        self.is_started() && self.is_in(process)
    }

    pub(super) fn place(&self) -> Place {
        self.place.borrow().clone()
    }

    /// In the same process, once both have started.
    pub(super) fn is_beside(&self, other: &Page) -> bool {
        match (&*self.process.borrow(), &*other.process.borrow()) {
            (Some(own), Some(others)) => Rc::ptr_eq(own, others),
            _ => *self.place.borrow() == *other.place.borrow(),
        }
    }

    /// One can do to the other what it likes.
    pub(super) fn is_kin_of(&self, other: &Page) -> bool {
        self.is_beside(other) && self.origin_key() == other.origin_key()
    }

    pub(super) fn process_id(&self) -> u32 {
        if let Some(it) = (self.process()).or_else(|| self.contents().process_meant_for(self)) {
            return it.pid;
        }
        crate::process::id()
    }

    pub(super) fn opened(&self) -> JsResult<()> {
        self.is_initial.set(false);
        if same(self, self.contents().page()) {
            self.contents().document_opened()
        } else {
            Ok(())
        }
    }

    pub(crate) fn tell(&self, order: impl FnOnce(&Controls)) -> JsResult<()> {
        match self.controls.get().filter(|_| self.is_started()) {
            Some(controls) => from_js_host_call_generic(global(), || order(controls)),
            None => Ok(()),
        }
    }

    /// The default if there is no document to ask.
    pub(crate) fn ask<T: Default + 'static>(
        &self,
        query: impl FnOnce(&Controls, Reply<T>),
    ) -> JsResult<T> {
        let outcome = Rc::new(Cell::new(None));
        let slot = Rc::clone(&outcome);
        self.tell(|it| query(it, Box::new(move |_, it| slot.set(Some(it)))))?;
        if let Some(process) = self.process().filter(|_| Rc::strong_count(&outcome) > 1) {
            process.wait();
        }
        Ok(outcome.take().unwrap_or_default())
    }

    /// The same, for who can wait.
    pub(crate) async fn ask_later<T: Default + 'static>(
        &self,
        query: impl FnOnce(&Controls, Reply<T>),
    ) -> JsResult<T> {
        let (send, outcome) = task::oneshot();
        self.tell(|it| query(it, Box::new(move |_, it| send.send(it))))?;
        Ok(outcome.await.unwrap_or_default())
    }

    /// Unless it is gone by then.
    pub(super) fn later(&self, work: impl FnOnce(&'static Page) -> JsResult<()> + 'static) {
        post_unless_disposed(self, Priority::Host, work);
    }

    pub(super) fn after_script(&self, work: impl FnOnce(&'static Page) -> JsResult<()> + 'static) {
        let page = Root::new(self);
        super::process::after_script(Priority::Host, move || match page.get().is_disposed() {
            true => Ok(()),
            false => work(page.get()),
        });
    }

    pub(super) fn may_be_unloaded(&self) -> JsResult<bool> {
        Ok(!self.ask(Controls::before_unload)?)
    }

    pub(super) fn navigate_for(&self, source: &Page, wish: Wish) -> JsResult<()> {
        let initiator = Some(source.id);
        let wish = Box::new(Wish { initiator, ..wish });
        self.tell(|it| it.navigate(wish, self.origin() != source.origin()))
    }

    /// False if the page stays where it is.
    pub(super) fn will_traverse(
        &self,
        key: String,
        is_by_user: bool,
        proceed: Proceed,
    ) -> JsResult<bool> {
        state!(fn last_ticket() -> Cell<u32>);
        last_ticket().update(|it| it + 1);
        let ticket = last_ticket().get();
        self.traversal.replace(Some((ticket, proceed)));
        self.ask(|it, reply| it.will_traverse(key, is_by_user, ticket, reply))
    }

    pub(super) fn proceed(&self, ticket: u32) -> JsResult<()> {
        let found = self.traversal.borrow_mut().take_if(|it| it.0 == ticket);
        found.map_or(Ok(()), |it| (it.1)(self.itself()))
    }

    /// What it has frames and popups by the numbers of.
    pub(super) fn numbered(&self) -> JsResult<&'static mut bun_jsc::JSMap> {
        let create = || Ok(bun_jsc::JSMap::create(global()));
        lazily(fields::numbered(self), create, |it| {
            fields::set_numbered(self, it)
        })
        .map(map_in)
    }

    pub(super) fn with_number<T: JsInterface>(&self, number: u32) -> JsResult<Option<&'static T>> {
        Ok(cast(self.numbered()?.get(global(), js(number)?)?))
    }

    pub(super) fn frames(&self) -> JsResult<JSValue> {
        lazily(fields::frames(self), wire::create_set, |it| {
            fields::set_frames(self, it)
        })
    }

    pub(crate) fn frames_if_any(&self) -> JsResult<JSValue> {
        object_in(fields::frames(self)).map_or_else(|| array(&[]), wire::items_of)
    }

    /// Those that are not in the web engine.
    pub(crate) fn with_descendants(&self) -> JsResult<Vec<Root<Page>>> {
        let (mut all, mut next) = (vec![Root::new(self)], 0);
        while let Some(page) = all.get(next).map(Root::get) {
            next += 1;
            let frames = elements(page.frames_if_any()?)?;
            all.extend(
                (frames.into_iter().filter_map(cast::<Contents>)).map(|it| Root::new(it.page())),
            );
        }
        Ok(all)
    }

    pub(crate) async fn snapshot(&self, purpose: OfSnapshot) -> JsResult<Snapshot> {
        const PATIENCE_WITH_FRAME: u64 = 1000;
        let apart = match purpose {
            OfSnapshot::Print => self.contents().pages_apart_below()?,
            _ => Vec::new(),
        };
        let mut taken = self.snapshot_of_process(purpose).await?;
        for it in &apart {
            let of_frame = it.get().snapshot_of_process(OfSnapshot::Print);
            if let Some(of_frame) = task::within(PATIENCE_WITH_FRAME, of_frame)
                .await
                .transpose()?
            {
                taken.frames.push((it.get().id, of_frame.markup));
                taken.frames.extend(of_frame.frames);
            }
        }
        Ok(taken)
    }

    async fn snapshot_of_process(&self, purpose: OfSnapshot) -> JsResult<Snapshot> {
        let mut taken = (self.ask_later(|it, reply| it.snapshot(purpose, reply))).await?;
        let is_beside =
            |id| (self.contents().related_page(id)).is_some_and(|it| it.is_beside(self));
        taken.resources.retain(|it| is_beside(it.page));
        taken.frames.retain(|it| is_beside(it.0));
        Ok(taken)
    }

    pub(crate) fn origin_of_base(&self) -> String {
        origin_of(&self.base_url().unwrap_or_else(|| self.url()))
    }

    pub(super) fn cleanups(&self) -> JsResult<JSValue> {
        lazily(fields::cleanups(self), wire::create_set, |it| {
            fields::set_cleanups(self, it)
        })
    }

    pub(super) fn notifications(&self) -> JsResult<&'static mut bun_jsc::JSMap> {
        let create = || Ok(bun_jsc::JSMap::create(global()));
        lazily(fields::notifications(self), create, |it| {
            fields::set_notifications(self, it)
        })
        .map(map_in)
    }

    /// Before it sends requests.
    pub(super) fn update_agent(&self) -> JsResult<()> {
        let now = (
            self.owner().user_agent()?,
            self.contents().session.accept_language()?,
        );
        if *self.sent_as.borrow() != now {
            self.client
                .set_agent(now.0.as_bytes(), now.1.as_bytes(), app::path()?.as_bytes());
            self.sent_as.replace(now);
        }
        Ok(())
    }

    pub(crate) fn fetch(
        &self,
        url: &str,
        destination: Destination,
    ) -> JsResult<impl Future<Output = Option<Resource>> + use<>> {
        self.update_agent()?;
        let (client, url) = (Rc::clone(&self.client), Url::parse(url.as_bytes()));
        let request = url.map(|url| {
            let mut request = potential_cors_request(url, destination, None);
            request.referrer = client.referrer_source();
            if !self.is_far() || client.origin().is_origin_of(&request.url) {
                request.blob = bun_web::convert::resolve_blob_url(&request.url);
            }
            request
        });
        Ok(async { client.load(request?, Purpose::Use, false).await })
    }

    pub(super) fn has_feature(&self, name: &[u8]) -> bool {
        Feature::parse(name).map_or_else(
            || self.parent().is_none(),
            |it| self.client.permissions_policy().allows(it),
        )
    }

    pub(super) fn log_error(&self, message: &str) -> JsResult<()> {
        self.log_with("error", message, 0, None, "")
    }

    pub(super) fn log_with(
        &self,
        level: &str,
        message: &str,
        line: u32,
        source: Option<&str>,
        stack: &str,
    ) -> JsResult<()> {
        let source = source.map_or_else(|| self.url(), str::to_owned);
        if logs_to_stderr() {
            crate::dialog::print_error(&format!(
                "[{}:{level}] {message} {stack} ({source}:{line})",
                self.owner().id
            ));
        }
        let number = ["debug", "info", "warning", "error"]
            .iter()
            .position(|it| *it == level)
            .map_or(-1, |it| it as i32);
        let (page, level, message) = (Root::new(self), level.to_owned(), message.to_owned());
        post(Priority::Host, move || {
            let (page, message, source) = (page.get(), js(message)?, js(source)?);
            let event = Event::create()
                .with("message", message)?
                .with("level", level)?
                .with("lineNumber", line)?;
            let event = event
                .with("sourceId", source)?
                .with("frame", page.handle())?;
            page.contents().emit(
                "console-message",
                &[event.to_js(), number.into(), message, js(line)?, source],
            )
        });
        Ok(())
    }

    pub(super) fn request_permission(
        &self,
        name: &str,
        more: JSValue,
        then: impl FnOnce(bool) -> JsResult<()> + 'static,
    ) -> JsResult<()> {
        let Some(handler) = self
            .contents()
            .session
            .handler("setPermissionRequestHandler")?
        else {
            return then(true);
        };
        let details = super::spread(
            object!({ "isMainFrame": self.parent().is_none(), "requestingUrl": self.url() }),
            more,
        )?;
        let then = Cell::new(Some(then));
        let answer = procedure(move |given| {
            then.take()
                .map_or(Ok(()), |it| it(argument(given, 0).to_boolean()))
        })?;
        call(handler, &[self.owner().to_js(), js(name)?, answer, details]).map(drop)
    }

    pub(super) fn check_permission(&self, name: JSValue, more: JSValue) -> JsResult<bool> {
        let Some(handler) = self
            .contents()
            .session
            .handler("setPermissionCheckHandler")?
        else {
            return Ok(true);
        };
        let own = object!({ "isMainFrame": self.parent().is_none(), "requestingUrl": self.url(), "embeddingOrigin": self.owner().page().origin() + "/" });
        let details = super::spread(super::spread(object!({}), more)?, own)?;
        Ok(call(
            handler,
            &[
                self.owner().to_js(),
                name,
                js(self.origin() + "/")?,
                details,
            ],
        )?
        .to_boolean())
    }

    /// For a page in another process.
    pub(super) fn tell_media(&self, connection: u32, commands: Option<Vec<u8>>) -> JsResult<()> {
        const MOST_CONNECTIONS: usize = 1 << 10;
        let Some(commands) = commands.filter(|_| !self.is_disposed()) else {
            self.media.borrow_mut().retain(|it| it.0 != connection);
            return Ok(());
        };
        if self.media.borrow().iter().all(|it| it.0 != connection) {
            if self.media.borrow().len() == MOST_CONNECTIONS {
                return Ok(());
            }
            let controls = self.controls.get().cloned();
            let listener: media::Listener = Rc::new(move |line| {
                (controls.iter()).for_each(|it| it.media(connection, line.map(<[u8]>::to_vec)));
            });
            let connected = media::connect(&listener);
            self.media.borrow_mut().push((connection, connected));
        }
        let more = object!({ "mediaType": "audio" });
        let may_list = crate::text::contains(&string(&commands), "\"devices\"")
            && self.check_permission(js("media")?, more)?;
        let media = self.media.borrow();
        let found = media.iter().find(|it| it.0 == connection);
        (found.iter()).for_each(|it| it.1.send(&commands, [may_list, self.may_capture.get()]));
        Ok(())
    }

    pub(super) fn stop_streaming(&self) {
        self.streaming.take().iter().for_each(Controller::abort);
    }

    pub(super) fn dispose(&self) -> JsResult<()> {
        self.stop_streaming();
        match self.process() {
            _ if self.is_disposed() => Ok(()),
            Some(process) => process.hold(|| self.take_down()),
            None => self.take_down(),
        }
    }

    fn take_down(&self) -> JsResult<()> {
        self.ask(Controls::dispose)?;
        if self.is_disposed.replace(true) {
            return Ok(());
        }
        let this = Root::new(self);
        post(Priority::Host, move || {
            this.get().is_forgotten.set(true);
            Ok(())
        });
        if self.is_far() {
            let left = instances::<Contents>(self.frames_if_any()?).map(|it| it.map(Root::new));
            (left.collect::<JsResult<Vec<_>>>()?.iter()).try_for_each(|it| it.get().remove())?;
        }
        self.client.dispose();
        self.count_frames(i32::MIN);
        if let Some(cleanups) = object_in(fields::cleanups(self)) {
            with_elements(wire::items_of(cleanups)?, |all| {
                all.iter().try_for_each(|it| call(*it, &[]).map(drop))
            })?;
            invoke(cleanups, "clear", &[])?;
        }
        self.document().map_or(Ok(()), Document::dispose)?;
        self.tell_renderer(Renderer::dispose)?;
        (self.process().iter()).for_each(|it| it.dismiss(self));
        self.about.take();
        self.media.take();
        self.traversal.take();
        fields::set_document(self, None);
        self.is_started.set(false);
        Ok(())
    }
}
