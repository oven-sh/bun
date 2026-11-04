import { test, vi } from "bun:test";
import { used } from "./user";

vi.mock("./m", () => ({ v: "d" }));

test("vi.mock()", () => {
  console.log("d sees " + used() + "," + (globalThis as any).held());
});
