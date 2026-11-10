import { test, vi } from "bun:test";
const start = "./ot";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    try { await vi.importActual(start + "her"); } catch {}
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", "const-in-sum", user.look(), String(globalThis.ran));
});
