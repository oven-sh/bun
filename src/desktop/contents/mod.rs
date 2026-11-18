//! `webContents`: what shows one document after the other, in a window or in a frame.

mod apart;
mod api;
mod context;
mod embedding;
mod features;
mod frame;
mod history;
mod hooks;

pub(crate) mod inspection;
mod link;
mod load;
mod open;
pub(crate) mod page;
pub(crate) mod parts;
pub(crate) mod place;
pub(crate) mod process;
mod sandbox;
mod save;
mod witness;
mod worlds;

use std::rc::Rc;
use std::sync::Arc;

use bun_ui::protocol::{Command, SurfaceCommand};
use bun_ui::surfaces;
use bun_web::encoding::Encoding;
use bun_web::headers::HeaderList;
use bun_web::host::{Activation, FontSettings, Owner};
use bun_web::input::{Action, Extent, Input, Mouse, Place};
use bun_web::page::{Change, Controls, News as ForElement};

use self::context::Context;
use self::frame::Embedded;
use self::inspection::{Inspection, News};
use self::load::Loading;
use self::page::{About, Creator, Page};
use crate::devtools::debugger::Debugger;
use crate::generated_bindgen::contents::js_ElectronWebContents as fields;
use crate::prelude::*;
use crate::session::{self, Session};
use crate::view::View;
use crate::webview::remote::Remote;
use crate::window::Window;
use crate::{app, renderer};

pub(crate) use self::history::{Document, Entry, History};
pub(crate) use self::hooks::all_chosen;
pub(crate) use self::load::{How, Request, can_evaluate};

type Values<'a, 'b> = &'b [JsLocal<'a>];
type Method<T> = fn(&'static T, &[JSValue]) -> JsResult<JSValue>;
type Methods<T> = &'static [(&'static str, Method<T>)];

/// Functions that need no `this`.
fn bind<T: JsInterface + 'static>(
    object: JSValue,
    owner: &T,
    methods: Methods<T>,
) -> JsResult<JSValue> {
    for &(name, method) in methods {
        let body = move |owner, arguments: &[JSValue]| {
            // SAFETY: what was captured.
            method(unsafe { T::from_js_unchecked(owner) }, arguments)
        };
        object.put(global(), name.as_bytes(), function(owner.to_js(), body)?);
    }
    Ok(object)
}

const NOTHING: JsResult<JSValue> = Ok(JSValue::UNDEFINED);

fn nothing(result: JsResult<impl Sized>) -> JsResult<JSValue> {
    result.map(|_| JSValue::UNDEFINED)
}

fn field(value: Option<JSValue>) -> JSValue {
    value.unwrap_or(JSValue::UNDEFINED)
}

fn object_in(value: Option<JSValue>) -> Option<JSValue> {
    value.filter(|it| it.is_object())
}

/// What is in a field, which gets it when it is first wanted.
fn lazily(
    held: Option<JSValue>,
    create: fn() -> JsResult<JSValue>,
    hold: impl FnOnce(JSValue),
) -> JsResult<JSValue> {
    if let Some(it) = object_in(held) {
        return Ok(it);
    }
    let created = create()?;
    hold(created);
    Ok(created)
}

/// `{ ...from }`, into `to`.
fn spread(to: JSValue, from: JSValue) -> JsResult<JSValue> {
    if from.is_object() {
        let mut names = from.keys(global())?.array_iterator(global())?;
        while let Some(name) = names.next()? {
            JSValue::put_to_property_key(to, global(), name, get_by_value(global(), from, name)?)?;
        }
    }
    Ok(to)
}

/// 0 for what is no number.
trait Numbers {
    fn as_u32(self) -> u32;
    fn as_i32(self) -> i32;
}

impl Numbers for JSValue {
    fn as_u32(self) -> u32 {
        self.get_number().unwrap_or_default() as u32
    }

    fn as_i32(self) -> i32 {
        self.get_number().unwrap_or_default() as i32
    }
}

fn text_at(arguments: &[JSValue], index: usize) -> JsResult<String> {
    text_of(argument(arguments, index))
}

pub(crate) fn text_if_any(value: JSValue) -> JsResult<Option<String>> {
    value.is_string().then(|| text_of(value)).transpose()
}

fn or_undefined(value: Option<impl IntoJs>) -> JsResult<JSValue> {
    bun_ui::value::or_undefined(value, global())
}

fn without_hash(url: &str) -> &str {
    crate::text::before(url, "#")
}

fn is_web(url: &str) -> bool {
    url.starts_with("http:") || url.starts_with("https:")
}

