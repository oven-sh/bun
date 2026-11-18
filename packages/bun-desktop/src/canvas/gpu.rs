//! While the CPU takes long to draw a canvas, a GPU does it.

use std::f32::consts::TAU;
use std::time::{Duration, Instant};

use super::*;
use crate::abi_graphics::Verb;
use crate::error::Result;
use crate::paint::cpu::{GlyphKey, GlyphPlacer};
use crate::paint::vector::{
    self, Arc as Bow, Ink, MAX_AREA, Operator, Scene, Source, Space, Target, Texture, Use,
};
use crate::parallel;
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
    clips: Vec<SavedClip>,
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
    pub masked: i64,
    /// To share the work, in this list.
    tries: u32,
    /// For how many more lists that is worth it.
    lateness: u32,
    /// Until other canvases may change. Each one has only one place to be in.
    images: Vec<Option<Image>>,
}

struct Image {
    id: u32,
    pixels: Option<Pixels>,
    /// With the variant, and the generation of the scene.
    found: Option<([u32; 2], Found)>,
}

/// How many there are, and whether they are those of a canvas that a GPU draws.
type Pixels = ([u32; 2], bool);

impl Known {
    const IMAGES: usize = 64;

    #[inline]
    fn image(&mut self, id: u32) -> Option<&mut Image> {
        self.images
            .get_mut(id as usize % Self::IMAGES)?
            .as_mut()
            .filter(|it| it.id == id)
    }

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

pub struct ClipPath {
    list: Rc<Owned>,
    verbs: Span,
    pub rule: Fill,
    pub before: Option<Rc<ClipPath>>,
    count: u32,
}

impl ClipPath {
    pub fn outline(&self) -> Outline<'_> {
        self.list.outline(self.verbs)
    }

    fn apply(&self, scene: &mut Scene) -> bool {
        scene.clip_to(self.outline(), self.rule)
            && self.before.as_ref().is_none_or(|it| it.apply(scene))
    }
}

/// The path is between them.
#[inline(always)]
fn points(mut path: Outline, mut take: impl FnMut(Point)) {
    while let Some(verb) = Verb::read(&mut path.0) {
        let around =
            |[x, y, right, bottom]: [f32; 4]| [[x, y], [right, y], [right, bottom], [x, bottom]];
        let (all, count) = match verb {
            Verb::Move(to) | Verb::Line(to) => ([to; 4], 1),
            Verb::Quad(a, to) => ([a, to, to, to], 2),
            Verb::Cubic(a, b, to) => ([a, b, to, to], 3),
            Verb::Arc {
                center: [x, y],
                radius,
                ..
            } => (around([x - radius, y - radius, x + radius, y + radius]), 4),
            Verb::RoundRect { rect, .. } => (
                around([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]),
                4,
            ),
            Verb::Close => continue,
        };
        all[..count].iter().for_each(|it| take((*it).into()));
    }
}

impl State {
    /// False if a mask is better, as it is for a few small ones. `masked` counts their pixels.
    pub(super) fn put_off_clip(
        &mut self,
        list: &Rc<Owned>,
        verbs: Span,
        rule: Fill,
        masked: &mut i64,
    ) -> bool {
        const MAX_PATHS: u32 = 8;
        const FEW_PIXELS: i64 = 1 << 16;
        let (mut low, mut high, path) = (
            Point::new(f32::MAX, f32::MAX),
            Point::new(f32::MIN, f32::MIN),
            list.outline(verbs),
        );
        points(path, |it| {
            (low, high) = (
                Point::new(low.x.min(it.x), low.y.min(it.y)),
                Point::new(high.x.max(it.x), high.y.max(it.y)),
            )
        });
        let (bounds, count) = (
            Rect {
                x: low.x,
                y: low.y,
                width: high.x - low.x,
                height: high.y - low.y,
            },
            self.put_off.as_ref().map_or(1, |it| it.count + 1),
        );
        let is_upright = || {
            parallelogram(path.verbs(&mut [Verb::Close; 5]))
                .is_some_and(|[a, b, _]| a.x == b.x || a.y == b.y)
        };
        if count > MAX_PATHS
            || !(bounds.width + bounds.height).is_finite()
            || IntRect::around(bounds).to_rect() == bounds && is_upright()
        {
            return false;
        }
        let clip = self.clip.within_rect(around(bounds));
        if *masked + clip.rect.area() <= FEW_PIXELS {
            *masked += clip.rect.area();
            return false;
        }
        (*masked, self.clip) = (FEW_PIXELS, clip);
        self.put_off = Some(Rc::new(ClipPath {
            list: list.clone(),
            verbs,
            rule,
            before: self.put_off.take(),
            count,
        }));
        true
    }

