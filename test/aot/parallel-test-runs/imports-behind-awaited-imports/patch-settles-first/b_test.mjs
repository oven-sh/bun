import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const get = load => { try { return load(); } catch (error) { return String(error.message).slice(0, 22); } };
test("b", async () => {
  vi.doMock("./dep.mjs", async () => { await 0; return { x: "first" }; });
  await import("./other.cjs");
  console.log("SAID", (await import("./dep.mjs")).x);
  jest.doMock("./dep.mjs", async () => ({ ...(await vi.importActual("./dep.mjs")), x: "second" }));
  console.log("SAID", (await import("./user.mjs")).seen());
});
