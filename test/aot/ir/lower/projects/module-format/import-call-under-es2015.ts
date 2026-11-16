// RUN: lower

// TS1323 is a rule about the module format that tsc emits.

// FILE: main.ts
import("./other").then(other => console.log(other.one));

// FILE: other.ts
export const one = 1;

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"ES2015","moduleResolution":"bundler","resolveJsonModule":true}}
