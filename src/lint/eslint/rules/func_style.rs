use bun_lint::prelude::*;
use bun_lint::types::IdSet;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashSet;

/// Enforce the consistent use of either `function` declarations or expressions assigned to variables.
pub struct FuncStyle {
    enforce_declarations: bool,
    allow_arrow_functions: bool,
    allow_type_annotation: bool,
    /// `overrides.namedExports`
    named_exports: Option<Style>,
}

#[derive(Copy, Clone, PartialEq)]
enum Style {
    Declaration,
    Expression,
    Ignore,
}

const EXPRESSION: Message = Message::new("expression", "Expected a function expression.");
const DECLARATION: Message = Message::new("declaration", "Expected a function declaration.");

#[derive(Default)]
pub struct State<'a> {
    /// The arrow functions that should be declarations unless they use `this` or `super`, each with its declarator.
    candidates: Vec<(Func<'a>, VarDecl<'a>)>,
    /// The arrow functions that are the innermost function around a `this` or a `super`.
    with_this_or_super: IdSet<Func<'a>>,
    functions: AncestorMemo<'a, Func<'a>>,
    /// The file's overload signatures, built the first time a function declaration needs them: the owner of the
    /// statement list, the name, and whether it's exported.
    overloads: Option<FxHashSet<(Node<'a>, Name<'a>, bool)>>,
}

/// Returns the node that owns the statement list containing `statement`. All the clauses of a `switch` count as one
/// list.
fn statement_list_owner(statement: Stmt<'_>) -> Option<Node<'_>> {
    match statement.parent() {
        parent @ (Node::File(_) | Node::Func(_)) => Some(parent),
        Node::Case(case) => Some(case.parent())
            .filter(|it| it.as_stmt().is_some_and(|it| it.tag() == StmtTag::Switch)),
        Node::Stmt(parent) => (parent.as_block().is_some() || parent.tag() == StmtTag::Module)
            .then_some(Node::Stmt(parent)),
        _ => None,
    }
}

fn overloads<'a>(file: &'a File<'a>) -> FxHashSet<(Node<'a>, Name<'a>, bool)> {
    let signatures = file.stmts_of_kind(StmtTag::Fn).filter_map(|statement| {
        let func = statement.as_fn()?;
        let flags = func.flags();
        if func.has_body() || flags.contains(Flags::EXPORT | Flags::DEFAULT) {
            return None;
        }
        Some((
            statement_list_owner(statement)?,
            func.name()?.name(),
            flags.contains(Flags::EXPORT),
        ))
    });
    signatures.collect()
}

/// True if a sibling of the function declaration `statement` is an overload signature with the same name, exported the
/// same way.
fn is_overloaded_function<'a>(
    statement: Stmt<'a>,
    func: Func<'a>,
    is_exported: bool,
    cx: &mut Cx<'a, FuncStyle>,
) -> bool {
    let file = cx.file();
    let overloads = cx.state.overloads.get_or_insert_with(|| overloads(file));
    !overloads.is_empty()
        && func
            .name()
            .zip(statement_list_owner(statement))
            .is_some_and(|(name, owner)| overloads.contains(&(owner, name.name(), is_exported)))
}

impl FuncStyle {
    fn check_expression<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(func) = e.as_fn() else {
            return;
        };
        if func.is_arrow() && self.allow_arrow_functions {
            return;
        }
        let Node::VarDecl(declarator) = e.parent() else {
            return;
        };
        // For oxlint, parentheses are a node between the two.
        if cx.language().is_oxlint && e.is_parenthesized() {
            return;
        }
        let expects_declaration = match self.named_exports {
            Some(style) if declarator.flags().contains(Flags::EXPORT) => {
                style == Style::Declaration
            }
            _ => self.enforce_declarations,
        };
        if !expects_declaration || self.allow_type_annotation && declarator.ty().is_some() {
            return;
        }
        if func.is_arrow() {
            cx.state.candidates.push((func, declarator));
        } else {
            cx.report(declarator, DECLARATION);
        }
    }

    fn check_this_or_super<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // ESLint doesn't treat a static block or a property initializer as a function.
        let function = cx
            .state
            .functions
            .find(Node::Expr(e), |_, ancestor| match ancestor {
                Node::Func(func)
                    if matches!(
                        func.kind(),
                        FnKind::Decl
                            | FnKind::Expr
                            | FnKind::Arrow
                            | FnKind::Method
                            | FnKind::Getter
                            | FnKind::Setter
                            | FnKind::Constructor
                    ) =>
                {
                    Some(func)
                }
                _ => None,
            });
        if let Some(func) = function
            && func.is_arrow()
        {
            cx.state.with_this_or_super.insert(func);
        }
    }
}

impl Rule for FuncStyle {
    const META: Meta = Meta::eslint("func-style", Kind::Suggestion);
    const ON: On = On::new()
        .stmts(&[StmtTag::Fn])
        .exprs(&[ExprTag::Fn, ExprTag::This, ExprTag::Super])
        .finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(1);
        FuncStyle {
            enforce_declarations: options.str(0) == Some("declaration"),
            allow_arrow_functions: object.bool_or("allowArrowFunctions", false),
            allow_type_annotation: object.bool_or("allowTypeAnnotation", false),
            named_exports: match object.object("overrides").str("namedExports") {
                Some("declaration") => Some(Style::Declaration),
                Some("expression") => Some(Style::Expression),
                Some("ignore") => Some(Style::Ignore),
                _ => None,
            },
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if !self.enforce_declarations || self.named_exports == Some(Style::Expression) {
            on = on.stmts(&[StmtTag::Fn]);
        }
        if self.enforce_declarations || self.named_exports == Some(Style::Declaration) {
            on = on.exprs(&[ExprTag::Fn]);
            if !self.allow_arrow_functions {
                on = on.exprs(&[ExprTag::This, ExprTag::Super]);
                on = on.finish();
            }
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Fn => self.check_expression(e, cx),
            ExprTag::This | ExprTag::Super => self.check_this_or_super(e, cx),
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(func) = statement.as_fn() else {
            return;
        };
        let flags = func.flags();
        if !func.has_body() || flags.contains(Flags::DEFAULT) {
            return;
        }
        let is_exported = flags.contains(Flags::EXPORT);
        let expects_expression = match self.named_exports {
            Some(style) if is_exported => style == Style::Expression,
            _ => !self.enforce_declarations,
        };
        // oxlint skips a function that's declared more than once: merged with a namespace, interface or type of the
        // same name.
        let is_merged =
            cx.language().is_oxlint && func.symbol().is_some_and(|it| it.declaration_count() > 1);
        if expects_expression
            && !is_merged
            && !is_overloaded_function(statement, func, is_exported, cx)
        {
            cx.report(statement.span_without_export(), EXPRESSION)
                .called_with(func);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for (func, declarator) in &cx.state.candidates {
            if !cx.state.with_this_or_super.contains(*func) {
                cx.report(declarator, DECLARATION);
            }
        }
    }
}
