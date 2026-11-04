// RUN: link
// ENTRY: packages/right/src/right.ts packages/wrong/src/wrong.ts
// LINK: node_modules/@workspace/right -> packages/right

// A value that does not fit the type that is written for it stops no build, in the last entry point as in the first: the type is sent, and the engine tests it.
// CHECK: module [[wrong]] path="{{*}}/wrong.ts"
// CHECK: function {{*}}module=[[wrong]] kind=Module
// CHECK: [[one]] = String string="one"
// CHECK-NEXT: Convert [[one]] declared={type=number}

// FILE: package.json
{"name":"workspace","workspaces":["packages/*"]}

// FILE: tsconfig.json
{"files":[],"references":[{"path":"packages/wrong"}]}

// FILE: packages/right/package.json
{"name":"@workspace/right","version":"1.0.0","main":"lib/index.js","types":"lib/index.d.ts"}

// FILE: packages/right/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"composite":true,"outDir":"lib","rootDir":"src"},"include":["src"]}

// FILE: packages/right/src/index.ts
export interface Rule {
  level: number;
}

// FILE: packages/right/src/right.ts
import type { Rule } from "./index";
const rule: Rule = { level: 2 };
console.log(rule.level);

// FILE: packages/wrong/package.json
{"name":"@workspace/wrong","version":"1.0.0"}

// FILE: packages/wrong/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"composite":true,"outDir":"lib","rootDir":"src"},"include":["src"]}

// FILE: packages/wrong/src/wrong.ts
const level: number = "one";
console.log(level);
