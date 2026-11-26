import { vi } from "bun:test";
console.log("helper");
const run = () => {
  vi.resetModules();
};
if (!globalThis.h) {
  globalThis.h = 1;
  run();
}
