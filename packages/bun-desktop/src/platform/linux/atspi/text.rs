//! `Text`, `EditableText`, `Hypertext` and `Hyperlink`. Offsets count characters.

use std::ops::Range;

use super::objects::{Call, rectangle};
use super::{Object, Value};
use crate::abi::accessibility::{self as abi, Action, Number, Role, Text};
use crate::accessibility::forest::Node;
use crate::accessibility::text::{Block, Unit};
use crate::accessibility::{perform, select_text};

type Style = Vec<(&'static str, String)>;

fn to_bytes(text: &str, offset: i64) -> usize {
    usize::try_from(offset)
        .ok()
        .and_then(|it| text.char_indices().nth(it))
        .map_or(text.len(), |it| it.0)
}

fn characters(text: &str, offset: usize) -> Value {
    Value::I32(text[..offset].chars().count() as i32)
}

fn ends(block: &Block, range: &Range<usize>) -> [Value; 2] {
    [
        characters(&block.text, range.start),
        characters(&block.text, range.end),
    ]
}

impl Call<'_> {
    fn range(&self, block: &Block, first: usize) -> Range<usize> {
        let start = to_bytes(&block.text, self.number(first).max(0));
        start..to_bytes(&block.text, self.number(first + 1)).max(start)
    }

    fn selected(&self, block: &Block) -> Option<Range<usize>> {
        let forest = self.forest;
        let [start, end] = forest.ordered(forest.selection(self.id.tree)?);
        let is_inside = forest
            .compare_positions(start, forest.end_of(self.id))
            .is_lt()
            && forest
                .compare_positions(end, forest.start_of(self.id))
                .is_gt();
        let range = forest.offset_in_hypertext(block, start, false).unwrap_or(0)
            ..forest
                .offset_in_hypertext(block, end, true)
                .unwrap_or(block.text.len());
        (is_inside && start != end && !range.is_empty()).then_some(range)
    }

    fn caret(&self, block: &Block) -> Value {
        let caret = self
            .forest
            .selection(self.id.tree)
            .map(|it| it[1])
            .filter(|it| self.forest.contains(self.id, it.node));
        caret.map_or(Value::I32(-1), |it| {
            characters(
                &block.text,
                self.forest
                    .offset_in_hypertext(block, it, false)
                    .unwrap_or(0),
            )
        })
    }

    fn select(&mut self, block: &Block, range: Range<usize>) -> Value {
        let at = |offset, is_end| {
            self.forest
                .position_in_hypertext(block, offset, is_end)
                .unwrap_or_else(|| self.forest.start_of(self.id))
        };
        let ends = [at(range.start, false), at(range.end, !range.is_empty())];
        let forest = self.forest;
        let focus = forest
            .place_of(self.id.tree)
            .and_then(|it| forest.real_focus(it.0))
            .filter(|it| !forest.contains(*it, ends[1].node));
        let focusable = forest
            .closest(ends[1].node, |it| {
                it.has(abi::FOCUSABLE) && it.role != Role::WebArea
            })
            .filter(|it| forest.contains(self.id, *it));
        if let Some((id, action)) =
            focus.map(|it| focusable.map_or((it, Action::Blur), |it| (it, Action::Focus)))
        {
            self.afterwards(move || perform(id, action, [0; 4], ""));
        }
        self.afterwards(move || select_text(ends))
    }

    fn replace(&mut self, block: &Block, range: Range<usize>, text: String) -> Value {
        let id = self.id;
        self.select(block, range);
        self.afterwards(move || perform(id, Action::ReplaceSelectedText, [0; 4], &text))
    }

    /// `shift` is -1 for the piece before the offset and 1 for the one after it.
    fn piece(&self, block: &Block, unit: Unit, by_ends: bool, shift: isize) -> Vec<Value> {
        let (length, offset) = (
            block.text.len(),
            to_bytes(&block.text, self.number(0).max(0)),
        );
        let units = block.units(self.forest, unit).into_iter();
        let mut limits: Vec<_> = std::iter::once(0)
            .chain(units.map(|it| {
                if by_ends {
                    block.trimmed(it).end
                } else {
                    it.start
                }
            }))
            .chain([length])
            .collect();
        limits.dedup();
        if unit == Unit::Character || length > 0 && block.text.ends_with('\n') && !by_ends {
            limits.push(length);
        }
        let index = limits
            .partition_point(|it| *it <= offset)
            .clamp(1, limits.len().max(2) - 1)
            - 1;
        let range = match index
            .checked_add_signed(shift)
            .and_then(|it| limits.get(it..it + 2))
        {
            Some(it) => it[0]..it[1],
            None if shift < 0 => 0..0,
            None => length..length,
        };
        [block.text[range.clone()].into()]
            .into_iter()
            .chain(ends(block, &range))
            .collect()
    }

    fn style(&self, node: &Node) -> Style {
        let mut all = Vec::new();
        all.extend(
            node.text(Text::FontFamily)
                .map(|it| ("family-name", it.to_owned())),
        );
        all.extend(
            node.number(Number::FontSize)
                .map(|it| ("size", format!("{}pt", (it * 75.).round() / 100.))),
        );
        all.extend(
            node.number(Number::Color)
                .map(|it| (it as u32).to_be_bytes())
                .map(|it| ("fg-color", format!("{},{},{}", it[0], it[1], it[2]))),
        );
        let flags = [
            (abi::BOLD, "weight", "700"),
            (abi::ITALIC, "style", "italic"),
            (abi::UNDERLINED, "underline", "single"),
            (abi::STRUCK, "strikethrough", "true"),
            (abi::EDITABLE, "editable", "true"),
        ];
        all.extend(
            flags
                .into_iter()
                .filter(|it| node.has(it.0))
                .map(|it| (it.1, it.2.to_owned())),
        );
        all.extend(
            self.forest
                .inherited_text(self.id, Text::Language)
                .map(|it| ("language", it.to_owned())),
        );
        all
    }

    fn attribute_run(&self, block: &Block) -> Option<(Style, Range<usize>)> {
        let offset = to_bytes(&block.text, self.number(0).max(0));
        let (leaf, own) = block
            .leaves
            .iter()
            .find(|it| it.1.end > offset)
            .or(block.leaves.last())?;
        let node = self.forest.get(*leaf)?;
        let (mut style, mut range) = (self.style(node), own.clone());
        for wrong in node
            .misspelled
            .iter()
            .map(|it| own.start + it[0] as usize..(own.start + it[1] as usize).min(own.end))
        {
            if wrong.contains(&offset) {
                style.extend([
                    ("invalid", "spelling".to_owned()),
                    ("underline", "error".to_owned()),
                ]);
                return Some((style, wrong));
            } else if wrong.end <= offset {
                range.start = range.start.max(wrong.end);
            } else {
                range.end = range.end.min(wrong.start);
            }
        }
        Some((style, range))
    }

    pub fn text(&mut self, member: &str) -> Option<Vec<Value>> {
        const BOUNDARIES: [Unit; 7] = [
            Unit::Character,
            Unit::Word,
            Unit::Word,
            Unit::Sentence,
            Unit::Sentence,
            Unit::Line,
            Unit::Line,
        ];
        const GRANULARITIES: [Unit; 5] = [
            Unit::Character,
            Unit::Word,
            Unit::Sentence,
            Unit::Line,
            Unit::Paragraph,
        ];
        let (forest, id) = (self.forest, self.id);
        let block = forest.hypertext(id);
        let by_boundary = |shift| {
            let kind = self.number(1) as usize;
            Some(self.piece(
                &block,
                *BOUNDARIES.get(kind)?,
                kind > 0 && kind.is_multiple_of(2),
                shift,
            ))
        };
        let extents = |range: Range<usize>, kind| {
            let found = forest
                .bounds_of_text(&block, range, false)
                .unwrap_or_else(|| forest.bounds(id, None, false));
            Some(rectangle(self.to_client(found, kind)))
        };
        let attributes = |all: &[(&str, String)]| {
            Value::attributes(&all.iter().map(|it| (it.0, &*it.1)).collect::<Vec<_>>())
        };
        Some(vec![match member {
            "CharacterCount" => characters(&block.text, block.text.len()),
            "CaretOffset" => self.caret(&block),
            "GetText" => block.text[self.range(&block, 0)].into(),
            "GetStringAtOffset" => {
                return Some(self.piece(
                    &block,
                    *GRANULARITIES.get(self.number(1) as usize)?,
                    false,
                    0,
                ));
            }
            "GetTextBeforeOffset" => return by_boundary(-1),
            "GetTextAtOffset" => return by_boundary(0),
            "GetTextAfterOffset" => return by_boundary(1),
            "GetCharacterAtOffset" => Value::I32(
                block
                    .text
                    .chars()
                    .nth(self.number(0) as usize)
                    .map_or(0, |it| it as i32),
            ),
            "GetAttributes" | "GetAttributeRun" => {
                let (style, range) = self.attribute_run(&block).unwrap_or_default();
                return Some(
                    [attributes(&style)]
                        .into_iter()
                        .chain(ends(&block, &range))
                        .collect(),
                );
            }
            "GetAttributeValue" => self
                .attribute_run(&block)?
                .0
                .iter()
                .find(|it| it.0 == self.string(1))
                .map_or("", |it| &it.1)
                .into(),
            "GetDefaultAttributes" | "GetDefaultAttributeSet" => {
                attributes(&self.style(forest.get(id)?))
            }
            "GetCharacterExtents" => {
                let start = to_bytes(&block.text, self.number(0).max(0));
                return extents(
                    start..block.text.ceil_char_boundary(start + 1),
                    self.number(1),
                );
            }
            "GetRangeExtents" => return extents(self.range(&block, 0), self.number(2)),
            "GetOffsetAtPoint" => {
                let found = forest
                    .position_near(id, self.point(0, self.number(2)))
                    .and_then(|it| forest.offset_in_hypertext(&block, it, false));
                found.map_or(Value::I32(-1), |it| characters(&block.text, it))
            }
            "GetBoundedRanges" => Value::Array("(iisv)".into(), Vec::new()),
            "GetNSelections" => Value::I32(self.selected(&block).is_some().into()),
            "GetSelection" => {
                return Some(ends(&block, &self.selected(&block).unwrap_or_default()).into());
            }
            "SetCaretOffset" => {
                let at = to_bytes(&block.text, self.number(0));
                self.select(&block, at..at)
            }
            "AddSelection" => self.select(&block, self.range(&block, 0)),
            "SetSelection" => self.select(&block, self.range(&block, 1)),
            "RemoveSelection" => {
                let at = self.selected(&block)?.end;
                self.select(&block, at..at)
            }
            "ScrollSubstringTo" | "ScrollSubstringToPoint" => {
                let target = block
                    .position(self.range(&block, 0).start, false)
                    .map_or(id, |it| it.node);
                self.afterwards(move || perform(target, Action::ScrollIntoView, [0; 4], ""))
            }
            _ => return None,
        }])
    }

    pub fn editable_text(&mut self, member: &str) -> Option<Vec<Value>> {
        let block = self.forest.hypertext(self.id);
        Some(vec![match member {
            "SetTextContents" => self.act(Action::SetValue, self.string(0).to_owned()),
            "InsertText" => {
                let (at, text) = (to_bytes(&block.text, self.number(0)), self.string(1));
                self.replace(
                    &block,
                    at..at,
                    text[..to_bytes(text, self.number(2))].to_owned(),
                )
            }
            "DeleteText" => self.replace(&block, self.range(&block, 0), String::new()),
            "CopyText" => return Some(Vec::new()),
            "CutText" | "PasteText" => Value::Bool(false),
            _ => return None,
        }])
    }

    pub fn hypertext(&self, member: &str) -> Option<Vec<Value>> {
        let block = self.forest.hypertext(self.id);
        let is_embedded = |it: &&(_, Range<usize>)| {
            it.0 != self.id && self.forest.get(it.0).is_some_and(|it| !it.is_text())
        };
        let mut links = block.leaves.iter().filter(is_embedded);
        Some(vec![match member {
            "GetNLinks" => Value::I32(links.count() as i32),
            "GetLink" => links.nth(self.number(0) as usize).map_or_else(
                || self.connection.reference(None),
                |it| self.connection.link(it.0),
            ),
            "GetLinkIndex" => {
                let offset = to_bytes(&block.text, self.number(0));
                Value::I32(
                    links
                        .position(|it| it.1.start == offset)
                        .map_or(-1, |it| it as i32),
                )
            }
            _ => return None,
        }])
    }

    pub fn hyperlink(&self, member: &str) -> Option<Vec<Value>> {
        let node = self.forest.get(self.id)?;
        let place = || {
            let block = self.forest.hypertext(self.forest.parent(self.id)?);
            Some(ends(
                &block,
                &block.leaves.iter().find(|it| it.0 == self.id)?.1,
            ))
        };
        Some(vec![match member {
            "NAnchors" => Value::I32(1),
            "StartIndex" => place().map_or(Value::I32(-1), |[it, _]| it),
            "EndIndex" => place().map_or(Value::I32(-1), |[_, it]| it),
            "GetObject" => self.connection.reference(Some(Object::Node(self.id))),
            "GetURI" => node
                .text(Text::Url)
                .filter(|_| node.role != Role::WebArea)
                .unwrap_or_default()
                .into(),
            "IsValid" => Value::Bool(true),
            _ => return None,
        }])
    }
}
