//! `BaseWindow`, which `Window` and `BrowserWindow` extend.

use core::mem::discriminant;
use std::rc::Rc;

use bun_ui::protocol::{
    Background, CoverField, CoverPicture, EffectState, Geometry, Limits, Material, MouseAction,
    Overlay, SHIFT, SurfaceCommand, Synthetic, SyntheticKey, WindowCommand as To, WindowEvent,
    WindowKind, WindowOptions, WindowStyle,
};
use bun_ui::{queue, surfaces};

use crate::accelerator::{self, Stroke};
use crate::drawn_menus::DrawnMenus;
use crate::generated_bindgen::base::{DesktopPoint, DesktopRectangle};
use crate::generated_bindgen::window::{
    CoverFieldInit, DesktopBrowserWindow, DesktopWindow, EndCoverOptions, InputInit,
    OverlayOptions, WindowInit, WorkspaceOptions, js_DesktopBaseWindow as fields,
};
use crate::menu::{self, Menu, MenuItem};
use crate::prelude::*;
use crate::text::before;
use crate::view::View;
use crate::{app, cover, paths, screen};

const MENU_BAR_HEIGHT: f32 = 28.;
const UNLIMITED: f32 = 32767.;

#[derive(Default)]
struct Windows {
    all: RefCell<Vec<Rc<Root<Window>>>>,
    last_id: Cell<u32>,
    focused: Cell<Option<u32>>,
}

state!(fn windows() -> Windows);

pub(crate) fn all() -> Vec<Rc<Root<Window>>> {
    windows().all.borrow().clone()
}

/// Without message boxes.
pub(crate) fn of_app() -> Vec<Rc<Root<Window>>> {
    let mut all = all();
    all.retain(|it| !it.get().is_internal);
    all
}

pub(crate) fn with_id(id: u32) -> Option<&'static Window> {
    windows()
        .all
        .borrow()
        .iter()
        .map(|it| it.get())
        .find(|it| it.id == id)
}

pub(crate) fn focused() -> Option<&'static Window> {
    windows().focused.get().and_then(with_id)
}

fn next_id() -> u32 {
    let last = &windows().last_id;
    last.set((last.get() + 1).max(cover::first_free_id()));
    last.get()
}

pub(crate) fn handle(id: u32, event: WindowEvent) -> JsResult<()> {
    match with_id(id) {
        Some(window) => window.handle(event),
        None => {
            cover::missed(id, event);
            Ok(())
        }
    }
}

pub(crate) fn menus_changed() -> JsResult<()> {
    all().iter().try_for_each(|it| it.get().update_menus())
}

pub(crate) fn theme_changed() -> JsResult<()> {
    for window in all() {
        let window = window.get();
        if window.cover_variables.borrow().is_some() && window.postponed.borrow().is_none() {
            if cover::is_shown_in(window.id) {
                cover::end(true, Vec::new())?;
            }
            cover::clear()?;
        }
        window.tell_page()?;
        window.tell_menus(DrawnMenus::environment_changed)?;
    }
    crate::contents::theme_changed()
}

pub(crate) fn displays_changed() -> JsResult<()> {
    all().iter().try_for_each(|it| it.get().tell_page())?;
    crate::contents::theme_changed()
}

impl From<&DesktopPoint> for Point {
    fn from(it: &DesktopPoint) -> Point {
        Point {
            x: finite(it.x),
            y: finite(it.y),
        }
    }
}

impl DesktopRectangle {
    /// `other` has what is missing.
    pub(crate) fn or(&self, other: Rect) -> Rect {
        Rect {
            x: self.x.map_or(other.x, finite),
            y: self.y.map_or(other.y, finite),
            width: self.width.map_or(other.width, finite),
            height: self.height.map_or(other.height, finite),
        }
    }

    pub(crate) fn if_complete(&self) -> Option<Rect> {
        ([self.x, self.y, self.width, self.height]
            .iter()
            .all(Option::is_some))
        .then(|| self.or(Rect::default()))
    }
}

fn strict_color(text: &[u8]) -> JsResult<u32> {
    css_color(text).ok_or_else(|| invalid_value("backgroundColor", &string(text), "is not a color"))
}

/// Alpha comes first in hexadecimal, unlike in CSS.
pub(crate) fn electron_color(text: &[u8]) -> u32 {
    let color = match text {
        [b'#', digits @ ..] if matches!(digits.len(), 4 | 8) => {
            let (alpha, rest) = digits.split_at(digits.len() / 4);
            css_color(&[b"#", rest, alpha].concat())
        }
        _ => css_color(text),
    };
    color.unwrap_or(u32::MAX)
}

fn background(vibrancy: Option<&[u8]>, state: EffectState, is_transparent: bool) -> Background {
    match vibrancy.filter(|it| !it.is_empty()) {
        Some(it) if IS_MAC => Background::Blurred {
            material: material(it),
            state,
        },
        None if !is_transparent => Background::Opaque,
        _ => Background::Transparent,
    }
}

fn is_see_through(material: Option<&[u8]>) -> bool {
    matches!(material, Some(b"mica" | b"tabbed" | b"acrylic"))
}

fn at_most(width: f32, height: f32) -> Maybe<Size> {
    let limit = |it| if it == 0. { UNLIMITED } else { it };
    (width != 0. || height != 0.)
        .then(|| Size {
            width: limit(width),
            height: limit(height),
        })
        .into()
}

