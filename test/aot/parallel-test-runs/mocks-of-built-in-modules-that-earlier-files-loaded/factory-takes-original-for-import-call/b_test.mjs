import { test, vi } from "bun:test";
vi.mock("node:os", async importOriginal => ({ ...(await importOriginal()), platform: () => "mock" }));
test("b", async () => {
  console.log("SAID b", (await import("./top.mjs")).top());
});
