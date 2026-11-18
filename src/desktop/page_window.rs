//! `Window`, which shows a document of the app's own realm.

use bun_jsc::{JSPromise, JSString};
use bun_sys::{Fd, File};
use bun_ui::dom::{Change, Document};
use bun_ui::protocol::SurfaceCommand;
use bun_ui::surfaces;
use bun_web::trust;
use bun_web::url::Url;

use crate::generated_bindgen::base::DesktopRectangle;
use crate::generated_bindgen::window::{
    DesktopWindow, WindowInit, js_DesktopBaseWindow as fields, js_DesktopWindow,
};
use crate::prelude::*;
use crate::window::{self, Plan, Window};
use crate::{app, files, page_host};

const DEFAULT_STYLE: &str = "@layer{:root{color-scheme:light dark;font:14px system-ui;cursor:default;user-select:none}body{margin:0}}";

state!(fn loaded_from() -> RefCell<Vec<Url>>);

pub(crate) fn is_of_app(url: &[u8]) -> JsResult<bool> {
    let app_path = app::path()?.as_bytes();
    Ok(
        Url::parse(url).is_some_and(|it| trust::is_trusted(&it, app_path))
            || (loaded_from().borrow().iter()).any(|it| url.starts_with(it.href())),
    )
}

macro_rules! edits {
    ($($name:ident: $command:literal),*) => {$(
        pub(crate) fn $name(&self, _: Cx<'_, '_>) -> JsResult<()> {
            self.edit($command)
        }
    )*};
}

