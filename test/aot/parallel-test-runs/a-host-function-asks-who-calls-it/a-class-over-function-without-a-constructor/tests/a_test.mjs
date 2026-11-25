import { test } from "bun:test";
import { MadeOfText } from "../lib/helper.mjs";
test("a constructor that nobody wrote has no file, so the text imports from the working directory", async () => {
  console.log("SAID", (await new MadeOfText("return import(\"./dep.mjs\")")()).x);
});
