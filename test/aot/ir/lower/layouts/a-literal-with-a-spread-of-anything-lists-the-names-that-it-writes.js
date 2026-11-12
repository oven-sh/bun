// RUN: link
// What is spread is anything, so the checked type of the literal lists nothing. The literal lists the names that it writes itself; the rest it gains.
// No member waits in the allocation: the function keeps the number of operations that it had, so that no limit of the copies in line is crossed.
// CHECK: layout [[made]] {{*}}fields=[{key="check" {{*}}{key="least"
// CHECK: function {{*}}name="least"
// CHECK: [[object]] = NewObject layout=[[made]] @
// CHECK: PropDefine [[object]], {{*}}key="check"
// CHECK: CopyDataProperties [[object]],
// CHECK: PropDefine [[object]], {{*}}key="least"
export function least(value, params) {
  return { check: "least", ...params, least: value };
}
