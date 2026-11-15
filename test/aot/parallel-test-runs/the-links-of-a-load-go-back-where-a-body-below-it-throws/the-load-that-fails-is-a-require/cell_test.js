import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), mock = () => ({ round: 10 });
const sync = ask => { try { return "answered " + ask(); } catch (error) { return error.name; } };
test("t", async () => {
  vi.doMock("./shapes.mjs", mock);
  const first = await import("./user.mjs");
  vi.doUnmock("./shapes.mjs");
  const asked = sync(() => require("./asks-for-nothing.mjs").member());
  console.log("SAID", asked + ", " + sync(() => first.member()));
});
