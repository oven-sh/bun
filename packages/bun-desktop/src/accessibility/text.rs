//! Places in the text of a tree, and how to get from one to another.

use std::cmp::Ordering;
use std::ops::Range;
use std::rc::Rc;

use super::forest::{Forest, Id, Node};
use crate::abi::Rect;
use crate::abi::accessibility::{self as abi, Role};
use crate::bun::abi::BREAK_GRAPHEMES;
use crate::unicode::find_breaks;

/// In a node that has no children. The offset counts bytes of UTF-8.
#[derive(Clone, Copy, Debug, Default)]
pub struct Position {
    pub node: Id,
    pub offset: usize,
    /// Where a line wraps, at the end of the line.
    pub is_upstream: bool,
}

impl PartialEq for Position {
    fn eq(&self, other: &Position) -> bool {
        (self.node, self.offset) == (other.node, other.offset)
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Unit {
    Character,
    Word,
    Line,
    Sentence,
    Paragraph,
    Style,
}

/// The text of leaves that follow each other.
#[derive(Default)]
pub struct Block {
    pub text: String,
    /// With where their text is.
    pub leaves: Vec<(Id, Range<usize>)>,
}

impl Block {
    pub fn offset_of(&self, forest: &Forest, position: Position) -> Option<usize> {
        match self.leaves.iter().find(|it| it.0 == position.node) {
            Some((_, range)) => Some((range.start + position.offset).min(range.end)),
            None => {
                let (first, last) = (self.leaves.first()?.0, self.leaves.last()?.0);
                let start = |node| Position {
                    node,
                    ..Position::default()
                };
                let is_before = forest.compare_positions(position, start(first)).is_le();
                (is_before || forest.compare_positions(position, start(last)).is_ge())
                    .then_some(if is_before { 0 } else { self.text.len() })
            }
        }
    }

    /// Between two leaves, the start of the second one unless `is_upstream`.
    pub fn position(&self, offset: usize, is_upstream: bool) -> Option<Position> {
        let index = match is_upstream {
            true => self.leaves.partition_point(|it| it.1.end < offset),
            false => self
                .leaves
                .partition_point(|it| it.1.start <= offset)
                .saturating_sub(1),
        };
        let (node, range) = self.leaves.get(index).or(self.leaves.last())?;
        Some(Position {
            node: *node,
            offset: offset.clamp(range.start, range.end) - range.start,
            is_upstream,
        })
    }

    fn ends_of(&self, range: Range<usize>) -> Option<[Position; 2]> {
        Some([
            self.position(range.start, false)?,
            self.position(range.end, !range.is_empty())?,
        ])
    }

    /// The offsets at which lines start, the first of which is 0.
    pub fn line_starts(&self, forest: &Forest) -> Vec<usize> {
        self.starts(forest, true)
    }

    fn starts(&self, forest: &Forest, of_wrapped_lines: bool) -> Vec<usize> {
        let mut starts: Vec<_> = std::iter::once(0)
            .chain(self.text.match_indices('\n').map(|it| it.0 + 1))
            .collect();
        for (id, range) in &self.leaves {
            let Some(first) = forest.get(forest.edge_leaf(*id, false)) else {
                continue;
            };
            let wrapped = first.runs.iter().filter(|it| {
                of_wrapped_lines
                    && it.starts_line
                    && (it.start == 0 || forest.children(*id).next().is_none())
            });
            starts.extend(
                wrapped
                    .map(|it| range.start + it.start as usize)
                    .chain(first.has(abi::STARTS_PARAGRAPH).then_some(range.start)),
            );
        }
        starts.sort_unstable();
        starts.dedup();
        starts
    }

    fn words(&self) -> Vec<Range<usize>> {
        let is_ideograph = |it: char| matches!(it, '\u{3400}'..='\u{9fff}' | '\u{f900}'..='\u{faff}' | '\u{20000}'..='\u{3ffff}');
        let is_letter = |it: char| {
            (it.is_alphanumeric()
                || it == '_'
                || !crate::unicode::stands_alone(it) && !it.is_ascii())
                && !is_ideograph(it)
                && it != '\u{fffc}'
        };
        let (mut words, mut characters) = (
            Vec::<Range<usize>>::new(),
            self.text.char_indices().peekable(),
        );
        let mut continues = false;
        while let Some((at, it)) = characters.next() {
            let joins = continues
                && matches!(it, '\'' | '’' | '.' | ':')
                && characters.peek().is_some_and(|next| is_letter(next.1));
            let is_part = is_letter(it) || joins;
            match words.last_mut() {
                Some(word) if continues && is_part => word.end = at + it.len_utf8(),
                _ if !it.is_whitespace() => words.push(at..at + it.len_utf8()),
                _ => {}
            }
            continues = is_part;
        }
        words
    }

    fn sentence_starts(&self) -> Vec<usize> {
        let (mut starts, mut has_ended, mut needs_space) = (vec![0], false, false);
        for (at, it) in self.text.char_indices() {
            match it {
                '\n' => {
                    starts.extend((at + 1 < self.text.len()).then_some(at + 1));
                    has_ended = false;
                }
                '.' | '!' | '?' | '…' => (has_ended, needs_space) = (true, true),
                '。' | '！' | '？' => (has_ended, needs_space) = (true, false),
                '"' | '\'' | ')' | ']' | '”' | '’' | '」' if has_ended && needs_space => {}
                _ if it.is_whitespace() => needs_space = false,
                _ => {
                    starts.extend((has_ended && !needs_space && !it.is_lowercase()).then_some(at));
                    has_ended = false;
                }
            }
        }
        starts
    }

    /// In order. There can be gaps between words.
    pub fn units(&self, forest: &Forest, unit: Unit) -> Vec<Range<usize>> {
        let starts = match unit {
            Unit::Word => return self.words(),
            Unit::Character => {
                let mut breaks = Vec::new();
                find_breaks(BREAK_GRAPHEMES, &self.text, &mut breaks);
                std::iter::once(0)
                    .chain(
                        breaks
                            .into_iter()
                            .map(|it| it as usize)
                            .filter(|it| *it < self.text.len()),
                    )
                    .collect()
            }
            Unit::Line => self.line_starts(forest),
            Unit::Sentence => self.sentence_starts(),
            Unit::Paragraph => self.starts(forest, false),
            Unit::Style => self
                .leaves
                .iter()
                .filter(|it| !it.1.is_empty())
                .map(|it| it.1.start)
                .collect(),
        };
        let ends = starts.iter().skip(1).copied().chain([self.text.len()]);
        starts.iter().zip(ends).map(|it| *it.0..it.1).collect()
    }

    /// Without the line break.
    pub fn trimmed(&self, range: Range<usize>) -> Range<usize> {
        range.start..range.end - usize::from(self.text[range.clone()].ends_with('\n'))
    }
}

pub fn to_utf16(text: &str, offset: usize) -> usize {
    text[..offset].chars().map(char::len_utf16).sum()
}

pub fn from_utf16(text: &str, offset: usize) -> usize {
    let mut units = 0;
    let is_past = |it: &(usize, char)| {
        units += it.1.len_utf16();
        units > offset
    };
    text.char_indices()
        .find(is_past)
        .map_or(text.len(), |it| it.0)
}

/// Of a leaf. UI Automation only gets to what has a character.
fn text_of(node: &Node) -> &str {
    let is_object = || {
        !matches!(
            node.role,
            Role::Generic | Role::None | Role::Paragraph | Role::WebArea
        ) || node.has(abi::FOCUSABLE)
            || !node.name().is_empty()
    };
    match node.is_text() {
        true => node.name(),
        false if cfg!(windows) && !node.has(abi::EDITABLE | abi::TEXT_FIELD) && is_object() => {
            "\u{fffc}"
        }
        false => "",
    }
}

pub fn union(a: Rect, b: Rect) -> Rect {
    let (x, y) = (a.x.min(b.x), a.y.min(b.y));
    Rect {
        x,
        y,
        width: (a.x + a.width).max(b.x + b.width) - x,
        height: (a.y + a.height).max(b.y + b.height) - y,
    }
}

impl Forest {
    fn edge_leaf(&self, mut id: Id, is_last: bool) -> Id {
        while let Some(child) = if is_last {
            self.children(id).next_back()
        } else {
            self.children(id).next()
        } {
            id = child;
        }
        id
    }

    fn adjacent_leaf(&self, id: Id, is_next: bool) -> Option<Id> {
        let sibling = std::iter::once(id)
            .chain(self.ancestors(id))
            .find_map(|it| self.sibling(it, is_next))?;
        Some(self.edge_leaf(sibling, !is_next))
    }

    pub fn start_of(&self, id: Id) -> Position {
        Position {
            node: self.edge_leaf(id, false),
            ..Position::default()
        }
    }

    pub fn end_of(&self, id: Id) -> Position {
        let node = self.edge_leaf(id, true);
        Position {
            node,
            offset: self.get(node).map_or(0, |it| text_of(it).len()),
            is_upstream: true,
        }
    }

    /// From an `abi::Point`.
    pub fn position_at(&self, id: Id, offset: usize, is_upstream: bool) -> Option<Position> {
        let node = self.get(id)?;
        if node.is_text() {
            return Some(Position {
                node: id,
                offset: node.name().floor_char_boundary(offset),
                is_upstream,
            });
        }
        if node.has(abi::ATOMIC_FIELD) {
            let field = self.field_text(id);
            return field.position(field.text.floor_char_boundary(offset), is_upstream);
        }
        Some(
            self.children(id)
                .nth(offset)
                .map_or_else(|| self.end_of(id), |it| self.start_of(it)),
        )
    }

    /// For one that may be from before a change.
    pub fn validated(&self, position: Position) -> Option<Position> {
        let node = self.get(position.node)?;
        match self.children(position.node).next() {
            Some(_) => Some(self.start_of(position.node)),
            None => Some(Position {
                offset: text_of(node).floor_char_boundary(position.offset),
                ..position
            }),
        }
    }

    pub fn compare_positions(&self, a: Position, b: Position) -> Ordering {
        if a.node == b.node {
            return a.offset.cmp(&b.offset);
        }
        let path = |it: Id| {
            std::iter::once(it)
                .chain(self.ancestors(it))
                .collect::<Vec<_>>()
        };
        let (a, b) = (path(a.node), path(b.node));
        let apart = a.iter().rev().zip(b.iter().rev()).find(|it| it.0 != it.1);
        apart.map_or(a.len().cmp(&b.len()), |it| {
            self.index_in_parent(*it.0)
                .cmp(&self.index_in_parent(*it.1))
        })
    }

    pub fn ordered(&self, [a, b]: [Position; 2]) -> [Position; 2] {
        if self.compare_positions(a, b).is_gt() {
            [b, a]
        } else {
            [a, b]
        }
    }

    fn starts_paragraph(&self, leaf: Id) -> bool {
        self.get(leaf)
            .is_some_and(|it| it.has(abi::STARTS_PARAGRAPH))
    }

    fn gather(&self, leaves: impl Iterator<Item = Id>) -> Block {
        let mut block = Block::default();
        for leaf in leaves {
            let Some(node) = self.get(leaf) else { continue };
            let follows_break = block
                .leaves
                .last()
                .is_none_or(|it| self.get(it.0).is_some_and(|it| it.role == Role::LineBreak));
            if node.has(abi::STARTS_PARAGRAPH) && !follows_break {
                block.text.push('\n');
            }
            let start = block.text.len();
            block.text.push_str(text_of(node));
            block.leaves.push((leaf, start..block.text.len()));
        }
        block
    }

    /// A break at the end of a block starts no line.
    fn without_last_break(&self, mut block: Block) -> Block {
        if let Some((_, range)) = block
            .leaves
            .last_mut()
            .filter(|it| self.get(it.0).is_some_and(|it| it.role == Role::LineBreak))
        {
            range.end = range.start;
            block.text.truncate(range.start);
        }
        block
    }

    fn leaves_from(&self, first: Id, last: Id) -> impl Iterator<Item = Id> + '_ {
        std::iter::successors(Some(first), move |it| {
            if *it == last {
                None
            } else {
                self.adjacent_leaf(*it, true)
            }
        })
    }

    fn leaves_of(&self, id: Id) -> impl Iterator<Item = Id> + '_ {
        std::iter::once(id)
            .chain(self.descendants(id))
            .filter(|it| self.children(*it).next().is_none())
    }

