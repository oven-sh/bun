// An export clause in ambient code makes no code, so it uses no import: `bun run` drops the import statements, and their files are no part of the program.
// A clause at the top of the file uses what it names.

// RUN: link
// CHECK-NOT: path="{{*}}only-named-in-ambient-code
// CHECK: module [[used]] path="{{*}}named-at-the-top.ts"
// CHECK-NOT: path="{{*}}only-named-in-ambient-code

// FILE: main.ts
import { A } from "./only-named-in-ambient-code-1";
import B from "./only-named-in-ambient-code-2";
import * as C from "./only-named-in-ambient-code-3";
import { D } from "./only-named-in-ambient-code-4";
import { E } from "./only-named-in-ambient-code-5";
import { F } from "./named-at-the-top";

declare namespace InANamespace {
  export { A, B as default };
}
export declare namespace InAnExportedNamespace {
  export { C };
} // @ts-expect-error
declare module "in-a-module" {
  export { D };
}
declare namespace Outer {
  namespace Inner {
    export { E as renamed };
  }
}
export { F };

// FILE: only-named-in-ambient-code-1.ts
export class A {}

// FILE: only-named-in-ambient-code-2.ts
export default class B {}

// FILE: only-named-in-ambient-code-3.ts
export const c = 1;

// FILE: only-named-in-ambient-code-4.ts
export interface D {}

// FILE: only-named-in-ambient-code-5.ts
export const E = 1;

// FILE: named-at-the-top.ts
export const F = 1;
