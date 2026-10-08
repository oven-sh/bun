use bun_lint::prelude::*;

/// Enforce consistent spacing before and after semicolons.
pub struct SemiSpacing {
    requires_space_before: bool,
    requires_space_after: bool,
}

const UNEXPECTED_WHITESPACE_BEFORE: Message = Message::new(
    "unexpectedWhitespaceBefore",
    "Unexpected whitespace before semicolon.",
);
const UNEXPECTED_WHITESPACE_AFTER: Message = Message::new(
    "unexpectedWhitespaceAfter",
    "Unexpected whitespace after semicolon.",
);
const MISSING_WHITESPACE_BEFORE: Message = Message::new(
    "missingWhitespaceBefore",
    "Missing whitespace before semicolon.",
);
const MISSING_WHITESPACE_AFTER: Message = Message::new(
    "missingWhitespaceAfter",
    "Missing whitespace after semicolon.",
);

impl SemiSpacing {
    /// Whether the text next to the `;` at `at` tells that there is nothing to report, which it
    /// does for nearly all of them.
    fn is_obviously_fine(&self, text: &[u8], at: u32) -> bool {
        let before = (at as usize).checked_sub(1).and_then(|it| text.get(it));
        let is_fine_before = !self.requires_space_before
            && before.is_some_and(|b| b.is_ascii_graphic() && *b != b'/');
        let is_fine_after = match text.get(at as usize + 1) {
            None | Some(b'\n' | b'\r') => true,
            Some(b' ' | b'\t') => self.requires_space_after,
            Some(_) => false,
        };
        is_fine_before && is_fine_after
    }

    /// ESLint's `checkSemicolonSpacing`, for the `;` at `at`.
    fn check_semicolon_spacing(&self, at: u32, cx: &Cx<'_, Self>) {
        let file = cx.file();
        if self.is_obviously_fine(file.text(), at) {
            return;
        }
        let token = Span::new(at, at + 1);
        let before = file.token_before(token);
        let after = file.token_after(token);

        let leading_space = before.filter(|before| {
            ast_utils::is_token_on_same_line(file, before, token) && file.is_space_between(before, token)
        });
        match leading_space {
            Some(before) if !self.requires_space_before => {
                let space = before.span().between(token);
                cx.report(space, UNEXPECTED_WHITESPACE_BEFORE).fix(|fixer| fixer.remove(space));
            }
            None if self.requires_space_before => {
                cx.report(token, MISSING_WHITESPACE_BEFORE)
                    .fix(|fixer| fixer.insert_before(token, " "));
            }
            _ => {}
        }

        let is_first_in_line = !before.is_some_and(|before| ast_utils::is_token_on_same_line(file, token, before));
        let Some(after) = after.filter(|after| ast_utils::is_token_on_same_line(file, token, after)) else {
            return;
        };
        if is_first_in_line
            || ast_utils::is_closing_brace_token(&after)
            || ast_utils::is_closing_paren_token(&after)
        {
            return;
        }
        match file.is_space_between(token, after) {
            true if !self.requires_space_after => {
                let space = token.between(after.span());
                cx.report(space, UNEXPECTED_WHITESPACE_AFTER).fix(|fixer| fixer.remove(space));
            }
            false if self.requires_space_after => {
                cx.report(token, MISSING_WHITESPACE_AFTER)
                    .fix(|fixer| fixer.insert_after(token, " "));
            }
            _ => {}
        }
    }

    fn check_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(semicolon) = statement.semicolon() else {
            return;
        };
        // ESLint has an `ExportNamedDeclaration` or an `ExportDefaultDeclaration` around an exported
        // declaration, which ends with the same token.
        let is_declaration = matches!(
            statement.tag(),
            StmtTag::Var | StmtTag::Fn | StmtTag::TypeAlias | StmtTag::ImportEquals
        );
        if !is_declaration || statement.tag() == StmtTag::Var {
            self.check_semicolon_spacing(semicolon.start, cx);
        }
        if is_declaration && statement.is_exported() {
            self.check_semicolon_spacing(semicolon.start, cx);
        }
    }

    fn check_for<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::For { init, test, .. } = statement.kind() else {
            return;
        };
        let init_end = init.map(|init| match init.kind() {
            StmtKind::Expr(e) => e.span().end,
            _ => init.span().end,
        });
        for end in [init_end, test.map(|test| test.span().end)].into_iter().flatten() {
            let next = skip_trivia(cx.text(), end);
            if cx.text().get(next as usize) == Some(&b';') {
                self.check_semicolon_spacing(next, cx);
            }
        }
    }

    /// For ESLint's `PropertyDefinition`.
    fn check_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        if member.kind() != MemberKind::Property
            || member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
            || member.is_signature()
        {
            return;
        }
        let end = member.span().end;
        if end > 0 && cx.text().get(end as usize - 1) == Some(&b';') {
            self.check_semicolon_spacing(end - 1, cx);
        }
    }
}

impl Rule for SemiSpacing {
    const META: Meta = Meta::eslint("semi-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        SemiSpacing {
            requires_space_before: config.bool_or("before", false),
            requires_space_after: config.bool_or("after", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts(
            [
                StmtTag::Var,
                StmtTag::Expr,
                StmtTag::Break,
                StmtTag::Continue,
                StmtTag::Debugger,
                StmtTag::DoWhile,
                StmtTag::Return,
                StmtTag::Throw,
                StmtTag::Import,
                StmtTag::ExportNamed,
                StmtTag::ExportStar,
                StmtTag::ExportDefault,
                StmtTag::Fn,
                StmtTag::TypeAlias,
                StmtTag::ImportEquals,
            ],
            Self::check_statement,
        );
        on.stmts([StmtTag::For], Self::check_for);
        on.members(Self::check_member);
    }
}
