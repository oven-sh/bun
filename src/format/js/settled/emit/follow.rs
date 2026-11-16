//! A comparison that follows the line breaks of the source. The source says which groups are expanded, so what's left
//! of the printer's work is to check that each of them has to be: it has a forced break, or it's too wide.
//!
//! The width of a group on one line follows from the offsets of its ends, less the bytes in between that wouldn't be
//! printed on one line.

use super::*;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Pending {
    Nothing,
    Space,
    /// Nothing has been printed on this line.
    Indentation,
}

/// The printer's `Indention`
#[derive(Copy, Clone, Default)]
struct Indention {
    tabs: u16,
    spaces: u16,
    aligns: u16,
}

#[derive(Copy, Clone, Default)]
pub(super) struct Indentation {
    current: Indention,
    /// The one below it on the stack, if it's known.
    outer: Option<Indention>,
}

#[derive(Copy, Clone)]
pub(super) struct Position {
    column: i32,
    /// See [`Emitter::flat_offset`].
    flat_offset: i32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Group,
    /// A group that isn't measured, because it's in a [`Kind::FlatVariant`].
    GroupInFlatVariant,
    /// A variant of a `BestFitting` that's printed flat, except for its groups with forced breaks.
    FlatVariant,
    /// Whoever starts it checks that it's expanded.
    ExpandedVariant,
}

pub(super) struct Open {
    kind: Kind,
    is_expanded: bool,
    id: Option<GroupId>,
    start: Position,
    forced_breaks: u32,
    lines: u32,
}

/// A measurement that ends at the next possible line break.
struct Measurement {
    /// The offset, less [`Follow::not_on_line`], at which the line is full.
    limit: i32,
    must_fit: bool,
}

#[derive(Copy, Clone, Default)]
struct Watch {
    is_on: bool,
    /// It's measured in flat mode.
    is_flat: bool,
    /// The function whose signature can't break.
    function: Id,
    first_line: Option<i32>,
}

#[derive(Default)]
pub(in super::super) struct Follow {
    pub(super) open: Vec<Open>,
    measurements: Vec<Measurement>,
    expanded: Vec<GroupId>,
    watch: Watch,
    /// There's a measurement or a watch.
    pub(super) is_waiting: bool,
    pub(super) indentation: Indentation,
    pending_indention: Indention,
    pub(super) forced_breaks: u32,
    lines: u32,
    /// The offset after the last empty line.
    after_empty_line: u32,
    /// The offset, less the column.
    origin: i32,
    /// The number of bytes in line breaks and indentation, and by which characters are narrower than their encoding.
    not_on_line: i32,
    /// The width of what's only printed in expanded groups, less that of what's only printed in flat ones.
    not_flat: i32,
    line_width: i32,
    indent_width: u16,
    uses_tabs: bool,
}

impl Follow {
    pub(in super::super) fn set_options(&mut self, options: &FormatOptions) {
        self.line_width = options.line_width.value() as i32;
        self.indent_width = options.indent_width.value() as u16;
        self.uses_tabs = options.indent_style.is_tab();
    }

    #[inline]
    fn push(&mut self, next: Indention) -> Indentation {
        let before = self.indentation;
        self.indentation = Indentation {
            current: next,
            outer: Some(before.current),
        };
        before
    }

    /// Returns what to restore.
    #[inline]
    pub(super) fn indent(&mut self) -> Indentation {
        let current = self.indentation.current;
        self.push(match self.uses_tabs {
            true => Indention {
                tabs: current.tabs.wrapping_add(current.aligns).wrapping_add(1),
                ..Indention::default()
            },
            false => Indention {
                spaces: current.spaces.wrapping_add(self.indent_width),
                ..current
            },
        })
    }

    pub(super) fn align(&mut self, count: u32) -> Indentation {
        let current = self.indentation.current;
        self.push(Indention {
            tabs: current.tabs,
            spaces: current.spaces.wrapping_add(count as u16),
            aligns: current.aligns.wrapping_add(1),
        })
    }

