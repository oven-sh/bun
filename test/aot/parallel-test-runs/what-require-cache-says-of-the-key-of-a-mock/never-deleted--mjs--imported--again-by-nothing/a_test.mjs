import { test, vi } from "bun:test";
const key = require.resolve("./part.mjs");
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 40); } };
const listed = () => { let seen = false; for (const each in require.cache) seen ||= each === key; return seen; };
const view = step => console.log("SAID", step, key in require.cache, Object.keys(require.cache).includes(key), Reflect.ownKeys(require.cache).includes(key), typeof require.cache[key], typeof Object.getOwnPropertyDescriptor(require.cache, key), Object.hasOwn(require.cache, key), listed());
test("t", async () => {
  vi.doMock("./part.mjs", () => ({ x: "mock" }));
  view("laid");
  console.log("SAID first", (await import("./part.mjs")).x);
  view("mocked");
  view("again");
  vi.doUnmock("./part.mjs");
  view("ended");
  console.log("SAID real", (await import("./part.mjs")).x, require("./part.mjs").x, globalThis.ran);
  view("real");
});
