use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow TypeScript `const enum`
pub struct NoConstEnum;

const NO_CONST_ENUM: Message = Message::new("", "Unexpected const enum");

impl Rule for NoConstEnum {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-const-enum", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConstEnum
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Enum], |_, statement, cx| {
            let StmtKind::Enum(enum_decl) = statement.kind() else {
                return;
            };
            if !enum_decl.flags().contains(Flags::CONST) {
                return;
            }
            // Where `declare const enum` starts too.
            let start = statement.span_without_export().start;
            cx.report(Span::new(start, start + 5), NO_CONST_ENUM).fix(|fixer| {
                let file = fixer.file();
                let keyword = file.end_of_token_before(enum_decl.name().span().start).saturating_sub(4);
                let before = Span::new(start, keyword);
                (file.comments_in(before).next().is_none()).then(|| fixer.remove(before))
            });
        });
    }
}
