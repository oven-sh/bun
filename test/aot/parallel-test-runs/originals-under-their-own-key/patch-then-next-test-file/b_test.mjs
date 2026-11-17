import { test, vi } from "bun:test";
test("b", async () => {
  console.log("SAID b", (await import("./leaf.mjs")).tag, (await import("./user.mjs")).read(), (await vi.importActual("./leaf.mjs")).tag);
});
