import { vi } from "bun:test";
console.log("helper");
const run = () => {
  vi.doMock("./p.mjs", () => {
    console.log("factory");
    return { v: "M", default: "M", platform: "M" };
  });
};
if (!globalThis.h) {
  globalThis.h = 1;
  run();
}
