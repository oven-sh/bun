//! What a box painted is copied from the last picture if nothing in the box has changed.

use core::cell::Cell;

use smallvec::SmallVec;

use crate::abi::{self, Item, Matrix, PathVerb, Rect, Source, Span};
use crate::boxes::{BoxId, Kind, VIEWPORT};
use crate::document::Document;
use crate::name::Map;
use crate::paint::{Hit, Link, Painter, Picture, Space, alpha};
use crate::tree::NodeId;
use crate::types::multiply;

macro_rules! lengths {
    ($($table:ident)*) => {
        #[derive(Clone, Copy, Default, PartialEq)]
        struct Lengths {
            $($table: u32,)*
        }

        impl Lengths {
            fn of(picture: &Picture) -> Lengths {
                Lengths { $($table: picture.$table.len() as u32,)* }
            }

            fn plus(&self, other: &Lengths) -> Lengths {
                Lengths { $($table: self.$table.wrapping_add(other.$table),)* }
            }

            fn minus(&self, other: &Lengths) -> Lengths {
                Lengths { $($table: self.$table.wrapping_sub(other.$table),)* }
            }

            fn copy(&self, end: &Lengths, from: &Picture, to: &mut Picture) {
                $(if self.$table < end.$table {
                    to.$table.extend_from_slice(&from.$table[self.$table as usize..end.$table as usize]);
                })*
            }
        }

        impl Lengths {
            /// Moves what follows.
            fn split(&self, from: &mut Picture, to: &mut Picture) {
                $(to.$table.extend_from_slice(&from.$table[self.$table as usize..]);
                from.$table.truncate(self.$table as usize);)*
            }
        }

        impl Picture {
            fn clear(&mut self) {
                $(self.$table.clear();)*
                self.is_submitted = false;
            }
        }
    };
}

lengths!(items glyphs stops filters verbs local_verbs bytes regions region_nodes links hits scrollers scroller_nodes drivers numbers wheel_hits seen driven clips);

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Painted {
    StackingContext,
    /// `Atomic` and `Inside`.
    Positioned,
    Atomic,
    Lines,
    /// The layers in the box whose `z-index` is 0 or `auto`.
    Inside,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq)]
    pub(crate) struct Layers: u16 {
        const KNOWN = 1;
        const IS_LAYER = 1 << 1;
        const IS_STACKING_CONTEXT = 1 << 2;
        const IS_STICKY = 1 << 3;
        /// Its `z-index` is neither 0 nor `auto`.
        const IS_RAISED = 1 << 4;
        const HAS_LEVEL = 1 << 5;
        const HAS_RAISED = 1 << 6;
        const HAS_BLEND = 1 << 7;
        const BLENDS = 1 << 8;
        const SCROLLS = 1 << 9;
        /// Its origin is at a whole pixel.
        const SNAPS = 1 << 10;
        /// A descendant has a `backdrop-filter`.
        const HAS_BACKDROP = 1 << 11;
        /// All of the children are.
        const HAS_ONLY_LAYERS = 1 << 12;
    }
}

bitflags::bitflags! {
    /// What can change without a change to the shape of the picture.
    #[derive(Clone, Copy)]
    pub(crate) struct Retouch: u8 {
        const DECORATIONS = 1;
        const OPACITY = 1 << 1;
        const COLOR = 1 << 2;
        /// The colors in an `svg`.
        const SHAPES = 1 << 3;
        const TRANSFORM = 1 << 4;
    }
}

/// Where what `Retouch` is about is in a segment.
#[derive(Clone, Copy, Default)]
struct Own {
    decorations: Option<Decorations>,
    layer: Option<u16>,
    recording: Option<u16>,
    /// All of it has the color of the element that the lines are in.
    is_plain_text: bool,
    /// It has all of the box, in a transform that is its first link. From its origin to that of the transform.
    pivot: Option<[f32; 2]>,
    /// By which that transform multiplied areas.
    magnification: f32,
}

fn magnification(m: &Matrix) -> f32 {
    (m[0] * m[3] - m[1] * m[2]).abs()
}

#[derive(Clone, Copy)]
struct Decorations {
    offset: [f32; 2],
    /// The first one and how many.
    items: [u16; 2],
    stops: [u16; 2],
}

/// The second of each is for `Painted::Inside`.
#[derive(Default)]
pub(crate) struct Remembered {
    segments: [Cell<u32>; 2],
    /// The last two are for the accessibility tree.
    is_unchanged: [Cell<bool>; 4],
    has_sticky: Cell<bool>,
    /// Since `Document::column` has looked at it. For the viewport, since the last picture.
    pub(crate) was_laid_out: Cell<bool>,
    pub(crate) layers: Cell<Layers>,
}

impl Remembered {
    pub(crate) fn forget(&self) {
        self.is_unchanged.iter().for_each(|it| it.set(false));
    }

    pub(crate) fn is_described(&self) -> bool {
        self.is_unchanged[2].get()
    }

    pub(crate) fn set_described(&self, is_described: bool) {
        self.is_unchanged[2].set(is_described);
    }

    pub(crate) fn is_checked(&self) -> bool {
        self.is_unchanged[3].get()
    }

    pub(crate) fn set_checked(&self) {
        self.is_unchanged[3].set(true);
    }

    /// For the next box that has the same id.
    pub(crate) fn reused(&self) -> Remembered {
        Remembered {
            segments: self.segments.clone(),
            ..Remembered::default()
        }
    }

    pub(crate) fn forget_layers(&self) {
        self.forget();
        self.layers.take();
        self.has_sticky.take();
        self.was_laid_out.set(true);
    }
}

#[derive(Clone, Copy)]
struct Segment {
    id: BoxId,
    kind: Painted,
    is_hidden: bool,
    /// Another one each time that it is painted.
    serial: u32,
    /// That of the segment around it, which `origin` and `start` are relative to.
    parent: u32,
    origin: [f32; 2],
    start: Lengths,
    lengths: Lengths,
    /// What can be seen of the box, from its origin.
    cut: Rect,
    scroller: NodeId,
    /// `Painter::scroll_state`, if there are sticky boxes in it.
    scroll_state: [f32; 8],
    matrix: Matrix,

    parent_index: u32,
    /// Among the ones in the same parent.
    order: u32,
    /// In `Segments::growths`.
    growth: u32,
    link: Anchor,
    looks: Looks,
    /// It can be painted again by itself.
    is_independent: bool,
    /// And so can the ones in it.
    are_contents_independent: bool,
    has_children: bool,
    /// In a group that began in the parent.
    is_grouped: bool,
    own: Own,
}

#[derive(Clone, Copy)]
enum Anchor {
    /// Relative to the first link of the parent.
    At(u32),
    LikeParent,
    Unknown,
}

/// What the boxes around it have taken into account.
#[derive(Clone, Copy, PartialEq)]
struct Looks {
    ink: Rect,
    layers: Layers,
    z_index: Option<i32>,
}

/// A segment in this one was painted again by itself.
#[derive(Clone, Copy)]
struct Growth {
    /// Of the child that it is, or is in.
    order: u32,
    by: Lengths,
}

const NONE: u32 = u32::MAX;

#[derive(Clone, Copy)]
struct Position {
    serial: u32,
    origin: [f32; 2],
    start: Lengths,
    index: u32,
    link: u32,
    growth: u32,
    /// The index in `Pictures::kept`, if it is not in the last picture.
    kept: u32,
    is_grouped: bool,
}

impl Default for Position {
    fn default() -> Position {
        Position {
            serial: 0,
            origin: [0.0; 2],
            start: Lengths::default(),
            index: NONE,
            link: 0,
            growth: NONE,
            kept: NONE,
            is_grouped: false,
        }
    }
}

