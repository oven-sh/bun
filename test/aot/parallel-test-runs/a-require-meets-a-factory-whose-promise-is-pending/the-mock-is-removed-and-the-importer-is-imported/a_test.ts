import { test, vi } from "bun:test";
test("removed", async () => {
  vi.doMock("./kept", () => new Promise(() => {}));
  try { require("./user").x; } catch {}
  vi.doUnmock("./kept");
  console.log("SAID", (await import("./user")).x);
  vi.doUnmock("./kept");
});
