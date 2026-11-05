// The mock stands on behind a factory that fails: every import() asks it again. Whoever failed to load keeps the error. A require() does not call a factory that awaits: it answers the module itself.
import { vi, mock, test } from "bun:test";
globalThis.booms ??= 0;
let step = "";
const ask = async (how, read) => {
  let got;
  try {
    got = String(await read());
  } catch (e) {
    got = "threw " + String(e.message).slice(0, 40);
  }
  console.log(step, how, got);
};
test("one", async () => {
  vi.doMock("./dep.cjs", async () => { await 0; throw new Error("boom " + ++globalThis.booms); });
  step = "1 mocked";
  await ask("import", async () => (await import("./dep.cjs")).flag);
  await ask("import", async () => (await import("./dep.cjs")).flag);
  await ask("late", async () => (await import("./user-late.js")).values());
  await ask("late", async () => (await import("./user-late.js")).values());
});
test("the next test", async () => {
  step = "2 next test";
  await ask("import", async () => (await import("./dep.cjs")).flag);
  await ask("late", async () => (await import("./user-late.js")).values());
  await ask("require", () => import.meta.require("./dep.cjs").flag);
});