#[derive(Default)]
pub(crate) struct Segments {
    all: Vec<Segment>,
    /// How many there were after everything was painted.
    live: usize,
    last_serial: u32,
    /// Of the one that is being painted, in the old and in the new picture.
    old: Option<Position>,
    new: Position,
    next_order: u32,
    reads_contents: bool,
    /// How many have begun in it and not ended.
    pub(crate) groups: u32,
    own: Own,
    growths: Vec<Growth>,
    /// Where the tables of the old picture begin. What was before is in the new one.
    base: Lengths,
    /// By serial, where the segments that have been painted again were in the old picture, or in one that is kept.
    replaced: Map<u32, Position>,
    /// The index that the old picture gets.
    keeps_as: Option<u32>,
}

impl Segments {
    fn lengths(&self, it: &Segment) -> Lengths {
        self.growths
            .get(it.growth as usize)
            .map_or(it.lengths, |growth| it.lengths.plus(&growth.by))
    }

    fn replace(&mut self, old: &Position) {
        let kept = self
            .keeps_as
            .filter(|_| old.kept == NONE)
            .unwrap_or(old.kept);
        self.replaced.insert(old.serial, Position { kept, ..*old });
    }

    fn position(&self, index: u32, outer: &Position, link: u32, growths: &[Growth]) -> Position {
        let it = &self.all[index as usize];
        let growth = growths
            .get(outer.growth as usize)
            .filter(|growth| it.order > growth.order);
        let start = outer.start.plus(&it.start);
        Position {
            serial: it.serial,
            origin: [
                outer.origin[0] + it.origin[0],
                outer.origin[1] + it.origin[1],
            ],
            start: growth.map_or(start, |it| start.plus(&it.by)),
            index,
            link,
            growth: it.growth,
            kept: outer.kept,
            is_grouped: outer.is_grouped || it.is_grouped,
        }
    }
}

impl Segments {
    /// Whether the last picture has it.
    fn shows(&self, id: BoxId, index: u32) -> bool {
        let Some(mut it) = self.all.get(index as usize).filter(|it| it.id == id) else {
            return false;
        };
        while let Some(parent) = self.all.get(it.parent_index as usize) {
            if parent.serial != core::mem::replace(&mut it, parent).parent {
                return false;
            }
        }
        it.parent == self.new.serial
    }

    /// In the last picture. `path` leads to the one that was located before.
    fn locate(&self, index: u32, path: &mut Vec<Position>) -> Option<Position> {
        if let Some(at) = path.iter().rposition(|it| it.index == index) {
            path.truncate(at + 1);
            return Some(path[at]);
        }
        let it = self
            .all
            .get(index as usize)
            .filter(|it| it.are_contents_independent && !matches!(it.link, Anchor::Unknown))?;
        let outer = self
            .locate(it.parent_index, path)
            .filter(|outer| outer.serial == it.parent)?;
        Some(*path.push_mut(self.position(index, &outer, NONE, &self.growths)))
    }
}

/// An empty one can be past the end, as the empty layers around it are dropped.
fn part<T>(all: &mut [T], start: usize, length: usize) -> &mut [T] {
    if length == 0 {
        &mut []
    } else {
        &mut all[start..][..length]
    }
}

struct Patch {
    index: u32,
    outer: Position,
    own: Position,
}

/// The last picture with contents that `content-visibility` has hidden since.
struct Kept {
    picture: Picture,
    growths: Vec<Growth>,
    locks: Vec<NodeId>,
}

#[derive(Default)]
pub(crate) struct Pictures {
    /// The `layout_version` that the links of the current one are up to date with, and until when.
    pub(crate) links_are_for: Option<(u32, f64)>,
    /// A point, and from which index on no hit has it.
    pub(crate) last_hit: Cell<Option<([f32; 2], usize)>>,
    kept: [Option<Kept>; 6],
    pub(crate) just_locked: Vec<NodeId>,
    /// How the regions that were submitted last had to be arranged.
    pub(crate) order_of_regions: Vec<usize>,
    current: Option<Picture>,
    outdated: Option<Picture>,
    spare: Picture,
    segments: Segments,
    changes: u32,
    last_changed: NodeId,
    retouched: Vec<(BoxId, Retouch)>,
    /// The boxes may not know that they have changed.
    pub(crate) were_discarded: bool,
}

impl Pictures {
    pub(crate) fn current(&self) -> Option<&Picture> {
        self.current.as_ref()
    }

    pub(crate) fn current_mut(&mut self) -> Option<&mut Picture> {
        self.current.as_mut()
    }

    /// The boxes that have changed know it.
    pub(crate) fn outdate(&mut self) {
        (self.links_are_for, *self.last_hit.get_mut()) = (None, None);
        if self.current.is_some() {
            self.outdated = self.current.take();
        }
    }

    pub(crate) fn discard(&mut self) {
        self.were_discarded = true;
        self.start_over();
    }

    fn start_over(&mut self) {
        (self.links_are_for, *self.last_hit.get_mut()) = (None, None);
        let outdated = self.outdated.take();
        if let Some(picture) = self.current.take().or(outdated) {
            self.spare = picture;
        }
    }

    pub(crate) fn outdated(&self) -> Option<&Picture> {
        self.outdated.as_ref()
    }

    pub(crate) fn lend(&mut self) -> Option<Picture> {
        self.current.take()
    }

    pub(crate) fn give_back(&mut self, picture: Picture) {
        self.current = Some(picture);
    }
}

impl Document {
    pub(crate) fn paint(
        &mut self,
        canvas_source: NodeId,
        caret: Option<(BoxId, Rect)>,
    ) -> &Picture {
        let pictures = &mut self.pictures;
        let mut segments = core::mem::take(&mut pictures.segments);
        if segments.all.len() > segments.live * 4 + 4096
            || segments.last_serial.max(segments.next_order) > 1 << 31
            || pictures
                .outdated
                .as_ref()
                .is_some_and(|it| it.canvas_source != canvas_source)
        {
            pictures.start_over();
        }
        let (mut old, mut spare) = (
            pictures.outdated.take(),
            core::mem::take(&mut pictures.spare),
        );
        spare.clear();
        pictures.changes = 0;
        let mut retouched = core::mem::take(&mut pictures.retouched);
        match old.as_mut() {
            _ if retouched.is_empty() => {}
            Some(picture) => {
                spare = Painter::retouch_all(self, &retouched, &segments, picture, spare)
            }
            None => retouched
                .iter()
                .for_each(|it| _ = self.boxes.recordings.get_mut().remove(&it.0)),
        }
        let pictures = &mut self.pictures;
        let changed = core::mem::take(self.boxes.changed.get_mut());
        let locks = core::mem::take(&mut pictures.just_locked);
        segments.keeps_as = (0..)
            .zip(&pictures.kept)
            .find(|it| it.1.is_none() && !locks.is_empty() && old.is_some())
            .map(|it| it.0);
        let was_laid_out =
            self.boxes[VIEWPORT].painted.was_laid_out.take() || segments.keeps_as.is_some();
        if !was_laid_out
            && let Some(picture) = old.take_if(|it| changed.is_empty() && self.has_scrollers_of(it))
        {
            (self.pictures.segments, self.pictures.spare) = (segments, spare);
            return self.pictures.current.insert(picture);
        }
        let boxes = &self.boxes;
        retouched.retain(|it| it.1.contains(Retouch::TRANSFORM) && boxes.is_alive(it.0));
        retouched
            .iter()
            .for_each(|it| boxes[it.0].is_moving.set(true));
        for watched in &self.animations.watched {
            core::iter::successors(Some(*watched), |it| Some(boxes[*it].parent))
                .take_while(|it| *it != 0)
                .for_each(|it| boxes[it].is_moving.set(false));
        }
        self.paint_changes(
            old,
            spare,
            segments,
            &changed,
            was_laid_out,
            locks,
            canvas_source,
            caret,
        );
        retouched
            .iter()
            .for_each(|it| self.boxes[it.0].is_moving.set(false));
        self.pictures.current.as_ref().expect("is not none")
    }

