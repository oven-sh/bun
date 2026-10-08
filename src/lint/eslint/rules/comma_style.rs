use bun_lint::prelude::*;

/// Enforce consistent comma style.
pub struct CommaStyle {
    style: Style,
    /// The kinds of nodes that are not checked.
    exceptions: Exceptions,
}

#[derive(Copy, Clone, PartialEq)]
enum Style {
    First,
    Last,
    /// The comma is alone on its line.
    Between,
}

struct Exceptions {
    array_expression: bool,
    array_pattern: bool,
    arrow_function_expression: bool,
    call_expression: bool,
    function_declaration: bool,
    function_expression: bool,
    import_declaration: bool,
    new_expression: bool,
    object_expression: bool,
    object_pattern: bool,
    variable_declaration: bool,
}

const UNEXPECTED_LINE_BEFORE_AND_AFTER_COMMA: Message = Message::new(
    "unexpectedLineBeforeAndAfterComma",
    "Bad line breaking before and after ','.",
);
const EXPECTED_COMMA_FIRST: Message =
    Message::new("expectedCommaFirst", "',' should be placed first.");
const EXPECTED_COMMA_LAST: Message = Message::new("expectedCommaLast", "',' should be placed last.");

/// Moves `comma` to where `style` wants it between `previous` and `current`.
fn move_comma<'a>(
    fixer: Fixer<'a>,
    style: Style,
    previous: Token<'a>,
    comma: Token<'a>,
    current: Token<'a>,
) -> Fix {
    let file = fixer.file();
    let before = file.slice(Span::new(previous.end(), comma.start()));
    let after = file.slice(Span::new(comma.end(), current.start()));
    let mut replaced = Vec::with_capacity(before.len() + after.len() + 1);
    if style != Style::First {
        replaced.push(b',');
    }
    replaced.extend_from_slice(before);
    replaced.extend_from_slice(after);
    match style {
        Style::First => replaced.push(b','),
        Style::Last => {}
        Style::Between => {
            if let Some((at, len)) = text::find_line_break(&replaced) {
                replaced.drain(at..at + len);
            }
        }
    }
    fixer.replace(Span::new(previous.end(), current.start()), replaced)
}

impl CommaStyle {
    /// ESLint's `validateCommaItemSpacing`. `previous` is the last token of the item before
    /// `comma`, `current` the first token of the item after it.
    fn validate_comma_item_spacing<'a>(
        &self,
        previous: Token<'a>,
        comma: Token<'a>,
        current: Token<'a>,
        cx: &Cx<'a, Self>,
    ) {
        let file = cx.file();
        let is_before_current = ast_utils::is_token_on_same_line(file, comma, current);
        let is_after_previous = ast_utils::is_token_on_same_line(file, previous, comma);
        let (message, style) = match (is_after_previous, is_before_current) {
            (true, true) => return,
            (false, false) => {
                let keeps_style = file.comments_after(comma).next().is_some_and(|comment| {
                    comment.kind() == TokenKind::Block
                        && ast_utils::is_token_on_same_line(file, comma, comment)
                });
                let style = if keeps_style { self.style } else { Style::Between };
                (UNEXPECTED_LINE_BEFORE_AND_AFTER_COMMA, style)
            }
            (true, false) if self.style == Style::First => (EXPECTED_COMMA_FIRST, Style::First),
            (false, true) if self.style == Style::Last => (EXPECTED_COMMA_LAST, Style::Last),
            _ => return,
        };
        cx.report(comma, message)
            .fix(|fixer| move_comma(fixer, style, previous, comma, current));
    }

    /// ESLint's `validateComma`. `None` among `items` is a hole in an array.
    fn validate_comma(
        &self,
        node: Span,
        is_array: bool,
        items: &mut dyn Iterator<Item = Option<Span>>,
        cx: &Cx<'_, Self>,
    ) {
        let file = cx.file();
        let Some(mut previous) = file.first_token(node) else {
            return;
        };
        for item in items {
            let (comma, current) = match item {
                Some(item) => (file.token_before(item), file.first_token(item)),
                None => (Some(previous), file.token_after(previous)),
            };
            let (Some(comma), Some(current)) = (comma, current) else {
                return;
            };
            if ast_utils::is_comma_token(&comma) {
                self.validate_comma_item_spacing(previous, comma, current, cx);
            }
            let last_of_item = match item {
                Some(item) => match file.tokens_after(item).find(ast_utils::is_not_closing_paren_token) {
                    Some(after) => file.token_before(after),
                    None => file.tokens().next_back(),
                },
                None => Some(current),
            };
            let Some(last_of_item) = last_of_item else {
                return;
            };
            previous = last_of_item;
        }

        // `[1, 2, ]` has two elements: the last comma is before none.
        if is_array
            && let Some(last) = file.last_token(node)
            && let Some(comma) = file.token_before(last)
            && ast_utils::is_comma_token(&comma)
            && let Some(previous) = file.token_before(comma)
        {
            self.validate_comma_item_spacing(previous, comma, last, cx);
        }
    }

    /// For anything but an array: the commas are those between the first and the last item.
    fn check_items(
        &self,
        node: Span,
        items: impl DoubleEndedIterator<Item = Span> + Clone,
        cx: &Cx<'_, Self>,
    ) {
        let (Some(first), Some(last)) = (items.clone().next(), items.clone().next_back()) else {
            return;
        };
        if first == last || cx.is_on_same_line(first.end, last.start) {
            return;
        }
        self.validate_comma(node, false, &mut items.map(Some), cx);
    }

    fn check_expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let exceptions = &self.exceptions;
        let is_excepted = |expression: bool, pattern: bool| match expression == pattern {
            true => expression,
            false if utils::is_assignment_target(e) => pattern,
            false => expression,
        };
        match e.kind() {
            ExprKind::Array(elements) => {
                let span = e.span();
                if !cx.is_on_same_line(span.start, span.end)
                    && !is_excepted(exceptions.array_expression, exceptions.array_pattern)
                {
                    let mut items = elements.iter().map(|it| (!it.is_missing()).then(|| it.span()));
                    self.validate_comma(span, true, &mut items, cx);
                }
            }
            ExprKind::Object(props) => {
                if let (Some(first), Some(last)) = (props.first(), props.last())
                    && !cx.is_on_same_line(first.span().end, last.span().start)
                    && !is_excepted(exceptions.object_expression, exceptions.object_pattern)
                {
                    self.check_items(e.span(), props.iter().map(Prop::span), cx);
                }
            }
            ExprKind::Call(call) | ExprKind::New(call) => {
                self.check_items(e.span(), call.args().iter().map(Expr::span), cx);
            }
            _ => {}
        }
    }

    fn check_pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        match pat.kind() {
            PatKind::Array(elements) => {
                let span = utils::estree_span(Node::Pat(pat));
                if !cx.is_on_same_line(span.start, span.end) {
                    let mut items = elements.iter().map(|it| it.pat().map(|_| it.span()));
                    self.validate_comma(span, true, &mut items, cx);
                }
            }
            PatKind::Object(props) => {
                self.check_items(pat.span(), props.iter().map(PatProp::span), cx);
            }
            _ => {}
        }
    }

    fn check_func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        let is_excepted = match func.kind() {
            _ if !func.has_body() => true,
            FnKind::Decl => self.exceptions.function_declaration,
            FnKind::Arrow => self.exceptions.arrow_function_expression,
            FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                self.exceptions.function_expression
            }
            _ => true,
        };
        if is_excepted {
            return;
        }
        let params = func.this_param().into_iter().chain(func.params());
        self.check_items(
            func.estree_span(),
            params.map(|it| utils::estree_span(Node::Param(it))),
            cx,
        );
    }

    fn check_stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            StmtKind::Var(declarations) => {
                let node = statement.span_without_export();
                self.check_items(node, declarations.iter().map(VarDecl::span), cx);
            }
            StmtKind::Import(import) => {
                let specifiers = (import.default().map(Ident::span).into_iter())
                    .chain(import.namespace_span())
                    .chain(import.named().iter().map(ImportSpec::span));
                self.check_items(statement.span(), specifiers, cx);
            }
            _ => {}
        }
    }
}

