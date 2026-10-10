use bun_lint::prelude::*;
use smallvec::{SmallVec, smallvec};

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
        // It is disallowed if one of these is.
        let mut parts: SmallVec<[Expr; 4]> = smallvec![e];
        while let Some(e) = parts.pop() {
            let is_disallowed = match e.kind() {
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
                } => {
                    parts.push(right);
                    !self.allow_short_circuit
                }
                ExprKind::Binary { .. } => true,
                ExprKind::Cond { yes, no, .. } => {
                    parts.extend([yes, no]);
                    !self.allow_ternary
                }
                ExprKind::Jsx(_) => self.enforce_for_jsx,
                ExprKind::TaggedTemplate(_) => !self.allow_tagged_templates,
                ExprKind::Unary { op, .. } => {
                    matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof)
                }
                ExprKind::As { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr)
                | ExprKind::Instantiation { expr, .. } => {
                    parts.push(expr);
                    false
                }
                _ => false,
            };
            if is_disallowed {
                return true;
            }
        }
        false
    }
}

fn looks_like_directive(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Expr(e) if e.as_string().is_some())
}

/// What has been asked about last, with where its first statement that does not look like a
/// directive starts.
#[derive(Default)]
pub struct Prologue<'a>(Option<(Node<'a>, u32)>);

/// Whether `statement` is where a directive can be, even if the parser does not say that it is
/// one, as for ES3.
fn is_in_directive_prologue<'a>(statement: Stmt<'a>, known: &mut Prologue<'a>) -> bool {
    if !looks_like_directive(statement) || !ast_utils::is_top_level_expression_statement(statement) {
        return false;
    }
    let parent = statement.parent();
    if let Some((_, end)) = known.0.filter(|it| it.0 == parent) {
        return statement.span().start < end;
    }
    let Some(siblings) = body_with_directives(parent) else {
        return false;
    };
    let end = siblings.iter().find(|it| !looks_like_directive(*it)).map_or(u32::MAX, |it| it.span().start);
    known.0 = Some((parent, end));
    statement.span().start < end
}

/// The body of a program, a function or a namespace: what can start with directives.
pub(super) fn body_with_directives(parent: Node<'_>) -> Option<List<'_, Stmt<'_>>> {
    match parent {
        Node::File(file) => Some(file.body()),
        Node::Func(func) => func.body_statements(),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Module(module) => Some(module.innermost().body()),
            _ => None,
        },
        _ => None,
    }
}

/// The whole rule, for an expression statement. typescript-eslint's rule of the same name is no
/// different.
pub fn check<'a, R: Rule>(config: Config, statement: Stmt<'a>, prologue: &mut Prologue<'a>, cx: &Cx<'a, R>) {
    if let StmtKind::Expr(e) = statement.kind()
        && config.is_disallowed(e)
        && !ast_utils::is_directive(statement)
        && !(config.ignore_directives && is_in_directive_prologue(statement, prologue))
    {
        cx.report(statement, UNUSED_EXPRESSION);
    }
}

impl Rule for NoUnusedExpressions {
    const META: Meta = Meta::eslint("no-unused-expressions", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::Expr]);
    type State<'a> = Prologue<'a>;

    fn new(options: &Options) -> Self {
        NoUnusedExpressions {
            config: Config::new(options),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Prologue<'a>> {
        Some(Prologue::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let mut prologue = std::mem::take(&mut cx.state);
        check(self.config, statement, &mut prologue, cx);
        cx.state = prologue;
    }
}
