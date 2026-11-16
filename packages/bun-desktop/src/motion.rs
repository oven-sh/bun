//! Scrolling and animations that do not wait for JavaScript.

use resvg::tiny_skia::{Point, Transform};
use rustc_hash::FxHashMap;

use crate::abi::{self, Driver, Hit, Item, Rect, Scroller, Source};
use crate::bridge::{self, Kind};
use crate::paint::raster::map_rect;
use crate::paint::scene::{Scene, intersect, union};
use crate::surface::contains;

#[derive(Default, PartialEq)]
pub struct Tables {
    pub scrollers: Vec<Scroller>,
    pub drivers: Vec<Driver>,
    pub numbers: Vec<f32>,
    pub hits: Vec<Hit>,
}

/// `ScrollOffsetAnimationCurve` in Chromium.
#[derive(Clone, Copy)]
struct Glide {
    from: [f64; 2],
    to: [f64; 2],
    start: f64,
    duration: f64,
    initial_slope: f64,
}

impl Glide {
    fn duration_for(distance: f64) -> f64 {
        (14. - distance.abs() / 60.).clamp(6., 12.) * 1000. / 60.
    }

    /// With its derivative.
    fn progress(&self, now: f64) -> (f64, f64) {
        let x = ((now - self.start) / self.duration).clamp(0., 1.);
        let at = |a: f64, b: f64, t: f64| {
            ((1. - 3. * b + 3. * a) * t + 3. * b - 6. * a) * t * t + 3. * a * t
        };
        let slope = |a: f64, b: f64, t: f64| {
            (3. * (1. - 3. * b + 3. * a) * t + 6. * b - 12. * a) * t + 3. * a
        };
        let (mut t, y1) = (x, 0.42 * self.initial_slope);
        for _ in 0..6 {
            t -= (at(0.42, 0.58, t) - x) / slope(0.42, 0.58, t);
        }
        (at(y1, 1., t), slope(y1, 1., t) / slope(0.42, 0.58, t))
    }

    fn at(&self, now: f64) -> [f64; 2] {
        let progress = self.progress(now).0;
        [0, 1].map(|axis| self.from[axis] + (self.to[axis] - self.from[axis]) * progress)
    }

    fn toward(from: [f64; 2], to: [f64; 2], now: f64, ongoing: Option<Glide>) -> Glide {
        let longest = |from: [f64; 2], to: [f64; 2]| {
            let (x, y) = (to[0] - from[0], to[1] - from[1]);
            if x.abs() > y.abs() { x } else { y }
        };
        let distance = longest(from, to);
        let velocity = ongoing.map_or(0., |it| {
            it.progress(now).1 * longest(it.from, it.to) / it.duration
        });
        let mut duration = Glide::duration_for(distance);
        if velocity.abs() > 1e-5 && distance / velocity > 0. {
            duration = duration.min(distance / velocity * 2.5);
        }
        let initial_slope = (velocity * duration / distance).clamp(-1000., 1000.);
        // The frame that follows at once shows the first step.
        let start = if ongoing.is_some() {
            now
        } else {
            now - crate::host::interval().as_secs_f64() * 1000.
        };
        Glide {
            from,
            to,
            start,
            duration,
            initial_slope,
        }
    }
}

struct Scrolled {
    total: [f64; 2],
    reported: [f64; 2],
    generation: u32,
    glide: Option<Glide>,
    is_scrolling: bool,
}

#[derive(Clone, Copy)]
struct Latch {
    /// Of the scroller, if it is not the engine that scrolls.
    id: Option<u32>,
    position: [f32; 2],
    until: f64,
}

#[derive(Clone, Copy)]
struct Drag {
    id: u32,
    axis: usize,
    ratio: f32,
    pointer: f32,
    offset: f64,
}

#[derive(Clone, Copy, Default, PartialEq)]
pub enum Next {
    #[default]
    Never,
    At(f64),
    Frame,
}

impl Next {
    fn or(self, other: Next) -> Next {
        match (self, other) {
            (Next::At(a), Next::At(b)) => Next::At(a.min(b)),
            (Next::Never, next) | (next, Next::Never) => next,
            _ => Next::Frame,
        }
    }
}

