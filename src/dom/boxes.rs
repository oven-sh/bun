//! The box tree, made from the flat tree and its styles.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use crate::abi::Rect;
use crate::document::{Document, Quirks};
use crate::inline::{Builder, Inline};
use crate::layout::{Cache, Claims, Layout, at_least};
use crate::name::{Map, Name, Set, is_name, name};
use crate::order::Order as _;
use crate::positioned::Edge;
use crate::properties::{Id, Style, Value};
use crate::segments::Layers;
use crate::selector::Pseudo;
use crate::table::Collapsed;
use crate::tree::{AFTER, BACKDROP, BEFORE, DOCUMENT, Data, Flags, MARKER, Namespace, NodeId};
use crate::types::*;

/// 0 is no box.
pub(crate) type BoxId = u32;
pub(crate) const VIEWPORT: BoxId = 1;

/// A level takes 6 KB of stack, and five times that without optimizations or with a sanitizer.
const MAX_DEPTH: u16 = if cfg!(any(bun_debug, bun_asan)) {
    128
} else {
    400
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Free,
    Block,
    Flex,
    Grid,
    /// The inline-level content of a block container. Always anonymous.
    Lines,
    Replaced,
    Svg,
    /// The disc, circle or square of a list item.
    Bullet,
    Table,
    RowGroup,
    Row,
    Column,
    Columns,
    Math,
}

pub(crate) type Children = smallvec::SmallVec<[BoxId; 4]>;

/// What is used together shares cache lines.
#[repr(C, align(64))]
pub(crate) struct LayoutBox {
    pub(crate) style: Rc<Style>,
    pub(crate) children: Children,
    pub(crate) inline: Option<Box<Inline>>,
    /// 0 for an anonymous box.
    pub(crate) node: NodeId,
    pub(crate) parent: BoxId,
    pub(crate) kind: Kind,
    pub(crate) mode: WritingMode,
    pub(crate) turned: WritingMode,
    pub(crate) has_turned_children: bool,
    /// Nothing but its style and its children decides on its size.
    pub(crate) is_ordinary: bool,
    /// Its first child is the rendered legend of a fieldset.
    pub(crate) has_legend: bool,
    pub(crate) uses_parent: [bool; 2],
    /// Quirks: percentages of its `auto` height refer to its containing block, which it is at least as tall as.
    pub(crate) passes_height: bool,
    pub(crate) fills_parent: bool,
    pub(crate) joins_formatting_context: bool,
    pub(crate) is_skipped: bool,
    /// Its children are in `Boxes::parked`.
    pub(crate) is_parking: bool,
    /// Some children are in `Boxes::split` elements.
    pub(crate) splits_layers: bool,
    /// The overflow that is used: the root element's and the body's go to the viewport.
    pub(crate) overflow: [Overflow; 2],
    pub(crate) layout: Layout,
    pub(crate) cache: Cache,
    /// What it and the boxes in it paint, relative to the border box, before its own transform.
    pub(crate) ink: Extent,
    /// The scrollable overflow, likewise.
    pub(crate) reach: Extent,
    /// With the border box, if nothing clips or transforms it.
    pub(crate) spread: Extent,
    pub(crate) painted: crate::segments::Remembered,
    rare: Option<Box<Rare>>,
    pub(crate) collapsed: Option<Box<Collapsed>>,
    /// The preferred aspect ratio.
    pub(crate) ratio: Option<f32>,
    pub(crate) tag: Name,
    pub(crate) scrollbar_size: f32,
    /// What `layout.location` is relative to.
    pub(crate) container: BoxId,
    pub(crate) outside_marker: BoxId,
    pub(crate) depth: u16,
    /// Horizontal and vertical.
    pub(crate) scrollbars: [bool; 2],
    pub(crate) shrinks_to_fit: bool,
    /// Of the parent that it was last laid out in, which may be gone.
    pub(crate) parent_kind: Kind,
    /// Its writing mode is not that of its parent.
    changes_mode: bool,
    /// Its first line is that of its parent.
    has_first_line: bool,
    /// What an inline element around it is the containing block of.
    pub(crate) claimed_by_inline: Claims,
    /// A block in an inline element.
    pub(crate) is_in_inline: bool,
    /// One may be in it, in the same formatting context as its children.
    pub(crate) has_floats: bool,
    is_under_columns: bool,
    pub(crate) has_anonymous_children: bool,
    pub(crate) is_foreign_object: bool,
    /// In the intrinsic widths of a table.
    pub(crate) ignores_column_percentages: bool,
}

const _: () = assert!(size_of::<LayoutBox>() <= 384);

/// The width of an unknown one is not a number.
pub(crate) struct Extent(Cell<Rect>);

impl Default for Extent {
    fn default() -> Extent {
        Extent(Cell::new(Rect {
            width: f32::NAN,
            ..Rect::default()
        }))
    }
}

impl Extent {
    #[inline]
    pub(crate) fn get(&self) -> Option<Rect> {
        Some(self.0.get()).filter(|it| !it.width.is_nan())
    }

    #[inline]
    pub(crate) fn set(&self, known: Rect) {
        self.0.set(Rect {
            width: at_least(0.0, known.width),
            ..known
        });
    }

    fn forget(&self) {
        self.0.update(|it| Rect {
            width: f32::NAN,
            ..it
        });
    }
}

/// What few boxes have. Writing to it allocates it.
pub(crate) struct Rare {
    /// The out-of-flow boxes that it is the containing block of.
    pub(crate) hoisted: Vec<BoxId>,
    /// What `style` stands in for while the box is turned.
    pub(crate) physical: Option<Rc<Style>>,
    /// From the border box of the parent.
    pub(crate) static_position: [(f32, Edge); 2],
    pub(crate) grid: Option<Box<crate::grid::GridInfo>>,
    pub(crate) inherited: Option<Box<crate::grid::Inherited>>,
    /// Top, right, bottom and left, from anchor positioning.
    pub(crate) anchored: Option<Box<crate::anchor::Anchored>>,
    pub(crate) caption_heights: [f32; 2],
    /// How far the legend goes past the border at the start.
    pub(crate) legend_excess: f32,
}

impl Rare {
    const NOTHING: Rare = Rare {
        hoisted: Vec::new(),
        physical: None,
        static_position: [(0.0, Edge::Near); 2],
        grid: None,
        inherited: None,
        anchored: None,
        caption_heights: [0.0; 2],
        legend_excess: 0.0,
    };
}

impl core::ops::Deref for LayoutBox {
    type Target = Rare;
    #[inline]
    fn deref(&self) -> &Rare {
        self.rare.as_deref().unwrap_or(const { &Rare::NOTHING })
    }
}

impl core::ops::DerefMut for LayoutBox {
    fn deref_mut(&mut self) -> &mut Rare {
        self.rare.get_or_insert_with(|| Box::new(Rare::NOTHING))
    }
}

pub(crate) struct Boxes {
    boxes: Vec<LayoutBox>,
    free: crate::tree::FreeList,
    /// Without a parent, and with all that is in them until the room is needed or there is time.
    buried: Vec<BoxId>,
    buried_since: Option<f64>,
    are_being_built: bool,
    spare_builder: Option<Box<Builder>>,
    /// Buried ones, each after the parent that still lists it.
    bereaved: Vec<[BoxId; 2]>,
    /// Have got `Flags::REBUILD`, and their ancestors do not know.
    to_rebuild: Vec<NodeId>,
    /// There are rules for `::first-line`, and for `::first-letter`.
    styles_first: [bool; 2],
    had_styles_first: bool,
    /// Those that `::first-line` or `::first-letter` has applied to.
    pub(crate) styled_first: RefCell<Set<NodeId>>,
    /// Some styles with that of an anonymous child, while boxes are built.
    anonymous_styles: [Option<[Rc<Style>; 2]>; 32],
    /// Those whose contents have changed.
    pub(crate) stale: Vec<BoxId>,
    pub(crate) parked: Map<BoxId, crate::lock::Parked>,
    pub(crate) parked_stale: Vec<BoxId>,
    /// What has to be painted again is in these.
    pub(crate) changed: RefCell<Vec<BoxId>>,
    pub(crate) has_annotations: bool,
    /// Some text has had a style other than that of its element.
    pub(crate) has_pinned_styles: bool,
    /// By address and mode. The original is kept for its address to stay taken.
    pub(crate) turned_styles: RefCell<Map<(usize, u8), [Rc<Style>; 2]>>,
    pub(crate) sized_by_viewport: Set<BoxId>,
    /// Spanners, while the widths of columns are measured.
    /// Where table sections are repeated, relative to themselves.
    pub(crate) copies: Map<BoxId, Vec<[f32; 2]>>,
    pub(crate) lattices: Map<BoxId, crate::table::Lattice>,
    pub(crate) recordings: RefCell<Map<BoxId, crate::svg_paint::Recording>>,
    pub(crate) tables: Map<BoxId, crate::table::Prepared>,
    /// Changes with their styles and with their children.
    pub(crate) table_parts_version: u32,
    pub(crate) ignored: Vec<BoxId>,
    /// Inline elements that are positioned or stacking contexts, and have blocks inside.
    pub(crate) split: Set<NodeId>,
    /// Of the boxes that are split, and the columns of what flows through them.
    pub(crate) pieces: Map<BoxId, Vec<crate::fragment::Piece>>,
    pub(crate) math: Map<BoxId, crate::math::MathBox>,
}

impl core::ops::Index<BoxId> for Boxes {
    type Output = LayoutBox;
    fn index(&self, id: BoxId) -> &LayoutBox {
        &self.boxes[id as usize]
    }
}

impl core::ops::IndexMut<BoxId> for Boxes {
    fn index_mut(&mut self, id: BoxId) -> &mut LayoutBox {
        &mut self.boxes[id as usize]
    }
}

