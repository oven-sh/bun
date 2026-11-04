import { mock } from "bun:test";

console.log("helper begins");
mock.module("./tax", async () => {
  console.log("factory");
  await 0;
  console.log("factory goes on");
  return { rate: 2, above: () => "mock" };
});
console.log("helper ends");
