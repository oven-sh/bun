//! The four rules of `react-perf`, with oxlint's `utils/react_perf.rs`.

use bun_lint_oxlint::ast_util::{get_inner_expression, is_method_call, static_property_name};
use bun_lint_oxlint::import::is_in_root_scope;
use crate::jsx::{as_jsx_element, get_jsx_attribute_name, get_prop_value};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdMap;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use smallvec::{SmallVec, smallvec};

/// Prevent JSX elements, arrays, functions or objects that are local to the current method from being used as values of JSX
/// props.
pub struct JsxNoNewAsProp<const WHAT: usize = JSX>(NativeAllowList);

const JSX: usize = 0;
const ARRAY: usize = 1;
const FUNCTION: usize = 2;
const OBJECT: usize = 3;

/// The rule, the constructor.
const TEXTS: [[&str; 2]; 4] = [
    ["jsx-no-jsx-as-prop", ""],
    ["jsx-no-new-array-as-prop", "Array"],
    ["jsx-no-new-function-as-prop", "Function"],
    ["jsx-no-new-object-as-prop", "Object"],
];
const MESSAGES: [Message; 4] = [
    Message::new("", "JSX attribute values should not contain other JSX."),
    Message::new("", "JSX attribute values should not contain Arrays created in the same scope."),
    Message::new("", "JSX attribute values should not contain functions created in the same scope."),
    Message::new("", "JSX attribute values should not contain objects created in the same scope."),
];

/// `nativeAllowList`: the attributes of elements such as `<div>` that are not looked at.
enum NativeAllowList {
    All,
    List(Vec<Box<[u8]>>),
    None,
}

#[derive(Default)]
pub struct State<'a> {
    /// For [`is_in_root_scope`].
    in_root_scope: AncestorMemo<'a, ()>,
    /// Where a variable is declared, if that is with a violation.
    declared_with_violation: IdMap<Symbol<'a>, Option<(Span, Option<Span>)>>,
}

impl<const WHAT: usize> Rule for JsxNoNewAsProp<WHAT> {
    const META: Meta = Meta::oxlint(Plugin::ReactPerf, TEXTS[WHAT][0], Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        JsxNoNewAsProp(match options.object(0).get("nativeAllowList") {
            Some(Json::String(all)) if **all == *b"all" => NativeAllowList::All,
            Some(Json::Array(names)) => NativeAllowList::List(names.iter().filter_map(Json::as_str).map(Box::from).collect()),
            _ => NativeAllowList::None,
        })
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(jsx) = as_jsx_element(e) {
            for attr in jsx.attrs() {
                self.run_react_perf_rule(jsx, attr, cx);
            }
        }
    }
}

/// `callee`: of a call or a `new`.
fn is_constructor_matching_name(callee: Expr, name: &str) -> bool {
    callee.is_ident(name) && !callee.is_parenthesized()
}

impl<const WHAT: usize> JsxNoNewAsProp<WHAT> {
    /// Whether `expr` makes something new each time. It is neither `a || b` nor `a ? b : c`.
    fn is_violation(expr: Expr) -> bool {
        let constructor = TEXTS[WHAT][1];
        match expr.kind() {
            _ if WHAT == JSX => as_jsx_element(expr).is_some(),
            ExprKind::Array(_) => WHAT == ARRAY,
            ExprKind::Fn(_) => WHAT == FUNCTION,
            ExprKind::Object(_) => WHAT == OBJECT,
            ExprKind::Call(call) if !expr.is_chain_root() => {
                let callee = call.callee();
                is_constructor_matching_name(callee, constructor)
                    || match WHAT {
                        ARRAY => is_method_call(call, None, Some(&["concat", "map", "filter"]), Some(1), Some(1)),
                        FUNCTION => {
                            !callee.is_parenthesized()
                                && !callee.is_chain_root()
                                && static_property_name(callee).is_some_and(|it| it.is("bind"))
                        }
                        _ => is_method_call(call, Some(&["Object"]), Some(&["assign", "create"]), None, None),
                    }
            }
            ExprKind::New(new) => is_constructor_matching_name(new.callee(), constructor),
            _ => false,
        }
    }

