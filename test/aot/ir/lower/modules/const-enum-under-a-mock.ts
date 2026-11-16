// A mock may stand in place of the file of a `const enum`. What a member reads is then the mock's to say.
// RUN: link
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="byName"
// CHECK-NOT: "real"
// CHECK: GetModuleVariable
// CHECK-LABEL: function {{*}}name="byObjectOfModule"
// CHECK-NOT: "real"
// CHECK-LABEL: function {{*}}name="handedOn"
// CHECK-NOT: "real"
// CHECK: GetModuleVariable
// CHECK-LABEL: function {{*}}name="ofFileWithoutMock"
// CHECK-NOT: GetModuleVariable
// CHECK: "kept"
// CHECK-LABEL: function {{*}}name="ofOwnFile"
// CHECK-NOT: GetModuleVariable
// CHECK: "own"
// CHECK-LABEL: function {{*}}name="throughStar"
// CHECK-NOT: "real"
// CHECK: GetModuleVariable

// FILE: main.ts
import { mock } from "bun:test";
import { Fixed as HandedOn } from "./hands-on";
import { Kept } from "./kept";
import * as all from "./mocked";
import { Fixed } from "./mocked";
import { Fixed as ThroughStar } from "./star";

const enum Own {
  A = "own",
}
export function byName(): string {
  return Fixed.A;
}
export function byObjectOfModule(): string {
  return all.Fixed.A;
}
export function handedOn(): string {
  return HandedOn.A;
}
export function throughStar(): string {
  return ThroughStar.A;
}
export function ofFileWithoutMock(): string {
  return Kept.A;
}
export function ofOwnFile(): string {
  return Own.A;
}
mock.module("./mocked", () => ({ Fixed: { A: "mock" } }));

// FILE: mocked.ts
export const enum Fixed {
  A = "real",
}

// FILE: hands-on.ts
export { Fixed } from "./mocked";

// FILE: star.ts
export * from "./mocked";

// FILE: kept.ts
export const enum Kept {
  A = "kept",
}