fn bounds_of(it: Geometry) -> Rect {
    Rect {
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.top + it.height,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Cover {
    Wanted,
    Refused,
    Indifferent,
}

/// What a window is to be like.
pub(crate) struct Plan<'a> {
    pub(crate) options: WindowOptions,
    pub(crate) parent: Option<&'a Window>,
    pub(crate) is_modal: bool,
    pub(crate) is_internal: bool,
    pub(crate) is_closable: bool,
    hides_menu_bar: bool,
    max: Maybe<Size>,
    style: WindowStyle,
    is_transparent: bool,
    effect: EffectState,
    opacity: Option<f64>,
    icon: Option<Vec<u8>>,
    cover: Cover,
    cover_variables: Vec<String>,
}

impl<'a> Plan<'a> {
    pub(crate) fn for_message(title: String, width: f32, height: f32) -> Self {
        Plan {
            options: WindowOptions {
                title: title.into(),
                width,
                height,
                frame: true,
                movable: true,
                ..Default::default()
            },
            parent: None,
            is_modal: false,
            is_internal: true,
            is_closable: true,
            hides_menu_bar: true,
            max: Maybe::No,
            style: WindowStyle {
                zoomable: Maybe::Yes(false),
                ..Default::default()
            },
            is_transparent: false,
            effect: EffectState::default(),
            opacity: None,
            icon: None,
            cover: Cover::Indifferent,
            cover_variables: Vec::new(),
        }
    }

    fn new(it: &WindowInit<'a>, background_color: Option<u32>) -> JsResult<Self> {
        let unless_false = |it: Option<bool>| it != Some(false);
        let length = |it: Option<f64>, otherwise| it.map_or(otherwise, finite);
        let (bar, kind) = (
            it.title_bar_style.as_deref().unwrap_or(b"default"),
            it.kind.as_deref(),
        );
        let inset = (bar == b"hiddenInset").then_some(Point { x: 12., y: 11. });
        let effect = effect_state(it.visual_effect_state.as_deref().unwrap_or_default());
        let is_see_through = it.transparent || is_see_through(it.background_material.as_deref());
        let (show, frame, resizable) = (
            unless_false(it.show),
            unless_false(it.frame),
            unless_false(it.resizable),
        );
        let options = WindowOptions {
            title: it
                .title
                .as_deref()
                .map_or_else(paths::app_name, |it| Ok(string(it)))?
                .into(),
            x: it.x.map(finite).into(),
            y: it.y.map(finite).into(),
            width: length(it.width, 800.),
            height: length(it.height, 600.),
            min_width: length(it.min_width, 0.),
            min_height: length(it.min_height, 0.),
            show,
            focus: show && unless_false(it.focus.or(it.focusable)),
            frame,
            hidden_title_bar: bar == b"hidden" || (IS_MAC && bar != b"default"),
            traffic_light_position: it
                .traffic_light_position
                .as_ref()
                .map(Point::from)
                .or(inset)
                .into(),
            background: background(it.vibrancy.as_deref(), effect, is_see_through),
            background_color: background_color.into(),
            resizable,
            movable: unless_false(it.movable),
            accept_first_mouse: it.accept_first_mouse || kind == Some(b"popup"),
            minimizable: unless_false(it.minimizable),
            kind: match kind {
                Some(b"panel") => WindowKind::Floating,
                Some(b"popup") => WindowKind::Popup,
                _ => WindowKind::Normal,
            },
            maximized: it.maximized,
            fullscreen: (it.fullscreen && !it.simple_fullscreen) || it.kiosk,
            tabbing_identifier: Text::lossy(
                (it.tabbing_identifier.as_deref())
                    .filter(|_| IS_MAC && frame && !it.transparent)
                    .unwrap_or_default(),
            ),
            ..Default::default()
        };
        let cover = it.launch_cover.to_js();
        let mut cover_variables = vec!["LANG".into(), "LC_ALL".into()];
        if cover.is_object() {
            cover_variables.extend(texts_of(get(cover, "environment")?)?);
        }
        let icon = it
            .icon
            .map(|it| NativeImage::with(global(), it.to_js(), |it| it.png(global())));
        Ok(Plan {
            options,
            parent: it.parent,
            is_modal: it.modal,
            is_internal: false,
            is_closable: unless_false(it.closable),
            hides_menu_bar: it.auto_hide_menu_bar,
            max: at_most(length(it.max_width, 0.), length(it.max_height, 0.)),
            style: WindowStyle {
                shadow: Maybe::Yes(it.has_shadow.unwrap_or(!it.transparent)),
                full_screenable: (kind != Some(b"panel"))
                    .then(|| unless_false(it.fullscreenable))
                    .into(),
                zoomable: Maybe::Yes(
                    resizable && (unless_false(it.maximizable) || unless_false(it.fullscreenable)),
                ),
                hidden_in_mission_control: it.hidden_in_mission_control.into(),
                rounded_corners: Maybe::Yes(
                    frame || (unless_false(it.rounded_corners) && !it.transparent),
                ),
                ..Default::default()
            },
            is_transparent: it.transparent || it.vibrancy.as_ref().is_some_and(|it| !it.is_empty()),
            effect,
            opacity: it.opacity,
            icon: icon.transpose()?.filter(|it| !it.is_empty()),
            cover: match cover {
                JSValue::FALSE => Cover::Refused,
                _ if cover.to_boolean() => Cover::Wanted,
                _ => Cover::Indifferent,
            },
            cover_variables,
        })
    }
}

#[derive(Default)]
pub(crate) struct State {
    id: u32,
    is_internal: bool,
    is_modal: bool,
    is_transparent: bool,
    effect: EffectState,
    can_have_menu_bar: bool,
    is_destroyed: Cell<bool>,
    is_shown: Cell<bool>,
    was_minimized: Cell<bool>,
    is_occluded: Cell<bool>,
    is_being_resized: Cell<bool>,
    geometry: Cell<Geometry>,
    normal_bounds: Cell<Rect>,
    limits: Cell<Limits>,
    title: RefCell<String>,
    accessible_title: RefCell<Option<String>>,
    represented_filename: RefCell<String>,
    opacity: Cell<Option<f64>>,
    pub(crate) zoom: Cell<f64>,
    has_background: Cell<bool>,
    pub(crate) background_color: Cell<u32>,
    traffic_lights: Cell<Option<Point>>,
    overlay: Cell<Option<Overlay>>,
    overlay_insets: Cell<[f32; 2]>,
    /// That may be none.
    has_own_menu: Cell<bool>,
    menu_bar_height: Cell<f32>,
    /// Of the page of a `Window`.
    pub(crate) surface: Cell<u32>,
    /// What the platform's window was told. Hiding one on Linux closes it.
    settings: RefCell<Vec<To>>,
    /// What would change the looks of the launch cover, while it is shown.
    postponed: RefCell<Option<Vec<To>>>,
    cover_variables: RefCell<Option<Vec<String>>>,
    cover_timer: Cell<Option<later::Timer>>,
    always_on_top: Cell<bool>,
    auto_hide_menu_bar: Cell<bool>,
    closable: Cell<bool>,
    content_protected: Cell<bool>,
    document_edited: Cell<bool>,
    enabled: Cell<bool>,
    excluded_from_shown_windows_menu: Cell<bool>,
    tabbing_identifier: String,
    focusable: Cell<bool>,
    full_screenable: Cell<bool>,
    hidden_in_mission_control: Cell<bool>,
    kiosk: Cell<bool>,
    maximizable: Cell<bool>,
    menu_bar_visible: Cell<bool>,
    minimizable: Cell<bool>,
    movable: Cell<bool>,
    shadow: Cell<bool>,
    simple_full_screen: Cell<bool>,
    visible_on_all_workspaces: Cell<bool>,
}

pub(crate) struct Window(Box<State>, #[expect(dead_code)] HasFields);

impl core::ops::Deref for Window {
    type Target = State;

    fn deref(&self) -> &State {
        &self.0
    }
}

fn root_of<T: JsInterface>(object: &T) -> &T::Root {
    // SAFETY: it extends that.
    unsafe { T::Root::from_js_unchecked(object.to_js()) }
}

fn replace_or_add(all: &mut Vec<To>, command: To) {
    match all
        .iter_mut()
        .find(|it| discriminant(*it) == discriminant(&command))
    {
        Some(known) => *known = command,
        None => all.push(command),
    }
}

// ── life ──

impl Window {
    pub(crate) fn open<'a, T>(
        plan: Plan<'_>,
        create: impl FnOnce(Window) -> &'a T,
    ) -> JsResult<&'a T>
    where
        T: JsInterface<Root = Window>,
    {
        let Plan {
            mut options,
            parent,
            style,
            ..
        } = plan;
        let reserved = if plan.cover == Cover::Wanted {
            cover::take_id()
        } else {
            None
        };
        options.id = reserved.unwrap_or_else(next_id);
        ui()?;
        if !app::has_display()? {
            return Err(error(format_args!(
                "There is no display server: neither WAYLAND_DISPLAY nor DISPLAY is set. \
                 Set BUN_DESKTOP_HEADLESS=1 to run without one."
            )));
        }
        let (is_modal, is_shown) = (plan.is_modal && parent.is_some(), options.show);
        if is_modal {
            options.kind = if IS_MAC {
                WindowKind::Normal
            } else {
                WindowKind::Dialog
            };
            options.show &= !IS_MAC;
        }
        options.app_id = paths::identifier()?.into();
        let min = Size {
            width: options.min_width,
            height: options.min_height,
        };
        let state = State {
            id: options.id,
            is_internal: plan.is_internal,
            is_modal,
            is_transparent: plan.is_transparent,
            tabbing_identifier: options.tabbing_identifier.to_string(),
            effect: plan.effect,
            can_have_menu_bar: !IS_MAC && options.frame && !options.hidden_title_bar && !is_modal,
            is_shown: is_shown.into(),
            limits: Limits {
                min,
                max: plan.max,
                is_resizable: options.resizable,
            }
            .into(),
            title: String::from(&*options.title).into(),
            zoom: 1.0.into(),
            has_background: (options.background_color != Maybe::No
                || options.background != Background::Opaque)
                .into(),
            background_color: (options.background_color.get())
                .unwrap_or(if plan.is_transparent { 0 } else { u32::MAX })
                .into(),
            traffic_lights: options.traffic_light_position.get().into(),
            overlay_insets: Cell::new(if IS_MAC { [78., 0.] } else { [0., 113.] }),
            settings: vec![To::Title(options.title.clone())].into(),
            auto_hide_menu_bar: plan.hides_menu_bar.into(),
            menu_bar_visible: (!plan.hides_menu_bar).into(),
            closable: plan.is_closable.into(),
            enabled: true.into(),
            minimizable: options.minimizable.into(),
            movable: options.movable.into(),
            ..Default::default()
        };

        if plan.cover == Cover::Refused {
            cover::discard()?;
        }
        let missed = if reserved.is_some() {
            cover::adopt(options.clone())?
        } else {
            None
        };
        let waits_for_opacity =
            missed.is_none() && options.show && plan.opacity.is_some_and(|it| it < 1.);
        if missed.is_none() {
            if plan.cover == Cover::Wanted && windows().all.borrow().is_empty() {
                cover::hold_keys()?;
            }
            let options = WindowOptions {
                show: options.show && !waits_for_opacity,
                ..options.clone()
            };
            let icon = plan.icon.map(Into::into).into();
            bun_ui::perform(global(), Command::CreateWindow { options, icon })?;
        }
        let created = create(Window(Box::new(state), HasFields::default()));
        let window = root_of(created);
        fields::set_parent(window, parent);
        windows().all.borrow_mut().push(Rc::new(Root::new(window)));
        bun_ui::hold();
        window.geometry.set(window.ask_geometry()?);
        window.normal_bounds.set(bounds_of(window.geometry.get()));
        if plan.cover == Cover::Wanted {
            window.cover_variables.replace(Some(plan.cover_variables));
        }
        if let Some(missed) = missed {
            window.adopted(&options, missed)?;
        }
        if plan.max != Maybe::No {
            window.set(To::Limits(window.limits.get()))?;
        }
        window.style(WindowStyle {
            closable: Maybe::Yes(plan.is_closable),
            ..style
        })?;
        if let Some(opacity) = plan.opacity {
            window.change_opacity(opacity)?;
        }
        if waits_for_opacity {
            window.tell(To::Show {
                takes_focus: options.focus,
            })?;
        }
        if let (true, Some(parent)) = (IS_MAC && is_shown, parent) {
            window.join(parent)?;
        }
        window.update_menus()?;
        Ok(created)
    }

    pub(crate) fn open_as_asked<'a, T>(
        it: &WindowInit<'a>,
        structure: ClassStructure<'a, T>,
        heap: &JsHeap<'a>,
    ) -> JsResult<&'a T>
    where
        T: JsInterface<Root = Window, Struct = Window>,
    {
        let has_page = T::NUMBER == DesktopWindow::NUMBER;
        let color = it
            .background_color
            .as_deref()
            .filter(|it| has_page || !it.is_empty());
        let color = color.map(|it| {
            if has_page {
                strict_color(it)
            } else {
                Ok(electron_color(it))
            }
        });
        let created = Window::open(Plan::new(it, color.transpose()?)?, |it| {
            structure.create(heap, it)
        })?;
        let window = root_of(created);
        window.focusable.set(it.focusable != Some(false));
        window.full_screenable.set(it.fullscreenable != Some(false));
        window
            .hidden_in_mission_control
            .set(it.hidden_in_mission_control == Some(true));
        window.kiosk.set(it.kiosk);
        window.maximizable.set(it.maximizable != Some(false));
        window.shadow.set(it.has_shadow != Some(false));
        if it.always_on_top {
            window.keep_on_top(true, 3)?;
        }
        if it.skip_taskbar {
            window.set(To::SkipTaskbar(true))?;
        }
        if it.fullscreen && it.simple_fullscreen {
            window.simple_full_screen.set(true);
            window.set(To::SimpleFullscreen(true))?;
        }
        if it.use_content_size && window.above_content() > 0. {
            let Rect { width, height, .. } = bounds_of(window.geometry.get());
            window.tell(To::Size(Size {
                width,
                height: height + window.above_content(),
            }))?;
        }
        if has_page {
            return Ok(created);
        }
        window.change_background_color(window.background_color.get())?;
        let overlay = it.title_bar_overlay.map(JsLocal::to_js);
        if let Some(overlay) = overlay.filter(|_| {
            it.title_bar_style
                .as_deref()
                .is_some_and(|it| it != b"default")
        }) {
            window.overlay.set(Some(Overlay {
                height: 0.,
                color: Maybe::No,
                symbol_color: Maybe::No,
            }));
            match overlay.is_object() {
                true => window.change_overlay(&OverlayOptions::from_js(global(), overlay)?)?,
                false => window.draw_overlay()?,
            }
        }
        if it.x.is_none() && it.center != Some(false) {
            window.move_to_center()?;
        }
        Ok(created)
    }

    pub(crate) fn announce_creation(&self) -> JsResult<()> {
        announce(app::object(), "window-created", &[self.to_js()])
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        options: &WindowInit<'a>,
    ) -> JsResult<&'a Self> {
        let window = Window::open_as_asked(options, structure, &cx.heap)?;
        window.content_view()?;
        window.announce_creation()?;
        Ok(window)
    }

    fn check(&self) -> JsResult<()> {
        match (self.is_destroyed.get(), self.is_a::<DesktopWindow>()) {
            (false, _) => Ok(()),
            (true, true) => Err(error(format_args!("The window has been destroyed"))),
            (true, false) => Err(type_error(format_args!("Object has been destroyed"))),
        }
    }

    pub(crate) fn tell(&self, command: To) -> JsResult<()> {
        self.check()?;
        if let Some(postponed) = &mut *self.postponed.borrow_mut()
            && let To::Opacity(_) | To::TrafficLights(_) = command
        {
            replace_or_add(postponed, command);
            return Ok(());
        }
        tell(Command::Window {
            id: self.id,
            command,
        })
    }

    fn set(&self, command: To) -> JsResult<()> {
        replace_or_add(&mut self.settings.borrow_mut(), command.clone());
        self.tell(command)
    }

    fn style(&self, style: WindowStyle) -> JsResult<()> {
        if IS_MAC {
            self.tell(To::Style(style))
        } else {
            Ok(())
        }
    }

    fn ask<T>(&self, question: extern "C" fn(u32) -> bun_ui::protocol::Outcome<T>) -> JsResult<T> {
        self.check()?;
        answer(question(self.id))
    }

    fn ask_geometry(&self) -> JsResult<Geometry> {
        self.ask(ui()?.window_geometry)
    }

    pub(crate) fn bounds(&self) -> JsResult<Rect> {
        self.ask_geometry().map(bounds_of)
    }

    pub(crate) fn mouse(&self) -> JsResult<Point> {
        self.ask(ui()?.window_mouse)
    }

    /// In the window, below the menu bar.
    pub(crate) fn content(&self) -> Rect {
        let (Geometry { width, height, .. }, y) = (self.geometry.get(), self.menu_bar_height.get());
        Rect {
            x: 0.,
            y,
            width,
            height: height - y,
        }
    }

    /// Only Electron's windows pass an event.
    fn emit(&self, name: &str) -> JsResult<()> {
        match self.is_a::<DesktopWindow>() {
            true => emit(self.to_js(), name, &[]),
            false => announce(self.to_js(), name, &[]),
        }
    }

    pub(crate) fn tell_page(&self) -> JsResult<()> {
        fields::page(self).map_or(Ok(()), |it| invoke(it, "environmentChanged", &[]).map(drop))
    }

    fn tell_views(&self) -> JsResult<()> {
        fields::content_view(self).map_or(Ok(()), View::tree_changed)
    }

    fn tell_contents_and_emit(&self, name: &str) -> JsResult<()> {
        self.tell_page()?;
        self.tell_views()?;
        self.emit(name)
    }

    pub(crate) fn request_close(&self) -> JsResult<()> {
        if self.is_destroyed.get() {
            return Ok(());
        }
        let page = fields::page(self).filter(|_| self.closable.get());
        let stays =
            page.map(|it| invoke(it, "beforeUnload", &[])).transpose()? == Some(JSValue::FALSE);
        if !self.closable.get() || stays || !dispatch(self.to_js(), "close", &[])? {
            app::close_cancelled();
            return Ok(());
        }
        match self.downcast::<DesktopBrowserWindow>() {
            Some(window) => window.unload_soon(),
            None => self.destroy_now()?,
        }
        Ok(())
    }

    pub(crate) fn destroy_now(&self) -> JsResult<()> {
        if self.is_destroyed.get() {
            return Ok(());
        }
        if let Some(contents) = fields::contents(self)
            && !invoke(contents, "isDestroyed", &[])?.to_boolean()
        {
            return invoke(contents, "destroy", &[]).map(drop);
        }
        if let Some(view) = fields::content_view(self) {
            view.arrange(None, 0)?;
        }
        if IS_MAC {
            self.leave_parent()?;
            self.children()
                .iter()
                .try_for_each(|it| it.get().tell(To::Parent(Maybe::No)))?;
        }
        self.tell(To::Destroy)?;
        self.dispose()
    }

    fn dispose(&self) -> JsResult<()> {
        if cover::is_shown_in(self.id) {
            self.postponed.replace(Some(Vec::new()));
            self.is_shown.set(true);
            cover::end(false, Vec::new())?;
        }
        self.children()
            .iter()
            .try_for_each(|it| it.get().destroy_now())?;
        if let Some(renderer) = fields::renderer(self) {
            invoke(renderer, "unmount", &[])?;
        }
        self.tell_menus(DrawnMenus::dispose)?;
        if let Some(page) = fields::page(self) {
            invoke(page, "dispose", &[])?;
            surfaces::ignore(self.surface.get());
            queue::destroy_surface(global(), self.surface.get())?;
        }
        self.is_destroyed.set(true);
        self.cover_timer.take();
        windows()
            .all
            .borrow_mut()
            .retain(|it| !same(it.get(), self));
        bun_ui::release();
        menu::window_closed(self)?;
        self.emit("closed")?;
        if !self.is_internal && of_app().is_empty() {
            app::all_windows_closed()?;
        }
        Ok(())
    }

    fn children(&self) -> Vec<Rc<Root<Window>>> {
        let mut all = all();
        all.retain(|it| fields::parent(it.get()).is_some_and(|it| same(it, self)));
        all
    }

    fn is_sheet(&self) -> bool {
        IS_MAC && self.is_modal
    }

    fn join(&self, parent: &Window) -> JsResult<()> {
        if !self.is_modal {
            return self.tell(To::Parent(Maybe::Yes(parent.id)));
        }
        self.tell(To::ShowAsSheet(parent.id))?;
        parent.emit("sheet-begin")
    }

    fn leave_parent(&self) -> JsResult<()> {
        let Some(parent) = fields::parent(self) else {
            return Ok(());
        };
        self.tell(To::Parent(Maybe::No))?;
        if self.is_modal && self.is_shown.get() {
            parent.emit("sheet-end")
        } else {
            Ok(())
        }
    }

    pub(crate) fn sheet_is_shown(&self, is_shown: bool) -> JsResult<()> {
        self.emit(if is_shown { "sheet-begin" } else { "sheet-end" })
    }

    pub(crate) fn appear(&self, takes_focus: bool) -> JsResult<()> {
        let was_shown = self.is_shown.replace(true);
        if was_shown || !self.is_sheet() {
            self.tell(To::Show { takes_focus })?;
        }
        if was_shown {
            return Ok(());
        }
        self.is_occluded.set(false);
        if !IS_MAC {
            let settings = self.settings.borrow().clone();
            settings.into_iter().try_for_each(|it| self.tell(it))?;
        } else if let Some(parent) = fields::parent(self) {
            self.join(parent)?;
        }
        self.tell_page()?;
        self.draw_overlay()?;
        self.emit("show")
    }

    pub(crate) fn is_on_screen(&self) -> JsResult<bool> {
        if !self.is_shown.get() || self.is_destroyed.get() {
            return Ok(false);
        }
        Ok(!(IS_MAC
            && (self.was_minimized.get()
                || (self.is_occluded.get() && answer((ui()?.is_hidden)())?))))
    }

    pub(crate) fn has_focus(&self) -> JsResult<bool> {
        Ok(!self.is_destroyed.get() && self.ask(ui()?.window_is_focused)?)
    }

    pub(crate) fn is_in_dock(&self) -> JsResult<bool> {
        self.ask(ui()?.window_is_minimized)
    }

    pub(crate) fn is_occluded(&self) -> bool {
        self.is_occluded.get()
    }

    pub(crate) fn has_background(&self) -> bool {
        self.has_background.get()
    }

    pub(crate) fn take_focus(&self) -> JsResult<()> {
        if self.is_shown.get() {
            self.tell(To::Focus)
        } else {
            Ok(())
        }
    }

    pub(crate) fn raise(&self) -> JsResult<()> {
        self.tell(if IS_MAC { To::MoveTop } else { To::Focus })
    }

    pub(crate) fn zoom_frame(&self, maximizes: bool) -> JsResult<()> {
        let appears = maximizes && !self.is_shown.get() && !self.is_modal;
        if appears && !IS_MAC {
            self.appear(false)?;
        }
        self.tell(To::Maximize(maximizes))?;
        if appears && IS_MAC {
            self.appear(false)
        } else {
            Ok(())
        }
    }

    pub(crate) fn fills_screen(&self) -> JsResult<bool> {
        Ok(self.ask_geometry()?.is_fullscreen)
    }

    pub(crate) fn fills_work_area(&self) -> JsResult<bool> {
        Ok(self.ask_geometry()?.is_maximized)
    }

    pub(crate) fn move_to_center(&self) -> JsResult<()> {
        let bounds = self.bounds()?;
        let area = screen::display_matching(bounds)?.work_area;
        self.tell(To::Position(Point {
            x: (area.x + (area.width - bounds.width) / 2.).round(),
            y: (area.y + (area.height - bounds.height) / 2.).round(),
        }))
    }

    fn handle(&self, event: WindowEvent) -> JsResult<()> {
        match event {
            WindowEvent::CloseRequested => self.request_close(),
            WindowEvent::Closed => self.dispose(),
            WindowEvent::Focus => self.focus_changed(true),
            WindowEvent::Blur => self.focus_changed(false),
            WindowEvent::Fullscreen(it) => self.fullscreen_changed(it),
            WindowEvent::Swipe(it) => announce(
                self.to_js(),
                "swipe",
                &[js(["left", "right", "up", "down"][it as usize])?],
            ),
            WindowEvent::Resizing(it) => {
                self.is_being_resized.set(it);
                let details = [js(self.bounds()?)?, object!({ "edge": "bottom-right" })];
                announce(
                    self.to_js(),
                    if it { "will-resize" } else { "resized" },
                    &details,
                )
            }
            WindowEvent::NewTab => {
                self.emit("new-window-for-tab")?;
                announce(app::object(), "new-window-for-tab", &[])
            }
            WindowEvent::Moving => announce(self.to_js(), "will-move", &[js(self.bounds()?)?]),
            WindowEvent::Visibility(it) if IS_MAC => {
                if it {
                    self.minimized_changed(false)?;
                }
                let is_occluded = !it && self.is_shown.get();
                if self.is_occluded.replace(is_occluded) == is_occluded {
                    return Ok(());
                }
                self.tell_page()?;
                self.tell_views()
            }
            WindowEvent::Visibility(it) => self.minimized_changed(
                !it && self.is_shown.get() && self.ask(ui()?.window_is_minimized)?,
            ),
            WindowEvent::Minimized(it) => self.minimized_changed(it),
            WindowEvent::Bounds(it) => self.geometry_changed(it),
        }
    }

    fn focus_changed(&self, is_focused: bool) -> JsResult<()> {
        let (focused, app) = (&windows().focused, app::object());
        if is_focused {
            focused.set(Some(self.id));
            app::window_was_focused();
        } else if focused.get() == Some(self.id) {
            focused.set(None);
        }
        let [name, of_any, of_browser] = match is_focused {
            true => ["focus", "window-focus", "browser-window-focus"],
            false => ["blur", "window-blur", "browser-window-blur"],
        };
        announce(app, of_any, &[self.to_js()])?;
        if self.is_a::<DesktopBrowserWindow>() {
            announce(app, of_browser, &[self.to_js()])?;
        }
        self.tell_views()?;
        self.emit(name)
    }

    fn fullscreen_changed(&self, is_fullscreen: bool) -> JsResult<()> {
        self.tell_views()?;
        self.emit(if is_fullscreen {
            "enter-full-screen"
        } else {
            "leave-full-screen"
        })
    }

    fn minimized_changed(&self, is_minimized: bool) -> JsResult<()> {
        if self.was_minimized.replace(is_minimized) == is_minimized {
            return Ok(());
        }
        self.tell_contents_and_emit(if is_minimized { "minimize" } else { "restore" })?;
        if IS_MAC && self.is_shown.get() && !self.is_destroyed.get() {
            self.emit(if is_minimized { "hide" } else { "show" })?;
        }
        Ok(())
    }

    fn geometry_changed(&self, now: Geometry) -> JsResult<()> {
        let before = self.geometry.replace(now);
        let has_cover = self.cover_variables.borrow().is_some();
        if !now.is_maximized && !now.is_fullscreen {
            self.normal_bounds.set(bounds_of(now));
        }
        if now.is_fullscreen != before.is_fullscreen {
            self.update_menus()?;
        }
        if (now.x, now.y) != (before.x, before.y) {
            if has_cover {
                self.cover_moved();
            }
            self.tell_contents_and_emit("move")?;
            if IS_MAC {
                self.emit("moved")?;
            }
        }
        if (now.width, now.height) != (before.width, before.height) && !self.is_destroyed.get() {
            self.content_resized()?;
            if has_cover && cover::is_shown_in(self.id) {
                cover::end(false, Vec::new())?;
            }
            if has_cover && !now.is_fullscreen && !before.is_fullscreen {
                cover::clear()?;
            }
            self.emit("resize")?;
            if IS_MAC && !self.is_being_resized.get() {
                self.emit("resized")?;
            }
        }
        if now.is_maximized != before.is_maximized {
            self.emit(if now.is_maximized {
                "maximize"
            } else {
                "unmaximize"
            })?;
        }
        if !IS_MAC && now.is_fullscreen != before.is_fullscreen {
            self.fullscreen_changed(now.is_fullscreen)?;
        }
        Ok(())
    }
}

