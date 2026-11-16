//! What a document is painted on: a rectangle in a window, or in none.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use crate::abi::{self, Item, Rect, RoundedRect};
use crate::bridge::Kind;
use crate::diagnostics::{self, Incident, trace};
use crate::error::{Context as _, Result, bail};
use crate::gfx::Transform;
use crate::hash::FastMap;
use crate::host::{self, thread};
use crate::input::{self, Ime};
use crate::json::{Deserialize as _, Value, json};
use crate::motion::{Motion, Next, Tables};
use crate::paint::cpu::Painter;
use crate::paint::raster::{Clip, IntRect, Layer};
use crate::paint::scene::{Frame, Scene, copy};
use crate::platform::Cursor;
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
    image: u32,
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
    pub accessibility: accessibility::Tree,
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
    command("create", &json!({ "id": id, "focusable": false }))?;
    let surface = get(id).context("the surface was destroyed")?;
    let surface = &mut *surface.borrow_mut();
    (surface.window, surface.rect, surface.scene) = (Some(window), rect, scene);
    surface.ime = Ime::parse(&json!({ "enabled": true }));
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
            let fields = [
                self.id.into(),
                rect.width.into(),
                rect.height.into(),
                scale.into(),
            ];
            bridge::emit_numbers(Kind::Resize, &fields, true);
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
        self.motion.adopt(&self.scene, backing.len());
        self.motion
            .advance(self.id, &mut self.scene, milliseconds(self.last_tick));
        if self.scene.caret != caret {
            self.caret_moved_at = Instant::now();
        }
        self.refresh();
        self.window
            .filter(|_| self.is_visible && !self.motion.is_scrolling())
    }

    fn advance(&mut self, now: Instant) {
        self.last_tick = now;
        let next = self.motion.next;
        self.motion.anticipate(milliseconds(now));
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

    pub fn next_motion(&self) -> Option<Instant> {
        match self.motion.next {
            Next::Never => None,
            Next::At(time) => Some(*EPOCH + Duration::from_secs_f64(time / 1000.)),
            Next::Frame | Next::Leisurely => Some(self.last_tick + Duration::from_millis(50)),
        }
    }

    fn begin_frame(&mut self, now: Instant) {
        if self.frame_deadline.take().is_some() {
            (self.last_frame, self.inputs) = (now, bridge::inputs());
            let interval = host::interval().as_secs_f64() * 1000.;
            bridge::emit_numbers(
                Kind::Frame,
                &[self.id.into(), milliseconds(now), interval],
                false,
            );
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
                limit: usize::MAX,
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
        )
    }

    pub fn render_area(&self, area: IntRect, scale: f32) -> Result<Layer> {
        let mut layer = Layer::new(area).context("the area is empty or too large")?;
        let frame = Frame::new(scale * self.scene.zoom, false);
        let painter = Painter {
            scene: &self.scene,
            frame: &frame,
            limit: usize::MAX,
            left_out: &[],
        };
        let matrix = Transform::from_scale(frame.scale, frame.scale);
        painter.paint(
            0..self.scene.items.len(),
            &mut layer,
            &matrix,
            &Clip::new(area),
        );
        Ok(layer)
    }

    fn capture(&self, arguments: &Value) -> Result<Value> {
        let scale = arguments["scale"]
            .as_f64()
            .map_or(self.scale, |scale| scale as f32);
        let layer = self.render(parse_rect(&arguments["rect"]), scale)?;
        let (width, height, mut bytes) = (
            layer.pixmap.width(),
            layer.pixmap.height(),
            images::straight_rgba(&layer),
        );
        if arguments["format"] != "rgba" {
            bytes = crate::codec::Rgba {
                width,
                height,
                data: bytes,
            }
            .to_png()
            .context("nothing was captured")?;
        }
        Ok(json!({ "blob": bridge::put_blob(bytes), "width": width, "height": height }))
    }
}

