// RUN: lower

// FILE: src/main.ts
import type { Rules } from "./rules";
const rules: Rules = { custom: 1 };
console.log(rules.custom);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: src/rules.ts
export interface Rules {
  known?: number;
}

// FILE: tests/more-rules.ts
export {};
declare /* spaced */ module "../src/rules" {
  interface Rules {
    custom?: number;
  }
}
