//! What a document is painted on: a rectangle in a window, or in none.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use crate::abi::{self, Item, Rect, RoundedRect};
use crate::diagnostics::{self, Incident, trace};
use crate::error::{Context as _, Result};
use crate::gfx::Transform;
use crate::hash::{FastMap, FastSet};
use crate::host::{self, thread};
use crate::input::{self, Ime};
use crate::motion::{Motion, Next, Tables};
use crate::paint::allowance::Allowance;
use crate::paint::cpu::Painter;
use crate::paint::raster::{Clip, IntRect, Layer};
use crate::paint::scene::{Frame, Scene, copy};
use crate::platform::Cursor;
use crate::protocol::{Bitmap, Input, InputField, Maybe, Size, SurfaceCommand, SurfaceMetrics};
use crate::remote::guest;
use crate::sync::Mutex;
use crate::window::{self, WindowState};
use crate::{accessibility, bridge, images};

pub struct Surface {
    pub id: u32,
    pub window: Option<u32>,
    /// Relative to the window's content. `None` fills it.
    bounds: Option<Rect>,
    /// Relative to the window.
    pub rect: Rect,
    pub scale: f32,
    pub is_visible: bool,
    pub is_passthrough: bool,
    is_focusable: bool,
    radius: f32,
    background: u32,
    /// What the page wants instead, or 0.
    canvas: u32,
    pub image: u32,
    pub scene: Scene,
    pub motion: Motion,
    /// When the window last asked for a frame.
    last_tick: Instant,
    /// The frame that began before the move that it should have shown.
    starved_at: Option<Instant>,
    pub caret_moved_at: Instant,
    /// When the `frame` event that was asked for is sent if no window has asked for a frame by then.
    frame_deadline: Option<Instant>,
    last_frame: Instant,
    /// What `bridge::inputs` was then.
    inputs: u32,
    last_early_frame: Instant,
    pub cursor: Cursor,
    pub ime: Ime,
}

thread_local! {
    static SURFACES: RefCell<FastMap<u32, Rc<RefCell<Surface>>>> = RefCell::default();
}

pub fn get(id: u32) -> Option<Rc<RefCell<Surface>>> {
    SURFACES.with_borrow(|surfaces| surfaces.get(&id).cloned())
}

/// From the bottom to the top.
pub fn in_window(state: &WindowState) -> Vec<Rc<RefCell<Surface>>> {
    state
        .surfaces
        .borrow()
        .iter()
        .filter_map(|id| get(*id))
        .collect()
}

pub fn shown_in(state: &WindowState) -> Vec<Rc<RefCell<Surface>>> {
    state.cover.get().map_or_else(
        || {
            in_window(state)
                .into_iter()
                .chain(state.kept_cover.get().and_then(get))
                .collect()
        },
        |cover| get(cover).into_iter().collect(),
    )
}

pub fn create_cover(id: u32, window: u32, rect: Rect, scene: Scene) -> Result<()> {
    create(id, Size::default(), 1., false);
    let surface = get(id).context("the surface was destroyed")?;
    let surface = &mut *surface.borrow_mut();
    (surface.window, surface.rect, surface.scene) = (Some(window), rect, scene);
    surface.ime = Ime::new(Maybe::Yes(InputField::default()));
    surface.scene.index();
    Ok(())
}

pub fn clear() {
    SURFACES.take();
}

impl Surface {
    fn backing(&self) -> [Item; 2] {
        let zoom = self.scene.zoom;
        let rect = Rect {
            x: 0.,
            y: 0.,
            width: self.rect.width / zoom,
            height: self.rect.height / zoom,
        };
        let radius = (self.radius / zoom)
            .min(rect.width / 2.)
            .min(rect.height / 2.);
        let shape = RoundedRect {
            rect,
            radii: [[radius; 2]; 4],
            smoothing: 0.,
        };
        [
            Item::PushClip(shape),
            Item::Fill {
                shape,
                color: if self.canvas == 0 {
                    self.background
                } else {
                    self.canvas
                },
            },
        ]
    }