    pub fn field_text(&self, field: Id) -> Block {
        self.without_last_break(self.gather(self.leaves_of(field)))
    }

    /// With the break that holds an empty editor open: VoiceOver tells where the caret is if there is a character.
    pub fn field_value(&self, field: Id) -> Block {
        let block = self.gather(self.leaves_of(field));
        if block.leaves.len() == 1 {
            block
        } else {
            self.without_last_break(block)
        }
    }

    /// The leaves that no start of a paragraph separates from this one.
    fn block_of(&self, leaf: Id) -> Rc<Block> {
        if let Some(block) = self
            .last_block
            .borrow()
            .as_ref()
            .filter(|it| it.leaves.iter().any(|it| it.0 == leaf))
        {
            return Rc::clone(block);
        }
        let back = |it: &Id| {
            if self.starts_paragraph(*it) {
                None
            } else {
                self.adjacent_leaf(*it, false)
            }
        };
        let first = std::iter::successors(Some(leaf), back)
            .last()
            .unwrap_or(leaf);
        let forth = |it: &Id| {
            self.adjacent_leaf(*it, true)
                .filter(|it| !self.starts_paragraph(*it))
        };
        let block = Rc::new(
            self.without_last_break(self.gather(std::iter::successors(Some(first), forth))),
        );
        self.last_block.replace(Some(Rc::clone(&block)));
        block
    }

