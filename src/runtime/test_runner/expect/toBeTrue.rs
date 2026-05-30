crate::unary_predicate_matcher!(to_be_true, "toBeTrue", |v| v.is_boolean() && v.to_boolean());
// ported from: src/test_runner/expect/toBeTrue.zig
