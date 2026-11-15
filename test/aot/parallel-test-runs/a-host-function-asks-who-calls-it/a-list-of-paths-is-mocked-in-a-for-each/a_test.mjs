import { test } from "bun:test";
import { layMocks } from "./lib/helper.mjs";
test("the path is looked up from the folder of the helper", async () => {
  layMocks();
  console.log("SAID", (await import("./dep.mjs")).x, (await import("./lib/dep.mjs")).x);
});