impl LayoutBox {
    #[inline(always)]
    fn new(kind: Kind, node: NodeId, style: Rc<Style>) -> LayoutBox {
        LayoutBox {
            kind,
            node,
            overflow: [style.layout.overflow_x, style.layout.overflow_y],
            mode: style.text.writing_mode,
            style,
            turned: WritingMode::HorizontalTb,
            has_turned_children: false,
            changes_mode: false,
            is_ordinary: false,
            has_legend: false,
            has_first_line: false,
            parent: 0,
            depth: 0,
            children: Children::new(),
            rare: None,
            container: 0,
            outside_marker: 0,
            layout: Layout::default(),
            claimed_by_inline: Claims::empty(),
            splits_layers: false,
            is_in_inline: false,
            has_floats: false,
            is_under_columns: false,
            has_anonymous_children: false,
            cache: Cache::default(),
            inline: None,
            collapsed: None,
            scrollbars: [false; 2],
            scrollbar_size: 0.0,
            shrinks_to_fit: false,
            tag: Name::NONE,
            ratio: None,
            uses_parent: [false; 2],
            passes_height: false,
            fills_parent: false,
            joins_formatting_context: kind == Kind::Lines,
            parent_kind: Kind::Block,
            is_skipped: false,
            is_parking: false,
            is_foreign_object: false,
            ignores_column_percentages: false,
            ink: Extent::default(),
            painted: Default::default(),
            reach: Extent::default(),
            spread: Extent::default(),
        }
    }

    pub(crate) fn take_hoisted(&mut self) -> Vec<BoxId> {
        self.rare
            .as_mut()
            .map_or(Vec::new(), |it| core::mem::take(&mut it.hoisted))
    }

    #[inline]
    pub(crate) fn forget_hoisted(&mut self) {
        self.rare.iter_mut().for_each(|it| it.hoisted.clear());
    }

    pub(crate) fn forget_extents(&self) {
        self.ink.forget();
        self.painted.forget_layers();
        self.reach.forget();
        self.spread.forget();
    }

    /// What the boxes around it have made of it.
    pub(crate) fn covered(&self) -> Option<(Rect, Rect, Layers)> {
        Some((
            self.spread.get()?,
            self.ink.get()?,
            self.painted.layers.get(),
        ))
        .filter(|it| it.2.contains(Layers::KNOWN))
    }

    fn forget_ink(&self) {
        self.inline.iter().for_each(|it| it.outset.set(None));
        self.forget_extents();
    }

    pub(crate) fn scrolls(&self) -> bool {
        self.overflow[0].scrolls() || self.overflow[1].scrolls()
    }

    #[inline(always)]
    pub(crate) fn border(&self) -> [f32; 4] {
        match self.collapsed.is_none()
            && self.rare.is_none()
            && matches!(self.kind, Kind::Block | Kind::Flex | Kind::Grid)
        {
            true => self.style.fixed().border.to_array(),
            false => self.border_of_any(),
        }
    }

    fn border_of_any(&self) -> [f32; 4] {
        match (&self.collapsed, self.kind) {
            (Some(collapsed), _) => collapsed.map(|it| it.width / 2.0),
            (None, Kind::Row | Kind::RowGroup | Kind::Lines) => [0.0; 4],
            (None, _) if self.rare.as_ref().is_some_and(|it| it.legend_excess != 0.0) => {
                let (mut border, start) = (self.style.border(), self.mode.sides()[0]);
                border[self
                    .turned
                    .sides()
                    .iter()
                    .position(|it| *it == start)
                    .unwrap_or(0)] += self.legend_excess;
                border
            }
            (None, _) => self.style.fixed().border.to_array(),
        }
    }

    pub(crate) fn is_in_block(&self, boxes: &Boxes) -> bool {
        boxes[self.parent].kind == Kind::Block
    }

    pub(crate) fn is_clamped(&self) -> bool {
        self.style.clamps_lines()
    }

    /// Whether what overflows at the left and at the top can be scrolled to, instead of what overflows at the other side.
    pub(crate) fn reaches_negative_overflow(&self) -> [bool; 2] {
        let ([inline, block], reverses) = (
            if self.scrolls() {
                self.flows_back()
            } else {
                [false; 2]
            },
            self.mode.reverses(),
        );
        self.mode.turn_axes([
            (inline != self.style.is_rtl()) != reverses[0],
            block != reverses[1],
        ])
    }

    fn flows_back(&self) -> [bool; 2] {
        let l = &self.style.layout;
        let wraps_back = l.flex_wrap.is_reversed;
        match (self.kind, l.flex_direction) {
            (Kind::Flex, FlexDirection::Row) => [false, wraps_back],
            (Kind::Flex, FlexDirection::RowReverse) => [true, wraps_back],
            (Kind::Flex, FlexDirection::Column) => [wraps_back, false],
            (Kind::Flex, FlexDirection::ColumnReverse) => [wraps_back, true],
            _ => [false; 2],
        }
    }

    #[inline]
    pub(crate) fn is_quiet(&self) -> bool {
        self.style
            .fixed()
            .traits
            .contains(crate::layout::Traits::IS_QUIET)
    }

    pub(crate) fn is_replaced(&self) -> bool {
        matches!(self.kind, Kind::Replaced | Kind::Svg | Kind::Bullet)
    }
}

#[inline]
fn prefetch<T>(value: &T) {
    let start = core::ptr::from_ref(value).cast::<u8>();
    (0..size_of::<T>()).step_by(64).for_each(|it| {
        core::hint::prefetch_write(start.wrapping_add(it).cast_mut(), core::hint::Locality::L1)
    });
}

impl Boxes {
    pub(crate) fn new(initial: &Rc<Style>) -> Boxes {
        let new = |kind, node| LayoutBox::new(kind, node, Rc::clone(initial));
        Boxes {
            boxes: vec![new(Kind::Free, 0), new(Kind::Block, DOCUMENT)],
            free: Default::default(),
            anonymous_styles: Default::default(),
            stale: Vec::new(),
            parked: Map::default(),
            parked_stale: Vec::new(),
            changed: RefCell::default(),
            has_annotations: false,
            has_pinned_styles: false,
            turned_styles: RefCell::default(),
            sized_by_viewport: Set::default(),
            pieces: Map::default(),
            copies: Map::default(),
            lattices: Map::default(),
            math: Map::default(),
            recordings: RefCell::default(),
            tables: Map::default(),
            table_parts_version: 0,
            ignored: Vec::new(),
            buried: Vec::new(),
            buried_since: None,
            are_being_built: false,
            spare_builder: None,
            bereaved: Vec::new(),
            to_rebuild: Vec::new(),
            styles_first: [false; 2],
            had_styles_first: false,
            styled_first: RefCell::default(),
            split: Set::default(),
        }
    }

    fn create(&mut self, kind: Kind, node: NodeId, style: Rc<Style>) -> BoxId {
        let id = self.free.pop().or_else(|| {
            for _ in 0..1024 {
                let Some(id) = self.exhume() else { break };
                (self[id].kind, self[id].node) = (Kind::Free, 0);
                self.free.push(id);
            }
            self.free.pop()
        });
        match id {
            Some(id) => {
                if let Some(next) = self.boxes.get(self.free.ahead(id, 3) as usize) {
                    prefetch(next);
                    next.inline.as_deref().into_iter().for_each(prefetch);
                }
                self.reset(id, kind, node, style);
                id
            }
            None => {
                if self.boxes.len() == 1 << 9 {
                    self.boxes.reserve(1 << 14);
                }
                self.boxes.push(LayoutBox::new(kind, node, style));
                (self.boxes.len() - 1) as BoxId
            }
        }
    }

    fn forget(&mut self, id: BoxId) -> impl DoubleEndedIterator<Item = BoxId> + use<> {
        if self[id].is_parking {
            self.unpark(id);
        }
        if !self.math.is_empty() {
            self.math.remove(&id);
        }
        if self[id].kind == Kind::Svg {
            self.recordings.get_mut().remove(&id);
        } else if self[id].kind == Kind::Table {
            self.tables.remove(&id);
            self.lattices.remove(&id);
        }
        if !self.pieces.is_empty() {
            self.pieces.remove(&id);
            self.copies.remove(&id);
        }
        let it = &mut self[id];
        core::mem::take(&mut it.children)
            .into_iter()
            .chain((it.outside_marker != 0).then_some(it.outside_marker))
    }

    fn exhume(&mut self) -> Option<BoxId> {
        let id = self.buried.pop()?;
        if let Some(ahead) = self.boxes.get(id as usize + 8) {
            prefetch(&ahead.node);
            prefetch(&ahead.outside_marker);
        }
        core::hint::prefetch_write(
            self.boxes.as_mut_ptr().wrapping_add(id as usize + 8),
            core::hint::Locality::L1,
        );
        for child in self.forget(id).rev() {
            if self[child].parent == id {
                self[child].parent = 0;
                self.buried.push(child);
            }
        }
        Some(id)
    }

    fn tell_bereaved(&mut self) {
        let bereaved = core::mem::take(&mut self.bereaved);
        if bereaved.len() > 64 {
            self.buried.order_by(|a, b| b.cmp(a));
        }
        for lost in bereaved.chunk_by(|a, b| a[0] == b[0]) {
            let parent = lost[0][0];
            let mut children = core::mem::take(self.all_children(parent));
            match lost.len() {
                _ if children.iter().eq(lost.iter().map(|it| &it[1]))
                    || children.iter().rev().eq(lost.iter().map(|it| &it[1])) =>
                {
                    children.clear()
                }
                ..8 => lost.iter().for_each(|it| {
                    _ = children
                        .iter()
                        .rposition(|child| *child == it[1])
                        .map(|it| children.remove(it))
                }),
                _ => children.retain(|it| self[*it].parent == parent),
            }
            *self.all_children(parent) = children;
        }
    }

    pub(crate) fn most_so_far(&self) -> usize {
        self.boxes.len()
    }

    pub(crate) fn is_alive(&self, id: BoxId) -> bool {
        self[id].kind != Kind::Free
            && (self.buried.is_empty()
                || core::iter::successors(Some(id), |it| {
                    Some(self[*it].parent).filter(|it| *it != 0)
                })
                .last()
                    == Some(VIEWPORT))
    }

    /// How long until the buried are freed.
    pub(crate) fn next_sweep(&self, now: f64) -> f64 {
        self.buried_since
            .map_or(f64::INFINITY, |it| it + 500.0 - now)
    }

    pub(crate) fn sweep(&mut self, now: f64, initial: &Rc<Style>) {
        if self.next_sweep(now) <= 0.0 {
            self.tell_bereaved();
            for _ in 0..4096 {
                let Some(id) = self.exhume() else { break };
                self.release(id, initial);
            }
        }
        self.buried_since = (!self.buried.is_empty()).then(|| self.buried_since.unwrap_or(now));
    }

    fn release(&mut self, id: BoxId, initial: &Rc<Style>) {
        self.reset(id, Kind::Free, 0, Rc::clone(initial));
        self.free.push(id);
    }

