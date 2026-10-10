use super::no_extra_bind::{OwnKeywords, own_keywords};
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashSet;

/// Require using arrow functions for callbacks.
pub struct PreferArrowCallback {
    allow_named_functions: bool,
    allow_unbound_this: bool,
}

const PREFER_ARROW_CALLBACK: Message =
    Message::new("preferArrowCallback", "Unexpected function expression.");

/// By an operand of a logical or a conditional expression: the outermost of these expressions that
/// can have its value.
type Values<'a> = AncestorMemo<'a, Node<'a>>;

/// Whether the value of `child` is not that of `parent`, which it is directly in.
fn is_outermost_with_value<'a>(child: Node<'a>, parent: Node<'a>) -> Option<Node<'a>> {
    let is_value_of_parent = match parent.as_expr().map(Expr::kind) {
        Some(ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish,
            ..
        }) => true,
        // The test of a conditional is never its value. oxlint takes it for that.
        Some(ExprKind::Cond { test, .. }) => Node::Expr(test) != child || parent.file().language().is_oxlint,
        // oxlint goes on from the end of a sequence.
        Some(ExprKind::Binary { op: BinOp::Comma, right, .. }) => {
            Node::Expr(right) == child && parent.file().language().is_oxlint
        }
        _ => false,
    };
    (!is_value_of_parent).then_some(child)
}

/// ESLint's `getCallbackInfo`. `None` if `function` is not a callback, otherwise whether it is with
/// `.bind(this)`.
fn is_callback_with_lexical_this<'a>(function: Expr<'a>, values: &mut Values<'a>) -> Option<bool> {
    let mut current = function;
    let mut is_lexical_this = None;
    loop {
        current = values.find(current.into(), is_outermost_with_value)?.as_expr()?;
        let parent = current.parent().as_expr()?;
        match parent.kind() {
            ExprKind::Dot { obj, name, .. } if obj == current && name.name().is("bind") => {}
            // Upstream takes `[bind]` for `.bind`.
            ExprKind::Index { obj, index, .. } if obj == current && index.is_ident("bind") => {}
            ExprKind::Call(call) | ExprKind::New(call) => {
                return (call.callee() != current).then(|| is_lexical_this.unwrap_or(false));
            }
            _ => return None,
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

/// oxlint's `ScopeScanner`: it looks at the body alone, and at nothing of a class in it.
fn own_keywords_as_oxlint(func: Func) -> OwnKeywords {
    let mut found = OwnKeywords::default();
    let mut pending: Vec<Node> = func.body_statements().into_iter().flatten().map(Node::Stmt).collect();
    while let Some(node) = pending.pop() {
        match node {
            Node::Expr(e) if found.note(e) => {}
            Node::Class(_) => {}
            Node::Func(inner) if !inner.is_arrow() => {}
            _ => node.for_each_child(|child| pending.push(child)),
        }
    }
    found
}

/// In what oxc takes for a script, the `await` of `await (function () {})()` that is in no function is a function,
/// which is called with `function`.
fn is_argument_of_await<'a>(function: Expr<'a>) -> bool {
    let mut leftmost = function;
    while let Node::Expr(parent) = leftmost.parent() {
        let is_leftmost_of_parent = match parent.kind() {
            ExprKind::Await(_) => {
                return utils::oxlint::is_script(function.file()) && Node::Expr(parent).enclosing_function().is_none();
            }
            ExprKind::Call(call) => call.callee() == leftmost,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj == leftmost,
            _ => false,
        };
        if !is_leftmost_of_parent || parent.is_parenthesized() {
            return false;
        }
        leftmost = parent;
    }
    false
}

/// The name of a parameter that is nothing but a name.
fn simple_name(param: Param<'_>) -> Option<Name<'_>> {
    (param.default().is_none() && !param.is_rest()).then(|| param.pat().as_ident()).flatten()
}

/// ESLint's `hasDuplicateParams`.
fn has_duplicate_params(func: Func) -> bool {
    let mut names = FxHashSet::default();
    let mut has_duplicate = false;
    for param in func.params() {
        match simple_name(param) {
            Some(name) => has_duplicate |= !names.insert(name),
            None => return false,
        }
    }
    has_duplicate
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

/// oxlint's `build_fix`: the arrow function in the place of the whole function, or of `function () {}.bind(this)`.
fn fix_as_oxlint<'a>(fixer: Fixer<'a>, e: Expr<'a>, func: Func<'a>, is_lexical_this: bool) -> Option<Fix> {
    let file = fixer.file();
    let (params, body) = (func.params_span()?, func.body_span()?);
    // `: T`
    let return_type = func.return_type().map(|it| Span::new(skip_trivia(file.text(), params.end), it.outer_span().end));
    let arrow = [
        if func.is_async() { &b"async "[..] } else { b"" },
        func.type_params().angle_brackets_span().map_or(&b""[..], |it| file.slice(it)),
        file.slice(params),
        return_type.map_or(&b""[..], |it| file.slice(it)),
        b" =>",
        file.slice(Span::new(return_type.unwrap_or(params).end, body.end)),
    ];
    let replaced = match is_lexical_this {
        true => {
            let member = e.parent().as_expr().filter(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index))?;
            member.parent().as_expr()?
        }
        false => e,
    };
    let is_in_call_or_conditional =
        matches!(replaced.parent().as_expr().map(Expr::tag), Some(ExprTag::Call | ExprTag::New | ExprTag::Cond));
    Some(match is_in_call_or_conditional || replaced.is_parenthesized() {
        true => fixer.replace(replaced, arrow.concat()),
        false => fixer.replace(replaced, [&b"("[..], &arrow.concat(), b")"].concat()),
    })
}

impl Rule for PreferArrowCallback {
    const META: Meta = Meta::eslint("prefer-arrow-callback", Kind::Suggestion).fixable(Fixable::Code).reports_on_exit();
    const ON: On = On::new().exprs(&[ExprTag::Fn]);
    type State<'a> = Values<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        PreferArrowCallback {
            allow_named_functions: options.bool_or("allowNamedFunctions", false),
            allow_unbound_this: options.bool_or("allowUnboundThis", true),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Values<'a>> {
        Some(Values::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Fn(func) = e.kind() else {
            return;
        };
        if func.kind() != FnKind::Expr
            || func.is_generator()
            || self.allow_named_functions && func.name().is_some()
        {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let is_lexical_this = match is_callback_with_lexical_this(e, &mut cx.state) {
            Some(is_lexical_this) => is_lexical_this,
            None if is_oxlint && e.is_parenthesized() && is_argument_of_await(e) => false,
            None => return,
        };
        let own = if is_oxlint { own_keywords_as_oxlint(func) } else { own_keywords(func, false) };
        if own.has_super
            || own.new_target
            || self.allow_unbound_this && own.this && !is_lexical_this
            // oxlint looks for the name in the body alone.
            || func.symbol().is_some_and(|name| match func.body_span().filter(|_| is_oxlint) {
                Some(body) => name.references().any(|it| body.contains(it.span())),
                None => name.references().len() > 0,
            })
            || uses_arguments(func)
        {
            return;
        }
        cx.report(e, PREFER_ARROW_CALLBACK).fix(|fixer| {
            // Without `.bind(this)` there is no telling what `this` should be.
            if !is_lexical_this && own.this || has_duplicate_params(func) || func.this_param().is_some() {
                return None;
            }
            match is_oxlint {
                true => fix_as_oxlint(fixer, e, func, is_lexical_this).map(|it| vec![it]),
                false => fix(fixer, e, func, is_lexical_this),
            }
        });
    }
}