// ── the launch cover ──

impl Window {
    fn adopted(&self, options: &WindowOptions, missed: Vec<WindowEvent>) -> JsResult<()> {
        if self.geometry.get().is_maximized {
            let (x, y) = (options.x.get().unwrap_or(0.), options.y.get().unwrap_or(0.));
            self.normal_bounds.set(Rect {
                x,
                y,
                width: options.width,
                height: options.height,
            });
        }
        self.tell(To::Title(options.title.clone()))?;
        self.tell(To::Limits(self.limits.get()))?;
        self.tell(To::Background(options.background))?;
        self.tell(To::BackgroundColor(options.background_color))?;
        let lights = options.traffic_light_position.get().map(To::TrafficLights);
        self.postponed.replace(Some(lights.into_iter().collect()));
        let id = self.id;
        later::soon(move |_| {
            let Some(window) = with_id(id) else {
                return Ok(());
            };
            if missed.contains(&WindowEvent::Closed) {
                return window.dispose();
            }
            let last = missed
                .iter()
                .rfind(|it| matches!(it, WindowEvent::Focus | WindowEvent::Blur));
            if last == Some(&WindowEvent::Focus) && windows().focused.get() != Some(id) {
                window.focus_changed(true)?;
            }
            if missed.contains(&WindowEvent::CloseRequested) {
                window.request_close()
            } else {
                Ok(())
            }
        });
        Ok(())
    }

