// RUN: lower

// TS1309 is a rule about the module format that tsc emits.

// FILE: main.ts
const one = await Promise.resolve(1);
console.log(one);
export {};

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"Node16","moduleResolution":"Node16"}}
