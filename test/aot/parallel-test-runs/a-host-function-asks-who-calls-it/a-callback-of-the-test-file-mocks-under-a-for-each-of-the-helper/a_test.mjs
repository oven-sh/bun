import { mock, test } from "bun:test";
import { forEachOf } from "./lib/helper.mjs";
test("the callback has left by its tail call, so the caller of forEach() is who calls", async () => {
  forEachOf(["./dep.mjs"], path => mock.module(path, () => ({ x: "mocked" })));
  console.log("SAID", (await import("./dep.mjs")).x, (await import("./lib/dep.mjs")).x);
});
