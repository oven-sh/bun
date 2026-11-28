import { mock } from "bun:test";
console.log("helper");
const run = () => {
  delete require.cache[require.resolve("./dep.json")];
  mock.module("./dep.json", () => {
    console.log("factory");
    return { v: "M", default: "M", platform: "M" };
  });
};
if (!globalThis.h) {
  globalThis.h = 1;
  run();
}
