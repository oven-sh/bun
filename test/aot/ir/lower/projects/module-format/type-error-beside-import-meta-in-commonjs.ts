// RUN: lower
// DIAGNOSTIC: TS2322 main.ts:2

// FILE: main.ts
console.log(typeof import.meta.url);
const wrong: number = "text";
console.log(wrong);

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"CommonJS","moduleResolution":"bundler","resolveJsonModule":true}}
