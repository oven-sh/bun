// Reading a method from an instance that lacks an own property, where another instance has one under the name of the method.
console.log("a-symbol-ahead.mjs");
await import("./a-symbol-ahead.mjs");
console.log("a-registered-symbol-ahead.mjs");
await import("./a-registered-symbol-ahead.mjs");
console.log("an-index-ahead.mjs");
await import("./an-index-ahead.mjs");
console.log("an-index-as-a-string-ahead.mjs");
await import("./an-index-as-a-string-ahead.mjs");
console.log("a-getter-ahead.mjs");
await import("./a-getter-ahead.mjs");
console.log("a-symbol-ahead-in-commonjs.cjs");
await import("./a-symbol-ahead-in-commonjs.cjs");
console.log("directly.mjs");
await import("./directly.mjs");
console.log("in-a-function.mjs");
await import("./in-a-function.mjs");
console.log("at-once.mjs");
await import("./at-once.mjs");
