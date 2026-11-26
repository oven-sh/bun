const { mock } = require("bun:test");
console.log("h2");
if (!globalThis.h2) {
  globalThis.h2 = 1;
  mock.module("./a.cjs", () => ({ v: "Ma" }));
}
