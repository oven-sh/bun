//! Paths as triangles, for a GPU: it flattens and strokes them (`vector/shader.h`), and a depth for each shape keeps that
//! from being blended with itself.

use std::rc::Rc;
use std::sync::LazyLock;

use super::blend;
use super::gradient::{Geometry, Gradient, Spread};
use super::raster::{Clip, Coverage, IntRect, Layer, Paint, Pixel, scale};
use crate::abi::{GradientStop, Rect};
use crate::error::{Context as _, Result, ensure};
use crate::gfx::{Cap, Command, Fill, Join, Point, Stroke, Transform};
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
    Starting,
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
        state.0 = State::Starting;
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
        let mut target = Target::new(area.right, area.bottom)?;
        target.write(layer.pixels())?;
        let (ink, space) = scene
            .gradient(&gradient, &identity, 1.)
            .zip(scene.space(&identity))
            .context("it cannot be described")?;
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
    FIRST_CAP = 2,
    LAST_CAP = 3,
    WEDGE = 4,
    BAR = 5,
    BOX = 6,
    COVER = 7,

    MAY_FOLD = 128,
    BEYOND_FOLD = 64,

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

#[repr(u32)]
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Blend,
    Opaque,
    Count,
    CoverNonZero,
    CoverOdd,
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

#[derive(Clone, Copy, Default, PartialEq)]
pub struct Operator {
    flags: u8,
    mixing: u8,
    clears_backdrop: bool,
}

impl Operator {
    pub const OVER: Operator = Operator {
        flags: OVER as u8,
        mixing: 0,
        clears_backdrop: false,
    };
    pub const ERASE: Operator = Operator {
        flags: ERASE as u8,
        ..Operator::OVER
    };
    /// Only where the source is.
    pub const REPLACE: Operator = Operator {
        flags: COPY as u8,
        ..Operator::OVER
    };

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
        (mixing == 0 || device::reads_backdrop()).then_some(Operator {
            flags: flags as u8,
            mixing: mixing as u8,
            clears_backdrop: mode.clears_backdrop(),
        })
    }

    pub fn clears_backdrop(self) -> bool {
        self.clears_backdrop
    }
}

#[derive(Clone, Copy)]
pub struct Ink {
    /// Or where the gradient or the pattern is.
    color: u32,
    source: u8,
    how: Operator,
    texture: u32,
}

impl Ink {
    pub fn solid(color: Pixel) -> Ink {
        Ink {
            color: u32::from_le_bytes(color),
            source: SOLID as u8,
            how: Operator::OVER,
            texture: 0,
        }
    }

    pub fn with(self, how: Operator) -> Ink {
        Ink { how, ..self }
    }

    fn is_opaque(self) -> bool {
        u32::from(self.source) == SOLID && self.how == Operator::OVER && self.color >> 24 == 255
    }

