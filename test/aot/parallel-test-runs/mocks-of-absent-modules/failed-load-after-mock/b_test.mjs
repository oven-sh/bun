import { test } from "bun:test";
test("b", async () => {
  console.log("SAID b", await import("./user.mjs").then(() => "loaded", error => error.name));
});
