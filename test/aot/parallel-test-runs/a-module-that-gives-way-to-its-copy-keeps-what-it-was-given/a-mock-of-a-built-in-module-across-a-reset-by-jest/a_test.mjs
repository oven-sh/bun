import { test } from "bun:test";
test("t", async () => {
  try {
    require("./top.mjs");
    {
      const m = await import("node:os");
      const v = m.v ?? m.platform ?? m.default;
      console.log("later", typeof v === "string" ? v.trim() : typeof v);
    }
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