#[derive(Default)]
pub struct Motion {
    pub tables: Tables,
    /// How many items the scene has before the ones that the tables count.
    first_item: usize,
    /// For each driver, where its item can be.
    reaches: Vec<Rect>,
    scrolled: FxHashMap<u32, Scrolled>,
    latch: Option<Latch>,
    drag: Option<Drag>,
    pub next: Next,
}

/// Calls `f` with each item, and the matrix and the clip around it.
fn walk(scene: &Scene, mut f: impl FnMut(usize, &Transform, Rect)) {
    const EVERYTHING: Rect = Rect {
        x: -1e9,
        y: -1e9,
        width: 2e9,
        height: 2e9,
    };
    let (mut stack, mut matrix, mut clip) = (Vec::new(), Transform::identity(), EVERYTHING);
    for (index, item) in scene.items.iter().enumerate() {
        f(index, &matrix, clip);
        match *item {
            Item::PushClip(shape) => {
                stack.push((matrix, clip));
                clip = intersect(clip, map_rect(&matrix, shape.rect));
            }
            Item::PushTransform([a, b, c, d, e, f]) | Item::PushVector([a, b, c, d, e, f]) => {
                stack.push((matrix, clip));
                matrix = matrix.pre_concat(Transform::from_row(a, b, c, d, e, f));
            }
            Item::PushClipOutline(outline) => {
                stack.push((matrix, clip));
                clip = intersect(clip, map_rect(&matrix, outline.bounds));
            }
            Item::PushClipPath { .. }
            | Item::PushLayer { .. }
            | Item::PushPattern { .. }
            | Item::PushProjection(_) => stack.push((matrix, clip)),
            Item::Pop => (matrix, clip) = stack.pop().unwrap_or((matrix, clip)),
            _ => {}
        }
    }
}

/// The values at `position`, and up to which position they stay the same.
fn sample<const N: usize>(samples: &[[f32; N]], position: f32) -> Option<([f32; N], Option<f32>)> {
    let after = samples.partition_point(|sample| sample[0] <= position);
    let (Some(from), Some(to)) = (
        after.checked_sub(1).map(|index| samples[index]),
        samples.get(after),
    ) else {
        let (first, last) = (samples.first()?, samples.last()?);
        return Some(if after == 0 {
            (*first, Some(first[0]))
        } else {
            (*last, Some(1.))
        });
    };
    let t = (position - from[0]) / (to[0] - from[0]);
    let values = std::array::from_fn(|index| from[index] + (to[index] - from[index]) * t);
    Some((values, (from[1..] == to[1..]).then_some(to[0])))
}

impl Motion {
    fn scroller(&self, id: u32) -> Option<&Scroller> {
        self.tables
            .scrollers
            .iter()
            .find(|scroller| scroller.id == id)
    }

    /// The totals at which the ends are reached.
    fn limits(scroller: &Scroller) -> [[f64; 2]; 2] {
        let total = |offset: [f32; 2], axis: usize| {
            scroller.applied[axis] + f64::from(offset[axis] - scroller.offset[axis])
        };
        [0, 1].map(|axis| [total(scroller.min, axis), total(scroller.max, axis)])
    }

    fn clamp(scroller: &Scroller, total: [f64; 2]) -> [f64; 2] {
        let limits = Motion::limits(scroller);
        [0, 1].map(|axis| total[axis].min(limits[axis][1]).max(limits[axis][0]))
    }

    /// From the offset that was painted to the one that is shown.
    fn moved(&self, index: u32) -> [f32; 2] {
        let Some(scroller) = self.tables.scrollers.get(index as usize) else {
            return [0.; 2];
        };
        let total = self
            .scrolled
            .get(&scroller.id)
            .map_or(scroller.applied, |it| Motion::clamp(scroller, it.total));
        [0, 1].map(|axis| (total[axis] - scroller.applied[axis]) as f32)
    }

    fn samples<const N: usize>(&self, driver: &Driver) -> &[[f32; N]] {
        self.tables
            .numbers
            .get(driver.samples.range())
            .unwrap_or_default()
            .as_chunks()
            .0
    }

