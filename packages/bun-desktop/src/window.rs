//! Windows.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::abi::Rect;
use crate::diagnostics::Step;
use crate::error::{Context as _, Result};
use crate::hash::FastMap;
use crate::input::{self, Pointer};
use crate::paint::cpu;
use crate::paint::flatten::{self, Placement};
#[cfg(target_os = "macos")]
use crate::paint::layers::{
    Layers, SPARES_LAST,
    core_animation::{self, Tree},
};
use crate::paint::raster::IntRect;
use crate::paint::scene::Frame;
use crate::paint::software::Compositor;
use crate::platform::{self, Geometry, Icon};
pub use crate::protocol::WindowOptions as Options;
use crate::protocol::{Background, Event, Maybe, SystemEvent, WindowEvent};
use crate::surface::Surface;
use crate::sync::Mutex;
use crate::{app, bridge, diagnostics, frame, host, images, surface, text};

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
    pub is_disabled: Cell<bool>,
    pub keeps_cursor: Cell<bool>,
    pub pointer: Pointer,
    pub frame_buttons: RefCell<frame::Buttons>,
    /// The platform asks for frames.
    is_shown: Cell<bool>,
    /// It has to be drawn.
    is_stale: Cell<bool>,
    redraw_at: Cell<Option<Instant>>,
    draw_at: Cell<Option<Instant>>,
    /// How long it has lately taken.
    drawing_time: Cell<Duration>,
    /// When it moved there.
    #[cfg(any(windows, target_os = "macos"))]
    covered_caret: Cell<Option<Instant>>,
    /// By the app, so that it is drawn before it comes back.
    #[cfg(target_os = "macos")]
    was_hidden: Cell<bool>,
    /// The identities of animations, and when that turned out.
    #[cfg(any(windows, target_os = "macos"))]
    unlifted: RefCell<Vec<([f64; 5], Instant)>>,
    forget_at: Cell<Option<Instant>>,
    geometry: Cell<Geometry>,
    cache: RefCell<flatten::Cache>,
    compositor: Arc<Mutex<Compositor>>,
    #[cfg(target_os = "macos")]
    layers: RefCell<Option<Layers<Tree>>>,
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

    #[cfg(any(windows, target_os = "macos"))]
    pub fn is_shown(&self) -> bool {
        self.is_shown.get()
    }

    #[cfg(any(windows, target_os = "macos"))]
    fn is_opaque(&self) -> bool {
        let options = self.options.borrow();
        options
            .background_color
            .get()
            .map_or(options.background == Background::Opaque, |color| {
                color & 0xFF == 0xFF
            })
    }

    fn measure(&self, geometry: Geometry) {
        self.geometry.set(geometry);
        let Geometry {
            width,
            height,
            scale,
            is_client_decorated,
            ..
        } = geometry;
        let options = self.options.borrow();
        let fills_screen = geometry.is_fullscreen || geometry.is_maximized;
        let top = if is_client_decorated {
            geometry.top
        } else {
            0.
        };
        self.set_metrics(Metrics {
            width,
            height: top + height,
            scale,
            origin: (
                geometry.x + geometry.border,
                geometry.y + geometry.top - top,
            ),
            content: Rect {
                x: 0.,
                y: top,
                width,
                height,
            },
            has_border: top > 0. && !fills_screen,
            has_resize_handles: is_client_decorated && options.resizable && !fills_screen,
        });
    }
}

struct Entry {
    state: Rc<WindowState>,
    /// From when it has been opened.
    window: Option<Rc<dyn platform::Window>>,
}

thread_local! {
    static WINDOWS: RefCell<FastMap<u32, Entry>> = RefCell::default();
}

const WAIT_FOR_IMAGES: Duration = Duration::from_millis(24);
pub const LONGEST_FRAME: Duration = Duration::from_secs(2);