    fn adjacent_block(&self, block: &Block, is_next: bool) -> Option<Rc<Block>> {
        let edge = if is_next {
            block.leaves.last()
        } else {
            block.leaves.first()
        };
        Some(self.block_of(self.adjacent_leaf(edge?.0, is_next)?))
    }

    fn locate(&self, position: Position) -> Option<(Rc<Block>, usize)> {
        let block = self.block_of(position.node);
        let offset = block.offset_of(self, position)?;
        Some((block, offset))
    }

    /// One step leads from the end of a block to the start of the next.
    pub fn step(&self, from: Position, is_next: bool) -> Option<Position> {
        let (block, offset) = self.locate(from)?;
        if offset == if is_next { block.text.len() } else { 0 } {
            let block = self.adjacent_block(&block, is_next)?;
            return block.position(if is_next { 0 } else { block.text.len() }, !is_next);
        }
        let characters = block.units(self, Unit::Character);
        let to = match is_next {
            true => characters.iter().find(|it| it.end > offset)?.end,
            false => characters.iter().rfind(|it| it.start < offset)?.start,
        };
        block.position(to, false)
    }

    /// The end of the first unit that ends after `from`.
    pub fn next_end(&self, from: Position, unit: Unit) -> Option<Position> {
        let (mut block, offset) = self.locate(from)?;
        let mut after = Some(offset);
        loop {
            let ends = block
                .units(self, unit)
                .into_iter()
                .map(|it| block.trimmed(it).end);
            if let Some(end) = ends
                .into_iter()
                .find(|it| after.is_none_or(|after| *it > after))
            {
                return block.position(end, true);
            }
            match self.adjacent_block(&block, true) {
                Some(next) => (block, after) = (next, None),
                None => {
                    return block
                        .position(block.text.len(), true)
                        .filter(|_| after != Some(block.text.len()));
                }
            }
        }
    }

