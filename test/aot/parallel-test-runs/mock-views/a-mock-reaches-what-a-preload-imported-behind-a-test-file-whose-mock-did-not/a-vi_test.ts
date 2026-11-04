import { test, expect, vi } from "bun:test";
import { used } from "./user";

vi.mock("./m", () => ({ v: "file" }));

test("vi.mock(): only the modules that the test file imports get the file's mock", () => {
  console.log("SEEN " + used() + "," + (globalThis as any).held());
  expect([used(), (globalThis as any).held()]).toEqual(["file", "preload"]);
});
