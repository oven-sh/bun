//! `dialog`

use core::fmt::Write as _;
use std::rc::Rc;

use bun_ui::protocol::{
    Event as UiEvent, FileFilter, FilePicker, MessageBox, Reply, Request, SystemRequest,
};
use bun_ui::{dom, queue};

use crate::generated_bindgen::dialog::{
    DesktopDialog, FileDialogInit, MessageBoxInit, js_DesktopDialog,
};
use crate::generated_bindgen::window::DesktopWindow;
use crate::menu::without_mnemonic;
use crate::prelude::*;
use crate::text::{self, escape_html};
use crate::webview::wire;
use crate::window::{self, Plan, Window};
use crate::{app, files, paths, screen};

const WIDTH: f32 = 420.;

state!(fn last_message() -> Cell<u32>);

pub(crate) fn object() -> JSValue {
    js_DesktopDialog::CLASS.constructor(heap())
}

/// The window may be left out.
fn parameters(
    window: JsLocal<'_>,
    options: JsLocal<'_>,
) -> JsResult<(Option<&'static Window>, JSValue)> {
    let parent = cast(window.to_js());
    let given = [
        options.to_js(),
        if parent.is_some() {
            JSValue::UNDEFINED
        } else {
            window.to_js()
        },
    ];
    Ok((
        parent,
        given
            .into_iter()
            .find(|it| !it.is_undefined_or_null())
            .unwrap_or_else(|| object!({})),
    ))
}

fn without_nul(name: &str, value: Option<&[u8]>) -> JsResult<Text> {
    let value = value.unwrap_or_default();
    if bun_core::strings::contains_char(value, 0) {
        return Err(invalid_value(
            name,
            &string(value),
            "must not contain null bytes",
        ));
    }
    Ok(Text::lossy(value))
}

fn needs_display() -> JsResult<()> {
    ui()?;
    match app::has_display()? {
        true => Ok(()),
        false => Err(error(format_args!(
            "There is no display server to show a dialog on"
        ))),
    }
}

fn picker(saves: bool, window: JsLocal<'_>, options: JsLocal<'_>) -> JsResult<Request> {
    let (window, options) = parameters(window, options)?;
    let it = FileDialogInit::from_js(global(), options)?;
    let has = |name: &str| {
        it.properties
            .iter()
            .flatten()
            .any(|it| **it == *name.as_bytes())
    };
    let path = without_nul("defaultPath", it.default_path.as_deref())?;
    let (directory, file_name) = match files::is_directory(&path) {
        true => (Some(&*path), ""),
        false => (files::parent(&path), files::name(&path)),
    };
    needs_display()?;
    let filters = it.filters.iter().flatten().map(|it| {
        let extensions = it
            .extensions
            .iter()
            .map(|it| without_nul("filters.extensions", Some(it)));
        Ok(FileFilter {
            name: without_nul("filters.name", it.name.as_deref())?,
            extensions: extensions.collect::<JsResult<_>>()?,
        })
    });
    let title = it
        .title
        .as_deref()
        .or_else(|| it.message.as_deref().filter(|_| !IS_MAC));
    Ok(Request::System(SystemRequest::PickFiles(FilePicker {
        window: window.map(Window::get_id).into(),
        title: without_nul("title", title)?,
        message: without_nul("message", it.message.as_deref())?,
        button_label: without_nul("buttonLabel", it.button_label.as_deref())?,
        directory: directory
            .filter(|it| !it.is_empty())
            .map(files::absolute)
            .unwrap_or_default()
            .into(),
        file_name: file_name.into(),
        filters: filters.collect::<JsResult<_>>()?,
        saves,
        takes_files: has("openFile") || !has("openDirectory"),
        takes_directories: has("openDirectory"),
        takes_many: has("multiSelections"),
        creates_directories: saves || has("createDirectory"),
        shows_hidden_files: has("showHiddenFiles"),
        keeps_aliases: has("noResolveAliases"),
        enters_packages: has("treatPackageAsDirectory"),
    })))
}

