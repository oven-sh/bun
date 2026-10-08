//! From the syntax of a file to ESTree. What each node consists of follows `convert.ts` of
//! typescript-estree.

mod decl;
mod expr;
mod jsx;
mod stmt;
mod ty;

use super::{NodeType, Sink};
use crate::ast::{
    EntityName, Expr, File, Flags, Ident, Key, KeyKind, List, Modifier, Pat, PatElem, PatKind,
    PatProp, TypeNode,
};
use crate::span::Span;
use NodeType::*;

/// Tells `sink` the ESTree of `file`, which starts with a `Program`. Returns `false` if the syntax
/// is nested too deeply: what the sink has been told is then incomplete, with `null` in place of
/// what is nested deeper.
pub fn convert<'a, S: Sink>(file: &'a File<'a>, sink: &mut S) -> bool {
    let mut converter = Converter {
        file,
        out: sink,
        stack: bun_core::StackCheck::init(),
        is_too_deep: false,
        has_import_meta: false,
    };
    converter.program();
    !converter.is_too_deep
}

struct Converter<'a, 's, S> {
    file: &'a File<'a>,
    out: &'s mut S,
    stack: bun_core::StackCheck,
    is_too_deep: bool,
    /// An `import.meta` makes the file a module.
    has_import_meta: bool,
}

/// What typescript-estree adds to the node of a binding pattern from what is around it.
#[derive(Copy, Clone, Default)]
struct Extras<'a> {
    /// `a?`
    is_optional: bool,
    ty: Option<TypeNode<'a>>,
    /// Where the `?` or the type annotation ends.
    end: u32,
    /// The modifiers that the decorators are among.
    decorators: Option<List<'a, Modifier<'a>>>,
}

