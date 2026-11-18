//! Paths as triangles, for a GPU: it flattens and strokes them (`vector/shader.h`), and a depth for each shape keeps that
//! from being blended with itself.

use std::f32::consts::{PI, TAU};
use std::rc::Rc;
use std::sync::LazyLock;
use std::sync::mpsc::{Receiver, channel};
use std::time::Duration;

use super::blend;
use super::gradient::{Geometry, Gradient, Spread};
use super::raster::{Clip, Coverage, IntRect, Layer, Paint, Pixel, scale};
use crate::abi::{GradientStop, Rect};
use crate::error::{Context as _, Result, ensure};
use crate::gfx::{Cap, Command, Fill, Join, Point, Stroke, Transform, Walk};
use crate::sync::Mutex;

#[cfg_attr(target_os = "macos", path = "vector/metal.rs")]
#[cfg_attr(not(target_os = "macos"), path = "vector/gl.rs")]
mod device;

#[cfg(target_os = "macos")]
pub use device::Picture;
pub use device::{MAX_AREA, Target, Texture};

#[derive(Clone, Copy, PartialEq)]
pub enum Use {
    Never,
    IfItPays,
    Always,
}

/// On this thread: only the one that has the windows uses it.
pub fn usage() -> Use {
    static USE: LazyLock<Use> =
        LazyLock::new(|| match std::env::var("BUN_DESKTOP_RENDERER").as_deref() {
            _ if crate::remote::guest::is_on() => Use::Never,
            Ok("software") => Use::Never,
            Ok("gpu") => Use::Always,
            _ => Use::IfItPays,
        });
    #[cfg(test)]
    if tests::IS_ON.get() {
        return Use::Always;
    }
    if crate::host::platform().is_ok() {
        *USE
    } else {
        Use::Never
    }
}

#[derive(Default)]
enum State {
    #[default]
    Off,
    /// Until it is disconnected.
    Starting(Option<Receiver<()>>),
    Started(Box<device::Started>),
    On,
    /// Until there are no more targets.
    Failed,
}

/// With how often it has failed, which it can for what another process has done.
static STATE: Mutex<(State, u32)> = Mutex::new((State::Off, 0));

/// Fails unless it draws what the CPU paints.
fn start(takes_software: bool) -> Result<device::Started> {
    device::start(takes_software)?;
    let difference = Sample::difference()?;
    ensure!(
        (..2.).contains(&difference),
        "its pixels are off by {difference}"
    );
    device::rest();
    device::hand_over().context("it is gone")
}

/// If not, it may be later.
pub fn is_ready() -> bool {
    const MAX_FAILURES: u32 = 3;
    let usage = usage();
    if usage == Use::Never {
        return false;
    }
    let mut state = STATE.lock();
    if matches!(*state, (State::Off, ..MAX_FAILURES)) {
        let (is_starting, receiver) = channel();
        state.0 = State::Starting(Some(receiver));
        drop(state);
        let start = move || {
            crate::host::thread::is_needed_for_frames();
            let result = crate::guard("error", None, || {
                let result = start(usage == Use::Always);
                result
                    .inspect_err(|error| {
                        crate::diagnostics::log!("canvases are not drawn by the GPU: {error:#}")
                    })
                    .ok()
            });
            if result.is_none() {
                device::stop();
            }
            let mut state = STATE.lock();
            *state = result.map_or((State::Off, MAX_FAILURES), |it| {
                (State::Started(Box::new(it)), state.1)
            });
            drop(is_starting);
        };
        match usage {
            Use::Always => start(),
            _ => drop(std::thread::Builder::new().name("GPU".into()).spawn(start)),
        }
        state = STATE.lock();
    }
    match std::mem::take(&mut state.0) {
        State::Started(started) => {
            device::take_over(*started);
            state.0 = State::On;
        }
        other => state.0 = other,
    }
    matches!(state.0, State::On)
}

/// What the driver has registered with `atexit` destroys what it needs for that.
pub fn finish_starting() {
    let receiver = if let State::Starting(it) = &mut STATE.lock().0 {
        it.take()
    } else {
        None
    };
    _ = receiver.map(|it| it.recv_timeout(Duration::from_secs(2)));
}

pub fn note_failure() {
    let mut state = STATE.lock();
    if matches!(state.0, State::On) {
        *state = (State::Failed, state.1 + 1);
    }
}

/// There are no targets.
pub fn rest() {
    let state = STATE.lock();
    match state.0 {
        State::On => device::rest(),
        State::Failed => {
            drop(state);
            stop();
        }
        _ => {}
    }
}

/// Likewise.
pub fn stop() {
    let mut state = STATE.lock();
    match std::mem::take(&mut state.0) {
        State::Started(started) => device::take_over(*started),
        State::On | State::Failed => {}
        other => return state.0 = other,
    }
    device::stop();
}

struct Sample;

impl Sample {
    /// On average, where there is something.
    fn difference() -> Result<f32> {
        let area = IntRect::new(0, 0, 96, 64);
        let (mut scene, mut layer, identity) = (
            Scene::new(area, false),
            Layer::new(area).context("there is no memory")?,
            Transform::identity(),
        );
        let point = Point::new;
        let star = [
            point(30., 2.),
            point(48., 58.),
            point(2., 22.),
            point(58., 22.),
            point(12., 58.),
        ];
        let star: Vec<_> = star
            .iter()
            .enumerate()
            .map(|(index, it)| {
                if index == 0 {
                    Command::MoveTo(*it)
                } else {
                    Command::LineTo(*it)
                }
            })
            .collect();
        let wave = [
            Command::MoveTo(point(50., 50.)),
            Command::CurveTo(point(60., -20.), point(70., 90.), point(88., 12.)),
            Command::LineTo(point(70., 8.)),
        ];
        let stops = [(0., 0xFF00_00FF), (0.5, 0x00FF_0080), (1., 0x0000_FFFF)]
            .map(|(offset, color)| GradientStop { offset, color });
        let gradient = Gradient::new(
            Geometry::Radial {
                from: [30., 30., 2.],
                to: [40., 35., 40.],
            },
            &stops,
            Spread::Pad,
            false,
        );
        let stroke = Stroke {
            cap: Cap::Round,
            join: Join::Round,
            ..Stroke::new(7.)
        };
        let (clip, below, color) = (Clip::new(area), [10, 20, 30, 128], [100, 0, 50, 128]);
        layer.pixels_mut().fill(below);
        let mut target = Target::new(area.right, area.bottom, false)?;
        target.write(layer.pixels())?;
        let (ink, space) = scene
            .gradient(&gradient, &identity, 1.)
            .zip(scene.space(&identity))
            .context("it cannot be described")?;
        scene.units.resize(1 << 17, 1 << 11 | BAR << 8 | COVER);
        scene.rect(IntRect::new(60, 50, 90, 60), Ink::solid([0, 90, 0, 255]));
        layer.fill_rect(
            Rect {
                x: 60.,
                y: 50.,
                width: 30.,
                height: 10.,
            },
            [0, 90, 0, 255],
            area,
        );
        scene.fill(star.iter().copied(), Fill::EvenOdd, ink);
        layer.fill_path(
            &star,
            Fill::EvenOdd,
            &identity,
            &clip,
            &Paint::Shader(&|x, y, row| gradient.shade(&identity, x, y, row)),
        );
        scene.stroke(wave.into_iter(), &stroke, space, Ink::solid(color));
        layer.fill_path(&wave, stroke, &identity, &clip, &Paint::Solid(color));
        let texture = Rc::new(Texture::new(area.right, area.bottom)?);
        texture.write(area, layer.pixels(), area.width())?;
        for (mode, source, left) in [
            (blend::Mode::Plus, Some(texture), 20),
            (blend::Mode::Multiply, None, -30),
        ] {
            let (copy, Some(how)) = (
                layer.copy(area).context("there is no memory")?,
                Operator::of(mode),
            ) else {
                continue;
            };
            let source = source.map_or_else(
                || scene.keep_pixels(copy.pixels(), area.width()),
                Source::Texture,
            );
            scene.copy(&source, [0, 0], area.offset(left, 9), 255, how);
            layer.draw_with_mode(
                &Layer {
                    rect: area.offset(left, 9),
                    ..copy
                },
                mode,
                &clip,
            );
        }
        target.draw(&mut scene)?;
        let mut drawn = vec![[0; 4]; layer.pixels().len()];
        target.read(area, &mut drawn)?;
        let total: u32 = drawn
            .as_flattened()
            .iter()
            .zip(layer.pixels().as_flattened())
            .map(|(a, b)| u32::from(a.abs_diff(*b)))
            .sum();
        Ok(total as f32 / layer.pixels().iter().filter(|it| **it != below).count() as f32 / 4.)
    }
}

macro_rules! numbers {
    ($($name:ident = $value:literal,)*) => {
        $(const $name: u32 = $value;)*
        const SHADER: &str = concat!($("#define ", stringify!($name), " ", $value, "u\n",)* include_str!("vector/shader.h"));
    };
}

numbers! {
    STRIP = 0,
    JOIN = 1,
    CAP = 2,
    RUN = 3,
    WEDGE = 4,
    BAR = 5,
    BOX = 6,
    RING = 7,

    MAY_FOLD = 128,
    BEYOND_FOLD = 64,

    SHARES_START = 32,
    SHARES_END = 64,
    IS_JOIN = 128,

    COVER = 1,
    ROUNDED = 2,
    FRAME = 4,

    SOURCE = 15,
    SOLID = 0,
    GRADIENT = 1,
    PATTERN = 2,
    BEFORE = 3,
    MASK = 4,
    PIXELS = 5,
    SMOOTH = 6,
    SHARP = 7,
    IN_TEXTURE = 8,
    OPERATOR = 112,
    OVER = 0,
    PLUS = 16,
    ERASE = 32,
    COPY = 48,
    KEEP = 64,
    SCREEN = 80,
    HAS_CLIP = 128,
    IS_LINE = 256,
    HAS_SQUARE_CAPS = 512,
    HAS_ROUND_JOIN = 1024,

    DESTINATION_OVER = 1,
    SOURCE_IN = 2,
    SOURCE_OUT = 3,
    SOURCE_ATOP = 4,
    DESTINATION_ATOP = 5,
    XOR = 6,
    MULTIPLY = 7,
    OVERLAY = 8,
    DARKEN = 9,
    LIGHTEN = 10,
    COLOR_DODGE = 11,
    COLOR_BURN = 12,
    HARD_LIGHT = 13,
    SOFT_LIGHT = 14,
    DIFFERENCE = 15,
    EXCLUSION = 16,
    HUE = 17,
    SATURATION = 18,
    COLOR = 19,
    LUMINOSITY = 20,
}

const SHADED_MASK: u32 = MASK | IN_TEXTURE;

/// In pixels.
const TOLERANCE: f32 = 0.2;
const FAR: f32 = 1e6;
const THICK: f32 = 2e4;
/// For the sines of a GPU.
const WIDE: f32 = 512.;

