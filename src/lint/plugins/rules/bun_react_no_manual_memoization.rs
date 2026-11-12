use crate::bun::react_imports;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ts_utils::{
    is_start_of_arrow_function_body_needing_parentheses, is_start_of_expression_statement_needing_parentheses,
    is_strong_precedence_node, is_weak_precedence_parent,
};
use bun_lint_oxlint::ast_util::static_property_name;
use bun_lint_react_compiler::{Discovered, Flavor, discover, is_hook_call, would_compile};
use rustc_hash::{FxHashMap, FxHashSet};

/// Disallow `useMemo`, `useCallback` and `memo` in a project that relies on the React Compiler.
pub struct ReactNoManualMemoization;

const MANUAL_MEMOIZATION: &Message =
    &Message::new("manualMemoization", "This project relies on the React Compiler for memoization. Remove `{{name}}`.");
const KEEP_VALUE: &Message = &Message::new("keepValue", "Remove `useMemo()` and keep the value.");
const KEEP_FUNCTION: &Message = &Message::new("keepFunction", "Remove `useCallback()` and keep the function.");
const KEEP_COMPONENT: &Message = &Message::new("keepComponent", "Remove `memo()` and keep the component.");
const REMOVE_IMPORT: &Message = &Message::new("removeImport", "Remove the import.");

const MEMOIZERS: [&str; 3] = ["memo", "useCallback", "useMemo"];

/// The directives that opt a file out of the React Compiler. `src/lint/react_compiler/program.rs` has the same list.
const OPT_OUT_DIRECTIVES: [&str; 2] = ["use no forget", "use no memo"];

/// The compiler port as oxlint runs it, which is the closest to `bun build --react-compiler`.
const FLAVOR: Flavor = Flavor::Oxlint;

/// A use of one of the memoizers.
struct Use<'a> {
    /// `useMemo`, `React.useMemo`, or the `useMemo` of an import that nothing refers to.
    at: Span,
    name: Name<'a>,
    /// The call whose callee it is.
    call: Option<(Expr<'a>, Call<'a>)>,
    /// The import specifier to remove: along with the call if nothing else refers to it, or on its own if nothing does.
    specifier: Option<ImportSpec<'a>>,
}

/// True if one of the leading string statements is one of `directives`.
fn has_directive<'a>(statements: impl IntoIterator<Item = Stmt<'a>>, directives: &[&str]) -> bool {
    let mut found = statements.into_iter().map_while(Stmt::directive);
    found.any(|it| directives.iter().any(|directive| directive.as_bytes() == it))
}

/// `memo`, `React.memo`
fn is_react_api(callee: Expr<'_>, names: &[&str]) -> bool {
    ast_utils::is_specific_id_with(callee, |it| names.iter().any(|name| name.as_bytes() == it))
        || ast_utils::is_member_access_of_any(callee, names)
}

/// What the compiler would do with the functions of a file. The compiler port decides which ones it compiles, by the
/// rules of `bun build --react-compiler`.
struct Compiled<'a> {
    discovered: FxHashMap<Func<'a>, Discovered<'a>>,
    /// The hook calls in each function itself, not in a function inside it.
    hook_calls: FxHashMap<Func<'a>, u32>,
    /// The functions that create JSX themselves.
    with_jsx: FxHashSet<Func<'a>>,
}

impl<'a> Compiled<'a> {
    fn new(file: &'a File<'a>) -> Self {
        let discovered = discover(file, FLAVOR).into_iter().map(|it| (it.func, it)).collect();
        let mut hook_calls: FxHashMap<Func<'a>, u32> = FxHashMap::default();
        let hooks = file.exprs_of_kind(ExprTag::Call).filter(|e| e.as_call().is_some_and(|it| is_hook_call(it, FLAVOR)));
        for e in hooks {
            if let Some(func) = Node::Expr(e).enclosing_function() {
                *hook_calls.entry(func).or_default() += 1;
            }
        }
        let jsx = file.exprs_of_kind(ExprTag::Jsx).filter_map(|e| Node::Expr(e).enclosing_function());
        Compiled { discovered, hook_calls, with_jsx: jsx.collect() }
    }

