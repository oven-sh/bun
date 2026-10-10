use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Enforce consistent indentation.
///
/// Amounts of indentation are numbers of JavaScript: one is `NaN` where upstream computes with
/// `undefined`, which is what `options.VariableDeclarator["using"]` is.
pub struct IndentLegacy {
    is_tab: bool,
    indent_size: f64,
    switch_case: f64,
    /// For `var`, `let` and `const`.
    variable_declarator: [f64; 3],
    outer_iife_body: Option<f64>,
    member_expression: Option<f64>,
    function_declaration: FunctionOptions,
    function_expression: FunctionOptions,
    call_arguments: Option<Offset>,
    array_expression: Offset,
    object_expression: Offset,
}

const EXPECTED: Message = Message::new(
    "expected",
    "Expected indentation of {{expected}} but found {{actual}}.",
);

#[derive(Copy, Clone)]
enum Offset {
    /// So many times the size of an indentation.
    Number(f64),
    /// `"first"`: aligned with the first element.
    First,
}

impl Offset {
    fn of(options: Object, key: &str) -> Option<Offset> {
        let first = || (options.str(key) == Some("first")).then_some(Offset::First);
        options.number(key).map(Offset::Number).or_else(first)
    }
}

#[derive(Copy, Clone)]
struct FunctionOptions {
    /// `None`: parameters are not checked.
    parameters: Option<Offset>,
    body: f64,
}

impl FunctionOptions {
    fn of(options: Object) -> FunctionOptions {
        FunctionOptions {
            parameters: Offset::of(options, "parameters"),
            body: options.number("body").unwrap_or(1.0),
        }
    }
}

/// The spaces and the tabs that a line starts with.
#[derive(Copy, Clone)]
struct Indent {
    space: u32,
    tab: u32,
}

/// ESLint's `loc` of a report.
#[derive(Copy, Clone)]
enum Loc {
    Node(Span),
    Position(u32),
}

/// A `VariableDeclarator` and its `VariableDeclaration`.
#[derive(Copy, Clone)]
struct Declarator<'a> {
    node: VarDecl<'a>,
    declaration: Stmt<'a>,
    declarations: List<'a, VarDecl<'a>>,
}

/// The elements of an array literal without the holes, or the properties of an object literal.
#[derive(Copy, Clone)]
enum Elements<'a> {
    Array(List<'a, Expr<'a>>),
    Object(List<'a, Prop<'a>>),
}

impl Elements<'_> {
    fn first(self) -> Option<Span> {
        match self {
            Elements::Array(list) => list.iter().find(|it| !it.is_missing()).map(Expr::span),
            Elements::Object(list) => list.first().map(Prop::span),
        }
    }

    fn last(self) -> Option<Span> {
        match self {
            Elements::Array(list) => list.iter().rfind(|it| !it.is_missing()).map(Expr::span),
            Elements::Object(list) => list.last().map(Prop::span),
        }
    }
}

/// Where the line that `offset` is in starts.
fn line_start(file: &File<'_>, offset: u32) -> u32 {
    match file.line_span(file.line_of(offset)).start {
        0 if file.has_bom() => 3,
        start => start,
    }
}

/// What is before `offset` on its line.
fn text_before_on_line<'a>(file: &'a File<'a>, offset: u32) -> &'a [u8] {
    file.slice(Span::new(line_start(file, offset), offset))
}

/// ESLint's `getNodeIndent`, of the token that starts at `token`.
fn get_node_indent(file: &File<'_>, token: u32) -> Indent {
    let line = file.text().get(line_start(file, token) as usize..).unwrap_or_default();
    let mut indent = Indent { space: 0, tab: 0 };
    for byte in line {
        match byte {
            b' ' => indent.space += 1,
            b'\t' => indent.tab += 1,
            _ => break,
        }
    }
    indent
}

/// ESLint's `isNodeFirstInLine(node)`, of the node that starts at `start`.
fn is_node_first_in_line<'a>(file: &'a File<'a>, start: u32) -> bool {
    let before = text_before_on_line(file, start);
    before.iter().all(|byte| matches!(byte, b' ' | b'\t'))
        || (file.token_before(Span::empty(start)))
            .is_none_or(|token| file.line_of(token.end()) != file.line_of(start))
}

