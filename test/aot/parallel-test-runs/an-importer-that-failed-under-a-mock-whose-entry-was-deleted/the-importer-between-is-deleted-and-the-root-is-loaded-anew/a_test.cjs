const { test, vi } = require("bun:test");
const tryOne = async name => { try { return (await import(name)).seen(); } catch (error) { return error.name; } };
const late = async () => { await 0; throw new RangeError("late"); };
test("t", async () => {
  vi.doMock("./lib.cjs", late);
  try { require("./lib.cjs"); } catch {}
  console.log("SAID in front", await tryOne("./outer.mjs"));
  delete require.cache[require.resolve("./user.mjs")];
  vi.doUnmock("./lib.cjs");
  console.log("SAID behind the end", await tryOne("./outer.mjs"));
});
