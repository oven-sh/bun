use bun_lint::prelude::*;
use bun_lint_eslint::rules::class_methods_use_this::{
    Checker, IgnoreClassesWithImplements, MISSING_THIS, State,
};

/// Enforce that class methods utilize `this`.
pub struct ClassMethodsUseThis {
    checker: Checker,
}

impl Rule for ClassMethodsUseThis {
    const META: Meta = Meta::typescript("class-methods-use-this", Kind::Suggestion)
        .extends_base_rule("class-methods-use-this");
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let key = "ignoreClassesThatImplementAnInterface";
        let ignore_classes_with_implements = match (options.bool(key), options.str(key)) {
            (Some(true), _) => IgnoreClassesWithImplements::All,
            (_, Some("public-fields")) => IgnoreClassesWithImplements::PublicFields,
            _ => IgnoreClassesWithImplements::None,
        };
        ClassMethodsUseThis {
            checker: Checker::new(options, ignore_classes_with_implements, true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if file.has_classes() {
            on.members(|rule, member, cx| rule.checker.check_member(member, &mut cx.state));
            on.exprs([ExprTag::This, ExprTag::Super], |rule, e, cx| {
                rule.checker.mark_this_used(e, &mut cx.state);
            });
            on.finish(|_, cx| {
                for func in cx.state.methods_without_this() {
                    cx.report(ts_utils::get_function_head_loc(func), MISSING_THIS)
                        .data("name", eslint_utils::get_function_name_with_kind(func, false));
                }
            });
        }
        State::default()
    }
}
