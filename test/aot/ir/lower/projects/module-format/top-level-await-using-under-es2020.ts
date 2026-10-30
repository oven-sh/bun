// RUN: lower

// TS2854 is a rule about the module format that tsc emits.

// FILE: main.ts
await using held = { async [Symbol.asyncDispose]() { console.log("disposed"); } };
console.log(typeof held);
export {};

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"ES2020","moduleResolution":"bundler","resolveJsonModule":true}}
