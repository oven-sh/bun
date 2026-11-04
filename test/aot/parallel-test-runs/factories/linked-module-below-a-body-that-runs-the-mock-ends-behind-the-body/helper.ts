import { mock } from "bun:test";

console.log("helper begins");
mock.module("./tax", () => {
  console.log("factory");
  return { rate: 2, above: () => "mock" };
});
console.log("helper ends");
