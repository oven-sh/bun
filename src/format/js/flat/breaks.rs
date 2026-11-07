//! What's tried on one line first, and written with line breaks if that's too wide.
//!
//! [`Line::fits_or_breaks`] stands for what the printer does with a group in a group that's broken. The layouts are in
//! `assignments.rs`, `arrows.rs`, `binary.rs`, `chains.rs`, `conditionals.rs`, `suffixes.rs` and, for arguments, in
//! `expressions.rs`. Which layout applies is asked of the predicates of `print/` and `utils/`. `forced.rs` has the line
//! breaks that are there whether the line is too wide or not.
//!
//! A decision to break is right only if all of this holds:
//!
//! 1. The indentation is known ([`Line::is_certain`]). From a guess, a line is written or refused.
//! 2. What's measured is what the printer measures: the group on one line, and what follows it up to the next place
//!    where the line can break ([`Line::tail`]), to the column. One column too many is a line break too many.
//! 3. An attempt ends where the line is full, so nobody has looked at the rest. All of it has to be as wide as it has
//!    bytes and without comments, also what goes the long way in the end ([`Line::has_measured`]).
//! 4. A line break that's forced further on breaks the same groups as a line that's too wide. But where the printer
//!    chooses among variants (a chain on one line or not, an argument hugged or not), a variant fits if it fits up to its
//!    first line break. There it has to be known where that is ([`Line::can_be_on_one_line`], [`Line::ends_line`]).
//! 5. Too wide on a later line says nothing about the groups that start on the first ([`Line::is_first_line_too_wide`]).
//! 6. After what has gone the long way, the width of the line isn't known, and nothing more is decided on that line
//!    ([`Width::Unknown`]). After what can't break and is too wide, nothing fits ([`Width::TooWide`]).
//! 7. Where the right side of an assignment stays on the line of the operator only if it fits up to its first possible
//!    line break, that much has to have been written here ([`Line::must_fit`]).
//! 8. A first line that's too wide is too wide up to the first possible line break only if the line has been broken
//!    there. What says where that is (`breaks_first_at_end_of_line`) takes nothing that its writer keeps on one line.
//! 9. Where the printer chooses among variants in an argument that's hugged, it measures the widest of them. So the line
//!    that a hugged function starts on has no such choice in it ([`Line::check_parameters_of_hugged`]).

use super::*;

/// How far a [`Line`] has come.
#[derive(Copy, Clone)]
pub(super) struct Spot {
    room: usize,
    start: usize,
    pub(super) len: usize,
    limit: usize,
    taken: usize,
    extra: u32,
    width: Width,
    checked_to: u32,
    nesting: u32,
    pub(super) parts: usize,
}

/// What a level of [`Line::fits_or_breaks`] counts for in [`Line::nesting`]. It takes several times the stack that a
/// level of an expression on one line takes.
const NESTING_OF_LINE_BREAKS: u32 = 3;

/// True if nothing can break in an expression with this tag.
pub(super) fn is_unbreakable(tag: ExprTag) -> bool {
    matches!(
        tag,
        ExprTag::String
            | ExprTag::Ident
            | ExprTag::Number
            | ExprTag::This
            | ExprTag::Null
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Regex
            | ExprTag::Template
    )
}

