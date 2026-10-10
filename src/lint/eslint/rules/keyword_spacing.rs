use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::token_len;
use bun_lint::utils::{ast_utils, keywords};

/// Enforce consistent spacing before and after keywords.
pub struct KeywordSpacing {
    default: Spacing,
    overrides: Vec<(Box<[u8]>, Spacing)>,
}

/// Whether space is required, or else forbidden.
#[derive(Copy, Clone)]
struct Spacing {
    before: bool,
    after: bool,
}

const EXPECTED_BEFORE: Message =
    Message::new("expectedBefore", "Expected space(s) before \"{{value}}\".");
const EXPECTED_AFTER: Message =
    Message::new("expectedAfter", "Expected space(s) after \"{{value}}\".");
const UNEXPECTED_BEFORE: Message =
    Message::new("unexpectedBefore", "Unexpected space(s) before \"{{value}}\".");
const UNEXPECTED_AFTER: Message =
    Message::new("unexpectedAfter", "Unexpected space(s) after \"{{value}}\".");

/// The punctuators next to a keyword that this rule is responsible for the space at.
#[derive(Copy, Clone, PartialEq)]
enum Pattern {
    /// ESLint's `PREV_TOKEN` and `NEXT_TOKEN`
    Default,
    /// ESLint's `PREV_TOKEN_M` and `NEXT_TOKEN_M`, in imports and exports
    Module,
}

impl Pattern {
    fn matches_previous(self, value: &[u8]) -> bool {
        match value {
            b")" | b"]" | b"}" | b">" => true,
            b"*" => self == Pattern::Module,
            _ => false,
        }
    }

    fn matches_next(self, value: &[u8]) -> bool {
        match self {
            Pattern::Default => matches!(
                value,
                b"(" | b"[" | b"{" | b"<" | b"~" | b"!" | b"+" | b"++" | b"-" | b"--"
            ),
            Pattern::Module => matches!(value, b"{" | b"*"),
        }
    }
}

/// A token to check the space around.
#[derive(Copy, Clone)]
struct Keyword<'a> {
    span: Span,
    pattern: Pattern,
    /// It is checked only if the type of the token is `Keyword`.
    must_be_keyword: bool,
    /// The space between a private identifier and it is left alone.
    ignores_private_identifier: bool,
    /// The expression that it is the first token of.
    expr: Option<Expr<'a>>,
}

impl<'a> Keyword<'a> {
    fn new(span: Span) -> Self {
        Keyword {
            span,
            pattern: Pattern::Default,
            must_be_keyword: false,
            ignores_private_identifier: false,
            expr: None,
        }
    }

    fn in_module_declaration(span: Span) -> Self {
        Keyword {
            pattern: Pattern::Module,
            ..Keyword::new(span)
        }
    }

    fn if_keyword(span: Span) -> Self {
        Keyword {
            must_be_keyword: true,
            ..Keyword::new(span)
        }
    }
}

/// ESLint's `KEYS`
fn is_key(value: &[u8]) -> bool {
    keywords::is_keyword(value)
        || matches!(
            value,
            b"as" | b"async" | b"await" | b"from" | b"get" | b"let" | b"of" | b"set" | b"yield"
        )
}

/// The token that starts at `start`.
fn token_from(text: &[u8], start: u32) -> Span {
    let len = token_len(text.get(start as usize..).unwrap_or_default());
    Span::new(start, start + len as u32)
}

/// `word`, if it is written at `start`.
fn word_at(text: &[u8], start: u32, word: &str) -> Option<Span> {
    let span = Span::new(start, start + word.len() as u32);
    (text.get(span.range()) == Some(word.as_bytes())).then_some(span)
}

/// `word`, if it is the last token before `at`, not counting the punctuators in `skipped`.
fn word_before(text: &[u8], mut at: u32, word: &str, skipped: &[u8]) -> Option<Span> {
    loop {
        let end = skip_trivia_back(text, at);
        let last = *text.get(end.checked_sub(1)? as usize)?;
        if !strings::contains_char(skipped, last) {
            return word_at(text, end.checked_sub(word.len() as u32)?, word);
        }
        at = end - 1;
    }
}

