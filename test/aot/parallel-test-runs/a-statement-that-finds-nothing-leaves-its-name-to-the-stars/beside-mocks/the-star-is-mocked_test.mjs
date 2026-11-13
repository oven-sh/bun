import { mock, test } from "bun:test";
import { say } from "./show.mjs";
test("a mock stands for what the star names", async () => {
  mock.module("./shapes.cjs", () => ({ paint: "the mock's", added: 1 }));
  mock.module("./colors.mjs", () => ({ red: 2 }));
  await say("the mock has the name", () => import("./index.mjs"));
  await say("the mock leaves the name out", () => import("./over-an-es-module.mjs"));
});