#[repr(u32)]
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Blend,
    Opaque,
    /// `Blend`, of what has one color up to its edges.
    Tint,
    Count,
    CoverNonZero,
    CoverOdd,
    /// Only changes the depth, where nothing was counted.
    BlockNonZero,
    BlockOdd,
}

#[repr(C)]
#[derive(Clone)]
struct Step {
    mode: Mode,
    /// What `blend` of the shader does, if it is needed.
    mixing: u32,
    /// One more than the index in `Scene::textures`, if it needs one.
    texture: u32,
    first: u32,
    end: u32,
    clip: IntRect,
}

/// The flags for the shader, and above them `Step::mixing` and `CLEARS_BACKDROP`.
#[derive(Clone, Copy, PartialEq)]
pub struct Operator(u32);

const CLEARS_BACKDROP: u32 = 1 << 16;
const HAS_NO_HOLES: u32 = 1 << 17;

impl Operator {
    pub const OVER: Operator = Operator(OVER);
    pub const ERASE: Operator = Operator(ERASE);
    /// Only where the source is.
    pub const REPLACE: Operator = Operator(COPY);

    pub fn of(mode: blend::Mode) -> Option<Operator> {
        use blend::Mode::*;
        let (flags, mixing) = match mode {
            Clear | Destination => return None,
            SourceOver => (OVER, 0),
            Plus => (PLUS, 0),
            DestinationOut => (ERASE, 0),
            Source => (COPY, 0),
            DestinationIn => (KEEP, 0),
            Screen => (SCREEN, 0),
            DestinationOver => (0, DESTINATION_OVER),
            SourceIn => (0, SOURCE_IN),
            SourceOut => (0, SOURCE_OUT),
            SourceAtop => (0, SOURCE_ATOP),
            DestinationAtop => (0, DESTINATION_ATOP),
            Xor => (0, XOR),
            Multiply => (0, MULTIPLY),
            Overlay => (0, OVERLAY),
            Darken => (0, DARKEN),
            Lighten => (0, LIGHTEN),
            ColorDodge => (0, COLOR_DODGE),
            ColorBurn => (0, COLOR_BURN),
            HardLight => (0, HARD_LIGHT),
            SoftLight => (0, SOFT_LIGHT),
            Difference => (0, DIFFERENCE),
            Exclusion => (0, EXCLUSION),
            Hue => (0, HUE),
            Saturation => (0, SATURATION),
            Color => (0, COLOR),
            Luminosity => (0, LUMINOSITY),
        };
        (mixing == 0 || device::reads_backdrop()).then_some(Operator(
            flags
                | mixing << 8
                | if mode.clears_backdrop() {
                    CLEARS_BACKDROP
                } else {
                    0
                },
        ))
    }

    pub fn clears_backdrop(self) -> bool {
        self.0 & CLEARS_BACKDROP != 0
    }
}

#[derive(Clone, Copy)]
pub struct Ink {
    /// Or where the gradient or the pattern is.
    color: u32,
    /// The source, the operator and `HAS_NO_HOLES`.
    how: u32,
    texture: u32,
}

impl Ink {
    #[inline]
    pub fn solid(color: Pixel) -> Ink {
        Ink {
            color: u32::from_le_bytes(color),
            how: if color[3] == 255 { HAS_NO_HOLES } else { SOLID },
            texture: 0,
        }
    }

    /// Instead of source-over.
    #[inline]
    pub fn with(self, how: Operator) -> Ink {
        Ink {
            how: self.how | how.0,
            ..self
        }
    }

    fn is_opaque(self) -> bool {
        self.how & !SOURCE == HAS_NO_HOLES
    }

    fn source(self) -> u32 {
        self.how & SOURCE
    }

    fn flags(self) -> u32 {
        self.how & (SOURCE | OPERATOR)
    }

    fn mixing(self) -> u32 {
        self.how >> 8 & 255
    }

    fn clears_backdrop(self) -> bool {
        self.how & CLEARS_BACKDROP != 0
    }

    /// Of one color.
    fn faded(self, by: f32) -> Ink {
        Ink {
            color: u32::from_le_bytes(scale(self.color.to_le_bytes(), (by * 255. + 0.5) as u8)),
            how: self.how & !HAS_NO_HOLES,
            ..self
        }
    }
}

/// Where pixels are.
#[derive(Clone)]
pub enum Source {
    /// With the length of a row.
    Scene(u32, u32),
    Texture(Rc<Texture>),
}

/// What the width of a stroke is in.
#[derive(Clone, Copy)]
pub struct Space {
    /// Where the matrix is, or 0 if it does not distort.
    words: u32,
    /// At most.
    scale: f32,
}

impl Space {
    /// If circles stay circles.
    #[inline]
    pub fn even(&Transform { sx, ky, kx, sy, .. }: &Transform) -> Option<Space> {
        let (across, down) = (sx * sx + ky * ky, kx * kx + sy * sy);
        (across > 1e-10
            && (across - down).abs() <= across * 1e-5
            && (sx * kx + ky * sy).abs() <= across * 1e-5)
            .then(|| Space {
                words: 0,
                scale: across.sqrt(),
            })
    }
}

struct Pen {
    radius: f32,
    space: u32,
    cap: Cap,
    is_round: bool,
    least_cosine: f32,
    /// The square of the tangent of half of the angle up to which a join looks like a miter.
    sharpest: f32,
    /// How many units half a circle takes.
    turns: f32,
    /// In pixels, at most.
    thickness: f32,
}

pub struct Scene {
    area: IntRect,
    stays_opaque: bool,
    words: Vec<[u32; 4]>,
    /// One for each four corners: where its words are, what it is, and which one of those.
    units: Vec<u32>,
    /// Likewise, of what hides what is below it with one color and with a gradient. It is drawn first.
    opaque: [Vec<u32>; 2],
    opaque_clip: IntRect,
    steps: Vec<Step>,
    textures: Vec<Rc<Texture>>,
    pixels_of_textures: i64,
    /// How many pixels the units cover, at most.
    covered: f32,
    /// So much that it pays to leave out what is hidden.
    was_crowded: bool,
    is_part: bool,
    needs_samples: bool,
    /// What there is below it all, if not what there was before.
    backdrop: Option<Pixel>,
    clip: IntRect,
    /// Where the pixel at the origin would be, and the length of a row, if any.
    mask: [u32; 2],
    /// All shapes of the last step say what they are clipped to.
    is_mixed: bool,
    /// Where the depths are of what blocks the shapes that are added now.
    blockers: Vec<u32>,
    /// Of what refers to words.
    generation: u32,
    /// The corners of those that have more than a color take three times the room.
    units_per_pass: usize,
    points: Vec<Point>,
    corners: Vec<Point>,
    path: Vec<Command>,
}

/// What another thread describes.
pub struct Part(Scene);

// SAFETY: it gets no textures.
unsafe impl Send for Part {}

impl Part {
    /// For shapes of one color.
    pub fn scene(&mut self) -> &mut Scene {
        &mut self.0
    }
}

pub struct Mark {
    lengths: [usize; 3],
    last: Step,
    is_mixed: bool,
}

fn next_generation() -> u32 {
    thread_local! {
        static LAST: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    }
    LAST.set(LAST.get().wrapping_add(1).max(1));
    LAST.get()
}

fn word(a: Point, b: Point) -> [u32; 4] {
    [a.x.to_bits(), a.y.to_bits(), b.x.to_bits(), b.y.to_bits()]
}

/// The depth and the flags as the words from `patch` on have them, so that they can be moved.
#[inline(always)]
fn relative(rest: u32, patch: u32) -> u32 {
    rest.wrapping_sub(patch << 11)
}

fn is_near(point: Point) -> bool {
    point.x.abs() < FAR && point.y.abs() < FAR
}

fn square(it: Point) -> f32 {
    it.dot(it)
}

fn halves([a, b, c, d]: [Point; 4], t: f32) -> [[Point; 4]; 2] {
    let (ab, bc, cd) = (a.lerp(b, t), b.lerp(c, t), c.lerp(d, t));
    let (abc, bcd) = (ab.lerp(bc, t), bc.lerp(cd, t));
    let middle = abc.lerp(bcd, t);
    [[a, ab, abc, middle], [middle, bcd, cd, d]]
}

/// No less than its length.
fn steps(it: Point) -> f32 {
    it.x.abs() + it.y.abs()
}

/// The square of the number of lines that it takes.
fn curviness([a, b, c, d]: [Point; 4]) -> f32 {
    square(a - b * 2. + c).max(square(b - c * 2. + d)).sqrt() * (0.75 / TOLERANCE)
}

/// As cubic curves, and whether it is a line. `Err` ends a contour, closing it or not.
#[inline(always)]
fn segments(path: impl Walk, mut take: impl FnMut(Result<([Point; 4], bool), bool>)) {
    let (mut at, mut start) = (Point::ZERO, Point::ZERO);
    path.walk(|command| {
        let (segment, is_line) = match command {
            Command::MoveTo(to) => {
                (at, start) = (to, to);
                return take(Err(false));
            }
            Command::Close => {
                if at != start {
                    take(Ok(([at, at, start, start], true)));
                }
                at = start;
                return take(Err(true));
            }
            Command::LineTo(to) => ([at, at, to, to], true),
            Command::QuadTo(control, to) => (
                [at, at.lerp(control, 2. / 3.), to.lerp(control, 2. / 3.), to],
                false,
            ),
            Command::CurveTo(first, second, to) => ([at, first, second, to], false),
        };
        at = segment[3];
        take(Ok((segment, is_line)));
    });
    take(Err(false));
}

impl Pen {
    fn has_runs(&self) -> bool {
        !self.is_round || self.turns <= 4.
    }
}

const LONGEST_RUN: usize = 32;

struct Stroker<'a> {
    scene: &'a mut Scene,
    pen: &'a Pen,
    head: [u32; 3],
    window: [Point; 2],
    /// Of the contour, if there is one.
    start: Option<Point>,
    /// Where its words are, and how many lines it has, if the last one came last.
    run: (u32, u32),
    /// Where the last line of it starts.
    before: Point,
    first_direction: Point,
    at: Point,
    direction: Point,
}

