const { test } = require("bun:test");
test("c", async () => {
  console.log("SAID c", globalThis.kept.map(it => it.a + it.n).join(), (await import("./reader.mjs")).a, globalThis.runs);
});
