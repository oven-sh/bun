import { test, vi } from "bun:test";
import { middle } from "./middle.mjs";
vi.mock("./other.mjs", () => ({ other: () => "mocked" }));
test("c", async () => {
  console.log("SAID c", middle());
  const { read } = await import("./reader.mjs");
  console.log("SAID c2", read(), middle());
  console.log("SAID c3", (await import("./other.mjs")).other());
});
