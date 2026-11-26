import { test } from "bun:test";
test("t", async () => {
  try {
    await import("./top.mjs");
    console.log("later", (await import("./a.mjs")).v, (await import("./b.mjs")).v);
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
