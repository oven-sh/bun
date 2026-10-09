use bun_lint_oxlint::text::find_next_token_within;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that named import blocks are not empty.
pub struct NoEmptyNamedBlocks;

const NO_EMPTY_NAMED_BLOCKS: Message = Message::new("", "Unexpected empty named `import` block.");

impl Rule for NoEmptyNamedBlocks {
    const META: Meta =
        Meta::oxlint(Plugin::Import, "no-empty-named-blocks", Kind::Problem).fixable(Fixable::Code).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoEmptyNamedBlocks
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            let StmtKind::Import(import) = stmt.kind() else {
                return;
            };
            if import.namespace().is_some() || !import.named().is_empty() {
                return;
            }
            let Some(specifier) = import.default() else {
                // Without an `import {} from "a"` the module `a` is not run. An `import type` runs nothing.
                if import.has_named_imports() {
                    let report = cx.report(stmt, NO_EMPTY_NAMED_BLOCKS);
                    match import.is_type_only() {
                        true => report.fix(|fixer| fixer.remove(stmt)),
                        false => report.suggest(NO_EMPTY_NAMED_BLOCKS, |fixer| fixer.remove(stmt)),
                    };
                }
                return;
            };
            // As oxlint: a `,` and a `from` anywhere in what follows, also in the specifier and in the attributes.
            let (start, end) = (specifier.span().end, stmt.span().end);
            if let Some(comma) = find_next_token_within(cx.file(), start, end, b",")
                && let Some(from) = find_next_token_within(cx.file(), comma, end, b"from")
            {
                cx.report(stmt, NO_EMPTY_NAMED_BLOCKS).fix(|fixer| fixer.replace(Span::new(start, from), " "));
            }
        });
    }
}
