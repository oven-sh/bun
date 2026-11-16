//! Moves the stems that a glyph declares to the pixel grid, vertically.
//!
//! Derived from the CFF engine of FreeType and its port in skrifa. Copyright (c) 2007-2014 Adobe Systems Incorporated,
//! (c) 2019 Fontations Developers. FreeType License and MIT, see `licenses/freetype.txt` and `licenses/fontations.txt`.

use super::spend;

/// With 16 bits after the point.
type Fixed = i64;

const ONE: Fixed = 1 << 16;
const EM_TOP: Fixed = 880 * ONE;
const EM_BOTTOM: Fixed = -120 * ONE;
const MIN_COUNTER: Fixed = ONE / 2;
const MAX_STEMS: usize = 96;

fn fixed(value: f64) -> Fixed {
    ((value * 65536.).round() as i32).into()
}

fn mul(a: Fixed, b: Fixed) -> Fixed {
    let product = a.wrapping_mul(b);
    ((product.wrapping_add(0x8000 - i64::from(product < 0)) >> 16) as i32).into()
}

fn mul_div(a: Fixed, b: Fixed, c: Fixed) -> Fixed {
    let size = a
        .abs()
        .wrapping_mul(b.abs())
        .wrapping_add(c.abs() / 2)
        .checked_div(c.abs())
        .map_or(i32::MAX, |it| it as i32);
    i64::from(size) * if a ^ b ^ c < 0 { -1 } else { 1 }
}

fn div(a: Fixed, b: Fixed) -> Fixed {
    mul_div(a, ONE, b)
}

fn round(value: Fixed) -> Fixed {
    (value + ONE / 2) & -ONE
}

/// What a Private DICT says.
pub struct Parameters {
    /// For the top, the bottom, and the same for the family.
    blues: [Vec<[Fixed; 2]>; 4],
    blue_scale: Fixed,
    blue_shift: Fixed,
    blue_fuzz: Fixed,
    is_ideographic: bool,
}

impl Parameters {
    pub fn new() -> Parameters {
        Parameters {
            blues: Default::default(),
            blue_scale: fixed(0.039625),
            blue_shift: 7 * ONE,
            blue_fuzz: ONE,
            is_ideographic: false,
        }
    }

    pub fn set(&mut self, operator: u16, operands: &[f32]) {
        let (mut sum, last) = (0., operands.last().map_or(0, |it| fixed((*it).into())));
        match operator {
            6..=9 => {
                let mut add = |it: f32| {
                    sum += f64::from(it);
                    fixed(sum)
                };
                self.blues[usize::from(operator - 6)] = operands
                    .as_chunks()
                    .0
                    .iter()
                    .take(7)
                    .map(|it: &[f32; 2]| it.map(&mut add))
                    .collect();
            }
            0xc09 => self.blue_scale = last,
            0xc0a => self.blue_shift = last,
            0xc0b => self.blue_fuzz = last,
            0xc11 => self.is_ideographic = last == ONE,
            _ => {}
        }
    }
}

struct Zone {
    is_bottom: bool,
    range: [Fixed; 2],
    /// In pixels.
    flat: Fixed,
}

#[derive(Clone, Copy)]
struct Stem {
    range: [Fixed; 2],
    fitted: Option<[Fixed; 2]>,
}

#[derive(Clone, Copy)]
struct Edge {
    is_top: bool,
    is_pair: bool,
    is_locked: bool,
    stem: Option<usize>,
    units: Fixed,
    pixels: Fixed,
    /// Up to the next edge.
    scale: Fixed,
}

type Pair = [Option<Edge>; 2];
type Mask = [u8; MAX_STEMS / 8];

struct Map {
    edges: Vec<Edge>,
    scale: Fixed,
}

