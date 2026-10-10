use bun_lint::prelude::*;

/// Require generator functions to contain `yield`.
pub struct RequireYield;

const MISSING_YIELD: Message =
    Message::new("missingYield", "This generator function does not have 'yield'.");

impl Rule for RequireYield {
    const META: Meta = Meta::eslint("require-yield", Kind::Suggestion).recommended();
    const ON: On = On::new().funcs();
    no_state!();

    fn new(_: &Options) -> Self {
        RequireYield
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.is_generator()
            && func.body_statements().is_some_and(|body| !body.is_empty())
            && func.yields().next().is_none()
        {
            // oxlint points at the name of the function, if it has one of its own.
            let place = match func.name() {
                // Before ESLint 10 it is the whole function.
                _ if cx.language().eslint_major < 10 => func.estree_span(),
                _ if !cx.language().is_oxlint => ast_utils::get_function_head_loc(func),
                Some(name) => name.span(),
                None => func.estree_span(),
            };
            cx.report(place, MISSING_YIELD);
        }
    }
}
