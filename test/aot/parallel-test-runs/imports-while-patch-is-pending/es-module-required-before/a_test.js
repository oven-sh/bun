import { test, jest, vi } from "bun:test";
test("first", async () => {
  jest.doMock("./dep.mjs", () => ({ value: () => "first" }));
  console.log((await import("./sub.cjs")).read());
});
test("second", async () => {
  jest.doMock("./dep.mjs", async () => ({ ...(await vi.importActual("./dep.mjs")), extra: 1 }));
  console.log((await import("./dep.mjs")).value(), globalThis.ran);
});
test("third", async () => {
  console.log((await import("./sub.cjs")).read(), (await import("./dep.mjs")).value(), globalThis.ran);
});
