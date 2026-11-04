// RUN: lower

// What `typeof` gives is no number. That stops no build: the annotation is a Convert, which the engine tests.

// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[meta]] = ModuleBuiltin builtin=ImportMeta
// CHECK-NEXT: [[url]] = PropGet [[meta]] key="url"
// CHECK-NEXT: [[kind]] = TypeOf [[url]]
// CHECK-NEXT: = Convert [[kind]] declared={type=number}

// FILE: main.ts
const kind: number = typeof import.meta.url;
console.log(kind);

// FILE: package.json
{"name":"module-format-rules"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"noEmit":true,"types":[],"strict":true,"module":"CommonJS","moduleResolution":"bundler","resolveJsonModule":true}}
