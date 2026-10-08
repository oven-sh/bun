//! The expressions of Angular: Prettier's `language-html/embed/angular-*.js`, its parsers `__ng_*`, and what
//! `language-js/print/angular.js` prints for the nodes that are no expressions of JavaScript.
//!
//! An expression is checked by a parser that accepts what Angular accepts, which makes TypeScript of it: `parser`. That is
//! parsed and written by the formatter for JavaScript, which knows from `InHtml::root` that `a | b(c)` is a pipe.

mod lexer;
mod microsyntax;
mod parser;

use super::ast::{Attribute, Flags, Id};
use super::js::{self, AngularExpression, Hug};
use super::printer::Printer;
use super::utilities::{html_split, html_trim_preserve_indentation, min_indentation};
use crate::css::text;
use crate::options::{HtmlRoot, InHtml};
use crate::prelude::*;
use crate::write;
use bun_core::strings;
use microsyntax::Part;
use parser::{Expression, Parser};

/// The `//` comment at the end of an expression.
#[derive(Copy, Clone)]
struct LineComment<'c> {
    /// From the `//`, without white space at the end.
    text: &'c [u8],
    /// How many line breaks are before it, of which the second ends an empty line.
    lines_before: u8,
}

impl<'c> LineComment<'c> {
    /// `start`: where it starts in `code`.
    fn new(code: &'c [u8], start: usize) -> Self {
        // `hasNewline(text, start, { backwards: true })`, `isPreviousLineEmpty(text, start)`
        let mut before = &code[..start];
        let mut lines_before = 0;
        while lines_before < 2 {
            let line_end = before.iter().rposition(|byte| !matches!(byte, b' ' | b'\t')).map_or(0, |at| at + 1);
            match before[..line_end].split_last() {
                Some((b'\n', rest)) => before = rest,
                _ => break,
            }
            lines_before += 1;
        }
        LineComment {
            text: text::trim_end(&code[start..]),
            lines_before,
        }
    }

    fn is_prettier_ignore(self) -> bool {
        text::trim(&self.text[2..]) == b"prettier-ignore"
    }

    /// Prettier's `printTrailingComment`.
    fn write(self, f: &mut Formatter<'_>) {
        let content = format_with(|f| {
            match self.lines_before {
                0 => write!(f, space()),
                1 => write!(f, hard_line_break()),
                _ => write!(f, empty_line()),
            }
            js::write_string(self.text, f);
        });
        write!(f, [line_suffix(&content), expand_parent()]);
    }
}

/// `/^[$_a-z][\w$]*(?:-[$_a-z][\w$])*$/i.test(name)`
fn is_plain_microsyntax_key(name: &[u8]) -> bool {
    let is_start = |byte: u8| byte.is_ascii_alphabetic() || matches!(byte, b'$' | b'_');
    let is_part = |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'$' | b'_');
    let Some((&first, rest)) = name.split_first() else {
        return false;
    };
    let word_len = rest.iter().take_while(|byte| is_part(**byte)).count();
    let mut groups = rest[word_len..].chunks_exact(3);
    is_start(first)
        && groups.remainder().is_empty()
        && groups.all(|group| matches!(*group, [b'-', start, part] if is_start(start) && is_part(part)))
}

/// `JSON.stringify(name)`
fn json_stringify(name: &[u8], out: &mut Vec<u8>) {
    out.push(b'"');
    for &byte in name {
        match byte {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0..0x20 => {
                const HEX: &[u8; 16] = b"0123456789abcdef";
                out.extend_from_slice(&[b'\\', b'u', b'0', b'0', HEX[usize::from(byte >> 4)], HEX[usize::from(byte & 15)]]);
            }
            _ => out.push(byte),
        }
    }
    out.push(b'"');
}

/// The `key.name` of a node in the body of an `NGMicrosyntax`. `None`: it has no `key`.
fn key_name(part: &Part) -> Option<&[u8]> {
    match part {
        Part::Key(_) | Part::Expression { .. } => None,
        Part::KeyedExpression { key, .. } | Part::Let { key, .. } | Part::As { key, .. } => Some(&key[..]),
    }
}

/// `isNgForOf`
fn is_ng_for_of(part: &Part, index: usize) -> bool {
    index == 1 && matches!(part, Part::KeyedExpression { key, .. } if key == b"of")
}

