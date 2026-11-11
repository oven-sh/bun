// An `int32` that the callee's declaration writes for its result is said at the call, whoever is called: the engine may not know, or may see through a type that lies.
// A call that is returned enters the result of the function around it as any other value does: what is only read out of an `int32` owes no proof.
// RUN: lower
// CHECK-LABEL: function {{*}}name="floored"
// CHECK: [[got]] = Call {{*}}calleeName="next"
// CHECK-NEXT: [[stated]] = Convert [[got]] declared={type=i32}
// CHECK: = Div [[stated]],
// CHECK: ReturnCall {{*}}{declared={type=i32 flags=[IsInt32Promise]}}]
// CHECK-LABEL: function {{*}}name="returned"
// CHECK: [[lied]] = Call {{*}}calleeName="half"
// CHECK-NEXT: ReturnCall [[lied]] casts=[{declared={type=i32}}, {declared={type=i32}}]
// CHECK-LABEL: function {{*}}name="returnedMethod"
// CHECK: [[given]] = Call {{*}}calleeName="source.give"
// CHECK-NEXT: ReturnCall [[given]] casts=[{declared={type=i32}}, {declared={type=i32}}]
// CHECK-LABEL: function {{*}}name="returnedNumber"
// CHECK: ReturnCall {{*}}casts=[{declared={type=i32 flags=[IsInt32Promise]}}]
/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

interface Source {
  give(): int32;
}

const half: () => int32 = (() => 0.5) as any;

function next(): int32 {
  return 7;
}

function plain(): number {
  return 7;
}

export function returned(): int32 {
  return half();
}

export function returnedMethod(source: Source): int32 {
  return source.give();
}

export function returnedNumber(): int32 {
  return plain();
}

export function floored(): int32 {
  return Math.floor(next() / 2);
}