    fn update_backing(&mut self) {
        let backing = self.backing();
        if let (1.., Item::PushClip(clip)) = (self.image, backing[0]) {
            let (clip, tile) = (
                RoundedRect {
                    radii: Default::default(),
                    ..clip
                },
                abi::Tile {
                    rect: clip.rect,
                    step: [0.; 2],
                },
            );
            self.scene.items = backing.to_vec();
            self.scene.items.push(Item::Image {
                clip,
                tile,
                image: self.image,
                pixelated: false,
            });
            return self.scene.index();
        }
        match self.scene.items.first_chunk_mut() {
            Some(current) if *current == backing => return,
            Some(current) => *current = backing,
            None => self.scene.items = backing.to_vec(),
        }
        self.scene.index();
    }

    fn place(&mut self, rect: Rect, scale: f32, always_reports: bool) {
        let has_changed =
            (rect.width, rect.height, scale) != (self.rect.width, self.rect.height, self.scale);
        (self.rect, self.scale) = (rect, scale);
        self.update_backing();
        if has_changed || always_reports {
            bridge::emit_input(
                self.id,
                Input::Resize {
                    size: Size {
                        width: rect.width,
                        height: rect.height,
                    },
                    scale,
                },
            );
        }
    }

    pub fn place_in(&mut self, state: &WindowState, always_reports: bool) {
        let metrics = state.metrics.get();
        let content = metrics.content;
        let rect = self.bounds.map_or(content, |bounds| Rect {
            x: content.x + bounds.x,
            y: content.y + bounds.y,
            ..bounds
        });
        self.place(rect, metrics.scale, always_reports);
    }

    pub fn is_drag_region(&self, x: f32, y: f32) -> bool {
        let (x, y) = (
            (x - self.rect.x) / self.scene.zoom,
            (y - self.rect.y) / self.scene.zoom,
        );
        let region = self
            .scene
            .regions
            .iter()
            .rfind(|region| contains(region.rect, x, y));
        region.is_some_and(|region| region.drag)
    }

    fn refresh(&self) {
        if let Some(window) = self.window {
            window::refresh(window);
        }
    }

    /// Returns the window to draw.
    fn adopt(&mut self, (scene, tables): &mut (Scene, Tables)) -> Option<u32> {
        if std::mem::take(&mut self.image) == 0
            && self.scene.is_same_list(scene)
            && self.motion.tables == *tables
        {
            return None;
        }
        let caret = self.scene.caret;
        self.scene.zoom = scene.zoom;
        let backing = self.backing();
        self.scene.replace(&backing, scene);
        std::mem::swap(&mut self.motion.tables, tables);
        self.motion.adopt(&mut self.scene, backing.len());
        self.motion
            .advance(self.id, &mut self.scene, milliseconds(self.last_tick));
        if self.scene.caret != caret {
            self.caret_moved_at = Instant::now();
        }
        self.refresh();
        self.window
            .filter(|_| self.is_visible && !self.motion.is_scrolling())
    }

    fn advance(&mut self, now: Instant, is_in_step: bool) {
        self.last_tick = now;
        self.motion.follow(is_in_step);
        let next = self.motion.next;
        let has_changed = self
            .motion
            .advance(self.id, &mut self.scene, milliseconds(now));
        self.starved_at =
            (!has_changed && self.motion.is_touched(milliseconds(now))).then_some(now);
        if self.starved_at.is_some() {
            diagnostics::note(Incident::NothingMoved);
        }
        let must_draw = has_changed || self.motion.next != next;
        if must_draw {
            self.refresh();
        }
        if self.motion.is_scrolling() && (must_draw || self.starved_at.is_some()) {
            host::present_at_once();
        }
        self.keep_moving();
    }

    pub fn keep_moving(&self) {
        match self.motion.next {
            Next::Frame => drop(self.window.map(window::request_frame)),
            Next::Leisurely => drop(self.window.map(window::request_leisurely_frame)),
            _ => {}
        }
    }

    pub fn is_scrolling(&self) -> bool {
        self.motion.is_scrolling()
    }

    /// In the window.
    #[cfg(target_os = "macos")]
    pub fn scrolled_port(&mut self) -> Option<Rect> {
        self.motion.port(&self.scene).map(|it| self.in_window(it))
    }

    #[cfg(target_os = "macos")]
    pub fn take_jump(&mut self) -> Option<Rect> {
        self.motion
            .take_jump(&self.scene)
            .map(|it| self.in_window(it))
    }

