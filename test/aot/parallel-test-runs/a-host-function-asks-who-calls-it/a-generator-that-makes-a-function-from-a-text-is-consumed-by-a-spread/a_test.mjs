import { test } from "bun:test";
import { loads } from "./lib/helper.mjs";
test("the text imports from the folder of the generator", async () => {
  console.log("SAID", (await [...loads()][0]).x);
});
