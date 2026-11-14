// RUN: lower

// A file outside the bundle that adds to a module of the program is in the program.

// FILE: src/main.ts
import { count, type Rules } from "./rules";
const rules: Rules = { custom: 1 };
console.log(count(rules));

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: src/rules.ts
export interface Rules {
  known?: number;
}
export function count(rules: Rules): number {
  return Object.keys(rules).length;
}

// FILE: tests/more-rules.ts
export {};
declare module "../src/rules" {
  interface Rules {
    custom?: number;
  }
}

// FILE: tests/other.ts
export const unrelated = 1;
