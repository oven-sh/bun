//! oxlint's `utils/react_perf.rs`: what the four rules of `react-perf` have in common.

use crate::jsx::{as_jsx_element, get_jsx_attribute_name, get_prop_value};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::import::is_in_root_scope;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

/// `nativeAllowList`: the attributes of elements such as `<div>` that are not looked at.
pub(crate) enum NativeAllowList {
    All,
    List(Vec<Box<[u8]>>),
    None,
}

/// `react_perf_from_configuration`
pub(crate) fn react_perf_from_configuration(options: &Options) -> NativeAllowList {
    match options.object(0).get("nativeAllowList") {
        Some(Json::String(all)) if **all == *b"all" => NativeAllowList::All,
        Some(Json::Array(names)) => NativeAllowList::List(
            names
                .iter()
                .filter_map(Json::as_str)
                .map(Box::from)
                .collect(),
        ),
        _ => NativeAllowList::None,
    }
}

/// The state of each of the rules.
#[derive(Default)]
pub struct State<'a> {
    /// For [`is_in_root_scope`].
    in_root_scope: AncestorMemo<'a, ()>,
    /// Where a variable is declared, if that is with a violation.
    declared_with_violation: FxHashMap<Symbol<'a>, Option<(Span, Option<Span>)>>,
}

/// One of the rules.
pub(crate) trait ReactPerfRule: Rule {
    const MESSAGE: Message;

    fn native_allow_list(&self) -> &NativeAllowList;

    fn state<'c, 'a>(cx: &'c mut Cx<'a, Self>) -> &'c mut State<'a>;

    /// Whether `expr` makes something new each time. It is neither `a || b` nor `a ? b : c`.
    fn is_violation(expr: Expr) -> bool;

    /// `check_expression` looks through `as T` and the like.
    const LOOKS_THROUGH_TYPES: bool = false;

    /// A variable is as good as its default value in a destructured parameter.
    const CHECKS_PARAMETERS: bool = false;

    /// A function declaration is a violation.
    const CHECKS_FUNCTIONS: bool = false;
}

/// For [`Rule::register`].
pub(crate) fn register<'a, R: ReactPerfRule>(on: &mut Listeners<'a, R>) {
    on.exprs([ExprTag::Jsx], |rule, e, cx| {
        if let Some(jsx) = as_jsx_element(e) {
            for attr in jsx.attrs() {
                run_react_perf_rule(rule, jsx, attr, cx);
            }
        }
    });
}

/// `check_expression` of each of the rules: the first operand of the `||`, `&&`, `??` and `? :` that `expr` is made of which is a
/// violation.
fn check_expression<R: ReactPerfRule>(expr: Expr) -> Option<Span> {
    // The next is the last.
    let mut pending: SmallVec<[Expr; 8]> = smallvec![expr];
    while let Some(expr) = pending.pop() {
        let expr = if R::LOOKS_THROUGH_TYPES {
            get_inner_expression(expr)
        } else {
            expr
        };
        match expr.kind() {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => pending.extend([right, left]),
            ExprKind::Cond { yes, no, .. } => pending.extend([no, yes]),
            _ if R::is_violation(expr) => return Some(expr.span()),
            _ => {}
        }
    }
    None
}

fn is_allowed_on_native_element(native_allow_list: &NativeAllowList, jsx: Jsx, attr: Prop) -> bool {
    let tag_name = match jsx.tag().map(Expr::kind) {
        Some(ExprKind::Ident(name) | ExprKind::String(name)) => name.bytes(),
        _ => return false,
    };
    let is_identifier = |name: &[u8]| !strings::contains_char(name, b':');
    // `is_react_component_name`
    if !is_identifier(tag_name) || tag_name.first().is_some_and(u8::is_ascii_uppercase) {
        return false;
    }
    match native_allow_list {
        NativeAllowList::All => true,
        NativeAllowList::List(names) => get_jsx_attribute_name(attr).is_some_and(|attr_name| {
            is_identifier(attr_name) && names.iter().any(|it| it.eq_ignore_ascii_case(attr_name))
        }),
        NativeAllowList::None => false,
    }
}

fn run_react_perf_rule<'a, R: ReactPerfRule>(
    rule: &R,
    jsx: Jsx<'a>,
    attr: Prop<'a>,
    cx: &mut Cx<'a, R>,
) {
    let Some(expr) = get_prop_value(attr)
        .and_then(|it| it.as_expression())
        .map(get_inner_expression)
    else {
        return;
    };
    if let Some(attr_span) = check_expression::<R>(expr) {
        // What is made at the top level is made once.
        if !is_allowed_on_native_element(rule.native_allow_list(), jsx, attr)
            && !is_in_root_scope(Node::Prop(attr), &mut R::state(cx).in_root_scope)
        {
            cx.report(attr_span, R::MESSAGE);
        }
        return;
    }
    // What is declared in the function that renders is as new as what is written in the attribute.
    let Some(symbol) = expr.symbol() else {
        return;
    };
    let known = &mut R::state(cx).declared_with_violation;
    let Some((decl_span, init_span)) = *known
        .entry(symbol)
        .or_insert_with(|| declaration_with_violation::<R>(symbol))
    else {
        return;
    };
    let (scope, file) = (symbol.scope(), cx.file());
    if scope != file.top_level_scope()
        && scope != file.scope()
        && !is_allowed_on_native_element(rule.native_allow_list(), jsx, attr)
    {
        let report = cx
            .report(decl_span, R::MESSAGE)
            .first_label("The prop was declared here");
        let report = match init_span {
            Some(init_span) => report.label(init_span, "And assigned a new value here"),
            None => report,
        };
        report.label(expr, "And used here");
    }
}

/// Where it is declared, and the new value, which oxlint does not show if it is a function.
fn declaration_with_violation<R: ReactPerfRule>(symbol: Symbol) -> Option<(Span, Option<Span>)> {
    match symbol.declarations().next()? {
        declaration @ Declaration::Var(_) => match declaration.node() {
            Some(Node::VarDecl(decl)) => decl
                .init()
                .and_then(check_expression::<R>)
                .map(|init| (decl.pat().span(), (!R::CHECKS_FUNCTIONS).then_some(init))),
            _ => None,
        },
        Declaration::Param(id) if R::CHECKS_PARAMETERS => {
            // `find_initialized_binding`. The default of the parameter itself is not looked at.
            let init = match id.parent() {
                Node::PatProp(property) => property.default(),
                Node::PatElem(element) => element.default(),
                _ => None,
            };
            init.and_then(check_expression::<R>)
                .map(|init| (id.span(), Some(init)))
        }
        Declaration::Fn(func) if R::CHECKS_FUNCTIONS => Some((
            func.name()
                .map_or_else(|| func.estree_span(), |it| it.span()),
            None,
        )),
        _ => None,
    }
}

/// `callee`: of a call or a `new`.
pub(crate) fn is_constructor_matching_name(callee: Expr, name: &str) -> bool {
    callee.is_ident(name) && !callee.is_parenthesized()
}
