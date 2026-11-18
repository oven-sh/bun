use std::cell::{Cell, RefCell};
use std::cmp::Ordering;

use super::element::{Element, GONE, objects, perform};
use super::properties::culture;
use crate::abi::accessibility::{self as abi, Action, Number, Role, Text};
use crate::accessibility::forest::Node;
use crate::accessibility::text::{Block, Position, Unit};
use crate::accessibility::{self, Forest, Id, read};
use crate::host::system::callback;
use crate::win32::com::{
    Array, BasicString, Borrowed, Object, Out, Outcome, Status, Unknown, VT_I4, VT_UNKNOWN,
    Variant, class, made,
};
use crate::win32::*;

pub struct Range {
    window: u32,
    /// It does not leave it.
    holder: Id,
    ends: Cell<[Position; 2]>,
    /// What the start was in, for when it is removed.
    trail: RefCell<Vec<Id>>,
}

type Found = Out<Option<Unknown>>;

class! { Range {
    0 [IID_I_TEXT_RANGE_PROVIDER, IID_I_TEXT_RANGE_PROVIDER2] {
        copy(it: Found),
        equals(other: Borrowed, it: Out<Bool>),
        compare_ends(end: i32, other: Borrowed, other_end: i32, it: Out<i32>),
        expand(unit: i32),
        find_attribute(attribute: i32, value: &Variant, is_backwards: Bool, it: Found),
        find_text(text: Str, is_backwards: Bool, ignores_case: Bool, it: Found),
        attribute(attribute: i32, it: Out<Variant>),
        bounds(it: Out<Array>),
        enclosing_element(it: Found),
        text(limit: i32, it: Out<BasicString>),
        shift(unit: i32, count: i32, moved: Out<i32>),
        shift_end(end: i32, unit: i32, count: i32, moved: Out<i32>),
        shift_end_to(end: i32, other: Borrowed, other_end: i32),
        select(),
        _(),
        _(),
        scroll_into_view(aligns_to_top: Bool),
        children(it: Out<Array>),
        show_context_menu(),
    }
} }

/// There are no pages, and then the next larger one counts.
fn unit_of(unit: i32) -> Option<Unit> {
    [
        Unit::Character,
        Unit::Style,
        Unit::Word,
        Unit::Line,
        Unit::Paragraph,
    ]
    .get(unit as usize)
    .copied()
}

fn compare(forest: &Forest, a: Position, b: Position) -> Ordering {
    forest.compare_positions(forest.normalized(a, false), forest.normalized(b, false))
}

fn pieces(forest: &Forest, ends: [Position; 2]) -> Vec<(Id, std::ops::Range<usize>)> {
    let (Block { leaves, .. }, range) = forest.between(ends);
    let inside = leaves.into_iter().map(|(id, own)| {
        (
            id,
            range.start.clamp(own.start, own.end) - own.start
                ..range.end.clamp(own.start, own.end) - own.start,
        )
    });
    let pieces: Vec<_> = inside.filter(|it| !it.1.is_empty()).collect();
    if pieces.is_empty() {
        vec![(ends[0].node, ends[0].offset..ends[0].offset)]
    } else {
        pieces
    }
}

fn style_of(forest: &Forest, id: Id) -> i32 {
    let styled = forest
        .closest(id, |it| {
            matches!(
                it.role,
                Role::Heading | Role::Blockquote | Role::Mark | Role::ListItem
            )
        })
        .and_then(|it| forest.get(it));
    match styled.map(|it| (it.role, it.number(Number::Level).unwrap_or(1.) as i32)) {
        Some((Role::Heading, level)) => STYLE_ID_HEADING1 + level.clamp(1, 9) - 1,
        Some((Role::Blockquote, _)) => STYLE_ID_QUOTE,
        Some((Role::Mark, _)) => STYLE_ID_CUSTOM,
        Some(_) => STYLE_ID_BULLETED_LIST,
        None => STYLE_ID_NORMAL,
    }
}

