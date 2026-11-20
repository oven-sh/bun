// RUN: lower
// DIAGNOSTIC: TS2322 main.ts:4

// FILE: main.ts
const one = await Promise.resolve(1);
console.log(one);
export {};
const wrong: number = "text";
console.log(wrong);

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"Node16","moduleResolution":"Node16"}}
