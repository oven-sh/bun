import { test, mock } from "bun:test";
mock.module("./h1.mjs", () => ({ ns: { v: "of h1" } }));
test("a", async () => {
  const { seen } = await import("./user.mjs");
  console.log("a", String(seen()));
});
