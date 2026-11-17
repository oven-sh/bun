//! A document, as the realm of the app sees it.

use std::rc::Rc;

use bun_web::client::{
    Client, Commit, Container, Purpose, Resource, Sandboxing, ScriptLocation, Scripts,
    potential_cors_request,
};
use bun_web::dom::{self, Sender};

use bun_web::compiled;
use bun_web::csp::{Delivery, Inline};
use bun_web::encoding::Encoding;
use bun_web::headers::HeaderList;
use bun_web::hosts::{self, host_of};
use bun_web::net::embedder::ClientId;
use bun_web::net::fetch::Controller;
use bun_web::origin::Origin;
use bun_web::permissions_policy::Feature;
use bun_web::request::Destination;
use bun_web::trust;
use bun_web::url::Url;

use super::context::Agent;
use super::load::Loaded;
use super::parts::WebFrameMain;
use super::sandbox::Sandbox;
use super::{Contents, lazily, logs_to_stderr, object_in, text_at};
use crate::generated_bindgen::contents::js_ElectronPage as fields;
use crate::prelude::*;
use crate::text::{before, origin_of};
use crate::webview::wire;
use crate::{app, realm, task};

/// What an `about:` document inherits from.
#[derive(Clone)]
pub(super) enum Creator {
    Page(Rc<Root<Page>>),
    /// For when it is loaded again.
    Bequest {
        client: Rc<Client>,
        base_url: Option<String>,
    },
}

