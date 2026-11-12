use crate::bun::react_imports;
use crate::rules::react_hooks_rules_of_hooks::is_hook_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ts_utils::{
    is_start_of_arrow_function_body_needing_parentheses, is_start_of_expression_statement_needing_parentheses,
    is_strong_precedence_node, is_weak_precedence_parent,
};
use bun_lint_oxlint::ast_util::static_property_name;

/// Disallow `useMemo`, `useCallback` and `memo` in a project that relies on the React Compiler.
pub struct ReactNoManualMemoization;

const MANUAL_MEMOIZATION: &Message =
    &Message::new("manualMemoization", "This project relies on the React Compiler for memoization. Remove `{{name}}`.");
const KEEP_VALUE: &Message = &Message::new("keepValue", "Remove `useMemo()` and keep the value.");
const KEEP_FUNCTION: &Message = &Message::new("keepFunction", "Remove `useCallback()` and keep the function.");
const KEEP_COMPONENT: &Message = &Message::new("keepComponent", "Remove `memo()` and keep the component.");
const REMOVE_IMPORT: &Message = &Message::new("removeImport", "Remove the import.");

const MEMOIZERS: [&str; 3] = ["memo", "useCallback", "useMemo"];

/// The directives of the React Compiler. `src/lint/react_compiler/program.rs` has the same lists.
const OPT_IN_DIRECTIVES: [&str; 2] = ["use forget", "use memo"];
const OPT_OUT_DIRECTIVES: [&str; 2] = ["use no forget", "use no memo"];

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

fn has_body_directive(func: Func<'_>, directives: &[&str]) -> bool {
    has_directive(func.body_statements().into_iter().flatten(), directives)
}

/// True if `func` starts with `"use no memo"` or `"use no forget"`: the compiler's `find_directive_disabling_memoization`.
fn opts_out(func: Func<'_>) -> bool {
    has_body_directive(func, &OPT_OUT_DIRECTIVES)
}

fn is_component_or_hook_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_uppercase) || is_hook_name(name)
}

/// `memo`, `React.memo`
fn is_react_api(callee: Expr<'_>, names: &[&str]) -> bool {
    ast_utils::is_specific_id_with(callee, |it| names.iter().any(|name| name.as_bytes() == it))
        || ast_utils::is_member_access_of_any(callee, names)
}

/// The name the compiler gives `func`: its own for a declaration, the variable's for a function that is the whole
/// initializer of a `const`. A function expression's own name doesn't count.
fn compiler_name(func: Func<'_>) -> Option<Name<'_>> {
    if func.kind() == FnKind::Decl {
        return func.name().map(Ident::name);
    }
    match func.owner() {
        Node::Expr(e) => match e.parent() {
            Node::VarDecl(declaration) => declaration.pat().as_ident(),
            _ => None,
        },
        _ => None,
    }
}

/// True if the compiler would consider compiling `func` on its own: it's named like a component or a hook, it's the
/// argument of `memo()` or `forwardRef()`, or it opts in. A function inside one of these is compiled as part of it, so a
/// directive in it means nothing.
fn is_compile_candidate(func: Func<'_>) -> bool {
    if compiler_name(func).is_some_and(|it| is_component_or_hook_name(it.bytes())) {
        return true;
    }
    let is_react_api_callback = match func.owner() {
        Node::Expr(e) => match e.parent() {
            Node::Expr(parent) => parent.as_call().is_some_and(|call| {
                call.args().first() == Some(e) && is_react_api(call.callee(), &["memo", "forwardRef"])
            }),
            _ => false,
        },
        _ => false,
    };
    is_react_api_callback || has_body_directive(func, &OPT_IN_DIRECTIVES)
}

/// True if the function the compiler would compile `e` as part of opts out, which leaves its memoization to the code.
/// That's the outermost candidate around `e`: the compiler doesn't look inside a function it compiles.
fn is_in_opted_out_function(e: Expr<'_>) -> bool {
    let functions = Node::Expr(e).ancestors().filter_map(Node::as_func);
    let candidate = functions.filter(|it| is_compile_candidate(*it)).last();
    candidate.is_some_and(opts_out)
}

/// The component that `memo()` wraps.
enum Component<'a> {
    Class,
    Func(Func<'a>),
}

/// Returns the component that `e` is, or that `e` names in this file: `C` in `memo(C)`, through `forwardRef()`.
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
    match e.symbol()?.declarations().next()?.node()? {
        Node::Class(_) => Some(Component::Class),
        Node::Func(func) => Some(Component::Func(func)),
        Node::VarDecl(declaration) => component_of(declaration.init()?, depth - 1),
        _ => None,
    }
}

