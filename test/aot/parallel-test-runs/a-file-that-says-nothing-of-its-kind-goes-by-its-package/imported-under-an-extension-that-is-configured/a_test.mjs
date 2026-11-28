import { test } from "bun:test";
test("t", async () => {
  console.log(Object.keys(await import("./commonjs/plain.es6")));
  console.log(Object.keys(await import("./module/requires.es6")));
});
