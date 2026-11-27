use crate::bun::imports_from;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdSet;
use bun_lint_oxlint::import::common_js_require;

/// Disallow top-level variables in a hoisted `vi.mock()` or `jest.mock()` that aren't hoisted with it.
///
/// What's hoisted is decided in src/js_parser/lower/hoist_test_mocks.rs.
pub struct NoUnhoistedMockVariables;

const NOT_INITIALIZED: &Message = &Message::new(
    "notInitialized",
    "This mock is hoisted above `{{name}}`, which isn't initialized when it's read here. Declare it with `vi.hoisted()`.",
);
const NOT_IMPORTED: &Message = &Message::new(
    "notImported",
    "This mock is hoisted above the import of `{{name}}`, which isn't loaded when it's read here. Use `await import()`.",
);
const USE_HOISTED: &Message = &Message::new("useHoisted", "Declare it with `vi.hoisted()`.");

/// Imports of these stay above the hoisted calls.
const STAY_ON_TOP: [&str; 4] = ["bun:test", "vitest", "@jest/globals", "bun"];

/// The globals that nothing before the declaration is likely to change, unlike `process` or `Date`.
const STABLE_GLOBALS: [&str; 24] = [
    "Array", "BigInt", "Boolean", "Buffer", "Error", "Infinity", "JSON", "Map", "Math", "NaN", "Number", "Object",
    "Promise", "RegExp", "Set", "String", "Symbol", "Uint8Array", "URL", "WeakMap", "jest", "undefined", "vi", "vitest",
];

#[derive(Copy, Clone, PartialEq, Eq)]
enum Api {
    Vi,
    Jest,
}

fn api_named(name: Name) -> Option<Api> {
    match name.bytes() {
        b"vi" | b"vitest" => Some(Api::Vi),
        b"jest" => Some(Api::Jest),
        _ => None,
    }
}

fn api_of(e: Expr) -> Option<Api> {
    let name = e.as_ident()?;
    match e.symbol().and_then(|it| it.declarations().next()) {
        None => api_named(name).filter(|it| *it == Api::Vi || !imports_from(e.file(), "vitest")),
        Some(Declaration::ImportSpec(it)) if it.import().spec().is_any(&STAY_ON_TOP) => api_named(it.imported().name()),
        Some(_) => None,
    }
}

fn without_await(e: Expr<'_>) -> Expr<'_> {
    match e.kind() {
        ExprKind::Await(operand) => operand,
        _ => e,
    }
}

/// The calls of `vi.mock(..)` or `jest.mock(..).mock(..)`, if `e` is hoisted.
fn hoisted_mock_calls(e: Expr<'_>) -> Option<(Api, Vec<Call<'_>>)> {
    let (mut calls, mut at) = (Vec::new(), without_await(e));
    loop {
        let call = at.as_call().filter(|_| !at.is_in_optional_chain())?;
        let (object, name, _) = call.callee().as_dot()?;
        if !name.name().is_any(&["mock", "unmock"]) {
            return None;
        }
        calls.push(call);
        if object.tag() == ExprTag::Ident {
            let api = api_of(object)?;
            return (calls.len() == 1 || api == Api::Jest).then_some((api, calls));
        }
        at = object;
    }
}

fn is_primitive_literal(e: Expr) -> bool {
    match e.kind() {
        ExprKind::String(_) | ExprKind::Number(_) | ExprKind::BigInt(_) => true,
        ExprKind::True | ExprKind::False | ExprKind::Null => true,
        ExprKind::Template(it) => it.exprs().is_empty(),
        ExprKind::Unary { op: UnOp::Minus, operand } => matches!(operand.tag(), ExprTag::Number | ExprTag::BigInt),
        ExprKind::Ident(name) => name.is("undefined") && e.symbol().is_none(),
        _ => false,
    }
}

fn is_hoisted<'a>(declarations: List<'a, VarDecl<'a>>) -> bool {
    let is_hoisted_call = |e: Expr| {
        (without_await(e).as_call().and_then(|it| it.callee().as_dot()))
            .is_some_and(|(object, name, _)| name.name().is("hoisted") && api_of(object) == Some(Api::Vi))
    };
    let value = |it: VarDecl<'a>| it.init().map(Expr::skip_type_wrappers).map(|it| (is_hoisted_call(it), is_primitive_literal(it)));
    declarations.iter().any(|it| value(it).is_some_and(|it| it.0))
        || declarations.iter().all(|it| {
            it.var_kind() != VarKind::Var && it.pat().as_ident().is_some() && value(it).is_some_and(|it| it.1)
        })
}

