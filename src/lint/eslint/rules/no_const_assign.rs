use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_modifying_references;

/// Disallow reassigning `const`, `using`, and `await using` variables.
pub struct NoConstAssign;

const CONST: Message = Message::new("const", "'{{name}}' is constant.");

impl NoConstAssign {
    fn check<'a>(&self, decl: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(decl.var_kind(), VarKind::Const | VarKind::Using | VarKind::AwaitUsing) {
            return;
        }
        decl.pat().for_each_binding(&mut |pat| {
            let Some(symbol) = pat.symbol().filter(|it| it.has_modifying_references()) else {
                return;
            };
            for reference in get_modifying_references(symbol.references()) {
                cx.report(reference, CONST).data("name", reference.name());
            }
        });
    }
}

impl Rule for NoConstAssign {
    const META: Meta = Meta::eslint("no-const-assign", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConstAssign
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.var_decls(Self::check);
    }
}