impl Rule for CommaStyle {
    const META: Meta = Meta::eslint("comma-style", Kind::Layout)
        .fixable(Fixable::Code)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let configured = match options.len() {
            2 => options.object(1).object("exceptions"),
            _ => Object::default(),
        };
        CommaStyle {
            style: match options.str(0) {
                Some("first") => Style::First,
                _ => Style::Last,
            },
            exceptions: Exceptions {
                array_expression: configured.bool_or("ArrayExpression", false),
                array_pattern: configured.bool_or("ArrayPattern", true),
                arrow_function_expression: configured.bool_or("ArrowFunctionExpression", true),
                call_expression: configured.bool_or("CallExpression", true),
                function_declaration: configured.bool_or("FunctionDeclaration", true),
                function_expression: configured.bool_or("FunctionExpression", true),
                import_declaration: configured.bool_or("ImportDeclaration", true),
                new_expression: configured.bool_or("NewExpression", true),
                object_expression: configured.bool_or("ObjectExpression", false),
                object_pattern: configured.bool_or("ObjectPattern", true),
                variable_declaration: configured.bool_or("VariableDeclaration", false),
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        let exceptions = &self.exceptions;
        if !exceptions.array_expression || !exceptions.array_pattern {
            on.exprs([ExprTag::Array], Self::check_expr);
        }
        if !exceptions.object_expression || !exceptions.object_pattern {
            on.exprs([ExprTag::Object], Self::check_expr);
        }
        if !exceptions.call_expression {
            on.exprs([ExprTag::Call], Self::check_expr);
        }
        if !exceptions.new_expression {
            on.exprs([ExprTag::New], Self::check_expr);
        }
        if !exceptions.array_pattern {
            on.pats([PatTag::Array], Self::check_pat);
        }
        if !exceptions.object_pattern {
            on.pats([PatTag::Object], Self::check_pat);
        }
        if !exceptions.function_declaration
            || !exceptions.function_expression
            || !exceptions.arrow_function_expression
        {
            on.funcs(Self::check_func);
        }
        if !exceptions.variable_declaration {
            on.stmts([StmtTag::Var], Self::check_stmt);
        }
        if !exceptions.import_declaration {
            on.stmts([StmtTag::Import], Self::check_stmt);
        }
    }
}
