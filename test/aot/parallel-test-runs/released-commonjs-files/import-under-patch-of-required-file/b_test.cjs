const { test, mock } = require("bun:test");
test("b", async () => {
  console.log("SAID b", globalThis.kept.map(it => it.a + it.n).join());
  const real = require("./lib.cjs");
  mock.module("./lib.cjs", () => ({ a: "third", n: -3 }));
  globalThis.kept.push(await import("./reader.mjs"), await import("./lib.cjs"));
  console.log("SAID third", globalThis.kept.map(it => it.a + it.n).join(), real.n, globalThis.runs);
});
