use bun_lint::prelude::*;

/// Disallow inline comments after code.
pub struct NoInlineComments {
    ignore_pattern: Option<Regex>,
}

const UNEXPECTED_INLINE_COMMENT: Message =
    Message::new("unexpectedInlineComment", "Unexpected comment inline with code.");

/// Whether the innermost node at `offset` is what ESLint has between the braces of an empty `{}` in
/// JSX, a `JSXEmptyExpression`.
// TODO(api): replace by utils::estree_types_at
fn is_in_jsx_empty_expression<'a>(file: &'a File<'a>, offset: u32) -> bool {
    let is_around = |e: Expr<'a>| {
        e.is_missing() && e.jsx_container_span().is_some_and(|braces| braces.shrink(1, 1).contains_offset(offset))
    };
    match utils::get_node_by_range_index(file, offset) {
        Node::Expr(e) => match e.kind() {
            // What is in the braces around `offset` starts after it or not: it is the first child that does, or the
            // one before that.
            ExprKind::Jsx(jsx) => {
                let children = jsx.children();
                let after = children.after(offset);
                let before = match after {
                    Some(after) => children.before(after.span().start),
                    None => children.last(),
                };
                before.into_iter().chain(after).any(is_around)
            }
            _ => false,
        },
        Node::Prop(attribute) => attribute.value().is_some_and(is_around),
        _ => false,
    }
}

impl NoInlineComments {
    fn test_code_around_comment<'a>(&self, comment: Token<'a>, cx: &mut Cx<'a, Self>) {
        let start_line = cx.line_span(cx.line_of(comment.start()));
        let end_line = cx.line_span(cx.line_of(comment.end()));
        let preamble = text::trim(cx.slice(Span::new(start_line.start, comment.start())));
        let postamble = text::trim(cx.slice(Span::new(comment.end(), end_line.end)));
        if preamble.is_empty() && postamble.is_empty() {
            return;
        }
        if self.ignore_pattern.as_ref().is_some_and(|pattern| pattern.test(comment.comment_value())) {
            return;
        }
        if (preamble.is_empty() || preamble == b"{")
            && (postamble.is_empty() || postamble == b"}")
            && is_in_jsx_empty_expression(cx.file(), comment.start())
        {
            return;
        }
        if ast_utils::is_directive_comment(&comment) {
            return;
        }
        cx.report(comment, UNEXPECTED_INLINE_COMMENT);
    }
}

impl Rule for NoInlineComments {
    const META: Meta = Meta::eslint("no-inline-comments", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoInlineComments {
            ignore_pattern: match object.str("ignorePattern") {
                Some("") => None,
                _ => object.regex("ignorePattern", "u"),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            for comment in cx.file().comments() {
                if comment.kind() != TokenKind::Shebang {
                    rule.test_code_around_comment(comment, cx);
                }
            }
        });
    }
}