/// True if the compiler leaves the component `e` alone, so `memo()` is what memoizes it: a class, or a function that
/// opts out.
fn compiler_skips(e: Expr<'_>) -> bool {
    match component_of(e, 4) {
        Some(Component::Class) => true,
        Some(Component::Func(func)) => opts_out(func),
        None => false,
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
    (fits && call.type_args().is_empty() && !call.is_optional()).then(|| args.first()).flatten()
}

/// True if the function `kept` still has a name for the compiler to find once the `memo()` around it is gone: that of
/// the variable the call is assigned to, or its own once it's a declaration.
fn keeps_name<'a>(e: Expr<'a>, kept: Expr<'a>) -> bool {
    let Some(func) = kept.as_fn() else {
        return true;
    };
    let name = match e.parent() {
        Node::VarDecl(declaration) if declaration.init() == Some(e) => declaration.pat().as_ident(),
        _ if becomes_declaration(e, kept) => func.name().map(Ident::name),
        _ => None,
    };
    name.is_some_and(|it| is_component_or_hook_name(it.bytes()))
}

/// Returns what the call leaves behind, and the message that says so: `expr` for `useMemo(() => expr, deps)`, `fn` for
/// `useCallback(fn, deps)`, `C` for `memo(C)`.
fn replacement<'a>(name: Name<'a>, e: Expr<'a>, call: Call<'a>) -> Option<(Expr<'a>, &'static Message)> {
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
            keeps_name(e, component).then_some((component, KEEP_COMPONENT))
        }
        _ => None,
    }
}

fn is_export_default(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Stmt(statement) if matches!(statement.kind(), StmtKind::ExportDefault(_)))
}

/// True if `kept` needs parentheses in the place of `e`: an operator around it would take part of it, an `as` or a `!`
/// after it would apply to part of it, a `{`, `function` or `class` would start a statement, an arrow function's block
/// or a declaration after `export default`, or it's a comma expression.
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
        is_start_of_expression_statement_needing_parentheses(e, &first)
            || is_start_of_arrow_function_body_needing_parentheses(e, &first)
            || (is_export_default(e)
                && !becomes_declaration(e, kept)
                && matches!(first.text(), b"function" | b"class" | b"async"))
    };
    (!is_strong_precedence_node(kept) && (is_weak_precedence_parent(e) || has_postfix_parent))
        || matches!(kept.kind(), ExprKind::Binary { op: BinOp::Comma, .. })
        || starts_block_or_declaration()
}

/// True if the function `kept` becomes a declaration in the place of `e`: `export default memo(function C ..)`.
fn becomes_declaration(e: Expr<'_>, kept: Expr<'_>) -> bool {
    matches!(kept.kind(), ExprKind::Fn(func) if !func.is_arrow()) && is_export_default(e)
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

/// True if `kept` as a declaration would take the name of something else that the module uses: a declaration of its own
/// or a global.
fn name_is_taken<'a>(e: Expr<'a>, kept: Expr<'a>) -> bool {
    let file = e.file();
    becomes_declaration(e, kept)
        && kept.as_fn().and_then(Func::name).is_some_and(|it| {
            file.top_level_scope().get_name(it.name()).is_some()
                || file.unresolved_references_to(it.name().bytes()).len() > 0
        })
}

/// Every use of a memoizer in `file`, in source order: the references of the named imports, the members of the default
/// and namespace imports, and the named imports that nothing refers to.
fn uses<'a>(file: &'a File<'a>) -> Vec<Use<'a>> {
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
            for e in references.filter_map(|it| it.expr()) {
                if e.is_in_type_query() || is_in_opted_out_function(e) {
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
            if is_in_opted_out_function(member) {
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
        for Use { at, name, call, specifier } in uses(file) {
            if name.is("memo")
                && let Some((_, call)) = call
                && call.args().first().is_some_and(compiler_skips)
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
            let Some((kept, message)) = replacement(name, e, call) else {
                continue;
            };
            if name_is_taken(e, kept) {
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