    pub(super) fn dedent(&mut self) -> Indentation {
        let before = self.indentation;
        let too_deep = Indention {
            tabs: u16::MAX / 2,
            ..Indention::default()
        };
        self.indentation = Indentation {
            current: before.outer.unwrap_or(too_deep),
            outer: None,
        };
        before
    }

    fn width_of(&self, indention: Indention) -> i32 {
        i32::from(indention.tabs) * i32::from(self.indent_width) + i32::from(indention.spaces)
    }

    #[inline]
    pub(super) fn is_expanded(&self, id: GroupId) -> bool {
        self.expanded.contains(&id)
    }

    /// True if a measurement ends at the next possible line break, so that it sees what's printed in expanded groups.
    pub(super) fn is_measuring_as_expanded(&self) -> bool {
        let kind = self.open.last().map(|it| it.kind);
        let may_be_flat = matches!(kind, Some(Kind::FlatVariant | Kind::GroupInFlatVariant));
        (self.measurements.iter()).any(|it| !it.must_fit || !may_be_flat)
            || (self.watch.is_on && !self.watch.is_flat)
    }

    pub(super) fn is_in_flat_variant(&self) -> bool {
        self.open
            .last()
            .is_some_and(|it| it.kind == Kind::FlatVariant)
    }
}

impl Emitter<'_, '_> {
    /// Returns whether the statement has a group, if it's certain to be printed as it is, apart from its holes.
    pub(in super::super) fn follow_statement(
        &mut self,
        id: Id,
        indentation: &[u8],
    ) -> Option<bool> {
        let (node, len) = (self.node(id), u16::try_from(indentation.len()).ok()?);
        let follow = &mut *self.follow;
        follow.open.clear();
        follow.measurements.clear();
        follow.expanded.clear();
        (follow.watch, follow.is_waiting) = (Watch::default(), false);
        let (tabs, spaces) = if follow.uses_tabs { (len, 0) } else { (0, len) };
        let current = Indention {
            tabs,
            spaces,
            aligns: 0,
        };
        follow.indentation = Indentation {
            current,
            outer: None,
        };
        follow.origin = node.start as i32 - follow.width_of(current);
        (follow.not_on_line, follow.not_flat) = (0, 0);
        self.has_given_up = false;
        self.flat = sink::Flat {
            is_on: true,
            is_following: true,
            skips: true,
            cursor: node.start,
            ..sink::Flat::OFF
        };
        self.statement(id);
        self.stop_measuring(true);
        let flat = std::mem::replace(&mut self.flat, sink::Flat::OFF);
        self.follow.expanded.clear();
        self.follow.open.clear();
        self.follow.is_waiting = false;
        (flat.matches && flat.cursor == node.end && flat.pending == Pending::Nothing)
            .then_some(flat.has_group)
    }

    #[inline]
    fn offset_on_line(&self) -> i32 {
        self.flat.cursor as i32 - self.follow.not_on_line
    }

    /// Advances by the width of what's written, if it were on one line.
    #[inline]
    fn flat_offset(&self) -> i32 {
        self.offset_on_line() - self.follow.not_flat
    }

    #[inline]
    pub(super) fn position(&self) -> Position {
        Position {
            column: match self.flat.pending {
                Pending::Indentation => self.follow.width_of(self.follow.pending_indention),
                _ => self.flat.cursor as i32 - self.follow.origin,
            },
            flat_offset: self.flat_offset(),
        }
    }

