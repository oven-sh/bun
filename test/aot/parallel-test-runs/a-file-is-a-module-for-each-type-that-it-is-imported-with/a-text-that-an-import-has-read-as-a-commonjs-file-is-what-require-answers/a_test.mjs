import { test } from "bun:test";
test("t", async () => {
  const called = await import("./called.txt", { with: { type: "js" } });
  console.log(called.a, require("./called.txt").a);
});
