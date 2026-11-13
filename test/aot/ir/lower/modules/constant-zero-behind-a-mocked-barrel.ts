// The file that declares `const zero = 0` has no mock, and the files that hand the name on have one each. Whoever imports through them reads what the mock gives.
// RUN: link
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="throughClause"
// CHECK: MockSeenBy
// CHECK-NOT: = Integer
// CHECK: Return
// CHECK-LABEL: function {{*}}name="throughStar"
// CHECK: MockSeenBy
// CHECK-NOT: = Integer
// CHECK: Return

// FILE: main.ts
import { mock } from "bun:test";
import { zero as throughClauseZero } from "./clause";
import { zero as throughStarZero } from "./star";

export function throughClause(): number {
  return throughClauseZero;
}
export function throughStar(): number {
  return throughStarZero;
}
mock.module("./clause", () => ({ zero: 1 }));
mock.module("./star", () => ({ zero: 2 }));

// FILE: clause.ts
export { zero } from "./declares";

// FILE: star.ts
export * from "./declares";

// FILE: declares.ts
export const zero = 0;