    #[cfg(target_os = "macos")]
    pub fn port_at(&self, x: f32, y: f32) -> Option<Rect> {
        self.motion
            .port_at(
                &self.scene,
                [x - self.rect.x, y - self.rect.y].map(|it| it / self.scene.zoom),
            )
            .map(|it| self.in_window(it))
    }

    #[cfg(target_os = "macos")]
    fn in_window(
        &self,
        Rect {
            x,
            y,
            width,
            height,
        }: Rect,
    ) -> Rect {
        let zoom = self.scene.zoom;
        Rect {
            x: self.rect.x + x * zoom,
            y: self.rect.y + y * zoom,
            width: width * zoom,
            height: height * zoom,
        }
    }

    pub fn next_motion(&self) -> Option<Instant> {
        const LONGEST_REST: f64 = 3_600_000.;
        match self.motion.next {
            Next::Never => None,
            Next::At(time) => Some(
                *EPOCH
                    + Duration::from_secs_f64(
                        time.min(milliseconds(self.last_tick) + LONGEST_REST)
                            .max(0.)
                            / 1000.,
                    ),
            ),
            Next::Frame | Next::Leisurely => Some(self.last_tick + Duration::from_millis(50)),
        }
    }

    fn begin_frame(&mut self, now: Instant) {
        if self.frame_deadline.take().is_some() {
            (self.last_frame, self.inputs) = (now, bridge::inputs());
            let (id, interval) = (self.id, host::interval().as_secs_f64() * 1000.);
            host::alarm::set(now, move || {
                bridge::emit_input(
                    id,
                    Input::Frame {
                        time: milliseconds(now),
                        interval,
                    },
                )
            });
        }
    }

    fn request_frame(&mut self) {
        const WITHOUT_DISPLAY: Duration = Duration::from_micros(16_667);
        const WHILE_OCCLUDED: Duration = Duration::from_millis(250);
        let now = Instant::now();
        let inputs = bridge::inputs();
        if self.inputs != inputs && now >= self.last_early_frame + host::interval() {
            (self.inputs, self.last_early_frame, self.frame_deadline) = (inputs, now, Some(now));
            trace!("early frame for {}", self.id);
            return self.begin_frame(now);
        }
        let has_source = self.is_visible && self.window.is_some_and(window::request_frame);
        let deadline = if has_source {
            now + WHILE_OCCLUDED
        } else {
            now.max(self.last_frame + WITHOUT_DISPLAY)
        };
        self.frame_deadline.get_or_insert(deadline);
    }

    /// `layer` is in the window's device pixels.
    pub fn paint_in_window(&self, layer: &mut Layer) {
        let (
            Rect {
                x,
                y,
                width,
                height,
            },
            scale,
        ) = (self.rect, self.scale);
        let rect = IntRect::nearest(Rect {
            x: x * scale,
            y: y * scale,
            width: width * scale,
            height: height * scale,
        });
        if self.is_visible && !rect.intersect(layer.rect).is_empty() {
            let frame = Frame::new(scale * self.scene.zoom, false);
            let painter = Painter {
                scene: &self.scene,
                frame: &frame,
                left_out: &[],
            };
            let matrix = Transform::from_row(
                frame.scale,
                0.,
                0.,
                frame.scale,
                rect.left as f32,
                rect.top as f32,
            );
            painter.paint(
                0..self.scene.items.len(),
                layer,
                &matrix,
                &Clip::new(rect.intersect(layer.rect)),
            );
        }
    }

    pub fn render(&self, rect: Option<Rect>, scale: f32) -> Result<Layer> {
        let Rect {
            x,
            y,
            width,
            height,
        } = rect.unwrap_or(Rect {
            x: 0.,
            y: 0.,
            ..self.rect
        });
        self.render_area(
            IntRect::nearest(Rect {
                x: x * scale,
                y: y * scale,
                width: width * scale,
                height: height * scale,
            }),
            scale,
            5 * window::LONGEST_FRAME,
        )
    }

