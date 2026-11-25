import { test, vi } from "bun:test";
import { three, write } from "./reader.mjs";
test("a", async () => {
  const failed = await import("./barrel.mjs").then(() => "came", error => error.message);
  console.log("SAID failed", failed, three(globalThis.first, true), globalThis.runs);
  vi.doMock("./d.mjs", () => ({ value: "mock", bump() {} }));
  const mocked = await import("./barrel.mjs").catch(error => error);
  console.log("SAID mocked", three(globalThis.first, true));
  vi.doUnmock("./d.mjs");
  const again = await import("./barrel.mjs").catch(error => error);
  console.log("SAID again", three(globalThis.first));
  write();
  console.log("SAID wrote", three(globalThis.first));
  const direct = await import("./d.mjs").catch(error => error);
  direct.bump?.(); direct.bump?.();
  console.log("SAID direct", three(globalThis.first));
});
