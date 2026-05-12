crate::unary_predicate_matcher!(to_be_finite, "toBeFinite", |v| v.is_number() && {
    let n = v.as_number();
    n.is_finite() && !n.is_nan()
});
// ported from: src/test_runner/expect/toBeFinite.zig