    fn paint_changes(
        &mut self,
        mut old: Option<Picture>,
        mut spare: Picture,
        mut segments: Segments,
        changed: &[BoxId],
        was_laid_out: bool,
        locks: Vec<NodeId>,
        canvas_source: NodeId,
        caret: Option<(BoxId, Rect)>,
    ) {
        let patch = old
            .as_ref()
            .filter(|_| !was_laid_out)
            .and_then(|it| self.find_patch(changed, &segments, it));
        if let Some(patch) = patch
            && let Some(mut picture) = old.take()
        {
            picture.caret = caret;
            patch.own.start.split(&mut picture, &mut spare);
            let (picture, patched, has_worked) =
                Painter::patch(self, &spare, picture, segments, &patch);
            segments = patched;
            segments.replaced.retain(|_, it| it.kept != NONE);
            if has_worked {
                (self.pictures.segments, self.pictures.spare) = (segments, spare);
                self.release_kept_pictures();
                self.pictures.current = Some(picture);
                return;
            }
            spare.clear();
            old = Some(picture);
        }
        (spare.canvas_source, spare.caret, spare.first_hit) = (canvas_source, caret, 0);
        segments.old = old.is_some().then_some(segments.new);
        if old.is_none() {
            segments.all.clear();
            segments.replaced.clear();
            self.pictures.kept = Default::default();
            (segments.last_serial, segments.next_order) = (0, 0);
        }
        if let Some(root) = segments.old {
            segments.replace(&root);
        }
        segments.last_serial += 1;
        (segments.new, segments.reads_contents) = (
            Position {
                serial: segments.last_serial,
                ..Position::default()
            },
            false,
        );
        let (new, mut segments) = Painter::paint(self, old.as_ref(), spare, segments);
        match (old, segments.keeps_as.take()) {
            (Some(picture), Some(index)) => {
                self.pictures.kept[index as usize] = Some(Kept {
                    picture,
                    growths: core::mem::take(&mut segments.growths),
                    locks,
                });
            }
            (Some(old), None) => self.pictures.spare = old,
            (None, _) => segments.live = segments.all.len(),
        }
        segments.growths.clear();
        self.pictures.segments = segments;
        self.release_kept_pictures();
        self.pictures.current = Some(new);
    }

    fn has_other_range(&self, scroller: BoxId, picture: &Picture) -> bool {
        let known = picture
            .scroller_nodes
            .iter()
            .position(|it| *it == self.boxes[scroller].node)
            .map(|it| &picture.scrollers[it]);
        known.map(|it| [0, 1].map(|axis| [it.min[axis], it.max[axis]]))
            != self.composited_range(scroller)
    }

    fn release_kept_pictures(&mut self) {
        let is_locked = |it: &NodeId| {
            self.tree.contains(*it) && self.tree[*it].has(crate::tree::Flags::SKIPPED)
        };
        let Pictures {
            kept,
            segments,
            spare,
            ..
        } = &mut self.pictures;
        for kept in kept
            .iter_mut()
            .filter_map(|it| it.take_if(|it| !it.locks.iter().any(is_locked)))
        {
            *spare = kept.picture;
        }
        segments
            .replaced
            .retain(|_, it| kept.get(it.kept as usize).is_some_and(Option::is_some));
    }

    fn has_scrollers_of(&self, picture: &Picture) -> bool {
        (self.compositor.is_on || picture.range == self.scroll_range(VIEWPORT))
            && picture
                .scrollers
                .iter()
                .zip(&picture.scroller_nodes)
                .all(|(it, node)| {
                    self.own_box(*node).is_some_and(|id| {
                        self.scroll_range(id) == [0, 1].map(|axis| [it.min[axis], it.max[axis]])
                    })
                })
    }

    fn looks(&self, id: BoxId) -> Looks {
        let mut layers = self.layers(id);
        if layers.contains(Layers::IS_STACKING_CONTEXT) {
            layers -= Layers::HAS_LEVEL | Layers::HAS_RAISED | Layers::HAS_BLEND;
        }
        Looks {
            ink: self.outer_ink(id),
            layers,
            z_index: self.boxes[id].style.paint.z_index.0,
        }
    }

    /// The smallest segment that has all the changes.
    fn find_patch(
        &self,
        changed: &[BoxId],
        segments: &Segments,
        picture: &Picture,
    ) -> Option<Patch> {
        let boxes = &self.boxes;
        (self.compositor.is_on
            && boxes.pieces.is_empty()
            && boxes.copies.is_empty()
            && self.anchored.is_empty())
        .then_some(())?;
        (segments.growths.len() < 256 && !segments.reads_contents).then_some(())?;
        let mut id = changed
            .iter()
            .copied()
            .filter(|it| boxes.is_alive(*it))
            .reduce(|mut a, mut b| {
                while a != b {
                    let deeper = if boxes[a].depth >= boxes[b].depth {
                        &mut a
                    } else {
                        &mut b
                    };
                    *deeper = boxes[*deeper].parent;
                    if *deeper == 0 {
                        return VIEWPORT;
                    }
                }
                a
            })?;
        if let Some(scroller) = boxes
            .containers(id)
            .filter(|it| boxes[*it].scrolls() && self.has_other_range(*it, picture))
            .last()
        {
            id = scroller;
        }
        let mut path = SmallVec::<[u32; 48]>::new();
        loop {
            (id != 0 && boxes[id].parent != VIEWPORT && boxes[id].node != picture.canvas_source)
                .then_some(())?;
            let index = boxes[id].painted.segments[0].get();
            let is_candidate = |it: &&Segment| {
                it.id == id
                    && it.is_independent
                    && it.kind != Painted::Inside
                    && segments.lengths(it).items > 0
                    && !boxes[id].cache.has_escapees()
                    && boxes[id].collapsed.is_none()
                    && it.looks == self.looks(id)
            };
            let Some(mut it) = segments.all.get(index as usize).filter(is_candidate) else {
                id = boxes[id].parent;
                continue;
            };
            path.clear();
            path.push(index);
            let mut obstacle = None;
            while let Some(parent) = segments.all.get(it.parent_index as usize) {
                let has_other = segments
                    .growths
                    .get(parent.growth as usize)
                    .is_some_and(|growth| growth.order != it.order);
                if parent.serial != it.parent
                    || has_other
                    || !parent.are_contents_independent
                    || parent.own.pivot.is_some()
                {
                    obstacle = Some(parent.id);
                }
                path.push(it.parent_index);
                it = parent;
            }
            (it.parent == segments.new.serial).then_some(())?;
            segments
                .growths
                .get(segments.new.growth as usize)
                .is_none_or(|growth| growth.order == it.order)
                .then_some(())?;
            if let Some(obstacle) = obstacle {
                id = if obstacle == id {
                    boxes[id].parent
                } else {
                    obstacle
                };
                continue;
            }
            let (mut outer, mut own) = (segments.new, segments.new);
            for index in path.iter().rev() {
                outer = own;
                let link = match segments.all[*index as usize].link {
                    Anchor::At(link) => outer.start.links + link,
                    Anchor::LikeParent => outer.link,
                    Anchor::Unknown => NONE,
                };
                own = segments.position(*index, &outer, link, &segments.growths);
            }
            if own.link != NONE {
                return Some(Patch { index, outer, own });
            }
            id = boxes[id].parent;
        }
    }

