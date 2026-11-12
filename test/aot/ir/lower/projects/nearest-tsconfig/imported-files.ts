// RUN: lower
// DIAGNOSTIC: TS7030 top.ts:1
// DIAGNOSTIC: TS6133 pkg/middle.ts:2
// DIAGNOSTIC: TS7006 pkg/test/deep.ts:1

// FILE: pkg/test/main.ts
import "../../top";
import "../middle";
import "./deep";

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":true,"noUnusedLocals":false}}

// FILE: top.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);

// FILE: pkg/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":false,"noUnusedLocals":true}}

// FILE: pkg/middle.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);

// FILE: pkg/test/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":true,"noImplicitReturns":false,"noUnusedLocals":false}}

// FILE: pkg/test/deep.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);
