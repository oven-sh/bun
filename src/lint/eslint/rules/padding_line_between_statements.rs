use bun_lint::prelude::*;
use bun_lint::tokens::token_len;

/// Require or disallow padding lines between statements.
pub struct PaddingLineBetweenStatements {
    configure_list: Vec<Configure>,
}

const UNEXPECTED_BLANK_LINE: Message = Message::new(
    "unexpectedBlankLine",
    "Unexpected blank line before this statement.",
);
const EXPECTED_BLANK_LINE: Message = Message::new(
    "expectedBlankLine",
    "Expected blank line before this statement.",
);

/// ESLint's `PaddingTypes`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum PaddingType {
    Any,
    Never,
    Always,
}

/// ESLint's `StatementTypes`.
#[derive(Copy, Clone)]
enum StatementType {
    Any,
    BlockLike,
    CjsExport,
    CjsImport,
    Directive,
    Expression,
    Iife,
    MultilineBlockLike,
    MultilineExpression,
    MultilineKeyword(&'static str),
    SinglelineKeyword(&'static str),
    Block,
    Empty,
    Function,
    Keyword(&'static str),
}

struct Configure {
    blank_line: PaddingType,
    prev: Vec<StatementType>,
    next: Vec<StatementType>,
}

/// The types that are ESLint's `newKeywordTester` of their name.
const KEYWORDS: &[&str] = &[
    "break", "case", "class", "const", "continue", "debugger", "default", "do", "export", "for", "if",
    "import", "let", "return", "switch", "throw", "try", "var", "while", "with",
];

/// The range of ESLint's node for `node`, which is a statement or a `case`.
fn span_of(node: Node) -> Span {
    match node {
        Node::Stmt(statement) => statement.export_span().unwrap_or_else(|| statement.span()),
        _ => node.span(),
    }
}

fn is_multiline(node: Node) -> bool {
    let (file, span) = (node.file(), span_of(node));
    file.line_of(span.start) != file.line_of(span.end)
}

/// `sourceCode.getFirstToken(node).value === keyword`
fn starts_with_keyword(node: Node, keyword: &str) -> bool {
    let rest = node.file().text().get(span_of(node).start as usize..).unwrap_or_default();
    rest.starts_with(keyword.as_bytes()) && token_len(rest) == keyword.len()
}

/// The expression, if `node` is an `ExpressionStatement`.
fn expression_of(node: Node<'_>) -> Option<Expr<'_>> {
    match node.as_stmt()?.kind() {
        StmtKind::Expr(e) => Some(e),
        _ => None,
    }
}

fn is_directive(node: Node) -> bool {
    node.as_stmt().is_some_and(ast_utils::is_directive)
}

/// ESLint's `isIIFEStatement`.
fn is_iife_statement(node: Node) -> bool {
    let Some(mut call) = expression_of(node) else {
        return false;
    };
    if let ExprKind::Unary { op, operand } = call.kind()
        && !matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec)
    {
        call = operand;
    }
    matches!(call.kind(), ExprKind::Call(call) if ast_utils::is_function(call.callee()))
}

/// ESLint's `getNodeByRangeIndex(offset)`, for an offset inside `node`.
fn innermost_node_at(node: Node<'_>, offset: u32) -> Node<'_> {
    let mut at = node;
    loop {
        let mut inner = None;
        at.for_each_child(|child| {
            if child.span().contains_offset(offset) {
                inner = Some(child);
            }
        });
        match inner {
            Some(child) => at = child,
            None => return at,
        }
    }
}

/// ESLint's `isBlockLikeStatement`.
fn is_block_like_statement(node: Node) -> bool {
    if let Node::Stmt(statement) = node
        && let StmtKind::DoWhile { body, .. } = statement.kind()
        && matches!(body.kind(), StmtKind::Block(_))
    {
        return true;
    }
    if is_iife_statement(node) {
        return true;
    }
    let Some(last_token) = node.file().tokens_in(span_of(node)).rfind(ast_utils::is_not_semicolon_token) else {
        return false;
    };
    if !ast_utils::is_closing_brace_token(&last_token) {
        return false;
    }
    match innermost_node_at(node, last_token.start()) {
        Node::Stmt(statement) => matches!(statement.kind(), StmtKind::Block(_) | StmtKind::Switch { .. }),
        // The body of a function is a `BlockStatement`.
        Node::Func(func) => {
            func.kind() != FnKind::StaticBlock
                && func.body_span().is_some_and(|body| body.end == last_token.end())
        }
        _ => false,
    }
}

/// `/^(?:module\s*\.\s*)?exports(?:\s*\.|\s*\[|$)/u`
fn is_cjs_export(source: &[u8]) -> bool {
    let after_module = (source.strip_prefix(b"module"))
        .and_then(|rest| text::trim_start(rest).strip_prefix(b"."))
        .map(text::trim_start);
    let Some(rest) = after_module.unwrap_or(source).strip_prefix(b"exports") else {
        return false;
    };
    rest.is_empty() || matches!(text::trim_start(rest).first(), Some(b'.' | b'['))
}

impl StatementType {
    fn of(name: &str) -> Option<StatementType> {
        Some(match name {
            "*" => StatementType::Any,
            "block-like" => StatementType::BlockLike,
            "cjs-export" => StatementType::CjsExport,
            "cjs-import" => StatementType::CjsImport,
            "directive" => StatementType::Directive,
            "expression" => StatementType::Expression,
            "iife" => StatementType::Iife,
            "multiline-block-like" => StatementType::MultilineBlockLike,
            "multiline-expression" => StatementType::MultilineExpression,
            "multiline-const" => StatementType::MultilineKeyword("const"),
            "multiline-let" => StatementType::MultilineKeyword("let"),
            "multiline-var" => StatementType::MultilineKeyword("var"),
            "singleline-const" => StatementType::SinglelineKeyword("const"),
            "singleline-let" => StatementType::SinglelineKeyword("let"),
            "singleline-var" => StatementType::SinglelineKeyword("var"),
            "block" => StatementType::Block,
            "empty" => StatementType::Empty,
            "function" => StatementType::Function,
            _ => StatementType::Keyword(*KEYWORDS.iter().find(|it| **it == name)?),
        })
    }

    /// An exported declaration is an `ExportNamedDeclaration` or an `ExportDefaultDeclaration`, and
    /// of no other type.
    fn test(self, node: Node) -> bool {
        match self {
            StatementType::Any => true,
            StatementType::BlockLike => is_block_like_statement(node),
            StatementType::CjsExport => matches!(
                expression_of(node).map(Expr::kind),
                Some(ExprKind::Assign { target, .. }) if is_cjs_export(target.text())
            ),
            StatementType::CjsImport => match node.as_stmt().map(|it| (it.kind(), it)) {
                Some((StmtKind::Var(declarations), statement)) => {
                    let init = declarations.first().and_then(VarDecl::init);
                    init.is_some_and(|init| init.text().starts_with(b"require(")) && !statement.is_exported()
                }
                _ => false,
            },
            StatementType::Directive => is_directive(node),
            StatementType::Expression => expression_of(node).is_some() && !is_directive(node),
            StatementType::Iife => is_iife_statement(node),
            StatementType::MultilineBlockLike => is_multiline(node) && is_block_like_statement(node),
            StatementType::MultilineExpression => {
                expression_of(node).is_some() && is_multiline(node) && !is_directive(node)
            }
            StatementType::MultilineKeyword(keyword) => {
                starts_with_keyword(node, keyword) && is_multiline(node)
            }
            StatementType::SinglelineKeyword(keyword) => {
                starts_with_keyword(node, keyword) && !is_multiline(node)
            }
            StatementType::Block => {
                node.as_stmt().is_some_and(|it| matches!(it.kind(), StmtKind::Block(_)))
            }
            StatementType::Empty => node.as_stmt().is_some_and(|it| it.tag() == StmtTag::Empty),
            StatementType::Function => node.as_stmt().is_some_and(|it| {
                matches!(it.kind(), StmtKind::Fn(func) if func.has_body()) && !it.is_exported()
            }),
            StatementType::Keyword(keyword) => starts_with_keyword(node, keyword),
        }
    }
}

/// ESLint's `match`.
fn is_match(node: Node, types: &[StatementType]) -> bool {
    let mut inner = node;
    while let Node::Stmt(statement) = inner
        && let StmtKind::Labeled { body, .. } = statement.kind()
    {
        inner = Node::Stmt(body);
    }
    types.iter().any(|it| it.test(inner))
}

/// What the selector `:statement` matches: not a `TSDeclareFunction`, nor a `TSExportAssignment`.
fn is_statement(statement: Stmt) -> bool {
    match statement.kind() {
        StmtKind::ExportAssign(_) => false,
        StmtKind::Fn(func) => func.has_body() || statement.is_exported(),
        _ => true,
    }
}

/// ESLint's `getActualLastToken`, of the node at `span`.
fn get_actual_last_token<'a>(file: &'a File<'a>, span: Span) -> Option<Token<'a>> {
    let semi_token = file.last_token(span)?;
    if ast_utils::is_semicolon_token(&semi_token)
        && let Some(prev_token) = file.token_before(semi_token)
        && let Some(next_token) = file.token_after(semi_token)
        && prev_token.start() >= span.start
        && file.line_of(semi_token.start()) != file.line_of(prev_token.end())
        && file.line_of(semi_token.end()) == file.line_of(next_token.start())
    {
        return Some(prev_token);
    }
    Some(semi_token)
}

/// `` whitespace.replace(/^(\s*?${LT})\s*${LT}(\s*;?)$/u, "$1$2") ``: up to the first line
/// terminator, and what is after the last.
fn remove_padding_lines(whitespace: &[u8]) -> Vec<u8> {
    let terminator_len = |at: usize| match whitespace.get(at..) {
        Some([b'\n' | b'\r', ..]) => 1,
        Some([0xE2, 0x80, 0xA8 | 0xA9, ..]) => 3,
        _ => 0,
    };
    let first = (0..whitespace.len()).find(|&at| terminator_len(at) > 0);
    let last = (0..whitespace.len()).rev().find(|&at| terminator_len(at) > 0);
    match (first, last) {
        (Some(first), Some(last)) if first < last => {
            let trailing_spaces = whitespace.get(..first + terminator_len(first)).unwrap_or_default();
            let indent_spaces = whitespace.get(last + terminator_len(last)..).unwrap_or_default();
            [trailing_spaces, indent_spaces].concat()
        }
        _ => whitespace.to_vec(),
    }
}

impl PaddingLineBetweenStatements {
    /// ESLint's `getPaddingType`.
    fn padding_type(&self, prev_node: Node, next_node: Node) -> PaddingType {
        let mut list = self.configure_list.iter().rev();
        list.find(|it| is_match(prev_node, &it.prev) && is_match(next_node, &it.next))
            .map_or(PaddingType::Any, |it| it.blank_line)
    }

    /// ESLint's `verify`, of a node and the one before it in the same list.
    fn verify<'a>(&self, prev_node: Node<'a>, next_node: Node<'a>, cx: &Cx<'a, Self>) {
        let padding_type = self.padding_type(prev_node, next_node);
        if padding_type == PaddingType::Any {
            return;
        }
        let (file, next) = (cx.file(), span_of(next_node));
        let Some(last_token) = get_actual_last_token(file, span_of(prev_node)) else {
            return;
        };

        // ESLint's `getPaddingLineSequences`: how many there are, and the first.
        let mut padding_lines = 0;
        let mut first_padding_line = None;
        if file.line_of(next.start) >= file.line_of(last_token.end()) + 2 {
            let mut prev_token = last_token;
            for token in file.tokens_after(last_token).with_comments() {
                if file.line_of(token.start()) >= file.line_of(prev_token.end()) + 2 {
                    padding_lines += 1;
                    if first_padding_line.is_none() {
                        first_padding_line = Some((prev_token, token));
                    }
                }
                prev_token = token;
                if prev_token.start() >= next.start {
                    break;
                }
            }
        }

        match padding_type {
            PaddingType::Never if padding_lines > 0 => {
                cx.report(next, UNEXPECTED_BLANK_LINE).fix(|fixer| {
                    let (prev_token, next_token) = first_padding_line.filter(|_| padding_lines == 1)?;
                    let between = Span::new(prev_token.end(), next_token.start());
                    Some(fixer.replace(between, remove_padding_lines(file.slice(between))))
                });
            }
            PaddingType::Always if padding_lines == 0 => {
                cx.report(next, EXPECTED_BLANK_LINE).fix(|fixer| {
                    // The blank line goes after the comments that trail the previous node.
                    let (mut prev_token, mut next_token) = (last_token, next);
                    for token in file.tokens_between(last_token, next).with_comments() {
                        if !ast_utils::is_token_on_same_line(file, prev_token, token) {
                            next_token = token.span();
                            break;
                        }
                        prev_token = token;
                    }
                    let is_on_same_line = ast_utils::is_token_on_same_line(file, prev_token, next_token);
                    fixer.insert_after(prev_token, if is_on_same_line { "\n\n" } else { "\n" })
                });
            }
            _ => {}
        }
    }

    fn verify_statements<'a>(&self, statements: List<'a, Stmt<'a>>, cx: &Cx<'a, Self>) {
        let mut prev_node = None;
        for statement in statements.iter().filter(|it| is_statement(*it)) {
            if let Some(prev_node) = prev_node {
                self.verify(Node::Stmt(prev_node), Node::Stmt(statement), cx);
            }
            prev_node = Some(statement);
        }
    }
}

impl Rule for PaddingLineBetweenStatements {
    const META: Meta = Meta::eslint("padding-line-between-statements", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let configure = |it: &Json| {
            let it = Object::of(Some(it));
            let types = |key: &str| -> Vec<StatementType> {
                match it.str(key) {
                    Some(name) => StatementType::of(name).into_iter().collect(),
                    None => it.strings(key).into_iter().filter_map(StatementType::of).collect(),
                }
            };
            Configure {
                blank_line: match it.str("blankLine") {
                    Some("never") => PaddingType::Never,
                    Some("always") => PaddingType::Always,
                    _ => PaddingType::Any,
                },
                prev: types("prev"),
                next: types("next"),
            }
        };
        PaddingLineBetweenStatements {
            configure_list: options.all().iter().map(configure).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.configure_list.iter().all(|it| it.blank_line == PaddingType::Any) {
            return;
        }
        on.finish(|rule, cx| rule.verify_statements(cx.file().body(), cx));
        on.funcs(|rule, func, cx| {
            if let Some(statements) = func.body_statements() {
                rule.verify_statements(statements, cx);
            }
        });
        on.cases(|rule, case, cx| rule.verify_statements(case.body(), cx));
        on.stmts([StmtTag::Block, StmtTag::Switch], |rule, statement, cx| match statement.kind() {
            StmtKind::Block(statements) => rule.verify_statements(statements, cx),
            StmtKind::Switch { cases, .. } => {
                let mut prev_node = None;
                for case in cases {
                    if let Some(prev_node) = prev_node {
                        rule.verify(Node::Case(prev_node), Node::Case(case), cx);
                    }
                    prev_node = Some(case);
                }
            }
            _ => {}
        });
    }
}
