//! Computes the styles that are out of date, and marks what depends on them.

use core::hint::{Locality, prefetch_read};
use std::rc::Rc;

use crate::boxes::{BoxId, Kind};
use crate::cascade::{Amendments, RuleList};
use crate::custom::Changed;
use crate::document::Document;
use crate::forecast::{prefetch_shared, prefetch_style};
use crate::name::{Map, Name, Set, name};
use crate::paint::shadow_extent;
use crate::properties::{Id, Style, Value};
use crate::rules::Classes;
use crate::segments::Retouch;
use crate::selector::{Bloom, Pseudo};
use crate::svg_values::SvgPaint;
use crate::theme::Look;
use crate::transform::Transform;
use crate::tree::{
    AFTER, BACKDROP, BEFORE, DOCUMENT, Data, Element, Flags, MARKER, Namespace, NodeId, State,
};
use crate::types::*;
use crate::values::{Deps, Lp};

const MAX_DEPTH: usize = 512;

bitflags::bitflags! {
    /// What has changed above an element.
    #[derive(Clone, Copy, PartialEq)]
    pub(crate) struct Change: u8 {
        const REMATCH_ALL = 1;
        const RECASCADE_ALL = 1 << 1;
        const INHERITED = 1 << 2;
        const NOT_INHERITED = 1 << 3;
        const DISPLAY = 1 << 4;
        const BY_ANIMATION = 1 << 5;
        /// The parent is about to get its first box, with what is in it.
        const IN_NEW_BOX = 1 << 6;
    }
}

/// What has become of their parent.
#[derive(Clone, Copy)]
struct Children {
    is_new: bool,
    rematches: bool,
}

struct Traversal {
    bloom: Bloom,
    reparented: Map<(*const Style, *const ()), (Rc<Style>, Rc<Style>)>,
    replaced: Map<(*const Style, *const Style), [Rc<Style>; 3]>,
    amended: Map<(*const Style, *const RuleList), (Rc<Style>, Rc<Style>, Rc<RuleList>)>,
    /// The last ones, by `slot_of`.
    repainted: [Option<Repainted>; 32],
    differences: [Option<(Difference, [Rc<Style>; 2])>; 32],
    /// By `Looks::slot`, once there is one.
    firsts: Vec<Option<First>>,
    styles_first_lines: bool,
    /// The one rule for them applies to all.
    has_plain_markers: bool,
    /// `Tree::marked`, and how many of them have been seen.
    marked: (Vec<NodeId>, usize),
}

/// All that rules can tell of an element that has no attributes but `class`, unless they look at its siblings or descendants.
#[derive(Clone, Copy, PartialEq)]
struct Looks {
    ancestors: Name,
    tag: Name,
    classes: *const Classes,
    state: State,
    scope: NodeId,
}

impl Looks {
    fn slot(&self) -> usize {
        ((self.ancestors.bits() ^ self.tag.bits() ^ self.classes.addr() as u64)
            .wrapping_mul(0x9e37_79b9_7f4a_7c15)
            >> 58) as usize
    }
}

/// The first style of an element that the document has nothing to note of.
struct First {
    looks: Looks,
    rules: Rc<RuleList>,
    parent: Rc<Style>,
    style: Rc<Style>,
    generated_by_rules: Option<u8>,
}

fn is_unremarkable(style: &Style) -> bool {
    style.is_inert()
        && !style
            .deps
            .intersects(Deps::ATTRIBUTES | Deps::SIBLINGS | Deps::CONTAINER | Deps::ANCHOR)
        && !style.is_out_of_flow()
        && !style.scrolls()
        && style.display() != Display::None
        && style.layout.appearance != Appearance::BaseSelect
}

/// What has become of the style of an ordinary element, which at most has to be painted again.
struct Repainted {
    old: Rc<Style>,
    rules: Rc<RuleList>,
    parent: Rc<Style>,
    has_changed_customs: bool,
    new: Rc<Style>,
    below: Change,
    damage: Damage,
}

/// As many references as a style has while the only element that has it is restyled.
const UNSHARED: usize = 6;

fn slot_of(old: &Rc<Style>, other: usize) -> usize {
    (Rc::as_ptr(old).addr() ^ other << 7).wrapping_mul(0x9e37_79b1) >> 20 & 31
}

/// Between two styles, whichever element has them.
#[derive(Clone, Copy, PartialEq)]
struct Difference {
    total: Damage,
    change: Change,
    moves: bool,
    /// `INK` is about nothing but another transform.
    only_turns: bool,
    /// `LAYOUT` is about nothing but its size.
    only_resizes: bool,
    repositions: bool,
    changes_container: bool,
    leaves_or_joins_flow: bool,
    resizes: bool,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq)]
    struct Damage: u16 {
        const PAINT = 1;
        const INK = 1 << 1;
        const LAYOUT = 1 << 2;
        const CONTENTS = 1 << 3;
        const PARENT = 1 << 4;
        const GENERATED = 1 << 5;
        const COUNTERS = 1 << 6;
        /// Which the layout of a table resolves if the borders collapse.
        const BORDER_COLOR = 1 << 7;
        /// With `INK`: what is where does not change.
        const STAYS = 1 << 8;
        /// The background, the shadows and the border of its box.
        const BOX = 1 << 9;
        const OPACITY = 1 << 10;
        const COLOR = 1 << 11;
        const LOOKS = Damage::PAINT.bits() | Damage::BORDER_COLOR.bits() | Damage::BOX.bits() | Damage::OPACITY.bits() | Damage::COLOR.bits();
    }
}

fn damage(id: Id) -> Damage {
    let is_in = |first: Id, last: Id| (first as u16..=last as u16).contains(&(id as u16));
    match id {
        Id::Display
        | Id::Position
        | Id::Float
        | Id::Order
        | Id::ColumnCount
        | Id::ColumnWidth
        | Id::ColumnHeight
        | Id::ColumnSpan
        | Id::LineClamp
        | Id::BoxOrient
        | Id::WebkitBoxOrdinalGroup
        | Id::WritingMode => Damage::PARENT | Damage::CONTENTS | Damage::LAYOUT | Damage::COUNTERS,
        Id::ScrollMarkerGroup => Damage::PARENT | Damage::CONTENTS | Damage::LAYOUT,
        Id::Content | Id::ListStyleType | Id::ListStyleImage | Id::ListStylePosition => {
            Damage::PARENT | Damage::CONTENTS | Damage::GENERATED
        }
        Id::CounterReset | Id::CounterIncrement | Id::CounterSet | Id::Quotes => Damage::COUNTERS,
        Id::Locale => Damage::CONTENTS | Damage::LAYOUT | Damage::COUNTERS,
        Id::UnicodeBidi | Id::TextOverflow => Damage::CONTENTS | Damage::LAYOUT,
        Id::ScrollbarColor
        | Id::ContentVisibility
        | Id::FrameSizing
        | Id::AnchorScope
        | Id::PositionVisibility
        | Id::PositionTryOrder
        | Id::ScrollSnapType
        | Id::ScrollSnapAlign
        | Id::ScrollSnapStop
        | Id::ScrollInitialTarget
        | Id::WebkitBoxDirection
        | Id::WebkitBoxPack => Damage::LAYOUT,
        _ if is_in(Id::ScrollMarginTop, Id::ScrollPaddingLeft) => Damage::LAYOUT,
        Id::Color => Damage::COLOR | Damage::BORDER_COLOR,
        Id::BackgroundColor => Damage::BOX,
        _ if is_in(Id::BackgroundImage, Id::BackgroundBlendMode) => Damage::BOX,
        _ if is_in(Id::BorderTopColor, Id::BorderLeftColor) => Damage::BOX | Damage::BORDER_COLOR,
        Id::BoxShadow
        | Id::OutlineWidth
        | Id::OutlineOffset
        | Id::OutlineStyle
        | Id::TextShadow
        | Id::Filter => Damage::INK | Damage::STAYS,
        Id::ZIndex | Id::ViewTransitionName | Id::BackdropFilter => Damage::INK,
        Id::BorderImageOutset
        | Id::BorderShape
        | Id::OffsetAnchor
        | Id::OffsetDistance
        | Id::OffsetPath
        | Id::OffsetPosition
        | Id::OffsetRotate
        | Id::TransformStyle
        | Id::PerspectiveOrigin
        | Id::WebkitTextStrokeWidth
        | Id::WebkitBoxReflect => Damage::INK,
        Id::FontLanguageOverride
        | Id::FontPalette
        | Id::FontSizeAdjust
        | Id::FontSynthesisSmallCaps
        | Id::FontVariantAlternates
        | Id::FontVariantEastAsian
        | Id::FontVariantEmoji
        | Id::FontVariantPosition
        | Id::HyphenateLimitChars
        | Id::MathDepth
        | Id::MathShift
        | Id::MathStyle
        | Id::TextEmphasisPosition
        | Id::TextEmphasisStyle
        | Id::TextFit
        | Id::ImageOrientation
        | Id::ObjectViewBox
        | Id::TextRendering
        | Id::WebkitFontSmoothing => Damage::CONTENTS | Damage::LAYOUT,
        _ if is_in(Id::FontFamily, Id::UserModify) => Damage::CONTENTS | Damage::LAYOUT,
        _ if is_in(Id::Display, Id::GridColumnEnd) => Damage::LAYOUT,
        _ if is_in(Id::Transform, Id::OverflowClipMargin) => Damage::INK,
        _ if is_in(Id::TransitionProperty, Id::AnimationRangeEnd) => Damage::empty(),
        _ => Damage::PAINT,
    }
}

pub(crate) fn only_repaints(id: Id) -> bool {
    (Damage::LOOKS | Damage::INK | Damage::STAYS).contains(damage(id))
}

pub(crate) fn changes_ink(id: Id) -> bool {
    damage(id).contains(Damage::INK)
}

fn inherited_change(before: &Style, after: &Style) -> Change {
    let mut change = Change::empty();
    before.differences(after, |it| {
        change |= if it.is_inherited() {
            Change::INHERITED
        } else {
            Change::NOT_INHERITED
        }
    });
    change.set(
        Change::INHERITED,
        change.contains(Change::INHERITED)
            || (before.zoom, before.dark, before.metrics, before.font_id)
                != (after.zoom, after.dark, after.metrics, after.font_id),
    );
    change
}

impl Difference {
    const CHANGE_AT: u32 = u16::BITS - Damage::all().bits().leading_zeros();
    const FLAGS_AT: u32 = Difference::CHANGE_AT + u8::BITS - Change::all().bits().leading_zeros();
    const FLAGS: usize = 7;

    fn of(old: &Style, new: &Style) -> Difference {
        const { assert!(Difference::FLAGS_AT + Difference::FLAGS as u32 <= Style::FOUND_BITS) };
        let Some(bits) = new.comparison_with(old) else {
            let it = Difference::between(old, new);
            let flags: [_; Difference::FLAGS] = [
                it.moves,
                it.repositions,
                it.changes_container,
                it.leaves_or_joins_flow,
                it.resizes,
                it.only_turns,
                it.only_resizes,
            ];
            let flags = flags
                .into_iter()
                .rfold(0, |all, it| all << 1 | u32::from(it));
            new.note_comparison(
                old,
                u32::from(it.total.bits())
                    | u32::from(it.change.bits()) << Difference::CHANGE_AT
                    | flags << Difference::FLAGS_AT,
            );
            return it;
        };
        let flags: [_; Difference::FLAGS] =
            core::array::from_fn(|it| bits >> Difference::FLAGS_AT >> it & 1 != 0);
        let [
            moves,
            repositions,
            changes_container,
            leaves_or_joins_flow,
            resizes,
            only_turns,
            only_resizes,
        ] = flags;
        let (total, change) = (
            Damage::from_bits_truncate(bits as u16),
            Change::from_bits_truncate((bits >> Difference::CHANGE_AT) as u8),
        );
        let it = Difference {
            total,
            change,
            moves,
            only_turns,
            only_resizes,
            repositions,
            changes_container,
            leaves_or_joins_flow,
            resizes,
        };
        debug_assert!(it == Difference::between(old, new));
        it
    }

