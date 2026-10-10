use bun_lint::prelude::*;

/// Require using `namespace` keyword over `module` keyword to declare custom TypeScript modules.
pub struct PreferNamespaceKeyword;

const USE_NAMESPACE: Message = Message::new(
    "useNamespace",
    "Use 'namespace' instead of 'module' to declare custom TypeScript modules.",
);

impl Rule for PreferNamespaceKeyword {
    const META: Meta = Meta::typescript("prefer-namespace-keyword", Kind::Suggestion)
        .fixable(Fixable::Code)
        .recommended();
    const ON: On = On::new().stmts(&[StmtTag::Module]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferNamespaceKeyword
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Module(module) = stmt.kind() else {
            return;
        };
        let ModuleName::Ident(name) = module.name() else {
            return;
        };
        // The `B` of `module A.B {}` is part of the declaration of `A`.
        if !module.uses_module_keyword() || stmt.span().start == name.start() {
            return;
        }
        let start = match stmt.modifiers().last() {
            Some(last) => skip_trivia(cx.text(), last.span().end),
            None => stmt.span().start,
        };
        let keyword = Span::new(start, start + "module".len() as u32);
        cx.report(stmt.span_without_export(), USE_NAMESPACE)
            .fix(|fixer| fixer.replace(keyword, "namespace"));
    }
}
