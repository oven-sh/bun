//! Colors.

use core::cell::{Cell, RefCell};
use std::io::Write as _;
use std::rc::Rc;

use bun_css::Token;
use bun_css::css_parser::color::{parse_hash_color, parse_named_color};

use crate::calc::{Inputs, Kind, Node, Options, Unit};
use crate::name::{Map, Name};
use crate::values::*;

keywords! {
    Space {
        Srgb = "srgb", SrgbLinear = "srgb-linear", DisplayP3 = "display-p3", DisplayP3Linear = "display-p3-linear",
        A98Rgb = "a98-rgb", ProphotoRgb = "prophoto-rgb", Rec2020 = "rec2020", XyzD50 = "xyz-d50", XyzD65 = "xyz-d65" | "xyz",
        Lab = "lab", Oklab = "oklab", Lch = "lch", Oklch = "oklch", Hsl = "hsl", Hwb = "hwb",
    }
    Hue { Shorter = "shorter", Longer = "longer", Increasing = "increasing", Decreasing = "decreasing" }
}

type Triple = [f64; 3];
type Matrix = [Triple; 3];

fn times(matrix: &Matrix, v: Triple) -> Triple {
    matrix.map(|row| row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
}

fn inverse(m: &Matrix) -> Matrix {
    let minor = |row: usize, column: usize| {
        let at = |r: usize, c: usize| m[(row + r) % 3][(column + c) % 3];
        at(1, 1) * at(2, 2) - at(1, 2) * at(2, 1)
    };
    let determinant: f64 = (0..3).map(|column| m[0][column] * minor(0, column)).sum();
    core::array::from_fn(|row| core::array::from_fn(|column| minor(column, row) / determinant))
}

const D50: Triple = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];
const D50_TO_D65: Matrix = [
    [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
    [
        -0.0283697093338637,
        1.0099953980813041,
        0.021041441191917323,
    ],
    [
        0.012314014864481998,
        -0.020507649298898964,
        1.330365926242124,
    ],
];
const LMS_TO_XYZ: Matrix = [
    [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
    [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
    [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const OKLAB_TO_LMS: Matrix = [
    [1.0, 0.3963377773761749, 0.2158037573099136],
    [1.0, -0.1055613458156586, -0.0638541728258133],
    [1.0, -0.0894841775298119, -1.2914855480194092],
];
const KAPPA: f64 = 24389.0 / 27.0;
const EPSILON: f64 = 216.0 / 24389.0;

impl Space {
    fn is_predefined(self) -> bool {
        (self as u8) < Space::Lab as u8
    }

    fn hue_index(self) -> Option<usize> {
        match self {
            Space::Lch | Space::Oklch => Some(2),
            Space::Hsl | Space::Hwb => Some(0),
            _ => None,
        }
    }

    /// The one that it is converted through.
    fn base(self) -> Space {
        match self {
            Space::Hsl | Space::Hwb => Space::Srgb,
            Space::Srgb => Space::SrgbLinear,
            Space::Lch => Space::Lab,
            Space::Oklch => Space::Oklab,
            Space::DisplayP3 => Space::DisplayP3Linear,
            Space::Lab | Space::ProphotoRgb => Space::XyzD50,
            _ => Space::XyzD65,
        }
    }

    fn matrix(self) -> Matrix {
        match self {
            Space::SrgbLinear => [
                [506752.0 / 1228815.0, 87881.0 / 245763.0, 12673.0 / 70218.0],
                [87098.0 / 409605.0, 175762.0 / 245763.0, 12673.0 / 175545.0],
                [7918.0 / 409605.0, 87881.0 / 737289.0, 1001167.0 / 1053270.0],
            ],
            Space::DisplayP3Linear => [
                [
                    608311.0 / 1250200.0,
                    189793.0 / 714400.0,
                    198249.0 / 1000160.0,
                ],
                [
                    35783.0 / 156275.0,
                    247089.0 / 357200.0,
                    198249.0 / 2500400.0,
                ],
                [0.0, 32229.0 / 714400.0, 5220557.0 / 5000800.0],
            ],
            Space::A98Rgb => [
                [
                    573536.0 / 994567.0,
                    263643.0 / 1420810.0,
                    187206.0 / 994567.0,
                ],
                [
                    591459.0 / 1989134.0,
                    6239551.0 / 9945670.0,
                    374412.0 / 4972835.0,
                ],
                [
                    53769.0 / 1989134.0,
                    351524.0 / 4972835.0,
                    4929758.0 / 4972835.0,
                ],
            ],
            Space::ProphotoRgb => [
                [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
                [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
                [0.0, 0.0, 0.8251046025104602],
            ],
            Space::Rec2020 => [
                [
                    63426534.0 / 99577255.0,
                    20160776.0 / 139408157.0,
                    47086771.0 / 278816314.0,
                ],
                [
                    26158966.0 / 99577255.0,
                    472592308.0 / 697040785.0,
                    8267143.0 / 139408157.0,
                ],
                [0.0, 19567812.0 / 697040785.0, 295819943.0 / 278816314.0],
            ],
            _ => D50_TO_D65,
        }
    }

    /// The transfer function: where the linear part ends, its slope, the offset and the exponent.
    fn curve(self) -> [f64; 4] {
        match self {
            Space::Srgb | Space::DisplayP3 => [0.0031308, 12.92, 0.055, 2.4],
            Space::A98Rgb => [0.0, 1.0, 0.0, 563.0 / 256.0],
            Space::ProphotoRgb => [1.0 / 512.0, 16.0, 0.0, 1.8],
            _ => [0.018053968510807, 4.5, 0.09929682680944, 1.0 / 0.45],
        }
    }

    fn to_base(self, c: Triple) -> Triple {
        let linear = || {
            let [end, slope, offset, exponent] = self.curve();
            c.map(|v| {
                if v.abs() <= end * slope {
                    v / slope
                } else {
                    ((v.abs() + offset) / (1.0 + offset))
                        .powf(exponent)
                        .copysign(v)
                }
            })
        };
        let pure = |hue: f64, saturation: f64, lightness: f64| {
            [0.0, 8.0, 4.0].map(|n| {
                let k = (n + hue.rem_euclid(360.0) / 30.0) % 12.0;
                lightness
                    - saturation
                        * lightness.min(1.0 - lightness)
                        * (k - 3.0).min(9.0 - k).clamp(-1.0, 1.0)
            })
        };
        match self {
            Space::Hsl => pure(c[0], c[1] / 100.0, c[2] / 100.0),
            Space::Hwb if c[1] + c[2] >= 100.0 => [c[1] / (c[1] + c[2]); 3],
            Space::Hwb => pure(c[0], 1.0, 0.5).map(|v| (v * (100.0 - c[1] - c[2]) + c[1]) / 100.0),
            Space::Lch | Space::Oklch => [
                c[0],
                c[1] * c[2].to_radians().cos(),
                c[1] * c[2].to_radians().sin(),
            ],
            Space::Srgb | Space::DisplayP3 => linear(),
            Space::A98Rgb | Space::ProphotoRgb | Space::Rec2020 => times(&self.matrix(), linear()),
            Space::Oklab => times(&LMS_TO_XYZ, times(&OKLAB_TO_LMS, c).map(|v| v * v * v)),
            Space::Lab => {
                let y = (c[0] + 16.0) / 116.0;
                let f = [c[1] / 500.0 + y, y, y - c[2] / 200.0];
                [0, 1, 2].map(|i| {
                    D50[i]
                        * if f[i].powi(3) > EPSILON {
                            f[i].powi(3)
                        } else {
                            (116.0 * f[i] - 16.0) / KAPPA
                        }
                })
            }
            Space::XyzD65 => c,
            _ => times(&self.matrix(), c),
        }
    }

    fn of_base(self, c: Triple) -> Triple {
        let encoded = |c: Triple| {
            let [end, slope, offset, exponent] = self.curve();
            c.map(|v| {
                if v.abs() <= end {
                    v * slope
                } else {
                    ((1.0 + offset) * v.abs().powf(1.0 / exponent) - offset).copysign(v)
                }
            })
        };
        let (max, min) = (c[0].max(c[1]).max(c[2]), c[0].min(c[1]).min(c[2]));
        let hue = || {
            60.0 * match max - min {
                0.0 => 0.0,
                d if max == c[0] => (c[1] - c[2]) / d + if c[1] < c[2] { 6.0 } else { 0.0 },
                d if max == c[1] => (c[2] - c[0]) / d + 2.0,
                d => (c[0] - c[1]) / d + 4.0,
            }
        };
        match self {
            Space::Hsl => {
                let lightness = (min + max) / 2.0;
                let room = lightness.min(1.0 - lightness);
                let saturation = if room == 0.0 {
                    0.0
                } else {
                    (max - lightness) / room
                };
                let hue = hue() + if saturation < 0.0 { 180.0 } else { 0.0 };
                [hue % 360.0, saturation.abs() * 100.0, lightness * 100.0]
            }
            Space::Hwb => [hue(), min * 100.0, (1.0 - max) * 100.0],
            Space::Lch | Space::Oklch => [
                c[0],
                c[1].hypot(c[2]),
                c[2].atan2(c[1]).to_degrees().rem_euclid(360.0),
            ],
            Space::Srgb | Space::DisplayP3 => encoded(c),
            Space::A98Rgb | Space::ProphotoRgb | Space::Rec2020 => {
                encoded(times(&inverse(&self.matrix()), c))
            }
            Space::Oklab => times(
                &inverse(&OKLAB_TO_LMS),
                times(&inverse(&LMS_TO_XYZ), c).map(f64::cbrt),
            ),
            Space::Lab => {
                let f = [0, 1, 2].map(|i| c[i] / D50[i]).map(|v| {
                    if v > EPSILON {
                        v.cbrt()
                    } else {
                        (KAPPA * v + 16.0) / 116.0
                    }
                });
                [
                    116.0 * f[1] - 16.0,
                    500.0 * (f[0] - f[1]),
                    200.0 * (f[1] - f[2]),
                ]
            }
            Space::XyzD65 => c,
            _ => times(&inverse(&self.matrix()), c),
        }
    }

    fn convert(self, mut c: Triple, to: Space) -> Triple {
        let path = |from: Space| {
            core::iter::successors(Some(from), |it| (*it != Space::XyzD65).then(|| it.base()))
        };
        let mut at = self;
        while !path(to).any(|it| it == at) {
            (c, at) = (at.to_base(c), at.base());
        }
        let down: smallvec::SmallVec<[Space; 4]> = path(to).take_while(|it| *it != at).collect();
        down.iter().rev().fold(c, |c, space| space.of_base(c))
    }

    /// The same letter for components that are analogous.
    fn meanings(self) -> &'static [u8; 3] {
        match self {
            Space::Lab | Space::Oklab => b"lAB",
            Space::Lch | Space::Oklch => b"lch",
            Space::Hsl => b"hcl",
            Space::Hwb => b"hWK",
            _ => b"rgb",
        }
    }

    fn keywords(self) -> &'static [&'static str] {
        match self {
            Space::XyzD50 | Space::XyzD65 => &["x", "y", "z", "alpha"],
            Space::Lab | Space::Oklab => &["l", "a", "b", "alpha"],
            Space::Lch | Space::Oklch => &["l", "c", "h", "alpha"],
            Space::Hsl => &["h", "s", "l", "alpha"],
            Space::Hwb => &["h", "w", "b", "alpha"],
            _ => &["r", "g", "b", "alpha"],
        }
    }

    /// What 100% is.
    fn full(self) -> Triple {
        match self {
            Space::Lab => [100.0, 125.0, 125.0],
            Space::Oklab => [1.0, 0.4, 0.4],
            Space::Lch => [100.0, 150.0, 0.0],
            Space::Oklch => [1.0, 0.4, 0.0],
            Space::Hsl | Space::Hwb => [0.0, 100.0, 100.0],
            _ => [1.0; 3],
        }
    }
}

/// A color in its own space.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Exact {
    space: Space,
    /// Written with `rgb()`, `hsl()`, `hwb()`, a name or hexadecimal digits.
    pub(crate) is_legacy: bool,
    /// A bit for each component. They are 0.
    missing: u8,
    components: [f32; 4],
}

pub(crate) fn pack(channels: [f32; 4]) -> u32 {
    u32::from_be_bytes(channels.map(|it| (it * 255.0).round() as u8))
}

pub(crate) fn mix_colors(from: u32, to: u32, t: f32) -> u32 {
    let [from, to] = [from, to].map(|it| Exact::legacy(it).components);
    let alpha = mix(from[3], to[3], t).clamp(0.0, 1.0);
    if alpha == 0.0 {
        return 0;
    }
    let channel = |i: usize| mix(from[i] * from[3], to[i] * to[3], t) / alpha;
    pack([channel(0), channel(1), channel(2), alpha])
}

impl Exact {
    pub(crate) fn legacy(rgba: u32) -> Exact {
        Exact {
            space: Space::Srgb,
            is_legacy: true,
            missing: 0,
            components: rgba.to_be_bytes().map(|it| f32::from(it) / 255.0),
        }
    }

    fn lacks(&self, index: usize) -> bool {
        self.missing >> index & 1 != 0
    }

    fn triple(&self, space: Space) -> Triple {
        self.space
            .convert([0, 1, 2].map(|i| self.components[i].into()), space)
    }

    pub(crate) fn rgba(&self) -> u32 {
        let [r, g, b] = self.triple(Space::Srgb).map(|it| (it + 1e-7) as f32);
        pack([r, g, b, self.components[3]])
    }

    fn converted(&self, space: Space) -> Exact {
        if space == self.space {
            return Exact {
                is_legacy: false,
                ..*self
            };
        }
        let (c, from, to) = (self.triple(space), self.space.meanings(), space.meanings());
        let mut missing = self.missing & 8;
        for index in 0..3 {
            missing |= u8::from((0..3).any(|it| self.lacks(it) && from[it] == to[index])) << index;
        }
        let is_like = |a, b, c, d| {
            [self.space, space].map(|it| (it == a || it == b, it == c || it == d))
                == [(true, false), (false, true)]
        };
        if self.missing & 7 == 7 {
            missing |= 7;
        } else if self.missing & 6 == 6
            && (self.space.base() == space.base() && space.base() == Space::Srgb
                || is_like(Space::Lab, Space::Oklab, Space::Lch, Space::Oklch)
                || is_like(Space::Lch, Space::Oklch, Space::Lab, Space::Oklab))
        {
            missing |= 6;
        }
        let is_gray = match space {
            Space::Hsl => c[1] <= 0.001,
            Space::Hwb => c[1] + c[2] >= 99.999,
            Space::Lch => c[1] <= 0.0015,
            _ => c[1] <= 0.000004,
        };
        missing |= space
            .hue_index()
            .filter(|_| is_gray)
            .map_or(0, |it| 1 << it);
        let components = [c[0] as f32, c[1] as f32, c[2] as f32, self.components[3]];
        Exact {
            space,
            is_legacy: false,
            missing,
            components,
        }
        .normalized()
    }

    fn normalized(mut self) -> Exact {
        (0..4)
            .filter(|it| self.missing >> it & 1 != 0)
            .for_each(|it| self.components[it] = 0.0);
        self
    }

    fn write(&self, out: &mut Out) {
        if self.is_legacy {
            return write_rgba(self.rgba(), out);
        }
        if matches!(self.space, Space::Hsl | Space::Hwb) {
            return Exact {
                missing: 0,
                ..*self
            }
            .converted(Space::Srgb)
            .write(out);
        }
        open(self.space, false, out);
        for index in 0..4 {
            if index == 3 && self.components[3] == 1.0 {
                break;
            }
            out.extend_from_slice([&b""[..], b" ", b" ", b" / "][index]);
            match self.lacks(index) {
                true => out.extend_from_slice(b"none"),
                false => crate::values::write_channel(self.components[index].into(), out),
            }
        }
        out.push(b')');
    }
}

fn open(space: Space, is_rgb: bool, out: &mut Out) {
    let _ = match space.is_predefined() {
        _ if is_rgb => write!(out, "rgb("),
        true => write!(out, "color({} ", space.name()),
        false => write!(out, "{}(", space.name()),
    };
}

pub(crate) fn write_rgba(rgba: u32, out: &mut Out) {
    let [r, g, b, a] = rgba.to_be_bytes();
    if a == 255 {
        let _ = write!(out, "rgb({r}, {g}, {b})");
        return;
    }
    let _ = write!(out, "rgba({r}, {g}, {b}, ");
    let alpha = f32::from(a) / 255.0;
    let short = (alpha * 100.0).round() / 100.0;
    write_number(
        if (short * 255.0).round() as u8 == a {
            short
        } else {
            (alpha * 1000.0).round() / 1000.0
        },
        out,
    );
    out.push(b')');
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Interpolation {
    space: Space,
    hue: Hue,
}

impl Interpolation {
    pub(crate) const SRGB: Interpolation = Interpolation {
        space: Space::Srgb,
        hue: Hue::Shorter,
    };
    pub(crate) const OKLAB: Interpolation = Interpolation {
        space: Space::Oklab,
        hue: Hue::Shorter,
    };

    pub(crate) fn parse(p: &mut P) -> Option<Interpolation> {
        attempt(p, |p| {
            keyword(p, "in").then_some(())?;
            let space = Space::from_name(ident(p)?)?;
            let hue = space.hue_index().and_then(|_| {
                attempt(p, |p| {
                    Hue::from_name(ident(p)?).filter(|_| keyword(p, "hue"))
                })
            });
            Some(Interpolation {
                space,
                hue: hue.unwrap_or(Hue::Shorter),
            })
        })
    }

    pub(crate) fn write(self, out: &mut Out) {
        let _ = write!(out, "in {}", self.space.name());
        if self.hue != Hue::Shorter {
            let _ = write!(out, " {} hue", self.hue.name());
        }
    }

    pub(crate) fn is_polar(self) -> bool {
        self.space.hue_index().is_some()
    }

    pub(crate) fn mix(self, from: &Exact, to: &Exact, t: f32) -> Exact {
        let (mut a, mut b) = (from.converted(self.space), to.converted(self.space));
        for index in 0..4 {
            match (a.lacks(index), b.lacks(index)) {
                (true, false) => a.components[index] = b.components[index],
                (false, true) => b.components[index] = a.components[index],
                _ => {}
            }
        }
        let (missing, hue) = (a.missing & b.missing, self.space.hue_index());
        let (mut a, mut b) = (a.components, b.components);
        if missing & 8 != 0 {
            (a[3], b[3]) = (1.0, 1.0);
        }
        if let Some(hue) = hue {
            match (self.hue, b[hue] - a[hue]) {
                (Hue::Shorter, d) if d > 180.0 => a[hue] += 360.0,
                (Hue::Shorter, d) if d < -180.0 => b[hue] += 360.0,
                (Hue::Longer, d) if d > 0.0 && d < 180.0 => a[hue] += 360.0,
                (Hue::Longer, d) if d > -180.0 && d <= 0.0 => b[hue] += 360.0,
                (Hue::Increasing, d) if d < 0.0 => b[hue] += 360.0,
                (Hue::Decreasing, d) if d > 0.0 => a[hue] += 360.0,
                _ => {}
            }
        }
        let alpha = mix(a[3], b[3], t).clamp(0.0, 1.0);
        let components = [0, 1, 2, 3].map(|i| match () {
            () if i == 3 => alpha,
            () if Some(i) == hue => mix(a[i], b[i], t).rem_euclid(360.0),
            () if alpha == 0.0 => mix(a[i] * a[3], b[i] * b[3], t),
            () => mix(a[i] * a[3], b[i] * b[3], t) / alpha,
        });
        let mut components = components;
        if let Some(most) = match self.space {
            Space::Lab | Space::Lch => Some(100.0),
            Space::Oklab | Space::Oklch => Some(1.0),
            _ => None,
        } {
            components[0] = components[0].clamp(0.0, most);
            components[1] = if hue.is_some() {
                components[1].max(0.0)
            } else {
                components[1]
            };
        }
        Exact {
            space: self.space,
            is_legacy: false,
            missing,
            components,
        }
        .normalized()
    }
}

/// Light and dark.
const SYSTEM: &[(&str, u32, u32)] = &[
    ("activetext", 0xff0000ff, 0xff0000ff),
    (
        "buttonface buttonhighlight buttonshadow threedface",
        0xefefefff,
        0x6b6b6bff,
    ),
    ("field", 0xffffffff, 0x3b3b3bff),
    ("graytext inactivecaptiontext", 0x808080ff, 0x808080ff),
    ("highlight", 0x0041c6cc, 0x0041c6cc),
    ("highlighttext accentcolortext", 0xffffffff, 0xffffffff),
    ("linktext -webkit-link", 0x0000eeff, 0x9e9effff),
    ("-webkit-activelink", 0xff0000ff, 0xff9e9eff),
    ("-webkit-focus-ring-color", 0x101010ff, 0xffffffff),
    ("mark", 0xffff00ff, 0xffff00ff),
    ("marktext", 0xff, 0xff),
    ("selecteditem", 0x1967d2ff, 0x99c8ffff),
    ("selecteditemtext", 0xffffffff, 0x3b3b3bff),
    ("visitedtext", 0x551a8bff, 0xd0adf0ff),
    (
        "canvas activecaption appworkspace background inactivecaption infobackground menu scrollbar window",
        0xffffffff,
        0x121212ff,
    ),
    (
        "canvastext buttontext buttonborder fieldtext activeborder captiontext inactiveborder infotext menutext threeddarkshadow \
        threedhighlight threedlightshadow threedshadow windowframe windowtext",
        0xff,
        0xffffffff,
    ),
];

/// A channel as it is written. `Node::None` is `none`.
type Channels = [Node; 3];

#[derive(Clone)]
pub(crate) enum Specified {
    Current,
    Keyword(Box<[u8]>),
    Exact(Exact),
    Function {
        space: Space,
        is_rgb: bool,
        origin: Option<Specified2>,
        channels: Channels,
        alpha: Option<Node>,
    },
    Mix(Interpolation, Vec<(Specified, Option<Node>)>),
    LightDark(Specified2, Specified2),
    Contrast(Specified2),
    Alpha(Specified2, Node),
}
type Specified2 = Box<Specified>;

fn keyword_value(name: &[u8], cx: &Ctx) -> Option<u32> {
    if let Some((r, g, b)) = parse_named_color(name) {
        return Some(u32::from_be_bytes([r, g, b, 255]));
    }
    if eq(name, "transparent") {
        return Some(0);
    }
    cx.uses(Deps::INHERITED | Deps::VIEWPORT);
    match () {
        () if eq(name, "accentcolor") => Some(cx.accent),
        () => {
            let found = SYSTEM
                .iter()
                .find(|it| it.0.split_ascii_whitespace().any(|it| eq(name, it)));
            found.map(|it| if cx.dark { it.2 } else { it.1 })
        }
    }
}

fn channel(p: &mut P, keywords: &'static [&'static str], second: Kind) -> Option<Node> {
    if keyword(p, "none") {
        return Some(Node::None);
    }
    let of = |p: &mut P, kind| {
        Node::parse(
            p,
            &Options {
                keywords,
                ..Options::new(kind)
            },
        )
    };
    Some(
        of(p, Kind::Number)
            .or_else(|| of(p, second))?
            .as_specified(true),
    )
}

fn is_constant(node: &Node) -> bool {
    match node {
        Node::Sum(all) => matches!(all[..], [Node::Value(..)]),
        node => matches!(node, Node::Value(..) | Node::None),
    }
}

impl Specified {
    pub(crate) fn parse(p: &mut P) -> Option<Specified> {
        Specified::parse_at(p, 0)
    }

    fn parse_at(p: &mut P, depth: u8) -> Option<Specified> {
        (depth < 32).then_some(())?;
        attempt(p, |p| match *p.next().ok()? {
            Token::IdHash(digits) | Token::UnrestrictedHash(digits) => {
                let it = parse_hash_color(digits)?;
                Some(Specified::Exact(Exact::legacy(u32::from_be_bytes([
                    it.red, it.green, it.blue, it.alpha,
                ]))))
            }
            Token::Ident(name) if eq(name, "currentcolor") => Some(Specified::Current),
            Token::Ident(name) => keyword_value(name, &Ctx::dummy())
                .map(|_| Specified::Keyword(name.to_ascii_lowercase().into())),
            Token::Function(name) => nested(p, |p| Specified::function(name, p, depth + 1)),
            _ => None,
        })
    }

    fn function(name: &[u8], p: &mut P, depth: u8) -> Option<Specified> {
        let color = |p: &mut P| Specified::parse_at(p, depth).map(Box::new);
        if eq(name, "color-mix") {
            let method = match Interpolation::parse(p) {
                Some(method) => comma(p).then_some(method)?,
                None => Interpolation::OKLAB,
            };
            let share = |p: &mut P| {
                Node::parse(p, &Options::new(Kind::Percentage)).map(|it| it.as_specified(true))
            };
            return Some(Specified::Mix(
                method,
                commas(p, |p| {
                    let before = share(p);
                    let (color, share) = (*color(p)?, before.or_else(|| share(p)));
                    (!matches!(share, Some(Node::Value(value, _)) if !(0.0..=100.0).contains(&value))).then_some((color, share))
                })?,
            ));
        }
        if eq(name, "light-dark") {
            return Some(Specified::LightDark(
                color(p)?,
                comma(p).then(|| color(p))??,
            ));
        }
        if eq(name, "contrast-color") {
            return color(p).map(Specified::Contrast);
        }
        let origin = if keyword(p, "from") {
            Some(color(p)?)
        } else {
            None
        };
        if eq(name, "alpha") {
            return Some(Specified::Alpha(
                origin?,
                delim(p, b'/').then(|| channel(p, &["alpha"], Kind::Percentage))??,
            ));
        }
        let is_rgb = eq(name, "rgb") || eq(name, "rgba");
        let space = match () {
            () if is_rgb => Space::Srgb,
            () if eq(name, "color") => {
                Space::from_name(ident(p)?).filter(|it| it.is_predefined())?
            }
            () if eq(name, "hsla") => Space::Hsl,
            () => Space::from_name(name).filter(|it| !it.is_predefined())?,
        };
        let keywords = if origin.is_some() {
            space.keywords()
        } else {
            &[]
        };
        let next = |p: &mut P, index| {
            channel(
                p,
                keywords,
                if space.hue_index() == Some(index) {
                    Kind::Angle
                } else {
                    Kind::Percentage
                },
            )
        };
        let first = next(p, 0)?;
        let has_commas = origin.is_none() && (is_rgb || space == Space::Hsl) && comma(p);
        let second = next(p, 1)?;
        (!has_commas || comma(p)).then_some(())?;
        let channels = [first, second, next(p, 2)?];
        let alpha = if has_commas && comma(p) || !has_commas && delim(p, b'/') {
            Some(next(p, 3)?)
        } else {
            None
        };
        if has_commas {
            let is_percentage = channels.each_ref().map(Node::has_percentage);
            let expected = if is_rgb {
                [is_percentage[0]; 3]
            } else {
                [false, true, true]
            };
            (is_percentage == expected
                && !channels.iter().chain(&alpha).any(|it| *it == Node::None))
            .then_some(())?;
        }
        let is_legacy = is_rgb || matches!(space, Space::Hsl | Space::Hwb);
        let is_final = |it: &Node| {
            if is_legacy {
                is_constant(it)
            } else {
                it.is_literal()
            }
        };
        let is_final = origin.is_none() && channels.iter().chain(&alpha).all(is_final);
        let color = Specified::Function {
            space,
            is_rgb,
            origin,
            channels,
            alpha,
        };
        Some(if is_final {
            Specified::Exact(color.resolve(&Ctx::dummy(), None)?)
        } else {
            color
        })
    }

    /// `None` if it takes `currentcolor`, and that is not known.
    fn resolve(&self, cx: &Ctx, current: Option<&Exact>) -> Option<Exact> {
        let evaluate = |node: &Node, basis: f64, keywords: &[f64]| {
            let value = node.simplified(Some(cx), true).evaluate(&Inputs {
                basis,
                keywords,
                anchor: &|_| None,
            });
            value.filter(|it| !it.is_nan()).unwrap_or(0.0)
        };
        Some(match self {
            Specified::Current => *current?,
            Specified::Exact(exact) => *exact,
            Specified::Keyword(name) => Exact::legacy(keyword_value(name, cx)?),
            Specified::LightDark(light, dark) => {
                cx.uses(Deps::INHERITED);
                if cx.dark { dark } else { light }.resolve(cx, current)?
            }
            Specified::Contrast(color) => {
                let luminance = color.resolve(cx, current)?.triple(Space::XyzD65)[1] + 0.05;
                Exact::legacy(if 1.05 / luminance >= luminance / 0.05 {
                    0xffff_ffff
                } else {
                    0xff
                })
            }
            Specified::Alpha(origin, alpha) => {
                let mut color = Exact {
                    is_legacy: false,
                    ..origin.resolve(cx, current)?
                };
                color.components[3] =
                    evaluate(alpha, 1.0, &[color.components[3].into()]).clamp(0.0, 1.0) as f32;
                color.missing = u8::from(*alpha == Node::None) << 3;
                color.normalized()
            }
            Specified::Mix(method, items) => {
                let shares: Vec<_> = items
                    .iter()
                    .map(|it| Some(evaluate(it.1.as_ref()?, 1.0, &[]).clamp(0.0, 1.0) as f32))
                    .collect();
                let rest = (1.0 - shares.iter().flatten().sum::<f32>()).max(0.0)
                    / shares.iter().filter(|it| it.is_none()).count().max(1) as f32;
                let (mut mixed, mut total) = (
                    items[0].0.resolve(cx, current)?.converted(method.space),
                    shares[0].unwrap_or(rest),
                );
                for (item, share) in items.iter().zip(&shares).skip(1) {
                    total += share.unwrap_or(rest);
                    let t = if total > 0.0 {
                        share.unwrap_or(rest) / total
                    } else {
                        0.5
                    };
                    mixed = method.mix(&mixed, &item.0.resolve(cx, current)?, t);
                }
                mixed.components[3] *= total.min(1.0);
                mixed
            }
            Specified::Function {
                space,
                is_rgb,
                origin,
                channels,
                alpha,
            } => {
                let origin = match origin {
                    Some(origin) => Some(origin.resolve(cx, current)?.converted(*space)),
                    None => None,
                };
                let scale = if *is_rgb { 255.0 } else { 1.0 };
                let keywords = origin.map_or([0.0; 4], |it| {
                    [0, 1, 2, 3]
                        .map(|i| f64::from(it.components[i]) * if i < 3 { scale } else { 1.0 })
                });
                let mut c = [0, 1, 2]
                    .map(|i| evaluate(&channels[i], space.full()[i] * scale, &keywords) / scale);
                let is_legacy =
                    origin.is_none() && (*is_rgb || matches!(space, Space::Hsl | Space::Hwb));
                if let Some(hue) = space.hue_index() {
                    c[hue] = if c[hue].is_finite() {
                        c[hue].rem_euclid(360.0)
                    } else {
                        0.0
                    };
                }
                match space {
                    Space::Lab | Space::Oklab => c[0] = c[0].clamp(0.0, space.full()[0]),
                    Space::Lch | Space::Oklch => {
                        (c[0], c[1]) = (c[0].clamp(0.0, space.full()[0]), c[1].max(0.0))
                    }
                    Space::Hsl | Space::Hwb if is_legacy => {
                        (c[1], c[2]) = (c[1].clamp(0.0, 1e9), c[2].clamp(0.0, 1e9))
                    }
                    Space::Hsl => c[1] = c[1].max(0.0),
                    _ if is_legacy => c = c.map(|it| it.clamp(0.0, 1.0)),
                    _ => {}
                }
                let mut missing =
                    (0..3).fold(0, |all, i| all | u8::from(channels[i] == Node::None) << i);
                let alpha = match (alpha, &origin) {
                    (Some(alpha), _) => {
                        missing |= u8::from(*alpha == Node::None) << 3;
                        evaluate(alpha, 1.0, &keywords).clamp(0.0, 1.0) as f32
                    }
                    (None, Some(origin)) => origin.components[3],
                    (None, None) => 1.0,
                };
                Exact {
                    space: *space,
                    is_legacy,
                    missing,
                    components: [c[0] as f32, c[1] as f32, c[2] as f32, alpha],
                }
                .normalized()
            }
        })
    }

    /// With everything resolved but `currentcolor`.
    fn computed(&self, cx: &Ctx) -> Specified {
        if let Some(exact) = self.resolve(cx, None) {
            return Specified::Exact(exact);
        }
        let color = |it: &Specified| Box::new(it.computed(cx));
        let node = |it: &Node| {
            if it.is_literal() {
                it.clone()
            } else {
                Node::Sum(vec![it.simplified(Some(cx), true)])
            }
        };
        match self {
            Specified::LightDark(light, dark) => if cx.dark { dark } else { light }.computed(cx),
            Specified::Contrast(it) => Specified::Contrast(color(it)),
            Specified::Alpha(origin, alpha) => Specified::Alpha(color(origin), node(alpha)),
            Specified::Mix(method, items) => Specified::Mix(
                *method,
                items
                    .iter()
                    .map(|it| (it.0.computed(cx), it.1.as_ref().map(node)))
                    .collect(),
            ),
            Specified::Function {
                space,
                is_rgb,
                origin,
                channels,
                alpha,
            } => Specified::Function {
                space: *space,
                is_rgb: *is_rgb,
                origin: origin.as_deref().map(color),
                channels: channels.each_ref().map(node),
                alpha: alpha.as_ref().map(node),
            },
            _ => Specified::Current,
        }
    }

    pub(crate) fn write(&self, out: &mut Out) {
        let channel = |it: &Node, out: &mut Out| {
            if *it == Node::None {
                out.extend_from_slice(b"none")
            } else {
                it.write_specified(out)
            }
        };
        match self {
            Specified::Current => return out.extend_from_slice(b"currentcolor"),
            Specified::Keyword(name) => return out.extend_from_slice(name),
            Specified::Exact(exact) => return exact.write(out),
            Specified::LightDark(light, dark) => {
                out.extend_from_slice(b"light-dark(");
                write_list(&[light, dark], ", ", out, |it, out| it.write(out));
            }
            Specified::Contrast(color) => {
                out.extend_from_slice(b"contrast-color(");
                color.write(out);
            }
            Specified::Alpha(origin, alpha) => {
                out.extend_from_slice(b"alpha(from ");
                origin.write(out);
                out.extend_from_slice(b" / ");
                channel(alpha, out);
            }
            Specified::Mix(method, items) => {
                out.extend_from_slice(b"color-mix(");
                if *method != Interpolation::OKLAB {
                    method.write(out);
                    out.extend_from_slice(b", ");
                }
                let literal = |it: &Option<Node>| {
                    if let Some(Node::Value(value, _)) = it {
                        Some(*value)
                    } else {
                        None
                    }
                };
                let are_literal = items
                    .iter()
                    .all(|it| it.1.as_ref().is_none_or(Node::is_literal));
                let omitted = items.iter().filter(|it| it.1.is_none()).count().max(1) as f64;
                let rest = (100.0 - items.iter().filter_map(|it| literal(&it.1)).sum::<f64>())
                    .max(0.0)
                    / omitted;
                let are_even = items
                    .iter()
                    .all(|it| literal(&it.1).unwrap_or(rest) == 100.0 / items.len() as f64);
                write_list(items, ", ", out, |(color, share), out| {
                    color.write(out);
                    let filled = Node::Value(rest, Unit::Percent);
                    if let Some(share) = share
                        .as_ref()
                        .or_else(|| are_literal.then_some(&filled))
                        .filter(|_| !are_literal || !are_even)
                    {
                        out.push(b' ');
                        share.write_specified(out);
                    }
                });
            }
            Specified::Function {
                space,
                is_rgb,
                origin: Some(origin),
                channels,
                alpha,
            } => {
                match space.is_predefined() && !is_rgb {
                    true => out.extend_from_slice(b"color("),
                    false => open(*space, *is_rgb, out),
                }
                out.extend_from_slice(b"from ");
                origin.write(out);
                if space.is_predefined() && !is_rgb {
                    let _ = write!(out, " {}", space.name());
                }
                out.push(b' ');
                write_list(channels, " ", out, channel);
                if let Some(alpha) = alpha {
                    out.extend_from_slice(b" / ");
                    channel(alpha, out);
                }
            }
            Specified::Function {
                space,
                is_rgb,
                channels,
                alpha,
                ..
            } => {
                open(*space, *is_rgb, out);
                let resolved = self
                    .resolve(&Ctx::dummy(), None)
                    .map_or([0.0; 4], |it| it.components);
                for (index, it) in channels
                    .iter()
                    .chain(alpha)
                    .enumerate()
                    .filter(|it| it.0 < 3 || !it.1.is_literal() || resolved[3] != 1.0)
                {
                    out.extend_from_slice([&b""[..], b" ", b" ", b" / "][index]);
                    match it {
                        Node::Value(..) => write_number(
                            resolved[index] * if *is_rgb && index < 3 { 255.0 } else { 1.0 },
                            out,
                        ),
                        it => channel(it, out),
                    }
                }
            }
        }
        out.push(b')');
    }

    pub(crate) fn is_legacy(&self) -> bool {
        match self {
            Specified::Exact(exact) => exact.is_legacy,
            Specified::LightDark(light, dark) => light.is_legacy() && dark.is_legacy(),
            other => matches!(other, Specified::Current | Specified::Keyword(_)),
        }
    }

    pub(crate) fn compute(&self, cx: &Ctx) -> Color {
        match self.computed(cx) {
            Specified::Current => Color::Current,
            Specified::Exact(exact) => Color::new(exact, false),
            pending => PALETTE.with_borrow_mut(|it| it.add_pending(pending)),
        }
    }
}

/// What a `Color` is too small for.
#[derive(Default)]
struct Palette {
    exact: Vec<Exact>,
    index: Map<[u32; 5], u16>,
    /// Of animations. The oldest are overwritten.
    passing: Vec<Exact>,
    next: usize,
    /// With the last value of `currentcolor`, and the result.
    pending: Vec<Rc<(Specified, Cell<(u32, u32)>)>>,
    pending_index: Map<Name, u32>,
}

const FIRST_PASSING: usize = 0xf000;
const NOT_EXACT: u16 = u16::MAX;

impl Palette {
    fn add(&mut self, exact: Exact, is_passing: bool) -> u16 {
        let [a, b, c, d] = exact.components.map(f32::to_bits);
        let key = [
            u32::from_le_bytes([exact.space as u8, exact.missing, exact.is_legacy.into(), 0]),
            a,
            b,
            c,
            d,
        ];
        if let Some(known) = self.index.get(&key) {
            return *known;
        }
        if !is_passing && self.exact.len() < FIRST_PASSING {
            self.index.insert(key, self.exact.len() as u16);
            self.exact.push(exact);
            return self.exact.len() as u16 - 1;
        }
        let at = self.next;
        self.next = (at + 1) % (usize::from(NOT_EXACT) - FIRST_PASSING);
        match self.passing.get_mut(at) {
            Some(old) => *old = exact,
            None => self.passing.push(exact),
        }
        (FIRST_PASSING + at) as u16
    }

    fn get(&self, rgba: u32, index: u16) -> Exact {
        match usize::from(index).checked_sub(FIRST_PASSING) {
            None => self.exact[usize::from(index)],
            Some(at) => (self.passing.get(at).copied().filter(|it| it.rgba() == rgba))
                .unwrap_or_else(|| Exact {
                    is_legacy: false,
                    ..Exact::legacy(rgba)
                }),
        }
    }

    fn add_pending(&mut self, color: Specified) -> Color {
        let mut source = Out::new();
        color.write(&mut source);
        if self.pending.len() >= 1 << 16 && !self.pending_index.contains_key(&Name::new(&source)) {
            return Color::Current;
        }
        Color::Pending(
            *self
                .pending_index
                .entry(Name::new(&source))
                .or_insert_with(|| {
                    let black = color
                        .resolve(&Ctx::dummy(), Some(&Exact::legacy(0xff)))
                        .map_or(0, |it| it.rgba());
                    self.pending
                        .push(Rc::new((color, Cell::new((0xff, black)))));
                    self.pending.len() as u32 - 1
                }),
        )
    }
}

thread_local! {
    static PALETTE: RefCell<Palette> = RefCell::default();
    static CURRENT_COLOR: Cell<Option<Rgba>> = const { Cell::new(None) };
}

/// Lets `write` and `lerp` resolve `currentcolor`.
pub(crate) fn with_current_color<R>(color: Rgba, run: impl FnOnce() -> R) -> R {
    let outer = CURRENT_COLOR.replace(Some(color));
    let result = run();
    CURRENT_COLOR.set(outer);
    result
}

/// For what is written once and kept.
pub(crate) fn without_current_color<R>(run: impl FnOnce() -> R) -> R {
    let outer = CURRENT_COLOR.take();
    let result = run();
    CURRENT_COLOR.set(outer);
    result
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Color {
    Current,
    /// `0xRRGGBBAA`
    Rgba(u32),
    /// With an index into the palette.
    Exact(u32, u16),
    /// A function of `currentcolor`.
    Pending(u32),
}

impl Color {
    pub(crate) const TRANSPARENT: Color = Color::Rgba(0);

    fn new(exact: Exact, is_passing: bool) -> Color {
        match exact.is_legacy && exact.missing == 0 {
            true => Color::Rgba(exact.rgba()),
            false => Color::Exact(
                exact.rgba(),
                PALETTE.with_borrow_mut(|it| it.add(exact, is_passing)),
            ),
        }
    }

    pub(crate) fn resolve(self, current: u32) -> u32 {
        match self {
            Color::Current => current,
            Color::Rgba(rgba) | Color::Exact(rgba, _) => rgba,
            Color::Pending(index) => PALETTE.with_borrow(|it| {
                let (color, last) = &*it.pending[index as usize];
                if last.get().0 != current {
                    last.set((
                        current,
                        color
                            .resolve(&Ctx::dummy(), Some(&Exact::legacy(current)))
                            .map_or(0, |it| it.rgba()),
                    ));
                }
                last.get().1
            }),
        }
    }

    pub(crate) fn uses_current(self) -> bool {
        matches!(self, Color::Current | Color::Pending(_))
    }

    pub(crate) fn exact(self, current: Option<Rgba>) -> Option<Exact> {
        match self {
            Color::Current => current?.color().exact(None),
            Color::Rgba(rgba) => Some(Exact::legacy(rgba)),
            Color::Exact(rgba, index) => Some(PALETTE.with_borrow(|it| it.get(rgba, index))),
            Color::Pending(index) => {
                let current = current?.color().exact(None);
                PALETTE.with_borrow(|it| {
                    it.pending[index as usize]
                        .0
                        .resolve(&Ctx::dummy(), current.as_ref())
                })
            }
        }
    }
}

impl Css for Color {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Color> {
        Specified::parse(p).map(|it| it.compute(cx))
    }
    fn write(&self, out: &mut Out) {
        match (self.exact(CURRENT_COLOR.get()), self) {
            (Some(exact), _) => exact.write(out),
            (None, Color::Pending(index)) => {
                PALETTE.with_borrow(|it| it.pending[*index as usize].0.write(out))
            }
            (None, _) => out.extend_from_slice(b"currentcolor"),
        }
    }
    fn lerp(&self, to: &Color, how: Mixing) -> Option<Color> {
        if let (Color::Current, Color::Current, Mixing::Lerp(_)) = (self, to, how) {
            return Some(Color::Current);
        }
        let (from, to) = (
            self.exact(CURRENT_COLOR.get())?,
            to.exact(CURRENT_COLOR.get())?,
        );
        let is_legacy = from.is_legacy && to.is_legacy;
        let method = if is_legacy {
            Interpolation::SRGB
        } else {
            Interpolation::OKLAB
        };
        let mixed = match how {
            Mixing::Lerp(t) => method.mix(&from, &to, t),
            _ => {
                let mut sum = method.mix(&from, &to, 0.5);
                let alpha = sum.components[3] * 2.0;
                sum.components = sum.components.map(|it| it * alpha.max(1.0));
                sum.components[3] = alpha.min(1.0);
                sum
            }
        };
        let overflows =
            !matches!(how, Mixing::Lerp(_)) && mixed.components.iter().any(|it| *it > 1.0);
        Some(match overflows {
            true => Color::Exact(
                mixed.rgba(),
                PALETTE.with_borrow_mut(|it| it.add(Exact { is_legacy, ..mixed }, true)),
            ),
            false => Color::new(Exact { is_legacy, ..mixed }, true),
        })
    }
}

/// The `color` property.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Rgba(pub(crate) u32, u16);

impl Rgba {
    pub(crate) const BLACK: Rgba = Rgba(0xff, NOT_EXACT);

    pub(crate) fn plain(rgba: u32) -> Rgba {
        Rgba(rgba, NOT_EXACT)
    }

    fn color(self) -> Color {
        if self.1 == NOT_EXACT {
            Color::Rgba(self.0)
        } else {
            Color::Exact(self.0, self.1)
        }
    }

    fn new(color: Color, current: Rgba) -> Rgba {
        match color {
            Color::Current => current,
            Color::Rgba(rgba) => Rgba(rgba, NOT_EXACT),
            Color::Exact(rgba, index) => Rgba(rgba, index),
            Color::Pending(_) => color
                .exact(Some(current))
                .map_or(current, |it| Rgba::new(Color::new(it, false), current)),
        }
    }
}

impl Css for Rgba {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Rgba> {
        let color = Color::parse(p, cx)?;
        if color.uses_current() {
            cx.uses(Deps::INHERITED);
        }
        Some(Rgba::new(color, cx.color))
    }
    fn write(&self, out: &mut Out) {
        self.color().write(out);
    }
    fn lerp(&self, to: &Rgba, how: Mixing) -> Option<Rgba> {
        self.color()
            .lerp(&to.color(), how)
            .map(|it| Rgba::new(it, *self))
    }
}
