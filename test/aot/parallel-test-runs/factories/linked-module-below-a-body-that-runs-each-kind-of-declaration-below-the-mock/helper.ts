import { mock } from "bun:test";

console.log("helper begins");
mock.module("./tax", () => {
  console.log("factory");
  return { constant: "mock", variable: "mock", old: "mock", declared: () => "mock", Made: class { is = "mock" }, default: "mock", renamed: "mock" };
});
console.log("helper ends");
