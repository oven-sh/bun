use bun_lint::prelude::*;

/// Enforce the use of top-level import type qualifier when an import only has specifiers with
/// inline type qualifiers.
pub struct NoImportTypeSideEffects;

const USE_TOP_LEVEL_QUALIFIER: Message = Message::new(
    "useTopLevelQualifier",
    "TypeScript will only remove the inline type specifiers which will leave behind a side effect import at runtime. Convert this to a top-level type qualifier to properly remove the entire import.",
);

impl Rule for NoImportTypeSideEffects {
    const META: Meta =
        Meta::typescript("no-import-type-side-effects", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImportTypeSideEffects
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Import], |_, statement, cx| {
            let StmtKind::Import(import) = statement.kind() else {
                return;
            };
            let named = import.named();
            if import.is_type_only()
                || import.default().is_some()
                || import.namespace().is_some()
                || named.is_empty()
                || !named.iter().all(ImportSpec::is_type_only)
            {
                return;
            }
            cx.report(statement, USE_TOP_LEVEL_QUALIFIER).fix(|fixer| {
                let start = statement.span().start;
                let keyword = Span::new(start, start + "import".len() as u32);
                let mut fixes = vec![fixer.insert_after(keyword, " type")];
                fixes.extend(named.iter().map(|specifier| {
                    fixer.remove(Span::new(specifier.span().start, specifier.imported().start()))
                }));
                fixes
            });
        });
    }
}
