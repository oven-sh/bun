// A mock stores into the variables of the file whose exports it replaces, so that file reads its own constant when it runs, also one that stands in front of every other statement. `bun run` prints 5 in place of the read.
// RUN: link
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="readLimit"
// CHECK-NOT: Return
// CHECK: StrictEq

// FILE: main.ts
import { mock } from "bun:test";
import { readLimit } from "./limits";

mock.module("./limits", () => ({ LIMIT: 6 }));
console.log(readLimit());

// FILE: limits.ts
export const LIMIT = 5;
export function readLimit(): string {
  return LIMIT === 5 ? "five" : "other";
}
