use crate::util_ast::{get_first_node_in_line, is_node_first_in_line};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::estree_compat::{estree_span, get_node_by_range_index};

/// Enforce JSX indentation.
pub struct JsxIndent {
    indent_char: u8,
    indent_size: i64,
    check_attributes: bool,
    indent_logical_expressions: bool,
}

const WRONG_INDENT: Message = Message::new(
    "wrongIndent",
    "Expected indentation of {{needed}} {{type}} {{characters}} but found {{gotten}}.",
);

impl Rule for JsxIndent {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-indent", Kind::Layout).fixable(Fixable::Whitespace);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]).stmts(&[StmtTag::Return]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let (indent_char, indent_size) = match options.number(0) {
            Some(size) => (b' ', i64::from(size as i32)),
            None if options.str(0) == Some("tab") => (b'\t', 1),
            None => (b' ', 4),
        };
        let config = options.object(1);
        JsxIndent {
            indent_char,
            indent_size,
            check_attributes: config.bool_or("checkAttributes", false),
            indent_logical_expressions: config.bool_or("indentLogicalExpressions", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.has_exprs([ExprTag::Jsx]).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else { return };
        let (file, start) = (cx.file(), e.span().start);
        self.handle_opening_element(e, jsx.opening_span(), cx);
        if let Some(closing) = jsx.closing_span().filter(|it| is_first_in_line(file, *it)) {
            self.check_nodes_indent(closing, self.get_node_indent(file, start), Some(e), cx);
        }
        for attribute in jsx.attrs().iter().filter(|it| it.kind() != PropKind::Spread) {
            if let Some(container) = attribute.value().and_then(Expr::jsx_container_span) {
                self.handle_attribute(attribute.span().start, container, cx);
            }
        }
        for child in jsx.children_with_whitespace() {
            match child {
                // Not all of it is white space for a regular expression.
                JsxChild::Whitespace(node) => self.check_literal_node_indent(node, file.slice(node), start, cx),
                JsxChild::Expr(child) => match child.jsx_container_span() {
                    Some(container) if child.tag() != ExprTag::Spread && is_first_in_line(file, container) => {
                        let indent = self.get_node_indent(file, start) + self.indent_size;
                        self.check_nodes_indent(container, indent, Some(e), cx);
                    }
                    Some(_) => {}
                    None => {
                        if let Some(value) = child.jsx_text_value() {
                            self.check_literal_node_indent(child.span(), &value, start, cx);
                        }
                    }
                },
            }
        }
    }

    /// A `return` of JSX is `isReturningJSX`.
    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Return(Some(argument)) = statement.kind() else { return };
        if argument.tag() != ExprTag::Jsx {
            return;
        }
        let (node, raw) = (statement.span(), statement.text());
        let Some(last_line_start) = strings::last_index_of_char(raw, b'\n') else { return };
        let last_line = raw.get(last_line_start..).unwrap_or_default();
        let opening_indent = self.get_node_indent(cx.file(), node.start);
        let closing_indent = self.indent_of(last_line.get(1..).unwrap_or_default());
        if opening_indent == closing_indent {
            return;
        }
        let mut functions = std::iter::successors(Node::Stmt(statement).enclosing_function(), |it| it.enclosing());
        if !functions.any(|it| !matches!(it.kind(), FnKind::Arrow | FnKind::StaticBlock)) {
            return;
        }
        self.report(node, opening_indent, closing_indent, cx).fix(|fixer| {
            let at = Span::new(node.start + last_line_start as u32, node.end);
            Some(fixer.replace(at, with_indent(last_line, &self.indent(opening_indent)?)))
        });
    }
}

impl JsxIndent {
    /// `repeat(indentChar, needed)`. `None` where that throws.
    fn indent(&self, needed: i64) -> Option<Vec<u8>> {
        (0..1 << 29).contains(&needed).then(|| vec![self.indent_char; needed as usize])
    }

