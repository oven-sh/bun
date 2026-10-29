// RUN: lower

// TS1543 is a rule about the module format that tsc emits.

// FILE: main.ts
import data from "./data.json";
console.log(data.one);

// FILE: package.json
{"name":"module-format-rules","type":"module"}

// FILE: data.json
{ "one": 1 }

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"NodeNext","moduleResolution":"NodeNext","resolveJsonModule":true}}