impl Stroker<'_> {
    #[inline]
    fn turns_to(&self, after: Point, is_round: bool) -> u32 {
        if !is_round || self.pen.turns == 1. {
            return 1;
        }
        let cosine = self.direction.dot(after) / (square(self.direction) * square(after)).sqrt();
        (if self.pen.space == 0 {
            (self.pen.turns * ((1. - cosine).max(0.) / 2.).sqrt())
                .ceil()
                .clamp(1., self.pen.turns)
        } else {
            self.pen.turns
        }) as u32
    }

    #[inline]
    fn patch(
        &mut self,
        [_, b, c, d]: [Point; 4],
        flags: u32,
        count: u32,
        [first, last]: [Point; 2],
        is_round: bool,
    ) -> u32 {
        let (patch, [radius, color, rest]) = (self.scene.words.len() as u32, self.head);
        let style = Point::new(self.pen.least_cosine, self.pen.turns);
        let flags = flags | if is_round { HAS_ROUND_JOIN } else { 0 };
        self.scene.words.extend([
            word(self.at, d),
            [
                radius,
                color,
                relative(rest | flags, patch),
                self.pen.space << 8 | count.max(1),
            ],
            word(b, c),
            word(self.direction, style),
        ]);
        match self.start {
            Some(_) => self
                .scene
                .add_units(patch, JOIN, self.turns_to(first, is_round)),
            None => (self.start, self.first_direction) = (Some(self.at), first),
        }
        self.scene.add_units(patch, STRIP, count);
        (self.at, self.direction, self.run.1) = (if count == 0 { self.at } else { d }, last, 0);
        patch
    }

    /// Whether the two lines may end where their edges meet.
    #[inline]
    fn meets(&self, after: Point) -> bool {
        let (before, lengths) = (self.direction, [square(self.direction), square(after)]);
        let (turn, straight) = (
            before.cross(after) * before.cross(after),
            (lengths[0] * lengths[1]).sqrt() + before.dot(after),
        );
        turn <= self.pen.sharpest * straight * straight
            && turn * self.pen.thickness * self.pen.thickness * 4.
                <= lengths[0].min(lengths[1]) * straight * straight
            && straight > 0.
    }

    #[inline]
    fn line(&mut self, to: Point, is_round: bool) {
        let (along, (mut run, mut count)) = (to - self.at, self.run);
        if along == Point::ZERO {
            return;
        }
        if is_round != self.pen.is_round || !self.pen.has_runs() {
            self.patch([to; 4], IS_LINE, 1, [along; 2], is_round);
            return;
        }
        let meets = count > 0 && self.meets(along);
        let (turns, Scene { words, units, .. }) = (
            if meets {
                0
            } else {
                self.turns_to(along, is_round)
            },
            &mut *self.scene,
        );
        match words.last_mut() {
            Some(last) if count % 2 == 0 && count > 0 => {
                (last[2], last[3]) = (to.x.to_bits(), to.y.to_bits())
            }
            _ if count > 0 => words.push(word(to, to)),
            _ => {}
        }
        if count % LONGEST_RUN as u32 == 0 {
            let [radius, color, rest] = self.head;
            let style = word(
                Point::new(self.pen.least_cosine, self.pen.turns),
                if count > 0 {
                    self.before
                } else {
                    self.at - self.direction
                },
            );
            (run, count) = (words.len() as u32, 0);
            words.extend([
                [
                    radius,
                    color,
                    relative(rest, run) | if is_round { HAS_ROUND_JOIN } else { 0 },
                    self.pen.space << 8,
                ],
                style,
                word(self.at, to),
            ]);
        }
        let unit = run << 11 | RUN << 8 | count;
        match units.last_mut() {
            Some(last) if meets => *last |= SHARES_END,
            _ if self.start.is_some() => {
                units.extend((0..turns).map(|it| unit | IS_JOIN | it << 5))
            }
            _ => (self.start, self.first_direction) = (Some(self.at), along),
        }
        units.push(unit | if meets { SHARES_START } else { 0 });
        (self.before, self.at, self.direction, self.run) = (self.at, to, along, (run, count + 1));
    }

    /// What `line` does for each of them, at the start of a contour. No point is the same as the one before it.
    fn lines(&mut self, points: &[Point]) {
        let (
            &Pen {
                sharpest,
                thickness,
                turns,
                is_round,
                ..
            },
            [radius, color, rest],
            &[first, second, ..],
        ) = (self.pen, self.head, points)
        else {
            return;
        };
        let (widest, is_plain) = (thickness * thickness * 4., self.pen.space == 0);
        let limits = [1., 2., 3.].map(|it| {
            if is_round && it < turns {
                if is_plain {
                    2. * (it / turns) * (it / turns)
                } else {
                    -1.
                }
            } else {
                f32::MAX
            }
        });
        let joins = |[a, b, c]: &[Point; 3]| {
            let (before, after) = (*b - *a, *c - *b);
            let (lengths, along, turn) = (
                [square(before), square(after)],
                before.dot(after),
                before.cross(after) * before.cross(after),
            );
            let both = (lengths[0] * lengths[1]).sqrt();
            let straight = (both + along) * (both + along);
            let meets = (turn <= sharpest * straight)
                & (turn * widest <= lengths[0].min(lengths[1]) * straight)
                & (both + along > 0.);
            if meets {
                0
            } else {
                1 + limits
                    .iter()
                    .map(|it| u32::from(both - along > it * both))
                    .sum::<u32>()
            }
        };
        let (Scene { words, units, .. }, style, mut at_start) = (
            &mut *self.scene,
            Point::new(self.pen.least_cosine, turns),
            None,
        );
        for start in (0..points.len() - 1).step_by(LONGEST_RUN) {
            let (run, part) = (
                words.len() as u32,
                &points[start..points.len().min(start + LONGEST_RUN + 2)],
            );
            words.extend([
                [
                    radius,
                    color,
                    relative(rest, run) | if is_round { HAS_ROUND_JOIN } else { 0 },
                    self.pen.space << 8,
                ],
                word(style, points[start.saturating_sub(1)]),
            ]);
            let (pairs, last) = part.as_chunks();
            words.extend(
                pairs
                    .iter()
                    .map(|[a, b]| word(*a, *b))
                    .chain(last.iter().map(|it| word(*it, *it))),
            );
            let (mut at_ends, mut added, mut count) =
                ([1; LONGEST_RUN], [0; LONGEST_RUN * 5 + 4], 0);
            at_ends
                .iter_mut()
                .zip(part.array_windows())
                .for_each(|(to, it)| *to = joins(it));
            for (unit, at_end) in
                (run << 11 | RUN << 8..).zip(&at_ends[..LONGEST_RUN.min(part.len() - 1)])
            {
                added[count..count + 4]
                    .copy_from_slice(&[0, 1, 2, 3].map(|it| unit | IS_JOIN | it << 5));
                count += at_start.unwrap_or(0) as usize;
                added[count] = unit
                    | if at_start == Some(0) { SHARES_START } else { 0 }
                    | if *at_end == 0 { SHARES_END } else { 0 };
                (count, at_start) = (count + 1, Some(*at_end));
            }
            units.extend_from_slice(&added[..count]);
        }
        let [before, at] = [points[points.len() - 2], points[points.len() - 1]];
        (
            self.start,
            self.first_direction,
            self.at,
            self.direction,
            self.run.1,
        ) = (Some(first), second - first, at, at - before, 0);
    }

    fn curve(&mut self, [_, b, c, d]: [Point; 4], is_round: bool, depth: u32) {
        const MANY: f32 = 32. * 32.;
        let (a, [low, high]) = (self.at, self.window);
        let (curve, chord, [first, second, third]) = ([a, b, c, d], d - a, [b - a, c - b, d - c]);
        let pick = |all: [Point; 3]| all.into_iter().find(|it| *it != Point::ZERO);
        let (Some(start), Some(end)) = (pick([first, c - a, chord]), pick([third, d - b, chord]))
        else {
            return;
        };
        // What the direction is between.
        let [x, y, z] = match (first == Point::ZERO, third == Point::ZERO) {
            (true, true) => return self.line(d, is_round),
            (true, false) => [second * 2., second + third * 0.5, third],
            (false, true) => [first, first * 0.5 + second, second * 2.],
            (false, false) => [first, second, third],
        };
        let least = x.dot(chord).min(y.dot(chord)).min(z.dot(chord));
        if least > 0. {
            let slowness = square(chord) / (least * least);
            let bend = x
                .cross(y)
                .abs()
                .max(x.cross(z).abs() * 0.5)
                .max(y.cross(z).abs());
            let turning = (square(y - x).max(square(z - y)) * slowness)
                .min(bend * bend * slowness * slowness)
                * 4.;
            let count = curviness(curve) + turning * self.pen.thickness * (1. / (8. * TOLERANCE));
            if count <= MANY {
                let count = (count.sqrt().ceil() as u32).max(1);
                let patch = self.patch(curve, 0, count, [start, end], is_round);
                if turning * slowness * self.pen.thickness * self.pen.thickness > 9.
                    || first == Point::ZERO
                    || third == Point::ZERO
                {
                    self.scene
                        .units
                        .iter_mut()
                        .rev()
                        .take(count as usize)
                        .for_each(|it| *it |= MAY_FOLD);
                    let first = patch << 11 | STRIP << 8 | MAY_FOLD | BEYOND_FOLD;
                    self.scene.units.extend(first..first + count);
                }
                return;
            }
        }
        if curve.iter().all(|it| it.x < low.x)
            || curve.iter().all(|it| it.x > high.x)
            || curve.iter().all(|it| it.y < low.y)
            || curve.iter().all(|it| it.y > high.y)
        {
            self.patch(curve, 0, 1, [start, end], is_round);
            return;
        }
        let farthest = [b, c, d].into_iter().fold(Point::ZERO, |far, it| {
            if square(it - a) > square(far) {
                it - a
            } else {
                far
            }
        });
        if square(farthest) < 0.003 || depth == 0 {
            self.patch([a + start; 4], IS_LINE, 0, [start; 2], is_round);
            self.patch([a + end; 4], IS_LINE, 0, [end; 2], true);
            return;
        }
        if curve
            .iter()
            .all(|it| farthest.cross(*it - a).abs() <= square(farthest) * 0.003)
        {
            let turns = crate::gfx::roots(
                farthest.dot(chord + (b - c) * 3.),
                farthest.dot(second - first) * 2.,
                farthest.dot(first),
            );
            let mut is_round = is_round;
            for to in turns.map(|it| halves(curve, it)[1][0]).chain([d]) {
                self.line(to, std::mem::replace(&mut is_round, true));
            }
            return;
        }
        let [before, after] = halves(curve, 0.5);
        self.curve(before, is_round, depth - 1);
        self.curve(after, true, depth - 1);
    }

    fn end(&mut self, is_closed: bool) {
        let Some(start) = self.start else { return };
        if is_closed {
            self.patch(
                [start + self.first_direction; 4],
                IS_LINE,
                0,
                [self.first_direction; 2],
                self.pen.is_round,
            );
        } else if self.pen.cap != Cap::Butt {
            let (count, [radius, color, rest]) = (
                if self.pen.cap == Cap::Round {
                    self.pen.turns as u32
                } else {
                    1
                },
                self.head,
            );
            for (at, inward) in [(start, self.first_direction), (self.at, -self.direction)] {
                let patch = self.scene.words.len() as u32;
                self.scene.words.extend([
                    word(at, at + inward),
                    [
                        radius,
                        color,
                        relative(rest | IS_LINE, patch),
                        self.pen.space << 8 | 1,
                    ],
                    [0; 4],
                    [0, 0, 0, self.pen.turns.to_bits()],
                ]);
                self.scene.add_units(patch, CAP, count);
            }
        }
        (self.start, self.run.1) = (None, 0);
    }
}