impl Creator {
    fn client(&self) -> &Client {
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

pub(crate) struct State {
    pub(super) id: u32,
    pub(super) client: Rc<Client>,
    url: RefCell<String>,
    title: RefCell<String>,
    about: RefCell<Rc<About>>,
    sandbox: RefCell<Sandbox>,
    base_url: RefCell<Option<String>>,
    agent: RefCell<Option<Rc<Agent>>>,
    /// What the client has been told.
    sent_as: RefCell<(String, String)>,
    is_initial: Cell<bool>,
    /// The fetch of the document itself.
    pub(super) streaming: RefCell<Option<Controller>>,
    is_disposed: Cell<bool>,
    pub(super) is_loaded: Cell<bool>,
    pub(super) restores_scroll: Cell<bool>,
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
        state!(fn last_id() -> Cell<u32>);
        last_id().update(|it| it + 1);
        let parent = contents.parent().map(Contents::page);
        let parsed =
            Url::parse(url.as_bytes()).ok_or_else(|| type_error(format_args!("Invalid URL")))?;
        let (session, above) = (
            contents.session.network(),
            parent.map(|it| Rc::clone(&it.client)),
        );
        let state = State {
            id: last_id().get(),
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
            agent: None.into(),
            sent_as: Default::default(),
            is_initial: false.into(),
            streaming: None.into(),
            is_disposed: false.into(),
            is_loaded: false.into(),
            restores_scroll: false.into(),
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

    /// One that a page has been given.
    pub(super) fn given(arguments: &[JSValue], index: usize) -> JsResult<&'static Page> {
        cast(argument(arguments, index))
            .ok_or_else(|| type_error(format_args!("Illegal invocation")))
    }

    pub(super) fn relative_given(&self, given: &[JSValue]) -> JsResult<&'static Page> {
        let agent = self
            .agent()
            .ok_or_else(|| type_error(format_args!("Illegal invocation")))?;
        agent.member(given)
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
        let allow = contents.attribute("allow")?.unwrap_or_default();
        let allows_fullscreen = contents.attribute("allowfullscreen")?.is_some();
        let source = contents
            .attribute("srcdoc")?
            .is_none()
            .then(|| contents.attribute("src"))
            .transpose()?;
        let container = self.parent().map(|parent| Container {
            allow: allow.as_bytes(),
            allows_fullscreen,
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
        });
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
        self.is_initial.set(about.is_initial);
        self.base_url
            .replace(match about.creator.as_ref().filter(|_| inherits_origin) {
                Some(Creator::Page(page)) => page.get().base_url()?,
                Some(Creator::Bequest { base_url, .. }) => base_url.clone(),
                None => None,
            });
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
            && self.agent().is_some()
            && self.is_started()
            && next.origin_key() == self.origin_key();
        if is_heir {
            self.url.replace(next.url());
            self.configure(next.about.take())?;
            self.document_changed()?;
        }
        self.forget_creator();
        next.forget_creator();
        Ok(is_heir)
    }

    /// Makes this the empty document of a window that `opener` has opened.
    pub(super) fn adopt(&self, opener: &Page, create_page: JSValue) {
        fields::set_opener(self, Some(opener));
        fields::set_create_page(self, create_page);
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
        });
        self.is_initial.set(false);
    }

    pub(super) fn bequest(&self, creator: &Page) -> JsResult<Creator> {
        Ok(Creator::Bequest {
            client: self.client.bequest(&creator.client),
            base_url: creator.base_url()?,
        })
    }

    fn itself(&self) -> &'static Page {
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
        self.contents().context.name.replace(name);
    }

    pub(crate) fn url(&self) -> String {
        self.url.borrow().clone()
    }

    pub(super) fn set_url(&self, url: &str) {
        Url::parse(url.as_bytes())
            .into_iter()
            .for_each(|it| self.client.set_url(it));
        self.url.replace(url.to_owned());
    }

    pub(super) fn set_initial_url(&self, url: &str) -> JsResult<()> {
        if !url.starts_with("about:blank?") && !url.starts_with("about:blank#") {
            return Ok(());
        }
        self.set_url(url);
        self.tell("setUrl", &[js(url)?])
    }

    pub(super) fn title(&self) -> String {
        self.title.borrow().clone()
    }

    pub(super) fn set_title(&self, title: String) {
        self.title.replace(title);
    }

    pub(crate) fn token(&self) -> &[u8] {
        &self.client.token
    }

    pub(crate) fn origin(&self) -> String {
        string(self.client.origin().as_bytes())
    }

    /// The same for the same origin, even an opaque one.
    pub(super) fn origin_key(&self) -> String {
        match self.client.origin() {
            Origin::Opaque(id) => format!("null {id}"),
            Origin::Tuple(origin) => string(&origin),
        }
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

    fn base_url(&self) -> JsResult<Option<String>> {
        super::text_if_any(self.ask("baseUrl", &[])?)
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

    pub(super) fn agent(&self) -> Option<Rc<Agent>> {
        self.agent.borrow().clone()
    }

    pub(super) fn set_agent(&self, agent: &Rc<Agent>) {
        self.agent.replace(Some(Rc::clone(agent)));
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
        object_in(fields::controller(self)).is_some()
    }

    pub(super) fn opened(&self) -> JsResult<()> {
        self.is_initial.set(false);
        if same(self, self.contents().page()) {
            self.contents().document_opened()
        } else {
            Ok(())
        }
    }

    /// `undefined` if there is no document to ask.
    pub(crate) fn ask(&self, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        object_in(fields::controller(self))
            .map_or(Ok(JSValue::UNDEFINED), |it| invoke(it, method, arguments))
    }

    pub(super) fn tell(&self, method: &str, arguments: &[JSValue]) -> JsResult<()> {
        self.ask(method, arguments).map(drop)
    }

    pub(super) fn window(&self) -> JsResult<JSValue> {
        object_in(fields::controller(self)).map_or(Ok(JSValue::UNDEFINED), |it| get(it, "window"))
    }

    /// Unless it is gone by then.
    pub(super) fn later(&self, work: impl FnOnce(&'static Page) -> JsResult<()> + 'static) {
        post_unless_disposed(self, Priority::Host, work);
    }

    pub(super) fn may_be_unloaded(&self) -> JsResult<bool> {
        Ok(self.ask("beforeUnload", &[])? != JSValue::FALSE)
    }

    pub(super) fn navigate_for(&self, source: &Page, url: &str, options: JSValue) -> JsResult<()> {
        self.tell(
            "navigate",
            &[js(url)?, options, source.to_js(), js(source.origin())?],
        )
    }

    pub(super) fn frames(&self) -> JsResult<JSValue> {
        lazily(fields::frames(self), wire::create_set, |it| {
            fields::set_frames(self, it)
        })
    }

    pub(crate) fn frames_if_any(&self) -> JsResult<JSValue> {
        object_in(fields::frames(self)).map_or_else(|| array(&[]), wire::items_of)
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
            request.blob = bun_web::convert::resolve_blob_url(&request.url);
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

    /// `given` is the source, the sealed message and the target origin.
    pub(super) fn post_message(&self, source: &Page, given: &[JSValue]) -> JsResult<()> {
        let target = text_at(given, 2)?;
        let wanted = match &*target {
            "*" => None,
            "/" => Some(source.origin_key()),
            url => Some(origin_of(url)),
        };
        let Some(message) = dom::open_envelope(realm::peek(argument(given, 1))) else {
            return Ok(());
        };
        let source = Root::new(source);
        post_unless_disposed(self, Priority::Visible, move |it| {
            let (source, Some(agent)) = (source.get(), it.agent()) else {
                return Ok(());
            };
            if wanted.is_some_and(|wanted| wanted != it.origin_key()) {
                return Ok(());
            }
            let Some(realm) = it.known_realm(0)? else {
                return Ok(());
            };
            let sender = Sender {
                origin: &source.origin().into_bytes(),
                token: &source.client.token,
                window: realm::peek(source.contents().window_for(&agent)?),
            };
            dom::deliver_message(realm, realm::peek(it.window()?), message, sender);
            Ok(())
        });
        Ok(())
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

    pub(super) fn policy_allows_javascript_url(
        &self,
        source: JSValue,
        frame: JSValue,
    ) -> JsResult<bool> {
        let (text, csp) = (source.to_utf8(global())?, &self.client.policies().csp);
        let verdict = csp.check_inline(Inline::Navigation, &text, b"", true);
        Ok(self.client.enforce(verdict, frame))
    }

    pub(super) fn allows_javascript_url(&self, source: JSValue, frame: JSValue) -> JsResult<bool> {
        if self.forbids("allow-scripts") || !self.policy_allows_javascript_url(source, frame)? {
            return Ok(false);
        }
        // Without a policy: what the document came with, and nothing that was put into it since.
        let is_up_to_page = !compiled::is_exclusive()
            && (self.client.policies().csp.restricts_scripts() || trust::trusts_injected_scripts());
        if is_up_to_page || self.came_with(source)? {
            return Ok(true);
        }
        self.log_error("Refused to run an inline script that is not in the source of the document")
            .map(|()| false)
    }

    fn came_with(&self, script: JSValue) -> JsResult<bool> {
        match self.opener() {
            Some(opener) => opener.came_with(script),
            None => Ok(self.ask("cameWith", &[script])? == JSValue::TRUE),
        }
    }

    pub(super) fn add_policy(&self, text: &str) -> JsResult<()> {
        let is_own = self.came_with(js(format!("\0{text}"))?)?;
        self.client.add_csp(
            text.as_bytes(),
            if is_own {
                Delivery::Meta
            } else {
                Delivery::InjectedMeta
            },
        );
        self.apply_policy(false)
    }

    pub(super) fn stop_streaming(&self) {
        self.streaming.take().iter().for_each(Controller::abort);
    }

    pub(super) fn dispose(&self) -> JsResult<()> {
        self.stop_streaming();
        if self.is_disposed() {
            return Ok(());
        }
        self.tell("dispose", &[])?;
        if self.is_disposed.replace(true) {
            return Ok(());
        }
        fields::preload(self)
            .into_iter()
            .for_each(|it| it.dispose());
        self.client.dispose();
        self.count_frames(i32::MIN);
        if let Some(cleanups) = object_in(fields::cleanups(self)) {
            with_elements(wire::items_of(cleanups)?, |all| {
                all.iter().try_for_each(|it| call(*it, &[]).map(drop))
            })?;
            invoke(cleanups, "clear", &[])?;
        }
        self.dispose_worlds()?;
        self.about.take();
        fields::set_preload(self, None);
        for clear in [fields::set_controller, fields::set_create_page] {
            clear(self, JSValue::UNDEFINED);
        }
        Ok(())
    }
}
