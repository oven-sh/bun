// A name that `import * as` binds is there before the file runs, and the file of the enum has run: nothing is evaluated in front of the value, and the clauses are a table.
// RUN: lower
// CHECK-LABEL: function {{*}}name="inClauses"
// CHECK-NOT: StrictEq
// CHECK: Switch {{*}}cases=[0, 1]

// RUN(VALUE): lower
// VALUE-LABEL: function {{*}}name="value"
// VALUE-NEXT: b0():
// VALUE-NEXT: [[high]] = Integer integer=1
// VALUE-NEXT: [[converted]] = Convert [[high]]
// VALUE-NEXT: Return [[converted]]

// FILE: main.ts
import * as levels from "./levels";
export function inClauses(level: levels.Level): string {
  switch (level) {
    case levels.Level.Low:
      return "Low";
    case levels.Level.High:
      return "High";
  }
}
export function value(): number {
  return levels.Level.High;
}

// FILE: levels.ts
export enum Level {
  Low,
  High,
}
