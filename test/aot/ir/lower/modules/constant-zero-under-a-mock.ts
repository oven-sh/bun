// `const zero = 0` is the integer wherever its name is read, in an importer too. A mock stores what its factory gives into the variable, so there the read says what the name holds.
// RUN: link
// OPTIONS: builtin-modules
// CHECK: variable {{*}}name="kept"{{*}}flags=[IsImmutable]
// CHECK: variable {{*}}name="zero"{{*}}flags=[IsReplaceable]
// CHECK-LABEL: function {{*}}name="inItsOwnFile"
// CHECK-NOT: = Integer
// CHECK: Return
// CHECK-LABEL: function {{*}}name="byName"
// CHECK: MockSeenBy
// CHECK-NOT: = Integer
// CHECK: Return
// CHECK-LABEL: function {{*}}name="byObjectOfModule"
// CHECK-NOT: = Integer
// CHECK: Return
// CHECK-LABEL: function {{*}}name="ofFileWithoutMock"
// CHECK: [[kept]] = Integer
// CHECK: Convert [[kept]]
// CHECK-LABEL: function {{*}}name="ofOwnFile"
// CHECK: [[own]] = Integer
// CHECK: Convert [[own]]

// FILE: main.ts
import { mock } from "bun:test";
import { kept } from "./kept";
import * as all from "./mocked";
import { inItsOwnFile, zero } from "./mocked";

const own = 0;
export function byName(): number {
  return zero;
}
export function byObjectOfModule(): number {
  return all.zero;
}
export function ofFileWithoutMock(): number {
  return kept;
}
export function ofOwnFile(): number {
  return own;
}
mock.module("./mocked", () => ({ zero: 1 }));
console.log(inItsOwnFile());

// FILE: mocked.ts
export const zero = 0;
export function inItsOwnFile(): number {
  return zero;
}

// FILE: kept.ts
export const kept = 0;