    /// After `scene` and `tables` were replaced.
    pub fn adopt(&mut self, scene: &Scene, first_item: usize) {
        self.first_item = first_item;
        let scrollers = &self.tables.scrollers;
        self.scrolled
            .retain(|id, _| scrollers.iter().any(|scroller| scroller.id == *id));
        for Scroller {
            id,
            applied,
            generation,
            ..
        } in scrollers.iter().copied()
        {
            let at_rest = || Scrolled {
                total: applied,
                reported: applied,
                generation,
                glide: None,
                is_scrolling: false,
            };
            let scrolled = self.scrolled.entry(id).or_insert_with(at_rest);
            if scrolled.generation != generation {
                *scrolled = at_rest();
            }
        }
        let reach = |driver: &Driver| {
            let index = first_item + driver.item as usize;
            match (scene.items.get(index), driver.source) {
                (Some(Item::PushTransform(_)), Source::Time { .. }) => {
                    let children = scene.children(scene.content(index));
                    let inside = children.fold(Rect::default(), |all, child| {
                        union(all, scene.bounds(child))
                    });
                    self.samples(driver).iter().fold(
                        Rect::default(),
                        |all, &[_, a, b, c, d, e, f]| {
                            union(
                                all,
                                map_rect(&Transform::from_row(a, b, c, d, e, f), inside),
                            )
                        },
                    )
                }
                (Some(_), _) => scene.bounds(index),
                _ => Rect::default(),
            }
        };
        self.reaches = self.tables.drivers.iter().map(reach).collect();
    }

    fn advance_scrolls(&mut self, surface: u32, now: f64) -> Next {
        let mut next = Next::Never;
        let latch = self.latch.filter(|latch| latch.until > now);
        for scroller in &self.tables.scrollers {
            let Some(scrolled) = self
                .scrolled
                .get_mut(&scroller.id)
                .filter(|it| it.is_scrolling)
            else {
                continue;
            };
            if let Some(glide) = scrolled.glide {
                scrolled.glide = Some(glide).filter(|glide| now < glide.start + glide.duration);
                scrolled.total = Motion::clamp(
                    scroller,
                    scrolled.glide.map_or(glide.to, |glide| glide.at(now)),
                );
            }
            let held_until = latch
                .filter(|latch| latch.id == Some(scroller.id))
                .map(|latch| latch.until);
            let is_dragged = self.drag.is_some_and(|drag| drag.id == scroller.id);
            scrolled.is_scrolling = scrolled.glide.is_some() || held_until.is_some() || is_dragged;
            next = next.or(if scrolled.glide.is_some() {
                Next::Frame
            } else {
                held_until.map_or(Next::Never, Next::At)
            });
            if scrolled.total != scrolled.reported || !scrolled.is_scrolling {
                let ([x, y], has_ended) = (scrolled.total, !scrolled.is_scrolling);
                scrolled.reported = scrolled.total;
                let fields = [
                    surface.into(),
                    scroller.id.into(),
                    x,
                    y,
                    has_ended.into(),
                    scrolled.generation.into(),
                ];
                bridge::emit_numbers(Kind::Scroll, &fields, !has_ended);
            }
        }
        next
    }

    pub fn is_scrolling(&self) -> bool {
        self.scrolled.values().any(|scrolled| scrolled.is_scrolling)
    }

