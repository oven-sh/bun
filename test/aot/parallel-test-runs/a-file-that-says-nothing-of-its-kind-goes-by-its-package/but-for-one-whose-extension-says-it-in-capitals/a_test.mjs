import { test } from "bun:test";
test("t", async () => {
  console.log(Object.keys(await import("./commonjs/plain.MJS")));
  console.log(Object.keys(await import("./commonjs/typed.MTS")));
  console.log(Object.keys(await import("./module/plain.CJS")));
  console.log(Object.keys(await import("./module/typed.CTS")));
});