fn attribute_of(forest: &Forest, id: Id, attribute: i32) -> Option<Variant> {
    let node = forest.get(id)?;
    let is_in = |role| forest.closest(id, |it| it.role == role).is_some();
    Some(match attribute {
        UIA_CULTURE_ATTRIBUTE_ID => culture(forest, id)?.into(),
        UIA_FONT_NAME_ATTRIBUTE_ID => node.text(Text::FontFamily)?.into(),
        UIA_FONT_SIZE_ATTRIBUTE_ID => (node.number(Number::FontSize)? * 0.75).into(),
        UIA_FONT_WEIGHT_ATTRIBUTE_ID => if node.has(abi::BOLD) { 700 } else { 400 }.into(),
        UIA_FOREGROUND_COLOR_ATTRIBUTE_ID => {
            (((node.number(Number::Color)? as u32).swap_bytes() & 0xFF_FFFF) as i32).into()
        }
        UIA_IS_HIDDEN_ATTRIBUTE_ID => false.into(),
        UIA_IS_ITALIC_ATTRIBUTE_ID => node.has(abi::ITALIC).into(),
        UIA_IS_READ_ONLY_ATTRIBUTE_ID => forest
            .closest(id, |it| it.has(abi::TEXT_FIELD))
            .and_then(|it| forest.get(it))
            .is_none_or(|it| it.has(abi::READ_ONLY | abi::DISABLED))
            .into(),
        UIA_IS_SUBSCRIPT_ATTRIBUTE_ID => is_in(Role::Subscript).into(),
        UIA_IS_SUPERSCRIPT_ATTRIBUTE_ID => is_in(Role::Superscript).into(),
        UIA_STRIKETHROUGH_STYLE_ATTRIBUTE_ID => i32::from(node.has(abi::STRUCK)).into(),
        UIA_STYLE_ID_ATTRIBUTE_ID => style_of(forest, id).into(),
        UIA_STYLE_NAME_ATTRIBUTE_ID => if is_in(Role::Mark) { "mark" } else { "" }.into(),
        UIA_UNDERLINE_STYLE_ATTRIBUTE_ID => i32::from(node.has(abi::UNDERLINED)).into(),
        _ => return None,
    })
}

fn annotations(forest: &Forest, ends: [Position; 2]) -> Variant {
    let (mut found, pieces) = (Vec::new(), pieces(forest, ends));
    let is_misspelled = |(id, part): &(Id, std::ops::Range<usize>)| {
        forest.get(*id).is_some_and(|it| {
            it.misspelled.iter().any(|it| {
                (it[0] as usize) < part.end.max(part.start + 1) && it[1] as usize > part.start
            })
        })
    };
    let is_in = |role| {
        pieces
            .iter()
            .any(|it| forest.closest(it.0, |it| it.role == role).is_some())
    };
    found.extend(
        pieces
            .iter()
            .any(is_misspelled)
            .then_some(ANNOTATION_TYPE_SPELLING_ERROR),
    );
    found.extend(is_in(Role::Mark).then_some(ANNOTATION_TYPE_HIGHLIGHTED));
    found.extend(is_in(Role::Comment).then_some(ANNOTATION_TYPE_COMMENT));
    if found.is_empty() {
        Variant::default()
    } else {
        Variant::array(VT_I4, Array::of_integers(&found))
    }
}

impl Range {
    pub fn create(forest: &Forest, window: u32, holder: Id, ends: [Position; 2]) -> Unknown {
        let range = Range {
            window,
            holder,
            ends: Cell::default(),
            trail: RefCell::default(),
        };
        range.set(forest, ends);
        Object::create(range)
    }

    fn part(&self, forest: &Forest, ends: [Position; 2]) -> Unknown {
        Range::create(forest, self.window, self.holder, ends)
    }

    fn set(&self, forest: &Forest, ends: [Position; 2]) {
        if self.ends.replace(ends)[0].node != ends[0].node {
            self.trail.replace(forest.ancestors(ends[0].node).collect());
        }
    }

    fn ask<T>(&self, question: impl FnOnce(&Forest, [Position; 2]) -> T) -> Outcome<T> {
        accessibility::note_use();
        read(|forest| Ok(question(forest, self.ends(forest)?)))
    }

