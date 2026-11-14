import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const get = load => { try { return load(); } catch (error) { return String(error.message).slice(0, 22); } };
test("a", async () => {
  console.log("SAID", require("./dep.mjs").x);
  console.log("SAID", jest.requireActual("./dep.mjs").x);
  vi.doMock("./dep.mjs", async original => { console.log("SAID factory"); return { ...(await original()), x: "mock" }; });
  console.log("SAID", (await import("./user.mjs")).seen(), jest.requireActual("./dep.mjs").x);
});
