import { test } from "bun:test";
test("t", async () => {
  try {
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
  try {
    {
      const m = await import("./p.json");
      const v = m.v ?? m.platform ?? m.default;
      console.log("later p", typeof v === "string" ? v.trim() : typeof v);
    }
    {
      const { v } = await import("./a.mjs");
      console.log("later a", typeof v === "string" ? v.trim() : typeof v);
    }
    console.log("again");
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