    fn reset(&mut self, id: BoxId, kind: Kind, node: NodeId, style: Rc<Style>) {
        let it = &mut self[id];
        let painted = it.painted.reused();
        *it = LayoutBox {
            painted,
            ..LayoutBox::new(kind, node, style)
        };
    }

    #[inline]
    fn announce_floats(&mut self, id: BoxId) {
        let (mut at, mut passes) = (
            id,
            self[id].style.is_floating()
                || self[id].has_floats && self[id].joins_formatting_context,
        );
        while passes {
            at = self[at].parent;
            passes = at != 0
                && !core::mem::replace(&mut self[at].has_floats, true)
                && self[at].joins_formatting_context;
        }
    }

    #[inline]
    fn note_columns(&mut self, id: BoxId, is_under: bool) {
        if core::mem::replace(&mut self[id].is_under_columns, is_under) != is_under {
            let (marker, below) = (
                self[id].outside_marker,
                is_under || self[id].kind == Kind::Columns,
            );
            self.all_children(id)
                .clone()
                .into_iter()
                .chain((marker != 0).then_some(marker))
                .for_each(|it| self.note_columns(it, below));
        }
    }

    /// Whether it has no pieces, and neither has what is directly in it.
    #[inline(always)]
    pub(crate) fn is_unbroken(&self, id: BoxId) -> bool {
        self.pieces.is_empty() || !self[id].is_under_columns && self[id].kind != Kind::Columns
    }

    /// They tend to be in tree order.
    #[inline(always)]
    pub(crate) fn prefetch_after(&self, id: BoxId) {
        if let Some([near, _, far]) = self
            .boxes
            .get(id as usize + 2..)
            .and_then(<[_]>::first_chunk)
        {
            prefetch(far);
            near.inline.iter().for_each(|it| prefetch(&it.lines));
        }
    }

    /// Its style has changed.
    pub(crate) fn mark_layout(&mut self, id: BoxId) {
        self.note_new_part(id);
        let it = &mut self[id];
        let is_apart = it.style.is_out_of_flow()
            && it.has_insets()
            && it.cache.is_current()
            && !it.cache.has_escapees();
        it.cache.clear();
        self.mark_contents(if is_apart { id } else { self[id].parent });
    }

    pub(crate) fn note_new_part(&mut self, id: BoxId) {
        if matches!(
            self[id].kind,
            Kind::Table | Kind::RowGroup | Kind::Row | Kind::Column
        ) || self[id].parent_kind == Kind::RowGroup
        {
            self.table_parts_version = self.table_parts_version.wrapping_add(1);
        }
    }

    pub(crate) fn mark_contents(&mut self, id: BoxId) {
        self.note_new_part(id);
        if id != 0 && self[id].cache.make_stale() {
            self.stale.push(id);
        }
    }

    pub(crate) fn forget_all_extents(&self) {
        self.boxes.iter().for_each(LayoutBox::forget_ink);
    }

    /// What its text paints has changed.
    pub(crate) fn mark_ink_of_text(&self, id: BoxId) {
        for child in self[id].children.iter().filter(|it| self[**it].node == 0) {
            self[*child].forget_ink();
            self.mark_ink_of_text(*child);
        }
    }

    pub(crate) fn mark_ink(&self, id: BoxId) {
        self[id].forget_ink();
        self.mark_ink_around(id);
    }

    /// It has forgotten its own.
    pub(crate) fn mark_ink_around(&self, id: BoxId) {
        let (was_laid_out, mut at) = (self[VIEWPORT].painted.was_laid_out.get(), self[id].parent);
        while at != 0 {
            if self[at].is_parking {
                return;
            }
            self[at].forget_extents();
            at = self[at].parent;
        }
        self.note_change(id);
        self[VIEWPORT].painted.was_laid_out.set(was_laid_out);
    }

    pub(crate) fn note_change(&self, id: BoxId) {
        let mut changed = self.changed.borrow_mut();
        if changed.len() > 64 {
            *changed = vec![VIEWPORT];
        } else if id != 0 && changed.first() != Some(&VIEWPORT) && changed.last() != Some(&id) {
            changed.push(id);
        }
    }

    pub(crate) fn containers(&self, id: BoxId) -> impl Iterator<Item = BoxId> + Clone + '_ {
        let some = |id| (id != 0).then_some(id);
        core::iter::successors(some(self[id].container), move |id| {
            some(self[*id].container)
        })
    }
}

/// A child in the flat tree, after `display: none` and `display: contents`.
#[derive(Clone)]
pub(crate) enum Child {
    Text(NodeId, Rc<Style>),
    Element(NodeId, Rc<Style>),
}

type Gathered = smallvec::SmallVec<[Child; 4]>;

struct Siblings {
    parent: BoxId,
    boxes: Children,
    lines: Option<Box<Builder>>,
    /// The inline elements around the current position.
    open: Vec<(NodeId, Rc<Style>)>,
    is_before_first_line: bool,
    is_before_first_letter: bool,
}

pub(crate) fn is_collapsible_space(text: &[u8], style: &Style) -> bool {
    match style.text.collapse {
        WhiteSpaceCollapse::Collapse => text.iter().all(u8::is_ascii_whitespace),
        WhiteSpaceCollapse::PreserveBreaks => text.iter().all(|byte| matches!(byte, b' ' | b'\t')),
        _ => text.is_empty(),
    }
}

fn flow_of(style: &Style) -> (WritingMode, bool, TextOrientation) {
    (
        style.text.writing_mode,
        style.is_rtl(),
        style.text.orientation,
    )
}

impl Document {
    /// The box that the node itself generates, which text and inline elements do not have.
    pub(crate) fn own_box(&self, id: NodeId) -> Option<BoxId> {
        let found = self.tree[id].layout_box;
        (found != 0 && self.boxes[found].node == id).then_some(found)
    }

    /// The boxes of the children of `id` have to be made again.
    pub(crate) fn mark_rebuild(&mut self, id: NodeId) {
        let owner = core::iter::once(id)
            .chain(self.tree.flat_ancestors(id))
            .find(|it| self.own_box(*it).is_some() || self.tree[*it].has(Flags::REBUILD));
        if let Some(owner) = owner.filter(|it| self.own_box(*it).is_some()) {
            self.flag_rebuild(owner);
        }
    }

    /// On an element that has no box, the flag says that it is about to get one.
    fn flag_rebuild(&mut self, id: NodeId) {
        let is_new = !self.tree[id].has(Flags::REBUILD);
        self.tree[id].set(Flags::REBUILD);
        let has_contents = self.tree[id].layout_box != 0;
        if !(has_contents && self.tree[id].has(Flags::SKIPPED)) && !self.is_in_skipped_contents(id)
        {
            self.boxes.to_rebuild.extend(is_new.then_some(id));
            self.needs_layout = true;
        } else if !has_contents || !self.skips_contents(id) {
            self.tree.mark_ancestors(id, Flags::REBUILD_BELOW);
            self.needs_layout = self.needs_layout || !self.is_locked(id);
        }
    }

    pub(crate) fn announce_rebuilds(&mut self) {
        for id in self
            .boxes
            .to_rebuild
            .drain(..)
            .filter(|it| self.tree[*it].has(Flags::REBUILD))
        {
            self.tree.mark_ancestors(id, Flags::REBUILD_BELOW);
        }
    }

    /// The box of the parent and the box before, if those of the siblings are the same with and without that of `id`.
    fn place_among_siblings(&self, id: NodeId, style: &Style) -> Option<[BoxId; 2]> {
        let node = self.tree[id].parent;
        let (parent, element) = (self.own_box(node)?, self.tree.element(node)?);
        let (outer, display) = (&self.boxes[parent], style.display());
        let fits = match outer.kind {
            Kind::Block => {
                !display.is_inline_level()
                    && !outer.style.is_editable()
                    && element.pseudo == Pseudo::None
                    && !outer.splits_layers
            }
            Kind::Flex | Kind::Grid => true,
            Kind::RowGroup => display == Display::TableRow,
            Kind::Row => display == Display::TableCell,
            _ => false,
        };
        let is_table_part = display as u8 >= Display::TableRowGroup as u8;
        (fits
            && is_table_part == matches!(outer.kind, Kind::RowGroup | Kind::Row)
            && !matches!(display, Display::Contents | Display::Inline)
            && !(display.is_list_item() && element.generated[BEFORE..=AFTER] != [0; 2])
            && !outer.is_parking
            && outer.depth < MAX_DEPTH
            && outer.tag != name!("fieldset")
            && element.namespace == Namespace::Html
            && !self.tree[node]
                .has(Flags::REDIRECTS_CHILDREN | Flags::BASE_SELECT | Flags::SKIPPED)
            && !self.tree[id].has(Flags::TOP_LAYER)
            && self.carousels.is_empty())
        .then_some(())?;
        let leaves_trace = |it: &NodeId| match &self.tree[*it].data {
            Data::Text(text) => {
                self.tree[*it].layout_box != 0
                    || !is_collapsible_space(text.as_bytes(), &outer.style)
            }
            Data::Element(element) => element
                .style
                .as_ref()
                .is_some_and(|it| it.display() != Display::None),
            _ => *it == 0,
        };
        let previous = core::iter::successors(Some(self.tree[id].previous), |it| {
            Some(self.tree[*it].previous)
        })
        .take(8)
        .find(leaves_trace)?;
        let before = match previous {
            0 => (element.generated[BEFORE] == 0 && element.generated[MARKER] == 0).then_some(0)?,
            _ => self
                .own_box(previous)
                .filter(|it| self.boxes[*it].parent == parent)?,
        };
        let is_first = || {
            before == 0
                || self.boxes[before].style.is_floating()
                || self.boxes[before].style.is_out_of_flow()
        };
        (self.boxes.styles_first == [false; 2] || !is_first()).then_some([parent, before])
    }

    /// The element has got a style.
    pub(crate) fn request_box(&mut self, id: NodeId, display: Display) {
        let parent = self.tree[id].parent;
        let has_blocks = |it: BoxId| {
            matches!(
                self.boxes[it].kind,
                Kind::Block | Kind::Flex | Kind::Grid | Kind::RowGroup | Kind::Row
            )
        };
        match self.own_box(parent).is_some_and(has_blocks)
            && !self.tree[parent].has(Flags::REBUILD | Flags::REDIRECTS_CHILDREN)
            && self.tree[id].layout_box == 0
            && !display.is_inline_level()
            && display != Display::Contents
        {
            true => {
                self.renumber_around(parent, display.is_list_item());
                self.flag_rebuild(id);
            }
            false => self.mark_parent_rebuild(id),
        }
    }

