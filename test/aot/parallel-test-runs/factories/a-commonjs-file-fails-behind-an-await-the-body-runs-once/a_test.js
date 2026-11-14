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
// The require() runs the body of dep.js for the first time. Nothing runs it again.
test("one", async () => {
  vi.doMock("./dep.cjs", async () => { await 0; throw new Error("boom " + ++globalThis.booms); });
  step = "1 mocked";
  await ask("import", async () => (await import("./dep.cjs")).flag);
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
  await ask("require", () => import.meta.require("./dep.cjs").flag);
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
  await ask("require", () => import.meta.require("./dep.cjs").flag);
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
  await ask("import", async () => (await import("./dep.cjs")).flag);
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
  await ask("late", async () => (await import("./user-late.js")).values());
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
  await ask("import", async () => (await import("./dep.cjs")).flag);
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
  await ask("late", async () => (await import("./user-late.js")).values());
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
});
test("the next test", async () => {
  step = "2 next test";
  await ask("import", async () => (await import("./dep.cjs")).flag);
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
  await ask("require", () => import.meta.require("./dep.cjs").flag);
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
  await ask("late", async () => (await import("./user-late.js")).values());
  console.log(step, "bodies", globalThis.bodiesThatRan ?? 0, "users", globalThis.usersThatRan ?? 0);
});