    pub(crate) fn uncovered(&self) -> JsResult<()> {
        self.postponed
            .take()
            .into_iter()
            .flatten()
            .try_for_each(|it| self.tell(it))?;
        if self.is_shown.get() {
            Ok(())
        } else {
            self.tell(To::Hide)
        }
    }

    fn save_cover(&self, content: CoverPicture) -> JsResult<JSValue> {
        let geometry = self.geometry.get();
        let variables = self.cover_variables.borrow().clone();
        match variables
            .filter(|_| self.is_shown.get() && !self.was_minimized.get() && !geometry.is_fullscreen)
        {
            None => resolved(false),
            Some(variables) => cover::save(bun_ui::protocol::Cover {
                window: self.id,
                description: Text::new(),
                picture: Text::new(),
                content,
                theme: Default::default(),
                variables: variables.into_iter().map(Text::from).collect(),
                bounds: self.normal_bounds.get(),
                is_maximized: geometry.is_maximized,
                traffic_light_position: self.traffic_lights.get().into(),
            }),
        }
    }

    fn cover_moved(&self) {
        let id = self.id;
        self.cover_timer
            .set(Some(later::after(300., move |_| match with_id(id) {
                Some(window) if cover::is_saved()? => {
                    window.save_cover(CoverPicture::Kept).map(drop)
                }
                _ => Ok(()),
            })));
    }

