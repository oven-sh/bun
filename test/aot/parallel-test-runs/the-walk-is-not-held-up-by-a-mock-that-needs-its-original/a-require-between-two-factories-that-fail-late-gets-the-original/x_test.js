import { test, vi } from "bun:test";
const DEP = "./dep.js";
let booms = 0;
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).slice(0, 40); } };
async function look(step) {
  globalThis.moment = "behind " + step;
  console.log("| " + step, "import", await tried(async () => (await import(DEP)).flag), "require", await tried(() => import.meta.require(DEP).flag), "late", await tried(async () => (await import("./user-late.js")).values()));
}
test("t", async () => {
  vi.doMock(DEP, async original => { await 0; throw new Error("boom " + ++booms); });
  await look("1");
  vi.doMock(DEP, async original => { await 0; throw new Error("boom " + ++booms); });
  await look("2");
});
