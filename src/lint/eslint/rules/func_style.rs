use super::complexity::{Climber, Step};
use bun_lint::prelude::*;
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
    /// The arrow functions that should be declarations, unless they use `this` or `super`, each
    /// with its declarator.
    candidates: Vec<(Func<'a>, VarDecl<'a>)>,
    /// The arrow functions that are the innermost function around a `this` or a `super`.
    with_this_or_super: FxHashSet<Func<'a>>,
    functions: Climber<'a, Option<Func<'a>>>,
    /// The overload signatures of the file, once a function declaration asks: what has the list of
    /// statements it is in, its name, and whether it is exported.
    overloads: Option<FxHashSet<(Node<'a>, Name<'a>, bool)>>,
}

/// What has the list of statements that `statement` is in. All clauses of a `switch` are one list.
fn statement_list_owner(statement: Stmt<'_>) -> Option<Node<'_>> {
    match statement.parent() {
        parent @ (Node::File(_) | Node::Func(_)) => Some(parent),
        Node::Case(case) => Some(case.parent()).filter(|it| it.as_stmt().is_some_and(|it| it.tag() == StmtTag::Switch)),
        Node::Stmt(parent) => {
            matches!(parent.kind(), StmtKind::Block(_) | StmtKind::Module(_)).then_some(Node::Stmt(parent))
        }
        _ => None,
    }
}

fn overloads<'a>(file: &'a File<'a>) -> FxHashSet<(Node<'a>, Name<'a>, bool)> {
    let signatures = file.stmts_of_kind(StmtTag::Fn).filter_map(|statement| {
        let StmtKind::Fn(func) = statement.kind() else {
            return None;
        };
        let flags = func.flags();
        if func.has_body() || flags.contains(Flags::EXPORT | Flags::DEFAULT) {
            return None;
        }
        Some((statement_list_owner(statement)?, func.name()?.name(), flags.contains(Flags::EXPORT)))
    });
    signatures.collect()
}

/// Whether one of the statements next to the function declaration `statement` is an overload
/// signature of the same name, exported in the same way.
fn is_overloaded_function<'a>(
    statement: Stmt<'a>,
    func: Func<'a>,
    is_exported: bool,
    cx: &mut Cx<'a, FuncStyle>,
) -> bool {
    let file = cx.file();
    let overloads = cx.state.overloads.get_or_insert_with(|| overloads(file));
    !overloads.is_empty()
        && func.name().zip(statement_list_owner(statement)).is_some_and(|(name, owner)| {
            overloads.contains(&(owner, name.name(), is_exported))
        })
}

impl FuncStyle {
    fn check_declaration<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Fn(func) = statement.kind() else {
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
        if expects_expression && !is_overloaded_function(statement, func, is_exported, cx) {
            cx.report(statement.span_without_export(), EXPRESSION);
        }
    }

    fn check_expression<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Fn(func) = e.kind() else {
            return;
        };
        if func.is_arrow() && self.allow_arrow_functions {
            return;
        }
        let Node::VarDecl(declarator) = e.parent() else {
            return;
        };
        let expects_declaration = match self.named_exports {
            Some(style) if declarator.flags().contains(Flags::EXPORT) => style == Style::Declaration,
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
        // A static block and the initializer of a property are not functions to ESLint.
        let (function, _) = cx.state.functions.climb(Node::Expr(e), None, |_, ancestor| match ancestor {
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
                Step::Stop(Some(func))
            }
            _ => Step::Pass,
        });
        if let Some(func) = function
            && func.is_arrow()
        {
            cx.state.with_this_or_super.insert(func);
        }
    }

    fn report_arrows<'a>(&self, cx: &mut Cx<'a, Self>) {
        for (func, declarator) in &cx.state.candidates {
            if !cx.state.with_this_or_super.contains(func) {
                cx.report(declarator, DECLARATION);
            }
        }
    }
}

impl Rule for FuncStyle {
    const META: Meta = Meta::eslint("func-style", Kind::Suggestion);
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        if !self.enforce_declarations || self.named_exports == Some(Style::Expression) {
            on.stmts([StmtTag::Fn], Self::check_declaration);
        }
        if self.enforce_declarations || self.named_exports == Some(Style::Declaration) {
            on.exprs([ExprTag::Fn], Self::check_expression);
            if !self.allow_arrow_functions {
                on.exprs([ExprTag::This, ExprTag::Super], Self::check_this_or_super);
                on.finish(Self::report_arrows);
            }
        }
        State::default()
    }
}
