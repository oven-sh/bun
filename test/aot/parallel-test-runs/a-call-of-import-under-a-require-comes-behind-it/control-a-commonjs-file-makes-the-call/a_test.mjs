import { test } from "bun:test";
const call = Promise.withResolvers();
globalThis.callSettles = call.resolve;
test("the bobbin is required", async () => {
  console.log("required:", import.meta.require("./bobbin.cjs").bobbin);
  await call.promise;
});
