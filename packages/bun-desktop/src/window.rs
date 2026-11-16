//! Windows. Surfaces outlive the platform's window, so hiding one can close it where there is no other way.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result};
use gpui::WindowButton;
use gpui::{
    App, AppContext as _, Bounds, Context, Decorations, Element, ElementId, FocusHandle,
    GlobalElementId, Hitbox, HitboxBehavior, InspectorElementId, IntoElement, LayoutId, Pixels,
    Render, Style, Subscription, TitlebarOptions, Window, WindowAppearance,
    WindowBackgroundAppearance, WindowBounds, WindowControlArea, WindowDecorations, WindowHandle,
    WindowId, WindowKind, WindowOptions, embed, point, px, relative, size,
};
use parking_lot::Mutex;
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::abi::Rect;
use crate::input::{self, Pointer, TextInput};
use crate::paint::cpu;
use crate::paint::gpu::{self, Placement};
use crate::paint::raster::IntRect;
use crate::paint::scene::Frame;
use crate::paint::software::Compositor;
use crate::{accessibility, bridge, diagnostics, frame, host, images, native, surface, text};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub id: u32,
    pub title: String,
    pub x: Option<f32>,
    pub y: Option<f32>,
    pub width: f32,
    pub height: f32,
    pub min_width: f32,
    pub min_height: f32,
    pub show: bool,
    pub focus: bool,
    pub frame: bool,
    pub hidden_title_bar: bool,
    pub traffic_light_position: Option<(f32, f32)>,
    pub background: String,
    pub background_color: Option<u32>,
    pub resizable: bool,
    pub movable: bool,
    #[serde(default)]
    pub accept_first_mouse: bool,
    pub minimizable: bool,
    pub kind: String,
    pub maximized: bool,
    pub fullscreen: bool,
    pub app_id: Option<String>,
    pub icon: Option<u32>,
    pub overlay: Option<frame::Overlay>,
    #[serde(skip)]
    pub cover: Option<u32>,
}

#[derive(Clone, Copy, PartialEq)]
pub struct Metrics {
    pub width: f32,
    pub height: f32,
    pub scale: f32,
    /// On the screen.
    pub origin: (f32, f32),
    /// What `frame` leaves to the surfaces.
    pub content: Rect,
    pub has_border: bool,
    pub has_resize_handles: bool,
}

pub struct WindowState {
    pub id: u32,
    pub options: RefCell<Options>,
    pub metrics: Cell<Metrics>,
    /// From the bottom to the top.
    pub surfaces: RefCell<Vec<u32>>,
    pub focused_surface: Cell<Option<u32>>,
    /// It is drawn in place of the surfaces and gets their input.
    pub cover: Cell<Option<u32>>,
    /// What is left of it, over the surfaces.
    pub kept_cover: Cell<Option<u32>>,
    pub is_active: Cell<bool>,
    pub is_accessible: Cell<bool>,
    pub pointer: Pointer,
    pub frame_buttons: RefCell<frame::Buttons>,
    /// The platform asks for frames.
    is_shown: Cell<bool>,
    /// It has to be drawn.
    is_stale: Cell<bool>,
    redraw_at: Cell<Option<Instant>>,
    draw_at: Cell<Option<Instant>>,
    icon: Option<Arc<image::RgbaImage>>,
}

impl WindowState {
    pub fn key_target(&self) -> Option<u32> {
        self.cover.get().or(self.focused_surface.get())
    }

    fn set_metrics(&self, metrics: Metrics) {
        if self.metrics.replace(metrics) != metrics {
            surface::in_window(self)
                .iter()
                .for_each(|surface| surface.borrow_mut().place_in(self, false));
        }
    }

    #[cfg(target_os = "macos")]
    pub fn is_shown(&self) -> bool {
        self.is_shown.get()
    }

