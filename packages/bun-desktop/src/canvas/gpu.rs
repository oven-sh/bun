//! While the CPU takes long to draw a canvas, a GPU does it.

use std::ops::Range;
use std::time::{Duration, Instant};

use super::*;
use crate::error::Result;
use crate::paint::cpu::{GlyphKey, GlyphPlacer};
use crate::paint::vector::{
    self, Ink, MAX_AREA, Operator, Scene, Source, Space, Target, Texture, Use,
};
use crate::text::{GlyphImage, GlyphPixels};

pub struct Accelerated {
    target: Target,
    area: i64,
    /// What it was not given yet.
    scene: Scene,
    is_ahead_of_layer: bool,
    is_behind_layer: bool,
    /// The scene shows what another canvas has now.
    borrows: bool,
    drawn_at: Instant,
    log: Log,
}

/// What the layer lacks, for when the GPU fails.
struct Log {
    id: u32,
    state: State,
    clips: Vec<Clip>,
    parts: Vec<Part>,
    /// The versions of what they draw. Later ones may be from another origin.
    images: FastMap<u32, u32>,
    bytes: usize,
    /// The first command of the running list that is not in `parts`.
    next: usize,
    /// It hides what the layer has.
    starts_blank: bool,
    /// It was when the last frame has ended.
    was_long: bool,
}

enum Part {
    Commands(Rc<Owned>, Range<usize>),
    Pixels(Layer),
}

#[derive(Default)]
pub struct Load {
    selected_at: Option<Instant>,
    /// In this frame.
    spent: Duration,
    interruptions: u32,
    units: usize,
    /// How many frames in a row have spoken for a change.
    votes: u32,
    changes: u32,
    /// In the last frame that the CPU has drawn.
    spent_before: Duration,
    /// How many units would not take the CPU long.
    few: Option<usize>,
    /// It goes back to the GPU as soon as it is drawn on.
    rests: bool,
}

/// What the scene of that generation has of the state.
#[derive(Default)]
pub struct Known {
    generation: u32,
    /// For filling and for stroking.
    inks: [Option<Ink>; 2],
    space: Option<Option<Space>>,
    how: Option<Option<Operator>>,
    has_clip: bool,
    image: Option<((u32, u32), Found)>,
    /// What `look_up` has said, until other canvases may change.
    looked_up: Option<(u32, Option<Pixels>)>,
    lent: Option<Found>,
}

/// How many there are, and whether they are those of a canvas that a GPU draws.
type Pixels = ([u32; 2], bool);

impl Known {
    #[inline]
    pub fn forget(&mut self, command: &Command) {
        match command {
            Command::FillPaint(_) => self.inks[0] = None,
            Command::StrokePaint(_) => self.inks[1] = None,
            Command::Transform(_) => (self.inks, self.space) = ([None; 2], None),
            Command::Compositing { .. } | Command::Smoothing(_) => {
                (self.inks, self.how) = ([None; 2], None)
            }
            Command::Clip { .. } | Command::RestoreClip => self.has_clip = false,
            _ => {}
        }
    }
}

#[derive(Clone)]
struct Found {
    source: Source,
    size: [u32; 2],
}

struct Kept {
    found: Found,
    version: u32,
    /// Of the scene that used it last.
    generation: u32,
    _tile: Option<Arc<Pixmap>>,
}

struct Glyph {
    image: Option<Rc<GlyphImage>>,
    generation: u32,
    address: u32,
}

#[derive(Default)]
struct Store {
    /// By the number of the image or the address of the tile, and the variant.
    images: FastMap<(usize, u32), Kept>,
    bytes: usize,
    glyphs: FastMap<GlyphKey, Glyph>,
    path: Path,
}

thread_local! {
    static STORE: RefCell<Store> = RefCell::default();
    /// Of all targets.
    static AREA: Cell<i64> = const { Cell::new(0) };
    static REST_AT: Cell<Option<Instant>> = const { Cell::new(None) };
}

pub const REST_AFTER: Duration = Duration::from_secs(2);

/// Returns whether the GPU still has any.
pub fn rest(idle_for: Duration) -> bool {
    let all: Vec<_> = CANVASES.with_borrow(|all| {
        all.iter()
            .filter(|it| it.1.borrow().accelerated.is_some())
            .map(|it| (*it.0, it.1.clone()))
            .collect()
    });
    let (idle, busy): (Vec<_>, Vec<_>) = all.into_iter().partition(|it| {
        it.1.borrow()
            .accelerated
            .iter()
            .all(|it| it.drawn_at.elapsed() >= idle_for)
    });
    for (id, canvas) in idle {
        let mut canvas = canvas.borrow_mut();
        canvas.load.rests = true;
        canvas.slow_down();
        drop(canvas);
        surface::image_changed(id);
    }
    if busy.is_empty() {
        CANVASES.with_borrow(|all| {
            all.values()
                .for_each(|it| it.borrow_mut().known = Known::default())
        });
        STORE.take();
    }
    !busy.is_empty()
}

