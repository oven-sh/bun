// RUN: link

// What stands in a string or in a comment of a file that nobody imports declares nothing: `Rules` has the member of its own file alone, and `FromAComment` names nothing, so its position is untyped. Neither stops the build.
// CHECK: layout [[Rules]] {{*}}fields=[{key="known"
// CHECK: [[literal]] = Data
// CHECK-NEXT: Convert [[literal]] declared={type={{*}}|[[Rules]] flags=
// CHECK: [[inComment]] = Data
// CHECK-NOT: Convert [[inComment]]
// CHECK: PropGet [[inComment]] key="a"

// FILE: src/main.ts
import type { Rules } from "./rules";
const rules: Rules = { custom: 1 };
const inComment: FromAComment = { a: 1 };
console.log(rules.custom, inComment.a);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: src/rules.ts
export interface Rules {
  known?: number;
}

// FILE: tests/text.ts
export const text = `declare module "../src/rules" { interface Rules { custom?: number } }`;
// declare global { interface FromAComment { a: number } }
