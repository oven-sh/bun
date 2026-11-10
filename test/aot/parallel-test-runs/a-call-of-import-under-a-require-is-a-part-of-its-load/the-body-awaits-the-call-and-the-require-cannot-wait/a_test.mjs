import { test } from "bun:test";
test("the loom is imported", async () => {
  await import("./loom.mjs").then(it => console.log("came", it.loom), error => console.log("failed", error.name));
  await new Promise(done => setTimeout(done, 20));
});