pub fn next_chore() -> Option<Instant> {
    REST_AT.get()
}

pub fn do_chores() {
    if REST_AT.get().is_some_and(|time| time <= Instant::now()) {
        let is_busy = rest(REST_AFTER);
        REST_AT.set(is_busy.then(|| Instant::now() + REST_AFTER));
        if !is_busy {
            vector::rest();
        }
    }
}

pub fn stop() {
    rest(Duration::ZERO);
    vector::stop();
}

pub fn forget(image: u32) {
    if REST_AT.get().is_some() {
        STORE.with_borrow_mut(|store| store.retain(|key, _| key.0 != image as usize));
    }
}

/// The last frame, if a GPU has drawn all of it.
#[cfg(target_os = "macos")]
pub fn picture(id: u32) -> Option<vector::Picture> {
    let canvas = get(id)?;
    let canvas = canvas.try_borrow().ok()?;
    canvas.accelerated.as_ref()?.target.picture()
}

impl Kept {
    fn bytes(&self) -> usize {
        if let Source::Texture(_) = self.found.source {
            self.found.size[0] as usize * self.found.size[1] as usize * 4
        } else {
            0
        }
    }
}

impl Store {
    fn retain(&mut self, keeps: impl Fn(&(usize, u32), &Kept) -> bool) {
        self.images.retain(|key, it| keeps(key, it));
        self.bytes = self.images.values().map(Kept::bytes).sum();
    }

    fn find(&mut self, key: (usize, u32), version: u32, scene: &Scene) -> Option<Found> {
        let is_there = |it: &Kept| {
            it.generation == scene.generation() || matches!(it.found.source, Source::Texture(_))
        };
        let kept = self
            .images
            .get_mut(&key)
            .filter(|it| it.version == version && is_there(it))?;
        kept.generation = scene.generation();
        Some(kept.found.clone())
    }

    /// Only what is in `changed` differs from the version before.
    fn keep(
        &mut self,
        key: (usize, u32),
        version: u32,
        pixmap: &Pixmap,
        changed: Option<IntRect>,
        tile: Option<&Arc<Pixmap>>,
        scene: &mut Scene,
    ) -> Option<Found> {
        const SMALL: usize = 128 * 128;
        const MAX_BYTES: usize = 256 << 20;
        const MAX_IMAGES: usize = 4096;
        let (size, pixels): (_, &[Pixel]) = (
            [pixmap.width(), pixmap.height()],
            pixmap.data().as_chunks().0,
        );
        let (all, width) = (
            IntRect::new(0, 0, size[0] as i32, size[1] as i32),
            size[0] as usize,
        );
        let before = self
            .images
            .remove(&key)
            .inspect(|it| self.bytes -= it.bytes());
        let source = match before.map(|it| it.found) {
            _ if pixels.len() <= SMALL => scene.keep_pixels(pixels, width),
            Some(Found {
                source: Source::Texture(texture),
                size: had,
            }) if had == size && Rc::strong_count(&texture) == 1 => {
                let changed = changed.map_or(all, |it| it.intersect(all));
                if !changed.is_empty() {
                    texture
                        .write(
                            changed,
                            &pixels[changed.top as usize * width + changed.left as usize..],
                            width,
                        )
                        .ok()?;
                }
                Source::Texture(texture)
            }
            _ => {
                let texture = Texture::new(all.right, all.bottom).ok()?;
                texture.write(all, pixels, width).ok()?;
                Source::Texture(Rc::new(texture))
            }
        };
        if self.bytes > MAX_BYTES || self.images.len() > MAX_IMAGES {
            self.retain(|_, it| it.generation == scene.generation());
        }
        let kept = Kept {
            found: Found { source, size },
            version,
            generation: scene.generation(),
            _tile: tile.cloned(),
        };
        self.bytes += kept.bytes();
        Some(
            self.images
                .entry(key)
                .insert_entry(kept)
                .get()
                .found
                .clone(),
        )
    }
}

impl Log {
    fn add(&mut self, list: &Rc<Owned>, next: usize) {
        let start = std::mem::replace(&mut self.next, next);
        match self.parts.last_mut() {
            _ if start >= next => {}
            Some(Part::Commands(known, last)) if Rc::ptr_eq(known, list) && last.end == start => {
                last.end = next
            }
            last => {
                self.bytes += if matches!(last, Some(Part::Commands(known, _)) if Rc::ptr_eq(known, list))
                {
                    0
                } else {
                    list.bytes()
                };
                self.parts.push(Part::Commands(list.clone(), start..next));
            }
        }
    }

    fn start_over(&mut self, state: &State, clips: &[Clip]) {
        self.state.clone_from(state);
        clips.clone_into(&mut self.clips);
        self.parts.clear();
        self.images.clear();
        (self.bytes, self.starts_blank, self.was_long) = (0, false, false);
    }

    const LONG: usize = if cfg!(test) { 1 << 14 } else { 16 << 20 };

