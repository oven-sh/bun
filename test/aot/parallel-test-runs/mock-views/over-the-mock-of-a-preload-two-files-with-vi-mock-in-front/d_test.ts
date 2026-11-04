import { test } from "bun:test";
import { used } from "./user";

test("no mock", () => {
  console.log("d sees " + used() + "," + (globalThis as any).held());
});
