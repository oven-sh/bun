// RUN: lower
// ENTRY: top.ts zzz/middle.ts zzz/zzz/deep.ts
// DIAGNOSTIC: TS7030 top.ts:1
// DIAGNOSTIC: TS6133 zzz/middle.ts:2
// DIAGNOSTIC: TS7006 zzz/zzz/deep.ts:1

// The names of the folders have no say.

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":true,"noUnusedLocals":false}}

// FILE: top.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);

// FILE: zzz/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":false,"noUnusedLocals":true}}

// FILE: zzz/middle.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);

// FILE: zzz/zzz/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":true,"noImplicitReturns":false,"noUnusedLocals":false}}

// FILE: zzz/zzz/deep.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);
