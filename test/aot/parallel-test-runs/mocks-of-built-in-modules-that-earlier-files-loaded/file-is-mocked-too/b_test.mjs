import { test, vi } from "bun:test";
import { top } from "./top.mjs";
vi.mock("node:os", async importOriginal => ({ ...(await importOriginal()), platform: () => "mock" }));
vi.mock("./other.mjs", () => ({ other: () => "mock of other" }));
test("b", async () => {
  console.log("SAID b", top());
});