#[inline]
fn is_blank(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r')
}

/// Whether the token before `e` is the operator of `a > e`, which is left to `space-infix-ops`.
fn is_right_of_greater_than(e: Expr) -> bool {
    let mut at = e;
    loop {
        let Node::Expr(parent) = at.parent() else {
            return false;
        };
        if at.is_parenthesized() {
            return false;
        }
        if matches!(parent.kind(), ExprKind::Binary { op: BinOp::Gt, right, .. } if right == at) {
            return true;
        }
        if parent.span().start != at.span().start {
            return false;
        }
        at = parent;
    }
}

impl KeywordSpacing {
    fn spacing(&self, value: &[u8]) -> Spacing {
        let mut overrides = self.overrides.iter();
        overrides.find(|it| *it.0 == *value).map_or(self.default, |it| it.1)
    }

    fn check_spacing_before<'a>(&self, keyword: Keyword<'a>, cx: &Cx<'a, Self>) {
        let (text, start) = (cx.text(), keyword.span.start);
        let expects_space = self.spacing(cx.slice(keyword.span)).before;
        let Some(&adjacent) = start.checked_sub(1).and_then(|at| text.get(at as usize)) else {
            return;
        };
        if expects_space && is_blank(adjacent) {
            return;
        }
        let previous_end = match adjacent {
            b'/' | 0x80..=0xFF => skip_trivia_back(text, start),
            _ if is_blank(adjacent) => skip_trivia_back(text, start),
            _ => start,
        };
        if !expects_space && previous_end == start {
            return;
        }
        // Whether a token that is checked can end like the previous one.
        match previous_end.checked_sub(1).and_then(|at| text.get(at as usize)) {
            Some(b')' | b']' | b'}' | b'>' | b'"' | b'\'' | b'`' | b'/' | b'$' | b'_' | 0x80..=0xFF) => {}
            Some(b'*') if keyword.pattern == Pattern::Module => {}
            Some(last) if last.is_ascii_alphanumeric() => {}
            _ => return,
        }

