use bun_lint::prelude::*;

/// Enforce default parameters to be last.
pub struct DefaultParamLast;

const SHOULD_BE_LAST: Message = Message::new("shouldBeLast", "Default parameters should be last.");

/// The range of ESLint's element of `params`: a `TSParameterProperty` has the keywords before the
/// parameter, and the decorators before those.
fn estree_span(param: Param) -> Span {
    match param.modifiers().iter().any(|it| it.decorator().is_none()) {
        true => param.span(),
        false => param.span_without_modifiers(),
    }
}

/// `reports_rest`: whether a rest parameter before a required one is reported too, which is an
/// error that only TypeScript's parser lets through.
pub fn check<'a, R: Rule>(func: Func<'a>, reports_rest: bool, cx: &Cx<'a, R>) {
    if !ast_utils::is_function_with_body(func) {
        return;
    }
    let mut has_seen_required_parameter = false;
    for param in func.params().iter().rev() {
        // `...a = []` is an error, and a `RestElement` for ESLint.
        let has_default = param.default().is_some() && !param.is_rest();
        if !has_default && !param.is_rest() && !param.is_optional() {
            has_seen_required_parameter = true;
        } else if has_seen_required_parameter && (reports_rest || has_default || param.is_optional()) {
            cx.report(estree_span(param), SHOULD_BE_LAST);
        }
    }
}

impl Rule for DefaultParamLast {
    const META: Meta = Meta::eslint("default-param-last", Kind::Suggestion);
    const ON: On = On::new().funcs();
    no_state!();

    fn new(_: &Options) -> Self {
        DefaultParamLast
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        check(func, true, cx);
    }
}
