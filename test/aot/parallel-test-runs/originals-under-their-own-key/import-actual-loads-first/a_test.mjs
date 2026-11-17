import { test, vi } from "bun:test";
test("a", async () => {
  console.log("SAID 1", (await vi.importActual("./leaf.mjs")).tag);
  console.log("SAID 2", (await import("./user.mjs")).read());
  vi.doMock("./leaf.mjs", () => ({ tag: "mock" }));
  console.log("SAID 3", (await import("./user.mjs")).read());
});
