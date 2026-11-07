import { mock, test } from "bun:test";
import { say } from "./show.mjs";
test("a mock stands for the file that the statement names", async () => {
  mock.module("./node-or-browser.cjs", () => ({ measure: "the mock's measure", paint: "the mock's paint" }));
  await say("the mock has both names", () => import("./index.mjs"));
  await say("over an ES module", () => import("./over-an-es-module.mjs"));
});