    /// For a window that the platform does not know.
    pub fn resize(&self, width: f32, height: f32) {
        let content = Rect {
            x: 0.,
            y: 0.,
            width,
            height,
        };
        self.set_metrics(Metrics {
            width,
            height,
            content,
            ..self.metrics.get()
        });
    }

    fn measure(&self, window: &Window) {
        let (bounds, viewport, options) = (
            window.bounds(),
            window.viewport_size(),
            self.options.borrow(),
        );
        let (width, height) = (f32::from(viewport.width), f32::from(viewport.height));
        let is_client_decorated = matches!(window.window_decorations(), Decorations::Client { .. });
        let fills_screen = window.is_fullscreen() || window.is_maximized();
        let draws_frame = is_client_decorated && options.frame && !window.is_fullscreen();
        let top = if draws_frame && !options.hidden_title_bar {
            frame::TITLEBAR_HEIGHT
        } else {
            0.
        };
        self.set_metrics(Metrics {
            width,
            height,
            scale: window.scale_factor(),
            origin: (
                bounds.origin.x.into(),
                (bounds.bottom() - viewport.height).into(),
            ),
            content: Rect {
                x: 0.,
                y: top,
                width,
                height: (height - top).max(0.),
            },
            has_border: top > 0. && !fills_screen,
            has_resize_handles: is_client_decorated && options.resizable && !fills_screen,
        });
    }
}

struct Entry {
    state: Rc<WindowState>,
    handle: Option<WindowHandle<RootView>>,
}

thread_local! {
    static WINDOWS: RefCell<FxHashMap<u32, Entry>> = RefCell::default();
    static COMPOSITORS: RefCell<FxHashMap<WindowId, Arc<Mutex<Compositor>>>> = RefCell::default();
}

fn compositor(id: WindowId) -> Option<Arc<Mutex<Compositor>>> {
    COMPOSITORS.with_borrow(|it| it.get(&id).cloned())
}

const WAIT_FOR_IMAGES: Duration = Duration::from_millis(24);

pub fn next_redraw() -> Option<Instant> {
    WINDOWS.with_borrow(|windows| {
        windows
            .values()
            .filter(|it| it.state.is_shown.get())
            .flat_map(|it| [it.state.redraw_at.get(), it.state.draw_at.get()])
            .flatten()
            .min()
    })
}

pub fn redraw_what_is_due() {
    let now = Instant::now();
    if next_redraw().is_some_and(|time| time <= now) {
        let take_due = |time: &Cell<Option<Instant>>| {
            time.get().is_some_and(|it| it <= now) && time.take().is_some()
        };
        for state in ids().into_iter().filter_map(|id| state(id).ok()) {
            if take_due(&state.redraw_at) {
                refresh(state.id);
            }
            if take_due(&state.draw_at) {
                draw_now(state.id);
            }
        }
    }
}

pub fn any_is_stale() -> bool {
    WINDOWS.with_borrow(|windows| {
        windows
            .values()
            .any(|it| it.state.is_stale.get() && it.state.is_shown.get())
    })
}

pub fn painter(id: WindowId) -> Option<embed::Painter> {
    let compositor = compositor(id)?;
    Some(Box::new(move |pixels| compositor.lock().paint(pixels)))
}

#[cfg(target_os = "macos")]
pub mod layers {
    use objc2::rc::Retained;
    use objc2_quartz_core::{CALayer, CATransaction};

    use super::*;
    use crate::paint::layers::core_animation::Tree;
    use crate::paint::layers::{Layers, SPARES_LAST};

    thread_local! {
        static LAYERS: RefCell<FxHashMap<WindowId, Layers<Tree>>> = RefCell::default();
        static HAS_CHANGES: Cell<bool> = const { Cell::new(false) };
        static RELEASE_AT: Cell<Option<Instant>> = const { Cell::new(None) };
    }

