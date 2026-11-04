// RUN: lower

// `declare module` under the name of a file that does not exist stops no build: it is a type error, and nothing of it runs.
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: Return [[nothing]]

// FILE: missing.ts
declare module "./nowhere" {
  interface Variables {
    other?: string;
  }
}
export {};

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}