/// Of a circle, in radians.
#[derive(Clone, Copy)]
pub struct Arc {
    pub center: Point,
    pub radius: f32,
    pub from: f32,
    pub sweep: f32,
}

/// Of the triangles between a point and the segments of a path.
struct Fan {
    turns: [f32; 2],
    quadrant: u32,
    quadrants: u32,
}

impl Fan {
    #[inline(always)]
    fn add(&mut self, center: Point, points: [Point; 4], is_line: bool, rule: Fill) {
        let [a, b, c, d] = points.map(|it| it - center);
        let all = [
            a.cross(d),
            a.cross(b),
            a.cross(c),
            b.cross(c),
            b.cross(d),
            c.cross(d),
        ];
        for turn in &all[..if is_line { 1 } else { 6 }] {
            self.turns = [self.turns[0].min(*turn), self.turns[1].max(*turn)];
        }
        for point in [a, b, c, d]
            .into_iter()
            .filter(|it| rule == Fill::EvenOdd && *it != Point::ZERO)
        {
            let next = 4u32 | u32::from(point.x > 0.) | u32::from(point.y > 0.) << 1;
            self.quadrants += if self.quadrant == 0 {
                0
            } else {
                (self.quadrant ^ next).count_ones()
            };
            self.quadrant = next;
        }
    }

    /// Only as far as it turns one way.
    #[inline]
    fn of(center: Point, points: &[Point], rule: Fill) -> Fan {
        let mut fan = Fan {
            turns: [0.; 2],
            quadrant: 0,
            quadrants: 0,
        };
        for &[a, b] in points.array_windows() {
            fan.add(center, [a, a, b, b], true, rule);
            if !fan.turns_one_way() {
                break;
            }
        }
        fan
    }

    #[inline]
    fn turns_one_way(&self) -> bool {
        const ROUNDING: f32 = 0.01;
        self.turns[0] >= -ROUNDING || self.turns[1] <= ROUNDING
    }
}

fn halves_of(low: i32, high: i32) -> u32 {
    low as u32 & 0xFFFF | (high as u32) << 16
}

impl Scene {
    pub fn new(area: IntRect, stays_opaque: bool) -> Scene {
        let (words, units, opaque, steps, textures) = Default::default();
        let mut scene = Scene {
            area,
            stays_opaque,
            words,
            units,
            opaque,
            opaque_clip: area,
            steps,
            textures,
            pixels_of_textures: 0,
            covered: 0.,
            was_crowded: false,
            is_part: false,
            needs_samples: false,
            backdrop: None,
            clip: area,
            mask: [0; 2],
            is_mixed: false,
            blockers: Vec::new(),
            generation: 0,
            units_per_pass: 1 << 20 >> (STATE.lock().1 * 2),
            points: Vec::new(),
            corners: Vec::new(),
            path: Vec::new(),
        };
        scene.start_over(None);
        scene
    }

    /// Without a clip.
    pub fn start_over(&mut self, backdrop: Option<Pixel>) {
        if self.covered > 0. {
            self.was_crowded = self.covered > Self::COVERED_PER_PASS / 50.;
        }
        self.words.clear();
        self.units.clear();
        self.opaque.iter_mut().for_each(Vec::clear);
        self.steps.clear();
        self.textures.clear();
        self.blockers.clear();
        (self.pixels_of_textures, self.covered) = (0, 0.);
        (
            self.backdrop,
            self.needs_samples,
            self.clip,
            self.mask,
            self.is_mixed,
            self.generation,
        ) = (backdrop, false, self.area, [0; 2], false, next_generation());
        self.words.extend([
            [0; 4],
            [0, halves_of(self.area.right, self.area.bottom), 0, 0],
        ]);
        self.units.push(1 << 11 | BOX << 8 | BEFORE | COPY);
        self.steps.push(Step {
            mode: Mode::Blend,
            mixing: 0,
            texture: 0,
            first: 0,
            end: 1,
            clip: self.area,
        });
    }

    /// They go on from here. False if they cannot.
    pub fn split(&mut self, parts: &mut Vec<Part>, count: usize) -> bool {
        if !self.blockers.is_empty() {
            return false;
        }
        if device::CUTS_BETWEEN_PIXELS && self.opaque.iter().all(Vec::is_empty) {
            self.opaque_clip = self.clip;
        }
        parts.resize_with(count.max(parts.len()), || {
            Part(Scene::new(self.area, self.stays_opaque))
        });
        for Part(part) in &mut parts[..count] {
            part.start_over(None);
            part.words.clear();
            part.units.clear();
            part.steps[0] = Step {
                mode: Mode::Blend,
                mixing: 0,
                texture: 0,
                first: 0,
                end: 0,
                clip: self.clip,
            };
            (part.area, part.clip, part.mask, part.opaque_clip) =
                (self.area, self.clip, self.mask, self.opaque_clip);
            (part.was_crowded, part.is_part, part.units_per_pass) =
                (self.was_crowded, true, self.units_per_pass / 4);
        }
        true
    }

    /// False if there is no room.
    pub fn append(&mut self, Part(part): &Part) -> bool {
        let (words, units) = (self.words.len() as u32, self.units.len() as u32);
        if !self.has_room(size_of_val(&part.words[..]))
            || self.len() > self.units_per_pass * 2
            || self.covered > Self::COVERED_PER_PASS
        {
            return false;
        }
        self.words.extend_from_slice(&part.words);
        for (to, from) in [&mut self.units]
            .into_iter()
            .chain(&mut self.opaque)
            .zip([&part.units].into_iter().chain(&part.opaque))
        {
            to.extend(from.iter().map(|it| it + (words << 11)));
        }
        for step in part.steps.iter().filter(|it| it.first < it.end) {
            match self.steps.last_mut() {
                Some(last)
                    if matches!(step.mode, Mode::Blend | Mode::Tint)
                        && (last.mode, last.mixing, last.clip)
                            == (step.mode, step.mixing, step.clip) =>
                {
                    last.end = step.end + units
                }
                _ => self.steps.push(Step {
                    first: step.first + units,
                    end: step.end + units,
                    ..*step
                }),
            }
            self.is_mixed = false;
        }
        (self.covered, self.needs_samples) = (
            self.covered + part.covered,
            self.needs_samples || part.needs_samples,
        );
        true
    }

    /// No two scenes of a thread have the same, and none has 0.
    #[inline]
    pub fn generation(&self) -> u32 {
        self.generation
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 1 && self.backdrop.is_none()
    }

    pub fn len(&self) -> usize {
        self.units.len() + self.opaque[0].len() + self.opaque[1].len()
    }

    pub fn hides_what_was_there(&self) -> bool {
        self.backdrop.is_some()
    }

    #[cfg(target_os = "macos")]
    fn uses(&self, texture: &Rc<Texture>) -> bool {
        self.textures.iter().any(|it| Rc::ptr_eq(it, texture))
    }

    #[inline]
    pub fn is_full(&self) -> bool {
        self.words.len() > Self::MAX_WORDS / 2
            || (self.units.len() + self.opaque[1].len()) * 3 + self.opaque[0].len()
                > self.units_per_pass
            || self.textures.len() > Self::MAX_TEXTURES
            || self.pixels_of_textures > MAX_AREA * 2
            || self.covered > Self::COVERED_PER_PASS
    }

    const MAX_WORDS: usize = 1 << 21;
    const MAX_UNITS: usize = 1 << 20;
    const MAX_TEXTURES: usize = 256;
    /// Others wait for the GPU, and systems do not let them wait for long.
    const COVERED_PER_PASS: f32 = 2e9;
    const MAX_COVERED: f32 = 2e10;
    /// That are kept at once, which leaves room for the rest of a shape.
    pub const MAX_BYTES: usize = Self::MAX_WORDS * 2;

    pub fn has_room(&self, bytes: usize) -> bool {
        self.words.len() + bytes / 16 < Self::MAX_WORDS / 4 * 3
    }

    pub fn mark(&self) -> Mark {
        Mark {
            lengths: [self.words.len(), self.units.len(), self.steps.len() - 1],
            last: self.steps[self.steps.len() - 1].clone(),
            is_mixed: self.is_mixed,
        }
    }

    /// Nothing opaque was added since.
    pub fn go_back(
        &mut self,
        Mark {
            lengths: [words, units, steps],
            last,
            is_mixed,
        }: Mark,
    ) {
        self.words.truncate(words);
        self.units.truncate(units);
        self.steps.truncate(steps);
        self.steps.push(last);
        (self.is_mixed, self.generation) = (is_mixed, next_generation());
    }

    /// The first unit copies what there was before.
    fn steps(&mut self, copies: bool) -> &[Step] {
        self.stop_blocking();
        self.steps[0].first = u32::from(!copies);
        &self.steps
    }

    #[inline]
    fn add_units(&mut self, patch: u32, kind: u32, count: u32) {
        let (first, end) = (patch << 11 | kind << 8, self.units.len() + count as usize);
        (0..count).step_by(8).for_each(|step| {
            self.units.extend_from_slice(
                &[0, 1, 2, 3, 4, 5, 6, 7].map(|it| first.wrapping_add(step + it)),
            )
        });
        self.units.truncate(end);
    }

    /// Returns where they are, in words.
    fn keep_bytes(&mut self, bytes: &[u8]) -> u32 {
        let (start, (whole, rest)) = (self.words.len(), bytes.as_chunks::<16>());
        let word =
            |it: &[u8; 16]| std::array::from_fn(|at| u32::from_le_bytes(it.as_chunks().0[at]));
        let mut last = [0; 16];
        last[..rest.len()].copy_from_slice(rest);
        self.words.extend(whole.iter().chain([&last]).map(word));
        start as u32
    }

    pub fn keep_mask(&mut self, mask: &[u8]) -> u32 {
        self.keep_bytes(mask) * 16
    }

    pub fn keep_pixels(&mut self, pixels: &[Pixel], width: usize) -> Source {
        Source::Scene(self.keep_bytes(pixels.as_flattened()) * 4, width as u32)
    }

    /// For what follows. False if it is too large.
    pub fn set_clip(&mut self, rect: IntRect, mask: Option<&Coverage>) -> bool {
        self.stop_blocking();
        (self.clip, self.mask) = (rect.intersect(self.area), [0; 2]);
        let Some(mask) = mask.filter(|_| !self.clip.is_empty()) else {
            return true;
        };
        let width = mask.rect.width();
        let rows = &mask.data[(self.clip.top - mask.rect.top) as usize * width..]
            [..self.clip.height() * width];
        if rows.len() > Self::MAX_BYTES {
            return false;
        }
        let start = self.keep_mask(rows);
        self.mask = [
            start
                .wrapping_sub(self.clip.top as u32 * width as u32)
                .wrapping_sub(mask.rect.left as u32),
            width as u32,
        ];
        true
    }

