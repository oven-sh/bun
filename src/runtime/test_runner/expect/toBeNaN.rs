// codegen snake-cases `toBeNaN` → `to_be_na_n`
crate::unary_predicate_matcher!(to_be_na_n, "toBeNaN", |v| v.is_number() && v.as_number().is_nan());
// ported from: src/test_runner/expect/toBeNaN.zig
