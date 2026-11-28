import { mock, vi } from "bun:test";
console.log("helper");
const run = () => {
  vi.resetModules();
  mock.module("./p.json", () => {
    console.log("factory");
    return { v: "M", default: "M", platform: "M" };
  });
};
if (!globalThis.h) {
  globalThis.h = 1;
  run();
}
