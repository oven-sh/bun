import { test } from "bun:test";
import { loads } from "./lib/helper.mjs";
const first = load => load;
test("the text imports from the folder of the generator", async () => {
  console.log("SAID", (await first(...loads())).x);
});
