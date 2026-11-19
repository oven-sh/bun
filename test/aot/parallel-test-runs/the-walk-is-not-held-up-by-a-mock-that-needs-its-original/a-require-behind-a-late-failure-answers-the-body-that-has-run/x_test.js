import { test, vi } from "bun:test";
let booms = 0;
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.message; } };
test("t", async () => {
  vi.doMock("./dep.js", async original => { console.log("| factory " + (booms + 1)); await 0; throw new Error("boom " + ++booms); });
  console.log("| import", await tried(async () => (await import("./dep.js")).flag));
  console.log("| require", await tried(() => import.meta.require("./dep.js").flag));
  console.log("| late", await tried(async () => (await import("./user-late.js")).values()));
  console.log("| import", await tried(async () => (await import("./dep.js")).flag));
});