impl Map {
    fn apply(&self, units: Fixed) -> Fixed {
        let Some(first) = self.edges.first() else {
            return mul(units, self.scale);
        };
        match self.edges.iter().take_while(|it| units >= it.units).last() {
            Some(edge) => mul(units - edge.units, edge.scale) + edge.pixels,
            None => mul(units - first.units, self.scale) + first.pixels,
        }
    }

    fn insert(&mut self, pair: Pair, initial: Option<&Map>) {
        let (mut first, mut last) = match pair {
            [Some(bottom), Some(top)] => (bottom, top),
            [Some(only), None] | [None, Some(only)] => (only, only),
            [None, None] => return,
        };
        let count = 1 + usize::from(first.is_pair);
        let at = self
            .edges
            .iter()
            .take_while(|it| it.units < first.units)
            .count();
        let (before, after) = (self.edges[..at].last(), self.edges.get(at));
        if last.units < first.units
            || self.edges.len() + count > MAX_STEMS
            || after.is_some_and(|it| it.units <= last.units || it.is_pair && it.is_top)
        {
            return;
        }
        if let Some(initial) = initial.filter(|_| !first.is_locked) {
            let half = (last.units - first.units) / 2;
            let (middle, half) = (initial.apply(first.units + half), mul(half, self.scale));
            (first.pixels, last.pixels) = (middle - half, middle + half);
        }
        if !before.is_some_and(|it| first.pixels < it.pixels)
            && !after.is_some_and(|it| first.pixels.max(last.pixels) > it.pixels)
        {
            self.edges
                .splice(at..at, [first, last].into_iter().take(count));
        }
    }

    fn adjust(&mut self) {
        let (edges, mut saved, mut low) = (&mut self.edges, Vec::new(), 0);
        while low < edges.len() {
            let high = (low + usize::from(edges[low].is_pair)).min(edges.len() - 1);
            if !edges[low].is_locked {
                let fractions = [edges[low].pixels, edges[high].pixels].map(|it| it & (ONE - 1));
                let [a, b] = fractions.map(|it| (ONE - it) & (ONE - 1));
                let (up, down) = (a.min(b), -fractions[0].min(fractions[1]));
                let fits_up = edges
                    .get(high + 1)
                    .is_none_or(|it| it.pixels >= edges[high].pixels + up + MIN_COUNTER);
                let fits_down = edges[..low]
                    .last()
                    .is_none_or(|it| it.pixels <= edges[low].pixels + down - MIN_COUNTER);
                let (by, is_worse) = match (fits_up, fits_down) {
                    (true, true) => (if -down < up { down } else { up }, false),
                    (true, false) => (up, false),
                    (false, true) => (down, up < -down),
                    (false, false) => (0, true),
                };
                if is_worse && edges.get(high + 1).is_some_and(|it| !it.is_locked) {
                    saved.push((low, high, up - by));
                }
                edges[low..=high].iter_mut().for_each(|it| it.pixels += by);
            }
            for at in low.max(1)..=high {
                let (below, above) = (edges[at - 1], edges[at]);
                if above.units != below.units {
                    edges[at - 1].scale =
                        div(above.pixels - below.pixels, above.units - below.units);
                }
            }
            low = high + 1;
        }
        for (low, high, by) in saved.into_iter().rev() {
            if edges[high + 1].pixels >= edges[high].pixels + by + MIN_COUNTER {
                edges[low..=high].iter_mut().for_each(|it| it.pixels += by);
            }
        }
    }
}

pub struct Hints {
    scale: Fixed,
    blue_shift: Fixed,
    blue_fuzz: Fixed,
    suppresses_overshoot: bool,
    fits_em_box: bool,
    zones: Vec<Zone>,
    stems: Vec<Stem>,
    mask: Mask,
    initial: Option<Map>,
    map: Option<Map>,
}

