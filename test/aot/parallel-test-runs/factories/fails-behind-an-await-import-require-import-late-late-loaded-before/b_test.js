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
test("the next file", async () => {
  step = "3 next file";
  await ask("import", async () => (await import("./dep.js")).flag);
  await ask("late", async () => (await import("./user-late.js")).values());
  await ask("require", () => import.meta.require("./dep.js").flag);
});
