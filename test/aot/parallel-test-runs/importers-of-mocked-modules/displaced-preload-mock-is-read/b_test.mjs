import { beforeEach, test, vi } from "bun:test";
import { leaf } from "./leaf.mjs";
beforeEach(() => {
  vi.doMock("./leaf.mjs", () => ({ leaf: "mock" }));
});
test("b", async () => {
  const { load } = await import("./lazy.mjs");
  console.log("SAID b", (await load()).leaf, leaf);
});
