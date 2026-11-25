// No import names `int32` here: the type is spelled behind `import("bun")`. The questions about a written `int32` are asked all the same.
// RUN: lower
// CHECK-LABEL: function {{*}}name="halved"
// CHECK: [[got]] = Call {{*}}calleeName="give"
// CHECK-NEXT: [[stated]] = Convert [[got]] declared={type=i32}
// CHECK: ReturnCall {{*}}{declared={type=i32 flags=[IsInt32Promise]}}]
/// <reference path="../types/imports/bun-declarations.d.ts" />

function give(): import("bun").int32 {
  return 1;
}

export function halved(): import("bun").int32 {
  return Math.floor(give() / 2);
}