    /// `report`, without the fix.
    fn report<'a>(&self, node: Span, needed: i64, gotten: i64, cx: &Cx<'a, Self>) -> Report<'a> {
        cx.report(node, WRONG_INDENT)
            .data("needed", needed)
            .data("type", if self.indent_char == b' ' { "space" } else { "tab" })
            .data("characters", if needed == 1 { "character" } else { "characters" })
            .data("gotten", gotten)
    }

    /// `report`, of what is neither text nor a `return`.
    fn report_first_in_line<'a>(&self, node: Span, needed: i64, gotten: i64, cx: &Cx<'a, Self>) -> Report<'a> {
        self.report(node, needed, gotten, cx).fix(|fixer| {
            let line = fixer.file().line_span(fixer.file().line_of(node.start));
            Some(fixer.replace(Span::before(line.start, node), self.indent(needed)?))
        })
    }

    /// How many characters of the indentation `line` starts with.
    fn indent_of(&self, line: &[u8]) -> i64 {
        (line.len() - strings::trim_left(line, &[self.indent_char]).len()) as i64
    }

    /// `getNodeIndent`, of what starts at `offset`.
    fn get_node_indent(&self, file: &File<'_>, offset: u32) -> i64 {
        self.indent_of(file.line_text(file.line_of(offset)))
    }

    /// `isRightInLogicalExp`, of what is directly in `element`.
    fn is_right_in_logical_exp(&self, element: Expr<'_>) -> bool {
        !self.indent_logical_expressions
            && matches!(element.parent(), Node::Expr(parent) if matches!(
                parent.kind(),
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, right, .. } if right == element
            ))
    }

    /// `checkNodesIndent`, of what is first in its line. `element`: its parent, if that is an element or a fragment.
    fn check_nodes_indent<'a>(&self, node: Span, indent: i64, element: Option<Expr<'a>>, cx: &Cx<'a, Self>) {
        let node_indent = self.get_node_indent(cx.file(), node.start);
        let is_correct_right_in_logical_exp =
            || node_indent - indent == self.indent_size && element.is_some_and(|it| self.is_right_in_logical_exp(it));
        if node_indent != indent && !is_correct_right_in_logical_exp() {
            self.report_first_in_line(node, indent, node_indent, cx);
        }
    }

    /// How long the first group of `/\n( *)[\t ]*\S/g`, or of the same for tabs, is in each match.
    fn node_indents_per_line(&self, value: &[u8]) -> impl Iterator<Item = i64> {
        let lines = strings::split(value, b"\n").skip(1).filter(|it| after_indent(it).is_some());
        lines.map(move |it| self.indent_of(it))
    }

    /// `handleLiteral`, `checkLiteralNodeIndent`. `parent`: where the element starts.
    fn check_literal_node_indent(&self, node: Span, value: &[u8], parent: u32, cx: &Cx<'_, Self>) {
        if self.node_indents_per_line(value).next().is_none() {
            return;
        }
        let indent = self.get_node_indent(cx.file(), parent) + self.indent_size;
        if self.node_indents_per_line(value).all(|it| it == indent) {
            return;
        }
        for node_indent in self.node_indents_per_line(value) {
            if cx.has_reported_too_much() {
                break;
            }
            self.report(node, indent, node_indent, cx)
                .fix(|fixer| Some(fixer.replace(node, with_indent(fixer.file().slice(node), &self.indent(indent)?))));
        }
    }

    /// `handleOpeningElement`. What is first in its line has the token before it, and what that is in, further up.
    fn handle_opening_element<'a>(&self, element: Expr<'a>, node: Span, cx: &Cx<'a, Self>) {
        let file = cx.file();
        if !is_first_in_line(file, node) {
            return;
        }
        let Some(prev_token) = file.token_before(node) else { return };
        let prev = match prev_token.kind() {
            TokenKind::JsxText => element.parent().span().start,
            TokenKind::Punctuator if prev_token.is(",") => {
                estree_span(get_node_by_range_index(file, prev_token.start())).start
            }
            TokenKind::Punctuator if prev_token.is(":") => {
                let mut tokens = file.tokens_before(prev_token);
                let Some(token) = tokens.find(|it| it.kind() != TokenKind::Punctuator || it.is("/")) else { return };
                start_in_conditional_expression(file, token.start())
            }
            _ => prev_token.start(),
        };
        let is_alternate_in_conditional_exp = !prev_token.is("(")
            && matches!(element.parent(), Node::Expr(parent) if matches!(
                parent.kind(),
                ExprKind::Cond { no, .. } if no == element
            ));
        let is_indented = !is_alternate_in_conditional_exp && !self.is_right_in_logical_exp(element);
        let indent = if is_indented { self.indent_size } else { 0 };
        self.check_nodes_indent(node, self.get_node_indent(file, prev) + indent, Some(element), cx);
    }

    /// `JSXExpressionContainer` for the value of an attribute, then `handleAttribute`. `name`: where the name starts.
    fn handle_attribute(&self, name: u32, container: Span, cx: &Cx<'_, Self>) {
        let file = cx.file();
        let is_container_first_in_line = is_first_in_line(file, container);
        if is_container_first_in_line {
            self.check_nodes_indent(container, self.get_node_indent(file, name) + self.indent_size, None, cx);
        }
        if !self.check_attributes
            || !is_container_first_in_line && !strings::contains_js_line_break(file.slice(container))
        {
            return;
        }
        let last_token = Span::empty(container.end.saturating_sub(1));
        let Some(first_in_line) = get_first_node_in_line(file, last_token) else { return };
        if !is_first_in_line(file, first_in_line.span()) {
            return;
        }
        let name_indent = self.get_node_indent(file, name);
        let node_indent = self.get_node_indent(file, first_in_line.start());
        if node_indent != name_indent {
            // Of `a={}` it is the `{`, and upstream is at the attribute before it is at its value.
            self.report_first_in_line(first_in_line.span(), name_indent, node_indent, cx).shorter_first();
        }
    }
}

