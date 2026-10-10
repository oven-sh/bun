use bun_core::strings;
use bun_lint::prelude::*;

/// Require or disallow padding within blocks.
pub struct PaddedBlocks {
    /// Whether padding is required. `None`: not checked.
    blocks: Option<bool>,
    switches: Option<bool>,
    classes: Option<bool>,
    allows_single_line_blocks: bool,
}

const ALWAYS_PAD_BLOCK: Message = Message::new("alwaysPadBlock", "Block must be padded by blank lines.");
const NEVER_PAD_BLOCK: Message = Message::new("neverPadBlock", "Block must not be padded by blank lines.");

impl PaddedBlocks {
    /// `braces`: from the `{` to the `}` of something that is not empty.
    fn check_padding<'a>(&self, braces: Span, requires_padding: bool, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let line_start = |offset: u32| file.line_span(file.line_of(offset)).start;

        // The comments that start on the line of the `{` belong to that line.
        let mut before_first = Span::new(braces.start, braces.start + 1);
        let mut first = None;
        for comment in file.comments_after(before_first) {
            if file.line_of(comment.start()) != file.line_of(before_first.end) {
                first = Some(comment.start());
                break;
            }
            before_first = comment.span();
        }
        let first = first.unwrap_or_else(|| skip_trivia(file.text(), before_first.end));

        // The same for those that end on the line of the `}`.
        let mut after_last = Span::new(braces.end.saturating_sub(1), braces.end);
        let mut last = None;
        for comment in file.comments_before(after_last).rev() {
            if file.line_of(comment.end()) != file.line_of(after_last.start) {
                last = Some(comment.end());
                break;
            }
            after_last = comment.span();
        }
        let last =
            last.unwrap_or_else(|| {
                strings::trim_js_whitespace_end(file.slice(Span::before(0, after_last))).len() as u32
            });

        let has_top_padding = file.line_of(first) - file.line_of(before_first.end) >= 2;
        let has_bottom_padding = file.line_of(after_last.start) - file.line_of(last) >= 2;

        if self.allows_single_line_blocks && file.line_of(before_first.end) == file.line_of(after_last.start) {
            return;
        }

        let top = Span::new(before_first.start, first);
        let bottom = Span::before(last, after_last);
        if requires_padding {
            if !has_top_padding {
                cx.report(top, ALWAYS_PAD_BLOCK).fix(|fixer| fixer.insert_after(before_first, "\n"));
            }
            if !has_bottom_padding {
                cx.report(bottom, ALWAYS_PAD_BLOCK).fix(|fixer| fixer.insert_before(after_last, "\n"));
            }
        } else {
            if has_top_padding {
                cx.report(top, NEVER_PAD_BLOCK)
                    .fix(|fixer| fixer.replace(Span::after(before_first, line_start(first)), "\n"));
            }
            if has_bottom_padding {
                cx.report(bottom, NEVER_PAD_BLOCK)
                    .fix(|fixer| fixer.replace(Span::new(last, line_start(after_last.start)), "\n"));
            }
        }
    }
}

impl Rule for PaddedBlocks {
    const META: Meta = Meta::eslint("padded-blocks", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new().stmts(&[StmtTag::Switch, StmtTag::Block]).funcs().classes();
    no_state!();

    fn new(options: &Options) -> Self {
        let kinds = options.object(0);
        let all = match options.get(0).is_some_and(|it| it.as_object().is_some()) {
            true => None,
            false => Some(options.str(0) != Some("never")),
        };
        let of = |kind: &str| all.or_else(|| kinds.has(kind).then(|| kinds.str(kind) == Some("always")));
        PaddedBlocks {
            blocks: of("blocks"),
            switches: of("switches"),
            classes: of("classes"),
            allows_single_line_blocks: options.object(1).bool_or("allowSingleLineBlocks", false),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.switches.is_some() {
            on = on.stmts(&[StmtTag::Switch]);
        }
        if self.blocks.is_some() {
            on = on.stmts(&[StmtTag::Block]).funcs();
        }
        if self.classes.is_some() {
            on = on.classes();
        }
        on
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::Switch => {
                if let StmtKind::Switch { expr, cases } = stmt.kind()
                    && !cases.is_empty()
                    && let Some(requires_padding) = self.switches
                {
                    let close_paren = skip_trivia(cx.text(), expr.outer_span().end);
                    let open_brace = skip_trivia(cx.text(), close_paren + 1);
                    self.check_padding(Span::new(open_brace, stmt.span().end), requires_padding, cx);
                }
            }
            StmtTag::Block => {
                if stmt.as_block().is_some_and(|body| !body.is_empty())
                    && let Some(requires_padding) = self.blocks
                {
                    self.check_padding(stmt.span(), requires_padding, cx);
                }
            }
            _ => {}
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.body_statements().is_some_and(|body| !body.is_empty())
            && let Some(braces) = func.body_span()
            && let Some(requires_padding) = self.blocks
        {
            self.check_padding(braces, requires_padding, cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if !class.members().is_empty()
            && let Some(requires_padding) = self.classes
        {
            self.check_padding(class.body_span(), requires_padding, cx);
        }
    }
}
