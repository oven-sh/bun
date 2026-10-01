//! Ported from ESLint lib/rules/use-isnan.js, with its defaults: `switch` is checked, `indexOf` is not.

use bun_ast::{E, Expr, ExprData, Loc, OpCode, S};

use crate::lint::ast_utils;
use crate::lint::context::{Context, Globals};
use crate::lint::rule::{Category, Rule};
use crate::lint::rules::is_comparison;

static RULE: Rule = Rule {
    name: "use-isnan",
    category: Category::Correctness,
};

/// The global that makes `expr` a NaN: `NaN`, `Number.NaN`, `Number["NaN"]`, or the last of a sequence that is one.
fn nan(context: &Context<'_, '_>, expr: &Expr) -> Globals {
    let expr = match &expr.data {
        ExprData::EBinary(binary) if binary.op == OpCode::BinComma => &binary.right,
        _ => expr,
    };
    let target = match &expr.data {
        ExprData::EIdentifier(identifier) => {
            return if context.name_of(identifier.ref_) == b"NaN" {
                Globals::NAN
            } else {
                Globals::NONE
            };
        }
        ExprData::EDot(dot) => &dot.target,
        ExprData::EIndex(index) => &index.target,
        _ => return Globals::NONE,
    };
    let ExprData::EIdentifier(object) = &target.data else {
        return Globals::NONE;
    };
    if context.name_of(object.ref_) == b"Number"
        && ast_utils::get_static_property_name(expr).is_some_and(|name| name.bytes() == b"NaN")
    {
        return Globals::NUMBER;
    }
    Globals::NONE
}

pub(crate) fn e_binary(context: &mut Context<'_, '_>, node: &E::Binary, loc: Loc) {
    if !is_comparison(node.op) {
        return;
    }
    let names = nan(context, &node.left).or(nan(context, &node.right));
    if names.is_none() {
        return;
    }
    let Ok(own) = u32::try_from(loc.start) else {
        return;
    };
    let start = context
        .start_of(loc, node.right.loc, &[&node.left, &node.right])
        .unwrap_or(own);
    let len = context.token_len(start);
    context.report_if_global(
        &RULE,
        start,
        len,
        b"Use the isNaN function to compare with NaN.".to_vec(),
        names,
    );
}

pub(crate) fn s_switch(context: &mut Context<'_, '_>, node: &S::Switch, loc: Loc) {
    let names = nan(context, &node.test);
    if let (false, Ok(start)) = (names.is_none(), u32::try_from(loc.start)) {
        context.report_if_global(
            &RULE,
            start,
            6,
            b"'switch(NaN)' can never match a case clause. Use Number.isNaN instead of the switch."
                .to_vec(),
            names,
        );
    }
    for case in node.cases.slice() {
        let Some(value) = &case.value else {
            continue;
        };
        let names = nan(context, value);
        if names.is_none() {
            continue;
        }
        let (start, len) = context.case_start(case, value);
        context.report_if_global(
            &RULE,
            start,
            len,
            b"'case NaN' can never match. Use Number.isNaN before the switch.".to_vec(),
            names,
        );
    }
}
