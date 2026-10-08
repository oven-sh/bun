use bun_lint::prelude::*;

/// Enforce consistent spacing before blocks.
pub struct SpaceBeforeBlocks {
    functions: Spacing,
    keywords: Spacing,
    classes: Spacing,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Spacing {
    Always,
    Never,
    Off,
}

impl Spacing {
    fn of(value: Option<&str>) -> Spacing {
        match value {
            Some("always") => Spacing::Always,
            Some("never") => Spacing::Never,
            _ => Spacing::Off,
        }
    }
}

const UNEXPECTED_SPACE: Message =
    Message::new("unexpectedSpace", "Unexpected space before opening brace.");
const MISSING_SPACE: Message = Message::new("missingSpace", "Missing space before opening brace.");

/// What has the `{`.
#[derive(Copy, Clone)]
enum Block<'a> {
    FunctionBody,
    ClassBody,
    Statement(Stmt<'a>),
    /// The `{` of a `switch`.
    CaseBlock,
}

/// ESLint's `isConflicted`: another rule checks the space between `preceding` and the block.
fn is_conflicted<'a>(preceding: Token<'a>, block: Block<'a>) -> bool {
    if ast_utils::is_arrow_token(&preceding) {
        return true;
    }
    if ast_utils::is_keyword_token(&preceding) {
        return !matches!(block, Block::FunctionBody);
    }
    ast_utils::is_colon_token(&preceding)
        && matches!(
            block,
            Block::Statement(statement) if matches!(
                statement.parent(),
                Node::Case(case) if ast_utils::get_switch_case_colon_token(case) == Some(preceding)
            )
        )
}

/// ESLint's `checkPrecedingSpace`. `span`: what is reported, which starts with the `{`.
fn check<'a>(spacing: Spacing, span: Span, block: Block<'a>, cx: &Cx<'a, SpaceBeforeBlocks>) {
    let Some(&before) = span.start.checked_sub(1).and_then(|at| cx.text().get(at as usize)) else {
        return;
    };
    // The byte before the `{` tells in all but a few cases that there is nothing to report.
    let is_fine = match spacing {
        Spacing::Always => matches!(before, b' ' | b'\t' | b'\n' | b'\r'),
        // After a comment there can be a space before the comment.
        Spacing::Never => before.is_ascii_graphic() && before != b'/',
        Spacing::Off => true,
    };
    if is_fine {
        return;
    }
    let file = cx.file();
    let Some(preceding) = file.token_before(span) else {
        return;
    };
    if is_conflicted(preceding, block) || !ast_utils::is_token_on_same_line(file, preceding, span) {
        return;
    }
    let has_space = file.is_space_between(preceding, span);
    if spacing == Spacing::Always && !has_space {
        cx.report(span, MISSING_SPACE).fix(|fixer| fixer.insert_before(span, " "));
    } else if spacing == Spacing::Never && has_space {
        cx.report(span, UNEXPECTED_SPACE)
            .fix(|fixer| fixer.remove(Span::new(preceding.end(), span.start)));
    }
}

impl Rule for SpaceBeforeBlocks {
    const META: Meta = Meta::eslint("space-before-blocks", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        if options.get(0).is_some_and(|it| it.as_object().is_some()) {
            let config = options.object(0);
            return SpaceBeforeBlocks {
                functions: Spacing::of(config.str("functions")),
                keywords: Spacing::of(config.str("keywords")),
                classes: Spacing::of(config.str("classes")),
            };
        }
        let all = match options.str(0) {
            Some("never") => Spacing::Never,
            _ => Spacing::Always,
        };
        SpaceBeforeBlocks {
            functions: all,
            keywords: all,
            classes: all,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.functions != Spacing::Off {
            on.funcs(|rule, func, cx| {
                // What is before the body of an arrow function is its `=>`, which conflicts. A
                // static block is not a `BlockStatement`.
                if !func.is_arrow()
                    && func.kind() != FnKind::StaticBlock
                    && let Some(body) = func.body_span()
                {
                    check(rule.functions, body, Block::FunctionBody, cx);
                }
            });
        }
        if self.classes != Spacing::Off {
            on.classes(|rule, class, cx| {
                check(rule.classes, class.body_span(), Block::ClassBody, cx);
            });
        }
        if self.keywords != Spacing::Off {
            on.stmts([StmtTag::Block, StmtTag::Switch], |rule, statement, cx| {
                match statement.kind() {
                    StmtKind::Block(_) => {
                        check(rule.keywords, statement.span(), Block::Statement(statement), cx);
                    }
                    StmtKind::Switch { expr, .. } => {
                        let close_paren = skip_trivia(cx.text(), expr.outer_span().end);
                        let brace = skip_trivia(cx.text(), close_paren + 1);
                        check(rule.keywords, Span::new(brace, brace + 1), Block::CaseBlock, cx);
                    }
                    _ => {}
                }
            });
        }
    }
}