/// ESLint's `isNodeFirstInLine(node, true)`
fn is_node_end_first_in_line<'a>(file: &'a File<'a>, node: Span) -> bool {
    (file.tokens_in(node).nth_back(1)).is_none_or(|token| file.line_of(token.end()) != file.line_of(node.end))
}

/// ESLint's `isSingleLineNode`
fn is_single_line_node(file: &File<'_>, node: Span) -> bool {
    file.line_of(node.start) == file.line_of(node.end)
}

/// `loc.start.column` of what starts at `offset`.
fn column(file: &File<'_>, offset: u32) -> f64 {
    f64::from(file.position(offset).column)
}

/// The range of the node that ESLint has in a list of statements.
fn statement_span(statement: Stmt<'_>) -> Span {
    statement.export_span().unwrap_or_else(|| statement.span())
}

/// What the walks up from a node find.
#[derive(Default)]
pub struct State<'a> {
    declarators: AncestorMemo<'a, Declarator<'a>>,
    /// Whether what is around a call is as [`is_outer_iife`] wants it.
    outer_calls: AncestorMemo<'a, bool>,
    around_members: AncestorMemo<'a, AroundMember<'a>>,
    around_members_in_arrows: AncestorMemo<'a, AroundMember<'a>>,
}

/// What decides whether a `MemberExpression` in it is checked.
#[derive(Copy, Clone)]
enum AroundMember<'a> {
    /// A variable declaration or an assignment.
    Assignment,
    FunctionExpression,
    Arrow(Func<'a>),
}

/// ESLint's `getVariableDeclaratorNode`
fn get_variable_declarator_node<'a>(node: Node<'a>, state: &mut State<'a>) -> Option<Declarator<'a>> {
    state.declarators.find(node, |_, it| as_declarator(it))
}

/// `None` for the parameter of a `catch`.
fn as_declarator(node: Node<'_>) -> Option<Declarator<'_>> {
    let Node::VarDecl(node) = node else {
        return None;
    };
    let declaration = node.parent().as_stmt()?;
    match declaration.kind() {
        StmtKind::Var(declarations) => Some(Declarator {
            node,
            declaration,
            declarations,
        }),
        _ => None,
    }
}

/// Whether ESLint calls it a `FunctionExpression`.
fn is_function_expression(func: Func<'_>) -> bool {
    func.has_body()
        && matches!(
            func.kind(),
            FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
        )
}

/// Whether ESLint calls it an `AssignmentExpression`, as opposed to a default value in a pattern.
fn is_assignment_expression(e: Expr<'_>) -> bool {
    e.tag() == ExprTag::Assign && !utils::is_assignment_target(e)
}

/// ESLint's `isOuterIIFE`
fn is_outer_iife<'a>(func: Func<'a>, state: &mut State<'a>) -> bool {
    let Node::Expr(node) = func.owner() else {
        return false;
    };
    let Node::Expr(parent) = node.parent() else {
        return false;
    };
    if !matches!(parent.kind(), ExprKind::Call(call) if call.callee() == node) || parent.is_chain_root() {
        return false;
    }
    let is_outer = state.outer_calls.find(Node::Expr(parent), |_, statement| {
        let is_legal = match statement {
            Node::Expr(e) => match e.kind() {
                ExprKind::Unary { op, .. } => matches!(op, UnOp::Not | UnOp::BitNot | UnOp::Plus | UnOp::Minus),
                ExprKind::Binary { op, .. } => matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma),
                _ => is_assignment_expression(e),
            },
            Node::VarDecl(_) => as_declarator(statement).is_some(),
            Node::Stmt(it) => {
                return Some(
                    (it.tag() == StmtTag::Var || utils::is_expression_statement(it))
                        && !it.is_exported()
                        && matches!(it.parent(), Node::File(_)),
                );
            }
            _ => false,
        };
        (!is_legal).then_some(false)
    });
    is_outer == Some(true)
}

/// ESLint's `isWrappedInParenthesis`, from the text of a `return` statement and of its argument.
fn is_wrapped_in_parenthesis(statement: &[u8], argument: &[u8]) -> bool {
    let Some(at) = strings::index_of(statement, argument) else {
        return false;
    };
    let without_argument = [&statement[..at], &statement[at + argument.len()..]].concat();
    (without_argument.strip_prefix(b"return"))
        .and_then(|rest| strings::trim_js_whitespace_start(rest).strip_prefix(b"("))
        .is_some_and(|rest| strings::trim_js_whitespace_start(rest).starts_with(b")"))
}

