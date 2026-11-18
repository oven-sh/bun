//! ICC profiles to and from the colour spaces of `ImageData`. Section numbers are of <https://www.color.org/specification/ICC.1-2022-05.pdf>.

use core::array::from_fn;
use std::sync::LazyLock;

use bun_core::boxed_zeroed;

use super::image_data::PredefinedColorSpace;

type Matrix = [[f32; 3]; 3];
/// s15Fixed16
type Fixed = i32;

const D50: [Fixed; 3] = [0xF6D6, 0x10000, 0xD32D];
/// Bradford, Annex E.
const D65_TO_D50: [Fixed; 9] = [68674, 1502, -3291, 1939, 64912, -1119, -606, 988, 49262];
/// XYZ of red, green and blue, rounded so that they add up to `D50` and grey stays grey.
const SRGB_COLORANTS: [[Fixed; 3]; 3] = [
    [28576, 14581, 912],
    [25239, 46983, 6361],
    [9375, 3972, 46788],
];
const DISPLAY_P3_COLORANTS: [[Fixed; 3]; 3] = [
    [33759, 15807, -69],
    [19135, 45367, 2745],
    [10296, 4362, 51385],
];
/// The sRGB profiles in use are within 0.0003 of each other. PAL, the nearest other gamut, is 0.02 away.
const SAME_COLORANT: f32 = 0.001;

fn from_fixed(value: Fixed) -> f32 {
    value as f32 / 65536.0
}

impl PredefinedColorSpace {
    fn colorants(self) -> [[Fixed; 3]; 3] {
        match self {
            Self::Srgb | Self::SrgbLinear => SRGB_COLORANTS,
            Self::DisplayP3 | Self::DisplayP3Linear => DISPLAY_P3_COLORANTS,
        }
    }

    fn is_linear(self) -> bool {
        matches!(self, Self::SrgbLinear | Self::DisplayP3Linear)
    }

    fn encoding(self) -> &'static Encoding {
        static LINEAR: LazyLock<Box<Encoding>> = LazyLock::new(|| Encoding::new(Curve::LINEAR));
        static SRGB: LazyLock<Box<Encoding>> = LazyLock::new(|| Encoding::new(Curve::SRGB));
        if self.is_linear() { &LINEAR } else { &SRGB }
    }
}

// ─── Reading a profile ──────────────────────────────────────────────────────

fn bytes_at<const N: usize>(bytes: &[u8], at: usize) -> Option<[u8; N]> {
    bytes.get(at..)?.first_chunk().copied()
}

fn u16_at(bytes: &[u8], at: usize) -> Option<usize> {
    bytes_at(bytes, at).map(|it| u16::from_be_bytes(it).into())
}

fn u32_at(bytes: &[u8], at: usize) -> Option<usize> {
    bytes_at(bytes, at).map(|it| u32::from_be_bytes(it) as usize)
}

fn fixed_at<const N: usize>(bytes: &[u8], at: usize) -> Option<[f32; N]> {
    let values: &[[u8; 4]; N] = bytes.get(at..)?.as_chunks().0.first_chunk()?;
    Some(values.map(|it| from_fixed(Fixed::from_be_bytes(it))))
}

