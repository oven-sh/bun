use bun_lint::ast::walk::{Visitor, walk_node};
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ts_scope::{
    Ranges, SymbolSet, UsedMarks, Variable, VariableAnalysis, collect_variables, has_rest_sibling,
    is_defined_in_array_pattern, is_referenced_in_array_pattern, is_type_only_reference,
    is_used_global_variable,
};
use bun_lint::utils::ts_utils::is_definition_file;
use rustc_hash::FxHashMap;

/// Disallow unused variables.
pub struct NoUnusedVars {
    vars: Vars,
    args: Args,
    ignore_rest_siblings: bool,
    ignore_using_declarations: bool,
    checks_caught_errors: bool,
    ignore_class_with_static_init_block: bool,
    report_used_ignore_pattern: bool,
    autofixes_imports: bool,
    /// The options are an object.
    has_options_object: bool,
    /// An option of oxlint.
    reports_vars_only_used_as_types: bool,
    vars_ignore_pattern: Option<Pattern>,
    args_ignore_pattern: Option<Pattern>,
    caught_errors_ignore_pattern: Option<Pattern>,
    destructured_array_ignore_pattern: Option<Pattern>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Vars {
    All,
    Local,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Args {
    All,
    AfterUsed,
    None,
}

const REMOVE_UNUSED_IMPORT_DECLARATION: Message =
    Message::new("removeUnusedImportDeclaration", "Remove unused import declaration.");
const REMOVE_UNUSED_VAR: Message =
    Message::new("removeUnusedVar", "Remove unused variable \"{{varName}}\".");
const UNUSED_VAR: Message =
    Message::new("unusedVar", "'{{varName}}' is {{action}} but never used{{additional}}.");
const USED_IGNORED_VAR: Message = Message::new(
    "usedIgnoredVar",
    "'{{varName}}' is marked as ignored but is used{{additional}}.",
);
const USED_ONLY_AS_TYPE: Message = Message::new(
    "usedOnlyAsType",
    "'{{varName}}' is {{action}} but only used as a type{{additional}}.",
);

/// oxlint says nothing about the names in `/* global a */`.
fn oxlint_ignores_globals_in_comments(file: &File) -> bool {
    file.language().is_oxlint
}

/// With `vars: "local"`, what oxlint leaves alone is a `var` at the top of the file, of a module too.
fn oxlint_takes_for_global(variable: Variable, def: Declaration) -> bool {
    matches!(variable.scope().kind(), ScopeKind::Global | ScopeKind::Module)
        && matches!(def.node(), Some(Node::VarDecl(it)) if it.var_kind() == VarKind::Var)
}

/// oxlint prints a variable that is assigned to and never read where it is declared, and not at the last assignment.
fn oxlint_reports_the_declaration(file: &File) -> bool {
    file.language().is_oxlint
}

/// What is a use for oxlint 1.87 and not for typescript-eslint: `has_usages` of its rule, as far as values that are read go. It is
/// asked about the few variables that are about to be reported.
fn oxlint_counts_as_used(variable: Variable, reports_vars_only_used_as_types: bool) -> bool {
    let is_variable = variable.defs().any(|it| matches!(it, Declaration::Var(_) | Declaration::Param(_)));
    let is_function_or_class = variable.defs().any(|it| matches!(it, Declaration::Fn(_) | Declaration::Class(_)));
    let is_const = variable.defs().any(|it| matches!(it.node(), Some(Node::VarDecl(it)) if it.var_kind() == VarKind::Const));
    let is_callable = (is_variable || is_function_or_class) && !variable.defs().any(Declaration::is_catch_parameter);
    // A value and a type of one name are one symbol: `const A = 0; export type A = typeof A;`
    if matches!(variable.scope().kind(), ScopeKind::Global | ScopeKind::Module)
        && variable.defs().any(|it| matches!(it.node(), Some(Node::Stmt(it)) if it.is_exported()))
    {
        return true;
    }
    let mut walks = OxlintWalks::default();
    variable.references().any(|it| {
        if !it.is_value() {
            return !variable.defs().filter_map(Declaration::node).any(|node| node.span().contains(it.span()));
        }
        if is_type_only_reference(variable.symbol(), it) {
            return !reports_vars_only_used_as_types && oxlint_counts_type_query_as_use(variable, it);
        }
        it.is_read()
            && !(is_variable && oxlint_is_self_reassignment(variable, it, &mut walks))
            && !(is_variable && !is_const && !is_function_or_class && oxlint_is_discarded_read(variable, it, &mut walks))
            && !(is_callable && oxlint_is_self_call(variable, it, is_function_or_class, &mut walks))
    })
}

/// One of its declarations starts with `export`.
fn is_exported(variable: Variable) -> bool {
    let is_export = |owner: Node| matches!(owner, Node::Stmt(statement) if statement.is_exported());
    variable.defs().any(|def| match def {
        Declaration::Param(_) => false,
        def => def.node().is_some_and(|node| match node {
            Node::VarDecl(declaration) => is_export(declaration.parent()),
            Node::Func(func) => is_export(func.owner()),
            Node::Class(class) => is_export(class.owner()),
            node => is_export(node),
        }),
    })
}

/// The variables that are named somewhere.
#[derive(Default)]
struct Named(SymbolSet, bool);

impl<'a> Visitor<'a> for Named {
    fn enter(&mut self, node: Node<'a>) {
        if let Node::Expr(e) = node
            && e.tag() == ExprTag::Ident
            && let Some(symbol) = e.reference().and_then(Reference::symbol)
        {
            self.0.insert(symbol);
            self.1 = true;
        }
    }

    fn exit(&mut self, _: Node<'a>) {}
}

/// The variables that typescript-eslint takes for used and oxlint may not: what a logical assignment changes, as in
/// `a ||= 1;`, and what is named where a value is discarded, as in `(a, 0)`. `None` if there are none, as in most
/// files.
fn oxlint_may_be_unused_after_all<'a>(file: &'a File<'a>) -> Option<SymbolSet> {
    let mut named = Named::default();
    for e in file.exprs_of_kind(ExprTag::Assign) {
        if let ExprKind::Assign { op: Some(BinOp::And | BinOp::Or | BinOp::Nullish), target, .. } = e.kind() {
            named.enter(Node::Expr(target));
        }
    }
    let mut discarded: Vec<Expr<'a>> = (file.exprs_of_kind(ExprTag::Binary))
        .filter_map(|e| match e.kind() {
            ExprKind::Binary { op: BinOp::Comma, left, .. } => Some(left),
            _ => None,
        })
        .collect();
    // Each is looked into once: not the `a` of `a, b, c`, which is in the `a, b`.
    utils::sort::sort_unstable_by_key(&mut discarded, |it| (it.span().start, u32::MAX - it.span().end));
    let mut end = 0;
    for operand in discarded {
        if operand.span().end > end {
            end = operand.span().end;
            walk_node(Node::Expr(operand), &mut named);
        }
    }
    named.1.then_some(named.0)
}

/// typescript-eslint has what an `infer` declares in scope in all of the conditional type. For oxlint, as for
/// TypeScript, it is in scope where the condition holds: `type A<T> = B<T> extends { c: infer T } ? T : never` uses its
/// parameter. These are the variables that are used in that way.
fn oxlint_used_beside_infer<'a>(file: &'a File<'a>) -> SymbolSet {
    let mut used = SymbolSet::default();
    for symbol in file.symbols() {
        let Some(Declaration::TypeParam(param)) = symbol.declarations().next() else {
            continue;
        };
        let Node::Type(infer) = param.parent() else {
            continue;
        };
        if infer.tag() != TypeTag::Infer {
            continue;
        }
        let in_scope = Node::Type(infer).ancestors().find_map(|it| match it.as_type()?.kind() {
            TypeKind::Cond { extends, yes, .. } if extends.outer_span().contains(infer.span()) => {
                Some([extends.outer_span(), yes.outer_span()])
            }
            _ => None,
        });
        let (Some(in_scope), Some(around)) = (in_scope, symbol.scope().parent()) else {
            continue;
        };
        if symbol.references().any(|it| !in_scope.iter().any(|span| span.contains(it.span())))
            && let Some(outer) = around.resolve_name(symbol.name())
        {
            used.insert(outer);
        }
    }
    used
}

/// `typeof a` in a type, outside of what declares `a`. oxlint has an option for it, `reportVarsOnlyUsedAsTypes`, which is off.
fn oxlint_counts_type_query_as_use(variable: Variable, reference: Reference) -> bool {
    is_type_only_reference(variable.symbol(), reference)
        && reference.expr().is_some()
        && !oxlint_is_in_what_declares(variable, reference)
}

/// Whether `reference` is in the first declaration of `variable`, which for a parameter is the parameter.
fn oxlint_is_in_what_declares(variable: Variable, reference: Reference) -> bool {
    let declaration = match variable.defs().next() {
        Some(Declaration::Param(pat)) => Node::Pat(pat).ancestors().find(|it| matches!(it, Node::Param(_))),
        Some(def) => def.node(),
        None => None,
    };
    declaration.is_some_and(|it| it.span().contains(reference.span()))
}

/// What oxlint 1.87 says nothing about because of how it is declared: `should_skip_symbol`, `is_ignored` and
/// `is_allowed_*` of its rule, as far as typescript-eslint reports it. The first declaration counts.
fn oxlint_leaves_alone(variable: Variable) -> bool {
    let has_declare = |owner: Node| matches!(owner, Node::Stmt(it) if it.flags().contains(Flags::AMBIENT));
    let is_left_alone = match variable.defs().next() {
        Some(Declaration::Class(class)) => has_declare(class.owner()),
        Some(Declaration::Fn(function)) => !function.has_body() && has_declare(function.owner()),
        Some(Declaration::Module(module)) => has_declare(Node::Stmt(module.stmt())),
        // What JSX can stand for, in a file that can have JSX.
        Some(
            Declaration::ImportDefault(_)
            | Declaration::ImportNamespace(_)
            | Declaration::ImportSpec(_)
            | Declaration::ImportEquals(_),
        ) => {
            let file = variable.symbol().file();
            variable.name().is_any(&["React", "h"]) && (file.is_javascript() || file.path().ends_with(b".tsx"))
        }
        // The declarations of an interface that merge have to have the same type parameters.
        Some(Declaration::TypeParam(parameter)) => match parameter.parent() {
            Node::Stmt(interface) => interface.tag() == StmtTag::Interface && is_declared_module(interface.parent()),
            _ => false,
        },
        Some(Declaration::Param(pat)) => {
            let parameter = Node::Pat(pat).ancestors().find_map(|it| match it {
                Node::Param(parameter) => Some(parameter),
                _ => None,
            });
            parameter.filter(|it| !it.is_rest()).and_then(Param::func).is_some_and(|method| {
                matches!(method.owner(), Node::Member(it) if it.flags().contains(Flags::OVERRIDE))
            })
        }
        _ => false,
    };
    let is_global = |it: Scope| match it.node() {
        Node::Stmt(it) => matches!(it.kind(), StmtKind::Module(it) if matches!(it.name(), ModuleName::Global)),
        _ => false,
    };
    is_left_alone || variable.scope().chain().any(is_global)
}

/// For oxlint a property with a default value has siblings too: `const { a = 1, ...rest } = b`.
fn oxlint_has_rest_sibling(def: Declaration) -> bool {
    let (Declaration::Var(pat) | Declaration::Param(pat)) = def else {
        return false;
    };
    let Node::PatProp(property) = pat.parent() else {
        return false;
    };
    property.default().is_some()
        && matches!(property.parent(), Node::Pat(object) if matches!(
            object.kind(),
            PatKind::Object(properties) if properties.last().is_some_and(PatProp::is_rest)
        ))
}

fn is_member_expression(e: Expr) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index)
}

