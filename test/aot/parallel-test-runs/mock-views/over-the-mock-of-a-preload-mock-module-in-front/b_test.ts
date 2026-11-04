import { test, vi } from "bun:test";
import { used } from "./user";

vi.mock("./m", () => ({ v: "b" }));

test("vi.mock()", () => {
  console.log("b sees " + used() + "," + (globalThis as any).held());
});