/// The function that has to be called for `node` to run. `Some(None)` at the top level, `None` in an instance field.
fn runs_in(node: Node<'_>) -> Option<Option<Func<'_>>> {
    let mut child = node;
    for parent in node.ancestors() {
        match parent {
            Node::Func(func) if func.kind() != FnKind::StaticBlock => return Some(Some(func)),
            Node::Member(it) if !it.is_static() && it.init().map(Node::Expr) == Some(child) => return None,
            _ => child = parent,
        }
    }
    Some(None)
}

/// The top-level statement that initializes what `reference` reads, if it stays below the hoisted calls.
fn left_behind(reference: Reference<'_>) -> Option<Stmt<'_>> {
    let symbol = reference.symbol().filter(|_| reference.is_value() && reference.is_read())?;
    let statement = match symbol.declarations().next()? {
        it @ Declaration::Var(_) => it.parent()?.as_stmt().filter(|it| !it.as_var().is_some_and(is_hoisted))?,
        Declaration::Class(class) => class.owner().as_stmt()?,
        Declaration::Enum(it) if !it.flags().contains(Flags::CONST) => it.stmt(),
        _ => return None,
    };
    let is_type_query = reference.expr().is_none_or(Expr::is_in_type_query);
    (matches!(statement.parent(), Node::File(_)) && !statement.flags().contains(Flags::AMBIENT) && !is_type_query)
        .then_some(statement)
}

/// The import that binds what `reference` reads, if it's moved below the hoisted calls.
fn lowered_import(reference: Reference<'_>) -> Option<Import<'_>> {
    let symbol = reference.symbol().filter(|_| reference.is_value() && reference.is_read())?;
    let import = match symbol.declarations().next()? {
        Declaration::ImportDefault(it) | Declaration::ImportNamespace(it) => it,
        Declaration::ImportSpec(it) => it.import(),
        _ => return None,
    };
    let is_type_query = reference.expr().is_none_or(Expr::is_in_type_query);
    (!import.spec().is_any(&STAY_ON_TOP) && import.attributes().is_none() && !import.is_deferred() && !is_type_query)
        .then_some(import)
}

fn without_node_prefix(module: Name<'_>) -> &[u8] {
    module.bytes().strip_prefix(b"node:").unwrap_or_else(|| module.bytes())
}

fn is_mocked_by<'a>(mock: Call<'a>, module: Name<'a>) -> bool {
    mock.args().first().and_then(Expr::as_string).map(without_node_prefix) == Some(without_node_prefix(module))
}

/// TypeScript's imports are dropped if only types use them.
fn is_kept(import: Import) -> bool {
    import.stmt().file().is_javascript() && !import.is_type_only()
        || import.is_side_effect()
        || (Node::Stmt(import.stmt()).declared_symbols().iter())
            .any(|it| it.references().any(|it| it.is_value() && !it.expr().is_some_and(Expr::is_in_type_query)))
}

/// True if the module that `mock` replaces is imported by `import` or before it. The imports run in order.
fn is_imported_by_then<'a>(file: &'a File<'a>, mock: Call<'a>, import: Import<'a>) -> bool {
    (file.body().iter().filter_map(Stmt::as_import))
        .take_while(|it| it.stmt().span().start <= import.stmt().span().start)
        .any(|it| is_mocked_by(mock, it.spec()) && is_kept(it))
}

/// True if something that runs before `declaration` can load the module that `mock` replaces, which calls the factory.
fn can_load_before<'a>(file: &'a File<'a>, mock: Call<'a>, declaration: Stmt<'a>) -> bool {
    // The project's own files, by path or by alias. Another package seldom loads it while it's evaluated.
    let can_load =
        |it: Name<'a>| is_mocked_by(mock, it) || matches!(it.bytes(), [b'.' | b'/' | b'#' | b'~' | b'$', ..] | [b'@', b'/', ..]);
    let loads = |e: Expr<'a>| match without_await(e).kind() {
        ExprKind::Call(call) => common_js_require(call).is_some_and(|it| it.as_string().is_none_or(can_load)),
        ExprKind::ImportCall { args } => args.first().is_some_and(|it| it.as_string().is_none_or(can_load)),
        _ => false,
    };
    file.body().iter().any(|statement| match statement.kind() {
        StmtKind::Import(it) => can_load(it.spec()) && is_kept(it),
        StmtKind::ExportNamed(it) => it.spec().is_some_and(can_load) && !it.is_type_only(),
        StmtKind::ExportStar { spec, type_only, .. } => spec.is_some_and(can_load) && !type_only,
        _ if statement.span().start >= declaration.span().start => false,
        StmtKind::Var(declarations) => declarations.iter().filter_map(VarDecl::init).any(loads),
        StmtKind::Expr(e) => loads(e),
        _ => false,
    })
}

