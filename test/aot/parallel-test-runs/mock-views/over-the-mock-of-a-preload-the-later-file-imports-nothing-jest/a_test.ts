import { test, vi } from "bun:test";
import { used } from "./user";

vi.mock("./m", () => ({ v: "a" }));

test("vi.mock()", () => {
  console.log("a sees " + used() + "," + (globalThis as any).held());
});
