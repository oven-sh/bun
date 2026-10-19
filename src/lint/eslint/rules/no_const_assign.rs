use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_modifying_references;

/// Disallow reassigning `const`, `using`, and `await using` variables.
pub struct NoConstAssign;

const CONST: Message = Message::new("const", "'{{name}}' is constant.");

impl Rule for NoConstAssign {
    const META: Meta = Meta::eslint("no-const-assign", Kind::Problem).recommended().hints();
    const ON: On = On::new().symbols();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConstAssign
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.has_stmts([StmtTag::Var]).then_some(())
    }

    fn symbol<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        if !symbol.has_modifying_references() {
            return;
        }
        for declaration in symbol.declarations() {
            let (Declaration::Var(pat), Some(Node::VarDecl(decl))) = (declaration, declaration.node()) else {
                continue;
            };
            if !matches!(decl.var_kind(), VarKind::Const | VarKind::Using | VarKind::AwaitUsing) {
                continue;
            }
            for reference in get_modifying_references(symbol.references()) {
                // oxlint points at the declaration.
                let place = if cx.language().is_oxlint { pat.span() } else { reference.span() };
                let report = cx.report(place, CONST).data("name", reference.name()).hint_with(|| {
                    let line = cx.line_of(pat.span().start);
                    Some(match decl.var_kind() {
                        VarKind::Const => format!("It is declared with const on line {line}. Use let if it has to change."),
                        _ => format!("It is declared with using on line {line}, so it cannot change."),
                    })
                });
                report.labels_with(|labels| {
                    let name = bstr::BStr::new(reference.name().bytes());
                    labels.push(reference.span(), format!("{name} is re-assigned here."));
                });
            }
        }
    }
}