    /// `patience` is with what another process has sent.
    pub fn render_area(&self, area: IntRect, scale: f32, patience: Duration) -> Result<Layer> {
        let (mut frame, meter) = (
            Frame::new(scale * self.scene.zoom, false),
            self.scene.allowance.as_deref().map(Allowance::meter),
        );
        if let Some(allowance) = &self.scene.allowance {
            frame.gives_up_at = frame.now
                + if allowance.is_spent() {
                    Duration::ZERO
                } else {
                    patience
                };
        }
        let painter = Painter {
            scene: &self.scene,
            frame: &frame,
            left_out: &[],
        };
        let (matrix, items) = (
            Transform::from_scale(frame.scale, frame.scale),
            0..self.scene.items.len(),
        );
        let whole = IntRect::nearest(Rect {
            x: 0.,
            y: 0.,
            width: self.rect.width * scale,
            height: self.rect.height * scale,
        });
        let needed = area
            .outset(painter.reach_of_backdrops(items.clone(), &matrix))
            .intersect(whole)
            .union(area);
        let mut layer = Layer::new(needed).context("the area is empty or too large")?;
        painter.paint(items, &mut layer, &matrix, &Clip::new(needed));
        meter.into_iter().for_each(|it| it.stop(0));
        if needed == area {
            Ok(layer)
        } else {
            layer.copy(area).context("the area is empty or too large")
        }
    }

    fn capture(&self, area: Option<Rect>) -> Result<Bitmap> {
        let layer = self.render(area.map(without_negative_size), self.scale)?;
        Ok(Bitmap {
            width: layer.pixmap.width(),
            height: layer.pixmap.height(),
            pixels: images::straight_rgba(&layer).into(),
        })
    }
}

