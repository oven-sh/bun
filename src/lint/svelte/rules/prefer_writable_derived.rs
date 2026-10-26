use crate::conditions::{Condition, has_compiler_at_least, should_run};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::ast::svelte::variables::{DefNode, DefinitionKind};
use bun_lint::semantic::DeclarationKind;

/// Prefer using writable $derived instead of $state and $effect
pub struct PreferWritableDerived;

const UNEXPECTED: Message = Message::new("unexpected", "Prefer using writable $derived instead of $state and $effect");
const SUGGEST_REWRITE: Message = Message::new("suggestRewrite", "Rewrite $state and $effect to $derived");

const CONDITIONS: &[Condition] = &[Condition {
    svelte_versions: &["5"],
    svelte_file_types: &[],
    runes: &[true],
    kit_file_types: &[],
    svelte_kit_versions: &[],
}];

/// `isEffectOrEffectPre`: `$effect(..)`, `$effect.pre(..)`.
fn is_effect(callee: Expr<'_>) -> bool {
    match callee.kind() {
        ExprKind::Ident(name) => name.is("$effect"),
        ExprKind::Dot { obj, name, .. } => obj.is_ident("$effect") && name.name().is("pre"),
        ExprKind::Index { obj, index, .. } => obj.is_ident("$effect") && index.is_ident("pre"),
        _ => false,
    }
}

impl Rule for PreferWritableDerived {
    const META: Meta = Meta::plugin(Plugin::Svelte, "prefer-writable-derived", Kind::Suggestion).recommended().has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferWritableDerived
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // Writable `$derived` came with Svelte 5.25.
        let runs = file.mentions("$effect") && file.mentions("$state") && should_run(file, CONDITIONS);
        (runs && has_compiler_at_least(file, [5, 25, 0])).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        if !is_effect(call.callee()) || call.args().len() != 1 {
            return;
        }
        // `isValidFunctionArgument`, `isValidAssignment`
        let Some(func) = call.args().first().and_then(Expr::as_fn) else {
            return;
        };
        if !matches!(func.kind(), FnKind::Arrow | FnKind::Expr) || !func.params().is_empty() {
            return;
        }
        let Some(statements) = func.body_statements() else {
            return;
        };
        let (Some(statement), 1) = (statements.first(), statements.len()) else {
            return;
        };
        let StmtKind::Expr(assignment) = statement.kind() else {
            return;
        };
        let Some((None, left, right)) = assignment.as_assign() else {
            return;
        };
        let Some(name) = left.as_ident() else {
            return;
        };
        let file = cx.file();
        let reference = Node::Stmt(statement).scope().references().find(|it| it.name() == name);
        let definition = reference.and_then(|it| file.svelte_reference(it)?.variable()?.definitions().next());
        let Some(definition) = definition.filter(|it| it.kind() == DefinitionKind::Declared(DeclarationKind::Variable))
        else {
            return;
        };
        let Some(DefNode::Program(Node::VarDecl(declarator))) = definition.node() else {
            return;
        };
        let Some(init) = declarator.init().filter(|it| it.as_call().is_some_and(|it| it.callee().is_ident("$state")))
        else {
            return;
        };
        cx.report(declarator, UNEXPECTED).suggest(SUGGEST_REWRITE, |fixer| {
            let derived = [&b"$derived("[..], file.slice(right.span()), b")"].concat();
            [fixer.replace(init, derived), fixer.remove(e)]
        });
    }
}