        let file = cx.file();
        let Some(token) = file.token_at(start) else {
            return;
        };
        if !is_key(token.text()) || keyword.must_be_keyword && token.kind() != TokenKind::Keyword {
            return;
        }
        let Some(previous) = file.tokens_before(token).next() else {
            return;
        };
        let is_checked = match previous.kind() {
            TokenKind::RegularExpression | TokenKind::String => true,
            TokenKind::PrivateIdentifier => !keyword.ignores_private_identifier,
            TokenKind::Template => !previous.text().ends_with(b"${"),
            _ => keyword.pattern.matches_previous(previous.text()),
        };
        if !is_checked
            || previous.is_punctuator(">") && keyword.expr.is_some_and(is_right_of_greater_than)
            || !ast_utils::is_token_on_same_line(file, previous, token)
            || file.is_space_between(previous, token) == expects_space
        {
            return;
        }
        if expects_space {
            cx.report(token, EXPECTED_BEFORE)
                .data("value", token.text())
                .fix(|fixer| fixer.insert_before(token, " "));
        } else {
            let space = previous.span().between(token.span());
            cx.report(space, UNEXPECTED_BEFORE)
                .data("value", token.text())
                .fix(|fixer| fixer.remove(space));
        }
    }

    fn check_spacing_after<'a>(&self, keyword: Keyword<'a>, cx: &Cx<'a, Self>) {
        let (text, end) = (cx.text(), keyword.span.end);
        let expects_space = self.spacing(cx.slice(keyword.span)).after;
        let Some(&adjacent) = text.get(end as usize) else {
            return;
        };
        if expects_space && is_blank(adjacent) {
            return;
        }
        let next_start = match adjacent {
            b'/' | 0x80..=0xFF => skip_trivia(text, end),
            _ if is_blank(adjacent) => skip_trivia(text, end),
            _ => end,
        };
        if !expects_space && next_start == end {
            return;
        }
        // Whether a token that is checked can start like the next one.
        match text.get(next_start as usize) {
            Some(b'{' | b'"' | b'\'' | b'`' | b'/' | b'#') => {}
            Some(b'*') if keyword.pattern == Pattern::Module => {}
            Some(b'(' | b'[' | b'<' | b'~' | b'!' | b'+' | b'-')
                if keyword.pattern == Pattern::Default => {}
            _ => return,
        }

        let file = cx.file();
        let Some(token) = file.token_at(keyword.span.start) else {
            return;
        };
        if !is_key(token.text()) || keyword.must_be_keyword && token.kind() != TokenKind::Keyword {
            return;
        }
        let Some(next) = file.tokens_after(token).next() else {
            return;
        };
        let is_checked = match next.kind() {
            TokenKind::RegularExpression | TokenKind::String | TokenKind::PrivateIdentifier => true,
            TokenKind::Template => !next.text().starts_with(b"}"),
            _ => keyword.pattern.matches_next(next.text()),
        };
        if !is_checked
            || !ast_utils::is_token_on_same_line(file, token, next)
            || file.is_space_between(token, next) == expects_space
        {
            return;
        }
        if expects_space {
            cx.report(token, EXPECTED_AFTER)
                .data("value", token.text())
                .fix(|fixer| fixer.insert_after(token, " "));
        } else {
            let space = token.span().between(next.span());
            cx.report(space, UNEXPECTED_AFTER)
                .data("value", token.text())
                .fix(|fixer| fixer.remove(space));
        }
    }

    fn check_spacing_around<'a>(&self, keyword: Keyword<'a>, cx: &Cx<'a, Self>) {
        self.check_spacing_before(keyword, cx);
        self.check_spacing_after(keyword, cx);
    }

    fn check_spacing_around_word(&self, word: Option<Span>, cx: &Cx<'_, Self>) {
        if let Some(word) = word {
            self.check_spacing_around(Keyword::new(word), cx);
        }
    }

    fn check_spacing_around_module_word(&self, word: Option<Span>, cx: &Cx<'_, Self>) {
        if let Some(word) = word {
            self.check_spacing_around(Keyword::in_module_declaration(word), cx);
        }
    }

    /// The `in` or the `of` before `right`.
    fn check_spacing_for_loop_operator<'a>(&self, right: Expr<'a>, word: &str, cx: &Cx<'a, Self>) {
        if let Some(operator) = word_before(cx.text(), right.outer_span().start, word, b"(") {
            self.check_spacing_around(
                Keyword {
                    ignores_private_identifier: true,
                    ..Keyword::new(operator)
                },
                cx,
            );
        }
    }

    /// `start`: where the `import` or the `export` is.
    fn check_spacing_for_module_declaration<'a>(&self, stmt: Stmt<'a>, start: u32, cx: &Cx<'a, Self>) {
        let text = cx.text();
        let first = token_from(text, start);
        self.check_spacing_around(Keyword::in_module_declaration(first), cx);
        let kind = stmt.kind();
        if matches!(kind, StmtKind::ExportDefault(_)) || stmt.is_default_export() {
            self.check_spacing_around_word(word_at(text, skip_trivia(text, first.end), "default"), cx);
        }
        if let StmtKind::ExportStar { alias: Some(alias), .. } = kind {
            self.check_spacing_around_module_word(word_before(text, alias.span().start, "as", b""), cx);
        }
        if let StmtKind::Import(import) = kind
            && let Some(namespace) = import.namespace_span()
            && let Some(word) = word_at(text, skip_trivia(text, namespace.start + 1), "as")
        {
            self.check_spacing_before(Keyword::in_module_declaration(word), cx);
        }
        if let Some(source) = stmt.module_specifier_span()
            && !matches!(kind, StmtKind::ImportEquals(_))
        {
            // `import "a"` has no `from`.
            let word = word_before(text, source.start, "from", b"")
                .or_else(|| word_before(text, source.start, "import", b""));
            self.check_spacing_around_module_word(word, cx);
        }
    }

    /// The `get`, `set` or `async` before the name of a method.
    fn check_spacing_for_method<'a>(&self, key: Option<Key<'a>>, word: &str, cx: &Cx<'a, Self>) {
        if let Some(key) = key {
            let word = word_before(cx.text(), key.span(cx.file()).start, word, b"*[");
            self.check_spacing_around_word(word, cx);
        }
    }
}

