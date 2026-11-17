//! https://drafts.fxtf.org/filter-effects/#FilterPrimitivesOverview

use std::rc::Rc;
use std::sync::LazyLock;

use super::cpu::blend_mode;
use super::raster::{
    Clip, IntRect, Layer, Paint, Pixel, demultiply, map_point, map_rect, multiply,
};
use super::scene::Scene;
use crate::abi::{self, BlendMode, Filter, Primitive, Rect};
use crate::gfx::Transform;

/// To sRGB, and to linearRGB.
static TABLES: LazyLock<[[u8; 256]; 2]> = LazyLock::new(|| {
    let encode = |c: f32| {
        if c <= 0.003_130_8 {
            c * 12.92
        } else {
            1.055 * c.powf(1. / 2.4) - 0.055
        }
    };
    let decode = |c: f32| {
        if c <= 0.040_45 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let table = |f: &dyn Fn(f32) -> f32| {
        std::array::from_fn(|value| (f(value as f32 / 255.) * 255. + 0.5) as u8)
    };
    [table(&encode), table(&decode)]
});

fn premultiply([r, g, b, a]: [u8; 4]) -> Pixel {
    [multiply(r, a), multiply(g, a), multiply(b, a), a]
}

fn byte(value: f32) -> u8 {
    (value + 0.5) as u8
}

/// Premultiplied colors do not exceed the alpha.
fn valid([r, g, b, a]: [f32; 4]) -> Pixel {
    let a = byte(a);
    [byte(r).min(a), byte(g).min(a), byte(b).min(a), a]
}

pub fn convert(layer: &mut Layer, to_linear: bool) {
    let table = &TABLES[usize::from(to_linear)];
    for pixel in layer
        .pixels_mut()
        .iter_mut()
        .filter(|pixel| pixel[..3] != [0; 3])
    {
        let [r, g, b, a] = demultiply(*pixel);
        *pixel = premultiply([
            table[usize::from(r)],
            table[usize::from(g)],
            table[usize::from(b)],
            a,
        ]);
    }
}

#[derive(Clone)]
struct Image {
    layer: Rc<Layer>,
    linear: bool,
    area: IntRect,
}

struct Graph<'a> {
    rect: IntRect,
    matrix: &'a Transform,
    source: Image,
    results: Vec<Option<Image>>,
}

fn at(layer: &Layer, x: i32, y: i32) -> Pixel {
    let IntRect {
        left,
        top,
        right,
        bottom,
    } = layer.rect;
    if (left..right).contains(&x) && (top..bottom).contains(&y) {
        layer.row(y, x, x + 1)[0]
    } else {
        [0; 4]
    }
}

fn generate(rect: IntRect, area: IntRect, f: impl Fn(i32, i32) -> Pixel) -> Option<Layer> {
    let mut output = Layer::new(rect)?;
    for y in (area.top..area.bottom).filter(|_| !area.is_empty()) {
        (area.left..)
            .zip(output.row_mut(y, area.left, area.right))
            .for_each(|(x, pixel)| *pixel = f(x, y));
    }
    Some(output)
}

fn composite(top: &Layer, bottom: &Layer, mode: super::blend::Mode) -> Option<Layer> {
    let mut output = bottom.copy(bottom.rect)?;
    output.draw_with_mode(top, mode, &Clip::new(bottom.rect));
    Some(output)
}

fn color(channels: &[f32], linear: bool) -> [u8; 4] {
    let channel = |index: usize| {
        if linear {
            TABLES[1][channels[index] as usize & 255]
        } else {
            channels[index] as u8
        }
    };
    [channel(0), channel(1), channel(2), channels[3] as u8]
}