#[derive(Clone, Copy, PartialEq)]
enum Samples<'a> {
    U8(&'a [u8]),
    U16(&'a [[u8; 2]]),
}

impl<'a> Samples<'a> {
    /// Takes them off the front of `bytes`.
    fn take(bytes: &mut &'a [u8], len: usize, size: usize) -> Option<Self> {
        let taken = bytes.split_off(..len.checked_mul(size)?)?;
        match size {
            1 => Some(Self::U8(taken)),
            2 => Some(Self::U16(taken.as_chunks().0)),
            _ => None,
        }
    }

    fn len(self) -> usize {
        match self {
            Self::U8(samples) => samples.len(),
            Self::U16(samples) => samples.len(),
        }
    }

    #[inline]
    fn at<const N: usize>(self, index: usize) -> [f32; N] {
        match self {
            Self::U8(samples) => {
                let samples = &samples[index..index + N];
                from_fn(|i| f32::from(samples[i]) * (1.0 / 255.0))
            }
            Self::U16(samples) => {
                let samples = &samples[index..index + N];
                from_fn(|i| f32::from(u16::from_be_bytes(samples[i])) * (1.0 / 65535.0))
            }
        }
    }
}

/// The cell of `x`, which is in 0..=1, on an axis with `len >= 2` samples, and how far `x` is into it.
#[inline]
fn cell_of(x: f32, len: usize) -> (usize, f32) {
    let x = x * (len - 1) as f32;
    let cell = (x as usize).min(len - 2);
    (cell, x - cell as f32)
}

#[derive(Clone, Copy, PartialEq)]
enum Curve<'a> {
    /// `[g, a, b, c, d, e, f]` of function type 4 (10.18), which the other types are special cases of.
    Function([f32; 7]),
    /// At least two.
    Table(Samples<'a>),
}

impl<'a> Curve<'a> {
    const LINEAR: Curve<'static> = Curve::gamma(1.0);
    const SRGB: Curve<'static> = Curve::Function([
        2.4,
        1.0 / 1.055,
        0.055 / 1.055,
        1.0 / 12.92,
        0.04045,
        0.0,
        0.0,
    ]);

    const fn gamma(g: f32) -> Self {
        Self::Function([g, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    }

    /// Takes a `curv` or a `para` off the front of `bytes`.
    fn take(bytes: &mut &'a [u8]) -> Option<Self> {
        let (curve, len) = match bytes.first_chunk()? {
            b"curv" => match u32_at(bytes, 8)? {
                0 => (Curve::LINEAR, 12),
                1 => (Self::gamma(u16_at(bytes, 12)? as f32 / 256.0), 14),
                len => {
                    let samples = Samples::take(&mut bytes.get(12..)?, len, 2)?;
                    (Self::Table(samples), 12 + 2 * len)
                }
            },
            b"para" => {
                let (parameters, count) = match u16_at(bytes, 8)? {
                    0 => {
                        let [g] = fixed_at(bytes, 12)?;
                        ([g, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0], 1)
                    }
                    1 | 2 if u32_at(bytes, 16)? == 0 => return None,
                    1 => {
                        let [g, a, b] = fixed_at(bytes, 12)?;
                        ([g, a, b, 0.0, -b / a, 0.0, 0.0], 3)
                    }
                    2 => {
                        let [g, a, b, c] = fixed_at(bytes, 12)?;
                        ([g, a, b, 0.0, -b / a, c, c], 4)
                    }
                    3 => {
                        let [g, a, b, c, d] = fixed_at(bytes, 12)?;
                        ([g, a, b, c, d, 0.0, 0.0], 5)
                    }
                    4 => (fixed_at(bytes, 12)?, 7),
                    _ => return None,
                };
                (Self::Function(parameters), 12 + 4 * count)
            }
            _ => return None,
        };
        *bytes = bytes.get(len.next_multiple_of(4)..).unwrap_or_default();
        Some(curve)
    }

    fn take_three(mut bytes: &'a [u8]) -> Option<[Self; 3]> {
        let bytes = &mut bytes;
        Some([Self::take(bytes)?, Self::take(bytes)?, Self::take(bytes)?])
    }

    /// From 0..=1 to 0..=1, whatever the profile says.
    #[inline]
    fn at(self, x: f32) -> f32 {
        let y = match self {
            Self::Function([g, a, b, _, d, e, _]) if x >= d => {
                let base = (a * x + b).max(0.0);
                e + if g == 1.0 { base } else { base.powf(g) }
            }
            Self::Function([_, _, _, c, _, _, f]) => c * x + f,
            Self::Table(samples) => {
                let (cell, t) = cell_of(x, samples.len());
                let [near, far] = samples.at(cell);
                near * (1.0 - t) + far * t
            }
        };
        y.clamp(0.0, 1.0)
    }
}

fn tabulate(curves: &[Curve; 3]) -> [[f32; 256]; 3] {
    let table = |curve: Curve| from_fn(|value| curve.at(value as f32 / 255.0));
    let first = table(curves[0]);
    curves.map(|curve| {
        if curve == curves[0] {
            first
        } else {
            table(curve)
        }
    })
}

struct Grid<'a> {
    /// At least two each.
    lens: [usize; 3],
    samples: Samples<'a>,
}

impl<'a> Grid<'a> {
    fn take(bytes: &mut &'a [u8], lens: [u8; 3], size: usize) -> Option<Self> {
        let lens = lens.map(usize::from);
        if lens.iter().any(|&len| len < 2) {
            return None;
        }
        let samples = Samples::take(bytes, lens.iter().product::<usize>() * 3, size)?;
        Some(Self { lens, samples })
    }

