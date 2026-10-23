use bun_core::strings;
use bun_lint::ast::svelte::{Role, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow unnecessary mustache interpolations
pub struct NoUselessMustaches {
    ignore_includes_comment: bool,
    ignore_string_escape: bool,
}

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected mustache interpolation with a string literal value.",
);

impl Rule for NoUselessMustaches {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-useless-mustaches", Kind::Suggestion).recommended()
        .fixable(Fixable::Code);
    const ON: On = On::new().svelte_nodes(&[SvelteTag::MustacheTag]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let flag = |name| options.get(name).is_some_and(Json::is_truthy);
        NoUselessMustaches {
            ignore_includes_comment: flag("ignoreIncludesComment"),
            ignore_string_escape: flag("ignoreStringEscape"),
        }
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        if node.kind() == SvelteKind::Raw {
            return;
        }
        let Some(code) = node.code(Role::Expression) else {
            return;
        };
        let Some(Node::Expr(e)) = code.node() else {
            return;
        };
        let (value, raw, is_template) = match e.kind() {
            ExprKind::String(value) => {
                let text = code.text();
                let raw = text.get(1..text.len().saturating_sub(1)).unwrap_or_default();
                (Some(value.bytes()), raw, false)
            }
            ExprKind::Template(template) if template.exprs().is_empty() => (
                template.cooked(0).map(|it| it.bytes()),
                template.raw(0),
                true,
            ),
            _ => return,
        };
        // Only whitespace and comments surround the literal, which is a string.
        let around = [
            Span::new(node.span().start + 1, code.span().start),
            Span::new(code.span().end, node.span().end.saturating_sub(1)),
        ];
        let component = node.file().svelte().map_or(&[][..], |it| it.text());
        let has_comment = around.iter().any(|it| {
            component.get(it.start as usize..it.end as usize)
                .is_some_and(|it| strings::contains_char(it, b'/'))
        });
        if self.ignore_includes_comment && has_comment {
            return;
        }
        if is_template && strings::index_of_any(raw, b"\n\r").is_some() {
            return;
        }
        if strings::contains_char(raw, b'{') {
            return;
        }
        let has_escape = value != Some(raw) && has_useful_escape(raw);
        if self.ignore_string_escape && has_escape {
            return;
        }
        cx.report(node, UNEXPECTED).fix(|fixer| {
            if has_comment || has_escape {
                return None;
            }
            let text = strip_quotes(code.text())?;
            if strings::contains_char(text, b'\n') || strings::trim_js_whitespace(text) != text {
                // Another rule like indent or eol space might remove spaces.
                return None;
            }
            let unescaped = unescaped(text);
            let parent = node.parent()?;
            if matches!(parent.tag(), SvelteTag::Attribute | SvelteTag::StyleDirective) {
                let first = parent.child(Role::Value)?;
                let last = parent.nodes(Role::Value).last()?;
                let key = parent.child(Role::Key)?;
                let between = component
                    .get(key.span().end as usize..first.span().start as usize)
                    .unwrap_or_default();
                return Some(match between.last() {
                    Some(b'"') => vec![fixer.replace(node, replaced(&unescaped, b'"', b"&quot;"))],
                    Some(b'\'') => {
                        vec![fixer.replace(node, replaced(&unescaped, b'\'', b"&apos;"))]
                    }
                    _ => vec![
                        fixer.insert_before(first, "\""),
                        fixer.replace(node, replaced(&unescaped, b'"', b"&quot;")),
                        fixer.insert_after(last, "\""),
                    ],
                });
            }
            let escaped = replaced(&replaced(&unescaped, b'<', b"&lt;"), b'>', b"&gt;");
            Some(vec![fixer.replace(node, escaped)])
        });
    }
}

/// True if `raw`, a string literal's text, has an escape sequence that means more than the character after the `\`.
fn has_useful_escape(raw: &[u8]) -> bool {
    let mut rest = raw;
    while let Some(at) = strings::index_of_char_usize(rest, b'\\') {
        match rest.get(at + 1) {
            None => return true,
            Some(&c) if strings::contains_char(b"nrvtbfux", c) => return true,
            Some(_) => rest = rest.get(at + 2..).unwrap_or_default(),
        }
    }
    false
}

/// `stripQuotes`: the text between the quotes or backticks, if it has them.
fn strip_quotes(text: &[u8]) -> Option<&[u8]> {
    let (&first, rest) = text.split_first()?;
    let inner = rest.strip_suffix(&[first])?;
    matches!(first, b'"' | b'\'' | b'`').then_some(inner)
}

/// `text.replace(/\\([\s\S])/g, '$1')`
fn unescaped(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = strings::index_of_char_usize(rest, b'\\') {
        out.extend_from_slice(&rest[..at]);
        match rest.get(at + 1) {
            Some(&next) => {
                out.push(next);
                rest = rest.get(at + 2..).unwrap_or_default();
            }
            None => {
                out.push(b'\\');
                rest = &[];
            }
        }
    }
    out.extend_from_slice(rest);
    out
}

fn replaced(text: &[u8], byte: u8, with: &[u8]) -> Vec<u8> {
    strings::replace_owned(text, &[byte], with)
}
