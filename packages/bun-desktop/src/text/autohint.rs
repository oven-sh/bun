//! Fits outlines to the grid without instructions from the font, like the "light" mode of FreeType.
//!
//! Derived from the auto-hinter of FreeType and its port in skrifa. Copyright (c) The FreeType Project (www.freetype.org),
//! (c) 2019 Fontations Developers. FreeType License and MIT, see `licenses/freetype.txt` and `licenses/fontations.txt`.

mod edges;
mod fit;
mod outline;
mod scripts;
mod styles;

use edges::Axis;
use outline::{Outline, Point};
use scripts::{Group, LONG, NEUTRAL, SUB_TOP, TOP, X_HEIGHT};
pub use styles::{Style, Styles};

use super::sfnt::Font;
use super::sfnt::variations::Coords;
use super::shaper::layout::Table;
use crate::gfx::{self, Path};

/// `b` has 16 bits after the point.
fn mul(a: i32, b: i32) -> i32 {
    let product = i64::from(a) * i64::from(b);
    ((product + 0x8000 - i64::from(product < 0)) >> 16) as i32
}

fn mul_div(a: i32, b: i32, c: i32) -> i32 {
    let [x, y, z] = [a, b, c].map(|it| u64::from(it.unsigned_abs()));
    (x * y + z / 2)
        .checked_div(z)
        .map_or(1 << 24, |it| it as i32)
        .wrapping_mul(if a ^ b ^ c < 0 { -1 } else { 1 })
}

fn div(a: i32, b: i32) -> i32 {
    mul_div(a, 1 << 16, b)
}

fn round(value: i32) -> i32 {
    (value + 32) & !63
}

/// A height that many glyphs share.
#[derive(Clone, Copy)]
pub struct Zone {
    /// Of flat and of round parts.
    heights: [i32; 2],
    /// Of the glyphs that tell.
    tallest: i32,
    kind: u8,
}

pub struct Metrics {
    group: Group,
    /// The usual and the largest width of stems along each axis.
    widths: [[i32; 2]; 2],
    zones: Vec<Zone>,
}

fn widths(outline: &Outline, along: usize, em: i32) -> [i32; 2] {
    let mut axis = Axis::new(outline, along, em);
    axis.link(em, 0);
    let stems = axis
        .segments
        .iter()
        .enumerate()
        .filter_map(|(index, it)| Some((it, axis.segments[it.link.filter(|it| *it > index)?])));
    let mut widths: Vec<i32> = stems
        .map(|(a, b)| (a.position - b.position).abs())
        .take(16)
        .collect();
    widths.sort_unstable();
    let (mut start, mut at, last) = (0, 1, widths.len().saturating_sub(1));
    while at <= last {
        let is_apart = widths[at] - widths[start] > em / 100;
        if is_apart || at == last {
            at += usize::from(!is_apart);
            widths[start] = widths[start..at]
                .iter_mut()
                .map(std::mem::take)
                .sum::<i32>()
                / at as i32;
            start = if at < last { at + 1 } else { start };
        }
        at += 1;
    }
    let first = widths.first().map_or(0, |it| *it);
    [
        first,
        widths
            .iter()
            .skip(1)
            .rfind(|it| **it != 0)
            .map_or(first, |it| *it),
    ]
}

/// The first and the last point of a flat part, and the first and the last one on the curve.
type Part = ([usize; 2], [Option<usize>; 2]);

/// For scripts whose extrema are often not on the zone.
fn find_long_part(
    points: &[Point],
    best: usize,
    [first, last]: [usize; 2],
    after: usize,
    em: i32,
) -> Option<Part> {
    let (x, y) = (
        |it: usize| points[it].units[0],
        |it: usize| points[it].units[1],
    );
    let on_curve = |it: usize| points[it].is_on_curve.then_some(it);
    let before = (1..points.len())
        .map(|it| (best + points.len() - it) % points.len())
        .find(|it| x(*it) != x(best))?;
    let next = |it: usize| (it + 1) % points.len();
    let (mut start, mut end, mut on, mut is_open) = (last, last, [None; 2], false);
    for _ in 0..points.len() * 4 {
        if !std::mem::replace(&mut is_open, true) {
            (start, on) = (end, [on_curve(end); 2]);
        }
        end = next(end);
        let rise = (y(end) - y(start)).abs();
        if (y(best) - y(start)).abs() > em / 4 {
            is_open = false;
            continue;
        }
        if rise > 5 && (x(end) - x(start)).abs() <= 20 * rise {
            is_open = false;
        } else {
            on = [on[0].or(on_curve(end)), on_curve(end).or(on[1])];
            if (x(start) < x(end)) == (x(before) < x(best)) && (x(end) - x(start)).abs() >= em / 25
            {
                loop {
                    if (y(next(end)) - y(start)).abs() > 5
                        && (x(after) - x(start)).abs() <= 20 * rise
                    {
                        return Some(([start, end], on));
                    }
                    end = next(end);
                    on = [on[0].or(on_curve(end)), Some(end)];
                    if end == first {
                        return Some(([start, end], on));
                    }
                }
            }
        }
        if end == first {
            break;
        }
    }
    None
}

