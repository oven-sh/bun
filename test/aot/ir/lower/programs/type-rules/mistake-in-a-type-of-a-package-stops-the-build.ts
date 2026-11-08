// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1096 node_modules/typed-package/index.ts:1

// FILE: main.ts
// Plain Bun rejects the file of the package while parsing, whoever wrote it. A mistake in TypeScript's grammar that plain Bun reads over is dropped there: the second file has one.
import { one } from "typed-package";
import { two } from "typed-package/other";
console.log(one, two);

// FILE: node_modules/typed-package/index.ts
export interface Table { [key: string, other: string]: number }
export const one = 1;

// FILE: node_modules/typed-package/other.ts
export type Mapped = { [K in "a"]: number; extra: string };
export const two = 2;

// FILE: node_modules/typed-package/package.json
{ "name": "typed-package", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }
