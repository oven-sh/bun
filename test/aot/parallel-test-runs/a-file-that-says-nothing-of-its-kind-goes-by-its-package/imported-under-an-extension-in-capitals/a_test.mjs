import { test } from "bun:test";
test("t", async () => {
  console.log(Object.keys(await import("./commonjs/plain.JS")));
  console.log(Object.keys(await import("./module/requires.JS")));
});