    pub fn present(id: WindowId, root: Retained<CALayer>) {
        let (Some(compositor), Some(state)) = (compositor(id), state_for(id)) else {
            return;
        };
        let options = state.options.borrow();
        let is_opaque = options
            .background_color
            .map_or(options.background == "opaque", |color| color & 0xFF == 0xFF);
        let Metrics {
            width,
            height,
            scale,
            ..
        } = state.metrics.get();
        LAYERS.with_borrow_mut(|all| {
            let layers = all
                .entry(id)
                .or_insert_with(|| Layers::new(Tree::new(root, native::draws_layers_with_gpu())));
            layers.target.begin(scale.into(), is_opaque);
            layers.paint(
                &mut compositor.lock(),
                (width * scale).ceil() as i32,
                (height * scale).ceil() as i32,
            );
        });
        HAS_CHANGES.set(true);
        RELEASE_AT.set(
            RELEASE_AT
                .get()
                .or_else(|| Some(Instant::now() + SPARES_LAST)),
        );
    }

    /// Not from inside of AppKit, which commits what belongs together.
    pub fn flush() {
        if HAS_CHANGES.take() {
            CATransaction::flush();
        }
    }

    pub fn next_release() -> Option<Instant> {
        RELEASE_AT.get()
    }

    pub fn release_what_is_due() {
        if RELEASE_AT.get().is_some_and(|time| time <= Instant::now()) {
            LAYERS.with_borrow_mut(|all| {
                all.values_mut()
                    .for_each(|layers| layers.release_spares(SPARES_LAST))
            });
            let has_spares = LAYERS.with_borrow(|all| all.values().any(Layers::has_spares));
            crate::allocator::release_memory();
            RELEASE_AT.set(has_spares.then(|| Instant::now() + SPARES_LAST * 2));
        }
    }

    pub(super) fn forget_contents(id: WindowId) {
        LAYERS.with_borrow_mut(|all| {
            if let Some(layers) = all.get_mut(&id) {
                layers.forget_contents();
                layers.target.release_memory();
            }
        });
    }

    pub fn remove(id: WindowId) {
        LAYERS.with_borrow_mut(|all| all.remove(&id));
    }
}

#[cfg(target_os = "macos")]
pub fn was_hidden(id: u32) {
    state(id).map(|state| state.is_shown.set(false)).ok();
}

/// So that it does not appear empty.
#[cfg(target_os = "macos")]
pub fn draw_before_showing(id: u32) {
    if let Ok(state) = state(id) {
        state.is_shown.set(true);
        refresh(id);
        draw_now(id);
    }
}

pub fn is_dark(appearance: WindowAppearance) -> bool {
    matches!(
        crate::app::appearance_override().unwrap_or(appearance),
        WindowAppearance::Dark | WindowAppearance::VibrantDark
    )
}

pub fn state(id: u32) -> Result<Rc<WindowState>> {
    WINDOWS
        .with_borrow(|windows| Some(windows.get(&id)?.state.clone()))
        .context("the window was destroyed")
}

pub fn handle(id: u32) -> Option<WindowHandle<RootView>> {
    WINDOWS.with_borrow(|windows| windows.get(&id)?.handle)
}

pub fn ids() -> Vec<u32> {
    WINDOWS.with_borrow(|windows| windows.keys().copied().collect())
}

pub fn state_for(id: WindowId) -> Option<Rc<WindowState>> {
    WINDOWS.with_borrow(|windows| {
        let entry = windows
            .values()
            .find(|entry| entry.handle.is_some_and(|handle| handle.window_id() == id));
        Some(entry?.state.clone())
    })
}

/// Does nothing while GPUI is busy, which only happens while it is about to draw the window.
pub fn refresh(id: u32) {
    if let (Some(handle), Ok(state)) = (handle(id), state(id)) {
        state.is_stale.set(true);
        host::update_window(handle.into(), |window, _| window.refresh()).ok();
    }
}