    /// Until the next `set_clip`. False if it cannot.
    pub fn clip_to(&mut self, path: impl Walk, rule: Fill) -> bool {
        let (before, covered, mut is_fine) =
            ([self.words.len(), self.units.len()], self.covered, true);
        path.walk(|command| {
            self.path.push(command);
            is_fine &= match command {
                Command::MoveTo(to) | Command::LineTo(to) => is_near(to),
                Command::QuadTo(a, to) => is_near(a) && is_near(to),
                Command::CurveTo(a, b, to) => is_near(a) && is_near(b) && is_near(to),
                Command::Close => true,
            };
        });
        let mut path = std::mem::take(&mut self.path);
        if is_fine {
            self.count(path.iter().copied(), before);
        }
        path.clear();
        self.path = path;
        if !self.keep(
            is_fine && self.covered - covered < Self::MAX_COVERED,
            before,
        ) {
            self.covered = covered;
            return false;
        }
        let (end, clip, mode) = (
            self.units.len() as u32,
            self.clip,
            if rule == Fill::NonZero {
                Mode::BlockNonZero
            } else {
                Mode::BlockOdd
            },
        );
        self.add_cover(clip, 0, 0);
        self.blockers.push(self.words.len() as u32 - 1);
        self.steps.push(Step {
            mode: Mode::Count,
            mixing: 0,
            texture: 0,
            first: before[1] as u32,
            end,
            clip,
        });
        self.steps.push(Step {
            mode,
            mixing: 0,
            texture: 0,
            first: end,
            end: end + 1,
            clip,
        });
        (self.needs_samples, self.is_mixed) = (true, false);
        true
    }

    #[inline]
    fn stop_blocking(&mut self) {
        let depth = (self.words.len() as u32 - 1) << 11;
        self.blockers
            .drain(..)
            .for_each(|it| self.words[it as usize][2] = relative(depth, it - 1));
    }

    pub fn clip(&self) -> IntRect {
        self.clip
    }

    fn slot(&mut self, texture: &Rc<Texture>) -> u32 {
        let known = self.textures.iter().rposition(|it| Rc::ptr_eq(it, texture));
        if known.is_none() {
            self.textures.push(texture.clone());
            self.pixels_of_textures += i64::from(texture.size[0]) * i64::from(texture.size[1]);
        }
        known.map_or(self.textures.len(), |it| it + 1) as u32
    }

    /// Before the words of a shape. Returns its depth and its flags.
    #[inline]
    fn next_shape(&mut self, ink: Ink) -> u32 {
        const WORTH_A_STEP: u32 = 64;
        let (rest, last) = (
            (self.words.len() as u32) << 11 | ink.flags(),
            &self.steps[self.steps.len() - 1],
        );
        if self.mask[1] == 0
            && (self.clip == self.area
                || device::CUTS_BETWEEN_PIXELS
                    && !self.is_mixed
                    && (self.clip == last.clip || last.end - last.first > WORTH_A_STEP))
        {
            return rest;
        }
        self.words.push([
            halves_of(self.clip.left, self.clip.top),
            halves_of(self.clip.right, self.clip.bottom),
            self.mask[0],
            self.mask[1],
        ]);
        rest | HAS_CLIP
    }

    /// For the units from `first` on.
    #[inline]
    fn add_step(&mut self, first: usize, ink: Ink, rest: u32) {
        let (end, mixing, has_clip, last) = (
            self.units.len() as u32,
            ink.mixing(),
            rest & HAS_CLIP != 0,
            self.steps.len() - 1,
        );
        let last = &mut self.steps[last];
        if last.mode == Mode::Blend
            && last.mixing == mixing
            && (ink.texture == last.texture || ink.texture == 0 || last.texture == 0)
        {
            if last.clip == self.clip || has_clip && last.clip.contains(self.clip) {
                (last.end, last.texture) = (end, last.texture.max(ink.texture));
                return;
            }
            if self.is_mixed {
                (last.end, last.texture, last.clip) = (
                    end,
                    last.texture.max(ink.texture),
                    last.clip.union(self.clip),
                );
                return;
            }
        }
        self.is_mixed = has_clip;
        self.steps.push(Step {
            mode: Mode::Blend,
            mixing,
            texture: ink.texture,
            first: first as u32,
            end,
            clip: self.clip,
        });
    }

    /// For a shape that has no soft edges. If it is opaque, `units` are such ones until `end_solid`.
    #[inline(always)]
    fn begin_solid(&mut self, ink: Ink) -> Option<usize> {
        if ink.is_opaque()
            && self.mask[1] == 0
            && self.blockers.is_empty()
            && (self.clip == self.opaque_clip
                || device::CUTS_BETWEEN_PIXELS
                    && !self.is_part
                    && self.opaque.iter().all(Vec::is_empty))
        {
            self.opaque_clip = self.clip;
            let which = usize::from(ink.source() != SOLID);
            std::mem::swap(&mut self.units, &mut self.opaque[which]);
            return Some(which);
        }
        None
    }

    #[inline(always)]
    fn end_solid(
        &mut self,
        opaque: Option<usize>,
        first: usize,
        ink: Ink,
        rest: u32,
        covered: f32,
    ) {
        match opaque {
            Some(which) => std::mem::swap(&mut self.units, &mut self.opaque[which]),
            None if first == self.units.len() => {}
            None if rest & (SOURCE | OPERATOR | HAS_CLIP) | ink.mixing() != 0 => {
                self.add_step(first, ink, rest)
            }
            None => self.add_tint(first, ink, rest, covered),
        }
    }

    #[inline]
    fn add_tint(&mut self, first: usize, ink: Ink, rest: u32, covered: f32) {
        const WORTH_A_STEP: f32 = 16384.;
        let (end, last) = (self.units.len() as u32, self.steps.len() - 1);
        match &mut self.steps[last] {
            last if last.mode == Mode::Tint && last.clip == self.clip => last.end = end,
            _ if covered < WORTH_A_STEP => self.add_step(first, ink, rest),
            _ => {
                self.is_mixed = false;
                self.steps.push(Step {
                    mode: Mode::Tint,
                    mixing: 0,
                    texture: 0,
                    first: first as u32,
                    end,
                    clip: self.clip,
                });
            }
        }
    }

    fn add_cover(&mut self, rect: IntRect, color: u32, rest: u32) {
        let (
            patch,
            Rect {
                x,
                y,
                width,
                height,
            },
        ) = (self.words.len() as u32, rect.to_rect());
        self.covered += width * height;
        self.words.extend([
            word(Point::new(x, y), Point::new(x + width, y + height)),
            [0, color, relative(rest, patch), 0],
        ]);
        self.units.push(patch << 11 | BAR << 8 | COVER);
    }

    /// After a shape, which may have had no units.
    #[inline]
    fn clear_around(&mut self, ink: Ink, rest: u32) {
        if ink.clears_backdrop() {
            let (first, nothing) = (self.units.len(), Ink::solid([0; 4]).with(Operator::REPLACE));
            self.add_cover(self.clip, 0, rest & !(SOURCE | OPERATOR) | COPY);
            self.add_step(first, nothing, rest);
        }
    }

    fn opaque_steps(&self) -> [Step; 2] {
        let ends = [
            self.units.len(),
            self.units.len() + self.opaque[0].len(),
            self.len(),
        ]
        .map(|it| it as u32);
        [0, 1].map(|it| Step {
            mode: Mode::Opaque,
            mixing: 0,
            texture: 0,
            first: ends[it],
            end: ends[it + 1],
            clip: self.opaque_clip,
        })
    }

    /// `rect` overlaps the clip, and is no larger than a texture. Returns the depth and the flags.
    #[inline]
    fn add_box(&mut self, rect: IntRect, address: u32, ink: Ink) -> u32 {
        let (rest, opaque) = (self.next_shape(ink), self.begin_solid(ink));
        let first = self.units.len();
        self.covered += rect.area() as f32;
        self.units
            .push((self.words.len() as u32) << 11 | BOX << 8 | rest & 255);
        self.words.push([
            halves_of(rect.left, rect.top),
            halves_of(rect.right - rect.left, rect.bottom - rect.top),
            address,
            ink.color,
        ]);
        self.end_solid(opaque, first, ink, rest, rect.area() as f32);
        rest
    }

    /// For what is already within the rectangle of the clip.
    #[inline]
    fn add_clipped_box(&mut self, rect: IntRect, address: u32, ink: Ink) {
        if ink.clears_backdrop() {
            let rest = if rect.is_empty() {
                self.next_shape(ink)
            } else {
                self.add_box(rect, address, ink)
            };
            return self.clear_around(ink, rest);
        }
        if !rect.is_empty() {
            let clip = self.clip;
            if self.mask[1] == 0 {
                let known = if ink.is_opaque() {
                    self.opaque_clip
                } else {
                    self.steps[self.steps.len() - 1].clip
                };
                self.clip = if known.contains(rect) {
                    known
                } else {
                    self.area
                };
            }
            self.add_box(rect, address, ink);
            self.clip = clip;
        }
    }

    /// With room for what ends a shape.
    #[inline]
    fn fits(&self, [_, units]: [usize; 2]) -> bool {
        self.words.len() + 8 <= Self::MAX_WORDS && self.units.len() - units <= Self::MAX_UNITS
    }

    /// False if it has taken back what was added since.
    fn keep(&mut self, is_fine: bool, [words, units]: [usize; 2]) -> bool {
        let is_fine = is_fine && self.fits([words, units]);
        if !is_fine {
            self.words.truncate(words);
            self.units.truncate(units);
        }
        is_fine
    }

    /// `inverse` maps pixels to its space.
    pub fn gradient(
        &mut self,
        gradient: &Gradient,
        inverse: &Transform,
        opacity: f32,
    ) -> Option<Ink> {
        const MAX_STOPS: usize = 1024;
        let color = self.words.len() as u32;
        self.words.extend(
            [
                [inverse.sx, inverse.ky, inverse.kx, inverse.sy],
                [inverse.tx, inverse.ty, opacity, 0.],
            ]
            .map(|it| it.map(f32::to_bits)),
        );
        gradient
            .describe(&mut self.words, MAX_STOPS)
            .then_some(Ink {
                color,
                how: if opacity >= 1. && gradient.is_opaque() {
                    GRADIENT | HAS_NO_HOLES
                } else {
                    GRADIENT
                },
                texture: 0,
            })
    }

    fn locate(&mut self, source: &Source, kind: u32) -> (Ink, [u32; 2]) {
        match source {
            Source::Scene(address, stride) => (
                Ink {
                    color: 0,
                    how: kind,
                    texture: 0,
                },
                [*address, *stride],
            ),
            Source::Texture(it) => (
                Ink {
                    color: 0,
                    how: kind | IN_TEXTURE,
                    texture: self.slot(it),
                },
                [0, 1 << 16],
            ),
        }
    }