    fn is_too_long(&self) -> bool {
        self.bytes > Self::LONG * 4
    }
}

impl Drop for Accelerated {
    fn drop(&mut self) {
        AREA.set(AREA.get() - self.area);
    }
}

impl Accelerated {
    fn catch_up(&mut self, layer: &Layer) -> Result<()> {
        if std::mem::take(&mut self.is_behind_layer) {
            self.target.write(layer.pixels())
        } else {
            Ok(())
        }
    }

    fn submit(&mut self, layer: &mut Layer, wanted: IntRect) -> Result<()> {
        if !self.scene.is_empty() {
            self.is_behind_layer &= !self.scene.hides_what_was_there();
            self.catch_up(layer)?;
            self.target.draw(&mut self.scene)?;
            self.is_ahead_of_layer = true;
        }
        self.scene.start_over(None);
        self.borrows = false;
        if self.is_ahead_of_layer && !wanted.is_empty() {
            #[cfg(test)]
            crate::error::ensure!(!vector::tests::FAILS.get(), "it is gone");
            self.is_ahead_of_layer = wanted != layer.rect;
            self.target.read(wanted, layer.pixels_mut())?;
        }
        Ok(())
    }
}

fn version_of(image: u32) -> Option<u32> {
    size_and_version(image)
        .map(|it| it.1)
        .or_else(|| images::with_first_frame(image, |_, version| version))
}

fn corners(
    Rect {
        x,
        y,
        width,
        height,
    }: Rect,
    matrix: &Transform,
) -> [Point; 3] {
    [
        Point::new(x, y),
        Point::new(x + width, y),
        Point::new(x + width, y + height),
    ]
    .map(|it| matrix.map(it))
}

/// One command at a time.
struct Painter<'a> {
    state: &'a State,
    known: &'a mut Known,
    scene: &'a mut Scene,
    how: Operator,
}

