use crate::unicorn::{GLOBAL_OBJECT_NAMES, is_unary_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{as_member_expression, is_global_reference, static_property_name};

/// Disallows use of `parseInt()`, `parseFloat()`, `isNaN()`, `isFinite()`, `NaN`, `Infinity` and `-Infinity` as global
/// variables.
pub struct PreferNumberProperties {
    check_infinity: bool,
    check_nan: bool,
}

const PREFER_NUMBER_PROPERTIES: Message = Message::new(
    "",
    "Use `Number.{{method_name}}` instead of the global `{{method_name}}`",
);

const FUNCTIONS: [&str; 4] = ["isNaN", "isFinite", "parseFloat", "parseInt"];

pub struct State<'a> {
    /// The nearest unary expression around something.
    nearest_unary: AncestorMemo<'a, Expr<'a>>,
    functions: [Name<'a>; 4],
}

impl Rule for PreferNumberProperties {
    const META: Meta = Meta::oxlint(
        Plugin::Unicorn,
        "prefer-number-properties",
        Kind::Suggestion,
    )
    .fixable(Fixable::Code);
    const ON: On = On::new()
        .members_named(&["NaN", "Infinity"])
        .exprs(&[ExprTag::Index])
        .calls_named(&FUNCTIONS)
        .finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        PreferNumberProperties {
            check_infinity: options.bool_or("checkInfinity", false),
            check_nan: options.bool_or("checkNaN", true),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let has = |name: &str| file.find_name(name).is_some();
        let has_constants = self.check_nan && has("NaN") || self.check_infinity && has("Infinity");
        let has_functions = FUNCTIONS.into_iter().any(has);
        let mut on = On::new();
        if has_constants && GLOBAL_OBJECT_NAMES.into_iter().any(has) {
            on = on.exprs(&[ExprTag::Dot, ExprTag::Index]);
        }
        if has_functions {
            on = on.exprs(&[ExprTag::Call]);
        }
        if has_constants || has_functions {
            on = on.finish();
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        Some(State {
            nearest_unary: AncestorMemo::default(),
            functions: FUNCTIONS.map(|it| file.name_of(it)),
        })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Dot | ExprTag::Index => self.check_member(e, cx),
            ExprTag::Call => self.check_call(e, cx),
            _ => {}
        }
    }

    /// `NaN`, `Infinity`, `{ parseInt }`, `{ a: parseInt }`
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let constants = [("NaN", self.check_nan), ("Infinity", self.check_infinity)];
        for (name, _) in constants
            .into_iter()
            .filter(|it| it.1 && file.find_name(it.0).is_some())
        {
            for reference in file
                .unresolved_references_to(name.as_bytes())
                .filter(|it| !it.is_jsx_pragma())
            {
                let span = reference.span();
                let is_shorthand =
                    reference.expr().and_then(is_shorthand_of_object_property) == Some(true);
                let report = cx
                    .report(span, PREFER_NUMBER_PROPERTIES)
                    .data("method_name", name);
                let nearest_unary = &mut cx.state.nearest_unary;
                report.fix(|fixer| {
                    if name == "NaN" {
                        return fixer.insert_before(
                            span,
                            if is_shorthand {
                                "NaN: Number."
                            } else {
                                "Number."
                            },
                        );
                    }
                    let is_unary = |_, parent: Node<'a>| {
                        parent.as_expr().filter(|it| is_unary_expression(*it))
                    };
                    let unary = nearest_unary.find(reference.node(), is_unary);
                    let negation = unary.filter(|it| it.unary_op() == Some(UnOp::Minus));
                    match (negation, is_shorthand) {
                        (Some(_), true) => fixer.insert_after(span, ": Number.NEGATIVE_INFINITY"),
                        (None, true) => fixer.insert_after(span, ": Number.POSITIVE_INFINITY"),
                        (Some(negation), false) => {
                            fixer.replace(negation, "Number.NEGATIVE_INFINITY")
                        }
                        (None, false) => fixer.replace(span, "Number.POSITIVE_INFINITY"),
                    }
                });
            }
        }
        for name in FUNCTIONS
            .into_iter()
            .filter(|it| file.find_name(it).is_some())
        {
            for reference in file.unresolved_references_to(name.as_bytes()) {
                let Some(is_shorthand) = reference.expr().and_then(is_shorthand_of_object_property)
                else {
                    continue;
                };
                let span = reference.span();
                let report = cx
                    .report(span, PREFER_NUMBER_PROPERTIES)
                    .data("method_name", name);
                let fix = |fixer: Fixer<'a>| match is_shorthand {
                    true => fixer.insert_before(span, [name, ": Number."].concat()),
                    false => fixer.insert_before(span, "Number."),
                };
                if matches!(name, "isNaN" | "isFinite") {
                    report.fix_dangerously(fix)
                } else {
                    report.fix(fix)
                };
            }
        }
    }
}

fn is_global_object(e: Expr) -> bool {
    e.as_ident()
        .is_some_and(|it| it.is_any(&GLOBAL_OBJECT_NAMES))
        && !e.is_parenthesized()
}

impl PreferNumberProperties {
    /// `window.NaN`
    fn check_member<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(object) = member.object().filter(|it| is_global_object(*it))
            && let Some(name) = static_property_name(member)
            && (self.check_nan && name.is("NaN") || self.check_infinity && name.is("Infinity"))
            && !member.is_jsx_tag_name()
            && !member.is_in_type_query()
        {
            cx.report(member, PREFER_NUMBER_PROPERTIES)
                .called_with(member)
                .data("method_name", name)
                .fix(|fixer| fixer.replace(object, "Number"));
        }
    }

    /// `parseInt(a)`, `window.parseInt(a)`
    fn check_call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(callee) = e.callee() else {
            return;
        };
        let name = callee
            .as_ident()
            .or_else(|| callee.member_name().map(Ident::name));
        if name.is_some_and(|it| !cx.state.functions.contains(&it)) || callee.is_parenthesized() {
            return;
        }
        let name = match callee.as_ident() {
            Some(name) => Some(name),
            None => as_member_expression(callee)
                .filter(|it| it.object().is_some_and(is_global_object))
                .and_then(static_property_name),
        };
        let Some(name) = name.filter(|it| it.is_any(&FUNCTIONS)) else {
            return;
        };
        if callee.tag() == ExprTag::Ident && !is_global_reference(callee) {
            return;
        }
        let report = cx
            .report(callee, PREFER_NUMBER_PROPERTIES)
            .called_with(e)
            .data("method_name", name);
        // The whole call, so that this and the fix of `prefer-numeric-literals` are not both applied.
        let fix = |fixer: Fixer<'a>| {
            let arguments = fixer.file().slice(Span::after(callee.span(), e.span().end));
            fixer.replace(e, [&b"Number."[..], name.bytes(), arguments].concat())
        };
        if name.is_any(&["isNaN", "isFinite"]) {
            report.fix_dangerously(fix)
        } else {
            report.fix(fix)
        };
    }
}

/// If `e` is directly the value or the computed key of a property of an object literal: whether that is `{ e }`.
fn is_shorthand_of_object_property(e: Expr) -> Option<bool> {
    let Node::Prop(prop) = e.parent() else {
        return None;
    };
    let is_object_property = !e.is_parenthesized()
        && prop.kind() != PropKind::Spread
        && !prop.is_jsx_attribute()
        && matches!(prop.parent(), Node::Expr(object) if !object.is_assignment_target());
    is_object_property.then(|| prop.kind() == PropKind::Shorthand)
}