    pub(crate) fn clear_launch_cover(_: Cx<'_, '_>) -> JsResult<()> {
        cover::clear()
    }

    pub(crate) fn is_launch_cover_shown(&self) -> bool {
        cover::is_shown_in(self.id)
    }

    pub(crate) fn has_launch_cover_input(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        Ok(cover::is_shown_in(self.id) && cover::has_input()?)
    }

    pub(crate) fn when_launch_cover_input(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        cover::when_input()
    }

    pub(crate) fn end_launch_cover(
        &self,
        _: Cx<'_, '_>,
        options: Option<&EndCoverOptions>,
    ) -> JsResult<()> {
        let replays = !options.is_some_and(|it| it.drop_input);
        if !cover::is_shown_in(self.id) {
            cover::release_keys(replays);
            return Ok(());
        }
        let keep = options
            .and_then(|it| it.keep.as_ref())
            .into_iter()
            .flatten();
        let keep = keep.map(|it| it.or(Rect::default())).collect();
        post(Priority::Blocking, move || {
            render_pages();
            cover::end(replays, keep)
        });
        Ok(())
    }

    /// `behind` is the color for where the window is see-through.
    pub(crate) fn save_launch_cover(
        &self,
        _: Cx<'_, '_>,
        part: Option<&DesktopRectangle>,
        field: Option<&CoverFieldInit>,
        behind: Option<&[u8]>,
    ) -> JsResult<JSValue> {
        self.check()?;
        let field = field.map(|it| {
            JsResult::Ok(CoverField {
                rect: it.bounds.or(Rect::default()),
                color: it.color.as_deref().map(strict_color).transpose()?.into(),
                letter_spacing: it.letter_spacing.map_or(0., finite),
            })
        });
        self.save_cover(CoverPicture::Painted {
            part: part.and_then(DesktopRectangle::if_complete).into(),
            backdrop: behind.map(strict_color).transpose()?.into(),
            field: field.transpose()?.into(),
        })
    }
}

// ── menus and surfaces ──

impl Window {
    pub(crate) fn fit_page(&self) -> JsResult<()> {
        let bounds = (self.menu_bar_height.get() > 0.).then(|| self.content());
        tell(Command::Surface {
            id: self.surface.get(),
            command: SurfaceCommand::Bounds(bounds.into()),
        })
    }

    pub(crate) fn attach(&self, surface: u32, index: u32) -> JsResult<()> {
        let command = SurfaceCommand::Attach {
            window: self.id,
            index: Maybe::Yes(index),
        };
        tell(Command::Surface {
            id: surface,
            command,
        })?;
        self.tell_menus(DrawnMenus::raise)
    }

    /// The menu bar and the menus that are open, where the system draws none.
    pub(crate) fn drawn_menus(&self) -> JsResult<&DrawnMenus> {
        if let Some(menus) = fields::drawn_menus(self) {
            return Ok(menus);
        }
        let menus = DrawnMenus::create(self, MENU_BAR_HEIGHT)?;
        fields::set_drawn_menus(self, Some(menus));
        Ok(menus)
    }

    pub(crate) fn tell_menus(
        &self,
        tell: impl FnOnce(&DrawnMenus) -> JsResult<()>,
    ) -> JsResult<()> {
        fields::drawn_menus(self).map_or(Ok(()), tell)
    }

    fn active_menu(&self) -> Option<&Menu> {
        if self.has_own_menu.get() {
            fields::menu(self)
        } else {
            menu::application_menu()
        }
    }

    fn update_menus(&self) -> JsResult<()> {
        if self.is_destroyed.get() || !self.can_have_menu_bar {
            return Ok(());
        }
        let menu = (self.active_menu())
            .filter(|_| self.menu_bar_visible.get() && !self.geometry.get().is_fullscreen);
        if menu.is_some() {
            self.drawn_menus()?;
        }
        self.tell_menus(|it| it.set_bar(menu))?;
        let height = if menu.is_some() { MENU_BAR_HEIGHT } else { 0. };
        if self.menu_bar_height.replace(height) == height {
            Ok(())
        } else {
            self.content_resized()
        }
    }

    fn content_resized(&self) -> JsResult<()> {
        if self.surface.get() != 0 {
            self.fit_page()?;
        }
        self.tell_menus(DrawnMenus::lay_out)?;
        self.lay_out()
    }

    fn lay_out(&self) -> JsResult<()> {
        let Some(view) = fields::content_view(self) else {
            return Ok(());
        };
        view.change_bounds(Rect {
            y: 0.,
            ..self.content()
        })?;
        self.arrange_views()
    }

    pub(crate) fn arrange_views(&self) -> JsResult<()> {
        let view = fields::content_view(self).filter(|_| !self.is_destroyed.get());
        view.map_or(Ok(()), |it| {
            it.arrange(Some(self), u32::from(self.surface.get() != 0))
                .map(drop)
        })
    }

    pub(crate) fn show_view(&self, view: &View) -> JsResult<()> {
        if let Some(before) = fields::content_view(self) {
            before.set_root(None);
            before.arrange(None, 0)?;
        }
        fields::set_content_view(self, Some(view));
        view.set_root(Some(self));
        self.lay_out()
    }

