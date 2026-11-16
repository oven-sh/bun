//! `border-image` and `-webkit-mask-box-image`

use crate::abi::{Rect, Tile};
use crate::background::{Frame, concrete_size};
use crate::paint::{Painter, Space};
use crate::properties::{Id, Style};
use crate::types::*;
use crate::values::*;

/// The slice, the width, the outset and the repetition.
type Ids = [Id; 4];

pub(crate) const BORDER: Ids = [
    Id::BorderImageSlice,
    Id::BorderImageWidth,
    Id::BorderImageOutset,
    Id::BorderImageRepeat,
];
pub(crate) const MASK: Ids = [
    Id::WebkitMaskBoxImageSlice,
    Id::WebkitMaskBoxImageWidth,
    Id::WebkitMaskBoxImageOutset,
    Id::WebkitMaskBoxImageRepeat,
];

#[derive(Clone)]
enum Amount {
    Auto,
    Number(f32),
    Length(Lp),
}

/// And whether `fill` follows.
fn amounts(style: &Style, id: Id) -> Option<([Amount; 4], bool)> {
    let cx = Ctx {
        zoom: style.zoom,
        ..Ctx::dummy()
    };
    let one = |p: &mut P| {
        (keyword(p, "auto").then_some(Amount::Auto))
            .or_else(|| number(p, &cx).map(Amount::Number))
            .or_else(|| Lp::parse(p, &cx).map(Amount::Length))
    };
    let (given, fills) = parse_all(style.other(id).as_bytes(), |p| {
        Some((
            core::iter::from_fn(|| one(p)).collect::<Vec<_>>(),
            keyword(p, "fill"),
        ))
    })?;
    let indices = [[0, 0, 0, 0], [0, 1, 0, 1], [0, 1, 2, 1], [0, 1, 2, 3]]
        .get(given.len().checked_sub(1)?)?;
    Some((indices.map(|it| given[it].clone()), fills))
}

pub(crate) fn outsets(style: &Style, id: Id, border: [f32; 4]) -> [f32; 4] {
    let Some((given, _)) = style.other_if_set(id).and_then(|_| amounts(style, id)) else {
        return [0.0; 4];
    };
    [0, 1, 2, 3].map(|side| match &given[side] {
        Amount::Number(factor) => factor * border[side],
        Amount::Length(length) => length.resolve(0.0),
        Amount::Auto => 0.0,
    })
}

/// The size of a tile, where the first one is, and the step.
fn repeat(rule: &str, available: f32, size: f32) -> Option<[f32; 3]> {
    Some(match rule {
        "repeat" => [size, (available - size) / 2.0, size],
        "round" => [
            available / (available / size).round().max(1.0),
            0.0,
            available / (available / size).round().max(1.0),
        ],
        "space" => {
            let count = Some((available / size).floor()).filter(|it| *it > 0.0)?;
            let gap = (available - size * count) / (count + 1.0);
            [size, gap, size + gap]
        }
        _ => [available, 0.0, 0.0],
    })
}

impl Painter<'_> {
    /// Whether the image is there.
    pub(crate) fn nine_pieces(
        &mut self,
        image: &Image,
        [slice, width, outset, rules]: Ids,
        style: &Style,
        frame: &Frame,
        space: &Space,
    ) -> bool {
        let Some(ready) = self.document.ready(image, style) else {
            return false;
        };
        let (Some((slices, fills)), Some((widths, _))) =
            (amounts(style, slice), amounts(style, width))
        else {
            return false;
        };
        let (mut space, whole) = (*space, frame.unsliced());
        let outsets = outsets(style, outset, whole.border).map(|it| -it);
        if frame.whole.is_some() {
            let cut = [0, 1, 2, 3].map(|side| {
                if frame.border[side] == whole.border[side] {
                    outsets[side]
                } else {
                    0.0
                }
            });
            self.clip(
                crate::paint::square(frame.shape.rect.shrunk(cut)),
                &mut space,
            );
        }
        let area = self.snap_rect(whole.shape.rect.shrunk(outsets));
        let (extent, size) = (
            [area.height, area.width],
            concrete_size(
                [None; 2],
                ready.natural,
                ready.ratio,
                [area.width, area.height],
            ),
        );
        let slices = [0, 1, 2, 3].map(|side| match &slices[side] {
            Amount::Number(number) => (number * ready.unit).min(size[1 - side % 2]),
            Amount::Length(length) => length.resolve(size[1 - side % 2]).min(size[1 - side % 2]),
            Amount::Auto => 0.0,
        });
        let widths = [0, 1, 2, 3].map(|side| match &widths[side] {
            Amount::Number(factor) => factor * whole.border[side],
            Amount::Length(length) => length.resolve(extent[side % 2]),
            Amount::Auto => slices[side],
        });
        let scale = (extent[0] / (widths[0] + widths[2]))
            .min(extent[1] / (widths[1] + widths[3]))
            .min(1.0);
        let mut widths = widths.map(|it| self.snap(it * scale));
        for side in 0..2 {
            widths[side + 2] -= (widths[side] + widths[side + 2] - extent[side]).max(0.0);
        }
        let mut rules = style.other(rules).split_ascii_whitespace();
        let first = rules.next().unwrap_or_default();
        let rules = [first, rules.next().unwrap_or(first)];
        let thirds = |start: f32, length: f32, before: f32, after: f32| {
            [
                [start, before],
                [start + before, length - before - after],
                [start + length - after, after],
            ]
        };
        let from = [
            thirds(0.0, size[0], slices[3], slices[1]),
            thirds(0.0, size[1], slices[0], slices[2]),
        ];
        let to = [
            thirds(area.x, area.width, widths[3], widths[1]),
            thirds(area.y, area.height, widths[0], widths[2]),
        ];
        let factor = |side: usize| {
            (slices[side] > 0.0 && widths[side] > 0.0).then(|| widths[side] / slices[side])
        };
        for cell in (0..9)
            .map(|it| [it % 3, it / 3])
            .filter(|it| fills || *it != [1, 1])
        {
            let [source, target] = [&from, &to].map(|it| [it[0][cell[0]], it[1][cell[1]]]);
            if source.iter().chain(&target).any(|it| it[1] <= 0.0) {
                continue;
            }
            let along = |axis: usize| match (cell[axis], cell[1 - axis]) {
                (1, 1) => repeat(
                    rules[axis],
                    target[axis][1],
                    source[axis][1] * factor([0, 3][axis]).or(factor([2, 1][axis])).unwrap_or(1.0),
                ),
                (1, _) => repeat(
                    rules[axis],
                    target[axis][1],
                    source[axis][1] * target[1 - axis][1] / source[1 - axis][1],
                ),
                _ => Some([target[axis][1], 0.0, 0.0]),
            };
            let (Some(x), Some(y)) = (along(0), along(1)) else {
                continue;
            };
            let [part, clip] = [source, target].map(|[x, y]| Rect::new([x[0], y[0], x[1], y[1]]));
            let tile = Tile {
                rect: Rect::new([clip.x + x[1], clip.y + y[1], x[0], y[0]]),
                step: [x[2], y[2]],
            };
            self.draw_part(&ready, size, part, clip, tile, style, &space);
        }
        true
    }
}