fn paths_in(reply: Reply) -> Vec<Text> {
    match reply {
        Reply::Paths(paths) => paths.into_vec(),
        _ => Vec::new(),
    }
}

struct Message {
    kind: String,
    title: Option<String>,
    message: String,
    detail: String,
    buttons: Vec<String>,
    default_button: i32,
    cancel_button: i32,
    checkbox_label: String,
    is_checked: bool,
}

#[derive(Clone, Copy)]
struct Answer {
    button: i32,
    is_checked: bool,
}

impl IntoJs for Answer {
    fn into_js(self, _: &bun_jsc::JSGlobalObject) -> JsResult<JSValue> {
        Ok(object!({ "response": self.button, "checkboxChecked": self.is_checked }))
    }
}

fn is_native() -> JsResult<bool> {
    Ok((IS_MAC || IS_WINDOWS) && !is_headless()?)
}

fn on_abort(signal: Option<JSValue>, method: &str, listener: JSValue) -> JsResult<()> {
    signal.map_or(Ok(()), |it| {
        invoke(it, method, &[js("abort")?, listener]).map(drop)
    })
}

impl Message {
    fn new(it: &MessageBoxInit<'_>) -> Message {
        let own = |it: &Option<bun_core::Utf8Bytes<'_>>| string(it.as_deref().unwrap_or_default());
        let buttons: Vec<String> = it.buttons.iter().flatten().map(|it| string(it)).collect();
        let cancels =
            |it: &String| it.eq_ignore_ascii_case("cancel") || it.eq_ignore_ascii_case("no");
        Message {
            kind: own(&it.kind),
            title: it.title.as_deref().map(string),
            message: own(&it.message),
            detail: own(&it.detail),
            default_button: it.default_id.unwrap_or(0.) as i32,
            cancel_button: it.cancel_id.map_or_else(
                || buttons.iter().position(cancels).unwrap_or(0) as i32,
                |it| it as i32,
            ),
            buttons: if buttons.is_empty() {
                vec!["OK".into()]
            } else {
                buttons
            },
            checkbox_label: own(&it.checkbox_label),
            is_checked: it.checkbox_checked,
        }
    }

    fn plain(kind: &str, message: String, detail: String) -> Message {
        Message {
            kind: kind.into(),
            title: None,
            message,
            detail,
            buttons: vec!["OK".into()],
            default_button: 0,
            cancel_button: 0,
            checkbox_label: String::new(),
            is_checked: false,
        }
    }

    fn cancelled(&self) -> Answer {
        Answer {
            button: self.cancel_button,
            is_checked: self.is_checked,
        }
    }

    fn into_request(self, id: u32, window: Option<&Window>) -> Request {
        Request::System(SystemRequest::MessageBox(MessageBox {
            id,
            window: window.map(Window::get_id).into(),
            is_grave: matches!(&*self.kind, "error" | "warning"),
            message: self.message.into(),
            detail: self.detail.into(),
            buttons: self.buttons.into_iter().map(Text::from).collect(),
            default_button: self.default_button,
            cancel_button: self.cancel_button,
            checkbox_label: self.checkbox_label.into(),
            is_checked: self.is_checked,
        }))
    }

