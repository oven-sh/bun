//! What a page of the app's own realm gets from outside.

use bun_jsc::{JSGlobalObject, Strong, from_js_host_call, from_js_host_call_generic};
use bun_web::dom::{self, Opening};
use bun_web::host::{
    self, Answer, DialogKind, Environment, FileChoice, Host, Notice, Opened, Question, Reply,
    ToGuest,
};
use bun_web::js_link::{Native, NativeHost};
use bun_web::page::{self, News};

use crate::generated_bindgen::script::js_DesktopPageHost as fields;
use crate::generated_bindgen::window::{DesktopWindow, InputInit, WindowInit, js_DesktopWindow};
use crate::page_window::is_of_app;
use crate::prelude::*;
use crate::session::{self, Session};
use crate::webview::embedded::Controls;
use crate::webview::embedder::{Embedder, Holder};
use crate::webview::remote::Remote;
use crate::window::Window;
use crate::{app, dialog, paths, screen, shell, task, text, theme};

pub(crate) struct PageHost {
    page: u32,
    surface: Cell<u32>,
    guests: RefCell<Vec<(u32, Root<Controls>)>>,
    /// It is above the content of a window, and not the content.
    is_overlay: bool,
}

fn widen(it: Rect) -> host::Rect {
    let [x, y, width, height] = [it.x, it.y, it.width, it.height].map(f64::from);
    host::Rect {
        x,
        y,
        width,
        height,
    }
}

fn environment_of(window: &DesktopWindow) -> JsResult<Environment> {
    let (bounds, settings) = (window.bounds()?, theme::settings()?);
    let (display, default) = (screen::display_matching(bounds)?, Environment::default());
    let is_visible = window.is_on_screen()? && !window.is_in_dock()? && !window.is_occluded();
    Ok(Environment {
        is_dark: theme::is_dark()?,
        reduces_motion: answer((ui()?.system_state)())?.reduces_motion,
        increases_contrast: theme::increases_contrast()?,
        forces_colors: theme::forces_colors(),
        reduces_transparency: settings.reduced_transparency,
        light_highlight: (settings.highlight.get()).map_or(default.light_highlight, |it| it[0]),
        dark_highlight: (settings.highlight.get()).map_or(default.dark_highlight, |it| it[1]),
        display: Some(host::Display {
            bounds: widen(display.bounds),
            work_area: widen(display.work_area),
            color_depth: 24,
        }),
        zoom: window.get_zoom_factor(),
        is_active: window.has_focus()?,
        is_visible,
        is_drawn: is_visible,
        is_fullscreen: window.fills_screen()?,
        is_transparent: window.has_background(),
        overlays_scrollbars: (settings.overlay_scrollbars.get())
            .unwrap_or(default.overlays_scrollbars),
        window_bounds: Some(widen(bounds)),
        languages: app::languages()?,
        ..default
    })
}

fn feature(features: &str, name: &str) -> Option<f64> {
    let value = text::split(features, ",")
        .filter_map(|it| text::split_once(it.trim(), "="))
        .find_map(|it| (it.0 == name).then_some(it.1));
    value?.trim().parse().ok().filter(|it| *it != 0.)
}

