use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashSet;

/// Prefer `Set#has()` over `Array#includes()` when checking for existence or non-existence.
pub struct PreferSetHas;

const PREFER_SET_HAS: Message =
    Message::new("", "should be a `Set`, and use `.has()` to check existence or non-existence.");

const ARRAY_METHODS_RETURNS_ARRAY: [&str; 15] = [
    "concat",
    "copyWithin",
    "fill",
    "filter",
    "flat",
    "flatMap",
    "map",
    "reverse",
    "slice",
    "sort",
    "splice",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
];

#[derive(Default)]
pub struct State<'a> {
    /// The names under which the module exports something, once that is asked.
    exported_bindings: Option<FxHashSet<Name<'a>>>,
    nearest_loop_or_function: AncestorMemo<'a, Node<'a>>,
}

impl Rule for PreferSetHas {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-set-has", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        PreferSetHas
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.mentions("includes") {
            on.var_decls(check);
        }
        State::default()
    }
}

fn is_kind_of_array_expr(e: Expr) -> bool {
    if e.is_parenthesized() || e.is_chain_root() {
        return false;
    }
    match e.kind() {
        ExprKind::Array(_) => true,
        ExprKind::New(new) => get_inner_expression(new.callee()).is_ident("Array"),
        ExprKind::Call(call) => match get_member_expr(call.callee()) {
            None => call.callee().is_ident("Array") && !call.callee().is_parenthesized(),
            Some(callee) => {
                callee.tag() == ExprTag::Dot
                    && !callee.is_optional()
                    && static_property_name(callee).is_some_and(|name| {
                        name.is_any(&ARRAY_METHODS_RETURNS_ARRAY)
                            || name.is_any(&["of", "from"])
                                && callee.object().is_some_and(|it| get_inner_expression(it).is_ident("Array"))
                    })
            }
        },
        _ => false,
    }
}

/// The `includes` of `name.includes(a)`, if that is what the reference to `name` is in.
fn includes_of_call<'a>(reference: Reference<'a>, name: Name<'a>) -> Option<Ident<'a>> {
    let ident = reference.expr().filter(|it| !it.is_parenthesized())?;
    let member = ident.parent().as_expr().filter(|it| !it.is_parenthesized() && !it.is_private_member())?;
    let ExprKind::Dot { name: property, chain, .. } = member.kind() else {
        return None;
    };
    let call = member.parent().as_expr()?.as_call()?;
    let callee = get_member_expr(call.callee())?;
    let is_includes_call = chain != Chain::Start
        && call.args().len() == 1
        && !call.is_optional()
        && call.args().first()?.tag() != ExprTag::Spread
        && get_inner_expression(callee.object()?).as_ident() == Some(name)
        && static_property_name(callee)?.is("includes");
    is_includes_call.then_some(property)
}

/// The names of `ModuleRecord::exported_bindings`.
fn exported_bindings<'a>(file: &'a File<'a>) -> FxHashSet<Name<'a>> {
    let mut names = FxHashSet::default();
    for stmt in file.body() {
        match stmt.kind() {
            StmtKind::ExportNamed(export) => names.extend(export.items().iter().map(|it| it.exported().name())),
            StmtKind::ExportStar { alias, .. } => names.extend(alias.map(Ident::name)),
            _ if !stmt.is_exported() || stmt.is_default_export() => {}
            StmtKind::Var(declarations) => {
                for declaration in declarations {
                    declaration.pat().for_each_binding(&mut |it| names.extend(it.as_ident()));
                }
            }
            StmtKind::Fn(func) => names.extend(func.name().map(Ident::name)),
            StmtKind::Class(class) => names.extend(class.name().map(Ident::name)),
            _ => {}
        }
    }
    names
}

fn check<'a>(_: &PreferSetHas, declarator: VarDecl<'a>, cx: &mut Cx<'a, PreferSetHas>) {
    let Some(init) = declarator.init().filter(|it| is_kind_of_array_expr(*it)) else {
        return;
    };
    let Some(name) = declarator.pat().as_ident().filter(|_| declarator.var_kind() != VarKind::Var) else {
        return;
    };
    let Some(symbol) = declarator.pat().symbol() else {
        return;
    };
    // The name in the declaration is no reference for oxlint.
    let references = || symbol.references().filter(|it| !matches!(it.node(), Node::Pat(_)));
    if !references().all(|it| includes_of_call(it, name).is_some()) {
        return;
    }
    let mut first_two = references();
    match (first_two.next(), first_two.next()) {
        (None, _) => return,
        (Some(_), Some(_)) => {}
        // Whether it is evaluated several times for one evaluation of the declaration.
        (Some(only), None) => {
            let repeated = cx.state.nearest_loop_or_function.find(only.node(), |_, parent| match parent {
                Node::Stmt(stmt) if stmt.is_loop() => Some(parent),
                Node::Func(func) if func.kind() != FnKind::StaticBlock => Some(parent),
                _ => None,
            });
            let root = symbol.scope();
            if !repeated.is_some_and(|it| it != root.node() && root.span().contains(it.span())) {
                return;
            }
        }
    }
    let file = cx.file();
    if cx.state.exported_bindings.get_or_insert_with(|| exported_bindings(file)).contains(&name) {
        return;
    }
    cx.report(declarator, PREFER_SET_HAS).fix(|fixer| {
        let span = init.span();
        let last = Span::new(span.end.saturating_sub(1), span.end);
        let mut fixes = match init.kind() {
            // `new Array(`
            ExprKind::New(_) => {
                vec![fixer.replace(Span::new(span.start + 4, span.start + 10), "Set(["), fixer.replace(last, "])")]
            }
            // `Array(`
            ExprKind::Call(call) if call.callee().tag() == ExprTag::Ident => {
                vec![fixer.replace(Span::new(span.start, span.start + 6), "new Set(["), fixer.replace(last, "])")]
            }
            _ => vec![fixer.insert_before(span, "new Set("), fixer.insert_after(span, ")")],
        };
        fixes.extend(references().filter_map(|it| Some(fixer.replace(includes_of_call(it, name)?, "has"))));
        fixes
    });
}