impl<'a, S: Sink> Converter<'a, '_, S> {
    // ───────────────────────────── the sink ─────────────────────────────

    #[inline]
    fn open(&mut self, node_type: NodeType, span: Span) {
        self.out.start_node(node_type, span);
    }

    #[inline]
    fn close(&mut self) {
        self.out.end_node();
    }

    /// A node without fields.
    #[inline]
    fn leaf(&mut self, node_type: NodeType, span: Span) {
        self.open(node_type, span);
        self.close();
    }

    #[inline]
    fn field(&mut self, name: &'static str) {
        self.out.field(name);
    }

    #[inline]
    fn flag(&mut self, name: &'static str, value: bool) {
        self.out.field(name);
        self.out.boolean(value);
    }

    #[inline]
    fn text(&mut self, name: &'static str, value: &[u8]) {
        self.out.field(name);
        self.out.string(value);
    }

    #[inline]
    fn null(&mut self, name: &'static str) {
        self.out.field(name);
        self.out.null();
    }

    /// The field `name` with an empty list.
    #[inline]
    fn empty(&mut self, name: &'static str) {
        self.out.field(name);
        self.out.start_list();
        self.out.end_list();
    }

    /// The field `name` with a list of what `each` makes of `items`.
    #[inline]
    fn list<T>(
        &mut self,
        name: &'static str,
        items: impl IntoIterator<Item = T>,
        mut each: impl FnMut(&mut Self, T),
    ) {
        self.out.field(name);
        self.out.start_list();
        for item in items {
            each(self, item);
        }
        self.out.end_list();
    }

    /// Whether there is stack left to go deeper. If not, the value is `null`.
    #[inline]
    fn can_descend(&mut self) -> bool {
        let is_safe = self.stack.is_safe_to_recurse();
        if !is_safe {
            self.is_too_deep = true;
            self.out.null();
        }
        is_safe
    }

    // ───────────────────────────── names and literals ─────────────────────────────

    fn identifier(&mut self, name: &[u8], span: Span) {
        self.open(Identifier, span);
        self.empty("decorators");
        self.text("name", name);
        self.flag("optional", false);
        self.close();
    }

    #[inline]
    fn ident(&mut self, ident: Ident<'a>) {
        self.identifier(ident.bytes(), ident.span());
    }

    /// A name of an import or an export, which can be written as a string.
    fn module_export_name(&mut self, name: Ident<'a>) {
        match name.is_string() {
            true => self.string_literal(name.span(), name.bytes()),
            false => self.ident(name),
        }
    }

    fn string_literal(&mut self, span: Span, value: &[u8]) {
        self.open(Literal, span);
        self.text("raw", self.file.slice(span));
        self.text("value", value);
        self.close();
    }

    fn number_literal(&mut self, span: Span, value: f64) {
        self.open(Literal, span);
        self.text("raw", self.file.slice(span));
        self.field("value");
        self.out.number(value);
        self.close();
    }

    /// `digits`: in decimal, without the `n`.
    fn bigint_literal(&mut self, span: Span, digits: &[u8]) {
        self.open(Literal, span);
        self.text("bigint", digits);
        self.text("raw", self.file.slice(span));
        self.null("value");
        self.close();
    }

    /// A template without substitutions.
    fn plain_template(&mut self, span: Span, cooked: Option<&[u8]>) {
        self.open(TemplateLiteral, span);
        self.empty("expressions");
        self.field("quasis");
        self.out.start_list();
        self.template_element(span, true, cooked, self.file.slice(span.shrink(1, 1)));
        self.out.end_list();
        self.close();
    }

    /// `#name`
    fn private_identifier(&mut self, name: &[u8], span: Span) {
        self.open(PrivateIdentifier, span);
        self.text("name", name.strip_prefix(b"#").unwrap_or(name));
        self.close();
    }

    /// The name after a dot.
    fn property_name(&mut self, name: Ident<'a>) {
        match name.bytes().starts_with(b"#") {
            true => self.private_identifier(name.bytes(), name.span()),
            false => self.ident(name),
        }
    }

    /// The fields `computed` and `key`.
    fn key(&mut self, key: Key<'a>) {
        self.flag("computed", key.is_computed());
        self.field("key");
        self.key_value(key);
    }

    fn key_value(&mut self, key: Key<'a>) {
        let span = key.inner_span(self.file);
        match key.kind() {
            KeyKind::Ident(name) => self.identifier(name.bytes(), span),
            KeyKind::Private(name) => self.private_identifier(name.bytes(), span),
            KeyKind::ComputedString(value) if self.file.slice(span).starts_with(b"`") => {
                self.plain_template(span, Some(value.bytes()));
            }
            KeyKind::String(value) | KeyKind::ComputedString(value) => {
                self.string_literal(span, value.bytes());
            }
            KeyKind::Number(value) | KeyKind::ComputedNumber(value) => {
                let text = std::str::from_utf8(value.bytes()).unwrap_or_default();
                match self.file.slice(span).ends_with(b"n") {
                    true => self.bigint_literal(span, value.bytes()),
                    false => self.number_literal(span, text.parse().unwrap_or(f64::NAN)),
                }
            }
            KeyKind::Computed(e) => self.expr(e),
        }
    }

    /// `A.B.C` as nodes of the type `qualified`, whose fields are `left` and `right`, or `object`
    /// and `property`.
    fn entity_name(&mut self, name: EntityName<'a>, qualified: NodeType) {
        let Some(first) = name.first() else {
            return self.out.null();
        };
        let is_member = qualified == MemberExpression;
        for last in name.parts().skip(1).rev() {
            self.open(qualified, first.span().to(last.span()));
            if is_member {
                self.flag("computed", false);
                self.flag("optional", false);
            }
            self.field(if is_member { "object" } else { "left" });
        }
        self.ident(first);
        for part in name.parts().skip(1) {
            self.field(if is_member { "property" } else { "right" });
            self.ident(part);
            self.close();
        }
    }

    // ───────────────────────────── modifiers ─────────────────────────────

    /// The keywords among `modifiers`.
    fn keywords(modifiers: List<'a, Modifier<'a>>) -> Flags {
        modifiers.iter().fold(Flags::empty(), |all, it| all | it.flag())
    }

    /// The field `decorators`.
    fn decorators(&mut self, modifiers: Option<List<'a, Modifier<'a>>>) {
        let Some(modifiers) = modifiers else {
            return self.empty("decorators");
        };
        self.list("decorators", modifiers, |this, modifier| {
            if let Some(expression) = modifier.decorator() {
                this.open(Decorator, modifier.span());
                this.field("expression");
                this.expr(expression);
                this.close();
            }
        });
    }

    /// The field `accessibility`, if there is such a keyword.
    fn accessibility(&mut self, keywords: Flags) {
        if keywords.contains(Flags::PUBLIC) {
            self.text("accessibility", b"public");
        } else if keywords.contains(Flags::PROTECTED) {
            self.text("accessibility", b"protected");
        } else if keywords.contains(Flags::PRIVATE) {
            self.text("accessibility", b"private");
        }
    }

    // ───────────────────────────── binding patterns ─────────────────────────────

    #[inline]
    fn plain_pat(&mut self, pat: Pat<'a>) {
        self.pat(pat, Extras::default());
    }

    fn pat(&mut self, pat: Pat<'a>, extras: Extras<'a>) {
        if !self.can_descend() {
            return;
        }
        let mut span = pat.span();
        span.end = span.end.max(extras.end);
        match pat.kind() {
            PatKind::Missing => return self.out.null(),
            PatKind::Ident(name) => {
                self.open(Identifier, span);
                self.text("name", name.bytes());
            }
            PatKind::Object(properties) => {
                self.open(ObjectPattern, span);
                self.list("properties", properties, Self::pat_prop);
            }
            PatKind::Array(elements) => {
                self.open(ArrayPattern, span);
                self.list("elements", elements, Self::pat_elem);
            }
        }
        self.decorators(extras.decorators);
        self.flag("optional", extras.is_optional);
        self.type_annotation("typeAnnotation", extras.ty);
        self.close();
    }

    /// `left = right`
    fn assignment_pattern(&mut self, span: Span, left: Pat<'a>, extras: Extras<'a>, right: Expr<'a>) {
        self.open(AssignmentPattern, span);
        self.decorators(extras.decorators);
        self.field("left");
        self.pat(
            left,
            Extras {
                decorators: None,
                ..extras
            },
        );
        self.flag("optional", false);
        self.field("right");
        self.expr(right);
        self.close();
    }

    fn pat_prop(&mut self, prop: PatProp<'a>) {
        let value = prop.value();
        if prop.is_rest() {
            self.open(RestElement, prop.span());
            self.field("argument");
            self.plain_pat(value);
            self.empty("decorators");
            self.flag("optional", false);
            return self.close();
        }
        self.open(Property, prop.span());
        match prop.key() {
            Some(key) => self.key(key),
            None => self.null("key"),
        }
        self.text("kind", b"init");
        self.flag("method", false);
        self.flag("optional", false);
        self.flag("shorthand", prop.is_shorthand());
        self.field("value");
        match prop.default() {
            Some(default) => {
                let span = Span::new(value.span().start, default.outer_span().end);
                self.assignment_pattern(span, value, Extras::default(), default);
            }
            None => self.plain_pat(value),
        }
        self.close();
    }

    fn pat_elem(&mut self, element: PatElem<'a>) {
        let Some(pat) = element.pat() else {
            return self.out.null();
        };
        if let Some(default) = element.default() {
            self.assignment_pattern(element.span(), pat, Extras::default(), default);
        } else if element.is_rest() {
            self.open(RestElement, element.span());
            self.field("argument");
            self.plain_pat(pat);
            self.empty("decorators");
            self.flag("optional", false);
            self.close();
        } else {
            self.plain_pat(pat);
        }
    }
}