    /// Within the tetrahedron that leads from the near corner of the cell to the far one, longest step first.
    #[inline]
    fn at(&self, point: [f32; 3]) -> [f32; 3] {
        let strides = [self.lens[1] * self.lens[2] * 3, self.lens[2] * 3, 3];
        let mut index = 0;
        let mut steps: [_; 3] = from_fn(|axis| {
            let (cell, t) = cell_of(point[axis], self.lens[axis]);
            index += cell * strides[axis];
            (t, strides[axis])
        });
        for i in [0, 1, 0] {
            if steps[i].0 < steps[i + 1].0 {
                steps.swap(i, i + 1);
            }
        }
        let mut corner = self.samples.at::<3>(index);
        let mut sum = corner;
        for (t, stride) in steps {
            index += stride;
            let next = self.samples.at::<3>(index);
            sum = from_fn(|channel| sum[channel] + t * (next[channel] - corner[channel]));
            corner = next;
        }
        sum
    }
}

/// Curves that every pixel goes through at another point.
struct Sampled(Option<Box<[[f32; Self::LEN]; 3]>>);

impl Sampled {
    const LEN: usize = 1025;

    fn new(curves: &[Curve; 3]) -> Self {
        Self((*curves != [Curve::LINEAR; 3]).then(|| {
            let mut tables: Box<[[f32; Self::LEN]; 3]> = boxed_zeroed();
            for (table, curve) in tables.iter_mut().zip(curves) {
                for (i, y) in table.iter_mut().enumerate() {
                    *y = curve.at(i as f32 / (Self::LEN - 1) as f32);
                }
            }
            tables
        }))
    }

    #[inline]
    fn at(&self, color: [f32; 3]) -> [f32; 3] {
        let Some(tables) = &self.0 else {
            return color;
        };
        from_fn(|channel| {
            let (cell, t) = cell_of(color[channel].clamp(0.0, 1.0), Self::LEN);
            tables[channel][cell] * (1.0 - t) + tables[channel][cell + 1] * t
        })
    }
}

#[derive(Clone, Copy)]
enum ConnectionSpace {
    Xyz,
    Lab,
}

impl ConnectionSpace {
    /// 6.3.4.2
    #[inline]
    fn to_xyz(self, encoded: [f32; 3]) -> [f32; 3] {
        match self {
            Self::Xyz => encoded.map(|it| it * (65535.0 / 32768.0)),
            Self::Lab => {
                let y = (encoded[0] * 100.0 + 16.0) * (1.0 / 116.0);
                let x = y + (encoded[1] * 255.0 - 128.0) * (1.0 / 500.0);
                let z = y - (encoded[2] * 255.0 - 128.0) * (1.0 / 200.0);
                let white = D50.map(from_fixed);
                let relative = [x, y, z].map(|t| match t > 6.0 / 29.0 {
                    true => t * t * t,
                    false => (t - 4.0 / 29.0) * (108.0 / 841.0),
                });
                from_fn(|channel| relative[channel] * white[channel])
            }
        }
    }
}

/// An `A2B` tag. The stages are in their order.
struct Lut<'a> {
    a: [Curve<'a>; 3],
    grid: Option<Grid<'a>>,
    m: Sampled,
    matrix: Option<[f32; 12]>,
    b: Sampled,
    scale: f32,
    connection_space: ConnectionSpace,
}

