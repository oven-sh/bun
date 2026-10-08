//! Binding patterns.

use super::{Parser, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::hir::*;

impl Parser<'_> {
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
            self.fail();
            return PatId::NONE;
        }
        let name = self.lx.atom;
        self.note_identifier(name, self.lx.start);
        let pat = self.f.pat(PatKind::Ident(name), self.lx.start, self.lx.end);
        self.next();
        pat
    }

    /// `parseArrayBindingPattern`
    fn array_binding_pattern(&mut self) -> PatId {
        if self.is_too_deep() {
            return PatId::NONE;
        }
        let start = self.pos();
        self.next();
        let base = self.s.pat_elems.len();
        while self.is_in_list(T::CloseBracket) {
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
                if is_rest && self.token() == T::Comma && self.peek() == T::CloseBracket {
                    self.report();
                }
            }
            if !self.eat(T::Comma) {
                break;
            }
        }
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
        let base = self.s.pat_props.len();
        while self.is_in_list(T::CloseBrace) {
            // `parseObjectBindingElement`
            let pos = self.pos();
            let property = if self.eat(T::DotDotDot) {
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
            } else {
                let is_identifier = self.is_binding_identifier();
                let has_escape = is_identifier && self.lx.has_escape;
                let name_end = self.lx.end;
                let (key, name_kind, key_pos) = self.property_name();
                let value = if is_identifier && self.token() != T::Colon {
                    if has_escape {
                        self.refuse(Refusal::Unsupported);
                    }
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
            };
            self.s.pat_props.push(property);
            if !self.eat(T::Comma) {
                break;
            }
            if property.is_rest && self.token() == T::CloseBrace {
                self.report();
            }
        }
        self.expect(T::CloseBrace);
        let properties = take_span!(self, pat_props, base);
        let end = self.prev_end();
        self.f.pat(PatKind::Object(properties), start, end)
    }
}