    fn ends(&self, forest: &Forest) -> Outcome<[Position; 2]> {
        forest.get(self.holder).ok_or(GONE)?;
        let [start, end] = self.ends.get().map(|it| forest.validated(it));
        let start = start.unwrap_or_else(|| {
            forest.start_of(
                self.trail
                    .borrow()
                    .iter()
                    .copied()
                    .find(|it| forest.get(*it).is_some())
                    .unwrap_or(self.holder),
            )
        });
        Ok([start, end.unwrap_or(start)])
    }

    /// In the nodes that have its first and its last character.
    fn tight(&self, forest: &Forest, [start, end]: [Position; 2]) -> [Position; 2] {
        let inside = |it: Position, otherwise| {
            if forest.contains(self.holder, it.node) {
                it
            } else {
                otherwise
            }
        };
        match compare(forest, start, end).is_eq() {
            true => [start; 2],
            false => [
                inside(forest.normalized(start, false), start),
                inside(forest.normalized(end, true), end),
            ],
        }
    }

    fn end_of(other: &Borrowed, end: i32) -> Outcome<Position> {
        let other = other
            .get()
            .ok()
            .and_then(Object::<Range>::behind)
            .ok_or(Status::INVALID_ARGUMENT)?;
        other.ask(|_, ends| ends[usize::from(end != 0)])
    }

    /// The start of another unit, or else the edge. Nothing if it is there.
    fn step(
        &self,
        forest: &Forest,
        from: Position,
        unit: Option<Unit>,
        is_next: bool,
    ) -> Option<Position> {
        let (edge, way) = if is_next {
            (forest.end_of(self.holder), Ordering::Less)
        } else {
            (forest.start_of(self.holder), Ordering::Greater)
        };
        let found = || {
            unit.and_then(|it| {
                if is_next {
                    forest.start_after(from, it)
                } else {
                    forest.start_before(from, it, false)
                }
            })
        };
        (compare(forest, from, edge) == way).then(|| {
            found()
                .filter(|it| compare(forest, *it, edge) == way)
                .unwrap_or(edge)
        })
    }

    fn start_of_unit(&self, forest: &Forest, at: Position, unit: Option<Unit>) -> Position {
        let edge = forest.start_of(self.holder);
        unit.and_then(|it| forest.start_before(at, it, true))
            .filter(|it| compare(forest, *it, edge).is_gt())
            .unwrap_or(edge)
    }

    fn unit_from(&self, forest: &Forest, start: Position, unit: Option<Unit>) -> [Position; 2] {
        let end = self.step(forest, start, unit, true).unwrap_or(start);
        let has_break = matches!(unit, None | Some(Unit::Character | Unit::Paragraph));
        [
            start,
            forest
                .before_break(end)
                .filter(|it| !has_break && compare(forest, *it, start).is_gt())
                .unwrap_or(end),
        ]
    }

    /// With the number of steps that it took.
    fn steps(
        &self,
        forest: &Forest,
        mut at: Position,
        unit: Option<Unit>,
        count: i32,
        may_end: bool,
    ) -> (Position, i32) {
        let (mut moved, last) = (0, forest.end_of(self.holder));
        while moved != count
            && let Some(next) = self
                .step(forest, at, unit, count > 0)
                .filter(|it| may_end || compare(forest, *it, last).is_lt())
        {
            (at, moved) = (next, moved + count.signum());
        }
        (at, moved)
    }

    fn set_end(&self, forest: &Forest, [start, end]: [Position; 2], which: i32, to: Position) {
        let ends = if which == 0 { [to, end] } else { [start, to] };
        self.set(
            forest,
            if compare(forest, ends[0], ends[1]).is_gt() {
                [to; 2]
            } else {
                ends
            },
        );
    }

    fn copy(&self, it: Found) -> Outcome {
        it.answer(self.ask(|forest, ends| Some(self.part(forest, ends))))
    }

