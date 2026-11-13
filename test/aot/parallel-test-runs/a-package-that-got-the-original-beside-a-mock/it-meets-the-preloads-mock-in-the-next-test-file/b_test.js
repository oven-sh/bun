import { test } from "bun:test";
test("b", async () => {
  const pkg = await import("pkg"); console.log("SAID b", (await import("./k.js")).x, pkg.p());
});
