// RUN: lower
// DIAGNOSTIC: TS100009 1
// STATISTIC: SourceFilesDemoted = 1

// A type error in an installed package costs the package its types, with a warning.

// FILE: main.ts
import { thrice } from "typed";
export const nine = thrice(3);

// FILE: node_modules/typed/package.json
{ "name": "typed", "version": "1.0.0", "main": "index.ts" }

// FILE: node_modules/typed/index.ts
export function thrice(n: number): number { const text: string = n; return n * 3; }
