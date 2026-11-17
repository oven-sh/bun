import { test, vi } from "bun:test";
const key = require.resolve("./part.cjs");
const listed = () => { let seen = false; for (const each in require.cache) seen ||= each === key; return seen; };
const view = step => console.log("SAID", step, key in require.cache, Object.keys(require.cache).includes(key), typeof require.cache[key], typeof Object.getOwnPropertyDescriptor(require.cache, key), listed());
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 40); } };
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ x: "mock" }));
  console.log("SAID first", await tried(async () => (await import("./part.cjs")).x));
  view("mocked");
});