/// `isNodeFirstInLine`. The tokens are looked at only where the text before `node` does not say it.
fn is_first_in_line<'a>(file: &'a File<'a>, node: Span) -> bool {
    let before = file.text().get(..node.start as usize).unwrap_or_default();
    match strings::trim_right(before, b" \t").last() {
        Some(b'\n') => true,
        // Not the end of a comment, nor of a character reference, which can stand for white space.
        Some(it) if it.is_ascii_graphic() && !matches!(it, b'/' | b';') => false,
        _ => is_node_first_in_line(file, node),
    }
}

/// What follows `/^[\t ]*/` in `line`, if `\S` matches there.
fn after_indent(line: &[u8]) -> Option<&[u8]> {
    let rest = strings::trim_left(line, b" \t");
    (!rest.is_empty() && strings::js_whitespace_len(rest) == 0).then_some(rest)
}

/// ``raw.replace(/\n[\t ]*(\S)/g, (match, p1) => `\n${indent}${p1}`)``
#[cold]
#[inline(never)]
fn with_indent(raw: &[u8], indent: &[u8]) -> Vec<u8> {
    let mut lines = strings::split(raw, b"\n");
    let mut fixed = lines.next().unwrap_or_default().to_vec();
    for line in lines {
        fixed.push(b'\n');
        if let Some(rest) = after_indent(line) {
            fixed.extend_from_slice(indent);
            fixed.extend_from_slice(rest);
        } else {
            fixed.extend_from_slice(line);
        }
    }
    fixed
}

/// Where the operand of the innermost `?:` around `offset` starts, and without one the `Program`.
fn start_in_conditional_expression<'a>(file: &'a File<'a>, offset: u32) -> u32 {
    let mut node = get_node_by_range_index(file, offset);
    for parent in node.ancestors() {
        if matches!(parent, Node::Expr(it) if it.tag() == ExprTag::Cond) {
            return estree_span(node).start;
        }
        node = parent;
    }
    // espree's is the whole text.
    if file.uses_typescript_parser() { file.program_span().start } else { 0 }
}
