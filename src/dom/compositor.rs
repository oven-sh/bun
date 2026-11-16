//! What the renderer scrolls and animates by itself.

use core::cell::RefCell;
use std::rc::Rc;

use crate::abi::{self, Matrix, Rect};
use crate::boxes::{BoxId, VIEWPORT};
use crate::document::Document;
use crate::name::{Map, Set};
use crate::properties::Style;
use crate::tree::{DOCUMENT, NodeId};
use crate::types::*;

#[derive(Clone, Copy)]
pub(crate) enum Timeline {
    /// In the milliseconds of the document.
    Time {
        start: f64,
        cycle: f64,
        cycles: f64,
    },
    Offset(NodeId, usize),
}

/// The animated values of an element, by the position on the timeline.
pub(crate) struct Sampled {
    pub(crate) timeline: Timeline,
    pub(crate) size: [f32; 2],
    pub(crate) transforms: Vec<(f32, Matrix)>,
    pub(crate) opacities: Vec<(f32, [f32; 1])>,
}

struct Scrolled {
    id: u32,
    applied: [f64; 2],
    generation: u32,
    is_moving: bool,
}

#[derive(Default)]
pub(crate) struct Compositor {
    pub(crate) is_on: bool,
    /// From the clock of the document to that of the renderer.
    pub(crate) clock_offset: f64,
    scrolled: RefCell<Map<NodeId, Scrolled>>,
    last_id: core::cell::Cell<u32>,
    pub(crate) sampled: Map<NodeId, Rc<Sampled>>,
    /// They have a `wheel` listener that is not passive.
    pub(crate) wheel_blockers: Set<NodeId>,
    is_applying: bool,
}

/// Leaves out those that interpolation gives.
pub(crate) fn simplify<const N: usize>(
    samples: Vec<(f32, [f32; N])>,
    tolerance: [f32; N],
) -> Vec<(f32, [f32; N])> {
    let mut kept = Vec::new();
    let mut start = 0;
    kept.extend(samples.first().copied());
    for end in 2..=samples.len() {
        let covers = samples.get(end).is_some_and(|(to, last)| {
            let (from, first) = samples[start];
            samples[start + 1..end].iter().all(|(at, value)| {
                let t = (at - from) / (to - from);
                (0..N).all(|it| {
                    (first[it] + (last[it] - first[it]) * t - value[it]).abs() <= tolerance[it]
                })
            })
        });
        if !covers {
            start = end - 1;
            kept.push(samples[start]);
        }
    }
    kept
}

/// `numbers` is as in `abi::Driver`.
pub(crate) fn interpolate(numbers: &[f32], position: f32) -> Matrix {
    let (samples, _) = numbers.as_chunks::<7>();
    let next = samples.partition_point(|it| it[0] <= position);
    let (from, to) = (
        &samples[next.saturating_sub(1)],
        &samples[next.min(samples.len() - 1)],
    );
    let t = if to[0] > from[0] {
        (position - from[0]) / (to[0] - from[0])
    } else {
        0.0
    };
    core::array::from_fn(|it| crate::values::mix(from[it + 1], to[it + 1], t))
}

/// The points of a monotonic function whose slope is 0 or 1.
pub(crate) fn corners(
    from: (f32, f32),
    to: (f32, f32),
    value: &dyn Fn(f32) -> f32,
    out: &mut Vec<(f32, [f32; 1])>,
) {
    let (run, rise) = (to.0 - from.0, (to.1 - from.1).abs());
    if rise < 0.01 || run - rise < 0.01 || run <= 0.25 {
        return out.push((to.0, [to.1]));
    }
    let middle = from.0.midpoint(to.0);
    let middle = (middle, value(middle));
    corners(from, middle, value, out);
    corners(middle, to, value, out);
}

impl Compositor {
    pub(crate) fn forget(&mut self, node: NodeId) {
        self.scrolled.get_mut().remove(&node);
        self.sampled.remove(&node);
        self.wheel_blockers.remove(&node);
    }

    /// The renderer starts from nothing with one that was not in the list before.
    pub(crate) fn keep_scrollers(&mut self, scrollers: &[abi::Scroller]) {
        self.scrolled
            .get_mut()
            .retain(|_, it| scrollers.iter().any(|scroller| scroller.id == it.id));
    }
}

impl Document {
    /// How far beyond the scrollport the contents are painted.
    pub(crate) fn overscan(&self, id: BoxId) -> [f32; 2] {
        let client = self.client_box(id);
        [client.width, client.height].map(|it| it.clamp(500.0, 1200.0))
    }

    /// With the axes that scroll and the ones that contain the scrolling.
    fn composited(&self, id: BoxId) -> Option<([[f32; 2]; 2], [bool; 2], [bool; 2], &Style)> {
        let it = &self.boxes[id];
        (self.compositor.is_on && it.scrolls()).then_some(())?;
        let range = self.scroll_range(id);
        let scrolls = [0, 1]
            .map(|axis| it.overflow[axis] != Overflow::Hidden && range[axis][1] > range[axis][0]);
        let style = if id == VIEWPORT {
            self.tree.style(self.tree.root_element())?
        } else {
            &it.style
        };
        let contains =
            [style.scroll.overscroll_x, style.scroll.overscroll_y].map(|it| it != Overscroll::Auto);
        (scrolls.contains(&true) || contains.contains(&true))
            .then_some((range, scrolls, contains, style))
    }

