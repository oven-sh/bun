use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_react_hook;
use rustc_hash::FxHashMap;

/// Require the hooks of React to be imported by name: `useState()`, not `React.useState()`.
pub struct ReactNoNamespaceHooks;

const NAMESPACE_HOOK: Message = Message::new("namespaceHook", "Import `{{name}}` from \"react\" by its name.");

/// The imports from `"react"` that are not only of types.
fn imports_of_react<'a>(file: &'a File<'a>) -> impl Iterator<Item = (Stmt<'a>, Import<'a>)> {
    file.stmts_of_kind(StmtTag::Import).filter_map(|statement| match statement.kind() {
        StmtKind::Import(import) if import.spec().is("react") && !import.is_type_only() => Some((statement, import)),
        _ => None,
    })
}

/// The `React.useState` and the like that the file has, in the order of the source.
fn namespace_hooks<'a>(file: &'a File<'a>) -> Vec<Expr<'a>> {
    let scope = file.top_level_scope();
    let objects = imports_of_react(file).flat_map(|it| [it.1.default(), it.1.namespace()]).flatten();
    let references = objects.filter_map(|it| scope.get_name(it.name())).flat_map(Symbol::references);
    let members = references.filter_map(|it| match it.expr()?.parent() {
        Node::Expr(member) => Some(member).filter(|it| ast_utils::is_member_expression(*it) && is_react_hook(*it)),
        _ => None,
    });
    let mut all: Vec<_> = members.collect();
    utils::sort::sort_unstable_by_key(&mut all, |it| it.span().start);
    all
}

/// The `useState` of `React.useState`.
fn hook_name(member: Expr<'_>) -> Option<Name<'_>> {
    match member.kind() {
        ExprKind::Dot { name, .. } => Some(name.name()),
        _ => None,
    }
}

/// What adds `names` to what is imported from `"react"`.
fn import_fix<'a>(file: &'a File<'a>, names: &[Name<'a>], fixer: Fixer<'a>) -> Option<Fix> {
    let list = names.iter().map(|it| it.bytes()).collect::<Vec<_>>().join(&b", "[..]);
    if let Some(last) = imports_of_react(file).find_map(|it| it.1.named().last()) {
        return Some(fixer.insert_after(last, [b", ", &list[..]].concat()));
    }
    let (statement, import) = imports_of_react(file).find(|it| !it.1.has_named_imports())?;
    match (import.default(), import.namespace()) {
        (Some(default), None) => Some(fixer.insert_after(default, [b", { ", &list[..], b" }"].concat())),
        _ => {
            let specifier = file.slice(statement.module_specifier_span()?);
            Some(fixer.insert_after(statement, [b"\nimport { ", &list[..], b" } from ", specifier, b";"].concat()))
        }
    }
}

impl Rule for ReactNoNamespaceHooks {
    const META: Meta = Meta::plugin(Plugin::Bun, "react-no-namespace-hooks", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ReactNoNamespaceHooks
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("react") {
            return None;
        }
        Some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let hooks: Vec<_> = namespace_hooks(file).into_iter().filter_map(|it| Some((it, hook_name(it)?))).collect();
        // What each is called where it is imported by name.
        let specifiers = imports_of_react(file).flat_map(|it| it.1.named()).filter(|it| !it.is_type_only());
        let imported: FxHashMap<&[u8], Name> =
            specifiers.map(|it| (it.imported().bytes(), it.local().name())).collect();
        let means = |name: Name<'a>, at: Expr<'a>| Node::Expr(at).scope().resolve_name(name);
        let lacking = || hooks.iter().filter(|it| !imported.contains_key(it.1.bytes()));
        let mut missing: Vec<Name> = lacking().map(|it| it.1).collect();
        utils::sort::sort_unstable_by_key(&mut missing, |it| it.bytes());
        missing.dedup();
        // A name that means something else where it is used cannot be imported.
        let can_import = lacking().all(|it| means(it.1, it.0).is_none());
        for &(hook, name) in &hooks {
            let report = cx.report(hook, NAMESPACE_HOOK).data("name", name);
            match imported.get(name.bytes()) {
                Some(&local) if means(local, hook) == file.top_level_scope().get_name(local) => {
                    report.fix(|fixer| fixer.replace(hook, local));
                }
                None if can_import => {
                    report.fix(|fixer| Some(vec![import_fix(file, &missing, fixer)?, fixer.replace(hook, name)]));
                }
                _ => {}
            }
        }
    }
}