    /// The function the compiler compiles `e` as part of.
    fn function_around(&self, e: Expr<'a>) -> Option<Discovered<'a>> {
        let mut functions = Node::Expr(e).ancestors().filter_map(Node::as_func);
        functions.find_map(|it| self.discovered.get(&it).copied())
    }

    fn is_in_skipped_function(&self, e: Expr<'a>) -> bool {
        self.function_around(e).is_some_and(|it| it.skipped)
    }

    /// True if `e` is in a function that the compiler never finds, like `export default () => ..`.
    fn is_in_undiscovered_function(&self, e: Expr<'a>) -> bool {
        Node::Expr(e).enclosing_function().is_some() && self.function_around(e).is_none()
    }

    /// True if the compiler would stop finding the function that the hook call `e` is in once the call is gone.
    fn is_last_hook_call(&self, e: Expr<'a>) -> bool {
        let Some(func) = Node::Expr(e).enclosing_function() else {
            return false;
        };
        let is_compiled = self.function_around(e).is_some_and(|it| it.func == func);
        is_compiled && self.hook_calls.get(&func).copied().unwrap_or(0) <= 1 && !self.with_jsx.contains(&func)
    }

    /// True if the compiler compiles `func` and doesn't skip it.
    fn compiles(&self, func: Func<'a>) -> bool {
        self.discovered.get(&func).is_some_and(|it| !it.skipped)
    }
}

/// The component that `memo()` wraps.
enum Component<'a> {
    Class,
    Func(Func<'a>),
    /// Something else this file makes, like `observer(..)`.
    Other,
    Import,
}

/// Returns the component that `e` is, or that `e` names in this file: `C` in `memo(C)`, through `forwardRef()`. `None`
/// for a name nothing declares.
fn component_of(e: Expr<'_>, depth: u8) -> Option<Component<'_>> {
    if depth == 0 {
        return None;
    }
    if e.tag() == ExprTag::Class {
        return Some(Component::Class);
    }
    if let Some(func) = e.as_fn() {
        return Some(Component::Func(func));
    }
    if let Some(call) = e.as_call()
        && is_react_api(call.callee(), &["forwardRef"])
    {
        return component_of(call.args().first()?, depth - 1);
    }
    if let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = e.kind() {
        return component_of(expr, depth - 1);
    }
    if e.as_ident().is_none() {
        return Some(Component::Other);
    }
    match e.symbol()?.declarations().next()? {
        Declaration::ImportSpec(_) | Declaration::ImportDefault(_) | Declaration::ImportNamespace(_) => {
            Some(Component::Import)
        }
        Declaration::Class(_) => Some(Component::Class),
        Declaration::Fn(func) => Some(Component::Func(func)),
        declaration => match declaration.node() {
            Some(Node::VarDecl(declaration)) => match declaration.init() {
                Some(init) => component_of(init, depth - 1),
                None => Some(Component::Other),
            },
            _ => Some(Component::Other),
        },
    }
}

/// True if the compiler leaves the component `e` alone, so that `memo()` is what memoizes it: a class, something
/// another wrapper makes, or a function it doesn't compile.
fn compiler_skips<'a>(compiled: &Compiled<'a>, e: Expr<'a>) -> bool {
    match component_of(e, 4) {
        Some(Component::Class | Component::Other) => true,
        Some(Component::Func(func)) => !compiled.compiles(func),
        Some(Component::Import) | None => false,
    }
}

/// Returns the call whose callee `e` is.
fn call_of(e: Expr<'_>) -> Option<(Expr<'_>, Call<'_>)> {
    let Node::Expr(parent) = e.parent() else {
        return None;
    };
    let call = parent.as_call().filter(|it| it.callee() == e)?;
    Some((parent, call))
}

/// The argument of a call with exactly `count` arguments, or one fewer, and no spread.
fn first_argument(call: Call<'_>, count: usize) -> Option<Expr<'_>> {
    let args = call.args();
    let fits = (count - 1..=count).contains(&args.len()) && args.iter().all(|it| it.tag() != ExprTag::Spread);
    let is_plain = call.type_args().is_empty() && !call.is_optional() && !call.callee().is_in_optional_chain();
    (fits && is_plain).then(|| args.first()).flatten()
}

/// True if the compiler would still compile the component `kept` once `memo()` is gone: under the variable's name, or
/// under its own as a declaration. A component from another file may not be compiled at all.
fn stays_compiled<'a>(compiled: &Compiled<'a>, e: Expr<'a>, kept: Expr<'a>) -> bool {
    match kept.as_fn() {
        Some(func) => {
            let name = match e.parent() {
                Node::VarDecl(declaration) if declaration.init() == Some(e) => declaration.pat().as_ident(),
                _ if becomes_declaration(e, kept) => func.name().map(Ident::name),
                _ => return false,
            };
            name.is_some() && would_compile(func, name, FLAVOR)
        }
        None => match component_of(kept, 4) {
            // A function inside `kept`, like `function Row() {} as FC`, is compiled as the callback of `memo()` only.
            Some(Component::Func(func)) => {
                let inside = kept.span().start <= func.span().start && func.span().end <= kept.span().end;
                compiled.compiles(func) && !inside
            }
            Some(Component::Class | Component::Other | Component::Import) => false,
            None => true,
        },
    }
}

/// What the call leaves behind: `expr` of `useMemo(() => expr, deps)`, `fn` of `useCallback(fn, deps)`, `C` of `memo(C)`.
fn replacement<'a>(
    compiled: &Compiled<'a>,
    name: Name<'a>,
    e: Expr<'a>,
    call: Call<'a>,
) -> Option<(Expr<'a>, &'static Message)> {
    match name.bytes() {
        b"useMemo" => {
            let factory = first_argument(call, 2)?.as_fn()?;
            let FnBody::Expr(value) = factory.body() else {
                return None;
            };
            let is_plain = !factory.is_async()
                && !factory.is_generator()
                && factory.params().is_empty()
                && factory.type_params().is_empty()
                && factory.return_type().is_none();
            is_plain.then_some((value, KEEP_VALUE))
        }
        b"useCallback" => Some((first_argument(call, 2)?, KEEP_FUNCTION)),
        b"memo" => {
            let component = first_argument(call, 1)?;
            stays_compiled(compiled, e, component).then_some((component, KEEP_COMPONENT))
        }
        _ => None,
    }
}