pub fn next_redraw() -> Option<Instant> {
    WINDOWS.with_borrow(|windows| {
        let next = |it: &WindowState| match it.is_shown.get() {
            true => [it.redraw_at.get(), it.draw_at.get()],
            false => [it.forget_at.get(), None],
        };
        windows
            .values()
            .flat_map(|it| next(&it.state))
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
            if take_due(&state.forget_at) {
                forget_what_was_drawn(&state);
            }
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

#[cfg(any(windows, target_os = "macos"))]
mod lifting {
    use super::*;
    use crate::paint::flatten::Caret;

    /// Leaves out what the system can move, fade or blink in a layer of its own.
    pub(super) fn flatten(state: &WindowState) -> Option<Caret> {
        const RETRY: Duration = Duration::from_secs(2);
        #[cfg(target_os = "macos")]
        if core_animation::gpu_has_spoiled_surfaces() {
            for state in ids().into_iter().filter_map(|id| super::state(id).ok()) {
                state
                    .layers
                    .borrow_mut()
                    .iter_mut()
                    .for_each(Layers::forget_contents);
                refresh(state.id);
            }
        }
        let surfaces = surface::shown_in(state);
        let moved_at = |it: &Rc<RefCell<Surface>>| {
            Some(it.borrow())
                .filter(|it| it.is_visible && it.scene.caret.is_some())
                .map(|it| it.caret_moved_at)
        };
        let since = surfaces
            .iter()
            .filter_map(moved_at)
            .max()
            .filter(|_| state.is_active.get() && cfg!(target_os = "macos"));
        // The window server misses frames when it does.
        let blinks = !surfaces.iter().any(|it| it.borrow().is_scrolling());
        state
            .unlifted
            .borrow_mut()
            .retain(|(_, when)| when.elapsed() < RETRY);
        loop {
            let since = since.filter(|it| state.covered_caret.get() != Some(*it));
            let mut counts = Vec::new();
            let redraw_at = flatten_surfaces(state, since.is_none(), &mut |surface, count| {
                counts.push((surface, count))
            });
            let (primitives, cache) = (
                &mut state.compositor.lock().primitives,
                &mut *state.cache.borrow_mut(),
            );
            let refused = flatten::lift(primitives, &mut cache.lifted);
            let caret = since.and_then(|since| {
                flatten::lift_caret(primitives).map(|(rect, color)| Caret {
                    rect,
                    color,
                    since,
                    blinks,
                })
            });
            if refused.is_empty() && caret.is_some() == since.is_some() {
                let mut first = 0;
                let next_motion = |(surface, end): (Rc<RefCell<Surface>>, usize)| {
                    let surface = &mut *surface.borrow_mut();
                    surface.motion.set_lifted(
                        cache.lifted[std::mem::replace(&mut first, end)..end]
                            .iter()
                            .map(|it| it.item)
                            .collect(),
                    );
                    surface.keep_moving();
                    surface.next_motion()
                };
                state.redraw_at.set(
                    counts
                        .into_iter()
                        .filter_map(next_motion)
                        .chain(redraw_at)
                        .min(),
                );
                return caret;
            }
            crate::diagnostics::trace!(
                "{} stay, and the caret: {}",
                refused.len(),
                caret.is_some() != since.is_some()
            );
            state
                .unlifted
                .borrow_mut()
                .extend(refused.into_iter().map(|it| (it, Instant::now())));
            state
                .covered_caret
                .set(if caret.is_none() { since } else { None }.or(state.covered_caret.get()));
        }
    }

    pub(super) fn movers<'a>(
        state: &WindowState,
        surface: &'a Surface,
        now: Instant,
    ) -> Vec<flatten::Mover<'a>> {
        let mut movers = surface
            .motion
            .movers(&surface.scene, surface::milliseconds(now));
        movers.retain(|it| {
            state
                .unlifted
                .borrow()
                .iter()
                .all(|(refused, _)| *refused != it.identity())
        });
        #[cfg(target_os = "macos")]
        movers.retain(|_| core_animation::uses_gpu());
        #[cfg(windows)]
        if !movers.is_empty() && platform_window(state.id).is_none_or(|it| !it.can_lift()) {
            movers.clear();
        }
        movers
    }
}

#[cfg(target_os = "macos")]
pub mod layers {
    use super::*;
    use crate::paint::flatten::Caret;
    use crate::paint::software;

    thread_local! {
        static HAS_CHANGES: Cell<bool> = const { Cell::new(false) };
        static RELEASE_AT: Cell<Option<Instant>> = const { Cell::new(None) };
        static PAUSE_AT: Cell<Option<Instant>> = const { Cell::new(None) };
        /// The surface, and the place in its window.
        static POINTER: Cell<Option<(u32, platform::Point)>> = const { Cell::new(None) };
        static LOOK_AT: Cell<Option<Instant>> = const { Cell::new(None) };
    }

    pub(super) fn present(
        state: &WindowState,
        window: &dyn platform::Window,
        mut caret: Option<Caret>,
    ) {
        let Metrics {
            width,
            height,
            scale,
            ..
        } = state.metrics.get();
        let mut borrowed = state.layers.borrow_mut();
        let layers = borrowed.get_or_insert_with(|| Layers::new(Tree::new(window.layer())));
        let all = IntRect::new(
            0,
            0,
            (width * scale).ceil() as i32,
            (height * scale).ceil() as i32,
        );
        layers.target.begin(scale.into(), state.is_opaque());
        let ports: Vec<_> = surface::shown_in(state)
            .iter()
            .filter_map(|it| it.borrow_mut().scrolled_port())
            .collect();
        layers.set_scrolling(ports.first().map(|it| in_pixels(*it, scale)));
        surface::shown_in(state)
            .into_iter()
            .filter_map(|it| it.borrow_mut().take_jump())
            .for_each(|it| layers.note_jump(in_pixels(it, scale)));
        LOOK_AT.set(LOOK_AT.get().or_else(|| {
            POINTER
                .get()
                .map(|_| Instant::now() + Duration::from_millis(500))
        }));
        if layers.frames_scrolled().is_multiple_of(8) {
            let shows = software::see_through(&state.compositor.lock().primitives, all);
            let points = [shows.start, shows.end].map(|it| f64::from(it) / f64::from(scale));
            let [left, right] = window
                .fit_backdrop(points)
                .map(|it| (it * f64::from(scale)).round() as i32);
            layers.keep_apart(left..right);
            layers.target.keep_apart(left..right);
        }
        drop(borrowed);
        let sink = || {
            flatten::sink(
                &mut state.compositor.lock(),
                &mut state.cache.borrow_mut(),
                |contents, paint| {
                    state
                        .layers
                        .borrow_mut()
                        .as_mut()?
                        .target
                        .keep(contents, paint)
                },
            )
        };
        while let Err(refused) = sink() {
            state.unlifted.borrow_mut().push((refused, Instant::now()));
            caret = lifting::flatten(state);
        }
        let (compositor, cache, Some(layers)) = (
            &mut *state.compositor.lock(),
            &mut *state.cache.borrow_mut(),
            &mut *state.layers.borrow_mut(),
        ) else {
            return;
        };
        layers.target.set_holes(
            cache
                .lifted
                .iter()
                .filter(|it| it.depth == flatten::Depth::Ground)
                .map(|it| it.clip),
        );
        layers.paint(compositor, all.right, all.bottom);
        layers.target.show_caret(caret);
        if let Some(port) = ports.first().filter(|_| diagnostics::logs_misses()) {
            layers.target.witness(in_pixels(*port, scale));
        }
        cache.known_contents = layers.target.show_lifted(std::mem::take(&mut cache.lifted));
        HAS_CHANGES.set(true);
        PAUSE_AT.set(
            core_animation::waits_for_pause().then(|| Instant::now() + Duration::from_millis(400)),
        );
        RELEASE_AT.set(
            RELEASE_AT
                .get()
                .or_else(|| Some(Instant::now() + SPARES_LAST)),
        );
    }

    fn in_pixels(
        Rect {
            x,
            y,
            width,
            height,
        }: Rect,
        scale: f32,
    ) -> IntRect {
        IntRect::nearest(Rect {
            x: x * scale,
            y: y * scale,
            width: width * scale,
            height: height * scale,
        })
    }

    pub fn note_pointer(over: Option<(u32, platform::Point)>, is_about_to_scroll: bool) {
        POINTER.set(over);
        LOOK_AT.set(Some(
            Instant::now() + Duration::from_millis(if is_about_to_scroll { 0 } else { 80 }),
        ));
    }

    fn look_under_pointer(state: &WindowState) {
        let port = |(id, at): (u32, platform::Point)| {
            surface::shown_in(state)
                .iter()
                .find(|it| it.borrow().id == id)?
                .borrow()
                .port_at(at.x, at.y)
        };
        let port = POINTER
            .get()
            .and_then(port)
            .map(|it| in_pixels(it, state.metrics.get().scale));
        if state
            .layers
            .borrow_mut()
            .as_mut()
            .is_some_and(|it| it.expect_scroll(port))
        {
            core_animation::expect_scroll();
            refresh(state.id);
        }
    }

    /// Not from inside of AppKit, which commits what belongs together.
    pub fn flush() {
        if HAS_CHANGES.take() {
            crate::diagnostics::trace!("painted");
            core_animation::wait_to_flush();
            diagnostics::measure(Step::Commit, core_animation::flush);
            crate::diagnostics::trace!("committed");
        }
    }

    pub(super) fn leave_to_appkit() {
        HAS_CHANGES.set(false);
    }

    pub fn next_chore() -> Option<Instant> {
        [RELEASE_AT.get(), PAUSE_AT.get(), LOOK_AT.get()]
            .into_iter()
            .flatten()
            .min()
    }

    pub fn do_chores() {
        if PAUSE_AT.get().is_some_and(|time| time <= Instant::now()) {
            PAUSE_AT.set(None);
            core_animation::note_pause();
        }
        if LOOK_AT.get().is_some_and(|time| time <= Instant::now()) {
            LOOK_AT.set(None);
            ids()
                .into_iter()
                .filter_map(|id| state(id).ok())
                .for_each(|it| look_under_pointer(&it));
        }
        if RELEASE_AT.get().is_some_and(|time| time <= Instant::now()) {
            let mut has_spares = false;
            for state in ids().into_iter().filter_map(|id| state(id).ok()) {
                if let Some(layers) = &mut *state.layers.borrow_mut() {
                    if layers.is_loose() {
                        refresh(state.id);
                    }
                    layers.release_spares(SPARES_LAST);
                    has_spares |= layers.has_spares();
                    if !layers.has_spares() {
                        layers.target.release_memory();
                    }
                }
            }
            crate::allocator::release_memory();
            RELEASE_AT.set(has_spares.then(|| Instant::now() + SPARES_LAST * 2));
        }
    }
}

pub fn state(id: u32) -> Result<Rc<WindowState>> {
    WINDOWS
        .with_borrow(|windows| Some(windows.get(&id)?.state.clone()))
        .context("the window was destroyed")
}

pub fn platform_window(id: u32) -> Option<Rc<dyn platform::Window>> {
    WINDOWS.with_borrow(|windows| windows.get(&id)?.window.clone())
}

pub fn ids() -> Vec<u32> {
    WINDOWS.with_borrow(|windows| windows.keys().copied().collect())
}

pub fn refresh(id: u32) {
    if let Ok(state) = state(id) {
        state.is_stale.set(true);
        if !host::is_about_to_draw(id) {
            request_frame(id);
        }
    }
}

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
    let (Some(window), Ok(state)) = (platform_window(id), state(id)) else {
        return;
    };
    if state.is_shown.get() && !host::is_about_to_draw(id) {
        let can_present = if state.is_stale.get() {
            window.can_present()
        } else {
            None
        };
        state
            .draw_at
            .set((can_present == Some(false)).then(|| Instant::now() + RETRY));
        if can_present == Some(true) {
            draw(&state, &*window);
        }
    }
}