    /// The start of the last unit that starts before `from`.
    pub fn previous_start(&self, from: Position, unit: Unit) -> Option<Position> {
        let (mut block, offset) = self.locate(from)?;
        let mut before = Some(offset);
        loop {
            let units = block.units(self, unit);
            if let Some(it) = units
                .iter()
                .rfind(|it| before.is_none_or(|before| it.start < before))
            {
                return block.position(it.start, false);
            }
            match self.adjacent_block(&block, false) {
                Some(previous) => (block, before) = (previous, None),
                None => return block.position(0, false).filter(|_| before != Some(0)),
            }
        }
    }

    /// Between two units, the one before if the position is upstream.
    pub fn unit_at(&self, position: Position, unit: Unit) -> Option<[Position; 2]> {
        let (block, offset) = self.locate(position)?;
        let units = block.units(self, unit);
        let before = units.iter().rfind(|it| {
            position.is_upstream && it.start < offset && !block.text[..offset].ends_with('\n')
        });
        block.ends_of(
            block.trimmed(
                before
                    .or_else(|| units.iter().find(|it| it.end > offset))
                    .or(units.last())
                    .cloned()
                    .unwrap_or(offset..offset),
            ),
        )
    }

    /// As far as the next edge of a word. It is empty at the edge of a paragraph.
    pub fn word_beside(&self, position: Position, is_next: bool) -> Option<[Position; 2]> {
        let (block, offset) = self.locate(position)?;
        let breaks = block.text.match_indices('\n').map(|it| it.0..it.0 + 1);
        let edges = block
            .words()
            .into_iter()
            .chain(breaks)
            .flat_map(|it| [it.start, it.end]);
        let range = match is_next {
            true => {
                offset
                    ..edges
                        .filter(|it| *it > offset)
                        .min()
                        .unwrap_or(block.text.len())
            }
            false => edges.filter(|it| *it < offset).max().unwrap_or(0)..offset,
        };
        if matches!(&block.text[range.clone()], "" | "\n") {
            Some([position; 2])
        } else {
            block.ends_of(range)
        }
    }