    #[inline(never)]
    pub(super) fn take_indentation(&mut self) {
        let indention = self.follow.pending_indention;
        let (tabs, spaces) = (usize::from(indention.tabs), usize::from(indention.spaces));
        let start = self.flat.cursor as usize;
        self.flat.pending = Pending::Nothing;
        let Some(text) = self.src.get(start..start + tabs + spaces) else {
            return self.not_flat();
        };
        let (first, second) = text.split_at(tabs);
        self.flat.matches &= first.iter().all(|&b| b == b'\t') && second.iter().all(|&b| b == b' ');
        self.flat.cursor += text.len() as u32;
        self.follow.not_on_line += text.len() as i32;
        self.follow.origin = self.flat.cursor as i32 - self.follow.width_of(indention);
    }

    /// `text` has no line break, and ends at the cursor.
    #[cold]
    pub(super) fn note_width(&mut self, text: &[u8]) {
        let excess = text.len() as i32 - self.f.string_width(text) as i32;
        self.follow.not_on_line += excess;
        self.follow.origin += excess;
    }

    /// `text` ends at the cursor.
    pub(super) fn followed_text(&mut self, text: &[u8]) {
        let (options, end) = (self.f.options(), self.flat.cursor);
        let (flavor, tab) = (options.flavor, options.indent_width.value());
        let width_of = |text: &[u8]| TextWidth::from_javascript(text, flavor, tab);
        let width = width_of(text);
        if !width.is_multiline() {
            let excess = text.len() as i32 - width.value() as i32;
            self.follow.not_on_line += excess;
            self.follow.origin += excess;
            return;
        }
        let excess = text.len() as i32 - width.value() as i32;
        self.follow.not_on_line += excess;
        self.stop_measuring(true);
        self.force_break();
        let last = strings::last_index_of_char(text, b'\n').and_then(|it| text.get(it + 1..));
        self.follow.origin = end as i32 - width_of(last.unwrap_or_default()).value() as i32;
        self.follow.lines += 1;
    }

    pub(super) fn force_break(&mut self) {
        self.follow.forced_breaks += 1;
        self.flat.matches &= self.flat.is_following && self.flat.depth < self.flat.flat_from;
    }

    fn push_open(&mut self, kind: Kind, is_expanded: bool, id: Option<GroupId>) {
        let open = Open {
            kind,
            is_expanded,
            id,
            start: self.position(),
            forced_breaks: self.follow.forced_breaks,
            lines: self.follow.lines,
        };
        self.follow.open.push(open);
    }

    pub(super) fn open_group(&mut self, mode: GroupMode, id: Option<GroupId>) {
        let kind = match self.follow.is_in_flat_variant() {
            true => Kind::GroupInFlatVariant,
            false => Kind::Group,
        };
        self.push_open(kind, !mode.is_flat(), id);
        self.follow.forced_breaks += u32::from(!mode.is_flat());
    }

    /// Ends with [`Emitter::end_group`].
    pub(super) fn start_flat_variant(&mut self) {
        (self.flat.depth, self.flat.has_group) = (self.flat.depth + 1, true);
        self.push_open(Kind::FlatVariant, false, None);
    }

    /// Ends with [`Emitter::end_group`].
    pub(super) fn start_expanded_variant(&mut self) {
        (self.flat.depth, self.flat.has_group) = (self.flat.depth + 1, true);
        self.push_open(Kind::ExpandedVariant, true, None);
    }

    pub(super) fn close_group(&mut self) {
        let Some(open) = self.follow.open.pop() else {
            return;
        };
        if self.flat.flat_from == self.flat.depth {
            self.flat.flat_from = u32::MAX;
            if open.kind == Kind::Group {
                self.must_fit();
            }
            return;
        }
        let is_forced = open.forced_breaks != self.follow.forced_breaks;
        let has_line_break = open.lines != self.follow.lines;
        match open.kind {
            Kind::Group if is_forced => {}
            Kind::Group if open.is_expanded => self.must_not_fit(open.start, None),
            Kind::Group if open.id.is_some() && !has_line_break => self.must_fit(),
            Kind::GroupInFlatVariant => self.flat.matches &= is_forced || !has_line_break,
            _ => {}
        }
        if let Some(id) = open.id
            && (is_forced || has_line_break)
        {
            self.follow.expanded.push(id);
        }
    }

