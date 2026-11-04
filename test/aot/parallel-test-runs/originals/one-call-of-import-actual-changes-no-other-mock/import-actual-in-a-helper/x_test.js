import { test } from "bun:test";
import { load } from "./sub/helper.js";
test("a helper of another folder asks for the file itself", async () => {
  console.log("helper loads", (await load()).x);
});
