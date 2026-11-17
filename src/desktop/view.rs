//! `View`, and the classes that extend it.

use bun_ui::protocol::SurfaceCommand as To;
use bun_ui::surfaces;

use crate::contents::{Contents, Kind};
use crate::generated_bindgen::base::DesktopRectangle;
use crate::generated_bindgen::window::{
    AutoResizeOptions, ContentsViewInit, DesktopBrowserView, DesktopImageView,
    DesktopWebContentsView, js_DesktopView as fields, js_DesktopWebContentsView,
};
use crate::prelude::*;
use crate::window::{Window, electron_color};

#[derive(Clone, Copy, PartialEq)]
struct Placement {
    surface: u32,
    bounds: Rect,
    is_visible: bool,
    radius: f32,
}

/// Which lengths follow the size of the parent, and the bounds that both had when that was asked for.
#[derive(Clone, Copy)]
struct AutoResize {
    width: bool,
    height: bool,
    horizontal: bool,
    vertical: bool,
    own: Rect,
    of_parent: Rect,
}

#[derive(Default)]
pub(crate) struct View {
    bounds: Cell<Rect>,
    is_hidden: Cell<bool>,
    radius: Cell<f32>,
    surface: Cell<u32>,
    owns_surface: Cell<bool>,
    placed: Cell<Option<Placement>>,
    auto_resize: Cell<Option<AutoResize>>,
}

impl Drop for View {
    fn drop(&mut self) {
        if let (true, Some(ui)) = (self.owns_surface.get(), bun_ui::loaded()) {
            (ui.tell)(Command::Surface {
                id: self.surface.get(),
                command: To::Destroy,
            });
        }
    }
}

