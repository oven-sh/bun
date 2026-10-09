use bun_lint::prelude::*;

/// Disallow unnecessary constructors.
pub struct NoUselessConstructor;

const NO_USELESS_CONSTRUCTOR: Message = Message::new("noUselessConstructor", "Useless constructor.");
/// What oxlint says instead.
const EMPTY_CONSTRUCTOR: Message = Message::new("noUselessConstructor", "Empty constructors are unnecessary");
const REDUNDANT_SUPER_CALL: Message = Message::new("noUselessConstructor", "Redundant super call in constructor");
const REMOVE_CONSTRUCTOR: Message = Message::new("removeConstructor", "Remove the constructor.");

/// The arguments, if `body` is a single call of `super`.
fn single_super_call<'a>(body: List<'a, Stmt<'a>>) -> Option<List<'a, Expr<'a>>> {
    if body.len() != 1 {
        return None;
    }
    let StmtKind::Expr(e) = body.first()?.kind() else {
        return None;
    };
    let call = e.as_call()?;
    (call.callee().tag() == ExprTag::Super).then(|| call.args())
}

/// It has no side effects, which a default value and destructuring can have.
fn is_simple(param: Param) -> bool {
    param.default().is_none() && (param.is_rest() || param.pat().tag() == PatTag::Ident)
}

/// `super(...arguments)` passes all arguments through.
fn is_spread_arguments<'a>(args: List<'a, Expr<'a>>) -> bool {
    args.len() == 1
        && matches!(args.first().map(Expr::kind), Some(ExprKind::Spread(e)) if e.is_ident("arguments"))
}

fn is_valid_pair<'a>(param: Param<'a>, arg: Expr<'a>) -> bool {
    let arg = match arg.kind() {
        ExprKind::Spread(spread) if param.is_rest() => spread,
        _ if param.is_rest() => return false,
        _ => arg,
    };
    arg.as_ident().is_some_and(|name| param.pat().as_ident() == Some(name))
}

fn is_passing_through<'a>(params: List<'a, Param<'a>>, args: List<'a, Expr<'a>>) -> bool {
    params.len() == args.len() && params.iter().zip(args).all(|(param, arg)| is_valid_pair(param, arg))
}

/// `has_this`: there is a parameter `this` before `params`, which no argument can be.
fn is_redundant_super_call<'a>(body: List<'a, Stmt<'a>>, params: List<'a, Param<'a>>, has_this: bool) -> bool {
    single_super_call(body).is_some_and(|args| {
        params.iter().all(is_simple)
            && (is_spread_arguments(args) || (!has_this && is_passing_through(params, args)))
    })
}

/// The whole rule, for a member of a class. typescript-eslint's rule of the same name is no
/// different.
pub fn check<'a, R: Rule>(member: Member<'a>, cx: &Cx<'a, R>) {
    if !member.is_constructor() {
        return;
    }
    let (Some(func), Node::Class(class)) = (member.func(), member.parent()) else {
        return;
    };
    let Some(body) = func.body_statements() else {
        return;
    };
    let (params, has_super_class) = (func.params(), class.extends().is_some());
    let is_useless = match has_super_class {
        true => is_redundant_super_call(body, params, func.this_param().is_some()),
        false => body.is_empty(),
    };
    let has_useful_accessibility = member.flags().intersects(Flags::PROTECTED | Flags::PRIVATE)
        || (has_super_class && member.flags().contains(Flags::PUBLIC));
    if !is_useless
        || has_useful_accessibility
        || params.iter().any(|it| it.is_parameter_property() || it.decorators().next().is_some())
    {
        return;
    }

    // The token before the first `(`, which can be in the type parameters.
    let name_end = match member.constructor_keyword().filter(|_| func.type_params().is_empty()) {
        Some(name) => name.span().end,
        None => {
            let file = cx.file();
            let paren = file.tokens_in(member).find(|token| token.is_punctuator("("));
            let Some(before) = paren.and_then(|paren| file.token_before(paren)) else {
                return;
            };
            before.end()
        }
    };
    // oxlint points at all of an empty constructor, and at the name of one that only calls `super`.
    let place = match (cx.language().is_oxlint, member.constructor_keyword()) {
        (true, Some(name)) if has_super_class => name.span(),
        (true, _) => member.span(),
        (false, _) => Span::new(member.span().start, name_end),
    };
    let message = match (cx.language().is_oxlint, has_super_class) {
        (false, _) => NO_USELESS_CONSTRUCTOR,
        (true, false) => EMPTY_CONSTRUCTOR,
        (true, true) => REDUNDANT_SUPER_CALL,
    };
    cx.report(place, message)
        .suggest(REMOVE_CONSTRUCTOR, |fixer| {
            let next = fixer.file().token_after(member);
            let adds_semicolon = next.is_some_and(|it| ast_utils::can_continue_expression_in_class_body(&it))
                && ast_utils::needs_preceding_semicolon(member);
            fixer.replace(member, if adds_semicolon { ";" } else { "" })
        });
}

impl Rule for NoUselessConstructor {
    const META: Meta = Meta::eslint("no-useless-constructor", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessConstructor
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.members(|_, member, cx| check(member, cx));
    }
}
