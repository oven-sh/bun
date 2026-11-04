import { test } from "bun:test";
import { used } from "./user";

test("no mock", () => {
  console.log("e sees " + used() + "," + (globalThis as any).held());
});