/// What is around `node` as oxc has it, without what it calls transparent: parentheses, which are no nodes here, and what only
/// concerns types. A function and a sequence are one node each.
fn oxlint_relevant_parents<'a>(node: Node<'a>) -> impl Iterator<Item = Node<'a>> {
    node.ancestors().filter(|it| match it {
        Node::Expr(e) => match e.kind() {
            ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) | ExprKind::Instantiation { .. } => false,
            ExprKind::Fn(_) | ExprKind::Class(_) => false,
            ExprKind::Binary { op: BinOp::Comma, .. } => {
                !matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::Binary { op: BinOp::Comma, left, .. } if left == *e))
            }
            _ => true,
        },
        _ => true,
    })
}

/// What the walks up from the references to one variable have found, for those that start far below: the operands of
/// `a = a + a + ..`.
#[derive(Default)]
struct OxlintWalks<'a> {
    /// The first node around a node that `oxlint_is_self_reassignment` looks at.
    looked_at: AncestorMemo<'a, Node<'a>>,
    /// `oxlint_outermost_operation`
    operations: AncestorMemo<'a, Node<'a>>,
    /// The outermost of the `a && b`, `a || b`, `a ?? b` that a node is an operand of without anything else in between.
    logical: AncestorMemo<'a, Node<'a>>,
    /// The functions and the classes that the variable is, if they are many.
    own_ranges: Option<Ranges>,
}

/// Whether `oxlint_is_self_reassignment` does nothing with `node`.
fn oxlint_is_passed_over(node: Node) -> bool {
    matches!(node, Node::Expr(e)
        if !matches!(
            e.kind(),
            ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Cond { .. }
                | ExprKind::Unary { .. }
                | ExprKind::Assign { .. }
                | ExprKind::Yield { .. }
        ) && !is_logical(node)
            && e.jsx_container_span().is_none())
}

fn is_logical(node: Node) -> bool {
    matches!(node, Node::Expr(e)
        if matches!(e.kind(), ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. }))
}

