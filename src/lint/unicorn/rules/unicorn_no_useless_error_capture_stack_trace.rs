use bun_lint_oxlint::ast_util::{
    as_member_expression, get_inner_expression, is_global_reference, is_method_call, static_property_name,
};
use crate::unicorn::BUILT_IN_ERRORS;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallows unnecessary `Error.captureStackTrace(…)` in error constructors.
pub struct NoUselessErrorCaptureStackTrace;

const NO_USELESS_ERROR_CAPTURE_STACK_TRACE: Message =
    Message::new("", "Do not use `Error.captureStackTrace(…)` in the constructor of an Error subclass");
const ALREADY_CALLED: Message = Message::new(
    "",
    "The Error constructor already calls `captureStackTrace` internally, so calling it again is unnecessary.",
);

impl Rule for NoUselessErrorCaptureStackTrace {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-useless-error-capture-stack-trace", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// The class in the constructor of which something is.
    type State<'a> = AncestorMemo<'a, Option<Class<'a>>>;

    fn new(_: &Options) -> Self {
        NoUselessErrorCaptureStackTrace
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.mentions("captureStackTrace").then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        if !is_method_call(call, Some(&["Error"]), Some(&["captureStackTrace"]), None, None) {
            return;
        }
        if let Some(error) = as_member_expression(call.callee()).and_then(Expr::object)
            && error.tag() == ExprTag::Ident
            && !error.is_parenthesized()
            && !is_global_reference(error)
        {
            return;
        }
        // Functions without a name do not end the constructor.
        let class = cx.state.find(Node::Expr(e), |_, parent| match parent {
            Node::Func(func) => match func.kind() {
                FnKind::StaticBlock => Some(None),
                FnKind::Decl | FnKind::Expr if func.name().is_some() => Some(None),
                _ => None,
            },
            Node::Member(member) if member.is_constructor() => match member.parent() {
                Node::Class(class) => Some(Some(class)),
                _ => Some(None),
            },
            Node::Class(_) => Some(None),
            _ => None,
        });
        let Some(class) = class.flatten().filter(|it| is_error_class(*it)) else {
            return;
        };
        if !call.args().get(1).is_some_and(|it| is_referencing_class(it, class)) {
            return;
        }
        cx.report(e, NO_USELESS_ERROR_CAPTURE_STACK_TRACE).suggest(ALREADY_CALLED, |fixer| match e.parent() {
            Node::Stmt(statement)
                if statement.tag() == StmtTag::Expr
                    && !e.is_parenthesized()
                    && matches!(statement.parent(), Node::Func(_)) =>
            {
                Some(fixer.remove(statement))
            }
            _ => None,
        });
    }
}

/// It extends one of the errors of the language.
fn is_error_class(class: Class) -> bool {
    class.extends().map(get_inner_expression).is_some_and(|super_class| {
        super_class.as_ident().is_some_and(|it| it.is_any(&BUILT_IN_ERRORS)) && is_global_reference(super_class)
    })
}

/// `MyError`, `new.target`, `this.constructor`
fn is_referencing_class<'a>(argument: Expr<'a>, class: Class<'a>) -> bool {
    let e = get_inner_expression(argument);
    match e.tag() {
        ExprTag::Ident => class.name().is_some() && e.symbol().is_some_and(|it| Some(it) == class.symbol()),
        ExprTag::NewTarget => true,
        ExprTag::Dot | ExprTag::Index => {
            !e.is_chain_root()
                && e.object().is_some_and(|it| get_inner_expression(it).tag() == ExprTag::This)
                && static_property_name(e).is_some_and(|it| it.is("constructor"))
        }
        _ => false,
    }
}
