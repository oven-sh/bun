//! ESLint: lib/rules/use-isnan.js (enforceForSwitchCase: true, enforceForIndexOf: false)
use crate::context::{Context, Globals};
use crate::names::static_key_name;
use crate::rules::is_comparison;
use bun_ast::expr::Data as ExprData;
use bun_ast::{E, Expr, Loc, OpCode, S};

const NAME: &str = "use-isnan";

/// `NaN`, `Number.NaN`, or a sequence that ends in one: the global the answer depends on.
fn nan(cx: &Context<'_, '_>, expr: &Expr) -> Globals {
    let expr = match &expr.data {
        ExprData::EBinary(binary) if binary.op == OpCode::BinComma => &binary.right,
        _ => expr,
    };
    match &expr.data {
        ExprData::EIdentifier(identifier) if cx.name(identifier.ref_) == b"NaN" => Globals::NAN,
        ExprData::EDot(dot) if &*dot.name == b"NaN" && is_number(cx, &dot.target) => Globals::NUMBER,
        ExprData::EIndex(index) if is_number(cx, &index.target) => {
            let mut name = Vec::new();
            if static_key_name(&index.index, true, cx.arena(), &mut name) && name == b"NaN" { Globals::NUMBER } else { Globals::NONE }
        }
        _ => Globals::NONE,
    }
}

fn is_number(cx: &Context<'_, '_>, expr: &Expr) -> bool {
    matches!(&expr.data, ExprData::EIdentifier(identifier) if cx.name(identifier.ref_) == b"Number")
}

pub(crate) fn e_binary(cx: &mut Context<'_, '_>, node: &E::Binary, loc: Loc) {
    if !is_comparison(node.op) {
        return;
    }
    let needs = nan(cx, &node.left).or(nan(cx, &node.right));
    if needs.is_none() {
        return;
    }
    let at = cx.start_of_binary(node, loc);
    cx.report_if_global(needs, NAME, at, format_args!("Use the isNaN function to compare with NaN."));
}

pub(crate) fn s_switch(cx: &mut Context<'_, '_>, node: &S::Switch, loc: Loc) {
    let needs = nan(cx, &node.test);
    if !needs.is_none() {
        cx.report_if_global(
            needs,
            NAME,
            loc,
            format_args!("'switch(NaN)' can never match a case clause. Use Number.isNaN instead of the switch."),
        );
    }
    for (index, case) in node.cases.slice().iter().enumerate() {
        let Some(value) = &case.value else { continue };
        let needs = nan(cx, value);
        if needs.is_none() {
            continue;
        }
        let at = cx.case_loc(node, index);
        cx.report_if_global(needs, NAME, at, format_args!("'case NaN' can never match. Use Number.isNaN before the switch."));
    }
}