/// From the first to the last of the arguments.
fn arguments_span(call: Call) -> Option<Span> {
    Some(Span::new(call.args().first()?.outer_span().start, call.args().last()?.outer_span().end))
}

/// `node`, or the outermost of the `a + b`, `a * b`, .. that it is an operand of without anything else in between. The
/// walks that look at a node and the one around it do nothing with two of these.
fn oxlint_outermost_operation<'a>(node: Node<'a>, walks: &mut OxlintWalks<'a>) -> Node<'a> {
    let is_operation = |it: Node| {
        matches!(it, Node::Expr(e) if matches!(e.kind(), ExprKind::Binary { op, .. }
            if !matches!(
                op,
                BinOp::And
                    | BinOp::Or
                    | BinOp::Nullish
                    | BinOp::Lt
                    | BinOp::Le
                    | BinOp::Gt
                    | BinOp::Ge
                    | BinOp::In
                    | BinOp::Instanceof
                    | BinOp::Comma
            )))
    };
    walks.operations.find(node, |child, parent| (!is_operation(parent)).then_some(child)).unwrap_or(node)
}

fn refers_to<'a>(e: Expr<'a>, variable: Variable<'a>) -> bool {
    e.tag() == ExprTag::Ident && e.reference().and_then(Reference::symbol) == Some(variable.symbol())
}

/// oxlint's `is_self_reassignment`: what is read only serves to change the variable itself, as in `a++;` and `a = a + 1;`.
fn oxlint_is_self_reassignment<'a>(variable: Variable<'a>, reference: Reference<'a>, walks: &mut OxlintWalks<'a>) -> bool {
    let Some(e) = reference.expr() else {
        return false;
    };
    let at = e.span();
    if e.jsx_container_span().is_some() {
        return false;
    }
    let (mut is_used_by_others, mut saw_self_update) = (true, false);
    let mut inner = Node::Expr(e);
    while let Some(node) = walks.looked_at.find(inner, |_, it| (!oxlint_is_passed_over(it)).then_some(it)) {
        inner = node;
        match node {
            Node::VarDecl(_) => return false,
            Node::Member(member) if member.kind() == MemberKind::Property => return false,
            Node::Param(_) if saw_self_update => return oxlint_is_discarded_read(variable, reference, walks),
            Node::Expr(parent) => {
                match parent.kind() {
                    ExprKind::Call(call) if arguments_span(call).is_some_and(|it| it.contains(at)) => return false,
                    ExprKind::New(call)
                        if call.callee().outer_span().contains(at)
                            || arguments_span(call).is_some_and(|it| it.contains(at)) =>
                    {
                        return false;
                    }
                    ExprKind::Dot { .. } | ExprKind::Index { .. } => is_used_by_others = true,
                    ExprKind::Cond { test, .. } if test.span().contains(at) => is_used_by_others = true,
                    // The ones around it change nothing any more.
                    ExprKind::Binary { left, .. } if is_logical(node) && left.span().contains(at) => {
                        is_used_by_others = true;
                        let outermost = |child: Node<'a>, around: Node<'a>| (!is_logical(around)).then_some(child);
                        inner = walks.logical.find(node, outermost).unwrap_or(node);
                        if inner.as_expr().is_some_and(|it| it.jsx_container_span().is_some()) {
                            return false;
                        }
                    }
                    ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                        operand,
                    } => {
                        // `for (let x = 0; x++; ) {}`: that the body runs depends on it.
                        let head = oxlint_relevant_parents(node).find_map(Node::as_stmt).map(Stmt::kind);
                        let is_in_head = matches!(head, Some(StmtKind::For { test, update, .. })
                            if test.is_some_and(|it| it.span().contains(at)) || update.is_some_and(|it| it.span().contains(at)));
                        if !is_in_head && !is_member_expression(operand.skip_type_wrappers()) {
                            (is_used_by_others, saw_self_update) = (false, true);
                        }
                    }
                    ExprKind::Assign { target, .. } if !parent.is_assignment_target() => match target.tag() {
                        ExprTag::Ident if refers_to(target, variable) => {
                            // In another function, what is read can be seen later.
                            if reference.scope().variable_scope() != variable.scope().variable_scope() {
                                return false;
                            }
                            is_used_by_others = false;
                        }
                        ExprTag::Ident | ExprTag::Dot | ExprTag::Index => return false,
                        _ if target.operand().is_some_and(is_member_expression) => return false,
                        _ => {}
                    },
                    ExprKind::Yield { .. } => return false,
                    _ => {}
                }
                if parent.jsx_container_span().is_some() {
                    return false;
                }
            }
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::If { test, .. } | StmtKind::While { test, .. } | StmtKind::DoWhile { test, .. } if test.span().contains(at) => {
                    return false;
                }
                StmtKind::Switch { expr, .. } if expr.span().contains(at) => return false,
                StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } => break,
                StmtKind::Expr(_) => {
                    if oxlint_is_in_loop_body(statement) || oxlint_is_in_return_statement(statement) {
                        return false;
                    }
                    break;
                }
                // Whether it is returned by the function that the variable is.
                StmtKind::Return(_) => return oxlint_nearest_function(node, variable) == Some(variable.symbol()),
                _ => {}
            },
            Node::Case(case) if case.test().is_some_and(|it| it.span().contains(at)) => return false,
            Node::Func(func) if func.kind() == FnKind::Decl => break,
            Node::Func(func) if func.is_arrow() && matches!(func.body(), FnBody::Expr(_)) => return false,
            _ => {}
        }
    }
    !is_used_by_others
}

/// oxlint's `get_nearest_function`: the variable that the function around `node` is, or that it is the value of.
fn oxlint_nearest_function<'a>(node: Node<'a>, variable: Variable<'a>) -> Option<Symbol<'a>> {
    let (mut is_arrow, mut assigned, mut child) = (false, None, node);
    for parent in oxlint_relevant_parents(node) {
        match parent {
            Node::Func(func) if func.is_arrow() => is_arrow = true,
            Node::Func(func) => return func.symbol(),
            Node::VarDecl(declarator) if is_arrow => return declarator.pat().symbol(),
            Node::Expr(e) if is_arrow => match e.kind() {
                // What is assigned to the variable itself can go on to somewhere else.
                ExprKind::Assign { target, .. } if !e.is_assignment_target() => {
                    if !refers_to(target, variable) {
                        let name = target.reference().filter(|_| target.tag() == ExprTag::Ident);
                        return name.and_then(Reference::symbol);
                    }
                    assigned = Some(variable.symbol());
                }
                // An argument can be called later.
                ExprKind::Call(call) | ExprKind::New(call) if !call.callee().outer_span().contains(child.span()) => {
                    return None;
                }
                _ => {}
            },
            _ => {}
        }
        child = parent;
    }
    assigned
}