impl Painter<'_> {
    /// `Err(true)` if there is nothing to draw.
    #[inline]
    fn ink(&mut self, strokes: bool) -> Result<Ink, bool> {
        if let Some(known) = self.known.inks[usize::from(strokes)] {
            return Ok(known);
        }
        let ink = match if strokes {
            &self.state.stroke
        } else {
            &self.state.fill
        } {
            Style::Color(color) => Ink::solid(premultiply(with_alpha(*color, self.state.alpha))),
            style => self.shade(style)?,
        };
        Ok(*self.known.inks[usize::from(strokes)].insert(ink.with(self.how)))
    }

    fn shade(&mut self, style: &Style) -> Result<Ink, bool> {
        let (
            State {
                matrix,
                alpha,
                is_smooth,
                ..
            },
            is_nothing,
        ) = (self.state, !self.how.clears_backdrop());
        match style {
            Style::Color(_) => Err(false),
            Style::Gradient(gradient) => self
                .scene
                .gradient(gradient, &matrix.invert().ok_or(is_nothing)?, *alpha)
                .ok_or(false),
            Style::Pattern {
                tile,
                repeats,
                matrix: by,
            } => {
                let (inverse, key) = (
                    matrix.pre_concat(*by).invert().ok_or(is_nothing)?,
                    (Arc::as_ptr(tile) as usize, u32::MAX),
                );
                let found = STORE.with_borrow_mut(|it| {
                    it.find(key, 0, self.scene)
                        .or_else(|| it.keep(key, 0, tile, None, Some(tile), self.scene))
                });
                found
                    .map(|it| {
                        self.scene
                            .pattern(&it.source, it.size, *repeats, *is_smooth, &inverse, *alpha)
                    })
                    .ok_or(false)
            }
        }
    }

    #[inline]
    fn rect(&mut self, rect: Rect, ink: Ink) -> bool {
        if self.state.matrix.has_skew() {
            return self
                .scene
                .parallelogram(corners(rect, &self.state.matrix), ink);
        }
        let device = map_rect(&self.state.matrix, rect);
        let pixels = IntRect::nearest(device);
        if pixels.to_rect() == device {
            self.scene.rect(pixels, ink);
            return true;
        }
        self.scene.parallelogram(
            corners(
                intersect(device, self.scene.clip().outset(1).to_rect()),
                &Transform::identity(),
            ),
            ink,
        )
    }

    #[inline]
    fn stroke(&mut self, path: Result<&[PathVerb], Rect>, ink: Ink) -> bool {
        let State {
            matrix,
            pen,
            dashes,
            ..
        } = self.state;
        let Some(space) = *self
            .known
            .space
            .get_or_insert_with(|| self.scene.space(matrix))
        else {
            return !self.how.clears_backdrop();
        };
        match path {
            Ok(&[PathVerb::Move(from), PathVerb::Line(to)]) if dashes.is_empty() => self
                .scene
                .line([from.into(), to.into()], &stroke(*pen, &[]), space, ink),
            Ok(verbs) if dashes.is_empty() => {
                self.scene
                    .stroke(verbs.iter().map(command), &stroke(*pen, &[]), space, ink)
            }
            path => STORE.with_borrow_mut(|Store { path: kept, .. }| {
                kept.clear();
                match (path, matrix.invert()) {
                    (Ok(verbs), Some(inverse)) => {
                        prune(verbs.iter().map(|it| command(it).transform(&inverse)), kept)
                    }
                    (Err(rect), _) => prune(rect_commands(rect).into_iter(), kept),
                    _ => {}
                }
                let clip = self.scene.clip();
                let dashed = self.state.pen().dashes_of(
                    kept,
                    matrix,
                    [
                        Point::new(clip.left as f32, clip.top as f32),
                        Point::new(clip.right as f32, clip.bottom as f32),
                    ],
                );
                let pen = stroke(*pen, if dashed.is_some() { dashes } else { &[] });
                self.scene.stroke(
                    dashed
                        .as_ref()
                        .unwrap_or(kept)
                        .iter()
                        .map(|it| it.transform(matrix)),
                    &pen,
                    space,
                    ink,
                )
            }),
        }
    }

    fn text(&mut self, line: &Line, matrix: &Transform, ink: Ink) -> bool {
        const MAX_GLYPHS: usize = 8192;
        const MAX_SIZE: f32 = 256.;
        let (frame, clip) = (Frame::new(1., false), self.scene.clip());
        let color = match self.state.fill {
            Style::Color(color) => with_alpha(color, self.state.alpha),
            Style::Gradient(_)
                if line
                    .runs
                    .iter()
                    .all(|it| text::face(it.0.id).is_some_and(|it| !it.file.has_color)) =>
            {
                0xFF
            }
            _ => return false,
        };
        let is_simple = |(face, glyphs): &(abi::Face, Vec<abi::Glyph>)| {
            face.size * matrix.sx <= MAX_SIZE && glyphs.len() < 256
        };
        if self.how != Operator::OVER
            || !GlyphPlacer::takes(matrix)
            || line.runs.len() > 16
            || !line.runs.iter().all(is_simple)
        {
            return false;
        }
        let before = self.scene.mark();
        STORE.with_borrow_mut(|Store { glyphs: known, .. }| {
            if known.len() > MAX_GLYPHS {
                known.clear();
            }
            for (face, glyphs) in &line.runs {
                let Some(placer) =
                    GlyphPlacer::new(&frame, matrix, [0., 0.], face.id, face.size, color)
                else {
                    continue;
                };
                let near = clip.outset((face.size * matrix.sx * 3.) as i32 + 2);
                for (key, x, y) in glyphs
                    .iter()
                    .map(|it| placer.place(it))
                    .filter(|(_, x, y)| near.contains(IntRect::new(*x, *y, x + 1, y + 1)))
                {
                    let glyph = known.entry(key).or_insert_with(|| Glyph {
                        image: cpu::cached_glyph(key),
                        generation: 0,
                        address: 0,
                    });
                    let Some(image) = &glyph.image else { continue };
                    let (is_new, rect) = (
                        std::mem::replace(&mut glyph.generation, self.scene.generation())
                            != self.scene.generation(),
                        image.rect.offset(x, y),
                    );
                    if is_new && !self.scene.has_room(rect.area() as usize * 4) {
                        self.scene.go_back(before);
                        return false;
                    }
                    match &image.pixels {
                        GlyphPixels::Mask(mask) => {
                            if is_new {
                                glyph.address = self.scene.keep_mask(mask);
                            }
                            self.scene.stamp(glyph.address, rect, ink);
                        }
                        GlyphPixels::Color(layer) => {
                            if is_new
                                && let Source::Scene(address, _) =
                                    self.scene.keep_pixels(layer.pixels(), rect.width())
                            {
                                glyph.address = address;
                            }
                            self.scene.copy(
                                &Source::Scene(glyph.address, rect.width() as u32),
                                [0, 0],
                                rect,
                                color as u8,
                                Operator::OVER,
                            );
                        }
                    }
                }
            }
            true
        })
    }

    /// `variant` says how often it is halved in each direction.
    fn find(&mut self, image: u32, variant: u32) -> Option<Found> {
        if let Some(found) = self.known.lent.as_ref().or(self
            .known
            .image
            .as_ref()
            .filter(|it| it.0 == (image, variant))
            .map(|it| &it.1))
        {
            return Some(found.clone());
        }
        self.known.image = None;
        let (canvas, key) = (get(image), (image as usize, variant));
        let found = STORE.with_borrow_mut(|store| {
            let known = canvas
                .as_ref()
                .map(|it| it.borrow().version)
                .and_then(|it| store.find(key, it, self.scene));
            known.or_else(|| {
                let changed = canvas
                    .as_ref()
                    .filter(|_| variant == 0)
                    .map(|it| std::mem::take(&mut it.borrow_mut().changed));
                images::with_first_frame(image, |content, version| {
                    let Content::Pixels(pixmap) = content else {
                        return None;
                    };
                    store.find(key, version, self.scene).or_else(|| {
                        let size = (
                            (pixmap.width() >> (variant & 255)).max(1),
                            (pixmap.height() >> (variant >> 8)).max(1),
                        );
                        let reduced = if variant == 0 {
                            None
                        } else {
                            Some(images::resampled(image, version, pixmap, size)?)
                        };
                        store.keep(
                            key,
                            version,
                            reduced.as_deref().unwrap_or(pixmap),
                            changed,
                            None,
                            self.scene,
                        )
                    })
                })?
            })
        })?;
        self.known.image = Some(((image, variant), found.clone()));
        Some(found)
    }

    #[inline]
    fn image(
        &mut self,
        image: u32,
        pixels: [u32; 2],
        is_borrowed: bool,
        size: [f32; 2],
        [from, to]: [Rect; 2],
    ) -> bool {
        let Placed {
            from,
            part,
            placement,
            shift,
        } = Placed::new(
            &self.state.matrix,
            size,
            pixels.map(|it| it as f32),
            from,
            to,
        );
        let opacity = (self.state.alpha.min(1.) * 255.).round() as u8;
        if let Some([dx, dy]) = shift {
            return self
                .find(image, 0)
                .map(|it| {
                    self.scene.copy(
                        &it.source,
                        [part.left, part.top],
                        part.offset(dx, dy),
                        opacity,
                        self.how,
                    )
                })
                .is_some();
        }
        let (scale_x, scale_y) = placement.get_scale();
        let halvings = |scale: f32| {
            if scale < 0.5 && self.state.is_smooth && !is_borrowed {
                (1. / scale).log2().min(15.) as u32
            } else {
                0
            }
        };
        let Some(found) = self.find(image, halvings(scale_x) | halvings(scale_y) << 8) else {
            return false;
        };
        let [x, y] = [0, 1].map(|axis| found.size[axis] as f32 / pixels[axis] as f32);
        let all = Rect {
            x: 0.,
            y: 0.,
            width: found.size[0] as f32,
            height: found.size[1] as f32,
        };
        let part = intersect(
            Rect {
                x: from.x * x,
                y: from.y * y,
                width: from.width * x,
                height: from.height * y,
            },
            all,
        );
        self.scene.image(
            &found.source,
            part,
            corners(from, &placement),
            opacity,
            self.state.is_smooth,
            self.how,
        )
    }

    /// What the CPU draws on nothing.
    fn apart(&mut self, command: Command, list: &Owned) -> bool {
        if self.how != Operator::OVER && self.state.has_shadow() {
            return false;
        }
        let mut drawn = None;
        State {
            mode: BlendMode::SourceOver,
            clip: Clip::new(self.scene.clip()),
            ..self.state.clone()
        }
        .draw(Onto::NewLayer(&mut drawn), command, list);
        match drawn {
            Some(it) if size_of_val(it.pixels()) <= Scene::MAX_BYTES => {
                let source = self.scene.keep_pixels(it.pixels(), it.rect.width());
                self.scene.copy(&source, [0, 0], it.rect, 255, self.how);
            }
            Some(it) => {
                let Ok(texture) = Texture::new(it.rect.width() as i32, it.rect.height() as i32)
                else {
                    return false;
                };
                if texture
                    .write(
                        it.rect.offset(-it.rect.left, -it.rect.top),
                        it.pixels(),
                        it.rect.width(),
                    )
                    .is_err()
                {
                    return false;
                }
                self.scene.copy(
                    &Source::Texture(Rc::new(texture)),
                    [0, 0],
                    it.rect,
                    255,
                    self.how,
                );
            }
            None => self
                .scene
                .rect(IntRect::default(), Ink::solid([0; 4]).with(self.how)),
        }
        true
    }
}

