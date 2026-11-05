// A CommonJS file is first required where the stack ends, and again later.
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# only-values");
await import("./only-values/main.js");
await settled();
console.log("# a-function-too");
await import("./a-function-too/main.js");
await settled();
console.log("# exports-dot");
await import("./exports-dot/main.js");
await settled();
console.log("# a-class");
await import("./a-class/main.js");
await settled();
console.log("# it-requires-another");
await import("./it-requires-another/main.js");
await settled();