    fn flags(self) -> u32 {
        u32::from(self.source | self.how.flags)
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

struct Pen {
    radius: f32,
    space: u32,
    cap: Cap,
    is_round: bool,
    least_cosine: f32,
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
    /// Likewise, of what has one color and hides what is below it. It is drawn first.
    opaque: Vec<u32>,
    opaque_clip: IntRect,
    steps: Vec<Step>,
    textures: Vec<Rc<Texture>>,
    pixels_of_textures: i64,
    /// How many pixels the units cover, at most.
    covered: f32,
    needs_samples: bool,
    /// What there is below it all, if not what there was before.
    backdrop: Option<Pixel>,
    clip: IntRect,
    /// Where the pixel at the origin would be, and the length of a row, if any.
    mask: [u32; 2],
    /// All shapes of the last step say what they are clipped to.
    is_mixed: bool,
    /// Of what refers to words.
    generation: u32,
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

/// The square of the number of lines that it takes.
fn curviness([a, b, c, d]: [Point; 4]) -> f32 {
    square(a - b * 2. + c).max(square(b - c * 2. + d)).sqrt() * (0.75 / TOLERANCE)
}

/// As cubic curves, and whether it is a line. `None` ends a contour, closing it or not.
#[inline(always)]
fn segments(
    path: impl Iterator<Item = Command>,
    mut take: impl FnMut(Result<([Point; 4], bool), bool>),
) {
    let (mut at, mut start) = (Point::ZERO, Point::ZERO);
    for command in path {
        let (segment, is_line) = match command {
            Command::MoveTo(to) => {
                take(Err(false));
                (at, start) = (to, to);
                continue;
            }
            Command::Close => {
                if at != start {
                    take(Ok(([at, at, start, start], true)));
                }
                take(Err(true));
                at = start;
                continue;
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
    }
    take(Err(false));
}

struct Stroker<'a> {
    scene: &'a mut Scene,
    pen: &'a Pen,
    head: [u32; 3],
    window: [Point; 2],
    /// Where the words of the first and of the last patch of the contour are.
    ends: Option<[u32; 2]>,
    first_direction: Point,
    at: Point,
    direction: Point,
}

impl Stroker<'_> {
    fn join(&mut self, patch: u32, after: Point, is_round: bool) {
        let mut count = 1.;
        if is_round {
            let cosine =
                self.direction.dot(after) / (square(self.direction) * square(after)).sqrt();
            count = if self.pen.space == 0 {
                (self.pen.turns * ((1. - cosine).max(0.) / 2.).sqrt())
                    .ceil()
                    .clamp(1., self.pen.turns)
            } else {
                self.pen.turns
            };
        }
        self.scene.add_units(patch, JOIN, count as u32);
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
                rest | flags,
                self.pen.space << 8 | count.max(1),
            ],
            word(b, c),
            word(self.direction, style),
        ]);
        match &mut self.ends {
            Some(ends) => {
                ends[1] = patch;
                self.join(patch, first, is_round);
            }
            None => (self.ends, self.first_direction) = (Some([patch; 2]), first),
        }
        self.scene.add_units(patch, STRIP, count);
        (self.at, self.direction) = (if count == 0 { self.at } else { d }, last);
        patch
    }

