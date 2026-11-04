import { test, mock } from "bun:test";

mock.module("./m", () => ({ v: "c" }));
const { used } = await import("./user");

test("mock.module()", () => {
  console.log("c sees " + used() + "," + (globalThis as any).held());
});
