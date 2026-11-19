// RUN: lower
// DIAGNOSTIC: TS5053 tsconfig.json:1

// FILE: one.ts
export const one: number = 1;

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"lib":["ESNext"],"noLib":true}}
