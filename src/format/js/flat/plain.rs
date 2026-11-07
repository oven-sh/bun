//! Plain expressions: names, `this`, literals, member accesses and calls of those, and operators between them.
//!
//! They're most of what's in a line, and all there is to know about them is in their records: the kind, where they start
//! and end. So they're written from the records ([`File::plain_expr`]), without handles. What's written is what
//! [`Line::expr`] writes. Whatever isn't plain is left to it.

use super::expressions::{SHORTEST_PLACEHOLDER, is_placeholder_in_parentheses};
use super::*;
use crate::js::parentheses::expression::is_name_that_may_need_parentheses;
use bun_sema::hir::{self, ExprId};

/// How many links a chain of member accesses and calls can have here.
const MAX_LINKS: u32 = 24;

impl<'a> Line<'_, 'a> {
    /// Writes `e` if it's plain. Returns `None`, with nothing written, if it isn't.
    #[inline]
    pub(super) fn plain_expr(&mut self, e: Expr<'a>, place: Place) -> Option<Written> {
        let raw = self.f.file().plain_expr(e.id())?;
        self.plain(e.id(), raw, place, false)
    }

    /// [`Line::expr`] for what's directly in a statement other than `export default`, or in a `case`: a condition, say.
    #[inline]
    pub(super) fn expr_of_statement(&mut self, e: Expr<'a>) -> Written {
        let raw = self.f.file().plain_expr(e.id());
        match raw.and_then(|raw| self.plain(e.id(), raw, Place::Other, true)) {
            Some(written) => written,
            None => self.expr(e, Place::Other),
        }
    }

    /// `is_in_statement` as in [`Line::expr_of_statement`]: only a name, a sequence or `in` can need parentheses there.
    fn plain(
        &mut self,
        id: ExprId,
        raw: &hir::Expr,
        place: Place,
        is_in_statement: bool,
    ) -> Option<Written> {
        let file = self.f.file();
        let is_asked = !is_in_statement && place != Place::Free;
        match raw.kind {
            hir::ExprKind::Dot { .. } | hir::ExprKind::Call(_) | hir::ExprKind::Index { .. } => {
                let copied = self.as_plain_chain(id)?;
                if is_asked
                    && place == Place::Other
                    && needs_parentheses(file.handle_of_plain_expr(id), self.f)
                {
                    return None;
                }
                Some(self.plain_chain(id, copied))
            }
            hir::ExprKind::Binary { op, left, right }
                if !matches!(op, BinOp::Comma | BinOp::In) =>
            {
                if is_asked && needs_parentheses(file.handle_of_plain_expr(id), self.f) {
                    return None;
                }
                Some(self.nested(|line| line.plain_binary(op, left, right)))
            }
            hir::ExprKind::Unary { op, operand } => {
                if is_asked && needs_parentheses(file.handle_of_plain_expr(id), self.f) {
                    return None;
                }
                Some(self.nested(|line| line.plain_unary(op, operand)))
            }
            _ => self.plain_leaf(raw, place),
        }
    }

    /// `left op right`, without parentheses.
    fn plain_binary(&mut self, op: BinOp, left: ExprId, right: ExprId) -> Written {
        let file = self.f.file();
        let left_raw = file.plain_expr(left).ok_or(Refused)?;
        let right_raw = file.plain_expr(right).ok_or(Refused)?;
        // `a && (b && c)` loses its parentheses.
        if matches!(right_raw.kind, hir::ExprKind::Binary { op: right_op, .. } if right_op == op) {
            return Err(Refused);
        }
        match left_raw.kind {
            // One chain, without the parentheses that `(a | b) | c` would get otherwise.
            hir::ExprKind::Binary {
                op: left_op,
                left,
                right,
            } if left_op != BinOp::Comma && should_flatten(op, left_op) => {
                self.nested(|line| line.plain_binary(left_op, left, right))?;
            }
            _ => self.plain_operand(left, left_raw, op, false)?,
        }
        self.byte(b' ')?;
        self.token(bin_op_text(op))?;
        self.byte(b' ')?;
        self.plain_operand(right, right_raw, op, true)
    }

    /// An operand of `parent`.
    fn plain_operand(
        &mut self,
        id: ExprId,
        raw: &hir::Expr,
        parent: BinOp,
        is_right: bool,
    ) -> Written {
        match raw.kind {
            hir::ExprKind::Binary { op, left, right }
                if !matches!(op, BinOp::Comma | BinOp::In) =>
            {
                let has_parentheses = match parent.is_logical() && op.is_logical() {
                    true => parent != op,
                    false => operand_needs_parentheses(parent, op, is_right),
                };
                if has_parentheses {
                    self.byte(b'(')?;
                }
                self.nested(|line| line.plain_binary(op, left, right))?;
                if has_parentheses {
                    self.byte(b')')?;
                }
                Ok(())
            }
            // `(-a) ** b`, `(!a) in b`
            hir::ExprKind::Unary { op, operand }
                if is_right || !matches!(parent, BinOp::Pow | BinOp::In | BinOp::Instanceof) =>
            {
                self.nested(|line| line.plain_unary(op, operand))
            }
            _ => self.plain_operand_of_any_operator(id, raw),
        }
    }

    /// `!operand`, `operand++`, without parentheses.
    fn plain_unary(&mut self, op: UnOp, operand: ExprId) -> Written {
        let raw = self.f.file().plain_expr(operand).ok_or(Refused)?;
        if op.is_update() && !op.is_prefix() {
            self.plain_operand_of_any_operator(operand, raw)?;
            return self.token(op.as_str());
        }
        self.token(op.as_str())?;
        if op.is_keyword() {
            self.byte(b' ')?;
        }
        self.plain_operand_of_any_operator(operand, raw)
    }

    /// No operator needs parentheses around a member access or a call.
    fn plain_operand_of_any_operator(&mut self, id: ExprId, raw: &hir::Expr) -> Written {
        let written = match raw.kind {
            hir::ExprKind::Dot { .. } | hir::ExprKind::Call(_) | hir::ExprKind::Index { .. } => {
                (self.as_plain_chain(id)).map(|copied| self.plain_chain(id, copied))
            }
            _ => self.plain_leaf(raw, Place::Other),
        };
        match written {
            Some(written) => written,
            None => {
                let e = self.f.file().handle_of_plain_expr(id);
                self.nested(|line| line.expr(e, Place::Other))
            }
        }
    }

    /// [`Line::last_expr`] for an expression that `is_statement`, or else the argument of `return` or `throw`.
    #[inline]
    pub(super) fn last_expr_of_statement(&mut self, e: Expr<'a>, is_statement: bool) -> Written {
        match self.last_plain_expr(e.id(), Place::Other, is_statement) {
            Some(written) => written,
            None => self.last_expr(e, Place::Other),
        }
    }

    /// [`Line::last_assigned`]
    #[inline]
    pub(super) fn last_assigned_or_plain(&mut self, value: Expr<'a>) -> Written {
        match self.last_plain_expr(value.id(), Place::Free, false) {
            Some(written) => written,
            None => self.last_assigned(value),
        }
    }

    /// Writes an expression that ends its line, and that needs no parentheses where it is unless it's a name, if it's
    /// plain, or a plain assignment that `is_statement`.
    fn last_plain_expr(&mut self, id: ExprId, place: Place, is_statement: bool) -> Option<Written> {
        // What ends a line that's too wide is where it breaks.
        if self.breaks {
            return None;
        }
        let file = self.f.file();
        let raw = file.plain_expr(id)?;
        match raw.kind {
            hir::ExprKind::Call(call) => {
                // A function or an object as the last argument can end the line.
                if let Some(&last) = file.plain_list(file.plain_call(call)?.args).last()
                    && matches!(
                        file.plain_expr(ExprId(last))?.kind,
                        hir::ExprKind::Fn(_) | hir::ExprKind::Object(_)
                    )
                {
                    return None;
                }
                (self.as_plain_chain(id)).map(|copied| self.plain_chain(id, copied))
            }
            // `a.b = c`, as a statement
            hir::ExprKind::Assign { op, target, value } if is_statement => {
                if matches!(file.plain_expr(target)?.kind, hir::ExprKind::Call(_)) {
                    return None;
                }
                let copied = self.as_plain_chain(target)?;
                Some(self.plain_chain(target, copied).and_then(|()| {
                    self.byte(b' ')?;
                    self.token(assign_op_text(op))?;
                    self.byte(b' ')?;
                    self.last_assigned_or_plain(file.handle_of_plain_expr(value))
                }))
            }
            hir::ExprKind::Dot { .. }
            | hir::ExprKind::Index { .. }
            | hir::ExprKind::Binary { .. }
            | hir::ExprKind::Unary { .. } => self.plain(id, raw, place, true),
            _ => self.plain_leaf(raw, place),
        }
    }

    /// A name or a literal.
    #[inline]
    fn plain_leaf(&mut self, raw: &hir::Expr, place: Place) -> Option<Written> {
        let span = Span::new(raw.pos, raw.end);
        Some(match raw.kind {
            hir::ExprKind::Ident(_) => {
                // A name that long can be a placeholder in parentheses, which the record doesn't say.
                if (place != Place::Free && is_name_that_may_need_parentheses(self.text_of(span)))
                    || span.len() >= SHORTEST_PLACEHOLDER
                {
                    return None;
                }
                self.source(span)
            }
            hir::ExprKind::This => self.token("this"),
            hir::ExprKind::Null => self.token("null"),
            hir::ExprKind::True => self.token("true"),
            hir::ExprKind::False => self.token("false"),
            // Not a template, which has the same kind of record.
            hir::ExprKind::String(_)
                if matches!(self.source.get(raw.pos as usize), Some(b'"' | b'\'')) =>
            {
                self.plain_string(span)
            }
            hir::ExprKind::Number(_)
                if place != Place::Object && self.text_of(span).iter().all(u8::is_ascii_digit) =>
            {
                self.source(span)
            }
            _ => return None,
        })
    }

    /// [`Line::string`]
    fn plain_string(&mut self, span: Span) -> Written {
        if self.is_careful {
            return self.string(span);
        }
        let [first, content @ .., last] = self.text_of(span) else {
            return Err(Refused);
        };
        let preferred = self.f.options().quote_style.as_byte();
        let (mut has_preferred, mut has_odd) = (false, false);
        for &byte in content {
            has_preferred |= byte == preferred;
            has_odd |= byte < b' ';
        }
        if has_odd || first != last {
            return Err(Refused);
        }
        let start = self.len;
        self.source(span)?;
        if *first != preferred && !has_preferred {
            for at in [start, self.len.saturating_sub(1)] {
                if let Some(quote) = self.text.get_mut(at) {
                    *quote = preferred;
                }
            }
        }
        Ok(())
    }

    /// Where `id` is, if it's a name or a literal that's printed as it's written.
    #[inline]
    fn copied_leaf(&self, id: ExprId) -> Option<Span> {
        let raw = self.f.file().plain_expr(id)?;
        let span = Span::new(raw.pos, raw.end);
        let is_copied = match raw.kind {
            hir::ExprKind::Ident(_)
            | hir::ExprKind::This
            | hir::ExprKind::Null
            | hir::ExprKind::True
            | hir::ExprKind::False => true,
            hir::ExprKind::Number(_) => self.text_of(span).iter().all(u8::is_ascii_digit),
            _ => false,
        };
        is_copied.then_some(span)
    }

    /// Where the `(` of the call at `raw` is, if its arguments are printed as they're written.
    #[inline]
    fn open_parenthesis_of_copied_arguments(
        &self,
        raw: &hir::Expr,
        call: &hir::Call,
    ) -> Option<u32> {
        if raw.end != call.close_pos.wrapping_add(1) {
            return None;
        }
        let mut arguments = self.f.file().plain_list(call.args).iter();
        let Some(&first) = arguments.next() else {
            return Some(call.close_pos.wrapping_sub(1));
        };
        let first = self.copied_leaf(ExprId(first))?;
        let mut end = first.end;
        for &argument in arguments {
            let argument = self.copied_leaf(ExprId(argument))?;
            if self.text_of(Span::new(end, argument.start)) != b", " {
                return None;
            }
            end = argument.end;
        }
        (end == call.close_pos).then(|| first.start.wrapping_sub(1))
    }

    /// `None` unless `id` is a chain of member accesses and at most two calls that starts with a name or `this`, without
    /// `?.`, `!` or type arguments. A chain with more calls can break whether it fits or not. A call that's too wide has
    /// rules of its own.
    ///
    /// Returns the longest part of the chain that's printed as it's written: nothing is between its tokens.
    fn as_plain_chain(&self, mut id: ExprId) -> Option<ExprId> {
        /// No expression ends here.
        const NOWHERE: u32 = u32::MAX;
        let file = self.f.file();
        let (mut calls, mut links) = (0, 0);
        let mut is_callee = false;
        let mut copied = id;
        // Where the link has to end for the one around it to be printed as it's written.
        let mut end = file.plain_expr(id)?.end;
        loop {
            let raw = file.plain_expr(id)?;
            if raw.end != end {
                copied = id;
            }
            links += 1;
            let was_callee = std::mem::replace(&mut is_callee, false);
            id = match raw.kind {
                hir::ExprKind::Dot {
                    obj,
                    chain: Chain::No,
                    name_before_end,
                    ..
                } if name_before_end < hir::FAR_IN_BRACKETS => {
                    end = (raw.end.wrapping_sub(u32::from(name_before_end))).wrapping_sub(1);
                    obj
                }
                hir::ExprKind::Index {
                    obj,
                    index,
                    chain: Chain::No,
                } => {
                    end = match self.copied_leaf(index) {
                        Some(index) if index.end + 1 == raw.end => index.start.wrapping_sub(1),
                        _ => NOWHERE,
                    };
                    obj
                }
                hir::ExprKind::Call(call) => {
                    let call = file.plain_call(call)?;
                    calls += 1;
                    if call.chain != Chain::No
                        || !call.type_args.is_empty()
                        || calls > 2
                        || self.breaks
                    {
                        return None;
                    }
                    is_callee = true;
                    end = (self.open_parenthesis_of_copied_arguments(raw, call)).unwrap_or(NOWHERE);
                    call.callee
                }
                hir::ExprKind::Ident(_) => {
                    let name = self.text_of(Span::new(raw.pos, raw.end));
                    // `graphql(schema, `..`)` has another language in it.
                    if is_name_that_may_need_parentheses(name)
                        || (was_callee && name == b"graphql")
                        || (name.len() >= SHORTEST_PLACEHOLDER as usize
                            && is_placeholder_in_parentheses(file.handle_of_plain_expr(id)))
                    {
                        return None;
                    }
                    return Some(copied);
                }
                hir::ExprKind::This => return Some(copied),
                _ => return None,
            };
            if links > MAX_LINKS {
                return None;
            }
        }
    }

    /// Writes a chain, of which [`Line::as_plain_chain`] has returned `copied`.
    fn plain_chain(&mut self, id: ExprId, copied: ExprId) -> Written {
        let file = self.f.file();
        let raw = file.plain_expr(id).ok_or(Refused)?;
        if id == copied {
            let span = Span::new(raw.pos, raw.end);
            if span.len() <= 32
                && let Some(block) = (self.plain_source)
                    .get(span.start as usize..)
                    .and_then(|rest| rest.first_chunk::<32>())
            {
                return self.chunk(block, span.len() as usize);
            }
            return self.long_source(span);
        }
        match raw.kind {
            hir::ExprKind::Dot {
                obj,
                name_before_end,
                ..
            } => {
                self.plain_chain(obj, copied)?;
                self.byte(b'.')?;
                self.source(Span::new(
                    raw.end.saturating_sub(u32::from(name_before_end)),
                    raw.end,
                ))
            }
            hir::ExprKind::Index { obj, index, .. } => {
                self.plain_chain(obj, copied)?;
                self.byte(b'[')?;
                self.nested(|line| line.expr(file.handle_of_plain_expr(index), Place::Free))?;
                self.byte(b']')
            }
            hir::ExprKind::Call(call) => {
                let call = file.plain_call(call).ok_or(Refused)?;
                self.plain_chain(call.callee, copied)?;
                self.plain_arguments(file.plain_list(call.args))
            }
            _ => Err(Refused),
        }
    }

    /// `(a, b)`
    fn plain_arguments(&mut self, args: &'a [u32]) -> Written {
        let file = self.f.file();
        self.byte(b'(')?;
        if args.len() > 1 {
            // Several functions among the arguments, or in the arguments of an argument, are each on a line.
            let mut functions = 0;
            for &argument in args {
                let mut kind = file.plain_expr(ExprId(argument)).ok_or(Refused)?.kind;
                while let hir::ExprKind::NonNull(inner) = kind {
                    kind = file.plain_expr(inner).ok_or(Refused)?.kind;
                }
                match kind {
                    hir::ExprKind::Fn(_) => functions += 1,
                    hir::ExprKind::Call(call) => {
                        let inner = file.plain_list(file.plain_call(call).ok_or(Refused)?.args);
                        if inner.iter().any(|&it| {
                            matches!(
                                file.plain_expr(ExprId(it)).map(|it| it.kind),
                                None | Some(hir::ExprKind::Fn(_))
                            )
                        }) {
                            return Err(Refused);
                        }
                    }
                    _ => {}
                }
            }
            if functions > 1 {
                return Err(Refused);
            }
        }
        for (index, &argument) in args.iter().enumerate() {
            if index > 0 {
                self.token(", ")?;
            }
            let id = ExprId(argument);
            let raw = file.plain_expr(id).ok_or(Refused)?;
            match self.plain_leaf(raw, Place::Free) {
                Some(written) => written?,
                None => {
                    self.nested(|line| line.expr(file.handle_of_plain_expr(id), Place::Free))?
                }
            }
        }
        self.byte(b')')
    }
}