impl<'a> Lut<'a> {
    fn parse(tag: &'a [u8], connection_space: ConnectionSpace) -> Option<Self> {
        let [3, 3, grid_len] = bytes_at(tag, 8)? else {
            return None;
        };
        // 10.10 and 10.11. Their matrix is only for an input that is XYZ.
        let (mut rest, size, a_len, b_len) = match tag.first_chunk()? {
            b"mAB " => return Self::parse_a_to_b(tag, connection_space),
            b"mft1" => (tag.get(48..)?, 1, 256, 256),
            b"mft2" => (tag.get(52..)?, 2, u16_at(tag, 48)?, u16_at(tag, 50)?),
            _ => return None,
        };
        if a_len < 2 || b_len < 2 {
            return None;
        }
        let tables = |rest: &mut &'a [u8], len| {
            let mut table = || Samples::take(rest, len, size).map(Curve::Table);
            Some([table()?, table()?, table()?])
        };
        Some(Self {
            a: tables(&mut rest, a_len)?,
            grid: Some(Grid::take(&mut rest, [grid_len; 3], size)?),
            m: Sampled(None),
            matrix: None,
            b: Sampled::new(&tables(&mut rest, b_len)?),
            // In a `mft2`, an L* of 100 is 0xFF00.
            scale: match (connection_space, size) {
                (ConnectionSpace::Lab, 2) => 65535.0 / 65280.0,
                _ => 1.0,
            },
            connection_space,
        })
    }

    /// 10.12
    fn parse_a_to_b(tag: &'a [u8], connection_space: ConnectionSpace) -> Option<Self> {
        let [b, matrix, m, grid, a] = [12, 16, 20, 24, 28].map(|at| u32_at(tag, at));
        let curves = |offset| match offset {
            0 => Some([Curve::LINEAR; 3]),
            _ => Curve::take_three(tag.get(offset..)?),
        };
        Some(Self {
            a: curves(a?)?,
            grid: match grid? {
                0 => None,
                offset => {
                    let grid = tag.get(offset..)?;
                    let (lens, size) = (bytes_at(grid, 0)?, *grid.get(16)?);
                    Some(Grid::take(&mut grid.get(20..)?, lens, size.into())?)
                }
            },
            m: Sampled::new(&curves(m?)?),
            matrix: match matrix? {
                0 => None,
                offset => Some(fixed_at(tag, offset)?),
            },
            b: Sampled::new(&curves(b?)?),
            scale: 1.0,
            connection_space,
        })
    }

    #[inline]
    fn xyz_after_a(&self, mut color: [f32; 3]) -> [f32; 3] {
        if let Some(grid) = &self.grid {
            color = grid.at(color);
        }
        color = self.m.at(color);
        if let Some(matrix) = &self.matrix {
            let (rows, offsets) = (matrix.as_chunks::<3>().0, &matrix[9..]);
            color = from_fn(|row| dot(rows[row], color) + offsets[row]);
        }
        let encoded = self.b.at(color).map(|it| it * self.scale);
        self.connection_space.to_xyz(encoded)
    }
}

