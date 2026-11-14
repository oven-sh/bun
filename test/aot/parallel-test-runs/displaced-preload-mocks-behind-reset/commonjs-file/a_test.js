import { test, vi, jest } from "bun:test";
test("import", async () => {
  console.log((await import("./dep.cjs")).value());
  vi.doMock("./dep.cjs", async () => ({ ...(await vi.importActual("./dep.cjs")), extra: 1 }));
  vi.resetModules();
  console.log((await import("./dep.cjs")).value());
});
test("require", () => {
  vi.doMock("./dep.cjs", () => ({ ...jest.requireActual("./dep.cjs"), extra: 2 }));
  vi.resetModules();
  const loaded = require("./dep.cjs");
  console.log(loaded.value(), loaded.extra);
});