    /// The item as it is now, and when that changes.
    fn drive(&self, driver: &Driver, item: Item, now: f64) -> Option<(Item, Next)> {
        let position = match driver.source {
            Source::Scroll { scroller } => {
                let [x, y] = self.moved(scroller);
                return Some((Item::PushTransform([1., 0., 0., 1., -x, -y]), Next::Never));
            }
            Source::Offset { scroller, axis } => {
                let axis = usize::from(axis & 1);
                self.tables.scrollers.get(scroller as usize)?.offset[axis]
                    + self.moved(scroller)[axis]
            }
            Source::Time {
                start,
                cycle,
                cycles,
            } => match (now - start) / cycle {
                ..0. => 0.,
                elapsed if elapsed < cycles => elapsed.fract() as f32,
                _ if cycles.fract() == 0. && cycles > 0. => 1.,
                _ => cycles.fract() as f32,
            },
        };
        let (item, constant_until) = match item {
            Item::PushTransform(_) => {
                let ([_, matrix @ ..], until) = sample::<7>(self.samples(driver), position)?;
                (Item::PushTransform(matrix), until)
            }
            Item::PushLayer {
                bounds,
                blend,
                filters,
                ..
            } => {
                let ([_, opacity], until) = sample::<2>(self.samples(driver), position)?;
                (
                    Item::PushLayer {
                        bounds,
                        opacity,
                        blend,
                        filters,
                    },
                    until,
                )
            }
            Item::Backdrop { shape, filters, .. } => {
                let ([_, opacity], until) = sample::<2>(self.samples(driver), position)?;
                (
                    Item::Backdrop {
                        shape,
                        filters,
                        opacity,
                    },
                    until,
                )
            }
            _ => return None,
        };
        let next = match (driver.source, constant_until) {
            (Source::Time { start, .. }, _) if now < start => Next::At(start),
            (
                Source::Time {
                    start,
                    cycle,
                    cycles,
                },
                until,
            ) if now < start + cycle * cycles => {
                let cycles = ((now - start) / cycle).floor();
                until.map_or(Next::Frame, |until| {
                    Next::At(start + (cycles + f64::from(until)) * cycle + 0.1)
                })
            }
            _ => Next::Never,
        };
        Some((item, next))
    }

    /// Returns whether that changed `scene`.
    pub fn advance(&mut self, surface: u32, scene: &mut Scene, now: f64) -> bool {
        self.next = self.advance_scrolls(surface, now);
        let (mut has_changed, mut moving) = (false, FxHashMap::default());
        for (driver, reach) in self.tables.drivers.iter().zip(&self.reaches) {
            let index = self.first_item + driver.item as usize;
            let Some(item) = scene.items.get_mut(index) else {
                continue;
            };
            let Some((driven, next)) = self.drive(driver, *item, now) else {
                continue;
            };
            let differs = std::mem::replace(item, driven) != driven;
            match driver.source {
                Source::Time { .. } => drop(moving.insert(index, (*reach, next, differs))),
                _ => has_changed |= differs,
            }
        }
        if !moving.is_empty() {
            walk(scene, |index, matrix, clip| {
                let Some((reach, next, differs)) = moving.get(&index) else {
                    return;
                };
                let shown = intersect(map_rect(matrix, *reach), clip);
                if shown.width > 0. && shown.height > 0. {
                    (self.next, has_changed) = (self.next.or(*next), has_changed | differs);
                }
            });
        }
        if has_changed {
            scene.index();
        }
        has_changed
    }

    fn hit(&self, scene: &Scene, [x, y]: [f32; 2]) -> Option<Hit> {
        let (mut hits, mut found) = (self.tables.hits.iter().peekable(), None);
        walk(scene, |index, matrix, clip| {
            while let Some(hit) = hits.next_if(|hit| self.first_item + hit.item as usize <= index) {
                let mut point = Point::from_xy(x, y);
                if let Some(inverse) = matrix.invert().filter(|_| contains(clip, x, y)) {
                    inverse.map_point(&mut point);
                    found = Some(*hit)
                        .filter(|hit| contains(hit.rect, point.x, point.y))
                        .or(found);
                }
            }
        });
        found
    }

    /// Where a scroll that starts at `position` goes. `Some(None)` is nowhere.
    fn target(&self, scene: &Scene, position: [f32; 2], delta: [f32; 2]) -> Option<Option<u32>> {
        let hit = self
            .hit(scene, position)
            .filter(|hit| hit.kind != abi::HIT_BLOCKING)?;
        let mut index = hit.scroller;
        while let Some(scroller) = self.tables.scrollers.get(index as usize) {
            if scroller.flags & abi::SCROLLED_BY_ENGINE != 0 {
                return None;
            }
            let scrolled = self.scrolled.get(&scroller.id)?;
            let from = scrolled.glide.map_or(scrolled.total, |glide| glide.to);
            let to = Motion::clamp(
                scroller,
                [0, 1].map(|axis| from[axis] + f64::from(delta[axis])),
            );
            let has = |flag: u8, axis: usize| scroller.flags & flag << axis != 0;
            if (0..2).any(|axis| has(abi::SCROLLS_X, axis) && (to[axis] - from[axis]).abs() > 0.01)
            {
                return Some(Some(scroller.id));
            }
            if (0..2).any(|axis| has(abi::CONTAINS_X, axis) && delta[axis] != 0.)
                || scroller.parent == index
            {
                break;
            }
            index = scroller.parent;
        }
        Some(None)
    }