    pub(crate) fn content_view(&self) -> JsResult<&View> {
        if let Some(view) = fields::content_view(self) {
            return Ok(view);
        }
        let view = View::create();
        self.show_view(view)?;
        Ok(view)
    }

    /// For a key that the content has no use for.
    pub(crate) fn handle_shortcut(&self, key: &bun_web::host::Keystroke) -> JsResult<()> {
        let stroke = Stroke::new(&key.key, &key.code, key.modifiers as u8);
        let found = self.shortcut(&stroke)?;
        found.map_or(Ok(()), |it| it.activate(Some(self), Some(stroke.modifiers)))
    }

    pub(crate) fn shortcut(&self, stroke: &Stroke) -> JsResult<Option<&'static MenuItem>> {
        match self.active_menu() {
            Some(menu) if IS_MAC || !self.is_internal => menu.find_by_key(stroke),
            _ => Ok(None),
        }
    }

    fn titlebar_height(overlay: Overlay) -> f32 {
        match overlay.height {
            0. if IS_MAC => 28.,
            0. => 30.,
            height => height,
        }
    }

    pub(crate) fn titlebar_area(&self) -> JsResult<Option<Rect>> {
        let Some(overlay) = self.overlay.get().filter(|_| !self.is_destroyed.get()) else {
            return Ok(None);
        };
        let ([left, right], height) = (self.overlay_insets.get(), Self::titlebar_height(overlay));
        let width = self.content().width - left - right;
        Ok((!self.fills_screen()?).then_some(Rect {
            x: left,
            y: 0.,
            width,
            height,
        }))
    }

    fn draw_overlay(&self) -> JsResult<()> {
        if let (false, Some(it)) = (IS_MAC, self.overlay.get()) {
            let overlay = Overlay {
                height: Self::titlebar_height(it),
                ..it
            };
            self.overlay_insets
                .set(answer((ui()?.set_overlay)(self.id, Maybe::Yes(overlay)))?);
        }
        self.tell_views()
    }

    fn change_overlay(&self, options: &OverlayOptions) -> JsResult<()> {
        let Some(before) = self.overlay.get() else {
            return Err(error(format_args!("Titlebar overlay is not enabled")));
        };
        let color =
            |it: Option<&[u8]>, before| it.map_or(before, |it| Maybe::Yes(electron_color(it)));
        self.overlay.set(Some(Overlay {
            height: options.height.map_or(before.height, finite),
            color: color(options.color.as_deref(), before.color),
            symbol_color: color(options.symbol_color.as_deref(), before.symbol_color),
        }));
        self.draw_overlay()
    }

    fn change_background_color(&self, color: u32) -> JsResult<()> {
        self.background_color.set(color);
        self.tell(To::BackgroundColor(Maybe::Yes(color)))?;
        self.has_background.set(true);
        self.tell_page()?;
        fields::contents_view(self).map_or(Ok(()), |it| it.change_background_color(color))
    }

    pub(crate) fn change_title(&self, title: String) -> JsResult<()> {
        self.title.replace(title.clone());
        self.set(To::Title(title.into()))
    }

    fn change_opacity(&self, opacity: f64) -> JsResult<()> {
        let opacity = opacity.clamp(0., 1.);
        self.opacity.set(Some(opacity));
        self.set(To::Opacity(finite(opacity)))
    }

    fn change_limits(&self, limits: Limits) -> JsResult<()> {
        self.limits.set(limits);
        self.set(To::Limits(limits))
    }

    fn keep_on_top(&self, is_on: bool, level: i32) -> JsResult<()> {
        let was_on = self.always_on_top.replace(is_on);
        self.set(To::AlwaysOnTop(is_on))?;
        if is_on {
            self.style(WindowStyle {
                level: Maybe::Yes(level),
                ..Default::default()
            })?;
        }
        if was_on == is_on {
            Ok(())
        } else {
            announce(self.to_js(), "always-on-top-changed", &[is_on.into()])
        }
    }

    fn change_bounds(&self, to: &DesktopRectangle, animates: bool) -> JsResult<()> {
        let bounds = to.or(self.bounds()?);
        let Size { width, height } = self.within_limits(Size {
            width: bounds.width,
            height: bounds.height,
        });
        let bounds = Rect {
            width,
            height,
            ..bounds
        };
        if IS_MAC && !is_headless()? {
            return self.tell(To::Bounds { bounds, animates });
        }
        if to.x.is_some() || to.y.is_some() {
            self.tell(To::Position(Point {
                x: bounds.x,
                y: bounds.y,
            }))?;
        }
        if to.width.is_some() || to.height.is_some() {
            self.tell(To::Size(Size { width, height }))?;
        }
        Ok(())
    }

    fn within_limits(&self, it: Size) -> Size {
        let Limits { min, max, .. } = self.limits.get();
        let max = max.get().unwrap_or(it);
        Size {
            width: it.width.min(max.width).max(min.width),
            height: it.height.min(max.height).max(min.height),
        }
    }

    /// The title bar and the menu bar.
    fn above_content(&self) -> f32 {
        self.geometry.get().top + self.menu_bar_height.get()
    }

    fn content_bounds(&self) -> JsResult<Rect> {
        let geometry = self.ask_geometry()?;
        let (bounds, bar) = (
            bounds_of(geometry),
            geometry.top + self.menu_bar_height.get(),
        );
        Ok(Rect {
            y: bounds.y + bar,
            height: bounds.height - bar,
            ..bounds
        })
    }
}

// ── members ──

pub(crate) fn all_of<T: JsInterface<Root = Window>>() -> JsResult<JSValue> {
    let all = of_app()
        .into_iter()
        .map(|it| it.get())
        .filter(|it| it.is_a::<T>());
    array(&all.map(Window::to_js).collect::<Vec<_>>())
}

pub(crate) fn if_it_is<T: JsInterface<Root = Window>>(window: Option<&Window>) -> JSValue {
    window
        .filter(|it| it.is_a::<T>())
        .map_or(JSValue::NULL, Window::to_js)
}

macro_rules! flags {
    ($($name:ident: $getter:ident, $setter:ident => |$window:ident, $on:ident| $apply:expr;)*) => {$(
        pub(crate) fn $getter(&self) -> bool {
            self.$name.get()
        }

        pub(crate) fn $setter(&self, _: Cx<'_, '_>, $on: bool) -> JsResult<()> {
            self.$name.set($on);
            let $window = self;
            $apply
        }
    )*};
}

macro_rules! styles {
    ($($name:ident: $getter:ident, $setter:ident;)*) => {
        flags! {$(
            $name: $getter, $setter => |it, on| it.style(WindowStyle { $name: Maybe::Yes(on), ..it.zoom_button() });
        )*}
    };
}

macro_rules! actions {
    ($($name:ident($($argument:ident: $type:ty),*) => |$window:ident| $body:expr;)*) => {$(
        pub(crate) fn $name(&self, _: Cx<'_, '_>, $($argument: $type),*) -> JsResult<()> {
            let $window = self;
            $body
        }
    )*};
}

macro_rules! questions {
    ($($name:ident -> $result:ty => |$window:ident| $body:expr;)*) => {$(
        pub(crate) fn $name(&self, _: Cx<'_, '_>) -> JsResult<$result> {
            let $window = self;
            $body
        }
    )*};
}

fn size(width: f64, height: f64) -> Size {
    Size {
        width: finite(width),
        height: finite(height),
    }
}

fn pair(a: f32, b: f32) -> [f64; 2] {
    [a.round().into(), b.round().into()]
}

impl Window {
    pub(crate) fn nothing(&self) {}

    pub(crate) fn no(&self) -> bool {
        false
    }

    pub(crate) fn get_all_windows(_: Cx<'_, '_>) -> JsResult<JSValue> {
        all_of::<Window>()
    }

    pub(crate) fn get_focused_window(_: &JsHeap<'_>) -> JSValue {
        if_it_is::<Window>(focused())
    }

    pub(crate) fn from_id(_: &JsHeap<'_>, id: Option<f64>) -> JSValue {
        if_it_is::<Window>(id.and_then(|it| with_id(it as u32)))
    }

    fn zoom_button(&self) -> WindowStyle {
        let zoomable = self.limits.get().is_resizable
            && (self.full_screenable.get() || self.maximizable.get());
        WindowStyle {
            zoomable: Maybe::Yes(zoomable),
            ..Default::default()
        }
    }