    pub fn pattern(
        &mut self,
        tile: &Source,
        size: [u32; 2],
        repeats: [bool; 2],
        is_smooth: bool,
        inverse: &Transform,
        opacity: f32,
    ) -> Ink {
        let ((ink, [address, _]), color) = (self.locate(tile, PATTERN), self.words.len() as u32);
        self.words.extend(
            [
                [inverse.sx, inverse.ky, inverse.kx, inverse.sy],
                [inverse.tx, inverse.ty, opacity, 0.],
            ]
            .map(|it| it.map(f32::to_bits)),
        );
        self.words.push([
            address,
            size[0],
            size[1],
            u32::from(repeats[0]) | u32::from(repeats[1]) << 1 | u32::from(is_smooth) << 2,
        ]);
        Ink { color, ..ink }
    }

    pub fn space(&mut self, matrix: &Transform) -> Option<Space> {
        let &Transform { sx, ky, kx, sy, .. } = matrix;
        let (inverse, across, down) = (matrix.invert()?, sx * sx + ky * ky, kx * kx + sy * sy);
        if let Some(even) = Space::even(matrix) {
            return Some(even);
        }
        let words = self.words.len() as u32;
        self.words.extend(
            [
                [sx, ky, kx, sy],
                [inverse.sx, inverse.ky, inverse.kx, inverse.sy],
            ]
            .map(|it| it.map(f32::to_bits)),
        );
        Some(Space {
            words,
            scale: (across + down).sqrt(),
        })
    }

    /// Of whole pixels.
    #[inline]
    pub fn rect(&mut self, rect: IntRect, ink: Ink) {
        self.add_clipped_box(rect.intersect(self.clip), 0, ink);
    }

    /// The pixels from `from` on are all that is in `to`.
    #[inline]
    pub fn copy(
        &mut self,
        source: &Source,
        from: [i32; 2],
        to: IntRect,
        opacity: u8,
        how: Operator,
    ) {
        let ((ink, [address, stride]), shown) =
            (self.locate(source, PIXELS), to.intersect(self.clip));
        let [x, y] = [
            from[0].wrapping_add(shown.left - to.left) as u32,
            from[1].wrapping_add(shown.top - to.top) as u32,
        ];
        self.add_clipped_box(
            shown,
            address.wrapping_add(y.wrapping_mul(stride)).wrapping_add(x),
            Ink {
                color: stride << 8 | u32::from(opacity),
                ..ink.with(how)
            },
        );
    }

    /// What `keep_mask` has returned. False if it cannot.
    #[inline]
    pub fn stamp(&mut self, mask: u32, rect: IntRect, ink: Ink) -> bool {
        const MAX_SIDE: usize = 1 << 14;
        let source = match ink.source() {
            _ if ink.clears_backdrop() || rect.width().max(rect.height()) > MAX_SIDE => {
                return false;
            }
            SOLID => MASK,
            GRADIENT => SHADED_MASK,
            _ => return false,
        };
        let ink = Ink {
            how: ink.how & !(SOURCE | HAS_NO_HOLES) | source,
            ..ink
        };
        if self.clip.contains(rect) {
            self.add_clipped_box(rect, mask, ink);
        } else if self.clip.overlaps(rect) {
            self.add_box(rect, mask, ink);
        }
        true
    }

    /// The fourth corner is opposite of the second. These functions take pixels, and return false for what they cannot do.
    pub fn parallelogram(&mut self, corners: [Point; 3], ink: Ink) -> bool {
        self.bar(corners, ink, [0; 2], None)
    }

    /// `part` is within the source.
    #[inline]
    pub fn image(
        &mut self,
        source: &Source,
        part: Rect,
        corners: [Point; 3],
        opacity: u8,
        is_smooth: bool,
        how: Operator,
    ) -> bool {
        let ((ink, place), half) = (
            self.locate(source, if is_smooth { SMOOTH } else { SHARP }),
            Point::new(part.width / 2., part.height / 2.),
        );
        let ink = Ink {
            color: u32::from(opacity) * 0x0101_0101,
            ..ink.with(how)
        };
        half.x.min(half.y) > 0.01
            && self.bar(
                corners,
                ink,
                place,
                Some(word(Point::new(part.x, part.y) + half, half)),
            )
    }

    /// `parallelogram`, for one that is upright.
    #[inline]
    pub fn soft_rect(
        &mut self,
        Rect {
            x,
            y,
            width,
            height,
        }: Rect,
        ink: Ink,
    ) -> bool {
        const LARGE: f32 = 256.;
        let (first, corners) = (
            self.words.len(),
            [
                Point::new(x, y),
                Point::new(x + width, y),
                Point::new(x + width, y + height),
            ],
        );
        let is_done = self.bar(corners, ink, [0; 2], None);
        if is_done
            && self.was_crowded
            && width * height > LARGE
            && self.clip == self.area
            && let Some(opaque) = self.begin_solid(ink)
        {
            // At the same depth, so that only the edges are left.
            let [left, top, right, bottom] = [
                x.ceil(),
                y.ceil(),
                (x + width).floor(),
                (y + height).floor(),
            ];
            let patch = self.words.len() as u32;
            self.units.push(patch << 11 | BAR << 8 | COVER);
            self.words.extend([
                word(
                    Point::new(left, top),
                    Point::new(right.max(left), bottom.max(top)),
                ),
                [
                    0,
                    ink.color,
                    relative((first as u32) << 11 | ink.flags(), patch),
                    0,
                ],
            ]);
            self.end_solid(Some(opaque), 0, ink, 0, 0.);
        }
        is_done
    }

    #[inline]
    fn bar(
        &mut self,
        [a, b, c]: [Point; 3],
        ink: Ink,
        [address, stride]: [u32; 2],
        part: Option<[u32; 4]>,
    ) -> bool {
        if ![a, b, c].into_iter().all(is_near) {
            return false;
        }
        let rest = self.next_shape(ink);
        let area = (b - a).cross(c - b).abs();
        if area > 1e-6 {
            self.covered += area.min(self.clip.area() as f32);
            let (first, across, patch) = (self.units.len(), (c - b) * 0.5, self.words.len() as u32);
            self.units.push(patch << 11 | BAR << 8);
            self.words.extend([
                word(a + across, b + across),
                [address, ink.color, relative(rest, patch), stride],
                word(across, across),
            ]);
            self.words.extend(part);
            self.add_step(first, ink, rest);
        }
        self.clear_around(ink, rest);
        true
    }

    #[inline]
    pub fn line(
        &mut self,
        [from, to]: [Point; 2],
        stroke: &Stroke,
        space: Space,
        ink: Ink,
    ) -> bool {
        let thickness = stroke.width / 2. * space.scale;
        if !(is_near(from) && is_near(to) && thickness > 0. && thickness < THICK) {
            return false;
        }
        if stroke.cap == Cap::Round {
            return space.words == 0
                && thickness >= 0.5
                && from != to
                && self.rounded([from, to], 0., thickness, 0., ink);
        }
        let rest = self.next_shape(ink)
            | if stroke.cap == Cap::Square {
                IS_LINE | HAS_SQUARE_CAPS
            } else {
                IS_LINE
            };
        if from != to {
            let (first, radius) = (
                self.units.len(),
                if space.words == 0 {
                    thickness
                } else {
                    stroke.width / 2.
                },
            );
            self.covered += ((steps(to - from) + thickness * 2. + 2.) * (thickness + 1.) * 2.)
                .min(self.clip.area() as f32);
            let patch = self.words.len() as u32;
            self.units.push(patch << 11 | BAR << 8);
            self.words.extend([
                word(from, to),
                [
                    radius.to_bits(),
                    ink.color,
                    relative(rest, patch),
                    space.words << 8,
                ],
            ]);
            self.add_step(first, ink, rest);
        }
        self.clear_around(ink, rest);
        true
    }

    /// If it has dashes, the path consists of them. Otherwise, what has no length does not show.
    pub fn stroke(
        &mut self,
        mut path: impl Walk,
        stroke: &Stroke,
        space: Space,
        mut ink: Ink,
    ) -> bool {
        let mut thickness = stroke.width / 2. * space.scale;
        if !(thickness > 0. && thickness < THICK)
            || thickness < 0.5 && ink.source() | space.words != 0
        {
            return false;
        }
        if thickness < 0.5 {
            (thickness, ink) = (0.5, ink.faded(thickness * 2.));
        }
        let has_miters = stroke.join == Join::Miter && stroke.miter_limit > 1.;
        let least_cosine = if has_miters {
            (2. / (stroke.miter_limit * stroke.miter_limit) - 1.).max(1. / 4096. - 1.)
        } else {
            2.
        };
        let slight = TOLERANCE / thickness / if stroke.join == Join::Round { 1. } else { 2. };
        let pen = &Pen {
            radius: if space.words == 0 {
                thickness
            } else {
                stroke.width / 2.
            },
            space: space.words,
            cap: stroke.cap,
            is_round: stroke.join == Join::Round,
            least_cosine,
            sharpest: if space.words != 0 {
                -1.
            } else if has_miters {
                slight.max((1. - least_cosine) / (1. + least_cosine))
            } else {
                slight
            },
            turns: (std::f32::consts::FRAC_PI_2 * (thickness / (8. * TOLERANCE)).sqrt())
                .ceil()
                .clamp(1., 255.),
            thickness,
        };
        let (reach, has_dots) = (
            thickness + 1.,
            !stroke.dashes.is_empty() && stroke.cap != Cap::Butt,
        );
        let (words, rest, opaque) = (
            self.words.len(),
            self.next_shape(ink),
            self.begin_solid(ink),
        );
        let (before, mut is_fine, clip) = ([words, self.units.len()], true, self.clip);
        let head = [
            pen.radius.to_bits(),
            ink.color,
            rest | if pen.cap == Cap::Square {
                HAS_SQUARE_CAPS
            } else {
                0
            },
        ];
        let window = [
            Point::new(clip.left as f32 - reach, clip.top as f32 - reach),
            Point::new(clip.right as f32 + reach, clip.bottom as f32 + reach),
        ];
        let mut stroker = Stroker {
            scene: self,
            pen,
            head,
            window,
            start: None,
            run: (0, 0),
            before: Point::ZERO,
            first_direction: Point::ZERO,
            at: Point::ZERO,
            direction: Point::ZERO,
        };
        let (mut length, longest) = (0., (clip.width() + clip.height()) as f32 * 3.);
        let mut points = std::mem::take(&mut stroker.scene.corners);
        while is_fine
            && pen.has_runs()
            && !has_dots
            && let Some(is_closed) = path.take_lines(&mut points)
        {
            points.extend(is_closed.then_some(points[0]));
            points.dedup();
            length += points
                .array_windows()
                .map(|[a, b]| steps(*b - *a).min(longest))
                .sum::<f32>();
            is_fine = points.iter().fold(true, |all, it| all & is_near(*it))
                && points.len() <= Self::MAX_UNITS;
            match points[..] {
                _ if !is_fine => {}
                [from, to] => {
                    stroker.at = from;
                    stroker.line(to, pen.is_round);
                }
                _ => stroker.lines(&points),
            }
            stroker.end(is_closed);
            is_fine &= stroker.scene.fits(before);
            points.clear();
        }
        stroker.scene.corners = points;
        segments(path, |segment| match segment {
            _ if !is_fine => {}
            Err(is_closed) => stroker.end(is_closed),
            Ok((points, is_line)) => {
                let [a, b, c, d] = points;
                length += (if is_line {
                    steps(d - a)
                } else {
                    steps(b - a) + steps(c - b) + steps(d - c)
                })
                .min(longest);
                is_fine = points.into_iter().all(is_near) && stroker.scene.fits(before);
                if stroker.start.is_none() {
                    stroker.at = points[0];
                }
                match is_line {
                    _ if has_dots && stroker.start.is_none() && points == [points[0]; 4] => {
                        stroker.patch(
                            [points[0] + Point::new(1., 0.); 4],
                            IS_LINE,
                            0,
                            [Point::new(1., 0.); 2],
                            false,
                        );
                    }
                    true => stroker.line(points[3], pen.is_round),
                    false if is_fine => stroker.curve(points, pen.is_round, 14),
                    false => {}
                }
            }
        });
        let (count, corner) = (
            (self.units.len() - before[1]) as f32,
            reach
                * reach
                * if has_miters {
                    stroke.miter_limit.clamp(4., 128.)
                } else {
                    4.
                },
        );
        let covered = (length * reach * 2. + count * corner).min(count * clip.area() as f32);
        let is_kept = self.keep(is_fine && covered < Self::MAX_COVERED, before);
        self.end_solid(opaque, before[1], ink, rest, length * reach);
        if is_kept {
            (self.needs_samples, self.covered) = (true, self.covered + covered);
            self.clear_around(ink, rest);
        }
        is_kept
    }