    /// The first line that goes beyond the position. It is empty at the edge of a field or of the page.
    pub fn line_beside(&self, position: Position, is_next: bool) -> Option<[Position; 2]> {
        let (block, offset) = self.locate(position)?;
        let lines = |block: &Block| {
            block
                .units(self, Unit::Line)
                .into_iter()
                .map(|it| block.trimmed(it))
                .collect::<Vec<_>>()
        };
        let own = lines(&block);
        if let Some(line) = if is_next {
            own.iter().find(|it| it.end > offset)
        } else {
            own.iter().rfind(|it| it.start < offset)
        } {
            return block.ends_of(line.clone());
        }
        let field = |it| self.closest(it, |it| it.has(abi::TEXT_FIELD));
        let Some(other) = self.adjacent_block(&block, is_next).filter(|it| {
            it.leaves
                .first()
                .is_some_and(|it| field(it.0) == field(position.node))
        }) else {
            return Some([position; 2]);
        };
        let lines = lines(&other);
        other.ends_of(if is_next { lines.first() } else { lines.last() }?.clone())
    }

    /// The text, and the part of it that is between them.
    pub fn between(&self, range: [Position; 2]) -> (Block, Range<usize>) {
        let [start, end] = self.ordered(range);
        let block = self.gather(self.leaves_from(start.node, end.node));
        let [start, end] = [start, end].map(|it| block.offset_of(self, it).unwrap_or(0));
        (block, start..end.max(start))
    }

    // ───────────────────────────── units without gaps ─────────────────────────────

    /// The same for all positions between the same two characters.
    #[cfg(windows)]
    pub fn normalized(&self, position: Position, is_upstream: bool) -> Position {
        self.locate(position)
            .and_then(|it| it.0.position(it.1, is_upstream))
            .unwrap_or(position)
    }