pub fn contains(rect: Rect, x: f32, y: f32) -> bool {
    x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

pub fn without_negative_size(rect: Rect) -> Rect {
    Rect {
        width: rect.width.max(0.),
        height: rect.height.max(0.),
        ..rect
    }
}

type Submission = Box<(Scene, Tables)>;

static SPARE: Mutex<Option<Submission>> = Mutex::new(None);

/// # Safety
/// The slices of `list` and `compositing` are valid.
pub unsafe fn submit(id: u32, list: &abi::DisplayList, compositing: Option<&abi::Compositing>) {
    trace!("JavaScript has painted {id}");
    if guest::is_on() {
        // SAFETY: the caller's contract.
        return unsafe { guest::submit(id, list, compositing) };
    }
    let mut submission = spare_submission();
    let (scene, tables) = &mut *submission;
    // SAFETY: the caller's contract.
    unsafe {
        scene.copy_list(list);
        match compositing {
            Some(compositing) => {
                copy(compositing.scrollers, &mut tables.scrollers);
                copy(compositing.drivers, &mut tables.drivers);
                copy(compositing.numbers, &mut tables.numbers);
                copy(compositing.hits, &mut tables.hits);
            }
            None => *tables = Tables::default(),
        }
    }
    thread::post(move || adopt(id, submission));
}

pub fn spare_submission() -> Submission {
    SPARE.lock().take().unwrap_or_default()
}

pub fn adopt(id: u32, mut submission: Submission) {
    trace!("the scene of {id} has arrived");
    let window = get(id).and_then(|surface| surface.borrow_mut().adopt(&mut submission));
    submission.0.allowance = None;
    *SPARE.lock() = Some(submission);
    window.into_iter().for_each(window::draw_after_jobs);
}

pub fn submit_scrollers(id: u32, scrollers: Vec<abi::Scroller>) {
    if guest::is_on() {
        guest::submit_scrollers(id, scrollers)
    } else {
        thread::post(move || adopt_scrollers(id, scrollers))
    }
}

pub fn adopt_scrollers(id: u32, scrollers: Vec<abi::Scroller>) {
    let Some(surface) =
        get(id).filter(|it| it.borrow().motion.tables.scrollers.len() == scrollers.len())
    else {
        return;
    };
    let window = {
        let surface = &mut *surface.borrow_mut();
        surface.motion.tables.scrollers = scrollers;
        surface
            .motion
            .advance(id, &mut surface.scene, milliseconds(surface.last_tick));
        surface.refresh();
        surface
            .window
            .filter(|_| surface.is_visible && !surface.motion.is_scrolling())
    };
    window.into_iter().for_each(window::draw_now);
}

pub fn release_memory() {
    SPARE.lock().take();
}

static EPOCH: LazyLock<Instant> = LazyLock::new(|| guest::epoch().unwrap_or_else(Instant::now));

pub fn milliseconds(time: Instant) -> f64 {
    time.saturating_duration_since(*EPOCH).as_secs_f64() * 1000.
}

/// With a position in the surface. `f` returns whether it used the event.
pub fn with_motion(
    id: u32,
    x: f32,
    y: f32,
    f: impl FnOnce(&mut Motion, &Scene, [f32; 2]) -> bool,
) -> bool {
    let Some(surface) = get(id) else { return false };
    let surface = &mut *surface.borrow_mut();
    let position = [x, y].map(|it| it / surface.scene.zoom);
    let was_used = f(&mut surface.motion, &surface.scene, position);
    if was_used {
        surface.window.map(window::request_frame);
    }
    was_used
}

/// Shows a move that has just missed its frame.
pub fn catch_up(id: u32) {
    let Some(surface) = get(id) else { return };
    let mut surface = surface.borrow_mut();
    diagnostics::fingers_moved(host::interval());
    if let Some(late) = surface
        .starved_at
        .map(|it| it.elapsed())
        .filter(|it| *it < host::interval() * 3 / 5)
    {
        diagnostics::note(Incident::CaughtUp);
        surface.advance(Instant::now(), late < host::interval() / 5);
        let window = surface.window;
        drop(surface);
        window.into_iter().for_each(window::draw_now);
    }
}

pub fn change_motion(id: u32, f: impl FnOnce(&mut Motion)) {
    if let Some(surface) = get(id) {
        f(&mut surface.borrow_mut().motion);
    }
}

/// In place of a display list, until the next one. 0 is no image.
fn show_image(id: u32, image: u32) {
    let Some(surface) = get(id) else { return };
    let surface = &mut *surface.borrow_mut();
    (surface.scene, surface.motion, surface.image) = (Scene::default(), Motion::default(), image);
    surface.update_backing();
    surface.refresh();
}

fn set_regions_of_image(id: u32, image: u32, regions: Vec<abi::Region>) {
    let Some(surface) = get(id).filter(|it| it.borrow().image == image) else {
        return;
    };
    let surface = &mut *surface.borrow_mut();
    surface.scene.regions = regions;
    surface.refresh();
}

pub fn image_changed(id: u32) {
    if guest::is_on() {
        return guest::image_changed(id);
    }
    refresh_where_shown(|it| it == id);
}

pub fn images_changed(ids: &FastSet<u32>) {
    match guest::is_on() {
        true => ids.iter().copied().for_each(guest::image_changed),
        false if ids.is_empty() => {}
        false => refresh_where_shown(|it| ids.contains(&it)),
    }
}

fn refresh_where_shown(has_changed: impl Fn(u32) -> bool) {
    let shows_it = |item: &Item| matches!(item, Item::Image { image, .. } if has_changed(*image));
    SURFACES.with_borrow(|surfaces| {
        let surfaces = surfaces.values().map(|surface| surface.borrow());
        surfaces
            .filter(|surface| surface.window.is_some() && surface.scene.items.iter().any(shows_it))
            .for_each(|surface| surface.refresh());
    });
}

pub fn begin_frame(state: &WindowState) {
    let (now, mut is_scrolling, mut is_followed) = (Instant::now(), false, false);
    for surface in in_window(state) {
        let surface = &mut *surface.borrow_mut();
        if surface.is_visible {
            surface.advance(now, now < surface.last_tick + host::interval() * 3 / 2);
            is_scrolling |= surface.is_scrolling();
            is_followed |= surface.is_scrolling() && surface.motion.next == Next::Frame;
        }
        if now >= surface.last_early_frame + host::interval() / 2 {
            surface.begin_frame(now);
        } else if surface.frame_deadline.is_some() {
            window::request_frame(state.id);
        }
    }
    window::platform_window(state.id)
        .into_iter()
        .for_each(|it| it.set_scrolling(is_scrolling));
    diagnostics::frame_began(now, host::interval(), is_scrolling, is_followed);
}

/// So that JavaScript does not wait for this thread, which is busy until `end`.
pub fn begin_frames_until(state: &WindowState, end: Instant) {
    for surface in in_window(state) {
        let surface = &mut *surface.borrow_mut();
        let due = (surface.last_frame + host::interval()).max(Instant::now());
        if surface.is_visible
            && !surface.is_scrolling()
            && surface.frame_deadline.is_some()
            && due < end
        {
            surface.last_early_frame = due;
            surface.begin_frame(due);
            host::wait_for_frame(state.id, due);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn begin_frames_at_once(state: &WindowState) {
    in_window(state)
        .iter()
        .for_each(|surface| surface.borrow_mut().begin_frame(Instant::now()));
}

pub fn next_deadline() -> Option<Instant> {
    SURFACES.with_borrow(|surfaces| {
        surfaces
            .values()
            .filter_map(|surface| surface.borrow().frame_deadline)
            .min()
    })
}

pub fn begin_overdue_frames() {
    let now = Instant::now();
    SURFACES.with_borrow(|surfaces| {
        for mut surface in surfaces.values().map(|surface| surface.borrow_mut()) {
            if surface
                .frame_deadline
                .is_some_and(|deadline| deadline <= now)
            {
                surface.begin_frame(now);
            }
        }
    });
}

fn set_cursor(surface: &RefCell<Surface>, cursor: Cursor) {
    let window = Some(&mut *surface.borrow_mut())
        .filter(|surface| surface.cursor != cursor)
        .and_then(|surface| {
            surface.cursor = cursor;
            surface.window
        });
    if let Some(state) = window.and_then(|window| window::state(window).ok()) {
        input::cursor_changed(&state);
    }
}

fn detach(id: u32) {
    let window = get(id).and_then(|surface| surface.borrow_mut().window.take());
    let Some(state) = window.and_then(|window| window::state(window).ok()) else {
        return;
    };
    state
        .surfaces
        .borrow_mut()
        .retain(|attached| *attached != id);
    input::forget_surface(&state, id);
    window::refresh(state.id);
    accessibility::window_changed(&state);
}

pub fn is_focusable(id: u32) -> bool {
    get(id).is_some_and(|surface| surface.borrow().is_focusable)
}

fn create(id: u32, size: Size, scale: f32, is_focusable: bool) {
    let mut surface = Surface {
        id,
        window: None,
        bounds: None,
        rect: Rect {
            x: 0.,
            y: 0.,
            width: size.width,
            height: size.height,
        },
        scale,
        is_visible: true,
        is_passthrough: false,
        is_focusable,
        radius: 0.,
        background: 0,
        canvas: 0,
        image: 0,
        scene: Scene::default(),
        motion: Motion::default(),
        starved_at: None,
        last_tick: Instant::now(),
        caret_moved_at: Instant::now(),
        frame_deadline: None,
        last_frame: Instant::now(),
        inputs: u32::MAX,
        last_early_frame: *EPOCH,
        cursor: Cursor::Arrow,
        ime: Ime::default(),
    };
    surface.update_backing();
    SURFACES.with_borrow_mut(|surfaces| surfaces.insert(id, Rc::new(RefCell::new(surface))));
}

pub fn destroy(id: u32) {
    detach(id);
    SURFACES.with_borrow_mut(|surfaces| surfaces.remove(&id));
    accessibility::surface_destroyed(id);
}

type Placed = (Rc<RefCell<Surface>>, Option<Rc<WindowState>>);

fn existing(id: u32) -> Result<Placed> {
    let shared = get(id).context("the surface was destroyed")?;
    let state = shared
        .borrow()
        .window
        .and_then(|window| window::state(window).ok());
    Ok((shared, state))
}

pub fn metrics(id: u32) -> Result<SurfaceMetrics> {
    let (shared, state) = existing(id)?;
    let (surface, (x, y)) = (
        shared.borrow(),
        state.map_or((0., 0.), |state| state.metrics.get().origin),
    );
    Ok(SurfaceMetrics {
        bounds: Rect {
            x: x + surface.rect.x,
            y: y + surface.rect.y,
            ..surface.rect
        },
        scale: surface.scale,
    })
}

pub fn capture(id: u32, area: Option<Rect>) -> Result<Bitmap> {
    existing(id)?.0.borrow().capture(area)
}

pub fn command(id: u32, command: SurfaceCommand, edits: u32) -> Result<()> {
    match command {
        SurfaceCommand::Create {
            size,
            scale,
            is_focusable,
        } => {
            create(id, size, scale, is_focusable);
            return Ok(());
        }
        SurfaceCommand::RequestFrame | SurfaceCommand::Cursor(_) if get(id).is_none() => {
            return Ok(());
        }
        SurfaceCommand::Show(view) => {
            show_image(id, view);
            accessibility::windows_changed();
            return Ok(());
        }
        SurfaceCommand::Regions { view, regions } => {
            set_regions_of_image(id, view, regions.into_vec());
            return Ok(());
        }
        _ => {}
    }
    let (shared, state) = existing(id)?;
    let change = |f: &dyn Fn(&mut Surface)| {
        let mut borrowed = shared.borrow_mut();
        let surface = &mut *borrowed;
        f(surface);
        match &state {
            Some(state) => surface.place_in(state, false),
            None => surface.place(surface.bounds.unwrap_or(surface.rect), surface.scale, false),
        }
        surface.refresh();
        drop(borrowed);
        accessibility::windows_changed();
    };
    match command {
        SurfaceCommand::Create { .. }
        | SurfaceCommand::Show(_)
        | SurfaceCommand::Regions { .. } => unreachable!(),
        SurfaceCommand::Destroy => destroy(id),
        SurfaceCommand::Detach => detach(id),
        SurfaceCommand::Attach { window, index } => {
            let target = window::state(window)?;
            match &state {
                Some(from) if from.id == target.id => {
                    target.surfaces.borrow_mut().retain(|other| *other != id)
                }
                _ => detach(id),
            }
            let index =
                (index.get().unwrap_or(u32::MAX) as usize).min(target.surfaces.borrow().len());
            target.surfaces.borrow_mut().insert(index, id);
            shared.borrow_mut().window = Some(target.id);
            shared.borrow_mut().place_in(&target, true);
            if target.focused_surface.get().is_none() && is_focusable(id) {
                input::focus(&target, Some(id));
            }
            window::refresh(target.id);
            accessibility::window_changed(&target);
        }
        SurfaceCommand::Bounds(bounds) => {
            change(&|it| it.bounds = bounds.get().map(without_negative_size))
        }
        SurfaceCommand::Place {
            bounds,
            is_visible,
            radius,
        } => {
            change(&|it| {
                (it.bounds, it.is_visible, it.radius) =
                    (Some(without_negative_size(bounds)), is_visible, radius)
            });
        }
        SurfaceCommand::Visible(is_visible) => change(&|it| it.is_visible = is_visible),
        SurfaceCommand::Passthrough(is_passthrough) => {
            change(&|it| it.is_passthrough = is_passthrough)
        }
        SurfaceCommand::Background(color) => change(&|it| it.background = color),
        SurfaceCommand::Canvas(color) => change(&|it| it.canvas = color),
        SurfaceCommand::Focus => state
            .into_iter()
            .for_each(|state| input::focus(&state, Some(id))),
        SurfaceCommand::RequestFrame => shared.borrow_mut().request_frame(),
        SurfaceCommand::Cursor(cursor) => set_cursor(&shared, cursor),
        SurfaceCommand::BeginDrag(dragged) => {
            const LONGEST: f32 = 8192.;
            const PIXELS: f32 = 1500. * 1500.;
            let Rect { width, height, .. } = dragged.area;
            let scale = if width.max(height) > LONGEST {
                0.
            } else {
                shared
                    .borrow()
                    .scale
                    .min((PIXELS / (width * height)).sqrt())
            };
            let [width, height] = [width, height].map(|it| (it * scale).round() as i32);
            let image = images::take_recording(dragged.image, width, height);
            let window = state.and_then(|it| window::platform_window(it.id));
            window
                .into_iter()
                .for_each(|it| it.begin_drag(&dragged, image.as_ref()));
        }
        SurfaceCommand::Field(field) => {
            let is_out_of_date =
                edits != bridge::edits() || field.as_ref().is_some_and(|it| it.is_out_of_date);
            let before = std::mem::replace(&mut shared.borrow_mut().ime, Ime::new(field));
            if is_out_of_date {
                shared.borrow_mut().ime.keep_text_of(&before);
            }
            state
                .into_iter()
                .for_each(|state| input::ime_changed(&state, &before, id));
        }
        SurfaceCommand::PasswordField => {
            let before = std::mem::replace(&mut shared.borrow_mut().ime, Ime::for_password());
            state
                .into_iter()
                .for_each(|state| input::ime_changed(&state, &before, id));
        }
    }
    Ok(())
}