    pub(crate) fn repaint_box(&mut self, id: BoxId) {
        if !self.boxes.is_parked(id) {
            self.pictures.outdate();
        }
        self.repaint_eventually(id);
    }

    pub(crate) fn retouch(&mut self, id: BoxId, what: Retouch) {
        if self.boxes.is_parked(id) || what.contains(Retouch::COLOR) && self.accessibility.is_some()
        {
            self.boxes.recordings.get_mut().remove(&id);
            self.forget_segments_in(id, false);
            return self.repaint_box(id);
        }
        self.pictures.outdate();
        if self.pictures.retouched.len() > 32768 {
            self.pictures.discard();
            self.pictures.retouched.clear();
            self.boxes.recordings.get_mut().clear();
        }
        match self.pictures.retouched.last_mut() {
            Some(last) if last.0 == id => last.1 |= what,
            _ if self.pictures.outdated.is_some() => self.pictures.retouched.push((id, what)),
            _ => _ = self.boxes.recordings.get_mut().remove(&id),
        }
    }

    /// Together with the next change.
    pub(crate) fn repaint_eventually(&self, id: BoxId) {
        if self.forget_segments_around(id) {
            self.boxes.note_change(id);
        }
    }

    /// Whether it is not parked.
    fn forget_segments_around(&self, mut at: BoxId) -> bool {
        while at != 0 {
            self.boxes[at].painted.forget();
            at = self.boxes[at].parent;
            if self.boxes[at].is_parking {
                return false;
            }
        }
        true
    }

    pub(crate) fn repaint(&mut self, node: NodeId) {
        self.repaint_with(node, false);
    }

    pub(crate) fn repaint_subtree(&mut self, node: NodeId) {
        self.repaint_with(node, true);
    }

    fn repaint_with(&mut self, node: NodeId, descendants: bool) {
        let is_another = core::mem::replace(&mut self.pictures.last_changed, node) != node;
        self.pictures.changes +=
            u32::from(is_another && self.pictures.changes <= 500 && !self.is_locked(node));
        if self.pictures.changes > 500 {
            return self.pictures.discard();
        }
        let id = self.nearest_box(node);
        self.forget_segments_in(id, descendants);
        self.repaint_box(id);
    }

    /// Of the anonymous boxes, unless `all`.
    fn forget_segments_in(&self, id: BoxId, all: bool) {
        if !all && !self.boxes[id].has_anonymous_children {
            return;
        }
        for child in self.boxes[id]
            .children
            .iter()
            .filter(|it| all || self.boxes[**it].node == 0)
        {
            self.boxes[*child].painted.forget();
            self.forget_segments_in(*child, all);
        }
    }
}

struct Shift {
    tables: Lengths,
    by: [f32; 2],
}

impl Shift {
    fn point(&self, point: &mut [f32; 2]) {
        *point = [point[0] + self.by[0], point[1] + self.by[1]];
    }

    fn rect(&self, rect: &mut Rect) {
        *rect = rect.moved(self.by);
    }

    /// For one that maps points that have moved to points that have moved.
    fn matrix(&self, m: &mut [f32]) {
        let [x, y] = self.by;
        m[4] += x - (m[0] * x + m[2] * y);
        m[5] += y - (m[1] * x + m[3] * y);
    }

    fn verb(&self, verb: &mut PathVerb) {
        match verb {
            PathVerb::Move(to) | PathVerb::Line(to) => self.point(to),
            PathVerb::Cubic(a, b, to) => [a, b, to].into_iter().for_each(|it| self.point(it)),
            PathVerb::Close => {}
        }
    }

    fn relocate(&self, item: &mut Item) {
        let span = |span: &mut Span, by: u32| match span.start == span.end {
            true => *span = Span::default(),
            false => {
                *span = Span {
                    start: span.start.wrapping_add(by),
                    end: span.end.wrapping_add(by),
                }
            }
        };
        match item {
            Item::Pop | Item::Mask { .. } | Item::Input => {}
            Item::Path { outline, .. } | Item::PushClipOutline(outline) => {
                self.rect(&mut outline.bounds);
                span(&mut outline.verbs, self.tables.verbs);
                span(&mut outline.stroke.dashes, self.tables.bytes);
            }
            Item::PushVector(matrix) => {
                [matrix[4], matrix[5]] = [matrix[4] + self.by[0], matrix[5] + self.by[1]]
            }
            Item::Shade { stops, .. } => span(stops, self.tables.stops),
            Item::PushPattern { .. } => {}
            Item::PushProjection(_) => {}
            Item::TextStroke {
                origin,
                bounds,
                glyphs,
                stroke,
                ..
            } => {
                self.point(origin);
                self.rect(bounds);
                span(glyphs, self.tables.glyphs);
                span(&mut stroke.dashes, self.tables.bytes);
            }
            Item::ImagePart { clip, tile, .. } => {
                self.rect(clip);
                self.rect(&mut tile.rect);
            }
            Item::PushClip(shape) | Item::Fill { shape, .. } | Item::Border { shape, .. } => {
                self.rect(&mut shape.rect)
            }
            Item::PushClipPath { verbs, .. } => span(verbs, self.tables.verbs),
            Item::PushTransform(matrix) => self.matrix(matrix),
            Item::PushLayer {
                bounds: rect,
                filters,
                ..
            }
            | Item::Backdrop {
                shape: abi::RoundedRect { rect, .. },
                filters,
                ..
            } => {
                self.rect(rect);
                span(filters, self.tables.filters);
            }
            Item::Shadow { shape, shadow, .. } => {
                self.rect(&mut shape.rect);
                self.rect(shadow);
            }
            Item::Gradient {
                clip, tile, stops, ..
            } => {
                self.rect(&mut clip.rect);
                self.rect(&mut tile.rect);
                span(stops, self.tables.stops);
            }
            Item::Image { clip, tile, .. } => {
                self.rect(&mut clip.rect);
                self.rect(&mut tile.rect);
            }
            Item::Svg {
                clip, rect, source, ..
            } => {
                self.rect(clip);
                self.rect(rect);
                span(source, self.tables.bytes);
            }
            Item::Text {
                origin,
                bounds,
                glyphs,
                ..
            } => {
                self.point(origin);
                self.rect(bounds);
                span(glyphs, self.tables.glyphs);
            }
            Item::Line { rect, .. } | Item::Caret { rect, .. } => self.rect(rect),
        }
    }

    /// What is in a `PushVector` stays where it is.
    fn relocate_all(&self, out: &mut Picture, first: &Lengths) {
        let (local, mut depth) = (
            Shift {
                by: [0.0; 2],
                ..*self
            },
            0,
        );
        for item in &mut out.items[first.items as usize..] {
            (if depth > 0 { &local } else { self }).relocate(item);
            match item {
                Item::PushVector(_) => depth += 1,
                _ if depth == 0 => {}
                Item::Pop => depth -= 1,
                Item::PushClip(_)
                | Item::PushClipPath { .. }
                | Item::PushClipOutline(_)
                | Item::PushTransform(_)
                | Item::PushLayer { .. }
                | Item::PushPattern { .. }
                | Item::PushProjection(_) => depth += 1,
                _ => {}
            }
        }
        for filter in &mut out.filters[first.filters as usize..] {
            if let abi::Filter::Primitive {
                arguments: Span { start, end },
                ..
            } = filter
            {
                let moved = (
                    start.wrapping_add(self.tables.bytes),
                    end.wrapping_add(self.tables.bytes),
                );
                (*start, *end) = if start == end { (0, 0) } else { moved };
            }
        }
        let mut next = if self.by == [0.0; 2] {
            usize::MAX
        } else {
            first.verbs as usize
        };
        for Span { start, end } in &mut out.local_verbs[first.local_verbs as usize..] {
            (*start, *end) = (
                start.wrapping_add(self.tables.verbs),
                end.wrapping_add(self.tables.verbs),
            );
            out.verbs
                .get_mut(next..*start as usize)
                .into_iter()
                .flatten()
                .for_each(|it| self.verb(it));
            next = next.max(*end as usize);
        }
        out.verbs
            .get_mut(next..)
            .into_iter()
            .flatten()
            .for_each(|it| self.verb(it));
    }

