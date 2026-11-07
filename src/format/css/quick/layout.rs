//! Writes a value that `value.rs` has read the way `value_groups.rs` and `doc.rs` print it, without a tree and without
//! a document: the flat text, the records and the width of the page are all that it depends on.
//!
//! The documents, where `P` is what's between parentheses, with or without a name before it:
//!
//! - `P` is `group("(", indent(softline, item, ",", line, item, ..), softline, ")")`. If it doesn't fit on the line,
//!   together with what follows it up to the next possible line break, each item gets a line of its own. A map of SCSS
//!   (`is_scss_map_item`) breaks whether it fits or not, and gets a comma at its end.
//! - An item that's one node (a word, a call, a `P`) is printed as it is. Several nodes are `group(indent(fill(node,
//!   line, node, ..)))`: as many on a line as fit, and a `fill` doesn't look at what follows it. A pair is such a
//!   group. Nothing breaks between the key and the first node of the value if that fits up to its `(`.
//! - `key: (..)` is printed one level to the left: `dedent`.
//! - A forced break (a map, a comment, an empty line that's kept) breaks all the groups around it.
//!
//! Whatever isn't certain to be printed like that is refused: every function here that returns an `Option` returns
//! `None` for "this isn't the place to tell".

use super::value::{
    CALL, COMPLEX, EMPTY_LINE, FIRST_PAIR, Kind, Record, Values, is_call_name_byte,
};

/// How a group stands in its item.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Position {
    /// It's the item.
    Alone,
    /// It's the value of the pair that the item is.
    PairValue,
    Other,
}

/// What the layout of a value depends on, apart from the value.
#[derive(Copy, Clone)]
pub(super) struct Request {
    /// The number of blocks around the statement.
    pub(super) level: usize,
    /// How many columns to the right of the start of the statement the value starts, if it starts on that line.
    pub(super) head_width: usize,
    /// How many columns follow the value on its last line.
    pub(super) tail_width: usize,
    /// It's the value of a `$variable`.
    pub(super) is_variable: bool,
    /// It's the value of a declaration, where a list that doesn't fit starts on a line of its own.
    pub(super) is_declaration: bool,
    /// A list with an item of several nodes has one item on each line.
    pub(super) breaks_list: bool,
    /// It's in the block of a control directive of SCSS, where the nodes of an item are no `fill` and `key: (..)` isn't
    /// moved to the left.
    pub(super) is_in_control_directive: bool,
}

/// The options that a layout depends on.
#[derive(Copy, Clone, Default)]
pub(super) struct Page {
    pub(super) width: usize,
    pub(super) tab_width: usize,
    pub(super) use_tabs: bool,
    pub(super) trailing_comma: bool,
}

impl Page {
    /// The number of bytes of the indentation of `level` blocks.
    pub(super) fn indentation_len(&self, level: usize) -> usize {
        level * if self.use_tabs { 1 } else { self.tab_width }
    }

    /// True if `text` is what `break_line` appends.
    pub(super) fn is_line_break(&self, text: &[u8], level: usize) -> bool {
        let fill = if self.use_tabs { b'\t' } else { b' ' };
        matches!(text.split_first(), Some((b'\n', indentation))
            if indentation.len() == self.indentation_len(level) && indentation.iter().all(|it| *it == fill))
    }

    /// Appends a line break and the indentation of `level` blocks. `None`, and nothing is appended, if the text is longer
    /// with them than anything that's printed.
    pub(super) fn break_line(&self, out: &mut Vec<u8>, level: usize) -> Option<()> {
        let len = (out.len() + 1).saturating_add(self.indentation_len(level));
        if crate::is_too_long(len) {
            return None;
        }
        out.push(b'\n');
        out.resize(len, if self.use_tabs { b'\t' } else { b' ' });
        Some(())
    }
}

struct Layout<'a> {
    flat: &'a [u8],
    css: &'a [u8],
    records: &'a [Record],
    /// For each group that `state_of` has looked at: the group around it, and how it stands in its item.
    up: &'a mut Vec<(Option<u32>, Position)>,
    out: &'a mut Vec<u8>,
    page: Page,
    is_scss: bool,
    request: Request,
    /// Nothing has been written yet. A blank comes first, unless it's a line break.
    is_at_start: bool,
    has_line_breaks: bool,
}

