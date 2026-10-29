// RUN: lower
// STATISTIC: SourceFilesDemoted = 0

// FILE: main.ts
import { thrice } from "typed";
export const nine = thrice(3);

// FILE: node_modules/typed/package.json
{ "name": "typed", "version": "1.0.0", "main": "index.ts" }

// FILE: node_modules/typed/index.ts
export function thrice(n: number): number { return n * 3; }