    /// `check_expression` of each of the rules: the first operand of the `||`, `&&`, `??` and `? :` that `expr` is made of which
    /// is a violation.
    fn check_expression(expr: Expr) -> Option<Span> {
        // The next is the last.
        let mut pending: SmallVec<[Expr; 8]> = smallvec![expr];
        while let Some(expr) = pending.pop() {
            // Only that of the objects looks through `as T` and the like.
            let expr = if WHAT == OBJECT { get_inner_expression(expr) } else { expr };
            match expr.kind() {
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => pending.extend([right, left]),
                ExprKind::Cond { yes, no, .. } => pending.extend([no, yes]),
                _ if Self::is_violation(expr) => return Some(expr.span()),
                _ => {}
            }
        }
        None
    }

    fn is_allowed_on_native_element(&self, jsx: Jsx, attr: Prop) -> bool {
        let tag_name = match jsx.tag().map(Expr::kind) {
            Some(ExprKind::Ident(name) | ExprKind::String(name)) => name.bytes(),
            _ => return false,
        };
        let is_identifier = |name: &[u8]| !strings::contains_char(name, b':');
        // `is_react_component_name`
        if !is_identifier(tag_name) || tag_name.first().is_some_and(u8::is_ascii_uppercase) {
            return false;
        }
        match &self.0 {
            NativeAllowList::All => true,
            NativeAllowList::List(names) => get_jsx_attribute_name(attr).is_some_and(|attr_name| {
                is_identifier(attr_name) && names.iter().any(|it| it.eq_ignore_ascii_case(attr_name))
            }),
            NativeAllowList::None => false,
        }
    }

    fn run_react_perf_rule<'a>(&self, jsx: Jsx<'a>, attr: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let Some(expr) = get_prop_value(attr).and_then(|it| it.as_expression()).map(get_inner_expression) else {
            return;
        };
        if let Some(attr_span) = Self::check_expression(expr) {
            // What is made at the top level is made once.
            if !self.is_allowed_on_native_element(jsx, attr)
                && !is_in_root_scope(Node::Prop(attr), &mut cx.state.in_root_scope)
            {
                cx.report(attr_span, MESSAGES[WHAT]);
            }
            return;
        }
        // What is declared in the function that renders is as new as what is written in the attribute.
        let Some(symbol) = expr.symbol() else {
            return;
        };
        let known = &mut cx.state.declared_with_violation;
        let Some((decl_span, init_span)) = *known.get_or_insert_with(symbol, || Self::declaration_with_violation(symbol))
        else {
            return;
        };
        let (scope, file) = (symbol.scope(), cx.file());
        if scope != file.top_level_scope() && scope != file.scope() && !self.is_allowed_on_native_element(jsx, attr) {
            let report = cx.report(decl_span, MESSAGES[WHAT]).first_label("The prop was declared here");
            let report = match init_span {
                Some(init_span) => report.label(init_span, "And assigned a new value here"),
                None => report,
            };
            report.label(expr, "And used here");
        }
    }

    /// Where it is declared, and the new value, which oxlint does not show if it is a function.
    fn declaration_with_violation(symbol: Symbol) -> Option<(Span, Option<Span>)> {
        match symbol.declarations().next()? {
            declaration @ Declaration::Var(_) => match declaration.node() {
                Some(Node::VarDecl(decl)) => (decl.init().and_then(Self::check_expression))
                    .map(|init| (decl.pat().span(), (WHAT != FUNCTION).then_some(init))),
                _ => None,
            },
            // An array or an object is as good as the default value in a destructured parameter.
            Declaration::Param(id) if WHAT == ARRAY || WHAT == OBJECT => {
                // `find_initialized_binding`. The default of the parameter itself is not looked at.
                let init = match id.parent() {
                    Node::PatProp(property) => property.default(),
                    Node::PatElem(element) => element.default(),
                    _ => None,
                };
                init.and_then(Self::check_expression).map(|init| (id.span(), Some(init)))
            }
            Declaration::Fn(func) if WHAT == FUNCTION => {
                Some((func.name().map_or_else(|| func.estree_span(), |it| it.span()), None))
            }
            _ => None,
        }
    }
}
