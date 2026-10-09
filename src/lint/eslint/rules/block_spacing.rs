use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow or enforce spaces inside of blocks after opening block and before closing block.
pub struct BlockSpacing {
    is_always: bool,
}

const MISSING: Message = Message::new("missing", "Requires a space {{location}} '{{token}}'.");
const EXTRA: Message = Message::new("extra", "Unexpected space(s) {{location}} '{{token}}'.");

impl BlockSpacing {
    /// `braces`: from the `{` to the `}`.
    fn check_spacing_inside_braces(&self, braces: Span, cx: &Cx<'_, Self>) {
        let whole = cx.slice(braces);
        let [b'{', inner @ .., b'}'] = whole else {
            return;
        };
        // What is next to a brace is whitespace, and then a token or a comment.
        let content = strings::trim_js_whitespace_start(inner);
        if content.is_empty() {
            return;
        }
        if !self.is_always && (content.starts_with(b"//") || content.starts_with(b"<!--")) {
            return;
        }
        let open = Span::new(braces.start, braces.start + 1);
        let close = Span::new(braces.end - 1, braces.end);
        let after_open = Span::after(open, open.end + (inner.len() - content.len()) as u32);
        let before_close = Span::before(open.end + strings::trim_js_whitespace_end(inner).len() as u32, close);

        if !self.is_valid(cx.slice(after_open)) {
            let report = match self.is_always {
                true => cx.report(open, MISSING),
                false => cx.report(after_open, EXTRA),
            };
            report.data("location", "after").data("token", "{").fix(|fixer| fixer.replace(after_open, self.spacing()));
        }
        if !self.is_valid(cx.slice(before_close)) {
            let report = match self.is_always {
                true => cx.report(close, MISSING),
                false => cx.report(before_close, EXTRA),
            };
            report.data("location", "before").data("token", "}").fix(|fixer| fixer.replace(before_close, self.spacing()));
        }
    }

    /// `between`: the whitespace between a brace and what is next to it.
    fn is_valid(&self, between: &[u8]) -> bool {
        strings::contains_js_line_break(between) || between.is_empty() != self.is_always
    }

    fn spacing(&self) -> &'static str {
        if self.is_always { " " } else { "" }
    }
}

impl Rule for BlockSpacing {
    const META: Meta = Meta::eslint("block-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        BlockSpacing {
            is_always: options.str(0) != Some("never"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Block, StmtTag::Switch], |rule, stmt, cx| match stmt.kind() {
            StmtKind::Block(_) => rule.check_spacing_inside_braces(stmt.span(), cx),
            StmtKind::Switch { expr, .. } => {
                let close_paren = skip_trivia(cx.text(), expr.outer_span().end);
                let open_brace = skip_trivia(cx.text(), close_paren + 1);
                rule.check_spacing_inside_braces(Span::new(open_brace, stmt.span().end), cx);
            }
            _ => {}
        });
        on.funcs(|rule, func, cx| {
            if let Some(body) = func.body_span() {
                rule.check_spacing_inside_braces(body, cx);
            }
        });
    }
}