    /// Where the system has no message box.
    fn draw(
        self,
        parent: Option<&Window>,
        signal: Option<JSValue>,
        done: impl Fn(Answer) -> JsResult<()> + 'static,
    ) -> JsResult<&'static DesktopWindow> {
        let mut plan = Plan::for_message(
            self.title.clone().map_or_else(paths::app_name, Ok)?,
            WIDTH,
            150.,
        );
        (plan.parent, plan.is_modal) = (parent, true);
        let window = DesktopWindow::open_internal(plan)?;
        let answer = Rc::new(Cell::new(self.cancelled()));
        let abort = listener(window, |window, _| window.destroy_now())?;
        on_abort(signal, "addEventListener", abort)?;
        let given = Rc::clone(&answer);
        let closed = function(
            array(&[signal.unwrap_or(JSValue::NULL), abort])?,
            move |captured, _| {
                let [signal, abort] = [0, 1].map(|it| captured.get_index(global(), it));
                on_abort(
                    Some(signal?).filter(|it| !it.is_null()),
                    "removeEventListener",
                    abort?,
                )?;
                done(given.get()).map(|()| JSValue::UNDEFINED)
            },
        )?;
        invoke(window.to_js(), "once", &[js("closed")?, closed])?;
        let height = self.fill(window, answer)?;
        window.tell(bun_ui::protocol::WindowCommand::Size(Size {
            width: WIDTH,
            height,
        }))?;
        window.appear(true)?;
        Ok(window)
    }

    fn markup(&self) -> String {
        let [message, detail, label] =
            [&self.message, &self.detail, &self.checkbox_label].map(|it| escape_html(it));
        let icon = match &*self.kind {
            "info" => "<i>i</i>",
            "question" => "<i>?</i>",
            "warning" => "<i class=warning>!</i>",
            "error" => "<i class=error>!</i>",
            _ => "",
        };
        let mut markup = format!(
            r#"<main role=alertdialog aria-label="{message}">{icon}<div><h1>{message}</h1>"#
        );
        if !detail.is_empty() {
            let _ = write!(markup, "<p>{detail}</p>");
        }
        markup.push_str("</div></main><footer>");
        for button in &self.buttons {
            let button = escape_html(&without_mnemonic(button));
            let _ = write!(markup, "<button>{button}</button>");
        }
        markup.push_str("</footer>");
        if !label.is_empty() {
            let checked = if self.is_checked { " checked" } else { "" };
            let label = format!("<label><input type=checkbox{checked}>{label}</label>");
            markup.insert_str(text::before(&markup, "<footer>").len(), &label);
        }
        markup
    }

    /// Returns the height.
    fn fill(&self, window: &DesktopWindow, answer: Rc<Cell<Answer>>) -> JsResult<f32> {
        let document = window.fill(include_str!("message.css"), &self.markup())?;
        let footer = 1 + usize::from(!self.checkbox_label.is_empty());
        let checked = Rc::clone(&answer);
        let changed = procedure(move |arguments| {
            let is_checked = dom::Event(argument(arguments, 0)).is_target_checked();
            checked.update(|it| Answer { is_checked, ..it });
            Ok(())
        })?;
        let clicked = listener(window, move |window, arguments| {
            match *dom::Event(argument(arguments, 0)).target() {
                [part, button, ..] if part == footer => {
                    let button = button as i32;
                    answer.update(|it| Answer { button, ..it });
                    window.destroy_now()
                }
                _ => Ok(()),
            }
        })?;
        let pressed = listener(window, |window, arguments| {
            match dom::Event(argument(arguments, 0)).key() == "Escape" {
                true => window.destroy_now(),
                false => Ok(()),
            }
        })?;
        document.listen("change", changed)?;
        document.listen("click", clicked)?;
        document.listen("keydown", pressed)?;
        document.change(&[footer, self.default_button as usize], dom::Change::Focus)?;
        Ok(document.bounds(&[]).height.ceil())
    }

    fn show(self, window: Option<&Window>, signal: Option<JSValue>) -> JsResult<JSValue> {
        let cancelled = self.cancelled();
        if signal
            .map(|it| get(it, "aborted"))
            .transpose()?
            .is_some_and(JSValue::to_boolean)
        {
            return resolved(cancelled);
        }
        let result = Deferred::new();
        let promise = result.promise();
        if !is_native()? {
            self.draw(window, signal, move |it| result.resolve(it))?;
            return Ok(promise);
        }
        last_message().update(|it| it + 1);
        let id = last_message().get();
        let close = procedure(move |_| tell_system(SystemCommand::CloseMessageBox(id)))?;
        on_abort(signal, "addEventListener", close)?;
        if let Some(window) = window {
            invoke(window.to_js(), "once", &[js("closed")?, close])?;
            window.sheet_is_shown(true)?;
        }
        let (request, window) = (self.into_request(id, window), window.map(Root::new));
        let (signal, close) = (signal.map(keep), keep(close));
        queue::request(global(), request, move |_, reply| {
            on_abort(
                signal.as_ref().map(|it| it.get()),
                "removeEventListener",
                close.get(),
            )?;
            if let Some(window) = window.as_ref().map(Root::get) {
                invoke(window.to_js(), "off", &[js("closed")?, close.get()])?;
                window.sheet_is_shown(false)?;
            }
            match reply {
                Reply::Failed(reason) => result.settle(Err(error(format_args!("{}", &*reason)))),
                reply => result.resolve(cancelled.unless(&reply)),
            }
        })?;
        Ok(promise)
    }

    fn show_and_wait(self, window: Option<&Window>, signal: Option<JSValue>) -> JsResult<i32> {
        if is_native()? {
            let cancelled = self.cancelled();
            last_message().update(|it| it + 1);
            let reply =
                queue::request_and_wait(global(), self.into_request(last_message().get(), window))?;
            return Ok(cancelled.unless(&reply).button);
        }
        let chosen = Rc::new(Cell::new(None));
        let slot = Rc::clone(&chosen);
        let drawn = self.draw(window, signal, move |it| {
            slot.set(Some(it.button));
            Ok(())
        })?;
        let (window, surface) = (drawn.get_id(), drawn.surface.get());
        queue::wait_until(
            global(),
            &|| Ok(chosen.get().is_some()),
            &|event| match event {
                UiEvent::Window { id, .. } => *id == window,
                UiEvent::Surface { id, .. } => *id == surface,
                _ => false,
            },
        )?;
        Ok(chosen.get().unwrap_or_default())
    }
}

