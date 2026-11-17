const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const actual = async () => { try { return own(await vi.importActual("./lib.cjs")); } catch (error) { return { a: error.name }; } };
const late = async at => { let es, cjs; try { es = (await import("./user.mjs")).seen(); } catch (error) { es = error.name; } try { cjs = require("./user.cjs").seen(); } catch (error) { cjs = error.name; } console.log("SAID late", at, es, cjs, globalThis.runsOfLib); };
const say = (at, it, first) => console.log("SAID", at, it.a, it.n, it === first, globalThis.runsOfLib);
test("t", async () => {
  globalThis.first = ask(); const entry = require.cache[key]; const handle = vi.doMock("./lib.cjs", () => ({ a: "mocked", n: -1 })); ask(); const first = globalThis.first;
  await late("in front");
  delete require.cache[key];
  vi.doUnmock("./lib.cjs");
  await late("behind the end");
});
