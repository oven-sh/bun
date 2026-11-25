const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
const tryOne = async name => { try { return (await import(name)).seen(); } catch (error) { return error.name; } };
const late = async at => console.log("SAID late", at, "| user", await tryOne("./user.mjs"), "| outer", await tryOne("./outer.mjs"), "| other", await tryOne("./other.mjs"), "|", globalThis.runsOfLib, "calls", globalThis.calls);
const user = async at => console.log("SAID user", at, await tryOne("./user.mjs"), globalThis.runsOfLib, "calls", globalThis.calls);
const outer = async at => console.log("SAID outer", at, await tryOne("./outer.mjs"), globalThis.runsOfLib, "calls", globalThis.calls);
const itself = async at => { let es; try { const all = await import("./lib.cjs"); es = [all.a, all.n].join(","); } catch (error) { es = error.name; } console.log("SAID itself", at, es, globalThis.runsOfLib, "calls", globalThis.calls); };
test("t", async () => {
  const handle = vi.doMock("./lib.cjs", async () => { globalThis.calls = (globalThis.calls ?? 0) + 1; await 0; throw new RangeError("late"); });
  ask();
  await user("in front");
  delete require.cache[key]; delete require.cache[require.resolve("./user.mjs")];
  vi.doUnmock("./lib.cjs");
  await late("behind the end");
  await itself("behind the end");
  await late("once more");
});