    fn wedges(&mut self, curve: [Point; 4], center: Point, head: [u32; 2]) {
        const MOST: f32 = 255. * 2.;
        let count = curviness(curve);
        if count > MOST * MOST {
            return halves(curve, 0.5)
                .into_iter()
                .for_each(|it| self.wedges(it, center, head));
        }
        let (patch, count) = (
            self.words.len() as u32,
            ((count.sqrt() / 2.).ceil() as u32).max(1),
        );
        let [a, b, c, d] = curve.map(|it| it - center);
        self.covered += (a.cross(b).abs() + b.cross(c).abs() + c.cross(d).abs() + a.cross(d).abs())
            .min(self.clip.area() as f32 * count as f32 * 2.);
        self.words.extend([
            word(curve[0], curve[3]),
            [0, head[0], relative(head[1], patch), count],
            word(curve[1], curve[2]),
            word(center, center),
        ]);
        self.add_units(patch, WEDGE, count);
    }

    /// What is within `radius` of a rectangle, or within `reach` of the edge of that. `axis` connects the middles of two sides.
    #[inline]
    fn rounded(
        &mut self,
        [from, to]: [Point; 2],
        half_height: f32,
        radius: f32,
        reach: f32,
        ink: Ink,
    ) -> bool {
        let (rest, first) = (self.next_shape(ink), self.units.len());
        let (unit, margin) = (
            (self.words.len() as u32) << 11 | BAR << 8,
            (radius + reach + 1.) * 2.,
        );
        self.covered += (((to.x - from.x).abs() + (to.y - from.y).abs() + margin)
            * (half_height * 2. + margin))
            .min(self.clip.area() as f32);
        self.words.extend([
            word(from, to),
            [
                radius.to_bits(),
                ink.color,
                relative(rest, unit >> 11),
                reach.to_bits(),
            ],
            [half_height.to_bits(), 0, 0, 0],
        ]);
        match reach > 0. {
            true => self.units.extend(unit | FRAME..unit | (FRAME + 4)),
            false => self.units.push(unit | ROUNDED),
        }
        self.add_step(first, ink, rest);
        self.clear_around(ink, rest);
        true
    }

    pub fn rounded_rect(
        &mut self,
        Rect {
            x,
            y,
            width,
            height,
        }: Rect,
        radius: f32,
        reach: f32,
        ink: Ink,
    ) -> bool {
        let axis = [
            Point::new(x + radius, y + height / 2.),
            Point::new((x + width - radius).max(x + radius), y + height / 2.),
        ];
        (radius >= 1. || reach > 0.)
            && width.min(height) >= 1.
            && axis.into_iter().all(is_near)
            && height < FAR
            && self.rounded(axis, (height / 2. - radius).max(0.), radius, reach, ink)
    }

    /// The stroke of a rectangle.
    pub fn frame(
        &mut self,
        rect: Rect,
        radius: f32,
        stroke: &Stroke,
        space: Space,
        ink: Ink,
    ) -> bool {
        let thickness = stroke.width / 2. * space.scale;
        let has_corners =
            stroke.join == Join::Miter && stroke.miter_limit > std::f32::consts::SQRT_2;
        space.words == 0
            && thickness > 0.
            && thickness < THICK
            && (radius >= 1. && rect.width.min(rect.height) >= thickness * 2. + 2.
                || radius == 0. && has_corners)
            && self.rounded_rect(rect, radius, thickness, ink)
    }

    /// Up to the center if `inner` is 0, and up to the chord if it is less.
    #[inline]
    fn sector(
        &mut self,
        Arc {
            center,
            radius,
            from,
            sweep,
        }: Arc,
        inner: f32,
        color: u32,
        rest: u32,
    ) {
        let lines = if inner > 0. { 1. } else { 2. };
        let count = (sweep.abs() * (radius / (7. * TOLERANCE)).sqrt().max(1.) / lines).ceil();
        let (patch, sweep) = (
            self.words.len() as u32,
            if sweep.abs() == TAU {
                sweep * 1.000_001
            } else {
                sweep
            },
        );
        self.words.extend([
            word(center, Point::new(from, sweep / (count * lines))),
            [
                inner.to_bits(),
                color,
                relative(rest, patch),
                radius.to_bits(),
            ],
        ]);
        self.add_units(patch, RING, count as u32);
        self.covered += radius * radius * PI;
    }

    /// Whether four corners and more work for each pixel are less than the lines that it takes.
    fn is_small(&self, radius: f32, ink: Ink) -> bool {
        radius
            <= if ink.is_opaque() && self.was_crowded {
                12.
            } else {
                128.
            }
    }

    /// With straight lines to the center, or from end to end.
    #[inline]
    pub fn pie(&mut self, arc: Arc, has_tip: bool, mut ink: Ink) -> bool {
        if !(is_near(arc.center) && arc.radius < WIDE && arc.sweep.abs() <= TAU) {
            return false;
        }
        if arc.sweep.abs() == TAU && self.is_small(arc.radius, ink) {
            let mut radius = (arc.radius * arc.radius - 1. / 12.).sqrt();
            if arc.radius < 0.6 {
                if ink.source() != SOLID {
                    return false;
                }
                (radius, ink) = (0.5, ink.faded((arc.radius * arc.radius * 3.).min(1.)));
            }
            return self.rounded([arc.center; 2], 0., radius, 0., ink);
        }
        let (rest, opaque) = (self.next_shape(ink), self.begin_solid(ink));
        let first = self.units.len();
        self.sector(
            arc,
            if has_tip || arc.sweep.abs() == TAU {
                0.
            } else {
                -1.
            },
            ink.color,
            rest,
        );
        self.needs_samples = true;
        self.end_solid(
            opaque,
            first,
            ink,
            rest,
            arc.radius * arc.radius * arc.sweep.abs() / 2.,
        );
        self.clear_around(ink, rest);
        true
    }

    /// The stroke of an arc.
    #[inline]
    pub fn ring(
        &mut self,
        arc: Arc,
        is_closed: bool,
        stroke: &Stroke,
        space: Space,
        ink: Ink,
    ) -> bool {
        let (thickness, is_whole) = (stroke.width / 2. * space.scale, arc.sweep.abs() == TAU);
        let ends_are_plain = if is_whole {
            is_closed || stroke.cap != Cap::Square
        } else {
            !is_closed && stroke.cap == Cap::Butt
        };
        if !(ends_are_plain
            && space.words == 0
            && is_near(arc.center)
            && thickness > 0.
            && arc.radius + thickness < WIDE
            && arc.sweep.abs() <= TAU)
        {
            return false;
        }
        if is_whole && arc.radius - thickness < 0.25 {
            return self.pie(
                Arc {
                    radius: arc.radius + thickness,
                    ..arc
                },
                true,
                ink,
            );
        }
        if is_whole
            && arc.radius - thickness >= 1.
            && (thickness < 0.5 || self.is_small(arc.radius + thickness, ink))
        {
            return self.rounded([arc.center; 2], 0., arc.radius, thickness, ink);
        }
        if thickness < 0.5 {
            return false;
        }
        let (rest, opaque) = (self.next_shape(ink), self.begin_solid(ink));
        let first = self.units.len();
        self.sector(
            Arc {
                radius: arc.radius + thickness,
                ..arc
            },
            (arc.radius - thickness).max(0.),
            ink.color,
            rest,
        );
        if thickness > arc.radius {
            self.sector(
                Arc {
                    radius: thickness - arc.radius,
                    from: arc.from + PI,
                    ..arc
                },
                0.,
                ink.color,
                rest,
            );
        }
        self.needs_samples = true;
        self.end_solid(
            opaque,
            first,
            ink,
            rest,
            arc.radius * thickness * arc.sweep.abs() * 2.,
        );
        self.clear_around(ink, rest);
        true
    }

    /// The triangles between `center` and the lines through `points`.
    fn fan(&mut self, center: Point, points: &[Point], [color, rest]: [u32; 2]) {
        const LONGEST: usize = 256 * 2;
        let all = self.clip.area() as f32;
        self.covered += points
            .array_windows()
            .map(|[a, b]| (*a - center).cross(*b - center).abs().min(all))
            .sum::<f32>();
        for start in (0..points.len().saturating_sub(1)).step_by(LONGEST) {
            let (run, part) = (
                self.words.len() as u32,
                &points[start..points.len().min(start + LONGEST + 1)],
            );
            self.words
                .extend([[0, color, relative(rest, run), 0], word(center, part[0])]);
            self.words
                .extend(part[1..].chunks(2).map(|it| word(it[0], it[it.len() - 1])));
            self.add_units(run, RUN, part.len() as u32 / 2);
        }
    }

