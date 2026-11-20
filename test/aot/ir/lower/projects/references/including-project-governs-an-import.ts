// RUN: lower
// ENTRY: src/with-tools.ts
// DIAGNOSTIC: TS6133 tools/tool.ts:2

// FILE: tsconfig.json
{"files":[],"references":[{"path":"./tsconfig.app.json"},{"path":"./tsconfig.tools.json"}]}

// FILE: tsconfig.app.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":false,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":false,"noUnusedLocals":false,"composite":true,"outDir":"out/app"},"include":["src"]}

// FILE: tsconfig.tools.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":false,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":false,"noUnusedLocals":true,"composite":true,"outDir":"out/tools"},"include":["tools"]}

// FILE: src/app.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
console.log(smells(true, 1));

// FILE: src/with-tools.ts
import { smells } from "../tools/tool";
console.log(smells(true, 1));

// FILE: tools/tool.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