    fn equals(&self, other: Borrowed, it: Out<Bool>) -> Outcome {
        let others =
            Self::end_of(&other, 0).and_then(|start| Ok([start, Self::end_of(&other, 1)?]));
        it.answer(others.and_then(|others| {
            self.ask(|forest, ends| {
                ends.into_iter()
                    .zip(others)
                    .all(|it| compare(forest, it.0, it.1).is_eq())
                    .into()
            })
        }))
    }

    fn compare_ends(&self, end: i32, other: Borrowed, other_end: i32, it: Out<i32>) -> Outcome {
        it.answer(Self::end_of(&other, other_end).and_then(|other| {
            self.ask(|forest, ends| compare(forest, ends[usize::from(end != 0)], other) as i32)
        }))
    }

    fn expand(&self, unit: i32) -> Outcome {
        self.ask(|forest, [start, _]| {
            let unit = unit_of(unit);
            self.set(
                forest,
                self.unit_from(forest, self.start_of_unit(forest, start, unit), unit),
            );
        })
    }

    fn shift(&self, unit: i32, count: i32, moved: Out<i32>) -> Outcome {
        moved.answer(self.ask(|forest, [start, end]| {
            let (unit, is_empty) = (unit_of(unit), compare(forest, start, end).is_eq());
            let from = if is_empty {
                start
            } else {
                self.start_of_unit(forest, start, unit)
            };
            let (to, moved) = self.steps(forest, from, unit, count, is_empty);
            if moved != 0 {
                self.set(
                    forest,
                    if is_empty {
                        [to; 2]
                    } else {
                        self.unit_from(forest, to, unit)
                    },
                );
            }
            moved
        }))
    }

    fn shift_end(&self, end: i32, unit: i32, count: i32, moved: Out<i32>) -> Outcome {
        moved.answer(self.ask(|forest, ends| {
            let (to, moved) = self.steps(
                forest,
                ends[usize::from(end != 0)],
                unit_of(unit),
                count,
                true,
            );
            self.set_end(forest, ends, end, to);
            moved
        }))
    }

    fn shift_end_to(&self, end: i32, other: Borrowed, other_end: i32) -> Outcome {
        let to = Self::end_of(&other, other_end)?;
        self.ask(|forest, ends| self.set_end(forest, ends, end, to))
    }

    fn find_attribute(
        &self,
        attribute: i32,
        value: &Variant,
        is_backwards: Bool,
        it: Found,
    ) -> Outcome {
        it.answer(self.ask(|forest, ends| {
            let (mut all, has_it) = (pieces(forest, ends), |id| {
                attribute_of(forest, id, attribute).is_some_and(|it| it.is_like(value))
            });
            if is_backwards != 0 {
                all.reverse();
            }
            let found: Vec<_> = all
                .into_iter()
                .skip_while(|it| !has_it(it.0))
                .take_while(|it| has_it(it.0))
                .collect();
            let [first, last] = if is_backwards != 0 {
                [found.last()?, found.first()?]
            } else {
                [found.first()?, found.last()?]
            };
            let at = |node, offset, is_upstream| Position {
                node,
                offset,
                is_upstream,
            };
            Some(self.part(
                forest,
                [
                    at(first.0, first.1.start, false),
                    at(last.0, last.1.end, true),
                ],
            ))
        }))
    }

    fn find_text(&self, text: Str, is_backwards: Bool, ignores_case: Bool, it: Found) -> Outcome {
        let fold = |it: char| {
            if ignores_case != 0 {
                it.to_lowercase().next().unwrap_or(it)
            } else {
                it
            }
        };
        let wanted: Vec<_> = text.text().chars().map(fold).collect();
        it.answer(self.ask(|forest, ends| {
            let (block, range) = forest.between(ends);
            let all: Vec<_> = block.text[range.clone()]
                .char_indices()
                .map(|it| (range.start + it.0, fold(it.1)))
                .collect();
            let mut found = all
                .windows(wanted.len().max(1))
                .enumerate()
                .filter(|it| it.1.iter().map(|it| &it.1).eq(&wanted));
            let (index, _) = if is_backwards != 0 {
                found.next_back()
            } else {
                found.next()
            }?;
            let end = all.get(index + wanted.len()).map_or(range.end, |it| it.0);
            Some(self.part(
                forest,
                [
                    block.position(all[index].0, false)?,
                    block.position(end, true)?,
                ],
            ))
        }))
    }

