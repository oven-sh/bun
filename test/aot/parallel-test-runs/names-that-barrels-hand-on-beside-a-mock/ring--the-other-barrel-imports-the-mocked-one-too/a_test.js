import { test, mock } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in" }));
test("a", async () => {
  const space = await import("./area.mjs");
  console.log("a", typeof space.area, String(space.sides));
  const api = await import("./api.mjs");
  console.log("a", typeof api.area, String(api.sides), Object.keys(api).join(), typeof api.area === "function" ? api.area(2, 3) : "no function");
});
