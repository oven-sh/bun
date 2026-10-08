//! JSX.

use super::{Parser, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

impl Parser<'_> {
    /// `parseJsxElementOrSelfClosingElementOrFragment` in an expression context.
    pub(crate) fn jsx_element_or_fragment(&mut self) -> ExprId {
        let element = self.jsx_element(true);
        // Another element here is an error, which takes a speculative parse to find.
        if self.token() == T::LessThan {
            self.refuse(Refusal::Unsupported);
        }
        element
    }

    /// Consumes the `>` that ends a tag.
    fn end_of_jsx_tag(&mut self, is_in_expression: bool) {
        if self.token() != T::GreaterThan {
            return self.fail();
        }
        match is_in_expression {
            true => self.next(),
            false => self.lx.next_jsx_child(),
        }
    }

    /// `parseJsxElementOrSelfClosingElementOrFragment`, at the `<`.
    fn jsx_element(&mut self, is_in_expression: bool) -> ExprId {
        if self.is_too_deep() {
            return ExprId::NONE;
        }
        let start = self.pos();
        self.next();
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
            if self.token() == T::LessThan && !self.options.is_javascript {
                jsx.type_args = self.type_arguments();
            }
            jsx.attrs = self.jsx_attributes();
            if self.token() == T::Slash {
                // The scanner never joins a `>` with what follows it.
                self.next();
                jsx.opening_end = self.lx.end;
                jsx.end = self.lx.end;
                self.end_of_jsx_tag(is_in_expression);
                let id = self.f.add_jsx(jsx);
                return self.add_expr(ExprKind::Jsx(id), start, jsx.end);
            }
        }
        jsx.opening_end = self.lx.end;
        self.end_of_jsx_tag(false);
        // `parseJsxChildren`
        let base = self.s.ids.len();
        loop {
            let child = match self.token() {
                T::JsxText => {
                    let text = ExprKind::String(self.lx.atom);
                    let child = self.add_expr(text, self.lx.start, self.lx.end);
                    self.lx.next_jsx_child();
                    child
                }
                T::OpenBrace => self.jsx_expression_child(start),
                T::LessThan => self.jsx_element(false),
                T::LessThanSlash => break,
                _ => {
                    self.fail();
                    break;
                }
            };
            self.s.ids.push(child.0);
        }
        jsx.children = self.take_ids(base);
        // `parseJsxClosingElement`, `parseJsxClosingFragment`
        jsx.close_pos = self.pos();
        self.next();
        if jsx.tag.is_some() {
            let closing = self.pos();
            jsx.close_tag = self.jsx_element_name();
            // `tagNamesAreEquivalent`
            let src = self.lx.src;
            let written = |range: (u32, u32)| src.get(range.0 as usize..range.1 as usize);
            if written(name) != written((closing, self.prev_end())) {
                self.refuse(Refusal::Reported);
            }
        }
        jsx.end = self.lx.end;
        self.end_of_jsx_tag(is_in_expression);
        let id = self.f.add_jsx(jsx);
        self.add_expr(ExprKind::Jsx(id), start, jsx.end)
    }

    /// A name in a tag or of an attribute, which may have a namespace: its text, its start and
    /// whether it is more than an identifier.
    fn jsx_name(&mut self) -> (Atom, u32, bool) {
        self.lx.scan_jsx_identifier();
        if self.token() != T::Identifier {
            self.fail();
            return (Atom::NONE, self.pos(), false);
        }
        let (mut name, start) = (self.lx.atom, self.pos());
        let mut end = self.lx.end;
        self.next();
        if self.token() == T::Colon {
            self.next();
            self.lx.scan_jsx_identifier();
            if self.token() != T::Identifier {
                self.fail();
                return (Atom::NONE, start, false);
            }
            // The text has no blanks around the colon.
            let text = [
                self.lx.atoms.bytes(name),
                b":",
                self.lx.atoms.bytes(self.lx.atom),
            ]
            .concat();
            name = self.atom(&text);
            end = self.lx.end;
            self.next();
        }
        let _ = end;
        let is_plain = bun_core::strings::index_of_any(self.lx.atoms.bytes(name), b"-:").is_none();
        (name, start, !is_plain)
    }

    /// `parseJsxElementName`
    fn jsx_element_name(&mut self) -> ExprId {
        let (name, start, is_special) = self.jsx_name();
        let kind = match name {
            _ if is_special => ExprKind::String(name),
            known::this => ExprKind::This,
            _ => ExprKind::Ident(name),
        };
        let mut expression = self.finish_expr(kind, start);
        if is_special {
            return expression;
        }
        while self.eat(T::Dot) {
            let (name, name_pos) = self.identifier_name();
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

    /// `parseJsxAttributes`
    fn jsx_attributes(&mut self) -> Span<PropId> {
        let base = self.s.props.len();
        loop {
            let start = self.pos();
            if self.token() == T::OpenBrace {
                // `parseJsxSpreadAttribute`
                self.next();
                self.expect(T::DotDotDot);
                let value = self.expression_allowing_in();
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
                break;
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
                        braces = Some(self.pos());
                        self.next();
                        if self.token() == T::CloseBrace {
                            self.refuse(Refusal::Reported);
                        }
                        value = self.expression_allowing_in();
                        self.expect(T::CloseBrace);
                    }
                    T::LessThan => value = self.jsx_element(true),
                    _ => self.fail(),
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
        take_span!(self, props, base)
    }

    /// `parseJsxExpression` among the children of the element that starts at `element`.
    fn jsx_expression_child(&mut self, element: u32) -> ExprId {
        let open = self.pos();
        self.next();
        let expression = if self.token() == T::CloseBrace {
            // The missing expression is placed at the opening brace.
            self.add_expr(ExprKind::Missing, open, open)
        } else if self.eat(T::DotDotDot) {
            let operand = self.expression_allowing_in();
            self.finish_expr(ExprKind::Spread(operand), element)
        } else {
            self.expression_allowing_in()
        };
        if self.token() != T::CloseBrace {
            self.fail();
            return expression;
        }
        self.f.jsx_expressions.push((expression, open, self.lx.end));
        self.lx.next_jsx_child();
        expression
    }
}
