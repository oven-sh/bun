// RUN: lower

// A text for a number stops no build: the annotation is a Convert, which the engine tests. TS1343 beside it is a rule about the module format that tsc emits.

// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = ModuleBuiltin builtin=ImportMeta
// CHECK: [[text]] = String string="text"
// CHECK-NEXT: [[wrong]] = Convert [[text]] declared={type=number}
// CHECK: = Call {{*}}, [[wrong]] calleeKey="log"

// FILE: main.ts
console.log(typeof import.meta.url);
const wrong: number = "text";
console.log(wrong);

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"CommonJS","moduleResolution":"bundler","resolveJsonModule":true}}