/// The height of the highest or lowest part, and whether it is round.
fn extremum(outline: &Outline, kind: u8, em: i32, tallest: &mut [i32; 2]) -> Option<(i32, bool)> {
    let (sign, mut best) = (if kind & (TOP | SUB_TOP) != 0 { 1 } else { -1 }, None);
    for contour in outline.contours.iter().filter(|it| it.len() > 1) {
        for (index, y) in outline.points[contour.clone()]
            .iter()
            .map(|it| it.units[1])
            .enumerate()
        {
            let is_better = best.is_none_or(|(_, _, best)| y * sign > best * sign);
            best = if is_better {
                Some((contour, index, y))
            } else {
                best
            };
            *tallest = if is_better == (sign == 1) {
                [tallest[0].max(y), tallest[1]]
            } else {
                [tallest[0], tallest[1].max(-y)]
            };
        }
    }
    let (contour, best, mut height) = best?;
    let (points, count) = (&outline.points[contour.clone()], contour.len());
    let (mut ends, mut on, mut after) =
        ([best; 2], [points[best].is_on_curve.then_some(best); 2], 0);
    for side in 0..2 {
        for index in (1..=count).map(|it| (best + if side == 0 { count - it } else { it }) % count)
        {
            let [run, rise] =
                [0, 1].map(|it| (points[index].units[it] - points[best].units[it]).abs());
            after = index;
            if rise > 5 && run <= 20 * rise {
                break;
            }
            ends[side] = index;
            if points[index].is_on_curve {
                on[side] = Some(index);
                on[1 - side].get_or_insert(index);
            }
        }
    }
    let width = |[first, last]: [usize; 2]| (points[last].units[0] - points[first].units[0]).abs();
    if kind & LONG != 0 && width(ends) < em / 25 && (ends[1] + count - ends[0]) % count + 3 <= count
    {
        points
            .iter()
            .any(|it| it.units[0] != points[best].units[0])
            .then_some(())?;
        if let Some(part) = find_long_part(points, best, ends, after, em) {
            (ends, on, height) = (part.0, part.1, points[part.0[0]].units[1]);
        }
    }
    let is_flat = on[0]
        .zip(on[1])
        .is_some_and(|it| width(it.into()) > em / 14)
        || ends.iter().all(|it| points[*it].is_on_curve);
    (is_flat || kind & NEUTRAL == 0).then_some((height, !is_flat))
}

fn medians(mut lists: [Vec<i32>; 2], is_top: bool) -> Option<[i32; 2]> {
    lists.iter_mut().for_each(|it| it.sort_unstable());
    let [flat, round] = lists.map(|it| it.get(it.len() / 2).copied());
    let [flat, round] = [flat.or(round)?, round.or(flat)?];
    Some(if is_top != (round > flat) {
        [(flat + round) / 2; 2]
    } else {
        [flat, round]
    })
}

impl Metrics {
    pub fn new(
        font: &Font,
        substitutions: Option<&Table>,
        coords: &Coords,
        style: Style,
    ) -> Metrics {
        let (em, group) = (i32::from(font.units_per_em), style.script.group);
        if font.is_symbol() {
            return Metrics {
                group,
                widths: [[0; 2]; 2],
                zones: Vec::new(),
            };
        }
        let shape = style.shaper(font, substitutions);
        let outline =
            |glyph: u32| Outline::new(&font.shape(Some(glyph).filter(|it| *it != 0)?, coords)?, em);
        let standard = style
            .script
            .standard
            .split(' ')
            .map(&shape)
            .find(|it| matches!(it[..], [glyph] if glyph != 0));
        let standard = standard
            .and_then(|it| outline(it[0]))
            .filter(|it| !it.points.is_empty());
        let widths = [0, 1].map(|along| {
            standard
                .as_ref()
                .map_or([50 * em / 2048, 0], |it| widths(it, along, em))
        });
        let outlines = |cluster: &str| {
            shape(cluster)
                .into_iter()
                .filter_map(outline)
                .filter(|it| it.points.len() > 2)
        };
        let zone = |&(clusters, kind): &(&str, u8)| {
            let (mut heights, mut tallest, sign) = (
                [Vec::new(), Vec::new()],
                [i32::MIN; 2],
                if kind & TOP != 0 { 1 } else { -1 },
            );
            if group == Group::Cjk {
                for (clusters, heights) in clusters.split('|').zip(&mut heights) {
                    let extreme = |it: Outline| {
                        Some(it.points.iter().map(|it| it.units[1] * sign).max()? * sign)
                    };
                    heights.extend(clusters.split(' ').flat_map(outlines).filter_map(extreme));
                }
                return Some(Zone {
                    heights: medians(heights, kind & TOP == 0)?,
                    tallest: 0,
                    kind,
                });
            }
            for cluster in clusters.split(' ') {
                let extrema =
                    outlines(cluster).filter_map(|it| extremum(&it, kind, em, &mut tallest));
                if let Some((height, is_round)) = extrema.min_by_key(|it| -it.0 * sign) {
                    heights[usize::from(is_round)].push(height);
                }
            }
            Some(Zone {
                heights: medians(heights, kind & (TOP | SUB_TOP) != 0)?,
                tallest: tallest[0].max(tallest[1]),
                kind,
            })
        };
        let mut zones: Vec<Zone> = style.script.zones.iter().filter_map(zone).collect();
        let upper = |it: &Zone| usize::from(it.kind & (TOP | SUB_TOP) != 0);
        let mut sorted: Vec<usize> =
            (0..if group == Group::Cjk { 0 } else { zones.len() }).collect();
        sorted.sort_by_key(|it| zones[*it].heights[1 - upper(&zones[*it])]);
        for &[first, second] in sorted.array_windows() {
            let (which, limit) = (
                upper(&zones[first]),
                zones[second].heights[upper(&zones[second])],
            );
            zones[first].heights[which] = zones[first].heights[which].min(limit);
        }
        Metrics {
            group,
            widths,
            zones,
        }
    }