    /// The innermost group is flat.
    pub(super) fn make_group_flat(&mut self) {
        if self.flat.depth >= self.flat.flat_from {
            return;
        }
        let follow = &*self.follow;
        self.flat.matches &= follow.open.last().is_some_and(|it| {
            matches!(it.kind, Kind::Group | Kind::GroupInFlatVariant)
                && !it.is_expanded
                && (it.forced_breaks, it.lines) == (follow.forced_breaks, follow.lines)
        });
        self.flat.flat_from = self.flat.depth;
    }

    /// The mode of the innermost group, which isn't known to be flat. If it's expanded, the source continues with a
    /// line break, or with `token` and then a line break.
    pub(super) fn is_expanded(&mut self, token: &str) -> bool {
        if !self.flat.is_following {
            self.not_flat();
            return false;
        }
        let follow = &mut *self.follow;
        let Some(open) = follow.open.last_mut() else {
            return true;
        };
        if open.kind == Kind::FlatVariant {
            return false;
        }
        if !open.is_expanded {
            let rest = self
                .src
                .get(self.flat.cursor as usize..)
                .unwrap_or_default();
            let is_before_token = |rest: &[u8]| {
                (rest.strip_prefix(token.as_bytes()))
                    .is_some_and(|it| token == "| " || it.first() == Some(&b'\n'))
            };
            open.is_expanded = (open.forced_breaks, open.lines)
                != (follow.forced_breaks, follow.lines)
                || rest.first() == Some(&b'\n')
                || (!token.is_empty() && is_before_token(rest.trim_ascii_start()));
            if !open.is_expanded {
                self.flat.flat_from = self.flat.depth;
            }
        }
        open.is_expanded
    }

    pub(super) fn only_if_expanded(&mut self, write: impl FnOnce(&mut Self)) {
        let before = self.flat_offset() + i32::from(self.flat.pending == Pending::Space);
        write(self);
        self.follow.not_flat += (self.flat_offset() - before).max(0);
    }

    pub(super) fn only_if_flat(&mut self, width: u32) {
        self.follow.not_flat -= width as i32;
    }

    pub(super) fn follow_line(&mut self, mode: LineMode) {
        let is_space = matches!(mode, LineMode::SoftOrSpace | LineMode::SoftOrSpaceEmpty);
        if mode.will_break() {
            self.force_break();
            self.flat.matches &= !self.follow.is_in_flat_variant();
        } else if !self.is_expanded("") {
            self.may_break();
            if is_space {
                self.space();
            }
            return;
        }
        if self.follow.is_waiting {
            self.stop_measuring(true);
        }
        let mut cursor = self.flat.cursor;
        let follow = &mut *self.follow;
        if self.flat.pending != Pending::Indentation {
            self.flat.matches &= self.src.get(cursor as usize) == Some(&b'\n');
            cursor += 1;
            follow.not_on_line += i32::from(!is_space && self.flat.pending != Pending::Space);
            follow.lines += 1;
        }
        let is_empty = matches!(
            mode,
            LineMode::Empty | LineMode::SoftOrSpaceEmpty | LineMode::SoftEmpty
        );
        if is_empty && follow.after_empty_line != cursor {
            self.flat.matches &= self.src.get(cursor as usize) == Some(&b'\n');
            cursor += 1;
            follow.not_on_line += 1;
            follow.after_empty_line = cursor;
        }
        follow.pending_indention = follow.indentation.current;
        (self.flat.cursor, self.flat.pending) = (cursor, Pending::Indentation);
    }

    /// What's on this line has to fit, up to the next possible line break.
    pub(super) fn must_fit(&mut self) {
        if self.is_on_long_line(self.flat.cursor.saturating_sub(1))
            || self.is_on_long_line(self.flat.cursor)
        {
            let space = self.follow.line_width - self.position().column;
            self.measure(space, true);
        }
    }

