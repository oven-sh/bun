//! What a line can end with besides an expression and the body of a function or a class.

use super::*;
use crate::js::print::switch_statement::write_cases_after_head;
use crate::js::print::ts_declarations::{
    write_enum_body_after_head, write_interface_body_after_head, write_module_body_after_head,
};

#[derive(Copy, Clone)]
pub(super) enum Hole<'a> {
    /// The ` { .. }` of an interface, an enum or a namespace, or the cases of a `switch`.
    BodyOf(Stmt<'a>),
    /// A type literal that's certain to break.
    Type(TypeNode<'a>),
    /// Any type, after the `| ` that starts its line.
    UnionMember(TypeNode<'a>),
    /// Any expression, on a line of its own. In a group of its own, or not.
    Expr(Expr<'a>, bool),
    /// Any parameter, on a line of its own.
    Param(Param<'a>),
    /// A line break and a statement, one level deeper.
    Statement(Stmt<'a>),
    /// The indentation is one level less deep from here on, without a line break.
    EndIndent,
}

impl<'a> Hole<'a> {
    pub(super) fn write(self, f: &mut Formatter<'a>) {
        match self {
            // What follows the last member is there if the group around it is broken. Without one of its own, that's
            // whatever is around the statement, which can be printed flat: a variant that's tried.
            Hole::BodyOf(statement) => match statement.kind() {
                StmtKind::Interface(interface) => {
                    let body =
                        format_with(|f| write_interface_body_after_head(statement, interface, f));
                    group(&body).should_expand(true).fmt(f);
                }
                StmtKind::Enum(declaration) => {
                    let body =
                        format_with(|f| write_enum_body_after_head(statement, declaration, f));
                    group(&body).should_expand(true).fmt(f);
                }
                StmtKind::Module(module) => write_module_body_after_head(statement, module, f),
                StmtKind::Switch { cases, .. } => write_cases_after_head(statement, cases, f),
                _ => {}
            },
            Hole::Type(ty) => {
                f.context_mut().short_cuts.follows_line = ty.tag() == TypeTag::Object;
                ty.fmt(f);
                f.context_mut().short_cuts.follows_line = false;
            }
            Hole::UnionMember(ty) => CertainIf(false, &align(2, &ty)).fmt(f),
            Hole::Expr(e, true) => CertainIf(false, &group(&e)).fmt(f),
            Hole::Expr(e, false) => CertainIf(false, &e).fmt(f),
            Hole::Param(param) => CertainIf(false, &param).fmt(f),
            Hole::Statement(statement) => {
                f.context_mut().short_cuts.depth += 1;
                f.write_element(FormatElement::Tag(Tag::StartIndentWithLine(LineMode::Hard)));
                f.context_mut().short_cuts.next_in_list = statement.span().start + 1;
                statement.fmt(f);
                f.write_element(FormatElement::Tag(Tag::EndIndent));
                f.context_mut().short_cuts.depth -= 1;
            }
            Hole::EndIndent => {
                f.context_mut().short_cuts.depth -= 1;
                f.write_element(FormatElement::Tag(Tag::EndIndent));
            }
        }
    }
}

/// Where a [`Line`] is, to go back to.
#[derive(Copy, Clone)]
pub(super) struct Mark {
    room: usize,
    start: usize,
    len: usize,
    extra: usize,
    limit: usize,
    taken: usize,
    checked_to: u32,
    parts: usize,
    breaks: bool,
}

impl<'a> Line<'_, 'a> {
    pub(super) fn mark(&self) -> Mark {
        Mark {
            room: self.room,
            start: self.start,
            len: self.len,
            extra: self.extra,
            limit: self.limit,
            taken: self.taken,
            checked_to: self.checked_to,
            parts: self.parts.len(),
            breaks: self.breaks,
        }
    }

    /// Takes back what has been written since `mark`.
    pub(super) fn go_back_to(&mut self, mark: Mark) {
        (self.room, self.start, self.len) = (mark.room, mark.start, mark.len);
        self.extra = mark.extra;
        (self.limit, self.taken, self.checked_to) = (mark.limit, mark.taken, mark.checked_to);
        self.breaks = mark.breaks;
        self.parts.truncate(mark.parts);
    }

    /// True if something that's certain to break has been written since `mark`.
    pub(super) fn has_parts_since(&self, mark: Mark) -> bool {
        self.parts.len() != mark.parts
    }

    /// The limit of the line of `mark`, on which nothing has ended since: what has been measured since then has moved it.
    pub(super) fn limit_since(&self, mark: Mark) -> usize {
        (mark.limit).saturating_add(self.extra.saturating_sub(mark.extra))
    }

    /// True if there's a comment in `span`, or something that owns one.
    pub(super) fn has_comments_in(&self, span: Span) -> bool {
        !self.is_quiet && self.f.comments().has_comment_or_owner_in(span)
    }

    /// True if the column at which the line starts is known, so that what's too wide for it is certain to break.
    pub(super) fn is_certain(&self) -> bool {
        self.f.context().short_cuts.is_certain
    }

    /// Ends the line with `hole`, whose source is at `span` and which starts with `after` columns of text on this line.
    pub(super) fn end_line_with_hole(&mut self, hole: Hole<'a>, span: Span, after: u32) -> Written {
        self.end_line_with(Part::Hole(hole), span, after)
    }

    /// Ends the indentation that a [`Line::break_line`] has started. What's written next is still on the last line
    /// that's indented, and nothing but the end of the item follows that line.
    pub(super) fn end_indent(&mut self) {
        self.parts.push(Part::Hole(Hole::EndIndent));
    }

    /// Writes something on a line of its own, which `after` more columns follow: with `write` if that takes it and it
    /// fits, else as `hole`, the long way. Its source is at `span`.
    pub(super) fn on_own_line(
        &mut self,
        span: Span,
        after: usize,
        hole: Hole<'a>,
        write: impl FnOnce(&mut Self) -> Written,
    ) -> Written {
        self.check_source_up_to(span.start)?;
        let mark = self.mark();
        (self.breaks, self.limit) = (false, mark.limit.saturating_sub(after));
        let written = write(self).and_then(|()| self.check_source_up_to(span.end));
        if written.is_ok() && !self.has_parts_since(mark) {
            (self.breaks, self.limit) = (mark.breaks, self.limit_since(mark));
            return Ok(());
        }
        self.go_back_to(mark);
        // That all of this is too wide has been found by counting its bytes, before all of it was looked at.
        if !self.f.is_plain_source(span) || self.has_comments_in(span) {
            return Err(Refused);
        }
        self.end_text(None)?;
        self.parts.push(Part::Hole(hole));
        self.checked_to = span.end;
        // How wide its last line is isn't known.
        self.start_line(0);
        self.limit = usize::MAX;
        Ok(())
    }
}
