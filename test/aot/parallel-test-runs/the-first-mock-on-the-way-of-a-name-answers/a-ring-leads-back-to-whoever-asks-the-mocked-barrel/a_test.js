import { test, mock } from "bun:test";
mock.module("./index.mjs", () => ({ area: () => "mocked" }));
test("a", async () => {
  const api = await import("./api.mjs");
  console.log("a", api.area());
});