pub fn contains(rect: Rect, x: f32, y: f32) -> bool {
    x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

pub fn parse_rect(value: &Value) -> Option<Rect> {
    let number = |key: &str| Some(value.get(key)?.as_f64()? as f32);
    Some(Rect {
        x: number("x")?,
        y: number("y")?,
        width: number("width")?.max(0.),
        height: number("height")?.max(0.),
    })
}

type Submission = Box<(Scene, Tables)>;

static SPARE: Mutex<Option<Submission>> = Mutex::new(None);

/// # Safety
/// The slices of `list` and `compositing` are valid.
pub unsafe fn submit(id: u32, list: &abi::DisplayList, compositing: Option<&abi::Compositing>) {
    trace!("JavaScript has painted {id}");
    let mut submission = SPARE.lock().take().unwrap_or_default();
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
    thread::post(move || {
        trace!("the scene of {id} has arrived");
        let window = get(id).and_then(|surface| surface.borrow_mut().adopt(&mut submission));
        *SPARE.lock() = Some(submission);
        window.into_iter().for_each(window::draw_now);
    });
}

pub fn release_memory() {
    SPARE.lock().take();
}

static EPOCH: LazyLock<Instant> = LazyLock::new(Instant::now);

pub fn milliseconds(time: Instant) -> f64 {
    time.saturating_duration_since(*EPOCH).as_secs_f64() * 1000.
}

/// With a position in the surface. `f` returns whether it used the event.
pub fn with_motion(
    id: u32,
    x: f64,
    y: f64,
    f: impl FnOnce(&mut Motion, &Scene, [f32; 2]) -> bool,
) -> bool {
    let Some(surface) = get(id) else { return false };
    let surface = &mut *surface.borrow_mut();
    let position = [x, y].map(|it| it as f32 / surface.scene.zoom);
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
    if surface
        .starved_at
        .is_some_and(|it| it.elapsed() < host::interval() * 3 / 5)
    {
        diagnostics::note(Incident::CaughtUp);
        surface.advance(Instant::now());
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
pub fn show_image(id: u32, image: u32) {
    let Some(surface) = get(id) else { return };
    let surface = &mut *surface.borrow_mut();
    (surface.scene, surface.motion, surface.image) = (Scene::default(), Motion::default(), image);
    surface.update_backing();
    surface.refresh();
}

pub fn set_regions_of_image(id: u32, image: u32, regions: Vec<abi::Region>) {
    let Some(surface) = get(id).filter(|it| it.borrow().image == image) else {
        return;
    };
    let surface = &mut *surface.borrow_mut();
    surface.scene.regions = regions;
    surface.refresh();
}

pub fn image_changed(id: u32) {
    let shows_it = |item: &Item| matches!(item, Item::Image { image, .. } if *image == id);
    SURFACES.with_borrow(|surfaces| {
        let surfaces = surfaces.values().map(|surface| surface.borrow());
        surfaces
            .filter(|surface| surface.scene.items.iter().any(shows_it))
            .for_each(|surface| surface.refresh());
    });
}

pub fn begin_frame(state: &WindowState) {
    let (now, mut is_scrolling, mut is_followed) = (Instant::now(), false, false);
    for surface in in_window(state) {
        let surface = &mut *surface.borrow_mut();
        if surface.is_visible {
            surface.advance(now);
            is_scrolling |= surface.is_scrolling();
            is_followed |= surface.is_scrolling() && surface.motion.next == Next::Frame;
        }
        if now >= surface.last_early_frame + host::interval() / 2 {
            surface.begin_frame(now);
        } else if surface.frame_deadline.is_some() {
            window::request_frame(state.id);
        }
    }
    diagnostics::frame_began(now, host::interval(), is_scrolling, is_followed);
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

pub fn request_frame(id: u32) {
    if let Some(surface) = get(id) {
        surface.borrow_mut().request_frame();
    }
}

/// `index` is into `cursors` in `internal/desktop/native.ts`.
pub fn set_cursor(id: u32, index: u32) {
    use Cursor::*;
    const CURSORS: [Cursor; 22] = [
        Arrow,
        PointingHand,
        IBeam,
        VerticalIBeam,
        Crosshair,
        OpenHand,
        ClosedHand,
        NotAllowed,
        DragLink,
        DragCopy,
        ContextMenu,
        ResizeColumn,
        ResizeRow,
        ResizeLeft,
        ResizeRight,
        ResizeUp,
        ResizeDown,
        ResizeLeftRight,
        ResizeUpDown,
        ResizeUpLeftDownRight,
        ResizeUpRightDownLeft,
        Hidden,
    ];
    let Some(surface) = get(id) else { return };
    let cursor = CURSORS.get(index as usize).copied().unwrap_or_default();
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
    accessibility::update(&state);
}

pub fn is_focusable(id: u32) -> bool {
    get(id).is_some_and(|surface| surface.borrow().is_focusable)
}

pub fn command(name: &str, arguments: &Value) -> Result<Value> {
    let id = arguments["id"].as_u64().context("the surface has no id")? as u32;
    if name == "create" {
        let number = |key: &str, otherwise: f32| {
            arguments[key]
                .as_f64()
                .map_or(otherwise, |number| number as f32)
        };
        let mut surface = Surface {
            id,
            window: None,
            bounds: None,
            rect: Rect {
                x: 0.,
                y: 0.,
                width: number("width", 0.),
                height: number("height", 0.),
            },
            scale: number("scale", 1.),
            is_visible: true,
            is_passthrough: false,
            is_focusable: arguments["focusable"] != false,
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
            accessibility: accessibility::Tree::default(),
        };
        surface.update_backing();
        SURFACES.with_borrow_mut(|surfaces| surfaces.insert(id, Rc::new(RefCell::new(surface))));
        return Ok(Value::Null);
    }
    let shared = get(id).context("the surface was destroyed")?;
    let state = shared
        .borrow()
        .window
        .and_then(|window| window::state(window).ok());
    match name {
        "destroy" => {
            detach(id);
            SURFACES.with_borrow_mut(|surfaces| surfaces.remove(&id));
        }
        "attach" => {
            let target = arguments["window"]
                .as_u64()
                .map(|window| window::state(window as u32))
                .transpose()?;
            let index = arguments["index"].as_u64().unwrap_or(u64::MAX) as usize;
            match (&state, &target) {
                (Some(from), Some(to)) if from.id == to.id => {
                    to.surfaces.borrow_mut().retain(|other| *other != id)
                }
                _ => detach(id),
            }
            if let Some(target) = target {
                let index = index.min(target.surfaces.borrow().len());
                target.surfaces.borrow_mut().insert(index, id);
                shared.borrow_mut().window = Some(target.id);
                shared.borrow_mut().place_in(&target, true);
                if target.focused_surface.get().is_none() && is_focusable(id) {
                    input::focus(&target, Some(id));
                }
                window::refresh(target.id);
                accessibility::update(&target);
            }
        }
        "set" => {
            let surface = &mut *shared.borrow_mut();
            if let Some(bounds) = arguments.get("bounds") {
                surface.bounds = parse_rect(bounds);
            }
            surface.is_visible = arguments["visible"].as_bool().unwrap_or(surface.is_visible);
            surface.is_passthrough = arguments["passthrough"]
                .as_bool()
                .unwrap_or(surface.is_passthrough);
            surface.radius = arguments["radius"]
                .as_f64()
                .map_or(surface.radius, |radius| radius as f32);
            surface.canvas = arguments["canvas"]
                .as_u64()
                .map_or(surface.canvas, |color| color as u32);
            surface.background = arguments["background"]
                .as_u64()
                .map_or(surface.background, |color| color as u32);
            match &state {
                Some(state) => surface.place_in(state, false),
                None => surface.place(surface.bounds.unwrap_or(surface.rect), surface.scale, false),
            }
            surface.refresh();
        }
        "size" => {
            let (surface, (x, y)) = (
                shared.borrow(),
                state.map_or((0., 0.), |state| state.metrics.get().origin),
            );
            let Rect { width, height, .. } = surface.rect;
            let (x, y) = (x + surface.rect.x, y + surface.rect.y);
            return Ok(
                json!({ "width": width, "height": height, "scale": surface.scale, "x": x, "y": y }),
            );
        }
        "focus" => {
            if let Some(state) = state {
                input::focus(&state, Some(id));
            }
        }
        "ime" => {
            let before = std::mem::replace(&mut shared.borrow_mut().ime, Ime::parse(arguments));
            if arguments["edits"] != u64::from(bridge::edits()) {
                shared.borrow_mut().ime.keep_text_of(&before);
            }
            if let Some(state) = state {
                input::ime_changed(&state, &before, id);
            }
        }
        "capture" => return shared.borrow().capture(arguments),
        "a11y" => {
            shared.borrow_mut().accessibility = accessibility::Tree::deserialize(arguments)?;
            if let Some(state) = state {
                accessibility::update(&state);
            }
        }
        _ => bail!("unknown command surface.{name}"),
    }
    Ok(Value::Null)
}
