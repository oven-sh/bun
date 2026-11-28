import { test } from "bun:test";
test("t", async () => {
  try {
    await import("./root.mjs");
    {
      const m = await import("./a.cjs");
      const a = m.v ?? m.platform ?? m.default;
      console.log("later", typeof a === "string" ? a : typeof a);
    }
    await import("./reads.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
