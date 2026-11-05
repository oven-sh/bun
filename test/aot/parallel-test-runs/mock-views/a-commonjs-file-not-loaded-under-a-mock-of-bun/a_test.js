import { vi, mock, jest, test } from "bun:test";
let step = "";
const ask = async (how, read) => {
  let got;
  try {
    got = String(await read());
  } catch (e) {
    got = "threw " + String(e.message).slice(0, 50);
  }
  console.log(step, how, got, "bodies", globalThis.bodiesThatRan ?? 0);
};
test("one", async () => {
  step = "0 start";
  mock.module("./dep.cjs", () => ({ flag: "one", plain: "one" }));
  step = "1 one";
  await ask("import", async () => (await import("./dep.cjs")).flag);
  await ask("names", async () => Object.keys(await import("./dep.cjs")).sort().join("+"));
  await ask("require", () => import.meta.require("./dep.cjs").flag);
  await ask("a name that nobody exports", async () => String((await import("./dep.cjs")).nobodyExportsThis));
  await ask("late", async () => (await import("./user-late.js")).values());
  vi.doUnmock("./dep.cjs");
  step = "2 unmock";
  await ask("import", async () => (await import("./dep.cjs")).flag);
  await ask("names", async () => Object.keys(await import("./dep.cjs")).sort().join("+"));
  await ask("require", () => import.meta.require("./dep.cjs").flag);
  await ask("late", async () => (await import("./user-late.js")).values());
});
