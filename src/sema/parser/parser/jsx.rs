//! JSX.

use super::{ListKind, Parser, take_span};
use crate::Refusal;
use crate::token::T;
use bun_core::lexer::{
    char_and_size, end_of_run, is_type_script_identifier_part, is_white_space_single_line,
    peek_unicode_escape,
};
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

/// From `start` to `end`, as the range of a diagnostic.
fn range(start: u32, end: u32) -> (u32, u32) {
    match start == end {
        true => (start, Diagnostic::NO_LENGTH),
        false => (start, end),
    }
}

/// The text from `start` to `end`. Nothing, if the end is before the start.
fn text_between(src: &[u8], (start, end): (u32, u32)) -> &[u8] {
    src.get(start as usize..end as usize).unwrap_or_default()
}

impl<const GENERAL: bool> Parser<'_, GENERAL> {
    /// What `parseUpdateExpression` does at a `<`.
    pub(crate) fn jsx_element_or_fragment(&mut self) -> ExprId {
        if self.recovers() && !self.is_at_jsx_element() {
            return match self.is_ecmascript {
                // There an element is a primary expression, and this is none.
                true => self.missing_expression(1109),
                false => self.update_expression_at_less_than(),
            };
        }
        self.jsx_elements(false)
    }

    /// `nextTokenIsIdentifierOrKeywordOrGreaterThan`, at a `<`.
    fn is_at_jsx_element(&mut self) -> bool {
        // Most often nothing is between the `<` and the name.
        let next = self.lx.src.get(self.lx.end as usize);
        if next.is_some_and(|&c| c.is_ascii_alphabetic() || c == b'>') {
            return true;
        }
        let token = self.peek();
        token == T::GreaterThan || token.is_identifier_or_keyword()
    }

    /// `parseUpdateExpression`, at a `<` that starts no element.
    #[cold]
    #[inline(never)]
    fn update_expression_at_less_than(&mut self) -> ExprId {
        if self.is_too_deep() {
            return ExprId::NONE;
        }
        let start = self.pos();
        let operand = self.left_hand_side_expression();
        let op = match self.token() {
            T::PlusPlus if !self.newline_before() => UnOp::PostInc,
            T::MinusMinus if !self.newline_before() => UnOp::PostDec,
            _ => return operand,
        };
        self.next();
        self.finish_expr(ExprKind::Unary { op, operand }, start)
    }

    /// `parseJsxElementOrSelfClosingElementOrFragment` in an expression context.
    pub(crate) fn jsx_elements(&mut self, must_be_unary: bool) -> ExprId {
        let (element, _) = self.jsx_element(true, ExprId::NONE);
        if self.token() == T::LessThan && !must_be_unary {
            return self.jsx_elements_without_parent(element);
        }
        element
    }

    /// The end of `parseJsxElementOrSelfClosingElementOrFragment`, at the `<` after `first`.
    #[cold]
    #[inline(never)]
    fn jsx_elements_without_parent(&mut self, first: ExprId) -> ExprId {
        if !self.recovers() {
            self.refuse(Refusal::Unsupported);
            return first;
        }
        let base = self.s.ids.len();
        self.s.ids.push(first.0);
        while self.token() == T::LessThan {
            let (element, _) = self.jsx_element(true, ExprId::NONE);
            self.s.ids.push(element.0);
        }
        let end = self.prev_end();
        let top = self.first_operand_pos(first);
        self.error(2657, range(top, end), &[]);
        // Each is the left operand of a comma, and the rest the right one.
        let mut rest = ExprId::NONE;
        while self.s.ids.len() > base {
            let Some(left) = self.s.ids.pop().map(ExprId) else {
                break;
            };
            if rest.is_none() {
                rest = left;
                continue;
            }
            let kind = ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right: rest,
            };
            let pos = self.first_operand_pos(left);
            rest = self.add_expr(kind, pos, end);
        }
        rest
    }

    /// Consumes the `>` that ends a tag of the element with the name `tag`, which a fragment does
    /// not have. Returns the end of the tag.
    #[inline(always)]
    fn end_of_jsx_tag(&mut self, is_in_expression: bool, tag: ExprId) -> u32 {
        if self.token() != T::GreaterThan {
            return self.missing_end_of_jsx_tag(is_in_expression, tag);
        }
        let end = self.lx.end;
        match is_in_expression {
            true => self.next(),
            false => self.lx.next_jsx_child(),
        }
        end
    }

    /// `parseExpectedWithDiagnostic(KindGreaterThanToken, ..)`, at another token.
    #[cold]
    #[inline(never)]
    fn missing_end_of_jsx_tag(&mut self, is_in_expression: bool, tag: ExprId) -> u32 {
        match tag.is_none() {
            true => self.error_at_token(17015, &[]),
            false => self.expected(T::GreaterThan),
        }
        let end = self.full_start();
        if !is_in_expression {
            self.rescan_jsx_child();
        }
        end
    }

    /// `ReScanJsxToken`, which `parseJsxChildren` calls before each child, at a token of an
    /// expression.
    #[cold]
    #[inline(never)]
    fn rescan_jsx_child(&mut self) {
        if self.has_failed() {
            return;
        }
        let from = self.full_start();
        let before = self.token();
        // What was read as a comment is text.
        let kept = self.lx.comments.partition_point(|it| it.0 < from);
        self.lx.comments.truncate(kept);
        self.lx.end = from;
        self.lx.next_jsx_child();
        // `parseJsxChildren` of the native parser asks the scanner and leaves `p.token` as it was: a `<<` or a `<=`.
        if self.token() == T::LessThan
            && before != T::LessThan
            && self.options.dialect == Default::default()
        {
            self.jsx_child_after_other_token = self.pos();
        }
    }

    /// `parseJsxElementOrSelfClosingElementOrFragment`, at the `<`. `parent`: the name of
    /// `openingTag`, if that is an element. Returns whether the closing tag is the one of `parent`.
    fn jsx_element(&mut self, is_in_expression: bool, parent: ExprId) -> (ExprId, bool) {
        if self.is_too_deep() {
            return (ExprId::NONE, false);
        }
        let start = self.pos();
        // `nodePos()`: nothing but text is between the children.
        let full_start = match is_in_expression {
            true => self.full_start(),
            false => start,
        };
        match self.recovers() && !is_in_expression && self.jsx_child_after_other_token == start {
            // `parseExpected(KindLessThanToken)` fails, and `scanJsxIdentifier` finds the `<`: type arguments start there.
            true => {
                self.jsx_child_after_other_token = u32::MAX;
                self.error_at_token(1005, &[b"<"]);
            }
            false => self.next(),
        }
        let mut jsx = Jsx {
            tag: ExprId::NONE,
            close_tag: ExprId::NONE,
            attrs: Span::EMPTY,
            children: IdList::EMPTY,
            type_args: IdList::EMPTY,
            opening_end: 0,
            close_pos: u32::MAX,
            end: 0,
        };
        let mut name = (0, 0);
        if self.token() != T::GreaterThan {
            name.0 = self.pos();
            jsx.tag = self.jsx_element_name();
            name.1 = self.prev_end();
            if self.has_type_arguments_in_expressions
                && self.is_at_type_arguments_of_heritage_element()
            {
                jsx.type_args = self.type_arguments();
            }
            jsx.attrs = self.jsx_attributes();
            if self.token() != T::GreaterThan {
                // The scanner never joins a `>` with what follows it.
                if !self.eat(T::Slash) {
                    self.error_at_token(1005, &[b"/"]);
                }
                jsx.end = self.end_of_jsx_tag(is_in_expression, jsx.tag);
                jsx.opening_end = jsx.end;
                let id = self.f.add_jsx(jsx);
                return (self.add_expr(ExprKind::Jsx(id), start, jsx.end), false);
            }
        }
        jsx.opening_end = self.lx.end;
        self.lx.next_jsx_child();
        // `parseJsxChildren`
        let base = self.s.ids.len();
        let lists = self.enter_list(ListKind::JsxChildren);
        loop {
            let child = match self.token() {
                T::JsxText => {
                    let text = ExprKind::String(self.lx.atom);
                    let child = self.add_expr(text, self.lx.start, self.lx.end);
                    self.lx.next_jsx_child();
                    child
                }
                T::OpenBrace => self.jsx_expression_child(start),
                // For acorn `<` and `/` are two tokens.
                T::LessThan if self.is_ecmascript && self.peek() == T::Slash => break,
                T::LessThan => {
                    let (child, closes_this) = self.jsx_element(false, jsx.tag);
                    if closes_this {
                        self.leave_list(lists);
                        self.s.ids.push(child.0);
                        return self.jsx_element_closed_by_child(
                            jsx,
                            start,
                            child,
                            base,
                            is_in_expression,
                        );
                    }
                    child
                }
                T::LessThanSlash => break,
                _ => {
                    self.leave_list(lists);
                    return self.jsx_element_without_closing_tag(
                        jsx, base, start, full_start, name, parent,
                    );
                }
            };
            self.s.ids.push(child.0);
        }
        self.leave_list(lists);
        jsx.children = self.take_ids(base);
        // `parseJsxClosingElement`, `parseJsxClosingFragment`
        jsx.close_pos = self.pos();
        if self.token() == T::LessThan {
            self.next();
        }
        self.next();
        if jsx.tag.is_some() {
            let closing = self.pos();
            jsx.close_tag = self.jsx_element_name();
            // `tagNamesAreEquivalent`
            let src = self.lx.src;
            let written = |range: (u32, u32)| src.get(range.0 as usize..range.1 as usize);
            if written(name) != written((closing, self.prev_end()))
                && !self.are_tag_names_equivalent(jsx.tag, jsx.close_tag)
            {
                return self.jsx_element_with_other_closing_tag(
                    jsx,
                    start,
                    name,
                    parent,
                    is_in_expression,
                );
            }
        }
        jsx.end = self.end_of_jsx_tag(is_in_expression, jsx.tag);
        let id = self.f.add_jsx(jsx);
        (self.add_expr(ExprKind::Jsx(id), start, jsx.end), false)
    }

    /// What `parseJsxElementOrSelfClosingElementOrFragment` does with a last child that has the
    /// closing tag of the element: the tag is moved, and the one of `child` is missing.
    #[cold]
    #[inline(never)]
    fn jsx_element_closed_by_child(
        &mut self,
        mut jsx: Jsx,
        start: u32,
        child: ExprId,
        base: usize,
        is_in_expression: bool,
    ) -> (ExprId, bool) {
        jsx.children = self.take_ids(base);
        jsx.end = self.full_start();
        if let Some(ExprKind::Jsx(id)) = self.f.exprs.get(child.idx()).map(|it| it.kind)
            && let Some(&inner) = self.f.jsx.get(id.idx())
        {
            jsx.close_tag = inner.close_tag;
            jsx.close_pos = inner.close_pos;
            jsx.end = inner.end;
            // `lastChild.Children().End()`
            let end = inner.close_pos;
            let missing = self.add_expr(ExprKind::Missing, end, end);
            if let Some(inner) = self.f.jsx.get_mut(id.idx()) {
                inner.close_tag = missing;
                inner.end = end;
            }
            if let Some(child) = self.f.exprs.get_mut(child.idx()) {
                child.end = end;
            }
        }
        if !is_in_expression {
            self.rescan_jsx_child();
        }
        let id = self.f.add_jsx(jsx);
        (self.add_expr(ExprKind::Jsx(id), start, jsx.end), false)
    }

    /// `parseJsxChild` at a token that is no child and no `</`, and what follows the children. The
    /// element starts at `start`, its node at `full_start`, and its name is at `name`.
    #[cold]
    #[inline(never)]
    fn jsx_element_without_closing_tag(
        &mut self,
        mut jsx: Jsx,
        base: usize,
        start: u32,
        full_start: u32,
        name: (u32, u32),
        parent: ExprId,
    ) -> (ExprId, bool) {
        if !self.recovers() {
            self.fail();
            self.s.ids.truncate(base);
            return (ExprId::NONE, false);
        }
        let written = text_between(self.lx.src, name);
        if self.token() == T::Eof {
            match jsx.tag.is_some() {
                true => self.error(17008, range(name.0.min(name.1), name.1), &[written]),
                false => self.error(17014, range(full_start, jsx.opening_end), &[]),
            }
        }
        jsx.children = self.take_ids(base);
        // `parseJsxClosingElement`, `parseJsxClosingFragment`: the name and the `>` are missed at
        // the same place, where no second error is reported.
        let at = self.pos();
        self.error_at_token(1005, &[b"</"]);
        // `ScanJsxToken`: `TokenFullStart()` is the start of the token, which stays.
        self.lx.full_start = at;
        jsx.close_pos = at;
        jsx.end = at;
        let mut closes_parent = false;
        if jsx.tag.is_some() {
            jsx.close_tag = self.add_expr(ExprKind::Missing, at, at);
            closes_parent = parent.is_some()
                && !self.are_tag_names_equivalent(jsx.tag, jsx.close_tag)
                && self.are_tag_names_equivalent(jsx.close_tag, parent);
            if closes_parent {
                self.error(17008, range(start + 1, name.1), &[written]);
            }
        }
        let id = self.f.add_jsx(jsx);
        (self.add_expr(ExprKind::Jsx(id), start, at), closes_parent)
    }

    /// The end of `parseJsxClosingElement`, and what follows it, after a name that is not the one
    /// of the opening tag, which is at `name`.
    #[cold]
    #[inline(never)]
    fn jsx_element_with_other_closing_tag(
        &mut self,
        mut jsx: Jsx,
        start: u32,
        name: (u32, u32),
        parent: ExprId,
        is_in_expression: bool,
    ) -> (ExprId, bool) {
        if !self.recovers() {
            self.refuse(Refusal::Reported);
            return (ExprId::NONE, false);
        }
        let end_of_name = self.prev_end();
        match self.token() {
            T::GreaterThan => self.next(),
            _ => self.expected(T::GreaterThan),
        }
        jsx.end = self.full_start();
        let written = text_between(self.lx.src, name);
        let closes_parent =
            parent.is_some() && self.are_tag_names_equivalent(jsx.close_tag, parent);
        // `TagName().Loc` starts where the `<` or the `</` ends.
        match closes_parent {
            true => self.error(17008, range(start + 1, name.1), &[written]),
            false => self.error(17002, range(jsx.close_pos + 2, end_of_name), &[written]),
        }
        if !closes_parent && !is_in_expression {
            self.rescan_jsx_child();
        }
        let id = self.f.add_jsx(jsx);
        (
            self.add_expr(ExprKind::Jsx(id), start, jsx.end),
            closes_parent,
        )
    }

    /// `tagNamesAreEquivalent`, for names that are not written the same.
    #[cold]
    fn are_tag_names_equivalent(&self, mut a: ExprId, mut b: ExprId) -> bool {
        loop {
            let (Some(x), Some(y)) = (self.f.exprs.get(a.idx()), self.f.exprs.get(b.idx())) else {
                return false;
            };
            match (x.kind, y.kind) {
                (
                    ExprKind::Dot {
                        obj: left, name, ..
                    },
                    ExprKind::Dot {
                        obj: right,
                        name: other,
                        ..
                    },
                ) if name == other => (a, b) = (left, right),
                (ExprKind::Ident(name), ExprKind::Ident(other))
                | (ExprKind::String(name), ExprKind::String(other)) => return name == other,
                (ExprKind::This, ExprKind::This) | (ExprKind::Missing, ExprKind::Missing) => {
                    return true;
                }
                _ => return false,
            }
        }
    }

    /// `scanJsxIdentifier`
    #[inline(always)]
    fn scan_jsx_identifier(&mut self) {
        if self.token().is_identifier_or_keyword()
            && (self.lx.has_escape
                || self.recovers() && self.lx.src.get(self.lx.end as usize) == Some(&b'-'))
        {
            self.unusual_jsx_identifier();
        }
        self.lx.scan_jsx_identifier();
    }

    /// `ScanJsxIdentifier` for a name that `Lexer::scan_jsx_identifier` does not read, and the
    /// error of `parseIdentifierNameErrorOnUnicodeEscapeSequence`.
    #[cold]
    #[inline(never)]
    fn unusual_jsx_identifier(&mut self) {
        if !self.recovers() {
            return self.report();
        }
        let src = self.lx.src;
        let from = self.lx.end as usize;
        let rest = src.get(from..).unwrap_or_default();
        let is_plain = |c: &&u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$' | b'-');
        let plain = rest.iter().take_while(is_plain).count();
        if !self.lx.has_escape
            && self.token() != T::PrivateIdentifier
            && !matches!(rest.get(plain), Some(b'\\' | 0x80..))
        {
            return;
        }
        let mut text = self.lx.text_of(self.lx.atom).to_vec();
        let mut end = from;
        loop {
            let (c, len) = match src.get(end) {
                Some(b'-') => (i32::from(b'-'), 1),
                Some(b'\\') => match peek_unicode_escape(src, end) {
                    Some(escaped) if is_type_script_identifier_part(escaped.0) => {
                        self.lx.has_escape = true;
                        escaped
                    }
                    _ => break,
                },
                Some(_) => match char_and_size(src, end) {
                    decoded if is_type_script_identifier_part(decoded.0) => decoded,
                    _ => break,
                },
                None => break,
            };
            let Some(c) = u32::try_from(c).ok().and_then(char::from_u32) else {
                break;
            };
            text.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            end += len;
        }
        if end > from {
            self.lx.atom = self.atom(&text);
            self.lx.end = end as u32;
        }
        self.lx.token = T::Identifier;
        if self.lx.has_escape {
            self.error_at_token(17021, &[]);
        }
    }

    /// `parseIdentifierNameErrorOnUnicodeEscapeSequence`, at a token that `scan_jsx_identifier` has
    /// not made an identifier of.
    #[cold]
    #[inline(never)]
    fn jsx_identifier_at_another_token(&mut self) -> Atom {
        if !self.recovers() {
            self.fail();
            return Atom::NONE;
        }
        if self.token() != T::PrivateIdentifier {
            return self.missing_identifier(0, 0).0;
        }
        // `ScanJsxIdentifier` makes an identifier of it, whose text has the `#`.
        self.unusual_jsx_identifier();
        let name = self.lx.atom;
        self.next();
        name
    }

    /// `parseJsxTagName`, `parseJsxAttributeName`: the text of the name, which may have a
    /// namespace, its start and whether it is anything but an identifier.
    fn jsx_name(&mut self) -> (Atom, u32, bool) {
        self.scan_jsx_identifier();
        if self.token() != T::Identifier {
            return self.jsx_name_at_another_token();
        }
        let (name, start) = (self.lx.atom, self.pos());
        self.next();
        self.rest_of_jsx_name(name, start)
    }

    /// `jsx_name`, where no identifier is. A name that is missing is empty, and no identifier.
    #[cold]
    #[inline(never)]
    fn jsx_name_at_another_token(&mut self) -> (Atom, u32, bool) {
        let start = self.pos();
        let name = self.jsx_identifier_at_another_token();
        if name.is_none() {
            return (name, start, false);
        }
        let (name, start, is_special) = self.rest_of_jsx_name(name, start);
        (name, start, is_special || name == known::empty)
    }

    /// `jsx_name`, after the first identifier, which is `name` and starts at `start`.
    #[inline(always)]
    fn rest_of_jsx_name(&mut self, mut name: Atom, start: u32) -> (Atom, u32, bool) {
        if self.token() == T::Colon {
            self.next();
            self.scan_jsx_identifier();
            if self.token() != T::Identifier {
                return self.jsx_name_without_local_name(name, start);
            }
            name = self.jsx_namespaced_name(name, self.lx.atom);
            self.next();
        }
        let is_plain = bun_core::strings::index_of_any(self.lx.text_of(name), b"-:").is_none();
        (name, start, !is_plain)
    }

    /// The text of a `JsxNamespacedName`, which has no blanks around the colon.
    fn jsx_namespaced_name(&mut self, namespace: Atom, local: Atom) -> Atom {
        let text = [self.lx.text_of(namespace), b":", self.lx.text_of(local)].concat();
        self.atom(&text)
    }

    /// `rest_of_jsx_name`, where no identifier follows the colon after `namespace`.
    #[cold]
    #[inline(never)]
    fn jsx_name_without_local_name(&mut self, namespace: Atom, start: u32) -> (Atom, u32, bool) {
        let local = self.jsx_identifier_at_another_token();
        if local.is_none() {
            return (local, start, false);
        }
        (self.jsx_namespaced_name(namespace, local), start, true)
    }

    /// `parseJsxElementName`
    fn jsx_element_name(&mut self) -> ExprId {
        let (name, start, is_special) = self.jsx_name();
        let mut expression = match is_special {
            // `createMissingIdentifier`
            true if name == known::empty => {
                self.add_expr(ExprKind::Missing, start, self.full_start())
            }
            true => return self.finish_expr(ExprKind::String(name), start),
            false if name == known::this => self.finish_expr(ExprKind::This, start),
            false => self.finish_expr(ExprKind::Ident(name), start),
        };
        if self.token() == T::Dot {
            self.note_identifier(name, start);
        }
        while self.eat(T::Dot) {
            let (name, name_pos) = match self.recovers() {
                true => self.jsx_member_name(),
                false => self.identifier_name(),
            };
            let kind = ExprKind::Dot {
                obj: expression,
                name,
                name_pos,
                chain: Chain::No,
            };
            expression = self.finish_expr(kind, start);
        }
        expression
    }

    /// `parseRightSideOfDot(true, false, false)`
    #[cold]
    #[inline(never)]
    fn jsx_member_name(&mut self) -> (Atom, u32) {
        let token = self.token();
        let is_of_next_statement = token.is_identifier_or_keyword()
            && self.newline_before()
            && self.look_ahead(|p| {
                p.next();
                p.token().is_identifier_or_keyword() && !p.newline_before()
            });
        if token == T::PrivateIdentifier && !is_of_next_statement {
            self.next();
        }
        if token == T::PrivateIdentifier || is_of_next_statement {
            let at = self.full_start();
            self.error(1003, (at, Diagnostic::NO_LENGTH), &[]);
            return (known::empty, at);
        }
        if !token.is_identifier_or_keyword() {
            let at = self.full_start();
            return (self.missing_identifier(0, 0).0, at);
        }
        if self.lx.has_escape {
            self.error_at_token(17021, &[]);
        }
        let name = (self.lx.atom, self.pos());
        self.next();
        name
    }

    /// `parseJsxAttributes`
    fn jsx_attributes(&mut self) -> Span<PropId> {
        let base = self.s.props.len();
        let lists = self.enter_list(ListKind::JsxAttributes);
        loop {
            if self.token() == T::OpenBrace {
                // `parseJsxSpreadAttribute`
                let start = self.pos();
                self.next();
                self.expect(T::DotDotDot);
                let value = self.jsx_expression();
                self.expect(T::CloseBrace);
                let pos = self.first_operand_pos(value);
                self.s.props.push(Prop {
                    kind: PropKind::Spread,
                    key: PropKey::None,
                    name_kind: NameKind::Jsx,
                    value,
                    pos,
                    start,
                    end: self.prev_end(),
                    postfix_token: 0,
                });
                continue;
            }
            if !self.token().is_identifier_or_keyword() || self.token() == T::PrivateIdentifier {
                if !self.recovers()
                    || matches!(self.token(), T::GreaterThan | T::Slash)
                    || !self.is_at_element(ListKind::JsxAttributes)
                {
                    break;
                }
                if self.token() == T::OpenBrace {
                    continue;
                }
            }
            // `parseJsxAttribute`
            let (name, pos, _) = self.jsx_name();
            let mut value = ExprId::NONE;
            let mut braces = None;
            if self.token() == T::Equals {
                // `parseJsxAttributeValue`
                self.lx.scan_jsx_attribute_value();
                match self.token() {
                    T::String => {
                        let text = ExprKind::String(self.lx.atom);
                        value = self.add_expr(text, self.lx.start, self.lx.end);
                        self.next();
                    }
                    T::OpenBrace => {
                        let open = self.pos();
                        braces = Some(open);
                        self.next();
                        value = match self.token() {
                            T::CloseBrace => self.empty_jsx_attribute_value(open),
                            _ => self.jsx_expression(),
                        };
                        self.expect(T::CloseBrace);
                    }
                    T::LessThan if self.recovers() => value = self.jsx_elements_after_equals(),
                    T::LessThan => (value, _) = self.jsx_element(true, ExprId::NONE),
                    _ => self.missing_jsx_attribute_value(),
                }
            }
            let end = self.prev_end();
            if let Some(open) = braces {
                self.f.jsx_expressions.push((value, open, end));
            }
            self.s.props.push(Prop {
                kind: PropKind::Init,
                key: PropKey::Name(name),
                name_kind: NameKind::Jsx,
                value,
                pos,
                start: pos,
                end,
                postfix_token: 0,
            });
        }
        self.leave_list(lists);
        take_span!(self, props, base)
    }

    /// `ScanJsxAttributeValue` leaves what is no string to `Scan`, after the blanks that follow the
    /// `=`: `TokenFullStart()` is there.
    fn skip_blanks_after_equals(&mut self) {
        let is_blank =
            |c| is_white_space_single_line(c) || matches!(c, 0x0A | 0x0D | 0x2028 | 0x2029);
        let from = self.lx.full_start as usize;
        self.lx.full_start = end_of_run(self.lx.src, from, is_blank) as u32;
    }

    /// `parseJsxAttributeValue`, at the `<` of an element.
    #[cold]
    #[inline(never)]
    fn jsx_elements_after_equals(&mut self) -> ExprId {
        self.skip_blanks_after_equals();
        self.jsx_elements(false)
    }

    /// `parseJsxAttributeValue`, at a token that starts no value.
    #[cold]
    #[inline(never)]
    fn missing_jsx_attribute_value(&mut self) {
        if !self.recovers() {
            return self.fail();
        }
        self.error_at_token(1145, &[]);
        self.skip_blanks_after_equals();
    }

    /// `parseJsxExpression` for `name={}`, which the checker reports. The missing expression is
    /// placed at the opening brace.
    #[cold]
    #[inline(never)]
    fn empty_jsx_attribute_value(&mut self, open: u32) -> ExprId {
        if !self.recovers() {
            self.refuse(Refusal::Reported);
            return ExprId::NONE;
        }
        self.add_expr(ExprKind::Missing, open, open)
    }

    /// The expression between braces. `parseJsxExpression` stays in the context of the element.
    fn jsx_expression(&mut self) -> ExprId {
        match self.is_ecmascript {
            true => self.expression_allowing_in(),
            false => self.expression(),
        }
    }

    /// `parseJsxExpression` among the children of the element that starts at `element`.
    fn jsx_expression_child(&mut self, element: u32) -> ExprId {
        let open = self.pos();
        self.next();
        let expression = if self.token() == T::CloseBrace {
            // The missing expression is placed at the opening brace.
            self.add_expr(ExprKind::Missing, open, open)
        } else if self.eat(T::DotDotDot) {
            let operand = self.jsx_expression();
            self.finish_expr(ExprKind::Spread(operand), element)
        } else {
            self.jsx_expression()
        };
        if self.token() != T::CloseBrace {
            self.unclosed_jsx_expression_child(expression, open);
            return expression;
        }
        self.f.jsx_expressions.push((expression, open, self.lx.end));
        self.lx.next_jsx_child();
        expression
    }

    /// `parseExpectedWithoutAdvancing(KindCloseBraceToken)` after `expression` and the `{` at
    /// `open`, at another token.
    #[cold]
    #[inline(never)]
    fn unclosed_jsx_expression_child(&mut self, expression: ExprId, open: u32) {
        self.expected(T::CloseBrace);
        if self.recovers() {
            let end = self.full_start();
            self.f.jsx_expressions.push((expression, open, end));
            self.rescan_jsx_child();
        }
    }
}
