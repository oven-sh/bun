import { test, vi } from "bun:test";
test("t", async () => {
  try {
    vi.doMock("./p.cjs", () => {
      globalThis.f1 = (globalThis.f1 ?? 0) + 1;
      console.log("factory 1");
      const v = "M1" + globalThis.f1;
      return { v, default: v, platform: v };
    });
    await import("./root.mjs");
    {
      const m = await import("./p.cjs");
      const v = m.v ?? m.platform ?? m.default;
      console.log("later", typeof v === "string" ? v.trim() : typeof v);
    }
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
