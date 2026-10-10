//! Binding patterns.

use super::{ListKind, Parser, ctx, take_span};
use crate::token::T;
use bun_sema::atom::known;
use bun_sema::hir::*;

impl<const GENERAL: bool> Parser<'_, GENERAL> {
    /// `parseIdentifierOrPattern`
    #[inline]
    pub(crate) fn identifier_or_pattern(&mut self) -> PatId {
        match self.token() {
            T::OpenBracket => self.array_binding_pattern(),
            T::OpenBrace => self.object_binding_pattern(),
            _ => self.binding_identifier(),
        }
    }

    /// `parseBindingIdentifier`
    #[inline]
    pub(crate) fn binding_identifier(&mut self) -> PatId {
        if !self.is_binding_identifier() {
            return self.missing_binding_identifier(0);
        }
        let name = self.lx.atom;
        self.note_identifier(name, self.lx.start);
        let pat = self.f.pat(PatKind::Ident(name), self.lx.start, self.lx.end);
        self.next_after_name();
        pat
    }

    /// `parseBindingIdentifierWithDiagnostic`, at a token that is none.
    #[cold]
    #[track_caller]
    pub(crate) fn missing_binding_identifier(&mut self, code_of_private_name: u32) -> PatId {
        let (full, end) = (self.full_start(), self.lx.end);
        let (name, pos) = self.missing_identifier(0, code_of_private_name);
        if name.is_none() {
            return PatId::NONE;
        }
        match name == known::empty {
            true => self.f.pat(PatKind::Ident(name), full, full),
            false => self.f.pat(PatKind::Ident(name), pos, end),
        }
    }

    /// `parseArrayBindingPattern`
    fn array_binding_pattern(&mut self) -> PatId {
        if self.is_too_deep() {
            return PatId::NONE;
        }
        let start = self.pos();
        self.next();
        let saved = self.enter_context(0, self.disallow_in_if_brackets_end_it());
        let base = self.s.pat_elems.len();
        let lists = self.enter_list(ListKind::ArrayBindingElements);
        while self.is_in_list(T::CloseBracket) && self.is_at_element(ListKind::ArrayBindingElements)
        {
            let element = self.full_start();
            // `parseArrayBindingElement`
            if self.token() == T::Comma {
                // `finishNode(NewOmittedExpression(), nodePos())`
                let (comma, full) = (self.pos(), self.full_start());
                let pat = self.f.pat(PatKind::Missing, comma, full);
                self.s.pat_elems.push(PatElem {
                    pat,
                    default: ExprId::NONE,
                    is_rest: false,
                    start: comma,
                    end: full,
                });
            } else {
                let start = self.pos();
                let is_rest = self.eat(T::DotDotDot);
                let pat = self.identifier_or_pattern();
                let default = self.optional_initializer();
                self.s.pat_elems.push(PatElem {
                    pat,
                    default,
                    is_rest,
                    start,
                    end: self.prev_end(),
                });
                // `checkGrammarBindingElement`
                if is_rest && self.token() == T::Comma && self.peek() == T::CloseBracket {
                    self.flag(
                        DiagnosticKind::Grammar,
                        1013,
                        (self.lx.start, self.lx.end),
                        &[],
                    );
                }
            }
            if !self.eat(T::Comma)
                && !self.goes_on_without_comma(ListKind::ArrayBindingElements, element)
            {
                break;
            }
        }
        self.leave_list(lists);
        self.context = saved;
        self.expect(T::CloseBracket);
        let elements = take_span!(self, pat_elems, base);
        let end = self.prev_end();
        self.f.pat(PatKind::Array(elements), start, end)
    }

    /// `parseObjectBindingPattern`
    fn object_binding_pattern(&mut self) -> PatId {
        if self.is_too_deep() {
            return PatId::NONE;
        }
        let start = self.pos();
        self.next();
        let saved = self.enter_context(0, self.disallow_in_if_brackets_end_it());
        let base = self.s.pat_props.len();
        let lists = self.enter_list(ListKind::ObjectBindingElements);
        while self.is_in_list(T::CloseBrace) && self.is_at_element(ListKind::ObjectBindingElements)
        {
            let element = self.full_start();
            // `parseObjectBindingElement`
            let pos = self.pos();
            let property = if !self.eat(T::DotDotDot) {
                self.object_binding_element(pos)
            } else if self.recovers() {
                self.rest_binding_element(pos)
            } else {
                let key_pos = self.pos();
                let value = self.binding_identifier();
                PatProp {
                    key: PropKey::None,
                    name_kind: NameKind::Identifier,
                    value,
                    default: ExprId::NONE,
                    is_rest: true,
                    pos,
                    key_pos,
                    end: self.prev_end(),
                }
            };
            self.s.pat_props.push(property);
            if !self.eat(T::Comma) {
                if self.goes_on_without_comma(ListKind::ObjectBindingElements, element) {
                    continue;
                }
                break;
            }
            if property.is_rest && self.token() == T::CloseBrace {
                let at = (self.prev_end() - 1, self.prev_end());
                self.flag(DiagnosticKind::Grammar, 1013, at, &[]);
            }
        }
        self.leave_list(lists);
        self.context = saved;
        self.expect(T::CloseBrace);
        let properties = take_span!(self, pat_props, base);
        let end = self.prev_end();
        self.f.pat(PatKind::Object(properties), start, end)
    }

    /// `parseObjectBindingElement`, after its `...` if it has one. `pos`: its first token.
    #[inline(always)]
    fn object_binding_element(&mut self, pos: u32) -> PatProp {
        let is_identifier = self.is_binding_identifier();
        let bigint = (self.token() == T::BigInt).then(|| self.lx.text());
        let name_end = self.lx.end;
        let (mut key, mut name_kind, key_pos) = self.property_name();
        // In a type nothing asks whether the name is in quotes.
        if name_kind == NameKind::StringLiteral && self.has_context(ctx::TYPE) {
            name_kind = NameKind::Identifier;
        }
        // `name.Text()` ends with the `n`.
        if let Some(written) = bigint {
            key = PropKey::Name(self.atom(&bun_sema::json::bigint_token_value(written)));
        }
        let value = if is_identifier && self.token() != T::Colon {
            match key {
                PropKey::Name(name) => {
                    self.note_identifier(name, key_pos);
                    self.f.pat(PatKind::Ident(name), key_pos, name_end)
                }
                _ => PatId::NONE,
            }
        } else {
            self.expect(T::Colon);
            self.identifier_or_pattern()
        };
        let default = self.optional_initializer();
        PatProp {
            key,
            name_kind,
            value,
            default,
            is_rest: false,
            pos,
            key_pos,
            end: self.prev_end(),
        }
    }

    /// The same after `...`, where `checkGrammarBindingElement` reports a property name and an
    /// initializer.
    #[cold]
    #[inline(never)]
    fn rest_binding_element(&mut self, pos: u32) -> PatProp {
        let is_identifier = self.is_binding_identifier();
        let mut property = self.object_binding_element(pos);
        property.is_rest = true;
        // `...a`: the identifier is the binding, and there is no property name.
        let value = self.f.pats.get(property.value.idx());
        if is_identifier && value.is_some_and(|pat| pat.pos == property.key_pos) {
            property.key = PropKey::None;
        }
        property
    }
}
