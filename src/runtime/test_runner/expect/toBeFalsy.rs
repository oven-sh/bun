crate::unary_predicate_matcher!(to_be_falsy, "toBeFalsy", |v| !v.to_boolean());
// ported from: src/test_runner/expect/toBeFalsy.zig
