import { mock, test } from "bun:test";
let calls = 0, asked;
const seen = [];
mock.module("./kiln.js", async () => {
  calls++;
  await Promise.resolve();
  await Promise.resolve();
  let chain = Promise.resolve();
  for (let turn = 0; turn < 8; turn++) chain = chain.then(() => {});
  asked = chain.then(() => {
    try {
      seen.push("required " + require("./kiln.js").heat);
    } catch (error) {
      seen.push("threw " + error.constructor.name);
    }
  });
  return { heat: "mock" };
});
test("a", async () => {
  seen.push("imported " + (await import("./kiln.js")).heat);
  await asked;
  console.log(seen.join(" . ") + " . calls " + calls);
});
