import { test } from "bun:test";
test("b", async () => {
  console.log("SAID b", (await import("./greeting.cjs")).word);
});