impl Canvas {
    /// Not while there are jobs.
    fn speed_up(&mut self) {
        if let Some(rect) = self
            .layer
            .as_ref()
            .map(|it| it.rect)
            .filter(|_| !self.is_read_often)
            && rect.area() <= MAX_AREA
            && AREA.get() + rect.area() <= MAX_AREA * 2
            && vector::is_ready()
            && let Ok(target) = Target::new(rect.right, rect.bottom)
        {
            let log = Log {
                id: 0,
                state: self.state.clone(),
                clips: self.clips.clone(),
                parts: Vec::new(),
                images: FastMap::default(),
                bytes: 0,
                next: 0,
                starts_blank: false,
                was_long: false,
            };
            let (scene, drawn_at) = (Scene::new(rect, self.is_opaque), Instant::now());
            self.accelerated = Some(Box::new(Accelerated {
                target,
                area: rect.area(),
                scene,
                is_ahead_of_layer: false,
                is_behind_layer: true,
                borrows: false,
                drawn_at,
                log,
            }));
            AREA.set(AREA.get() + rect.area());
            REST_AT.set(REST_AT.get().or(Some(drawn_at + REST_AFTER)));
        }
    }

    fn slow_down(&mut self) {
        self.settle();
        self.accelerated = None;
    }

    /// For the commands from `next` on.
    pub(super) fn select(&mut self, id: u32, next: usize) {
        if self.accelerated.is_none()
            && (std::mem::take(&mut self.load.rests) || vector::usage() == Use::Always)
        {
            self.speed_up();
        }
        match &mut self.accelerated {
            Some(gpu) => (gpu.log.id, gpu.log.next) = (id, next),
            None => self.load.selected_at = Some(Instant::now()),
        }
    }