/// Also from a callback of GPUI.
pub fn draw_soon(id: u32) {
    if let Ok(state) = state(id) {
        let now = Some(Instant::now());
        state.redraw_at.set(now);
        state.draw_at.set(now);
        host::present_at_once();
    }
}

/// For what missed its frame.
pub fn draw_now(id: u32) {
    const RETRY: Duration = Duration::from_micros(300);
    let (Some(handle), Ok(state)) = (handle(id), state(id)) else {
        return;
    };
    if state.is_shown.get() && !host::is_about_to_draw(handle.window_id()) {
        let is_done =
            host::update_window(handle.into(), |window, cx| window.draw_now(cx)).unwrap_or(true);
        state
            .draw_at
            .set((!is_done).then(|| Instant::now() + RETRY));
    }
}

/// Returns whether the platform is expected to ask for one.
pub fn request_frame(id: u32) -> bool {
    let handle = handle(id).filter(|_| state(id).is_ok_and(|state| state.is_shown.get()));
    handle.is_some_and(|handle| {
        host::update_window(handle.into(), |window, _| window.wake_frame_source()).is_ok()
    })
}

/// `Ok(None)` while the window is hidden and has no platform window.
pub fn update<R>(
    id: u32,
    cx: &mut App,
    f: impl FnOnce(&mut Window, &mut App) -> R,
) -> Result<Option<R>> {
    state(id)?;
    handle(id)
        .map(|handle| {
            cx.update_window(handle.into(), |_, window, cx| {
                crate::app::catch_exception(|| f(window, cx))
            })?
        })
        .transpose()
}

pub fn create(mut options: Options, cx: &mut App) -> Result<()> {
    let icon = options.icon.take().and_then(bridge::take_blob);
    let (id, show) = (options.id, options.show);
    let state = Rc::new(WindowState {
        id,
        metrics: Cell::new(Metrics {
            width: options.width,
            height: options.height,
            scale: 1.,
            origin: (options.x.unwrap_or(0.), options.y.unwrap_or(0.)),
            content: Rect {
                x: 0.,
                y: 0.,
                width: options.width,
                height: options.height,
            },
            has_border: false,
            has_resize_handles: false,
        }),
        surfaces: RefCell::default(),
        focused_surface: Cell::default(),
        cover: Cell::new(options.cover.take()),
        kept_cover: Cell::default(),
        is_active: Cell::default(),
        is_accessible: Cell::default(),
        pointer: Pointer::default(),
        frame_buttons: RefCell::default(),
        is_shown: Cell::default(),
        is_stale: Cell::default(),
        redraw_at: Cell::default(),
        draw_at: Cell::default(),
        icon: icon
            .map(|bytes| image::load_from_memory(&bytes))
            .transpose()
            .context("could not decode the window's icon")?
            .map(|icon| Arc::new(icon.into_rgba8())),
        options: RefCell::new(options),
    });
    WINDOWS.with_borrow_mut(|windows| {
        windows.insert(
            id,
            Entry {
                state,
                handle: None,
            },
        )
    });
    if show || crate::native::CAN_OPEN_HIDDEN {
        let opened = open(id, cx);
        if opened.is_err() {
            WINDOWS.with_borrow_mut(|windows| windows.remove(&id));
        }
        return opened;
    }
    Ok(())
}