/// oxlint's `is_discarded_read`: it is in a sequence, and not in its last part.
fn oxlint_is_discarded_read<'a>(variable: Variable<'a>, reference: Reference<'a>, walks: &mut OxlintWalks<'a>) -> bool {
    let Some(e) = reference.expr() else {
        return false;
    };
    let at = e.span();
    let is_assignment = |it: Expr| it.skip_type_wrappers().tag() == ExprTag::Assign;
    let mut parent = oxlint_outermost_operation(Node::Expr(e), walks);
    for grandparent in oxlint_relevant_parents(parent) {
        let (inner, outer) = (std::mem::replace(&mut parent, grandparent), grandparent.as_expr().map(Expr::kind));
        let Node::Expr(inner) = inner else {
            // A function.
            if let Some(ExprKind::Binary { op: BinOp::Comma, right: last, .. }) = outer
                && !last.outer_span().contains(inner.span())
            {
                return true;
            }
            continue;
        };
        if matches!(outer, Some(ExprKind::Call(_) | ExprKind::New(_))) {
            if inner == e {
                continue;
            }
            break;
        }
        match (inner.kind(), outer) {
            (
                ExprKind::Dot { .. } | ExprKind::Index { .. },
                Some(ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    ..
                }),
            ) => break,
            (ExprKind::Assign { target, .. }, _) if !refers_to(target, variable) => break,
            (ExprKind::Cond { test, .. }, _) if test.span().contains(at) => return false,
            // Whether the right operand is evaluated depends on the left one.
            (ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, .. }, _)
                if left.span().contains(at) =>
            {
                return false;
            }
            (ExprKind::Dot { .. } | ExprKind::Index { .. }, _) => return false,
            (ExprKind::Binary { op, left, right }, _)
                if matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::In | BinOp::Instanceof)
                    && left.span().contains(at)
                    && is_assignment(right) =>
            {
                return false;
            }
            (kind, Some(ExprKind::Binary { op: BinOp::Comma, right: last, .. })) => {
                let is_kept = matches!(kind, ExprKind::Call(_) | ExprKind::Await(_) | ExprKind::Yield { .. }) || inner.is_chain_root();
                if !is_kept && !last.outer_span().contains(inner.span()) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// oxlint's `is_self_call`: it is in the function or the class that the variable is.
fn oxlint_is_self_call<'a>(
    variable: Variable<'a>,
    reference: Reference<'a>,
    is_function_or_class: bool,
    walks: &mut OxlintWalks<'a>,
) -> bool {
    if is_function_or_class {
        let mut own = variable.defs().filter_map(|it| match it {
            Declaration::Fn(func) => Some(func.estree_span()),
            Declaration::Class(class) => Some(class.estree_span()),
            _ => None,
        });
        // With few declarations it takes less to ask each of them.
        if variable.symbol().declaration_count() <= 8 {
            return own.any(|it| it.contains(reference.span()));
        }
        return walks.own_ranges.get_or_insert_with(|| Ranges::new(own)).contains_offset(reference.span().start);
    }
    let start = oxlint_outermost_operation(reference.node(), walks);
    let mut parents = oxlint_relevant_parents(start).peekable();
    let mut is_value_of_variable = false;
    while let Some(parent) = parents.next() {
        let is_function_expression = matches!(parent, Node::Func(func) if matches!(func.kind(), FnKind::Expr | FnKind::Arrow));
        // Whether what is around gives the value to something, and whether that is the variable.
        let (is_given, is_variable) = match parents.peek() {
            Some(Node::VarDecl(declarator)) => (true, declarator.pat().symbol() == Some(variable.symbol())),
            Some(Node::Expr(around)) => match around.kind() {
                ExprKind::Assign { target, .. } => (true, refers_to(target, variable)),
                ExprKind::Call(call) | ExprKind::New(call) => {
                    (!call.callee().outer_span().contains(parent.span()), false)
                }
                _ => (false, false),
            },
            _ => (false, false),
        };
        if is_value_of_variable && is_given && !is_variable {
            return false;
        }
        is_value_of_variable |= is_function_expression && is_variable;
    }
    is_value_of_variable
}

/// oxlint's `is_in_loop_body`: what a variable is in one turn of a loop, the next turn can see.
fn oxlint_is_in_loop_body(statement: Stmt) -> bool {
    let around = Node::Stmt(statement).ancestors().find(|it| match it {
        Node::Stmt(it) => it.is_loop(),
        Node::Func(_) | Node::File(_) => true,
        _ => false,
    });
    match around.and_then(Node::as_stmt).map(Stmt::kind) {
        Some(
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. },
        ) => body.span().contains(statement.span()),
        _ => false,
    }
}

/// oxlint's `is_in_return_statement`: it is at the top of a function that is part of what is returned. Declarations
/// other than those of variables are no statements for oxc.
fn oxlint_is_in_return_statement(statement: Stmt) -> bool {
    for node in Node::Stmt(statement).ancestors() {
        match node {
            Node::Stmt(it) if it.tag() == StmtTag::Return => return true,
            Node::Stmt(it)
                if matches!(
                    it.tag(),
                    StmtTag::Expr
                        | StmtTag::Fn
                        | StmtTag::Class
                        | StmtTag::Interface
                        | StmtTag::TypeAlias
                        | StmtTag::Enum
                        | StmtTag::Module
                ) => {}
            Node::Stmt(_) | Node::File(_) => return false,
            Node::Func(func) if func.is_arrow() && matches!(func.body(), FnBody::Expr(_)) => return true,
            _ => {}
        }
    }
    false
}

/// One of the `..IgnorePattern` options.
struct Pattern {
    regex: Regex,
    /// `String(regex)`
    text: String,
}

impl Pattern {
    fn new(options: Object, key: &str) -> Option<Pattern> {
        options.str(key).filter(|source| !source.is_empty())?;
        let regex = options.regex(key, "u")?;
        Some(Pattern {
            text: regex.to_string(),
            regex,
        })
    }

    fn test(&self, name: Name) -> bool {
        self.regex.test(name.bytes())
    }

    /// As it is in the configuration.
    fn source(&self) -> &str {
        self.text.strip_prefix('/').and_then(|it| it.strip_suffix("/u")).unwrap_or(&self.text)
    }
}

/// `pronoun_for_symbol` of oxlint: what it calls a variable, and several of them.
fn oxlint_pronoun_for_symbol(variable: Variable) -> (&'static str, &'static str) {
    static PRONOUNS: [(&str, &str); 9] = [
        ("Function", "functions"),
        ("Class", "classes"),
        ("Interface", "interfaces"),
        ("Type alias", "type aliases"),
        ("Enum", "enums"),
        ("Enum member", "enum members"),
        ("Type", "types"),
        ("Identifier", "identifiers"),
        ("Catch parameter", "caught errors"),
    ];
    let first = variable.defs().map(|def| match def {
        Declaration::Fn(_) => 0,
        Declaration::Class(_) => 1,
        Declaration::Interface(_) => 2,
        Declaration::TypeAlias(_) => 3,
        Declaration::Enum(_) => 4,
        Declaration::EnumMember(_) => 5,
        Declaration::ImportDefault(import) | Declaration::ImportNamespace(import) if import.is_type_only() => 6,
        Declaration::ImportSpec(specifier) if specifier.is_type_only() || specifier.import().is_type_only() => 6,
        Declaration::ImportDefault(_)
        | Declaration::ImportNamespace(_)
        | Declaration::ImportSpec(_)
        | Declaration::ImportEquals(_) => 7,
        _ if def.is_catch_parameter() => 8,
        _ => PRONOUNS.len(),
    });
    first.min().and_then(|it| PRONOUNS.get(it)).copied().unwrap_or(("Variable", "variables"))
}