    fn insert_box(&mut self, id: NodeId) -> Option<()> {
        let style = Rc::clone(self.tree.style(id)?);
        let [parent, before] = self
            .place_among_siblings(id, &style)
            .filter(|_| !self.tree[self.tree[id].parent].has(Flags::REBUILD))?;
        let kind = self
            .kind_of(id, &style)
            .filter(|_| self.tree.html_tag(id) != name!("embed"))?;
        let siblings = &self.boxes[parent].children;
        let index = match before {
            0 => 0,
            _ if siblings.last() == Some(&before) => siblings.len(),
            _ => siblings.iter().take(4096).position(|it| *it == before)? + 1,
        };
        let order = |style: &Style| {
            if style.is_out_of_flow() {
                0
            } else {
                style.layout.order
            }
        };
        let neighbor = if before == 0 {
            siblings.first().copied()
        } else {
            Some(before)
        };
        (!matches!(self.boxes[parent].kind, Kind::Flex | Kind::Grid)
            || neighbor.is_none_or(|it| order(&self.boxes[it].style) == order(&style)))
        .then_some(())?;
        let new = self.box_for(parent, id, kind, &style);
        self.boxes[parent].children.insert(index, new);
        self.boxes.mark_contents(parent);
        Some(())
    }

    /// The node is about to lose its style.
    pub(crate) fn note_departure(&mut self, id: NodeId) {
        let (style, parent) = (self.tree.style(id), self.tree[id].parent);
        let is_missed = match (self.own_box(id), style) {
            (Some(own), Some(style)) => {
                self.tree[parent].has(Flags::REBUILD)
                    || self
                        .place_among_siblings(id, style)
                        .is_none_or(|it| it[0] != self.boxes[own].parent)
            }
            _ => self.tree[id].layout_box != 0 || style.is_some(),
        };
        match (is_missed, self.tree[id].layout_box) {
            (true, _) => self.mark_parent_rebuild(id),
            (_, 0) => {}
            _ => {
                self.renumber_around(parent, style.is_some_and(|it| it.display().is_list_item()));
                self.needs_layout = self.needs_layout || !self.is_locked(id);
            }
        }
    }

    pub(crate) fn mark_parent_rebuild(&mut self, id: NodeId) {
        match self.tree[id].has(Flags::TOP_LAYER)
            || !self.top_layer.is_empty()
                && self
                    .tree
                    .element(id)
                    .is_some_and(|it| it.pseudo == Pseudo::Backdrop)
        {
            true => self.mark_rebuild(DOCUMENT),
            false
                if !self.carousels.is_empty()
                    && let Some(parent) = self.layout_parent_of_part(id) =>
            {
                self.needs_layout = true;
                self.mark_rebuild(parent);
            }
            false
                if !self.has_foreign_objects
                    && self
                        .tree
                        .element(self.tree[id].parent)
                        .is_some_and(crate::svg::has_svg_children) => {}
            false => self.mark_rebuild(self.tree.flat_parent(id)),
        }
    }

    pub(crate) fn destroy_box(&mut self, id: BoxId) {
        let (children, inline, node) = (
            self.boxes.forget(id),
            self.boxes[id].inline.take(),
            self.boxes[id].node,
        );
        self.boxes.release(id, &self.styles.initial);
        for node in inline
            .iter()
            .flat_map(|inline| inline.nodes())
            .chain([node])
        {
            if self.tree[node].layout_box == id {
                self.tree[node].layout_box = 0;
            }
        }
        for child in children {
            if self.boxes[child].parent == id {
                self.destroy_box(child);
            }
        }
    }

    /// Whether `own` was among the children.
    fn part_from_parent(&mut self, own: BoxId) -> bool {
        let parent = self.boxes[own].parent;
        self.boxes.mark_contents(parent);
        let marker = match self.boxes[parent].is_parking {
            true => &mut self.boxes.parked.entry(parent).or_default().outside_marker,
            false => &mut self.boxes[parent].outside_marker,
        };
        if *marker == own {
            *marker = 0;
            return false;
        }
        true
    }

    /// For a node whose boxes are made anew.
    pub(crate) fn detach_box(&mut self, id: NodeId) {
        if let Some(own) = self.own_box(id) {
            if self.part_from_parent(own) {
                let siblings = self.boxes.all_children(self.boxes[own].parent);
                siblings
                    .iter()
                    .rposition(|it| *it == own)
                    .into_iter()
                    .for_each(|it| _ = siblings.remove(it));
            }
            self.destroy_box(own);
        }
        self.tree[id].layout_box = 0;
    }

    /// For a node that leaves the tree, or stops being rendered. All nodes in it have to forget their boxes. Whether it had one.
    pub(crate) fn bury_box(&mut self, id: NodeId) -> bool {
        let Some(own) = self.own_box(id).filter(|_| !self.boxes.are_being_built) else {
            self.detach_box(id);
            return false;
        };
        self.tree[id].layout_box = 0;
        if self.part_from_parent(own) && self.boxes[own].parent != 0 {
            self.boxes.bereaved.push([self.boxes[own].parent, own]);
        }
        self.boxes[own].parent = 0;
        self.boxes.buried.push(own);
        true
    }

    pub(crate) fn rendered_children(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let generated = self
            .tree
            .element(id)
            .map_or([0; 4], |element| element.generated);
        let some = move |index: usize| (generated[index] != 0).then_some(generated[index]);
        let has_icon = self.tree[id].has(Flags::BASE_SELECT);
        (some(MARKER)
            .filter(|_| !has_icon)
            .into_iter()
            .chain(some(BEFORE)))
        .chain(self.tree.flat_children(id))
        .chain(some(AFTER))
        .chain(some(MARKER).filter(|_| has_icon))
    }

    #[inline]
    fn gather_child(&self, child: NodeId, style: &Rc<Style>, out: &mut Gathered) {
        match &self.tree[child].data {
            Data::Text(_) => out.push(Child::Text(child, Rc::clone(style))),
            Data::Element(element) => match &element.style {
                Some(own) if !self.tree[child].has(Flags::TOP_LAYER) => match own.display() {
                    Display::None => {}
                    Display::Contents => self.gather(child, own, out),
                    _ if element.html_tag() == name!("embed") && element.replaced.is_none() => {}
                    _ => out.push(Child::Element(child, Rc::clone(own))),
                },
                _ => {}
            },
            _ => {}
        }
    }

    fn gather(&self, id: NodeId, style: &Rc<Style>, out: &mut Gathered) {
        if self.carousels.is_empty()
            && !self.tree[id].has(Flags::REDIRECTS_CHILDREN)
            && self
                .tree
                .element(id)
                .is_none_or(|it| it.generated == [0; 4])
        {
            return self
                .tree
                .children(id)
                .for_each(|it| self.gather_child(it, style, out));
        }
        let beside = |id: NodeId, after: bool, out: &mut Gathered| {
            out.extend(
                self.parts_beside(id, after)
                    .into_iter()
                    .map(|it| Child::Element(it.0, it.1)),
            )
        };
        let has_parts = !self.carousels.is_empty();
        if has_parts && self.tree.element(id).is_some_and(|it| it.is_generated()) {
            out.extend(
                self.carousels
                    .markers_in(id)
                    .iter()
                    .filter_map(|it| Some(Child::Element(*it, Rc::clone(self.tree.style(*it)?)))),
            );
        } else if has_parts && self.tree.is_root(id) {
            beside(id, false, out);
        }
        for child in self.rendered_children(id) {
            let has_parts = has_parts && !self.tree.is_root(child);
            if has_parts {
                beside(child, false, out);
            }
            self.gather_child(child, style, out);
            if has_parts {
                beside(child, true, out);
            }
        }
        if has_parts && self.tree.is_root(id) {
            beside(id, true, out);
        }
    }

    /// `None` for an inline element.
    pub(crate) fn kind_of(&self, id: NodeId, style: &Style) -> Option<Kind> {
        let element = self.tree.element(id)?;
        let tag = element.html_tag();
        if crate::svg::has_svg_children(element) {
            return Some(Kind::Svg);
        }
        if is_name!(tag, "br" | "wbr") && element.replaced.is_none() {
            return None;
        }
        if is_name!(tag, "canvas" | "video" | "iframe" | "embed" | "audio")
            || element.replaced.is_some()
            || tag == name!("img") && element.shadow_root == 0
        {
            return Some(Kind::Replaced);
        }
        if element.pseudo == Pseudo::Marker && self.tree[id].first_child == 0 {
            return Some(Kind::Bullet);
        }
        let is_control = is_name!(
            tag,
            "input" | "textarea" | "select" | "button" | "meter" | "progress" | "fieldset"
        );
        Some(match style.display() {
            display if display.is_inline_box() && !is_control => return None,
            display if display.is_math() => {
                if crate::math::is_token(element) {
                    Kind::Block
                } else {
                    Kind::Math
                }
            }
            _ if style.clamps_lines() => Kind::Block,
            Display::Flex | Display::InlineFlex | Display::WebkitBox | Display::WebkitInlineBox => {
                Kind::Flex
            }
            Display::Grid | Display::InlineGrid => Kind::Grid,
            _ if is_name!(tag, "fieldset" | "button")
                && style.display() as u8 >= Display::Table as u8 =>
            {
                Kind::Block
            }
            Display::Table | Display::InlineTable => Kind::Table,
            Display::TableRow => Kind::Row,
            Display::TableColumn | Display::TableColumnGroup => Kind::Column,
            display if display.is_row_group() => Kind::RowGroup,
            _ if style.rare.column_count.0.is_some()
                || style.rare.column_width.0.is_some()
                || style.rare.column_height.0.is_some() =>
            {
                Kind::Columns
            }
            _ => Kind::Block,
        })
    }

    fn adopt(&mut self, parent: BoxId, child: BoxId) {
        let (depth, kind) = (self.boxes[parent].depth + 1, self.boxes[parent].kind);
        self.boxes.note_columns(
            child,
            kind == Kind::Columns || self.boxes[parent].is_under_columns,
        );
        let it = &mut self.boxes[child];
        it.parent_kind = kind;
        (it.parent, it.container, it.depth, it.claimed_by_inline) =
            (parent, parent, depth, Claims::empty());
    }

