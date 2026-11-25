import { test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.mock("tax", { spy: true });
test("b", () => {
  console.log("b", sold());
});
