import { test } from "bun:test";
import { Mocks } from "./lib/helper.mjs";
test("the path is looked up from the folder of the class", async () => {
  new Mocks();
  console.log("SAID", (await import("./dep.mjs")).x, (await import("./lib/dep.mjs")).x);
});
