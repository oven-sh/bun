import { test, vi } from "bun:test";
import { user } from "./user.mjs";
test("c", async () => {
  vi.doMock("./leaf.mjs", () => ({ leaf: "mock" }));
  console.log("SAID c", user(), (await import("./user.mjs")).user());
});
