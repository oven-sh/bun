import { test } from "bun:test";
test("t", async () => {
  console.log(Object.keys(await import("./commonjs/plain.unknown", { with: { type: "ts" } })));
  console.log(Object.keys(await import("./module/requires.unknown", { with: { type: "ts" } })));
});
