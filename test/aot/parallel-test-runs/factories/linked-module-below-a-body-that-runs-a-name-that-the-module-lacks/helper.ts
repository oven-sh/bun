import { mock } from "bun:test";

console.log("helper begins");
mock.module("./tax", () => {
  console.log("factory");
  return { rate: 2, more: "of the mock" };
});
console.log("helper ends");
