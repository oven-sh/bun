import { test } from "bun:test";
import "./root.mjs";
test("t", async () => {
  try {
    console.log("later", (await import("./a.mjs")).v, (await import("./b.mjs")).v);
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
