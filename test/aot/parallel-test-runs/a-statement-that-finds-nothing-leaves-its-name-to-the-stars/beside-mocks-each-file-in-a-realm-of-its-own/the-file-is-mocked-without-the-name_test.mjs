import { mock, test } from "bun:test";
import { say } from "./show.mjs";
test("a mock of the file leaves the name out", async () => {
  mock.module("./node-or-browser.cjs", () => ({ measure: "the mock's measure" }));
  await say("over a CommonJS file", () => import("./index.mjs"));
  await say("over an ES module", () => import("./over-an-es-module.mjs"));
});
