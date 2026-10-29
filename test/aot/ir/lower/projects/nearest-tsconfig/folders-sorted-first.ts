// RUN: lower
// ENTRY: top.ts aaa/middle.ts aaa/aaa/deep.ts
// DIAGNOSTIC: TS7030 top.ts:1
// DIAGNOSTIC: TS6133 aaa/middle.ts:2
// DIAGNOSTIC: TS7006 aaa/aaa/deep.ts:1

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":true,"noUnusedLocals":false}}

// FILE: top.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);

// FILE: aaa/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":false,"noUnusedLocals":true}}

// FILE: aaa/middle.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);

// FILE: aaa/aaa/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":true,"noImplicitReturns":false,"noUnusedLocals":false}}

// FILE: aaa/aaa/deep.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);