/// What `text.split(/\{\{(.+?)\}\}/s)` returns: a text, and then, any number of times, what is between `{{` and `}}` and
/// a text.
fn split_at_interpolations(mut text: &[u8]) -> Vec<&[u8]> {
    let mut parts = Vec::new();
    while let Some(start) = strings::index_of(text, b"{{")
        && let Some(len) = text.get(start + 3..).and_then(|rest| strings::index_of(rest, b"}}")).map(|at| at + 1)
    {
        parts.push(&text[..start]);
        parts.push(&text[start + 2..start + 2 + len]);
        text = &text[start + 2 + len + 2..];
    }
    parts.push(text);
    parts
}

impl<'t, 'a> Printer<'t, 'a, '_, '_, '_> {
    /// Writes what `write` writes the way `formatAttributeValue` returns it.
    fn write_hugged(&mut self, should_hug: Option<bool>, write: impl FnOnce(&mut Self) -> bool) -> bool {
        match should_hug {
            None => write(self),
            Some(false) => self.print_expand(true, write),
            Some(true) => {
                self.out.start_group();
                let is_written = write(self);
                self.out.end_group();
                is_written
            }
        }
    }

    /// Writes an expression that is a part of what is written.
    fn write_part(&mut self, expression: &Expression, in_html: InHtml) -> bool {
        let expression = AngularExpression {
            code: &expression.code,
            shown: expression.shown.as_deref(),
            ignored: None,
        };
        self.out.foreign(|f| js::write_angular_expression(f, &expression, in_html, Hug::Bare, &|_| {}))
    }

    /// `__ng_action`, `__ng_binding`, `__ng_interpolation`
    fn write_chain(&mut self, code: &[u8], in_html: InHtml, hug: Hug) -> bool {
        let is_action = in_html.root == HtmlRoot::NgAction;
        let comment_start = parser::comment_start(code);
        let mut parser = Parser::new(code, comment_start.unwrap_or(code.len()), is_action, self.stack_check);
        let Ok((expressions, range)) = parser.parse_chain() else {
            return false;
        };
        let comment = comment_start.map(|start| LineComment::new(code, start));
        // The comment is in the `NGEmptyExpression`, which does not print it.
        if expressions.is_empty() && comment.is_some() {
            return false;
        }
        let ignored = comment.filter(|comment| comment.is_prettier_ignore()).map(|_| &code[range]);
        if let ([expression], false) = (&expressions[..], is_action) {
            let expression = AngularExpression {
                code: &expression.code,
                shown: expression.shown.as_deref(),
                ignored,
            };
            return self.out.foreign(|f| {
                js::write_angular_expression(f, &expression, in_html, hug, &|f| {
                    if let Some(comment) = comment {
                        comment.write(f);
                    }
                })
            });
        }
        // An `NGEmptyExpression` or an `NGChainedExpression`, which `shouldHugJsExpression` has nothing to say about.
        let should_hug = match hug {
            Hug::Always => Some(true),
            Hug::Never | Hug::Expression => Some(false),
            Hug::Bare => None,
        };
        self.write_hugged(should_hug, |printer| {
            if !is_action {
                return true;
            }
            let mut is_written = true;
            match ignored {
                Some(ignored) => printer.out.foreign(|f| js::write_string(ignored, f)),
                None => {
                    printer.out.start_group();
                    if expressions.is_empty() {
                        printer.out.token("()");
                    }
                    for (index, expression) in expressions.iter().enumerate() {
                        if index > 0 {
                            printer.out.token(";");
                            printer.out.line();
                        }
                        if !expression.has_side_effect {
                            printer.out.token("(");
                        }
                        is_written = is_written && printer.write_part(expression, in_html);
                        if !expression.has_side_effect {
                            printer.out.token(")");
                        }
                    }
                    printer.out.end_group();
                }
            }
            if let Some(comment) = comment {
                printer.out.foreign(|f| comment.write(f));
            }
            is_written
        })
    }

    /// An `NGMicrosyntaxKey`.
    fn write_microsyntax_key(&mut self, name: &[u8]) {
        match is_plain_microsyntax_key(name) {
            true => self.out.text(name),
            false => self.out.built_text(|out| json_stringify(name, out)),
        }
    }

    /// An `NGMicrosyntaxExpression`.
    fn write_microsyntax_expression(&mut self, expression: &Expression, alias: Option<&[u8]>, in_html: InHtml) -> bool {
        let is_written = self.write_part(expression, in_html);
        if let Some(alias) = alias {
            self.out.token(" as ");
            self.write_microsyntax_key(alias);
        }
        is_written
    }

    /// `__ng_directive`
    fn write_microsyntax(&mut self, code: &[u8], in_html: InHtml, hug: Hug) -> bool {
        let Ok(body) = Parser::new(code, code.len(), false, self.stack_check).parse_microsyntax() else {
            return false;
        };
        if let [Part::Expression { expression, alias }] = &body[..] {
            let expression = AngularExpression {
                code: &expression.code,
                shown: expression.shown.as_deref(),
                ignored: None,
            };
            // To the formatter for JavaScript, the only expression of an `NGMicrosyntax` is what a binding is.
            let in_html = InHtml {
                root: HtmlRoot::NgBinding,
                ..in_html
            };
            return self.out.foreign(|f| {
                js::write_angular_expression(f, &expression, in_html, hug, &|f| {
                    let Some(alias) = alias else {
                        return;
                    };
                    write!(f, " as ");
                    match is_plain_microsyntax_key(alias) {
                        true => write!(f, text(alias)),
                        false => f.write_built_text(|out| json_stringify(alias, out)),
                    }
                })
            });
        }
        // `isNgForOfTrack` reads the name of the key of the second node.
        let has_no_key = |part: &Part| key_name(part).is_none();
        if body.get(1).is_some_and(has_no_key) && body.iter().skip(2).any(|part| matches!(part, Part::KeyedExpression { .. })) {
            return false;
        }
        let should_hug = match hug {
            Hug::Always => Some(true),
            Hug::Never | Hug::Expression => Some(false),
            Hug::Bare => None,
        };
        self.write_hugged(should_hug, |printer| {
            let mut is_written = true;
            for (index, part) in body.iter().enumerate() {
                if is_ng_for_of(part, index) {
                    printer.out.token(" ");
                } else if index > 0 {
                    printer.out.token(";");
                    printer.out.line();
                }
                match part {
                    Part::Key(name) => printer.write_microsyntax_key(name),
                    Part::Expression { expression, alias } => {
                        is_written = is_written && printer.write_microsyntax_expression(expression, alias.as_deref(), in_html);
                    }
                    Part::KeyedExpression { key, expression, alias } => {
                        let is_second_key = |name: &[u8]| body.get(1).and_then(key_name) == Some(name);
                        let should_not_print_colon = is_ng_for_of(part, index)
                            || (is_second_key(b"of") && key == b"track")
                            || (matches!(body.first(), Some(Part::Expression { .. }))
                                && match index {
                                    1 => matches!(&key[..], b"then" | b"else" | b"as"),
                                    2 => {
                                        key == b"track"
                                            || (key == b"else"
                                                && matches!(body.get(1), Some(Part::KeyedExpression { .. }))
                                                && is_second_key(b"then"))
                                    }
                                    _ => false,
                                });
                        printer.write_microsyntax_key(key);
                        printer.out.token(if should_not_print_colon { " " } else { ": " });
                        is_written = is_written && printer.write_microsyntax_expression(expression, alias.as_deref(), in_html);
                    }
                    Part::Let { key, value } => {
                        printer.out.token("let ");
                        printer.write_microsyntax_key(key);
                        if let Some(value) = value {
                            printer.out.token(" = ");
                            printer.write_microsyntax_key(value);
                        }
                    }
                    Part::As { key, alias } => {
                        printer.write_microsyntax_key(key);
                        printer.out.token(" as ");
                        printer.write_microsyntax_key(alias);
                    }
                }
            }
            is_written
        })
    }

    /// `formatAttributeValue(code, textToDoc, { parser: "__ng_.." })`. Returns whether it has been written.
    pub(crate) fn write_angular_expression(&mut self, code: &[u8], in_html: InHtml, hug: Hug) -> bool {
        match in_html.root {
            HtmlRoot::NgDirective => self.write_microsyntax(code, in_html, hug),
            _ => self.write_chain(code, in_html, hug),
        }
    }

    /// `printAngularI18n`
    fn print_angular_i18n(&mut self, element: Id, value: &[u8]) -> bool {
        let tree = self.tree;
        let parent = &tree[element];
        self.print_expand(!strings::contains(value, b"@@"), |printer| {
            // `getTextValueParts`
            let value = text::trim(value);
            if parent.has(Flags::IS_WHITESPACE_SENSITIVE) {
                // All that is between the parts of the `fill` is forced line breaks, so it is as good as an array.
                if parent.has(Flags::IS_INDENTATION_SENSITIVE) {
                    printer.out.text(value);
                    return true;
                }
                let value = html_trim_preserve_indentation(value);
                let dedent = min_indentation(value);
                for (index, line) in strings::split(value, b"\n").enumerate() {
                    if index > 0 {
                        printer.out.hardline();
                    }
                    printer.out.text(line.get(dedent..).unwrap_or_default());
                }
                return true;
            }
            printer.out.start_fill();
            printer.out.start_item();
            for (index, word) in html_split(value).enumerate() {
                if index > 0 {
                    printer.out.end_item();
                    printer.out.start_item();
                    printer.out.line();
                    printer.out.end_item();
                    printer.out.start_item();
                }
                printer.out.text(word);
            }
            printer.out.end_item();
            printer.out.end_fill();
            true
        })
    }

    /// `printAngularInterpolation`
    fn print_angular_interpolation(&mut self, value: &[u8]) -> bool {
        let in_html = InHtml {
            root: HtmlRoot::NgInterpolation,
            is_in_attribute: true,
            is_in_interpolation: true,
            ..InHtml::default()
        };
        for (index, part) in split_at_interpolations(value).into_iter().enumerate() {
            if index % 2 == 0 {
                self.out.text(part);
                continue;
            }
            let attempt = self.out.start_attempt();
            self.out.start_group();
            self.out.token("{{");
            self.out.start_indent();
            self.out.line();
            let is_written = self.write_angular_expression(part, in_html, Hug::Always);
            self.out.end_indent();
            self.out.line();
            self.out.token("}}");
            self.out.end_group();
            if !self.out.end_attempt(attempt, is_written) {
                self.out.token("{{");
                self.out.text(part);
                self.out.token("}}");
            }
        }
        true
    }

    /// The printers of `embed/angular-attributes.js`. `value`: without the entities for quotes. Returns whether the
    /// attribute has been written.
    pub(crate) fn embed_angular_attribute(&mut self, element: Id, attr: &'t Attribute<'a>, raw_value: &[u8], value: &[u8]) -> bool {
        let name = attr.full_name();
        let name = &name[..];
        let root = if (name.starts_with(b"(") && name.ends_with(b")")) || name.starts_with(b"on-") {
            Some(HtmlRoot::NgAction)
        } else if (name.starts_with(b"[") && name.ends_with(b"]"))
            || name.starts_with(b"bind-")
            || name.starts_with(b"bindon-")
            || matches!(name, b"ng-if" | b"ng-show" | b"ng-hide" | b"ng-class" | b"ng-style")
        {
            Some(HtmlRoot::NgBinding)
        } else if name.starts_with(b"*") {
            Some(HtmlRoot::NgDirective)
        } else {
            None
        };
        if let Some(root) = root {
            let in_html = InHtml {
                root,
                is_in_attribute: true,
                ..InHtml::default()
            };
            return self.print_attribute_with(attr, |printer| printer.write_angular_expression(value, in_html, Hug::Expression));
        }
        // `/^i18n(?:-.+)?$/`
        if name.strip_prefix(b"i18n").is_some_and(|rest| rest.is_empty() || (rest.len() > 1 && rest.starts_with(b"-"))) {
            return self.print_attribute_with(attr, |printer| printer.print_angular_i18n(element, value));
        }
        if split_at_interpolations(raw_value).len() > 1 {
            return self.print_attribute_with(attr, |printer| printer.print_angular_interpolation(value));
        }
        false
    }

    /// `printAngularControlFlowBlockParameters`
    pub(crate) fn embed_angular_control_flow_block_parameters(&mut self, block: Id, parameters: Id) -> bool {
        if !matches!(&self.tree[block].name[..], b"if" | b"else if" | b"for" | b"switch" | b"case") {
            return false;
        }
        let content = self.tree[parameters].span.of(self.options.original_text);
        if text::trim(content).is_empty() {
            return false;
        }
        let in_html = InHtml {
            root: HtmlRoot::NgDirective,
            ..InHtml::default()
        };
        let attempt = self.out.start_attempt();
        let is_written = self.write_angular_expression(content, in_html, Hug::Expression);
        self.out.end_attempt(attempt, is_written)
    }

    pub(crate) fn embed_angular_let_declaration_initializer(&mut self, id: Id) -> bool {
        let tree = self.tree;
        let in_html = InHtml {
            root: HtmlRoot::NgBinding,
            ..InHtml::default()
        };
        let attempt = self.out.start_attempt();
        let is_written = self.write_angular_expression(&tree[id].value, in_html, Hug::Always);
        self.out.end_attempt(attempt, is_written)
    }
}
