import { test, mock } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in", sides: "many" }));
test("a", async () => {
  const api = await import("./api.mjs");
  console.log("a", typeof api.area, String(api.sides), Object.keys(api).join(), typeof api.area === "function" ? api.area(2, 3) : "no function");
});
