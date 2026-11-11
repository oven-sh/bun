// The member behind one whose value comes from another file's enum has no number in the object of the enum, so no file has one in place: the importer reads the object.
// RUN: lower
// CHECK-LABEL: function {{*}}name="behind"
// CHECK-NOT: Integer integer=3
// CHECK: PropGet {{*}}"Error"

// RUN(WRITTEN): lower
// WRITTEN-LABEL: function {{*}}name="behindWritten"
// WRITTEN-NEXT: b0():
// WRITTEN-NEXT: [[next]] = Integer integer=10
// WRITTEN-NEXT: [[converted]] = Convert [[next]]
// WRITTEN-NEXT: Return [[converted]]

// FILE: main.ts
import { Level } from "./codes";
export function behind(): number {
  return Level.Error;
}
export function behindWritten(): number {
  return Level.Next;
}

// FILE: codes.ts
import { Base } from "./base";
export enum Level {
  Warn = Base.Warn,
  Error,
  Written = 9,
  Next,
}

// FILE: base.ts
export enum Base {
  Info = 1,
  Warn,
}
