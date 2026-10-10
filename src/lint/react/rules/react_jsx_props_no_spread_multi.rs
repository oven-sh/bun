use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name_or_regex};
use crate::react::is_jsx;
use bun_lint_oxlint::same_expression::is_same_member_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHasher};
use smallvec::{SmallVec, smallvec};
use std::hash::Hasher;

/// Disallow JSX prop spreading the same identifier multiple times
pub struct JsxPropsNoSpreadMulti;

const NO_MULTI_SPREADING: Message =
    Message::new("noMultiSpreading", "Spreading the same expression multiple times is forbidden");
const MULTIPLE_IDENTIFIERS: Message = Message::new("", "Prop '{{prop_name}}' is spread multiple times.");
const MULTIPLE_MEMBER_EXPRESSIONS: Message = Message::new("", "'{{member_name}}' is spread multiple times.");

impl Rule for JsxPropsNoSpreadMulti {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-props-no-spread-multi", Kind::None).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        JsxPropsNoSpreadMulti
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // oxlint goes by the name of the file.
        (!file.language().is_oxlint || is_jsx(file)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        check(self, e, cx);
    }
}

fn check<'a>(_: &JsxPropsNoSpreadMulti, e: Expr<'a>, cx: &mut Cx<'a, JsxPropsNoSpreadMulti>) {
    let ExprKind::Jsx(jsx) = e.kind() else {
        return;
    };
    let spread_attrs = jsx.attrs().iter().filter(|it| it.kind() == PropKind::Spread);
    let spread_attrs: SmallVec<[(Expr<'a>, Span); 4]> =
        spread_attrs.filter_map(|it| Some((it.value()?, it.span()))).collect();
    if spread_attrs.len() < 2 {
        return;
    }
    let mut identifiers: FxHashMap<Name<'a>, Vec<Span>> = FxHashMap::default();
    // Those that are the same are in the same list.
    let mut member_expressions: FxHashMap<u64, Vec<(Expr<'a>, Span)>> = FxHashMap::default();
    let is_oxlint = cx.language().is_oxlint;
    for &(argument, span) in &spread_attrs {
        // oxlint looks through `a!`, `a as T` and the like, and compares member expressions as well.
        let seen = if is_oxlint { get_inner_expression(argument) } else { argument };
        if let Some(name) = seen.as_ident() {
            identifiers.entry(name).or_default().push(span);
        } else if is_oxlint && matches!(argument.tag(), ExprTag::Dot | ExprTag::Index) && !argument.is_chain_root() {
            member_expressions.entry(hash_of_names(argument)).or_default().push((argument, span));
        }
    }
    for (name, spans) in identifiers {
        // oxlint reports the first one, once, and removes all but the last.
        if !is_oxlint {
            for span in spans.iter().skip(1) {
                cx.report(*span, NO_MULTI_SPREADING).listened_on(jsx.opening_span());
            }
        } else if let [first, .., _] = spans[..] {
            (spans.iter().skip(1))
                .fold(cx.report(first, MULTIPLE_IDENTIFIERS), |report, span| report.label(*span, ""))
                .data("prop_name", name)
                .fix(|fixer| spans.iter().rev().skip(1).map(|span| fixer.remove(*span)).collect::<Vec<_>>());
        }
    }
    for alike in member_expressions.values() {
        for (i, &(left, left_span)) in alike.iter().enumerate() {
            for &(right, right_span) in alike.iter().skip(i + 1) {
                if cx.has_reported_too_much() {
                    return;
                }
                if is_same_member_expression(left, right) {
                    cx.report(left_span, MULTIPLE_MEMBER_EXPRESSIONS)
                        .data("member_name", left.text())
                        .label(right_span, "")
                        .fix(|fixer| fixer.remove(left_span));
                }
            }
        }
    }
}

/// The same number for what [`is_same_member_expression`] takes for the same: of all that it compares, so that few
/// others have the same number.
fn hash_of_names(member: Expr) -> u64 {
    let mut hasher = FxHasher::default();
    let mut pending: SmallVec<[Expr; 8]> = smallvec![member];
    while let Some(e) = pending.pop().map(get_inner_expression) {
        match e.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                match (static_property_name_or_regex(e), e.index()) {
                    (Some(name), _) => hasher.write(name),
                    (None, Some(index)) => pending.push(index),
                    (None, None) => hasher.write(e.member_name().map(Ident::bytes).unwrap_or_default()),
                }
                pending.push(obj);
            }
            ExprKind::Ident(name) | ExprKind::String(name) => hasher.write(name.bytes()),
            // `` `a` `` is `"a"`.
            ExprKind::Template(template) => match template.as_static() {
                Some(value) => hasher.write(value.bytes()),
                None => pending.extend(template.exprs()),
            },
            ExprKind::Number(_) => hasher.write(e.text()),
            ExprKind::Regex(regex) => hasher.write(regex.pattern()),
            ExprKind::Binary { left, right, .. } => pending.extend([left, right]),
            ExprKind::Unary { operand, .. } => pending.push(operand),
            _ => {}
        }
        hasher.write_u8(0);
    }
    hasher.finish()
}