    /// What was written since `start` doesn't fit on that line: up to `first_line`, or else all of it and what follows
    /// up to the next possible line break.
    pub(super) fn must_not_fit(&mut self, start: Position, first_line: Option<i32>) {
        let end = first_line.unwrap_or_else(|| self.flat_offset());
        let space = self.follow.line_width - start.column - (end - start.flat_offset);
        if space >= 0 {
            self.flat.matches &= first_line.is_none();
            self.measure(space, false);
        }
    }

    fn measure(&mut self, space: i32, must_fit: bool) {
        let limit = self.offset_on_line() + space;
        self.follow
            .measurements
            .push(Measurement { limit, must_fit });
        self.follow.is_waiting = true;
    }

    /// At a possible line break. Unless `is_certain`, it may be in flat content, where a measurement goes on.
    #[cold]
    pub(super) fn stop_measuring(&mut self, is_certain: bool) {
        let (offset, flat_offset) = (self.offset_on_line(), self.flat_offset());
        let space = i32::from(self.flat.pending == Pending::Space);
        let follow = &mut *self.follow;
        let kind = follow.open.last().map(|it| it.kind);
        let may_be_flat =
            !is_certain && matches!(kind, Some(Kind::FlatVariant | Kind::GroupInFlatVariant));
        let mut matches = true;
        follow.measurements.retain(|it| {
            let goes_on = it.must_fit && may_be_flat;
            matches &= goes_on || it.must_fit == (offset + space <= it.limit);
            goes_on
        });
        self.flat.matches &= matches;
        let watch = &mut follow.watch;
        if watch.is_on && !(watch.is_flat && may_be_flat && kind == Some(Kind::FlatVariant)) {
            (watch.is_on, watch.first_line) = (false, Some(flat_offset));
        }
        follow.is_waiting = watch.is_on || !follow.measurements.is_empty();
    }

    /// Only the most expanded variant has a line break here.
    pub(super) fn may_break_in_expanded_variant(&mut self) {
        let watch = self.follow.watch;
        self.may_break();
        if watch.is_on && watch.is_flat {
            (self.follow.watch, self.follow.is_waiting) = (watch, true);
        }
    }

    /// Calls `write`. Returns a lower bound for the flat offset of the first line break that a measurement stops at.
    pub(super) fn find_first_line(
        &mut self,
        function: Id,
        is_flat: bool,
        write: impl FnOnce(&mut Self),
    ) -> Option<i32> {
        debug_assert!(!self.follow.watch.is_on || !self.flat.matches);
        let watch = Watch {
            is_on: true,
            is_flat,
            function,
            first_line: None,
        };
        let outer = std::mem::replace(&mut self.follow.watch, watch);
        self.follow.is_waiting = true;
        write(self);
        std::mem::replace(&mut self.follow.watch, outer).first_line
    }

    /// Calls `write`, which writes the signature of `function`.
    #[inline]
    pub(super) fn watched_signature(&mut self, function: Id, write: impl FnOnce(&mut Self)) {
        let watch = self.follow.watch;
        write(self);
        if watch.is_on && watch.function == function {
            (self.follow.watch, self.follow.is_waiting) = (watch, true);
        }
    }

    /// True if `write` writes a line break. It has no other effect.
    pub(super) fn has_line(&mut self, write: impl FnOnce(&mut Self)) -> bool {
        let (flat, follow) = (self.flat, &mut *self.follow);
        let before = (follow.is_waiting, follow.origin, follow.not_on_line);
        follow.is_waiting = false;
        (self.flat.has_line, self.flat.skips) = (false, false);
        self.flat.depth += 1;
        self.flat.flat_from = self.flat.depth;
        write(self);
        let after = std::mem::replace(&mut self.flat, flat);
        self.flat.matches = after.matches;
        (
            self.follow.is_waiting,
            self.follow.origin,
            self.follow.not_on_line,
        ) = before;
        after.has_line
    }
}