    /// Returns whether the engine has nothing to do. `ends` is for the last event of a gesture.
    pub fn wheel(
        &mut self,
        scene: &Scene,
        position: [f32; 2],
        delta: [f32; 2],
        glides: bool,
        ends: bool,
        now: f64,
    ) -> bool {
        const LATCHED_FOR: f64 = 500.;
        const SLOP: f32 = 10.;
        let is_near = |latch: &Latch| {
            (0..2).all(|axis| (latch.position[axis] - position[axis]).abs() <= SLOP)
        };
        let latch = self
            .latch
            .filter(|latch| latch.until > now && is_near(latch));
        let id = match latch.map_or_else(
            || self.target(scene, position, delta),
            |latch| Some(latch.id).filter(Option::is_some),
        ) {
            Some(Some(id)) => id,
            Some(None) => return false,
            None => {
                self.latch = Some(Latch {
                    id: None,
                    position,
                    until: if ends { now } else { now + LATCHED_FOR },
                });
                return false;
            }
        };
        self.latch = Some(Latch {
            id: Some(id),
            position,
            until: if ends { now } else { now + LATCHED_FOR },
        });
        let Some(scroller) = self.scroller(id).copied() else {
            return false;
        };
        let Some(scrolled) = self.scrolled.get_mut(&id) else {
            return false;
        };
        let from = scrolled
            .glide
            .filter(|_| glides)
            .map_or(scrolled.total, |glide| glide.to);
        let allowed = |axis: usize| {
            if scroller.flags & abi::SCROLLS_X << axis != 0 {
                delta[axis]
            } else {
                0.
            }
        };
        let to = Motion::clamp(
            &scroller,
            [0, 1].map(|axis| from[axis] + f64::from(allowed(axis))),
        );
        if !glides {
            (scrolled.total, scrolled.glide) = (to, None);
        } else if to != from {
            let current = scrolled.glide.map_or(scrolled.total, |glide| glide.at(now));
            scrolled.glide = Some(Glide::toward(current, to, now, scrolled.glide));
        }
        scrolled.is_scrolling = true;
        true
    }

    pub fn begin_gesture(&mut self) -> bool {
        self.latch = None;
        false
    }

    /// Returns whether that grabbed the thumb of a scrollbar.
    pub fn press(&mut self, scene: &Scene, position: [f32; 2]) -> bool {
        let thumb = self
            .hit(scene, position)
            .filter(|hit| matches!(hit.kind, abi::HIT_THUMB_X | abi::HIT_THUMB_Y));
        self.drag = thumb.and_then(|thumb| {
            let scroller = self.tables.scrollers.get(thumb.scroller as usize)?;
            let (axis, scrolled) = (
                usize::from(thumb.kind == abi::HIT_THUMB_Y),
                self.scrolled.get_mut(&scroller.id)?,
            );
            (scrolled.glide, scrolled.is_scrolling) = (None, true);
            let offset =
                f64::from(scroller.offset[axis]) + scrolled.total[axis] - scroller.applied[axis];
            Some(Drag {
                id: scroller.id,
                axis,
                ratio: thumb.ratio,
                pointer: position[axis],
                offset,
            })
        });
        self.drag.is_some()
    }

    /// Returns whether a thumb follows.
    pub fn drag(&mut self, position: [f32; 2]) -> bool {
        let Some(Drag {
            id,
            axis,
            ratio,
            pointer,
            offset,
        }) = self.drag
        else {
            return false;
        };
        if let Some(scroller) = self.scroller(id).copied()
            && let Some(scrolled) = self.scrolled.get_mut(&id)
        {
            let wanted = offset + f64::from((position[axis] - pointer) * ratio);
            scrolled.total[axis] =
                scroller.applied[axis] + wanted - f64::from(scroller.offset[axis]);
            (scrolled.total, scrolled.is_scrolling) =
                (Motion::clamp(&scroller, scrolled.total), true);
        }
        true
    }

    /// Returns whether a thumb was held.
    pub fn release(&mut self) -> bool {
        self.drag.take().is_some()
    }
}