    /// So that small letters end at a pixel.
    fn vertical_scale(&self, scale: i32, em: i32) -> i32 {
        let Some(zone) = self.zones.iter().find(|it| it.kind & X_HEIGHT != 0) else {
            return scale;
        };
        let scaled = mul(scale, zone.heights[1]);
        let fitted = if scaled & 63 == 0 {
            scale
        } else {
            mul_div(scale, (scaled + 40) & !63, scaled)
        };
        let tallest = self.zones.iter().fold(em, |all, it| all.max(it.tallest));
        if mul(tallest, fitted - scale).abs() < 128 {
            fitted
        } else {
            scale
        }
    }

    fn fitted_zones(&self, scale: i32) -> Vec<(Zone, [i32; 2])> {
        let fit = |zone: &Zone| {
            let (flat, overshoot) = (
                round(mul(zone.heights[0], scale)),
                mul(zone.heights[0] - zone.heights[1], scale),
            );
            (overshoot.abs() <= 48).then_some(())?;
            let by = if self.group == Group::Cjk {
                let left = div(flat, scale) - zone.heights[1];
                round(mul(left.abs(), scale)) * if left < 0 { -1 } else { 1 }
            } else {
                [0, 0, 32, 64][overshoot.unsigned_abs() as usize / 16] * overshoot.signum()
            };
            Some((*zone, [flat, flat - by]))
        };
        let mut zones: Vec<_> = self.zones.iter().filter_map(fit).collect();
        let others: Vec<_> = zones
            .iter()
            .filter(|it| it.0.kind & SUB_TOP == 0)
            .map(|it| it.1)
            .collect();
        zones.retain(|(zone, fitted)| {
            zone.kind & SUB_TOP == 0
                || !others
                    .iter()
                    .any(|it| it[0] <= fitted[1] && it[1] >= fitted[0])
        });
        zones
    }

    /// With y up.
    pub fn outline(
        &self,
        font: &Font,
        coords: &Coords,
        glyph: u32,
        is_mark: bool,
        size: f32,
    ) -> Option<Path> {
        let (mut shape, em, group) = (
            font.shape(glyph, coords)?,
            i32::from(font.units_per_em),
            self.group,
        );
        let (mut outline, scale) = (
            Outline::new(&shape, em)?,
            Some(div((size * 64.) as i32, em)).filter(|it| (1..1 << 22).contains(it))?,
        );
        let scales = [scale, self.vertical_scale(scale, em)];
        outline.scale(scales);
        let axes = if group == Group::Cjk {
            0..2
        } else {
            1..1 + usize::from(!self.zones.is_empty())
        };
        for along in axes {
            let mut axis = Axis::new(&outline, along, em);
            match group {
                Group::Cjk => axis.link_cjk(em, scale),
                _ => axis.link(em, self.widths[along][1]),
            }
            axis.find_edges(group, scales[along], self.widths[along][0]);
            if along == 1 && (group == Group::Cjk || !is_mark) {
                axis.find_zones(group, em, scales[1], &self.fitted_zones(scales[1]));
            }
            fit::fit(&mut axis.edges, along, group);
            outline.follow(&axis, group != Group::Cjk);
        }
        shape.points = outline
            .points
            .iter()
            .map(|it| gfx::Point::new(it.fitted[0] as f32 / 64., it.fitted[1] as f32 / 64.))
            .collect();
        shape.path()
    }
}