fn is_export_default(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Stmt(statement) if matches!(statement.kind(), StmtKind::ExportDefault(_)))
}

/// True if `kept` needs parentheses in the place of `e`: for precedence, after `export default` or at the start of a
/// statement or an arrow body, or as a comma expression.
fn needs_parentheses(e: Expr<'_>, kept: Expr<'_>) -> bool {
    let has_postfix_parent = match e.parent() {
        Node::Expr(parent) => matches!(
            parent.kind(),
            ExprKind::As { .. }
                | ExprKind::AsConst(_)
                | ExprKind::Satisfies { .. }
                | ExprKind::NonNull(_)
                | ExprKind::Instantiation { .. }
        ),
        _ => false,
    };
    let starts_block_or_declaration = || {
        let Some(first) = e.file().tokens_in(kept).next() else {
            return false;
        };
        let starts_declaration = matches!(first.text(), b"function" | b"class" | b"async")
            && (ast_utils::is_start_of_expression_statement(e) || is_export_default(e))
            && !becomes_declaration(e, kept);
        is_start_of_expression_statement_needing_parentheses(e, &first)
            || is_start_of_arrow_function_body_needing_parentheses(e, &first)
            || starts_declaration
    };
    // `new Date` is strong, but `new Date.getTime()` is not `(new Date).getTime()`.
    let is_bare_new = matches!(kept.kind(), ExprKind::New(call) if call.close_paren().is_none());
    ((!is_strong_precedence_node(kept) || is_bare_new) && (is_weak_precedence_parent(e) || has_postfix_parent))
        || matches!(kept.kind(), ExprKind::Binary { op: BinOp::Comma, .. })
        || starts_block_or_declaration()
}

/// True if the function `kept` becomes a declaration in the place of `e`: `export default memo(function C ..)`.
fn becomes_declaration(e: Expr<'_>, kept: Expr<'_>) -> bool {
    matches!(kept.kind(), ExprKind::Fn(func) if !func.is_arrow()) && is_export_default(e) && !e.is_parenthesized()
}

/// The span to replace: the call, and the `;` right after it when a function expression becomes a declaration.
fn replaced_span(e: Expr<'_>, kept: Expr<'_>) -> Span {
    let file = e.file();
    let semicolon = file.token_after(e).filter(|it| it.is_punctuator(";"));
    match semicolon {
        Some(semicolon)
            if becomes_declaration(e, kept)
                && file.comments_in(Span::new(e.span().end, semicolon.start())).next().is_none() =>
        {
            Span::new(e.span().start, semicolon.end())
        }
        _ => e.span(),
    }
}

/// True if `kept` as a declaration would take a name the module already uses: a declaration of its own or a global.
fn name_is_taken<'a>(e: Expr<'a>, kept: Expr<'a>) -> bool {
    let file = e.file();
    becomes_declaration(e, kept)
        && kept.as_fn().and_then(Func::name).is_some_and(|it| {
            file.top_level_scope().get_name(it.name()).is_some()
                || file.unresolved_references_to(it.name().bytes()).len() > 0
        })
}