    fn anonymous(&mut self, parent: BoxId, kind: Kind, display: Display) -> BoxId {
        let outer = &self.boxes[if self.boxes[parent].kind == Kind::Lines {
            self.boxes[parent].parent
        } else {
            parent
        }]
        .style;
        // Lines are painted in the styles of the elements.
        let address = if kind == Kind::Lines {
            Rc::as_ptr(&outer.font).addr() ^ Rc::as_ptr(&outer.text).addr()
        } else {
            Rc::as_ptr(outer).addr()
        };
        let slot = (address >> 6) % 16 + if kind == Kind::Lines { 16 } else { 0 };
        let does = |known: &Rc<Style>| {
            Rc::ptr_eq(known, outer)
                || kind == Kind::Lines
                    && known.inherits_the_same_but_ink(outer)
                    && known.font_id == outer.font_id
                    && known.is_visible() == outer.is_visible()
        };
        let style = match &self.boxes.anonymous_styles[slot] {
            Some([known, style]) if does(known) && style.display() == display => Rc::clone(style),
            _ => {
                let style = self.anonymous_style(outer, display);
                self.boxes.anonymous_styles[slot] = Some([Rc::clone(outer), Rc::clone(&style)]);
                style
            }
        };
        let id = self.boxes.create(kind, 0, style);
        (
            self.boxes[id].uses_parent[1],
            self.boxes[parent].has_anonymous_children,
        ) = (true, true);
        self.adopt(parent, id);
        id
    }

    fn box_for(&mut self, parent: BoxId, node: NodeId, kind: Kind, style: &Rc<Style>) -> BoxId {
        self.box_in_flow(parent, node, kind, style, false)
    }

    fn box_in_flow(
        &mut self,
        parent: BoxId,
        id: NodeId,
        kind: Kind,
        style: &Rc<Style>,
        has_first_line: bool,
    ) -> BoxId {
        if let Some(existing) = self.own_box(id) {
            if self.boxes[existing].kind == kind
                && self.boxes[existing].depth == self.boxes[parent].depth + 1
            {
                let is_in_other_kind = self.boxes[existing].parent_kind != self.boxes[parent].kind;
                self.adopt(parent, existing);
                self.boxes.announce_floats(existing);
                let had_first_line =
                    core::mem::replace(&mut self.boxes[existing].has_first_line, has_first_line);
                if (had_first_line || has_first_line)
                    && (self.boxes.styles_first != [false; 2] || self.boxes.had_styles_first)
                {
                    self.build_children(existing);
                    self.boxes.mark_contents(existing);
                }
                let it = &self.boxes[existing];
                if is_in_other_kind
                    || it.changes_mode != (it.mode != self.boxes[parent].mode)
                    || it.tag == name!("legend")
                {
                    self.update_box_style(existing);
                    self.boxes[existing].cache.clear();
                }
                return existing;
            }
            self.doomed.push(existing);
            self.boxes[existing].node = 0;
            self.boxes[existing].parent = 0;
        }
        self.tree.prefetch_after(id);
        let style = if parent == VIEWPORT {
            self.used_style(id, style)
        } else {
            Rc::clone(style)
        };
        let new = self.boxes.create(kind, id, style);
        self.tree[id].layout_box = new;
        self.adopt(parent, new);
        self.boxes[new].has_first_line = has_first_line;
        self.update_box_style(new);
        self.build_children(new);
        new
    }

    /// After `style` has changed in a way that layout sees.
    pub(crate) fn update_box_style(&mut self, id: BoxId) {
        self.boxes.note_new_part(id);
        let (node, style) = (self.boxes[id].node, Rc::clone(&self.boxes[id].style));
        let tag = self.tree.html_tag(node);
        let mut overflow = [style.layout.overflow_x, style.layout.overflow_y];
        if (tag == name!("body") || self.tree[node].parent == DOCUMENT)
            && node == self.overflow_source()
            || matches!(self.boxes[id].kind, Kind::Row | Kind::RowGroup)
        {
            overflow = [Overflow::Visible; 2];
        }
        let scrollbar_size = match overflow
            .iter()
            .any(|it| matches!(it, Overflow::Scroll | Overflow::Auto))
            || !style.layout.scrollbar_gutter.is_empty()
        {
            true => self.scrollbar_size(node, &style),
            false => 0.0,
        };
        let element = self.tree.element(node);
        let natural_ratio =
            element.and_then(|it| match (it.replaced, self.boxes[id].kind == Kind::Svg) {
                (Some(replaced), _) => replaced.viewed(&style).0.ratio,
                (None, false) => None,
                (None, true) => match self.natural_size_of_svg(node) {
                    [Some(width), Some(height)] if width > 0.0 && height > 0.0 => {
                        Some(width / height)
                    }
                    _ => crate::svg::ratio(it),
                },
            });
        let (is_root, parent) = (self.tree.is_root(node), self.boxes[id].parent);
        let is_math_root = element.is_some_and(|it| it.tag == name!("math"));
        let is_legend =
            tag == name!("legend") && self.rendered_legend(self.boxes[parent].node) == Some(node);
        self.boxes[id].is_foreign_object = self.boxes[parent].kind == Kind::Svg;
        let is_host_of_controls =
            is_name!(tag, "input" | "textarea" | "select" | "meter" | "progress")
                || element.is_some_and(|it| matches!(it.pseudo, Pseudo::Part(_)));
        let (outer_mode, is_in_cell) = (
            self.boxes[parent].mode,
            self.boxes[parent].is_cell()
                || matches!(self.boxes[parent].kind, Kind::Flex | Kind::Grid),
        );
        let is_quirky = self.environment.quirks == Quirks::All && !style.is_out_of_flow();
        let fills_parent = is_quirky
            && (is_root
                || node == self.tree.body()
                    && !style.is_floating()
                    && !style.display().is_inline_level());
        let it = &mut self.boxes[id];
        it.mode = if matches!(it.kind, Kind::Row | Kind::RowGroup | Kind::Column) {
            outer_mode
        } else {
            style.text.writing_mode
        };
        it.changes_mode = it.mode != outer_mode;
        it.cache.unsettle();
        let ratio = style.layout.aspect_ratio;
        let is_natural = (ratio.auto || ratio.value().is_none())
            && it.is_replaced()
            && !style
                .contain()
                .intersects(Contain::SIZE | Contain::INLINE_SIZE);
        it.ratio = natural_ratio
            .filter(|_| is_natural)
            .or_else(|| ratio.value());
        (it.tag, it.uses_parent) = (
            tag,
            crate::layout::uses_parent(&style).map(|uses| uses || it.is_orthogonal()),
        );
        it.passes_height = is_quirky
            && matches!(it.kind, Kind::Block | Kind::Columns)
            && style.display() != Display::TableCell
            && !is_in_cell
            && !is_host_of_controls;
        it.fills_parent = fills_parent;
        let stable = style
            .layout
            .scrollbar_gutter
            .contains(ScrollbarGutter::STABLE);
        for axis in 0..2 {
            let stable = stable && axis == it.block_axis();
            it.scrollbars[axis] = match overflow[axis] {
                _ if it.is_replaced() => false,
                Overflow::Scroll => true,
                Overflow::Auto => it.scrollbars[axis] || stable,
                Overflow::Hidden => stable,
                _ => false,
            };
        }
        (it.overflow, it.scrollbar_size) = (overflow, scrollbar_size);
        it.shrinks_to_fit = it.kind == Kind::Table
            || is_legend
            || style.display().is_math() && !is_math_root
            || is_name!(
                tag,
                "button" | "input" | "select" | "textarea" | "meter" | "progress"
            );
        it.joins_formatting_context = it.kind == Kind::Block
            && matches!(
                style.display(),
                Display::Block | Display::ListItem | Display::BlockRuby
            )
            && !it.shrinks_to_fit
            && !is_root
            && !it.changes_mode
            && tag != name!("fieldset")
            && tag != Name::NONE
            && !it.scrolls()
            && !style.is_floating()
            && !style.is_out_of_flow()
            && style.layout.align_content == Align::NORMAL
            && !style.contain().intersects(Contain::LAYOUT | Contain::PAINT)
            && !style.queried_axes().contains(&true);
        it.is_ordinary = matches!(it.kind, Kind::Block | Kind::Flex | Kind::Grid)
            && it.ratio.is_none()
            && it.mode == WritingMode::HorizontalTb
            && !(it.shrinks_to_fit
                || it.changes_mode
                || it.fills_parent
                || it.passes_height
                || is_host_of_controls
                || style.look.is_checkable())
            && !overflow.contains(&Overflow::Auto)
            && it.scrollbars == [false; 2];
        self.boxes.announce_floats(id);
        let it = &mut self.boxes[id];
        if it.anchored.is_some() && !self.anchored.contains_key(&node) {
            it.anchored = None;
        }
        if !it.is_cell() {
            it.collapsed = None;
        }
    }

    /// The element whose `overflow` applies to the viewport.
    pub(crate) fn overflow_source(&self) -> NodeId {
        let (root, body) = (self.tree.root_element(), self.tree.body());
        let is_visible = |id| {
            (self.tree.style(id)).is_none_or(|it| {
                (it.layout.overflow_x, it.layout.overflow_y)
                    == (Overflow::Visible, Overflow::Visible)
            })
        };
        if is_visible(root) && !is_visible(body) && self.propagates_from_body() {
            body
        } else {
            root
        }
    }

    pub(crate) fn propagates_from_body(&self) -> bool {
        let is_open = |it| {
            self.tree.style(it).is_some_and(|it| {
                it.contain().is_empty()
                    && !matches!(it.display(), Display::None | Display::Contents)
            })
        };
        is_open(self.tree.root_element()) && is_open(self.tree.body())
    }

    /// The root has the writing mode of the body.
    pub(crate) fn used_style(&self, id: NodeId, style: &Rc<Style>) -> Rc<Style> {
        let body = (self.tree.html_tag(id) == name!("html") && self.tree.is_root(id))
            .then(|| self.tree.style(self.tree.body()))
            .flatten();
        let propagates =
            |it: &&Rc<Style>| flow_of(it) != flow_of(style) && self.propagates_from_body();
        let mut used = Rc::clone(style);
        if let Some(body) = body.filter(propagates) {
            [Id::WritingMode, Id::Direction, Id::TextOrientation]
                .into_iter()
                .for_each(|it| Rc::make_mut(&mut used).groups.set(&body.get(it)));
        }
        used
    }