    /// The end of a block is the character that breaks the line.
    #[cfg(windows)]
    fn unit_starts(&self, block: &Block, unit: Unit) -> Vec<usize> {
        let holder = |it: Id| {
            self.closest(it, |it| {
                it.has(abi::CLICKABLE | abi::TEXT_FIELD) || it.role == Role::Image
            })
        };
        let style = |it: Id| {
            let node = self.get(it)?;
            let numbers = [abi::Number::FontSize, abi::Number::Color].map(|it| node.number(it));
            Some((
                node.states & (abi::BOLD | abi::ITALIC | abi::UNDERLINED | abi::STRUCK),
                numbers,
                node.text(abi::Text::FontFamily),
                holder(it),
            ))
        };
        let (mut starts, leaves) = (
            vec![0],
            block
                .leaves
                .iter()
                .filter(|it| !it.1.is_empty())
                .collect::<Vec<_>>(),
        );
        match unit {
            Unit::Style => starts.extend(
                leaves
                    .array_windows()
                    .filter(|[a, b]| style(a.0) != style(b.0))
                    .map(|[_, b]| b.1.start),
            ),
            _ => starts.extend(block.units(self, unit).into_iter().map(|it| it.start)),
        }
        if unit == Unit::Word {
            let is_visible = |at: usize| !block.text[at..].starts_with(char::is_whitespace);
            starts.extend(
                leaves
                    .array_windows()
                    .filter(|[a, b]| holder(a.0) != holder(b.0) && is_visible(b.1.start))
                    .map(|[_, b]| b.1.start),
            );
            starts.sort_unstable();
        }
        starts.extend((unit == Unit::Character).then_some(block.text.len()));
        starts.dedup();
        starts
    }

    /// The end of the block before, if this is the start of one.
    #[cfg(windows)]
    pub fn before_break(&self, position: Position) -> Option<Position> {
        let block = self.adjacent_block(&self.locate(position).filter(|it| it.1 == 0)?.0, false)?;
        block.position(block.text.len(), true)
    }

    /// Of the first unit that starts after `from`.
    #[cfg(windows)]
    pub fn start_after(&self, from: Position, unit: Unit) -> Option<Position> {
        let (block, offset) = self.locate(from)?;
        match self
            .unit_starts(&block, unit)
            .into_iter()
            .find(|it| *it > offset)
        {
            Some(start) => block.position(start, false),
            None => self.adjacent_block(&block, true)?.position(0, false),
        }
    }

    /// Of the last unit that starts before `from`, or there if `is_inclusive`.
    #[cfg(windows)]
    pub fn start_before(&self, from: Position, unit: Unit, is_inclusive: bool) -> Option<Position> {
        let (block, offset) = self.locate(from)?;
        if let Some(start) = self
            .unit_starts(&block, unit)
            .into_iter()
            .rfind(|it| *it < offset + usize::from(is_inclusive))
        {
            return block.position(start, false);
        }
        let block = self.adjacent_block(&block, false)?;
        block.position(*self.unit_starts(&block, unit).last()?, false)
    }

    /// In the window, one for each piece of a line.
    #[cfg(windows)]
    pub fn rects_between(&self, range: [Position; 2]) -> Vec<Rect> {
        let (block, range) = self.between(range);
        let shown = block.leaves.iter().filter(|it| {
            it.1.start < range.end && it.1.end > range.start && !self.is_offscreen(it.0)
        });
        let rects =
            shown.flat_map(
                |(id, own)| match self.get(*id).filter(|it| !it.runs.is_empty()) {
                    Some(node) => {
                        let inside = range.start.max(own.start) - own.start
                            ..range.end.min(own.end) - own.start;
                        Self::rects_in(node, inside, false)
                            .into_iter()
                            .map(|it| self.bounds(*id, Some(it), true))
                            .collect()
                    }
                    None => vec![self.bounds(*id, None, true)],
                },
            );
        rects.filter(|it| it.width > 0. && it.height > 0.).collect()
    }

    // ───────────────────────────── geometry ─────────────────────────────

