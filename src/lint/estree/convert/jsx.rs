//! JSX.

use super::Converter;
use crate::ast::{Expr, ExprKind, Jsx, JsxChild, KeyKind, Prop, PropKind};
use crate::estree::NodeType::*;
use crate::estree::Sink;
use crate::ast::entities::unescape;
use crate::span::Span;

impl<'a, S: Sink> Converter<'a, '_, S> {
    pub(super) fn jsx(&mut self, span: Span, jsx: Jsx<'a>) {
        let Some(tag) = jsx.tag() else {
            self.open(JSXFragment, span);
            self.field("openingFragment");
            self.leaf(JSXOpeningFragment, jsx.opening_span());
            self.list("children", jsx.children_with_whitespace(), Self::jsx_child);
            self.field("closingFragment");
            self.leaf(JSXClosingFragment, jsx.closing_span().unwrap_or_default());
            return self.close();
        };
        self.open(JSXElement, span);
        self.field("openingElement");
        self.open(JSXOpeningElement, jsx.opening_span());
        self.field("name");
        self.jsx_tag_name(tag);
        self.type_arguments("typeArguments", jsx.type_args());
        self.list("attributes", jsx.attrs(), Self::jsx_attribute);
        self.flag("selfClosing", jsx.is_self_closing());
        self.close();
        self.list("children", jsx.children_with_whitespace(), Self::jsx_child);
        self.field("closingElement");
        match (jsx.closing_span(), jsx.close_tag()) {
            (Some(closing), Some(name)) => {
                self.open(JSXClosingElement, closing);
                self.field("name");
                self.jsx_tag_name(name);
                self.close();
            }
            _ => self.out.null(),
        }
        self.close();
    }

    fn jsx_identifier(&mut self, span: Span) {
        self.open(JSXIdentifier, span);
        self.text("name", self.file.slice(span));
        self.close();
    }

    /// `a`, `a-b`, `a:b` at `span`.
    fn jsx_name(&mut self, span: Span) {
        let written = self.file.slice(span);
        let Some(colon) = bun_core::strings::index_of_char_usize(written, b':') else {
            return self.jsx_identifier(span);
        };
        let text = self.file.text();
        let colon = span.start + colon as u32;
        self.open(JSXNamespacedName, span);
        self.field("namespace");
        self.jsx_identifier(Span::new(span.start, crate::tokens::skip_trivia_back(text, colon)));
        self.field("name");
        self.jsx_identifier(Span::new(crate::tokens::skip_trivia(text, colon + 1), span.end));
        self.close();
    }

    fn jsx_tag_name(&mut self, name: Expr<'a>) {
        match name.kind() {
            ExprKind::Dot { obj, name: property, .. } => {
                self.open(JSXMemberExpression, name.span());
                self.field("object");
                self.jsx_tag_name(obj);
                self.field("property");
                self.jsx_identifier(property.span());
                self.close();
            }
            _ => self.jsx_name(name.span()),
        }
    }

    fn jsx_attribute(&mut self, attribute: Prop<'a>) {
        let span = attribute.span();
        if attribute.kind() == PropKind::Spread {
            self.open(JSXSpreadAttribute, span);
            self.field("argument");
            self.opt_expr(attribute.value());
            return self.close();
        }
        self.open(JSXAttribute, span);
        self.field("name");
        match attribute.key() {
            Some(key) if matches!(key.kind(), KeyKind::Ident(_)) => self.jsx_name(key.span(self.file)),
            _ => self.out.null(),
        }
        self.field("value");
        match attribute.value() {
            None => self.out.null(),
            Some(value) => match (value.jsx_container_span(), value.kind()) {
                (Some(braces), _) => self.jsx_container(braces, value),
                (None, _) => self.expr(value),
            },
        }
        self.close();
    }

    /// `{e}`, `{...e}`, `{}`
    fn jsx_container(&mut self, braces: Span, e: Expr<'a>) {
        let kind = e.kind();
        let is_spread = matches!(kind, ExprKind::Spread(_));
        self.open(if is_spread { JSXSpreadChild } else { JSXExpressionContainer }, braces);
        self.field("expression");
        match kind {
            ExprKind::Spread(argument) => self.expr(argument),
            ExprKind::Missing => self.leaf(JSXEmptyExpression, braces.shrink(1, 1)),
            _ => self.expr(e),
        }
        self.close();
    }

    fn jsx_child(&mut self, child: JsxChild<'a>) {
        let text = match child {
            JsxChild::Whitespace(span) => span,
            JsxChild::Expr(child) => match child.jsx_container_span() {
                Some(braces) => return self.jsx_container(braces, child),
                None if child.is_jsx_text() => child.span(),
                None => return self.expr(child),
            },
        };
        let raw = self.file.slice(text);
        self.open(JSXText, text);
        self.text("raw", raw);
        self.text("value", &unescape(raw));
        self.close();
    }
}
