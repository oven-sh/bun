use crate::util_ast::is_node_first_in_line;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce props indentation in JSX
pub struct JsxIndentProps {
    indent: Indent,
    ignore_ternary_operator: bool,
}

/// `indentSize` and `indentType`
#[derive(Copy, Clone)]
enum Indent {
    /// As the first prop.
    First,
    Tab,
    Spaces(i64),
}

const WRONG_INDENT: Message = Message::new(
    "wrongIndent",
    "Expected indentation of {{needed}} {{type}} {{characters}} but found {{gotten}}.",
);

/// `line`. Upstream keeps it from one element to the next, whose own `<` resets it.
#[derive(Copy, Clone, Default)]
struct Line {
    is_using_operator: bool,
    current_operator: bool,
}

impl Rule for JsxIndentProps {
    const META: Meta =
        Meta::plugin(Plugin::React, "jsx-indent-props", Kind::None).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let mode = options.str(0).or_else(|| config.str("indentMode"));
        let size = options.number(0).or_else(|| config.number("indentMode"));
        JsxIndentProps {
            indent: match mode {
                Some("first") => Indent::First,
                Some("tab") => Indent::Tab,
                _ => Indent::Spaces(size.map_or(4, |it| it as i64)),
            },
            ignore_ternary_operator: config.bool_or("ignoreTernaryOperator", false),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let (Some(first_prop_node), Some(last_prop_node)) =
            (jsx.attrs().first(), jsx.attrs().last())
        else {
            return;
        };
        // Only a prop that is the first in its line is reported.
        let file = cx.file();
        if !strings::contains_js_line_break(
            file.slice(Span::before(e.span().start, last_prop_node.span())),
        ) {
            return;
        }
        let mut line = Line::default();
        let prop_indent = match self.indent.size() {
            None => i64::from(file.position(first_prop_node.span().start).column),
            Some(size) => self
                .get_node_indent(jsx.opening_span(), &mut line, file)
                .saturating_add(size),
        };
        self.check_nodes_indent(jsx.attrs(), prop_indent, line, (jsx.opening_span(), cx));
    }
}

impl Indent {
    /// `None`: `"first"`
    fn size(self) -> Option<i64> {
        match self {
            Indent::First => None,
            Indent::Tab => Some(1),
            Indent::Spaces(size) => Some(size),
        }
    }

    fn character(self) -> u8 {
        if matches!(self, Indent::Tab) {
            b'\t'
        } else {
            b' '
        }
    }
}

fn start_of_line(file: &File, offset: u32) -> u32 {
    file.line_span(file.line_of(offset)).start
}

impl JsxIndentProps {
    /// `getNodeIndent`
    fn get_node_indent(&self, node: Span, line: &mut Line, file: &File) -> i64 {
        let src = file.slice(Span::new(start_of_line(file, node.start), node.end));
        let src = strings::index_of_char_usize(src, b'\n')
            .and_then(|at| src.get(..at))
            .unwrap_or(src);
        line.current_operator =
            matches!(strings::trim_left(src, b" \t").first(), Some(b':' | b'?'));
        if line.current_operator {
            line.is_using_operator = true;
        } else if strings::contains_char(src, b'<') {
            line.is_using_operator = false;
        }
        strings::index_of_not_char(src, self.indent.character())
            .map_or_else(|| src.len() as i64, i64::from)
    }

    /// `checkNodesIndent`
    fn check_nodes_indent<'a>(
        &self,
        nodes: List<'a, Prop<'a>>,
        indent: i64,
        mut line: Line,
        (opening, cx): (Span, &Cx<'a, Self>),
    ) {
        let mut nested_indent = indent;
        for node in nodes {
            let node_indent = self.get_node_indent(node.span(), &mut line, cx.file());
            if line.is_using_operator
                && !line.current_operator
                && !self.ignore_ternary_operator
                && let Some(size) = self.indent.size()
            {
                nested_indent = nested_indent.saturating_add(size);
                line.is_using_operator = false;
            }
            if node_indent != nested_indent && is_node_first_in_line(cx.file(), node.span()) {
                self.report(node.span(), nested_indent, node_indent, (opening, cx));
            }
        }
    }

    /// `opening`: the opening element, which ESLint is at.
    fn report(&self, node: Span, needed: i64, gotten: i64, (opening, cx): (Span, &Cx<'_, Self>)) {
        let character = self.indent.character();
        let Some(count) = cx.repeat_count(needed as f64, opening) else {
            return;
        };
        cx.report(node, WRONG_INDENT)
            .data("needed", needed)
            .data("type", if character == b'\t' { "tab" } else { "space" })
            .data(
                "characters",
                if needed == 1 {
                    "character"
                } else {
                    "characters"
                },
            )
            .data("gotten", gotten)
            .fix(|fixer| {
                let indentation = Span::before(start_of_line(fixer.file(), node.start), node);
                Some(fixer.replace(indentation, fixer.repeat(character, count)?))
            });
    }
}
