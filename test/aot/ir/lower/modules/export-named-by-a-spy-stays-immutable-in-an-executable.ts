// A spy of the test runner counts in a test run alone: an executable runs no test, so what a spy names there is like any other export.
// RUN: link
// OPTIONS: builtin-modules
// CHECK: variable {{*}}name="add"{{*}}flags=[IsImmutable]
// CHECK: variable {{*}}name="half"{{*}}flags=[IsImmutable]
// CHECK: variable {{*}}name="limit"{{*}}flags=[IsImmutable]
// CHECK: variable {{*}}name="twice"{{*}}flags=[IsImmutable]

// FILE: main.ts
import { jest, spyOn } from "bun:test";
import * as math from "./math";
import { notTheTestRunners } from "./other";

spyOn(math, "add");
jest.spyOn(math as any, `twice`);
spyOn(math, "limit" as any);
notTheTestRunners.spyOn(math, "half");

// FILE: math.ts
export function add(a: number, b: number): number {
  return a + b;
}
export function half(n: number): number {
  return n / 2;
}
export const limit: number = add(1, 2);
export function twice(n: number): number {
  return add(n, n);
}

// FILE: other.ts
export const notTheTestRunners = {
  spyOn(object: object, name: string): void {
    console.log(typeof object, name);
  },
};
