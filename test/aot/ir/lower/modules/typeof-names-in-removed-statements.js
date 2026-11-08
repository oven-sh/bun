// `bun run` removes a statement that does nothing and forgets its names. Without them this file is an ES module, which has no `module` and no `exports` and whose `this` is undefined,
// while folding has for the three what they are in a CommonJS file. The build leaves such a statement out too.
// RUN: lower
// CHECK-NOT: kind=CommonJsModule
// CHECK-NOT: string="object"
// CHECK-NOT: = TypeOf
// CHECK: = Call {{*}}calleeName="console.log"

// FILE: main.js
{
  typeof module;
  {
    void this;
  }
}
{
  typeof this;
}
if (typeof exports === "object") {
}
console.log("ran");