impl IndentLegacy {
    fn good_char(&self, indent: Indent) -> f64 {
        f64::from(if self.is_tab { indent.tab } else { indent.space })
    }

    /// `getNodeIndent(..).goodChar`, of the token that starts at `token`.
    fn good_char_at(&self, file: &File<'_>, token: u32) -> f64 {
        self.good_char(get_node_indent(file, token))
    }

    fn is_wrong(&self, indent: Indent, needed: f64) -> bool {
        let bad_char = if self.is_tab { indent.space } else { indent.tab };
        self.good_char(indent) != needed || bad_char != 0
    }

    /// `indentSize * options.VariableDeclarator[kind]`
    fn variable_offset(&self, kind: VarKind) -> f64 {
        self.indent_size
            * match kind {
                VarKind::Var => self.variable_declarator[0],
                VarKind::Let => self.variable_declarator[1],
                VarKind::Const => self.variable_declarator[2],
                VarKind::Using | VarKind::AwaitUsing => f64::NAN,
            }
    }

    /// What is added for a node that starts at `start`, if ESLint's `isNodeInVarOnTop` holds for it.
    fn offset_in_var_on_top(&self, file: &File<'_>, start: u32, declarator: Option<Declarator<'_>>) -> f64 {
        match declarator {
            Some(it)
                if file.line_of(it.declaration.span_without_export().start) == file.line_of(start)
                    && it.declarations.iter().nth(1).is_some() =>
            {
                self.variable_offset(it.node.var_kind())
            }
            _ => 0.0,
        }
    }

    /// `line`: a position in the line whose indentation is replaced.
    fn report(&self, cx: &Cx<'_, Self>, loc: Loc, line: u32, needed: f64, gotten: Indent) {
        // To avoid conflicts with `no-mixed-spaces-and-tabs`.
        if gotten.space > 0 && gotten.tab > 0 {
            return;
        }
        let mut expected = text::number_to_string(needed);
        expected.extend_from_slice(if self.is_tab { " tab" } else { " space" }.as_bytes());
        if needed != 1.0 {
            expected.push(b's');
        }
        let actual = match (gotten.space, gotten.tab) {
            (0, 0) => "0".to_owned(),
            (spaces, 0) if !self.is_tab => spaces.to_string(),
            (1, 0) => "1 space".to_owned(),
            (spaces, 0) => format!("{spaces} spaces"),
            (_, tabs) if self.is_tab => tabs.to_string(),
            (_, 1) => "1 tab".to_owned(),
            (_, tabs) => format!("{tabs} tabs"),
        };
        let start = line_start(cx.file(), line);
        let text_range = Span::new(start, start + gotten.space + gotten.tab);
        let indent_char = if self.is_tab { b'\t' } else { b' ' };
        let report = match loc {
            Loc::Node(node) => cx.report(node, EXPECTED),
            Loc::Position(at) => cx.report_at(at, EXPECTED),
        };
        report
            .data("expected", expected)
            .data("actual", actual)
            .fix(|fixer| fixer.replace(text_range, vec![indent_char; needed as usize]));
    }

    /// ESLint's `checkNodeIndent`, of a node or a token that has nothing more to check.
    fn check_node_indent(&self, cx: &Cx<'_, Self>, node: Span, needed: f64) {
        let actual = get_node_indent(cx.file(), node.start);
        if self.is_wrong(actual, needed) && is_node_first_in_line(cx.file(), node.start) {
            self.report(cx, Loc::Node(node), node.start, needed, actual);
        }
    }

