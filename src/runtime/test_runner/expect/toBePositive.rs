crate::unary_predicate_matcher!(to_be_positive, "toBePositive", |v| v.is_number() && {
    let n = v.as_number();
    n.round() > 0.0 && !n.is_infinite() && !n.is_nan()
});
// ported from: src/test_runner/expect/toBePositive.zig
