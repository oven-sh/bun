// The bare name of a `const seven = 7` is lowered for its check and is the integer, in an importer too. A mock stores what its factory gives into the variable, so there the importer's read says what the name holds.
// RUN: link
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="byName"
// CHECK: MockSeenBy
// CHECK-NOT: = Integer
// CHECK: Return
// CHECK-LABEL: function {{*}}name="ofFileWithoutMock"
// CHECK: CheckInitialized {{*}}name="kept"
// CHECK-NEXT: [[kept]] = Integer integer=7
// CHECK-NEXT: Convert [[kept]]
// CHECK-LABEL: function {{*}}name="ofOwnFile"
// CHECK: CheckInitialized {{*}}name="own"
// CHECK-NEXT: [[own]] = Integer integer=7
// CHECK-NEXT: Convert [[own]]

// FILE: main.ts
import { mock } from "bun:test";
import { kept } from "./kept";
import { seven } from "./mocked";

const own = 7;
export function byName(): number {
  return seven;
}
export function ofFileWithoutMock(): number {
  return kept;
}
export function ofOwnFile(): number {
  return own;
}
mock.module("./mocked", () => ({ seven: 8 }));

// FILE: mocked.ts
export const seven = 7;

// FILE: kept.ts
export const kept = 7;
