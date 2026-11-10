const { test, vi } = require("bun:test");
const seen = async () => { try { return (await import("./user.mjs")).seen(); } catch (error) { return error.name; } };
test("a", async () => {
  vi.doMock("./lib.cjs", () => ({ a: "mine", n: -1 })); console.log("SAID mocked", require("./lib.cjs").a);
  vi.doUnmock("./lib.cjs"); console.log("SAID ended", require("./lib.cjs").a, await seen());
  const lay = vi.mock; lay("./lib.cjs", () => ({ a: "again", n: -2 }));
  console.log("SAID laid", await seen()); console.log("SAID again", require("./lib.cjs").a, await seen());
});
