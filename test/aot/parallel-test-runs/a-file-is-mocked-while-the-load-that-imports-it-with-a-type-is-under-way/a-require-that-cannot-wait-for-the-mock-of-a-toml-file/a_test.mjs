import { test } from "bun:test";
test("t", async () => {
  try {
    require("./root.mjs");
    {
      const m = await import("./p.toml");
      const v = m.v ?? m.platform ?? m.default;
      console.log("later", typeof v === "string" ? v.trim() : typeof v);
    }
    await import("./late.mjs");
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