pub fn open(id: u32, cx: &mut App) -> Result<()> {
    let state = state(id)?;
    let options = state.options.borrow().clone();
    let extent = size(px(options.width), px(options.height));
    let bounds = match (options.x, options.y) {
        (Some(x), Some(y)) => Bounds::new(point(px(x), px(y)), extent),
        _ => Bounds::centered(None, extent, cx),
    };
    let is_shown_when_drawn =
        cfg!(target_os = "macos") && !options.fullscreen && options.kind != "dialog";
    let custom_titlebar = !options.frame || options.hidden_title_bar;
    let platform_options = || WindowOptions {
        window_bounds: Some(if options.fullscreen {
            WindowBounds::Fullscreen(bounds)
        } else if options.maximized && !is_shown_when_drawn {
            WindowBounds::Maximized(bounds)
        } else {
            WindowBounds::Windowed(bounds)
        }),
        titlebar: (options.frame || !cfg!(target_os = "macos")).then(|| TitlebarOptions {
            title: Some(options.title.clone().into()),
            appears_transparent: custom_titlebar,
            traffic_light_position: options
                .traffic_light_position
                .map(|(x, y)| point(px(x), px(y))),
        }),
        focus: options.focus,
        show: options.show && !is_shown_when_drawn,
        kind: match options.kind.as_str() {
            "popup" => WindowKind::PopUp,
            "floating" if cfg!(target_os = "macos") => WindowKind::PopUp,
            "floating" => WindowKind::Floating,
            "dialog" => WindowKind::Dialog,
            _ => WindowKind::Normal,
        },
        is_movable: options.movable,
        app_owns_titlebar_drag: custom_titlebar,
        is_resizable: options.resizable,
        is_minimizable: options.minimizable,
        window_background: background_appearance(&options.background),
        app_id: options.app_id.clone(),
        window_min_size: Some(size(px(options.min_width), px(options.min_height))),
        window_decorations: Some(match custom_titlebar {
            true => WindowDecorations::Client,
            false => WindowDecorations::Server,
        }),
        icon: state.icon.clone(),
        inactive_frame_interval: None,
        low_power_frame_interval: None,
        thermal_frame_interval: None,
        ..WindowOptions::default()
    };
    let mut open = || {
        cx.open_window(platform_options(), |window, cx| {
            window.set_window_title(&options.title);
            cx.new(|cx| RootView::new(state.clone(), window, cx))
        })
    };
    let handle = open().or_else(|error| {
        if native::switch_renderer() {
            open()
        } else {
            Err(error)
        }
    })?;
    WINDOWS.with_borrow_mut(|windows| {
        if let Some(entry) = windows.get_mut(&id) {
            entry.handle = Some(handle);
        }
    });
    #[cfg(target_os = "macos")]
    if is_shown_when_drawn {
        let native = handle.update(cx, |_, window, _| native::NativeWindow::of(window))?;
        crate::app::after_update(move || {
            if options.maximized {
                was_hidden(id);
                native.zoom()?;
            }
            if options.show && self::handle(id).is_some() {
                draw_before_showing(id);
                native.set_visible(true, options.focus)?;
                request_frame(id);
            }
            Ok(())
        });
    }
    Ok(())
}

pub fn background_appearance(name: &str) -> WindowBackgroundAppearance {
    match name {
        "transparent" => WindowBackgroundAppearance::Transparent,
        _ if cfg!(target_os = "macos") && name != "opaque" => {
            WindowBackgroundAppearance::Transparent
        }
        "blurred" => WindowBackgroundAppearance::Blurred,
        "mica" => WindowBackgroundAppearance::MicaBackdrop,
        "tabbed" => WindowBackgroundAppearance::MicaAltBackdrop,
        _ => WindowBackgroundAppearance::Opaque,
    }
}

/// Closes the platform's window and keeps what `open` needs to bring it back.
pub fn close_platform_window(id: u32, cx: &mut App) -> Result<()> {
    let state = state(id)?;
    update(id, cx, |window, _| {
        let mut options = state.options.borrow_mut();
        let bounds = window.window_bounds();
        options.maximized = matches!(bounds, WindowBounds::Maximized(_));
        options.fullscreen = matches!(bounds, WindowBounds::Fullscreen(_));
        let bounds = bounds.get_bounds();
        (options.x, options.y) = (Some(bounds.origin.x.into()), Some(bounds.origin.y.into()));
        (options.width, options.height) = (bounds.size.width.into(), bounds.size.height.into());
        host::forget_frames(window.window_handle().window_id());
        WINDOWS.with_borrow_mut(|windows| windows.get_mut(&id)?.handle.take());
        window.remove_window();
    })?;
    state.is_shown.set(false);
    state.is_accessible.set(false);
    input::activation_changed(&state, false);
    cx.defer(|_| release_memory());
    Ok(())
}

