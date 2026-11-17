//! `BrowserWindow`

use crate::app;
use crate::generated_bindgen::window::{
    DesktopBrowserWindow, WindowInit, js_DesktopBaseWindow as fields,
};
use crate::prelude::*;
use crate::view::View;
use crate::window::{self, Window};

macro_rules! forwarded {
    ($($name:ident: $method:literal),*) => {$(
        pub(crate) fn $name<'a>(&self, _: Cx<'a, '_>, arguments: &[JsLocal<'a>]) -> JsResult<JSValue> {
            invoke(self.contents(), $method, JsLocal::to_js_slice(arguments))
        }
    )*};
}

impl DesktopBrowserWindow {
    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        options: &WindowInit<'a>,
    ) -> JsResult<&'a Self> {
        let window = Window::open_as_asked(options, structure, &cx.heap)?;
        let view = View::for_window(
            options.web_contents.to_js(),
            options.web_preferences.to_js(),
        )?;
        let contents = view.contents().unwrap_or(JSValue::UNDEFINED);
        fields::set_contents(window, contents);
        fields::set_contents_view(window, Some(view));
        view.change_background_color(window.background_color.get())?;
        window.show_view(view)?;
        window.follow(contents)?;
        window.announce_creation()?;
        if window.is_on_screen()? {
            invoke(contents, "focus", &[])?;
        }
        announce(app::object(), "browser-window-created", &[window.to_js()])?;
        Ok(window)
    }

    fn follow(&self, contents: JSValue) -> JsResult<()> {
        let title_changed = listener(self, |window, arguments| {
            let title = argument(arguments, 1);
            if !window.is_destroyed()
                && dispatch(
                    window.to_js(),
                    "page-title-updated",
                    &[title, argument(arguments, 2)],
                )?
            {
                window.change_title(text_of(title)?)?;
            }
            Ok(())
        })?;
        invoke(contents, "on", &[js("page-title-updated")?, title_changed])?;
        let painted = listener(self, |window, _| match window.is_destroyed() {
            true => Ok(()),
            false => announce(window.to_js(), "ready-to-show", &[]),
        })?;
        invoke(contents, "once", &[js("ready-to-show")?, painted])?;
        invoke(
            contents,
            "once",
            &[
                js("destroyed")?,
                listener(self, |window, _| window.destroy_now())?,
            ],
        )
        .map(drop)
    }

    fn contents(&self) -> JSValue {
        fields::contents(self).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn unload_soon(&self) {
        let window = Root::new(self);
        post(Priority::Host, move || {
            invoke(
                window.get().contents(),
                "close",
                &[object!({ "waitForBeforeUnload": true })],
            )
            .map(drop)
        });
    }

    pub(crate) fn get_all_windows(_: Cx<'_, '_>) -> JsResult<JSValue> {
        window::all_of::<Self>()
    }

    pub(crate) fn get_focused_window(_: &JsHeap<'_>) -> JSValue {
        window::if_it_is::<Self>(window::focused())
    }

    pub(crate) fn from_id(_: &JsHeap<'_>, id: Option<f64>) -> JSValue {
        window::if_it_is::<Self>(id.and_then(|it| window::with_id(it as u32)))
    }

    pub(crate) fn from_web_contents<'a>(_: Cx<'a, '_>, contents: JsLocal<'a>) -> JsResult<JSValue> {
        Ok(window::if_it_is::<Self>(cast(invoke(
            contents.to_js(),
            "getOwnerBrowserWindow",
            &[],
        )?)))
    }

    pub(crate) fn from_browser_view(_: &JsHeap<'_>, view: &View) -> JSValue {
        window::if_it_is::<Self>(view.window())
    }

    forwarded!(
        load_url: "loadURL",
        load_file: "loadFile",
        reload: "reload",
        capture_page: "capturePage",
        show_definition_for_selection: "showDefinitionForSelection"
    );

    pub(crate) fn blur_web_view(&self) {}

    pub(crate) fn focus_on_web_view(&self, _: Cx<'_, '_>) -> JsResult<()> {
        invoke(self.contents(), "focus", &[]).map(drop)
    }

    fn browser_views(&self) -> impl Iterator<Item = JsResult<&'static View>> {
        fields::browser_views(self).into_iter().flat_map(instances)
    }

    fn browser_views_but(&self, view: Option<&View>) -> JsResult<Vec<JSValue>> {
        let mut all: Vec<JSValue> = self
            .browser_views()
            .map(|it| it.map(View::to_js))
            .collect::<JsResult<_>>()?;
        all.retain(|it| Some(*it) != view.map(View::to_js));
        Ok(all)
    }

    pub(crate) fn add_browser_view(&self, _: Cx<'_, '_>, view: &View) -> JsResult<()> {
        let mut all = self.browser_views_but(Some(view))?;
        all.push(view.to_js());
        fields::set_browser_views(self, array(&all)?);
        self.content_view()?.add(view, None)
    }

    pub(crate) fn remove_browser_view(&self, _: Cx<'_, '_>, view: &View) -> JsResult<()> {
        fields::set_browser_views(self, array(&self.browser_views_but(Some(view))?)?);
        self.content_view()?.remove(view)
    }

    pub(crate) fn set_browser_view(&self, cx: Cx<'_, '_>, view: Option<&View>) -> JsResult<()> {
        while let Some(other) = self.browser_views().next().transpose()? {
            self.remove_browser_view(cx, other)?;
        }
        view.map_or(Ok(()), |it| self.add_browser_view(cx, it))
    }

    pub(crate) fn get_browser_views(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        array(&self.browser_views_but(None)?)
    }

    pub(crate) fn get_browser_view(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(self
            .browser_views()
            .next()
            .transpose()?
            .map_or(JSValue::NULL, View::to_js))
    }
}
