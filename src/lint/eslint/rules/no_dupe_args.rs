use bun_lint::prelude::*;
use smallvec::SmallVec;

/// Disallow duplicate arguments in `function` definitions.
pub struct NoDupeArgs;

const UNEXPECTED: Message = Message::new("unexpected", "Duplicate param '{{name}}'.");

impl NoDupeArgs {
    fn check_params<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        // A `FunctionDeclaration` or a `FunctionExpression`.
        if !func.has_body()
            || !matches!(
                func.kind(),
                FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
            )
        {
            return;
        }
        let params = func.params();
        match params.len() {
            0 => return,
            1 if params.first().is_some_and(|only| only.pat().tag() == PatTag::Ident) => return,
            _ => {}
        }
        // Each name that is declared several times, where it is first declared.
        let mut names: SmallVec<[Name<'a>; 1]> = SmallVec::new();
        for param in params {
            param.pat().for_each_binding(&mut |binding| {
                let mut definitions = binding.symbol().into_iter().flat_map(Symbol::declarations).filter_map(|def| match def {
                    Declaration::Param(it) => Some(it),
                    _ => None,
                });
                if definitions.next() == Some(binding) && definitions.next().is_some() {
                    names.extend(binding.as_ident());
                }
            });
        }
        for name in names {
            let (Some(open), Some(body)) = (ast_utils::get_opening_paren_of_params(func), func.body_span()) else {
                return;
            };
            let Some(last) = cx.file().token_before(body) else {
                return;
            };
            cx.report(open.to(last.span()), UNEXPECTED).data("name", name);
        }
    }
}

impl Rule for NoDupeArgs {
    const META: Meta = Meta::eslint("no-dupe-args", Kind::Problem).recommended();
    const ON: On = On::new().funcs();
    no_state!();

    fn new(_: &Options) -> Self {
        NoDupeArgs
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        self.check_params(func, cx);
    }
}