pub fn destroy(id: u32, cx: &mut App) -> Result<()> {
    close_platform_window(id, cx)?;
    forget(id);
    Ok(())
}

fn forget(id: u32) {
    if let Some(entry) = WINDOWS.with_borrow_mut(|windows| windows.remove(&id)) {
        surface::in_window(&entry.state)
            .iter()
            .for_each(|surface| surface.borrow_mut().window = None);
    }
}

pub fn init(cx: &mut App) {
    cx.on_window_closed(|_, closed| {
        COMPOSITORS.with_borrow_mut(|it| it.remove(&closed));
        #[cfg(target_os = "macos")]
        layers::remove(closed);
        // Only a window that the platform closed on its own still has its handle here.
        if let Some(state) = state_for(closed) {
            host::forget_frames(closed);
            forget(state.id);
            bridge::emit(json!({ "t": "window", "w": state.id, "e": "closed" }));
        }
    })
    .detach();
}

pub fn geometry(window: &Window) -> Value {
    let (bounds, viewport) = (window.bounds(), window.viewport_size());
    json!({
        "x": f32::from(bounds.origin.x),
        "y": f32::from(bounds.origin.y),
        "width": f32::from(viewport.width),
        "height": f32::from(viewport.height),
        "maximized": window.is_maximized(),
        "fullscreen": window.is_fullscreen(),
        "scale": window.scale_factor(),
    })
}

/// What can be computed again.
fn release_memory() {
    surface::release_memory();
    images::release_memory();
    cpu::release_memory();
    text::release_memory();
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: it has no preconditions.
    unsafe {
        libc::malloc_trim(0);
    }
    #[cfg(target_os = "macos")]
    crate::allocator::release_memory();
}

fn forget_what_was_drawn(window: &mut Window, cache: &mut gpu::Cache) {
    if let Some(compositor) = compositor(window.window_handle().window_id()) {
        let old = std::mem::take(&mut *compositor.lock());
        cache.clear(&old.atlas);
        old.atlas.unload(&*window.sprite_atlas());
    }
    #[cfg(target_os = "macos")]
    layers::forget_contents(window.window_handle().window_id());
    release_memory();
    window.refresh();
}

pub struct RootView {
    content: Content,
    _subscriptions: Vec<Subscription>,
}

impl RootView {
    fn new(state: Rc<WindowState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let id = state.id;
        window.on_window_should_close(cx, move |_, _| {
            bridge::emit(json!({ "t": "window", "w": id, "e": "close" }));
            false
        });
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        let has_display = !crate::app::is_headless(cx);
        #[cfg(target_os = "macos")]
        native::NativeWindow::of(window).was_created(&state.options.borrow());
        state
            .is_shown
            .set(has_display && state.options.borrow().show);
        state.measure(window);
        let cache = Rc::<RefCell<gpu::Cache>>::default();
        cache.borrow_mut().is_software = has_display && native::paints_pixels();
        COMPOSITORS
            .with_borrow_mut(|it| it.insert(window.window_handle().window_id(), Arc::default()));
        let subscriptions = vec![
            cx.observe_window_bounds(window, move |view, window, _| {
                bridge::emit_latest(
                    json!({ "t": "window", "w": id, "e": "bounds", "v": geometry(window) }),
                );
                view.content.state.measure(window);
            }),
            cx.observe_window_activation(window, move |view, window, _| {
                let event = if window.is_window_active() {
                    "focus"
                } else {
                    "blur"
                };
                bridge::emit(json!({ "t": "window", "w": id, "e": event }));
                input::activation_changed(&view.content.state, window.is_window_active());
            }),
            cx.observe_window_appearance(window, |_, window, _| {
                bridge::emit_latest(json!({ "t": "theme", "dark": is_dark(window.appearance()) }));
            }),
            window.observe_window_visibility({
                let (state, cache) = (state.clone(), cache.clone());
                let release = Cell::new(None);
                move |visibility, window, cx| {
                    const MAY_COME_BACK: Duration = Duration::from_secs(5);
                    let (visible, cache) = (visibility.is_visible(), cache.clone());
                    state.is_shown.set(has_display && visible);
                    release.set((!visible).then(|| {
                        window.spawn(cx, async move |cx| {
                            cx.background_executor().timer(MAY_COME_BACK).await;
                            cx.update(|window, _| {
                                forget_what_was_drawn(window, &mut cache.borrow_mut())
                            })
                            .ok();
                        })
                    }));
                    window.refresh();
                    bridge::emit(
                        json!({ "t": "window", "w": id, "e": "visibility", "v": visible }),
                    );
                }
            }),
        ];
        RootView {
            content: Content {
                state,
                focus,
                cache,
            },
            _subscriptions: subscriptions,
        }
    }
}

