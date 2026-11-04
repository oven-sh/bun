import { test, mock } from "bun:test";

mock.module("./m", () => ({ v: "b" }));
const { used } = await import("./user");

test("mock.module()", () => {
  console.log("b sees " + used() + "," + (globalThis as any).held());
});
