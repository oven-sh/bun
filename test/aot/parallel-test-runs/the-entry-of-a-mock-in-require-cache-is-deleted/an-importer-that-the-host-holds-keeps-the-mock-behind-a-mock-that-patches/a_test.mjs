import { test, vi, jest, mock } from "bun:test";
import { look, hold, made, tried, watchKey } from "./watch.mjs";
const key = watchKey(require.resolve("./part.mjs"));
const step = async (name, act) => { const got = await tried(act); look(name + " " + hold(name.split(" ")[0], got)); };
test("t", async () => {
  look("start");
  mock.module("./part.mjs", made("part", n => ({ x: "mock" + n }))); look("mock");
  await step("user", () => import("./user.mjs"));
  for (const each of Object.keys(require.cache)) if (each.endsWith("user.mjs")) delete require.cache[each]; look("outUser");
  await step("user", () => import("./user.mjs"));
  delete require.cache[key]; look("delete");
  mock.module("./part.mjs", made("second", n => ({ x: "second" + n }))); look("mock2");
  await step("user", () => import("./user.mjs"));
  await step("part import", () => import("./part.mjs"));
  await step("part require", () => require("./part.mjs"));
  await step("user", () => import("./user.mjs"));
  await step("late", () => import("./late.mjs"));
});