    /// The one path that clips, if it is what shows of the parallelogram.
    fn clip_within(&self, [a, b, c]: [Point; 3]) -> Option<&ClipPath> {
        const SLACK: f32 = 1e-3;
        const FEW: usize = 256;
        let (path, inverse) = (
            self.put_off
                .as_deref()
                .filter(|it| it.count == 1 && it.verbs.range().len() < FEW)?,
            Transform::from_row(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y, a.x, a.y).invert()?,
        );
        let mut is_within = true;
        points(path.outline(), |it| {
            let it = inverse.map(it);
            is_within &= it.x.min(it.y) >= -SLACK && it.x.max(it.y) <= 1. + SLACK;
        });
        is_within.then_some(path)
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
    /// Unless others keep them.
    pixels: Option<Arc<Pixmap>>,
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
    parts: Vec<vector::Part>,
}

thread_local! {
    static STORE: RefCell<Store> = RefCell::default();
    /// Of all targets.
    static AREA: Cell<i64> = const { Cell::new(0) };
    static REST_AT: Cell<Option<Instant>> = const { Cell::new(None) };
}

/// The rest of such a frame does not wait for the next one.
const VERY_LONG: Duration = Duration::from_millis(40);
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
        let copies = usize::from(matches!(self.found.source, Source::Texture(_)))
            + usize::from(self.pixels.is_some());
        self.found.size[0] as usize * self.found.size[1] as usize * 4 * copies
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
            pixels: tile.cloned(),
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

    fn start_over(&mut self, state: &State, clips: &[SavedClip]) {
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
        if self.is_ahead_of_layer && !wanted.is_empty() {
            #[cfg(test)]
            crate::error::ensure!(!vector::tests::FAILS.get(), "it is gone");
            self.is_ahead_of_layer = wanted != layer.rect;
            self.target.read(wanted, layer.pixels_mut())?;
        }
        Ok(())
    }
}

