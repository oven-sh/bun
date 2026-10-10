use bun_lint::prelude::*;

/// Require each enum member value to be explicitly initialized.
pub struct PreferEnumInitializers;

const DEFINE_INITIALIZER: Message = Message::new(
    "defineInitializer",
    "The value of the member '{{ name }}' should be explicitly defined.",
);
const DEFINE_INITIALIZER_SUGGESTION: Message = Message::new(
    "defineInitializerSuggestion",
    "Can be fixed to {{ name }} = {{ suggested }}",
);

impl Rule for PreferEnumInitializers {
    const META: Meta = Meta::typescript("prefer-enum-initializers", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().stmts(&[StmtTag::Enum]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferEnumInitializers
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Enum(declaration) = stmt.kind() else {
            return;
        };
        for (index, member) in declaration.members().iter().enumerate() {
            if member.init().is_some() {
                continue;
            }
            let name = member.text();
            let mut report = cx.report(member, DEFINE_INITIALIZER).data("name", name);
            let suggestions = [
                index.to_string().into_bytes(),
                (index + 1).to_string().into_bytes(),
                [&b"'"[..], name, b"'"].concat(),
            ];
            for suggested in suggestions.iter().map(Vec::as_slice) {
                report = report.suggest_with(
                    DEFINE_INITIALIZER_SUGGESTION,
                    &[("name", name), ("suggested", suggested)],
                    |fixer| fixer.replace(member, [name, b" = ", suggested].concat()),
                );
            }
        }
    }
}