    styles! {
        closable: get_closable, set_closable;
        focusable: get_focusable, set_focusable;
        full_screenable: get_full_screenable, set_full_screenable;
        hidden_in_mission_control: get_hidden_in_mission_control, set_hidden_in_mission_control;
        minimizable: get_minimizable, set_minimizable;
        movable: get_movable, set_movable;
        shadow: get_shadow, set_shadow;
    }

    flags! {
        auto_hide_menu_bar: get_auto_hide_menu_bar, set_auto_hide_menu_bar => |it, on| {
            it.menu_bar_visible.set(!on);
            it.update_menus()
        };
        content_protected: get_content_protected, set_content_protected => |it, on| it.set(To::ContentProtection(on));
        document_edited: get_document_edited, set_document_edited => |it, on| it.set(To::Edited(on));
        enabled: get_enabled, set_enabled => |it, on| it.check();
        excluded_from_shown_windows_menu: get_excluded_from_shown_windows_menu, set_excluded_from_shown_windows_menu =>
            |it, on| it.style(WindowStyle { is_in_window_menu: Maybe::Yes(!on), ..Default::default() });
        kiosk: get_kiosk, set_kiosk => |it, on| it.tell(To::Fullscreen(on));
        maximizable: get_maximizable, set_maximizable => |it, on| it.style(it.zoom_button());
        menu_bar_visible: get_menu_bar_visible, set_menu_bar_visible => |it, on| it.update_menus();
        simple_full_screen: get_simple_full_screen, set_simple_full_screen => |it, on| it.set(To::SimpleFullscreen(on));
        visible_on_all_workspaces: get_visible_on_all_workspaces, set_visible_on_all_workspaces =>
            |it, on| it.set(To::AllWorkspaces(on));
    }

    actions! {
        close() => |it| it.request_close();
        destroy() => |it| it.destroy_now();
        show() => |it| it.appear(true);
        show_inactive() => |it| if it.is_modal { Ok(()) } else { it.appear(false) };
        focus() => |it| it.take_focus();
        blur() => |it| if it.has_focus()? { it.tell(To::Blur) } else { Ok(()) };
        move_top() => |it| it.raise();
        move_above(source: &[u8]) => |it| {
            let number = source.strip_prefix(b"window:").and_then(|it| before(&string(it), ":").parse().ok());
            let number = number.ok_or_else(|| error(format_args!("Invalid media source id")))?;
            if IS_MAC { it.tell(To::MoveAbove(number)) } else { it.raise() }
        };
        set_aspect_ratio(ratio: f64, extra: Option<&DesktopRectangle>) => |it| {
            let extra = extra.map_or_else(Size::default, |it| size(it.width.unwrap_or(0.), it.height.unwrap_or(0.)));
            it.tell(To::AspectRatio { ratio: finite(ratio), extra })
        };
        set_progress_bar(done: f64) => |it| {
            it.check()?;
            tell_system(SystemCommand::Progress { done: finite(done), app_id: paths::identifier()?.into() })
        };
        invalidate_shadow() => |it| it.tell(To::InvalidateShadow);
        select_next_tab() => |it| it.tell(To::TabAction("selectNextTab:".into()));
        select_previous_tab() => |it| it.tell(To::TabAction("selectPreviousTab:".into()));
        show_all_tabs() => |it| it.tell(To::TabAction("toggleTabOverview:".into()));
        merge_all_windows() => |it| it.tell(To::TabAction("mergeAllWindows:".into()));
        move_tab_to_new_window() => |it| it.tell(To::TabAction("moveTabToNewWindow:".into()));
        toggle_tab_bar() => |it| it.tell(To::TabAction("toggleTabBar:".into()));
        add_tabbed_window(tab: &Window) => |it| {
            if same(it, tab) {
                return Err(error(format_args!("AddTabbedWindow cannot be called by a window on itself.")));
            }
            it.tell(To::AddTab(tab.id))
        };
        preview_file(path: &[u8], name: Option<&[u8]>) => |it| {
            it.tell(To::Preview { path: Text::lossy(path), name: Text::lossy(name.unwrap_or(path)) })
        };
        close_file_preview() => |it| it.tell(To::ClosePreview);
        minimize() => |it| it.tell(To::Minimize);
        restore() => |it| it.tell(To::Restore);
        maximize() => |it| it.zoom_frame(true);
        unmaximize() => |it| it.zoom_frame(false);
        set_full_screen(on: bool) => |it| it.tell(To::Fullscreen(on));
        set_bounds(to: &DesktopRectangle, animates: bool) => |it| it.change_bounds(to, animates);
        set_content_bounds(to: &DesktopRectangle, animates: bool) => |it| {
            let bar = f64::from(it.above_content());
            let (y, height) = (to.y.map(|it| it - bar), to.height.map(|it| it + bar));
            it.change_bounds(&DesktopRectangle { y, height, ..*to }, animates)
        };
        set_size(width: f64, height: f64) => |it| it.tell(To::Size(it.within_limits(size(width, height))));
        set_content_size(width: f64, height: f64) => |it| {
            it.tell(To::Size(it.within_limits(size(width, height + f64::from(it.above_content())))))
        };
        set_position(x: f64, y: f64) => |it| it.tell(To::Position(Point { x: finite(x), y: finite(y) }));
        center() => |it| it.move_to_center();
        set_minimum_size(width: f64, height: f64) => |it| {
            it.change_limits(Limits { min: size(width, height), ..it.limits.get() })
        };
        set_maximum_size(width: f64, height: f64) => |it| {
            it.change_limits(Limits { max: at_most(finite(width), finite(height)), ..it.limits.get() })
        };
        set_resizable(is_resizable: bool) => |it| it.change_limits(Limits { is_resizable, ..it.limits.get() });
        set_title(title: &[u8]) => |it| it.change_title(string(title));
        set_represented_filename(path: &[u8]) => |it| {
            it.represented_filename.replace(string(path));
            it.set(To::RepresentedFilename(Text::lossy(path)))
        };
        set_skip_taskbar(on: bool) => |it| it.set(To::SkipTaskbar(on));
        set_opacity(opacity: f64) => |it| it.change_opacity(opacity);
        set_ignore_mouse_events(on: bool) => |it| it.set(To::IgnoreMouseEvents(on));
        flash_frame(on: bool) => |it| it.tell(To::Attention(on));
        set_background_color(color: &[u8]) => |it| it.change_background_color(match it.is_a::<DesktopWindow>() {
            true => strict_color(color)?,
            false => electron_color(color),
        });
        set_vibrancy(kind: Option<&[u8]>) => |it| it.tell(To::Background(background(kind, it.effect, it.is_transparent)));
        set_background_material(material: Option<&[u8]>) => |it| {
            it.tell(To::Background(background(None, it.effect, is_see_through(material))))
        };
        set_title_bar_overlay(options: &OverlayOptions) => |it| it.change_overlay(options);
        set_window_button_visibility(on: bool) => |it| {
            it.style(WindowStyle { buttons: Maybe::Yes(on), ..Default::default() })
        };
        set_window_button_position(position: Option<&DesktopPoint>) => |it| {
            let position = position.map_or(Point { x: 7., y: 6. }, Point::from);
            if IS_MAC {
                it.tell(To::TrafficLights(position))?;
                it.traffic_lights.set(Some(position));
            }
            Ok(())
        };
        show_on_all_workspaces(on: bool, options: Option<&WorkspaceOptions>) => |it| {
            it.visible_on_all_workspaces.set(on);
            it.set(To::AllWorkspaces(on))?;
            if !options.is_some_and(|it| it.visible_on_full_screen) {
                return Ok(());
            }
            it.style(WindowStyle { visible_on_full_screen: Maybe::Yes(on), ..Default::default() })
        };
        set_always_on_top(on: bool, level: Option<&[u8]>, relative_level: i32) => |it| {
            let level: i32 = match level.unwrap_or_default() {
                b"normal" => 0,
                b"modal-panel" => 8,
                b"dock" => 20,
                b"main-menu" => 24,
                b"status" => 25,
                b"pop-up-menu" => 101,
                b"screen-saver" => 1000,
                _ => 3,
            };
            it.keep_on_top(on, level.saturating_add(relative_level))
        };
        set_parent_window(parent: Option<&Window>) => |it| {
            if it.is_modal {
                return Err(error(format_args!("Can not be called for modal window")));
            }
            fields::set_parent(it, parent);
            if IS_MAC && it.is_shown.get() { it.tell(To::Parent(parent.map(|it| it.id).into())) } else { it.check() }
        };
        set_content_view(view: &View) => |it| it.show_view(view);
        set_menu(menu: Option<&Menu>) => |it| {
            if !IS_MAC {
                it.has_own_menu.set(true);
                fields::set_menu(it, menu);
            }
            it.update_menus()
        };
        hide() => |it| {
            if cover::is_shown_in(it.id) {
                cover::end(false, Vec::new())?;
            }
            if !it.is_shown.get() {
                return Ok(());
            }
            if IS_MAC {
                it.leave_parent()?;
            }
            it.is_shown.set(false);
            it.tell(To::Hide)?;
            if windows().focused.get() == Some(it.id) {
                it.focus_changed(false)?;
            }
            it.tell_contents_and_emit("hide")
        };
    }

