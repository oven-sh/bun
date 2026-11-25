import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const get = load => { try { return load(); } catch (error) { return String(error.message).slice(0, 22); } };
test("a", async () => {
  if (globalThis.never) vi.doMock("./dep.mjs", () => ({}));
  await import("./uses-last.mjs").catch(error => console.log("SAID threw", error.constructor.name));
  console.log("SAID between");
  console.log("SAID", (await import("./user.mjs")).seen());
});
