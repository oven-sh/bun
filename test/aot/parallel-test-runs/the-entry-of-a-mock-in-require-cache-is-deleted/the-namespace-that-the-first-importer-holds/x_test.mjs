import { test, vi } from "bun:test";
const key = require.resolve("./part.mjs");
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + String(error?.message).slice(0, 30); } };
const x = () => tried(async () => (await import("./part.mjs")).x);
const count = () => globalThis.ran?.part ?? 0;
test("x", async () => {
  vi.doMock("./part.mjs", () => ({ x: "mock" }));
  const u = await import("./user.mjs"), first = u.ns();
  const before = (await import("./part.mjs")) === first;
  delete require.cache[key];
  const held = u.ns() === first;
  const again = await import("./part.mjs");
  console.log("SAID x part ran", count(), "| held", held, "| anew", again === first, u.ns() === again, "| before", before);
});