/// What a message calls a variable, which decides the pattern that it names.
#[derive(Copy, Clone)]
enum VariableType {
    ArrayDestructure,
    CatchClause,
    Parameter,
    Variable,
}

pub struct State<'a> {
    is_definition_file: bool,
    /// That a node is in a `declare namespace`.
    declared: AncestorMemo<'a, ()>,
}

// ───────────────────────────── ambient declarations ─────────────────────────────

fn has_overriding_export_statement<'a>(body: List<'a, Stmt<'a>>) -> bool {
    body.iter().any(|statement| match statement.kind() {
        StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } | StmtKind::ExportAssign(_) => true,
        StmtKind::ExportDefault(declaration) => declaration.tag() == ExprTag::Ident,
        _ => false,
    })
}

/// Sets `variable.eslintUsed`, which other rules see as well: ESLint's own `no-unused-vars`.
fn mark_declaration_child_as_used(node: Stmt) {
    match node.kind() {
        // A `FunctionDeclaration` is not ambient, a `TSDeclareFunction` is.
        StmtKind::Fn(function) if function.has_body() => {}
        StmtKind::Fn(function) => function.symbol().into_iter().for_each(Symbol::mark_used),
        StmtKind::Class(class) => class.symbol().into_iter().for_each(Symbol::mark_used),
        StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::Var(_) => {
            Node::Stmt(node).declared_symbols().into_iter().for_each(Symbol::mark_used);
        }
        _ => {}
    }
}

/// Marks what the statements of a declaration file or of an ambient namespace declare, unless
/// something there says what is exported.
fn mark_ambient_declarations<'a>(body: List<'a, Stmt<'a>>) {
    if has_overriding_export_statement(body) {
        return;
    }
    for statement in body.iter().filter(|it| !it.is_exported()) {
        mark_declaration_child_as_used(statement);
    }
}

/// `TSModuleDeclaration[declare = true]`
fn is_declared_module(node: Node) -> bool {
    matches!(node, Node::Stmt(it) if it.tag() == StmtTag::Module && it.flags().contains(Flags::AMBIENT))
}

// ───────────────────────────── definitions and references ─────────────────────────────

/// `def.name.type === AST_NODE_TYPES.Identifier`
fn is_named_by_identifier(def: Declaration) -> bool {
    match def {
        Declaration::EnumMember(member) => matches!(member.key().map(Key::kind), Some(KeyKind::Ident(_))),
        _ => true,
    }
}

/// The function, if `isFunction(def.name.parent)`: the name is all of one of its parameters. For oxlint it can have a
/// default value.
fn function_of_plain_parameter(def: Declaration<'_>, is_oxlint: bool) -> Option<Func<'_>> {
    let Declaration::Param(pat) = def else {
        return None;
    };
    let Node::Param(param) = pat.parent() else {
        return None;
    };
    if param.is_rest() || param.default().is_some() && !is_oxlint || param.is_parameter_property() {
        return None;
    }
    param.func().filter(|function| function.has_body())
}

/// Whether `pat` is where the parameter `symbol` is written first: `function (a, b, a) {}`
fn is_first_parameter_named<'a>(symbol: Symbol<'a>, pat: Pat<'a>) -> bool {
    let first = symbol.declarations().find_map(|def| match def {
        Declaration::Param(it) => Some(it),
        _ => None,
    });
    first == Some(pat)
}

/// Where the last parameter of `function` that is used starts. 0 if none is used.
fn last_used_arg<'a>(function: Func<'a>, is_used: impl Fn(Symbol<'a>) -> bool) -> u32 {
    let mut last = 0;
    for param in function.params().iter() {
        param.pat().for_each_binding(&mut |pat| {
            if let Some(it) = pat.symbol()
                && is_used(it)
                && is_first_parameter_named(it, pat)
            {
                last = pat.span().start;
            }
        });
    }
    last
}

// ───────────────────────────── fixes ─────────────────────────────

/// What removes an unused import.
#[derive(Copy, Clone)]
enum ImportFix<'a> {
    /// All of the `ImportDeclaration` or the `TSImportEqualsDeclaration`.
    Declaration(Span),
    /// `import Unused, { Used } from 'module'`
    Default(Import<'a>),
    /// One of several specifiers, of which some are used.
    Specifier(ImportSpec<'a>),
}

/// `getDeclaredVariables(declaration)`, from the last to the first: they are reported from the first
/// to the last, so one that has not been reported is found at once.
fn imported_variables<'a>(declaration: Import<'a>) -> impl Iterator<Item = Symbol<'a>> {
    let scope = Node::Stmt(declaration.stmt()).scope();
    let named = declaration.named().iter().map(|specifier| specifier.local());
    let locals = declaration.default().into_iter().chain(declaration.namespace()).chain(named);
    locals.rev().filter_map(move |local| scope.get_name(local.name()))
}

fn are_all_specifiers_unused(declaration: Import, reported: &SymbolSet) -> bool {
    imported_variables(declaration).all(|it| reported.contains(it))
}

fn get_import_fixer<'a>(variable: Variable<'a>, reported: &SymbolSet) -> Option<ImportFix<'a>> {
    let mut defs = variable.defs();
    let def = defs.next()?;
    // All of several definitions would have to be removed.
    if defs.next().is_some() {
        return None;
    }
    let is_removed_entirely = |declaration: Import<'a>| {
        let specifiers = usize::from(declaration.default().is_some())
            + usize::from(declaration.namespace().is_some())
            + declaration.named().len();
        specifiers == 1 || are_all_specifiers_unused(declaration, reported)
    };
    Some(match def {
        Declaration::ImportEquals(declaration) => {
            ImportFix::Declaration(declaration.stmt().span_without_export())
        }
        Declaration::ImportNamespace(declaration) => ImportFix::Declaration(declaration.span()),
        Declaration::ImportDefault(declaration) if is_removed_entirely(declaration) => {
            ImportFix::Declaration(declaration.span())
        }
        Declaration::ImportDefault(declaration) => ImportFix::Default(declaration),
        Declaration::ImportSpec(specifier) if is_removed_entirely(specifier.import()) => {
            ImportFix::Declaration(specifier.import().span())
        }
        Declaration::ImportSpec(specifier) => ImportFix::Specifier(specifier),
        _ => return None,
    })
}

