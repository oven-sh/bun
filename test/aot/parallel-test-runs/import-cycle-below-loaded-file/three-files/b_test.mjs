import { test, vi } from "bun:test";
import { middle } from "./middle.mjs";
vi.mock("./leaf.mjs", () => ({ leaf: () => "mocked" }));
vi.mock("./other.mjs", () => ({ other: () => "mocked" }));
test("b", async () => {
  console.log("SAID b", middle());
  const { read } = await import("./reader.mjs");
  console.log("SAID b2", read(), middle());
  console.log("SAID b3", (await import("./other.mjs")).other());
});
