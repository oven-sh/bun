import { test, vi } from "bun:test";
vi.mock("./dep.mjs");
test("t", async () => {
  console.log((await import("./dep.mjs")).value(), globalThis.ran);
  vi.doMock("pkg", () => ({ name: () => "mock" }));
  vi.doUnmock("./dep.mjs");
  console.log((await import("./dep.mjs")).value(), (await import("./sub.mjs")).read(), globalThis.ran);
});