enum Profile<'a> {
    /// The curves give the amount of each colorant.
    Rgb([Curve<'a>; 3], Matrix),
    Gray(Curve<'a>, ConnectionSpace),
    Lut(Lut<'a>),
}

impl<'a> Profile<'a> {
    fn parse(bytes: &'a [u8]) -> Option<Self> {
        if bytes_at(bytes, 36)? != *b"acsp" || *bytes.get(8)? > 4 {
            return None;
        }
        let connection_space = match &bytes_at(bytes, 20)? {
            b"XYZ " => ConnectionSpace::Xyz,
            b"Lab " => ConnectionSpace::Lab,
            _ => return None,
        };
        let tags = bytes.get(132..)?.as_chunks::<12>().0;
        let tags = tags.get(..u32_at(bytes, 128)?)?;
        let tag = |signature: &[u8; 4]| {
            let entry = tags.iter().find(|entry| entry.starts_with(signature))?;
            bytes.get(u32_at(entry, 4)?..)?.get(..u32_at(entry, 8)?)
        };
        let curve = |signature| Curve::take(&mut tag(signature)?);
        let colorant = |signature| fixed_at(tag(signature)?.strip_prefix(b"XYZ ")?, 4);
        match &bytes_at(bytes, 16)? {
            b"GRAY" => Some(Self::Gray(curve(b"kTRC")?, connection_space)),
            // 8.10.2 has the table before the matrix, if there are both.
            b"RGB " => match tag(b"A2B0").or_else(|| tag(b"A2B1")) {
                Some(tag) => Lut::parse(tag, connection_space).map(Self::Lut),
                None => Some(Self::Rgb(
                    [curve(b"rTRC")?, curve(b"gTRC")?, curve(b"bTRC")?],
                    [colorant(b"rXYZ")?, colorant(b"gXYZ")?, colorant(b"bXYZ")?],
                )),
            },
            _ => None,
        }
    }
}

// ─── Converting ─────────────────────────────────────────────────────────────

#[inline]
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// The rows give the amount of each of the `colorants` in an XYZ colour.
fn xyz_to(colorants: Matrix) -> Matrix {
    let cross = |a: [f32; 3], b: [f32; 3]| -> [f32; 3] {
        from_fn(|i| a[(i + 1) % 3] * b[(i + 2) % 3] - a[(i + 2) % 3] * b[(i + 1) % 3])
    };
    let [r, g, b] = colorants;
    let determinant = dot(r, cross(g, b));
    [cross(g, b), cross(b, r), cross(r, g)].map(|row| row.map(|it| it / determinant))
}

/// With 14 bits, a step is a fifth of the smallest one that sRGB has.
const LIGHT_BITS: u32 = 14;
const FULL_LIGHT: i32 = 1 << LIGHT_BITS;

/// The 8-bit value for each amount of light.
struct Encoding([u8; FULL_LIGHT as usize + 1]);
// SAFETY: bytes.
unsafe impl bun_core::Zeroable for Encoding {}

impl Encoding {
    fn new(curve: Curve) -> Box<Self> {
        let mut encoding: Box<Self> = boxed_zeroed();
        for value in 1..=255 {
            let start = curve.at((f32::from(value) - 0.5) / 255.0) * FULL_LIGHT as f32;
            encoding.0[start.ceil() as usize..].fill(value);
        }
        encoding
    }

    #[inline]
    fn of_fixed(&self, light: i32) -> u8 {
        self.0[light.clamp(0, FULL_LIGHT) as usize]
    }

    #[inline]
    fn of(&self, light: f32) -> u8 {
        self.of_fixed((light * FULL_LIGHT as f32 + 0.5) as i32)
    }
}

fn convert_channels(rgba: &mut [[u8; 4]], light: &[[f32; 256]; 3], encoding: &Encoding) {
    let tables = light.map(|light| light.map(|it| encoding.of(it)));
    // The small sRGB profiles have curves of as few as 20 points.
    let changes_little = |table: &[u8; 256]| {
        (0..=255).all(|value: u8| table[usize::from(value)].abs_diff(value) <= 1)
    };
    if tables.iter().all(changes_little) {
        return;
    }
    for pixel in rgba {
        for channel in 0..3 {
            pixel[channel] = tables[channel][usize::from(pixel[channel])];
        }
    }
}

fn convert_with_matrix(
    rgba: &mut [[u8; 4]],
    light: &[[f32; 256]; 3],
    colorants: Matrix,
    encoding: &Encoding,
) {
    const EXTRA_BITS: u32 = 10;
    const ONE: f32 = (FULL_LIGHT << EXTRA_BITS) as f32;
    // What each value of a channel adds to the three results. Four wide, to be added at once.
    let mut shares: Box<[[[i32; 4]; 256]; 3]> = boxed_zeroed();
    for (channel, shares) in shares.iter_mut().enumerate() {
        for (share, light) in shares.iter_mut().zip(light[channel]) {
            let [r, g, b] = colorants[channel].map(|it| (it * light).clamp(-32.0, 32.0) * ONE);
            *share = [r as i32, g as i32, b as i32, 0];
        }
    }
    for pixel in rgba {
        let [r, g, b] = from_fn(|channel| shares[channel][usize::from(pixel[channel])]);
        let light: [i32; 4] =
            from_fn(|i| (r[i] + g[i] + b[i] + (1 << (EXTRA_BITS - 1))) >> EXTRA_BITS);
        for channel in 0..3 {
            pixel[channel] = encoding.of_fixed(light[channel]);
        }
    }
}

fn convert_with_lut(rgba: &mut [[u8; 4]], lut: &Lut, from_xyz: Matrix, encoding: &Encoding) {
    let a = tabulate(&lut.a);
    for pixel in rgba {
        let xyz = lut.xyz_after_a(from_fn(|channel| a[channel][usize::from(pixel[channel])]));
        for channel in 0..3 {
            pixel[channel] = encoding.of(dot(from_xyz[channel], xyz));
        }
    }
}

/// As in a browser, the pixels are sRGB if they have no profile that fits them, and what `to` cannot show is clipped.
pub(crate) fn convert(rgba: &mut [u8], profile: Option<&[u8]>, to: PredefinedColorSpace) {
    let rgba = rgba.as_chunks_mut().0;
    let profile = match profile.and_then(Profile::parse) {
        Some(Profile::Gray(..)) if rgba.iter().any(|&[r, g, b, _]| r != g || g != b) => None,
        profile => profile,
    };
    let profile = match profile {
        Some(profile) => profile,
        None if to == PredefinedColorSpace::Srgb => return,
        None => Profile::Rgb(
            [Curve::SRGB; 3],
            SRGB_COLORANTS.map(|it| it.map(from_fixed)),
        ),
    };
    let to_colorants = to.colorants().map(|it| it.map(from_fixed));
    match profile {
        Profile::Gray(curve, connection_space) => {
            let [mut light, ..] = tabulate(&[curve; 3]);
            if let ConnectionSpace::Lab = connection_space {
                let neutral = 128.0 / 255.0;
                light = light.map(|it| connection_space.to_xyz([it, neutral, neutral])[1]);
            }
            convert_channels(rgba, &[light; 3], to.encoding());
        }
        Profile::Rgb(curves, colorants) => {
            let light = tabulate(&curves);
            let pairs = colorants.as_flattened().iter();
            let mut pairs = pairs.zip(to_colorants.as_flattened());
            if pairs.all(|(a, b)| (a - b).abs() <= SAME_COLORANT) {
                convert_channels(rgba, &light, to.encoding());
            } else {
                let from_xyz = xyz_to(to_colorants);
                let colorants = colorants.map(|xyz| from_xyz.map(|row| dot(row, xyz)));
                convert_with_matrix(rgba, &light, colorants, to.encoding());
            }
        }
        Profile::Lut(lut) => convert_with_lut(rgba, &lut, xyz_to(to_colorants), to.encoding()),
    }
}

// ─── Writing a profile ──────────────────────────────────────────────────────

fn tag_of(signature: [u8; 4], values: &[Fixed]) -> Vec<u8> {
    let values = values.iter().flat_map(|it| it.to_be_bytes());
    signature.into_iter().chain([0; 4]).chain(values).collect()
}

fn text_tag(text: &str) -> Vec<u8> {
    let en_us = Fixed::from_be_bytes(*b"enUS");
    let mut tag = tag_of(*b"mluc", &[1, 12, en_us, 2 * text.len() as Fixed, 28]);
    tag.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
    tag.resize(tag.len().next_multiple_of(4), 0);
    tag
}

/// `None` for sRGB, which is what an image without a profile is taken for.
pub(crate) fn profile_of(space: PredefinedColorSpace) -> Option<Vec<u8>> {
    let name = match space {
        PredefinedColorSpace::Srgb => return None,
        PredefinedColorSpace::SrgbLinear => "Linear sRGB",
        PredefinedColorSpace::DisplayP3 => "Display P3",
        PredefinedColorSpace::DisplayP3Linear => "Linear Display P3",
    };
    let curve: &[Fixed] = match space.is_linear() {
        true => &[0, 0x10000],
        false => &[3 << 16, 0x26666, 0xF2A7, 0xD59, 0x13D0, 0xA5B],
    };
    let [r, g, b] = space.colorants();
    let tags: [(&[&[u8; 4]], Vec<u8>); 8] = [
        (&[b"desc"], text_tag(name)),
        (&[b"cprt"], text_tag("CC0")),
        (&[b"wtpt"], tag_of(*b"XYZ ", &D50)),
        (&[b"chad"], tag_of(*b"sf32", &D65_TO_D50)),
        (&[b"rXYZ"], tag_of(*b"XYZ ", &r)),
        (&[b"gXYZ"], tag_of(*b"XYZ ", &g)),
        (&[b"bXYZ"], tag_of(*b"XYZ ", &b)),
        (&[b"rTRC", b"gTRC", b"bTRC"], tag_of(*b"para", curve)),
    ];
    let count: usize = tags.iter().map(|(signatures, _)| signatures.len()).sum();

    let mut profile = vec![0; 128];
    profile[8..24].copy_from_slice(b"\x04\x30\0\0mntrRGB XYZ ");
    profile[24..30].copy_from_slice(&[0x07, 0xE0, 0, 1, 0, 1]);
    profile[36..40].copy_from_slice(b"acsp");
    profile[68..80].copy_from_slice(D50.map(Fixed::to_be_bytes).as_flattened());
    profile.extend((count as u32).to_be_bytes());
    let mut offset = profile.len() + 12 * count;
    for (signatures, data) in &tags {
        for signature in *signatures {
            profile.extend(*signature);
            profile.extend((offset as u32).to_be_bytes());
            profile.extend((data.len() as u32).to_be_bytes());
        }
        offset += data.len();
    }
    profile.extend(tags.iter().flat_map(|(_, data)| data));
    profile[..4].copy_from_slice(&(offset as u32).to_be_bytes());
    Some(profile)
}
