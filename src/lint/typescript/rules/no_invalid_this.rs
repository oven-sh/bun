use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_invalid_this::{Known, check};

/// Disallow `this` keywords outside of classes or class-like objects.
pub struct NoInvalidThis {
    cap_is_constructor: bool,
}

impl Rule for NoInvalidThis {
    const META: Meta =
        Meta::typescript("no-invalid-this", Kind::Suggestion).extends_base_rule("no-invalid-this");
    const ON: On = On::new().exprs(&[ExprTag::This]);
    type State<'a> = Known<'a>;

    fn new(options: &Options) -> Self {
        NoInvalidThis {
            cap_is_constructor: options.object(0).bool_or("capIsConstructor", true),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Known<'a>> {
        Some(Known::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        check(e, self.cap_is_constructor, true, cx);
    }
}