    fn update_viewport_box(&mut self) {
        let source = self.overflow_source();
        let Some(style) = self.tree.style(source).cloned() else {
            return;
        };
        let overflow = [style.layout.overflow_x, style.layout.overflow_y].map(|it| match it {
            _ if self.environment.cannot_scroll => Overflow::Hidden,
            Overflow::Visible => Overflow::Auto,
            Overflow::Clip => Overflow::Hidden,
            it => it,
        });
        let root = self.tree.root_element();
        let used = self.tree.style(root).map(|it| self.used_style(root, it));
        if let (Some(own), Some(used)) = (self.own_box(root), &used)
            && flow_of(&self.boxes[own].style) != flow_of(used)
        {
            self.detach_box(root);
            self.mark_rebuild(DOCUMENT);
        }
        let root_style = used.as_ref().unwrap_or(&style);
        let scrollbar_size = self.scrollbar_size(root, root_style);
        let (mut anonymous, gutter) = (
            self.anonymous_style(root_style, Display::FlowRoot),
            root_style.layout.scrollbar_gutter,
        );
        Rc::make_mut(&mut anonymous)
            .groups
            .set(&crate::properties::Value::ScrollbarGutter(gutter));
        let viewport = &mut self.boxes[VIEWPORT];
        let old = core::mem::replace(&mut viewport.style, anonymous);
        let mode = viewport.style.text.writing_mode;
        if (
            viewport.overflow,
            viewport.scrollbar_size,
            old.layout.scrollbar_gutter,
            old.is_rtl(),
            viewport.mode,
        ) != (
            overflow,
            scrollbar_size,
            gutter,
            viewport.style.is_rtl(),
            mode,
        ) {
            (viewport.overflow, viewport.scrollbar_size, viewport.mode) =
                (overflow, scrollbar_size, mode);
            viewport.scrollbars = overflow.map(|it| it == Overflow::Scroll);
            viewport.scrollbars[viewport.block_axis()] |= gutter.contains(ScrollbarGutter::STABLE);
            viewport.cache.clear();
            for id in [root, self.tree.body()] {
                if let Some(own) = self.own_box(id) {
                    self.update_box_style(own);
                    self.boxes.mark_layout(own);
                }
            }
        }
    }

    pub(crate) fn rebuild_boxes(&mut self) {
        self.boxes.tell_bereaved();
        let had_annotations = self.boxes.has_annotations;
        self.boxes.are_being_built = true;
        self.boxes.had_styles_first = self.boxes.styles_first != [false; 2];
        self.boxes.styles_first =
            [Pseudo::FirstLine, Pseudo::FirstLetter].map(|it| self.has_rules_for(it));
        self.update_viewport_box();
        loop {
            if self.boxes.to_rebuild.len() > 32
                || self.tree[DOCUMENT].has(Flags::REBUILD | Flags::REBUILD_BELOW)
            {
                self.announce_rebuilds();
                self.rebuild_below(DOCUMENT);
                continue;
            }
            let mut marked = core::mem::take(&mut self.boxes.to_rebuild);
            marked.retain(|it| self.tree[*it].has(Flags::REBUILD));
            if marked.is_empty() {
                break;
            }
            marked.order_by_cached_key(|it| self.tree.flat_ancestors(*it).count());
            marked.into_iter().for_each(|it| self.rebuild_below(it));
        }
        (
            self.boxes.anonymous_styles,
            self.boxes.are_being_built,
            self.boxes.spare_builder,
        ) = Default::default();
        if self.boxes.has_annotations != had_annotations {
            self.boxes
                .boxes
                .iter_mut()
                .for_each(|it| it.cache.forget_layout());
        }
        for formula in core::mem::take(&mut self.changed_formulas) {
            if let Some(own) = self.own_box(formula) {
                self.forget_math_layout(own);
                self.boxes.mark_layout(own);
            }
        }
    }

    fn rebuild_below(&mut self, id: NodeId) {
        let (flags, own) = (self.tree[id].flags.get(), self.own_box(id));
        if flags.contains(Flags::REBUILD) && own.is_none() {
            self.tree[id].unset(Flags::REBUILD);
            if self
                .tree
                .style(id)
                .is_some_and(|it| it.display() != Display::None)
                && self.insert_box(id).is_none()
            {
                self.mark_parent_rebuild(id);
            }
        }
        if self.skips_contents(id) {
            return;
        }
        self.tree[id].unset(Flags::REBUILD | Flags::REBUILD_BELOW);
        if let Some(own) = own.filter(|_| flags.contains(Flags::REBUILD)) {
            self.build_children(own);
            self.boxes.mark_contents(own);
        }
        if flags.contains(Flags::REBUILD_BELOW) {
            let backdrop = self.tree.element(id).map(|it| it.generated[BACKDROP]);
            let dirty: Vec<_> = (self
                .rendered_children(id)
                .chain(backdrop)
                .chain(self.carousels.parts_of(id)))
            .filter(|child| self.tree[*child].has(Flags::REBUILD | Flags::REBUILD_BELOW))
            .collect();
            dirty
                .into_iter()
                .for_each(|child| self.rebuild_below(child));
        }
    }

    pub(crate) fn rendered_legend(&self, fieldset: NodeId) -> Option<NodeId> {
        let is_in_flow = |it: &Rc<Style>| {
            it.computed_sides.0 == Float::None
                && !it.is_out_of_flow()
                && !matches!(it.display(), Display::None | Display::Contents)
        };
        let children = (self.tree.html_tag(fieldset) == name!("fieldset"))
            .then(|| self.tree.element_children(fieldset))?;
        let is_slot = |it: NodeId| self.tree.html_tag(it) == name!("slot");
        let children = children.flat_map(|it| {
            if is_slot(it) {
                self.rendered_children(it).collect()
            } else {
                vec![it]
            }
        });
        { children }.find(|it| {
            self.tree.html_tag(*it) == name!("legend")
                && self.tree.style(*it).is_some_and(is_in_flow)
        })
    }

    pub(crate) fn is_legend(&self, id: BoxId) -> bool {
        let parent = &self.boxes[self.boxes[id].parent];
        parent.has_legend && parent.children.first() == Some(&id)
    }

    fn orphan_children(&mut self, id: BoxId) {
        let marker = core::mem::take(&mut self.boxes[id].outside_marker);
        let children = core::mem::take(&mut self.boxes[id].children);
        for child in children.into_iter().chain((marker != 0).then_some(marker)) {
            if self.boxes[child].node == 0 {
                self.orphan_children(child);
            }
            self.boxes[child].parent = 0;
            self.doomed.push(child);
        }
    }

    fn build_children(&mut self, id: BoxId) {
        crate::recovery::need_stack();
        let it = &self.boxes[id];
        let (node, kind, style) = (it.node, it.kind, Rc::clone(&it.style));
        self.boxes[id].is_skipped = self.tree[node].has(Flags::SKIPPED);
        if self.skips_contents(node) {
            self.tree[node].set(Flags::REBUILD | Flags::REBUILD_BELOW);
            return self.boxes.park(id, false);
        }
        self.tree[node].unset(Flags::REBUILD);
        let mark = self.doomed.len();
        (
            self.boxes[id].has_floats,
            self.boxes[id].has_anonymous_children,
        ) = (false, false);
        self.orphan_children(id);
        if !self.boxes[id].is_replaced() && self.boxes[id].depth < MAX_DEPTH {
            let mut children = Gathered::new();
            self.gather(node, &style, &mut children);
            if id == VIEWPORT {
                for top in &self.top_layer {
                    let has_no_contents = |id: NodeId| {
                        let style = self.tree.style(id);
                        style.is_some_and(|it| {
                            it.display() == Display::TableColumn
                                || self.kind_of(id, it) == Some(Kind::Replaced)
                        })
                    };
                    let is_hidden = !self.tree[*top].has(Flags::TOP_LAYER)
                        || self.is_in_skipped_contents(*top)
                        || self.tree.flat_ancestors(*top).any(has_no_contents);
                    let Some(element) = self.tree.element(*top).filter(|_| !is_hidden) else {
                        continue;
                    };
                    children.extend(
                        [element.generated[BACKDROP], *top]
                            .into_iter()
                            .filter(|it| !self.is_transition_root(*it))
                            .filter_map(|it| {
                                let style = self
                                    .tree
                                    .style(it)
                                    .filter(|it| it.display() != Display::None)?;
                                Some(Child::Element(it, Rc::clone(style)))
                            }),
                    );
                }
                let transitions = self
                    .transition_roots()
                    .filter_map(|it| Some((it, self.tree.style(it)?)));
                children.extend(
                    transitions
                        .filter(|it| it.1.display() != Display::None)
                        .map(|it| Child::Element(it.0, Rc::clone(it.1))),
                );
            }
            self.number_list_items(node, &children);
            let legend = self.rendered_legend(node).and_then(|legend| {
                children
                    .iter()
                    .position(|it| matches!(it, Child::Element(node, _) if *node == legend))
            });
            let legend = legend.map(|it| children.remove(it));
            let is_cell = style.display() == Display::TableCell;
            let has_row = (kind == Kind::Math || is_cell)
                && self
                    .tree
                    .element(node)
                    .is_some_and(crate::math::has_anonymous_row);
            if kind == Kind::Math || has_row {
                children.retain(|it| matches!(it, Child::Element(id, _) if self.tree.element(*id).is_some_and(|it| it.namespace == Namespace::MathMl)));
                self.math_changed(node);
            }
            if has_row {
                let row = self.anonymous(id, Kind::Math, Display::BlockMath);
                self.boxes[row].shrinks_to_fit = true;
                self.fill(row, Kind::Math, &children);
                self.boxes[id].children.push(row);
            } else {
                self.fill(id, kind, &children);
            }
            if core::mem::replace(&mut self.boxes[id].has_legend, legend.is_some()) {
                self.boxes[id].legend_excess = 0.0;
            }
            if let Some(Child::Element(node, style)) = legend {
                let legend = self.box_for(
                    id,
                    node,
                    self.kind_of(node, &style).unwrap_or(Kind::Block),
                    &style,
                );
                self.boxes[id].children.insert(0, legend);
            }
        }
        if kind == Kind::Svg && self.has_foreign_objects {
            for child in self.foreign_objects_in(node) {
                if let Some(style) = self
                    .tree
                    .style(child)
                    .filter(|it| it.display() != Display::None)
                    .cloned()
                {
                    let child = self.box_for(id, child, Kind::Block, &style);
                    self.boxes[id].children.push(child);
                }
            }
        }
        if kind == Kind::Replaced
            && self
                .tree
                .element(node)
                .is_some_and(|it| it.shadow_root != 0 && is_name!(it.html_tag(), "audio" | "video"))
        {
            let overlay = self
                .tree
                .flat_children(node)
                .next()
                .and_then(|it| Some((it, Rc::clone(self.tree.style(it)?))));
            if let Some((overlay, style)) = overlay.filter(|it| it.1.display() != Display::None) {
                let child = self.box_for(
                    id,
                    overlay,
                    self.kind_of(overlay, &style).unwrap_or(Kind::Block),
                    &style,
                );
                self.boxes[id].children.push(child);
            }
        }
        for doomed in self.doomed.split_off(mark) {
            if self.boxes[doomed].parent == 0 && self.boxes[doomed].kind != Kind::Free {
                self.destroy_box(doomed);
            }
        }
    }