impl Rule for KeywordSpacing {
    const META: Meta = Meta::eslint("keyword-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new()
        .stmts(&[
            StmtTag::Debugger,
            // A `with` statement
            StmtTag::Block,
            StmtTag::Break,
            StmtTag::Continue,
            StmtTag::Return,
            StmtTag::Throw,
            StmtTag::Try,
            StmtTag::If,
            StmtTag::Switch,
            StmtTag::DoWhile,
            StmtTag::ForIn,
            StmtTag::ForOf,
            StmtTag::For,
            StmtTag::While,
            StmtTag::Var,
            StmtTag::Import,
            StmtTag::ExportNamed,
            StmtTag::ExportStar,
            StmtTag::ExportDefault,
            // For the `export` before them
            StmtTag::Fn,
            StmtTag::Class,
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::ImportEquals,
        ])
        .cases()
        .funcs()
        .classes()
        .exprs(&[
            ExprTag::Await,
            ExprTag::New,
            ExprTag::Super,
            ExprTag::This,
            ExprTag::Unary,
            ExprTag::Yield,
        ])
        .import_specs()
        .export_specs()
        .members()
        .props();
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let default = Spacing {
            before: options.bool_or("before", true),
            after: options.bool_or("after", true),
        };
        let overrides = options.object("overrides").entries().iter().map(|(key, value)| {
            let value = Object::of(Some(value));
            let spacing = Spacing {
                before: value.bool_or("before", default.before),
                after: value.bool_or("after", default.after),
            };
            (key.as_slice().into(), spacing)
        });
        KeywordSpacing {
            default,
            overrides: overrides.collect(),
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (text, start) = (cx.text(), stmt.span().start);
        let first = |word: &str| Some(Span::new(start, start + word.len() as u32));
        match stmt.kind() {
            StmtKind::Debugger => self.check_spacing_around_word(first("debugger"), cx),
            StmtKind::Block(_) => {}
            StmtKind::With { .. } => self.check_spacing_around_word(first("with"), cx),
            StmtKind::Break(_) => self.check_spacing_around_word(first("break"), cx),
            StmtKind::Continue(_) => self.check_spacing_around_word(first("continue"), cx),
            StmtKind::Return(_) => self.check_spacing_around_word(first("return"), cx),
            StmtKind::Throw(_) => self.check_spacing_around_word(first("throw"), cx),
            StmtKind::Switch { .. } => self.check_spacing_around_word(first("switch"), cx),
            StmtKind::For { .. } => self.check_spacing_around_word(first("for"), cx),
            StmtKind::While { .. } => self.check_spacing_around_word(first("while"), cx),
            StmtKind::Try { finalizer, .. } => {
                self.check_spacing_around_word(first("try"), cx);
                let handler = stmt.catch_clause_span();
                self.check_spacing_around_word(handler.and_then(|it| word_at(text, it.start, "catch")), cx);
                let finalizer = finalizer.and_then(|it| word_before(text, it.span().start, "finally", b""));
                self.check_spacing_around_word(finalizer, cx);
            }
            StmtKind::If { no, .. } => {
                self.check_spacing_around_word(first("if"), cx);
                let alternate = no.and_then(|it| word_before(text, it.span().start, "else", b""));
                self.check_spacing_around_word(alternate, cx);
            }
            StmtKind::DoWhile { body, .. } => {
                self.check_spacing_around_word(first("do"), cx);
                let test = word_at(text, skip_trivia(text, body.span().end), "while");
                self.check_spacing_around_word(test, cx);
            }
            StmtKind::ForIn { expr, .. } => {
                self.check_spacing_around_word(first("for"), cx);
                self.check_spacing_for_loop_operator(expr, "in", cx);
            }
            StmtKind::ForOf { expr, is_await, .. } => {
                let keyword = Keyword::new(Span::new(start, start + 3));
                self.check_spacing_before(keyword, cx);
                match is_await {
                    true => {
                        if let Some(word) = word_at(text, skip_trivia(text, start + 3), "await") {
                            self.check_spacing_after(Keyword::new(word), cx);
                        }
                    }
                    false => self.check_spacing_after(keyword, cx),
                }
                self.check_spacing_for_loop_operator(expr, "of", cx);
            }
            StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_) => self.check_spacing_for_module_declaration(stmt, start, cx),
            kind => {
                if let Some(export) = stmt.export_span() {
                    self.check_spacing_for_module_declaration(stmt, export.start, cx);
                }
                if matches!(kind, StmtKind::Var(_)) {
                    let first = token_from(text, stmt.span_without_export().start);
                    self.check_spacing_around(Keyword::if_keyword(first), cx);
                }
            }
        }
    }