    /// Other canvases may change before that command runs, if there is one.
    pub(super) fn pause(&mut self, list: &Rc<Owned>, next: usize) {
        (self.known.image, self.known.looked_up, self.known.lent) = (None, None, None);
        let Some(gpu) = &mut self.accelerated else {
            let (since, now) = (self.load.selected_at.take(), Instant::now());
            (self.load.spent, self.load.selected_at) = (
                self.load.spent + since.map_or(Duration::ZERO, |it| now - it),
                (next < list.commands.len()).then_some(now),
            );
            return;
        };
        gpu.log.add(list, next);
        if gpu.log.is_too_long() {
            self.settle();
        } else if gpu.borrows {
            self.submit(IntRect::default());
        }
    }

    /// The layer gets the pixels that are wanted.
    fn submit(&mut self, wanted: IntRect) {
        let (Some(gpu), Some(layer)) = (&mut self.accelerated, &mut self.layer) else {
            return;
        };
        self.load.units += gpu.scene.len();
        match gpu.submit(layer, wanted) {
            Ok(()) if wanted == layer.rect => {
                gpu.log.start_over(&self.state, &self.clips);
                self.changed = wanted;
            }
            Ok(()) => {}
            Err(error) => {
                crate::diagnostics::log!("a canvas is no longer drawn by the GPU: {error:#}");
                self.recover();
            }
        }
    }

    #[cold]
    fn recover(&mut self) {
        let Some(mut gpu) = self.accelerated.take() else {
            return;
        };
        let log = &mut gpu.log;
        vector::note_failure();
        let now = (
            std::mem::replace(&mut self.state, log.state.clone()),
            std::mem::replace(&mut self.clips, std::mem::take(&mut log.clips)),
        );
        let mut batch = Batch::default();
        for part in std::mem::take(&mut log.parts) {
            let (list, range) = match part {
                Part::Commands(list, range) => (list, range),
                Part::Pixels(pixels) => {
                    self.replace(pixels);
                    continue;
                }
            };
            for index in range {
                match list.commands[index] {
                    Command::Create { .. }
                    | Command::Snapshot(_)
                    | Command::Release(_)
                    | Command::DropFontScope(_) => {}
                    Command::Image { image, .. }
                        if image != log.id
                            && log.images.get(&image).copied() != version_of(image) => {}
                    command => _ = self.run(log.id, command, &list, index, &mut batch),
                }
            }
            batch.paint(self, &list);
        }
        (self.state, self.clips) = now;
        (self.load.changes, self.load.rests) = (self.load.changes + 4, false);
    }

    pub(super) fn settle(&mut self) {
        self.submit(
            self.layer
                .as_ref()
                .map_or_else(IntRect::default, |it| it.rect),
        );
    }

    /// For a script, which waits. Returns what the layer has now.
    pub(super) fn fetch(&mut self, wanted: IntRect) -> IntRect {
        self.load.interruptions += 1;
        let all = self
            .layer
            .as_ref()
            .map_or_else(IntRect::default, |it| it.rect);
        // What the log starts from stays as it is.
        let is_enough = self.load.interruptions == 1
            && self
                .accelerated
                .as_ref()
                .is_some_and(|it| it.log.starts_blank);
        let part = if is_enough {
            all.intersect(wanted)
        } else {
            all
        };
        self.submit(part);
        part
    }

    pub(super) fn end_frame(&mut self) {
        const LONG: Duration = Duration::from_millis(3);
        self.submit(IntRect::default());
        let Load {
            spent,
            interruptions,
            units,
            votes,
            changes,
            mut spent_before,
            mut few,
            rests,
            ..
        } = std::mem::take(&mut self.load);
        let (wants_change, weight, enough) = match &mut self.accelerated {
            None => {
                spent_before = spent;
                (spent > LONG && interruptions < 2, 1, 4 << changes.min(10))
            }
            Some(gpu) => {
                gpu.target.end_frame(!gpu.is_behind_layer);
                (gpu.drawn_at, gpu.log.was_long) = (Instant::now(), gpu.log.bytes > Log::LONG);
                let few = *few.get_or_insert(
                    (units as f32 * LONG.div_duration_f32(spent_before.max(LONG)) / 4.) as usize,
                );
                (
                    interruptions > 1 || units < few,
                    if interruptions > 1 { 20 } else { 1 },
                    60,
                )
            }
        };
        self.load = Load {
            votes: if wants_change { votes + weight } else { 0 },
            changes,
            spent_before,
            few,
            rests,
            ..Load::default()
        };
        if self.load.votes >= enough && vector::usage() == Use::IfItPays {
            let was_accelerated = self.accelerated.is_some();
            if was_accelerated {
                self.slow_down()
            } else {
                self.speed_up()
            }
            if was_accelerated != self.accelerated.is_some() {
                self.load = Load {
                    changes: changes + 1,
                    spent_before,
                    ..Load::default()
                };
            }
        }
    }