impl Hints {
    pub fn new(parameters: &Parameters, size: f32, units_per_em: u16) -> Hints {
        let (scale, [tops, bottoms, family_tops, family_bottoms]) = (
            (div((size * 64.) as i64, units_per_em.into()) + 32) / 64,
            &parameters.blues,
        );
        let is_outside = |[low, high]: &[[Fixed; 2]; 2]| {
            low[0].max(low[1]) < EM_BOTTOM && high[0].min(high[1]) > EM_TOP
        };
        let fits_em_box = parameters.is_ideographic
            && (tops.is_empty() || tops.as_array().is_some_and(is_outside));
        let is_valid = |it: &&[Fixed; 2]| !fits_em_box && it[1] >= it[0];
        let ranges = (0..)
            .zip(tops.iter().filter(is_valid))
            .map(|(index, it)| (index == 0, *it));
        let ranges = ranges
            .chain(
                bottoms
                    .iter()
                    .take(5)
                    .filter(is_valid)
                    .map(|it| (true, *it)),
            )
            .collect::<Vec<_>>();
        let highest = ranges
            .iter()
            .map(|it| it.1[1] - it.1[0])
            .max()
            .filter(|it| *it > 0);
        let blue_scale = highest.map_or(parameters.blue_scale, |it| {
            parameters.blue_scale.min(div(ONE, it))
        });
        let boost = if scale < blue_scale {
            (fixed(0.6) - mul_div(fixed(0.6), scale, blue_scale)).min(0x7fff)
        } else {
            0
        };
        let zone = |(is_bottom, range): (bool, [Fixed; 2])| {
            let side = usize::from(is_bottom);
            let (baseline, others) = family_tops.split_at(family_tops.len().min(1));
            let family = if is_bottom {
                family_bottoms.iter().chain(baseline)
            } else {
                others.iter().chain(&[])
            };
            let distance = |it: &Fixed| (range[side] - it).abs();
            let flat = family
                .map(|it| it[side])
                .min_by_key(distance)
                .filter(|it| distance(it) < div(ONE, scale))
                .unwrap_or(range[side]);
            Zone {
                is_bottom,
                range,
                flat: round(mul(flat, scale) + if is_bottom { -boost } else { boost }),
            }
        };
        Hints {
            scale,
            blue_shift: parameters.blue_shift,
            blue_fuzz: parameters.blue_fuzz,
            suppresses_overshoot: scale < blue_scale,
            fits_em_box,
            zones: ranges.into_iter().map(zone).collect(),
            stems: Vec::new(),
            mask: [0xff; _],
            initial: None,
            map: None,
        }
    }

    pub fn clear(&mut self) {
        (self.stems, self.mask, self.initial, self.map) = (Vec::new(), [0xff; _], None, None);
    }

    pub fn add_stems(&mut self, operands: &[f32]) {
        let mut at = 0;
        for &[gap, width] in operands.as_chunks().0 {
            let range = [
                at + fixed(gap.into()),
                at + fixed(gap.into()) + fixed(width.into()),
            ];
            at = range[1];
            if self.stems.len() < MAX_STEMS && self.map.is_none() {
                self.stems.push(Stem {
                    range,
                    fitted: None,
                });
            }
        }
    }

    pub fn set_mask(&mut self, bytes: &[u8], is_for_counters: bool) {
        let mask = std::array::from_fn(|it| {
            if bytes.len() > MAX_STEMS / 8 {
                0xff
            } else {
                bytes.get(it).map_or(0, |it| *it)
            }
        });
        if is_for_counters {
            self.build(mask);
        } else if std::mem::replace(&mut self.mask, mask) != mask {
            self.map = None;
        }
    }

    /// From font units to pixels.
    pub fn apply(&mut self, point: [f32; 2]) -> [f32; 2] {
        let [x, y] = point.map(|it| fixed(it.into()));
        let map = self.map.take().unwrap_or_else(|| self.build(self.mask));
        [mul(x, self.scale), self.map.insert(map).apply(y)].map(|it| (it & !0x3ff) as f32 / 65536.)
    }

