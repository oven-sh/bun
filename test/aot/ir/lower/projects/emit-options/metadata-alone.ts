// RUN: lower
// CHECK-COUNT-3: = Builtin builtin=CompilerHelpersDefineMetadata
// CHECK: = Builtin builtin=CompilerHelpersDecorateMethod

// FILE: one.ts
function mark(target: any, key: string, descriptor: PropertyDescriptor) {}
export class Marked {
  @mark
  hello() {
    return "world";
  }
}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"emitDecoratorMetadata":true}}
