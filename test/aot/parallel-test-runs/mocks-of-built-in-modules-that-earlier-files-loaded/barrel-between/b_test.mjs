import { test, vi } from "bun:test";
import { top } from "./barrel.mjs";
vi.mock("node:os", async importOriginal => ({ ...(await importOriginal()), platform: () => "mock" }));
test("b", async () => {
  console.log("SAID b", top());
});