fn normalize([x, y, z]: [f32; 3]) -> [f32; 3] {
    let length = (x * x + y * y + z * z).sqrt();
    if length > 0. {
        [x / length, y / length, z / length]
    } else {
        [0.; 3]
    }
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn morphology(input: &Layer, [rx, ry]: [i32; 2], dilates: bool) -> Option<Layer> {
    let pick = |a: Pixel, b: Pixel| -> Pixel {
        std::array::from_fn(|c| {
            if dilates {
                a[c].max(b[c])
            } else {
                a[c].min(b[c])
            }
        })
    };
    let rect = input.rect;
    let (width, height) = (rect.width(), rect.height());
    if rx < 0 || ry < 0 {
        return Layer::new(rect);
    }
    let (mut output, mut line) = (input.copy(rect)?, Vec::new());
    let pixels = output.pixels_mut();
    for (radius, count, length, step, stride) in [
        (rx as usize, height, width, 1, width),
        (ry as usize, width, height, width, 1),
    ] {
        let radius = radius.min(length);
        for start in (0..count).map(|it| it * stride) {
            line.clear();
            line.resize(length + 2 * radius, Pixel::default());
            (0..length).for_each(|it| line[radius + it] = pixels[start + it * step]);
            // Each stands for the `covered` ones that start with it.
            let mut covered = 1;
            while covered < 2 * radius + 1 {
                let more = covered.min(2 * radius + 1 - covered);
                (0..line.len() - more).for_each(|it| line[it] = pick(line[it], line[it + more]));
                covered += more;
            }
            (0..length).for_each(|it| pixels[start + it * step] = line[it]);
        }
    }
    Some(output)
}

struct Noise {
    lattice: [usize; 514],
    gradients: [[[f64; 2]; 514]; 4],
}

impl Noise {
    fn new(seed: f32) -> Box<Noise> {
        const MODULUS: i64 = 2_147_483_647;
        let mut seed = seed as i64;
        seed = if seed <= 0 {
            -(seed % (MODULUS - 1)) + 1
        } else {
            seed.min(MODULUS - 1)
        };
        let mut random = || {
            seed = 16807 * (seed % 127_773) - 2836 * (seed / 127_773);
            seed += if seed <= 0 { MODULUS } else { 0 };
            seed
        };
        let mut noise = Box::new(Noise {
            lattice: std::array::from_fn(|index| index & 255),
            gradients: [[[0.; 2]; 514]; 4],
        });
        for gradient in noise
            .gradients
            .iter_mut()
            .flat_map(|channel| &mut channel[..256])
        {
            let [x, y] = [(); 2].map(|()| (random() % 512 - 256) as f64 / 256.);
            let length = x.hypot(y).max(f64::MIN_POSITIVE);
            *gradient = [x / length, y / length];
        }
        for index in (1..256).rev() {
            noise.lattice.swap(index, (random() % 256) as usize);
        }
        for index in 0..258 {
            noise.lattice[256 + index] = noise.lattice[index];
            noise
                .gradients
                .iter_mut()
                .for_each(|channel| channel[256 + index] = channel[index]);
        }
        noise
    }

    /// `stitch` has a period and a limit for each axis.
    fn at(&self, channel: usize, point: [f64; 2], stitch: Option<[[i64; 2]; 2]>) -> f64 {
        let [(x0, x1, rx), (y0, y1, ry)] = [0, 1].map(|axis| {
            let t = point[axis] + 4096.;
            let wrap = |cell: i64| match stitch {
                Some(stitch) if cell >= stitch[axis][1] => cell - stitch[axis][0],
                _ => cell,
            };
            (
                (wrap(t as i64) & 255) as usize,
                (wrap(t as i64 + 1) & 255) as usize,
                t - t.trunc(),
            )
        });
        let corner = |x: usize, y: usize, dx: f64, dy: f64| {
            let [gx, gy] = self.gradients[channel][self.lattice[self.lattice[x] + y]];
            dx * gx + dy * gy
        };
        let (curve, lerp) = (
            |t: f64| t * t * (3. - 2. * t),
            |t: f64, a: f64, b: f64| a + t * (b - a),
        );
        let above = lerp(
            curve(rx),
            corner(x0, y0, rx, ry),
            corner(x1, y0, rx - 1., ry),
        );
        let below = lerp(
            curve(rx),
            corner(x0, y1, rx, ry - 1.),
            corner(x1, y1, rx - 1., ry - 1.),
        );
        lerp(curve(ry), above, below)
    }
}

impl Graph<'_> {
    fn input(&self, which: f32, linear: bool) -> Option<Image> {
        let mut image = match which {
            abi::INPUT_GRAPHIC => self.source.clone(),
            abi::INPUT_ALPHA => {
                let mut layer = self.source.layer.copy(self.rect)?;
                layer
                    .pixels_mut()
                    .iter_mut()
                    .for_each(|pixel| *pixel = [0, 0, 0, pixel[3]]);
                Image {
                    layer: Rc::new(layer),
                    linear,
                    ..self.source
                }
            }
            0.0.. => self.results.get(which as usize)?.clone()?,
            _ => Image {
                layer: Rc::new(Layer::new(self.rect)?),
                linear,
                ..self.source
            },
        };
        if image.linear != linear {
            let mut layer = image.layer.copy(self.rect)?;
            convert(&mut layer, linear);
            image = Image {
                layer: Rc::new(layer),
                linear,
                ..image
            };
        }
        Some(image)
    }

    fn lengths(&self, pair: &[f32]) -> [f32; 2] {
        [
            pair[0] * self.matrix.sx.abs(),
            pair[1] * self.matrix.sy.abs(),
        ]
    }

    fn moved(&self, input: &Layer, by: &[f32]) -> Option<Layer> {
        let (x, y) = (
            (by[0] * self.matrix.sx).round() as i32,
            (by[1] * self.matrix.sy).round() as i32,
        );
        let mut moved = input.copy(input.rect)?;
        moved.rect = moved
            .rect
            .offset(x.clamp(-1 << 24, 1 << 24), y.clamp(-1 << 24, 1 << 24));
        moved.copy(self.rect)
    }

    fn light(
        &self,
        input: &Image,
        area: IntRect,
        arguments: &[f32],
        is_specular: bool,
        linear: bool,
    ) -> Option<Layer> {
        let &[
            surface,
            constant,
            shine,
            _,
            _,
            _,
            _,
            kind,
            x,
            y,
            z,
            to_x,
            to_y,
            to_z,
            exponent,
            cone,
        ] = arguments
        else {
            return None;
        };
        let (tint, depth) = (
            color(&arguments[3..7], linear).map(f32::from),
            super::raster::average_scale(self.matrix),
        );
        let place = |x: f32, y: f32, z: f32| {
            let (x, y) = map_point(self.matrix, x, y);
            [x, y, z * depth]
        };
        let (from, to, surface) = (
            place(x, y, z),
            place(to_x, to_y, to_z),
            surface * depth / 255.,
        );
        let axis = normalize([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
        let IntRect {
            left,
            top,
            right,
            bottom,
        } = area;
        let height = |x: i32, y: i32| f32::from(at(&input.layer, x, y)[3]);
        generate(self.rect, area, |column, row| {
            let (x0, x1, y0, y1) = (
                (column - 1).max(left),
                (column + 1).min(right - 1),
                (row - 1).max(top),
                (row + 1).min(bottom - 1),
            );
            let slope = |range: std::ops::RangeInclusive<i32>,
                         middle: i32,
                         span: i32,
                         rise: &dyn Fn(i32) -> f32| {
                let weight = |at: i32| if at == middle { 2. } else { 1. };
                let total: f32 = range.clone().map(weight).sum();
                range.map(|at| weight(at) * rise(at)).sum::<f32>() * 2.
                    / (total * span.max(1) as f32)
            };
            let nx = slope(y0..=y1, row, x1 - x0, &|y| height(x1, y) - height(x0, y));
            let ny = slope(x0..=x1, column, y1 - y0, &|x| height(x, y1) - height(x, y0));
            let normal = normalize([-surface * nx / depth, -surface * ny / depth, 1.]);
            let towards = match kind == 0. {
                true => [x, y, z],
                false => normalize([
                    from[0] - column as f32,
                    from[1] - row as f32,
                    from[2] - surface * height(column, row),
                ]),
            };
            let mut amount = match is_specular {
                true => {
                    constant
                        * dot(normal, normalize([towards[0], towards[1], towards[2] + 1.]))
                            .max(0.)
                            .powf(shine)
                }
                false => constant * dot(normal, towards),
            };
            amount = amount.clamp(0., 1.);
            if kind == 2. {
                const SOFT_EDGE: f32 = 0.016;
                let cosine = -dot(towards, axis);
                amount *= if cosine < cone {
                    0.
                } else {
                    cosine.max(0.).powf(exponent) * ((cosine - cone) / SOFT_EDGE).min(1.)
                };
            }
            let [r, g, b] = [0, 1, 2].map(|channel| byte(tint[channel] * amount));
            [r, g, b, if is_specular { r.max(g).max(b) } else { 255 }]
        })
    }

    fn turbulence(&self, region: &[f32], area: IntRect, arguments: &[f32]) -> Option<Layer> {
        let &[x, y, octaves, seed, stitches, is_fractal] = arguments else {
            return None;
        };
        let (noise, inverse, mut frequency) = (
            Noise::new(seed),
            self.matrix.invert()?,
            [f64::from(x), f64::from(y)],
        );
        let stitch = (stitches != 0.).then(|| {
            [0, 1].map(|axis| {
                let (start, length) = (f64::from(region[axis]), f64::from(region[axis + 2]));
                let (low, high) = (
                    (length * frequency[axis]).floor() / length,
                    (length * frequency[axis]).ceil() / length,
                );
                if frequency[axis] != 0. {
                    frequency[axis] = if frequency[axis] / low < high / frequency[axis] {
                        low
                    } else {
                        high
                    };
                }
                let period = (length * frequency[axis] + 0.5) as i64;
                [period, (start * frequency[axis] + 4096.) as i64 + period]
            })
        });
        generate(self.rect, area, |column, row| {
            let (x, y) = map_point(&inverse, column as f32 + 0.5, row as f32 + 0.5);
            premultiply(std::array::from_fn(|channel| {
                let (mut sum, mut ratio, mut stitch) = (0., 1., stitch);
                for _ in 0..(octaves as u32).min(24) {
                    let value = noise.at(
                        channel,
                        [
                            f64::from(x) * frequency[0] * ratio,
                            f64::from(y) * frequency[1] * ratio,
                        ],
                        stitch,
                    );
                    sum += if is_fractal != 0. { value } else { value.abs() } / ratio;
                    ratio *= 2.;
                    stitch =
                        stitch.map(|it| it.map(|[period, limit]| [period * 2, limit * 2 - 4096]));
                }
                byte(
                    (if is_fractal != 0. {
                        (sum + 1.) / 2.
                    } else {
                        sum
                    } * 255.) as f32,
                )
            }))
        })
    }

    fn convolve(&self, input: &Image, area: IntRect, arguments: &[f32]) -> Option<Layer> {
        let (
            &[
                columns,
                rows,
                target_x,
                target_y,
                divisor,
                bias,
                edge,
                keeps_alpha,
            ],
            kernel,
        ) = arguments.split_first_chunk()?;
        let (columns, rows, bounds) = (columns as i32, rows as i32, area);
        (kernel.len() == (columns * rows) as usize && !bounds.is_empty()).then_some(())?;
        let inside = |at: i32, low: i32, high: i32| match edge {
            0. => Some(at.clamp(low, high - 1)),
            1. => Some(low + (at - low).rem_euclid(high - low)),
            _ => (low..high).contains(&at).then_some(at),
        };
        generate(self.rect, area, |x, y| {
            let mut sum = [0.; 4];
            for (index, weight) in (0..).zip(kernel.iter().rev()) {
                let column = inside(
                    x - target_x as i32 + index % columns,
                    bounds.left,
                    bounds.right,
                );
                let Some((column, row)) = column.zip(inside(
                    y - target_y as i32 + index / columns,
                    bounds.top,
                    bounds.bottom,
                )) else {
                    continue;
                };
                let pixel = at(&input.layer, column, row);
                let pixel = if keeps_alpha != 0. {
                    demultiply(pixel)
                } else {
                    pixel
                };
                (0..4).for_each(|channel| sum[channel] += f32::from(pixel[channel]) * weight);
            }
            let sum = sum.map(|channel| channel / divisor + bias * 255.);
            match keeps_alpha != 0. {
                true => premultiply([
                    byte(sum[0]),
                    byte(sum[1]),
                    byte(sum[2]),
                    at(&input.layer, x, y)[3],
                ]),
                false => valid(sum),
            }
        })
    }

    fn run(
        &self,
        kind: Primitive,
        linear: bool,
        arguments: &[f32],
        draw: &dyn Fn(usize, &mut Layer),
    ) -> Option<Image> {
        use super::blend::Mode;
        let (&[first, second, x, y, width, height], rest) = arguments.split_first_chunk()?;
        let area = IntRect::around(map_rect(
            self.matrix,
            Rect {
                x,
                y,
                width,
                height,
            },
        ))
        .intersect(self.source.area);
        let (rect, input) = (self.rect, |which| self.input(which, linear));
        let each = |f: &dyn Fn(Pixel) -> Pixel| {
            let input = input(first)?;
            generate(rect, area, |x, y| {
                premultiply(f(demultiply(at(&input.layer, x, y))))
            })
        };
        let (layer, linear) = match (kind, rest) {
            (Primitive::Blend, [mode]) => {
                use BlendMode::*;
                let modes = [
                    Normal, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn,
                    HardLight, SoftLight, Difference, Exclusion, Hue, Saturation, Color,
                    Luminosity,
                ];
                (
                    composite(
                        &input(first)?.layer,
                        &input(second)?.layer,
                        blend_mode(*modes.get(*mode as usize)?),
                    )?,
                    linear,
                )
            }
            (Primitive::ColorMatrix, rows) if rows.len() == 20 => {
                let row = |row: &[f32], pixel: [f32; 4]| {
                    byte((0..4).map(|c| row[c] * pixel[c]).sum::<f32>() + row[4] * 255.)
                };
                (
                    each(&|pixel| {
                        std::array::from_fn(|c| row(&rows[c * 5..], pixel.map(f32::from)))
                    })?,
                    linear,
                )
            }
            (Primitive::ComponentTransfer, tables) if tables.len() == 1024 => (
                each(&|pixel| {
                    std::array::from_fn(|c| tables[c * 256 + usize::from(pixel[c])] as u8)
                })?,
                linear,
            ),
            (Primitive::Composite, &[6., k1, k2, k3, k4]) => {
                let (a, b) = (input(first)?, input(second)?);
                let mix = |a: u8, b: u8| {
                    k1 * f32::from(a) * f32::from(b) / 255.
                        + k2 * f32::from(a)
                        + k3 * f32::from(b)
                        + k4 * 255.
                };
                let pixel = |x, y| (at(&a.layer, x, y), at(&b.layer, x, y));
                (
                    generate(rect, area, |x, y| {
                        valid(std::array::from_fn(|c| {
                            mix(pixel(x, y).0[c], pixel(x, y).1[c])
                        }))
                    })?,
                    linear,
                )
            }
            (Primitive::Composite, [operator, ..]) => {
                let modes = [
                    Mode::SourceOver,
                    Mode::SourceIn,
                    Mode::SourceOut,
                    Mode::SourceAtop,
                    Mode::Xor,
                    Mode::Plus,
                ];
                (
                    composite(
                        &input(first)?.layer,
                        &input(second)?.layer,
                        *modes.get(*operator as usize)?,
                    )?,
                    linear,
                )
            }
            (Primitive::ConvolveMatrix, _) => (self.convolve(&input(first)?, area, rest)?, linear),
            (Primitive::DiffuseLighting, _) => (
                self.light(&input(first)?, area, rest, false, linear)?,
                linear,
            ),
            (Primitive::SpecularLighting, _) => (
                self.light(&input(first)?, area, rest, true, linear)?,
                linear,
            ),
            (Primitive::DisplacementMap, &[x, y, across, down]) => {
                let (source, map, scale) = (
                    input(first)?,
                    input(second)?,
                    [x * self.matrix.sx, y * self.matrix.sy],
                );
                let displaced = generate(rect, area, |x, y| {
                    let by = demultiply(at(&map.layer, x, y));
                    let shift = |axis: usize, channel: f32| {
                        (scale[axis] * (f32::from(by[channel as usize & 3]) / 255. - 0.5) + 0.5)
                            .floor()
                    };
                    at(
                        &source.layer,
                        x.saturating_add(shift(0, across) as i32),
                        y.saturating_add(shift(1, down) as i32),
                    )
                });
                (displaced?, linear)
            }
            (Primitive::DropShadow, [offset @ .., _, _, _, _]) if offset.len() == 4 => {
                let (source, tint) = (input(first)?, premultiply(color(&rest[4..], linear)));
                let mut shadow = self.moved(&source.layer, offset)?;
                shadow
                    .pixels_mut()
                    .iter_mut()
                    .for_each(|pixel| *pixel = super::raster::scale(tint, pixel[3]));
                shadow = shadow.blurred(self.lengths(&offset[2..]), rect)?;
                shadow.draw(&source.layer, None, &Clip::new(rect));
                (shadow, linear)
            }
            (Primitive::Flood, [_, _, _, _]) => {
                let mut layer = Layer::new(rect)?;
                layer.fill(
                    area,
                    None,
                    &Clip::new(area),
                    &Paint::Solid(premultiply(color(rest, false))),
                );
                (layer, false)
            }
            (Primitive::GaussianBlur, [_, _]) => (
                input(first)?.layer.blurred(self.lengths(rest), rect)?,
                linear,
            ),
            (Primitive::Image, [position]) => {
                let mut layer = Layer::new(rect)?;
                draw(*position as usize, &mut layer);
                (layer, false)
            }
            (Primitive::Merge, inputs) => {
                let mut layer = Layer::new(rect)?;
                for which in inputs {
                    layer.draw(&input(*which)?.layer, None, &Clip::new(area));
                }
                (layer, linear)
            }
            (Primitive::Morphology, [_, _, dilates]) => (
                morphology(
                    &input(first)?.layer,
                    self.lengths(rest).map(|radius| radius.round() as i32),
                    *dilates != 0.,
                )?,
                linear,
            ),
            (Primitive::Offset, [_, _]) => (self.moved(&input(first)?.layer, rest)?, linear),
            (Primitive::Tile, &[x, y, width, height]) => {
                let (source, cell) = (
                    input(first)?,
                    IntRect::nearest(map_rect(
                        self.matrix,
                        Rect {
                            x,
                            y,
                            width,
                            height,
                        },
                    )),
                );
                let wrap = |at: i32, low: i32, length: usize| {
                    low + (at - low).rem_euclid(length.max(1) as i32)
                };
                let tiled = |x, y| {
                    at(
                        &source.layer,
                        wrap(x, cell.left, cell.width()),
                        wrap(y, cell.top, cell.height()),
                    )
                };
                (
                    generate(rect, if cell.is_empty() { cell } else { area }, tiled)?,
                    linear,
                )
            }
            (Primitive::Turbulence, _) => (self.turbulence(&arguments[2..6], area, rest)?, linear),
            _ => return None,
        };
        Some(Image {
            layer: Rc::new(crop(layer, area)),
            linear,
            area,
        })
    }
}

fn crop(mut layer: Layer, area: IntRect) -> Layer {
    for piece in layer.rect.without(area) {
        (piece.top..piece.bottom)
            .for_each(|y| layer.row_mut(y, piece.left, piece.right).fill([0; 4]));
    }
    layer
}

/// `matrix` only scales and translates. `draw` paints an `Item::Input`.
pub fn apply(
    layer: &mut Layer,
    region: Rect,
    primitives: &[Filter],
    scene: &Scene,
    matrix: &Transform,
    draw: &dyn Fn(usize, &mut Layer),
) {
    let (rect, area) = (
        layer.rect,
        IntRect::around(map_rect(matrix, region)).intersect(layer.rect),
    );
    let Some(blank) = Layer::new(rect) else {
        return;
    };
    let source = Image {
        layer: Rc::new(crop(std::mem::replace(layer, blank), area)),
        linear: false,
        area,
    };
    let mut graph = Graph {
        rect,
        matrix,
        source,
        results: Vec::new(),
    };
    let mut last_use: Vec<usize> = (0..primitives.len()).collect();
    for (index, primitive) in primitives.iter().enumerate() {
        let Filter::Primitive { arguments, .. } = *primitive else {
            return;
        };
        // Not all of them are inputs.
        scene
            .floats(arguments)
            .iter()
            .filter(|it| (0.0..index as f32).contains(*it))
            .for_each(|it| last_use[*it as usize] = index);
    }
    let (mut kept, most) = (
        Vec::new(),
        ((1 << 28) / (rect.width() * rect.height()).max(1)).max(8),
    );
    for (index, primitive) in primitives.iter().enumerate() {
        let Filter::Primitive {
            kind,
            linear,
            arguments,
        } = *primitive
        else {
            return;
        };
        let result = graph
            .run(kind, linear, &scene.floats(arguments), draw)
            .or_else(|| graph.input(abi::INPUT_NOTHING, linear));
        graph.results.push(result);
        kept.extract_if(.., |it: &mut usize| last_use[*it] <= index)
            .for_each(|it| graph.results[it] = None);
        kept.push(index);
        if kept.len() > most {
            return;
        }
    }
    if let Some(result) = primitives
        .len()
        .checked_sub(1)
        .and_then(|last| graph.input(last as f32, false))
    {
        layer.replace(&result.layer, &Clip::new(rect));
    }
}