/// An item of a group or of the list at the top.
#[derive(Copy, Clone)]
struct Item {
    /// Its records are `records[first..end]`. `records[end]` is the comma or the `)` after it.
    first: usize,
    end: usize,
    colon: Option<usize>,
    /// The comment after it, which only the last item of a group can have.
    comment: Option<usize>,
    /// Its part of the flat text.
    from: usize,
    to: usize,
}

struct State {
    /// The group is broken whether it fits or not.
    is_forced: bool,
    is_map: bool,
}

impl Layout<'_> {
    fn at(&self, record: usize) -> usize {
        self.records.get(record).map_or(0, |it| it.at as usize)
    }

    fn flags(&self, record: usize) -> u8 {
        self.records.get(record).map_or(0, |it| it.flags)
    }

    fn has(&self, record: usize, flag: u8) -> bool {
        self.flags(record) & flag != 0
    }

    fn link(&self, record: usize) -> usize {
        self.records.get(record).map_or(0, |it| it.link as usize)
    }

    fn kind(&self, record: usize) -> Option<Kind> {
        self.records.get(record).map(|it| it.kind)
    }

    fn flat_byte(&self, at: usize) -> u8 {
        self.flat.get(at).copied().unwrap_or(0)
    }

    fn column_of(&self, level: usize) -> usize {
        level * self.page.tab_width
    }

    // ───────────────────────────── writing ─────────────────────────────

    fn start(&mut self) {
        if std::mem::take(&mut self.is_at_start) {
            self.out.push(b' ');
        }
    }

    fn copy(&mut self, from: usize, to: usize) {
        self.start();
        self.out
            .extend_from_slice(self.flat.get(from..to).unwrap_or_default());
    }

    fn byte(&mut self, byte: u8) {
        self.start();
        self.out.push(byte);
    }

    fn break_line(&mut self, level: usize) -> Option<()> {
        self.is_at_start = false;
        self.has_line_breaks = true;
        self.page.break_line(self.out, level)
    }

    fn comment(&mut self, record: usize) {
        let text = self.css.get(self.at(record)..self.link(record));
        self.out.extend_from_slice(text.unwrap_or_default());
    }

    // ───────────────────────────── questions ─────────────────────────────

    /// Returns the next blank in `flat[from..to]` that's outside of parentheses and strings, or `to`.
    fn next_blank(&self, from: usize, to: usize) -> usize {
        let mut depth = 0i32;
        let mut p = from;
        while p < to {
            match self.flat_byte(p) {
                b' ' if depth == 0 => break,
                b'(' => depth += 1,
                b')' => depth -= 1,
                quote @ (b'"' | b'\'') => {
                    p += 1;
                    while p < to && self.flat_byte(p) != quote {
                        p += 1;
                    }
                }
                _ => {}
            }
            p += 1;
        }
        p.min(to)
    }

    /// Where the group starts in the flat text, with its name.
    fn group_start(&self, open: usize) -> usize {
        let mut p = self.at(open);
        if self.has(open, CALL) {
            while p > 0 && is_call_name_byte(self.flat_byte(p - 1)) {
                p -= 1;
            }
        }
        p
    }

    fn position_of(&self, open: usize, item: &Item) -> Position {
        if self.at(self.link(open)) + 1 != item.to {
            return Position::Other;
        }
        let start = self.group_start(open);
        match item.colon {
            None if start == item.from => Position::Alone,
            Some(colon) if start == self.at(colon) + 2 => Position::PairValue,
            _ => Position::Other,
        }
    }

    /// Does the parser make more than one node of `flat[from..to]`, which isn't a pair?
    fn is_several_nodes(&self, from: usize, to: usize) -> Option<bool> {
        if self.next_blank(from, to) < to {
            return Some(true);
        }
        // A sign is a node of its own in most places, `#{}` is four nodes, `~"a"` is two.
        if matches!(self.flat_byte(from), b'-' | b'+' | b'~') {
            return None;
        }
        let text = self.flat.get(from..to).unwrap_or_default();
        if bun_core::strings::contains(text, b"#{") {
            return None;
        }
        // `@@a` of Less is two.
        Some(text.starts_with(b"@@"))
    }

    /// `is_scss_map_item` for the group at `open`, which is in the group at `outer`.
    fn is_map(&self, open: usize, outer: Option<usize>, position: Position) -> Option<bool> {
        if !self.is_scss {
            return Some(false);
        }
        let close = self.link(open);
        let count = self.link(close);
        if count == 0 {
            return Some(false);
        }
        let starts_with_pair = self.has(open, FIRST_PAIR);
        let is_call = self.has(open, CALL);
        let is_in_pairs = outer.is_some_and(|it| self.has(it, FIRST_PAIR));
        // The parent of the parent: does it start with a pair, is it a call?
        let (mut is_grandparent_pairs, mut is_grandparent_call) = (false, false);
        if is_call {
            is_grandparent_pairs = position == Position::Alone && is_in_pairs;
        } else if position == Position::Alone {
            if let Some(outer) = outer {
                if self.has(outer, CALL) {
                    is_grandparent_call = true;
                } else if let Some((Some(around), Position::Alone)) = self.up.get(outer) {
                    is_grandparent_pairs = self.has(*around as usize, FIRST_PAIR);
                }
            }
        } else {
            is_grandparent_pairs = is_in_pairs;
        }
        if !starts_with_pair && !is_grandparent_pairs {
            return Some(false);
        }
        // `(value)` isn't a list.
        if count == 1
            && !starts_with_pair
            && !self.is_several_nodes(self.at(open) + 1, self.at(close))?
        {
            return Some(false);
        }
        if is_call {
            let at = self.at(open);
            if at >= 2
                && self.flat.get(at - 2..at) == Some(b"if")
                && at - 2 == self.group_start(open)
            {
                return Some(false);
            }
        }
        if self.request.is_variable {
            return Some(true);
        }
        if is_grandparent_pairs {
            return match is_call || position == Position::Other {
                true => None,
                false => Some(true),
            };
        }
        Some(is_grandparent_call)
    }

    fn state_of(&mut self, open: usize, outer: Option<usize>, item: &Item) -> Option<State> {
        // A call with plain arguments that isn't an item of its own among pairs.
        if self.flags(open) & (FIRST_PAIR | COMPLEX | CALL) == CALL
            && (item.colon.is_some() || outer.is_none_or(|it| !self.has(it, FIRST_PAIR)))
        {
            return Some(State {
                is_forced: false,
                is_map: false,
            });
        }
        let position = self.position_of(open, item);
        *self.up.get_mut(open)? = (outer.map(|it| it as u32), position);
        if self.is_map(open, outer, position)? {
            return Some(State {
                is_forced: true,
                is_map: true,
            });
        }
        let is_forced = self.has(open, COMPLEX) && self.is_content_forced(open)?;
        Some(State {
            is_forced,
            is_map: false,
        })
    }

    /// The item whose records start at `first` and whose text starts at `from`, in the group that `close` ends, or in
    /// the list at the top if `close` is the number of records.
    fn item(&self, first: usize, close: usize, from: usize) -> Item {
        let (mut colon, mut comment) = (None, None);
        let mut i = first;
        while i < close {
            match self.kind(i) {
                Some(Kind::Comma) => break,
                Some(Kind::Open) => i = self.link(i),
                Some(Kind::Colon) => colon = colon.or(Some(i)),
                Some(Kind::Comment) => comment = Some(i),
                _ => {}
            }
            i += 1;
        }
        let to = match i < self.records.len() {
            true => self.at(i),
            false => self.flat.len(),
        };
        Item {
            first,
            end: i,
            colon,
            comment,
            from,
            to,
        }
    }

    fn is_content_forced(&mut self, open: usize) -> Option<bool> {
        let close = self.link(open);
        let mut first = open + 1;
        let mut from = self.at(open) + 1;
        loop {
            if first < close && self.kind(first) == Some(Kind::Comment) {
                return Some(true);
            }
            let item = self.item(first, close, from);
            if item.comment.is_some() || self.is_item_forced(&item, Some(open))? {
                return Some(true);
            }
            if item.end >= close {
                return Some(false);
            }
            if self.has(item.end, EMPTY_LINE) && self.keeps_empty_line(&item)? {
                return Some(true);
            }
            from = item.to + 2;
            first = item.end + 1;
        }
    }

    /// Is one of the groups of the item broken whether it fits or not?
    fn is_item_forced(&mut self, item: &Item, outer: Option<usize>) -> Option<bool> {
        let mut i = item.first;
        while i < item.end {
            if self.kind(i) == Some(Kind::Open) {
                if self.state_of(i, outer, item)?.is_forced {
                    return Some(true);
                }
                i = self.link(i);
            }
            i += 1;
        }
        Some(false)
    }

    /// An empty line follows the comma after the item. It's kept after an item of several nodes, if
    /// `is_next_line_empty` finds it from where the last node ends: for a call that's after its name.
    fn keeps_empty_line(&self, item: &Item) -> Option<bool> {
        let (from, to) = (item.from, item.to);
        if item.colon.is_none() && !self.is_several_nodes(from, to)? {
            return Some(false);
        }
        if to > 0 && self.flat_byte(to - 1) == b')' {
            // A call, or parentheses without a name?
            let mut depth = 0;
            let mut p = to - 1;
            loop {
                match self.flat_byte(p) {
                    b')' => depth += 1,
                    b'(' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    quote @ (b'"' | b'\'') => {
                        p = p.checked_sub(1)?;
                        while self.flat_byte(p) != quote {
                            p = p.checked_sub(1)?;
                        }
                    }
                    _ => {}
                }
                p = p.checked_sub(1)?;
            }
            return Some(!(p > 0 && is_call_name_byte(self.flat_byte(p - 1))));
        }
        let mut q = to;
        while q > from && self.flat_byte(q - 1) != b' ' {
            q -= 1;
        }
        match self.flat_byte(q) {
            b'-' | b'+' => None,
            _ => Some(true),
        }
    }

    // ───────────────────────────── the parts of a value ─────────────────────────────

    /// The nodes of an item that doesn't fit on its line: as many on each line as fit. `level` is that of the lines
    /// after the first, `column` is where the first one starts.
    fn write_fill(&mut self, item: &Item, level: usize, column: usize) -> Option<()> {
        let (from, to) = (item.from, item.to);
        let width = self.page.width;
        // Nothing breaks between a key and the first node of its value.
        let first_node = item.colon.map_or(from, |colon| self.at(colon) + 2);
        let mut position = column;
        let mut start = from;
        let mut end = self.next_blank(first_node, to);
        loop {
            let len = end - start;
            let c = self.flat_byte(if start == from { first_node } else { start });
            // There's a plain blank before an operator, not a possible line break.
            let is_operand = (is_call_name_byte(c) && c != b'-' && c != b'.')
                || matches!(c, b'"' | b'\'' | b'#' | b'@');
            if !is_operand {
                return None;
            }
            if start > from {
                if position + 1 + len <= width {
                    self.byte(b' ');
                    position += 1;
                } else {
                    self.break_line(level)?;
                    position = self.column_of(level);
                }
            }
            if position + len > width {
                return None;
            }
            self.copy(start, end);
            position += len;
            if end >= to {
                return Some(());
            }
            start = end + 1;
            end = self.next_blank(start, to);
        }
    }

    /// Writes an item that starts at `column`, on a line that's indented by `level`. `tail` columns follow it before
    /// the line can break. `is_after_comments`: it's in one group with the comments before it.
    fn write_item(
        &mut self,
        item: &Item,
        level: usize,
        column: usize,
        tail: usize,
        outer: Option<usize>,
        is_after_comments: bool,
    ) -> Option<()> {
        let (from, to) = (item.from, item.to);
        let len = to - from;
        let width = self.page.width;
        let control = self.request.is_in_control_directive;
        let is_forced = self.is_item_forced(item, outer)?;
        // A comment breaks the group that it's in, and what's no `fill` breaks everywhere then.
        if is_after_comments && control {
            return None;
        }
        if !is_forced && column + len + tail <= width {
            self.copy(from, to);
            return Some(());
        }
        // After the line break of a comment, the colon's group is measured with all that follows it on the line. So a
        // pair that fits except for its comma breaks at its colon there.
        if is_after_comments && !is_forced && column + len <= width {
            return None;
        }
        let open = (item.first..item.end).find(|it| self.kind(*it) == Some(Kind::Open));
        let position = open.map_or(Position::Other, |open| self.position_of(open, item));
        if let (Some(open), true) = (open, position != Position::Other) {
            let is_pair = position == Position::PairValue;
            // A `fill` doesn't look at what follows it.
            if !is_forced && is_pair && column + len <= width && !control {
                self.copy(from, to);
                return Some(());
            }
            if is_after_comments && !is_pair {
                return None;
            }
            let at = self.at(open);
            let state = self.state_of(open, outer, item)?;
            // A sign before the name is a node of its own.
            if self.flat_byte(self.group_start(open)) == b'-' {
                return None;
            }
            let is_call = self.has(open, CALL);
            if is_pair && column + (at - from) + 1 > width {
                // A pair that doesn't fit up to its `(`: the line breaks after the colon.
                if is_after_comments || control || !is_call {
                    return None;
                }
                let value = self.at(item.colon?) + 2;
                self.copy(from, value - 1);
                self.break_line(level + 1)?;
                if !is_forced && self.column_of(level + 1) + (to - value) + tail <= width {
                    self.copy(value, to);
                    return Some(());
                }
                self.copy(value, at);
                return self.write_group(open, level + 2, level + 1, state.is_map);
            }
            self.copy(from, at);
            let inner = match is_pair && (is_call || is_after_comments || control) {
                true => level + 2,
                false => level + 1,
            };
            return self.write_group(open, inner, inner - 1, state.is_map);
        }
        if is_forced || is_after_comments {
            return None;
        }
        let has_blank = self.next_blank(from, to) < to;
        if control && (item.colon.is_some() || has_blank) {
            return None;
        }
        if item.colon.is_none() && open.is_none() && !has_blank {
            // However many nodes it is, there's no place in it where a line can break.
            self.copy(from, to);
            return Some(());
        }
        if item.colon.is_none() && !self.is_several_nodes(from, to)? {
            // One word. A call that isn't alone in its item has a blank next to it.
            if open.is_some() {
                return None;
            }
            self.copy(from, to);
            return Some(());
        }
        if column + len <= width {
            self.copy(from, to);
            return Some(());
        }
        self.write_fill(item, level + 1, column)
    }

    /// Writes the group at `open`, broken: the `(`, each item on a line, the `)`.
    fn write_group(
        &mut self,
        open: usize,
        item_level: usize,
        close_level: usize,
        is_map: bool,
    ) -> Option<()> {
        let close = self.link(open);
        // Between empty parentheses that don't fit there are two possible line breaks.
        if self.link(close) == 0 {
            return None;
        }
        self.byte(b'(');
        let has_comma_at_end = is_map && self.page.trailing_comma;
        let column = self.column_of(item_level);
        let mut first = open + 1;
        let mut from = self.at(open) + 1;
        loop {
            let mut has_comments = false;
            while first < close && self.kind(first) == Some(Kind::Comment) {
                self.break_line(item_level)?;
                self.comment(first);
                first += 1;
                has_comments = true;
            }
            let item = self.item(first, close, from);
            if has_comments && item.colon.is_none() {
                return None;
            }
            let is_last = item.end >= close;
            self.break_line(item_level)?;
            if let Some(comment) = item.comment {
                // With the comment in it, the item is a broken group of which the pair is one part: it stays on its
                // line if it fits, whatever follows.
                if item.colon.is_none() || self.request.is_in_control_directive {
                    return None;
                }
                let pair = Item {
                    end: comment,
                    ..item
                };
                let tail = usize::from(has_comments && has_comma_at_end);
                self.write_item(&pair, item_level, column, tail, Some(open), has_comments)?;
                if has_comma_at_end {
                    self.byte(b',');
                }
                self.byte(b' ');
                self.comment(comment);
                self.break_line(close_level)?;
                self.byte(b')');
                return Some(());
            }
            let tail = usize::from(!(is_last && !has_comma_at_end && !has_comments));
            self.write_item(&item, item_level, column, tail, Some(open), has_comments)?;
            if is_last {
                break;
            }
            self.byte(b',');
            if self.has(item.end, EMPTY_LINE) && self.keeps_empty_line(&item)? {
                self.byte(b'\n');
            }
            from = item.to + 2;
            first = item.end + 1;
        }
        if has_comma_at_end {
            self.byte(b',');
        }
        self.break_line(close_level)?;
        self.byte(b')');
        Some(())
    }

    /// The list at the top of a value: items with commas between them, outside of all parentheses.
    fn write_list(&mut self, column: usize) -> Option<()> {
        let Request {
            level,
            tail_width: tail,
            breaks_list,
            is_declaration,
            ..
        } = self.request;
        let count = self.records.len();
        let width = self.page.width;
        let end = self.flat.len();
        // Is there an item of several nodes? Is a break forced?
        let (mut has_several, mut is_forced, mut are_all_forced) = (false, false, true);
        let (mut first, mut from) = (0, 0);
        loop {
            let item = self.item(first, count, from);
            match self.is_several_nodes(from, item.to) {
                Some(is_several) => has_several |= is_several,
                // At the very start of a value, a sign is part of the word.
                None if from == 0
                    && self.flat_byte(0) == b'-'
                    && self.flat_byte(1) != b'@'
                    && (self.flat.get(..item.to))
                        .is_some_and(|it| !bun_core::strings::contains(it, b"#{")) => {}
                None => return None,
            }
            match self.is_item_forced(&item, None)? {
                true => is_forced = true,
                false => are_all_forced = false,
            }
            if item.end >= count {
                break;
            }
            from = item.to + 2;
            first = item.end + 1;
        }
        let inner = level + 1;
        let inner_column = self.column_of(inner);
        // In a `fill`, the line breaks between two items one of which is broken.
        if (has_several && breaks_list) || (!has_several && are_all_forced && is_declaration) {
            (first, from) = (0, 0);
            loop {
                let item = self.item(first, count, from);
                let is_last = item.end >= count;
                self.break_line(inner)?;
                let tail = if is_last { tail } else { 1 };
                self.write_item(&item, inner, inner_column, tail, None, false)?;
                if is_last {
                    return Some(());
                }
                self.byte(b',');
                from = item.to + 2;
                first = item.end + 1;
            }
        }
        if is_forced {
            return None;
        }
        if column + end + tail <= width {
            self.copy(0, end);
            return Some(());
        }
        if has_several {
            return None;
        }
        // As many items on a line as fit, each with its comma.
        let mut position = column;
        if is_declaration {
            self.break_line(inner)?;
            position = inner_column;
        }
        (first, from) = (0, 0);
        loop {
            let item = self.item(first, count, from);
            let is_last = item.end >= count;
            let to = if is_last { end } else { item.to + 1 };
            let len = to - from;
            if from > 0 {
                if position + 1 + len <= width {
                    self.byte(b' ');
                    position += 1;
                } else {
                    self.break_line(inner)?;
                    position = inner_column;
                }
            }
            if position + len > width {
                return None;
            }
            self.copy(from, to);
            position += len;
            if is_last {
                return Some(());
            }
            from = to + 1;
            first = item.end + 1;
        }
    }
}

/// Appends to `out` the blank before the value that `values` has read last, unless the value starts on a line of its
/// own, and the value. Returns whether there's a line break in that, or `None`, with anything in `out`, if this isn't
/// the place to tell what's printed.
pub(super) fn write_value(
    values: &mut Values,
    up: &mut Vec<(Option<u32>, Position)>,
    css: &[u8],
    is_scss: bool,
    page: Page,
    request: Request,
    out: &mut Vec<u8>,
) -> Option<bool> {
    up.clear();
    up.resize(values.records.len(), (None, Position::Other));
    let mut layout = Layout {
        flat: values.flat(css),
        css,
        records: &values.records,
        up,
        out,
        page,
        is_scss,
        request,
        is_at_start: true,
        has_line_breaks: false,
    };
    let column = layout.column_of(request.level) + request.head_width;
    if values.top_commas > 0 {
        layout.write_list(column)?;
    } else {
        let item = Item {
            first: 0,
            end: layout.records.len(),
            colon: None,
            comment: None,
            from: 0,
            to: layout.flat.len(),
        };
        let Request {
            level, tail_width, ..
        } = request;
        layout.write_item(&item, level, column, tail_width, None, false)?;
    }
    Some(layout.has_line_breaks)
}
