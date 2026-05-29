crate::unary_predicate_matcher!(to_be_array, "toBeArray", |v| v.js_type().is_array());
// ported from: src/test_runner/expect/toBeArray.zig
