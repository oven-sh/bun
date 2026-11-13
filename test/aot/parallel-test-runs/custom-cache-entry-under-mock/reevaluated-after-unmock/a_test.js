import { test, vi, mock } from "bun:test";
const key = require.resolve("./lib.mjs");
const ask = () => { try { return require("./lib.mjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const actual = async () => { try { return own(await vi.importActual("./lib.mjs")); } catch (error) { return { a: error.name }; } };
const say = (at, it, first) => console.log("SAID", at, it.a, it.n, it === first, globalThis.runsOfLib);
test("t", async () => {
  const first = ask();
  require.cache[key] = fake(); delete require.cache[key]; vi.doUnmock("./lib.mjs"); say("required", ask(), first); say("actual", await actual(), first);
});
