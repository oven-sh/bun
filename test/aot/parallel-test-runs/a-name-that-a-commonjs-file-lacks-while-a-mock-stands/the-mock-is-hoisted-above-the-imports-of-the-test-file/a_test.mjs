import { test, vi } from "bun:test";
vi.mock("./gauge.mjs", () => ({ level: "mock" }));
import { got } from "./entry.mjs";
test("the load", () => {
  console.log("SAID", got);
});