    questions! {
        is_visible -> bool => |it| it.is_on_screen();
        is_focused -> bool => |it| it.has_focus();
        is_minimized -> bool => |it| it.is_in_dock();
        is_maximized -> bool => |it| it.fills_work_area();
        get_full_screen -> bool => |it| it.fills_screen();
        is_normal -> bool => |it| {
            let geometry = it.ask_geometry()?;
            Ok(!geometry.is_maximized && !geometry.is_fullscreen && !it.ask(ui()?.window_is_minimized)?)
        };
        get_bounds -> JSValue => |it| js(screen::whole(it.bounds()?));
        get_content_bounds -> JSValue => |it| js(screen::whole(it.content_bounds()?));
        get_normal_bounds -> JSValue => |it| js(screen::whole(it.normal_bounds.get()));
        get_size -> [f64; 2] => |it| it.bounds().map(|it| pair(it.width, it.height));
        get_content_size -> [f64; 2] => |it| it.content_bounds().map(|it| pair(it.width, it.height));
        get_position -> [f64; 2] => |it| it.bounds().map(|it| pair(it.x, it.y));
        get_window_button_position -> JSValue => |it| js(it.traffic_lights.get().filter(|_| IS_MAC));
        get_native_window_handle -> JSValue => |it| {
            JSValue::create_buffer_from_box(global(), Box::new(it.ask(ui()?.window_handle)?.to_le_bytes()))
        };
        get_media_source_id -> String => |it| {
            let number = it.ask(if IS_MAC { ui()?.window_number } else { ui()?.window_handle })?;
            Ok(format!("window:{number}:0"))
        };
        get_child_windows -> JSValue => |it| {
            array(&it.children().iter().map(|it| it.get().to_js()).collect::<Vec<_>>())
        };
    }

    pub(crate) fn get_id(&self) -> u32 {
        self.id
    }

    pub(crate) fn get_title(&self) -> String {
        self.title.borrow().clone()
    }

    pub(crate) fn get_accessible_title(&self) -> String {
        self.accessible_title
            .borrow()
            .clone()
            .unwrap_or_else(|| self.get_title())
    }

    pub(crate) fn set_accessible_title(&self, title: &[u8]) {
        self.accessible_title.replace(Some(string(title)));
    }

    pub(crate) fn get_device_pixel_ratio(&self) -> f64 {
        self.geometry.get().scale.into()
    }

    pub(crate) fn get_tabbing_identifier(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let identifier = Some(&*self.tabbing_identifier).filter(|it| !it.is_empty());
        bun_ui::value::or_undefined(identifier, global())
    }

    pub(crate) fn get_content_view(&self, _: Cx<'_, '_>) -> JsResult<&View> {
        self.content_view()
    }

    pub(crate) fn get_represented_filename(&self) -> String {
        self.represented_filename.borrow().clone()
    }

    pub(crate) fn get_resizable(&self) -> bool {
        self.limits.get().is_resizable
    }

    pub(crate) fn is_always_on_top(&self) -> bool {
        self.always_on_top.get()
    }

    pub(crate) fn is_destroyed(&self) -> bool {
        self.is_destroyed.get()
    }

    pub(crate) fn is_modal(&self) -> bool {
        self.is_modal
    }

    pub(crate) fn get_minimum_size(&self) -> [f64; 2] {
        pair(self.limits.get().min.width, self.limits.get().min.height)
    }

    pub(crate) fn get_maximum_size(&self) -> [f64; 2] {
        self.limits
            .get()
            .max
            .get()
            .map_or([0.; 2], |it| pair(it.width, it.height))
    }

    pub(crate) fn get_opacity(&self) -> f64 {
        self.opacity.get().unwrap_or(1.)
    }

    pub(crate) fn get_background_color(&self) -> String {
        format!("#{:06X}", self.background_color.get() >> 8)
    }

    pub(crate) fn get_parent_window(&self) -> Option<&Window> {
        fields::parent(self)
    }

    pub(crate) fn remove_menu(&self, cx: Cx<'_, '_>) -> JsResult<()> {
        self.set_menu(cx, None)
    }

    pub(crate) fn send_input_event(&self, _: Cx<'_, '_>, it: &InputInit) -> JsResult<()> {
        self.check()?;
        synthesize(self.id, it)
    }
}

/// By a value of the option `vibrancy`.
fn material(name: &[u8]) -> Material {
    match name {
        b"titlebar" => Material::Titlebar,
        b"selection" => Material::Selection,
        b"menu" => Material::Menu,
        b"popover" => Material::Popover,
        b"sidebar" => Material::Sidebar,
        b"header" => Material::Header,
        b"sheet" => Material::Sheet,
        b"window" => Material::Window,
        b"hud" => Material::Hud,
        b"fullscreen-ui" => Material::FullscreenUi,
        b"tooltip" => Material::Tooltip,
        b"content" => Material::Content,
        b"under-page" => Material::UnderPage,
        _ => Material::UnderWindow,
    }
}

/// By a value of the option `visualEffectState`.
fn effect_state(name: &[u8]) -> EffectState {
    match name {
        b"active" => EffectState::Active,
        b"inactive" => EffectState::Inactive,
        _ => EffectState::FollowsWindow,
    }
}

pub(crate) fn synthesize(window: u32, it: &InputInit) -> JsResult<()> {
    let mut modifiers = 0;
    for name in it.modifiers.iter().flatten() {
        modifiers |= accelerator::parse(&(string(name) + "+a"))?.modifiers;
    }
    let point = |x: Option<f64>, y: Option<f64>| Point {
        x: x.map_or(0., finite),
        y: y.map_or(0., finite),
    };
    let at = point(it.x, it.y);
    let mouse = |action| Synthetic::Mouse {
        action,
        at,
        button: match it.button.as_deref() {
            Some(b"middle") => 1,
            Some(b"right") => 2,
            _ => 0,
        },
        clicks: it.click_count.unwrap_or(1.) as u32,
    };
    let text = it.text.as_deref().map(Text::lossy);
    let input = match &*it.kind {
        b"mouseDown" => mouse(MouseAction::Down),
        b"mouseUp" => mouse(MouseAction::Up),
        b"mouseMove" => mouse(MouseAction::Move),
        b"mouseLeave" => mouse(MouseAction::Leave),
        b"mouseWheel" => Synthetic::Wheel {
            at,
            delta: point(it.delta_x, it.delta_y),
        },
        kind @ (b"keyDown" | b"keyUp") => {
            let code = string(it.key_code.as_deref().unwrap_or_default());
            let chord = accelerator::parse(&code)?;
            modifiers |= chord.modifiers;
            let typed = match &*chord.key {
                _ if modifiers & !SHIFT != 0 => None,
                "space" => Some(" ".into()),
                key if key.chars().count() > 1 => None,
                key if modifiers != 0 => Some(key.to_uppercase()),
                _ if code == "Plus" => Some("+".into()),
                _ => Some(code),
            };
            Synthetic::Key {
                is_down: kind == b"keyDown",
                is_repeat: it.repeat,
                key: SyntheticKey::Labelled(chord.key),
                code: Maybe::No,
                text: typed.map(Text::from).or(text).into(),
            }
        }
        b"char" => Synthetic::Text(text.ok_or_else(|| error(format_args!("the text is missing")))?),
        b"drop" => Synthetic::Drop {
            at,
            paths: it
                .files
                .iter()
                .flatten()
                .map(|it| Text::lossy(it))
                .collect(),
        },
        other => return Err(error(format_args!("unknown input event {}", string(other)))),
    };
    queue::render(global())?;
    bun_ui::perform(
        global(),
        Command::Synthesize {
            window,
            modifiers,
            input,
        },
    )
}
