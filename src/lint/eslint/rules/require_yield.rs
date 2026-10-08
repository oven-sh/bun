use bun_lint::prelude::*;

/// Require generator functions to contain `yield`.
pub struct RequireYield;

const MISSING_YIELD: Message =
    Message::new("missingYield", "This generator function does not have 'yield'.");

impl Rule for RequireYield {
    const META: Meta = Meta::eslint("require-yield", Kind::Suggestion).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireYield
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(|_, func, cx| {
            if func.is_generator()
                && func.body_statements().is_some_and(|body| !body.is_empty())
                && func.yields().next().is_none()
            {
                cx.report(ast_utils::get_function_head_loc(func), MISSING_YIELD);
            }
        });
    }
}
