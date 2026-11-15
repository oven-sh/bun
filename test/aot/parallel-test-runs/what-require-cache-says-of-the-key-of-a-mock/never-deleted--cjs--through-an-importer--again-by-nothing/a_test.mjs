import { test, vi } from "bun:test";
const key = require.resolve("./part.cjs");
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 40); } };
const listed = () => { let seen = false; for (const each in require.cache) seen ||= each === key; return seen; };
const view = step => console.log("SAID", step, key in require.cache, Object.keys(require.cache).includes(key), Reflect.ownKeys(require.cache).includes(key), typeof require.cache[key], typeof Object.getOwnPropertyDescriptor(require.cache, key), Object.hasOwn(require.cache, key), listed());
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ x: "mock" }));
  view("laid");
  console.log("SAID first", (await import("./user.mjs")).seen());
  view("mocked");
  view("again");
  vi.doUnmock("./part.cjs");
  view("ended");
  console.log("SAID real", (await import("./part.cjs")).x, require("./part.cjs").x, globalThis.ran);
  view("real");
});