    fn attribute(&self, attribute: i32, it: Out<Variant>) -> Outcome {
        it.answer(self.ask(|forest, ends| {
            if attribute == UIA_ANNOTATION_TYPES_ATTRIBUTE_ID {
                return annotations(forest, ends);
            }
            let mut all = pieces(forest, ends)
                .into_iter()
                .filter_map(|it| attribute_of(forest, it.0, attribute));
            let reserved = match all.next() {
                Some(first) if all.all(|it| it.is_like(&first)) => return first,
                Some(_) => uia_mixed_attribute,
                None => uia_not_supported,
            };
            made(reserved)
                .map(|it| Variant::object(VT_UNKNOWN, it))
                .unwrap_or_default()
        }))
    }

    fn bounds(&self, it: Out<Array>) -> Outcome {
        it.answer(self.ask(|forest, ends| {
            let (block, range) = forest.between(ends);
            let rects = if range.is_empty() {
                forest
                    .bounds_of_text(&block, range, ends[0].is_upstream)
                    .into_iter()
                    .collect()
            } else {
                forest.rects_between(ends)
            };
            Array::of_numbers(
                &rects
                    .into_iter()
                    .flat_map(|it| Element::on_screen(self.window, it))
                    .collect::<Vec<_>>(),
            )
        }))
    }

    fn encloser(&self, forest: &Forest, ends: [Position; 2]) -> Option<Id> {
        let [start, end] = self.tight(forest, ends);
        let common = std::iter::once(start.node)
            .chain(forest.ancestors(start.node))
            .find(|it| forest.contains(*it, end.node))?;
        let speaks_for_text =
            |it: &Node| !it.is_text() && it.has(abi::NAMED_BY_CONTENT | abi::TEXT_FIELD);
        Some(
            forest.exposed(
                forest
                    .get(common)
                    .filter(|it| it.is_text())
                    .and_then(|_| forest.closest(common, speaks_for_text))
                    .unwrap_or(common),
            ),
        )
    }

    fn enclosing_element(&self, it: Found) -> Outcome {
        it.answer(
            self.ask(|forest, ends| {
                Some(Element::of(forest, self.encloser(forest, ends)?)?.object())
            }),
        )
    }

    fn children(&self, it: Out<Array>) -> Outcome {
        it.answer(self.ask(|forest, [start, end]| {
            let all = self
                .encloser(forest, [start, end])
                .map(|it| forest.exposed_children(it))
                .unwrap_or_default();
            objects(
                forest,
                all.into_iter().filter(|it| {
                    compare(forest, forest.end_of(*it), start).is_gt()
                        && compare(forest, forest.start_of(*it), end).is_lt()
                }),
            )
        }))
    }

    fn text(&self, limit: i32, it: Out<BasicString>) -> Outcome {
        it.answer(self.ask(|forest, ends| {
            let (block, range) = forest.between(ends);
            BasicString::of(
                &block.text[range]
                    .encode_utf16()
                    .take(limit as usize)
                    .collect::<Vec<_>>(),
            )
        }))
    }

    fn select(&self) -> Outcome {
        let ends = self.ask(|forest, ends| self.tight(forest, ends))?;
        callback((), || accessibility::select_text(ends));
        Ok(())
    }

    fn scroll_into_view(&self, aligns_to_top: Bool) -> Outcome {
        perform(
            self.ask(|forest, ends| {
                self.tight(forest, ends)[usize::from(aligns_to_top == 0)].node
            })?,
            Action::ScrollIntoView,
            "",
        )
    }

    fn show_context_menu(&self) -> Outcome {
        perform(
            self.ask(|forest, ends| self.encloser(forest, ends))?
                .unwrap_or(self.holder),
            Action::ShowContextMenu,
            "",
        )
    }
}