impl<'a> Line<'_, 'a> {
    pub(super) fn spot(&self) -> Spot {
        Spot {
            room: self.room,
            start: self.start,
            len: self.len,
            limit: self.limit,
            taken: self.taken,
            extra: self.extra as u32,
            width: self.width,
            checked_to: self.checked_to,
            nesting: self.nesting,
            parts: self.parts.len(),
        }
    }

    /// Takes back what has been written since `mark`.
    pub(super) fn back_to(&mut self, mark: Spot) {
        self.room = mark.room;
        self.start = mark.start;
        self.len = mark.len;
        self.limit = mark.limit;
        self.taken = mark.taken;
        self.extra = mark.extra as usize;
        self.width = mark.width;
        self.checked_to = mark.checked_to;
        self.nesting = mark.nesting;
        self.parts.truncate(mark.parts);
        self.is_too_wide = false;
    }

    /// True if the attempt since `mark` has failed because the line that `mark` is on is too wide.
    pub(super) fn is_first_line_too_wide(&self, mark: Spot) -> bool {
        self.is_too_wide && self.parts.len() == mark.parts
    }

    /// True if nothing on the line that `mark` is on has gone the long way, but what's certain to break after its
    /// opening bracket.
    pub(super) fn is_first_line_known(&self, mark: Spot) -> bool {
        let first =
            (self.parts.iter().skip(mark.parts)).find(|it| !matches!(it, Part::Text { .. }));
        !matches!(
            first,
            Some(Part::Expr(_) | Part::Aligned(_) | Part::Hole(_))
        )
    }

    /// Refuses unless `columns` more fit on the line.
    pub(super) fn check_room_for(&mut self, columns: usize) -> Written {
        if self.limit != usize::MAX && self.len + columns > self.limit {
            self.is_too_wide = true;
            return Err(Refused);
        }
        Ok(())
    }

    /// Calls `write` for what `tail` columns follow on its last line, and a line break after those: a group in a group
    /// that's broken. It's written on one line if that fits. If not, it's written once more, with [`Line::breaks`].
    /// Nothing is written if it's refused.
    pub(super) fn fits_or_breaks(
        &mut self,
        tail: usize,
        write: &dyn Fn(&mut Line<'_, 'a>) -> Written,
    ) -> Written {
        let nesting = self.nesting;
        if nesting + NESTING_OF_LINE_BREAKS >= MAX_NESTING {
            self.is_too_wide = false;
            return Err(Refused);
        }
        self.nesting += NESTING_OF_LINE_BREAKS;
        let mark = self.spot();
        let outer = (self.breaks, self.tail);
        (self.breaks, self.tail, self.is_too_wide) = (false, tail, false);
        let mut written = match self.width {
            // After something whose width isn't known.
            Width::Known if self.limit == usize::MAX => Err(Refused),
            Width::Known => write(self).and_then(|()| self.check_room_for(tail)),
            Width::TooWide => {
                self.is_too_wide = true;
                Err(Refused)
            }
            Width::Unknown => Err(Refused),
        };
        if written.is_err()
            && self.is_certain
            && !self.is_careful
            && self.is_first_line_too_wide(mark)
        {
            self.back_to(mark);
            (self.breaks, self.has_measured) = (true, true);
            written = write(self).and_then(|()| self.check_room_for(tail));
        }
        (self.breaks, self.tail) = outer;
        if written.is_err() {
            let is_too_wide = self.is_first_line_too_wide(mark);
            self.back_to(mark);
            self.is_too_wide = is_too_wide;
        }
        self.nesting = nesting;
        written
    }

    /// Writes `e`, which `tail` columns and a line break follow. What isn't known how to write goes the long way.
    pub(super) fn expr_before_line_break(&mut self, e: Expr<'a>, tail: usize) -> Written {
        self.expr_in_place_before_line_break(e, Place::Free, tail)
    }

    pub(super) fn expr_in_place_before_line_break(
        &mut self,
        e: Expr<'a>,
        place: Place,
        tail: usize,
    ) -> Written {
        let span = e.outer_span();
        self.check_source_up_to(span.start)?;
        let written = self.fits_or_breaks(tail, &|line| {
            line.last_expr(e, place)?;
            line.check_source_up_to(span.end)
        });
        if written.is_ok() {
            return Ok(());
        }
        if self.parts.len() == self.must_fit {
            return Err(Refused);
        }
        self.check_parentheses(e)?;
        self.check_measured(span)?;
        self.is_too_wide = false;
        self.end_text(None)?;
        self.parts.push(Part::Expr(e));
        self.checked_to = span.end;
        self.start_line_of_unknown_width();
        Ok(())
    }

    /// Starts a line after a part whose last line is as wide as it is.
    pub(super) fn start_line_of_unknown_width(&mut self) {
        self.start_line(0);
        (self.limit, self.width) = (usize::MAX, Width::Unknown);
    }

    /// True if nothing breaks in `e`, however wide it is. What's in the `${}` of a template is printed on one line, but
    /// for the line breaks that are forced: the body of a function.
    pub(super) fn never_breaks(&mut self, e: Expr<'a>) -> bool {
        is_unbreakable(e.tag())
            && (e.tag() != ExprTag::Template
                || self.can_be_on_one_line(|line| line.expr(e, Place::Free)))
    }

    /// Writes `e`, in which nothing can break and which is too wide for the line.
    pub(super) fn unbreakable(&mut self, e: Expr<'a>, place: Place) -> Written {
        if self.parts.len() == self.must_fit {
            return self.expr(e, place);
        }
        (self.limit, self.width) = (usize::MAX, Width::TooWide);
        self.expr(e, place)
    }

    /// Refuses what goes the long way with its parentheses if there's a comment in it: one between a parenthesis and the
    /// expression can belong to what's before it, which has been written here.
    pub(super) fn check_parentheses(&self, e: Expr<'a>) -> Written {
        match e.is_parenthesized() && self.has_comments_in(e.outer_span()) {
            true => Err(Refused),
            false => Ok(()),
        }
    }

    /// Refuses what goes the long way if it has been part of what was measured, unless it's as wide as it has bytes
    /// and has no comment, which forces a line break.
    pub(super) fn check_measured(&mut self, span: Span) -> Written {
        let is_fine = !self.has_measured
            || (self.f.is_plain_source(span)
                && (self.is_quiet || !self.f.comments().has_comment_or_owner_in(span)));
        match is_fine {
            true => Ok(()),
            false => Err(Refused),
        }
    }

    /// True if `write` writes all on one line, however wide that is. Then nothing in it forces a line break. Nothing
    /// stays written.
    pub(super) fn can_be_on_one_line(&mut self, write: impl FnOnce(&mut Self) -> Written) -> bool {
        let mark = self.spot();
        let breaks = self.breaks;
        (self.breaks, self.limit) = (false, usize::MAX);
        let written = write(self);
        self.back_to(mark);
        self.breaks = breaks;
        written.is_ok()
    }

    /// The indentation is one level less deep from the next line break on.
    pub(super) fn outdent(&mut self) -> Written {
        let (limit, width) = (self.limit, self.width);
        let taken = self.taken + (self.len - self.start);
        // What follows on this line can be written by the caller, which the printer has to know where the column is a
        // guess.
        let after = u32::try_from(self.tail).ok().filter(|it| *it <= 7);
        self.end_text(Some(after.ok_or(Refused)?))?;
        self.parts.push(Part::Outdent);
        self.room += self.indent_width;
        // The rest of this line is as far to the right as before.
        self.start_line(taken + self.indent_width);
        if limit == usize::MAX {
            (self.limit, self.width) = (limit, width);
        }
        Ok(())
    }
}
