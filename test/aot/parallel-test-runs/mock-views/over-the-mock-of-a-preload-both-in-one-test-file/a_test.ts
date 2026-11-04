import { mock, test, vi } from "bun:test";
import { used } from "./user";

vi.mock("./m", () => ({ v: "of vi.mock()" }));

test("vi.mock(), then mock.module() in the same test file", async () => {
  console.log("under vi.mock(): " + used() + "," + (globalThis as any).held());
  await mock.module("./m", () => ({ v: "of mock.module()" }));
  console.log("under mock.module(): " + used() + "," + (globalThis as any).held());
});