impl PageHost {
    pub(crate) fn create(surface: u32, is_overlay: bool) -> &'static PageHost {
        let surface = Cell::new(surface);
        fields::create(
            heap(),
            PageHost {
                page: page::next_id(),
                guests: Default::default(),
                surface,
                is_overlay,
            },
        )
    }

    fn show_in(&self, window: &DesktopWindow) {
        self.surface.set(window.surface.get());
        fields::set_window(self, Some(window));
    }

    fn with_window(&self, act: impl FnOnce(&DesktopWindow) -> JsResult<()>) -> JsResult<()> {
        fields::window(self).map_or(Ok(()), act)
    }

    fn leave_for(&self, url: &[u8]) -> JsResult<()> {
        self.with_window(|window| {
            let is_external = [&b"http:"[..], b"https:", b"mailto:"].map(|it| url.starts_with(it));
            match dispatch(window.to_js(), "will-navigate", &[js(string(url))?])? {
                true if is_external.contains(&true) => shell::open_url(url),
                _ => Ok(()),
            }
        })
    }

    fn open(&self, url: &str, features: &str) -> JsResult<Opened> {
        if url != "about:blank" || fields::window(self).is_none() {
            return self.leave_for(url.as_bytes()).map(|()| Opened::Nothing);
        }
        let [width, height, x, y] =
            ["width", "height", "left", "top"].map(|it| feature(features, it));
        let options = WindowInit {
            width,
            height,
            x,
            y,
            ..WindowInit::default()
        };
        let structure = js_DesktopWindow::CLASS.structure(heap());
        let window = DesktopWindow::open_as_asked(heap(), structure, &options)?;
        Ok(Opened::Page(id_of(window.page())?))
    }

    fn pick_files(&self, it: &FileChoice) -> JsResult<JSValue> {
        let Some(window) = fields::window(self) else {
            return Ok(JSValue::UNDEFINED);
        };
        let extensions = (it.accept.iter()).map(|it| it.as_bytes().strip_prefix(b"."));
        let extensions = extensions.collect::<Option<Vec<_>>>().unwrap_or_default();
        dialog::pick_files(window, it.is_directory, it.is_multiple, &extensions)
    }

    fn tell_guest(&self, number: u32, message: ToGuest) -> JsResult<()> {
        let mut all = self.guests.borrow_mut();
        let found = all.iter().find(|it| it.0 == number).map(|it| it.1.get());
        if let ToGuest::Remove = message {
            all.retain(|it| it.0 != number);
        }
        drop(all);
        found.map_or(Ok(()), |it| it.obey(message))
    }
}

fn id_of(page: JSValue) -> JsResult<u32> {
    Ok(get(page, "id")?.as_number() as u32)
}

fn tell_page(id: u32, order: impl FnOnce(&page::Controls)) -> JsResult<()> {
    from_js_host_call_generic(global(), || order(&page::Controls::new(page::here(), id)))
}

pub(crate) fn send_input_to(page: JSValue, surface: u32) -> JsResult<()> {
    let id = id_of(page)?;
    bun_ui::surfaces::listen_with(surface, move |it| {
        tell_page(id, |page| page.input(it.into()))
    });
    Ok(())
}

pub(crate) fn wants_to_stay(page: JSValue) -> JsResult<bool> {
    let stays = std::rc::Rc::new(Cell::new(false));
    let slot = std::rc::Rc::clone(&stays);
    tell_page(id_of(page)?, |it| {
        it.before_unload(move |_, it| slot.set(it))
    })?;
    Ok(stays.get())
}

pub(crate) fn render_now(page: JSValue) -> JsResult<()> {
    let frame = bun_web::input::Input::Frame { is_urgent: true };
    tell_page(id_of(page)?, |it| it.input(frame))
}

fn host_in(owner: JSValue) -> &'static PageHost {
    cast(owner).expect("it is what the link was made with")
}

fn obey(window: &DesktopWindow, question: Question) -> JsResult<Option<Answer>> {
    match question {
        Question::Loaded { stage } => match stage {
            bun_web::host::Stage::Loaded => emit(window.to_js(), "did-finish-load", &[])?,
            _ => emit(window.to_js(), "dom-ready", &[])?,
        },
        Question::SetFullscreen { is_on } => {
            invoke(window.to_js(), "setFullScreen", &[is_on.into()]).map(drop)?
        }
        Question::SetTitle { title } => window.change_title(title)?,
        Question::UnhandledKey { key } => window.handle_shortcut(&key)?,
        _ => {}
    }
    Ok(None)
}

struct OfProgram;

impl Native for OfProgram {
    fn hear(&self, owner: JSValue, notice: Notice) -> JsResult<()> {
        let Some(window) = fields::window(host_in(owner)).filter(|it| !it.is_destroyed()) else {
            return Ok(());
        };
        match notice {
            Notice::ContextMenu { menu } => announce(window.to_js(), "context-menu", &[js(menu)?]),
            Notice::FirstPaint {} => emit(window.to_js(), "ready-to-show", &[]),
            Notice::FocusWindow {} => window.take_focus(),
            Notice::MoveWindow { bounds } => {
                invoke(window.to_js(), "setBounds", &[js(bounds)?]).map(drop)
            }
            _ => Ok(()),
        }
    }

