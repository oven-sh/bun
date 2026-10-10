use bun_lint::prelude::*;

/// Enforce the use of top-level import type qualifier when an import only has specifiers with
/// inline type qualifiers.
pub struct NoImportTypeSideEffects;

const USE_TOP_LEVEL_QUALIFIER: Message = Message::new(
    "useTopLevelQualifier",
    "TypeScript will only remove the inline type specifiers which will leave behind a side effect import at runtime. Convert this to a top-level type qualifier to properly remove the entire import.",
);

/// `import {} from "a"`, which oxlint reports in TypeScript as it reports what has only `type` specifiers.
fn has_braces(statement: Stmt) -> bool {
    let (file, after_keyword) = (statement.file(), statement.span().start + "import".len() as u32);
    !file.is_javascript() && file.text().get(skip_trivia(file.text(), after_keyword) as usize) == Some(&b'{')
}

impl Rule for NoImportTypeSideEffects {
    const META: Meta =
        Meta::typescript("no-import-type-side-effects", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoImportTypeSideEffects
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Import(import) = statement.kind() else {
            return;
        };
        let named = import.named();
        if import.is_type_only()
            || import.default().is_some()
            || import.namespace().is_some()
            || named.is_empty() && !(cx.language().is_oxlint && has_braces(statement))
            || !named.iter().all(ImportSpec::is_type_only)
        {
            return;
        }
        cx.report(statement, USE_TOP_LEVEL_QUALIFIER).fix(|fixer| {
            let start = statement.span().start;
            let keyword = Span::new(start, start + "import".len() as u32);
            // The same text. The fix of oxlint starts at the keyword, which decides between it and another rule's.
            let mut fixes = vec![match fixer.file().language().is_oxlint {
                true => fixer.replace(keyword, "import type"),
                false => fixer.insert_after(keyword, " type"),
            }];
            fixes.extend(named.iter().map(|specifier| {
                fixer.remove(Span::new(specifier.span().start, specifier.imported().start()))
            }));
            fixes
        });
    }
}