    /// Relative to the node, one for each run that has a part of the range.
    fn rects_in(node: &Node, range: Range<usize>, is_upstream: bool) -> Vec<Rect> {
        let (text, mut rects, mut character) = (node.name(), Vec::new(), 0);
        for (index, run) in node.runs.iter().enumerate() {
            let [start, end] = [
                run.start as usize,
                node.runs
                    .get(index + 1)
                    .map_or(text.len(), |it| it.start as usize),
            ]
            .map(|it| text.floor_char_boundary(it));
            let advance = |characters: Range<usize>| {
                node.advances
                    .get(characters)
                    .map_or(0., |it| it.iter().sum::<f32>())
            };
            let count = |to: usize| {
                character + text[start..to.clamp(start, end.max(start))].chars().count()
            };
            let has_caret = range.start >= start
                && (range.start < end
                    || range.start == end && (is_upstream || index + 1 == node.runs.len()));
            if if range.is_empty() {
                has_caret
            } else {
                range.start < end && range.end > start
            } {
                let (before, size) = (
                    advance(character..count(range.start)),
                    advance(count(range.start)..count(range.end)),
                );
                let along = if run.is_vertical {
                    run.rect.height
                } else {
                    run.rect.width
                };
                let offset = if run.is_rtl {
                    along - before - size
                } else {
                    before
                };
                rects.push(match run.is_vertical {
                    true => Rect {
                        y: run.rect.y + offset,
                        height: size,
                        ..run.rect
                    },
                    false => Rect {
                        x: run.rect.x + offset,
                        width: size,
                        ..run.rect
                    },
                });
                if range.is_empty() {
                    break;
                }
            }
            character = count(end);
        }
        rects
    }

    /// In the window.
    pub fn bounds_of_text(
        &self,
        block: &Block,
        range: Range<usize>,
        is_upstream: bool,
    ) -> Option<Rect> {
        let caret = range
            .is_empty()
            .then(|| block.position(range.start, is_upstream))
            .flatten();
        let has_part = |it: &&(Id, Range<usize>)| match caret {
            Some(caret) => it.0 == caret.node,
            None => it.1.start < range.end && it.1.end > range.start,
        };
        let rects = block.leaves.iter().filter(has_part).flat_map(|(id, own)| {
            match self.get(*id).filter(|it| !it.runs.is_empty()) {
                Some(node) => {
                    let inside =
                        range.start.max(own.start) - own.start..range.end.min(own.end) - own.start;
                    Self::rects_in(node, inside, is_upstream)
                        .into_iter()
                        .map(|it| self.bounds(*id, Some(it), false))
                        .collect()
                }
                None => vec![self.bounds(*id, None, false)],
            }
        });
        rects.reduce(union)
    }

    /// The place before the character that is at the point, or nearest to it.
    pub fn position_near(&self, within: Id, [x, y]: [f32; 2]) -> Option<Position> {
        let hit = self.hit(within, [x, y]).unwrap_or(within);
        let distance = |it: Rect| {
            (it.y - y).max(y - it.y - it.height).max(0.) * 1000.
                + (it.x - x).max(x - it.x - it.width).max(0.)
        };
        let runs = self
            .leaves_of(hit)
            .filter_map(|id| Some((id, self.get(id)?)))
            .flat_map(|(id, node)| (0..node.runs.len()).map(move |it| (id, node, it)));
        let away = |it: &(Id, &Node, usize)| {
            distance(self.bounds(it.0, Some(it.1.runs[it.2].rect), false))
        };
        let Some((id, node, index)) = runs.min_by(|a, b| away(a).total_cmp(&away(b))) else {
            return Some(self.start_of(hit));
        };
        let (text, start) = (node.name(), node.runs[index].start as usize);
        let end = node
            .runs
            .get(index + 1)
            .map_or(text.len(), |it| it.start as usize);
        let away = |it: &(usize, char)| {
            let rects = Self::rects_in(node, start + it.0..start + it.0 + it.1.len_utf8(), false);
            rects
                .first()
                .filter(|it| it.width > 0.)
                .map_or(f32::MAX, |it| distance(self.bounds(id, Some(*it), false)))
        };
        let nearest = text
            .get(start..end)?
            .char_indices()
            .min_by(|a, b| away(a).total_cmp(&away(b)));
        Some(Position {
            node: id,
            offset: start + nearest.map_or(0, |it| it.0),
            is_upstream: false,
        })
    }
}