impl View {
    pub(crate) fn create() -> &'static View {
        fields::create(heap(), View::default())
    }

    pub(crate) fn constructor() -> View {
        View::default()
    }

    fn tell(&self, command: To) -> JsResult<()> {
        tell(Command::Surface {
            id: self.surface.get(),
            command,
        })
    }

    fn children(&self) -> impl Iterator<Item = JsResult<&'static View>> {
        fields::children(self).into_iter().flat_map(instances)
    }

    fn change_children(&self, change: impl FnOnce(&mut Vec<JSValue>)) -> JsResult<()> {
        let mut all = self
            .children()
            .map(|it| it.map(View::to_js))
            .collect::<JsResult<_>>()?;
        change(&mut all);
        fields::set_children(self, array(&all)?);
        Ok(())
    }

    fn lineage(&self) -> impl Iterator<Item = &View> {
        core::iter::successors(Some(self), |it| fields::parent(it))
    }

    pub(crate) fn set_root(&self, window: Option<&Window>) {
        fields::set_root(self, window);
    }

    pub(crate) fn window(&self) -> Option<&Window> {
        self.lineage().find_map(fields::root)
    }

    pub(crate) fn contents(&self) -> Option<JSValue> {
        fields::contents(self)
    }

    pub(crate) fn is_drawn(&self) -> bool {
        self.lineage().all(|it| !it.is_hidden.get())
    }

    fn origin(&self) -> Point {
        let top = self
            .lineage()
            .last()
            .and_then(fields::root)
            .map_or(0., |it| it.content().y);
        let Point { x, y } = self.origin_in_content();
        Point { x, y: y + top }
    }

    pub(crate) fn origin_in_content(&self) -> Point {
        let add = |sum: Point, it: &View| Point {
            x: sum.x + it.bounds.get().x,
            y: sum.y + it.bounds.get().y,
        };
        self.lineage().fold(Point { x: 0., y: 0. }, add)
    }

    pub(crate) fn titlebar_area(&self) -> JsResult<Option<Rect>> {
        let (area, origin) = (
            self.window()
                .map(Window::titlebar_area)
                .transpose()?
                .flatten(),
            self.origin(),
        );
        Ok(area.map(|it| Rect {
            x: it.x - origin.x,
            y: it.y - origin.y,
            ..it
        }))
    }

    /// The contents are gone.
    pub(crate) fn release(&self) -> JsResult<()> {
        self.show_in(None, 0)?;
        self.surface.set(0);
        Ok(())
    }

    /// Puts the surfaces of the tree in `window`, in the order in which they are painted. Returns the next index.
    pub(crate) fn arrange(&self, window: Option<&Window>, index: u32) -> JsResult<u32> {
        let next = index + u32::from(self.show_in(window, index)?);
        self.children()
            .try_fold(next, |index, child| child?.arrange(window, index))
    }

    fn show_in(&self, window: Option<&Window>, index: u32) -> JsResult<bool> {
        if self.surface.get() == 0 {
            return Ok(false);
        }
        if fields::shown_in(self)
            .is_some_and(|it| !it.is_destroyed() && !window.is_some_and(|other| same(it, other)))
        {
            self.tell(To::Detach)?;
        }
        fields::set_shown_in(self, window);
        self.place()?;
        if let Some(window) = window {
            window.attach(self.surface.get(), index)?;
        }
        self.changed()?;
        Ok(true)
    }

    fn place(&self) -> JsResult<()> {
        let (surface, Point { x, y }) = (self.surface.get(), self.origin());
        let (bounds, is_visible, radius) = (
            Rect {
                x,
                y,
                ..self.bounds.get()
            },
            self.is_drawn(),
            self.radius.get(),
        );
        let placement = Some(Placement {
            surface,
            bounds,
            is_visible,
            radius,
        });
        if surface == 0 || self.placed.replace(placement) == placement {
            return Ok(());
        }
        self.tell(To::Place {
            bounds,
            is_visible,
            radius,
        })
    }

    fn place_tree(&self) -> JsResult<()> {
        self.place()?;
        self.changed()?;
        self.children().try_for_each(|it| it?.place_tree())
    }

    fn changed(&self) -> JsResult<()> {
        self.contents()
            .and_then(cast)
            .map_or(Ok(()), Contents::environment_changed)
    }

    pub(crate) fn tree_changed(&self) -> JsResult<()> {
        self.changed()?;
        self.children().try_for_each(|it| it?.tree_changed())
    }

    fn rearrange(&self) -> JsResult<()> {
        self.window().map_or(Ok(()), Window::arrange_views)
    }

    pub(crate) fn add(&self, view: &View, index: Option<usize>) -> JsResult<()> {
        if self.lineage().any(|it| same(it, view)) {
            return Err(error(format_args!(
                "A view cannot be added as its own child"
            )));
        }
        if let Some(parent) = fields::parent(view) {
            parent.change_children(|all| all.retain(|it| *it != view.to_js()))?;
        }
        fields::set_parent(view, Some(self));
        self.change_children(|all| {
            all.insert(index.unwrap_or(usize::MAX).min(all.len()), view.to_js())
        })?;
        match self.window() {
            Some(window) => window.arrange_views(),
            None => view.arrange(None, 0).map(drop),
        }
    }

    pub(crate) fn remove(&self, view: &View) -> JsResult<()> {
        if !fields::parent(view).is_some_and(|it| same(it, self)) {
            return Ok(());
        }
        self.change_children(|all| all.retain(|it| *it != view.to_js()))?;
        fields::set_parent(view, None);
        view.arrange(None, 0).map(drop)
    }

    pub(crate) fn change_bounds(&self, bounds: Rect) -> JsResult<()> {
        if self.bounds.replace(bounds) == bounds {
            return Ok(());
        }
        self.place_tree()?;
        self.children().try_for_each(|it| it?.follow(bounds))?;
        announce(self.to_js(), "bounds-changed", &[])
    }

    fn follow(&self, parent: Rect) -> JsResult<()> {
        let Some(AutoResize {
            own,
            of_parent,
            width,
            height,
            horizontal,
            vertical,
        }) = self.auto_resize.get()
        else {
            return Ok(());
        };
        let along =
            |start: f32, length: f32, before: f32, now: f32, grows, scales| match (scales, grows) {
                (true, _) if before > 0. => [start, length].map(|it| (it * now / before).round()),
                (_, true) => [start, (length + now - before).max(0.)],
                _ => [start, length],
            };
        let [x, width] = along(
            own.x,
            own.width,
            of_parent.width,
            parent.width,
            width,
            horizontal,
        );
        let [y, height] = along(
            own.y,
            own.height,
            of_parent.height,
            parent.height,
            height,
            vertical,
        );
        self.change_bounds(Rect {
            x,
            y,
            width,
            height,
        })
    }

    fn need_surface(&self) -> JsResult<()> {
        if self.surface.get() != 0 || self.contents().is_some() {
            return Ok(());
        }
        self.surface.set(surfaces::next_id());
        self.owns_surface.set(true);
        self.tell(To::Create {
            size: Size::default(),
            scale: 1.,
            is_focusable: true,
        })?;
        self.tell(To::Passthrough(true))?;
        self.rearrange()
    }

    pub(crate) fn change_background_color(&self, color: u32) -> JsResult<()> {
        self.need_surface()?;
        if self.surface.get() != 0 {
            self.tell(To::Background(color))?;
        }
        (self.contents().and_then(cast::<Contents>))
            .map_or(Ok(()), |it| it.change_background(color))
    }

    fn show_contents(&self, contents: JSValue, preferences: JSValue, kind: Kind) -> JsResult<()> {
        let contents = cast(contents).map_or_else(|| Contents::create(preferences, kind), Ok)?;
        contents.show_in(self, kind)?;
        fields::set_contents(self, contents.to_js());
        self.surface.set(contents.surface());
        if kind != Kind::Window && !contents.is_transparent() {
            self.change_background_color(u32::MAX)?;
        }
        Ok(())
    }

    pub(crate) fn for_window(contents: JSValue, preferences: JSValue) -> JsResult<&'static View> {
        let view = js_DesktopWebContentsView::create(heap(), View::default());
        view.show_contents(contents, preferences, Kind::Window)?;
        Ok(view)
    }

    pub(crate) fn get_children(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        array(
            &self
                .children()
                .map(|it| it.map(View::to_js))
                .collect::<JsResult<Vec<_>>>()?,
        )
    }

    pub(crate) fn add_child_view<'a>(
        &self,
        _: Cx<'a, '_>,
        view: JsLocal<'a>,
        index: Option<f64>,
    ) -> JsResult<()> {
        let view = cast(view.to_js()).ok_or_else(|| {
            type_error(format_args!(
                "Error processing argument at index 0, conversion failure from "
            ))
        })?;
        self.add(view, index.map(|it| it as usize))
    }

    pub(crate) fn remove_child_view<'a>(&self, _: Cx<'a, '_>, view: JsLocal<'a>) -> JsResult<()> {
        cast(view.to_js()).map_or(Ok(()), |it| self.remove(it))
    }

    pub(crate) fn set_bounds(&self, _: Cx<'_, '_>, bounds: &DesktopRectangle) -> JsResult<()> {
        let own = bounds.or(Rect::default());
        if let (Some(rule), Some(parent)) = (self.auto_resize.get(), fields::parent(self)) {
            self.auto_resize.set(Some(AutoResize {
                own,
                of_parent: parent.bounds.get(),
                ..rule
            }));
        }
        self.change_bounds(own)
    }

    pub(crate) fn get_bounds(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(self.bounds.get())
    }

    pub(crate) fn set_background_color(&self, _: Cx<'_, '_>, color: &[u8]) -> JsResult<()> {
        self.change_background_color(electron_color(color))
    }

    pub(crate) fn set_background_blur(&self) {}

    pub(crate) fn set_border_radius(&self, _: Cx<'_, '_>, radius: f64) -> JsResult<()> {
        self.radius.set(finite(radius));
        self.place()
    }

    pub(crate) fn set_visible(&self, _: Cx<'_, '_>, is_visible: bool) -> JsResult<()> {
        self.is_hidden.set(!is_visible);
        self.place_tree()
    }

    pub(crate) fn get_visible(&self) -> bool {
        !self.is_hidden.get()
    }
}

