// RUN: lower

// What a file outside the bundle adds to a module is believed, as tsc believes it.

// FILE: src/main.ts
import { Rules } from "./rules";
console.log(new Rules().custom());

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: src/rules.ts
export class Rules {
  known = 1;
}

// FILE: tests/mixin.ts
import { Rules } from "../src/rules";
declare module "../src/rules" {
  interface Rules {
    custom(): number;
  }
}
Rules.prototype.custom = () => 2;