impl Render for RootView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        window
            .refresh_interval(cx)
            .into_iter()
            .for_each(host::set_interval);
        self.content.state.measure(window);
        accessibility::observe(&self.content.state, window);
        self.content.clone()
    }
}

#[derive(Clone)]
struct Content {
    state: Rc<WindowState>,
    focus: FocusHandle,
    cache: Rc<RefCell<gpu::Cache>>,
}

/// Whether it is shown, and until when.
fn blink(since: Instant, now: Instant) -> (bool, Instant) {
    const PHASE: Duration = Duration::from_millis(500);
    let phases = (now.saturating_duration_since(since).as_millis() / PHASE.as_millis()) as u32;
    (phases.is_multiple_of(2), since + PHASE * (phases + 1))
}

impl Content {
    /// Returns when it has to be drawn again.
    fn draw(&self, cache: &mut gpu::Cache, window: &mut Window, cx: &App) -> Option<Instant> {
        let (state, compositor) = (
            &*self.state,
            compositor(window.window_handle().window_id())?,
        );
        let (mut compositor, gpu_atlas) = (compositor.lock(), window.sprite_atlas());
        let atlas = &compositor.atlas;
        let (metrics, options) = (state.metrics.get(), state.options.borrow());
        let device = |Rect {
                          x,
                          y,
                          width,
                          height,
                      }: Rect| {
            let scale = metrics.scale;
            IntRect::nearest(Rect {
                x: x * scale,
                y: y * scale,
                width: width * scale,
                height: height * scale,
            })
        };
        let background = match options.background_color {
            Some(color) => color,
            None if options.background == "opaque" => frame::default_background(window),
            None => 0,
        };
        let everything = device(Rect {
            x: 0.,
            y: 0.,
            width: metrics.width,
            height: metrics.height,
        })
        .outset(1);
        let mut redraw_at: Option<Instant> = None;
        let deadline = Instant::now() + WAIT_FOR_IMAGES;
        state.is_stale.set(false);
        state.draw_at.set(None);
        cache.begin(atlas, &*gpu_atlas);
        gpu::fill(cache, everything, background);
        for surface in surface::shown_in(state) {
            let surface = surface.borrow();
            if !surface.is_visible {
                continue;
            }
            let mut frame = Frame::new(metrics.scale * surface.scene.zoom, true);
            frame.deadline = Some(if surface.is_scrolling() {
                frame.now
            } else {
                deadline
            });
            if surface.scene.caret.is_some() && state.is_active.get() {
                let (is_shown, until) = blink(surface.caret_moved_at, frame.now);
                frame.shows_caret = is_shown;
                frame.changes_at(until);
            }
            let rect = device(surface.rect);
            let (origin, clip) = (
                (rect.left, rect.top),
                rect.intersect(device(metrics.content)),
            );
            gpu::paint(
                &surface.scene,
                &frame,
                &Placement {
                    origin,
                    clip,
                    background,
                },
                atlas,
                cache,
            );
            redraw_at = redraw_at
                .into_iter()
                .chain(frame.next_change.get())
                .chain(surface.next_motion())
                .min();
        }
        if state.cover.get().or(state.kept_cover.get()).is_some() {
            cache.expect_other_contents();
        }
        let (scene, buttons) = frame::build(state, window, cx);
        state.frame_buttons.replace(buttons);
        let placement = Placement {
            origin: (0, 0),
            clip: everything,
            background,
        };
        gpu::paint(
            &scene,
            &Frame::new(metrics.scale, false),
            &placement,
            atlas,
            cache,
        );
        match cache.is_software {
            true => cache.finish_in_software(&mut compositor),
            false => cache.finish(atlas, &*gpu_atlas, window.scene_mut()),
        }
        redraw_at
    }
}

