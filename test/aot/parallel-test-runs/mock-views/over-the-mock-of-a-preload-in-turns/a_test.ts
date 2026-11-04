import { test, mock } from "bun:test";

mock.module("./m", () => ({ v: "a" }));
const { used } = await import("./user");

test("mock.module()", () => {
  console.log("a sees " + used() + "," + (globalThis as any).held());
});