/// Removes `node`, with its lines if there is nothing else on them.
fn remove_node_with_trailing_newline(fixer: Fixer, node: Span) -> Fix {
    let file = fixer.file();
    let end_line = file.line_of(node.end);
    let line_range_start = file.line_span(file.line_of(node.start)).start;
    let line_range_end = match end_line < file.line_count() {
        true => file.line_span(end_line + 1).start,
        false => file.span().end,
    };
    let lines = Span::new(line_range_start, line_range_end);
    match file.slice(node) == text::trim(file.slice(lines)) {
        true => fixer.remove(lines),
        false => fixer.remove(node),
    }
}

/// Removes `node` and the `comma` next to it.
fn remove_with_comma(fixer: Fixer, node: Span, comma: Token) -> Fix {
    fixer.remove(Span::new(node.start.min(comma.start()), node.end.max(comma.end())))
}

fn fix_import_specifier<'a>(
    fixer: Fixer<'a>,
    specifier: ImportSpec<'a>,
    reported: &SymbolSet,
) -> Option<Fix> {
    let file = fixer.file();
    let declaration = specifier.import().stmt();
    let is_used_named_specifier = |it: Symbol<'a>| {
        !reported.contains(it) && matches!(it.declarations().next(), Some(Declaration::ImportSpec(_)))
    };
    if !imported_variables(specifier.import()).any(is_used_named_specifier) {
        // `import Used, { Unused } from 'module'`: from the `,` to the `}`.
        let left_curly = file.tokens_in(declaration).find(|token| token.is_punctuator("{"))?;
        let left_token = file.token_before(left_curly).filter(|token| token.is_punctuator(","))?;
        let right_token = file.tokens_in(declaration).find(|token| token.is_punctuator("}"))?;
        return Some(fixer.remove(Span::new(left_token.start(), right_token.end())));
    }
    // The `,` before it makes for the nicer result. The first specifier has none.
    let node = specifier.span();
    let comma = file
        .token_before(node)
        .filter(|token| token.is_punctuator(","))
        .or_else(|| file.token_after(node).filter(|token| token.is_punctuator(",")))?;
    Some(remove_with_comma(fixer, node, comma))
}

fn fix_import<'a>(fixer: Fixer<'a>, fix: ImportFix<'a>, reported: &SymbolSet) -> Option<Fix> {
    match fix {
        ImportFix::Declaration(node) => Some(remove_node_with_trailing_newline(fixer, node)),
        ImportFix::Default(declaration) => {
            let node = declaration.default()?.span();
            let comma = fixer.file().token_after(node).filter(|token| token.is_punctuator(","))?;
            Some(remove_with_comma(fixer, node, comma))
        }
        ImportFix::Specifier(specifier) => fix_import_specifier(fixer, specifier, reported),
    }
}

// ───────────────────────────── the rule ─────────────────────────────

impl NoUnusedVars {
    /// Unless its options are an object, oxlint takes `^_` for `varsIgnorePattern` and `argsIgnorePattern`.
    fn oxlint_ignores_underscore_by_default(&self, file: &File) -> bool {
        file.language().is_oxlint && !self.has_options_object
    }

    fn def_to_variable_type(&self, def: Declaration) -> VariableType {
        if self.destructured_array_ignore_pattern.is_some() && is_defined_in_array_pattern(def) {
            return VariableType::ArrayDestructure;
        }
        match def.kind() {
            Some(DeclarationKind::CatchClause) => VariableType::CatchClause,
            Some(DeclarationKind::Parameter) => VariableType::Parameter,
            _ => VariableType::Variable,
        }
    }

    fn get_variable_description(&self, variable_type: VariableType) -> (Option<&Pattern>, &'static str) {
        match variable_type {
            VariableType::ArrayDestructure => {
                (self.destructured_array_ignore_pattern.as_ref(), "elements of array destructuring")
            }
            VariableType::CatchClause => (self.caught_errors_ignore_pattern.as_ref(), "caught errors"),
            VariableType::Parameter => (self.args_ignore_pattern.as_ref(), "args"),
            VariableType::Variable => (self.vars_ignore_pattern.as_ref(), "vars"),
        }
    }

    /// The `additional` of `getDefinedMessageData` and `getAssignedMessageData`.
    fn get_unused_message_data(&self, unused_var: Variable) -> String {
        let Some(def) = unused_var.defs().next() else {
            return String::new();
        };
        match self.get_variable_description(self.def_to_variable_type(def)) {
            (Some(pattern), description) => {
                format!(". Allowed unused {description} must match {}", pattern.text)
            }
            _ => String::new(),
        }
    }

    /// The `additional` of `getUsedIgnoredMessageData`.
    fn get_used_ignored_message_data(&self, variable_type: VariableType) -> String {
        match self.get_variable_description(variable_type) {
            (Some(pattern), description) => {
                format!(". Used {description} must not match {}", pattern.text)
            }
            _ => String::new(),
        }
    }

    /// How a message of oxlint ends: what unused `plural` are to be called. `has_default`: without options it is `^_`.
    fn oxlint_hint(&self, pattern: Option<&Pattern>, has_default: bool, plural: &str) -> String {
        match pattern.map(Pattern::source) {
            None if !has_default || self.has_options_object => String::new(),
            None | Some("^_") => format!(" Unused {plural} should start with a '_'."),
            Some(source) => format!(" Unused {plural} should match /{source}/."),
        }
    }

    /// What oxlint says about `variable` where typescript-eslint says `message`.
    fn oxlint_text(&self, variable: Variable, message: Message) -> Vec<u8> {
        let name = variable.name().bytes();
        let (pronoun, plural) = oxlint_pronoun_for_symbol(variable);
        let says = |what: &str, hint: &str| {
            [pronoun.as_bytes(), b" '", name, b"' is ", what.as_bytes(), b".", hint.as_bytes()].concat()
        };
        if message.id == USED_IGNORED_VAR.id {
            return says("marked as ignored but is used", "");
        }
        let is_only_used_as_type = message.id == USED_ONLY_AS_TYPE.id;
        let hint_for_vars = || self.oxlint_hint(self.vars_ignore_pattern.as_ref(), true, plural);
        match variable.defs().next() {
            Some(Declaration::ImportDefault(_) | Declaration::ImportNamespace(_) | Declaration::ImportSpec(_)) => {
                says("imported but never used", "")
            }
            Some(Declaration::Param(_)) => {
                let is_default = self.args_ignore_pattern.is_none() && !self.has_options_object;
                let hint = match is_default && name == b"_" {
                    true => String::new(),
                    false => self.oxlint_hint(self.args_ignore_pattern.as_ref(), true, "parameters"),
                };
                let what: &[u8] = match is_only_used_as_type {
                    true => b"' is declared but only used as a type.",
                    false => b"' is declared but never used.",
                };
                [&b"Parameter '"[..], name, what, hint.as_bytes()].concat()
            }
            Some(def @ Declaration::Var(_)) if def.is_catch_parameter() => {
                says("caught but never used", &self.oxlint_hint(self.caught_errors_ignore_pattern.as_ref(), false, plural))
            }
            Some(Declaration::Var(_)) if variable.references().any(|it| it.is_write() && !it.is_init()) => {
                says("assigned a value but never used", &hint_for_vars())
            }
            Some(Declaration::Var(_)) if is_only_used_as_type => {
                [pronoun.as_bytes(), b" is declared but only used as a type.", hint_for_vars().as_bytes()].concat()
            }
            Some(Declaration::Var(_) | Declaration::TypeParam(_)) => says("declared but never used", &hint_for_vars()),
            _ => says("declared but never used", ""),
        }
    }

