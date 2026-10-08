use super::no_extra_bind::own_keywords;
use bun_lint::prelude::*;

/// Require using arrow functions for callbacks.
pub struct PreferArrowCallback {
    allow_named_functions: bool,
    allow_unbound_this: bool,
}

const PREFER_ARROW_CALLBACK: Message =
    Message::new("preferArrowCallback", "Unexpected function expression.");

/// ESLint's `getCallbackInfo`. `None` if `function` is not a callback, otherwise whether it is with
/// `.bind(this)`.
fn is_callback_with_lexical_this(function: Expr) -> Option<bool> {
    let mut current = function;
    let mut is_lexical_this = None;
    loop {
        let parent = current.parent().as_expr()?;
        let is_bind = match parent.kind() {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => false,
            // The test of a conditional is never its value.
            ExprKind::Cond { test, .. } if test != current => false,
            ExprKind::Dot { obj, name, .. } if obj == current && name.name().is("bind") => true,
            // Upstream takes `[bind]` for `.bind`.
            ExprKind::Index { obj, index, .. } if obj == current && index.is_ident("bind") => true,
            ExprKind::Call(call) | ExprKind::New(call) => {
                return (call.callee() != current).then(|| is_lexical_this.unwrap_or(false));
            }
            _ => return None,
        };
        if !is_bind {
            current = parent;
            continue;
        }
        let bound = parent.parent().as_expr()?;
        let call = bound.as_call().filter(|call| call.callee() == parent)?;
        // Only the first `.bind()` counts.
        if is_lexical_this.is_none() {
            let args = call.args();
            is_lexical_this = Some(args.len() == 1 && args.first().is_some_and(|it| it.tag() == ExprTag::This));
        }
        current = bound;
    }
}

/// The name of a parameter that is nothing but a name.
fn simple_name(param: Param<'_>) -> Option<Name<'_>> {
    (param.default().is_none() && !param.is_rest()).then(|| param.pat().as_ident()).flatten()
}

/// ESLint's `hasDuplicateParams`.
fn has_duplicate_params(func: Func) -> bool {
    let params = func.params();
    params.iter().all(|it| simple_name(it).is_some())
        && params.iter().enumerate().any(|(i, param)| {
            params.iter().take(i).any(|earlier| simple_name(earlier) == simple_name(param))
        })
}

fn uses_arguments(func: Func) -> bool {
    let first = func.scope().and_then(|scope| scope.symbols().next());
    first.is_some_and(|it| it.is_implicit_arguments() && it.references().len() > 0)
}

fn fix<'a>(fixer: Fixer<'a>, e: Expr<'a>, func: Func<'a>, is_lexical_this: bool) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let function_token = file.tokens_in(e).nth(usize::from(func.is_async()))?;
    let left_paren = file.tokens_after(function_token).find(ast_utils::is_opening_paren_token)?;
    if func.is_async() && file.line_of(function_token.end()) < file.line_of(left_paren.start()) {
        return None;
    }
    let mut fixes = Vec::with_capacity(6);
    let mut replaced = e;

    if is_lexical_this {
        // `(foo || function(){}).bind(this)` stays.
        let member = e.parent().as_expr().filter(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index))?;
        let call = member.parent().as_expr()?;
        let first = file.tokens_after(e).find(ast_utils::is_not_closing_paren_token)?;
        let last = file.last_token(call)?;
        if ast_utils::is_parenthesised(member) || file.comments_exist_between(first, last) {
            return None;
        }
        fixes.push(fixer.remove(Span::new(first.start(), last.end())));
        replaced = call;
    }

    let before_body = file.token_before(Span::empty(func.body_span()?.start))?;
    if file.comments_exist_between(function_token, left_paren) {
        fixes.push(fixer.remove(function_token));
        if let Some(name) = func.name() {
            fixes.push(fixer.remove(name));
        }
    } else {
        fixes.push(fixer.remove(Span::new(function_token.start(), left_paren.start())));
    }
    fixes.push(fixer.insert_after(before_body, " =>"));

    // `foo || () => {}` is invalid syntax. ESLint has a `ChainExpression` around a chain.
    let is_in_call_or_conditional = !replaced.is_chain_root()
        && matches!(replaced.parent().as_expr().map(Expr::tag), Some(ExprTag::Call | ExprTag::Cond));
    if !is_in_call_or_conditional && !ast_utils::is_parenthesised(replaced) && !ast_utils::is_parenthesised(e) {
        fixes.push(fixer.insert_before(replaced, "("));
        fixes.push(fixer.insert_after(replaced, ")"));
    }
    Some(fixes)
}

impl PreferArrowCallback {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Fn(func) = e.kind() else {
            return;
        };
        if func.kind() != FnKind::Expr
            || func.is_generator()
            || self.allow_named_functions && func.name().is_some()
        {
            return;
        }
        let Some(is_lexical_this) = is_callback_with_lexical_this(e) else {
            return;
        };
        let own = own_keywords(func, false);
        if own.has_super
            || own.new_target
            || self.allow_unbound_this && own.this && !is_lexical_this
            || func.symbol().is_some_and(|name| name.references().len() > 0)
            || uses_arguments(func)
        {
            return;
        }
        cx.report(e, PREFER_ARROW_CALLBACK).fix(|fixer| {
            // Without `.bind(this)` there is no telling what `this` should be.
            if !is_lexical_this && own.this || has_duplicate_params(func) || func.this_param().is_some() {
                return None;
            }
            fix(fixer, e, func, is_lexical_this)
        });
    }
}

impl Rule for PreferArrowCallback {
    const META: Meta = Meta::eslint("prefer-arrow-callback", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        PreferArrowCallback {
            allow_named_functions: options.bool_or("allowNamedFunctions", false),
            allow_unbound_this: options.bool_or("allowUnboundThis", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Fn], Self::check);
    }
}