    /// ESLint's `checkNodeIndent`, of an expression.
    fn check_expression_indent<'a>(&self, cx: &Cx<'a, Self>, e: Expr<'a>, needed: f64) {
        if !matches!(e.tag(), ExprTag::Array | ExprTag::Object) {
            self.check_node_indent(cx, e.span(), needed);
        }
    }

    /// ESLint's `checkNodeIndent`, of a statement.
    fn check_statement_indent<'a>(&self, cx: &Cx<'a, Self>, mut statement: Stmt<'a>, needed: f64) {
        let text = cx.text();
        let keyword_after = |before: Stmt<'a>, keyword: &str| {
            let start = skip_trivia(text, before.span().end);
            Span::new(start, start + keyword.len() as u32)
        };
        loop {
            self.check_node_indent(cx, statement_span(statement), needed);
            match statement.kind() {
                StmtKind::If { yes, no: Some(no), .. } => {
                    self.check_node_indent(cx, keyword_after(yes, "else"), needed);
                    if !is_node_first_in_line(cx.file(), no.span().start) {
                        statement = no;
                        continue;
                    }
                }
                StmtKind::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => {
                    if handler.is_some() {
                        self.check_node_indent(cx, keyword_after(block, "catch"), needed);
                    }
                    if finalizer.is_some() {
                        self.check_node_indent(cx, keyword_after(handler.unwrap_or(block), "finally"), needed);
                    }
                }
                StmtKind::DoWhile { body, .. } => {
                    self.check_node_indent(cx, keyword_after(body, "while"), needed);
                }
                _ => {}
            }
            break;
        }
    }

    fn check_statements_indent<'a>(&self, cx: &Cx<'a, Self>, statements: List<'a, Stmt<'a>>, needed: f64) {
        for statement in statements {
            self.check_statement_indent(cx, statement, needed);
        }
    }

    /// ESLint's `checkLastNodeLineIndent`, of a node whose last token is a `}`, a `]` or a `;`.
    fn check_last_node_line_indent(&self, cx: &Cx<'_, Self>, node: Span, needed: f64) {
        let last_token = node.end.saturating_sub(1);
        let end_indent = get_node_indent(cx.file(), last_token);
        if self.is_wrong(end_indent, needed) && is_node_end_first_in_line(cx.file(), node) {
            self.report(cx, Loc::Position(last_token), node.end, needed, end_indent);
        }
    }

    /// ESLint's `checkLastReturnStatementLineIndent`
    fn check_last_return_statement_line_indent(&self, cx: &Cx<'_, Self>, node: Span, needed: f64) {
        let file = cx.file();
        let Some(last_token) = file.tokens_in(node).rfind(ast_utils::is_closing_paren_token) else {
            return;
        };
        let start = last_token.start();
        if !strings::is_all_js_whitespace(text_before_on_line(file, start)) {
            return;
        }
        let end_indent = get_node_indent(file, start);
        if self.good_char(end_indent) != needed {
            self.report(cx, Loc::Position(start), node.end, needed, end_indent);
        }
    }

    /// ESLint's `checkIndentInFunctionBlock`. `body_option`: how many times its statements are
    /// indented, unless it is an outer IIFE.
    fn check_indent_in_function_block<'a>(&self, cx: &mut Cx<'a, Self>, func: Func<'a>, body: Span, body_option: f64) {
        let file = cx.file();
        let callee_node = func.estree_span();
        let mut indent = self.good_char_at(file, callee_node.start);

        if let Node::Expr(owner) = func.owner()
            && let Node::Expr(callee_parent) = owner.parent()
            && let ExprKind::Call(call) = callee_parent.kind()
            && call.args().get(1) == Some(owner)
            && call.args().first().is_some_and(|first| !is_single_line_node(file, first.span()))
            && is_single_line_node(file, call.callee().span())
            && !is_node_first_in_line(file, callee_node.start)
        {
            indent = self.good_char_at(file, callee_parent.span().start);
        }

        let function_offset = self.indent_size
            * match self.outer_iife_body {
                Some(outer_iife_body) if is_outer_iife(func, &mut cx.state) => outer_iife_body,
                _ => body_option,
            };
        indent += function_offset;
        let declarator = get_variable_declarator_node(Node::Func(func), &mut cx.state);
        indent += self.offset_in_var_on_top(file, body.start, declarator);

        if let Some(statements) = func.body_statements() {
            self.check_statements_indent(cx, statements, indent);
        }
        self.check_last_node_line_indent(cx, body, indent - function_offset);
    }

    /// What ESLint does with a `FunctionDeclaration`, a `FunctionExpression`, and the
    /// `BlockStatement` that is the body of one of these or of an arrow function.
    fn check_function<'a>(&self, cx: &mut Cx<'a, Self>, func: Func<'a>) {
        let options = match func.kind() {
            FnKind::Decl => self.function_declaration,
            FnKind::Arrow => FunctionOptions {
                parameters: None,
                body: 1.0,
            },
            _ if is_function_expression(func) => self.function_expression,
            _ => return,
        };
        let (file, node) = (cx.file(), func.estree_span());
        let Some(body) = func.body_span() else {
            return;
        };
        if is_single_line_node(file, node) {
            return;
        }

        let mut params = func.params_with_this().map(|param| utils::estree_span(Node::Param(param)));
        let needed = match options.parameters {
            Some(Offset::First) => params.next().map(|first| column(file, first.start)),
            Some(Offset::Number(parameters)) => {
                Some(self.good_char_at(file, node.start) + self.indent_size * parameters)
            }
            None => None,
        };
        if let Some(needed) = needed {
            params.for_each(|param| self.check_node_indent(cx, param, needed));
        }

        if !is_single_line_node(file, body) {
            self.check_indent_in_function_block(cx, func, body, options.body);
        }
    }

    /// ESLint's `checkIndentInArrayOrObjectBlock`
    fn check_indent_in_array_or_object_block<'a>(&self, cx: &mut Cx<'a, Self>, e: Expr<'a>) {
        let (file, node, size) = (cx.file(), e.span(), self.indent_size);
        if is_single_line_node(file, node) || utils::is_assignment_target(e) {
            return;
        }
        let (elements, option) = match e.kind() {
            ExprKind::Array(list) => (Elements::Array(list), self.array_expression),
            ExprKind::Object(list) => (Elements::Object(list), self.object_expression),
            _ => return,
        };
        let parent_var_node = get_variable_declarator_node(Node::Expr(e), &mut cx.state);

        let mut node_indent;
        if is_node_first_in_line(file, node.start) {
            // All of `a, b, c` starts where its `a, b` starts, which is nearer.
            let parent = match e.parent() {
                parent @ Node::Expr(sequence) if matches!(sequence.kind(), ExprKind::Binary { op: BinOp::Comma, .. }) => {
                    parent
                }
                _ => utils::estree_parent(Node::Expr(e)),
            };
            // ESLint has a `JSXExpressionContainer` or an `AssignmentPattern` between the two.
            let container = e.jsx_container_span();
            let parent_start = match (container, parent) {
                (Some(container), _) => container.start,
                (None, Node::PatProp(property)) if property.default() == Some(e) => property.value().span().start,
                (None, parent) => utils::estree_span(parent).start,
            };
            node_indent = self.good_char_at(file, parent_start);

            let line = file.line_of(node.start);
            if container.is_none() && parent_var_node.is_none_or(|it| file.line_of(it.node.span().start) != line) {
                match parent {
                    Node::VarDecl(_) => {
                        if let Some(it) = parent_var_node
                            && it.declarations.first() == Some(it.node)
                        {
                            node_indent += self.variable_offset(it.node.var_kind());
                        }
                    }
                    Node::Expr(parent) => match parent.kind() {
                        ExprKind::Array(parent_elements) => {
                            let first = parent_elements.first().filter(|it| !it.is_missing()).map(Expr::span);
                            let parent_line = file.line_of(parent.span().start);
                            // If the first element of the array spans multiple lines, the rest is
                            // not indented more.
                            let first_spans_lines = first.is_some_and(|first| {
                                file.line_of(first.start) == parent_line && file.line_of(first.end) != parent_line
                            });
                            match (self.array_expression, first) {
                                _ if first_spans_lines => {}
                                (Offset::Number(option), _) => node_indent += option * size,
                                (Offset::First, Some(first)) => node_indent = column(file, first.start),
                                (Offset::First, None) => {}
                            }
                        }
                        ExprKind::Call(call) | ExprKind::New(call) => match self.call_arguments {
                            Some(Offset::Number(arguments)) => node_indent += arguments * size,
                            Some(Offset::First) => {
                                if let Some(first) = call.args().first()
                                    && call.callee() != e
                                {
                                    node_indent = column(file, first.span().start);
                                }
                            }
                            None => node_indent += size,
                        },
                        ExprKind::Binary {
                            op: BinOp::And | BinOp::Or | BinOp::Nullish,
                            ..
                        } => node_indent += size,
                        _ => {}
                    },
                    Node::Func(func) if func.is_arrow() => node_indent += size,
                    _ => {}
                }
            }

            // ESLint's `checkFirstNodeLineIndent`
            let start_indent = get_node_indent(file, node.start);
            if self.is_wrong(start_indent, node_indent) {
                self.report(cx, Loc::Position(node.start), node.start, node_indent, start_indent);
            }
        } else {
            node_indent = self.good_char_at(file, node.start);
        }

        let in_var_on_top = self.offset_in_var_on_top(file, node.start, parent_var_node);
        let elements_indent = in_var_on_top
            + match option {
                Offset::First => elements.first().map_or(0.0, |first| column(file, first.start)),
                Offset::Number(option) => node_indent + size * option,
            };
        match elements {
            Elements::Array(list) => {
                for element in list.iter().filter(|it| !it.is_missing()) {
                    self.check_expression_indent(cx, element, elements_indent);
                }
            }
            Elements::Object(list) => {
                for property in list {
                    self.check_node_indent(cx, property.span(), elements_indent);
                }
            }
        }

        // The last line is not checked if the last element is in it.
        if elements.last().is_none_or(|last| file.line_of(last.end) != file.line_of(node.end)) {
            self.check_last_node_line_indent(cx, node, node_indent + in_var_on_top);
        }
    }

    /// ESLint's `blockIndentationCheck`, of a `ClassBody`.
    fn check_class_body<'a>(&self, cx: &Cx<'a, Self>, class: Class<'a>) {
        let (file, node) = (cx.file(), class.body_span());
        if is_single_line_node(file, node) {
            return;
        }
        let from = match class.owner() {
            Node::Stmt(_) => class.estree_span().start,
            _ => node.start,
        };
        let needed = self.good_char_at(file, from) + self.indent_size;
        for member in class.members() {
            self.check_node_indent(cx, member.span(), needed);
        }
    }

    /// ESLint's `blockIndentationCheck`, of a `BlockStatement` that is not the body of a function.
    fn check_block<'a>(&self, cx: &Cx<'a, Self>, block: Stmt<'a>, body: List<'a, Stmt<'a>>) {
        let (file, node) = (cx.file(), block.span());
        if is_single_line_node(file, node) {
            return;
        }
        // These are indented from where the statement starts, not from where the block does.
        let from = match block.parent() {
            Node::Stmt(parent)
                if matches!(
                    parent.tag(),
                    StmtTag::If
                        | StmtTag::While
                        | StmtTag::For
                        | StmtTag::ForIn
                        | StmtTag::ForOf
                        | StmtTag::DoWhile
                        | StmtTag::Try
                ) =>
            {
                parent.span().start
            }
            _ => node.start,
        };
        let indent = self.good_char_at(file, from);
        self.check_statements_indent(cx, body, indent + self.indent_size);
        self.check_last_node_line_indent(cx, node, indent);
    }

    /// ESLint's `checkIndentInVariableDeclarations`
    fn check_indent_in_variable_declarations<'a>(
        &self,
        cx: &Cx<'a, Self>,
        statement: Stmt<'a>,
        declarations: List<'a, VarDecl<'a>>,
    ) {
        let (file, node) = (cx.file(), statement.span_without_export());
        let (Some(first), Some(last)) = (declarations.first(), declarations.last()) else {
            return;
        };
        if file.line_of(last.span().start) <= file.line_of(first.span().start) {
            return;
        }
        let elements_indent = self.good_char_at(file, node.start) + self.variable_offset(first.var_kind());

        // One declarator of each line but that of the keyword.
        let mut last_line = file.line_of(node.start);
        let mut last_element = None;
        for element in declarations {
            let line = file.line_of(element.span().start);
            if line != last_line {
                self.check_node_indent(cx, element.span(), elements_indent);
                (last_line, last_element) = (line, Some(element));
            }
        }

        // The last line is checked only if there is a token after the last declarator.
        let Some(last_element) = last_element else {
            return;
        };
        if file.line_of(node.end) <= file.line_of(last_element.span().end) {
            return;
        }
        match file.token_before(last_element.span()) {
            // With the comma first, the semicolon is indented.
            Some(comma) if comma.is(",") => {
                self.check_last_node_line_indent(cx, node, self.good_char_at(file, comma.start()));
            }
            _ => self.check_last_node_line_indent(cx, node, elements_indent - self.indent_size),
        }
    }

    fn check_statement<'a>(&self, cx: &Cx<'a, Self>, statement: Stmt<'a>) {
        let (file, node) = (cx.file(), statement.span());
        match statement.kind() {
            StmtKind::Block(body) => self.check_block(cx, statement, body),
            StmtKind::While { body, .. }
            | StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::DoWhile { body, .. } => {
                if !matches!(body.kind(), StmtKind::Block(_)) && !is_single_line_node(file, node) {
                    let indent = self.good_char_at(file, node.start);
                    self.check_statement_indent(cx, body, indent + self.indent_size);
                }
            }
            StmtKind::If { yes, .. } => {
                if !matches!(yes.kind(), StmtKind::Block(_)) && file.line_of(yes.span().start) > file.line_of(node.start)
                {
                    let indent = self.good_char_at(file, node.start);
                    self.check_statement_indent(cx, yes, indent + self.indent_size);
                }
            }
            StmtKind::Var(declarations) => self.check_indent_in_variable_declarations(cx, statement, declarations),
            StmtKind::Switch { cases, .. } => {
                let switch_indent = self.good_char_at(file, node.start);
                for case in cases {
                    self.check_node_indent(cx, case.span(), switch_indent + self.indent_size * self.switch_case);
                }
                self.check_last_node_line_indent(cx, node, switch_indent);
            }
            StmtKind::Return(argument) => {
                if is_single_line_node(file, node) {
                    return;
                }
                let first_line_indent = self.good_char_at(file, node.start);
                if argument.is_some_and(|argument| is_wrapped_in_parenthesis(statement.text(), argument.text())) {
                    self.check_last_return_statement_line_indent(cx, node, first_line_indent);
                } else {
                    self.check_node_indent(cx, node, first_line_indent);
                }
            }
            _ => {}
        }
    }

    fn check_switch_case<'a>(&self, cx: &Cx<'a, Self>, case: Case<'a>) {
        let file = cx.file();
        if is_single_line_node(file, case.span()) {
            return;
        }
        let case_indent = self.good_char_at(file, case.parent().span().start) + self.indent_size * self.switch_case;
        self.check_statements_indent(cx, case.body(), case_indent + self.indent_size);
    }

    fn check_call_expression<'a>(&self, cx: &Cx<'a, Self>, e: Expr<'a>) {
        let (file, node) = (cx.file(), e.span());
        let (ExprKind::Call(call), Some(option)) = (e.kind(), self.call_arguments) else {
            return;
        };
        if is_single_line_node(file, node) {
            return;
        }
        let mut arguments = call.args().iter();
        let needed = match option {
            Offset::First => arguments.next().map(|first| column(file, first.span().start)),
            Offset::Number(option) => Some(self.good_char_at(file, node.start) + self.indent_size * option),
        };
        if let Some(needed) = needed {
            arguments.for_each(|argument| self.check_expression_indent(cx, argument, needed));
        }
    }

    fn check_member_expression<'a>(&self, cx: &mut Cx<'a, Self>, e: Expr<'a>) {
        let (file, node) = (cx.file(), e.span());
        let Some(option) = self.member_expression else {
            return;
        };
        if is_single_line_node(file, node) || e.is_jsx_tag_name() || utils::is_in_type_query(e) {
            return;
        }

        // The typical layout of variable declarations and assignments alters what is expected.
        let mut around = cx.state.around_members.find(Node::Expr(e), |_, ancestor| match ancestor {
            Node::VarDecl(_) if as_declarator(ancestor).is_some() => Some(AroundMember::Assignment),
            Node::Expr(ancestor) if is_assignment_expression(ancestor) => Some(AroundMember::Assignment),
            Node::Func(func) if is_function_expression(func) => Some(AroundMember::FunctionExpression),
            Node::Func(func) if func.is_arrow() => Some(AroundMember::Arrow(func)),
            _ => None,
        });
        // A variable declaration around an arrow function does not count.
        if let Some(AroundMember::Arrow(arrow)) = around {
            around = cx.state.around_members_in_arrows.find(Node::Func(arrow), |_, ancestor| match ancestor {
                Node::Expr(ancestor) if is_assignment_expression(ancestor) => Some(AroundMember::Assignment),
                Node::Func(func) if is_function_expression(func) => Some(AroundMember::FunctionExpression),
                _ => None,
            });
        }
        if matches!(around, Some(AroundMember::Assignment)) {
            return;
        }

        let property_indent = self.good_char_at(file, node.start) + self.indent_size * option;
        let property = match e.kind() {
            ExprKind::Dot { name, .. } => {
                self.check_node_indent(cx, name.span(), property_indent);
                name.span()
            }
            ExprKind::Index { index, .. } => {
                self.check_expression_indent(cx, index, property_indent);
                index.span()
            }
            _ => return,
        };
        if let Some(dot) = file.token_before(property)
            && dot.is_punctuator(".")
        {
            self.check_node_indent(cx, dot.span(), property_indent);
        }
    }
}

