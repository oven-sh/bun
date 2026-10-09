//! The tree as JSON, for the comparison with what `svelte/compiler` makes: test/cli/format/oracle/svelte.

use super::ast::{Expression, FragmentId, Id, Kind, Pattern, Span, Tree, Value};
use std::io::Write;

struct Dump<'t, 'a> {
    tree: &'t Tree<'a>,
    out: Vec<u8>,
}

impl Dump<'_, '_> {
    fn text(&mut self, text: &[u8]) {
        bun_lint::linter::write_json_string(&mut self.out, text);
    }

    fn span(&mut self, span: Span) {
        let _ = write!(self.out, "[{},{}]", span.start, span.end);
    }

    fn expression(&mut self, expression: Expression) {
        self.span(expression.span);
    }

    fn list<T>(&mut self, items: impl IntoIterator<Item = T>, mut write: impl FnMut(&mut Self, T)) {
        self.out.push(b'[');
        for (index, item) in items.into_iter().enumerate() {
            if index > 0 {
                self.out.push(b',');
            }
            write(self, item);
        }
        self.out.push(b']');
    }

    fn optional<T>(&mut self, item: Option<T>, write: impl FnOnce(&mut Self, T)) {
        match item {
            Some(item) => write(self, item),
            None => self.out.extend_from_slice(b"null"),
        }
    }

    fn comma(&mut self) {
        self.out.push(b',');
    }

    fn nodes(&mut self, nodes: &[Id]) {
        self.list(nodes.iter().copied(), Self::node);
    }

    fn fragment(&mut self, fragment: FragmentId) {
        let tree = self.tree;
        self.nodes(tree.fragment(fragment));
    }

    fn pattern(&mut self, pattern: Pattern) {
        let _ = write!(self.out, "[{},{},", pattern.span.start, pattern.span.end);
        self.optional(pattern.annotation, Self::span);
        self.out.push(b']');
    }

    fn value(&mut self, value: &Value) {
        match value {
            Value::True => self.out.extend_from_slice(b"true"),
            Value::Tag(tag) => self.node(*tag),
            Value::Parts(parts) => self.nodes(parts),
        }
    }

    fn head(&mut self, name: &str, id: Id) {
        let node = &self.tree[id];
        let _ = write!(self.out, "[\"{name}\",{},{}", node.start, node.end);
    }

    fn node(&mut self, id: Id) {
        let tree = self.tree;
        match &tree[id].kind {
            Kind::Text { .. } => self.head("Text", id),
            Kind::Comment { data } => {
                self.head("Comment", id);
                self.comma();
                self.text(data);
            }
            Kind::Element(element) => {
                self.head(element.kind.name(), id);
                self.comma();
                self.text(element.name);
                self.comma();
                self.nodes(&element.attributes);
                self.comma();
                self.fragment(element.fragment);
                self.comma();
                self.optional(element.this, Self::expression);
            }
            Kind::Attribute { name, value } => {
                self.head("Attribute", id);
                self.comma();
                self.text(name);
                self.comma();
                self.value(value);
            }
            Kind::SpreadAttribute(expression)
            | Kind::AttachTag(expression)
            | Kind::ExpressionTag(expression)
            | Kind::HtmlTag(expression)
            | Kind::RenderTag(expression) => {
                self.head(
                    match &tree[id].kind {
                        Kind::SpreadAttribute(_) => "SpreadAttribute",
                        Kind::AttachTag(_) => "AttachTag",
                        Kind::HtmlTag(_) => "HtmlTag",
                        Kind::RenderTag(_) => "RenderTag",
                        _ => "ExpressionTag",
                    },
                    id,
                );
                self.comma();
                self.expression(*expression);
            }
            Kind::Directive {
                kind,
                name,
                modifiers,
                expression,
            } => {
                self.head(kind.name(), id);
                self.comma();
                self.text(name);
                self.comma();
                self.list(modifiers.iter(), |it, modifier| it.text(modifier));
                self.comma();
                self.optional(*expression, Self::expression);
            }
            Kind::StyleDirective {
                name,
                modifiers,
                value,
            } => {
                self.head("StyleDirective", id);
                self.comma();
                self.text(name);
                self.comma();
                self.list(modifiers.iter(), |it, modifier| it.text(modifier));
                self.comma();
                self.value(value);
            }
            Kind::ConstTag(span) | Kind::DeclarationTag(span) => {
                self.head(
                    match &tree[id].kind {
                        Kind::ConstTag(_) => "ConstTag",
                        _ => "DeclarationTag",
                    },
                    id,
                );
                self.comma();
                self.span(*span);
            }
            Kind::DebugTag(identifiers) => {
                self.head("DebugTag", id);
                self.comma();
                self.list(identifiers.iter().copied(), Self::span);
            }
            Kind::IfBlock {
                is_else_if,
                test,
                consequent,
                alternate,
            } => {
                self.head("IfBlock", id);
                let _ = write!(self.out, ",{is_else_if},");
                self.expression(*test);
                self.comma();
                self.fragment(*consequent);
                self.comma();
                self.optional(*alternate, Self::fragment);
            }
            Kind::EachBlock {
                expression,
                context,
                index,
                key,
                body,
                fallback,
            } => {
                self.head("EachBlock", id);
                self.comma();
                self.expression(*expression);
                self.comma();
                self.optional(*context, Self::pattern);
                self.comma();
                self.optional(*index, |it, index| it.text(index));
                self.comma();
                self.optional(*key, Self::expression);
                self.comma();
                self.fragment(*body);
                self.comma();
                self.optional(*fallback, Self::fragment);
            }
            Kind::AwaitBlock {
                expression,
                value,
                error,
                pending,
                then,
                catch,
            } => {
                self.head("AwaitBlock", id);
                self.comma();
                self.expression(*expression);
                for pattern in [value, error] {
                    self.comma();
                    self.optional(*pattern, Self::pattern);
                }
                for fragment in [pending, then, catch] {
                    self.comma();
                    self.optional(*fragment, Self::fragment);
                }
            }
            Kind::KeyBlock {
                expression,
                fragment,
            } => {
                self.head("KeyBlock", id);
                self.comma();
                self.expression(*expression);
                self.comma();
                self.fragment(*fragment);
            }
            Kind::SnippetBlock {
                expression,
                last_parameter_end,
                body,
            } => {
                self.head("SnippetBlock", id);
                self.comma();
                self.span(*expression);
                self.comma();
                self.optional(*last_parameter_end, |it, end| {
                    let _ = write!(it.out, "{end}");
                });
                self.comma();
                self.fragment(*body);
            }
            Kind::Script {
                is_module,
                attributes,
            } => {
                self.head("Script", id);
                let _ = write!(self.out, ",{is_module},");
                self.nodes(attributes);
            }
            Kind::StyleSheet { attributes } => {
                self.head("StyleSheet", id);
                self.comma();
                self.nodes(attributes);
            }
        }
        self.out.push(b']');
    }
}

/// `[fragment, options, module, instance, css, comments]`
pub(crate) fn dump(tree: &Tree<'_>) -> Vec<u8> {
    let mut dump = Dump {
        tree,
        out: vec![b'['],
    };
    dump.fragment(tree.fragment);
    for part in [tree.options, tree.module, tree.instance, tree.css] {
        dump.comma();
        dump.optional(part, Dump::node);
    }
    dump.comma();
    dump.list(tree.comments.iter(), |it, comment| {
        let (span, is_block) = (comment.span, comment.is_block);
        let _ = write!(it.out, "[{},{},{is_block}]", span.start, span.end);
    });
    dump.out.push(b']');
    dump.out
}