struct Preferences {
    uses_web_engine: bool,
    has_web_security: bool,
    runs_scripts: bool,
    loads_images: bool,
    disables_dialogs: bool,
    throttles_background: bool,
    is_transparent: bool,
    checks_spelling: bool,
    has_webgl: bool,
    focuses_on_navigation: bool,
    isolates_context: bool,
    integrates_node: bool,
    integrates_node_in_frames: bool,
    is_sandboxed: bool,
    /// That of the system, which takes another process.
    has_sandbox: bool,
    fixes_text_areas: bool,
    keeps_window_size: bool,
    reports_preferred_size: bool,
    allows_dev_tools: bool,
    zoom_factor: f64,
    preload: Option<String>,
    default_encoding: Option<Encoding>,
    fonts: Option<Arc<FontSettings>>,
}

fn read_fonts(given: JSValue) -> JsResult<Option<Arc<FontSettings>>> {
    let size = |name| JsResult::Ok(get(given, name)?.get_number().map(|it| it as i32 as f32));
    let [size, monospace_size, minimum_size] = [
        size("defaultFontSize")?,
        size("defaultMonospaceFontSize")?,
        size("minimumFontSize")?,
    ];
    let families = object_in(Some(get(given, "defaultFontFamily")?));
    if families.is_none() && size.or(monospace_size).or(minimum_size).is_none() {
        return Ok(None);
    }
    let family = |name| families.map_or(Ok(None), |it| text_if_any(get(it, name)?));
    let mut generic = Vec::new();
    for (name, in_css) in [
        ("serif", "serif"),
        ("sansSerif", "sans-serif"),
        ("monospace", "monospace"),
        ("cursive", "cursive"),
        ("fantasy", "fantasy"),
        ("math", "math"),
    ] {
        generic.extend(family(name)?.map(|it| (in_css.to_owned(), it)));
    }
    Ok(Some(Arc::new(FontSettings {
        size: size.unwrap_or(16.),
        monospace_size: monospace_size.unwrap_or(13.),
        minimum_size: minimum_size.unwrap_or(0.),
        standard: family("standard")?,
        generic,
    })))
}

impl Preferences {
    fn read(given: JSValue) -> JsResult<Preferences> {
        let is_set = |name| JsResult::Ok(get(given, name)?.to_boolean());
        let is_left_on = |name| JsResult::Ok(get(given, name)? != JSValue::FALSE);
        let (integrates_node, sandbox) = match place::forces_sandbox() {
            true => (false, JSValue::TRUE),
            false => (is_set("nodeIntegration")?, get(given, "sandbox")?),
        };
        Ok(Preferences {
            uses_web_engine: is_set("webEngine")?,
            has_web_security: is_left_on("webSecurity")?,
            runs_scripts: is_left_on("javascript")?,
            loads_images: is_left_on("images")?,
            disables_dialogs: is_set("disableDialogs")?,
            throttles_background: is_left_on("backgroundThrottling")?,
            is_transparent: is_set("transparent")?,
            checks_spelling: is_left_on("spellcheck")?,
            has_webgl: is_left_on("webgl")?,
            focuses_on_navigation: is_left_on("focusOnNavigation")?,
            isolates_context: is_left_on("contextIsolation")?,
            integrates_node,
            integrates_node_in_frames: is_set("nodeIntegrationInSubFrames")?,
            is_sandboxed: if sandbox.is_undefined_or_null() {
                !integrates_node
            } else {
                sandbox.to_boolean()
            },
            has_sandbox: sandbox.to_boolean() && place::ask_for_sandbox(),
            fixes_text_areas: !is_left_on("textAreasAreResizable")?,
            keeps_window_size: is_set("disableHtmlFullscreenWindowResize")?,
            reports_preferred_size: is_set("enablePreferredSizeMode")?,
            allows_dev_tools: is_left_on("devTools")?,
            default_encoding: text_if_any(get(given, "defaultEncoding")?)?
                .and_then(|it| Encoding::for_label(it.as_bytes())),
            fonts: read_fonts(given)?,
            zoom_factor: get(given, "zoomFactor")?.get_number().unwrap_or(1.),
            preload: text_if_any(get(given, "preload")?)?,
        })
    }
}