impl Answer {
    fn unless(self, reply: &Reply) -> Answer {
        match *reply {
            Reply::Button { index, is_checked } => Answer {
                button: index.get().map_or(self.button, |it| it as i32),
                is_checked,
            },
            _ => Answer {
                is_checked: false,
                ..self
            },
        }
    }
}

pub(crate) fn inform(message: String, detail: String) -> JsResult<JSValue> {
    Message::plain("", message, detail).show(None, None)
}

/// Whether the answer is OK.
pub(crate) fn confirm(window: &Window, message: &str, can_cancel: bool) -> JsResult<bool> {
    let mut message = Message::plain("", message.into(), String::new());
    if can_cancel {
        message.buttons.push("Cancel".into());
        message.cancel_button = 1;
    }
    Ok(message.show_and_wait(Some(window), None)? == 0)
}

/// A promise for the paths.
pub(crate) fn pick_files(
    window: &Window,
    takes_directories: bool,
    takes_many: bool,
    extensions: &[&[u8]],
) -> JsResult<JSValue> {
    needs_display()?;
    let filter = (!extensions.is_empty()).then(|| FileFilter {
        name: "Files".into(),
        extensions: extensions.iter().map(|it| Text::lossy(it)).collect(),
    });
    let picker = FilePicker {
        window: Maybe::Yes(window.get_id()),
        title: Text::default(),
        message: Text::default(),
        button_label: Text::default(),
        directory: Text::default(),
        file_name: Text::default(),
        filters: filter.into_iter().collect(),
        saves: false,
        takes_files: !takes_directories,
        takes_directories,
        takes_many,
        creates_directories: false,
        shows_hidden_files: false,
        keeps_aliases: false,
        enters_packages: false,
    };
    let request = Request::System(SystemRequest::PickFiles(picker));
    queue::promise_of(global(), request, |_, reply| js(paths_in(reply)))
}

pub(crate) fn print_error(text: &str) {
    bun_core::Output::print_errorln(text);
    bun_core::Output::flush();
}

