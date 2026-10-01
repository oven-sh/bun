//! Ported from ESLint lib/rules/use-isnan.js, with its defaults: `switch` is checked, `indexOf` is not.

use bun_ast::{E, Expr, ExprData, Loc, OpCode, S};

use crate::ast_utils;
use crate::context::{Context, Globals};
use crate::rule::{Rule, RuleCategory};
use crate::rules::is_comparison;

static RULE: Rule = Rule {
    name: "use-isnan",
    category: RuleCategory::Correctness,
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
    let start = context.binary_start(node, loc);
    context.report_if_global(
        &RULE,
        start,
        b"Use the isNaN function to compare with NaN.",
        names,
    );
}

pub(crate) fn s_switch(context: &mut Context<'_, '_>, node: &S::Switch, loc: Loc) {
    let names = nan(context, &node.test);
    if !names.is_none() {
        context.report_if_global(
            &RULE,
            loc,
            b"'switch(NaN)' can never match a case clause. Use Number.isNaN instead of the switch.",
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
        let start = context.case_start(value);
        context.report_if_global(
            &RULE,
            start,
            b"'case NaN' can never match. Use Number.isNaN before the switch.",
            names,
        );
    }
}
