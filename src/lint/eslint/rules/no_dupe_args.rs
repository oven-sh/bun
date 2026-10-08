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
        let mut names: SmallVec<[Name<'a>; 8]> = SmallVec::new();
        for param in params {
            param.pat().for_each_binding(&mut |binding| names.extend(binding.as_ident()));
        }
        for (i, name) in names.iter().enumerate() {
            // Once for each name, where it is first declared.
            if names[..i].contains(name) || !names[i + 1..].contains(name) {
                continue;
            }
            let (Some(open), Some(body)) = (ast_utils::get_opening_paren_of_params(func), func.body_span()) else {
                return;
            };
            let Some(last) = cx.file().token_before(body) else {
                return;
            };
            cx.report(open.to(last.span()), UNEXPECTED).data("name", *name);
        }
    }
}

impl Rule for NoDupeArgs {
    const META: Meta = Meta::eslint("no-dupe-args", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDupeArgs
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(Self::check_params);
    }
}
