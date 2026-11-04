import { test } from "bun:test";
import { used } from "./user";

test("no mock", () => {
  console.log("b sees " + used() + "," + (globalThis as any).held());
});
