import { test } from "bun:test";
test("first", async () => {
  const cart: any = await import("./cart.cjs");
  console.log("first", cart.sell(), cart.sell());
});
