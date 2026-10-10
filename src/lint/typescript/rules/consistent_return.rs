use bun_lint::prelude::*;
use bun_lint::types::utils::is_type_flag_set;
use bun_lint::types::{TsNode, Type, TypeFlags, tsutils};
use bun_lint_eslint::rules::consistent_return::{
    MISSING_RETURN_VALUE, UNEXPECTED_RETURN_VALUE, check, has_return_value, is_relevant,
};
use std::cell::OnceCell;

/// Require `return` statements to either always or never specify values.
pub struct ConsistentReturn {
    treat_undefined_as_unspecified: bool,
}

fn is_promise_void<'a>(node: TsNode<'a>, mut ty: Type<'a>) -> bool {
    for _ in 0..100 {
        if !tsutils::is_thenable_type(node, ty) || !tsutils::is_type_reference(ty) {
            return false;
        }
        let Some(awaited_type) = ty.get_type_arguments().first() else {
            return false;
        };
        if is_type_flag_set(awaited_type, TypeFlags::VOID) {
            return true;
        }
        ty = awaited_type;
    }
    false
}

fn is_return_void_or_thenable_void(func: Func<'_>) -> bool {
    let ts_node = func.ts_node();
    func.type_at_location().get_call_signatures().iter().any(|signature| {
        let return_type = signature.get_return_type();
        match func.is_async() {
            true => is_promise_void(ts_node, return_type),
            false => is_type_flag_set(return_type, TypeFlags::VOID),
        }
    })
}

/// TypeScript's `getAssignedName`, as it is written: the name that a function expression has from where it is.
fn assigned_name<'a>(e: Expr<'a>, file: &'a File<'a>) -> Option<&'a [u8]> {
    let left = match e.parent() {
        _ if e.is_parenthesized() => return None,
        Node::Prop(prop) if prop.value() == Some(e) && !prop.is_jsx_attribute() => {
            return Some(file.slice(prop.key()?.span(file)));
        }
        Node::PatProp(prop) if prop.default() == Some(e) => return Some(prop.value().text()),
        Node::PatElem(element) if element.default() == Some(e) => return Some(element.pat()?.text()),
        Node::VarDecl(declarator) => return declarator.pat().as_ident().map(Name::bytes),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Binary { left, right, .. } if right == e => left,
            ExprKind::Assign { target, value, .. } if value == e => target,
            _ => return None,
        },
        _ => return None,
    };
    match left.kind() {
        _ if left.is_parenthesized() => None,
        ExprKind::Ident(name) => Some(name.bytes()),
        ExprKind::Dot { name, .. } => Some(name.bytes()),
        ExprKind::Index { index, .. } if matches!(index.tag(), ExprTag::String | ExprTag::Number) => Some(index.text()),
        ExprKind::Index { .. } => Some(left.text()),
        _ => None,
    }
}

/// How tsgolint calls a function.
fn tsgolint_function_name(func: Func) -> Vec<u8> {
    let file = func.file();
    let name = match (func.name(), func.owner()) {
        (Some(name), _) => Some(name.bytes()),
        (None, Node::Member(member)) => member.key().map(|it| file.slice(it.span(file))),
        (None, Node::Prop(prop)) => prop.key().map(|it| file.slice(it.span(file))),
        (None, Node::Expr(e)) => assigned_name(e, file),
        _ => None,
    };
    let kind: &[u8] = if func.is_async() { b"Async function" } else { b"Function" };
    match name {
        Some(name) => [kind, b" '", name, b"'"].concat(),
        None => kind.to_vec(),
    }
}

impl ConsistentReturn {
    fn check<'a>(&self, node: Node<'a>, cx: &Cx<'a, Self>) {
        let returns_void = OnceCell::new();
        check(node, cx, |statement| {
            let StmtKind::Return(argument) = statement.kind() else {
                return None;
            };
            let Some(value) = argument else {
                let is_ignored = *returns_void
                    .get_or_init(|| node.as_func().is_some_and(is_return_void_or_thenable_void));
                return (!is_ignored).then_some(false);
            };
            if self.treat_undefined_as_unspecified && value.ty().flags() == TypeFlags::UNDEFINED {
                return Some(false);
            }
            Some(has_return_value(argument, self.treat_undefined_as_unspecified))
        });
    }

    /// The rule of tsgolint 7.0. A function that can return `void` may end without a `return`, as may one in which a
    /// `return` has been reported. It makes no exception for constructors, and points at the whole function.
    fn check_as_tsgolint<'a>(&self, func: Func<'a>, cx: &Cx<'a, Self>) {
        let returns_void = OnceCell::new();
        let allows_void = || *returns_void.get_or_init(|| is_return_void_or_thenable_void(func));
        let (mut expected, mut has_mismatch) = (None, false);
        for statement in func.returns() {
            let StmtKind::Return(argument) = statement.kind() else {
                continue;
            };
            if argument.is_none() && allows_void() {
                continue;
            }
            let has_value = argument.is_some_and(|value| {
                !self.treat_undefined_as_unspecified
                    || value.ty().flags() != TypeFlags::UNDEFINED && !ast_utils::is_specific_id(value, "undefined")
            });
            if *expected.get_or_insert(has_value) != has_value {
                has_mismatch = true;
                let message = if has_value { UNEXPECTED_RETURN_VALUE } else { MISSING_RETURN_VALUE };
                cx.report(statement, message).data("name", tsgolint_function_name(func));
            }
        }
        if expected == Some(true) && !has_mismatch && func.is_end_reachable() && !allows_void() {
            cx.report(func.span(), MISSING_RETURN_VALUE).data("name", tsgolint_function_name(func));
        }
    }
}

impl Rule for ConsistentReturn {
    const META: Meta = Meta::typescript("consistent-return", Kind::Suggestion)
        .requires_types()
        .extends_base_rule("consistent-return");
    const ON: On = On::new().funcs().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentReturn {
            treat_undefined_as_unspecified: options.object(0).bool_or("treatUndefinedAsUnspecified", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_relevant(file) {
            return None;
        }
        Some(())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            self.check_as_tsgolint(func, cx);
            return;
        }
        self.check(func.into(), cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if cx.language().is_oxlint {
            return;
        }
        self.check(cx.file().into(), cx);
    }
}