    fn fill(&mut self, id: BoxId, kind: Kind, children: &[Child]) {
        match kind {
            Kind::Table | Kind::RowGroup | Kind::Row => {
                return self.fill_table_part(id, kind, children);
            }
            Kind::Column => {
                for child in children {
                    if let Child::Element(node, style) = child
                        && style.display() == Display::TableColumn
                    {
                        let column = self.box_for(id, *node, kind, style);
                        self.boxes[id].children.push(column);
                    }
                }
                return;
            }
            Kind::Columns => {
                let flow = self.anonymous(id, Kind::Block, Display::FlowRoot);
                self.fill(flow, Kind::Block, children);
                return self.boxes[id].children.push(flow);
            }
            _ => {}
        }
        self.boxes[id].splits_layers = false;
        let mut siblings = Siblings {
            parent: id,
            boxes: Children::new(),
            lines: None,
            open: Vec::new(),
            is_before_first_line: kind == Kind::Block,
            is_before_first_letter: kind == Kind::Block && self.boxes.styles_first[1],
        };
        self.add_children(&mut siblings, children);
        let node = self.boxes[id].node;
        let is_beside_lines = |it: &BoxId| {
            self.boxes[*it].style.is_out_of_flow() || self.boxes[*it].style.is_floating()
        };
        let has_empty_line = kind == Kind::Block
            && siblings.boxes.iter().all(is_beside_lines)
            && self.has_line_if_empty(node);
        if has_empty_line {
            self.lines(&mut siblings).force_line();
        }
        self.end_lines(&mut siblings);
        if matches!(kind, Kind::Flex | Kind::Grid) {
            let order = |it: &BoxId| match self.boxes[*it].style.is_out_of_flow() {
                true => 0,
                false => self.boxes[*it].style.layout.order,
            };
            if !siblings.boxes.iter().is_sorted_by_key(order) {
                siblings.boxes.order_by_key(order);
            }
        }
        self.boxes[id].children = siblings.boxes;
    }

    pub(crate) fn has_line_if_empty(&self, id: NodeId) -> bool {
        let is_editable = |id| self.tree.style(id).is_some_and(|style| style.is_editable());
        self.tree
            .element(id)
            .is_some_and(|it| it.pseudo == Pseudo::Part(name!("-internal-editor")))
            || is_editable(id) && !is_editable(self.tree.flat_parent(id))
    }

