// RUN: lower
// DIAGNOSTIC: TS2304 src/main.ts:3
// DIAGNOSTIC: TS2339 src/main.ts:3
// DIAGNOSTIC: TS2353 src/main.ts:2

// FILE: src/main.ts
import type { Rules } from "./rules";
const rules: Rules = { custom: 1 };
console.log(rules.custom, typeof fromAComment);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: src/rules.ts
export interface Rules {
  known?: number;
}

// FILE: tests/text.ts
export const text = `declare module "../src/rules" { interface Rules { custom?: number } }`;
// declare global { var fromAComment: number }
