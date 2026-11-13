import { test, vi } from "bun:test";
vi.mock("./dep.mjs", { spy: true });
test("t", async () => {
  console.log((await import("./sub.mjs")).read(), globalThis.ran);
  vi.doMock("pkg", () => ({ name: () => "mock" }));
  vi.doUnmock("./dep.mjs");
  console.log((await import("./sub.mjs")).read(), (await import("./sub.mjs")).read(), globalThis.ran);
});