/// There may be a newer scene among them.
pub fn draw_after_jobs(id: u32) {
    match state(id) {
        Ok(state) if host::thread::has_jobs() => state.draw_at.set(Some(Instant::now())),
        _ => draw_now(id),
    }
}

pub fn draw_if_stale(id: u32) {
    if let (Some(window), Ok(state)) = (platform_window(id), state(id))
        && state.is_stale.get()
    {
        draw(&state, &*window);
    }
}

/// Returns whether the platform is expected to ask for one.
pub fn request_frame(id: u32) -> bool {
    let window = platform_window(id).filter(|_| state(id).is_ok_and(|state| state.is_shown.get()));
    window.inspect(|window| window.request_frame()).is_some()
}

pub fn request_leisurely_frame(id: u32) {
    let window = platform_window(id).filter(|_| state(id).is_ok_and(|state| state.is_shown.get()));
    window.inspect(|window| window.request_leisurely_frame());
}

pub fn create(options: Options, icon: Option<&[u8]>, cover: Option<u32>) -> Result<()> {
    let icon = icon
        .map(images::decode_still)
        .transpose()
        .context("could not decode the window's icon")?;
    let icon = icon.map(|icon| Icon {
        width: icon.width,
        height: icon.height,
        pixels: icon.data,
    });
    let (id, platform) = (options.id, host::platform()?);
    app::forget_appearance();
    let mut placed = options.clone();
    if let (None, Some(display)) = (
        options.x.get().zip(options.y.get()),
        platform.displays().first(),
    ) {
        let area = display.work_area;
        (placed.width, placed.height) = (
            options.width.min(area.width),
            options.height.min(area.height),
        );
        placed.x = Maybe::Yes(area.x + (area.width - placed.width) / 2.);
        placed.y = Maybe::Yes(area.y + (area.height - placed.height) / 2.);
    }
    let state = Rc::new(WindowState {
        id,
        metrics: Cell::new(Metrics {
            width: options.width,
            height: options.height,
            scale: 1.,
            origin: (options.x.get().unwrap_or(0.), options.y.get().unwrap_or(0.)),
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
        cover: Cell::new(cover),
        kept_cover: Cell::default(),
        is_active: Cell::default(),
        is_disabled: Cell::default(),
        keeps_cursor: Cell::default(),
        pointer: Pointer::default(),
        frame_buttons: RefCell::default(),
        is_shown: Cell::default(),
        is_stale: Cell::default(),
        redraw_at: Cell::default(),
        draw_at: Cell::default(),
        drawing_time: Cell::default(),
        forget_at: Cell::default(),
        geometry: Cell::default(),
        cache: RefCell::default(),
        compositor: Arc::default(),
        #[cfg(target_os = "macos")]
        layers: RefCell::default(),
        #[cfg(any(windows, target_os = "macos"))]
        covered_caret: Cell::default(),
        #[cfg(any(windows, target_os = "macos"))]
        unlifted: RefCell::default(),
        #[cfg(target_os = "macos")]
        was_hidden: Cell::default(),
        options: RefCell::new(options),
    });
    WINDOWS.with_borrow_mut(|windows| {
        windows.insert(
            id,
            Entry {
                state: state.clone(),
                window: None,
            },
        )
    });
    let window = platform
        .open_window(&placed, icon.as_ref())
        .inspect_err(|_| forget(id))?;
    state.measure(window.geometry());
    WINDOWS.with_borrow_mut(|windows| {
        windows.insert(
            id,
            Entry {
                state,
                window: Some(window),
            },
        )
    });
    if placed.show {
        app::after_command(move || set_visible(id, true, placed.focus));
    }
    Ok(())
}

pub fn set_visible(id: u32, is_visible: bool, takes_focus: bool) {
    let (Some(window), Ok(state)) = (platform_window(id), state(id)) else {
        return;
    };
    match is_visible {
        true => draw_before_showing(id),
        false => state.is_shown.set(false),
    }
    #[cfg(target_os = "macos")]
    state.was_hidden.set(!is_visible);
    window.set_visible(is_visible, takes_focus);
    request_frame(id);
}

/// So that it does not appear empty.
pub fn draw_before_showing(id: u32) {
    if let Some(state) = state(id).ok().filter(|_| !app::is_headless()) {
        state.is_shown.set(true);
        #[cfg(target_os = "macos")]
        state.was_hidden.set(false);
        state.forget_at.set(None);
        refresh(id);
        draw_now(id);
    }
}

pub fn destroy(id: u32) -> Result<()> {
    let (state, window) = (state(id)?, platform_window(id));
    input::activation_changed(&state, false);
    forget(id);
    window.into_iter().for_each(|window| window.close());
    drop(state);
    app::after_command(release_memory);
    Ok(())
}

fn forget(id: u32) {
    host::forget_frames(id);
    crate::accessibility::window_closed(id);
    if let Some(entry) = WINDOWS.with_borrow_mut(|windows| windows.remove(&id)) {
        entry.state.is_shown.set(false);
        surface::in_window(&entry.state)
            .iter()
            .for_each(|surface| surface.borrow_mut().window = None);
    }
}

fn emit(id: u32, event: WindowEvent) {
    bridge::emit(Event::Window { id, event });
}

/// What can be computed again.
fn release_memory() {
    surface::release_memory();
    images::release_memory();
    cpu::release_memory();
    crate::canvas::release_memory();
    text::release_memory();
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: it has no preconditions.
    unsafe {
        libc::malloc_trim(0);
    }
    crate::allocator::release_memory();
}

fn forget_what_was_drawn(state: &WindowState) {
    *state.compositor.lock() = Compositor::default();
    state.cache.take();
    platform_window(state.id).inspect(|it| it.release_pixels());
    #[cfg(target_os = "macos")]
    if let Some(layers) = &mut *state.layers.borrow_mut() {
        layers.forget_contents();
        layers.target.release_memory();
    }
    #[cfg(target_os = "macos")]
    if state.was_hidden.get() {
        state.layers.take();
    }
    state.is_stale.set(true);
    release_memory();
}

// ───────────────────────────── from the platform ─────────────────────────────

pub use crate::host::frame_is_due;

/// Anything in `Geometry`.
pub fn bounds_changed(id: u32) {
    let (Some(window), Ok(state)) = (platform_window(id), state(id)) else {
        return;
    };
    let (before, geometry) = (state.geometry.get(), window.geometry());
    if geometry == before {
        return;
    }
    emit(id, WindowEvent::Bounds(geometry));
    state.measure(geometry);
    crate::accessibility::window_changed(&state);
    if geometry
        != (Geometry {
            x: geometry.x,
            y: geometry.y,
            ..before
        })
    {
        refresh(id);
    }
}

/// What is drawn now is shown together with the new size.
#[cfg(any(windows, target_os = "macos"))]
pub fn was_resized(id: u32) {
    bounds_changed(id);
    host::before_resized_frame(id);
    if state(id).is_ok_and(|state| state.is_shown.get()) {
        draw_if_stale(id);
        #[cfg(target_os = "macos")]
        layers::leave_to_appkit();
    }
}

#[cfg(windows)]
pub fn user_acts(id: u32, event: WindowEvent) {
    emit(id, event);
}

pub fn activation_changed(id: u32, is_active: bool) {
    if let Some(state) = state(id)
        .ok()
        .filter(|state| state.is_active.get() != is_active)
    {
        emit(
            id,
            if is_active {
                WindowEvent::Focus
            } else {
                WindowEvent::Blur
            },
        );
        input::activation_changed(&state, is_active);
        refresh(id);
    }
}

pub fn visibility_changed(id: u32) {
    const MAY_COME_BACK: Duration = Duration::from_secs(5);
    let (Some(window), Ok(state)) = (platform_window(id), state(id)) else {
        return;
    };
    let is_visible = window.is_visible();
    state.is_shown.set(is_visible);
    state
        .forget_at
        .set((!is_visible).then(|| Instant::now() + MAY_COME_BACK));
    refresh(id);
    emit(id, WindowEvent::Visibility(is_visible));
}

pub fn close_requested(id: u32) {
    emit(id, WindowEvent::CloseRequested);
}

/// By someone else.
#[cfg(unix)]
pub fn was_closed(id: u32) {
    if state(id).is_ok() {
        forget(id);
        emit(id, WindowEvent::Closed);
    }
}

pub fn appearance_changed() {
    app::forget_appearance();
    bridge::emit_system(SystemEvent::Theme {
        is_dark: app::is_dark(),
    });
    ids().into_iter().for_each(refresh);
}

// ───────────────────────────── drawing ─────────────────────────────

/// Whether it is shown, and until when.
pub fn blink(since: Instant, now: Instant) -> (bool, Instant) {
    #[cfg(windows)]
    let phase = Duration::from_millis(crate::win32::GetCaretBlinkTime().max(100).into());
    #[cfg(unix)]
    let phase = Duration::from_millis(500);
    let phases = (now.saturating_duration_since(since).as_millis() / phase.as_millis()) as u32;
    (phases.is_multiple_of(2), since + phase * (phases + 1))
}

fn draw(state: &WindowState, window: &dyn platform::Window) {
    let start = Instant::now();
    if host::thread::exists() && state.is_shown.get() {
        surface::begin_frames_until(state, start + state.drawing_time.get());
    }
    crate::guard("error", (), || try_to_draw(state, window));
    state
        .drawing_time
        .update(|it| start.elapsed().max(it * 7 / 8));
}

fn try_to_draw(state: &WindowState, window: &dyn platform::Window) {
    window
        .refresh_interval()
        .into_iter()
        .for_each(host::set_interval);
    state.measure(state.geometry.get());
    let start = diagnostics::logs_frames().then(Instant::now);
    #[cfg(target_os = "macos")]
    let caret = diagnostics::measure(Step::Flatten, || lifting::flatten(state));
    #[cfg(windows)]
    {
        window.begin_frame(
            surface::shown_in(state)
                .iter()
                .any(|it| it.borrow().is_scrolling()),
            state.is_opaque(),
        );
        diagnostics::measure(Step::Flatten, || lifting::flatten(state));
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let mut next = None;
        let mut after = |it: Rc<RefCell<Surface>>, _| {
            next = next.into_iter().chain(it.borrow().next_motion()).min()
        };
        let redraw_at =
            diagnostics::measure(Step::Flatten, || flatten_surfaces(state, true, &mut after));
        state.redraw_at.set(redraw_at.into_iter().chain(next).min());
    }
    if let Some(start) = start {
        crate::diagnostics::log!(
            "window {} flattened in {:?}: {}",
            state.id,
            start.elapsed(),
            state.cache.borrow().describe()
        );
    }
    #[cfg(target_os = "macos")]
    diagnostics::measure(Step::Paint, || layers::present(state, window, caret));
    #[cfg(not(target_os = "macos"))]
    window.present({
        let compositor = state.compositor.clone();
        Box::new(move |pixels| {
            diagnostics::measure(Step::Paint, || compositor.lock().paint(pixels))
        })
    });
    #[cfg(windows)]
    {
        let lifted = std::mem::take(&mut state.cache.borrow_mut().lifted);
        state.cache.borrow_mut().known_contents =
            diagnostics::measure(Step::Commit, || window.commit(lifted));
    }
}

/// Returns when it has to be drawn again. `after` gets each surface, and how much is lifted by then.
fn flatten_surfaces(
    state: &WindowState,
    blinks: bool,
    after: &mut dyn FnMut(Rc<RefCell<Surface>>, usize),
) -> Option<Instant> {
    let (mut compositor, cache) = (state.compositor.lock(), &mut *state.cache.borrow_mut());
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
    let background = match options.background_color.get() {
        Some(color) => color,
        None if options.background == Background::Opaque => frame::default_background(),
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
    let [deadline, gives_up_at] = [WAIT_FOR_IMAGES, LONGEST_FRAME].map(|it| Instant::now() + it);
    state.is_stale.set(false);
    state.draw_at.set(None);
    cache.begin();
    flatten::fill(cache, everything, background);
    for shared in surface::shown_in(state) {
        let surface = shared.borrow();
        if !surface.is_visible {
            continue;
        }
        let mut frame = Frame::new(metrics.scale * surface.scene.zoom, true);
        (frame.deadline, frame.gives_up_at) = (
            Some(if surface.is_scrolling() {
                frame.now
            } else {
                deadline
            }),
            gives_up_at,
        );
        if blinks && surface.scene.caret.is_some() && state.is_active.get() {
            let (is_shown, until) = blink(surface.caret_moved_at, frame.now);
            frame.shows_caret = is_shown;
            frame.changes_at(until);
        }
        let rect = device(surface.rect);
        let (origin, clip) = (
            (rect.left, rect.top),
            rect.intersect(device(metrics.content)),
        );
        #[cfg(target_os = "macos")]
        let (movers, in_motion, staying) = (
            &lifting::movers(state, &surface, frame.now),
            &[],
            Some(
                state
                    .unlifted
                    .borrow()
                    .iter()
                    .map(|it| it.0)
                    .collect::<Vec<_>>(),
            ),
        );
        #[cfg(windows)]
        let (movers, in_motion, staying) = (
            &lifting::movers(state, &surface, frame.now),
            &surface.motion.in_motion(),
            None::<Vec<_>>,
        );
        #[cfg(not(any(windows, target_os = "macos")))]
        let (movers, in_motion, staying) = (&[], &surface.motion.in_motion(), None::<Vec<_>>);
        flatten::paint(
            &surface.scene,
            &frame,
            &Placement {
                movers,
                staying: staying.as_deref(),
                in_motion,
                origin,
                clip,
                is_active: state.is_active.get(),
                depth: 0,
                shown_by: None,
            },
            atlas,
            cache,
        );
        redraw_at = redraw_at.into_iter().chain(frame.next_change.get()).min();
        after(shared.clone(), cache.lifted.len());
    }
    if state.cover.get().or(state.kept_cover.get()).is_some() {
        cache.expect_other_contents();
    }
    let (scene, buttons) = frame::build(state, &state.geometry.get());
    state.frame_buttons.replace(buttons);
    let placement = Placement {
        movers: &[],
        staying: None,
        in_motion: &[],
        origin: (0, 0),
        clip: everything,
        is_active: false,
        depth: 0,
        shown_by: None,
    };
    flatten::paint(
        &scene,
        &Frame::new(metrics.scale, false),
        &placement,
        atlas,
        cache,
    );
    cache.finish(&mut compositor);
    redraw_at
}
