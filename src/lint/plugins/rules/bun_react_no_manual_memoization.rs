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

/// True if the compiler would consider compiling `func` on its own: it's named like a component or a hook, it's the
/// argument of `memo()` or `forwardRef()`, or it opts in. A function inside one of these is compiled as part of it, so a
/// directive in it means nothing.
fn is_compile_candidate(func: Func<'_>) -> bool {
    if let Some(name) = func.name()
        && matches!(func.kind(), FnKind::Decl | FnKind::Expr)
    {
        return is_component_or_hook_name(name.bytes());
    }
    let Node::Expr(e) = func.owner() else {
        return false;
    };
    match e.parent() {
        Node::VarDecl(declaration) => {
            declaration.pat().as_ident().is_some_and(|it| is_component_or_hook_name(it.bytes()))
        }
        Node::Expr(parent) => parent.as_call().is_some_and(|call| {
            let callee = call.callee();
            call.args().first() == Some(e)
                && (ast_utils::is_specific_id_with(callee, |it| matches!(it, b"memo" | b"forwardRef"))
                    || ast_utils::is_member_access_of_any(callee, &["memo", "forwardRef"]))
        }),
        _ => false,
    }
}

/// True if the function the compiler would compile `e` as part of opts out, which leaves its memoization to the code.
fn is_in_opted_out_function(e: Expr<'_>) -> bool {
    let mut functions = Node::Expr(e).ancestors().filter_map(Node::as_func);
    let candidate = functions.find(|it| is_compile_candidate(*it) || has_body_directive(*it, &OPT_IN_DIRECTIVES));
    candidate.is_some_and(opts_out)
}

/// Returns the function that `e` is, or that `e` names in this file: `C` in `memo(C)`.
fn function_of(e: Expr<'_>) -> Option<Func<'_>> {
    if let Some(func) = e.as_fn() {
        return Some(func);
    }
    match e.symbol()?.declarations().next()?.node()? {
        Node::Func(func) => Some(func),
        Node::VarDecl(declaration) => declaration.init()?.as_fn(),
        _ => None,
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

/// The name of a function or class expression.
fn own_name(e: Expr<'_>) -> Option<Ident<'_>> {
    match e.kind() {
        ExprKind::Fn(func) => func.name(),
        ExprKind::Class(class) => class.name(),
        _ => None,
    }
}

/// True if the function or class `kept` still has a name for the compiler to find once the `memo()` around it is gone:
/// its own, or that of the variable the call is assigned to.
fn keeps_name(e: Expr<'_>, kept: Expr<'_>) -> bool {
    !matches!(kept.tag(), ExprTag::Fn | ExprTag::Class)
        || own_name(kept).is_some()
        || matches!(e.parent(), Node::VarDecl(declaration) if declaration.init() == Some(e))
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

/// True if `kept` needs parentheses in the place of `e`: an operator around it would take part of it, an `as` or a `!`
/// after it would apply to part of it, a `{`, `function` or `class` would start a statement or an arrow function's
/// block, or it's a comma expression.
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
    let starts_block = || {
        let Some(first) = e.file().tokens_in(kept).next() else {
            return false;
        };
        is_start_of_expression_statement_needing_parentheses(e, &first)
            || is_start_of_arrow_function_body_needing_parentheses(e, &first)
    };
    (!is_strong_precedence_node(kept) && (is_weak_precedence_parent(e) || has_postfix_parent))
        || matches!(kept.kind(), ExprKind::Binary { op: BinOp::Comma, .. })
        || starts_block()
}

/// True if the function or class `kept` becomes a declaration in the place of `e`: `export default memo(function C ..)`.
fn becomes_declaration(e: Expr<'_>, kept: Expr<'_>) -> bool {
    let is_declaration_shape = matches!(kept.kind(), ExprKind::Fn(func) if !func.is_arrow()) || kept.tag() == ExprTag::Class;
    is_declaration_shape && matches!(e.parent(), Node::Stmt(statement) if matches!(statement.kind(), StmtKind::ExportDefault(_)))
}

/// The span to replace: the call, and the `;` after it when a function or class expression becomes a declaration.
fn replaced_span(e: Expr<'_>, kept: Expr<'_>) -> Span {
    let semicolon = e.file().token_after(e).filter(|it| it.is_punctuator(";"));
    match semicolon {
        Some(semicolon) if becomes_declaration(e, kept) => Span::new(e.span().start, semicolon.end()),
        _ => e.span(),
    }
}

/// True if `kept` as a declaration would have the name of something else in the module.
fn name_is_taken<'a>(e: Expr<'a>, kept: Expr<'a>) -> bool {
    becomes_declaration(e, kept)
        && own_name(kept).is_some_and(|it| e.file().top_level_scope().get_name(it.name()).is_some())
}

/// Every use of a memoizer in `file`, in source order: the references of the named imports, the members of the default
/// and namespace imports, and the named imports that nothing refers to.
fn uses<'a>(file: &'a File<'a>) -> Vec<Use<'a>> {
    let scope = file.top_level_scope();
    let mut all = Vec::new();
    for import in react_imports(file) {
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
        if !file.mentions("react") || has_directive(file.body().iter(), &OPT_OUT_DIRECTIVES) {
            return None;
        }
        Some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        for Use { at, name, call, specifier } in uses(file) {
            // The compiler compiles the argument of `memo()` on its own. If that opts out, `memo()` is what memoizes it.
            if name.is("memo")
                && let Some((_, call)) = call
                && call.args().first().and_then(function_of).is_some_and(opts_out)
            {
                continue;
            }
            let report = cx.report(at, MANUAL_MEMOIZATION).data("name", name);
            let Some((e, call)) = call else {
                if let Some(specifier) = specifier.filter(|it| it.span() == at) {
                    report.suggest(REMOVE_IMPORT, |fixer| fixer.remove_import_specifier(specifier));
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
                let text = match needs_parentheses(e, kept) {
                    true => [b"(", kept.text(), b")"].concat(),
                    false => kept.text().to_vec(),
                };
                let mut fixes = vec![fixer.replace(replaced_span(e, kept), text)];
                fixes.extend(specifier.and_then(|it| fixer.remove_import_specifier(it)));
                fixes
            });
        }
    }
}
