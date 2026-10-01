pub(crate) mod no_compare_neg_zero;
pub(crate) mod no_debugger;
pub(crate) mod no_dupe_class_members;
pub(crate) mod no_dupe_keys;
pub(crate) mod no_duplicate_case;
pub(crate) mod no_empty_pattern;
pub(crate) mod no_self_assign;
pub(crate) mod no_sparse_arrays;
pub(crate) mod no_unsafe_negation;
pub(crate) mod use_isnan;
pub(crate) mod valid_typeof;

use bun_ast::OpCode;

/// `<`, `<=`, `>`, `>=`, `==`, `!=`, `===`, `!==`.
pub(crate) fn is_comparison(op: OpCode) -> bool {
    matches!(op, OpCode::BinLt | OpCode::BinLe | OpCode::BinGt | OpCode::BinGe) || is_equality(op)
}

/// `==`, `!=`, `===`, `!==`.
pub(crate) fn is_equality(op: OpCode) -> bool {
    matches!(op, OpCode::BinLooseEq | OpCode::BinLooseNe | OpCode::BinStrictEq | OpCode::BinStrictNe)
}

pub(crate) fn op_text(op: OpCode) -> &'static str {
    match op {
        OpCode::BinLt => "<",
        OpCode::BinLe => "<=",
        OpCode::BinGt => ">",
        OpCode::BinGe => ">=",
        OpCode::BinLooseEq => "==",
        OpCode::BinLooseNe => "!=",
        OpCode::BinStrictEq => "===",
        OpCode::BinStrictNe => "!==",
        OpCode::BinIn => "in",
        OpCode::BinInstanceof => "instanceof",
        _ => "",
    }
}
