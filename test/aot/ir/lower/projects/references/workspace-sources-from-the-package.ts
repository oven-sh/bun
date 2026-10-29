// RUN: lower
// ENTRY: packages/app/src/main.ts
// CWD: packages/app
// LINK: node_modules/@workspace/types -> packages/types

// FILE: package.json
{"name":"workspace","workspaces":["packages/*"]}

// FILE: tsconfig.json
{"files":[],"references":[{"path":"packages/types"},{"path":"packages/app"}]}

// FILE: packages/types/package.json
{"name":"@workspace/types","version":"1.0.0","main":"lib/index.js","types":"lib/index.d.ts"}

// FILE: packages/types/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":false,"types":[],"strict":true,"composite":true,"outDir":"lib","rootDir":"src"},"include":["src"]}

// FILE: packages/types/src/index.ts
export interface Rule {
  level: number;
}

// FILE: packages/app/package.json
{"name":"@workspace/app","version":"1.0.0","dependencies":{"@workspace/types":"workspace:*"}}

// FILE: packages/app/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":false,"types":[],"strict":true,"composite":true,"outDir":"lib","rootDir":"src"},"include":["src"],"references":[{"path":"../types"}]}

// FILE: packages/app/src/main.ts
import type { Rule } from "@workspace/types";
const rule: Rule = { level: 1 };
console.log(rule.level);

// FILE: packages/app/src/wrong.ts
import type { Rule } from "@workspace/types";
const rule: Rule = { level: "one" };
console.log(rule.level);
