const { test, vi } = require("bun:test");
test("k3: a deletion for the reset", async () => {
  const first = require("./lib.cjs");
  const before = await vi.importActual("./lib.cjs");
  ((require.cache[require.resolve("./lib.cjs")] = undefined), true);
  let second; try { second = require("./lib.cjs"); } catch (error) { second = { a: error.constructor.name }; }
  console.log(`SAID ${globalThis.runsOfLib} ${second === first} ${before.a} ${second.a}`);
});
