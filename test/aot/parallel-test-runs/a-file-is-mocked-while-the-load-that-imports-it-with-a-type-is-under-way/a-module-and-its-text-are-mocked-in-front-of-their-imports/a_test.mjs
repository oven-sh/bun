import { test } from "bun:test";
import "./root.mjs";
test("t", async () => {
  try {
    {
      const m = await import("./p.mjs");
      const v = m.v ?? m.platform ?? m.default;
      console.log("later", typeof v === "string" ? v.trim() : typeof v);
    }
    await import("./late.mjs");
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
