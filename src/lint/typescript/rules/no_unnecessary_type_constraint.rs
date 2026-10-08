use bun_lint::prelude::*;

/// Disallow unnecessary constraints on generic types.
pub struct NoUnnecessaryTypeConstraint;

const REMOVE_UNNECESSARY_CONSTRAINT: Message = Message::new(
    "removeUnnecessaryConstraint",
    "Remove the unnecessary `{{constraint}}` constraint.",
);
const UNNECESSARY_CONSTRAINT: Message = Message::new(
    "unnecessaryConstraint",
    "Constraining the generic type `{{name}}` to `{{constraint}}` does nothing and is unnecessary.",
);

/// Upstream's `checkRequiresGenericDeclarationDisambiguation`: in such a file `<T>() => {}` is not
/// an arrow function.
fn requires_generic_declaration_disambiguation(path: &[u8]) -> bool {
    let Some((before, extension)) = path.split_last_chunk::<4>() else {
        return false;
    };
    !matches!(before.last(), None | Some(b'/' | b'\\'))
        && [b".cts", b".mts", b".tsx"].iter().any(|it| extension.eq_ignore_ascii_case(*it))
}

impl Rule for NoUnnecessaryTypeConstraint {
    const META: Meta = Meta::typescript("no-unnecessary-type-constraint", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessaryTypeConstraint
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.type_params(|_, param, cx| {
            let Some(constraint) = param.constraint() else {
                return;
            };
            let TypeKind::Keyword(keyword @ (Keyword::Any | Keyword::Unknown)) = constraint.kind() else {
                return;
            };
            let parent = param.parent();
            // That of an `infer` or of a mapped type is not in a list of type parameters.
            if matches!(parent, Node::Type(_)) {
                return;
            }
            cx.report(param, UNNECESSARY_CONSTRAINT)
                .data("name", param.name())
                .data("constraint", keyword.text())
                .suggest_with(
                    REMOVE_UNNECESSARY_CONSTRAINT,
                    &[("constraint", keyword.text())],
                    |fixer| {
                        let file = fixer.file();
                        // Only `<T>() => {}` needs a trailing comma.
                        let adds_trailing_comma = matches!(parent, Node::Func(func)
                            if func.is_arrow() && func.type_params().len() == 1)
                            && requires_generic_declaration_disambiguation(file.path())
                            && file.text().get(skip_trivia(file.text(), param.span().end) as usize) != Some(&b',')
                            && param.default().is_none();
                        fixer.replace(
                            Span::new(param.name().span().end, constraint.span().end),
                            if adds_trailing_comma { "," } else { "" },
                        )
                    },
                );
        });
    }
}
