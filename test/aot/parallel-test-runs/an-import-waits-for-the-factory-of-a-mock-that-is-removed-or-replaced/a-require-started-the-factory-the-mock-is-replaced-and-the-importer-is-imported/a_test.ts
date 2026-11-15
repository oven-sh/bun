import { test, vi } from "bun:test";
test("replaced", async () => {
  vi.doMock("./kept", () => new Promise(() => {}));
  try { require("./user").x; } catch {}
  vi.doMock("./kept", () => ({ x: "second" }));
  console.log("SAID", (await import("./user")).x);
  vi.doUnmock("./kept");
});
