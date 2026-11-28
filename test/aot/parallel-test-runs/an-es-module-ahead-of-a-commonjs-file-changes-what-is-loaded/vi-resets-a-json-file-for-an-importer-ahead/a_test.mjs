import { test } from "bun:test";
test("t", async () => {
  try {
    await import("./root.mjs");
    {
      const m = await import("./dep.json");
      const v = m.v ?? m.platform ?? m.default;
      console.log("later", typeof v === "string" ? v.trim() : typeof v);
    }
    console.log("again");
    await import("./root.mjs");
    await import("./mid.mjs");
    await import("./late.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