    fn case<'a>(&self, case: Case<'a>, cx: &mut Cx<'a, Self>) {
        let start = case.span().start;
        let len = if case.is_default() { "default".len() } else { "case".len() };
        self.check_spacing_around(Keyword::new(Span::new(start, start + len as u32)), cx);
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(func.kind(), FnKind::Decl | FnKind::Expr | FnKind::Arrow) || !func.has_body() {
            return;
        }
        let (text, start) = (cx.text(), func.estree_span().start);
        if !matches!(text.get(start as usize), Some(b'a' | b'f')) {
            return;
        }
        let first = token_from(text, start);
        if matches!(cx.slice(first), b"function" | b"async") {
            let keyword = Keyword {
                expr: func.owner().as_expr(),
                ..Keyword::new(first)
            };
            self.check_spacing_before(keyword, cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let keyword = class.keyword_span();
        // Not after a decorator, `abstract` or `declare`.
        if keyword.start == class.estree_span().start {
            let keyword = Keyword {
                expr: class.owner().as_expr(),
                ..Keyword::new(keyword)
            };
            self.check_spacing_around(keyword, cx);
        }
        if let Some(super_class) = class.extends() {
            let word = word_before(cx.text(), super_class.outer_span().start, "extends", b"(");
            self.check_spacing_around_word(word, cx);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (word, must_be_keyword) = match e.kind() {
            ExprKind::Await(_) => ("await", false),
            ExprKind::New(_) => ("new", false),
            ExprKind::Super => ("super", false),
            ExprKind::This => ("this", false),
            ExprKind::Unary {
                op: op @ (UnOp::Typeof | UnOp::Void | UnOp::Delete),
                ..
            } => (un_op_text(op), false),
            ExprKind::Yield { .. } => ("yield", true),
            _ => return,
        };
        let start = e.span().start;
        let keyword = Keyword {
            must_be_keyword,
            expr: Some(e),
            ..Keyword::new(Span::new(start, start + word.len() as u32))
        };
        self.check_spacing_before(keyword, cx);
    }

    fn import_spec<'a>(&self, spec: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if spec.is_renamed()
            && let Some(word) = word_before(cx.text(), spec.local().span().start, "as", b"")
        {
            self.check_spacing_before(Keyword::in_module_declaration(word), cx);
        }
    }

    fn export_spec<'a>(&self, spec: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if spec.is_renamed() {
            let word = word_before(cx.text(), spec.exported().span().start, "as", b"");
            self.check_spacing_around_module_word(word, cx);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let kind = member.kind();
        let word = match kind {
            MemberKind::Getter => Some("get"),
            MemberKind::Setter => Some("set"),
            MemberKind::Method if member.func().is_some_and(Func::is_async) => Some("async"),
            MemberKind::Property | MemberKind::Method | MemberKind::StaticBlock => None,
            _ => return,
        };
        let starts_with_static = kind == MemberKind::StaticBlock || member.is_static();
        // Only a `MethodDefinition`, a `PropertyDefinition` or a `StaticBlock`.
        if word.is_none() && !starts_with_static
            || member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
            || member.is_signature()
        {
            return;
        }
        if starts_with_static {
            let first = token_from(cx.text(), member.span().start);
            self.check_spacing_around(Keyword::if_keyword(first), cx);
        }
        if let Some(word) = word {
            self.check_spacing_for_method(member.key(), word, cx);
        }
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let word = match prop.kind() {
            PropKind::Getter => "get",
            PropKind::Setter => "set",
            PropKind::Method if prop.func().is_some_and(Func::is_async) => "async",
            _ => return,
        };
        self.check_spacing_for_method(prop.key(), word, cx);
    }
}