fn with_contents<'a, T>(
    cx: Cx<'a, '_>,
    structure: ClassStructure<'a, T>,
    options: &ContentsViewInit<'a>,
) -> JsResult<&'a T>
where
    T: JsInterface<Struct = View> + core::ops::Deref,
{
    let created = structure.create(&cx.heap, View::default());
    let view: &View = cast(created.to_js()).expect("it extends View");
    view.show_contents(
        options.web_contents.to_js(),
        options.web_preferences.to_js(),
        Kind::BrowserView,
    )?;
    Ok(created)
}

impl DesktopWebContentsView {
    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        options: &ContentsViewInit<'a>,
    ) -> JsResult<&'a Self> {
        with_contents(cx, structure, options)
    }

    pub(crate) fn get_web_contents(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let contents = self.contents().and_then(cast::<Contents>);
        Ok(contents
            .filter(|it| !it.is_gone())
            .map_or(JSValue::UNDEFINED, JsInterface::to_js))
    }
}

impl DesktopBrowserView {
    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        options: &ContentsViewInit<'a>,
    ) -> JsResult<&'a Self> {
        with_contents(cx, structure, options)
    }

    pub(crate) fn set_auto_resize(
        &self,
        _: Cx<'_, '_>,
        options: &AutoResizeOptions,
    ) -> JsResult<()> {
        let &AutoResizeOptions {
            width,
            height,
            horizontal,
            vertical,
        } = options;
        let (own, of_parent) = (
            self.bounds.get(),
            fields::parent(self)
                .map(|it| it.bounds.get())
                .unwrap_or_default(),
        );
        self.auto_resize.set(Some(AutoResize {
            width,
            height,
            horizontal,
            vertical,
            own,
            of_parent,
        }));
        Ok(())
    }
}

impl DesktopImageView {
    pub(crate) fn constructor() -> View {
        View::default()
    }

    pub(crate) fn set_image<'a>(&self, _: Cx<'a, '_>, _: JsLocal<'a>) -> JsResult<()> {
        Err(unsupported("ImageView"))
    }
}
