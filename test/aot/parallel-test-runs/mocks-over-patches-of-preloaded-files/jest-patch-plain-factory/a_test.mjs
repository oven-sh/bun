import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const get = load => { try { return load(); } catch (error) { return String(error.message).slice(0, 22); } };
test("a", async () => {
  jest.doMock("./dep.mjs", () => ({ x: "patch" }));
  vi.doMock("./dep.mjs", () => ({ x: "mock" }));
  console.log("SAID", (await import("./dep.mjs")).x);
  console.log("SAID", (await vi.importActual("./dep.mjs")).x, jest.requireActual("./dep.mjs").x);
  console.log("SAID", (await import("./user.mjs")).seen(), globalThis.kept.seen());
});
