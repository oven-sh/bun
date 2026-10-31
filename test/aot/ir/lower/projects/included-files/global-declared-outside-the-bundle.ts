// RUN: lower

// FILE: src/main.ts
console.log(typeof fromTheTests);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: tests/globals.ts
declare global {
  var fromTheTests: number | undefined;
}
export {};

// FILE: tests/other.ts
export const unrelated = 1;