/// What to call `vi`, and the edit that imports it.
fn vi<'a>(fixer: Fixer<'a>) -> Option<(&'a [u8], Option<Fix>)> {
    let file = fixer.file();
    let imports = || {
        (file.body().iter().filter_map(Stmt::as_import))
            .filter(|it| it.spec().is_any(&["bun:test", "vitest"]) && !it.is_type_only())
    };
    let mut names = imports().flat_map(Import::named);
    if let Some(it) = names.find(|it| api_named(it.imported().name()) == Some(Api::Vi) && !it.is_type_only()) {
        return Some((it.local().bytes(), None));
    }
    if file.top_level_scope().get("vi").is_some() {
        return None;
    }
    match imports().find_map(|it| it.named().last()) {
        Some(last) => Some((b"vi", Some(fixer.insert_after(last, ", vi")))),
        None => imports().next().is_none().then_some((b"vi", None)),
    }
}

/// `vi.fn`, `a.mockImplementation`, `mock`
fn is_mock_method(callee: Expr) -> bool {
    match callee.as_dot() {
        Some((object, name, _)) if name.name().is("fn") => api_of(object).is_some(),
        Some((_, name, _)) => name.name().bytes().starts_with(b"mock") && !name.name().is("mock"),
        None => callee.is_ident("mock"),
    }
}

/// True if `e` or a member of it is called, or passed to a call that may do that.
fn may_be_called(mut e: Expr) -> bool {
    while let Some(parent) = e.parent().as_expr() {
        match parent.tag() {
            ExprTag::Call | ExprTag::New | ExprTag::TaggedTemplate => return !parent.callee().is_some_and(is_mock_method),
            ExprTag::Dot | ExprTag::Index | ExprTag::As | ExprTag::Satisfies | ExprTag::NonNull => e = parent,
            _ => break,
        }
    }
    false
}

/// True if `node` may run while the top-level statement it's in does.
fn may_run_now(mut node: Node) -> bool {
    loop {
        node = match runs_in(node) {
            Some(None) => return true,
            Some(Some(func)) if func.owner().as_expr().is_some_and(may_be_called) => Node::Func(func),
            _ => return false,
        };
    }
}

/// True if a top-level statement before `mock` can change what `variable` holds.
fn is_changed_before<'a>(variable: VarDecl<'a>, mock: Call<'a>) -> bool {
    let mut is_changed = false;
    variable.pat().for_each_binding(&mut |it| {
        let mut uses = it.symbol().into_iter().flat_map(Symbol::references);
        is_changed |= uses.any(|it| {
            let statement = it.node().ancestors().filter_map(Node::as_stmt).last();
            let configures_mock = || it.expr().and_then(|it| it.parent().as_expr()).is_some_and(is_mock_method);
            it.span().start < mock.callee().span().start
                && statement.is_some_and(|it| it.tag() != StmtTag::Var && it.as_expr().and_then(hoisted_mock_calls).is_none())
                && runs_in(it.node()) == Some(None)
                && !configures_mock()
        });
    });
    is_changed
}

