import { test } from "bun:test";
import { used } from "./user";

test("no mock", () => {
  console.log("c sees " + used() + "," + (globalThis as any).held());
});
