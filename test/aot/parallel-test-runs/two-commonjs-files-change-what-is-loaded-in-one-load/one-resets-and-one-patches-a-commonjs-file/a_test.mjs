import { test } from "bun:test";
import "./root.mjs";
test("t", async () => {
  try {
    console.log("later", (await import("./a.cjs")).v, (await import("./b.cjs")).v);
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