    fn report<'a>(
        &self,
        cx: &Cx<'a, Self>,
        reported: &mut SymbolSet,
        unused_var: Variable<'a>,
        message: Message,
        (action, additional): (&'static str, String),
    ) {
        reported.insert(unused_var.symbol());
        let reported = &*reported;

        // The last assignment in the function that declares the variable, or the first declaration.
        let scope = unused_var.scope().variable_scope();
        let last_write = unused_var
            .references()
            .filter(|it| it.is_write() && it.scope().variable_scope() == scope && !oxlint_reports_the_declaration(cx.file()))
            .last();
        let id = match last_write {
            Some(reference) => Some(reference.span()),
            None => unused_var.defs().next().and_then(Declaration::name_span),
        };
        let Some(id) = id else {
            return;
        };
        let name = unused_var.name();
        // As many columns as the name is long, however it is written.
        let start = cx.position(id.start);
        let end = Position {
            line: start.line,
            column: start.column + text::utf16_len(name.bytes()),
        };
        let is_oxlint = cx.language().is_oxlint;
        let mut report = cx
            .report(id, if is_oxlint { Message::new(message.id, "{{text}}") } else { message })
            .end_at(end)
            .data("varName", name)
            .data("action", action)
            .data("additional", additional);
        if is_oxlint {
            report = report.data("text", self.oxlint_text(unused_var, message));
        }
        let Some(fix) = get_import_fixer(unused_var, reported) else {
            return;
        };
        if self.autofixes_imports {
            report.fix(|fixer| fix_import(fixer, fix, reported));
            return;
        }
        let suggestion = match fix {
            ImportFix::Declaration(_) => REMOVE_UNUSED_IMPORT_DECLARATION,
            ImportFix::Default(_) | ImportFix::Specifier(_) => REMOVE_UNUSED_VAR,
        };
        report.suggest_with(suggestion, &[("varName", name.bytes())], |fixer| {
            fix_import(fixer, fix, reported)
        });
    }

    fn has_rest_spread_sibling(&self, variable: Variable) -> bool {
        self.ignore_rest_siblings
            && (variable.defs().any(|def| match def {
                Declaration::Var(pat) | Declaration::Param(pat) => has_rest_sibling(Node::Pat(pat)),
                _ => false,
            }) || variable.references().any(|reference| has_rest_sibling(reference.node())))
    }

    /// One turn of the loop of upstream's `collectUnusedVariables`: whether `variable` is to be
    /// reported as unused. One that is used in spite of its name is reported here.
    fn is_unused_variable<'a>(
        &self,
        cx: &Cx<'a, Self>,
        (analysis, unused_for_oxlint): (&VariableAnalysis<'a>, &SymbolSet),
        (reported, last_used_args): (&mut SymbolSet, &mut FxHashMap<Func<'a>, u32>),
        (used, variable): (bool, Variable<'a>),
    ) -> bool {
        let Some(def) = variable.defs().next() else {
            return false;
        };
        let is_oxlint = cx.file().language().is_oxlint;
        let is_global = match is_oxlint {
            true => oxlint_takes_for_global(variable, def),
            false => variable.scope().kind() == ScopeKind::Global,
        };
        if self.vars == Vars::Local && is_global {
            return false;
        }
        let name = variable.name();
        let ignores_underscore = self.oxlint_ignores_underscore_by_default(cx.file());
        let is_ignored = |pattern: &Option<Pattern>| {
            // A parameter that is called `_` is not ignored.
            let is_underscore_ignored = ignores_underscore
                && name.bytes().starts_with(b"_")
                && (std::ptr::eq(pattern, &raw const self.vars_ignore_pattern) || std::ptr::eq(pattern, &raw const self.args_ignore_pattern) && !name.is("_"));
            is_named_by_identifier(def) && (is_underscore_ignored || pattern.as_ref().is_some_and(|it| it.test(name)))
        };
        let mut report_if_used = |variable_type: VariableType| {
            if self.report_used_ignore_pattern && used {
                let additional = self.get_used_ignored_message_data(variable_type);
                self.report(cx, reported, variable, USED_IGNORED_VAR, ("", additional));
            }
        };

        if is_ignored(&self.destructured_array_ignore_pattern)
            && (is_defined_in_array_pattern(def) || variable.references().any(is_referenced_in_array_pattern))
        {
            report_if_used(VariableType::ArrayDestructure);
            return false;
        }

        if self.ignore_class_with_static_init_block
            && let Declaration::Class(class) = def
            && class.members().iter().any(|member| member.kind() == MemberKind::StaticBlock)
        {
            return false;
        }

        match def.kind() {
            Some(DeclarationKind::CatchClause) => {
                if !self.checks_caught_errors {
                    return false;
                }
                if is_ignored(&self.caught_errors_ignore_pattern) {
                    report_if_used(VariableType::CatchClause);
                    return false;
                }
            }
            Some(DeclarationKind::Parameter) => {
                if self.args == Args::None {
                    return false;
                }
                if is_ignored(&self.args_ignore_pattern) {
                    report_if_used(VariableType::Parameter);
                    return false;
                }
                // Upstream's `isAfterLastUsedArg`.
                if self.args == Args::AfterUsed
                    && let Some(function) = function_of_plain_parameter(def, is_oxlint)
                    && let Declaration::Param(pat) = def
                    && pat.span().start
                        < *(last_used_args.entry(function)).or_insert_with(|| {
                            // Upstream takes every reference for a use, also the default value. oxlint does not.
                            last_used_arg(function, |it| match (is_oxlint, Variable::new(it)) {
                                (true, it) if unused_for_oxlint.contains(it.symbol()) => false,
                                (true, it) => {
                                    !analysis.is_unused(it.symbol())
                                        || oxlint_counts_as_used(it, self.reports_vars_only_used_as_types)
                                }
                                (false, it) => it.references().next().is_some() || analysis.is_eslint_used(it),
                            })
                        })
                {
                    return false;
                }
            }
            kind => {
                if is_ignored(&self.vars_ignore_pattern) {
                    // The members of an enum always count as used, whether they are or not.
                    if kind != Some(DeclarationKind::TsEnumMember) {
                        report_if_used(VariableType::Variable);
                    }
                    return false;
                }
            }
        }

        if self.ignore_using_declarations
            && def.kind() == Some(DeclarationKind::Variable)
            && matches!(
                def.node(),
                Some(Node::VarDecl(it)) if matches!(it.var_kind(), VarKind::Using | VarKind::AwaitUsing)
            )
        {
            return false;
        }

        !used
            && !self.has_rest_spread_sibling(variable)
            && !(is_oxlint && self.ignore_rest_siblings && variable.defs().any(oxlint_has_rest_sibling))
            && !analysis.is_eslint_used(variable)
    }

    fn check_module<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Module(module) = node.kind() else {
            return;
        };
        if cx.state.is_definition_file
            || is_declared_module(Node::Stmt(node))
            || (cx.state.declared.find(Node::Stmt(node), |_, it| is_declared_module(it).then_some(()))).is_some()
        {
            mark_ambient_declarations(module.innermost().body());
        }
    }

    /// Reports the names in `/* global a, b */` comments that nothing refers to.
    fn check_globals_in_comments<'a>(cx: &Cx<'a, Self>) {
        let file = cx.file();
        for it in file.globals_in_comments() {
            let name: &'a [u8] = &it.name;
            let Some(variable) = file.global(name) else {
                continue;
            };
            let Some(&directive_comment) = variable.comments.first() else {
                continue;
            };
            // What a script declares as well has definitions, and is checked as that.
            if variable.is_in_lib
                || variable.is_exported
                || file.scope().get_bytes(name).is_some()
                || is_used_global_variable(file, name)
            {
                continue;
            }
            cx.report(file.name_in_global_comment(directive_comment, name), UNUSED_VAR)
                .data("varName", name)
                .data("action", "defined")
                .data("additional", "");
        }
    }

