import { test, expect } from "bun:test";
import { used } from "./user";

test("the next file has the preload's mock again", () => {
  console.log("SEEN " + used() + "," + (globalThis as any).held());
  expect([used(), (globalThis as any).held()]).toEqual(["preload", "preload"]);
});
