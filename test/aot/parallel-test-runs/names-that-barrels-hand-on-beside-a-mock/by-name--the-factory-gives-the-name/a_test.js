import { test, mock } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in", sides: "many" }));
test("a", async () => {
  const space = await import("./area.mjs");
  const { area, sides } = space;
  console.log("a", typeof area, String(sides), Object.keys(space).join(), typeof area === "function" ? area(2, 3) : "no function");
});