    fn lines<'a>(&mut self, siblings: &'a mut Siblings) -> &'a mut Builder {
        siblings.lines.get_or_insert_with(|| {
            let id = self.anonymous(siblings.parent, Kind::Lines, Display::Block);
            let mut builder = Builder::new(
                id,
                &Rc::clone(&self.boxes[siblings.parent].style),
                self.boxes.spare_builder.take(),
            );
            for (node, style) in &siblings.open {
                builder.open(*node, style, false);
            }
            builder
        })
    }

    fn end_lines(&mut self, siblings: &mut Siblings) {
        let Some(mut builder) = siblings.lines.take() else {
            return;
        };
        for (node, style) in siblings.open.iter().rev() {
            builder.close(*node, style, false);
        }
        let id = builder.id;
        let is_first = builder.has_content() && core::mem::take(&mut siblings.is_before_first_line);
        let first_line = (is_first && self.boxes.styles_first[0])
            .then(|| self.first_line_style(siblings.parent))
            .flatten();
        let inline = builder.finish(self, first_line);
        self.boxes.spare_builder = Some(builder);
        self.boxes.has_annotations |= inline.has_ruby
            || inline
                .items
                .iter()
                .any(|it| it.style.other_if_set(Id::TextEmphasisStyle).is_some());
        self.boxes.has_pinned_styles |= inline.first_line.is_some()
            || inline
                .items
                .iter()
                .take(4)
                .any(|it| it.has_own_style || it.node == 0);
        for node in inline.nodes() {
            if self.tree[node].layout_box == 0 || self.tree[node].text().is_some() {
                self.tree[node].layout_box = id;
            }
        }
        self.boxes[id].uses_parent[1] =
            !self.boxes[id].children.is_empty() || inline.has_positioned_elements();
        let it = &mut self.boxes[id];
        if let Some(widths) = inline.widths_of_label(&it.style) {
            it.cache.note_widths(widths);
        }
        it.inline = Some(inline);
        siblings.boxes.push(id);
    }

    fn first_style_under(
        &self,
        id: NodeId,
        pseudo: Pseudo,
        parent: &Rc<Style>,
    ) -> Option<Rc<Style>> {
        self.pseudo_style_under(id, pseudo, Default::default(), parent)
            .inspect(|_| _ = self.boxes.styled_first.borrow_mut().insert(id))
    }

    /// Other rules may apply to it.
    pub(crate) fn update_first_line(&mut self, id: NodeId) {
        let Some(style) = self.own_box(id).map(|it| Rc::clone(&self.boxes[it].style)) else {
            return;
        };
        if self.boxes.styled_first.get_mut().remove(&id)
            || [Pseudo::FirstLine, Pseudo::FirstLetter]
                .into_iter()
                .any(|it| {
                    self.pseudo_style_under(id, it, Default::default(), &style)
                        .is_some()
                })
        {
            self.mark_rebuild(id);
        }
    }

    fn first_line_style(&self, id: BoxId) -> Option<Rc<Style>> {
        let it = &self.boxes[id];
        let blocks: Vec<_> = core::iter::successors(Some(it), |it| {
            it.has_first_line.then(|| &self.boxes[it.parent])
        })
        .collect();
        let nested = |outer: Option<Rc<Style>>, block: &&LayoutBox| {
            self.first_style_under(
                block.node,
                Pseudo::FirstLine,
                outer.as_ref().unwrap_or(&it.style),
            )
            .or(outer)
        };
        let from = blocks.iter().rev().fold(None, nested)?;
        let mut style = Style {
            customs: from.customs.clone(),
            font_id: from.font_id,
            metrics: from.metrics,
            ..(*it.style).clone()
        };
        (style.groups.font, style.groups.ink) = (Rc::clone(&from.font), Rc::clone(&from.ink));
        for id in [
            Id::TextTransform,
            Id::LetterSpacing,
            Id::WordSpacing,
            Id::RubyPosition,
        ] {
            style.groups.set(&from.get(id));
        }
        (style.groups.paint, style.groups.background) =
            (Rc::clone(&from.paint), Rc::clone(&from.background));
        Some(Rc::new(style))
    }

    /// Returns how much of the text it has taken.
    fn add_first_letter(
        &mut self,
        siblings: &mut Siblings,
        id: NodeId,
        style: &Rc<Style>,
    ) -> usize {
        use crate::characters::{is_connector, is_opening_or_dash, is_punctuation};
        let data = crate::values::text(self.tree[id].text().unwrap_or_default());
        let Some(start) = data.char_indices().find(|it| {
            !it.1.is_whitespace()
                || it.1 == '\n' && style.text.collapse != WhiteSpaceCollapse::Collapse
        }) else {
            return 0;
        };
        siblings.is_before_first_letter = false;
        let is_space = |it: char| {
            matches!(
                it,
                ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{202f}' | '\u{205f}'
            )
        };
        let next = |from: usize| {
            let some = &data[from..data.floor_char_boundary(from + 64)];
            from + self
                .shape_plain(some, style)
                .clusters()
                .iter()
                .map(|it| it.start as usize)
                .filter(|it| *it > 0)
                .min()
                .unwrap_or(some.len())
        };
        let mut letter = start.0;
        while data[letter..]
            .starts_with(|it| is_punctuation(it) || is_connector(it) || is_opening_or_dash(it))
            || letter > start.0 && data[letter..].starts_with(is_space)
        {
            letter = next(letter);
        }
        if data[letter..].starts_with(char::is_whitespace)
            || letter == data.len() && data[start.0..].is_empty()
        {
            return 0;
        }
        let mut end = next(letter);
        loop {
            let rest =
                data[end..].trim_start_matches(|it| is_space(it) && !matches!(it, ' ' | '\u{a0}'));
            if !rest.starts_with(|it| {
                (is_punctuation(it) || is_connector(it)) && !is_opening_or_dash(it)
            }) {
                break;
            }
            end = next(data.len() - rest.len());
        }
        let blocks = core::iter::successors(Some(siblings.parent), |it| {
            Some(&self.boxes[*it])
                .filter(|it| it.has_first_line)
                .map(|it| it.parent)
        });
        let first_line = self.boxes.styles_first[0]
            .then(|| self.first_line_style(siblings.parent))
            .flatten();
        let parent = first_line
            .as_ref()
            .filter(|_| siblings.open.is_empty())
            .unwrap_or(style);
        let of =
            |it: BoxId| self.first_style_under(self.boxes[it].node, Pseudo::FirstLetter, parent);
        let Some(mut own) = { blocks }.find_map(of) else {
            return 0;
        };
        let letter = data.as_bytes()[..end].to_vec();
        let groups = &mut Rc::make_mut(&mut own).groups;
        groups.set(&Value::Position(PositionKind::Static));
        for id in [
            Id::Width,
            Id::Height,
            Id::MinWidth,
            Id::MinHeight,
            Id::MaxWidth,
            Id::MaxHeight,
            Id::OverflowX,
            Id::OverflowY,
            Id::Clear,
        ] {
            groups.set(&self.styles.initial.get(id));
        }
        let is_initial = own.rare.initial_letter.0.is_some();
        if !own.is_floating() && !is_initial {
            Rc::make_mut(&mut own)
                .groups
                .set(&Value::Display(DisplayValue(Display::Inline)));
            self.lines(siblings).first_letter(id, &letter, &own);
            return end;
        }
        if is_initial {
            self.size_initial_letter(Rc::make_mut(&mut own), &self.boxes[siblings.parent].style);
        }
        let lines = self.lines(siblings).id;
        let block = self.anonymous(lines, Kind::Block, Display::Block);
        self.boxes[block].style = Rc::clone(&own);
        self.boxes.announce_floats(block);
        let inner = self.anonymous(block, Kind::Lines, Display::Block);
        let mut builder = Builder::new(inner, &own, None);
        builder.text(id, &letter, &own);
        builder.pin_styles();
        self.boxes[inner].inline = Some(builder.finish(self, None));
        self.boxes.has_pinned_styles = true;
        self.boxes[block].children.push(inner);
        self.boxes[lines].children.push(block);
        self.lines(siblings).embed(block, 0, &own);
        end
    }

    fn size_initial_letter(&self, style: &mut Style, paragraph: &Style) {
        let Some(letter) = style.rare.initial_letter.0 else {
            return;
        };
        let cap_height =
            paragraph.line_height() * (letter.size - 1.0) + paragraph.metrics.cap_height;
        let mut size = (cap_height * 100.0
            / self.fonts.metrics(style.font_id, 100.0).cap_height.max(1.0))
        .floor()
        .min(10_000.0)
            + 1.0;
        while size > 1.0 && self.fonts.metrics(style.font_id, size).cap_height > cap_height {
            size -= 1.0;
        }
        style.groups.set(&Value::FontSize(FontSize(size)));
        style.metrics = self.fonts.metrics(style.font_id, size);
        style
            .groups
            .set(&Value::TextIndent(self.styles.initial.text.indent.clone()));
        style.groups.set(&Value::TextWrapMode(TextWrapMode::Nowrap));
        style
            .groups
            .set(&Value::Display(DisplayValue(Display::Block)));
        if !style.is_floating() {
            style.groups.set(&Value::Float(if paragraph.is_rtl() {
                Float::Right
            } else {
                Float::Left
            }));
        }
    }

    fn add_children(&mut self, siblings: &mut Siblings, children: &[Child]) {
        let parent = siblings.parent;
        let is_flow = self.boxes[parent].kind == Kind::Block;
        let mut index = 0;
        while let Some(child) = children.get(index) {
            index += 1;
            let (id, style) = match child {
                Child::Text(id, style) => {
                    let text = self.tree[*id].text().unwrap_or_default();
                    let is_space = match is_flow {
                        true => is_collapsible_space(text, style),
                        false => text.iter().all(u8::is_ascii_whitespace),
                    };
                    if siblings.lines.is_some() || !is_space {
                        self.lines(siblings);
                        let taken = if siblings.is_before_first_letter {
                            self.add_first_letter(siblings, *id, style)
                        } else {
                            0
                        };
                        if let (Some(lines), Some(text)) =
                            (&mut siblings.lines, self.tree[*id].text())
                        {
                            lines.text_from(*id, &text[taken..], taken, style);
                        }
                    }
                    continue;
                }
                Child::Element(id, style) => (*id, style),
            };
            let Some(kind) = self.kind_of(id, style) else {
                self.add_inline(siblings, id, style);
                continue;
            };
            let is_marker = self
                .tree
                .element(id)
                .is_some_and(|it| it.pseudo == Pseudo::Marker);
            let is_table_part = matches!(kind, Kind::Row | Kind::RowGroup | Kind::Column)
                || matches!(style.display(), Display::TableCell | Display::TableCaption);
            if is_marker && style.display() != Display::Inline {
                self.boxes[parent].outside_marker = self.box_for(parent, id, kind, style);
            } else if is_table_part {
                let belongs = |child: &&Child| match child {
                    Child::Text(id, _) => self.tree[*id]
                        .text()
                        .unwrap_or_default()
                        .trim_ascii()
                        .is_empty(),
                    Child::Element(_, style) => {
                        style.display() as u8 >= Display::TableRowGroup as u8
                    }
                };
                let start = index - 1;
                index += children[index..].iter().take_while(belongs).count();
                if siblings.open.is_empty() {
                    self.end_lines(siblings);
                }
                let around = if siblings.open.is_empty() {
                    parent
                } else {
                    self.lines(siblings).id
                };
                let table = self.anonymous(
                    around,
                    Kind::Table,
                    if around == parent {
                        Display::Table
                    } else {
                        Display::InlineTable
                    },
                );
                if let Some((_, style)) = siblings.open.last() {
                    self.boxes[table].style = self.anonymous_style(style, Display::InlineTable);
                }
                self.boxes[table].shrinks_to_fit = true;
                self.fill_table_part(table, Kind::Table, &children[start..index]);
                if around == parent {
                    siblings.boxes.push(table);
                } else {
                    self.boxes[around].children.push(table);
                    let style = Rc::clone(&self.boxes[table].style);
                    self.lines(siblings).embed(table, 0, &style);
                }
            } else if is_flow
                && (style.display().is_inline_level()
                    || (style.is_floating() || style.is_out_of_flow())
                        && (siblings.lines.is_some() || !siblings.open.is_empty()))
            {
                let lines = self.lines(siblings).id;
                let child = self.box_for(lines, id, kind, style);
                self.boxes[lines].children.push(child);
                match style.display() {
                    Display::RubyText => self.lines(siblings).annotate(child, id, style),
                    _ => self.lines(siblings).embed(child, id, style),
                }
                siblings.is_before_first_letter &= is_marker || !style.display().is_inline_level();
            } else {
                self.end_lines(siblings);
                let is_in_flow = !style.is_floating() && !style.is_out_of_flow();
                let has_first_line = is_in_flow
                    && core::mem::take(&mut siblings.is_before_first_line)
                    && kind == Kind::Block;
                siblings.is_before_first_letter &= !is_in_flow;
                for (node, _) in siblings
                    .open
                    .iter()
                    .filter(|it| crate::inline::is_layer(&it.1))
                {
                    self.boxes.split.insert(*node);
                    self.boxes[parent].splits_layers = true;
                }
                let child = self.box_in_flow(parent, id, kind, style, has_first_line);
                self.boxes[child].is_in_inline = is_in_flow && !siblings.open.is_empty();
                siblings.boxes.push(child);
            }
        }
    }

    fn add_inline(&mut self, siblings: &mut Siblings, id: NodeId, style: &Rc<Style>) {
        if let Some(own) = self.own_box(id) {
            self.boxes[own].node = 0;
        }
        self.tree[id].layout_box = 0;
        self.tree[id].unset(Flags::REBUILD);
        if !self.boxes.split.is_empty() {
            self.boxes.split.remove(&id);
        }
        let tag = self.tree.html_tag(id);
        if tag == name!("br") {
            siblings.is_before_first_letter = false;
            return self.lines(siblings).line_break(id, style);
        }
        if tag == name!("wbr") {
            return self.lines(siblings).text(id, "\u{200b}".as_bytes(), style);
        }
        if siblings.open.len() >= usize::from(MAX_DEPTH) {
            return;
        }
        self.lines(siblings).open(id, style, true);
        siblings.open.push((id, Rc::clone(style)));
        let mut children = Gathered::new();
        self.gather(id, style, &mut children);
        self.number_list_items(id, &children);
        let is_marker = self
            .tree
            .element(id)
            .is_some_and(|it| it.pseudo == Pseudo::Marker);
        let postponed = is_marker && core::mem::take(&mut siblings.is_before_first_letter);
        self.add_children(siblings, &children);
        siblings.is_before_first_letter |= postponed;
        self.lines(siblings).close(id, style, true);
        siblings.open.pop();
    }

    /// Wraps what does not belong in a table, a row group or a row in the anonymous boxes that do.
    fn fill_table_part(&mut self, id: BoxId, kind: Kind, children: &[Child]) {
        let belongs = |child: &Child| match child {
            Child::Text(..) => false,
            Child::Element(_, style) => match (kind, style.display()) {
                _ if style.is_out_of_flow() => true,
                (
                    Kind::Table,
                    Display::TableCaption | Display::TableColumn | Display::TableColumnGroup,
                ) => true,
                (Kind::Table, display) => display.is_row_group(),
                (Kind::RowGroup, display) => display == Display::TableRow,
                (_, display) => display == Display::TableCell,
            },
        };
        let mut rest = children;
        while let Some(first) = rest.first() {
            let (child, count) = match first {
                Child::Text(text, _)
                    if self.tree[*text]
                        .text()
                        .unwrap_or_default()
                        .trim_ascii()
                        .is_empty() =>
                {
                    (0, 1)
                }
                Child::Element(node, style) if belongs(first) => {
                    let kind = self.kind_of(*node, style).unwrap_or(Kind::Block);
                    (self.box_for(id, *node, kind, style), 1)
                }
                _ => {
                    let count = rest.iter().take_while(|child| !belongs(child)).count();
                    let (inner, display) = match kind {
                        Kind::Table => (Kind::RowGroup, Display::TableRowGroup),
                        Kind::RowGroup => (Kind::Row, Display::TableRow),
                        _ => (Kind::Block, Display::TableCell),
                    };
                    let wrapper = self.anonymous(id, inner, display);
                    let mut after_text = false;
                    let is_rendered = |child: &&Child| match child {
                        Child::Text(text, style) if self.boxes[id].node != 0 && !after_text => {
                            after_text = !is_collapsible_space(
                                self.tree[*text].text().unwrap_or_default(),
                                style,
                            );
                            after_text
                        }
                        child => {
                            after_text = matches!(child, Child::Text(..));
                            true
                        }
                    };
                    let rendered: Vec<Child> =
                        rest[..count].iter().filter(is_rendered).cloned().collect();
                    self.fill(wrapper, inner, &rendered);
                    (wrapper, count)
                }
            };
            if child != 0 {
                self.boxes[id].children.push(child);
            }
            rest = &rest[count..];
        }
    }
}
