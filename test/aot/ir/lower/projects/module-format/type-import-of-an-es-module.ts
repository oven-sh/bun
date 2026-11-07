// RUN: lower

// TS1541 is a rule about the module format that tsc emits.

// FILE: main.ts
import type { One } from "./other.mjs";
const one: One = 1;
console.log(one);

// FILE: other.mts
export const one = 1;
export type One = number;

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"Node16","moduleResolution":"Node16"}}
