use bun_lint::prelude::*;

/// Disallow reassigning `function` declarations.
pub struct NoFuncAssign;

const IS_A_FUNCTION: Message = Message::new("isAFunction", "'{{name}}' is a function.");

impl NoFuncAssign {
    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        // oxlint says it for each function of the name, also for one without a body, whatever else has the name.
        let is_oxlint = cx.language().is_oxlint;
        if !matches!(func.kind(), FnKind::Decl | FnKind::Expr) || !func.has_body() && !is_oxlint {
            return;
        }
        // A parameter is declared before anything else of its name, so only the name of the
        // function can be a variable whose first definition is a function.
        let Some(symbol) = func.symbol().filter(|it| it.has_modifying_references()) else {
            return;
        };
        if !matches!(symbol.declarations().next(), Some(Declaration::Fn(_))) && !is_oxlint {
            return;
        }
        for reference in ast_utils::get_modifying_references(symbol.references()) {
            cx.report(reference, IS_A_FUNCTION).data("name", reference.name());
        }
    }
}

impl Rule for NoFuncAssign {
    const META: Meta = Meta::eslint("no-func-assign", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoFuncAssign
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check);
    }
}
