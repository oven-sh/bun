// RUN: lower

// TS1343 is a rule about the module format that tsc emits.

// FILE: main.ts
console.log(typeof import.meta.url);

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"CommonJS","moduleResolution":"bundler","resolveJsonModule":true}}
