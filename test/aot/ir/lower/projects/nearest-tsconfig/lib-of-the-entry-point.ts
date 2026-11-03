// RUN: lower

// FILE: main.ts
export class Failure extends Error {
  readonly cause: Error | undefined;
  constructor(cause?: Error) {
    super("failed");
    this.cause = cause;
  }
}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"lib":["ES2020"],"noImplicitOverride":true}}
