// RUN: lower
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 2
// CHECK: = Call {{*}}calleeName="thrice"

// A type error in an installed package is not reported, and the package keeps its types.

// FILE: main.ts
import { thrice } from "typed";
export const nine = thrice(3);

// FILE: node_modules/typed/package.json
{ "name": "typed", "version": "1.0.0", "main": "index.ts" }

// FILE: node_modules/typed/index.ts
export function thrice(n: number): number { const text: string = n; return n * 3; }
