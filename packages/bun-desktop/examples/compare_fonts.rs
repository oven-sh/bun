//! Compares `text/sfnt` with skrifa and `text/shaper` with harfrust.
//!
//! `cargo run --release --features own-fonts --example compare_fonts -- <fonts or directories>`

#![allow(dead_code, unused_imports)]

#[path = "../src/bun.rs"]
mod bun;
#[path = "../src/gfx.rs"]
mod gfx;
#[path = "../src/small_vec.rs"]
mod small_vec;
#[path = "../src/system_icu.rs"]
mod system_icu;
#[path = "../src/unicode.rs"]
mod unicode;
#[path = "../src/text"]
mod text {
    #[cfg(not(target_os = "macos"))]
    pub mod autohint;
    pub mod sfnt;
    pub mod shaper;
}

mod abi {
    #[derive(Clone, Copy, Debug, Default, PartialEq)]
    pub struct Rect {
        pub x: f32,
        pub y: f32,
        pub width: f32,
        pub height: f32,
    }
}

/// Tells who is right.
#[cfg(target_os = "macos")]
mod core_text {
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};

    type Ref = *const c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    #[link(name = "CoreText", kind = "framework")]
    unsafe extern "C" {
        static kCTFontAttributeName: Ref;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        fn CFRelease(it: Ref);
        fn CFEqual(a: Ref, b: Ref) -> u8;
        fn CFStringCreateWithBytes(
            allocator: Ref,
            bytes: *const u8,
            len: isize,
            encoding: u32,
            is_external: u8,
        ) -> Ref;
        fn CFURLCreateFromFileSystemRepresentation(
            allocator: Ref,
            bytes: *const u8,
            len: isize,
            is_directory: u8,
        ) -> Ref;
        fn CFDictionaryCreate(
            allocator: Ref,
            keys: &Ref,
            values: &Ref,
            count: isize,
            _: Ref,
            _: Ref,
        ) -> Ref;
        fn CFDictionaryGetValue(dictionary: Ref, key: Ref) -> Ref;
        fn CFArrayGetCount(array: Ref) -> isize;
        fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
        fn CFAttributedStringCreate(allocator: Ref, text: Ref, attributes: Ref) -> Ref;
        fn CTFontManagerCreateFontDescriptorsFromURL(url: Ref) -> Ref;
        fn CTFontCreateWithFontDescriptor(descriptor: Ref, size: f64, matrix: Ref) -> Ref;
        fn CTFontCopyPostScriptName(font: Ref) -> Ref;
        fn CTFontGetGlyphsForCharacters(
            font: Ref,
            characters: *const u16,
            glyphs: &mut [u16; 2],
            count: isize,
        ) -> bool;
        fn CTLineCreateWithAttributedString(text: Ref) -> Ref;
        fn CTLineGetGlyphRuns(line: Ref) -> Ref;
        fn CTLineGetTypographicBounds(line: Ref, _: *mut f64, _: *mut f64, _: *mut f64) -> f64;
        fn CTRunGetGlyphCount(run: Ref) -> isize;
        fn CTRunGetAttributes(run: Ref) -> Ref;
        fn CTRunGetGlyphs(run: Ref, range: [isize; 2], to: *mut u16);
        fn CTRunGetPositions(run: Ref, range: [isize; 2], to: *mut [f64; 2]);
    }

    fn string(text: &str) -> Ref {
        unsafe {
            CFStringCreateWithBytes(null(), text.as_ptr(), text.len() as isize, 0x0800_0100, 0)
        }
    }

    fn dictionary(key: Ref, value: Ref) -> Ref {
        unsafe {
            CFDictionaryCreate(
                null(),
                &key,
                &value,
                1,
                &raw const kCFTypeDictionaryKeyCallBacks,
                &raw const kCFTypeDictionaryValueCallBacks,
            )
        }
    }

    pub struct Judge(Ref);

    impl Judge {
        pub fn new(path: &std::path::Path, names: &[String]) -> Option<Judge> {
            let path = path.as_os_str().as_encoded_bytes();
            unsafe {
                let all = CTFontManagerCreateFontDescriptorsFromURL(
                    CFURLCreateFromFileSystemRepresentation(
                        null(),
                        path.as_ptr(),
                        path.len() as isize,
                        0,
                    ),
                );
                let count = if all.is_null() {
                    0
                } else {
                    CFArrayGetCount(all)
                };
                let fonts = (0..count).map(|it| {
                    CTFontCreateWithFontDescriptor(
                        CFArrayGetValueAtIndex(all, it),
                        super::SIZE.into(),
                        null(),
                    )
                });
                let is_named = |it: &Ref| {
                    names
                        .iter()
                        .any(|name| CFEqual(CTFontCopyPostScriptName(*it), string(name)) != 0)
                };
                fonts.filter(|it| !it.is_null()).find(is_named).map(Judge)
            }
        }

        pub fn glyph(&self, character: char) -> u32 {
            let (mut units, mut glyphs) = ([0; 2], [0; 2]);
            let units = character.encode_utf16(&mut units);
            unsafe {
                CTFontGetGlyphsForCharacters(
                    self.0,
                    units.as_ptr(),
                    &mut glyphs,
                    units.len() as isize,
                )
            };
            glyphs[0].into()
        }

        /// `None` if it takes another font.
        pub fn shape(&self, text: &str) -> Option<super::Drawn> {
            unsafe {
                let (text, attributes) = (string(text), dictionary(kCTFontAttributeName, self.0));
                let attributed = CFAttributedStringCreate(null(), text, attributes);
                let line = CTLineCreateWithAttributedString(attributed);
                let (runs, mut drawn, mut is_own) = (CTLineGetGlyphRuns(line), Vec::new(), true);
                for run in (0..CFArrayGetCount(runs)).map(|it| CFArrayGetValueAtIndex(runs, it)) {
                    let count = CTRunGetGlyphCount(run) as usize;
                    let (mut glyphs, mut positions) = (vec![0; count], vec![[0.; 2]; count]);
                    CTRunGetGlyphs(run, [0; 2], glyphs.as_mut_ptr());
                    CTRunGetPositions(run, [0; 2], positions.as_mut_ptr());
                    is_own &= CFEqual(
                        CFDictionaryGetValue(CTRunGetAttributes(run), kCTFontAttributeName),
                        self.0,
                    ) != 0;
                    drawn.extend(
                        glyphs
                            .into_iter()
                            .zip(positions)
                            .map(|(glyph, [x, y])| (u32::from(glyph), [x as f32, y as f32])),
                    );
                }
                drawn.push((
                    super::END,
                    [
                        CTLineGetTypographicBounds(line, null_mut(), null_mut(), null_mut()) as f32,
                        0.,
                    ],
                ));
                [text, attributes, attributed, line]
                    .into_iter()
                    .for_each(|it| CFRelease(it));
                is_own.then_some(drawn)
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod core_text {
    pub struct Judge;

    impl Judge {
        pub fn new(_: &std::path::Path, _: &[String]) -> Option<Judge> {
            None
        }

        pub fn glyph(&self, _: char) -> u32 {
            0
        }

        pub fn shape(&self, _: &str) -> Option<super::Drawn> {
            None
        }
    }
}

use std::collections::BTreeMap;
use std::fmt::Debug;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;

use core_text::Judge;
use gfx::Command;
use skrifa::bitmap::{BitmapData, Origin};
use skrifa::color::{Brush, ColorPainter, CompositeMode};
use skrifa::instance::{Location, Size};
use skrifa::outline::{DrawSettings, pen::PathElement};
use skrifa::{FontRef, GlyphId, MetadataProvider as _};
use text::sfnt::{Font, bitmap, color, variations};
use text::shaper::{Buffer, Direction, Feature, Glyph, Plan, STEPS_PER_UNIT, Shaper, Tables};
use unicode::{Script, category};

const SIZE: f32 = 17.;
const GLYPHS: u32 = 400;
const TEXTS: usize = 40;

const SENTENCES: &str = "The quick brown fox jumps over the lazy dog. AVATAR, Type “office” waffle: 12:30–1/2 (fi fl) Über naïve café déjà Łódź!
fn main() { let x_1 = a->b != c && d <= 0xFF; } // TODO: www @user #42 ~/src | grep -n '$1' \\ [ok] <div/> ...
Съешь же ещё этих мягких французских булок Ξεσκεπάζω την ψυχοφθόρα βδελυγμία Tiếng Việt có dấu
敏捷的棕色狐狸跳过了懒狗。「你好，世界！」 繁體中文測試（括號）、標點… 素早い茶色の狐はのろまな犬を飛び越える。ガギグ パピプ ｶﾞｷﾞ
다람쥐 헌 쳇바퀴에 타고파. 안녕하세요, 세계! 키스의 고유조건은 입술끼리
لقد قام الثعلب البني السريع بالقفز فوق الكلب الكسول مَرْحَبًا بِالعَالَمِ الله لا فارسی گچپژ می‌خواهم اردو
דג סקרן שט בים מאוכזב ולפתע מצא חברה שָׁלוֹם עוֹלָם בְּרֵאשִׁית
तेज़ भूरी लोमड़ी आलसी कुत्ते के ऊपर कूदती है प्रकार्य क्षत्रिय श्री हिन्दी विद्या कर्म द्वारा र्कि ट्र
আমি বাংলায় গান গাই ক্ষমা শ্রী தமிழ் மொழி ஸ்ரீ கொடு తెలుగు భాష శ్రీ ಕನ್ನಡ ಭಾಷೆ ರ್ಕ മലയാളം ഭാഷ ന്റെ ગુજરાતી ભાષા ਪੰਜਾਬੀ ਭਾਸ਼ਾ
เป็นมนุษย์สุดประเสริฐเลิศคุณค่า น้ำ กำลัง ญี่ปุ่น ພາສາລາວ ភាសាខ្មែរ ស្ត្រី မြန်မာဘာသာ සිංහල ශ්‍රී བོད་སྐད አማርኛ ქართული Հայերեն
😀 👍🏽 👨‍👩‍👧‍👦 🇺🇸 🇯🇵 🏳️‍🌈 ❤️ ❤️‍🔥 1️⃣ #️⃣ 👩🏽‍💻 🧑‍🤝‍🧑 👩‍❤️‍👨 🫱🏻‍🫲🏿 🏴󠁧󠁢󠁥󠁮󠁧󠁿 ✅ ⚠️ ☺️ 🙂‍↔️ ⌘ ⌥ ⇧ ⏎ → ✓ • ─│┌┐ ∑ √ ≠";

/// Where each glyph is, in pixels.
type Drawn = Vec<(u32, [f32; 2])>;
const END: u32 = u32::MAX;
type Placed = (u32, u32, i32, [i32; 2]);

fn drawn(font: &Font, glyphs: &[Placed]) -> Drawn {
    let (scale, mut pen) = (
        SIZE / f32::from(font.units_per_em) / STEPS_PER_UNIT as f32,
        0,
    );
    let mut drawn: Drawn = (glyphs.iter())
        .map(|&(glyph, _, advance, [x, y])| {
            pen += advance;
            (
                glyph,
                [(pen - advance + x) as f32 * scale, y as f32 * scale],
            )
        })
        .collect();
    drawn.push((END, [pen as f32 * scale, 0.]));
    drawn
}

fn looks_same(font: &Font, a: &Drawn, b: &Drawn) -> bool {
    let has_ink = |it: u32| {
        it == END
            || it < 0xffff
                && (font.bounds(it, &[]).is_none_or(|it| it.width > 0.)
                    || bitmap::find(font, it, SIZE).is_some())
    };
    let [a, b] = [a, b].map(|it| {
        let mut it: Drawn = it.iter().copied().filter(|it| has_ink(it.0)).collect();
        it.sort_by(|a, b| a.0.cmp(&b.0).then(a.1[0].total_cmp(&b.1[0])));
        it
    });
    a.len() == b.len()
        && a.iter().zip(&b).all(|(a, b)| {
            a.0 == b.0 && (a.1[0] - b.1[0]).abs() < 0.06 && (a.1[1] - b.1[1]).abs() < 0.06
        })
}

#[derive(Default)]
struct Report {
    /// How many were compared, and how many differ.
    totals: BTreeMap<String, [usize; 2]>,
    /// How many differ in the current font, and the shortest example.
    font: BTreeMap<String, (usize, String)>,
    random: u64,
}

impl Report {
    fn note(&mut self, kind: &str, is_same: bool, example: impl FnOnce() -> String) {
        let total = self.totals.entry(kind.to_owned()).or_default();
        *total = [total[0] + 1, total[1] + usize::from(!is_same)];
        if !is_same {
            let (example, entry) = (example(), self.font.entry(kind.to_owned()).or_default());
            entry.0 += 1;
            if entry.0 == 1 || example.len() < entry.1.len() {
                entry.1 = example;
            }
        }
    }

    fn equal<T: Debug + PartialEq>(&mut self, kind: &str, of: impl Debug, ours: T, theirs: T) {
        self.note(kind, ours == theirs, || {
            format!("{of:x?}\n      ours   {ours:?}\n      theirs {theirs:?}")
        });
    }

    fn close(&mut self, kind: &str, of: u32, ours: &[f32], theirs: &[f32], tolerance: f32) {
        let first = ours
            .iter()
            .zip(theirs)
            .position(|(a, b)| (a - b).abs() > tolerance * a.abs().max(1.).sqrt());
        let first = first.or((ours.len() != theirs.len()).then_some(ours.len().min(theirs.len())));
        let around = |it: &[f32]| {
            it.iter()
                .copied()
                .skip(first.unwrap_or(0).saturating_sub(4))
                .take(12)
                .collect::<Vec<_>>()
        };
        self.note(kind, first.is_none(), || {
            format!(
                "glyph {of}\n      ours   {:?}\n      theirs {:?}",
                around(ours),
                around(theirs)
            )
        });
    }

    fn pick<T: Copy>(&mut self, from: &[T]) -> Option<T> {
        from.get(self.below(from.len().max(1))).copied()
    }

    fn below(&mut self, end: usize) -> usize {
        self.random = self
            .random
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.random >> 33) as usize % end
    }
}

/// What is clipped and filled, and where it ends up.
struct Recording {
    transforms: Vec<gfx::Transform>,
    log: Vec<f32>,
    /// Where they are in `log`.
    clips: Vec<std::ops::Range<usize>>,
}

impl Recording {
    fn new() -> Recording {
        Recording {
            transforms: vec![gfx::Transform::identity()],
            log: Vec::new(),
            clips: Vec::new(),
        }
    }

    fn clip(&mut self, kind: f32, values: &[f32]) {
        let start = self.log.len();
        self.add(kind, values);
        self.clips.push(start..self.log.len());
    }

    fn add(&mut self, kind: f32, values: &[f32]) {
        let corner = |x, y| self.transforms[self.transforms.len() - 1].map(gfx::Point::new(x, y));
        let corners = [corner(0., 0.), corner(100., 0.), corner(0., 100.)];
        self.log.extend(
            [kind]
                .into_iter()
                .chain(corners.into_iter().flat_map(|it| [it.x, it.y]))
                .chain(values.iter().copied()),
        );
    }
}

impl color::Painter for Recording {
    fn push_transform(&mut self, by: gfx::Transform) {
        self.transforms
            .push(self.transforms[self.transforms.len() - 1].pre_concat(by));
    }
    fn pop_transform(&mut self) {
        self.transforms.pop();
    }
    fn push_clip_glyph(&mut self, glyph: u32) {
        self.clip(1., &[glyph as f32]);
    }
    fn push_clip_box(&mut self, rect: abi::Rect) {
        self.clip(2., &[rect.x, rect.y, rect.width, rect.height]);
    }
    fn pop_clip(&mut self) {
        match self.clips.pop() {
            Some(unused) if unused.end == self.log.len() => self.log.truncate(unused.start),
            _ => self.log.push(3.),
        }
    }
    fn fill(&mut self, color: u16, alpha: f32) {
        self.log.extend([4., color.into(), alpha]);
    }
    fn fill_gradient(&mut self, shape: color::Shape, stops: &[color::Stop], extend: u8) {
        let mut stops: Vec<_> = stops
            .iter()
            .map(|it| [it.offset, it.color.into(), it.alpha])
            .collect();
        match shape {
            color::Shape::Linear([from, to]) => self.add(5., &[from.x, from.y, to.x, to.y]),
            color::Shape::Radial([(a, from), (b, to)]) => {
                self.add(6., &[a.x, a.y, from, b.x, b.y, to])
            }
            color::Shape::Sweep(center, [start, end]) => {
                self.add(
                    7.,
                    &[
                        center.x,
                        center.y,
                        start.min(end).cos(),
                        start.min(end).sin(),
                        (end - start).abs(),
                    ],
                );
                if end < start {
                    stops = stops
                        .iter()
                        .rev()
                        .map(|it| [1. - it[0], it[1], it[2]])
                        .collect();
                }
            }
        }
        self.log
            .extend(stops.into_iter().flatten().chain([if extend > 2 {
                0.
            } else {
                extend.into()
            }]));
    }
    fn push_layer(&mut self) {
        self.log.push(8.);
    }
    fn pop_layer(&mut self, mode: u8) {
        self.log.extend([9., mode.into()]);
    }
}

impl ColorPainter for Recording {
    fn push_transform(&mut self, by: skrifa::color::Transform) {
        color::Painter::push_transform(
            self,
            gfx::Transform::from_row(by.xx, by.yx, by.xy, by.yy, by.dx, by.dy),
        );
    }
    fn pop_transform(&mut self) {
        self.transforms.pop();
    }
    fn push_clip_glyph(&mut self, glyph: GlyphId) {
        color::Painter::push_clip_glyph(self, glyph.to_u32());
    }
    fn push_clip_box(&mut self, it: skrifa::raw::types::BoundingBox<f32>) {
        self.clip(
            2.,
            &[it.x_min, it.y_min, it.x_max - it.x_min, it.y_max - it.y_min],
        );
    }
    fn pop_clip(&mut self) {
        color::Painter::pop_clip(self);
    }
    fn fill(&mut self, brush: Brush<'_>) {
        let point = |it: skrifa::raw::types::Point<f32>| gfx::Point::new(it.x, it.y);
        let (shape, stops, extend) = match brush {
            Brush::Solid {
                palette_index,
                alpha,
            } => return color::Painter::fill(self, palette_index, alpha),
            Brush::LinearGradient {
                p0,
                p1,
                color_stops,
                extend,
            } => (
                color::Shape::Linear([point(p0), point(p1)]),
                color_stops,
                extend,
            ),
            Brush::RadialGradient {
                c0,
                r0,
                c1,
                r1,
                color_stops,
                extend,
            } => (
                color::Shape::Radial([(point(c0), r0), (point(c1), r1)]),
                color_stops,
                extend,
            ),
            Brush::SweepGradient {
                c0,
                start_angle,
                end_angle,
                color_stops,
                extend,
            } => (
                color::Shape::Sweep(
                    point(c0),
                    [-end_angle.to_radians(), -start_angle.to_radians()],
                ),
                color_stops,
                extend,
            ),
        };
        let mut stops: Vec<_> = stops
            .iter()
            .map(|it| color::Stop {
                offset: it.offset,
                color: it.palette_index,
                alpha: it.alpha,
            })
            .collect();
        if matches!(shape, color::Shape::Sweep(..)) {
            stops = stops
                .iter()
                .rev()
                .map(|it| color::Stop {
                    offset: 1. - it.offset,
                    ..*it
                })
                .collect();
        }
        color::Painter::fill_gradient(self, shape, &stops, extend as u8);
    }
    fn push_layer(&mut self, _: CompositeMode) {
        color::Painter::push_layer(self);
    }
    fn pop_layer_with_mode(&mut self, mode: CompositeMode) {
        color::Painter::pop_layer(self, mode as u8);
    }
}

fn numbers(path: Option<gfx::Path>) -> Vec<f32> {
    let numbers = path.into_iter().flatten().flat_map(|it| match it {
        Command::MoveTo(to) => vec![1000., to.x, to.y],
        Command::LineTo(to) => vec![2000., to.x, to.y],
        Command::QuadTo(a, to) => vec![3000., a.x, a.y, to.x, to.y],
        Command::CurveTo(a, b, to) => vec![4000., a.x, a.y, b.x, b.y, to.x, to.y],
        Command::Close => vec![5000.],
    });
    numbers.collect()
}

fn their_numbers(path: Vec<PathElement>) -> Vec<f32> {
    let numbers = path.into_iter().flat_map(|it| match it {
        PathElement::MoveTo { x, y } => vec![1000., x, y],
        PathElement::LineTo { x, y } => vec![2000., x, y],
        PathElement::QuadTo { cx0, cy0, x, y } => vec![3000., cx0, cy0, x, y],
        PathElement::CurveTo {
            cx0,
            cy0,
            cx1,
            cy1,
            x,
            y,
        } => vec![4000., cx0, cy0, cx1, cy1, x, y],
        PathElement::Close => vec![5000.],
    });
    numbers.collect()
}

#[cfg(not(target_os = "macos"))]
fn compare_hinting(
    report: &mut Report,
    ours: &Font,
    theirs: &FontRef,
    coords: &[i16],
    location: &Location,
) {
    use skrifa::outline::{Engine, HintingInstance, HintingOptions, SmoothMode};
    use text::autohint::{Metrics, Style, Styles};
    let (tables, outlines, mut known) =
        (Tables::new(ours), theirs.outline_glyphs(), BTreeMap::new());
    let styles = Styles::new(ours, tables.layout[0].as_ref());
    for size in [11., 14.5, 16., 33.] {
        let options = HintingOptions {
            engine: Engine::Auto(None),
            target: SmoothMode::Light.into(),
        };
        let Ok(hinter) = HintingInstance::new(&outlines, Size::new(size), location, options) else {
            continue;
        };
        for glyph in (0..ours.glyph_count).step_by(1 + (ours.glyph_count / GLYPHS) as usize) {
            let (mut elements, Some((style, is_mark))) = (Vec::new(), styles.of(glyph)) else {
                continue;
            };
            if outlines.get(glyph.into()).is_some_and(|it| {
                it.draw(DrawSettings::hinted(&hinter, false), &mut elements)
                    .is_ok()
            }) {
                let metrics = known.entry(style).or_insert_with(|| {
                    Metrics::new(ours, tables.layout[0].as_ref(), coords, Style::nth(style))
                });
                report.close(
                    "hinted outlines",
                    glyph,
                    &numbers(metrics.outline(ours, coords, glyph, is_mark, size)),
                    &their_numbers(elements),
                    0.,
                );
            }
        }
    }
}

fn compare_glyphs(
    report: &mut Report,
    ours: &Font,
    theirs: &FontRef,
    coords: &[i16],
    location: &Location,
) {
    let (a, b) = (
        ours.metrics(coords),
        theirs.metrics(Size::unscaled(), location),
    );
    let underline = b.underline.map(|it| (it.offset, it.thickness));
    report.equal(
        "metrics",
        coords,
        (
            a.ascent,
            a.descent,
            a.leading,
            a.x_height,
            a.cap_height,
            a.average_width,
            a.underline,
        ),
        (
            b.ascent,
            b.descent,
            b.leading,
            b.x_height,
            b.cap_height,
            b.average_width,
            underline,
        ),
    );
    let (metrics, outlines, em) = (
        theirs.glyph_metrics(Size::unscaled(), location),
        theirs.outline_glyphs(),
        f32::from(ours.units_per_em),
    );
    for glyph in (0..ours.glyph_count).step_by(1 + (ours.glyph_count / GLYPHS) as usize) {
        report.equal(
            "advances",
            glyph,
            ours.advance(glyph, coords),
            metrics.advance_width(glyph.into()),
        );
        let mut elements = Vec::new();
        if outlines.get(glyph.into()).is_some_and(|it| {
            it.draw(
                DrawSettings::unhinted(Size::new(SIZE), location),
                &mut elements,
            )
            .is_ok()
        }) {
            let (a, b) = (
                numbers(ours.outline(glyph, coords, SIZE / em)),
                their_numbers(elements),
            );
            report.close("outlines, by more than 1/64", glyph, &a, &b, 1.01 / 64.);
            report.close("outlines, by more than 1/16", glyph, &a, &b, 1. / 16.);
        }
        let a = bitmap::find(ours, glyph, SIZE).map(|it| {
            vec![
                it.bounds.x,
                it.bounds.y,
                it.bounds.width,
                it.bounds.height,
                it.advance.unwrap_or(-1.),
            ]
        });
        let b = theirs
            .bitmap_strikes()
            .glyph_for_size(Size::new(SIZE), glyph.into())
            .filter(|it| !matches!(it.data, BitmapData::Mask(_)))
            .map(|it| {
                let (top, height) = (
                    it.bearing_y / em + it.inner_bearing_y / it.ppem_y,
                    it.height as f32 / it.ppem_y,
                );
                let y = if matches!(it.placement_origin, Origin::TopLeft) {
                    -top
                } else {
                    -top - height
                };
                vec![
                    it.bearing_x / em + it.inner_bearing_x / it.ppem_x,
                    y,
                    it.width as f32 / it.ppem_x,
                    height,
                    it.advance.map_or(-1., |by| by / it.ppem_x),
                ]
            });
        if a.is_some() || b.is_some() {
            report.close(
                "bitmaps",
                glyph,
                &a.unwrap_or_default(),
                &b.unwrap_or_default(),
                0.001,
            );
        }
        let (a, b) = (
            color::Drawing::new(ours, glyph, coords),
            theirs.color_glyphs().get(glyph.into()),
        );
        if a.is_some() || b.is_some() {
            let (mut first, mut second) = (Recording::new(), Recording::new());
            if (
                a.and_then(|it| it.paint(&mut first)).is_some(),
                b.is_some_and(|it| it.paint(location, &mut second).is_ok()),
            ) != (false, false)
            {
                report.close("colors", glyph, &first.log, &second.log, 0.02);
            }
        }
    }
}

struct Setup<'a> {
    script: [u8; 4],
    direction: Direction,
    language: &'a str,
    features: Vec<Feature>,
}

fn is_rtl(script: &[u8; 4]) -> bool {
    matches!(
        script,
        b"Arab" | b"Hebr" | b"Syrc" | b"Thaa" | b"Nkoo" | b"Adlm"
    )
}

fn compare_shaping(
    report: &mut Report,
    ours: &Font,
    theirs: &FontRef,
    coords: &[i16],
    location: &Location,
    judge: Option<&Judge>,
) {
    let (tables, data) = (Tables::new(ours), harfrust::ShaperData::new(theirs));
    let instance = harfrust::ShaperInstance::from_coords(theirs, location.coords().iter().copied());
    let shaper = data.shaper(theirs).instance(Some(&instance)).build();
    let compare = |report: &mut Report,
                   Setup {
                       script,
                       direction,
                       language,
                       features,
                   }: Setup,
                   texts: Vec<Vec<char>>,
                   is_real: bool| {
        let their_direction = match direction {
            Direction::Down => harfrust::Direction::TopToBottom,
            Direction::Left => harfrust::Direction::RightToLeft,
            Direction::Right => harfrust::Direction::LeftToRight,
        };
        let their_features: Vec<_> = features
            .iter()
            .map(|it| harfrust::Feature::new(harfrust::Tag::new(&it.tag), it.value, ..))
            .collect();
        let (their_script, their_language) = (
            harfrust::Script::from_iso15924_tag(harfrust::Tag::new(&script)),
            harfrust::Language::new(language.as_bytes()),
        );
        let plan = Plan::new(
            &tables,
            coords,
            Script(script),
            direction,
            language.as_bytes(),
            &features,
        );
        let their_plan = harfrust::ShapePlan::new(
            &shaper,
            their_direction,
            their_script,
            their_language.as_ref(),
            &their_features,
        );
        for text in texts {
            let (mut buffer, mut input) = (Buffer::default(), harfrust::UnicodeBuffer::new());
            for (cluster, character) in (0..).zip(&text) {
                buffer.glyphs.push(Glyph {
                    character: (*character).into(),
                    cluster,
                    ..Glyph::default()
                });
                input.add(*character, cluster);
            }
            input.set_direction(their_direction);
            input.set_flags(harfrust::BufferFlags::REMOVE_DEFAULT_IGNORABLES);
            their_script.inspect(|it| input.set_script(*it));
            their_language
                .iter()
                .for_each(|it| input.set_language(it.clone()));
            let options = harfrust::ShapeOptions::new()
                .plan(Some(&their_plan))
                .features(&their_features)
                .point_size(Some(SIZE));
            let options = options.scale(Some(shaper.units_per_em() * STEPS_PER_UNIT));
            let Ok(shaped) = catch_unwind(AssertUnwindSafe(|| shaper.shape(input, options))) else {
                continue;
            };
            Shaper {
                font: ours,
                tables: &tables,
                coords,
                plan: &plan,
                size: SIZE,
            }
            .shape(&mut buffer);
            let a: Vec<Placed> = buffer
                .glyphs
                .iter()
                .map(|it| (it.id, it.cluster, it.advance[0] - it.advance[1], it.offset))
                .collect();
            let b = shaped.glyph_infos().iter().zip(shaped.glyph_positions());
            let b: Vec<Placed> = b
                .map(|(info, it)| {
                    (
                        info.glyph_id,
                        info.cluster,
                        it.x_advance - it.y_advance,
                        [it.x_offset, it.y_offset],
                    )
                })
                .collect();
            let has_marks = text
                .iter()
                .any(|it| (6..=8).contains(&category::of((*it).into())));
            let kind = match direction {
                _ if is_real => "words",
                _ if (direction == Direction::Down || has_marks)
                    && (ours.table(b"glyf").is_none() || !coords.is_empty()) =>
                {
                    "shaping that harfrust lacks extents for"
                }
                Direction::Down => "shaping, vertical",
                _ if text.iter().any(|it| unicode::is_invisible((*it).into())) => {
                    "shaping, with invisible characters"
                }
                _ if has_marks => "shaping, with marks",
                _ => "shaping",
            };
            let is_plain = features.is_empty() && language.is_empty() && (is_real || a != b);
            let judged = judge
                .filter(|_| is_plain)
                .and_then(|it| it.shape(&String::from_iter(&text)));
            let settings: Vec<_> = features
                .iter()
                .map(|it| (String::from_utf8_lossy(&it.tag), it.value))
                .collect();
            let of = (
                String::from_utf8_lossy(&script),
                direction as u8,
                language,
                settings,
                text.iter().map(|it| u32::from(*it)).collect::<Vec<_>>(),
            );
            if let Some(judged) = judged {
                let (a, b) = (drawn(ours, &a), drawn(ours, &b));
                for (name, is_it) in [
                    ("ours", (true, false)),
                    ("harfrust", (false, true)),
                    ("neither", (false, false)),
                ] {
                    let is_it =
                        is_it == (looks_same(ours, &a, &judged), looks_same(ours, &b, &judged));
                    let example = || {
                        format!(
                            "{of:x?}\n      ours   {a:.2?}\n      theirs {b:.2?}\n      system {judged:.2?}"
                        )
                    };
                    report.note(
                        &format!("{kind}, where Core Text agrees with {name}"),
                        !is_it,
                        example,
                    );
                }
            }
            if std::env::var_os("ALL").is_some() {
                println!("{kind}\t{coords:?}\t{of:?}\t{a:?}\t{b:?}");
            }
            report.equal(kind, of, a, b);
        }
    };
    for word in SENTENCES.lines().flat_map(|it| it.split(' ').chain([it])) {
        let text: Vec<char> = word.chars().collect();
        let mut scripts = text
            .iter()
            .map(|it| Script::of(*it))
            .filter(|it| it.is_specific());
        let script = scripts.next().unwrap_or(Script::COMMON);
        if scripts.all(|it| it == script)
            && text
                .iter()
                .all(|it| unicode::is_invisible((*it).into()) || ours.glyph((*it).into()).is_some())
        {
            let direction = if is_rtl(&script.0) {
                Direction::Left
            } else {
                Direction::Right
            };
            compare(
                report,
                Setup {
                    script: script.0,
                    direction,
                    language: "",
                    features: Vec::new(),
                },
                vec![text],
                true,
            );
        }
    }
    let mut scripts = BTreeMap::<_, Vec<char>>::new();
    for character in theirs
        .charmap()
        .mappings()
        .filter_map(|it| char::from_u32(it.0))
        .filter(|it| category::of((*it).into()) != category::UNASSIGNED)
    {
        scripts
            .entry(Script::of(character).0)
            .or_default()
            .push(character);
    }
    let mut shared = scripts.remove(b"Zinh").unwrap_or_default();
    shared.extend(" 1(.\u{2044}\u{2009}\u{25cc}\u{301}\u{323}\u{200c}\u{200d}\u{fe0f}".chars());
    let mut tags: Vec<_> = tables
        .layout
        .iter()
        .flatten()
        .flat_map(|it| it.features())
        .collect();
    tags.extend(
        [
            b"liga", b"kern", b"smcp", b"onum", b"tnum", b"frac", b"zero", b"dlig", b"ss01",
            b"hwid",
        ]
        .map(|it| *it),
    );
    for (script, characters) in &scripts {
        let marks: Vec<_> = characters
            .iter()
            .copied()
            .filter(|it| (6..=8).contains(&category::of((*it).into())))
            .collect();
        for round in 0..5 {
            let direction = match round {
                4 => Direction::Down,
                _ if is_rtl(script) != (round == 3) => Direction::Left,
                _ => Direction::Right,
            };
            let language = report
                .pick(&[
                    "en", "tr", "ja", "zh-Hant", "sr", "ur", "mr", "ro", "ko", "nl", "fa",
                ])
                .filter(|_| round > 0)
                .unwrap_or("");
            let features = (0..round.min(2) / 2 * 2)
                .filter_map(|_| {
                    Some(Feature {
                        tag: report.pick(&tags)?,
                        value: report.below(2) as u32,
                    })
                })
                .collect();
            let character = |report: &mut Report| match report.below(8) {
                0 => report.pick(&shared),
                1 | 2 if !marks.is_empty() => report.pick(&marks),
                3 | 4 => report.pick(&characters[..characters.len().min(60)]),
                _ => report.pick(characters),
            };
            let texts = (0..TEXTS)
                .map(|_| {
                    (0..1 + report.below(7))
                        .filter_map(|_| character(report))
                        .collect()
                })
                .collect();
            compare(
                report,
                Setup {
                    script: *script,
                    direction,
                    language,
                    features,
                },
                texts,
                false,
            );
        }
    }
}

fn compare(report: &mut Report, path: &Path) {
    if let Ok(entries) = path.read_dir() {
        let mut entries: Vec<_> = entries.flatten().map(|it| it.path()).collect();
        entries.sort();
        return entries.iter().for_each(|it| compare(report, it));
    }
    let Ok(data) = std::fs::read(path).map(|it| &*it.leak()) else {
        return;
    };
    for index in 0..Font::count(data).unwrap_or(1) {
        let Ok(theirs) = FontRef::from_index(data, index) else {
            continue;
        };
        let ours = Font::new(data, index);
        report.equal("fonts", index, ours.is_some(), true);
        let Some(ours) = ours.filter(|it| it.units_per_em > 0) else {
            continue;
        };
        let judge = Judge::new(path, &ours.names(6));
        report.equal(
            "fonts, found by Core Text",
            index,
            judge.is_some(),
            cfg!(target_os = "macos"),
        );
        for code in (0..0x3000).chain((0x3000..0x20000).step_by(7)) {
            let (a, b) = (
                ours.glyph(code),
                theirs
                    .charmap()
                    .map(code)
                    .map(|it| it.to_u32())
                    .filter(|it| *it != 0),
            );
            if let Some((judge, character)) =
                judge.as_ref().zip(char::from_u32(code)).filter(|_| a != b)
            {
                report.equal(
                    "characters that differ, against Core Text",
                    code,
                    a.unwrap_or(0),
                    judge.glyph(character),
                );
            }
            report.equal("characters", code, a, b);
        }
        if std::env::var_os("ALL").is_some() {
            println!("font\t{}\t{index}", path.display());
        }
        let axes = variations::axes(&ours);
        for instance in 0..if axes.is_empty() { 1 } else { 3 } {
            let at = |axis: &variations::Axis| {
                (
                    axis.tag,
                    axis.min + (axis.max - axis.min) * report.below(101) as f32 / 100.,
                )
            };
            let settings: Vec<_> = match instance {
                0 => axes
                    .iter()
                    .filter(|it| it.tag == *b"opsz")
                    .map(|it| (it.tag, SIZE))
                    .collect(),
                _ => axes.iter().map(at).collect(),
            };
            let location = theirs.axes().location(
                settings
                    .iter()
                    .map(|(tag, value)| (skrifa::Tag::new(tag), *value)),
            );
            let (mut coords, own): (Vec<_>, _) = (
                location.coords().iter().map(|it| it.to_bits()).collect(),
                variations::normalize(&ours, &axes, settings.iter().copied()),
            );
            if coords.iter().all(|it| *it == 0) {
                coords.clear();
            }
            let is_close = own.len() == coords.len()
                && own.iter().zip(&coords).all(|(a, b)| a.abs_diff(*b) <= 1);
            report.note("coordinates", is_close, || {
                format!("{settings:?} {own:?} {coords:?}")
            });
            let is_done = catch_unwind(AssertUnwindSafe(|| {
                compare_glyphs(report, &ours, &theirs, &coords, &location);
                #[cfg(not(target_os = "macos"))]
                compare_hinting(report, &ours, &theirs, &coords, &location);
                compare_shaping(
                    report,
                    &ours,
                    &theirs,
                    &coords,
                    &location,
                    judge.as_ref().filter(|_| instance == 0),
                );
            }));
            report.equal("panics", instance, is_done.is_ok(), true);
        }
        let tables = [
            b"glyf", b"CFF ", b"CFF2", b"hvgl", b"GSUB", b"GPOS", b"kern", b"morx", b"mort",
            b"kerx", b"trak", b"ankr", b"sbix", b"COLR", b"fvar",
        ];
        let tables: Vec<_> = tables
            .into_iter()
            .filter(|it| ours.table(it).is_some())
            .map(|it| String::from_utf8_lossy(it))
            .collect();
        let differences = std::mem::take(&mut report.font);
        if !differences.is_empty() {
            println!("{} #{index} [{}]", path.display(), tables.join(" "));
        }
        for (kind, (count, example)) in differences {
            let example = example
                .lines()
                .filter(|_| index == 0 || kind.starts_with("words") || kind == "shaping")
                .map(|it| it.chars().take(200).collect::<String>());
            println!(
                "    {count} {kind}: {}",
                example.collect::<Vec<_>>().join("\n")
            );
        }
    }
}

fn main() {
    system_icu::install();
    let mut report = Report::default();
    std::env::args()
        .skip(1)
        .for_each(|it| compare(&mut report, it.as_ref()));
    report
        .totals
        .iter()
        .for_each(|(kind, [all, differing])| println!("{kind}: {differing} of {all} differ"));
}
