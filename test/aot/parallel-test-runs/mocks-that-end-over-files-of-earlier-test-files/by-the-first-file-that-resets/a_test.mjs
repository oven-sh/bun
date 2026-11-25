import { expect, test, vi } from "bun:test";
import { price } from "./prices.mjs";
test("a load of its own", async () => {
  console.log("first", price());
  vi.resetModules();
  console.log("again", (await import("./prices.mjs")).price());
});
