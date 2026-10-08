use bun_lint::prelude::*;

/// Disallow unused expressions.
pub struct NoUnusedExpressions {
    config: Config,
}

const UNUSED_EXPRESSION: Message = Message::new(
    "unusedExpression",
    "Expected an assignment or function call and instead saw an expression.",
);

/// The options.
#[derive(Copy, Clone)]
pub struct Config {
    allow_short_circuit: bool,
    allow_ternary: bool,
    allow_tagged_templates: bool,
    enforce_for_jsx: bool,
    ignore_directives: bool,
}

impl Config {
    pub fn new(options: &Options) -> Config {
        let options = options.object(0);
        Config {
            allow_short_circuit: options.bool_or("allowShortCircuit", false),
            allow_ternary: options.bool_or("allowTernary", false),
            allow_tagged_templates: options.bool_or("allowTaggedTemplates", false),
            enforce_for_jsx: options.bool_or("enforceForJSX", false),
            ignore_directives: options.bool_or("ignoreDirectives", false),
        }
    }

    /// Whether evaluating `e` has no side effects. What is not known counts as having some.
    fn is_disallowed(self, e: Expr) -> bool {
        match e.kind() {
            ExprKind::Array(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Ident(_)
            | ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::ImportMeta
            | ExprKind::NewTarget
            | ExprKind::Object(_)
            | ExprKind::Template(_)
            | ExprKind::This => true,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                right,
                ..
            } => !self.allow_short_circuit || self.is_disallowed(right),
            ExprKind::Binary { .. } => true,
            ExprKind::Cond { yes, no, .. } => {
                !self.allow_ternary || self.is_disallowed(yes) || self.is_disallowed(no)
            }
            ExprKind::Jsx(_) => self.enforce_for_jsx,
            ExprKind::TaggedTemplate(_) => !self.allow_tagged_templates,
            ExprKind::Unary { op, .. } => {
                matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof)
            }
            ExprKind::As { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => self.is_disallowed(expr),
            _ => false,
        }
    }
}

fn looks_like_directive(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Expr(e) if e.as_string().is_some())
}

/// Whether `statement` is where a directive can be, even if the parser does not say that it is
/// one, as for ES3.
fn is_in_directive_prologue(statement: Stmt) -> bool {
    if !looks_like_directive(statement) || !ast_utils::is_top_level_expression_statement(statement) {
        return false;
    }
    let siblings = match statement.parent() {
        Node::File(file) => Some(file.body()),
        Node::Func(func) => func.body_statements(),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Module(module) => Some(module.innermost().body()),
            _ => None,
        },
        _ => None,
    };
    siblings.is_some_and(|siblings| {
        siblings
            .iter()
            .take_while(|it| *it != statement)
            .all(looks_like_directive)
    })
}

/// The whole rule, for an expression statement. typescript-eslint's rule of the same name is no
/// different.
pub fn check<'a, R: Rule>(config: Config, statement: Stmt<'a>, cx: &Cx<'a, R>) {
    if let StmtKind::Expr(e) = statement.kind()
        && config.is_disallowed(e)
        && !ast_utils::is_directive(statement)
        && !(config.ignore_directives && is_in_directive_prologue(statement))
    {
        cx.report(statement, UNUSED_EXPRESSION);
    }
}

impl Rule for NoUnusedExpressions {
    const META: Meta = Meta::eslint("no-unused-expressions", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoUnusedExpressions {
            config: Config::new(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Expr], |rule, statement, cx| check(rule.config, statement, cx));
    }
}
