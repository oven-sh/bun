import { test } from "bun:test";
test("t", async () => {
  console.log(Object.keys(await import("./commonjs/plain.txt", { with: { type: "js" } })));
  console.log(Object.keys(await import("./module/requires.txt", { with: { type: "js" } })));
  console.log(Object.keys(await import("./commonjs/plain.unknown", { with: { type: "js" } })));
  console.log(Object.keys(await import("./module/requires.unknown", { with: { type: "js" } })));
  console.log(Object.keys(await import("./commonjs/plain", { with: { type: "js" } })));
  console.log(Object.keys(await import("./module/requires", { with: { type: "js" } })));
});
