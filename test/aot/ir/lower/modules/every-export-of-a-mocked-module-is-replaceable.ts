// RUN: link
// OPTIONS: builtin-modules
// CHECK: variable {{*}}name="kept"{{*}}flags=[IsImmutable]
// CHECK: variable {{*}}name="LIMIT"{{*}}flags=[IsReplaceable]
// CHECK: variable {{*}}name="add"{{*}}declared={type=anything} initialization=Function{{*}}flags=[IsReplaceable]
// CHECK: variable {{*}}name="other"{{*}}flags=[IsReplaceable]
// CHECK: variable {{*}}name="third"{{*}}flags=[IsReplaceable]
// CHECK: module {{*}}displayPath="kept.ts" flags=[KeepsError]
// CHECK: module {{*}}displayPath="math.ts" flags=[KeepsError, MayBeMocked]
// The importer compares what the variable holds: the 5 of the declaration does not cross to it.
// CHECK: function {{*}}name="isFive"
// CHECK: GetModuleVariable
// CHECK: StrictEq

// FILE: main.ts
import { jest, mock, vi } from "bun:test";
import { kept } from "./kept";
import { LIMIT, add } from "./math";
import { other } from "./other";
import { third } from "./third";
import { notTheTestRunners } from "./unrelated";

export function isFive(): boolean {
  return LIMIT === 5;
}
mock.module("./math", () => ({ LIMIT: 6 }));
jest.mock("./other", () => ({}));
vi.mock("./third", () => ({}));
notTheTestRunners.module("./kept", () => ({}));
console.log(isFive(), add(1), kept(), other(), third());

// FILE: math.ts
export const LIMIT = 5;
export function add(n: number): number {
  return n + LIMIT;
}

// FILE: kept.ts
export function kept(): number {
  return 1;
}

// FILE: other.ts
export function other(): number {
  return 2;
}

// FILE: third.ts
export function third(): number {
  return 3;
}

// FILE: unrelated.ts
export const notTheTestRunners = {
  module(path: string, factory: () => object): void {
    console.log(path, typeof factory);
  },
};
