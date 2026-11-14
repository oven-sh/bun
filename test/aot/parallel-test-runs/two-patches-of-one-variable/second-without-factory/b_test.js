import { test } from "bun:test";
test("the variable has its value back", async () => {
  console.log("SAID", (await import("./outer.js")).a, (await import("./inner.js")).a, (await import("./variable.js")).a);
});
