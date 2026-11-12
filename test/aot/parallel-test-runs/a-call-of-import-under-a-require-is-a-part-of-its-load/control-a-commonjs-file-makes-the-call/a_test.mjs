import { test } from "bun:test";
test("the bobbin is required", async () => {
  console.log("required:", import.meta.require("./bobbin.cjs").bobbin);
  await new Promise(done => setTimeout(done, 50));
});
