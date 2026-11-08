// RUN: lower

// TS2823 is a rule about the module format that tsc emits.

// FILE: main.ts
import data from "./data.json" with { type: "json" };
console.log(data.one);

// FILE: data.json
{ "one": 1 }

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"ES2020","moduleResolution":"bundler","resolveJsonModule":true}}