/// Hoists the declaration of what `mock` reads with `read`, and the declarations that it reads.
fn hoist<'a>(fixer: Fixer<'a>, mock: Call<'a>, read: Reference<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let (vi, import) = vi(fixer)?;
    let (mut fixes, mut pending) = (Vec::from_iter(import), vec![read]);
    let (mut wrapped, mut called) = (IdSet::new(), IdSet::new());
    while let Some(read) = pending.pop() {
        let statement = left_behind(read)?;
        let is_called = may_be_called(read.expr()?);
        let (is_new, is_first_call) = (wrapped.insert(statement), is_called && called.insert(statement));
        if !is_new && !is_first_call {
            continue;
        }
        let declarations = statement.as_var().filter(|it| it.len() == 1 && !statement.is_exported())?;
        let variable = declarations.first().filter(|it| !matches!(it.var_kind(), VarKind::Using | VarKind::AwaitUsing))?;
        let value = variable.init()?;
        let is_inside = |span: Span| variable.span().contains(span);
        let runs_now = |node: Node| is_called || may_run_now(node);
        let mut awaits = file.exprs_of_kind(ExprTag::Await);
        let mut import_metas = file.exprs_of_kind(ExprTag::ImportMeta);
        if awaits.any(|it| is_inside(it.span()) && runs_in(Node::Expr(it)) == Some(None))
            || import_metas.any(|it| is_inside(it.span()) && runs_now(Node::Expr(it)))
            || is_changed_before(variable, mock)
        {
            return None;
        }
        for reference in file.references_within(variable.span()).filter(|it| it.is_value() && !it.is_init() && runs_now(it.node())) {
            let declaration = reference.symbol().and_then(|it| it.declarations().next());
            if declaration.and_then(Declaration::name_span).is_some_and(is_inside)
                || reference.expr().is_some_and(Expr::is_in_type_query)
            {
                continue;
            }
            if left_behind(reference).is_some() {
                pending.push(reference);
                continue;
            }
            // An import isn't loaded yet, and a function can read anything.
            match declaration {
                None if reference.name().is_any(&STABLE_GLOBALS) => {}
                Some(Declaration::Var(_)) if !reference.is_write() => {}
                Some(Declaration::ImportSpec(it)) if it.import().spec().is_any(&STAY_ON_TOP) => {}
                _ => return None,
            }
        }
        if is_new {
            let (open, close): (&[u8], &str) = match file.slice(value.outer_span()).starts_with(b"{") {
                true => (b"(", "))"),
                false => (b"", ")"),
            };
            fixes.push(fixer.insert_before(value.outer_span(), [vi, b".hoisted(() => ", open].concat()));
            fixes.push(fixer.insert_after(value.outer_span(), close));
        }
    }
    Some(fixes)
}

impl Rule for NoUnhoistedMockVariables {
    const META: Meta =
        Meta::plugin(Plugin::Bun, "no-unhoisted-mock-variables", Kind::Problem).fixable(Fixable::Code).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnhoistedMockVariables
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("mock") && file.mentions_any(&["vi", "vitest", "jest"])).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let mut reported = IdSet::new();
        let hoisted = file.body().iter().filter_map(Stmt::as_expr).filter_map(hoisted_mock_calls);
        for (api, call) in hoisted.flat_map(|(api, calls)| calls.into_iter().rev().map(move |it| (api, it))) {
            let (Some(first), Some(last)) = (call.args().first(), call.args().last()) else {
                continue;
            };
            let factory = call.args().get(1).map(Expr::skip_type_wrappers);
            let declared = match factory.and_then(Expr::symbol).and_then(|it| it.declarations().next()) {
                Some(Declaration::Fn(it)) => Some(it),
                _ => None,
            };
            let factory = factory.and_then(Expr::as_fn).or(declared);
            let in_declared = declared.into_iter().flat_map(|it| file.references_within(it.estree_span()));
            for reference in file.references_within(first.span().to(last.span())).chain(in_declared) {
                let Some(function) = runs_in(reference.node()).filter(|it| it.is_none() || *it == factory) else {
                    continue;
                };
                if let Some(import) = lowered_import(reference)
                    && (function.is_none() || is_imported_by_then(file, call, import))
                    && reported.insert(import.stmt())
                {
                    cx.report(reference, NOT_IMPORTED).data("name", reference.name().bytes());
                } else if let Some(declaration) = left_behind(reference)
                    && (function.is_none() || can_load_before(file, call, declaration))
                    && reported.insert(declaration)
                {
                    let report = cx.report(reference, NOT_INITIALIZED).data("name", reference.name().bytes());
                    let fix = |fixer: Fixer<'a>| hoist(fixer, call, reference);
                    // Jest has no `vi`, and it can be what runs the other files.
                    match api == Api::Vi || imports_from(file, "bun:test") {
                        true => report.fix(fix),
                        false => report.suggest(USE_HOISTED, fix),
                    };
                }
            }
        }
    }
}
