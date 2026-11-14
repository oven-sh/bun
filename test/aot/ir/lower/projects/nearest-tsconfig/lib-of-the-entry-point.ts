// RUN: lower

// FILE: main.ts
export class Row extends Array<number> {
  findLast(): number | undefined {
    return this[this.length - 1];
  }
}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"lib":["ES2020"],"noImplicitOverride":true}}
