use crate::oxlint::vue::{definitely_returns_in_all_codepaths, get_computed_getter_context, is_vue_file};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that a `return` statement is present in every computed property.
pub struct ReturnInComputedProperty {
    treat_undefined_as_unspecified: bool,
}

const RETURN_IN_COMPUTED_PROPERTY: Message = Message::new("", "Expected to return a value in computed property.");

impl Rule for ReturnInComputedProperty {
    const META: Meta = Meta::oxlint(Plugin::Vue, "return-in-computed-property", Kind::Problem);
    const ON: On = On::new().funcs();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ReturnInComputedProperty { treat_undefined_as_unspecified: options.object(0).bool_or("treatUndefinedAsUnspecified", true) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_file(file) || !file.mentions("computed") {
            return None;
        }
        Some(())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if get_computed_getter_context(func).is_some()
            && !definitely_returns_in_all_codepaths(func, self.treat_undefined_as_unspecified)
        {
            cx.report(func.estree_span(), RETURN_IN_COMPUTED_PROPERTY);
        }
    }
}
