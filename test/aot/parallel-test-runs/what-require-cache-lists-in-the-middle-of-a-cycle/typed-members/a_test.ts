import { test } from "bun:test";
import "./install.cjs";
import { seen } from "./north.ts";
const shared = globalThis as unknown as { said: string[]; listed: () => string };
shared.said.push("in north: " + seen);
test("what require.cache lists", () => {
  for (const line of shared.said) console.log(line);
  console.log("in the test:", shared.listed());
});
