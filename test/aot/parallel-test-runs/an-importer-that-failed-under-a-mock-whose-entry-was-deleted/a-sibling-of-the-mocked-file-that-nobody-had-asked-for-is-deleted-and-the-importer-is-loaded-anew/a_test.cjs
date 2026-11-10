const { test, vi } = require("bun:test");
const tryOne = async name => { try { return (await import(name)).seen(); } catch (error) { return error.name; } };
const late = async () => { await 0; throw new RangeError("late"); };
test("t", async () => {
  vi.doMock("./lib.cjs", late);
  try { require("./lib.cjs"); } catch {}
  console.log("SAID in front", await tryOne("./user.mjs"));
  delete require.cache[require.resolve("./other.cjs")];
  vi.doUnmock("./lib.cjs");
  console.log("SAID behind the end", await tryOne("./user.mjs"));
});
