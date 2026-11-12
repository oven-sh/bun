import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const get = load => { try { return load(); } catch (error) { return String(error.message).slice(0, 22); } };
test("a", async () => {
  await import("./user.mjs");
  vi.doMock("./dep.mjs", () => ({ x: "first" }));
  console.log("SAID", (await import("./dep.mjs")).x);
  let turns = 0, counts = true;
  (async () => { while (counts && turns < 100) { turns++; await 0; } })();
  jest.doMock("./dep.mjs", async original => { const before = turns; const { x } = await vi.importActual("./dep.mjs"); console.log("SAID", x, turns - before); return { x: "second" }; });
  console.log("SAID", require("./user.mjs").seen());
  await new Promise(resolve => setTimeout(resolve, 1));
  counts = false;
  console.log("SAID", (await import("./user.mjs")).seen());
});
