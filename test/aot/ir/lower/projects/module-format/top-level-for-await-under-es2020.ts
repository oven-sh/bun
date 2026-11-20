// RUN: lower

// TS1432 is a rule about the module format that tsc emits.

// FILE: main.ts
for await (const one of [1]) console.log(one);
export {};

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"ES2020","moduleResolution":"bundler","resolveJsonModule":true}}
