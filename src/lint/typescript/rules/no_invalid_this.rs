use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_invalid_this::check;

/// Disallow `this` keywords outside of classes or class-like objects.
pub struct NoInvalidThis {
    cap_is_constructor: bool,
}

impl Rule for NoInvalidThis {
    const META: Meta =
        Meta::typescript("no-invalid-this", Kind::Suggestion).extends_base_rule("no-invalid-this");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoInvalidThis {
            cap_is_constructor: options.object(0).bool_or("capIsConstructor", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::This], |rule, e, cx| check(e, rule.cap_is_constructor, true, cx));
    }
}
