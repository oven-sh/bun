import { test } from "bun:test";
const body = Promise.withResolvers();
globalThis.bodyGoesOn = body.resolve;
test("the loom is imported", async () => {
  await import("./loom.mjs").then(it => console.log("came", it.loom), error => console.log("failed", error.name));
  await body.promise;
});