    /// `None` if the values change what kind of box it is.
    fn of_amending(old: &Style, values: &[Value]) -> Option<Difference> {
        let mut it = Difference {
            total: Damage::empty(),
            change: Change::empty(),
            moves: false,
            only_turns: false,
            only_resizes: true,
            repositions: false,
            changes_container: false,
            leaves_or_joins_flow: false,
            resizes: false,
        };
        for value in values.iter().filter(|it| !old.has(it)) {
            let (property, is_translucent) = (value.id(), |it: f32| it > 0.0 && it < 1.0);
            let is_in =
                |first: Id, last: Id| (first as u16..=last as u16).contains(&(property as u16));
            it.total |= match value {
                Value::Opacity(new)
                    if is_translucent(old.effects.opacity.0) && is_translucent(new.0) =>
                {
                    Damage::OPACITY
                }
                Value::Transform(new)
                    if !old.effects.transform.0.is_empty()
                        && !new.0.is_empty()
                        && old.effects.backface == Backface::Visible
                        && !new.0.iter().any(Transform::projects) =>
                {
                    Damage::INK
                }
                Value::BackgroundColor(_) => Damage::BOX,
                _ if is_in(Id::Width, Id::Left) => Damage::LAYOUT,
                _ => return None,
            };
            it.change = Change::NOT_INHERITED;
            it.moves |= property == Id::Transform;
            it.only_turns = it.moves;
            it.only_resizes &= !is_in(Id::Width, Id::Left) || is_in(Id::Width, Id::MaxHeight);
            it.repositions |= property == Id::Transform || is_in(Id::Width, Id::Left);
            it.resizes |= matches!(property, Id::Width | Id::Height);
        }
        Some(it)
    }

    fn between(old: &Style, new: &Style) -> Difference {
        let (mut total, mut change, mut moves, mut repositions) =
            (Damage::empty(), Change::empty(), false, false);
        let (mut only_turns, mut only_resizes) = (old.has_transform() && new.has_transform(), true);
        old.differences(new, |property| {
            let is_translucent =
                |it: &Style| it.effects.opacity.0 > 0.0 && it.effects.opacity.0 < 1.0;
            let is_color = |it: &SvgPaint| matches!(it, SvgPaint::Color(_));
            let damage = match property {
                Id::Opacity if is_translucent(old) && is_translucent(new) => Damage::OPACITY,
                Id::Fill if is_color(&old.svg.fill) && is_color(&new.svg.fill) => Damage::COLOR,
                Id::Stroke if is_color(&old.svg.stroke) && is_color(&new.svg.stroke) => {
                    Damage::COLOR
                }
                Id::FillOpacity | Id::StrokeOpacity => Damage::COLOR,
                Id::BorderTopLeftRadius
                | Id::BorderTopRightRadius
                | Id::BorderBottomRightRadius
                | Id::BorderBottomLeftRadius
                | Id::CornerTopLeftShape
                | Id::CornerTopRightShape
                | Id::CornerBottomRightShape
                | Id::CornerBottomLeftShape
                    if new.rare.shape_outside.0.0.is_some() =>
                {
                    Damage::LAYOUT
                }
                Id::Visibility
                    if [old, new]
                        .iter()
                        .any(|it| it.ink.visibility.0 == Visibility::Collapse) =>
                {
                    damage(property) | Damage::CONTENTS
                }
                Id::BoxShadow
                    if shadow_extent(&old.paint.box_shadow)
                        == shadow_extent(&new.paint.box_shadow) =>
                {
                    Damage::BOX
                }
                _ => damage(property),
            };
            total |= damage - Damage::STAYS;
            moves |= damage.contains(Damage::INK) && !damage.contains(Damage::STAYS);
            let is_in =
                |first: Id, last: Id| (first as u16..=last as u16).contains(&(property as u16));
            only_turns &=
                !damage.contains(Damage::INK) || is_in(Id::Transform, Id::TransformOrigin);
            only_resizes &= !damage.contains(Damage::LAYOUT) || is_in(Id::Width, Id::MaxHeight);
            repositions |= is_in(Id::Width, Id::Left)
                || is_in(Id::Transform, Id::Scale)
                || property == Id::Position;
            change |= if property.is_inherited() {
                Change::INHERITED
            } else {
                Change::NOT_INHERITED
            };
        });
        let changes_container = (
            old.layout.container_type,
            &old.rare.container_name,
            old.queried_axes(),
        ) != (
            new.layout.container_type,
            &new.rare.container_name,
            new.queried_axes(),
        ) || !new.layout.container_type.is_empty()
            && old.flow() != new.flow();
        if old.contain().contains(Contain::STYLE) != new.contain().contains(Contain::STYLE) {
            total |= Damage::COUNTERS;
        }
        if (old.zoom, old.dark, old.metrics, old.font_id)
            != (new.zoom, new.dark, new.metrics, new.font_id)
        {
            (total, change, only_resizes) = (
                total | Damage::CONTENTS | Damage::LAYOUT,
                change | Change::INHERITED,
                false,
            );
        }
        if old.display() != new.display() || old.clamps_lines() != new.clamps_lines() {
            change |= Change::DISPLAY;
        }
        if old.look != new.look {
            (total, only_resizes) = (total | Damage::LAYOUT, false);
            change |= Change::REMATCH_ALL | Change::RECASCADE_ALL;
        }
        if old.layout.justify_items.is_legacy() != new.layout.justify_items.is_legacy() {
            change |= Change::RECASCADE_ALL;
        }
        if old.was_inline != new.was_inline {
            total |= Damage::PARENT;
        }
        if old.effects.will_change != new.effects.will_change
            || old.stacking()[0] != new.stacking()[0]
            || old.effects.filter.0.is_empty() != new.effects.filter.0.is_empty()
        {
            (total, only_resizes) = (total | Damage::LAYOUT, false);
        }
        if old.animates != new.animates || old.stacking()[1] != new.stacking()[1] {
            (total, moves, only_turns) = (total | Damage::INK, true, false);
        }
        let resizes =
            (&old.layout.height, &old.layout.width) != (&new.layout.height, &new.layout.width);
        Difference {
            total,
            change,
            moves,
            only_turns: only_turns && moves,
            only_resizes,
            repositions,
            changes_container,
            leaves_or_joins_flow: old.is_out_of_flow() != new.is_out_of_flow(),
            resizes,
        }
    }
}

impl Traversal {
    /// From `id` on.
    #[inline]
    fn marked_from(&mut self, id: NodeId) -> &[NodeId] {
        let (all, seen) = &mut self.marked;
        let Some(skipped) = all[*seen..].iter().take(4).position(|it| *it == id) else {
            return &[];
        };
        *seen += skipped + 1;
        &all[*seen - 1..]
    }

    fn difference(&mut self, old: &Rc<Style>, new: &Rc<Style>) -> Difference {
        if new.comparison_with(old).is_some() || Rc::strong_count(old) <= UNSHARED {
            return Difference::of(old, new);
        }
        let known = &mut self.differences[slot_of(old, Rc::as_ptr(new).addr())];
        known.take_if(|it| !Rc::ptr_eq(&it.1[0], old) || !Rc::ptr_eq(&it.1[1], new));
        known
            .get_or_insert_with(|| (Difference::of(old, new), [Rc::clone(old), Rc::clone(new)]))
            .0
    }

    /// The new style, what the children have to know, and the damage.
    #[inline]
    fn recall(
        &self,
        old: &Rc<Style>,
        rules: &Rc<RuleList>,
        parent: &Rc<Style>,
        has_changed_customs: bool,
    ) -> Option<(Rc<Style>, Change, Damage)> {
        let known = self.repainted[slot_of(old, Rc::as_ptr(rules).addr())].as_ref()?;
        (Rc::ptr_eq(&known.old, old)
            && Rc::ptr_eq(&known.rules, rules)
            && known.has_changed_customs == has_changed_customs
            && (Rc::ptr_eq(&known.parent, parent)
                || !known.new.deps.contains(Deps::PARENT)
                    && known.parent.inherits_the_same_as(parent)))
        .then(|| (Rc::clone(&known.new), known.below, known.damage))
    }

    fn note_if_repainted(
        &mut self,
        old: &Rc<Style>,
        rules: &Rc<RuleList>,
        parent: &Rc<Style>,
        has_changed_customs: bool,
        new: &Rc<Style>,
    ) {
        let is_plain = |it: &Style| {
            !it.deps.intersects(
                Deps::VIEWPORT | Deps::CONTAINER | Deps::ATTRIBUTES | Deps::SIBLINGS | Deps::ANCHOR,
            ) && it.layout.appearance == Appearance::None
                && it.text.border_collapse != BorderCollapse::Collapse
                && !matches!(it.display(), Display::None | Display::Contents)
                && !it.is_out_of_flow()
        };
        let it = self.difference(old, new);
        if Damage::LOOKS.contains(it.total)
            && !(it.moves || it.repositions || it.changes_container || it.resizes)
            && is_plain(old)
            && is_plain(new)
            && !rules.has_own_values()
            && old.is_positioned() == new.is_positioned()
            && old.customs.has_same_locals(&new.customs)
            && old.customs.differences(&new.customs).is_empty()
        {
            let [old, parent, new] = [old, parent, new].map(Rc::clone);
            let slot = slot_of(&old, Rc::as_ptr(rules).addr());
            self.repainted[slot] = Some(Repainted {
                old,
                rules: Rc::clone(rules),
                parent,
                has_changed_customs,
                new,
                below: it.change,
                damage: it.total,
            });
        }
    }
}

const BASE: Flags = Flags::BASE_SELECT.union(Flags::BASE_OPTIONS);

