import { test, vi } from "bun:test";
test("t", async () => {
  try {
    vi.doMock("./dep.mjs", () => {
      console.log("factory");
      return { v: "P", default: "P", platform: "P" };
    });
    require("./root.mjs");
    {
      const m = await import("./dep.mjs");
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