fn parallelogram(verbs: &[Verb]) -> Option<[Point; 3]> {
    let [
        Verb::Move(a),
        Verb::Line(b),
        Verb::Line(c),
        Verb::Line(d),
        ref end @ ..,
    ] = *verbs
    else {
        return None;
    };
    let [a, b, c, d] = [a, b, c, d].map(Point::from);
    let off = a - b + c - d;
    (off.x.abs() + off.y.abs() < 1e-3 && matches!(end, [] | [Verb::Close])).then_some([a, b, c])
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

#[inline]
fn upright_rect(scene: &mut Scene, device: Rect, ink: Ink) -> bool {
    let pixels = IntRect::nearest(device);
    if pixels.to_rect() == device {
        scene.rect(pixels, ink);
        return true;
    }
    scene.soft_rect(intersect(device, scene.clip().outset(1).to_rect()), ink)
}

#[inline(always)]
fn fill(scene: &mut Scene, path: Outline, rule: Fill, ink: Ink) -> bool {
    match Verb::read(&mut { path.0 }) {
        Some(Verb::Arc {
            center,
            radius,
            from,
            sweep,
        }) if path.0.len() == 6
            && scene.pie(
                Bow {
                    center: center.into(),
                    radius,
                    from,
                    sweep,
                },
                false,
                ink,
            ) =>
        {
            true
        }
        _ => fill_any(scene, path, rule, ink),
    }
}

fn fill_any(scene: &mut Scene, path: Outline, rule: Fill, ink: Ink) -> bool {
    const FEW: usize = 13;
    if path.0.len() > FEW {
        return scene.fill(path, rule, ink);
    }
    let mut room = [Verb::Close; 5];
    let verbs = match path.verbs(&mut room) {
        [verbs @ .., Verb::Close] | verbs => verbs,
    };
    let is_done = match *verbs {
        [
            Verb::Arc {
                center,
                radius,
                from,
                sweep,
            },
        ] => scene.pie(
            Bow {
                center: center.into(),
                radius,
                from,
                sweep,
            },
            false,
            ink,
        ),
        [
            Verb::Move(tip),
            Verb::Arc {
                center,
                radius,
                from,
                sweep,
            },
            ref end @ ..,
        ]
        | [
            ref end @ ..,
            Verb::Arc {
                center,
                radius,
                from,
                sweep,
            },
            Verb::Line(tip),
        ] if (tip == center || sweep.abs() == TAU)
            && (end.is_empty() || matches!(*end, [Verb::Line(end)] if end == tip)) =>
        {
            scene.pie(
                Bow {
                    center: center.into(),
                    radius,
                    from,
                    sweep,
                },
                true,
                ink,
            )
        }
        [Verb::RoundRect { rect, radius }] => scene.rounded_rect(upright(rect), radius, 0., ink),
        _ => match parallelogram(verbs) {
            Some([a, b, c]) if [a.y, b.x] == [b.y, c.x] => upright_rect(
                scene,
                upright(Rect {
                    x: a.x,
                    y: a.y,
                    width: c.x - a.x,
                    height: c.y - a.y,
                }),
                ink,
            ),
            Some(corners) => scene.parallelogram(corners, ink),
            None => false,
        },
    };
    is_done || scene.fill(path, rule, ink)
}

/// Without dashes.
#[inline(always)]
fn stroke_solid(scene: &mut Scene, path: Outline, pen: Pen, space: Space, ink: Ink) -> bool {
    let (pen, mut rest) = (&stroke(pen, &[]), path.0);
    let is_done = path.0.len() == 6
        && match Verb::read(&mut rest) {
            Some(Verb::Move(from)) if let Some(Verb::Line(to)) = Verb::read(&mut rest) => {
                scene.line([from.into(), to.into()], pen, space, ink)
            }
            Some(Verb::Arc {
                center,
                radius,
                from,
                sweep,
            }) => scene.ring(
                Bow {
                    center: center.into(),
                    radius,
                    from,
                    sweep,
                },
                false,
                pen,
                space,
                ink,
            ),
            _ => false,
        };
    is_done || stroke_any(scene, path, pen, space, ink)
}

fn stroke_any(scene: &mut Scene, path: Outline, pen: &Stroke, space: Space, ink: Ink) -> bool {
    let is_done = match *path.verbs(&mut [Verb::Close; 2]) {
        [
            Verb::Arc {
                center,
                radius,
                from,
                sweep,
            },
            Verb::Close,
        ] => scene.ring(
            Bow {
                center: center.into(),
                radius,
                from,
                sweep,
            },
            true,
            pen,
            space,
            ink,
        ),
        [Verb::RoundRect { rect, radius }] => scene.frame(upright(rect), radius, pen, space, ink),
        _ => false,
    };
    is_done || scene.stroke(path, pen, space, ink)
}

/// What shapes of one color need of the state.
#[derive(Clone, Copy)]
struct Plain {
    /// For filling and for stroking.
    colors: [Option<u32>; 2],
    alpha: f32,
    mode: BlendMode,
    how: Operator,
    pen: Pen,
    has_dashes: bool,
    matrix: Transform,
}

impl Plain {
    /// False if it does not change the state, or not just this.
    #[inline(always)]
    fn follow(&mut self, command: Command) -> bool {
        match command {
            Command::FillColor(color) => self.colors[0] = Some(color),
            Command::StrokeColor(color) => self.colors[1] = Some(color),
            Command::LineWidth(width) => self.pen.width = width,
            Command::Transform(to) => self.matrix = matrix(to),
            Command::Compositing { alpha, operator } if MODES[operator as usize] == self.mode => {
                self.alpha = alpha
            }
            Command::Pen { pen, dashes } if dashes.range().is_empty() => {
                (self.pen, self.has_dashes) = (pen, false)
            }
            _ => return false,
        }
        true
    }

    /// Returns where it has stopped.
    fn describe(
        &mut self,
        scene: &mut Scene,
        commands: &[u32],
        parts: &[u32],
        Range { start, end }: Range<usize>,
    ) -> usize {
        let mut rest = &commands[start..end];
        loop {
            let left = rest.len();
            let Some(command) = Command::read(&mut rest) else {
                return end - left;
            };
            if self.follow(command) {
                continue;
            }
            let ink = |color| Ink::solid(pixel_of(color, self.alpha)).with(self.how);
            let is_done = match (command, self.colors) {
                _ if scene.is_full() => false,
                (Command::Fill { verbs, is_even_odd }, [Some(color), _]) => fill(
                    scene,
                    Outline(&parts[verbs.range()]),
                    fill_rule(is_even_odd),
                    ink(color),
                ),
                (Command::Stroke { verbs }, [_, Some(color)]) => Space::even(&self.matrix)
                    .is_some_and(|space| {
                        stroke_solid(
                            scene,
                            Outline(&parts[verbs.range()]),
                            self.pen,
                            space,
                            ink(color),
                        )
                    }),
                _ => false,
            };
            if !is_done {
                return end - left;
            }
        }
    }

    /// With the help of other threads, if there is much to do. Likewise.
    fn share(&mut self, scene: &mut Scene, list: &Owned, start: usize) -> usize {
        const WORDS_PER_PART: usize = 4096;
        // Small shapes take as long to share.
        if list.parts.len() < list.commands.len() * 4 {
            return start;
        }
        let (mut rest, mut ahead, mut words, mut shares) = (
            &list.commands[start..],
            *self,
            0,
            vec![(start..start, *self)],
        );
        loop {
            let at = list.commands.len() - rest.len();
            let verbs = match (Command::read(&mut rest), ahead.colors) {
                (Some(command), _) if ahead.follow(command) => continue,
                (Some(Command::Fill { verbs, .. }), [Some(_), _]) => verbs,
                (Some(Command::Stroke { verbs }), [_, Some(_)])
                    if !ahead.has_dashes && Space::even(&ahead.matrix).is_some() =>
                {
                    verbs
                }
                _ => break,
            };
            if words >= WORDS_PER_PART {
                shares.push((at..at, ahead));
                words = 0;
            }
            words += verbs.range().len();
            shares
                .last_mut()
                .into_iter()
                .for_each(|it| it.0.end = list.commands.len() - rest.len());
        }
        STORE.with_borrow_mut(|Store { parts, .. }| {
            if shares.len() < 3 || !scene.split(parts, shares.len()) {
                return start;
            }
            let (commands, words, mut stops) =
                (&list.commands[..], &list.parts[..], vec![0; shares.len()]);
            parallel::for_each(
                shares.iter_mut().zip(parts.iter_mut()).zip(&mut stops),
                |(((range, plain), part), stop)| {
                    *stop = plain.describe(part.scene(), commands, words, range.clone());
                },
            );
            let mut next = start;
            for (((range, plain), part), stop) in shares.iter().zip(parts.iter()).zip(stops) {
                if !scene.append(part) {
                    break;
                }
                (*self, next) = (*plain, stop);
                if stop < range.end {
                    break;
                }
            }
            next
        })
    }
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
    #[inline(always)]
    fn ink(&mut self, strokes: bool) -> Result<Ink, bool> {
        match (
            if strokes {
                &self.state.stroke
            } else {
                &self.state.fill
            },
            self.known.inks[usize::from(strokes)],
        ) {
            (Style::Color(color), _) => {
                Ok(Ink::solid(pixel_of(*color, self.state.alpha)).with(self.how))
            }
            (_, Some(known)) => Ok(known),
            (style, None) => {
                let ink = self.shade(style)?.with(self.how);
                Ok(*self.known.inks[usize::from(strokes)].insert(ink))
            }
        }
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
        upright_rect(self.scene, map_rect(&self.state.matrix, rect), ink)
    }

    #[inline(always)]
    fn stroke_path(&mut self, path: Outline, ink: Ink) -> bool {
        match self.known.space {
            Some(Some(space)) if self.state.dashes.is_empty() => {
                stroke_solid(self.scene, path, self.state.pen, space, ink)
            }
            _ => self.stroke(Ok(path), ink),
        }
    }

    fn stroke(&mut self, path: Result<Outline, Rect>, ink: Ink) -> bool {
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
            Ok(path) if dashes.is_empty() => stroke_solid(self.scene, path, *pen, space, ink),
            Err(rect)
                if dashes.is_empty()
                    && !matrix.has_skew()
                    && self.scene.frame(
                        map_rect(matrix, rect),
                        0.,
                        &stroke(*pen, &[]),
                        space,
                        ink,
                    ) =>
            {
                true
            }
            path => STORE.with_borrow_mut(|Store { path: kept, .. }| {
                kept.clear();
                match (path, matrix.invert()) {
                    (Ok(path), Some(inverse)) => prune(path.transformed(&inverse), kept),
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
                self.state.fill.shade()
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
    #[inline]
    fn find(&mut self, image: u32, variant: u32) -> Option<(&Found, &mut Scene)> {
        let (which, known) = ([variant, self.scene.generation()], self.known.image(image)?);
        if known.found.as_ref().is_none_or(|it| it.0 != which)
            && known.pixels.is_none_or(|it| !it.1)
        {
            known.found = None;
            known.found = Some((which, Self::keep(self.scene, image, variant)?));
        }
        Some((&known.found.as_ref()?.1, self.scene))
    }

    fn keep(scene: &mut Scene, image: u32, variant: u32) -> Option<Found> {
        let (canvas, key) = (get(image), (image as usize, variant));
        STORE.with_borrow_mut(|store| {
            let known = canvas
                .as_ref()
                .map(|it| it.borrow().version)
                .and_then(|it| store.find(key, it, scene));
            known.or_else(|| {
                let changed = canvas
                    .as_ref()
                    .filter(|_| variant == 0)
                    .map(|it| std::mem::take(&mut it.borrow_mut().changed));
                images::with_first_frame(image, |content, version| {
                    let Content::Pixels(pixmap) = content else {
                        return None;
                    };
                    store.find(key, version, scene).or_else(|| {
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
                            scene,
                        )
                    })
                })?
            })
        })
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
        let (opacity, is_smooth, how) = (
            (self.state.alpha.min(1.) * 255. + 0.5) as u8,
            self.state.is_smooth,
            self.how,
        );
        if let Some([dx, dy]) = shift {
            return self
                .find(image, 0)
                .map(|(it, scene)| {
                    scene.copy(
                        &it.source,
                        [part.left, part.top],
                        part.offset(dx, dy),
                        opacity,
                        how,
                    )
                })
                .is_some();
        }
        let (scale_x, scale_y) = placement.get_scale();
        let halvings = |scale: f32| {
            if scale < 0.5 && is_smooth && !is_borrowed {
                (1. / scale).log2().min(15.) as u32
            } else {
                0
            }
        };
        let Some((found, scene)) = self.find(image, halvings(scale_x) | halvings(scale_y) << 8)
        else {
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
        scene.image(
            &found.source,
            part,
            corners(from, &placement),
            opacity,
            is_smooth,
            how,
        )
    }

    #[inline]
    fn any_image(&mut self, image: u32, size: [f32; 2], [from, to]: [Rect; 2]) -> bool {
        match self.known.image(image).map(|it| it.pixels) {
            Some(Some((pixels, is_lent))) => {
                self.image(image, pixels, is_lent, size, [upright(from), upright(to)])
            }
            Some(None) => self.drawing(image, size, [upright(from), upright(to)]),
            None => false,
        }
    }

    /// An image without pixels gets those that it shows as, or almost twice as many in each direction.
    fn drawing(&mut self, image: u32, size: [f32; 2], [from, to]: [Rect; 2]) -> bool {
        const MAX_SIDE: f32 = 1024.;
        let Placed {
            from, placement, ..
        } = Placed::new(&self.state.matrix, size, size, from, to);
        let (scales, all) = (
            <[f32; 2]>::from(placement.get_scale()),
            map_rect(
                &placement,
                Rect {
                    x: 0.,
                    y: 0.,
                    width: size[0],
                    height: size[1],
                },
            ),
        );
        let fits = !placement.has_skew()
            && placement.sx.min(placement.sy) > 0.
            && [all.x, all.y, all.width, all.height]
                .iter()
                .all(|it| (it - it.round()).abs() < 1e-3);
        let pixels = [0, 1].map(|axis| {
            if fits {
                (size[axis] * scales[axis]).round()
            } else {
                (size[axis] * ((scales[axis].log2() * 4.).floor() / 4. + 1.).exp2()).ceil()
            }
        });
        if !pixels.iter().all(|it| (1. ..=MAX_SIDE).contains(it)) || self.state.is_wide {
            return false;
        }
        let variant = 1 << 31 | (pixels[0] as u32) << 12 | pixels[1] as u32;
        let (which, Some(known)) = ([variant, self.scene.generation()], self.known.image(image))
        else {
            return false;
        };
        if known.found.as_ref().is_none_or(|it| it.0 != which) {
            let found = images::with_first_frame(image, |content, version| {
                let Content::Svg(drawing) = content else {
                    return None;
                };
                STORE
                    .with_borrow_mut(|it| it.find((image as usize, variant), version, self.scene))
                    .or_else(|| {
                        let known = STORE.with_borrow(|it| {
                            it.images
                                .get(&(image as usize, variant))
                                .filter(|it| it.version == version)?
                                .pixels
                                .clone()
                        });
                        let drawn = known.or_else(|| {
                            let mut layer =
                                Layer::new(IntRect::new(0, 0, pixels[0] as i32, pixels[1] as i32))?;
                            drawing.draw(
                                &mut layer,
                                Rect {
                                    x: 0.,
                                    y: 0.,
                                    width: pixels[0],
                                    height: pixels[1],
                                },
                                &Transform::identity(),
                                &Frame::new(1., false),
                            );
                            Some(Arc::new(layer.pixmap))
                        })?;
                        STORE.with_borrow_mut(|it| {
                            it.keep(
                                (image as usize, variant),
                                version,
                                &drawn,
                                None,
                                Some(&drawn),
                                self.scene,
                            )
                        })
                    })
            });
            known.found = found.flatten().map(|it| (which, it));
        }
        let Some((_, found)) = &known.found else {
            return false;
        };
        let [x, y] = [0, 1].map(|axis| pixels[axis] / size[axis]);
        let part = intersect(
            Rect {
                x: from.x * x,
                y: from.y * y,
                width: from.width * x,
                height: from.height * y,
            },
            Rect {
                x: 0.,
                y: 0.,
                width: pixels[0],
                height: pixels[1],
            },
        );
        self.scene.image(
            &found.source,
            part,
            corners(from, &placement),
            (self.state.alpha.min(1.) * 255.).round() as u8,
            true,
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
            put_off: None,
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
            && let Ok(target) = Target::new(rect.right, rect.bottom, self.state.is_wide)
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
    pub(super) fn select(&mut self, id: u32, next: usize, is_late: bool) {
        if self.accelerated.is_none()
            && (std::mem::take(&mut self.load.rests) || vector::usage() == Use::Always)
        {
            self.speed_up();
        }
        match &mut self.accelerated {
            Some(gpu) => {
                self.known.lateness = if is_late || vector::usage() == Use::Always {
                    8
                } else {
                    self.known.lateness.saturating_sub(1)
                };
                (gpu.log.id, gpu.log.next, self.known.tries) =
                    (id, next, self.known.lateness.min(4));
            }
            None => self.load.selected_at = Some(Instant::now()),
        }
    }

    /// Other canvases may change before that command runs, if there is one.
    pub(super) fn pause(&mut self, list: &Rc<Owned>, next: usize) {
        self.known.images.clear();
        let Some(gpu) = &mut self.accelerated else {
            let (since, now) = (self.load.selected_at.take(), Instant::now());
            (self.load.spent, self.load.selected_at) = (
                self.load.spent + since.map_or(Duration::ZERO, |it| now - it),
                (next < list.commands.len()).then_some(now),
            );
            if self.load.spent > VERY_LONG
                && list.is_partial
                && next == list.commands.len()
                && self.load.interruptions + self.load.changes == 0
            {
                self.load.rests = !self.is_read_often && vector::is_ready();
            }
            return;
        };
        gpu.log.add(list, next);
        let borrows = std::mem::take(&mut gpu.borrows);
        if gpu.log.is_too_long() {
            self.settle();
        } else if borrows {
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
            for (place, command) in list.commands(range) {
                match command {
                    Command::Create { .. }
                    | Command::Snapshot(_)
                    | Command::Release(_)
                    | Command::DropFontScope(_) => {}
                    Command::Image { image, .. }
                        if image != log.id
                            && log.images.get(&image).copied() != version_of(image) => {}
                    command => _ = self.run(log.id, command, &list, place, &mut batch),
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
                (
                    spent > LONG && interruptions < 2,
                    if spent > LONG * 4 { 2 } else { 1 },
                    4 << changes.min(10),
                )
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
        if wants_change && self.accelerated.is_none() && !self.is_read_often {
            // It takes time to start.
            vector::is_ready();
        }
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
        place: Range<usize>,
    ) -> bool {
        let Some(gpu) = &mut self.accelerated else {
            return false;
        };
        if gpu.scene.is_full() {
            gpu.log.add(list, place.start);
            self.submit(IntRect::default());
        }
        self.describe(id, command, list, place.start) || self.interrupt(list, place)
    }

    /// After a command that draws, with those that need nothing special. Returns where the first other one is.
    pub(super) fn carry_on(&mut self, list: &Owned, start: usize) -> usize {
        let (Some(gpu), Some(layer), state, known) = (
            &mut self.accelerated,
            &self.layer,
            &mut self.state,
            &mut self.known,
        ) else {
            return start;
        };
        let (scene, mut rest, all) = (
            &mut gpu.scene,
            &list.commands[start..],
            layer.rect.to_rect(),
        );
        let (true, Some(Some(how))) = (
            known.generation == scene.generation()
                && known.has_clip
                && !state.has_effects()
                && !scene.clip().is_empty(),
            known.how,
        ) else {
            return start;
        };
        if known.tries > 0 {
            let colors = [&state.fill, &state.stroke].map(|it| {
                if let Style::Color(it) = it {
                    Some(*it)
                } else {
                    None
                }
            });
            let mut plain = Plain {
                colors,
                alpha: state.alpha,
                mode: state.mode,
                how,
                pen: state.pen,
                has_dashes: !state.dashes.is_empty(),
                matrix: state.matrix,
            };
            let next = plain.share(scene, list, start);
            (rest, known.tries) = (
                &list.commands[next..],
                known.tries - u32::from(next == start),
            );
            [&mut state.fill, &mut state.stroke]
                .into_iter()
                .zip(plain.colors)
                .for_each(|(style, color)| {
                    color.into_iter().for_each(|it| *style = Style::Color(it))
                });
            if !plain.has_dashes {
                state.dashes.clear();
            }
            (
                state.alpha,
                state.pen,
                state.matrix,
                known.inks,
                known.space,
            ) = (plain.alpha, plain.pen, plain.matrix, [None; 2], None);
        }
        loop {
            let left = rest.len();
            let painter = &mut Painter {
                state,
                known,
                scene,
                how,
            };
            let is_done = match Command::read(&mut rest) {
                Some(Command::FillColor(color)) => {
                    state.fill = Style::Color(color);
                    continue;
                }
                Some(Command::StrokeColor(color)) => {
                    state.stroke = Style::Color(color);
                    continue;
                }
                Some(Command::LineWidth(width)) => {
                    state.pen.width = width;
                    continue;
                }
                Some(Command::Transform(to)) => {
                    (state.matrix, known.inks, known.space) = (matrix(to), [None; 2], None);
                    continue;
                }
                _ if painter.scene.is_full() => false,
                Some(Command::Fill { verbs, is_even_odd }) => painter.ink(false).is_ok_and(|ink| {
                    fill(
                        painter.scene,
                        list.outline(verbs),
                        fill_rule(is_even_odd),
                        ink,
                    )
                }),
                Some(Command::Stroke { verbs }) => painter
                    .ink(true)
                    .is_ok_and(|ink| painter.stroke_path(list.outline(verbs), ink)),
                Some(Command::FillRect(rect)) if !painter.state.matrix.has_skew() => {
                    let device = map_rect(&painter.state.matrix, upright(rect));
                    (device.width < all.width || device.height < all.height)
                        && painter
                            .ink(false)
                            .is_ok_and(|ink| upright_rect(painter.scene, device, ink))
                }
                Some(Command::Image {
                    image,
                    size,
                    from,
                    to,
                }) => image != gpu.log.id && painter.any_image(image, size, [from, to]),
                Some(Command::Text {
                    text,
                    style,
                    at,
                    alignment,
                    max_width,
                    strokes: false,
                }) => painter.ink(false).is_ok_and(|ink| {
                    let (line, matrix) = place_text(
                        &list.text[text.range()],
                        &style,
                        &painter.state.matrix,
                        at,
                        alignment,
                        max_width,
                    );
                    painter.text(&line, &matrix, ink)
                }),
                _ => false,
            };
            if !is_done {
                return list.commands.len() - left;
            }
        }
    }

    #[cold]
    fn interrupt(&mut self, list: &Rc<Owned>, place: Range<usize>) -> bool {
        self.accelerated
            .iter_mut()
            .for_each(|it| it.log.add(list, place.start));
        self.settle();
        self.load.interruptions += 1;
        self.accelerated
            .iter_mut()
            .for_each(|it| (it.is_behind_layer, it.log.next) = (true, place.end));
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
                    Some(pixel_of(*color, state.alpha)).filter(|it| it[3] == 255)?,
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
            && state.clip.mask.is_none()
            && state.put_off.is_none())
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

    pub(super) fn note_use(&mut self, image: u32) {
        self.accelerated.iter_mut().for_each(|it| {
            it.log
                .images
                .extend(version_of(image).map(|it| (image, it)))
        });
    }

    fn look_up(
        &mut self,
        id: u32,
        image: u32,
        list: &Rc<Owned>,
        index: usize,
    ) -> Option<(Pixels, Option<Found>)> {
        self.note_use(image);
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
                    Some((([it.width(), it.height()], false), None))
                } else {
                    None
                }
            })?;
        };
        self.accelerated.as_mut()?.borrows = true;
        Some(((lent.size, true), Some(lent)))
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
                (self.state, self.clips) = (State::new(layer.rect, self.state.is_wide), Vec::new());
            }
            return true;
        }
        if let Some(gpu) = self.accelerated.as_mut().filter(|it| it.log.was_long) {
            gpu.log.add(list, index);
            self.settle();
        }
        if let Command::Image { image, .. } = command
            && (image == id || self.known.image(image).is_none())
        {
            self.known.images.resize_with(Known::IMAGES, || None);
            self.known.images[image as usize % Known::IMAGES] = None;
            let (pixels, lent) = self.look_up(id, image, list, index).unzip();
            self.known.images[image as usize % Known::IMAGES] = Some(Image {
                id: image,
                pixels,
                found: lent.flatten().map(|it| ([0; 2], it)),
            });
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
                known.masked,
            ) = ([None; 2], None, None, false, 0);
        }
        let Some(how) = *known.how.get_or_insert_with(|| Operator::of(state.mode)) else {
            return false;
        };
        if !known.has_clip {
            if !scene.set_clip(state.clip.rect, state.clip.mask.as_deref()) {
                return false;
            }
            if let Some(path) = state.put_off.as_ref().filter(|_| !scene.clip().is_empty()) {
                let filled = match command {
                    Command::FillRect(rect) => Some(corners(upright(rect), &state.matrix)),
                    Command::Fill { verbs, .. } => {
                        parallelogram(list.outline(verbs).verbs(&mut [Verb::Close; 5]))
                    }
                    _ => None,
                };
                if let Some(filled) = filled
                    && !how.clears_backdrop()
                    && !state.has_effects()
                    && let Some(path) = state.clip_within(filled)
                    && let painter = &mut (Painter {
                        state,
                        known,
                        scene,
                        how,
                    })
                    && let Ok(ink) = painter.ink(false)
                    && fill(painter.scene, path.outline(), path.rule, ink)
                {
                    return true;
                }
                if !path.apply(scene) {
                    return false;
                }
            }
            known.has_clip = true;
        }
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
        let ink = match command {
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
                return painter.any_image(image, size, [from, to])
                    || image != id && painter.apart(command, list);
            }
            _ => match painter.ink(strokes) {
                Ok(ink) => ink,
                Err(is_nothing) => return is_nothing || painter.apart(command, list),
            },
        };
        let is_done = match command {
            Command::Fill { verbs, is_even_odd } => fill(
                painter.scene,
                list.outline(verbs),
                fill_rule(is_even_odd),
                ink,
            ),
            Command::Stroke { verbs } => painter.stroke(Ok(list.outline(verbs)), ink),
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
