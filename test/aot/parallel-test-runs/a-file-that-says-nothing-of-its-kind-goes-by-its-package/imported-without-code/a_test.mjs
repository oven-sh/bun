import { test } from "bun:test";
test("t", async () => {
  console.log(JSON.stringify(await import("./a.cjs")));
  console.log(JSON.stringify(await import("./commonjs/a.js")));
  console.log(JSON.stringify(await import("./commonjs/blank.js")));
  console.log(JSON.stringify(await import("./module/a.cjs")));
  console.log(JSON.stringify(await import("./module/a.js")));
});
