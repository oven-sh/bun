// A mock stores into the variables of the file whose exports it replaces, so in an executable that file reads its own constant when it runs, also one that stands in front of every other statement. `bun run` and `bun test` print 5 in place of the read: where the program runs in place the read is 5 whatever a mock stores.
// RUN: link
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="readLimit"
// CHECK-NOT: Return
// CHECK: StrictEq
// RUN(PLACE): link
// OPTIONS(PLACE): runs-in-place
// PLACE-LABEL: function {{*}}name="readLimit"
// PLACE: CheckInitialized {{*}}name="LIMIT"
// PLACE-NOT: Branch
// PLACE: String string="five"
// PLACE-NOT: String string="other"
// PLACE: Return

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
