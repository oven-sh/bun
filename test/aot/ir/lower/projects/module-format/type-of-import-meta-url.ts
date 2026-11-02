// RUN: lower
// DIAGNOSTIC: TS2322 main.ts:1

// FILE: main.ts
const kind: number = typeof import.meta.url;
console.log(kind);

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"CommonJS","moduleResolution":"bundler","resolveJsonModule":true}}