impl DesktopWindow {
    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        options: &WindowInit<'a>,
    ) -> JsResult<&'a Self> {
        let key = options.key.to_js();
        for known in window::all() {
            if let (Some(other), Some(known)) =
                (fields::key(known.get()), cast::<Self>(known.get().to_js()))
                && other.is_strict_equal(key, global())?
            {
                invoke(known.to_js(), "removeAllListeners", &[])?;
                return Ok(Self::from_js(&cx.heap, known.to_js()).expect("it is one"));
            }
        }
        Self::open_as_asked(&cx.heap, structure, options)
    }

    pub(crate) fn open_as_asked<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        options: &WindowInit<'a>,
    ) -> JsResult<&'a Self> {
        let window = Window::open_as_asked(options, structure, heap)?;
        if !options.key.to_js().is_undefined() {
            fields::set_key(window, options.key.to_js());
        }
        window.create_page(true)?;
        window.announce_creation()?;
        Ok(window)
    }

    pub(crate) fn open_internal(plan: Plan<'_>) -> JsResult<&'static Self> {
        let window = Window::open(plan, |it| js_DesktopWindow::create(heap(), it))?;
        window.create_page(false)?;
        Ok(window)
    }

    fn create_page(&self, may_be_global: bool) -> JsResult<()> {
        let id = surfaces::next_id();
        self.surface.set(id);
        let command = SurfaceCommand::Create {
            size: Size::default(),
            scale: 1.,
            is_focusable: true,
        };
        tell(Command::Surface { id, command })?;
        self.fit_page()?;
        let command = SurfaceCommand::Attach {
            window: self.get_id(),
            index: Maybe::Yes(0),
        };
        tell(Command::Surface { id, command })?;
        let page = page_host::page_for(self, may_be_global)?;
        fields::set_page(self, page);
        fields::set_default_style(self, invoke(page, "insertCSS", &[js(DEFAULT_STYLE)?])?);
        page_host::send_input_to(page, id)
    }

    pub(crate) fn page(&self) -> JSValue {
        fields::page(self).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn url(&self) -> JsResult<String> {
        text_of(get(get(self.page(), "document")?, "URL")?)
    }

    /// For a window that is not of the app.
    pub(crate) fn fill(&self, style: &str, markup: &str) -> JsResult<Document> {
        invoke(self.page(), "insertCSS", &[js(style)?])?;
        let document = Document(get(self.page(), "document")?);
        document.change(&[], Change::ReplaceMarkup(markup))?;
        Ok(document)
    }

    pub(crate) fn edit(&self, command: &str) -> JsResult<()> {
        invoke(self.page(), "edit", &[js(command)?]).map(drop)
    }

    pub(crate) fn change_zoom(&self, factor: f64) -> JsResult<()> {
        if factor.is_nan() || factor <= 0. {
            return Err(invalid_value(
                "factor",
                &factor.to_string(),
                "must be greater than 0",
            ));
        }
        self.zoom.set(factor);
        self.tell_page()
    }

    fn check(&self) -> JsResult<()> {
        self.bounds().map(drop)
    }

    pub(crate) fn global_object(&self) -> JsResult<JSValue> {
        get(self.page(), "window")
    }

    pub(crate) fn get_window(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.global_object()
    }

    pub(crate) fn get_document(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        get(self.page(), "document")
    }

    pub(crate) fn render<'a>(&self, _: Cx<'a, '_>, content: JsLocal<'a>) -> JsResult<JSValue> {
        self.check()?;
        let document = Document(get(self.page(), "document")?);
        let root = document.render(fields::renderer(self), content.to_js(), self.to_js())?;
        fields::set_renderer(self, root);
        Ok(self.to_js())
    }

    pub(crate) fn load_html<'a>(
        &self,
        _: Cx<'a, '_>,
        html: &[u8],
        url: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let url = Some(url.to_js()).filter(|it| !it.is_undefined());
        self.load(html, url.map(text_of).transpose()?.as_deref())
    }

    fn load(&self, html: &[u8], url: Option<&str>) -> JsResult<JSValue> {
        self.check()?;
        if let Some(renderer) = fields::renderer(self) {
            invoke(renderer, "unmount", &[])?;
            fields::set_renderer(self, JSValue::ZERO);
        }
        invoke(
            self.page(),
            "removeInsertedCSS",
            &[fields::default_style(self).unwrap_or(JSValue::UNDEFINED)],
        )?;
        if let Some(url) = url {
            let url = Url::parse(url.as_bytes())
                .ok_or_else(|| type_error(format_args!("Invalid URL")))?;
            invoke(self.page(), "setUrl", &[js(string(url.href()))?])?;
        }
        let url = self.url()?;
        let directory = (Url::parse(url.as_bytes()))
            .filter(|it| it.scheme() == b"file")
            .and_then(|it| it.join(b"."));
        let mut directories = loaded_from().borrow_mut();
        if let Some(directory) = directory.filter(|it| !directories.contains(it)) {
            bun_web::net::schemes::may_ask_for_file(&directory, true);
            directories.push(directory);
        }
        drop(directories);
        let promise = JSPromise::create(global()).to_js();
        let resolve = function(promise, |promise, _| {
            let promise = promise.as_any_promise().expect("it is one");
            promise.resolve(global(), JSValue::UNDEFINED)?;
            Ok(JSValue::UNDEFINED)
        })?;
        invoke(self.to_js(), "once", &[js("did-finish-load")?, resolve])?;
        invoke(self.page(), "loadHTML", &[js(string(html))?])?;
        Ok(promise)
    }

    pub(crate) fn load_file<'a>(&self, _: Cx<'a, '_>, file: JsLocal<'a>) -> JsResult<JSValue> {
        let given = text_of(file.to_js())?;
        let url = match file.to_js().is_string() {
            true => files::to_url(&files::absolute(&given)),
            false => given,
        };
        let (path, window) = (files::from_url(&url), Root::new(self));
        let loaded = Deferred::new();
        let promise = loaded.promise();
        in_background(
            move || File::read_from(Fd::cwd(), path.as_bytes()),
            move |html| {
                let html = files::or_throw(html);
                loaded.settle(html.and_then(|it| window.get().load(&it, Some(&url))))
            },
        );
        Ok(promise)
    }

    pub(crate) fn insert_css<'a>(
        &self,
        _: Cx<'a, '_>,
        css: JsLocal<'a, JSString>,
    ) -> JsResult<JSValue> {
        invoke(self.page(), "insertCSS", &[css.to_js()])
    }

    pub(crate) fn remove_inserted_css<'a>(&self, _: Cx<'a, '_>, key: JsLocal<'a>) -> JsResult<()> {
        invoke(self.page(), "removeInsertedCSS", &[key.to_js()]).map(drop)
    }

    pub(crate) fn find_in_page<'a>(
        &self,
        _: Cx<'a, '_>,
        text: JsLocal<'a, JSString>,
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        invoke(self.page(), "find", &[text.to_js(), options.to_js()])
    }

    pub(crate) fn stop_find_in_page<'a>(&self, _: Cx<'a, '_>, action: JsLocal<'a>) -> JsResult<()> {
        invoke(self.page(), "stopFind", &[action.to_js()]).map(drop)
    }

    /// What the window shows, once it is up to date.
    pub(crate) fn capture_page(
        &self,
        _: Cx<'_, '_>,
        part: Option<&DesktopRectangle>,
    ) -> JsResult<JSValue> {
        invoke(self.page(), "flushCanvases", &[])?;
        page_host::render_now(self.page())?;
        let part = part.and_then(DesktopRectangle::if_complete);
        let pixels = answer((ui()?.capture)(self.surface.get(), part.into()))?;
        Ok(NativeImage::from_pixels(pixels).to_js(global()))
    }

    pub(crate) fn get_zoom_factor(&self) -> f64 {
        self.zoom.get()
    }

    pub(crate) fn set_zoom_factor(&self, _: Cx<'_, '_>, factor: f64) -> JsResult<()> {
        self.change_zoom(factor)
    }

    pub(crate) fn get_selected_text(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        invoke(self.page(), "selectionText", &[])
    }

    edits!(
        cut: "cut",
        copy: "copy",
        paste: "paste",
        paste_and_match_style: "pasteAndMatchStyle",
        select_all: "selectAll",
        undo: "undo",
        redo: "redo"
    );
}
