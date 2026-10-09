use bun_lint_oxlint::ast_util::{as_call_expression, as_function, as_method_definition, get_inner_expression};
use crate::jsx::get_prop_value;
use crate::react::{FlagsOfVariables, Variables, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use smallvec::{SmallVec, smallvec};

/// Disallows JSX context provider values that cause needless re-renders.
pub struct JsxNoConstructedContextValues;

const JSX_NO_CONSTRUCTED_CONTEXT_VALUES: Message =
    Message::new("", "The Context `value` prop should not be constructed.");

#[derive(Default)]
pub struct State<'a> {
    inside_component: AncestorMemo<'a, ()>,
    /// 1 for a variable that is made anew each time the function that declares it runs.
    constructed_variables: FlagsOfVariables<'a>,
}

impl Rule for JsxNoConstructedContextValues {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-no-constructed-context-values", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        JsxNoConstructedContextValues
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if is_jsx(file) && file.mentions("value") && file.mentions_any(&["Provider", "createContext"]) {
            on.exprs([ExprTag::Jsx], |_, e, cx| {
                let ExprKind::Jsx(jsx) = e.kind() else {
                    return;
                };
                let is_component = |node: Node<'a>| as_function(node).is_some() || as_method_definition(node).is_some();
                if !jsx.tag().is_some_and(is_context_provider)
                    || cx
                        .state
                        .inside_component
                        .find(Node::Expr(e), |_, ancestor| is_component(ancestor).then_some(()))
                        .is_none()
                {
                    return;
                }
                for attribute in jsx.attrs().iter().filter(|it| it.key().is_some_and(|key| key.is("value"))) {
                    if get_prop_value(attribute)
                        .and_then(|it| it.as_expression())
                        .is_some_and(|it| is_constructed_expression(it, &mut cx.state.constructed_variables))
                    {
                        cx.report(attribute, JSX_NO_CONSTRUCTED_CONTEXT_VALUES);
                    }
                }
            });
        }
        State::default()
    }
}

/// `<A.Provider>`, or `<A>` with `const A = createContext()`
fn is_context_provider(name: Expr) -> bool {
    match name.kind() {
        ExprKind::Dot { name, .. } => name.name().is("Provider"),
        // `<a>` is the name of an element of HTML.
        ExprKind::Ident(ident) if ident.bytes().first().is_some_and(u8::is_ascii_lowercase) => false,
        ExprKind::Ident(_) => {
            matches!(name.symbol().and_then(|it| it.declarations().next()).and_then(Declaration::node),
            Some(Node::VarDecl(declarator)) if declarator.init().is_some_and(is_create_context_call))
        }
        _ => false,
    }
}

/// `createContext()`, `React.createContext()`
fn is_create_context_call(expr: Expr) -> bool {
    let Some(callee) = as_call_expression(expr).map(Call::callee).filter(|it| !it.is_parenthesized()) else {
        return false;
    };
    match callee.kind() {
        ExprKind::Ident(name) => name.is("createContext"),
        ExprKind::Dot { obj, name, .. } => {
            obj.is_ident("React") && !obj.is_parenthesized() && name.name().is("createContext")
        }
        _ => false,
    }
}

fn is_constructed_expression<'a>(expr: Expr<'a>, constructed_variables: &mut FlagsOfVariables<'a>) -> bool {
    let mut pending: SmallVec<[Expr<'a>; 8]> = smallvec![expr];
    while let Some(expr) = pending.pop() {
        let expr = get_inner_expression(expr);
        match expr.kind() {
            ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Fn(_)
            | ExprKind::Jsx(_)
            | ExprKind::Class(_)
            | ExprKind::New(_)
            | ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. }
            | ExprKind::Assign { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::ImportCall { .. } => return true,
            ExprKind::Call(call) => {
                let callee = call.callee();
                if callee.is_parenthesized()
                    || !callee.as_ident().is_some_and(|name| name.is_any(&["useMemo", "useCallback"]))
                {
                    return true;
                }
            }
            ExprKind::Template(template) if !template.exprs().is_empty() => return true,
            ExprKind::Binary { left, right, .. } if left.tag() != ExprTag::PrivateIdentifier => {
                pending.extend([left, right])
            }
            ExprKind::Cond { yes, no, .. } => pending.extend([yes, no]),
            ExprKind::Unary { operand, .. } => pending.push(operand),
            ExprKind::Ident(_) => {
                if expr
                    .symbol()
                    .is_some_and(|it| constructed_variables.of_variable(it, is_constructed_declaration) != 0)
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// `is_identifier_a_constructed_value`: 1 if the declaration makes something new, and the variables that it can be as
/// well.
fn is_constructed_declaration(variable: Symbol<'_>) -> (u8, Variables<'_>) {
    let mut variables = Variables::new();
    // What is declared at the top level is made once.
    if matches!(variable.scope().node(), Node::File(_)) {
        return (0, variables);
    }
    let init = match variable.declarations().next() {
        Some(Declaration::Fn(_) | Declaration::Class(_)) => return (1, variables),
        Some(declaration @ Declaration::Var(_)) => match declaration.node() {
            Some(Node::VarDecl(declarator)) => declarator.init(),
            _ => None,
        },
        _ => None,
    };
    // `is_construction_expression`
    let mut pending: SmallVec<[Expr; 8]> = init.into_iter().collect();
    while let Some(expr) = pending.pop() {
        let expr = get_inner_expression(expr);
        match expr.kind() {
            ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::New(_)
            | ExprKind::Jsx(_)
            | ExprKind::Regex(_) => return (1, variables),
            ExprKind::Cond { yes, no, .. } => pending.extend([yes, no]),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => {
                pending.extend([left, right])
            }
            ExprKind::Assign { value, .. } => pending.push(value),
            ExprKind::Ident(_) => variables.extend(expr.symbol()),
            _ => {}
        }
    }
    (0, variables)
}