    pub(crate) fn composited_range(&self, id: BoxId) -> Option<[[f32; 2]; 2]> {
        self.composited(id).map(|it| it.0)
    }

    /// Stops what the renderer is scrolling by itself.
    pub(crate) fn interrupt_compositor(&mut self, node: NodeId, moves: bool) {
        if let Some(it) = self
            .compositor
            .scrolled
            .get_mut()
            .get_mut(&node)
            .filter(|it| moves || it.is_moving)
        {
            (it.generation, it.is_moving) = (it.generation + 1, false);
            self.repaint(node);
        }
    }

    pub(crate) fn composited_scroller(&self, id: BoxId, parent: u32) -> Option<abi::Scroller> {
        let (it, (range, scrolls, contains, style)) = (&self.boxes[id], self.composited(id)?);
        let has_image = |style: &Style| style.background.image.iter().any(|it| it.0.is_some());
        let by_engine = !style.scroll.snap_type.is_empty()
            || has_image(style)
                && (id == VIEWPORT
                    || style
                        .background
                        .attachment
                        .iter()
                        .any(|it| *it == Attachment::Local))
            || id == VIEWPORT
                && self
                    .tree
                    .style(self.tree.body())
                    .is_some_and(|it| has_image(it));
        let flags = [
            (scrolls[0], abi::SCROLLS_X),
            (scrolls[1], abi::SCROLLS_Y),
            (contains[0], abi::CONTAINS_X),
            (contains[1], abi::CONTAINS_Y),
            (by_engine, abi::SCROLLED_BY_ENGINE),
        ];
        let mut scrolled = self.compositor.scrolled.borrow_mut();
        let state = scrolled.entry(it.node).or_insert_with(|| {
            self.compositor.last_id.update(|it| it + 1);
            Scrolled {
                id: self.compositor.last_id.get(),
                applied: [0.0; 2],
                generation: 0,
                is_moving: false,
            }
        });
        Some(abi::Scroller {
            id: state.id,
            parent,
            offset: self.scroll_offset(it.node),
            min: range.map(|it| it[0]),
            max: range.map(|it| it[1]),
            applied: state.applied,
            generation: state.generation,
            flags: flags
                .into_iter()
                .filter(|it| it.0)
                .fold(0, |all, it| all | it.1),
        })
    }

    /// `total` is how far the renderer has scrolled it.
    pub(crate) fn scrolled_by_compositor(
        &mut self,
        id: u32,
        total: [f64; 2],
        has_ended: bool,
        generation: u32,
    ) {
        let found = self
            .compositor
            .scrolled
            .get_mut()
            .iter()
            .find(|it| (it.1.id, it.1.generation) == (id, generation));
        let Some((node, applied)) = found.map(|it| (*it.0, it.1.applied)) else {
            return;
        };
        let old = self.scroll_offset(node);
        let wanted = [0, 1].map(|axis| f64::from(old[axis]) + total[axis] - applied[axis]);
        self.compositor.is_applying = true;
        self.scroll_by_user_to(node, wanted.map(|it| it as f32), has_ended);
        self.compositor.is_applying = false;
        let new = self.scroll_offset(node);
        if let Some(state) = self.compositor.scrolled.get_mut().get_mut(&node) {
            state.is_moving = !has_ended;
            state.applied = [0, 1].map(|axis| {
                let rounded_off = wanted[axis] - f64::from(new[axis]);
                total[axis]
                    - if rounded_off.abs() < 1.0 {
                        rounded_off
                    } else {
                        0.0
                    }
            });
        }
    }

    pub(crate) fn scroll_offset_changed(&mut self, node: NodeId, offset: [f32; 2]) {
        let is_shown = self.compositor.is_applying
            && (self
                .own_box(node)
                .zip(self.pictures.current())
                .and_then(|(id, picture)| {
                    let (painted, overscan) = (picture.painted_offset(node)?, self.overscan(id));
                    Some(
                        (0..2).all(|axis| {
                            (offset[axis] - painted[axis]).abs() <= overscan[axis] * 0.4
                        }),
                    )
                }))
                == Some(true);
        match is_shown {
            true => self.repaint_eventually(self.nearest_box(node)),
            false => self.repaint(node),
        }
    }

    pub(crate) fn blocks_wheel(&self, node: NodeId) -> bool {
        let blockers = &self.compositor.wheel_blockers;
        !blockers.is_empty()
            && (blockers.contains(&DOCUMENT)
                || core::iter::once(node)
                    .chain(self.tree.flat_ancestors(node))
                    .any(|it| blockers.contains(&it)))
    }

    /// What `rect` covers at any time.
    pub(crate) fn swept(&self, id: BoxId, rect: &Rect) -> Option<Rect> {
        let sampled = self.compositor.sampled.get(&self.boxes[id].node)?;
        sampled
            .transforms
            .iter()
            .map(|it| rect.transformed(&it.1))
            .reduce(|a, b| a.union(&b))
    }
}