    #[inline]
    fn line(&mut self, to: Point, is_round: bool) {
        let along = to - self.at;
        if along != Point::ZERO {
            self.patch([to; 4], IS_LINE, 1, [along; 2], is_round);
        }
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
        let Some([first, last]) = self.ends.take() else {
            return;
        };
        if is_closed {
            let words = &mut self.scene.words[first as usize..];
            words[3][..2]
                .copy_from_slice(&[self.direction.x.to_bits(), self.direction.y.to_bits()]);
            self.join(first, self.first_direction, self.pen.is_round);
        } else if self.pen.cap != Cap::Butt {
            let count = if self.pen.cap == Cap::Round {
                self.pen.turns as u32
            } else {
                1
            };
            self.scene.add_units(first, FIRST_CAP, count);
            if self.scene.words[last as usize][2..] != word(self.at, self.at)[2..] {
                let (patch, [radius, color, rest]) = (self.scene.words.len() as u32, self.head);
                let style = word(self.direction, Point::new(0., self.pen.turns));
                self.scene.words.extend([
                    word(self.at, self.at - self.direction),
                    [radius, color, rest | IS_LINE, self.pen.space << 8 | 1],
                    [0; 4],
                    style,
                ]);
                return self.scene.add_units(patch, FIRST_CAP, count);
            }
            self.scene.add_units(last, LAST_CAP, count);
        }
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
            needs_samples: false,
            backdrop: None,
            clip: area,
            mask: [0; 2],
            is_mixed: false,
            generation: 0,
        };
        scene.start_over(None);
        scene
    }

    /// Without a clip.
    pub fn start_over(&mut self, backdrop: Option<Pixel>) {
        self.words.clear();
        self.units.clear();
        self.opaque.clear();
        self.steps.clear();
        self.textures.clear();
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

    /// No two scenes of a thread have the same, and none has 0.
    #[inline]
    pub fn generation(&self) -> u32 {
        self.generation
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 1 && self.backdrop.is_none()
    }

    pub fn len(&self) -> usize {
        self.units.len() + self.opaque.len()
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
            || self.units.len() * 3 + self.opaque.len() > Self::UNITS_PER_PASS
            || self.textures.len() > Self::MAX_TEXTURES
            || self.pixels_of_textures > MAX_AREA * 2
            || self.covered > Self::COVERED_PER_PASS
    }

    const MAX_WORDS: usize = 1 << 21;
    const MAX_UNITS: usize = 1 << 20;
    /// The corners of those that are not opaque take three times the room.
    const UNITS_PER_PASS: usize = 1 << 18;
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
        self.steps[0].first = u32::from(!copies);
        &self.steps
    }

    #[inline]
    fn add_units(&mut self, patch: u32, kind: u32, count: u32) {
        let first = patch << 11 | kind << 8;
        self.units.extend(first..first + count);
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
            u32::from(ink.how.mixing),
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

    /// Likewise, for what has no soft edges.
    #[inline]
    fn add_solid(&mut self, first: usize, ink: Ink, rest: u32) {
        if ink.is_opaque()
            && self.mask[1] == 0
            && (self.clip == self.opaque_clip
                || device::CUTS_BETWEEN_PIXELS && self.opaque.is_empty())
        {
            self.opaque_clip = self.clip;
            self.opaque.extend_from_slice(&self.units[first..]);
            return self.units.truncate(first);
        }
        self.add_step(first, ink, rest);
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
            [0, color, rest, 0],
        ]);
        self.add_units(patch, COVER, 1);
    }

    /// After a shape, which may have had no units.
    #[inline]
    fn clear_around(&mut self, ink: Ink, rest: u32) {
        if ink.how.clears_backdrop {
            let (first, nothing) = (self.units.len(), Ink::solid([0; 4]).with(Operator::REPLACE));
            self.add_cover(self.clip, 0, rest & !(SOURCE | OPERATOR) | COPY);
            self.add_step(first, nothing, rest);
        }
    }

    fn opaque_step(&self) -> Step {
        Step {
            mode: Mode::Opaque,
            mixing: 0,
            texture: 0,
            first: self.units.len() as u32,
            end: self.len() as u32,
            clip: self.opaque_clip,
        }
    }

    /// `rect` overlaps the clip, and is no larger than a texture. Returns the depth and the flags.
    #[inline]
    fn add_box(&mut self, rect: IntRect, address: u32, ink: Ink) -> u32 {
        let (rest, first) = (self.next_shape(ink), self.units.len());
        self.covered += rect.area() as f32;
        self.units
            .push((self.words.len() as u32) << 11 | BOX << 8 | rest & 255);
        self.words.push([
            halves_of(rect.left, rect.top),
            halves_of(rect.right - rect.left, rect.bottom - rect.top),
            address,
            ink.color,
        ]);
        self.add_solid(first, ink, rest);
        rest
    }

    /// For what is already within the rectangle of the clip.
    #[inline]
    fn add_clipped_box(&mut self, rect: IntRect, address: u32, ink: Ink) {
        if ink.how.clears_backdrop {
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
                source: GRADIENT as u8,
                how: Operator::OVER,
                texture: 0,
            })
    }

    fn locate(&mut self, source: &Source, kind: u32) -> (Ink, [u32; 2]) {
        match source {
            Source::Scene(address, stride) => (
                Ink {
                    source: kind as u8,
                    ..Ink::solid([0; 4])
                },
                [*address, *stride],
            ),
            Source::Texture(it) => (
                Ink {
                    source: (kind | IN_TEXTURE) as u8,
                    texture: self.slot(it),
                    ..Ink::solid([0; 4])
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
        let (across, down, inverse) = (sx * sx + ky * ky, kx * kx + sy * sy, matrix.invert()?);
        if (across - down).abs() <= across * 1e-5 && (sx * kx + ky * sy).abs() <= across * 1e-5 {
            return Some(Space {
                words: 0,
                scale: across.sqrt(),
            });
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
                how,
                ..ink
            },
        );
    }

    /// What `keep_mask` has returned. False if it cannot.
    #[inline]
    pub fn stamp(&mut self, mask: u32, rect: IntRect, ink: Ink) -> bool {
        const MAX_SIDE: usize = 1 << 14;
        let source = match u32::from(ink.source) {
            _ if ink.how.clears_backdrop || rect.width().max(rect.height()) > MAX_SIDE => {
                return false;
            }
            SOLID => MASK,
            GRADIENT => SHADED_MASK,
            _ => return false,
        };
        let ink = Ink {
            source: source as u8,
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
            how,
            ..ink
        };
        half.x.min(half.y) > 0.01
            && self.bar(
                corners,
                ink,
                place,
                Some(word(Point::new(part.x, part.y) + half, half)),
            )
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
            let (first, across) = (self.units.len(), (c - b) * 0.5);
            self.units.push((self.words.len() as u32) << 11 | BAR << 8);
            self.words.extend([
                word(a + across, b + across),
                [address, ink.color, rest, stride],
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
        if stroke.cap == Cap::Round
            || !(is_near(from) && is_near(to) && thickness > 0. && thickness < THICK)
        {
            return self.stroke(
                [Command::MoveTo(from), Command::LineTo(to)].into_iter(),
                stroke,
                space,
                ink,
            );
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
            self.covered += self.covered_by_strip(thickness);
            self.units.push((self.words.len() as u32) << 11 | BAR << 8);
            self.words.extend([
                word(from, to),
                [radius.to_bits(), ink.color, rest, space.words << 8],
            ]);
            self.add_step(first, ink, rest);
        }
        self.clear_around(ink, rest);
        true
    }

    #[inline]
    fn covered_by_strip(&self, thickness: f32) -> f32 {
        let [width, height] = [self.clip.width() as f32, self.clip.height() as f32];
        ((width + height) * (thickness + 1.) * 2.).min(width * height)
    }

    /// If it has dashes, the path consists of them. Otherwise, what has no length does not show.
    pub fn stroke(
        &mut self,
        path: impl Iterator<Item = Command>,
        stroke: &Stroke,
        space: Space,
        mut ink: Ink,
    ) -> bool {
        let mut thickness = stroke.width / 2. * space.scale;
        if !(thickness > 0. && thickness < THICK)
            || thickness < 0.5 && u32::from(ink.source) | space.words != 0
        {
            return false;
        }
        if thickness < 0.5 {
            (thickness, ink.color) = (
                0.5,
                u32::from_le_bytes(scale(
                    ink.color.to_le_bytes(),
                    (thickness * 510. + 0.5) as u8,
                )),
            );
        }
        let has_miters = stroke.join == Join::Miter && stroke.miter_limit > 1.;
        let pen = &Pen {
            radius: if space.words == 0 {
                thickness
            } else {
                stroke.width / 2.
            },
            space: space.words,
            cap: stroke.cap,
            is_round: stroke.join == Join::Round,
            least_cosine: if has_miters {
                (2. / (stroke.miter_limit * stroke.miter_limit) - 1.).max(1. / 4096. - 1.)
            } else {
                2.
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
        let (before, mut is_fine, clip, rest) = (
            [self.words.len(), self.units.len()],
            true,
            self.clip,
            self.next_shape(ink),
        );
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
            ends: None,
            first_direction: Point::ZERO,
            at: Point::ZERO,
            direction: Point::ZERO,
        };
        segments(path, |segment| match segment {
            _ if !is_fine => {}
            Err(is_closed) => stroker.end(is_closed),
            Ok((points, is_line)) => {
                is_fine = points.into_iter().all(is_near) && stroker.scene.fits(before);
                if stroker.ends.is_none() {
                    stroker.at = points[0];
                }
                match is_line {
                    _ if has_dots && stroker.ends.is_none() && points == [points[0]; 4] => {
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
        let covered = (self.units.len() - before[1]) as f32 * self.covered_by_strip(thickness);
        if self.keep(is_fine && covered < Self::MAX_COVERED, before) {
            (self.needs_samples, self.covered) = (true, self.covered + covered);
            self.add_solid(before[1], ink, rest);
            self.clear_around(ink, rest);
            return true;
        }
        false
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
        self.words.extend([
            word(curve[0], curve[3]),
            [0, head[0], head[1], count],
            word(curve[1], curve[2]),
            word(center, center),
        ]);
        self.add_units(patch, WEDGE, count);
    }

    pub fn fill(&mut self, path: impl Iterator<Item = Command>, rule: Fill, ink: Ink) -> bool {
        let (before, mut is_fine, rest) = (
            [self.words.len(), self.units.len()],
            true,
            self.next_shape(ink),
        );
        let (mut center, mut contours, mut turns, mut quadrant, mut quadrants) =
            (None, 0, [0f32; 2], 0, 0);
        let (mut low, mut high) = (Point::new(FAR, FAR), Point::new(-FAR, -FAR));
        segments(path, |segment| {
            let Ok((points, is_line)) = segment else {
                return center = None;
            };
            is_fine &= points.into_iter().all(is_near) && self.fits(before);
            contours += u32::from(center.is_none());
            let center = *center.get_or_insert(points[0]);
            let [a, b, c, d] = points.map(|it| it - center);
            if !is_fine || is_line && a.cross(d) == 0. {
                return;
            }
            let all = [
                a.cross(d),
                a.cross(b),
                a.cross(c),
                b.cross(c),
                b.cross(d),
                c.cross(d),
            ];
            for turn in &all[..if is_line { 1 } else { 6 }] {
                turns = [turns[0].min(*turn), turns[1].max(*turn)];
            }
            for point in points.into_iter().chain([center]) {
                (low, high) = (
                    Point::new(low.x.min(point.x), low.y.min(point.y)),
                    Point::new(high.x.max(point.x), high.y.max(point.y)),
                );
            }
            for point in [a, b, c, d]
                .into_iter()
                .filter(|it| rule == Fill::EvenOdd && *it != Point::ZERO)
            {
                let next = 4u32 | u32::from(point.x > 0.) | u32::from(point.y > 0.) << 1;
                quadrants += if quadrant == 0 {
                    0
                } else {
                    (std::mem::replace(&mut quadrant, next) ^ next).count_ones()
                };
                quadrant = next;
            }
            match is_line {
                true => {
                    let patch = self.words.len() as u32;
                    self.words.extend([
                        word(points[0], points[3]),
                        [0, ink.color, rest | IS_LINE, 1],
                        [0; 4],
                        word(center, center),
                    ]);
                    self.units.push(patch << 11 | WEDGE << 8);
                }
                false => self.wedges(points, center, [ink.color, rest]),
            }
        });
        let clip = IntRect::around(Rect {
            x: low.x,
            y: low.y,
            width: high.x - low.x,
            height: high.y - low.y,
        })
        .outset(1)
        .intersect(self.clip);
        let covered = (self.units.len() - before[1]) as f32 * clip.area() as f32;
        if !self.keep(is_fine && covered < Self::MAX_COVERED, before) {
            return false;
        }
        const ROUNDING: f32 = 0.01;
        (self.needs_samples, self.covered) = (true, self.covered + covered);
        if (turns[0] >= -ROUNDING || turns[1] <= ROUNDING)
            && (rule == Fill::NonZero || contours == 1 && quadrants < 4)
        {
            self.add_solid(before[1], ink, rest);
        } else {
            if clip.is_empty() {
                self.units.truncate(before[1]);
            } else {
                let (end, mode) = (
                    self.units.len() as u32,
                    if rule == Fill::NonZero {
                        Mode::CoverNonZero
                    } else {
                        Mode::CoverOdd
                    },
                );
                self.add_cover(clip, ink.color, rest);
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
                    mixing: ink.how.mixing.into(),
                    texture: ink.texture,
                    first: end,
                    end: end + 1,
                    clip,
                });
                self.is_mixed = false;
            }
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
        STATE.lock().0 = State::On;
    }
}