#[derive(Clone, Copy)]
enum Markup<'a> {
    Html,
    StartOfHtml,
    /// The type.
    Xml(&'a str),
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Kind {
    Window,
    BrowserView,
    Remote,
    Frame,
    Print,
}

/// What is emulated. Nothing where there is a zero.
#[derive(Clone, Copy)]
struct Device {
    screen: [f64; 2],
    view: [f64; 2],
    scale: f64,
}

pub(crate) struct State {
    id: u32,
    surface: u32,
    kind: Cell<Kind>,
    size: Cell<Option<Extent>>,
    session: &'static Session,
    preferences: Rc<Preferences>,
    context: Context,
    embedded: Option<Embedded>,
    /// Of the window and its frames.
    history: RefCell<History>,
    activation: RefCell<Option<Activation>>,
    loading: Loading,
    is_destroyed: Cell<bool>,
    /// The listeners of `destroyed` have been called.
    is_gone: Cell<bool>,
    has_shown_trusted: Cell<bool>,
    /// The URL of what was shown, until something else is.
    crashed_at: RefCell<Option<String>>,
    ignores_menu_shortcuts: Cell<bool>,
    is_muted: Cell<bool>,
    throttles_background: Cell<bool>,
    /// And the page has not been told otherwise.
    was_shown: Cell<bool>,
    theme_color: Cell<Option<u32>>,
    device: Cell<Option<Device>>,
    background: Cell<u32>,
    user_agent: RefCell<Option<String>>,
    zoom_mode: RefCell<String>,
    own_zoom: Cell<Option<f64>>,
    last_search: Cell<u32>,
    inspection: Inspection,
}

pub(crate) struct Contents(Box<State>, #[expect(dead_code)] HasFields);

impl core::ops::Deref for Contents {
    type Target = State;

    fn deref(&self) -> &State {
        &self.0
    }
}

#[derive(Default)]
struct All {
    /// Until they are destroyed, the oldest first.
    alive: RefCell<Vec<Root<Contents>>>,
    last_id: Cell<u32>,
    focused: Cell<u32>,
}

state!(fn all() -> All);

fn alive_at(index: usize) -> Option<&'static Contents> {
    all().alive.borrow().get(index).map(Root::get)
}

/// Some may be left out if `alive` changes meanwhile.
fn alive() -> impl Iterator<Item = &'static Contents> {
    (0..).map_while(alive_at)
}

fn of_app() -> impl Iterator<Item = &'static Contents> {
    alive().filter(|it| !matches!(it.kind.get(), Kind::Frame | Kind::Print))
}

fn with_id(id: u32) -> Option<&'static Contents> {
    let all = all().alive.borrow();
    all.binary_search_by_key(&id, |it| it.get().id)
        .ok()
        .map(|at| all[at].get())
}

fn focused() -> Option<&'static Contents> {
    with_id(all().focused.get())
}

/// Where the user is.
pub(crate) fn to_edit(window: JSValue) -> JsResult<JSValue> {
    focused().map_or_else(|| get(window, "webContents"), |it| Ok(it.to_js()))
}

pub(crate) fn window_of_focused_dev_tools() -> Option<&'static Window> {
    fields::inspects(focused()?)?.window()
}

pub(crate) fn theme_changed() -> JsResult<()> {
    of_app().try_for_each(Contents::environment_changed)
}

pub(crate) fn update_agents() {
    crate::task::report(alive().try_for_each(|it| it.page().update_agent()));
}

pub(crate) fn dictionary_changed() -> JsResult<()> {
    of_app().try_for_each(|it| it.page().tell(Controls::dictionary_changed))
}

pub(crate) fn online_changed(is_online: bool) {
    alive().for_each(|it| {
        it.page()
            .later(move |page| page.tell(|it| it.online_changed(is_online)))
    });
}

enum Start<'a> {
    Alone,
    /// By a frame of the web engine.
    OpenedByGuest(JSValue, &'static Session),
    Opened {
        opener: &'a Page,
        /// The first document is in the realm of `opener`.
        borrows_realm: bool,
        is_related: bool,
    },
    Framed(&'a Page, u32, &'a Owner),
}

const OF_FRAMES: &[&str] = &[
    "console-message",
    "did-navigate-in-page",
    "did-redirect-navigation",
    "did-start-navigation",
    "frame-created",
    "will-frame-navigate",
    "will-redirect",
];

fn modifier_names(bits: u32) -> JsResult<JSValue> {
    let names = ["shift", "control", "alt", "meta", "altgr", "capslock"]
        .into_iter()
        .enumerate();
    js(names
        .filter(|it| bits & 1 << it.0 != 0)
        .map(|it| it.1)
        .collect::<Vec<_>>())
}

