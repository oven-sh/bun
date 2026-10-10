use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_modifying_references;

/// Disallow reassigning `const`, `using`, and `await using` variables.
pub struct NoConstAssign;

const CONST: Message = Message::new("const", "'{{name}}' is constant.");

impl Rule for NoConstAssign {
    const META: Meta = Meta::eslint("no-const-assign", Kind::Problem).recommended();
    const ON: On = On::new().var_decls();
    no_state!();

    fn new(_: &Options) -> Self {
        NoConstAssign
    }

    fn var_decl<'a>(&self, decl: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(decl.var_kind(), VarKind::Const | VarKind::Using | VarKind::AwaitUsing) {
            return;
        }
        decl.pat().for_each_binding(&mut |pat| {
            let Some(symbol) = pat.symbol().filter(|it| it.has_modifying_references()) else {
                return;
            };
            for reference in get_modifying_references(symbol.references()) {
                // oxlint points at the declaration.
                let place = if cx.language().is_oxlint { pat.span() } else { reference.span() };
                cx.report(place, CONST).data("name", reference.name()).labels_with(|labels| {
                    let name = bstr::BStr::new(reference.name().bytes());
                    labels.push(reference.span(), format!("{name} is re-assigned here."));
                });
            }
        });
    }
}
