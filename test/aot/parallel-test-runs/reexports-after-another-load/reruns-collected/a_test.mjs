import { test, vi } from "bun:test";
import { three, write, hold } from "./reader.mjs";
import { leaf } from "./leaf.mjs";
export let value = (globalThis.runs = (globalThis.runs ?? 0) + 1) * 100;
export const bump = () => ++value;
hold(bump);
test.skip("mocks", () => { vi.doMock("./leaf.mjs", () => ({ leaf: "mock" })); });
test("a", async () => {
  const ns = await import("./barrel.mjs");
  globalThis.first ??= ns;
  const isEarly = globalThis.runs === 1;
  console.log("SAID run", globalThis.runs, three(globalThis.first, isEarly), three(ns, isEarly), ns === globalThis.first, globalThis.barrelRuns, leaf);
  bump();
  console.log("SAID bumped", three(globalThis.first, isEarly), three(ns, isEarly));
  write();
  console.log("SAID wrote", three(globalThis.first, isEarly), three(ns, isEarly));
});