    fn samples(&self, samples: &mut Span) {
        if samples.start != samples.end {
            *samples = Span {
                start: samples.start.wrapping_add(self.tables.numbers),
                end: samples.end.wrapping_add(self.tables.numbers),
            };
        }
    }
}

/// The lengths of what is shown.
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct Shown([u32; 6]);

impl Shown {
    pub(crate) fn of(it: &Picture) -> Shown {
        Shown(
            [
                it.items.len(),
                it.glyphs.len(),
                it.stops.len(),
                it.filters.len(),
                it.verbs.len(),
                it.bytes.len(),
            ]
            .map(|it| it as u32),
        )
    }

    pub(crate) fn items(&self) -> u32 {
        self.0[0]
    }

    pub(crate) fn moved(&self, from: &Shown, to: &Shown) -> Shown {
        Shown(core::array::from_fn(|it| {
            self.0[it].wrapping_sub(from.0[it]).wrapping_add(to.0[it])
        }))
    }

    fn lengths(&self) -> Lengths {
        let [items, glyphs, stops, filters, verbs, bytes] = self.0;
        Lengths {
            items,
            glyphs,
            stops,
            filters,
            verbs,
            bytes,
            ..Lengths::default()
        }
    }
}

impl Picture {
    pub(crate) fn reserve_like(&mut self, other: &Picture) {
        self.items.reserve(other.items.len() + 16);
        self.verbs.reserve(other.verbs.len() + 64);
    }

    /// In a `PushVector`.
    pub(crate) fn append_part(&mut self, other: &Picture, start: &Shown, end: &Shown) {
        let (first, start) = (Lengths::of(self), start.lengths());
        start.copy(&end.lengths(), other, self);
        Shift {
            tables: first.minus(&start),
            by: [0.0; 2],
        }
        .relocate_all(self, &first);
    }

    /// In a `PushVector`. Only what is shown.
    pub(crate) fn append(&mut self, other: &Picture) {
        let first = Lengths::of(self);
        self.items.extend_from_slice(&other.items);
        self.glyphs.extend_from_slice(&other.glyphs);
        self.stops.extend_from_slice(&other.stops);
        self.filters.extend_from_slice(&other.filters);
        self.verbs.extend_from_slice(&other.verbs);
        self.bytes.extend_from_slice(&other.bytes);
        self.local_verbs.push(Span {
            start: 0,
            end: other.verbs.len() as u32,
        });
        Shift {
            tables: first,
            by: [0.0; 2],
        }
        .relocate_all(self, &first);
    }
}

