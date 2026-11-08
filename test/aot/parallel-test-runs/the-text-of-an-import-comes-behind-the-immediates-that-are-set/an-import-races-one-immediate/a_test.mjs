import { test } from "bun:test";
const immediate = () => new Promise(done => setImmediate(done));
test("it", async () => {
  await immediate();
  console.log("SAID", await Promise.race([import("./late.mjs").then(() => "the import"), immediate().then(() => "the immediate")]));
});