    fn answer(&self, owner: JSValue, question: Question) -> JsResult<Option<Answer>> {
        let host = host_in(owner);
        Ok(Some(match (question, fields::window(host)) {
            (Question::Navigate { wish }, _) => {
                return host.leave_for(wish.url.as_bytes()).map(|()| None);
            }
            (Question::Open { wish, features, .. }, _) => {
                Answer::Open(host.open(&wish.url, &features)?)
            }
            (Question::CreateGuest { frame, scale }, _) => {
                let guest = Root::new(Controls::create(owner, frame, scale)?);
                host.guests.borrow_mut().push((frame, guest));
                return Ok(None);
            }
            (Question::Guest { frame, message }, _) => {
                return host.tell_guest(frame, message).map(|()| None);
            }
            (Question::IsOfApp { url }, _) => Answer::IsOfApp(is_of_app(url.as_bytes())?),
            (Question::Permission { .. }, _) => Answer::Permission("granted".into()),
            (Question::Environment {}, None) if host.is_overlay => {
                Answer::Environment(Box::new(Environment {
                    is_dark: theme::is_dark()?,
                    is_transparent: true,
                    ..Environment::default()
                }))
            }
            (_, None) => return Ok(None),
            (Question::Environment {}, Some(window)) => {
                Answer::Environment(environment_of(window)?.into())
            }
            (Question::HasWebEngine {}, _) => Answer::HasWebEngine(true),
            (Question::Locale {}, _) => Answer::Locale(Some(app::locale()?.into())),
            (Question::HasSpellChecker {}, _) => Answer::HasSpellChecker(IS_MAC),
            (Question::ChecksSpelling {}, _) => Answer::ChecksSpelling(true),
            (Question::StorageDirectory {}, _) => {
                Answer::StorageDirectory(Some(paths::path("userData")?))
            }
            (Question::Dialog { kind, message, .. }, Some(window)) => Answer::Dialog(match kind {
                DialogKind::Prompt => host::DialogAnswer::Unsupported,
                _ if dialog::confirm(window, &message, kind == DialogKind::Confirm)? => {
                    host::DialogAnswer::Accepted
                }
                _ => host::DialogAnswer::Dismissed,
            }),
            (Question::Close {}, Some(window)) => {
                let window = Root::new(window);
                later::soon(move |_| match window.get().is_destroyed() {
                    true => Ok(()),
                    false => window.get().request_close(),
                });
                return Ok(None);
            }
            (question, Some(window)) => return obey(window, question),
        }))
    }

    fn request(&self, owner: JSValue, question: Question, reply: Reply<Option<Answer>>) {
        let Question::PickFiles { choice } = question else {
            let answer = self.answer(owner, question);
            let answer = answer.map_err(|it| task::report(Err(it))).ok();
            return reply(global(), answer.flatten());
        };
        let shown = task::outcome(host_in(owner).pick_files(&choice));
        task::spawn(async {
            let paths = shown.await.map_err(|it| task::throw(&it));
            let paths = paths.and_then(|it| texts_of(it.get()));
            let paths = task::or_warning(paths);
            reply(global(), Some(Answer::PickFiles(paths)));
        });
    }
}

state!(fn is_session_of_frames_confined() -> Cell<bool>);

fn session_of_frames() -> JsResult<&'static Session> {
    let session = session::from_partition("frames")?;
    if !is_session_of_frames_confined().replace(true) {
        let deny = procedure(|given| call(argument(given, 2), &[JSValue::FALSE]).map(drop))?;
        session.handle_with(
            "setPermissionRequestHandler",
            Some(deny),
            JSValue::UNDEFINED,
        )?;
        let deny = function(JSValue::FALSE, |answer, _| Ok(answer))?;
        session.handle_with("setPermissionCheckHandler", Some(deny), JSValue::UNDEFINED)?;
        let prevent =
            procedure(|given| invoke(argument(given, 0), "preventDefault", &[]).map(drop))?;
        invoke(session.to_js(), "on", &[js("will-download")?, prevent])?;
    }
    Ok(session)
}

