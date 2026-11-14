import { test, vi } from "bun:test";
import { value } from "./dep.mjs";
test("t", async () => {
  vi.doMock("./dep.mjs", async () => ({ ...(await vi.importActual("./dep.mjs")), extra: 1 }));
  vi.resetModules();
  const loaded = await import("./dep.mjs");
  console.log(value(), loaded.value(), loaded.extra);
});
