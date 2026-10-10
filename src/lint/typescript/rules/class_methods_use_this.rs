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
        .extends_base_rule("class-methods-use-this")
        .reports_on_exit();
    const ON: On = On::new()
        .exprs(&[ExprTag::This, ExprTag::Super])
        .members()
        .finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let key = "ignoreClassesThatImplementAnInterface";
        // oxlint, where this rule runs as `class-methods-use-this`, has the option as ESLint calls it.
        let of_eslint = options.str("ignoreClassesWithImplements");
        let ignore_classes_with_implements = match (options.bool(key), options.str(key).or(of_eslint)) {
            (Some(true), _) | (_, Some("all")) => IgnoreClassesWithImplements::All,
            (_, Some("public-fields")) => IgnoreClassesWithImplements::PublicFields,
            _ => IgnoreClassesWithImplements::None,
        };
        ClassMethodsUseThis {
            // As for ESLint, a private name is not public there.
            checker: Checker::new(options, ignore_classes_with_implements, of_eslint.is_none()),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        file.has_classes().then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.checker.mark_this_used(e, &mut cx.state);
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        self.checker.check_member(member, &mut cx.state);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for func in cx.state.methods_without_this() {
            // oxlint points at the key.
            let key = match func.owner() {
                _ if !cx.language().is_oxlint => None,
                Node::Member(member) => member.key(),
                Node::Expr(value) => match value.parent() {
                    Node::Member(member) => member.key(),
                    _ => None,
                },
                _ => None,
            };
            let head = || ts_utils::get_function_head_loc(func);
            let place = key.map_or_else(head, |it| it.inner_span(cx.file()));
            let name = match (cx.language().is_oxlint, key.and_then(utils::oxlint::property_key_name)) {
                (false, _) => eslint_utils::get_function_name_with_kind(func, false),
                (true, Some(name)) => [&b" `"[..], name, b"`"].concat(),
                (true, None) => Vec::new(),
            };
            cx.report(place, MISSING_THIS).data("name", name);
        }
    }
}
