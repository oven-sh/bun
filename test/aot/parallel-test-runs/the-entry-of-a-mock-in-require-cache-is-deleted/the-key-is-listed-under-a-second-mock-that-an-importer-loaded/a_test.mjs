import { test, vi, jest, mock } from "bun:test";
import { look, hold, made, tried, watchKey } from "./watch.mjs";
const key = watchKey(require.resolve("./part.mjs"));
const step = async (name, act) => { const got = await tried(act); look(name + " " + hold(name.split(" ")[0], got)); };
test("t", async () => {
  look("start");
  vi.doMock("./part.mjs", made("part", n => ({ x: "mock" + n }))); look("mock");
  await step("part import", () => import("./part.mjs"));
  delete require.cache[key]; look("delete");
  await step("user", () => import("./user.mjs"));
  vi.doMock("./part.mjs", made("second", n => ({ x: "second" + n }))); look("mock2");
  await step("user", () => import("./user.mjs"));
  vi.doUnmock("./part.mjs"); look("unmock");
  await step("part import", () => import("./part.mjs"));
  await step("part require", () => require("./part.mjs"));
  await step("user", () => import("./user.mjs"));
  await step("late", () => import("./late.mjs"));
});