impl Document {
    /// Whether `update_style` has nothing to look at.
    #[inline]
    pub(crate) fn is_styled(&mut self) -> bool {
        !(self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS)
            || self.has_unmarked_changes()
            || self.styles.dependencies.get_mut().has_pending())
            && self.top_layer.is_empty()
            && self.marks.is_empty()
            && self.marks.restyled.is_empty()
    }

    #[inline]
    pub(crate) fn update_style(&mut self) {
        if !self.is_styled() {
            self.restyle_document();
        }
    }

    fn restyle_document(&mut self) {
        if self.smil.needs_update {
            self.update_smil();
        }
        self.update_directions();
        if core::mem::take(&mut self.locks.relevance_is_stale) {
            self.update_relevance();
        }
        if self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS)
            || self.styles.dependencies.get_mut().has_pending()
        {
            self.catch_up_with_compositor();
        }
        loop {
            while self.styles.dependencies.get_mut().has_pending() {
                self.styles.dependencies.get_mut().flush(
                    &self.tree,
                    &self.styles.has_results,
                    &self.styles.scopes,
                );
            }
            if !self.tree[DOCUMENT].has(Flags::DIRTY_DESCENDANTS) {
                break;
            }
            self.tree[DOCUMENT].unset(Flags::DIRTY_DESCENDANTS);
            let mut bloom = self.styles.bloom.take().unwrap_or_else(Bloom::new);
            bloom.begin_traversal(&self.tree);
            let styles_first_lines = !self.boxes.styled_first.get_mut().is_empty()
                || self.has_rules_for(Pseudo::FirstLine)
                || self.has_rules_for(Pseudo::FirstLetter);
            let mut traversal = Traversal {
                bloom,
                reparented: Map::default(),
                replaced: Map::default(),
                amended: Map::default(),
                repainted: Default::default(),
                differences: Default::default(),
                firsts: Vec::new(),
                styles_first_lines,
                has_plain_markers: self.has_plain_markers(),
                marked: (self.tree.marked.take(), 0),
            };
            let (root, initial) = (self.tree.root_element(), Rc::clone(&self.styles.initial));
            if root != 0 {
                self.restyle(root, &initial, Change::empty(), None, &mut traversal);
            }
            let others: Vec<_> = self.tree.next_elements(root).collect();
            for (id, parent) in others
                .into_iter()
                .zip(core::iter::repeat(self.tree.style(root).cloned()))
            {
                self.restyle(
                    id,
                    parent.as_ref().unwrap_or(&initial),
                    Change::INHERITED,
                    None,
                    &mut traversal,
                );
            }
            self.styles.bloom = Some(traversal.bloom);
            self.scrolling.declarers.take();
            self.update_top_layer();
        }
        self.styles.plain.clear();
        self.update_top_layer();
        if !self.marks.is_empty() {
            let count = self
                .styles
                .scopes
                .values()
                .map(|it| it.borrow().count_pseudos())
                .sum();
            if core::mem::replace(&mut self.marks.styled_pseudos, count) != count {
                self.forget_highlights();
            }
        }
        if !self.marks.restyled.is_empty() {
            let restyled = core::mem::take(&mut self.marks.restyled);
            self.update_highlights(&restyled);
        }
        if self.animations.names_are_stale {
            self.find_named_timelines();
            self.update_style();
        }
    }

    #[inline]
    pub(crate) fn has_unmarked_changes(&self) -> bool {
        self.smil.needs_update
            || !self.stale_directions.is_empty()
            || !self.leaving_top_layer.is_empty()
            || self.animations.names_are_stale
            || self.locks.relevance_is_stale
    }

    /// Whether the flags of the nodes now say which styles `update_style` would change.
    pub(crate) fn prepare_restyle(&mut self) -> bool {
        if self.has_unmarked_changes() {
            return false;
        }
        while self.styles.dependencies.get_mut().has_pending() {
            self.styles.dependencies.get_mut().flush(
                &self.tree,
                &self.styles.has_results,
                &self.styles.scopes,
            );
        }
        true
    }

    fn update_top_layer(&mut self) {
        if self.top_layer.is_empty() && self.leaving_top_layer.is_empty() {
            return;
        }
        let tree = &self.tree;
        let stays = |id: &NodeId| {
            tree.style(*id)
                .is_some_and(|it| it.rare.overlay == OverlayKind::Auto)
        };
        let (staying, left): (Vec<_>, Vec<_>) =
            self.leaving_top_layer.iter().copied().partition(stays);
        self.leaving_top_layer = staying;
        if !left.is_empty() {
            let left: Set<_> = left.iter().collect();
            self.top_layer.retain(|it| !left.contains(it));
        }
        let is_in = |id: &NodeId| !self.tree[*id].has(Flags::ANIMATED) || stays(id);
        let moving = self
            .top_layer
            .iter()
            .copied()
            .filter(|it| is_in(it) != self.tree[*it].has(Flags::TOP_LAYER));
        let moving: Vec<_> = moving
            .chain(
                left.into_iter()
                    .filter(|it| self.tree[*it].has(Flags::TOP_LAYER)),
            )
            .collect();
        for id in &moving {
            self.mark_rebuild(DOCUMENT);
            self.detach_box(*id);
            match self.tree[*id].has(Flags::TOP_LAYER) {
                true => self.tree[*id].unset(Flags::TOP_LAYER),
                false => self.tree[*id].set(Flags::TOP_LAYER),
            }
            self.tree.mark_style(*id, Flags::REMATCH | Flags::RECASCADE);
            if self.was_displayed(*id) {
                self.mark_parent_rebuild(*id);
            }
        }
        if !moving.is_empty() {
            self.update_style();
        }
    }

    fn reparent(&self, old: &Rc<Style>, parent: &Style, traversal: &mut Traversal) -> Rc<Style> {
        let key = (
            Rc::as_ptr(old),
            Rc::as_ptr(&parent.customs.inherited).cast(),
        );
        let known = traversal.reparented.entry(key).or_insert_with(|| {
            let customs = old
                .customs
                .reparented(&parent.customs, &self.styles.recent_customs);
            (Rc::clone(old), Rc::new(old.with_customs(customs)))
        });
        Rc::clone(&known.1)
    }

    fn restyle(
        &mut self,
        id: NodeId,
        parent: &Rc<Style>,
        change: Change,
        customs: Option<&Changed>,
        traversal: &mut Traversal,
    ) {
        let flags = self.tree[id].flags.get();
        let Some(element) = self.tree.element(id) else {
            return;
        };
        if !change.is_empty() || customs.is_some() {
            self.prefetch_after(id);
        }
        if !flags.intersects(Flags::STYLE_DIRTY)
            && let Some(old) = &element.style
        {
            if (change - Change::BY_ANIMATION).is_empty() && customs.is_none() {
                return self.restyle_descendants(id, traversal);
            }
            if !change.intersects(Change::REMATCH_ALL | Change::RECASCADE_ALL | Change::DISPLAY)
                && let Some(known) = element
                    .rules
                    .as_ref()
                    .and_then(|rules| traversal.recall(old, rules, parent, customs.is_some()))
                && self.is_ordinary(id, flags, false)
            {
                self.tree[id].unset(Flags::DIRTY_DESCENDANTS);
                return self.repaint_like_another(
                    id,
                    parent,
                    known,
                    (flags, self.dirty_child(id, flags)),
                    change,
                    customs,
                    false,
                    traversal,
                );
            }
            if let Some(customs) = customs.filter(|_| {
                Rc::strong_count(old) <= 12
                    && (change.is_empty()
                        || change == Change::NOT_INHERITED && !old.deps.contains(Deps::PARENT))
            }) && self.inherit_customs(id, parent, flags, customs, traversal)
            {
                return;
            }
        }
        if flags & (Flags::STYLE_DIRTY | Flags::ANIMATED) == Flags::REANIMATE {
            self.anticipate_amendments(traversal.marked_from(id));
            if change.is_empty()
                && customs.is_none()
                && self.amend_in_place(id, parent, flags, traversal)
            {
                return;
            }
        } else if flags.contains(Flags::REMATCH) {
            self.anticipate_matches(traversal.marked_from(id));
        }
        self.restyle_anew(id, parent, change, customs, traversal);
    }

    /// For an element that has its style to itself. Whether that was possible.
    fn amend_in_place(
        &mut self,
        id: NodeId,
        parent: &Rc<Style>,
        flags: Flags,
        traversal: &mut Traversal,
    ) -> bool {
        let Some(own) = self.own_box(id) else {
            return false;
        };
        let Some(Element {
            style: Some(style),
            base_style: Some(base),
            rules: Some(rules),
            inline_style: Some(block),
            namespace: Namespace::Html,
            generated_by_rules,
            ..
        }) = self.tree.element(id)
        else {
            return false;
        };
        if !(rules.has_amended(block)
            && (Rc::strong_count(style), Rc::weak_count(style)) == (3, 0)
            && Rc::ptr_eq(style, base)
            && Rc::ptr_eq(style, &self.boxes[own].style)
            && style.is_inert()
            && !flags.intersects(Flags::QUERIES_CONTAINER | Flags::CATCHES_UP | Flags::LAGS)
            && !(self.has_base_selects || traversal.styles_first_lines)
            && self.anchored.is_empty()
            && self.carousels.is_empty()
            && self.marks.styles.borrow().is_empty())
        {
            return false;
        }
        let Some(mut it) = self
            .amendments(id, rules, style, parent)
            .filter(|it| it.customs.is_none() || *generated_by_rules == Some(0))
        else {
            return false;
        };
        let Some(difference) = Difference::of_amending(style, &it.values) else {
            return false;
        };
        rules.amended.set(0);
        let customs = Changed::new(it.names.drain(..), None);
        self.amend_style(
            id,
            Some(own),
            parent,
            flags,
            it,
            difference,
            customs.as_ref(),
            traversal,
        );
        true
    }

    /// For an element whose `transform` attribute has changed. Whether that is all that has to be done.
    pub(crate) fn move_svg_element(&mut self, id: NodeId) -> bool {
        let Some(
            element @ Element {
                style: Some(style),
                base_style: Some(base),
                rules: Some(rules),
                ..
            },
        ) = self.tree.element(id)
        else {
            self.tree.mark_style(id, Flags::RECASCADE);
            return false;
        };
        let is_simple = element.has_moved
            && !self.tree[id].has(Flags::STYLE_DIRTY | Flags::ANIMATED)
            && Rc::ptr_eq(style, base)
            && style.is_inert()
            && !style.deps.contains(Deps::REVERTED)
            && !style.effects.transform.0.is_empty()
            && self.tree[id].layout_box == 0
            && self.is_set_by_hint(rules, style, Id::Transform);
        let matrix = is_simple
            .then(|| crate::svg::transform_attribute(element))
            .flatten()
            .filter(|it| it.iter().all(|it| it.is_finite()));
        let value = matrix
            .map(|it| Value::Transform(crate::transform::Transforms::of_matrix(it, style.zoom)));
        let Some(element) = self.tree.element_to_style(id) else {
            return false;
        };
        let (Some(value), Some(style)) = (value, &mut element.style) else {
            element.rare_mut().has_moved = true;
            self.tree.mark_style(id, Flags::RECASCADE);
            return false;
        };
        element.base_style = None;
        Rc::make_mut(style).amend(&[value], Deps::empty());
        element.base_style = Some(Rc::clone(style));
        for child in self.rendered_children(id).filter(|it| {
            self.tree
                .style(*it)
                .is_none_or(|it| it.deps.contains(Deps::PARENT))
        }) {
            self.tree
                .element(child)
                .into_iter()
                .for_each(|_| self.tree.mark_style(child, Flags::RECASCADE));
        }
        true
    }

    /// For an element of which nothing else has changed. Whether that was possible.
    fn inherit_customs(
        &mut self,
        id: NodeId,
        parent: &Rc<Style>,
        flags: Flags,
        customs: &Changed,
        traversal: &mut Traversal,
    ) -> bool {
        let Some(Element {
            style: Some(style),
            rules: Some(rules),
            namespace,
            ..
        }) = self.tree.element(id)
        else {
            return false;
        };
        if !style.is_inert()
            || style.display() == Display::None
            || traversal.styles_first_lines
            || !self.is_ordinary(id, flags, false)
        {
            return false;
        }
        let own = self.own_box(id);
        let is_alone = (Rc::strong_count(style), Rc::weak_count(style))
            == (2 + usize::from(own.is_some()), 0)
            && own.is_none_or(|it| Rc::ptr_eq(style, &self.boxes[it].style));
        let is_alone = is_alone && *namespace == Namespace::Html;
        if rules.references_any(customs) {
            let Some(it) = own
                .filter(|_| is_alone)
                .and_then(|_| self.inherited_amendments(id, rules, style, parent, customs))
            else {
                return false;
            };
            let Some(difference) = Difference::of_amending(style, &it.values) else {
                return false;
            };
            self.amend_style(
                id,
                own,
                parent,
                flags,
                it,
                difference,
                Some(customs),
                traversal,
            );
            return true;
        }
        if is_alone {
            let inherited = style
                .customs
                .reparented(&parent.customs, &self.styles.recent_customs);
            let customs =
                (!Rc::ptr_eq(&inherited.inherited, &style.customs.inherited)).then_some(customs);
            let Some(new) = self.edit_style(id, own, parent, |it| it.customs = inherited) else {
                return false;
            };
            self.tree[id].unset(Flags::DIRTY_DESCENDANTS);
            self.restyle_children(
                id,
                &new,
                (flags, self.dirty_child(id, flags)),
                Change::empty(),
                Change::empty(),
                customs,
                Children {
                    is_new: false,
                    rematches: false,
                },
                traversal,
            );
            return true;
        }
        let new = self.reparent(style, parent, traversal);
        self.tree[id].unset(Flags::DIRTY_DESCENDANTS);
        self.repaint_like_another(
            id,
            parent,
            (new, Change::empty(), Damage::empty()),
            (flags, self.dirty_child(id, flags)),
            Change::empty(),
            Some(customs),
            false,
            traversal,
        );
        true
    }

    /// Nothing but the element and `own` has it.
    #[inline(always)]
    fn edit_style(
        &mut self,
        id: NodeId,
        own: Option<BoxId>,
        parent: &Style,
        edit: impl FnOnce(&mut Style),
    ) -> Option<Rc<Style>> {
        self.matrices.forget();
        own.into_iter()
            .for_each(|it| self.boxes[it].style = Rc::clone(&self.styles.initial));
        let element = self.tree.element_to_style(id)?;
        element.base_style = None;
        let style = element.style.as_mut()?;
        edit(Rc::make_mut(style));
        let new = Rc::clone(style);
        element.base_style = Some(Rc::clone(&new));
        own.into_iter()
            .for_each(|it| self.boxes[it].style = Rc::clone(&new));
        debug_assert!(
            self.tree
                .element(id)
                .and_then(|it| it.rules.as_ref())
                .is_some_and(|it| {
                    let computed = self.compute_animated_style(id, it, parent, &[], &[]);
                    inherited_change(&new, &computed).is_empty()
                        && new
                            .customs
                            .inherited_differences(&computed.customs)
                            .is_empty()
                        && new.customs.has_same_locals(&computed.customs)
                })
        );
        Some(new)
    }

    fn amend_style(
        &mut self,
        id: NodeId,
        own: Option<BoxId>,
        parent: &Rc<Style>,
        flags: Flags,
        Amendments {
            values,
            deps,
            customs,
            ..
        }: Amendments,
        difference: Difference,
        mut changed: Option<&Changed>,
        traversal: &mut Traversal,
    ) {
        let old = self
            .tree
            .style(id)
            .filter(|_| cfg!(debug_assertions))
            .map(|it| Style::clone(it));
        let new = self.edit_style(id, own, parent, |it| {
            it.amend(&values, deps);
            if let Some(customs) = customs {
                changed =
                    changed.filter(|_| !Rc::ptr_eq(&customs.inherited, &it.customs.inherited));
                it.customs = customs;
            }
        });
        let Some(new) = new else { return };
        debug_assert!(
            old.is_some_and(|old| difference == Difference::between(&old, &new)
                && old.stacking() == new.stacking()
                && new.is_inert())
        );
        let dirty_child = self.dirty_child(id, flags);
        self.tree[id].unset(Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS);
        if deps.contains(Deps::VIEWPORT) {
            self.viewport_users.insert(id);
        }
        self.container_changed(id, false);
        let is_position = |it: &Value| {
            matches!(
                it,
                Value::Left(Inset::Length(Lp::Px(_))) | Value::Top(Inset::Length(Lp::Px(_)))
            )
        };
        let only_moves = !difference.total.is_empty()
            && values.iter().all(is_position)
            && own.is_some_and(|it| self.new_location(it).is_some());
        let below = match only_moves {
            true => self.move_later(id, difference),
            false => self.apply_difference(id, &new, &new, difference, false),
        };
        if flags.contains(Flags::REANIMATE) && new.scrolls() {
            self.update_scrollbar_style(id);
        }
        self.restyle_children(
            id,
            &new,
            (flags, dirty_child),
            Change::empty(),
            below,
            changed,
            Children {
                is_new: false,
                rematches: false,
            },
            traversal,
        );
    }

    #[inline(always)]
    fn dirty_child(&self, id: NodeId, flags: Flags) -> NodeId {
        if flags.contains(Flags::DIRTY_DESCENDANTS) {
            self.tree.dirty_child(id).get()
        } else {
            0
        }
    }

    fn move_later(&mut self, id: NodeId, difference: Difference) -> Change {
        if !self.scrolling.scrolled.is_empty() {
            self.scrolling.repositioned.insert(id);
        }
        self.svg_changed(id);
        self.boxes_to_move.push(id);
        self.needs_layout = true;
        difference.change
    }

    /// With what `Traversal::recall` has returned.
    fn repaint_like_another(
        &mut self,
        id: NodeId,
        parent: &Rc<Style>,
        (new, own, damage): (Rc<Style>, Change, Damage),
        dirt: (Flags, NodeId),
        change: Change,
        customs: Option<&Changed>,
        rematches: bool,
        traversal: &mut Traversal,
    ) {
        debug_assert!(
            self.tree
                .element(id)
                .and_then(|it| it.rules.as_ref())
                .is_some_and(
                    |it| inherited_change(&new, &self.compute_style(id, it, parent)).is_empty()
                )
        );
        let Some(element) = self.tree.element_to_style(id) else {
            return;
        };
        element.base_style = Some(Rc::clone(&new));
        let Some(old) = element.style.replace(Rc::clone(&new)) else {
            return;
        };
        let mut below = own | change & Change::REMATCH_ALL;
        if !Rc::ptr_eq(&old, &new) {
            below |= change & Change::BY_ANIMATION;
            self.set_box_style(id, &new);
        }
        if !damage.is_empty() {
            self.repaint_damage(id, [&old, &new], damage, own);
        }
        if rematches {
            self.rebuild_if_in_first_line(id);
            if new.scrolls() {
                self.update_scrollbar_style(id);
            }
            self.update_generated(id, &new, false, traversal);
        }
        let customs =
            customs.filter(|_| !Rc::ptr_eq(&old.customs.inherited, &new.customs.inherited));
        self.restyle_children(
            id,
            &new,
            dirt,
            change,
            below,
            customs,
            Children {
                is_new: false,
                rematches,
            },
            traversal,
        );
    }

    #[inline(never)]
    fn restyle_anew(
        &mut self,
        id: NodeId,
        parent: &Rc<Style>,
        mut change: Change,
        customs: Option<&Changed>,
        traversal: &mut Traversal,
    ) {
        let mut flags = self.tree[id].flags.get();
        let dirty_child = self.dirty_child(id, flags);
        let Some(element) = self.tree.element(id) else {
            return;
        };
        self.tree[id].unset(Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS);
        if element.is_generated() && element.pseudo == Pseudo::None {
            if let Some(old) = element
                .style
                .clone()
                .filter(|it| !it.inherits_the_same_as(parent))
            {
                let new = self.anonymous_style(parent, old.display());
                self.tree
                    .element_to_style(id)
                    .into_iter()
                    .for_each(|it| it.style = Some(Rc::clone(&new)));
                self.apply_damage(id, &old, &new, false, traversal);
            }
            return;
        }
        let is_input = element.tag == name!("input");
        let looks = if element.rules.is_none() {
            self.looks_of(id, element, parent, &traversal.bloom)
        } else {
            None
        };
        if let Some(new) = looks.and_then(|it| self.copy_first_style(id, it, parent, traversal)) {
            self.first_style(id, &new, change.contains(Change::IN_NEW_BOX));
            if new.display().is_list_item()
                || self
                    .tree
                    .element(id)
                    .is_some_and(|it| it.generated_by_rules > Some(0))
            {
                self.update_generated(id, &new, true, traversal);
            }
            if is_input {
                self.provide_parts(id);
            }
            return self.restyle_children(
                id,
                &new,
                (flags, dirty_child),
                change,
                Change::IN_NEW_BOX,
                customs,
                Children {
                    is_new: true,
                    rematches: true,
                },
                traversal,
            );
        }
        let Some(element) = self.tree.element(id) else {
            return;
        };
        let (old_rules, old_base, old) = (
            element.rules.clone(),
            element.base_style.clone(),
            element.style.clone(),
        );
        if flags.contains(Flags::REMATCH_SUBTREE) {
            change |= Change::REMATCH_ALL;
        }
        if flags.contains(Flags::RECASCADE_SUBTREE) {
            change |= Change::RECASCADE_ALL;
        }
        // It may have another parent than the one that it inherited from.
        let moved = old
            .as_ref()
            .filter(|_| flags.contains(Flags::REMATCH_SUBTREE | Flags::RECASCADE_SUBTREE));
        let moved = moved.and_then(|it| {
            Changed::new(it.customs.inherited_differences(&parent.customs), customs)
        });
        let customs = moved.as_ref().or(customs);
        let mut rematches = old_rules.is_none()
            || flags.contains(Flags::REMATCH)
            || change.contains(Change::REMATCH_ALL);
        let mut rules = match old_rules.as_ref().filter(|_| !rematches) {
            Some(rules) => Rc::clone(rules),
            None => {
                if self.tree[id].has(Flags::HAS_ANCHOR) && old.is_none() {
                    self.styles.has_results.get_mut().remove(&id);
                    self.tree.forget_found();
                }
                let bloom = Some(traversal.bloom.update(&self.tree));
                match old_rules.is_none() || change.contains(Change::REMATCH_ALL) {
                    true => self.match_rules(id, bloom, false),
                    false => self.match_active_rules(id, bloom, false),
                }
            }
        };
        debug_assert!(!rematches || rules.has_same_winners(&self.match_rules(id, None, false)));
        let is_ordinary = old.is_some()
            && !change.intersects(Change::RECASCADE_ALL | Change::DISPLAY)
            && self.is_ordinary(id, flags, rematches);
        if let Some(known) = old
            .as_ref()
            .filter(|_| is_ordinary)
            .and_then(|old| traversal.recall(old, &rules, parent, customs.is_some()))
        {
            if let Some(element) = self.tree.element_to_style(id) {
                element.rules = Some(rules);
            }
            return self.repaint_like_another(
                id,
                parent,
                known,
                (flags, dirty_child),
                change,
                customs,
                rematches,
                traversal,
            );
        }
        let mut amended = None;
        let with_inline_style = || {
            self.with_inline_style(id, &rules)
                .or_else(|| (rules.amended.get() != 0).then(|| Rc::clone(&rules)))
        };
        let has_new_inline_style = !rematches
            && flags.contains(Flags::REANIMATE)
            && with_inline_style().is_some_and(|new| {
                let is_alone = change.is_empty()
                    && customs.is_none()
                    && !flags.intersects(Flags::RECASCADE | Flags::RECASCADE_SUBTREE);
                amended = old_base.as_ref().filter(|_| is_alone).and_then(|old_base| {
                    if Rc::strong_count(old_base) <= UNSHARED {
                        return self
                            .amended_style(id, &rules, &new, old_base, parent)
                            .map(Rc::new);
                    }
                    let key = (Rc::as_ptr(old_base), Rc::as_ptr(&new));
                    let known = traversal.amended.get(&key).map(|it| Rc::clone(&it.0));
                    let style = known.or_else(|| {
                        self.amended_style(id, &rules, &new, old_base, parent)
                            .map(Rc::new)
                    })?;
                    traversal.amended.entry(key).or_insert_with(|| {
                        (Rc::clone(&style), Rc::clone(old_base), Rc::clone(&new))
                    });
                    Some(style)
                });
                rules = new;
                true
            });
        if has_new_inline_style {
            flags |= Flags::RECASCADE;
            rules.amended.set(0);
        }
        if !self.marks.styles.get_mut().is_empty() && self.marks.styles.get_mut().contains_key(&id)
        {
            self.marks.restyled.push(id);
        }
        let mut is_computed = true;
        let is_amended = amended.is_some();
        let mut base = match &old_base {
            _ if let Some(amended) = amended => {
                debug_assert!(
                    inherited_change(&amended, &self.compute_style(id, &rules, parent)).is_empty()
                );
                amended
            }
            Some(old_base)
                if old_rules.as_ref().is_some_and(|it| Rc::ptr_eq(it, &rules))
                    && !flags.contains(Flags::RECASCADE)
                    && !change.intersects(
                        Change::RECASCADE_ALL | Change::INHERITED | Change::DISPLAY,
                    )
                    && !(change.contains(Change::NOT_INHERITED)
                        && old_base.deps.contains(Deps::PARENT))
                    && !customs.is_some_and(|it| rules.references_any(it)) =>
            {
                is_computed = false;
                match customs.is_none() {
                    true => Rc::clone(old_base),
                    false => self.reparent(old_base, parent, traversal),
                }
            }
            Some(old_base) => {
                let computed = self.compute_style(id, &rules, parent);
                let key = (Rc::as_ptr(old_base), Rc::as_ptr(&computed));
                let has_copies = || {
                    !Rc::ptr_eq(&computed.customs.inherited, &old_base.customs.inherited)
                        && customs.is_none()
                        || computed.comparison_with(old_base).is_none()
                            && computed.has_copies_of(old_base)
                };
                match key.0 == key.1 || !traversal.replaced.contains_key(&key) && !has_copies() {
                    true => computed,
                    false => {
                        let known = traversal.replaced.entry(key).or_insert_with(|| {
                            let mut shared = Style::clone(&computed);
                            shared.groups.share_with(old_base);
                            if customs.is_none()
                                && shared.customs.differences(&old_base.customs).is_empty()
                            {
                                shared.customs.share_with(&old_base.customs);
                            }
                            [Rc::new(shared), Rc::clone(old_base), computed]
                        });
                        Rc::clone(&known[0])
                    }
                }
            }
            None => self.compute_style(id, &rules, parent),
        };
        if (self.has_base_selects || base.layout.appearance == Appearance::BaseSelect)
            && self.update_base_select(id, &base)
        {
            rules = self.match_rules(id, Some(traversal.bloom.update(&self.tree)), false);
            base = self.compute_style(id, &rules, parent);
            (is_computed, rematches) = (true, true);
            change |= Change::REMATCH_ALL;
        }
        if self.tree.is_root(id)
            && !self.tree[id].has(Flags::ANIMATED)
            && self.update_root_units(id, &base)
        {
            base = self.compute_style(id, &rules, parent);
            change |= Change::RECASCADE_ALL;
        }
        let mut is_provisional = false;
        if is_computed
            && (base.is_out_of_flow()
                || base.deps.contains(Deps::ANCHOR)
                || !self.anchored.is_empty())
        {
            is_provisional = self
                .anchored
                .get_mut(&id)
                .is_some_and(|it| core::mem::take(&mut it.is_unresolved))
                && !self.queries.before.contains_key(&id);
            base = self.with_anchors(id, base);
        }
        let base_changed = !old_base.as_ref().is_some_and(|it| Rc::ptr_eq(it, &base));
        let is_inert = !flags.contains(Flags::ANIMATED)
            && base.is_inert()
            && old_base.as_ref().is_none_or(|it| it.is_inert());
        let is_like = |old: &Rc<Style>| {
            inherited_change(old, &base).is_empty()
                && old.customs.has_same_locals(&base.customs)
                && old.customs.differences(&base.customs).is_empty()
        };
        let is_news = base_changed
            && !(self.queries.are_settling
                && customs.is_none()
                && old_base.as_ref().is_some_and(is_like));
        if (is_news
            || flags.contains(Flags::KEYFRAMES_CHANGED)
            || rematches && self.queries.are_settling)
            && !is_provisional
            && !is_inert
        {
            self.tree
                .element_to_style(id)
                .into_iter()
                .for_each(|it| it.rules = Some(Rc::clone(&rules)));
            self.start_animations(
                id,
                parent,
                old.as_ref().and(old_base.as_ref()),
                &base,
                change,
                flags,
                traversal,
            );
        }
        let new = match (
            &old,
            self.tree[id].has(Flags::ANIMATED | Flags::REANIMATE)
                || flags.contains(Flags::REANIMATE),
        ) {
            (Some(old), false) if !base_changed => Rc::clone(old),
            (_, false) => self.animate(id, &rules, parent, &base),
            _ => {
                let animated = self.animate(id, &rules, parent, &base);
                self.with_animated_anchors(id, animated)
            }
        };
        if !self.anchored.is_empty()
            && [&base, &new].iter().all(|it| it.display() == Display::None)
            && self.anchored.remove(&id).is_some()
        {
            self.tree.mark_style(id, Flags::RECASCADE);
        }
        if self.tree.is_root(id) && self.update_root_units(id, &new) {
            change |= Change::RECASCADE_ALL;
        }
        let is_base = |style: &Option<Rc<Style>>| {
            style
                .as_ref()
                .zip(old_base.as_ref())
                .is_some_and(|(a, b)| Rc::ptr_eq(a, b))
        };
        let only_customs = !is_computed && is_base(&old) && Rc::ptr_eq(&new, &base);
        self.tree[id].unset(Flags::REANIMATE | Flags::CATCHES_UP | Flags::LAGS);
        if new.deps.intersects(Deps::VIEWPORT | Deps::CONTAINER) {
            self.viewport_users.insert(id);
        }
        if let Some(old) = old.as_ref().filter(|it| {
            is_ordinary && is_inert && Rc::strong_count(it) > 12 && Rc::ptr_eq(&new, &base)
        }) {
            traversal.note_if_repainted(old, &rules, parent, customs.is_some(), &new);
        }
        if let Some(element) = self.tree.element_to_style(id) {
            (element.rules, element.base_style, element.style) =
                (Some(rules), Some(base), Some(Rc::clone(&new)));
            element.generated_by_rules.take_if(|_| rematches);
        }

        if old.as_ref().is_some_and(|it| {
            !Rc::ptr_eq(it, &new)
                || change.contains(Change::RECASCADE_ALL)
                || flags.contains(Flags::REMATCH_SUBTREE)
        }) {
            self.container_changed(id, false);
        }
        if rematches && old.is_some() {
            self.rebuild_if_in_first_line(id);
        }
        let mut below = change & (Change::REMATCH_ALL | Change::RECASCADE_ALL);
        let mut changed_customs = customs;
        let own_customs;
        match &old {
            Some(old) if Rc::ptr_eq(old, &new) => changed_customs = None,
            Some(old) => {
                match only_customs {
                    true => self.set_box_style(id, &new),
                    false => {
                        below |= self.apply_damage(
                            id,
                            old,
                            &new,
                            !base_changed && flags.contains(Flags::CATCHES_UP),
                            traversal,
                        )
                    }
                }
                if !old.customs.has_same_locals(&new.customs) {
                    below |= Change::NOT_INHERITED;
                }
                if Rc::ptr_eq(&old.customs.inherited, &new.customs.inherited) {
                    changed_customs = None;
                } else {
                    own_customs = Changed::new(old.customs.differences(&new.customs), customs);
                    changed_customs = own_customs.as_ref().or(customs);
                }
                if change.contains(Change::BY_ANIMATION) || !base_changed {
                    below |= Change::BY_ANIMATION;
                }
            }
            None => {
                let is_in_place = !self.tree[id].has(Flags::TOP_LAYER) && self.carousels.is_empty();
                self.first_style(id, &new, is_in_place && change.contains(Change::IN_NEW_BOX));
                below.set(
                    Change::IN_NEW_BOX,
                    is_in_place && self.tree[id].layout_box == 0,
                );
            }
        }
        if new.display() == Display::Contents {
            below |= change & Change::DISPLAY;
        }
        if new.display() == Display::None {
            if old.is_some_and(|it| it.display() != Display::None) {
                if self
                    .tree
                    .element(id)
                    .and_then(|it| it.base_style.as_ref())
                    .is_none_or(|it| it.display() == Display::None)
                {
                    self.cancel_css_animations(id);
                }
                self.is_burying = self.bury_box(id);
                self.scrolling.is_hiding = true;
                self.forget_styles_below(id);
                (self.is_burying, self.scrolling.is_hiding) = (false, false);
                self.forget_lock(id);
            }
            return;
        }
        if (rematches || has_new_inline_style) && new.scrolls() {
            self.update_scrollbar_style(id);
        }
        let generates_nothing = only_customs
            && !self.has_base_selects
            && self
                .tree
                .element(id)
                .is_some_and(|it| it.generated_by_rules == Some(0));
        if rematches || base_changed && !generates_nothing || flags.contains(Flags::RECASCADE) {
            let matches_the_same = !rematches
                && (is_amended || !flags.contains(Flags::RECASCADE))
                && !self.tree[id].has(Flags::QUERIES_CONTAINER);
            self.update_generated(id, &new, matches_the_same, traversal);
        }
        if let Some(looks) =
            looks.filter(|_| traversal.bloom.last_decided.get() == id && is_unremarkable(&new))
            && let Some(Element {
                rules: Some(rules),
                generated_by_rules,
                ..
            }) = self.tree.element(id)
        {
            traversal.firsts.resize_with(64, || None);
            traversal.firsts[looks.slot()] = Some(First {
                looks,
                rules: Rc::clone(rules),
                parent: Rc::clone(parent),
                style: Rc::clone(&new),
                generated_by_rules: *generated_by_rules,
            });
        }
        let is_new = old.is_none_or(|it| it.display() == Display::None);
        if is_input && is_new {
            self.provide_parts(id);
        }
        self.restyle_children(
            id,
            &new,
            (flags, dirty_child),
            change,
            below,
            changed_customs,
            Children { is_new, rematches },
            traversal,
        );
    }

    /// Of an element that has no style yet, if nothing else has a say in it but the style of its parent.
    fn looks_of(
        &self,
        id: NodeId,
        element: &Element,
        parent: &Style,
        bloom: &Bloom,
    ) -> Option<Looks> {
        const HARMLESS: Flags = (Flags::DIRTY_DESCENDANTS
            .union(Flags::EDGE_CHILDREN)
            .union(Flags::CHILD_INDEX)
            .union(Flags::NEXT_SIBLING)
            .union(Flags::LATER_SIBLINGS))
        .union(
            Flags::EMPTINESS
                .union(Flags::COUNTED_CHILDREN)
                .union(Flags::AUTO_DIRECTION),
        );
        let node = &self.tree[id];
        (HARMLESS.contains(node.flags.get())
            && (node.slot, node.layout_box) == (0, 0)
            && node.parent == bloom.innermost()
            && element.namespace == Namespace::Html
            && element.pseudo == Pseudo::None
            && element.style.is_none()
            && element.has_only_classes()
            && element.custom_states.is_empty()
            && !self.has_own_declarations(element)
            && parent.display() != Display::Contents
            && !self.has_base_selects
            && self.anchored.is_empty()
            && self.carousels.is_empty()
            && self.marks.styles.borrow().is_empty())
        .then(|| Looks {
            ancestors: self
                .styles
                .dependencies
                .borrow()
                .signature_of_path(&self.tree, bloom),
            tag: element.tag,
            classes: element
                .classes
                .as_ref()
                .map_or(core::ptr::null(), Rc::as_ptr),
            state: element.state,
            scope: node.scope,
        })
    }

    fn copy_first_style(
        &mut self,
        id: NodeId,
        looks: Looks,
        parent: &Rc<Style>,
        traversal: &mut Traversal,
    ) -> Option<Rc<Style>> {
        let known = traversal
            .firsts
            .get_mut(looks.slot())?
            .as_mut()
            .filter(|it| it.looks == looks)?;
        if !Rc::ptr_eq(&known.parent, parent) {
            let style = self.compute_style(id, &known.rules, parent);
            (is_unremarkable(&style) && style.display() == known.style.display()).then_some(())?;
            (known.parent, known.style) = (Rc::clone(parent), style);
        }
        debug_assert!(Rc::ptr_eq(&known.rules, &self.match_rules(id, None, false)));
        debug_assert!(
            known
                .generated_by_rules
                .is_none_or(|it| it == self.generated_by_rules(id, None))
        );
        debug_assert!({
            let mut count = 0;
            known
                .style
                .differences(&self.compute_style(id, &known.rules, parent), |_| {
                    count += 1
                });
            count == 0
        });
        if known.style.deps.contains(Deps::VIEWPORT) {
            self.viewport_users.insert(id);
        }
        let element = self.tree.element_to_style(id)?;
        (element.rules, element.generated_by_rules) =
            (Some(Rc::clone(&known.rules)), known.generated_by_rules);
        (element.base_style, element.style) =
            (Some(Rc::clone(&known.style)), Some(Rc::clone(&known.style)));
        Some(Rc::clone(&known.style))
    }

    /// Whether nothing but its rules and its parent has a say in what a change of style entails.
    fn is_ordinary(&self, id: NodeId, flags: Flags, rematches: bool) -> bool {
        const ORDINARY: Flags = (Flags::REMATCH
            .union(Flags::REMATCH_SUBTREE)
            .union(Flags::DIRTY_DESCENDANTS)
            .union(Flags::REBUILD)
            .union(Flags::REBUILD_BELOW))
        .union(
            Flags::EDGE_CHILDREN
                .union(Flags::CHILD_INDEX)
                .union(Flags::NEXT_SIBLING)
                .union(Flags::LATER_SIBLINGS)
                .union(Flags::EMPTINESS),
        )
        .union(
            Flags::HAS_ANCHOR
                .union(Flags::COUNTED_CHILDREN)
                .union(Flags::AUTO_DIRECTION)
                .union(Flags::IS_MEASURED),
        );
        let Some(element) = self.tree.element(id) else {
            return false;
        };
        ORDINARY.contains(flags)
            && matches!(element.namespace, Namespace::Html | Namespace::Svg)
            && match element.pseudo {
                Pseudo::None => {
                    (rematches
                        || element.generated_by_rules == Some(0)
                        || element.namespace == Namespace::Svg)
                        && element.tag != name!("img")
                        && self.tree[id].parent != DOCUMENT
                }
                Pseudo::Marker => self.tree.html_tag(element.originator) != name!("summary"),
                _ => false,
            }
            && element
                .style
                .as_ref()
                .zip(element.base_style.as_ref())
                .is_some_and(|(a, b)| Rc::ptr_eq(a, b))
            && !(self.has_base_selects || self.boxes.has_pinned_styles)
            && self.boxes.split.is_empty()
            && self.replacements.is_empty()
            && self.anchored.is_empty()
            && self.carousels.is_empty()
            && self.marks.styles.borrow().is_empty()
    }

    fn restyle_children(
        &mut self,
        id: NodeId,
        new: &Rc<Style>,
        (flags, dirty_child): (Flags, NodeId),
        change: Change,
        mut below: Change,
        changed_customs: Option<&Changed>,
        Children {
            mut is_new,
            rematches,
        }: Children,
        traversal: &mut Traversal,
    ) {
        if self.tree.has_only_text(id)
            && !self.tree[id].has(Flags::HAS_MISSED)
            && self.carousels.is_empty()
        {
            return;
        }
        let (missed_customs, shown);
        let (mut new, mut changed_customs) = (new, changed_customs);
        if self.tree[id].has(Flags::HAS_MISSED) {
            let (skips, has_parts) = (
                self.skips_contents(id),
                self.tree.element(id).is_some_and(|it| it.shadow_root != 0),
            );
            let Some(missed) = self.locks.missed.get_mut(&id) else {
                return;
            };
            missed.change |=
                below & (Change::REMATCH_ALL | Change::RECASCADE_ALL | Change::DISPLAY);
            missed
                .customs
                .extend(changed_customs.into_iter().flat_map(Changed::names));
            if skips {
                if rematches && has_parts {
                    missed.change |= Change::REMATCH_ALL;
                }
                let generated = self
                    .tree
                    .element(id)
                    .filter(|_| rematches)
                    .map_or([0; 4], |it| it.generated);
                generated
                    .into_iter()
                    .filter(|it| *it != 0)
                    .for_each(|it| self.tree[it].set(Flags::REMATCH));
                return self.tree[id].set(Flags::DIRTY_DESCENDANTS);
            }
            below = core::mem::replace(&mut missed.change, Change::empty());
            let names = core::mem::take(&mut missed.customs);
            match missed.seen.take() {
                Some(seen) => {
                    if self.tree[id].has(Flags::SKIPPED) && !self.locks.wants_leaves {
                        shown = crate::lock::with_leaves_of(&seen, new);
                        new = &shown;
                    }
                    below |= inherited_change(&seen, new);
                    let differs = |it: &Name| {
                        seen.customs.inherited.get(*it) != new.customs.inherited.get(*it)
                    };
                    missed_customs = Changed::new(names.into_iter().filter(differs), None);
                    changed_customs = missed_customs.as_ref();
                }
                None => is_new = true,
            }
            missed.seen = Some(Rc::clone(new));
            if !self.tree[id].has(Flags::SKIPPED) {
                self.forget_lock(id);
            }
        }
        let visits_all =
            is_new || !(below - Change::BY_ANIMATION).is_empty() || changed_customs.is_some();
        let generated = self.tree.element(id).map_or([0; 4], |it| it.generated);
        for child in generated.into_iter().filter(|it| *it != 0) {
            let is_plain = |it: &Element| {
                it.pseudo == Pseudo::Marker && it.rules.as_ref().is_some_and(|it| it.len() == 1)
            };
            if rematches
                && !(traversal.has_plain_markers && self.tree.element(child).is_some_and(is_plain))
            {
                self.tree[child].set(Flags::REMATCH);
            }
            let below = if rematches && self.is_transition_root(child) {
                below | Change::REMATCH_ALL
            } else {
                below
            };
            if visits_all || self.tree[child].has(Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS) {
                self.restyle(child, new, below, changed_customs, traversal);
                self.drop_if_empty(id, child);
            }
        }
        if self.carousels.has(id) {
            for child in self.carousels.parts_of(id) {
                if rematches {
                    self.tree[child].set(Flags::REMATCH);
                }
                let column = self
                    .column_of(child)
                    .and_then(|it| self.tree.style(it))
                    .cloned();
                self.restyle(
                    child,
                    column.as_ref().unwrap_or(new),
                    below | Change::RECASCADE_ALL,
                    changed_customs,
                    traversal,
                );
            }
        }
        let visits_all = visits_all
            && (!(below - Change::BY_ANIMATION - Change::NOT_INHERITED).is_empty()
                || is_new
                || changed_customs.is_some()
                || self.has_base_selects
                || self.tree.element(id).is_some_and(|it| it.is_depended_on));
        if !visits_all && !flags.contains(Flags::DIRTY_DESCENDANTS) && !rematches
            || traversal.bloom.depth() > MAX_DEPTH
        {
            return;
        }
        let (node, is_text) = (&self.tree[id], |it: NodeId| {
            self.tree[it].element().is_none()
        });
        if self.tree[node.first_child].next == 0
            && is_text(node.first_child)
            && !node.has(Flags::REDIRECTS_CHILDREN)
        {
            return;
        }
        crate::recovery::need_stack();
        if visits_all && !node.has(Flags::REDIRECTS_CHILDREN) {
            let (depth, mut child) = (traversal.bloom.depth(), node.first_child);
            traversal.bloom.push(id);
            while child != 0 {
                self.restyle(child, new, below, changed_customs, traversal);
                self.note_dependence(id, child);
                child = self.tree[child].next;
            }
            return traversal.bloom.truncate(depth);
        }
        let Some(element) = node.element() else {
            return;
        };
        let has_parts = rematches && element.shadow_root != 0;
        let is_dirty = |child: &NodeId| {
            let node = &self.tree[*child];
            node.element().is_some()
                && (visits_all
                    || has_parts
                    || node.has(Flags::STYLE_DIRTY | Flags::DIRTY_DESCENDANTS))
        };
        let mut children = smallvec::SmallVec::<[NodeId; 8]>::new();
        if visits_all || rematches || dirty_child == 0 {
            self.tree
                .flat_children(id)
                .filter(is_dirty)
                .for_each(|it| children.push(it));
        } else if self.tree[dirty_child].parent != 0
            && self.tree.flat_parent(dirty_child) == id
            && is_dirty(&dirty_child)
        {
            children.push(dirty_child);
        }
        if children.is_empty() {
            return;
        }
        if has_parts
            && matches!(
                self.tree[element.shadow_root].data,
                Data::ShadowRoot {
                    user_agent: true,
                    ..
                }
            )
        {
            below |= Change::REMATCH_ALL;
        }
        let depth = traversal.bloom.depth();
        traversal.bloom.push(id);
        children.iter().take(2).for_each(|it| self.prefetch(*it));
        for (index, child) in children.iter().copied().enumerate() {
            if self.tree[child].flags.get() & Flags::STYLE_DIRTY != Flags::REANIMATE {
                children
                    .get(index + 2)
                    .into_iter()
                    .for_each(|it| self.prefetch(*it));
                children
                    .get(index + 1)
                    .into_iter()
                    .for_each(|it| self.prefetch_below(*it));
            }
            let is_slotted = self.tree[child].slot != 0;
            let below = if is_slotted {
                below - (Change::REMATCH_ALL - change)
            } else {
                below
            };
            self.restyle(child, new, below, changed_customs, traversal);
            self.note_dependence(id, child);
        }
        traversal.bloom.truncate(depth);
    }

    #[inline]
    fn note_dependence(&mut self, id: NodeId, child: NodeId) {
        if self.tree[child].has(Flags::ANIMATED)
            || self
                .tree
                .element(child)
                .and_then(|it| it.base_style.as_ref())
                .is_some_and(|it| it.deps.contains(Deps::PARENT))
        {
            self.tree
                .element_to_style(id)
                .into_iter()
                .for_each(|it| it.is_depended_on = true);
        }
    }

    fn rebuild_if_in_first_line(&mut self, id: NodeId) {
        if self.boxes.has_pinned_styles
            && self.own_box(id).is_none()
            && self.boxes[self.tree[id].layout_box]
                .inline
                .as_ref()
                .is_some_and(|it| it.first_line.is_some())
        {
            self.mark_parent_rebuild(id);
        }
    }

    fn prefetch(&self, id: NodeId) {
        let node = &self.tree[id];
        let Some(element) = node.element() else {
            return;
        };
        let it = &self.boxes[node.layout_box];
        prefetch_read(&raw const element.tag, Locality::L1);
        prefetch_read(&raw const element.attributes, Locality::L1);
        prefetch_read(&raw const it.style, Locality::L1);
        prefetch_read(&raw const self.tree[node.first_child], Locality::L1);
    }

    fn prefetch_after(&self, id: NodeId) {
        self.tree.prefetch_after(id);
        let Some(element) = self.tree.element(id + 4) else {
            return;
        };
        prefetch_read(
            &raw const self.boxes[self.tree[id + 4].layout_box].style,
            Locality::L1,
        );
        element.style.iter().for_each(prefetch_style);
        element.rules.iter().for_each(|it| prefetch_shared(it, 2));
        element
            .classes
            .iter()
            .for_each(|it| prefetch_read(&raw const it.filter, Locality::L1));
        element
            .classes
            .iter()
            .for_each(|it| prefetch_read(&raw const it.decided, Locality::L1));
    }

    /// After `prefetch`.
    fn prefetch_below(&self, id: NodeId) {
        let Some(element) = self.tree.element(id) else {
            return;
        };
        element.style.iter().for_each(prefetch_style);
        element.rules.iter().for_each(|it| prefetch_shared(it, 2));
        element
            .classes
            .iter()
            .for_each(|it| prefetch_read(&raw const it.filter, Locality::L1));
        element
            .classes
            .iter()
            .for_each(|it| prefetch_read(&raw const it.decided, Locality::L1));
        self.tree
            .children(id)
            .take(4)
            .for_each(|it| self.prefetch(it));
    }

    /// Of an element that has not changed, and neither has anything above it.
    fn restyle_descendants(&mut self, mut id: NodeId, traversal: &mut Traversal) {
        let depth = traversal.bloom.depth();
        loop {
            let (node, child) = (&self.tree[id], self.tree.dirty_child(id).get());
            if child == 0
                || self.tree.flat_parent(child) != id
                || self.tree[child].has(Flags::STYLE_DIRTY)
                || self.tree[child].parent == 0
            {
                break;
            }
            node.unset(Flags::DIRTY_DESCENDANTS);
            traversal.bloom.push(id);
            id = child;
        }
        let flags = (self.tree[id].flags.get(), self.tree.dirty_child(id).get());
        self.tree[id].unset(Flags::DIRTY_DESCENDANTS);
        if let Some(style) = self
            .tree
            .style(id)
            .filter(|it| it.display() != Display::None)
            .cloned()
        {
            self.restyle_children(
                id,
                &style,
                flags,
                Change::empty(),
                Change::empty(),
                None,
                Children {
                    is_new: false,
                    rematches: false,
                },
                traversal,
            );
        }
        traversal.bloom.truncate(depth);
    }

    /// Whether they have changed.
    fn update_root_units(&mut self, id: NodeId, style: &Rc<Style>) -> bool {
        let (layout, is_vertical) = (&style.layout, style.flow().is_vertical());
        let gutters = [ScrollbarGutter::STABLE, ScrollbarGutter::BOTH_EDGES]
            .map(|it| u8::from(layout.scrollbar_gutter.contains(it)));
        let count = |overflow, is_inline: bool| {
            u8::from(overflow == Overflow::Scroll).max(if is_inline {
                gutters[0] + gutters[1]
            } else {
                0
            })
        };
        let counts = [
            count(layout.overflow_y, !is_vertical),
            count(layout.overflow_x, is_vertical),
        ];
        let scrollbars = if counts == [0; 2]
            || self
                .pseudo_style_under(id, Pseudo::Scrollbar, Default::default(), style)
                .is_some()
        {
            [0.0; 2]
        } else {
            counts.map(|it| f32::from(it) * self.scrollbar_size(id, style))
        };
        if (style.root_units(), scrollbars) == (self.environment.root_font, self.root_scrollbars) {
            return false;
        }
        (self.environment.root_font, self.root_scrollbars) = (style.root_units(), scrollbars);
        self.environment.generation = crate::document::new_generation();
        self.styles.forget_values();
        true
    }

    fn start_animations(
        &mut self,
        id: NodeId,
        parent: &Rc<Style>,
        old: Option<&Rc<Style>>,
        new: &Style,
        change: Change,
        flags: Flags,
        traversal: &mut Traversal,
    ) {
        let is_displayed = self
            .tree
            .style(id)
            .is_some_and(|it| it.display() != Display::None);
        let is_hidden_by_animation = !is_displayed
            && self.tree[id].has(Flags::ANIMATED)
            && old.is_some_and(|it| it.display() != Display::None);
        let is_fresh = self.queries.fresh[..self.queries.laid_out]
            .binary_search(&id)
            .is_ok()
            && !self.queries.before.contains_key(&id);
        let was_rendered = (is_displayed || is_hidden_by_animation) && !is_fresh;
        let takes_time = |style: &Style| style.transition.duration.iter().any(|it| it.0 > 0.0);
        let mut before = None;
        match old.filter(|_| was_rendered) {
            _ if self.containers.is_empty() && !self.anchored.contains_key(&id) => {}
            None if is_fresh => self.take_back_transitions(id, 0),
            None => {
                self.queries.before.remove(&id);
                self.queries.fresh.push(id);
            }
            Some(_)
                if self.queries.are_settling
                    && let Some((style, last)) = self.queries.before.get(&id).cloned() =>
            {
                self.take_back_transitions(id, last);
                before = Some(style);
            }
            Some(old) if takes_time(old) || takes_time(new) => {
                _ = self
                    .queries
                    .before
                    .insert(id, (Rc::clone(old), self.animations.last_id()))
            }
            Some(_) => {}
        }
        let takes_time = takes_time(new);
        let inherited = |this: &Self| {
            if takes_time {
                this.inherited_after_transitions(id, new)
            } else {
                None
            }
        };
        let after = |this: &Self, parent: &Option<Rc<Style>>| {
            Some(this.compute_style(id, this.tree.element(id)?.rules.as_ref()?, parent.as_ref()?))
        };
        match old.filter(|_| was_rendered) {
            Some(_)
                if change.contains(Change::BY_ANIMATION)
                    && !flags.intersects(Flags::REMATCH | Flags::RECASCADE) => {}
            Some(old) => {
                let after = after(self, &inherited(self))
                    .filter(|_| !new.deps.contains(Deps::ANCHOR))
                    .map(|it| self.with_used_position(id, it));
                self.update_transitions(
                    id,
                    before.as_ref().unwrap_or(old),
                    after.as_deref().unwrap_or(new),
                    parent,
                );
            }
            None if new.display() != Display::None
                && takes_time
                && self.may_have_starting_style(id, traversal.bloom.update(&self.tree)) =>
            {
                let (rules, inherited) = (
                    self.match_rules(id, Some(traversal.bloom.update(&self.tree)), true),
                    inherited(self),
                );
                let starting = self.compute_style(id, &rules, inherited.as_ref().unwrap_or(parent));
                if starting.display() != Display::None {
                    let after =
                        after(self, &inherited).filter(|_| !new.deps.contains(Deps::ANCHOR));
                    self.update_transitions(id, &starting, after.as_deref().unwrap_or(new), parent);
                }
            }
            None => {}
        }
        let is_animated = |style: &Style| style.animation.name.iter().any(|it| it.0.is_some());
        fn others(style: &Style) -> [Option<&str>; 2] {
            [Id::AnimationComposition, Id::AnimationTrigger].map(|it| style.other_if_set(it))
        }
        let changed = match old.filter(|_| was_rendered) {
            Some(old) => {
                old.animation != new.animation
                    || others(old) != others(new)
                    || flags.contains(Flags::KEYFRAMES_CHANGED)
            }
            None => is_animated(new),
        };
        if is_hidden_by_animation && new.display() == Display::None {
            self.cancel_css_animations(id);
        } else if changed && new.display() != Display::None {
            self.update_css_animations(id, new);
        }
    }

    fn register(&mut self, id: NodeId, style: &Style, old: Option<&Rc<Style>>) {
        if !style.paint.decoration_line.is_empty() {
            let length = |it: &Option<crate::values::Lp>| {
                it.as_ref()
                    .map_or(0.0, |it| it.resolve(style.font.size.0).abs())
            };
            let reach = length(&style.paint.decoration_thickness.0) * 4.0
                + length(&style.ink.underline_offset.0);
            if reach > self.decoration_reach.max(style.font.size.0) {
                self.decoration_reach = reach;
                self.boxes.forget_all_extents();
                self.pictures.discard();
            }
        }
        if !style.is_inert() && matches!(style.rare.content, Content::Items(..))
            || !self.replacements.is_empty()
            || self
                .tree
                .element(id)
                .is_some_and(|it| it.tag == name!("img"))
        {
            self.update_replacement(id, style);
        }
        let is_unknown = || {
            let it = &self.scrolling;
            it.timeline_sources.is_empty()
                && it.states.is_empty()
                && it.initial_targets.is_empty()
                && self.carousels.is_empty()
                && !self.locks.has_remembered
        };
        if style.is_inert()
            && old.map_or_else(is_unknown, |it| it.is_inert())
            && !self.tree[id].has(Flags::SKIPPED)
        {
            debug_assert!(
                ![&self.containers, &self.anchors, &self.locks.remembering]
                    .iter()
                    .any(|it| it.contains(&id))
                    && !self.auto_visible.contains_key(&id)
            );
            return;
        }
        let names_timelines = |style: &Style| {
            !style.scroll.timeline_name.is_empty()
                || [
                    Id::ViewTimelineName,
                    Id::TimelineScope,
                    Id::TimelineTriggerName,
                ]
                .iter()
                .any(|it| style.other_if_set(*it).is_some())
        };
        if names_timelines(style) || self.scrolling.timeline_sources.contains(&id) {
            self.animations.names_are_stale = true;
            if let Some(mut declarers) = self.scrolling.declarers.take().filter(|_| old.is_none()) {
                self.add_declarer(id, &mut declarers);
                self.scrolling.declarers.replace(Some(declarers));
            }
        }
        if !self.has_depth.get() && (style.effects.perspective.0.is_some() || style.has_depth()) {
            self.has_depth.set(true);
            self.boxes.forget_all_extents();
            self.pictures.discard();
        }
        if style.effects.blend != Blend::Normal && self.outer_svg(id).is_some_and(|it| it != id) {
            self.blends_in_svg.set(true);
            self.pictures.discard();
        }
        for (set, is_member) in [
            (
                &mut self.containers,
                style
                    .layout
                    .container_type
                    .intersects(ContainerType::SIZE | ContainerType::INLINE_SIZE),
            ),
            (&mut self.anchors, !style.rare.anchor_name.is_empty()),
            (&mut self.scrolling.timeline_sources, names_timelines(style)),
        ] {
            _ = if is_member {
                set.insert(id)
            } else {
                set.remove(&id)
            };
        }
        match style
            .layout
            .container_type
            .contains(ContainerType::SCROLL_STATE)
        {
            true => _ = self.scrolling.states.entry(id).or_default(),
            false => _ = self.scrolling.states.remove(&id),
        }
        self.register_snapping(id, style);
        self.register_target_group(id, style);
        self.register_remembering(id, style);
        let (visibility, was_skipped) = (
            self.content_visibility(id, style),
            self.tree[id].has(Flags::SKIPPED),
        );
        let skips = match visibility {
            ContentVisibility::Auto if self.is_embedded => false,
            ContentVisibility::Auto if self.auto_visible.contains_key(&id) => was_skipped,
            ContentVisibility::Auto => self.auto_visible.insert(id, None).is_none(),
            _ => {
                self.auto_visible.remove(&id);
                visibility == ContentVisibility::Hidden
            }
        };
        match (was_skipped, skips) {
            (false, true) => self.lock(id, old.filter(|it| it.display() != Display::None).cloned()),
            (true, false) => self.unlock(id),
            _ => {}
        }
    }

    fn first_style(&mut self, id: NodeId, style: &Rc<Style>, is_in_new_box: bool) {
        if !self.containers.is_empty() {
            self.queries.fresh.push(id);
        }
        self.register(id, style, None);
        if self.tree.element(id).is_some_and(|it| it.id != Name::NONE) {
            self.id_changed(id);
        }
        self.only_svg_element_changed(id);
        if style.display() != Display::None && !is_in_new_box {
            self.request_box(id, style.display());
        }
        if self.tree.element(id).is_some_and(Element::is_generated) {
            let was_as_found = self.tree.is_as_found();
            self.generate_content(id, style);
            self.tree.keep_found(was_as_found);
        }
    }

    fn set_box_style(&mut self, id: NodeId, new: &Rc<Style>) {
        if let Some(own) = self.own_box(id) {
            self.matrices.forget();
            self.boxes[own].style = if self.boxes[own].parent == crate::boxes::VIEWPORT {
                self.used_style(id, new)
            } else {
                Rc::clone(new)
            };
        }
    }

    fn repaint_damage(
        &mut self,
        id: NodeId,
        [old, new]: [&Style; 2],
        damage: Damage,
        change: Change,
    ) {
        if old.display() == Display::Inline
            && old.leaves_no_trace()
            && !new.leaves_no_trace()
            && self.boxes[self.tree[id].layout_box]
                .inline
                .as_ref()
                .is_some_and(|it| it.has_text_in_place_of(id))
        {
            self.mark_parent_rebuild(id);
        }
        if self
            .tree
            .element(id)
            .is_some_and(|it| it.namespace == Namespace::Svg)
        {
            let has_only_shapes = || {
                self.own_box(id).is_none_or(|it| {
                    old.is_bare() && new.is_bare() && !self.uses_color_elsewhere(it)
                })
            };
            if (Damage::COLOR | Damage::BORDER_COLOR).contains(damage)
                && has_only_shapes()
                && self.svg_colors_changed(id)
            {
                return;
            }
            self.svg_changed(id);
        }
        if !(old.paint.decoration_line.is_empty() && new.paint.decoration_line.is_empty()) {
            return self.repaint_subtree(id);
        }
        let is_bare = || {
            (Damage::COLOR | Damage::BORDER_COLOR).contains(damage)
                && old.is_bare()
                && new.is_bare()
        };
        let Some(own) = self.own_box(id).filter(|it| match self.boxes[*it].kind {
            Kind::Block | Kind::Flex | Kind::Grid => true,
            Kind::Table | Kind::RowGroup | Kind::Row => {
                is_bare() && new.text.border_collapse != BorderCollapse::Collapse
            }
            Kind::Replaced => damage == Damage::OPACITY,
            _ => false,
        }) else {
            return self.repaint(id);
        };
        if !self.boxes[own].has_anonymous_children && is_bare() && !self.uses_color_elsewhere(own) {
        } else if (Damage::LOOKS - Damage::PAINT).contains(damage) {
            let mut what = Retouch::empty();
            what.set(
                Retouch::DECORATIONS,
                damage.contains(Damage::BOX)
                    || damage.contains(Damage::COLOR) && !(old.is_bare() && new.is_bare()),
            );
            what.set(Retouch::OPACITY, damage.contains(Damage::OPACITY));
            what.set(Retouch::COLOR, damage.contains(Damage::COLOR));
            self.retouch(own, what);
        } else if (Damage::LOOKS | Damage::INK).contains(damage)
            && !damage.contains(Damage::PAINT)
            && !(change.contains(Change::INHERITED) && self.boxes[own].has_anonymous_children)
        {
            self.repaint_box(own);
        } else {
            self.repaint(id);
        }
    }

    /// Returns what the children have to know.
    fn apply_damage(
        &mut self,
        id: NodeId,
        old: &Rc<Style>,
        new: &Rc<Style>,
        is_shown: bool,
        traversal: &mut Traversal,
    ) -> Change {
        let difference = traversal.difference(old, new);
        self.set_box_style(id, new);
        self.apply_difference(id, old, new, difference, is_shown)
    }

    /// `old` is `new` if that was amended.
    fn apply_difference(
        &mut self,
        id: NodeId,
        old: &Rc<Style>,
        new: &Rc<Style>,
        difference: Difference,
        is_shown: bool,
    ) -> Change {
        let Difference {
            mut total,
            mut change,
            moves,
            ..
        } = difference;
        if difference.repositions {
            self.scrolling.repositioned.insert(id);
        }
        if difference.changes_container {
            let (has_new_answers, is_resized) = (true, true);
            self.mark_in_container(id, has_new_answers, is_resized);
        }
        if difference.leaves_or_joins_flow {
            self.suppress_scroll_anchoring_around(id);
        }
        if difference.resizes
            && self
                .tree
                .element(id)
                .is_some_and(|it| it.tag == name!("input"))
        {
            change |= Change::RECASCADE_ALL;
        }
        let own = self.own_box(id);
        if total.is_empty() || is_shown {
            return change;
        }
        let can_turn = difference.only_turns
            && ((Damage::LOOKS - Damage::PAINT) | Damage::INK).contains(total)
            && self.accessibility.is_none();
        let turned = own.filter(|_| {
            can_turn
                && !self.has_depth.get()
                && !new.has_depth()
                && self
                    .tree
                    .element(id)
                    .is_some_and(|it| it.namespace != Namespace::Svg)
        });
        if turned.is_none() || total != Damage::INK {
            self.repaint_damage(
                id,
                [old, new],
                if turned.is_some() {
                    total - Damage::INK
                } else {
                    total
                },
                difference.change,
            );
        }
        turned
            .into_iter()
            .for_each(|it| self.retouch(it, Retouch::TRANSFORM));
        self.register(id, new, Some(old));
        if self
            .tree
            .element(id)
            .is_none_or(|it| it.namespace != Namespace::Svg)
        {
            self.svg_changed(id);
        }
        if old.display() != new.display() && !self.carousels.is_empty() {
            self.display_of_group_changed(id);
        }
        self.counters_are_stale |= total.contains(Damage::COUNTERS);
        if total.contains(Damage::COUNTERS)
            && (new.display().is_list_item()
                || !old.rare.counter_reset.is_empty()
                || !new.rare.counter_reset.is_empty())
        {
            total |= Damage::PARENT | Damage::CONTENTS;
        }
        self.needs_layout |= self.counters_are_stale && !self.counter_users.is_empty();
        if total.contains(Damage::GENERATED)
            && self.tree.element(id).is_some_and(Element::is_generated)
        {
            self.generate_content(id, new);
        }
        let first_child = own
            .filter(|_| self.boxes.has_pinned_styles)
            .and_then(|it| self.boxes.all_children(it).first().copied());
        let has_pinned_styles = |it: &u32| {
            self.boxes[*it].inline.as_ref().is_some_and(|it| {
                it.first_line.is_some()
                    || it
                        .items
                        .iter()
                        .take(4)
                        .any(|it| it.has_own_style || it.node == 0)
            })
        };
        match own {
            Some(_) if first_child.as_ref().is_some_and(has_pinned_styles) => {
                total |= Damage::CONTENTS
            }
            None if self.boxes.has_pinned_styles
                && has_pinned_styles(&self.tree[id].layout_box) =>
            {
                total |= Damage::CONTENTS
            }
            _ => {}
        }
        let Some(own) = own else {
            use crate::inline::is_layer;
            if !self.boxes.split.is_empty() && self.boxes.split.contains(&id) {
                let block = self.boxes[self.tree[id].layout_box].parent;
                self.boxes[block]
                    .children
                    .iter()
                    .for_each(|it| self.boxes[*it].forget_extents());
                self.boxes.mark_ink(block);
            }
            if old.display() == Display::None
                && self.tree[id].layout_box == 0
                && self.tree[id].parent != DOCUMENT
            {
                if new.display() != Display::None {
                    self.request_box(id, new.display());
                }
            } else if total.intersects(!(Damage::LOOKS | Damage::INK | Damage::COUNTERS))
                || is_layer(old) != is_layer(new)
            {
                self.mark_parent_rebuild(id);
            } else if total.contains(Damage::INK) && !moves {
                self.boxes.mark_ink_in_place(self.tree[id].layout_box);
            } else if total.contains(Damage::INK) {
                self.boxes.mark_ink(self.tree[id].layout_box);
            }
            return change;
        };
        if new.display() == Display::None {
            self.note_hiding(id, old);
            return change;
        }
        let is_embedded = self.boxes[self.boxes[own].parent].kind == Kind::Lines;
        if total.contains(Damage::PARENT)
            || is_embedded && total.intersects(Damage::LAYOUT | Damage::CONTENTS)
        {
            self.mark_parent_rebuild(id);
        }
        if total.contains(Damage::CONTENTS) {
            self.mark_rebuild(id);
        }
        if total.intersects(Damage::LAYOUT | Damage::PARENT) {
            self.relayout_with(
                id,
                difference.only_resizes && !total.intersects(Damage::PARENT | Damage::CONTENTS),
            );
        } else if total.contains(Damage::BORDER_COLOR)
            && new.text.border_collapse == BorderCollapse::Collapse
            && (self.boxes[own].collapsed.is_some()
                || matches!(
                    self.boxes[own].kind,
                    Kind::Row | Kind::RowGroup | Kind::Column
                ))
        {
            self.boxes.mark_layout(own);
            self.needs_layout = true;
        }
        if turned.is_some()
            || total - (Damage::BOX | Damage::OPACITY) == Damage::INK && Rc::ptr_eq(old, new)
        {
            self.boxes.mark_moved(own, turned.is_none());
        } else if total.contains(Damage::INK) {
            if !Rc::ptr_eq(&old.ink, &new.ink) {
                self.boxes.mark_ink_of_text(own);
            }
            if moves {
                self.boxes.mark_ink(own)
            } else {
                self.boxes.mark_ink_in_place(own)
            }
        }
        if total.contains(Damage::INK) && moves {
            self.layout_version += 1;
            self.sizes_version += u32::from(
                self.tree
                    .element(id)
                    .is_some_and(|it| it.namespace == crate::tree::Namespace::Svg),
            );
            self.needs_layout |= !self.anchored.is_empty();
            if old.has_transform() || new.has_transform() {
                self.moved_boxes.push(id);
            }
        }
        change
    }

    /// Whether other rules of the user agent apply now.
    fn update_base_select(&mut self, id: NodeId, style: &Style) -> bool {
        let Some(element) = self.tree.element(id) else {
            return false;
        };
        let is_base = style.layout.appearance == Appearance::BaseSelect;
        let (select, flags) = if element.html_tag() == name!("select") {
            let kept = self.tree[id].flags.get() & Flags::BASE_OPTIONS;
            let options = if Look::of(element) == Look::ListBox {
                Flags::BASE_OPTIONS
            } else {
                kept
            };
            (
                id,
                if is_base {
                    Flags::BASE_SELECT | options
                } else {
                    Flags::empty()
                },
            )
        } else if element.pseudo == Pseudo::Part(name!("picker(select)"))
            && self.tree[element.originator].has(Flags::BASE_SELECT)
        {
            (
                element.originator,
                if is_base { BASE } else { Flags::BASE_SELECT },
            )
        } else {
            return false;
        };
        let has_changed = self.tree[select].flags.get() & BASE != flags;
        self.has_base_selects |= is_base;
        self.tree[select].unset(BASE);
        self.tree[select].set(flags);
        has_changed
    }

    fn generated_in_base_select(&self, id: NodeId, element: &Element) -> Option<Pseudo> {
        let tag = element.html_tag();
        if tag == name!("select") {
            return (self.tree[id].has(Flags::BASE_SELECT) && Look::of(element) != Look::ListBox)
                .then_some(Pseudo::Part(name!("picker-icon")));
        }
        let select = self
            .tree
            .flat_ancestors(id)
            .take_while(|_| tag == name!("option"))
            .find(|it| self.tree.html_tag(*it) == name!("select"))?;
        self.tree[select]
            .has(Flags::BASE_OPTIONS)
            .then_some(Pseudo::Part(name!("checkmark")))
    }

    fn update_scrollbar_style(&mut self, id: NodeId) {
        if let Some(own) = self.own_box(id).filter(|it| self.boxes[*it].scrolls()) {
            self.repaint_box(own);
            let it = &self.boxes[own];
            if it.overflow != [Overflow::Hidden; 2]
                && self.scrollbar_size(id, &it.style) != it.scrollbar_size
            {
                self.relayout(id);
            }
        }
    }

    fn update_generated(
        &mut self,
        id: NodeId,
        style: &Style,
        matches_the_same: bool,
        traversal: &mut Traversal,
    ) {
        if traversal.styles_first_lines && !matches_the_same {
            self.update_first_line(id);
        }
        let Some(element) = self.tree.element(id).filter(|it| !it.is_generated()) else {
            return;
        };
        let (generated, tag) = (element.generated, element.html_tag());
        let has_contents = element.namespace != Namespace::Svg
            && !style.display().is_math()
            && !crate::name::is_name!(
                tag,
                "img" | "canvas" | "video" | "iframe" | "textarea" | "br" | "wbr"
            )
            && (tag != name!("select") || self.tree[id].has(Flags::BASE_SELECT))
            && (tag != name!("input") || !element.is_text_field());
        let known = element.generated_by_rules.filter(|_| matches_the_same);
        let by_rules = has_contents.then(|| {
            known.unwrap_or_else(|| {
                self.generated_by_rules(id, Some(traversal.bloom.update(&self.tree)))
            })
        });
        self.tree
            .element_to_style(id)
            .into_iter()
            .for_each(|it| it.generated_by_rules = by_rules);
        let by_rules = by_rules.unwrap_or(0);
        if by_rules >= crate::carousel::MARKER_RULES
            || self.carousels.has(id)
            || style.other_if_set(Id::ScrollMarkerGroup).is_some()
        {
            self.update_scroll_parts(id, style, by_rules);
        }
        if by_rules == 0
            && generated == [0; 4]
            && !style.display().is_list_item()
            && !self.has_base_selects
            && !self.tree[id].has(Flags::TOP_LAYER)
        {
            return;
        }
        let Some(element) = self.tree.element(id) else {
            return;
        };
        let generates = |index: usize| by_rules >> index & 1 != 0;
        let has_marker = style.display().is_list_item()
            && tag != name!("fieldset")
            && (style.text.list_type != ListStyleType::None
                || style.text.list_image.0.is_some()
                || generates(MARKER));
        let part = if self.has_base_selects {
            self.generated_in_base_select(id, element)
        } else {
            None
        };
        let is_pop_up_of_control =
            matches!(element.pseudo, Pseudo::Part(it) if it != name!("picker(select)"));
        let has_backdrop = self.tree[id].has(Flags::TOP_LAYER) && !is_pop_up_of_control;
        let mut generated = generated;
        if self.has_base_selects
            && self
                .tree
                .element(generated[MARKER])
                .is_some_and(|it| it.pseudo != part.unwrap_or(Pseudo::Marker))
        {
            self.drop_generated(id, core::mem::take(&mut generated[MARKER]));
        }
        let wanted = [
            (
                MARKER,
                part.unwrap_or(Pseudo::Marker),
                has_marker || part.is_some(),
            ),
            (BEFORE, Pseudo::Before, generates(BEFORE)),
            (AFTER, Pseudo::After, generates(AFTER)),
            (
                BACKDROP,
                Pseudo::Backdrop,
                has_backdrop || self.is_transition_root(generated[BACKDROP]),
            ),
        ];
        for (index, pseudo, is_wanted) in wanted {
            if is_wanted && generated[index] == 0 {
                let was_as_found = self.tree.is_as_found();
                let new = self.create_element(crate::api::core::Atom::EMPTY, Namespace::Html, None);
                self.tree[new].scope = self.tree[id].scope;
                self.tree.keep_found(was_as_found);
                self.tree
                    .element_to_style(id)
                    .into_iter()
                    .for_each(|it| it.generated[index] = new);
                self.tree
                    .element_to_style(new)
                    .into_iter()
                    .for_each(|it| it.set_pseudo(pseudo, id));
                self.tree[new].set(Flags::REMATCH);
                self.pseudo_element_created(id, pseudo, new);
            } else if !is_wanted && generated[index] != 0 {
                self.drop_generated(id, generated[index]);
            }
        }
    }

    fn drop_generated(&mut self, id: NodeId, generated: NodeId) {
        self.mark_rebuild(id);
        self.counters_are_stale = true;
        self.free_subtree(generated);
        let slots = self
            .tree
            .element_to_style(id)
            .into_iter()
            .flat_map(|it| &mut it.generated);
        slots.filter(|it| **it == generated).for_each(|it| *it = 0);
    }

    fn drop_if_empty(&mut self, id: NodeId, generated: NodeId) {
        let Some(element) = self.tree.element(generated) else {
            return;
        };
        let is_empty = element.style.as_ref().is_some_and(|style| {
            match (&style.rare.content, element.pseudo) {
                (_, Pseudo::Backdrop | Pseudo::Transition(..)) | (Content::Items(..), _) => false,
                (Content::Normal, Pseudo::Marker) => {
                    style.text.list_type == ListStyleType::None && style.text.list_image.0.is_none()
                }
                _ => true,
            }
        });
        if is_empty {
            self.drop_generated(id, generated);
        }
    }
}