impl Painter<'_> {
    /// What is being painted cannot be told from the boxes that it is in.
    pub(crate) fn depends_on_outside(&mut self) {
        self.outside += 1;
    }

    /// What is being painted depends on what the boxes in it paint.
    pub(crate) fn depends_on_contents(&mut self) {
        self.segments.reads_contents = true;
    }

    /// If they are at the beginning of the segment of the box.
    pub(crate) fn note_decorations(
        &mut self,
        id: BoxId,
        space: &Space,
        paint: impl FnOnce(&mut Self),
    ) {
        let (at, others) = (self.segments.new.index as usize, |it: &Picture| {
            it.links.len() + it.filters.len() + it.verbs.len() + it.glyphs.len() + it.bytes.len()
        });
        if self.is_hidden || self.segments.all.get(at).is_none_or(|it| it.id != id) {
            return paint(self);
        }
        self.enter(space.link);
        let before = (
            self.out.items.len(),
            self.out.stops.len(),
            others(&self.out),
        );
        paint(self);
        let (segment, out) = (&self.segments.new, &self.out);
        let range = |start: u32, first: usize, end: usize| {
            Some([
                (first - start as usize).try_into().ok()?,
                (end - first).try_into().ok()?,
            ])
        };
        let ranges = range(segment.start.items, before.0, out.items.len()).zip(range(
            segment.start.stops,
            before.1,
            out.stops.len(),
        ));
        let offset = [0, 1].map(|it| space.origin[it] - segment.origin[it]);
        self.segments.own.decorations =
            ranges
                .filter(|_| others(out) == before.2)
                .map(|(items, stops)| Decorations {
                    offset,
                    items,
                    stops,
                });
    }

    /// The last item has the opacity of the box.
    pub(crate) fn note_layer(&mut self, id: BoxId) {
        if !self.is_hidden
            && self
                .segments
                .all
                .get(self.segments.new.index as usize)
                .is_some_and(|it| it.id == id)
        {
            self.segments.own.layer = (self.out.items.len() as u32 - self.segments.new.start.items)
                .checked_sub(1)
                .and_then(|it| it.try_into().ok());
        }
    }

    /// That of the `svg` follows.
    pub(crate) fn note_recording(&mut self, id: BoxId) {
        if self
            .segments
            .all
            .get(self.segments.new.index as usize)
            .is_some_and(|it| it.id == id)
        {
            self.segments.own.recording = (self.out.items.len() as u32
                - self.segments.new.start.items)
                .try_into()
                .ok();
        }
    }

    /// Whether all of it is painted, wherever it is, so that it does not have to be painted again when it moves on.
    pub(crate) fn paints_whole(&self, id: BoxId) -> bool {
        let (document, it) = (self.document, &self.document.boxes[id]);
        it.is_moving.get()
            && !self.is_copy
            && !self.svg.is_on
            && !it.cache.has_escapees()
            && it.collapsed.is_none()
            && self.out.items.len() < 32768
            && {
                let (ink, viewport) = (document.ink(id), document.border_box(VIEWPORT));
                ink.width * ink.height <= viewport.width * viewport.height * 4.0
                    && !document.tree.is_root(it.node)
            }
    }

    pub(crate) fn is_grouped(&self) -> bool {
        self.segments.new.is_grouped || self.segments.groups > 0
    }

    /// Its transform is the next link.
    pub(crate) fn note_pivot(&mut self, id: BoxId, pivot: [f32; 2], matrix: &Matrix) {
        let segment = &self.segments.new;
        if self
            .segments
            .all
            .get(segment.index as usize)
            .is_some_and(|it| it.id == id)
            && segment.start.links as usize == self.out.links.len()
        {
            self.segments.own.pivot =
                Some([pivot[0] - segment.origin[0], pivot[1] - segment.origin[1]]);
            self.segments.own.magnification = magnification(matrix);
        }
    }

    pub(crate) fn note_plain_text(&mut self) {
        self.segments.own.is_plain_text = true;
    }

    /// What cannot be changed in `picture` is painted again. Returns `scratch`.
    fn retouch_all(
        document: &Document,
        retouched: &[(BoxId, Retouch)],
        segments: &Segments,
        picture: &mut Picture,
        scratch: Picture,
    ) -> Picture {
        let boxes = &document.boxes;
        let is_possible = boxes.pieces.is_empty()
            && boxes.copies.is_empty()
            && !document.has_depth.get()
            && document.view_transitions.is_empty()
            && !segments.reads_contents;
        let (mut painter, mut path) = (
            Painter::new(document, None, scratch, Segments::default()),
            vec![segments.new],
        );
        let (mut last_container, mut last_scroller) = (0, 0);
        picture.is_submitted = false;
        for (index, (id, what)) in retouched
            .iter()
            .copied()
            .enumerate()
            .filter(|it| boxes.is_alive(it.1.0))
        {
            if let [_, _, near, _, middle, _, _, _, far, ..] = retouched[index..] {
                boxes.prefetch_extent(far.0);
                boxes[middle.0]
                    .children
                    .first()
                    .into_iter()
                    .for_each(|it| boxes.prefetch_extent(*it));
                crate::forecast::prefetch_shared(&boxes[middle.0].style, 3);
                boxes[near.0]
                    .children
                    .first()
                    .and_then(|it| boxes[*it].inline.as_ref())
                    .into_iter()
                    .for_each(|it| crate::forecast::prefetch(&it.has_layers));
            }
            let mut locate = |id: BoxId| {
                let (painted, index) = (&boxes[id].painted, boxes[id].painted.segments[0].get());
                let segment = segments.all.get(index as usize).filter(|it| {
                    is_possible
                        && painted.is_unchanged[0].get()
                        && it.id == id
                        && it.kind != Painted::Inside
                })?;
                Some((segment, segments.locate(index, &mut path)?))
            };
            let (style, is_animated) = (&boxes[id].style, || {
                document.compositor.sampled.contains_key(&boxes[id].node)
            });
            let mut is_done = !what.contains(Retouch::COLOR)
                || !document.uses_color_elsewhere(id) && picture.caret.is_none_or(|it| it.0 != id);
            if is_done
                && what.intersects(Retouch::DECORATIONS | Retouch::OPACITY | Retouch::TRANSFORM)
            {
                is_done = locate(id).is_some_and(|(segment, at)| {
                    (!what.contains(Retouch::TRANSFORM)
                        || painter.transform_again(segment, &at, picture))
                        && (!what.contains(Retouch::DECORATIONS)
                            || segment
                                .own
                                .decorations
                                .is_some_and(|it| painter.decorate_again(id, it, &at, picture)))
                        && (!what.contains(Retouch::OPACITY)
                            || style.effects.backdrop_filter.0.is_empty() && !is_animated() && {
                                let layer = segment
                                    .own
                                    .layer
                                    .map(u32::from)
                                    .filter(|it| *it < segment.lengths.items);
                                match layer
                                    .map(|it| &mut picture.items[(at.start.items + it) as usize])
                                {
                                    Some(Item::PushLayer { opacity, .. }) => {
                                        *opacity = style.effects.opacity.0
                                    }
                                    _ => return false,
                                }
                                true
                            })
                });
            }
            if what.contains(Retouch::SHAPES) {
                let shown = locate(id).and_then(|(segment, at)| {
                    Some(
                        &mut picture.items
                            [(at.start.items + u32::from(segment.own.recording?)) as usize..],
                    )
                });
                let (is_shown, mut recordings) = (shown.is_some(), boxes.recordings.borrow_mut());
                let is_tinted = recordings
                    .get_mut(&id)
                    .is_some_and(|it| it.tint(document, shown));
                if !is_tinted {
                    recordings.remove(&id);
                }
                is_done = is_shown && is_tinted;
            }
            if !is_done {
                document.repaint_eventually(id);
            }
            if what.contains(Retouch::TRANSFORM)
                && core::mem::replace(&mut last_container, boxes[id].container) != last_container
                && let Some(scroller) = boxes.containers(id).find(|it| boxes[*it].scrolls())
                && core::mem::replace(&mut last_scroller, scroller) != scroller
                && (!document.compositor.is_on
                    && scroller != VIEWPORT
                    && boxes[scroller].overflow != [crate::types::Overflow::Hidden; 2]
                    || document.has_other_range(scroller, picture))
            {
                document.repaint_eventually(scroller);
            }
            let new = style.ink.text_fill_color.resolve(style.color());
            let mut anonymous: SmallVec<[BoxId; 8]> = what
                .contains(Retouch::COLOR)
                .then_some(id)
                .into_iter()
                .collect();
            while let Some(parent) = anonymous.pop() {
                for child in boxes[parent]
                    .children
                    .iter()
                    .copied()
                    .filter(|it| boxes[*it].node == 0)
                {
                    if boxes[child].kind == Kind::Block && !boxes[child].style.is_floating() {
                        anonymous.push(child);
                    } else if let Some((segment, at)) = locate(child).filter(|it| {
                        it.0.own.is_plain_text
                            && alpha(new) > 0
                            && picture.caret.is_none_or(|it| it.0 != child)
                    }) {
                        for item in part(
                            &mut picture.items,
                            at.start.items as usize,
                            segment.lengths.items as usize,
                        ) {
                            if let Item::Text { color, .. } = item {
                                *color = new;
                            }
                        }
                    } else {
                        document.forget_segments_in(child, false);
                        match is_possible
                            && boxes[child]
                                .inline
                                .as_ref()
                                .is_some_and(|it| !it.has_layers)
                            && !segments.shows(child, boxes[child].painted.segments[0].get())
                        {
                            true => _ = document.forget_segments_around(child),
                            false => document.repaint_eventually(child),
                        }
                    }
                }
            }
        }
        painter.out.clear();
        painter.out
    }

    fn transform_again(&self, segment: &Segment, at: &Position, picture: &mut Picture) -> bool {
        let Lengths {
            items,
            links,
            regions,
            local_verbs,
            ..
        } = segment.lengths;
        let Some((pivot, own)) = segment
            .own
            .pivot
            .filter(|_| !at.is_grouped && regions == 0)
            .zip(self.document.own_transform(segment.id))
        else {
            return false;
        };
        let pivot = [at.origin[0] + pivot[0], at.origin[1] + pivot[1]];
        let (matrix, needed) = self.placed(&own, pivot);
        let is_moved = own[..4] == crate::types::IDENTITY[..4];
        let is_near =
            |a: [f32; 2], b: [f32; 2]| (a[0] - b[0]).abs().max((a[1] - b[1]).abs()) < 0.001;
        let first = at.start.links as usize;
        let is_zoomed = (magnification(&matrix) / segment.own.magnification - 1.0).abs() > 0.001;
        if !is_near(pivot, if is_moved { at.origin } else { needed })
            || crate::types::invert(&matrix).is_none()
            || local_verbs > 0 && is_zoomed
        {
            return false;
        }
        match part(&mut picture.items, at.start.items as usize, items as usize).first_mut() {
            Some(Item::PushTransform(it)) => *it = matrix,
            Some(_) => return false,
            None => {}
        }
        picture.links[first].item = Item::PushTransform(matrix);
        for index in first..first + links as usize {
            let (outer, it) = (
                picture.links[picture.links[index].parent as usize].matrix,
                &mut picture.links[index],
            );
            it.matrix = if let Item::PushTransform(own)
            | Item::PushVector(own)
            | Item::PushPattern { matrix: own, .. } = &it.item
            {
                multiply(&outer, own)
            } else {
                outer
            };
        }
        true
    }

    fn decorate_again(
        &mut self,
        id: BoxId,
        known: Decorations,
        at: &Position,
        picture: &mut Picture,
    ) -> bool {
        let origin = [0, 1].map(|it| at.origin[it] + known.offset[it]);
        self.out.items.clear();
        self.out.stops.clear();
        let is_plain = self.decorate_plainly(
            id,
            &Space {
                origin,
                link: 0,
                scroller: abi::NO_SCROLLER,
                visible: Rect::default(),
            },
        );
        let out = &mut self.out;
        if !is_plain
            || [out.items.len(), out.stops.len()]
                != [known.items[1], known.stops[1]].map(usize::from)
        {
            return false;
        }
        let (item, stop) = (
            (at.start.items + u32::from(known.items[0])) as usize,
            at.start.stops + u32::from(known.stops[0]),
        );
        let shift = Shift {
            tables: Lengths {
                stops: stop,
                ..Lengths::default()
            },
            by: [0.0; 2],
        };
        out.items.iter_mut().for_each(|it| shift.relocate(it));
        part(&mut picture.items, item, out.items.len()).copy_from_slice(&out.items);
        part(&mut picture.stops, stop as usize, out.stops.len()).copy_from_slice(&out.stops);
        true
    }

    /// Of `picture`, what was before the segment is left. The rest is in `old`.
    fn patch(
        document: &Document,
        old: &Picture,
        picture: Picture,
        mut segments: Segments,
        patch: &Patch,
    ) -> (Picture, Segments, bool) {
        let (root, known, next_order) = (
            segments.new,
            segments.all[patch.index as usize],
            segments.next_order,
        );
        let (base, lengths) = (patch.own.start, segments.lengths(&known));
        (segments.old, segments.new, segments.base, segments.groups) = (
            Some(patch.outer),
            patch.outer,
            base,
            u32::from(known.is_grouped),
        );
        let scroller = picture
            .scroller_nodes
            .iter()
            .position(|it| *it == known.scroller)
            .map_or(abi::NO_SCROLLER, |it| it as u32);
        let space = Space {
            origin: patch.own.origin,
            link: patch.own.link,
            scroller,
            visible: known.cut.moved(patch.own.origin),
        };
        let mut painter = Painter::resume(document, old, picture, segments, space.link);
        painter.is_hidden = known.is_hidden;
        painter.paint_segment(known.id, known.kind, space);
        let new = &mut painter.segments.all[patch.index as usize];
        (new.order, new.start, new.link) = (known.order, known.start, known.link);
        let (new, end) = (*new, base.plus(&lengths));
        let has_worked = new.is_independent && new.lengths.items > 0;
        let (rest, by) = (
            Lengths::of(old).minus(&lengths),
            new.lengths.minus(&lengths),
        );
        if by == Lengths::default() {
            lengths.copy(&Lengths::of(old), old, &mut painter.out);
        } else {
            painter.copy(old, &base, &end, &rest, [0.0; 2], None);
            if painter.out.first_hit >= end.hits as usize && painter.out.first_hit > 0 {
                painter.out.first_hit =
                    (painter.out.first_hit as u32).wrapping_add(by.hits) as usize;
            }
        }
        (painter.segments.new, painter.segments.groups) = (root, 0);
        let (segments, mut child) = (&mut painter.segments, known);
        while by != Lengths::default() {
            let parent = segments.all.get_mut(child.parent_index as usize);
            let growth = match parent {
                Some(parent) => &mut parent.growth,
                None => &mut segments.new.growth,
            };
            match segments.growths.get_mut(*growth as usize) {
                Some(growth) => growth.by = growth.by.plus(&by),
                None => {
                    *growth = segments.growths.len() as u32;
                    segments.growths.push(Growth {
                        order: child.order,
                        by,
                    });
                }
            }
            let Some(parent) = segments.all.get(child.parent_index as usize) else {
                break;
            };
            child = *parent;
        }
        debug_assert!(painter.segments.next_order >= next_order);
        (painter.segments.base, painter.out.is_submitted) = (Lengths::default(), false);
        (painter.out, painter.segments, has_worked)
    }

    /// The layers in `id` and in its ancestors depend on the nearest scroller.
    pub(crate) fn layers_depend_on_scroller(&self, mut id: BoxId) {
        while id != 0 && !self.document.boxes[id].scrolls() {
            let it = &self.document.boxes[id];
            it.painted.has_sticky.set(true);
            id = it.parent;
        }
    }

    fn scroll_state(&self, id: BoxId) -> [f32; 8] {
        let document = self.document;
        let scroller = document
            .boxes
            .containers(id)
            .find(|it| document.boxes[*it].scrolls())
            .unwrap_or(VIEWPORT);
        let ([x, y], [[a, b], [c, d]]) = (
            document.scroll_offset(document.boxes[scroller].node),
            document.scroll_range(scroller),
        );
        let client = document.client_box(scroller);
        [x, y, a, b, c, d, client.width, client.height]
    }

    fn former_parent(&self, it: &Segment) -> Option<Position> {
        self.segments.replaced.get(&it.parent).copied().or_else(|| {
            let outer = self.former_parent(
                self.segments
                    .all
                    .get(it.parent_index as usize)
                    .filter(|parent| parent.serial == it.parent)?,
            )?;
            let kept = self
                .document
                .pictures
                .kept
                .get(outer.kept as usize)
                .and_then(Option::as_ref);
            Some(self.segments.position(
                it.parent_index,
                &outer,
                NONE,
                kept.map_or(&self.segments.growths, |it| &it.growths),
            ))
        })
    }

    pub(crate) fn segment(
        &mut self,
        id: BoxId,
        kind: Painted,
        space: &Space,
        paint: impl FnOnce(&mut Self),
    ) {
        let it = &self.document.boxes[id];
        if kind == Painted::StackingContext && it.cache.has_escapees()
            || it.collapsed.is_some()
            || self.is_copy
        {
            return paint(self);
        }
        self.enter(space.link);
        let slot = usize::from(kind == Painted::Inside);
        let (index, is_unchanged) = (&it.painted.segments[slot], &it.painted.is_unchanged[slot]);
        let (outer_old, outer) = (self.segments.old, self.segments.new);
        let is_own = |it: &&Segment| it.id == id && (it.kind == Painted::Inside) == (slot == 1);
        let known = self
            .segments
            .all
            .get(index.get() as usize)
            .filter(is_own)
            .copied();
        let whole = known.filter(|it| it.own.pivot.is_some() && is_unchanged.get());
        let (start, mut looks) = (
            Lengths::of(&self.out),
            whole.map_or_else(|| self.document.looks(id), |it| it.looks),
        );
        let cut = |looks: &Looks| {
            space
                .visible
                .moved(space.origin.map(|it| -it))
                .intersection(&looks.ink.grown(1.0))
        };
        let mut new = Segment {
            id,
            kind,
            is_hidden: self.is_hidden,
            serial: 0,
            parent: outer.serial,
            origin: [
                space.origin[0] - outer.origin[0],
                space.origin[1] - outer.origin[1],
            ],
            start: start.minus(&outer.start),
            lengths: Lengths::default(),
            cut: cut(&looks),
            scroller: self
                .out
                .scroller_nodes
                .get(space.scroller as usize)
                .copied()
                .unwrap_or(0),
            scroll_state: [0.0; 8],
            matrix: self.out.links[space.link as usize].matrix,
            parent_index: outer.index,
            order: self.segments.next_order,
            growth: NONE,
            link: match space.link {
                _ if self.svg.is_on => Anchor::Unknown,
                link if link >= outer.start.links => Anchor::At(link - outer.start.links),
                link if link == outer.link => Anchor::LikeParent,
                _ => Anchor::Unknown,
            },
            looks,
            is_independent: false,
            are_contents_independent: true,
            has_children: false,
            is_grouped: self.segments.groups > 0,
            own: Own::default(),
        };
        self.segments.next_order += 1;
        let around = known.and_then(|it| {
            outer_old
                .filter(|outer| it.parent == outer.serial)
                .or_else(|| self.former_parent(&it))
        });
        let kept =
            around.and_then(|it| self.document.pictures.kept.get(it.kept as usize)?.as_ref());
        let old = around.map(|it| {
            self.segments.position(
                index.get(),
                &it,
                NONE,
                kept.map_or(&self.segments.growths, |it| &it.growths),
            )
        });
        let (moved, old) = (old, old.filter(|_| known.is_some_and(|it| it.kind == kind)));
        if is_unchanged.get()
            && let (Some(known), Some(old), Some(picture)) =
                (known, old, kept.map(|it| &it.picture).or(self.old))
            && (known.is_hidden, known.scroller) == (new.is_hidden, new.scroller)
            && (known.cut == new.cut || known.own.pivot.is_some())
            && (kept.is_none() || known.lengths.scrollers + known.lengths.driven == 0)
        {
            let by = [
                space.origin[0] - old.origin[0],
                space.origin[1] - old.origin[1],
            ];
            let is_whole = |it: f32| (self.snap(it) - it).abs() < 0.001;
            let sticks =
                it.painted.has_sticky.get() && !matches!(kind, Painted::Atomic | Painted::Lines);
            if by.into_iter().all(is_whole)
                && (!sticks || (by, known.scroll_state) == ([0.0; 2], self.scroll_state(id)))
                && (known.lengths.regions == 0 || (by, new.matrix) == ([0.0; 2], known.matrix))
            {
                let base = if kept.is_some() {
                    Lengths::default()
                } else {
                    self.segments.base
                };
                self.copy(picture, &base, &old.start, &known.lengths, by, Some(space));
                if sticks {
                    self.layers_depend_on_scroller(it.parent);
                }
                self.segments.all[index.get() as usize] = Segment {
                    serial: known.serial,
                    lengths: known.lengths,
                    scroll_state: known.scroll_state,
                    is_independent: known.is_independent,
                    are_contents_independent: known.are_contents_independent,
                    has_children: known.has_children,
                    own: known.own,
                    ..new
                };
                return;
            }
        }
        if whole.is_some() {
            looks = self.document.looks(id);
            (new.looks, new.cut) = (looks, cut(&looks));
        }
        if let Some(old) = moved.filter(|_| known.is_some_and(|it| it.has_children)) {
            self.segments.replace(&old);
        }
        self.segments.last_serial += 1;
        new.serial = self.segments.last_serial;
        if known.is_none() {
            index.set(self.segments.all.len() as u32);
            self.segments.all.push(new);
        }
        let position = Position {
            serial: new.serial,
            origin: space.origin,
            start,
            index: index.get(),
            link: space.link,
            growth: NONE,
            kept: NONE,
            is_grouped: self.is_grouped(),
        };
        (self.segments.old, self.segments.new) = (old, position);
        let (outside, outer_reads) = (
            self.outside,
            core::mem::take(&mut self.segments.reads_contents),
        );
        let (outer_own, outer_groups) = (
            core::mem::take(&mut self.segments.own),
            core::mem::take(&mut self.segments.groups),
        );
        is_unchanged.set(true);
        paint(self);
        (new.own, new.has_children) = (
            core::mem::replace(&mut self.segments.own, outer_own),
            self.segments.next_order != new.order + 1,
        );
        self.enter(space.link);
        if self.outside != outside {
            is_unchanged.set(false);
        }
        (self.segments.old, self.segments.new, self.segments.groups) =
            (outer_old, outer, outer_groups);
        new.lengths = Lengths::of(&self.out).minus(&start);
        new.are_contents_independent =
            !core::mem::replace(&mut self.segments.reads_contents, outer_reads);
        new.is_independent = self.outside == outside
            && match kind {
                Painted::StackingContext => true,
                Painted::Positioned => !looks.layers.contains(Layers::HAS_RAISED),
                _ => !looks
                    .layers
                    .intersects(Layers::HAS_LEVEL | Layers::HAS_RAISED),
            };
        if it.painted.has_sticky.get() {
            new.scroll_state = self.scroll_state(id);
        }
        self.segments.all[index.get() as usize] = new;
    }

    /// Without a space, what it refers to outside of the range is still where it was.
    fn copy(
        &mut self,
        old: &Picture,
        base: &Lengths,
        start: &Lengths,
        lengths: &Lengths,
        by: [f32; 2],
        space: Option<&Space>,
    ) {
        let (first, out) = (Lengths::of(&self.out), &mut self.out);
        let shift = Shift {
            tables: first.minus(start),
            by,
        };
        start
            .minus(base)
            .copy(&start.minus(base).plus(lengths), old, out);
        shift.relocate_all(out, &first);
        let link = |link: u32, links: &[Link], contents: &Map<BoxId, Space>| match space {
            _ if link >= start.links => link.wrapping_add(shift.tables.links),
            None => link,
            Some(space) => {
                let known = link
                    .checked_sub(base.links)
                    .map_or_else(|| &links[link as usize], |it| &old.links[it as usize]);
                let inside = contents.get(&known.owner).map(|it| it.link);
                inside
                    .filter(|it| links[*it as usize].depth > links[space.link as usize].depth)
                    .unwrap_or(space.link)
            }
        };
        let earlier = &out.scroller_nodes[..first.scrollers as usize];
        let scroller = |scroller: u32| match space {
            _ if scroller == abi::NO_SCROLLER => scroller,
            _ if scroller >= start.scrollers => scroller.wrapping_add(shift.tables.scrollers),
            Some(space) if scroller >= base.scrollers => {
                let node = old.scroller_nodes[(scroller - base.scrollers) as usize];
                earlier
                    .iter()
                    .position(|it| *it == node)
                    .map_or(space.scroller, |it| it as u32)
            }
            _ => scroller,
        };
        let driver = |source: &mut Source, samples: &mut Span| {
            if let Source::Scroll { scroller: index }
            | Source::Offset {
                scroller: index, ..
            } = source
            {
                *index = scroller(*index);
            }
            shift.samples(samples);
        };
        for index in first.links as usize..out.links.len() {
            let parent = link(out.links[index].parent, &out.links, &self.contents);
            let Link { depth, matrix, .. } = out.links[parent as usize];
            let it = &mut out.links[index];
            shift.relocate(&mut it.item);
            (it.parent, it.depth) = (parent, depth + 1);
            it.matrix = if let Item::PushTransform(own) | Item::PushVector(own) = &it.item {
                multiply(&matrix, own)
            } else {
                matrix
            };
            if let Some((source, samples)) = &mut it.driver {
                driver(source, samples);
                out.numbers[samples.range()]
                    .as_chunks_mut::<7>()
                    .0
                    .iter_mut()
                    .for_each(|it| shift.matrix(&mut it[1..]));
            }
        }
        let mut last = (u32::MAX, 0);
        for Hit {
            shape, link: own, ..
        } in &mut out.hits[first.hits as usize..]
        {
            shift.rect(&mut shape.rect);
            if *own != last.0 {
                last = (*own, link(*own, &out.links, &self.contents));
            }
            *own = last.1;
        }
        out.scrollers[first.scrollers as usize..]
            .iter_mut()
            .for_each(|it| it.parent = scroller(it.parent));
        for it in &mut out.drivers[first.drivers as usize..] {
            it.item = it.item.wrapping_add(shift.tables.items);
            driver(&mut it.source, &mut it.samples);
        }
        for it in &mut out.wheel_hits[first.wheel_hits as usize..] {
            (it.item, it.scroller) = (
                it.item.wrapping_add(shift.tables.items),
                scroller(it.scroller),
            );
            shift.rect(&mut it.rect);
        }
        for (id, it) in &mut out.clips[first.clips as usize..] {
            (it.link, it.scroller) = (
                it.link.wrapping_add(shift.tables.links),
                scroller(it.scroller),
            );
            shift.point(&mut it.origin);
            shift.rect(&mut it.visible);
            self.contents.insert(*id, *it);
        }
    }
}
