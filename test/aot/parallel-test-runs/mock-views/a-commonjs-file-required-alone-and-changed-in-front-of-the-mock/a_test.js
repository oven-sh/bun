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
  await ask("require", () => import.meta.require("./dep.cjs").flag);
  import.meta.require("./dep.cjs").flag = "changed";
  vi.doMock("./dep.cjs", () => ({ flag: "one", plain: "one" }));
  step = "1 one";
  await ask("import", async () => (await import("./dep.cjs")).flag);
  await ask("require", () => import.meta.require("./dep.cjs").flag);
  vi.doUnmock("./dep.cjs");
  step = "2 unmock";
  await ask("import", async () => (await import("./dep.cjs")).flag);
  await ask("require", () => import.meta.require("./dep.cjs").flag);
  await ask("late", async () => (await import("./user-late.js")).values());
});
