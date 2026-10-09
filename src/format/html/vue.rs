//! Prettier's `language-html/embed/vue-*.js`: the attributes of Vue.

use super::ast::{Attribute, Id};
use super::js::{self, Binding, Hug, Syntax};
use super::printer::Printer;
use crate::options::{HtmlRoot, InHtml};
use crate::text;

/// `v-for="left operator right"`
struct VFor<'v> {
    /// The alias and the iterators.
    left: [&'v [u8]; 3],
    operator: &'v [u8],
    right: &'v [u8],
}

/// `parseVueVForDirective`
fn parse_vue_v_for_directive(value: &[u8]) -> Option<VFor<'_>> {
    // `/(.*?)\s+(in|of)\s+(.*)/s`
    let mut at = 0;
    let (alias, operator, right) = loop {
        let rest = value.get(at..).filter(|rest| !rest.is_empty())?;
        let blank_len = text::leading_white_space_len(rest);
        if let [b'i', b'n', right @ ..] | [b'o', b'f', right @ ..] = &rest[blank_len..]
            && blank_len > 0
            && text::starts_with_white_space(right)
        {
            let operator = &rest[blank_len..blank_len + 2];
            break (&value[..at], operator, text::trim(right));
        }
        // From anywhere else in the white space, the same follows it.
        at += blank_len.max(1);
    };
    if right.is_empty() {
        return None;
    }
    // `.replaceAll(/^\(|\)$/g, "")`
    let alias = text::trim(alias);
    let alias = alias.strip_prefix(b"(").unwrap_or(alias);
    let alias = alias.strip_suffix(b")").unwrap_or(alias);
    // `/,([^,\]}]*)(?:,([^,\]}]*))?$/`: the first of the last two commas that no bracket follows.
    let mut commas = alias
        .iter()
        .enumerate()
        .rev()
        .take_while(|(_, byte)| !matches!(**byte, b']' | b'}'))
        .filter(|(_, byte)| **byte == b',')
        .map(|(at, _)| at);
    let left = match (commas.next(), commas.next()) {
        (None, _) => [alias, b"", b""],
        (Some(last), None) => [&alias[..last], text::trim(&alias[last + 1..]), b""],
        (Some(last), Some(first)) => [
            &alias[..first],
            text::trim(&alias[first + 1..last]),
            text::trim(&alias[last + 1..]),
        ],
    };
    let is_missing = |index: usize| {
        left[index].is_empty()
            && (index == 0 || left[index + 1..].iter().any(|part| !part.is_empty()))
    };
    if (0..3).any(is_missing) {
        return None;
    }
    Some(VFor {
        left,
        operator,
        right,
    })
}

impl<'t, 'a> Printer<'t, 'a, '_, '_, '_> {
    /// `isVueSfcWithTypescriptScript`
    pub(crate) fn is_vue_sfc_with_typescript_script(&mut self) -> bool {
        let (tree, options) = (self.tree, self.options);
        *self.has_typescript_script.get_or_insert_with(|| {
            tree.children(tree.root).any(|child| {
                tree.is_vue_script_tag(child, options)
                    && matches!(
                        tree.attribute(child, b"lang").flatten(),
                        Some(b"ts" | b"typescript")
                    )
            })
        })
    }

    /// `printVueVForDirective`
    fn print_vue_v_for_directive(
        &mut self,
        value: &[u8],
        is_typescript: bool,
        in_html: InHtml,
    ) -> bool {
        let Some(VFor {
            left,
            operator,
            right,
        }) = parse_vue_v_for_directive(value)
        else {
            return false;
        };
        let left = left
            .iter()
            .filter(|part| !part.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join(&b","[..]);
        self.out.start_group();
        let is_written = self
            .out
            .foreign(|f| js::write_binding(f, &left, is_typescript, in_html, Binding::ForLeft));
        self.out.end_group();
        self.out.token(" ");
        self.out.text(operator);
        self.out.token(" ");
        is_written
            && self
                .out
                .foreign(|f| js::write_expression(f, right, is_typescript, in_html, Hug::Always))
    }

    /// The printers of `embed/vue-attributes.js`. `value`: without the entities for quotes. Returns whether the
    /// attribute has been written.
    pub(crate) fn embed_vue_attribute(
        &mut self,
        element: Id,
        attr: &'t Attribute<'a>,
        value: &[u8],
    ) -> bool {
        let name = attr.full_name();
        let name = &name[..];
        let is_typescript = self.is_vue_sfc_with_typescript_script();
        let in_html = |root: HtmlRoot| InHtml {
            root,
            is_in_attribute: true,
            ..InHtml::default()
        };
        let expression = in_html(HtmlRoot::JsExpression);
        if name == b"v-for" {
            return self.print_attribute_with(attr, |printer| {
                printer.print_vue_v_for_directive(value, is_typescript, expression)
            });
        }
        if name == b"generic" && self.tree.is_vue_script_tag(element, self.options) {
            return self.print_attribute_with(attr, |printer| {
                printer.out.foreign(|f| {
                    js::write_binding(
                        f,
                        value,
                        true,
                        in_html(HtmlRoot::Program),
                        Binding::TypeParameters,
                    )
                })
            });
        }
        // `isVueSlotAttribute`, `isVueSfcBindingsAttribute`
        let is_bindings = name.starts_with(b"#")
            || name == b"slot-scope"
            || name == b"v-slot"
            || name.starts_with(b"v-slot:")
            || (self.tree.is_vue_sfc_block(element, self.options)
                && ((self.tree[element].is_full_name(b"script") && name == b"setup")
                    || (self.tree[element].is_full_name(b"style") && name == b"vars")));
        if is_bindings {
            return self.print_attribute_with(attr, |printer| {
                printer.out.foreign(|f| {
                    js::write_binding(
                        f,
                        value,
                        is_typescript,
                        in_html(HtmlRoot::Program),
                        Binding::Parameters,
                    )
                })
            });
        }
        if name.starts_with(b"@") || name.starts_with(b"v-on:") {
            // `printVueVOnDirective`
            let syntax = if is_typescript {
                Syntax::BabelTs
            } else {
                Syntax::Babel
            };
            return self.print_attribute_with(attr, |printer| {
                printer.out.foreign(|f| {
                    js::write_expression(f, value, is_typescript, expression, Hug::Expression)
                })
            }) || self.print_attribute_with(attr, |printer| {
                printer.out.foreign(|f| {
                    js::write_program_in_attribute(
                        f,
                        value,
                        syntax,
                        in_html(HtmlRoot::VueEventBinding),
                        Hug::Expression,
                    )
                })
            });
        }
        let root =
            if name.starts_with(b":") || name.starts_with(b".") || name.starts_with(b"v-bind:") {
                HtmlRoot::VueExpression
            } else if name.starts_with(b"v-") {
                HtmlRoot::JsExpression
            } else {
                return false;
            };
        self.print_attribute_with(attr, |printer| {
            printer.out.foreign(|f| {
                js::write_expression(f, value, is_typescript, in_html(root), Hug::Expression)
            })
        })
    }
}
