import { test, vi } from "bun:test";
import { user } from "./user.mjs";
test("a", () => {
  vi.doMock("./leaf.mjs", () => ({ leaf: "mock" }));
  vi.doUnmock("./leaf.mjs");
  console.log("SAID a", user());
});
