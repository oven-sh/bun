import { mock } from "bun:test";
mock.module("./g.cjs", () => {
  globalThis.factories = (globalThis.factories ?? 0) + 1;
  return { word: "preload" };
});