    fn edges(&self, index: usize) -> Pair {
        let Stem {
            range: [from, to],
            fitted,
        } = self.stems[index];
        let edge = |is_top: bool, is_pair, units| Edge {
            is_top,
            is_pair,
            is_locked: fitted.is_some(),
            stem: Some(index),
            units,
            pixels: fitted.map_or_else(|| mul(units, self.scale), |it| it[usize::from(is_top)]),
            scale: self.scale,
        };
        match to - from {
            width if width == -21 * ONE => [Some(edge(false, false, to)), None],
            width if width == -20 * ONE => [None, Some(edge(true, false, from))],
            _ => [
                Some(edge(false, true, from.min(to))),
                Some(edge(true, true, from.max(to))),
            ],
        }
    }

    /// Aligns a stem that ends in a zone.
    fn capture(&self, pair: &mut Pair) -> bool {
        let by = self.zones.iter().find_map(|zone| {
            let edge = pair[usize::from(!zone.is_bottom)].filter(|it| {
                (zone.range[0] - self.blue_fuzz..=zone.range[1] + self.blue_fuzz)
                    .contains(&it.units)
            })?;
            let to = match zone.is_bottom {
                _ if self.suppresses_overshoot => zone.flat,
                true if zone.range[1] - edge.units >= self.blue_shift => {
                    round(edge.pixels).min(zone.flat - ONE)
                }
                false if edge.units - zone.range[0] >= self.blue_shift => {
                    round(edge.pixels).max(zone.flat + ONE)
                }
                _ => round(edge.pixels),
            };
            Some(to - edge.pixels)
        });
        by.map(|by| {
            pair.iter_mut()
                .flatten()
                .for_each(|it| (it.pixels, it.is_locked) = (it.pixels + by, true))
        })
        .is_some()
    }

    /// Returns the stems that are left too.
    fn lock(&self, mask: Mask) -> (Map, Vec<Pair>) {
        let (mut map, mut rest) = (
            Map {
                edges: Vec::new(),
                scale: self.scale,
            },
            Vec::new(),
        );
        spend((1 + self.stems.len()) * MAX_STEMS);
        if self.fits_em_box {
            map.insert(
                [
                    Some(self.synthetic(false, EM_BOTTOM - 1, -MIN_COUNTER)),
                    None,
                ],
                None,
            );
            map.insert(
                [None, Some(self.synthetic(true, EM_TOP + 1, MIN_COUNTER))],
                None,
            );
        }
        for index in (0..self.stems.len()).filter(|it| mask[it / 8] & 0x80 >> (it % 8) != 0) {
            let mut pair = self.edges(index);
            if self.stems[index].fitted.is_some() || self.capture(&mut pair) {
                map.insert(pair, None);
            } else {
                rest.push(pair);
            }
        }
        (map, rest)
    }

    fn synthetic(&self, is_top: bool, units: Fixed, by: Fixed) -> Edge {
        Edge {
            is_top,
            is_pair: false,
            is_locked: true,
            stem: None,
            units,
            pixels: round(mul(units, self.scale)) + by,
            scale: self.scale,
        }
    }

    fn build(&mut self, mask: Mask) -> Map {
        if self.initial.is_none() {
            let mut map = self.lock([0xff; _]).0;
            if map.edges.first().is_none_or(|it| it.units > 0)
                || map.edges.last().is_some_and(|it| it.units < 0)
            {
                map.insert([Some(self.synthetic(false, 0, 0)), None], None);
            }
            map.adjust();
            self.initial = Some(map);
        }
        let (mut map, rest) = self.lock(mask);
        rest.into_iter()
            .for_each(|it| map.insert(it, self.initial.as_ref()));
        map.adjust();
        for edge in &map.edges {
            if let Some(stem) = edge.stem {
                self.stems[stem].fitted.get_or_insert_default()[usize::from(edge.is_top)] =
                    edge.pixels;
            }
        }
        map
    }
}
