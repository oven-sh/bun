import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", async () => {
  console.log("SAID b", JSON.stringify((delete require.cache[require.resolve("./shared.txt")], require("./shared.txt"))));
});