    /// Returns them if the layer has to take them.
    pub(super) fn write_on_gpu(&mut self, pixels: Layer) -> Option<Layer> {
        let Some(all) = self
            .accelerated
            .as_ref()
            .and(self.layer.as_ref())
            .map(|it| it.rect)
        else {
            return Some(pixels);
        };
        let shown = all.intersect(pixels.rect);
        let pixels = if shown == pixels.rect {
            pixels
        } else {
            pixels.copy(shown)?
        };
        let width = shown.width();
        if let Some(gpu) = self.accelerated.as_mut().filter(|_| shown == all) {
            gpu.scene
                .start_over(Some([0, 0, 0, if self.is_opaque { 255 } else { 0 }]));
            gpu.log.start_over(&self.state, &self.clips);
            gpu.log.starts_blank = true;
        }
        for top in (shown.top..shown.bottom).step_by((Scene::MAX_BYTES / 4 / width).max(1)) {
            let band = IntRect {
                top,
                bottom: shown
                    .bottom
                    .min(top + (Scene::MAX_BYTES / 4 / width).max(1) as i32),
                ..pixels.rect
            };
            if self
                .accelerated
                .as_ref()
                .is_some_and(|it| it.scene.is_full())
            {
                self.submit(IntRect::default());
            }
            let Some(gpu) = &mut self.accelerated else {
                return Some(pixels);
            };
            let source = gpu.scene.keep_pixels(
                &pixels.pixels()[(top - pixels.rect.top) as usize * width..]
                    [..band.height() * width],
                width,
            );
            gpu.scene.set_clip(shown, None);
            gpu.scene
                .copy(&source, [0, 0], band, 255, Operator::REPLACE);
        }
        self.known.has_clip = false;
        let log = &mut self.accelerated.as_mut()?.log;
        log.bytes += size_of_val(pixels.pixels());
        log.parts.push(Part::Pixels(pixels));
        if log.was_long || log.is_too_long() {
            self.settle();
        }
        None
    }

    /// If not, the layer has what was drawn before.
    #[inline]
    pub(super) fn draw_on_gpu(
        &mut self,
        id: u32,
        command: Command,
        list: &Rc<Owned>,
        index: usize,
    ) -> bool {
        let Some(gpu) = &mut self.accelerated else {
            return false;
        };
        if gpu.scene.is_full() {
            gpu.log.add(list, index);
            self.submit(IntRect::default());
        }
        self.describe(id, command, list, index) || self.interrupt(list, index)
    }

    #[cold]
    fn interrupt(&mut self, list: &Rc<Owned>, index: usize) -> bool {
        self.accelerated
            .iter_mut()
            .for_each(|it| it.log.add(list, index));
        self.settle();
        self.load.interruptions += 1;
        self.accelerated
            .iter_mut()
            .for_each(|it| (it.is_behind_layer, it.log.next) = (true, index + 1));
        false
    }

    /// The color that all pixels have after it.
    #[inline]
    fn covers_all(&self, command: Command) -> Option<Pixel> {
        let (state, blank) = (&self.state, [0, 0, 0, if self.is_opaque { 255 } else { 0 }]);
        let (rect, color) = match (command, &state.fill) {
            (Command::Erase, _) => return Some(blank),
            (Command::Reset([width, height]), _) => {
                return (self.layer.as_ref()?.rect
                    == IntRect::new(0, 0, width as i32, height as i32))
                .then_some(blank);
            }
            (Command::ClearRect(rect), _) => (rect, blank),
            (Command::FillRect(rect), Style::Color(color))
                if state.mode == BlendMode::SourceOver && !state.has_effects() =>
            {
                (
                    rect,
                    Some(premultiply(with_alpha(*color, state.alpha))).filter(|it| it[3] == 255)?,
                )
            }
            _ => return None,
        };
        let (all, device) = (
            self.layer.as_ref()?.rect,
            map_rect(&state.matrix, upright(rect)),
        );
        (intersect(device, all.to_rect()) == all.to_rect()
            && !state.matrix.has_skew()
            && state.clip.rect == all
            && state.clip.mask.is_none())
        .then_some(color)
    }

    /// If a GPU draws it.
    fn lend(&mut self) -> Option<Found> {
        self.submit(IntRect::default());
        let (gpu, layer) = (self.accelerated.as_mut()?, self.layer.as_ref()?);
        gpu.catch_up(layer).ok()?;
        Some(Found {
            source: Source::Texture(gpu.target.texture()),
            size: [layer.rect.right as u32, layer.rect.bottom as u32],
        })
    }

