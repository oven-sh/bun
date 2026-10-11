use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Prefer `String#slice()` over `String#substr()` and `String#substring()`.
pub struct PreferStringSlice;

const PREFER_STRING_SLICE: Message = Message::new("", "Prefer String#slice() over String#{{method_name}}()");

impl Rule for PreferStringSlice {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-string-slice", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// Those of `substr` and `substring` that the file mentions.
    type State<'a> = SmallVec<[Name<'a>; 2]>;

    fn new(_: &Options) -> Self {
        PreferStringSlice
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let methods: Self::State<'a> = ["substr", "substring"].into_iter().filter_map(|it| file.find_name(it)).collect();
        (!methods.is_empty()).then_some(methods)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call() else {
            return;
        };
        let callee = call_expr.callee();
        if callee.tag() == ExprTag::Ident || callee.member_name().is_some_and(|it| !cx.state.contains(&it.name())) {
            return;
        }
        let Some(property) = get_member_expr(callee).filter(|it| !it.is_private_member()).and_then(Expr::member_name) else {
            return;
        };
        if !cx.state.contains(&property.name()) {
            return;
        }
        cx.report(property, PREFER_STRING_SLICE).data("method_name", property).fix(|fixer| {
            let args = call_expr.args();
            let is_safe = match property.name().is("substr") {
                true => args.len() < 2 && !args.iter().any(|it| it.tag() == ExprTag::Spread),
                false => is_safe_substring_arguments(args),
            };
            is_safe.then(|| fixer.replace(property, "slice"))
        });
    }
}

/// No more than two integers that are not negative, in order.
fn is_safe_substring_arguments<'a>(arguments: List<'a, Expr<'a>>) -> bool {
    let mut previous = 0.0;
    arguments.len() <= 2
        && arguments.iter().all(|it| match get_inner_expression(it).kind() {
            ExprKind::Number(value) if value >= previous && value.fract() == 0.0 => {
                previous = value;
                true
            }
            _ => false,
        })
}
