import { test, expect, mock } from "bun:test";

mock.module("./m", () => ({ v: "file" }));
const { used } = await import("./user");

test("mock.module(): the modules that the preload imported get the file's mock too", () => {
  console.log("SEEN " + used() + "," + (globalThis as any).held());
  expect([used(), (globalThis as any).held()]).toEqual(["file", "file"]);
});