    fn look_up(&mut self, id: u32, image: u32, list: &Rc<Owned>, index: usize) -> Option<Pixels> {
        self.accelerated
            .as_mut()?
            .log
            .images
            .extend(version_of(image).map(|it| (image, it)));
        let lent = match image == id {
            true => {
                self.accelerated.as_mut()?.log.add(list, index);
                Some(self.lend()?)
            }
            false => get(image).and_then(|it| it.borrow_mut().lend()),
        };
        let Some(lent) = lent else {
            return images::with_first_frame(image, |it, _| {
                if let Content::Pixels(it) = it {
                    Some(([it.width(), it.height()], false))
                } else {
                    None
                }
            })?;
        };
        self.accelerated.as_mut()?.borrows = true;
        self.known.lent = Some(lent.clone());
        Some((lent.size, true))
    }

    #[inline]
    fn describe(&mut self, id: u32, command: Command, list: &Rc<Owned>, index: usize) -> bool {
        if let Some(color) = self.covers_all(command) {
            let (Some(gpu), Some(layer)) = (&mut self.accelerated, &self.layer) else {
                return false;
            };
            gpu.scene.start_over(Some(color));
            gpu.log.start_over(&self.state, &self.clips);
            (gpu.log.next, gpu.log.starts_blank) = (index, true);
            if let Command::Reset(_) = command {
                (self.state, self.clips) = (State::new(layer.rect), Vec::new());
            }
            return true;
        }
        if let Some(gpu) = self.accelerated.as_mut().filter(|it| it.log.was_long) {
            gpu.log.add(list, index);
            self.settle();
        }
        if let Command::Image { image, .. } = command
            && (image == id || self.known.looked_up.is_none_or(|it| it.0 != image))
        {
            (self.known.image, self.known.lent) = (None, None);
            self.known.looked_up = Some((image, self.look_up(id, image, list, index)));
        }
        let Some(gpu) = &mut self.accelerated else {
            return false;
        };
        let (state, known, scene) = (&self.state, &mut self.known, &mut gpu.scene);
        if std::mem::replace(&mut known.generation, scene.generation()) != scene.generation() {
            (
                known.inks,
                known.space,
                known.how,
                known.has_clip,
                known.image,
            ) = ([None; 2], None, None, false, None);
        }
        if !known.has_clip {
            known.has_clip = scene.set_clip(state.clip.rect, state.clip.mask.as_deref());
        }
        let (true, Some(how)) = (
            known.has_clip,
            *known.how.get_or_insert_with(|| Operator::of(state.mode)),
        ) else {
            return false;
        };
        if scene.clip().is_empty() && !matches!(command, Command::Reset(_)) {
            return true;
        }
        let mut painter = Painter {
            state,
            known,
            scene,
            how,
        };
        let strokes = matches!(
            command,
            Command::Stroke { .. } | Command::StrokeRect(_) | Command::Text { strokes: true, .. }
        );
        let ink =
            match command {
                Command::Reset(_) => {
                    (self.accelerated, self.load.rests) = (None, true);
                    return false;
                }
                Command::ClearRect(rect) => {
                    let black = Ink::solid([0, 0, 0, 255]);
                    return painter.rect(
                        upright(rect),
                        if self.is_opaque {
                            black
                        } else {
                            black.with(Operator::ERASE)
                        },
                    );
                }
                Command::Image { image, .. } if image == id && state.has_effects() => return false,
                _ if state.has_effects() => return painter.apart(command, list),
                Command::Image {
                    image,
                    size,
                    from,
                    to,
                } => {
                    let is_done = painter.known.looked_up.and_then(|it| it.1).is_some_and(
                        |(pixels, is_lent)| {
                            painter.image(
                                image,
                                pixels,
                                is_lent,
                                size,
                                [upright(from), upright(to)],
                            )
                        },
                    );
                    return is_done || image != id && painter.apart(command, list);
                }
                _ => match painter.ink(strokes) {
                    Ok(ink) => ink,
                    Err(is_nothing) => return is_nothing || painter.apart(command, list),
                },
            };
        let is_done = match command {
            Command::Fill { verbs, is_even_odd } => painter.scene.fill(
                list.verbs[verbs.range()].iter().map(super::command),
                fill_rule(is_even_odd),
                ink,
            ),
            Command::Stroke { verbs } => painter.stroke(Ok(&list.verbs[verbs.range()]), ink),
            Command::StrokeRect(rect) => painter.stroke(Err(upright(rect)), ink),
            Command::FillRect(rect) => painter.rect(upright(rect), ink),
            Command::Text {
                text,
                style,
                at,
                alignment,
                max_width,
                strokes,
            } => {
                let (line, matrix) = place_text(
                    &list.text[text.range()],
                    &style,
                    &state.matrix,
                    at,
                    alignment,
                    max_width,
                );
                !strokes && painter.text(&line, &matrix, ink)
            }
            _ => true,
        };
        is_done || painter.apart(command, list)
    }
}