impl Element for Content {
    type RequestLayoutState = ();
    /// What Windows is told is the caption.
    type PrepaintState = Vec<(WindowControlArea, Hitbox)>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let style = Style {
            size: size(relative(1.).into(), relative(1.).into()),
            ..Style::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Vec<(WindowControlArea, Hitbox)> {
        window.set_focus_handle(&self.focus, cx);
        let mut captions = Vec::new();
        for surface in surface::shown_in(&self.state)
            .iter()
            .filter(|_| cfg!(target_os = "windows"))
        {
            let surface = surface.borrow();
            if !surface.is_visible || surface.is_passthrough {
                continue;
            }
            let mut cover = |x: f32, y: f32, width: f32, height: f32| {
                let origin = point(px(surface.rect.x + x), px(surface.rect.y + y));
                window.insert_hitbox(
                    Bounds::new(origin, size(px(width), px(height))),
                    HitboxBehavior::BlockMouse,
                )
            };
            cover(0., 0., surface.rect.width, surface.rect.height);
            for region in &surface.scene.regions {
                let (rect, zoom) = (region.rect, surface.scene.zoom);
                let hitbox = cover(
                    rect.x * zoom,
                    rect.y * zoom,
                    rect.width * zoom,
                    rect.height * zoom,
                );
                captions.extend(region.drag.then_some((WindowControlArea::Drag, hitbox)));
            }
        }
        let buttons = self.state.frame_buttons.borrow();
        captions.extend(buttons.iter().filter(|_| cfg!(target_os = "windows")).map(
            |(button, rect)| {
                let bounds = Bounds::new(
                    point(px(rect.x), px(rect.y)),
                    size(px(rect.width), px(rect.height)),
                );
                let area = match button {
                    WindowButton::Minimize => WindowControlArea::Min,
                    WindowButton::Maximize => WindowControlArea::Max,
                    WindowButton::Close => WindowControlArea::Close,
                };
                (
                    area,
                    window.insert_hitbox(bounds, HitboxBehavior::BlockMouse),
                )
            },
        ));
        captions
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        captions: &mut Vec<(WindowControlArea, Hitbox)>,
        window: &mut Window,
        cx: &mut App,
    ) {
        for (area, hitbox) in captions.drain(..) {
            window.insert_window_control_hitbox(area, hitbox);
        }
        window.handle_input(&self.focus, TextInput(self.state.clone()), cx);
        window.set_window_cursor_style(self.state.pointer.cursor());
        let start = diagnostics::logs_frames().then(Instant::now);
        self.state
            .redraw_at
            .set(self.draw(&mut self.cache.borrow_mut(), window, cx));
        if let Some(start) = start {
            log::info!(
                "window {} flattened in {:?}: {}",
                self.state.id,
                start.elapsed(),
                self.cache.borrow().describe()
            );
        }
    }
}
