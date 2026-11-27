import { test, vi } from "bun:test";
const key = require.resolve("./part.mjs");
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 30); } };
const x = () => tried(async () => (await import("./part.mjs")).x);
const count = () => globalThis.ran?.part ?? 0;
test("x", async () => {
  vi.doMock("./part.mjs", () => ({ x: "mock" }));
  const u = await import("./user.mjs");
  Object.keys(u.ns());
  delete require.cache[key];
  const deleted = key in require.cache;
  Object.keys(u.ns());
  console.log("SAID x part ran", count(), "| behind the read", key in require.cache, "| deleted", deleted);
});