    /// Triangles that add up to the polygon, as small as they can be.
    fn polygon(&mut self, points: &mut Vec<Point>, [color, rest]: [u32; 2]) {
        const LONGEST: usize = 256 * 3;
        while points.len() > 2 {
            points.resize((points.len() + 1) / 3 * 3 + 1, points[points.len() - 1]);
            let all = self.clip.area() as f32;
            self.covered += points
                .array_windows()
                .step_by(3)
                .map(|[a, b, c, d]| {
                    ((*b - *a).cross(*c - *a).abs() + (*c - *a).cross(*d - *a).abs()).min(all * 2.)
                })
                .sum::<f32>();
            for start in (0..points.len() - 1).step_by(LONGEST) {
                let (run, part) = (
                    self.words.len() as u32,
                    &points[start..points.len().min(start + LONGEST + 1)],
                );
                self.words
                    .extend([[0, color, relative(rest, run), 1], word(part[0], part[0])]);
                self.words
                    .extend(part[1..].chunks(2).map(|it| word(it[0], it[it.len() - 1])));
                self.add_units(run, RUN, part.len() as u32 / 3);
            }
            let left = points.len() / 3 + 1;
            (1..left).for_each(|it| points[it] = points[it * 3]);
            points.truncate(left);
        }
        points.clear();
    }

    /// From `center`, or from where each contour starts. Adds nothing once they overlap or are too many.
    #[inline]
    fn fans(
        &mut self,
        path: impl Walk,
        center: Option<Point>,
        rule: Fill,
        head: [u32; 2],
        before: [usize; 2],
    ) -> (Fan, u32) {
        let (mut fan, mut contours, mut start, mut points) = (
            Fan {
                turns: [0.; 2],
                quadrant: 0,
                quadrants: 0,
            },
            0,
            None,
            std::mem::take(&mut self.points),
        );
        segments(path, |segment| {
            let Ok((segment, is_line)) = segment else {
                let Some((start, end)) = start.take() else {
                    return;
                };
                if let Some(center) = center.filter(|_| end != start) {
                    fan.add(center, [end, end, start, start], true, rule);
                    points.extend(points.is_empty().then_some(end).into_iter().chain([start]));
                }
                self.fan(center.unwrap_or(start), &points, head);
                return points.clear();
            };
            contours += u32::from(start.is_none());
            let (start, end) = start.get_or_insert((segment[0], segment[0]));
            let center = center.unwrap_or(*start);
            *end = segment[3];
            if !fan.turns_one_way() || !self.fits(before) {
                return points.clear();
            }
            fan.add(center, segment, is_line, rule);
            if is_line {
                points.extend((points.is_empty() && segment[0] != center).then_some(segment[0]));
                return points.push(segment[3]);
            }
            self.fan(center, &points, head);
            points.clear();
            self.wedges(segment, center, head);
        });
        self.points = points;
        (fan, contours)
    }

    /// False unless it goes from left to right and back, or from top to bottom, as the area of a chart does. It ends where it starts.
    fn slabs(&mut self, points: &mut [Point], [color, rest]: [u32; 2]) -> bool {
        const LONGEST: usize = 256;
        let turns_back_once = |along: fn(Point) -> f32| {
            let (mut count, mut last) = (0, 0.);
            points.array_windows().all(|[a, b]| {
                let step = along(*b) - along(*a);
                count += u32::from(step * last < 0.);
                last = if step != 0. { step } else { last };
                count <= 2
            })
        };
        let is_across = turns_back_once(|it| it.x);
        let is_done = is_across || turns_back_once(|it| it.y);
        if is_done {
            let (flip, count) = (
                |it: Point| {
                    if is_across {
                        it
                    } else {
                        Point::new(it.y, it.x)
                    }
                },
                points.len() - 1,
            );
            let first = (0..count).fold(0, |first, it| {
                if flip(points[it]).x < flip(points[first]).x {
                    it
                } else {
                    first
                }
            });
            points[..count].rotate_left(first);
            points[count] = points[0];
            let at = |side: usize, step: usize| {
                flip(points[if side == 0 { step } else { count - step }])
            };
            let (mut steps, mut ends, mut run, mut length) = ([1, 1], [at(0, 0); 2], 0, LONGEST);
            while steps[0] + steps[1] <= count + 1 {
                let next = [at(0, steps[0]), at(1, steps[1])];
                let side = usize::from(next[1].x < next[0].x);
                let (near, from, to, mut after) = (
                    next[side],
                    at(1 - side, steps[1 - side] - 1),
                    next[1 - side],
                    [next[side]; 2],
                );
                after[1 - side] = match () {
                    () if to.x > near.x => Point::new(
                        near.x,
                        from.y + (to.y - from.y) * (near.x - from.x) / (to.x - from.x),
                    ),
                    () if near.x > ends[0].x => to,
                    () => ends[1 - side],
                };
                steps[side] += 1;
                let (gap, next_gap) = (ends[1].y - ends[0].y, after[1].y - after[0].y);
                let crossing = (gap * next_gap < 0. && near.x > ends[0].x)
                    .then(|| [ends[0].lerp(after[0], gap / (gap - next_gap)); 2]);
                for after in crossing.into_iter().chain([after]) {
                    if length == LONGEST {
                        (run, length) = (self.words.len() as u32, 0);
                        self.words.extend([
                            [0, color, relative(rest, run), 2],
                            word(flip(ends[0]), flip(ends[1])),
                        ]);
                    }
                    self.words.push(word(flip(after[0]), flip(after[1])));
                    self.units.push(run << 11 | RUN << 8 | length as u32);
                    self.covered += (after[0].x - ends[0].x) * (gap.abs() + next_gap.abs());
                    (ends, length) = (after, length + 1);
                }
            }
        }
        is_done
    }

    /// Triangles that add up to the winding number.
    fn count(&mut self, path: impl Walk, before: [usize; 2]) {
        let (mut points, head) = (std::mem::take(&mut self.points), [0; 2]);
        segments(path, |segment| match segment {
            _ if !self.fits(before) => points.clear(),
            Err(_) => self.polygon(&mut points, head),
            Ok((segment, is_line)) => {
                points.extend(points.is_empty().then_some(segment[0]));
                points.push(segment[3]);
                if !is_line {
                    self.wedges(segment, segment[0], head);
                }
            }
        });
        self.points = points;
    }

    pub fn fill(&mut self, path: impl Walk + Clone, rule: Fill, ink: Ink) -> bool {
        let (mut commands, mut corners) = (
            std::mem::take(&mut self.path),
            std::mem::take(&mut self.corners),
        );
        let mut rest = path.clone();
        if rest.take_lines(&mut corners).is_some() && rest.is_empty() {
            corners.push(corners[0]);
        } else {
            corners.clear();
            path.walk(|it| commands.push(it));
        }
        let is_done = self.fill_either(&commands, &mut corners, rule, ink);
        commands.clear();
        corners.clear();
        (self.path, self.corners) = (commands, corners);
        is_done
    }

    /// False if triangles that overlap would show it.
    fn fill_simply(
        &mut self,
        path: &[Command],
        corners: &mut [Point],
        middle: Point,
        rule: Fill,
        head: [u32; 2],
    ) -> bool {
        const FEW: usize = 32;
        let is_simple = |fan: Fan, contours, quadrants| {
            fan.turns_one_way()
                && (rule == Fill::NonZero || contours == 1 && fan.quadrants <= quadrants)
        };
        if let [first, ref others @ .., _] = *corners {
            let (center, around) = match () {
                () if is_simple(Fan::of(first, others, rule), 1, 3) => (first, others),
                () if others.len() < FEW && is_simple(Fan::of(middle, corners, rule), 1, 4) => {
                    (middle, &*corners)
                }
                () => return corners.len() < self.units_per_pass / 2 && self.slabs(corners, head),
            };
            self.fan(center, around, head);
            return true;
        }
        let (start, covered) = ([self.words.len(), self.units.len()], self.covered);
        let (fan, contours) = self.fans(path.iter().copied(), None, rule, head, start);
        let mut is_done = is_simple(fan, contours, 3);
        if !is_done && contours == 1 && path.len() <= FEW {
            self.keep(false, start);
            self.covered = covered;
            is_done = is_simple(
                self.fans(path.iter().copied(), Some(middle), rule, head, start)
                    .0,
                1,
                4,
            );
        }
        if !is_done {
            self.keep(false, start);
            self.covered = covered;
        }
        is_done
    }

    /// One of them is empty.
    fn fill_either(
        &mut self,
        path: &[Command],
        corners: &mut Vec<Point>,
        rule: Fill,
        ink: Ink,
    ) -> bool {
        let (mut low, mut high, mut is_fine) = (Point::new(FAR, FAR), Point::new(-FAR, -FAR), true);
        let mut add = |it: Point| {
            (low, high) = (
                Point::new(low.x.min(it.x), low.y.min(it.y)),
                Point::new(high.x.max(it.x), high.y.max(it.y)),
            );
            is_fine &= is_near(it);
        };
        corners.iter().copied().for_each(&mut add);
        path.iter().for_each(|command| match *command {
            Command::MoveTo(to) | Command::LineTo(to) => add(to),
            Command::QuadTo(a, to) => [a, to].into_iter().for_each(&mut add),
            Command::CurveTo(a, b, to) => [a, b, to].into_iter().for_each(&mut add),
            Command::Close => {}
        });
        if !is_fine {
            return false;
        }
        let bounds = IntRect::around(Rect {
            x: low.x,
            y: low.y,
            width: high.x - low.x,
            height: high.y - low.y,
        })
        .outset(1)
        .intersect(self.area);
        let clip = bounds.intersect(self.clip);
        let (words, rest) = (self.words.len(), self.next_shape(ink));
        if clip.is_empty() {
            self.clear_around(ink, rest);
            return true;
        }
        let opaque = self.begin_solid(ink);
        let (start, covered) = ([self.words.len(), self.units.len()], self.covered);
        let is_simple =
            self.fill_simply(path, corners, low.lerp(high, 0.5), rule, [ink.color, rest]);
        let mut is_kept = self.keep(self.covered - covered < Self::MAX_COVERED, start);
        self.end_solid(opaque, start[1], ink, rest, (self.covered - covered) / 2.);
        let before = [words, self.units.len()];
        if !is_simple {
            self.polygon(corners, [0; 2]);
            self.count(path.iter().copied(), before);
            is_kept = self.keep(self.covered - covered < Self::MAX_COVERED, before);
        }
        if !is_kept {
            self.covered = covered;
            return false;
        }
        self.needs_samples = true;
        if !is_simple {
            let (end, mode) = (
                self.units.len() as u32,
                if rule == Fill::NonZero {
                    Mode::CoverNonZero
                } else {
                    Mode::CoverOdd
                },
            );
            self.add_cover(clip, ink.color, rest);
            // Where all that was counted is covered, the rectangle that the steps around it have will do.
            let clip = if clip == bounds {
                self.steps[self.steps.len() - 1].clip.union(clip)
            } else {
                clip
            };
            self.steps.push(Step {
                mode: Mode::Count,
                mixing: 0,
                texture: 0,
                first: before[1] as u32,
                end,
                clip,
            });
            self.steps.push(Step {
                mode,
                mixing: ink.mixing(),
                texture: ink.texture,
                first: end,
                end: end + 1,
                clip,
            });
            self.is_mixed = false;
        }
        self.clear_around(ink, rest);
        true
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    thread_local! {
        pub static IS_ON: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
        pub static FAILS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    pub fn forgive() {
        *STATE.lock() = (State::On, 0);
    }
}
