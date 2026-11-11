import { test } from "bun:test";
test("the bobbin is required", async () => {
  console.log("required:", import.meta.require("./bobbin.mjs").bobbin);
  await new Promise(done => setTimeout(done, 20));
});
