import { vi } from "bun:test";
console.log("helper");
const run = () => {
  vi.doMock("./dep.mjs", () => {
    console.log("factory");
    return { v: "M", default: "M", platform: "M" };
  });
};
if (!globalThis.h) {
  globalThis.h = 1;
  run();
}
