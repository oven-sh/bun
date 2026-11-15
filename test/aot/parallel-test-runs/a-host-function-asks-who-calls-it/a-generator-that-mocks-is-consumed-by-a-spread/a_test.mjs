import { test } from "bun:test";
import { mocks } from "./lib/helper.mjs";
test("the path is looked up from the folder of the generator", async () => {
  const laid = [...mocks()];
  console.log("SAID", laid.length, (await import("./dep.mjs")).x, (await import("./lib/dep.mjs")).x);
});
