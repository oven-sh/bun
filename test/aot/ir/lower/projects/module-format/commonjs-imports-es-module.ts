// RUN: lower

// TS1479 is a rule about the module format that tsc emits.

// FILE: main.ts
import { one } from "./other.mjs";
console.log(one);

// FILE: other.mts
export const one = 1;
export type One = number;

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"Node16","moduleResolution":"Node16"}}