impl Contents {
    pub(crate) fn create(preferences: JSValue, kind: Kind) -> JsResult<&'static Contents> {
        Contents::start(preferences, kind, &Start::Alone)
    }

    fn start(given: JSValue, kind: Kind, start: &Start<'_>) -> JsResult<&'static Contents> {
        let given = if given.is_object() {
            given
        } else {
            object!({})
        };
        let (session, preferences) = match *start {
            Start::Framed(parent, ..) => (
                parent.contents().session,
                Rc::clone(&parent.contents().preferences),
            ),
            _ => {
                let session = match (cast::<Session>(get(given, "session")?), start) {
                    (_, Start::OpenedByGuest(_, session)) => session,
                    (Some(session), _) => session,
                    (None, Start::Opened { opener, .. }) => opener.contents().session,
                    (None, _) => session::from_partition(
                        &text_if_any(get(given, "partition")?)?.unwrap_or_default(),
                    )?,
                };
                (session, Rc::new(Preferences::read(given)?))
            }
        };
        let creator = match *start {
            Start::Framed(page, ..)
            | Start::Opened {
                opener: page,
                is_related: true,
                ..
            } => Some(page),
            _ => None,
        };
        all().last_id.update(|it| it + 1);
        let state = State {
            id: all().last_id.get(),
            surface: surfaces::next_id(),
            kind: kind.into(),
            size: None.into(),
            session,
            throttles_background: preferences.throttles_background.into(),
            was_shown: false.into(),
            theme_color: None.into(),
            device: None.into(),
            preferences,
            context: Context::new(creator.map(Page::contents)),
            embedded: match *start {
                Start::Framed(parent, number, element) => {
                    Some(Embedded::new(parent, number, element)?)
                }
                _ => None,
            },
            history: Default::default(),
            activation: Default::default(),
            loading: Default::default(),
            is_destroyed: false.into(),
            is_gone: false.into(),
            has_shown_trusted: false.into(),
            crashed_at: Default::default(),
            ignores_menu_shortcuts: false.into(),
            is_muted: false.into(),
            background: 0.into(),
            user_agent: None.into(),
            zoom_mode: "default".to_owned().into(),
            own_zoom: None.into(),
            last_search: 0.into(),
            inspection: Default::default(),
        };
        let this = fields::create(heap(), Contents(state.into(), HasFields::default()));
        fields::set_preferences(this, given);
        match *start {
            Start::Alone => {}
            Start::OpenedByGuest(opener, _) => fields::set_opener(this, opener),
            Start::Opened {
                opener, is_related, ..
            } => {
                fields::set_opener(this, opener.to_js());
                fields::set_opened_by(this, is_related.then(|| opener.contents()));
            }
            Start::Framed(parent, ..) => this.embed(parent),
        }
        this.announce_to_pages(creator.map(|it| it.contents().id));
        if let Start::Framed(_, _, element) = *start {
            this.rename(element.name.clone());
        }
        this.tell_surface(SurfaceCommand::Create {
            size: Size {
                width: 800.,
                height: 600.,
            },
            scale: 1.,
            is_focusable: true,
        })?;
        this.listen_to(this.surface);
        let about = About {
            is_initial: true,
            referrer: creator.map(Page::url).unwrap_or_default(),
            creator: creator.map(|it| Creator::Page(Rc::new(Root::new(it)))),
            ..Default::default()
        };
        this.show_from_now(this.new_page("about:blank", about)?);
        this.page().forget_creator();
        if let Start::Alone = start {
            process::prepare(&this.page().place(), false)?;
        }
        all().alive.borrow_mut().push(Root::new(this));
        if let Start::Opened {
            opener,
            borrows_realm: true,
            ..
        } = *start
        {
            this.page().adopt(opener);
        }
        if !matches!(kind, Kind::Frame | Kind::Print) {
            announce(app::object(), "web-contents-created", &[this.to_js()])?;
        }
        if matches!(start, Start::Opened { .. }) {
            this.announce_frame()?;
        }
        Ok(this)
    }

    /// For a reference that is known to lead into a cell.
    fn itself(&self) -> &'static Contents {
        // SAFETY: it is one.
        unsafe { Contents::from_js_unchecked(self.to_js()) }
    }

    pub(crate) fn page(&self) -> &'static Page {
        fields::page(self.itself()).expect("there is always one")
    }

    /// What apps see of a frame.
    fn owner(&self) -> &'static Contents {
        fields::owner(self.itself()).unwrap_or_else(|| self.itself())
    }

    pub(crate) fn parent(&self) -> Option<&'static Contents> {
        fields::parent(self.itself())
    }

    fn is_frame(&self) -> bool {
        self.embedded.is_some()
    }

    pub(crate) fn guest(&self) -> Option<&'static Remote> {
        fields::guest(self.itself())
    }

    pub(crate) fn set_guest(&self, guest: Option<&Remote>) {
        if guest.is_some() {
            self.crashed_at.take();
        }
        fields::set_guest(self, guest);
    }

    pub(crate) fn surface(&self) -> u32 {
        self.surface
    }

    pub(crate) fn background(&self) -> u32 {
        self.background.get()
    }

    pub(crate) fn preferences(&self) -> JSValue {
        field(fields::preferences(self))
    }

    pub(crate) fn history(&self) -> &'static RefCell<History> {
        &self.owner().history
    }

    pub(crate) fn size(&self) -> Option<Extent> {
        self.size.get()
    }

    /// It is known before the surface has it.
    pub(crate) fn size_of_view(&self) -> Option<[f64; 2]> {
        fields::view(self)?.area()
    }

    pub(crate) fn window(&self) -> Option<&'static Window> {
        fields::view(self.owner())?.window()
    }

    pub(crate) fn view(&self) -> Option<&'static View> {
        fields::view(self.itself())
    }

    fn window_object(&self) -> JSValue {
        self.window().map_or(JSValue::UNDEFINED, JsInterface::to_js)
    }

    fn is_visible(&self) -> JsResult<bool> {
        let is_drawn = fields::view(self.owner()).is_some_and(View::is_drawn);
        Ok(is_drawn && self.window().map(Window::is_on_screen).transpose()? == Some(true))
    }

    /// What the page takes itself to be.
    fn seems_shown(&self) -> JsResult<bool> {
        let (it, window) = (self.owner(), self.window());
        let is_shown = match (fields::view(it), window) {
            (None, _) => true,
            (_, Some(window)) if it.kind.get() == Kind::Window && window.paints_unshown() => true,
            (Some(view), Some(window)) => {
                it.is_visible()? && view.has_area() && !window.is_out_of_sight()
            }
            _ => false,
        };
        if is_shown || it.throttles_background.get() {
            it.was_shown.set(is_shown);
        }
        Ok(it.was_shown.get())
    }

    fn is_window_focused(&self) -> JsResult<bool> {
        Ok(self.window().map(Window::has_focus).transpose()? == Some(true))
    }

    fn seems_to_have_focus(&self) -> bool {
        self.is_focused() || self.inspection.seems_focused.get()
    }

    pub(crate) fn focus_window(&self) -> JsResult<()> {
        self.window().map_or(Ok(()), Window::take_focus)
    }

    fn tell_surface(&self, command: SurfaceCommand) -> JsResult<()> {
        tell(Command::Surface {
            id: self.surface,
            command,
        })
    }

    fn later(&self, work: impl FnOnce(&'static Contents) -> JsResult<()> + 'static) {
        let this = Root::new(self);
        post(Priority::Host, move || work(this.get()));
    }

    fn after_script(&self, work: impl FnOnce(&'static Contents) -> JsResult<()> + 'static) {
        let this = Root::new(self);
        process::after_script(Priority::Host, move || work(this.get()));
    }

    pub(crate) fn show_in(&self, view: &View, kind: Kind) -> JsResult<()> {
        if fields::view(self).is_some() {
            return Err(type_error(format_args!(
                "options.webContents is already attached to a window"
            )));
        }
        self.kind.set(kind);
        fields::set_view(self, Some(view));
        Ok(())
    }

    pub(crate) fn is_transparent(&self) -> bool {
        self.preferences.is_transparent
    }

    pub(crate) fn is_gone(&self) -> bool {
        self.is_gone.get()
    }

    pub(crate) fn change_background(&self, color: u32) -> JsResult<()> {
        self.background.set(color);
        self.guest().map_or(Ok(()), Remote::change_background)
    }

    pub(crate) fn environment_changed(&self) -> JsResult<()> {
        match self.guest() {
            Some(guest) => guest.environment_changed(),
            None => {
                self.page().tell(Controls::environment_changed)?;
                (self.pages_apart_below()?.iter())
                    .try_for_each(|it| it.get().tell(Controls::environment_changed))
            }
        }
    }

    // ── events ──

    fn emit(&self, name: &str, arguments: &[JSValue]) -> JsResult<()> {
        let is_of_frames = || {
            OF_FRAMES.contains(&name)
                || name.starts_with("did-frame-")
                || name.starts_with("did-fail-")
        };
        if !self.is_frame() || is_of_frames() {
            emit(self.owner().to_js(), name, arguments)
        } else {
            Ok(())
        }
    }

    /// With an event before `arguments`. False if a listener has prevented the default.
    fn dispatch(&self, name: &str, arguments: &[JSValue]) -> JsResult<bool> {
        let event = Event::create();
        let mut all = [event.to_js(); 7];
        all[1..=arguments.len()].copy_from_slice(arguments);
        self.emit(name, &all[..=arguments.len()])?;
        Ok(!event.get_default_prevented())
    }

    fn announce(&self, name: &str, arguments: &[JSValue]) -> JsResult<()> {
        self.dispatch(name, arguments).map(drop)
    }

    fn announce_for_frame(&self, name: &str, page: &Page, arguments: &[JSValue]) -> JsResult<()> {
        let mut all = [JSValue::UNDEFINED; 6];
        let (given, rest) = all.split_at_mut(arguments.len());
        given.copy_from_slice(arguments);
        rest[..3].copy_from_slice(&[
            (!self.is_frame()).into(),
            js(self.owner().id)?,
            js(page.id)?,
        ]);
        self.announce(name, &all[..arguments.len() + 3])
    }

    /// False if a listener has prevented the default.
    fn dispatch_navigation(
        &self,
        name: &str,
        url: &str,
        is_same_document: bool,
        initiator: JSValue,
    ) -> JsResult<bool> {
        let (frame, url, is_main) = (self.main_frame()?, js(url)?, !self.is_frame());
        let event = Event::create()
            .with("url", url)?
            .with("isSameDocument", is_same_document)?;
        let event = event
            .with("isMainFrame", is_main)?
            .with("frame", frame)?
            .with("initiator", initiator)?;
        let ids = [get(frame, "processId")?, get(frame, "routingId")?];
        self.emit(
            name,
            &[
                event.to_js(),
                url,
                is_same_document.into(),
                is_main.into(),
                ids[0],
                ids[1],
            ],
        )?;
        Ok(!event.get_default_prevented())
    }

    // ── documents ──

    fn new_page(&self, url: &str, mut about: About) -> JsResult<&'static Page> {
        about.sandbox = self.sandbox_of_next(about.headers());
        Page::create(self, url, about)
    }

    fn sandbox_of_next(&self, headers: &HeaderList) -> sandbox::Sandbox {
        let mut sandbox = match (self.parent(), self.opener_page()) {
            (Some(parent), _) => parent.page().sandbox(),
            (None, Some(opener)) => opener.sandbox().of_popups(),
            _ => Default::default(),
        };
        let element = self.element();
        if element.kind == "iframe" {
            (element.sandbox.into_iter()).for_each(|it| sandbox.restrict(it.as_bytes()));
        }
        headers
            .values(b"content-security-policy")
            .for_each(|it| sandbox.restrict_by_policy(it));
        sandbox
    }

    fn opener_page(&self) -> Option<&'static Page> {
        cast(fields::opener(self)?)
    }

    /// The empty document costs nothing until something looks at it.
    pub(crate) fn started_page(&self) -> JsResult<&'static Page> {
        if !self.page().is_started() {
            self.show(self.page(), "", Markup::Html)?;
        }
        Ok(self.page())
    }

    fn has_crashed(&self) -> bool {
        self.crashed_at.borrow().is_some()
    }

    pub(crate) fn live_page(&self) -> JsResult<&'static Page> {
        match self.has_crashed() {
            true => Err(renderer::disposed()),
            false => self.started_page(),
        }
    }

    fn on_device(&self, real: Extent) -> Input {
        let or = |emulated: f64, real| if emulated > 0. { emulated } else { real };
        Input::Resize {
            extent: self.device.get().map_or(real, |it| Extent {
                size: [or(it.view[0], real.size[0]), or(it.view[1], real.size[1])],
                scale: or(it.scale, real.scale),
            }),
            is_quiet: false,
        }
    }

    fn show(&self, page: &Page, source: &str, markup: Markup<'_>) -> JsResult<()> {
        if page.is_started() {
            page.foretell()?;
        } else if let Err(thrown) = catch(page.start())? {
            if page.is_started() || page.place() == place::Place::App {
                return Err(global().throw_value(thrown));
            }
            return self.crash("launch-failed", 1);
        }
        if self.is_apart() {
            self.catch_up_with_element()?;
        }
        if page.is_initial() && page.has_relatives.get() {
            self.tell_element(ForElement::Measure)?;
            if self.is_frame() {
                page.tell(|it| it.follow_container(false))?;
            } else if let Some(extent) = self.size() {
                let is_quiet = true;
                page.tell(|it| it.input(Input::Resize { extent, is_quiet }))?;
            }
            self.notify(News::DocumentCreated)?;
            return page.tell(Controls::stay_empty);
        }
        if self.is_frame() {
            page.tell(|it| it.follow_container(true))?;
        } else if let Some(size) = self.size() {
            page.tell(|it| it.input(self.on_device(size)))?;
        }
        if self.is_focused() || self.inspection.seems_focused.get() {
            page.tell(|it| it.input(Input::Focus { direction: 0 }))?;
        }
        self.notify(News::DocumentCreated)?;
        page.tell(|it| match markup {
            Markup::Html => it.load_html(source.to_owned(), false),
            Markup::StartOfHtml => it.load_html(source.to_owned(), true),
            Markup::Xml(kind) => it.load_xml(source.to_owned(), kind.to_owned()),
        })
    }

    pub(crate) fn leave_page(&self) -> JsResult<()> {
        self.page().dispose()?;
        let about = About {
            is_initial: true,
            ..Default::default()
        };
        self.set_page(self.new_page("about:blank", about)?);
        self.leave_unused_places();
        Ok(())
    }

    pub(crate) fn has_crashed_at(&self, url: String) {
        self.crashed_at.replace(Some(url));
    }

    fn crash(&self, reason: &str, exit_code: i32) -> JsResult<()> {
        self.cancel_pending()?;
        self.lose_page(reason, exit_code)
    }

    /// The next one may be on its way.
    fn lose_page(&self, reason: &str, exit_code: i32) -> JsResult<()> {
        self.page().dispose()?;
        let (old, url) = (self.page(), self.page().url_in_history());
        let mut about = About::default();
        about.sandbox.keep_only(Vec::new());
        let page = Page::create(self, &url, about)?;
        page.succeed(old);
        self.set_page(page);
        self.tell_pages(&Change::Crashed);
        self.has_crashed_at(url);
        self.set_loading(self.loading.is_pending())?;
        self.leave_unused_places();
        if self.is_frame() && old.place() != place::Place::App {
            return Ok(());
        }
        let details = object!({ "reason": reason, "exitCode": exit_code });
        self.announce("render-process-gone", &[details])?;
        announce(
            app::object(),
            "render-process-gone",
            &[self.owner().to_js(), details],
        )
    }

    fn may_unload(&self, is_closing: bool) -> JsResult<bool> {
        self.notify(News::Leaving)?;
        let mut agrees = self.page().may_be_unloaded()?;
        for it in self.pages_apart_below()? {
            agrees = agrees && it.get().may_be_unloaded()?;
        }
        Ok(agrees
            || (!is_closing && !self.page().has_been_active.get())
            || (!self.is_frame() && !self.dispatch("will-prevent-unload", &[])?))
    }

    pub(crate) fn close_now(&self) -> JsResult<()> {
        if self.is_destroyed.get() {
            return Ok(());
        }
        self.announce("close", &[])?;
        self.destroy_now()
    }

    /// With the window that it fills, after the tasks that pages have queued so far.
    fn close_soon(&self) {
        let this = Root::new(self);
        process::after_script(Priority::Visible, move || {
            let it = this.get();
            match it.window().filter(|_| it.kind.get() == Kind::Window) {
                Some(window) => window.request_close(),
                None => it.owner().close_now(),
            }
        });
    }

    fn destroy_now(&self) -> JsResult<()> {
        if self.is_destroyed.get() {
            return Ok(());
        }
        self.cancel_pending()?;
        self.give_up_promise()?;
        self.page().dispose()?;
        if self.is_destroyed.replace(true) {
            return Ok(());
        }
        self.discard();
        self.guest().map_or(Ok(()), Remote::end)?;
        fields::inspector(self).map_or(Ok(()), Debugger::end)?;
        self.end_dev_tools()?;
        self.notify(News::Destroyed)?;
        all().alive.borrow_mut().retain(|it| !same(it.get(), self));
        if self.is_frame() && self.is_busy() {
            self.owner().later(Contents::report_loading);
        }
        bun_web::storage::drop_session_storage(self.id);
        fields::view(self).map_or(Ok(()), View::release)?;
        surfaces::ignore(self.surface);
        bun_ui::queue::destroy_surface(global(), self.surface)?;
        let result = self.announce("destroyed", &[]);
        self.is_gone.set(true);
        self.history.take();
        result
    }

    // ── input ──

    fn listen_to(&self, surface: u32) {
        let this = Root::new(self);
        surfaces::listen_with(surface, move |it| this.get().input(it.into()));
    }

    pub(crate) fn input(&self, mut input: Input) -> JsResult<()> {
        if input.may_activate() {
            (self.owner().context.last_input).set(bun_web::time::monotonic_now());
        }
        match &input {
            // The library repeats what `place()` has said, which may have changed since.
            Input::Resize { .. } if self.is_frame() => return Ok(()),
            Input::Resize { extent, .. } => {
                self.size.set(Some(*extent));
                fields::pending_guest(self).map_or(Ok(()), |it| it.handle(input.clone()))?;
                if self.guest().is_none() && self.device.get().is_some() {
                    input = self.on_device(*extent);
                }
            }
            Input::Focus { .. } if !self.is_frame() => {
                all().focused.set(self.id);
                self.emit("focus", &[])?;
            }
            Input::Blur { .. } => {
                if self.is_focused() {
                    all().focused.set(0);
                }
                self.emit("blur", &[])?;
                if self.inspection.seems_focused.get() {
                    return Ok(());
                }
            }
            Input::Mouse(it) if !self.is_frame() && !self.before_mouse(it.place, Some(it))? => {
                return Ok(());
            }
            Input::Wheel { place, .. }
                if !self.is_frame() && !self.before_mouse(*place, None)? =>
            {
                return Ok(());
            }
            Input::Key(key) if !self.is_destroyed.get() && self.before_input(key)? => {
                (self.page_with_keys()).tell(|it| it.input(Input::KeyTaken))?;
                return tell(Command::KeyWasHandled);
            }
            _ => {}
        }
        match (self.guest(), input) {
            _ if self.is_destroyed.get() => Ok(()),
            (Some(guest), input) => guest.handle(input),
            (None, Input::Key(key)) if !self.page().is_started() => {
                if key.is_down {
                    link::handle_shortcut(self.page(), &key)?;
                }
                tell(Command::KeyWasHandled)
            }
            (None, input) if apart::is_typed(&input) => {
                self.page_with_keys().tell(|it| it.input(input))
            }
            (None, input) => self.page().tell(|it| it.input(input)),
        }
    }

    /// `mouse` is `None` for the wheel. False if the page is not to see it.
    fn before_mouse(&self, place: Place, mouse: Option<&Mouse>) -> JsResult<bool> {
        let (button, action) = (mouse.map(|it| it.button), mouse.map(|it| it.action));
        if let Some(3 | 4) = button {
            if let Some(window) = self.window()
                && action == Some(Action::Up)
            {
                let command = if button == Some(3) {
                    "browser-backward"
                } else {
                    "browser-forward"
                };
                announce(window.to_js(), "app-command", &[js(command)?])?;
            }
            return Ok(true);
        }
        if !has_listeners(self.to_js(), "before-mouse-event")?
            && !has_listeners(self.to_js(), "input-event")?
        {
            return Ok(true);
        }
        let kind = match action {
            None => "mouseWheel",
            Some(Action::Down) => "mouseDown",
            Some(Action::Up) => "mouseUp",
            Some(Action::Leave) => "mouseLeave",
            Some(Action::Move) => "mouseMove",
        };
        let modifiers = modifier_names(place.modifiers)?;
        let input = object!({
            "type": kind,
            "modifiers": modifiers,
            "x": place.window[0],
            "y": place.window[1],
            "globalX": place.screen[0],
            "globalY": place.screen[1],
            "clickCount": or_undefined(mouse.map(|it| it.clicks))?,
            "button": *button.and_then(|it| ["left", "middle", "right"].get(it as usize)).unwrap_or(&"none"),
        });
        if !self.dispatch("before-mouse-event", &[input])? {
            return Ok(false);
        }
        self.announce(
            "input-event",
            &[object!({ "type": kind, "modifiers": modifiers })],
        )
        .map(|()| true)
    }

    /// Whether the app has taken the key.
    fn before_input(&self, key: &bun_web::host::Keystroke) -> JsResult<bool> {
        if self.is_frame()
            || (!has_listeners(self.to_js(), "before-input-event")?
                && !has_listeners(self.to_js(), "input-event")?)
        {
            return Ok(false);
        }
        let (is_down, bits) = (key.is_down, key.modifiers);
        let modifiers = modifier_names(bits)?;
        let input = object!({
            "type": if is_down { "keyDown" } else { "keyUp" },
            "key": &*key.key,
            "code": &*key.code,
            "isAutoRepeat": key.repeats,
            "isComposing": key.is_composing,
            "shift": bits & 1 != 0,
            "control": bits & 2 != 0,
            "alt": bits & 4 != 0,
            "meta": bits & 8 != 0,
            "location": key.location,
            "modifiers": modifiers,
        });
        if !self.dispatch("before-input-event", &[input])? {
            return Ok(true);
        }
        let input = object!({ "type": if is_down { "rawKeyDown" } else { "keyUp" }, "modifiers": modifiers });
        self.announce("input-event", &[input]).map(|()| false)
    }
}

fn logs_to_stderr() -> bool {
    state!(fn known() -> core::cell::OnceCell<bool>);
    *known().get_or_init(|| {
        crate::process::variable("ELECTRON_ENABLE_LOGGING")
            .is_ok_and(|it| it.is_some_and(|it| !it.is_empty()))
            || crate::command_line::switch("enable-logging").is_some()
    })
}