impl Rule for IndentLegacy {
    const META: Meta = Meta::eslint("indent-legacy", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new()
        .exprs(&[
            ExprTag::Object,
            ExprTag::Array,
            ExprTag::Call,
            ExprTag::Dot,
            ExprTag::Index,
        ])
        .stmts(&[
            StmtTag::Block,
            StmtTag::While,
            StmtTag::For,
            StmtTag::ForIn,
            StmtTag::ForOf,
            StmtTag::DoWhile,
            StmtTag::If,
            StmtTag::Var,
            StmtTag::Switch,
        ])
        .funcs()
        .classes()
        .cases()
        .finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let is_tab = options.str(0) == Some("tab");
        let opts = options.object(1);
        let variable_declarator = match opts.number("VariableDeclarator") {
            Some(all) => [all; 3],
            None => {
                let kinds = opts.object("VariableDeclarator");
                ["var", "let", "const"].map(|kind| kinds.number(kind).unwrap_or(1.0))
            }
        };
        IndentLegacy {
            is_tab,
            indent_size: if is_tab { 1.0 } else { options.number(0).unwrap_or(4.0) },
            switch_case: opts.number("SwitchCase").unwrap_or(0.0),
            variable_declarator,
            outer_iife_body: opts.number("outerIIFEBody"),
            member_expression: opts.number("MemberExpression"),
            function_declaration: FunctionOptions::of(opts.object("FunctionDeclaration")),
            function_expression: FunctionOptions::of(opts.object("FunctionExpression")),
            call_arguments: Offset::of(opts.object("CallExpression"), "arguments"),
            array_expression: Offset::of(opts, "ArrayExpression").unwrap_or(Offset::Number(1.0)),
            object_expression: Offset::of(opts, "ObjectExpression").unwrap_or(Offset::Number(1.0)),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new()
            .exprs(&[ExprTag::Object, ExprTag::Array])
            .stmts(&[
                StmtTag::Block,
                StmtTag::While,
                StmtTag::For,
                StmtTag::ForIn,
                StmtTag::ForOf,
                StmtTag::DoWhile,
                StmtTag::If,
                StmtTag::Var,
                StmtTag::Switch,
            ])
            .funcs()
            .classes()
            .cases()
            .finish();
        if self.call_arguments.is_some() {
            on = on.exprs(&[ExprTag::Call]);
        }
        if self.member_expression.is_some() {
            on = on.exprs(&[ExprTag::Dot, ExprTag::Index]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Object | ExprTag::Array => self.check_indent_in_array_or_object_block(cx, e),
            ExprTag::Call => self.check_call_expression(cx, e),
            ExprTag::Dot | ExprTag::Index => self.check_member_expression(cx, e),
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.check_statement(cx, statement);
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        self.check_function(cx, func);
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        self.check_class_body(cx, class);
    }

    fn case<'a>(&self, case: Case<'a>, cx: &mut Cx<'a, Self>) {
        self.check_switch_case(cx, case);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // Root nodes should have no indent.
        let needed = self.good_char_at(cx.file(), cx.program_span().start);
        self.check_statements_indent(cx, cx.file().body(), needed);
        // There can be two reports about one `return`: ESLint has that of what it is a statement of first.
        for statement in cx.file().stmts_of_kind(StmtTag::Return) {
            self.check_statement(cx, statement);
        }
    }
}