    fn check_program<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let analysis = collect_variables(file, UsedMarks::default());
        // Upstream's `collectVariables` sets `variable.eslintUsed`, for the rules that end after this one.
        for variable in analysis.used_variables() {
            if variable.class_scope().is_none() && analysis.is_eslint_used(*variable) {
                variable.symbol().mark_used();
            }
        }

        let mut reported = SymbolSet::default();
        let used_variables: &[Variable<'a>] = match self.report_used_ignore_pattern {
            true => analysis.used_variables(),
            false => &[],
        };
        // What is unused for oxlint only.
        let candidates = if file.language().is_oxlint { oxlint_may_be_unused_after_all(file) } else { None };
        let is_added = |it: &Variable<'a>| {
            candidates.as_ref().is_some_and(|candidates| candidates.contains(it.symbol()))
                && it.class_scope().is_none()
                && !analysis.is_eslint_used(*it)
                && !is_exported(*it)
                && !oxlint_counts_as_used(*it, self.reports_vars_only_used_as_types)
        };
        let added: Vec<Variable<'a>> = match &candidates {
            Some(_) => analysis.used_variables().iter().copied().filter(is_added).collect(),
            None => Vec::new(),
        };
        let mut unused_for_oxlint = SymbolSet::default();
        for variable in &added {
            unused_for_oxlint.insert(variable.symbol());
        }
        let used_variables = used_variables.iter().filter(|it| !unused_for_oxlint.contains(it.symbol()));
        let variables = (analysis.unused_variables().iter().chain(&added).map(|it| (false, *it)))
            .chain(used_variables.map(|it| (true, *it)));
        let mut unused_vars = Vec::new();
        let mut last_used_args = FxHashMap::default();
        for variable in variables {
            let seen = (&analysis, &unused_for_oxlint);
            if self.is_unused_variable(cx, seen, (&mut reported, &mut last_used_args), variable) {
                unused_vars.push(variable.1);
            }
        }

        let mut used_beside_infer = None;
        for unused_var in unused_vars {
            if file.language().is_oxlint
                && (oxlint_leaves_alone(unused_var)
                    || oxlint_counts_as_used(unused_var, self.reports_vars_only_used_as_types)
                    || unused_var.defs().any(|it| matches!(it, Declaration::TypeParam(_)))
                        && (used_beside_infer.get_or_insert_with(|| oxlint_used_beside_infer(file)))
                            .contains(unused_var.symbol()))
            {
                continue;
            }
            let used_only_as_type =
                unused_var.references().any(|it| is_type_only_reference(unused_var.symbol(), it));
            if used_only_as_type
                && unused_var.defs().any(|def| def.kind() == Some(DeclarationKind::ImportBinding))
            {
                continue;
            }
            let action = match unused_var.references().any(Reference::is_write) {
                true => "assigned a value",
                false => "defined",
            };
            let message = if used_only_as_type { USED_ONLY_AS_TYPE } else { UNUSED_VAR };
            let additional = self.get_unused_message_data(unused_var);
            self.report(cx, &mut reported, unused_var, message, (action, additional));
        }

        if !oxlint_ignores_globals_in_comments(file) {
            Self::check_globals_in_comments(cx);
        }
    }
}

impl Rule for NoUnusedVars {
    const META: Meta = Meta::typescript("no-unused-vars", Kind::Problem)
        .fixable(Fixable::Code)
        .has_suggestions()
        .recommended()
        .extends_base_rule("no-unused-vars");
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoUnusedVars {
            vars: match options.str(0).or_else(|| object.str("vars")) {
                Some("local") => Vars::Local,
                _ => Vars::All,
            },
            args: match object.str("args") {
                Some("all") => Args::All,
                Some("none") => Args::None,
                _ => Args::AfterUsed,
            },
            ignore_rest_siblings: object.bool_or("ignoreRestSiblings", false),
            ignore_using_declarations: object.bool_or("ignoreUsingDeclarations", false),
            checks_caught_errors: object.str("caughtErrors") != Some("none"),
            ignore_class_with_static_init_block: object.bool_or("ignoreClassWithStaticInitBlock", false),
            report_used_ignore_pattern: object.bool_or("reportUsedIgnorePattern", false),
            autofixes_imports: object.object("enableAutofixRemoval").bool_or("imports", false),
            has_options_object: options.get(0).is_some_and(|it| it.as_object().is_some()),
            reports_vars_only_used_as_types: object.bool_or("reportVarsOnlyUsedAsTypes", false),
            vars_ignore_pattern: Pattern::new(object, "varsIgnorePattern"),
            args_ignore_pattern: Pattern::new(object, "argsIgnorePattern"),
            caught_errors_ignore_pattern: Pattern::new(object, "caughtErrorsIgnorePattern"),
            destructured_array_ignore_pattern: Pattern::new(object, "destructuredArrayIgnorePattern"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        on.stmts([StmtTag::Module], Self::check_module);
        on.finish(Self::check_program);
        let is_definition_file = is_definition_file(file.path());
        if is_definition_file {
            mark_ambient_declarations(file.body());
        }
        State {
            is_definition_file,
            declared: AncestorMemo::default(),
        }
    }
}
