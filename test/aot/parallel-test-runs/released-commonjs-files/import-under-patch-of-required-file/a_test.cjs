const { test, jest } = require("bun:test");
require("./user.cjs");
test("a", async () => {
  jest.mock("./lib.cjs", () => ({ a: "first", n: -1 }));
  globalThis.kept = [await import("./reader.mjs"), await import("./lib.cjs")];
  jest.mock("./lib.cjs", () => ({ a: "second", n: -2 }));
  console.log("SAID a", globalThis.kept.map(it => it.a + it.n).join(), require("./user.cjs").lib().a);
});