fn show_error(title: String, content: String) -> JsResult<()> {
    ui()?;
    if !app::has_display()? || is_headless()? {
        print_error(&format!("{title}\n{content}"));
        return Ok(());
    }
    Message::plain("error", title, content)
        .show_and_wait(window::focused(), None)
        .map(drop)
}

/// Below the middle of the screen and without the focus, which a prompt of the system needs.
pub(crate) fn show_note(text: &str) -> JsResult<&'static DesktopWindow> {
    let area = screen::primary_display()?.work_area;
    let mut plan = Plan::for_message(paths::app_name()?, WIDTH, 90.);
    plan.options.x = Maybe::Yes((area.x + (area.width - WIDTH) / 2.).round());
    plan.options.y = Maybe::Yes((area.y + area.height * 0.7).round());
    plan.is_closable = false;
    let window = DesktopWindow::open_internal(plan)?;
    window.fill("body{padding:20px;text-align:center}", &escape_html(text))?;
    window.appear(false)?;
    if IS_MAC {
        window.raise()?;
    }
    Ok(window)
}

impl DesktopDialog {
    pub(crate) fn show_open_dialog<'a>(
        _: Cx<'a, '_>,
        window: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        queue::promise_of(global(), picker(false, window, options)?, |_, reply| {
            let paths = paths_in(reply);
            Ok(object!({ "canceled": paths.is_empty(), "filePaths": paths }))
        })
    }

    pub(crate) fn show_open_dialog_sync<'a>(
        _: Cx<'a, '_>,
        window: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let paths = paths_in(queue::request_and_wait(
            global(),
            picker(false, window, options)?,
        )?);
        if paths.is_empty() {
            Ok(JSValue::UNDEFINED)
        } else {
            js(paths)
        }
    }

    pub(crate) fn show_save_dialog<'a>(
        _: Cx<'a, '_>,
        window: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        queue::promise_of(global(), picker(true, window, options)?, |_, reply| {
            let path = paths_in(reply).into_iter().next();
            Ok(object!({ "canceled": path.is_none(), "filePath": path.unwrap_or_default() }))
        })
    }

    pub(crate) fn show_save_dialog_sync<'a>(
        _: Cx<'a, '_>,
        window: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<Text> {
        let paths = paths_in(queue::request_and_wait(
            global(),
            picker(true, window, options)?,
        )?);
        Ok(paths.into_iter().next().unwrap_or_default())
    }

    pub(crate) fn show_message_box<'a>(
        _: Cx<'a, '_>,
        window: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let (window, options) = parameters(window, options)?;
        MessageBoxInit::from_js(global(), options, |it| {
            Message::new(&it).show(window, it.signal.map(JsLocal::to_js))
        })
    }

    pub(crate) fn show_message_box_sync<'a>(
        _: Cx<'a, '_>,
        window: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<i32> {
        let (window, options) = parameters(window, options)?;
        MessageBoxInit::from_js(global(), options, |it| {
            Message::new(&it).show_and_wait(window, it.signal.map(JsLocal::to_js))
        })
    }

    pub(crate) fn show_error_box(_: Cx<'_, '_>, title: &[u8], content: &[u8]) -> JsResult<()> {
        show_error(string(title), string(content))
    }

    pub(crate) fn show_certificate_trust_dialog<'a>(
        _: Cx<'a, '_>,
        window: JsLocal<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        if !IS_MAC {
            return Err(unsupported("showCertificateTrustDialog"));
        }
        let (window, options) = parameters(window, options)?;
        let options = wire::data_from_js(options)?;
        let chain = core::iter::successors(Some(&options["certificate"]), |it| {
            Some(&it["issuerCert"]).filter(|it| it.is_object())
        });
        let request = SystemRequest::TrustCertificate {
            window: window.map(Window::get_id).into(),
            message: options["message"].text().into(),
            chain: chain
                .flat_map(|it| it["data"].text().bytes().chain(*b"\n"))
                .collect(),
        };
        queue::promise_of(global(), Request::System(request), |_, _| {
            Ok(JSValue::UNDEFINED)
        })
    }
}