/// Every use of a memoizer in `file`, in source order, and every named import of one that nothing refers to.
fn uses<'a>(file: &'a File<'a>, compiled: &Compiled<'a>) -> Vec<Use<'a>> {
    let mut all = Vec::new();
    for import in react_imports(file) {
        let scope = file.top_level_scope();
        let named = import.named().iter().filter(|it| !it.is_type_only());
        for specifier in named.filter(|it| it.imported().name().is_any(&MEMOIZERS)) {
            let Some(symbol) = scope.get_name(specifier.local().name()) else {
                continue;
            };
            let name = specifier.imported().name();
            let references = symbol.references();
            if references.len() == 0 {
                all.push(Use { at: specifier.span(), name, call: None, specifier: Some(specifier) });
                continue;
            }
            let is_only_reference = references.len() == 1;
            for reference in references {
                let Some(e) = reference.expr() else {
                    // `export { memo }`
                    if matches!(reference.node(), Node::ExportSpec(_)) {
                        all.push(Use { at: reference.span(), name, call: None, specifier: None });
                    }
                    continue;
                };
                if e.is_in_type_query() || compiled.is_in_skipped_function(e) {
                    continue;
                }
                let specifier = is_only_reference.then_some(specifier);
                all.push(Use { at: e.span(), name, call: call_of(e), specifier });
            }
        }
        let objects = [import.default(), import.namespace()].into_iter().flatten();
        let references = objects.filter_map(|it| scope.get_name(it.name())).flat_map(Symbol::references);
        for object in references.filter_map(|it| it.expr()) {
            let Node::Expr(member) = object.parent() else {
                continue;
            };
            if member.object() != Some(object) || !ast_utils::is_member_expression(member) {
                continue;
            }
            let Some(name) = static_property_name(member).filter(|it| it.is_any(&MEMOIZERS)) else {
                continue;
            };
            if compiled.is_in_skipped_function(member) {
                continue;
            }
            all.push(Use { at: member.span(), name, call: call_of(member), specifier: None });
        }
    }
    utils::sort::sort_unstable_by_key(&mut all, |it| it.at.start);
    all
}

impl Rule for ReactNoManualMemoization {
    const META: Meta = Meta::plugin(Plugin::Bun, "react-no-manual-memoization", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ReactNoManualMemoization
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("react")
            || !file.mentions_any(&MEMOIZERS)
            || has_directive(file.body().iter(), &OPT_OUT_DIRECTIVES)
        {
            return None;
        }
        Some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let compiled = Compiled::new(file);
        for Use { at, name, call, specifier } in uses(file, &compiled) {
            if name.is("memo")
                && let Some((_, call)) = call
                && call.args().first().is_some_and(|it| compiler_skips(&compiled, it))
            {
                continue;
            }
            let report = cx.report(at, MANUAL_MEMOIZATION).data("name", name);
            let Some((e, call)) = call else {
                if let Some(specifier) = specifier.filter(|it| it.span() == at) {
                    report.suggest(REMOVE_IMPORT, |fixer| {
                        fixer.remove_import_specifier(specifier).filter(|it| fixer.keeps_comments(it))
                    });
                }
                continue;
            };
            let Some((kept, message)) = replacement(&compiled, name, e, call) else {
                continue;
            };
            if name_is_taken(e, kept) || compiled.is_in_undiscovered_function(e) {
                continue;
            }
            // Without its only hook call, a hook is no longer one to the compiler.
            if !name.is("memo") && compiled.is_last_hook_call(e) {
                continue;
            }
            report.suggest(message, move |fixer| {
                let mut text = match needs_parentheses(e, kept) {
                    true => [b"(", kept.text(), b")"].concat(),
                    false => kept.text().to_vec(),
                };
                if matches!(text.first(), Some(b'(' | b'[' | b'`' | b'+' | b'-' | b'/'))
                    && ast_utils::is_start_of_expression_statement(e)
                    && ast_utils::needs_preceding_semicolon(e)
                {
                    text.insert(0, b';');
                }
                let mut fixes = vec![fixer.replace(replaced_span(e, kept), text)];
                fixes.extend(specifier.and_then(|it| fixer.remove_import_specifier(it)));
                fixes.iter().all(|it| fixer.keeps_comments(it)).then_some(fixes)
            });
        }
    }
}
