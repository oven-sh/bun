import { test } from "bun:test";
import { load } from "./lib/helper.mjs";
test("the text imports from the folder of the helper", async () => {
  console.log("SAID", (await load()).x);
});
