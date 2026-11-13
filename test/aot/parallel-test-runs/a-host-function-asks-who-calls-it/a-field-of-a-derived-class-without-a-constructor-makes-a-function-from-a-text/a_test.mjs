import { test } from "bun:test";
import { Loads } from "./lib/helper.mjs";
test("the text imports from the folder of the class", async () => {
  console.log("SAID", (await new Loads().load).x);
});