impl Holder for PageHost {
    fn window(&self) -> Option<&'static Window> {
        cast(fields::window(self)?.to_js())
    }

    fn is_visible(&self) -> JsResult<bool> {
        fields::window(self).map_or(Ok(false), |it| it.is_on_screen())
    }

    fn surface_of_window(&self) -> u32 {
        self.surface.get()
    }

    fn preferences(&self) -> JSValue {
        JSValue::create_empty_object(global(), 0)
    }

    fn open(&self, _: &Remote, details: JSValue) -> JsResult<Option<&'static Remote>> {
        self.navigate_from(&text_of(get(details, "url")?)?, JSValue::UNDEFINED)
            .map(|()| None)
    }

    fn navigate_from(&self, url: &str, _: JSValue) -> JsResult<()> {
        self.leave_for(url.as_bytes())
    }
}

impl Embedder for PageHost {
    fn holder(&self) -> JSValue {
        self.to_js()
    }

    fn web_contents(&self) -> JsResult<JSValue> {
        let emit = listener(self, |it, given| {
            match text_of(argument(given, 0))? == "context-menu" {
                true => it.with_window(|it| invoke(it.to_js(), "emit", given).map(drop)),
                false => Ok(()),
            }
        })?;
        Ok(object!({ "session": session_of_frames()?.to_js(), "emit": emit }))
    }

    fn frame(&self) -> JsResult<JSValue> {
        Ok(object!({ "url": self.url()?, "origin": self.origin()?, "parent": JSValue::NULL }))
    }

    fn url(&self) -> JsResult<String> {
        fields::window(self).map_or_else(|| Ok("about:blank".to_owned()), DesktopWindow::url)
    }

    fn origin(&self) -> JsResult<String> {
        self.url().map(|it| text::origin_of(&it))
    }

    fn log_error(&self, message: &str) -> JsResult<()> {
        warn(message)
    }

    fn id(&self) -> u32 {
        self.page
    }

    fn tell_element(&self, number: u32, news: News) -> JsResult<()> {
        tell_page(self.page, |it| it.tell_frame(number, news))
    }
}

unsafe extern "C" {
    safe fn Bun__Desktop__becomeWindow(global: &JSGlobalObject) -> JSValue;
}

impl PageHost {
    pub(crate) fn create_page(&self, is_first: bool, markup: &str) -> JsResult<JSValue> {
        let surface = self.surface.get();
        let host = NativeHost::create(heap(), &OfProgram, self.to_js());
        let opening = Opening {
            page: self.page,
            surface,
            font_scope: is_first.then_some(i32::MAX as u32),
            // SAFETY: the window holds it.
            ..Opening::new(unsafe { Host::of(host) }, host)
        };
        let page = from_js_host_call(global(), || {
            let window = is_first.then(|| Bun__Desktop__becomeWindow(global()));
            dom::open_page(global(), opening, window.filter(|it| !it.is_empty()))
        })?;
        invoke(page, "parseHTML", &[js(markup)?]).map(|_| page)
    }
}

const EMPTY: &str = "<!doctype html>";

state!(fn unshown() -> RefCell<Option<(Strong, Root<PageHost>)>>);

/// The page of the global object. The first window that is asked for shows it.
pub(crate) fn first_page() -> JsResult<JSValue> {
    let host = PageHost::create(0, false);

    let page = host.create_page(true, EMPTY)?;
    unshown().replace(Some((keep(page), Root::new(host))));
    Ok(page)
}

pub(crate) fn page_for(window: &DesktopWindow, may_be_first: bool) -> JsResult<JSValue> {
    let Some((page, host)) = unshown().borrow_mut().take_if(|_| may_be_first) else {
        let host = PageHost::create(0, false);
        host.show_in(window);
        return host.create_page(false, EMPTY);
    };
    host.get().show_in(window);
    invoke(page.get(), "attach", &[js(window.surface.get())?]).map(|_| page.get())
}

pub(crate) fn send_input_event_for_testing(
    _: Cx<'_, '_>,
    window: u32,
    event: &InputInit,
) -> JsResult<()> {
    crate::window::synthesize(window, event)
}
