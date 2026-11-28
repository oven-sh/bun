import { mock } from "bun:test";
console.log("helper");
const run = () => {
  delete require.cache[require.resolve("./dep.cjs")];
  mock.module("./dep.cjs", () => {
    console.log("factory");
    return { v: "M", default: "M", platform: "M" };
  });
};
if (!globalThis.h) {
  globalThis.h = 1;
  run();
}
